"""Database operations; PostGIS performs all distance calculations."""

import math
from importlib.resources import files

from psycopg.rows import dict_row

from app.config.database import connect
from app.utils.gis.geojson import Cafe, coordinate, unique_cafes


def sql_file(name: str) -> str:
    return (
        files("app").joinpath("resources", "database", "queries", name).read_text(encoding="utf-8")
    )


def import_cafes(dsn: str, cafes: list[Cafe]) -> int:
    cafes = unique_cafes(cafes)
    with connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.executemany(sql_file("upsert.sql"), (cafe.values() for cafe in cafes))
        connection.execute("ANALYZE public.coffee_shops")
    return len(cafes)


def get_cafe(dsn: str, osm_type: str, osm_id: int) -> dict | None:
    with connect(dsn, row_factory=dict_row) as connection:
        return connection.execute(
            """SELECT osm_type, osm_id, latitude, longitude, address, opening_hours, phone, website,
                      COALESCE(NULLIF(name, ''), NULLIF(name_km, ''),
                               NULLIF(name_en, ''), 'Unnamed café') AS name
               FROM public.coffee_shops WHERE osm_type = %s AND osm_id = %s""",
            (osm_type, osm_id),
        ).fetchone()


def nearest(
    dsn: str, latitude: float, longitude: float, limit: int = 5, radius_m: float | None = None
) -> list[dict]:
    latitude = coordinate(latitude, "latitude", 90)
    longitude = coordinate(longitude, "longitude", 180)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit must be an integer between 1 and 100")
    if radius_m is not None and (not math.isfinite(radius_m) or radius_m <= 0):
        raise ValueError("radius-m must be finite and greater than zero")
    # This clause is fixed application SQL, never user-provided SQL.
    radius_filter = "WHERE ST_DWithin(c.location, u.location, %(radius)s)" if radius_m else ""
    query = (
        """
        WITH user_position AS (
            SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography AS location
        )
        SELECT c.osm_type, c.osm_id,
               COALESCE(NULLIF(c.name, ''), NULLIF(c.name_km, ''),
                        NULLIF(c.name_en, ''), 'Unnamed café') AS name,
               c.latitude, c.longitude, c.address, c.opening_hours, c.phone, c.website,
               ST_Distance(c.location, u.location) AS distance_m
        FROM public.coffee_shops AS c
        CROSS JOIN user_position AS u
        """
        + radius_filter
        + """
        ORDER BY distance_m, c.osm_type, c.osm_id
        LIMIT %(limit)s
    """
    )
    with connect(dsn, row_factory=dict_row) as connection:
        return connection.execute(
            query,
            {
                "lat": latitude,
                "lon": longitude,
                "radius": radius_m,
                "limit": limit,
            },
        ).fetchall()


def nearest_page(
    dsn: str,
    latitude: float,
    longitude: float,
    limit: int | None,
    radius_m: float,
    page: int,
    query: str = "",
) -> dict:
    """Count and page the same spatial result set in one database snapshot."""
    with connect(dsn, row_factory=dict_row) as connection:
        return connection.execute(
            """
            WITH user_position AS (
                SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography AS location
            ), matches AS (
                SELECT c.osm_type, c.osm_id,
                       COALESCE(NULLIF(c.name, ''), NULLIF(c.name_km, ''),
                                NULLIF(c.name_en, ''), 'Unnamed café') AS name,
                       c.latitude, c.longitude, c.address, c.opening_hours, c.phone, c.website,
                       ST_Distance(c.location, u.location) AS distance_m
                FROM public.coffee_shops c CROSS JOIN user_position u
                WHERE ST_DWithin(c.location, u.location, %(radius)s)
                  AND (%(query)s = '' OR strpos(
                      lower(concat_ws(' ', c.name, c.name_en, c.name_km)),
                      lower(%(query)s)) > 0)
            ), selected AS (
                SELECT * FROM matches ORDER BY distance_m, osm_type, osm_id
                LIMIT %(limit)s OFFSET %(offset)s
            )
            SELECT (SELECT count(*) FROM matches) AS total,
                   COALESCE((SELECT jsonb_agg(to_jsonb(s)
                       ORDER BY distance_m, osm_type, osm_id) FROM selected s), '[]'::jsonb)
                       AS cafes
            """,
            {
                "lat": latitude,
                "lon": longitude,
                "radius": radius_m,
                "limit": limit,
                "offset": (page - 1) * limit if limit is not None else 0,
                "query": query.strip(),
            },
        ).fetchone()


class CoffeeRepository:
    """Application-scoped repository; each operation owns its database connection."""

    def __init__(self, dsn: str | None):
        self.dsn = dsn

    @property
    def configured(self) -> bool:
        return bool(self.dsn)

    def nearest(self, latitude: float, longitude: float, limit: int, radius_m: float) -> list[dict]:
        return nearest(self.dsn, latitude, longitude, limit, radius_m)

    def nearest_page(
        self,
        latitude: float,
        longitude: float,
        limit: int | None,
        radius_m: float,
        page: int,
        query: str = "",
    ) -> dict:
        if query:
            return nearest_page(self.dsn, latitude, longitude, limit, radius_m, page, query=query)
        return nearest_page(self.dsn, latitude, longitude, limit, radius_m, page)

    def get_cafe(self, osm_type: str, osm_id: int) -> dict | None:
        return get_cafe(self.dsn, osm_type, osm_id)

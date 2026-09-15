"""Café model and persistence contract."""

from dataclasses import asdict, dataclass
from typing import Any, Protocol

from app.gis.geometry import coordinate as coordinate


@dataclass(frozen=True)
class Cafe:
    osm_type: str
    osm_id: int
    name: str
    name_en: str
    name_km: str
    latitude: float
    longitude: float

    @classmethod
    def from_mapping(cls, row: dict[str, Any]) -> "Cafe":
        kind = row.get("osm_type")
        if kind not in ("node", "way", "relation"):
            raise ValueError("osm_type must be node, way, or relation")
        identifier = str(row.get("osm_id", ""))
        if not identifier.isascii() or not identifier.isdigit():
            raise ValueError("osm_id must be a positive integer")
        osm_id = int(identifier)
        if not 0 < osm_id <= 9223372036854775807:
            raise ValueError("osm_id must fit a positive PostgreSQL BIGINT")
        names = []
        for field in ("name", "name_en", "name_km"):
            value = row.get(field)
            if value is None:
                value = ""
            if not isinstance(value, str) or "\x00" in value:
                raise ValueError(f"{field} must be text without NUL characters")
            names.append(value.strip())
        return cls(
            kind,
            osm_id,
            *names,
            coordinate(row.get("latitude"), "latitude", 90),
            coordinate(row.get("longitude"), "longitude", 180),
        )

    def values(self) -> tuple:
        return tuple(asdict(self).values())


class CoffeeRepository(Protocol):
    @property
    def configured(self) -> bool: ...

    def nearest(
        self, latitude: float, longitude: float, limit: int, radius_m: float
    ) -> list[dict]: ...

    def nearest_page(
        self,
        latitude: float,
        longitude: float,
        limit: int | None,
        radius_m: float,
        page: int,
        query: str = "",
    ) -> dict: ...

    def get_cafe(self, osm_type: str, osm_id: int) -> dict | None: ...

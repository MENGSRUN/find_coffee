"""Real PostGIS verification, isolated in a database created solely for these tests."""

import os
import uuid
from dataclasses import replace
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from app.gis.geojson import read_cafes
from app.repositories.place_repository import import_cafes, init_db, nearest, nearest_page, sql_file

pytestmark = pytest.mark.integration
SAMPLE = Path(__file__).parents[2] / "examples" / "sample_cafes.csv"


@pytest.fixture(scope="module")
def database():
    base_dsn = os.getenv("TEST_DATABASE_URL")
    if not base_dsn:
        pytest.skip("Set TEST_DATABASE_URL to run real PostGIS tests")
    name = "find_coffee_test_" + uuid.uuid4().hex
    with psycopg.connect(base_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
        try:
            dsn = make_conninfo(base_dsn, dbname=name)
            init_db(dsn)
            init_db(dsn)
            yield dsn
        finally:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def seeded_db(database):
    with psycopg.connect(database) as connection:
        connection.execute("TRUNCATE public.coffee_shops, public.coffee_shop_import")
    cafes = read_cafes(SAMPLE)
    import_cafes(database, cafes)
    return database, cafes


def test_exact_distance_radius_and_repeat_import(seeded_db):
    dsn, cafes = seeded_db
    assert import_cafes(dsn, cafes) == 6
    all_rows = nearest(dsn, 11.5564, 104.9282, limit=100)
    assert len(all_rows) == 6
    assert all_rows[0]["distance_m"] == pytest.approx(0, abs=0.001)
    assert 100 < all_rows[1]["distance_m"] < 120  # 0.001 degree latitude, in meters.
    assert [row["distance_m"] for row in all_rows] == sorted(row["distance_m"] for row in all_rows)
    assert len(nearest(dsn, 11.5564, 104.9282)) == 5
    assert len(nearest(dsn, 11.5564, 104.9282, radius_m=150)) == 2
    assert nearest(dsn, 0, 0, radius_m=100) == []


def test_updates_regenerate_location_and_imports_rollback(seeded_db):
    dsn, cafes = seeded_db
    changed = replace(cafes[0], name="Updated", latitude=11.6)
    import_cafes(dsn, [changed])
    with psycopg.connect(dsn) as connection:
        row = connection.execute(
            "SELECT name, ST_Y(location::geometry) FROM public.coffee_shops WHERE osm_id = %s",
            (changed.osm_id,),
        ).fetchone()
        assert row == ("Updated", 11.6)
    # A later database constraint failure must roll back earlier writes in the same batch.
    invalid = replace(cafes[1], latitude=100)
    with pytest.raises(psycopg.errors.CheckViolation):
        import_cafes(dsn, [replace(changed, name="Must roll back"), invalid])
    with psycopg.connect(dsn) as connection:
        assert (
            connection.execute(
                "SELECT name FROM public.coffee_shops WHERE osm_id = %s", (changed.osm_id,)
            ).fetchone()[0]
            == "Updated"
        )


def test_datagrip_staging_merge_and_name_fallback(seeded_db):
    dsn, cafes = seeded_db
    with psycopg.connect(dsn) as connection:
        connection.execute(
            """INSERT INTO public.coffee_shop_import
               (osm_type, osm_id, name, name_en, name_km, latitude, longitude)
               VALUES (%s, %s, NULL, NULL, %s, %s, %s)""",
            (cafes[0].osm_type, cafes[0].osm_id, "កាហ្វេ", 11.5564, 104.9282),
        )
    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(sql_file("002_import_staging.sql"))
    rows = nearest(dsn, 11.5564, 104.9282)
    assert rows[0]["name"] == "កាហ្វេ"
    with psycopg.connect(dsn) as connection:
        assert connection.execute("SELECT count(*) FROM public.coffee_shops").fetchone()[0] == 6
        assert connection.execute(sql_file("003_nearest_example.sql")).fetchall()


def test_spatial_pagination_count_order_and_empty_pages(seeded_db):
    dsn, cafes = seeded_db
    expected = nearest(dsn, 11.5564, 104.9282, limit=100, radius_m=50000)
    pages = [nearest_page(dsn, 11.5564, 104.9282, 2, 50000, page) for page in range(1, 4)]
    assert all(page["total"] == len(expected) for page in pages)
    assert [row["osm_id"] for page in pages for row in page["cafes"]] == [
        row["osm_id"] for row in expected
    ]
    assert nearest_page(dsn, 11.5564, 104.9282, 2, 50000, 99) == {
        "total": len(expected),
        "cafes": [],
    }
    assert nearest_page(dsn, 0, 0, 10, 100, 1) == {"total": 0, "cafes": []}
    assert nearest_page(dsn, 11.5564, 104.9282, 10, 150, 1)["total"] == 2


def test_alembic_adopts_existing_schema_without_losing_records(seeded_db, monkeypatch):
    from alembic import command
    from alembic.config import Config

    dsn, cafes = seeded_db
    monkeypatch.setenv("DATABASE_URL", dsn)
    config = Config(str(Path(__file__).parents[2] / "alembic.ini"))
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with psycopg.connect(dsn) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0001"
        assert connection.execute("SELECT count(*) FROM coffee_shops").fetchone()[0] == len(cafes)


def test_alembic_builds_clean_tables(seeded_db, monkeypatch):
    from alembic import command
    from alembic.config import Config

    dsn, _ = seeded_db
    # This database is generated by the fixture solely for tests.
    with psycopg.connect(dsn) as connection:
        connection.execute("DROP TABLE IF EXISTS alembic_version")
        connection.execute("DROP TABLE coffee_shops, coffee_shop_import")
    monkeypatch.setenv("DATABASE_URL", dsn)
    command.upgrade(Config(str(Path(__file__).parents[2] / "alembic.ini")), "head")
    assert nearest_page(dsn, 11.5, 104.9, 10, 3000, 1) == {"total": 0, "cafes": []}


def test_name_search_filters_before_count_and_pagination(seeded_db):
    dsn, cafes = seeded_db
    import_cafes(
        dsn,
        [
            replace(cafes[0], name="Needle 100%", name_km="កាហ្វេ"),
            replace(cafes[1], name="Needle second"),
        ],
    )
    first = nearest_page(dsn, 11.5564, 104.9282, 1, 50000, 1, query="needle")
    second = nearest_page(dsn, 11.5564, 104.9282, 1, 50000, 2, query="needle")
    assert first["total"] == second["total"] == 2
    assert first["cafes"][0]["osm_id"] != second["cafes"][0]["osm_id"]
    assert nearest_page(dsn, 11.5564, 104.9282, 10, 50000, 1, query="%")["total"] == 1
    assert nearest_page(dsn, 11.5564, 104.9282, 10, 50000, 1, query="កាហ្វេ")["total"] == 1


def test_all_page_preserves_radius_and_name_filters(seeded_db):
    dsn, cafes = seeded_db
    result = nearest_page(dsn, 11.5564, 104.9282, None, 50000, 1)
    expected = nearest(dsn, 11.5564, 104.9282, 100, 50000)
    assert result["total"] == len(result["cafes"]) == len(expected)
    assert len(expected) < len(cafes)  # The distant fixture is outside the radius.
    assert nearest_page(dsn, 0, 0, None, 100, 1) == {"total": 0, "cafes": []}
    assert nearest_page(dsn, 11.5564, 104.9282, None, 50000, 1, query="nonexistent cafe") == {
        "total": 0,
        "cafes": [],
    }

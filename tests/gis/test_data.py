import json
from pathlib import Path

import pytest

from app.utils.gis.geojson import Cafe, read_cafes, write_csv, write_geojson

SAMPLE = Path(__file__).parents[2] / "examples" / "sample_cafes.csv"


@pytest.fixture
def valid_row():
    return {
        "osm_type": "node",
        "osm_id": 42,
        "name": "កាហ្វេ, coffee ☕",
        "name_en": "Coffee",
        "name_km": "កាហ្វេ",
        "latitude": 11.5564,
        "longitude": 104.9282,
    }


@pytest.mark.parametrize("kind", ["csv", "geojson"])
def test_unicode_coordinates_and_ids_round_trip(tmp_path, valid_row, kind):
    cafes = [Cafe.from_mapping(valid_row)]
    path = tmp_path / f"cafes.{kind}"
    (write_csv if kind == "csv" else write_geojson)(path, cafes)
    assert read_cafes(path) == cafes
    assert "កាហ្វេ" in path.read_text(encoding="utf-8")
    if kind == "geojson":
        geometry = json.loads(path.read_text())["features"][0]["geometry"]
        assert geometry["coordinates"] == [104.9282, 11.5564]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("latitude", 91),
        ("longitude", 181),
        ("latitude", "NaN"),
        ("longitude", "inf"),
        ("latitude", None),
        ("longitude", True),
        ("osm_id", -1),
        ("osm_id", "1.2"),
        ("osm_id", 2**63),
        ("osm_id", True),
        ("osm_type", "area"),
        ("name", "bad\x00name"),
        ("name", False),
        ("name_en", []),
    ],
)
def test_invalid_records_are_rejected(valid_row, field, value):
    with pytest.raises(ValueError):
        Cafe.from_mapping({**valid_row, field: value})


def test_identical_rows_collapse_but_conflicts_fail(tmp_path, valid_row):
    path = tmp_path / "cafes.csv"
    cafe = Cafe.from_mapping(valid_row)
    write_csv(path, [cafe, cafe])
    assert read_cafes(path) == [cafe]
    write_csv(path, [cafe, Cafe.from_mapping({**valid_row, "name": "Different"})])
    with pytest.raises(ValueError, match="Conflicting records"):
        read_cafes(path)


def test_same_number_on_different_osm_types_is_not_a_duplicate(tmp_path, valid_row):
    path = tmp_path / "cafes.csv"
    cafes = [Cafe.from_mapping({**valid_row, "osm_type": kind}) for kind in ("node", "way")]
    write_csv(path, cafes)
    assert len(read_cafes(path)) == 2


@pytest.mark.parametrize(
    "contents",
    [
        "name,latitude,longitude\nCafe,11,104\n",
        "osm_type,osm_id,name,name_en,name_km,latitude,longitude\n",
        "osm_type,osm_id,name,name_en,name_km,latitude,longitude\nnode,1,Cafe,,,11\n",
        "osm_type,osm_id,name,name_en,name_km,latitude,longitude\nnode,1,Cafe,,,11,104,extra\n",
    ],
)
def test_missing_headers_empty_and_misaligned_csv_fail(tmp_path, contents):
    path = tmp_path / "bad.csv"
    path.write_text(contents)
    with pytest.raises(ValueError):
        read_cafes(path)


def test_polygon_geojson_fails_with_conversion_guidance(tmp_path):
    path = tmp_path / "polygon.geojson"
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {},
                        "geometry": {"type": "Polygon", "coordinates": []},
                    }
                ],
            }
        )
    )
    with pytest.raises(ValueError, match="only Point geometries"):
        read_cafes(path)


def test_sample_file_has_six_valid_fictional_records():
    cafes = read_cafes(SAMPLE)
    assert len(cafes) == 6
    assert all(cafe.name.startswith("Demo ") for cafe in cafes)


@pytest.mark.parametrize("kind", ["csv", "geojson"])
def test_business_details_round_trip(tmp_path, valid_row, kind):
    cafe = Cafe.from_mapping(
        {
            **valid_row,
            "address": "12, Street 123, Phnom Penh",
            "opening_hours": "Mo-Su 07:00-20:00",
            "phone": "+855 12 345 678",
            "website": "https://example.com",
        }
    )
    path = tmp_path / f"details.{kind}"
    (write_csv if kind == "csv" else write_geojson)(path, [cafe])
    assert read_cafes(path) == [cafe]


@pytest.mark.parametrize("field", ["address", "opening_hours", "phone", "website"])
def test_invalid_business_details_rejected(valid_row, field):
    with pytest.raises(ValueError):
        Cafe.from_mapping({**valid_row, field: ["invalid"]})

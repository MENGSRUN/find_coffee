import json
from unittest.mock import Mock

import pytest
import requests

from app.service.location_service import download, normalize_overpass
from app.utils.gis.geojson import read_cafes


@pytest.fixture
def payload():
    return {
        "osm3s": {"timestamp_osm_base": "2026-01-01T00:00:00Z"},
        "elements": [
            {
                "type": "node",
                "id": 1,
                "lat": 11.5,
                "lon": 104.9,
                "tags": {"amenity": "cafe", "name": "កាហ្វេ"},
            },
            {
                "type": "way",
                "id": 2,
                "center": {"lat": 11.6, "lon": 104.8},
                "tags": {"amenity": "cafe", "name:en": "Coffee"},
            },
            {
                "type": "relation",
                "id": 3,
                "center": {"lat": 11.7, "lon": 104.7},
                "tags": {"amenity": "cafe"},
            },
        ],
    }


def test_normalizes_nodes_ways_relations_and_missing_names(payload):
    cafes = normalize_overpass(payload)
    assert [cafe.osm_type for cafe in cafes] == ["node", "way", "relation"]
    assert cafes[0].name == "កាហ្វេ"
    assert cafes[1].longitude == 104.8
    assert cafes[2].name == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"remark": "runtime error: Query timed out", "elements": []},
        {"elements": []},
        {},
        [],
        {"elements": [{"type": "way", "id": 1, "tags": {}}]},
    ],
)
def test_errors_and_incomplete_responses_fail(payload):
    with pytest.raises(ValueError):
        normalize_overpass(payload)


def test_download_exports_both_formats_and_metadata(tmp_path, monkeypatch, payload):
    response = Mock()
    response.json.return_value = payload
    post = Mock(return_value=response)
    monkeypatch.setattr("app.service.location_service.requests.post", post)
    assert download(tmp_path, "https://example.test/interpreter") == 3
    assert read_cafes(tmp_path / "cambodia_cafes.csv") == read_cafes(
        tmp_path / "cambodia_cafes.geojson"
    )
    metadata = json.loads((tmp_path / "metadata.json").read_text())
    assert metadata["count"] == 3
    assert metadata["license"] == "ODbL-1.0"
    assert metadata["osm_base_timestamp"] == "2026-01-01T00:00:00Z"
    assert post.call_args.kwargs["timeout"] == (15, 180)
    with pytest.raises(ValueError, match="already exist"):
        download(tmp_path, "https://example.test/interpreter")
    assert post.call_count == 1  # Refuse an accidental refresh before making a request.


def test_failed_refresh_preserves_existing_export(tmp_path, monkeypatch):
    path = tmp_path / "cambodia_cafes.csv"
    path.write_text("previous data")
    response = Mock()
    response.raise_for_status.side_effect = requests.HTTPError("503 unavailable")
    monkeypatch.setattr("app.service.location_service.requests.post", Mock(return_value=response))
    with pytest.raises(requests.HTTPError):
        download(tmp_path, "https://example.test/interpreter", overwrite=True)
    assert path.read_text() == "previous data"


def test_normalize_preserves_business_details():
    from app.service.location_service import normalize_overpass

    cafe = normalize_overpass(
        {
            "elements": [
                {
                    "type": "node",
                    "id": 1,
                    "lat": 11,
                    "lon": 104,
                    "tags": {
                        "name": "Cafe",
                        "addr:housenumber": "12",
                        "addr:street": "Street 123",
                        "opening_hours": "24/7",
                        "contact:phone": "+85512345678",
                        "contact:website": "https://example.com",
                    },
                }
            ]
        }
    )[0]
    assert cafe.address == "12, Street 123"
    assert cafe.opening_hours == "24/7"
    assert cafe.phone == "+85512345678"
    assert cafe.website == "https://example.com"

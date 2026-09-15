from unittest.mock import Mock

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.road_service import HostedRouter


@pytest.fixture
def client():
    return TestClient(create_app("postgresql://unused"))


def test_ui_and_assets_are_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Use my location" in response.text
    assert response.headers["permissions-policy"] == "geolocation=(self)"
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200


def test_nearby_calls_existing_query_and_preserves_big_ids(client, monkeypatch):
    query = Mock(
        return_value={
            "total": 1,
            "cafes": [
                {
                    "osm_type": "node",
                    "osm_id": 9000000000000000001,
                    "name": "កាហ្វេ",
                    "latitude": 11.5,
                    "longitude": 104.9,
                    "distance_m": 20.5,
                }
            ],
        }
    )
    monkeypatch.setattr("app.repositories.place_repository.nearest_page", query)
    response = client.post("/api/nearby", json={"latitude": 11.5, "longitude": 104.9})
    assert response.status_code == 200
    assert response.json()["cafes"][0]["osm_id"] == "9000000000000000001"
    query.assert_called_once_with("postgresql://unused", 11.5, 104.9, 10, 3000, 1)


@pytest.mark.parametrize(
    "changes",
    [
        {"latitude": 100},
        {"longitude": -181},
        {"latitude": "NaN"},
        {"radius_m": 0},
        {"radius_m": 50001},
        {"limit": 101},
        {"page": 0},
        {"page": 1000001},
        {"limit": 0},
        {"unknown": "value"},
    ],
)
def test_bad_inputs_never_reach_database(client, monkeypatch, changes):
    query = Mock()
    monkeypatch.setattr("app.repositories.place_repository.nearest_page", query)
    response = client.post("/api/nearby", json={"latitude": 11.5, "longitude": 104.9, **changes})
    assert response.status_code == 422
    query.assert_not_called()


def test_unavailable_database_has_safe_error(client, monkeypatch):
    monkeypatch.setattr(
        "app.repositories.place_repository.nearest_page",
        Mock(side_effect=psycopg.OperationalError("secret")),
    )
    response = client.post("/api/nearby", json={"latitude": 11.5, "longitude": 104.9})
    assert response.status_code == 503
    assert "secret" not in response.text


def test_no_results_is_success(client, monkeypatch):
    monkeypatch.setattr(
        "app.repositories.place_repository.nearest_page",
        Mock(return_value={"total": 0, "cafes": []}),
    )
    assert client.post("/api/nearby", json={"latitude": 0, "longitude": 0}).json()["total"] == 0


def test_config_exposes_only_availability_not_key():
    client = TestClient(create_app("unused", HostedRouter("secret-key")))
    response = client.get("/api/config")
    assert response.json()["routing_available"] is True
    assert "secret-key" not in response.text


def test_road_mode_without_key_does_not_silently_fall_back(monkeypatch):
    query = Mock()
    monkeypatch.setattr("app.repositories.place_repository.nearest", query)
    client = TestClient(create_app("unused", HostedRouter()))
    response = client.post(
        "/api/nearby", json={"latitude": 11, "longitude": 104, "distance_mode": "road"}
    )
    assert response.status_code == 503
    query.assert_not_called()


def test_road_search_uses_more_candidates_then_limits(monkeypatch):
    rows = [{"osm_type": "node", "osm_id": i} for i in range(30)]
    query = Mock(return_value=rows)
    monkeypatch.setattr("app.repositories.place_repository.nearest", query)
    router = Mock(available=True)
    router.rank.return_value = list(reversed(rows))
    client = TestClient(create_app("unused", router))
    response = client.post(
        "/api/nearby", json={"latitude": 11, "longitude": 104, "distance_mode": "road", "limit": 5}
    )
    assert response.status_code == 200
    result = response.json()
    assert len(result["cafes"]) == 5
    assert result["cafes"][0]["osm_id"] == "29"
    assert result["candidate_count"] == 30
    query.assert_called_once_with("unused", 11, 104, 30, 3000)


def test_route_uses_cafe_coordinates_from_database(monkeypatch):
    cafe = {"osm_type": "node", "osm_id": 1, "latitude": 11.55, "longitude": 104.92}
    monkeypatch.setattr("app.repositories.place_repository.get_cafe", Mock(return_value=cafe))
    router = Mock(available=True)
    router.directions.return_value = {"distance_m": 123}
    client = TestClient(create_app("unused", router))
    response = client.post(
        "/api/route", json={"latitude": 11, "longitude": 104, "osm_type": "node", "osm_id": "1"}
    )
    assert response.status_code == 200
    router.directions.assert_called_once_with(104, 11, cafe, "walking")
    monkeypatch.setattr("app.repositories.place_repository.get_cafe", Mock(return_value=None))
    assert (
        client.post(
            "/api/route", json={"latitude": 11, "longitude": 104, "osm_type": "node", "osm_id": "1"}
        ).status_code
        == 404
    )


def test_motorbike_profile_is_not_mislabeled_as_supported(client):
    response = client.post(
        "/api/nearby", json={"latitude": 11, "longitude": 104, "profile": "motorbike"}
    )
    assert response.status_code == 422


def test_straight_page_metadata_and_offset(client, monkeypatch):
    query = Mock(return_value={"total": 45, "cafes": [{"osm_id": 23}]})
    monkeypatch.setattr("app.repositories.place_repository.nearest_page", query)
    result = client.post(
        "/api/nearby",
        json={
            "latitude": 11.5,
            "longitude": 104.9,
            "limit": 20,
            "page": 3,
        },
    ).json()
    query.assert_called_once_with("postgresql://unused", 11.5, 104.9, 20, 3000, 3)
    assert result["total"] == 45
    assert result["page"] == result["total_pages"] == 3
    assert result["page_size"] == 20
    assert result["cafes"][0]["osm_id"] == "23"


def test_road_pagination_excludes_unreachable(monkeypatch):
    rows = [{"osm_type": "node", "osm_id": i} for i in range(30)]
    monkeypatch.setattr("app.repositories.place_repository.nearest", Mock(return_value=rows))
    router = Mock(available=True)
    router.rank.return_value = list(reversed(rows[:23]))
    client = TestClient(create_app("unused", router))
    result = client.post(
        "/api/nearby",
        json={
            "latitude": 11,
            "longitude": 104,
            "distance_mode": "road",
            "page": 3,
        },
    ).json()
    assert result["total"] == 23
    assert result["unreachable_count"] == 7
    assert [row["osm_id"] for row in result["cafes"]] == ["2", "1", "0"]
    assert result["total_pages"] == 3


def test_versioned_and_legacy_routes_share_behavior(client, monkeypatch):
    monkeypatch.setattr(
        "app.repositories.place_repository.nearest_page",
        Mock(return_value={"total": 0, "cafes": []}),
    )
    body = {"latitude": 11.5, "longitude": 104.9}
    assert (
        client.post("/api/v1/nearby", json=body).json()
        == client.post("/api/nearby", json=body).json()
    )
    assert client.get("/api/v1/config").json() == client.get("/api/config").json()
    assert client.get("/static/app.js").status_code == 200


def test_name_search_reaches_repository(client, monkeypatch):
    query = Mock(return_value={"total": 0, "cafes": []})
    monkeypatch.setattr("app.repositories.place_repository.nearest_page", query)
    assert (
        client.post(
            "/api/v1/nearby", json={"latitude": 11.5, "longitude": 104.9, "query": "  Luna  "}
        ).status_code
        == 200
    )
    query.assert_called_once_with("postgresql://unused", 11.5, 104.9, 10, 3000, 1, query="Luna")
    assert (
        client.post(
            "/api/v1/nearby", json={"latitude": 11.5, "longitude": 104.9, "query": "a" * 101}
        ).status_code
        == 422
    )


def test_all_results_request(client, monkeypatch):
    query = Mock(return_value={"total": 123, "cafes": []})
    monkeypatch.setattr("app.repositories.place_repository.nearest_page", query)
    response = client.post(
        "/api/v1/nearby", json={"latitude": 11.5, "longitude": 104.9, "limit": "all", "page": 3}
    )
    assert response.status_code == 200
    assert response.json()["page"] == 1
    assert response.json()["page_size"] == 123
    assert response.json()["total_pages"] == 1
    query.assert_called_once_with("postgresql://unused", 11.5, 104.9, None, 3000, 1)

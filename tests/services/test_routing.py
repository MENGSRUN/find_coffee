from unittest.mock import Mock

import pytest
import requests

from app.services.road_service import HostedRouter, RoutingError


@pytest.fixture
def cafes():
    return [
        {
            "osm_type": "node",
            "osm_id": 1,
            "latitude": 11.55,
            "longitude": 104.92,
            "distance_m": 100,
        },
        {"osm_type": "way", "osm_id": 2, "latitude": 11.56, "longitude": 104.93, "distance_m": 200},
        {
            "osm_type": "node",
            "osm_id": 3,
            "latitude": 11.57,
            "longitude": 104.94,
            "distance_m": 300,
        },
    ]


@pytest.fixture
def route_payload():
    return {
        "features": [
            {
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[104.9282, 11.5564], [104.929, 11.557]],
                },
                "properties": {
                    "summary": {"distance": 350, "duration": 270},
                    "segments": [
                        {
                            "steps": [
                                {
                                    "instruction": "Turn left onto Street 123",
                                    "name": "Street 123",
                                    "distance": 350,
                                    "duration": 270,
                                }
                            ]
                        }
                    ],
                },
            }
        ]
    }


def mock_response(monkeypatch, payload, status=200):
    response = Mock(status_code=status)
    response.json.return_value = payload
    post = Mock(return_value=response)
    monkeypatch.setattr("app.services.road_service.requests.post", post)
    return post


def test_matrix_reranks_by_road_distance_and_excludes_unreachable(monkeypatch, cafes):
    post = mock_response(
        monkeypatch, {"distances": [[900, 400, None]], "durations": [[600, 300, None]]}
    )
    rows = HostedRouter("test-key").rank(104.9282, 11.5564, cafes, "walking")
    assert [row["osm_id"] for row in rows] == [2, 1]
    assert rows[0]["distance_m"] == 200
    assert rows[0]["road_distance_m"] == 400
    request = post.call_args
    assert request.args[0] == "https://api.openrouteservice.org/v2/matrix/foot-walking"
    assert request.kwargs["json"]["locations"][0] == [104.9282, 11.5564]
    assert request.kwargs["json"]["destinations"] == ["1", "2", "3"]
    assert request.kwargs["headers"]["Authorization"] == "test-key"
    assert request.kwargs["allow_redirects"] is False
    assert request.kwargs["timeout"] == (5, 20)


def test_route_returns_geometry_distance_time_and_street_steps(monkeypatch, cafes, route_payload):
    post = mock_response(monkeypatch, route_payload)
    result = HostedRouter("test-key").directions(104.9282, 11.5564, cafes[0], "driving")
    assert result["distance_m"] == 350
    assert result["steps"][0]["road"] == "Street 123"
    assert result["geometry"]["type"] == "LineString"
    assert post.call_args.args[0].endswith("/directions/driving-car/geojson")
    assert post.call_args.kwargs["json"]["radiuses"] == [100, 100]


@pytest.mark.parametrize(
    ("status", "expected"), [(401, 503), (403, 503), (429, 429), (500, 503), (400, 422), (302, 503)]
)
def test_provider_errors_do_not_leak_credentials_or_response(monkeypatch, status, expected):
    mock_response(monkeypatch, {"error": "private diagnostic and secret-key"}, status)
    with pytest.raises(RoutingError) as error:
        HostedRouter("secret-key").post("/test", {})
    assert error.value.status == expected
    assert "secret-key" not in str(error.value)


def test_network_failure_has_actionable_error(monkeypatch):
    monkeypatch.setattr(
        "app.services.road_service.requests.post",
        Mock(side_effect=requests.Timeout),
    )
    with pytest.raises(RoutingError, match="could not be reached"):
        HostedRouter("test-key").post("/test", {})


def test_missing_key_and_empty_candidates_do_not_send_request(monkeypatch):
    post = Mock()
    monkeypatch.setattr("app.services.road_service.requests.post", post)
    with pytest.raises(RoutingError, match="not configured"):
        HostedRouter().rank(104, 11, [], "walking")
    assert HostedRouter("test-key").rank(104, 11, [], "walking") == []
    post.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"distances": [[1]], "durations": [[1]]},
        {"distances": [[float("nan"), 1, 2]], "durations": [[1, 2, 3]]},
        {"distances": [[-1, 1, 2]], "durations": [[1, 2, 3]]},
    ],
)
def test_malformed_matrix_is_not_used(monkeypatch, cafes, payload):
    mock_response(monkeypatch, payload)
    with pytest.raises(RoutingError, match="invalid distance matrix"):
        HostedRouter("test-key").rank(104, 11, cafes, "walking")


def test_malformed_geometry_is_rejected(monkeypatch, cafes, route_payload):
    route_payload["features"][0]["geometry"]["coordinates"][0] = [float("inf"), 11]
    mock_response(monkeypatch, route_payload)
    with pytest.raises(RoutingError, match="invalid route"):
        HostedRouter("test-key").directions(104, 11, cafes[0], "walking")

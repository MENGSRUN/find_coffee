from unittest.mock import Mock

import pytest
import requests

from app.exception.errors import RoutingError
from app.service.ors_client import HostedRouter


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
    monkeypatch.setattr("app.service.ors_client.requests.post", post)
    return post


def matrix_payload(distances, durations):
    return {
        "distances": [distances],
        "durations": [durations],
        "sources": [{"snapped_distance": 5}],
        "destinations": [{"snapped_distance": 10} for _ in distances],
    }


def test_matrix_reranks_by_road_distance_and_excludes_unreachable(monkeypatch, cafes):
    post = mock_response(monkeypatch, matrix_payload([900, 400, None], [600, 300, None]))
    rows = HostedRouter("test-key").rank(104.9282, 11.5564, cafes, "walking")
    assert [row["osm_id"] for row in rows] == [2, 1]
    assert rows[0]["distance_m"] == 200
    assert rows[0]["road_distance_m"] == 400
    assert rows[0]["source_snap_distance_m"] == 5
    assert rows[0]["destination_snap_distance_m"] == 10
    request = post.call_args
    assert request.args[0] == "https://api.heigit.org/openrouteservice/v2/matrix/foot-walking"
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
    assert post.call_args.args[0] == (
        "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson"
    )
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
        "app.service.ors_client.requests.post",
        Mock(side_effect=requests.Timeout),
    )
    with pytest.raises(RoutingError, match="could not be reached"):
        HostedRouter("test-key").post("/test", {})


def test_missing_key_and_empty_candidates_do_not_send_request(monkeypatch):
    post = Mock()
    monkeypatch.setattr("app.service.ors_client.requests.post", post)
    with pytest.raises(RoutingError, match="not configured"):
        HostedRouter().rank(104, 11, [], "walking")
    assert HostedRouter("test-key").rank(104, 11, [], "walking") == []
    post.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"distances": [[1]], "durations": [[1]]},
        matrix_payload([float("nan"), 1, 2], [1, 2, 3]),
        matrix_payload([-1, 1, 2], [1, 2, 3]),
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


def test_batches_all_candidates_and_sorts_globally(monkeypatch):
    cafes = [
        {
            "osm_type": "node",
            "osm_id": i,
            "longitude": 104 + i / 100000,
            "latitude": 11.5,
            "distance_m": i,
        }
        for i in range(651)
    ]
    calls = []

    def post(path, body):
        calls.append(body)
        distances = [round((105 - point[0]) * 100000) for point in body["locations"][1:]]
        return matrix_payload(distances, distances)

    router = HostedRouter("test")
    monkeypatch.setattr(router, "post", post)
    ranked = router.rank(104, 11.5, cafes, "driving")
    assert len(ranked) == 651
    assert [len(call["destinations"]) for call in calls] == [500, 151]
    assert all(call["sources"] == ["0"] for call in calls)
    assert ranked[0]["osm_id"] == 650
    assert {row["osm_id"] for row in ranked} == set(range(651))


def test_later_batch_error_does_not_return_partial_rankings(monkeypatch):
    cafes = [
        {"osm_type": "node", "osm_id": i, "longitude": 104, "latitude": 11} for i in range(501)
    ]
    router = HostedRouter("test")
    post = Mock(
        side_effect=[
            matrix_payload([1] * 500, [1] * 500),
            RoutingError("Quota reached", 429),
        ]
    )
    monkeypatch.setattr(router, "post", post)
    with pytest.raises(RoutingError, match="Quota reached"):
        router.rank(104, 11, cafes, "walking")
    assert post.call_count == 2


def test_excludes_far_snaps_and_preserves_100m_boundary(monkeypatch, cafes):
    payload = matrix_payload([20, 40, 30], [10, 20, 15])
    payload["destinations"] = [{"snapped_distance": 500}, {"snapped_distance": 100}, None]
    mock_response(monkeypatch, payload)
    rows = HostedRouter("test").rank(104, 11, cafes, "walking")
    assert [row["osm_id"] for row in rows] == [2]
    assert rows[0]["destination_snap_distance_m"] == 100


@pytest.mark.parametrize("source", [None, {"snapped_distance": 100.01}])
def test_bad_origin_has_actionable_error_before_more_batches(monkeypatch, source):
    cafes = [
        {"osm_type": "node", "osm_id": i, "longitude": 104, "latitude": 11} for i in range(501)
    ]
    payload = matrix_payload([1] * 500, [1] * 500)
    payload["sources"] = [source]
    post = mock_response(monkeypatch, payload)
    with pytest.raises(RoutingError, match="starting location") as error:
        HostedRouter("test").rank(104, 11, cafes, "walking")
    assert error.value.status == 422
    assert post.call_count == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("sources", []),
        ("sources", [{"snapped_distance": float("inf")}]),
        ("destinations", []),
        ("destinations", [{}, {}, {}]),
        ("destinations", [{"snapped_distance": -1}] * 3),
        ("destinations", [{"snapped_distance": True}] * 3),
        ("destinations", None),
    ],
)
def test_missing_or_invalid_snap_metadata_is_not_ranked(monkeypatch, cafes, field, value):
    payload = matrix_payload([1, 2, 3], [1, 2, 3])
    payload[field] = value
    mock_response(monkeypatch, payload)
    with pytest.raises(RoutingError, match="invalid distance matrix"):
        HostedRouter("test").rank(104, 11, cafes, "walking")


def test_missing_snap_metadata_is_not_assumed_to_be_zero(monkeypatch, cafes):
    mock_response(monkeypatch, {"distances": [[1, 2, 3]], "durations": [[1, 2, 3]]})
    with pytest.raises(RoutingError, match="invalid distance matrix"):
        HostedRouter("test").rank(104, 11, cafes, "walking")


def test_forbidden_does_not_misdiagnose_quota_as_invalid_key(monkeypatch):
    mock_response(monkeypatch, {"error": "private provider diagnostic"}, 403)
    with pytest.raises(RoutingError, match="daily quota") as error:
        HostedRouter("test-key").post("/test", {})
    assert "account.heigit.org" in str(error.value)
    assert "private provider diagnostic" not in str(error.value)

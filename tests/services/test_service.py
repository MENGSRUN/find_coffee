"""Verify use cases without an HTTP server, database, or external routing calls."""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_coffee_service
from app.main import create_app
from app.models.location import NearbyQuery, RouteQuery
from app.services.place_service import CoffeeService
from app.services.road_service import HostedRouter, RoadService
from app.utils.response import CafeNotFound, SearchNotConfigured


def test_service_can_run_without_fastapi_and_preserves_page():
    repository = Mock(configured=True)
    repository.nearest_page.return_value = {"total": 25, "cafes": [{"osm_id": 9000000000000000001}]}
    routing = Mock()
    service = CoffeeService(repository, routing)
    result = service.nearby(NearbyQuery(latitude=11.5, longitude=104.9, page=3))
    assert result["page"] == 3
    assert result["total_pages"] == 3
    assert result["cafes"][0]["osm_id"] == "9000000000000000001"
    repository.nearest_page.assert_called_once_with(11.5, 104.9, 10, 3000, 3)
    routing.rank.assert_not_called()


def test_service_rejects_unconfigured_search_before_repository():
    repository = Mock(configured=False)
    with pytest.raises(SearchNotConfigured):
        CoffeeService(repository, Mock()).nearby(NearbyQuery(latitude=0, longitude=0))
    repository.nearest_page.assert_not_called()


def test_missing_cafe_never_calls_directions():
    repository = Mock(configured=True)
    repository.get_cafe.return_value = None
    routing = Mock()
    with pytest.raises(CafeNotFound):
        RoadService(repository, routing).route(
            RouteQuery(latitude=0, longitude=0, osm_type="node", osm_id=1)
        )
    routing.directions.assert_not_called()


def test_controller_dependency_override_and_validation():
    app = create_app("unused", HostedRouter())
    service = Mock()
    service.nearby.return_value = {"cafes": [], "total": 0}
    app.dependency_overrides[get_coffee_service] = lambda: service
    with TestClient(app) as client:
        response = client.post("/api/nearby", json={"latitude": 11.5, "longitude": 104.9})
        assert response.json() == {"cafes": [], "total": 0}
        assert isinstance(service.nearby.call_args.args[0], NearbyQuery)
        service.reset_mock()
        assert client.post("/api/nearby", json={"latitude": 100, "longitude": 0}).status_code == 422
        service.nearby.assert_not_called()


def test_app_instances_are_independent():
    first = create_app("first", HostedRouter())
    second = create_app("second", HostedRouter())
    assert first.state.coffee_service is not second.state.coffee_service
    assert first.state.coffee_service.repository.dsn == "first"
    assert second.state.coffee_service.repository.dsn == "second"


def test_factory_accepts_routing_contract_without_ors_inheritance():
    class AlternativeRouter:
        provider = "test-routing-provider"
        available = True

        def require_key(self):
            pass

        def rank(self, longitude, latitude, cafes, profile):
            return cafes

        def directions(self, longitude, latitude, cafe, profile):
            return {"distance_m": 123}

    adapter = AlternativeRouter()
    app = create_app("unused", adapter)
    with TestClient(app) as client:
        assert client.get("/api/config").json() == {
            "routing_available": True,
            "routing_provider": "test-routing-provider",
        }
    assert app.state.coffee_service.routing is adapter

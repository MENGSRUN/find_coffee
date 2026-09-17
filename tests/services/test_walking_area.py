from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.exception.errors import RoutingError
from app.model.projection.search_query import NearbyQuery
from app.model.request.place_request import NearbyRequest
from app.service.ors_client import HostedRouter
from app.service.place_service import CoffeeService

AREA = {
    "type": "Polygon",
    "coordinates": [[[104.9, 11.5], [105, 11.5], [105, 11.6], [104.9, 11.5]]],
}


def test_walking_area_uses_seconds_and_longitude_first():
    router = HostedRouter("test")
    router.post = Mock(return_value={"features": [{"geometry": AREA}]})
    assert router.walking_area(104.9, 11.5, 10) == AREA
    router.post.assert_called_once_with(
        "/v2/isochrones/foot-walking",
        {
            "locations": [[104.9, 11.5]],
            "range": [600],
            "range_type": "time",
            "location_type": "start",
        },
    )


@pytest.mark.parametrize(
    "geometry",
    [
        None,
        {},
        {"type": "Point", "coordinates": [0, 0]},
        {"type": "Polygon", "coordinates": []},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [999, 0], [1, 1], [0, 0]]]},
    ],
)
def test_invalid_areas_are_provider_errors(geometry):
    router = HostedRouter("test")
    router.post = Mock(return_value={"features": [{"geometry": geometry}]})
    with pytest.raises(RoutingError, match="invalid walking area"):
        router.walking_area(104.9, 11.5, 10)


def test_area_search_uses_polygon_not_radius_or_matrix():
    repo, routing = Mock(configured=True), Mock()
    routing.walking_area.return_value = AREA
    repo.within_area.return_value = {"total": 22, "cafes": [{"osm_id": 42}]}
    result = CoffeeService(repo, routing).nearby(
        NearbyQuery(
            latitude=11.5,
            longitude=104.9,
            distance_mode="walk_area",
            walk_minutes=15,
            profile="driving",
            radius_m=500,
            page=2,
            query=" Test ",
        )
    )
    routing.walking_area.assert_called_once_with(104.9, 11.5, 15)
    repo.within_area.assert_called_once_with(11.5, 104.9, AREA, 10, 2, query="Test")
    repo.nearest_page.assert_not_called()
    routing.rank.assert_not_called()
    assert result["profile"] == "walking"
    assert result["total_pages"] == 3
    assert result["cafes"][0]["osm_id"] == "42"
    assert result["area"] == AREA


def test_time_choice_is_validated():
    with pytest.raises(ValidationError):
        NearbyRequest(latitude=0, longitude=0, distance_mode="walk_area", walk_minutes=60)

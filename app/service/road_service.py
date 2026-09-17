"""Road use case and hosted openrouteservice integration."""

from app.exception.errors import CafeNotFound, SearchNotConfigured
from app.model.projection.search_query import RouteQuery
from app.model.response.cafe_response import cafe_response
from app.repository.contracts import CoffeeRepository
from app.service.routing_gateway import RoutingGateway


class RoadService:
    def __init__(self, repository: CoffeeRepository, routing: RoutingGateway):
        self.repository = repository
        self.routing = routing

    def route(self, body: RouteQuery) -> dict:
        if not self.repository.configured:
            raise SearchNotConfigured("Coffee search is not configured yet.")
        self.routing.require_key()
        cafe = self.repository.get_cafe(body.osm_type, body.osm_id)
        if cafe is None:
            raise CafeNotFound("This café is no longer in the dataset.")
        result = self.routing.directions(body.longitude, body.latitude, cafe, body.profile)
        return {**result, "cafe": cafe_response(cafe)}

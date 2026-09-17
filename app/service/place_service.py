"""Café search and route use cases; no FastAPI or HTTP dependencies."""

from app.base.pagination import total_pages
from app.exception.errors import SearchNotConfigured
from app.model.projection.search_query import NearbyQuery
from app.model.response.cafe_response import cafe_response
from app.repository.contracts import CoffeeRepository
from app.service.routing_gateway import RoutingGateway


class CoffeeService:
    def __init__(self, repository: CoffeeRepository, routing: RoutingGateway):
        self.repository = repository
        self.routing = routing

    def configuration(self) -> dict:
        return {
            "routing_available": self.routing.available,
            "routing_provider": self.routing.provider,
        }

    def nearby(self, body: NearbyQuery) -> dict:
        if not self.repository.configured:
            raise SearchNotConfigured(
                "Coffee search is not configured yet. Please try again later."
            )
        limit = None if body.limit == "all" else body.limit
        page = 1 if limit is None else body.page
        query = body.query.strip()
        if body.distance_mode == "road":
            self.routing.require_key()
            filters = {"query": query} if query else {}
            rows = self.repository.nearest_page(
                body.latitude, body.longitude, None, body.radius_m, 1, **filters
            )["cafes"]
            ranked = self.routing.rank(body.longitude, body.latitude, rows, body.profile)
            offset = (page - 1) * (limit or 0)
            return {
                "cafes": [
                    cafe_response(row)
                    for row in ranked[offset : None if limit is None else offset + limit]
                ],
                "total": len(ranked),
                "page": page,
                "page_size": len(ranked) if limit is None else limit,
                "total_pages": total_pages(len(ranked), limit),
                "distance_mode": "road",
                "profile": body.profile,
                "candidate_count": len(rows),
                "unreachable_count": len(rows) - len(ranked),
                "candidate_limit": None,
            }
        filters = {"query": query} if query else {}
        result = self.repository.nearest_page(
            body.latitude, body.longitude, limit, body.radius_m, page, **filters
        )
        return {
            **result,
            "cafes": [cafe_response(row) for row in result["cafes"]],
            "distance_mode": "straight",
            "page": page,
            "page_size": result["total"] if limit is None else limit,
            "total_pages": total_pages(result["total"], limit),
        }

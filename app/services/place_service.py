"""Café search and route use cases; no FastAPI or HTTP dependencies."""

from app.models.location import NearbyQuery
from app.models.place import CoffeeRepository
from app.models.road import RoutingGateway
from app.utils.pagination import total_pages
from app.utils.response import SearchNotConfigured, cafe_response

CANDIDATE_LIMIT = 30


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
            if query:
                rows = self.repository.nearest_page(
                    body.latitude,
                    body.longitude,
                    CANDIDATE_LIMIT,
                    body.radius_m,
                    1,
                    query=query,
                )["cafes"]
            else:
                rows = self.repository.nearest(
                    body.latitude, body.longitude, CANDIDATE_LIMIT, body.radius_m
                )
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
                "candidate_limit": CANDIDATE_LIMIT,
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

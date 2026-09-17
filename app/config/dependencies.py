"""FastAPI dependency injection bridge to application-scoped services."""

from fastapi import Request

from app.service.place_service import CoffeeService
from app.service.road_service import RoadService


def get_coffee_service(request: Request) -> CoffeeService:
    return request.app.state.coffee_service


def get_road_service(request: Request) -> RoadService:
    return request.app.state.road_service

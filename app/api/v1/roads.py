"""Hosted road route requests; no locally stored road network."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_road_service
from app.models.location import RouteQuery
from app.schemas.road import RouteRequest
from app.services.road_service import RoadService

router = APIRouter(tags=["roads"])


@router.post("/route")
def route(body: RouteRequest, service: Annotated[RoadService, Depends(get_road_service)]):
    return service.route(RouteQuery(**body.model_dump()))

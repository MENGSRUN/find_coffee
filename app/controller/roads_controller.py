"""Hosted road route requests; no locally stored road network."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.config.dependencies import get_road_service
from app.model.projection.search_query import RouteQuery
from app.model.request.road_request import RouteRequest
from app.service.road_service import RoadService

router = APIRouter(tags=["roads"])


@router.post("/route")
def route(body: RouteRequest, service: Annotated[RoadService, Depends(get_road_service)]):
    return service.route(RouteQuery(**body.model_dump()))

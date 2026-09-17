"""Place searches, including café proximity and road-distance ranking."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.config.dependencies import get_coffee_service
from app.model.projection.search_query import NearbyQuery
from app.model.request.place_request import NearbyRequest
from app.service.place_service import CoffeeService

router = APIRouter(tags=["places"])
Service = Annotated[CoffeeService, Depends(get_coffee_service)]


@router.get("/config")
def configuration(service: Service):
    return service.configuration()


@router.post("/nearby")
def nearby(body: NearbyRequest, service: Service):
    return service.nearby(NearbyQuery(**body.model_dump()))

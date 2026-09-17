"""Version-one API assembly; the factory also mounts legacy /api aliases."""

from fastapi import APIRouter

from app.controller import places_controller as places
from app.controller import roads_controller as roads

router = APIRouter()
router.include_router(places.router)
router.include_router(roads.router)

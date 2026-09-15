"""Version-one API assembly; the factory also mounts legacy /api aliases."""

from fastapi import APIRouter

from app.api.v1 import places, roads

router = APIRouter()
router.include_router(places.router)
router.include_router(roads.router)

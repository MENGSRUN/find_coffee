"""Serve the map view, analogous to a Spring MVC page controller."""

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.config.settings import STATIC

router = APIRouter()


@router.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")

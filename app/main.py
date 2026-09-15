"""Wire the FastAPI application, services, and repositories."""

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import router as coffee_controller
from app.core.config import STATIC, Settings
from app.core.security import configure_http, register_exception_handlers
from app.models.place import CoffeeRepository
from app.models.road import RoutingGateway
from app.repositories.place_repository import (
    CoffeeRepository as PostgisCoffeeRepository,
)
from app.services.place_service import CoffeeService
from app.services.road_service import HostedRouter, RoadService


def create_app(dsn: str | None = None, router: RoutingGateway | None = None) -> FastAPI:
    settings = Settings.load()
    repository: CoffeeRepository = PostgisCoffeeRepository(dsn or settings.database_url)
    routing = router if router is not None else HostedRouter(settings.ors_api_key)
    app = FastAPI(title="Find Coffee", version="0.1.0", docs_url=None, redoc_url=None)
    app.state.coffee_service = CoffeeService(repository, routing)
    app.state.road_service = RoadService(repository, routing)
    configure_http(app)
    register_exception_handlers(app)

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    app.include_router(coffee_controller.router, prefix="/api/v1")
    app.include_router(coffee_controller.router, prefix="/api", include_in_schema=False)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app

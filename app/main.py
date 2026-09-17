"""Wire the FastAPI application, services, and repositories."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config.settings import STATIC, Settings
from app.controller import router as coffee_controller
from app.controller.web_controller import router as web_controller
from app.exception.handlers import register_exception_handlers
from app.repository.contracts import CoffeeRepository
from app.repository.place_repository import (
    CoffeeRepository as PostgisCoffeeRepository,
)
from app.security.http_security import configure_http
from app.service.ors_client import HostedRouter
from app.service.place_service import CoffeeService
from app.service.road_service import RoadService
from app.service.routing_gateway import RoutingGateway


def create_app(dsn: str | None = None, router: RoutingGateway | None = None) -> FastAPI:
    settings = Settings.load()
    repository: CoffeeRepository = PostgisCoffeeRepository(dsn or settings.database_url)
    routing = router if router is not None else HostedRouter(settings.ors_api_key)
    app = FastAPI(title="Find Coffee", version="0.1.0", docs_url=None, redoc_url=None)
    app.state.coffee_service = CoffeeService(repository, routing)
    app.state.road_service = RoadService(repository, routing)
    configure_http(app)
    register_exception_handlers(app)

    app.include_router(web_controller)

    app.include_router(coffee_controller.router, prefix="/api/v1")
    app.include_router(coffee_controller.router, prefix="/api", include_in_schema=False)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


# Standard ASGI entry point: uvicorn app.main:app
app = create_app()

"""HTTP headers and error handling."""

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.utils.response import CafeNotFound, RoutingError, SearchNotConfigured


def configure_http(app: FastAPI) -> None:
    @app.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Permissions-Policy"] = "geolocation=(self)"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https://tile.openstreetmap.org; "
            "connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        return response


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(SearchNotConfigured)
    async def not_configured(request: Request, exc: SearchNotConfigured):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(CafeNotFound)
    async def not_found(request: Request, exc: CafeNotFound):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(RoutingError)
    async def routing_error(request: Request, exc: RoutingError):
        return JSONResponse(status_code=exc.status, content={"detail": str(exc)})

    @app.exception_handler(psycopg.Error)
    async def database_error(request: Request, exc: psycopg.Error):
        return JSONResponse(
            status_code=503,
            content={"detail": "Coffee search is temporarily unavailable. Please try again."},
        )

"""HTTP headers and error handling."""

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.exception.errors import CafeNotFound, RoutingError, SearchNotConfigured


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        # Raw input/context may contain infinity or NaN, which JSONResponse cannot encode.
        # Keep useful field diagnostics without echoing the request body.
        detail = [{key: error[key] for key in ("type", "loc", "msg")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})

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

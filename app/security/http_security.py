"""Browser security and privacy headers."""

from fastapi import FastAPI


def configure_http(app: FastAPI) -> None:
    @app.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Permissions-Policy"] = (
            "geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https://tile.openstreetmap.org; "
            "connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        )
        return response

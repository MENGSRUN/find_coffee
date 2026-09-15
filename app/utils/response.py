"""Response serialization and safe application errors."""


def cafe_response(row: dict) -> dict:
    return {**row, "osm_id": str(row["osm_id"])}


class SearchNotConfigured(Exception):
    pass


class CafeNotFound(Exception):
    pass


class RoutingError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status

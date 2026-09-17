"""Repository contract used by services and implemented by PostGIS."""

from typing import Protocol


class CoffeeRepository(Protocol):
    @property
    def configured(self) -> bool: ...

    def nearest(
        self, latitude: float, longitude: float, limit: int, radius_m: float
    ) -> list[dict]: ...

    def nearest_page(
        self,
        latitude: float,
        longitude: float,
        limit: int | None,
        radius_m: float,
        page: int,
        query: str = "",
    ) -> dict: ...

    def get_cafe(self, osm_type: str, osm_id: int) -> dict | None: ...

"""Routing capability needed by the use cases, independent of its provider."""

from typing import Protocol


class RoutingGateway(Protocol):
    @property
    def provider(self) -> str: ...

    @property
    def available(self) -> bool: ...

    def require_key(self) -> None: ...

    def rank(
        self, longitude: float, latitude: float, cafes: list[dict], profile: str
    ) -> list[dict]: ...

    def walking_area(self, longitude: float, latitude: float, minutes: int) -> dict: ...

    def directions(self, longitude: float, latitude: float, cafe: dict, profile: str) -> dict: ...

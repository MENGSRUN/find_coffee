"""Immutable use-case inputs; HTTP validation belongs to interface schemas."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class NearbyQuery:
    latitude: float
    longitude: float
    query: str = ""
    radius_m: float = 3000
    limit: int | Literal["all"] = 10
    page: int = 1
    distance_mode: Literal["straight", "road"] = "straight"
    profile: Literal["walking", "driving"] = "walking"


@dataclass(frozen=True)
class RouteQuery:
    latitude: float
    longitude: float
    osm_type: Literal["node", "way", "relation"]
    osm_id: int
    profile: Literal["walking", "driving"] = "walking"

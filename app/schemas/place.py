"""Validated HTTP request DTOs (similar to Spring @Valid request bodies)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class NearbyRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    query: Annotated[str, Field(max_length=100)] = ""
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    radius_m: Annotated[float, Field(gt=0, le=50000)] = 3000
    limit: Annotated[int, Field(ge=1, le=100)] | Literal["all"] = 10
    page: Annotated[int, Field(ge=1, le=1000000)] = 1
    distance_mode: Literal["straight", "road"] = "straight"
    profile: Literal["walking", "driving"] = "walking"

"""Validated route input."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class RouteRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    osm_type: Literal["node", "way", "relation"]
    osm_id: Annotated[int, Field(gt=0, le=9223372036854775807)]
    profile: Literal["walking", "driving"] = "walking"

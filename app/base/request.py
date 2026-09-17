"""Shared validation policy for HTTP request DTOs."""

from pydantic import BaseModel, ConfigDict


class BaseRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")

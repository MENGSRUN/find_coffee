"""Coordinate validation for WGS84 point data."""

import math
from typing import Any


def coordinate(value: Any, name: str, bound: float) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    try:
        number = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not math.isfinite(number) or not -bound <= number <= bound:
        raise ValueError(f"{name} must be finite and between {-bound:g} and {bound:g}")
    return number

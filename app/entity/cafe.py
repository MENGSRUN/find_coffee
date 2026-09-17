"""Café model and persistence contract."""

from dataclasses import asdict, dataclass
from typing import Any

from app.utils.gis.geometry import coordinate as coordinate


@dataclass(frozen=True)
class Cafe:
    osm_type: str
    osm_id: int
    name: str
    name_en: str
    name_km: str
    latitude: float
    longitude: float
    address: str | None = None
    opening_hours: str | None = None
    phone: str | None = None
    website: str | None = None

    @classmethod
    def from_mapping(cls, row: dict[str, Any]) -> "Cafe":
        kind = row.get("osm_type")
        if kind not in ("node", "way", "relation"):
            raise ValueError("osm_type must be node, way, or relation")
        identifier = str(row.get("osm_id", ""))
        if not identifier.isascii() or not identifier.isdigit():
            raise ValueError("osm_id must be a positive integer")
        osm_id = int(identifier)
        if not 0 < osm_id <= 9223372036854775807:
            raise ValueError("osm_id must fit a positive PostgreSQL BIGINT")
        names = []
        for field in ("name", "name_en", "name_km"):
            value = row.get(field)
            if value is None:
                value = ""
            if not isinstance(value, str) or "\x00" in value:
                raise ValueError(f"{field} must be text without NUL characters")
            names.append(value.strip())
        details = []
        for field in ("address", "opening_hours", "phone", "website"):
            value = row.get(field)
            if value is not None:
                if not isinstance(value, str) or "\x00" in value:
                    raise ValueError(f"{field} must be text without NUL characters")
                value = value.strip() or None
            details.append(value)
        return cls(
            kind,
            osm_id,
            *names,
            coordinate(row.get("latitude"), "latitude", 90),
            coordinate(row.get("longitude"), "longitude", 180),
            *details,
        )

    def values(self) -> tuple:
        return tuple(asdict(self).values())

"""One country-level Overpass request, followed by local CSV and GeoJSON exports."""

import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import requests

from app.utils.gis.geojson import Cafe, unique_cafes, write_csv, write_geojson

DEFAULT_OVERPASS_URL = "https://overpass.private.coffee/api/interpreter"
OVERPASS_QUERY = """[out:json][timeout:120];
area["ISO3166-1"="KH"]["admin_level"="2"]->.cambodia;
nwr["amenity"="cafe"](area.cambodia);
out center;
"""


def normalize_overpass(payload: dict) -> list[Cafe]:
    if not isinstance(payload, dict):
        raise ValueError("Overpass returned an unexpected response")
    if payload.get("remark"):
        raise ValueError(f"Overpass reported an error; refusing partial data: {payload['remark']}")
    if not isinstance(payload.get("elements"), list):
        raise ValueError("Overpass response is missing its elements list")
    cafes = []
    for element in payload["elements"]:
        if not isinstance(element, dict):
            raise ValueError("Overpass returned an invalid element")
        tags = element.get("tags", {})
        if not isinstance(tags, dict):
            raise ValueError("Overpass returned invalid tags")
        position = element if element.get("type") == "node" else element.get("center", {})
        if not isinstance(position, dict):
            raise ValueError("Overpass returned invalid coordinates")
        address_fields = (
            "addr:housenumber",
            "addr:street",
            "addr:suburb",
            "addr:city",
            "addr:postcode",
        )
        address_parts = [tags.get(field, "") for field in address_fields]
        if any(not isinstance(part, str) for part in address_parts):
            raise ValueError("Overpass returned invalid address tags")
        cafes.append(
            Cafe.from_mapping(
                {
                    "osm_type": element.get("type"),
                    "osm_id": element.get("id"),
                    "name": tags.get("name", ""),
                    "name_en": tags.get("name:en", ""),
                    "name_km": tags.get("name:km", ""),
                    "latitude": position.get("lat"),
                    "longitude": position.get("lon"),
                    "address": tags.get("addr:full") or ", ".join(p for p in address_parts if p),
                    "opening_hours": tags.get("opening_hours", ""),
                    "phone": tags.get("contact:phone") or tags.get("phone", ""),
                    "website": tags.get("contact:website") or tags.get("website", ""),
                }
            )
        )
    if not cafes:
        raise ValueError("Overpass returned no cafés; existing files were not changed")
    return unique_cafes(cafes)


def download(output_dir: Path, endpoint: str, overwrite: bool = False) -> int:
    filenames = ("cambodia_cafes.csv", "cambodia_cafes.geojson", "metadata.json")
    if not overwrite and any((output_dir / name).exists() for name in filenames):
        raise ValueError("Output files already exist. Use --overwrite to refresh them")
    response = requests.post(
        endpoint,
        data={"data": OVERPASS_QUERY},
        headers={"User-Agent": "find-coffee-cambodia/0.1 (educational data download)"},
        timeout=(15, 180),
    )
    response.raise_for_status()
    payload = response.json()
    cafes = normalize_overpass(payload)
    metadata = {
        "source": "OpenStreetMap via Overpass API",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "license_url": "https://www.openstreetmap.org/copyright",
        "downloaded_at": datetime.now(UTC).isoformat(),
        "osm_base_timestamp": payload.get("osm3s", {}).get("timestamp_osm_base"),
        "endpoint": endpoint,
        "query": OVERPASS_QUERY,
        "count": len(cafes),
        "coordinates": "WGS84; ways and relations use bounding-box centers, not entrances",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    # Build all files first; each rename replaces a complete file on the same filesystem.
    with tempfile.TemporaryDirectory(dir=output_dir) as temporary:
        staging = Path(temporary)
        write_csv(staging / filenames[0], cafes)
        write_geojson(staging / filenames[1], cafes)
        (staging / filenames[2]).write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        for name in filenames:
            (staging / name).replace(output_dir / name)
    return len(cafes)

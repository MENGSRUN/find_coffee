"""Validate and exchange point-based café records without GIS dependencies."""

import csv
import json
from dataclasses import asdict
from pathlib import Path

from app.models.place import Cafe as Cafe
from app.models.place import coordinate as coordinate

FIELDS = ("osm_type", "osm_id", "name", "name_en", "name_km", "latitude", "longitude")


def unique_cafes(cafes: list[Cafe]) -> list[Cafe]:
    """Collapse exact repeats, but never silently choose between conflicting records."""
    by_id = {}
    for cafe in cafes:
        key = (cafe.osm_type, cafe.osm_id)
        if key in by_id and by_id[key] != cafe:
            raise ValueError(f"Conflicting records for {cafe.osm_type}/{cafe.osm_id}")
        by_id[key] = cafe
    return list(by_id.values())


def read_cafes(path: Path) -> list[Cafe]:
    cafes = []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        if path.suffix.lower() == ".csv":
            reader = csv.DictReader(stream)
            if not set(FIELDS).issubset(reader.fieldnames or []):
                raise ValueError(f"CSV must contain these columns: {', '.join(FIELDS)}")
            for number, row in enumerate(reader, start=2):
                if None in row or any(row[field] is None for field in FIELDS):
                    raise ValueError(f"CSV row {number}: incorrect number of columns")
                try:
                    cafes.append(Cafe.from_mapping(row))
                except ValueError as exc:
                    raise ValueError(f"CSV row {number}: {exc}") from exc
        elif path.suffix.lower() in (".geojson", ".json"):
            payload = json.load(stream)
            if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
                raise ValueError("GeoJSON must be a FeatureCollection")
            if "crs" in payload:
                raise ValueError("Use WGS84 GeoJSON without a legacy crs member")
            features = payload.get("features")
            if not isinstance(features, list):
                raise ValueError("GeoJSON features must be a list")
            for number, feature in enumerate(features, start=1):
                try:
                    if not isinstance(feature, dict) or feature.get("type") != "Feature":
                        raise ValueError("expected a Feature")
                    geometry = feature.get("geometry")
                    if not isinstance(geometry, dict) or geometry.get("type") != "Point":
                        raise ValueError("only Point geometries are supported; use our downloader")
                    coords = geometry.get("coordinates")
                    if not isinstance(coords, list) or len(coords) != 2:
                        raise ValueError("expected [longitude, latitude]")
                    props = feature.get("properties")
                    if not isinstance(props, dict):
                        raise ValueError("properties must contain the café fields")
                    cafes.append(
                        Cafe.from_mapping(
                            {
                                **props,
                                "longitude": coords[0],
                                "latitude": coords[1],
                            }
                        )
                    )
                except ValueError as exc:
                    raise ValueError(f"GeoJSON feature {number}: {exc}") from exc
        else:
            raise ValueError("Use a .csv, .geojson, or .json file")
    if not cafes:
        raise ValueError("Dataset contains no cafés; nothing was imported")
    return unique_cafes(cafes)


def write_csv(path: Path, cafes: list[Cafe]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(asdict(cafe) for cafe in cafes)


def write_geojson(path: Path, cafes: list[Cafe]) -> None:
    features = []
    for cafe in cafes:
        props = asdict(cafe)
        lon, lat = props.pop("longitude"), props.pop("latitude")
        features.append(
            {
                "type": "Feature",
                "id": f"{cafe.osm_type}/{cafe.osm_id}",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    payload = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

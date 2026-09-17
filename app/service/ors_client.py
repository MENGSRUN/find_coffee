"""Hosted openrouteservice HTTP adapter."""

import logging
import math

import requests

from app.constant.routing import MAX_SNAP_DISTANCE_M, ORS_URL, PROFILES
from app.exception.errors import RoutingError

logger = logging.getLogger(__name__)


def metric(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Invalid routing metric")
    if not math.isfinite(value) or value < 0:
        raise ValueError("Invalid routing metric")
    return float(value)


class HostedRouter:
    @property
    def provider(self) -> str:
        return "openrouteservice"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key.strip()

    @property
    def available(self):
        return bool(self.api_key)

    def require_key(self):
        if not self.available:
            raise RoutingError(
                "Road routing is not configured. Add ORS_API_KEY to .env and restart the app.", 503
            )

    def post(self, path: str, body: dict):
        self.require_key()
        # Isochrones and GeoJSON directions negotiate a different media type than matrices.
        accept = (
            "application/geo+json"
            if path.startswith("/v2/isochrones/") or path.endswith("/geojson")
            else "application/json"
        )
        try:
            response = requests.post(
                ORS_URL + path,
                headers={
                    "Authorization": self.api_key,
                    "Accept": accept,
                    "User-Agent": "find-coffee-cambodia/0.1",
                },
                json=body,
                timeout=(5, 20),
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise RoutingError(
                "The routing service could not be reached. Please try again.", 503
            ) from exc
        if response.status_code != 200:
            # Do not log request headers, coordinates, or provider response bodies.
            logger.warning("ORS endpoint %s returned HTTP %s", path, response.status_code)
        if response.status_code == 401:
            raise RoutingError(
                "The routing API key was rejected. Check the server configuration.", 503
            )
        if response.status_code == 403:
            raise RoutingError(
                "ORS access was denied: the daily quota may be exhausted, or the API key "
                "may not have access. Check your key and quota at account.heigit.org.",
                503,
            )
        if response.status_code == 429:
            raise RoutingError(
                "The routing service limit was reached. Wait before trying again.", 429
            )
        if response.status_code in (400, 404):
            if path.startswith("/v2/isochrones/"):
                raise RoutingError(
                    "ORS could not calculate a walking area here "
                    f"(HTTP {response.status_code}). Try a nearby starting point "
                    "or Explore central Phnom Penh.",
                    422,
                )
            raise RoutingError(
                "No route could be calculated for these locations. Try another café.", 422
            )
        if response.status_code != 200:
            if path.startswith("/v2/isochrones/"):
                raise RoutingError(
                    f"ORS could not return the walking area (HTTP {response.status_code}). "
                    "Try again shortly. If it keeps failing, try Explore central Phnom Penh "
                    "to check whether the problem is specific to this starting point.",
                    503,
                )
            raise RoutingError(
                "The routing service is temporarily unavailable "
                f"(HTTP {response.status_code}). Please try again.",
                503,
            )
        try:
            payload = response.json()
            if not isinstance(payload, dict) or "error" in payload:
                raise ValueError("Invalid response")
            return payload
        except ValueError as exc:
            raise RoutingError("The routing service returned an invalid response.") from exc

    def walking_area(self, longitude: float, latitude: float, minutes: int) -> dict:
        """Return a validated WGS84 polygon for an estimated walk from the origin."""
        payload = self.post(
            "/v2/isochrones/foot-walking",
            {
                "locations": [[longitude, latitude]],
                "range": [minutes * 60],
                "range_type": "time",
                "location_type": "start",
            },
        )
        try:
            features = payload["features"]
            if not isinstance(features, list) or len(features) != 1:
                raise ValueError("Expected one walking area")
            geometry = features[0]["geometry"]
            kind, coordinates = geometry["type"], geometry["coordinates"]
            if kind not in ("Polygon", "MultiPolygon") or not coordinates:
                raise ValueError("Missing polygon")
            polygons = [coordinates] if kind == "Polygon" else coordinates
            for polygon in polygons:
                if not isinstance(polygon, list) or not polygon:
                    raise ValueError("Empty polygon")
                for ring in polygon:
                    if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                        raise ValueError("Unclosed ring")
                    for point in ring:
                        if (
                            not isinstance(point, list)
                            or len(point) != 2
                            or any(
                                isinstance(v, bool)
                                or not isinstance(v, (int, float))
                                or not math.isfinite(v)
                                for v in point
                            )
                            or not -180 <= point[0] <= 180
                            or not -90 <= point[1] <= 90
                        ):
                            raise ValueError("Invalid polygon point")
            return {"type": kind, "coordinates": coordinates}
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise RoutingError("The routing service returned an invalid walking area.") from exc

    def rank(self, longitude: float, latitude: float, cafes: list[dict], profile: str):
        self.require_key()
        results = []
        # One origin × at most 500 destinations, below ORS's 3,500-pair limit.
        # This is a request batch size, not a limit on total search results.
        for offset in range(0, len(cafes), 500):
            results.extend(
                self._rank_batch(longitude, latitude, cafes[offset : offset + 500], profile)
            )
        return sorted(results, key=lambda c: (c["road_distance_m"], c["osm_type"], c["osm_id"]))

    def _rank_batch(self, longitude: float, latitude: float, cafes: list[dict], profile: str):
        payload = self.post(
            f"/v2/matrix/{PROFILES[profile]}",
            {
                "locations": [[longitude, latitude]]
                + [[c["longitude"], c["latitude"]] for c in cafes],
                "sources": ["0"],
                "destinations": [str(i) for i in range(1, len(cafes) + 1)],
                "metrics": ["distance", "duration"],
                "units": "m",
            },
        )
        try:
            distances, durations = payload["distances"], payload["durations"]
            if len(distances) != 1 or len(durations) != 1:
                raise ValueError("Invalid matrix")
            if len(distances[0]) != len(cafes) or len(durations[0]) != len(cafes):
                raise ValueError("Invalid matrix")
            sources, destinations = payload["sources"], payload["destinations"]
            if not isinstance(sources, list) or not isinstance(destinations, list):
                raise ValueError("Invalid snapping metadata")
            if len(sources) != 1 or len(destinations) != len(cafes):
                raise ValueError("Invalid snapping metadata")
            source_snap = None if sources[0] is None else metric(sources[0]["snapped_distance"])
            if source_snap is None or source_snap > MAX_SNAP_DISTANCE_M:
                raise RoutingError(
                    "Your starting location is more than 100 m from a routable road or path. "
                    "Choose a location nearer a road, or use straight-line search.",
                    422,
                )
            results = []
            for cafe, distance, duration, destination in zip(
                cafes, distances[0], durations[0], destinations, strict=True
            ):
                destination_snap = (
                    None if destination is None else metric(destination["snapped_distance"])
                )
                if (
                    distance is None
                    or duration is None
                    or destination_snap is None
                    or destination_snap > MAX_SNAP_DISTANCE_M
                ):
                    continue  # Unreachable, never substitute a straight-line estimate.
                results.append(
                    {
                        **cafe,
                        "road_distance_m": metric(distance),
                        "duration_s": metric(duration),
                        "source_snap_distance_m": source_snap,
                        "destination_snap_distance_m": destination_snap,
                    }
                )
            return sorted(results, key=lambda c: (c["road_distance_m"], c["osm_type"], c["osm_id"]))
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise RoutingError("The routing service returned an invalid distance matrix.") from exc

    def directions(self, longitude: float, latitude: float, cafe: dict, profile: str):
        payload = self.post(
            f"/v2/directions/{PROFILES[profile]}/geojson",
            {
                "coordinates": [[longitude, latitude], [cafe["longitude"], cafe["latitude"]]],
                "instructions": True,
                "language": "en",
                "units": "m",
                "preference": "fastest",
                "radiuses": [MAX_SNAP_DISTANCE_M, MAX_SNAP_DISTANCE_M],
            },
        )
        try:
            feature = payload["features"][0]
            geometry, properties = feature["geometry"], feature["properties"]
            if geometry["type"] != "LineString" or len(geometry["coordinates"]) < 2:
                raise ValueError("Missing route line")
            for point in geometry["coordinates"]:
                if (
                    len(point) != 2
                    or any(isinstance(v, bool) for v in point)
                    or not all(math.isfinite(v) for v in point)
                    or not -180 <= point[0] <= 180
                    or not -90 <= point[1] <= 90
                ):
                    raise ValueError("Invalid route point")
            steps = []
            for segment in properties["segments"]:
                for step in segment["steps"]:
                    if not isinstance(step["instruction"], str) or not isinstance(
                        step["name"], str
                    ):
                        raise ValueError("Invalid instruction")
                    steps.append(
                        {
                            "instruction": step["instruction"],
                            "road": step["name"],
                            "distance_m": metric(step["distance"]),
                            "duration_s": metric(step["duration"]),
                        }
                    )
            return {
                "geometry": geometry,
                "distance_m": metric(properties["summary"]["distance"]),
                "duration_s": metric(properties["summary"]["duration"]),
                "steps": steps,
                "profile": profile,
                "provider": "openrouteservice",
            }
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise RoutingError("The routing service returned an invalid route.") from exc

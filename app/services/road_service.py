"""Road use case and hosted openrouteservice integration."""

import math

import requests

from app.models.location import RouteQuery
from app.models.place import CoffeeRepository
from app.models.road import RoutingGateway
from app.utils.response import CafeNotFound, RoutingError, SearchNotConfigured, cafe_response


class RoadService:
    def __init__(self, repository: CoffeeRepository, routing: RoutingGateway):
        self.repository = repository
        self.routing = routing

    def route(self, body: RouteQuery) -> dict:
        if not self.repository.configured:
            raise SearchNotConfigured("Coffee search is not configured yet.")
        self.routing.require_key()
        cafe = self.repository.get_cafe(body.osm_type, body.osm_id)
        if cafe is None:
            raise CafeNotFound("This café is no longer in the dataset.")
        result = self.routing.directions(body.longitude, body.latitude, cafe, body.profile)
        return {**result, "cafe": cafe_response(cafe)}


ORS_URL = "https://api.openrouteservice.org"
PROFILES = {"walking": "foot-walking", "driving": "driving-car"}


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
        try:
            response = requests.post(
                ORS_URL + path,
                headers={
                    "Authorization": self.api_key,
                    "Accept": "application/json",
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
        if response.status_code in (401, 403):
            raise RoutingError(
                "The routing API key was rejected. Check the server configuration.", 503
            )
        if response.status_code == 429:
            raise RoutingError(
                "The routing service limit was reached. Wait before trying again.", 429
            )
        if response.status_code in (400, 404):
            raise RoutingError(
                "No route could be calculated for these locations. Try another café.", 422
            )
        if response.status_code != 200:
            raise RoutingError(
                "The routing service is temporarily unavailable. Please try again.", 503
            )
        try:
            payload = response.json()
            if not isinstance(payload, dict) or "error" in payload:
                raise ValueError("Invalid response")
            return payload
        except ValueError as exc:
            raise RoutingError("The routing service returned an invalid response.") from exc

    def rank(self, longitude: float, latitude: float, cafes: list[dict], profile: str):
        self.require_key()
        if not cafes:
            return []
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
            results = []
            for cafe, distance, duration in zip(cafes, distances[0], durations[0], strict=True):
                if distance is None or duration is None:
                    continue  # Unreachable, never substitute a straight-line estimate.
                results.append(
                    {**cafe, "road_distance_m": metric(distance), "duration_s": metric(duration)}
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
                "radiuses": [100, 100],
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

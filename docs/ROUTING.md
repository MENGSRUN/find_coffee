# Hosted road routing

Find Coffee uses **openrouteservice's hosted API** for walking and driving routes.
PostGIS stores cafés and finds nearby candidates. No routing engine or road-network
database is installed locally. The CLI remains a straight-line search tool.

## Enable routing

1. Create an account at the [openrouteservice dashboard](https://openrouteservice.org/dev/).
2. Obtain an API key with Directions and Matrix access. Review your plan's current
   allowances and [API restrictions](https://openrouteservice.org/restrictions/).
3. Add the key to the project's `.env` file:

   ```dotenv
   ORS_API_KEY=your_actual_key
   ```

4. Restart the Python web server, then reload the page:

   ```bash
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   find-coffee serve
   ```

   For phone access, restart using the HTTPS command in [PHONE.md](PHONE.md).

5. Choose **Walking** or **Driving**, select **Road distance**, and search with GPS
   or the Phnom Penh preview. Select **Show route on map** for a café.

The key stays on the Python server. It is never returned to the browser, embedded in
JavaScript, or sent in a URL. `.env` is excluded from Git. Routing uses the existing
`requests` dependency, so no additional Python package is required.

Without a key, the UI announces that routing is not connected and selects **Straight
line**. A nonempty key enables road controls; the provider validates it on requests.
Provider failures do not silently substitute straight-line distances. You can explicitly
choose straight-line search if routing is unavailable.

## Behavior and limitations

- **Road distance** shows distance and estimated minutes for the selected travel mode.
- **Show route on map** draws the returned route geometry and shows turn instructions
  and street names where available. It does not draw a straight line as a road route.
- **Get directions** opens Google Maps with the same starting coordinates, café coordinates,
  and travel mode as the app's search. Google still computes its own route and estimates.
- Walking uses `foot-walking`; driving uses `driving-car`. Motorbike-specific routing
  is not supported. Travel times are estimates without live traffic.
- This is a route preview with instructions, not continuous navigation or automatic rerouting.

PostGIS first selects up to **30 cafés** within the chosen straight-line radius. One
Matrix call compares route distances/durations to these candidates. Unreachable results
returned as null are excluded. Python sorts by route distance, then returns the requested
page of cafés. The UI fetches the full ranked set once (`limit: 50, page: 1`) and
offers 10, 20, or 50 items per page. Moving between pages or changing page size
reuses that result set without further Matrix calls. New location/filter searches
replace it. Clicking a café's route button makes one Directions call for its detailed route.

The radius defines the candidate area, **not a maximum road distance**. A café inside a
3 km circle can require a longer route. Ranking is among the candidates checked, not a
guaranteed global nearest-by-road result: a café outside the 30-candidate shortlist could
have a better road route. The UI reports candidate and unreachable counts.

Route distance is measured along the provider's selected route, not necessarily the
mathematically shortest-distance path. Detailed Directions uses `preference=fastest`.
Matrix and detailed-route estimates can differ due to snapping and routing behavior;
the selected route panel shows its own returned distance and duration.

Detailed route endpoints must snap to a routable segment within **100 meters**. Failure
produces an error. OSM points or bounding-box centers may not represent shop entrances;
routes start/end at mapped roads or paths near the requested points. Review the last
approach on the map.

## Comparing with Google Maps

Use the app's **Get directions** link after a fresh search to compare the same start,
destination, and travel mode. Earlier versions omitted `origin`, letting Google select
its own current location. Refresh the app to get links with explicit starting coordinates.

The café card is an openrouteservice Matrix estimate. Select **Show route on map** to
inspect the detailed route and instructions, then compare that path with Google's.
Providers may choose different roads, pedestrian connections, or snapped endpoints and
use different travel-speed assumptions. Equal input coordinates do not guarantee equal
distances or times. An OSM café point may also differ from Google's business entrance.
Screenshots alone do not establish which route is correct. Never adjust displayed
distance with a multiplier just to match another provider.

See [Google Maps URL parameters](https://developers.google.com/maps/documentation/urls/get-started#directions).

## API contract

`GET /api/v1/config` returns key availability and provider name, never credentials.

`POST /api/v1/nearby`:

```json
{"latitude":11.5564,"longitude":104.9282,"radius_m":3000,"limit":10,"distance_mode":"road","profile":"walking"}
```

For compatibility, omitting `distance_mode` uses `straight`; the configured UI explicitly
requests `road`. Road results add `road_distance_m` and `duration_s`; the original
`distance_m` stays the PostGIS straight-line distance. Metadata includes `candidate_count`,
`candidate_limit`, and `unreachable_count`. Response OSM IDs are strings to preserve BIGINTs.

`POST /api/v1/route`:

```json
{"latitude":11.5564,"longitude":104.9282,"osm_type":"node","osm_id":"11005544321","profile":"walking"}
```

That ID is an example from the local extract. The server looks up the café's coordinates
in PostGIS. The response includes the café, GeoJSON `geometry`, this route's `distance_m`,
`duration_s`, `steps`, `profile`, and provider.

Errors: 422 for invalid inputs or unrouteable positions, 404 for an unknown café,
429 for provider limits, 503 for missing/rejected keys or network/service failure, and
502 for malformed provider data. Errors exclude keys and raw provider diagnostics.

## Data sharing and operation

Road searches send the starting position and candidate café coordinates to
`api.openrouteservice.org` over HTTPS. A selected route sends the start and destination.
The UI discloses this before sharing location. The app does not persist GPS or route
payloads; the hosted provider has its own data handling policies.

Each road search uses at most one Matrix request; each route selection uses one Directions
request. Empty candidates make no provider request. Calls have connection/read timeouts
and no automatic retries. Superseded browser requests are cancelled and ignored, but
already-running server calls may still consume provider quota. No polling or route
prefetching is used.

Leaflet **1.9.4** is bundled locally with its license. OpenStreetMap tiles load directly
in the browser only when a route is displayed. Tile requests reveal the viewed area and
browser IP to the tile provider. Attribution remains visible; browser caching is preserved.
The app does not bulk-download tiles. The referrer contains the site origin rather than
GPS coordinates. Follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

This remains a development app on trusted Wi-Fi. Before any public deployment, add
authentication and request limits and select a suitable provider plan.

## Validation

`tests/services/test_routing.py` tests the hosted HTTP boundary with mocks: coordinate ordering,
profiles, route-distance ranking, unreachable destinations, invalid payloads, timeouts,
authorization, and quota errors. API tests check candidate limits, café lookup, and secret isolation.
`tests/api/browser_routing.cjs` uses controlled API responses for route rendering and instructions without
consuming quota. Those mocked routes are test fixtures, not real directions.

After adding your key, verify a live Phnom Penh search and selected route. Mocked tests
do not establish account permissions, quotas, or actual routing coverage in Cambodia.

## References

- [Directions formats](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types)
- [Matrix API](https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/)
- [Provider restrictions](https://openrouteservice.org/restrictions/)
- [Leaflet downloads](https://leafletjs.com/download.html)

## Comparing road and straight-line results

The modes can return different counts and different first cafés. Straight-line mode
counts all mapped cafés within the radius; road mode ranks a maximum of 30 nearby
candidates. Increasing the radius does not increase that candidate limit. The UI
shows this scope above the map, labels road totals as ranked results, and displays
each café's straight-line distance alongside its road estimate.

Compare the same café, origin, and travel mode. Driving can require detours due to
road access and one-way streets; coordinates may also snap to different road
segments. A large difference needs inspection of the selected route and endpoints,
not an assumption that every detour is correct. Use **Show route on map** to examine
it, and compare walking mode when appropriate. The matrix estimate and detailed
route can differ. Screenshots of different first cafés cannot establish a distance bug.

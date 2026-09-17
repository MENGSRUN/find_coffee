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
   uvicorn app.main:app --no-access-log
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

The browser waits at most five seconds for routing configuration, including its response
body. A timeout, HTTP failure, or invalid response selects straight-line mode and disables
road controls. Searches then proceed; reload the page to check routing availability again.

## Behavior and limitations

- **Road distance** shows distance and estimated minutes for the selected travel mode.
- **Show route on map** draws the returned route geometry and shows turn instructions
  and street names where available. It does not draw a straight line as a road route.
- **Get directions** opens Google Maps with the same starting coordinates, café coordinates,
  and travel mode as the app's search. Google still computes its own route and estimates.
- Walking uses `foot-walking`; driving uses `driving-car`. Motorbike-specific routing
  is not supported. Travel times are estimates without live traffic.
- This is a route preview with instructions, not continuous navigation or automatic rerouting.

PostGIS selects every café matching the chosen straight-line radius and name filter.
The routing client processes sequential batches of at most 500 destinations per
Matrix request, with one origin. It globally sorts all reachable results after all
batches succeed. This batch size does not cap the total cafés checked. The
[ORS restrictions](https://openrouteservice.org/restrictions/) permit up to 3,500
origin-destination pairs for these Matrix requests.

The UI requests `limit: "all", page: 1` once, then pages the complete ranked set in
memory (10, 20, 50, 100, or All). Page navigation and page-size changes make no extra
routing calls. New searches rerun routing. Direct paginated API calls also rerun
routing before slicing the globally ranked results.

Provider quotas still apply. If any batch fails, the entire search reports the
error; it does not label partial rankings as complete. No automatic retries are
made. Larger road searches can take longer; the browser allows up to five minutes
before reporting a timeout. A timed-out/disconnected synchronous request may still
finish on the server, so avoid repeatedly resubmitting it.

The radius bounds café coordinates, not road distance. Routes can extend outside
that radius. Unreachable cafés are excluded, so counts can differ from straight-line
mode. `candidate_count` reports all matching cafés checked; `candidate_limit` is
now null. Only cafés in the imported dataset and selected search area are included.

Route distance is measured along the provider's selected route, not necessarily the
mathematically shortest-distance path. Detailed Directions uses `preference=fastest`.
Matrix and detailed-route estimates can differ due to snapping and routing behavior;
the selected route panel shows its own returned distance and duration.

Both road ranking and detailed route previews enforce a **100-meter** road-access limit.
Ranking checks the Matrix response's `sources` and `destinations` snapping distances.
A missing road match or a starting point over 100 m from a routable road produces a
422 error with advice to choose another starting point. Destinations without a match,
without a route, or over 100 m from a routable road are excluded and counted in
`unreachable_count`. Missing or malformed snapping metadata produces a 502 error;
it is never assumed to mean zero displacement. Exactly 100 m is allowed.

Road cards show the starting and destination road-access gaps. These are distances
between the requested coordinates and the provider's matched road points, not verified
access paths, and are not added to the road distance or travel time. OSM points or
bounding-box centers may not represent shop entrances. Review the last approach on
the map. Matching limits do not guarantee identical Matrix and Directions routes.

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
requests `road`. Road results add `road_distance_m`, `duration_s`,
`source_snap_distance_m`, and `destination_snap_distance_m`; the original
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
Input-validation errors return a `detail` list containing `type`, `loc`, and `msg`.
Raw input and validation context are omitted so overflowing/nonfinite numbers also
return valid JSON with status 422 rather than causing an error during serialization.

## Data sharing and operation

Road searches send the starting position and candidate café coordinates to
`api.heigit.org/openrouteservice` over HTTPS. A selected route sends the start and destination.
The UI discloses this before sharing location. The app does not persist GPS or route
payloads; the hosted provider has its own data handling policies.

Each road search uses one Matrix request per batch of up to 500 cafés; each route
selection uses one Directions request. Empty candidates make no provider request. Calls have connection/read timeouts
and no automatic retries. Superseded browser requests are cancelled and ignored, but
already-running server calls may still consume provider quota. No polling or route
prefetching is used.

Leaflet **1.9.4** is bundled locally with its license. OpenStreetMap tiles load directly
in the browser when the café map or route map is displayed. Tile requests reveal the viewed area and
browser IP to the tile provider. Attribution remains visible; browser caching is preserved.
The app does not bulk-download tiles. The referrer contains the site origin rather than
GPS coordinates. Follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

This remains a development app on trusted Wi-Fi. Before any public deployment, add
authentication and request limits and select a suitable provider plan.

## Validation

`tests/services/test_routing.py` tests the hosted HTTP boundary with mocks: coordinate ordering,
profiles, route-distance ranking, unreachable destinations, the 100 m snapping boundary,
invalid/missing snapping metadata, timeouts, authorization, and quota errors. API tests
check full candidate coverage, café lookup, secret isolation, and nonfinite input errors.
`tests/api/browser_config.cjs` checks configuration timeouts and failure recovery with
a virtual clock, plus the road-access gap display.
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

Both modes consider all cafés matching the radius/name filter. Road mode excludes
unreachable cafés and sorts by road distance. The UI displays each café's
straight-line distance alongside its road estimate for comparison.

Compare the same café, origin, and travel mode. Driving can require detours due to
road access and one-way streets; coordinates may also snap to different road
segments. A large difference needs inspection of the selected route and endpoints,
not an assumption that every detour is correct. Use **Show route on map** to examine
it, and compare walking mode when appropriate. The matrix estimate and detailed
route can differ. Screenshots of different first cafés cannot establish a distance bug.

### Access denied or API key rejected

The app uses `https://api.heigit.org/openrouteservice` for Matrix and Directions.
ORS deprecated the old hostname and reduced its quota before shutdown. Existing
keys support the new address; see the [official migration announcement](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912).

HTTP 403 can mean exhausted daily quota or an unauthorized key; it does not prove
that the key is incorrect. Check key access and quota at https://account.heigit.org/.
HTTP 401 indicates rejected authentication; HTTP 429 indicates a rate limit.
After changing `.env`, stop and restart Uvicorn using your usual HTTPS command.
An exported `ORS_API_KEY` overrides `.env`; remove a stale shell override with
`unset ORS_API_KEY` before restarting. Keep the key out of chat and source control.
Straight-line searches work without ORS while access issues are resolved.

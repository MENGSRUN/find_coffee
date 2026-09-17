# Walking-time area

Choose **Walking-time area** under **Search by**, select **5, 10, or 15 minutes**,
then click **Use my location**, enter coordinates, or explore the demo location.
The green polygon shows the estimated area reachable on foot. The list contains
mapped cafés inside that polygon, sorted by straight-line distance from the start.

Radius and travel-mode controls are hidden for this mode. Walking-area searches
always use walking, including the selected café's route and Google Maps link.
**Search this map area** moves the starting point to the map center; it does not
use the visible map rectangle as the search boundary.

## How it works

1. `POST /api/v1/nearby` accepts `distance_mode: "walk_area"` and
   `walk_minutes: 5`, `10`, or `15`, plus the usual coordinates, name filter, and paging.
2. The service asks the hosted ORS `/v2/isochrones/foot-walking` endpoint for one area.
   Coordinates are longitude first, and the time range is sent in seconds.
3. The adapter validates the Polygon or MultiPolygon response.
4. PostGIS selects café points covered by the area, including its boundary and
   excluding polygon holes. A geography intersection uses the existing spatial index;
   geometry coverage matches the GeoJSON boundary shown on the map.
5. The response includes `area`, `walk_minutes`, `profile: "walking"`, cafés, and
   pagination metadata. `distance_m` remains straight-line meters; no individual
   walking times are invented from polygon membership.

The browser requests all matching cafés once and pages that result locally. Changing
page size or page does not call ORS again. Changing the origin, minutes, name filter,
or search mode starts a new search. Tracking GPS/compass updates do not request areas.
No new dependency or database migration is required.

## Estimates and provider access

An isochrone is an approximate road-network reachability boundary, not a guarantee
that every café inside has an entrance reachable within the selected time. Map
coverage, barriers, entrances, and walking speed affect actual journeys. Use **Show
route on map** to inspect the individual walking route and its estimated time.

The feature uses the existing server-side `ORS_API_KEY`. Your key must have access
to the isochrones endpoint and remaining quota. A configured key does not guarantee
access; provider failures are displayed without substituting a radius circle.
The start location is shared with ORS. Polygon results are kept in browser memory
for the current search, not saved to the database or localStorage.

Provider reference: [ORS isochrones documentation](https://giscience.github.io/openrouteservice/api-reference/endpoints/isochrones/).

## Checks

Automated tests cover ORS request units/coordinate order, invalid polygon responses,
request validation, service selection, and real PostGIS boundary/hole filtering,
name searches and pagination. `tests/api/browser_walking_area.cjs` uses offline
fixtures to check map rendering, cached pagination, empty/error states, mode changes,
and a 390-pixel mobile viewport. Browser setup is documented in [PHONE.md](PHONE.md).

For a manual check with your key:

1. Restart the app and refresh the browser.
2. Choose a 10-minute walking area and use the demo location or your GPS.
3. Check that a shaded area appears and cafés are listed inside it.
4. Change to 5 or 15 minutes and inspect the new area.
5. Open a café's walking route; compare its estimated time with the approximate area.
6. Switch to straight-line search and confirm the shaded area disappears.

## HTTP 406 troubleshooting

ORS isochrones return `application/geo+json`. Sending `Accept: application/json`
can cause HTTP 406 (Not Acceptable), even with a valid key and location. The client
requests `application/geo+json` for isochrones and GeoJSON directions, and
`application/json` for matrix responses. Restart the server after updating the client.

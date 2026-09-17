# Use your phone GPS on the same Wi-Fi

The UI requests location when you tap **Use my location** or **Start tracking**.
Use my location reads once and sends coordinates to this app's Python API to query
PostGIS. Tracking updates the live map locally; **Search** explicitly searches
from the latest tracking position. Road mode also sends the start and café
coordinates to hosted openrouteservice. Search-result and route maps load OpenStreetMap tiles.
The app does not save GPS history or load analytics scripts; map tiles use normal browser caching.
See [ROUTING.md](ROUTING.md) for API-key setup and data sharing.

Your phone and computer must be on the same Wi-Fi, and the computer must stay awake
with PostGIS and the web server running. A guest Wi-Fi network may block connections
between devices.

## Why HTTPS is needed

Browsers require a secure context and permission for geolocation. `http://localhost`
works on the computer, but `http://192.168.x.x` on a phone is not localhost. A trusted
local HTTPS certificate solves this without publishing the app to the internet.
Simply bypassing a certificate warning is not a reliable way to enable GPS.
See [MDN geolocation documentation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

## 1. Create the local certificate

Find your computer's Wi-Fi address using `ip route get 1.1.1.1` on Linux (look for
`src`). For this session it was **192.168.1.210**; it may change after reconnecting.

From the project root, using your current address:

```bash
python3 scripts/create_local_tls.py 192.168.1.210
```

Requires OpenSSL. The script creates `.local-tls/` with a local certificate authority
and a 30-day server certificate for that IP and localhost. It does not modify your
computer's certificate trust store. It refuses to overwrite existing certificates.
If already created in this session, skip this command and use the existing files.

## 2. Install the public CA certificate on your phone

Transfer **only** `.local-tls/public/coffee-local-ca.crt` to your phone. You can copy
it by USB or temporarily serve the public certificate directory over your home Wi-Fi:

```bash
python3 -m http.server 8081 --bind 0.0.0.0 --directory .local-tls/public
```

On the phone, download:

```text
http://192.168.1.210:8081/coffee-local-ca.crt
```

Keep the private `ca.key` and `server.key` files on your computer. Never serve the
whole `.local-tls` directory. Trust this CA only on your own test device and remove
it when you finish local development. Stop the certificate download server with Ctrl+C
after transferring the certificate.

**Android:** In Settings, search for **Install a certificate** or **Encryption &
credentials**. Choose **CA certificate** and select the downloaded certificate.
Confirm installation for **Find Coffee Local Development CA**, then reopen Chrome.
Labels vary by device; install it as a CA certificate, not a Wi-Fi client certificate.
[Google's certificate-management guide](https://support.google.com/pixelphone/answer/2844832)
describes where certificate settings are located.

**iPhone:** Open the downloaded certificate and install its profile in Settings
(usually **General → VPN & Device Management** or **Profile Downloaded**). Then go to
**Settings → General → About → Certificate Trust Settings** and enable full trust for
**Find Coffee Local Development CA**. Reopen Safari.
[Apple's trust instructions](https://support.apple.com/en-us/102390).

## 3. Start the HTTPS app

In another terminal at the project root:

```bash
source .venv/bin/activate
docker compose up -d --wait
uvicorn app.main:app --no-access-log --host 0.0.0.0 --port 8443 \
  --ssl-certfile .local-tls/server.crt \
  --ssl-keyfile .local-tls/server.key
```

Open this address on your phone:

```text
https://192.168.1.210:8443
```

After the certificate is trusted, the page should open without a certificate warning.
Tap **Use my location**, allow location access, and wait for the results. Enable phone
location services and precise location if offered. The app shows the reported GPS
accuracy and warns when the position is approximate.

The radius defaults to 3 km and can be changed from 500 m to 25 km. Results default to
10 cafés per page, sorted by road distance when configured and selected, or explicitly by
straight-line distance otherwise. The map shows a blue search location and numbered
café markers matching the list. Tap a marker for details, use **View on map** on a
card to focus it, or **Show all results** to restore the overview. Café markers work
without a routing key. **Show route on map** displays the selected route
and street instructions inside the app. **Get directions** opens Google Maps with
the same starting coordinates, destination, and selected travel mode used by this app.
Google may still choose a different route. The **Explore
central Phnom Penh** button uses an explicitly labeled example location, not your GPS.

Above **Cafés around you**, search by café name and choose **Items per page**
(10, 20, 50, 100, or All) to the right. Click **Search** to apply the name filter or **Clear**
to remove it. Searches match English and Khmer names within the selected radius;
road mode checks all matching cafés. Below the list, use the first,
previous, next, or last-page buttons. The footer shows the visible range and total.
The map follows the current page. Straight-line searches can page through every
matching café within the radius. Road searches page through all reachable matching cafés; paging reuses the results without extra routing calls.

## Track your movement and direction

1. Tap **Start tracking** beside the café search bar. It starts GPS and compass together. Allow location
   and motion/orientation access if asked; your browser may show separate permission
   prompts even though the app has one button.
2. GPS places one blue marker on the map. Hold the phone flat, screen up, and turn it:
   the compass rotates that marker's arrow, even while you stand still. The readout
   says **Phone points E · 90°**. North is 0°, east 90°, south 180°, and west 270°.
3. A blue dot means GPS is available but compass direction is unavailable. A status
   message explains compass permission or sensor problems. GPS speed, GPS heading,
   and movement-derived bearings are not used as substitutes for phone direction.
   The shaded circle represents GPS accuracy in meters.
4. The map automatically follows your live position. Dragging the map, focusing a
   café, or choosing Show all results pauses following. Search again to resume following.
5. Tap **Search** beside the café name field to update café results from the latest GPS position. Until then,
   café distances, route previews, and Google Maps links keep their original search
   position. Sensor updates do not call the café or routing APIs. The combined marker
   also appears on an open route preview without recalculating its route.
6. Tap **Stop tracking** to stop both sensors and remove the live overlays. Tracking
   also stops when the page becomes hidden or is left; tap Start tracking after returning.
   Keep the page visible and the phone unlocked. This is not background navigation.

`app/resources/static/tracking.js` owns the combined lifecycle. It calls the compass permission
request directly during the button tap, then starts `watchPosition()` without waiting
for the compass result. Compass denial leaves GPS usable; GPS permission denial stops
both. Stopping or hiding the page invalidates pending permission requests so a late
approval cannot restart sensors. A new start retries both permissions.

GPS uses high accuracy and no cached fixes. A position expires after 15 seconds:
live map overlays disappear and Search waits for a fresh fix before using tracking.
Compass readings may continue updating the status while waiting for GPS, but
cannot create a map location. No location history is stored. Moving maps still request
OpenStreetMap tiles, which reveal the viewed area to the tile provider.

See [watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).

## Phone compass: turn while standing still

The compass starts automatically with **Start tracking**. There is no separate
compass button. Hold the phone reasonably flat, screen facing up, and turn it. Both
its status and the arrow at your GPS location show where the phone's physical top edge
points. You can test rotation while standing at your desk; no walking is required.

`app/resources/static/compass.js` uses Safari's `webkitCompassHeading` when supplied, or an
absolute orientation event with a north reference. For a screen-up phone, standard
orientation yields `(360 - alpha) % 360`. Relative-only rotation has no north reference
and is not displayed as a compass. The standard path asks you to hold the phone flatter
if tilt exceeds 60°; Safari readings with reported accuracy worse than 30° or an
invalid calibration flag are hidden. Sensor north/accuracy depends on the device and
calibration. Metal objects and magnetic interference can affect readings.

The compass updates on sensor events, at most once per display frame, without waiting
for GPS movement. A reading older than five seconds is hidden; eight seconds without
an initial usable reading produces an availability message. Unsupported browsers,
denied permission, and missing north-referenced sensors produce clear status messages.
No relative heading is silently substituted. Stop tracking removes compass listeners
and clears the GPS watch; both also stop when the page is hidden or left. No sensor readings are sent to the API
or stored. You do not need another API key, PostGIS table, or GPS fix for the compass dial.

See the [device orientation specification](https://www.w3.org/TR/orientation-event/)
for the coordinate-frame and screen-up compass calculation.

## Troubleshooting

`uvicorn app.main:app --no-access-log` without certificate flags starts HTTP on port 8000. Opening
`https://localhost:8000` against that HTTP server causes `ERR_SSL_PROTOCOL_ERROR`
and “Invalid HTTP request received” messages. Stop it with Ctrl+C and use the
HTTPS command above, then open port **8443** with `https://`.

| Symptom | What to check |
| --- | --- |
| Page cannot be reached | Same Wi-Fi; computer awake; server running; correct Wi-Fi IP; guest-network client isolation. If a firewall is active, permit TCP 8443 from your local subnet. Certificate downloads additionally need TCP 8081. |
| Certificate warning | Install and trust the CA, use the exact IP included in the certificate, and check the server certificate has not expired. |
| Browser says HTTPS is needed | Open the HTTPS URL on port 8443, not a plain HTTP LAN URL. |
| Permission denied | Allow location for this site in browser settings and enable phone location services. |
| GPS timeout or poor accuracy | Retry outdoors or near a window; enable precise location if available. |
| No results | Increase the radius. OSM coverage varies, and some areas have no mapped cafés. |
| Coffee search unavailable | Confirm PostGIS is healthy, `.env` points to it, and the dataset has been imported. |

If the computer's IP changes or the 30-day server certificate expires, stop the server,
move the old `.local-tls` directory aside, regenerate for the current IP, and replace
the old CA on your phone. Never commit private keys; `.local-tls/` is ignored by Git.

## API

The browser uses `POST /api/v1/nearby` with a JSON body, keeping GPS coordinates out of URLs:

```json
{"latitude": 11.5564, "longitude": 104.9282, "radius_m": 3000, "limit": 10, "page": 1, "distance_mode": "straight", "profile": "walking"}
```

The response contains `cafes`, `total`, `page`, `page_size`, `total_pages`, and,
in road mode, routing metadata. The UI fetches the full road candidate set once with
`limit: "all"` and pages it locally. IDs are strings to preserve PostgreSQL BIGINT
precision in JavaScript. Invalid coordinates/radius/limit return 422; database failures
return a generic 503. Responses are not cached, and the built-in server disables access
logs. No API endpoint writes location data to the database. This setup is for local
development on your trusted Wi-Fi; it has no public deployment or authentication layer.

## Checks

Run `pytest` for API validation/error tests and existing import/search tests. Browser
checks should cover a mobile viewport, a simulated GPS grant, permission denial,
preview/manual search, radius changes, no results, network failures, and external links.
A simulated browser location verifies application behavior; actual phone permission
and GPS reception must still be confirmed on your phone.

`tests/api/browser_smoke.cjs` provides automated Chromium checks against a running app.
It requires the Node `playwright` package and a Chromium installation. Run with
`node tests/api/browser_smoke.cjs`; `PLAYWRIGHT_MODULE` can point to an existing Playwright
module, `CHROMIUM_PATH` to a browser executable, and `APP_URL` to a localhost preview.
It writes desktop and mobile screenshots under `/tmp/find-coffee-*.png`.

`tests/api/browser_tracking.cjs` uses simulated GPS and mocked API responses without
a running app. It checks direction, accuracy, map following, explicit search refresh,
stale locations, and stopping on permission denial or a hidden page. Run it with the
same `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` settings as the other browser checks.

### Test direction without walking outside

Use automated GPS simulation after changing tracking code. The tracking browser test
supplies controlled coordinates, speed, accuracy, and timestamps. It checks map
movement, GPS-only fallback when compass is unsupported, stale fixes, search refresh,
and permission errors. GPS heading changes must not invent a phone compass bearing.
No real GPS, running FastAPI server, PostGIS, or ORS key is required.

With Playwright available to Node and its Chromium browser installed:

```bash
node tests/api/browser_tracking.cjs
```

If Node reports that it cannot find Playwright, this optional one-time setup keeps
browser test dependencies outside the Python project (requires Node.js/npm and internet):

```bash
npm install --prefix /tmp/find-coffee-browser-tests playwright
node /tmp/find-coffee-browser-tests/node_modules/playwright/cli.js install chromium
PLAYWRIGHT_MODULE=/tmp/find-coffee-browser-tests/node_modules/playwright \
  node tests/api/browser_tracking.cjs
```

The temporary install may need repeating after `/tmp` is cleared. If you already
have a compatible Chromium executable, set `CHROMIUM_PATH` to it instead of downloading
Playwright's browser. Run from the project root. A successful run prints
`Tracking checks passed`.

For the phone compass, run:

```bash
PLAYWRIGHT_MODULE=/tmp/find-coffee-browser-tests/node_modules/playwright \
  node tests/api/browser_compass.cjs
```

This simulates stationary N/E/S/W turns, the 359°/0° boundary, Safari headings,
absolute and relative sensor events, tilt, poor calibration, permission denial,
unsupported browsers, stale readings, and stopping while permission is pending.
It also checks that one tap starts both sensors, compass denial keeps GPS usable,
GPS denial stops both, and compass rotation does not change GPS position or call the API.
A successful run prints `Compass checks passed`.

For manual location testing in Chrome, open DevTools, press **Ctrl+Shift+P**, choose
**Show Sensors**, and set **Location** to a custom latitude/longitude. Change the
coordinates to move the marker, or choose **Location unavailable** to test an error.
This checks location behavior; use the automated fixtures for repeatable headings,
speed, and accuracy. The Sensors **Orientation** controls simulate turning the device,
but a relative-only event is insufficient for a compass; use `browser_compass.cjs`
for deterministic north-referenced compass tests. The app uses orientation for
direction and GPS for position.
See [Chrome Sensors documentation](https://developer.chrome.com/docs/devtools/sensors).

### Check real sensors after simulation

GPS location updates arrive when the browser provides fixes; `timeout: 15000` is an
error timeout, not a polling interval. Compass rotation updates on orientation events,
at most once per display frame, without waiting for GPS displacement. Direction and
position can therefore update at different rates. The browser and phone determine
sensor availability and delivery frequency.

A short outdoor check is useful when changing GPS behavior or before sharing a release,
rather than after every code edit. Keep the HTTPS page visible, walk a short path,
stop, and check the position and accuracy circle. For direction, stand still indoors,
tap Start tracking, and rotate the phone. Test away from metal or magnets if the bearing
looks wrong. Simulated tests verify our logic; the real phone verifies its permissions,
sensors, and reception. Neither GPS nor sensor simulation consumes routing quota unless
you explicitly search for cafés or request a route against the live app.

## Route progress (first feature to test)

1. Tap **Start tracking** and allow location/compass access.
2. Press **Search**, then choose a café and **Show route on map**.
3. With the page visible, walk along that route. The route panel shows approximate
   distance remaining along its line and the percentage completed.
4. Move away from the route to check the off-route message. It appears when the
   distance exceeds both 30 m and twice the reported GPS accuracy.
5. To request a new route, press **Search** and select **Show route on map** again.
   Tracking never automatically requests routes.

Remaining distance is measured along the displayed polyline, excluding access gaps
between the road and the café entrance. It can differ slightly from the provider's
route total. This is an estimate, not turn-by-turn navigation or a live ETA. Progress
can move backwards when you backtrack. Poor GPS accuracy (over 50 m), stale fixes,
and ambiguous positions near crossings pause estimates. Near the endpoint, verify
the actual entrance; the app does not claim you have arrived at the café.

Run deterministic geometry/status checks without walking or any external services:

```bash
node tests/api/route_progress.cjs
```

The existing `browser_tracking.cjs` also checks that displaying and closing a route
connects and clears progress, without additional API calls from GPS updates.

## Café marker clustering (second feature to test)

Choose **100** or **All** items per page and zoom out on the café map. Green groups
show how many cafés they contain, not a café's list number. Tap a group to zoom in;
markers at identical coordinates spread apart so you can select each one. Individual
markers retain their list numbers and existing popup actions. **View on map** on a
card reveals that café even when it is inside a group. Expanding a group pauses live
map following so GPS updates do not pull you away while browsing.

Only cafés on the current result page are clustered. The blue search/GPS markers
and route progress remain separate. Changing page or searching replaces the previous
groups. Clustering runs in the browser and makes no extra search or routing requests.

The app serves Leaflet.markercluster 1.5.3 locally (`leaflet.markercluster.js` and
`MarkerCluster.css`); its MIT license is in `app/resources/static/leaflet.markercluster.LICENSE`.
Assets come from the pinned npm release of the [Leaflet plugin](https://github.com/Leaflet/Leaflet.markercluster).
If the plugin cannot load, individual café markers remain available.

## Search this map area

Move the café map to the place you want to explore, then press **Search this map area**.
The search uses its center, the selected radius, travel mode, distance mode, and café-name
filter. It resets pagination. The radius is measured from the center, not the rectangular
map bounds. Panning/zooming alone makes no search or routing requests. If GPS tracking
is active, map-area search pauses following and keeps the chosen map center as the
search origin. The regular **Search** button uses live GPS again while tracking.

## Saved cafés

Press **Save café** on a result card. Open **Saved cafés** above the map to see bookmarks,
remove one, open its OSM page, or search around its location. No account is needed.
Bookmarks survive reloads in the same browser and site origin. HTTP versus HTTPS,
localhost versus a LAN IP, different ports, and a different phone/browser each have
separate storage. Clearing browser data removes bookmarks. Storage errors are shown
without claiming a save succeeded.

Only OSM identity, café name, and café coordinates are saved. User GPS, calculated
distances, routes, and credentials are not stored. Saved information is a snapshot;
a café may close or change after saving. A new nearby search reads the current database.

## Feature completion checklist

- Route progress: simulated on/off-route, low-accuracy and stale GPS checks.
- Marker clustering: dense and coincident cafés, page changes and fallback checks.
- Café details: import/export, migration, contact-link safety and missing details checks.
- Map-area search: map center, selected radius and request behavior checks.
- Saved cafés: reload persistence, removal, search origin and storage-failure checks.

Run `node tests/api/route_progress.cjs` and the `browser_map.cjs`, `browser_tracking.cjs`,
`browser_compass.cjs`, and `browser_pagination.cjs` suites with the Playwright setup above.
Real sensor quality and business-data accuracy still need checking on your phone.

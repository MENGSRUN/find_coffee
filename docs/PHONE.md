# Use your phone GPS on the same Wi-Fi

The UI requests location only when you tap **Use my location**. It sends coordinates
to this app's Python API to query PostGIS. Road mode also sends the start and café
coordinates to hosted openrouteservice. Search-result and route maps load OpenStreetMap tiles.
The app does not save GPS or load tracking scripts; map tiles use normal browser caching.
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
find-coffee serve --host 0.0.0.0 --port 8443 \
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
road mode ranks at most 30 matching cafés. Below the list, use the first,
previous, next, or last-page buttons. The footer shows the visible range and total.
The map follows the current page. Straight-line searches can page through every
matching café within the radius. Road searches page through reachable cafés among
up to 30 checked candidates; paging reuses the results without extra routing calls.

## Troubleshooting

`find-coffee serve` without certificate flags starts HTTP on port 8000. Opening
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
`limit: 50` and pages it locally. IDs are strings to preserve PostgreSQL BIGINT
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

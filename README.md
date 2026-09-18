# Find Coffee — Cambodia

Separate future project: [portable offline map hardware plan](docs/OFFLINE_HARDWARE.md)
includes Raspberry Pi and ESP32-S3 hardware recommendations. It is not an implemented
feature or a change to this café application.

A beginner-friendly Python project that downloads Cambodian cafés from OpenStreetMap,
imports them into PostgreSQL/PostGIS, and returns nearby cafés sorted by distance.
Use the Python CLI or DataGrip to import the same CSV dataset.

Includes a mobile web UI with phone GPS, a nearby-search API, and a command-line interface.
Tap **Use my location** to find cafés, change the radius, and open walking directions.
Search results appear on a map with numbered café markers and a blue search location.
Nearby markers group together when zoomed out; tap a group to expand it.
Tap a marker for details, or use **View on map** from a café card. The café map works
without a routing API key and displays the current page of results. Choose 10, 20,
50, 100, or All items per page and use the first/previous/next/last controls below the list.
Straight-line mode pages through all matching cafés within the radius; road mode
checks all matching cafés and pages through those with reachable routes. Large
road searches use multiple routing requests and remain subject to provider quotas.
See [Phone setup](docs/PHONE.md) for using GPS over your shared Wi-Fi network.

**GPS + compass tracking:** tap **Start tracking** once to start both sensors.
GPS sets the blue marker's position; the compass rotates its arrow as you turn the
phone, including while stationary. A dot appears when compass direction is unavailable.
The tracking button sits beside the café search bar. Use **Search** to refresh café distances
from your latest GPS position. **Stop tracking** stops both sensors;
tracking also stops when the page is hidden. See [tracking setup and testing](docs/PHONE.md#track-your-movement-and-direction).

**Explore and save:** move the map and press **Search this map area** to search around
its center using the selected radius. Press **Save café** on a card to bookmark it in
this browser; open **Saved cafés** to revisit or remove bookmarks.

**Route progress:** while tracking, open a café route to see estimated distance
remaining and off-route status. Progress updates locally without automatic routing calls.
See [how to test route progress](docs/PHONE.md#route-progress-first-feature-to-test).

**Road routes:** set `ORS_API_KEY` in `.env`, restart the web server, and choose
**Road distance**. The app uses hosted openrouteservice for walking/driving distances,
a route map, and street instructions. See [Hosted routing setup](docs/ROUTING.md).
Without a key, distances are explicitly labeled as straight-line. No self-hosted routing engine is needed.

## Open the UI

After installation and database setup below, choose the matching protocol.
`uvicorn app.main:app --no-access-log` starts **HTTP only**; opening `https://localhost:8000` against
that server causes `ERR_SSL_PROTOCOL_ERROR` and “Invalid HTTP request received.”

For a local HTTP preview:

```bash
source .venv/bin/activate
uvicorn app.main:app --no-access-log
```

Open **http://localhost:8000** on this computer. Use the Phnom Penh preview to browse
without sharing your location. For phone GPS, use the local HTTPS setup in
[docs/PHONE.md](docs/PHONE.md); plain HTTP on a LAN IP does not enable browser GPS.

## Quick start

Requirements: Python 3.11+, Docker with Compose, and internet access for the initial
dependency installation, database image, and OpenStreetMap download. DataGrip is optional.
Run commands from this project directory. These commands use Bash on Linux/macOS.

1. **Create the virtual environment.**

   ```bash
   python3 -m venv .venv
   ```

2. **Activate the virtual environment.**

   ```bash
   source .venv/bin/activate
   ```

3. **Install requirements.**

   ```bash
   python -m pip install -r requirements.txt
   ```

   For development and testing, use `requirements-dev.txt` instead; it also includes
   the runtime dependencies plus pytest, Ruff, and HTTPX.

4. **Create `.env`.** Keep your existing file if you have already configured it.

   ```bash
   if [ ! -f .env ]; then
     cp .env.example .env
   fi
   ```

   Review `.env` and ensure `DATABASE_URL` matches the PostGIS username, password,
   database name, and host port (default **5433**). `ORS_API_KEY` is optional for
   straight-line café searches.

5. **Start PostGIS with Docker Compose and prepare the database.**

   ```bash
   docker compose up -d --wait db
   alembic upgrade head
   ```

   On first setup, import the café dataset. This reuses the local GeoJSON if present
   and downloads it otherwise:

   ```bash
   if [ ! -f data/cambodia_cafes.geojson ]; then
     python -m scripts.data download
   fi
   python -m scripts.data import-data data/cambodia_cafes.geojson
   ```

   Skip the import when your database already contains the café data.

6. **Start the project with HTTPS for phone GPS.**

   First create and trust the local certificate using [Phone setup](docs/PHONE.md).
   If `.local-tls/server.crt` and `.local-tls/server.key` already exist and cover your
   current Wi-Fi IP, reuse them. Stop any previous server with **Ctrl+C**, then run:

   ```bash
   uvicorn app.main:app --no-access-log --host 0.0.0.0 --port 8443 \
     --ssl-certfile .local-tls/server.crt \
     --ssl-keyfile .local-tls/server.key
   ```

   On this computer, open **https://localhost:8443**. On your phone, open
   `https://YOUR_COMPUTER_WIFI_IP:8443` using the IP covered by the certificate.
   The browser/device must trust the local CA. `localhost` on a phone refers to
   the phone itself. Keep the terminal running; **Ctrl+C** stops the server.

   For a computer-only HTTP preview, you can instead run `uvicorn app.main:app --no-access-log` and
   open **http://localhost:8000**. Changing `http` to `https` in the address bar
   does not enable TLS on the server.

On later runs, reuse your existing certificate and start HTTPS with:

```bash
source .venv/bin/activate
docker compose up -d --wait db
uvicorn app.main:app --no-access-log --host 0.0.0.0 --port 8443 \
  --ssl-certfile .local-tls/server.crt \
  --ssl-keyfile .local-tls/server.key
```

For an existing PostgreSQL server with PostGIS installed, skip Docker and set
`DATABASE_URL` in `.env` to that database. The role running migrations needs permission
to enable PostGIS, or an administrator must enable it first. Subsequent imports need
table write access; searches need read access.

## Commands

```bash
# Download both normalized CSV and point GeoJSON, plus source metadata.
python -m scripts.data download

# Explicitly refresh the generated local files.
python -m scripts.data download --overwrite

# Create the initial schema; safe to repeat on this project's schema.
alembic upgrade head

# Either file format follows the same validation and upsert path.
python -m scripts.data import-data data/cambodia_cafes.csv
python -m scripts.data import-data data/cambodia_cafes.geojson

# Nearest five across all imported cafés, with no radius restriction.
python -m scripts.data nearest --lat 11.5564 --lon 104.9282

# Up to five within 5,000 meters; zero to four results is also valid.
python -m scripts.data nearest --lat 11.5564 --lon 104.9282 --radius-m 5000

# Structured output for another script.
python -m scripts.data nearest --lat 11.5564 --lon 104.9282 --limit 10 --json

# Show all available commands.
python -m scripts.data --help
```

The CLI reads `.env` from the current directory. Existing environment variables take
precedence. `DATABASE_URL` is needed for database commands, but not for downloads.
The local database is exposed on port **5433**. The downloader defaults to the
Private.coffee public Overpass instance; override `OVERPASS_URL` to use another instance.

To try the import without downloading OSM, use the explicitly fictional example:

```bash
python -m scripts.data import-data examples/sample_cafes.csv
python -m scripts.data nearest --lat 11.5564 --lon 104.9282 --radius-m 5000
```

Use a separate demo database for that sample. Its reserved-looking high numeric IDs
are synthetic, and its names and locations are not verified businesses.

## Project layout

Use `alembic upgrade head` to create or baseline the database schema. Alembic reads
`DATABASE_URL` from `.env`; existing café records are preserved.

The FastAPI backend uses Spring-style MVC layers in the root `app/` package:

```text
app/
    main.py          Application factory and standard ASGI entry point
    base/            Shared request validation and pagination
    config/          Settings, database connections and dependency injection
    constant/        Routing constants
    controller/      Web and REST controllers
    entity/          Café domain record
    exception/       Application errors and HTTP exception advice
    model/           Request DTOs, response mapping and service inputs
    repository/      PostGIS implementation and persistence contract
    security/        Browser security and privacy headers
    service/         Search, routing and data download logic
    utils/gis/       Coordinate validation and data conversion
    resources/       Static map UI and SQL scripts
```

See [PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for the complete tree and Spring
concept mapping. The startup command remains `uvicorn app.main:app --no-access-log`;
add `--reload` for development. The browser uses `/api/v1`; `/api` remains a compatibility
alias. Restart the server after restructuring. The refactor requires no new dependencies,
environment variables, or database migration. DataGrip SQL is now in `app/resources/database/queries/`.

## Data and distance semantics

- The query selects OSM `amenity=cafe` features within Cambodia. It includes cafés,
  not a verified census of coffee-only businesses. Coverage, names, and operating
  status depend on community contributions.
- Ways and relations are represented by bounding-box centers. These are approximate
  shop locations, not verified entrances. The downloader exports **Point** GeoJSON.
- Imports accept this project's CSV (seven required columns plus optional business details) or its Point GeoJSON schema.
  Arbitrary Overpass Turbo polygon exports need preprocessing; they are rejected
  with a message instead of silently converted.
- Latitude and longitude are validated as finite WGS84 coordinates. PostGIS stores
  `geography(Point, 4326)` and returns straight-line distances in meters. Walking
  times and road routes in the UI come separately from hosted openrouteservice.
  CLI distances remain straight-line.
- The primary key is `(osm_type, osm_id)`. Reimporting updates existing objects.
  Exact duplicate input rows collapse; conflicting rows with one key fail validation.
  Two different OSM objects describing one real shop still require manual review.
- Imports do not delete shops missing from a newer extract. Closures and removal
  reconciliation are future work; retain the download date when evaluating freshness.
- A radius query can use the GiST index. Without a radius, the starter sorts all
  stored cafés by exact distance, which is straightforward for a small dataset.

The `location` column is generated from longitude/latitude, so a coordinate update
automatically updates the spatial value. Never import into that column directly.

## Verification

```bash
ruff check .
ruff format --check .
pytest
```

Unit tests do not require internet access or a running database. Real PostGIS tests
are skipped unless `TEST_DATABASE_URL` is set. They create and drop a uniquely named
temporary database; the supplied role needs `CREATEDB` permission. With the default
local Docker credentials:

```bash
TEST_DATABASE_URL=postgresql://coffee:coffee_local_dev@localhost:5433/postgres \
  pytest -m integration -v
```

Those tests check schema creation, repeat imports, generated locations, meter-based
ordering, radius filtering, rollback on failure, and the DataGrip merge SQL. They use
fictional records, not the live Overpass service.

## Troubleshooting

| Issue | Action |
| --- | --- |
| Port 5433 is already used | Change `POSTGRES_PORT` and the port in `DATABASE_URL` together, then rerun Compose. |
| Docker socket permission denied | Start Docker and use an account permitted to access its daemon, or use an existing PostGIS server. |
| `extension "postgis" is not available` | Install PostGIS on the database server or use the supplied Docker image. |
| Permission denied creating the extension | Ask the database administrator to enable PostGIS in your target database. |
| `coffee_shops` does not exist | Run `alembic upgrade head` against the same `DATABASE_URL`. |
| Overpass timeout / HTTP 429 / HTTP 504 | Wait before retrying; a failed request does not replace existing exports. `OVERPASS_URL` can select another appropriate public instance. |
| No nearby results | Check imported row counts, longitude/latitude order, and radius; try without `--radius-m`. |
| Password changes seem ignored | PostgreSQL's initialization variables apply when its data volume is first created. Update the existing database role password explicitly. |

`docker compose down` stops the local database and keeps its volume. The project does
not automatically delete database volumes or reconcile removed OSM records.

## Data attribution and references

Generated OSM files are **© OpenStreetMap contributors**, licensed under ODbL.
Keep the generated `metadata.json` with shared datasets and include attribution in
any published application. See [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright).
The fictional sample is not extracted from OSM.

- [Overpass query language](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL)
- [Public Overpass instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances)
- [Public Overpass usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [Cambodia country extracts from Geofabrik](https://download.geofabrik.de/asia/cambodia.html)
- [DataGrip CSV import](https://www.jetbrains.com/help/datagrip/import-data.html)
- [PostGIS ST_DWithin](https://postgis.net/docs/ST_DWithin.html)
- [PostGIS ST_Distance](https://postgis.net/docs/ST_Distance.html)
- [Psycopg usage](https://www.psycopg.org/psycopg3/docs/basic/usage.html)
- [PostGIS Docker image](https://github.com/postgis/docker-postgis)

## Café details: update an existing installation

Stop the web server, activate your environment, then run:

```bash
alembic upgrade head
python -m scripts.data download --output-dir data/with-details
python -m scripts.data import-data data/with-details/cambodia_cafes.geojson
```

Restart the server using your usual HTTPS command. Search and expand **Café details**
on a card. Address, recorded opening hours, phone, and website appear when mapped in
OSM; missing values are labelled. Existing normalized exports have no business details,
so importing the same older file cannot populate them. Downloading needs internet but
no ORS key. If `data/with-details` already exists, reuse it or pass `--overwrite` to
explicitly refresh those generated files.

The migration preserves existing cafés. Legacy imports and blank detail fields preserve
previously stored details; populated details update on reimport. This conservative merge
does not automatically remove outdated contact information. To clear a known incorrect
value, explicitly update that column in PostGIS. Opening hours are displayed as raw OSM
text and are not used to claim that a business is currently open.

## Walking-time search

Choose **Walking-time area** and a **5-, 10-, or 15-minute** walk to display an
estimated walking boundary and cafés inside it. Uses your existing ORS key with
isochrones access. See [WALKING_AREA.md](docs/WALKING_AREA.md) for setup, behavior,
and testing. Café distances remain clearly labeled straight-line distances.

## QGIS visualization (optional)

Open the current PostGIS café data in a browser-accessible QGIS desktop:

```bash
docker compose --profile tools up -d qgis
```

Open **http://localhost:6080**. Inside QGIS, connect to PostgreSQL at **db:5432**
using your database name and credentials from `.env`. Add `public.coffee_shops`.
See [QGIS.md](docs/QGIS.md) for connection, layer, and project-saving instructions.

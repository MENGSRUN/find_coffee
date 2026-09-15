# Project structure

The backend follows the requested `app/` tree. The map UI, source dataset,
documentation and phone TLS script are preserved. There is no legacy `src/` package,
no `clients/` layer, and `docker-compose.yml` is the only Compose file.

```text
find_coffee/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── security.py
│   │   └── logging.py
│   ├── api/
│   │   ├── dependencies.py
│   │   └── v1/
│   │       ├── router.py
│   │       ├── locations.py
│   │       ├── places.py
│   │       ├── roads.py
│   │       ├── zones.py
│   │       └── spatial.py
│   ├── models/
│   │   ├── location.py
│   │   ├── place.py
│   │   ├── road.py
│   │   └── zone.py
│   ├── schemas/
│   │   ├── location.py
│   │   ├── place.py
│   │   ├── road.py
│   │   └── zone.py
│   ├── repositories/
│   │   ├── location_repository.py
│   │   ├── place_repository.py
│   │   ├── road_repository.py
│   │   └── zone_repository.py
│   ├── services/
│   │   ├── location_service.py
│   │   ├── place_service.py
│   │   ├── road_service.py
│   │   ├── zone_service.py
│   │   └── spatial_service.py
│   ├── gis/
│   │   ├── geometry.py
│   │   ├── spatial_query.py
│   │   ├── distance.py
│   │   ├── projection.py
│   │   └── geojson.py
│   ├── utils/
│   │   ├── pagination.py
│   │   └── response.py
│   ├── static/                       # Preserved map UI
│   └── sql/                          # Preserved DataGrip/import SQL
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial.py
├── tests/
│   ├── api/
│   ├── services/
│   ├── repositories/
│   └── gis/
├── scripts/
│   ├── seed_data.py
│   ├── import_geojson.py
│   ├── create_local_tls.py           # Preserved phone HTTPS setup
│   └── cli.py                        # Existing find-coffee command
├── docs/
├── data/
├── examples/
├── .env
├── .env.example
├── alembic.ini
├── requirements.txt
├── requirements-dev.txt
├── pyproject.toml
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
└── README.md
```

Python packages also have `__init__.py` files. `pyproject.toml` supplies package
metadata and the existing CLI entry point; requirements files install that package.

## Responsibilities

| Module | Current responsibility |
| --- | --- |
| `main.py` | Factory, dependency wiring, API registration and serving `/` |
| `core/config.py` | Environment settings |
| `core/database.py` | Psycopg connections |
| `core/security.py` | HTTP headers and centralized error handling; no authentication yet |
| `core/logging.py` | Disable access logs for the CLI web server |
| `api/v1/places.py` | Configuration and nearby café endpoints |
| `api/v1/roads.py` | Hosted route endpoint |
| `models/location.py` | Immutable search and route coordinate queries |
| `models/place.py` | Café domain model and repository Protocol |
| `models/road.py` | Routing Protocol |
| `schemas/place.py`, `schemas/road.py` | Pydantic HTTP request validation |
| `repositories/place_repository.py` | PostGIS search, counts, imports and SQL |
| `services/location_service.py` | OpenStreetMap download operation |
| `services/place_service.py` | Nearby search, ranking and pagination |
| `services/road_service.py` | Route use case and hosted ORS integration |
| `gis/geometry.py` | Coordinate validation |
| `gis/geojson.py` | Point GeoJSON/CSV conversion and deduplication |
| `utils/pagination.py` | Page totals |
| `utils/response.py` | Safe café ID serialization and application/routing errors |

Location persistence, zones, stored road data, projection and other spatial analysis
modules remain reserved. They contain explanatory docstrings, not fake endpoints or
tables. Existing distance calculations execute in PostGIS, and route calculations
use hosted ORS. This change reorganizes the existing product; it does not invent
additional GIS features.

## API flow

The browser calls `/api/v1/config`, `/api/v1/nearby` and `/api/v1/route`. The same
handlers retain `/api/config`, `/api/nearby` and `/api/route` aliases for existing
callers. Paths and response contents otherwise remain unchanged.

HTTP schemas validate inputs, controllers create plain query objects, and services
coordinate repository and routing operations. Repository methods own database
connections. `main.py` wires the concrete implementations to the service contracts.
Place endpoints receive `CoffeeService`; route endpoints receive `RoadService`
directly through FastAPI dependencies. The list, pagination, café markers, road
routing and phone GPS work as before.

## Install, migrate and run

From the project root:

```bash
source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d --wait
alembic upgrade head
find-coffee serve
```

The environment was refreshed during the restructure. Services are still started
manually. To use the explicit app factory:

```bash
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

For phone GPS, retain the HTTPS certificate arguments in [PHONE.md](PHONE.md).
`find-coffee` continues to work through `scripts/cli.py`. The old Python imports
under `find_coffee` and `python -m find_coffee` are removed; use `app` modules or the
installed `find-coffee` command instead.

## Alembic

`alembic.ini` points to `migrations/`; `migrations/env.py` reads `DATABASE_URL` from
the environment/.env. No credentials are stored in the Alembic configuration.
SQLAlchemy is used for migration connections; runtime repositories still use Psycopg.

`0001_initial.py` contains a fixed snapshot of the initial PostGIS/café schema.
It creates a fresh database schema or adopts the existing schema produced by this
project's initial SQL. It uses idempotent creation statements, keeps café records,
and records revision `0001`. It is not a reconciler for independently modified schemas.
Repeated upgrades are safe. The initial downgrade is explicitly blocked because
removing that baseline would delete café data.

Use `alembic current` to inspect the applied revision and `alembic revision -m
"description"` to create a future hand-written migration. Do not edit an applied
revision. There is no ORM metadata/autogeneration workflow in this project.

`find-coffee init-db` and the DataGrip SQL remain available for compatibility but do
not record Alembic revisions. Run `alembic upgrade head` to bring those installations
under the migration history. The restructure tested migrations on disposable
databases and did not migrate your live database automatically.

## Data scripts, containers and tests

After installation, `python scripts/import_geojson.py data/cambodia_cafes.geojson`
imports real café data. `python scripts/seed_data.py` explicitly imports the
**fictional** example dataset; it is never run automatically.

`docker-compose.yml` retains the existing PostGIS service and named data volume.
The Dockerfile packages the API, scripts and migrations. It runs the API as a
non-root user and needs runtime `DATABASE_URL` configuration. Local `.env` files
and TLS keys are excluded from the build context. The Docker image has not been
built as part of this restructure.

Run `pytest -m 'not integration'` for isolated application tests. Repository tests
use `TEST_DATABASE_URL` and create/delete a disposable database. Migration tests
cover fresh creation, repeat upgrades and preservation of existing café records.
Browser fixtures are in `tests/api/browser_map.cjs` and
`tests/api/browser_pagination.cjs`; they mock APIs and public tiles.

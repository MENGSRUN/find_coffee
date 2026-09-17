# Spring-style MVC project structure

This is a Python/FastAPI implementation of the layers in the Spring Boot example.
The Python application package is `app/`; it plays the role of the Java application
package. The standard entry point stays `uvicorn app.main:app`. The code uses Python
modules and FastAPI dependency injection rather than Java annotations or Maven.

```text
find_coffee/
├── app/
│   ├── main.py                         # Application factory and ASGI entry point
│   ├── base/
│   │   ├── request.py                  # Shared request-validation policy
│   │   └── pagination.py               # Shared paging calculations
│   ├── config/
│   │   ├── settings.py                 # Environment settings and resource paths
│   │   ├── database.py                 # Psycopg connections
│   │   ├── schema.py                   # Programmatic Alembic setup
│   │   └── dependencies.py             # Resolve services for controllers
│   ├── constant/
│   │   └── routing.py                  # ORS endpoint, profiles, snapping limit
│   ├── controller/
│   │   ├── router.py                   # Assemble versioned routes
│   │   ├── web_controller.py           # Serve the browser view
│   │   ├── places_controller.py        # Configuration and nearby searches
│   │   └── roads_controller.py         # Selected café routes
│   ├── entity/
│   │   └── cafe.py                     # Café record and import validation
│   ├── exception/
│   │   ├── errors.py                   # Application errors
│   │   └── handlers.py                 # HTTP exception advice
│   ├── model/
│   │   ├── request/
│   │   │   ├── place_request.py        # NearbyRequest
│   │   │   └── road_request.py         # RouteRequest
│   │   ├── response/
│   │   │   └── cafe_response.py        # Response mapping, including safe OSM IDs
│   │   └── projection/
│   │       └── search_query.py         # Immutable service inputs
│   ├── repository/
│   │   ├── contracts.py                # CoffeeRepository protocol
│   │   └── place_repository.py         # PostGIS implementation
│   ├── security/
│   │   └── http_security.py            # Browser security/privacy headers
│   ├── service/
│   │   ├── place_service.py            # Nearby, walking-area search and ranking
│   │   ├── road_service.py             # Selected-route use case
│   │   ├── routing_gateway.py          # Routing capability contract
│   │   ├── ors_client.py               # Hosted ORS HTTP adapter
│   │   └── location_service.py         # Overpass download and normalization
│   ├── utils/
│   │   └── gis/
│   │       ├── geometry.py             # WGS84 validation
│   │       └── geojson.py              # CSV/GeoJSON exchange
│   └── resources/
│       ├── static/                    # HTML, CSS, JS and local map libraries
│       └── database/
│           ├── migrations/             # Single source of schema changes
│           │   ├── env.py
│           │   ├── README.md
│           │   ├── script.py.mako
│           │   └── versions/
│           │       ├── 0001_initial.py
│           │       └── 0002_cafe_details.py
│           └── queries/                # Data operations, not schema setup
│               ├── upsert.sql
│               ├── import_staging.sql
│               └── nearest_example.sql
├── tests/                             # API/browser, service, repository and GIS checks
├── scripts/                           # Data import/download and local TLS utilities
├── data/
├── examples/
├── docs/
├── .env
├── .env.example
├── alembic.ini
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
├── ruff.toml
├── Dockerfile
├── docker-compose.yml
└── README.md
```

Python package directories contain `__init__.py`. Unimplemented placeholder modules
have been removed; add feature modules when they have working code. Uvicorn handles
logging directly; use `--no-access-log` to keep request URLs out of access logs.

## Mapping to the Spring Boot example

| Spring concept | Python implementation |
| --- | --- |
| Application class | `app/main.py`, with `create_app()` and `app` |
| Controller / `@RestController` | FastAPI routers in `controller/` |
| Service / `@Service` | Use-case classes in `service/` |
| Repository | Contract plus Psycopg/PostGIS adapter in `repository/` |
| Entity | Immutable `Cafe` dataclass in `entity/` |
| Request models / validation | Pydantic DTOs inheriting `BaseRequest` |
| Response models | Explicit response mapping in `model/response/` |
| Configuration / dependency injection | `config/` and FastAPI `Depends` |
| Exception advice | Central handlers in `exception/handlers.py` |
| Security configuration | HTTP middleware in `security/` |
| Resources / view | Browser UI and SQL in `resources/` |

The entity is a Python dataclass, not a SQLAlchemy ORM entity. SQL remains explicit
in the repository. There is no authentication feature implied by the security package.
Shared base code covers actual common validation and pagination; controllers and
services do not need empty parent classes to participate in this layout.

## Database organization

All database resources live in `app/resources/database/`:

- `migrations/` creates and evolves tables, constraints, and indexes. Alembic records
  applied revisions in `alembic_version`. Add a new revision for each schema change.
- `queries/` contains reusable data operations and DataGrip examples. These files do
  not replace migrations.
- `app/entity/` describes Python records used by the application. It does not create
  tables or automatically synchronize the database schema.

The duplicate `001_schema.sql` was removed. Both `alembic upgrade head` and
`python -m scripts.data init-db` now apply the same migrations. Root `alembic.ini`
points at the nested migration directory. Existing revision IDs and records are
unchanged; moving these files requires no database reset.

## Request flow and responsibilities

A request reaches a controller, where Pydantic validates its DTO. Dependency injection
provides an application-scoped service. The service works through the repository and
routing contracts. The PostGIS repository executes spatial SQL; the ORS adapter sends
hosted routing requests. Response mapping serializes the result, and exception advice
converts application errors into the existing safe HTTP responses.

The view remains the HTML/JavaScript map app. GPS, compass, route progress, marker
clustering, map-area search and saved cafés keep their existing behavior. Static files
are served at `/static/...` even though their filesystem location has changed.

## Running and migrating after the refactor

Stop the old server before replacing/reloading the moved packages, then restart with
the same command. For example:

```bash
uvicorn app.main:app --no-access-log --host 0.0.0.0 --port 8443 \
  --ssl-certfile .local-tls/server.crt --ssl-keyfile .local-tls/server.key
```

The refactor adds no database migration, dependencies, or environment variables.
Existing migrations and data commands still work:

```bash
alembic upgrade head
python -m scripts.data --help
```

DataGrip scripts now live under `app/resources/database/queries/`. Existing API paths remain
`/api/v1/config`, `/api/v1/nearby`, and `/api/v1/route`, with `/api` aliases preserved.
Docker copies `app/`, including its resources, so the Docker entry point is unchanged.
`.env`, downloaded datasets, certificates and database records are not moved.

Internal Python import paths changed: update any personal scripts importing the old
`app.api`, `app.core`, `app.models`, `app.schemas`, `app.services`, `app.repositories`,
or `app.gis` modules. The project's scripts, tests and documentation use the new paths.

## Verification

```bash
ruff check .
ruff format --check .
pytest -m 'not integration'
node tests/api/route_progress.cjs
```

Browser fixtures load `app/resources/static/`. See `docs/PHONE.md` for Playwright setup.
PostGIS integration tests still use a separate, temporary database when
`TEST_DATABASE_URL` is provided. Architecture tests guard services and entities
against controller, framework and concrete repository dependencies.

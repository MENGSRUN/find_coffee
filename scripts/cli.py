"""Command-line entry point."""

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

from app.gis.geojson import read_cafes
from app.repositories.place_repository import import_cafes, init_db, nearest
from app.services.location_service import DEFAULT_OVERPASS_URL, download


def parser() -> argparse.ArgumentParser:
    app = argparse.ArgumentParser(
        description="Find Cambodian cafés using OpenStreetMap and PostGIS"
    )
    commands = app.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Start the mobile web UI and nearby API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--ssl-certfile", type=Path)
    serve.add_argument("--ssl-keyfile", type=Path)
    fetch = commands.add_parser("download", help="Download Cambodia cafés as CSV and point GeoJSON")
    fetch.add_argument("--output-dir", type=Path, default=Path("data"))
    fetch.add_argument("--overwrite", action="store_true", help="Replace existing generated files")
    commands.add_parser("init-db", help="Create the PostGIS extension, tables, and spatial index")
    ingest = commands.add_parser(
        "import-data", help="Validate and upsert a CSV or point GeoJSON file"
    )
    ingest.add_argument("path", type=Path)
    search = commands.add_parser("nearest", help="Find the closest cafés by straight-line distance")
    search.add_argument("--lat", type=float, required=True)
    search.add_argument("--lon", type=float, required=True)
    search.add_argument("--limit", type=int, default=5)
    search.add_argument("--radius-m", type=float, help="Optional maximum distance in meters")
    search.add_argument("--json", action="store_true", help="Print machine-readable results")
    return app


def main(argv: list[str] | None = None) -> int:
    load_dotenv(Path.cwd() / ".env")  # Existing environment variables take precedence.
    args = parser().parse_args(argv)
    try:
        if args.command == "serve":
            import uvicorn

            from app.core.logging import UVICORN_LOG_OPTIONS
            from app.main import create_app

            if bool(args.ssl_certfile) != bool(args.ssl_keyfile):
                raise ValueError("Supply both --ssl-certfile and --ssl-keyfile for HTTPS")
            if not 1 <= args.port <= 65535:
                raise ValueError("port must be between 1 and 65535")
            for path in (args.ssl_certfile, args.ssl_keyfile):
                if path and not path.is_file():
                    raise ValueError(f"TLS file does not exist: {path}")
            uvicorn.run(
                create_app(),
                host=args.host,
                port=args.port,
                ssl_certfile=str(args.ssl_certfile) if args.ssl_certfile else None,
                ssl_keyfile=str(args.ssl_keyfile) if args.ssl_keyfile else None,
                **UVICORN_LOG_OPTIONS,
            )
            return 0
        if args.command == "download":
            count = download(
                args.output_dir, os.getenv("OVERPASS_URL", DEFAULT_OVERPASS_URL), args.overwrite
            )
            print(f"Downloaded {count} cafés to {args.output_dir.resolve()}")
            print("© OpenStreetMap contributors — ODbL. See metadata.json for source details.")
            return 0
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise ValueError("Set DATABASE_URL in .env or your environment; see .env.example")
        if args.command == "init-db":
            init_db(dsn)
            print("PostGIS schema is ready.")
        elif args.command == "import-data":
            count = import_cafes(dsn, read_cafes(args.path))
            print(f"Imported/updated {count} café records.")
        else:
            rows = nearest(dsn, args.lat, args.lon, args.limit, args.radius_m)
            if args.json:
                print(json.dumps(rows, ensure_ascii=False, indent=2))
            elif not rows:
                print("No cafés found. Check your import or increase the search radius.")
            else:
                for index, row in enumerate(rows, start=1):
                    print(
                        f"{index}. {row['name']} — {row['distance_m']:.0f} m "
                        f"({row['latitude']:.6f}, {row['longitude']:.6f})"
                    )
    except requests.RequestException as exc:
        status = exc.response.status_code if exc.response is not None else None
        detail = f"HTTP {status}" if status else "network failure or timeout"
        print(
            f"Download failed ({detail}). Wait before retrying; check OVERPASS_URL.",
            file=sys.stderr,
        )
        return 1
    except psycopg.Error as exc:
        # Connection errors can contain credentials; only report server's primary message.
        message = (
            exc.diag.message_primary or "Connection failed; check DATABASE_URL and database status"
        )
        print(f"Database error: {message}", file=sys.stderr)
        return 1
    except (ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0

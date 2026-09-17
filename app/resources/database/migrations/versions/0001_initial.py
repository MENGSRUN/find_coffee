"""Initial café/PostGIS schema, also adopts the existing project schema."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = """
-- Run in the intended database. Safe to repeat for the initial schema.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.coffee_shops (
    osm_type TEXT NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id BIGINT NOT NULL CHECK (osm_id > 0),
    name TEXT NOT NULL DEFAULT '',
    name_en TEXT NOT NULL DEFAULT '',
    name_km TEXT NOT NULL DEFAULT '',
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    location geography(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    ) STORED,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS coffee_shops_location_idx
ON public.coffee_shops USING GIST (location);

-- DataGrip imports the seven CSV columns here before an explicit merge.
CREATE TABLE IF NOT EXISTS public.coffee_shop_import (
    osm_type TEXT NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
    osm_id BIGINT NOT NULL CHECK (osm_id > 0),
    name TEXT,
    name_en TEXT,
    name_km TEXT,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    PRIMARY KEY (osm_type, osm_id)
);
"""


def upgrade():
    for statement in SCHEMA.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade():
    raise RuntimeError(
        "The initial café baseline cannot be downgraded automatically; this would delete café data."
    )

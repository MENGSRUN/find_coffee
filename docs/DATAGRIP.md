# Import Cambodia café data through DataGrip

This guide uses the project's generated CSV. Python can download the data without
connecting to PostgreSQL; DataGrip handles the database import.

## 1. Prepare the dataset and database

Follow the environment setup in [README.md](../README.md), start the database, and run:

```bash
python -m scripts.data download
```

The downloader writes `data/cambodia_cafes.csv`, `data/cambodia_cafes.geojson`, and
`data/metadata.json`. Use CSV for this DataGrip workflow. Keep metadata with the dataset.

For an offline demo, use `examples/sample_cafes.csv` in a separate demo database.
Every record in that file is fictional.

## 2. Connect DataGrip

Add a **PostgreSQL** data source. With the unchanged `.env.example` settings:

| Setting | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5433` |
| Database | `coffee` |
| User | `coffee` |
| Password | Value of `POSTGRES_PASSWORD` in your `.env` |

Download the PostgreSQL JDBC driver if DataGrip requests it. Click **Test Connection**.
If you changed the environment settings or are using an existing server, use those values.

From the project root with the virtual environment active, create or update the
schema using the versioned migrations:

```bash
alembic upgrade head
```

This uses `DATABASE_URL` from `.env`; ensure it selects the same database as DataGrip.
Migration files live in `app/resources/database/migrations/`. Refresh the `public`
schema in DataGrip, then open a query console for this database.

Verify the selected database and extension:

```sql
SELECT current_database(), PostGIS_Version();
```

You should see `coffee_shops` and `coffee_shop_import`. Use the staging table for imports.

## 3. Clear only the previous staging batch

Before loading another CSV, clear the staging table. This does not remove application cafés:

```sql
TRUNCATE TABLE public.coffee_shop_import;
```

Commit this statement if DataGrip is using manual transaction mode. Keep staging work
to one importer at a time; this starter uses a shared staging table.

## 4. Import the CSV

1. Right-click **public.coffee_shop_import** in Database Explorer.
2. Choose **Import/Export → Import Data from File(s)**.
3. Select `data/cambodia_cafes.csv`.
4. Select the existing table `public.coffee_shop_import`, rather than creating a new one.
5. Use **UTF-8**, a **comma** separator, double-quote text quoting, and **First row is header**.
6. Map the seven required source columns to identically named target columns:

| CSV | PostgreSQL type |
| --- | --- |
| `osm_type` | `text` |
| `osm_id` | `bigint` |
| `name` | `text` |
| `name_en` | `text` |
| `name_km` | `text` |
| `latitude` | `double precision` |
| `longitude` | `double precision` |

Inspect the preview: Khmer characters should be readable, quoted commas should stay
inside names, and every row should match the CSV header. Leave conversion-error-to-NULL
behavior disabled so invalid coordinates are reported. Empty name fields may be NULL;
the merge converts them to empty strings.

Apply the import. Check its completion/error report and commit it if needed. Do not
merge a partially successful upload: fix the file/settings, clear staging, and reimport.

The original Overpass Turbo CSV from the conversation uses different headers. If using
that export, map `@type → osm_type`, `@id → osm_id`, `name:en → name_en`,
`name:km → name_km`, `@lat → latitude`, and `@lon → longitude`; `name` stays unchanged.
The Python importer itself expects normalized headers from this project's downloader.

## 5. Inspect and merge

```sql
SELECT COUNT(*) AS staged_cafes FROM public.coffee_shop_import;

SELECT osm_type, osm_id, name, name_km, latitude, longitude
FROM public.coffee_shop_import
ORDER BY osm_type, osm_id
LIMIT 20;
```

Compare the staging count to `count` in `data/metadata.json` for a generated download.
Run the entire [`import_staging.sql`](../app/resources/database/queries/import_staging.sql)
file. It inserts or updates records by OSM type/ID and leaves staging available for review.
On an error inside that script, issue `ROLLBACK;` before fixing and retrying.

Verify the result:

```sql
SELECT COUNT(*) AS stored_cafes FROM public.coffee_shops;

SELECT name, ST_AsText(location::geometry) AS point_wkt
FROM public.coffee_shops
ORDER BY osm_type, osm_id
LIMIT 10;
```

`POINT(104... 11...)` demonstrates longitude/latitude order for a Phnom Penh location.
Stored counts may exceed the current staging count because refreshes do not delete old records.

## 6. Run a nearest search

Run [`nearest_example.sql`](../app/resources/database/queries/nearest_example.sql).
Change the example longitude/latitude and the `5000` meter radius as needed. Remove
the `WHERE` clause to search the whole imported dataset.

For visual inspection, select `location::geometry AS geom` in a query and use DataGrip's
geographic viewer if available in your version. Numeric `distance_m` is the authoritative
query output; the example does not calculate a walking route.

## GeoJSON alternative

The CLI can import the downloader's point GeoJSON directly:

```bash
python -m scripts.data import-data data/cambodia_cafes.geojson
```

DataGrip can then inspect the same `coffee_shops` table. An arbitrary GeoJSON
FeatureCollection is not interchangeable with a seven-column CSV import; polygon
geometry and nested properties require explicit conversion first.

Reference: [JetBrains DataGrip import documentation](https://www.jetbrains.com/help/datagrip/import-data.html).

### Optional business details

Run `alembic upgrade head` before importing the extended CSV. The downloader now also
exports `address`, `opening_hours`, `phone`, and `website`. Map those four columns to
the identically named staging columns when present; leave them NULL for legacy files.
The merge script preserves existing details for missing/blank values. Clear the staging
table before each batch as above. Detail values are community records, not verified
opening status or contact information.

# Visualize the current PostGIS data in QGIS

QGIS is an optional desktop tool in Compose's `tools` profile. The browser desktop
uses [Kartoza's QGIS image](https://github.com/kartoza/qgis-desktop-docker), pinned
to `3.44.9`. The image serves HTTP on container port 8443; this project maps it to
**http://localhost:6080**. It does not use the FastAPI HTTPS port.

## Start manually

From the project root, with your existing `.env`:

```bash
docker compose --profile tools up -d qgis
```

The first launch downloads the desktop image and may take some time. Compose starts
`db` if necessary and waits for its health check. It uses the existing `coffee_data`
volume. No database import or migration runs as part of launching QGIS.

Open **http://localhost:6080** and wait for QGIS. If needed, launch QGIS from the
desktop's applications menu. Set `QGIS_PORT` in `.env` to change the host port.

This local-only desktop explicitly uses `QGIS_DESKTOP_AUTH_MODE=none` and is bound
to `127.0.0.1`, so it opens without a username or password prompt. Do not change
the port binding to `0.0.0.0` while authentication is disabled.
Outbound access is enabled for the database and online basemaps. No host display
socket, Docker socket, or extra network capability is required.

If a browser login dialog remains after updating Compose, recreate the QGIS service
and then reload the page:

```bash
docker compose --profile tools up -d --force-recreate qgis
```

## Connect to your database

In QGIS, open **Data Source Manager → PostgreSQL → New** (or right-click
**PostgreSQL → New Connection** in the Browser panel).

| Setting | Value |
| --- | --- |
| Name | Find Coffee PostGIS |
| Host | `db` |
| Port | `5432` |
| Database | Your `POSTGRES_DB` value, default `coffee` |
| Username | Your `POSTGRES_USER` value, default `coffee` |
| Password | Your `POSTGRES_PASSWORD` value from `.env` |
| SSL mode | Disable for this local Docker database |

Click **Test Connection**, save, and connect. The password is entered in QGIS;
Compose does not copy the app's `.env` or ORS key into this container.

Use `db:5432` here because QGIS is in Docker. If you install QGIS directly on your
computer instead, connect to `localhost:5433` (or your `POSTGRES_PORT`).

## Display the cafés

1. Expand `public` and add `coffee_shops`, using its `location` spatial column.
2. If prompted for a unique identifier, select the composite key `osm_type` and
   `osm_id`. OSM IDs alone can repeat across node, way, and relation types.
3. Right-click the layer → **Zoom to Layer**.
4. Open its attribute table to inspect café names, coordinates, and business details.
5. Under **Layer Properties → Labels**, select single labels using `name`.
6. Optionally add **Browser → XYZ Tiles → OpenStreetMap**, below the cafés layer.
   The online background requires internet access; the database points do not.

`location` is `geography(Point, 4326)`. If it is not offered as a spatial layer,
use **Database → DB Manager**, connect to the same database, open SQL Window,
and load this read-only query as a layer:

```sql
SELECT osm_type || '/' || osm_id::text AS feature_id,
       name, name_en, name_km, address, opening_hours, phone, website,
       location::geometry(Point, 4326) AS geom
FROM public.coffee_shops;
```

Select `feature_id` as the unique column and `geom` as geometry. This query casts
the existing geography for visualization without changing the table. The import
staging table `coffee_shop_import` has no spatial column and is not the map layer.

If no cafés appear, check that your data was imported into this database. QGIS
shows the current database records, not the app's temporary ORS walking polygons.

## Save and stop

Save QGIS projects as `.qgz` files under `/home/user`, outside `/home/user/data`.
The `qgis_home` volume preserves settings and projects. Downloaded project data is
available at `/home/user/data` as read-only files, including the café GeoJSON.

```bash
docker compose --profile tools stop qgis
```

This stops QGIS while leaving PostGIS running. Avoid `docker compose down -v`:
it deletes this project's named volumes, including the café database.

For startup diagnostics:

```bash
docker compose --profile tools logs --tail=100 qgis
```

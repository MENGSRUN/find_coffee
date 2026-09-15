-- Psycopg parameterized statement; the CLI executes this in one transaction per file.
INSERT INTO public.coffee_shops
    (osm_type, osm_id, name, name_en, name_km, latitude, longitude)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    name_km = EXCLUDED.name_km,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    imported_at = CURRENT_TIMESTAMP;

-- Psycopg parameterized statement; the CLI executes this in one transaction per file.
INSERT INTO public.coffee_shops
    (osm_type, osm_id, name, name_en, name_km, latitude, longitude, address, opening_hours, phone, website)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    name_km = EXCLUDED.name_km,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    address = COALESCE(EXCLUDED.address, coffee_shops.address),
    opening_hours = COALESCE(EXCLUDED.opening_hours, coffee_shops.opening_hours),
    phone = COALESCE(EXCLUDED.phone, coffee_shops.phone),
    website = COALESCE(EXCLUDED.website, coffee_shops.website),
    imported_at = CURRENT_TIMESTAMP;

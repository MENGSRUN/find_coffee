-- Run this entire file in DataGrip after importing and committing the CSV staging table.
BEGIN;

INSERT INTO public.coffee_shops
    (osm_type, osm_id, name, name_en, name_km, latitude, longitude, address, opening_hours, phone, website)
SELECT osm_type, osm_id,
       COALESCE(BTRIM(name), ''), COALESCE(BTRIM(name_en), ''), COALESCE(BTRIM(name_km), ''),
       latitude, longitude, NULLIF(BTRIM(address), ''), NULLIF(BTRIM(opening_hours), ''),
       NULLIF(BTRIM(phone), ''), NULLIF(BTRIM(website), '')
FROM public.coffee_shop_import
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

ANALYZE public.coffee_shops;
COMMIT;

SELECT COUNT(*) AS stored_cafes FROM public.coffee_shops;

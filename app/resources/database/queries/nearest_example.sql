-- Example GPS location in Phnom Penh. ST_MakePoint takes LONGITUDE, LATITUDE.
-- Remove the WHERE clause for the nearest five regardless of distance.
WITH user_position AS (
    SELECT ST_SetSRID(ST_MakePoint(104.9282, 11.5564), 4326)::geography AS location
)
SELECT c.osm_type, c.osm_id,
       COALESCE(NULLIF(c.name, ''), NULLIF(c.name_km, ''),
                NULLIF(c.name_en, ''), 'Unnamed café') AS name,
       c.latitude, c.longitude,
       ST_Distance(c.location, u.location) AS distance_m
FROM public.coffee_shops AS c
CROSS JOIN user_position AS u
WHERE ST_DWithin(c.location, u.location, 5000)
ORDER BY distance_m, c.osm_type, c.osm_id
LIMIT 5;

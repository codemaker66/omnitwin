-- Register the founder-supplied Rodin model as its own catalogue identity.
-- Physical venue quantities and the existing Banquet Chair remain untouched.
-- UUID v5: burgess-turini-18-3 / 43033bd6-17fd-599e-b305-0bd60dec57f0.
DO $registration$
DECLARE
  registered asset_definitions%ROWTYPE;
BEGIN
  INSERT INTO asset_definitions (
    id, name, category, width_m, depth_m, height_m, seat_count,
    collision_type, mesh_url, thumbnail_url
  ) VALUES (
    '7f1fb7a2-5210-57b1-9108-11255c059520', 'Burgess Turini 18/3', 'chair',
    0.420, 0.580, 0.880, 1, 'box',
    '/models/furniture/burgess-turini-18-3/v1/chair.glb',
    '/models/furniture/burgess-turini-18-3/v1/preview.webp'
  ) ON CONFLICT (id) DO NOTHING;

  -- A matching replay is inert. Never replace an incompatible identity or
  -- silently overwrite dimensions/material URLs relied on by saved layouts.
  SELECT * INTO STRICT registered FROM asset_definitions
    WHERE id = '7f1fb7a2-5210-57b1-9108-11255c059520' FOR SHARE;
  IF registered.name IS DISTINCT FROM 'Burgess Turini 18/3'
    OR registered.category IS DISTINCT FROM 'chair'
    OR registered.width_m IS DISTINCT FROM 0.420::numeric
    OR registered.depth_m IS DISTINCT FROM 0.580::numeric
    OR registered.height_m IS DISTINCT FROM 0.880::numeric
    OR registered.seat_count IS DISTINCT FROM 1
    OR registered.collision_type IS DISTINCT FROM 'box'
    OR registered.mesh_url IS DISTINCT FROM '/models/furniture/burgess-turini-18-3/v1/chair.glb'
    OR registered.thumbnail_url IS DISTINCT FROM '/models/furniture/burgess-turini-18-3/v1/preview.webp'
  THEN
    RAISE EXCEPTION 'BURGESS_TURINI_CATALOGUE_CONFLICT: existing asset identity is incompatible'
      USING ERRCODE = '23514';
  END IF;
END
$registration$;

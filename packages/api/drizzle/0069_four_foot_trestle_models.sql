-- Two founder-supplied 4ft cloth variants receive separate catalogue identities.
-- No existing table, physical stock, timestamp or saved placement is changed.
-- UUID v5 namespace: 43033bd6-17fd-599e-b305-0bd60dec57f0.
DO $registration$
DECLARE
  expected record;
  registered asset_definitions%ROWTYPE;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('b55671ff-925d-573f-bf11-359e15736557', 'trestle-4ft-black', '4ft Trestle Table (Black Cloth)'),
      ('166ead7c-6eba-5462-8380-519e9ba8e4bd', 'trestle-4ft-white', '4ft Trestle Table (White Cloth)')
    ) AS variants(id, slug, name) ORDER BY id
  LOOP
    INSERT INTO asset_definitions (
      id, name, category, width_m, depth_m, height_m, seat_count,
      collision_type, mesh_url, thumbnail_url
    ) VALUES (
      expected.id::uuid, expected.name, 'table', 1.220, 0.760, 0.740, NULL, 'box',
      '/models/furniture/' || expected.slug || '/v1/model.glb',
      '/models/furniture/' || expected.slug || '/v1/preview.webp'
    ) ON CONFLICT (id) DO NOTHING;

    SELECT * INTO STRICT registered FROM asset_definitions
      WHERE id = expected.id::uuid FOR SHARE;
    IF registered.name IS DISTINCT FROM expected.name
      OR registered.category IS DISTINCT FROM 'table'
      OR registered.width_m IS DISTINCT FROM 1.220::numeric
      OR registered.depth_m IS DISTINCT FROM 0.760::numeric
      OR registered.height_m IS DISTINCT FROM 0.740::numeric
      OR registered.seat_count IS NOT NULL
      OR registered.collision_type IS DISTINCT FROM 'box'
      OR registered.mesh_url IS DISTINCT FROM ('/models/furniture/' || expected.slug || '/v1/model.glb')
      OR registered.thumbnail_url IS DISTINCT FROM ('/models/furniture/' || expected.slug || '/v1/preview.webp')
    THEN
      RAISE EXCEPTION 'FOUR_FOOT_TRESTLE_CATALOGUE_CONFLICT: incompatible asset %', expected.id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END
$registration$;

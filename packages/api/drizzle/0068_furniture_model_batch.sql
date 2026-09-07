-- Register the founder-supplied furniture batch and upgrade matching model URLs.
-- Physical identities, creation timestamps, venue stock and saved layouts survive.
-- New UUIDs are v5(slug, 43033bd6-17fd-599e-b305-0bd60dec57f0).
-- One atomic block, deterministic lock order, and inert matching replay.
DO $registration$
DECLARE
  expected record;
  registered asset_definitions%ROWTYPE;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('c0d0b2df-23de-5265-81f3-2c06af79697d', '6ft Trestle Table', 'table', 1.83, 0.76, 0.74, NULL, 'box', '/models/furniture/trestle-6ft/v1/model.glb', '/models/furniture/trestle-6ft/v1/preview.webp', true),
      ('a06f4c87-0ad6-5573-85a4-025276c2de03', 'Poseur Table (Black)', 'table', 0.6, 0.6, 1.05, NULL, 'cylinder', '/models/furniture/poseur-table-black/v1/model.glb', '/models/furniture/poseur-table-black/v1/preview.webp', true),
      ('55534f43-9515-5489-8963-f314712ae4db', 'Poseur Table (White)', 'table', 0.6, 0.6, 1.05, NULL, 'cylinder', '/models/furniture/poseur-table-white/v1/model.glb', '/models/furniture/poseur-table-white/v1/preview.webp', true),
      ('dec6b24b-d72c-5e5e-a883-cc9deed2f322', 'Platform', 'stage', 2.44, 1.22, 0.4, NULL, 'box', '/models/furniture/platform/v1/model.glb', '/models/furniture/platform/v1/preview.webp', true),
      ('e10816ab-5ae2-5925-914d-7ad60d33530f', 'Bar', 'other', 1.6, 0.61, 1.208, NULL, 'box', '/models/furniture/bar-counter/v1/model.glb', '/models/furniture/bar-counter/v1/preview.webp', true),
      ('0275b4b9-1dc9-5af1-bd28-387d314abdf2', 'Trestle Table (Black Cloth)', 'table', 1.83, 0.76, 0.74, NULL, 'box', '/models/furniture/trestle-6ft-black/v1/model.glb', '/models/furniture/trestle-6ft-black/v1/preview.webp', false),
      ('b5ff8bd6-2cf9-574e-8102-256b7442313f', 'Trestle Table (White Cloth)', 'table', 1.83, 0.76, 0.74, NULL, 'box', '/models/furniture/trestle-6ft-white/v1/model.glb', '/models/furniture/trestle-6ft-white/v1/preview.webp', false),
      ('dd53b7d4-7683-5e30-939f-d7190201e19f', '6ft Wooden Trestle Table', 'table', 1.83, 0.76, 0.74, NULL, 'box', '/models/furniture/trestle-6ft-wooden/v1/model.glb', '/models/furniture/trestle-6ft-wooden/v1/preview.webp', false),
      ('4a84c25a-a205-59d3-a821-869c99b51430', 'Round Table (Black Cloth)', 'table', 1.83, 1.83, 0.76, NULL, 'cylinder', '/models/furniture/round-table-6ft-black/v1/model.glb', '/models/furniture/round-table-6ft-black/v1/preview.webp', false),
      ('aec69e97-d577-5931-ba13-8258dbdd9050', 'Round Table (White Cloth)', 'table', 1.83, 1.83, 0.76, NULL, 'cylinder', '/models/furniture/round-table-6ft-white/v1/model.glb', '/models/furniture/round-table-6ft-white/v1/preview.webp', false),
      ('6f56f59e-b35d-5ed3-af15-c99790cf4cd0', 'Cake Cutting Table', 'table', 1.1, 1.1, 0.76, NULL, 'cylinder', '/models/furniture/cake-cutting-table/v1/model.glb', '/models/furniture/cake-cutting-table/v1/preview.webp', false),
      ('1c552d4e-35b5-5eca-be3c-7b56e294c47b', 'Ceremony Table', 'table', 1.6, 1, 0.74, NULL, 'box', '/models/furniture/ceremony-table/v1/model.glb', '/models/furniture/ceremony-table/v1/preview.webp', false),
      ('ff127eed-4a88-5274-becb-3c5e65e1810b', 'Checked Banquet Chair', 'chair', 0.48, 0.62, 0.9, 1, 'box', '/models/furniture/checked-banquet-chair/v1/model.glb', '/models/furniture/checked-banquet-chair/v1/preview.webp', false),
      ('55aed51f-aee8-5fd0-b8d0-bb11053ae2a5', 'Folding Room Divider', 'other', 4.2, 0.75, 1.8, NULL, 'box', '/models/furniture/room-divider/v1/model.glb', '/models/furniture/room-divider/v1/preview.webp', false),
      ('e7336170-233c-518e-9af2-8fa3807c0e8a', 'Round Café Table (White Cloth)', 'table', 0.9, 0.9, 0.74, NULL, 'cylinder', '/models/furniture/round-cafe-table-white/v1/model.glb', '/models/furniture/round-cafe-table-white/v1/preview.webp', false),
      ('a14d8f4d-24fd-51df-b89b-68dcab56bf0e', 'Square Café Table (White Cloth)', 'table', 1.05, 1.05, 0.74, NULL, 'box', '/models/furniture/square-cafe-table-white/v1/model.glb', '/models/furniture/square-cafe-table-white/v1/preview.webp', false),
      ('94facedd-4305-5094-af1e-d5f772f51702', 'Servery Unit', 'other', 2.05, 0.6, 0.9, NULL, 'box', '/models/furniture/servery-unit/v1/model.glb', '/models/furniture/servery-unit/v1/preview.webp', false)
    ) AS batch(id, name, category, width_m, depth_m, height_m, seat_count,
      collision_type, mesh_url, thumbnail_url, allow_url_upgrade)
    ORDER BY id
  LOOP
    INSERT INTO asset_definitions (
      id, name, category, width_m, depth_m, height_m, seat_count,
      collision_type, mesh_url, thumbnail_url
    ) VALUES (
      expected.id::uuid, expected.name, expected.category, expected.width_m,
      expected.depth_m, expected.height_m, expected.seat_count,
      expected.collision_type, expected.mesh_url, expected.thumbnail_url
    ) ON CONFLICT (id) DO NOTHING;

    SELECT * INTO STRICT registered FROM asset_definitions
      WHERE id = expected.id::uuid FOR UPDATE;
    IF registered.name IS DISTINCT FROM expected.name
      OR registered.category IS DISTINCT FROM expected.category
      OR registered.width_m IS DISTINCT FROM expected.width_m
      OR registered.depth_m IS DISTINCT FROM expected.depth_m
      OR registered.height_m IS DISTINCT FROM expected.height_m
      OR registered.seat_count IS DISTINCT FROM expected.seat_count
      OR registered.collision_type IS DISTINCT FROM expected.collision_type
      OR (registered.mesh_url IS DISTINCT FROM expected.mesh_url
        AND NOT (expected.allow_url_upgrade AND registered.mesh_url IS NULL))
      OR (registered.thumbnail_url IS DISTINCT FROM expected.thumbnail_url
        AND NOT (expected.allow_url_upgrade AND registered.thumbnail_url IS NULL))
    THEN
      RAISE EXCEPTION 'FURNITURE_BATCH_CATALOGUE_CONFLICT: incompatible asset % (%)', expected.id, expected.name
        USING ERRCODE = '23514';
    END IF;

    IF expected.allow_url_upgrade AND
      (registered.mesh_url IS DISTINCT FROM expected.mesh_url
        OR registered.thumbnail_url IS DISTINCT FROM expected.thumbnail_url)
    THEN
      UPDATE asset_definitions
        SET mesh_url = expected.mesh_url, thumbnail_url = expected.thumbnail_url
        WHERE id = expected.id::uuid;
    END IF;
  END LOOP;
END
$registration$;

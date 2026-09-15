-- Reconcile asset_definitions with the canonical catalogue.
--
-- Two things are wrong in the live catalogue table. Some canonical items were
-- never registered, because only part of the catalogue arrived by migration
-- and the rest depends on a seed run production never had; and the table
-- carries rows that are not in the catalogue at all, which surface in the
-- venue inventory register as duplicate equipment nobody can account for.
--
-- Applied in the Friday migrate step, not in window 1: the live planner reads
-- these rows until the web deploy lands, so the identities and the client that
-- knows about them change together.
--
-- What this never does: delete a catalogue identity, or rewrite an existing
-- one. A saved layout, a counted stock row and an immutable inventory receipt
-- all point at these ids, so a row that is not in the catalogue is renamed
-- (visibly retired) rather than removed, and its id, timestamps and every
-- reference survive. Replaying the migration is inert.
--
-- UUID v5 namespace for every id below: 43033bd6-17fd-599e-b305-0bd60dec57f0,
-- computed from the slug in @omnitwin/types/asset-catalogue.ts. This list is
-- checked against that module by
-- packages/api/src/__tests__/catalogue-reconcile-migration.test.ts, so the two
-- cannot drift apart unnoticed.
DO $reconcile$
DECLARE
  expected record;
  registered asset_definitions%ROWTYPE;
  legacy record;
  canonical uuid[] := ARRAY[]::uuid[];
  added integer := 0;
  retired integer := 0;
  referenced integer := 0;
BEGIN
  -- Phase 1: register every catalogue item that is missing.
  FOR expected IN
    SELECT * FROM (VALUES
      ('a1ef4d89-7786-5878-bee1-87b3fac28200', '6ft Round Table', 'table', 1.830, 1.830, 0.760, 10, 'cylinder', NULL, NULL),
      ('c0d0b2df-23de-5265-81f3-2c06af79697d', '6ft Trestle Table', 'table', 1.830, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-6ft/v1/model.glb', '/models/furniture/trestle-6ft/v1/preview.webp'),
      ('7b423ca2-9714-5cb2-919c-e938a5c39933', '4ft Trestle Table', 'table', 1.220, 0.760, 0.740, NULL, 'box', NULL, NULL),
      ('19d030aa-bc18-5665-8561-1e26e0679fe3', 'Poseur Table', 'table', 0.600, 0.600, 1.050, NULL, 'cylinder', NULL, NULL),
      ('a06f4c87-0ad6-5573-85a4-025276c2de03', 'Poseur Table (Black)', 'table', 0.600, 0.600, 1.050, NULL, 'cylinder', '/models/furniture/poseur-table-black/v1/model.glb', '/models/furniture/poseur-table-black/v1/preview.webp'),
      ('55534f43-9515-5489-8963-f314712ae4db', 'Poseur Table (White)', 'table', 0.600, 0.600, 1.050, NULL, 'cylinder', '/models/furniture/poseur-table-white/v1/model.glb', '/models/furniture/poseur-table-white/v1/preview.webp'),
      ('4dfcae64-b6e3-54f8-817f-af041edab935', 'Banquet Chair', 'chair', 0.450, 0.450, 0.900, 1, 'box', NULL, NULL),
      ('7f1fb7a2-5210-57b1-9108-11255c059520', 'Burgess Turini 18/3', 'chair', 0.420, 0.580, 0.880, 1, 'box', '/models/furniture/burgess-turini-18-3/v1/chair.glb', '/models/furniture/burgess-turini-18-3/v1/preview.webp'),
      ('dec6b24b-d72c-5e5e-a883-cc9deed2f322', 'Platform', 'stage', 2.440, 1.220, 0.400, NULL, 'box', '/models/furniture/platform/v1/model.glb', '/models/furniture/platform/v1/preview.webp'),
      ('d5273408-6b5c-5f4c-b12c-3f61fe3c7a51', 'Narrow Platform', 'stage', 2.440, 1.020, 0.400, NULL, 'box', NULL, NULL),
      ('b05eaa9b-c25e-52ef-9d59-c2913c23f9b8', 'Parquet Dance Floor Panel', 'stage', 0.910, 0.910, 0.050, NULL, 'box', NULL, NULL),
      ('26e25cd4-ae3e-537d-9ac0-66021f925cdd', 'Projector Screen', 'av', 2.500, 0.600, 1.800, NULL, 'box', NULL, NULL),
      ('6907e1d9-33d6-5910-b55f-78a77727d6b0', 'Laser Projector', 'av', 0.550, 0.350, 0.100, NULL, 'box', NULL, NULL),
      ('a75a0467-c6ec-5d57-aa2d-55a1f89990ce', 'Laptop', 'av', 0.360, 0.250, 0.250, NULL, 'box', NULL, NULL),
      ('b74b2ea9-ddee-5a0c-98f5-964d29223bb6', 'Table Microphone', 'av', 0.100, 0.100, 0.250, NULL, 'box', NULL, NULL),
      ('06ecec63-7d51-559c-be69-0058c4dad11f', 'Mic Stand', 'av', 0.500, 0.500, 1.600, NULL, 'box', NULL, NULL),
      ('dfcdcdec-a772-5703-bdaa-af4d44d1e0f9', 'Lectern', 'lectern', 0.600, 0.500, 1.150, NULL, 'box', NULL, NULL),
      ('edc002d8-77a5-508a-bd5d-a5dc9ec74b5e', 'Black Table Cloth', 'decor', 0.500, 0.500, 0.010, NULL, 'box', NULL, NULL),
      ('22a9184e-694e-5458-af23-4b95ed37ceeb', 'White Table Cloth', 'decor', 0.500, 0.500, 0.010, NULL, 'box', NULL, NULL),
      ('1797ad4e-89c2-5895-a3e8-9af85ec110c0', 'Dinner Place Setting', 'decor', 0.350, 0.350, 0.080, NULL, 'box', NULL, NULL),
      ('e10816ab-5ae2-5925-914d-7ad60d33530f', 'Bar', 'other', 1.600, 0.610, 1.208, NULL, 'box', '/models/furniture/bar-counter/v1/model.glb', '/models/furniture/bar-counter/v1/preview.webp'),
      ('b55671ff-925d-573f-bf11-359e15736557', '4ft Trestle Table (Black Cloth)', 'table', 1.220, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-4ft-black/v1/model.glb', '/models/furniture/trestle-4ft-black/v1/preview.webp'),
      ('166ead7c-6eba-5462-8380-519e9ba8e4bd', '4ft Trestle Table (White Cloth)', 'table', 1.220, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-4ft-white/v1/model.glb', '/models/furniture/trestle-4ft-white/v1/preview.webp'),
      ('0275b4b9-1dc9-5af1-bd28-387d314abdf2', 'Trestle Table (Black Cloth)', 'table', 1.830, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-6ft-black/v1/model.glb', '/models/furniture/trestle-6ft-black/v1/preview.webp'),
      ('b5ff8bd6-2cf9-574e-8102-256b7442313f', 'Trestle Table (White Cloth)', 'table', 1.830, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-6ft-white/v1/model.glb', '/models/furniture/trestle-6ft-white/v1/preview.webp'),
      ('dd53b7d4-7683-5e30-939f-d7190201e19f', '6ft Wooden Trestle Table', 'table', 1.830, 0.760, 0.740, NULL, 'box', '/models/furniture/trestle-6ft-wooden/v1/model.glb', '/models/furniture/trestle-6ft-wooden/v1/preview.webp'),
      ('4a84c25a-a205-59d3-a821-869c99b51430', 'Round Table (Black Cloth)', 'table', 1.830, 1.830, 0.760, NULL, 'cylinder', '/models/furniture/round-table-6ft-black/v1/model.glb', '/models/furniture/round-table-6ft-black/v1/preview.webp'),
      ('aec69e97-d577-5931-ba13-8258dbdd9050', 'Round Table (White Cloth)', 'table', 1.830, 1.830, 0.760, NULL, 'cylinder', '/models/furniture/round-table-6ft-white/v1/model.glb', '/models/furniture/round-table-6ft-white/v1/preview.webp'),
      ('6f56f59e-b35d-5ed3-af15-c99790cf4cd0', 'Cake Cutting Table', 'table', 1.100, 1.100, 0.760, NULL, 'cylinder', '/models/furniture/cake-cutting-table/v1/model.glb', '/models/furniture/cake-cutting-table/v1/preview.webp'),
      ('1c552d4e-35b5-5eca-be3c-7b56e294c47b', 'Ceremony Table', 'table', 1.600, 1.000, 0.740, NULL, 'box', '/models/furniture/ceremony-table/v1/model.glb', '/models/furniture/ceremony-table/v1/preview.webp'),
      ('ff127eed-4a88-5274-becb-3c5e65e1810b', 'Checked Banquet Chair', 'chair', 0.480, 0.620, 0.900, 1, 'box', '/models/furniture/checked-banquet-chair/v1/model.glb', '/models/furniture/checked-banquet-chair/v1/preview.webp'),
      ('55aed51f-aee8-5fd0-b8d0-bb11053ae2a5', 'Folding Room Divider', 'other', 4.200, 0.750, 1.800, NULL, 'box', '/models/furniture/room-divider/v1/model.glb', '/models/furniture/room-divider/v1/preview.webp'),
      ('e7336170-233c-518e-9af2-8fa3807c0e8a', 'Round Café Table (White Cloth)', 'table', 0.900, 0.900, 0.740, NULL, 'cylinder', '/models/furniture/round-cafe-table-white/v1/model.glb', '/models/furniture/round-cafe-table-white/v1/preview.webp'),
      ('a14d8f4d-24fd-51df-b89b-68dcab56bf0e', 'Square Café Table (White Cloth)', 'table', 1.050, 1.050, 0.740, NULL, 'box', '/models/furniture/square-cafe-table-white/v1/model.glb', '/models/furniture/square-cafe-table-white/v1/preview.webp'),
      ('94facedd-4305-5094-af1e-d5f772f51702', 'Servery Unit', 'other', 2.050, 0.600, 0.900, NULL, 'box', '/models/furniture/servery-unit/v1/model.glb', '/models/furniture/servery-unit/v1/preview.webp'),
      ('ea8b110e-b4a6-5185-8ee3-932d77508721', 'Chiavari Wedding Chair', 'chair', 0.410, 0.410, 0.920, 1, 'box', NULL, NULL),
      ('45bd06d4-44b4-5e8e-8df7-5ddd513feb9e', 'Red and Gold Gallery Chair', 'chair', 0.450, 0.450, 0.900, 1, 'box', NULL, NULL),
      ('34780845-a465-5abb-ab8f-953ff90bc9c1', 'Pink Chair', 'chair', 0.450, 0.450, 0.900, 1, 'box', NULL, NULL),
      ('67974103-36a8-59df-8102-13fdee55d97e', 'White Highchair', 'chair', 0.500, 0.550, 0.950, 1, 'box', NULL, NULL),
      ('f642b94e-8f3a-5fbd-bb15-8e071113f5de', 'Green Highchair', 'chair', 0.500, 0.550, 0.950, 1, 'box', NULL, NULL),
      ('f4bf707a-c565-5f52-9afb-2340b1ffbaa9', 'Blue Highchair', 'chair', 0.500, 0.550, 0.950, 1, 'box', NULL, NULL),
      ('1ca08680-3741-5119-9db9-b7aa1c554e2e', 'Wooden Highchair', 'chair', 0.500, 0.550, 0.950, 1, 'box', NULL, NULL),
      ('11d806d6-ac85-5519-b25f-78e86b9141ce', '6ft × 4ft Staging Deck', 'stage', 1.830, 1.220, 0.400, NULL, 'box', NULL, NULL),
      ('5276f0e8-533c-5aa3-acf2-a9631d3d8cef', '6ft × 3ft Staging Deck', 'stage', 1.830, 0.910, 0.400, NULL, 'box', NULL, NULL),
      ('83681742-320e-5429-af35-e11fb190f9a1', 'Hisense Television', 'av', 1.500, 0.550, 1.800, NULL, 'box', NULL, NULL),
      ('c37b53d1-ab5c-5ae4-8ed5-50c069ef593f', 'Handheld Microphone', 'av', 0.050, 0.050, 0.230, NULL, 'box', NULL, NULL),
      ('48850450-aec6-5c31-b9fd-68414bc726e8', 'Lapel Microphone', 'av', 0.050, 0.050, 0.100, NULL, 'box', NULL, NULL)
    ) AS catalogue(id, name, category, width_m, depth_m, height_m, seat_count,
      collision_type, mesh_url, thumbnail_url)
    ORDER BY id
  LOOP
    canonical := array_append(canonical, expected.id::uuid);
    INSERT INTO asset_definitions (
      id, name, category, width_m, depth_m, height_m, seat_count,
      collision_type, mesh_url, thumbnail_url
    ) VALUES (
      expected.id::uuid, expected.name, expected.category, expected.width_m::numeric,
      expected.depth_m::numeric, expected.height_m::numeric, expected.seat_count::integer,
      expected.collision_type, expected.mesh_url, expected.thumbnail_url
    ) ON CONFLICT (id) DO NOTHING;
    IF FOUND THEN added := added + 1; END IF;

    -- A matching replay is inert. An incompatible existing identity aborts the
    -- migration rather than overwriting dimensions a saved layout relies on.
    SELECT * INTO STRICT registered FROM asset_definitions WHERE id = expected.id::uuid FOR SHARE;
    IF registered.name IS DISTINCT FROM expected.name
      OR registered.category IS DISTINCT FROM expected.category
      OR registered.width_m IS DISTINCT FROM expected.width_m::numeric
      OR registered.depth_m IS DISTINCT FROM expected.depth_m::numeric
      OR registered.height_m IS DISTINCT FROM expected.height_m::numeric
      OR registered.seat_count IS DISTINCT FROM expected.seat_count::integer
      OR registered.collision_type IS DISTINCT FROM expected.collision_type
      OR registered.mesh_url IS DISTINCT FROM expected.mesh_url
      OR registered.thumbnail_url IS DISTINCT FROM expected.thumbnail_url
    THEN
      RAISE EXCEPTION 'CATALOGUE_RECONCILE_CONFLICT: asset % does not match the canonical catalogue', expected.id
        USING ERRCODE = '23514',
          HINT = 'Reconcile asset-catalogue.ts with the stored row before migrating.';
    END IF;
  END LOOP;
  RAISE NOTICE 'catalogue reconcile: % canonical item(s) registered', added;

  -- Phase 2: retire the rows that are not in the catalogue.
  --
  -- Retirement is a rename, not a delete. Each of these ids may be pointed at
  -- by a placed object in a saved layout, by a venue's counted stock, or by an
  -- immutable inventory receipt; removing it would break a saved plan or an
  -- audit record. The suffix makes the row legible as legacy wherever it
  -- appears -- the inventory register lists every catalogue row -- while the
  -- identity, its history and its references stay intact. Reversal is a
  -- rename back. Each retirement is reported with whether anything still
  -- points at it, so the receipt says what was actually in use.
  FOR legacy IN
    SELECT a.id, a.name,
      EXISTS (SELECT 1 FROM placed_objects p WHERE p.asset_definition_id = a.id) AS placed,
      EXISTS (SELECT 1 FROM venue_inventory_stock s WHERE s.asset_definition_id = a.id) AS counted,
      EXISTS (SELECT 1 FROM venue_inventory_receipts r WHERE r.asset_definition_id = a.id) AS audited
    FROM asset_definitions a
    WHERE NOT (a.id = ANY (canonical)) AND a.name NOT LIKE '% (retired)'
    ORDER BY a.id
    FOR UPDATE OF a
  LOOP
    UPDATE asset_definitions SET name = left(legacy.name || ' (retired)', 200) WHERE id = legacy.id;
    retired := retired + 1;
    IF legacy.placed OR legacy.counted OR legacy.audited THEN
      referenced := referenced + 1;
      RAISE NOTICE 'catalogue reconcile: retired % (%) - still referenced (placed=%, stock=%, receipts=%)',
        legacy.name, legacy.id, legacy.placed, legacy.counted, legacy.audited;
    ELSE
      RAISE NOTICE 'catalogue reconcile: retired % (%) - unreferenced', legacy.name, legacy.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'catalogue reconcile: % row(s) retired, % of them still referenced', retired, referenced;
END
$reconcile$;

-- Retire the invented hallkeeper dressings from the live accessory rules.
--
-- The hallkeeper sheet does not read ACCESSORY_RULES. It reads the
-- asset_accessories TABLE (services/hallkeeper-sheet-v2-data.ts and
-- services/sheet-snapshot.ts both join it to asset_definitions). Removing the
-- invented names from the TypeScript module therefore fixes new databases and
-- leaves every already-seeded one printing "Gold Organza Runner" on a sheet
-- that sends staff to fetch dressing Trades Hall does not own. This migration
-- is the half that reaches those rows.
--
-- Separate from 0073 on purpose: 0073's catalogue reconcile has Blake's yes,
-- this deletion is decision 20 and is still his to make, so it rides or is
-- dropped on its own. Applied in the Friday migrate step only.
--
-- Safe to delete rather than rename, unlike a catalogue identity. Checked
-- before writing this:
--   * No foreign key points AT asset_accessories. It is a leaf: it references
--     asset_definitions(id) ON DELETE CASCADE, and nothing references it
--     (zero `references(() => assetAccessories)` in db/schema.ts, and no
--     `REFERENCES asset_accessories` in any migration).
--   * Nothing writes it but the seed. The only insert in the application is
--     db/seed.ts; services/hallkeeper-sheet-v2-data.ts, services/sheet-snapshot.ts
--     and services/inventory-reservation-source.ts only SELECT. The one other
--     writer is __tests__/integration.test.ts, on its own fixtures.
--   * These rows are derived data. The seed rebuilds them from ACCESSORY_RULES,
--     so a deleted row is reproducible; an asset_definitions row is not.
--
-- The ten names below are the complete set removed from ACCESSORY_RULES,
-- written out literally rather than derived as "everything not in the current
-- rules". A derived predicate would also delete a row an administrator added
-- through some future catalogue UI; this one can only ever touch these ten.
DO $accessories$
DECLARE
  -- Ten names left ACCESSORY_RULES, across fourteen rows in a single seed run
  -- (the 6ft Round Table alone carried five). A database seeded more than once
  -- holds a multiple of that, which is why the row count is reported rather
  -- than capped. If the distinct NAMES found exceed this, the WHERE clause is
  -- not what this file thinks it is: stop.
  EXPECTED_UNOWNED_NAMES constant integer := 10;
  unowned constant text[] := ARRAY[
    'Ivory Tablecloth',
    'Rectangular Ivory Tablecloth',
    'Gold Organza Runner',
    'Floral Centrepiece (low)',
    'Acrylic Table Number',
    'LED Pillar Candle',
    'Gold Chair Sash',
    'Black Stage Skirt',
    'HDMI Cable (5m)',
    'Bottled Water (500ml)'
  ];
  found_names integer := 0;
  found_rows integer := 0;
  removed integer := 0;
  found_list text;
BEGIN
  IF to_regclass('asset_accessories') IS NULL THEN
    RAISE NOTICE 'accessories reconcile: no asset_accessories table, nothing to do';
    RETURN;
  END IF;

  SELECT count(DISTINCT name), count(*), string_agg(DISTINCT name, ', ')
    INTO found_names, found_rows, found_list
    FROM asset_accessories WHERE name = ANY (unowned);

  -- Refuse a surprise, the same way 0073 does. The list is fixed, so this can
  -- only fire if someone edits the array without reading this comment.
  IF found_names > EXPECTED_UNOWNED_NAMES THEN
    RAISE EXCEPTION 'ACCESSORIES_RECONCILE_UNEXPECTED_SCOPE: % distinct names matched, expected at most %: %',
      found_names, EXPECTED_UNOWNED_NAMES, found_list
      USING ERRCODE = '23514';
  END IF;

  IF found_rows = 0 THEN
    RAISE NOTICE 'accessories reconcile: no unowned dressing rows present, nothing removed';
    RETURN;
  END IF;

  RAISE NOTICE 'accessories reconcile: removing % row(s) across % name(s): %',
    found_rows, found_names, found_list;

  DELETE FROM asset_accessories WHERE name = ANY (unowned);
  GET DIAGNOSTICS removed = ROW_COUNT;

  RAISE NOTICE 'accessories reconcile: % row(s) removed', removed;

  -- Replaying this migration finds nothing and removes nothing.
END
$accessories$;

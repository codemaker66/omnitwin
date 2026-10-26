-- The researched sizes of three chairs (planner-qol research/chair-sizes.md,
-- 26 October 2026), at Blake's ask that the planner know its chairs' real
-- sizes. 0103, after 0102; the release queue confirms the number at the merge
-- slot (renumber the tag AND the journal `when` so the migrator orders it
-- after everything merged first).
--
--   Chiavari Wedding Chair  0.41 x 0.41 x 0.92  ->  0.43 x 0.41 x 0.92
--     a UK hire supplier's Chiavari; Chiavari run 40 to 43 cm wide
--   Pink Chair              0.45 x 0.45 x 0.90  ->  0.42 x 0.58 x 0.88
--     the venue's pink chair is the Burgess Turini 18/3 (Blake, 26 October
--     2026: "Turini is the chair"), so it takes that maker's envelope
--   Wooden Highchair        0.50 x 0.55 x 0.95  ->  0.51 x 0.51 x 0.75
--     a typical wooden commercial highchair
--
-- All three stay "approximate" in @omnitwin/types: the venue's own chairs are
-- unmeasured and its makes unknown.
--
-- The catalogue reconcile (0074) registers identities and never rewrites one,
-- because saved layouts, stock rows and inventory receipts point at them. This
-- file is the deliberate exception, for these three rows' sizes only. Ids,
-- names, categories, seat counts and every reference are untouched. A saved
-- layout stores where each chair stands, not its envelope, so no chair moves;
-- it draws and collides at the researched size.
--
-- It rewrites a row only from the size 0074 registered. A row already at the
-- researched size is left as it is, so replaying is inert. A row at any other
-- size was changed by something this file does not know about: it stops and
-- names the row rather than overwrite it. A missing row is left for the
-- canonical seed, which registers it at the researched size. The file is one
-- transaction; a failed statement leaves the database as it was.
DO $sizes$
DECLARE
  chair record;
  stored asset_definitions%ROWTYPE;
BEGIN
  FOR chair IN
    SELECT * FROM (VALUES
      ('ea8b110e-b4a6-5185-8ee3-932d77508721', 0.410, 0.410, 0.920, 0.430, 0.410, 0.920),
      ('34780845-a465-5abb-ab8f-953ff90bc9c1', 0.450, 0.450, 0.900, 0.420, 0.580, 0.880),
      ('1ca08680-3741-5119-9db9-b7aa1c554e2e', 0.500, 0.550, 0.950, 0.510, 0.510, 0.750)
    ) AS sizes(id, was_width_m, was_depth_m, was_height_m, width_m, depth_m, height_m)
  LOOP
    SELECT * INTO stored FROM asset_definitions WHERE id = chair.id::uuid FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF stored.width_m = chair.width_m AND stored.depth_m = chair.depth_m AND stored.height_m = chair.height_m THEN
      CONTINUE;
    END IF;
    IF stored.width_m IS DISTINCT FROM chair.was_width_m
      OR stored.depth_m IS DISTINCT FROM chair.was_depth_m
      OR stored.height_m IS DISTINCT FROM chair.was_height_m
    THEN
      RAISE EXCEPTION 'CHAIR_SIZES_CONFLICT: asset % is % x % x %, neither the size 0074 registered nor the researched one',
        chair.id, stored.width_m, stored.depth_m, stored.height_m
        USING ERRCODE = '23514',
          HINT = 'Reconcile asset-catalogue.ts with the stored row before migrating.';
    END IF;
    UPDATE asset_definitions
      SET width_m = chair.width_m, depth_m = chair.depth_m, height_m = chair.height_m
      WHERE id = chair.id::uuid;
  END LOOP;
END
$sizes$;

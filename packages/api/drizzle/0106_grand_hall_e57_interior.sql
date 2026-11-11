-- The Grand Hall at Trades Hall Glasgow, stored at the panelled interior the
-- hall's laser scan measures (11 November 2026). Blake: "Use the measurements
-- captured from the lidar /e57 data". 0106 at journal idx 103, as the release queue assigned on 11 November 2026;
-- open PRs that also claim 0106 or 0107 (#309, #364, #365) renumber after this
-- lands, each with a later journal `when`.
--
-- Production stored the hall as 21.00 x 10.00 m. The Matterport E57 capture of
-- 11 July 2026 measures the panelled interior at 21.135 m along x by
-- 10.59 m along z, to about 2 cm (packages/web/src/components/grand-hall/
-- hall-spec.ts, HALL_LENGTH and HALL_WIDTH; tools/grand-hall-survey/README.md
-- records the method). A layout save refuses any piece centred outside the
-- stored outline (422 PLACEMENT_OUT_OF_BOUNDS, lib/placement-validation.ts),
-- and the planner's placement check uses the hand-drawn 21 x 10.5 m polygon
-- (packages/web/src/data/room-geometries.ts; only its 3D model is drawn at the
-- E57 size), so a chair the planner allowed within 0.25 m of a long wall stopped
-- the whole plan saving. This outline contains that polygon.
--
-- width_m and length_m are numeric(6,2) and are the outline's x and y extents
-- (the invariant in db/schema.ts, established by 0007), so the hall's length
-- is width_m: 21.135 is stored as 21.14, rounded up so the room never shrinks,
-- and its width is length_m, 10.59. The outline becomes the centred rectangle
-- of that size, in the shape the column already holds (x, y points in order).
-- It contains the old rectangle, so no saved layout's piece falls outside.
-- height_m stays 7.00: the scan's 6.7 m is the underside of the coffered
-- ceiling, with the dome above it, and which of those height_m means is
-- Blake's to decide.
--
-- One row, named by its id and its venue's. It is rewritten only from the size
-- production stores; a row already at the E57 interior is left as it is, so
-- replaying is inert. A row at any other size or outline was changed by
-- something this file does not know about: it stops and names the row rather
-- than overwrite it. Where the row does not exist (local, test and seeded
-- databases, whose ids are their own) nothing happens; the seed builds those
-- from the same values (db/grand-hall-e57.ts). The migrator runs this file in
-- one transaction with every other pending file, so a stop leaves the database
-- as it was.
--
-- The row is locked FOR NO KEY UPDATE, the lock an UPDATE of non-key columns
-- takes anyway: a layout save that references the room (its foreign key takes
-- FOR KEY SHARE) goes on while the migrator's transaction is open, and a lock
-- held elsewhere stops the deploy after 5 s rather than hanging it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $grand_hall$
DECLARE
  stored spaces%ROWTYPE;
  stored_outline CONSTANT jsonb := '[{"x": -10.5, "y": -5}, {"x": 10.5, "y": -5}, {"x": 10.5, "y": 5}, {"x": -10.5, "y": 5}]';
  e57_outline CONSTANT jsonb := '[{"x": -10.57, "y": -5.295}, {"x": 10.57, "y": -5.295}, {"x": 10.57, "y": 5.295}, {"x": -10.57, "y": 5.295}]';
BEGIN
  SELECT * INTO stored FROM spaces
    WHERE id = '5d903b89-acb0-4c68-8b6a-819880d8289a'::uuid
      AND venue_id = '100c31e6-e146-4df8-92bc-f3633b316bbb'::uuid
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF stored.width_m = 21.14 AND stored.length_m = 10.59 AND stored.floor_plan_outline = e57_outline THEN
    RETURN;
  END IF;
  IF stored.width_m IS DISTINCT FROM 21.00
    OR stored.length_m IS DISTINCT FROM 10.00
    OR stored.floor_plan_outline IS DISTINCT FROM stored_outline
  THEN
    RAISE EXCEPTION 'GRAND_HALL_SIZE_CONFLICT: space % is % x % m with outline %, neither the size production stored nor the E57 interior',
      stored.id, stored.width_m, stored.length_m, stored.floor_plan_outline
      USING ERRCODE = '23514',
        HINT = 'Reconcile the Grand Hall with db/grand-hall-e57.ts before migrating.';
  END IF;
  UPDATE spaces
    SET width_m = 21.14, length_m = 10.59, floor_plan_outline = e57_outline, updated_at = now()
    WHERE id = stored.id;
END
$grand_hall$;

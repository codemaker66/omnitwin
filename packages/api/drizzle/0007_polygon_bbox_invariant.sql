-- -----------------------------------------------------------------------------
-- 0007_polygon_bbox_invariant
--
-- Establishes the invariant documented in db/schema.ts:
--
--   spaces.width_m  = MAX(p.x) - MIN(p.x) over spaces.floor_plan_outline
--   spaces.length_m = MAX(p.y) - MIN(p.y) over spaces.floor_plan_outline
--
-- floor_plan_outline is now the authoritative shape of a space. This migration
-- backfills width_m and length_m for every existing row so the invariant
-- holds on live data; going forward, all writes go through the spaces route
-- handlers which run the polygon through polygonBoundingBox() on every
-- insert and update.
--
-- Idempotent: re-running produces the same values (unless the polygon
-- changes), so re-applying is safe.
-- -----------------------------------------------------------------------------

UPDATE "spaces" s
SET
  "width_m"  = bbox.w,
  "length_m" = bbox.l,
  "updated_at" = NOW()
FROM (
  SELECT
    s2.id AS id,
    ROUND((MAX((p->>'x')::numeric) - MIN((p->>'x')::numeric))::numeric, 2) AS w,
    ROUND((MAX((p->>'y')::numeric) - MIN((p->>'y')::numeric))::numeric, 2) AS l
  FROM "spaces" s2, jsonb_array_elements(s2."floor_plan_outline") AS p
  GROUP BY s2.id
) AS bbox
WHERE s."id" = bbox.id
  AND (
       s."width_m"  IS DISTINCT FROM bbox.w
    OR s."length_m" IS DISTINCT FROM bbox.l
  );

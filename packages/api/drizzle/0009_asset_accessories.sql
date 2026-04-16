-- -----------------------------------------------------------------------------
-- 0009_asset_accessories
--
-- Hallkeeper accessory rules — implied items that the hallkeeper sets up
-- alongside each placed asset. When a 6ft Round Table is placed, the
-- hallkeeper needs to set up a cloth, runner, centrepiece, candles, and
-- table number. This table stores those rules so the manifest generator
-- can expand placements into the full setup list via a single JOIN.
--
-- Previously these rules lived in a static TypeScript lookup
-- (hallkeeper-accessories.ts ACCESSORY_RULES). Moving them to the DB
-- means they're admin-editable, queryable, and don't drift when an
-- asset is renamed in the catalogue.
--
-- The seed (db/seed.ts) populates this table from the canonical catalogue.
-- Re-running the seed is safe — ON CONFLICT does nothing (idempotent).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "asset_accessories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_asset_id" uuid NOT NULL REFERENCES "asset_definitions"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "category" varchar(50) NOT NULL,
  "quantity_per_parent" integer NOT NULL DEFAULT 1,
  "phase" varchar(20) NOT NULL,
  "after_depth" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "asset_accessories_parent_idx" ON "asset_accessories" ("parent_asset_id");

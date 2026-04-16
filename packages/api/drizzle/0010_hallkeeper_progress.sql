-- -----------------------------------------------------------------------------
-- 0010_hallkeeper_progress
--
-- Per-row checkbox state for the hallkeeper events sheet. When a
-- hallkeeper ticks "Ivory Tablecloth × 5" on their tablet, this table
-- records that tick. Multiple hallkeepers see each other's ticks.
--
-- UNIQUE(config_id, row_key) ensures one tick per manifest row per config.
-- row_key is the stable manifest key (phase|zone|name|afterDepth) that
-- survives config re-saves.
--
-- ON DELETE CASCADE from configurations means deleting a config cleans
-- up its progress rows automatically.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "hallkeeper_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "row_key" varchar(300) NOT NULL,
  "checked_by" uuid REFERENCES "users"("id"),
  "checked_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "hallkeeper_progress_config_row_unique" UNIQUE ("config_id", "row_key")
);

CREATE INDEX IF NOT EXISTS "hallkeeper_progress_config_idx" ON "hallkeeper_progress" ("config_id");

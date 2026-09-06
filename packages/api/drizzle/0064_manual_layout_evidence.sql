-- Saved manual edits need new evidence without rewriting prior phase lineage.
-- Keep digest uniqueness and all existing ID-based foreign keys unchanged.
ALTER TABLE "canonical_layout_snapshots"
  DROP CONSTRAINT "canonical_layout_snapshots_config_unique";
--> statement-breakpoint
CREATE INDEX "canonical_layout_snapshots_config_created_idx"
  ON "canonical_layout_snapshots" ("configuration_id", "created_at", "id");

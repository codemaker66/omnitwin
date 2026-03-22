-- Reference loadouts — hallkeeper photo documentation
CREATE TABLE IF NOT EXISTS "reference_loadouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "name" text NOT NULL,
  "description" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "reference_loadouts_space_idx" ON "reference_loadouts" ("space_id");

-- Reference photos — linked to loadouts via file IDs
CREATE TABLE IF NOT EXISTS "reference_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "loadout_id" uuid NOT NULL REFERENCES "reference_loadouts"("id") ON DELETE CASCADE,
  "file_id" uuid NOT NULL REFERENCES "files"("id"),
  "caption" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "reference_photos_loadout_idx" ON "reference_photos" ("loadout_id");

-- -----------------------------------------------------------------------------
-- 0017_layout_urls
--
-- Human-readable URLs for configurations. Replaces the UUID-in-path URL
-- `/plan/<uuid>` with two canonical families:
--
--   - Signed-in users:  `/<username>/<slug>`   e.g. /blake/wedding-rehearsal
--   - Guests:           `/plan/<short_code>`   e.g. /plan/a7k3q9
--
-- Three independent changes land together so the read-path resolver can
-- switch over atomically:
--
--   1. users.username — URL-safe handle, mirrored from Clerk's username
--      field via the clerk-webhook route. Nullable during backfill; the
--      frontend UsernameGate prompts legacy users on next sign-in.
--
--   2. configurations.slug + configurations.short_code — the "final path
--      segment" identifier. Exactly one of these is populated per row:
--        - user-owned config  → slug     (unique per user)
--        - guest config       → short_code (globally unique, nanoid-6)
--      Backfill (0018) sets them for existing rows; this migration leaves
--      both nullable so the deploy can roll forward without breaking any
--      in-flight writes.
--
--   3. layout_aliases — every URL a config has ever resolved under. Lets
--      legacy `/plan/<uuid>` and retired slugs 301-redirect forever
--      without a separate join. `path_key` is the full normalised URL
--      identifier (`uuid:<id>` / `sc:<code>` / `u:<username>/<slug>`);
--      `retired_at IS NULL` means this alias is still the canonical
--      address, any non-null means it's a redirect-only historical record.
--
-- All three pieces are created conditional (IF NOT EXISTS / idempotent
-- indexes) so the migration is safe to re-apply against a partially-
-- applied environment.
-- -----------------------------------------------------------------------------

-- 1. users.username --------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(30);

-- Case-insensitive uniqueness: "Blake" and "blake" are the same handle.
-- Partial index skips NULL rows (backfill window).
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique_idx"
  ON "users" (lower("username"))
  WHERE "username" IS NOT NULL;

-- Shape: 3-30 chars, lowercase alphanumeric with optional single hyphens,
-- cannot start or end with hyphen. Matches Clerk's own username rules
-- and gives us URL-safe handles.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_shape'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_username_shape" CHECK (
      "username" IS NULL OR "username" ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$'
    );
  END IF;
END $$;

-- 2. configurations.slug + short_code --------------------------------------
ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "slug" varchar(60);
ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "short_code" varchar(12);

-- (user_id, slug) must be unique for live (not soft-deleted) rows.
-- Partial index: guests (user_id IS NULL) and rows without a slug yet
-- are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS "configurations_user_slug_unique"
  ON "configurations" ("user_id", lower("slug"))
  WHERE "deleted_at" IS NULL AND "user_id" IS NOT NULL AND "slug" IS NOT NULL;

-- Short codes are global: /plan/a7k3q9 must point at exactly one config.
CREATE UNIQUE INDEX IF NOT EXISTS "configurations_short_code_unique"
  ON "configurations" ("short_code")
  WHERE "deleted_at" IS NULL AND "short_code" IS NOT NULL;

-- Slug shape check — same regex family as usernames but up to 60 chars.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configurations_slug_shape'
  ) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_slug_shape" CHECK (
      "slug" IS NULL OR "slug" ~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$'
    );
  END IF;
END $$;

-- Short code shape: nanoid-style alphabet (no 0/1/i/l/o to avoid
-- visual confusion), exactly 6 chars for ~30-bit collision space.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'configurations_short_code_shape'
  ) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_short_code_shape" CHECK (
      "short_code" IS NULL OR "short_code" ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{6}$'
    );
  END IF;
END $$;

-- 3. layout_aliases --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "layout_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "path_key" text NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "layout_aliases_kind_check" CHECK ("kind" IN ('uuid', 'shortcode', 'user_slug'))
);

-- path_key is the join target from the resolver: given an incoming URL,
-- we compute the normalised key and look it up here in O(1).
CREATE UNIQUE INDEX IF NOT EXISTS "layout_aliases_path_unique"
  ON "layout_aliases" ("path_key");

-- Reverse lookup: "show me every URL this config has ever used" powers
-- rename-history diagnostics and cascade-delete cleanup.
CREATE INDEX IF NOT EXISTS "layout_aliases_config_idx"
  ON "layout_aliases" ("configuration_id");

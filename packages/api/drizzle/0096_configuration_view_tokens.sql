-- View-only links for a visitor's plan (fix-first item 11, 16 Oct 2026 brief).
--
-- An organiser with no account can send someone a link that shows their plan
-- and cannot change it. The planner address will not do: an anonymous plan's
-- configuration id is its edit capability. So each link is its own random
-- token (32 bytes, base64url), handed to the organiser once and stored here
-- only as its SHA-256. The first eight characters are kept as token_prefix so
-- a link can be recognised without being reconstructed.
--
-- Every link expires (expires_at is required): a link keeps its plan out of
-- the 72-hour sweep of unclaimed previews (services/cleanup.ts) only while it
-- works, so no anonymous plan is kept indefinitely by a forgotten link.
-- revoked_at is set when the organiser stops a link. Deleting the plan
-- deletes its links.
--
-- Additive only: one new table, no change to existing rows. The file is one
-- transaction; a failed statement leaves the database as it was.

CREATE TABLE IF NOT EXISTS "configuration_view_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "token_prefix" varchar(16) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "configuration_view_tokens_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "configuration_view_tokens_token_hash_shape" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "configuration_view_tokens_expires_after_created" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "configuration_view_tokens_configuration_idx"
  ON "configuration_view_tokens" ("configuration_id");

-- Proof that a browser created a public plan (release audit public-surface-1,
-- 25 October 2026). 0102, after 0101; the release queue confirms the number at
-- the merge slot (renumber the tag AND the journal `when` so the migrator
-- orders it after everything merged first).
--
-- Any signed-in account could claim any unowned plan by its id, and the claim
-- re-owned that plan's enquiries, so a partner who opened a guest's shared
-- /plan/<id> link took the plan and could read the guest's contact details.
-- POST /public/configurations now returns a random claim secret (32 bytes,
-- base64url) to the browser that made the plan, once, and stores only its
-- SHA-256 here; POST /configurations/:id/claim requires it and deletes the
-- row. It sits beside the plan rather than on it, so no configuration read can
-- return it. Deleting the plan deletes its secret.
--
-- Plans made before this migration have no row and can never be claimed: a
-- signed-in person keeps working on such a plan as a public draft. Nothing is
-- backfilled, because a secret no browser holds would prove nothing.
--
-- Additive only: one new table, no change to existing rows. The file is one
-- transaction; a failed statement leaves the database as it was.

CREATE TABLE IF NOT EXISTS "configuration_claim_secrets" (
  "configuration_id" uuid PRIMARY KEY NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "secret_hash" varchar(64) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "configuration_claim_secrets_secret_hash_shape" CHECK ("secret_hash" ~ '^[a-f0-9]{64}$')
);

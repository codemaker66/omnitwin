-- -----------------------------------------------------------------------------
-- 0022_user_invitations
--
-- T-088: Clerk authentication is not authorization. A valid Clerk identity can
-- only become a local Venviewer user when it matches a pre-provisioned user row,
-- a pending invitation, or an explicitly configured approved-domain policy.
--
-- Migration numbers 0019-0021 are reserved by ADR D-019 for the future VSIR-0
-- schema sequence. This security migration intentionally jumps to 0022.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "user_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255),
  "domain" varchar(255),
  "role" varchar(20) NOT NULL DEFAULT 'planner',
  "venue_id" uuid REFERENCES "venues"("id"),
  "token_hash" text UNIQUE,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "expires_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "accepted_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "user_invitations_email_or_domain_check"
    CHECK ("email" IS NOT NULL OR "domain" IS NOT NULL),
  CONSTRAINT "user_invitations_email_lower_check"
    CHECK ("email" IS NULL OR "email" = lower("email")),
  CONSTRAINT "user_invitations_domain_lower_check"
    CHECK ("domain" IS NULL OR "domain" = lower("domain")),
  CONSTRAINT "user_invitations_role_check"
    CHECK ("role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin')),
  CONSTRAINT "user_invitations_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'expired', 'revoked')),
  CONSTRAINT "user_invitations_acceptance_check"
    CHECK (
      ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "accepted_by" IS NOT NULL)
      OR ("status" <> 'accepted' AND "accepted_at" IS NULL AND "accepted_by" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "user_invitations_email_status_idx"
  ON "user_invitations" ("email", "status");

CREATE INDEX IF NOT EXISTS "user_invitations_domain_status_idx"
  ON "user_invitations" ("domain", "status");

CREATE INDEX IF NOT EXISTS "user_invitations_venue_status_idx"
  ON "user_invitations" ("venue_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_pending_email_unique"
  ON "user_invitations" (lower("email"))
  WHERE "email" IS NOT NULL AND "status" = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_pending_domain_unique"
  ON "user_invitations" (lower("domain"), "venue_id", "role")
  WHERE "domain" IS NOT NULL AND "status" = 'pending';

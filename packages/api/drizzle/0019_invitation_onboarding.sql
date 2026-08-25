-- -----------------------------------------------------------------------------
-- 0019_invitation_onboarding
--
-- Records Clerk onboarding decisions so user creation is no longer an invisible
-- side effect of presenting any valid Clerk token. Local users are now linked
-- from pre-provisioned invitation rows or created only for configured approved
-- email domains; denials are auditable.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "user_onboarding_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_id" text NOT NULL,
  "email" varchar(255),
  "decision" varchar(20) NOT NULL,
  "reason" varchar(60) NOT NULL,
  "source" varchar(40) NOT NULL,
  "matched_user_id" uuid REFERENCES "users"("id"),
  "venue_id" uuid REFERENCES "venues"("id"),
  "role" varchar(20),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "user_onboarding_audit_decision_check"
    CHECK ("decision" IN ('allowed', 'denied')),
  CONSTRAINT "user_onboarding_audit_reason_check"
    CHECK ("reason" IN (
      'email_invitation',
      'approved_domain',
      'missing_verified_email',
      'not_invited'
    )),
  CONSTRAINT "user_onboarding_audit_source_check"
    CHECK ("source" IN ('auth', 'websocket', 'clerk_webhook'))
);

CREATE INDEX IF NOT EXISTS "user_onboarding_audit_clerk_idx"
  ON "user_onboarding_audit" ("clerk_id");

CREATE INDEX IF NOT EXISTS "user_onboarding_audit_email_idx"
  ON "user_onboarding_audit" ("email");

CREATE INDEX IF NOT EXISTS "user_onboarding_audit_decision_idx"
  ON "user_onboarding_audit" ("decision", "created_at");

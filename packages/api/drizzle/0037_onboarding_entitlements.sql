-- -----------------------------------------------------------------------------
-- 0037_onboarding_entitlements
--
-- Organisation/workspace onboarding foundation for managed venue rollouts.
-- Venue remains the v1 authorization boundary; workspaces wrap venue records for
-- sales handoff, owner/staff invitations, entitlement tracking, and operator
-- review gates. Billing or invoice state cannot enforce access unless provider
-- verification evidence has been recorded.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "organisations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(200) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'onboarding',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "primary_venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "name" varchar(200) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'onboarding',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "workspace_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "invitation_id" uuid REFERENCES "user_invitations"("id") ON DELETE SET NULL,
  "email" varchar(255) NOT NULL,
  "role" varchar(30) NOT NULL,
  "venue_role" varchar(20) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'invited',
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "onboarding_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "status" varchar(40) NOT NULL DEFAULT 'admin_invite',
  "current_step" varchar(240) NOT NULL,
  "operator_review_state" varchar(40) NOT NULL DEFAULT 'pending_review',
  "evidence_note" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "completed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "workspace_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_key" varchar(80) NOT NULL,
  "status" varchar(40) NOT NULL DEFAULT 'pending_provider_verification',
  "billing_provider" varchar(40) NOT NULL DEFAULT 'none',
  "provider_customer_ref" varchar(240),
  "provider_entitlement_ref" varchar(240),
  "provider_evidence_ref" varchar(240),
  "provider_verification_status" varchar(40) NOT NULL DEFAULT 'pending',
  "provider_verified_at" timestamp with time zone,
  "access_enforced" boolean NOT NULL DEFAULT false,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "onboarding_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "onboarding_projects"("id") ON DELETE SET NULL,
  "event_type" varchar(60) NOT NULL,
  "summary" varchar(500) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_status_check') THEN
    ALTER TABLE "organisations" DROP CONSTRAINT "organisations_status_check";
  END IF;
  ALTER TABLE "organisations"
    ADD CONSTRAINT "organisations_status_check"
    CHECK ("status" IN ('prospect', 'onboarding', 'active', 'suspended', 'archived'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_status_check') THEN
    ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_status_check";
  END IF;
  ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_status_check"
    CHECK ("status" IN ('onboarding', 'active', 'suspended', 'archived'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_org_name_unique') THEN
    ALTER TABLE "workspaces"
      ADD CONSTRAINT "workspaces_org_name_unique" UNIQUE ("organisation_id", "name");
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memberships_role_check') THEN
    ALTER TABLE "workspace_memberships" DROP CONSTRAINT "workspace_memberships_role_check";
  END IF;
  ALTER TABLE "workspace_memberships"
    ADD CONSTRAINT "workspace_memberships_role_check"
    CHECK ("role" IN ('owner', 'admin', 'staff', 'hallkeeper', 'planner', 'client'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memberships_venue_role_check') THEN
    ALTER TABLE "workspace_memberships" DROP CONSTRAINT "workspace_memberships_venue_role_check";
  END IF;
  ALTER TABLE "workspace_memberships"
    ADD CONSTRAINT "workspace_memberships_venue_role_check"
    CHECK ("venue_role" IN ('staff', 'hallkeeper', 'planner', 'client'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memberships_status_check') THEN
    ALTER TABLE "workspace_memberships" DROP CONSTRAINT "workspace_memberships_status_check";
  END IF;
  ALTER TABLE "workspace_memberships"
    ADD CONSTRAINT "workspace_memberships_status_check"
    CHECK ("status" IN ('invited', 'active', 'suspended', 'removed'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memberships_email_lowercase') THEN
    ALTER TABLE "workspace_memberships"
      ADD CONSTRAINT "workspace_memberships_email_lowercase"
      CHECK ("email" = lower("email"));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_memberships_workspace_email_unique') THEN
    ALTER TABLE "workspace_memberships"
      ADD CONSTRAINT "workspace_memberships_workspace_email_unique" UNIQUE ("workspace_id", "email");
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_projects_status_check') THEN
    ALTER TABLE "onboarding_projects" DROP CONSTRAINT "onboarding_projects_status_check";
  END IF;
  ALTER TABLE "onboarding_projects"
    ADD CONSTRAINT "onboarding_projects_status_check"
    CHECK ("status" IN ('intake', 'venue_record', 'admin_invite', 'staff_invites', 'entitlement_review', 'ready', 'blocked', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_projects_operator_review_check') THEN
    ALTER TABLE "onboarding_projects" DROP CONSTRAINT "onboarding_projects_operator_review_check";
  END IF;
  ALTER TABLE "onboarding_projects"
    ADD CONSTRAINT "onboarding_projects_operator_review_check"
    CHECK ("operator_review_state" IN ('pending_review', 'approved', 'blocked'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_plan_key_check') THEN
    ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_plan_key_check";
  END IF;
  ALTER TABLE "workspace_entitlements"
    ADD CONSTRAINT "workspace_entitlements_plan_key_check"
    CHECK ("plan_key" ~ '^[a-z0-9][a-z0-9_-]*$');

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_status_check') THEN
    ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_status_check";
  END IF;
  ALTER TABLE "workspace_entitlements"
    ADD CONSTRAINT "workspace_entitlements_status_check"
    CHECK ("status" IN ('pending_provider_verification', 'trial', 'active', 'past_due', 'suspended', 'cancelled'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_billing_provider_check') THEN
    ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_billing_provider_check";
  END IF;
  ALTER TABLE "workspace_entitlements"
    ADD CONSTRAINT "workspace_entitlements_billing_provider_check"
    CHECK ("billing_provider" IN ('none', 'stripe', 'manual_invoice', 'external_procurement'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_provider_verification_check') THEN
    ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_provider_verification_check";
  END IF;
  ALTER TABLE "workspace_entitlements"
    ADD CONSTRAINT "workspace_entitlements_provider_verification_check"
    CHECK ("provider_verification_status" IN ('not_required', 'pending', 'provider_verified', 'operator_review_required', 'rejected'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_workspace_unique') THEN
    ALTER TABLE "workspace_entitlements"
      ADD CONSTRAINT "workspace_entitlements_workspace_unique" UNIQUE ("workspace_id");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_provider_ref_gate') THEN
    ALTER TABLE "workspace_entitlements"
      ADD CONSTRAINT "workspace_entitlements_provider_ref_gate"
      CHECK (
        "provider_verification_status" <> 'provider_verified'
        OR (
          "billing_provider" <> 'none'
          AND (
            "provider_customer_ref" IS NOT NULL
            OR "provider_entitlement_ref" IS NOT NULL
            OR "provider_evidence_ref" IS NOT NULL
          )
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_entitlements_access_provider_verified') THEN
    ALTER TABLE "workspace_entitlements"
      ADD CONSTRAINT "workspace_entitlements_access_provider_verified"
      CHECK (
        "access_enforced" = false
        OR (
          "provider_verification_status" = 'provider_verified'
          AND "provider_verified_at" IS NOT NULL
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_audit_events_type_check') THEN
    ALTER TABLE "onboarding_audit_events" DROP CONSTRAINT "onboarding_audit_events_type_check";
  END IF;
  ALTER TABLE "onboarding_audit_events"
    ADD CONSTRAINT "onboarding_audit_events_type_check"
    CHECK ("event_type" IN ('workspace_created', 'owner_invited', 'staff_invited', 'entitlement_recorded', 'provider_verification_updated', 'operator_review_updated'));
END $$;

CREATE INDEX IF NOT EXISTS "organisations_status_idx" ON "organisations" ("status");
CREATE INDEX IF NOT EXISTS "organisations_name_idx" ON "organisations" ("name");
CREATE INDEX IF NOT EXISTS "workspaces_org_status_idx" ON "workspaces" ("organisation_id", "status");
CREATE INDEX IF NOT EXISTS "workspaces_primary_venue_idx" ON "workspaces" ("primary_venue_id");
CREATE INDEX IF NOT EXISTS "workspace_memberships_workspace_status_idx" ON "workspace_memberships" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "workspace_memberships_invitation_idx" ON "workspace_memberships" ("invitation_id");
CREATE INDEX IF NOT EXISTS "workspace_memberships_user_idx" ON "workspace_memberships" ("user_id");
CREATE INDEX IF NOT EXISTS "onboarding_projects_workspace_status_idx" ON "onboarding_projects" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "onboarding_projects_venue_idx" ON "onboarding_projects" ("venue_id");
CREATE INDEX IF NOT EXISTS "onboarding_projects_operator_review_idx" ON "onboarding_projects" ("operator_review_state");
CREATE INDEX IF NOT EXISTS "workspace_entitlements_status_idx" ON "workspace_entitlements" ("status");
CREATE INDEX IF NOT EXISTS "workspace_entitlements_provider_status_idx" ON "workspace_entitlements" ("billing_provider", "provider_verification_status");
CREATE INDEX IF NOT EXISTS "onboarding_audit_events_workspace_created_idx" ON "onboarding_audit_events" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "onboarding_audit_events_project_idx" ON "onboarding_audit_events" ("project_id");

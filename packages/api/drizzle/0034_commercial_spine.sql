-- -----------------------------------------------------------------------------
-- 0034_commercial_spine
--
-- Commercial operating spine v0: enquiry -> opportunity -> proposal/quote ->
-- client share link. This migration creates venue-scoped CRM tables, links
-- proposals/quotes to opportunities, stores proposal share capabilities as
-- hashes, and adds client comments plus package selections. No live external
-- integrations, simulation, event-day operations, or unsupported claims.
-- -----------------------------------------------------------------------------

-- 1. Client account / contact / opportunity tables ----------------------------

CREATE TABLE IF NOT EXISTS "client_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "name" varchar(200) NOT NULL,
  "account_type" varchar(60) NOT NULL DEFAULT 'event_client',
  "primary_contact_id" uuid,
  "source_enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "client_account_id" uuid REFERENCES "client_accounts"("id") ON DELETE SET NULL,
  "name" varchar(200) NOT NULL,
  "email" varchar(255) NOT NULL,
  "phone" varchar(50),
  "role_label" varchar(120),
  "source_enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_accounts_primary_contact_fk') THEN
    ALTER TABLE "client_accounts"
      ADD CONSTRAINT "client_accounts_primary_contact_fk"
      FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "client_account_id" uuid REFERENCES "client_accounts"("id") ON DELETE SET NULL,
  "primary_contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "source_enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "stage" varchar(40) NOT NULL DEFAULT 'new',
  "event_type" varchar(100),
  "preferred_date" date,
  "guest_count" integer,
  "estimated_value_minor" integer NOT NULL DEFAULT 0,
  "currency" varchar(3) NOT NULL DEFAULT 'GBP',
  "next_action" varchar(500) NOT NULL DEFAULT 'Confirm the next planning step with the client.',
  "next_action_due_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "closed_at" timestamp with time zone,
  "deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "opportunity_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "from_stage" varchar(40) NOT NULL,
  "to_stage" varchar(40) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "type" varchar(30) NOT NULL DEFAULT 'note',
  "body" text NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "follow_up_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "due_at" timestamp with time zone,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_stage_check') THEN
    ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_stage_check";
  END IF;
  ALTER TABLE "opportunities"
    ADD CONSTRAINT "opportunities_stage_check"
    CHECK ("stage" IN ('new', 'qualified', 'proposal_drafting', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_estimated_value_nonneg') THEN
    ALTER TABLE "opportunities"
      ADD CONSTRAINT "opportunities_estimated_value_nonneg"
      CHECK ("estimated_value_minor" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_guest_count_nonneg') THEN
    ALTER TABLE "opportunities"
      ADD CONSTRAINT "opportunities_guest_count_nonneg"
      CHECK ("guest_count" IS NULL OR "guest_count" >= 0);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_currency_check') THEN
    ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_currency_check";
  END IF;
  ALTER TABLE "opportunities"
    ADD CONSTRAINT "opportunities_currency_check"
    CHECK ("currency" IN ('GBP'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_type_check') THEN
    ALTER TABLE "activities" DROP CONSTRAINT "activities_type_check";
  END IF;
  ALTER TABLE "activities"
    ADD CONSTRAINT "activities_type_check"
    CHECK ("type" IN ('note', 'call', 'email', 'meeting', 'proposal', 'system'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_tasks_status_check') THEN
    ALTER TABLE "follow_up_tasks" DROP CONSTRAINT "follow_up_tasks_status_check";
  END IF;
  ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_status_check"
    CHECK ("status" IN ('open', 'done', 'cancelled'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_tasks_completed_coherent') THEN
    ALTER TABLE "follow_up_tasks"
      ADD CONSTRAINT "follow_up_tasks_completed_coherent"
      CHECK (("status" = 'done' AND "completed_at" IS NOT NULL) OR ("status" <> 'done'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "client_accounts_venue_name_idx" ON "client_accounts" ("venue_id", "name");
CREATE INDEX IF NOT EXISTS "client_accounts_source_enquiry_idx" ON "client_accounts" ("source_enquiry_id");
CREATE INDEX IF NOT EXISTS "contacts_venue_email_idx" ON "contacts" ("venue_id", "email");
CREATE INDEX IF NOT EXISTS "contacts_account_idx" ON "contacts" ("client_account_id");
CREATE INDEX IF NOT EXISTS "contacts_source_enquiry_idx" ON "contacts" ("source_enquiry_id");
CREATE INDEX IF NOT EXISTS "opportunities_venue_stage_idx" ON "opportunities" ("venue_id", "stage");
CREATE INDEX IF NOT EXISTS "opportunities_account_idx" ON "opportunities" ("client_account_id");
CREATE INDEX IF NOT EXISTS "opportunities_source_enquiry_idx" ON "opportunities" ("source_enquiry_id");
CREATE INDEX IF NOT EXISTS "opportunities_next_action_idx" ON "opportunities" ("venue_id", "next_action_due_at");
CREATE INDEX IF NOT EXISTS "opportunity_status_history_opportunity_idx" ON "opportunity_status_history" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "activities_opportunity_created_idx" ON "activities" ("opportunity_id", "created_at");
CREATE INDEX IF NOT EXISTS "follow_up_tasks_opportunity_idx" ON "follow_up_tasks" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "follow_up_tasks_assigned_status_idx" ON "follow_up_tasks" ("assigned_to", "status");
CREATE INDEX IF NOT EXISTS "follow_up_tasks_status_due_idx" ON "follow_up_tasks" ("status", "due_at");

-- 2. Link existing proposal / quote tables to opportunities ------------------

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "proposals_opportunity_idx" ON "proposals" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "quotes_opportunity_idx" ON "quotes" ("opportunity_id");

-- 3. Proposal share tokens / comments ---------------------------------------

CREATE TABLE IF NOT EXISTS "proposal_share_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL REFERENCES "proposals"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "token_prefix" varchar(16) NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_viewed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "proposal_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL REFERENCES "proposals"("id") ON DELETE CASCADE,
  "share_token_id" uuid REFERENCES "proposal_share_tokens"("id") ON DELETE SET NULL,
  "kind" varchar(30) NOT NULL DEFAULT 'comment',
  "author_name" varchar(200),
  "author_email" varchar(255),
  "body" text NOT NULL,
  "is_client_visible" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_share_tokens_token_hash_unique') THEN
    ALTER TABLE "proposal_share_tokens"
      ADD CONSTRAINT "proposal_share_tokens_token_hash_unique" UNIQUE ("token_hash");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_share_tokens_token_hash_shape') THEN
    ALTER TABLE "proposal_share_tokens"
      ADD CONSTRAINT "proposal_share_tokens_token_hash_shape"
      CHECK ("token_hash" ~ '^[a-f0-9]{64}$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_comments_kind_check') THEN
    ALTER TABLE "proposal_comments" DROP CONSTRAINT "proposal_comments_kind_check";
  END IF;
  ALTER TABLE "proposal_comments"
    ADD CONSTRAINT "proposal_comments_kind_check"
    CHECK ("kind" IN ('comment', 'request_changes', 'approval_note'));
END $$;

CREATE INDEX IF NOT EXISTS "proposal_share_tokens_proposal_idx" ON "proposal_share_tokens" ("proposal_id");
CREATE INDEX IF NOT EXISTS "proposal_share_tokens_hash_idx" ON "proposal_share_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "proposal_comments_proposal_created_idx" ON "proposal_comments" ("proposal_id", "created_at");
CREATE INDEX IF NOT EXISTS "proposal_comments_share_token_idx" ON "proposal_comments" ("share_token_id");

-- 4. Package selections ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "package_selections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL,
  "proposal_id" uuid REFERENCES "proposals"("id") ON DELETE SET NULL,
  "quote_id" uuid REFERENCES "quotes"("id") ON DELETE SET NULL,
  "package_key" varchar(120) NOT NULL,
  "label" varchar(200) NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "unit_amount_minor" integer NOT NULL DEFAULT 0,
  "total_minor" integer NOT NULL DEFAULT 0,
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_selections_quantity_positive') THEN
    ALTER TABLE "package_selections"
      ADD CONSTRAINT "package_selections_quantity_positive"
      CHECK ("quantity" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_selections_money_nonneg') THEN
    ALTER TABLE "package_selections"
      ADD CONSTRAINT "package_selections_money_nonneg"
      CHECK ("unit_amount_minor" >= 0 AND "total_minor" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_selections_total_exact') THEN
    ALTER TABLE "package_selections"
      ADD CONSTRAINT "package_selections_total_exact"
      CHECK ("total_minor" = "unit_amount_minor" * "quantity");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_selections_status_check') THEN
    ALTER TABLE "package_selections" DROP CONSTRAINT "package_selections_status_check";
  END IF;
  ALTER TABLE "package_selections"
    ADD CONSTRAINT "package_selections_status_check"
    CHECK ("status" IN ('draft', 'included', 'removed', 'superseded'));
END $$;

CREATE INDEX IF NOT EXISTS "package_selections_opportunity_idx" ON "package_selections" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "package_selections_proposal_idx" ON "package_selections" ("proposal_id");
CREATE INDEX IF NOT EXISTS "package_selections_quote_idx" ON "package_selections" ("quote_id");

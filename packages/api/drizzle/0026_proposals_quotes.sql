-- -----------------------------------------------------------------------------
-- 0026_proposals_quotes
--
-- T-427 phase 1: proposal/quote v0 as first-class domain objects. Creates
-- empty registry tables only — no rows, no claims. Money is integer minor
-- units (pence) everywhere; no floating-point money columns exist. Status
-- vocabularies mirror @omnitwin/types proposal.ts exactly (drift-guarded by
-- packages/api/src/__tests__/proposals-schema.test.ts). Idempotent in the
-- 0024 style: replay-safe on databases where any part already exists.
-- -----------------------------------------------------------------------------

-- 1. proposals --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "current_version" integer NOT NULL DEFAULT 0,
  "share_code" varchar(12),
  "sent_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_share_code_unique') THEN
    ALTER TABLE "proposals"
      ADD CONSTRAINT "proposals_share_code_unique" UNIQUE ("share_code");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_status_check') THEN
    ALTER TABLE "proposals" DROP CONSTRAINT "proposals_status_check";
  END IF;
  ALTER TABLE "proposals"
    ADD CONSTRAINT "proposals_status_check"
    CHECK ("status" IN ('draft', 'sent', 'changes_requested', 'accepted', 'declined', 'expired', 'withdrawn', 'archived'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_current_version_nonneg') THEN
    ALTER TABLE "proposals"
      ADD CONSTRAINT "proposals_current_version_nonneg"
      CHECK ("current_version" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_share_code_shape') THEN
    ALTER TABLE "proposals"
      ADD CONSTRAINT "proposals_share_code_shape"
      CHECK ("share_code" IS NULL OR "share_code" ~ '^[A-Za-z0-9_-]{6,12}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_sent_status_coherent') THEN
    ALTER TABLE "proposals"
      ADD CONSTRAINT "proposals_sent_status_coherent"
      CHECK ("status" NOT IN ('sent', 'changes_requested', 'accepted', 'declined', 'expired') OR "sent_at" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "proposals_venue_status_idx"
  ON "proposals" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "proposals_enquiry_idx"
  ON "proposals" ("enquiry_id");

-- 2. proposal_versions ------------------------------------------------------

CREATE TABLE IF NOT EXISTS "proposal_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL REFERENCES "proposals"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "payload" jsonb NOT NULL,
  "source_hash" varchar(64) NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_versions_proposal_version_unique') THEN
    ALTER TABLE "proposal_versions"
      ADD CONSTRAINT "proposal_versions_proposal_version_unique" UNIQUE ("proposal_id", "version");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_versions_version_positive') THEN
    ALTER TABLE "proposal_versions"
      ADD CONSTRAINT "proposal_versions_version_positive"
      CHECK ("version" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_versions_source_hash_check') THEN
    ALTER TABLE "proposal_versions"
      ADD CONSTRAINT "proposal_versions_source_hash_check"
      CHECK ("source_hash" ~ '^[a-f0-9]{64}$');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_versions_payload_shape') THEN
    ALTER TABLE "proposal_versions" DROP CONSTRAINT "proposal_versions_payload_shape";
  END IF;
  ALTER TABLE "proposal_versions"
    ADD CONSTRAINT "proposal_versions_payload_shape"
    CHECK ("payload"->>'schemaVersion' = 'venviewer.proposal-version.v1');
END $$;

CREATE INDEX IF NOT EXISTS "proposal_versions_proposal_created_idx"
  ON "proposal_versions" ("proposal_id", "created_at");

-- 3. proposal_status_history ------------------------------------------------

CREATE TABLE IF NOT EXISTS "proposal_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL REFERENCES "proposals"("id") ON DELETE CASCADE,
  "from_status" varchar(30) NOT NULL,
  "to_status" varchar(30) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id"),
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "proposal_status_history_proposal_idx"
  ON "proposal_status_history" ("proposal_id");

-- 4. quotes -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "proposal_id" uuid REFERENCES "proposals"("id") ON DELETE SET NULL,
  "enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL,
  "space_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL,
  "name" varchar(200) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "currency" varchar(3) NOT NULL DEFAULT 'GBP',
  "subtotal_minor" integer NOT NULL DEFAULT 0,
  "total_minor" integer NOT NULL DEFAULT 0,
  "valid_until" date,
  "superseded_by_quote_id" uuid REFERENCES "quotes"("id") ON DELETE SET NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "deleted_at" timestamp with time zone
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_status_check') THEN
    ALTER TABLE "quotes" DROP CONSTRAINT "quotes_status_check";
  END IF;
  ALTER TABLE "quotes"
    ADD CONSTRAINT "quotes_status_check"
    CHECK ("status" IN ('draft', 'issued', 'accepted', 'declined', 'superseded', 'expired'));
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_currency_check') THEN
    ALTER TABLE "quotes" DROP CONSTRAINT "quotes_currency_check";
  END IF;
  ALTER TABLE "quotes"
    ADD CONSTRAINT "quotes_currency_check"
    CHECK ("currency" IN ('GBP'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_amounts_nonneg') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_amounts_nonneg"
      CHECK ("subtotal_minor" >= 0 AND "total_minor" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_superseded_coherent') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_superseded_coherent"
      CHECK ("superseded_by_quote_id" IS NULL OR "status" = 'superseded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_superseded_not_self') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_superseded_not_self"
      CHECK ("superseded_by_quote_id" IS NULL OR "superseded_by_quote_id" <> "id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "quotes_venue_status_idx"
  ON "quotes" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "quotes_proposal_idx"
  ON "quotes" ("proposal_id");

-- 5. quote_line_items ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "quote_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "pricing_rule_id" uuid REFERENCES "pricing_rules"("id") ON DELETE SET NULL,
  "description" text NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "unit_amount_minor" integer NOT NULL,
  "line_total_minor" integer NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_quantity_positive') THEN
    ALTER TABLE "quote_line_items"
      ADD CONSTRAINT "quote_line_items_quantity_positive"
      CHECK ("quantity" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_amounts_nonneg') THEN
    ALTER TABLE "quote_line_items"
      ADD CONSTRAINT "quote_line_items_amounts_nonneg"
      CHECK ("unit_amount_minor" >= 0 AND "line_total_minor" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_total_exact') THEN
    ALTER TABLE "quote_line_items"
      ADD CONSTRAINT "quote_line_items_total_exact"
      CHECK ("line_total_minor" = "unit_amount_minor" * "quantity");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_sort_order_nonneg') THEN
    ALTER TABLE "quote_line_items"
      ADD CONSTRAINT "quote_line_items_sort_order_nonneg"
      CHECK ("sort_order" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "quote_line_items_quote_idx"
  ON "quote_line_items" ("quote_id", "sort_order");

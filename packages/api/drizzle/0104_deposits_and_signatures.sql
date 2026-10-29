-- ---------------------------------------------------------------------------
-- 0104 — deposits through Stripe in test mode, and the contract's electronic
-- signature (Plan 19 L5; goal 06 S6). Written as 0103; master took 0103
-- (researched_chair_sizes) first, so on 29 Oct it became 0104 with a journal
-- `when` just after master's 0103 and before the open PRs' later migrations.
--
-- Four tables, each inside the venue's tenancy by composite keys that pin a
-- row to the venue of the proposal it belongs to:
--
--   1. proposal_deposit_requests: the venue asks for a deposit once a client
--      has accepted a proposal, as an amount or a percentage (basis points) of
--      the accepted version's quote. The version is named by number and by its
--      content hash, so the amount is tied to exactly what was accepted. One
--      request in force per proposal; an unpaid one can be withdrawn
--      (cancelled_at) and another made. The event it is for, when the
--      proposal's layout belongs to one, is kept with it.
--   2. deposit_payments: one row per Stripe Checkout Session opened for a
--      request, holding what Stripe has reported about it as facts kept once
--      (paid_at, processing_at, declined_at, failed_at, expired_at) and the
--      amount refunded, which only grows. The state shown is derived from
--      them, so webhooks in any order agree. `livemode` must be false: this
--      lane takes no real money, and a live payment cannot be written here
--      until a later migration says otherwise.
--   3. proposal_contract_versions: a contract generated from the accepted
--      proposal version and the venue's terms, its document stored with the
--      SHA-256 of its canonical JSON. Numbered per proposal.
--   4. proposal_contract_signatures: one signature per contract version: the
--      name typed, the email of the client the proposal was addressed to, the
--      words agreed to, the user agent, the link it came through (by id and
--      prefix, with no key, so the record outlives the link) and the moment.
--      No IP address is kept. The signed hash must be the version's own hash
--      (a composite key to the version's id and hash).
--
-- Contract versions and signatures are immutable: a trigger refuses every
-- UPDATE, DELETE and TRUNCATE of them. Who prepared a version is kept as an
-- id without a key and a label, so no account change can rewrite the record.
--
-- stripe_events (0018) is the idempotency log the webhook already has; it is
-- reused unchanged, one row per Stripe event id, written in the same
-- transaction as the event's effect.
--
-- Additive only: new tables, a function and triggers on them; no existing
-- row or column changes. The file is one transaction; a failed statement
-- leaves the database as it was. Nothing reads these tables until the release
-- that carries the routes, and the payment routes stay off until the Stripe
-- variables are set.
--
-- To reverse (no other table refers to these):
--   DROP TABLE IF EXISTS "proposal_contract_signatures";
--   DROP TABLE IF EXISTS "proposal_contract_versions";
--   DROP TABLE IF EXISTS "deposit_payments";
--   DROP TABLE IF EXISTS "proposal_deposit_requests";
--   DROP FUNCTION IF EXISTS "proposal_contract_record_is_immutable"();
-- (The immutability triggers go with their tables. Reversing deletes every
-- signature record, which a signed contract's retention period forbids once
-- one exists: export them first.)
-- ---------------------------------------------------------------------------

-- A key to a hot table waits at most this long for its lock, then fails the
-- deploy rather than hold writes to proposals, venues or events behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

-- 1. proposal_deposit_requests ---------------------------------------------
CREATE TABLE IF NOT EXISTS "proposal_deposit_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "proposal_id" uuid NOT NULL,
  "event_id" uuid,
  "proposal_version" integer NOT NULL,
  "proposal_version_hash" varchar(64) NOT NULL,
  "basis" varchar(10) NOT NULL,
  "percent_basis_points" integer,
  "quote_total_minor" integer NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" varchar(3) NOT NULL,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "proposal_deposit_requests_proposal_venue_fk"
    FOREIGN KEY ("proposal_id", "venue_id") REFERENCES "proposals"("id", "venue_id"),
  CONSTRAINT "proposal_deposit_requests_event_venue_fk"
    FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE SET NULL ("event_id"),
  CONSTRAINT "proposal_deposit_requests_id_venue_unique" UNIQUE ("id", "venue_id"),
  CONSTRAINT "proposal_deposit_requests_basis_check" CHECK ("basis" IN ('amount', 'percent')),
  CONSTRAINT "proposal_deposit_requests_percent_pair" CHECK (("basis" = 'percent') = ("percent_basis_points" IS NOT NULL)),
  CONSTRAINT "proposal_deposit_requests_percent_range" CHECK ("percent_basis_points" IS NULL OR "percent_basis_points" BETWEEN 1 AND 10000),
  CONSTRAINT "proposal_deposit_requests_amount_range" CHECK ("amount_minor" > 0 AND "amount_minor" <= "quote_total_minor" AND "quote_total_minor" <= 100000000),
  CONSTRAINT "proposal_deposit_requests_version_check" CHECK ("proposal_version" > 0),
  CONSTRAINT "proposal_deposit_requests_version_hash_shape" CHECK ("proposal_version_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "proposal_deposit_requests_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "proposal_deposit_requests_cancel_pair" CHECK ("cancelled_by" IS NULL OR "cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
-- One request in force per proposal; withdrawn ones are kept.
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_deposit_requests_one_in_force"
  ON "proposal_deposit_requests" ("proposal_id") WHERE "cancelled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_deposit_requests_proposal_idx"
  ON "proposal_deposit_requests" ("proposal_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_deposit_requests_event_idx"
  ON "proposal_deposit_requests" ("event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint

-- 2. deposit_payments ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "deposit_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL,
  "deposit_request_id" uuid NOT NULL,
  "stripe_checkout_session_id" text NOT NULL,
  "stripe_payment_intent_id" text,
  "checkout_url" text NOT NULL,
  "session_expires_at" timestamp with time zone NOT NULL,
  "livemode" boolean NOT NULL DEFAULT false,
  "amount_minor" integer NOT NULL,
  "currency" varchar(3) NOT NULL,
  "amount_received_minor" integer,
  "currency_received" varchar(3),
  "amount_refunded_minor" integer NOT NULL DEFAULT 0,
  "paid_at" timestamp with time zone,
  "processing_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "failure_message" varchar(500),
  "failed_at" timestamp with time zone,
  "expired_at" timestamp with time zone,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "deposit_payments_request_venue_fk"
    FOREIGN KEY ("deposit_request_id", "venue_id") REFERENCES "proposal_deposit_requests"("id", "venue_id"),
  CONSTRAINT "deposit_payments_session_unique" UNIQUE ("stripe_checkout_session_id"),
  CONSTRAINT "deposit_payments_payment_intent_unique" UNIQUE ("stripe_payment_intent_id"),
  CONSTRAINT "deposit_payments_test_mode_only" CHECK ("livemode" = false),
  CONSTRAINT "deposit_payments_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "deposit_payments_received_check" CHECK ("amount_received_minor" IS NULL OR "amount_received_minor" >= 0),
  CONSTRAINT "deposit_payments_refunded_check" CHECK ("amount_refunded_minor" >= 0),
  CONSTRAINT "deposit_payments_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$' AND ("currency_received" IS NULL OR "currency_received" ~ '^[A-Z]{3}$')),
  CONSTRAINT "deposit_payments_checkout_url_shape" CHECK ("checkout_url" ~ '^https://')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_payments_request_idx"
  ON "deposit_payments" ("deposit_request_id", "created_at");
--> statement-breakpoint

-- 3. proposal_contract_versions -------------------------------------------
CREATE TABLE IF NOT EXISTS "proposal_contract_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "proposal_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "proposal_version" integer NOT NULL,
  "proposal_version_hash" varchar(64) NOT NULL,
  "document" jsonb NOT NULL,
  "document_hash" varchar(64) NOT NULL,
  "created_by" uuid,
  "created_by_label" varchar(255),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "proposal_contract_versions_proposal_venue_fk"
    FOREIGN KEY ("proposal_id", "venue_id") REFERENCES "proposals"("id", "venue_id"),
  CONSTRAINT "proposal_contract_versions_proposal_version_unique" UNIQUE ("proposal_id", "version"),
  CONSTRAINT "proposal_contract_versions_id_hash_unique" UNIQUE ("id", "document_hash"),
  CONSTRAINT "proposal_contract_versions_id_venue_unique" UNIQUE ("id", "venue_id"),
  CONSTRAINT "proposal_contract_versions_version_check" CHECK ("version" > 0 AND "proposal_version" > 0),
  CONSTRAINT "proposal_contract_versions_hash_shape" CHECK ("document_hash" ~ '^[a-f0-9]{64}$' AND "proposal_version_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "proposal_contract_versions_document_shape" CHECK (jsonb_typeof("document") = 'object')
);
--> statement-breakpoint

-- 4. proposal_contract_signatures ------------------------------------------
CREATE TABLE IF NOT EXISTS "proposal_contract_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL,
  "contract_version_id" uuid NOT NULL,
  "document_hash" varchar(64) NOT NULL,
  "signer_name" varchar(200) NOT NULL,
  "signer_email" varchar(255) NOT NULL,
  "consent_statement" text NOT NULL,
  "user_agent" varchar(512),
  "share_token_id" uuid,
  "share_token_prefix" varchar(16),
  "signed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "proposal_contract_signatures_version_hash_fk"
    FOREIGN KEY ("contract_version_id", "document_hash") REFERENCES "proposal_contract_versions"("id", "document_hash"),
  CONSTRAINT "proposal_contract_signatures_version_venue_fk"
    FOREIGN KEY ("contract_version_id", "venue_id") REFERENCES "proposal_contract_versions"("id", "venue_id"),
  CONSTRAINT "proposal_contract_signatures_one_per_version" UNIQUE ("contract_version_id"),
  CONSTRAINT "proposal_contract_signatures_name_shape" CHECK ("signer_name" = btrim("signer_name") AND "signer_name" <> ''),
  CONSTRAINT "proposal_contract_signatures_email_shape" CHECK (position('@' in "signer_email") > 1),
  CONSTRAINT "proposal_contract_signatures_consent_shape" CHECK ("consent_statement" <> '')
);
--> statement-breakpoint

-- Immutability: a contract version and its signature are never changed or
-- removed by any statement.
CREATE OR REPLACE FUNCTION "proposal_contract_record_is_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  AS $immutable$
BEGIN
  RAISE EXCEPTION 'A prepared or signed contract record cannot be changed or removed (%)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$immutable$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposal_contract_versions_immutable" ON "proposal_contract_versions";
--> statement-breakpoint
CREATE TRIGGER "proposal_contract_versions_immutable"
  BEFORE UPDATE OR DELETE ON "proposal_contract_versions"
  FOR EACH ROW EXECUTE FUNCTION "proposal_contract_record_is_immutable"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposal_contract_versions_no_truncate" ON "proposal_contract_versions";
--> statement-breakpoint
CREATE TRIGGER "proposal_contract_versions_no_truncate"
  BEFORE TRUNCATE ON "proposal_contract_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "proposal_contract_record_is_immutable"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposal_contract_signatures_immutable" ON "proposal_contract_signatures";
--> statement-breakpoint
CREATE TRIGGER "proposal_contract_signatures_immutable"
  BEFORE UPDATE OR DELETE ON "proposal_contract_signatures"
  FOR EACH ROW EXECUTE FUNCTION "proposal_contract_record_is_immutable"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposal_contract_signatures_no_truncate" ON "proposal_contract_signatures";
--> statement-breakpoint
CREATE TRIGGER "proposal_contract_signatures_no_truncate"
  BEFORE TRUNCATE ON "proposal_contract_signatures"
  FOR EACH STATEMENT EXECUTE FUNCTION "proposal_contract_record_is_immutable"();
--> statement-breakpoint

-- The five-second lock limit was for this file alone; anything after it in
-- the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;

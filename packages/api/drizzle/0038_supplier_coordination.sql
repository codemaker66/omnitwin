CREATE TABLE IF NOT EXISTS "supplier_coordination_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "handoff_pack_id" uuid NOT NULL REFERENCES "handoff_packs"("id") ON DELETE CASCADE,
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "contact_name" varchar(160),
  "contact_email" varchar(255),
  "contact_phone" varchar(40),
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "source_snapshot_hash" varchar(64) NOT NULL,
  "source_digest" varchar(64) NOT NULL,
  "source_label" varchar(200) NOT NULL,
  "safe_status" varchar(80) NOT NULL DEFAULT 'supplier_safe_operations_handoff',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "issued_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_packs_status_check') THEN
    ALTER TABLE "supplier_coordination_packs" DROP CONSTRAINT "supplier_coordination_packs_status_check";
  END IF;
  ALTER TABLE "supplier_coordination_packs"
    ADD CONSTRAINT "supplier_coordination_packs_status_check"
    CHECK ("status" IN ('draft', 'issued', 'acknowledged', 'changes_requested', 'revoked', 'expired'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_packs_hash_shape') THEN
    ALTER TABLE "supplier_coordination_packs"
      ADD CONSTRAINT "supplier_coordination_packs_hash_shape"
      CHECK ("source_snapshot_hash" ~ '^[a-f0-9]{64}$' AND "source_digest" ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_packs_text_nonempty') THEN
    ALTER TABLE "supplier_coordination_packs"
      ADD CONSTRAINT "supplier_coordination_packs_text_nonempty"
      CHECK (length(trim("title")) > 0 AND length(trim("source_label")) > 0);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_packs_safe_status_check') THEN
    ALTER TABLE "supplier_coordination_packs" DROP CONSTRAINT "supplier_coordination_packs_safe_status_check";
  END IF;
  ALTER TABLE "supplier_coordination_packs"
    ADD CONSTRAINT "supplier_coordination_packs_safe_status_check"
    CHECK ("safe_status" = 'supplier_safe_operations_handoff');
END $$;

CREATE INDEX IF NOT EXISTS "supplier_coordination_packs_venue_status_idx" ON "supplier_coordination_packs" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "supplier_coordination_packs_handoff_idx" ON "supplier_coordination_packs" ("handoff_pack_id");
CREATE INDEX IF NOT EXISTS "supplier_coordination_packs_supplier_idx" ON "supplier_coordination_packs" ("supplier_id");

CREATE TABLE IF NOT EXISTS "supplier_coordination_pack_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pack_id" uuid NOT NULL REFERENCES "supplier_coordination_packs"("id") ON DELETE CASCADE,
  "supplier_instruction_id" uuid REFERENCES "supplier_instructions"("id") ON DELETE SET NULL,
  "kind" varchar(30) NOT NULL DEFAULT 'requirement',
  "title" varchar(200) NOT NULL,
  "detail" text NOT NULL,
  "arrival_window" varchar(120),
  "source_ref" varchar(300),
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_pack_items_kind_check') THEN
    ALTER TABLE "supplier_coordination_pack_items" DROP CONSTRAINT "supplier_coordination_pack_items_kind_check";
  END IF;
  ALTER TABLE "supplier_coordination_pack_items"
    ADD CONSTRAINT "supplier_coordination_pack_items_kind_check"
    CHECK ("kind" IN ('requirement', 'load_in_window', 'handoff_instruction', 'contact_note'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_pack_items_order_nonneg') THEN
    ALTER TABLE "supplier_coordination_pack_items"
      ADD CONSTRAINT "supplier_coordination_pack_items_order_nonneg"
      CHECK ("sort_order" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_pack_items_text_nonempty') THEN
    ALTER TABLE "supplier_coordination_pack_items"
      ADD CONSTRAINT "supplier_coordination_pack_items_text_nonempty"
      CHECK (length(trim("title")) > 0 AND length(trim("detail")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "supplier_coordination_items_pack_order_idx" ON "supplier_coordination_pack_items" ("pack_id", "sort_order");
CREATE INDEX IF NOT EXISTS "supplier_coordination_items_instruction_idx" ON "supplier_coordination_pack_items" ("supplier_instruction_id");

CREATE TABLE IF NOT EXISTS "supplier_coordination_share_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pack_id" uuid NOT NULL REFERENCES "supplier_coordination_packs"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "token_prefix" varchar(16) NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_viewed_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_coordination_share_tokens_token_hash_shape') THEN
    ALTER TABLE "supplier_coordination_share_tokens"
      ADD CONSTRAINT "supplier_coordination_share_tokens_token_hash_shape"
      CHECK ("token_hash" ~ '^[a-f0-9]{64}$' AND length(trim("token_prefix")) >= 6);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "supplier_coordination_tokens_pack_idx" ON "supplier_coordination_share_tokens" ("pack_id");
CREATE INDEX IF NOT EXISTS "supplier_coordination_tokens_hash_idx" ON "supplier_coordination_share_tokens" ("token_hash");

CREATE TABLE IF NOT EXISTS "supplier_acknowledgements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pack_id" uuid NOT NULL REFERENCES "supplier_coordination_packs"("id") ON DELETE CASCADE,
  "share_token_id" uuid REFERENCES "supplier_coordination_share_tokens"("id") ON DELETE SET NULL,
  "status" varchar(30) NOT NULL DEFAULT 'acknowledged',
  "acknowledged_by_name" varchar(160),
  "acknowledged_by_email" varchar(255),
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_acknowledgements_status_check') THEN
    ALTER TABLE "supplier_acknowledgements" DROP CONSTRAINT "supplier_acknowledgements_status_check";
  END IF;
  ALTER TABLE "supplier_acknowledgements"
    ADD CONSTRAINT "supplier_acknowledgements_status_check"
    CHECK ("status" IN ('acknowledged', 'needs_clarification'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_acknowledgements_identity_required') THEN
    ALTER TABLE "supplier_acknowledgements"
      ADD CONSTRAINT "supplier_acknowledgements_identity_required"
      CHECK ("acknowledged_by_name" IS NOT NULL OR "acknowledged_by_email" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "supplier_acknowledgements_pack_created_idx" ON "supplier_acknowledgements" ("pack_id", "created_at");
CREATE INDEX IF NOT EXISTS "supplier_acknowledgements_share_token_idx" ON "supplier_acknowledgements" ("share_token_id");

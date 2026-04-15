-- -----------------------------------------------------------------------------
-- 0008_email_sends
--
-- Audit log + idempotency store for every transactional email the API
-- attempts to deliver. See db/schema.ts::emailSends and
-- services/email.ts for the send pipeline.
--
-- `idempotency_key` is UNIQUE — it's the primary dedup mechanism. Callers
-- insert a row for this key before touching Resend; duplicate keys fail
-- the insert, which the email service catches and treats as "already
-- sent". Survives process restarts unlike in-memory LRU caches.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "email_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "recipient" text NOT NULL,
  "subject" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "provider_message_id" text,
  "last_error" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "email_sends_idempotency_key_unique" UNIQUE ("idempotency_key")
);

CREATE INDEX IF NOT EXISTS "email_sends_status_idx" ON "email_sends" ("status");
CREATE INDEX IF NOT EXISTS "email_sends_created_at_idx" ON "email_sends" ("created_at");

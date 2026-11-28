-- ---------------------------------------------------------------------------
-- 0110 — the job list (T-702, the plumbing's piece 0)
--
-- jobs: the list of work the API carries out later, in PostgreSQL, so that
-- work asked for in a request survives a restart and is tried again when it
-- fails. One row per piece of work. A job carries ids, never facts: its
-- `payload` holds identifiers only and stays under 2,048 bytes. `kind` and
-- `key` together are the job's name, so asking for the same work twice is one
-- job. `scope` is `venue` (and then `venue_id` is set, and the job goes when
-- the venue does) or `platform` (and `venue_id` is null). `state` is one of
-- five: queued, running, done, dead (out of tries) or abandoned (put down by a
-- person, who leaves their id, the time and a note). A running row always
-- holds a claim (token, worker, and when it runs out) and no other row holds
-- one. The database's clock decides what is due and whose claim has run out.
--
-- email_sends: the columns a queued send needs, unused until the next piece.
-- A send may name the venue, event and enquiry it belongs to; the event and
-- enquiry must belong to that same venue (composite keys to the pairs
-- events_id_venue_unique and enquiries_id_venue_unique), and naming either
-- needs a venue. The status rule is live at once: it allows the five values
-- today's code writes (pending, sent, failed, suppressed, dev_mode) and the
-- four the job list adds (queued, not_sent, bounced, complained). It is added
-- NOT VALID and then validated in the same step, which reads every existing
-- row once; a stray old status would fail the migration, so production's
-- distinct statuses are read before this lands.
--
-- Each link column has a partial index (rows where it is set), so removing an
-- event or enquiry checks its sends by index, not by reading the table. The
-- venue index is partial too. Every existing row has all three links null,
-- so the three indexes are built empty.
--
-- Written as 0110 (journal idx 107) on the plumbing branch; the number is
-- fixed again at merge. Running code reads none of this until the next
-- release.
--
-- Locks, in the order they are taken. First, before email_sends is touched,
-- the locks the keys need on venues, events and enquiries (SHARE ROW
-- EXCLUSIVE: reads pass, writes wait), then users' for the new table's key.
-- Only then email_sends itself, which is held against reads and writes from
-- its first ALTER until the migration commits, while its rows are read to
-- check the keys and the status rule and to build its three indexes. So no
-- wait for another table's lock happens while email traffic is held. Every
-- lock taken is kept until the commit. Each wait for a lock gives up after
-- ten seconds and fails the deploy. While it waits, later statements that
-- need a conflicting lock on that table queue behind it (writes to venues,
-- events, enquiries and users; anything on email_sends); with several locks
-- to take, a stalled deploy can take longer than ten seconds to fail. Nothing
-- bounds a statement once its locks are held: the time email_sends is held
-- grows with its rows.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
LOCK TABLE "venues", "events", "enquiries" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "key" text NOT NULL,
  "scope" text NOT NULL,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE CASCADE,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "run_at" timestamp with time zone DEFAULT now() NOT NULL,
  "state" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer NOT NULL,
  "lost_claims" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "claim_token" uuid,
  "claimed_by" text,
  "claim_expires_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "jobs_kind_key_unique" UNIQUE ("kind", "key"),
  CONSTRAINT "jobs_scope" CHECK ("scope" IN ('venue', 'platform')),
  CONSTRAINT "jobs_scope_venue" CHECK (("scope" = 'venue') = ("venue_id" IS NOT NULL)),
  CONSTRAINT "jobs_state" CHECK ("state" IN ('queued', 'running', 'done', 'dead', 'abandoned')),
  CONSTRAINT "jobs_claim" CHECK (
    ("state" = 'running' AND "claim_token" IS NOT NULL AND "claimed_by" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
    OR ("state" <> 'running' AND "claim_token" IS NULL AND "claimed_by" IS NULL AND "claim_expires_at" IS NULL)),
  CONSTRAINT "jobs_payload_small" CHECK (octet_length("payload"::text) <= 2048),
  CONSTRAINT "jobs_key_length" CHECK (char_length("key") BETWEEN 1 AND 300),
  CONSTRAINT "jobs_counts" CHECK ("attempts" >= 0 AND "lost_claims" >= 0 AND "max_attempts" BETWEEN 1 AND 20),
  CONSTRAINT "jobs_abandoned_has_note" CHECK ("state" <> 'abandoned' OR ("resolved_at" IS NOT NULL AND "resolution" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" ("run_at") WHERE "state" = 'queued';
--> statement-breakpoint
CREATE INDEX "jobs_claims_idx" ON "jobs" ("claim_expires_at") WHERE "state" = 'running';
--> statement-breakpoint
CREATE INDEX "jobs_dead_idx" ON "jobs" ("finished_at") WHERE "state" = 'dead';
--> statement-breakpoint
CREATE INDEX "jobs_venue_state_idx" ON "jobs" ("venue_id", "state");
--> statement-breakpoint
ALTER TABLE "email_sends"
  ADD COLUMN "venue_id" uuid REFERENCES "venues"("id"),
  ADD COLUMN "event_id" uuid,
  ADD COLUMN "enquiry_id" uuid,
  ADD COLUMN "from_header" text,
  ADD COLUMN "reply_to" text,
  ADD COLUMN "html" text,
  ADD COLUMN "first_tried_at" timestamp with time zone,
  ADD COLUMN "delivered_at" timestamp with time zone,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD COLUMN "attempt_epoch" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_event_venue_fk"
  FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_enquiry_venue_fk"
  FOREIGN KEY ("enquiry_id", "venue_id") REFERENCES "enquiries"("id", "venue_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_link_needs_venue"
  CHECK (("event_id" IS NULL AND "enquiry_id" IS NULL) OR "venue_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_status" CHECK ("status" IN
  ('pending', 'sent', 'failed', 'suppressed', 'dev_mode', 'queued', 'not_sent', 'bounced', 'complained')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "email_sends" VALIDATE CONSTRAINT "email_sends_status";
--> statement-breakpoint
CREATE INDEX "email_sends_venue_created_idx" ON "email_sends" ("venue_id", "created_at") WHERE "venue_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "email_sends_event_idx" ON "email_sends" ("event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "email_sends_enquiry_idx" ON "email_sends" ("enquiry_id") WHERE "enquiry_id" IS NOT NULL;

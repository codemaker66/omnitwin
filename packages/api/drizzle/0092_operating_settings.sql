-- Operating settings (goal 19 S7, T-651): beyond the glass.
--
-- Slice 10 gave a venue one escalation window, for "now" requests only.
-- The people matrix (docs/operations/people-matrix.md §3, §6) and Blake's
-- decisions of 10 October 2026 replace it with a window per urgency, quiet
-- hours for email, a duty admin, the wall's day boundary, the relief window
-- for a handover and whether the wall shows guest details. All of it is
-- venue configuration with the decided defaults; the office edits it in the
-- venue's settings, never a migration after this one.
--
-- request_escalation_seconds stays as a column (nothing drops in this
-- release; the previous container still serves while this migrates) and is
-- no longer read once the API that ships with this file is live.
--
-- Also: two nullable columns on requests for the email that waits out quiet
-- hours and the relief a handover waits for, and the two push tables.
-- Additive only.

ALTER TABLE "venue_settings" ADD COLUMN "escalation_now_seconds" integer NOT NULL DEFAULT 120;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "escalation_soon_seconds" integer NOT NULL DEFAULT 300;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "escalation_routine_seconds" integer NOT NULL DEFAULT 900;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "quiet_hours_start" time NOT NULL DEFAULT '22:00';
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "quiet_hours_end" time NOT NULL DEFAULT '07:00';
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "duty_admin_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "day_boundary_hour" integer NOT NULL DEFAULT 4;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "handover_relief_seconds" integer NOT NULL DEFAULT 300;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD COLUMN "wall_shows_guest_details" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "venue_settings" ADD CONSTRAINT "venue_settings_operating_windows" CHECK (
  "escalation_now_seconds" BETWEEN 30 AND 86400
  AND "escalation_soon_seconds" BETWEEN 30 AND 86400
  AND "escalation_routine_seconds" BETWEEN 30 AND 86400
  AND "handover_relief_seconds" BETWEEN 30 AND 86400
  AND "day_boundary_hour" BETWEEN 0 AND 23
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "escalation_emailed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "handover_due_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "device_kind" varchar(10) NOT NULL,
  "user_agent" varchar(300),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "disabled_at" timestamptz,
  CONSTRAINT "push_subscriptions_device_kind" CHECK ("device_kind" IN ('wall', 'phone', 'desk'))
);
--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_venue_idx" ON "push_subscriptions" ("venue_id");
--> statement-breakpoint
CREATE TABLE "push_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscription_id" uuid NOT NULL REFERENCES "push_subscriptions"("id") ON DELETE CASCADE,
  "event" varchar(30) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL UNIQUE,
  "status" varchar(10) NOT NULL DEFAULT 'pending',
  "status_code" integer,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  CONSTRAINT "push_sends_status" CHECK ("status" IN ('pending', 'sent', 'failed', 'gone'))
);

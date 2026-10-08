-- Goal 19 S1 (T-651) — conversations, and the request widened.
--
-- Three new objects and one widened one:
--   threads            a place to talk about one thing (a booking, an event, a
--                      request, later a person). The AUDIENCE is written once
--                      and no statement anywhere widens it.
--   messages           words, with one monotonic cursor per venue so a screen
--                      that reconnects replays exactly what it missed.
--   message_receipts   honest ticks: delivered when fetched, read when said,
--                      acknowledged when pressed.
--   requests           gains chairs, tables and setup; underway, handed-over and
--                      reopened; the outcome "substituted"; its thread; and the
--                      handover in flight.
--
-- Nothing here writes a time. Nothing here reads production data.

CREATE TABLE threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  audience varchar(20) NOT NULL,
  subject varchar(20) NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  request_id uuid REFERENCES requests(id) ON DELETE CASCADE,
  subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_cursor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threads_audience CHECK (audience IN ('staff-private', 'client-facing')),
  CONSTRAINT threads_subject CHECK (subject IN ('booking', 'event', 'request', 'person')),
  -- A thread is about exactly one thing. A booking thread also carries the
  -- booking's event so the client's event page finds it; a request thread
  -- carries the request's booking and event for the same reason.
  CONSTRAINT threads_subject_ref CHECK (
    (subject = 'booking' AND booking_id IS NOT NULL AND request_id IS NULL AND subject_user_id IS NULL)
    OR (subject = 'event' AND event_id IS NOT NULL AND booking_id IS NULL AND request_id IS NULL AND subject_user_id IS NULL)
    OR (subject = 'request' AND request_id IS NOT NULL AND subject_user_id IS NULL)
    OR (subject = 'person' AND subject_user_id IS NOT NULL AND booking_id IS NULL AND event_id IS NULL AND request_id IS NULL)
  ),
  CONSTRAINT threads_title_length CHECK (title IS NULL OR length(title) BETWEEN 1 AND 160)
);
--> statement-breakpoint
-- One thread per audience per thing. Opening the slot's conversation is
-- get-or-create, decided by this index rather than by a prior read. The most
-- specific id comes first: a request thread also carries its booking and
-- event, and must not collide with another request on the same slot.
CREATE UNIQUE INDEX threads_one_per_subject ON threads(
  venue_id, audience, subject, COALESCE(request_id, subject_user_id, booking_id, event_id));
--> statement-breakpoint
CREATE INDEX threads_venue_booking_idx ON threads(venue_id, booking_id);
--> statement-breakpoint
CREATE INDEX threads_venue_event_idx ON threads(venue_id, event_id);
--> statement-breakpoint
CREATE INDEX threads_request_idx ON threads(request_id);
--> statement-breakpoint
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  -- One sequence for every venue's conversations: "everything after N" is
  -- well defined across threads, which is what a reconnecting screen asks.
  cursor bigserial NOT NULL,
  kind varchar(10) NOT NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name varchar(160) NOT NULL,
  author_role varchar(30) NOT NULL,
  body text NOT NULL,
  -- Null for a message the system wrote (a request step).
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_cursor_unique UNIQUE (cursor),
  CONSTRAINT messages_kind CHECK (kind IN ('text', 'request', 'system')),
  CONSTRAINT messages_body_length CHECK (length(body) BETWEEN 1 AND 2000),
  CONSTRAINT messages_author CHECK ((kind = 'system') = (author_user_id IS NULL AND idempotency_key IS NULL))
);
--> statement-breakpoint
-- The concurrency guard for a replayed send: the same key in the same thread
-- is one message, decided by the index.
CREATE UNIQUE INDEX messages_thread_idempotency_unique ON messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX messages_thread_cursor_idx ON messages(thread_id, cursor);
--> statement-breakpoint
CREATE INDEX messages_venue_cursor_idx ON messages(venue_id, cursor);
--> statement-breakpoint
CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  PRIMARY KEY (message_id, recipient_user_id)
);
--> statement-breakpoint
CREATE INDEX message_receipts_recipient_idx ON message_receipts(recipient_user_id, read_at);
--> statement-breakpoint
ALTER TABLE requests DROP CONSTRAINT requests_kind;
--> statement-breakpoint
ALTER TABLE requests ADD CONSTRAINT requests_kind CHECK (
  kind IN ('refreshments', 'temperature', 'cleaning', 'av', 'access', 'chairs', 'tables', 'setup', 'other'));
--> statement-breakpoint
ALTER TABLE requests DROP CONSTRAINT requests_state;
--> statement-breakpoint
ALTER TABLE requests ADD CONSTRAINT requests_state CHECK (
  state IN ('sent', 'acknowledged', 'accepted', 'underway', 'handed-over', 'resolved', 'reopened'));
--> statement-breakpoint
ALTER TABLE requests DROP CONSTRAINT requests_outcome;
--> statement-breakpoint
ALTER TABLE requests ADD CONSTRAINT requests_outcome CHECK (
  outcome IS NULL OR outcome IN ('done', 'not_possible', 'no_longer_needed', 'substituted'));
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN thread_id uuid REFERENCES threads(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN handover_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN handover_to_name varchar(160);
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN handed_over_at timestamptz;
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN underway_at timestamptz;
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN reopened_at timestamptz;
--> statement-breakpoint
-- A handover in flight names its person; nothing else does.
ALTER TABLE requests ADD CONSTRAINT requests_handover_follows_state CHECK (
  (state = 'handed-over') = (handover_to_user_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX requests_thread_idx ON requests(thread_id);
--> statement-breakpoint
ALTER TABLE request_status_history DROP CONSTRAINT request_status_history_from_state;
--> statement-breakpoint
ALTER TABLE request_status_history ADD CONSTRAINT request_status_history_from_state CHECK (
  from_state IS NULL OR from_state IN ('sent', 'acknowledged', 'accepted', 'underway', 'handed-over', 'resolved', 'reopened'));
--> statement-breakpoint
ALTER TABLE request_status_history DROP CONSTRAINT request_status_history_to_state;
--> statement-breakpoint
ALTER TABLE request_status_history ADD CONSTRAINT request_status_history_to_state CHECK (
  to_state IN ('sent', 'acknowledged', 'accepted', 'underway', 'handed-over', 'resolved', 'reopened'));
--> statement-breakpoint
ALTER TABLE request_status_history DROP CONSTRAINT request_status_history_outcome;
--> statement-breakpoint
ALTER TABLE request_status_history ADD CONSTRAINT request_status_history_outcome CHECK (
  outcome IS NULL OR outcome IN ('done', 'not_possible', 'no_longer_needed', 'substituted'));

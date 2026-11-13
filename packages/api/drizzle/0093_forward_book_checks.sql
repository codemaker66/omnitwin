-- ---------------------------------------------------------------------------
-- 0093 (provisional number; the final one is assigned at merge) — the
-- forward book on the Diary, room by room.
--
-- Blake, 17 October 2026, chose "hide date status until checked": the public
-- MCP and every public web surface say nothing about a room's dates (booked,
-- held or nothing on our diary) until the venue has recorded that the room's
-- whole forward book is on the Diary. Until then they tell people to ask the
-- venue team. The book still lives partly in other systems, email and paper,
-- so an empty Diary day is not evidence about the room.
--
-- One row is one such record: who made it (their name as it was then, and
-- their account while it exists), when, and an optional note. Clearing it
-- hides the room's dates again; the row keeps who cleared it and when, so a
-- room's history is never lost. At most one record stands per room at a time.
-- The room belongs to the record's venue (the composite key, as 0076 and 0085
-- do), so a record can never point at another venue's room.
--
-- Schema only: no existing row changes, and no room shows dates until a
-- venue admin or manager records one. Its keys briefly hold writes to venues,
-- users and spaces, which are rarely written: a busy moment holds those
-- writes for up to ten seconds, then fails the deploy rather than wait longer.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE "forward_book_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "recorded_by_name" varchar(200) NOT NULL,
  "note" text,
  "cleared_at" timestamp with time zone,
  "cleared_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "cleared_by_name" varchar(200),
  CONSTRAINT "forward_book_checks_space_venue_fk"
    FOREIGN KEY ("space_id", "venue_id") REFERENCES "spaces"("id", "venue_id"),
  CONSTRAINT "forward_book_checks_recorded_by_name_shape"
    CHECK (btrim("recorded_by_name") <> ''),
  CONSTRAINT "forward_book_checks_note_shape"
    CHECK ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 500)),
  CONSTRAINT "forward_book_checks_cleared_pair"
    CHECK (("cleared_at" IS NULL) = ("cleared_by_name" IS NULL)),
  CONSTRAINT "forward_book_checks_cleared_after_recorded"
    CHECK ("cleared_at" IS NULL OR "cleared_at" >= "recorded_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "forward_book_checks_one_standing"
  ON "forward_book_checks" ("space_id") WHERE "cleared_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "forward_book_checks_venue_recorded_idx"
  ON "forward_book_checks" ("venue_id", "recorded_at");

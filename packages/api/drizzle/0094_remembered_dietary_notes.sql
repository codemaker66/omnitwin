-- Remembered allergy notes: "ask once, then remember" (Blake, 17 October 2026).
-- The number is provisional; the final one is assigned at merge.
--
-- A layout's allergy note is removed 30 days after its event. A client who
-- ticks "Remember these for our next event?" beside it keeps the note with
-- their own account instead, one per venue, and their next layout there is
-- filled in from it. Each row is also the consent record: who (user_id),
-- when (consented_at) and the exact words beside the box (consent_wording).
--
-- Removing a note clears it and keeps the record, with when and why it
-- ended: the client removed it, it went unused for the retention period, or
-- the wording changed and the client agreed to the new words (a new row).
-- An active row always holds a note; an ended row never does.
--
-- Additive only: one new table. Nothing here reads or changes existing rows.

CREATE TABLE remembered_dietary_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  note text,
  consent_wording text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  source_configuration_id uuid REFERENCES configurations(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by varchar(20),
  CONSTRAINT remembered_dietary_notes_note_length CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  CONSTRAINT remembered_dietary_notes_removal CHECK (
    (removed_at IS NULL AND note IS NOT NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND note IS NULL AND removed_by IN ('client', 'retention', 'reworded'))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX remembered_dietary_notes_one_per_venue ON remembered_dietary_notes(user_id, venue_id) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX remembered_dietary_notes_source_configuration_idx ON remembered_dietary_notes(source_configuration_id);

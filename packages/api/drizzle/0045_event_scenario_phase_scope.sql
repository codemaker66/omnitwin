-- Keep an event scenario's optional phase inside the same event.
-- Existing mismatches are repaired to event-wide scenarios by clearing only
-- phase_id; the scenario and its assumptions remain intact.

UPDATE "event_scenarios" AS scenario
SET
  "phase_id" = NULL,
  "updated_at" = NOW()
FROM "event_phases" AS phase
WHERE scenario."phase_id" = phase."id"
  AND scenario."event_id" <> phase."event_id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_phases_event_id_id_unique'
      AND conrelid = 'event_phases'::regclass
  ) THEN
    ALTER TABLE "event_phases"
      ADD CONSTRAINT "event_phases_event_id_id_unique"
      UNIQUE ("event_id", "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_scenarios_event_phase_fk'
      AND conrelid = 'event_scenarios'::regclass
  ) THEN
    ALTER TABLE "event_scenarios"
      ADD CONSTRAINT "event_scenarios_event_phase_fk"
      FOREIGN KEY ("event_id", "phase_id")
      REFERENCES "event_phases" ("event_id", "id")
      ON DELETE SET NULL ("phase_id");
  END IF;
END $$;

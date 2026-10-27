-- ---------------------------------------------------------------------------
-- 0105 — prepared decisions and their history (goal 09 M1; Plan 19 L6)
--
-- A consequential change reaches the venue as a prepared decision: options
-- with a recommendation, each option's consequences and exact mutations, what
-- is not known, who may approve. It is executed only on approval, through the
-- Diary's own command, after the venue's current state is checked again.
--
-- decisions: one row per prepared decision. What was prepared (`body`: the
-- options, basis, consequences, recommendation) never changes; only where it
-- stands does, once: from prepared to executed, declined, failed, superseded
-- or withdrawn, with its receipt. A trigger refuses any other change, so a
-- decided decision is final at the database as well as in the service.
--
-- decision_events: the decision history. One row per step (prepared,
-- executed, declined, failed, stale, withdrawn, an execution error), with who
-- took it and its particulars. Append-only: triggers refuse every update,
-- delete and truncate, as the AI usage ledger's do (0091).
--
-- Kept for good, so nothing kept names a person: a decision holds ids, times,
-- rooms and the Diary's refusal codes, and its consequences are written from
-- times, never from a booking's title (a viewing's title is the enquirer's
-- name). The booking's title is read from the Diary when a decision is read.
-- The asker's reason, free text that can name someone, is in its own column,
-- `reason`, which can be erased (set to null) at any time; nothing else
-- changes with it. Keys restrict deleting a venue or person with decisions
-- (both are soft-deleted in practice); there is no key to bookings. New
-- tables only: running code reads neither until the next release. The keys
-- briefly hold writes to venues and users; a busy moment waits up to ten
-- seconds a lock, then fails the deploy rather than hold them longer. Nothing
-- here reads production data.
--
-- Numbered 0105 after the release queue's 0103 (#258) and 0104 (#262); its
-- journal `when` is later than theirs. The queue confirms the number at merge.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  action_class varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'prepared',
  subject_kind varchar(20) NOT NULL,
  subject_id uuid NOT NULL,
  body jsonb NOT NULL,
  reason text,
  prepared_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  supersedes uuid REFERENCES decisions(id) ON DELETE RESTRICT,
  superseded_by uuid REFERENCES decisions(id) ON DELETE RESTRICT,
  receipt jsonb,
  decided_at timestamptz,
  CONSTRAINT decisions_action_class CHECK (action_class IN ('booking_time_move', 'guest_count_change', 'stock_shortage', 'service_request')),
  CONSTRAINT decisions_status CHECK (status IN ('prepared', 'executed', 'declined', 'failed', 'superseded', 'withdrawn')),
  CONSTRAINT decisions_subject_kind CHECK (subject_kind IN ('booking')),
  CONSTRAINT decisions_body_object CHECK (jsonb_typeof(body) = 'object'),
  CONSTRAINT decisions_reason CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT decisions_window CHECK (expires_at > prepared_at),
  -- A decided decision carries its receipt; one still open carries none.
  CONSTRAINT decisions_receipt CHECK (
    (status IN ('executed', 'declined', 'failed')) = (receipt IS NOT NULL AND jsonb_typeof(receipt) = 'object')
  ),
  CONSTRAINT decisions_decided_at CHECK ((status = 'prepared') = (decided_at IS NULL)),
  -- A superseded decision names the revised one that replaced it.
  CONSTRAINT decisions_superseded CHECK ((status = 'superseded') = (superseded_by IS NOT NULL)),
  CONSTRAINT decisions_not_self CHECK (supersedes IS DISTINCT FROM id AND superseded_by IS DISTINCT FROM id)
);
--> statement-breakpoint
CREATE INDEX decisions_venue_status_prepared_idx ON decisions (venue_id, status, prepared_at DESC);
--> statement-breakpoint
CREATE INDEX decisions_subject_idx ON decisions (subject_kind, subject_id);
--> statement-breakpoint
CREATE FUNCTION guard_decision_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- An update that changes nothing changes nothing (a bulk erasure meets rows already erased).
  IF to_jsonb(NEW) = to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;
  -- Erasing the reason, at any time, and nothing else with it.
  IF NEW.reason IS DISTINCT FROM OLD.reason THEN
    IF NEW.reason IS NOT NULL OR (to_jsonb(NEW) - 'reason') <> (to_jsonb(OLD) - 'reason') THEN
      RAISE EXCEPTION 'a reason is only ever erased, on its own';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'prepared' THEN
    RAISE EXCEPTION 'a decided decision is final';
  END IF;
  IF NEW.id <> OLD.id OR NEW.venue_id <> OLD.venue_id OR NEW.action_class <> OLD.action_class
    OR NEW.subject_kind <> OLD.subject_kind OR NEW.subject_id <> OLD.subject_id OR NEW.body <> OLD.body
    OR NEW.prepared_by <> OLD.prepared_by OR NEW.prepared_at <> OLD.prepared_at OR NEW.expires_at <> OLD.expires_at
    OR NEW.supersedes IS DISTINCT FROM OLD.supersedes THEN
    RAISE EXCEPTION 'what a decision was prepared on never changes';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decisions_guard_update
  BEFORE UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION guard_decision_update();
--> statement-breakpoint
CREATE FUNCTION deny_decision_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decisions are kept';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decisions_no_delete
  BEFORE DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION deny_decision_removal();
--> statement-breakpoint
CREATE TRIGGER decisions_no_truncate
  BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION deny_decision_removal();
--> statement-breakpoint
CREATE TABLE decision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT decision_events_kind CHECK (kind IN ('prepared', 'executed', 'declined', 'failed', 'stale', 'withdrawn', 'execution_error')),
  CONSTRAINT decision_events_detail CHECK (jsonb_typeof(detail) = 'object')
);
--> statement-breakpoint
CREATE INDEX decision_events_decision_created_idx ON decision_events (decision_id, created_at);
--> statement-breakpoint
CREATE FUNCTION deny_decision_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decision_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decision_events_no_update
  BEFORE UPDATE ON decision_events
  FOR EACH ROW EXECUTE FUNCTION deny_decision_event_mutation();
--> statement-breakpoint
CREATE TRIGGER decision_events_no_delete
  BEFORE DELETE ON decision_events
  FOR EACH ROW EXECUTE FUNCTION deny_decision_event_mutation();
--> statement-breakpoint
CREATE TRIGGER decision_events_no_truncate
  BEFORE TRUNCATE ON decision_events
  FOR EACH STATEMENT EXECUTE FUNCTION deny_decision_event_mutation();

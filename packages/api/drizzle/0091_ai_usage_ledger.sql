-- ---------------------------------------------------------------------------
-- 0091 — the AI usage ledger and each venue's monthly AI allowance (T-656)
--
-- Blake, 13 October 2026: "if this is going to actively bill us for claude
-- then we need to work out a way for us to bill our clients on the features
-- that need to use claude's abilities, or work out a way where we don't need
-- to call the api, or something else." Whichever he chooses, every call is
-- measured per venue and feature with its cost, and a venue's spend bounded.
--
-- ai_usage_ledger: one row per model call, or per call refused because the
-- venue's allowance for the month was used. Append-only: triggers refuse
-- every update, delete and truncate. It holds counts, model names, ids and
-- money, never what anyone wrote: no prompt text, no names, no contact
-- details. Money is integer micro-USD priced from the versioned price table
-- in code (services/ai-usage.ts); each row names the version it used. Its
-- keys restrict deleting a venue or person with usage, as the other ledgers'
-- do (both are soft-deleted in practice).
--
-- ai_usage_reservations: what calls in flight hold against the allowance. A
-- call reserves its worst-case cost under a per-venue advisory lock before it
-- is made and gives the reservation up when its ledger row is written; one
-- left by a process that died lapses after ten minutes.
--
-- New tables only: running code reads neither until the next release. The
-- keys briefly hold writes to venues and users; a busy moment waits up to
-- ten seconds a lock, then fails the deploy rather than hold them longer.
-- Nothing here reads production data.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE ai_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  feature varchar(40) NOT NULL,
  provider varchar(80) NOT NULL,
  requested_model varchar(120) NOT NULL,
  model varchar(120) NOT NULL,
  request_id varchar(200),
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cache_creation_input_tokens integer NOT NULL,
  cache_read_input_tokens integer NOT NULL,
  outcome varchar(16) NOT NULL,
  cost_micro_usd bigint NOT NULL,
  price_table_version varchar(40) NOT NULL,
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_ledger_feature CHECK (feature IN ('enquiry_summary', 'lead_qualification', 'proposal_draft', 'beo_supplier_instruction_draft', 'route_conflict_explanation', 'truth_mode_explanation', 'event_brief')),
  CONSTRAINT ai_usage_ledger_outcome CHECK (outcome IN ('ok', 'refusal', 'max_tokens', 'error', 'budget_blocked')),
  CONSTRAINT ai_usage_ledger_names CHECK (provider <> '' AND requested_model <> '' AND model <> '' AND price_table_version <> ''),
  CONSTRAINT ai_usage_ledger_tokens CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_creation_input_tokens >= 0 AND cache_read_input_tokens >= 0),
  CONSTRAINT ai_usage_ledger_cost CHECK (cost_micro_usd >= 0),
  CONSTRAINT ai_usage_ledger_attempts CHECK (jsonb_typeof(attempts) = 'array'),
  -- A call the allowance refused was never made: nothing used, nothing owed.
  CONSTRAINT ai_usage_ledger_blocked CHECK (outcome <> 'budget_blocked' OR (
    input_tokens = 0 AND output_tokens = 0 AND cache_creation_input_tokens = 0 AND cache_read_input_tokens = 0
    AND cost_micro_usd = 0 AND request_id IS NULL AND attempts = '[]'::jsonb))
);
--> statement-breakpoint
CREATE INDEX ai_usage_ledger_venue_created_idx ON ai_usage_ledger (venue_id, created_at);
--> statement-breakpoint
CREATE FUNCTION deny_ai_usage_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_usage_ledger is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_usage_ledger_no_update
  BEFORE UPDATE ON ai_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION deny_ai_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER ai_usage_ledger_no_delete
  BEFORE DELETE ON ai_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION deny_ai_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER ai_usage_ledger_no_truncate
  BEFORE TRUNCATE ON ai_usage_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION deny_ai_usage_ledger_mutation();
--> statement-breakpoint
CREATE TABLE ai_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  reserved_micro_usd bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT ai_usage_reservations_amount CHECK (reserved_micro_usd > 0),
  CONSTRAINT ai_usage_reservations_window CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE INDEX ai_usage_reservations_venue_expires_idx ON ai_usage_reservations (venue_id, expires_at);

-- Append-only reviewed-evidence authority for Event Architect Ops admission.
--
-- The generated guest-flow artifact remains planning support. This migration
-- adds the separate human-review artifact required by the existing Ops
-- Compiler boundary; it does not alter or self-approve candidate evidence.

ALTER TABLE "event_architect_candidates"
  ADD CONSTRAINT "event_architect_candidates_id_run_unique" UNIQUE("id", "run_id");

CREATE TABLE "event_architect_ops_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE RESTRICT,
  "reviewer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewer_authority" varchar(40) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "decision" varchar(20) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "snapshot_digest" varchar(64) NOT NULL,
  "proof_digest" varchar(64) NOT NULL,
  "guest_flow_artifact_hash" varchar(64) NOT NULL,
  "artifact_digest" varchar(64) NOT NULL,
  "witnesses" jsonb NOT NULL,
  "note" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "valid_until" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_architect_ops_reviews_artifact_digest_unique" UNIQUE("artifact_digest"),
  CONSTRAINT "event_architect_ops_reviews_reviewer_idempotency_unique" UNIQUE("candidate_id", "reviewer_user_id", "idempotency_key"),
  CONSTRAINT "event_architect_ops_reviews_candidate_run_fk" FOREIGN KEY("candidate_id", "run_id") REFERENCES "event_architect_candidates"("id", "run_id") ON DELETE RESTRICT,
  CONSTRAINT "event_architect_ops_reviews_authority" CHECK ("reviewer_authority" IN ('venue_staff', 'venue_hallkeeper', 'venue_admin', 'platform_admin')),
  CONSTRAINT "event_architect_ops_reviews_decision" CHECK ("decision" IN ('approved', 'rejected')),
  CONSTRAINT "event_architect_ops_reviews_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_ops_reviews_snapshot_digest_shape" CHECK ("snapshot_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_ops_reviews_proof_digest_shape" CHECK ("proof_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_ops_reviews_guest_flow_digest_shape" CHECK ("guest_flow_artifact_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_ops_reviews_artifact_digest_shape" CHECK ("artifact_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_ops_reviews_validity_window" CHECK ("valid_until" > "reviewed_at"),
  CONSTRAINT "event_architect_ops_reviews_note_length" CHECK (char_length(btrim("note")) BETWEEN 10 AND 2000),
  CONSTRAINT "event_architect_ops_reviews_witness_count" CHECK (jsonb_typeof("witnesses") = 'array' AND jsonb_array_length("witnesses") = 3),
  CONSTRAINT "event_architect_ops_reviews_required_witnesses" CHECK (
    "witnesses" @> '[{"kind":"surveyed_door_positions"}]'::jsonb
    AND "witnesses" @> '[{"kind":"reviewed_route_model"}]'::jsonb
    AND "witnesses" @> '[{"kind":"venue_operations_signoff"}]'::jsonb
  )
);

CREATE INDEX "event_architect_ops_reviews_candidate_reviewed_idx"
  ON "event_architect_ops_reviews" ("candidate_id", "reviewed_at");
CREATE INDEX "event_architect_ops_reviews_valid_until_idx"
  ON "event_architect_ops_reviews" ("valid_until");

CREATE FUNCTION "deny_event_architect_ops_review_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event_architect_ops_reviews is append-only';
END;
$$;

CREATE TRIGGER "event_architect_ops_reviews_no_update"
  BEFORE UPDATE ON "event_architect_ops_reviews"
  FOR EACH ROW EXECUTE FUNCTION "deny_event_architect_ops_review_mutation"();

CREATE TRIGGER "event_architect_ops_reviews_no_delete"
  BEFORE DELETE ON "event_architect_ops_reviews"
  FOR EACH ROW EXECUTE FUNCTION "deny_event_architect_ops_review_mutation"();

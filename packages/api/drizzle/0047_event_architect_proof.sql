-- Proof-carrying Event Architect.
--
-- Candidate configurations, canonical snapshots, and validator witnesses are
-- persisted in one transaction by the application. These tables are an
-- internal planning-evidence boundary; no row implies approval, certification,
-- quotation acceptance, or operational fitness.

CREATE TABLE "canonical_layout_snapshots" (
  "id" uuid PRIMARY KEY NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "schema_version" varchar(60) NOT NULL,
  "snapshot_digest" varchar(64) NOT NULL,
  "source_kind" varchar(40) NOT NULL DEFAULT 'event_architect_candidate',
  "payload" jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "canonical_layout_snapshots_config_unique" UNIQUE("configuration_id"),
  CONSTRAINT "canonical_layout_snapshots_digest_unique" UNIQUE("snapshot_digest"),
  CONSTRAINT "canonical_layout_snapshots_digest_shape" CHECK ("snapshot_digest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "canonical_layout_snapshots_venue_created_idx"
  ON "canonical_layout_snapshots" ("venue_id", "created_at");
CREATE INDEX "canonical_layout_snapshots_space_created_idx"
  ON "canonical_layout_snapshots" ("space_id", "created_at");

CREATE TABLE "layout_validation_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "snapshot_id" uuid NOT NULL REFERENCES "canonical_layout_snapshots"("id") ON DELETE CASCADE,
  "snapshot_digest" varchar(64) NOT NULL,
  "validator_version" varchar(40) NOT NULL,
  "validator_digest" varchar(64) NOT NULL,
  "context_digest" varchar(64) NOT NULL,
  "proof_digest" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "layout_validation_runs_snapshot_unique" UNIQUE("snapshot_id"),
  CONSTRAINT "layout_validation_runs_proof_unique" UNIQUE("proof_digest"),
  CONSTRAINT "layout_validation_runs_snapshot_digest_shape" CHECK ("snapshot_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "layout_validation_runs_validator_digest_shape" CHECK ("validator_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "layout_validation_runs_context_digest_shape" CHECK ("context_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "layout_validation_runs_proof_digest_shape" CHECK ("proof_digest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "layout_validation_runs_snapshot_digest_idx"
  ON "layout_validation_runs" ("snapshot_digest");

CREATE TABLE "event_architect_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE CASCADE,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "engine_version" varchar(40) NOT NULL,
  "engine_digest" varchar(64) NOT NULL,
  "request_payload" jsonb NOT NULL,
  "run_payload" jsonb NOT NULL,
  "selected_candidate_id" uuid,
  "selected_configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "selected_snapshot_digest" varchar(64),
  "selected_proof_digest" varchar(64),
  "selection_idempotency_key" varchar(160),
  "selected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "selected_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_architect_runs_actor_idempotency_unique" UNIQUE("created_by", "idempotency_key"),
  CONSTRAINT "event_architect_runs_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_runs_engine_digest_shape" CHECK ("engine_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_runs_selection_complete" CHECK (
    ("selected_candidate_id" IS NULL AND "selected_configuration_id" IS NULL AND "selected_snapshot_digest" IS NULL AND "selected_proof_digest" IS NULL AND "selection_idempotency_key" IS NULL AND "selected_by" IS NULL AND "selected_at" IS NULL)
    OR
    ("selected_candidate_id" IS NOT NULL AND "selected_configuration_id" IS NOT NULL AND "selected_snapshot_digest" IS NOT NULL AND "selected_proof_digest" IS NOT NULL AND "selection_idempotency_key" IS NOT NULL AND "selected_by" IS NOT NULL AND "selected_at" IS NOT NULL)
  )
);

CREATE INDEX "event_architect_runs_venue_created_idx"
  ON "event_architect_runs" ("venue_id", "created_at");
CREATE INDEX "event_architect_runs_space_created_idx"
  ON "event_architect_runs" ("space_id", "created_at");

CREATE TABLE "event_architect_candidates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "event_architect_runs"("id") ON DELETE CASCADE,
  "rank" integer NOT NULL,
  "strategy" varchar(40) NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "snapshot_id" uuid NOT NULL REFERENCES "canonical_layout_snapshots"("id") ON DELETE CASCADE,
  "validation_run_id" uuid NOT NULL REFERENCES "layout_validation_runs"("id") ON DELETE CASCADE,
  "snapshot_digest" varchar(64) NOT NULL,
  "proof_digest" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "selected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "selected_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_architect_candidates_run_rank_unique" UNIQUE("run_id", "rank"),
  CONSTRAINT "event_architect_candidates_configuration_unique" UNIQUE("configuration_id"),
  CONSTRAINT "event_architect_candidates_snapshot_unique" UNIQUE("snapshot_id"),
  CONSTRAINT "event_architect_candidates_validation_unique" UNIQUE("validation_run_id"),
  CONSTRAINT "event_architect_candidates_rank_range" CHECK ("rank" BETWEEN 1 AND 3),
  CONSTRAINT "event_architect_candidates_strategy" CHECK ("strategy" IN ('comfort_first', 'balanced', 'capacity_first')),
  CONSTRAINT "event_architect_candidates_snapshot_digest_shape" CHECK ("snapshot_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_candidates_proof_digest_shape" CHECK ("proof_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "event_architect_candidates_selection_complete" CHECK (
    ("selected_by" IS NULL AND "selected_at" IS NULL)
    OR ("selected_by" IS NOT NULL AND "selected_at" IS NOT NULL)
  )
);

CREATE INDEX "event_architect_candidates_run_strategy_idx"
  ON "event_architect_candidates" ("run_id", "strategy");

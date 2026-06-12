-- Evidence runtime v0.
--
-- These tables persist planning evidence, assumptions, review gates, claim
-- states, and evidence packs. They are intentionally scoped to planning and
-- review language; no row or status represents legal, fire, occupancy,
-- accessibility, or survey approval.

CREATE TABLE IF NOT EXISTS evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  item_type varchar(40) NOT NULL,
  source_type varchar(40) NOT NULL,
  source_label varchar(200) NOT NULL,
  confidence varchar(20) NOT NULL DEFAULT 'unknown',
  status varchar(20) NOT NULL DEFAULT 'not_checked',
  stale_state varchar(20) NOT NULL DEFAULT 'unknown',
  wording text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_items_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT evidence_items_item_type_check CHECK (
    item_type IN (
      'layout_snapshot',
      'capacity_result',
      'route_clearance_result',
      'runtime_asset_status',
      'assumption',
      'review_gate',
      'safe_wording',
      'human_review_required'
    )
  ),
  CONSTRAINT evidence_items_source_type_check CHECK (
    source_type IN (
      'approved_layout_snapshot',
      'configuration_record',
      'runtime_asset_registry',
      'operator_assumption',
      'system_generated',
      'human_review'
    )
  ),
  CONSTRAINT evidence_items_confidence_check CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  CONSTRAINT evidence_items_status_check CHECK (status IN ('current', 'stale', 'partial', 'missing', 'not_checked')),
  CONSTRAINT evidence_items_stale_state_check CHECK (stale_state IN ('current', 'review_due', 'stale', 'unknown')),
  CONSTRAINT evidence_items_wording_nonempty CHECK (length(trim(wording)) > 0)
);

CREATE INDEX IF NOT EXISTS evidence_items_config_idx ON evidence_items(config_id);
CREATE INDEX IF NOT EXISTS evidence_items_target_idx ON evidence_items(target_type, target_id);
CREATE INDEX IF NOT EXISTS evidence_items_status_idx ON evidence_items(status, stale_state);

CREATE TABLE IF NOT EXISTS check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_item_id uuid REFERENCES evidence_items(id) ON DELETE SET NULL,
  config_id uuid REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  check_type varchar(40) NOT NULL,
  status varchar(30) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'info',
  message text NOT NULL,
  measured_value numeric(12, 4),
  threshold_value numeric(12, 4),
  unit varchar(40),
  source_label varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_results_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT check_results_check_type_check CHECK (
    check_type IN ('snapshot_hash', 'layout_count', 'capacity', 'route_clearance', 'runtime_asset_status')
  ),
  CONSTRAINT check_results_status_check CHECK (
    status IN ('passed', 'failed', 'not_checked', 'not_available', 'requires_review')
  ),
  CONSTRAINT check_results_severity_check CHECK (severity IN ('info', 'warning', 'blocking')),
  CONSTRAINT check_results_message_nonempty CHECK (length(trim(message)) > 0)
);

CREATE INDEX IF NOT EXISTS check_results_config_idx ON check_results(config_id);
CREATE INDEX IF NOT EXISTS check_results_target_idx ON check_results(target_type, target_id);
CREATE INDEX IF NOT EXISTS check_results_type_status_idx ON check_results(check_type, status);

CREATE TABLE IF NOT EXISTS assumption_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  assumption_type varchar(80) NOT NULL,
  value jsonb NOT NULL,
  source_label varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assumption_records_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT assumption_records_status_check CHECK (status IN ('active', 'superseded', 'rejected')),
  CONSTRAINT assumption_records_type_nonempty CHECK (length(trim(assumption_type)) > 0)
);

CREATE INDEX IF NOT EXISTS assumption_records_config_idx ON assumption_records(config_id);
CREATE INDEX IF NOT EXISTS assumption_records_target_idx ON assumption_records(target_type, target_id);

CREATE TABLE IF NOT EXISTS review_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  gate_type varchar(60) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  title varchar(200) NOT NULL,
  description text NOT NULL,
  required_role varchar(80),
  decision_by uuid REFERENCES users(id),
  decision_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_gates_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT review_gates_gate_type_check CHECK (
    gate_type IN (
      'human_review_required',
      'missing_route_clearance',
      'runtime_asset_unverified',
      'stale_snapshot',
      'operator_assumption'
    )
  ),
  CONSTRAINT review_gates_status_check CHECK (status IN ('open', 'approved', 'rejected', 'waived')),
  CONSTRAINT review_gates_decision_coherence CHECK (
    (status = 'open' AND decision_at IS NULL)
    OR
    (status <> 'open' AND decision_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS review_gates_config_idx ON review_gates(config_id);
CREATE INDEX IF NOT EXISTS review_gates_target_idx ON review_gates(target_type, target_id);
CREATE INDEX IF NOT EXISTS review_gates_status_idx ON review_gates(status);

CREATE TABLE IF NOT EXISTS evidence_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES configuration_sheet_snapshots(id) ON DELETE CASCADE,
  snapshot_hash varchar(64) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'generated',
  human_review_required boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL,
  generated_by uuid REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  CONSTRAINT evidence_packs_snapshot_hash_check CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_packs_payload_hash_check CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_packs_status_check CHECK (status IN ('generated', 'superseded', 'stale')),
  CONSTRAINT evidence_packs_stale_coherence CHECK (
    (status = 'stale' AND stale_at IS NOT NULL)
    OR
    (status <> 'stale')
  ),
  CONSTRAINT evidence_packs_snapshot_hash_unique UNIQUE (snapshot_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS evidence_packs_config_idx ON evidence_packs(config_id);
CREATE INDEX IF NOT EXISTS evidence_packs_snapshot_idx ON evidence_packs(snapshot_id);
CREATE INDEX IF NOT EXISTS evidence_packs_status_idx ON evidence_packs(status);

CREATE TABLE IF NOT EXISTS claim_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  claim_key varchar(120) NOT NULL,
  status varchar(40) NOT NULL,
  safe_wording text NOT NULL,
  evidence_pack_id uuid REFERENCES evidence_packs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_states_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT claim_states_status_check CHECK (
    status IN ('planning_evidence', 'human_review_required', 'not_checked', 'unsupported', 'stale')
  ),
  CONSTRAINT claim_states_wording_nonempty CHECK (length(trim(safe_wording)) > 0),
  CONSTRAINT claim_states_target_key_unique UNIQUE (target_type, target_id, claim_key)
);

CREATE INDEX IF NOT EXISTS claim_states_config_idx ON claim_states(config_id);
CREATE INDEX IF NOT EXISTS claim_states_pack_idx ON claim_states(evidence_pack_id);

CREATE TABLE IF NOT EXISTS evidence_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_pack_id uuid NOT NULL REFERENCES evidence_packs(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  item_role varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_pack_items_role_check CHECK (
    item_role IN (
      'layout_snapshot',
      'capacity_result',
      'route_clearance_result',
      'runtime_asset_status',
      'assumption',
      'review_gate',
      'safe_wording',
      'human_review_required'
    )
  ),
  CONSTRAINT evidence_pack_items_unique UNIQUE (evidence_pack_id, evidence_item_id, item_role)
);

CREATE INDEX IF NOT EXISTS evidence_pack_items_pack_idx ON evidence_pack_items(evidence_pack_id);

CREATE TABLE IF NOT EXISTS stale_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  target_type varchar(40) NOT NULL,
  target_id varchar(160) NOT NULL,
  evidence_pack_id uuid REFERENCES evidence_packs(id) ON DELETE SET NULL,
  reason varchar(200) NOT NULL,
  previous_hash varchar(64),
  new_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stale_evidence_events_target_type_check CHECK (
    target_type IN (
      'configuration',
      'layout_snapshot',
      'event_phase',
      'layout_variant',
      'table',
      'route',
      'room',
      'runtime_asset',
      'review_gate'
    )
  ),
  CONSTRAINT stale_evidence_events_previous_hash_check CHECK (
    previous_hash IS NULL OR previous_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT stale_evidence_events_new_hash_check CHECK (
    new_hash IS NULL OR new_hash ~ '^[a-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS stale_evidence_events_config_idx ON stale_evidence_events(config_id);
CREATE INDEX IF NOT EXISTS stale_evidence_events_target_idx ON stale_evidence_events(target_type, target_id);
CREATE INDEX IF NOT EXISTS stale_evidence_events_pack_idx ON stale_evidence_events(evidence_pack_id);

CREATE TABLE IF NOT EXISTS general_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action varchar(120) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id varchar(160) NOT NULL,
  summary text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT general_audit_log_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT general_audit_log_summary_nonempty CHECK (length(trim(summary)) > 0)
);

CREATE INDEX IF NOT EXISTS general_audit_log_target_idx ON general_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS general_audit_log_actor_idx ON general_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS general_audit_log_action_idx ON general_audit_log(action);

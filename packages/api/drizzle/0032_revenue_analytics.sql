CREATE TABLE IF NOT EXISTS "revenue_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL,
  "quote_id" uuid REFERENCES "quotes"("id") ON DELETE SET NULL,
  "name" varchar(500) NOT NULL,
  "scenario_kind" varchar(40) NOT NULL DEFAULT 'manual',
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "currency" varchar(3) NOT NULL DEFAULT 'GBP',
  "planned_guest_count" integer NOT NULL DEFAULT 0,
  "estimated_revenue_minor" integer NOT NULL DEFAULT 0,
  "estimated_cost_minor" integer NOT NULL DEFAULT 0,
  "estimated_margin_minor" integer NOT NULL DEFAULT 0,
  "comfort_status" varchar(30) NOT NULL DEFAULT 'not_checked',
  "review_gate_count" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenue_scenarios_status_check" CHECK ("status" IN ('draft', 'active', 'archived')),
  CONSTRAINT "revenue_scenarios_kind_check" CHECK ("scenario_kind" IN ('quote_based', 'layout_based', 'manual')),
  CONSTRAINT "revenue_scenarios_currency_check" CHECK ("currency" IN ('GBP', 'USD', 'EUR')),
  CONSTRAINT "revenue_scenarios_amounts_nonneg" CHECK (
    "planned_guest_count" >= 0
    AND "estimated_revenue_minor" >= 0
    AND "estimated_cost_minor" >= 0
    AND "review_gate_count" >= 0
  ),
  CONSTRAINT "revenue_scenarios_margin_exact" CHECK ("estimated_margin_minor" = "estimated_revenue_minor" - "estimated_cost_minor"),
  CONSTRAINT "revenue_scenarios_comfort_status_check" CHECK ("comfort_status" IN ('ok', 'warning', 'review_required', 'not_checked'))
);

CREATE INDEX IF NOT EXISTS "revenue_scenarios_venue_status_idx" ON "revenue_scenarios" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "revenue_scenarios_event_idx" ON "revenue_scenarios" ("event_id");
CREATE INDEX IF NOT EXISTS "revenue_scenarios_quote_idx" ON "revenue_scenarios" ("quote_id");

CREATE TABLE IF NOT EXISTS "pricing_assumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revenue_scenario_id" uuid NOT NULL REFERENCES "revenue_scenarios"("id") ON DELETE CASCADE,
  "key" varchar(120) NOT NULL,
  "label" varchar(500) NOT NULL,
  "value_minor" integer,
  "value_number" numeric(14, 4),
  "value_text" varchar(500),
  "source" varchar(500) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pricing_assumptions_value_minor_nonneg" CHECK ("value_minor" IS NULL OR "value_minor" >= 0),
  CONSTRAINT "pricing_assumptions_payload_shape" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX IF NOT EXISTS "pricing_assumptions_scenario_idx" ON "pricing_assumptions" ("revenue_scenario_id");

CREATE TABLE IF NOT EXISTS "comfort_constraints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revenue_scenario_id" uuid NOT NULL REFERENCES "revenue_scenarios"("id") ON DELETE CASCADE,
  "constraint_type" varchar(40) NOT NULL,
  "label" varchar(500) NOT NULL,
  "threshold" numeric(14, 4),
  "actual_value" numeric(14, 4),
  "status" varchar(30) NOT NULL,
  "review_required" boolean NOT NULL DEFAULT false,
  "note" varchar(500),
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comfort_constraints_type_check" CHECK ("constraint_type" IN ('space_per_guest', 'circulation', 'bar_queue', 'service_access', 'review_gate')),
  CONSTRAINT "comfort_constraints_status_check" CHECK ("status" IN ('ok', 'warning', 'review_required', 'not_checked')),
  CONSTRAINT "comfort_constraints_review_required_coherent" CHECK ("status" != 'review_required' OR "review_required" = true),
  CONSTRAINT "comfort_constraints_payload_shape" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX IF NOT EXISTS "comfort_constraints_scenario_status_idx" ON "comfort_constraints" ("revenue_scenario_id", "status");

CREATE TABLE IF NOT EXISTS "scenario_comparisons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "event_id" uuid REFERENCES "events"("id") ON DELETE SET NULL,
  "left_scenario_id" uuid NOT NULL REFERENCES "revenue_scenarios"("id") ON DELETE CASCADE,
  "right_scenario_id" uuid NOT NULL REFERENCES "revenue_scenarios"("id") ON DELETE CASCADE,
  "currency" varchar(3) NOT NULL DEFAULT 'GBP',
  "revenue_delta_minor" integer NOT NULL DEFAULT 0,
  "margin_delta_minor" integer NOT NULL DEFAULT 0,
  "comfort_delta_label" varchar(500) NOT NULL,
  "review_gate_delta" integer NOT NULL DEFAULT 0,
  "recommendation_status" varchar(30) NOT NULL DEFAULT 'not_checked',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "scenario_comparisons_currency_check" CHECK ("currency" IN ('GBP', 'USD', 'EUR')),
  CONSTRAINT "scenario_comparisons_distinct_scenarios" CHECK ("left_scenario_id" <> "right_scenario_id"),
  CONSTRAINT "scenario_comparisons_recommendation_status_check" CHECK ("recommendation_status" IN ('ok', 'warning', 'review_required', 'not_checked'))
);

CREATE INDEX IF NOT EXISTS "scenario_comparisons_venue_idx" ON "scenario_comparisons" ("venue_id", "created_at");
CREATE INDEX IF NOT EXISTS "scenario_comparisons_event_idx" ON "scenario_comparisons" ("event_id");

CREATE TABLE IF NOT EXISTS "analytics_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "snapshot_type" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL,
  "generated_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_snapshots_type_check" CHECK ("snapshot_type" IN ('venue_dashboard', 'pipeline_summary', 'room_utilisation')),
  CONSTRAINT "analytics_snapshots_payload_shape" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX IF NOT EXISTS "analytics_snapshots_venue_type_idx" ON "analytics_snapshots" ("venue_id", "snapshot_type", "created_at");

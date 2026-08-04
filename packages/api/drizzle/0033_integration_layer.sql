CREATE TABLE IF NOT EXISTS "integration_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "provider" varchar(40) NOT NULL,
  "label" varchar(500) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'pending_setup',
  "credential_mode" varchar(30) NOT NULL DEFAULT 'not_configured',
  "credential_ref" varchar(200),
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "health_status" varchar(500) NOT NULL DEFAULT 'Not connected',
  "last_checked_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_connections_provider_check"
    CHECK ("provider" IN ('cvent', 'salesforce', 'email', 'calendar', 'accounting', 'e_sign', 'website_embed', 'custom_webhook')),
  CONSTRAINT "integration_connections_status_check"
    CHECK ("status" IN ('disabled', 'pending_setup', 'active', 'error', 'archived')),
  CONSTRAINT "integration_connections_credential_mode_check"
    CHECK ("credential_mode" IN ('not_configured', 'env_ref', 'vault_ref')),
  CONSTRAINT "integration_connections_credential_ref_coherent"
    CHECK (
      ("credential_mode" = 'not_configured' AND "credential_ref" IS NULL)
      OR ("credential_mode" IN ('env_ref', 'vault_ref') AND "credential_ref" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "integration_connections_venue_provider_idx"
  ON "integration_connections" ("venue_id", "provider");
CREATE INDEX IF NOT EXISTS "integration_connections_venue_status_idx"
  ON "integration_connections" ("venue_id", "status");

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "integration_connection_id" uuid REFERENCES "integration_connections"("id") ON DELETE SET NULL,
  "label" varchar(500) NOT NULL,
  "url" text NOT NULL,
  "event_types" jsonb NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'test_only',
  "signing_secret_ref" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_endpoints_status_check"
    CHECK ("status" IN ('disabled', 'active', 'test_only', 'archived')),
  CONSTRAINT "webhook_endpoints_event_types_array"
    CHECK (jsonb_typeof("event_types") = 'array')
);

CREATE INDEX IF NOT EXISTS "webhook_endpoints_venue_status_idx"
  ON "webhook_endpoints" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "webhook_endpoints_connection_idx"
  ON "webhook_endpoints" ("integration_connection_id");

CREATE TABLE IF NOT EXISTS "external_calendar_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "integration_connection_id" uuid REFERENCES "integration_connections"("id") ON DELETE SET NULL,
  "calendar_label" varchar(500) NOT NULL,
  "external_calendar_id" varchar(240) NOT NULL,
  "sync_direction" varchar(30) NOT NULL DEFAULT 'read_only',
  "status" varchar(30) NOT NULL DEFAULT 'pending_setup',
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "external_calendar_links_sync_direction_check"
    CHECK ("sync_direction" IN ('read_only', 'write_outbound', 'two_way')),
  CONSTRAINT "external_calendar_links_status_check"
    CHECK ("status" IN ('disabled', 'pending_setup', 'active', 'error', 'archived'))
);

CREATE INDEX IF NOT EXISTS "external_calendar_links_venue_idx"
  ON "external_calendar_links" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "external_calendar_links_connection_idx"
  ON "external_calendar_links" ("integration_connection_id");

CREATE TABLE IF NOT EXISTS "website_embed_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "room_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL,
  "embed_key" varchar(80) NOT NULL UNIQUE,
  "venue_name" varchar(500) NOT NULL,
  "room_name" varchar(500),
  "cta_label" varchar(500) NOT NULL,
  "cta_url" text NOT NULL,
  "safe_mode" boolean NOT NULL DEFAULT true,
  "analytics_mode" varchar(20) NOT NULL DEFAULT 'stub',
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "website_embed_configs_safe_mode_check" CHECK ("safe_mode" = true),
  CONSTRAINT "website_embed_configs_analytics_stub_check" CHECK ("analytics_mode" = 'stub'),
  CONSTRAINT "website_embed_configs_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS "website_embed_configs_venue_status_idx"
  ON "website_embed_configs" ("venue_id", "status");
CREATE INDEX IF NOT EXISTS "website_embed_configs_room_idx"
  ON "website_embed_configs" ("room_id");

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid REFERENCES "venues"("id") ON DELETE SET NULL,
  "template_key" varchar(120) NOT NULL,
  "label" varchar(500) NOT NULL,
  "subject_template" varchar(500) NOT NULL,
  "body_template" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "managed_by_code" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_templates_status_check"
    CHECK ("status" IN ('draft', 'active', 'archived')),
  CONSTRAINT "email_templates_venue_key_unique"
    UNIQUE ("venue_id", "template_key")
);

CREATE INDEX IF NOT EXISTS "email_templates_venue_status_idx"
  ON "email_templates" ("venue_id", "status");

CREATE TABLE IF NOT EXISTS "integration_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "integration_connection_id" uuid REFERENCES "integration_connections"("id") ON DELETE SET NULL,
  "direction" varchar(20) NOT NULL,
  "event_type" varchar(120) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'stubbed',
  "payload_hash" varchar(64) NOT NULL,
  "summary" varchar(500) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_events_direction_check"
    CHECK ("direction" IN ('inbound', 'outbound')),
  CONSTRAINT "integration_events_status_check"
    CHECK ("status" IN ('queued', 'stubbed', 'sent', 'failed', 'ignored')),
  CONSTRAINT "integration_events_payload_hash_shape"
    CHECK ("payload_hash" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS "integration_events_venue_created_idx"
  ON "integration_events" ("venue_id", "created_at");
CREATE INDEX IF NOT EXISTS "integration_events_connection_idx"
  ON "integration_events" ("integration_connection_id");

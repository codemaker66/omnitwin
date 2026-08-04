-- -----------------------------------------------------------------------------
-- 0059_action_log
--
-- G4 Slice 3 (03 §2): the append-only audit trail behind the planner's
-- Action envelope. One row per Action, config-scoped, revision-anchored.
-- "id" is the client-supplied action uuid (no default): batch ingestion
-- inserts ON CONFLICT (id) DO NOTHING, making retries idempotent. "ordinal"
-- is the server-assigned bigserial the audit read pages by — client clocks
-- ("recorded_ts") never order the trail; the server clock lives separately
-- in "received_at" so neither is presented as the other. Append-only by
-- code contract: no update or delete surface exists; rows leave only when a
-- configuration is hard-deleted (cascade, repo convention).
-- -----------------------------------------------------------------------------

CREATE TABLE "action_log" (
  "id" uuid PRIMARY KEY NOT NULL,
  "ordinal" bigserial NOT NULL,
  "configuration_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "submitted_by" uuid NOT NULL,
  "actor" jsonb NOT NULL,
  "intent" varchar(160) NOT NULL,
  "payload" jsonb NOT NULL,
  "inverse" jsonb,
  "provenance" jsonb NOT NULL,
  "recorded_ts" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "action_log_ordinal_unique" UNIQUE("ordinal")
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "action_log_config_ordinal_idx" ON "action_log" USING btree ("configuration_id","ordinal");

-- Evidence-to-Runtime Reconstruction Foundry.
--
-- Bundle bytes, machine QA, detached attestations, human decisions, public
-- publication receipts, and pointer history are append-only. The channel row
-- is the sole mutable object and is advanced with revision compare-and-swap.

CREATE TABLE "reconstruction_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "release_digest" varchar(64) NOT NULL,
  "source_manifest_sha256" varchar(64) NOT NULL,
  "release_manifest_sha256" varchar(64) NOT NULL,
  "candidate_bucket" varchar(255) NOT NULL,
  "candidate_prefix" text NOT NULL,
  "release_manifest_key" text NOT NULL,
  "file_count" integer NOT NULL,
  "total_bytes" bigint NOT NULL,
  "manifest_json" jsonb NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_releases_venue_kind_digest_unique" UNIQUE("venue_slug", "release_kind", "release_digest"),
  CONSTRAINT "reconstruction_releases_manifest_key_unique" UNIQUE("candidate_bucket", "release_manifest_key"),
  CONSTRAINT "reconstruction_releases_actor_idempotency_unique" UNIQUE("created_by", "idempotency_key"),
  CONSTRAINT "reconstruction_releases_id_venue_kind_unique" UNIQUE("id", "venue_slug", "release_kind"),
  CONSTRAINT "reconstruction_releases_id_scope_digest_unique" UNIQUE("id", "venue_slug", "release_kind", "release_digest"),
  CONSTRAINT "reconstruction_releases_id_scope_digest_manifest_unique" UNIQUE("id", "venue_slug", "release_kind", "release_digest", "release_manifest_sha256"),
  CONSTRAINT "reconstruction_releases_id_scope_digest_source_unique" UNIQUE("id", "venue_slug", "release_kind", "release_digest", "source_manifest_sha256"),
  CONSTRAINT "reconstruction_releases_id_digest_manifest_unique" UNIQUE("id", "release_digest", "release_manifest_sha256"),
  CONSTRAINT "reconstruction_releases_id_digest_source_unique" UNIQUE("id", "release_digest", "source_manifest_sha256"),
  CONSTRAINT "reconstruction_releases_kind" CHECK ("release_kind" IN ('venue_twin_v1')),
  CONSTRAINT "reconstruction_releases_digest_shape" CHECK ("release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_releases_source_manifest_digest_shape" CHECK ("source_manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_releases_manifest_digest_shape" CHECK ("release_manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_releases_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_releases_file_count" CHECK ("file_count" > 0),
  CONSTRAINT "reconstruction_releases_total_bytes" CHECK ("total_bytes" > 0 AND "total_bytes" <= 5368709120),
  CONSTRAINT "reconstruction_releases_manifest_object" CHECK (jsonb_typeof("manifest_json") = 'object'),
  CONSTRAINT "reconstruction_releases_candidate_prefix" CHECK (
    "candidate_prefix" !~ '(^/|\\\\|(^|/)\.\.?(/|$)|//|[?#])'
  )
);

CREATE TABLE "reconstruction_release_qa_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "qa_profile_version" varchar(80) NOT NULL,
  "qa_profile_digest" varchar(64) NOT NULL,
  "outcome" varchar(20) NOT NULL,
  "report_digest" varchar(64) NOT NULL,
  "report_key" text NOT NULL,
  "report_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_qa_release_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_qa_release_report_unique" UNIQUE("release_id", "report_digest"),
  CONSTRAINT "reconstruction_qa_id_release_unique" UNIQUE("id", "release_id"),
  CONSTRAINT "reconstruction_qa_id_release_report_unique" UNIQUE("id", "release_id", "report_digest"),
  CONSTRAINT "reconstruction_qa_release_scope_report_unique" UNIQUE("release_id", "venue_slug", "release_kind", "report_digest"),
  CONSTRAINT "reconstruction_qa_id_release_scope_report_unique" UNIQUE("id", "release_id", "venue_slug", "release_kind", "report_digest"),
  CONSTRAINT "reconstruction_qa_outcome" CHECK ("outcome" IN ('passed', 'failed')),
  CONSTRAINT "reconstruction_qa_profile_digest_shape" CHECK ("qa_profile_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_qa_report_digest_shape" CHECK ("report_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_qa_report_object" CHECK (jsonb_typeof("report_json") = 'object')
);

CREATE TABLE "reconstruction_release_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL,
  "qa_run_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "reviewer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewer_authority" varchar(40) NOT NULL,
  "decision" varchar(20) NOT NULL,
  "target_exposure" varchar(30) NOT NULL,
  "release_digest" varchar(64) NOT NULL,
  "release_manifest_sha256" varchar(64) NOT NULL,
  "qa_report_digest" varchar(64) NOT NULL,
  "visual_evidence" jsonb NOT NULL,
  "transform_artifact_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "scene_authority_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "review_sequence" integer NOT NULL,
  "supersedes_review_id" uuid,
  "reviewed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_reviews_release_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_reviews_release_digest_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "release_digest", "release_manifest_sha256")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest", "release_manifest_sha256") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_reviews_qa_fk" FOREIGN KEY("qa_run_id", "release_id", "venue_slug", "release_kind", "qa_report_digest")
    REFERENCES "reconstruction_release_qa_runs"("id", "release_id", "venue_slug", "release_kind", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_reviews_supersedes_release_fk" FOREIGN KEY("supersedes_review_id", "release_id")
    REFERENCES "reconstruction_release_reviews"("id", "release_id") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_reviews_reviewer_idempotency_unique" UNIQUE("reviewer_user_id", "idempotency_key"),
  CONSTRAINT "reconstruction_reviews_release_sequence_unique" UNIQUE("release_id", "review_sequence"),
  CONSTRAINT "reconstruction_reviews_release_supersedes_unique" UNIQUE("release_id", "supersedes_review_id"),
  CONSTRAINT "reconstruction_reviews_id_release_unique" UNIQUE("id", "release_id"),
  CONSTRAINT "reconstruction_reviews_id_release_digest_unique" UNIQUE("id", "release_id", "request_digest"),
  CONSTRAINT "reconstruction_reviews_id_exact_evidence_unique" UNIQUE("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "request_digest"),
  CONSTRAINT "reconstruction_reviews_authority" CHECK ("reviewer_authority" = 'platform_admin'),
  CONSTRAINT "reconstruction_reviews_decision" CHECK ("decision" IN ('approved', 'rejected')),
  CONSTRAINT "reconstruction_reviews_exposure" CHECK ("target_exposure" IN ('expert_review', 'public')),
  CONSTRAINT "reconstruction_reviews_release_digest_shape" CHECK ("release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_reviews_manifest_digest_shape" CHECK ("release_manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_reviews_qa_digest_shape" CHECK ("qa_report_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_reviews_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_reviews_sequence" CHECK ("review_sequence" > 0),
  CONSTRAINT "reconstruction_reviews_note_length" CHECK (char_length(btrim("note")) BETWEEN 10 AND 4000),
  CONSTRAINT "reconstruction_reviews_visual_evidence_array" CHECK (jsonb_typeof("visual_evidence") = 'array'),
  CONSTRAINT "reconstruction_reviews_transform_refs_array" CHECK (jsonb_typeof("transform_artifact_refs") = 'array'),
  CONSTRAINT "reconstruction_reviews_scene_refs_array" CHECK (jsonb_typeof("scene_authority_refs") = 'array'),
  CONSTRAINT "reconstruction_reviews_public_approval_evidence" CHECK (
    "decision" <> 'approved' OR "target_exposure" <> 'public' OR (
      jsonb_array_length("transform_artifact_refs") > 0
      AND jsonb_array_length("scene_authority_refs") > 0
      AND jsonb_array_length("visual_evidence") > 0
    )
  )
);

-- Immutable registry headers for the two external evidence artifacts a public
-- review must cite. The JSON bodies remain private objects; this table records
-- their exact content address, object receipt, schema, and registering actor.
CREATE TABLE "reconstruction_review_evidence_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "artifact_kind" varchar(50) NOT NULL,
  "artifact_id" varchar(160) NOT NULL,
  "artifact_digest" varchar(64) NOT NULL,
  "object_key" text NOT NULL,
  "object_sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "schema_version" varchar(80) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "registered_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_review_evidence_venue_kind_id_digest_unique"
    UNIQUE("venue_slug", "artifact_kind", "artifact_id", "artifact_digest"),
  CONSTRAINT "reconstruction_review_evidence_actor_idempotency_unique"
    UNIQUE("registered_by", "idempotency_key"),
  CONSTRAINT "reconstruction_review_evidence_kind" CHECK (
    "artifact_kind" IN ('transform_artifact_v0', 'scene_authority_map_v0')
  ),
  CONSTRAINT "reconstruction_review_evidence_venue_slug" CHECK (
    "venue_slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT "reconstruction_review_evidence_artifact_id" CHECK (
    "artifact_id" ~ '^[a-z0-9][a-z0-9._-]{0,159}$'
  ),
  CONSTRAINT "reconstruction_review_evidence_artifact_digest_shape" CHECK (
    "artifact_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "reconstruction_review_evidence_object_digest_shape" CHECK (
    "object_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "reconstruction_review_evidence_request_digest_shape" CHECK (
    "request_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "reconstruction_review_evidence_digest_binding" CHECK (
    "artifact_digest" = "object_sha256"
  ),
  CONSTRAINT "reconstruction_review_evidence_size" CHECK (
    "size_bytes" > 0 AND "size_bytes" <= 4194304
  ),
  CONSTRAINT "reconstruction_review_evidence_object_key" CHECK (
    char_length("object_key") BETWEEN 1 AND 1024
    AND "object_key" !~ '(^/|\\\\|(^|/)\.\.?(/|$)|//|[?#])'
    AND "object_key" ~ '\.json$'
  ),
  CONSTRAINT "reconstruction_review_evidence_schema_version" CHECK (
    "schema_version" ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  CONSTRAINT "reconstruction_review_evidence_idempotency_key" CHECK (
    "idempotency_key" ~ '^[A-Za-z0-9._:-]{8,160}$'
  )
);

CREATE TABLE "reconstruction_release_attestations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "attestation_type" varchar(50) NOT NULL,
  "release_digest" varchar(64) NOT NULL,
  "qa_report_digest" varchar(64) NOT NULL,
  "review_id" uuid NOT NULL,
  "review_digest" varchar(64) NOT NULL,
  "key_id" varchar(160) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "statement_sha256" varchar(64) NOT NULL,
  "envelope_sha256" varchar(64) NOT NULL,
  "r2_key" text NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "verified_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_attestations_release_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "release_digest")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_attestations_qa_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "qa_report_digest")
    REFERENCES "reconstruction_release_qa_runs"("release_id", "venue_slug", "release_kind", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_attestations_release_envelope_unique" UNIQUE("release_id", "envelope_sha256"),
  CONSTRAINT "reconstruction_attestations_release_key_unique" UNIQUE("release_id", "r2_key"),
  CONSTRAINT "reconstruction_attestations_actor_idempotency_unique" UNIQUE("verified_by", "idempotency_key"),
  CONSTRAINT "reconstruction_attestations_id_release_unique" UNIQUE("id", "release_id"),
  CONSTRAINT "reconstruction_attestations_id_release_envelope_unique" UNIQUE("id", "release_id", "envelope_sha256"),
  CONSTRAINT "reconstruction_attestations_id_exact_evidence_unique" UNIQUE("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_id", "review_digest", "envelope_sha256"),
  CONSTRAINT "reconstruction_attestations_review_fk" FOREIGN KEY("review_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_digest")
    REFERENCES "reconstruction_release_reviews"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "request_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_attestations_type" CHECK ("attestation_type" = 'in_toto_dsse_ed25519'),
  CONSTRAINT "reconstruction_attestations_key_fingerprint_shape" CHECK ("public_key_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_release_digest_shape" CHECK ("release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_qa_digest_shape" CHECK ("qa_report_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_review_digest_shape" CHECK ("review_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_statement_digest_shape" CHECK ("statement_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_envelope_digest_shape" CHECK ("envelope_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_attestations_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "reconstruction_release_publications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "release_digest" varchar(64) NOT NULL,
  "qa_report_digest" varchar(64) NOT NULL,
  "review_id" uuid NOT NULL,
  "review_digest" varchar(64) NOT NULL,
  "attestation_id" uuid NOT NULL,
  "attestation_envelope_sha256" varchar(64) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "note" text NOT NULL,
  "candidate_prefix" text NOT NULL,
  "release_bucket" varchar(255) NOT NULL,
  "release_prefix" text NOT NULL,
  "public_manifest_key" text NOT NULL,
  "public_base_url" text NOT NULL,
  "manifest_url" text NOT NULL,
  "manifest_sha256" varchar(64) NOT NULL,
  "verification_digest" varchar(64) NOT NULL,
  "object_count" integer NOT NULL,
  "total_bytes" bigint NOT NULL,
  "published_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamptz NOT NULL DEFAULT now(),
  "verified_at" timestamptz NOT NULL,
  CONSTRAINT "reconstruction_publications_release_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "release_digest")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_publications_release_review_attestation_unique" UNIQUE("release_id", "review_id", "attestation_id"),
  CONSTRAINT "reconstruction_publications_id_release_scope_digest_unique" UNIQUE("id", "release_id", "venue_slug", "release_kind", "release_digest"),
  CONSTRAINT "reconstruction_publications_actor_idempotency_unique" UNIQUE("published_by", "idempotency_key"),
  CONSTRAINT "reconstruction_publications_release_digest_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "release_digest", "manifest_sha256")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest", "source_manifest_sha256") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_publications_qa_fk" FOREIGN KEY("release_id", "venue_slug", "release_kind", "qa_report_digest")
    REFERENCES "reconstruction_release_qa_runs"("release_id", "venue_slug", "release_kind", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_publications_review_fk" FOREIGN KEY("review_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_digest")
    REFERENCES "reconstruction_release_reviews"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "request_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_publications_attestation_fk" FOREIGN KEY("attestation_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_id", "review_digest", "attestation_envelope_sha256")
    REFERENCES "reconstruction_release_attestations"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_id", "review_digest", "envelope_sha256") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_publications_release_digest_shape" CHECK ("release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_qa_digest_shape" CHECK ("qa_report_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_review_digest_shape" CHECK ("review_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_attestation_digest_shape" CHECK ("attestation_envelope_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_manifest_digest_shape" CHECK ("manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_verification_digest_shape" CHECK ("verification_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_publications_object_count" CHECK ("object_count" > 0),
  CONSTRAINT "reconstruction_publications_total_bytes" CHECK ("total_bytes" > 0 AND "total_bytes" <= 5368709120),
  CONSTRAINT "reconstruction_publications_note_length" CHECK (char_length(btrim("note")) BETWEEN 20 AND 2000),
  CONSTRAINT "reconstruction_publications_verification_order" CHECK ("verified_at" >= "published_at"),
  CONSTRAINT "reconstruction_publications_public_url" CHECK ("public_base_url" ~ '^https://'),
  CONSTRAINT "reconstruction_publications_manifest_url" CHECK ("manifest_url" ~ '^https://')
);

CREATE TABLE "reconstruction_release_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "channel" varchar(30) NOT NULL,
  "active_release_id" uuid NOT NULL,
  "active_release_digest" varchar(64) NOT NULL,
  "active_publication_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_channels_venue_kind_channel_unique" UNIQUE("venue_slug", "release_kind", "channel"),
  CONSTRAINT "reconstruction_channels_id_scope_unique" UNIQUE("id", "venue_slug", "release_kind", "channel"),
  CONSTRAINT "reconstruction_channels_active_release_fk" FOREIGN KEY("active_release_id", "venue_slug", "release_kind", "active_release_digest")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channels_active_publication_fk" FOREIGN KEY("active_publication_id", "active_release_id", "venue_slug", "release_kind", "active_release_digest")
    REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channels_active_digest_shape" CHECK ("active_release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_channels_channel" CHECK ("channel" = 'production'),
  CONSTRAINT "reconstruction_channels_revision" CHECK ("revision" > 0)
);

CREATE TABLE "reconstruction_release_channel_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL,
  "venue_slug" varchar(100) NOT NULL,
  "release_kind" varchar(40) NOT NULL,
  "channel" varchar(30) NOT NULL,
  "action" varchar(20) NOT NULL,
  "from_release_id" uuid,
  "from_release_digest" varchar(64),
  "from_publication_id" uuid,
  "to_release_id" uuid NOT NULL,
  "to_release_digest" varchar(64) NOT NULL,
  "to_publication_id" uuid NOT NULL,
  "expected_revision" integer NOT NULL,
  "resulting_revision" integer NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconstruction_channel_events_channel_fk" FOREIGN KEY("channel_id", "venue_slug", "release_kind", "channel")
    REFERENCES "reconstruction_release_channels"("id", "venue_slug", "release_kind", "channel") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channel_events_from_release_fk" FOREIGN KEY("from_release_id", "venue_slug", "release_kind", "from_release_digest")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channel_events_to_release_fk" FOREIGN KEY("to_release_id", "venue_slug", "release_kind", "to_release_digest")
    REFERENCES "reconstruction_releases"("id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channel_events_from_publication_fk" FOREIGN KEY("from_publication_id", "from_release_id", "venue_slug", "release_kind", "from_release_digest")
    REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channel_events_to_publication_fk" FOREIGN KEY("to_publication_id", "to_release_id", "venue_slug", "release_kind", "to_release_digest")
    REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest") ON DELETE RESTRICT,
  CONSTRAINT "reconstruction_channel_events_idempotency_unique" UNIQUE("channel_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "reconstruction_channel_events_revision_unique" UNIQUE("channel_id", "resulting_revision"),
  CONSTRAINT "reconstruction_channel_events_action" CHECK ("action" IN ('promote', 'rollback')),
  CONSTRAINT "reconstruction_channel_events_expected_revision" CHECK ("expected_revision" >= 0),
  CONSTRAINT "reconstruction_channel_events_resulting_revision" CHECK ("resulting_revision" = "expected_revision" + 1),
  CONSTRAINT "reconstruction_channel_events_request_digest_shape" CHECK ("request_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_channel_events_from_digest_shape" CHECK ("from_release_digest" IS NULL OR "from_release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_channel_events_to_digest_shape" CHECK ("to_release_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "reconstruction_channel_events_from_identity" CHECK (("from_release_id" IS NULL) = ("from_release_digest" IS NULL) AND ("from_release_id" IS NULL) = ("from_publication_id" IS NULL)),
  CONSTRAINT "reconstruction_channel_events_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 10 AND 2000)
);

CREATE INDEX "reconstruction_releases_venue_created_idx"
  ON "reconstruction_releases" ("venue_slug", "created_at" DESC);
CREATE INDEX "reconstruction_qa_release_created_idx"
  ON "reconstruction_release_qa_runs" ("release_id", "created_at" DESC);
CREATE INDEX "reconstruction_reviews_release_reviewed_idx"
  ON "reconstruction_release_reviews" ("release_id", "reviewed_at" DESC);
CREATE INDEX "reconstruction_review_evidence_venue_kind_registered_idx"
  ON "reconstruction_review_evidence_artifacts" ("venue_slug", "artifact_kind", "registered_at" DESC);
CREATE INDEX "reconstruction_review_evidence_object_digest_idx"
  ON "reconstruction_review_evidence_artifacts" ("object_sha256");
CREATE INDEX "reconstruction_attestations_release_verified_idx"
  ON "reconstruction_release_attestations" ("release_id", "verified_at" DESC);
CREATE INDEX "reconstruction_publications_release_published_idx"
  ON "reconstruction_release_publications" ("release_id", "published_at" DESC);
CREATE INDEX "reconstruction_publications_prefix_idx"
  ON "reconstruction_release_publications" ("release_bucket", "release_prefix");
CREATE INDEX "reconstruction_channel_events_channel_created_idx"
  ON "reconstruction_release_channel_events" ("channel_id", "created_at" DESC);

CREATE FUNCTION "deny_reconstruction_foundry_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "reconstruction_releases_no_update"
  BEFORE UPDATE ON "reconstruction_releases"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_releases_no_delete"
  BEFORE DELETE ON "reconstruction_releases"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_releases_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_releases"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_qa_no_update"
  BEFORE UPDATE ON "reconstruction_release_qa_runs"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_qa_no_delete"
  BEFORE DELETE ON "reconstruction_release_qa_runs"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_qa_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_release_qa_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_reviews_no_update"
  BEFORE UPDATE ON "reconstruction_release_reviews"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_reviews_no_delete"
  BEFORE DELETE ON "reconstruction_release_reviews"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_reviews_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_release_reviews"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_review_evidence_no_update"
  BEFORE UPDATE ON "reconstruction_review_evidence_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_review_evidence_no_delete"
  BEFORE DELETE ON "reconstruction_review_evidence_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_review_evidence_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_review_evidence_artifacts"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_attestations_no_update"
  BEFORE UPDATE ON "reconstruction_release_attestations"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_attestations_no_delete"
  BEFORE DELETE ON "reconstruction_release_attestations"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_attestations_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_release_attestations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_publications_no_update"
  BEFORE UPDATE ON "reconstruction_release_publications"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_publications_no_delete"
  BEFORE DELETE ON "reconstruction_release_publications"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_publications_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_release_publications"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_channel_events_no_update"
  BEFORE UPDATE ON "reconstruction_release_channel_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_channel_events_no_delete"
  BEFORE DELETE ON "reconstruction_release_channel_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();
CREATE TRIGGER "reconstruction_channel_events_no_truncate"
  BEFORE TRUNCATE ON "reconstruction_release_channel_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_reconstruction_foundry_mutation"();

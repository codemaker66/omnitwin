-- Purpose-scoped historical-runtime execution authority. This migration does
-- not backfill or reclassify any 0063 evidence. Legacy v1 available bindings
-- remain forensic-only in application code; only a new v2 binding can execute.

CREATE TABLE "runtime_execution_key_policies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "purpose" varchar(80) NOT NULL,
  "algorithm" varchar(20) NOT NULL,
  "key_id" varchar(160) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "policy_digest" varchar(64) NOT NULL,
  "policy_body" jsonb NOT NULL,
  "registered_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "registered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "effective_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_execution_key_policies_shape" CHECK ((
    "purpose" = 'historical_runtime_execution_activation'
    AND "algorithm" = 'ed25519'
    AND "public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "policy_digest" ~ '^[a-f0-9]{64}$'
    AND "registered_at" <= "effective_at"
    AND "effective_at" < "expires_at"
    AND jsonb_typeof("policy_body") = 'object'
    AND "policy_body"->>'schemaVersion' = 'historical-runtime-execution-key-policy.v1'
    AND "policy_body"->>'policyId' = "id"::text
    AND "policy_body"->>'purpose' = "purpose"
    AND "policy_body"->>'algorithm' = "algorithm"
    AND "policy_body"->>'keyId' = "key_id"
    AND "policy_body"->>'publicKeyFingerprint' = "public_key_fingerprint"
    AND "policy_body"->>'policyDigest' = "policy_digest"
    AND "policy_body"->>'registeredBy' = "registered_by"::text
    AND ("policy_body"->>'registeredAt')::timestamp with time zone = "registered_at"
    AND ("policy_body"->>'effectiveAt')::timestamp with time zone = "effective_at"
    AND ("policy_body"->>'expiresAt')::timestamp with time zone = "expires_at"
  ) IS TRUE),
  CONSTRAINT "runtime_execution_key_policies_exact_unique" UNIQUE (
    "id", "policy_digest", "key_id", "public_key_fingerprint"
  )
);
CREATE INDEX "runtime_execution_key_policies_current_idx"
  ON "runtime_execution_key_policies" ("key_id", "effective_at", "expires_at");

CREATE TABLE "runtime_execution_key_policy_revocations" (
  "policy_id" uuid PRIMARY KEY NOT NULL
    REFERENCES "runtime_execution_key_policies"("id") ON DELETE RESTRICT,
  "revocation_digest" varchar(64) NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "reason" varchar(240) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_execution_key_policy_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 240
    AND jsonb_typeof("revocation_body") = 'object'
    AND "revocation_body"->>'policyId' = "policy_id"::text
    AND "revocation_body"->>'revocationDigest' = "revocation_digest"
    AND "revocation_body"->>'reason' = "reason"
    AND "revocation_body"->>'revokedBy' = "revoked_by"::text
    AND ("revocation_body"->>'revokedAt')::timestamp with time zone = "revoked_at"
  ) IS TRUE)
);

CREATE TABLE "runtime_execution_activation_drafts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE RESTRICT,
  "phase_id" uuid NOT NULL REFERENCES "event_phases"("id") ON DELETE RESTRICT,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE RESTRICT,
  "canonical_snapshot_id" uuid NOT NULL REFERENCES "canonical_layout_snapshots"("id") ON DELETE RESTRICT,
  "snapshot_hash" varchar(64) NOT NULL,
  "proof_digest" varchar(64) NOT NULL,
  "tenant_venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
  "venue_slug" varchar(100) NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE RESTRICT,
  "space_slug" varchar(100) NOT NULL,
  "presentation_admission_id" uuid NOT NULL
    REFERENCES "runtime_presentation_admissions"("id") ON DELETE RESTRICT,
  "presentation_admission_digest" varchar(64) NOT NULL,
  "runtime_package_id" uuid NOT NULL REFERENCES "runtime_packages"("id") ON DELETE RESTRICT,
  "runtime_package_content_digest" varchar(64) NOT NULL,
  "runtime_manifest_digest" varchar(64) NOT NULL,
  "composition_digest" varchar(64) NOT NULL,
  "member_count" integer NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(160) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "nonce" uuid NOT NULL,
  "predicate_digest" varchar(64) NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "statement" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_execution_activation_drafts_key_policy_fk"
    FOREIGN KEY ("key_policy_id", "key_policy_digest", "key_id", "public_key_fingerprint")
    REFERENCES "runtime_execution_key_policies" (
      "id", "policy_digest", "key_id", "public_key_fingerprint"
    ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_execution_activation_drafts_shape" CHECK ((
    "tenant_venue_id" = "venue_id"
    AND "venue_slug" = 'trades-hall'
    AND "space_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND "snapshot_hash" ~ '^[a-f0-9]{64}$'
    AND "proof_digest" ~ '^[a-f0-9]{64}$'
    AND "presentation_admission_digest" ~ '^[a-f0-9]{64}$'
    AND "runtime_package_content_digest" ~ '^[a-f0-9]{64}$'
    AND "runtime_manifest_digest" ~ '^[a-f0-9]{64}$'
    AND "composition_digest" ~ '^[a-f0-9]{64}$'
    AND "key_policy_digest" ~ '^[a-f0-9]{64}$'
    AND "public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "predicate_digest" ~ '^[a-f0-9]{64}$'
    AND "payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "member_count" BETWEEN 1 AND 8
    AND "issued_at" < "expires_at"
    AND "expires_at" <= "issued_at" + interval '90 days'
    AND "created_at" = "issued_at"
    AND jsonb_typeof("statement") = 'object'
    AND "statement"->>'_type' = 'https://in-toto.io/Statement/v1'
    AND "statement"->>'predicateType' = 'https://venviewer.com/attestations/historical-runtime-execution-activation/v1'
    AND "statement"->'predicate'->>'schemaVersion' = 'historical-runtime-execution-activation.v1'
    AND "statement"->'predicate'->>'activationId' = "id"::text
    AND "statement"->'predicate'->>'eventId' = "event_id"::text
    AND "statement"->'predicate'->>'phaseId' = "phase_id"::text
    AND "statement"->'predicate'->>'configurationId' = "configuration_id"::text
    AND "statement"->'predicate'->>'canonicalSnapshotId' = "canonical_snapshot_id"::text
    AND "statement"->'predicate'->>'snapshotHash' = "snapshot_hash"
    AND "statement"->'predicate'->>'proofDigest' = "proof_digest"
    AND "statement"->'predicate'->>'tenantBoundary' = 'venue_id_v1'
    AND "statement"->'predicate'->>'tenantId' = "tenant_venue_id"::text
    AND "statement"->'predicate'->>'venueId' = "venue_id"::text
    AND "statement"->'predicate'->>'venueSlug' = "venue_slug"
    AND "statement"->'predicate'->>'spaceId' = "space_id"::text
    AND "statement"->'predicate'->>'spaceSlug' = "space_slug"
    AND "statement"->'predicate'->>'presentationAdmissionId' = "presentation_admission_id"::text
    AND "statement"->'predicate'->>'presentationAdmissionDigest' = "presentation_admission_digest"
    AND "statement"->'predicate'->>'runtimePackageId' = "runtime_package_id"::text
    AND "statement"->'predicate'->>'runtimePackageContentDigest' = "runtime_package_content_digest"
    AND "statement"->'predicate'->>'runtimeManifestDigest' = "runtime_manifest_digest"
    AND "statement"->'predicate'->>'compositionDigest' = "composition_digest"
    AND ("statement"->'predicate'->>'memberCount')::integer = "member_count"
    AND "statement"->'predicate'->>'keyPolicyId' = "key_policy_id"::text
    AND "statement"->'predicate'->>'keyPolicyDigest' = "key_policy_digest"
    AND "statement"->'predicate'->>'keyId' = "key_id"
    AND "statement"->'predicate'->>'publicKeyFingerprint' = "public_key_fingerprint"
    AND "statement"->'predicate'->>'requestedBy' = "requested_by"::text
    AND ("statement"->'predicate'->>'issuedAt')::timestamp with time zone = "issued_at"
    AND ("statement"->'predicate'->>'expiresAt')::timestamp with time zone = "expires_at"
    AND "statement"->'predicate'->>'nonce' = "nonce"::text
  ) IS TRUE),
  CONSTRAINT "runtime_execution_activation_drafts_nonce_unique" UNIQUE ("nonce"),
  CONSTRAINT "runtime_execution_activation_drafts_exact_unique" UNIQUE (
    "id", "predicate_digest", "payload_sha256", "expires_at", "key_policy_id",
    "key_policy_digest", "key_id", "public_key_fingerprint"
  )
);
CREATE INDEX "runtime_execution_activation_drafts_target_idx"
  ON "runtime_execution_activation_drafts" (
    "event_id", "phase_id", "configuration_id", "canonical_snapshot_id"
  );

CREATE TABLE "runtime_execution_activation_draft_members" (
  "activation_id" uuid NOT NULL
    REFERENCES "runtime_execution_activation_drafts"("id") ON DELETE RESTRICT,
  "member_index" integer NOT NULL,
  "admission_id" uuid NOT NULL,
  "asset_version_id" uuid NOT NULL REFERENCES "asset_versions"("id") ON DELETE RESTRICT,
  "file_name" text NOT NULL,
  "file_ext" varchar(16) NOT NULL,
  "mime_type" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "rights_evidence_row_id" uuid NOT NULL,
  "rights_evidence_digest" varchar(64) NOT NULL,
  "rights_reviewed_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "rights_reviewed_at" timestamp with time zone NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "storage_version" varchar(200) NOT NULL,
  "storage_etag" varchar(200) NOT NULL,
  "object_receipt_digest" varchar(64) NOT NULL,
  "receipt_body" jsonb NOT NULL,
  CONSTRAINT "runtime_execution_activation_draft_members_pkey"
    PRIMARY KEY ("activation_id", "member_index"),
  CONSTRAINT "runtime_execution_activation_draft_members_admission_member_fk"
    FOREIGN KEY ("admission_id", "member_index")
    REFERENCES "runtime_presentation_admission_members" ("admission_id", "member_index")
    ON DELETE RESTRICT,
  CONSTRAINT "runtime_execution_activation_draft_members_shape" CHECK ((
    "member_index" BETWEEN 0 AND 7
    AND "file_ext" IN ('.sog', '.spz')
    AND right("file_name", length("file_ext")) = "file_ext"
    AND "sha256" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" BETWEEN 1 AND 16777216
    AND "rights_evidence_digest" ~ '^[a-f0-9]{64}$'
    AND "storage_key_sha256" ~ '^[a-f0-9]{64}$'
    AND "private_bucket_sha256" ~ '^[a-f0-9]{64}$'
    AND length("storage_version") BETWEEN 1 AND 200
    AND length("storage_etag") BETWEEN 1 AND 200
    AND "object_receipt_digest" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("receipt_body") = 'object'
    AND "receipt_body"->>'admissionId' = "admission_id"::text
    AND ("receipt_body"->>'memberIndex')::integer = "member_index"
    AND "receipt_body"->>'assetVersionId' = "asset_version_id"::text
    AND "receipt_body"->>'fileName' = "file_name"
    AND "receipt_body"->>'fileExt' = "file_ext"
    AND "receipt_body"->>'mimeType' = "mime_type"
    AND "receipt_body"->>'sha256' = "sha256"
    AND ("receipt_body"->>'sizeBytes')::bigint = "size_bytes"
    AND "receipt_body"->>'rightsEvidenceRowId' = "rights_evidence_row_id"::text
    AND "receipt_body"->>'rightsEvidenceDigest' = "rights_evidence_digest"
    AND "receipt_body"->>'rightsReviewedBy' = "rights_reviewed_by"::text
    AND ("receipt_body"->>'rightsReviewedAt')::timestamp with time zone = "rights_reviewed_at"
    AND "receipt_body"->>'storageKeySha256' = "storage_key_sha256"
    AND "receipt_body"->>'privateBucketSha256' = "private_bucket_sha256"
    AND "receipt_body"->>'storageVersion' = "storage_version"
    AND "receipt_body"->>'storageEtag' = "storage_etag"
    AND "receipt_body"->>'objectReceiptDigest' = "object_receipt_digest"
  ) IS TRUE),
  CONSTRAINT "runtime_execution_activation_draft_members_exact_unique" UNIQUE (
    "activation_id", "member_index", "admission_id", "asset_version_id",
    "sha256", "size_bytes", "storage_key_sha256", "private_bucket_sha256",
    "storage_version", "storage_etag", "object_receipt_digest"
  )
);

CREATE TABLE "runtime_execution_activations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "predicate_digest" varchar(64) NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "envelope_sha256" varchar(64) NOT NULL,
  "envelope" jsonb NOT NULL,
  "key_policy_id" uuid NOT NULL,
  "key_policy_digest" varchar(64) NOT NULL,
  "key_id" varchar(160) NOT NULL,
  "public_key_fingerprint" varchar(64) NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "submitted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_execution_activations_draft_fk" FOREIGN KEY (
    "id", "predicate_digest", "payload_sha256", "expires_at", "key_policy_id",
    "key_policy_digest", "key_id", "public_key_fingerprint"
  ) REFERENCES "runtime_execution_activation_drafts" (
    "id", "predicate_digest", "payload_sha256", "expires_at", "key_policy_id",
    "key_policy_digest", "key_id", "public_key_fingerprint"
  ) ON DELETE RESTRICT,
  CONSTRAINT "runtime_execution_activations_shape" CHECK ((
    "predicate_digest" ~ '^[a-f0-9]{64}$'
    AND "payload_sha256" ~ '^[a-f0-9]{64}$'
    AND "envelope_sha256" ~ '^[a-f0-9]{64}$'
    AND "key_policy_digest" ~ '^[a-f0-9]{64}$'
    AND "public_key_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "requested_by" = "submitted_by"
    AND "issued_at" <= "verified_at"
    AND "verified_at" < "expires_at"
    AND jsonb_typeof("envelope") = 'object'
    AND "envelope"->>'payloadType' = 'application/vnd.in-toto+json'
  ) IS TRUE),
  CONSTRAINT "runtime_execution_activations_exact_unique" UNIQUE (
    "id", "predicate_digest", "payload_sha256", "envelope_sha256", "expires_at",
    "key_policy_id", "key_policy_digest", "key_id", "public_key_fingerprint"
  )
);
CREATE INDEX "runtime_execution_activations_current_idx"
  ON "runtime_execution_activations" ("expires_at", "id");

CREATE TABLE "runtime_execution_activation_members" (
  "activation_id" uuid NOT NULL
    REFERENCES "runtime_execution_activations"("id") ON DELETE RESTRICT,
  "member_index" integer NOT NULL,
  "admission_id" uuid NOT NULL,
  "asset_version_id" uuid NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "storage_key_sha256" varchar(64) NOT NULL,
  "private_bucket_sha256" varchar(64) NOT NULL,
  "storage_version" varchar(200) NOT NULL,
  "storage_etag" varchar(200) NOT NULL,
  "object_receipt_digest" varchar(64) NOT NULL,
  CONSTRAINT "runtime_execution_activation_members_pkey"
    PRIMARY KEY ("activation_id", "member_index"),
  CONSTRAINT "runtime_execution_activation_members_draft_member_fk" FOREIGN KEY (
    "activation_id", "member_index", "admission_id", "asset_version_id", "sha256",
    "size_bytes", "storage_key_sha256", "private_bucket_sha256", "storage_version",
    "storage_etag", "object_receipt_digest"
  ) REFERENCES "runtime_execution_activation_draft_members" (
    "activation_id", "member_index", "admission_id", "asset_version_id", "sha256",
    "size_bytes", "storage_key_sha256", "private_bucket_sha256", "storage_version",
    "storage_etag", "object_receipt_digest"
  ) ON DELETE RESTRICT
);

CREATE TABLE "runtime_execution_activation_revocations" (
  "activation_id" uuid PRIMARY KEY NOT NULL
    REFERENCES "runtime_execution_activations"("id") ON DELETE RESTRICT,
  "revocation_digest" varchar(64) NOT NULL,
  "revocation_body" jsonb NOT NULL,
  "reason" varchar(240) NOT NULL,
  "revoked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "revoked_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_execution_activation_revocations_shape" CHECK ((
    "revocation_digest" ~ '^[a-f0-9]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 240
    AND jsonb_typeof("revocation_body") = 'object'
    AND "revocation_body"->>'activationId' = "activation_id"::text
    AND "revocation_body"->>'revocationDigest' = "revocation_digest"
    AND "revocation_body"->>'reason' = "reason"
    AND "revocation_body"->>'revokedBy' = "revoked_by"::text
    AND ("revocation_body"->>'revokedAt')::timestamp with time zone = "revoked_at"
  ) IS TRUE)
);

ALTER TABLE "phase_layout_snapshots"
  ADD COLUMN "runtime_execution_activation_id" uuid,
  ADD COLUMN "runtime_execution_activation_predicate_digest" varchar(64),
  ADD COLUMN "runtime_execution_activation_payload_sha256" varchar(64),
  ADD COLUMN "runtime_execution_activation_envelope_sha256" varchar(64),
  ADD COLUMN "runtime_execution_activation_expires_at" timestamp with time zone,
  ADD COLUMN "runtime_execution_key_policy_id" uuid,
  ADD COLUMN "runtime_execution_key_policy_digest" varchar(64),
  ADD COLUMN "runtime_execution_key_id" varchar(160),
  ADD COLUMN "runtime_execution_public_key_fingerprint" varchar(64),
  ADD CONSTRAINT "phase_layout_snapshots_runtime_execution_activation_fk" FOREIGN KEY (
    "runtime_execution_activation_id", "runtime_execution_activation_predicate_digest",
    "runtime_execution_activation_payload_sha256", "runtime_execution_activation_envelope_sha256",
    "runtime_execution_activation_expires_at", "runtime_execution_key_policy_id",
    "runtime_execution_key_policy_digest", "runtime_execution_key_id",
    "runtime_execution_public_key_fingerprint"
  ) REFERENCES "runtime_execution_activations" (
    "id", "predicate_digest", "payload_sha256", "envelope_sha256", "expires_at",
    "key_policy_id", "key_policy_digest", "key_id", "public_key_fingerprint"
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT "phase_layout_snapshots_runtime_execution_coherence" CHECK ((
    (
      "runtime_binding_state" = 'available'
      AND "runtime_binding"->>'schemaVersion' = 'phase-layout-runtime-binding.v2'
      AND "runtime_execution_activation_id" IS NOT NULL
      AND "runtime_execution_activation_predicate_digest" IS NOT NULL
      AND "runtime_execution_activation_payload_sha256" IS NOT NULL
      AND "runtime_execution_activation_envelope_sha256" IS NOT NULL
      AND "runtime_execution_activation_expires_at" IS NOT NULL
      AND "runtime_execution_key_policy_id" IS NOT NULL
      AND "runtime_execution_key_policy_digest" IS NOT NULL
      AND "runtime_execution_key_id" IS NOT NULL
      AND "runtime_execution_public_key_fingerprint" IS NOT NULL
    ) OR (
      ("runtime_binding_state" <> 'available'
        OR "runtime_binding"->>'schemaVersion' <> 'phase-layout-runtime-binding.v2')
      AND "runtime_execution_activation_id" IS NULL
      AND "runtime_execution_activation_predicate_digest" IS NULL
      AND "runtime_execution_activation_payload_sha256" IS NULL
      AND "runtime_execution_activation_envelope_sha256" IS NULL
      AND "runtime_execution_activation_expires_at" IS NULL
      AND "runtime_execution_key_policy_id" IS NULL
      AND "runtime_execution_key_policy_digest" IS NULL
      AND "runtime_execution_key_id" IS NULL
      AND "runtime_execution_public_key_fingerprint" IS NULL
    )
  ) IS TRUE);

CREATE UNIQUE INDEX "phase_layout_snapshots_runtime_execution_activation_unique"
  ON "phase_layout_snapshots" ("runtime_execution_activation_id")
  WHERE "runtime_execution_activation_id" IS NOT NULL;

-- Event identity is checked in the transaction guard because PostgreSQL CHECK
-- constraints cannot contain subqueries.
ALTER TABLE "phase_layout_snapshots"
  DROP CONSTRAINT "phase_layout_snapshots_runtime_binding_json_identity";
ALTER TABLE "phase_layout_snapshots"
  ADD CONSTRAINT "phase_layout_snapshots_runtime_binding_json_identity" CHECK ((
    "runtime_binding_state" = 'legacy_unbound'
    OR (
      "runtime_binding"->>'bindingId' = "id"::text
      AND "runtime_binding"->>'phaseLayoutSnapshotId' = "id"::text
      AND "runtime_binding"->>'canonicalSnapshotId' = "canonical_snapshot_id"::text
      AND "runtime_binding"->>'snapshotHash' = "snapshot_hash"
      AND "runtime_binding"->>'venueId' = "payload"->>'venueId'
      AND "runtime_binding"->>'spaceId' = "payload"->>'spaceId'
      AND "runtime_binding"->>'venueSlug' = "payload"->'venueRuntime'->>'venueSlug'
      AND "runtime_binding"->>'spaceSlug' = "payload"->'venueRuntime'->>'spaceSlug'
      AND "runtime_binding"->>'boundBy' = "frozen_by"::text
      AND ("runtime_binding"->>'boundAt')::timestamp with time zone = "frozen_at"
      AND "runtime_binding"->>'availability' = "runtime_binding_state"
      AND "runtime_binding"->>'bindingDigest' = "runtime_binding_digest"
      AND (
        (
          "runtime_binding"->>'schemaVersion' = 'phase-layout-runtime-binding.v1'
          AND "runtime_binding"->>'admissionPolicy' = 'trades-hall-reviewed-presentation.v1'
        ) OR (
          "runtime_binding_state" = 'available'
          AND "runtime_binding"->>'schemaVersion' = 'phase-layout-runtime-binding.v2'
          AND "runtime_binding"->>'admissionPolicy' = 'trades-hall-authenticated-execution-activation.v1'
          AND "runtime_binding"->>'tenantBoundary' = 'venue_id_v1'
          AND "runtime_binding"->>'tenantId' = "payload"->>'venueId'
          AND "runtime_binding"->>'phaseId' = "event_phase_id"::text
          AND "runtime_binding"->>'configurationId' = "configuration_id"::text
          AND "runtime_binding"->>'proofDigest' = "proof_digest"
          AND "runtime_binding"->>'presentationAdmissionId' = "runtime_presentation_admission_id"::text
          AND "runtime_binding"->>'presentationAdmissionDigest' = "runtime_presentation_admission_digest"
          AND "runtime_binding"->>'activationId' = "runtime_execution_activation_id"::text
          AND "runtime_binding"->>'activationPredicateDigest' = "runtime_execution_activation_predicate_digest"
          AND "runtime_binding"->>'activationPayloadSha256' = "runtime_execution_activation_payload_sha256"
          AND "runtime_binding"->>'activationEnvelopeSha256' = "runtime_execution_activation_envelope_sha256"
          AND ("runtime_binding"->>'activationExpiresAt')::timestamp with time zone = "runtime_execution_activation_expires_at"
          AND "runtime_binding"->>'activationKeyPolicyId' = "runtime_execution_key_policy_id"::text
          AND "runtime_binding"->>'activationKeyPolicyDigest' = "runtime_execution_key_policy_digest"
          AND "runtime_binding"->>'activationKeyId' = "runtime_execution_key_id"
          AND "runtime_binding"->>'activationPublicKeyFingerprint' = "runtime_execution_public_key_fingerprint"
        )
      )
    )
  ) IS TRUE);

CREATE OR REPLACE FUNCTION "runtime_execution_evidence_append_only_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000', CONSTRAINT = TG_TABLE_NAME || '_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION "runtime_execution_activation_members_complete_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_count integer;
  actual_count integer;
  distinct_count integer;
  minimum_index integer;
  maximum_index integer;
  total_bytes bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-execution-activation:' || NEW."id"::text, 0));
  SELECT draft."member_count" INTO expected_count
  FROM "runtime_execution_activation_drafts" draft
  JOIN "runtime_execution_key_policies" policy ON policy."id" = draft."key_policy_id"
  LEFT JOIN "runtime_execution_key_policy_revocations" revoked
    ON revoked."policy_id" = policy."id"
  WHERE draft."id" = NEW."id"
    AND draft."requested_by" = NEW."requested_by"
    AND NEW."submitted_by" = NEW."requested_by"
    AND draft."issued_at" = NEW."issued_at"
    AND policy."effective_at" <= draft."issued_at"
    AND NEW."verified_at" < least(draft."expires_at", policy."expires_at")
    AND revoked."policy_id" IS NULL;
  SELECT count(*), count(DISTINCT "member_index"), min("member_index"),
    max("member_index"), coalesce(sum("size_bytes"), 0)
  INTO actual_count, distinct_count, minimum_index, maximum_index, total_bytes
  FROM "runtime_execution_activation_draft_members"
  WHERE "activation_id" = NEW."id";
  IF expected_count IS NULL OR actual_count <> expected_count
     OR distinct_count <> expected_count OR minimum_index <> 0
     OR maximum_index <> expected_count - 1 OR total_bytes > 100663296 THEN
    RAISE EXCEPTION 'runtime execution activation members are incomplete'
      USING ERRCODE = '23514', CONSTRAINT = 'runtime_execution_activation_members_complete';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "runtime_execution_activation_members_complete_guard"
  BEFORE INSERT ON "runtime_execution_activations"
  FOR EACH ROW EXECUTE FUNCTION "runtime_execution_activation_members_complete_guard"();

CREATE OR REPLACE FUNCTION "runtime_execution_activation_member_insert_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-execution-activation:' || NEW."activation_id"::text, 0));
  IF TG_TABLE_NAME = 'runtime_execution_activation_draft_members'
     AND EXISTS (SELECT 1 FROM "runtime_execution_activations" WHERE "id" = NEW."activation_id") THEN
    RAISE EXCEPTION 'signed activation member set is sealed'
      USING ERRCODE = '55000', CONSTRAINT = 'runtime_execution_activation_draft_members_sealed';
  END IF;
  IF TG_TABLE_NAME = 'runtime_execution_activation_members'
     AND EXISTS (
       SELECT 1 FROM "phase_layout_snapshots"
       WHERE "runtime_execution_activation_id" = NEW."activation_id"
     ) THEN
    RAISE EXCEPTION 'frozen activation member set is sealed'
      USING ERRCODE = '55000', CONSTRAINT = 'runtime_execution_activation_members_sealed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "runtime_execution_activation_draft_member_insert_guard"
  BEFORE INSERT ON "runtime_execution_activation_draft_members"
  FOR EACH ROW EXECUTE FUNCTION "runtime_execution_activation_member_insert_guard"();
CREATE TRIGGER "runtime_execution_activation_member_insert_guard"
  BEFORE INSERT ON "runtime_execution_activation_members"
  FOR EACH ROW EXECUTE FUNCTION "runtime_execution_activation_member_insert_guard"();

CREATE OR REPLACE FUNCTION "runtime_execution_activation_snapshot_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_count integer;
  actual_count integer;
  minimum_index integer;
  maximum_index integer;
BEGIN
  IF NEW."runtime_binding_state" <> 'available'
     OR NEW."runtime_binding"->>'schemaVersion' <> 'phase-layout-runtime-binding.v2' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'runtime-execution-activation:' || NEW."runtime_execution_activation_id"::text, 0
  ));
  SELECT draft."member_count" INTO expected_count
  FROM "runtime_execution_activations" activation
  JOIN "runtime_execution_activation_drafts" draft ON draft."id" = activation."id"
  JOIN "runtime_execution_key_policies" policy ON policy."id" = activation."key_policy_id"
  JOIN "event_phases" phase ON phase."id" = NEW."event_phase_id"
  LEFT JOIN "runtime_execution_activation_revocations" revoked_activation
    ON revoked_activation."activation_id" = activation."id"
  LEFT JOIN "runtime_execution_key_policy_revocations" revoked_policy
    ON revoked_policy."policy_id" = policy."id"
  WHERE activation."id" = NEW."runtime_execution_activation_id"
    AND draft."event_id" = phase."event_id"
    AND draft."phase_id" = NEW."event_phase_id"
    AND draft."configuration_id" = NEW."configuration_id"
    AND draft."canonical_snapshot_id" = NEW."canonical_snapshot_id"
    AND draft."snapshot_hash" = NEW."snapshot_hash"
    AND draft."proof_digest" = NEW."proof_digest"
    AND draft."venue_id"::text = NEW."payload"->>'venueId'
    AND draft."space_id"::text = NEW."payload"->>'spaceId'
    AND draft."presentation_admission_id" = NEW."runtime_presentation_admission_id"
    AND draft."presentation_admission_digest" = NEW."runtime_presentation_admission_digest"
    AND draft."runtime_package_id" = NEW."runtime_package_id"
    AND draft."runtime_package_content_digest" = NEW."runtime_package_content_digest"
    AND draft."runtime_manifest_digest" = NEW."runtime_manifest_digest"
    AND activation."verified_at" <= NEW."frozen_at"
    AND NEW."frozen_at" < activation."expires_at"
    AND NEW."frozen_at" < policy."expires_at"
    AND revoked_activation."activation_id" IS NULL
    AND revoked_policy."policy_id" IS NULL;
  SELECT count(*), min("member_index"), max("member_index")
    INTO actual_count, minimum_index, maximum_index
  FROM "runtime_execution_activation_members"
  WHERE "activation_id" = NEW."runtime_execution_activation_id";
  IF expected_count IS NULL OR actual_count <> expected_count
     OR minimum_index <> 0 OR maximum_index <> expected_count - 1 THEN
    RAISE EXCEPTION 'runtime execution activation is not current and complete'
      USING ERRCODE = '23514', CONSTRAINT = 'runtime_execution_activation_snapshot_guard';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "runtime_execution_activation_snapshot_guard"
  BEFORE INSERT ON "phase_layout_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "runtime_execution_activation_snapshot_guard"();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'runtime_execution_key_policies',
    'runtime_execution_key_policy_revocations',
    'runtime_execution_activation_drafts',
    'runtime_execution_activation_draft_members',
    'runtime_execution_activations',
    'runtime_execution_activation_members',
    'runtime_execution_activation_revocations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION runtime_execution_evidence_append_only_guard()',
      table_name || '_append_only', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION runtime_execution_evidence_append_only_guard()',
      table_name || '_no_truncate', table_name
    );
  END LOOP;
END;
$$;

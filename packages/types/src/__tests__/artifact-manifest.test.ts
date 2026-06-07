import { describe, expect, it } from "vitest";
import { ARTIFACT_TYPES } from "../artifact-type.js";
import {
  ARTIFACT_EXPOSURE_TIERS,
  ARTIFACT_EXPORT_SAFETY_STATES,
  ARTIFACT_FRESHNESS_STATES,
  ARTIFACT_MANIFEST_V0_SCHEMA_VERSION,
  ArtifactManifestV0Schema,
  type ArtifactManifestV0,
} from "../artifact-manifest.js";

const SHA256_A = "a".repeat(64);
const SHA256_B = "b".repeat(64);

const VALID_MANIFEST: ArtifactManifestV0 = {
  schemaVersion: ARTIFACT_MANIFEST_V0_SCHEMA_VERSION,
  artifactId: "artifact_runtime_package_grand_hall_v0",
  artifactType: "runtime_package",
  purpose: "Internal runtime package candidate for Grand Hall visual QA.",
  sourceInputs: [
    {
      refType: "capture_session",
      ref: "capture_session_grand_hall_2026_06_07",
      role: "primary_capture",
      contentHash: {
        algorithm: "sha256",
        value: SHA256_A,
      },
    },
  ],
  contentHash: {
    algorithm: "sha256",
    value: SHA256_B,
  },
  createdAt: "2026-06-07T12:00:00.000Z",
  createdBy: {
    creatorType: "pipeline",
    id: "xgrids-processing-runbook",
    displayName: "XGRIDS processing runbook",
  },
  exposureTier: "internal_only",
  freshnessState: "not_checked",
  associatedClaims: [],
  associatedEvidence: [
    {
      refType: "evidence",
      ref: "operator-log-2026-06-07",
      role: "processing_log",
    },
  ],
  runtimeCompatibility: {
    targetRuntimes: ["web_runtime", "spark_three"],
    minVersion: "0.0.0",
    fallbackAvailable: true,
    notes: "Procedural fallback remains available.",
  },
  exportSafety: "internal_only",
  knownLimitations: [
    "Captured-room output still requires human visual review before any customer-facing use.",
  ],
};

describe("ArtifactManifestV0", () => {
  it("pins v0 manifest vocabulary from VAR-001", () => {
    expect(ARTIFACT_EXPOSURE_TIERS).toEqual([
      "internal_only",
      "partner_preview",
      "authenticated_client",
      "investor_demo",
      "expert_review",
      "public_marketing",
      "published_case_study",
    ]);

    expect(ARTIFACT_FRESHNESS_STATES).toEqual([
      "current",
      "partial",
      "stale",
      "superseded",
      "expired",
      "not_checked",
      "degraded_evidence",
      "requires_human_review",
      "unsupported_request",
    ]);

    expect(ARTIFACT_EXPORT_SAFETY_STATES).toEqual([
      "internal_only",
      "safe_to_export",
      "safe_for_partner_preview",
      "safe_for_public_marketing",
      "requires_claim_review",
      "requires_expert_review",
      "blocked",
    ]);
  });

  it("parses a complete metadata-only manifest", () => {
    const parsed = ArtifactManifestV0Schema.parse(VALID_MANIFEST);
    expect(parsed).toEqual(VALID_MANIFEST);
  });

  it("accepts every registered artifact type as the manifest artifactType", () => {
    for (const artifactType of ARTIFACT_TYPES) {
      expect(ArtifactManifestV0Schema.safeParse({
        ...VALID_MANIFEST,
        artifactType,
      }).success).toBe(true);
    }
  });

  it("requires source inputs, compatibility, and limitations", () => {
    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      sourceInputs: [],
    }).success).toBe(false);

    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      runtimeCompatibility: {
        ...VALID_MANIFEST.runtimeCompatibility,
        targetRuntimes: [],
      },
    }).success).toBe(false);

    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      knownLimitations: [""],
    }).success).toBe(false);
  });

  it("pins sha256 hash shape and rejects non-canonical hashes", () => {
    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      contentHash: {
        algorithm: "sha256",
        value: SHA256_A.toUpperCase(),
      },
    }).success).toBe(false);

    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      contentHash: {
        algorithm: "sha1",
        value: SHA256_A,
      },
    }).success).toBe(false);
  });

  it("does not allow internal artifacts to be marked safe for public marketing", () => {
    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      exposureTier: "internal_only",
      exportSafety: "safe_for_public_marketing",
    }).success).toBe(false);
  });

  it("requires public-facing artifacts to declare public safety or claim review", () => {
    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      exposureTier: "public_marketing",
      exportSafety: "safe_for_partner_preview",
    }).success).toBe(false);

    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      exposureTier: "published_case_study",
      exportSafety: "requires_claim_review",
    }).success).toBe(true);
  });

  it("rejects unknown manifest fields rather than becoming an ungoverned blob", () => {
    expect(ArtifactManifestV0Schema.safeParse({
      ...VALID_MANIFEST,
      arbitraryJson: { unsafe: true },
    }).success).toBe(false);
  });
});

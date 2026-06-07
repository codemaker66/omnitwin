import { describe, expect, it } from "vitest";
import { ARTIFACT_TYPES, ArtifactTypeSchema } from "../artifact-type.js";

const DOCUMENTED_ARTIFACT_TYPES = [
  "runtime_package",
  "layout_evidence_pack",
  "scene_authority_map",
  "transform_artifact",
  "lighting_context_package",
  "photometric_capture_pack",
  "residual_radiance_asset",
  "venreplay_bundle",
  "policy_bundle",
  "witness_block",
  "proof_object",
  "truth_mode_report",
  "openusd_export",
  "khr_gltf_export",
  "c2pa_manifest",
  "dsse_attestation",
] as const;

describe("Artifact Registry type vocabulary", () => {
  it("pins the initial VAR-001 artifact families", () => {
    expect(ARTIFACT_TYPES).toEqual(DOCUMENTED_ARTIFACT_TYPES);

    for (const artifactType of ARTIFACT_TYPES) {
      expect(ArtifactTypeSchema.safeParse(artifactType).success).toBe(true);
    }
  });

  it("keeps artifact types unique lower-snake-case metadata values", () => {
    expect(new Set(ARTIFACT_TYPES).size).toBe(ARTIFACT_TYPES.length);

    for (const artifactType of ARTIFACT_TYPES) {
      expect(artifactType).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    }
  });

  it("does not mix artifact families with file formats, claim states, or services", () => {
    const nonArtifactValues = [
      "ply",
      "spz",
      "gltf",
      "current",
      "verified",
      "public_marketing",
      "asset_version",
      "runtime_status",
      "neon",
      "r2",
      "railway",
    ] as const;

    for (const value of nonArtifactValues) {
      expect(ArtifactTypeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("keeps export and attestation families explicit instead of generic blobs", () => {
    expect(ARTIFACT_TYPES).toContain("openusd_export");
    expect(ARTIFACT_TYPES).toContain("khr_gltf_export");
    expect(ARTIFACT_TYPES).toContain("c2pa_manifest");
    expect(ARTIFACT_TYPES).toContain("dsse_attestation");

    expect(ArtifactTypeSchema.safeParse("export").success).toBe(false);
    expect(ArtifactTypeSchema.safeParse("attestation").success).toBe(false);
  });
});

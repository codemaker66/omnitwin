import { z } from "zod";

export const ARTIFACT_TYPES = [
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

export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;


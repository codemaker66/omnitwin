import { z } from "zod";
import { ArtifactTypeSchema } from "./artifact-type.js";

export const ARTIFACT_MANIFEST_V0_SCHEMA_VERSION = "venviewer.artifact-manifest.v0";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const ARTIFACT_EXPOSURE_TIERS = [
  "internal_only",
  "partner_preview",
  "authenticated_client",
  "investor_demo",
  "expert_review",
  "public_marketing",
  "published_case_study",
] as const;
export const ArtifactExposureTierSchema = z.enum(ARTIFACT_EXPOSURE_TIERS);
export type ArtifactExposureTier = z.infer<typeof ArtifactExposureTierSchema>;

export const ARTIFACT_FRESHNESS_STATES = [
  "current",
  "partial",
  "stale",
  "superseded",
  "expired",
  "not_checked",
  "degraded_evidence",
  "requires_human_review",
  "unsupported_request",
] as const;
export const ArtifactFreshnessStateSchema = z.enum(ARTIFACT_FRESHNESS_STATES);
export type ArtifactFreshnessState = z.infer<typeof ArtifactFreshnessStateSchema>;

export const ARTIFACT_EXPORT_SAFETY_STATES = [
  "internal_only",
  "safe_to_export",
  "safe_for_partner_preview",
  "safe_for_public_marketing",
  "requires_claim_review",
  "requires_expert_review",
  "blocked",
] as const;
export const ArtifactExportSafetySchema = z.enum(ARTIFACT_EXPORT_SAFETY_STATES);
export type ArtifactExportSafety = z.infer<typeof ArtifactExportSafetySchema>;

export const ARTIFACT_CREATOR_TYPES = [
  "user",
  "service",
  "pipeline",
  "external_tool",
  "manual_review",
] as const;
export const ArtifactCreatorTypeSchema = z.enum(ARTIFACT_CREATOR_TYPES);
export type ArtifactCreatorType = z.infer<typeof ArtifactCreatorTypeSchema>;

export const ARTIFACT_REFERENCE_TYPES = [
  "artifact",
  "capture_session",
  "asset_version",
  "runtime_package",
  "layout_snapshot",
  "venue",
  "room",
  "configuration",
  "claim",
  "evidence",
  "policy",
  "tool",
  "external",
] as const;
export const ArtifactReferenceTypeSchema = z.enum(ARTIFACT_REFERENCE_TYPES);
export type ArtifactReferenceType = z.infer<typeof ArtifactReferenceTypeSchema>;

export const ArtifactContentHashSchema = z.object({
  algorithm: z.literal("sha256"),
  value: z.string().regex(SHA256_HEX, "sha256 hashes must be 64 lowercase hex characters."),
}).strict();
export type ArtifactContentHash = z.infer<typeof ArtifactContentHashSchema>;

export const ArtifactReferenceSchema = z.object({
  refType: ArtifactReferenceTypeSchema,
  ref: z.string().trim().min(1).max(512),
  role: z.string().trim().min(1).max(80).regex(SLUG_TOKEN).optional(),
  contentHash: ArtifactContentHashSchema.nullable().optional(),
}).strict();
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const ArtifactCreatorSchema = z.object({
  creatorType: ArtifactCreatorTypeSchema,
  id: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255).optional(),
}).strict();
export type ArtifactCreator = z.infer<typeof ArtifactCreatorSchema>;

export const ArtifactRuntimeCompatibilitySchema = z.object({
  targetRuntimes: z.array(z.string().trim().min(1).max(120).regex(SLUG_TOKEN)).min(1),
  minVersion: z.string().trim().min(1).max(80).optional(),
  requiresFeatureFlag: z.string().trim().min(1).max(120).regex(SLUG_TOKEN).optional(),
  fallbackAvailable: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
}).strict();
export type ArtifactRuntimeCompatibility = z.infer<typeof ArtifactRuntimeCompatibilitySchema>;

export const ArtifactManifestV0Schema = z.object({
  schemaVersion: z.literal(ARTIFACT_MANIFEST_V0_SCHEMA_VERSION),
  artifactId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  artifactType: ArtifactTypeSchema,
  purpose: z.string().trim().min(1).max(160),
  sourceInputs: z.array(ArtifactReferenceSchema).min(1),
  contentHash: ArtifactContentHashSchema.nullable(),
  createdAt: z.string().regex(ISO_DATE_TIME, "createdAt must be an ISO datetime."),
  createdBy: ArtifactCreatorSchema,
  exposureTier: ArtifactExposureTierSchema,
  freshnessState: ArtifactFreshnessStateSchema,
  associatedClaims: z.array(ArtifactReferenceSchema),
  associatedEvidence: z.array(ArtifactReferenceSchema),
  runtimeCompatibility: ArtifactRuntimeCompatibilitySchema,
  exportSafety: ArtifactExportSafetySchema,
  knownLimitations: z.array(z.string().trim().min(1).max(1000)),
}).strict().superRefine((manifest, ctx) => {
  if (
    (manifest.exposureTier === "public_marketing" || manifest.exposureTier === "published_case_study") &&
    (manifest.exportSafety === "internal_only" ||
      manifest.exportSafety === "safe_for_partner_preview" ||
      manifest.exportSafety === "requires_expert_review" ||
      manifest.exportSafety === "blocked")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exportSafety"],
      message: "Public-facing artifacts require public export safety or claim review.",
    });
  }

  if (manifest.exposureTier === "internal_only" && manifest.exportSafety === "safe_for_public_marketing") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exportSafety"],
      message: "Internal-only artifacts cannot be marked safe for public marketing.",
    });
  }
});
export type ArtifactManifestV0 = z.infer<typeof ArtifactManifestV0Schema>;


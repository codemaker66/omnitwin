import { z } from "zod";

export const TOOL_CAPABILITY_REGISTRY_SCHEMA_VERSION =
  "venviewer.tool-capability-registry.v0";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const TOOL_CAPABILITY_TOOL_IDS = [
  "spark",
  "jupedsim",
  "frosting",
  "milo",
  "rvo2",
  "spz",
  "playcanvas_splat_transform",
  "recast_detour",
  "vadere",
  "pathfinder",
  "massmotion",
  "anylogic",
] as const;
export const ToolCapabilityToolIdSchema = z.enum(TOOL_CAPABILITY_TOOL_IDS);
export type ToolCapabilityToolId = z.infer<typeof ToolCapabilityToolIdSchema>;

export const TOOL_CAPABILITY_STATUSES = [
  "verified",
  "plausible",
  "unverified",
  "false",
  "research_only",
] as const;
export const ToolCapabilityStatusSchema = z.enum(TOOL_CAPABILITY_STATUSES);
export type ToolCapabilityStatus = z.infer<typeof ToolCapabilityStatusSchema>;

export const TOOL_CAPABILITY_USAGE_MODES = [
  "browser_runtime",
  "server_runtime",
  "offline_cli",
  "worker_service",
  "diagnostic_tool",
  "research_experiment",
  "benchmark_only",
] as const;
export const ToolCapabilityUsageModeSchema = z.enum(TOOL_CAPABILITY_USAGE_MODES);
export type ToolCapabilityUsageMode = z.infer<typeof ToolCapabilityUsageModeSchema>;

export const TOOL_CAPABILITY_PURPOSES = [
  "splat_runtime_rendering",
  "splat_format_conversion",
  "splat_diagnostic_processing",
  "guest_flow_simulation",
  "route_or_navmesh_research",
  "residual_reconstruction_research",
  "professional_benchmark_comparison",
  "asset_compression",
] as const;
export const ToolCapabilityPurposeSchema = z.enum(TOOL_CAPABILITY_PURPOSES);
export type ToolCapabilityPurpose = z.infer<typeof ToolCapabilityPurposeSchema>;

export const TOOL_CAPABILITY_EVIDENCE_REF_TYPES = [
  "verification_fixture",
  "license_review",
  "installed_package",
  "source_repository",
  "test_report",
  "benchmark_report",
  "operator_note",
] as const;
export const ToolCapabilityEvidenceRefTypeSchema = z.enum(
  TOOL_CAPABILITY_EVIDENCE_REF_TYPES,
);
export type ToolCapabilityEvidenceRefType = z.infer<
  typeof ToolCapabilityEvidenceRefTypeSchema
>;

export const TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES = [
  "approved",
  "blocked",
  "research_only",
  "benchmark_only",
  "pending_review",
  "needs_commercial_license",
  "needs_isolation",
] as const;
export const ToolCapabilityLicenseReviewStatusSchema = z.enum(
  TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES,
);
export type ToolCapabilityLicenseReviewStatus = z.infer<
  typeof ToolCapabilityLicenseReviewStatusSchema
>;

export const ToolCapabilityEvidenceRefSchema = z.object({
  refType: ToolCapabilityEvidenceRefTypeSchema,
  ref: z.string().trim().min(1).max(512),
  contentHash: z.string().trim().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type ToolCapabilityEvidenceRef = z.infer<typeof ToolCapabilityEvidenceRefSchema>;

export const ToolCapabilityRecordSchema = z.object({
  schemaVersion: z.literal(TOOL_CAPABILITY_REGISTRY_SCHEMA_VERSION),
  toolId: ToolCapabilityToolIdSchema,
  displayName: z.string().trim().min(1).max(160),
  installedVersion: z.string().trim().min(1).max(120).nullable(),
  status: ToolCapabilityStatusSchema,
  usageMode: ToolCapabilityUsageModeSchema,
  purpose: ToolCapabilityPurposeSchema,
  verificationFixtureRef: z.string().trim().min(1).max(255).regex(SLUG_TOKEN).nullable(),
  verifiedAt: z.string().regex(ISO_DATE_TIME, "verifiedAt must be an ISO datetime.").nullable(),
  evidenceRefs: z.array(ToolCapabilityEvidenceRefSchema),
  licenseReviewStatus: ToolCapabilityLicenseReviewStatusSchema,
  licenseReviewRef: z.string().trim().min(1).max(255).regex(SLUG_TOKEN).nullable(),
  publicExposureAllowed: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(1000)),
}).strict().superRefine((record, ctx) => {
  const hasVerificationFixtureEvidence = record.evidenceRefs.some(
    (evidenceRef) => evidenceRef.refType === "verification_fixture",
  );

  if (record.status === "verified") {
    if (record.installedVersion === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installedVersion"],
        message: "Verified tools require an installed version.",
      });
    }

    if (record.verificationFixtureRef === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationFixtureRef"],
        message: "Verified tools require a verification fixture reference.",
      });
    }

    if (record.verifiedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verifiedAt"],
        message: "Verified tools require a verification timestamp.",
      });
    }

    if (!hasVerificationFixtureEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Verified tools require verification fixture evidence.",
      });
    }
  }

  if (
    (record.status === "unverified" ||
      record.status === "false" ||
      record.status === "research_only") &&
    record.publicExposureAllowed
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["publicExposureAllowed"],
      message: "Unverified, false, and research-only tools cannot allow public exposure.",
    });
  }

  if (
    (record.licenseReviewStatus === "blocked" ||
      record.licenseReviewStatus === "pending_review" ||
      record.licenseReviewStatus === "research_only" ||
      record.licenseReviewStatus === "benchmark_only" ||
      record.licenseReviewStatus === "needs_commercial_license") &&
    record.publicExposureAllowed
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["publicExposureAllowed"],
      message: "Public exposure requires a license status that permits the scoped use.",
    });
  }
});
export type ToolCapabilityRecord = z.infer<typeof ToolCapabilityRecordSchema>;

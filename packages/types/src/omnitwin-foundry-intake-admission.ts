import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryCoordinateFrameSchema,
  FoundryGeneratedRegionSchema,
  FoundryIngestManifestV0Schema,
  FoundryInputAssetSchema,
  FoundryProvenanceEdgeSchema,
  FoundryRelativePathSchema,
  FoundrySourceRootSchema,
  FoundryTransformEdgeSchema,
  FoundryUtcInstantSchema,
  computeFoundryIngestManifestSha256,
} from "./omnitwin-foundry.js";
import { RuntimeManifestKeySchema, RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const FOUNDRY_INTAKE_ADMISSION_REVIEW_V0 =
  "omnitwin.foundry.intake-admission-review.v0";
export const FOUNDRY_INTAKE_ADMISSION_RESULT_V0 =
  "omnitwin.foundry.intake-admission-result.v0";

const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const REVIEW_DIGEST_DOMAIN = "omnitwin.foundry.intake-admission-review.v0";
const RESULT_DIGEST_DOMAIN = "omnitwin.foundry.intake-admission-result.v0";

export const FOUNDRY_INTAKE_EXCLUSION_REASONS = [
  "duplicate_content",
  "unsupported_format",
  "rights_not_cleared",
  "provenance_unknown",
  "unrelated_to_project",
  "superseded_input",
  "operator_rejected",
] as const;
export const FoundryIntakeExclusionReasonSchema = z.enum(
  FOUNDRY_INTAKE_EXCLUSION_REASONS,
);

export const FoundryIntakeClassificationDecisionSchema = z
  .object({
    method: z.enum(["accepted_detector_candidate", "operator_override"]),
    rationale: z.string().trim().min(1).max(1_000),
    evidenceReferences: z.array(z.string().trim().min(1).max(500)).max(50),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.method === "operator_override" && decision.evidenceReferences.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceReferences"],
        message: "operator format overrides require at least one evidence reference",
      });
    }
    if (new Set(decision.evidenceReferences).size !== decision.evidenceReferences.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceReferences"],
        message: "classification evidence references must be unique",
      });
    }
  });

export const FoundryIntakeAdmitDecisionSchema = z
  .object({
    action: z.literal("admit"),
    path: FoundryRelativePathSchema,
    classification: FoundryIntakeClassificationDecisionSchema,
    asset: FoundryInputAssetSchema,
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.asset.relativePath !== decision.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["asset", "relativePath"],
        message: "admitted asset path must equal the reviewed receipt path",
      });
    }
  });

export const FoundryIntakeExcludeDecisionSchema = z
  .object({
    action: z.literal("exclude"),
    path: FoundryRelativePathSchema,
    reason: FoundryIntakeExclusionReasonSchema,
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const FoundryIntakeAdmissionDecisionSchema = z.union([
  FoundryIntakeAdmitDecisionSchema,
  FoundryIntakeExcludeDecisionSchema,
]);
export type FoundryIntakeAdmissionDecision = z.infer<
  typeof FoundryIntakeAdmissionDecisionSchema
>;

export const FoundryIntakeAdmissionCapabilitiesSchema = z
  .object({
    localStaging: z.literal("not_performed"),
    jobPlanning: z.literal("not_authorized"),
    execution: z.literal("not_authorized"),
    modelTraining: z.literal("not_authorized"),
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    promotion: z.literal("not_authorized"),
  })
  .strict();

export const FOUNDRY_INTAKE_ADMISSION_CAPABILITIES = {
  localStaging: "not_performed",
  jobPlanning: "not_authorized",
  execution: "not_authorized",
  modelTraining: "not_authorized",
  signing: "not_authorized",
  publication: "not_authorized",
  promotion: "not_authorized",
} as const;

const FoundryIntakeAdmissionReviewPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INTAKE_ADMISSION_REVIEW_V0),
    receiptSha256: z.string().regex(BARE_SHA256),
    projectId: RuntimeManifestKeySchema,
    reviewedAt: FoundryUtcInstantSchema,
    reviewedBy: z.string().trim().min(1).max(160),
    sourceRoot: FoundrySourceRootSchema,
    coordinateFrames: z.array(FoundryCoordinateFrameSchema).max(10_000),
    transforms: z.array(FoundryTransformEdgeSchema).max(100_000),
    decisions: z.array(FoundryIntakeAdmissionDecisionSchema).min(1).max(100_000),
    provenanceEdges: z.array(FoundryProvenanceEdgeSchema).max(200_000),
    generatedRegions: z.array(FoundryGeneratedRegionSchema).max(100_000),
    legalReviewState: z.enum(["requires_review", "blocked"]),
    sourceMutationPermitted: z.literal(false),
    authority: z.literal("none"),
    capabilities: FoundryIntakeAdmissionCapabilitiesSchema,
  })
  .strict();

function validateAdmissionReviewPayload(
  review: z.infer<typeof FoundryIntakeAdmissionReviewPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const paths = review.decisions.map((decision) => decision.path);
  if (new Set(paths).size !== paths.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "every receipt path must have at most one admission decision",
    });
  }
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "admission decisions must be sorted by path",
    });
  }
  if (!review.decisions.some((decision) => decision.action === "admit")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decisions"],
      message: "an admission review must admit at least one asset",
    });
  }
}

export const FoundryIntakeAdmissionReviewPayloadSchema =
  FoundryIntakeAdmissionReviewPayloadObjectSchema.superRefine(
    validateAdmissionReviewPayload,
  );
export type FoundryIntakeAdmissionReviewPayload = z.infer<
  typeof FoundryIntakeAdmissionReviewPayloadSchema
>;

function domainSeparatedDigest(domain: string, input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

export function computeFoundryIntakeAdmissionReviewSha256(
  review: FoundryIntakeAdmissionReviewPayload,
): string {
  const parsed = FoundryIntakeAdmissionReviewPayloadSchema.parse(review);
  return domainSeparatedDigest(REVIEW_DIGEST_DOMAIN, parsed);
}

export const FoundryIntakeAdmissionReviewV0Schema =
  FoundryIntakeAdmissionReviewPayloadObjectSchema.extend({
    reviewSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((review, ctx) => {
      validateAdmissionReviewPayload(review, ctx);
      const { reviewSha256: _reviewSha256, ...payload } = review;
      const parsedPayload = FoundryIntakeAdmissionReviewPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) return;
      if (
        review.reviewSha256 !==
        domainSeparatedDigest(REVIEW_DIGEST_DOMAIN, parsedPayload.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewSha256"],
          message: "admission review digest must match its canonical payload",
        });
      }
    });
export type FoundryIntakeAdmissionReviewV0 = z.infer<
  typeof FoundryIntakeAdmissionReviewV0Schema
>;

export function finalizeFoundryIntakeAdmissionReview(
  input: unknown,
): FoundryIntakeAdmissionReviewV0 {
  const payload = FoundryIntakeAdmissionReviewPayloadSchema.parse(input);
  return FoundryIntakeAdmissionReviewV0Schema.parse({
    ...payload,
    reviewSha256: computeFoundryIntakeAdmissionReviewSha256(payload),
  });
}

const FoundryIntakeAdmissionResultPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INTAKE_ADMISSION_RESULT_V0),
    receiptSha256: z.string().regex(BARE_SHA256),
    reviewSha256: RuntimeSha256Schema,
    manifestSha256: RuntimeSha256Schema,
    manifest: FoundryIngestManifestV0Schema,
    exclusions: z.array(FoundryIntakeExcludeDecisionSchema).max(100_000),
    authority: z.literal("none"),
    capabilities: FoundryIntakeAdmissionCapabilitiesSchema,
  })
  .strict();

function validateAdmissionResultPayload(
  result: z.infer<typeof FoundryIntakeAdmissionResultPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (result.manifestSha256 !== computeFoundryIngestManifestSha256(result.manifest)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestSha256"],
      message: "admission result must bind the exact ingest manifest",
    });
  }
  if (result.manifest.legalReviewState === "approved") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifest", "legalReviewState"],
      message: "intake admission cannot approve legal review",
    });
  }
  const paths = result.exclusions.map((decision) => decision.path);
  const sorted = [...paths].sort();
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exclusions"],
      message: "exclusions must contain unique paths in sorted order",
    });
  }
}

export const FoundryIntakeAdmissionResultPayloadSchema =
  FoundryIntakeAdmissionResultPayloadObjectSchema.superRefine(
    validateAdmissionResultPayload,
  );
export type FoundryIntakeAdmissionResultPayload = z.infer<
  typeof FoundryIntakeAdmissionResultPayloadSchema
>;

export function computeFoundryIntakeAdmissionResultSha256(
  result: FoundryIntakeAdmissionResultPayload,
): string {
  const parsed = FoundryIntakeAdmissionResultPayloadSchema.parse(result);
  return domainSeparatedDigest(RESULT_DIGEST_DOMAIN, parsed);
}

export const FoundryIntakeAdmissionResultV0Schema =
  FoundryIntakeAdmissionResultPayloadObjectSchema.extend({
    resultSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((result, ctx) => {
      validateAdmissionResultPayload(result, ctx);
      const { resultSha256: _resultSha256, ...payload } = result;
      const parsedPayload = FoundryIntakeAdmissionResultPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) return;
      if (
        result.resultSha256 !==
        domainSeparatedDigest(RESULT_DIGEST_DOMAIN, parsedPayload.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["resultSha256"],
          message: "admission result digest must match its canonical payload",
        });
      }
    });
export type FoundryIntakeAdmissionResultV0 = z.infer<
  typeof FoundryIntakeAdmissionResultV0Schema
>;

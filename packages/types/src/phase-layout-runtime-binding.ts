import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { PhaseLayoutSnapshotIdSchema } from "./event-phase-graph.js";
import { RuntimePackageContentDigestSchema } from "./asset-version.js";
import {
  RuntimeManifestKeySchema,
  TransformArtifactV0Schema,
} from "./runtime-venue-manifest.js";
import { SpaceIdSchema, SpaceSlugSchema } from "./space.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";

export const PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION =
  "phase-layout-runtime-binding.v1";
export const PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY =
  "trades-hall-reviewed-presentation.v1";
export const PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS = 8;
export const PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES = 16 * 1024 * 1024;
export const PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES = 96 * 1024 * 1024;

const FILE_NAME = /^[^/\\]+$/u;

export const PHASE_LAYOUT_RUNTIME_UNAVAILABLE_REASONS = [
  "runtime_not_declared",
  "manifest_digest_missing",
  "package_reference_invalid",
  "package_not_found",
  "package_scope_mismatch",
  "package_identity_invalid",
  "manifest_mismatch",
  "package_not_reviewed",
  "composition_invalid",
  "reviewed_profile_missing",
  "presentation_admission_missing",
  "qa_review_missing",
  "signed_transform_missing",
  "provenance_incomplete",
] as const;

export const PhaseLayoutRuntimeUnavailableReasonSchema = z.enum(
  PHASE_LAYOUT_RUNTIME_UNAVAILABLE_REASONS,
);
export type PhaseLayoutRuntimeUnavailableReason = z.infer<
  typeof PhaseLayoutRuntimeUnavailableReasonSchema
>;

const BindingCommonShape = {
  schemaVersion: z.literal(PHASE_LAYOUT_RUNTIME_BINDING_SCHEMA_VERSION),
  admissionPolicy: z.literal(PHASE_LAYOUT_RUNTIME_ADMISSION_POLICY),
  bindingId: PhaseLayoutSnapshotIdSchema,
  phaseLayoutSnapshotId: PhaseLayoutSnapshotIdSchema,
  canonicalSnapshotId: z.string().uuid(),
  snapshotHash: RuntimePackageContentDigestSchema,
  venueId: VenueIdSchema,
  venueSlug: VenueSlugSchema,
  spaceId: SpaceIdSchema,
  spaceSlug: SpaceSlugSchema,
  boundBy: UserIdSchema,
  boundAt: z.string().datetime(),
  bindingDigest: RuntimePackageContentDigestSchema,
} as const;

export const PhaseLayoutRuntimeVisualAssetSchema = z.object({
  memberIndex: z.number().int().nonnegative().max(PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS - 1),
  assetVersionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255).regex(FILE_NAME),
  fileExt: z.enum([".sog", ".spz"]),
  mimeType: z.string().trim().min(1).max(120),
  sha256: RuntimePackageContentDigestSchema,
  sizeBytes: z.number().int().positive().max(PHASE_LAYOUT_RUNTIME_MEMBER_MAX_BYTES),
  evidenceStatus: z.literal("human_reviewed"),
}).strict().superRefine((asset, context) => {
  if (!asset.fileName.endsWith(asset.fileExt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileName"],
      message: "Runtime visual member fileName must end with its exact fileExt.",
    });
  }
});
export type PhaseLayoutRuntimeVisualAsset = z.infer<
  typeof PhaseLayoutRuntimeVisualAssetSchema
>;

const AvailableBindingObjectSchema = z.object({
  ...BindingCommonShape,
  availability: z.literal("available"),
  runtimePackageId: z.string().uuid(),
  runtimePackageRevision: z.number().int().positive(),
  runtimePackageContentDigest: RuntimePackageContentDigestSchema,
  runtimeManifestDigest: RuntimePackageContentDigestSchema,
  runtimePackageEvidenceStatus: z.literal("human_reviewed"),
  runtimePackageStatus: z.enum(["internal_ready", "published"]),
  reviewedProfileId: RuntimeManifestKeySchema,
  reviewedProfileManifestFingerprint: RuntimePackageContentDigestSchema,
  rightsEvidenceDigest: RuntimePackageContentDigestSchema,
  sceneAuthorityMapDigest: RuntimePackageContentDigestSchema,
  runtimeQaRecordId: z.string().uuid(),
  runtimeQaRecordKey: RuntimeManifestKeySchema,
  runtimeQaRecordDigest: RuntimePackageContentDigestSchema,
  runtimeQaDecision: z.enum(["approved_internal_preview", "approved_public"]),
  runtimeQaReviewedBy: UserIdSchema,
  runtimeQaReviewedAt: z.string().datetime(),
  transformArtifactRowId: z.string().uuid(),
  transformArtifactId: RuntimeManifestKeySchema,
  transformArtifactDigest: RuntimePackageContentDigestSchema,
  transformArtifact: TransformArtifactV0Schema,
  visualAssets: z.array(PhaseLayoutRuntimeVisualAssetSchema)
    .min(1)
    .max(PHASE_LAYOUT_RUNTIME_MAX_VISUAL_ASSETS),
  compositionDigest: RuntimePackageContentDigestSchema,
}).strict();

export const PhaseLayoutRuntimeAvailableBindingSchema =
  AvailableBindingObjectSchema.superRefine((binding, context) => {
    validateCommonBinding(binding, context);
    if (binding.transformArtifact.id !== binding.transformArtifactId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifactId"],
        message: "Transform artifact identity must match its immutable body.",
      });
    }
    if (
      runtimeTransformArtifactDigest(binding.transformArtifact) !==
      binding.transformArtifactDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifactDigest"],
        message: "Transform artifact digest must match its immutable body.",
      });
    }
    const seenAssetIds = new Set<string>();
    let totalSizeBytes = 0;
    for (const [index, asset] of binding.visualAssets.entries()) {
      if (asset.memberIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["visualAssets", index, "memberIndex"],
          message: "Runtime visual members must preserve exact manifest order.",
        });
      }
      if (seenAssetIds.has(asset.assetVersionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["visualAssets", index, "assetVersionId"],
          message: "Runtime visual members must have unique asset identities.",
        });
      }
      seenAssetIds.add(asset.assetVersionId);
      totalSizeBytes += asset.sizeBytes;
    }
    if (totalSizeBytes > PHASE_LAYOUT_RUNTIME_TOTAL_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualAssets"],
        message: "Runtime visual members exceed the historical viewer byte ceiling.",
      });
    }
    if (
      phaseLayoutRuntimeCompositionDigest({
        runtimePackageId: binding.runtimePackageId,
        runtimePackageContentDigest: binding.runtimePackageContentDigest,
        reviewedProfileId: binding.reviewedProfileId,
        transformArtifactDigest: binding.transformArtifactDigest,
        visualAssets: binding.visualAssets,
      }) !== binding.compositionDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compositionDigest"],
        message: "Runtime composition digest must match its ordered immutable members.",
      });
    }
  });
export type PhaseLayoutRuntimeAvailableBinding = z.infer<
  typeof PhaseLayoutRuntimeAvailableBindingSchema
>;

const UnavailableBindingObjectSchema = z.object({
  ...BindingCommonShape,
  availability: z.literal("unavailable"),
  unavailableReason: PhaseLayoutRuntimeUnavailableReasonSchema,
  expectedRuntimePackageId: z.string().trim().min(1).max(160).nullable(),
  expectedRuntimeManifestDigest: RuntimePackageContentDigestSchema.nullable(),
}).strict();

export const PhaseLayoutRuntimeUnavailableBindingSchema =
  UnavailableBindingObjectSchema.superRefine(validateCommonBinding);
export type PhaseLayoutRuntimeUnavailableBinding = z.infer<
  typeof PhaseLayoutRuntimeUnavailableBindingSchema
>;

export const PhaseLayoutRuntimeBindingV1Schema = z.union([
  PhaseLayoutRuntimeAvailableBindingSchema,
  PhaseLayoutRuntimeUnavailableBindingSchema,
]);
export type PhaseLayoutRuntimeBindingV1 = z.infer<
  typeof PhaseLayoutRuntimeBindingV1Schema
>;

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256Hex(`${domain}${stableCanonicalJson(canonical)}`);
}

export function runtimeTransformArtifactDigest(artifact: unknown): string {
  const parsed = TransformArtifactV0Schema.parse(artifact);
  return sha256Hex(stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed)));
}

export function phaseLayoutRuntimeCompositionDigest(composition: unknown): string {
  return canonicalDigest("venviewer.phase-layout-runtime-composition.v1\n", composition);
}

/** Computes the self-authenticating binding digest from the record without its digest field. */
export function phaseLayoutRuntimeBindingDigest(unsignedBinding: unknown): string {
  return canonicalDigest("venviewer.phase-layout-runtime-binding.v1\n", unsignedBinding);
}

export function phaseLayoutRuntimeBindingMatchesDigest(
  binding: PhaseLayoutRuntimeBindingV1,
): boolean {
  const { bindingDigest, ...unsignedBinding } = binding;
  return phaseLayoutRuntimeBindingDigest(unsignedBinding) === bindingDigest;
}

function validateCommonBinding(
  binding: z.infer<typeof AvailableBindingObjectSchema> | z.infer<typeof UnavailableBindingObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (binding.bindingId !== binding.phaseLayoutSnapshotId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bindingId"],
      message: "Historical runtime binding identity must equal its frozen snapshot identity.",
    });
  }
  const { bindingDigest, ...unsignedBinding } = binding;
  if (phaseLayoutRuntimeBindingDigest(unsignedBinding) !== bindingDigest) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bindingDigest"],
      message: "Historical runtime binding digest does not match its immutable content.",
    });
  }
}

export const PhaseLayoutHistoricalRuntimeUnavailableReasonSchema = z.union([
  PhaseLayoutRuntimeUnavailableReasonSchema,
  z.enum(["legacy_snapshot_unbound", "runtime_binding_invalid"]),
]);
export type PhaseLayoutHistoricalRuntimeUnavailableReason = z.infer<
  typeof PhaseLayoutHistoricalRuntimeUnavailableReasonSchema
>;

const AvailableHistoricalRuntimeSchema = z.object({
  state: z.literal("available"),
  binding: PhaseLayoutRuntimeAvailableBindingSchema,
}).strict();

const UnavailableHistoricalRuntimeSchema = z.object({
  state: z.literal("unavailable"),
  binding: PhaseLayoutRuntimeUnavailableBindingSchema.nullable(),
  reason: PhaseLayoutHistoricalRuntimeUnavailableReasonSchema,
  message: z.string().trim().min(1).max(240),
}).strict().superRefine((runtime, context) => {
  if (
    runtime.binding !== null &&
    runtime.binding.unavailableReason !== runtime.reason
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "Historical runtime unavailability must match its immutable binding.",
    });
  }
  if (
    runtime.binding === null &&
    runtime.reason !== "legacy_snapshot_unbound" &&
    runtime.reason !== "runtime_binding_invalid"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "Only a legacy snapshot may omit an immutable runtime binding.",
    });
  }
});

export const PhaseLayoutHistoricalRuntimeSchema = z.union([
  AvailableHistoricalRuntimeSchema,
  UnavailableHistoricalRuntimeSchema,
]);
export type PhaseLayoutHistoricalRuntime = z.infer<
  typeof PhaseLayoutHistoricalRuntimeSchema
>;

export function historicalRuntimeFromBinding(
  binding: PhaseLayoutRuntimeBindingV1 | null,
): PhaseLayoutHistoricalRuntime {
  if (binding === null) {
    return {
      state: "unavailable",
      binding: null,
      reason: "legacy_snapshot_unbound",
      message: "This older frozen layout has no immutable historical room binding.",
    };
  }
  if (binding.availability === "available") {
    return { state: "available", binding };
  }
  return {
    state: "unavailable",
    binding,
    reason: binding.unavailableReason,
    message: "The exact historical room capture is not available for this frozen layout.",
  };
}

export function invalidHistoricalRuntimeBinding(): PhaseLayoutHistoricalRuntime {
  return {
    state: "unavailable",
    binding: null,
    reason: "runtime_binding_invalid",
    message: "The historical room binding failed its immutable identity checks.",
  };
}

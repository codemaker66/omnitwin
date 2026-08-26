import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  GRAND_HALL_CLOSED_BOUNDARY_V1,
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_PORTAL_DECISIONS_V1,
  GrandHallClosedBoundaryV1MaterialSchema,
  GrandHallInterfaceCandidateSchema,
  GrandHallPortalDecisionsV1MaterialSchema,
  computeGrandHallInterfaceInventorySha256,
} from "./grand-hall-room-scope-artifacts.js";
import {
  GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
  GRAND_HALL_SCOPE_REVIEW_PACK_V2,
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GrandHallPanoramaMaskRecordV2Schema,
  GrandHallPanoramaObservationInventoryV2Schema,
  GrandHallPanoramaObservationV2Schema,
  GrandHallPanoramaSourceInventoryV3Schema,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  GrandHallScopeReviewPackMaterialV2Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  computeGrandHallPanoramaObservationInventoryV2Sha256,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  type GrandHallPanoramaObservationBindingV2,
  type GrandHallScopeReviewPackMaterialV2,
  type GrandHallT554ClosedVolumeReviewV1,
} from "./grand-hall-room-scope-artifacts-v2.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const GRAND_HALL_SCOPE_REVIEW_PACK_V3 =
  "venviewer.grand-hall-scope-review-pack.v3";
export const GRAND_HALL_T554_HUMAN_DECISIONS_V3 =
  "venviewer.grand-hall-t554-human-decisions.v3";
export const GRAND_HALL_ROOM_MEMBERSHIP_V4 =
  "omnitwin.foundry.grand-hall-room-membership.v4";
export const GRAND_HALL_PANORAMA_MASK_SET_V3 =
  "venviewer.grand-hall-panorama-mask-set.v3";
export const GRAND_HALL_PORTAL_DECISIONS_V2 =
  "venviewer.grand-hall-portal-decisions.v2";
export const GRAND_HALL_CLOSED_BOUNDARY_V2 =
  "venviewer.grand-hall-closed-boundary.v2";
export const GRAND_HALL_REVIEWED_CLOSURE_PLANE_BINDING_V1 =
  "venviewer.grand-hall-reviewed-closure-plane-binding.v1";
export const GRAND_HALL_NATIVE_REVIEW_EVIDENCE_SET_V1 =
  "venviewer.grand-hall-native-review-evidence-set.v1";

const PositiveByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const CanonicalUtcMillisecondInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .datetime({ offset: false, precision: 3 })
  .refine(
    (value) => {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
    },
    "instant must be the canonical UTC millisecond form YYYY-MM-DDTHH:mm:ss.sssZ",
  );
const SafeTargetIdSchema = z.string().trim().min(1).max(160).superRefine(
  (targetId, ctx) => {
    if (/^matterpak-obj-group:[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(targetId)) return;
    const faceRange = /^matterpak-obj-face-range:(0|[1-9]\d*)-(0|[1-9]\d*)$/u.exec(
      targetId,
    );
    if (faceRange === null) {
      addIssue(
        ctx,
        [],
        "cleanup target must bind one exact MatterPak OBJ group or canonical face range",
      );
      return;
    }
    const first = Number.parseInt(faceRange[1] ?? "", 10);
    const last = Number.parseInt(faceRange[2] ?? "", 10);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) {
      addIssue(ctx, [], "cleanup face range must be finite, ordered, and safe");
    }
  },
);

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function forwardIssues(
  error: z.ZodError,
  ctx: z.RefinementCtx,
  prefix: readonly (string | number)[] = [],
): void {
  for (const issue of error.issues) {
    ctx.addIssue({ ...issue, path: [...prefix, ...issue.path] });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSafePathUnicode(value: string): boolean {
  for (const character of Array.from(value)) {
    const code = character.charCodeAt(0);
    const codePoint = character.codePointAt(0) ?? code;
    const bidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff;
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      bidiControl ||
      (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    ) return false;
  }
  return true;
}

function isSafeGrandHallRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value) ||
    !hasSafePathUnicode(value)
  ) return false;
  return value.split("/").every((segment) => {
    const windowsStem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    return segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u.test(windowsStem);
  });
}

const SafeRelativeFileSchema = z.string().superRefine((value, ctx) => {
  if (!isSafeGrandHallRelativePath(value)) {
    addIssue(ctx, [], "file must be a canonical traversal-free POSIX relative path");
  }
});

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

type GrandHallScopeReviewPackSourceEvidenceV3 =
  GrandHallScopeReviewPackMaterialV2["sourceEvidence"] & {
    readonly cleanupMarkerEvidenceSha256: string;
    readonly cleanupTargetInventorySha256: string;
  };

export type GrandHallScopeReviewPackMaterialV3 = Omit<
  GrandHallScopeReviewPackMaterialV2,
  "schemaVersion" | "sourceEvidence"
> & {
  readonly schemaVersion: typeof GRAND_HALL_SCOPE_REVIEW_PACK_V3;
  readonly sourceEvidence: GrandHallScopeReviewPackSourceEvidenceV3;
};

export const GrandHallScopeReviewPackMaterialV3Schema: z.ZodType<
  GrandHallScopeReviewPackMaterialV3,
  z.ZodTypeDef,
  unknown
> = z.unknown().transform((input, ctx): GrandHallScopeReviewPackMaterialV3 => {
  if (!isRecord(input) || !isRecord(input.sourceEvidence)) {
    addIssue(ctx, [], "Grand Hall v3 review-pack material must be one object");
    return z.NEVER;
  }
  if (input.schemaVersion !== GRAND_HALL_SCOPE_REVIEW_PACK_V3) {
    addIssue(ctx, ["schemaVersion"], "review pack must use the additive v3 schema");
    return z.NEVER;
  }
  const {
    cleanupMarkerEvidenceSha256,
    cleanupTargetInventorySha256,
    ...predecessorSourceEvidence
  } = input.sourceEvidence;
  const cleanupMarkerDigest = RuntimeSha256Schema.safeParse(cleanupMarkerEvidenceSha256);
  const cleanupInventoryDigest = RuntimeSha256Schema.safeParse(cleanupTargetInventorySha256);
  if (!cleanupMarkerDigest.success) {
    forwardIssues(cleanupMarkerDigest.error, ctx, ["sourceEvidence", "cleanupMarkerEvidenceSha256"]);
  }
  if (!cleanupInventoryDigest.success) {
    forwardIssues(cleanupInventoryDigest.error, ctx, ["sourceEvidence", "cleanupTargetInventorySha256"]);
  }
  if (!cleanupMarkerDigest.success || !cleanupInventoryDigest.success) return z.NEVER;

  const predecessor = GrandHallScopeReviewPackMaterialV2Schema.safeParse({
    ...input,
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    sourceEvidence: predecessorSourceEvidence,
  });
  if (!predecessor.success) {
    forwardIssues(predecessor.error, ctx);
    return z.NEVER;
  }
  return {
    ...predecessor.data,
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V3,
    sourceEvidence: {
      ...predecessor.data.sourceEvidence,
      cleanupMarkerEvidenceSha256: cleanupMarkerDigest.data,
      cleanupTargetInventorySha256: cleanupInventoryDigest.data,
    },
  };
});

export function computeGrandHallScopeReviewPackV3Sha256(
  material: GrandHallScopeReviewPackMaterialV3,
): string {
  const parsed = GrandHallScopeReviewPackMaterialV3Schema.parse(material);
  return canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V3, parsed);
}

export type GrandHallScopeReviewPackV3 = GrandHallScopeReviewPackMaterialV3 & {
  readonly artifactSha256: string;
};

export const GrandHallScopeReviewPackV3Schema: z.ZodType<
  GrandHallScopeReviewPackV3,
  z.ZodTypeDef,
  unknown
> = z.unknown().transform((input, ctx): GrandHallScopeReviewPackV3 => {
  if (!isRecord(input)) {
    addIssue(ctx, [], "Grand Hall v3 review pack must be one object");
    return z.NEVER;
  }
  const { artifactSha256, ...materialInput } = input;
  const material = GrandHallScopeReviewPackMaterialV3Schema.safeParse(materialInput);
  const digest = RuntimeSha256Schema.safeParse(artifactSha256);
  if (!material.success) forwardIssues(material.error, ctx);
  if (!digest.success) forwardIssues(digest.error, ctx, ["artifactSha256"]);
  if (!material.success || !digest.success) return z.NEVER;
  if (digest.data !== canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V3, material.data)) {
    addIssue(ctx, ["artifactSha256"], "v3 review-pack digest must bind the complete source evidence");
  }
  return { ...material.data, artifactSha256: digest.data };
});

const HumanReviewerV3Schema = z
  .object({
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    reviewedAt: CanonicalUtcMillisecondInstantSchema,
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    agentDecisionAuthority: z.literal("none"),
  })
  .strict();

const AcceptedHumanReviewV3Schema = HumanReviewerV3Schema.extend({
  state: z.literal("human_accepted"),
}).strict();

const ClosedSelectionVolumeDecisionV3Schema = z
  .object({
    reviewSchemaVersion: z.literal(GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1),
    reviewArtifactSha256: RuntimeSha256Schema.nullable(),
    result: z.enum([
      "UNSURE",
      "ACCEPT_NON_RENDERED_SELECTION_VOLUME",
      "REJECT_SELECTION_VOLUME",
    ]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.result === "UNSURE") {
      if (decision.reviewArtifactSha256 !== null || decision.note !== null) {
        addIssue(ctx, [], "an unsure closed-volume decision cannot bind accepted evidence");
      }
      return;
    }
    if (decision.reviewArtifactSha256 === null || decision.note === null) {
      addIssue(ctx, [], "a resolved closed-volume decision requires its exact review digest and note");
    }
  });

const ReviewedMaskBindingV3Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    includedPixelCount: z.number().int().positive()
      .max(GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX),
    excludedPixelCount: SafeCountSchema
      .max(GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX),
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (
      binding.includedPixelCount + binding.excludedPixelCount !==
      GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX
    ) {
      addIssue(
        ctx,
        ["excludedPixelCount"],
        "reviewed mask counts must cover the exact source panorama grid",
      );
    }
  });

const PanoramaClassificationV3Schema = z.enum([
  "grand_hall_core",
  "grand_hall_portal_threshold",
  "no_observed_grand_hall_pixels",
]);

const PanoramaMaskReasonV3Schema = z.enum([
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
]);

const PanoramaHumanDecisionV3ObjectSchema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceObservation: GrandHallPanoramaObservationV2Schema,
    result: z.enum(["UNSURE", "INCLUDE", "EXCLUDE"]),
    classification: PanoramaClassificationV3Schema.nullable(),
    maskFileName: SafeRelativeFileSchema.refine(
      (value) => /\.png$/iu.test(value),
      "mask file must name a PNG",
    ).nullable(),
    reviewedMaskBinding: ReviewedMaskBindingV3Schema.nullable(),
    maskReviewed: z.boolean(),
    nativeResolutionHumanReviewCompleted: z.boolean(),
    nativeReviewEvidenceSha256: RuntimeSha256Schema.nullable(),
    maskReasonCodes: z.array(PanoramaMaskReasonV3Schema).max(5),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

type PanoramaHumanDecisionV3Object = z.infer<
  typeof PanoramaHumanDecisionV3ObjectSchema
>;

function validPanoramaDecisionShape(decision: PanoramaHumanDecisionV3Object): boolean {
  if (decision.result === "UNSURE") {
    return decision.classification === null &&
      decision.maskFileName === null &&
      decision.reviewedMaskBinding === null &&
      !decision.maskReviewed &&
      !decision.nativeResolutionHumanReviewCompleted &&
      decision.nativeReviewEvidenceSha256 === null &&
      decision.maskReasonCodes.length === 0 &&
      decision.note === null;
  }
  if (decision.result === "INCLUDE") {
    return (
      decision.classification === "grand_hall_core" ||
      decision.classification === "grand_hall_portal_threshold"
    ) && decision.maskFileName !== null &&
      decision.nativeResolutionHumanReviewCompleted &&
      decision.nativeReviewEvidenceSha256 !== null &&
      decision.note !== null &&
      (!decision.maskReviewed || decision.reviewedMaskBinding !== null);
  }
  return decision.classification === "no_observed_grand_hall_pixels" &&
    decision.maskFileName === null &&
    decision.reviewedMaskBinding === null &&
    !decision.maskReviewed &&
    decision.nativeResolutionHumanReviewCompleted &&
    decision.nativeReviewEvidenceSha256 !== null &&
    decision.maskReasonCodes.length === 0 &&
    decision.note !== null;
}

export const GrandHallPanoramaHumanDecisionV3Schema =
  PanoramaHumanDecisionV3ObjectSchema.superRefine((decision, ctx) => {
    if (new Set(decision.maskReasonCodes).size !== decision.maskReasonCodes.length) {
      addIssue(ctx, ["maskReasonCodes"], "mask reason codes must be unique");
    }
    const reviewedMask = decision.reviewedMaskBinding;
    if (
      decision.result === "INCLUDE" &&
      reviewedMask !== null &&
      (
        (reviewedMask.excludedPixelCount === 0 && decision.maskReasonCodes.length !== 0) ||
        (reviewedMask.excludedPixelCount > 0 && decision.maskReasonCodes.length === 0)
      )
    ) {
      addIssue(
        ctx,
        ["maskReasonCodes"],
        "reviewed mask exclusion reasons must be empty exactly when no pixels are excluded",
      );
    }
    if (!validPanoramaDecisionShape(decision)) {
      addIssue(
        ctx,
        [],
        "panorama decision fields do not form one fail-closed UNSURE, INCLUDE, or EXCLUDE state",
      );
    }
  });

export type GrandHallPanoramaHumanDecisionV3 = z.infer<
  typeof GrandHallPanoramaHumanDecisionV3Schema
>;

export const GrandHallNativeReviewEvidenceBindingV1Schema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    nativeReviewEvidenceSha256: RuntimeSha256Schema,
  })
  .strict();

export type GrandHallNativeReviewEvidenceBindingV1 = z.infer<
  typeof GrandHallNativeReviewEvidenceBindingV1Schema
>;

export const GrandHallNativeReviewEvidenceSetV1Schema = z
  .array(GrandHallNativeReviewEvidenceBindingV1Schema)
  .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT)
  .superRefine((bindings, ctx) => {
    const parsedSources = GrandHallPanoramaSourceInventoryV3Schema.safeParse(
      bindings.map((binding) => binding.source),
    );
    if (!parsedSources.success) forwardIssues(parsedSources.error, ctx);
    const firstIndexByEvidenceSha256 = new Map<string, number>();
    bindings.forEach((binding, index) => {
      const firstIndex = firstIndexByEvidenceSha256.get(
        binding.nativeReviewEvidenceSha256,
      );
      if (firstIndex !== undefined) {
        addIssue(
          ctx,
          [index, "nativeReviewEvidenceSha256"],
          `native-review evidence digest must be unique; first used at index ${String(firstIndex)}`,
        );
        return;
      }
      firstIndexByEvidenceSha256.set(binding.nativeReviewEvidenceSha256, index);
    });
  });

function nativeReviewEvidenceSetV1Digest(
  bindings: readonly GrandHallNativeReviewEvidenceBindingV1[],
): string {
  return canonicalDigest(GRAND_HALL_NATIVE_REVIEW_EVIDENCE_SET_V1, bindings);
}

export function computeGrandHallNativeReviewEvidenceSetV1Sha256(
  bindings: readonly GrandHallNativeReviewEvidenceBindingV1[],
): string {
  const parsed = GrandHallNativeReviewEvidenceSetV1Schema.parse(bindings);
  return nativeReviewEvidenceSetV1Digest(parsed);
}

const MatterPakRoomHumanDecisionV3Schema = z
  .object({
    sourceRoomKey: z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY),
    sourceMembershipV1Sha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    result: z.enum(["UNSURE", "ACCEPT_AS_GRAND_HALL", "REJECT_AS_GRAND_HALL"]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if ((decision.result === "UNSURE") !== (decision.note === null)) {
      addIssue(ctx, ["note"], "only an unsure MatterPak room decision may omit its human note");
    }
  });

export const GrandHallCleanupArtifactInspectionV3Schema = z
  .object({
    artifactClass: z.enum(["Window", "Mirror"]),
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    cleanupMarkerEvidenceSha256: RuntimeSha256Schema,
    cleanupTargetInventorySha256: RuntimeSha256Schema,
    localizationState: z.enum([
      "metadata_inconclusive_no_explicit_source_locator",
      "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified",
      "source_faces_localized_by_reviewed_correspondence",
    ]).nullable(),
    reviewedTargetIds: z.array(SafeTargetIdSchema).max(20_000),
    nativeSourceReviewCompleted: z.boolean(),
    result: z.enum([
      "UNSURE",
      "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
      "REJECT_SOURCE_SCOPE_HANDLING",
    ]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    const targetIds = inspection.reviewedTargetIds;
    if (new Set(targetIds).size !== targetIds.length) {
      addIssue(ctx, ["reviewedTargetIds"], "reviewed cleanup target identifiers must be unique");
    }
    targetIds.forEach((targetId, index) => {
      const previous = targetIds[index - 1];
      if (previous !== undefined && previous >= targetId) {
        addIssue(
          ctx,
          ["reviewedTargetIds", index],
          "reviewed cleanup targets must preserve strict canonical identifier order",
        );
      }
    });
    if (inspection.result === "UNSURE") {
      if (
        inspection.localizationState !== null ||
        inspection.reviewedTargetIds.length !== 0 ||
        inspection.nativeSourceReviewCompleted ||
        inspection.note !== null
      ) {
        addIssue(ctx, [], "an unsure cleanup inspection must remain empty and human-pending");
      }
      return;
    }
    if (inspection.note === null) {
      addIssue(ctx, ["note"], "a resolved cleanup inspection requires a human note");
    }
    if (inspection.localizationState === null) {
      addIssue(ctx, ["localizationState"], "a resolved cleanup inspection requires its exact localization state");
    }
    if (
      inspection.result === "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY" &&
      (
        inspection.localizationState !==
          "source_faces_localized_by_reviewed_correspondence" ||
        inspection.reviewedTargetIds.length === 0 ||
        !inspection.nativeSourceReviewCompleted
      )
    ) {
      addIssue(
        ctx,
        [],
        "cleanup acceptance requires localized exact targets and completed native-source review",
      );
    }
    if (
      inspection.localizationState ===
        "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified" &&
      inspection.reviewedTargetIds.some(
        (targetId) => !targetId.startsWith("matterpak-obj-group:"),
      )
    ) {
      addIssue(
        ctx,
        ["reviewedTargetIds"],
        "explicit source-group localization may bind only exact OBJ-group targets",
      );
    }
    if (
      inspection.localizationState ===
        "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified" &&
      inspection.artifactClass !== "Mirror"
    ) {
      addIssue(
        ctx,
        ["localizationState"],
        "literal Mirror group-name localization may be recorded only for the Mirror class",
      );
    }
    if (
      inspection.localizationState ===
        "source_faces_localized_by_reviewed_correspondence" &&
      inspection.reviewedTargetIds.some(
        (targetId) => !targetId.startsWith("matterpak-obj-face-range:"),
      )
    ) {
      addIssue(
        ctx,
        ["reviewedTargetIds"],
        "reviewed face correspondence may bind only canonical OBJ face ranges",
      );
    }
    if (
      (
        inspection.localizationState ===
          "metadata_inconclusive_no_explicit_source_locator" ||
        inspection.localizationState ===
          "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified"
      ) &&
      inspection.result !== "REJECT_SOURCE_SCOPE_HANDLING"
    ) {
      addIssue(
        ctx,
        ["result"],
        "metadata-only or literal-name-only cleanup evidence must fail closed as rejection",
      );
    }
  });

export type GrandHallCleanupArtifactInspectionV3 = z.infer<
  typeof GrandHallCleanupArtifactInspectionV3Schema
>;

export const GrandHallReviewedClosurePlaneBindingV1Schema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_REVIEWED_CLOSURE_PLANE_BINDING_V1),
    sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    units: z.literal("meters"),
    construction: z.literal("vertical_extrusion_of_directed_ccw_footprint_edge"),
    closedVolumeReviewSha256: RuntimeSha256Schema,
    footprintEdgeIndex: z.number().int().min(0).max(2_047),
    localGrandHallSide: z.literal("left_of_directed_ccw_edge"),
    canonicalPlaneOrientation: z.literal(
      "outward_normal_grand_hall_local_side_non_positive",
    ),
    interfaceTopologyAtlasManifestSha256: RuntimeSha256Schema,
    sharedSourceVertexSetSha256: RuntimeSha256Schema,
  })
  .strict();

export type GrandHallReviewedClosurePlaneBindingV1 = z.infer<
  typeof GrandHallReviewedClosurePlaneBindingV1Schema
>;

const InterfaceHumanDecisionBaseV3Schema = z.object({
  source: GrandHallInterfaceCandidateSchema,
});

export const GrandHallInterfaceHumanDecisionV3Schema = z.discriminatedUnion("result", [
  InterfaceHumanDecisionBaseV3Schema.extend({
    result: z.literal("UNSURE"),
    reviewedClosurePlaneBinding: z.null(),
    note: z.null(),
  }).strict(),
  InterfaceHumanDecisionBaseV3Schema.extend({
    result: z.literal("CLOSE_AT_REVIEWED_GRAND_HALL_PLANE"),
    reviewedClosurePlaneBinding: GrandHallReviewedClosurePlaneBindingV1Schema,
    note: z.string().trim().min(1).max(500),
  }).strict(),
  InterfaceHumanDecisionBaseV3Schema.extend({
    result: z.literal("EXCLUDE_BEYOND_INTERFACE"),
    reviewedClosurePlaneBinding: z.null(),
    note: z.string().trim().min(1).max(500),
  }).strict(),
  InterfaceHumanDecisionBaseV3Schema.extend({
    result: z.literal("NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT"),
    reviewedClosurePlaneBinding: z.null(),
    note: z.string().trim().min(1).max(500),
  }).strict(),
]);

export type GrandHallInterfaceHumanDecisionV3 = z.infer<
  typeof GrandHallInterfaceHumanDecisionV3Schema
>;

const GrandHallT554HumanDecisionsV3ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V3),
    reviewPackSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    authority: z.literal("none"),
    reviewState: z.enum(["human_pending", "human_accepted", "human_rejected"]),
    finalDecision: z.enum(["PENDING", "ACCEPT", "REJECT"]),
    reviewer: HumanReviewerV3Schema.nullable(),
    nativeResolutionHumanReviewCompleted: z.boolean(),
    nativeReviewEvidenceSetSha256: RuntimeSha256Schema.nullable(),
    generatedFillPermitted: z.literal(false),
    geometricCameraAuthority: z.literal("none"),
    matterPakRoomDecision: MatterPakRoomHumanDecisionV3Schema,
    cleanupArtifactInspections: z
      .array(GrandHallCleanupArtifactInspectionV3Schema)
      .length(2),
    closedSelectionVolumeDecision: ClosedSelectionVolumeDecisionV3Schema,
    panoramaDecisionCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    panoramaDecisions: z
      .array(GrandHallPanoramaHumanDecisionV3Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    interfaceDecisions: z
      .array(GrandHallInterfaceHumanDecisionV3Schema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    sourceInterfaceInventorySha256: RuntimeSha256Schema,
  })
  .strict();

type GrandHallT554HumanDecisionsV3Object = z.infer<
  typeof GrandHallT554HumanDecisionsV3ObjectSchema
>;

function observationBindingsFromHumanDecisionsV3(
  document: GrandHallT554HumanDecisionsV3Object,
): readonly GrandHallPanoramaObservationBindingV2[] {
  return document.panoramaDecisions.map((decision) => ({
    source: decision.source,
    observation: decision.sourceObservation,
  }));
}

function nativeEvidenceBindingsFromHumanDecisionsV3(
  document: GrandHallT554HumanDecisionsV3Object,
): readonly GrandHallNativeReviewEvidenceBindingV1[] | null {
  const bindings: GrandHallNativeReviewEvidenceBindingV1[] = [];
  for (const decision of document.panoramaDecisions) {
    if (decision.nativeReviewEvidenceSha256 === null) return null;
    bindings.push({
      source: decision.source,
      nativeReviewEvidenceSha256: decision.nativeReviewEvidenceSha256,
    });
  }
  return bindings;
}

function refineHumanDecisionLifecycleV3(
  document: GrandHallT554HumanDecisionsV3Object,
  ctx: z.RefinementCtx,
): void {
  const expectedFinal = document.reviewState === "human_pending"
    ? "PENDING"
    : document.reviewState === "human_accepted"
    ? "ACCEPT"
    : "REJECT";
  if (document.finalDecision !== expectedFinal) {
    addIssue(
      ctx,
      ["finalDecision"],
      "review state and final decision must describe one lifecycle state",
    );
  }
  if ((document.reviewState === "human_pending") !== (document.reviewer === null)) {
    addIssue(
      ctx,
      ["reviewer"],
      "only a human-pending decision document may omit its reviewer",
    );
  }

  const nativeBindings = nativeEvidenceBindingsFromHumanDecisionsV3(document);
  const everyRowCompleted = nativeBindings !== null &&
    document.panoramaDecisions.every(
      (decision) => decision.nativeResolutionHumanReviewCompleted,
    );
  if (document.reviewState === "human_pending") {
    if (
      document.nativeResolutionHumanReviewCompleted ||
      document.nativeReviewEvidenceSetSha256 !== null
    ) {
      addIssue(
        ctx,
        ["nativeReviewEvidenceSetSha256"],
        "a pending review cannot claim a completed native-review evidence set",
      );
    }
    return;
  }
  if (document.nativeResolutionHumanReviewCompleted !== everyRowCompleted) {
    addIssue(
      ctx,
      ["nativeResolutionHumanReviewCompleted"],
      "final native-resolution completion must equal all 148 resolved row attestations",
    );
  }
  if (!everyRowCompleted) {
    if (document.nativeReviewEvidenceSetSha256 !== null) {
      addIssue(
        ctx,
        ["nativeReviewEvidenceSetSha256"],
        "an incomplete native review cannot bind a completed evidence set",
      );
    }
    return;
  }
  const expectedDigest = computeGrandHallNativeReviewEvidenceSetV1Sha256(nativeBindings);
  if (document.nativeReviewEvidenceSetSha256 !== expectedDigest) {
    addIssue(
      ctx,
      ["nativeReviewEvidenceSetSha256"],
      "native-review evidence-set digest must bind every exact source-to-evidence relation",
    );
  }
}

function refineHumanDecisionInventoriesV3(
  document: GrandHallT554HumanDecisionsV3Object,
  ctx: z.RefinementCtx,
): void {
  const bindings = observationBindingsFromHumanDecisionsV3(document);
  const observationInventory = GrandHallPanoramaObservationInventoryV2Schema.safeParse(bindings);
  if (!observationInventory.success) {
    forwardIssues(observationInventory.error, ctx, ["panoramaDecisions"]);
    return;
  }
  if (
    document.sourcePanoramaInventorySha256 !==
      computeGrandHallPanoramaSourceInventoryV3Sha256(
        observationInventory.data.map((binding) => binding.source),
      )
  ) {
    addIssue(
      ctx,
      ["sourcePanoramaInventorySha256"],
      "human decisions must bind all 148 source identities",
    );
  }
  if (
    document.sourceObservationInventorySha256 !==
      computeGrandHallPanoramaObservationInventoryV2Sha256(observationInventory.data)
  ) {
    addIssue(
      ctx,
      ["sourceObservationInventorySha256"],
      "human decisions must bind the frozen observation inventory",
    );
  }
}

function refineHumanDecisionExactCoverageV3(
  document: GrandHallT554HumanDecisionsV3Object,
  ctx: z.RefinementCtx,
): void {
  const expectedCleanupClasses = ["Window", "Mirror"] as const;
  document.cleanupArtifactInspections.forEach((inspection, index) => {
    if (inspection.artifactClass !== expectedCleanupClasses[index]) {
      addIssue(
        ctx,
        ["cleanupArtifactInspections", index, "artifactClass"],
        "cleanup inspections must contain exactly Window then Mirror",
      );
    }
  });
  const candidates = document.interfaceDecisions.map((decision) => decision.source);
  if (new Set(candidates.map((candidate) => candidate.interfaceId)).size !== candidates.length) {
    addIssue(ctx, ["interfaceDecisions"], "interface candidate identifiers must be unique");
  }
  candidates.forEach((candidate, index) => {
    const previous = candidates[index - 1];
    if (previous !== undefined && previous.interfaceId >= candidate.interfaceId) {
      addIssue(
        ctx,
        ["interfaceDecisions", index, "source", "interfaceId"],
        "interface candidates must remain in strict canonical identifier order",
      );
    }
  });
  if (
    document.sourceInterfaceInventorySha256 !==
      computeGrandHallInterfaceInventorySha256(candidates)
  ) {
    addIssue(
      ctx,
      ["sourceInterfaceInventorySha256"],
      "human decisions must bind every exact interface candidate",
    );
  }

  document.interfaceDecisions.forEach((decision, index) => {
    if (decision.result !== "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") return;
    const binding = decision.reviewedClosurePlaneBinding;
    if (
      binding.closedVolumeReviewSha256 !==
        document.closedSelectionVolumeDecision.reviewArtifactSha256
    ) {
      addIssue(
        ctx,
        [
          "interfaceDecisions",
          index,
          "reviewedClosurePlaneBinding",
          "closedVolumeReviewSha256",
        ],
        "reviewed closure plane must bind the selected closed-volume review",
      );
    }
    if (
      binding.sharedSourceVertexSetSha256 !==
        decision.source.sharedSourceVertexSetSha256
    ) {
      addIssue(
        ctx,
        [
          "interfaceDecisions",
          index,
          "reviewedClosurePlaneBinding",
          "sharedSourceVertexSetSha256",
        ],
        "reviewed closure plane must bind the exact source interface vertex set",
      );
    }
  });

  const includedMaskNames = document.panoramaDecisions.flatMap((decision) =>
    decision.result === "INCLUDE" && decision.maskFileName !== null
      ? [decision.maskFileName]
      : []
  );
  if (
    new Set(includedMaskNames.map((fileName) => fileName.toUpperCase())).size !==
      includedMaskNames.length
  ) {
    addIssue(
      ctx,
      ["panoramaDecisions"],
      "included mask filenames must be unique under case-insensitive Windows comparison",
    );
  }
}

function refineAcceptedHumanDecisionsV3(
  document: GrandHallT554HumanDecisionsV3Object,
  ctx: z.RefinementCtx,
): void {
  if (document.reviewState !== "human_accepted") return;
  if (
    !document.nativeResolutionHumanReviewCompleted ||
    document.nativeReviewEvidenceSetSha256 === null
  ) {
    addIssue(
      ctx,
      ["nativeReviewEvidenceSetSha256"],
      "accepted scope requires the complete digest-bound native-review evidence set",
    );
  }
  if (document.matterPakRoomDecision.result !== "ACCEPT_AS_GRAND_HALL") {
    addIssue(
      ctx,
      ["matterPakRoomDecision", "result"],
      "accepted scope requires explicit room acceptance",
    );
  }
  document.cleanupArtifactInspections.forEach((inspection, index) => {
    if (
      inspection.result !==
        "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY" ||
      inspection.localizationState !==
        "source_faces_localized_by_reviewed_correspondence" ||
      inspection.reviewedTargetIds.length === 0 ||
      !inspection.nativeSourceReviewCompleted
    ) {
      addIssue(
        ctx,
        ["cleanupArtifactInspections", index, "result"],
        "accepted scope requires conclusive, native-reviewed cleanup localization",
      );
    }
  });
  if (
    document.closedSelectionVolumeDecision.result !==
      "ACCEPT_NON_RENDERED_SELECTION_VOLUME" ||
    document.closedSelectionVolumeDecision.reviewArtifactSha256 === null
  ) {
    addIssue(
      ctx,
      ["closedSelectionVolumeDecision"],
      "accepted scope requires an accepted digest-bound closed-selection-volume review",
    );
  }
  document.panoramaDecisions.forEach((decision, index) => {
    if (decision.result === "UNSURE") {
      addIssue(
        ctx,
        ["panoramaDecisions", index, "result"],
        "accepted scope must resolve all 148 panorama identities",
      );
      return;
    }
    if (
      !decision.nativeResolutionHumanReviewCompleted ||
      decision.nativeReviewEvidenceSha256 === null
    ) {
      addIssue(
        ctx,
        ["panoramaDecisions", index, "nativeReviewEvidenceSha256"],
        "accepted scope requires exact native-review evidence for every panorama",
      );
    }
    if (
      decision.result === "INCLUDE" &&
      (!decision.maskReviewed || decision.reviewedMaskBinding === null)
    ) {
      addIssue(
        ctx,
        ["panoramaDecisions", index, "reviewedMaskBinding"],
        "accepted inclusion requires exact reviewed mask evidence",
      );
    }
  });
  document.interfaceDecisions.forEach((decision, index) => {
    if (decision.result === "UNSURE") {
      addIssue(
        ctx,
        ["interfaceDecisions", index, "result"],
        "accepted scope must resolve every interface",
      );
    }
  });
}

function refineHumanDecisionsV3(
  document: GrandHallT554HumanDecisionsV3Object,
  ctx: z.RefinementCtx,
): void {
  refineHumanDecisionLifecycleV3(document, ctx);
  refineHumanDecisionInventoriesV3(document, ctx);
  refineHumanDecisionExactCoverageV3(document, ctx);
  refineAcceptedHumanDecisionsV3(document, ctx);
}

export const GrandHallT554HumanDecisionsV3Schema =
  GrandHallT554HumanDecisionsV3ObjectSchema.superRefine(refineHumanDecisionsV3);

export type GrandHallT554HumanDecisionsV3 = z.infer<
  typeof GrandHallT554HumanDecisionsV3Schema
>;

export function computeGrandHallT554HumanDecisionsV3Sha256(
  decisions: GrandHallT554HumanDecisionsV3,
): string {
  const parsed = GrandHallT554HumanDecisionsV3Schema.parse(decisions);
  return canonicalHumanDecisionsV3Sha256(parsed);
}

function canonicalHumanDecisionsV3Sha256(
  decisions: GrandHallT554HumanDecisionsV3,
): string {
  return canonicalDigest(GRAND_HALL_T554_HUMAN_DECISIONS_V3, decisions);
}

function validClosedVolumeReviewV1Sha256(
  review: GrandHallT554ClosedVolumeReviewV1,
): string | null {
  const parsed = GrandHallT554ClosedVolumeReviewV1Schema.safeParse(review);
  return parsed.success
    ? computeGrandHallT554ClosedVolumeReviewV1Sha256(parsed.data)
    : null;
}

const AcceptedMembershipDecisionV4Schema = z.discriminatedUnion("disposition", [
  z
    .object({
      disposition: z.literal("include_with_binary_pixel_mask"),
      classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
      maskRequired: z.literal(true),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
  z
    .object({
      disposition: z.literal("exclude_whole_frame"),
      classification: z.literal("no_observed_grand_hall_pixels"),
      maskRequired: z.literal(false),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
]);

const AcceptedMembershipPanoramaRecordV4Schema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    decision: AcceptedMembershipDecisionV4Schema,
    decisionEvidenceSha256: RuntimeSha256Schema,
    nativeReviewEvidenceSha256: RuntimeSha256Schema,
  })
  .strict();

const GrandHallRoomMembershipMaterialV4ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V4),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V3),
    reviewPackSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    humanDecisionsSha256: RuntimeSha256Schema,
    nativeReviewEvidenceSetSha256: RuntimeSha256Schema,
    sourceMembershipV1Sha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    matterPakRoomMembership: z
      .object({
        includedRoomKeys: z.tuple([z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY)]),
        neighbouringRoomGeometryIncluded: z.literal(false),
        facadeGeometryIncluded: z.literal(false),
      })
      .strict(),
    panoramaRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    includedFrameCount: z.number().int().positive()
      .max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    wholeFrameExclusionCount: SafeCountSchema.max(
      GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    ),
    panoramaRecords: z
      .array(AcceptedMembershipPanoramaRecordV4Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    acceptedUnknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    humanReview: AcceptedHumanReviewV3Schema,
  })
  .strict();

type GrandHallRoomMembershipMaterialV4Object = z.infer<
  typeof GrandHallRoomMembershipMaterialV4ObjectSchema
>;

function refineRoomMembershipV4(
  material: GrandHallRoomMembershipMaterialV4Object,
  ctx: z.RefinementCtx,
): void {
  const sources = material.panoramaRecords.map((record) => record.source);
  const parsedSources = GrandHallPanoramaSourceInventoryV3Schema.safeParse(sources);
  if (!parsedSources.success) {
    forwardIssues(parsedSources.error, ctx, ["panoramaRecords"]);
  } else if (
    material.sourcePanoramaInventorySha256 !==
      computeGrandHallPanoramaSourceInventoryV3Sha256(parsedSources.data)
  ) {
    addIssue(
      ctx,
      ["sourcePanoramaInventorySha256"],
      "accepted membership must bind all 148 source identities",
    );
  }
  const nativeBindings = GrandHallNativeReviewEvidenceSetV1Schema.safeParse(
    material.panoramaRecords.map((record) => ({
      source: record.source,
      nativeReviewEvidenceSha256: record.nativeReviewEvidenceSha256,
    })),
  );
  if (!nativeBindings.success) {
    forwardIssues(nativeBindings.error, ctx, ["panoramaRecords"]);
  } else if (
    material.nativeReviewEvidenceSetSha256 !==
      nativeReviewEvidenceSetV1Digest(nativeBindings.data)
  ) {
    addIssue(
      ctx,
      ["nativeReviewEvidenceSetSha256"],
      "membership native-review evidence-set digest must bind all 148 rows",
    );
  }
  const included = material.panoramaRecords.filter(
    (record) => record.decision.disposition === "include_with_binary_pixel_mask",
  ).length;
  const excluded = material.panoramaRecords.length - included;
  if (material.includedFrameCount !== included) {
    addIssue(
      ctx,
      ["includedFrameCount"],
      "included frame count must match the exact accepted decisions",
    );
  }
  if (material.wholeFrameExclusionCount !== excluded) {
    addIssue(
      ctx,
      ["wholeFrameExclusionCount"],
      "whole-frame exclusion count must match the exact accepted decisions",
    );
  }
  material.panoramaRecords.forEach((record, index) => {
    if (record.decisionEvidenceSha256 !== material.humanDecisionsSha256) {
      addIssue(
        ctx,
        ["panoramaRecords", index, "decisionEvidenceSha256"],
        "every membership decision must bind one exact human-decision document",
      );
    }
  });
}

export const GrandHallRoomMembershipV4MaterialSchema =
  GrandHallRoomMembershipMaterialV4ObjectSchema.superRefine(refineRoomMembershipV4);

export type GrandHallRoomMembershipV4Material = z.infer<
  typeof GrandHallRoomMembershipV4MaterialSchema
>;

export function computeGrandHallRoomMembershipV4Sha256(
  material: GrandHallRoomMembershipV4Material,
): string {
  const parsed = GrandHallRoomMembershipV4MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V4, parsed);
}

const GrandHallRoomMembershipV4ObjectSchema = GrandHallRoomMembershipMaterialV4ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallRoomMembershipV4Schema =
  GrandHallRoomMembershipV4ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineRoomMembershipV4(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V4, material)) {
      addIssue(
        ctx,
        ["artifactSha256"],
        "membership digest must bind all 148 decisions and native-review receipts",
      );
    }
  });

export type GrandHallRoomMembershipV4 = z.infer<
  typeof GrandHallRoomMembershipV4Schema
>;

const PanoramaMaskSourceRecordV3Schema = z.discriminatedUnion("disposition", [
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentityV2Schema,
      disposition: z.literal("include_with_binary_pixel_mask"),
      mask: GrandHallPanoramaMaskRecordV2Schema,
      wholeFrameExclusionReason: z.null(),
      nativeReviewEvidenceSha256: RuntimeSha256Schema,
    })
    .strict(),
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentityV2Schema,
      disposition: z.literal("exclude_whole_frame"),
      mask: z.null(),
      wholeFrameExclusionReason: z.literal(
        "no_observed_grand_hall_pixels_human_confirmed",
      ),
      nativeReviewEvidenceSha256: RuntimeSha256Schema,
    })
    .strict(),
]);

const GrandHallPanoramaMaskSetMaterialV3ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PANORAMA_MASK_SET_V3),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V3),
    reviewPackSha256: RuntimeSha256Schema,
    membershipSchemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V4),
    membershipArtifactSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    humanDecisionsSha256: RuntimeSha256Schema,
    nativeReviewEvidenceSetSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    sourceRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    maskCount: z.number().int().positive().max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    wholeFrameExclusionCount: SafeCountSchema.max(
      GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT,
    ),
    sourceRecords: z
      .array(PanoramaMaskSourceRecordV3Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    unknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    generatedFillPermitted: z.literal(false),
    humanReview: AcceptedHumanReviewV3Schema,
  })
  .strict();

type GrandHallPanoramaMaskSetMaterialV3Object = z.infer<
  typeof GrandHallPanoramaMaskSetMaterialV3ObjectSchema
>;

function refineIncludedMaskBindingV3(
  record: Extract<
    GrandHallPanoramaMaskSetMaterialV3Object["sourceRecords"][number],
    { readonly disposition: "include_with_binary_pixel_mask" }
  >,
  index: number,
  ctx: z.RefinementCtx,
): void {
  if (
    record.mask.sourceJpgFileName !== record.source.fileName ||
    record.mask.sourceJpgSha256 !== record.source.sha256
  ) {
    addIssue(
      ctx,
      ["sourceRecords", index, "mask"],
      "each mask must bind the exact source JPEG filename and byte identity",
    );
  }
}

function refinePanoramaMaskSetV3(
  material: GrandHallPanoramaMaskSetMaterialV3Object,
  ctx: z.RefinementCtx,
): void {
  const sources = material.sourceRecords.map((record) => record.source);
  const parsedSources = GrandHallPanoramaSourceInventoryV3Schema.safeParse(sources);
  if (!parsedSources.success) {
    forwardIssues(parsedSources.error, ctx, ["sourceRecords"]);
  } else if (
    material.sourcePanoramaInventorySha256 !==
      computeGrandHallPanoramaSourceInventoryV3Sha256(parsedSources.data)
  ) {
    addIssue(
      ctx,
      ["sourcePanoramaInventorySha256"],
      "mask set must bind all 148 source identities",
    );
  }
  const nativeBindings = GrandHallNativeReviewEvidenceSetV1Schema.safeParse(
    material.sourceRecords.map((record) => ({
      source: record.source,
      nativeReviewEvidenceSha256: record.nativeReviewEvidenceSha256,
    })),
  );
  if (!nativeBindings.success) {
    forwardIssues(nativeBindings.error, ctx, ["sourceRecords"]);
  } else if (
    material.nativeReviewEvidenceSetSha256 !==
      nativeReviewEvidenceSetV1Digest(nativeBindings.data)
  ) {
    addIssue(
      ctx,
      ["nativeReviewEvidenceSetSha256"],
      "mask-set native-review evidence-set digest must bind all 148 rows",
    );
  }
  const included = material.sourceRecords.filter(
    (record) => record.disposition === "include_with_binary_pixel_mask",
  );
  const excluded = material.sourceRecords.filter(
    (record) => record.disposition === "exclude_whole_frame",
  );
  if (material.maskCount !== included.length) {
    addIssue(ctx, ["maskCount"], "mask count must match every included source exactly");
  }
  if (material.wholeFrameExclusionCount !== excluded.length) {
    addIssue(
      ctx,
      ["wholeFrameExclusionCount"],
      "exclusion count must match every excluded source exactly",
    );
  }
  included.forEach((record) => {
    refineIncludedMaskBindingV3(record, record.source.inventoryIndex, ctx);
  });
  const maskNames = included.map((record) => record.mask.fileName);
  const maskCollisionKeys = maskNames.map((fileName) => fileName.toUpperCase());
  if (new Set(maskCollisionKeys).size !== maskNames.length) {
    addIssue(
      ctx,
      ["sourceRecords"],
      "included panorama masks must have unique case-insensitive Windows-safe filenames",
    );
  }
}

export const GrandHallPanoramaMaskSetV3MaterialSchema =
  GrandHallPanoramaMaskSetMaterialV3ObjectSchema.superRefine(refinePanoramaMaskSetV3);

export type GrandHallPanoramaMaskSetV3Material = z.infer<
  typeof GrandHallPanoramaMaskSetV3MaterialSchema
>;

export function computeGrandHallPanoramaMaskSetV3Sha256(
  material: GrandHallPanoramaMaskSetV3Material,
): string {
  const parsed = GrandHallPanoramaMaskSetV3MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V3, parsed);
}

const GrandHallPanoramaMaskSetV3ObjectSchema = GrandHallPanoramaMaskSetMaterialV3ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallPanoramaMaskSetV3Schema =
  GrandHallPanoramaMaskSetV3ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refinePanoramaMaskSetV3(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V3, material)) {
      addIssue(
        ctx,
        ["artifactSha256"],
        "mask-set digest must bind every source, native review, disposition, and mask",
      );
    }
  });

export type GrandHallPanoramaMaskSetV3 = z.infer<
  typeof GrandHallPanoramaMaskSetV3Schema
>;

const PortalDecisionCommonV2Schema = z.object({
  interfaceId: z.string().trim().min(1).max(160),
  grandHallSideEvidenceSha256: RuntimeSha256Schema,
  decisionNote: z.string().trim().min(1).max(500),
});

const PortalDecisionV2Schema = z.discriminatedUnion("resolution", [
  PortalDecisionCommonV2Schema.extend({
    resolution: z.literal("close_at_reviewed_grand_hall_plane"),
    reviewedClosurePlaneBinding: GrandHallReviewedClosurePlaneBindingV1Schema,
  }).strict(),
  PortalDecisionCommonV2Schema.extend({
    resolution: z.literal("exclude_beyond_interface"),
    reviewedClosurePlaneBinding: z.null(),
  }).strict(),
  PortalDecisionCommonV2Schema.extend({
    resolution: z.literal("not_a_portal_source_topology_artifact"),
    reviewedClosurePlaneBinding: z.null(),
  }).strict(),
]);

const GrandHallPortalDecisionsMaterialV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PORTAL_DECISIONS_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V3),
    reviewPackSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    humanDecisionsSha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    interfaceInventorySha256: RuntimeSha256Schema,
    interfaceCount: z.literal(GRAND_HALL_EXACT_INTERFACE_COUNT),
    interfaceCandidates: z
      .array(GrandHallInterfaceCandidateSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    decisions: z.array(PortalDecisionV2Schema).length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    allInterfacesResolved: z.literal(true),
    humanReview: AcceptedHumanReviewV3Schema,
  })
  .strict();

type GrandHallPortalDecisionsMaterialV2Object = z.infer<
  typeof GrandHallPortalDecisionsMaterialV2ObjectSchema
>;

function refinePortalDecisionsV2(
  material: GrandHallPortalDecisionsMaterialV2Object,
  ctx: z.RefinementCtx,
): void {
  const legacy = GrandHallPortalDecisionsV1MaterialSchema.safeParse({
    schemaVersion: GRAND_HALL_PORTAL_DECISIONS_V1,
    venueSlug: material.venueSlug,
    roomSlug: material.roomSlug,
    authority: material.authority,
    productionTrust: material.productionTrust,
    reviewPackSha256: material.reviewPackSha256,
    sourceBoundaryEvidenceSha256: material.sourceBoundaryEvidenceSha256,
    interfaceInventorySha256: material.interfaceInventorySha256,
    interfaceCount: material.interfaceCount,
    interfaceCandidates: material.interfaceCandidates,
    decisions: material.decisions.map((decision) => ({
      interfaceId: decision.interfaceId,
      resolution: decision.resolution,
      grandHallSideEvidenceSha256: decision.grandHallSideEvidenceSha256,
      decisionNote: decision.decisionNote,
    })),
    allInterfacesResolved: material.allInterfacesResolved,
    humanReview: material.humanReview,
  });
  if (!legacy.success) forwardIssues(legacy.error, ctx);
  material.decisions.forEach((decision, index) => {
    if (decision.grandHallSideEvidenceSha256 !== material.humanDecisionsSha256) {
      addIssue(
        ctx,
        ["decisions", index, "grandHallSideEvidenceSha256"],
        "every portal resolution must bind the exact v3 human decisions",
      );
    }
  });
}

export const GrandHallPortalDecisionsV2MaterialSchema =
  GrandHallPortalDecisionsMaterialV2ObjectSchema.superRefine(refinePortalDecisionsV2);

export type GrandHallPortalDecisionsV2Material = z.infer<
  typeof GrandHallPortalDecisionsV2MaterialSchema
>;

export function computeGrandHallPortalDecisionsV2Sha256(
  material: GrandHallPortalDecisionsV2Material,
): string {
  const parsed = GrandHallPortalDecisionsV2MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_PORTAL_DECISIONS_V2, parsed);
}

const GrandHallPortalDecisionsV2ObjectSchema = GrandHallPortalDecisionsMaterialV2ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallPortalDecisionsV2Schema =
  GrandHallPortalDecisionsV2ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refinePortalDecisionsV2(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_PORTAL_DECISIONS_V2, material)) {
      addIssue(
        ctx,
        ["artifactSha256"],
        "portal digest must bind every resolution and concrete closure edge",
      );
    }
  });

export type GrandHallPortalDecisionsV2 = z.infer<
  typeof GrandHallPortalDecisionsV2Schema
>;

const BoundarySemanticRefinementCommonV2Schema = z.object({
  interfaceId: z.string().trim().min(1).max(160),
  evidenceSha256: RuntimeSha256Schema,
  applied: z.literal(true),
  generatedGeometryCreated: z.literal(false),
});

const BoundarySemanticRefinementV2Schema = z.discriminatedUnion("operation", [
  BoundarySemanticRefinementCommonV2Schema.extend({
    operation: z.literal("retain_grand_hall_side"),
    reviewedClosurePlaneBinding: GrandHallReviewedClosurePlaneBindingV1Schema,
  }).strict(),
  BoundarySemanticRefinementCommonV2Schema.extend({
    operation: z.literal("exclude_beyond_interface"),
    reviewedClosurePlaneBinding: z.null(),
  }).strict(),
  BoundarySemanticRefinementCommonV2Schema.extend({
    operation: z.literal("remove_non_architectural_capture_artifact"),
    reviewedClosurePlaneBinding: z.null(),
  }).strict(),
]);

const GrandHallClosedBoundaryMaterialV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_CLOSED_BOUNDARY_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V3),
    reviewPackSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V3),
    humanDecisionsSha256: RuntimeSha256Schema,
    roomMembershipArtifactSha256: RuntimeSha256Schema,
    portalDecisionSchemaVersion: z.literal(GRAND_HALL_PORTAL_DECISIONS_V2),
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    portalInterfaceInventorySha256: RuntimeSha256Schema,
    portalInterfaceIds: z.array(z.string().trim().min(1).max(160))
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    units: z.literal("meters"),
    geometryRole: z.literal("non_rendered_selection_volume"),
    construction: z.literal("extruded_simple_xy_polygon"),
    nonConvex: z.literal(true),
    footprintXY: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(2_048),
    zMin: z.number().finite(),
    zMax: z.number().finite(),
    pointOnBoundaryPolicy: z.literal("include_as_inside"),
    closedVolume: z.literal(true),
    cameraMembershipOnly: z.literal(false),
    rendered: z.literal(false),
    collisionGeometry: z.literal(false),
    exportedAsArchitecture: z.literal(false),
    generatedGeometryCreated: z.literal(false),
    semanticRefinements: z
      .array(BoundarySemanticRefinementV2Schema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    humanReview: AcceptedHumanReviewV3Schema,
  })
  .strict();

type GrandHallClosedBoundaryMaterialV2Object = z.infer<
  typeof GrandHallClosedBoundaryMaterialV2ObjectSchema
>;

function refineClosedBoundaryV2(
  material: GrandHallClosedBoundaryMaterialV2Object,
  ctx: z.RefinementCtx,
): void {
  const legacy = GrandHallClosedBoundaryV1MaterialSchema.safeParse({
    schemaVersion: GRAND_HALL_CLOSED_BOUNDARY_V1,
    venueSlug: material.venueSlug,
    roomSlug: material.roomSlug,
    authority: material.authority,
    productionTrust: material.productionTrust,
    reviewPackSha256: material.reviewPackSha256,
    roomMembershipArtifactSha256: material.roomMembershipArtifactSha256,
    portalDecisionArtifactSha256: material.portalDecisionArtifactSha256,
    portalInterfaceInventorySha256: material.portalInterfaceInventorySha256,
    portalInterfaceIds: material.portalInterfaceIds,
    sourceFrame: material.sourceFrame,
    units: material.units,
    geometryRole: material.geometryRole,
    construction: material.construction,
    nonConvex: material.nonConvex,
    footprintXY: material.footprintXY,
    zMin: material.zMin,
    zMax: material.zMax,
    pointOnBoundaryPolicy: material.pointOnBoundaryPolicy,
    closedVolume: material.closedVolume,
    cameraMembershipOnly: material.cameraMembershipOnly,
    rendered: material.rendered,
    collisionGeometry: material.collisionGeometry,
    exportedAsArchitecture: material.exportedAsArchitecture,
    generatedGeometryCreated: material.generatedGeometryCreated,
    semanticRefinements: material.semanticRefinements.map((refinement) => ({
      interfaceId: refinement.interfaceId,
      operation: refinement.operation,
      evidenceSha256: refinement.evidenceSha256,
      applied: refinement.applied,
      generatedGeometryCreated: refinement.generatedGeometryCreated,
    })),
    humanReview: material.humanReview,
  });
  if (!legacy.success) forwardIssues(legacy.error, ctx);
  material.semanticRefinements.forEach((refinement, index) => {
    if (refinement.evidenceSha256 !== material.humanDecisionsSha256) {
      addIssue(
        ctx,
        ["semanticRefinements", index, "evidenceSha256"],
        "every boundary refinement must bind the exact v3 human decisions",
      );
    }
  });
}

export const GrandHallClosedBoundaryV2MaterialSchema =
  GrandHallClosedBoundaryMaterialV2ObjectSchema.superRefine(refineClosedBoundaryV2);

export type GrandHallClosedBoundaryV2Material = z.infer<
  typeof GrandHallClosedBoundaryV2MaterialSchema
>;

export function computeGrandHallClosedBoundaryV2Sha256(
  material: GrandHallClosedBoundaryV2Material,
): string {
  const parsed = GrandHallClosedBoundaryV2MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_CLOSED_BOUNDARY_V2, parsed);
}

const GrandHallClosedBoundaryV2ObjectSchema = GrandHallClosedBoundaryMaterialV2ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallClosedBoundaryV2Schema =
  GrandHallClosedBoundaryV2ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineClosedBoundaryV2(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_CLOSED_BOUNDARY_V2, material)) {
      addIssue(
        ctx,
        ["artifactSha256"],
        "closed-boundary digest must bind geometry and every concrete closure edge",
      );
    }
  });

export type GrandHallClosedBoundaryV2 = z.infer<
  typeof GrandHallClosedBoundaryV2Schema
>;

function expectedPortalResolutionV3(
  result: GrandHallInterfaceHumanDecisionV3["result"],
): GrandHallPortalDecisionsV2["decisions"][number]["resolution"] | null {
  if (result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") {
    return "close_at_reviewed_grand_hall_plane";
  }
  if (result === "EXCLUDE_BEYOND_INTERFACE") return "exclude_beyond_interface";
  if (result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT") {
    return "not_a_portal_source_topology_artifact";
  }
  return null;
}

function expectedBoundaryOperationV3(
  result: GrandHallInterfaceHumanDecisionV3["result"],
): GrandHallClosedBoundaryV2["semanticRefinements"][number]["operation"] | null {
  if (result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") {
    return "retain_grand_hall_side";
  }
  if (result === "EXCLUDE_BEYOND_INTERFACE") return "exclude_beyond_interface";
  if (result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT") {
    return "remove_non_architectural_capture_artifact";
  }
  return null;
}

function pointOnSegment2dV3(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
  epsilon = 1e-12,
): boolean {
  const cross = (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0]);
  if (Math.abs(cross) > epsilon) return false;
  return point[0] >= Math.min(start[0], end[0]) - epsilon &&
    point[0] <= Math.max(start[0], end[0]) + epsilon &&
    point[1] >= Math.min(start[1], end[1]) - epsilon &&
    point[1] <= Math.max(start[1], end[1]) + epsilon;
}

function pointInSimplePolygonStrictV3(
  point: readonly [number, number],
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    if (pointOnSegment2dV3(point, start, end)) return false;
    const crossesRay = (start[1] > point[1]) !== (end[1] > point[1]);
    if (
      crossesRay &&
      point[0] < (end[0] - start[0]) * (point[1] - start[1]) /
          (end[1] - start[1]) + start[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function hasCanonicalLocalInteriorWitnessV3(
  start: readonly [number, number],
  end: readonly [number, number],
  polygon: readonly (readonly [number, number])[],
): boolean {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return false;
  const midpoint: readonly [number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  const inwardX = -dy / length;
  const inwardY = dx / length;
  for (let exponent = 4; exponent <= 12; exponent += 1) {
    const distance = length * 10 ** -exponent;
    const insideWitness: readonly [number, number] = [
      midpoint[0] + inwardX * distance,
      midpoint[1] + inwardY * distance,
    ];
    const outsideWitness: readonly [number, number] = [
      midpoint[0] - inwardX * distance,
      midpoint[1] - inwardY * distance,
    ];
    if (
      pointInSimplePolygonStrictV3(insideWitness, polygon) &&
      !pointInSimplePolygonStrictV3(outsideWitness, polygon)
    ) return true;
  }
  return false;
}

type GrandHallAcceptedScopeChainV3Object = {
  readonly reviewPack: GrandHallScopeReviewPackV3;
  readonly humanDecisions: GrandHallT554HumanDecisionsV3;
  readonly closedVolumeReview: GrandHallT554ClosedVolumeReviewV1;
  readonly membership: GrandHallRoomMembershipV4;
  readonly portalDecisions: GrandHallPortalDecisionsV2;
  readonly closedBoundary: GrandHallClosedBoundaryV2;
  readonly maskSet: GrandHallPanoramaMaskSetV3;
};

function refineReviewedClosurePlaneBindingV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  decision: GrandHallInterfaceHumanDecisionV3,
  index: number,
  ctx: z.RefinementCtx,
): void {
  if (decision.result !== "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") return;
  const binding = decision.reviewedClosurePlaneBinding;
  const path = [
    "humanDecisions",
    "interfaceDecisions",
    index,
    "reviewedClosurePlaneBinding",
  ] as const;
  const volumeReviewSha256 = validClosedVolumeReviewV1Sha256(
    chain.closedVolumeReview,
  );
  if (
    volumeReviewSha256 === null ||
    binding.closedVolumeReviewSha256 !== volumeReviewSha256 ||
    binding.closedVolumeReviewSha256 !==
      chain.humanDecisions.closedSelectionVolumeDecision.reviewArtifactSha256
  ) {
    addIssue(
      ctx,
      path,
      "reviewed closure plane must bind the exact accepted closed-volume review",
    );
  }
  if (
    binding.interfaceTopologyAtlasManifestSha256 !==
      chain.reviewPack.sourceEvidence.interfaceTopologyAtlasManifestSha256 ||
    binding.sharedSourceVertexSetSha256 !==
      decision.source.sharedSourceVertexSetSha256
  ) {
    addIssue(
      ctx,
      path,
      "reviewed closure plane must bind the exact atlas and source interface vertex set",
    );
  }
  const footprint = chain.closedVolumeReview.footprintXY;
  const start = footprint[binding.footprintEdgeIndex];
  const end = footprint[(binding.footprintEdgeIndex + 1) % footprint.length];
  if (start === undefined || end === undefined) {
    addIssue(
      ctx,
      [...path, "footprintEdgeIndex"],
      "reviewed closure edge must exist in the accepted footprint",
    );
    return;
  }
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) {
    addIssue(
      ctx,
      [...path, "footprintEdgeIndex"],
      "reviewed closure edge must have positive length",
    );
    return;
  }
  // This derives the canonical vertical plane without storing independently
  // editable coefficients. It intentionally makes no global half-space claim:
  // a valid edge of the required non-convex footprint need not be a supporting
  // line for every other footprint vertex.
  const outwardNormalX = dy / length;
  const outwardNormalY = -dx / length;
  const planeOffset = -(outwardNormalX * start[0] + outwardNormalY * start[1]);
  if (
    !Number.isFinite(outwardNormalX) ||
    !Number.isFinite(outwardNormalY) ||
    !Number.isFinite(planeOffset) ||
    !hasCanonicalLocalInteriorWitnessV3(start, end, footprint)
  ) {
    addIssue(
      ctx,
      [...path, "footprintEdgeIndex"],
      "directed closure edge must retain the local polygon interior on its left",
    );
  }
}

function refineAcceptedChainReviewBindingsV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, closedVolumeReview } = chain;
  if (
    humanDecisions.reviewState !== "human_accepted" ||
    humanDecisions.finalDecision !== "ACCEPT" ||
    humanDecisions.reviewer === null ||
    !humanDecisions.nativeResolutionHumanReviewCompleted ||
    humanDecisions.nativeReviewEvidenceSetSha256 === null ||
    humanDecisions.panoramaDecisions.some(
      (decision) =>
        !decision.nativeResolutionHumanReviewCompleted ||
        decision.nativeReviewEvidenceSha256 === null,
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions"],
      "combined v3 chain requires accepted decisions and all 148 native-review receipts",
    );
  }
  if (
    humanDecisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    humanDecisions.sourcePanoramaInventorySha256 !==
      reviewPack.panoramaSourceInventorySha256 ||
    humanDecisions.sourceObservationInventorySha256 !==
      reviewPack.panoramaObservationInventorySha256 ||
    humanDecisions.sourceInterfaceInventorySha256 !== reviewPack.interfaceInventorySha256
  ) {
    addIssue(
      ctx,
      ["humanDecisions"],
      "human decisions must bind the exact v3 review pack and source inventories",
    );
  }
  if (
    !canonicalValuesEqual(
      humanDecisions.panoramaDecisions.map((decision) => ({
        source: decision.source,
        observation: decision.sourceObservation,
      })),
      reviewPack.panoramaRecords.map((record) => ({
        source: record.source,
        observation: record.observation,
      })),
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions", "panoramaDecisions"],
      "human decisions must retain every exact review-pack source and observation",
    );
  }
  if (
    !canonicalValuesEqual(
      humanDecisions.interfaceDecisions.map((decision) => decision.source),
      reviewPack.interfaceCandidates,
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions", "interfaceDecisions"],
      "human interface decisions must equal the review-pack inventory exactly",
    );
  }
  if (
    humanDecisions.matterPakRoomDecision.sourceMembershipV1Sha256 !==
      reviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    humanDecisions.matterPakRoomDecision.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    humanDecisions.cleanupArtifactInspections.some(
      (inspection) =>
        inspection.sourceBoundaryEvidenceSha256 !==
          reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
        inspection.cleanupMarkerEvidenceSha256 !==
          reviewPack.sourceEvidence.cleanupMarkerEvidenceSha256 ||
        inspection.cleanupTargetInventorySha256 !==
          reviewPack.sourceEvidence.cleanupTargetInventorySha256,
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions"],
      "room and cleanup decisions must bind the exact v3 source evidence",
    );
  }
  const volumeDecision = humanDecisions.closedSelectionVolumeDecision;
  const closedVolumeReviewSha256 = validClosedVolumeReviewV1Sha256(
    closedVolumeReview,
  );
  if (
    closedVolumeReviewSha256 === null ||
    closedVolumeReview.reviewPackSha256 !== reviewPack.artifactSha256 ||
    closedVolumeReview.reviewState !== "human_accepted" ||
    closedVolumeReview.finalDecision !== "ACCEPT" ||
    closedVolumeReview.reviewer === null ||
    volumeDecision.result !== "ACCEPT_NON_RENDERED_SELECTION_VOLUME" ||
    volumeDecision.reviewArtifactSha256 !==
      closedVolumeReviewSha256
  ) {
    addIssue(
      ctx,
      ["closedVolumeReview"],
      "combined chain requires the exact accepted closed-volume review",
    );
  }
}

function refineAcceptedChainMembershipV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership } = chain;
  const decisionsSha256 = canonicalHumanDecisionsV3Sha256(humanDecisions);
  if (
    membership.reviewPackSha256 !== reviewPack.artifactSha256 ||
    membership.humanDecisionsSha256 !== decisionsSha256 ||
    membership.nativeReviewEvidenceSetSha256 !==
      humanDecisions.nativeReviewEvidenceSetSha256 ||
    membership.sourceMembershipV1Sha256 !==
      reviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    membership.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    membership.sourcePanoramaInventorySha256 !==
      reviewPack.panoramaSourceInventorySha256 ||
    membership.sourceObservationInventorySha256 !==
      reviewPack.panoramaObservationInventorySha256
  ) {
    addIssue(
      ctx,
      ["membership"],
      "membership must bind the exact accepted v3 decisions and review evidence",
    );
  }
  membership.panoramaRecords.forEach((record, index) => {
    const decision = humanDecisions.panoramaDecisions[index];
    if (decision === undefined || !canonicalValuesEqual(record.source, decision.source)) {
      addIssue(ctx, ["membership", "panoramaRecords", index], "membership source drift");
      return;
    }
    const expectedDisposition = decision.result === "INCLUDE"
      ? "include_with_binary_pixel_mask"
      : "exclude_whole_frame";
    const expectedClassification = decision.result === "INCLUDE"
      ? decision.classification
      : "no_observed_grand_hall_pixels";
    if (
      record.decision.disposition !== expectedDisposition ||
      record.decision.classification !== expectedClassification ||
      record.nativeReviewEvidenceSha256 !== decision.nativeReviewEvidenceSha256
    ) {
      addIssue(
        ctx,
        ["membership", "panoramaRecords", index],
        "membership must realize the exact decision and native-review receipt",
      );
    }
  });
}

function refineAcceptedChainInterfacesV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership, portalDecisions, closedBoundary } = chain;
  const decisionsSha256 = canonicalHumanDecisionsV3Sha256(humanDecisions);
  if (
    portalDecisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    portalDecisions.humanDecisionsSha256 !== decisionsSha256 ||
    portalDecisions.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    portalDecisions.interfaceInventorySha256 !== reviewPack.interfaceInventorySha256 ||
    !canonicalValuesEqual(portalDecisions.interfaceCandidates, reviewPack.interfaceCandidates)
  ) {
    addIssue(
      ctx,
      ["portalDecisions"],
      "portal artifact must bind the exact v3 interface inventory and evidence",
    );
  }
  portalDecisions.decisions.forEach((decision, index) => {
    const humanDecision = humanDecisions.interfaceDecisions[index];
    if (
      humanDecision === undefined ||
      decision.interfaceId !== humanDecision.source.interfaceId ||
      decision.resolution !== expectedPortalResolutionV3(humanDecision.result) ||
      decision.grandHallSideEvidenceSha256 !== decisionsSha256 ||
      decision.decisionNote !== humanDecision.note ||
      !canonicalValuesEqual(
        decision.reviewedClosurePlaneBinding,
        humanDecision.reviewedClosurePlaneBinding,
      )
    ) {
      addIssue(
        ctx,
        ["portalDecisions", "decisions", index],
        "portal decision must exactly realize the corresponding v3 human decision",
      );
    }
    if (humanDecision !== undefined) {
      refineReviewedClosurePlaneBindingV3(chain, humanDecision, index, ctx);
    }
  });
  if (
    closedBoundary.reviewPackSha256 !== reviewPack.artifactSha256 ||
    closedBoundary.humanDecisionsSha256 !== decisionsSha256 ||
    closedBoundary.roomMembershipArtifactSha256 !== membership.artifactSha256 ||
    closedBoundary.portalDecisionArtifactSha256 !== portalDecisions.artifactSha256 ||
    closedBoundary.portalInterfaceInventorySha256 !== reviewPack.interfaceInventorySha256 ||
    !canonicalValuesEqual(
      closedBoundary.portalInterfaceIds,
      reviewPack.interfaceCandidates.map((candidate) => candidate.interfaceId),
    )
  ) {
    addIssue(
      ctx,
      ["closedBoundary"],
      "closed boundary must bind membership, portals, and every reviewed interface",
    );
  }
  closedBoundary.semanticRefinements.forEach((refinement, index) => {
    const humanDecision = humanDecisions.interfaceDecisions[index];
    if (
      humanDecision === undefined ||
      refinement.interfaceId !== humanDecision.source.interfaceId ||
      refinement.operation !== expectedBoundaryOperationV3(humanDecision.result) ||
      refinement.evidenceSha256 !== decisionsSha256 ||
      !canonicalValuesEqual(
        refinement.reviewedClosurePlaneBinding,
        humanDecision.reviewedClosurePlaneBinding,
      )
    ) {
      addIssue(
        ctx,
        ["closedBoundary", "semanticRefinements", index],
        "boundary refinement must exactly realize its v3 human decision",
      );
    }
  });
}

function refineAcceptedChainVolumeGeometryV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const { closedVolumeReview: review, closedBoundary: boundary } = chain;
  const reviewGeometry = {
    sourceFrame: review.sourceFrame,
    units: review.units,
    geometryRole: review.geometryRole,
    construction: review.construction,
    footprintXY: review.footprintXY,
    zMin: review.zMin,
    zMax: review.zMax,
    rendered: review.rendered,
    collisionGeometry: review.collisionGeometry,
    exportedAsArchitecture: review.exportedAsArchitecture,
    generatedGeometryCreated: review.generatedGeometryCreated,
  };
  const boundaryGeometry = {
    sourceFrame: boundary.sourceFrame,
    units: boundary.units,
    geometryRole: boundary.geometryRole,
    construction: boundary.construction,
    footprintXY: boundary.footprintXY,
    zMin: boundary.zMin,
    zMax: boundary.zMax,
    rendered: boundary.rendered,
    collisionGeometry: boundary.collisionGeometry,
    exportedAsArchitecture: boundary.exportedAsArchitecture,
    generatedGeometryCreated: boundary.generatedGeometryCreated,
  };
  if (!canonicalValuesEqual(reviewGeometry, boundaryGeometry)) {
    addIssue(
      ctx,
      ["closedBoundary"],
      "closed-boundary geometry must equal the accepted closed-volume review",
    );
  }
}

function refineAcceptedChainMasksV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership, portalDecisions, maskSet } = chain;
  if (
    maskSet.reviewPackSha256 !== reviewPack.artifactSha256 ||
    maskSet.membershipArtifactSha256 !== membership.artifactSha256 ||
    maskSet.humanDecisionsSha256 !== membership.humanDecisionsSha256 ||
    maskSet.nativeReviewEvidenceSetSha256 !==
      humanDecisions.nativeReviewEvidenceSetSha256 ||
    maskSet.portalDecisionArtifactSha256 !== portalDecisions.artifactSha256 ||
    maskSet.sourcePanoramaInventorySha256 !==
      reviewPack.panoramaSourceInventorySha256 ||
    maskSet.sourceObservationInventorySha256 !==
      reviewPack.panoramaObservationInventorySha256
  ) {
    addIssue(
      ctx,
      ["maskSet"],
      "mask set must bind the review, decisions, membership, portals, and native evidence",
    );
  }
  maskSet.sourceRecords.forEach((record, index) => {
    const decision = humanDecisions.panoramaDecisions[index];
    const membershipRecord = membership.panoramaRecords[index];
    if (
      decision === undefined ||
      membershipRecord === undefined ||
      !canonicalValuesEqual(record.source, decision.source) ||
      !canonicalValuesEqual(record.source, membershipRecord.source) ||
      record.nativeReviewEvidenceSha256 !== decision.nativeReviewEvidenceSha256
    ) {
      addIssue(ctx, ["maskSet", "sourceRecords", index], "mask-set source or review drift");
      return;
    }
    if (decision.result === "INCLUDE") {
      const reviewed = decision.reviewedMaskBinding;
      if (
        record.disposition !== "include_with_binary_pixel_mask" ||
        membershipRecord.decision.disposition !== "include_with_binary_pixel_mask" ||
        reviewed === null ||
        record.mask.fileName !== decision.maskFileName ||
        record.mask.sha256 !== reviewed.sha256 ||
        record.mask.byteLength !== reviewed.byteLength ||
        record.mask.includedPixelCount !== reviewed.includedPixelCount ||
        record.mask.excludedPixelCount !== reviewed.excludedPixelCount ||
        !canonicalValuesEqual(record.mask.reasonCodes, decision.maskReasonCodes)
      ) {
        addIssue(
          ctx,
          ["maskSet", "sourceRecords", index],
          "included mask must realize its human-reviewed source-grid binding",
        );
      }
      return;
    }
    if (
      record.disposition !== "exclude_whole_frame" ||
      membershipRecord.decision.disposition !== "exclude_whole_frame"
    ) {
      addIssue(
        ctx,
        ["maskSet", "sourceRecords", index],
        "whole-frame exclusion must agree across every accepted artifact",
      );
    }
  });
}

function refineAcceptedChainReviewersV3(
  chain: GrandHallAcceptedScopeChainV3Object,
  ctx: z.RefinementCtx,
): void {
  const decisionsReviewer = chain.humanDecisions.reviewer;
  const volumeReviewer = chain.closedVolumeReview.reviewer;
  if (
    decisionsReviewer === null ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.membership.humanReview,
    ) ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.portalDecisions.humanReview,
    ) ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.maskSet.humanReview,
    )
  ) {
    addIssue(
      ctx,
      [],
      "membership, portal, and mask artifacts must bind the v3 reviewer exactly",
    );
  }
  if (
    volumeReviewer === null ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...volumeReviewer },
      chain.closedBoundary.humanReview,
    )
  ) {
    addIssue(ctx, [], "closed boundary must bind the volume reviewer exactly");
  }
}

const GrandHallAcceptedScopeChainV3ObjectSchema = z
  .object({
    reviewPack: GrandHallScopeReviewPackV3Schema,
    humanDecisions: GrandHallT554HumanDecisionsV3Schema,
    closedVolumeReview: GrandHallT554ClosedVolumeReviewV1Schema,
    membership: GrandHallRoomMembershipV4Schema,
    portalDecisions: GrandHallPortalDecisionsV2Schema,
    closedBoundary: GrandHallClosedBoundaryV2Schema,
    maskSet: GrandHallPanoramaMaskSetV3Schema,
  })
  .strict();

export const GrandHallAcceptedScopeChainV3Schema =
  GrandHallAcceptedScopeChainV3ObjectSchema.superRefine((chain, ctx) => {
    refineAcceptedChainReviewBindingsV3(chain, ctx);
    refineAcceptedChainMembershipV3(chain, ctx);
    refineAcceptedChainInterfacesV3(chain, ctx);
    refineAcceptedChainVolumeGeometryV3(chain, ctx);
    refineAcceptedChainMasksV3(chain, ctx);
    refineAcceptedChainReviewersV3(chain, ctx);
  });

export type GrandHallAcceptedScopeChainV3 = z.infer<
  typeof GrandHallAcceptedScopeChainV3Schema
>;

export function verifyGrandHallAcceptedScopeChainV3(
  input: unknown,
): GrandHallAcceptedScopeChainV3 {
  return GrandHallAcceptedScopeChainV3Schema.parse(input);
}

import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  RuntimeControlFeatureClassSchema,
} from "./runtime-control-evidence.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

/**
 * Deferred T-557 authority-none intake contract. It can bind later human
 * nominations and exact OBJ anchors, but it is not an accepted transform,
 * solver result, output-inventory mask, or runtime-admission artifact.
 */

export const GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1 =
  "venviewer.grand-hall-arf-cvf-coordinate-pair-intake.v1";
export const GRAND_HALL_COORDINATE_PAIR_Q9_DENOMINATOR = 1_000_000_000;
// At this bound binary64 spacing stays well below one half of a Q9 metre,
// so every accepted nine-decimal coordinate has one unambiguous Q9 integer.
export const GRAND_HALL_COORDINATE_PAIR_MAX_ABS_METRES = 1_000_000;
export const GRAND_HALL_COORDINATE_PAIR_MINIMUM_FIT_COUNT = 8;
export const GRAND_HALL_COORDINATE_PAIR_MINIMUM_HELD_OUT_COUNT = 6;

export const GRAND_HALL_COORDINATE_PAIR_INTAKE_STATES = [
  "nomination_only",
  "coordinates_recorded",
  "human_review_complete",
  "rejected",
] as const;

export const GRAND_HALL_CONTROL_DISTRIBUTION_TAGS = [
  "floor",
  "wall",
  "high_detail",
  "room_depth",
] as const;

const SafeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const SafeLabelSchema = z.string().trim().min(1).max(240);
const IsoInstantSchema = z.string().datetime({ offset: true });
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ObjGroupNameSchema = z.string().trim().min(1).max(240).regex(/^[^\s\\/]+$/u);

function canonicalDigest(domain: string, value: unknown): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function quantizeQ9(value: number): number {
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? 0 : rounded;
}

const Q9ScalarSchema = z
  .number()
  .finite()
  .min(-GRAND_HALL_COORDINATE_PAIR_MAX_ABS_METRES)
  .max(GRAND_HALL_COORDINATE_PAIR_MAX_ABS_METRES)
  .refine(
    (value) => !Object.is(value, -0) && quantizeQ9(value) === value,
    "coordinate-pair scalar must already be canonical Q9 and cannot be negative zero",
  );

export const GrandHallCoordinatePairQ9Vec3Schema = z.tuple([
  Q9ScalarSchema,
  Q9ScalarSchema,
  Q9ScalarSchema,
]);
export type GrandHallCoordinatePairQ9Vec3 = z.infer<
  typeof GrandHallCoordinatePairQ9Vec3Schema
>;

const ExactFileIdentitySchema = z
  .object({
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
  })
  .strict();

const ExactBoundsSchema = z
  .object({
    min: GrandHallCoordinatePairQ9Vec3Schema,
    max: GrandHallCoordinatePairQ9Vec3Schema,
  })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      if (bounds.min[axis] > bounds.max[axis]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max", axis],
          message: "OBJ bounds cannot have max below min",
        });
      }
    }
  });

export const GrandHallCoordinatePairExactObjIdentitySchema = ExactFileIdentitySchema.extend({
  vertexRecordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  faceRecordCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  bounds: ExactBoundsSchema,
}).strict();
export type GrandHallCoordinatePairExactObjIdentity = z.infer<
  typeof GrandHallCoordinatePairExactObjIdentitySchema
>;

const SourceBindingsSchema = z
  .object({
    frame: z.literal("ARF"),
    coordinateConvention: z.literal("xgrids_big_obj_native_source_z_up"),
    metricAuthority: z.literal(false),
    rawXgridsReceiptSha256: RuntimeSha256Schema,
    rawXgridsInventorySha256: RuntimeSha256Schema,
    rawXgridsXbinSha256: RuntimeSha256Schema,
    processedBigModelGuid: z.string().regex(/^[a-f0-9]{32}$/u),
    processedBigInventorySha256: RuntimeSha256Schema,
    historicalSogCoreInventorySha256: RuntimeSha256Schema,
    historicalSogManifestSha256: RuntimeSha256Schema,
    historicalFrontierReceiptSha256: RuntimeSha256Schema,
    exactAcceptedOutputInventorySha256: z.null(),
    bigObj: GrandHallCoordinatePairExactObjIdentitySchema,
  })
  .strict();

const Room9BindingSchema = z
  .object({
    groupIndex: z.literal(1),
    subIndex: z.literal(9),
    exactObjGroupSuffix: z.literal("_group001_sub009"),
    faceCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    evidenceFaceOrdinalsSha256: RuntimeSha256Schema,
    verifiedFaceOrdinalInventorySha256: RuntimeSha256Schema,
    sharedVertexCount: SafeCountSchema,
    sharedVertexInventorySha256: RuntimeSha256Schema,
    interfaceFaceCount: SafeCountSchema,
    interfaceFaceOrdinalInventorySha256: RuntimeSha256Schema,
  })
  .strict();

const TargetBindingsSchema = z
  .object({
    frame: z.literal("CVF"),
    coordinateConvention: z.literal("matterpak_local_metres_right_handed_z_up"),
    crosswalkAuthority: z.literal("diagnostic_only"),
    metricControlAuthority: z.literal(false),
    matterPakE57ReceiptSha256: RuntimeSha256Schema,
    boundaryEvidenceSha256: RuntimeSha256Schema,
    boundaryManifestSha256: RuntimeSha256Schema,
    interfaceAtlasSha256: RuntimeSha256Schema,
    scopeReviewPackSha256: RuntimeSha256Schema,
    matterPakObj: GrandHallCoordinatePairExactObjIdentitySchema,
    room9: Room9BindingSchema,
    e57: ExactFileIdentitySchema.extend({
      rootGuid: z.string().regex(/^[a-f0-9]{32}$/u),
      scanCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      data3DGuidSha256: RuntimeSha256Schema,
      poseSha256: RuntimeSha256Schema,
      coordinateConvention: z.literal(
        "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
      ),
    }).strict(),
    e57PointSupport: z.null(),
  })
  .strict();

const NominationSeedSchema = z
  .object({
    authority: z.literal("none"),
    seedArtifactSha256: RuntimeSha256Schema,
    implementationSha256: RuntimeSha256Schema,
    configurationSha256: RuntimeSha256Schema,
    sourceSelectionInventorySha256: RuntimeSha256Schema,
    targetSelectionInventorySha256: RuntimeSha256Schema,
    sourceSelectionCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    targetSelectionCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.literal("mutual_nearest_neighbor_point_to_point_icp"),
    permittedUse: z.literal("review_overlay_candidate_nomination_only"),
    matrixStoredOnlyInSeedArtifact: z.literal(true),
    matrixUsedAsMeasurement: z.literal(false),
    matrixUsedAsSolverInput: z.literal(false),
  })
  .strict();

const EvidenceRefSchema = z
  .object({
    role: z.enum(["source_view", "target_view", "overlay", "measurement_record"]),
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    mimeType: z.enum(["image/png", "image/jpeg", "application/json"]),
  })
  .strict()
  .superRefine((reference, ctx) => {
    const isMeasurement = reference.role === "measurement_record";
    if (isMeasurement !== (reference.mimeType === "application/json")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: isMeasurement
          ? "measurement records must be application/json"
          : "visual evidence must be image/png or image/jpeg",
      });
    }
  });

const NominationSchema = z
  .object({
    nominationId: SafeIdSchema,
    status: z.literal("candidate_visible_only"),
    label: SafeLabelSchema,
    featureClass: RuntimeControlFeatureClassSchema,
    seedRank: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    evidenceRefs: z.array(EvidenceRefSchema).min(2).max(16),
  })
  .strict()
  .superRefine((nomination, ctx) => {
    const roles = new Set(nomination.evidenceRefs.map((reference) => reference.role));
    if (!roles.has("source_view") || !roles.has("target_view")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "visible-only nominations require separate source and target visual evidence",
      });
    }
    if (roles.has("measurement_record")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "visible-only nominations cannot carry measurement records",
      });
    }
    const refKeys = nomination.evidenceRefs.map((reference) => `${reference.role}\n${reference.sha256}`);
    if (new Set(refKeys).size !== refKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "visible-only nomination evidence references must be unique by role and digest",
      });
    }
    const sourceDigests = new Set(
      nomination.evidenceRefs
        .filter((reference) => reference.role === "source_view")
        .map((reference) => reference.sha256),
    );
    if (
      nomination.evidenceRefs.some(
        (reference) => reference.role === "target_view" && sourceDigests.has(reference.sha256),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "source and target views must bind distinct visual evidence bytes",
      });
    }
  });

const BarycentricWeightsQ9Schema = z
  .tuple([
    z.number().int().min(0).max(GRAND_HALL_COORDINATE_PAIR_Q9_DENOMINATOR),
    z.number().int().min(0).max(GRAND_HALL_COORDINATE_PAIR_Q9_DENOMINATOR),
    z.number().int().min(0).max(GRAND_HALL_COORDINATE_PAIR_Q9_DENOMINATOR),
  ])
  .superRefine((weights, ctx) => {
    if (weights[0] + weights[1] + weights[2] !== GRAND_HALL_COORDINATE_PAIR_Q9_DENOMINATOR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Q9 barycentric weights must sum exactly to 1,000,000,000",
      });
    }
  });

export const GrandHallCoordinatePairObjAnchorV1Schema = z
  .object({
    objSha256: RuntimeSha256Schema,
    sourceFaceOrdinal0Based: SafeCountSchema,
    resolvedVertexIndices0Based: z.tuple([SafeCountSchema, SafeCountSchema, SafeCountSchema]),
    vertexPositionsQ9: z.tuple([
      GrandHallCoordinatePairQ9Vec3Schema,
      GrandHallCoordinatePairQ9Vec3Schema,
      GrandHallCoordinatePairQ9Vec3Schema,
    ]),
    barycentricWeightsQ9: BarycentricWeightsQ9Schema,
    positionQ9: GrandHallCoordinatePairQ9Vec3Schema,
    expectedGroupName: ObjGroupNameSchema.nullable(),
    expectedMaterialName: ObjGroupNameSchema.nullable(),
  })
  .strict()
  .superRefine((anchor, ctx) => {
    if (new Set(anchor.resolvedVertexIndices0Based).size !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedVertexIndices0Based"],
        message: "an OBJ triangle anchor cannot repeat a resolved vertex index",
      });
    }
  });
export type GrandHallCoordinatePairObjAnchorV1 = z.infer<
  typeof GrandHallCoordinatePairObjAnchorV1Schema
>;

const DistributionTagSchema = z.enum(GRAND_HALL_CONTROL_DISTRIBUTION_TAGS);

const CoordinatePairSchema = z
  .object({
    pairId: SafeIdSchema,
    nominationId: SafeIdSchema,
    label: SafeLabelSchema,
    featureClass: RuntimeControlFeatureClassSchema,
    splitRole: z.enum(["fit", "held_out"]),
    distributionTags: z.array(DistributionTagSchema).min(1).max(
      GRAND_HALL_CONTROL_DISTRIBUTION_TAGS.length,
    ),
    sourcePoint: z
      .object({
        frame: z.literal("ARF"),
        anchor: GrandHallCoordinatePairObjAnchorV1Schema,
      })
      .strict(),
    targetPoint: z
      .object({
        frame: z.literal("CVF"),
        anchor: GrandHallCoordinatePairObjAnchorV1Schema,
        e57PointSupport: z.null(),
      })
      .strict(),
    recordedAt: IsoInstantSchema,
    recordedBy: z.string().trim().min(1).max(160),
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(32),
    note: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((pair, ctx) => {
    const tags = pair.distributionTags;
    if (new Set(tags).size !== tags.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionTags"],
        message: "control distribution tags must be unique",
      });
    }
    const actualOrder = tags.map((tag) => GRAND_HALL_CONTROL_DISTRIBUTION_TAGS.indexOf(tag));
    if (actualOrder.some((value, index) => index > 0 && value <= (actualOrder[index - 1] ?? -1))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionTags"],
        message: "control distribution tags must use canonical declared order",
      });
    }
  });

const SplitMaterialSchema = z
  .object({
    frozenBeforeSolve: z.literal(true),
    fitPairIds: z.array(SafeIdSchema),
    heldOutPairIds: z.array(SafeIdSchema),
  })
  .strict();

export function computeGrandHallCoordinatePairSplitSha256(
  split: z.input<typeof SplitMaterialSchema>,
): `sha256:${string}` {
  const parsed = SplitMaterialSchema.parse(split);
  return canonicalDigest("venviewer.grand-hall-coordinate-pair-split.v1", parsed);
}

const SplitSchema = SplitMaterialSchema.extend({
  splitSha256: RuntimeSha256Schema,
}).strict();

const HumanReviewSchema = z
  .object({
    state: z.literal("human_review_complete"),
    reviewerType: z.literal("human"),
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.enum(["survey_or_registration_reviewer", "venue_owner_or_authorized_domain_reviewer"]),
    decision: z.literal("accept_all_recorded_pairs_for_diagnostic_fit_only"),
    reviewedAt: IsoInstantSchema,
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(32),
    note: z.string().trim().min(1).max(1_000),
  })
  .strict();

const RejectionSchema = z
  .object({
    state: z.literal("rejected"),
    reviewerType: z.literal("human"),
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.string().trim().min(1).max(120),
    rejectedAt: IsoInstantSchema,
    reason: z.string().trim().min(1).max(1_000),
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(32),
  })
  .strict();

const GuardrailsSchema = z
  .object({
    sourceBytesMutated: z.literal(false),
    targetBytesMutated: z.literal(false),
    coordinatesGenerated: z.literal(false),
    candidateLandmarksGenerated: z.literal(false),
    icpPromoted: z.literal(false),
    icpMatrixUsedAsMeasurement: z.literal(false),
    icpMatrixUsedAsSolverInput: z.literal(false),
    solverOutputCreated: z.literal(false),
    transformArtifactCreated: z.literal(false),
    e57PointAuthorityClaimed: z.literal(false),
    operationalGeometryCreated: z.literal(false),
    runtimeAuthorityGranted: z.literal(false),
    publicExposureChanged: z.literal(false),
  })
  .strict();

export function computeGrandHallCoordinatePairNominationInventorySha256(
  nominations: readonly z.input<typeof NominationSchema>[],
): `sha256:${string}` {
  const parsed = z.array(NominationSchema).parse(nominations);
  return canonicalDigest("venviewer.grand-hall-coordinate-pair-nomination-inventory.v1", parsed);
}

export function computeGrandHallCoordinatePairInventorySha256(
  pairs: readonly z.input<typeof CoordinatePairSchema>[],
): `sha256:${string}` {
  const parsed = z.array(CoordinatePairSchema).parse(pairs);
  return canonicalDigest("venviewer.grand-hall-coordinate-pair-inventory.v1", parsed);
}

export function computeGrandHallRoom9FaceOrdinalInventorySha256(
  faceOrdinals: readonly number[],
): `sha256:${string}` {
  const parsed = z.array(SafeCountSchema).parse(faceOrdinals);
  return canonicalDigest("venviewer.grand-hall-room9-face-ordinal-inventory.v1", parsed);
}

export function computeGrandHallRoom9SharedVertexInventorySha256(
  vertexIndices: readonly number[],
): `sha256:${string}` {
  const parsed = z.array(SafeCountSchema).parse(vertexIndices);
  return canonicalDigest("venviewer.grand-hall-room9-shared-vertex-inventory.v1", parsed);
}

export function computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256(
  faceOrdinals: readonly number[],
): `sha256:${string}` {
  const parsed = z.array(SafeCountSchema).parse(faceOrdinals);
  return canonicalDigest("venviewer.grand-hall-room9-interface-face-ordinal-inventory.v1", parsed);
}

function isStrictlySortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? ""));
}

function anchorKey(anchor: GrandHallCoordinatePairObjAnchorV1): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse({
    objSha256: anchor.objSha256,
    sourceFaceOrdinal0Based: anchor.sourceFaceOrdinal0Based,
    barycentricWeightsQ9: anchor.barycentricWeightsQ9,
  }));
}

function hasNonCoplanarControlTetrahedron(
  points: readonly GrandHallCoordinatePairQ9Vec3[],
): boolean {
  const epsilon = 1e-9;
  for (let first = 0; first < points.length - 3; first += 1) {
    const a = points[first];
    if (a === undefined) continue;
    for (let second = first + 1; second < points.length - 2; second += 1) {
      const b = points[second];
      if (b === undefined) continue;
      for (let third = second + 1; third < points.length - 1; third += 1) {
        const c = points[third];
        if (c === undefined) continue;
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        const crossX = uy * vz - uz * vy;
        const crossY = uz * vx - ux * vz;
        const crossZ = ux * vy - uy * vx;
        for (let fourth = third + 1; fourth < points.length; fourth += 1) {
          const d = points[fourth];
          if (d === undefined) continue;
          const wx = d[0] - a[0];
          const wy = d[1] - a[1];
          const wz = d[2] - a[2];
          const volume6 = Math.abs(crossX * wx + crossY * wy + crossZ * wz);
          const scale = Math.max(
            Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) * Math.hypot(wx, wy, wz),
            1,
          );
          if (volume6 > epsilon * scale) return true;
        }
      }
    }
  }
  return false;
}

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

const GrandHallCoordinatePairIntakeMaterialObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1),
    packetId: SafeIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    predecessorArtifactSha256: RuntimeSha256Schema.nullable(),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("none"),
    productionTrust: z.null(),
    sourceBindings: SourceBindingsSchema,
    targetBindings: TargetBindingsSchema,
    nominationSeed: NominationSeedSchema,
    state: z.enum(GRAND_HALL_COORDINATE_PAIR_INTAKE_STATES),
    nominations: z.array(NominationSchema).max(256),
    nominationInventorySha256: RuntimeSha256Schema,
    coordinatePairs: z.array(CoordinatePairSchema).max(256),
    coordinatePairInventorySha256: RuntimeSha256Schema,
    split: SplitSchema.nullable(),
    humanReview: HumanReviewSchema.nullable(),
    rejection: RejectionSchema.nullable(),
    guardrails: GuardrailsSchema,
  })
  .strict();

type GrandHallCoordinatePairIntakeMaterialObject = z.infer<
  typeof GrandHallCoordinatePairIntakeMaterialObjectSchema
>;

function refineIntake(
  intake: GrandHallCoordinatePairIntakeMaterialObject,
  ctx: z.RefinementCtx,
): void {
  if ((intake.revision === 1) !== (intake.predecessorArtifactSha256 === null)) {
    addIssue(
      ctx,
      ["predecessorArtifactSha256"],
      "revision 1 must have no predecessor and every later revision must bind one",
    );
  }
  if (intake.revision === 1 && intake.state !== "nomination_only") {
    addIssue(ctx, ["state"], "revision 1 must be the coordinate-free nomination-only root");
  }

  const nominationIds = intake.nominations.map((nomination) => nomination.nominationId);
  if (!isStrictlySortedUnique(nominationIds)) {
    addIssue(ctx, ["nominations"], "nominations must be unique and sorted by nominationId");
  }
  if (new Set(intake.nominations.map((nomination) => nomination.seedRank)).size !== intake.nominations.length) {
    addIssue(ctx, ["nominations"], "nomination seed ranks must be unique within one frozen seed result");
  }
  if (
    intake.nominationInventorySha256 !==
    canonicalDigest("venviewer.grand-hall-coordinate-pair-nomination-inventory.v1", intake.nominations)
  ) {
    addIssue(ctx, ["nominationInventorySha256"], "nomination inventory digest does not match exact nominations");
  }

  const pairIds = intake.coordinatePairs.map((pair) => pair.pairId);
  if (!isStrictlySortedUnique(pairIds)) {
    addIssue(ctx, ["coordinatePairs"], "coordinate pairs must be unique and sorted by pairId");
  }
  if (
    intake.coordinatePairInventorySha256 !==
    canonicalDigest("venviewer.grand-hall-coordinate-pair-inventory.v1", intake.coordinatePairs)
  ) {
    addIssue(ctx, ["coordinatePairInventorySha256"], "coordinate-pair inventory digest does not match exact pairs");
  }

  const nominationById = new Map(intake.nominations.map((nomination) => [nomination.nominationId, nomination]));
  const usedNominationIds = new Set<string>();
  const sourceAnchorKeys = new Set<string>();
  const targetAnchorKeys = new Set<string>();
  for (const [index, pair] of intake.coordinatePairs.entries()) {
    const nomination = nominationById.get(pair.nominationId);
    if (nomination === undefined) {
      addIssue(ctx, ["coordinatePairs", index, "nominationId"], "coordinate pair must bind an exact visible-only nomination");
    } else if (nomination.featureClass !== pair.featureClass || nomination.label !== pair.label) {
      addIssue(ctx, ["coordinatePairs", index], "coordinate pair label and feature class must equal its frozen nomination");
    }
    if (usedNominationIds.has(pair.nominationId)) {
      addIssue(ctx, ["coordinatePairs", index, "nominationId"], "one nomination cannot produce multiple coordinate pairs");
    }
    usedNominationIds.add(pair.nominationId);

    if (pair.sourcePoint.anchor.objSha256 !== intake.sourceBindings.bigObj.sha256) {
      addIssue(ctx, ["coordinatePairs", index, "sourcePoint", "anchor", "objSha256"], "source anchor must bind the exact BIG OBJ");
    }
    if (pair.targetPoint.anchor.objSha256 !== intake.targetBindings.matterPakObj.sha256) {
      addIssue(ctx, ["coordinatePairs", index, "targetPoint", "anchor", "objSha256"], "target anchor must bind the exact MatterPak OBJ");
    }
    const targetGroup = pair.targetPoint.anchor.expectedGroupName;
    if (targetGroup === null || !targetGroup.endsWith(intake.targetBindings.room9.exactObjGroupSuffix)) {
      addIssue(ctx, ["coordinatePairs", index, "targetPoint", "anchor", "expectedGroupName"], "target anchor must name an exact MatterPak room-9 group");
    }

    const sourceKey = anchorKey(pair.sourcePoint.anchor);
    const targetKey = anchorKey(pair.targetPoint.anchor);
    if (sourceAnchorKeys.has(sourceKey)) {
      addIssue(ctx, ["coordinatePairs", index, "sourcePoint"], "source anchors cannot be reused across fit or held-out controls");
    }
    if (targetAnchorKeys.has(targetKey)) {
      addIssue(ctx, ["coordinatePairs", index, "targetPoint"], "target anchors cannot be reused across fit or held-out controls");
    }
    sourceAnchorKeys.add(sourceKey);
    targetAnchorKeys.add(targetKey);
  }

  if (intake.state === "nomination_only") {
    if (intake.coordinatePairs.length !== 0 || intake.split !== null || intake.humanReview !== null) {
      addIssue(ctx, ["state"], "nomination-only packets cannot carry anchors, coordinates, split, or human coordinate review");
    }
    if (intake.rejection !== null) {
      addIssue(ctx, ["rejection"], "nomination-only packets cannot carry a rejection record");
    }
    return;
  }

  if (intake.state === "rejected") {
    if (intake.rejection === null) {
      addIssue(ctx, ["rejection"], "rejected packets require an exact human rejection record");
    }
    if (intake.humanReview !== null) {
      addIssue(ctx, ["humanReview"], "rejected packets cannot also claim completed acceptance review");
    }
    if (intake.coordinatePairs.length === 0) {
      if (intake.split !== null) {
        addIssue(ctx, ["split"], "rejection before coordinate collection cannot carry a split");
      }
      return;
    }
  } else if (intake.rejection !== null) {
    addIssue(ctx, ["rejection"], "non-rejected packets cannot carry a rejection record");
  }
  if (intake.coordinatePairs.length === 0 || intake.split === null) {
    addIssue(ctx, ["coordinatePairs"], "recorded-coordinate packets require a frozen, non-empty fit/held-out split");
    return;
  }

  const fitPairs = intake.coordinatePairs.filter((pair) => pair.splitRole === "fit");
  const heldOutPairs = intake.coordinatePairs.filter((pair) => pair.splitRole === "held_out");
  if (fitPairs.length < GRAND_HALL_COORDINATE_PAIR_MINIMUM_FIT_COUNT) {
    addIssue(ctx, ["coordinatePairs"], "coordinate intake requires at least eight fit controls");
  }
  if (heldOutPairs.length < GRAND_HALL_COORDINATE_PAIR_MINIMUM_HELD_OUT_COUNT) {
    addIssue(ctx, ["coordinatePairs"], "coordinate intake requires at least six held-out controls");
  }

  const expectedFitIds = fitPairs.map((pair) => pair.pairId);
  const expectedHeldOutIds = heldOutPairs.map((pair) => pair.pairId);
  if (
    !isStrictlySortedUnique(intake.split.fitPairIds) ||
    !isStrictlySortedUnique(intake.split.heldOutPairIds) ||
    stableCanonicalJson(CanonicalJsonValueSchema.parse(intake.split.fitPairIds)) !==
      stableCanonicalJson(CanonicalJsonValueSchema.parse(expectedFitIds)) ||
    stableCanonicalJson(CanonicalJsonValueSchema.parse(intake.split.heldOutPairIds)) !==
      stableCanonicalJson(CanonicalJsonValueSchema.parse(expectedHeldOutIds))
  ) {
    addIssue(ctx, ["split"], "frozen split ids must be the exact canonical partition of coordinate pairs");
  }
  const { splitSha256, ...splitMaterial } = intake.split;
  if (
    splitSha256 !==
    canonicalDigest("venviewer.grand-hall-coordinate-pair-split.v1", splitMaterial)
  ) {
    addIssue(ctx, ["split", "splitSha256"], "split digest does not bind the exact fit/held-out partition");
  }

  for (const [role, pairs] of [["fit", fitPairs], ["held_out", heldOutPairs]] as const) {
    const tags = new Set(pairs.flatMap((pair) => pair.distributionTags));
    for (const requiredTag of GRAND_HALL_CONTROL_DISTRIBUTION_TAGS) {
      if (!tags.has(requiredTag)) {
        addIssue(ctx, ["coordinatePairs"], `${role} controls must include ${requiredTag} distribution evidence`);
      }
    }
    if (!hasNonCoplanarControlTetrahedron(pairs.map((pair) => pair.sourcePoint.anchor.positionQ9))) {
      addIssue(ctx, ["coordinatePairs"], `${role} ARF controls must contain a non-coplanar tetrahedron`);
    }
    if (!hasNonCoplanarControlTetrahedron(pairs.map((pair) => pair.targetPoint.anchor.positionQ9))) {
      addIssue(ctx, ["coordinatePairs"], `${role} CVF controls must contain a non-coplanar tetrahedron`);
    }
  }

  if (intake.state === "coordinates_recorded" && intake.humanReview !== null) {
    addIssue(ctx, ["humanReview"], "coordinates-recorded state cannot claim completed human review");
  }
  if (intake.state === "human_review_complete" && intake.humanReview === null) {
    addIssue(ctx, ["humanReview"], "human-review-complete state requires an exact human review record");
  }
}

export const GrandHallCoordinatePairIntakeV1MaterialSchema =
  GrandHallCoordinatePairIntakeMaterialObjectSchema.superRefine(refineIntake);
export type GrandHallCoordinatePairIntakeV1Material = z.infer<
  typeof GrandHallCoordinatePairIntakeV1MaterialSchema
>;

export function computeGrandHallCoordinatePairIntakeV1Sha256(
  material: GrandHallCoordinatePairIntakeV1Material,
): `sha256:${string}` {
  const parsed = GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1, parsed);
}

const GrandHallCoordinatePairIntakeObjectSchema =
  GrandHallCoordinatePairIntakeMaterialObjectSchema.extend({
    artifactSha256: RuntimeSha256Schema,
  }).strict();

export const GrandHallCoordinatePairIntakeV1Schema =
  GrandHallCoordinatePairIntakeObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineIntake(material, ctx);
    if (
      artifactSha256 !==
      canonicalDigest(GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1, material)
    ) {
      addIssue(ctx, ["artifactSha256"], "artifact digest must bind exact lineage, nominations, coordinates, split, and review state");
    }
  });
export type GrandHallCoordinatePairIntakeV1 = z.infer<
  typeof GrandHallCoordinatePairIntakeV1Schema
>;

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

/**
 * Verifies the immutable predecessor edge. Coordinate correction is never a
 * successor mutation: it requires a new packet identity and a fresh revision 1.
 */
export function verifyGrandHallCoordinatePairIntakeV1Successor(
  previousInput: GrandHallCoordinatePairIntakeV1,
  successorInput: GrandHallCoordinatePairIntakeV1,
): GrandHallCoordinatePairIntakeV1 {
  const previous = GrandHallCoordinatePairIntakeV1Schema.parse(previousInput);
  const successor = GrandHallCoordinatePairIntakeV1Schema.parse(successorInput);
  if (successor.packetId !== previous.packetId) {
    throw new Error("coordinate-pair successor changed packet identity");
  }
  if (successor.revision !== previous.revision + 1) {
    throw new Error("coordinate-pair successor revision is not exactly previous + 1");
  }
  if (successor.predecessorArtifactSha256 !== previous.artifactSha256) {
    throw new Error("coordinate-pair successor does not bind the exact predecessor artifact");
  }
  const allowedTransitions: Readonly<Record<GrandHallCoordinatePairIntakeV1["state"], readonly GrandHallCoordinatePairIntakeV1["state"][]>> = {
    nomination_only: ["coordinates_recorded", "rejected"],
    coordinates_recorded: ["human_review_complete", "rejected"],
    human_review_complete: [],
    rejected: [],
  };
  if (!allowedTransitions[previous.state].includes(successor.state)) {
    throw new Error(`coordinate-pair state transition ${previous.state} -> ${successor.state} is not allowed`);
  }
  if (
    previous.state === "nomination_only" &&
    successor.state === "rejected" &&
    (successor.coordinatePairs.length !== 0 || successor.split !== null)
  ) {
    throw new Error("nomination-only rejection cannot introduce coordinate pairs or a split");
  }
  const immutableAlways = [
    "venueSlug",
    "roomSlug",
    "authority",
    "productionTrust",
    "sourceBindings",
    "targetBindings",
    "nominationSeed",
    "nominations",
    "nominationInventorySha256",
    "guardrails",
  ] as const;
  for (const key of immutableAlways) {
    if (!canonicalEqual(previous[key], successor[key])) {
      throw new Error(`coordinate-pair successor changed immutable ${key}`);
    }
  }
  if (previous.state !== "nomination_only") {
    for (const key of ["coordinatePairs", "coordinatePairInventorySha256", "split"] as const) {
      if (!canonicalEqual(previous[key], successor[key])) {
        throw new Error(`coordinate-pair successor changed immutable ${key}`);
      }
    }
  }
  return successor;
}

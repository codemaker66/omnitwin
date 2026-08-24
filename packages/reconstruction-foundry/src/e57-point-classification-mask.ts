import {
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS,
  FoundryE57GeometryCropArtifactV0Schema,
  type FoundryE57GeometryCropArtifactV0,
} from "./e57-geometry-worker.js";

export const FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0 =
  "omnitwin.foundry.e57-point-classification-mask-input.v0";
export const FOUNDRY_E57_POINT_CLASSIFICATION_MASK_V0 =
  "omnitwin.foundry.e57-point-classification-mask.v0";
export const FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES = 256;
export const FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS =
  FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS;
export const FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS = 1_000_000_000;

const POINT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_POINT_CLASSIFICATION_IDENTITY_V0";
const INPUT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0";
const MASK_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_E57_POINT_CLASSIFICATION_MASK_V0";
const BOUNDED_REJECTION =
  "omnitwin.foundry.e57-point-classification-bounded-rejection";
const E57_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

const BoundedRejectionSchema = z
  .literal(BOUNDED_REJECTION)
  .refine((_value): _value is never => false, {
    message: "an E57 point-classification array limit was exceeded",
  });

const MetricCoordinateSchema = z
  .number()
  .finite()
  .min(-FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS)
  .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS);
const MetricVectorSchema = z.tuple([
  MetricCoordinateSchema,
  MetricCoordinateSchema,
  MetricCoordinateSchema,
]);
const BoundsSchema = z
  .object({
    minimum: MetricVectorSchema,
    maximum: MetricVectorSchema,
  })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      if (bounds.minimum[axis] > bounds.maximum[axis]) {
        addIssue(
          ctx,
          ["minimum", axis],
          "bounds minimum cannot exceed maximum",
        );
      }
    }
  });

export const FoundryE57PointClassificationSchema = z.enum([
  "captured_movable_visual_excluded",
  "privacy_excluded",
  "unclassified_static_candidate",
]);
export type FoundryE57PointClassification = z.infer<
  typeof FoundryE57PointClassificationSchema
>;

export const FoundryE57PointClassificationSelectorV0Schema = z
  .object({
    pointOrder: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS - 1),
    pointId: RuntimeManifestKeySchema,
    evidenceSha256: RuntimeSha256Schema,
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    sourcePointIndex: z.number().int().safe().nonnegative(),
  })
  .strict();
export type FoundryE57PointClassificationSelectorV0 = z.infer<
  typeof FoundryE57PointClassificationSelectorV0Schema
>;

const ExactPointSelectionSchema = z
  .object({
    kind: z.literal("exact_point_selectors"),
    points: z
      .array(FoundryE57PointClassificationSelectorV0Schema)
      .min(1)
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
  })
  .strict();

const MetricBoundsSelectionSchema = z
  .object({
    kind: z.literal("inclusive_bounds_e57_root_m"),
    frame: z.literal("e57_root"),
    units: z.literal("metre"),
    minimum: MetricVectorSchema,
    maximum: MetricVectorSchema,
  })
  .strict()
  .superRefine((selection, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      if (selection.minimum[axis] > selection.maximum[axis]) {
        addIssue(
          ctx,
          ["minimum", axis],
          "selection minimum cannot exceed maximum",
        );
      }
    }
  });

export const FoundryE57PointClassificationRuleV0Schema = z
  .object({
    ruleId: RuntimeManifestKeySchema,
    classification: FoundryE57PointClassificationSchema,
    rationale: z.string().trim().min(20).max(1_000),
    selection: z.union([
      ExactPointSelectionSchema,
      MetricBoundsSelectionSchema,
    ]),
  })
  .strict();
export type FoundryE57PointClassificationRuleV0 = z.infer<
  typeof FoundryE57PointClassificationRuleV0Schema
>;

const AuthorshipSchema = z
  .object({
    operatorId: z.string().trim().min(2).max(160),
    operatorDisplayName: z.string().trim().min(2).max(160),
    authoredAt: FoundryUtcInstantSchema,
    purposeNote: z.string().trim().min(20).max(1_000),
    identityAuthority: z.literal("caller_supplied_unverified"),
  })
  .strict();

const MaskInputObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0),
    artifact: FoundryE57GeometryCropArtifactV0Schema,
    authorship: AuthorshipSchema,
    defaultClassification: z.literal("unclassified_static_candidate"),
    rules: z
      .array(FoundryE57PointClassificationRuleV0Schema)
      .min(1)
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES),
  })
  .strict();

export const FoundryE57PointClassificationMaskInputV0Schema = z.preprocess(
  rejectUnsafeMaskInput,
  z.union([MaskInputObjectSchema, BoundedRejectionSchema]),
);
export type FoundryE57PointClassificationMaskInputV0 = z.infer<
  typeof FoundryE57PointClassificationMaskInputV0Schema
>;

const SourceBindingSchema = z
  .object({
    assetId: z.string().regex(E57_SOURCE_ID),
    relativePath: z.string().min(1).max(4_096),
    inputType: z.enum(["generic_e57", "matterport_e57"]),
    sizeBytes: z.number().int().safe().positive(),
    sha256: RuntimeSha256Schema,
  })
  .strict();

const ClassificationOriginSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("operator_rule"),
      ruleId: RuntimeManifestKeySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("declared_default"),
      ruleId: z.null(),
    })
    .strict(),
]);

const ClassifiedPointSchema = z
  .object({
    pointOrder: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS - 1),
    pointId: RuntimeManifestKeySchema,
    evidenceSha256: RuntimeSha256Schema,
    scanIndex: z.number().int().nonnegative(),
    data3dGuid: z.string().min(1).max(512),
    sourcePointIndex: z.number().int().safe().nonnegative(),
    coordinatesM: MetricVectorSchema,
    classification: FoundryE57PointClassificationSchema,
    classificationOrigin: ClassificationOriginSchema,
    authority: z.literal("none"),
  })
  .strict();

const MaskPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_E57_POINT_CLASSIFICATION_MASK_V0),
    status: z.literal("local_operator_authored_classification_draft"),
    maskInputSha256: RuntimeSha256Schema,
    subject: z
      .object({
        artifactSha256: RuntimeSha256Schema,
        source: SourceBindingSchema,
        sourceFactsArtifactSha256: RuntimeSha256Schema,
        readerDescriptionSha256: RuntimeSha256Schema,
        frame: z.literal("e57_root"),
        units: z.literal("metre"),
        axes: z.literal("right_handed_z_up"),
        sourceRetainedPointCount: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
        sourceBoundsM: BoundsSchema,
      })
      .strict(),
    authorship: AuthorshipSchema,
    defaultClassification: z.literal("unclassified_static_candidate"),
    classificationRules: z
      .array(FoundryE57PointClassificationRuleV0Schema)
      .min(1)
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES),
    points: z
      .array(ClassifiedPointSchema)
      .min(1)
      .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
    classificationCounts: z
      .object({
        sourceRetainedPoints: z
          .number()
          .int()
          .positive()
          .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
        capturedMovableVisualExcluded: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
        privacyExcluded: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
        unclassifiedStaticCandidate: z
          .number()
          .int()
          .nonnegative()
          .max(FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS),
      })
      .strict(),
    completeness: z.literal(
      "every_retained_crop_point_classified_exactly_once",
    ),
    coordinateRuleBoundary: z.literal(
      "aabb_rules_apply_only_in_original_e57_root_metres_without_preview_correction",
    ),
    reviewStatus: z.literal("not_reviewed"),
    releaseEligibility: z.literal("blocked"),
    releaseBlockers: z.tuple([
      z.literal("AUTHORED_CLASSIFICATION_REVIEW_REQUIRED"),
      z.literal("SCENE_AUTHORITY_MAP_REQUIRED"),
      z.literal("TRANSFORM_ARTIFACT_REQUIRED"),
    ]),
    authority: z
      .object({
        pointClassification: z.literal("caller_supplied_unverified"),
        architecturalGeometry: z.literal("none"),
        placement: z.literal("none"),
        measurement: z.literal("none"),
        collision: z.literal("none"),
        export: z.literal("none"),
        runtime: z.literal("none"),
      })
      .strict(),
    capabilities: z
      .object({
        localAuthorityNoneFusionExclusion: z.literal("allowed"),
        sourceMutation: z.literal("not_authorized"),
        transformArtifactCreation: z.literal("not_authorized"),
        sceneAuthorityCreation: z.literal("not_authorized"),
        qaApproval: z.literal("not_authorized"),
        packageExport: z.literal("not_authorized"),
        runtimeActivation: z.literal("not_authorized"),
      })
      .strict(),
    verificationBoundary: z
      .object({
        standaloneSchema: z.literal("payload_self_consistency_only"),
        exactCropAndRuleBinding: z.literal(
          "requires_recompile_from_exact_crop",
        ),
        digestAuthentication: z.literal("not_provided"),
      })
      .strict(),
  })
  .strict();

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right))
  );
}

function withinBounds(
  coordinates: readonly [number, number, number],
  selection: z.infer<typeof MetricBoundsSelectionSchema>,
): boolean {
  return [0, 1, 2].every((axis) => {
    const component = coordinates[axis];
    const minimum = selection.minimum[axis];
    const maximum = selection.maximum[axis];
    return (
      component !== undefined &&
      minimum !== undefined &&
      maximum !== undefined &&
      component >= minimum &&
      component <= maximum
    );
  });
}

function boundsForClassifiedPoints(
  points: readonly z.infer<typeof ClassifiedPointSchema>[],
): z.infer<typeof BoundsSchema> | null {
  const first = points[0];
  if (first === undefined) return null;
  const minimum = [...first.coordinatesM] as [number, number, number];
  const maximum = [...first.coordinatesM] as [number, number, number];
  for (let index = 1; index < points.length; index += 1) {
    const coordinates = points[index]?.coordinatesM;
    if (coordinates === undefined) continue;
    for (const axis of [0, 1, 2] as const) {
      minimum[axis] = Math.min(minimum[axis], coordinates[axis]);
      maximum[axis] = Math.max(maximum[axis], coordinates[axis]);
    }
  }
  return { minimum, maximum };
}

function reconstructRuleAssignments(
  payload: z.infer<typeof MaskPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): ReadonlyMap<number, FoundryE57PointClassificationRuleV0> | null {
  const assignments = new Map<
    number,
    FoundryE57PointClassificationRuleV0
  >();
  const pointsById = new Map(
    payload.points.map((point) => [point.pointId, point]),
  );
  for (const [ruleIndex, rule] of payload.classificationRules.entries()) {
    let selectedCount = 0;
    const assignPoint = (
      point: z.infer<typeof ClassifiedPointSchema>,
    ): boolean => {
      selectedCount += 1;
      const existing = assignments.get(point.pointOrder);
      if (existing !== undefined) {
        addIssue(
          ctx,
          ["classificationRules", ruleIndex],
          `point ${String(point.pointOrder)} is selected by both ${existing.ruleId} and ${rule.ruleId}`,
        );
        return false;
      }
      assignments.set(point.pointOrder, rule);
      return true;
    };
    if (rule.selection.kind === "exact_point_selectors") {
      for (const selector of rule.selection.points) {
        const point = pointsById.get(selector.pointId);
        if (
          point === undefined ||
          !pointMatchesSelector(point, selector) ||
          !assignPoint(point)
        ) {
          if (point === undefined || !pointMatchesSelector(point, selector)) {
            addIssue(
              ctx,
              ["classificationRules", ruleIndex],
              "every exact selector must bind one complete payload point identity",
            );
          }
          return null;
        }
      }
    } else {
      for (const point of payload.points) {
        if (
          withinBounds(point.coordinatesM, rule.selection) &&
          !assignPoint(point)
        ) {
          return null;
        }
      }
    }
    const expectedExactCount =
      rule.selection.kind === "exact_point_selectors"
        ? rule.selection.points.length
        : null;
    if (
      selectedCount === 0 ||
      (expectedExactCount !== null && selectedCount !== expectedExactCount)
    ) {
      addIssue(
        ctx,
        ["classificationRules", ruleIndex],
        "every rule must select its complete non-empty exact point set",
      );
      return null;
    }
  }
  return assignments;
}

function validatePayload(
  payload: z.infer<typeof MaskPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const ruleIds = payload.classificationRules.map((rule) => rule.ruleId);
  if (
    new Set(ruleIds).size !== ruleIds.length ||
    ruleIds.some(
      (ruleId, index) =>
        index > 0 &&
        compareCanonicalStrings(ruleIds[index - 1] ?? "", ruleId) >= 0,
    )
  ) {
    addIssue(ctx, ["classificationRules"], "rules must be unique and sorted");
    return;
  }
  const rules = new Map(
    payload.classificationRules.map((rule) => [rule.ruleId, rule]),
  );
  const pointIds = new Set<string>();
  for (const [index, point] of payload.points.entries()) {
    if (point.pointOrder !== index || pointIds.has(point.pointId)) {
      addIssue(
        ctx,
        ["points", index],
        "classified points must be unique and source ordered",
      );
      return;
    }
    pointIds.add(point.pointId);
  }
  const assignments = reconstructRuleAssignments(payload, ctx);
  if (assignments === null) return;
  for (const [index, point] of payload.points.entries()) {
    const expectedRule = assignments.get(point.pointOrder);
    if (
      (expectedRule === undefined &&
        (point.classificationOrigin.kind !== "declared_default" ||
          point.classification !== "unclassified_static_candidate")) ||
      (expectedRule !== undefined &&
        (point.classificationOrigin.kind !== "operator_rule" ||
          point.classificationOrigin.ruleId !== expectedRule.ruleId ||
          point.classification !== expectedRule.classification ||
          rules.get(expectedRule.ruleId) !== expectedRule))
    ) {
      addIssue(
        ctx,
        ["points", index],
        "point classification origin must equal the complete reconstructed rule partition",
      );
      return;
    }
  }
  const counts = countClassifications(payload.points);
  const sourceBounds = boundsForClassifiedPoints(payload.points);
  if (
    payload.points.length !== payload.subject.sourceRetainedPointCount ||
    payload.points.length !==
      payload.classificationCounts.sourceRetainedPoints ||
    !sameCanonical(counts, payload.classificationCounts) ||
    sourceBounds === null ||
    !sameCanonical(sourceBounds, payload.subject.sourceBoundsM)
  ) {
    addIssue(
      ctx,
      ["classificationCounts"],
      "classification counts do not form one complete point partition",
    );
  }
}

function pointMatchesSelector(
  point: z.infer<typeof ClassifiedPointSchema>,
  selector: FoundryE57PointClassificationSelectorV0,
): boolean {
  return (
    selector.pointOrder === point.pointOrder &&
    selector.pointId === point.pointId &&
    selector.evidenceSha256 === point.evidenceSha256 &&
    selector.scanIndex === point.scanIndex &&
    selector.data3dGuid === point.data3dGuid &&
    selector.sourcePointIndex === point.sourcePointIndex
  );
}

function countClassifications(
  points: readonly z.infer<typeof ClassifiedPointSchema>[],
): z.infer<typeof MaskPayloadObjectSchema>["classificationCounts"] {
  let movable = 0;
  let privacy = 0;
  let retained = 0;
  for (const point of points) {
    if (point.classification === "captured_movable_visual_excluded")
      movable += 1;
    else if (point.classification === "privacy_excluded") privacy += 1;
    else retained += 1;
  }
  return {
    sourceRetainedPoints: points.length,
    capturedMovableVisualExcluded: movable,
    privacyExcluded: privacy,
    unclassifiedStaticCandidate: retained,
  };
}

export const FoundryE57PointClassificationMaskPayloadV0Schema = z.preprocess(
  rejectUnsafeMaskPayload,
  z.union([
    MaskPayloadObjectSchema.superRefine(validatePayload),
    BoundedRejectionSchema,
  ]),
);
export type FoundryE57PointClassificationMaskPayloadV0 = z.infer<
  typeof FoundryE57PointClassificationMaskPayloadV0Schema
>;

const MaskResultObjectSchema = MaskPayloadObjectSchema.extend({
  maskSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((result, ctx) => {
    const { maskSha256, ...payload } = result;
    const parsed =
      FoundryE57PointClassificationMaskPayloadV0Schema.safeParse(payload);
    if (!parsed.success) {
      addIssue(ctx, [], "mask payload must remain internally self-consistent");
    } else if (maskSha256 !== maskDigest(parsed.data)) {
      addIssue(
        ctx,
        ["maskSha256"],
        "mask digest does not bind the exact payload",
      );
    }
  });

export const FoundryE57PointClassificationMaskV0Schema = z.preprocess(
  rejectUnsafeMaskPayload,
  z.union([MaskResultObjectSchema, BoundedRejectionSchema]),
);
export type FoundryE57PointClassificationMaskV0 = z.infer<
  typeof FoundryE57PointClassificationMaskV0Schema
>;

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayMember(
  record: Record<string, unknown> | null,
  key: string,
): readonly unknown[] | null {
  if (record === null) return null;
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function arrayHasUnsafeSlots(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return true;
  }
  return false;
}

function hasExactOwnKeys(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isManifestKey(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-z0-9][a-z0-9._-]*$/u.test(value)
  );
}

function isSha256(value: unknown): boolean {
  return (
    typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)
  );
}

function isMetricVector(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    !arrayHasUnsafeSlots(value) &&
    value.every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <=
          FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS,
    )
  );
}

const E57_POINT_KEYS = new Set([
  "scanIndex",
  "data3dGuid",
  "sourcePointIndex",
  "xM",
  "yM",
  "zM",
]);
const SELECTOR_KEYS = new Set([
  "pointOrder",
  "pointId",
  "evidenceSha256",
  "scanIndex",
  "data3dGuid",
  "sourcePointIndex",
]);
const CLASSIFIED_POINT_KEYS = new Set([
  ...SELECTOR_KEYS,
  "coordinatesM",
  "classification",
  "classificationOrigin",
  "authority",
]);
const CLASSIFICATION_ORIGIN_KEYS = new Set(["kind", "ruleId"]);
const SELECTOR_REFERENCE_KEYS = new Set(["scanIndex", "sourcePointIndex"]);

function e57PointHasBoundedShape(value: unknown): boolean {
  const point = unknownRecord(value);
  return (
    point !== null &&
    hasExactOwnKeys(point, E57_POINT_KEYS) &&
    isNonnegativeSafeInteger(point.scanIndex) &&
    typeof point.data3dGuid === "string" &&
    point.data3dGuid.length >= 1 &&
    point.data3dGuid.length <= 512 &&
    isNonnegativeSafeInteger(point.sourcePointIndex) &&
    typeof point.xM === "number" &&
    Number.isFinite(point.xM) &&
    Math.abs(point.xM) <=
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS &&
    typeof point.yM === "number" &&
    Number.isFinite(point.yM) &&
    Math.abs(point.yM) <=
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS &&
    typeof point.zM === "number" &&
    Number.isFinite(point.zM) &&
    Math.abs(point.zM) <= FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_ABS_METERS
  );
}

function selectorFieldsHaveBoundedShape(
  selector: Record<string, unknown>,
): boolean {
  return (
    isNonnegativeSafeInteger(selector.pointOrder) &&
    selector.pointOrder < FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS &&
    isManifestKey(selector.pointId) &&
    isSha256(selector.evidenceSha256) &&
    isNonnegativeSafeInteger(selector.scanIndex) &&
    typeof selector.data3dGuid === "string" &&
    selector.data3dGuid.length >= 1 &&
    selector.data3dGuid.length <= 512 &&
    isNonnegativeSafeInteger(selector.sourcePointIndex)
  );
}

function selectorHasBoundedShape(value: unknown): boolean {
  const selector = unknownRecord(value);
  return (
    selector !== null &&
    hasExactOwnKeys(selector, SELECTOR_KEYS) &&
    selectorFieldsHaveBoundedShape(selector)
  );
}

function classifiedPointHasBoundedShape(value: unknown): boolean {
  const point = unknownRecord(value);
  if (
    point === null ||
    !hasExactOwnKeys(point, CLASSIFIED_POINT_KEYS) ||
    !selectorFieldsHaveBoundedShape(point) ||
    !isMetricVector(point.coordinatesM) ||
    ![
      "captured_movable_visual_excluded",
      "privacy_excluded",
      "unclassified_static_candidate",
    ].includes(String(point.classification)) ||
    point.authority !== "none"
  ) {
    return false;
  }
  const origin = unknownRecord(point.classificationOrigin);
  if (
    origin === null ||
    !hasExactOwnKeys(origin, CLASSIFICATION_ORIGIN_KEYS)
  ) {
    return false;
  }
  return (
    (origin.kind === "declared_default" && origin.ruleId === null) ||
    (origin.kind === "operator_rule" && isManifestKey(origin.ruleId))
  );
}

function selectorReferenceHasBoundedShape(value: unknown): boolean {
  const reference = unknownRecord(value);
  return (
    reference !== null &&
    hasExactOwnKeys(reference, SELECTOR_REFERENCE_KEYS) &&
    isNonnegativeSafeInteger(reference.scanIndex) &&
    isNonnegativeSafeInteger(reference.sourcePointIndex)
  );
}

function maskInputUnsafe(value: unknown): boolean {
  const input = unknownRecord(value);
  const rules = arrayMember(input, "rules");
  if (
    rules !== null &&
    (rules.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES ||
      arrayHasUnsafeSlots(rules))
  ) {
    return true;
  }
  let selectorCount = 0;
  if (rules !== null) {
    for (const ruleValue of rules) {
      const rule = unknownRecord(ruleValue);
      const selection = unknownRecord(rule?.selection);
      const selectors = arrayMember(selection, "points");
      if (selectors !== null) {
        selectorCount += selectors.length;
        if (
          selectors.length >
            FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
          selectorCount > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
          arrayHasUnsafeSlots(selectors) ||
          !selectors.every(selectorHasBoundedShape)
        ) {
          return true;
        }
      }
    }
  }
  const artifact = unknownRecord(input?.artifact);
  const artifactPoints = arrayMember(artifact, "points");
  if (
    artifactPoints !== null &&
    (artifactPoints.length >
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
      arrayHasUnsafeSlots(artifactPoints) ||
      !artifactPoints.every(e57PointHasBoundedShape))
  ) {
    return true;
  }
  const description = unknownRecord(artifact?.readerDescription);
  const scans = arrayMember(description, "scans");
  if (
    scans !== null &&
    (scans.length > FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS ||
      arrayHasUnsafeSlots(scans))
  ) {
    return true;
  }
  if (scans !== null) {
    for (const scanValue of scans) {
      const fields = arrayMember(unknownRecord(scanValue), "pointFields");
      if (
        unknownRecord(scanValue) === null ||
        fields !== null &&
          (fields.length > 256 ||
            arrayHasUnsafeSlots(fields) ||
            !fields.every((field) => typeof field === "string"))
      ) {
        return true;
      }
    }
  }
  return false;
}

function maskPayloadUnsafe(value: unknown): boolean {
  const payload = unknownRecord(value);
  const rules = arrayMember(payload, "classificationRules");
  const points = arrayMember(payload, "points");
  if (
    (rules !== null &&
      (rules.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_RULES ||
        arrayHasUnsafeSlots(rules))) ||
    (points !== null &&
      (points.length > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
        arrayHasUnsafeSlots(points) ||
        !points.every(classifiedPointHasBoundedShape)))
  ) {
    return true;
  }
  let selectorCount = 0;
  if (rules !== null) {
    for (const ruleValue of rules) {
      const selection = unknownRecord(unknownRecord(ruleValue)?.selection);
      const selectors = arrayMember(selection, "points");
      if (selectors !== null) {
        selectorCount += selectors.length;
        if (
          selectors.length >
            FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
          selectorCount > FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
          arrayHasUnsafeSlots(selectors) ||
          !selectors.every(selectorHasBoundedShape)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function rejectUnsafeMaskInput(value: unknown): unknown {
  try {
    return maskInputUnsafe(value) ? BOUNDED_REJECTION : value;
  } catch {
    return BOUNDED_REJECTION;
  }
}

function rejectUnsafeMaskPayload(value: unknown): unknown {
  try {
    return maskPayloadUnsafe(value) ? BOUNDED_REJECTION : value;
  } catch {
    return BOUNDED_REJECTION;
  }
}

function preflightMaskInput(value: unknown): void {
  let unsafe = false;
  try {
    unsafe = maskInputUnsafe(value);
  } catch {
    unsafe = true;
  }
  if (unsafe) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_LIMIT_EXCEEDED",
      "Point classification exceeds a bounded rule, selector, crop-point, scan, or point-field array limit.",
    );
  }
}

function prefixedDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

interface PointIdentity {
  readonly pointOrder: number;
  readonly pointId: string;
  readonly evidenceSha256: string;
  readonly scanIndex: number;
  readonly data3dGuid: string;
  readonly sourcePointIndex: number;
  readonly coordinatesM: readonly [number, number, number];
}

function pointIdentityMaterial(
  artifact: FoundryE57GeometryCropArtifactV0,
  point: FoundryE57GeometryCropArtifactV0["points"][number],
  pointOrder: number,
): PointIdentity {
  const coordinatesM = [point.xM, point.yM, point.zM] as const;
  const evidenceSha256 = prefixedDigest(POINT_DIGEST_DOMAIN, {
    schemaVersion: "omnitwin.foundry.e57-point-classification-identity.v0",
    artifactSha256: artifact.artifactSha256,
    source: artifact.source,
    sourceFactsArtifactSha256: artifact.sourceFactsArtifactSha256,
    readerDescriptionSha256: artifact.readerDescription.descriptionSha256,
    coordinateContract: artifact.coordinateContract,
    pointOrder,
    scanIndex: point.scanIndex,
    data3dGuid: point.data3dGuid,
    sourcePointIndex: point.sourcePointIndex,
    coordinatesM,
  });
  return {
    pointOrder,
    pointId: `e57-classification-point-${evidenceSha256.slice("sha256:".length)}`,
    evidenceSha256,
    scanIndex: point.scanIndex,
    data3dGuid: point.data3dGuid,
    sourcePointIndex: point.sourcePointIndex,
    coordinatesM,
  };
}

function pointIdentities(
  artifact: FoundryE57GeometryCropArtifactV0,
): PointIdentity[] {
  return artifact.points.map((point, pointOrder) =>
    pointIdentityMaterial(artifact, point, pointOrder),
  );
}

function selectorFromIdentity(
  identity: PointIdentity,
): FoundryE57PointClassificationSelectorV0 {
  return FoundryE57PointClassificationSelectorV0Schema.parse({
    pointOrder: identity.pointOrder,
    pointId: identity.pointId,
    evidenceSha256: identity.evidenceSha256,
    scanIndex: identity.scanIndex,
    data3dGuid: identity.data3dGuid,
    sourcePointIndex: identity.sourcePointIndex,
  });
}

export function deriveFoundryE57PointClassificationSelectorsV0(
  artifactInput: unknown,
  referencesInput: unknown,
): FoundryE57PointClassificationSelectorV0[] {
  preflightMaskInput({ artifact: artifactInput });
  const artifact = FoundryE57GeometryCropArtifactV0Schema.parse(artifactInput);
  if (
    !Array.isArray(referencesInput) ||
    referencesInput.length === 0 ||
    referencesInput.length >
      FOUNDRY_E57_POINT_CLASSIFICATION_MAXIMUM_SELECTORS ||
    arrayHasUnsafeSlots(referencesInput) ||
    !referencesInput.every(selectorReferenceHasBoundedShape)
  ) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_SELECTOR_INPUT_INVALID",
      "Selector derivation requires one bounded array of scan and source-point indices.",
    );
  }
  const references = z
    .array(
      z
        .object({
          scanIndex: z.number().int().nonnegative(),
          sourcePointIndex: z.number().int().safe().nonnegative(),
        })
        .strict(),
    )
    .parse(referencesInput);
  const referenceKeys = references.map(
    (reference) =>
      `${String(reference.scanIndex)}:${String(reference.sourcePointIndex)}`,
  );
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_SELECTOR_DUPLICATE",
      "Selector references must be unique.",
    );
  }
  const identities = pointIdentities(artifact);
  const byKey = new Map(
    identities.map((identity) => [
      `${String(identity.scanIndex)}:${String(identity.sourcePointIndex)}`,
      identity,
    ]),
  );
  return references
    .map((_reference, index) => {
      const identity = byKey.get(referenceKeys[index] ?? "");
      if (identity === undefined) {
        throw new FoundryIntegrityError(
          "E57_POINT_CLASSIFICATION_SELECTOR_MISSING",
          "A selector reference does not identify an exact retained crop point.",
        );
      }
      return selectorFromIdentity(identity);
    })
    .sort((left, right) => left.pointOrder - right.pointOrder);
}

interface NormalizedRule {
  readonly rule: FoundryE57PointClassificationRuleV0;
  readonly pointOrders: readonly number[];
}

function normalizeRule(
  rule: FoundryE57PointClassificationRuleV0,
  identities: readonly PointIdentity[],
  byPointId: ReadonlyMap<string, PointIdentity>,
): NormalizedRule {
  const selection = rule.selection;
  if (selection.kind === "inclusive_bounds_e57_root_m") {
    const pointOrders = identities
      .filter((identity) => withinBounds(identity.coordinatesM, selection))
      .map((identity) => identity.pointOrder);
    if (pointOrders.length === 0) ruleEmpty(rule.ruleId);
    return { rule, pointOrders };
  }
  const selectors = selection.points;
  if (
    new Set(selectors.map((selector) => selector.pointId)).size !==
    selectors.length
  ) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_SELECTOR_DUPLICATE",
      `Rule ${rule.ruleId} contains a duplicate exact point selector.`,
    );
  }
  const normalized = selectors.map((selector) => {
    const identity = byPointId.get(selector.pointId);
    if (
      identity === undefined ||
      !sameCanonical(selector, selectorFromIdentity(identity))
    ) {
      throw new FoundryIntegrityError(
        "E57_POINT_CLASSIFICATION_SELECTOR_BINDING_MISMATCH",
        `Rule ${rule.ruleId} has a selector that does not bind an exact retained crop point.`,
      );
    }
    return selectorFromIdentity(identity);
  });
  normalized.sort((left, right) => left.pointOrder - right.pointOrder);
  if (normalized.length === 0) ruleEmpty(rule.ruleId);
  return {
    rule: {
      ...rule,
      selection: { kind: "exact_point_selectors", points: normalized },
    },
    pointOrders: normalized.map((selector) => selector.pointOrder),
  };
}

function ruleEmpty(ruleId: string): never {
  throw new FoundryIntegrityError(
    "E57_POINT_CLASSIFICATION_RULE_EMPTY",
    `Rule ${ruleId} selects no retained crop points.`,
  );
}

interface NormalizedRules {
  readonly rules: readonly NormalizedRule[];
  readonly assignments: ReadonlyMap<number, NormalizedRule>;
}

function normalizeRulesAndAssignments(
  rules: readonly FoundryE57PointClassificationRuleV0[],
  identities: readonly PointIdentity[],
): NormalizedRules {
  if (new Set(rules.map((rule) => rule.ruleId)).size !== rules.length) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_RULE_DUPLICATE",
      "Point-classification rule IDs must be unique.",
    );
  }
  const byPointId = new Map(
    identities.map((identity) => [identity.pointId, identity]),
  );
  const assignments = new Map<number, NormalizedRule>();
  const normalizedRules: NormalizedRule[] = [];
  const sortedRules = [...rules].sort((left, right) =>
    compareCanonicalStrings(left.ruleId, right.ruleId),
  );
  for (const sourceRule of sortedRules) {
    const normalized = normalizeRule(sourceRule, identities, byPointId);
    for (const pointOrder of normalized.pointOrders) {
      const existing = assignments.get(pointOrder);
      if (existing !== undefined) {
        throw new FoundryIntegrityError(
          "E57_POINT_CLASSIFICATION_RULE_OVERLAP",
          `Point ${String(pointOrder)} is selected by both ${existing.rule.ruleId} and ${normalized.rule.ruleId}.`,
        );
      }
      assignments.set(pointOrder, normalized);
    }
    normalizedRules.push(normalized);
  }
  return { rules: normalizedRules, assignments };
}

function compilePoints(
  identities: readonly PointIdentity[],
  assignments: ReadonlyMap<number, NormalizedRule>,
): z.infer<typeof ClassifiedPointSchema>[] {
  return identities.map((identity) => {
    const assignment = assignments.get(identity.pointOrder);
    return ClassifiedPointSchema.parse({
      ...identity,
      classification:
        assignment?.rule.classification ?? "unclassified_static_candidate",
      classificationOrigin:
        assignment === undefined
          ? { kind: "declared_default", ruleId: null }
          : { kind: "operator_rule", ruleId: assignment.rule.ruleId },
      authority: "none",
    });
  });
}

function normalizedInputDigest(
  input: FoundryE57PointClassificationMaskInputV0,
  rules: readonly NormalizedRule[],
): string {
  return prefixedDigest(INPUT_DIGEST_DOMAIN, {
    schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
    artifactSha256: input.artifact.artifactSha256,
    authorship: input.authorship,
    defaultClassification: input.defaultClassification,
    rules: rules.map(({ rule }) => rule),
  });
}

function maskDigest(
  payload: FoundryE57PointClassificationMaskPayloadV0,
): string {
  return prefixedDigest(MASK_DIGEST_DOMAIN, payload);
}

export function computeFoundryE57PointClassificationMaskSha256(
  payloadInput: unknown,
): string {
  const parsed =
    FoundryE57PointClassificationMaskPayloadV0Schema.safeParse(payloadInput);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_PAYLOAD_INVALID",
      "The point-classification payload is invalid or internally inconsistent.",
      { cause: parsed.error },
    );
  }
  return maskDigest(parsed.data);
}

export function compileFoundryE57PointClassificationMaskV0(
  input: unknown,
): FoundryE57PointClassificationMaskV0 {
  preflightMaskInput(input);
  const parsed =
    FoundryE57PointClassificationMaskInputV0Schema.safeParse(input);
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_INPUT_INVALID",
      "Point classification requires one intact generated crop, exact E57-root metric rules, bounded selectors, and caller-supplied authorship.",
      { cause: parsed.error },
    );
  }
  if (parsed.data.artifact.points.length === 0) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_EMPTY_ARTIFACT",
      "A point-classification mask cannot be compiled for a crop with zero retained points.",
    );
  }
  const identities = pointIdentities(parsed.data.artifact);
  const normalized = normalizeRulesAndAssignments(
    parsed.data.rules,
    identities,
  );
  const rules = normalized.rules;
  const points = compilePoints(identities, normalized.assignments);
  const sourceBounds = parsed.data.artifact.outputBoundsM;
  if (sourceBounds === null) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_EMPTY_ARTIFACT",
      "A non-empty crop must carry exact output bounds.",
    );
  }
  const payload = FoundryE57PointClassificationMaskPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_V0,
    status: "local_operator_authored_classification_draft",
    maskInputSha256: normalizedInputDigest(parsed.data, rules),
    subject: {
      artifactSha256: parsed.data.artifact.artifactSha256,
      source: parsed.data.artifact.source,
      sourceFactsArtifactSha256: parsed.data.artifact.sourceFactsArtifactSha256,
      readerDescriptionSha256:
        parsed.data.artifact.readerDescription.descriptionSha256,
      frame: "e57_root",
      units: "metre",
      axes: "right_handed_z_up",
      sourceRetainedPointCount: parsed.data.artifact.points.length,
      sourceBoundsM: sourceBounds,
    },
    authorship: parsed.data.authorship,
    defaultClassification: parsed.data.defaultClassification,
    classificationRules: rules.map(({ rule }) => rule),
    points,
    classificationCounts: countClassifications(points),
    completeness: "every_retained_crop_point_classified_exactly_once",
    coordinateRuleBoundary:
      "aabb_rules_apply_only_in_original_e57_root_metres_without_preview_correction",
    reviewStatus: "not_reviewed",
    releaseEligibility: "blocked",
    releaseBlockers: [
      "AUTHORED_CLASSIFICATION_REVIEW_REQUIRED",
      "SCENE_AUTHORITY_MAP_REQUIRED",
      "TRANSFORM_ARTIFACT_REQUIRED",
    ],
    authority: {
      pointClassification: "caller_supplied_unverified",
      architecturalGeometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none",
    },
    capabilities: {
      localAuthorityNoneFusionExclusion: "allowed",
      sourceMutation: "not_authorized",
      transformArtifactCreation: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      qaApproval: "not_authorized",
      packageExport: "not_authorized",
      runtimeActivation: "not_authorized",
    },
    verificationBoundary: {
      standaloneSchema: "payload_self_consistency_only",
      exactCropAndRuleBinding: "requires_recompile_from_exact_crop",
      digestAuthentication: "not_provided",
    },
  });
  return FoundryE57PointClassificationMaskV0Schema.parse({
    ...payload,
    maskSha256: maskDigest(payload),
  });
}

export function verifyFoundryE57PointClassificationMaskV0(
  maskInput: unknown,
  exactArtifactInput: unknown,
): FoundryE57PointClassificationMaskV0 {
  const mask = FoundryE57PointClassificationMaskV0Schema.parse(maskInput);
  const artifact =
    FoundryE57GeometryCropArtifactV0Schema.parse(exactArtifactInput);
  const expected = compileFoundryE57PointClassificationMaskV0({
    schemaVersion: FOUNDRY_E57_POINT_CLASSIFICATION_MASK_INPUT_V0,
    artifact,
    authorship: mask.authorship,
    defaultClassification: mask.defaultClassification,
    rules: mask.classificationRules,
  });
  if (!sameCanonical(mask, expected)) {
    throw new FoundryIntegrityError(
      "E57_POINT_CLASSIFICATION_RECOMPUTATION_MISMATCH",
      "The point-classification mask does not reproduce from the exact crop, authorship, and embedded rules.",
    );
  }
  return mask;
}

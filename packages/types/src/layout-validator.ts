import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  CanonicalLayoutSnapshotV0Schema,
  canonicalLayoutSnapshotDigest,
  normalizeCanonicalLayoutSnapshot,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type CanonicalLayoutSnapshotV0,
  type LayoutSnapshotPlacedObject,
} from "./canonical-layout-snapshot.js";
import {
  DataSufficiencyMessageKeyFamilySchema,
  DataSufficiencyOutcomeSchema,
  DataSufficiencyRequiredInputCategorySchema,
} from "./data-sufficiency.js";
import {
  LayoutProofClaimFamilySchema,
  LayoutProofClaimStatusSchema,
} from "./layout-proof-object.js";
import {
  ReviewGateBlockingModeSchema,
  ReviewGateMessageKeyFamilySchema,
  ReviewGateReasonSchema,
  ReviewGateRequiredDataCategorySchema,
  ReviewGateReviewerRoleSchema,
} from "./review-gate.js";

export const LAYOUT_VALIDATOR_SCHEMA_VERSION = "venviewer.layout-validator.v0";
export const LAYOUT_VALIDATOR_VERSION = "0.1.0";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const LAYOUT_VALIDATOR_DOMAIN_PREFIX = "venviewer.layout-validator.v0\n";
const WITNESS_DOMAIN_PREFIX = "venviewer.layout-witness.v0\n";
const PROOF_DOMAIN_PREFIX = "venviewer.layout-proof.v0\n";
const METRE_ROUNDING_DECIMALS = 6;

export const LAYOUT_VALIDATOR_RULE_IDS = [
  "layout.snapshot_identity",
  "layout.footprint_containment",
  "layout.seating_provision",
  "layout.primary_furniture_clearance",
  "layout.budget",
] as const;

export const LayoutValidatorRuleIdSchema = z.enum(LAYOUT_VALIDATOR_RULE_IDS);
export type LayoutValidatorRuleId = z.infer<typeof LayoutValidatorRuleIdSchema>;

export const LayoutValidatorPricingContextSchema = z.object({
  currency: z.literal("GBP"),
  budgetLimitMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  projectedTotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  priceBookRef: z.string().trim().min(1).max(255),
}).strict();
export type LayoutValidatorPricingContext = z.infer<
  typeof LayoutValidatorPricingContextSchema
>;

export const LayoutValidatorContextSchema = z.object({
  policyBundleId: z.string().trim().min(1).max(160),
  policyBundleDigest: z.string().regex(SHA256_HEX).nullable(),
  policyBundleVersion: z.string().trim().min(1).max(80),
  minPrimaryFurnitureClearanceM: z.number().nonnegative().max(20),
  clearanceWarningMarginM: z.number().nonnegative().max(20),
  pricing: LayoutValidatorPricingContextSchema.nullable(),
}).strict();
export type LayoutValidatorContext = z.infer<typeof LayoutValidatorContextSchema>;

export const LayoutValidatorDataSufficiencySchema = z.object({
  outcome: DataSufficiencyOutcomeSchema,
  surface: z.literal("validator_kernel"),
  requiredInputCategories: z.array(DataSufficiencyRequiredInputCategorySchema),
  messageKey: DataSufficiencyMessageKeyFamilySchema,
}).strict();
export type LayoutValidatorDataSufficiency = z.infer<
  typeof LayoutValidatorDataSufficiencySchema
>;

export const LayoutValidatorReviewGateSchema = z.object({
  reason: ReviewGateReasonSchema,
  reviewerRole: ReviewGateReviewerRoleSchema,
  blockingMode: ReviewGateBlockingModeSchema,
  requiredDataCategories: z.array(ReviewGateRequiredDataCategorySchema),
  messageKey: ReviewGateMessageKeyFamilySchema,
}).strict();
export type LayoutValidatorReviewGate = z.infer<typeof LayoutValidatorReviewGateSchema>;

export const LayoutValidatorWitnessSchema = z.object({
  witnessId: z.string().regex(SHA256_HEX),
  ruleId: LayoutValidatorRuleIdSchema,
  ruleVersion: z.string().trim().min(1).max(40),
  claimFamily: LayoutProofClaimFamilySchema,
  status: LayoutProofClaimStatusSchema,
  messageKey: z.string().regex(/^layout_[a-z0-9_]+$/).max(120),
  messageArgs: z.record(CanonicalJsonValueSchema),
  facts: z.record(CanonicalJsonValueSchema),
  derivation: z.string().regex(/^layout\.[a-z0-9_.]+$/).max(160),
  policyRefs: z.array(z.string().trim().min(1).max(255)),
  snapshotRefs: z.array(z.string().regex(SHA256_HEX)),
  affectedObjectIds: z.array(z.string().uuid()),
  dataSufficiency: LayoutValidatorDataSufficiencySchema.nullable(),
  reviewGate: LayoutValidatorReviewGateSchema.nullable(),
}).strict();
export type LayoutValidatorWitness = z.infer<typeof LayoutValidatorWitnessSchema>;

const LayoutValidatorSummarySchema = z.object({
  pass: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  notChecked: z.number().int().nonnegative(),
  inapplicable: z.number().int().nonnegative(),
  requiresHumanReview: z.number().int().nonnegative(),
}).strict();

export const LayoutValidatorRunSchema = z.object({
  schemaVersion: z.literal(LAYOUT_VALIDATOR_SCHEMA_VERSION),
  validatorVersion: z.literal(LAYOUT_VALIDATOR_VERSION),
  validatorDigest: z.string().regex(SHA256_HEX),
  snapshotDigest: z.string().regex(SHA256_HEX),
  contextDigest: z.string().regex(SHA256_HEX),
  witnesses: z.array(LayoutValidatorWitnessSchema).length(LAYOUT_VALIDATOR_RULE_IDS.length),
  summary: LayoutValidatorSummarySchema,
  proofDigest: z.string().regex(SHA256_HEX),
}).strict();
export type LayoutValidatorRun = z.infer<typeof LayoutValidatorRunSchema>;

interface Point2 {
  readonly x: number;
  readonly y: number;
}

interface WitnessInput {
  readonly ruleId: LayoutValidatorRuleId;
  readonly ruleVersion: string;
  readonly claimFamily: z.infer<typeof LayoutProofClaimFamilySchema>;
  readonly status: z.infer<typeof LayoutProofClaimStatusSchema>;
  readonly messageKey: string;
  readonly messageArgs: Readonly<Record<string, CanonicalJsonValue>>;
  readonly facts: Readonly<Record<string, CanonicalJsonValue>>;
  readonly derivation: string;
  readonly policyRefs: readonly string[];
  readonly snapshotRefs: readonly string[];
  readonly affectedObjectIds: readonly string[];
  readonly dataSufficiency: LayoutValidatorDataSufficiency | null;
  readonly reviewGate: LayoutValidatorReviewGate | null;
}

const VALIDATOR_DEFINITION: CanonicalJsonValue = {
  version: LAYOUT_VALIDATOR_VERSION,
  rules: [
    { id: "layout.snapshot_identity", version: "1", derivation: "layout.snapshot.digest" },
    { id: "layout.footprint_containment", version: "1", derivation: "layout.geometry.obb_polygon" },
    { id: "layout.seating_provision", version: "1", derivation: "layout.seating.chair_first_sum" },
    { id: "layout.primary_furniture_clearance", version: "1", derivation: "layout.geometry.convex_distance" },
    { id: "layout.budget", version: "1", derivation: "layout.money.minor_units" },
  ],
};

export const LAYOUT_VALIDATOR_DIGEST = sha256Hex(
  `${LAYOUT_VALIDATOR_DOMAIN_PREFIX}${stableCanonicalJson(VALIDATOR_DEFINITION)}`,
);

function roundMetres(value: number): number {
  const factor = 10 ** METRE_ROUNDING_DECIMALS;
  return Math.round(value * factor) / factor;
}

function objectFootprint(object: LayoutSnapshotPlacedObject): readonly Point2[] {
  const halfWidth = (object.assetDefinition.widthM * object.scale) / 2;
  const halfDepth = (object.assetDefinition.depthM * object.scale) / 2;
  const cosine = Math.cos(object.rotation.y);
  const sine = Math.sin(object.rotation.y);
  const localCorners: readonly Point2[] = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ];

  return localCorners.map((corner) => ({
    x: object.position.x + corner.x * cosine - corner.y * sine,
    y: object.position.z + corner.x * sine + corner.y * cosine,
  }));
}

function distanceSquared(left: Point2, right: Point2): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return Math.sqrt(distanceSquared(point, start));
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared),
  );
  return Math.sqrt(
    distanceSquared(point, {
      x: start.x + projection * segmentX,
      y: start.y + projection * segmentY,
    }),
  );
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  const epsilon = 1e-12;
  return Math.abs(orientation(start, end, point)) <= epsilon
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

function segmentsIntersect(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC < 0 && abD > 0) || (abC > 0 && abD < 0))
    && ((cdA < 0 && cdB > 0) || (cdA > 0 && cdB < 0))) return true;
  return pointOnSegment(c, a, b)
    || pointOnSegment(d, a, b)
    || pointOnSegment(a, c, d)
    || pointOnSegment(b, c, d);
}

function pointInPolygon(point: Point2, polygon: readonly Point2[], toleranceM: number): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    if (pointSegmentDistance(point, start, end) <= toleranceM) return true;
    const crosses = (start.y > point.y) !== (end.y > point.y)
      && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonDistance(left: readonly Point2[], right: readonly Point2[]): number {
  if (left.some((point) => pointInPolygon(point, right, 0))
    || right.some((point) => pointInPolygon(point, left, 0))) return 0;

  let minimum = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex];
    const leftEnd = left[(leftIndex + 1) % left.length];
    if (leftStart === undefined || leftEnd === undefined) continue;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex];
      const rightEnd = right[(rightIndex + 1) % right.length];
      if (rightStart === undefined || rightEnd === undefined) continue;
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return 0;
      minimum = Math.min(
        minimum,
        pointSegmentDistance(leftStart, rightStart, rightEnd),
        pointSegmentDistance(leftEnd, rightStart, rightEnd),
        pointSegmentDistance(rightStart, leftStart, leftEnd),
        pointSegmentDistance(rightEnd, leftStart, leftEnd),
      );
    }
  }
  return minimum;
}

function makeWitness(input: WitnessInput): LayoutValidatorWitness {
  const body = {
    ...input,
    policyRefs: [...input.policyRefs].sort(),
    snapshotRefs: [...input.snapshotRefs].sort(),
    affectedObjectIds: [...input.affectedObjectIds].sort(),
  };
  const witnessId = sha256Hex(
    `${WITNESS_DOMAIN_PREFIX}${stableCanonicalJson(body as CanonicalJsonValue)}`,
  );
  return LayoutValidatorWitnessSchema.parse({ witnessId, ...body });
}

function policyRefs(context: LayoutValidatorContext): string[] {
  return [
    `${context.policyBundleId}@${context.policyBundleVersion}`,
    ...(context.policyBundleDigest === null ? [] : [context.policyBundleDigest]),
  ];
}

function snapshotIdentityWitness(
  snapshot: CanonicalLayoutSnapshotV0,
  context: LayoutValidatorContext,
  snapshotDigest: string,
): LayoutValidatorWitness {
  const policyMatches = snapshot.policyBundle.policyBundleId === context.policyBundleId
    && snapshot.policyBundle.policyBundleVersion === context.policyBundleVersion
    && snapshot.policyBundle.policyBundleDigest === context.policyBundleDigest;
  return makeWitness({
    ruleId: "layout.snapshot_identity",
    ruleVersion: "1",
    claimFamily: "venue_specific",
    status: policyMatches ? "pass" : "fail",
    messageKey: policyMatches ? "layout_snapshot_identity_match" : "layout_snapshot_policy_mismatch",
    messageArgs: { policyMatches },
    facts: {
      objectCount: snapshot.objects.length,
      policyMatches,
      snapshotPolicyBundleId: snapshot.policyBundle.policyBundleId,
      snapshotPolicyBundleVersion: snapshot.policyBundle.policyBundleVersion,
      contextPolicyBundleId: context.policyBundleId,
      contextPolicyBundleVersion: context.policyBundleVersion,
    },
    derivation: "layout.snapshot.digest",
    policyRefs: policyRefs(context),
    snapshotRefs: [snapshotDigest],
    affectedObjectIds: [],
    dataSufficiency: null,
    reviewGate: policyMatches ? null : {
      reason: "venue_policy_requires_review",
      reviewerRole: "venue_operations_manager",
      blockingMode: "blocking",
      requiredDataCategories: ["policy_reference"],
      messageKey: "review_gate_venue_policy",
    },
  });
}

function containmentWitness(
  snapshot: CanonicalLayoutSnapshotV0,
  context: LayoutValidatorContext,
  snapshotDigest: string,
): LayoutValidatorWitness {
  const outline = snapshot.venueRuntime.floorPlanOutline;
  const toleranceM = snapshot.tolerancePolicy.floorContainmentToleranceM;
  const outside = snapshot.objects.filter((object) =>
    objectFootprint(object).some((corner) => !pointInPolygon(corner, outline, toleranceM))
  );
  return makeWitness({
    ruleId: "layout.footprint_containment",
    ruleVersion: "1",
    claimFamily: "operational_setup",
    status: outside.length === 0 ? "pass" : "fail",
    messageKey: outside.length === 0
      ? "layout_footprints_inside_room"
      : "layout_footprints_outside_room",
    messageArgs: { outsideCount: outside.length },
    facts: {
      checkedObjectCount: snapshot.objects.length,
      outsideObjectCount: outside.length,
      outsideObjectIds: outside.map((object) => object.objectId).sort(),
      containmentToleranceM: toleranceM,
      footprintMethod: "oriented_bounding_box",
    },
    derivation: "layout.geometry.obb_polygon",
    policyRefs: policyRefs(context),
    snapshotRefs: [snapshotDigest],
    affectedObjectIds: outside.map((object) => object.objectId),
    dataSufficiency: null,
    reviewGate: null,
  });
}

function seatingWitness(
  snapshot: CanonicalLayoutSnapshotV0,
  context: LayoutValidatorContext,
  snapshotDigest: string,
): LayoutValidatorWitness {
  const chairs = snapshot.objects.filter((object) => object.assetDefinition.category === "chair");
  const seatingBasis = chairs.length > 0
    ? chairs
    : snapshot.objects.filter((object) => object.assetDefinition.category === "table");
  const seatsProvided = seatingBasis.reduce(
    (sum, object) => sum + (object.assetDefinition.seatCount ?? 0),
    0,
  );
  const deficit = Math.max(0, snapshot.guestCount - seatsProvided);
  return makeWitness({
    ruleId: "layout.seating_provision",
    ruleVersion: "1",
    claimFamily: "capacity",
    status: deficit === 0 ? "pass" : "fail",
    messageKey: deficit === 0 ? "layout_seating_provision_met" : "layout_seating_provision_shortfall",
    messageArgs: { guestCount: snapshot.guestCount, seatsProvided, deficit },
    facts: {
      guestCount: snapshot.guestCount,
      seatsProvided,
      deficit,
      basis: chairs.length > 0 ? "chair_objects" : "table_seat_counts",
      basisObjectCount: seatingBasis.length,
    },
    derivation: "layout.seating.chair_first_sum",
    policyRefs: policyRefs(context),
    snapshotRefs: [snapshotDigest],
    affectedObjectIds: [],
    dataSufficiency: null,
    reviewGate: null,
  });
}

const PRIMARY_CATEGORIES = new Set(["table", "stage", "lectern", "barrier", "av", "other"]);

function clearanceWitness(
  snapshot: CanonicalLayoutSnapshotV0,
  context: LayoutValidatorContext,
  snapshotDigest: string,
): LayoutValidatorWitness {
  const objects = snapshot.objects.filter((object) => PRIMARY_CATEGORIES.has(object.assetDefinition.category));
  if (objects.length < 2) {
    return makeWitness({
      ruleId: "layout.primary_furniture_clearance",
      ruleVersion: "1",
      claimFamily: "operational_setup",
      status: "inapplicable",
      messageKey: "layout_primary_clearance_inapplicable",
      messageArgs: { primaryObjectCount: objects.length },
      facts: { primaryObjectCount: objects.length, checkedPairCount: 0 },
      derivation: "layout.geometry.convex_distance",
      policyRefs: policyRefs(context),
      snapshotRefs: [snapshotDigest],
      affectedObjectIds: [],
      dataSufficiency: null,
      reviewGate: null,
    });
  }

  let minimumM = Number.POSITIVE_INFINITY;
  let minimumPair: readonly [LayoutSnapshotPlacedObject, LayoutSnapshotPlacedObject] | null = null;
  let checkedPairCount = 0;
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    const left = objects[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const right = objects[rightIndex];
      if (right === undefined) continue;
      checkedPairCount += 1;
      const distanceM = polygonDistance(objectFootprint(left), objectFootprint(right));
      if (distanceM < minimumM) {
        minimumM = distanceM;
        minimumPair = [left, right];
      }
    }
  }

  const measuredM = roundMetres(minimumM);
  const requiredM = context.minPrimaryFurnitureClearanceM;
  const warningBoundaryM = requiredM + context.clearanceWarningMarginM;
  const status = measuredM < requiredM ? "fail" : measuredM < warningBoundaryM ? "warn" : "pass";
  const affectedObjectIds = minimumPair === null ? [] : minimumPair.map((object) => object.objectId);
  return makeWitness({
    ruleId: "layout.primary_furniture_clearance",
    ruleVersion: "1",
    claimFamily: "operational_setup",
    status,
    messageKey: status === "fail"
      ? "layout_primary_clearance_shortfall"
      : status === "warn"
        ? "layout_primary_clearance_near_threshold"
        : "layout_primary_clearance_met",
    messageArgs: { measuredM, requiredM },
    facts: {
      primaryObjectCount: objects.length,
      checkedPairCount,
      measuredM,
      requiredM,
      warningBoundaryM,
      shortfallM: roundMetres(Math.max(0, requiredM - measuredM)),
      closestObjectIds: [...affectedObjectIds].sort(),
    },
    derivation: "layout.geometry.convex_distance",
    policyRefs: policyRefs(context),
    snapshotRefs: [snapshotDigest],
    affectedObjectIds,
    dataSufficiency: null,
    reviewGate: status === "warn" ? {
      reason: "near_threshold",
      reviewerRole: "venue_operations_manager",
      blockingMode: "non_blocking",
      requiredDataCategories: ["affected_object_refs"],
      messageKey: "review_gate_near_threshold",
    } : null,
  });
}

function budgetWitness(
  context: LayoutValidatorContext,
  snapshotDigest: string,
): LayoutValidatorWitness {
  if (context.pricing === null) {
    return makeWitness({
      ruleId: "layout.budget",
      ruleVersion: "1",
      claimFamily: "budget",
      status: "not_checked",
      messageKey: "layout_budget_not_checked",
      messageArgs: {},
      facts: { pricingAvailable: false },
      derivation: "layout.money.minor_units",
      policyRefs: policyRefs(context),
      snapshotRefs: [snapshotDigest],
      affectedObjectIds: [],
      dataSufficiency: {
        outcome: "not_checked",
        surface: "validator_kernel",
        requiredInputCategories: ["venue_data", "provenance"],
        messageKey: "data_sufficiency_not_checked",
      },
      reviewGate: {
        reason: "missing_required_data",
        reviewerRole: "venue_events_team",
        blockingMode: "blocks_export_only",
        requiredDataCategories: ["venue_data_request_field"],
        messageKey: "review_gate_missing_data",
      },
    });
  }

  if (context.pricing.budgetLimitMinor === null) {
    return makeWitness({
      ruleId: "layout.budget",
      ruleVersion: "1",
      claimFamily: "budget",
      status: "inapplicable",
      messageKey: "layout_budget_limit_not_supplied",
      messageArgs: {},
      facts: {
        pricingAvailable: true,
        projectedTotalMinor: context.pricing.projectedTotalMinor,
        priceBookRef: context.pricing.priceBookRef,
      },
      derivation: "layout.money.minor_units",
      policyRefs: policyRefs(context),
      snapshotRefs: [snapshotDigest],
      affectedObjectIds: [],
      dataSufficiency: null,
      reviewGate: null,
    });
  }

  const varianceMinor = context.pricing.budgetLimitMinor - context.pricing.projectedTotalMinor;
  return makeWitness({
    ruleId: "layout.budget",
    ruleVersion: "1",
    claimFamily: "budget",
    status: varianceMinor >= 0 ? "pass" : "fail",
    messageKey: varianceMinor >= 0 ? "layout_budget_within_limit" : "layout_budget_over_limit",
    messageArgs: { varianceMinor },
    facts: {
      currency: context.pricing.currency,
      budgetLimitMinor: context.pricing.budgetLimitMinor,
      projectedTotalMinor: context.pricing.projectedTotalMinor,
      varianceMinor,
      overrunMinor: Math.max(0, -varianceMinor),
      priceBookRef: context.pricing.priceBookRef,
    },
    derivation: "layout.money.minor_units",
    policyRefs: [...policyRefs(context), context.pricing.priceBookRef],
    snapshotRefs: [snapshotDigest],
    affectedObjectIds: [],
    dataSufficiency: null,
    reviewGate: null,
  });
}

function summarize(witnesses: readonly LayoutValidatorWitness[]): z.infer<typeof LayoutValidatorSummarySchema> {
  return {
    pass: witnesses.filter((witness) => witness.status === "pass").length,
    warn: witnesses.filter((witness) => witness.status === "warn").length,
    fail: witnesses.filter((witness) => witness.status === "fail").length,
    notChecked: witnesses.filter((witness) => witness.status === "not_checked").length,
    inapplicable: witnesses.filter((witness) => witness.status === "inapplicable").length,
    requiresHumanReview: witnesses.filter((witness) => witness.status === "requires_human_review").length,
  };
}

export function runLayoutValidator(
  snapshotInput: CanonicalLayoutSnapshotV0,
  contextInput: LayoutValidatorContext,
): LayoutValidatorRun {
  const snapshot = normalizeCanonicalLayoutSnapshot(
    CanonicalLayoutSnapshotV0Schema.parse(snapshotInput),
  );
  const context = LayoutValidatorContextSchema.parse(contextInput);
  const snapshotDigest = canonicalLayoutSnapshotDigest(snapshot);
  const contextDigest = sha256Hex(
    `${LAYOUT_VALIDATOR_DOMAIN_PREFIX}context\n${stableCanonicalJson(context as CanonicalJsonValue)}`,
  );
  const witnesses = [
    snapshotIdentityWitness(snapshot, context, snapshotDigest),
    containmentWitness(snapshot, context, snapshotDigest),
    seatingWitness(snapshot, context, snapshotDigest),
    clearanceWitness(snapshot, context, snapshotDigest),
    budgetWitness(context, snapshotDigest),
  ].sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const proofBody = {
    schemaVersion: LAYOUT_VALIDATOR_SCHEMA_VERSION,
    validatorVersion: LAYOUT_VALIDATOR_VERSION,
    validatorDigest: LAYOUT_VALIDATOR_DIGEST,
    snapshotDigest,
    contextDigest,
    witnesses,
    summary: summarize(witnesses),
  };
  return LayoutValidatorRunSchema.parse({
    ...proofBody,
    proofDigest: sha256Hex(
      `${PROOF_DOMAIN_PREFIX}${stableCanonicalJson(proofBody as CanonicalJsonValue)}`,
    ),
  });
}

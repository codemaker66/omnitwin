import { z } from "zod";
import {
  CanonicalLayoutSnapshotV0Schema,
  LayoutSnapshotPolicyBundleReferenceSchema,
  LayoutSnapshotTolerancePolicySchema,
} from "./canonical-layout-snapshot.js";
import { AssetDefinitionIdSchema, ConfigurationIdSchema } from "./configuration.js";
import { CrowdSimulatorSourceNameSchema } from "./crowd-simulation-replay.js";
import {
  GuestFlowReplayInputSchema,
  GuestFlowReplayMetricsSchema,
  RouteConflictSchema,
} from "./guest-flow-replay.js";
import { LayoutValidatorRunSchema } from "./layout-validator.js";
import {
  FloorPlanOutlineSchema,
  SpaceDimensionsSchema,
  SpaceIdSchema,
  SpaceSlugSchema,
} from "./space.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_MINOR_UNIT = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const EVENT_ARCHITECT_SCHEMA_VERSION = "venviewer.event-architect.v0";
export const EVENT_ARCHITECT_ENGINE_VERSION = "0.2.0";

export const EventArchitectLayoutStyleSchema = z.enum(["dinner-rounds", "theatre"]);
export type EventArchitectLayoutStyle = z.infer<typeof EventArchitectLayoutStyleSchema>;

export const EventArchitectServiceModelSchema = z.enum([
  "none",
  "plated",
  "buffet",
  "reception",
]);
export type EventArchitectServiceModel = z.infer<typeof EventArchitectServiceModelSchema>;

export const EventArchitectAccessibilityRequirementSchema = z.enum([
  "step_free_route",
  "wheelchair_spaces",
  "hearing_loop",
]);
export type EventArchitectAccessibilityRequirement = z.infer<
  typeof EventArchitectAccessibilityRequirementSchema
>;

export const EventArchitectBriefSchema = z.object({
  eventName: z.string().trim().min(1).max(200),
  eventType: z.string().trim().min(1).max(120),
  guestCount: z.number().int().positive().max(300),
  layoutStyle: EventArchitectLayoutStyleSchema,
  budgetLimitMinor: SAFE_MINOR_UNIT.nullable(),
  preferredDate: z.string().trim().min(1).max(40).nullable(),
  startTime: z.string().trim().min(1).max(40).nullable(),
  endTime: z.string().trim().min(1).max(40).nullable(),
  serviceModel: EventArchitectServiceModelSchema,
  accessibilityRequirements: z.array(EventArchitectAccessibilityRequirementSchema),
  planningPrompt: z.string().trim().max(2000).nullable(),
}).strict();
export type EventArchitectBrief = z.infer<typeof EventArchitectBriefSchema>;

export const EventArchitectRoomContextSchema = z.object({
  venueId: VenueIdSchema,
  venueSlug: VenueSlugSchema,
  spaceId: SpaceIdSchema,
  spaceSlug: SpaceSlugSchema,
  spaceName: z.string().trim().min(1).max(200),
  floorPlanOutline: FloorPlanOutlineSchema,
  floorPlanOutlineDigest: z.string().regex(SHA256_HEX).nullable(),
  spaceDimensions: SpaceDimensionsSchema,
  roomGeometrySource: z.enum([
    "space_floor_plan_outline",
    "hand_authored_room_geometry",
    "runtime_manifest",
  ]),
  runtimeVenueManifestDigest: z.string().regex(SHA256_HEX).nullable(),
  runtimePackageId: z.string().trim().min(1).max(160).nullable(),
}).strict();
export type EventArchitectRoomContext = z.infer<typeof EventArchitectRoomContextSchema>;

export const EventArchitectPricingCatalogueSchema = z.object({
  priceBookRef: z.string().trim().min(1).max(255),
  priceBookDigest: z.string().regex(SHA256_HEX).nullable(),
  currency: z.literal("GBP"),
  roomHireMinor: SAFE_MINOR_UNIT,
  perGuestMinor: SAFE_MINOR_UNIT,
  perAssetMinor: z.record(AssetDefinitionIdSchema, SAFE_MINOR_UNIT),
}).strict();
export type EventArchitectPricingCatalogue = z.infer<
  typeof EventArchitectPricingCatalogueSchema
>;

export const EventArchitectValidatorPolicySchema = z.object({
  minPrimaryFurnitureClearanceM: z.number().nonnegative().max(20),
  clearanceWarningMarginM: z.number().nonnegative().max(20),
}).strict();
export type EventArchitectValidatorPolicy = z.infer<
  typeof EventArchitectValidatorPolicySchema
>;

export const EventArchitectRequestSchema = z.object({
  configurationId: ConfigurationIdSchema,
  createdBy: UserIdSchema.nullable(),
  configurationUpdatedAt: z.string().datetime(),
  snapshotCreatedAt: z.string().datetime(),
  brief: EventArchitectBriefSchema,
  room: EventArchitectRoomContextSchema,
  policyBundle: LayoutSnapshotPolicyBundleReferenceSchema,
  tolerancePolicy: LayoutSnapshotTolerancePolicySchema,
  validatorPolicy: EventArchitectValidatorPolicySchema,
  pricingCatalogue: EventArchitectPricingCatalogueSchema.nullable(),
}).strict();
export type EventArchitectRequest = z.infer<typeof EventArchitectRequestSchema>;

export const EVENT_ARCHITECT_STRATEGIES = [
  "comfort_first",
  "balanced",
  "capacity_first",
] as const;
export const EventArchitectStrategySchema = z.enum(EVENT_ARCHITECT_STRATEGIES);
export type EventArchitectStrategy = z.infer<typeof EventArchitectStrategySchema>;

export const EventArchitectStrategyParametersSchema = z.object({
  minWallOffsetM: z.number().nonnegative().max(20),
  primaryAisleM: z.number().positive().max(20),
  rowPitchM: z.number().positive().max(20),
  seatPitchM: z.number().positive().max(20),
  tableGroupSpacingM: z.number().positive().max(20),
}).strict();
export type EventArchitectStrategyParameters = z.infer<
  typeof EventArchitectStrategyParametersSchema
>;

export const EventArchitectPriceLineSchema = z.object({
  assetDefinitionId: AssetDefinitionIdSchema,
  quantity: z.number().int().nonnegative(),
  unitMinor: SAFE_MINOR_UNIT,
  subtotalMinor: SAFE_MINOR_UNIT,
}).strict();
export type EventArchitectPriceLine = z.infer<typeof EventArchitectPriceLineSchema>;

export const EventArchitectProjectedCostSchema = z.object({
  currency: z.literal("GBP"),
  priceBookRef: z.string().trim().min(1).max(255),
  roomHireMinor: SAFE_MINOR_UNIT,
  guestSubtotalMinor: SAFE_MINOR_UNIT,
  assetLines: z.array(EventArchitectPriceLineSchema),
  totalMinor: SAFE_MINOR_UNIT,
}).strict();
export type EventArchitectProjectedCost = z.infer<typeof EventArchitectProjectedCostSchema>;

export const EventArchitectGuestFlowEvidenceSchema = z.object({
  evidenceStatus: z.literal("simulated_planning_support"),
  disclosureLabel: z.literal("Simulated guest flow - planning support"),
  humanReviewRequired: z.literal(true),
  input: GuestFlowReplayInputSchema,
  inputHash: z.string().regex(SHA256_HEX),
  artifactHash: z.string().regex(SHA256_HEX),
  simulatorSource: CrowdSimulatorSourceNameSchema,
  metrics: GuestFlowReplayMetricsSchema,
  navmeshHash: z.string().regex(SHA256_HEX),
  navmeshAlgorithm: z.literal("grid_navmesh_fallback_v0"),
  navmeshWalkableCellCount: z.number().int().nonnegative(),
  navmeshBlockedCellCount: z.number().int().nonnegative(),
  limitations: z.array(z.string().trim().min(1).max(240)).min(1),
  routeConflictMarkers: z.array(RouteConflictSchema).max(12),
  routeConflictMarkersTruncated: z.boolean(),
  reviewGate: z.object({
    status: z.literal("requires_human_review"),
    reason: z.literal("planning_assumptions_and_simplified_crowd_model"),
    requiredData: z.tuple([
      z.literal("surveyed_door_positions"),
      z.literal("reviewed_route_model"),
      z.literal("venue_operations_signoff"),
    ]),
    blockingForOpsCompilation: z.literal(true),
  }).strict(),
}).strict();
export type EventArchitectGuestFlowEvidence = z.infer<
  typeof EventArchitectGuestFlowEvidenceSchema
>;

export const EventArchitectRepairActionSchema = z.enum([
  "add_seating",
  "move_inside_room",
  "increase_clearance",
  "reduce_budget_scope",
  "supply_pricing_data",
]);
export type EventArchitectRepairAction = z.infer<typeof EventArchitectRepairActionSchema>;

export const EventArchitectRepairHintSchema = z.object({
  hintId: z.string().uuid(),
  action: EventArchitectRepairActionSchema,
  sourceWitnessId: z.string().regex(SHA256_HEX),
  affectedObjectIds: z.array(z.string().uuid()),
  quantity: z.number().int().positive().nullable(),
  amountM: z.number().positive().nullable(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  messageKey: z.string().regex(/^event_architect_[a-z0-9_]+$/).max(120),
}).strict();
export type EventArchitectRepairHint = z.infer<typeof EventArchitectRepairHintSchema>;

export const EventArchitectCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  rank: z.number().int().min(1).max(3),
  strategy: EventArchitectStrategySchema,
  strategyParameters: EventArchitectStrategyParametersSchema,
  snapshot: CanonicalLayoutSnapshotV0Schema,
  snapshotDigest: z.string().regex(SHA256_HEX),
  projectedCost: EventArchitectProjectedCostSchema.nullable(),
  validation: LayoutValidatorRunSchema,
  guestFlowEvidence: EventArchitectGuestFlowEvidenceSchema,
  repairHints: z.array(EventArchitectRepairHintSchema),
}).strict();
export type EventArchitectCandidate = z.infer<typeof EventArchitectCandidateSchema>;

export const EventArchitectRunSchema = z.object({
  schemaVersion: z.literal(EVENT_ARCHITECT_SCHEMA_VERSION),
  engineVersion: z.literal(EVENT_ARCHITECT_ENGINE_VERSION),
  engineDigest: z.string().regex(SHA256_HEX),
  requestDigest: z.string().regex(SHA256_HEX),
  runId: z.string().uuid(),
  candidates: z.array(EventArchitectCandidateSchema).length(3),
}).strict();
export type EventArchitectRun = z.infer<typeof EventArchitectRunSchema>;

// Authenticated API boundary. Venue geometry, policy references, canonical
// timestamps, asset pricing, and actor identity are resolved server-side so a
// browser cannot present its own facts as frozen evidence.
export const CreateEventArchitectRunInputSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  idempotencyKey: z.string().trim().min(8).max(160),
  brief: EventArchitectBriefSchema,
}).strict();
export type CreateEventArchitectRunInput = z.infer<
  typeof CreateEventArchitectRunInputSchema
>;

export const PersistedEventArchitectRunSchema = z.object({
  run: EventArchitectRunSchema,
  createdBy: UserIdSchema,
  createdAt: z.string().datetime(),
  selectedCandidateId: z.string().uuid().nullable(),
  selectedConfigurationId: ConfigurationIdSchema.nullable(),
  selectedSnapshotDigest: z.string().regex(SHA256_HEX).nullable(),
  selectedProofDigest: z.string().regex(SHA256_HEX).nullable(),
}).strict();
export type PersistedEventArchitectRun = z.infer<
  typeof PersistedEventArchitectRunSchema
>;

export const SelectEventArchitectCandidateInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
  expectedRequestDigest: z.string().regex(SHA256_HEX),
}).strict();
export type SelectEventArchitectCandidateInput = z.infer<
  typeof SelectEventArchitectCandidateInputSchema
>;

export const EventArchitectCandidateSelectionSchema = z.object({
  runId: z.string().uuid(),
  candidateId: z.string().uuid(),
  configurationId: ConfigurationIdSchema,
  snapshotDigest: z.string().regex(SHA256_HEX),
  proofDigest: z.string().regex(SHA256_HEX),
  plannerPath: z.string().regex(/^\/plan\/[a-zA-Z0-9-]+$/u),
  selectedAt: z.string().datetime(),
}).strict();
export type EventArchitectCandidateSelection = z.infer<
  typeof EventArchitectCandidateSelectionSchema
>;

export const EVENT_ARCHITECT_OPS_REVIEW_SCHEMA_VERSION =
  "venviewer.event-architect-ops-review.v0";

export const EVENT_ARCHITECT_OPS_EVIDENCE_KINDS = [
  "surveyed_door_positions",
  "reviewed_route_model",
  "venue_operations_signoff",
] as const;
export const EventArchitectOpsEvidenceKindSchema = z.enum(
  EVENT_ARCHITECT_OPS_EVIDENCE_KINDS,
);
export type EventArchitectOpsEvidenceKind = z.infer<
  typeof EventArchitectOpsEvidenceKindSchema
>;

export const EventArchitectOpsEvidenceWitnessSchema = z.object({
  kind: EventArchitectOpsEvidenceKindSchema,
  sourceLabel: z.string().trim().min(3).max(200),
  sourceReference: z.string().trim().min(3).max(500),
  contentDigest: z.string().regex(SHA256_HEX),
  observedAt: z.string().datetime(),
}).strict();
export type EventArchitectOpsEvidenceWitness = z.infer<
  typeof EventArchitectOpsEvidenceWitnessSchema
>;

export const EventArchitectOpsEvidenceWitnessesSchema = z.array(
  EventArchitectOpsEvidenceWitnessSchema,
).length(EVENT_ARCHITECT_OPS_EVIDENCE_KINDS.length).superRefine((witnesses, ctx) => {
  for (const kind of EVENT_ARCHITECT_OPS_EVIDENCE_KINDS) {
    if (witnesses.filter((witness) => witness.kind === kind).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Exactly one ${kind} witness is required.`,
      });
    }
  }
});

export const EventArchitectOpsReviewDecisionSchema = z.enum(["approved", "rejected"]);
export type EventArchitectOpsReviewDecision = z.infer<
  typeof EventArchitectOpsReviewDecisionSchema
>;

export const EventArchitectOpsReviewerAuthoritySchema = z.enum([
  "venue_staff",
  "venue_hallkeeper",
  "venue_admin",
  "platform_admin",
]);
export type EventArchitectOpsReviewerAuthority = z.infer<
  typeof EventArchitectOpsReviewerAuthoritySchema
>;

export const CreateEventArchitectOpsReviewInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
  expectedRequestDigest: z.string().regex(SHA256_HEX),
  expectedSnapshotDigest: z.string().regex(SHA256_HEX),
  expectedProofDigest: z.string().regex(SHA256_HEX),
  expectedGuestFlowArtifactHash: z.string().regex(SHA256_HEX),
  decision: EventArchitectOpsReviewDecisionSchema,
  note: z.string().trim().min(10).max(2000),
  validUntil: z.string().datetime(),
  witnesses: EventArchitectOpsEvidenceWitnessesSchema,
}).strict();
export type CreateEventArchitectOpsReviewInput = z.infer<
  typeof CreateEventArchitectOpsReviewInputSchema
>;

export const EventArchitectOpsReviewArtifactSchema = z.object({
  schemaVersion: z.literal(EVENT_ARCHITECT_OPS_REVIEW_SCHEMA_VERSION),
  artifactId: z.string().uuid(),
  artifactDigest: z.string().regex(SHA256_HEX),
  candidateId: z.string().uuid(),
  runId: z.string().uuid(),
  venueId: VenueIdSchema,
  configurationId: ConfigurationIdSchema,
  decision: EventArchitectOpsReviewDecisionSchema,
  reviewerUserId: UserIdSchema,
  reviewerAuthority: EventArchitectOpsReviewerAuthoritySchema,
  requestDigest: z.string().regex(SHA256_HEX),
  snapshotDigest: z.string().regex(SHA256_HEX),
  proofDigest: z.string().regex(SHA256_HEX),
  guestFlowArtifactHash: z.string().regex(SHA256_HEX),
  witnesses: EventArchitectOpsEvidenceWitnessesSchema,
  note: z.string().trim().min(10).max(2000),
  reviewedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
}).strict();
export type EventArchitectOpsReviewArtifact = z.infer<
  typeof EventArchitectOpsReviewArtifactSchema
>;

export const EventArchitectOpsReviewGateSchema = z.object({
  candidateId: z.string().uuid(),
  status: z.enum(["open", "approved", "rejected", "expired"]),
  blockingForOpsCompilation: z.boolean(),
  requiredData: z.tuple([
    z.literal("surveyed_door_positions"),
    z.literal("reviewed_route_model"),
    z.literal("venue_operations_signoff"),
  ]),
  activeArtifact: EventArchitectOpsReviewArtifactSchema.nullable(),
  history: z.array(EventArchitectOpsReviewArtifactSchema),
}).strict();
export type EventArchitectOpsReviewGate = z.infer<
  typeof EventArchitectOpsReviewGateSchema
>;

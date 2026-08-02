import { z } from "zod";
import { CanonicalLayoutSnapshotV0Schema } from "./canonical-layout-snapshot.js";
import { ConfigurationIdSchema } from "./configuration.js";
import {
  EventIdSchema,
  EventPhaseIdSchema,
  EventPhaseTemplateKeySchema,
  EventStatusSchema,
  PhaseEvidencePlaceholderSchema,
  PhaseLayoutSnapshotIdSchema,
  PhaseLayoutSnapshotStatusSchema,
} from "./event-phase-graph.js";
import { SpaceIdSchema } from "./space.js";
import { UserIdSchema } from "./user.js";
import { TimezoneSchema, VenueIdSchema } from "./venue.js";
import { CurrencySchema } from "./pricing.js";
import { MinorUnitAmountSchema } from "./proposal.js";
import {
  ComfortConstraintStatusSchema,
  RevenueScenarioIdSchema,
  RevenueScenarioKindSchema,
  RevenueScenarioStatusSchema,
} from "./revenue-analytics.js";

/**
 * Eight elapsed days admits a seven-wall-day venue week across both DST
 * boundaries while keeping the response and snapshot payloads bounded.
 */
export const ROOM_LAYOUT_TIMELINE_MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1_000;

export const RoomLayoutTimelineScopeSchema = z.enum(["day", "week"]);
export type RoomLayoutTimelineScope = z.infer<typeof RoomLayoutTimelineScopeSchema>;

export const RoomLayoutTimelineLocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "anchorDate must use YYYY-MM-DD")
  .refine((value) => {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
  }, "anchorDate must be a real calendar date");

const TimelineIdentitySchema = {
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
};

const ExplicitTimelineQuerySchema = z.object({
  ...TimelineIdentitySchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
}).strict();

const ScopedTimelineQuerySchema = z.object({
  ...TimelineIdentitySchema,
  scope: RoomLayoutTimelineScopeSchema,
  anchorDate: RoomLayoutTimelineLocalDateSchema,
}).strict();

/**
 * Existing callers may supply an explicit UTC interval. Day/week callers send
 * a venue-local date and the API resolves the authoritative UTC bounds from
 * the venue timezone. The strict union rejects partial or mixed forms.
 */
export const RoomLayoutTimelineQuerySchema = z.union([
  ExplicitTimelineQuerySchema,
  ScopedTimelineQuerySchema,
]).superRefine((query, context) => {
  if (!("from" in query)) return;
  const fromMs = Date.parse(query.from);
  const toMs = Date.parse(query.to);
  if (toMs <= fromMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "to must be later than from",
    });
    return;
  }
  if (toMs - fromMs > ROOM_LAYOUT_TIMELINE_MAX_RANGE_MS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "Timeline range cannot exceed eight elapsed days",
    });
  }
});
export type RoomLayoutTimelineQuery = z.infer<typeof RoomLayoutTimelineQuerySchema>;

export const RoomLayoutTimelineInvalidReasonSchema = z.enum([
  "snapshot_status_invalid",
  "snapshot_not_frozen",
  "frozen_lineage_missing",
  "frozen_lineage_invalid",
  "canonical_lineage_mismatch",
  "proof_lineage_mismatch",
  "predecessor_lineage_mismatch",
  "payload_missing",
  "payload_schema_invalid",
  "snapshot_hash_missing",
  "snapshot_hash_mismatch",
  "coordinate_space_invalid",
  "venue_identity_mismatch",
  "space_identity_mismatch",
  "configuration_identity_mismatch",
  "object_count_mismatch",
  "guest_count_mismatch",
]);
export type RoomLayoutTimelineInvalidReason = z.infer<
  typeof RoomLayoutTimelineInvalidReasonSchema
>;

const AvailableKeyframeSchema = z.object({
  state: z.literal("available"),
  snapshotId: PhaseLayoutSnapshotIdSchema,
  snapshotStatus: z.literal("frozen"),
  canonicalSnapshotId: z.string().uuid(),
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  frozenBy: UserIdSchema,
  supersedesSnapshotId: PhaseLayoutSnapshotIdSchema.nullable(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime(),
  objectCount: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative().nullable(),
  payload: CanonicalLayoutSnapshotV0Schema,
}).strict();

const MissingKeyframeSchema = z.object({
  state: z.literal("missing"),
  reason: z.enum(["no_snapshot", "room_flip_gap"]),
  message: z.string().trim().min(1).max(160),
}).strict();

const InvalidKeyframeSchema = z.object({
  state: z.literal("invalid"),
  snapshotId: PhaseLayoutSnapshotIdSchema,
  snapshotStatus: PhaseLayoutSnapshotStatusSchema.nullable(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime().nullable(),
  reason: RoomLayoutTimelineInvalidReasonSchema,
  message: z.string().trim().min(1).max(160),
}).strict();

export const RoomLayoutTimelineKeyframeSchema = z.discriminatedUnion("state", [
  AvailableKeyframeSchema,
  MissingKeyframeSchema,
  InvalidKeyframeSchema,
]);
export type RoomLayoutTimelineKeyframe = z.infer<typeof RoomLayoutTimelineKeyframeSchema>;

export const RoomLayoutTimelineGuestsFigureSchema = z.object({
  value: z.number().int().nonnegative(),
  source: z.enum(["frozen_snapshot", "phase", "event"]),
}).strict();

export const RoomLayoutTimelineSeatedCapacityFigureSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    value: z.number().int().nonnegative(),
    source: z.literal("frozen_snapshot"),
    basis: z.enum(["chair_objects", "table_seat_counts"]),
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum(["no_valid_frozen_keyframe", "capacity_evidence_incomplete"]),
  }).strict(),
]);

/**
 * Phase records currently carry conflict evidence but no authoritative numeric
 * staffing headcount. Keep that evidence and say plainly that a count has not
 * been checked instead of turning labels or guesses into a number.
 */
export const RoomLayoutTimelineStaffingFigureSchema = z.object({
  state: z.literal("not_checked"),
  value: z.null(),
  source: z.literal("phase_staff_conflicts"),
  staffConflictsStatus: PhaseEvidencePlaceholderSchema,
  staffConflictsLabel: z.string().trim().min(1).max(120),
}).strict();

export const RoomLayoutTimelineRevenueFigureSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    source: z.literal("planning_scenario"),
    scenario: z.object({
      id: RevenueScenarioIdSchema,
      name: z.string().trim().min(1).max(500),
      status: RevenueScenarioStatusSchema,
      scenarioKind: RevenueScenarioKindSchema,
      currency: CurrencySchema,
      plannedGuestCount: z.number().int().nonnegative(),
      estimatedRevenueMinor: MinorUnitAmountSchema,
      comfortStatus: ComfortConstraintStatusSchema,
      reviewGateCount: z.number().int().nonnegative(),
      updatedAt: z.string().datetime(),
    }).strict(),
    disclosure: z.literal("Planning scenario estimate; not a quote or approval."),
  }).strict(),
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum([
      "no_valid_frozen_keyframe",
      "no_matching_planning_scenario",
      "planning_scenario_stale",
    ]),
  }).strict(),
  z.object({
    state: z.literal("restricted"),
    reason: z.literal("insufficient_commercial_access"),
  }).strict(),
]);

export const RoomLayoutTimelineFiguresSchema = z.object({
  guests: RoomLayoutTimelineGuestsFigureSchema,
  seatedCapacity: RoomLayoutTimelineSeatedCapacityFigureSchema,
  staffing: RoomLayoutTimelineStaffingFigureSchema,
  revenue: RoomLayoutTimelineRevenueFigureSchema,
}).strict();
export type RoomLayoutTimelineFigures = z.infer<typeof RoomLayoutTimelineFiguresSchema>;

export const RoomLayoutTimelineFrameSchema = z.object({
  id: EventPhaseIdSchema,
  kind: z.enum(["phase", "room_flip"]),
  eventId: EventIdSchema,
  eventName: z.string().trim().min(1).max(200),
  eventType: z.string().trim().max(80).nullable(),
  eventStatus: EventStatusSchema,
  eventGuestCount: z.number().int().nonnegative(),
  phaseId: EventPhaseIdSchema,
  phaseName: z.string().trim().min(1).max(100),
  templateKey: EventPhaseTemplateKeySchema.nullable(),
  sortOrder: z.number().int().nonnegative(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  guestCount: z.number().int().nonnegative().nullable(),
  opsTasksCount: z.number().int().nonnegative(),
  reviewGatesCount: z.number().int().nonnegative(),
  densityStatus: PhaseEvidencePlaceholderSchema,
  densityLabel: z.string().trim().min(1).max(120),
  staffConflictsStatus: PhaseEvidencePlaceholderSchema,
  staffConflictsLabel: z.string().trim().min(1).max(120),
  keyframe: RoomLayoutTimelineKeyframeSchema,
  figures: RoomLayoutTimelineFiguresSchema,
}).strict();
export type RoomLayoutTimelineFrame = z.infer<typeof RoomLayoutTimelineFrameSchema>;

const ExplicitAuthoritativeRangeSchema = z.object({
  scope: z.literal("custom"),
  anchorDate: z.null(),
  from: z.string().datetime(),
  to: z.string().datetime(),
}).strict();

const ScopedAuthoritativeRangeSchema = z.object({
  scope: RoomLayoutTimelineScopeSchema,
  anchorDate: RoomLayoutTimelineLocalDateSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
}).strict();

export const RoomLayoutTimelineRangeSchema = z.discriminatedUnion("scope", [
  ExplicitAuthoritativeRangeSchema,
  ScopedAuthoritativeRangeSchema,
]);
export type RoomLayoutTimelineRange = z.infer<typeof RoomLayoutTimelineRangeSchema>;

export const RoomLayoutTimelineResponseSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  timeZone: TimezoneSchema,
  /** Retained for existing clients; identical to range.from/range.to. */
  from: z.string().datetime(),
  to: z.string().datetime(),
  range: RoomLayoutTimelineRangeSchema,
  frames: z.array(RoomLayoutTimelineFrameSchema),
}).strict().superRefine((response, context) => {
  if (response.from !== response.range.from || response.to !== response.range.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["range"],
      message: "Authoritative range must match top-level from/to",
    });
  }
});
export type RoomLayoutTimelineResponse = z.infer<typeof RoomLayoutTimelineResponseSchema>;

/**
 * The browser chooses identities only. Geometry, counts, timestamps, digest,
 * proof linkage, and lifecycle state are resolved from persisted server data.
 */
export const FreezePhaseLayoutSnapshotParamsSchema = z.object({
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema,
}).strict();
export type FreezePhaseLayoutSnapshotParams = z.infer<
  typeof FreezePhaseLayoutSnapshotParamsSchema
>;

export const FreezePhaseLayoutSnapshotBodySchema = z.object({
  configurationId: ConfigurationIdSchema,
}).strict();
export type FreezePhaseLayoutSnapshotBody = z.infer<
  typeof FreezePhaseLayoutSnapshotBodySchema
>;

export const FreezePhaseLayoutSnapshotResponseSchema = z.object({
  outcome: z.enum(["created", "already_current"]),
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema,
  configurationId: ConfigurationIdSchema,
  snapshotId: PhaseLayoutSnapshotIdSchema,
  canonicalSnapshotId: z.string().uuid(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  frozenBy: UserIdSchema,
  status: z.literal("frozen"),
  coordinateSpace: z.literal("real_m_v1"),
  objectCount: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime(),
  supersedesSnapshotId: PhaseLayoutSnapshotIdSchema.nullable(),
}).strict();
export type FreezePhaseLayoutSnapshotResponse = z.infer<
  typeof FreezePhaseLayoutSnapshotResponseSchema
>;

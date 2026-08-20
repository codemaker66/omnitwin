import { z } from "zod";
import {
  CanonicalLayoutSnapshotV0Schema,
  canonicalLayoutSnapshotDigest,
} from "./canonical-layout-snapshot.js";
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
import { PhaseLayoutHistoricalRuntimeSchema } from "./phase-layout-runtime-binding.js";

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
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  snapshotStatus: z.literal("frozen"),
  canonicalSnapshotId: z.string().uuid(),
  proofDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  frozenBy: UserIdSchema,
  supersedesSnapshotId: PhaseLayoutSnapshotIdSchema.nullable(),
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime(),
  objectCount: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative(),
  payload: CanonicalLayoutSnapshotV0Schema,
  historicalRuntime: PhaseLayoutHistoricalRuntimeSchema,
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
}).strict().superRefine((frame, context) => {
  if (frame.id !== frame.phaseId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phaseId"],
      message: "Frame id must match phaseId",
    });
  }

  if ((frame.kind === "room_flip") !== (frame.templateKey === "room-flip")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["templateKey"],
      message: "Frame kind and templateKey must agree on room-flip identity",
    });
  }

  const startsAtMs = Date.parse(frame.startsAt);
  const endsAtMs = Date.parse(frame.endsAt);
  if (endsAtMs <= startsAtMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "Frame endsAt must be later than startsAt",
    });
  }

  if (
    frame.kind === "room_flip"
    && !(frame.keyframe.state === "missing" && frame.keyframe.reason === "room_flip_gap")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["keyframe"],
      message: "Room-flip frames must carry a missing room_flip_gap keyframe",
    });
  }
  if (
    frame.kind !== "room_flip"
    && frame.keyframe.state === "missing"
    && frame.keyframe.reason === "room_flip_gap"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["keyframe", "reason"],
      message: "Only room-flip frames may carry a room_flip_gap keyframe",
    });
  }

  if (frame.keyframe.state === "available") {
    const payloadDigest = canonicalLayoutSnapshotDigest(frame.keyframe.payload);
    if (frame.keyframe.snapshotHash !== payloadDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keyframe", "snapshotHash"],
        message: "Available keyframe snapshotHash must match its exact canonical payload.",
      });
    }
    if (frame.keyframe.objectCount !== frame.keyframe.payload.objects.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keyframe", "objectCount"],
        message: "Available keyframe objectCount must match its payload",
      });
    }
    if (frame.keyframe.guestCount !== frame.keyframe.payload.guestCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keyframe", "guestCount"],
        message: "Available keyframe guestCount must match its payload",
      });
    }
    const runtimeBinding = frame.keyframe.historicalRuntime.binding;
    if (
      runtimeBinding !== null &&
      (
        runtimeBinding.phaseLayoutSnapshotId !== frame.keyframe.snapshotId ||
        runtimeBinding.canonicalSnapshotId !== frame.keyframe.canonicalSnapshotId ||
        runtimeBinding.snapshotHash !== frame.keyframe.snapshotHash ||
        runtimeBinding.venueId !== frame.keyframe.payload.venueId ||
        runtimeBinding.spaceId !== frame.keyframe.payload.spaceId ||
        runtimeBinding.venueSlug !== frame.keyframe.payload.venueRuntime.venueSlug ||
        runtimeBinding.spaceSlug !== frame.keyframe.payload.venueRuntime.spaceSlug
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keyframe", "historicalRuntime", "binding"],
        message: "Historical runtime binding must match the exact frozen snapshot and room.",
      });
    }
  }

  const expectedGuests = frame.keyframe.state === "available"
    ? { source: "frozen_snapshot" as const, value: frame.keyframe.payload.guestCount }
    : frame.guestCount !== null
      ? { source: "phase" as const, value: frame.guestCount }
      : { source: "event" as const, value: frame.eventGuestCount };
  if (
    frame.figures.guests.source !== expectedGuests.source
    || frame.figures.guests.value !== expectedGuests.value
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["figures", "guests"],
      message: "Guests figure must match the authoritative keyframe, phase, or event source",
    });
  }

  const capacity = frame.figures.seatedCapacity;
  if (frame.keyframe.state !== "available") {
    if (capacity.state !== "unavailable" || capacity.reason !== "no_valid_frozen_keyframe") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["figures", "seatedCapacity"],
        message: "Capacity without an available keyframe must report no_valid_frozen_keyframe",
      });
    }
  } else {
    const objects = frame.keyframe.payload.objects;
    const chairs = objects.filter((object) => object.assetDefinition.category === "chair");
    const tables = objects.filter((object) => object.assetDefinition.category === "table");
    const complete = (candidates: typeof objects): boolean => candidates.length > 0
      && candidates.every((object) => (
        object.assetDefinition.seatCount !== null
        && Number.isInteger(object.assetDefinition.seatCount)
        && object.assetDefinition.seatCount > 0
      ));
    const seatingBasis = complete(chairs) ? chairs : complete(tables) ? tables : null;
    if (seatingBasis === null) {
      if (capacity.state !== "unavailable" || capacity.reason !== "capacity_evidence_incomplete") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figures", "seatedCapacity"],
          message: "Incomplete seating evidence must report capacity_evidence_incomplete",
        });
      }
    } else {
      const expectedBasis = seatingBasis === chairs ? "chair_objects" : "table_seat_counts";
      const expectedValue = seatingBasis.reduce(
        (sum, object) => sum + (object.assetDefinition.seatCount ?? 0),
        0,
      );
      if (
        capacity.state !== "available"
        || capacity.basis !== expectedBasis
        || capacity.value !== expectedValue
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figures", "seatedCapacity"],
          message: "Available capacity must match chair-first canonical seating evidence",
        });
      }
    }
  }

  const revenue = frame.figures.revenue;
  if (frame.keyframe.state === "available") {
    if (
      revenue.state === "available"
      && revenue.scenario.plannedGuestCount !== frame.keyframe.payload.guestCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["figures", "revenue", "scenario", "plannedGuestCount"],
        message: "Available revenue scenario guest count must match the frozen payload",
      });
    }
    if (revenue.state === "unavailable" && revenue.reason === "no_valid_frozen_keyframe") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["figures", "revenue", "reason"],
        message: "An available keyframe cannot report no_valid_frozen_keyframe revenue",
      });
    }
  } else if (
    revenue.state === "available"
    || (revenue.state === "unavailable" && revenue.reason !== "no_valid_frozen_keyframe")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["figures", "revenue"],
      message: "Revenue without an available keyframe must be restricted or unavailable for that reason",
    });
  }

  if (
    frame.figures.staffing.staffConflictsStatus !== frame.staffConflictsStatus
    || frame.figures.staffing.staffConflictsLabel !== frame.staffConflictsLabel
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["figures", "staffing"],
      message: "Staffing figure must match frame-level staff-conflict evidence",
    });
  }
});
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

  const fromMs = Date.parse(response.range.from);
  const toMs = Date.parse(response.range.to);
  if (toMs <= fromMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["range", "to"],
      message: "Authoritative range to must be later than from",
    });
  }

  const seenPhaseIds = new Set<string>();
  let previousFrame: RoomLayoutTimelineFrame | undefined;
  for (const [index, frame] of response.frames.entries()) {
    if (seenPhaseIds.has(frame.phaseId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", index, "phaseId"],
        message: "Timeline frames must have unique phase identities",
      });
    }
    seenPhaseIds.add(frame.phaseId);

    if (previousFrame !== undefined) {
      const previousStartsAtMs = Date.parse(previousFrame.startsAt);
      const frameStartsAtMs = Date.parse(frame.startsAt);
      if (
        previousStartsAtMs > frameStartsAtMs
        || (previousStartsAtMs === frameStartsAtMs && previousFrame.id.localeCompare(frame.id) > 0)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index],
          message: "Timeline frames must be ordered by startsAt and then id",
        });
      }
    }
    previousFrame = frame;

    const startsAtMs = Date.parse(frame.startsAt);
    const endsAtMs = Date.parse(frame.endsAt);
    if (startsAtMs >= toMs || endsAtMs <= fromMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", index],
        message: "Frame must overlap the authoritative range",
      });
    }

    if (frame.keyframe.state !== "available") continue;
    const payload = frame.keyframe.payload;
    if (
      payload.venueId !== response.venueId
      || payload.venueRuntime.venueId !== response.venueId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", index, "keyframe", "payload", "venueId"],
        message: "Available keyframe venue identity must match the timeline response",
      });
    }
    if (
      payload.spaceId !== response.spaceId
      || payload.venueRuntime.spaceId !== response.spaceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", index, "keyframe", "payload", "spaceId"],
        message: "Available keyframe space identity must match the timeline response",
      });
    }
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

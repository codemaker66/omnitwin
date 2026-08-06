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
import { VenueIdSchema } from "./venue.js";

/**
 * Eight elapsed days admits a seven-wall-day Europe/London week across both
 * DST boundaries while keeping the response and its snapshot payloads bounded.
 */
export const ROOM_LAYOUT_TIMELINE_MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1_000;

export const RoomLayoutTimelineQuerySchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
}).strict().superRefine((query, context) => {
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
  "payload_missing",
  "payload_schema_invalid",
  "snapshot_hash_missing",
  "snapshot_hash_mismatch",
  "coordinate_space_invalid",
  "venue_identity_mismatch",
  "space_identity_mismatch",
  "configuration_identity_mismatch",
  "object_count_mismatch",
]);
export type RoomLayoutTimelineInvalidReason = z.infer<
  typeof RoomLayoutTimelineInvalidReasonSchema
>;

const AvailableKeyframeSchema = z.object({
  state: z.literal("available"),
  snapshotId: PhaseLayoutSnapshotIdSchema,
  snapshotStatus: PhaseLayoutSnapshotStatusSchema,
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime().nullable(),
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
}).strict();
export type RoomLayoutTimelineFrame = z.infer<typeof RoomLayoutTimelineFrameSchema>;

export const RoomLayoutTimelineResponseSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  frames: z.array(RoomLayoutTimelineFrameSchema),
}).strict();
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

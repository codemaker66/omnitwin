import { z } from "zod";
import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { EventIdSchema, EventPhaseIdSchema } from "./event-phase-graph.js";
import { EventPlanAudienceRoleSchema } from "./event-plan-lifecycle.js";
import { HandoffPackIdSchema, OpsTaskIdSchema, OpsTaskKindSchema, OpsTaskStatusSchema, SafeOpsTextSchema } from "./ops-compiler.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema } from "./venue.js";

export const EVENT_MISSION_SCHEMA_VERSION = "venviewer.event-mission.v0";
export const EVENT_MISSION_BASELINE_HASH_DOMAIN = "venviewer.event-mission.baseline.v0\n";

const UUID = z.string().uuid();
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/u);
const IDEMPOTENCY_KEY = z.string().trim().min(8).max(160);
const REVISION = z.number().int().positive();
const SEQUENCE = z.number().int().nonnegative();

export const EventMissionIdSchema = UUID;
export const EventMissionPhaseIdSchema = UUID;
export const EventMissionTaskIdSchema = UUID;
export const EventMissionIncidentIdSchema = UUID;
export const EventMissionEventIdSchema = UUID;
export const EventMissionAcknowledgementIdSchema = UUID;
export const EventMissionSessionIdSchema = UUID;

export type EventMissionId = z.infer<typeof EventMissionIdSchema>;
export type EventMissionPhaseId = z.infer<typeof EventMissionPhaseIdSchema>;
export type EventMissionTaskId = z.infer<typeof EventMissionTaskIdSchema>;
export type EventMissionIncidentId = z.infer<typeof EventMissionIncidentIdSchema>;
export type EventMissionEventId = z.infer<typeof EventMissionEventIdSchema>;

export const EventMissionStatusSchema = z.enum(["live", "completed", "cancelled"]);
export type EventMissionStatus = z.infer<typeof EventMissionStatusSchema>;

export const EventMissionPhaseStatusSchema = z.enum(["pending", "active", "completed", "skipped"]);
export type EventMissionPhaseStatus = z.infer<typeof EventMissionPhaseStatusSchema>;

export const EventMissionIncidentStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);
export type EventMissionIncidentStatus = z.infer<typeof EventMissionIncidentStatusSchema>;

export const EventMissionIncidentSeveritySchema = z.enum(["info", "attention", "urgent"]);
export type EventMissionIncidentSeverity = z.infer<typeof EventMissionIncidentSeveritySchema>;

export const EventMissionEntityTypeSchema = z.enum([
  "mission",
  "phase",
  "task",
  "incident",
  "acknowledgement",
]);
export type EventMissionEntityType = z.infer<typeof EventMissionEntityTypeSchema>;

export const EventMissionSpatialAnchorSchema = z.object({
  coordinateSpace: z.literal("real_m_v1"),
  configurationId: ConfigurationIdSchema,
  snapshotId: UUID,
  objectId: UUID.nullable(),
  xM: z.number().finite(),
  zM: z.number().finite(),
  floorLabel: z.string().trim().min(1).max(120).nullable(),
  label: z.string().trim().min(1).max(200),
  source: z.enum(["frozen_snapshot", "task_anchor", "operator_pin"]),
}).strict();
export type EventMissionSpatialAnchor = z.infer<typeof EventMissionSpatialAnchorSchema>;

export const EventMissionSchema = z.object({
  id: EventMissionIdSchema,
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  handoffPackId: HandoffPackIdSchema,
  sourceSnapshotHash: SHA256,
  status: EventMissionStatusSchema,
  baselineHash: SHA256,
  lastSequence: SEQUENCE,
  createdBy: UserIdSchema.nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EventMission = z.infer<typeof EventMissionSchema>;

export const EventMissionPhaseSchema = z.object({
  id: EventMissionPhaseIdSchema,
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema,
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().nonnegative(),
  status: EventMissionPhaseStatusSchema,
  revision: REVISION,
  actualStartedAt: z.string().datetime().nullable(),
  actualEndedAt: z.string().datetime().nullable(),
  updatedBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EventMissionPhase = z.infer<typeof EventMissionPhaseSchema>;

export const EventMissionTaskSchema = z.object({
  id: EventMissionTaskIdSchema,
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  handoffPackId: HandoffPackIdSchema,
  opsTaskId: OpsTaskIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  kind: OpsTaskKindSchema,
  title: z.string().trim().min(1).max(240),
  detail: SafeOpsTextSchema,
  status: OpsTaskStatusSchema,
  revision: REVISION,
  assignedTo: UserIdSchema.nullable(),
  assigneeLabel: z.string().trim().min(1).max(160).nullable(),
  spatialAnchors: z.array(EventMissionSpatialAnchorSchema).max(500),
  actualStartedAt: z.string().datetime().nullable(),
  actualEndedAt: z.string().datetime().nullable(),
  updatedBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EventMissionTask = z.infer<typeof EventMissionTaskSchema>;

export const EventMissionIncidentSchema = z.object({
  id: EventMissionIncidentIdSchema,
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  phaseId: EventPhaseIdSchema.nullable(),
  missionTaskId: EventMissionTaskIdSchema.nullable(),
  title: z.string().trim().min(1).max(180),
  detail: SafeOpsTextSchema,
  status: EventMissionIncidentStatusSchema,
  severity: EventMissionIncidentSeveritySchema,
  spatialAnchor: EventMissionSpatialAnchorSchema.nullable(),
  assignedTo: UserIdSchema.nullable(),
  reportedBy: UserIdSchema.nullable(),
  revision: REVISION,
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EventMissionIncident = z.infer<typeof EventMissionIncidentSchema>;

export const EventMissionAcknowledgementSchema = z.object({
  id: EventMissionAcknowledgementIdSchema,
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  acknowledgedEventId: EventMissionEventIdSchema,
  acknowledgedBy: UserIdSchema,
  acknowledgedByRole: EventPlanAudienceRoleSchema,
  note: SafeOpsTextSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type EventMissionAcknowledgement = z.infer<typeof EventMissionAcknowledgementSchema>;

export const EventMissionPresenceSchema = z.object({
  missionId: EventMissionIdSchema,
  sessionId: EventMissionSessionIdSchema,
  userId: UserIdSchema,
  displayName: z.string().trim().min(1).max(160),
  role: EventPlanAudienceRoleSchema,
  activePhaseId: EventPhaseIdSchema.nullable(),
  activeTaskId: EventMissionTaskIdSchema.nullable(),
  view: z.enum(["board", "map", "timeline", "replay"]),
  lastSeenAt: z.string().datetime(),
}).strict();
export type EventMissionPresence = z.infer<typeof EventMissionPresenceSchema>;

const MissionStartedPayloadSchema = z.object({
  kind: z.literal("mission_started"),
  baselineHash: SHA256,
}).strict();

const MissionStatusChangedPayloadSchema = z.object({
  kind: z.literal("mission_status_changed"),
  fromStatus: EventMissionStatusSchema,
  mission: EventMissionSchema,
  reason: SafeOpsTextSchema.nullable(),
}).strict();

const PhaseStatusChangedPayloadSchema = z.object({
  kind: z.literal("phase_status_changed"),
  fromStatus: EventMissionPhaseStatusSchema,
  phase: EventMissionPhaseSchema,
  note: SafeOpsTextSchema.nullable(),
}).strict();

const TaskStatusChangedPayloadSchema = z.object({
  kind: z.literal("task_status_changed"),
  fromStatus: OpsTaskStatusSchema,
  task: EventMissionTaskSchema,
  note: SafeOpsTextSchema.nullable(),
}).strict();

const IncidentCreatedPayloadSchema = z.object({
  kind: z.literal("incident_created"),
  incident: EventMissionIncidentSchema,
}).strict();

const IncidentUpdatedPayloadSchema = z.object({
  kind: z.literal("incident_updated"),
  fromStatus: EventMissionIncidentStatusSchema,
  incident: EventMissionIncidentSchema,
}).strict();

const EventAcknowledgedPayloadSchema = z.object({
  kind: z.literal("event_acknowledged"),
  acknowledgement: EventMissionAcknowledgementSchema,
}).strict();

export const EventMissionEventPayloadSchema = z.discriminatedUnion("kind", [
  MissionStartedPayloadSchema,
  MissionStatusChangedPayloadSchema,
  PhaseStatusChangedPayloadSchema,
  TaskStatusChangedPayloadSchema,
  IncidentCreatedPayloadSchema,
  IncidentUpdatedPayloadSchema,
  EventAcknowledgedPayloadSchema,
]);
export type EventMissionEventPayload = z.infer<typeof EventMissionEventPayloadSchema>;

export const EventMissionEventKindSchema = z.enum([
  "mission_started",
  "mission_status_changed",
  "phase_status_changed",
  "task_status_changed",
  "incident_created",
  "incident_updated",
  "event_acknowledged",
]);
export type EventMissionEventKind = z.infer<typeof EventMissionEventKindSchema>;

export const EventMissionEventSchema = z.object({
  id: EventMissionEventIdSchema,
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  sequence: z.number().int().positive(),
  kind: EventMissionEventKindSchema,
  entityType: EventMissionEntityTypeSchema,
  entityId: UUID.nullable(),
  entityRevision: REVISION.nullable(),
  actorUserId: UserIdSchema.nullable(),
  actorRole: EventPlanAudienceRoleSchema,
  actorLabel: z.string().trim().min(1).max(160),
  actorKey: z.string().trim().min(1).max(200),
  idempotencyKey: IDEMPOTENCY_KEY,
  requiresAcknowledgement: z.boolean(),
  payload: EventMissionEventPayloadSchema,
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
}).strict().superRefine((event, ctx) => {
  if (event.kind !== event.payload.kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "kind"], message: "Event kind must match payload kind." });
  }
});
export type EventMissionEvent = z.infer<typeof EventMissionEventSchema>;

export const EventMissionBaselineSchema = z.object({
  schemaVersion: z.literal(EVENT_MISSION_SCHEMA_VERSION),
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  handoffPackId: HandoffPackIdSchema,
  sourceSnapshotHash: SHA256,
  missionStatus: EventMissionStatusSchema,
  startedAt: z.string().datetime(),
  phases: z.array(EventMissionPhaseSchema),
  tasks: z.array(EventMissionTaskSchema),
}).strict();
export type EventMissionBaseline = z.infer<typeof EventMissionBaselineSchema>;

export const EventMissionReplayStateSchema = z.object({
  missionId: EventMissionIdSchema,
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  missionStatus: EventMissionStatusSchema,
  currentPhaseId: EventPhaseIdSchema.nullable(),
  phases: z.array(EventMissionPhaseSchema),
  tasks: z.array(EventMissionTaskSchema),
  incidents: z.array(EventMissionIncidentSchema),
  acknowledgedEventIds: z.array(EventMissionEventIdSchema),
  lastSequence: SEQUENCE,
}).strict();
export type EventMissionReplayState = z.infer<typeof EventMissionReplayStateSchema>;

export const EventMissionBoardSchema = z.object({
  mission: EventMissionSchema,
  phases: z.array(EventMissionPhaseSchema),
  tasks: z.array(EventMissionTaskSchema),
  incidents: z.array(EventMissionIncidentSchema),
  acknowledgements: z.array(EventMissionAcknowledgementSchema),
  presence: z.array(EventMissionPresenceSchema),
  latestSequence: SEQUENCE,
}).strict();
export type EventMissionBoard = z.infer<typeof EventMissionBoardSchema>;

export const EventMissionTimelineSchema = z.object({
  missionId: EventMissionIdSchema,
  events: z.array(EventMissionEventSchema),
  latestSequence: SEQUENCE,
  hasMore: z.boolean(),
}).strict();
export type EventMissionTimeline = z.infer<typeof EventMissionTimelineSchema>;

export const EventMissionReplaySchema = z.object({
  missionId: EventMissionIdSchema,
  baselineHash: SHA256,
  throughSequence: SEQUENCE,
  state: EventMissionReplayStateSchema,
}).strict();
export type EventMissionReplay = z.infer<typeof EventMissionReplaySchema>;

export const StartEventMissionInputSchema = z.object({
  handoffPackId: HandoffPackIdSchema,
  idempotencyKey: IDEMPOTENCY_KEY,
}).strict();
export type StartEventMissionInput = z.infer<typeof StartEventMissionInputSchema>;

export const TransitionEventMissionInputSchema = z.object({
  status: z.enum(["completed", "cancelled"]),
  idempotencyKey: IDEMPOTENCY_KEY,
  reason: SafeOpsTextSchema.nullable().optional(),
}).strict();
export type TransitionEventMissionInput = z.infer<typeof TransitionEventMissionInputSchema>;

export const TransitionEventMissionPhaseInputSchema = z.object({
  status: EventMissionPhaseStatusSchema,
  expectedRevision: REVISION,
  idempotencyKey: IDEMPOTENCY_KEY,
  note: SafeOpsTextSchema.nullable().optional(),
}).strict();
export type TransitionEventMissionPhaseInput = z.infer<typeof TransitionEventMissionPhaseInputSchema>;

export const TransitionEventMissionTaskInputSchema = z.object({
  status: OpsTaskStatusSchema,
  expectedRevision: REVISION,
  idempotencyKey: IDEMPOTENCY_KEY,
  note: SafeOpsTextSchema.nullable().optional(),
}).strict();
export type TransitionEventMissionTaskInput = z.infer<typeof TransitionEventMissionTaskInputSchema>;

export const CreateEventMissionIncidentInputSchema = z.object({
  phaseId: EventPhaseIdSchema.nullable().optional(),
  missionTaskId: EventMissionTaskIdSchema.nullable().optional(),
  title: z.string().trim().min(1).max(180),
  detail: SafeOpsTextSchema,
  severity: EventMissionIncidentSeveritySchema.default("attention"),
  spatialAnchor: EventMissionSpatialAnchorSchema.nullable().optional(),
  idempotencyKey: IDEMPOTENCY_KEY,
}).strict();
export type CreateEventMissionIncidentInput = z.infer<typeof CreateEventMissionIncidentInputSchema>;

export const UpdateEventMissionIncidentInputSchema = z.object({
  status: EventMissionIncidentStatusSchema.optional(),
  severity: EventMissionIncidentSeveritySchema.optional(),
  title: z.string().trim().min(1).max(180).optional(),
  detail: SafeOpsTextSchema.optional(),
  assignedTo: UserIdSchema.nullable().optional(),
  spatialAnchor: EventMissionSpatialAnchorSchema.nullable().optional(),
  expectedRevision: REVISION,
  idempotencyKey: IDEMPOTENCY_KEY,
}).strict().refine((input) => (
  input.status !== undefined ||
  input.severity !== undefined ||
  input.title !== undefined ||
  input.detail !== undefined ||
  input.assignedTo !== undefined ||
  input.spatialAnchor !== undefined
), { message: "At least one incident field must be provided." });
export type UpdateEventMissionIncidentInput = z.infer<typeof UpdateEventMissionIncidentInputSchema>;

export const AcknowledgeEventMissionEventInputSchema = z.object({
  eventId: EventMissionEventIdSchema,
  idempotencyKey: IDEMPOTENCY_KEY,
  note: SafeOpsTextSchema.nullable().optional(),
}).strict();
export type AcknowledgeEventMissionEventInput = z.infer<typeof AcknowledgeEventMissionEventInputSchema>;

export const EventMissionTimelineQuerySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(250).default(100),
}).strict();
export type EventMissionTimelineQuery = z.infer<typeof EventMissionTimelineQuerySchema>;

export const EventMissionReplayQuerySchema = z.object({
  throughSequence: z.coerce.number().int().nonnegative().optional(),
}).strict();
export type EventMissionReplayQuery = z.infer<typeof EventMissionReplayQuerySchema>;

export const EventMissionPresenceHeartbeatInputSchema = z.object({
  sessionId: EventMissionSessionIdSchema,
  activePhaseId: EventPhaseIdSchema.nullable().optional(),
  activeTaskId: EventMissionTaskIdSchema.nullable().optional(),
  view: z.enum(["board", "map", "timeline", "replay"]).default("board"),
}).strict();
export type EventMissionPresenceHeartbeatInput = z.infer<typeof EventMissionPresenceHeartbeatInputSchema>;

export class EventMissionReplaySequenceError extends Error {}

export function eventMissionBaselineHash(baseline: EventMissionBaseline): string {
  const parsed = EventMissionBaselineSchema.parse(baseline);
  return sha256Hex(`${EVENT_MISSION_BASELINE_HASH_DOMAIN}${stableCanonicalJson(parsed)}`);
}

function replaceById<T extends { readonly id: string }>(rows: readonly T[], replacement: T): T[] {
  const index = rows.findIndex((row) => row.id === replacement.id);
  if (index < 0) return [...rows, replacement];
  return rows.map((row, rowIndex) => rowIndex === index ? replacement : row);
}

export function replayEventMission(
  baseline: EventMissionBaseline,
  events: readonly EventMissionEvent[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): EventMissionReplayState {
  const parsedBaseline = EventMissionBaselineSchema.parse(baseline);
  let state: EventMissionReplayState = {
    missionId: parsedBaseline.missionId,
    eventId: parsedBaseline.eventId,
    venueId: parsedBaseline.venueId,
    missionStatus: parsedBaseline.missionStatus,
    currentPhaseId: null,
    phases: [...parsedBaseline.phases],
    tasks: [...parsedBaseline.tasks],
    incidents: [],
    acknowledgedEventIds: [],
    lastSequence: 0,
  };

  let expectedSequence = 1;
  for (const rawEvent of events) {
    const event = EventMissionEventSchema.parse(rawEvent);
    if (event.missionId !== parsedBaseline.missionId || event.eventId !== parsedBaseline.eventId) {
      throw new EventMissionReplaySequenceError("Mission event scope does not match the replay baseline.");
    }
    if (event.sequence !== expectedSequence) {
      throw new EventMissionReplaySequenceError(`Expected mission sequence ${String(expectedSequence)}, received ${String(event.sequence)}.`);
    }
    expectedSequence += 1;
    if (event.sequence > throughSequence) continue;

    switch (event.payload.kind) {
      case "mission_started":
        if (event.payload.baselineHash !== eventMissionBaselineHash(parsedBaseline)) {
          throw new EventMissionReplaySequenceError("Mission baseline hash does not match the start event.");
        }
        break;
      case "mission_status_changed":
        state = { ...state, missionStatus: event.payload.mission.status };
        break;
      case "phase_status_changed": {
        const phases = replaceById(state.phases, event.payload.phase);
        state = {
          ...state,
          phases,
          currentPhaseId: event.payload.phase.status === "active"
            ? event.payload.phase.phaseId
            : state.currentPhaseId === event.payload.phase.phaseId
              ? null
              : state.currentPhaseId,
        };
        break;
      }
      case "task_status_changed":
        state = { ...state, tasks: replaceById(state.tasks, event.payload.task) };
        break;
      case "incident_created":
      case "incident_updated":
        state = { ...state, incidents: replaceById(state.incidents, event.payload.incident) };
        break;
      case "event_acknowledged":
        if (!state.acknowledgedEventIds.includes(event.payload.acknowledgement.acknowledgedEventId)) {
          state = {
            ...state,
            acknowledgedEventIds: [...state.acknowledgedEventIds, event.payload.acknowledgement.acknowledgedEventId],
          };
        }
        break;
    }
    state = { ...state, lastSequence: event.sequence };
  }

  return EventMissionReplayStateSchema.parse(state);
}

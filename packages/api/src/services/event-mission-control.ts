import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AcknowledgeEventMissionEventInputSchema,
  CreateEventMissionIncidentInputSchema,
  EventMissionAcknowledgementSchema,
  EventMissionBaselineSchema,
  EventMissionBoardSchema,
  EventMissionEventPayloadSchema,
  EventMissionEventSchema,
  EventMissionIncidentSchema,
  EventMissionPhaseSchema,
  EventMissionPresenceHeartbeatInputSchema,
  EventMissionPresenceSchema,
  EventMissionReplaySchema,
  EventMissionSchema,
  EventMissionSpatialAnchorSchema,
  EventMissionTaskSchema,
  EventMissionTimelineQuerySchema,
  EventMissionTimelineSchema,
  StartEventMissionInputSchema,
  TransitionEventMissionInputSchema,
  TransitionEventMissionPhaseInputSchema,
  TransitionEventMissionTaskInputSchema,
  UpdateEventMissionIncidentInputSchema,
  eventMissionBaselineHash,
  replayEventMission,
  type AcknowledgeEventMissionEventInput,
  type CreateEventMissionIncidentInput,
  type EventMission,
  type EventMissionAcknowledgement,
  type EventMissionBoard,
  type EventMissionEvent,
  type EventMissionIncident,
  type EventMissionPhase,
  type EventMissionPresence,
  type EventMissionPresenceHeartbeatInput,
  type EventMissionReplay,
  type EventMissionTask,
  type EventMissionTimeline,
  type EventMissionTimelineQuery,
  type StartEventMissionInput,
  type TransitionEventMissionInput,
  type TransitionEventMissionPhaseInput,
  type TransitionEventMissionTaskInput,
  type UpdateEventMissionIncidentInput,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventMissionAcknowledgements,
  eventMissionEvents,
  eventMissionIncidents,
  eventMissionPhases,
  eventMissionSessions,
  eventMissionTasks,
  eventMissions,
  eventConfigurationLinks,
  eventPhases,
  events,
  configurationSheetSnapshots,
  configurations,
  handoffPacks,
  opsTasks,
} from "../db/schema.js";
import {
  EventMissionInvalidTransitionError,
  assertEventMissionTransition,
  assertEventMissionIncidentTransition,
  assertEventMissionPhaseTransition,
  assertEventMissionTaskTransition,
} from "../state-machines/event-mission.js";

const ACTIVE_PRESENCE_WINDOW_MS = 30_000;

type MissionRow = typeof eventMissions.$inferSelect;
type MissionPhaseRow = typeof eventMissionPhases.$inferSelect;
type MissionTaskRow = typeof eventMissionTasks.$inferSelect;
type MissionIncidentRow = typeof eventMissionIncidents.$inferSelect;
type MissionEventRow = typeof eventMissionEvents.$inferSelect;
type MissionAcknowledgementRow = typeof eventMissionAcknowledgements.$inferSelect;
type MissionSessionRow = typeof eventMissionSessions.$inferSelect;

export interface EventMissionActor {
  readonly userId: string;
  readonly role: EventMissionActorRole;
  readonly label: string;
}

export type EventMissionActorRole = EventMissionEvent["actorRole"];

export class EventMissionNotFoundError extends Error {}
export class EventMissionSourceNotFoundError extends Error {}
export class EventMissionAlreadyLiveError extends Error {}
export class EventMissionClosedError extends Error {}
export class EventMissionReferenceMismatchError extends Error {}
export class EventMissionAcknowledgementNotRequiredError extends Error {}
export class EventMissionAlreadyAcknowledgedError extends Error {}

export class EventMissionRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number;

  constructor(expectedRevision: number, currentRevision: number) {
    super(`Expected revision ${String(expectedRevision)}, current revision is ${String(currentRevision)}.`);
    this.name = "EventMissionRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export class EventMissionActivePhaseConflictError extends Error {}

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : iso(value);
}

function actorKey(actor: EventMissionActor): string {
  return `user:${actor.userId}`;
}

function serializeMission(row: MissionRow): EventMission {
  return EventMissionSchema.parse({
    id: row.id,
    eventId: row.eventId,
    venueId: row.venueId,
    handoffPackId: row.handoffPackId,
    sourceSnapshotHash: row.sourceSnapshotHash,
    status: row.status,
    baselineHash: row.baselineHash,
    lastSequence: row.lastSequence,
    createdBy: row.createdBy,
    startedAt: iso(row.startedAt),
    completedAt: isoOrNull(row.completedAt),
    cancelledAt: isoOrNull(row.cancelledAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function serializePhase(row: MissionPhaseRow): EventMissionPhase {
  return EventMissionPhaseSchema.parse({
    id: row.id,
    missionId: row.missionId,
    eventId: row.eventId,
    phaseId: row.phaseId,
    name: row.name,
    sortOrder: row.sortOrder,
    status: row.status,
    revision: row.revision,
    actualStartedAt: isoOrNull(row.actualStartedAt),
    actualEndedAt: isoOrNull(row.actualEndedAt),
    updatedBy: row.updatedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function serializeTask(row: MissionTaskRow): EventMissionTask {
  return EventMissionTaskSchema.parse({
    id: row.id,
    missionId: row.missionId,
    eventId: row.eventId,
    handoffPackId: row.handoffPackId,
    opsTaskId: row.opsTaskId,
    phaseId: row.phaseId,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    revision: row.revision,
    assignedTo: row.assignedTo,
    assigneeLabel: row.assigneeLabel,
    spatialAnchors: z.array(EventMissionSpatialAnchorSchema).parse(row.spatialAnchors),
    actualStartedAt: isoOrNull(row.actualStartedAt),
    actualEndedAt: isoOrNull(row.actualEndedAt),
    updatedBy: row.updatedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function serializeIncident(row: MissionIncidentRow): EventMissionIncident {
  return EventMissionIncidentSchema.parse({
    id: row.id,
    missionId: row.missionId,
    eventId: row.eventId,
    phaseId: row.phaseId,
    missionTaskId: row.missionTaskId,
    title: row.title,
    detail: row.detail,
    status: row.status,
    severity: row.severity,
    spatialAnchor: row.spatialAnchor,
    assignedTo: row.assignedTo,
    reportedBy: row.reportedBy,
    revision: row.revision,
    resolvedAt: isoOrNull(row.resolvedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function serializeAcknowledgement(row: MissionAcknowledgementRow): EventMissionAcknowledgement {
  return EventMissionAcknowledgementSchema.parse({
    id: row.id,
    missionId: row.missionId,
    eventId: row.eventId,
    acknowledgedEventId: row.acknowledgedEventId,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedByRole: row.acknowledgedByRole,
    note: row.note,
    createdAt: iso(row.createdAt),
  });
}

function serializeEvent(row: MissionEventRow): EventMissionEvent {
  return EventMissionEventSchema.parse({
    id: row.id,
    missionId: row.missionId,
    eventId: row.eventId,
    venueId: row.venueId,
    sequence: row.sequence,
    kind: row.kind,
    entityType: row.entityType,
    entityId: row.entityId,
    entityRevision: row.entityRevision,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    actorLabel: row.actorLabel,
    actorKey: row.actorKey,
    idempotencyKey: row.idempotencyKey,
    requiresAcknowledgement: row.requiresAcknowledgement,
    payload: row.payload,
    occurredAt: iso(row.occurredAt),
    createdAt: iso(row.createdAt),
  });
}

function serializePresence(row: MissionSessionRow): EventMissionPresence {
  return EventMissionPresenceSchema.parse({
    missionId: row.missionId,
    sessionId: row.sessionId,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    activePhaseId: row.activePhaseId,
    activeTaskId: row.activeTaskId,
    view: row.view,
    lastSeenAt: iso(row.lastSeenAt),
  });
}

function eventInsert(input: {
  readonly id: string;
  readonly mission: MissionRow;
  readonly sequence: number;
  readonly actor: EventMissionActor;
  readonly idempotencyKey: string;
  readonly entityType: EventMissionEvent["entityType"];
  readonly entityId: string | null;
  readonly entityRevision: number | null;
  readonly requiresAcknowledgement: boolean;
  readonly payload: EventMissionEvent["payload"];
  readonly now: Date;
}): typeof eventMissionEvents.$inferInsert {
  return {
    id: input.id,
    missionId: input.mission.id,
    eventId: input.mission.eventId,
    venueId: input.mission.venueId,
    sequence: input.sequence,
    kind: input.payload.kind,
    entityType: input.entityType,
    entityId: input.entityId,
    entityRevision: input.entityRevision,
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    actorLabel: input.actor.label,
    actorKey: actorKey(input.actor),
    idempotencyKey: input.idempotencyKey,
    requiresAcknowledgement: input.requiresAcknowledgement,
    payload: EventMissionEventPayloadSchema.parse(input.payload),
    occurredAt: input.now,
  };
}

async function missionById(db: Database, missionId: string): Promise<MissionRow | null> {
  const [row] = await db.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
  return row ?? null;
}

async function existingIdempotentEvent(
  db: Database,
  missionId: string,
  actor: EventMissionActor,
  idempotencyKey: string,
): Promise<EventMissionEvent | null> {
  const [row] = await db.select().from(eventMissionEvents).where(and(
    eq(eventMissionEvents.missionId, missionId),
    eq(eventMissionEvents.actorKey, actorKey(actor)),
    eq(eventMissionEvents.idempotencyKey, idempotencyKey),
  )).limit(1);
  return row === undefined ? null : serializeEvent(row);
}

async function runIdempotentMissionCommand(
  db: Database,
  missionId: string,
  actor: EventMissionActor,
  idempotencyKey: string,
  command: () => Promise<EventMissionEvent>,
): Promise<EventMissionEvent> {
  const existing = await existingIdempotentEvent(db, missionId, actor, idempotencyKey);
  if (existing !== null) return existing;
  try {
    return await command();
  } catch (error) {
    // A concurrent duplicate can win the unique idempotency constraint after
    // our pre-read. Re-read after rollback and return the committed event.
    const committed = await existingIdempotentEvent(db, missionId, actor, idempotencyKey);
    if (committed !== null) return committed;
    throw error;
  }
}

async function boardForIdempotentStart(
  db: Database,
  mission: MissionRow,
  handoffPackId: string,
  actor: EventMissionActor,
  idempotencyKey: string,
): Promise<EventMissionBoard | null> {
  if (mission.handoffPackId !== handoffPackId) return null;
  const replay = await existingIdempotentEvent(db, mission.id, actor, idempotencyKey);
  if (replay === null || replay.kind !== "mission_started") return null;
  return getEventMissionBoard(db, mission.id);
}

export async function getEventMissionBoard(db: Database, missionId: string): Promise<EventMissionBoard | null> {
  const mission = await missionById(db, missionId);
  if (mission === null) return null;
  const cutoff = new Date(Date.now() - ACTIVE_PRESENCE_WINDOW_MS);
  const [phaseRows, taskRows, incidentRows, acknowledgementRows, sessionRows] = await Promise.all([
    db.select().from(eventMissionPhases).where(eq(eventMissionPhases.missionId, mission.id)).orderBy(eventMissionPhases.sortOrder),
    db.select().from(eventMissionTasks).where(eq(eventMissionTasks.missionId, mission.id)).orderBy(eventMissionTasks.createdAt),
    db.select().from(eventMissionIncidents).where(eq(eventMissionIncidents.missionId, mission.id)).orderBy(desc(eventMissionIncidents.createdAt)),
    db.select().from(eventMissionAcknowledgements).where(eq(eventMissionAcknowledgements.missionId, mission.id)).orderBy(eventMissionAcknowledgements.createdAt),
    db.select().from(eventMissionSessions).where(and(
      eq(eventMissionSessions.missionId, mission.id),
      gte(eventMissionSessions.lastSeenAt, cutoff),
    )).orderBy(eventMissionSessions.displayName),
  ]);
  return EventMissionBoardSchema.parse({
    mission: serializeMission(mission),
    phases: phaseRows.map(serializePhase),
    tasks: taskRows.map(serializeTask),
    incidents: incidentRows.map(serializeIncident),
    acknowledgements: acknowledgementRows.map(serializeAcknowledgement),
    presence: sessionRows.map(serializePresence),
    latestSequence: mission.lastSequence,
  });
}

export async function getLatestEventMissionBoard(db: Database, eventId: string): Promise<EventMissionBoard | null> {
  const [mission] = await db.select({ id: eventMissions.id }).from(eventMissions)
    .where(eq(eventMissions.eventId, eventId))
    .orderBy(desc(eventMissions.createdAt))
    .limit(1);
  return mission === undefined ? null : getEventMissionBoard(db, mission.id);
}

function baselinePhase(row: typeof eventPhases.$inferSelect, missionId: string, eventId: string, now: Date): EventMissionPhase {
  return EventMissionPhaseSchema.parse({
    id: randomUUID(), missionId, eventId, phaseId: row.id, name: row.name, sortOrder: row.sortOrder,
    status: "pending", revision: 1, actualStartedAt: null, actualEndedAt: null, updatedBy: null,
    createdAt: iso(now), updatedAt: iso(now),
  });
}

function baselineTask(row: typeof opsTasks.$inferSelect, missionId: string, eventId: string, now: Date): EventMissionTask {
  return EventMissionTaskSchema.parse({
    id: randomUUID(), missionId, eventId, handoffPackId: row.handoffPackId, opsTaskId: row.id,
    phaseId: row.phaseId, kind: row.kind, title: row.title, detail: row.detail, status: "todo", revision: 1,
    assignedTo: null, assigneeLabel: null, spatialAnchors: row.spatialAnchors, actualStartedAt: null,
    actualEndedAt: null, updatedBy: null, createdAt: iso(now), updatedAt: iso(now),
  });
}

export async function startEventMission(
  db: Database,
  eventId: string,
  input: StartEventMissionInput,
  actor: EventMissionActor,
): Promise<EventMissionBoard> {
  const parsed = StartEventMissionInputSchema.parse(input);
  const [source] = await db.select({
    event: events,
    pack: handoffPacks,
    approvedSnapshotHash: configurationSheetSnapshots.sourceHash,
  })
    .from(events)
    .innerJoin(handoffPacks, and(eq(handoffPacks.id, parsed.handoffPackId), eq(handoffPacks.eventId, events.id)))
    .innerJoin(configurationSheetSnapshots, and(
      eq(configurationSheetSnapshots.id, handoffPacks.snapshotId),
      eq(configurationSheetSnapshots.configurationId, handoffPacks.configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .innerJoin(configurations, and(
      eq(configurations.id, handoffPacks.configId),
      eq(configurations.venueId, events.venueId),
      isNull(configurations.deletedAt),
    ))
    .innerJoin(eventConfigurationLinks, and(
      eq(eventConfigurationLinks.eventId, events.id),
      eq(eventConfigurationLinks.configurationId, handoffPacks.configId),
    ))
    .where(eq(events.id, eventId))
    .limit(1);
  if (
    source === undefined ||
    source.approvedSnapshotHash !== source.pack.snapshotHash ||
    (source.pack.status !== "compiled" && source.pack.status !== "exported")
  ) {
    throw new EventMissionSourceNotFoundError();
  }

  const [existing] = await db.select().from(eventMissions).where(and(
    eq(eventMissions.eventId, eventId),
    eq(eventMissions.status, "live"),
  )).limit(1);
  if (existing !== undefined) {
    const board = await boardForIdempotentStart(db, existing, parsed.handoffPackId, actor, parsed.idempotencyKey);
    if (board !== null) return board;
    throw new EventMissionAlreadyLiveError();
  }

  const [phaseRows, taskRows] = await Promise.all([
    db.select().from(eventPhases).where(eq(eventPhases.eventId, eventId)).orderBy(eventPhases.sortOrder),
    db.select().from(opsTasks).where(eq(opsTasks.handoffPackId, source.pack.id)).orderBy(opsTasks.sortOrder),
  ]);
  const missionId = randomUUID();
  const now = new Date();
  const phases = phaseRows.map((row) => baselinePhase(row, missionId, eventId, now));
  const tasks = taskRows.map((row) => baselineTask(row, missionId, eventId, now));
  const baseline = EventMissionBaselineSchema.parse({
    schemaVersion: "venviewer.event-mission.v0",
    missionId,
    eventId,
    venueId: source.event.venueId,
    handoffPackId: source.pack.id,
    sourceSnapshotHash: source.pack.snapshotHash,
    missionStatus: "live",
    startedAt: iso(now),
    phases,
    tasks,
  });
  const baselineHash = eventMissionBaselineHash(baseline);

  try {
    await db.transaction(async (tx) => {
      const [mission] = await tx.insert(eventMissions).values({
        id: missionId, eventId, venueId: source.event.venueId, handoffPackId: source.pack.id,
        sourceSnapshotHash: source.pack.snapshotHash, status: "live", baseline, baselineHash,
        lastSequence: 1, createdBy: actor.userId, startedAt: now,
      }).returning();
      if (mission === undefined) throw new Error("Mission insertion returned no row.");
      if (phases.length > 0) {
        await tx.insert(eventMissionPhases).values(phases.map((phase) => ({
          id: phase.id, missionId, eventId, phaseId: phase.phaseId, name: phase.name, sortOrder: phase.sortOrder,
          status: phase.status, revision: phase.revision, actualStartedAt: null, actualEndedAt: null,
          updatedBy: null, createdAt: now, updatedAt: now,
        })));
      }
      if (tasks.length > 0) {
        await tx.insert(eventMissionTasks).values(tasks.map((task) => ({
          id: task.id, missionId, eventId, handoffPackId: task.handoffPackId, opsTaskId: task.opsTaskId,
          phaseId: task.phaseId, kind: task.kind, title: task.title, detail: task.detail, status: task.status,
          revision: task.revision, assignedTo: null, assigneeLabel: null, spatialAnchors: task.spatialAnchors,
          actualStartedAt: null, actualEndedAt: null, updatedBy: null, createdAt: now, updatedAt: now,
        })));
      }
      await tx.insert(eventMissionEvents).values(eventInsert({
        id: randomUUID(), mission, sequence: 1, actor, idempotencyKey: parsed.idempotencyKey,
        entityType: "mission", entityId: mission.id, entityRevision: null, requiresAcknowledgement: false,
        payload: { kind: "mission_started", baselineHash }, now,
      }));
    });
  } catch (error) {
    // The one-live-mission constraint can be won by an identical concurrent
    // start after our pre-read. Resolve that race as the same idempotent result.
    const [winner] = await db.select().from(eventMissions).where(and(
      eq(eventMissions.eventId, eventId),
      eq(eventMissions.status, "live"),
    )).limit(1);
    if (winner !== undefined) {
      const board = await boardForIdempotentStart(db, winner, parsed.handoffPackId, actor, parsed.idempotencyKey);
      if (board !== null) return board;
      throw new EventMissionAlreadyLiveError();
    }
    throw error;
  }

  const board = await getEventMissionBoard(db, missionId);
  if (board === null) throw new EventMissionNotFoundError();
  return board;
}

export async function transitionEventMission(
  db: Database,
  missionId: string,
  input: TransitionEventMissionInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = TransitionEventMissionInputSchema.parse(input);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [current] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (current === undefined) throw new EventMissionNotFoundError();
    assertEventMissionTransition(current.status, parsed.status);
    const now = new Date();
    const [updated] = await tx.update(eventMissions).set({
      status: parsed.status,
      lastSequence: sql`${eventMissions.lastSequence} + 1`,
      completedAt: parsed.status === "completed" ? now : null,
      cancelledAt: parsed.status === "cancelled" ? now : null,
      updatedAt: now,
    }).where(and(eq(eventMissions.id, current.id), eq(eventMissions.status, current.status))).returning();
    if (updated === undefined) throw new EventMissionClosedError();
    const payload = EventMissionEventPayloadSchema.parse({
      kind: "mission_status_changed",
      fromStatus: current.status,
      mission: serializeMission(updated),
      reason: parsed.reason ?? null,
    });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: updated, sequence: updated.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "mission", entityId: updated.id,
      entityRevision: null, requiresAcknowledgement: parsed.status === "cancelled", payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission status event insertion returned no row.");
    return serializeEvent(event);
  }));
}

export async function transitionEventMissionPhase(
  db: Database,
  missionId: string,
  missionPhaseId: string,
  input: TransitionEventMissionPhaseInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = TransitionEventMissionPhaseInputSchema.parse(input);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [mission] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (mission === undefined) throw new EventMissionNotFoundError();
    if (mission.status !== "live") throw new EventMissionClosedError();
    const [current] = await tx.select().from(eventMissionPhases).where(and(
      eq(eventMissionPhases.id, missionPhaseId), eq(eventMissionPhases.missionId, mission.id),
    )).limit(1);
    if (current === undefined) throw new EventMissionNotFoundError();
    if (current.revision !== parsed.expectedRevision) {
      throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision);
    }
    assertEventMissionPhaseTransition(current.status, parsed.status);
    if (parsed.status === "active") {
      const [otherActive] = await tx.select({ id: eventMissionPhases.id }).from(eventMissionPhases).where(and(
        eq(eventMissionPhases.missionId, mission.id), eq(eventMissionPhases.status, "active"),
        ne(eventMissionPhases.id, current.id),
      )).limit(1);
      if (otherActive !== undefined) throw new EventMissionActivePhaseConflictError();
    }
    const now = new Date();
    const [updated] = await tx.update(eventMissionPhases).set({
      status: parsed.status,
      revision: sql`${eventMissionPhases.revision} + 1`,
      actualStartedAt: parsed.status === "active" ? current.actualStartedAt ?? now : current.actualStartedAt,
      actualEndedAt: parsed.status === "completed" || parsed.status === "skipped" ? now : current.actualEndedAt,
      updatedBy: actor.userId,
      updatedAt: now,
    }).where(and(
      eq(eventMissionPhases.id, current.id),
      eq(eventMissionPhases.missionId, mission.id),
      eq(eventMissionPhases.revision, parsed.expectedRevision),
    )).returning();
    if (updated === undefined) throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision + 1);
    const [advanced] = await tx.update(eventMissions).set({
      lastSequence: sql`${eventMissions.lastSequence} + 1`, updatedAt: now,
    }).where(and(eq(eventMissions.id, mission.id), eq(eventMissions.status, "live"))).returning();
    if (advanced === undefined) throw new EventMissionClosedError();
    const payload = EventMissionEventPayloadSchema.parse({
      kind: "phase_status_changed", fromStatus: current.status, phase: serializePhase(updated), note: parsed.note ?? null,
    });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: advanced, sequence: advanced.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "phase", entityId: updated.id,
      entityRevision: updated.revision, requiresAcknowledgement: false, payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission phase event insertion returned no row.");
    return serializeEvent(event);
  }));
}

export async function transitionEventMissionTask(
  db: Database,
  missionId: string,
  missionTaskId: string,
  input: TransitionEventMissionTaskInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = TransitionEventMissionTaskInputSchema.parse(input);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [mission] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (mission === undefined) throw new EventMissionNotFoundError();
    if (mission.status !== "live") throw new EventMissionClosedError();
    const [current] = await tx.select().from(eventMissionTasks).where(and(
      eq(eventMissionTasks.id, missionTaskId), eq(eventMissionTasks.missionId, mission.id),
    )).limit(1);
    if (current === undefined) throw new EventMissionNotFoundError();
    if (current.revision !== parsed.expectedRevision) {
      throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision);
    }
    assertEventMissionTaskTransition(current.status, parsed.status);
    const now = new Date();
    const [updated] = await tx.update(eventMissionTasks).set({
      status: parsed.status,
      revision: sql`${eventMissionTasks.revision} + 1`,
      actualStartedAt: parsed.status === "in_progress" || parsed.status === "done" ? current.actualStartedAt ?? now : current.actualStartedAt,
      actualEndedAt: parsed.status === "done" || parsed.status === "waived" ? now : null,
      updatedBy: actor.userId,
      updatedAt: now,
    }).where(and(
      eq(eventMissionTasks.id, current.id), eq(eventMissionTasks.missionId, mission.id),
      eq(eventMissionTasks.revision, parsed.expectedRevision),
    )).returning();
    if (updated === undefined) throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision + 1);
    const [advanced] = await tx.update(eventMissions).set({
      lastSequence: sql`${eventMissions.lastSequence} + 1`, updatedAt: now,
    }).where(and(eq(eventMissions.id, mission.id), eq(eventMissions.status, "live"))).returning();
    if (advanced === undefined) throw new EventMissionClosedError();
    const payload = EventMissionEventPayloadSchema.parse({
      kind: "task_status_changed", fromStatus: current.status, task: serializeTask(updated), note: parsed.note ?? null,
    });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: advanced, sequence: advanced.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "task", entityId: updated.id,
      entityRevision: updated.revision, requiresAcknowledgement: parsed.status === "blocked", payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission task event insertion returned no row.");
    return serializeEvent(event);
  }));
}

async function validateIncidentReferences(
  db: Database,
  missionId: string,
  phaseId: string | null,
  missionTaskId: string | null,
): Promise<void> {
  if (phaseId !== null) {
    const [phase] = await db.select({ id: eventMissionPhases.id }).from(eventMissionPhases).where(and(
      eq(eventMissionPhases.missionId, missionId), eq(eventMissionPhases.phaseId, phaseId),
    )).limit(1);
    if (phase === undefined) throw new EventMissionReferenceMismatchError();
  }
  if (missionTaskId !== null) {
    const [task] = await db.select({ id: eventMissionTasks.id }).from(eventMissionTasks).where(and(
      eq(eventMissionTasks.missionId, missionId), eq(eventMissionTasks.id, missionTaskId),
    )).limit(1);
    if (task === undefined) throw new EventMissionReferenceMismatchError();
  }
}

export async function createEventMissionIncident(
  db: Database,
  missionId: string,
  input: CreateEventMissionIncidentInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = CreateEventMissionIncidentInputSchema.parse(input);
  await validateIncidentReferences(db, missionId, parsed.phaseId ?? null, parsed.missionTaskId ?? null);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [mission] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (mission === undefined) throw new EventMissionNotFoundError();
    if (mission.status !== "live") throw new EventMissionClosedError();
    const now = new Date();
    const [incident] = await tx.insert(eventMissionIncidents).values({
      id: randomUUID(), missionId: mission.id, eventId: mission.eventId, phaseId: parsed.phaseId ?? null,
      missionTaskId: parsed.missionTaskId ?? null, title: parsed.title, detail: parsed.detail,
      status: "open", severity: parsed.severity, spatialAnchor: parsed.spatialAnchor ?? null,
      assignedTo: null, reportedBy: actor.userId, revision: 1, createdAt: now, updatedAt: now,
    }).returning();
    if (incident === undefined) throw new Error("Mission incident insertion returned no row.");
    const [advanced] = await tx.update(eventMissions).set({
      lastSequence: sql`${eventMissions.lastSequence} + 1`, updatedAt: now,
    }).where(and(eq(eventMissions.id, mission.id), eq(eventMissions.status, "live"))).returning();
    if (advanced === undefined) throw new EventMissionClosedError();
    const payload = EventMissionEventPayloadSchema.parse({ kind: "incident_created", incident: serializeIncident(incident) });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: advanced, sequence: advanced.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "incident", entityId: incident.id,
      entityRevision: incident.revision, requiresAcknowledgement: incident.severity === "urgent", payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission incident event insertion returned no row.");
    return serializeEvent(event);
  }));
}

export async function updateEventMissionIncident(
  db: Database,
  missionId: string,
  incidentId: string,
  input: UpdateEventMissionIncidentInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = UpdateEventMissionIncidentInputSchema.parse(input);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [mission] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (mission === undefined) throw new EventMissionNotFoundError();
    if (mission.status !== "live") throw new EventMissionClosedError();
    const [current] = await tx.select().from(eventMissionIncidents).where(and(
      eq(eventMissionIncidents.id, incidentId), eq(eventMissionIncidents.missionId, mission.id),
    )).limit(1);
    if (current === undefined) throw new EventMissionNotFoundError();
    if (current.revision !== parsed.expectedRevision) {
      throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision);
    }
    if (parsed.status !== undefined && parsed.status !== current.status) {
      assertEventMissionIncidentTransition(current.status, parsed.status);
    }
    const nextStatus = parsed.status ?? current.status;
    const now = new Date();
    const [updated] = await tx.update(eventMissionIncidents).set({
      status: nextStatus,
      severity: parsed.severity ?? current.severity,
      title: parsed.title ?? current.title,
      detail: parsed.detail ?? current.detail,
      assignedTo: parsed.assignedTo === undefined ? current.assignedTo : parsed.assignedTo,
      spatialAnchor: parsed.spatialAnchor === undefined ? current.spatialAnchor : parsed.spatialAnchor,
      revision: sql`${eventMissionIncidents.revision} + 1`,
      resolvedAt: nextStatus === "resolved" || nextStatus === "closed" ? current.resolvedAt ?? now : null,
      updatedAt: now,
    }).where(and(
      eq(eventMissionIncidents.id, current.id), eq(eventMissionIncidents.missionId, mission.id),
      eq(eventMissionIncidents.revision, parsed.expectedRevision),
    )).returning();
    if (updated === undefined) throw new EventMissionRevisionConflictError(parsed.expectedRevision, current.revision + 1);
    const [advanced] = await tx.update(eventMissions).set({
      lastSequence: sql`${eventMissions.lastSequence} + 1`, updatedAt: now,
    }).where(and(eq(eventMissions.id, mission.id), eq(eventMissions.status, "live"))).returning();
    if (advanced === undefined) throw new EventMissionClosedError();
    const payload = EventMissionEventPayloadSchema.parse({
      kind: "incident_updated", fromStatus: current.status, incident: serializeIncident(updated),
    });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: advanced, sequence: advanced.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "incident", entityId: updated.id,
      entityRevision: updated.revision, requiresAcknowledgement: updated.severity === "urgent", payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission incident update event insertion returned no row.");
    return serializeEvent(event);
  }));
}

export async function acknowledgeEventMissionEvent(
  db: Database,
  missionId: string,
  input: AcknowledgeEventMissionEventInput,
  actor: EventMissionActor,
): Promise<EventMissionEvent> {
  const parsed = AcknowledgeEventMissionEventInputSchema.parse(input);
  return runIdempotentMissionCommand(db, missionId, actor, parsed.idempotencyKey, () => db.transaction(async (tx) => {
    const [mission] = await tx.select().from(eventMissions).where(eq(eventMissions.id, missionId)).limit(1);
    if (mission === undefined) throw new EventMissionNotFoundError();
    const [target] = await tx.select().from(eventMissionEvents).where(and(
      eq(eventMissionEvents.id, parsed.eventId), eq(eventMissionEvents.missionId, mission.id),
    )).limit(1);
    if (target === undefined) throw new EventMissionNotFoundError();
    if (!target.requiresAcknowledgement) throw new EventMissionAcknowledgementNotRequiredError();
    const [alreadyAcknowledged] = await tx.select({ id: eventMissionAcknowledgements.id })
      .from(eventMissionAcknowledgements).where(and(
        eq(eventMissionAcknowledgements.missionId, mission.id),
        eq(eventMissionAcknowledgements.acknowledgedEventId, target.id),
        eq(eventMissionAcknowledgements.acknowledgedBy, actor.userId),
      )).limit(1);
    if (alreadyAcknowledged !== undefined) throw new EventMissionAlreadyAcknowledgedError();
    const now = new Date();
    const [acknowledgement] = await tx.insert(eventMissionAcknowledgements).values({
      id: randomUUID(), missionId: mission.id, eventId: mission.eventId,
      acknowledgedEventId: target.id, acknowledgedBy: actor.userId,
      acknowledgedByRole: actor.role, note: parsed.note ?? null,
    }).returning();
    if (acknowledgement === undefined) throw new Error("Mission acknowledgement insertion returned no row.");
    const [advanced] = await tx.update(eventMissions).set({
      lastSequence: sql`${eventMissions.lastSequence} + 1`, updatedAt: now,
    }).where(eq(eventMissions.id, mission.id)).returning();
    if (advanced === undefined) throw new EventMissionNotFoundError();
    const payload = EventMissionEventPayloadSchema.parse({
      kind: "event_acknowledged", acknowledgement: serializeAcknowledgement(acknowledgement),
    });
    const [event] = await tx.insert(eventMissionEvents).values(eventInsert({
      id: randomUUID(), mission: advanced, sequence: advanced.lastSequence, actor,
      idempotencyKey: parsed.idempotencyKey, entityType: "acknowledgement", entityId: acknowledgement.id,
      entityRevision: null, requiresAcknowledgement: false, payload, now,
    })).returning();
    if (event === undefined) throw new Error("Mission acknowledgement event insertion returned no row.");
    return serializeEvent(event);
  }));
}

export async function getEventMissionTimeline(
  db: Database,
  missionId: string,
  query: EventMissionTimelineQuery,
): Promise<EventMissionTimeline> {
  const parsed = EventMissionTimelineQuerySchema.parse(query);
  const mission = await missionById(db, missionId);
  if (mission === null) throw new EventMissionNotFoundError();
  const rows = await db.select().from(eventMissionEvents).where(and(
    eq(eventMissionEvents.missionId, mission.id), gt(eventMissionEvents.sequence, parsed.afterSequence),
  )).orderBy(asc(eventMissionEvents.sequence)).limit(parsed.limit + 1);
  return EventMissionTimelineSchema.parse({
    missionId: mission.id,
    events: rows.slice(0, parsed.limit).map(serializeEvent),
    latestSequence: mission.lastSequence,
    hasMore: rows.length > parsed.limit,
  });
}

export async function getEventMissionReplay(
  db: Database,
  missionId: string,
  throughSequence?: number,
): Promise<EventMissionReplay> {
  const mission = await missionById(db, missionId);
  if (mission === null) throw new EventMissionNotFoundError();
  const through = throughSequence === undefined ? mission.lastSequence : Math.min(throughSequence, mission.lastSequence);
  const rows = await db.select().from(eventMissionEvents).where(and(
    eq(eventMissionEvents.missionId, mission.id), lte(eventMissionEvents.sequence, through),
  )).orderBy(asc(eventMissionEvents.sequence));
  const baseline = EventMissionBaselineSchema.parse(mission.baseline);
  return EventMissionReplaySchema.parse({
    missionId: mission.id,
    baselineHash: mission.baselineHash,
    throughSequence: through,
    state: replayEventMission(baseline, rows.map(serializeEvent), through),
  });
}

export async function heartbeatEventMissionPresence(
  db: Database,
  missionId: string,
  input: EventMissionPresenceHeartbeatInput,
  actor: EventMissionActor,
): Promise<EventMissionPresence> {
  const parsed = EventMissionPresenceHeartbeatInputSchema.parse(input);
  const mission = await missionById(db, missionId);
  if (mission === null) throw new EventMissionNotFoundError();
  await validateIncidentReferences(db, mission.id, parsed.activePhaseId ?? null, parsed.activeTaskId ?? null);
  const now = new Date();
  const [row] = await db.insert(eventMissionSessions).values({
    missionId: mission.id, sessionId: parsed.sessionId, userId: actor.userId,
    displayName: actor.label, role: actor.role, activePhaseId: parsed.activePhaseId ?? null,
    activeTaskId: parsed.activeTaskId ?? null, view: parsed.view, lastSeenAt: now,
  }).onConflictDoUpdate({
    target: [eventMissionSessions.missionId, eventMissionSessions.sessionId, eventMissionSessions.userId],
    set: {
      displayName: actor.label, role: actor.role, activePhaseId: parsed.activePhaseId ?? null,
      activeTaskId: parsed.activeTaskId ?? null, view: parsed.view, lastSeenAt: now,
    },
  }).returning();
  if (row === undefined) throw new Error("Mission presence heartbeat returned no row.");
  return serializePresence(row);
}

export async function endEventMissionPresence(
  db: Database,
  missionId: string,
  sessionId: string,
  userId: string,
): Promise<void> {
  await db.delete(eventMissionSessions).where(and(
    eq(eventMissionSessions.missionId, missionId),
    eq(eventMissionSessions.sessionId, sessionId),
    eq(eventMissionSessions.userId, userId),
  ));
}

export { EventMissionInvalidTransitionError };

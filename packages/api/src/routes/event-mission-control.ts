import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AcknowledgeEventMissionEventInputSchema,
  CreateEventMissionIncidentInputSchema,
  EventMissionBoardSchema,
  EventMissionEventSchema,
  EventMissionPresenceHeartbeatInputSchema,
  EventMissionPresenceSchema,
  EventMissionReplayQuerySchema,
  EventMissionReplaySchema,
  EventMissionTimelineQuerySchema,
  EventMissionTimelineSchema,
  EventPlanAudienceRoleSchema,
  StartEventMissionInputSchema,
  TransitionEventMissionInputSchema,
  TransitionEventMissionPhaseInputSchema,
  TransitionEventMissionTaskInputSchema,
  UpdateEventMissionIncidentInputSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { eventMissions, events } from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import {
  EventMissionAcknowledgementNotRequiredError,
  EventMissionActivePhaseConflictError,
  EventMissionAlreadyAcknowledgedError,
  EventMissionAlreadyLiveError,
  EventMissionClosedError,
  EventMissionInvalidTransitionError,
  EventMissionNotFoundError,
  EventMissionReferenceMismatchError,
  EventMissionRevisionConflictError,
  EventMissionSourceNotFoundError,
  acknowledgeEventMissionEvent,
  createEventMissionIncident,
  endEventMissionPresence,
  getEventMissionReplay,
  getEventMissionTimeline,
  getLatestEventMissionBoard,
  heartbeatEventMissionPresence,
  startEventMission,
  transitionEventMission,
  transitionEventMissionPhase,
  transitionEventMissionTask,
  updateEventMissionIncident,
  type EventMissionActor,
} from "../services/event-mission-control.js";
import { canAccessResource, canManageVenue } from "../utils/query.js";

const EventParamSchema = z.object({ eventId: z.string().uuid() }).strict();
const MissionParamSchema = z.object({ missionId: z.string().uuid() }).strict();
const PhaseParamSchema = z.object({ missionId: z.string().uuid(), missionPhaseId: z.string().uuid() }).strict();
const TaskParamSchema = z.object({ missionId: z.string().uuid(), missionTaskId: z.string().uuid() }).strict();
const IncidentParamSchema = z.object({ missionId: z.string().uuid(), incidentId: z.string().uuid() }).strict();
const PresenceParamSchema = z.object({ missionId: z.string().uuid(), sessionId: z.string().uuid() }).strict();

type EventRow = typeof events.$inferSelect;
type MissionRow = typeof eventMissions.$inferSelect;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function actorForRequest(request: FastifyRequest): EventMissionActor {
  return {
    userId: request.user.id,
    role: EventPlanAudienceRoleSchema.parse(request.user.role),
    label: request.user.email,
  };
}

async function eventForRequest(db: Database, eventId: string): Promise<EventRow | null> {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  return event ?? null;
}

async function requireEventRead(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
): Promise<EventRow | null> {
  const event = await eventForRequest(db, eventId);
  if (event === null) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canAccessResource(request.user, event.createdBy, event.venueId)) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  return event;
}

async function requireEventWrite(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
): Promise<EventRow | null> {
  const event = await eventForRequest(db, eventId);
  if (event === null) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canManageVenue(request.user, event.venueId)) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  return event;
}

async function requireMissionRead(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  missionId: string,
): Promise<MissionRow | null> {
  const [scope] = await db.select({ mission: eventMissions, event: events })
    .from(eventMissions)
    .innerJoin(events, and(eq(events.id, eventMissions.eventId), isNull(events.deletedAt)))
    .where(eq(eventMissions.id, missionId))
    .limit(1);
  if (scope === undefined) {
    void reply.status(404).send({ error: "Mission not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canAccessResource(request.user, scope.event.createdBy, scope.mission.venueId)) {
    void reply.status(404).send({ error: "Mission not found", code: "NOT_FOUND" });
    return null;
  }
  return scope.mission;
}

async function requireMissionWrite(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  missionId: string,
): Promise<MissionRow | null> {
  const [scope] = await db.select({ mission: eventMissions, event: events })
    .from(eventMissions)
    .innerJoin(events, and(eq(events.id, eventMissions.eventId), isNull(events.deletedAt)))
    .where(eq(eventMissions.id, missionId))
    .limit(1);
  if (scope === undefined) {
    void reply.status(404).send({ error: "Mission not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canManageVenue(request.user, scope.mission.venueId)) {
    void reply.status(404).send({ error: "Mission not found", code: "NOT_FOUND" });
    return null;
  }
  return scope.mission;
}

function postgresUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { readonly code?: unknown }).code === "23505";
}

function missionError(reply: FastifyReply, error: unknown): FastifyReply | null {
  if (
    error instanceof EventMissionNotFoundError ||
    error instanceof EventMissionSourceNotFoundError ||
    error instanceof EventMissionReferenceMismatchError
  ) {
    return reply.status(404).send({ error: "Mission resource not found", code: "NOT_FOUND" });
  }
  if (error instanceof EventMissionRevisionConflictError) {
    return reply.status(409).send({
      error: "Mission state changed in another session",
      code: "REVISION_CONFLICT",
      details: { expectedRevision: error.expectedRevision, currentRevision: error.currentRevision },
    });
  }
  if (
    error instanceof EventMissionAlreadyLiveError ||
    error instanceof EventMissionClosedError ||
    error instanceof EventMissionActivePhaseConflictError ||
    error instanceof EventMissionAlreadyAcknowledgedError ||
    postgresUniqueViolation(error)
  ) {
    return reply.status(409).send({ error: "Mission command conflicts with current state", code: "MISSION_CONFLICT" });
  }
  if (error instanceof EventMissionInvalidTransitionError) {
    return reply.status(422).send({
      error: error.message,
      code: "INVALID_TRANSITION",
      details: { fromStatus: error.fromStatus, toStatus: error.toStatus },
    });
  }
  if (error instanceof EventMissionAcknowledgementNotRequiredError) {
    return reply.status(422).send({ error: "This mission event does not require acknowledgement", code: "ACKNOWLEDGEMENT_NOT_REQUIRED" });
  }
  return null;
}

async function runMissionCommand<T>(reply: FastifyReply, command: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await command();
  } catch (error) {
    const response = missionError(reply, error);
    if (response !== null) return response;
    throw error;
  }
}

export async function eventMissionEventRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/:eventId/mission", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = StartEventMissionInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireEventWrite(db, request, reply, params.data.eventId) === null) return;
    const result = await runMissionCommand(reply, () => startEventMission(
      db, params.data.eventId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return reply.status(201).send({ data: EventMissionBoardSchema.parse(result) });
  });

  server.get("/:eventId/mission", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    if (await requireEventRead(db, request, reply, params.data.eventId) === null) return;
    const board = await getLatestEventMissionBoard(db, params.data.eventId);
    if (board === null) return reply.status(404).send({ error: "Mission not found", code: "NOT_FOUND" });
    return { data: EventMissionBoardSchema.parse(board) };
  });
}

export async function eventMissionRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.patch("/:missionId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = TransitionEventMissionInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => transitionEventMission(
      db, params.data.missionId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return { data: EventMissionEventSchema.parse(result) };
  });

  server.get("/:missionId/timeline", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = EventMissionTimelineQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    if (await requireMissionRead(db, request, reply, params.data.missionId) === null) return;
    const timeline = await getEventMissionTimeline(db, params.data.missionId, query.data);
    return { data: EventMissionTimelineSchema.parse(timeline) };
  });

  server.get("/:missionId/replay", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = EventMissionReplayQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    if (await requireMissionRead(db, request, reply, params.data.missionId) === null) return;
    const replay = await getEventMissionReplay(db, params.data.missionId, query.data.throughSequence);
    return { data: EventMissionReplaySchema.parse(replay) };
  });

  server.post("/:missionId/presence", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = EventMissionPresenceHeartbeatInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionRead(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => heartbeatEventMissionPresence(
      db, params.data.missionId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return { data: EventMissionPresenceSchema.parse(result) };
  });

  server.delete("/:missionId/presence/:sessionId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = PresenceParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    if (await requireMissionRead(db, request, reply, params.data.missionId) === null) return;
    await endEventMissionPresence(db, params.data.missionId, params.data.sessionId, request.user.id);
    return reply.status(204).send();
  });

  server.patch("/:missionId/phases/:missionPhaseId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = PhaseParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = TransitionEventMissionPhaseInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => transitionEventMissionPhase(
      db, params.data.missionId, params.data.missionPhaseId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return { data: EventMissionEventSchema.parse(result) };
  });

  server.patch("/:missionId/tasks/:missionTaskId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = TaskParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = TransitionEventMissionTaskInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => transitionEventMissionTask(
      db, params.data.missionId, params.data.missionTaskId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return { data: EventMissionEventSchema.parse(result) };
  });

  server.post("/:missionId/incidents", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = CreateEventMissionIncidentInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => createEventMissionIncident(
      db, params.data.missionId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return reply.status(201).send({ data: EventMissionEventSchema.parse(result) });
  });

  server.patch("/:missionId/incidents/:incidentId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IncidentParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = UpdateEventMissionIncidentInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => updateEventMissionIncident(
      db, params.data.missionId, params.data.incidentId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return { data: EventMissionEventSchema.parse(result) };
  });

  server.post("/:missionId/acknowledgements", { preHandler: [authenticate] }, async (request, reply) => {
    const params = MissionParamSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = AcknowledgeEventMissionEventInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (await requireMissionWrite(db, request, reply, params.data.missionId) === null) return;
    const result = await runMissionCommand(reply, () => acknowledgeEventMissionEvent(
      db, params.data.missionId, body.data, actorForRequest(request),
    ));
    if ("statusCode" in result) return result;
    return reply.status(201).send({ data: EventMissionEventSchema.parse(result) });
  });
}

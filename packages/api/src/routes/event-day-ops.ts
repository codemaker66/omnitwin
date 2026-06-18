import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CreateEventDayIssueInputSchema,
  EventDayChangesSinceLastHandoffSchema,
  EventPlanAudienceRoleSchema,
  EventDayIssueSchema,
  EventDayOpsBoardSchema,
  OpsTaskSchema,
  UpdateEventDayIssueInputSchema,
  UpdateOpsTaskStatusInputSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { eventPhases, events, handoffPacks, opsTasks } from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";
import {
  EventDayIssueNotFoundError,
  EventDayTaskNotFoundError,
  createEventDayIssue,
  getEventDayOpsBoard,
  loadEventForOpsBoard,
  updateEventDayIssue,
  updateOpsTaskStatus,
} from "../services/event-day-ops.js";
import { recordEventPlanChange } from "../services/event-plan-lifecycle.js";

const EventIdParam = z.object({ id: z.string().uuid() });
const IssueParam = z.object({ id: z.string().uuid(), issueId: z.string().uuid() });
const OpsTaskIdParam = z.object({ id: z.string().uuid() });

type FastifyRequestUser = Parameters<typeof canAccessResource>[0];
type EventRow = typeof events.$inferSelect;

function boundedLifecycleSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) return "Event-day operation changed.";
  return trimmed.length <= 800 ? trimmed : `${trimmed.slice(0, 797)}...`;
}

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

async function requireEventAccess(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
): Promise<EventRow | null> {
  const eventRow = await loadEventForOpsBoard(db, eventId);
  if (eventRow === null) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canAccessResource(request.user, eventRow.createdBy, eventRow.venueId)) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return eventRow;
}

async function opsTaskAccessResponse(
  db: Database,
  user: FastifyRequestUser,
  opsTaskId: string,
): Promise<"missing" | "forbidden" | "ok"> {
  const [joined] = await db.select({
    createdBy: events.createdBy,
    venueId: events.venueId,
  })
    .from(opsTasks)
    .innerJoin(handoffPacks, eq(opsTasks.handoffPackId, handoffPacks.id))
    .innerJoin(events, eq(handoffPacks.eventId, events.id))
    .where(and(eq(opsTasks.id, opsTaskId), isNull(events.deletedAt)))
    .limit(1);

  if (joined === undefined) return "missing";
  return canAccessResource(user, joined.createdBy, joined.venueId) ? "ok" : "forbidden";
}

async function validateIssueReferences(
  db: Database,
  eventId: string,
  refs: {
    readonly phaseId?: string | null;
    readonly opsTaskId?: string | null;
  },
): Promise<"ok" | "phase_mismatch" | "task_mismatch"> {
  if (refs.phaseId !== undefined && refs.phaseId !== null) {
    const [phase] = await db.select({ eventId: eventPhases.eventId })
      .from(eventPhases)
      .where(eq(eventPhases.id, refs.phaseId))
      .limit(1);
    if (phase === undefined || phase.eventId !== eventId) return "phase_mismatch";
  }

  if (refs.opsTaskId !== undefined && refs.opsTaskId !== null) {
    const [task] = await db.select({ eventId: handoffPacks.eventId })
      .from(opsTasks)
      .innerJoin(handoffPacks, eq(opsTasks.handoffPackId, handoffPacks.id))
      .where(eq(opsTasks.id, refs.opsTaskId))
      .limit(1);
    if (task === undefined || task.eventId !== eventId) return "task_mismatch";
  }

  return "ok";
}

export async function eventDayEventRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:id/ops-board", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const board = await getEventDayOpsBoard(db, eventRow);
    return { data: EventDayOpsBoardSchema.parse(board) };
  });

  server.get("/:id/changes-since-last-handoff", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const board = await getEventDayOpsBoard(db, eventRow);
    return { data: EventDayChangesSinceLastHandoffSchema.parse(board.changesSinceLastHandoff) };
  });

  server.post("/:id/issues", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const parsed = CreateEventDayIssueInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const refStatus = await validateIssueReferences(db, eventRow.id, parsed.data);
    if (refStatus !== "ok") {
      return reply.status(400).send({
        error: "Issue reference does not belong to this event",
        code: "EVENT_DAY_REFERENCE_MISMATCH",
      });
    }

    const issue = await createEventDayIssue(db, {
      ...parsed.data,
      eventId: eventRow.id,
      actorUserId: request.user.id,
    });

    await recordEventPlanChange(db, {
      eventId: eventRow.id,
      venueId: eventRow.venueId,
      actorUserId: request.user.id,
      actorRole: EventPlanAudienceRoleSchema.parse(request.user.role),
      actorLabel: request.user.email,
      sourceKind: "ops_issue",
      sourceId: issue.id,
      title: "Event-day issue logged",
      summary: boundedLifecycleSummary(`${issue.title}: ${issue.detail}`),
      affectedSurfaces: ["ops_tasks", "service_notes"],
      audienceRoles: ["staff", "hallkeeper"],
      riskLevel: issue.severity === "urgent" ? "blocker" : issue.severity,
      requiresHallkeeperAcknowledgement: false,
      actionPath: `/ops/events/${eventRow.id}`,
    });

    return reply.status(201).send({ data: EventDayIssueSchema.parse(issue) });
  });

  server.patch("/:id/issues/:issueId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IssueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const parsed = UpdateEventDayIssueInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    try {
      const issue = await updateEventDayIssue(db, {
        ...parsed.data,
        eventId: eventRow.id,
        issueId: params.data.issueId,
        actorUserId: request.user.id,
      });
      return { data: EventDayIssueSchema.parse(issue) };
    } catch (err) {
      if (err instanceof EventDayIssueNotFoundError) {
        return reply.status(404).send({ error: "Issue not found", code: "NOT_FOUND" });
      }
      throw err;
    }
  });
}

export async function eventDayOpsTaskRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.patch("/:id/status", { preHandler: [authenticate] }, async (request, reply) => {
    const params = OpsTaskIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const parsed = UpdateOpsTaskStatusInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const access = await opsTaskAccessResponse(db, request.user, params.data.id);
    if (access === "missing") {
      return reply.status(404).send({ error: "Task not found", code: "NOT_FOUND" });
    }
    if (access === "forbidden") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    try {
      const result = await updateOpsTaskStatus(db, {
        ...parsed.data,
        opsTaskId: params.data.id,
        actorUserId: request.user.id,
      });

      if (result.completionEvent !== null && !result.idempotentReplay) {
        const eventRow = await loadEventForOpsBoard(db, result.completionEvent.eventId);
        if (eventRow !== null) {
          await recordEventPlanChange(db, {
            eventId: eventRow.id,
            venueId: eventRow.venueId,
            handoffPackId: result.task.handoffPackId,
            actorUserId: request.user.id,
            actorRole: EventPlanAudienceRoleSchema.parse(request.user.role),
            actorLabel: request.user.email,
            sourceKind: "ops_task",
            sourceId: result.completionEvent.id,
            title: "Hallkeeper task updated",
            summary: boundedLifecycleSummary(`Task "${result.task.title}" moved from ${result.completionEvent.fromStatus} to ${result.completionEvent.toStatus}.`),
            affectedSurfaces: ["ops_tasks"],
            audienceRoles: ["staff", "hallkeeper"],
            riskLevel: result.completionEvent.toStatus === "blocked" ? "blocker" : "info",
            requiresHallkeeperAcknowledgement: false,
            actionPath: `/ops/events/${eventRow.id}`,
          });
        }
      }

      return { data: OpsTaskSchema.parse(result.task) };
    } catch (err) {
      if (err instanceof EventDayTaskNotFoundError) {
        return reply.status(404).send({ error: "Task not found", code: "NOT_FOUND" });
      }
      throw err;
    }
  });
}

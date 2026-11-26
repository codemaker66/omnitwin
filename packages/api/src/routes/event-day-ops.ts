import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ChangeFeedItemSchema,
  CreateEventDayIssueInputSchema,
  EventDayChangesSinceLastHandoffSchema,
  toEventPlanAudienceRole,
  EventDayIssueSchema,
  EventDayOpsBoardSchema,
  OpsTaskSchema,
  UpdateEventDayIssueInputSchema,
  UpdateOpsTaskStatusConflictSchema,
  UpdateOpsTaskStatusInputSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { eventPhases, eventPlanChangeAcknowledgements, eventPlanChanges, events, handoffPacks, opsTasks } from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import { outerColumn } from "../utils/outer-column.js";
import { lockConflictOf, RETRY_ANSWER } from "../utils/sql-state.js";
import { canAccessInternalEvent } from "../utils/query.js";
import {
  EventDayIssueNotFoundError,
  EventDayTaskNotFoundError,
  EventDayTaskStatusConflictError,
  createEventDayIssue,
  getEventDayOpsBoard,
  loadEventForOpsBoard,
  updateEventDayIssue,
  updateOpsTaskStatus,
} from "../services/event-day-ops.js";
import { serializeEventPlanChange } from "../services/event-plan-lifecycle.js";

/** More than a floor ever has waiting. A list cut here is still not empty, so
 *  the board can never be told nothing waits when something does. */
const AWAITING_ACKNOWLEDGEMENT_LIMIT = 200;

const EventIdParam = z.object({ id: z.uuid() });
const IssueParam = z.object({ id: z.uuid(), issueId: z.uuid() });
const OpsTaskIdParam = z.object({ id: z.uuid() });

type FastifyRequestUser = Parameters<typeof canAccessInternalEvent>[0];
type EventRow = typeof events.$inferSelect;

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
  if (!canAccessInternalEvent(request.user, eventRow.venueId)) {
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
    venueId: events.venueId,
  })
    .from(opsTasks)
    .innerJoin(handoffPacks, eq(opsTasks.handoffPackId, handoffPacks.id))
    .innerJoin(events, eq(handoffPacks.eventId, events.id))
    .where(and(eq(opsTasks.id, opsTaskId), isNull(events.deletedAt)))
    .limit(1);

  if (joined === undefined) return "missing";
  return canAccessInternalEvent(user, joined.venueId) ? "ok" : "forbidden";
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

  // The changes to this event that ask for a hallkeeper's acknowledgement and
  // have none yet, newest first.
  //
  // The board used to find these by reading the newest 25 changes of every
  // kind (GET /:eventId/change-feed) and filtering in the browser. Every task
  // move and every issue is a change too, so on a busy set-up an unacknowledged
  // guest-count change fell off that page and the board said nothing was
  // waiting. This asks the question the board means, so no number of later
  // changes can hide one. One acknowledgement by anybody on the floor settles a
  // change for the room, which is how the board has always read them.
  server.get("/:id/changes-awaiting-acknowledgement", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const waiting = await db
      .select()
      .from(eventPlanChanges)
      .where(and(
        eq(eventPlanChanges.eventId, eventRow.id),
        eq(eventPlanChanges.requiresHallkeeperAcknowledgement, true),
        notExists(
          db.select({ one: sql`1` })
            .from(eventPlanChangeAcknowledgements)
            // The change's id, named with its table: a bare "id" here would be
            // the acknowledgement's own (utils/outer-column.ts).
            .where(eq(eventPlanChangeAcknowledgements.changeId, outerColumn(eventPlanChanges.id))),
        ),
      ))
      .orderBy(desc(eventPlanChanges.createdAt))
      .limit(AWAITING_ACKNOWLEDGEMENT_LIMIT);

    return { data: z.array(ChangeFeedItemSchema).parse(waiting.map(serializeEventPlanChange)) };
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

    // The issue and its change-feed copy commit together (the service records
    // the copy in its transaction), so an erasure of the event's person never
    // falls between them.
    const issue = await createEventDayIssue(db, {
      ...parsed.data,
      eventId: eventRow.id,
      actorUserId: request.user.id,
      changeActor: { actorRole: toEventPlanAudienceRole(request.user.role), actorLabel: request.user.email },
    }).catch((err: unknown) => {
      if (lockConflictOf(err) !== null) return null;
      throw err;
    });
    // An erasure of the event's person holds the event while it rewords the
    // event's issues: one of the two is rolled back (people-erasure.ts).
    if (issue === null) return reply.status(409).send(RETRY_ANSWER);

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
      // An erasure of a person whose event this is holds the event while it
      // rewords this row: one of the two is rolled back (people-erasure.ts).
      if (lockConflictOf(err) !== null) return reply.status(409).send(RETRY_ANSWER);
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
      // The tick and its change-feed copy commit together (the service records
      // the copy in its transaction, quoting the title as read after the event
      // lock), so an erasure of the event's person never falls between them.
      const result = await updateOpsTaskStatus(db, {
        ...parsed.data,
        opsTaskId: params.data.id,
        actorUserId: request.user.id,
        changeActor: { actorRole: toEventPlanAudienceRole(request.user.role), actorLabel: request.user.email },
      });

      return { data: OpsTaskSchema.parse(result.task) };
    } catch (err) {
      if (err instanceof EventDayTaskNotFoundError) {
        return reply.status(404).send({ error: "Task not found", code: "NOT_FOUND" });
      }
      // A replayed status pressed against one the task has left (#418):
      // nothing was written, and the board is given the task as it stands.
      if (err instanceof EventDayTaskStatusConflictError) {
        return reply.status(409).send({
          error: "This task moved on before this status arrived.",
          code: "TASK_STATUS_CONFLICT",
          details: UpdateOpsTaskStatusConflictSchema.parse({ task: err.task }),
        });
      }
      // An erasure of a person whose event this is holds the event while it
      // rewords this row: one of the two is rolled back (people-erasure.ts).
      if (lockConflictOf(err) !== null) return reply.status(409).send(RETRY_ANSWER);
      throw err;
    }
  });
}

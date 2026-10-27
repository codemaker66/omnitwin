import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DecideDecisionSchema, DecisionStatusSchema, PrepareBookingTimeMoveSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import {
  decideDecision,
  listDecisions,
  prepareBookingTimeMove,
  readDecision,
  withdrawDecision,
  type DecisionResult,
} from "../services/decisions.js";

// ---------------------------------------------------------------------------
// /decisions — prepared decisions (goal 09 M1; M2's booking time move).
//
//   POST /decisions/booking-time-moves  prepare a move from what the Diary holds
//   GET  /decisions?status=prepared     the venue's decisions, newest first
//   GET  /decisions/:id                 a decision and its history
//   POST /decisions/:id/decide          { optionId, subjectDigest }
//   POST /decisions/:id/withdraw        take back a prepared decision
//
// Everything is at the venue the person works at: another venue's decision is
// not found. Deciding needs the approval for the decision's class
// (DECISION_APPROVER_ROLES in @omnitwin/types), and runs as the Diary's own
// command after the Diary is read again; a stale decision answers 409
// DECISION_STALE with the revised decision, having changed nothing. A choice
// made again is answered with its receipt (Idempotency-Replay: true). An
// executed move is announced to the live Diary after commit, as its own
// writes are.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.uuid() }).strict();
const ListQuery = z.object({
  status: DecisionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function send<T>(reply: FastifyReply, result: DecisionResult<T>): FastifyReply {
  if (!result.ok) {
    return reply.status(result.status).send({
      error: result.error,
      code: result.code,
      ...(result.details === undefined ? {} : { details: result.details }),
    });
  }
  if (result.replay === true) void reply.header("Idempotency-Replay", "true");
  return reply.status(result.status).send({ data: result.value });
}

export async function decisionRoutes(server: FastifyInstance, opts: { readonly db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/booking-time-moves", { preHandler: [authenticate] }, async (request, reply) => {
    const body = PrepareBookingTimeMoveSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    return send(reply, await prepareBookingTimeMove(db, request.user, body.data));
  });

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = ListQuery.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    return send(reply, await listDecisions(db, request.user, query.data));
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    return send(reply, await readDecision(db, request.user, params.data.id));
  });

  server.post("/:id/decide", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = DecideDecisionSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    let result: Awaited<ReturnType<typeof decideDecision>>;
    try {
      result = await decideDecision(db, request.user, params.data.id, body.data);
    } catch (err) {
      request.log.error({ err }, "Decision could not be carried out");
      return reply.status(500).send({ error: "The change could not be completed; nothing was changed.", code: "DECISION_EXECUTION_FAILED" });
    }
    // Commit, then broadcast: a fresh move is announced to the live Diary.
    if (result.ok && result.replay !== true && result.value.status === "executed") {
      emit(request.log, "diary.changed", {
        venueId: result.value.venueId,
        kind: "booking.updated",
        bookingId: result.value.subject.id,
        actorUserId: request.user.id,
        at: new Date().toISOString(),
      });
    }
    return send(reply, result);
  });

  server.post("/:id/withdraw", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    return send(reply, await withdrawDecision(db, request.user, params.data.id));
  });
}

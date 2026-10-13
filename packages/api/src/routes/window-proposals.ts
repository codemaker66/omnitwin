import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ProposeWindowSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import { proposeWindowCore, type ProposalActor } from "../services/window-proposals.js";
import { canEverProposeWindow } from "../utils/query.js";
import { withHeaderKey } from "./conversations.js";

// ---------------------------------------------------------------------------
// The propose door (goal 19 S6): PUT /events/:eventId/proposed-window.
//
// The client's side says when; the house holds it. One door for the first
// proposal and for moving it, idempotent on the gesture's key (header and
// body must agree, as the conversation doors do). The roles that never
// propose are turned away before any database work; the link proof, the
// hygiene and the ledger live in services/window-proposals.ts.
// ---------------------------------------------------------------------------

const EventParam = z.object({ eventId: z.string().uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function actorOf(request: FastifyRequest): ProposalActor {
  return {
    id: request.user.id,
    name: request.user.name,
    role: request.user.role,
    venueId: request.user.venueId,
    platformRole: request.user.platformRole,
  };
}

export async function windowProposalRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.put("/:eventId/proposed-window", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const actor = actorOf(request);
    if (!canEverProposeWindow(actor)) {
      return reply.status(403).send({ error: "Only the client's side and the office propose a time.", code: "FORBIDDEN" });
    }
    const keyed = withHeaderKey(request, reply);
    if (keyed === null) return reply;
    const parsed = ProposeWindowSchema.safeParse(keyed.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await proposeWindowCore(db, actor, params.data.eventId, parsed.data);
    if (!result.ok) return reply.status(result.status).send({ error: result.error, code: result.code });
    if (!result.replay) {
      emit(request.log, "diary.changed", {
        venueId: result.venueId, kind: result.changeKind, bookingId: result.slot.bookingId, actorUserId: actor.id, at: new Date().toISOString(),
      });
    }
    return reply
      .status(result.replay ? 200 : result.status)
      .header("idempotency-replay", String(result.replay))
      .send({ data: result.slot });
  });
}

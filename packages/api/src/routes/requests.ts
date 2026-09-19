import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CreateVenueRequestSchema,
  RequestListQuerySchema,
  RequestStatusHistoryEntrySchema,
  RequestTransitionSchema,
  VenueRequestSchema,
  type VenueRequest,
} from "@omnitwin/types";
import { requestStatusHistory } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import { canManageVenue } from "../utils/query.js";
import {
  createRequestCore,
  listRequestsForVenue,
  readRequest,
  runRequestEscalationPass,
  transitionRequestCore,
  type RequestActor,
  type RequestDeny,
} from "../services/requests.js";

// ---------------------------------------------------------------------------
// The request surface (Ship Friday slice 10, gate line 22).
//
// Thin on purpose: parse, delegate to services/requests.ts, shape the reply,
// and announce the change on the house bus AFTER the core has committed. The
// tenancy gate, the audience rule, the idempotency guard and the ladder all
// live in the core, so any future caller gets the same answers HTTP does.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.string().uuid() });
const IdParam = z.object({ id: z.string().uuid() });
const IdempotencyKeyHeader = z.string().uuid();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function sendDeny(reply: FastifyReply, result: RequestDeny): FastifyReply {
  return reply.status(result.status).send({ error: result.error, code: result.code });
}

function isDeny(value: unknown): value is RequestDeny {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && (value as { readonly ok: unknown }).ok === false;
}

function actorOf(request: FastifyRequest): RequestActor {
  return {
    id: request.user.id,
    name: request.user.name,
    role: request.user.role,
    venueId: request.user.venueId,
    platformRole: request.user.platformRole,
  };
}

/** Announce a committed change. Two events, deliberately: the request stream
 *  drives the slab, the notification stream drives the inbox and its count. */
function publishRequestChange(
  request: FastifyRequest,
  kind: "request.created" | "request.updated" | "request.escalated",
  changed: VenueRequest,
  notificationIds: readonly string[],
  recipientUserIds: readonly string[] = [],
): void {
  const at = new Date().toISOString();
  emit(request.log, "request.changed", {
    venueId: changed.venueId,
    kind,
    requestId: changed.id,
    bookingId: changed.bookingId,
    roomId: changed.roomId,
    state: changed.state,
    audienceRoles: changed.audienceRoles,
    actorUserId: request.user.id,
    at,
  });
  if (notificationIds.length === 0) return;
  emit(request.log, "notification.created", {
    venueId: changed.venueId,
    audienceRoles: changed.audienceRoles,
    recipientUserIds,
    notificationIds,
    title: changed.roomName === null
      ? "A request was made"
      : `A request was made in ${changed.roomName}`,
    severity: changed.urgency === "now" ? "urgent" : "attention",
    at,
  });
}

// ---------------------------------------------------------------------------
// /venues/:venueId/requests
// ---------------------------------------------------------------------------

export async function venueRequestRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/:venueId/requests", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    // The key may arrive in the body (the slab mints one per press) or in the
    // house Idempotency-Key header. Both are accepted; disagreeing is a 400
    // rather than a silent choice between them.
    const rawBody: unknown = request.body ?? {};
    const header = request.headers["idempotency-key"];
    let body: unknown = rawBody;
    if (header !== undefined) {
      const parsedHeader = IdempotencyKeyHeader.safeParse(header);
      if (!parsedHeader.success) {
        return validationError(reply, [
          { path: ["idempotency-key"], message: "Idempotency-Key must be a uuid" },
        ]);
      }
      if (typeof rawBody === "object" && rawBody !== null) {
        const record = rawBody as Record<string, unknown>;
        const inBody = record["idempotencyKey"];
        if (inBody !== undefined && inBody !== parsedHeader.data) {
          return validationError(reply, [
            { path: ["idempotencyKey"], message: "The body and the Idempotency-Key header disagree" },
          ]);
        }
        body = { ...record, idempotencyKey: parsedHeader.data };
      }
    }

    const parsed = CreateVenueRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await createRequestCore(db, actorOf(request), params.data.venueId, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);

    // Committed → announced. A replay announces nothing: the same request is
    // already on every board that was listening the first time.
    if (!result.replay) {
      publishRequestChange(request, "request.created", result.request, result.notificationIds);
    }

    return reply
      .status(result.replay ? 200 : 201)
      .header("idempotency-replay", String(result.replay))
      .send({ data: VenueRequestSchema.parse(result.request) });
  });

  server.get("/:venueId/requests", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = RequestListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await listRequestsForVenue(db, actorOf(request), params.data.venueId, query.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: z.array(VenueRequestSchema).parse(result) };
  });

  // The escalation sweep as an endpoint, for an external cron and for a
  // rehearsal on a disposable stack. The API also sweeps on its own short
  // timer (see ws/diary-live.ts); both are safe to run together because the
  // claim is a conditional UPDATE, not a schedule.
  server.post("/:venueId/requests/escalation-pass", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const actor = actorOf(request);
    if (!canManageVenue(actor, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!isPlatformAdmin(actor) && actor.role !== "admin") {
      return reply.status(403).send({
        error: "Only a venue administrator can run the escalation pass.",
        code: "FORBIDDEN",
      });
    }

    const escalated = await runRequestEscalationPass(db, { logger: request.log });
    const mine = escalated.filter((item) => item.request.venueId === params.data.venueId);
    for (const item of mine) {
      publishRequestChange(request, "request.escalated", item.request, item.notificationIds);
    }
    return { data: { escalated: mine.length } };
  });
}

// ---------------------------------------------------------------------------
// /requests/:id
// ---------------------------------------------------------------------------

export async function requestRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await readRequest(db, actorOf(request), params.data.id);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: VenueRequestSchema.parse(result) };
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = RequestTransitionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await transitionRequestCore(db, actorOf(request), params.data.id, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);

    publishRequestChange(request, "request.updated", result.request, []);
    return { data: VenueRequestSchema.parse(result.request) };
  });

  server.get("/:id/history", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    // Authorisation first: the history is the request's own story, so it is
    // readable exactly when the request is.
    const readable = await readRequest(db, actorOf(request), params.data.id);
    if (isDeny(readable)) return sendDeny(reply, readable);

    const rows = await db
      .select()
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, params.data.id))
      .orderBy(asc(requestStatusHistory.at))
      .limit(100);

    return {
      data: z.array(RequestStatusHistoryEntrySchema).parse(rows.map((row) => ({
        id: row.id,
        requestId: row.requestId,
        fromState: row.fromState ?? null,
        toState: row.toState,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        actorRole: row.actorRole,
        outcome: row.outcome ?? null,
        note: row.note,
        at: row.at.toISOString(),
      }))),
    };
  });
}

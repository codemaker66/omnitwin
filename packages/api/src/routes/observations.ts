import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ObservationListQuerySchema,
  RecordObservationSchema,
  SlotObservationSchema,
  type SlotObservation,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import { listObservationsForVenue, recordObservationCore, type ObservationDeny } from "../services/observations.js";
import type { RequestActor } from "../services/requests.js";

// ---------------------------------------------------------------------------
// /venues/:venueId/observations (goal 19 S5).
//
// The REST door for a fact about the room: the same core the /ws/diary
// command `observation.record` runs, so a tap that left over a dying socket
// and arrived again over fetch is ONE fact. The key travels in the body and
// in the house Idempotency-Key header; disagreeing is a 400, never a silent
// choice. A replay answers 200 with the first fact and announces nothing.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.string().uuid() });
const IdempotencyKeyHeader = z.string().uuid();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function sendDeny(reply: FastifyReply, result: ObservationDeny): FastifyReply {
  return reply.status(result.status).send({ error: result.error, code: result.code });
}

function isDeny(value: unknown): value is ObservationDeny {
  return typeof value === "object" && value !== null && "ok" in value && (value as { readonly ok: unknown }).ok === false;
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

/** The body key and the house Idempotency-Key header must agree; the header
 *  fills a missing body key. Returns null once a 400 has been sent. */
function withHeaderKey(request: FastifyRequest, reply: FastifyReply): { readonly body: unknown } | null {
  const rawBody: unknown = request.body ?? {};
  const header = request.headers["idempotency-key"];
  if (header === undefined) return { body: rawBody };
  const parsedHeader = IdempotencyKeyHeader.safeParse(header);
  if (!parsedHeader.success) {
    void validationError(reply, [{ path: ["idempotency-key"], message: "Idempotency-Key must be a uuid" }]);
    return null;
  }
  if (typeof rawBody !== "object" || rawBody === null) return { body: rawBody };
  const record = rawBody as Record<string, unknown>;
  const inBody = record["idempotencyKey"];
  if (inBody !== undefined && inBody !== parsedHeader.data) {
    void validationError(reply, [{ path: ["idempotencyKey"], message: "The body and the Idempotency-Key header disagree" }]);
    return null;
  }
  return { body: { ...record, idempotencyKey: parsedHeader.data } };
}

/** Committed → announced, on the bus path the hub fans out. */
export function announceObservation(log: FastifyBaseLogger, actorUserId: string, observation: SlotObservation): void {
  emit(log, "observation.changed", {
    venueId: observation.venueId,
    bookingId: observation.bookingId,
    spaceId: observation.spaceId,
    kind: observation.kind,
    observationId: observation.id,
    observedAt: observation.observedAt,
    actorUserId,
    at: observation.recordedAt,
  });
}

export async function venueObservationRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/:venueId/observations", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const keyed = withHeaderKey(request, reply);
    if (keyed === null) return reply;
    const parsed = RecordObservationSchema.safeParse(keyed.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await recordObservationCore(db, actorOf(request), params.data.venueId, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    if (!result.replay) announceObservation(request.log, request.user.id, result.observation);

    return reply
      .status(result.replay ? 200 : 201)
      .header("idempotency-replay", String(result.replay))
      .send({ data: SlotObservationSchema.parse(result.observation) });
  });

  server.get("/:venueId/observations", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = ObservationListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await listObservationsForVenue(db, actorOf(request), params.data.venueId, query.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: z.array(SlotObservationSchema).parse(result) };
  });
}

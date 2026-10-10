import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ClientCreateRequestSchema,
  ConversationSnapshotSchema,
  CreateThreadSchema,
  MarkReceiptSchema,
  MessageListQuerySchema,
  MessageReceiptSchema,
  MessageSchema,
  SendMessageSchema,
  ThreadListQuerySchema,
  ThreadSchema,
  VenueRequestSchema,
  isClientSideRole,
  type Message,
  type Thread,
  type VenueRequest,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import { canManageVenue } from "../utils/query.js";
import {
  clientConversationSnapshot,
  listMessagesCore,
  listThreadsCore,
  markReceiptCore,
  openThreadCore,
  readThreadCore,
  sendClientMessageCore,
  sendMessageCore,
  type ConversationActor,
  type ConversationDeny,
} from "../services/conversations.js";
import {
  createClientRequestCore,
  listRequestsForClientEvent,
  type RequestDeny,
} from "../services/requests.js";

// ---------------------------------------------------------------------------
// The conversation surface (goal 19 S1).
//
// Thin on purpose: parse, delegate to services/conversations.ts, shape the
// reply, announce the committed change on the house bus. The audience rule,
// the link check, the idempotency guard and the receipts all live in the
// core, so the hub's command path (S2) gets the same answers HTTP does.
//
// There is deliberately no PATCH /threads/:id: a thread's audience has no
// route that changes it. Broadening means a new thread.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.string().uuid() });
const IdParam = z.object({ id: z.string().uuid() });
const EventParam = z.object({ eventId: z.string().uuid() });
const IdempotencyKeyHeader = z.string().uuid();
const AfterQuery = z.object({ after: z.coerce.number().int().min(0).default(0) }).strict();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function sendDeny(reply: FastifyReply, result: ConversationDeny | RequestDeny): FastifyReply {
  return reply.status(result.status).send({ error: result.error, code: result.code });
}

function isDeny(value: unknown): value is ConversationDeny {
  return typeof value === "object" && value !== null && "ok" in value && (value as { readonly ok: unknown }).ok === false;
}

function actorOf(request: FastifyRequest): ConversationActor {
  return {
    id: request.user.id,
    name: request.user.name,
    role: request.user.role,
    venueId: request.user.venueId,
    platformRole: request.user.platformRole,
  };
}

/** The body key and the house Idempotency-Key header must agree; the header
 *  fills a missing body key. Disagreeing is a 400, never a silent choice.
 *  Returns null once a 400 has been sent. */
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

function announceMessage(request: FastifyRequest, thread: Thread, message: Message): void {
  emit(request.log, "conversation.changed", {
    venueId: thread.venueId,
    kind: "message.sent",
    threadId: thread.id,
    audience: thread.audience,
    subject: thread.subject,
    bookingId: thread.bookingId,
    eventId: thread.eventId,
    requestId: thread.requestId,
    messageId: message.id,
    cursor: message.cursor,
    actorUserId: request.user.id,
    at: message.createdAt,
  });
}

function announceRequest(
  request: FastifyRequest,
  kind: "request.created" | "request.updated",
  changed: VenueRequest,
  notificationIds: readonly string[],
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
    recipientUserIds: [],
    notificationIds,
    title: changed.roomName === null ? "A request was made" : `A request was made in ${changed.roomName}`,
    severity: changed.urgency === "now" ? "urgent" : "attention",
    at,
  });
}

// ---------------------------------------------------------------------------
// /venues/:venueId/threads
// ---------------------------------------------------------------------------

export async function venueThreadRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/:venueId/threads", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const actor = actorOf(request);
    if (!canManageVenue(actor, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const parsed = CreateThreadSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await openThreadCore(db, actor, params.data.venueId, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return reply.status(result.created ? 201 : 200).send({ data: ThreadSchema.parse(result.thread) });
  });

  server.get("/:venueId/threads", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const actor = actorOf(request);
    if (!canManageVenue(actor, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const query = ThreadListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await listThreadsCore(db, actor, params.data.venueId, query.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: z.array(ThreadSchema).parse(result) };
  });
}

// ---------------------------------------------------------------------------
// /threads/:id
// ---------------------------------------------------------------------------

export async function threadRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await readThreadCore(db, actorOf(request), params.data.id);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: ThreadSchema.parse(result) };
  });

  server.get("/:id/messages", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = MessageListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await listMessagesCore(db, actorOf(request), params.data.id, query.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return {
      data: {
        thread: ThreadSchema.parse(result.thread),
        messages: z.array(MessageSchema).parse(result.messages),
        cursor: result.cursor,
        serverNowMs: Date.now(),
      },
    };
  });

  server.post("/:id/messages", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const keyed = withHeaderKey(request, reply);
    if (keyed === null) return reply;
    const parsed = SendMessageSchema.safeParse(keyed.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await sendMessageCore(db, actorOf(request), params.data.id, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    if (!result.replay) announceMessage(request, result.thread, result.message);
    return reply
      .status(result.replay ? 200 : 201)
      .header("idempotency-replay", String(result.replay))
      .send({ data: MessageSchema.parse(result.message) });
  });
}

// ---------------------------------------------------------------------------
// /messages/:id
// ---------------------------------------------------------------------------

export async function messageRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/:id/receipt", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = MarkReceiptSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await markReceiptCore(db, actorOf(request), params.data.id, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: MessageReceiptSchema.parse(result.receipt) };
  });
}

// ---------------------------------------------------------------------------
// /events/:eventId — the client's door (polled every 5 s while visible)
// ---------------------------------------------------------------------------

export async function clientConversationRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:eventId/conversation", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = AfterQuery.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await clientConversationSnapshot(db, actorOf(request), params.data.eventId, query.data.after);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: ConversationSnapshotSchema.parse(result) };
  });

  server.post("/:eventId/conversation/messages", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const keyed = withHeaderKey(request, reply);
    if (keyed === null) return reply;
    const parsed = SendMessageSchema.safeParse(keyed.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await sendClientMessageCore(db, actorOf(request), params.data.eventId, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    if (!result.replay) announceMessage(request, result.thread, result.message);
    return reply
      .status(result.replay ? 200 : 201)
      .header("idempotency-replay", String(result.replay))
      .send({ data: MessageSchema.parse(result.message) });
  });

  server.post("/:eventId/requests", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const actor = actorOf(request);
    // The client's door: the floor raises its requests on the venue route.
    if (!isClientSideRole(actor.role) && !isPlatformAdmin(actor)) {
      return reply.status(403).send({ error: "Only the event's client asks here.", code: "FORBIDDEN" });
    }
    const keyed = withHeaderKey(request, reply);
    if (keyed === null) return reply;
    const parsed = ClientCreateRequestSchema.safeParse(keyed.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const result = await createClientRequestCore(db, actor, params.data.eventId, parsed.data);
    if (isDeny(result)) return sendDeny(reply, result);
    if (!result.replay) announceRequest(request, "request.created", result.request, result.notificationIds);
    return reply
      .status(result.replay ? 200 : 201)
      .header("idempotency-replay", String(result.replay))
      .send({ data: VenueRequestSchema.parse(result.request) });
  });

  server.get("/:eventId/requests", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await listRequestsForClientEvent(db, actorOf(request), params.data.eventId);
    if (isDeny(result)) return sendDeny(reply, result);
    return { data: z.array(VenueRequestSchema).parse(result) };
  });
}

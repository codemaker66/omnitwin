import { and, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { summariseRequest, type VenueRequest } from "@omnitwin/types";
import { requests, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { sendPush, type PushDeps, type PushSendRecord } from "./push.js";

// ---------------------------------------------------------------------------
// The three things a device is ever told (goal 19 S7, D8):
//   a request landed for you      everyone the request's audience names,
//                                 less whoever raised it
//   a request escalated to you    the duty admins the escalation reached
//   a reply to your request       the person who raised the request, when
//                                 someone else wrote
// Each is fire-and-forget at its call site: `tell(...)`. Nothing here
// changes a request, a message or a time; it only tells people.
// ---------------------------------------------------------------------------

const DAY_BOARD_PATH = "/hallkeeper/today";

function roomWords(request: VenueRequest): string {
  return request.roomName ?? "a room";
}

export async function pushForRequestLanded(
  db: Database,
  request: VenueRequest,
  deps: PushDeps = {},
): Promise<readonly PushSendRecord[]> {
  const audience = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.venueId, request.venueId), inArray(users.role, [...request.audienceRoles])))
    .limit(200);
  const userIds = audience.map((person) => person.id).filter((id) => id !== request.requestedByUserId);
  return sendPush(db, {
    venueId: request.venueId,
    userIds,
    event: "request.landed",
    title: summariseRequest({ kind: request.kind, quantity: request.quantity, roomName: request.roomName }),
    body: `${request.requestedByName} asked, ${roomWords(request)}.`,
    url: DAY_BOARD_PATH,
    tag: `request:${request.id}`,
    idempotencyKeyBase: `push:request.landed:${request.id}`,
  }, deps);
}

/** An escalation tells its duty admins once per escalation: a request can
 *  escalate unowned and later again, handed to a relief who never took it,
 *  so the claim instant is part of the key. A handover names the relief. */
export async function pushForRequestEscalated(
  db: Database,
  request: VenueRequest,
  recipientUserIds: readonly string[],
  deps: PushDeps = {},
): Promise<readonly PushSendRecord[]> {
  const claimedAt = request.escalatedAt === null ? "unclaimed" : String(Date.parse(request.escalatedAt));
  const body = request.state === "handed-over"
    ? `${request.ownerName ?? "A colleague"} handed this to ${request.handoverToName ?? "a colleague"}, who has not taken it yet, ${roomWords(request)}.`
    : `Nobody has this, ${roomWords(request)}.`;
  return sendPush(db, {
    venueId: request.venueId,
    userIds: recipientUserIds,
    event: "request.escalated",
    title: `Still waiting: ${summariseRequest({ kind: request.kind, quantity: request.quantity, roomName: request.roomName })}`,
    body,
    url: DAY_BOARD_PATH,
    tag: `request:${request.id}`,
    idempotencyKeyBase: `push:request.escalated:${request.id}:${claimedAt}`,
  }, deps);
}

export interface ReplyContext {
  readonly requestId: string;
  readonly messageId: string;
  readonly authorUserId: string | null;
  readonly authorName: string;
  readonly body: string;
}

/** A reply on a request's thread tells the person who raised it, when
 *  someone else wrote. The author is never told of their own words. */
export async function pushForReply(
  db: Database,
  reply: ReplyContext,
  deps: PushDeps = {},
): Promise<readonly PushSendRecord[]> {
  const [request] = await db
    .select({ venueId: requests.venueId, requestedByUserId: requests.requestedByUserId, eventId: requests.eventId })
    .from(requests)
    .where(eq(requests.id, reply.requestId))
    .limit(1);
  if (request === undefined || request.requestedByUserId === null || request.requestedByUserId === reply.authorUserId) return [];
  return sendPush(db, {
    venueId: request.venueId,
    userIds: [request.requestedByUserId],
    event: "request.replied",
    title: `${reply.authorName} replied`,
    body: reply.body.length > 140 ? `${reply.body.slice(0, 139)}…` : reply.body,
    url: request.eventId === null ? DAY_BOARD_PATH : `/events/${request.eventId}`,
    tag: `request:${reply.requestId}:reply`,
    idempotencyKeyBase: `push:request.replied:${reply.messageId}`,
    // The words of a reply are the floor's own; a wall display in a corridor
    // never shows them (D11), whoever is signed in on it.
    skipDeviceKinds: ["wall"],
  }, deps);
}

/** A message that has just committed (never a replay) on a request's thread
 *  tells the person who raised the request. Every door a message comes in by
 *  calls this: the REST routes and the socket's command path. */
export function tellOfMessage(
  db: Database,
  thread: { readonly requestId: string | null },
  message: { readonly id: string; readonly authorUserId: string | null; readonly authorName: string; readonly body: string },
  logger: FastifyBaseLogger | undefined,
): void {
  if (thread.requestId === null) return;
  tell(pushForReply(db, {
    requestId: thread.requestId,
    messageId: message.id,
    authorUserId: message.authorUserId,
    authorName: message.authorName,
    body: message.body,
  }, { logger }), logger, "request.replied");
}

/** Fire-and-forget at a call site: a push never fails what caused it. */
export function tell(work: Promise<unknown>, logger: FastifyBaseLogger | undefined, what: string): void {
  void work.catch((error: unknown) => {
    logger?.warn({ err: error, what }, "push.trigger_failed");
  });
}

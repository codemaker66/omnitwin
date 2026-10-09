import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  isClientSideRole,
  isOfficeRole,
  threadAudienceAdmits,
  type ConversationSnapshot,
  type CreateThread,
  type MarkReceipt,
  type Message,
  type MessageListQuery,
  type MessageReceipt,
  type SendMessage,
  type Thread,
  type ThreadAudience,
  type ThreadListQuery,
} from "@omnitwin/types";
import {
  bookings,
  configurations,
  eventConfigurationLinks,
  events,
  messageReceipts,
  messages,
  threads,
  users,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Conversations — the core (goal 19 S1; D4, D6, D11).
//
// Everything that decides anything lives here; the route files parse, call
// and shape a reply. The guarantees:
//
//   THE AUDIENCE IS FIXED AT CREATION and checked on every read and write by
//   threadAudienceAdmits, the one arbiter the hub's replay and the client
//   share. No function here writes the audience column after the insert.
//
//   A CLIENT IS ADMITTED BY THE LINK, NEVER BY THE ROLE. clientHoldsEventLink
//   is read against the rows on every call (client-event-schedule's rule: a
//   configuration they own, linked to the event). Revoking the link closes
//   the client's reads and writes the same instant because nothing caches it.
//
//   THE UNIQUE INDEX IS THE IDEMPOTENCY GUARD. A send carries ON CONFLICT DO
//   NOTHING against messages(thread_id, idempotency_key) and a losing writer
//   reads the winner's row back. Opening a thread is the same shape against
//   threads_one_per_subject: the slot's conversation exists once.
//
//   RECEIPTS ARE FACTS. "Delivered" is written when the recipient's screen
//   fetched the message, "read" and "acknowledged" when that screen said so.
//   Nobody's tick is ever assumed.
//
// Nothing here writes a booking, a layout or stock.
// ---------------------------------------------------------------------------

export type ConversationActor = Pick<JwtUser, "id" | "name" | "role" | "venueId" | "platformRole">;

export interface ConversationDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

type ThreadRow = typeof threads.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
/** The surface both a Database and a transaction expose. */
type Conn = Pick<Database, "select" | "insert" | "update">;

const CLIENT_LINK_TYPES = ["source_configuration", "variant_configuration", "approved_snapshot_source"] as const;
const SYSTEM_AUTHOR_NAME = "Venviewer";
const SYSTEM_AUTHOR_ROLE = "system";
/** How many messages a client's poll may carry at once. */
const SNAPSHOT_LIMIT = 200;

function deny(status: number, code: string, error: string): ConversationDeny {
  return { ok: false, status, code, error };
}

const FORBIDDEN = deny(403, "FORBIDDEN", "This conversation is not yours to read.");
const THREAD_NOT_FOUND = deny(404, "NOT_FOUND", "That conversation no longer exists.");
const MESSAGE_NOT_FOUND = deny(404, "NOT_FOUND", "That message no longer exists.");

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function serializeThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    venueId: row.venueId,
    audience: row.audience,
    subject: row.subject,
    bookingId: row.bookingId,
    eventId: row.eventId,
    requestId: row.requestId,
    subjectUserId: row.subjectUserId,
    title: row.title,
    createdByUserId: row.createdByUserId,
    messageCount: row.messageCount,
    lastMessageAt: iso(row.lastMessageAt),
    lastCursor: row.lastCursor,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeMessage(row: MessageRow, receipts: readonly MessageReceipt[]): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    cursor: row.cursor,
    kind: row.kind,
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    authorRole: row.authorRole,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    receipts: [...receipts],
  };
}

// ---------------------------------------------------------------------------
// The link, and who is admitted
// ---------------------------------------------------------------------------

/**
 * Whether this person holds a live link to the event: a configuration they
 * own, linked to it, not a public preview, on an event that still exists.
 * The same rows client-event-schedule reads; read every time, cached never.
 */
export async function clientHoldsEventLink(conn: Conn, userId: string, eventId: string): Promise<boolean> {
  const [link] = await conn
    .select({ id: eventConfigurationLinks.id })
    .from(eventConfigurationLinks)
    .innerJoin(configurations, eq(configurations.id, eventConfigurationLinks.configurationId))
    .innerJoin(events, eq(events.id, eventConfigurationLinks.eventId))
    .where(and(
      eq(eventConfigurationLinks.eventId, eventId),
      eq(configurations.userId, userId),
      eq(configurations.isPublicPreview, false),
      inArray(eventConfigurationLinks.linkType, [...CLIENT_LINK_TYPES]),
      isNull(events.deletedAt),
    ))
    .limit(1);
  return link !== undefined;
}

/** The audience decision for one thread, with the link proved for the
 *  client's side. Platform administrators pass, as everywhere. */
async function admits(conn: Conn, actor: ConversationActor, thread: ThreadRow): Promise<boolean> {
  if (isPlatformAdmin(actor)) return true;
  const holdsEventLink = isClientSideRole(actor.role) && thread.eventId !== null
    ? await clientHoldsEventLink(conn, actor.id, thread.eventId)
    : false;
  return threadAudienceAdmits(actor, thread, { holdsEventLink });
}

async function loadThread(conn: Conn, threadId: string): Promise<ThreadRow | null> {
  const [row] = await conn.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Opening a thread
// ---------------------------------------------------------------------------

export interface OpenThreadOk {
  readonly ok: true;
  /** False when the thread already existed: the slot's conversation is one. */
  readonly created: boolean;
  readonly thread: Thread;
}

interface ThreadSeed {
  readonly venueId: string;
  readonly audience: ThreadAudience;
  readonly subject: ThreadRow["subject"];
  readonly bookingId: string | null;
  readonly eventId: string | null;
  readonly requestId: string | null;
  readonly title: string | null;
  readonly createdByUserId: string | null;
}

/** Insert-or-read against threads_one_per_subject: the index decides. */
async function getOrCreateThread(conn: Conn, seed: ThreadSeed): Promise<{ created: boolean; row: ThreadRow }> {
  const inserted = await conn
    .insert(threads)
    .values({
      venueId: seed.venueId,
      audience: seed.audience,
      subject: seed.subject,
      bookingId: seed.bookingId,
      eventId: seed.eventId,
      requestId: seed.requestId,
      subjectUserId: null,
      title: seed.title,
      createdByUserId: seed.createdByUserId,
    })
    .onConflictDoNothing()
    .returning();
  const fresh = inserted[0];
  if (fresh !== undefined) return { created: true, row: fresh };

  const ref = seed.subject === "booking"
    ? eq(threads.bookingId, seed.bookingId ?? "")
    : seed.subject === "request"
      ? eq(threads.requestId, seed.requestId ?? "")
      : eq(threads.eventId, seed.eventId ?? "");
  const [existing] = await conn
    .select()
    .from(threads)
    .where(and(
      eq(threads.venueId, seed.venueId),
      eq(threads.audience, seed.audience),
      eq(threads.subject, seed.subject),
      ref,
    ))
    .limit(1);
  if (existing === undefined) throw new Error("thread vanished between insert and read");
  return { created: false, row: existing };
}

export async function openThreadCore(
  db: Database,
  actor: ConversationActor,
  venueId: string,
  input: CreateThread,
): Promise<OpenThreadOk | ConversationDeny> {
  if (!canManageVenue(actor, venueId)) return FORBIDDEN;
  if (input.audience === "client-facing" && !isOfficeRole(actor.role) && !isPlatformAdmin(actor)) {
    return deny(403, "FORBIDDEN", "Only the office opens a conversation the client can read.");
  }

  let seed: ThreadSeed;
  if (input.subject === "booking") {
    const [booking] = await db
      .select({ id: bookings.id, eventId: bookings.eventId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.venueId, venueId), isNull(bookings.deletedAt)))
      .limit(1);
    if (booking === undefined) return deny(400, "BOOKING_NOT_IN_VENUE", "That booking is not in this venue's diary.");
    seed = {
      venueId, audience: input.audience, subject: "booking",
      bookingId: booking.id, eventId: booking.eventId, requestId: null,
      title: input.title ?? null, createdByUserId: actor.id,
    };
  } else {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, input.eventId), eq(events.venueId, venueId), isNull(events.deletedAt)))
      .limit(1);
    if (event === undefined) return deny(400, "EVENT_NOT_IN_VENUE", "That event is not one of this venue's events.");
    seed = {
      venueId, audience: input.audience, subject: "event",
      bookingId: null, eventId: event.id, requestId: null,
      title: input.title ?? null, createdByUserId: actor.id,
    };
  }

  const { created, row } = await getOrCreateThread(db, seed);
  return { ok: true, created, thread: serializeThread(row) };
}

/** A request's thread, made inside the request's own transaction with its
 *  first message (the ask). Staff-private when the floor asked, client-facing
 *  when the client did. Returns the thread id for the request row. */
export async function createRequestThread(
  conn: Conn,
  seed: {
    readonly venueId: string;
    readonly audience: ThreadAudience;
    readonly requestId: string;
    readonly bookingId: string | null;
    readonly eventId: string | null;
    readonly title: string;
    readonly author: { readonly userId: string; readonly name: string; readonly role: string };
    readonly body: string;
    readonly idempotencyKey: string;
  },
): Promise<string> {
  const { row } = await getOrCreateThread(conn, {
    venueId: seed.venueId, audience: seed.audience, subject: "request",
    bookingId: seed.bookingId, eventId: seed.eventId, requestId: seed.requestId,
    title: seed.title, createdByUserId: seed.author.userId,
  });
  await appendMessage(conn, row, {
    kind: "request",
    authorUserId: seed.author.userId,
    authorName: seed.author.name,
    authorRole: seed.author.role,
    body: seed.body,
    idempotencyKey: seed.idempotencyKey,
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Reading threads
// ---------------------------------------------------------------------------

export async function listThreadsCore(
  db: Database,
  actor: ConversationActor,
  venueId: string,
  query: ThreadListQuery,
): Promise<readonly Thread[] | ConversationDeny> {
  if (!canManageVenue(actor, venueId)) return FORBIDDEN;
  const rows = await db
    .select()
    .from(threads)
    .where(and(
      eq(threads.venueId, venueId),
      query.bookingId === undefined ? undefined : eq(threads.bookingId, query.bookingId),
      query.eventId === undefined ? undefined : eq(threads.eventId, query.eventId),
      query.audience === undefined ? undefined : eq(threads.audience, query.audience),
    ))
    .orderBy(asc(threads.createdAt))
    .limit(200);
  // Staff hold no event link; the stored audience on each row decides.
  const admitted = rows.filter((row) => isPlatformAdmin(actor) || threadAudienceAdmits(actor, row, { holdsEventLink: false }));
  return admitted.map(serializeThread);
}

export async function readThreadCore(
  db: Database,
  actor: ConversationActor,
  threadId: string,
): Promise<Thread | ConversationDeny> {
  const row = await loadThread(db, threadId);
  if (row === null) return THREAD_NOT_FOUND;
  if (!(await admits(db, actor, row))) return FORBIDDEN;
  return serializeThread(row);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface MessageSeed {
  readonly kind: MessageRow["kind"];
  readonly authorUserId: string | null;
  readonly authorName: string;
  readonly authorRole: string;
  readonly body: string;
  readonly idempotencyKey: string | null;
}

/** Insert one message and move the thread's counters, or read back the
 *  message the same key already made. */
async function appendMessage(
  conn: Conn,
  thread: Pick<ThreadRow, "id" | "venueId">,
  seed: MessageSeed,
): Promise<{ replay: boolean; row: MessageRow }> {
  const now = new Date();
  const inserted = await conn
    .insert(messages)
    .values({
      threadId: thread.id,
      venueId: thread.venueId,
      kind: seed.kind,
      authorUserId: seed.authorUserId,
      authorName: seed.authorName,
      authorRole: seed.authorRole,
      body: seed.body,
      idempotencyKey: seed.idempotencyKey,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const fresh = inserted[0];
  if (fresh !== undefined) {
    await conn
      .update(threads)
      .set({
        messageCount: sql`${threads.messageCount} + 1`,
        lastMessageAt: now,
        lastCursor: fresh.cursor,
        updatedAt: now,
      })
      .where(eq(threads.id, thread.id));
    return { replay: false, row: fresh };
  }
  if (seed.idempotencyKey === null) throw new Error("a system message cannot conflict");
  const [existing] = await conn
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, thread.id), eq(messages.idempotencyKey, seed.idempotencyKey)))
    .limit(1);
  if (existing === undefined) throw new Error("message vanished between insert and read");
  return { replay: true, row: existing };
}

/** A step the system records in a request's thread ("Elaine has this"). */
export async function postSystemMessage(
  conn: Conn,
  threadId: string,
  body: string,
): Promise<Message | null> {
  const thread = await loadThread(conn, threadId);
  if (thread === null) return null;
  const { row } = await appendMessage(conn, thread, {
    kind: "system", authorUserId: null, authorName: SYSTEM_AUTHOR_NAME, authorRole: SYSTEM_AUTHOR_ROLE,
    body, idempotencyKey: null,
  });
  return serializeMessage(row, []);
}

export interface SendMessageOk {
  readonly ok: true;
  readonly replay: boolean;
  readonly thread: Thread;
  readonly message: Message;
}

export async function sendMessageCore(
  db: Database,
  actor: ConversationActor,
  threadId: string,
  input: SendMessage,
): Promise<SendMessageOk | ConversationDeny> {
  const thread = await loadThread(db, threadId);
  if (thread === null) return THREAD_NOT_FOUND;
  if (!(await admits(db, actor, thread))) return FORBIDDEN;

  const sent = await db.transaction((tx) => appendMessage(tx, thread, {
    kind: "text", authorUserId: actor.id, authorName: actor.name, authorRole: actor.role,
    body: input.body, idempotencyKey: input.idempotencyKey,
  }));
  const after = await loadThread(db, threadId);
  const receipts = sent.replay ? (await receiptsFor(db, [sent.row.id])).get(sent.row.id) ?? [] : [];
  return {
    ok: true,
    replay: sent.replay,
    thread: serializeThread(after ?? thread),
    message: serializeMessage(sent.row, receipts),
  };
}

/** The receipts of these messages, named: what the author is shown. */
async function receiptsFor(conn: Conn, messageIds: readonly string[]): Promise<ReadonlyMap<string, readonly MessageReceipt[]>> {
  const map = new Map<string, MessageReceipt[]>();
  if (messageIds.length === 0) return map;
  const rows = await conn
    .select({ receipt: messageReceipts, name: users.name })
    .from(messageReceipts)
    .innerJoin(users, eq(users.id, messageReceipts.recipientUserId))
    .where(inArray(messageReceipts.messageId, [...messageIds]));
  for (const { receipt, name } of rows) {
    const list = map.get(receipt.messageId) ?? [];
    list.push({
      messageId: receipt.messageId,
      recipientUserId: receipt.recipientUserId,
      recipientName: name,
      deliveredAt: receipt.deliveredAt.toISOString(),
      readAt: iso(receipt.readAt),
      acknowledgedAt: iso(receipt.acknowledgedAt),
    });
    map.set(receipt.messageId, list);
  }
  return map;
}

/** The fact of delivery: this person's screen now has these messages. */
async function recordDelivered(conn: Conn, actor: ConversationActor, rows: readonly MessageRow[]): Promise<void> {
  const received = rows.filter((row) => row.authorUserId !== actor.id);
  if (received.length === 0) return;
  await conn
    .insert(messageReceipts)
    .values(received.map((row) => ({ messageId: row.id, recipientUserId: actor.id })))
    .onConflictDoNothing();
}

async function presentMessages(conn: Conn, actor: ConversationActor, rows: readonly MessageRow[]): Promise<readonly Message[]> {
  await recordDelivered(conn, actor, rows);
  const own = rows.filter((row) => row.authorUserId === actor.id).map((row) => row.id);
  const receipts = await receiptsFor(conn, own);
  return rows.map((row) => serializeMessage(row, receipts.get(row.id) ?? []));
}

export interface MessagePageOk {
  readonly ok: true;
  readonly thread: Thread;
  readonly messages: readonly Message[];
  /** The newest cursor on the page, or the `after` asked for. */
  readonly cursor: number;
}

export async function listMessagesCore(
  db: Database,
  actor: ConversationActor,
  threadId: string,
  query: MessageListQuery,
): Promise<MessagePageOk | ConversationDeny> {
  const thread = await loadThread(db, threadId);
  if (thread === null) return THREAD_NOT_FOUND;
  if (!(await admits(db, actor, thread))) return FORBIDDEN;

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.threadId, threadId), gt(messages.cursor, query.after)))
    .orderBy(asc(messages.cursor))
    .limit(query.limit);
  const page = await presentMessages(db, actor, rows);
  const last = rows[rows.length - 1];
  return { ok: true, thread: serializeThread(thread), messages: page, cursor: last?.cursor ?? query.after };
}

export async function markReceiptCore(
  db: Database,
  actor: ConversationActor,
  messageId: string,
  input: MarkReceipt,
): Promise<{ ok: true; receipt: MessageReceipt } | ConversationDeny> {
  const [found] = await db
    .select({ message: messages, thread: threads })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (found === undefined) return MESSAGE_NOT_FOUND;
  if (!(await admits(db, actor, found.thread))) return FORBIDDEN;
  if (found.message.authorUserId === actor.id) {
    return deny(409, "OWN_MESSAGE", "You wrote this; there is nothing to mark.");
  }

  const now = new Date();
  const [row] = await db
    .insert(messageReceipts)
    .values({
      messageId,
      recipientUserId: actor.id,
      deliveredAt: now,
      readAt: now,
      acknowledgedAt: input.mark === "acknowledged" ? now : null,
    })
    .onConflictDoUpdate({
      target: [messageReceipts.messageId, messageReceipts.recipientUserId],
      // A tick, once given, stays at its first instant.
      set: {
        readAt: sql`COALESCE(${messageReceipts.readAt}, ${now})`,
        acknowledgedAt: input.mark === "acknowledged"
          ? sql`COALESCE(${messageReceipts.acknowledgedAt}, ${now})`
          : messageReceipts.acknowledgedAt,
      },
    })
    .returning();
  if (row === undefined) return MESSAGE_NOT_FOUND;
  return {
    ok: true,
    receipt: {
      messageId: row.messageId,
      recipientUserId: row.recipientUserId,
      recipientName: actor.name,
      deliveredAt: row.deliveredAt.toISOString(),
      readAt: iso(row.readAt),
      acknowledgedAt: iso(row.acknowledgedAt),
    },
  };
}

// ---------------------------------------------------------------------------
// The client's side: one event, its client-facing threads, from a cursor
// ---------------------------------------------------------------------------

async function clientEvent(
  db: Database,
  actor: ConversationActor,
  eventId: string,
): Promise<{ venueId: string } | ConversationDeny> {
  const [event] = await db
    .select({ id: events.id, venueId: events.venueId })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (event === undefined) return deny(404, "NOT_FOUND", "That event no longer exists.");
  if (isPlatformAdmin(actor) || (isOfficeRole(actor.role) && actor.venueId === event.venueId)) return { venueId: event.venueId };
  if (isClientSideRole(actor.role) && await clientHoldsEventLink(db, actor.id, eventId)) return { venueId: event.venueId };
  return FORBIDDEN;
}

export async function clientConversationSnapshot(
  db: Database,
  actor: ConversationActor,
  eventId: string,
  after: number,
): Promise<ConversationSnapshot | ConversationDeny> {
  const event = await clientEvent(db, actor, eventId);
  if ("ok" in event) return event;

  const threadRows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.venueId, event.venueId), eq(threads.eventId, eventId), eq(threads.audience, "client-facing")))
    .orderBy(asc(threads.createdAt))
    .limit(100);
  const ids = threadRows.map((row) => row.id);
  const rows = ids.length === 0
    ? []
    : await db
      .select()
      .from(messages)
      .where(and(inArray(messages.threadId, ids), gt(messages.cursor, after)))
      .orderBy(asc(messages.cursor))
      .limit(SNAPSHOT_LIMIT);
  const page = await presentMessages(db, actor, rows);
  const last = rows[rows.length - 1];
  return {
    eventId,
    threads: threadRows.map(serializeThread),
    messages: [...page],
    cursor: last?.cursor ?? after,
    serverNowMs: Date.now(),
  };
}

/** The client writes into the event's own client-facing thread, which is
 *  opened on first use. Staff may use the same door for the same thread. */
export async function sendClientMessageCore(
  db: Database,
  actor: ConversationActor,
  eventId: string,
  input: SendMessage,
): Promise<SendMessageOk | ConversationDeny> {
  const event = await clientEvent(db, actor, eventId);
  if ("ok" in event) return event;
  const { row } = await getOrCreateThread(db, {
    venueId: event.venueId, audience: "client-facing", subject: "event",
    bookingId: null, eventId, requestId: null, title: null, createdByUserId: actor.id,
  });
  return sendMessageCore(db, actor, row.id, input);
}

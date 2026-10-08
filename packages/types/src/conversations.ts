import { z } from "zod";
import {
  CreateVenueRequestSchema,
  RequestOutcomeSchema,
  STAFF_AUDIENCE_ROLES,
} from "./requests.js";
import type { PlatformRole } from "./user.js";

// ---------------------------------------------------------------------------
// Conversations — threads, messages and receipts (goal 19 S1; D4, D6).
//
// A thread is a place to talk about one thing: a booking (the slot), an
// event, a request, or later a person. Its AUDIENCE is fixed when it is made
// and nothing in the product widens it: staff-private is the floor; client-
// facing is the office and the event's client, and a hallkeeper only inside
// the request that opened it. Broadening means a new thread.
//
// A message is words. The send schema is strict so a body cannot smuggle a
// time, a quantity, a price, a layout or an audience: nothing said in a
// thread changes a booking, a layout or stock. Anything consequential becomes
// a decision the office approves.
//
// Every message carries a `cursor`, one monotonic sequence per venue, so a
// screen that reconnects asks "everything after N" and replays exactly what
// it missed before refetching the snapshot. Receipts are facts, never
// fabricated: delivered when the recipient's screen fetched it, read when
// their screen said so, acknowledged when they pressed.
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();
const IsoInstant = z.string().datetime({ offset: true });

export const THREAD_AUDIENCES = ["staff-private", "client-facing"] as const;
export const ThreadAudienceSchema = z.enum(THREAD_AUDIENCES);
export type ThreadAudience = z.infer<typeof ThreadAudienceSchema>;

export const THREAD_SUBJECTS = ["booking", "event", "request", "person"] as const;
export const ThreadSubjectSchema = z.enum(THREAD_SUBJECTS);
export type ThreadSubject = z.infer<typeof ThreadSubjectSchema>;

export const MESSAGE_KINDS = ["text", "request", "system"] as const;
export const MessageKindSchema = z.enum(MESSAGE_KINDS);
export type MessageKind = z.infer<typeof MessageKindSchema>;

/** The one size limit, shared by the schema, the CHECK and the composer. */
export const MESSAGE_BODY_MAX = 2000;

export const ThreadSchema = z.object({
  id: UUID,
  venueId: UUID,
  audience: ThreadAudienceSchema,
  subject: ThreadSubjectSchema,
  bookingId: UUID.nullable(),
  eventId: UUID.nullable(),
  requestId: UUID.nullable(),
  subjectUserId: UUID.nullable(),
  title: z.string().max(160).nullable(),
  createdByUserId: UUID.nullable(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: IsoInstant.nullable(),
  /** The cursor of the newest message, 0 for an empty thread. */
  lastCursor: z.number().int().nonnegative(),
  createdAt: IsoInstant,
});
export type Thread = z.infer<typeof ThreadSchema>;

export const MessageReceiptSchema = z.object({
  messageId: UUID,
  recipientUserId: UUID,
  recipientName: z.string().max(160),
  deliveredAt: IsoInstant.nullable(),
  readAt: IsoInstant.nullable(),
  acknowledgedAt: IsoInstant.nullable(),
});
export type MessageReceipt = z.infer<typeof MessageReceiptSchema>;

export const MessageSchema = z.object({
  id: UUID,
  threadId: UUID,
  cursor: z.number().int().positive(),
  kind: MessageKindSchema,
  /** Null for a message the system wrote (a request step). */
  authorUserId: UUID.nullable(),
  authorName: z.string().min(1).max(160),
  authorRole: z.string().min(1).max(30),
  body: z.string().min(1).max(MESSAGE_BODY_MAX),
  createdAt: IsoInstant,
  /** The author sees who has it, who has read it and who pressed: honest
   *  ticks from the receipts table. Everybody else gets an empty list. */
  receipts: z.array(MessageReceiptSchema),
});
export type Message = z.infer<typeof MessageSchema>;

// --- What may be sent ------------------------------------------------------

const MessageBody = z.string().trim().min(1).max(MESSAGE_BODY_MAX);

/** Words, and the key that makes a resend the same message. Strict: a body
 *  carrying a time, a quantity, a price, a layout or an audience is a 400. */
export const SendMessageSchema = z.object({
  body: MessageBody,
  idempotencyKey: UUID,
}).strict();
export type SendMessage = z.infer<typeof SendMessageSchema>;

const ThreadTitle = z.string().trim().min(1).max(160);

/** Opening a thread by hand: on a booking or on an event. A request's thread
 *  is made with the request; a person thread is a later slice. */
export const CreateThreadSchema = z.discriminatedUnion("subject", [
  z.object({
    audience: ThreadAudienceSchema,
    subject: z.literal("booking"),
    bookingId: UUID,
    title: ThreadTitle.optional(),
  }).strict(),
  z.object({
    audience: ThreadAudienceSchema,
    subject: z.literal("event"),
    eventId: UUID,
    title: ThreadTitle.optional(),
  }).strict(),
]);
export type CreateThread = z.infer<typeof CreateThreadSchema>;

export const MarkReceiptSchema = z.object({
  mark: z.enum(["read", "acknowledged"]),
}).strict();
export type MarkReceipt = z.infer<typeof MarkReceiptSchema>;

export const MessageListQuerySchema = z.object({
  /** Everything after this cursor; 0 is the beginning. */
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

export const ThreadListQuerySchema = z.object({
  bookingId: UUID.optional(),
  eventId: UUID.optional(),
  audience: ThreadAudienceSchema.optional(),
}).strict();
export type ThreadListQuery = z.infer<typeof ThreadListQuerySchema>;

/** What a client's page polls: the event's client-facing threads, every
 *  message after the cursor it last saw, and the server's clock (D9). */
export const ConversationSnapshotSchema = z.object({
  eventId: UUID,
  threads: z.array(ThreadSchema),
  messages: z.array(MessageSchema),
  /** The newest cursor in `messages`, or the `after` asked for. */
  cursor: z.number().int().nonnegative(),
  serverNowMs: z.number().int().positive(),
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

// --- Who an audience admits ------------------------------------------------

/** The office: the people who may open a client-facing thread by hand and
 *  read every one at their venue. Hallkeepers are not the office. */
const OFFICE_ROLES: readonly string[] = ["admin", "manager", "staff"];
const CLIENT_SIDE_ROLES: readonly string[] = ["client", "planner"];

export interface AudienceActor {
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: PlatformRole;
}

export interface AudienceThread {
  readonly venueId: string;
  readonly audience: ThreadAudience;
  readonly subject: ThreadSubject;
}

export interface AudienceContext {
  /** True when the actor holds a live link to the thread's event, proved
   *  against the row by the caller. A revoked link is false the same
   *  instant, because nothing caches it. */
  readonly holdsEventLink: boolean;
}

/**
 * The single arbiter of who may read or write a thread. Called on every
 * read, write, subscribe and replay, by the API, the hub and the client.
 */
export function threadAudienceAdmits(
  actor: AudienceActor,
  thread: AudienceThread,
  context: AudienceContext,
): boolean {
  if (actor.platformRole === "admin") return true;
  const atVenue = actor.venueId === thread.venueId;
  if (thread.audience === "staff-private") {
    return atVenue && STAFF_AUDIENCE_ROLES.some((role) => role === actor.role);
  }
  // client-facing
  if (CLIENT_SIDE_ROLES.includes(actor.role)) return context.holdsEventLink;
  if (!atVenue) return false;
  if (OFFICE_ROLES.includes(actor.role)) return true;
  return actor.role === "hallkeeper" && thread.subject === "request";
}

export function isClientSideRole(role: string): boolean {
  return CLIENT_SIDE_ROLES.includes(role);
}

export function isOfficeRole(role: string): boolean {
  return OFFICE_ROLES.includes(role);
}

// --- The command envelope (S2 carries it; the kinds are fixed here) --------

const NoPayload = z.object({}).strict();

export const ConversationCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message.send"), commandId: UUID, threadId: UUID, payload: SendMessageSchema }),
  z.object({ kind: z.literal("request.create"), commandId: UUID, payload: CreateVenueRequestSchema }),
  z.object({ kind: z.literal("request.acknowledge"), commandId: UUID, requestId: UUID, payload: NoPayload }),
  z.object({ kind: z.literal("request.accept"), commandId: UUID, requestId: UUID, payload: NoPayload }),
  z.object({ kind: z.literal("request.underway"), commandId: UUID, requestId: UUID, payload: NoPayload }),
  z.object({
    kind: z.literal("request.handover"),
    commandId: UUID,
    requestId: UUID,
    payload: z.object({ toUserId: UUID }).strict(),
  }),
  z.object({
    kind: z.literal("request.resolve"),
    commandId: UUID,
    requestId: UUID,
    payload: z.object({ outcome: RequestOutcomeSchema, note: z.string().trim().min(1).max(500).nullish() }).strict(),
  }),
  z.object({
    kind: z.literal("request.reopen"),
    commandId: UUID,
    requestId: UUID,
    payload: z.object({ note: z.string().trim().min(1).max(500).nullish() }).strict(),
  }),
]);
export type ConversationCommand = z.infer<typeof ConversationCommandSchema>;
export type ConversationCommandKind = ConversationCommand["kind"];

import { z } from "zod";
import {
  ConversationSnapshotSchema,
  MessageReceiptSchema,
  MessageSchema,
  ThreadSchema,
  VenueRequestSchema,
  type ClientCreateRequest,
  type ConversationSnapshot,
  type CreateThread,
  type MarkReceipt,
  type Message,
  type MessageReceipt,
  type SendMessage,
  type Thread,
  type ThreadAudience,
  type VenueRequest,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// The conversation client (goal 19 S2).
//
// Every response is validated against the shared schema, so a server that
// drifts is a loud error rather than a drawer quietly rendering nothing. A
// send carries its key in the body AND the house Idempotency-Key header: the
// body is the record, the header is the convention, and a retry is the same
// message either way.
// ---------------------------------------------------------------------------

const ThreadListSchema = z.array(ThreadSchema);
const RequestListSchema = z.array(VenueRequestSchema);

/** One page of a thread, as GET /threads/:id/messages answers it. */
export const MessagePageSchema = z.object({
  thread: ThreadSchema,
  messages: z.array(MessageSchema),
  cursor: z.number().int().nonnegative(),
  serverNowMs: z.number().int().positive(),
});
export type MessagePage = z.infer<typeof MessagePageSchema>;

export async function openThread(venueId: string, input: CreateThread): Promise<Thread> {
  return api.post(`/venues/${encodeURIComponent(venueId)}/threads`, input, false, ThreadSchema);
}

export async function listThreads(
  venueId: string,
  query: { readonly bookingId?: string; readonly eventId?: string; readonly audience?: ThreadAudience } = {},
  signal?: AbortSignal,
): Promise<readonly Thread[]> {
  const params = new URLSearchParams();
  if (query.bookingId !== undefined) params.set("bookingId", query.bookingId);
  if (query.eventId !== undefined) params.set("eventId", query.eventId);
  if (query.audience !== undefined) params.set("audience", query.audience);
  const search = params.toString();
  return api.get(
    `/venues/${encodeURIComponent(venueId)}/threads${search === "" ? "" : `?${search}`}`,
    ThreadListSchema,
    signal,
  );
}

export async function listMessages(
  threadId: string,
  options: { readonly after?: number; readonly limit?: number; readonly signal?: AbortSignal } = {},
): Promise<MessagePage> {
  const params = new URLSearchParams({
    after: String(options.after ?? 0),
    limit: String(options.limit ?? 50),
  });
  return api.get(`/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`, MessagePageSchema, options.signal);
}

export async function sendMessage(threadId: string, input: SendMessage): Promise<Message> {
  return api.post(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    input,
    false,
    MessageSchema,
    { idempotencyKey: input.idempotencyKey },
  );
}

export async function markReceipt(messageId: string, input: MarkReceipt): Promise<MessageReceipt> {
  return api.post(`/messages/${encodeURIComponent(messageId)}/receipt`, input, false, MessageReceiptSchema);
}

/** The client's poll: the event's client-facing threads and every message
 *  after the cursor the page last saw, with the server's clock. */
export async function getEventConversation(
  eventId: string,
  after = 0,
  signal?: AbortSignal,
): Promise<ConversationSnapshot> {
  return api.get(
    `/events/${encodeURIComponent(eventId)}/conversation?after=${String(after)}`,
    ConversationSnapshotSchema,
    signal,
  );
}

export async function sendEventMessage(eventId: string, input: SendMessage): Promise<Message> {
  return api.post(
    `/events/${encodeURIComponent(eventId)}/conversation/messages`,
    input,
    false,
    MessageSchema,
    { idempotencyKey: input.idempotencyKey },
  );
}

export async function createEventRequest(eventId: string, input: ClientCreateRequest): Promise<VenueRequest> {
  return api.post(
    `/events/${encodeURIComponent(eventId)}/requests`,
    input,
    false,
    VenueRequestSchema,
    { idempotencyKey: input.idempotencyKey },
  );
}

export async function listEventRequests(eventId: string, signal?: AbortSignal): Promise<readonly VenueRequest[]> {
  return api.get(`/events/${encodeURIComponent(eventId)}/requests`, RequestListSchema, signal);
}

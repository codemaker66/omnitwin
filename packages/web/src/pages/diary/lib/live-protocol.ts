import { z } from "zod";
import {
  ConversationCaughtUpSchema,
  ConversationCommandAckSchema,
  ConversationEventSchema,
  DiaryCommandAckSchema,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Diary live protocol (T-497; goal 19 S2) — the client half of /ws/diary.
// Pure parsing and reconnect arithmetic; the socket lifecycle lives in
// useDiaryLive. Every server frame may carry `serverNowMs`, the one clock
// (D9); the hook feeds it to lib/clock-offset.ts.
// ---------------------------------------------------------------------------

/** Optional on the frames this client has always known, so an older server
 *  still parses; required on the conversation frames, which are new. */
const ServerClock = z.number().int().positive().optional();

export const LivePresenceUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.string(),
});
export type LivePresenceUser = z.infer<typeof LivePresenceUserSchema>;

const HelloMessage = z.object({
  type: z.literal("hello"),
  venueId: z.string(),
  presence: z.array(LivePresenceUserSchema),
  serverNowMs: ServerClock,
});

const PresenceMessage = z.object({
  type: z.literal("presence"),
  users: z.array(LivePresenceUserSchema),
  serverNowMs: ServerClock,
});

const DiaryEventMessage = z.object({
  type: z.literal("diary.event"),
  kind: z.string(),
  bookingId: z.string(),
  actorUserId: z.string().nullable(),
  at: z.string(),
  serverNowMs: ServerClock,
});

const PingMessage = z.object({ type: z.literal("ping"), serverNowMs: ServerClock });
const PongMessage = z.object({ type: z.literal("pong"), serverNowMs: ServerClock });
const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const LiveServerMessageSchema = z.discriminatedUnion("type", [
  HelloMessage,
  PresenceMessage,
  DiaryEventMessage,
  // T-537: command outcomes ride the same stream — the SHARED ack schema
  // (booking embedded and validated here, once).
  DiaryCommandAckSchema,
  // Goal 19 S2: the conversation half of the same socket.
  ConversationEventSchema,
  ConversationCaughtUpSchema,
  ConversationCommandAckSchema,
  PingMessage,
  PongMessage,
  ErrorMessage,
]);
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;

/** Parse a raw socket frame; unknown or malformed messages become null and
 *  are ignored (a newer server may speak a superset). */
export function parseLiveMessage(raw: unknown): LiveServerMessage | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = LiveServerMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** How long a command waits for its ack before the api layer falls back to
 *  REST (T-537). Generous versus the p99 mutation, small versus a human. */
export const COMMAND_ACK_TIMEOUT_MS = 10_000;

/** Exponential backoff (Canon §15: client exponential-backoff reconnect). */
export function nextBackoffMs(attempt: number): number {
  const clampedAttempt = Math.max(0, Math.min(attempt, 30));
  return Math.min(RECONNECT_BASE_MS * 2 ** clampedAttempt, RECONNECT_MAX_MS);
}

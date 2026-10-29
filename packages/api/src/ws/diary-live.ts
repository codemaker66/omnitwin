import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ConversationCommandSchema,
  DiaryCommandSchema,
  threadAudienceAdmits,
  type PlatformRole,
  type ThreadAudience,
  type ThreadSubject,
} from "@omnitwin/types";
import { messages, threads, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { emit, subscribe } from "../observability/event-bus.js";
import {
  executeDiaryCommand,
  realDiaryCommandDeps,
} from "../services/diary-commands.js";
import { executeConversationCommand, type ConversationChanged } from "../services/conversation-commands.js";
import type { MutationActor } from "../services/booking-mutations.js";
import { announcePromotionNotices } from "../services/hold-promotion.js";
import { EscalationScheduler } from "../services/escalation-scheduler.js";
import { installEscalationScheduler } from "../services/escalation-wake.js";
import { pushForRequestEscalated, tell } from "../services/push-triggers.js";
import { AuthMessage, resolveWsUser } from "./auto-save.js";
import {
  currentAuthority,
  readCurrentSocketUser,
  readCurrentSocketUsers,
  type CurrentSocketUser,
} from "./socket-identity.js";

// ---------------------------------------------------------------------------
// The Diary live channel (T-497; Canon §9/§15; goal 19 S2).
//
// /ws/diary carries EVENTS, PRESENCE, and — since T-537 — the Canon §9
// COMMAND channel: "Mutations = commands validated in a Neon transaction
// (exclusion constraint = final arbiter) → commit → broadcast." A command
// frame dispatches through the SAME mutation cores as the REST surface
// (services/booking-mutations.ts — one validation dialect, two transports),
// records its outcome in the diary_commands ledger inside the mutation's
// transaction (exactly-once via the client-minted commandId), acks the
// sender, and emits `diary.changed` on the house event bus AFTER commit —
// the same fan-out path REST mutations use, so every venue connection sees
// one consistent stream.
//
// Goal 19 S2 adds the conversation half on the same socket and the same
// ledger: `conversation.command` (a send, a request, a request step) and
// `conversation.event` (a message landed; the frame says where and carries
// its cursor, never the body). Every hello and every frame carries
// `serverNowMs`, the one clock (D9). A connection that re-authenticates with
// `afterCursor` is replayed every event it missed that its audience admits,
// then told `conversation.caughtUp`, and only then refetches its snapshot.
//
// Protocol:
//   client → { type: "auth", token, presence?, afterCursor? }   first message,
//            auto-save style; presence: false marks a connection that only
//            listens (the requests and notifications channel), which hears
//            what its role may hear but is nobody "here" on the Diary;
//            afterCursor asks for a replay of the conversation stream
//   client → { type: "ping" }                 keepalive (any message touches)
//   client → { type: "diary.command", command }          T-537 mutation envelope
//   client → { type: "conversation.command", command }   goal 19 S2 envelope
//   server → { type: "hello", venueId, presence, serverNowMs }
//   server → { type: "presence", users }      on every join/leave
//   server → { type: "diary.event", ... }     after a committed mutation
//   server → { type: "diary.ack", ... }       the command's outcome envelope
//   server → { type: "conversation.event", ... }   a message landed (cursor)
//   server → { type: "conversation.caughtUp", cursor }   replay finished
//   server → { type: "conversation.ack", ... }     the command's outcome
//   server → { type: "ping" } / { type: "pong" }
//   every server frame also carries serverNowMs
//
// Presence is ADVISORY display only — never a correctness mechanism
// (Canon §9). The registry is single-process state; a Redis backplane is the
// precondition for a second replica (Canon §15), restated in the plan.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 20_000; // Canon §15: app-level keepalive ~20s
const STALE_AFTER_MS = 65_000; // three missed beats and the connection is gone
/** The longest one connection lives (release audit events-diary-5). Its
 *  person's role, venue and Clerk link are read again on every command and
 *  every heartbeat; the cap also bounds a Clerk session ended without any
 *  change to the database, by making the screen sign in again. Long enough
 *  that a wall display reconnects about twice a day, not mid-shift: every
 *  reconnect briefly drops the person from presence and fails any command
 *  then in flight. */
export const MAX_CONNECTION_AGE_MS = 12 * 60 * 60 * 1000;
/** How often the request escalation sweep looks for an unanswered "now".
 *  Short against the shortest sensible venue window, cheap because the query
 *  is a partial index on exactly those rows. */
/** How much of the conversation stream a reconnecting screen is replayed
 *  before it is told to refetch its snapshot instead. */
const REPLAY_LIMIT = 500;

/** Read roles: who may watch the live diary. Everyone who works the venue's
 *  day or its pipeline; caterers are event-scoped and never see the
 *  venue-wide diary. Writing is a narrower set, enforced by the REST surface
 *  and the booking state machine, not here. */
export const DIARY_READ_ROLES: ReadonlySet<string> = new Set(["staff", "admin", "hallkeeper", "manager", "sales"]);

export interface DiaryLiveSocket {
  send(text: string): void;
  close(): void;
}

export interface DiaryLiveUser {
  readonly userId: string;
  readonly name: string;
  readonly role: string;
  /** Absent means "none": a venue person, not a Venviewer operator. */
  readonly platformRole?: PlatformRole;
}

/** What kind of screen a connection is (goal 19 S7): the wall display in
 *  the corridor, a phone in a pocket, or a desk. Absent from an older client. */
export type DiaryLiveDevice = "wall" | "phone" | "desk";
export const DIARY_LIVE_DEVICES = ["wall", "phone", "desk"] as const;

export interface DiaryLiveConnection {
  readonly socket: DiaryLiveSocket;
  readonly user: DiaryLiveUser;
  /** The Clerk account it signed in with (null for a test-mode token): kept
   *  here, never on `user`, which is sent in presence frames. */
  readonly clerkId: string | null;
  readonly connectedAtMs: number;
  /** False for a connection that only listens: every floor page keeps one
   *  open for requests and the unread count. It hears the frames its role
   *  may hear, but its person is not on the Diary, so it is not presence. */
  readonly present: boolean;
  readonly device: DiaryLiveDevice | null;
  lastSeenMs: number;
}

export interface DiaryLiveJoinOptions {
  /** Defaults to true: the Diary and the Day Board are where people are. */
  readonly present?: boolean;
  readonly device?: DiaryLiveDevice;
  readonly clerkId?: string | null;
}

/** A person in the presence list, with every kind of screen they are on.
 *  One person on the wall and on a phone is one entry with two devices. */
export interface DiaryLivePresence extends DiaryLiveUser {
  readonly devices: readonly DiaryLiveDevice[];
}

/**
 * Per-venue connection registry. Pure of timers — callers pass the clock —
 * so every behaviour is unit-testable without sockets or fake timers. The
 * clock given to the constructor stamps every frame with `serverNowMs`.
 */
export class DiaryLiveHub {
  readonly #byVenue = new Map<string, Set<DiaryLiveConnection>>();
  readonly #clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.#clock = clock;
  }

  join(
    venueId: string,
    socket: DiaryLiveSocket,
    user: DiaryLiveUser,
    nowMs: number,
    options: DiaryLiveJoinOptions = {},
  ): DiaryLiveConnection {
    const connection: DiaryLiveConnection = {
      socket,
      user,
      clerkId: options.clerkId ?? null,
      connectedAtMs: nowMs,
      present: options.present ?? true,
      device: options.device ?? null,
      lastSeenMs: nowMs,
    };
    const set = this.#byVenue.get(venueId) ?? new Set<DiaryLiveConnection>();
    set.add(connection);
    this.#byVenue.set(venueId, set);
    // A listener changes nobody's presence, so the room is not told.
    if (connection.present) {
      this.broadcast(venueId, { type: "presence", users: this.presenceFor(venueId) });
    }
    return connection;
  }

  leave(venueId: string, connection: DiaryLiveConnection): void {
    const set = this.#byVenue.get(venueId);
    if (set === undefined) return;
    if (!set.delete(connection)) return;
    if (set.size === 0) this.#byVenue.delete(venueId);
    if (connection.present) {
      this.broadcast(venueId, { type: "presence", users: this.presenceFor(venueId) });
    }
  }

  touch(connection: DiaryLiveConnection, nowMs: number): void {
    connection.lastSeenMs = nowMs;
  }

  connectionCount(venueId: string): number {
    return this.#byVenue.get(venueId)?.size ?? 0;
  }

  /** Presence deduped by user — two tabs are still one person — and only
   *  from connections that are somewhere people are: a page that merely
   *  listens for requests does not put its person "here" (T-619's rule that
   *  the count names only colleagues who are there). */
  presenceFor(venueId: string): readonly DiaryLivePresence[] {
    const byUser = new Map<string, { user: DiaryLiveUser; devices: Set<DiaryLiveDevice> }>();
    for (const connection of this.#byVenue.get(venueId) ?? []) {
      if (!connection.present) continue;
      const entry = byUser.get(connection.user.userId) ?? { user: connection.user, devices: new Set<DiaryLiveDevice>() };
      if (connection.device !== null) entry.devices.add(connection.device);
      byUser.set(connection.user.userId, entry);
    }
    return [...byUser.values()].map(({ user, devices }) => ({
      ...user,
      devices: DIARY_LIVE_DEVICES.filter((device) => devices.has(device)),
    }));
  }

  /** Send to every connection of the venue; a broken socket never breaks
   *  the loop (it will be reaped by the stale sweep). */
  broadcast(venueId: string, payload: Record<string, unknown>): void {
    this.#send(this.#byVenue.get(venueId) ?? [], payload);
  }

  /** Send to the venue's connections whose ROLE is in `roles` — a request's
   *  own audience, fixed when it was made. A colleague whose role is not in
   *  that list never receives the frame, so the live channel cannot widen an
   *  audience the database deliberately narrowed. */
  broadcastToRoles(
    venueId: string,
    roles: readonly string[],
    payload: Record<string, unknown>,
  ): void {
    const allowed = new Set(roles);
    const targets = [...this.#byVenue.get(venueId) ?? []].filter(
      (connection) => allowed.has(connection.user.role),
    );
    this.#send(targets, payload);
  }

  /** Send to named people in the venue (an escalation reaches the venue's
   *  administrators by name, not by role list). */
  broadcastToUsers(
    venueId: string,
    userIds: readonly string[],
    payload: Record<string, unknown>,
  ): void {
    if (userIds.length === 0) return;
    const allowed = new Set(userIds);
    const targets = [...this.#byVenue.get(venueId) ?? []].filter(
      (connection) => allowed.has(connection.user.userId),
    );
    this.#send(targets, payload);
  }

  /** Send to the venue's connections a predicate admits — a thread's
   *  audience, decided per connection by the one arbiter. Returns how many
   *  were sent to, for the landed-within-a-second measure. */
  broadcastWhere(
    venueId: string,
    admits: (user: DiaryLiveUser) => boolean,
    payload: Record<string, unknown>,
  ): number {
    const targets = [...this.#byVenue.get(venueId) ?? []].filter((connection) => admits(connection.user));
    this.#send(targets, payload);
    return targets.length;
  }

  #send(connections: Iterable<DiaryLiveConnection>, payload: Record<string, unknown>): void {
    // D9: every frame carries the server's clock.
    const text = JSON.stringify({ ...payload, serverNowMs: this.#clock() });
    for (const connection of connections) {
      try {
        connection.socket.send(text);
      } catch {
        // Ignore — close/leave handles the funeral.
      }
    }
  }

  /** Close and remove connections silent for longer than the threshold,
   *  and any older than `maxAgeMs` however busy (the screen signs in again). */
  sweepStale(nowMs: number, staleAfterMs: number, maxAgeMs: number = Number.POSITIVE_INFINITY): number {
    let swept = 0;
    for (const [venueId, set] of this.#byVenue) {
      for (const connection of [...set]) {
        if (nowMs - connection.lastSeenMs <= staleAfterMs && nowMs - connection.connectedAtMs <= maxAgeMs) continue;
        try {
          connection.socket.close();
        } catch {
          // Already gone.
        }
        this.leave(venueId, connection);
        swept += 1;
      }
    }
    return swept;
  }

  /** Every connection with its venue, for the heartbeat's re-check. */
  entries(): readonly { readonly venueId: string; readonly connection: DiaryLiveConnection }[] {
    return [...this.#byVenue].flatMap(([venueId, set]) => [...set].map((connection) => ({ venueId, connection })));
  }

  /** Tell a connection it may no longer watch, close it and remove it. */
  revoke(venueId: string, connection: DiaryLiveConnection): void {
    if (this.#byVenue.get(venueId)?.has(connection) !== true) return;
    this.#send([connection], { type: "error", code: "FORBIDDEN", message: "Your access to this venue's diary has changed" });
    try {
      connection.socket.close();
    } catch {
      // Already gone.
    }
    this.leave(venueId, connection);
  }

  /** Heartbeat ping to every connection (clients answer with any message). */
  pingAll(): void {
    for (const venueId of this.#byVenue.keys()) {
      this.broadcast(venueId, { type: "ping" });
    }
  }
}

/** The house auth frame, plus whether the connection is presence and the
 *  conversation cursor to replay from. Absent presence means present, which
 *  is what the Diary and the Day Board send; the requests channel sends
 *  false. Absent afterCursor means "no replay; tell me where the stream is". */
export const DiaryAuthMessage = AuthMessage.extend({
  presence: z.boolean().optional(),
  afterCursor: z.number().int().nonnegative().optional(),
  /** Which kind of screen this is (S7), so the office can read "Wall
   *  display live · Elaine's phone live". Absent from an older client. */
  device: z.enum(DIARY_LIVE_DEVICES).optional(),
});

const IncomingLiveMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("diary.command"), command: DiaryCommandSchema }),
  z.object({ type: z.literal("conversation.command"), command: ConversationCommandSchema }),
]);

/** The audience actor a connection is, for the one arbiter: its venue is the
 *  venue it joined, its platform role what the token said. */
function audienceActorOf(user: DiaryLiveUser, venueId: string): { role: string; venueId: string; platformRole: PlatformRole } {
  return { role: user.role, venueId, platformRole: user.platformRole ?? "none" };
}

/**
 * Ship Friday slice 10. Requests ride the same venue channel the Diary uses —
 * the same door and the same authentication — on a connection of their own
 * that says presence: false, so a person listening for requests on any floor
 * page is not counted as being on the Diary. A request frame goes
 * only to the venue's connections whose role is in the request's OWN stored
 * audience, and an inbox frame to that audience or to the people it names;
 * the live channel can never widen what the database narrowed. A frame says
 * something changed, never what: the client refetches, and the server's
 * answer is the truth. Older clients ignore an unknown frame type by design.
 * Returns the unsubscribe for the server's close hook.
 */
export function subscribeRequestFrames(hub: DiaryLiveHub): () => void {
  const unsubscribeRequests = subscribe("request.changed", {
    name: "diary-live-requests",
    handle: (payload) => {
      hub.broadcastToRoles(payload.venueId, payload.audienceRoles, {
        type: "request.event",
        venueId: payload.venueId,
        kind: payload.kind,
        requestId: payload.requestId,
        bookingId: payload.bookingId,
        roomId: payload.roomId,
        state: payload.state,
        at: payload.at,
      });
    },
  });

  const unsubscribeNotifications = subscribe("notification.created", {
    name: "diary-live-notifications",
    handle: (payload) => {
      const frame = {
        type: "notification.event",
        venueId: payload.venueId,
        notificationIds: payload.notificationIds,
        title: payload.title,
        severity: payload.severity,
        at: payload.at,
      };
      hub.broadcastToRoles(payload.venueId, payload.audienceRoles, frame);
      hub.broadcastToUsers(payload.venueId, payload.recipientUserIds, frame);
    },
  });

  // Goal 19 S5: a fact about the room reaches everyone who reads the board;
  // the frame says what landed and where, never a time for the booking.
  const unsubscribeObservations = subscribe("observation.changed", {
    name: "diary-live-observations",
    handle: (payload) => {
      hub.broadcastToRoles(payload.venueId, [...DIARY_READ_ROLES], {
        type: "observation.event",
        venueId: payload.venueId,
        bookingId: payload.bookingId,
        spaceId: payload.spaceId,
        kind: payload.kind,
        observationId: payload.observationId,
        observedAt: payload.observedAt,
        at: payload.at,
      });
    },
  });

  return () => {
    unsubscribeRequests();
    unsubscribeNotifications();
    unsubscribeObservations();
  };
}

interface ConversationFrameSource {
  readonly venueId: string;
  readonly threadId: string;
  readonly audience: ThreadAudience;
  readonly subject: ThreadSubject;
  readonly bookingId: string | null;
  readonly eventId: string | null;
  readonly requestId: string | null;
  readonly messageId: string;
  readonly cursor: number;
  readonly actorUserId: string | null;
  readonly at: string;
}

function conversationFrame(source: ConversationFrameSource): Record<string, unknown> {
  return {
    type: "conversation.event",
    venueId: source.venueId,
    kind: "message.sent",
    threadId: source.threadId,
    audience: source.audience,
    subject: source.subject,
    bookingId: source.bookingId,
    eventId: source.eventId,
    requestId: source.requestId,
    messageId: source.messageId,
    cursor: source.cursor,
    actorUserId: source.actorUserId,
    at: source.at,
  };
}

/**
 * Goal 19 S2. A message landed: the frame reaches only the venue's
 * connections the thread's stored audience admits, decided per connection by
 * threadAudienceAdmits — the same arbiter the API applies on every read. A
 * hallkeeper hears a client's request thread and never a client's booking
 * thread; sales hears nothing. The frame says where and carries the cursor,
 * never the words. The landed-within-a-second measure is logged per frame:
 * how many screens, how long after the commit.
 */
export function subscribeConversationFrames(hub: DiaryLiveHub, log?: FastifyBaseLogger): () => void {
  return subscribe("conversation.changed", {
    name: "diary-live-conversations",
    handle: (payload) => {
      const thread = { venueId: payload.venueId, audience: payload.audience, subject: payload.subject };
      const screens = hub.broadcastWhere(
        payload.venueId,
        (user) => threadAudienceAdmits(audienceActorOf(user, payload.venueId), thread, { holdsEventLink: false }),
        conversationFrame(payload),
      );
      log?.info(
        {
          event: "conversation.fanout",
          venueId: payload.venueId,
          threadId: payload.threadId,
          cursor: payload.cursor,
          screens,
          latencyMs: Math.max(0, Date.now() - Date.parse(payload.at)),
        },
        "conversation.fanout",
      );
    },
  });
}

/** The replay a reconnecting screen asks for: every message after its
 *  cursor that its audience admits, oldest first, then caughtUp with the
 *  newest cursor the venue has. Without a cursor, only caughtUp, so the
 *  screen learns where the stream is and refetches its snapshot. */
async function replayConversation(
  db: Database,
  venueId: string,
  user: DiaryLiveUser,
  afterCursor: number | undefined,
  send: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const actor = audienceActorOf(user, venueId);
  let cursor = afterCursor ?? 0;
  if (afterCursor !== undefined) {
    const rows = await db
      .select({ message: messages, thread: threads })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(and(eq(messages.venueId, venueId), gt(messages.cursor, afterCursor)))
      .orderBy(asc(messages.cursor))
      .limit(REPLAY_LIMIT);
    for (const { message, thread } of rows) {
      cursor = message.cursor;
      if (!threadAudienceAdmits(actor, thread, { holdsEventLink: false })) continue;
      send(conversationFrame({
        venueId,
        threadId: thread.id,
        audience: thread.audience,
        subject: thread.subject,
        bookingId: thread.bookingId,
        eventId: thread.eventId,
        requestId: thread.requestId,
        messageId: message.id,
        cursor: message.cursor,
        actorUserId: message.authorUserId,
        at: message.createdAt.toISOString(),
      }));
    }
  }
  const [top] = await db
    .select({ cursor: sql<string | number | null>`COALESCE(MAX(${messages.cursor}), 0)` })
    .from(messages)
    .where(eq(messages.venueId, venueId));
  const newest = Number(top?.cursor ?? 0);
  send({ type: "conversation.caughtUp", cursor: Math.max(cursor, Number.isFinite(newest) ? newest : 0) });
}

/** Commit → broadcast, on the same bus paths REST uses. */
function announceConversationChange(log: FastifyBaseLogger, actorUserId: string, changed: ConversationChanged): void {
  const at = new Date().toISOString();
  if (changed.kind === "message.sent") {
    emit(log, "conversation.changed", {
      venueId: changed.thread.venueId,
      kind: "message.sent",
      threadId: changed.thread.id,
      audience: changed.thread.audience,
      subject: changed.thread.subject,
      bookingId: changed.thread.bookingId,
      eventId: changed.thread.eventId,
      requestId: changed.thread.requestId,
      messageId: changed.message.id,
      cursor: changed.message.cursor,
      actorUserId,
      at: changed.message.createdAt,
    });
    return;
  }
  if (changed.kind === "observation.recorded") {
    emit(log, "observation.changed", {
      venueId: changed.observation.venueId,
      bookingId: changed.observation.bookingId,
      spaceId: changed.observation.spaceId,
      kind: changed.observation.kind,
      observationId: changed.observation.id,
      observedAt: changed.observation.observedAt,
      actorUserId,
      at: changed.observation.recordedAt,
    });
    return;
  }
  emit(log, "request.changed", {
    venueId: changed.request.venueId,
    kind: changed.kind,
    requestId: changed.request.id,
    bookingId: changed.request.bookingId,
    roomId: changed.request.roomId,
    state: changed.request.state,
    audienceRoles: changed.request.audienceRoles,
    actorUserId,
    at,
  });
  if (changed.notificationIds.length === 0) return;
  emit(log, "notification.created", {
    venueId: changed.request.venueId,
    audienceRoles: changed.request.audienceRoles,
    recipientUserIds: [],
    notificationIds: changed.notificationIds,
    title: changed.request.roomName === null
      ? "A request was made"
      : `A request was made in ${changed.request.roomName}`,
    severity: changed.request.urgency === "now" ? "urgent" : "attention",
    at,
  });
}

/**
 * Whether the person behind a Diary connection may still act there as they
 * connected (release audit events-diary-5): the Clerk account they signed in
 * with is still theirs, their role still reads the diary, and their role,
 * venue and platform role are the ones they connected with. Any change ends
 * the connection; the screen reconnects and signs in with what holds now.
 */
export function diaryAuthorityHolds(
  current: CurrentSocketUser | null,
  venueId: string,
  user: Pick<DiaryLiveUser, "role" | "platformRole">,
): boolean {
  if (current === null) return false;
  if (!DIARY_READ_ROLES.has(current.role) && current.platformRole !== "admin") return false;
  return current.venueId === venueId && current.role === user.role && current.platformRole === (user.platformRole ?? "none");
}

/**
 * The heartbeat's re-check: every connection against the users table, in one
 * query. Only the connections read are judged, so one that joins meanwhile is
 * never revoked for being absent from the read. A database error rejects (the
 * caller logs and retries next beat) rather than revoking everyone on a blip.
 */
export async function recheckDiaryConnections(db: Pick<Database, "select">, hub: DiaryLiveHub): Promise<number> {
  const entries = hub.entries();
  if (entries.length === 0) return 0;
  const rows = await readCurrentSocketUsers(db, entries.map(({ connection }) => connection.user.userId));
  let revoked = 0;
  for (const { venueId, connection } of entries) {
    const current = currentAuthority(rows.get(connection.user.userId), { userId: connection.user.userId, clerkId: connection.clerkId });
    if (diaryAuthorityHolds(current, venueId, connection.user)) continue;
    hub.revoke(venueId, connection);
    revoked += 1;
  }
  return revoked;
}

/** The person behind one connection, read again before a command. */
async function connectionAuthorityHolds(db: Database, venueId: string, connection: DiaryLiveConnection): Promise<boolean> {
  const current = await readCurrentSocketUser(db, { userId: connection.user.userId, clerkId: connection.clerkId }, { lock: false });
  return diaryAuthorityHolds(current, venueId, connection.user);
}

const ACCESS_CHANGED = "Your access to this venue's diary has changed. Sign in again.";

export async function registerDiaryLive(server: FastifyInstance, db: Database): Promise<void> {
  const hub = new DiaryLiveHub();

  const unsubscribe = subscribe("diary.changed", {
    name: "diary-live-hub",
    handle: (payload) => {
      hub.broadcast(payload.venueId, { type: "diary.event", ...payload });
    },
  });

  const unsubscribeRequestFrames = subscribeRequestFrames(hub);
  const unsubscribeConversationFrames = subscribeConversationFrames(hub, server.log);

  let rechecking = false;
  const heartbeat = setInterval(() => {
    hub.pingAll();
    hub.sweepStale(Date.now(), STALE_AFTER_MS, MAX_CONNECTION_AGE_MS);
    // An offboarded, moved or demoted person's open screen stops hearing the
    // venue within one beat (events-diary-5).
    if (rechecking) return;
    rechecking = true;
    void recheckDiaryConnections(db, hub)
      .catch((err: unknown) => { server.log.warn({ err }, "diary-live access re-check failed; retried next beat"); })
      .finally(() => { rechecking = false; });
  }, HEARTBEAT_INTERVAL_MS);
  // Never hold the process open on its own (house convention — see the
  // shutdown grace timer in index.ts).
  heartbeat.unref();

  // The escalation sweep, run by a scheduler that wakes only when something
  // is due (S7; the 18 October outage: a 15-second poll kept Neon awake).
  // The claim is a conditional UPDATE (escalated_at IS NULL) and the email
  // carries its own idempotency key, so two replicas sweeping together still
  // escalate once between them; the endpoint stays for an external cron.
  const escalationScheduler = new EscalationScheduler({
    db,
    logger: server.log,
    onEscalated: (escalated) => {
        for (const item of escalated) {
          const at = new Date().toISOString();
          emit(server.log, "request.changed", {
            venueId: item.request.venueId,
            kind: "request.escalated",
            requestId: item.request.id,
            bookingId: item.request.bookingId,
            roomId: item.request.roomId,
            state: item.request.state,
            audienceRoles: item.request.audienceRoles,
            actorUserId: null,
            at,
          });
          // The inbox copy too, addressed to the administrators BY NAME — the
          // same announcement the escalation endpoint makes. Without it this
          // path writes the notification row but the number on their nav sits
          // still until they navigate, and the two paths disagree about what
          // "escalated" feels like.
          tell(pushForRequestEscalated(db, item.request, item.recipientUserIds, { logger: server.log }), server.log, "request.escalated");
          if (item.notificationIds.length > 0) {
            emit(server.log, "notification.created", {
              venueId: item.request.venueId,
              audienceRoles: [],
              recipientUserIds: item.recipientUserIds,
              notificationIds: item.notificationIds,
              title: item.request.roomName === null
                ? "A request is still waiting"
                : `A request in ${item.request.roomName} is still waiting`,
              severity: "urgent",
              at,
            });
          }
        }
    },
  });
  escalationScheduler.start();
  installEscalationScheduler(escalationScheduler);

  server.addHook("onClose", () => {
    clearInterval(heartbeat);
    escalationScheduler.stop();
    installEscalationScheduler(null);
    unsubscribe();
    unsubscribeRequestFrames();
    unsubscribeConversationFrames();
  });

  server.get("/ws/diary", { websocket: true }, (socket, _request) => {
    let connection: DiaryLiveConnection | null = null;
    let venueId: string | null = null;
    let actor: MutationActor | null = null;
    let authenticating = false;
    let closed = false;

    function send(payload: Record<string, unknown>): void {
      // D9: every frame carries the server's clock, direct sends included.
      if (socket.readyState === 1) socket.send(JSON.stringify({ ...payload, serverNowMs: Date.now() }));
    }

    socket.on("message", (raw: Buffer | string) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        send({ type: "error", code: "VALIDATION_ERROR", message: "Messages must be JSON" });
        return;
      }

      if (connection === null) {
        // A frame while authentication is already in flight must not abort
        // the valid attempt (review P2) — drop it quietly.
        if (authenticating) return;
        const auth = DiaryAuthMessage.safeParse(data);
        if (!auth.success) {
          send({ type: "error", code: "UNAUTHORIZED", message: "Authenticate first" });
          socket.close();
          return;
        }
        authenticating = true;
        void (async () => {
          // Any failure in here must end in a closed socket, never a
          // stranded connection or an unhandled rejection (review P1).
          try {
            const user = await resolveWsUser(db, auth.data.token);
            if (
              user === null ||
              user.userVenueId === null ||
              (!DIARY_READ_ROLES.has(user.userRole) && user.platformRole !== "admin")
            ) {
              send({ type: "error", code: "FORBIDDEN", message: "The diary is a venue surface" });
              socket.close();
              return;
            }
            const [profile] = await db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, user.userId))
              .limit(1);
            // The socket may have died while we were authenticating —
            // joining it would parade a phantom presence (review P2).
            if (closed || socket.readyState !== 1) return;
            venueId = user.userVenueId;
            actor = {
              id: user.userId,
              role: user.userRole,
              venueId: user.userVenueId,
              platformRole: user.platformRole,
            };
            const liveUser: DiaryLiveUser = {
              userId: user.userId,
              name: profile?.name ?? "Colleague",
              role: user.userRole,
              platformRole: user.platformRole,
            };
            // The device (S7) rides along when the client names one; an
            // older client's frame is read exactly as before.
            const presenceOptions: DiaryLiveJoinOptions = auth.data.device === undefined
              ? { present: auth.data.presence !== false }
              : { present: auth.data.presence !== false, device: auth.data.device };
            // The Clerk account it signed in with, for every later re-check.
            const joinOptions: DiaryLiveJoinOptions = { ...presenceOptions, clerkId: user.clerkId ?? null };
            connection = hub.join(venueId, socket, liveUser, Date.now(), joinOptions);
            server.log.info(
              { event: "diary-live.connections", venueId, connections: hub.connectionCount(venueId) },
              "diary-live.joined",
            );
            send({ type: "hello", venueId, presence: hub.presenceFor(venueId) });
            // Replay first, snapshot second: the screen refetches only once
            // caughtUp says the stream is complete.
            await replayConversation(db, venueId, liveUser, auth.data.afterCursor, send);
          } catch {
            send({
              type: "error",
              code: "AUTH_FAILED",
              message: "Could not authenticate the connection — reconnect and try again",
            });
            socket.close();
          }
        })().finally(() => {
          authenticating = false;
        });
        return;
      }

      hub.touch(connection, Date.now());
      const message = IncomingLiveMessage.safeParse(data);
      if (!message.success) {
        send({ type: "error", code: "VALIDATION_ERROR", message: "Unknown message type" });
        return;
      }
      if (message.data.type === "ping") {
        send({ type: "pong" });
        return;
      }

      const commandActor = actor;
      const commandVenueId = venueId;
      const commandConnection = connection;
      const commandUser = connection.user;
      if (commandActor === null || commandVenueId === null) return;

      if (message.data.type === "conversation.command") {
        // Goal 19 S2: the same ledger, the same guarded async shape as the
        // Diary's commands — every path ends in a sent ack.
        const { command } = message.data;
        void (async () => {
          try {
            // The person as the database holds them now (events-diary-5).
            if (!await connectionAuthorityHolds(db, commandVenueId, commandConnection)) {
              send({ type: "conversation.ack", commandId: command.commandId, outcome: "rejected", replay: false,
                status: 403, code: "FORBIDDEN", error: ACCESS_CHANGED });
              hub.revoke(commandVenueId, commandConnection);
              return;
            }
            const execution = await executeConversationCommand(
              db,
              { ...commandActor, name: commandUser.name },
              commandVenueId,
              command,
              undefined,
              server.log,
            );
            send(execution.ack);
            if (execution.changed !== null) {
              announceConversationChange(server.log, commandActor.id, execution.changed);
            }
          } catch {
            send({
              type: "conversation.ack",
              commandId: command.commandId,
              outcome: "rejected",
              replay: false,
              status: 500,
              code: "COMMAND_FAILED",
              error: "The message could not be sent — try again",
            });
          }
        })();
        return;
      }

      // T-537 command envelope. All async work fully guarded (the Slice-3
      // ws law): every path ends in a sent ack — executeDiaryCommand never
      // throws by contract, and the outer catch covers the send itself.
      const { command } = message.data;
      void (async () => {
        try {
          // The person as the database holds them now (events-diary-5).
          if (!await connectionAuthorityHolds(db, commandVenueId, commandConnection)) {
            send({ type: "diary.ack", commandId: command.commandId, outcome: "rejected", replay: false,
              status: 403, code: "FORBIDDEN", error: ACCESS_CHANGED });
            hub.revoke(commandVenueId, commandConnection);
            return;
          }
          const execution = await executeDiaryCommand(
            db,
            commandActor,
            commandVenueId,
            command,
            realDiaryCommandDeps(db),
          );
          send(execution.ack);
          // Commit → broadcast, on the SAME bus path REST mutations use, so
          // every venue connection (sender included) sees one event stream:
          // the booking's venue's, which a platform admin's is not always.
          if (execution.changed !== null) {
            emit(server.log, "diary.changed", {
              venueId: execution.changed.venueId,
              kind: execution.changed.kind,
              bookingId: execution.changed.bookingId,
              actorUserId: commandActor.id,
              at: new Date().toISOString(),
            });
            announcePromotionNotices(server.log, execution.changed.notices);
          }
        } catch {
          send({
            type: "diary.ack",
            commandId: command.commandId,
            outcome: "rejected",
            replay: false,
            status: 500,
            code: "COMMAND_FAILED",
            error: "The command could not be completed — reload the diary and try again",
          });
        }
      })();
    });

    socket.on("close", () => {
      closed = true;
      if (connection !== null && venueId !== null) {
        hub.leave(venueId, connection);
        server.log.info(
          { event: "diary-live.connections", venueId, connections: hub.connectionCount(venueId) },
          "diary-live.left",
        );
      }
    });
  });
}

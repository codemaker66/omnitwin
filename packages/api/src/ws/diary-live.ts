import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DiaryCommandSchema } from "@omnitwin/types";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { emit, subscribe } from "../observability/event-bus.js";
import {
  executeDiaryCommand,
  realDiaryCommandDeps,
} from "../services/diary-commands.js";
import type { MutationActor } from "../services/booking-mutations.js";
import { runRequestEscalationPass } from "../services/requests.js";
import { AuthMessage, resolveWsUser } from "./auto-save.js";

// ---------------------------------------------------------------------------
// The Diary live channel (T-497; Canon §9/§15).
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
// Protocol:
//   client → { type: "auth", token }          first message, auto-save style
//   client → { type: "ping" }                 keepalive (any message touches)
//   client → { type: "diary.command", command }   T-537 mutation envelope
//   server → { type: "hello", venueId, presence }
//   server → { type: "presence", users }      on every join/leave
//   server → { type: "diary.event", ... }     after a committed mutation
//   server → { type: "diary.ack", ... }       the command's outcome envelope
//   server → { type: "ping" } / { type: "pong" }
//
// Presence is ADVISORY display only — never a correctness mechanism
// (Canon §9). The registry is single-process state; a Redis backplane is the
// precondition for a second replica (Canon §15), restated in the plan.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 20_000; // Canon §15: app-level keepalive ~20s
const STALE_AFTER_MS = 65_000; // three missed beats and the connection is gone
/** How often the request escalation sweep looks for an unanswered "now".
 *  Short against the shortest sensible venue window, cheap because the query
 *  is a partial index on exactly those rows. */
const ESCALATION_SWEEP_INTERVAL_MS = 15_000;

/** Read roles: the whole ops floor may watch the diary; only staff/admin
 *  write (enforced by the REST surface, not here). */
const DIARY_READ_ROLES: ReadonlySet<string> = new Set(["staff", "admin", "hallkeeper"]);

export interface DiaryLiveSocket {
  send(text: string): void;
  close(): void;
}

export interface DiaryLiveUser {
  readonly userId: string;
  readonly name: string;
  readonly role: string;
}

export interface DiaryLiveConnection {
  readonly socket: DiaryLiveSocket;
  readonly user: DiaryLiveUser;
  lastSeenMs: number;
}

/**
 * Per-venue connection registry. Pure of timers — callers pass the clock —
 * so every behaviour is unit-testable without sockets or fake timers.
 */
export class DiaryLiveHub {
  readonly #byVenue = new Map<string, Set<DiaryLiveConnection>>();

  join(
    venueId: string,
    socket: DiaryLiveSocket,
    user: DiaryLiveUser,
    nowMs: number,
  ): DiaryLiveConnection {
    const connection: DiaryLiveConnection = { socket, user, lastSeenMs: nowMs };
    const set = this.#byVenue.get(venueId) ?? new Set<DiaryLiveConnection>();
    set.add(connection);
    this.#byVenue.set(venueId, set);
    this.broadcast(venueId, { type: "presence", users: this.presenceFor(venueId) });
    return connection;
  }

  leave(venueId: string, connection: DiaryLiveConnection): void {
    const set = this.#byVenue.get(venueId);
    if (set === undefined) return;
    if (!set.delete(connection)) return;
    if (set.size === 0) this.#byVenue.delete(venueId);
    this.broadcast(venueId, { type: "presence", users: this.presenceFor(venueId) });
  }

  touch(connection: DiaryLiveConnection, nowMs: number): void {
    connection.lastSeenMs = nowMs;
  }

  connectionCount(venueId: string): number {
    return this.#byVenue.get(venueId)?.size ?? 0;
  }

  /** Presence deduped by user — two tabs are still one person. */
  presenceFor(venueId: string): readonly DiaryLiveUser[] {
    const byUser = new Map<string, DiaryLiveUser>();
    for (const connection of this.#byVenue.get(venueId) ?? []) {
      byUser.set(connection.user.userId, connection.user);
    }
    return [...byUser.values()];
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

  #send(connections: Iterable<DiaryLiveConnection>, payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload);
    for (const connection of connections) {
      try {
        connection.socket.send(text);
      } catch {
        // Ignore — close/leave handles the funeral.
      }
    }
  }

  /** Close and remove connections silent for longer than the threshold. */
  sweepStale(nowMs: number, staleAfterMs: number): number {
    let swept = 0;
    for (const [venueId, set] of this.#byVenue) {
      for (const connection of [...set]) {
        if (nowMs - connection.lastSeenMs <= staleAfterMs) continue;
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

  /** Heartbeat ping to every connection (clients answer with any message). */
  pingAll(): void {
    for (const venueId of this.#byVenue.keys()) {
      this.broadcast(venueId, { type: "ping" });
    }
  }
}

const IncomingLiveMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("diary.command"), command: DiaryCommandSchema }),
]);

export async function registerDiaryLive(server: FastifyInstance, db: Database): Promise<void> {
  const hub = new DiaryLiveHub();

  const unsubscribe = subscribe("diary.changed", {
    name: "diary-live-hub",
    handle: (payload) => {
      hub.broadcast(payload.venueId, { type: "diary.event", ...payload });
    },
  });

  // Ship Friday slice 10. Requests ride the SAME venue channel the Diary
  // already holds open, so a phone that is watching the day is watching the
  // floor as well — no second connection, no second authentication. The frame
  // goes only to the roles in the request's own audience; a client sees
  // nothing. Older clients ignore an unknown frame type by design.
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

  const heartbeat = setInterval(() => {
    hub.pingAll();
    hub.sweepStale(Date.now(), STALE_AFTER_MS);
  }, HEARTBEAT_INTERVAL_MS);
  // Never hold the process open on its own (house convention — see the
  // shutdown grace timer in index.ts).
  heartbeat.unref();

  // The escalation sweep. A short timer rather than a cron because the claim
  // is a conditional UPDATE (escalated_at IS NULL) and the email carries its
  // own idempotency key: two replicas sweeping together escalate once between
  // them. An external cron can still call the endpoint; it is the same pass.
  let sweeping = false;
  const escalationSweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void runRequestEscalationPass(db, { logger: server.log })
      .then((escalated) => {
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
      })
      .catch((error: unknown) => {
        server.log.error({ err: error }, "request escalation sweep failed");
      })
      .finally(() => {
        sweeping = false;
      });
  }, ESCALATION_SWEEP_INTERVAL_MS);
  escalationSweep.unref();

  server.addHook("onClose", () => {
    clearInterval(heartbeat);
    clearInterval(escalationSweep);
    unsubscribe();
    unsubscribeRequests();
    unsubscribeNotifications();
  });

  server.get("/ws/diary", { websocket: true }, (socket, _request) => {
    let connection: DiaryLiveConnection | null = null;
    let venueId: string | null = null;
    let actor: MutationActor | null = null;
    let authenticating = false;
    let closed = false;

    function send(payload: Record<string, unknown>): void {
      if (socket.readyState === 1) socket.send(JSON.stringify(payload));
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
        const auth = AuthMessage.safeParse(data);
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
            connection = hub.join(
              venueId,
              socket,
              { userId: user.userId, name: profile?.name ?? "Colleague", role: user.userRole },
              Date.now(),
            );
            send({ type: "hello", venueId, presence: hub.presenceFor(venueId) });
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

      // T-537 command envelope. All async work fully guarded (the Slice-3
      // ws law): every path ends in a sent ack — executeDiaryCommand never
      // throws by contract, and the outer catch covers the send itself.
      const { command } = message.data;
      const commandActor = actor;
      const commandVenueId = venueId;
      if (commandActor === null || commandVenueId === null) return;
      void (async () => {
        try {
          const execution = await executeDiaryCommand(
            db,
            commandActor,
            commandVenueId,
            command,
            realDiaryCommandDeps(db),
          );
          send(execution.ack);
          // Commit → broadcast, on the SAME bus path REST mutations use, so
          // every venue connection (sender included) sees one event stream.
          if (execution.changed !== null) {
            emit(server.log, "diary.changed", {
              venueId: commandVenueId,
              kind: execution.changed.kind,
              bookingId: execution.changed.bookingId,
              actorUserId: commandActor.id,
              at: new Date().toISOString(),
            });
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
      }
    });
  });
}

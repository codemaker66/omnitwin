import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { subscribe } from "../observability/event-bus.js";
import { AuthMessage, resolveWsUser } from "./auto-save.js";

// ---------------------------------------------------------------------------
// The Diary live channel (T-497; Canon §9/§15).
//
// /ws/diary carries EVENTS and PRESENCE — the read side of the Canon's
// realtime doctrine. Mutations stay on the REST surface where each one runs
// in a transaction with the exclusion constraint as the final arbiter; every
// successful mutation emits `diary.changed` on the house event bus AFTER its
// commit, and this hub fans the event out to every connection of that venue.
// Migrating the write path onto command envelopes is the explicit remaining
// §9 step (architecture doc §11) — deferred, not forgotten.
//
// Protocol:
//   client → { type: "auth", token }          first message, auto-save style
//   client → { type: "ping" }                 keepalive (any message touches)
//   server → { type: "hello", venueId, presence }
//   server → { type: "presence", users }      on every join/leave
//   server → { type: "diary.event", ... }     after a committed mutation
//   server → { type: "ping" } / { type: "pong" }
//
// Presence is ADVISORY display only — never a correctness mechanism
// (Canon §9). The registry is single-process state; a Redis backplane is the
// precondition for a second replica (Canon §15), restated in the plan.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 20_000; // Canon §15: app-level keepalive ~20s
const STALE_AFTER_MS = 65_000; // three missed beats and the connection is gone

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
    const text = JSON.stringify(payload);
    for (const connection of this.#byVenue.get(venueId) ?? []) {
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
]);

export async function registerDiaryLive(server: FastifyInstance, db: Database): Promise<void> {
  const hub = new DiaryLiveHub();

  const unsubscribe = subscribe("diary.changed", {
    name: "diary-live-hub",
    handle: (payload) => {
      hub.broadcast(payload.venueId, { type: "diary.event", ...payload });
    },
  });

  const heartbeat = setInterval(() => {
    hub.pingAll();
    hub.sweepStale(Date.now(), STALE_AFTER_MS);
  }, HEARTBEAT_INTERVAL_MS);

  server.addHook("onClose", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  server.get("/ws/diary", { websocket: true }, (socket, _request) => {
    let connection: DiaryLiveConnection | null = null;
    let venueId: string | null = null;
    let authenticating = false;

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
        const auth = AuthMessage.safeParse(data);
        if (!auth.success) {
          send({ type: "error", code: "UNAUTHORIZED", message: "Authenticate first" });
          socket.close();
          return;
        }
        if (authenticating) return;
        authenticating = true;
        void (async () => {
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
          venueId = user.userVenueId;
          connection = hub.join(
            venueId,
            socket,
            { userId: user.userId, name: profile?.name ?? "Colleague", role: user.userRole },
            Date.now(),
          );
          send({ type: "hello", venueId, presence: hub.presenceFor(venueId) });
        })().finally(() => {
          authenticating = false;
        });
        return;
      }

      hub.touch(connection, Date.now());
      const message = IncomingLiveMessage.safeParse(data);
      if (message.success && message.data.type === "ping") {
        send({ type: "pong" });
      }
    });

    socket.on("close", () => {
      if (connection !== null && venueId !== null) {
        hub.leave(venueId, connection);
      }
    });
  });
}

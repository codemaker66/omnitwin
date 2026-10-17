import { randomUUID } from "node:crypto";
import {
  LiveClientFrameSchema,
  type LiveOp,
  type LiveParticipant,
  type LiveView,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Layout live hub (live co-editing v1).
//
// The ephemeral half of co-editing: who has a layout open, which room each
// person is viewing, and live ops — the absolute state of an object someone
// just placed, moved or deleted — relayed to everyone in the same layout
// within one frame. Rooms are keyed by configuration id and joined from the
// existing /ws/configurations/:configId socket after its auth frame.
//
// STRUCTURALLY INCAPABLE OF PERSISTING: this module takes no database handle
// and imports nothing from the schema (a test asserts it). Persisting a live
// op would mean changing a signature a reviewer can see. The layout itself
// changes only through the batch save's revision compare-and-swap; the hub
// learns of a commit through `announceCommit` and says so, carrying no
// geometry.
//
// Ordering: each room stamps every relayed frame with the next sequence
// number, and the sender gets its own frame back. With one process and FIFO
// sockets, every participant sees the same total order, so "the highest seq
// on an object is the last write" means the same thing to everyone.
//
// Single-process state, like the Diary hub: a second API replica would split
// a room in half silently. Railway runs one replica; a backplane is the
// precondition for a second.
// ---------------------------------------------------------------------------

export const LAYOUT_LIVE_STALE_AFTER_MS = 65_000;
/** Drag frames arrive at ~20 Hz; a burst above this is dropped, never fatal. */
export const LAYOUT_LIVE_BURST_FRAMES = 40;
export const LAYOUT_LIVE_FRAMES_PER_SECOND = 30;
/** A 300-object drag frame is ~90 KB; anything larger is not a planner. */
export const LAYOUT_LIVE_MAX_FRAME_BYTES = 128 * 1024;

export interface LayoutLiveSocket {
  send(text: string): void;
  close(): void;
}

export interface LayoutLiveUser {
  readonly userId: string;
  /** From the users table — never a name the client reported. */
  readonly name: string;
  readonly role: string;
}

export interface LayoutLiveConnection {
  readonly connectionId: string;
  readonly configId: string;
  readonly socket: LayoutLiveSocket;
  readonly user: LayoutLiveUser;
  readonly joinedAtMs: number;
  view: LiveView | null;
  lastSeenMs: number;
  tokens: number;
  tokensAtMs: number;
}

interface LayoutLiveRoom {
  readonly connections: Set<LayoutLiveConnection>;
  seq: number;
}

export type LayoutLiveFrameOutcome = "relayed" | "view" | "dropped";

export class LayoutLiveHub {
  readonly #rooms = new Map<string, LayoutLiveRoom>();
  readonly #clock: () => number;
  readonly #newId: () => string;

  constructor(clock: () => number = () => Date.now(), newId: () => string = () => randomUUID()) {
    this.#clock = clock;
    this.#newId = newId;
  }

  join(configId: string, socket: LayoutLiveSocket, user: LayoutLiveUser): LayoutLiveConnection {
    const nowMs = this.#clock();
    const connection: LayoutLiveConnection = {
      connectionId: this.#newId(),
      configId,
      socket,
      user,
      joinedAtMs: nowMs,
      view: null,
      lastSeenMs: nowMs,
      tokens: LAYOUT_LIVE_BURST_FRAMES,
      tokensAtMs: nowMs,
    };
    const room = this.#rooms.get(configId) ?? { connections: new Set<LayoutLiveConnection>(), seq: 0 };
    room.connections.add(connection);
    this.#rooms.set(configId, room);
    this.#sendTo([connection], {
      type: "live.hello",
      connectionId: connection.connectionId,
      participants: this.participants(configId),
      seq: room.seq,
    });
    this.#broadcastPresence(configId, connection);
    return connection;
  }

  leave(connection: LayoutLiveConnection): void {
    const room = this.#rooms.get(connection.configId);
    if (room === undefined || !room.connections.delete(connection)) return;
    if (room.connections.size === 0) {
      this.#rooms.delete(connection.configId);
      return;
    }
    this.#broadcastPresence(connection.configId);
  }

  participants(configId: string): LiveParticipant[] {
    return [...this.#rooms.get(configId)?.connections ?? []].map((connection) => ({
      connectionId: connection.connectionId,
      userId: connection.user.userId,
      name: connection.user.name,
      role: connection.user.role,
      view: connection.view,
      joinedAtMs: connection.joinedAtMs,
    }));
  }

  connectionCount(configId: string): number {
    return this.#rooms.get(configId)?.connections.size ?? 0;
  }

  touch(connection: LayoutLiveConnection): void {
    connection.lastSeenMs = this.#clock();
  }

  /**
   * One client frame whose type starts with `live.`. Malformed, over-rate or
   * oversized frames are DROPPED silently: losing a drag frame is invisible
   * (ops are absolute state), and closing an editor's session over one would
   * not be.
   */
  handleClientFrame(connection: LayoutLiveConnection, data: unknown, byteLength: number): LayoutLiveFrameOutcome {
    this.touch(connection);
    if (byteLength > LAYOUT_LIVE_MAX_FRAME_BYTES) return "dropped";
    if (!this.#admit(connection)) return "dropped";
    const parsed = LiveClientFrameSchema.safeParse(data);
    if (!parsed.success) return "dropped";
    const frame = parsed.data;
    switch (frame.type) {
      case "live.view":
        connection.view = frame.view;
        this.#broadcastPresence(connection.configId);
        return "view";
      case "live.ops":
        this.#relayOps(connection, frame.ops);
        return "relayed";
      case "live.saved": {
        const room = this.#rooms.get(connection.configId);
        if (room === undefined) return "dropped";
        room.seq += 1;
        this.#sendTo(room.connections, {
          type: "live.saved",
          seq: room.seq,
          connectionId: connection.connectionId,
          revision: frame.revision,
          ids: frame.ids,
        });
        return "relayed";
      }
    }
  }

  /** A durable commit landed (any writer). Notification only — no geometry. */
  announceCommit(configId: string, revision: number, actorUserId: string | null): number {
    const room = this.#rooms.get(configId);
    if (room === undefined) return 0;
    this.#sendTo(room.connections, { type: "layout.changed", revision, actorUserId });
    return room.connections.size;
  }

  sweepStale(staleAfterMs: number = LAYOUT_LIVE_STALE_AFTER_MS): number {
    const nowMs = this.#clock();
    let swept = 0;
    for (const room of [...this.#rooms.values()]) {
      for (const connection of [...room.connections]) {
        if (nowMs - connection.lastSeenMs <= staleAfterMs) continue;
        try {
          connection.socket.close();
        } catch {
          // Already gone.
        }
        this.leave(connection);
        swept += 1;
      }
    }
    return swept;
  }

  pingAll(): void {
    for (const room of this.#rooms.values()) this.#sendTo(room.connections, { type: "ping" });
  }

  #relayOps(connection: LayoutLiveConnection, ops: readonly LiveOp[]): void {
    const room = this.#rooms.get(connection.configId);
    if (room === undefined) return;
    room.seq += 1;
    this.#sendTo(room.connections, {
      type: "live.ops",
      seq: room.seq,
      connectionId: connection.connectionId,
      userId: connection.user.userId,
      name: connection.user.name,
      ops,
    });
  }

  /** Token bucket per connection: refills continuously, never below zero. */
  #admit(connection: LayoutLiveConnection): boolean {
    const nowMs = this.#clock();
    const elapsedMs = Math.max(0, nowMs - connection.tokensAtMs);
    connection.tokens = Math.min(
      LAYOUT_LIVE_BURST_FRAMES,
      connection.tokens + (elapsedMs * LAYOUT_LIVE_FRAMES_PER_SECOND) / 1000,
    );
    connection.tokensAtMs = nowMs;
    if (connection.tokens < 1) return false;
    connection.tokens -= 1;
    return true;
  }

  #broadcastPresence(configId: string, except?: LayoutLiveConnection): void {
    const room = this.#rooms.get(configId);
    if (room === undefined) return;
    const targets = [...room.connections].filter((connection) => connection !== except);
    this.#sendTo(targets, { type: "live.presence", participants: this.participants(configId) });
  }

  #sendTo(connections: Iterable<LayoutLiveConnection>, payload: Record<string, unknown>): void {
    // Every frame carries the server's clock (the Diary's D9 rule).
    const text = JSON.stringify({ ...payload, serverNowMs: this.#clock() });
    for (const connection of connections) {
      try {
        connection.socket.send(text);
      } catch {
        // A broken socket never breaks the loop; close/sweep handles it.
      }
    }
  }
}

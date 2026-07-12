import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DiaryLiveHub, type DiaryLiveSocket } from "../../ws/diary-live.js";

// ---------------------------------------------------------------------------
// Diary live hub (T-497; Canon §9/§15) — per-venue connection registry:
// presence (deduped by user), venue-scoped event fanout, heartbeat staleness
// sweep. Pure of timers: every method takes the clock as an argument.
// ---------------------------------------------------------------------------

const VENUE_A = "00000000-0000-4000-8000-0000000000a1";
const VENUE_B = "00000000-0000-4000-8000-0000000000b2";

interface FakeSocket extends DiaryLiveSocket {
  readonly sent: string[];
  closed: boolean;
}

function fakeSocket(): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    sent,
    closed: false,
    send(text: string) {
      sent.push(text);
    },
    close() {
      socket.closed = true;
    },
  };
  return socket;
}

function messagesOf(socket: FakeSocket): { type: string }[] {
  return socket.sent.map((raw) => JSON.parse(raw) as { type: string });
}

describe("DiaryLiveHub", () => {
  it("joins a venue, broadcasts presence, and dedupes the same user twice", () => {
    const hub = new DiaryLiveHub();
    const first = fakeSocket();
    const second = fakeSocket();
    hub.join(VENUE_A, first, { userId: "u1", name: "Elaine", role: "hallkeeper" }, 1_000);
    hub.join(VENUE_A, second, { userId: "u1", name: "Elaine", role: "hallkeeper" }, 2_000);

    expect(hub.connectionCount(VENUE_A)).toBe(2);
    expect(hub.presenceFor(VENUE_A)).toEqual([
      { userId: "u1", name: "Elaine", role: "hallkeeper" },
    ]);
    // Both sockets heard the presence broadcast triggered by the second join.
    expect(messagesOf(first).some((message) => message.type === "presence")).toBe(true);
  });

  it("fans events out only to the event's venue", () => {
    const hub = new DiaryLiveHub();
    const inVenue = fakeSocket();
    const otherVenue = fakeSocket();
    hub.join(VENUE_A, inVenue, { userId: "u1", name: "A", role: "staff" }, 1_000);
    hub.join(VENUE_B, otherVenue, { userId: "u2", name: "B", role: "staff" }, 1_000);

    hub.broadcast(VENUE_A, { type: "diary.event", kind: "booking.created" });

    expect(messagesOf(inVenue).some((message) => message.type === "diary.event")).toBe(true);
    expect(messagesOf(otherVenue).some((message) => message.type === "diary.event")).toBe(false);
  });

  it("leave removes the connection and re-broadcasts presence", () => {
    const hub = new DiaryLiveHub();
    const staying = fakeSocket();
    const leaving = fakeSocket();
    hub.join(VENUE_A, staying, { userId: "u1", name: "A", role: "staff" }, 1_000);
    const connection = hub.join(VENUE_A, leaving, { userId: "u2", name: "B", role: "staff" }, 1_000);

    hub.leave(VENUE_A, connection);

    expect(hub.connectionCount(VENUE_A)).toBe(1);
    expect(hub.presenceFor(VENUE_A)).toEqual([{ userId: "u1", name: "A", role: "staff" }]);
  });

  it("sweeps connections with no inbound activity past the threshold and closes them", () => {
    const hub = new DiaryLiveHub();
    const fresh = fakeSocket();
    const stale = fakeSocket();
    const freshConnection = hub.join(VENUE_A, fresh, { userId: "u1", name: "A", role: "staff" }, 0);
    hub.join(VENUE_A, stale, { userId: "u2", name: "B", role: "staff" }, 0);

    hub.touch(freshConnection, 60_000);
    const swept = hub.sweepStale(80_000, 65_000);

    expect(swept).toBe(1);
    expect(stale.closed).toBe(true);
    expect(fresh.closed).toBe(false);
    expect(hub.presenceFor(VENUE_A)).toEqual([{ userId: "u1", name: "A", role: "staff" }]);
  });

  it("send failures never break the fanout loop", () => {
    const hub = new DiaryLiveHub();
    const broken = fakeSocket();
    const healthy = fakeSocket();
    vi.spyOn(broken, "send").mockImplementation(() => {
      throw new Error("socket gone");
    });
    hub.join(VENUE_A, broken, { userId: "u1", name: "A", role: "staff" }, 0);
    hub.join(VENUE_A, healthy, { userId: "u2", name: "B", role: "staff" }, 0);

    expect(() => {
      hub.broadcast(VENUE_A, { type: "diary.event" });
    }).not.toThrow();
    expect(messagesOf(healthy).some((message) => message.type === "diary.event")).toBe(true);
  });
});

describe("registerDiaryLive — source contract", () => {
  it("authenticates first, scopes to the user's venue, and admits read roles", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    expect(source).toContain("resolveWsUser");
    expect(source).toContain('"/ws/diary"');
    expect(source).toContain("{ websocket: true }");
    // Read roles: staff/admin/hallkeeper (hallkeeper is read-facing but sees the diary).
    expect(source).toMatch(/hallkeeper/);
    // Presence is advisory, never a correctness mechanism.
    expect(source.toLowerCase()).toContain("advisory");
  });

  it("subscribes to the house event bus and cleans up on server close", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    expect(source).toContain('subscribe("diary.changed"');
    expect(source).toContain('server.addHook("onClose"');
    expect(source).toContain("clearInterval");
  });

  it("heartbeats every 20 seconds per Canon §15 and never holds the process open", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    expect(source).toContain("20_000");
    expect(source).toContain("heartbeat.unref()");
  });

  // Post-review hardening pins (slice-3 review P1/P2): the auth path must
  // never strand a connection or leak an unhandled rejection, in-flight auth
  // must not be aborted by a second frame, and a socket that closed during
  // the async auth must never join the hub.
  it("guards the async auth path — failure closes the socket instead of stranding it", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    // resolveWsUser + the profile lookup run inside try/catch…
    const tryIndex = source.indexOf("try {");
    const resolveIndex = source.indexOf("await resolveWsUser");
    expect(tryIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(tryIndex);
    // …and the catch answers with an error frame then closes.
    expect(source).toContain('code: "AUTH_FAILED"');
    const catchIndex = source.indexOf("} catch {", resolveIndex);
    expect(catchIndex).toBeGreaterThan(-1);
    expect(source.indexOf("socket.close()", catchIndex)).toBeGreaterThan(catchIndex);
  });

  it("drops frames while auth is in flight instead of treating them as a failed auth", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    const inFlightGuard = source.indexOf("if (authenticating) return;");
    const parse = source.indexOf("AuthMessage.safeParse");
    expect(inFlightGuard).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(inFlightGuard);
  });

  it("never joins a socket that closed while authentication was in flight", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    const livenessGuard = source.indexOf("if (closed || socket.readyState !== 1) return;");
    const join = source.indexOf("hub.join(");
    expect(livenessGuard).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(livenessGuard);
  });
});

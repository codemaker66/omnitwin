import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAFF_AUDIENCE_ROLES, USER_ROLES } from "@omnitwin/types";
import { __resetRegistryForTests, emit } from "../../observability/event-bus.js";
import {
  DIARY_READ_ROLES, DiaryAuthMessage, DiaryLiveHub, subscribeRequestFrames, type DiaryLiveSocket,
} from "../../ws/diary-live.js";
import { DIARY_WRITE_ROLES } from "../../services/booking-mutations.js";

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

  // The requests channel rides this door from every floor page. T-619 made
  // the Diary's count name only colleagues who are there; a page that only
  // listens must not put its person "here".
  it("hears a listening connection's frames but never counts it as presence", () => {
    const hub = new DiaryLiveHub();
    const onDiary = fakeSocket();
    const listening = fakeSocket();
    hub.join(VENUE_A, onDiary, { userId: "u1", name: "Elaine", role: "hallkeeper" }, 0);
    const presenceFrames = (): number => messagesOf(onDiary).filter((message) => message.type === "presence").length;
    const before = presenceFrames();

    const listener = hub.join(VENUE_A, listening, { userId: "u2", name: "Fiona", role: "staff" }, 0, { present: false });

    expect(hub.presenceFor(VENUE_A)).toEqual([{ userId: "u1", name: "Elaine", role: "hallkeeper" }]);
    expect(presenceFrames()).toBe(before);
    hub.broadcastToRoles(VENUE_A, ["staff"], { type: "request.event" });
    expect(messagesOf(listening).some((message) => message.type === "request.event")).toBe(true);

    hub.leave(VENUE_A, listener);
    expect(presenceFrames()).toBe(before);
    expect(hub.connectionCount(VENUE_A)).toBe(1);
  });

  it("takes a person's presence only from where they are, not from their listening page", () => {
    const hub = new DiaryLiveHub();
    const watcher = fakeSocket();
    hub.join(VENUE_A, watcher, { userId: "u9", name: "Watcher", role: "admin" }, 0);
    const diaryTab = hub.join(VENUE_A, fakeSocket(), { userId: "u1", name: "Elaine", role: "hallkeeper" }, 0);
    hub.join(VENUE_A, fakeSocket(), { userId: "u1", name: "Elaine", role: "hallkeeper" }, 0, { present: false });
    expect(hub.presenceFor(VENUE_A).map((person) => person.userId).sort()).toEqual(["u1", "u9"]);

    // Elaine closes the Diary; her other page still listens, but she has gone.
    hub.leave(VENUE_A, diaryTab);
    expect(hub.presenceFor(VENUE_A).map((person) => person.userId)).toEqual(["u9"]);
    const last = messagesOf(watcher).filter((message) => message.type === "presence").at(-1) as
      { type: string; users: readonly { userId: string }[] } | undefined;
    expect(last?.users.map((person) => person.userId)).toEqual(["u9"]);
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

// ---------------------------------------------------------------------------
// Requests on the diary channel (Ship Friday slice 10). The guarantee: a frame
// reaches only the connections whose role is in the request's OWN stored
// audience, or the people an inbox copy names, in that venue and no other.
// Driven through the real event bus and a real hub, so the wiring is proved,
// not only the targeting.
// ---------------------------------------------------------------------------

describe("request frames reach only the request's own audience", () => {
  afterEach(() => { __resetRegistryForTests(); });

  const log = Fastify({ logger: false }).log;

  function floorAndBeyond(hub: DiaryLiveHub): Record<string, FakeSocket> {
    const people: Record<string, FakeSocket> = {};
    for (const role of ["hallkeeper", "staff", "manager", "admin", "sales"] as const) {
      people[role] = fakeSocket();
      hub.join(VENUE_A, people[role], { userId: `${role}-a`, name: role, role }, 0);
    }
    people["elsewhere"] = fakeSocket();
    hub.join(VENUE_B, people["elsewhere"], { userId: "hallkeeper-b", name: "B", role: "hallkeeper" }, 0);
    return people;
  }

  function framesOf(socket: FakeSocket, type: string): Record<string, unknown>[] {
    return socket.sent
      .map((raw) => JSON.parse(raw) as Record<string, unknown>)
      .filter((message) => message["type"] === type);
  }

  it("targets roles within the venue, and nobody beyond them", () => {
    const hub = new DiaryLiveHub();
    const people = floorAndBeyond(hub);
    hub.broadcastToRoles(VENUE_A, ["hallkeeper", "staff"], { type: "probe" });
    expect(framesOf(people["hallkeeper"] as FakeSocket, "probe")).toHaveLength(1);
    expect(framesOf(people["staff"] as FakeSocket, "probe")).toHaveLength(1);
    for (const outside of ["manager", "admin", "sales", "elsewhere"]) {
      expect(framesOf(people[outside] as FakeSocket, "probe"), outside).toHaveLength(0);
    }
  });

  it("targets named people within the venue, and nobody when nobody is named", () => {
    const hub = new DiaryLiveHub();
    const people = floorAndBeyond(hub);
    hub.broadcastToUsers(VENUE_A, ["admin-a"], { type: "probe" });
    hub.broadcastToUsers(VENUE_A, [], { type: "nobody" });
    expect(framesOf(people["admin"] as FakeSocket, "probe")).toHaveLength(1);
    for (const other of ["hallkeeper", "staff", "manager", "sales", "elsewhere"]) {
      expect(framesOf(people[other] as FakeSocket, "probe"), other).toHaveLength(0);
    }
    for (const socket of Object.values(people)) expect(framesOf(socket, "nobody")).toHaveLength(0);
  });

  it("routes a request change to its stored audience, and says only that something changed", () => {
    const hub = new DiaryLiveHub();
    const people = floorAndBeyond(hub);
    subscribeRequestFrames(hub);
    emit(log, "request.changed", {
      venueId: VENUE_A, kind: "request.created", requestId: "r-1", bookingId: "b-1", roomId: "room-1",
      state: "sent", audienceRoles: [...STAFF_AUDIENCE_ROLES], actorUserId: "hallkeeper-a",
      at: "2026-09-26T10:00:00.000Z",
    });
    for (const role of ["hallkeeper", "staff", "manager", "admin"]) {
      const frames = framesOf(people[role] as FakeSocket, "request.event");
      expect(frames, role).toHaveLength(1);
      expect(Object.keys(frames[0] ?? {}).sort()).toEqual(
        ["at", "bookingId", "kind", "requestId", "roomId", "state", "type", "venueId"],
      );
    }
    expect(framesOf(people["sales"] as FakeSocket, "request.event")).toHaveLength(0);
    expect(framesOf(people["elsewhere"] as FakeSocket, "request.event")).toHaveLength(0);
  });

  it("delivers an escalation's inbox frame to the administrators it names, and no one else", () => {
    const hub = new DiaryLiveHub();
    const people = floorAndBeyond(hub);
    subscribeRequestFrames(hub);
    emit(log, "notification.created", {
      venueId: VENUE_A, audienceRoles: [], recipientUserIds: ["admin-a"], notificationIds: ["n-1"],
      title: "A request in Grand Hall is still waiting", severity: "urgent", at: "2026-09-26T10:03:00.000Z",
    });
    expect(framesOf(people["admin"] as FakeSocket, "notification.event")).toHaveLength(1);
    for (const other of ["hallkeeper", "staff", "manager", "sales", "elsewhere"]) {
      expect(framesOf(people[other] as FakeSocket, "notification.event"), other).toHaveLength(0);
    }
  });

  it("stops routing once the server has closed", () => {
    const hub = new DiaryLiveHub();
    const people = floorAndBeyond(hub);
    const unsubscribe = subscribeRequestFrames(hub);
    unsubscribe();
    emit(log, "request.changed", {
      venueId: VENUE_A, kind: "request.updated", requestId: "r-1", bookingId: null, roomId: "room-1",
      state: "accepted", audienceRoles: ["hallkeeper"], actorUserId: null, at: "2026-09-26T10:05:00.000Z",
    });
    expect(framesOf(people["hallkeeper"] as FakeSocket, "request.event")).toHaveLength(0);
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

  it("reads presence from the auth frame: absent is present, false only listens", async () => {
    expect(DiaryAuthMessage.parse({ type: "auth", token: "t" }).presence).toBeUndefined();
    expect(DiaryAuthMessage.parse({ type: "auth", token: "t", presence: false }).presence).toBe(false);
    expect(DiaryAuthMessage.safeParse({ type: "auth", token: "t", presence: "no" }).success).toBe(false);
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    expect(source).toContain("DiaryAuthMessage.safeParse(data)");
    expect(source).toContain("{ present: auth.data.presence !== false }");
  });

  it("never joins a socket that closed while authentication was in flight", async () => {
    const source = await readFile(resolve("src/ws/diary-live.ts"), "utf-8");
    const livenessGuard = source.indexOf("if (closed || socket.readyState !== 1) return;");
    const join = source.indexOf("hub.join(");
    expect(livenessGuard).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(livenessGuard);
  });
});

// ---------------------------------------------------------------------------
// The diary read set (goal 18 §2 line 25, §6 decision 6a)
//
// Three role sets govern the diary and they are maintained in three files:
// this read set, DIARY_WRITE_ROLES in services/booking-mutations.ts, and
// DIARY_COMMAND_WRITE_ROLES in services/diary-commands.ts. The read set must
// be the widest — a role that may ink the diary but not watch it, or watch a
// slot change it cannot make, is a surface that half works.
// ---------------------------------------------------------------------------

describe("DIARY_READ_ROLES", () => {
  it("admits everyone who works the venue's day or its pipeline", () => {
    for (const role of ["staff", "admin", "manager", "hallkeeper", "sales"]) {
      expect(DIARY_READ_ROLES.has(role), `${role} may watch the diary`).toBe(true);
    }
  });

  it("refuses the customer roles and the event-scoped caterer", () => {
    for (const role of ["client", "planner", "caterer"]) {
      expect(DIARY_READ_ROLES.has(role), `${role} may not watch the diary`).toBe(false);
    }
  });

  it("refuses names outside the vocabulary", () => {
    for (const role of ["executive", "supplier", "future_role", ""]) {
      expect(DIARY_READ_ROLES.has(role)).toBe(false);
    }
  });

  it("is at least as wide as every role that may write the diary", () => {
    for (const role of USER_ROLES) {
      if (!DIARY_WRITE_ROLES.has(role)) continue;
      expect(
        DIARY_READ_ROLES.has(role),
        `${role} may ink the diary but could not watch it`,
      ).toBe(true);
    }
  });
});

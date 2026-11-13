import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canJoinLayoutLive, type LiveOp } from "@omnitwin/types";
import { __resetRegistryForTests, emit } from "../../observability/event-bus.js";
import {
  LAYOUT_LIVE_BURST_FRAMES,
  LAYOUT_LIVE_MAX_FRAME_BYTES,
  LayoutLiveHub,
  type LayoutLiveSocket,
} from "../../ws/layout-live.js";
import { registerAutoSave, revalidateLayoutLiveRooms } from "../../ws/auto-save.js";
import { configurations, users } from "../../db/schema.js";
import type { Database } from "../../db/client.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the layout live hub, its access rule, and the socket
// it rides. The hub is pure of timers (clock injected) and of the database.
// ---------------------------------------------------------------------------

const CONFIG_A = "00000000-0000-4000-8000-00000000c0a1";
const CONFIG_B = "00000000-0000-4000-8000-00000000c0b2";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_VENUE = "00000000-0000-4000-8000-0000000000b2";
const OBJECT_ID = "00000000-0000-4000-8000-0000000000f1";

interface FakeSocket extends LayoutLiveSocket {
  readonly sent: string[];
  closed: boolean;
}

function fakeSocket(): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    sent,
    closed: false,
    send(text: string) { sent.push(text); },
    close() { socket.closed = true; },
  };
  return socket;
}

type Frame = Record<string, unknown> & { readonly type: string };

function framesOf(socket: FakeSocket, type?: string): Frame[] {
  const all = socket.sent.map((raw) => JSON.parse(raw) as Frame);
  return type === undefined ? all : all.filter((frame) => frame.type === type);
}

function objectState(positionX: number, id: string = OBJECT_ID): Record<string, unknown> {
  return {
    id,
    assetDefinitionId: "round-table-6ft",
    positionX,
    positionY: 0,
    positionZ: 2,
    rotationX: 0,
    rotationY: 0.5,
    rotationZ: 0,
    scale: 1,
    sortOrder: 0,
    metadata: null,
  };
}

function moveOp(positionX: number, id: string = OBJECT_ID): LiveOp {
  return { kind: "put", object: objectState(positionX, id) } as LiveOp;
}

function hubWithClock(start = 1_000): { hub: LayoutLiveHub; clock: { now: number } } {
  const clock = { now: start };
  let n = 0;
  const hub = new LayoutLiveHub(() => clock.now, () => `c${String(++n)}`);
  return { hub, clock };
}

describe("LayoutLiveHub — presence", () => {
  it("greets the joiner with hello and tells the others who arrived", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "hallkeeper" });

    const hello = framesOf(sam, "live.hello")[0];
    expect(hello).toMatchObject({ connectionId: "c2", seq: 0 });
    expect((hello?.["participants"] as unknown[]).length).toBe(2);
    const presence = framesOf(alex, "live.presence").at(-1);
    expect((presence?.["participants"] as { name: string }[]).map((p) => p.name)).toEqual(["Alex", "Sam"]);
    // The joiner is not sent a redundant presence frame for its own arrival.
    expect(framesOf(sam, "live.presence")).toHaveLength(0);
  });

  it("keys presence by connection: one person in two tabs is two participants", () => {
    const { hub } = hubWithClock();
    hub.join(CONFIG_A, fakeSocket(), { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, fakeSocket(), { userId: "u-alex", name: "Alex", role: "staff" });
    expect(hub.participants(CONFIG_A).map((p) => p.connectionId)).toEqual(["c1", "c2"]);
  });

  it("broadcasts the room each person reports viewing", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });
    const view = { spaceId: VENUE, label: "Grand Hall" };
    expect(hub.handleClientFrame(alexConnection, { type: "live.view", view }, 60)).toBe("view");
    const latest = framesOf(sam, "live.presence").at(-1);
    expect((latest?.["participants"] as { view: unknown }[])[0]?.view).toEqual(view);
  });

  it("tells the room when someone leaves and forgets an empty room", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    const samConnection = hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });
    hub.leave(alexConnection);
    const latest = framesOf(sam, "live.presence").at(-1);
    expect((latest?.["participants"] as unknown[]).length).toBe(1);
    hub.leave(samConnection);
    expect(hub.connectionCount(CONFIG_A)).toBe(0);
  });

  it("sweeps a connection silent past the stale threshold and closes it", () => {
    const { hub, clock } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    const samConnection = hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });
    clock.now += 60_000;
    hub.touch(samConnection);
    clock.now += 10_000;
    expect(hub.sweepStale(65_000)).toBe(1);
    expect(alex.closed).toBe(true);
    expect(hub.participants(CONFIG_A).map((p) => p.name)).toEqual(["Sam"]);
  });
});

describe("LayoutLiveHub — live ops", () => {
  it("relays ops to the whole room, sender included, in one increasing sequence", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    const samConnection = hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });

    hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(1)] }, 200);
    hub.handleClientFrame(samConnection, { type: "live.ops", ops: [moveOp(2)] }, 200);

    for (const socket of [alex, sam]) {
      const ops = framesOf(socket, "live.ops");
      expect(ops.map((frame) => frame["seq"])).toEqual([1, 2]);
      expect(ops.map((frame) => frame["connectionId"])).toEqual(["c1", "c2"]);
    }
    // The name on a relayed op is the server's, never the client's.
    expect(framesOf(sam, "live.ops")[0]?.["name"]).toBe("Alex");
  });

  it("never crosses into another layout's room", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const elsewhere = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_B, elsewhere, { userId: "u-sam", name: "Sam", role: "staff" });
    hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(1)] }, 200);
    expect(framesOf(elsewhere, "live.ops")).toHaveLength(0);
  });

  it("drops malformed and oversized frames without closing anything", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });

    const nonFinite = { type: "live.ops", ops: [{ kind: "put", object: { ...objectState(1), positionX: "NaN" } }] };
    expect(hub.handleClientFrame(alexConnection, nonFinite, 200)).toBe("dropped");
    expect(hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [] }, 50)).toBe("dropped");
    expect(hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(1)] }, LAYOUT_LIVE_MAX_FRAME_BYTES + 1)).toBe("dropped");
    expect(hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [{ kind: "remove", id: "not-an-id" }] }, 50)).toBe("dropped");
    expect(framesOf(sam, "live.ops")).toHaveLength(0);
    expect(alex.closed).toBe(false);
  });

  it("drops a burst over the rate and recovers as the bucket refills", () => {
    const { hub, clock } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });
    const outcomes = Array.from({ length: LAYOUT_LIVE_BURST_FRAMES + 5 }, () =>
      hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(1)] }, 200));
    expect(outcomes.filter((outcome) => outcome === "dropped")).toHaveLength(5);
    clock.now += 1_000;
    expect(hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(2)] }, 200)).toBe("relayed");
    expect(alex.closed).toBe(false);
  });

  it("relays a save's id map in the same sequence as the ops", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const sam = fakeSocket();
    const alexConnection = hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_A, sam, { userId: "u-sam", name: "Sam", role: "staff" });
    hub.handleClientFrame(alexConnection, { type: "live.ops", ops: [moveOp(1, "local-7")] }, 200);
    hub.handleClientFrame(alexConnection, { type: "live.saved", revision: 4, ids: [["local-7", OBJECT_ID]] }, 100);
    expect(framesOf(sam, "live.saved")[0]).toMatchObject({ seq: 2, revision: 4, connectionId: "c1" });
  });

  it("announces a commit to the layout's room only, with no geometry", () => {
    const { hub } = hubWithClock();
    const alex = fakeSocket();
    const elsewhere = fakeSocket();
    hub.join(CONFIG_A, alex, { userId: "u-alex", name: "Alex", role: "staff" });
    hub.join(CONFIG_B, elsewhere, { userId: "u-sam", name: "Sam", role: "staff" });
    expect(hub.announceCommit(CONFIG_A, 9, "u-sam")).toBe(1);
    expect(framesOf(alex, "layout.changed")).toEqual([
      { type: "layout.changed", revision: 9, actorUserId: "u-sam", serverNowMs: 1_000 },
    ]);
    expect(framesOf(elsewhere, "layout.changed")).toHaveLength(0);
  });
});

describe("canJoinLayoutLive — owner and venue floor only", () => {
  const layout = { ownerUserId: "u-owner", venueId: VENUE };
  const actor = (role: string, overrides: Partial<{ userId: string; venueId: string | null; platformRole: string }> = {}) => ({
    userId: "u-someone", role, venueId: VENUE, platformRole: "none", ...overrides,
  });

  it.each(["admin", "manager", "staff", "hallkeeper"])("admits venue %s at the layout's venue", (role) => {
    expect(canJoinLayoutLive(actor(role), layout)).toBe(true);
  });

  it.each(["admin", "staff", "hallkeeper"])("refuses venue %s from another venue", (role) => {
    expect(canJoinLayoutLive(actor(role, { venueId: OTHER_VENUE }), layout)).toBe(false);
  });

  it("admits the layout's owner", () => {
    expect(canJoinLayoutLive(actor("sales", { userId: "u-owner" }), layout)).toBe(true);
  });

  it.each(["client", "planner"])("refuses a %s even when they own the layout", (role) => {
    expect(canJoinLayoutLive(actor(role, { userId: "u-owner" }), layout)).toBe(false);
  });

  it("refuses an owner whose role is not the venue's team (a caterer), failing closed for new roles", () => {
    expect(canJoinLayoutLive(actor("caterer", { userId: "u-owner" }), layout)).toBe(false);
    expect(canJoinLayoutLive(actor("some-future-role", { userId: "u-owner" }), layout)).toBe(false);
  });

  it("refuses sales and caterers who do not own the layout", () => {
    expect(canJoinLayoutLive(actor("sales"), layout)).toBe(false);
    expect(canJoinLayoutLive(actor("caterer"), layout)).toBe(false);
  });

  it("admits a Venviewer platform admin anywhere", () => {
    expect(canJoinLayoutLive(actor("client", { venueId: null, platformRole: "admin" }), layout)).toBe(true);
  });
});

describe("layout-live — structurally incapable of persisting", () => {
  it("the hub module imports neither the database client nor the schema", async () => {
    const source = await readFile(new URL("../../ws/layout-live.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*db\/(schema|client)/u);
    expect(source).not.toMatch(/drizzle/u);
  });
});

// ---------------------------------------------------------------------------
// The real route, two real sockets (Fastify injectWS). The database is a stub
// that answers the two reads the join makes and FAILS LOUDLY on any write, so
// a live op that reached a persistence path would fail the test.
// ---------------------------------------------------------------------------

/** The select chain the code under test uses, typed so one cast suffices
 *  (the house pattern in asset-rooms-route.test.ts). */
interface FakeFiltered extends PromiseLike<readonly unknown[]> {
  limit: (count: number) => Promise<readonly unknown[]>;
}
interface FakeQuery {
  where: (...conditions: readonly unknown[]) => FakeFiltered;
}
interface FakeSelectQuery {
  from: (table: unknown) => FakeQuery;
}

function fakeSelect(rowsFor: (table: unknown) => readonly unknown[]): Database["select"] {
  return (() => ({
    from(table: unknown): FakeQuery {
      const rows = rowsFor(table);
      const filtered: FakeFiltered = {
        limit: () => Promise.resolve(rows),
        then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
      };
      return { where: () => filtered };
    },
  }) satisfies FakeSelectQuery) as Database["select"];
}

interface StubDb {
  readonly db: Database;
  readonly writes: string[];
}

function stubDb(owner: string | null): StubDb {
  const writes: string[] = [];
  const rowsFor = (table: unknown): unknown[] => {
    if (table === configurations) return [{ userId: owner, venueId: VENUE }];
    if (table === users) return [{ name: "Alex Murray" }];
    return [];
  };
  const select = fakeSelect(rowsFor);
  const refuse = (name: string): (() => never) => () => {
    writes.push(name);
    throw new Error(`unexpected database write: ${name}`);
  };
  const db = {
    select,
    insert: refuse("insert") as Database["insert"],
    update: refuse("update") as Database["update"],
    delete: refuse("delete") as Database["delete"],
    transaction: refuse("transaction") as Database["transaction"],
  } as Database;
  return { db, writes };
}

type TestSocket = Awaited<ReturnType<FastifyInstance["injectWS"]>>;

function collect(socket: TestSocket): Frame[] {
  const frames: Frame[] = [];
  socket.on("message", (data: Buffer) => { frames.push(JSON.parse(data.toString("utf8")) as Frame); });
  return frames;
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a frame");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function token(id: string, role: string, venueId: string | null = VENUE): string {
  return JSON.stringify({ id, role, venueId });
}

describe("/ws/configurations/:configId — live room on the auto-save socket", () => {
  let server: FastifyInstance;
  let stub: StubDb;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    __resetRegistryForTests();
    vi.stubEnv("NODE_ENV", "test");
    stub = stubDb("u-owner");
    server = Fastify({ logger: false });
    await server.register(websocket);
    await registerAutoSave(server, stub.db);
    await server.ready();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await server.close();
    vi.unstubAllEnvs();
    __resetRegistryForTests();
  });

  async function open(auth: string): Promise<{ socket: TestSocket; frames: Frame[] }> {
    const socket = await server.injectWS(`/ws/configurations/${CONFIG_A}`);
    sockets.push(socket);
    const frames = collect(socket);
    socket.send(JSON.stringify({ type: "auth", token: auth }));
    await until(() => frames.some((frame) => frame.type === "authenticated"));
    return { socket, frames };
  }

  it("lets two staff see each other and each other's ops, and writes nothing", async () => {
    const alex = await open(token("u-alex", "staff"));
    await until(() => alex.frames.some((frame) => frame.type === "live.hello"));
    const sam = await open(token("u-sam", "hallkeeper"));
    await until(() => sam.frames.some((frame) => frame.type === "live.hello"));
    await until(() => alex.frames.some((frame) => frame.type === "live.presence"));

    for (let i = 0; i < 20; i += 1) {
      alex.socket.send(JSON.stringify({ type: "live.ops", ops: [moveOp(i)] }));
    }
    await until(() => sam.frames.filter((frame) => frame.type === "live.ops").length === 20);
    const seqs = sam.frames.filter((frame) => frame.type === "live.ops").map((frame) => frame["seq"]);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // Alex hears its own ops back, in the same order.
    await until(() => alex.frames.filter((frame) => frame.type === "live.ops").length === 20);
    expect(stub.writes).toEqual([]);
  });

  it("tells the room to refetch after a commit announced on the bus", async () => {
    const alex = await open(token("u-alex", "staff"));
    await until(() => alex.frames.some((frame) => frame.type === "live.hello"));
    emit(server.log, "layout.changed", {
      configId: CONFIG_A, revision: 12, actorUserId: "u-sam", source: "authenticated_batch", at: new Date().toISOString(),
    });
    await until(() => alex.frames.some((frame) => frame.type === "layout.changed"));
    expect(alex.frames.find((frame) => frame.type === "layout.changed")).toMatchObject({ revision: 12, actorUserId: "u-sam" });
  });

  it("gives a client nothing new: authenticated, never joined, ops dropped", async () => {
    const alex = await open(token("u-alex", "staff"));
    await until(() => alex.frames.some((frame) => frame.type === "live.hello"));
    const client = await open(token("u-owner", "client"));
    client.socket.send(JSON.stringify({ type: "live.ops", ops: [moveOp(3)] }));
    client.socket.send(JSON.stringify({ type: "ping" }));
    await until(() => client.frames.some((frame) => frame.type === "pong"));
    expect(client.frames.map((frame) => frame.type)).toEqual(["authenticated", "pong"]);
    expect(alex.frames.some((frame) => frame.type === "live.ops")).toBe(false);
    // The staff member's room never listed the client.
    expect(alex.frames.filter((frame) => frame.type === "live.presence")).toHaveLength(0);
  });

  it("refuses venue staff from another venue", async () => {
    const outsider = await open(token("u-out", "staff", OTHER_VENUE));
    outsider.socket.send(JSON.stringify({ type: "ping" }));
    await until(() => outsider.frames.some((frame) => frame.type === "pong"));
    expect(outsider.frames.some((frame) => frame.type === "live.hello")).toBe(false);
  });

  it("removes a closed connection from everyone's presence", async () => {
    const alex = await open(token("u-alex", "staff"));
    await until(() => alex.frames.some((frame) => frame.type === "live.hello"));
    const sam = await open(token("u-sam", "staff"));
    await until(() => sam.frames.some((frame) => frame.type === "live.hello"));
    sam.socket.terminate();
    await until(() => {
      const latest = alex.frames.filter((frame) => frame.type === "live.presence").at(-1);
      return (latest?.["participants"] as unknown[] | undefined)?.length === 1;
    });
  });
});

// ---------------------------------------------------------------------------
// The periodic access re-check, against a database whose answers change.
// ---------------------------------------------------------------------------

describe("revalidateLayoutLiveRooms — access ends within one heartbeat", () => {
  interface Row { readonly [key: string]: unknown }
  function changingDb(state: { config: Row | null; users: Row[] }): Database {
    const rowsFor = (table: unknown): Row[] => {
      if (table === configurations) return state.config === null ? [] : [state.config];
      if (table === users) return state.users;
      return [];
    };
    return { select: fakeSelect(rowsFor) } as Database;
  }

  function joinedHub(): { hub: LayoutLiveHub; staff: FakeSocket; owner: FakeSocket } {
    const { hub } = hubWithClock();
    const staff = fakeSocket();
    const owner = fakeSocket();
    hub.join(CONFIG_A, staff, { userId: "u-staff", name: "Sam", role: "staff" });
    hub.join(CONFIG_A, owner, { userId: "u-owner", name: "Olive", role: "staff" });
    return { hub, staff, owner };
  }

  const staffRow = { id: "u-staff", role: "staff", venueId: VENUE, platformRole: "none" };
  const ownerRow = { id: "u-owner", role: "staff", venueId: VENUE, platformRole: "none" };

  it("keeps everyone who is still admitted", async () => {
    const { hub } = joinedHub();
    const db = changingDb({ config: { userId: "u-owner", venueId: VENUE }, users: [staffRow, ownerRow] });
    expect(await revalidateLayoutLiveRooms(db, hub)).toBe(0);
    expect(hub.connectionCount(CONFIG_A)).toBe(2);
  });

  it("revokes staff moved to another venue and an owner demoted to client", async () => {
    const { hub, staff, owner } = joinedHub();
    const db = changingDb({
      config: { userId: "u-owner", venueId: VENUE },
      users: [{ ...staffRow, venueId: OTHER_VENUE }, { ...ownerRow, role: "client" }],
    });
    expect(await revalidateLayoutLiveRooms(db, hub)).toBe(2);
    expect(framesOf(staff, "live.revoked")).toHaveLength(1);
    expect(framesOf(owner, "live.revoked")).toHaveLength(1);
    expect(hub.connectionCount(CONFIG_A)).toBe(0);
  });

  it("revokes everyone once the layout is deleted, and a user who no longer exists", async () => {
    const { hub } = joinedHub();
    expect(await revalidateLayoutLiveRooms(changingDb({ config: null, users: [staffRow, ownerRow] }), hub)).toBe(2);
    const second = joinedHub();
    const db = changingDb({ config: { userId: "u-owner", venueId: VENUE }, users: [ownerRow] });
    expect(await revalidateLayoutLiveRooms(db, second.hub)).toBe(1);
    expect(second.hub.participants(CONFIG_A).map((p) => p.userId)).toEqual(["u-owner"]);
  });
});

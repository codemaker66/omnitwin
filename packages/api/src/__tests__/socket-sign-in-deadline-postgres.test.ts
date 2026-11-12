import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { registerAutoSave } from "../ws/auto-save.js";
import { registerDiaryLive } from "../ws/diary-live.js";

// ---------------------------------------------------------------------------
// Whole-repository audit, api-diary-bookings-8, through real sockets
// (@fastify/websocket's injectWS) on the disposable platform database.
//
// Both socket routes accept a connection first and learn who it is from its
// first frame. A connection that never sent one was kept for good: the hubs'
// ping and stale sweep reach only sockets that have joined, so a phone that
// dropped before its auth frame, or anyone opening sockets and saying
// nothing, held a connection on the one API replica until it restarted.
//
// The routes are registered here with a one-second deadline in place of the
// ten seconds production allows. Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Socket deadline tests require the explicit disposable platform database");
  }
}

const DEADLINE_MS = 1_000;

interface Frame {
  readonly type: string;
  readonly code?: string;
}

interface Client {
  readonly frames: Frame[];
  /** Resolves when the server has closed the socket. */
  readonly closed: Promise<void>;
  /** How long the socket has been, or was, open. */
  openForMs(): number;
  send(frame: Record<string, unknown>): void;
  frame(type: string): Promise<Frame>;
}

describe.skipIf(target === undefined)("a socket that never signs in", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const opened: { terminate(): void }[] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, max: 4, application_name: `socket_deadline_${randomUUID()}`,
      options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(websocket);
    await registerAutoSave(server, db, { signInDeadlineMs: DEADLINE_MS });
    await registerDiaryLive(server, db, { signInDeadlineMs: DEADLINE_MS });
    await server.ready();
  }, 60_000);

  afterEach(() => {
    for (const socket of opened.splice(0)) socket.terminate();
  });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function open(path: string): Promise<Client> {
    const ws = await server.injectWS(path);
    opened.push(ws);
    const openedAt = Date.now();
    let closedAt: number | null = null;
    const frames: Frame[] = [];
    const waiters: { type: string; resolve: (frame: Frame) => void }[] = [];
    ws.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf-8")) as Frame;
      frames.push(frame);
      const waiter = waiters.findIndex((candidate) => candidate.type === frame.type);
      if (waiter !== -1) waiters.splice(waiter, 1)[0]?.resolve(frame);
    });
    const closed = new Promise<void>((resolve) => {
      ws.on("close", () => { closedAt = Date.now(); resolve(); });
    });
    return {
      frames,
      closed,
      openForMs: () => (closedAt ?? Date.now()) - openedAt,
      send: (frame) => { ws.send(JSON.stringify(frame)); },
      frame: (type) => {
        const seen = frames.find((frame) => frame.type === type);
        if (seen !== undefined) return Promise.resolve(seen);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { reject(new Error(`No ${type} frame; received ${JSON.stringify(frames)}`)); }, 10_000);
          waiters.push({ type, resolve: (frame) => { clearTimeout(timer); resolve(frame); } });
        });
      },
    };
  }

  /** Whether the server closed the socket within a time. */
  function closedWithin(ms: number, client: Client): Promise<"closed" | "still open"> {
    return Promise.race([
      client.closed.then(() => "closed" as const),
      new Promise<"still open">((resolve) => { setTimeout(() => { resolve("still open"); }, ms); }),
    ]);
  }

  async function staffToken(): Promise<string> {
    const venueId = randomUUID(), id = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY socket deadline venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.users).values({ id, clerkId: null, venueId, name: "Socket deadline person", email: `${id}@socket.invalid`, role: "staff" });
    return JSON.stringify({ id, role: "staff", platformRole: "none", venueId });
  }

  it.each([
    ["the Diary's", "/ws/diary"],
    ["the planner's", `/ws/configurations/${randomUUID()}`],
  ])("is told to sign in and closed at the deadline, on %s socket", async (_whose, path) => {
    const client = await open(path);
    expect(await closedWithin(DEADLINE_MS * 6, client)).toBe("closed");
    expect(client.frames).toEqual([expect.objectContaining({ type: "error", code: "UNAUTHORIZED" })]);
    // At the deadline, not before it: a client is given its time to fetch a token.
    expect(client.openForMs()).toBeGreaterThanOrEqual(DEADLINE_MS - 50);
  }, 20_000);

  it("leaves a Diary socket that has signed in open past the deadline", async () => {
    const token = await staffToken();
    const client = await open("/ws/diary");
    client.send({ type: "auth", token, presence: false });
    await client.frame("hello");
    expect(await closedWithin(DEADLINE_MS * 2, client)).toBe("still open");
    client.send({ type: "ping" });
    expect(await client.frame("pong")).toMatchObject({ type: "pong" });
  }, 20_000);

  it("leaves a planner socket that has signed in open past the deadline", async () => {
    const token = await staffToken();
    const client = await open(`/ws/configurations/${randomUUID()}`);
    client.send({ type: "auth", token });
    await client.frame("authenticated");
    expect(await closedWithin(DEADLINE_MS * 2, client)).toBe("still open");
    client.send({ type: "ping" });
    expect(await client.frame("pong")).toMatchObject({ type: "pong" });
  }, 20_000);
});

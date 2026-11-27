import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getUserByClerkId } from "../middleware/auth.js";
import { databasePersistence, processClerkWebhookEvent } from "../routes/webhooks.js";
import { registerAutoSave, revalidateLayoutLiveRooms } from "../ws/auto-save.js";
import { DiaryLiveHub, MAX_CONNECTION_AGE_MS, recheckDiaryConnections, registerDiaryLive } from "../ws/diary-live.js";
import { LayoutLiveHub } from "../ws/layout-live.js";
import { readCurrentSocketUser } from "../ws/socket-identity.js";

// ---------------------------------------------------------------------------
// An open socket acts with the role its person holds now (release audit
// configs-4 and events-diary-5), on the migrated disposable platform
// database, through real sockets (@fastify/websocket's injectWS).
//
// /ws/configurations: a save re-reads the users row inside its transaction.
// An offboarded (Clerk unlinked), moved or demoted person's buffered delete
// is refused and the socket closes; a venue admin demoted to staff meets the
// review lock. The controls send a stale revision: the socket's own commit
// cannot land on a migrated database (configuration_layout_revisions' source
// check has never admitted 'websocket_autosave'; the editor saves through the
// batch), so REVISION_CONFLICT is how a save shows it got past the identity
// and review checks.
// /ws/diary: every command, and every heartbeat, reads the person again; any
// change refuses the command with its own 403 ack and ends the connection.
// A test-mode token (no Clerk account) is held to its row alone, as the seeded
// people of the live e2e stacks are; a Clerk account deleted by the webhook
// never links its row again, so a reconnect with an older token is refused.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Socket identity tests require the explicit disposable platform database");
  }
}

interface Frame {
  readonly type: string;
  readonly code?: string;
  readonly status?: number;
  readonly outcome?: string;
  readonly [key: string]: unknown;
}

/** A client socket that keeps every frame and says when it closed. */
interface Client {
  send(frame: Record<string, unknown>): void;
  next(type: string): Promise<Frame>;
  closed(): Promise<void>;
  close(): void;
}

type UserChange = "offboarded" | "moved" | "demoted";

describe.skipIf(target === undefined)("open sockets act with their person's current role", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const opened: Client[] = [];
  const applicationName = `socket_identity_${randomUUID()}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, max: 6, application_name: applicationName,
      options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(websocket);
    await registerAutoSave(server, db);
    await registerDiaryLive(server, db);
    await server.ready();
  }, 60_000);

  afterEach(() => {
    for (const client of opened.splice(0)) client.close();
  });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function open(path: string): Promise<Client> {
    const ws = await server.injectWS(path);
    const frames: Frame[] = [];
    const waiters: { type: string; resolve: (frame: Frame) => void }[] = [];
    let isClosed = false;
    const closeWaiters: (() => void)[] = [];
    ws.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf-8")) as Frame;
      const waiter = waiters.findIndex((candidate) => candidate.type === frame.type);
      if (waiter === -1) { frames.push(frame); return; }
      const [found] = waiters.splice(waiter, 1);
      found?.resolve(frame);
    });
    ws.on("close", () => {
      isClosed = true;
      for (const resolve of closeWaiters.splice(0)) resolve();
    });
    const client: Client = {
      send: (frame) => { ws.send(JSON.stringify(frame)); },
      next: (type) => {
        const index = frames.findIndex((frame) => frame.type === type);
        if (index !== -1) return Promise.resolve(frames.splice(index, 1)[0] as Frame);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`No ${type} frame; received ${JSON.stringify(frames)}`));
          }, 5_000);
          waiters.push({ type, resolve: (frame) => { clearTimeout(timer); resolve(frame); } });
        });
      },
      closed: () => (isClosed ? Promise.resolve() : new Promise((resolve) => { closeWaiters.push(resolve); })),
      close: () => { if (!isClosed) ws.terminate(); },
    };
    opened.push(client);
    return client;
  }

  async function venueWithLayout(options: { reviewStatus?: string } = {}) {
    const venueId = randomUUID(), otherVenueId = randomUUID(), spaceId = randomUUID(), configId = randomUUID();
    const assetId = randomUUID(), objectId = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY socket venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "TEST ONLY chair", category: "chair",
      widthM: "0.5", depthM: "0.5", heightM: "0.9" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId, userId: null, name: "TEST ONLY socket layout",
      slug: "socket", layoutStyle: "custom", reviewStatus: options.reviewStatus ?? "draft" });
    await db.insert(schema.placedObjects).values({ id: objectId, configurationId: configId, assetDefinitionId: assetId,
      positionX: "2", positionY: "0", positionZ: "2", coordinateWriteToken: randomUUID() });
    return { venueId, otherVenueId, spaceId, configId, objectId };
  }

  async function person(venueId: string, role: string) {
    const id = randomUUID(), clerkId = `user_${randomUUID()}`, email = `${id}@socket.invalid`;
    await db.insert(schema.users).values({ id, clerkId, venueId, name: "Socket person", email, role });
    return { id, clerkId, email, token: JSON.stringify({ id, role, platformRole: "none", venueId, clerkId }) };
  }

  /** A person as seed.ts makes the live e2e people: no Clerk account, and a test-mode token naming none. */
  async function seededPerson(venueId: string, role: string) {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, clerkId: null, venueId, name: "Seeded person", email: `${id}@socket.invalid`, role });
    return { id, token: JSON.stringify({ id, role, platformRole: "none", venueId }) };
  }

  async function change(userId: string, how: UserChange, otherVenueId: string): Promise<void> {
    const set = how === "offboarded" ? { clerkId: null } : how === "moved" ? { venueId: otherVenueId } : { role: "client" };
    await db.update(schema.users).set(set).where(eq(schema.users.id, userId));
  }

  async function layoutState(configId: string, objectId: string) {
    const [config] = await db.select({ revision: schema.configurations.revision }).from(schema.configurations)
      .where(eq(schema.configurations.id, configId));
    const objects = await db.select({ id: schema.placedObjects.id }).from(schema.placedObjects)
      .where(and(eq(schema.placedObjects.configurationId, configId), eq(schema.placedObjects.id, objectId)));
    return { revision: config?.revision, objectKept: objects.length === 1 };
  }

  async function autoSaveSocket(configId: string, token: string): Promise<Client> {
    const client = await open(`/ws/configurations/${configId}`);
    client.send({ type: "auth", token });
    await client.next("authenticated");
    return client;
  }

  // -------------------------------------------------------------------------
  // configs-4: /ws/configurations
  // -------------------------------------------------------------------------

  it("lets a staff member who is still who they connected as past the identity check", async () => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await autoSaveSocket(f.configId, staff.token);
    client.send({ type: "delete_object", expectedRevision: 5, objectId: f.objectId });
    client.send({ type: "flush" });
    expect(await client.next("error")).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 1 });
    // Still open: a conflict is the client's to resolve.
    client.send({ type: "ping" });
    expect(await client.next("pong")).toMatchObject({ type: "pong" });
  });

  it.each(["offboarded", "moved", "demoted"] as const)("refuses a %s staff member's open socket and closes it, writing nothing", async (how) => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await autoSaveSocket(f.configId, staff.token);
    await change(staff.id, how, f.otherVenueId);

    client.send({ type: "delete_object", expectedRevision: 1, objectId: f.objectId });
    client.send({ type: "flush" });
    expect(await client.next("error")).toMatchObject({ code: "FORBIDDEN" });
    await client.closed();
    expect(await layoutState(f.configId, f.objectId)).toEqual({ revision: 1, objectKept: true });
  });

  it("holds a venue admin demoted to staff to the review lock on an approved layout", async () => {
    const f = await venueWithLayout({ reviewStatus: "approved" });
    const admin = await person(f.venueId, "admin");
    const client = await autoSaveSocket(f.configId, admin.token);
    await db.update(schema.users).set({ role: "staff" }).where(eq(schema.users.id, admin.id));

    client.send({ type: "delete_object", expectedRevision: 1, objectId: f.objectId });
    client.send({ type: "flush" });
    expect(await client.next("error")).toMatchObject({ code: "CONFIG_LOCKED", reviewStatus: "approved" });
    expect(await layoutState(f.configId, f.objectId)).toEqual({ revision: 1, objectKept: true });
  });

  it("still lets the venue's admin past the review lock on an approved layout", async () => {
    const f = await venueWithLayout({ reviewStatus: "approved" });
    const admin = await person(f.venueId, "admin");
    const client = await autoSaveSocket(f.configId, admin.token);
    client.send({ type: "delete_object", expectedRevision: 5, objectId: f.objectId });
    client.send({ type: "flush" });
    expect(await client.next("error")).toMatchObject({ code: "REVISION_CONFLICT" });
  });

  // -------------------------------------------------------------------------
  // events-diary-5: /ws/diary
  // -------------------------------------------------------------------------

  async function diarySocket(token: string): Promise<Client> {
    const client = await open("/ws/diary");
    client.send({ type: "auth", token, presence: false });
    await client.next("hello");
    return client;
  }

  function blockCommand(venueId: string, spaceId: string) {
    return { type: "diary.command", command: { kind: "booking.create", commandId: randomUUID(), payload: {
      venueId, spaceId, kind: "internal_block", title: "TEST ONLY maintenance",
      startsAt: "2031-03-04T09:00:00.000Z", endsAt: "2031-03-04T11:00:00.000Z",
    } } };
  }

  async function blocks(spaceId: string): Promise<number> {
    return (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.spaceId, spaceId))).length;
  }

  it("applies a staff member's Diary command while they are who they connected as", async () => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await diarySocket(staff.token);
    client.send(blockCommand(f.venueId, f.spaceId));
    const ack = await client.next("diary.ack");
    expect(ack.outcome, JSON.stringify(ack)).toBe("applied");
    expect(await blocks(f.spaceId)).toBe(1);
  });

  it.each(["offboarded", "moved", "demoted to hallkeeper"] as const)("refuses a Diary command from a %s person's open screen and ends it", async (how) => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await diarySocket(staff.token);
    if (how === "demoted to hallkeeper") {
      // Still a diary reader, but no longer what it connected as.
      await db.update(schema.users).set({ role: "hallkeeper" }).where(eq(schema.users.id, staff.id));
    } else {
      await change(staff.id, how, f.otherVenueId);
    }

    client.send(blockCommand(f.venueId, f.spaceId));
    expect(await client.next("diary.ack")).toMatchObject({ outcome: "rejected", status: 403, code: "FORBIDDEN" });
    expect(await client.next("error")).toMatchObject({ code: "FORBIDDEN" });
    await client.closed();
    expect(await blocks(f.spaceId)).toBe(0);
  });

  it("refuses a conversation command from an offboarded person's open screen", async () => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await diarySocket(staff.token);
    await change(staff.id, "offboarded", f.otherVenueId);
    client.send({ type: "conversation.command", command: { kind: "message.send", commandId: randomUUID(),
      threadId: randomUUID(), payload: { body: "TEST ONLY", idempotencyKey: randomUUID() } } });
    expect(await client.next("conversation.ack")).toMatchObject({ outcome: "rejected", status: 403, code: "FORBIDDEN" });
    await client.closed();
  });

  it("the heartbeat's re-check ends a moved person's listening screen and keeps a colleague's", async () => {
    const f = await venueWithLayout();
    const moved = await person(f.venueId, "staff");
    const stays = await person(f.venueId, "hallkeeper");
    const movedClient = await diarySocket(moved.token);
    const staysClient = await diarySocket(stays.token);
    await change(moved.id, "moved", f.otherVenueId);

    // The registered hub is private to the route; the same re-check runs on
    // a hub holding this test's own connections.
    const hub = new DiaryLiveHub();
    const closedHere: string[] = [];
    hub.join(f.venueId, { send: () => undefined, close: () => { closedHere.push(moved.id); } },
      { userId: moved.id, name: "Moved", role: "staff", platformRole: "none" }, Date.now(), { clerkId: moved.clerkId });
    hub.join(f.venueId, { send: () => undefined, close: () => { closedHere.push(stays.id); } },
      { userId: stays.id, name: "Stays", role: "hallkeeper", platformRole: "none" }, Date.now(), { clerkId: stays.clerkId });
    expect(await recheckDiaryConnections(db, hub)).toBe(1);
    expect(closedHere).toEqual([moved.id]);
    expect(hub.connectionCount(f.venueId)).toBe(1);

    // And the moved person's real screen is refused at its next command.
    movedClient.send(blockCommand(f.venueId, f.spaceId));
    expect(await movedClient.next("diary.ack")).toMatchObject({ status: 403 });
    staysClient.send({ type: "ping" });
    expect(await staysClient.next("pong")).toMatchObject({ type: "pong" });
  });

  it("keeps a seeded person with no Clerk account at work on both sockets and in the live room", async () => {
    const f = await venueWithLayout();
    const seeded = await seededPerson(f.venueId, "staff");
    const layout = await autoSaveSocket(f.configId, seeded.token);
    layout.send({ type: "delete_object", expectedRevision: 5, objectId: f.objectId });
    layout.send({ type: "flush" });
    expect(await layout.next("error")).toMatchObject({ code: "REVISION_CONFLICT" });

    const diary = await diarySocket(seeded.token);
    diary.send(blockCommand(f.venueId, f.spaceId));
    expect(await diary.next("diary.ack")).toMatchObject({ outcome: "applied" });

    const hub = new LayoutLiveHub();
    hub.join(f.configId, { send: () => undefined, close: () => undefined }, { userId: seeded.id, name: "Seeded", role: "staff" });
    expect(await revalidateLayoutLiveRooms(db, hub)).toBe(0);
  });

  it("the layout room's re-check ends an offboarded person's membership and keeps a colleague's", async () => {
    const f = await venueWithLayout();
    const leaving = await person(f.venueId, "staff");
    const stays = await person(f.venueId, "staff");
    const hub = new LayoutLiveHub();
    const revokedHere: string[] = [];
    for (const who of [leaving, stays]) {
      hub.join(f.configId, { send: (text: string) => { if (text.includes("live.revoked")) revokedHere.push(who.id); }, close: () => undefined },
        { userId: who.id, name: "Member", role: "staff" }, who.clerkId);
    }
    await change(leaving.id, "offboarded", f.otherVenueId);
    expect(await revalidateLayoutLiveRooms(db, hub)).toBe(1);
    expect(revokedHere).toEqual([leaving.id]);
  });

  it("a Clerk account the webhook deleted never links its row again, so its open screen cannot come back", async () => {
    const f = await venueWithLayout();
    const staff = await person(f.venueId, "staff");
    const client = await diarySocket(staff.token);
    const identity = { userId: staff.id, clerkId: staff.clerkId };

    await processClerkWebhookEvent({ type: "user.deleted", data: { id: staff.clerkId } }, databasePersistence(db));
    expect(await readCurrentSocketUser(db, identity, { lock: false })).toBeNull();
    client.send(blockCommand(f.venueId, f.spaceId));
    expect(await client.next("diary.ack")).toMatchObject({ outcome: "rejected", status: 403 });
    await client.closed();

    // The screen reconnects with a token Clerk issued before the deletion:
    // the sign-in that token carries links nothing, and the row stays unlinked.
    expect(await getUserByClerkId(db, staff.clerkId, staff.email)).toBeNull();
    const [row] = await db.select({ clerkId: schema.users.clerkId }).from(schema.users).where(eq(schema.users.id, staff.id));
    expect(row).toEqual({ clerkId: null });
    expect(await readCurrentSocketUser(db, identity, { lock: false })).toBeNull();

    // A repeated delivery of the webhook records the deletion once.
    await processClerkWebhookEvent({ type: "user.deleted", data: { id: staff.clerkId } }, databasePersistence(db));
    const records = await db.select({ id: schema.generalAuditLog.id }).from(schema.generalAuditLog)
      .where(eq(schema.generalAuditLog.targetId, staff.clerkId));
    expect(records).toHaveLength(1);
  });

  /** Waits until this many sessions of this pool wait on a lock, or `done` says to stop. */
  async function lockWaiters(count: number, done: () => boolean = () => false): Promise<void> {
    for (let attempt = 0; !done(); attempt += 1) {
      const { rows } = await pool.query<{ waiting: number }>(
        "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName]);
      if ((rows[0]?.waiting ?? 0) >= count) return;
      if (attempt >= 400) throw new Error(`${String(count)} sessions never waited at once`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("a first sign-in racing the account's deletion waits for it, and links nothing", async () => {
    const f = await venueWithLayout();
    // A row the account was never linked to, as an invited person's is.
    const id = randomUUID(), email = `${id}@socket.invalid`, clerkId = `user_${randomUUID()}`;
    await db.insert(schema.users).values({ id, clerkId: null, venueId: f.venueId, name: "Never linked", email, role: "staff" });
    const holder = await pool.connect();
    try {
      // Pause the real webhook between its unlink and its commit: it waits to
      // write the deletion record, holding the account's lock.
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE general_audit_log IN SHARE MODE");
      const deleting = processClerkWebhookEvent({ type: "user.deleted", data: { id: clerkId } }, databasePersistence(db));
      await lockWaiters(1);
      const signingIn = getUserByClerkId(db, clerkId, email);
      let answered = false;
      void signingIn.finally(() => { answered = true; });
      await lockWaiters(2, () => answered);
      expect(answered, "the sign-in answered without waiting for the deletion under way").toBe(false);
      await holder.query("ROLLBACK");
      await deleting;
      expect(await signingIn).toBeNull();
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
    const [row] = await db.select({ clerkId: schema.users.clerkId }).from(schema.users).where(eq(schema.users.id, id));
    expect(row).toEqual({ clerkId: null });
  });

  it("ends a connection older than the maximum age however busy it is", () => {
    const hub = new DiaryLiveHub(() => 0);
    let closed = 0;
    const connection = hub.join("venue", { send: () => undefined, close: () => { closed += 1; } },
      { userId: "u", name: "Busy", role: "staff" }, 0);
    hub.touch(connection, MAX_CONNECTION_AGE_MS);
    expect(hub.sweepStale(MAX_CONNECTION_AGE_MS, 65_000, MAX_CONNECTION_AGE_MS)).toBe(0);
    hub.touch(connection, MAX_CONNECTION_AGE_MS + 1);
    expect(hub.sweepStale(MAX_CONNECTION_AGE_MS + 1, 65_000, MAX_CONNECTION_AGE_MS)).toBe(1);
    expect(closed).toBe(1);
  });
});

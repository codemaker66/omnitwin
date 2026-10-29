import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LAYOUT_STYLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { clientConversationRoutes, threadRoutes } from "../routes/conversations.js";
import { createRequestCore, type RequestActor } from "../services/requests.js";

// ---------------------------------------------------------------------------
// "A reply to your request" reaches the requester's devices when the reply
// comes in over REST, as the web sends it, and not only over the socket's
// command path (supplier-requests-3). The routes run as the app mounts them;
// the push service is the web-push module, mocked, with the VAPID keys set,
// so the real trigger path writes its push_sends rows.
//
// Never loads .env and never falls back to DATABASE_URL.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const { sendNotification } = vi.hoisted(() => ({
  sendNotification: vi.fn((_subscription: unknown, _payload: string) => Promise.resolve({ statusCode: 201 })),
}));
vi.mock("web-push", () => ({ default: { sendNotification } }));

const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Reply push tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

describe.skipIf(target === undefined)("the reply push over REST, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `reply_push_${randomUUID()}`, max: 6, options: "-c statement_timeout=10000" });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    vi.stubEnv("VAPID_SUBJECT", "mailto:push@example.test");
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
    server = Fastify();
    await server.register(threadRoutes, { db, prefix: "/threads" });
    await server.register(clientConversationRoutes, { db, prefix: "/events" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  interface Person { readonly id: string; readonly name: string; readonly role: string; readonly venueId: string | null }

  async function fixture() {
    const venueId = randomUUID();
    const roomId = randomUUID();
    const eventId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY reply push", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline });
    const people = {
      requester: { id: randomUUID(), name: "Elaine", role: "hallkeeper", venueId },
      manager: { id: randomUUID(), name: "Fiona", role: "manager", venueId },
      client: { id: randomUUID(), name: "Morag", role: "client", venueId: null },
    } satisfies Record<string, Person>;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({ id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@reply.invalid`, role: person.role });
    }
    // Both venue people have a phone; only the requester should ever hear of a reply.
    for (const person of [people.requester, people.manager]) {
      await db.insert(schema.pushSubscriptions).values({
        userId: person.id, venueId, endpoint: `https://push.example.test/${person.id}`, p256dh: "k", auth: "a", deviceKind: "phone",
      });
    }
    await db.insert(schema.events).values({ id: eventId, venueId, name: "Fixture event", createdBy: people.manager.id });
    const configurationId = randomUUID();
    await db.insert(schema.configurations).values({ id: configurationId, spaceId: roomId, venueId, userId: people.client.id, name: "The client's plan", layoutStyle: LAYOUT_STYLES[0] });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId, linkType: "source_configuration" });

    const actor: RequestActor = { ...people.requester, platformRole: "none" };
    const made = await createRequestCore(db, actor, venueId, {
      roomId, bookingId: null, eventId: null, kind: "refreshments", quantity: 6, urgency: "soon",
      detail: "Six more jugs of water, please.", idempotencyKey: randomUUID(),
    });
    if (!("request" in made) || made.request.threadId === null) throw new Error("expected a request with its thread");
    return { venueId, eventId, people, requestThreadId: made.request.threadId };
  }

  function bearer(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@reply.invalid`, name: person.name, role: person.role, venueId: person.venueId })}` };
  }

  async function post(url: string, person: Person, body: string, key = randomUUID()): Promise<{ statusCode: number; messageId: string }> {
    const res = await server.inject({ method: "POST", url, headers: { ...bearer(person), "idempotency-key": key }, payload: { body } });
    const parsed = JSON.parse(res.body) as { data?: { id: string } };
    return { statusCode: res.statusCode, messageId: parsed.data?.id ?? "" };
  }

  async function replyPushes(venueId: string): Promise<readonly { endpoint: string; key: string }[]> {
    const { rows } = await pool.query<{ endpoint: string; key: string }>(
      `SELECT s.endpoint, p.idempotency_key AS key FROM push_sends p JOIN push_subscriptions s ON s.id = p.subscription_id
       WHERE s.venue_id = $1 AND p.event = 'request.replied' ORDER BY p.created_at, p.idempotency_key`, [venueId]);
    return rows;
  }

  /** Wait for `count` reply pushes, then a moment longer, so a push that
   *  should not have happened has had its chance to land. */
  async function settled(venueId: string, count: number): Promise<readonly { endpoint: string; key: string }[]> {
    await vi.waitFor(async () => { expect((await replyPushes(venueId)).length).toBeGreaterThanOrEqual(count); }, { timeout: 5_000, interval: 25 });
    await new Promise((done) => setTimeout(done, 150));
    return replyPushes(venueId);
  }

  it("tells the requester once of a manager's reply on the request's thread; a replay, their own words and another thread tell nobody", async () => {
    const f = await fixture();
    const requesterPhone = `https://push.example.test/${f.people.requester.id}`;
    const url = `/threads/${f.requestThreadId}/messages`;

    // (a) A manager replies over REST: one push, to the requester only.
    const key = randomUUID();
    const reply = await post(url, f.people.manager, "Two jugs are on their way.", key);
    expect(reply.statusCode).toBe(201);
    expect(await settled(f.venueId, 1)).toEqual([{ endpoint: requesterPhone, key: expect.stringContaining(reply.messageId) as string }]);
    const told = sendNotification.mock.calls.find(([, payload]) => payload.includes("Two jugs"));
    expect(JSON.parse(told?.[1] ?? "{}")).toMatchObject({ event: "request.replied", title: "Fiona replied", body: "Two jugs are on their way." });

    // (b) The same send replayed: answered from the ledger, nobody told again.
    const replay = await post(url, f.people.manager, "Two jugs are on their way.", key);
    expect(replay.statusCode).toBe(200);
    // (c) The requester's own message on the thread.
    expect((await post(url, f.people.requester, "Thank you.")).statusCode).toBe(201);
    // (d) A thread that answers no request: the event's own conversation,
    // (e) which is also the event conversation route's only thread.
    expect((await post(`/events/${f.eventId}/conversation/messages`, f.people.manager, "The menu is confirmed.")).statusCode).toBe(201);
    expect((await post(`/events/${f.eventId}/conversation/messages`, f.people.client, "Lovely, thank you.")).statusCode).toBe(201);

    // A second real reply, to know the earlier ones have had their chance.
    const second = await post(url, f.people.manager, "And glasses.");
    expect(second.statusCode).toBe(201);
    const pushes = await settled(f.venueId, 2);
    expect(pushes.map((push) => push.endpoint)).toEqual([requesterPhone, requesterPhone]);
    expect(pushes[1]?.key).toContain(second.messageId);
  });
});

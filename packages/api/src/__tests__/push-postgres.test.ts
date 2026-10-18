import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { VenueRequest } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { sendPush, type PushSendOptions, type PushSender, type PushSubscriptionKeys } from "../services/push.js";
import { pushForReply, pushForRequestEscalated, pushForRequestLanded } from "../services/push-triggers.js";

// ---------------------------------------------------------------------------
// Web push on isolated PostgreSQL (goal 19 S7): every send a recorded fact,
// one per device per event, the three triggers addressed as D8 says, and a
// gone subscription disabled rather than retried. The push service is
// injected; no network. Opt-in; never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_PUSH_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_push_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Push tests require their explicit isolated loopback database");
  }
}

const VENUE = "79797979-7979-4797-8797-797979797901";
const ROOM = "79797979-7979-4797-8797-797979797902";
const REQUESTER = "79797979-7979-4797-8797-797979797911";
const ADMIN = "79797979-7979-4797-8797-797979797912";
const STAFF = "79797979-7979-4797-8797-797979797913";
const REQUEST = "79797979-7979-4797-8797-797979797921";

interface Call { readonly endpoint: string; readonly payload: Record<string, unknown>; readonly options: PushSendOptions }

function fakeSender(failing: Record<string, number> = {}): { readonly send: PushSender; readonly calls: Call[] } {
  const calls: Call[] = [];
  const send: PushSender = (subscription: PushSubscriptionKeys, payload: string, options: PushSendOptions) => {
    calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) as Record<string, unknown>, options });
    const statusCode = failing[subscription.endpoint];
    if (statusCode !== undefined) return Promise.reject(Object.assign(new Error("Received unexpected response code"), { statusCode }));
    return Promise.resolve({ statusCode: 201 });
  };
  return { send, calls };
}

function requestFixture(over: Partial<VenueRequest> = {}): VenueRequest {
  const at = "2026-10-17T10:00:00.000Z";
  return {
    id: REQUEST, venueId: VENUE, bookingId: null, eventId: null, roomId: ROOM, roomName: "Grand Hall",
    kind: "refreshments", quantity: 6, urgency: "now", detail: null,
    requestedByUserId: REQUESTER, requestedByName: "Elaine", requestedByRole: "hallkeeper",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"],
    ownerUserId: null, ownerName: null, state: "sent", outcome: null, outcomeNote: null,
    escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null, resolvedAt: null,
    threadId: null, handoverToUserId: null, handoverToName: null, handedOverAt: null, handoverDueAt: null,
    underwayAt: null, reopenedAt: null, createdAt: at, updatedAt: at,
    ...over,
  };
}

describe.skipIf(testUrl === undefined)("web push (0092)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const endpoints = { admin: "https://push.example.test/admin-phone", staff: "https://push.example.test/staff-desk", requester: "https://push.example.test/requester-phone" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: `push_${randomUUID().slice(0, 8)}`, max: 4 });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Push venue', 's7-push', 'nowhere') ON CONFLICT (id) DO NOTHING", [VENUE]);
    await pool.query(
      "INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline) VALUES ($1, $2, 'Grand Hall', 'grand-hall', 21, 10, 7, '[]'::jsonb) ON CONFLICT (id) DO NOTHING",
      [ROOM, VENUE],
    );
    for (const [id, role, name] of [[REQUESTER, "hallkeeper", "Elaine"], [ADMIN, "admin", "Isla"], [STAFF, "staff", "Fiona"]] as const) {
      await pool.query(
        "INSERT INTO users (id, clerk_id, email, name, role, venue_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        [id, `clerk_${id}`, `${id}@push.test`, name, role, VENUE],
      );
    }
  }, 300_000);

  beforeEach(async () => {
    await pool.query("DELETE FROM push_subscriptions WHERE venue_id = $1", [VENUE]);
    await pool.query("DELETE FROM requests WHERE venue_id = $1", [VENUE]);
    for (const [userId, endpoint, kind] of [[ADMIN, endpoints.admin, "phone"], [STAFF, endpoints.staff, "desk"], [REQUESTER, endpoints.requester, "phone"]] as const) {
      await pool.query(
        "INSERT INTO push_subscriptions (user_id, venue_id, endpoint, p256dh, auth, device_kind) VALUES ($1, $2, $3, 'k', 'a', $4)",
        [userId, VENUE, endpoint, kind],
      );
    }
  });

  afterEach(() => {
    delete process.env["VAPID_PUBLIC_KEY"];
    delete process.env["VAPID_PRIVATE_KEY"];
    delete process.env["VAPID_SUBJECT"];
  });

  afterAll(async () => {
    await pool.query("DELETE FROM push_subscriptions WHERE venue_id = $1", [VENUE]);
    await pool.query("DELETE FROM requests WHERE venue_id = $1", [VENUE]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [REQUESTER, ADMIN, STAFF]);
    await pool.query("DELETE FROM spaces WHERE id = $1", [ROOM]);
    await pool.query("DELETE FROM venues WHERE id = $1", [VENUE]);
    await pool.end();
  });

  async function sends(): Promise<readonly { endpoint: string; event: string; status: string; status_code: number | null }[]> {
    const { rows } = await pool.query<{ endpoint: string; event: string; status: string; status_code: number | null }>(
      `SELECT s.endpoint, p.event, p.status, p.status_code FROM push_sends p JOIN push_subscriptions s ON s.id = p.subscription_id
       WHERE s.venue_id = $1 ORDER BY s.endpoint, p.created_at`, [VENUE],
    );
    return rows;
  }

  it("is off without the VAPID keys: nothing sent, nothing recorded", async () => {
    const records = await sendPush(db, { venueId: VENUE, userIds: [ADMIN], event: "request.landed", title: "t", body: "b", url: "/", tag: "x", idempotencyKeyBase: "push:test:off" });
    expect(records).toEqual([]);
    expect(await sends()).toEqual([]);
  });

  it("a request landed tells the audience's devices, never the one who asked, and only once", async () => {
    const sender = fakeSender();
    const first = await pushForRequestLanded(db, requestFixture(), { send: sender.send });
    expect(first.map((record) => [record.userId, record.status]).sort()).toEqual([[ADMIN, "sent"], [STAFF, "sent"]].sort());
    expect(sender.calls.map((call) => call.endpoint).sort()).toEqual([endpoints.admin, endpoints.staff].sort());
    expect(sender.calls[0]?.payload).toEqual({ event: "request.landed", title: "Refreshments × 6 · Grand Hall", body: "Elaine asked, Grand Hall.", url: "/hallkeeper/today", tag: `request:${REQUEST}` });
    expect(sender.calls[0]?.options).toEqual({ ttlSeconds: 300, urgency: "normal" });

    const again = await pushForRequestLanded(db, requestFixture(), { send: sender.send });
    expect(again).toEqual([]);
    expect(sender.calls).toHaveLength(2);
    expect((await sends()).map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  it("a gone subscription is disabled and never tried again; a failure is recorded and tried next time", async () => {
    const sender = fakeSender({ [endpoints.staff]: 410, [endpoints.admin]: 503 });
    const records = await pushForRequestEscalated(db, requestFixture(), [ADMIN, STAFF], { send: sender.send });
    expect(records.map((record) => [record.userId, record.status, record.statusCode]).sort()).toEqual([[ADMIN, "failed", 503], [STAFF, "gone", 410]].sort());
    expect(sender.calls.every((call) => call.options.urgency === "high")).toBe(true);
    const [staffRow] = await db.select({ disabledAt: schema.pushSubscriptions.disabledAt }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoints.staff));
    expect(staffRow?.disabledAt).not.toBeNull();

    const healthy = fakeSender();
    const next = await pushForRequestEscalated(db, requestFixture({ id: "79797979-7979-4797-8797-797979797922" }), [ADMIN, STAFF], { send: healthy.send });
    expect(next.map((record) => record.userId)).toEqual([ADMIN]);
  });

  it("a reply tells the person who raised the request, never the author of the reply", async () => {
    await pool.query(
      `INSERT INTO requests (id, venue_id, room_id, kind, quantity, urgency, requested_by_user_id, requested_by_name, requested_by_role, audience_roles, state, idempotency_key)
       VALUES ($1, $2, $3, 'refreshments', 6, 'now', $4, 'Elaine', 'hallkeeper', '["admin","staff","hallkeeper"]'::jsonb, 'sent', $5)`,
      [REQUEST, VENUE, ROOM, REQUESTER, randomUUID()],
    );
    const sender = fakeSender();
    const told = await pushForReply(db, { requestId: REQUEST, messageId: "m-1", authorUserId: STAFF, authorName: "Fiona", body: "On its way." }, { send: sender.send });
    expect(told.map((record) => record.userId)).toEqual([REQUESTER]);
    expect(sender.calls[0]?.payload).toEqual({ event: "request.replied", title: "Fiona replied", body: "On its way.", url: "/hallkeeper/today", tag: `request:${REQUEST}:reply` });

    const own = await pushForReply(db, { requestId: REQUEST, messageId: "m-2", authorUserId: REQUESTER, authorName: "Elaine", body: "Thanks." }, { send: sender.send });
    expect(own).toEqual([]);
    expect(sender.calls).toHaveLength(1);
  });
});

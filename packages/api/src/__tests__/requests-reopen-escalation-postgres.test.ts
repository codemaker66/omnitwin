import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYOUT_STYLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { planNextWake } from "../services/escalation-scheduler.js";
import {
  createClientRequestCore,
  requestEscalationEmailKey,
  runRequestEscalationPass,
  selectDueRequestEscalations,
  transitionRequestCore,
  type RequestActor,
  type RequestDeny,
} from "../services/requests.js";

// ---------------------------------------------------------------------------
// A reopened request escalates again (supplier-requests-2): it has no owner,
// so it gets the venue's window from the reopen, the earlier escalation is
// spent, and its escalation is emailed under its own key.
//
// Never loads .env and never falls back to DATABASE_URL. The target is the
// explicitly named disposable cluster the request tests use.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Request tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

function granted<T>(result: T | RequestDeny): Exclude<T, RequestDeny> {
  if (typeof result === "object" && result !== null && "ok" in result && (result as { ok: unknown }).ok === false) {
    const deny = result;
    throw new Error(`expected success, got ${deny.code}: ${deny.error}`);
  }
  return result as Exclude<T, RequestDeny>;
}

describe.skipIf(target === undefined)("a reopened request on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `reopen_${randomUUID()}`, max: 6, options: "-c statement_timeout=10000" });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 120_000);

  afterAll(async () => { await pool.end(); });

  async function fixture() {
    const venueId = randomUUID();
    const roomId = randomUUID();
    const eventId = randomUUID();
    const bookingId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY reopen", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline });
    const people = {
      admin: { id: randomUUID(), role: "admin", venueId, name: "The administrator" },
      staff: { id: randomUUID(), role: "staff", venueId, name: "Fiona" },
      hallkeeper: { id: randomUUID(), role: "hallkeeper", venueId, name: "Elaine" },
      client: { id: randomUUID(), role: "client", venueId: null, name: "Morag" },
    } as const;
    for (const person of Object.values(people)) {
      await db.insert(schema.users).values({ id: person.id, venueId: person.venueId, name: person.name, email: `${person.id}@reopen.invalid`, role: person.role });
    }
    await db.insert(schema.events).values({ id: eventId, venueId, name: "Fixture event", createdBy: people.admin.id });
    await db.insert(schema.bookings).values({
      id: bookingId, venueId, spaceId: roomId, eventId, kind: "ink", title: "Fixture booking", createdBy: people.admin.id,
      startsAt: new Date("2030-01-10T10:00:00.000Z"), endsAt: new Date("2030-01-10T12:00:00.000Z"),
    });
    const configurationId = randomUUID();
    await db.insert(schema.configurations).values({ id: configurationId, spaceId: roomId, venueId, userId: people.client.id, name: "The client's plan", layoutStyle: LAYOUT_STYLES[0] });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId, linkType: "source_configuration" });
    await db.insert(schema.venueSettings).values({ venueId, requestEscalationSeconds: 180, escalationSoonSeconds: 120 });
    const actor = (person: { readonly id: string; readonly role: string; readonly venueId: string | null; readonly name: string }): RequestActor => ({
      id: person.id, name: person.name, role: person.role, venueId: person.venueId, platformRole: "none",
    });
    return { venueId, eventId, bookingId, admin: actor(people.admin), staff: actor(people.staff), hallkeeper: actor(people.hallkeeper), client: actor(people.client) };
  }

  it("re-arms a reopened request's escalation: a new window from the reopen, the old escalation spent, its own email (supplier-requests-2)", async () => {
    const resendKey = process.env["RESEND_API_KEY"];
    delete process.env["RESEND_API_KEY"];
    try {
      const f = await fixture();
      const made = granted(await createClientRequestCore(db, f.client, f.eventId, {
        bookingId: f.bookingId, kind: "chairs", quantity: 10, urgency: "soon", detail: "Ten more for the top table, please.", idempotencyKey: randomUUID(),
      }));
      const id = made.request.id;
      // It escalated once while nobody had it, then was taken and finished.
      const earlier = new Date("2026-01-20T12:00:00.000Z");
      await db.update(schema.requests).set({ escalatedAt: earlier, escalationEmailedAt: earlier }).where(eq(schema.requests.id, id));
      granted(await transitionRequestCore(db, f.hallkeeper, id, { to: "accepted" }));
      granted(await transitionRequestCore(db, f.hallkeeper, id, { to: "resolved", outcome: "done" }));

      const reopened = granted(await transitionRequestCore(db, f.client, id, { to: "reopened", note: "Still short of two." })).request;
      expect(reopened.escalatedAt).toBeNull();
      expect(Date.parse(reopened.escalationDueAt ?? "") - Date.parse(reopened.reopenedAt ?? "")).toBe(120_000);
      const [row] = await db.select().from(schema.requests).where(eq(schema.requests.id, id));
      expect(row?.escalationEmailedAt).toBeNull();

      // The sweep plans a wake for it. (Moved to an instant no other row can
      // precede, so the house-wide plan can only be this request's.)
      const ancient = new Date("2000-01-01T00:00:00.000Z");
      await db.update(schema.requests).set({ escalationDueAt: ancient }).where(eq(schema.requests.id, id));
      expect(await planNextWake(db, Date.now())).toBe(ancient.getTime());

      // Past its window, at a midday outside quiet hours: it escalates as
      // nobody's, with an email of its own beside the first escalation's.
      const noon = new Date("2026-01-21T12:00:00.000Z");
      await db.update(schema.requests).set({ escalationDueAt: new Date(noon.getTime() - 1000) }).where(eq(schema.requests.id, id));
      const escalated = (await runRequestEscalationPass(db, { now: noon })).filter((item) => item.request.id === id);
      expect(escalated.map((item) => [item.reason, item.emailedAdmins])).toEqual([["unowned", 1]]);
      const keys = await pool.query<{ idempotency_key: string }>("SELECT idempotency_key FROM email_sends WHERE idempotency_key LIKE $1", [`request-escalation:${id}:%`]);
      expect(keys.rows.map((key) => key.idempotency_key)).toEqual([requestEscalationEmailKey(id, noon, f.admin.id)]);
      const [inbox] = await db.select({ body: schema.eventPlanNotifications.body }).from(schema.eventPlanNotifications)
        .where(eq(schema.eventPlanNotifications.recipientUserId, f.admin.id));
      expect(inbox?.body).toBe("Morag's request was reopened and nobody has picked it up yet.");

      // Taken after the reopen: nothing more is due for it.
      granted(await transitionRequestCore(db, f.staff, id, { to: "accepted" }));
      const [taken] = await db.select().from(schema.requests).where(eq(schema.requests.id, id));
      if (taken === undefined) throw new Error("expected the request");
      expect(selectDueRequestEscalations([{ ...taken, escalatedAt: null }], new Date(noon.getTime() + 60_000))).toEqual([]);
    } finally {
      if (resendKey !== undefined) process.env["RESEND_API_KEY"] = resendKey;
    }
  });
});

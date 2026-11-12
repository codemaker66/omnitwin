import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { __resetResendClientForTests } from "../services/email.js";

// ---------------------------------------------------------------------------
// What the public enquiry route takes from anyone, and what it sends back
// (whole-repository audit T-695).
//
// POST /public/enquiries needs no account: a guest's plan (the planner path)
// or a venue's slug (the website and the walkthrough) says where the enquiry
// goes. A venue that has been deleted takes no enquiry on either path, and no
// new guest plan in its rooms (public-surface-7).
//
// The routes run on the migrated database with the real email service; only
// the provider's client is replaced, so a test reads exactly what would have
// been handed to Resend. The in-app notice is mocked, as in
// people-enquiry-link-postgres.test.ts.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

/** One message as the email service hands it to the provider. */
interface HandedToProvider {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

const handed = vi.hoisted((): HandedToProvider[] => []);

vi.mock("resend", () => ({
  Resend: class {
    readonly emails = {
      send: (message: HandedToProvider) => {
        handed.push(message);
        return Promise.resolve({ data: { id: `test-only-${String(handed.length)}` }, error: null });
      },
    };
  },
}));
vi.mock("../services/commercial-notifications.js", () => ({
  notifyCommercialTeam: vi.fn().mockResolvedValue(0),
}));

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Public enquiry tests require the explicit disposable platform database");
  }
}

/** The environment this suite sets, restored afterwards. */
const SET_HERE = ["TWIN_PUBLIC_VENUE_SLUGS", "RESEND_API_KEY", "ENQUIRY_FALLBACK_EMAIL"] as const;

describe.skipIf(target === undefined)("the public enquiry route on the migrated disposable database", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const liveVenue = randomUUID();
  const closedVenue = randomUUID();
  const liveRoom = randomUUID();
  const closedRoom = randomUUID();
  const venues: readonly string[] = [liveVenue, closedVenue];
  // Guest leads and people are found by email, so each address is this run's own.
  const run = randomUUID().slice(0, 8);
  const saved = new Map(SET_HERE.map((name) => [name, process.env[name]]));

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target, application_name: `public_enquiry_intake_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000",
    });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    await pool.query(
      `INSERT INTO venues (id, name, slug, address) VALUES ($1::uuid, 'TEST ONLY Intake Hall', $1::text, 'Test only'),
        ($2::uuid, 'TEST ONLY Closed Hall', $2::text, 'Test only')`,
      [liveVenue, closedVenue],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, $2, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]'), ($3, $4, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]')`,
      [liveRoom, liveVenue, closedRoom, closedVenue],
    );
    // Both venues publish their walkthrough (their slug is their id), so the
    // venue path's own gate lets each through to the lookup.
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = venues.join(",");
    // A test value: the provider's client above is a stand-in, so nothing leaves the process.
    process.env["RESEND_API_KEY"] = "re_test_only_not_a_key";
    delete process.env["ENQUIRY_FALLBACK_EMAIL"];
    __resetResendClientForTests();

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    try {
      // Before the environment goes back: an acknowledgement still on its way
      // would otherwise be recorded, after the clean-up, as never sent.
      if (pool !== undefined) await acknowledgementsSettled();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
      __resetResendClientForTests();
      await server?.close();
    }
    if (pool === undefined) return;
    try {
      // Only this suite's venues, children first. An email's record and a
      // guest lead name no venue, so they go by the enquiry that made them.
      for (const statement of [
        `DELETE FROM email_sends s WHERE EXISTS (SELECT 1 FROM enquiries e
           WHERE e.venue_id = ANY($1::uuid[]) AND s.idempotency_key LIKE 'enquiry-%' || e.id::text || '%')`,
        "DELETE FROM guest_leads WHERE first_enquiry_id IN (SELECT id FROM enquiries WHERE venue_id = ANY($1::uuid[]))",
        "DELETE FROM enquiries WHERE venue_id = ANY($1::uuid[])",
        "UPDATE contacts SET merged_into_id = NULL, client_account_id = NULL WHERE venue_id = ANY($1::uuid[])",
        "UPDATE client_accounts SET merged_into_id = NULL, primary_contact_id = NULL WHERE venue_id = ANY($1::uuid[])",
        "DELETE FROM contacts WHERE venue_id = ANY($1::uuid[])",
        "DELETE FROM client_accounts WHERE venue_id = ANY($1::uuid[])",
        "DELETE FROM configurations WHERE venue_id = ANY($1::uuid[])",
        "DELETE FROM spaces WHERE venue_id = ANY($1::uuid[])",
        "DELETE FROM venues WHERE id = ANY($1::uuid[])",
      ]) {
        await pool.query(statement, [venues]);
      }
    } finally {
      await pool.end();
    }
  }, 60_000);

  /** Every enquiry this suite stored has had its acknowledgement handed over
   *  and recorded (the route queues it after answering). */
  async function acknowledgementsSettled(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM enquiries e WHERE e.venue_id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM email_sends s
             WHERE s.idempotency_key = 'enquiry-acknowledged:' || e.id::text AND s.status <> 'pending')`,
        [venues],
      );
      if (rows[0]?.waiting === 0) return;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error("An acknowledgement this suite queued never settled");
  }

  /** A guest's plan, made as the planner makes one. */
  function newPlan(spaceId: string): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
  }

  function enquire(payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: "/public/enquiries", payload });
  }

  function idOf(response: LightMyRequestResponse, key: "id" | "enquiryId"): string {
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json<{ data: Record<string, unknown> }>().data;
    const id = data[key];
    if (typeof id !== "string") throw new Error(`No ${key} in ${response.body}`);
    return id;
  }

  async function enquiriesAt(venueId: string): Promise<number> {
    const { rows } = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM enquiries WHERE venue_id = $1", [venueId]);
    return rows[0]?.count ?? -1;
  }

  it("takes no guest plan and no planner enquiry for a deleted venue, as the venue path takes no enquiry for one", async () => {
    const planId = idOf(await newPlan(closedRoom), "id");
    // Deleted as DELETE /venues/:id deletes a venue: its rooms, and the plans
    // guests made in them, are left as they were.
    await pool.query("UPDATE venues SET deleted_at = now() WHERE id = $1", [closedVenue]);

    const guest = { email: `test-only-closed-${run}@example.test`, name: "TEST ONLY Closed Guest", eventType: "wedding" };
    const fromPlan = await enquire({ configurationId: planId, ...guest });
    const fromWebsite = await enquire({ venueSlug: closedVenue, source: "website", ...guest });
    const anotherPlan = await newPlan(closedRoom);
    expect({ fromPlan: fromPlan.statusCode, fromWebsite: fromWebsite.statusCode, anotherPlan: anotherPlan.statusCode })
      .toEqual({ fromPlan: 404, fromWebsite: 404, anotherPlan: 404 });
    expect(await enquiriesAt(closedVenue)).toBe(0);

    // A live venue's guest plan still files its enquiry, from the planner, in its room.
    const livePlan = idOf(await newPlan(liveRoom), "id");
    const enquiryId = idOf(await enquire({ configurationId: livePlan, ...guest, email: `test-only-live-${run}@example.test` }), "enquiryId");
    const { rows } = await pool.query<{ venue_id: string; space_id: string; source: string; room_chosen: boolean }>(
      "SELECT venue_id, space_id, source, room_chosen FROM enquiries WHERE id = $1", [enquiryId],
    );
    expect(rows).toEqual([{ venue_id: liveVenue, space_id: liveRoom, source: "planner", room_chosen: true }]);
  });

  it("keeps the enquiry of a guest who gives no name and an email longer than the name column holds", async () => {
    // 230 characters: within the email's 255, past the 200 of enquiries.name.
    const local = `test-only-long-${run}-`;
    const email = `${local}${"x".repeat(230 - local.length - "@example.test".length)}@example.test`;
    expect(email).toHaveLength(230);
    const enquiryId = idOf(await enquire({ venueSlug: liveVenue, source: "website", email, eventType: "wedding" }), "enquiryId");

    // Filed under the email, cut to the column as the person made from it is.
    const { rows } = await pool.query<{ name: string; email: string; guest_email: string; guest_name: string | null; person: string | null }>(
      `SELECT e.name, e.email, e.guest_email, e.guest_name, c.name AS person
         FROM enquiries e LEFT JOIN contacts c ON c.id = e.contact_id WHERE e.id = $1`,
      [enquiryId],
    );
    expect(rows).toEqual([{ name: email.slice(0, 200), email, guest_email: email, guest_name: null, person: email.slice(0, 200) }]);
  });

  it("refuses an event date no calendar has before anything is written, and keeps a real one", async () => {
    const email = `test-only-dates-${run}@example.test`;
    const refused: Record<string, number> = {};
    for (const eventDate of ["2027-02-29", "2027-04-31", "2027-13-01", "2027-00-10", "0000-01-01"]) {
      const response = await enquire({ venueSlug: liveVenue, source: "website", email, eventType: "wedding", eventDate });
      refused[eventDate] = response.statusCode;
      if (response.statusCode === 400) expect(response.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
    }
    expect(refused).toEqual({ "2027-02-29": 400, "2027-04-31": 400, "2027-13-01": 400, "2027-00-10": 400, "0000-01-01": 400 });
    const { rows: none } = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM enquiries WHERE email = $1", [email]);
    expect(none[0]?.count).toBe(0);

    // A leap day that exists is kept exactly.
    const enquiryId = idOf(await enquire({ venueSlug: liveVenue, source: "website", email, eventType: "wedding", eventDate: "2028-02-29" }), "enquiryId");
    const { rows } = await pool.query<{ preferred_date: string }>(
      "SELECT preferred_date::text AS preferred_date FROM enquiries WHERE id = $1", [enquiryId],
    );
    expect(rows).toEqual([{ preferred_date: "2028-02-29" }]);
  });
});

import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRADES_HALL_ASSET_SLUG, TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";

// ---------------------------------------------------------------------------
// The front door's enquiry actually lands (T-616, gate line 4).
//
// The composer on `/` and `/fresh` posts TRADES_HALL_ENQUIRY_VENUE_SLUG to
// POST /public/enquiries. Every other enquiry test in this package runs against
// the mock DATABASE_URL, so the furthest any of them can assert is "not 401" —
// none of them can say the enquiry was STORED. That gap is how the two-slug
// defect survived: the asset slug passed the allowlist gate, 404d on the
// `venues` lookup, and mocked-network tests on both sides still passed, because
// they assert on the value the client sends rather than on whether a row comes
// back.
//
// So this runs the real handler against a real PostgreSQL schema with real NOT
// NULL and foreign-key constraints, and asserts the 201 plus the three rows the
// route promises: the enquiry, its status history and the guest lead. Two
// outbound integrations are mocked, and nothing here claims more about them
// than that the route asked: the email service (the organiser's
// acknowledgement and the hallkeeper's notice), and the in-app notification
// writer, whose own rows enquiries-acknowledgement-postgres.test.ts covers.
//
// It skips unless VENVIEWER_PUBLIC_ENQUIRY_TEST_DATABASE_URL names its own
// explicit disposable loopback database on the platform test cluster's port.
// It never reads DATABASE_URL, never loads .env, and creates and drops its own
// schema, so it cannot reach an ambient or production database by accident.
// ---------------------------------------------------------------------------

const sendEmailAsyncSpy = vi.fn();
vi.mock("../services/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendEmailAsync: (...args: unknown[]) => { sendEmailAsyncSpy(...args); },
  resolveEmailReplyTo: () => null,
}));
const notifyCommercialTeamSpy = vi.fn().mockResolvedValue(2);
vi.mock("../services/commercial-notifications.js", () => ({
  notifyCommercialTeam: (...args: unknown[]): unknown => notifyCommercialTeamSpy(...args),
}));

const databaseUrl = process.env["VENVIEWER_PUBLIC_ENQUIRY_TEST_DATABASE_URL"];
if (databaseUrl !== undefined) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || target.hostname !== "127.0.0.1" || target.port !== "55477"
    || target.pathname !== "/venviewer_public_enquiry_test"
    || target.search !== "" || target.hash !== "") {
    throw new Error("Public enquiry tests require their explicit isolated loopback database");
  }
}

const VENUE = randomUUID();
const FLAGSHIP = randomUUID();
const SECOND_SPACE = randomUUID();
const HALLKEEPER = randomUUID();
const GUEST_EMAIL = "guest@example.test";

describe.skipIf(databaseUrl === undefined)("POST /public/enquiries on isolated PostgreSQL", () => {
  const fixtureSchema = `public_enquiry_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  // The venue path's opt-in gate reads this; pin it to the route's own default
  // so an ambient value cannot turn the 201 into a 404.
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = TRADES_HALL_ENQUIRY_VENUE_SLUG;
    pool = new Pool({
      connectionString: databaseUrl, application_name: fixtureSchema, max: 4,
      options: `-c search_path=${fixtureSchema} -c statement_timeout=30000`,
    });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    await pool.query(await readFile(new URL("./fixtures/public-enquiry-postgres.sql", import.meta.url), "utf8"));
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120000);

  beforeEach(async () => {
    sendEmailAsyncSpy.mockClear();
    notifyCommercialTeamSpy.mockClear();
    await pool.query("TRUNCATE guest_leads, enquiry_status_history, enquiries, configurations, spaces, users, venues CASCADE");
    await pool.query(
      "INSERT INTO venues(id, name, slug, address) VALUES ($1, 'Trades Hall fixture', $2, '85 Glassford Street')",
      [VENUE, TRADES_HALL_ENQUIRY_VENUE_SLUG],
    );
    // Two spaces, deliberately inserted out of order: the route anchors a
    // venue-wide enquiry to the LOWEST sortOrder, not to whichever row the
    // planner happens to hand back first.
    await pool.query(
      "INSERT INTO spaces(id, venue_id, name, slug, sort_order) VALUES ($1, $3, 'The Saloon', 'saloon', 4), ($2, $3, 'The Grand Hall', 'grand-hall', 1)",
      [SECOND_SPACE, FLAGSHIP, VENUE],
    );
    await pool.query(
      "INSERT INTO users(id, email, name, role, venue_id) VALUES ($1, 'hallkeeper@example.test', 'Fixture hallkeeper', 'hallkeeper', $2)",
      [HALLKEEPER, VENUE],
    );
  }, 30000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 30000);

  /** What the website composer (pages/fresh/FreshEnquiry.tsx) posts. */
  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
      source: "website",
      email: GUEST_EMAIL,
      name: "A Fixture Guest",
      phone: "0141 000 0000",
      eventDate: "2027-05-14",
      eventType: "wedding",
      guestCount: 120,
      message: "We are looking at a Saturday in May.",
      ...overrides,
    };
  }

  it("stores the enquiry the front-door composer sends and answers 201", async () => {
    const response = await server.inject({
      method: "POST", url: "/public/enquiries", payload: payload(),
    });
    expect(response.statusCode, response.body).toBe(201);

    const stored = await pool.query<{
      venue_id: string; space_id: string; state: string; email: string;
      estimated_guests: number | null; message: string | null;
    }>("SELECT venue_id, space_id, state, email, estimated_guests, message FROM enquiries");
    expect(stored.rowCount).toBe(1);
    const row = stored.rows[0];
    expect(row?.venue_id).toBe(VENUE);
    // The flagship is the lowest sortOrder, not the first row inserted.
    expect(row?.space_id).toBe(FLAGSHIP);
    expect(row?.state).toBe("submitted");
    expect(row?.email).toBe(GUEST_EMAIL);
    expect(row?.estimated_guests).toBe(120);
    // The visitor's own words, exactly: a website enquiry is not stamped as
    // having come from the walkthrough.
    expect(row?.message).toBe("We are looking at a Saturday in May.");
  });

  it("still marks an enquiry from the walkthrough, which names no source, as the twin's", async () => {
    const { source: _source, ...walkthrough } = payload();
    const response = await server.inject({ method: "POST", url: "/public/enquiries", payload: walkthrough });
    expect(response.statusCode, response.body).toBe(201);
    const stored = await pool.query<{ message: string | null }>("SELECT message FROM enquiries");
    expect(stored.rows[0]?.message).toBe(
      "Sent from the venue's virtual walkthrough (the twin).\n\nWe are looking at a Saturday in May.",
    );
  });

  it("writes the submission into status history and opens a guest lead", async () => {
    const response = await server.inject({
      method: "POST", url: "/public/enquiries", payload: payload(),
    });
    expect(response.statusCode, response.body).toBe(201);

    const history = await pool.query<{ from_status: string; to_status: string; changed_by: string | null }>(
      "SELECT from_status, to_status, changed_by FROM enquiry_status_history",
    );
    expect(history.rowCount).toBe(1);
    expect(history.rows[0]?.from_status).toBe("draft");
    expect(history.rows[0]?.to_status).toBe("submitted");
    // A guest has no user row, so the transition is attributed to nobody
    // rather than to whoever happened to be signed in.
    expect(history.rows[0]?.changed_by).toBeNull();

    const leads = await pool.query<{ email: string; first_enquiry_id: string | null }>(
      "SELECT email, first_enquiry_id FROM guest_leads",
    );
    expect(leads.rowCount).toBe(1);
    expect(leads.rows[0]?.email).toBe(GUEST_EMAIL);
    expect(leads.rows[0]?.first_enquiry_id).not.toBeNull();
  });

  it("keeps one lead for a returning guest and still stores the second enquiry", async () => {
    const first = await server.inject({ method: "POST", url: "/public/enquiries", payload: payload() });
    expect(first.statusCode, first.body).toBe(201);
    const second = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: payload({ phone: "0141 999 9999", message: "Actually, could we look at June?" }),
    });
    expect(second.statusCode, second.body).toBe(201);

    const enquiries = await pool.query("SELECT id FROM enquiries");
    expect(enquiries.rowCount).toBe(2);
    const leads = await pool.query<{ phone: string | null }>("SELECT phone FROM guest_leads");
    expect(leads.rowCount).toBe(1);
    expect(leads.rows[0]?.phone).toBe("0141 999 9999");
  });

  it("404s the asset slug, and stores nothing when it does", async () => {
    // The whole reason the shared constant exists: "trades-hall" is the asset
    // and twin namespace, the `venues.slug` row is "trades-hall-glasgow".
    expect(TRADES_HALL_ASSET_SLUG).not.toBe(TRADES_HALL_ENQUIRY_VENUE_SLUG);
    const response = await server.inject({
      method: "POST", url: "/public/enquiries",
      payload: payload({ venueSlug: TRADES_HALL_ASSET_SLUG }),
    });
    expect(response.statusCode).toBe(404);
    const stored = await pool.query("SELECT id FROM enquiries");
    expect(stored.rowCount).toBe(0);
  });

  it("acknowledges the guest, announces the enquiry to the hallkeeper, and tells the team in the app", async () => {
    const response = await server.inject({
      method: "POST", url: "/public/enquiries", payload: payload(),
    });
    expect(response.statusCode, response.body).toBe(201);
    const { enquiryId } = (JSON.parse(response.body) as { data: { enquiryId: string } }).data;
    // The email service is mocked, so this says only that the route asked for
    // two sends: the venue's acknowledgement to the guest, keyed to the
    // enquiry, and the notice to the venue's hallkeeper, keyed to (enquiry,
    // recipient). Whether an email is deliverable is not something a mock can
    // tell anyone.
    const sends = sendEmailAsyncSpy.mock.calls.map((call) => call as [{ to: string }, { idempotencyKey: string }]);
    expect(sends.map(([message, options]) => [message.to, options.idempotencyKey])).toEqual([
      [GUEST_EMAIL, `enquiry-acknowledged:${enquiryId}`],
      ["hallkeeper@example.test", `enquiry-new:${enquiryId}:${HALLKEEPER}`],
    ]);
    expect(notifyCommercialTeamSpy).toHaveBeenCalledTimes(1);
    expect(notifyCommercialTeamSpy.mock.calls[0]?.[1]).toMatchObject({
      venueId: VENUE, actionPath: "/dashboard?view=enquiries",
    });
  });
});

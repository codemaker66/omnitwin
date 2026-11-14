import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { __resetResendClientForTests } from "../services/email.js";

// ---------------------------------------------------------------------------
// The public forms' hidden trap (Blake, 12 November 2026): "a hit keeps the
// enquiry, suppresses the emails and logs it, never refuses; no third party,
// no cookies."
//
// The walkthrough's, the planner's and the front door's forms send what their
// hidden field holds (`trap`) and how long the form was open before Send
// (`openMs`). The route judges a hit: the field holds anything, or the form
// was open under three seconds. A hit is answered exactly as any kept enquiry
// is, stored as any other, and the venue's team is still told in the app, so
// a real guest caught by mistake is still seen by a person. Neither the
// guest's acknowledgement nor the team's emails go; the acknowledgement is
// recorded as held back ("suppressed"), as the one-a-day limit records one.
// One log line names the enquiry and the trap, and nothing of the guest.
// A page open before this shipped sends neither field and is answered,
// stored and emailed exactly as before.
//
// The route runs on the migrated database with the real email service and
// the real in-app notice; only the mail provider's client is replaced, so a
// test reads exactly what would have been handed to Resend.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

/** One message as the email service hands it to the provider. */
interface HandedToProvider {
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

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Public enquiry trap tests require the explicit disposable platform database");
  }
}

/** The environment this suite sets, restored afterwards. */
const SET_HERE = ["TWIN_PUBLIC_VENUE_SLUGS", "RESEND_API_KEY", "ENQUIRY_FALLBACK_EMAIL"] as const;

/** What the route answers a kept enquiry with, whoever sent it. */
const KEPT = "Your enquiry has been sent to the events team";

interface LogLine {
  readonly level: number;
  readonly msg?: string;
  readonly event?: string;
  readonly enquiryId?: string;
  readonly [field: string]: unknown;
}

describe.skipIf(target === undefined)("the public forms' hidden trap, on the migrated disposable database", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venue = randomUUID();
  const room = randomUUID();
  // Guest leads and people are found by email, so each address is this run's own.
  const run = randomUUID().slice(0, 8);
  const team = `test-only-trap-team-${run}@example.test`;
  const saved = new Map(SET_HERE.map((name) => [name, process.env[name]]));
  const logged: string[] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, max: 4, options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1::uuid, 'TEST ONLY Trap Hall', $1::text, 'Test only')",
      [venue],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, sort_order)
       VALUES ($1, $2, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]', 0)`,
      [room, venue],
    );
    // The venue publishes its walkthrough (its slug is its id), and has no
    // one to email but the fallback address, which is this suite's own.
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = venue;
    process.env["ENQUIRY_FALLBACK_EMAIL"] = team;
    // A test value: the provider's client above is a stand-in, so nothing leaves the process.
    process.env["RESEND_API_KEY"] = "re_test_only_not_a_key";
    __resetResendClientForTests();

    const db = drizzle(pool, { schema });
    server = Fastify({ logger: { level: "info", stream: { write: (line: string) => { logged.push(line); } } } });
    await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    try {
      if (pool !== undefined) await sendsSettled();
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
      // Only this suite's venue, children first. An email's record and a
      // guest lead name no venue, so they go by the enquiry that made them.
      for (const statement of [
        `DELETE FROM email_sends s WHERE EXISTS (SELECT 1 FROM enquiries e
           WHERE e.venue_id = $1::uuid AND s.idempotency_key LIKE 'enquiry-%' || e.id::text || '%')`,
        "DELETE FROM guest_leads WHERE first_enquiry_id IN (SELECT id FROM enquiries WHERE venue_id = $1::uuid)",
        "DELETE FROM event_plan_notifications WHERE venue_id = $1::uuid",
        "DELETE FROM enquiries WHERE venue_id = $1::uuid",
        "UPDATE contacts SET merged_into_id = NULL, client_account_id = NULL WHERE venue_id = $1::uuid",
        "UPDATE client_accounts SET merged_into_id = NULL, primary_contact_id = NULL WHERE venue_id = $1::uuid",
        "DELETE FROM contacts WHERE venue_id = $1::uuid",
        "DELETE FROM client_accounts WHERE venue_id = $1::uuid",
        "DELETE FROM spaces WHERE venue_id = $1::uuid",
        "DELETE FROM venues WHERE id = $1::uuid",
      ]) {
        await pool.query(statement, [venue]);
      }
    } finally {
      await pool.end();
    }
  }, 60_000);

  /** Every email this suite's enquiries queued has been decided and recorded
   *  (the route queues them after answering). */
  async function sendsSettled(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM email_sends s JOIN enquiries e
           ON s.idempotency_key LIKE 'enquiry-%' || e.id::text || '%'
         WHERE e.venue_id = $1::uuid AND s.status = 'pending'`,
        [venue],
      );
      if (rows[0]?.waiting === 0) return;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error("An email this suite queued never settled");
  }

  /** What a guest fills in on the front door, as the form posts it. */
  function asked(label: string): Record<string, unknown> {
    return {
      venueSlug: venue,
      source: "website",
      email: `test-only-trap-${label}-${run}@example.test`,
      name: `TEST ONLY ${label} Guest`,
      phone: "0141 000 0000",
      eventType: "wedding",
      eventDate: "2027-06-12",
      guestCount: 80,
      message: `TEST ONLY ${label}: a Saturday in June`,
    };
  }

  function enquire(payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url: "/public/enquiries", payload });
  }

  function enquiryIdOf(response: LightMyRequestResponse): string {
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json<{ data: { enquiryId?: unknown } }>().data.enquiryId;
    if (typeof id !== "string") throw new Error(`No enquiryId in ${response.body}`);
    return id;
  }

  /** The answer with its enquiry's id taken out: what every kept enquiry is told. */
  function answerOf(response: LightMyRequestResponse): unknown {
    const body = response.json<{ data: Record<string, unknown> }>();
    return { status: response.statusCode, type: response.headers["content-type"], data: { ...body.data, enquiryId: "(its id)" } };
  }

  /** What the enquiry desk holds for an enquiry. */
  async function stored(enquiryId: string): Promise<Record<string, unknown> | undefined> {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT venue_id, state, email, guest_name, guest_phone, preferred_date::text AS preferred_date,
              estimated_guests, event_type, message, source FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    return rows[0];
  }

  /** The in-app notices the venue's team got about this guest, by role. */
  async function noticesAbout(guestName: string): Promise<{ audience_role: string; title: string; body: string }[]> {
    const { rows } = await pool.query<{ audience_role: string; title: string; body: string }>(
      "SELECT audience_role, title, body FROM event_plan_notifications WHERE venue_id = $1 AND body LIKE $2 || '%' ORDER BY audience_role",
      [venue, guestName],
    );
    return rows;
  }

  /** What became of each email the route recorded for an enquiry, once all are decided. */
  async function emailsOf(enquiryId: string): Promise<Record<string, string>> {
    await sendsSettled();
    // A send is queued on the next turn after the answer: give one that was
    // queued time to be recorded before reading that none was.
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    await sendsSettled();
    const { rows } = await pool.query<{ idempotency_key: string; status: string }>(
      "SELECT idempotency_key, status FROM email_sends WHERE idempotency_key LIKE 'enquiry-%' || $1 || '%' ORDER BY idempotency_key",
      [enquiryId],
    );
    return Object.fromEntries(rows.map((row) => [row.idempotency_key.replace(enquiryId, "(id)"), row.status]));
  }

  function handedCount(address: string): number {
    return handed.filter((each) => each.to.toLowerCase() === address.toLowerCase()).length;
  }

  /** Every message handed to the provider that is to this guest or names them (the team's email gives their address). */
  function handedAbout(address: string): HandedToProvider[] {
    return handed.filter((each) => each.to.toLowerCase() === address.toLowerCase() || each.html.includes(address));
  }

  function logLines(): LogLine[] {
    return logged.map((line) => JSON.parse(line) as LogLine);
  }

  /** The guest's own words and details, none of which a log may hold. */
  function personal(payload: Record<string, unknown>): string[] {
    return ["email", "name", "phone", "message"].map((field) => String(payload[field]).toLowerCase());
  }

  it.each([
    ["the hidden field holds anything", "field", { trap: "https://example.test/offer", openMs: 41_000 }, "field", 41_000],
    ["the form was open under three seconds", "time", { trap: "", openMs: 2999 }, "time", 2999],
    ["both", "both", { trap: "x", openMs: 40 }, "field and time", 40],
  ] as const)("keeps an enquiry that hit the trap (%s), answers it as any other, tells the team in the app and emails nobody", async (_case, label, trapped, hit, openMs) => {
    const control = enquiryIdOf(await enquire(asked(`${label}-control`)));
    const payload = { ...asked(label), ...trapped };
    const response = await enquire(payload);
    const enquiryId = enquiryIdOf(response);

    // The same answer as any kept enquiry: nothing tells a script it was caught.
    expect(answerOf(response)).toEqual(answerOf(await enquire(asked(`${label}-second-control`))));
    expect(answerOf(response)).toEqual({ status: 201, type: "application/json; charset=utf-8", data: { enquiryId: "(its id)", message: KEPT } });

    // Stored as today.
    expect(await stored(enquiryId)).toEqual({
      venue_id: venue, state: "submitted", email: payload.email, guest_name: payload.name, guest_phone: "0141 000 0000",
      preferred_date: "2027-06-12", estimated_guests: 80, event_type: "wedding", message: payload.message, source: "website",
    });

    // The team is still told in the app, in the words any enquiry gets.
    const notices = await noticesAbout(String(payload.name));
    expect(notices.map((notice) => notice.audience_role)).toEqual(["admin", "manager", "sales", "staff"]);
    for (const notice of notices) {
      expect(notice).toMatchObject({
        title: "New enquiry",
        body: `${String(payload.name)} enquired from the website for a wedding on 2027-06-12, without choosing a room. Open Enquiries to respond.`,
      });
    }

    // Neither the guest's acknowledgement nor the team's email goes. The
    // acknowledgement is recorded as held back; the team's is never queued.
    expect(await emailsOf(enquiryId)).toEqual({ "enquiry-acknowledged:(id)": "suppressed" });
    expect(handedAbout(String(payload.email))).toEqual([]);
    // The enquiry before it was acknowledged and emailed to the team as usual.
    expect(await emailsOf(control)).toEqual({ "enquiry-acknowledged:(id)": "sent", "enquiry-new:(id):fallback": "sent" });
    expect(handedAbout(String(asked(`${label}-control`)["email"])).map((each) => each.to)).toEqual(
      expect.arrayContaining([asked(`${label}-control`)["email"], team]),
    );

    // One line says so: the enquiry, its venue and the trap, nothing of the guest.
    const lines = logLines();
    expect(lines.filter((line) => line.event === "enquiry.trapped" && line.enquiryId === enquiryId)).toEqual([
      expect.objectContaining({
        level: 40, event: "enquiry.trapped", enquiryId, venueId: venue, trap: hit, openMs,
        msg: "enquiry kept and its emails held back: it hit the public form's hidden trap",
      }),
    ]);
    expect(lines.filter((line) => line.event === "enquiry.trapped" && line.enquiryId === control)).toEqual([]);
    const everything = logged.join("\n").toLowerCase();
    for (const value of personal(payload)) expect(everything, "a log line holds the guest's details").not.toContain(value);
  }, 60_000);

  // The web and the API deploy separately: a page already open in a guest's
  // browser posts neither field, and nothing about its enquiry may change.
  it("treats an enquiry with neither field exactly as before: acknowledged, emailed to the team, nothing logged", async () => {
    const payload = asked("absent");
    const enquiryId = enquiryIdOf(await enquire(payload));
    expect(await emailsOf(enquiryId)).toEqual({ "enquiry-acknowledged:(id)": "sent", "enquiry-new:(id):fallback": "sent" });
    expect(handedCount(String(payload.email))).toBe(1);
    expect((await noticesAbout(String(payload.name))).length).toBe(4);
    expect(logLines().filter((line) => line.event === "enquiry.trapped" && line.enquiryId === enquiryId)).toEqual([]);
  }, 60_000);

  it("treats an enquiry whose hidden field is empty and whose form was open three seconds as any other", async () => {
    const payload = { ...asked("fine"), trap: "", openMs: 3000 };
    const enquiryId = enquiryIdOf(await enquire(payload));
    expect(await emailsOf(enquiryId)).toEqual({ "enquiry-acknowledged:(id)": "sent", "enquiry-new:(id):fallback": "sent" });
    expect(handedCount(String(payload.email))).toBe(1);
    expect(logLines().filter((line) => line.event === "enquiry.trapped" && line.enquiryId === enquiryId)).toEqual([]);
  }, 60_000);
});

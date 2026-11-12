import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { notifyCommercialTeam } from "../services/commercial-notifications.js";
import { __resetResendClientForTests } from "../services/email.js";

// ---------------------------------------------------------------------------
// What the public enquiry route takes from anyone, and what it sends back
// (whole-repository audit T-695).
//
// POST /public/enquiries needs no account: a guest's plan (the planner path)
// or a venue's slug (the website and the walkthrough) says where the enquiry
// goes. A venue that has been deleted takes no enquiry on either path, and no
// new guest plan in its rooms (public-surface-7). What the form takes, the
// enquiries table holds, so a valid enquiry is never lost to a 500
// (enquiries-crm-6). The acknowledgement goes in the venue's name to an
// address nobody has confirmed, so it repeats only the venue's own words for
// the occasion (enquiries-crm-3).
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
  // A live venue whose walkthrough is not published: its slug is not on the list.
  const unlistedVenue = randomUUID();
  // A published venue with one room, which a test takes out of use.
  const bareVenue = randomUUID();
  const liveRoom = randomUUID();
  const closedRoom = randomUUID();
  const unlistedRoom = randomUUID();
  const bareRoom = randomUUID();
  // The live venue's second room (after liveRoom in its order), which a test takes out of use.
  const removedRoom = randomUUID();
  const published: readonly string[] = [liveVenue, closedVenue, bareVenue];
  const venues: readonly string[] = [...published, unlistedVenue];
  // Guest leads and people are found by email, so each address is this run's own.
  const run = randomUUID().slice(0, 8);
  const saved = new Map(SET_HERE.map((name) => [name, process.env[name]]));
  /** The routes' connections, as pg_stat_activity names them. */
  const applicationName = `public_enquiry_intake_${randomUUID()}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target, application_name: applicationName, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000",
    });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    await pool.query(
      `INSERT INTO venues (id, name, slug, address) VALUES ($1::uuid, 'TEST ONLY Intake Hall', $1::text, 'Test only'),
        ($2::uuid, 'TEST ONLY Closed Hall', $2::text, 'Test only'), ($3::uuid, 'TEST ONLY Unlisted Hall', $3::text, 'Test only'),
        ($4::uuid, 'TEST ONLY Bare Hall', $4::text, 'Test only')`,
      [liveVenue, closedVenue, unlistedVenue, bareVenue],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, sort_order)
       VALUES ($1, $2, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]', 0), ($3, $4, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]', 0),
         ($5, $6, 'TEST ONLY Saloon', 'saloon', 10, 10, 3, '[]', 0), ($7, $8, 'TEST ONLY Bare Room', 'bare', 10, 10, 3, '[]', 0),
         ($9, $2, 'TEST ONLY Removed Room', 'removed', 10, 10, 3, '[]', 5)`,
      [liveRoom, liveVenue, closedRoom, closedVenue, unlistedRoom, unlistedVenue, bareRoom, bareVenue, removedRoom],
    );
    // Three venues publish their walkthrough (their slug is their id), so the
    // venue path's own gate lets each through to the lookup; the fourth does not.
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = published.join(",");
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

  /** What was handed to the provider for this address, once the send the
   *  route queued after answering has run. */
  async function handedTo(address: string): Promise<HandedToProvider> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const message = handed.find((each) => each.to === address);
      if (message !== undefined) return message;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error(`Nothing was handed to the provider for ${address}`);
  }

  /** How many messages were handed to the provider for this address, however its case was typed. */
  function handedCount(address: string): number {
    return handed.filter((each) => each.to.toLowerCase() === address.toLowerCase()).length;
  }

  /** What became of an enquiry's acknowledgement once the send was decided
   *  (the route queues it after answering): its email_sends status. */
  async function acknowledgementOf(enquiryId: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM email_sends WHERE idempotency_key = $1 AND status <> 'pending'", [`enquiry-acknowledged:${enquiryId}`],
      );
      if (rows[0] !== undefined) return rows[0].status;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error(`The acknowledgement of ${enquiryId} was never decided`);
  }

  /** Waits for this many messages to be handed to the provider for the address, and no more. */
  async function expectHanded(address: string, count: number): Promise<void> {
    for (let attempt = 0; attempt < 100 && handedCount(address) < count; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    expect(handedCount(address)).toBe(count);
  }

  /** The words a reader sees: react-email writes `<!-- -->` between the parts of a sentence. */
  function readable(html: string): string {
    return html.replaceAll("<!-- -->", "");
  }

  /** The acknowledgement's greeting: the first paragraph under its heading. */
  function greetingOf(html: string): string | undefined {
    return /<\/h[1-6]>\s*<p[^>]*>([\s\S]*?)<\/p>/u.exec(readable(html))?.[1];
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

  // Blake, 12 November 2026, "Gate it like the form": a plan's id is no
  // secret, since anyone may make one in any live venue's room, so the planner
  // path takes an enquiry only for a venue the website's form would take one for.
  it("takes a planner enquiry only for a venue whose walkthrough is published, as the venue path does", async () => {
    const guest = { email: `test-only-unlisted-${run}@example.test`, name: "TEST ONLY Unlisted Guest", eventType: "wedding" };
    // A guest may still plan in an unlisted venue's room; the enquiry is what is refused.
    const unlistedPlan = idOf(await newPlan(unlistedRoom), "id");
    const fromPlan = await enquire({ configurationId: unlistedPlan, ...guest });
    const fromWebsite = await enquire({ venueSlug: unlistedVenue, source: "website", ...guest });
    // The venue path's own answer, so the two paths cannot be told apart.
    expect([fromPlan.statusCode, fromPlan.json()]).toEqual([404, { error: "Venue not found", code: "NOT_FOUND" }]);
    expect(fromPlan.json()).toEqual(fromWebsite.json());
    expect(await enquiriesAt(unlistedVenue)).toBe(0);
    const { rows: kept } = await pool.query<{ leads: number; people: number }>(
      `SELECT (SELECT count(*)::int FROM guest_leads WHERE email = $1) AS leads,
              (SELECT count(*)::int FROM contacts WHERE venue_id = $2) AS people`,
      [guest.email, unlistedVenue],
    );
    expect(kept).toEqual([{ leads: 0, people: 0 }]);

    // A published venue's plan still files its enquiry.
    const listedPlan = idOf(await newPlan(liveRoom), "id");
    idOf(await enquire({ configurationId: listedPlan, ...guest, email: `test-only-listed-${run}@example.test` }), "enquiryId");
  });

  // Review of #404, P5: taking a room out of use leaves the plans guests made
  // in it, and an enquiry sent from one is the guest's all the same.
  it("files an enquiry from a plan whose room was taken out of use as naming no room, and keeps it", async () => {
    const plan = idOf(await newPlan(removedRoom), "id");
    const barePlan = idOf(await newPlan(bareRoom), "id");
    // Taken out of use as DELETE /spaces/:id takes a room: its plans stay.
    await pool.query("UPDATE spaces SET deleted_at = now() WHERE id = ANY($1::uuid[])", [[removedRoom, bareRoom]]);

    const email = `test-only-removed-${run}@example.test`;
    const fromRemoved = idOf(await enquire({ configurationId: plan, email, name: "TEST ONLY Ailsa Grant", eventType: "wedding" }), "enquiryId");
    const fromBare = idOf(await enquire({ configurationId: barePlan, email: `test-only-bare-${run}@example.test`, eventType: "wedding" }), "enquiryId");
    const { rows } = await pool.query<{ id: string; space_id: string; configuration_id: string; source: string; room_chosen: boolean }>(
      "SELECT id, space_id, configuration_id, source, room_chosen FROM enquiries WHERE id = ANY($1::uuid[]) ORDER BY created_at",
      [[fromRemoved, fromBare]],
    );
    expect(rows).toEqual([
      // Filed as the venue path files an enquiry naming no room: against the
      // venue's first room in use, from the planner, with its plan.
      { id: fromRemoved, space_id: liveRoom, configuration_id: plan, source: "planner", room_chosen: false },
      // A venue with no room left in use still keeps it, against the plan's own room, naming none.
      { id: fromBare, space_id: bareRoom, configuration_id: barePlan, source: "planner", room_chosen: false },
    ]);
    // The reply does not name the room either.
    expect(readable((await handedTo(email)).html)).not.toContain("TEST ONLY Removed Room");
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

    // A two-digit year typed in a desktop date input posts year 0027. The date
    // column stores it, so the enquiry is kept, not lost (review of #404, P1).
    const early = idOf(await enquire({ venueSlug: liveVenue, source: "website", email, eventType: "wedding", eventDate: "0027-06-12" }), "enquiryId");
    const stored = await pool.query<{ preferred_date: string }>(
      "SELECT preferred_date::text AS preferred_date FROM enquiries WHERE id = $1", [early],
    );
    expect(stored.rows).toEqual([{ preferred_date: "0027-06-12" }]);
  });

  // Audit enquiries-crm-3: the acknowledgement goes, in the venue's name, to
  // whatever address the enquiry names, and nobody has confirmed that address.
  it("repeats to that address only an occasion the venue offers, never one typed in free", async () => {
    const typed = "URGENT payment notice - call 0800 000 000";
    const stranger = `test-only-typed-${run}@example.test`;
    const enquiryId = idOf(await enquire({
      venueSlug: liveVenue, source: "website", email: stranger, name: "TEST ONLY Ailsa Grant",
      eventType: typed, eventDate: "2027-06-12", guestCount: 80,
    }), "enquiryId");

    const sent = await handedTo(stranger);
    const words = readable(sent.html);
    expect(words).not.toContain(typed);
    expect(words).not.toContain("0800 000 000");
    expect(words).not.toContain("Occasion");
    // The rest of what they told us is still there, and the venue keeps the
    // occasion as it was typed, for the team.
    expect(sent.subject).toBe("We have your enquiry — TEST ONLY Intake Hall");
    expect(words).toContain("12 June 2027");
    expect(words).toContain("Guests");
    const { rows } = await pool.query<{ event_type: string }>("SELECT event_type FROM enquiries WHERE id = $1", [enquiryId]);
    expect(rows).toEqual([{ event_type: typed }]);

    // An occasion the venue offers is repeated in the venue's words, as before.
    const guest = `test-only-offered-${run}@example.test`;
    idOf(await enquire({ venueSlug: liveVenue, source: "website", email: guest, name: "TEST ONLY Ailsa Grant", eventType: "wedding" }), "enquiryId");
    const offered = readable((await handedTo(guest)).html);
    expect(offered).toContain("Occasion");
    expect(offered).toContain("Wedding");
  });

  // Blake, 12 November 2026, "Name if it looks real": the same reply greets
  // by the name given only when it reads as a person's name, and otherwise
  // says "Hello,", never the address it is sent to.
  it("greets by name only a name that reads as one, and everyone else with Hello", async () => {
    const lure = "URGENT payment notice - call 0800 000 000";
    // A web address made of letters, a hyphen and a full stop: mail programs make a link of it.
    const address = "Refund at th-deposit.example";
    const given: Record<string, string | undefined> = { lure, address, accented: "Siobhán O’Neill-Smith", none: undefined };
    const greetings: Record<string, string | undefined> = {};
    const bodies = new Map<string, string>();
    for (const [label, name] of Object.entries(given)) {
      const email = `test-only-greet-${label}-${run}@example.test`;
      idOf(await enquire({
        venueSlug: liveVenue, source: "website", email, eventType: "wedding", ...(name === undefined ? {} : { name }),
      }), "enquiryId");
      const words = readable((await handedTo(email)).html);
      greetings[label] = greetingOf(words);
      bodies.set(email, words);
    }
    expect(greetings).toEqual({ lure: "Hello,", address: "Hello,", accented: "Dear Siobhán O’Neill-Smith,", none: "Hello," });
    // Nowhere else in the email either: not the lure, and not the address.
    for (const [email, words] of bodies) {
      expect(words).not.toContain("URGENT");
      expect(words).not.toContain("0800 000 000");
      expect(words).not.toContain("th-deposit");
      expect(words).not.toContain(email);
    }
  });

  // Blake, 12 November 2026, decision (c), the cap: at most one
  // acknowledgement to one address in 24 hours, so nobody can make the venue
  // mail a stranger again and again. The enquiry is still kept and the team
  // still told; only the guest's copy is held back, and recorded as such.
  it("acknowledges one address once in a day, and still keeps every enquiry and tells the team of each", async () => {
    const team = `test-only-team-${run}@example.test`;
    process.env["ENQUIRY_FALLBACK_EMAIL"] = team;
    const noticesBefore = vi.mocked(notifyCommercialTeam).mock.calls.length;
    try {
      const guest = `test-only-twice-${run}@example.test`;
      const asked = { venueSlug: liveVenue, source: "website", name: "TEST ONLY Ailsa Grant", eventType: "wedding" };
      const first = idOf(await enquire({ ...asked, email: guest }), "enquiryId");
      // The same address, typed in capitals.
      const second = idOf(await enquire({ ...asked, email: guest.toUpperCase() }), "enquiryId");
      expect([await acknowledgementOf(first), await acknowledgementOf(second)]).toEqual(["sent", "suppressed"]);
      expect(handedCount(guest)).toBe(1);

      const { rows } = await pool.query<{ id: string }>("SELECT id FROM enquiries WHERE id = ANY($1::uuid[]) ORDER BY created_at", [[first, second]]);
      expect(rows.map((row) => row.id)).toEqual([first, second]);
      await expectHanded(team, 2);
      expect(vi.mocked(notifyCommercialTeam).mock.calls.length - noticesBefore).toBe(2);

      // Another address has its own day.
      const other = idOf(await enquire({ ...asked, email: `test-only-other-${run}@example.test` }), "enquiryId");
      expect(await acknowledgementOf(other)).toBe("sent");
      await expectHanded(team, 3);
    } finally {
      delete process.env["ENQUIRY_FALLBACK_EMAIL"];
    }
  });

  it("counts the day back from the last acknowledgement that went to the address, in whatever case it was typed", async () => {
    const lapsed = `test-only-lapsed-${run}@example.test`;
    const recent = `test-only-recent-${run}@example.test`;
    const held = `test-only-held-${run}@example.test`;
    // What earlier acknowledgements left behind: one sent 25 hours ago, one
    // sent 23 hours ago, and one held back an hour ago, each address in capitals.
    const earlier = [
      { address: lapsed, status: "sent", ago: "25 hours" },
      { address: recent, status: "sent", ago: "23 hours" },
      { address: held, status: "suppressed", ago: "1 hour" },
    ].map((row) => ({ ...row, key: `enquiry-acknowledged:test-only-${randomUUID()}` }));
    try {
      for (const row of earlier) {
        await pool.query(
          `INSERT INTO email_sends (idempotency_key, recipient, subject, status, created_at)
           VALUES ($1, $2, 'TEST ONLY earlier acknowledgement', $3, now() - $4::interval)`,
          [row.key, row.address.toUpperCase(), row.status, row.ago],
        );
      }
      const asked = { venueSlug: liveVenue, source: "website", eventType: "wedding" };
      const decided: string[] = [];
      for (const email of [lapsed, recent, held]) {
        decided.push(await acknowledgementOf(idOf(await enquire({ ...asked, email }), "enquiryId")));
      }
      expect(decided).toEqual(["sent", "suppressed", "sent"]);
      expect([lapsed, recent, held].map(handedCount)).toEqual([1, 0, 1]);
    } finally {
      await pool.query("DELETE FROM email_sends WHERE idempotency_key = ANY($1::text[])", [earlier.map((row) => row.key)]);
    }
  });

  it("acknowledges two enquiries from one address sent at the same moment once", async () => {
    // Nothing this suite queued earlier may still be on its way to email_sends.
    await acknowledgementsSettled();
    const guest = `test-only-same-moment-${run}@example.test`;
    const asked = { venueSlug: liveVenue, source: "website", email: guest, eventType: "wedding" };
    // Every write to email_sends waits behind this lock and every read passes
    // it, so both acknowledgements read before either is written: only a
    // lock taken before the read can let the second see the first.
    const blocker = new Client({ connectionString: target, application_name: `public_enquiry_blocker_${run}`, options: "-c lock_timeout=20000" });
    await blocker.connect();
    let ids: string[] = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE email_sends IN SHARE MODE");
      ids = (await Promise.all([enquire(asked), enquire(asked)])).map((response) => idOf(response, "enquiryId"));
      await expect.poll(async () => {
        const { rows } = await pool.query<{ waiting: number }>(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [applicationName],
        );
        return rows[0]?.waiting;
      }, { timeout: 10_000 }).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    const decided = await Promise.all(ids.map(acknowledgementOf));
    expect([...decided].sort()).toEqual(["sent", "suppressed"]);
    expect(handedCount(guest)).toBe(1);
  });
});

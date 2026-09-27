import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VENUE_ACCESS_ENQUIRY_TYPE, VENVIEWER_PRICING_ENQUIRY_TYPE } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { enquiryAcknowledgement, formatEnGbDate } from "../services/email-templates.js";
import {
  DEFAULT_EMAIL_FROM,
  isDefaultEmailFrom,
  resolveEmailFrom,
  resolveEmailReplyTo,
} from "../services/email.js";

// ---------------------------------------------------------------------------
// The organiser's acknowledgement, and the notification that fires with it.
//
// A public enquiry used to produce a 201 and silence: the guest heard nothing
// back, and the only in-product signal was an email to hallkeepers. This suite
// pins both halves of the fix against a real database — the acknowledgement is
// queued to the organiser, and a venue-scoped notification is written for the
// commercial roles — plus the venue-voice details the copy has to carry.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Enquiry acknowledgement tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const SPACE = "44444444-4444-4444-8444-444444444444";
const VENUE_SLUG = "trades-hall-glasgow";
const ORGANISER = "organiser@example.test";

// ---------------------------------------------------------------------------
// Venue voice — pure, no database
// ---------------------------------------------------------------------------

/** react-email interpolates with `<!-- -->` separators, so the rendered HTML
 *  reads "Dear <!-- -->Elaine Fraser<!-- -->,". Strip the markers before
 *  asserting on prose the organiser actually sees. */
function readableText(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

describe("the venue's acknowledgement copy", () => {
  it("writes the date the way a British organiser reads it", () => {
    // en-GB long form, as Intl renders it — day name, day, month, year.
    expect(formatEnGbDate("2026-10-02")).toBe("Friday, 2 October 2026");
    // A date at the very start of the day must not slip to the day before.
    expect(formatEnGbDate("2026-01-01")).toBe("Thursday, 1 January 2026");
    // Not the US order: an en-GB reader must never see "October 2, 2026".
    expect(formatEnGbDate("2026-10-02")).not.toContain("October 2,");
  });

  it("passes an unparseable date through rather than printing Invalid Date", () => {
    expect(formatEnGbDate("not-a-date")).toBe("not-a-date");
    expect(formatEnGbDate("")).toBe("");
  });

  it("greets the organiser by name, in the venue's voice, with no unsubscribe", async () => {
    const { subject, html } = await enquiryAcknowledgement({
      venueName: "Trades Hall Glasgow",
      roomName: "Grand Hall",
      organiserName: "Elaine Fraser",
      eventType: "Wedding",
      eventDate: "2026-10-02",
      guestCount: 120,
      replyToEmail: "events@example.test",
    });

    const text = readableText(html);
    expect(subject).toBe("We have your enquiry — Trades Hall Glasgow");
    expect(text).toContain("Dear Elaine Fraser");
    expect(text).toContain("Trades Hall Glasgow");
    expect(text).toContain("Grand Hall");
    expect(text).toContain("Friday, 2 October 2026");
    expect(text).toContain("events@example.test");
    // The venue signs it, not the platform.
    expect(text).toContain("The events team, Trades Hall Glasgow");
    expect(text).toContain("Sent by the events team at Trades Hall Glasgow");
    expect(html).not.toContain("VENVIEWER");
    // A transactional reply carries no unsubscribe affordance.
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("omits fields the organiser did not give", async () => {
    const { html } = await enquiryAcknowledgement({
      venueName: "Trades Hall Glasgow",
      roomName: "Saloon",
      organiserName: ORGANISER,
      eventType: null,
      eventDate: null,
      guestCount: null,
      replyToEmail: null,
    });
    expect(html).not.toContain("Occasion");
    expect(html).not.toContain("Guests");
    expect(html).toContain("Saloon");
  });

  // "Here is what you told us" must be what they told us: a guest who named
  // no room is never told they asked for the room the enquiry is filed under.
  it("names no room to a guest who chose none", async () => {
    const { html } = await enquiryAcknowledgement({
      venueName: "Trades Hall Glasgow",
      roomName: null,
      organiserName: ORGANISER,
      eventType: "Wedding",
      eventDate: null,
      guestCount: 80,
      replyToEmail: null,
    });
    const text = readableText(html);
    expect(text).toContain("Your enquiry is with our events team");
    expect(text).not.toContain("Room");
    expect(text).toContain("Wedding");
  });
});

// ---------------------------------------------------------------------------
// Sender identity — the code path that reads EMAIL_FROM / EMAIL_REPLY_TO
// ---------------------------------------------------------------------------

describe("sender identity", () => {
  const savedFrom = process.env["EMAIL_FROM"];
  const savedReplyTo = process.env["EMAIL_REPLY_TO"];

  afterEach(() => {
    if (savedFrom === undefined) delete process.env["EMAIL_FROM"];
    else process.env["EMAIL_FROM"] = savedFrom;
    if (savedReplyTo === undefined) delete process.env["EMAIL_REPLY_TO"];
    else process.env["EMAIL_REPLY_TO"] = savedReplyTo;
  });

  it("falls back to the platform identity, and says so", () => {
    delete process.env["EMAIL_FROM"];
    expect(resolveEmailFrom()).toBe(DEFAULT_EMAIL_FROM);
    expect(isDefaultEmailFrom()).toBe(true);
  });

  it("sends as the venue once the deployment variable is set", () => {
    process.env["EMAIL_FROM"] = "Trades Hall Glasgow <events@example.test>";
    expect(resolveEmailFrom()).toBe("Trades Hall Glasgow <events@example.test>");
    expect(isDefaultEmailFrom()).toBe(false);
  });

  it("treats a blank variable as unset rather than as an empty header", () => {
    process.env["EMAIL_FROM"] = "   ";
    process.env["EMAIL_REPLY_TO"] = "  ";
    expect(resolveEmailFrom()).toBe(DEFAULT_EMAIL_FROM);
    expect(resolveEmailReplyTo()).toBeNull();
  });

  it("carries a monitored reply-to when one is configured", () => {
    process.env["EMAIL_REPLY_TO"] = "events@example.test";
    expect(resolveEmailReplyTo()).toBe("events@example.test");
  });
});

// ---------------------------------------------------------------------------
// The route — acknowledgement queued, notification written
// ---------------------------------------------------------------------------

describe.skipIf(testUrl === undefined)("public enquiry side effects on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `enquiry_ack_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.spaces, schema.configurations, schema.enquiries,
    schema.enquiryStatusHistory, schema.guestLeads, schema.users,
    schema.eventPlanNotifications, schema.emailSends, schema.pricingRules,
  ];
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = VENUE_SLUG;
    pool = new Pool({
      connectionString: testUrl, application_name: fixtureSchema, max: 4,
      options: `-c search_path=${fixtureSchema}`,
    });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "revision") defaultSql = " default 1";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    // sendEmail dedupes on this constraint; without it a retry would send twice.
    await pool.query("ALTER TABLE email_sends ADD UNIQUE (idempotency_key)");

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, spaces, configurations, enquiries, enquiry_status_history, guest_leads, users, event_plan_notifications, email_sends, pricing_rules");
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', $2, '85 Glassford Street')",
      [VENUE, VENUE_SLUG],
    );
    await pool.query(
      "INSERT INTO spaces (id, venue_id, name, sort_order) VALUES ($1, $2, 'Grand Hall', 0)",
      [SPACE, VENUE],
    );
  }, 60_000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  async function submitEnquiry(): Promise<string> {
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: {
        venueSlug: VENUE_SLUG,
        email: ORGANISER,
        name: "Elaine Fraser",
        eventType: "Wedding",
        eventDate: "2026-10-02",
        guestCount: 120,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { enquiryId: string } };
    return body.data.enquiryId;
  }

  /** sendEmailAsync is fire-and-forget on setImmediate; wait for its audit row. */
  async function waitForEmail(key: string): Promise<{ recipient: string; subject: string; status: string }> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await pool.query<{ recipient: string; subject: string; status: string }>(
        "SELECT recipient, subject, status FROM email_sends WHERE idempotency_key = $1", [key],
      );
      const row = rows.rows[0];
      if (row !== undefined) return row;
      await new Promise((resolve) => { setTimeout(resolve, 40); });
    }
    throw new Error(`no email_sends row for ${key}`);
  }

  /** The message the Enquiries desk shows for an enquiry, as stored. */
  async function storedMessage(enquiryId: string): Promise<string | null | undefined> {
    const rows = await pool.query<{ message: string | null }>("SELECT message FROM enquiries WHERE id = $1", [enquiryId]);
    return rows.rows[0]?.message;
  }

  /** Where the enquiry says it came from, and the room it is filed under. */
  async function storedSource(enquiryId: string): Promise<{ source: string | null; room_chosen: boolean; space_id: string } | undefined> {
    const rows = await pool.query<{ source: string | null; room_chosen: boolean; space_id: string }>(
      "SELECT source, room_chosen, space_id FROM enquiries WHERE id = $1", [enquiryId]);
    return rows.rows[0];
  }

  it("records a walkthrough enquiry's source in its own column, with no room chosen and no note", async () => {
    const enquiryId = await submitEnquiry();
    expect(await storedMessage(enquiryId)).toBeNull();
    expect(await storedSource(enquiryId)).toEqual({ source: "walkthrough", room_chosen: false, space_id: SPACE });
  });

  it("files a room the guest names as their choice, and names it to the team", async () => {
    const saloon = randomUUID();
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES ($1, $2, 'Saloon', 'saloon', 1)", [saloon, VENUE]);
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: { venueSlug: VENUE_SLUG, roomSlug: "saloon", source: "website", email: ORGANISER, name: "Elaine Fraser", message: "A Friday in June." },
    });
    expect(res.statusCode, res.body).toBe(201);
    const enquiryId = (JSON.parse(res.body) as { data: { enquiryId: string } }).data.enquiryId;
    expect(await storedSource(enquiryId)).toEqual({ source: "website", room_chosen: true, space_id: saloon });
    expect(await storedMessage(enquiryId)).toBe("A Friday in June.");
    const notices = await pool.query<{ title: string; body: string }>("SELECT DISTINCT title, body FROM event_plan_notifications");
    expect(notices.rows).toEqual([{ title: "New enquiry — Saloon", body: "Elaine Fraser enquired about Saloon. Open Enquiries to respond." }]);
  });

  it("files a room the venue does not have as no room chosen, and keeps the enquiry", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: { venueSlug: VENUE_SLUG, roomSlug: "ballroom", email: ORGANISER },
    });
    expect(res.statusCode, res.body).toBe(201);
    const enquiryId = (JSON.parse(res.body) as { data: { enquiryId: string } }).data.enquiryId;
    expect(await storedSource(enquiryId)).toEqual({ source: "walkthrough", room_chosen: false, space_id: SPACE });
  });

  it("tells the team where a roomless enquiry came from, and that no room was chosen", async () => {
    await submitEnquiry();
    const notices = await pool.query<{ title: string; body: string }>("SELECT DISTINCT title, body FROM event_plan_notifications");
    expect(notices.rows).toEqual([{
      title: "New enquiry",
      body: "Elaine Fraser enquired from the walkthrough for a Wedding on 2026-10-02, without choosing a room. Open Enquiries to respond.",
    }]);
  });

  it("approves a roomless enquiry at the venue, never for the room it is filed under", async () => {
    const enquiryId = await submitEnquiry();
    await pool.query("UPDATE enquiries SET state = 'under_review' WHERE id = $1", [enquiryId]);
    const staff = { id: randomUUID(), email: "events@example.test", role: "staff", venueId: VENUE };
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: { authorization: `Bearer ${JSON.stringify(staff)}` },
      payload: { status: "approved" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const sent = await waitForEmail(`enquiry-approved:${enquiryId}`);
    expect(sent.subject).toBe("Your enquiry at Trades Hall Glasgow has been approved");
  });

  it("acknowledges the organiser by email", async () => {
    const enquiryId = await submitEnquiry();
    const sent = await waitForEmail(`enquiry-acknowledged:${enquiryId}`);
    expect(sent.recipient).toBe(ORGANISER);
    expect(sent.subject).toBe("We have your enquiry — Trades Hall Glasgow");
  });

  it("writes a venue-scoped notification for the commercial roles", async () => {
    const enquiryId = await submitEnquiry();
    const rows = await pool.query<{
      audience_role: string; venue_id: string; event_id: string | null; action_path: string;
    }>("SELECT audience_role, venue_id, event_id, action_path FROM event_plan_notifications ORDER BY audience_role");

    expect(rows.rows.length).toBeGreaterThan(0);
    const roles = rows.rows.map((row) => row.audience_role);
    // Everyone who works the pipeline hears; the enquiry has no event.
    expect([...roles].sort()).toEqual(["admin", "manager", "sales", "staff"]);
    for (const row of rows.rows) {
      expect(row.venue_id).toBe(VENUE);
      expect(row.event_id).toBeNull();
      expect(row.action_path).toBe("/dashboard?view=enquiries");
    }
    expect(enquiryId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  // The workspace gate's "Request access" rides this route so the ask reaches
  // the inbox, but the person wants to be let into the venue's workspace, not
  // to book a room. The booking acknowledgement ("we will talk you through
  // dates, rooms and costs", "Occasion: venue-access") would be untrue to
  // them, so it is not sent, and the team is told what actually arrived.
  it("answers a venue-access request as one, not as a room booking", async () => {
    const requester = "uninvited@example.test";
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: {
        venueSlug: VENUE_SLUG,
        email: requester,
        eventType: VENUE_ACCESS_ENQUIRY_TYPE,
        message: `Venue access request from ${requester}.`,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const enquiryId = (JSON.parse(res.body) as { data: { enquiryId: string } }).data.enquiryId;
    // It did not come from the walkthrough, so the desk must not say it did.
    expect(await storedMessage(enquiryId)).toBe(`Venue access request from ${requester}.`);
    expect(await storedSource(enquiryId)).toMatchObject({ source: "website", room_chosen: false });

    const notifications = await pool.query<{ audience_role: string; title: string; body: string }>(
      "SELECT audience_role, title, body FROM event_plan_notifications ORDER BY audience_role");
    expect(notifications.rows.map((row) => row.audience_role)).toContain("admin");
    for (const row of notifications.rows) {
      expect(row.title).toBe("Access request");
      expect(row.body).toBe(`${requester} asked for access to Trades Hall Glasgow's Venviewer workspace. Open Enquiries to read the request.`);
    }

    // sendEmailAsync queues on setImmediate; give a queued send ample time to
    // land before asserting that none was queued at all.
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    const sent = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM email_sends WHERE idempotency_key = $1 OR recipient = $2",
      [`enquiry-acknowledged:${enquiryId}`, requester],
    );
    expect(sent.rows[0]?.count).toBe("0");
  });

  // The pricing page's "Talk to us about your venue" is a venue asking about
  // Venviewer for its own rooms. The booking acknowledgement would thank them
  // "for thinking of" this venue and promise to talk through its rooms and
  // costs; the pricing page already says "Thank you. We will reply to ...".
  it("tells the team what a pricing-page enquiry is, and sends no booking acknowledgement", async () => {
    const prospect = "operations@other-venue.example";
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: {
        venueSlug: VENUE_SLUG,
        email: prospect,
        eventType: VENVIEWER_PRICING_ENQUIRY_TYPE,
        message: "We let three rooms and a courtyard.",
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const enquiryId = (JSON.parse(res.body) as { data: { enquiryId: string } }).data.enquiryId;
    expect(await storedMessage(enquiryId)).toBe("We let three rooms and a courtyard.");
    expect(await storedSource(enquiryId)).toMatchObject({ source: "website", room_chosen: false });

    const notifications = await pool.query<{ title: string; body: string }>(
      "SELECT title, body FROM event_plan_notifications");
    expect(notifications.rows.length).toBeGreaterThan(0);
    for (const row of notifications.rows) {
      expect(row.title).toBe("Venviewer enquiry");
      expect(row.body).toBe(`${prospect} asked about Venviewer for their own venue, from the pricing page. Open Enquiries to read it.`);
    }

    await new Promise((resolve) => { setTimeout(resolve, 600); });
    const sent = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM email_sends WHERE idempotency_key = $1 OR recipient = $2",
      [`enquiry-acknowledged:${enquiryId}`, prospect],
    );
    expect(sent.rows[0]?.count).toBe("0");
  });

  // A request reaches the same inbox as a booking, but approving or declining
  // it would email the sender a booking outcome they never asked for. Staff
  // mark it done instead, and can reopen it.
  describe("a request in the venue's inbox", () => {
    const staff = { id: randomUUID(), email: "events@example.test", role: "staff", venueId: VENUE };

    async function submitAccessRequest(): Promise<string> {
      const res = await server.inject({
        method: "POST",
        url: "/public/enquiries",
        payload: { venueSlug: VENUE_SLUG, email: "uninvited@example.test", eventType: VENUE_ACCESS_ENQUIRY_TYPE },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (JSON.parse(res.body) as { data: { enquiryId: string } }).data.enquiryId;
    }

    async function transition(
      enquiryId: string,
      status: string,
      actor: Record<string, string | null> = staff,
    ): Promise<{ statusCode: number; code: string | undefined; state: string | undefined }> {
      const res = await server.inject({
        method: "POST",
        url: `/enquiries/${enquiryId}/transition`,
        headers: { authorization: `Bearer ${JSON.stringify(actor)}` },
        payload: { status },
      });
      const body = JSON.parse(res.body) as { code?: string; data?: { state: string } };
      return { statusCode: res.statusCode, code: body.code, state: body.data?.state };
    }

    async function storedState(enquiryId: string): Promise<string | undefined> {
      const rows = await pool.query<{ state: string }>("SELECT state FROM enquiries WHERE id = $1", [enquiryId]);
      return rows.rows[0]?.state;
    }

    it("takes neither booking decision, whoever asks, and emails nobody", async () => {
      const enquiryId = await submitAccessRequest();
      const platformAdmin = { ...staff, id: randomUUID(), role: "admin", platformRole: "admin" };
      for (const actor of [staff, platformAdmin]) {
        for (const status of ["approved", "rejected"]) {
          const refused = await transition(enquiryId, status, actor);
          expect(refused.statusCode, `${actor.role} ${status}`).toBe(422);
          expect(refused.code).toBe("NOT_A_BOOKING");
        }
      }
      // One moved into review before requests had their own path is refused too.
      await pool.query("UPDATE enquiries SET state = 'under_review' WHERE id = $1", [enquiryId]);
      expect((await transition(enquiryId, "approved")).code).toBe("NOT_A_BOOKING");
      expect(await storedState(enquiryId)).toBe("under_review");

      const history = await pool.query("SELECT 1 FROM enquiry_status_history WHERE enquiry_id = $1", [enquiryId]);
      expect(history.rowCount).toBe(1);
      await new Promise((resolve) => { setTimeout(resolve, 600); });
      const sent = await pool.query<{ count: string }>("SELECT count(*) AS count FROM email_sends");
      expect(sent.rows[0]?.count).toBe("0");
    });

    it("is marked done by the venue's team, and reopened, without an email", async () => {
      const enquiryId = await submitAccessRequest();
      expect(await transition(enquiryId, "archived")).toMatchObject({ statusCode: 200, state: "archived" });
      expect(await transition(enquiryId, "submitted")).toMatchObject({ statusCode: 200, state: "submitted" });
      // The sender cannot file it on the venue's behalf.
      const sender = { id: randomUUID(), email: "uninvited@example.test", role: "planner", venueId: null };
      expect((await transition(enquiryId, "archived", sender)).statusCode).toBe(403);

      const history = await pool.query<{ from_status: string; to_status: string; changed_by: string | null }>(
        "SELECT from_status, to_status, changed_by FROM enquiry_status_history WHERE enquiry_id = $1 ORDER BY created_at",
        [enquiryId],
      );
      expect(history.rows.slice(1)).toEqual([
        { from_status: "submitted", to_status: "archived", changed_by: staff.id },
        { from_status: "archived", to_status: "submitted", changed_by: staff.id },
      ]);
      await new Promise((resolve) => { setTimeout(resolve, 600); });
      const sent = await pool.query<{ count: string }>("SELECT count(*) AS count FROM email_sends");
      expect(sent.rows[0]?.count).toBe("0");
    });

    it("lets sales open, follow and move what the inbox lists it, and keeps a caterer out", async () => {
      const enquiryId = await submitEnquiry();
      const sales = { ...staff, id: randomUUID(), role: "sales" };
      const caterer = { ...staff, id: randomUUID(), role: "caterer" };
      for (const url of [`/enquiries/${enquiryId}`, `/enquiries/${enquiryId}/history`]) {
        const opened = await server.inject({ method: "GET", url, headers: { authorization: `Bearer ${JSON.stringify(sales)}` } });
        expect(opened.statusCode, `sales ${url}`).toBe(200);
        const refused = await server.inject({ method: "GET", url, headers: { authorization: `Bearer ${JSON.stringify(caterer)}` } });
        expect(refused.statusCode, `caterer ${url}`).toBe(403);
      }
      expect(await transition(enquiryId, "under_review", sales)).toMatchObject({ statusCode: 200, state: "under_review" });
      expect((await transition(enquiryId, "approved", caterer)).statusCode).toBe(403);
    });

    it("shows an enquiry's quote to sales but not to a hallkeeper, who may open the enquiry", async () => {
      const enquiryId = await submitEnquiry();
      const as = (role: string): { authorization: string } => ({
        authorization: `Bearer ${JSON.stringify({ ...staff, id: randomUUID(), role })}`,
      });
      const hallkeeperOpens = await server.inject({ method: "GET", url: `/enquiries/${enquiryId}`, headers: as("hallkeeper") });
      expect(hallkeeperOpens.statusCode).toBe(200);
      const hallkeeperQuote = await server.inject({ method: "GET", url: `/enquiries/${enquiryId}/quote`, headers: as("hallkeeper") });
      expect(hallkeeperQuote.statusCode).toBe(403);
      for (const role of ["sales", "manager", "staff"]) {
        const quote = await server.inject({ method: "GET", url: `/enquiries/${enquiryId}/quote`, headers: as(role) });
        expect(quote.statusCode, `${role}: ${quote.body}`).toBe(200);
      }
    });

    it("leaves a booking's decisions as they were: an approval still emails the client", async () => {
      const enquiryId = await submitEnquiry();
      expect((await transition(enquiryId, "archived")).code).toBe("INVALID_TRANSITION");
      expect(await transition(enquiryId, "under_review")).toMatchObject({ statusCode: 200, state: "under_review" });
      expect(await transition(enquiryId, "approved")).toMatchObject({ statusCode: 200, state: "approved" });
      const sent = await waitForEmail(`enquiry-approved:${enquiryId}`);
      expect(sent.recipient).toBe(ORGANISER);
    });
  });

  it("does not acknowledge the same enquiry twice", async () => {
    const enquiryId = await submitEnquiry();
    await waitForEmail(`enquiry-acknowledged:${enquiryId}`);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM email_sends WHERE idempotency_key = $1",
      [`enquiry-acknowledged:${enquiryId}`],
    );
    expect(count.rows[0]?.count).toBe("1");
  });
});

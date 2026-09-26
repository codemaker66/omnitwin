import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
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
      spaceName: "Grand Hall",
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
      spaceName: "Saloon",
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
    schema.eventPlanNotifications, schema.emailSends,
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
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, spaces, configurations, enquiries, enquiry_status_history, guest_leads, users, event_plan_notifications, email_sends");
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
    // Staff and the venue admin both hear; the enquiry has no event.
    expect(roles).toContain("staff");
    expect(roles).toContain("admin");
    for (const row of rows.rows) {
      expect(row.venue_id).toBe(VENUE);
      expect(row.event_id).toBeNull();
      expect(row.action_path).toBe("/dashboard?view=enquiries");
    }
    expect(enquiryId).toMatch(/^[0-9a-f-]{36}$/u);
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

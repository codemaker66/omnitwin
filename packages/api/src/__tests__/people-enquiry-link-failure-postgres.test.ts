import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, LightMyRequestResponse } from "fastify";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { contacts } from "../db/schema.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import type { EnquiryForLink, LinkOutcome } from "../services/people-link.js";
import type { PeopleTx } from "../services/people-records.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// A public enquiry is kept even if finding its person fails (T-665, Task 9).
//
// Finding or making the enquiry's person enriches it; the enquiry is the
// venue's business record. The route runs the link in a savepoint, so a
// failure there is rolled back alone: the enquiry, its status history and its
// guest lead are still stored, with no person, the guest gets the same 201,
// and the log names the failure by ids, class and SQLSTATE only, never the
// message drizzle builds from the query's parameters.
//
// linkEnquiryToPerson is replaced so it fails on demand; everything else is
// the real route on the migrated disposable database.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const { linkSpy } = vi.hoisted(() => ({
  linkSpy: vi.fn<(tx: PeopleTx, enquiry: EnquiryForLink, options: { ownerUserId: string | null; whenShared: "leave" | "create" }) => Promise<LinkOutcome>>(),
}));
vi.mock("../services/people-link.js", () => ({
  linkEnquiryToPerson: (...args: Parameters<typeof linkSpy>): Promise<LinkOutcome> => linkSpy(...args),
}));
vi.mock("../services/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendEmailAsync: vi.fn(),
  resolveEmailReplyTo: () => null,
}));
vi.mock("../services/commercial-notifications.js", () => ({
  notifyCommercialTeam: vi.fn().mockResolvedValue(0),
}));

/** Every line the route logs, as it was logged. */
const logged: unknown[][] = [];
function record(...args: unknown[]): void { logged.push(args); }
const capturedLog: FastifyBaseLogger = {
  level: "info",
  fatal: record, error: record, warn: record, info: record, debug: record, trace: record, silent: record,
  child: () => capturedLog,
};

describe.skipIf(PLATFORM_TARGET === undefined)("a public enquiry whose person cannot be found, on the migrated disposable database", () => {
  let f: PeopleFixture;
  // Guest leads are not venue-scoped, so a lead's email is this run's own.
  const run = randomUUID().slice(0, 8);
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      server.addHook("onRequest", (request, _reply, done) => { request.log = capturedLog; done(); });
      await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    });
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = f.venueId;
    await f.pool.query(
      `INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, 'The Saloon', 'saloon', 10, 10, 3, '[]')`,
      [f.venueId],
    );
  }, 120_000);

  beforeEach(() => {
    linkSpy.mockReset();
    logged.length = 0;
  });

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    await f?.close();
  });

  function enquire(email: string): Promise<LightMyRequestResponse> {
    return f.server.inject({
      method: "POST", url: "/public/enquiries",
      payload: {
        venueSlug: f.venueId, source: "website", eventType: "wedding", eventDate: "2027-06-12", guestCount: 90,
        email, name: "Kirsty Lane", phone: "0141 496 0001",
      },
    });
  }

  /** The enquiry, its history and its lead as stored. */
  async function storedFor(enquiryId: string, email: string): Promise<{
    contactId: string | null | undefined; history: number; lead: { name: string | null; phone: string | null; first_enquiry_id: string | null }[];
  }> {
    const enquiry = await f.pool.query<{ contact_id: string | null }>("SELECT contact_id FROM enquiries WHERE id = $1", [enquiryId]);
    const history = await f.pool.query(
      "SELECT 1 FROM enquiry_status_history WHERE enquiry_id = $1 AND from_status = 'draft' AND to_status = 'submitted'", [enquiryId],
    );
    const lead = await f.pool.query<{ name: string | null; phone: string | null; first_enquiry_id: string | null }>(
      "SELECT name, phone, first_enquiry_id FROM guest_leads WHERE email = $1", [email],
    );
    expect(enquiry.rowCount).toBe(1);
    return { contactId: enquiry.rows[0]?.contact_id, history: history.rowCount ?? 0, lead: lead.rows };
  }

  function failures(): unknown[] {
    return logged.map(([first]) => first).filter((entry) =>
      typeof entry === "object" && entry !== null && (entry as Record<string, unknown>)["event"] === "enquiry.person_link_failed");
  }

  function expectNothingPersonal(): void {
    const everything = JSON.stringify(logged).toLowerCase();
    // Whole shapes only: a random uuid in the log may hold "0141" or "496".
    for (const personal of ["example.test", "kirsty", "lane", "0141 496 0001", "01414960001"]) expect(everything).not.toContain(personal);
  }

  it("keeps the enquiry, its history and its lead, and answers as it always does, when finding the person throws", async () => {
    // The answer a guest gets when the link works, for comparison.
    linkSpy.mockResolvedValueOnce({ outcome: "ambiguous", contactId: null });
    const normal = await enquire(`answered-${run}@example.test`);
    expect(normal.statusCode, normal.body).toBe(201);

    const email = `failing-${run}@example.test`;
    // Drizzle's own message carries the query's parameters; the log must not.
    linkSpy.mockRejectedValueOnce(Object.assign(new Error(`duplicate key value violates unique constraint; params: ${email}`), { code: "23505" }));
    logged.length = 0;
    const res = await enquire(email);

    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ data: { enquiryId: string; message: string } }>();
    const usual = normal.json<{ data: { enquiryId: string; message: string } }>();
    expect({ ...body, data: { ...body.data, enquiryId: "the enquiry" } }).toEqual({ ...usual, data: { ...usual.data, enquiryId: "the enquiry" } });
    expect(res.headers["content-type"]).toBe(normal.headers["content-type"]);

    const enquiryId = body.data.enquiryId;
    expect(await storedFor(enquiryId, email)).toEqual({
      contactId: null, history: 1, lead: [{ name: "Kirsty Lane", phone: "0141 496 0001", first_enquiry_id: enquiryId }],
    });
    expect(failures()).toEqual([{
      event: "enquiry.person_link_failed", enquiryId, venueId: f.venueId, errorName: "Error", pgCode: "23505",
    }]);
    expectNothingPersonal();
  });

  it("undoes only what the failed link wrote, after the database refuses one of its statements", async () => {
    const email = `refused-${run}@example.test`;
    // Inside the savepoint: a person half made, then a statement PostgreSQL
    // refuses, which aborts the transaction until the savepoint is rolled back.
    linkSpy.mockImplementationOnce(async (savepoint, enquiry) => {
      await savepoint.insert(contacts).values({ venueId: enquiry.venueId, name: "Half-made Person" });
      await savepoint.execute(sql`SELECT ${enquiry.email}::int`);
      throw new Error("unreachable");
    });
    const res = await enquire(email);

    expect(res.statusCode, res.body).toBe(201);
    const enquiryId = res.json<{ data: { enquiryId: string } }>().data.enquiryId;
    expect(await storedFor(enquiryId, email)).toEqual({
      contactId: null, history: 1, lead: [{ name: "Kirsty Lane", phone: "0141 496 0001", first_enquiry_id: enquiryId }],
    });
    const halfMade = await f.pool.query("SELECT 1 FROM contacts WHERE venue_id = $1 AND name = 'Half-made Person'", [f.venueId]);
    expect(halfMade.rowCount).toBe(0);
    // invalid_text_representation, from the driver's error that drizzle wraps.
    expect(failures()).toEqual([{
      event: "enquiry.person_link_failed", enquiryId, venueId: f.venueId, errorName: "Error", pgCode: "22P02",
    }]);
    expectNothingPersonal();
  });
});

import { randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientRoutes } from "../routes/clients.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// A guest lead is read only by the venue it was given to (audit
// enquiries-crm-4).
//
// guest_leads names no venue: one row per email, written by the first public
// enquiry from that email anywhere, with the name and phone given there. The
// Clients desk admitted any venue holding an enquiry under the same email,
// then returned the whole row, so a second venue's team read the name and
// phone the guest gave only the first (the profile, the search, and the lead
// linked from Recent and Upcoming). Every read now admits a venue only when
// the row's words are exactly its own: written once, by its own enquiry, or
// from enquiries that were all its own. Anything else is read by a platform
// admin alone.
//
// The enquiries are sent through the real public route, so the leads are the
// rows its writer makes. The email service and the in-app notice are mocked,
// as in people-enquiry-link-postgres.test.ts.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

vi.mock("../services/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendEmailAsync: vi.fn(),
  resolveEmailReplyTo: () => null,
}));
vi.mock("../services/commercial-notifications.js", () => ({
  notifyCommercialTeam: vi.fn().mockResolvedValue(0),
}));

interface Guest {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
}

interface Lead {
  readonly id: string;
  readonly firstEnquiryId: string | null;
}

interface LeadRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly enquiryCount: number;
}

interface EnquiryRow {
  readonly id: string;
  readonly guestName: string | null;
  readonly guestPhone: string | null;
  readonly leadId: string | null;
}

interface LeadProfile {
  readonly lead: { readonly id: string; readonly name: string | null; readonly phone: string | null };
  readonly enquiries: readonly { readonly id: string }[];
}

/** What a team is shown of one lead and one of its enquiries, through each read of guest leads. */
interface Seen {
  readonly recent: EnquiryRow | undefined;
  readonly upcoming: EnquiryRow | undefined;
  readonly search: readonly LeadRow[];
  readonly profile: LightMyRequestResponse;
}

describe.skipIf(PLATFORM_TARGET === undefined)("a guest lead and the venue it was given to, on the migrated disposable database", () => {
  let f: PeopleFixture;
  // Guest leads are not venue-scoped, so a lead's email is this run's own.
  const run = randomUUID().slice(0, 8);
  // The venue path's opt-in gate reads this; it names the fixture's venues
  // (their slug is their id) and is restored afterwards.
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
      await server.register(clientRoutes, { db, prefix: "/clients" });
    });
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = `${f.venueId},${f.otherVenueId}`;
    await f.pool.query(
      `INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, 'The Saloon', 'saloon', 10, 10, 3, '[]'), ($2, 'The Saloon', 'saloon', 10, 10, 3, '[]')`,
      [f.venueId, f.otherVenueId],
    );
  }, 120_000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    await f?.close();
  });

  /** What the website's enquiry form posts, at one of the fixture's venues. */
  async function enquire(venueId: string, guest: Guest): Promise<string> {
    const response = await f.server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { venueSlug: venueId, source: "website", eventType: "wedding", eventDate: "2027-06-12", guestCount: 90, ...guest },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { enquiryId: string } }>().data.enquiryId;
  }

  async function leadOf(email: string): Promise<Lead> {
    const { rows } = await f.pool.query<{ id: string; first_enquiry_id: string | null }>(
      "SELECT id, first_enquiry_id FROM guest_leads WHERE email = $1", [email],
    );
    const [row] = rows;
    if (rows.length !== 1 || row === undefined) throw new Error(`Expected one lead for ${email}, found ${String(rows.length)}`);
    return { id: row.id, firstEnquiryId: row.first_enquiry_id };
  }

  /** As the writer before leads were written once did: a later enquiry's words over the first's. */
  async function overwrittenByALaterEnquiry(email: string, words: Omit<Guest, "email">): Promise<void> {
    await f.pool.query(
      "UPDATE guest_leads SET name = $2, phone = $3, updated_at = created_at + interval '1 day' WHERE email = $1",
      [email, words.name, words.phone],
    );
  }

  function get(url: string, who: PeopleFixtureUser): Promise<LightMyRequestResponse> {
    return f.server.inject({ method: "GET", url, headers: f.bearer(who) });
  }

  async function data<T>(url: string, who: PeopleFixtureUser): Promise<T> {
    const response = await get(url, who);
    expect(response.statusCode, `${who} ${url}: ${response.body}`).toBe(200);
    return response.json<{ data: T }>().data;
  }

  async function seenBy(who: PeopleFixtureUser, lead: Lead, enquiryId: string, query: string): Promise<Seen> {
    const recent = (await data<EnquiryRow[]>("/clients/recent", who)).find((row) => row.id === enquiryId);
    const upcoming = (await data<EnquiryRow[]>("/clients/upcoming", who)).find((row) => row.id === enquiryId);
    const found = await data<{ guestLeads: LeadRow[] }>(`/clients/search?q=${encodeURIComponent(query)}`, who);
    return {
      recent, upcoming,
      search: found.guestLeads.filter((row) => row.id === lead.id),
      profile: await get(`/clients/leads/${lead.id}/profile`, who),
    };
  }

  it("keeps the name and phone a guest gave one venue from another venue's team, through every read", async () => {
    const jane: Guest = { email: `jane.smith-${run}@example.test`, name: "TEST ONLY Jane Smith", phone: "07700 900123" };
    const atA = await enquire(f.venueId, jane);
    const atB = await enquire(f.otherVenueId, { ...jane, name: "TEST ONLY J. Smith (Acme)", phone: "0141 496 0999" });
    const lead = await leadOf(jane.email);
    // One row, written once by the first enquiry: venue A's.
    expect(lead.firstEnquiryId).toBe(atA);

    // Venue B: its own enquiry, in the words the guest gave B, and nothing of the lead.
    const b = await seenBy("otherStaff", lead, atB, "Jane Smith");
    expect(b.recent).toMatchObject({ guestName: "TEST ONLY J. Smith (Acme)", guestPhone: "0141 496 0999", leadId: null });
    expect(b.upcoming).toMatchObject({ guestName: "TEST ONLY J. Smith (Acme)", leadId: null });
    expect(b.search).toEqual([]);
    expect(b.profile.statusCode).toBe(404);
    expect(b.profile.body).not.toContain(jane.phone);
    // Nor found by the email B already holds.
    const byEmail = await data<{ guestLeads: LeadRow[] }>(`/clients/search?q=${encodeURIComponent(jane.email)}`, "otherStaff");
    expect(byEmail.guestLeads.filter((row) => row.id === lead.id)).toEqual([]);

    // Venue A: the lead it was given, with its own enquiry alone.
    const a = await seenBy("staff", lead, atA, "Jane Smith");
    expect(a.recent).toMatchObject({ leadId: lead.id });
    expect(a.upcoming).toMatchObject({ leadId: lead.id });
    expect(a.search).toEqual([expect.objectContaining({ name: jane.name, phone: jane.phone, enquiryCount: 1 })]);
    expect(a.profile.statusCode, a.profile.body).toBe(200);
    const profile = a.profile.json<{ data: LeadProfile }>().data;
    expect(profile.lead).toMatchObject({ id: lead.id, name: jane.name, phone: jane.phone });
    expect(profile.enquiries.map((row) => row.id)).toEqual([atA]);

    // A platform admin reads every venue, as before; each enquiry links the
    // lead given to its own venue.
    expect((await get(`/clients/leads/${lead.id}/profile`, "platformAdmin")).statusCode).toBe(200);
    const everywhere = await data<EnquiryRow[]>("/clients/recent", "platformAdmin");
    expect(everywhere.find((row) => row.id === atA)?.leadId).toBe(lead.id);
    expect(everywhere.find((row) => row.id === atB)?.leadId).toBeNull();
  });

  it("shows no venue a lead from before leads were written once whose words a later enquiry elsewhere may have written", async () => {
    const morven: Guest = { email: `morven.reid-${run}@example.test`, name: "TEST ONLY Morven Reid", phone: "07700 900456" };
    const atA = await enquire(f.venueId, morven);
    const atB = await enquire(f.otherVenueId, { ...morven, name: "TEST ONLY M. Reid", phone: "0141 496 0456" });
    await overwrittenByALaterEnquiry(morven.email, { name: "TEST ONLY M. Reid", phone: "0141 496 0456" });
    const lead = await leadOf(morven.email);

    for (const [who, enquiryId] of [["staff", atA], ["otherStaff", atB]] as const) {
      const seen = await seenBy(who, lead, enquiryId, "Morven Reid");
      expect(seen.recent?.leadId, who).toBeNull();
      expect(seen.upcoming?.leadId, who).toBeNull();
      expect(seen.search, who).toEqual([]);
      expect(seen.profile.statusCode, who).toBe(404);
    }
    expect((await get(`/clients/leads/${lead.id}/profile`, "platformAdmin")).statusCode).toBe(200);
  });

  it("still shows a venue a lead from before leads were written once when every enquiry under it was its own", async () => {
    const ewan: Guest = { email: `ewan.blair-${run}@example.test`, name: "TEST ONLY Ewan Blair", phone: "07700 900789" };
    const first = await enquire(f.venueId, ewan);
    const second = await enquire(f.venueId, { ...ewan, phone: "07700 900790" });
    await overwrittenByALaterEnquiry(ewan.email, { name: ewan.name, phone: "07700 900790" });
    const lead = await leadOf(ewan.email);

    const a = await seenBy("staff", lead, second, "Ewan Blair");
    expect(a.recent?.leadId).toBe(lead.id);
    expect(a.search).toEqual([expect.objectContaining({ phone: "07700 900790", enquiryCount: 2 })]);
    expect(a.profile.statusCode, a.profile.body).toBe(200);
    expect(a.profile.json<{ data: LeadProfile }>().data.enquiries.map((row) => row.id).sort()).toEqual([first, second].sort());
  });
});

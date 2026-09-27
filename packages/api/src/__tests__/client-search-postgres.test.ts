import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { clientRoutes } from "../routes/clients.js";

// ---------------------------------------------------------------------------
// The client search on the migrated disposable database (T-635, roadmap X1).
//
// A name heard on the phone is often spelt otherwise: "Mcdonald" for
// "MacDonald", "Hendersen" for "Henderson". Only real rows under pg_trgm
// (migration 0081) show which of them the search finds, that "henderson"
// brings back the contact, the account, the deal and the proposal, that a
// hallkeeper finds none of the commercial record, and that another venue's
// clients stay out of it.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Client search tests require the explicit disposable platform database");
  }
}

interface Found {
  readonly contacts: readonly { readonly id: string; readonly name: string; readonly accountName: string | null }[];
  readonly accounts: readonly { readonly name: string }[];
  readonly deals: readonly { readonly title: string; readonly contactName: string | null }[];
  readonly proposals: readonly { readonly title: string }[];
  readonly users: readonly unknown[];
  readonly guestLeads: readonly unknown[];
  readonly configurations: readonly unknown[];
}

describe.skipIf(target === undefined)("client search on the migrated disposable database", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const otherVenueId = randomUUID();

  function bearer(role: string, venue: string | null = venueId, platformRole: "none" | "admin" = "none"): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: randomUUID(), email: "search@clients.invalid", role, platformRole, venueId: venue })}` };
  }

  async function search(q: string, role = "staff", venue: string | null = venueId, platformRole: "none" | "admin" = "none"): Promise<Found> {
    const response = await server.inject({
      method: "GET", url: `/clients/search?q=${encodeURIComponent(q)}`, headers: bearer(role, venue, platformRole),
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ data: Found }>().data;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `client_search_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(clientRoutes, { db, prefix: "/clients" });
    await server.ready();

    await db.insert(schema.venues).values([
      { id: venueId, name: "Search venue", slug: venueId, address: "Test only" },
      { id: otherVenueId, name: "Another venue", slug: otherVenueId, address: "Test only" },
    ]);
    const [account] = await db.insert(schema.clientAccounts).values({ venueId, name: "Henderson Family" }).returning();
    const [ailsa] = await db.insert(schema.contacts).values([
      { venueId, clientAccountId: account?.id, name: "Ailsa Henderson", email: `ailsa-${venueId}@search.invalid` },
    ]).returning();
    await db.insert(schema.contacts).values([
      { venueId, name: "Fiona MacDonald", email: `fiona-${venueId}@search.invalid` },
      { venueId, name: "Iain Robertson", email: `iain-${venueId}@search.invalid` },
      { venueId, name: "Gone Henderson", email: `gone-${venueId}@search.invalid`, deletedAt: new Date() },
      { venueId: otherVenueId, name: "Morag Henderson", email: `morag-${venueId}@search.invalid` },
    ]);
    const [deal] = await db.insert(schema.opportunities).values({
      venueId, title: "Wedding reception, 5 June", primaryContactId: ailsa?.id, guestCount: 160,
    }).returning();
    await db.insert(schema.opportunities).values({ venueId: otherVenueId, title: "Henderson ball" });
    await db.insert(schema.proposals).values([
      { venueId, opportunityId: deal?.id, title: "Henderson wedding proposal" },
      { venueId: otherVenueId, title: "Henderson ball proposal" },
    ]);
  }, 60_000);

  afterAll(async () => { await server?.close(); await pool?.end(); });

  it("finds a MacDonald asked for as Mcdonald, and not a stranger", async () => {
    const found = await search("Mcdonald");
    expect(found.contacts.map((contact) => contact.name)).toEqual(["Fiona MacDonald"]);
  });

  it("finds a Henderson asked for as Hendersen", async () => {
    const found = await search("Hendersen");
    expect(found.contacts.map((contact) => contact.name)).toEqual(["Ailsa Henderson"]);
  });

  it("brings back the contact, the account, the deal and the proposal for henderson, and only this venue's", async () => {
    const found = await search("henderson");
    expect(found.contacts).toEqual([expect.objectContaining({ name: "Ailsa Henderson", accountName: "Henderson Family" })]);
    expect(found.accounts.map((row) => row.name)).toEqual(["Henderson Family"]);
    // The deal is found by its client's name, though its title does not say it.
    expect(found.deals).toEqual([expect.objectContaining({ title: "Wedding reception, 5 June", contactName: "Ailsa Henderson" })]);
    expect(found.proposals.map((row) => row.title)).toEqual(["Henderson wedding proposal"]);
  });

  it("gives a hallkeeper none of the commercial record", async () => {
    const found = await search("henderson", "hallkeeper");
    expect(found).toMatchObject({ contacts: [], accounts: [], deals: [], proposals: [] });
  });

  it("lets a platform admin search every venue", async () => {
    const found = await search("henderson", "admin", null, "admin");
    expect(found.contacts.map((row) => row.name)).toEqual(expect.arrayContaining(["Ailsa Henderson", "Morag Henderson"]));
    expect(found.proposals.map((row) => row.title)).toEqual(expect.arrayContaining(["Henderson wedding proposal", "Henderson ball proposal"]));
  });

  it("puts a name that contains the words before one that only sounds like them", async () => {
    await pool.query("INSERT INTO contacts (venue_id, name, email) VALUES ($1, 'Fiona Mcdonnell', $2)", [venueId, `fm-${venueId}@search.invalid`]);
    const found = await search("fiona mac");
    expect(found.contacts[0]?.name).toBe("Fiona MacDonald");
  });

  it("opens a contact's profile with their organisation, deals and proposals, for the commercial roles at their venue", async () => {
    const found = await search("henderson");
    const contactId = found.contacts[0]?.id ?? "";
    const open = (role: string, venue: string | null = venueId) => server.inject({
      method: "GET", url: `/clients/contacts/${contactId}/profile`, headers: bearer(role, venue),
    });
    const response = await open("sales");
    expect(response.statusCode).toBe(200);
    const profile = response.json<{ data: {
      contact: { name: string; account: { name: string } | null };
      deals: { title: string; guestCount: number | null }[];
      proposals: { title: string }[];
    } }>().data;
    expect(profile.contact).toMatchObject({ name: "Ailsa Henderson", account: { name: "Henderson Family" } });
    expect(profile.deals).toEqual([expect.objectContaining({ title: "Wedding reception, 5 June", guestCount: 160 })]);
    expect(profile.proposals.map((row) => row.title)).toEqual(["Henderson wedding proposal"]);
    // Not the commercial record's reader, and not this venue's contact.
    expect((await open("hallkeeper")).statusCode).toBe(403);
    expect((await open("staff", otherVenueId)).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: `/clients/contacts/${randomUUID()}/profile`, headers: bearer("staff") })).statusCode).toBe(404);
  });

  it("lists the clients whose events come next, soonest first, each guest with their own lead", async () => {
    const [room] = await pool.query<{ id: string }>(
      "INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline) VALUES ($1, 'Room', $2, 10, 10, 3, '[]') RETURNING id",
      [venueId, `room-${venueId}`],
    ).then((result) => result.rows);
    const today = await pool.query<{ day: string }>("SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS day");
    const day = today.rows[0]?.day ?? "";
    const shift = (days: number): string => {
      const date = new Date(`${day}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const email = `guest-${venueId}@search.invalid`;
    await pool.query("INSERT INTO guest_leads (email, name) VALUES ($1, 'Kirsty Guest')", [email]);
    const enquiry = async (name: string, preferred: string, state = "submitted"): Promise<void> => {
      await pool.query(
        "INSERT INTO enquiries (venue_id, space_id, name, email, guest_email, guest_name, preferred_date, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [venueId, room?.id, name, email, email, name, preferred, state],
      );
    };
    await enquiry("In a month", shift(30));
    await enquiry("Today", shift(0));
    await enquiry("Yesterday", shift(-1));
    await enquiry("Declined", shift(5), "rejected");
    await enquiry("Two years off", shift(800));
    const response = await server.inject({ method: "GET", url: "/clients/upcoming", headers: bearer("staff") });
    expect(response.statusCode).toBe(200);
    const rows = response.json<{ data: { guestName: string; leadId: string | null }[] }>().data;
    expect(rows.map((row) => row.guestName)).toEqual(["Today", "In a month"]);
    const lead = await pool.query<{ id: string }>("SELECT id FROM guest_leads WHERE email = $1", [email]);
    expect(rows.every((row) => row.leadId === lead.rows[0]?.id)).toBe(true);
    // Another venue's staff see none of them.
    const other = await server.inject({ method: "GET", url: "/clients/upcoming", headers: bearer("staff", otherVenueId) });
    expect(other.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it("takes the query's own wildcards literally", async () => {
    const found = await search("%%");
    expect(found.contacts).toEqual([]);
    expect(found.accounts).toEqual([]);
  });
});

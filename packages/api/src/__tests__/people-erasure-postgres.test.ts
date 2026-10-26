import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import * as schema from "../db/schema.js";
import { peopleRoutes } from "../routes/people.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Erasing a person from the People Book (release audit people-privacy-5), on
// the migrated disposable database: what goes is spread over a dozen tables,
// and only real rows show the chain of merged records, the venue scope and
// the booking a venue must keep.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

describe.skipIf(PLATFORM_TARGET === undefined)("erasing a person on the migrated disposable database", () => {
  let f: PeopleFixture;
  let spaceId: string;
  let otherSpaceId: string;
  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => { await server.register(peopleRoutes, { db, prefix: "/people" }); });
    const room = (venueId: string) => ({ id: randomUUID(), venueId, name: "TEST ONLY Saloon", slug: `saloon-${randomUUID()}`,
      widthM: "8", lengthM: "12", heightM: "4", floorPlanOutline: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 0, y: 12 }] });
    const here = room(f.venueId);
    const there = room(f.otherVenueId);
    await f.db.insert(schema.spaces).values([here, there]);
    spaceId = here.id;
    otherSpaceId = there.id;
  }, 120_000);
  // The fixture removes its venues' people, enquiries and rooms; the rows
  // this file adds beside them go first, and the venue-less ones by key.
  const receiptKeys: string[] = [];
  const leadEmails: string[] = [];
  const peopleIds: string[] = [];
  afterAll(async () => {
    if (f !== undefined) {
      const venues = [f.venueId, f.otherVenueId];
      await f.pool.query("DELETE FROM bookings WHERE venue_id = ANY($1::uuid[])", [venues]);
      await f.pool.query("DELETE FROM events WHERE venue_id = ANY($1::uuid[])", [venues]);
      await f.pool.query("DELETE FROM email_sends WHERE idempotency_key = ANY($1::text[])", [receiptKeys]);
      await f.pool.query("DELETE FROM guest_leads WHERE email = ANY($1::text[])", [leadEmails]);
      await f.pool.query("DELETE FROM general_audit_log WHERE target_id = ANY($1::text[])", [peopleIds]);
    }
    await f?.close();
  });

  function post(url: string, who: PeopleFixtureUser, payload: object = {}): Promise<LightMyRequestResponse> {
    return f.server.inject({ method: "POST", url, headers: f.bearer(who), payload });
  }

  async function enquiry(input: { venueId?: string; email: string; contactId?: string | null }): Promise<string> {
    const [row] = await f.db.insert(schema.enquiries).values({
      venueId: input.venueId ?? f.venueId, spaceId: input.venueId === f.otherVenueId ? otherSpaceId : spaceId,
      name: "TEST ONLY guest", email: input.email, guestEmail: input.email, contactId: input.contactId ?? null,
    }).returning({ id: schema.enquiries.id });
    if (row === undefined) throw new Error("enquiry fixture missing");
    return row.id;
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await f.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params);
    return rows[0]?.n ?? -1;
  }

  it("erases a person and the record merged into them, everywhere this venue holds them, and nowhere else", async () => {
    const tag = randomUUID().slice(0, 8);
    const mainEmail = `morag.erase-${tag}@example.test`;
    const oldEmail = `m.erase-${tag}@example.test`;
    const person = await f.addPerson({ name: "Morag Erasable", emails: [mainEmail], phones: ["+44 7700 900111"] });
    const duplicate = await f.addPerson({ name: "M. Erasable", emails: [oldEmail] });
    const merged = await post(`/people/${duplicate}/merge`, "staff", { survivorId: person });
    expect(merged.statusCode, merged.body).toBe(201);
    const mergeId = (merged.json<{ data: { mergeId: string } }>()).data.mergeId;

    const asked = await enquiry({ email: mainEmail, contactId: person });
    const elsewhere = await enquiry({ venueId: f.otherVenueId, email: oldEmail });
    const otherVenuesReceipt = `enquiry-acknowledged:${randomUUID()}`;
    const receipts = [`enquiry-acknowledged:${asked}`, `enquiry-new:${asked}:${randomUUID()}`, otherVenuesReceipt];
    receiptKeys.push(...receipts);
    leadEmails.push(mainEmail, oldEmail);
    peopleIds.push(person, duplicate);
    await f.db.insert(schema.emailSends).values([
      { idempotencyKey: receipts[0] ?? "", recipient: mainEmail, subject: "TEST ONLY thanks" },
      { idempotencyKey: receipts[1] ?? "", recipient: "staff@example.test", subject: "TEST ONLY new enquiry" },
      { idempotencyKey: otherVenuesReceipt, recipient: mainEmail, subject: "TEST ONLY elsewhere" },
    ]);
    await f.db.insert(schema.guestLeads).values([{ email: mainEmail, name: "Morag Erasable" }, { email: oldEmail, name: "M. Erasable" }]);

    // Sales may work the People Book, not erase from it; another venue's
    // team cannot see the person at all.
    expect((await post(`/people/${person}/erase`, "sales")).statusCode).toBe(403);
    expect((await post(`/people/${person}/erase`, "otherStaff")).statusCode).toBe(404);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [person])).toBe(1);

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: unknown } }>().data.counts).toEqual({
      people: 2, contactPoints: 3, enquiries: 1, mergeSnapshots: 1, guestLeads: 1, emailReceipts: 2, comments: 0,
    });

    const { rows: people } = await f.pool.query<Record<string, unknown>>(
      `SELECT name, email, phone, given_name, family_name, postal_address, notes, erased_at, deleted_at
         FROM contacts WHERE id = ANY($1::uuid[])`, [[person, duplicate]]);
    expect(people).toHaveLength(2);
    for (const row of people) {
      expect(row).toMatchObject({ name: "Erased", email: null, phone: null, given_name: null, family_name: null, postal_address: null, notes: null });
      expect(row["erased_at"]).not.toBeNull();
      expect(row["deleted_at"]).not.toBeNull();
    }
    expect(await count("contact_points WHERE contact_id = ANY($1::uuid[])", [[person, duplicate]])).toBe(0);
    const { rows: snapshots } = await f.pool.query<{ snapshot: unknown }>("SELECT snapshot FROM record_merges WHERE id = $1", [mergeId]);
    expect(JSON.stringify(snapshots)).not.toMatch(/Erasable|erase-|7700/u);

    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await count("enquiries WHERE id = $1", [elsewhere])).toBe(1);
    expect(await count("email_sends WHERE idempotency_key LIKE $1", [`%${asked}%`])).toBe(0);
    expect(await count("email_sends WHERE idempotency_key = $1", [otherVenuesReceipt])).toBe(1);
    // The old address still has another venue's enquiry, so its lead stays.
    expect(await count("guest_leads WHERE email = $1", [mainEmail])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [oldEmail])).toBe(1);

    const { rows: audit } = await f.pool.query<{ action: string; metadata: unknown }>(
      "SELECT action, metadata FROM general_audit_log WHERE target_id = $1", [person]);
    expect(audit.map((row) => row.action)).toEqual(["people.erased"]);
    expect(JSON.stringify(audit)).not.toMatch(/Erasable|erase-/u);

    // Gone from the People Book, never erased twice, and the merge stays done.
    const read = await f.server.inject({ method: "GET", url: `/people/${person}`, headers: f.bearer("admin") });
    expect(read.statusCode).toBe(404);
    expect((await post(`/people/${person}/erase`, "admin")).statusCode).toBe(404);
    const undo = await post(`/people/merges/${mergeId}/undo`, "staff");
    expect(undo.statusCode, undo.body).toBe(409);
    expect(undo.json<{ code: string }>().code).toBe("ERASED");
  });

  it("refuses a person with a booking the venue keeps, and changes nothing", async () => {
    const email = `kept-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Booked", emails: [email] });
    peopleIds.push(person);
    const asked = await enquiry({ email, contactId: person });
    const eventId = randomUUID();
    const startsAt = new Date("2026-11-20T18:00:00.000Z");
    const endsAt = new Date("2026-11-20T23:00:00.000Z");
    await f.db.insert(schema.events).values({ id: eventId, venueId: f.venueId, name: "TEST ONLY dinner", startsAt, endsAt });
    await f.db.insert(schema.bookings).values({ venueId: f.venueId, spaceId, eventId, enquiryId: asked, kind: "ink",
      title: "TEST ONLY dinner", startsAt, endsAt });

    const refused = await post(`/people/${person}/erase`, "manager");
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("PERSON_HAS_BOOKING");
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND email = $2", [person, email])).toBe(1);
    expect(await count("contact_points WHERE contact_id = $1", [person])).toBe(1);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(1);
    expect(await count("general_audit_log WHERE target_id = $1", [person])).toBe(0);
  });
});

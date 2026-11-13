import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import * as schema from "../db/schema.js";
import { peopleRoutes } from "../routes/people.js";
import { eraseLockedPerson } from "../services/people-erasure.js";
import { lockPerson } from "../services/people-records.js";
import { eraseLapsedPeople } from "../services/people-retention.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Erasing a person from the People Book (release audit people-privacy-5), on
// the migrated disposable database: what goes is spread over a dozen tables,
// and only real rows show the chain of merged records, the venue scope, an
// address two people share, and the booking or contract a venue must keep.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

function only<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`The fixture wrote no ${what}`);
  return row;
}

const deskPath = (proposalId: string): string => `/dashboard?view=proposals&proposal=${proposalId}`;

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
  // The fixture removes its venues' people, enquiries, deals and rooms; the
  // rows this file adds beside them go first, and the venue-less ones by key.
  const receiptKeys: string[] = [];
  const leadEmails: string[] = [];
  const peopleIds: string[] = [];
  afterAll(async () => {
    if (f !== undefined) {
      const venues = [f.venueId, f.otherVenueId];
      for (const table of ["proposal_deposit_requests", "proposals", "event_plan_notifications", "bookings", "events", "configurations"]) {
        await f.pool.query(`DELETE FROM ${table} WHERE venue_id = ANY($1::uuid[])`, [venues]);
      }
      await f.pool.query("DELETE FROM email_sends WHERE idempotency_key = ANY($1::text[])", [receiptKeys]);
      await f.pool.query("DELETE FROM guest_leads WHERE email = ANY($1::text[])", [leadEmails]);
      await f.pool.query("DELETE FROM general_audit_log WHERE target_id = ANY($1::text[])", [peopleIds]);
    }
    await f?.close();
  });

  function post(url: string, who: PeopleFixtureUser, payload: object = {}): Promise<LightMyRequestResponse> {
    return f.server.inject({ method: "POST", url, headers: f.bearer(who), payload });
  }

  async function enquiry(input: {
    venueId?: string; email: string; guestEmail?: string; contactId?: string | null; name?: string; createdAt?: Date;
  }): Promise<string> {
    const rows = await f.db.insert(schema.enquiries).values({
      venueId: input.venueId ?? f.venueId, spaceId: input.venueId === f.otherVenueId ? otherSpaceId : spaceId,
      name: input.name ?? "TEST ONLY guest", guestName: input.name ?? null, email: input.email, guestEmail: input.guestEmail ?? input.email,
      contactId: input.contactId ?? null,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt, updatedAt: input.createdAt }),
    }).returning({ id: schema.enquiries.id });
    return only(rows, "enquiry").id;
  }

  async function proposal(input: {
    venueId?: string; enquiryId?: string | null; opportunityId?: string | null; title?: string; acceptedName?: string | null;
    sentAt?: Date; madeAt?: Date; layoutId?: string;
  }): Promise<string> {
    const rows = await f.db.insert(schema.proposals).values({
      venueId: input.venueId ?? f.venueId, enquiryId: input.enquiryId ?? null, opportunityId: input.opportunityId ?? null,
      title: input.title ?? "TEST ONLY proposal", acceptedName: input.acceptedName ?? null, sentAt: input.sentAt ?? null,
      configurationId: input.layoutId ?? null,
      ...(input.madeAt === undefined ? {} : { createdAt: input.madeAt, updatedAt: input.madeAt }),
    }).returning({ id: schema.proposals.id });
    return only(rows, "proposal").id;
  }

  async function comment(proposalId: string, input: {
    authorType?: "client" | "staff"; authorEmail?: string | null; authorName?: string | null; body: string; createdAt?: Date;
  }): Promise<string> {
    const rows = await f.db.insert(schema.proposalComments).values({
      proposalId, authorType: input.authorType ?? "client", authorEmail: input.authorEmail ?? null,
      authorName: input.authorName ?? null, body: input.body,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    }).returning({ id: schema.proposalComments.id });
    return only(rows, "comment").id;
  }

  async function deal(input: { title?: string; primaryContactId?: string | null; sourceEnquiryId?: string | null; at?: Date }): Promise<string> {
    return only(await f.db.insert(schema.opportunities).values({ venueId: f.venueId, title: input.title ?? "TEST ONLY deal",
      primaryContactId: input.primaryContactId ?? null, sourceEnquiryId: input.sourceEnquiryId ?? null,
      ...(input.at === undefined ? {} : { createdAt: input.at, updatedAt: input.at }) })
      .returning({ id: schema.opportunities.id }), "deal").id;
  }

  async function shareLink(proposalId: string): Promise<void> {
    await f.pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'TESTONLY')",
      [proposalId, randomUUID().replaceAll("-", "").padEnd(64, "0")]);
  }

  /** A change in the event's feed copying what the client wrote, with the
   *  notice it raised, as client-answer-notice writes them. */
  async function changeCopy(input: {
    eventId: string; proposalId: string; sourceKind: "proposal_comment" | "proposal_response"; sourceId: string; label: string;
  }): Promise<{ change: string; notice: string }> {
    const title = `${input.label} wrote about the proposal`;
    const summary = `Version 1. “${input.label}: our son has a nut allergy”`;
    const rows = await f.db.insert(schema.eventPlanChanges).values({
      eventId: input.eventId, venueId: f.venueId, proposalId: input.proposalId, actorRole: "client", actorLabel: input.label,
      sourceKind: input.sourceKind, sourceId: input.sourceId, title, summary, affectedSurfaces: ["comments"], audienceRoles: ["staff"],
    }).returning({ id: schema.eventPlanChanges.id });
    const change = only(rows, "change").id;
    const notices = await f.db.insert(schema.eventPlanNotifications).values({
      changeId: change, eventId: input.eventId, venueId: f.venueId, audienceRole: "staff", title, body: summary,
    }).returning({ id: schema.eventPlanNotifications.id });
    return { change, notice: only(notices, "notice").id };
  }

  /** A venue notice with no change or event behind it, as notifyCommercialTeam writes. */
  async function notice(input: { body: string; actionPath: string; createdAt?: Date }): Promise<string> {
    const rows = await f.db.insert(schema.eventPlanNotifications).values({
      venueId: f.venueId, audienceRole: "staff", title: "TEST ONLY notice", body: input.body, actionPath: input.actionPath,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    }).returning({ id: schema.eventPlanNotifications.id });
    return only(rows, "notice").id;
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await f.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params);
    return rows[0]?.n ?? -1;
  }

  async function value(sql: string, params: unknown[]): Promise<unknown> {
    const { rows } = await f.pool.query<{ value: unknown }>(sql, params);
    return rows[0]?.value;
  }

  async function arrivedAt(enquiryId: string): Promise<Date> {
    const at = (await f.pool.query<{ at: Date }>("SELECT created_at AS at FROM enquiries WHERE id = $1", [enquiryId])).rows[0]?.at;
    if (at === undefined) throw new Error("The enquiry has no time");
    return new Date(at.getTime() + 2000);
  }

  /** An event on its own day with one booking on it, as the Diary binds them. */
  let day = 0;
  async function bookedEvent(input: {
    clientAccountId?: string; opportunityId?: string; enquiryId?: string | null;
    kind?: "ink" | "hold"; status?: "active" | "released";
    title?: string; eventName?: string; clientName?: string;
  }): Promise<string> {
    day += 1;
    const eventId = randomUUID();
    const startsAt = new Date(Date.UTC(2027, 0, day, 18));
    const endsAt = new Date(Date.UTC(2027, 0, day, 23));
    await f.db.insert(schema.events).values({ id: eventId, venueId: f.venueId, name: input.eventName ?? "TEST ONLY event", startsAt, endsAt,
      clientName: input.clientName ?? null, clientAccountId: input.clientAccountId ?? null, opportunityId: input.opportunityId ?? null });
    await f.db.insert(schema.bookings).values({ venueId: f.venueId, spaceId, eventId, enquiryId: input.enquiryId ?? null,
      kind: input.kind ?? "ink", status: input.status ?? "active", title: input.title ?? "TEST ONLY booking", startsAt, endsAt,
      ...(input.kind === "hold"
        ? { rank: 1, decisionAt: endsAt, nextAction: "TEST ONLY follow up", nextActionDueAt: startsAt, ownerUserId: f.users.staff }
        : {}) });
    return eventId;
  }

  async function refused(person: string, code: "PERSON_HAS_BOOKING" | "PERSON_HAS_CONTRACT"): Promise<void> {
    const answer = await post(`/people/${person}/erase`, "admin");
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json<{ code: string }>().code).toBe(code);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [person])).toBe(1);
  }

  async function merge(merged: string, survivor: string): Promise<string> {
    const answer = await post(`/people/${merged}/merge`, "staff", { survivorId: survivor });
    expect(answer.statusCode, answer.body).toBe(201);
    return answer.json<{ data: { mergeId: string } }>().data.mergeId;
  }

  it("erases a person and every record merged into them, every personal field, at this venue and nowhere else", async () => {
    const tag = randomUUID().slice(0, 8);
    const mainEmail = `morag.erase-${tag}@example.test`;
    const oldEmail = `m.erase-${tag}@example.test`;
    const oldestEmail = `morag.e-${tag}@example.test`;
    const person = await f.addPerson({ name: "Morag Erasable", emails: [mainEmail], phones: ["+44 7700 900111"] });
    const duplicate = await f.addPerson({ name: "M. Erasable", emails: [oldEmail], phones: ["+44 7700 900112"] });
    const oldest = await f.addPerson({ name: "Morag E.", emails: [oldestEmail] });
    // Every personal column, on the records. She has no job title, so the
    // merge fills hers from the duplicate's, and its snapshot says so.
    await f.pool.query(
      `UPDATE contacts SET given_name = 'Morag', family_name = 'Erasable', role_label = 'Erasable role',
         postal_address = '1 Erasable Lane', notes = 'Erasable notes', source_system = 'crm', source_id = $2 WHERE id = $1`,
      [person, `erasable-${tag}`],
    );
    await f.pool.query(
      `UPDATE contacts SET given_name = 'M.', family_name = 'Erasable', job_title = 'Erasable clerk', role_label = 'Erasable alias',
         postal_address = '9 Erasable Close', notes = 'Erasable duplicate notes', source_system = 'crm', source_id = $2 WHERE id = $1`,
      [duplicate, `dup-erasable-${tag}`],
    );
    const guild = await f.addOrganisation({ name: "TEST ONLY Guild", kind: "organisation" });
    const club = await f.addOrganisation({ name: "TEST ONLY Club", kind: "organisation" });
    const member = "INSERT INTO account_memberships (venue_id, contact_id, client_account_id, is_primary, role_label) VALUES ($1, $2, $3, false, $4)";
    await f.pool.query(member, [f.venueId, person, guild, "Erasable member"]);
    await f.pool.query(member, [f.venueId, duplicate, club, "Erasable alias member"]);
    // A chain two deep: the oldest record into the duplicate, the duplicate into her.
    const oldestMerge = await merge(oldest, duplicate);
    const mergeId = await merge(duplicate, person);
    expect(await value("SELECT jsonb_array_length(snapshot->'survivorFilled') AS value FROM record_merges WHERE id = $1", [mergeId]))
      .toBeGreaterThan(0);
    // A merge into her that was undone: that person is live again, and keeps their history.
    const parted = await f.addPerson({ name: "Ruth Parted", emails: [`ruth.parted-${tag}@example.test`] });
    const partedMerge = await merge(parted, person);
    const undone = await post(`/people/merges/${partedMerge}/undo`, "staff");
    expect(undone.statusCode, undone.body).toBeLessThan(300);

    const asked = await enquiry({ email: mainEmail, contactId: person });
    const elsewhere = await enquiry({ venueId: f.otherVenueId, email: oldEmail });
    const otherVenuesReceipt = `enquiry-acknowledged:${elsewhere}`;
    const receipts = [`enquiry-acknowledged:${asked}`, `enquiry-new:${asked}:${randomUUID()}`, otherVenuesReceipt];
    receiptKeys.push(...receipts);
    leadEmails.push(mainEmail, oldEmail);
    peopleIds.push(person, duplicate, oldest, parted);
    await f.db.insert(schema.emailSends).values([
      { idempotencyKey: receipts[0] ?? "", recipient: mainEmail, subject: "TEST ONLY thanks" },
      { idempotencyKey: receipts[1] ?? "", recipient: "staff@example.test", subject: "TEST ONLY new enquiry" },
      { idempotencyKey: otherVenuesReceipt, recipient: oldEmail, subject: "TEST ONLY elsewhere" },
    ]);
    await f.db.insert(schema.guestLeads).values([{ email: mainEmail, name: "Morag Erasable" }, { email: oldEmail, name: "M. Erasable" }]);

    // Sales and staff may work the People Book, not erase from it; another
    // venue's team cannot see the person at all; a merged record is erased
    // through the person it was merged into.
    expect((await post(`/people/${person}/erase`, "sales")).statusCode).toBe(403);
    expect((await post(`/people/${person}/erase`, "staff")).statusCode).toBe(403);
    expect((await post(`/people/${person}/erase`, "otherStaff")).statusCode).toBe(404);
    const tombstone = await post(`/people/${duplicate}/erase`, "admin");
    expect(tombstone.statusCode, tombstone.body).toBe(409);
    expect(tombstone.json<{ code: string; mergedIntoId: string }>()).toMatchObject({ code: "MERGED", mergedIntoId: person });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [person])).toBe(1);

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: unknown } }>().data.counts).toEqual({
      people: 3, contactPoints: 5, mergeSnapshots: 2, households: 0,
      enquiries: 1, guestLeads: 1, emailReceipts: 2, comments: 0, changeCopies: 0, notices: 0, proposals: 0, reworded: 0,
    });

    const { rows: people } = await f.pool.query<Record<string, unknown>>(
      `SELECT name, email, phone, given_name, family_name, job_title, role_label, postal_address, notes, source_system, source_id,
              erased_at, deleted_at
         FROM contacts WHERE id = ANY($1::uuid[])`, [[person, duplicate, oldest]]);
    expect(people).toHaveLength(3);
    for (const row of people) {
      expect(row).toMatchObject({
        name: "Erased", email: null, phone: null, given_name: null, family_name: null, job_title: null, role_label: null,
        postal_address: null, notes: null, source_system: null, source_id: null,
      });
      expect(row["erased_at"]).not.toBeNull();
      expect(row["deleted_at"]).not.toBeNull();
    }
    expect(await count("contact_points WHERE contact_id = ANY($1::uuid[])", [[person, duplicate, oldest]])).toBe(0);
    expect(await count("account_memberships WHERE contact_id = ANY($1::uuid[]) AND role_label IS NOT NULL", [[person, duplicate, oldest]])).toBe(0);
    // The snapshots that copied her lose the copy: names, addresses, phones,
    // import ids, membership labels and what the merge filled in.
    const { rows: snapshots } = await f.pool.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM record_merges WHERE id = ANY($1::uuid[])", [[mergeId, oldestMerge]]);
    expect(snapshots).toHaveLength(2);
    expect(JSON.stringify(snapshots)).not.toMatch(/erasable|erase-|morag|7700|M\.|crm/iu);
    // The undone merge copied someone live again: it is theirs, untouched.
    expect(JSON.stringify(await value("SELECT snapshot AS value FROM record_merges WHERE id = $1", [partedMerge]))).toMatch(/Ruth Parted/u);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND name = 'Ruth Parted'", [parted])).toBe(1);

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
    await bookedEvent({ enquiryId: asked });

    const answer = await post(`/people/${person}/erase`, "manager");
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json<{ code: string }>().code).toBe("PERSON_HAS_BOOKING");
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND email = $2", [person, email])).toBe(1);
    expect(await count("contact_points WHERE contact_id = $1", [person])).toBe(1);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(1);
    expect(await count("general_audit_log WHERE target_id = $1", [person])).toBe(0);
  });

  it("erases a person whose only hold was released: a released hold is not a booking", async () => {
    const email = `released-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Kirsty Released", emails: [email] });
    peopleIds.push(person);
    const asked = await enquiry({ email, contactId: person });
    await bookedEvent({ enquiryId: asked, kind: "hold", status: "released" });
    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
  });

  it("refuses a person whose event was inked straight onto it after their enquiry's hold was released", async () => {
    // The hold that came from the enquiry is gone; the date was confirmed on
    // the event itself, so the confirmed booking carries no enquiry at all.
    const email = `inked-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Ruaridh Inked", emails: [email] });
    peopleIds.push(person);
    const asked = await enquiry({ email, contactId: person });
    const eventId = await bookedEvent({ enquiryId: asked, kind: "hold", status: "released" });
    day += 1;
    const startsAt = new Date(Date.UTC(2027, 0, day, 18));
    await f.db.insert(schema.bookings).values({ venueId: f.venueId, spaceId, eventId, kind: "ink", title: "TEST ONLY inked",
      startsAt, endsAt: new Date(startsAt.getTime() + 5 * 3600_000) });
    await refused(person, "PERSON_HAS_BOOKING");
  });

  it("refuses the main contact of a booked deal or organisation, and a member of a booked household", async () => {
    const dealContact = await f.addPerson({ name: "Ailsa Deal", emails: [`deal-${randomUUID().slice(0, 8)}@example.test`] });
    await bookedEvent({ opportunityId: await deal({ primaryContactId: dealContact }) });

    const organisation = await f.addOrganisation({ name: "TEST ONLY Guild", kind: "organisation" });
    const organisationContact = await f.addPerson({ name: "Callum Lead", organisations: [organisation] });
    await f.pool.query("UPDATE client_accounts SET primary_contact_id = $1 WHERE id = $2", [organisationContact, organisation]);
    await bookedEvent({ clientAccountId: organisation });

    const household = await f.addOrganisation({ name: "TEST ONLY Household", kind: "household" });
    const householdMember = await f.addPerson({ name: "Morven Home", organisations: [household] });
    await bookedEvent({ clientAccountId: household, kind: "hold" });

    peopleIds.push(dealContact, organisationContact, householdMember);
    for (const person of [dealContact, organisationContact, householdMember]) await refused(person, "PERSON_HAS_BOOKING");
  });

  it("still erases an organisation's other members: the booking is the organisation's, not theirs", async () => {
    const organisation = await f.addOrganisation({ name: "TEST ONLY Lodge", kind: "organisation" });
    const member = await f.addPerson({ name: "Euan Member", organisations: [organisation] });
    peopleIds.push(member);
    await bookedEvent({ clientAccountId: organisation });
    const erased = await post(`/people/${member}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NOT NULL", [member])).toBe(1);
  });

  it("counts an event reached only through their proposal's layout as theirs: its booking keeps them, its name loses them", async () => {
    const email = `fergus.layout-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Fergus Layout", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Fergus Layout" });
    const layout = only(await f.db.insert(schema.configurations).values({ venueId: f.venueId, spaceId, name: "TEST ONLY layout",
      layoutStyle: "dinner-rounds" }).returning({ id: schema.configurations.id }), "layout").id;
    await proposal({ enquiryId: asked, layoutId: layout });
    // Made by staff from the layout: no deal, and no enquiry on its booking.
    const eventId = await bookedEvent({ eventName: "Fergus Layout — Dinner", clientName: "Fergus Layout" });
    await f.db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: layout, linkType: "source_configuration" });
    await refused(person, "PERSON_HAS_BOOKING");

    // A confirmed booking taken out of the Diary is no longer one the venue keeps.
    await f.pool.query("UPDATE bookings SET deleted_at = now() WHERE event_id = $1", [eventId]);
    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await value("SELECT row_to_json(e) AS value FROM (SELECT name, client_name FROM events WHERE id = $1) e", [eventId]))
      .toEqual({ name: "Erased — Dinner", client_name: "Erased" });
  });

  it("refuses a person with a deposit requested or a contract prepared on a proposal of theirs, even with the hold released", async () => {
    const depositEmail = `deposit-${randomUUID().slice(0, 8)}@example.test`;
    const depositor = await f.addPerson({ name: "Fiona Deposit", emails: [depositEmail] });
    peopleIds.push(depositor);
    const asked = await enquiry({ email: depositEmail, contactId: depositor });
    await bookedEvent({ enquiryId: asked, kind: "hold", status: "released" });
    const offered = await proposal({ enquiryId: asked });
    await f.db.insert(schema.proposalDepositRequests).values({ venueId: f.venueId, proposalId: offered, proposalVersion: 1,
      proposalVersionHash: "a".repeat(64), basis: "amount", quoteTotalMinor: 100_000, amountMinor: 25_000, currency: "GBP" });
    await refused(depositor, "PERSON_HAS_CONTRACT");
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(1);

    // A signed contract can never be removed, so it is written and the
    // erasure tried inside one transaction that is then rolled back.
    const signerEmail = `signed-${randomUUID().slice(0, 8)}@example.test`;
    const signer = await f.addPerson({ name: "Graham Signed", emails: [signerEmail] });
    peopleIds.push(signer);
    const signedEnquiry = await enquiry({ email: signerEmail, contactId: signer });
    await bookedEvent({ enquiryId: signedEnquiry, kind: "hold", status: "released" });
    const signedProposal = await proposal({ enquiryId: signedEnquiry });
    class RolledBack extends Error {}
    const seen: { outcome: unknown } = { outcome: undefined };
    await expect(f.db.transaction(async (tx) => {
      const version = only(await tx.insert(schema.proposalContractVersions).values({
        venueId: f.venueId, proposalId: signedProposal, version: 1, proposalVersion: 1, proposalVersionHash: "b".repeat(64),
        document: { client: { name: "Graham Signed", email: signerEmail } }, documentHash: "c".repeat(64),
      }).returning({ id: schema.proposalContractVersions.id }), "contract version");
      await tx.insert(schema.proposalContractSignatures).values({ venueId: f.venueId, contractVersionId: version.id,
        documentHash: "c".repeat(64), signerName: "Graham Signed", signerEmail, consentStatement: "TEST ONLY I agree" });
      const lock = await lockPerson(tx, f.venueId, signer);
      if (lock.state !== "live") throw new Error("The signer is not live");
      seen.outcome = await eraseLockedPerson(tx, lock.row, { actorUserId: f.users.admin, now: new Date() });
      throw new RolledBack();
    })).rejects.toBeInstanceOf(RolledBack);
    expect(seen.outcome).toEqual({ ok: false, refusal: "has_contract" });
    expect(await count("proposal_contract_versions WHERE proposal_id = $1", [signedProposal])).toBe(0);
  });

  it("erases the reason given for a decision on their booking, the one thing a decision lets go of", async () => {
    // Decisions are kept for good (migration 0108), so the decision is
    // written and the erasure run inside one transaction that is rolled back.
    const email = `nessa.decided-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Nessa Decided", emails: [email] });
    peopleIds.push(person);
    const asked = await enquiry({ email, contactId: person, name: "Nessa Decided" });
    const eventId = await bookedEvent({ enquiryId: asked, kind: "hold", status: "released" });
    const hold = only((await f.pool.query<{ id: string }>("SELECT id FROM bookings WHERE event_id = $1", [eventId])).rows, "hold").id;
    class RolledBack extends Error {}
    const seen: { outcome: unknown; reason: unknown } = { outcome: undefined, reason: "unread" };
    await expect(f.db.transaction(async (tx) => {
      await tx.execute(sql`insert into decisions (venue_id, action_class, subject_kind, subject_id, body, reason, prepared_by, expires_at)
        values (${f.venueId}, 'booking_time_move', 'booking', ${hold}, '{}'::jsonb, 'TEST ONLY Nessa wants to start later',
          ${f.users.staff}, now() + interval '1 day')`);
      const lock = await lockPerson(tx, f.venueId, person);
      if (lock.state !== "live") throw new Error("The person is not live");
      seen.outcome = await eraseLockedPerson(tx, lock.row, { actorUserId: f.users.admin, now: new Date() });
      seen.reason = (await tx.execute(sql`select reason from decisions where subject_id = ${hold}`)).rows[0]?.["reason"];
      throw new RolledBack();
    })).rejects.toBeInstanceOf(RolledBack);
    expect(seen.outcome).toMatchObject({ ok: true, counts: { reworded: 1 } });
    expect(seen.reason).toBeNull();
  });

  it("leaves a partner who shares the address alone: their enquiry, comment, live hold, notice and the lead", async () => {
    const shared = `couple-${randomUUID().slice(0, 8)}@example.test`;
    const ownAddress = `ailsa-${randomUUID().slice(0, 8)}@example.test`;
    const partner = await f.addPerson({ name: "Ailsa Partner", emails: [shared, ownAddress] });
    const other = await f.addPerson({ name: "Brodie Partner", emails: [shared] });
    await f.keepApart(partner, other);
    peopleIds.push(partner, other);
    leadEmails.push(shared, ownAddress);
    const ofPartner = await enquiry({ email: shared, contactId: partner });
    const ofOther = await enquiry({ email: shared, contactId: other });
    const unlinked = await enquiry({ email: shared });
    // Sent from an address only the partner holds, but filed under the other:
    // an enquiry linked to someone is theirs, whatever its address.
    const filedUnderOther = await enquiry({ email: ownAddress, contactId: other });
    // A deleted duplicate holding her own address is nobody to share it with,
    // and neither is a record merged away that still holds it.
    const deletedDuplicate = await f.addPerson({ name: "Ailsa Duplicate", emails: [ownAddress] });
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deletedDuplicate]);
    const mergedAway = await f.addPerson({ name: "Ailsa Merged", emails: [ownAddress] });
    await f.pool.query("UPDATE contacts SET merged_into_id = $2 WHERE id = $1", [mergedAway, other]);
    peopleIds.push(deletedDuplicate, mergedAway);
    const unlinkedOwn = await enquiry({ email: ownAddress });
    // Sent through a form whose reply address is hers: hers by its guest email.
    const byGuestEmail = await enquiry({ email: `venue-form-${randomUUID().slice(0, 8)}@example.test`, guestEmail: ownAddress });
    // The other's live hold is theirs, not the partner's: it does not hold the erasure back.
    await bookedEvent({ enquiryId: ofOther, kind: "hold" });
    const offered = await proposal({ enquiryId: ofOther });
    const theirWords = await comment(offered, { authorEmail: shared, body: "TEST ONLY a question of Brodie's" });
    await f.db.insert(schema.guestLeads).values({ email: shared, name: "TEST ONLY partners" });
    // The notice of her enquiry from the shared inbox could equally be the
    // other's, sent from it in the same minutes: it stays.
    const sharedNotice = await notice({ body: `${shared} enquired about TEST ONLY Saloon. Open Enquiries to respond.`,
      actionPath: "/dashboard?view=enquiries", createdAt: await arrivedAt(ofPartner) });

    const erased = await post(`/people/${partner}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { enquiries: number; comments: number; guestLeads: number; notices: number } } }>().data.counts)
      .toMatchObject({ enquiries: 3, comments: 0, guestLeads: 0, notices: 0 });
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[ofPartner, unlinkedOwn, byGuestEmail]])).toBe(0);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[ofOther, unlinked, filedUnderOther]])).toBe(3);
    expect(await count("proposal_comments WHERE id = $1", [theirWords])).toBe(1);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND email = $2", [other, shared])).toBe(1);
    expect(await count("guest_leads WHERE email = $1", [shared])).toBe(1);
    expect(await count("event_plan_notifications WHERE id = $1", [sharedNotice])).toBe(1);
  });

  it("hands a household shared with a live partner over to them, taking only the erased person's name out of it", async () => {
    const household = await f.addOrganisation({ name: "Ailsa Hearth's household", kind: "household" });
    await f.pool.query("UPDATE client_accounts SET address = '3 Shared Wynd', notes = 'TEST ONLY Ailsa Hearth prefers mornings' WHERE id = $1",
      [household]);
    const leaving = await f.addPerson({ name: "Ailsa Hearth", emails: [`ailsa.hearth-${randomUUID().slice(0, 8)}@example.test`], organisations: [household] });
    const staying = await f.addPerson({ name: "Brodie Hearth", emails: [`brodie.hearth-${randomUUID().slice(0, 8)}@example.test`], organisations: [household] });
    await f.pool.query("UPDATE client_accounts SET primary_contact_id = $1 WHERE id = $2", [leaving, household]);
    // One she belongs to without leading it stays its lead's, without her name.
    const theirs = await f.addOrganisation({ name: "Brodie Hearth and Ailsa Hearth", kind: "household" });
    await f.pool.query("INSERT INTO account_memberships (venue_id, contact_id, client_account_id, is_primary) VALUES ($1, $2, $3, false), ($1, $4, $3, false)",
      [f.venueId, leaving, theirs, staying]);
    await f.pool.query("UPDATE client_accounts SET primary_contact_id = $1 WHERE id = $2", [staying, theirs]);
    peopleIds.push(leaving, staying);

    const erased = await post(`/people/${leaving}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { households: number } } }>().data.counts.households).toBe(1);
    expect(await value(`SELECT row_to_json(a) AS value FROM (SELECT name, address, notes, primary_contact_id FROM client_accounts WHERE id = $1) a`,
      [household])).toEqual({ name: "Erased's household", address: "3 Shared Wynd", notes: "TEST ONLY Erased prefers mornings", primary_contact_id: staying });
    expect(await value("SELECT row_to_json(a) AS value FROM (SELECT name, primary_contact_id FROM client_accounts WHERE id = $1) a", [theirs]))
      .toEqual({ name: "Brodie Hearth and Erased", primary_contact_id: staying });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [staying])).toBe(1);
  });

  it("leaves a full name another live person at the venue goes by: that text may be theirs", async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `jo.namesake-${tag}@example.test`;
    const person = await f.addPerson({ name: "Jo Namesake", emails: [email] });
    const namesake = await f.addPerson({ name: "Jo Namesake", emails: [`jo.other-${tag}@example.test`] });
    await f.keepApart(person, namesake);
    peopleIds.push(person, namesake);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Jo Namesake" });
    const dealId = await deal({ title: `Jo Namesake — ${email}`, primaryContactId: person, sourceEnquiryId: asked });

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    // Her address leaves the deal; the name, which is also the other's, stays.
    expect(await value("SELECT title AS value FROM opportunities WHERE id = $1", [dealId])).toBe("Jo Namesake — Erased");
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND name = 'Jo Namesake'", [namesake])).toBe(1);
  });

  it("leaves a deal made from their enquiry to the live person who now leads it: only their name leaves it", async () => {
    // A PA enquired; her director became the deal's main contact and accepted.
    const tag = randomUUID().slice(0, 8);
    const assistantEmail = `ailsa.pa-${tag}@example.test`;
    const assistant = await f.addPerson({ name: "Ailsa Assistant", emails: [assistantEmail] });
    const director = await f.addPerson({ name: "Brodie Director", emails: [`brodie.director-${tag}@example.test`] });
    peopleIds.push(assistant, director);
    leadEmails.push(assistantEmail);
    const asked = await enquiry({ email: assistantEmail, contactId: assistant, name: "Ailsa Assistant" });
    const his = await deal({ title: "Dinner — Ailsa Assistant", primaryContactId: director, sourceEnquiryId: asked });
    const offered = await proposal({ enquiryId: asked, opportunityId: his, title: "Ailsa Assistant's dinner for Brodie Director",
      acceptedName: "Brodie Director" });
    await shareLink(offered);
    const hisWords = await comment(offered, { authorName: "Brodie Director", body: "TEST ONLY we accept" });
    await f.db.insert(schema.proposalStatusHistory).values({ proposalId: offered, fromStatus: "sent", toStatus: "accepted", changedBy: null,
      note: "TEST ONLY his note" });

    const erased = await post(`/people/${assistant}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { enquiries: number; comments: number } } }>().data.counts)
      .toMatchObject({ enquiries: 1, comments: 0 });
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await value("SELECT row_to_json(d) AS value FROM (SELECT title, primary_contact_id FROM opportunities WHERE id = $1) d", [his]))
      .toEqual({ title: "Dinner — Erased", primary_contact_id: director });
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT title, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ title: "Erased's dinner for Brodie Director", accepted_name: "Brodie Director" });
    expect(await count("proposal_comments WHERE id = $1", [hisWords])).toBe(1);
    expect(await value("SELECT note AS value FROM proposal_status_history WHERE proposal_id = $1", [offered])).toBe("TEST ONLY his note");
    expect(await count("proposal_share_tokens WHERE proposal_id = $1 AND revoked_at IS NULL", [offered])).toBe(1);
  });

  it("takes the person out of what the venue keeps: household, deal, proposal, Diary, change feed and notices", async () => {
    const tag = randomUUID().slice(0, 8);
    const current = `isla.now-${tag}@example.test`;
    const old = `isla.old-${tag}@example.test`;
    const inbox = `erasable.home-${tag}@example.test`;
    const household = await f.addOrganisation({ name: "Isla Erasable", kind: "household" });
    await f.pool.query("UPDATE client_accounts SET address = '2 Erasable Road', notes = 'TEST ONLY Isla prefers calls', vat_number = 'GB000' WHERE id = $1",
      [household]);
    const person = await f.addPerson({ name: "Isla Erasable", emails: [current], organisations: [household] });
    await f.pool.query("UPDATE contacts SET given_name = 'Isla', family_name = 'Erasable' WHERE id = $1", [person]);
    // Her partner, at the venue on his own record, with the inbox they share.
    const partner = await f.addPerson({ name: "Brodie Erasable", emails: [inbox] });
    peopleIds.push(person, partner);
    leadEmails.push(current, old);
    // Her first enquiry came from an address she has since replaced, typed
    // in lower case: its lead and what she signed with it go too.
    const asked = await enquiry({ email: old, contactId: person, name: "isla erasable" });
    await f.db.insert(schema.guestLeads).values({ email: old, name: "Isla Erasable", phone: "+44 7700 900222" });

    const dealId = await deal({ title: "Wedding — Isla Erasable", primaryContactId: person, sourceEnquiryId: asked });
    await f.pool.query("UPDATE opportunities SET next_action = 'Call Isla Erasable about the menus' WHERE id = $1", [dealId]);
    await f.db.insert(schema.activities).values({ opportunityId: dealId, body: "Isla Erasable asked about the Saloon", createdBy: f.users.staff });
    await f.db.insert(schema.opportunityStatusHistory).values({ opportunityId: dealId, fromStage: "proposal", toStage: "lost",
      changedBy: f.users.staff, note: "Isla Erasable chose another date" });
    const offered = await proposal({ opportunityId: dealId, title: "Isla Erasable's wedding", acceptedName: "Isla Erasable" });
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "Isla Erasable's wedding", clientMessage: "Dear Isla Erasable, here is your proposal." }), "d".repeat(64)]);
    await shareLink(offered);
    const fromLink = await comment(offered, { authorEmail: current, authorName: "Isla Erasable", body: "Our son has a nut allergy" });
    const unsigned = await comment(offered, { authorName: "Isla", body: "Could we move the date?" });
    const staffWords = await comment(offered, { authorType: "staff", authorName: "TEST ONLY staff", body: "Spoke to Isla Erasable on the phone" });
    // Signed from the inbox her partner holds: his, kept, without her name.
    const fromInbox = await comment(offered, { authorEmail: inbox, authorName: "Isla Erasable", body: "TEST ONLY can Isla Erasable bring the cake?" });
    await f.db.insert(schema.proposalStatusHistory).values([
      { proposalId: offered, fromStatus: "sent", toStatus: "changes_requested", changedBy: null, note: "Our son has a nut allergy" },
      { proposalId: offered, fromStatus: "draft", toStatus: "sent", changedBy: f.users.staff, note: "Sent to Isla Erasable" },
    ]);

    const eventId = await bookedEvent({ enquiryId: asked, opportunityId: dealId, kind: "hold", status: "released",
      title: "isla erasable — Wedding", eventName: "Isla Erasable — Wedding", clientName: "Isla Erasable" });
    const hold = only((await f.pool.query<{ id: string }>("SELECT id FROM bookings WHERE event_id = $1", [eventId])).rows, "hold");
    await f.db.insert(schema.eventPhases).values({ eventId, name: "TEST ONLY ceremony", sortOrder: 1, notes: "Isla Erasable walks in first" });
    await changeCopy({ eventId, proposalId: offered, sourceKind: "proposal_comment", sourceId: fromLink, label: "Isla Erasable" });
    await changeCopy({ eventId, proposalId: offered, sourceKind: "proposal_response", sourceId: offered, label: "Isla Erasable" });
    const proposalNotice = await notice({ body: "Isla Erasable wrote about Isla Erasable's wedding", actionPath: deskPath(offered) });
    const arrived = await arrivedAt(asked);
    const enquiryNotice = await notice({ body: "isla erasable enquired about TEST ONLY Saloon for a wedding. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    const someoneElse = await notice({ body: "Ruth Kept enquired about TEST ONLY Saloon. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    // Another enquirer whose name begins with hers is not her.
    const longerName = await notice({ body: "isla erasable Brown enquired about TEST ONLY Saloon. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    const promotion = await notice({ body: "Isla Erasable — Wedding has moved up to first in line.",
      actionPath: `/dashboard?view=diary&day=2027-01-01&booking=${hold.id}` });

    // On someone else's proposal: what she signed from her old address, and
    // an acceptance she typed her name into. That client's record, with every
    // copy, kept without her.
    const otherEvent = await bookedEvent({ title: "TEST ONLY someone else's booking" });
    const otherOffer = await proposal({ title: "TEST ONLY someone else's proposal" });
    const fromOldAddress = await comment(otherOffer, { authorEmail: old, authorName: "Isla Erasable", body: "TEST ONLY Isla Erasable agrees to the change" });
    const oldCopy = await changeCopy({ eventId: otherEvent, proposalId: otherOffer, sourceKind: "proposal_comment", sourceId: fromOldAddress,
      label: "Isla Erasable" });
    const deskNotice = await notice({ body: "Isla Erasable asked for changes to TEST ONLY someone else's proposal", actionPath: deskPath(otherOffer) });
    const acceptOffer = await proposal({ title: "TEST ONLY a director's proposal", acceptedName: "Isla Erasable" });
    const acceptCopy = await changeCopy({ eventId: otherEvent, proposalId: acceptOffer, sourceKind: "proposal_response", sourceId: acceptOffer,
      label: "Isla Erasable" });
    const elsewhereOffer = await proposal({ venueId: f.otherVenueId, title: "TEST ONLY another venue's proposal" });
    const elsewhereWords = await comment(elsewhereOffer, { authorEmail: current, body: "TEST ONLY another venue's to erase" });

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: unknown } }>().data.counts).toEqual({
      people: 1, contactPoints: 1, mergeSnapshots: 0, households: 1,
      enquiries: 1, guestLeads: 1, emailReceipts: 0, comments: 2, changeCopies: 2, notices: 2, proposals: 2, reworded: 18,
    });

    // Her household keeps its row, without her.
    expect(await value("SELECT row_to_json(a) AS value FROM (SELECT name, address, notes, vat_number FROM client_accounts WHERE id = $1) a", [household]))
      .toEqual({ name: "Erased", address: null, notes: null, vat_number: null });
    // The venue's own records keep their rows and lose her name.
    expect(await value("SELECT row_to_json(d) AS value FROM (SELECT title, next_action FROM opportunities WHERE id = $1) d", [dealId]))
      .toEqual({ title: "Wedding — Erased", next_action: "Call Erased about the menus" });
    expect(await value("SELECT body AS value FROM activities WHERE opportunity_id = $1", [dealId])).toBe("Erased asked about the Saloon");
    expect(await value("SELECT note AS value FROM opportunity_status_history WHERE opportunity_id = $1", [dealId])).toBe("Erased chose another date");
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT title, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ title: "Erased's wedding", accepted_name: null });
    // The version the client was sent loses her name, its digest made again;
    // her link no longer opens it.
    expect(await value("SELECT row_to_json(v) AS value FROM (SELECT payload, source_hash <> repeat('d', 64) AS rehashed FROM proposal_versions WHERE proposal_id = $1) v", [offered]))
      .toEqual({ payload: { title: "Erased's wedding", clientMessage: "Dear Erased, here is your proposal." }, rehashed: true });
    expect(await count("proposal_share_tokens WHERE proposal_id = $1 AND revoked_at IS NULL", [offered])).toBe(0);
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT author_name, author_email, body FROM proposal_comments WHERE id = $1) c", [fromInbox]))
      .toEqual({ author_name: "Erased", author_email: inbox, body: "TEST ONLY can Erased bring the cake?" });
    // The lower-case copy of her name, typed into the enquiry, leaves the hold made from it.
    expect(await value("SELECT title AS value FROM bookings WHERE id = $1", [hold.id])).toBe("Erased — Wedding");
    expect(await value("SELECT row_to_json(e) AS value FROM (SELECT name, client_name FROM events WHERE id = $1) e", [eventId]))
      .toEqual({ name: "Erased — Wedding", client_name: "Erased" });
    expect(await value("SELECT notes AS value FROM event_phases WHERE event_id = $1", [eventId])).toBe("Erased walks in first");
    expect(await value("SELECT body AS value FROM proposal_comments WHERE id = $1", [staffWords])).toBe("Spoke to Erased on the phone");
    const { rows: notes } = await f.pool.query<{ note: string | null }>(
      "SELECT note FROM proposal_status_history WHERE proposal_id = $1 ORDER BY changed_by NULLS FIRST", [offered]);
    expect(notes.map((row) => row.note)).toEqual([null, "Sent to Erased"]);
    expect(await value("SELECT body AS value FROM event_plan_notifications WHERE id = $1", [promotion]))
      .toBe("Erased — Wedding has moved up to first in line.");

    // Someone else's proposal keeps what she wrote and accepted, and every copy, without her.
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT author_name, author_email, body FROM proposal_comments WHERE id = $1) c", [fromOldAddress]))
      .toEqual({ author_name: null, author_email: null, body: "TEST ONLY Erased agrees to the change" });
    expect(await value("SELECT accepted_name AS value FROM proposals WHERE id = $1", [acceptOffer])).toBe("Erased");
    const { rows: copies } = await f.pool.query<{ actor_label: string; title: string; summary: string }>(
      "SELECT actor_label, title, summary FROM event_plan_changes WHERE id = ANY($1::uuid[])", [[oldCopy.change, acceptCopy.change]]);
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy).toEqual({ actor_label: "Erased", title: "Erased wrote about the proposal", summary: "Version 1. “Erased: our son has a nut allergy”" });
    }
    const { rows: copiedNotices } = await f.pool.query<{ title: string; body: string }>(
      "SELECT title, body FROM event_plan_notifications WHERE id = ANY($1::uuid[]) ORDER BY title", [[oldCopy.notice, acceptCopy.notice, deskNotice]]);
    expect(copiedNotices).toEqual([
      { title: "Erased wrote about the proposal", body: "Version 1. “Erased: our son has a nut allergy”" },
      { title: "Erased wrote about the proposal", body: "Version 1. “Erased: our son has a nut allergy”" },
      { title: "TEST ONLY notice", body: "Erased asked for changes to TEST ONLY someone else's proposal" },
    ]);
    expect(await value("SELECT name AS value FROM events WHERE id = $1", [otherEvent])).toBe("TEST ONLY event");

    // What she wrote on her own proposal, and every copy of it, is gone;
    // another venue's is not ours to erase.
    expect(await count("proposal_comments WHERE id = ANY($1::uuid[])", [[fromLink, unsigned]])).toBe(0);
    expect(await count("proposal_comments WHERE id = $1", [elsewhereWords])).toBe(1);
    expect(await count("event_plan_changes WHERE event_id = $1", [eventId])).toBe(0);
    expect(await count("event_plan_notifications WHERE event_id = $1", [eventId])).toBe(0);
    expect(await count("event_plan_notifications WHERE id = ANY($1::uuid[])", [[proposalNotice, enquiryNotice]])).toBe(0);
    expect(await count("event_plan_notifications WHERE id = ANY($1::uuid[])", [[someoneElse, longerName]])).toBe(2);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [old])).toBe(0);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [partner])).toBe(1);
  });

  it("erases people and lone enquiries 24 months after the last contact of any kind, and rehearses it exactly", async () => {
    // A fixed night: 24 calendar months before 1 March 2028 is 1 March 2026,
    // 731 days, across 29 February 2028. Exactly at the cutoff is still in
    // touch; a day earlier is not. A rule of 730 or 732 days fails here.
    const now = new Date("2028-03-01T12:00:00Z");
    const dayMs = 86_400_000;
    const lapsedAt = new Date(now.getTime() - 732 * dayMs);
    const boundaryAt = new Date(now.getTime() - 731 * dayMs);
    const freshAt = new Date(now.getTime() - 7 * dayMs);
    async function aged(table: "contacts" | "enquiries" | "opportunities" | "proposals", id: string, at: Date): Promise<void> {
      const lastContact = table === "contacts" ? ", last_contact_at = $2" : "";
      await f.pool.query(`UPDATE ${table} SET created_at = $2, updated_at = $2${lastContact} WHERE id = $1`, [id, at]);
    }
    async function agedBookings(eventId: string, at: Date): Promise<void> {
      await f.pool.query("UPDATE bookings SET created_at = $2, updated_at = $2 WHERE event_id = $1", [eventId, at]);
    }
    async function personWithEnquiry(name: string, at: Date, extraEmails: readonly string[] = []): Promise<{ person: string; asked: string; email: string }> {
      const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
      const person = await f.addPerson({ name, emails: [email, ...extraEmails] });
      peopleIds.push(person);
      leadEmails.push(email, ...extraEmails);
      const asked = await enquiry({ email, contactId: person });
      await aged("contacts", person, at);
      await aged("enquiries", asked, at);
      return { person, asked, email };
    }

    const lapsed = await personWithEnquiry("Lapsed", lapsedAt);
    // An old enquiry from her address that nobody linked goes with her, once.
    const lapsedUnlinked = await enquiry({ email: lapsed.email });
    await aged("enquiries", lapsedUnlinked, lapsedAt);
    const boundary = await personWithEnquiry("Boundary", boundaryAt);
    // Old records the team is still working with: a note on their deal, a proposal sent last week.
    const working = await personWithEnquiry("Working", lapsedAt);
    const workingDeal = await deal({ primaryContactId: working.person, sourceEnquiryId: working.asked, at: lapsedAt });
    await f.db.insert(schema.activities).values({ opportunityId: workingDeal, body: "TEST ONLY called yesterday", createdAt: freshAt });
    const proposed = await personWithEnquiry("Proposed", lapsedAt);
    await proposal({ enquiryId: proposed.asked, sentAt: freshAt, madeAt: lapsedAt });
    // Every other sign of contact keeps a person: a new enquiry linked to
    // them, a new one from their address that nobody linked, a client's
    // answer, a booking changed, their deal changed.
    const newLinked = await personWithEnquiry("NewLinked", lapsedAt);
    await enquiry({ email: newLinked.email, contactId: newLinked.person, createdAt: freshAt });
    const newUnlinked = await personWithEnquiry("NewUnlinked", lapsedAt);
    await enquiry({ email: newUnlinked.email, createdAt: freshAt });
    const answered = await personWithEnquiry("Answered", lapsedAt);
    await comment(await proposal({ enquiryId: answered.asked, madeAt: lapsedAt }), { authorEmail: answered.email, body: "TEST ONLY yes", createdAt: freshAt });
    const rebooked = await personWithEnquiry("Rebooked", lapsedAt);
    const rebookedEvent = await bookedEvent({ enquiryId: rebooked.asked, kind: "hold", status: "released" });
    await agedBookings(rebookedEvent, lapsedAt);
    await f.pool.query("UPDATE bookings SET updated_at = $2 WHERE event_id = $1", [rebookedEvent, freshAt]);
    const dealt = await personWithEnquiry("Dealt", lapsedAt);
    await deal({ primaryContactId: dealt.person, at: freshAt });
    // In touch only through a record merged into them: looked at, found in touch by the full check.
    const chained = await personWithEnquiry("Chained", lapsedAt);
    const chainedOld = await f.addPerson({ name: "Chained Old", emails: [`chained.old-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(chainedOld);
    await merge(chainedOld, chained.person);
    await aged("contacts", chained.person, lapsedAt);
    await f.pool.query("UPDATE contacts SET created_at = $2, last_contact_at = $3 WHERE id = $1", [chainedOld, lapsedAt, freshAt]);

    // Kept for a booking, which never ends: their enquiries that never became one still go,
    // linked or not, with what they wrote on its proposal; the lead of an address they still hold stays.
    const secondEmail = `booked.second-${randomUUID().slice(0, 8)}@example.test`;
    const booked = await personWithEnquiry("Booked", lapsedAt, [secondEmail]);
    await agedBookings(await bookedEvent({ enquiryId: booked.asked }), lapsedAt);
    const bookedSpare = await enquiry({ email: booked.email, contactId: booked.person });
    await aged("enquiries", bookedSpare, lapsedAt);
    const bookedUnlinked = await enquiry({ email: secondEmail });
    await aged("enquiries", bookedUnlinked, lapsedAt);
    const spareOffer = await proposal({ enquiryId: bookedUnlinked, madeAt: lapsedAt });
    const spareWords = await comment(spareOffer, { authorEmail: secondEmail, body: "TEST ONLY our dates", createdAt: lapsedAt });
    await f.db.insert(schema.guestLeads).values({ email: secondEmail, name: "TEST ONLY booked" });
    // Kept for a booking with only an unlinked spare enquiry from their own
    // address: looked at for it, then listed.
    const onlyUnlinkedEmail = `kept.unlinked-${randomUUID().slice(0, 8)}@example.test`;
    const keptUnlinked = await personWithEnquiry("KeptUnlinked", lapsedAt, [onlyUnlinkedEmail]);
    await agedBookings(await bookedEvent({ enquiryId: keptUnlinked.asked }), lapsedAt);
    const keptUnlinkedSpare = await enquiry({ email: onlyUnlinkedEmail });
    await aged("enquiries", keptUnlinkedSpare, lapsedAt);
    // Kept for a booking with nothing left to remove, and older than everyone:
    // listed, never looked at, so it cannot hold the queue up.
    const longKeptAt = new Date(lapsedAt.getTime() - 30 * dayMs);
    const longKept = await personWithEnquiry("LongKept", longKeptAt);
    await agedBookings(await bookedEvent({ enquiryId: longKept.asked }), longKeptAt);
    // A record merged into a recent person is never taken on its own.
    const recent = await personWithEnquiry("Recent", freshAt);
    const tombstone = await f.addPerson({ name: "Old Tombstone", emails: [`tomb-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(tombstone);
    await merge(tombstone, recent.person);
    await aged("contacts", tombstone, lapsedAt);
    await aged("contacts", recent.person, freshAt);
    // Two lapsed people sharing an inbox, and an old enquiry from it nobody
    // linked: theirs only once the first of them is erased, so a rehearsal
    // that ran each step apart would count differently from the night.
    const inbox = `pair-${randomUUID().slice(0, 8)}@example.test`;
    leadEmails.push(inbox);
    const pairOne = await personWithEnquiry("PairOne", lapsedAt, [inbox]);
    const pairTwo = await personWithEnquiry("PairTwo", lapsedAt, [inbox]);
    await f.keepApart(pairOne.person, pairTwo.person);
    const pairEnquiry = await enquiry({ email: inbox });
    await aged("enquiries", pairEnquiry, lapsedAt);

    // Enquiries nobody holds: lapsed (with its lead and receipt), recent, and booked.
    const loneEmail = `lone-${randomUUID().slice(0, 8)}@example.test`;
    leadEmails.push(loneEmail);
    const lone = await enquiry({ email: loneEmail });
    await aged("enquiries", lone, lapsedAt);
    await f.db.insert(schema.guestLeads).values({ email: loneEmail, name: "TEST ONLY lone", phone: "+44 7700 900333", firstEnquiryId: lone });
    const loneReceipt = `enquiry-acknowledged:${lone}`;
    receiptKeys.push(loneReceipt);
    await f.db.insert(schema.emailSends).values({ idempotencyKey: loneReceipt, recipient: loneEmail, subject: "TEST ONLY thanks" });
    const loneRecent = await enquiry({ email: `lone-recent-${randomUUID().slice(0, 8)}@example.test`, createdAt: freshAt });
    const loneBooked = await enquiry({ email: `lone-booked-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneBooked, lapsedAt);
    await agedBookings(await bookedEvent({ enquiryId: loneBooked }), lapsedAt);
    // Lone enquiries the full check keeps: a deal made from one is still
    // being worked; another deal's event holds a booking the venue keeps.
    const loneWorked = await enquiry({ email: `lone-worked-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneWorked, lapsedAt);
    await deal({ sourceEnquiryId: loneWorked, at: freshAt });
    const loneDealBooked = await enquiry({ email: `lone-dealt-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneDealBooked, lapsedAt);
    const loneDeal = await deal({ sourceEnquiryId: loneDealBooked, at: lapsedAt });
    await agedBookings(await bookedEvent({ opportunityId: loneDeal }), lapsedAt);

    // A night's limits, or its time, leave the rest for the next night, and say so.
    const capped = await eraseLapsedPeople(f.db, { now, dryRun: true, limits: { people: 0, enquiries: 0 } });
    expect(capped).toMatchObject({ people: 0, enquiries: 0, failed: 0, outOfTime: false });
    // Those in touch through their own records are never candidates; the
    // lapsed, the pair, the chained, the booked two with something to remove, and the lone ones wait.
    expect(capped.deferred.people).toBeGreaterThanOrEqual(6);
    expect(capped.deferred.enquiries).toBeGreaterThanOrEqual(3);
    expect(capped.kept).toContainEqual({ venueId: f.venueId, personId: longKept.person });
    expect(capped.kept).not.toContainEqual({ venueId: f.venueId, personId: keptUnlinked.person });
    const timed = await eraseLapsedPeople(f.db, { now, dryRun: true, budgetMs: 0 });
    expect(timed).toMatchObject({ people: 0, enquiries: 0, outOfTime: true, deferred: capped.deferred });
    // One look tonight goes to a candidate, never to the person kept already.
    const narrow = await eraseLapsedPeople(f.db, { now, dryRun: true, limits: { people: 1, enquiries: 0, examined: 1 } });
    expect(narrow.deferred.people).toBe(capped.deferred.people - 1);
    expect(narrow.kept).toContainEqual({ venueId: f.venueId, personId: longKept.person });

    // The rehearsal changes nothing at all.
    const rehearsal = await eraseLapsedPeople(f.db, { now, dryRun: true });
    expect(rehearsal.dryRun).toBe(true);
    expect(rehearsal.failed).toBe(0);
    // Only the chained person is looked at and found in touch: everyone in
    // touch by their own records (a new unlinked enquiry from their address
    // among them) is never looked at.
    expect(rehearsal.inTouch).toBe(1);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [lapsed.person])).toBe(1);
    expect(await count("contact_points WHERE contact_id = $1", [lapsed.person])).toBe(1);
    const goes = [lapsed.asked, lapsedUnlinked, lone, bookedSpare, bookedUnlinked, keptUnlinkedSpare, pairEnquiry];
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [goes])).toBe(goes.length);
    expect(await count("guest_leads WHERE email = $1", [loneEmail])).toBe(1);
    expect(await count("email_sends WHERE idempotency_key = $1", [loneReceipt])).toBe(1);
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(0);

    // The night does exactly what the rehearsal said.
    const pass = await eraseLapsedPeople(f.db, { now });
    expect({ ...pass, dryRun: true }).toEqual(rehearsal);
    expect(pass.kept).toEqual(expect.arrayContaining([
      { venueId: f.venueId, personId: booked.person },
      { venueId: f.venueId, personId: keptUnlinked.person },
      { venueId: f.venueId, personId: longKept.person },
    ]));

    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NOT NULL AND email IS NULL",
      [[lapsed.person, pairOne.person, pairTwo.person]])).toBe(3);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [goes])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [loneEmail])).toBe(0);
    expect(await count("email_sends WHERE idempotency_key = $1", [loneReceipt])).toBe(0);
    // The booked person's words on the spare enquiry's proposal went with it;
    // the lead of the address they still hold stays.
    expect(await count("proposal_comments WHERE id = $1", [spareWords])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [secondEmail])).toBe(1);
    // Inside the 24 months, in touch by any sign, or kept for a booking:
    // nothing of theirs goes beyond what never became a booking.
    const stay = [boundary, working, proposed, newLinked, newUnlinked, answered, rebooked, dealt, chained, booked, keptUnlinked, longKept, recent];
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL",
      [[...stay.map((row) => row.person), tombstone, chainedOld]])).toBe(stay.length + 2);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])",
      [[...stay.map((row) => row.asked), loneRecent, loneBooked, loneWorked, loneDealBooked]])).toBe(stay.length + 4);

    // A second night finds nothing more of theirs: still one audit row. The
    // kept people, with nothing left to remove, are listed and not looked at.
    const again = await eraseLapsedPeople(f.db, { now, limits: { examined: 0 } });
    expect(again.failed).toBe(0);
    expect(again.kept).toEqual(expect.arrayContaining([
      { venueId: f.venueId, personId: booked.person },
      { venueId: f.venueId, personId: keptUnlinked.person },
    ]));
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(1);
  });
});

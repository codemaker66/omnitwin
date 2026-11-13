import { randomUUID } from "node:crypto";
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
      for (const table of ["proposal_deposit_requests", "proposals", "event_plan_notifications", "bookings", "events"]) {
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

  async function enquiry(input: { venueId?: string; email: string; contactId?: string | null; name?: string }): Promise<string> {
    const rows = await f.db.insert(schema.enquiries).values({
      venueId: input.venueId ?? f.venueId, spaceId: input.venueId === f.otherVenueId ? otherSpaceId : spaceId,
      name: input.name ?? "TEST ONLY guest", guestName: input.name ?? null, email: input.email, guestEmail: input.email,
      contactId: input.contactId ?? null,
    }).returning({ id: schema.enquiries.id });
    return only(rows, "enquiry").id;
  }

  async function proposal(input: {
    venueId?: string; enquiryId?: string | null; opportunityId?: string | null; title?: string; acceptedName?: string | null;
    sentAt?: Date; madeAt?: Date;
  }): Promise<string> {
    const rows = await f.db.insert(schema.proposals).values({
      venueId: input.venueId ?? f.venueId, enquiryId: input.enquiryId ?? null, opportunityId: input.opportunityId ?? null,
      title: input.title ?? "TEST ONLY proposal", acceptedName: input.acceptedName ?? null, sentAt: input.sentAt ?? null,
      ...(input.madeAt === undefined ? {} : { createdAt: input.madeAt, updatedAt: input.madeAt }),
    }).returning({ id: schema.proposals.id });
    return only(rows, "proposal").id;
  }

  async function comment(proposalId: string, input: {
    authorType?: "client" | "staff"; authorEmail?: string | null; authorName?: string | null; body: string;
  }): Promise<string> {
    const rows = await f.db.insert(schema.proposalComments).values({
      proposalId, authorType: input.authorType ?? "client", authorEmail: input.authorEmail ?? null,
      authorName: input.authorName ?? null, body: input.body,
    }).returning({ id: schema.proposalComments.id });
    return only(rows, "comment").id;
  }

  /** A change in the event's feed copying what the client wrote, with the
   *  notice it raised, as client-answer-notice writes them. */
  async function changeCopy(input: {
    eventId: string; proposalId: string; sourceKind: "proposal_comment" | "proposal_response"; sourceId: string; label: string;
  }): Promise<string> {
    const title = `${input.label} wrote about the proposal`;
    const summary = `Version 1. “${input.label}: our son has a nut allergy”`;
    const rows = await f.db.insert(schema.eventPlanChanges).values({
      eventId: input.eventId, venueId: f.venueId, proposalId: input.proposalId, actorRole: "client", actorLabel: input.label,
      sourceKind: input.sourceKind, sourceId: input.sourceId, title, summary, affectedSurfaces: ["comments"], audienceRoles: ["staff"],
    }).returning({ id: schema.eventPlanChanges.id });
    const change = only(rows, "change").id;
    await f.db.insert(schema.eventPlanNotifications).values({
      changeId: change, eventId: input.eventId, venueId: f.venueId, audienceRole: "staff", title, body: summary,
    });
    return change;
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

  it("erases a person and the record merged into them, every personal field, at this venue and nowhere else", async () => {
    const tag = randomUUID().slice(0, 8);
    const mainEmail = `morag.erase-${tag}@example.test`;
    const oldEmail = `m.erase-${tag}@example.test`;
    const person = await f.addPerson({ name: "Morag Erasable", emails: [mainEmail], phones: ["+44 7700 900111"] });
    const duplicate = await f.addPerson({ name: "M. Erasable", emails: [oldEmail] });
    // Every personal column, on both records, so a clear that went missing shows.
    await f.pool.query(
      `UPDATE contacts SET given_name = 'Morag', family_name = 'Erasable', job_title = 'Erasable buyer', role_label = 'Erasable role',
         postal_address = '1 Erasable Lane', notes = 'Erasable notes', source_system = 'crm', source_id = $2 WHERE id = $1`,
      [person, `erasable-${tag}`],
    );
    await f.pool.query(
      `UPDATE contacts SET given_name = 'M.', family_name = 'Erasable', job_title = 'Erasable clerk', role_label = 'Erasable alias',
         postal_address = '9 Erasable Close', notes = 'Erasable duplicate notes' WHERE id = $1`,
      [duplicate],
    );
    const guild = await f.addOrganisation({ name: "TEST ONLY Guild", kind: "organisation" });
    await f.pool.query(
      "INSERT INTO account_memberships (venue_id, contact_id, client_account_id, is_primary, role_label) VALUES ($1, $2, $3, false, 'Erasable member')",
      [f.venueId, person, guild],
    );
    const merged = await post(`/people/${duplicate}/merge`, "staff", { survivorId: person });
    expect(merged.statusCode, merged.body).toBe(201);
    const mergeId = (merged.json<{ data: { mergeId: string } }>()).data.mergeId;

    const asked = await enquiry({ email: mainEmail, contactId: person });
    const elsewhere = await enquiry({ venueId: f.otherVenueId, email: oldEmail });
    const otherVenuesReceipt = `enquiry-acknowledged:${elsewhere}`;
    const receipts = [`enquiry-acknowledged:${asked}`, `enquiry-new:${asked}:${randomUUID()}`, otherVenuesReceipt];
    receiptKeys.push(...receipts);
    leadEmails.push(mainEmail, oldEmail);
    peopleIds.push(person, duplicate);
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
      people: 2, contactPoints: 3, mergeSnapshots: 1, households: 0,
      enquiries: 1, guestLeads: 1, emailReceipts: 2, comments: 0, changeCopies: 0, notices: 0, proposals: 0, reworded: 0,
    });

    const { rows: people } = await f.pool.query<Record<string, unknown>>(
      `SELECT name, email, phone, given_name, family_name, job_title, role_label, postal_address, notes, source_system, source_id,
              erased_at, deleted_at
         FROM contacts WHERE id = ANY($1::uuid[])`, [[person, duplicate]]);
    expect(people).toHaveLength(2);
    for (const row of people) {
      expect(row).toMatchObject({
        name: "Erased", email: null, phone: null, given_name: null, family_name: null, job_title: null, role_label: null,
        postal_address: null, notes: null, source_system: null, source_id: null,
      });
      expect(row["erased_at"]).not.toBeNull();
      expect(row["deleted_at"]).not.toBeNull();
    }
    expect(await count("contact_points WHERE contact_id = ANY($1::uuid[])", [[person, duplicate]])).toBe(0);
    expect(await count("account_memberships WHERE contact_id = $1 AND role_label IS NULL", [person])).toBe(1);
    const { rows: snapshots } = await f.pool.query<{ snapshot: unknown }>("SELECT snapshot FROM record_merges WHERE id = $1", [mergeId]);
    expect(snapshots).toHaveLength(1);
    expect(JSON.stringify(snapshots)).not.toMatch(/Erasable|erase-|7700|M\.|crm/u);

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
    const deal = only(await f.db.insert(schema.opportunities).values({ venueId: f.venueId, title: "TEST ONLY deal", primaryContactId: dealContact })
      .returning({ id: schema.opportunities.id }), "deal");
    await bookedEvent({ opportunityId: deal.id });

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

  it("leaves a partner who shares the address alone: their enquiry, comment, live hold and the lead", async () => {
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
    // A deleted duplicate holding her own address is nobody to share it with.
    const deletedDuplicate = await f.addPerson({ name: "Ailsa Duplicate", emails: [ownAddress] });
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deletedDuplicate]);
    peopleIds.push(deletedDuplicate);
    const unlinkedOwn = await enquiry({ email: ownAddress });
    // The other's live hold is theirs, not the partner's: it does not hold the erasure back.
    await bookedEvent({ enquiryId: ofOther, kind: "hold" });
    const offered = await proposal({ enquiryId: ofOther });
    const theirWords = await comment(offered, { authorEmail: shared, body: "TEST ONLY a question of Brodie's" });
    await f.db.insert(schema.guestLeads).values({ email: shared, name: "TEST ONLY partners" });

    const erased = await post(`/people/${partner}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { enquiries: number; comments: number; guestLeads: number } } }>().data.counts)
      .toMatchObject({ enquiries: 2, comments: 0, guestLeads: 0 });
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[ofPartner, unlinkedOwn]])).toBe(0);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[ofOther, unlinked, filedUnderOther]])).toBe(3);
    expect(await count("proposal_comments WHERE id = $1", [theirWords])).toBe(1);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL AND email = $2", [other, shared])).toBe(1);
    expect(await count("guest_leads WHERE email = $1", [shared])).toBe(1);
  });

  it("hands a household shared with a live partner over to them, taking only the erased person's name out of it", async () => {
    const household = await f.addOrganisation({ name: "Ailsa Hearth's household", kind: "household" });
    await f.pool.query("UPDATE client_accounts SET address = '3 Shared Wynd', notes = 'TEST ONLY Ailsa Hearth prefers mornings' WHERE id = $1",
      [household]);
    const leaving = await f.addPerson({ name: "Ailsa Hearth", emails: [`ailsa.hearth-${randomUUID().slice(0, 8)}@example.test`], organisations: [household] });
    const staying = await f.addPerson({ name: "Brodie Hearth", emails: [`brodie.hearth-${randomUUID().slice(0, 8)}@example.test`], organisations: [household] });
    await f.pool.query("UPDATE client_accounts SET primary_contact_id = $1 WHERE id = $2", [leaving, household]);
    peopleIds.push(leaving, staying);

    const erased = await post(`/people/${leaving}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { households: number } } }>().data.counts.households).toBe(1);
    expect(await value(`SELECT row_to_json(a) AS value FROM (SELECT name, address, notes, primary_contact_id FROM client_accounts WHERE id = $1) a`,
      [household])).toEqual({ name: "Erased's household", address: "3 Shared Wynd", notes: "TEST ONLY Erased prefers mornings", primary_contact_id: staying });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [staying])).toBe(1);
  });

  it("takes the person out of what the venue keeps: household, deal, proposal, Diary, change feed and notices", async () => {
    const tag = randomUUID().slice(0, 8);
    const current = `isla.now-${tag}@example.test`;
    const old = `isla.old-${tag}@example.test`;
    const household = await f.addOrganisation({ name: "Isla Erasable", kind: "household" });
    await f.pool.query("UPDATE client_accounts SET address = '2 Erasable Road', notes = 'TEST ONLY Isla prefers calls' WHERE id = $1", [household]);
    const person = await f.addPerson({ name: "Isla Erasable", emails: [current], organisations: [household] });
    await f.pool.query("UPDATE contacts SET given_name = 'Isla', family_name = 'Erasable' WHERE id = $1", [person]);
    peopleIds.push(person);
    leadEmails.push(current, old);
    // Her first enquiry came from an address she has since replaced: its
    // lead and what she signed with it go too.
    const asked = await enquiry({ email: old, contactId: person, name: "Isla Erasable" });
    await f.db.insert(schema.guestLeads).values({ email: old, name: "Isla Erasable", phone: "+44 7700 900222" });

    const deal = only(await f.db.insert(schema.opportunities).values({ venueId: f.venueId, title: "Wedding — Isla Erasable",
      primaryContactId: person, sourceEnquiryId: asked, nextAction: "Call Isla Erasable about the menus" })
      .returning({ id: schema.opportunities.id }), "deal");
    await f.db.insert(schema.activities).values({ opportunityId: deal.id, body: "Isla Erasable asked about the Saloon", createdBy: f.users.staff });
    const offered = await proposal({ opportunityId: deal.id, title: "Isla Erasable's wedding", acceptedName: "Isla Erasable" });
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "Isla Erasable's wedding", clientMessage: "Dear Isla Erasable, here is your proposal." }), "d".repeat(64)]);
    await f.pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'TESTONLY')",
      [offered, randomUUID().replaceAll("-", "").padEnd(64, "0")]);
    const fromLink = await comment(offered, { authorEmail: current, authorName: "Isla Erasable", body: "Our son has a nut allergy" });
    const unsigned = await comment(offered, { authorName: "Isla", body: "Could we move the date?" });
    const staffWords = await comment(offered, { authorType: "staff", authorName: "TEST ONLY staff", body: "Spoke to Isla Erasable on the phone" });
    // On someone else's proposal, from her old address: that client's record, kept without her.
    const otherOffer = await proposal({ title: "TEST ONLY someone else's proposal" });
    const fromOldAddress = await comment(otherOffer, { authorEmail: old, authorName: "Isla Erasable", body: "TEST ONLY Isla Erasable agrees to the change" });
    const elsewhereOffer = await proposal({ venueId: f.otherVenueId, title: "TEST ONLY another venue's proposal" });
    const elsewhereWords = await comment(elsewhereOffer, { authorEmail: current, body: "TEST ONLY another venue's to erase" });
    await f.db.insert(schema.proposalStatusHistory).values([
      { proposalId: offered, fromStatus: "sent", toStatus: "changes_requested", changedBy: null, note: "Our son has a nut allergy" },
      { proposalId: offered, fromStatus: "draft", toStatus: "sent", changedBy: f.users.staff, note: "Sent to Isla Erasable" },
    ]);

    const eventId = await bookedEvent({ enquiryId: asked, opportunityId: deal.id, kind: "hold", status: "released",
      title: "Isla Erasable — Wedding", eventName: "Isla Erasable — Wedding", clientName: "Isla Erasable" });
    const hold = only((await f.pool.query<{ id: string }>("SELECT id FROM bookings WHERE event_id = $1", [eventId])).rows, "hold");
    await changeCopy({ eventId, proposalId: offered, sourceKind: "proposal_comment", sourceId: fromLink, label: "Isla Erasable" });
    await changeCopy({ eventId, proposalId: offered, sourceKind: "proposal_response", sourceId: offered, label: "Isla Erasable" });
    const proposalNotice = await notice({ body: "Isla Erasable wrote about Isla Erasable's wedding",
      actionPath: `/dashboard?view=proposals&proposal=${offered}` });
    const askedAt = (await f.pool.query<{ at: Date }>("SELECT created_at AS at FROM enquiries WHERE id = $1", [asked])).rows[0]?.at;
    if (askedAt === undefined) throw new Error("The enquiry has no time");
    const arrived = new Date(askedAt.getTime() + 2000);
    const enquiryNotice = await notice({ body: "Isla Erasable enquired about TEST ONLY Saloon for a wedding. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    const someoneElse = await notice({ body: "Ruth Kept enquired about TEST ONLY Saloon. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    // Another enquirer whose name begins with hers is not her.
    const longerName = await notice({ body: "Isla Erasable Brown enquired about TEST ONLY Saloon. Open Enquiries to respond.",
      actionPath: "/dashboard?view=enquiries", createdAt: arrived });
    const promotion = await notice({ body: "Isla Erasable — Wedding has moved up to first in line.",
      actionPath: `/dashboard?view=diary&day=2027-01-01&booking=${hold.id}` });

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: unknown } }>().data.counts).toEqual({
      people: 1, contactPoints: 1, mergeSnapshots: 0, households: 1,
      enquiries: 1, guestLeads: 1, emailReceipts: 0, comments: 2, changeCopies: 2, notices: 2, proposals: 1, reworded: 8,
    });

    // Her household keeps its row, without her.
    expect(await value("SELECT row_to_json(a) AS value FROM (SELECT name, address, notes FROM client_accounts WHERE id = $1) a", [household]))
      .toEqual({ name: "Erased", address: null, notes: null });
    // The venue's own records keep their rows and lose her name.
    expect(await value("SELECT row_to_json(d) AS value FROM (SELECT title, next_action FROM opportunities WHERE id = $1) d", [deal.id]))
      .toEqual({ title: "Wedding — Erased", next_action: "Call Erased about the menus" });
    expect(await value("SELECT body AS value FROM activities WHERE opportunity_id = $1", [deal.id])).toBe("Erased asked about the Saloon");
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT title, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ title: "Erased's wedding", accepted_name: null });
    // The version the client was sent loses her name, its digest made again;
    // her link no longer opens it.
    expect(await value("SELECT row_to_json(v) AS value FROM (SELECT payload, source_hash <> repeat('d', 64) AS rehashed FROM proposal_versions WHERE proposal_id = $1) v", [offered]))
      .toEqual({ payload: { title: "Erased's wedding", clientMessage: "Dear Erased, here is your proposal." }, rehashed: true });
    expect(await count("proposal_share_tokens WHERE proposal_id = $1 AND revoked_at IS NULL", [offered])).toBe(0);
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT author_name, author_email, body FROM proposal_comments WHERE id = $1) c", [fromOldAddress]))
      .toEqual({ author_name: null, author_email: null, body: "TEST ONLY Erased agrees to the change" });
    expect(await value("SELECT title AS value FROM bookings WHERE id = $1", [hold.id])).toBe("Erased — Wedding");
    expect(await value("SELECT row_to_json(e) AS value FROM (SELECT name, client_name FROM events WHERE id = $1) e", [eventId]))
      .toEqual({ name: "Erased — Wedding", client_name: "Erased" });
    expect(await value("SELECT body AS value FROM proposal_comments WHERE id = $1", [staffWords])).toBe("Spoke to Erased on the phone");
    const { rows: notes } = await f.pool.query<{ note: string | null }>(
      "SELECT note FROM proposal_status_history WHERE proposal_id = $1 ORDER BY changed_by NULLS FIRST", [offered]);
    expect(notes.map((row) => row.note)).toEqual([null, "Sent to Erased"]);
    expect(await value("SELECT body AS value FROM event_plan_notifications WHERE id = $1", [promotion]))
      .toBe("Erased — Wedding has moved up to first in line.");

    // What she wrote, and every copy of it, is gone; another venue's is not ours to erase.
    expect(await count("proposal_comments WHERE id = ANY($1::uuid[])", [[fromLink, unsigned]])).toBe(0);
    expect(await count("proposal_comments WHERE id = $1", [elsewhereWords])).toBe(1);
    expect(await count("event_plan_changes WHERE event_id = $1", [eventId])).toBe(0);
    expect(await count("event_plan_notifications WHERE event_id = $1", [eventId])).toBe(0);
    expect(await count("event_plan_notifications WHERE id = ANY($1::uuid[])", [[proposalNotice, enquiryNotice]])).toBe(0);
    expect(await count("event_plan_notifications WHERE id = ANY($1::uuid[])", [[someoneElse, longerName]])).toBe(2);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [old])).toBe(0);
  });

  it("erases people and lone enquiries 24 months after the last contact of any kind, and rehearses it exactly", async () => {
    const now = new Date();
    const cutoff = (await f.pool.query<{ at: Date }>("SELECT ($1::timestamptz - interval '24 months') AS at", [now])).rows[0]?.at;
    if (cutoff === undefined) throw new Error("No cutoff");
    const dayMs = 86_400_000;
    // A day either side of the 24 calendar months.
    const lapsedAt = new Date(cutoff.getTime() - dayMs);
    const freshAt = new Date(cutoff.getTime() + dayMs);
    async function aged(table: "contacts" | "enquiries", id: string, at: Date): Promise<void> {
      const lastContact = table === "contacts" ? ", last_contact_at = $2" : "";
      await f.pool.query(`UPDATE ${table} SET created_at = $2, updated_at = $2${lastContact} WHERE id = $1`, [id, at]);
    }
    async function personWithEnquiry(name: string, at: Date): Promise<{ person: string; asked: string; email: string }> {
      const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
      const person = await f.addPerson({ name, emails: [email] });
      peopleIds.push(person);
      leadEmails.push(email);
      const asked = await enquiry({ email, contactId: person });
      await aged("contacts", person, at);
      await aged("enquiries", asked, at);
      return { person, asked, email };
    }

    const lapsed = await personWithEnquiry("Lapsed", lapsedAt);
    // An old enquiry from her address that nobody linked goes with her, once.
    const lapsedUnlinked = await enquiry({ email: lapsed.email });
    await aged("enquiries", lapsedUnlinked, lapsedAt);
    const recent = await personWithEnquiry("Recent", freshAt);
    // Old records the team is still working with: a note on their deal, a proposal sent last week.
    const working = await personWithEnquiry("Working", lapsedAt);
    const deal = only(await f.db.insert(schema.opportunities).values({ venueId: f.venueId, title: "TEST ONLY deal",
      primaryContactId: working.person, sourceEnquiryId: working.asked, createdAt: lapsedAt, updatedAt: lapsedAt })
      .returning({ id: schema.opportunities.id }), "deal");
    await f.db.insert(schema.activities).values({ opportunityId: deal.id, body: "TEST ONLY called yesterday" });
    const proposed = await personWithEnquiry("Proposed", lapsedAt);
    await proposal({ enquiryId: proposed.asked, sentAt: new Date(now.getTime() - 7 * dayMs), madeAt: lapsedAt });
    // Kept for a booking, which never ends: the enquiry that never became one still goes.
    const booked = await personWithEnquiry("Booked", lapsedAt);
    const bookedEventId = await bookedEvent({ enquiryId: booked.asked });
    await f.pool.query("UPDATE bookings SET created_at = $2, updated_at = $2 WHERE event_id = $1", [bookedEventId, lapsedAt]);
    const bookedSpare = await enquiry({ email: booked.email, contactId: booked.person });
    await aged("enquiries", bookedSpare, lapsedAt);
    // Kept for a booking with nothing left to remove, and older than everyone:
    // listed, never looked at, so it cannot hold the queue up.
    const longKeptAt = new Date(lapsedAt.getTime() - 30 * dayMs);
    const longKept = await personWithEnquiry("LongKept", longKeptAt);
    const longKeptEventId = await bookedEvent({ enquiryId: longKept.asked });
    await f.pool.query("UPDATE bookings SET created_at = $2, updated_at = $2 WHERE event_id = $1", [longKeptEventId, longKeptAt]);
    // A record merged into a recent person is never taken on its own.
    const tombstone = await f.addPerson({ name: "Old Tombstone", emails: [`tomb-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(tombstone);
    const merged = await post(`/people/${tombstone}/merge`, "staff", { survivorId: recent.person });
    expect(merged.statusCode, merged.body).toBe(201);
    await aged("contacts", tombstone, lapsedAt);
    await aged("contacts", recent.person, freshAt);
    // Enquiries nobody holds: lapsed (with its lead and receipt), recent, and booked.
    const loneEmail = `lone-${randomUUID().slice(0, 8)}@example.test`;
    leadEmails.push(loneEmail);
    const lone = await enquiry({ email: loneEmail });
    await aged("enquiries", lone, lapsedAt);
    await f.db.insert(schema.guestLeads).values({ email: loneEmail, name: "TEST ONLY lone", phone: "+44 7700 900333", firstEnquiryId: lone });
    const loneReceipt = `enquiry-acknowledged:${lone}`;
    receiptKeys.push(loneReceipt);
    await f.db.insert(schema.emailSends).values({ idempotencyKey: loneReceipt, recipient: loneEmail, subject: "TEST ONLY thanks" });
    const loneRecent = await enquiry({ email: `lone-recent-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneRecent, freshAt);
    const loneBooked = await enquiry({ email: `lone-booked-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneBooked, lapsedAt);
    const loneEventId = await bookedEvent({ enquiryId: loneBooked });
    await f.pool.query("UPDATE bookings SET created_at = $2, updated_at = $2 WHERE event_id = $1", [loneEventId, lapsedAt]);

    // A night's limits leave the rest for the next night, and say so.
    const capped = await eraseLapsedPeople(f.db, { now, dryRun: true, limits: { people: 0, enquiries: 0 } });
    // Those in touch through their own records, and the booked lone enquiry,
    // are never candidates: only the lapsed and the booked person, and the
    // lone enquiry, wait.
    expect(capped).toMatchObject({ people: 0, enquiries: 0, failed: 0 });
    expect(capped.deferred.people).toBeGreaterThanOrEqual(2);
    expect(capped.deferred.enquiries).toBeGreaterThanOrEqual(1);
    expect(capped.kept).toContainEqual({ venueId: f.venueId, personId: longKept.person });
    // One look tonight goes to a candidate, never to the person kept already.
    const narrow = await eraseLapsedPeople(f.db, { now, dryRun: true, limits: { people: 1, enquiries: 0, examined: 1 } });
    expect(narrow.deferred.people).toBe(capped.deferred.people - 1);
    expect(narrow.people + narrow.enquiries).toBeGreaterThanOrEqual(1);
    expect(narrow.kept).toContainEqual({ venueId: f.venueId, personId: longKept.person });

    // The rehearsal changes nothing at all.
    const rehearsal = await eraseLapsedPeople(f.db, { now, dryRun: true });
    expect(rehearsal.dryRun).toBe(true);
    expect(rehearsal.failed).toBe(0);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [lapsed.person])).toBe(1);
    expect(await count("contact_points WHERE contact_id = $1", [lapsed.person])).toBe(1);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[lapsed.asked, lapsedUnlinked, lone, bookedSpare]])).toBe(4);
    expect(await count("guest_leads WHERE email = $1", [loneEmail])).toBe(1);
    expect(await count("email_sends WHERE idempotency_key = $1", [loneReceipt])).toBe(1);
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(0);

    // The night does exactly what the rehearsal said.
    const pass = await eraseLapsedPeople(f.db, { now });
    expect({ ...pass, dryRun: true }).toEqual(rehearsal);
    expect(pass.kept).toContainEqual({ venueId: f.venueId, personId: booked.person });

    expect(await count("contacts WHERE id = $1 AND erased_at IS NOT NULL AND email IS NULL", [lapsed.person])).toBe(1);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[lapsed.asked, lapsedUnlinked, lone, bookedSpare]])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [loneEmail])).toBe(0);
    expect(await count("email_sends WHERE idempotency_key = $1", [loneReceipt])).toBe(0);
    // Inside the 24 months, in touch through a deal or a proposal, or kept for
    // a booking: nothing of theirs goes beyond what never became a booking.
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL",
      [[recent.person, working.person, proposed.person, booked.person, longKept.person, tombstone]])).toBe(6);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])",
      [[recent.asked, working.asked, proposed.asked, booked.asked, longKept.asked, loneRecent, loneBooked]])).toBe(7);

    // A second night finds nothing more of theirs: still one audit row. The
    // booked person, with nothing left to remove, is listed and not looked at.
    const again = await eraseLapsedPeople(f.db, { now });
    expect(again.failed).toBe(0);
    expect(again.kept).toContainEqual({ venueId: f.venueId, personId: booked.person });
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(1);
  });
});

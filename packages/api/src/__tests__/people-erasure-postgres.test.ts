import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { Client } from "pg";
import * as schema from "../db/schema.js";
import { eventRoutes } from "../routes/events.js";
import { peopleRoutes } from "../routes/people.js";
import { proposalRoutes, proposalShareRoutes } from "../routes/proposals.js";
import { eventDayEventRoutes } from "../routes/event-day-ops.js";
import { opsHandoffRoutes } from "../routes/ops-handoff.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { guestLeadLockKey } from "../services/guest-lead-lock.js";
import { approveSnapshot, createSnapshot } from "../services/sheet-snapshot.js";
import { eraseLockedPerson } from "../services/people-erasure.js";
import { lockPerson } from "../services/people-records.js";
import { eraseLapsedPeople, PEOPLE_RETENTION_START_VARIABLE } from "../services/people-retention.js";
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

// Thirty seconds a case: the two-connection cases wait on several locks in
// turn (each wait polls up to ten seconds), which the default ten-second case
// budget can cut short on a loaded machine.
describe.skipIf(PLATFORM_TARGET === undefined)("erasing a person on the migrated disposable database", { timeout: 30_000 }, () => {
  let f: PeopleFixture;
  let spaceId: string;
  let otherSpaceId: string;
  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      await server.register(peopleRoutes, { db, prefix: "/people" });
      await server.register(proposalShareRoutes, { db, prefix: "/proposal-share" });
      await server.register(proposalRoutes, { db, prefix: "/proposals" });
      await server.register(eventRoutes, { db, prefix: "/events" });
      await server.register(eventDayEventRoutes, { db, prefix: "/events" });
      await server.register(opsHandoffRoutes, { db, prefix: "/ops" });
    });
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
      // The sheet approval and the pack compile record their actor.
      await f.pool.query("DELETE FROM general_audit_log WHERE actor_user_id = ANY($1::uuid[])", [Object.values(f.users)]);
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
    kind?: "comment" | "approval_note";
  }): Promise<string> {
    const rows = await f.db.insert(schema.proposalComments).values({
      proposalId, kind: input.kind ?? "comment", authorType: input.authorType ?? "client", authorEmail: input.authorEmail ?? null,
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

  /** A layout, with planner instructions when given (configurations.metadata). */
  async function layout(name: string, instructions?: Record<string, unknown>): Promise<string> {
    return only(await f.db.insert(schema.configurations).values({ venueId: f.venueId, spaceId, name, layoutStyle: "dinner-rounds",
      ...(instructions === undefined ? {} : { metadata: { instructions } }) }).returning({ id: schema.configurations.id }), "layout").id;
  }

  /** An event made from a layout, as staff link one (event_configuration_links). */
  async function laidOutFrom(eventId: string, layoutId: string): Promise<void> {
    await f.db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: layoutId, linkType: "source_configuration" });
  }

  /** A Diary entry through the bind core, as the product writes one: from an
   *  enquiry it makes the event itself, with no deal on it. */
  async function bound(input: { enquiryId?: string; kind: "ink" | "hold"; title: string }): Promise<{ id: string; eventId: string }> {
    day += 1;
    const startsAt = new Date(Date.UTC(2027, 1, day, 18));
    const [row] = await insertBoundBookings(f.db, [{ venueId: f.venueId, spaceId, kind: input.kind, title: input.title,
      createdBy: f.users.staff, startsAt, endsAt: new Date(startsAt.getTime() + 5 * 3600_000),
      ...(input.enquiryId === undefined ? {} : { enquiryId: input.enquiryId }),
      ...(input.kind === "hold"
        ? { rank: 1, decisionAt: startsAt, nextAction: "TEST ONLY follow up", nextActionDueAt: startsAt, ownerUserId: f.users.staff }
        : {}) }]);
    if (row === undefined || row.eventId === null) throw new Error("The bind core made no event");
    return { id: row.id, eventId: row.eventId };
  }

  /** A client's share link to a proposal, as the desk issues one; the token. */
  async function issuedLink(proposalId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await f.pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, $3)",
      [proposalId, createHash("sha256").update(token, "utf8").digest("hex"), token.slice(0, 8)]);
    return token;
  }

  /** Waits until another connection is held up on a row lock in the table:
   *  a statement locking it FOR UPDATE (the erasure's ordered locks, a held
   *  proposal), or in the mode given, that waits on a lock. */
  async function waitForLockWait(table: string, mode = "for update"): Promise<void> {
    await waitForStatement(`%from "${table}"%${mode}%`, `${mode} in ${table}`);
  }

  /** Waits until a statement like the pattern (ILIKE) waits on a lock. */
  async function waitForStatement(pattern: string, what: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await f.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`,
        [pattern]);
      if ((rows[0]?.n ?? 0) > 0) return;
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    const { rows: waiting } = await f.pool.query<{ query: string }>(
      "SELECT left(query, 160) AS query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    throw new Error(`Nothing waited on a lock: ${what}; waiting instead: ${waiting.map((row) => row.query).join(" | ") || "nothing"}`);
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
    // Sent through a venue form, its reply address hers: the notice opens with that.
    const asked = await enquiry({ email: `form-${randomUUID().slice(0, 8)}@example.test`, guestEmail: email, contactId: person });
    const formNotice = await notice({ body: `${email} enquired about TEST ONLY Saloon. Open Enquiries to respond.`,
      actionPath: "/dashboard?view=enquiries", createdAt: await arrivedAt(asked) });
    const hold = await bookedEvent({ enquiryId: asked, kind: "hold", status: "released" });
    // The note staff typed when they released it names her.
    await f.pool.query("INSERT INTO booking_status_history (booking_id, from_state, to_state, note) SELECT id, 'hold', 'released', $2 FROM bookings WHERE event_id = $1",
      [hold, "Released: Kirsty Released chose June elsewhere"]);
    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await count("event_plan_notifications WHERE id = $1", [formNotice])).toBe(0);
    expect(await value("SELECT h.note AS value FROM booking_status_history AS h JOIN bookings AS b ON b.id = h.booking_id WHERE b.event_id = $1", [hold]))
      .toBe("Released: Erased chose June elsewhere");
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
    const director = await f.addPerson({ name: "Ross Director", emails: [`ross.director-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(director);
    // His deal, made from her enquiry; his proposal's layout; the event staff
    // made from it, inked through the bind core, with no deal on the event.
    const directorsLayout = await layout("TEST ONLY director's layout");
    await proposal({ enquiryId: asked, opportunityId: await deal({ primaryContactId: director, sourceEnquiryId: asked }), layoutId: directorsLayout });
    const directorsBooking = await bound({ kind: "ink", title: "TEST ONLY director's dinner" });
    await laidOutFrom(directorsBooking.eventId, directorsLayout);
    const directorsInk = directorsBooking.id;
    class RolledBack extends Error {}
    const seen: { outcome: unknown; reason: unknown; directors: unknown } = { outcome: undefined, reason: "unread", directors: "unread" };
    await expect(f.db.transaction(async (tx) => {
      const decide = (booking: string, reason: string) => tx.execute(sql`insert into decisions
        (venue_id, action_class, subject_kind, subject_id, body, reason, prepared_by, expires_at)
        values (${f.venueId}, 'booking_time_move', 'booking', ${booking}, '{}'::jsonb, ${reason}, ${f.users.staff}, now() + interval '1 day')`);
      // On the hold from her enquiry, the reason goes whatever it says.
      await decide(hold, "TEST ONLY Nessa wants to start later");
      // On the director's deal made from her enquiry, only a reason naming her.
      await decide(directorsInk, "TEST ONLY Nessa Decided asked for this");
      await decide(directorsInk, "TEST ONLY the band arrives late");
      const lock = await lockPerson(tx, f.venueId, person);
      if (lock.state !== "live") throw new Error("The person is not live");
      seen.outcome = await eraseLockedPerson(tx, lock.row, { actorUserId: f.users.admin, now: new Date() });
      seen.reason = (await tx.execute(sql`select reason from decisions where subject_id = ${hold}`)).rows[0]?.["reason"];
      seen.directors = (await tx.execute(sql`select reason from decisions where subject_id = ${directorsInk} order by reason nulls first`)).rows
        .map((row) => row["reason"]);
      throw new RolledBack();
    })).rejects.toBeInstanceOf(RolledBack);
    expect(seen.outcome).toMatchObject({ ok: true, counts: { reworded: 2 } });
    expect(seen.reason).toBeNull();
    expect(seen.directors).toEqual([null, "TEST ONLY the band arrives late"]);
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
    const hisLayout = await layout("TEST ONLY Brodie's dinner layout");
    const offered = await proposal({ enquiryId: asked, opportunityId: his, title: "Ailsa Assistant's dinner for Brodie Director",
      acceptedName: "Brodie Director", layoutId: hisLayout });
    await shareLink(offered);
    const hisWords = await comment(offered, { authorName: "Brodie Director", body: "TEST ONLY Ailsa Assistant will confirm numbers" });
    await f.db.insert(schema.proposalStatusHistory).values({ proposalId: offered, fromStatus: "sent", toStatus: "accepted", changedBy: null,
      note: "TEST ONLY his note" });
    // His deposit makes the version sent its identity: it stays as sent.
    const sentVersion = { title: "Ailsa Assistant's dinner for Brodie Director", clientMessage: "Dear Brodie Director" };
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify(sentVersion), "e".repeat(64)]);
    await f.db.insert(schema.proposalDepositRequests).values({ venueId: f.venueId, proposalId: offered, proposalVersion: 1,
      proposalVersionHash: "e".repeat(64), basis: "amount", quoteTotalMinor: 100_000, amountMinor: 25_000, currency: "GBP" });
    // She accepted his drinks proposal for him, typing her own name, from no address.
    const drinks = await proposal({ enquiryId: asked, opportunityId: his, title: "TEST ONLY drinks", acceptedName: "Ailsa Assistant" });
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [drinks, JSON.stringify({ title: "TEST ONLY drinks", clientMessage: "Thank you, Ailsa Assistant" }), "f".repeat(64)]);
    const approval = await comment(drinks, { kind: "approval_note", authorName: "Ailsa Assistant", body: "TEST ONLY approved for Brodie" });
    // His date: pencilled from her enquiry through the bind core (which makes
    // the event, with no deal on it), linked to his proposal's layout, inked.
    // His, not hers to keep.
    const hisBooking = await bound({ enquiryId: asked, kind: "ink", title: "Ailsa Assistant — Dinner" });
    await laidOutFrom(hisBooking.eventId, hisLayout);
    const hisEvent = hisBooking.eventId;
    expect(await value("SELECT opportunity_id AS value FROM events WHERE id = $1", [hisEvent])).toBeNull();
    // The office line she enquired from is his too. Staff linked a seating
    // plan to his event alone, with him as the day-of contact on that line.
    await f.pool.query("UPDATE enquiries SET guest_phone = '+44 141 496 0123' WHERE id = $1", [asked]);
    await f.pool.query("UPDATE contacts SET phone = '0141 496 0123' WHERE id = $1", [director]);
    const seating = await layout("TEST ONLY Ailsa Assistant's seating for Brodie", { dayOfContact: { name: "Brodie Director", role: "",
      phone: "0141 496 0123", email: "" }, specialInstructions: "", accessNotes: "" });
    await laidOutFrom(hisEvent, seating);

    const erased = await post(`/people/${assistant}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: { enquiries: number; comments: number } } }>().data.counts)
      .toMatchObject({ enquiries: 1, comments: 0 });
    expect(await count("enquiries WHERE id = $1", [asked])).toBe(0);
    expect(await value("SELECT row_to_json(d) AS value FROM (SELECT title, primary_contact_id FROM opportunities WHERE id = $1) d", [his]))
      .toEqual({ title: "Dinner — Erased", primary_contact_id: director });
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT title, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ title: "Erased's dinner for Brodie Director", accepted_name: "Brodie Director" });
    // His comment stays his, without her name.
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT author_name, body FROM proposal_comments WHERE id = $1) c", [hisWords]))
      .toEqual({ author_name: "Brodie Director", body: "TEST ONLY Erased will confirm numbers" });
    expect(await value("SELECT note AS value FROM proposal_status_history WHERE proposal_id = $1", [offered])).toBe("TEST ONLY his note");
    expect(await count("proposal_share_tokens WHERE proposal_id = $1 AND revoked_at IS NULL", [offered])).toBe(1);
    expect(await value("SELECT row_to_json(v) AS value FROM (SELECT payload, source_hash FROM proposal_versions WHERE proposal_id = $1) v", [offered]))
      .toEqual({ payload: sentVersion, source_hash: "e".repeat(64) });
    expect(await value("SELECT accepted_name AS value FROM proposals WHERE id = $1", [drinks])).toBe("Erased");
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT author_name, body FROM proposal_comments WHERE id = $1) c", [approval]))
      .toEqual({ author_name: "Erased", body: "TEST ONLY approved for Brodie" });
    expect(await value("SELECT row_to_json(v) AS value FROM (SELECT payload, source_hash <> repeat('f', 64) AS rehashed FROM proposal_versions WHERE proposal_id = $1) v", [drinks]))
      .toEqual({ payload: { title: "TEST ONLY drinks", clientMessage: "Thank you, Erased" }, rehashed: true });
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT title, kind, status FROM bookings WHERE event_id = $1) b", [hisEvent]))
      .toEqual({ title: "Erased — Dinner", kind: "ink", status: "active" });
    // Reached through his event alone: her name leaves the plan; the number
    // they share identifies nobody, so his contact stays.
    expect(await value(`SELECT row_to_json(c) AS value FROM (SELECT name, metadata->'instructions'->'dayOfContact'->>'name' AS contact
      FROM configurations WHERE id = $1) c`, [seating])).toEqual({ name: "TEST ONLY Erased's seating for Brodie", contact: "Brodie Director" });
  });

  it("takes their typed name off someone else's quote with no event that they accepted through its link", async () => {
    // Brodie's quote has no layout yet, so accepting it writes nothing to an
    // event's change feed: only the accepted name, the approval note (the
    // share page sends a name and no address) and the team's notice.
    const email = `ailsa.typed-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Ailsa Typed", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    await enquiry({ email, contactId: person, name: "Ailsa Typed" });
    const quote = await proposal({ title: "TEST ONLY Brodie's quote" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [quote]);
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [quote, JSON.stringify({ title: "TEST ONLY Brodie's quote", clientMessage: null }), "9".repeat(64)]);
    // An older acceptance in her name, with no note left beside it.
    const older = await proposal({ title: "TEST ONLY Brodie's older quote", acceptedName: "Ailsa Typed" });
    const token = await issuedLink(quote);
    const accepted = await f.server.inject({ method: "POST", url: `/proposal-share/${token}/approve`, payload: { authorName: "ailsa  typed", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const desk = deskPath(quote);
    const named = "event_plan_notifications WHERE action_path = $1 AND (title ILIKE '%ailsa%typed%' OR body ILIKE '%ailsa%typed%')";
    expect(await value("SELECT accepted_name AS value FROM proposals WHERE id = $1", [quote])).toBe("ailsa  typed");
    expect(await count("proposal_comments WHERE proposal_id = $1 AND author_name = 'ailsa  typed' AND author_email IS NULL", [quote])).toBe(1);
    expect(await count("event_plan_changes WHERE proposal_id = $1", [quote])).toBe(0);
    expect(await count(named, [desk])).toBeGreaterThan(0);

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await value("SELECT accepted_name AS value FROM proposals WHERE id = $1", [quote])).toBe("Erased");
    expect(await count("proposal_comments WHERE proposal_id = $1 AND author_name = 'Erased'", [quote])).toBe(1);
    expect(await value("SELECT accepted_name AS value FROM proposals WHERE id = $1", [older])).toBe("Erased");
    expect(await count(named, [desk])).toBe(0);
    // Brodie's link still opens his quote.
    expect(await count("proposal_share_tokens WHERE proposal_id = $1 AND revoked_at IS NULL", [quote])).toBe(1);
  });

  it("refuses a client's answer that waited on their erasure: the link it came through was revoked meanwhile", async () => {
    const email = `isla.waiting-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Waiting", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Waiting" });
    const offered = await proposal({ enquiryId: asked, title: "TEST ONLY her quote" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [offered]);
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "TEST ONLY her quote", clientMessage: null }), "8".repeat(64)]);
    const token = await issuedLink(offered);
    // Her comment arrives while the erasure holds her proposal: it waits on
    // the lock, then finds her link revoked and writes nothing.
    const holder = await f.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [offered]);
      const pending = f.server.inject({ method: "POST", url: `/proposal-share/${token}/comment`,
        payload: { body: "TEST ONLY Isla Waiting would like a later start", kind: "comment", authorName: "Isla Waiting" } });
      await waitForLockWait("proposals");
      await holder.query("UPDATE proposal_share_tokens SET revoked_at = now() WHERE proposal_id = $1", [offered]);
      await holder.query("COMMIT");
      const answer = await pending;
      expect(answer.statusCode, answer.body).toBe(404);
    } finally {
      holder.release();
    }
    expect(await count("proposal_comments WHERE proposal_id = $1", [offered])).toBe(0);
  });

  it("takes the Diary's locks in the order its own writers do, so a transition beside an erasure never deadlocks", async () => {
    // A Diary transition locks its booking, then its event. The erasure locks
    // bookings before events, so it waits on the booking and leaves the event
    // to the transition; the other way round, both would wait for ever and
    // PostgreSQL would roll one back.
    const email = `nessa.locked-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Nessa Locked", emails: [email] });
    peopleIds.push(person);
    const asked = await enquiry({ email, contactId: person });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Nessa's hold" });
    const transition = await f.pool.connect();
    try {
      await transition.query("BEGIN");
      await transition.query("SET LOCAL lock_timeout = '10s'");
      await transition.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [hold.id]);
      const pending = post(`/people/${person}/erase`, "admin");
      await waitForLockWait("bookings");
      // The transition now asks for the event: it must get it at once.
      await transition.query("SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE", [hold.eventId]);
      await transition.query("COMMIT");
      const answer = await pending;
      expect(answer.statusCode, answer.body).toBe(409);
      expect(answer.json<{ code: string }>().code).toBe("PERSON_HAS_BOOKING");
    } finally {
      transition.release();
    }
  });

  /** Runs the writer's side of a two-connection case: `first` before the
   *  erasure starts, `then` once the erasure waits on a lock in `table`.
   *  `then` must get its locks at once, so lock_timeout makes a wait fail. */
  async function beside(input: {
    first: (writer: import("pg").PoolClient) => Promise<void>;
    erase: () => Promise<unknown>;
    table: string;
    then: (writer: import("pg").PoolClient) => Promise<void>;
  }): Promise<unknown> {
    const writer = await f.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SET LOCAL lock_timeout = '5s'");
      await input.first(writer);
      const erasing = input.erase();
      await waitForLockWait(input.table);
      await input.then(writer);
      await writer.query("COMMIT");
      return await erasing;
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      writer.release();
    }
  }

  it("takes a decision before its booking, as an approval does: an approval beside an erasure never deadlocks", async () => {
    // Decisions are kept for good and restrict their venue, so this case
    // uses a venue of its own that stays in the disposable database.
    const tag = randomUUID().slice(0, 8);
    const venue = only((await f.pool.query<{ id: string }>(
      "INSERT INTO venues (name, slug, address) VALUES ('TEST ONLY decisions venue', $1, 'TEST ONLY') RETURNING id", [`decided-${tag}`])).rows, "venue").id;
    const user = only((await f.pool.query<{ id: string }>(
      "INSERT INTO users (email, name, role, venue_id) VALUES ($1, 'TEST ONLY approver', 'admin', $2) RETURNING id",
      [`approver-${tag}@example.test`, venue])).rows, "user").id;
    const room = only(await f.db.insert(schema.spaces).values({ venueId: venue, name: "TEST ONLY Saloon", slug: `decided-saloon-${tag}`,
      widthM: "8", lengthM: "12", heightM: "4", floorPlanOutline: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 0, y: 12 }] })
      .returning({ id: schema.spaces.id }), "room").id;
    const person = only((await f.pool.query<{ id: string }>("INSERT INTO contacts (venue_id, name) VALUES ($1, 'Nessa Approved') RETURNING id",
      [venue])).rows, "person").id;
    const asked = only(await f.db.insert(schema.enquiries).values({ venueId: venue, spaceId: room, name: "Nessa Approved",
      email: `nessa.approved-${tag}@example.test`, contactId: person }).returning({ id: schema.enquiries.id }), "enquiry").id;
    const startsAt = new Date(Date.UTC(2027, 3, 1, 18));
    const [hold] = await insertBoundBookings(f.db, [{ venueId: venue, spaceId: room, kind: "hold", title: "TEST ONLY Nessa's hold",
      createdBy: user, startsAt, endsAt: new Date(startsAt.getTime() + 5 * 3600_000), enquiryId: asked, rank: 1, decisionAt: startsAt,
      nextAction: "TEST ONLY follow up", nextActionDueAt: startsAt, ownerUserId: user }]);
    if (hold === undefined || hold.eventId === null) throw new Error("No hold");
    const decision = only((await f.pool.query<{ id: string }>(
      `INSERT INTO decisions (venue_id, action_class, subject_kind, subject_id, body, prepared_by, expires_at)
       VALUES ($1, 'booking_time_move', 'booking', $2, '{}'::jsonb, $3, now() + interval '1 day') RETURNING id`,
      [venue, hold.id, user])).rows, "decision").id;
    const outcome = await beside({
      // The approval holds its decision...
      first: async (writer) => { await writer.query("SELECT id FROM decisions WHERE id = $1 FOR UPDATE", [decision]); },
      erase: () => f.db.transaction(async (tx) => {
        const lock = await lockPerson(tx, venue, person);
        if (lock.state !== "live") throw new Error("Not live");
        return eraseLockedPerson(tx, lock.row, { actorUserId: null, now: new Date() });
      }),
      table: "decisions",
      // ...then takes the booking and its event, which the erasure has not.
      then: async (writer) => {
        await writer.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [hold.id]);
        await writer.query("SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE", [hold.eventId]);
      },
    });
    expect(outcome).toEqual({ ok: false, refusal: "has_booking" });
  });

  it("takes a proposal before its enquiry, as a send does: a first proposal sent beside an erasure never deadlocks", async () => {
    const email = `isla.sent-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Sent", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person });
    const offered = await proposal({ enquiryId: asked });
    const answer = await beside({
      // The send holds the proposal...
      first: async (writer) => { await writer.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [offered]); },
      erase: () => post(`/people/${person}/erase`, "admin"),
      table: "proposals",
      // ...then stamps the enquiry's first reply, which the erasure has not taken.
      then: async (writer) => { await writer.query("UPDATE enquiries SET updated_at = now() WHERE id = $1", [asked]); },
    }) as LightMyRequestResponse;
    expect(answer.statusCode, answer.body).toBe(200);
  });

  it("takes an event before its layout, as a layout link does: a link made beside an erasure never deadlocks", async () => {
    const email = `isla.linked-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Linked", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person });
    const sketch = await layout("TEST ONLY linked sketch");
    await proposal({ enquiryId: asked, layoutId: sketch });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    const answer = await beside({
      // The link route holds the event first (routes/events.ts)...
      first: async (writer) => { await writer.query("SELECT id FROM events WHERE id = $1 FOR KEY SHARE", [hold.eventId]); },
      erase: () => post(`/people/${person}/erase`, "admin"),
      table: "events",
      // ...then the layout, and links it, before the erasure reaches layouts.
      then: async (writer) => {
        await writer.query("SELECT id FROM configurations WHERE id = $1 FOR SHARE", [sketch]);
        await writer.query("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'variant_configuration')",
          [hold.eventId, sketch]);
      },
    }) as LightMyRequestResponse;
    expect(answer.statusCode, answer.body).toBe(200);
  });

  it("refuses an acceptance that waited on the erasure itself: it finds her link revoked and writes nothing", async () => {
    const email = `isla.accepting-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Accepting", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Accepting" });
    const offered = await proposal({ enquiryId: asked, title: "TEST ONLY her quote to accept" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [offered]);
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "TEST ONLY her quote to accept", clientMessage: null }), "6".repeat(64)]);
    const token = await issuedLink(offered);
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    // Something holds her event, so the erasure stops there holding her
    // proposal; her acceptance arrives and waits on it.
    const holder = await f.pool.connect();
    let accepting: Promise<LightMyRequestResponse> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR KEY SHARE", [hold.eventId]);
      const erasing = post(`/people/${person}/erase`, "admin");
      await waitForLockWait("events");
      accepting = f.server.inject({ method: "POST", url: `/proposal-share/${token}/approve`, payload: { authorName: "Isla Accepting", version: 1 } });
      await waitForLockWait("proposals");
      await holder.query("COMMIT");
      const erased = await erasing;
      expect(erased.statusCode, erased.body).toBe(200);
    } finally {
      holder.release();
    }
    const answer = await accepting;
    expect(answer.statusCode, answer.body).toBe(404);
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT status, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ status: "sent", accepted_name: null });
    expect(await count("proposal_comments WHERE proposal_id = $1", [offered])).toBe(0);
  });

  /** An answer commits (hers through her link, or a manager's), and its
   *  announcement is held back until her erasure holds the proposal: the
   *  deal move that comes before it waits on something holding the deal;
   *  the erasure starts and is stopped at a row it locks later (stopAt),
   *  after the proposal; the deal is let go. The announcement must then
   *  wait on the proposal (FOR KEY SHARE) until the erasure has committed. */
  function approve(token: string, payload: object): Promise<LightMyRequestResponse> {
    return f.server.inject({ method: "POST", url: `/proposal-share/${token}/approve`, payload });
  }

  async function answeredJustBefore(input: {
    answer: () => Promise<LightMyRequestResponse>; dealId: string; person: string; erasureFirstWaitsOn: string;
    stopAt: { table: "events" | "configurations"; id: string };
  }): Promise<LightMyRequestResponse> {
    // Connections of their own: the fixture's pool (four) serves the route,
    // the erasure, the deal move or copy, and the waits.
    if (PLATFORM_TARGET === undefined) throw new Error("No platform database");
    const dealHolder = new Client({ connectionString: PLATFORM_TARGET });
    const stopper = new Client({ connectionString: PLATFORM_TARGET });
    await dealHolder.connect();
    await stopper.connect();
    try {
      await dealHolder.query("BEGIN");
      await dealHolder.query("SELECT id FROM opportunities WHERE id = $1 FOR UPDATE", [input.dealId]);
      const accepting = input.answer();
      await waitForStatement('%update "opportunities"%', "the deal moving with the acceptance");
      await stopper.query("BEGIN");
      await stopper.query(`SELECT id FROM ${input.stopAt.table} WHERE id = $1 FOR SHARE`, [input.stopAt.id]);
      const erasing = post(`/people/${input.person}/erase`, "admin");
      await waitForLockWait(input.erasureFirstWaitsOn);
      await dealHolder.query("COMMIT");
      await waitForLockWait(input.stopAt.table);
      await waitForLockWait("proposals", "for key share");
      await stopper.query("COMMIT");
      const erased = await erasing;
      expect(erased.statusCode, erased.body).toBe(200);
      return await accepting;
    } finally {
      await dealHolder.query("ROLLBACK").catch(() => undefined);
      await stopper.query("ROLLBACK").catch(() => undefined);
      await dealHolder.end();
      await stopper.end();
    }
  }

  it("copies nothing of an acceptance that committed just before her erasure: the copy waits on her proposal, then finds it erased", async () => {
    const email = `isla.racing-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Racing", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Racing" });
    const hers = await deal({ title: "TEST ONLY her deal", primaryContactId: person, sourceEnquiryId: asked });
    const plan = await layout("TEST ONLY her layout");
    const offered = await proposal({ enquiryId: asked, opportunityId: hers, layoutId: plan, title: "TEST ONLY her quote" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [offered]);
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "TEST ONLY her quote", clientMessage: null }), "5".repeat(64)]);
    const token = await issuedLink(offered);
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    await laidOutFrom(hold.eventId, plan);
    // The erasure takes her proposal, waits on her deal behind the deal move,
    // then holds her event and stops at her layout; the copy's change would
    // land on that event.
    const answer = await answeredJustBefore({ answer: () => approve(token, { authorName: "Isla Racing", body: "TEST ONLY Isla Racing says yes", version: 1 }),
      dealId: hers, person, erasureFirstWaitsOn: "opportunities", stopAt: { table: "configurations", id: plan } });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT status, accepted_name FROM proposals WHERE id = $1) p", [offered]))
      .toEqual({ status: "accepted", accepted_name: null });
    expect(await value("SELECT stage AS value FROM opportunities WHERE id = $1", [hers])).toBe("won");
    expect(await count("event_plan_changes WHERE event_id = $1 AND actor_role = 'client'", [hold.eventId])).toBe(0);
    expect(await count("event_plan_notifications WHERE venue_id = $1 AND (title ILIKE '%Isla Racing%' OR body ILIKE '%Isla Racing%')",
      [f.venueId])).toBe(0);
  });

  it("copies nothing of her acceptance of someone else's quote once her erasure has taken her name out of it", async () => {
    const email = `isla.answering-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Answering", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Answering" });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold beside his quote" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    // Her director's deal and quote; she accepts it through his link, by name.
    const director = await f.addPerson({ name: "Duncan Director", emails: [`duncan.director-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(director);
    const his = await deal({ title: "TEST ONLY his deal", primaryContactId: director });
    const quote = await proposal({ opportunityId: his, title: "TEST ONLY his quote" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [quote]);
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [quote, JSON.stringify({ title: "TEST ONLY his quote", clientMessage: null }), "4".repeat(64)]);
    const token = await issuedLink(quote);
    // The erasure finds his quote by the name she typed and holds it, then
    // stops at her event. His link stays open: only what she wrote shows the
    // erasure has been.
    const answer = await answeredJustBefore({ answer: () => approve(token, { authorName: "Isla Answering", version: 1 }),
      dealId: his, person, erasureFirstWaitsOn: "events", stopAt: { table: "events", id: hold.eventId } });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT status, accepted_name FROM proposals WHERE id = $1) p", [quote]))
      .toEqual({ status: "accepted", accepted_name: "Erased" });
    expect(await value("SELECT stage AS value FROM opportunities WHERE id = $1", [his])).toBe("won");
    expect(await count("event_plan_notifications WHERE venue_id = $1 AND (title ILIKE '%Isla Answering%' OR body ILIKE '%Isla Answering%')",
      [f.venueId])).toBe(0);
  });

  it("announces a manager's answer that committed just before her erasure after it, with the proposal's title as it now reads", async () => {
    const email = `isla.staffed-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Staffed", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Staffed" });
    const hers = await deal({ title: "TEST ONLY her deal", primaryContactId: person, sourceEnquiryId: asked });
    const plan = await layout("TEST ONLY her layout");
    const offered = await proposal({ enquiryId: asked, opportunityId: hers, layoutId: plan, title: "Isla Staffed's wedding" });
    await f.pool.query("UPDATE proposals SET status = 'sent', current_version = 1, sent_version = 1, sent_at = now() WHERE id = $1", [offered]);
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    await laidOutFrom(hold.eventId, plan);
    // A manager marks it accepted: the deal moves, then the change is
    // announced on her event. Its foreign keys would take the event first.
    const answer = await answeredJustBefore({ answer: () => post(`/proposals/${offered}/transition`, "admin", { status: "accepted" }),
      dealId: hers, person, erasureFirstWaitsOn: "opportunities", stopAt: { table: "configurations", id: plan } });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(await value("SELECT summary AS value FROM event_plan_changes WHERE event_id = $1 AND source_kind = 'proposal'", [hold.eventId]))
      .toBe("Erased's wedding moved from sent to accepted.");
    expect(await count("event_plan_notifications WHERE venue_id = $1 AND (title ILIKE '%Isla Staffed%' OR body ILIKE '%Isla Staffed%')",
      [f.venueId])).toBe(0);
  });

  it("takes a layout before its sheets, as an approval does: a sheet written beside her erasure never waits on it", async () => {
    const email = `isla.sheeted-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Sheeted", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Sheeted" });
    const plan = await layout("TEST ONLY Isla Sheeted's layout");
    await proposal({ enquiryId: asked, layoutId: plan, title: "TEST ONLY her quote" });
    const sheet = only(await f.db.insert(schema.configurationSheetSnapshots).values({ configurationId: plan, version: 1,
      payload: { config: { name: "TEST ONLY Isla Sheeted's layout" } }, sourceHash: "3".repeat(64) })
      .returning({ id: schema.configurationSheetSnapshots.id }), "sheet").id;
    const outcome = await beside({
      // The approval holds the layout...
      first: async (writer) => { await writer.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [plan]); },
      erase: () => post(`/people/${person}/erase`, "admin"),
      table: "configurations",
      // ...then writes its sheet, which the erasure has not taken.
      then: async (writer) => { await writer.query("UPDATE configuration_sheet_snapshots SET payload = payload WHERE id = $1", [sheet]); },
    }) as LightMyRequestResponse;
    expect(outcome.statusCode, outcome.body).toBe(200);
    expect(await value("SELECT payload->'config'->>'name' AS value FROM configuration_sheet_snapshots WHERE id = $1", [sheet]))
      .toBe("TEST ONLY Erased's layout");
  });

  it("answers RETRY when a hold is pencilled from her enquiry between its reads and its locks, and changes nothing", async () => {
    const email = `isla.pencilled-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Pencilled", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Pencilled" });
    const released = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [released.id]);
    let pencilled = "";
    const outcome = await beside({
      // Something holds the hold it read, so it stops at the bookings...
      first: async (writer) => { await writer.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [released.id]); },
      erase: () => post(`/people/${person}/erase`, "admin"),
      table: "bookings",
      // ...while a new hold is pencilled from her enquiry, which it has not
      // locked yet, and committed.
      then: async () => { pencilled = (await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's new hold" })).id; },
    }) as LightMyRequestResponse;
    expect(outcome.statusCode, outcome.body).toBe(409);
    expect(outcome.json<{ code: string }>().code).toBe("RETRY");
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [person])).toBe(1);
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT title, enquiry_id FROM bookings WHERE id = $1) b", [pencilled]))
      .toEqual({ title: "TEST ONLY Isla's new hold", enquiry_id: asked });
    // Tried again, it sees the live hold and refuses.
    await refused(person, "PERSON_HAS_BOOKING");
  });

  it("leaves the reason of a decision prepared while the erasure waits: only the decisions it locked lose theirs", async () => {
    // Decisions are kept for good and restrict their venue, so this case
    // uses a venue of its own that stays in the disposable database.
    const tag = randomUUID().slice(0, 8);
    const venue = only((await f.pool.query<{ id: string }>(
      "INSERT INTO venues (name, slug, address) VALUES ('TEST ONLY late decision venue', $1, 'TEST ONLY') RETURNING id", [`late-${tag}`])).rows,
      "venue").id;
    const user = only((await f.pool.query<{ id: string }>(
      "INSERT INTO users (email, name, role, venue_id) VALUES ($1, 'TEST ONLY approver', 'admin', $2) RETURNING id",
      [`late-approver-${tag}@example.test`, venue])).rows, "user").id;
    const room = only(await f.db.insert(schema.spaces).values({ venueId: venue, name: "TEST ONLY Saloon", slug: `late-saloon-${tag}`,
      widthM: "8", lengthM: "12", heightM: "4", floorPlanOutline: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 12 }, { x: 0, y: 12 }] })
      .returning({ id: schema.spaces.id }), "room").id;
    const person = only((await f.pool.query<{ id: string }>("INSERT INTO contacts (venue_id, name) VALUES ($1, 'Nessa Late') RETURNING id",
      [venue])).rows, "person").id;
    const asked = only(await f.db.insert(schema.enquiries).values({ venueId: venue, spaceId: room, name: "Nessa Late",
      email: `nessa.late-${tag}@example.test`, contactId: person }).returning({ id: schema.enquiries.id }), "enquiry").id;
    const startsAt = new Date(Date.UTC(2027, 4, 1, 18));
    const [hold] = await insertBoundBookings(f.db, [{ venueId: venue, spaceId: room, kind: "hold", title: "TEST ONLY Nessa's hold",
      createdBy: user, startsAt, endsAt: new Date(startsAt.getTime() + 5 * 3600_000), enquiryId: asked, rank: 1, decisionAt: startsAt,
      nextAction: "TEST ONLY follow up", nextActionDueAt: startsAt, ownerUserId: user }]);
    if (hold === undefined) throw new Error("No hold");
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    let decision = "";
    const outcome = await beside({
      // The erasure has read her decisions (none) and stops at her hold...
      first: async (writer) => { await writer.query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE", [hold.id]); },
      erase: () => f.db.transaction(async (tx) => {
        const lock = await lockPerson(tx, venue, person);
        if (lock.state !== "live") throw new Error("Not live");
        return eraseLockedPerson(tx, lock.row, { actorUserId: null, now: new Date() });
      }),
      table: "bookings",
      // ...while a time move is prepared on that hold, naming her.
      then: async (writer) => {
        decision = only((await writer.query<{ id: string }>(
          `INSERT INTO decisions (venue_id, action_class, subject_kind, subject_id, body, prepared_by, expires_at, reason)
           VALUES ($1, 'booking_time_move', 'booking', $2, '{}'::jsonb, $3, now() + interval '1 day', 'TEST ONLY Nessa Late asked to move')
           RETURNING id`, [venue, hold.id, user])).rows, "decision").id;
      },
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(await value("SELECT reason AS value FROM decisions WHERE id = $1", [decision])).toBe("TEST ONLY Nessa Late asked to move");
  });

  it("takes the event before the layout, as a link made beside her erasure does: the link waits on the event, never in a circle", async () => {
    const email = `isla.linked-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Linked", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Linked" });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    // Two layouts of hers: the erasure stops at the one it locks first (by
    // id), holding her event; the link is made to the other, not yet taken.
    const [stopAt, linked] = [await layout("TEST ONLY her first plan"), await layout("TEST ONLY her second plan")].sort() as [string, string];
    await proposal({ enquiryId: asked, layoutId: stopAt, title: "TEST ONLY her quote" });
    await proposal({ enquiryId: asked, layoutId: linked, title: "TEST ONLY her other quote" });
    if (PLATFORM_TARGET === undefined) throw new Error("No platform database");
    const stopper = new Client({ connectionString: PLATFORM_TARGET });
    await stopper.connect();
    try {
      await stopper.query("BEGIN");
      await stopper.query("SELECT id FROM configurations WHERE id = $1 FOR SHARE", [stopAt]);
      const erasing = post(`/people/${person}/erase`, "admin");
      await waitForLockWait("configurations");
      const linking = post(`/events/${hold.eventId}/configuration-links`, "admin", { configurationId: linked });
      await waitForLockWait("events", "for key share");
      await stopper.query("COMMIT");
      const erased = await erasing;
      expect(erased.statusCode, erased.body).toBe(200);
      const link = await linking;
      expect(link.statusCode, link.body).toBe(201);
    } finally {
      await stopper.query("ROLLBACK").catch(() => undefined);
      await stopper.end();
    }
  });

  it("compiles a handoff pack beside her erasure in the house order: the compile waits on her event, never in a circle", async () => {
    const email = `isla.compiled-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Compiled", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Compiled" });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    // Her approved layout, a table and two chairs, linked to her event.
    const plan = await layout("TEST ONLY her dinner plan");
    const [table, chair] = await f.db.insert(schema.assetDefinitions).values([
      { name: "TEST ONLY round table", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.76", collisionType: "cylinder" },
      { name: "TEST ONLY chair", category: "chair", widthM: "0.45", depthM: "0.45", heightM: "0.9", collisionType: "box" },
    ]).returning({ id: schema.assetDefinitions.id });
    if (table === undefined || chair === undefined) throw new Error("No assets");
    const tableId = randomUUID();
    await f.db.insert(schema.placedObjects).values([
      { id: tableId, configurationId: plan, assetDefinitionId: table.id, positionX: "1", positionY: "0", positionZ: "1", metadata: { groupId: tableId } },
      { configurationId: plan, assetDefinitionId: chair.id, positionX: "1", positionY: "0", positionZ: "0", metadata: { groupId: tableId } },
      { configurationId: plan, assetDefinitionId: chair.id, positionX: "1", positionY: "0", positionZ: "2", metadata: { groupId: tableId } },
    ].map((piece) => ({ ...piece, coordinateSpace: "real_m_v1" as const, coordinateWriteToken: randomUUID() })));
    await laidOutFrom(hold.eventId, plan);
    const created = await createSnapshot(f.db, { configId: plan, createdBy: f.users.admin, baseUrl: "http://localhost:3009" });
    await approveSnapshot(f.db, created.snapshot.id, f.users.admin);
    // Something holds her layout, so the erasure stops there holding her
    // event; the compile for that event arrives and must wait on the event.
    if (PLATFORM_TARGET === undefined) throw new Error("No platform database");
    const stopper = new Client({ connectionString: PLATFORM_TARGET });
    await stopper.connect();
    try {
      await stopper.query("BEGIN");
      await stopper.query("SELECT id FROM configurations WHERE id = $1 FOR SHARE", [plan]);
      const erasing = post(`/people/${person}/erase`, "admin");
      await waitForLockWait("configurations");
      const compiling = post(`/ops/handoff-packs/from-configuration/${plan}`, "admin", { eventId: hold.eventId });
      await waitForLockWait("events", "for key share");
      await stopper.query("COMMIT");
      const erased = await erasing;
      expect(erased.statusCode, erased.body).toBe(200);
      const compiled = await compiling;
      expect(compiled.statusCode, compiled.body).toBe(201);
    } finally {
      await stopper.query("ROLLBACK").catch(() => undefined);
      await stopper.end();
    }
  });

  it("keeps an issue reworded when its update waited on her erasure: the update writes only what it names", async () => {
    const email = `isla.issued-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Issued", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Issued" });
    const hold = await bound({ enquiryId: asked, kind: "hold", title: "TEST ONLY Isla's released hold" });
    await f.pool.query("UPDATE bookings SET status = 'released' WHERE id = $1", [hold.id]);
    const issue = only(await f.db.insert(schema.eventDayIssues).values({ eventId: hold.eventId, title: "Isla Issued's cake is late",
      detail: "TEST ONLY Isla Issued is waiting at the door", escalationNote: "TEST ONLY told Isla Issued's mother" })
      .returning({ id: schema.eventDayIssues.id }), "issue").id;
    // Her address's lead lock is held, so the erasure stops after rewording
    // the issue and before it commits; the hallkeeper's update then reads the
    // old text and waits on the row.
    if (PLATFORM_TARGET === undefined) throw new Error("No platform database");
    const holder = new Client({ connectionString: PLATFORM_TARGET });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [guestLeadLockKey(email)]);
      const erasing = post(`/people/${person}/erase`, "admin");
      await waitForStatement("%pg_advisory_xact_lock%", "the erasure at her address's lead lock");
      const patching = f.server.inject({ method: "PATCH", url: `/events/${hold.eventId}/issues/${issue}`,
        headers: f.bearer("admin"), payload: { status: "resolved" } });
      await waitForStatement('%update "event_day_issues"%', "the issue update behind the erasure");
      await holder.query("COMMIT");
      const erased = await erasing;
      expect(erased.statusCode, erased.body).toBe(200);
      const patched = await patching;
      expect(patched.statusCode, patched.body).toBe(200);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await value("SELECT row_to_json(i) AS value FROM (SELECT title, detail, escalation_note, status FROM event_day_issues WHERE id = $1) i",
      [issue])).toEqual({ title: "Erased's cake is late", detail: "TEST ONLY Erased is waiting at the door",
      escalation_note: "TEST ONLY told Erased's mother", status: "resolved" });
    expect(await value("SELECT message AS value FROM ops_status_updates WHERE event_id = $1", [hold.eventId]))
      .toBe("Issue \"Erased's cake is late\" updated to resolved.");
  });

  it("takes a layout's pieces before its sheets, as the piece-note retention does: a sheet written after a piece never waits", async () => {
    const email = `isla.pieced-${randomUUID().slice(0, 8)}@example.test`;
    const person = await f.addPerson({ name: "Isla Pieced", emails: [email] });
    peopleIds.push(person);
    leadEmails.push(email);
    const asked = await enquiry({ email, contactId: person, name: "Isla Pieced" });
    const plan = await layout("TEST ONLY her plan");
    await proposal({ enquiryId: asked, layoutId: plan, title: "TEST ONLY her quote" });
    const piece = only((await f.pool.query<{ id: string }>(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x,
      position_y, position_z, coordinate_write_token, metadata)
      VALUES ($1, (SELECT id FROM asset_definitions ORDER BY id LIMIT 1), 1, 0, 1, $2, $3::jsonb) RETURNING id`,
      [plan, randomUUID(), JSON.stringify({ notes: "Isla Pieced's grandparents" })])).rows, "piece").id;
    const sheet = only(await f.db.insert(schema.configurationSheetSnapshots).values({ configurationId: plan, version: 1,
      payload: { config: { name: "TEST ONLY her plan" } }, sourceHash: "2".repeat(64) })
      .returning({ id: schema.configurationSheetSnapshots.id }), "sheet").id;
    const outcome = await beside({
      // The retention updates the noted piece...
      first: async (writer) => { await writer.query("UPDATE placed_objects SET metadata = metadata WHERE id = $1", [piece]); },
      erase: () => post(`/people/${person}/erase`, "admin"),
      table: "placed_objects",
      // ...then the layout's sheet, which the erasure has not taken.
      then: async (writer) => { await writer.query("UPDATE configuration_sheet_snapshots SET payload = payload WHERE id = $1", [sheet]); },
    }) as LightMyRequestResponse;
    expect(outcome.statusCode, outcome.body).toBe(200);
    expect(await value("SELECT metadata AS value FROM placed_objects WHERE id = $1", [piece])).toEqual({ notes: "Erased's grandparents" });
  });

  it("takes the person out of what the venue keeps: household, deal, proposal, Diary, change feed and notices", async () => {
    const tag = randomUUID().slice(0, 8);
    const current = `isla.now-${tag}@example.test`;
    const old = `isla.old-${tag}@example.test`;
    const inbox = `erasable.home-${tag}@example.test`;
    const household = await f.addOrganisation({ name: "Isla Erasable", kind: "household" });
    await f.pool.query("UPDATE client_accounts SET address = '2 Erasable Road', notes = 'TEST ONLY Isla prefers calls', vat_number = 'GB000' WHERE id = $1",
      [household]);
    const person = await f.addPerson({ name: "Isla Erasable", emails: [current], phones: ["+44 7700 900444"], organisations: [household] });
    await f.pool.query("UPDATE contacts SET given_name = 'Isla', family_name = 'Erasable' WHERE id = $1", [person]);
    // Her partner, at the venue on his own record, with the inbox they share.
    const partner = await f.addPerson({ name: "Brodie Erasable", emails: [inbox] });
    peopleIds.push(person, partner);
    leadEmails.push(current, old);
    // Her first enquiry came from an address she has since replaced, typed
    // in lower case: its lead and what she signed with it go too.
    const asked = await enquiry({ email: old, contactId: person, name: "isla erasable" });
    // The sketch she drew with it names her mother as the day-of contact, on
    // her own mobile, written another way.
    const sketch = await layout("TEST ONLY sketch", { dayOfContact: { name: "TEST ONLY Mum", role: "", phone: "07700 900444", email: "" },
      specialInstructions: "", accessNotes: "" });
    await f.pool.query("UPDATE enquiries SET configuration_id = $2 WHERE id = $1", [asked, sketch]);
    await f.db.insert(schema.guestLeads).values({ email: old, name: "Isla Erasable", phone: "+44 7700 900222" });

    const dealId = await deal({ title: "Wedding — Isla Erasable", primaryContactId: person, sourceEnquiryId: asked });
    await f.pool.query("UPDATE opportunities SET next_action = 'Call Isla Erasable about the menus' WHERE id = $1", [dealId]);
    await f.db.insert(schema.activities).values({ opportunityId: dealId, body: "Isla Erasable asked about the Saloon", createdBy: f.users.staff });
    await f.db.insert(schema.opportunityStatusHistory).values({ opportunityId: dealId, fromStage: "proposal", toStage: "lost",
      changedBy: f.users.staff, note: "Isla Erasable chose another date" });
    // Her wedding layout names her as the day-of contact and in its notes, and
    // the sheet issued from it froze a copy.
    const weddingInstructions = { dayOfContact: { name: "Isla Erasable", role: "Bride", phone: "", email: "" },
      specialInstructions: "Isla Erasable arrives at four", accessNotes: "Side door for Isla Erasable's florist",
      phaseDeadlines: [{ phase: "dinner", reason: "Isla Erasable's speech at nine" }],
      accessibility: { notes: "Wheelchair space beside Isla Erasable's grandmother" } };
    const weddingLayout = await layout("Isla Erasable's wedding layout", weddingInstructions);
    const sheet = only(await f.db.insert(schema.configurationSheetSnapshots).values({ configurationId: weddingLayout, version: 1,
      payload: { config: { name: "Isla Erasable's wedding layout" }, instructions: weddingInstructions }, sourceHash: "7".repeat(64),
      pdfUrl: "https://example.test/legacy-sheet.pdf" }).returning({ id: schema.configurationSheetSnapshots.id }), "sheet").id;
    const offered = await proposal({ opportunityId: dealId, title: "Isla Erasable's wedding", acceptedName: "Isla Erasable", layoutId: weddingLayout });
    await f.pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 1, $2::jsonb, $3)",
      [offered, JSON.stringify({ title: "Isla Erasable's wedding", clientMessage: "Dear Isla Erasable, here is your proposal.",
        capacityNote: "Room for Isla Erasable's 80 guests" }), "d".repeat(64)]);
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
    // The team's conversation about her hold, and a request on it.
    const thread = only(await f.db.insert(schema.threads).values({ venueId: f.venueId, audience: "staff-private", subject: "booking",
      bookingId: hold.id, title: "Isla Erasable called" }).returning({ id: schema.threads.id }), "thread").id;
    const message = only(await f.db.insert(schema.messages).values({ threadId: thread, venueId: f.venueId, kind: "text",
      authorUserId: f.users.staff, idempotencyKey: randomUUID(), authorName: "TEST ONLY staff", authorRole: "staff",
      body: "Isla Erasable called about the menu" }).returning({ id: schema.messages.id }), "message").id;
    const herMessage = only(await f.db.insert(schema.messages).values({ threadId: thread, venueId: f.venueId, kind: "text",
      authorUserId: f.users.staff, idempotencyKey: randomUUID(), authorName: "ISLA ERASABLE", authorRole: "staff",
      body: "TEST ONLY passed on by phone" }).returning({ id: schema.messages.id }), "her message").id;
    const asking = only(await f.db.insert(schema.requests).values({ venueId: f.venueId, bookingId: hold.id, roomId: spaceId, kind: "other",
      urgency: "routine", requestedByName: "TEST ONLY staff", requestedByRole: "staff", audienceRoles: ["staff"], idempotencyKey: randomUUID(),
      detail: "Isla Erasable wants a later start" }).returning({ id: schema.requests.id }), "request").id;
    // On the day: an issue logged on her event, and a staff change the
    // hallkeeper acknowledged with a note.
    const issue = only(await f.db.insert(schema.eventDayIssues).values({ eventId, title: "Isla Erasable's mother fell at the door",
      detail: "TEST ONLY Isla Erasable called the hallkeeper" }).returning({ id: schema.eventDayIssues.id }), "issue").id;
    const staffChange = only(await f.db.insert(schema.eventPlanChanges).values({ eventId, venueId: f.venueId, proposalId: offered,
      actorRole: "staff", actorLabel: "TEST ONLY staff", sourceKind: "proposal", sourceId: offered, title: "TEST ONLY moved for Isla Erasable",
      summary: "TEST ONLY", affectedSurfaces: ["proposal"], audienceRoles: ["hallkeeper"] }).returning({ id: schema.eventPlanChanges.id }), "change").id;
    const acknowledged = only(await f.db.insert(schema.eventPlanChangeAcknowledgements).values({ changeId: staffChange, eventId,
      acknowledgedBy: f.users.staff, acknowledgedByRole: "hallkeeper", note: "TEST ONLY Isla Erasable saw it" })
      .returning({ id: schema.eventPlanChangeAcknowledgements.id }), "acknowledgement").id;
    // The handoff pack compiled for her event from the sheet, and its BEO.
    const pack = only(await f.db.insert(schema.handoffPacks).values({ eventId, configId: weddingLayout, snapshotId: sheet, snapshotHash: "7".repeat(64),
      sourceLabel: "TEST ONLY Isla Erasable's sheet", summary: "Pack for Isla Erasable" }).returning({ id: schema.handoffPacks.id }), "pack").id;
    const beo = only(await f.db.insert(schema.beoDocuments).values({ handoffPackId: pack, title: "BEO — Isla Erasable",
      body: "Event: Wedding — Isla Erasable", sourceSnapshotHash: "7".repeat(64) }).returning({ id: schema.beoDocuments.id }), "beo").id;
    // The rest the day keeps about her: the request's resolve note, a task
    // on her pack with its tick and its status line, the pack's diff, the
    // issue's escalation, a pack compiled from her layout with no event, a
    // variant of her event, a piece's note and label on the layout and its
    // saved revision, and her name in capitals as the event's client.
    await f.pool.query(`INSERT INTO request_status_history (request_id, to_state, actor_name, actor_role, note)
      VALUES ($1, 'resolved', 'TEST ONLY staff', 'staff', 'Isla Erasable agreed')`, [asking]);
    const task = only((await f.pool.query<{ id: string }>(`INSERT INTO ops_tasks (handoff_pack_id, kind, title, detail)
      VALUES ($1, 'setup', 'Chairs for Isla Erasable', 'Isla Erasable wants the aisle wide') RETURNING id`, [pack])).rows, "task").id;
    await f.pool.query(`INSERT INTO task_completion_events (ops_task_id, event_id, from_status, to_status, note)
      VALUES ($1, $2, 'todo', 'done', 'TEST ONLY done for Isla Erasable')`, [task, eventId]);
    await f.pool.query("INSERT INTO ops_status_updates (event_id, message) VALUES ($1, 'Task \"Chairs for Isla Erasable\" moved from todo to done.')",
      [eventId]);
    await f.pool.query(`INSERT INTO snapshot_diffs (handoff_pack_id, current_snapshot_hash, summary, payload)
      VALUES ($1, $2, 'Isla Erasable added a table', '{}'::jsonb)`, [pack, "7".repeat(64)]);
    await f.pool.query("UPDATE event_day_issues SET escalation_note = 'Isla Erasable''s brother was told' WHERE id = $1", [issue]);
    const layoutPack = only(await f.db.insert(schema.handoffPacks).values({ configId: weddingLayout, snapshotId: sheet, version: 2,
      snapshotHash: "7".repeat(64), sourceLabel: "TEST ONLY layout only", summary: "Draft pack for Isla Erasable" })
      .returning({ id: schema.handoffPacks.id }), "layout pack").id;
    const variant = only((await f.pool.query<{ id: string }>(
      "INSERT INTO layout_variants (event_id, name, notes) VALUES ($1, 'Isla Erasable final seating', 'Isla Erasable sits nearest the door') RETURNING id",
      [eventId])).rows, "variant").id;
    const piece = only((await f.pool.query<{ id: string }>(`INSERT INTO placed_objects (configuration_id, asset_definition_id, position_x,
      position_y, position_z, coordinate_write_token, metadata)
      VALUES ($1, (SELECT id FROM asset_definitions ORDER BY id LIMIT 1), 1, 0, 1, $2, $3::jsonb) RETURNING id`,
      [weddingLayout, randomUUID(), JSON.stringify({ notes: "Isla Erasable's grandparents", displayLabel: "Table for Isla Erasable" })])).rows,
      "piece").id;
    const revision = only((await f.pool.query<{ id: string }>(`INSERT INTO configuration_layout_revisions (configuration_id, revision, source, payload)
      VALUES ($1, 1, 'authenticated_batch', $2::jsonb) RETURNING id`,
      [weddingLayout, JSON.stringify({ objects: [{ notes: "Isla Erasable's grandparents" }] })])).rows, "revision").id;
    await f.pool.query("UPDATE events SET client_name = 'ISLA  ERASABLE' WHERE id = $1", [eventId]);
    // A layout staff linked to her event only, its day-of contact on the
    // number she gave on the enquiry form, written another way.
    const eventPlan = await layout("TEST ONLY event plan", { dayOfContact: { name: "TEST ONLY Planner", role: "", phone: "07700 900555", email: "" },
      specialInstructions: "", accessNotes: "" });
    await laidOutFrom(eventId, eventPlan);
    await f.pool.query("UPDATE enquiries SET guest_phone = '+44 7700 900555' WHERE id = $1", [asked]);
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
    const acceptNote = await comment(acceptOffer, { kind: "approval_note", authorName: "Isla Erasable", body: "Client approved the proposal." });
    // An acceptance withdrawn since: no name on the proposal any more, only its copy in the feed.
    const withdrawn = await proposal({ title: "TEST ONLY a withdrawn proposal" });
    const withdrawnCopy = await changeCopy({ eventId: otherEvent, proposalId: withdrawn, sourceKind: "proposal_response", sourceId: withdrawn,
      label: "Isla Erasable" });
    const elsewhereOffer = await proposal({ venueId: f.otherVenueId, title: "TEST ONLY another venue's proposal" });
    const elsewhereWords = await comment(elsewhereOffer, { authorEmail: current, body: "TEST ONLY another venue's to erase" });

    const erased = await post(`/people/${person}/erase`, "admin");
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json<{ data: { counts: unknown } }>().data.counts).toEqual({
      people: 1, contactPoints: 2, mergeSnapshots: 0, households: 1,
      enquiries: 1, guestLeads: 1, emailReceipts: 0, comments: 2, changeCopies: 2, notices: 2, proposals: 2, reworded: 43,
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
      .toEqual({ payload: { title: "Erased's wedding", clientMessage: "Dear Erased, here is your proposal.",
        capacityNote: "Room for Erased's 80 guests" }, rehashed: true });
    // Her layouts and the sheet frozen from one: the day-of contact who is her
    // (by name, or by her number written another way) is cleared, her name
    // leaves the notes; the sheet keeps its source hash.
    const clearedInstructions = { dayOfContact: null, specialInstructions: "Erased arrives at four", accessNotes: "Side door for Erased's florist",
      phaseDeadlines: [{ phase: "dinner", reason: "Erased's speech at nine" }], accessibility: { notes: "Wheelchair space beside Erased's grandmother" } };
    expect(await value("SELECT row_to_json(c) AS value FROM (SELECT name, metadata->'instructions' AS instructions FROM configurations WHERE id = $1) c",
      [weddingLayout])).toEqual({ name: "Erased's wedding layout", instructions: clearedInstructions });
    expect(await value("SELECT row_to_json(s) AS value FROM (SELECT payload->'config'->>'name' AS layout, payload->'instructions' AS instructions, source_hash, pdf_url FROM configuration_sheet_snapshots WHERE id = $1) s",
      [sheet])).toEqual({ layout: "Erased's wedding layout", instructions: clearedInstructions, source_hash: "7".repeat(64), pdf_url: null });
    expect(await value("SELECT metadata->'instructions'->'dayOfContact' AS value FROM configurations WHERE id = $1", [eventPlan])).toBeNull();
    expect(await value("SELECT metadata->'instructions'->'dayOfContact' AS value FROM configurations WHERE id = $1", [sketch])).toBeNull();
    // The team's conversation and request about her hold.
    expect(await value("SELECT title AS value FROM threads WHERE id = $1", [thread])).toBe("Erased called");
    expect(await value("SELECT body AS value FROM messages WHERE id = $1", [message])).toBe("Erased called about the menu");
    expect(await value("SELECT author_name AS value FROM messages WHERE id = $1", [herMessage])).toBe("Erased");
    expect(await value("SELECT detail AS value FROM requests WHERE id = $1", [asking])).toBe("Erased wants a later start");
    expect(await value("SELECT row_to_json(i) AS value FROM (SELECT title, detail FROM event_day_issues WHERE id = $1) i", [issue]))
      .toEqual({ title: "Erased's mother fell at the door", detail: "TEST ONLY Erased called the hallkeeper" });
    expect(await value("SELECT note AS value FROM event_plan_change_acknowledgements WHERE id = $1", [acknowledged])).toBe("TEST ONLY Erased saw it");
    expect(await value("SELECT row_to_json(h) AS value FROM (SELECT summary, source_label FROM handoff_packs WHERE id = $1) h", [pack]))
      .toEqual({ summary: "Pack for Erased", source_label: "TEST ONLY Erased's sheet" });
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT title, body FROM beo_documents WHERE id = $1) b", [beo]))
      .toEqual({ title: "BEO — Erased", body: "Event: Wedding — Erased" });
    expect(await value("SELECT note AS value FROM request_status_history WHERE request_id = $1", [asking])).toBe("Erased agreed");
    expect(await value("SELECT row_to_json(t) AS value FROM (SELECT title, detail FROM ops_tasks WHERE id = $1) t", [task]))
      .toEqual({ title: "Chairs for Erased", detail: "Erased wants the aisle wide" });
    expect(await value("SELECT note AS value FROM task_completion_events WHERE ops_task_id = $1", [task])).toBe("TEST ONLY done for Erased");
    expect(await value("SELECT message AS value FROM ops_status_updates WHERE event_id = $1", [eventId]))
      .toBe("Task \"Chairs for Erased\" moved from todo to done.");
    expect(await value("SELECT summary AS value FROM snapshot_diffs WHERE handoff_pack_id = $1", [pack])).toBe("Erased added a table");
    expect(await value("SELECT escalation_note AS value FROM event_day_issues WHERE id = $1", [issue])).toBe("Erased's brother was told");
    expect(await value("SELECT summary AS value FROM handoff_packs WHERE id = $1", [layoutPack])).toBe("Draft pack for Erased");
    expect(await value("SELECT row_to_json(v) AS value FROM (SELECT name, notes FROM layout_variants WHERE id = $1) v", [variant]))
      .toEqual({ name: "Erased final seating", notes: "Erased sits nearest the door" });
    expect(await value("SELECT metadata AS value FROM placed_objects WHERE id = $1", [piece]))
      .toEqual({ notes: "Erased's grandparents", displayLabel: "Table for Erased" });
    expect(await value("SELECT payload AS value FROM configuration_layout_revisions WHERE id = $1", [revision]))
      .toEqual({ objects: [{ notes: "Erased's grandparents" }] });
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
    expect(await value("SELECT author_name AS value FROM proposal_comments WHERE id = $1", [acceptNote])).toBe("Erased");
    expect(await value("SELECT actor_label AS value FROM event_plan_changes WHERE id = $1", [withdrawnCopy.change])).toBe("Erased");
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
    expect(await count("event_plan_changes WHERE event_id = $1 AND actor_role = 'client'", [eventId])).toBe(0);
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
    // Kept for a booking, with spare enquiries that became deals they lead: the
    // one without a deposit goes with their words on its proposal; the one
    // whose proposal asked for a deposit is kept with it.
    const keptDealer = await personWithEnquiry("KeptDealer", lapsedAt);
    await agedBookings(await bookedEvent({ enquiryId: keptDealer.asked }), lapsedAt);
    const dealtSpare = await enquiry({ email: keptDealer.email, contactId: keptDealer.person });
    await aged("enquiries", dealtSpare, lapsedAt);
    const dealtOffer = await proposal({ enquiryId: dealtSpare, madeAt: lapsedAt,
      opportunityId: await deal({ primaryContactId: keptDealer.person, sourceEnquiryId: dealtSpare, at: lapsedAt }) });
    const dealerWords = await comment(dealtOffer, { authorEmail: keptDealer.email, body: "TEST ONLY our menu", createdAt: lapsedAt });
    const depositSpare = await enquiry({ email: keptDealer.email, contactId: keptDealer.person });
    await aged("enquiries", depositSpare, lapsedAt);
    const depositOffer = await proposal({ enquiryId: depositSpare, madeAt: lapsedAt,
      opportunityId: await deal({ primaryContactId: keptDealer.person, sourceEnquiryId: depositSpare, at: lapsedAt }) });
    await f.db.insert(schema.proposalDepositRequests).values({ venueId: f.venueId, proposalId: depositOffer, proposalVersion: 1,
      proposalVersionHash: "a".repeat(64), basis: "amount", quoteTotalMinor: 100_000, amountMinor: 25_000, currency: "GBP" });
    // Kept only by an ink on the event staff made from their proposal's
    // layout: nothing left to remove, so listed and never looked at.
    const layoutKept = await personWithEnquiry("LayoutKept", lapsedAt);
    const keptLayout = await layout("TEST ONLY kept layout");
    await proposal({ enquiryId: layoutKept.asked, layoutId: keptLayout, madeAt: lapsedAt });
    const layoutEvent = await bookedEvent({ title: "TEST ONLY staff's event" });
    await laidOutFrom(layoutEvent, keptLayout);
    await agedBookings(layoutEvent, lapsedAt);
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
    // A lone enquiry whose deal a live person now leads and works: in touch through it.
    const leader = await f.addPerson({ name: "Lone Leader", emails: [`lone.leader-${randomUUID().slice(0, 8)}@example.test`] });
    peopleIds.push(leader);
    const loneLed = await enquiry({ email: `lone-led-${randomUUID().slice(0, 8)}@example.test` });
    await aged("enquiries", loneLed, lapsedAt);
    await deal({ primaryContactId: leader, sourceEnquiryId: loneLed, at: freshAt });
    // A lone enquiry whose address only a deleted record holds: nobody live holds it, so it goes.
    const deletedHolderEmail = `lone-deleted-${randomUUID().slice(0, 8)}@example.test`;
    leadEmails.push(deletedHolderEmail);
    const deletedHolder = await f.addPerson({ name: "TEST ONLY Deleted Holder", emails: [deletedHolderEmail] });
    peopleIds.push(deletedHolder);
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deletedHolder]);
    const loneOfDeleted = await enquiry({ email: deletedHolderEmail });
    await aged("enquiries", loneOfDeleted, lapsedAt);
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
    expect(capped.kept).toContainEqual({ venueId: f.venueId, personId: layoutKept.person });
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
    const goes = [lapsed.asked, lapsedUnlinked, lone, bookedSpare, bookedUnlinked, keptUnlinkedSpare, pairEnquiry, dealtSpare, loneOfDeleted];
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [goes])).toBe(goes.length);
    expect(await count("guest_leads WHERE email = $1", [loneEmail])).toBe(1);
    expect(await count("email_sends WHERE idempotency_key = $1", [loneReceipt])).toBe(1);
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(0);

    // The night does exactly what the rehearsal said.
    // The switch (Blake, 18 Nov 2026): with no first day named, the default,
    // or one still ahead, a real run reads nothing and changes nothing.
    const named = process.env[PEOPLE_RETENTION_START_VARIABLE];
    Reflect.deleteProperty(process.env, PEOPLE_RETENTION_START_VARIABLE);
    try {
      expect(await eraseLapsedPeople(f.db, { now }))
        .toMatchObject({ off: true, people: 0, enquiries: 0, keptForBooking: 0, deferred: { people: 0, enquiries: 0 } });
    } finally {
      if (named !== undefined) process.env[PEOPLE_RETENTION_START_VARIABLE] = named;
    }
    expect(await eraseLapsedPeople(f.db, { now, startsOn: new Date("2028-03-02T00:00:00Z") })).toMatchObject({ off: true, people: 0 });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [lapsed.person])).toBe(1);
    // From its first day (the run's own day here), it erases.
    const pass = await eraseLapsedPeople(f.db, { now, startsOn: new Date("2028-03-01T00:00:00Z") });
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
    expect(await count("proposal_comments WHERE id = ANY($1::uuid[])", [[spareWords, dealerWords]])).toBe(0);
    expect(await count("guest_leads WHERE email = $1", [secondEmail])).toBe(1);
    // Inside the 24 months, in touch by any sign, or kept for a booking:
    // nothing of theirs goes beyond what never became a booking.
    const stay = [boundary, working, proposed, newLinked, newUnlinked, answered, rebooked, dealt, chained, booked, keptUnlinked, keptDealer, layoutKept,
      longKept, recent];
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL",
      [[...stay.map((row) => row.person), tombstone, chainedOld]])).toBe(stay.length + 2);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])",
      [[...stay.map((row) => row.asked), loneRecent, loneBooked, loneWorked, loneDealBooked, loneLed, depositSpare]])).toBe(stay.length + 6);

    // A second night finds nothing more of theirs: still one audit row. The
    // kept people, with nothing left to remove, are listed and not looked at.
    const again = await eraseLapsedPeople(f.db, { now, startsOn: new Date("2028-03-01T00:00:00Z"), limits: { examined: 0 } });
    expect(again.failed).toBe(0);
    expect(again.kept).toEqual(expect.arrayContaining([
      { venueId: f.venueId, personId: booked.person },
      { venueId: f.venueId, personId: keptUnlinked.person },
    ]));
    expect(await count("general_audit_log WHERE target_id = $1", [lapsed.person])).toBe(1);
  });
});

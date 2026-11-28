import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { enquiryRoutes, writeEnquiryEdit } from "../routes/enquiries.js";
import { ErasureMovedOn, eraseLockedPerson, findPersonRecords, type ErasureOutcome } from "../services/people-erasure.js";
import { lockPerson } from "../services/people-records.js";
import { eraseLapsedPeople } from "../services/people-retention.js";
import { link, openSpineDatabase, platformTarget, venue as venueIn, type SpineDatabase, type SpineVenue } from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// Erasing a person, and the 24-month pass, follow the spine's links
// (enquiries.event_id, opportunities.event_id, proposals.event_id).
//
// The join of old records (spine_join_old_records) makes events and names
// them, and their client, from the enquiry, the deal or the proposal it makes
// them for; it sets none of the paths erasure read before the links (the
// event's deal or client account, a floor-plan link, a booking). An event a
// person's enquiry, deal or proposal points at is theirs when no other live
// person's record points at it too; when one does, it is that person's, near
// the erased one: kept, and only the erased person's names leave its text, as
// for the deal another live person leads. Either way the name the join copied
// leaves it, and a later run of the join cannot bring it back.
//
// The join must never run on the shared platform database (it would join every
// other suite's rows), so this suite makes a database of its own through
// openSpineDatabase, migrates it with the real migrator, and drops it. Each
// case has a venue of its own. The undo runs last: it puts back every join in
// the database, every case's.
// ---------------------------------------------------------------------------

const target = platformTarget();

interface JoinResult {
  readonly joined: number;
  readonly events_made: number;
  readonly listed: number;
}

/** A settled erasure: what it answered, or what it threw. */
type Settled = { readonly ok: true; readonly outcome: ErasureOutcome } | { readonly ok: false; readonly error: unknown };

describe.skipIf(target === undefined)("erasure and the 24-month pass follow the spine's links", { timeout: 60_000 }, () => {
  let spine: SpineDatabase | undefined;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance | undefined;

  beforeAll(async () => {
    spine = await openSpineDatabase("people_erasure_links");
    pool = spine.pool;
    db = spine.db;
    server = Fastify();
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.ready();
  }, 180_000);
  afterAll(async () => {
    await server?.close();
    await spine?.close();
  });

  /** PATCH /enquiries/:id as a platform admin of the venue, who may edit an enquiry in any state. */
  async function edit(v: SpineVenue, enquiryId: string, body: Record<string, unknown>): Promise<LightMyRequestResponse> {
    if (server === undefined) throw new Error("No server");
    return server.inject({ method: "PATCH", url: `/enquiries/${enquiryId}`, payload: body,
      headers: { authorization: `Bearer ${JSON.stringify({ ...v.admin, platformRole: "admin", email: `${v.admin.id}@people-links.invalid` })}` } });
  }

  async function id(text: string, values: readonly unknown[]): Promise<string> {
    const [row] = (await pool.query<{ id: string }>(text, [...values])).rows;
    if (row === undefined) throw new Error("The fixture wrote no row");
    return row.id;
  }

  async function value(text: string, values: readonly unknown[]): Promise<unknown> {
    const [row] = (await pool.query<{ value: unknown }>(text, [...values])).rows;
    return row?.value;
  }

  /** A person of the venue, written at the moment given (now by default). */
  async function person(v: SpineVenue, name: string, at: Date | null = null): Promise<string> {
    return id(`INSERT INTO contacts (venue_id, name, created_at, updated_at)
      VALUES ($1, $2, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now())) RETURNING id`, [v.venueId, name, at]);
  }

  interface EnquiryInput {
    readonly name: string;
    readonly contactId?: string | null;
    /** A first reply recorded: a worked enquiry. */
    readonly replied?: boolean;
    readonly eventType?: string;
    readonly at?: Date;
  }

  /** An open enquiry (under review) for the venue's hall, from an address of its own. */
  async function enquiry(v: SpineVenue, input: EnquiryInput): Promise<string> {
    const enquiryId = randomUUID();
    return id(`INSERT INTO enquiries (id, venue_id, space_id, contact_id, state, name, email, event_type, created_at, updated_at,
        first_response_at, first_response_channel, first_response_recorded_at)
      VALUES ($1, $2, $3, $4, 'under_review', $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($8::timestamptz, now()),
        CASE WHEN $9 THEN coalesce($8::timestamptz, now()) END, CASE WHEN $9 THEN 'email' END,
        CASE WHEN $9 THEN coalesce($8::timestamptz, now()) END)
      RETURNING id`, [enquiryId, v.venueId, v.rooms.hall, input.contactId ?? null, input.name, `${enquiryId}@people-links.invalid`,
      input.eventType ?? "wedding", input.at ?? null, input.replied ?? false]);
  }

  interface DealInput {
    readonly title: string;
    readonly leadId?: string | null;
    readonly enquiryId?: string | null;
    /** Open (new) unless said. */
    readonly stage?: "new" | "lost";
    readonly at?: Date;
  }

  /** A deal, open (stage new) unless a stage is given. */
  async function deal(v: SpineVenue, input: DealInput): Promise<string> {
    return id(`INSERT INTO opportunities (venue_id, title, stage, primary_contact_id, source_enquiry_id, created_at, updated_at)
      VALUES ($1, $2, $6::text, $3, $4, coalesce($5::timestamptz, now()), coalesce($5::timestamptz, now())) RETURNING id`,
    [v.venueId, input.title, input.leadId ?? null, input.enquiryId ?? null, input.at ?? null, input.stage ?? "new"]);
  }

  interface ProposalInput {
    readonly title: string;
    readonly status: "draft" | "sent";
    readonly dealId?: string | null;
    readonly enquiryId?: string | null;
    readonly at?: Date;
  }

  /** A proposal; a sent one carries the moment it was sent. */
  async function proposal(v: SpineVenue, input: ProposalInput): Promise<string> {
    return id(`INSERT INTO proposals (venue_id, title, status, sent_at, opportunity_id, enquiry_id, created_at, updated_at)
      VALUES ($1, $2, $3::text, CASE WHEN $3::text = 'sent' THEN coalesce($6::timestamptz, now()) END, $4, $5,
        coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now())) RETURNING id`,
    [v.venueId, input.title, input.status, input.dealId ?? null, input.enquiryId ?? null, input.at ?? null]);
  }

  /** An event with no dates, as a draft, named as given. */
  async function event(v: SpineVenue, name: string, clientName: string | null): Promise<string> {
    return id("INSERT INTO events (venue_id, name, client_name, status) VALUES ($1, $2, $3, 'draft') RETURNING id",
      [v.venueId, name, clientName]);
  }

  interface BookingInput {
    readonly eventId: string | null;
    readonly enquiryId?: string | null;
    readonly kind: "hold" | "ink" | "viewing";
    readonly status?: "active" | "released";
    readonly at?: Date;
  }

  /** A booking in the hall, each on a day of its own a year ahead. */
  let day = 0;
  async function booking(v: SpineVenue, input: BookingInput): Promise<string> {
    day += 1;
    return id(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Held date', now() + make_interval(days => 400 + $7::int),
        now() + make_interval(days => 400 + $7::int, hours => 4), coalesce($8::timestamptz, now()), coalesce($8::timestamptz, now()))
      RETURNING id`,
    [v.venueId, v.rooms.hall, input.eventId, input.enquiryId ?? null, input.kind, input.status ?? "active", day, input.at ?? null]);
  }

  async function join(): Promise<JoinResult> {
    const [row] = (await pool.query<JoinResult>("SELECT * FROM spine_join_old_records()")).rows;
    if (row === undefined) throw new Error("The join returned no row");
    return row;
  }

  /** The join's record in force for a record: the event, whether it made it, and the path. */
  async function joinOf(kind: "enquiry" | "opportunity" | "proposal", subjectId: string): Promise<unknown> {
    return value(`SELECT row_to_json(j) AS value FROM (SELECT event_id, event_made, path FROM event_link_joins
      WHERE subject_kind = $1 AND subject_id = $2 AND undone_at IS NULL) j`, [kind, subjectId]);
  }

  async function eventOf(table: "enquiries" | "opportunities" | "proposals", recordId: string): Promise<string> {
    const eventId = await value(`SELECT event_id AS value FROM ${table} WHERE id = $1`, [recordId]);
    if (typeof eventId !== "string") throw new Error(`No event on ${table} ${recordId}`);
    return eventId;
  }

  async function names(eventId: string): Promise<unknown> {
    return value("SELECT row_to_json(e) AS value FROM (SELECT name, client_name FROM events WHERE id = $1) e", [eventId]);
  }

  /** How many of the venue's events hold the text in their name or their client's. */
  async function namedAnywhere(v: SpineVenue, text: string): Promise<unknown> {
    return value(`SELECT count(*)::int AS value FROM events
      WHERE venue_id = $1 AND (strpos(name, $2) > 0 OR strpos(coalesce(client_name, ''), $2) > 0)`, [v.venueId, text]);
  }

  async function count(text: string, values: readonly unknown[]): Promise<unknown> {
    return value(`SELECT count(*)::int AS value FROM ${text}`, values);
  }

  /** The erase route's own transaction: the person locked, then erased. */
  async function erase(v: SpineVenue, personId: string): Promise<ErasureOutcome> {
    return db.transaction(async (tx) => {
      const lock = await lockPerson(tx, v.venueId, personId);
      if (lock.state !== "live") throw new Error("The person is not live");
      return eraseLockedPerson(tx, lock.row, { actorUserId: v.admin.id, now: new Date() });
    });
  }

  /** Which events erasure counts as the person's own and which as only near them. */
  async function classified(v: SpineVenue, personId: string): Promise<{ readonly own: readonly string[]; readonly near: readonly string[] }> {
    return db.transaction(async (tx) => {
      const lock = await lockPerson(tx, v.venueId, personId);
      if (lock.state !== "live") throw new Error("The person is not live");
      const records = await findPersonRecords(tx, lock.row);
      return { own: records.eventIds, near: records.nearby.eventIds };
    });
  }

  /** Waits until `waiters` statements like the pattern wait on a lock in this database. */
  async function waitForLockWait(pattern: string, waiters = 1): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const waiting = await value(`SELECT count(*)::int AS value FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`, [pattern]);
      if (typeof waiting === "number" && waiting >= waiters) return;
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    throw new Error(`Fewer than ${String(waiters)} statements waited on a lock like ${pattern}`);
  }

  /**
   * A run of the join stopped part-way, with its loop's rows already read: a
   * second connection holds the held venue's row FOR UPDATE, so the join waits
   * on that row's key share when it first writes a row naming that venue (the
   * oldest record it reads). `meanwhile` runs then; the venue is let go and
   * the run finishes and commits.
   */
  async function joinWhileVenueHeld(held: SpineVenue, meanwhile: () => Promise<void>): Promise<JoinResult> {
    const holder = await pool.connect();
    let holding = false;
    try {
      await holder.query("BEGIN");
      holding = true;
      await holder.query("SELECT 1 FROM venues WHERE id = $1 FOR UPDATE", [held.venueId]);
      const joining = pool.query<JoinResult>("SELECT * FROM spine_join_old_records()")
        .then((result): JoinResult | Error => result.rows[0] ?? new Error("The join returned no row"),
          (error: unknown): Error => (error instanceof Error ? error : new Error("The join failed")));
      let failure: Error | null = null;
      try {
        await waitForLockWait("%spine_join_old_records%");
        await meanwhile();
      } catch (error: unknown) {
        failure = error instanceof Error ? error : new Error("The step while the join waited failed");
      }
      await holder.query("COMMIT");
      holding = false;
      const ran = await joining;
      if (failure !== null) throw failure;
      if (ran instanceof Error) throw ran;
      return ran;
    } finally {
      if (holding) await holder.query("ROLLBACK");
      holder.release();
    }
  }

  /** Every row of the join's two record tables whose text, any column, holds the given text. */
  async function recordRowsHolding(text: string): Promise<unknown> {
    return value(`SELECT (SELECT count(*)::int FROM event_link_joins j WHERE strpos(row_to_json(j)::text, $1) > 0)
      + (SELECT count(*)::int FROM event_link_reviews r WHERE strpos(row_to_json(r)::text, $1) > 0) AS value`, [text]);
  }

  it("the reviewer's scenario: an event the join made for a worked enquiry loses the person's name with them", async () => {
    const v = await venueIn(pool, "erasure, a made event");
    const isla = await person(v, "Isla Linkwell");
    const replied = await enquiry(v, { contactId: isla, name: "Isla Linkwell", replied: true });
    // Worked by a viewing alone, which has no event.
    const morven = await person(v, "Morven Viewing");
    const viewed = await enquiry(v, { contactId: morven, name: "Morven Viewing" });
    await booking(v, { eventId: null, enquiryId: viewed, kind: "viewing" });

    await join();
    const islaEvent = await eventOf("enquiries", replied);
    const morvenEvent = await eventOf("enquiries", viewed);
    expect(await joinOf("enquiry", replied)).toEqual({ event_id: islaEvent, event_made: true, path: "new_event" });
    expect(await joinOf("enquiry", viewed)).toEqual({ event_id: morvenEvent, event_made: true, path: "new_event" });
    expect(await names(islaEvent)).toEqual({ name: "Isla Linkwell", client_name: "Isla Linkwell" });
    expect(await names(morvenEvent)).toEqual({ name: "Morven Viewing", client_name: "Morven Viewing" });

    const erasedIsla = await erase(v, isla);
    expect(erasedIsla).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await erase(v, morven)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    // Both events are kept (no product code removes an event), without the names.
    expect(await names(islaEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await names(morvenEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Isla Linkwell")).toBe(0);
    expect(await namedAnywhere(v, "Morven Viewing")).toBe(0);

    // The nightly join runs again cleanly and brings neither name back.
    await join();
    expect(await namedAnywhere(v, "Isla Linkwell")).toBe(0);
    expect(await namedAnywhere(v, "Morven Viewing")).toBe(0);
    expect(await count("events WHERE venue_id = $1", [v.venueId])).toBe(2);
  });

  it("an event made for a deal and one made for a proposal lose the name from client_name; the deal and proposal stay, linked", async () => {
    const v = await venueIn(pool, "erasure, deal and proposal events");
    const ailsa = await person(v, "Ailsa Dealwright");
    // Enquiries that ask to book nothing never get an event of their own, so
    // the join names each event by the deal or the proposal, and its client by
    // the enquiry (steps 2 and 3).
    const asked = await enquiry(v, { contactId: ailsa, name: "Ailsa Dealwright", eventType: "venue-enquiry", replied: true });
    const dealId = await deal(v, { title: "Dinner for Ailsa Dealwright", leadId: ailsa, enquiryId: asked });
    const askedAgain = await enquiry(v, { contactId: ailsa, name: "Ailsa Dealwright", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "Ceilidh for Ailsa Dealwright", status: "sent", enquiryId: askedAgain });

    await join();
    const dealEvent = await eventOf("opportunities", dealId);
    const proposalEvent = await eventOf("proposals", proposalId);
    expect(await joinOf("opportunity", dealId)).toEqual({ event_id: dealEvent, event_made: true, path: "new_event" });
    expect(await joinOf("proposal", proposalId)).toEqual({ event_id: proposalEvent, event_made: true, path: "new_event" });
    expect(await names(dealEvent)).toEqual({ name: "Dinner for Ailsa Dealwright", client_name: "Ailsa Dealwright" });
    expect(await names(proposalEvent)).toEqual({ name: "Ceilidh for Ailsa Dealwright", client_name: "Ailsa Dealwright" });

    expect(await erase(v, ailsa)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 2 } });
    expect(await names(dealEvent)).toEqual({ name: "Dinner for Erased", client_name: "Erased" });
    expect(await names(proposalEvent)).toEqual({ name: "Ceilidh for Erased", client_name: "Erased" });
    // The deal and the proposal are kept as erasure keeps them, without the
    // name; their links stay (a link is moved, never emptied), the deal open
    // on its event.
    expect(await value(`SELECT row_to_json(d) AS value FROM (SELECT title, stage, event_id, primary_contact_id, source_enquiry_id
      FROM opportunities WHERE id = $1) d`, [dealId]))
      .toEqual({ title: "Dinner for Erased", stage: "new", event_id: dealEvent, primary_contact_id: ailsa, source_enquiry_id: null });
    expect(await value(`SELECT row_to_json(p) AS value FROM (SELECT title, status, event_id, enquiry_id FROM proposals WHERE id = $1) p`,
      [proposalId])).toEqual({ title: "Ceilidh for Erased", status: "sent", event_id: proposalEvent, enquiry_id: null });
    expect(await namedAnywhere(v, "Ailsa Dealwright")).toBe(0);

    await join();
    expect(await namedAnywhere(v, "Ailsa Dealwright")).toBe(0);
    expect([await eventOf("opportunities", dealId), await eventOf("proposals", proposalId)]).toEqual([dealEvent, proposalEvent]);
  });

  it("an event tied to the person only by a link, with no record of the join, is found and treated the same", async () => {
    // The next pull request's writers link a record as it is made: no row in
    // event_link_joins says so.
    const v = await venueIn(pool, "erasure, links alone");
    const jonas = await person(v, "Jonas Linkonly");
    const asked = await enquiry(v, { contactId: jonas, name: "Jonas Linkonly" });
    const enquiryEvent = await event(v, "Jonas Linkonly", "Jonas Linkonly");
    await link(pool, "enquiries", asked, enquiryEvent);
    const dealId = await deal(v, { title: "Lunch", leadId: jonas });
    const dealEvent = await event(v, "Lunch — Jonas Linkonly", "Jonas Linkonly");
    await link(pool, "opportunities", dealId, dealEvent);
    const forTea = await enquiry(v, { contactId: jonas, name: "Jonas Linkonly", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "Tea", status: "draft", enquiryId: forTea });
    const proposalEvent = await event(v, "Tea — Jonas Linkonly", "Jonas Linkonly");
    await link(pool, "proposals", proposalId, proposalEvent);
    expect(await count("event_link_joins WHERE subject_id = ANY($1::uuid[])", [[asked, dealId, proposalId]])).toBe(0);

    expect(await classified(v, jonas)).toEqual({ own: expect.arrayContaining([enquiryEvent, dealEvent, proposalEvent]), near: [] });
    expect(await erase(v, jonas)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 2 } });
    expect(await names(enquiryEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await names(dealEvent)).toEqual({ name: "Lunch — Erased", client_name: "Erased" });
    expect(await names(proposalEvent)).toEqual({ name: "Tea — Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Jonas Linkonly")).toBe(0);
  });

  it("a made event another live person's record is also tied to is kept and counted near: the second person's live hold does not hold the erasure back", async () => {
    const v = await venueIn(pool, "erasure, a made event shared");
    // The join makes an event for each of two people's enquiries.
    const ailsa = await person(v, "Ailsa Madeforher");
    const hers = await enquiry(v, { contactId: ailsa, name: "Ailsa Madeforher", replied: true });
    const catriona = await person(v, "Catriona Madeforher");
    const catrionas = await enquiry(v, { contactId: catriona, name: "Catriona Madeforher", replied: true });
    await join();
    const ailsaEvent = await eventOf("enquiries", hers);
    const catrionaEvent = await eventOf("enquiries", catrionas);
    expect(await joinOf("enquiry", hers)).toEqual({ event_id: ailsaEvent, event_made: true, path: "new_event" });
    expect(await joinOf("enquiry", catrionas)).toEqual({ event_id: catrionaEvent, event_made: true, path: "new_event" });

    // Then a second, live person is tied to each: Brodie's enquiry is linked to
    // Ailsa's event and his live hold sits in it; Duncan's enquiry is linked to
    // nothing, but his live hold sits in Catriona's event.
    const brodie = await person(v, "Brodie Linkedtoo");
    const his = await enquiry(v, { contactId: brodie, name: "Brodie Linkedtoo" });
    await link(pool, "enquiries", his, ailsaEvent);
    const brodieHold = await booking(v, { eventId: ailsaEvent, enquiryId: his, kind: "hold" });
    const duncan = await person(v, "Duncan Bookedin");
    const duncans = await enquiry(v, { contactId: duncan, name: "Duncan Bookedin" });
    const duncanHold = await booking(v, { eventId: catrionaEvent, enquiryId: duncans, kind: "hold" });

    expect(await classified(v, ailsa)).toEqual({ own: [], near: [ailsaEvent] });
    expect(await classified(v, catriona)).toEqual({ own: [], near: [catrionaEvent] });
    // Counted as theirs, the other person's live hold would refuse the erasure
    // (PERSON_HAS_BOOKING); near, it does not.
    expect(await erase(v, ailsa)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await erase(v, catriona)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });

    // Kept, with the other person's records as they were; the name the join
    // copied from the erased person's enquiry leaves both columns.
    expect(await names(ailsaEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await names(catrionaEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await eventOf("enquiries", his)).toBe(ailsaEvent);
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT event_id, enquiry_id, kind, status FROM bookings WHERE id = $1) b",
      [brodieHold])).toEqual({ event_id: ailsaEvent, enquiry_id: his, kind: "hold", status: "active" });
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT event_id, enquiry_id, kind, status FROM bookings WHERE id = $1) b",
      [duncanHold])).toEqual({ event_id: catrionaEvent, enquiry_id: duncans, kind: "hold", status: "active" });
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL", [[brodie, duncan]])).toBe(2);
    expect(await namedAnywhere(v, "Madeforher")).toBe(0);
  });

  it("an event their enquiry and another live person's deal both point at is near: only their name leaves it; alone, its confirmed booking keeps them", async () => {
    const v = await venueIn(pool, "erasure, a linked event shared");
    const morag = await person(v, "Morag Nearhand");
    const hamish = await person(v, "Hamish Leadwell");
    const shared = await event(v, "Ceilidh — Morag Nearhand", "Hamish Leadwell");
    const hers = await enquiry(v, { contactId: morag, name: "Morag Nearhand" });
    await link(pool, "enquiries", hers, shared);
    const hisDeal = await deal(v, { title: "Ceilidh for Hamish Leadwell", leadId: hamish });
    await link(pool, "opportunities", hisDeal, shared);
    const inked = await booking(v, { eventId: shared, kind: "ink" });

    expect(await classified(v, morag)).toEqual({ own: [], near: [shared] });
    expect(await erase(v, morag)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await names(shared)).toEqual({ name: "Ceilidh — Erased", client_name: "Hamish Leadwell" });
    expect(await value("SELECT row_to_json(d) AS value FROM (SELECT title, event_id FROM opportunities WHERE id = $1) d", [hisDeal]))
      .toEqual({ title: "Ceilidh for Hamish Leadwell", event_id: shared });
    expect(await count("bookings WHERE id = $1 AND kind = 'ink' AND status = 'active' AND deleted_at IS NULL", [inked])).toBe(1);

    // The same event with nobody else's record on it is hers: its confirmed
    // booking keeps her, and nothing changes.
    const fenella = await person(v, "Fenella Alone");
    const alone = await event(v, "Supper — Fenella Alone", "Fenella Alone");
    const fenellas = await enquiry(v, { contactId: fenella, name: "Fenella Alone" });
    await link(pool, "enquiries", fenellas, alone);
    await booking(v, { eventId: alone, kind: "ink" });
    expect(await classified(v, fenella)).toEqual({ own: [alone], near: [] });
    expect(await erase(v, fenella)).toEqual({ ok: false, refusal: "has_booking" });
    expect(await names(alone)).toEqual({ name: "Supper — Fenella Alone", client_name: "Fenella Alone" });
    expect(await count("enquiries WHERE id = $1", [fenellas])).toBe(1);
  });

  it("the 24-month pass reads the links: contact through a linked event, a booking that keeps the person, and another person's event that does not", async () => {
    const v = await venueIn(pool, "retention, links");
    const now = new Date("2024-06-01T02:00:00Z");
    const old = new Date("2020-03-02T10:00:00Z");
    const recent = new Date("2023-03-02T10:00:00Z");

    // An enquiry linked to nobody, worked and left: the join makes its event.
    // (Run first, so it joins nothing of the people below, who are linked by hand.)
    const lone = await enquiry(v, { name: "Xander Lone", replied: true, at: old });
    await join();
    const loneEvent = await eventOf("enquiries", lone);
    expect(await names(loneEvent)).toEqual({ name: "Xander Lone", client_name: "Xander Lone" });

    // In touch through the event her enquiry is linked to: a hold released there last year.
    const rhona = await person(v, "Rhona Lapsed", old);
    const rhonas = await enquiry(v, { contactId: rhona, name: "Rhona Lapsed", replied: true, at: old });
    const rhonaEvent = await event(v, "Rhona Lapsed", "Rhona Lapsed");
    await link(pool, "enquiries", rhonas, rhonaEvent);
    await booking(v, { eventId: rhonaEvent, kind: "hold", status: "released", at: recent });
    // Kept by a confirmed booking on the event his deal is linked to; no enquiry.
    const sorley = await person(v, "Sorley Dealt", old);
    const sorleyDeal = await deal(v, { title: "Dinner — Sorley Dealt", leadId: sorley, at: old });
    const sorleyEvent = await event(v, "Sorley Dealt", "Sorley Dealt");
    await link(pool, "opportunities", sorleyDeal, sorleyEvent);
    await booking(v, { eventId: sorleyEvent, kind: "ink", at: old });
    // Kept by a confirmed booking on the event his deal's proposal is linked to.
    const tormod = await person(v, "Tormod Proposed", old);
    const tormodDeal = await deal(v, { title: "Dinner — Tormod Proposed", leadId: tormod, at: old });
    const tormodProposal = await proposal(v, { title: "Dinner for Tormod Proposed", status: "sent", dealId: tormodDeal, at: old });
    const tormodEvent = await event(v, "Tormod Proposed", "Tormod Proposed");
    await link(pool, "proposals", tormodProposal, tormodEvent);
    await booking(v, { eventId: tormodEvent, kind: "ink", at: old });
    // Her deal is linked to an event a live person's enquiry is linked to as
    // well: the confirmed booking there is not hers, so it does not keep her.
    const una = await person(v, "Una Nearby", old);
    const unaDeal = await deal(v, { title: "Dinner — Una Nearby", leadId: una, at: old });
    const unaEvent = await event(v, "Una Nearby's dinner", "Vhairi Elsewhere");
    await link(pool, "opportunities", unaDeal, unaEvent);
    const vhairi = await person(v, "Vhairi Elsewhere");
    const vhairis = await enquiry(v, { contactId: vhairi, name: "Vhairi Elsewhere" });
    await link(pool, "enquiries", vhairis, unaEvent);
    await booking(v, { eventId: unaEvent, kind: "ink", at: old });
    // Kept by a confirmed booking on the event her enquiry is linked to.
    const wilma = await person(v, "Wilma Asked", old);
    const wilmas = await enquiry(v, { contactId: wilma, name: "Wilma Asked", replied: true, at: old });
    const wilmaEvent = await event(v, "Wilma Asked", "Wilma Asked");
    await link(pool, "enquiries", wilmas, wilmaEvent);
    await booking(v, { eventId: wilmaEvent, kind: "ink", at: old });

    // What the pass reads from each person's own records, before any step:
    // Rhona is in touch; Sorley and Tormod are kept with nothing to remove;
    // Una and Wilma are due (Wilma's enquiry may be one to remove, which only
    // her step decides); the lone enquiry is due.
    const looked = await eraseLapsedPeople(db, { now, dryRun: true, limits: { examined: 0 } });
    expect({ ...looked, kept: [...looked.kept].sort((a, b) => a.personId.localeCompare(b.personId)) }).toEqual({
      dryRun: true, off: false, people: 0, keptForBooking: 2, inTouch: 0, enquiries: 0, failed: 0, failedStates: [],
      deferred: { people: 2, enquiries: 1 }, outOfTime: false,
      kept: [sorley, tormod].sort().map((personId) => ({ venueId: v.venueId, personId })),
    });

    const pass = await eraseLapsedPeople(db, { now, startsOn: new Date("2024-01-01T00:00:00Z") });
    expect({ ...pass, kept: [...pass.kept].sort((a, b) => a.personId.localeCompare(b.personId)) }).toEqual({
      dryRun: false, off: false, people: 1, keptForBooking: 3, inTouch: 0, enquiries: 1, failed: 0, failedStates: [],
      deferred: { people: 0, enquiries: 0 }, outOfTime: false,
      kept: [sorley, tormod, wilma].sort().map((personId) => ({ venueId: v.venueId, personId })),
    });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NOT NULL", [una])).toBe(1);
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL", [[rhona, sorley, tormod, wilma, vhairi]])).toBe(5);
    expect(await names(unaEvent)).toEqual({ name: "Erased's dinner", client_name: "Vhairi Elsewhere" });
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[rhonas, wilmas]])).toBe(2);
    expect(await count("enquiries WHERE id = $1", [lone])).toBe(0);
    expect(await names(loneEvent)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Xander Lone")).toBe(0);
  });

  it("a link written while the erasure waits for their enquiry answers RETRY, and the retry finds the event", async () => {
    // The nightly join holds an enquiry it links until its whole run commits;
    // an erasure that read the person's records before that commit must not
    // delete the enquiry and leave the event it was given behind.
    const v = await venueIn(pool, "erasure, a link written meanwhile");
    const isla = await person(v, "Isla Raceway");
    const asked = await enquiry(v, { contactId: isla, name: "Isla Raceway" });
    const given = await event(v, "Isla Raceway", "Isla Raceway");
    const writer = await pool.connect();
    let committed = false;
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE enquiries SET event_id = $2 WHERE id = $1", [asked, given]);
      const erasing: Promise<Settled> = erase(v, isla)
        .then((outcome): Settled => ({ ok: true, outcome }), (error: unknown): Settled => ({ ok: false, error }));
      try {
        await waitForLockWait(`%from "enquiries"%for update%`);
      } finally {
        await writer.query("COMMIT");
        committed = true;
      }
      const settled = await erasing;
      expect(settled.ok).toBe(false);
      if (!settled.ok) expect(settled.error).toBeInstanceOf(ErasureMovedOn);
    } finally {
      if (!committed) await writer.query("ROLLBACK");
      writer.release();
    }
    // Nothing changed; tried again, the erasure finds the event.
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [isla])).toBe(1);
    expect(await names(given)).toEqual({ name: "Isla Raceway", client_name: "Isla Raceway" });
    expect(await erase(v, isla)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await names(given)).toEqual({ name: "Erased", client_name: "Erased" });
  });

  // The join names an event it makes, and its client, from rows it read; an
  // erasure can run beside it. Every value it copies into an event it makes is
  // read from a row it holds locked at that moment: a row it writes is
  // re-checked under its lock to still hold the text read, and a row it only
  // reads a name from is taken FOR SHARE, which an erasure's or a writer's
  // change of that row conflicts with. These cases stop the join part-way.

  it("a deal's title an erasure rewords while the join's run is under way is not copied back onto an event the run makes", async () => {
    const held = await venueIn(pool, "stale text, a deal: the venue held");
    const v = await venueIn(pool, "stale text, a deal's title");
    // An older open deal the join reaches first: making its event waits on its
    // venue's row, with the deal loop's rows read.
    await deal(held, { title: "TEST ONLY older deal", at: new Date("2020-01-01T00:00:00Z") });
    const isla = await person(v, "Isla Stalewell");
    const dealId = await deal(v, { title: "Dinner for Isla Stalewell", leadId: isla });

    await joinWhileVenueHeld(held, async () => {
      expect(await erase(v, isla)).toMatchObject({ ok: true });
      expect(await value(`SELECT row_to_json(d) AS value FROM (SELECT title, event_id FROM opportunities WHERE id = $1) d`,
        [dealId])).toEqual({ title: "Dinner for Erased", event_id: null });
    });
    // Joined with the reworded title, or left for the next run: never the old one.
    expect(await namedAnywhere(v, "Isla Stalewell")).toBe(0);
    await join();
    expect(await names(await eventOf("opportunities", dealId))).toEqual({ name: "Dinner for Erased", client_name: null });
    expect(await namedAnywhere(v, "Isla Stalewell")).toBe(0);
  });

  it("a proposal's title an erasure rewords while the join's run is under way is not copied back onto an event the run makes", async () => {
    const held = await venueIn(pool, "stale text, a proposal: the venue held");
    const v = await venueIn(pool, "stale text, a proposal's title");
    // An older sent proposal with nothing to join: the join makes its event
    // last (step 3, after every proposal that reaches one), and waits there.
    await proposal(held, { title: "TEST ONLY older proposal", status: "sent", at: new Date("2020-01-01T00:00:00Z") });
    const isla = await person(v, "Isla Proposalwell");
    // Her lost deal has no event; its sent proposal must have one, named by itself.
    const lostDeal = await deal(v, { title: "Wedding for Isla Proposalwell", leadId: isla, stage: "lost" });
    const proposalId = await proposal(v, { title: "Ceilidh for Isla Proposalwell", status: "sent", dealId: lostDeal });

    await joinWhileVenueHeld(held, async () => {
      expect(await erase(v, isla)).toMatchObject({ ok: true });
      expect(await value(`SELECT row_to_json(p) AS value FROM (SELECT title, event_id FROM proposals WHERE id = $1) p`,
        [proposalId])).toEqual({ title: "Ceilidh for Erased", event_id: null });
    });
    expect(await namedAnywhere(v, "Isla Proposalwell")).toBe(0);
    await join();
    expect(await names(await eventOf("proposals", proposalId))).toEqual({ name: "Ceilidh for Erased", client_name: null });
    expect(await namedAnywhere(v, "Isla Proposalwell")).toBe(0);
  });

  it("an erasure under way while the join runs: the join leaves what the erasure holds, and nothing of the name reaches an event", async () => {
    const v = await venueIn(pool, "stale text, an erasure under way");
    const ruaridh = await person(v, "Ruaridh Midway");
    // An enquiry that asks to book nothing: the deal's event is named by the
    // deal, its client by the enquiry (step 2).
    const asked = await enquiry(v, { contactId: ruaridh, name: "Ruaridh Midway", eventType: "venue-enquiry" });
    const dealId = await deal(v, { title: "Dinner for Ruaridh Midway", enquiryId: asked });
    const joiner = await pool.connect();
    let open = false;
    try {
      await joiner.query("BEGIN");
      open = true;
      // The erasure has rewritten everything and not committed while the join
      // reads her rows and runs to its end; the erasure commits, then the join.
      const erased = await db.transaction(async (tx) => {
        const lock = await lockPerson(tx, v.venueId, ruaridh);
        if (lock.state !== "live") throw new Error("The person is not live");
        const outcome = await eraseLockedPerson(tx, lock.row, { actorUserId: v.admin.id, now: new Date() });
        await joiner.query("SELECT * FROM spine_join_old_records()");
        return outcome;
      });
      expect(erased).toMatchObject({ ok: true });
      await joiner.query("COMMIT");
      open = false;
    } finally {
      if (open) await joiner.query("ROLLBACK");
      joiner.release();
    }
    expect(await namedAnywhere(v, "Ruaridh Midway")).toBe(0);
    await join();
    expect(await names(await eventOf("opportunities", dealId))).toEqual({ name: "Dinner for Erased", client_name: null });
    expect(await namedAnywhere(v, "Ruaridh Midway")).toBe(0);
  });

  it("an enquiry's name a writer rewords, uncommitted while the join reads it and committed before the join commits, is not copied as a client's name", async () => {
    const v = await venueIn(pool, "stale text, a client's name");
    // Enquiries that ask to book nothing: the events are named by the deal and
    // by the proposal, their clients by the enquiries (steps 2 and 3), which
    // the join only reads.
    const forDeal = await enquiry(v, { name: "Morag Clientwell", eventType: "venue-enquiry" });
    const dealId = await deal(v, { title: "TEST ONLY dinner", enquiryId: forDeal });
    const forProposal = await enquiry(v, { name: "Morag Clientwell", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "TEST ONLY ceilidh", status: "sent", enquiryId: forProposal });
    // A sent proposal of a lost deal, with no enquiry: its event's occasion
    // is the deal's, which the join only reads.
    const lostDeal = await id(`INSERT INTO opportunities (venue_id, title, stage, event_type)
      VALUES ($1, 'TEST ONLY lost deal', 'lost', 'Morag Clientwell dinner') RETURNING id`, [v.venueId]);
    const ofLostDeal = await proposal(v, { title: "TEST ONLY reception", status: "sent", dealId: lostDeal });
    const writer = await pool.connect();
    const joiner = await pool.connect();
    let writing = false;
    let joining = false;
    try {
      // An UPDATE that changes no key column (as a reword is) takes the row
      // FOR NO KEY UPDATE until it commits.
      await writer.query("BEGIN");
      writing = true;
      await writer.query("UPDATE enquiries SET name = 'Erased' WHERE id = ANY($1::uuid[])", [[forDeal, forProposal]]);
      await writer.query("UPDATE opportunities SET event_type = 'dinner' WHERE id = $1", [lostDeal]);
      await joiner.query("BEGIN");
      joining = true;
      await joiner.query("SELECT * FROM spine_join_old_records()");
      await writer.query("COMMIT");
      writing = false;
      await joiner.query("COMMIT");
      joining = false;
    } finally {
      if (writing) await writer.query("ROLLBACK");
      if (joining) await joiner.query("ROLLBACK");
      writer.release();
      joiner.release();
    }
    // Left for the next run, which names the clients, and the occasion, as the rows now read.
    const occasionsNaming = `events WHERE venue_id = $1 AND strpos(coalesce(event_type, ''), $2) > 0`;
    expect(await namedAnywhere(v, "Morag Clientwell")).toBe(0);
    expect(await count(occasionsNaming, [v.venueId, "Morag Clientwell"])).toBe(0);
    await join();
    expect(await names(await eventOf("opportunities", dealId))).toEqual({ name: "TEST ONLY dinner", client_name: "Erased" });
    expect(await names(await eventOf("proposals", proposalId))).toEqual({ name: "TEST ONLY ceilidh", client_name: "Erased" });
    expect(await value("SELECT event_type AS value FROM events WHERE id = $1", [await eventOf("proposals", ofLostDeal)])).toBe("dinner");
    expect(await namedAnywhere(v, "Morag Clientwell")).toBe(0);
    expect(await count(occasionsNaming, [v.venueId, "Morag Clientwell"])).toBe(0);
  });

  it("an erasure that meets the join holding the rows a made event was named from waits for its commit, answers RETRY, and the retry rewords the event", async () => {
    const v = await venueIn(pool, "stale text, the join first");
    const fiona = await person(v, "Fiona Waitwell");
    const asked = await enquiry(v, { contactId: fiona, name: "Fiona Waitwell", eventType: "venue-enquiry" });
    const dealId = await deal(v, { title: "Dinner for Fiona Waitwell", enquiryId: asked });
    const joiner = await pool.connect();
    let joining = false;
    try {
      // The join has made the deal's event, named from the deal and its client
      // from the enquiry, and holds both rows until it commits.
      await joiner.query("BEGIN");
      joining = true;
      await joiner.query("SELECT * FROM spine_join_old_records()");
      const erasing: Promise<Settled> = erase(v, fiona)
        .then((outcome): Settled => ({ ok: true, outcome }), (error: unknown): Settled => ({ ok: false, error }));
      try {
        await waitForLockWait("%for update%");
      } finally {
        await joiner.query("COMMIT");
        joining = false;
      }
      const settled = await erasing;
      expect(settled.ok).toBe(false);
      if (!settled.ok) expect(settled.error).toBeInstanceOf(ErasureMovedOn);
    } finally {
      if (joining) await joiner.query("ROLLBACK");
      joiner.release();
    }
    const made = await eventOf("opportunities", dealId);
    expect(await names(made)).toEqual({ name: "Dinner for Fiona Waitwell", client_name: "Fiona Waitwell" });
    // Tried again, the erasure finds the event through the deal's new link.
    expect(await erase(v, fiona)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await names(made)).toEqual({ name: "Dinner for Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Fiona Waitwell")).toBe(0);
  });

  it("the join's two record tables hold no text from a person's records: an erased person's listed enquiry and deal keep their questions, nameless", async () => {
    const v = await venueIn(pool, "erasure, the record tables");
    const eilidh = await person(v, "Eilidh Listholder");
    // Her enquiry's released holds sit in two events: listed (reaches_many_events).
    const first = await event(v, "TEST ONLY first of two", null);
    const second = await event(v, "TEST ONLY second of two", null);
    const listed = await enquiry(v, { contactId: eilidh, name: "Eilidh Listholder" });
    await booking(v, { eventId: first, enquiryId: listed, kind: "hold", status: "released" });
    await booking(v, { eventId: second, enquiryId: listed, kind: "hold", status: "released" });
    // Her other enquiry is joined to an event with an open deal already: her
    // deal from it is listed (second_open_deal).
    const taken = await event(v, "TEST ONLY taken", null);
    const otherDeal = await deal(v, { title: "TEST ONLY open deal" });
    await link(pool, "opportunities", otherDeal, taken);
    const joinedEnquiry = await enquiry(v, { contactId: eilidh, name: "Eilidh Listholder", replied: true });
    await link(pool, "enquiries", joinedEnquiry, taken);
    const listedDeal = await deal(v, { title: "Dinner for Eilidh Listholder", leadId: eilidh, enquiryId: joinedEnquiry });
    // And a worked enquiry of hers the join makes an event for (a join row).
    const made = await enquiry(v, { contactId: eilidh, name: "Eilidh Listholder", replied: true });
    await join();
    const open = `event_link_reviews WHERE subject_kind = $1 AND subject_id = $2 AND resolved_at IS NULL AND binding_review_id IS NULL`;
    expect(await count(open, ["enquiry", listed])).toBe(1);
    expect(await count(open, ["opportunity", listedDeal])).toBe(1);
    const madeEvent = await eventOf("enquiries", made);
    expect(await joinOf("enquiry", made)).toEqual({ event_id: madeEvent, event_made: true, path: "new_event" });
    // Before and after the erasure, no column of either table holds a name of hers.
    for (const text of ["Eilidh", "Listholder"]) expect(await recordRowsHolding(text)).toBe(0);

    expect(await erase(v, eilidh)).toMatchObject({ ok: true });
    for (const text of ["Eilidh", "Listholder"]) expect(await recordRowsHolding(text)).toBe(0);
    // The questions stay open, as ids: the erased enquiry's, and her kept deal's.
    expect(await count(open, ["enquiry", listed])).toBe(1);
    expect(await count(open, ["opportunity", listedDeal])).toBe(1);
    await join();
    for (const text of ["Eilidh", "Listholder"]) expect(await recordRowsHolding(text)).toBe(0);
    expect(await namedAnywhere(v, "Eilidh")).toBe(0);
  });

  // The cases from here to the undo's run the 24-month pass at 2024-06-01 over
  // people last in touch in 2020, so they come after the pass's own case,
  // whose counts are for the whole database.
  const passNow = new Date("2024-06-01T02:00:00Z");
  const longAgo = new Date("2020-03-02T10:00:00Z");

  /** Who the pass, before any step, reads as kept with nothing to remove, at the venue. */
  async function keptByReading(v: SpineVenue): Promise<readonly string[]> {
    const looked = await eraseLapsedPeople(db, { now: passNow, dryRun: true, limits: { examined: 0 } });
    return looked.kept.filter((row) => row.venueId === v.venueId).map((row) => row.personId);
  }

  it("a booking from the person's own enquiry, in an event another live person's record is tied to, keeps them as before the links: the event stays near", async () => {
    const v = await venueIn(pool, "erasure, own booking in a tied event");
    // Her enquiry is linked to the event, and her confirmed booking from it sits there.
    const kirsty = await person(v, "Kirsty Ownbooked", longAgo);
    const hers = await enquiry(v, { contactId: kirsty, name: "Kirsty Ownbooked", replied: true, at: longAgo });
    const shared = await event(v, "Kirsty Ownbooked", "Kirsty Ownbooked");
    await link(pool, "enquiries", hers, shared);
    const inked = await booking(v, { eventId: shared, enquiryId: hers, kind: "ink", at: longAgo });
    // Another live person's enquiry is linked to the same event.
    const lachlan = await person(v, "Lachlan Tiedtoo");
    const his = await enquiry(v, { contactId: lachlan, name: "Lachlan Tiedtoo" });
    await link(pool, "enquiries", his, shared);

    // The pass reads her as kept by that booking, with nothing of hers to remove.
    expect(await keptByReading(v)).toEqual([kirsty]);
    // Near, as his record makes it, and her own booking there is still hers.
    expect(await classified(v, kirsty)).toEqual({ own: [], near: [shared] });
    expect(await erase(v, kirsty)).toEqual({ ok: false, refusal: "has_booking" });
    expect(await names(shared)).toEqual({ name: "Kirsty Ownbooked", client_name: "Kirsty Ownbooked" });
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[hers, his]])).toBe(2);
    expect(await count("bookings WHERE id = $1 AND kind = 'ink' AND deleted_at IS NULL", [inked])).toBe(1);
    expect(await count("contacts WHERE id = ANY($1::uuid[]) AND erased_at IS NULL", [[kirsty, lachlan]])).toBe(2);
  });

  interface BookedAndTied {
    readonly personId: string;
    readonly enquiryId: string;
    readonly eventId: string;
    readonly otherEnquiryId: string;
  }

  /**
   * A person last in touch long ago whose enquiry, linked to the event, had a
   * hold there that was released: the booking makes the event theirs. Another
   * live person's enquiry is linked to the same event.
   */
  async function bookedAndTied(v: SpineVenue, name: string, other: string): Promise<BookedAndTied> {
    const personId = await person(v, name, longAgo);
    const enquiryId = await enquiry(v, { contactId: personId, name, replied: true, at: longAgo });
    const eventId = await event(v, name, name);
    await link(pool, "enquiries", enquiryId, eventId);
    await booking(v, { eventId, enquiryId, kind: "hold", status: "released", at: longAgo });
    const otherEnquiryId = await enquiry(v, { contactId: await person(v, other), name: other });
    await link(pool, "enquiries", otherEnquiryId, eventId);
    return { personId, enquiryId, eventId, otherEnquiryId };
  }

  /** The pass's reading and the erasure agree: the person is kept and the
   *  erasure refused, changing nothing; the event stays near them. */
  async function expectKept(v: SpineVenue, held: BookedAndTied, refusal: "has_booking" | "has_contract"): Promise<void> {
    expect(await keptByReading(v)).toEqual([held.personId]);
    expect(await classified(v, held.personId)).toEqual({ own: [], near: [held.eventId] });
    expect(await erase(v, held.personId)).toEqual({ ok: false, refusal });
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [held.personId])).toBe(1);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[held.enquiryId, held.otherEnquiryId]])).toBe(2);
    expect(await value("SELECT name AS value FROM events WHERE id = $1", [held.eventId])).not.toBe("Erased");
  }

  it("a confirmed booking with no enquiry, in an event a booking from their enquiry makes theirs, keeps them though another live person's record points at it too", async () => {
    const v = await venueIn(pool, "erasure, a booking with no enquiry in their tied event");
    const held = await bookedAndTied(v, "Innes Heldfast", "Rhuaridh Tiedby");
    await booking(v, { eventId: held.eventId, kind: "ink", at: longAgo });
    await expectKept(v, held, "has_booking");
  });

  it("another live person's live hold, in an event a booking from their enquiry makes theirs, keeps them", async () => {
    const v = await venueIn(pool, "erasure, another person's hold in their tied event");
    const held = await bookedAndTied(v, "Johan Heldfast", "Seonag Tiedby");
    await booking(v, { eventId: held.eventId, enquiryId: held.otherEnquiryId, kind: "hold", at: longAgo });
    await expectKept(v, held, "has_booking");
  });

  it("a deposit request naming an event a booking from their enquiry makes theirs keeps them, though the request is on another person's proposal", async () => {
    const v = await venueIn(pool, "erasure, a deposit request on their tied event");
    const held = await bookedAndTied(v, "Kenna Heldfast", "Torcuil Tiedby");
    const hisProposal = await proposal(v, { title: "TEST ONLY his proposal", status: "sent", enquiryId: held.otherEnquiryId });
    await pool.query(`INSERT INTO proposal_deposit_requests (venue_id, proposal_id, event_id, proposal_version, proposal_version_hash,
        basis, quote_total_minor, amount_minor, currency)
      VALUES ($1, $2, $3, 1, $4, 'amount', 100000, 25000, 'GBP')`, [v.venueId, hisProposal, held.eventId, "a".repeat(64)]);
    await expectKept(v, held, "has_contract");
  });

  it("an event the join made for a record whose link has moved since is found through the join's own record, by erasure and by the pass", async () => {
    const v = await venueIn(pool, "erasure, a made event left behind");
    // The join makes an event for her worked enquiry, and one for his open deal (no enquiry), each named from it.
    const isla = await person(v, "Isla Movedwell");
    const asked = await enquiry(v, { contactId: isla, name: "Isla Movedwell", replied: true });
    const ruaraidh = await person(v, "Ruaraidh Dealmoved", longAgo);
    const hisDeal = await deal(v, { title: "Dinner for Ruaraidh Dealmoved", leadId: ruaraidh, at: longAgo });
    await join();
    const made = await eventOf("enquiries", asked);
    const madeForDeal = await eventOf("opportunities", hisDeal);
    expect(await joinOf("enquiry", asked)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await joinOf("opportunity", hisDeal)).toEqual({ event_id: madeForDeal, event_made: true, path: "new_event" });
    expect(await names(made)).toEqual({ name: "Isla Movedwell", client_name: "Isla Movedwell" });
    // Then each link is moved to another event (as a Diary edit that moves an
    // enquiry's last booking moves it, or a repair by hand), and a confirmed
    // booking is held in the event made for his deal.
    const movedTo = await event(v, "TEST ONLY where her enquiry went", null);
    await link(pool, "enquiries", asked, movedTo);
    await link(pool, "opportunities", hisDeal, await event(v, "TEST ONLY where his deal went", null));
    await booking(v, { eventId: madeForDeal, kind: "ink", at: longAgo });

    // Both are hers, the one the join made for her enquiry among them, and it loses her name.
    const found = await classified(v, isla);
    expect({ own: [...found.own].sort(), near: found.near }).toEqual({ own: [made, movedTo].sort(), near: [] });
    expect(await erase(v, isla)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 1 } });
    expect(await names(made)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Isla Movedwell")).toBe(0);

    // The event made for his deal is his: its confirmed booking keeps him, in
    // the pass's reading as in the erasure, and nothing changes.
    expect(await keptByReading(v)).toEqual([ruaraidh]);
    expect(await erase(v, ruaraidh)).toEqual({ ok: false, refusal: "has_booking" });
    expect(await names(madeForDeal)).toEqual({ name: "Dinner for Ruaraidh Dealmoved", client_name: null });
  });

  /** A person last in touch long ago, kept by a confirmed booking pencilled from her first enquiry. */
  async function keptByAnInk(v: SpineVenue, name: string): Promise<{ readonly personId: string; readonly booked: string; readonly kept: string }> {
    const personId = await person(v, name, longAgo);
    const booked = await enquiry(v, { contactId: personId, name, at: longAgo });
    const kept = await event(v, "TEST ONLY her booked event", null);
    await booking(v, { eventId: kept, enquiryId: booked, kind: "ink", at: longAgo });
    return { personId, booked, kept };
  }

  /** The 24-month pass, run for real; it keeps the person given, at the venue. */
  async function passKeeps(v: SpineVenue, personId: string): Promise<void> {
    const pass = await eraseLapsedPeople(db, { now: passNow, startsOn: new Date("2024-01-01T00:00:00Z") });
    expect(pass).toMatchObject({ off: false, failed: 0 });
    expect(pass.kept.filter((row) => row.venueId === v.venueId)).toEqual([{ venueId: v.venueId, personId }]);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [personId])).toBe(1);
  }

  it("the 24-month pass, removing a kept person's enquiry that never became a booking, renames the event the join made for it while it holds the name the join copied, whatever still points at it", async () => {
    const v = await venueIn(pool, "retention, a kept person's made events");
    const { personId: morag, booked, kept } = await keptByAnInk(v, "Morag Keptwell");
    // Two worked enquiries that never became a booking: the join makes an
    // event for each, named from it. A floor plan, and a proposal of the
    // second enquiry, are then linked to the second's.
    const spare = await enquiry(v, { contactId: morag, name: "Morag Keptwell", replied: true, at: longAgo });
    const planned = await enquiry(v, { contactId: morag, name: "Morag Keptwell", replied: true, at: longAgo });
    await join();
    const made = await eventOf("enquiries", spare);
    const madeAndPlanned = await eventOf("enquiries", planned);
    expect(await joinOf("enquiry", spare)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await joinOf("enquiry", planned)).toEqual({ event_id: madeAndPlanned, event_made: true, path: "new_event" });
    const plan = await id(`INSERT INTO configurations (space_id, venue_id, name, layout_style)
      VALUES ($1, $2, 'TEST ONLY plan', 'dinner-rounds') RETURNING id`, [v.rooms.hall, v.venueId]);
    await pool.query(`INSERT INTO event_configuration_links (event_id, configuration_id, link_type)
      VALUES ($1, $2, 'source_configuration')`, [madeAndPlanned, plan]);
    const hers = await proposal(v, { title: "TEST ONLY her proposal", status: "draft", enquiryId: planned, at: longAgo });
    await link(pool, "proposals", hers, madeAndPlanned);

    await passKeeps(v, morag);
    // She is kept, with her booked enquiry; the two that never became a booking go.
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[booked, spare, planned]])).toBe(1);
    // Each made event loses the name the join copied from its enquiry, and its
    // client, whether or not something still points at it.
    expect(await names(made)).toEqual({ name: "Event", client_name: null });
    expect(await names(madeAndPlanned)).toEqual({ name: "Event", client_name: null });
    expect(await eventOf("proposals", hers)).toBe(madeAndPlanned);
    expect(await names(kept)).toEqual({ name: "TEST ONLY her booked event", client_name: null });
    expect(await namedAnywhere(v, "Morag Keptwell")).toBe(0);
  });

  /** A floor plan of the venue linked to the event: a row that points at it. */
  async function planOn(v: SpineVenue, eventId: string): Promise<void> {
    const plan = await id(`INSERT INTO configurations (space_id, venue_id, name, layout_style)
      VALUES ($1, $2, 'TEST ONLY plan', 'dinner-rounds') RETURNING id`, [v.rooms.hall, v.venueId]);
    await pool.query(`INSERT INTO event_configuration_links (event_id, configuration_id, link_type)
      VALUES ($1, $2, 'source_configuration')`, [eventId, plan]);
  }

  /** A kept person's worked enquiry that never became a booking, and the event the join makes for it. */
  async function spareAndMade(v: SpineVenue, personId: string, name: string): Promise<{ readonly spare: string; readonly made: string }> {
    const spare = await enquiry(v, { contactId: personId, name, replied: true, at: longAgo });
    await join();
    const made = await eventOf("enquiries", spare);
    expect(await joinOf("enquiry", spare)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    return { spare, made };
  }

  it("the 24-month pass leaves a name staff typed since on such an event something points at, and clears only the client name the join copied", async () => {
    const v = await venueIn(pool, "retention, a made event renamed by staff");
    const { personId: elspeth } = await keptByAnInk(v, "Elspeth Keptwell");
    const { spare, made } = await spareAndMade(v, elspeth, "Elspeth Keptwell");
    expect(await names(made)).toEqual({ name: "Elspeth Keptwell", client_name: "Elspeth Keptwell" });
    await pool.query("UPDATE events SET name = 'TEST ONLY summer ball' WHERE id = $1", [made]);
    await planOn(v, made);

    await passKeeps(v, elspeth);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(made)).toEqual({ name: "TEST ONLY summer ball", client_name: null });
  });

  it("the 24-month pass leaves a client name staff typed since on such an event something points at, and renames it", async () => {
    const v = await venueIn(pool, "retention, a made event's client typed by staff");
    const { personId: fenella } = await keptByAnInk(v, "Fenella Keptwell");
    const { made } = await spareAndMade(v, fenella, "Fenella Keptwell");
    await pool.query("UPDATE events SET client_name = 'TEST ONLY the family' WHERE id = $1", [made]);
    await planOn(v, made);

    await passKeeps(v, fenella);
    expect(await names(made)).toEqual({ name: "Event", client_name: "TEST ONLY the family" });
  });

  it("the 24-month pass names an event the join made for a removed enquiry, that nothing points at, Event, whatever it holds", async () => {
    const v = await venueIn(pool, "retention, made events nobody uses");
    const { personId: ottilie } = await keptByAnInk(v, "Ottilie Keptwell");
    // The enquiry is renamed after the join copied its name (a repair by SQL), so the event holds an older copy.
    const { spare: renamed, made: oldCopy } = await spareAndMade(v, ottilie, "Ottilie Keptwell");
    await pool.query("UPDATE enquiries SET name = 'Ottilie Keptwell-Barr' WHERE id = $1", [renamed]);
    // Staff typed this one's name and client since.
    const { made: typed } = await spareAndMade(v, ottilie, "Ottilie Keptwell");
    await pool.query("UPDATE events SET name = 'TEST ONLY Ottilie Keptwell party', client_name = 'TEST ONLY Ottilie K' WHERE id = $1", [typed]);

    await passKeeps(v, ottilie);
    expect(await names(oldCopy)).toEqual({ name: "Event", client_name: null });
    expect(await names(typed)).toEqual({ name: "Event", client_name: null });
    expect(await namedAnywhere(v, "Ottilie")).toBe(0);
  });

  it("an event the join made that is a deal's or a client account's own is in use: the pass leaves its typed name", async () => {
    const v = await venueIn(pool, "retention, made events a deal or an account owns");
    const { personId: philippa } = await keptByAnInk(v, "Philippa Keptwell");
    const { made: dealt } = await spareAndMade(v, philippa, "Philippa Keptwell");
    const { made: accounted } = await spareAndMade(v, philippa, "Philippa Keptwell");
    const someDeal = await deal(v, { title: "TEST ONLY a deal", stage: "lost" });
    const account = await id("INSERT INTO client_accounts (venue_id, name) VALUES ($1, 'TEST ONLY an account') RETURNING id", [v.venueId]);
    await pool.query("UPDATE events SET name = 'TEST ONLY dinner', opportunity_id = $2 WHERE id = $1", [dealt, someDeal]);
    await pool.query("UPDATE events SET name = 'TEST ONLY lunch', client_account_id = $2 WHERE id = $1", [accounted, account]);

    await passKeeps(v, philippa);
    expect(await names(dealt)).toEqual({ name: "TEST ONLY dinner", client_name: null });
    expect(await names(accounted)).toEqual({ name: "TEST ONLY lunch", client_name: null });
  });

  it("an event the join made whose phase something points at is in use: the pass leaves its typed name", async () => {
    const v = await venueIn(pool, "retention, a made event's phase in use");
    const { personId: rosalind } = await keptByAnInk(v, "Rosalind Keptwell");
    const { made } = await spareAndMade(v, rosalind, "Rosalind Keptwell");
    await pool.query("UPDATE events SET name = 'TEST ONLY ceilidh' WHERE id = $1", [made]);
    await pool.query(`INSERT INTO phase_layout_snapshots (event_phase_id)
      SELECT id FROM event_phases WHERE event_id = $1 ORDER BY id LIMIT 1`, [made]);
    expect(await count("phase_layout_snapshots WHERE event_phase_id IN (SELECT id FROM event_phases WHERE event_id = $1)", [made])).toBe(1);

    await passKeeps(v, rosalind);
    expect(await names(made)).toEqual({ name: "TEST ONLY ceilidh", client_name: null });
  });

  it("the 24-month pass clears the client name the join copied onto events it made for the removed enquiry's deal and proposal, never their names", async () => {
    const v = await venueIn(pool, "retention, a removed enquiry's deal and proposal events");
    const { personId: wynne } = await keptByAnInk(v, "Wynne Keptwell");
    // Enquiries that ask to book nothing: the join names the events by the
    // deal and the proposal (the deal's title is her name too), their client by the enquiry.
    const forDeal = await enquiry(v, { contactId: wynne, name: "Wynne Keptwell", eventType: "venue-enquiry", replied: true, at: longAgo });
    const dealId = await deal(v, { title: "Wynne Keptwell", enquiryId: forDeal, at: longAgo });
    const forProposal = await enquiry(v, { contactId: wynne, name: "Wynne Keptwell", eventType: "venue-enquiry", at: longAgo });
    const proposalId = await proposal(v, { title: "TEST ONLY a reception", status: "sent", enquiryId: forProposal, at: longAgo });
    await join();
    const dealEvent = await eventOf("opportunities", dealId);
    const proposalEvent = await eventOf("proposals", proposalId);
    expect(await names(dealEvent)).toEqual({ name: "Wynne Keptwell", client_name: "Wynne Keptwell" });
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY a reception", client_name: "Wynne Keptwell" });

    await passKeeps(v, wynne);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[forDeal, forProposal]])).toBe(0);
    expect(await names(dealEvent)).toEqual({ name: "Wynne Keptwell", client_name: null });
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY a reception", client_name: null });
  });

  it("the 24-month pass leaves an event the join made for an enquiry of theirs that still exists", async () => {
    const v = await venueIn(pool, "retention, a made event of a kept enquiry");
    const { personId: thea } = await keptByAnInk(v, "Thea Keptwell");
    // Her other enquiry stays (a live hold of its own elsewhere); the join made its event.
    const { spare: stays, made } = await spareAndMade(v, thea, "Thea Keptwell");
    await booking(v, { eventId: await event(v, "TEST ONLY elsewhere", null), enquiryId: stays, kind: "hold", at: longAgo });
    // A spare enquiry of hers points at that event, and goes.
    const spare = await enquiry(v, { contactId: thea, name: "Thea Keptwell", at: longAgo });
    await link(pool, "enquiries", spare, made);

    await passKeeps(v, thea);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[stays, spare]])).toBe(1);
    expect(await names(made)).toEqual({ name: "Thea Keptwell", client_name: "Thea Keptwell" });
  });

  it("the 24-month pass leaves an event the join only joined a removed enquiry to", async () => {
    const v = await venueIn(pool, "retention, an event the join joined");
    const { personId: una } = await keptByAnInk(v, "Una Keptwell");
    // Staff made and named the event; her worked enquiry's released hold sits in it, so the join joins her to it.
    const staffs = await event(v, "Una Keptwell", "Una Keptwell");
    const spare = await enquiry(v, { contactId: una, name: "Una Keptwell", replied: true, at: longAgo });
    await booking(v, { eventId: staffs, enquiryId: spare, kind: "hold", status: "released", at: longAgo });
    await join();
    expect(await joinOf("enquiry", spare)).toEqual({ event_id: staffs, event_made: false, path: "enquiry_bookings" });

    await passKeeps(v, una);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(staffs)).toEqual({ name: "Una Keptwell", client_name: "Una Keptwell" });
  });

  it("the 24-month pass leaves a same-named event the join made for an enquiry gone elsewhere, which the removed enquiry does not reach", async () => {
    const v = await venueIn(pool, "retention, a same-named event out of reach");
    const { personId: vita } = await keptByAnInk(v, "Vita Keptwell");
    const { spare } = await spareAndMade(v, vita, "Vita Keptwell");
    // An enquiry linked to nobody, of the same name, had an event made for it and went.
    const lone = await enquiry(v, { name: "Vita Keptwell", replied: true });
    await join();
    const unreached = await eventOf("enquiries", lone);
    await pool.query("DELETE FROM enquiries WHERE id = $1", [lone]);

    await passKeeps(v, vita);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(unreached)).toEqual({ name: "Vita Keptwell", client_name: "Vita Keptwell" });
  });

  it("the 24-month pass compares a name written with spaces around it as the join trimmed it", async () => {
    const v = await venueIn(pool, "retention, a padded name");
    const { personId: pia } = await keptByAnInk(v, "Pia Keptwell");
    const { made } = await spareAndMade(v, pia, "  Pia Keptwell \t");
    expect(await names(made)).toEqual({ name: "Pia Keptwell", client_name: "Pia Keptwell" });
    await planOn(v, made);

    await passKeeps(v, pia);
    expect(await names(made)).toEqual({ name: "Event", client_name: null });
  });

  it("the 24-month pass renames an event the join made for an enquiry of theirs that went earlier, when the enquiry it removes now points at it", async () => {
    const v = await venueIn(pool, "retention, a made event's enquiry gone earlier");
    const { personId: isobel } = await keptByAnInk(v, "Isobel Keptwell");
    const first = await enquiry(v, { contactId: isobel, name: "Isobel Keptwell", replied: true, at: longAgo });
    await join();
    const made = await eventOf("enquiries", first);
    expect(await joinOf("enquiry", first)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    // Her second enquiry points at the same event; the first, the one the
    // event was made for, went earlier, leaving the event named.
    const second = await enquiry(v, { contactId: isobel, name: "Isobel Keptwell", at: longAgo });
    await link(pool, "enquiries", second, made);
    await pool.query("DELETE FROM enquiries WHERE id = $1", [first]);
    expect(await names(made)).toEqual({ name: "Isobel Keptwell", client_name: "Isobel Keptwell" });

    await passKeeps(v, isobel);
    expect(await count("enquiries WHERE id = $1", [second])).toBe(0);
    expect(await names(made)).toEqual({ name: "Event", client_name: null });
    expect(await namedAnywhere(v, "Isobel Keptwell")).toBe(0);
  });

  it("the 24-month pass clears the client name the join copied onto events it made for a deal and a proposal another live person leads, made from the removed enquiry, never their names", async () => {
    const v = await venueIn(pool, "retention, a removed enquiry's nearby deal and proposal events");
    const { personId: zara } = await keptByAnInk(v, "Zara Keptwell");
    // Another live person leads a deal made from each of her two enquiries that
    // ask to book nothing (so the deals and the proposal are near her): the
    // first deal is open, and the join makes its event; the second is lost, and
    // the join makes an event for its sent proposal. Both events take their
    // client name from her enquiry.
    const leith = await person(v, "Leith Leadwell");
    const forDeal = await enquiry(v, { contactId: zara, name: "Zara Keptwell", eventType: "venue-enquiry", replied: true, at: longAgo });
    const dealId = await deal(v, { title: "TEST ONLY a dinner Leith leads", enquiryId: forDeal, leadId: leith, at: longAgo });
    const forProposal = await enquiry(v, { contactId: zara, name: "Zara Keptwell", eventType: "venue-enquiry", replied: true, at: longAgo });
    const lostDeal = await deal(v, { title: "TEST ONLY a lunch Leith lost", enquiryId: forProposal, leadId: leith, stage: "lost", at: longAgo });
    const proposalId = await proposal(v, { title: "TEST ONLY Leith's reception", status: "sent", dealId: lostDeal, enquiryId: forProposal, at: longAgo });
    await join();
    const dealEvent = await eventOf("opportunities", dealId);
    const proposalEvent = await eventOf("proposals", proposalId);
    expect(await names(dealEvent)).toEqual({ name: "TEST ONLY a dinner Leith leads", client_name: "Zara Keptwell" });
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY Leith's reception", client_name: "Zara Keptwell" });

    await passKeeps(v, zara);
    expect(await count("enquiries WHERE id = ANY($1::uuid[])", [[forDeal, forProposal]])).toBe(0);
    expect(await names(dealEvent)).toEqual({ name: "TEST ONLY a dinner Leith leads", client_name: null });
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY Leith's reception", client_name: null });
  });

  it("the 24-month pass leaves an event whose made record is undone", async () => {
    const v = await venueIn(pool, "retention, an undone made record");
    const { personId: xanthe } = await keptByAnInk(v, "Xanthe Keptwell");
    const { spare, made } = await spareAndMade(v, xanthe, "Xanthe Keptwell");
    await planOn(v, made);
    // The record marked undone by hand, as the undo marks it; the enquiry still
    // points at the event, so the pass reaches it.
    await pool.query("UPDATE event_link_joins SET undone_at = now() WHERE subject_kind = 'enquiry' AND subject_id = $1", [spare]);

    await passKeeps(v, xanthe);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(made)).toEqual({ name: "Xanthe Keptwell", client_name: "Xanthe Keptwell" });
  });

  it("the 24-month pass leaves an event whose made record is another venue's", async () => {
    const v = await venueIn(pool, "retention, a made record of another venue");
    const elsewhere = await venueIn(pool, "retention, another venue");
    const { personId: yolanda } = await keptByAnInk(v, "Yolanda Keptwell");
    const { spare, made } = await spareAndMade(v, yolanda, "Yolanda Keptwell");
    await planOn(v, made);
    // A row the join never writes, set by hand: the made record names another venue.
    await pool.query("UPDATE event_link_joins SET venue_id = $2 WHERE subject_kind = 'enquiry' AND subject_id = $1", [spare, elsewhere.venueId]);

    await passKeeps(v, yolanda);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(made)).toEqual({ name: "Yolanda Keptwell", client_name: "Yolanda Keptwell" });
  });

  it("an event the join made from the title of someone else's proposal they only answered on is near them, and loses their name", async () => {
    const v = await venueIn(pool, "erasure, a proposal answered on");
    const ailsa = await person(v, "Ailsa Answerwell");
    // His enquiry asks to book nothing, so the join names the proposal's
    // event by the proposal's title, which names her, and its client by him.
    const brodie = await person(v, "Brodie Proposer");
    const his = await enquiry(v, { contactId: brodie, name: "Brodie Proposer", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "Reception for Ailsa Answerwell", status: "sent", enquiryId: his });
    // She answered on it, signing with her name.
    await pool.query(`INSERT INTO proposal_comments (proposal_id, author_type, author_name, body)
      VALUES ($1, 'client', 'Ailsa Answerwell', 'TEST ONLY a reply')`, [proposalId]);
    await join();
    const made = await eventOf("proposals", proposalId);
    expect(await joinOf("proposal", proposalId)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await names(made)).toEqual({ name: "Reception for Ailsa Answerwell", client_name: "Brodie Proposer" });

    expect(await classified(v, ailsa)).toEqual({ own: [], near: [made] });
    expect(await erase(v, ailsa)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 0 } });
    // His proposal and its event are kept, linked, without her name.
    expect(await value("SELECT row_to_json(p) AS value FROM (SELECT title, event_id FROM proposals WHERE id = $1) p", [proposalId]))
      .toEqual({ title: "Reception for Erased", event_id: made });
    expect(await names(made)).toEqual({ name: "Reception for Erased", client_name: "Brodie Proposer" });
    expect(await namedAnywhere(v, "Answerwell")).toBe(0);
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [brodie])).toBe(1);
  });

  it("an event the join made for a proposal whose link has moved since is found through the join's own record, by erasure and by the pass", async () => {
    const v = await venueIn(pool, "erasure, a proposal's made event left behind");
    // Each lost deal has no event; the join makes one for its sent proposal, named by the proposal's title.
    const flora = await person(v, "Flora Proposalmoved");
    const herDeal = await deal(v, { title: "TEST ONLY her lost deal", leadId: flora, stage: "lost" });
    const hers = await proposal(v, { title: "Ceilidh for Flora Proposalmoved", status: "sent", dealId: herDeal });
    const lachie = await person(v, "Lachie Proposalmoved", longAgo);
    const hisDeal = await deal(v, { title: "TEST ONLY his lost deal", leadId: lachie, stage: "lost", at: longAgo });
    const his = await proposal(v, { title: "Dinner for Lachie Proposalmoved", status: "sent", dealId: hisDeal, at: longAgo });
    await join();
    const made = await eventOf("proposals", hers);
    const madeForHis = await eventOf("proposals", his);
    expect(await joinOf("proposal", hers)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await joinOf("proposal", his)).toEqual({ event_id: madeForHis, event_made: true, path: "new_event" });
    // Then each proposal's link is moved, and a confirmed booking is held in the event made for his.
    await link(pool, "proposals", hers, await event(v, "TEST ONLY where her proposal went", null));
    await link(pool, "proposals", his, await event(v, "TEST ONLY where his proposal went", null));
    await booking(v, { eventId: madeForHis, kind: "ink", at: longAgo });

    expect(await erase(v, flora)).toMatchObject({ ok: true, counts: { people: 1 } });
    expect(await names(made)).toEqual({ name: "Ceilidh for Erased", client_name: null });
    expect(await namedAnywhere(v, "Flora Proposalmoved")).toBe(0);
    // The event made for his proposal is his: its confirmed booking keeps him, in the pass's reading and in the erasure.
    expect(await keptByReading(v)).toEqual([lachie]);
    expect(await erase(v, lachie)).toEqual({ ok: false, refusal: "has_booking" });
  });

  it("a link written to the event of a proposal they only answered on, while the erasure waits for that proposal, answers RETRY, and the retry rewords the event", async () => {
    const v = await venueIn(pool, "erasure, an answered-on proposal linked meanwhile");
    const ailsa = await person(v, "Ailsa Retrywell");
    const brodie = await person(v, "Brodie Linkswell");
    const his = await enquiry(v, { contactId: brodie, name: "Brodie Linkswell", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "Reception for Ailsa Retrywell", status: "draft", enquiryId: his });
    await pool.query(`INSERT INTO proposal_comments (proposal_id, author_type, author_name, body)
      VALUES ($1, 'client', 'Ailsa Retrywell', 'TEST ONLY a reply')`, [proposalId]);
    const given = await event(v, "Reception for Ailsa Retrywell", "Brodie Linkswell");
    const writer = await pool.connect();
    let committed = false;
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE proposals SET event_id = $2 WHERE id = $1", [proposalId, given]);
      const erasing: Promise<Settled> = erase(v, ailsa)
        .then((outcome): Settled => ({ ok: true, outcome }), (error: unknown): Settled => ({ ok: false, error }));
      try {
        await waitForLockWait(`%from "proposals"%for update%`);
      } finally {
        await writer.query("COMMIT");
        committed = true;
      }
      const settled = await erasing;
      expect(settled.ok).toBe(false);
      if (!settled.ok) expect(settled.error).toBeInstanceOf(ErasureMovedOn);
    } finally {
      if (!committed) await writer.query("ROLLBACK");
      writer.release();
    }
    expect(await count("contacts WHERE id = $1 AND erased_at IS NULL", [ailsa])).toBe(1);
    expect(await names(given)).toEqual({ name: "Reception for Ailsa Retrywell", client_name: "Brodie Linkswell" });
    expect(await erase(v, ailsa)).toMatchObject({ ok: true, counts: { people: 1 } });
    expect(await names(given)).toEqual({ name: "Reception for Erased", client_name: "Brodie Linkswell" });
  });

  it("a booking in the event of a proposal they only answered on loses their name too", async () => {
    const v = await venueIn(pool, "erasure, an answered-on event's booking");
    const ailsa = await person(v, "Ailsa Heldname");
    const brodie = await person(v, "Brodie Heldby");
    const his = await enquiry(v, { contactId: brodie, name: "Brodie Heldby", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "TEST ONLY his reception", status: "draft", enquiryId: his });
    await pool.query(`INSERT INTO proposal_comments (proposal_id, author_type, author_name, body)
      VALUES ($1, 'client', 'Ailsa Heldname', 'TEST ONLY a reply')`, [proposalId]);
    const hisEvent = await event(v, "TEST ONLY his reception", "Brodie Heldby");
    await link(pool, "proposals", proposalId, hisEvent);
    const held = await booking(v, { eventId: hisEvent, enquiryId: his, kind: "hold", status: "released" });
    await pool.query("UPDATE bookings SET title = 'Held for Ailsa Heldname' WHERE id = $1", [held]);

    expect(await erase(v, ailsa)).toMatchObject({ ok: true, counts: { people: 1 } });
    expect(await value("SELECT title AS value FROM bookings WHERE id = $1", [held])).toBe("Held for Erased");
    expect(await value("SELECT row_to_json(b) AS value FROM (SELECT event_id, enquiry_id, status FROM bookings WHERE id = $1) b", [held]))
      .toEqual({ event_id: hisEvent, enquiry_id: his, status: "released" });
  });

  // An edit of an enquiry's name (PATCH /enquiries/:id) carries the copies the
  // join made of it: an event made for the enquiry follows in name and client,
  // one made for its deal or proposal in client, each column only while it
  // still holds the old name as the join wrote it, only at the enquiry's venue
  // and only through a made row in force.

  /** A worked enquiry, and the event the join makes for it, named from it. */
  async function madeFor(v: SpineVenue, name: string): Promise<{ readonly asked: string; readonly made: string }> {
    const asked = await enquiry(v, { name, replied: true });
    await join();
    const made = await eventOf("enquiries", asked);
    expect(await joinOf("enquiry", asked)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await names(made)).toEqual({ name, client_name: name });
    return { asked, made };
  }

  /** The row's version: any write to the row, even of the same values, changes it. */
  async function versionOf(eventId: string): Promise<unknown> {
    return value("SELECT xmin::text AS value FROM events WHERE id = $1", [eventId]);
  }

  it("an edit of an enquiry's name carries the join's copy: the event made for it follows in name and client", async () => {
    const v = await venueIn(pool, "edit, the copy follows");
    const { asked, made } = await madeFor(v, "Agnes Oldname");
    const edited = await edit(v, asked, { name: "Agnes Newname" });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<{ data: { name: string } }>().data.name).toBe("Agnes Newname");
    expect(await names(made)).toEqual({ name: "Agnes Newname", client_name: "Agnes Newname" });
  });

  it("an edit of an enquiry's name leaves a column of its event typed since", async () => {
    const v = await venueIn(pool, "edit, a column typed since");
    const { asked: first, made: namedByStaff } = await madeFor(v, "Beth Oldname");
    await pool.query("UPDATE events SET name = 'TEST ONLY harvest supper' WHERE id = $1", [namedByStaff]);
    const { asked: second, made: clientByStaff } = await madeFor(v, "Beth Oldname");
    await pool.query("UPDATE events SET client_name = 'TEST ONLY the guild' WHERE id = $1", [clientByStaff]);
    expect((await edit(v, first, { name: "Beth Newname" })).statusCode).toBe(200);
    // The other enquiry of the same name keeps its event's copy until it is edited itself.
    expect(await names(clientByStaff)).toEqual({ name: "Beth Oldname", client_name: "TEST ONLY the guild" });
    expect((await edit(v, second, { name: "Beth Newname" })).statusCode).toBe(200);
    expect(await names(namedByStaff)).toEqual({ name: "TEST ONLY harvest supper", client_name: "Beth Newname" });
    expect(await names(clientByStaff)).toEqual({ name: "Beth Newname", client_name: "TEST ONLY the guild" });
  });

  it("an edit of an enquiry's name carries the client name of the events the join made for its deal and its proposal, never their names", async () => {
    const v = await venueIn(pool, "edit, a deal's and a proposal's events");
    // Enquiries that ask to book nothing: the events are named by the deal (its
    // title the enquirer's name too) and by the proposal, their client by the enquiry.
    const forDeal = await enquiry(v, { name: "Cora Oldname", eventType: "venue-enquiry", replied: true });
    const dealId = await deal(v, { title: "Cora Oldname", enquiryId: forDeal });
    const forProposal = await enquiry(v, { name: "Cora Oldname", eventType: "venue-enquiry" });
    const proposalId = await proposal(v, { title: "TEST ONLY a reception", status: "sent", enquiryId: forProposal });
    // A third enquiry of the same name, never edited, with a deal of its own.
    const forOtherDeal = await enquiry(v, { name: "Cora Oldname", eventType: "venue-enquiry", replied: true });
    const otherDealId = await deal(v, { title: "TEST ONLY another dinner", enquiryId: forOtherDeal });
    await join();
    const dealEvent = await eventOf("opportunities", dealId);
    const proposalEvent = await eventOf("proposals", proposalId);
    const otherDealEvent = await eventOf("opportunities", otherDealId);
    expect(await names(dealEvent)).toEqual({ name: "Cora Oldname", client_name: "Cora Oldname" });
    expect(await names(otherDealEvent)).toEqual({ name: "TEST ONLY another dinner", client_name: "Cora Oldname" });
    expect((await edit(v, forDeal, { name: "Cora Newname" })).statusCode).toBe(200);
    // Only the edited enquiry's own deal's event follows: not another enquiry's proposal's, nor its deal's.
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY a reception", client_name: "Cora Oldname" });
    expect(await names(otherDealEvent)).toEqual({ name: "TEST ONLY another dinner", client_name: "Cora Oldname" });
    expect((await edit(v, forProposal, { name: "Cora Newname" })).statusCode).toBe(200);
    expect(await names(dealEvent)).toEqual({ name: "Cora Oldname", client_name: "Cora Newname" });
    expect(await names(proposalEvent)).toEqual({ name: "TEST ONLY a reception", client_name: "Cora Newname" });
    expect(await names(otherDealEvent)).toEqual({ name: "TEST ONLY another dinner", client_name: "Cora Oldname" });
  });

  it("an edit to a name the join would not copy gives the event the join's own name and no client", async () => {
    const v = await venueIn(pool, "edit, a name the join would not copy");
    const { asked, made } = await madeFor(v, "Dora Oldname");
    expect((await edit(v, asked, { name: "dora@people-links.invalid" })).statusCode).toBe(200);
    expect(await names(made)).toEqual({ name: "Event", client_name: null });
  });

  it("an edit that does not change an enquiry's name touches none of its events", async () => {
    const v = await venueIn(pool, "edit, the name unchanged");
    const { asked, made } = await madeFor(v, "Edie Samename");
    const before = await versionOf(made);
    expect((await edit(v, asked, { name: "Edie Samename", message: "TEST ONLY a note" })).statusCode).toBe(200);
    expect((await edit(v, asked, { email: `edie-${randomUUID()}@people-links.invalid` })).statusCode).toBe(200);
    expect(await versionOf(made)).toBe(before);
    expect(await names(made)).toEqual({ name: "Edie Samename", client_name: "Edie Samename" });
  });

  it("an edit of an enquiry's name touches no event of another venue, and none through a made row of another venue", async () => {
    const v = await venueIn(pool, "edit, the venue's events only");
    const elsewhere = await venueIn(pool, "edit, another venue");
    // Rows the join never writes, set by hand: the first enquiry's made row
    // names another venue's event; the second's made row is another venue's.
    // Every event holds the old name.
    const { asked: first } = await madeFor(v, "Fay Oldname");
    const theirEvent = await event(elsewhere, "Fay Oldname", "Fay Oldname");
    await pool.query("UPDATE event_link_joins SET event_id = $2 WHERE subject_kind = 'enquiry' AND subject_id = $1", [first, theirEvent]);
    const { asked: second, made: ofSecond } = await madeFor(v, "Fay Oldname");
    await pool.query("UPDATE event_link_joins SET venue_id = $2 WHERE subject_kind = 'enquiry' AND subject_id = $1", [second, elsewhere.venueId]);

    expect((await edit(v, first, { name: "Fay Newname" })).statusCode).toBe(200);
    expect((await edit(v, second, { name: "Fay Newname" })).statusCode).toBe(200);
    expect(await names(theirEvent)).toEqual({ name: "Fay Oldname", client_name: "Fay Oldname" });
    expect(await names(ofSecond)).toEqual({ name: "Fay Oldname", client_name: "Fay Oldname" });
  });

  it("an edit of an enquiry's name follows only made rows in force: not an undone one, nor one the join only joined", async () => {
    const v = await venueIn(pool, "edit, made rows in force only");
    const { asked: undoneFor, made: undoneEvent } = await madeFor(v, "Gwen Oldname");
    await pool.query("UPDATE event_link_joins SET undone_at = now() WHERE subject_kind = 'enquiry' AND subject_id = $1", [undoneFor]);
    // Staff made and named the event; the enquiry's released hold sits in it, so the join only joins it.
    const staffs = await event(v, "Gwen Oldname", "Gwen Oldname");
    const joinedOnly = await enquiry(v, { name: "Gwen Oldname", replied: true });
    await booking(v, { eventId: staffs, enquiryId: joinedOnly, kind: "hold", status: "released" });
    await join();
    expect(await joinOf("enquiry", joinedOnly)).toEqual({ event_id: staffs, event_made: false, path: "enquiry_bookings" });
    expect((await edit(v, undoneFor, { name: "Gwen Newname" })).statusCode).toBe(200);
    expect((await edit(v, joinedOnly, { name: "Gwen Newname" })).statusCode).toBe(200);
    expect(await names(undoneEvent)).toEqual({ name: "Gwen Oldname", client_name: "Gwen Oldname" });
    expect(await names(staffs)).toEqual({ name: "Gwen Oldname", client_name: "Gwen Oldname" });
  });

  /**
   * The edit's own writes (writeEnquiryEdit, as PATCH /enquiries/:id runs
   * them) in a transaction held open after they are written: `held` settles
   * once they are, and the transaction commits when `commit` is called.
   */
  function heldEdit(enquiryId: string, name: string): { readonly held: Promise<void>; readonly commit: () => Promise<void> } {
    let written: (() => void) | undefined;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { written = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const committed = db.transaction(async (tx) => {
      await writeEnquiryEdit(tx, enquiryId, { name, updatedAt: new Date() });
      written?.();
      await released;
    });
    return {
      held: Promise.race([held, committed.then(() => { throw new Error("The edit ended before it was held"); })]),
      commit: async () => { release?.(); await committed; },
    };
  }

  it("an edit holding the enquiry while the join runs: the join skips the enquiry without waiting, and its next run names the event by the new name", async () => {
    const v = await venueIn(pool, "edit first, the join beside it");
    const asked = await enquiry(v, { name: "Hilda Oldname", replied: true });
    // An enquiry that asks to book nothing, with a deal: the event the join
    // makes for the deal takes its client name from the enquiry, read FOR SHARE.
    const forDeal = await enquiry(v, { name: "Hamish Oldname", eventType: "venue-enquiry", replied: true });
    const dealId = await deal(v, { title: "TEST ONLY Hamish's dinner", enquiryId: forDeal });
    const editing = heldEdit(asked, "Hilda Newname");
    const editingDeal = heldEdit(forDeal, "Hamish Newname");
    try {
      await editing.held;
      await editingDeal.held;
      const started = Date.now();
      await join();
      // Skipped (SKIP LOCKED), not waited for: the pool's lock limit is 20 s.
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(await joinOf("enquiry", asked)).toBeUndefined();
      expect(await value("SELECT event_id AS value FROM enquiries WHERE id = $1", [asked])).toBeNull();
      expect(await joinOf("opportunity", dealId)).toBeUndefined();
    } finally {
      await Promise.all([editing.commit(), editingDeal.commit()]);
    }
    await join();
    const made = await eventOf("enquiries", asked);
    expect(await names(made)).toEqual({ name: "Hilda Newname", client_name: "Hilda Newname" });
    expect(await names(await eventOf("opportunities", dealId))).toEqual({ name: "TEST ONLY Hamish's dinner", client_name: "Hamish Newname" });
  });

  it("the join holding the enquiry while an edit arrives: the edit waits for the join's commit, then the event the join made follows the new name", async () => {
    const v = await venueIn(pool, "the join first, an edit beside it");
    const asked = await enquiry(v, { name: "Iona Oldname", replied: true });
    // An enquiry that asks to book nothing, with a deal: the join holds it FOR
    // SHARE while it makes the deal's event, its client name copied from it.
    const forDeal = await enquiry(v, { name: "Ishbel Oldname", eventType: "venue-enquiry", replied: true });
    const dealId = await deal(v, { title: "TEST ONLY Ishbel's dinner", enquiryId: forDeal });
    const joiner = await pool.connect();
    let open = false;
    try {
      await joiner.query("BEGIN");
      open = true;
      await joiner.query("SELECT * FROM spine_join_old_records()");
      const editing = edit(v, asked, { name: "Iona Newname" });
      const editingDeal = edit(v, forDeal, { name: "Ishbel Newname" });
      try {
        await waitForLockWait(`%from "enquiries"%for no key update%`, 2);
      } finally {
        await joiner.query("COMMIT");
        open = false;
      }
      expect((await editing).statusCode).toBe(200);
      expect((await editingDeal).statusCode).toBe(200);
    } finally {
      if (open) await joiner.query("ROLLBACK");
      joiner.release();
    }
    const made = await eventOf("enquiries", asked);
    expect(await joinOf("enquiry", asked)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await names(made)).toEqual({ name: "Iona Newname", client_name: "Iona Newname" });
    expect(await names(await eventOf("opportunities", dealId))).toEqual({ name: "TEST ONLY Ishbel's dinner", client_name: "Ishbel Newname" });
  });

  it("two edits of an enquiry's name at once: the second reads the name the first wrote, under the enquiry's lock, and the event follows both", async () => {
    const v = await venueIn(pool, "two edits at once");
    const { asked, made } = await madeFor(v, "Jean Oldname");
    const first = heldEdit(asked, "Jean Middlename");
    try {
      await first.held;
      const second = edit(v, asked, { name: "Jean Lastname" });
      try {
        await waitForLockWait(`%"enquiries"%`);
      } finally {
        await first.commit();
      }
      expect((await second).statusCode).toBe(200);
    } finally {
      await first.commit();
    }
    expect(await names(made)).toEqual({ name: "Jean Lastname", client_name: "Jean Lastname" });
  });

  it("the whole way: the join names the event, staff rename the enquiry, and the 24-month pass removing it leaves the event neither name", async () => {
    const v = await venueIn(pool, "edit, then the 24-month pass");
    const { personId: kirsten } = await keptByAnInk(v, "Kirsten Keptwell");
    const { spare, made } = await spareAndMade(v, kirsten, "Kirsten Oldname");
    await planOn(v, made);
    expect((await edit(v, spare, { name: "Kirsten Newname" })).statusCode).toBe(200);
    expect(await names(made)).toEqual({ name: "Kirsten Newname", client_name: "Kirsten Newname" });
    // Two years and more pass with nothing else said.
    await pool.query("UPDATE enquiries SET updated_at = $2 WHERE id = $1", [spare, longAgo]);

    await passKeeps(v, kirsten);
    expect(await count("enquiries WHERE id = $1", [spare])).toBe(0);
    expect(await names(made)).toEqual({ name: "Event", client_name: null });
    expect(await namedAnywhere(v, "Oldname")).toBe(0);
    expect(await namedAnywhere(v, "Newname")).toBe(0);
  });

  it("the join's own records of an erased enquiry stay as ids: the nightly join and the undo still run cleanly afterwards", async () => {
    const v = await venueIn(pool, "erasure, the join's records");
    const catriona = await person(v, "Catriona Listwell");
    const replied = await enquiry(v, { contactId: catriona, name: "Catriona Listwell", replied: true });
    // Her other enquiry's released holds sit in two events: the join lists it.
    const first = await event(v, "TEST ONLY first", null);
    const second = await event(v, "TEST ONLY second", null);
    const listed = await enquiry(v, { contactId: catriona, name: "Catriona Listwell" });
    await booking(v, { eventId: first, enquiryId: listed, kind: "hold", status: "released" });
    await booking(v, { eventId: second, enquiryId: listed, kind: "hold", status: "released" });
    await join();
    const made = await eventOf("enquiries", replied);
    expect(await joinOf("enquiry", replied)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    const openQuestion = `event_link_reviews WHERE subject_kind = 'enquiry' AND subject_id = $1 AND resolved_at IS NULL
      AND binding_review_id IS NULL AND reason = 'reaches_many_events' AND strpos(detail, 'Catriona') = 0`;
    expect(await count(openQuestion, [listed])).toBe(1);

    expect(await erase(v, catriona)).toMatchObject({ ok: true, counts: { people: 1, enquiries: 2 } });
    expect(await names(made)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await namedAnywhere(v, "Catriona Listwell")).toBe(0);
    // They hold ids, a path and counts, never a name: kept, as the module keeps
    // its audit row and a decision on a booking it rewords.
    expect(await joinOf("enquiry", replied)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await count(openQuestion, [listed])).toBe(1);

    await join();
    expect(await namedAnywhere(v, "Catriona Listwell")).toBe(0);
    // The undo keeps the made event (the enquiry it was joined for is gone),
    // leaves that join alone and deletes the question.
    const [undone] = (await pool.query<{ emptied: number; events_removed: number; left_alone: number }>(
      "SELECT * FROM spine_undo_joins()")).rows;
    expect(undone?.left_alone).toBeGreaterThanOrEqual(1);
    expect(await names(made)).toEqual({ name: "Erased", client_name: "Erased" });
    expect(await joinOf("enquiry", replied)).toEqual({ event_id: made, event_made: true, path: "new_event" });
    expect(await count(openQuestion, [listed])).toBe(0);
    await join();
    expect(await namedAnywhere(v, "Catriona Listwell")).toBe(0);
    expect(await count("events WHERE venue_id = $1", [v.venueId])).toBe(3);
  });
});

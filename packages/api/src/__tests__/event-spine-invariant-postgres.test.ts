import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { readSpineInvariant, spineInvariantHolds, type SpineInvariant } from "../services/event-spine-invariant.js";
import {
  deal as dealIn,
  enquiry as enquiryIn,
  event as eventIn,
  link as linkIn,
  openSpineDatabase,
  platformTarget,
  proposal as proposalIn,
  venue as venueIn,
  type LinkedTable,
  type ProposalLinks,
  type SpineDatabase,
  type SpineVenue,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The spine's count (readSpineInvariant) on PostgreSQL: each of its numbers
// counts the records it names and nothing else, in one venue at a time. A
// venue where every writer's rule was kept reads zero; so does one holding
// only records the rule leaves without an event (a draft from a plan alone,
// a lost deal, a turned-down enquiry, an access request, a closed enquiry
// whose only booking sits in a deleted event). The proof that the count
// agrees with the join of old records is in
// event-spine-links-migration-postgres.test.ts.
//
// The suite runs on a throwaway database of its own (openSpineDatabase); the
// shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();

const ALL_ZERO: SpineInvariant = {
  proposalsWithoutEvent: 0,
  agreementsWithoutEvent: 0,
  depositRequestsWithoutEvent: 0,
  openDealsWithoutEvent: 0,
  workedEnquiriesWithoutEvent: 0,
  eventsWithTwoOpenDeals: 0,
  disagreeingLinks: 0,
  linksToClosedEvents: 0,
  eventDealPointersInUse: 0,
};

type Arrange = (v: SpineVenue) => Promise<void>;

describe.skipIf(target === undefined)("the spine: the count of records without their event", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    spine = await openSpineDatabase("invariant");
    pool = spine.pool;
    db = spine.db;
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  const venue = (label: string) => venueIn(pool, label);
  const event = (venueId: string, name = "Fixture event") => eventIn(pool, venueId, name);
  const enquiry = (venueId: string, state?: Parameters<typeof enquiryIn>[2], eventType?: string | null) =>
    enquiryIn(pool, venueId, state, eventType);
  const deal = (venueId: string, stage?: Parameters<typeof dealIn>[2], enquiryId?: string | null) =>
    dealIn(pool, venueId, stage, enquiryId);
  const proposal = (venueId: string, status?: Parameters<typeof proposalIn>[2], links?: ProposalLinks) =>
    proposalIn(pool, venueId, status, links);
  const link = (table: LinkedTable, id: string, eventId: string) => linkIn(pool, table, id, eventId);

  async function insertedId(text: string, values: readonly unknown[]): Promise<string> {
    const [row] = (await pool.query<{ id: string }>(text, [...values])).rows;
    if (row === undefined) throw new Error("The fixture wrote no row");
    return row.id;
  }

  /** A first reply, recorded the moment the enquiry was made. */
  async function reply(enquiryId: string): Promise<void> {
    await pool.query(`UPDATE enquiries SET first_response_at = created_at, first_response_channel = 'email',
      first_response_recorded_at = created_at WHERE id = $1`, [enquiryId]);
  }

  async function repliedEnquiry(venueId: string, state?: Parameters<typeof enquiryIn>[2], eventType?: string | null): Promise<string> {
    const enquiryId = await enquiry(venueId, state, eventType);
    await reply(enquiryId);
    return enquiryId;
  }

  const deleteEvent = async (eventId: string): Promise<void> => {
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [eventId]);
  };

  /** An agreement (a contract version) on a proposal. */
  const agreementFor = (proposalId: string): Promise<string> =>
    insertedId(`INSERT INTO proposal_contract_versions
        (venue_id, proposal_id, version, proposal_version, proposal_version_hash, document, document_hash)
      SELECT p.venue_id, p.id, 1, 1, repeat('a', 64), '{}'::jsonb, repeat('b', 64) FROM proposals p WHERE p.id = $1
      RETURNING id`, [proposalId]);

  /** A deposit request on a proposal, naming an event or none; a withdrawn one is not in force. */
  const depositRequestFor = (proposalId: string, eventId: string | null, withdrawn = false): Promise<string> =>
    insertedId(`INSERT INTO proposal_deposit_requests (venue_id, proposal_id, event_id, proposal_version, proposal_version_hash,
        basis, quote_total_minor, amount_minor, currency, cancelled_at)
      SELECT p.venue_id, p.id, $2, 1, repeat('a', 64), 'amount', 100000, 25000, 'GBP', CASE WHEN $3 THEN now() END
      FROM proposals p WHERE p.id = $1 RETURNING id`, [proposalId, eventId, withdrawn]);

  /** A hold for an enquiry in an event, in the venue's first room; one that is no longer live has been released. */
  const hold = (v: SpineVenue, enquiryId: string, eventId: string, live = true): Promise<string> =>
    insertedId(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, 'hold', $5, 'Held date', '2031-04-01T18:00:00Z', '2031-04-01T22:00:00Z') RETURNING id`,
    [v.venueId, v.rooms.hall, eventId, enquiryId, live ? "active" : "released"]);

  /** A floor plan in the venue's first room. */
  const plan = (v: SpineVenue): Promise<string> =>
    insertedId(`INSERT INTO configurations (space_id, venue_id, name, layout_style)
      VALUES ($1, $2, 'Fixture plan', 'dinner-rounds') RETURNING id`, [v.rooms.hall, v.venueId]);

  async function proposalOnEvent(v: SpineVenue, status: Parameters<typeof proposalIn>[2]): Promise<string> {
    const proposalId = await proposal(v.venueId, status);
    await link("proposals", proposalId, await event(v.venueId));
    return proposalId;
  }

  async function proposalAndDealOnTwoEvents(v: SpineVenue): Promise<void> {
    const dealId = await deal(v.venueId, "qualified");
    await link("opportunities", dealId, await event(v.venueId, "The deal's"));
    await link("proposals", await proposal(v.venueId, "sent", { opportunityId: dealId }), await event(v.venueId, "The proposal's"));
  }

  async function proposalOnDeletedEvent(v: SpineVenue): Promise<void> {
    const eventId = await event(v.venueId, "Since deleted");
    await link("proposals", await proposal(v.venueId, "sent"), eventId);
    await deleteEvent(eventId);
  }

  async function eventNamingADeal(v: SpineVenue): Promise<void> {
    const dealId = await deal(v.venueId, "lost");
    await pool.query("UPDATE events SET opportunity_id = $2 WHERE id = $1", [await event(v.venueId), dealId]);
  }

  const CASES: readonly (readonly [keyof SpineInvariant, Arrange])[] = [
    ["proposalsWithoutEvent", async (v) => { await proposal(v.venueId, "sent"); }],
    // An agreement makes its proposal one that must have an event: it is counted too.
    ["agreementsWithoutEvent", async (v) => { await agreementFor(await proposal(v.venueId, "archived")); }],
    ["depositRequestsWithoutEvent", async (v) => { await depositRequestFor(await proposalOnEvent(v, "accepted"), null); }],
    ["openDealsWithoutEvent", async (v) => { await deal(v.venueId, "qualified"); }],
    ["workedEnquiriesWithoutEvent", async (v) => { await repliedEnquiry(v.venueId); }],
    ["disagreeingLinks", async (v) => { await proposalAndDealOnTwoEvents(v); }],
    ["linksToClosedEvents", async (v) => { await proposalOnDeletedEvent(v); }],
    ["eventDealPointersInUse", async (v) => { await eventNamingADeal(v); }],
  ];

  it.each(CASES)("counts %s", async (field, arrange) => {
    const v = await venue(`counts ${field}`);
    await arrange(v);
    const counts = await readSpineInvariant(db, v.venueId);
    expect(counts[field]).toBe(1);
    expect(spineInvariantHolds(counts)).toBe(false);
    // Every other number reads zero, but an agreement's proposal, which the agreement makes one that must have an event.
    expect(counts).toEqual({ ...ALL_ZERO, [field]: 1,
      ...(field === "agreementsWithoutEvent" ? { proposalsWithoutEvent: 1 } : {}) });
  });

  it("cannot be shown two open deals on one event while the unique index stands, and reads none", async () => {
    const v = await venue("two open deals");
    const eventId = await event(v.venueId);
    await link("opportunities", await deal(v.venueId, "new"), eventId);
    await expect(link("opportunities", await deal(v.venueId, "qualified"), eventId)).rejects.toThrow(/opportunities_one_open_per_event/u);
    // A lost deal may stand beside the open one.
    await link("opportunities", await deal(v.venueId, "lost"), eventId);
    const counts = await readSpineInvariant(db, v.venueId);
    expect(counts).toHaveProperty("eventsWithTwoOpenDeals", 0);
    // The rejected deal is still an open deal with no event.
    expect(counts).toEqual({ ...ALL_ZERO, openDealsWithoutEvent: 1 });
    const indexes = (await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'opportunities' AND indexname = 'opportunities_one_open_per_event'")).rows;
    expect(indexes).toEqual([{ indexname: "opportunities_one_open_per_event" }]);
  });

  it("reads zero for a venue where every writer's rule was kept", async () => {
    const v = await venue("every rule kept");
    const eventId = await event(v.venueId, "Kept");
    const enquiryId = await repliedEnquiry(v.venueId);
    await link("enquiries", enquiryId, eventId);
    await hold(v, enquiryId, eventId);
    const dealId = await deal(v.venueId, "qualified", enquiryId);
    await link("opportunities", dealId, eventId);
    const lost = await deal(v.venueId, "lost", enquiryId);
    await link("opportunities", lost, eventId);
    const proposalId = await proposal(v.venueId, "accepted", { opportunityId: dealId, enquiryId });
    await link("proposals", proposalId, eventId);
    await agreementFor(proposalId);
    await depositRequestFor(proposalId, eventId);
    const counts = await readSpineInvariant(db, v.venueId);
    expect(counts).toEqual(ALL_ZERO);
    expect(spineInvariantHolds(counts)).toBe(true);
  });

  it("does not count a draft made from a plan alone, a lost deal, a turned-down enquiry or an access request", async () => {
    const v = await venue("nothing owed");
    await proposal(v.venueId, "draft", { configurationId: await plan(v) });
    await deal(v.venueId, "lost");
    await repliedEnquiry(v.venueId, "rejected");
    // Access and pricing requests, their types trimmed as JavaScript trims: a tab, a no-break space, spaces.
    await repliedEnquiry(v.venueId, "submitted", "venue-access");
    await repliedEnquiry(v.venueId, "submitted", "venue-access\t");
    await repliedEnquiry(v.venueId, "submitted", " venue-access");
    await repliedEnquiry(v.venueId, "submitted", " venue-enquiry ");
    // A draft enquiry, even replied to, never has an event.
    await repliedEnquiry(v.venueId, "draft");
    // A deleted proposal never must; a declined one whose deposit request was withdrawn need not.
    await pool.query("UPDATE proposals SET deleted_at = now() WHERE id = $1", [await proposal(v.venueId, "sent")]);
    await depositRequestFor(await proposal(v.venueId, "declined"), null, true);
    // A closed enquiry whose only booking sits in an event since deleted: no child has a live event.
    const gone = await event(v.venueId, "Since deleted");
    await hold(v, await enquiry(v.venueId, "withdrawn"), gone);
    // An open enquiry whose only hold was released, in an event since deleted, has not been worked.
    await hold(v, await enquiry(v.venueId, "submitted"), gone, false);
    await deleteEvent(gone);
    const counts = await readSpineInvariant(db, v.venueId);
    expect(counts).toEqual(ALL_ZERO);
    expect(spineInvariantHolds(counts)).toBe(true);
  });

  it("counts a turned-down enquiry once a deal of it has a live event, as the join would carry it there", async () => {
    const v = await venue("carried");
    const enquiryId = await enquiry(v.venueId, "rejected");
    await link("opportunities", await deal(v.venueId, "lost", enquiryId), await event(v.venueId));
    expect(await readSpineInvariant(db, v.venueId)).toEqual({ ...ALL_ZERO, workedEnquiriesWithoutEvent: 1 });
  });

  it("reads every venue when none is named", async () => {
    const one = await venue("everywhere one"), two = await venue("everywhere two");
    await proposal(one.venueId, "sent");
    await proposal(two.venueId, "sent");
    const here = await readSpineInvariant(db, one.venueId);
    const everywhere = await readSpineInvariant(db);
    expect(here.proposalsWithoutEvent).toBe(1);
    expect(everywhere.proposalsWithoutEvent).toBeGreaterThanOrEqual(2);
    for (const field of Object.keys(ALL_ZERO) as (keyof SpineInvariant)[]) {
      expect(everywhere[field]).toBeGreaterThanOrEqual(here[field]);
    }
  });
});

import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOSED_ENQUIRY_STATES,
  CLOSED_OPPORTUNITY_STAGES,
  NON_BOOKING_ENQUIRY_TYPES,
  OPEN_OPPORTUNITY_STAGES,
  SENT_PROPOSAL_STATUSES,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  SPINE_INVARIANT_FIELDS,
  readSpineInvariant,
  spineInvariantHolds,
  type SpineInvariant,
} from "../services/event-spine-invariant.js";
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

  interface BookingInput {
    readonly kind?: "hold" | "viewing";
    readonly status?: "active" | "released" | "cancelled";
    readonly deleted?: boolean;
  }

  /** A booking for an enquiry in the venue's first room: a live hold in the event unless told otherwise
   *  (a viewing has no event). */
  const booking = (v: SpineVenue, enquiryId: string, eventId: string | null, input: BookingInput = {}): Promise<string> =>
    insertedId(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Held date', '2031-04-01T18:00:00Z', '2031-04-01T22:00:00Z', CASE WHEN $7 THEN now() END)
      RETURNING id`, [v.venueId, v.rooms.hall, eventId, enquiryId, input.kind ?? "hold", input.status ?? "active", input.deleted ?? false]);

  /** A hold for an enquiry in an event; one that is no longer live has been released. */
  const hold = (v: SpineVenue, enquiryId: string, eventId: string, live = true): Promise<string> =>
    booking(v, enquiryId, eventId, { status: live ? "active" : "released" });

  /** A quote written for an enquiry. */
  const quoteFor = (v: SpineVenue, enquiryId: string): Promise<string> =>
    insertedId("INSERT INTO quotes (venue_id, enquiry_id, name) VALUES ($1, $2, 'Fixture quote') RETURNING id", [v.venueId, enquiryId]);

  const deleteProposal = async (proposalId: string): Promise<void> => {
    await pool.query("UPDATE proposals SET deleted_at = now() WHERE id = $1", [proposalId]);
  };

  /** An accepted proposal, on an event when one is given. */
  async function acceptedOn(v: SpineVenue, eventId: string | null): Promise<string> {
    const proposalId = await proposal(v.venueId, "accepted");
    if (eventId !== null) await link("proposals", proposalId, eventId);
    return proposalId;
  }

  /** An event that has been deleted. */
  async function deletedEvent(v: SpineVenue): Promise<string> {
    const eventId = await event(v.venueId, "Since deleted");
    await deleteEvent(eventId);
    return eventId;
  }

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
    await repliedEnquiry(v.venueId, "submitted", `${String.fromCharCode(0xa0)}venue-access`);
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

  // A deposit request in force is counted in its own right, in all three places, whatever became of its
  // proposal: the later rule ("a request in force must have an event") reads the request's own row.
  const REQUEST_CASES: readonly (readonly [string, Arrange, Partial<SpineInvariant>])[] = [
    ["in force with no event, its proposal since deleted", async (v) => {
      const proposalId = await acceptedOn(v, await event(v.venueId));
      await depositRequestFor(proposalId, null);
      await deleteProposal(proposalId);
    }, { depositRequestsWithoutEvent: 1 }],
    ["in force naming a deleted event, its proposal since deleted", async (v) => {
      const proposalId = await acceptedOn(v, null);
      await depositRequestFor(proposalId, await deletedEvent(v));
      await deleteProposal(proposalId);
    }, { linksToClosedEvents: 1 }],
    ["in force naming another event than its proposal's", async (v) => {
      await depositRequestFor(await acceptedOn(v, await event(v.venueId, "The proposal's")), await event(v.venueId, "The request's"));
    }, { disagreeingLinks: 1 }],
    ["in force naming another event than its proposal's, the proposal since deleted", async (v) => {
      const proposalId = await acceptedOn(v, await event(v.venueId, "The proposal's"));
      await depositRequestFor(proposalId, await event(v.venueId, "The request's"));
      await deleteProposal(proposalId);
    }, { disagreeingLinks: 1 }],
    ["withdrawn, with no event, its proposal since deleted", async (v) => {
      const proposalId = await acceptedOn(v, await event(v.venueId));
      await depositRequestFor(proposalId, null, true);
      await deleteProposal(proposalId);
    }, {}],
  ];

  it.each(REQUEST_CASES)("counts a deposit request %s", async (label, arrange, expected) => {
    const v = await venue(`request ${label}`);
    await arrange(v);
    expect(await readSpineInvariant(db, v.venueId)).toEqual({ ...ALL_ZERO, ...expected });
  });

  // One clause of the must-have rules at a time, with nothing else that would count the record.
  const CLAUSE_CASES: readonly (readonly [string, Arrange, Partial<SpineInvariant>])[] = [
    ["a withdrawn proposal with no event whose deposit request is in force", async (v) => {
      await depositRequestFor(await proposal(v.venueId, "withdrawn"), null);
    }, { proposalsWithoutEvent: 1, depositRequestsWithoutEvent: 1 }],
    ["a draft proposal with no event, written for a lost deal", async (v) => {
      await proposal(v.venueId, "draft", { opportunityId: await deal(v.venueId, "lost") });
    }, { proposalsWithoutEvent: 1 }],
    ["a deleted open deal with no event", async (v) => {
      await pool.query("UPDATE opportunities SET deleted_at = now() WHERE id = $1", [await deal(v.venueId, "qualified")]);
    }, {}],
    ["an agreement whose proposal, with no event, was deleted", async (v) => {
      const proposalId = await proposal(v.venueId, "archived");
      await agreementFor(proposalId);
      await deleteProposal(proposalId);
    }, {}],
  ];

  it.each(CLAUSE_CASES)("counts %s as the definition says", async (label, arrange, expected) => {
    const v = await venue(`clause ${label}`);
    await arrange(v);
    expect(await readSpineInvariant(db, v.venueId)).toEqual({ ...ALL_ZERO, ...expected });
  });

  // A link to a deleted event, through each kind of record that must have an event; one that need not is not counted.
  const CLOSED_EVENT_CASES: readonly (readonly [string, Arrange, Partial<SpineInvariant>])[] = [
    ["an open deal", async (v) => { await link("opportunities", await deal(v.venueId, "qualified"), await deletedEvent(v)); },
      { linksToClosedEvents: 1 }],
    ["a worked enquiry", async (v) => { await link("enquiries", await repliedEnquiry(v.venueId), await deletedEvent(v)); },
      { linksToClosedEvents: 1 }],
    ["a proposal and its deposit request in force", async (v) => {
      const eventId = await deletedEvent(v);
      await depositRequestFor(await acceptedOn(v, eventId), eventId);
    }, { linksToClosedEvents: 2 }],
    ["a lost deal and a declined proposal, which need no event", async (v) => {
      const eventId = await deletedEvent(v);
      await link("opportunities", await deal(v.venueId, "lost"), eventId);
      await link("proposals", await proposal(v.venueId, "declined"), eventId);
    }, {}],
  ];

  it.each(CLOSED_EVENT_CASES)("counts a link to a deleted event from %s", async (label, arrange, expected) => {
    const v = await venue(`closed event ${label}`);
    await arrange(v);
    expect(await readSpineInvariant(db, v.venueId)).toEqual({ ...ALL_ZERO, ...expected });
  });

  // An open enquiry with no reply, worked by one sign alone, none of which reaches a live event.
  const WORK_CASES: readonly (readonly [string, (v: SpineVenue, enquiryId: string) => Promise<void>, number])[] = [
    ["a live hold, in an event since deleted", async (v, enquiryId) => { await booking(v, enquiryId, await deletedEvent(v)); }, 1],
    ["a viewing", async (v, enquiryId) => { await booking(v, enquiryId, null, { kind: "viewing" }); }, 1],
    ["a deal (lost, so it needs no event of its own)", async (v, enquiryId) => { await deal(v.venueId, "lost", enquiryId); }, 1],
    ["a proposal (declined, so it needs no event of its own)", async (v, enquiryId) => {
      await proposal(v.venueId, "declined", { enquiryId });
    }, 1],
    ["a quote", async (v, enquiryId) => { await quoteFor(v, enquiryId); }, 1],
    ["nothing but a cancelled hold, in an event since deleted", async (v, enquiryId) => {
      await booking(v, enquiryId, await deletedEvent(v), { status: "cancelled" });
    }, 0],
    ["nothing but a deleted hold, in a live event", async (v, enquiryId) => {
      await booking(v, enquiryId, await event(v.venueId), { deleted: true });
    }, 0],
    ["nothing but a deleted deal", async (v, enquiryId) => {
      await pool.query("UPDATE opportunities SET deleted_at = now() WHERE id = $1", [await deal(v.venueId, "lost", enquiryId)]);
    }, 0],
  ];

  it.each(WORK_CASES)("counts an open enquiry worked by %s", async (label, arrange, expected) => {
    const v = await venue(`worked by ${label}`);
    await arrange(v, await enquiry(v.venueId, "submitted"));
    expect(await readSpineInvariant(db, v.venueId)).toEqual({ ...ALL_ZERO, workedEnquiriesWithoutEvent: expected });
  });

  it("does not count a deal or a proposal on another event than its enquiry's", async () => {
    const v = await venue("other events than the enquiry's");
    const enquiryId = await repliedEnquiry(v.venueId);
    await link("enquiries", enquiryId, await event(v.venueId, "The enquiry's"));
    const dealId = await deal(v.venueId, "qualified", enquiryId);
    const dealEvent = await event(v.venueId, "The deal's");
    await link("opportunities", dealId, dealEvent);
    await link("proposals", await proposal(v.venueId, "sent", { opportunityId: dealId, enquiryId }), dealEvent);
    await link("proposals", await proposal(v.venueId, "sent", { enquiryId }), await event(v.venueId, "The proposal's"));
    expect(await readSpineInvariant(db, v.venueId)).toEqual(ALL_ZERO);
  });

  it("does not count a proposal against another venue's deal", async () => {
    // A proposal naming another venue's deal is a tenancy fault of its own, outside this count.
    const here = await venue("proposal here"), there = await venue("deal there");
    const theirDeal = await deal(there.venueId, "qualified");
    await link("opportunities", theirDeal, await event(there.venueId, "Theirs"));
    await link("proposals", await proposal(here.venueId, "sent", { opportunityId: theirDeal }), await event(here.venueId, "Ours"));
    expect(await readSpineInvariant(db, here.venueId)).toEqual(ALL_ZERO);
  });

  it("counts an event with two open deals, seen with the one-open-deal index dropped inside a transaction rolled back", async () => {
    const v = await venue("two open deals, index dropped");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP INDEX opportunities_one_open_per_event");
      const [made] = (await client.query<{ id: string }>(
        "INSERT INTO events (venue_id, name, status) VALUES ($1, 'Two deals', 'draft') RETURNING id", [v.venueId])).rows;
      if (made === undefined) throw new Error("The fixture wrote no event");
      await client.query(`INSERT INTO opportunities (venue_id, title, stage, event_id)
        VALUES ($1, 'First open deal', 'new', $2), ($1, 'Second open deal', 'qualified', $2)`, [v.venueId, made.id]);
      expect(await readSpineInvariant(drizzle(client), v.venueId)).toEqual({ ...ALL_ZERO, eventsWithTwoOpenDeals: 1 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const indexes = (await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'opportunities' AND indexname = 'opportunities_one_open_per_event'")).rows;
    expect(indexes).toEqual([{ indexname: "opportunities_one_open_per_event" }]);
    expect(await readSpineInvariant(db, v.venueId)).toEqual(ALL_ZERO);
  });

  it("the join's four lists, as the database holds them, are the definition's", async () => {
    // spine_join_old_records() carries its own copy of the definition's lists,
    // frozen when a migration wrote it, while the count reads them from
    // @omnitwin/types as values. Read from the database, never from the file:
    // when a migration replaces the function, this reads the replacement.
    const [fn] = (await pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE proname = 'spine_join_old_records'")).rows;
    if (fn === undefined) throw new Error("spine_join_old_records() is missing from the database");
    const frozen = new Map<string, readonly string[]>();
    for (const match of fn.prosrc.matchAll(/(\w+)\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/gu)) {
      const [, name, items] = match;
      if (name === undefined || items === undefined) continue;
      frozen.set(name, [...items.matchAll(/'([^']*)'/gu)].map((item) => item[1] ?? ""));
    }
    const definition: Record<string, readonly string[]> = {
      open_deal_stages: OPEN_OPPORTUNITY_STAGES,
      sent_proposal_statuses: SENT_PROPOSAL_STATUSES,
      closed_enquiry_states: CLOSED_ENQUIRY_STATES,
      non_booking_enquiry_types: NON_BOOKING_ENQUIRY_TYPES,
    };
    const asSet = (values: readonly string[]): string[] => [...new Set(values)].sort();
    for (const [name, values] of Object.entries(definition)) {
      const held = frozen.get(name);
      expect(held, `spine_join_old_records() no longer declares ${name}; a migration that replaces the function must keep its four lists`).toBeDefined();
      expect(asSet(held ?? []),
        `spine_join_old_records()'s ${name} differs from the definition in @omnitwin/types. `
        + "The join's lists are frozen in the database: a change to the definition needs a migration that replaces "
        + "spine_join_old_records() with the new list, in the same change.",
      ).toEqual(asSet(values));
    }
  });

  it("the one-open-deal index's closed stages, as the database holds them, are the definition's", async () => {
    // opportunities_one_open_per_event writes the closed stages out by hand
    // (NOT IN, which PostgreSQL keeps as <> ALL (ARRAY[...])). Read from the
    // database, so a migration that replaces the index is read too.
    const [index] = (await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'opportunities_one_open_per_event'")).rows;
    if (index === undefined) throw new Error("opportunities_one_open_per_event is missing from the database");
    const list = /\(stage\)::text <> ALL \(\(ARRAY\[([^\]]*)\]\)/u.exec(index.indexdef)?.[1]
      ?? /stage"? NOT IN \(([^)]*)\)/u.exec(index.indexdef)?.[1];
    const held = [...(list ?? "").matchAll(/'([^']*)'/gu)].map((item) => item[1] ?? "");
    expect(held.length, `no list of stages could be read from: ${index.indexdef}`).toBeGreaterThan(0);
    const asSet = (values: readonly string[]): string[] => [...new Set(values)].sort();
    expect(asSet(held),
      "opportunities_one_open_per_event's stages differ from CLOSED_OPPORTUNITY_STAGES in @omnitwin/types. "
      + "A change to the closed stages needs a migration that rebuilds the index with the new list, in the same change.",
    ).toEqual(asSet(CLOSED_OPPORTUNITY_STAGES));
  });

  it("reads every venue when none is named", async () => {
    const one = await venue("everywhere one"), two = await venue("everywhere two");
    await proposal(one.venueId, "sent");
    await proposal(two.venueId, "sent");
    const here = await readSpineInvariant(db, one.venueId);
    const everywhere = await readSpineInvariant(db);
    expect(here.proposalsWithoutEvent).toBe(1);
    expect(everywhere.proposalsWithoutEvent).toBeGreaterThanOrEqual(2);
    for (const field of SPINE_INVARIANT_FIELDS) {
      expect(everywhere[field]).toBeGreaterThanOrEqual(here[field]);
    }
  });
});

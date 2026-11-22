import { sql, type SQL } from "drizzle-orm";
import {
  CLOSED_ENQUIRY_STATES,
  NON_BOOKING_ENQUIRY_TYPES,
  OPEN_OPPORTUNITY_STAGES,
  SENT_PROPOSAL_STATUSES,
} from "@omnitwin/types";
import { sqlList, type InvariantReader } from "./event-binding.js";

// ---------------------------------------------------------------------------
// The spine's count (stage 1, the links): nine numbers that must all read
// zero once every proposal, deal and enquiry that must have an event has one.
// Read-only: one statement, nine numbers from thirteen sub-selects, each scoped to one venue when a
// venue is named.
//
// It is the definition in @omnitwin/types (event-spine.ts) in SQL, and it
// agrees with the join of old records (spine_join_old_records, migration
// *_event_spine_links): a record the join rightly leaves alone is not
// counted, and one it should join is, but for the deposit-request rule below.
// The definition's sets are passed in as
// values, never retyped, so the count and the rule cannot drift apart.
//
//   proposalsWithoutEvent        undeleted proposals with no event that must
//                                have one (proposalMustHaveEvent)
//   agreementsWithoutEvent       agreements (proposal_contract_versions) whose
//                                undeleted proposal has no event
//   depositRequestsWithoutEvent  deposit requests in force with no event
//   openDealsWithoutEvent        undeleted deals at an open stage with no event
//   workedEnquiriesWithoutEvent  enquiries with no event that must have one
//                                (enquiryMustHaveEvent)
//   eventsWithTwoOpenDeals       events with more than one undeleted open deal
//   disagreeingLinks             an undeleted proposal and its undeleted deal
//                                of the same venue on two events, both set; and
//                                a deposit request in force and its proposal on
//                                two events, both set. A deal or proposal on
//                                another event than its enquiry's is not one.
//   linksToClosedEvents          records counted as needing an event above
//                                (proposals, deposit requests, deals,
//                                enquiries) whose event is deleted
//   eventDealPointersInUse       events naming a deal (events.opportunity_id)
//
// A deposit request in force is counted in its own right, in all three
// places, whatever became of its proposal: the later rule that a request in
// force must have an event reads the request's own row, so a deleted proposal
// must not hide one.
//
// Every listed record (on the list of joins to check) that must have an
// event, and every record waiting on one, is counted. A listed record that
// need not have an event (an unworked enquiry whose floor plan reaches
// several events, say), and October's copied questions, are not.
// ---------------------------------------------------------------------------

/**
 * What JavaScript's String.prototype.trim() removes (its WhiteSpace and
 * LineTerminator characters), so btrim(x, JS_WHITESPACE) in SQL is x.trim(),
 * as isBookingEnquiry trims an enquiry's type. The join declares the same set
 * as js_whitespace.
 */
export const JS_WHITESPACE = [
  "\u0009", "\u000A", "\u000B", "\u000C", "\u000D", "\u0020", "\u00A0", "\u1680",
  "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200A",
  "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF",
].join("");

export interface SpineInvariant {
  readonly proposalsWithoutEvent: number;
  readonly agreementsWithoutEvent: number;
  readonly depositRequestsWithoutEvent: number;
  readonly openDealsWithoutEvent: number;
  readonly workedEnquiriesWithoutEvent: number;
  readonly eventsWithTwoOpenDeals: number;
  readonly disagreeingLinks: number;
  readonly linksToClosedEvents: number;
  readonly eventDealPointersInUse: number;
}

function countFrom(value: unknown, label: string): number {
  const count = typeof value === "string" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`The spine invariant returned no ${label} count`);
  }
  return count;
}

/** Each field of SpineInvariant named once: the compiler refuses a field left out, one too many, or a misspelling. */
const FIELD_NAMES: { readonly [Field in keyof SpineInvariant]: Field } = {
  proposalsWithoutEvent: "proposalsWithoutEvent",
  agreementsWithoutEvent: "agreementsWithoutEvent",
  depositRequestsWithoutEvent: "depositRequestsWithoutEvent",
  openDealsWithoutEvent: "openDealsWithoutEvent",
  workedEnquiriesWithoutEvent: "workedEnquiriesWithoutEvent",
  eventsWithTwoOpenDeals: "eventsWithTwoOpenDeals",
  disagreeingLinks: "disagreeingLinks",
  linksToClosedEvents: "linksToClosedEvents",
  eventDealPointersInUse: "eventDealPointersInUse",
};

/** The nine fields of the count. */
export const SPINE_INVARIANT_FIELDS: readonly (keyof SpineInvariant)[] = Object.values(FIELD_NAMES);

/** True when every one of the nine numbers is zero; any other key of a wider report is not judged. */
export function spineInvariantHolds(counts: SpineInvariant): boolean {
  return SPINE_INVARIANT_FIELDS.every((field) => counts[field] === 0);
}

export async function readSpineInvariant(conn: InvariantReader, venueId: string | null = null): Promise<SpineInvariant> {
  const inVenue = (column: SQL): SQL => (venueId === null ? sql`true` : sql`${column} = ${venueId}`);

  // (proposalMustHaveEvent, of proposal p) undeleted; and sent, or with an
  // agreement, or with a deposit request in force, or a draft for a deal or
  // an enquiry.
  const proposalMustHave = sql`p.deleted_at IS NULL AND (
    p.status IN (${sqlList(SENT_PROPOSAL_STATUSES)})
    OR EXISTS (SELECT 1 FROM proposal_contract_versions a WHERE a.proposal_id = p.id)
    OR EXISTS (SELECT 1 FROM proposal_deposit_requests d WHERE d.proposal_id = p.id AND d.cancelled_at IS NULL)
    OR (p.status = 'draft' AND (p.opportunity_id IS NOT NULL OR p.enquiry_id IS NOT NULL)))`;

  // (dealMustHaveEvent, of deal o) undeleted, at an open stage.
  const dealMustHave = sql`o.deleted_at IS NULL AND o.stage IN (${sqlList(OPEN_OPPORTUNITY_STAGES)})`;

  // (enquiryMustHaveEvent, of enquiry q) it may become an event: not a
  // draft, and its type, trimmed as JavaScript trims, asks to book (no type
  // at all does). Then a child has an event: a live event at its own venue
  // that an undeleted booking, deal or proposal of it sits in. Or it is open
  // and worked: a first reply; a live hold, booking or viewing; an undeleted
  // deal, proposal or quote. The same rules as the join's, as written there.
  const enquiryMustHave = sql`q.state <> 'draft'
    AND (q.event_type IS NULL OR btrim(q.event_type, ${JS_WHITESPACE}::text) NOT IN (${sqlList(NON_BOOKING_ENQUIRY_TYPES)}))
    AND (
      EXISTS (SELECT 1 FROM bookings b JOIN events e ON e.id = b.event_id
        WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL AND e.venue_id = q.venue_id AND e.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM opportunities o JOIN events e ON e.id = o.event_id
        WHERE o.source_enquiry_id = q.id AND o.deleted_at IS NULL AND e.venue_id = q.venue_id AND e.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM proposals p JOIN events e ON e.id = p.event_id
        WHERE p.enquiry_id = q.id AND p.deleted_at IS NULL AND e.venue_id = q.venue_id AND e.deleted_at IS NULL)
      OR (q.state NOT IN (${sqlList(CLOSED_ENQUIRY_STATES)}) AND (
        q.first_response_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM bookings b WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL
          AND b.status = 'active' AND b.kind IN ('hold', 'ink', 'viewing'))
        OR EXISTS (SELECT 1 FROM opportunities o WHERE o.source_enquiry_id = q.id AND o.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM proposals p WHERE p.enquiry_id = q.id AND p.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM quotes t WHERE t.enquiry_id = q.id AND t.deleted_at IS NULL))))`;

  const result = await conn.execute(sql`
    SELECT
      (SELECT count(*) FROM proposals p
        WHERE p.event_id IS NULL AND ${proposalMustHave} AND ${inVenue(sql`p.venue_id`)})::text AS proposals_without_event,
      (SELECT count(*) FROM proposal_contract_versions c JOIN proposals p ON p.id = c.proposal_id
        WHERE p.deleted_at IS NULL AND p.event_id IS NULL AND ${inVenue(sql`p.venue_id`)})::text AS agreements_without_event,
      (SELECT count(*) FROM proposal_deposit_requests r
        WHERE r.cancelled_at IS NULL AND r.event_id IS NULL AND ${inVenue(sql`r.venue_id`)})::text AS deposit_requests_without_event,
      (SELECT count(*) FROM opportunities o
        WHERE o.event_id IS NULL AND ${dealMustHave} AND ${inVenue(sql`o.venue_id`)})::text AS open_deals_without_event,
      (SELECT count(*) FROM enquiries q
        WHERE q.event_id IS NULL AND ${enquiryMustHave} AND ${inVenue(sql`q.venue_id`)})::text AS worked_enquiries_without_event,
      (SELECT count(*) FROM (
        SELECT o.event_id FROM opportunities o
        WHERE o.event_id IS NOT NULL AND ${dealMustHave} AND ${inVenue(sql`o.venue_id`)}
        GROUP BY o.event_id HAVING count(*) > 1
      ) t)::text AS events_with_two_open_deals,
      ((SELECT count(*) FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id AND o.venue_id = p.venue_id
          WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL
            AND p.event_id IS NOT NULL AND o.event_id IS NOT NULL AND p.event_id <> o.event_id
            AND ${inVenue(sql`p.venue_id`)})
        + (SELECT count(*) FROM proposal_deposit_requests r JOIN proposals p ON p.id = r.proposal_id
          WHERE r.cancelled_at IS NULL
            AND r.event_id IS NOT NULL AND p.event_id IS NOT NULL AND r.event_id <> p.event_id
            AND ${inVenue(sql`r.venue_id`)}))::text AS disagreeing_links,
      ((SELECT count(*) FROM proposals p JOIN events x ON x.id = p.event_id
          WHERE x.deleted_at IS NOT NULL AND ${proposalMustHave} AND ${inVenue(sql`p.venue_id`)})
        + (SELECT count(*) FROM proposal_deposit_requests r JOIN events x ON x.id = r.event_id
          WHERE r.cancelled_at IS NULL AND x.deleted_at IS NOT NULL AND ${inVenue(sql`r.venue_id`)})
        + (SELECT count(*) FROM opportunities o JOIN events x ON x.id = o.event_id
          WHERE x.deleted_at IS NOT NULL AND ${dealMustHave} AND ${inVenue(sql`o.venue_id`)})
        + (SELECT count(*) FROM enquiries q JOIN events x ON x.id = q.event_id
          WHERE x.deleted_at IS NOT NULL AND ${enquiryMustHave} AND ${inVenue(sql`q.venue_id`)}))::text AS links_to_closed_events,
      (SELECT count(*) FROM events x
        WHERE x.opportunity_id IS NOT NULL AND ${inVenue(sql`x.venue_id`)})::text AS event_deal_pointers_in_use
  `);
  const row = result.rows[0];
  return {
    proposalsWithoutEvent: countFrom(row?.["proposals_without_event"], "proposal without event"),
    agreementsWithoutEvent: countFrom(row?.["agreements_without_event"], "agreement without event"),
    depositRequestsWithoutEvent: countFrom(row?.["deposit_requests_without_event"], "deposit request without event"),
    openDealsWithoutEvent: countFrom(row?.["open_deals_without_event"], "open deal without event"),
    workedEnquiriesWithoutEvent: countFrom(row?.["worked_enquiries_without_event"], "worked enquiry without event"),
    eventsWithTwoOpenDeals: countFrom(row?.["events_with_two_open_deals"], "event with two open deals"),
    disagreeingLinks: countFrom(row?.["disagreeing_links"], "disagreeing link"),
    linksToClosedEvents: countFrom(row?.["links_to_closed_events"], "link to a closed event"),
    eventDealPointersInUse: countFrom(row?.["event_deal_pointers_in_use"], "event deal pointer"),
  };
}

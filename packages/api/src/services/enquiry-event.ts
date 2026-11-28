import { and, eq, isNull } from "drizzle-orm";
import {
  CLOSED_ENQUIRY_STATES,
  EnquiryStatusSchema,
  enquiryMayBecomeEvent,
  holdsEmailAddress,
  occasionLabel,
} from "@omnitwin/types";
import { enquiries, events } from "../db/schema.js";
import {
  createEventFor,
  readEnquiryReach,
  setEnquiryEvent,
  titleWithoutEnquiryEmail,
  type BindConn,
  type EnquiryReach,
} from "./event-binding.js";

// ---------------------------------------------------------------------------
// The enquiry's event (the spine, part two). An enquiry gets its event the
// moment someone first works it: a reply that is not a turn-down, an
// approval, a viewing, a price; or when its team opens it as an event on
// purpose (POST /enquiries/:id/event). Each of those acts calls
// ensureEnquiryEvent inside the transaction that records it. A hold still
// gets its event through the bind (services/event-binding.ts), which joins
// the enquiry's own event first.
//
// It decides as step 1 of the join of old records decides
// (spine_join_old_records, the spine's links migration), case by case in the
// join's order, so the writer and the nightly join never disagree (but for
// the two departures below):
//   - the enquiry's own link, when it names a live event of its venue;
//   - else what of its own reaches a live event (readEnquiryReach): its held
//     dates, deals and proposals (M); its floor plan, with what its proposals
//     with no event reach (B). M holding more than one event, or one event
//     while B holds another, is several; M's one event is its event; else B
//     holding more than one is several, and B's one event is its event;
//   - else, nothing reaching any event, a new event for an open enquiry;
//     a closed one (CLOSED_ENQUIRY_STATES) gets none, as the join's step 1
//     makes none. (The join's steps 2 and 3 can still give a closed enquiry
//     an event, made for an open deal or a proposal of its own that has
//     none; the writer leaves that to the join, so it never makes what the
//     join would not.)
//     (A new open deal made from a closed enquiry is the one exception: the
//     join's step 2 makes the event for the enquiry and the deal together,
//     and so does eventForNewDeal in services/event-links.ts, which shares
//     eventReached and makeEnquiryEvent below.)
// It never chooses among several events and never makes one while something
// of the enquiry's own reaches one: the link stays as it was and the join
// lists the enquiry for a person. Joining is never a guess.
//
// It departs from the join twice, in which enquiries it decides:
//   (i) Unlike the join, it does not skip an enquiry already on the join's
//       list of joins to check: it decides on today's data, by the rules
//       above, and the join's step 0 then closes that question as joined. So
//       any later route that answers such a question must read the enquiry's
//       link again under the enquiry's lock, never trust the question row.
//   (ii) A link that names a soft-deleted event is treated as no link, as the
//       bind treats it: the enquiry is decided afresh and the link moves. The
//       join never reads such an enquiry (it reads only an empty link).
//
// An event made here is a draft with no dates and no guests, named as the
// enquiry's first hold would be titled (enquiryEventNaming; the join names
// one by the person's name alone), with the enquiry's occasion and fixture
// marker, and the house's default phases (createEventFor).
// ---------------------------------------------------------------------------

/** Why an enquiry has no event from this call. */
export type EnquiryEventRefusal =
  | "ENQUIRY_NOT_FOUND"
  | "ENQUIRY_NOT_SENT"
  | "NOT_A_BOOKING_ENQUIRY"
  | "ENQUIRY_CLOSED"
  | "ENQUIRY_REACHES_SEVERAL_EVENTS";

export type EnquiryEventOutcome =
  | { readonly ok: true; readonly eventId: string; readonly created: boolean }
  | { readonly ok: false; readonly code: EnquiryEventRefusal };

/** Booking titles are at most 200 characters and never empty (booking.ts). */
const BOOKING_TITLE_LENGTH = 200;

const CLOSED_STATES: ReadonlySet<string> = new Set(CLOSED_ENQUIRY_STATES);

/** Who a hold made from an enquiry is titled after: the enquiry's name, or
 *  its email when the name is blank. Public enquiries stored before
 *  GuestEnquirySchema treated a blank name as no name can hold "" here, and
 *  an empty title fails every Diary read for the venue. */
export function enquiryTitleName(enquiry: { readonly name: string; readonly email: string }): string {
  const name = enquiry.name.trim();
  return name === "" ? enquiry.email.trim() : name;
}

/**
 * The title and client name an enquiry gives its first hold and its event,
 * as the hold route works them out (POST /bookings/from-enquiry): the title
 * is "<who> — <occasion>" cut to a booking title's length; the client name is
 * the enquiry's name, or none when that is an email address (a guest who gave
 * no name is filed under their email, and a name can hold another address).
 */
export function enquiryEventNaming(enquiry: {
  readonly name: string;
  readonly email: string;
  readonly eventType: string | null;
}): { readonly title: string; readonly clientName: string | null } {
  const occasion = occasionLabel(enquiry.eventType);
  const who = enquiryTitleName(enquiry);
  const title = `${who}${occasion === null ? "" : ` — ${occasion}`}`.slice(0, BOOKING_TITLE_LENGTH);
  const clientName = holdsEmailAddress(who) || who.toLowerCase() === enquiry.email.trim().toLowerCase() ? null : enquiry.name;
  return { title, clientName };
}

/** What an enquiry's own records reach (eventReached). */
export type EnquiryReachDecision =
  /** One live event: the enquiry joins it. */
  | { readonly kind: "one"; readonly eventId: string }
  /** Several, or paths that disagree: a person chooses (the join lists it). */
  | { readonly kind: "several" }
  /** Nothing reaches any event. */
  | { readonly kind: "none" };

const SEVERAL: EnquiryReachDecision = { kind: "several" };

/**
 * Step 1 of the join for an enquiry with no live link, in the join's order:
 * which event, if any, its own records reach. Whether a new event is made
 * when none is reached is each caller's rule: here, only for an open
 * enquiry; for an enquiry a new open deal is made from (eventForNewDeal in
 * services/event-links.ts), always, as the join's step 2 makes one.
 */
export function eventReached(reach: EnquiryReach): EnquiryReachDecision {
  // Its floor plan and what its proposals with no event reach, together (the join's B with P).
  const besides = [...new Set([...reach.plan, ...reach.proposals])];
  const [held] = reach.held;
  // The join's reaches_many_events, then its paths_disagree.
  if (reach.held.length > 1) return SEVERAL;
  if (held !== undefined) return besides.some((id) => id !== held) ? SEVERAL : { kind: "one", eventId: held };
  const [reached] = besides;
  if (besides.length > 1) return SEVERAL;
  if (reached !== undefined) return { kind: "one", eventId: reached };
  return { kind: "none" };
}

/** What an event made for an enquiry is made from. */
export interface EnquiryForEvent {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly email: string;
  readonly eventType: string | null;
  readonly fixtureSource: string | null;
}

/**
 * A new event for the enquiry, and the enquiry's link to it: named as its
 * first hold would be titled (enquiryEventNaming), with its occasion and
 * fixture marker, and the house's default phases (createEventFor). Call with
 * the enquiry row locked, once nothing of its own reaches an event.
 */
export async function makeEnquiryEvent(conn: BindConn, enquiry: EnquiryForEvent, byUserId: string | null): Promise<string> {
  const naming = enquiryEventNaming(enquiry);
  const eventId = await createEventFor(conn, {
    venueId: enquiry.venueId,
    // A title that is only the enquiry's email cut short names nothing (eventNameFor sees any other address).
    title: titleWithoutEnquiryEmail(naming.title, enquiry.email),
    eventType: enquiry.eventType,
    startsAt: null,
    endsAt: null,
    createdBy: byUserId,
    clientName: naming.clientName,
    fixtureSource: enquiry.fixtureSource,
  });
  await setEnquiryEvent(conn, enquiry.id, eventId);
  return eventId;
}

/**
 * The enquiry's event: its own, the one its records already reach, or a new
 * one (above). The only way an enquiry is given its event outside a hold.
 * Locks the enquiry row FOR NO KEY UPDATE (a re-lock when the caller's
 * transaction already holds it), then reads plainly under that lock and
 * writes the link, making the event first when it makes one. Call inside the
 * transaction that records the act, before any insert in it that references
 * the enquiry. A refusal writes nothing.
 */
export async function ensureEnquiryEvent(conn: BindConn, enquiryId: string, byUserId: string | null): Promise<EnquiryEventOutcome> {
  const [enquiry] = await conn.select({
    id: enquiries.id,
    venueId: enquiries.venueId,
    state: enquiries.state,
    name: enquiries.name,
    email: enquiries.email,
    eventType: enquiries.eventType,
    eventId: enquiries.eventId,
    configurationId: enquiries.configurationId,
    fixtureSource: enquiries.fixtureSource,
  })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
    .for("no key update");
  if (enquiry === undefined) return { ok: false, code: "ENQUIRY_NOT_FOUND" };
  const state = EnquiryStatusSchema.parse(enquiry.state);
  if (state === "draft") return { ok: false, code: "ENQUIRY_NOT_SENT" };
  if (!enquiryMayBecomeEvent({ state, eventType: enquiry.eventType })) return { ok: false, code: "NOT_A_BOOKING_ENQUIRY" };

  if (enquiry.eventId !== null) {
    const [own] = await conn.select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, enquiry.eventId), eq(events.venueId, enquiry.venueId), isNull(events.deletedAt)))
      .limit(1);
    if (own !== undefined) return { ok: true, eventId: own.id, created: false };
  }

  const reached = eventReached(await readEnquiryReach(conn, enquiry));
  if (reached.kind === "several") return { ok: false, code: "ENQUIRY_REACHES_SEVERAL_EVENTS" };
  if (reached.kind === "one") {
    await setEnquiryEvent(conn, enquiry.id, reached.eventId);
    return { ok: true, eventId: reached.eventId, created: false };
  }
  // Nothing reaches any event: a closed enquiry gets none, as the join's step 1 makes none.
  if (CLOSED_STATES.has(state)) return { ok: false, code: "ENQUIRY_CLOSED" };
  return { ok: true, eventId: await makeEnquiryEvent(conn, enquiry, byUserId), created: true };
}

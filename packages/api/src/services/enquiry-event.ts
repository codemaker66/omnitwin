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
// It decides exactly as step 1 of the join of old records decides
// (spine_join_old_records, the spine's links migration), case by case in the
// join's order, so the writer and the nightly join never disagree:
//   - the enquiry's own link, when it names a live event of its venue;
//   - else what of its own reaches a live event (readEnquiryReach): its held
//     dates, deals and proposals (M) and its floor plan (B). M holding more
//     than one event, or one event while B holds another, is several; M's one
//     event is its event; else B holding more than one is several, and B's
//     one event is its event;
//   - else, nothing reaching any event, a new event for an open enquiry;
//     a closed one (CLOSED_ENQUIRY_STATES) gets none, as the join makes none.
// It never chooses among several events and never makes one while something
// of the enquiry's own reaches one: the link stays as it was and the join
// lists the enquiry for a person. Joining is never a guess.
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

type Decision =
  | { readonly kind: "join"; readonly eventId: string }
  | { readonly kind: "make" }
  | { readonly kind: "refuse"; readonly code: "ENQUIRY_REACHES_SEVERAL_EVENTS" | "ENQUIRY_CLOSED" };

const SEVERAL: Decision = { kind: "refuse", code: "ENQUIRY_REACHES_SEVERAL_EVENTS" };

/** Step 1 of the join for an enquiry with no live link, in the join's order. */
function decide(reach: EnquiryReach, open: boolean): Decision {
  const [held] = reach.held;
  // The join's reaches_many_events, then its paths_disagree.
  if (reach.held.length > 1) return SEVERAL;
  if (held !== undefined) return reach.plan.some((id) => id !== held) ? SEVERAL : { kind: "join", eventId: held };
  const [planned] = reach.plan;
  if (reach.plan.length > 1) return SEVERAL;
  if (planned !== undefined) return { kind: "join", eventId: planned };
  return open ? { kind: "make" } : { kind: "refuse", code: "ENQUIRY_CLOSED" };
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

  const decision = decide(await readEnquiryReach(conn, enquiry), !CLOSED_STATES.has(state));
  if (decision.kind === "refuse") return { ok: false, code: decision.code };
  if (decision.kind === "join") {
    await setEnquiryEvent(conn, enquiry.id, decision.eventId);
    return { ok: true, eventId: decision.eventId, created: false };
  }
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
  return { ok: true, eventId, created: true };
}

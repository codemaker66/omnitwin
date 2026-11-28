import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { EnquiryStatusSchema, OPEN_OPPORTUNITY_STAGES, enquiryMayBecomeEvent } from "@omnitwin/types";
import { enquiries, events, opportunities } from "../db/schema.js";
import { sqlStateOf } from "../utils/sql-state.js";
import { enquiryEventNaming, eventReached, makeEnquiryEvent, type EnquiryForEvent } from "./enquiry-event.js";
import {
  createEventFor,
  enquiryReachesAnotherEvent,
  readEnquiryReach,
  setEnquiryEvent,
  type BindConn,
} from "./event-binding.js";

// ---------------------------------------------------------------------------
// A deal's event (the spine, part two). A new deal takes its event in the
// transaction that makes it (POST /crm/from-enquiry/:id, POST /opportunities),
// so the nightly join of old records no longer has new deals to join.
//
// eventForNewDeal decides as step 2 of the join (spine_join_old_records, the
// spine's links migration, its deal loop) decides an open deal with no event,
// in the join's order:
//   - its enquiry (of the deal's venue) is joined to a live event: that
//     event, unless an open deal is already on it (the join lists the deal
//     as a second open deal; the writer refuses, EVENT_HAS_OPEN_DEAL);
//   - its enquiry has no link and may become an event (enquiryMayBecomeEvent:
//     not a draft, asks to book): the enquiry is decided first, as the join
//     makes the deal wait for its enquiry's step 1 (eventReached, on what
//     readEnquiryReach reads: its held dates, deals and proposals, its floor
//     plan, and what its proposals with no event reach). One event reached:
//     the enquiry joins it
//     and the deal takes it (with the same open-deal check). Several, or
//     paths that disagree: the deal is still made, with NO event, the
//     enquiry's link stays empty, and the join lists the enquiry for a
//     person; the deal follows the enquiry once a person has chosen. Making
//     the deal an event of its own there would make a third. Nothing reached:
//     one event is made for the enquiry and the deal together
//     (makeEnquiryEvent);
//   - otherwise (a draft, a request that books nothing, no enquiry, or an
//     enquiry whose link names a deleted event, which the join never reads
//     as having none): an event of the deal's own, named by the deal; its
//     client is the enquiry's, its occasion the deal's else the enquiry's,
//     and the enquiry gets none.
// It never chooses among several events, and never makes one while
// something of the enquiry's own already reaches one.
//
// Why a closed enquiry is treated differently here than by
// ensureEnquiryEvent (services/enquiry-event.ts): that writer makes no event
// for a closed enquiry (rejected, withdrawn, archived) that reaches none, as
// the join's step 1 makes none. But an open deal must have an event, and the
// join's step 2 does not ask the enquiry's state: it makes the event for the
// enquiry and the deal together. So a deal made from a closed enquiry gets
// that event, and so does the enquiry. The two writers share the decision of
// what the enquiry's records reach (eventReached) and the making of its
// event (makeEnquiryEvent); only the case where nothing is reached differs.
//
// Like ensureEnquiryEvent, it decides an enquiry already on the join's list
// on today's data rather than skipping it (the join's step 0 then closes the
// question), and an event it makes for the enquiry is named as
// ensureEnquiryEvent names one (makeEnquiryEvent), by the person who made
// the deal.
//
// Where a deal's enquiry links a deleted event, the two writers read that
// enquiry differently, each as its own step of the join reads it: this one
// as the deal loop does (the enquiry has a link, so the deal gets an event of
// its own and the link stays), ensureEnquiryEvent as having no link (step 1
// never reads a linked enquiry; its departure ii), so the enquiry's next
// worked act joins the deal's event, or refuses when its bookings reach
// another. Nothing soft-deletes an event today; whatever first does must
// settle both writers together.
//
// One open deal per event. The check here is a plain read; the unique index
// opportunities_one_open_per_event is the guard when two writers put an open
// deal on one event at the same moment. Its violation aborts the deal's
// transaction, so a route catches it (isOpenDealConflict) around the whole
// transaction and reads the open deal afresh (openDealOn) to name it.
//
// Locks: the enquiry is taken FOR NO KEY UPDATE (lockDealEnquiry), after the
// person, before the deal's row is written; the event is never locked here
// (the deal's insert takes its key share through the foreign key), and
// never FOR UPDATE, so the join's one bounded wait on a writer's uncommitted
// open deal stays safe. No venues row is locked.
//
// The edit (PATCH /opportunities/:id) never moves a deal's event. A deal
// that names a new enquiry gives it its event when the enquiry may become
// one and has none, unless something else of its own reaches a different
// live event: then its link is left empty for the join's list
// (enquiryFollowsDeal).
// ---------------------------------------------------------------------------

/** Where a new deal's event comes from (eventForNewDeal). */
export type DealEventOutcome =
  /** The deal's event: its enquiry's, the one its enquiry's records reach, or one made for it. */
  | { readonly ok: true; readonly eventId: string }
  /** Made with no event: its enquiry's records reach several events, and the join lists the enquiry. */
  | { readonly ok: true; readonly eventId: null; readonly waitsFor: "enquiry" }
  /** That event already has an open deal: this one is not made. */
  | { readonly ok: false; readonly code: "EVENT_HAS_OPEN_DEAL"; readonly dealId: string };

/** What a new deal brings to the choice of its event. */
export interface NewDeal {
  readonly venueId: string;
  readonly sourceEnquiryId: string | null;
  readonly title: string;
  readonly eventType: string | null;
  readonly createdBy: string | null;
}

/** The enquiry a deal names, as read under its lock. */
export interface DealEnquiry extends EnquiryForEvent {
  readonly state: string;
  readonly eventId: string | null;
  readonly configurationId: string | null;
}

/** The refusal a new deal meets when its event already has an open deal. */
export const EVENT_HAS_OPEN_DEAL = {
  status: 409,
  code: "EVENT_HAS_OPEN_DEAL",
  error: "This event already has an open deal. Close that one first, or make this deal without the enquiry.",
} as const;

/** The same refusal for a deal reopened beside another open deal on its event. */
export const REOPENED_BESIDE_OPEN_DEAL = {
  status: 409,
  code: "EVENT_HAS_OPEN_DEAL",
  error: "This deal's event already has another open deal. Close that one first.",
} as const;

/** The refusal's answer, naming the open deal. */
export function openDealAnswer(
  refusal: typeof EVENT_HAS_OPEN_DEAL | typeof REOPENED_BESIDE_OPEN_DEAL,
  dealId: string,
): { readonly error: string; readonly code: "EVENT_HAS_OPEN_DEAL"; readonly dealId: string } {
  return { error: refusal.error, code: refusal.code, dealId };
}

/**
 * Thrown inside a new deal's transaction when eventForNewDeal refuses it, so
 * nothing the transaction wrote before (a person, a household) is kept.
 * Caught outside the transaction (openDealRefusedFor).
 */
export class EventHasOpenDeal extends Error {
  readonly dealId: string;

  constructor(dealId: string) {
    super("The new deal's event already has an open deal");
    this.name = "EventHasOpenDeal";
    this.dealId = dealId;
  }
}

const OPEN_DEAL_INDEX = "opportunities_one_open_per_event";
const OPEN_DEAL_STAGES: readonly string[] = OPEN_OPPORTUNITY_STAGES;

function constraintOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("constraint" in value)) return null;
  return typeof value.constraint === "string" ? value.constraint : null;
}

/** True for the unique violation of opportunities_one_open_per_event, on the
 *  driver's error or on drizzle's wrapping of it. */
export function isOpenDealConflict(error: unknown): boolean {
  if (sqlStateOf(error) !== "23505") return false;
  return (constraintOf(error) ?? (error instanceof Error ? constraintOf(error.cause) : null)) === OPEN_DEAL_INDEX;
}

/** The undeleted open deal on the event, other than `besideDealId`, or null.
 *  A plain read: the one-open-deal index allows at most one. */
export async function openDealOn(conn: BindConn, eventId: string, besideDealId: string | null = null): Promise<string | null> {
  const [deal] = await conn.select({ id: opportunities.id })
    .from(opportunities)
    .where(and(
      eq(opportunities.eventId, eventId),
      isNull(opportunities.deletedAt),
      inArray(opportunities.stage, OPEN_DEAL_STAGES),
      besideDealId === null ? undefined : ne(opportunities.id, besideDealId),
    ))
    .limit(1);
  return deal?.id ?? null;
}

/** The other open deal on this deal's event, read afresh (after the
 *  one-open-deal index refused its write), or null. */
export async function openDealBeside(conn: BindConn, dealId: string): Promise<string | null> {
  const [deal] = await conn.select({ eventId: opportunities.eventId })
    .from(opportunities)
    .where(eq(opportunities.id, dealId))
    .limit(1);
  return deal === undefined || deal.eventId === null ? null : openDealOn(conn, deal.eventId, dealId);
}

/**
 * The open deal a new deal was refused for, read outside its rolled-back
 * transaction: the one eventForNewDeal named; or, when the one-open-deal
 * index refused the insert (another writer's open deal on the same event at
 * the same moment), the open deal on `eventId` now. Undefined when the error
 * is neither; null when the index refused it and no open deal is there now.
 */
export async function openDealRefusedFor(conn: BindConn, error: unknown, eventId: string | null): Promise<string | null | undefined> {
  if (error instanceof EventHasOpenDeal) return error.dealId;
  if (!isOpenDealConflict(error)) return undefined;
  return eventId === null ? null : openDealOn(conn, eventId);
}

/**
 * The enquiry a deal names, locked FOR NO KEY UPDATE (a re-lock when the
 * transaction already holds it) and read under that lock; undefined when it
 * is not the deal's venue's (the join then reads the deal as having none).
 * Take it after the person and before the deal's row is written.
 */
export async function lockDealEnquiry(conn: BindConn, enquiryId: string, venueId: string): Promise<DealEnquiry | undefined> {
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
    .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, venueId)))
    .limit(1)
    .for("no key update");
  return enquiry;
}

/** The one rule (enquiryMayBecomeEvent): not a draft, and asks to book. */
function mayBecomeEvent(enquiry: DealEnquiry): boolean {
  const state = EnquiryStatusSchema.safeParse(enquiry.state);
  return state.success && enquiryMayBecomeEvent({ state: state.data, eventType: enquiry.eventType });
}

async function isLiveEvent(conn: BindConn, eventId: string, venueId: string): Promise<boolean> {
  const [event] = await conn.select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.venueId, venueId), isNull(events.deletedAt)))
    .limit(1);
  return event !== undefined;
}

/** An occasion that says something, as the join's nullif(btrim(...), '') reads one. */
function statedOccasion(eventType: string | null): string | null {
  return eventType !== null && eventType.trim() !== "" ? eventType : null;
}

/** An event of the deal's own, named by the deal, as the join's step 2 makes one. */
async function eventOfItsOwn(conn: BindConn, deal: NewDeal, enquiry: DealEnquiry | undefined): Promise<string> {
  return createEventFor(conn, {
    venueId: deal.venueId,
    title: deal.title,
    eventType: statedOccasion(deal.eventType) ?? enquiry?.eventType ?? null,
    startsAt: null,
    endsAt: null,
    createdBy: deal.createdBy,
    clientName: enquiry === undefined ? null : enquiryEventNaming(enquiry).clientName,
    fixtureSource: enquiry?.fixtureSource ?? null,
  });
}

/** The event, unless another open deal is already on it. */
async function unlessOpenDeal(conn: BindConn, eventId: string): Promise<DealEventOutcome> {
  const open = await openDealOn(conn, eventId);
  return open === null ? { ok: true, eventId } : { ok: false, code: "EVENT_HAS_OPEN_DEAL", dealId: open };
}

/**
 * The event a new (open) deal belongs to, decided as the join's step 2
 * decides it (above), writing its enquiry's link when the enquiry joins or
 * gets one. A refusal writes nothing. Call inside the deal's own
 * transaction, after its person is settled and before the deal is inserted;
 * insert the deal with the outcome's eventId.
 */
export async function eventForNewDeal(conn: BindConn, deal: NewDeal): Promise<DealEventOutcome> {
  const enquiry = deal.sourceEnquiryId === null ? undefined : await lockDealEnquiry(conn, deal.sourceEnquiryId, deal.venueId);
  if (enquiry === undefined) return { ok: true, eventId: await eventOfItsOwn(conn, deal, undefined) };

  if (enquiry.eventId !== null) {
    if (await isLiveEvent(conn, enquiry.eventId, enquiry.venueId)) return unlessOpenDeal(conn, enquiry.eventId);
    // A link to a deleted event: the join reads the enquiry as having one, and gives the deal its own.
    return { ok: true, eventId: await eventOfItsOwn(conn, deal, enquiry) };
  }
  if (!mayBecomeEvent(enquiry)) return { ok: true, eventId: await eventOfItsOwn(conn, deal, enquiry) };

  const reached = eventReached(await readEnquiryReach(conn, enquiry));
  if (reached.kind === "several") return { ok: true, eventId: null, waitsFor: "enquiry" };
  if (reached.kind === "one") {
    const outcome = await unlessOpenDeal(conn, reached.eventId);
    if (outcome.ok) await setEnquiryEvent(conn, enquiry.id, reached.eventId);
    return outcome;
  }
  // Nothing reaches any event: one for the enquiry and the deal together,
  // whatever the enquiry's state; its occasion the enquiry's, else the deal's.
  const occasion = statedOccasion(enquiry.eventType) ?? deal.eventType;
  return { ok: true, eventId: await makeEnquiryEvent(conn, { ...enquiry, eventType: occasion }, deal.createdBy) };
}

/**
 * A deal's edit named this enquiry (locked by lockDealEnquiry before the
 * deal's row was written). When the enquiry may become an event and has no
 * link, it takes the deal's live event, because a child of it now has one;
 * unless something else of its own reaches a different live event, when the
 * link is left empty for the join's list. The deal's event is
 * never moved. Call after the deal's row is written, so its reach counts the
 * deal.
 */
export async function enquiryFollowsDeal(conn: BindConn, enquiry: DealEnquiry, dealEventId: string | null): Promise<void> {
  if (dealEventId === null || enquiry.eventId !== null || !mayBecomeEvent(enquiry)) return;
  if (!(await isLiveEvent(conn, dealEventId, enquiry.venueId))) return;
  if (await enquiryReachesAnotherEvent(conn, enquiry, dealEventId)) return;
  await setEnquiryEvent(conn, enquiry.id, dealEventId);
}

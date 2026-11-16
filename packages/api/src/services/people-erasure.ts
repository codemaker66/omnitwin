import { and, eq, inArray, isNotNull, isNull, max, ne, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { proposalVersionPayloadDigest, type RecordMergeSnapshot } from "@omnitwin/types";
import {
  accountMemberships,
  activities,
  bookings,
  bookingStatusHistory,
  clientAccounts,
  configurations,
  configurationSheetSnapshots,
  contactPoints,
  contacts,
  decisions,
  emailSends,
  enquiries,
  eventConfigurationLinks,
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotifications,
  eventPhases,
  events,
  generalAuditLog,
  guestLeads,
  opportunities,
  opportunityStatusHistory,
  proposalComments,
  proposalContractVersions,
  proposalDepositRequests,
  proposals,
  proposalShareTokens,
  proposalStatusHistory,
  proposalVersions,
  recordMerges,
  requests,
  threads,
} from "../db/schema.js";
import { outerColumn } from "../utils/outer-column.js";
import { lockGuestLead } from "./guest-lead-lock.js";
import { ERASED_TEXT, isAddress, mentionPatterns, namesToErase, withoutNames } from "./people-erasure-text.js";
import { liveContact, type PeopleTx } from "./people-records.js";

// ---------------------------------------------------------------------------
// Erasure of one person at one venue (release audit people-privacy-5).
//
// The privacy page promises that a person can ask for their enquiry and
// contact record to be deleted, and that an enquiry which did not become a
// booking goes 24 months after our last contact, with the contact record.
// This is the one place that does it, for the erase route and the nightly
// 24-month pass alike, in the caller's transaction.
//
// What is theirs, at this venue only:
//   - the person and every record merged into them (the merge chain stays
//     inside the venue);
//   - their addresses: on their records, among their emails, and on the
//     enquiries linked to them. An address another live person at the venue
//     also holds (a couple sharing one inbox) is not theirs alone, so nothing
//     is found or deleted by it;
//   - their enquiries: linked to them, or linked to nobody and sent from an
//     address that is theirs alone. An enquiry linked to someone else is that
//     person's, whatever its address;
//   - their deals (they are the main contact, or the deal came from one of
//     their enquiries and no other live person leads it), the proposals of
//     those deals and enquiries, the events of those deals, of their
//     enquiries' bookings, of their proposals' layouts, of organisations they
//     lead and of households they belong to, and the bookings from their
//     enquiries or on those events.
// A deal made from their enquiry that another live person leads (a PA
// enquired, her director became the main contact) is that person's, with its
// proposals, the events of its deal and of its proposals' layouts (a hold
// pencilled from her enquiry onto one included), and their bookings: nothing
// of it is deleted, and only the erased person's names leave its text.
// Every one of those rows is locked before anything is decided, in the order
// the other writers take them (decisions, bookings, enquiries, deals,
// proposals, events: see around()), so a hold pencilled or a contract
// prepared at the same moment waits for the erasure or is seen by it, and
// none of them waits on it in a circle. Residues the doc names: a decision
// prepared on one of their bookings in the same moment (it takes no lock the
// erasure holds) keeps its reason.
//
// Refused, changing nothing:
//   - a confirmed booking, or a provisional one still live (the privacy
//     page's six years after the event's financial year): PERSON_HAS_BOOKING;
//   - a contract prepared or signed, or a deposit requested, on any of their
//     proposals: those records are kept with the booking's and cannot be
//     changed at all (migration 0104): PERSON_HAS_CONTRACT.
// docs/operations/erasure-requests.md says what the venue does by hand then.
//
// Otherwise:
//   - the person and their merged records are kept as rows, because history
//     points at them, with every personal field cleared and erased_at set:
//     they are never live again, and a merge involving them can no longer be
//     undone (ERASED). Their emails and phones are deleted, their membership
//     role labels cleared, and the merge snapshots that copy them lose the
//     copy;
//   - their own household (they are its only live member) keeps its row and
//     loses its name, address, notes and VAT number; a household they belong
//     to with another live member stays that member's and loses only their
//     name, and one they led passes to that member;
//   - their enquiries are deleted, with each one's status history, the
//     venue's email receipts for it and its in-app notices; the guest lead
//     goes too unless an enquiry, anywhere, still uses the address;
//   - what the client wrote on their proposals (comments, answers, the words
//     copied into the event's change feed and into notices) is deleted, the
//     name they typed to accept is cleared, and the share links stop working.
//     A comment there signed from an address another live person holds is
//     that person's: it stays, without the erased person's name. What they
//     wrote on someone else's proposal (from an address of theirs, or under
//     their name: an acceptance typed with it) is that client's record: it
//     stays, with every copy in the change feed and notices, without their
//     name and address;
//   - the rows the venue keeps as its own record of the work (deals, their
//     stage notes and activity notes, released holds and viewings in the
//     Diary with their status notes, the requests and conversations about
//     them and the reasons given for decisions on them, events, their phases,
//     acknowledgements and BEOs, layouts and the sheets issued from them,
//     proposals and every text of their versions, staff comments and status
//     notes, change feed entries and notices) keep their row and lose the person's
//     full name and addresses from their text
//     (services/people-erasure-text.ts). A first or family name alone is
//     left ("Will" and "May" are words too), and so is a full name another
//     live person at the venue also goes by. A decision's reason can only be
//     erased whole (migration 0108): on a booking pencilled from their
//     enquiries it always is; on their other bookings, and on another
//     person's deal made from their enquiry, when it names them.
// Other venues' records of the same person are theirs to erase: nothing here
// crosses the venue, except the guest lead, which has no venue.
// ---------------------------------------------------------------------------

export const ERASED_NAME = ERASED_TEXT;

/** Where the in-app notice of a public enquiry takes the reader. */
const ENQUIRY_NOTICE_PATH = "/dashboard?view=enquiries";

export type ErasureRefusal = "has_booking" | "has_contract";

/** What leaves with a set of enquiries, for a person or on their own. */
export interface RemovedCounts {
  readonly enquiries: number;
  readonly guestLeads: number;
  readonly emailReceipts: number;
  /** What the client wrote on the proposals: comments and answers. */
  readonly comments: number;
  /** Copies of those words in the event's change feed. */
  readonly changeCopies: number;
  /** In-app notices about the enquiries and the proposals. */
  readonly notices: number;
  /** Proposals whose accepted name was cleared or whose title named them. */
  readonly proposals: number;
  /** Kept rows whose text named them: deals, activity notes, Diary bookings,
   *  events, staff comments and notes, change feed entries, notices. */
  readonly reworded: number;
}

export interface ErasureCounts extends RemovedCounts {
  /** The person and the records merged into them. */
  readonly people: number;
  readonly contactPoints: number;
  readonly mergeSnapshots: number;
  readonly households: number;
}

type ContactRow = typeof contacts.$inferSelect;

/** The fields of an enquiry this module reads. */
export interface EnquiryRef {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly email: string;
  readonly guestName: string | null;
  readonly guestEmail: string | null;
  readonly createdAt: Date;
  /** The layout the guest drew with the enquiry, if any. */
  readonly configurationId: string | null;
  readonly guestPhone: string | null;
}

export const ENQUIRY_FIELDS = {
  id: enquiries.id,
  venueId: enquiries.venueId,
  name: enquiries.name,
  email: enquiries.email,
  guestName: enquiries.guestName,
  guestEmail: enquiries.guestEmail,
  createdAt: enquiries.createdAt,
  configurationId: enquiries.configurationId,
  guestPhone: enquiries.guestPhone,
} as const;

/** Deals, proposals, events and bookings. */
export interface WorkRecords {
  readonly dealIds: readonly string[];
  readonly proposalIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly bookingIds: readonly string[];
}

/** Everything that is theirs at the venue, found and locked. */
export interface ErasureRecords extends WorkRecords {
  readonly venueId: string;
  /** The person and every record merged into them; none for a lone enquiry,
   *  or for the enquiries of a person the venue keeps. */
  readonly ids: readonly string[];
  /** Whose own words on these proposals go with them: the person erased, or
   *  the kept person whose enquiries that never became a booking go; none for
   *  a lone enquiry. An address another live person holds is theirs. */
  readonly writers: readonly string[];
  /** Their addresses, lower-cased, that no other live person at the venue holds. */
  readonly addresses: readonly string[];
  readonly enquiries: readonly EnquiryRef[];
  /** Another live person's deal made from their enquiries, with its
   *  proposals, events and bookings: only their names leave these. */
  readonly nearby: WorkRecords;
  /** Organisations they lead and households they belong to (the booking guard). */
  readonly accountIds: readonly string[];
  /** Their own households: no other live member is left. */
  readonly householdIds: readonly string[];
  /** Households another live member stays in: their name leaves its text. */
  readonly sharedHouseholdIds: readonly string[];
  /** Of those, the ones they are the main contact of, and who takes over. */
  readonly handedOver: readonly { readonly householdId: string; readonly to: string }[];
  /** The layouts of their enquiries and of the proposals around them (their
   *  own and nearby): the day-of contact and notes there name people. */
  readonly layoutIds: readonly string[];
  /** Their phone numbers, as written, to find them as a layout's day-of contact. */
  readonly phones: readonly string[];
  /** Their names and addresses, to take out of the text of kept rows; none
   *  when only lapsed enquiries of a person the venue keeps are removed. */
  readonly names: readonly string[];
}

// ---------------------------------------------------------------------------
// Small SQL helpers
// ---------------------------------------------------------------------------

/** `column IN (values)`, and false for no values (never every row). */
function among(column: SQLWrapper, values: readonly string[]): SQL {
  return values.length === 0 ? sql`false` : inArray(column, [...values]);
}

/** `column NOT IN (values)`, and true for no values. */
function notAmong(column: SQLWrapper, values: readonly string[]): SQL {
  return values.length === 0 ? sql`true` : notInArray(column, [...values]);
}

function lower(column: SQLWrapper): SQL {
  return sql`lower(${column})`;
}

/** All of the conditions (and() is only undefined with none given). */
function allOf(...conditions: SQL[]): SQL {
  return and(...conditions) ?? sql`true`;
}

/** Whether the text holds any of the ids (uuids, which need no escaping). */
function holdsAnyId(column: SQLWrapper, ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`false` : sql`${column} ~ ${ids.join("|")}`;
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** Lower-cased, trimmed, distinct email addresses. */
function addresses(values: readonly (string | null)[]): readonly string[] {
  return distinct(values.flatMap((value) => {
    const address = value?.trim().toLowerCase() ?? "";
    return address.length > 0 ? [address] : [];
  }));
}

/** The email receipts this venue sent about the enquiries: their keys end in
 *  an enquiry's id, or carry it before a recipient's (`enquiry-new:<id>:<user>`).
 *  One pattern for them all, so the table is read once. No enquiries match
 *  nothing, never every receipt. */
export function receiptsFor(enquiryIds: readonly string[]): SQL {
  return enquiryIds.length === 0
    ? sql`false`
    : sql`${emailSends.idempotencyKey} ~ ${`:(${enquiryIds.join("|")})(:|$)`}`;
}

/** A merge snapshot without the person it copied. Undo is refused for an
 *  erased person, so nothing will ever need the copy back. */
export function erasedSnapshot(snapshot: RecordMergeSnapshot): RecordMergeSnapshot {
  return {
    ...snapshot,
    person: {
      ...snapshot.person,
      name: ERASED_NAME,
      givenName: null,
      familyName: null,
      jobTitle: null,
      postalAddress: null,
      notes: null,
      roleLabel: null,
      email: null,
      phone: null,
      sourceSystem: null,
      sourceId: null,
    },
    contactPoints: [],
    memberships: snapshot.memberships.map((membership) => ({ ...membership, roleLabel: null })),
    survivorFilled: [],
  };
}

// ---------------------------------------------------------------------------
// Finding what is theirs
// ---------------------------------------------------------------------------

/** Which of the addresses another live person at the venue holds, on their
 *  record or among their emails. */
export async function heldByOthers(
  tx: PeopleTx,
  venueId: string,
  exclude: readonly string[],
  addressList: readonly string[],
): Promise<ReadonlySet<string>> {
  if (addressList.length === 0) return new Set();
  // Live only: a record deleted, merged away or erased is nobody's to share
  // an address with (a deleted duplicate must not shield the person).
  const onRecord = await tx.select({ address: sql<string>`lower(${contacts.email})` }).from(contacts).where(allOf(
    eq(contacts.venueId, venueId),
    liveContact(),
    notAmong(contacts.id, exclude),
    inArray(lower(contacts.email), [...addressList]),
  ));
  const asPoint = await tx.select({ address: sql<string>`lower(${contactPoints.value})` }).from(contactPoints)
    .innerJoin(contacts, eq(contacts.id, contactPoints.contactId))
    .where(allOf(
      eq(contactPoints.venueId, venueId),
      eq(contactPoints.kind, "email"),
      liveContact(),
      notAmong(contactPoints.contactId, exclude),
      inArray(lower(contactPoints.value), [...addressList]),
    ));
  return new Set([...onRecord, ...asPoint].map((row) => row.address));
}

/** Their phone numbers as written: on their records and among their points. */
async function phonesOf(tx: PeopleTx, ids: readonly string[], onRecords: readonly (string | null)[]): Promise<readonly string[]> {
  const points = ids.length === 0 ? [] : await tx.select({ value: contactPoints.value }).from(contactPoints)
    .where(allOf(inArray(contactPoints.contactId, [...ids]), eq(contactPoints.kind, "phone")));
  return distinct([...onRecords, ...points.map((row) => row.value)].flatMap((value) => {
    const phone = value?.trim() ?? "";
    return phone.length > 0 ? [phone] : [];
  }));
}

/** Whether two phone numbers are one, however written: their last nine
 *  digits agree ("+44 7700 900111" and "07700 900111"). */
export function samePhone(a: string, b: string): boolean {
  const tail = (value: string): string => value.replace(/\D/gu, "").slice(-9);
  const left = tail(a);
  return left.length === 9 && left === tail(b);
}

/** The full names without those another live person at the venue goes by
 *  (their record's name, or given and family name): text naming one of them
 *  is theirs too. Addresses pass through. */
export async function withoutOthersNames(
  tx: PeopleTx,
  venueId: string,
  exclude: readonly string[],
  names: readonly string[],
): Promise<readonly string[]> {
  const asked = distinct(names.filter((name) => !isAddress(name)).map((name) => name.toLowerCase()));
  if (asked.length === 0) return names;
  const recordName = sql<string>`lower(regexp_replace(btrim(${contacts.name}), '\\s+', ' ', 'g'))`;
  const fullName = sql<string | null>`lower(btrim(${contacts.givenName}) || ' ' || btrim(${contacts.familyName}))`;
  const others = await tx.select({ recordName, fullName }).from(contacts).where(allOf(
    eq(contacts.venueId, venueId),
    liveContact(),
    notAmong(contacts.id, exclude),
    or(inArray(recordName, asked), inArray(fullName, asked)) ?? sql`false`,
  ));
  const taken = new Set(others.flatMap((row) => [row.recordName, row.fullName ?? ""]));
  return names.filter((name) => isAddress(name) || !taken.has(name.toLowerCase()));
}

/** Among the accounts, the households that are theirs alone (no other live
 *  member), those another live member stays in, and those of these they are
 *  the main contact of, with who takes it over (the primary member first). */
async function ownHouseholds(
  tx: PeopleTx,
  ids: readonly string[],
  accountIds: readonly string[],
): Promise<Pick<ErasureRecords, "householdIds" | "sharedHouseholdIds" | "handedOver">> {
  const none = { householdIds: [], sharedHouseholdIds: [], handedOver: [] };
  if (accountIds.length === 0) return none;
  const households = await tx.select({ id: clientAccounts.id, primaryContactId: clientAccounts.primaryContactId })
    .from(clientAccounts)
    .where(allOf(inArray(clientAccounts.id, [...accountIds]), eq(clientAccounts.kind, "household")))
    .for("update");
  if (households.length === 0) return none;
  const theirs = new Set(ids);
  const others = await tx.select({ accountId: accountMemberships.clientAccountId, contactId: accountMemberships.contactId })
    .from(accountMemberships)
    .innerJoin(contacts, eq(contacts.id, accountMemberships.contactId))
    .where(allOf(
      inArray(accountMemberships.clientAccountId, households.map((row) => row.id)),
      liveContact(),
      notAmong(accountMemberships.contactId, ids),
    ))
    .orderBy(sql`${accountMemberships.isPrimary} desc`, accountMemberships.createdAt, accountMemberships.contactId);
  const householdIds: string[] = [];
  const sharedHouseholdIds: string[] = [];
  const handedOver: { householdId: string; to: string }[] = [];
  for (const household of households) {
    const successor = others.find((member) => member.accountId === household.id);
    if (successor === undefined) {
      householdIds.push(household.id);
      continue;
    }
    sharedHouseholdIds.push(household.id);
    if (household.primaryContactId !== null && theirs.has(household.primaryContactId)) {
      handedOver.push({ householdId: household.id, to: successor.contactId });
    }
  }
  return { householdIds, sharedHouseholdIds, handedOver };
}

type RecordsBase = Omit<ErasureRecords, keyof WorkRecords | "nearby" | "layoutIds">;

function idsOf(rows: readonly { readonly id: string | null }[]): readonly string[] {
  return distinct(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
}

/** Bookings that are theirs: on their events, or pencilled from their
 *  enquiries onto no event or onto an event that is not another live
 *  person's deal's. One rule for finding, locking and the booking guard. */
function ownBookings(enquiryIds: readonly string[], eventIds: readonly string[], nearEventIds: readonly string[]): SQL {
  return or(
    among(bookings.eventId, eventIds),
    allOf(among(bookings.enquiryId, enquiryIds), or(isNull(bookings.eventId), notAmong(bookings.eventId, nearEventIds)) ?? sql`true`),
  ) ?? sql`false`;
}

/** Locks the rows FOR UPDATE, in id order. */
async function lockRows(
  tx: PeopleTx,
  table: "decisions" | "bookings" | "enquiries" | "opportunities" | "proposals" | "events",
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(distinct(ids).slice().sort().map((id) => sql`${id}::uuid`), sql`, `);
  await tx.execute(sql`select "id" from ${sql.identifier(table)} where "id" in (${list}) order by "id" for update`);
}

/**
 * The deals, proposals, events and bookings around the enquiries and
 * accounts. Another live person's deal made from their enquiry is that
 * person's ("nearby"), with its proposals, the events of its deal and of its
 * proposals' layouts, and the bookings on them: only the names leave those.
 *
 * Everything is found first with plain reads, then locked in the order the
 * other writers take the same rows, so none of them waits on this erasure in
 * a circle: an approval locks its decision, then its booking, then the event
 * (decisions.ts); a Diary transition its booking, then the enquiry, then the
 * event (event-binding.ts); an acceptance its proposal. So: decisions, then
 * bookings, then enquiries, deals, proposals, and events last. A booking
 * written meanwhile from one of their enquiries, or onto one of their events,
 * waits on those locks or is read again after them.
 */
async function around(tx: PeopleTx, base: RecordsBase): Promise<ErasureRecords> {
  const enquiryIds = base.enquiries.map((row) => row.id);
  const deals = await tx.select({ id: opportunities.id, lead: opportunities.primaryContactId }).from(opportunities).where(allOf(
    eq(opportunities.venueId, base.venueId),
    or(among(opportunities.primaryContactId, base.ids), among(opportunities.sourceEnquiryId, enquiryIds)) ?? sql`false`,
  ));
  // Theirs: the person erased, or the kept person whose enquiries go.
  const theirs = new Set([...base.ids, ...base.writers]);
  const leads = distinct(deals.flatMap((deal) => (deal.lead === null || theirs.has(deal.lead) ? [] : [deal.lead])));
  const liveLeads = new Set(leads.length === 0 ? [] : (await tx.select({ id: contacts.id }).from(contacts)
    .where(allOf(inArray(contacts.id, [...leads]), liveContact()))).map((row) => row.id));
  const othersDeal = (lead: string | null): boolean => lead !== null && liveLeads.has(lead);
  const dealIds = deals.filter((deal) => !othersDeal(deal.lead)).map((deal) => deal.id);
  const nearDealIds = deals.filter((deal) => othersDeal(deal.lead)).map((deal) => deal.id);
  const ownDeals = new Set(dealIds);
  const onOwnDeal = (dealId: string | null): boolean => dealId === null || ownDeals.has(dealId);

  // A proposal made for a deal carries the deal's enquiry (proposal-links.ts),
  // so the deal decides whose it is.
  const proposalRows = await tx.select({ id: proposals.id, dealId: proposals.opportunityId, layoutId: proposals.configurationId })
    .from(proposals).where(allOf(
      eq(proposals.venueId, base.venueId),
      or(among(proposals.enquiryId, enquiryIds), among(proposals.opportunityId, [...dealIds, ...nearDealIds])) ?? sql`false`,
    ));
  const proposalIds = proposalRows.filter((row) => onOwnDeal(row.dealId)).map((row) => row.id);
  const nearProposalIds = proposalRows.filter((row) => !onOwnDeal(row.dealId)).map((row) => row.id);

  const evented = await tx.select({ id: events.id, dealId: events.opportunityId, accountId: events.clientAccountId }).from(events).where(allOf(
    eq(events.venueId, base.venueId),
    or(among(events.opportunityId, [...dealIds, ...nearDealIds]), among(events.clientAccountId, base.accountIds)) ?? sql`false`,
  ));
  // A proposal reaches its event through its layout, as the proposal desk
  // reads it (routes/proposals.ts): an event made by staff, or bound from a
  // hold, carries no deal, so the layout link is how it is found.
  const layoutIds = distinct([
    ...proposalRows.flatMap((row) => (row.layoutId === null ? [] : [row.layoutId])),
    ...base.enquiries.flatMap((row) => (row.configurationId === null ? [] : [row.configurationId])),
  ]);
  const laidOut = layoutIds.length === 0 ? [] : await tx.select({ id: eventConfigurationLinks.eventId, layoutId: eventConfigurationLinks.configurationId })
    .from(eventConfigurationLinks)
    .innerJoin(events, eq(events.id, eventConfigurationLinks.eventId))
    .where(allOf(inArray(eventConfigurationLinks.configurationId, layoutIds), eq(events.venueId, base.venueId)));
  const nearLayouts = new Set(proposalRows.flatMap((row) => (!onOwnDeal(row.dealId) && row.layoutId !== null ? [row.layoutId] : [])));
  const ownLaidOut = new Set(laidOut.filter((link) => !nearLayouts.has(link.layoutId)).map((link) => link.id));
  const accounts = new Set(base.accountIds);
  const ownEvent = (event: { readonly dealId: string | null; readonly accountId: string | null }): boolean =>
    (event.accountId !== null && accounts.has(event.accountId)) || onOwnDeal(event.dealId);
  // The event a hold from their enquiry was pencilled onto is theirs, unless
  // it is another live person's: their deal's, or laid out from their
  // proposal and not from one of the person's own.
  const othersEvents = new Set([
    ...evented.filter((event) => !ownEvent(event)).map((event) => event.id),
    ...laidOut.filter((link) => nearLayouts.has(link.layoutId) && !ownLaidOut.has(link.id)).map((link) => link.id),
  ]);
  const booked = await tx.selectDistinct({ id: bookings.eventId }).from(bookings)
    .where(allOf(among(bookings.enquiryId, enquiryIds), isNotNull(bookings.eventId)));
  const eventIds = idsOf([
    ...booked.filter((row) => row.id !== null && !othersEvents.has(row.id)),
    ...evented.filter(ownEvent),
    ...laidOut.filter((link) => ownLaidOut.has(link.id)),
  ]);
  const ownEvents = new Set(eventIds);
  const nearEventIds = idsOf([...evented, ...laidOut, ...booked]).filter((id) => !ownEvents.has(id));
  const ownBooking = ownBookings(enquiryIds, eventIds, nearEventIds);
  const nearBooking = among(bookings.eventId, nearEventIds);
  const bookingsFound = (await tx.select({ id: bookings.id }).from(bookings).where(or(ownBooking, nearBooking)))
    .map((row) => row.id);

  // Locked in the other writers' order (see above).
  const decided = bookingsFound.length === 0 ? [] : (await tx.select({ id: decisions.id }).from(decisions)
    .where(allOf(eq(decisions.subjectKind, "booking"), inArray(decisions.subjectId, bookingsFound)))).map((row) => row.id);
  await lockRows(tx, "decisions", decided);
  await lockRows(tx, "bookings", bookingsFound);
  await lockRows(tx, "enquiries", enquiryIds);
  await lockRows(tx, "opportunities", [...dealIds, ...nearDealIds]);
  await lockRows(tx, "proposals", proposalRows.map((row) => row.id));
  await lockRows(tx, "events", [...eventIds, ...nearEventIds]);
  // With their enquiries and events held, no booking can start from or on
  // them any more: read the bookings again, for one written in between.
  const ownBookingIds = new Set((await tx.select({ id: bookings.id }).from(bookings).where(ownBooking)).map((row) => row.id));
  const nearBookingIds = (await tx.select({ id: bookings.id }).from(bookings).where(nearBooking))
    .map((row) => row.id).filter((id) => !ownBookingIds.has(id));
  return {
    ...base,
    dealIds,
    proposalIds,
    eventIds,
    bookingIds: [...ownBookingIds],
    layoutIds,
    nearby: {
      dealIds: nearDealIds,
      proposalIds: nearProposalIds,
      eventIds: nearEventIds,
      bookingIds: nearBookingIds,
    },
  };
}

/** Everything that is theirs at the venue, locked. The caller has locked the
 *  person (`SELECT … FOR UPDATE`), who is neither merged nor erased. */
export async function findPersonRecords(tx: PeopleTx, person: ContactRow): Promise<ErasureRecords> {
  const venueId = person.venueId;
  const chain = await tx.execute<{ id: string }>(sql`
    with recursive chain(id) as (
      select ${person.id}::uuid
      union
      select merged."id" from "contacts" as merged join chain on merged."merged_into_id" = chain.id
      where merged."venue_id" = ${venueId}
    )
    select id from chain`);
  const ids = chain.rows.map((row) => row.id);
  const people = await tx.select({ name: contacts.name, givenName: contacts.givenName, familyName: contacts.familyName, email: contacts.email,
    phone: contacts.phone })
    .from(contacts).where(inArray(contacts.id, ids)).for("update");
  const points = await tx.select({ value: contactPoints.value }).from(contactPoints)
    .where(allOf(inArray(contactPoints.contactId, ids), eq(contactPoints.kind, "email")));
  const linked = await tx.select({ email: enquiries.email, guestEmail: enquiries.guestEmail }).from(enquiries)
    .where(allOf(eq(enquiries.venueId, venueId), inArray(enquiries.contactId, ids)));
  const known = addresses([
    ...people.map((row) => row.email),
    ...points.map((row) => row.value),
    ...linked.flatMap((row) => [row.email, row.guestEmail]),
  ]);
  const shared = await heldByOthers(tx, venueId, ids, known);
  const own = known.filter((address) => !shared.has(address));

  const theirEnquiries = await tx.select(ENQUIRY_FIELDS).from(enquiries).where(allOf(
    eq(enquiries.venueId, venueId),
    or(
      inArray(enquiries.contactId, ids),
      allOf(isNull(enquiries.contactId), or(among(lower(enquiries.email), own), among(lower(enquiries.guestEmail), own)) ?? sql`false`),
    ) ?? sql`false`,
  ));

  const led = await tx.select({ id: clientAccounts.id }).from(clientAccounts)
    .where(allOf(eq(clientAccounts.venueId, venueId), inArray(clientAccounts.primaryContactId, ids)));
  const households = await tx.select({ id: clientAccounts.id }).from(accountMemberships)
    .innerJoin(clientAccounts, eq(clientAccounts.id, accountMemberships.clientAccountId))
    .where(allOf(inArray(accountMemberships.contactId, ids), eq(clientAccounts.kind, "household")));
  const accountIds = distinct([...led, ...households].map((row) => row.id));

  // Their full names, in every casing written, and their own addresses
  // (people-erasure-text.ts): never a first or family name alone, nor a full
  // name another live person here also goes by.
  const names = await withoutOthersNames(tx, venueId, ids, namesToErase([
    ...people.flatMap((row) => [
      row.name,
      row.givenName !== null && row.familyName !== null ? `${row.givenName} ${row.familyName}` : null,
    ]),
    ...theirEnquiries.flatMap((row) => [row.name, row.guestName]),
    ...own,
  ].filter((name) => name === null || (name !== ERASED_NAME && !shared.has(name.trim().toLowerCase())))));

  return around(tx, {
    venueId,
    ids,
    writers: ids,
    phones: await phonesOf(tx, ids, people.map((row) => row.phone)),
    addresses: own,
    enquiries: theirEnquiries,
    accountIds,
    ...await ownHouseholds(tx, ids, accountIds),
    names,
  });
}

/**
 * One enquiry and what hangs off it, locked: a lone enquiry, or one of a
 * person the venue keeps that never became a booking. For the kept person,
 * `writers` is them (their chain): their words on its proposals go with it,
 * and nothing is reworded. Its addresses count only where no live person at
 * the venue holds them, so a kept person's guest lead stays theirs.
 */
export async function findEnquiryRecords(
  tx: PeopleTx,
  enquiry: EnquiryRef,
  options: { readonly reword: boolean; readonly writers?: readonly string[] },
): Promise<ErasureRecords> {
  const sentFrom = addresses([enquiry.email, enquiry.guestEmail]);
  const held = await heldByOthers(tx, enquiry.venueId, [], sentFrom);
  return around(tx, {
    venueId: enquiry.venueId,
    ids: [],
    writers: options.writers ?? [],
    phones: options.reword && enquiry.guestPhone !== null ? [enquiry.guestPhone] : [],
    addresses: sentFrom.filter((address) => !held.has(address)),
    enquiries: [enquiry],
    accountIds: [],
    householdIds: [],
    sharedHouseholdIds: [],
    handedOver: [],
    names: options.reword
      ? await withoutOthersNames(tx, enquiry.venueId, [], namesToErase([enquiry.name, enquiry.guestName, enquiry.email, enquiry.guestEmail]))
      : [],
  });
}

/** Why the records must be kept, or null when they can go. */
export async function keptRecord(tx: PeopleTx, records: ErasureRecords): Promise<ErasureRefusal | null> {
  const enquiryIds = records.enquiries.map((row) => row.id);
  const [booked] = await tx.select({ id: bookings.id }).from(bookings).where(allOf(
    ownBookings(enquiryIds, records.eventIds, records.nearby.eventIds),
    isNull(bookings.deletedAt),
    or(eq(bookings.kind, "ink"), allOf(eq(bookings.kind, "hold"), eq(bookings.status, "active"))) ?? sql`false`,
  )).limit(1);
  if (booked !== undefined) return "has_booking";
  const [contract] = await tx.select({ id: proposalContractVersions.id }).from(proposalContractVersions)
    .where(among(proposalContractVersions.proposalId, records.proposalIds)).limit(1);
  if (contract !== undefined) return "has_contract";
  const [deposit] = await tx.select({ id: proposalDepositRequests.id }).from(proposalDepositRequests)
    .where(or(among(proposalDepositRequests.proposalId, records.proposalIds), among(proposalDepositRequests.eventId, records.eventIds)))
    .limit(1);
  return deposit === undefined ? null : "has_contract";
}

function later(...times: readonly (Date | null | undefined)[]): Date | null {
  let latest: Date | null = null;
  for (const time of times) {
    if (time instanceof Date && (latest === null || time > latest)) latest = time;
  }
  return latest;
}

/**
 * The last time we were in touch about anything of theirs: the People Book's
 * last contact (or the record's creation), and every enquiry, deal, activity
 * note, proposal (made, changed or sent), client comment or answer, and Diary
 * booking of theirs, or of a deal made from their enquiry that another live
 * person now leads. A staff edit to the person's own record is not contact
 * and does not count.
 */
export async function lastInTouch(tx: PeopleTx, records: ErasureRecords): Promise<Date | null> {
  const enquiryIds = records.enquiries.map((row) => row.id);
  // A deal another live person leads that was made from their enquiry is
  // contact about it too: work on it keeps the enquiry and its person.
  const dealIds = [...records.dealIds, ...records.nearby.dealIds];
  const proposalIds = [...records.proposalIds, ...records.nearby.proposalIds];
  const bookingIds = [...records.bookingIds, ...records.nearby.bookingIds];
  const [person] = records.ids.length === 0 ? [] : await tx.select({ contact: max(contacts.lastContactAt), made: max(contacts.createdAt) })
    .from(contacts).where(inArray(contacts.id, [...records.ids]));
  const [asked] = enquiryIds.length === 0 ? [] : await tx.select({ made: max(enquiries.createdAt), changed: max(enquiries.updatedAt) })
    .from(enquiries).where(inArray(enquiries.id, enquiryIds));
  const [deal] = dealIds.length === 0 ? [] : await tx.select({ made: max(opportunities.createdAt), changed: max(opportunities.updatedAt) })
    .from(opportunities).where(inArray(opportunities.id, dealIds));
  const [note] = dealIds.length === 0 ? [] : await tx.select({ made: max(activities.createdAt) })
    .from(activities).where(inArray(activities.opportunityId, dealIds));
  const [proposal] = proposalIds.length === 0 ? [] : await tx.select({
    made: max(proposals.createdAt), changed: max(proposals.updatedAt), sent: max(proposals.sentAt),
  }).from(proposals).where(inArray(proposals.id, proposalIds));
  const [answer] = proposalIds.length === 0 ? [] : await tx.select({ made: max(proposalComments.createdAt) })
    .from(proposalComments).where(inArray(proposalComments.proposalId, proposalIds));
  const [booking] = bookingIds.length === 0 ? [] : await tx.select({ made: max(bookings.createdAt), changed: max(bookings.updatedAt) })
    .from(bookings).where(inArray(bookings.id, bookingIds));
  return later(
    person?.contact, person?.made, asked?.made, asked?.changed, deal?.made, deal?.changed, note?.made,
    proposal?.made, proposal?.changed, proposal?.sent, answer?.made, booking?.made, booking?.changed,
  );
}

// ---------------------------------------------------------------------------
// Taking their names out of kept text
// ---------------------------------------------------------------------------

interface Reword {
  readonly table: string;
  /** Column name → its length limit (null for text). */
  readonly columns: Readonly<Record<string, number | null>>;
  readonly where: SQL;
}

/** Rewrites the columns of each matching row without the names, row by row;
 *  returns the ids of the rows that changed. */
async function reword(tx: PeopleTx, target: Reword, names: readonly string[]): Promise<readonly string[]> {
  if (names.length === 0) return [];
  const columns = Object.keys(target.columns);
  const picked = sql.join(columns.map((column) => sql.identifier(column)), sql`, `);
  const found = await tx.execute(
    sql`select "id", ${picked} from ${sql.identifier(target.table)} where ${target.where} for update`,
  );
  const changed: string[] = [];
  for (const row of found.rows) {
    const sets: SQL[] = [];
    for (const column of columns) {
      const before = row[column];
      if (typeof before !== "string") continue;
      const after = withoutNames(before, names);
      if (after === null || after === before) continue;
      const limit = target.columns[column] ?? null;
      sets.push(sql`${sql.identifier(column)} = ${limit === null ? after : after.slice(0, limit)}`);
    }
    if (sets.length === 0) continue;
    const id = String(row["id"]);
    await tx.execute(sql`update ${sql.identifier(target.table)} set ${sql.join(sets, sql`, `)} where "id" = ${id}::uuid`);
    changed.push(id);
  }
  return changed;
}

/** The value with every string in it, at any depth, without the names; the
 *  same value when nothing changed. Keys are left as they are. */
function deepWithoutNames<T>(value: T, names: readonly string[]): T {
  if (typeof value === "string") return (withoutNames(value, names) ?? value) as T;
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    const mapped = items.map((item) => deepWithoutNames(item, names));
    return (mapped.some((item, index) => item !== items[index]) ? mapped : value) as T;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    const mapped = entries.map(([key, item]) => [key, deepWithoutNames(item, names)] as const);
    return (mapped.some(([, item], index) => item !== entries[index]?.[1]) ? Object.fromEntries(mapped) : value) as T;
  }
  return value;
}

/** Their names out of every text of each version sent (title, message,
 *  summaries, quote lines, the occasion), with the version's digest made
 *  again: the digest is the version's identity for a contract or a deposit,
 *  and neither exists on these (keptRecord refused them; withoutAgreements
 *  leaves out another person's). Returns the proposals whose versions changed. */
async function rewordVersions(tx: PeopleTx, proposalIds: readonly string[], names: readonly string[]): Promise<readonly string[]> {
  if (names.length === 0 || proposalIds.length === 0) return [];
  const versions = await tx.select({ id: proposalVersions.id, proposalId: proposalVersions.proposalId, payload: proposalVersions.payload })
    .from(proposalVersions).where(inArray(proposalVersions.proposalId, [...proposalIds])).for("update");
  const changed = new Set<string>();
  for (const version of versions) {
    const payload = deepWithoutNames(version.payload, names);
    if (payload === version.payload) continue;
    await tx.update(proposalVersions).set({ payload, sourceHash: proposalVersionPayloadDigest(payload) })
      .where(eq(proposalVersions.id, version.id));
    changed.add(version.proposalId);
  }
  return [...changed];
}

// ---------------------------------------------------------------------------
// Removing a set of enquiries and what hangs off them
// ---------------------------------------------------------------------------

/**
 * Deletes the enquiries and everything that copies what the client wrote,
 * and takes the names out of the rows the venue keeps. The caller has found
 * the records with this transaction and checked keptRecord.
 */
export async function removeEnquiryRecords(tx: PeopleTx, records: ErasureRecords): Promise<RemovedCounts> {
  const { venueId, names, nearby } = records;
  const enquiryIds = records.enquiries.map((row) => row.id);

  // What the client wrote on their proposals goes, unless it was signed with
  // an address another live person holds: that is the other person's, kept
  // without the erased person's name.
  const onTheirs = await tx.select({ id: proposalComments.id, authorEmail: proposalComments.authorEmail })
    .from(proposalComments)
    .where(allOf(among(proposalComments.proposalId, records.proposalIds), eq(proposalComments.authorType, "client")));
  const others = await heldByOthers(tx, venueId, records.writers, addresses(onTheirs.map((row) => row.authorEmail)));
  const signedByOther = (row: { readonly authorEmail: string | null }): boolean =>
    row.authorEmail !== null && others.has(row.authorEmail.trim().toLowerCase());
  const commentIds = onTheirs.filter((row) => !signedByOther(row)).map((row) => row.id);
  const othersComments = onTheirs.filter(signedByOther).map((row) => row.id);

  // What a person erased wrote on someone else's proposal is that client's
  // record (a change they asked for on a booked wedding, an acceptance a PA
  // typed for her director): it stays, without their name and address,
  // wherever it was copied. It is found by an address of theirs, or by their
  // name on the client's change in the feed.
  const erasing = records.ids.length > 0;
  const signedElsewhere = !erasing || records.addresses.length === 0 ? [] : await tx
    .select({ id: proposalComments.id, proposalId: proposalComments.proposalId })
    .from(proposalComments)
    .innerJoin(proposals, eq(proposals.id, proposalComments.proposalId))
    .where(allOf(
      eq(proposals.venueId, venueId),
      notAmong(proposals.id, records.proposalIds),
      eq(proposalComments.authorType, "client"),
      inArray(lower(proposalComments.authorEmail), [...records.addresses]),
    ));
  const labelled = !erasing || names.length === 0 ? [] : await tx
    .select({ proposalId: eventPlanChanges.proposalId, sourceKind: eventPlanChanges.sourceKind, sourceId: eventPlanChanges.sourceId,
      label: eventPlanChanges.actorLabel })
    .from(eventPlanChanges)
    .where(allOf(
      eq(eventPlanChanges.venueId, venueId),
      eq(eventPlanChanges.actorRole, "client"),
      isNotNull(eventPlanChanges.proposalId),
      notAmong(eventPlanChanges.proposalId, records.proposalIds),
      or(...mentionPatterns(names).map((pattern) => sql`lower(${eventPlanChanges.actorLabel}) like lower(${pattern})`)) ?? sql`false`,
    ));
  const answeredAsThem = labelled.filter((row) => withoutNames(row.label, names) !== row.label);
  // An answer on a proposal with no event writes no change to the feed, only
  // the team's notice: it is found by the name typed into it, as the
  // accepted name or the comment's signature (the share page sends a name
  // and no address).
  const typed = !erasing || names.length === 0 ? [] : mentionPatterns(names);
  const acceptedAs = typed.length === 0 ? [] : (await tx.select({ id: proposals.id, name: proposals.acceptedName }).from(proposals)
    .where(allOf(
      eq(proposals.venueId, venueId),
      notAmong(proposals.id, records.proposalIds),
      isNotNull(proposals.acceptedName),
      or(...typed.map((pattern) => sql`lower(${proposals.acceptedName}) like lower(${pattern})`)) ?? sql`false`,
    ))).filter((row) => withoutNames(row.name, names) !== row.name);
  const signedByName = typed.length === 0 ? [] : (await tx
    .select({ id: proposalComments.id, proposalId: proposalComments.proposalId, name: proposalComments.authorName })
    .from(proposalComments)
    .innerJoin(proposals, eq(proposals.id, proposalComments.proposalId))
    .where(allOf(
      eq(proposals.venueId, venueId),
      notAmong(proposals.id, records.proposalIds),
      eq(proposalComments.authorType, "client"),
      isNotNull(proposalComments.authorName),
      or(...typed.map((pattern) => sql`lower(${proposalComments.authorName}) like lower(${pattern})`)) ?? sql`false`,
    ))).filter((row) => withoutNames(row.name, names) !== row.name);
  const elsewhereProposalIds = distinct([
    ...signedElsewhere.map((row) => row.proposalId),
    ...answeredAsThem.flatMap((row) => (row.proposalId === null ? [] : [row.proposalId])),
    ...acceptedAs.map((row) => row.id),
    ...signedByName.map((row) => row.proposalId),
  ]);
  const signedAsThem = [
    ...answeredAsThem.flatMap((row) => (row.sourceKind === "proposal_comment" ? [row.sourceId] : [])),
    ...signedByName.map((row) => row.id),
  ];

  // Their copies in the change feed go first (each change's notices go with
  // it), then the notices of a proposal without an event.
  const changeCopies = await tx.delete(eventPlanChanges).where(allOf(
    eq(eventPlanChanges.venueId, venueId),
    or(
      allOf(eq(eventPlanChanges.sourceKind, "proposal_comment"), among(eventPlanChanges.sourceId, commentIds)),
      allOf(eq(eventPlanChanges.sourceKind, "proposal_response"), among(eventPlanChanges.sourceId, records.proposalIds)),
    ) ?? sql`false`,
  )).returning({ id: eventPlanChanges.id });
  const proposalNotices = await tx.delete(eventPlanNotifications).where(allOf(
    eq(eventPlanNotifications.venueId, venueId),
    isNull(eventPlanNotifications.changeId),
    isNull(eventPlanNotifications.eventId),
    among(eventPlanNotifications.actionPath, records.proposalIds.map((id) => `/dashboard?view=proposals&proposal=${id}`)),
  )).returning({ id: eventPlanNotifications.id });
  const comments = commentIds.length === 0 ? [] : await tx.delete(proposalComments)
    .where(inArray(proposalComments.id, [...commentIds]))
    .returning({ id: proposalComments.id });
  const anonymised = signedElsewhere.length === 0 ? [] : await tx.update(proposalComments)
    .set({ authorName: null, authorEmail: null })
    .where(inArray(proposalComments.id, signedElsewhere.map((row) => row.id)))
    .returning({ id: proposalComments.id });

  // A status note written from the share link quotes the client; staff notes
  // stay, without the names.
  await tx.update(proposalStatusHistory).set({ note: null }).where(allOf(
    among(proposalStatusHistory.proposalId, records.proposalIds),
    isNull(proposalStatusHistory.changedBy),
    isNotNull(proposalStatusHistory.note),
  ));
  const accepted = await tx.update(proposals).set({ acceptedName: null }).where(allOf(
    among(proposals.id, records.proposalIds),
    isNotNull(proposals.acceptedName),
  )).returning({ id: proposals.id });
  // The client's share links stop working: the page they open is theirs.
  await tx.update(proposalShareTokens).set({ revokedAt: sql`now()` }).where(allOf(
    among(proposalShareTokens.proposalId, records.proposalIds),
    isNull(proposalShareTokens.revokedAt),
  ));

  const receipts = await tx.delete(emailSends).where(receiptsFor(enquiryIds)).returning({ id: emailSends.id });
  const enquiryNotices = await removeEnquiryNotices(tx, records);

  // The rows the venue keeps, theirs and the nearby ones another live person
  // holds, without the names.
  const dealIds = [...records.dealIds, ...nearby.dealIds];
  const workProposalIds = [...records.proposalIds, ...nearby.proposalIds];
  const proposalIds = distinct([...workProposalIds, ...elsewhereProposalIds]);
  const eventIds = [...records.eventIds, ...nearby.eventIds];
  const bookingIds = [...records.bookingIds, ...nearby.bookingIds];
  const touchesWork = or(among(eventPlanChanges.eventId, eventIds), among(eventPlanChanges.proposalId, proposalIds)) ?? sql`false`;
  const kept: Reword[] = [
    { table: "opportunities", columns: { title: 200, next_action: 500 }, where: among(opportunities.id, dealIds) },
    { table: "opportunity_status_history", columns: { note: null }, where: among(opportunityStatusHistory.opportunityId, dealIds) },
    { table: "activities", columns: { body: null }, where: among(activities.opportunityId, dealIds) },
    { table: "proposals", columns: { title: 200, accepted_name: 200 }, where: among(proposals.id, proposalIds) },
    { table: "proposal_comments", columns: { body: null },
      where: allOf(among(proposalComments.proposalId, workProposalIds), eq(proposalComments.authorType, "staff")) },
    // A client's words on a proposal that is not theirs (another person's
    // deal from their enquiry, or one they answered on): an acceptance's
    // approval note carries the name they typed, with or without an address.
    { table: "proposal_comments", columns: { author_name: 200, body: null },
      where: allOf(among(proposalComments.proposalId, [...nearby.proposalIds, ...elsewhereProposalIds]), eq(proposalComments.authorType, "client")) },
    { table: "proposal_comments", columns: { author_name: 200, body: null }, where: among(proposalComments.id, [...othersComments, ...signedAsThem]) },
    { table: "proposal_status_history", columns: { note: null }, where: among(proposalStatusHistory.proposalId, proposalIds) },
    { table: "bookings", columns: { title: 200, notes: null, next_action: 500 }, where: among(bookings.id, bookingIds) },
    // The note staff type on a Diary transition (a release, a hold put back).
    { table: "booking_status_history", columns: { note: null }, where: among(bookingStatusHistory.bookingId, bookingIds) },
    // Requests, conversations and acknowledgements about those bookings and events.
    { table: "requests", columns: { detail: null, outcome_note: null },
      where: or(among(requests.bookingId, bookingIds), among(requests.eventId, eventIds)) ?? sql`false` },
    { table: "threads", columns: { title: 160 }, where: or(among(threads.bookingId, bookingIds), among(threads.eventId, eventIds)) ?? sql`false` },
    { table: "messages", columns: { author_name: 160, body: 2000 },
      where: bookingIds.length + eventIds.length === 0 ? sql`false` : sql`"messages"."thread_id" in (
        select th."id" from "threads" as th where ${or(among(sql`th."booking_id"`, bookingIds), among(sql`th."event_id"`, eventIds)) ?? sql`false`})` },
    { table: "event_plan_change_acknowledgements", columns: { note: null }, where: among(eventPlanChangeAcknowledgements.eventId, eventIds) },
    // The BEO compiled for the event copies its name and notes.
    { table: "beo_documents", columns: { body: null },
      where: eventIds.length === 0 ? sql`false` : sql`"beo_documents"."handoff_pack_id" in (
        select hp."id" from "handoff_packs" as hp where ${among(sql`hp."event_id"`, eventIds)})` },
    { table: "events", columns: { name: 200, client_name: 200, notes: null }, where: among(events.id, eventIds) },
    { table: "event_phases", columns: { notes: null }, where: among(eventPhases.eventId, eventIds) },
    // A client's change is labelled with the name they gave; a member of
    // staff's label stays, as theirs.
    { table: "event_plan_changes", columns: { actor_label: 160, title: 180, summary: null, before_summary: null, after_summary: null },
      where: allOf(eq(eventPlanChanges.venueId, venueId), eq(eventPlanChanges.actorRole, "client"), touchesWork) },
    { table: "event_plan_changes", columns: { title: 180, summary: null, before_summary: null, after_summary: null },
      where: allOf(eq(eventPlanChanges.venueId, venueId), ne(eventPlanChanges.actorRole, "client"), touchesWork) },
    // Notices of those events and changes, and those that link to the
    // proposal's desk or a Diary booking.
    { table: "event_plan_notifications", columns: { title: 180, body: 1000 },
      where: allOf(
        eq(eventPlanNotifications.venueId, venueId),
        or(
          among(eventPlanNotifications.eventId, eventIds),
          proposalIds.length === 0 ? sql`false` : sql`${outerColumn(eventPlanNotifications.changeId)} in (
            select copy."id" from "event_plan_changes" as copy where ${among(sql`copy."proposal_id"`, proposalIds)})`,
          holdsAnyId(eventPlanNotifications.actionPath, [...bookingIds, ...proposalIds]),
        ) ?? sql`false`,
      ) },
  ];
  const changed = new Set<string>(anonymised.map((row) => `proposal_comments:${row.id}`));
  for (const target of kept) for (const id of await reword(tx, target, names)) changed.add(`${target.table}:${id}`);
  // The version sent to a client is its identity for a contract or deposit;
  // another person's proposal with one keeps its versions as they are.
  const reversioned = await rewordVersions(tx, [...records.proposalIds, ...await withoutAgreements(tx, nearby.proposalIds)], names);
  for (const id of await eraseDecisionReasons(tx, records, names)) changed.add(`decisions:${id}`);
  for (const key of await rewordLayouts(tx, records, names)) changed.add(key);
  const retitled = [...changed].flatMap((key) => (key.startsWith("proposals:") ? [key.slice("proposals:".length)] : []));
  const reworded = changed.size;

  const deleted = enquiryIds.length === 0 ? [] : await tx.delete(enquiries)
    .where(inArray(enquiries.id, enquiryIds))
    .returning({ id: enquiries.id });

  // A lead has no venue. Its address is one of theirs, or one their deleted
  // enquiries were sent from, that no other live person here holds; another
  // enquiry anywhere still using it keeps it. A public enquiry writes its
  // lead under the same lock, so one sent from the address meanwhile either
  // finishes first and is seen, or writes its lead after this.
  const sentFrom = addresses(records.enquiries.flatMap((row) => [row.email, row.guestEmail]));
  const leadsHeld = await heldByOthers(tx, venueId, records.ids, sentFrom);
  const leadAddresses = distinct([...records.addresses, ...sentFrom.filter((address) => !leadsHeld.has(address))]);
  for (const address of [...leadAddresses].sort()) await lockGuestLead(tx, address);
  // The inner table is aliased, the outer column named in full.
  const leads = leadAddresses.length === 0 ? [] : await tx.delete(guestLeads)
    .where(allOf(
      inArray(lower(guestLeads.email), [...leadAddresses]),
      sql`not exists (
        select 1 from "enquiries" as other
        where lower(other."email") = lower(${outerColumn(guestLeads.email)})
          or lower(other."guest_email") = lower(${outerColumn(guestLeads.email)})
      )`,
    ))
    .returning({ id: guestLeads.id });

  return {
    enquiries: deleted.length,
    guestLeads: leads.length,
    emailReceipts: receipts.length,
    comments: comments.length,
    changeCopies: changeCopies.length,
    notices: proposalNotices.length + enquiryNotices,
    proposals: distinct([...accepted.map((row) => row.id), ...retitled, ...reversioned]).length,
    reworded,
  };
}

/** Whether a layout's day-of contact is them: their name, an address of
 *  theirs, or one of their phone numbers. */
function isThem(contact: unknown, names: readonly string[], phones: readonly string[]): boolean {
  if (typeof contact !== "object" || contact === null) return false;
  const field = (key: string): string => {
    const value: unknown = (contact as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const name = field("name");
  const email = field("email").toLowerCase();
  const phone = field("phone");
  return (name.length > 0 && withoutNames(name, names) !== name)
    || (email.length > 0 && names.includes(email))
    || (phone.length > 0 && phones.some((theirs) => samePhone(theirs, phone)));
}

/** A layout's metadata, or a sheet's payload, with its planner instructions
 *  taken off them: the day-of contact cleared when it is them, their names out
 *  of the special instructions and access notes. The same document when
 *  nothing changed. */
function instructionsWithoutThem<T>(document: T, names: readonly string[], phones: readonly string[]): T {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return document;
  const instructions: unknown = (document as Record<string, unknown>)["instructions"];
  if (typeof instructions !== "object" || instructions === null || Array.isArray(instructions)) return document;
  const before = instructions as Record<string, unknown>;
  const after: Record<string, unknown> = { ...before };
  let changed = false;
  for (const key of ["specialInstructions", "accessNotes"]) {
    const text = before[key];
    if (typeof text !== "string") continue;
    const reworded = withoutNames(text, names);
    if (reworded !== null && reworded !== text) {
      after[key] = reworded;
      changed = true;
    }
  }
  if (isThem(before["dayOfContact"], names, phones)) {
    after["dayOfContact"] = null;
    changed = true;
  }
  return changed ? ({ ...(document as Record<string, unknown>), instructions: after } as T) : document;
}

/**
 * The layouts of their enquiries and proposals (their own, and another
 * person's deal made from their enquiry), and every event sheet issued from
 * them: a sheet freezes the layout's planner instructions
 * (configuration_sheet_snapshots.payload). Where the day-of contact the
 * hallkeeper rings is them it is cleared; their names leave the special
 * instructions, the access notes and the layout's name. As the allergy-note
 * retention does (dietary-retention.ts), a sheet keeps its source hash: it
 * names the version of the layout, not its text. Returns the rows changed.
 */
async function rewordLayouts(tx: PeopleTx, records: ErasureRecords, names: readonly string[]): Promise<readonly string[]> {
  if (records.layoutIds.length === 0 || (names.length === 0 && records.phones.length === 0)) return [];
  const changed: string[] = [];
  const layouts = await tx.select({ id: configurations.id, name: configurations.name, metadata: configurations.metadata })
    .from(configurations).where(inArray(configurations.id, [...records.layoutIds])).for("update");
  for (const layout of layouts) {
    const metadata = instructionsWithoutThem(layout.metadata, names, records.phones);
    const name = (withoutNames(layout.name, names) ?? layout.name).slice(0, 200);
    if (metadata === layout.metadata && name === layout.name) continue;
    await tx.update(configurations).set({ name, metadata }).where(eq(configurations.id, layout.id));
    changed.push(`configurations:${layout.id}`);
  }
  const sheets = await tx.select({ id: configurationSheetSnapshots.id, payload: configurationSheetSnapshots.payload })
    .from(configurationSheetSnapshots)
    .where(inArray(configurationSheetSnapshots.configurationId, [...records.layoutIds]))
    .for("update");
  for (const sheet of sheets) {
    const payload = instructionsWithoutThem(sheet.payload, names, records.phones);
    if (payload === sheet.payload) continue;
    await tx.update(configurationSheetSnapshots).set({ payload }).where(eq(configurationSheetSnapshots.id, sheet.id));
    changed.push(`configuration_sheet_snapshots:${sheet.id}`);
  }
  return changed;
}

/** Of the proposals, those with no contract prepared and no deposit asked for. */
async function withoutAgreements(tx: PeopleTx, proposalIds: readonly string[]): Promise<readonly string[]> {
  if (proposalIds.length === 0) return [];
  const contracted = await tx.select({ id: proposalContractVersions.proposalId }).from(proposalContractVersions)
    .where(inArray(proposalContractVersions.proposalId, [...proposalIds]));
  const deposited = await tx.select({ id: proposalDepositRequests.proposalId }).from(proposalDepositRequests)
    .where(inArray(proposalDepositRequests.proposalId, [...proposalIds]));
  const agreed = new Set([...contracted, ...deposited].map((row) => row.id));
  return proposalIds.filter((id) => !agreed.has(id));
}

/** A decision's reason is free text the asker gave, and can only be erased
 *  whole (migration 0108). On a booking pencilled from the enquiries that go
 *  it always goes; on any other booking of their events, or of another
 *  person's deal made from their enquiry, when it names them. Nothing goes
 *  when only a kept person's spare enquiries leave. Returns the decisions
 *  whose reason went. */
async function eraseDecisionReasons(tx: PeopleTx, records: ErasureRecords, names: readonly string[]): Promise<readonly string[]> {
  const keptPerson = records.ids.length === 0 && records.writers.length > 0;
  const bookingIds = [...records.bookingIds, ...records.nearby.bookingIds];
  if (keptPerson || bookingIds.length === 0) return [];
  const given = await tx.select({ id: decisions.id, reason: decisions.reason, enquiryId: bookings.enquiryId }).from(decisions)
    .innerJoin(bookings, eq(bookings.id, decisions.subjectId))
    .where(allOf(
      eq(decisions.venueId, records.venueId),
      eq(decisions.subjectKind, "booking"),
      inArray(decisions.subjectId, bookingIds),
      isNotNull(decisions.reason),
    ));
  const leaving = new Set(records.enquiries.map((row) => row.id));
  const erased = given.filter((row) => (row.enquiryId !== null && leaving.has(row.enquiryId))
    || withoutNames(row.reason, names) !== row.reason).map((row) => row.id);
  if (erased.length > 0) await tx.update(decisions).set({ reason: null }).where(inArray(decisions.id, erased));
  return erased;
}

/**
 * The in-app notice of each public enquiry, written as it arrived
 * (routes/public-enquiries.ts). It holds no enquiry id: it opens with the
 * enquirer's name or address ("<shown> enquired …" or "… asked …"), at the
 * venue, links to the enquiries list, and was written within moments of the
 * enquiry. The whole opening is matched, so "Jo" never matches "Jo Smith
 * enquired", and a notice another enquiry kept here could equally have
 * written (the same name within the same minutes, a partner's from the
 * shared inbox) stays: it may be theirs.
 */
async function removeEnquiryNotices(tx: PeopleTx, records: ErasureRecords): Promise<number> {
  const enquiryIds = records.enquiries.map((row) => row.id);
  if (enquiryIds.length === 0) return 0;
  const body = outerColumn(eventPlanNotifications.body);
  const createdAt = outerColumn(eventPlanNotifications.createdAt);
  const leaving = sql.join(enquiryIds.map((id) => sql`${id}::uuid`), sql`, `);
  let removed = 0;
  for (const enquiry of records.enquiries) {
    const openings = distinct([enquiry.guestName, enquiry.email, enquiry.guestEmail].flatMap((value) => {
      const shown = value?.trim() ?? "";
      return shown.length > 0 ? [`${shown} enquired `, `${shown} asked `] : [];
    }));
    if (openings.length === 0) continue;
    const arrived = enquiry.createdAt.toISOString();
    const deleted = await tx.delete(eventPlanNotifications).where(allOf(
      eq(eventPlanNotifications.venueId, records.venueId),
      isNull(eventPlanNotifications.changeId),
      isNull(eventPlanNotifications.eventId),
      eq(eventPlanNotifications.actionPath, ENQUIRY_NOTICE_PATH),
      or(...openings.map((opening) => sql`starts_with(${eventPlanNotifications.body}, ${opening})`)) ?? sql`false`,
      sql`${eventPlanNotifications.createdAt} between ${arrived}::timestamptz - interval '1 minute'
        and ${arrived}::timestamptz + interval '10 minutes'`,
      sql`not exists (
        select 1 from "enquiries" as rival
        where rival."venue_id" = ${records.venueId} and rival."id" not in (${leaving})
          and ${createdAt} between rival."created_at" - interval '1 minute' and rival."created_at" + interval '10 minutes'
          and exists (
            select 1 from unnest(array[btrim(rival."guest_name"), btrim(rival."email"), btrim(rival."guest_email")]) as shown(opening)
            where starts_with(${body}, shown.opening || ' enquired ') or starts_with(${body}, shown.opening || ' asked ')
          )
      )`,
    )).returning({ id: eventPlanNotifications.id });
    removed += deleted.length;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Erasing the person
// ---------------------------------------------------------------------------

export type ErasureOutcome =
  | { readonly ok: true; readonly counts: ErasureCounts }
  | { readonly ok: false; readonly refusal: ErasureRefusal };

/**
 * Erase a person the caller has locked (`SELECT … FOR UPDATE`), who is
 * neither merged into someone else nor already erased. Returns the counts,
 * or why it refused; a refusal has changed nothing.
 */
export async function eraseLockedPerson(
  tx: PeopleTx,
  person: ContactRow,
  input: { readonly actorUserId: string | null; readonly now: Date },
): Promise<ErasureOutcome> {
  return eraseFoundPerson(tx, person, await findPersonRecords(tx, person), input);
}

/** As eraseLockedPerson, with the records already found in this transaction. */
export async function eraseFoundPerson(
  tx: PeopleTx,
  person: ContactRow,
  records: ErasureRecords,
  input: { readonly actorUserId: string | null; readonly now: Date },
): Promise<ErasureOutcome> {
  const refusal = await keptRecord(tx, records);
  if (refusal !== null) return { ok: false, refusal };
  const ids = [...records.ids];

  const removed = await removeEnquiryRecords(tx, records);

  // The snapshots that copy them: where they were the record merged away, and
  // live merges into them. An undone merge where they were the survivor
  // copied someone else, who is live again and keeps their history.
  const theirs = new Set(ids);
  const merges = await tx.select({
    id: recordMerges.id, snapshot: recordMerges.snapshot, survivorId: recordMerges.survivorId,
    mergedId: recordMerges.mergedId, undoneAt: recordMerges.undoneAt,
  }).from(recordMerges).where(allOf(
    eq(recordMerges.venueId, records.venueId),
    eq(recordMerges.kind, "person"),
    or(inArray(recordMerges.survivorId, ids), inArray(recordMerges.mergedId, ids)) ?? sql`false`,
  ));
  const scrubbed = merges.filter((merge) => theirs.has(merge.mergedId) || (merge.undoneAt === null && theirs.has(merge.survivorId)));
  for (const merge of scrubbed) {
    await tx.update(recordMerges).set({ snapshot: erasedSnapshot(merge.snapshot) }).where(eq(recordMerges.id, merge.id));
  }

  const households = records.householdIds.length === 0 ? [] : await tx.update(clientAccounts).set({
    name: ERASED_NAME,
    address: null,
    notes: null,
    website: null,
    vatNumber: null,
    sourceSystem: null,
    sourceId: null,
    updatedAt: input.now,
  }).where(inArray(clientAccounts.id, [...records.householdIds])).returning({ id: clientAccounts.id });
  // A household another live member stays in is theirs: only the erased
  // person's name leaves its text, and one the erased person led passes to
  // that member as its main contact.
  for (const handover of records.handedOver) {
    await tx.update(clientAccounts).set({ primaryContactId: handover.to, updatedAt: input.now })
      .where(eq(clientAccounts.id, handover.householdId));
  }
  const handedOverIds = records.handedOver.map((handover) => handover.householdId);
  const renamed = await reword(tx, { table: "client_accounts", columns: { name: 200, notes: null },
    where: among(clientAccounts.id, records.sharedHouseholdIds) }, records.names);

  const removedPoints = await tx.delete(contactPoints).where(inArray(contactPoints.contactId, ids))
    .returning({ id: contactPoints.id });
  await tx.update(accountMemberships).set({ roleLabel: null }).where(inArray(accountMemberships.contactId, ids));
  const people = await tx.update(contacts).set({
    name: ERASED_NAME,
    email: null,
    phone: null,
    givenName: null,
    familyName: null,
    jobTitle: null,
    roleLabel: null,
    postalAddress: null,
    notes: null,
    sourceSystem: null,
    sourceId: null,
    erasedAt: input.now,
    deletedAt: sql`coalesce(${contacts.deletedAt}, ${input.now.toISOString()}::timestamptz)`,
    updatedAt: input.now,
  }).where(inArray(contacts.id, ids)).returning({ id: contacts.id });

  const counts: ErasureCounts = {
    people: people.length,
    contactPoints: removedPoints.length,
    mergeSnapshots: scrubbed.length,
    households: households.length + handedOverIds.length,
    ...removed,
    reworded: removed.reworded + renamed.length,
  };
  await tx.insert(generalAuditLog).values({
    actorUserId: input.actorUserId,
    action: "people.erased",
    targetType: "contact",
    targetId: person.id,
    summary: input.actorUserId === null
      ? "Person erased 24 months after the last contact"
      : "Person erased on request",
    metadata: { venueId: person.venueId, ...counts },
  });
  return { ok: true, counts };
}

import { and, eq, inArray, isNotNull, isNull, max, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { proposalVersionPayloadDigest, type RecordMergeSnapshot } from "@omnitwin/types";
import {
  accountMemberships,
  activities,
  bookings,
  clientAccounts,
  contactPoints,
  contacts,
  emailSends,
  enquiries,
  eventPlanChanges,
  eventPlanNotifications,
  events,
  generalAuditLog,
  guestLeads,
  opportunities,
  proposalComments,
  proposalContractVersions,
  proposalDepositRequests,
  proposals,
  proposalShareTokens,
  proposalStatusHistory,
  proposalVersions,
  recordMerges,
} from "../db/schema.js";
import { outerColumn } from "../utils/outer-column.js";
import { ERASED_TEXT, namesToErase, withoutNames } from "./people-erasure-text.js";
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
//     their enquiries), the proposals of those deals and enquiries, the
//     events of those deals, of their enquiries' bookings, of organisations
//     they lead and of households they belong to, and the bookings from their
//     enquiries or on those events.
// Every one of those rows is locked before anything is decided, so a hold
// pencilled or a contract prepared at the same moment either waits for the
// erasure or is seen by it.
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
//     loses its name, address and notes; a household they lead with another
//     live member passes to that member and loses only their name;
//   - their enquiries are deleted, with each one's status history, the
//     venue's email receipts for it and its in-app notices; the guest lead
//     goes too unless an enquiry, anywhere, still uses the address;
//   - what the client wrote on their proposals (comments, answers, the words
//     copied into the event's change feed and into notices) is deleted, the
//     name they typed to accept is cleared, and the share links stop working.
//     What they wrote from an address of theirs on someone else's proposal
//     is that client's record: it stays, without their name and address;
//   - the rows the venue keeps as its own record of the work (deals and their
//     activity notes, released holds and viewings in the Diary, events,
//     proposals and their versions, staff comments and status notes, change
//     feed entries and notices) keep their row and lose the person's full
//     name and addresses from their text (services/people-erasure-text.ts).
//     A first name alone is left: "Will" and "May" are words too.
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
}

export const ENQUIRY_FIELDS = {
  id: enquiries.id,
  venueId: enquiries.venueId,
  name: enquiries.name,
  email: enquiries.email,
  guestName: enquiries.guestName,
  guestEmail: enquiries.guestEmail,
  createdAt: enquiries.createdAt,
} as const;

/** Everything that is theirs at the venue, found and locked. */
export interface ErasureRecords {
  readonly venueId: string;
  /** The person and every record merged into them; none for a lone enquiry. */
  readonly ids: readonly string[];
  /** Their addresses, lower-cased, that no other live person at the venue holds. */
  readonly addresses: readonly string[];
  readonly enquiries: readonly EnquiryRef[];
  readonly dealIds: readonly string[];
  readonly proposalIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly bookingIds: readonly string[];
  /** Organisations they lead and households they belong to (the booking guard). */
  readonly accountIds: readonly string[];
  /** Their own households: no other live member is left. */
  readonly householdIds: readonly string[];
  /** Households they are the main contact of, with another live member to
   *  take over: the household stays that member's. */
  readonly handedOver: readonly { readonly householdId: string; readonly to: string }[];
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

/** Among the accounts, the households that are theirs alone (no other live
 *  member), and those they are the main contact of while another live member
 *  stays, who takes it over (the primary member first). */
async function ownHouseholds(
  tx: PeopleTx,
  ids: readonly string[],
  accountIds: readonly string[],
): Promise<Pick<ErasureRecords, "householdIds" | "handedOver">> {
  const none = { householdIds: [], handedOver: [] };
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
  const handedOver: { householdId: string; to: string }[] = [];
  for (const household of households) {
    const successor = others.find((member) => member.accountId === household.id);
    if (successor === undefined) householdIds.push(household.id);
    else if (household.primaryContactId !== null && theirs.has(household.primaryContactId)) {
      handedOver.push({ householdId: household.id, to: successor.contactId });
    }
  }
  return { householdIds, handedOver };
}

type RecordsBase = Omit<ErasureRecords, "dealIds" | "proposalIds" | "eventIds" | "bookingIds">;

/** The deals, proposals, events and bookings around the enquiries and
 *  accounts, each locked: a booking writer locks its enquiry or takes a key
 *  lock on its event, so it waits for this transaction, or finished first. */
async function around(tx: PeopleTx, base: RecordsBase): Promise<ErasureRecords> {
  const enquiryIds = base.enquiries.map((row) => row.id);
  const deals = await tx.select({ id: opportunities.id }).from(opportunities).where(allOf(
    eq(opportunities.venueId, base.venueId),
    or(among(opportunities.primaryContactId, base.ids), among(opportunities.sourceEnquiryId, enquiryIds)) ?? sql`false`,
  )).for("update");
  const dealIds = deals.map((row) => row.id);
  const proposalRows = await tx.select({ id: proposals.id }).from(proposals).where(allOf(
    eq(proposals.venueId, base.venueId),
    or(among(proposals.enquiryId, enquiryIds), among(proposals.opportunityId, dealIds)) ?? sql`false`,
  )).for("update");
  const booked = await tx.selectDistinct({ id: bookings.eventId }).from(bookings)
    .where(allOf(among(bookings.enquiryId, enquiryIds), isNotNull(bookings.eventId)));
  const evented = await tx.select({ id: events.id }).from(events).where(allOf(
    eq(events.venueId, base.venueId),
    or(among(events.opportunityId, dealIds), among(events.clientAccountId, base.accountIds)) ?? sql`false`,
  ));
  const eventIds = distinct([...booked, ...evented].flatMap((row) => (row.id === null ? [] : [row.id])));
  if (eventIds.length > 0) await tx.select({ id: events.id }).from(events).where(inArray(events.id, [...eventIds])).for("update");
  const bookingRows = await tx.select({ id: bookings.id }).from(bookings)
    .where(or(among(bookings.enquiryId, enquiryIds), among(bookings.eventId, eventIds)));
  return {
    ...base,
    dealIds,
    proposalIds: proposalRows.map((row) => row.id),
    eventIds,
    bookingIds: bookingRows.map((row) => row.id),
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
  const people = await tx.select({ name: contacts.name, givenName: contacts.givenName, familyName: contacts.familyName, email: contacts.email })
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
  )).for("update");

  const led = await tx.select({ id: clientAccounts.id }).from(clientAccounts)
    .where(allOf(eq(clientAccounts.venueId, venueId), inArray(clientAccounts.primaryContactId, ids)));
  const households = await tx.select({ id: clientAccounts.id }).from(accountMemberships)
    .innerJoin(clientAccounts, eq(clientAccounts.id, accountMemberships.clientAccountId))
    .where(allOf(inArray(accountMemberships.contactId, ids), eq(clientAccounts.kind, "household")));
  const accountIds = distinct([...led, ...households].map((row) => row.id));

  // Their full names and their own addresses. A first or family name on its
  // own stays: a partner shares the family name, and "Will", "May" or "Rose"
  // are words in other people's sentences too.
  const names = namesToErase([
    ...people.flatMap((row) => [
      row.name,
      row.givenName !== null && row.familyName !== null ? `${row.givenName} ${row.familyName}` : null,
    ]),
    ...theirEnquiries.flatMap((row) => [row.name, row.guestName]),
    ...own,
  ].filter((name) => name === null || (name !== ERASED_NAME && !shared.has(name.trim().toLowerCase()))));

  return around(tx, {
    venueId,
    ids,
    addresses: own,
    enquiries: theirEnquiries,
    accountIds,
    ...await ownHouseholds(tx, ids, accountIds),
    names,
  });
}

/** One enquiry and what hangs off it, locked: a lone enquiry, or a lapsed
 *  one of a person the venue keeps (then nothing is reworded). */
export async function findEnquiryRecords(
  tx: PeopleTx,
  enquiry: EnquiryRef,
  options: { readonly reword: boolean },
): Promise<ErasureRecords> {
  return around(tx, {
    venueId: enquiry.venueId,
    ids: [],
    addresses: addresses([enquiry.email, enquiry.guestEmail]),
    enquiries: [enquiry],
    accountIds: [],
    householdIds: [],
    handedOver: [],
    names: options.reword ? namesToErase([enquiry.name, enquiry.guestName, enquiry.email, enquiry.guestEmail]) : [],
  });
}

/** Why the records must be kept, or null when they can go. */
export async function keptRecord(tx: PeopleTx, records: ErasureRecords): Promise<ErasureRefusal | null> {
  const enquiryIds = records.enquiries.map((row) => row.id);
  const [booked] = await tx.select({ id: bookings.id }).from(bookings).where(allOf(
    or(among(bookings.enquiryId, enquiryIds), among(bookings.eventId, records.eventIds)) ?? sql`false`,
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
 * booking of theirs. A staff edit to the person's own record is not contact
 * and does not count.
 */
export async function lastInTouch(tx: PeopleTx, records: ErasureRecords): Promise<Date | null> {
  const enquiryIds = records.enquiries.map((row) => row.id);
  const [person] = records.ids.length === 0 ? [] : await tx.select({ contact: max(contacts.lastContactAt), made: max(contacts.createdAt) })
    .from(contacts).where(inArray(contacts.id, [...records.ids]));
  const [asked] = enquiryIds.length === 0 ? [] : await tx.select({ made: max(enquiries.createdAt), changed: max(enquiries.updatedAt) })
    .from(enquiries).where(inArray(enquiries.id, enquiryIds));
  const [deal] = records.dealIds.length === 0 ? [] : await tx.select({ made: max(opportunities.createdAt), changed: max(opportunities.updatedAt) })
    .from(opportunities).where(inArray(opportunities.id, [...records.dealIds]));
  const [note] = records.dealIds.length === 0 ? [] : await tx.select({ made: max(activities.createdAt) })
    .from(activities).where(inArray(activities.opportunityId, [...records.dealIds]));
  const [proposal] = records.proposalIds.length === 0 ? [] : await tx.select({
    made: max(proposals.createdAt), changed: max(proposals.updatedAt), sent: max(proposals.sentAt),
  }).from(proposals).where(inArray(proposals.id, [...records.proposalIds]));
  const [answer] = records.proposalIds.length === 0 ? [] : await tx.select({ made: max(proposalComments.createdAt) })
    .from(proposalComments).where(inArray(proposalComments.proposalId, [...records.proposalIds]));
  const [booking] = records.bookingIds.length === 0 ? [] : await tx.select({ made: max(bookings.createdAt), changed: max(bookings.updatedAt) })
    .from(bookings).where(inArray(bookings.id, [...records.bookingIds]));
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

/** Their names out of each version's title and message to the client, with
 *  the version's digest made again: the digest is the version's identity for
 *  a contract or a deposit, and neither can exist here (keptRecord refused
 *  them). Returns the proposals whose versions changed. */
async function rewordVersions(tx: PeopleTx, proposalIds: readonly string[], names: readonly string[]): Promise<readonly string[]> {
  if (names.length === 0 || proposalIds.length === 0) return [];
  const versions = await tx.select({ id: proposalVersions.id, proposalId: proposalVersions.proposalId, payload: proposalVersions.payload })
    .from(proposalVersions).where(inArray(proposalVersions.proposalId, [...proposalIds])).for("update");
  const changed = new Set<string>();
  for (const version of versions) {
    const title = withoutNames(version.payload.title, names) ?? version.payload.title;
    const clientMessage = withoutNames(version.payload.clientMessage, names);
    if (title === version.payload.title && clientMessage === version.payload.clientMessage) continue;
    const payload = { ...version.payload, title, clientMessage };
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
  const { venueId, names } = records;
  const enquiryIds = records.enquiries.map((row) => row.id);

  // What the client wrote on their proposals goes, unless it was signed with
  // an address another live person holds. What a person signed from an
  // address of theirs on someone else's proposal is that client's record (a
  // change they asked for on a booked wedding, a hallkeeper's acknowledgement
  // of it): it stays, without their name and address.
  const onTheirs = await tx.select({ id: proposalComments.id, authorEmail: proposalComments.authorEmail })
    .from(proposalComments)
    .where(allOf(among(proposalComments.proposalId, records.proposalIds), eq(proposalComments.authorType, "client")));
  const others = await heldByOthers(tx, venueId, records.ids, addresses(onTheirs.map((row) => row.authorEmail)));
  const signedElsewhere = records.ids.length === 0 || records.addresses.length === 0 ? [] : (await tx.select({ id: proposalComments.id })
    .from(proposalComments)
    .innerJoin(proposals, eq(proposals.id, proposalComments.proposalId))
    .where(allOf(
      eq(proposals.venueId, venueId),
      notAmong(proposals.id, records.proposalIds),
      eq(proposalComments.authorType, "client"),
      inArray(lower(proposalComments.authorEmail), [...records.addresses]),
    ))).map((row) => row.id);
  const commentIds = onTheirs
    .filter((row) => row.authorEmail === null || !others.has(row.authorEmail.trim().toLowerCase()))
    .map((row) => row.id);

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
    .where(inArray(proposalComments.id, [...signedElsewhere]))
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
  const retitled = await reword(tx, { table: "proposals", columns: { title: 200 },
    where: among(proposals.id, records.proposalIds) }, names);
  const reversioned = await rewordVersions(tx, records.proposalIds, names);
  // The client's share links stop working: the page they open is theirs.
  await tx.update(proposalShareTokens).set({ revokedAt: sql`now()` }).where(allOf(
    among(proposalShareTokens.proposalId, records.proposalIds),
    isNull(proposalShareTokens.revokedAt),
  ));

  const receipts = await tx.delete(emailSends).where(receiptsFor(enquiryIds)).returning({ id: emailSends.id });

  // A public enquiry's notice opens with the enquirer's name (or email) and
  // links to nothing: it is the venue's notice of that enquiry, written as
  // the enquiry arrived (routes/public-enquiries.ts).
  let enquiryNotices = 0;
  for (const enquiry of records.enquiries) {
    // The notice opens "<name or email> enquired …" or "… asked …": the whole
    // opening, so "Jo" never matches "Jo Smith enquired".
    const shownAs = distinct([enquiry.guestName, enquiry.email].flatMap((value) => {
      const shown = value?.trim() ?? "";
      return shown.length > 0 ? [`${shown} enquired `, `${shown} asked `] : [];
    }));
    if (shownAs.length === 0) continue;
    const arrived = enquiry.createdAt.toISOString();
    const deleted = await tx.delete(eventPlanNotifications).where(allOf(
      eq(eventPlanNotifications.venueId, venueId),
      isNull(eventPlanNotifications.changeId),
      isNull(eventPlanNotifications.eventId),
      eq(eventPlanNotifications.actionPath, ENQUIRY_NOTICE_PATH),
      or(...shownAs.map((prefix) => sql`starts_with(${eventPlanNotifications.body}, ${prefix})`)) ?? sql`false`,
      sql`${eventPlanNotifications.createdAt} between ${arrived}::timestamptz - interval '1 minute'
        and ${arrived}::timestamptz + interval '10 minutes'`,
    )).returning({ id: eventPlanNotifications.id });
    enquiryNotices += deleted.length;
  }

  // The rows the venue keeps, without the names.
  const kept: Reword[] = [
    { table: "opportunities", columns: { title: 200, next_action: 500 }, where: among(opportunities.id, records.dealIds) },
    { table: "activities", columns: { body: null }, where: among(activities.opportunityId, records.dealIds) },
    { table: "bookings", columns: { title: 200, notes: null, next_action: 500 }, where: among(bookings.id, records.bookingIds) },
    { table: "events", columns: { name: 200, client_name: 200, notes: null }, where: among(events.id, records.eventIds) },
    { table: "proposal_comments", columns: { body: null },
      where: allOf(among(proposalComments.proposalId, records.proposalIds), eq(proposalComments.authorType, "staff")) },
    { table: "proposal_status_history", columns: { note: null }, where: among(proposalStatusHistory.proposalId, records.proposalIds) },
    { table: "proposal_comments", columns: { body: null }, where: among(proposalComments.id, signedElsewhere) },
    // Never the actor label: on a change the venue keeps, that is a member
    // of staff, and their own address could hold the person's name.
    { table: "event_plan_changes", columns: { title: 180, summary: null, before_summary: null, after_summary: null },
      where: allOf(
        eq(eventPlanChanges.venueId, venueId),
        or(
          among(eventPlanChanges.eventId, records.eventIds),
          among(eventPlanChanges.proposalId, records.proposalIds),
          allOf(eq(eventPlanChanges.sourceKind, "proposal_comment"), among(eventPlanChanges.sourceId, signedElsewhere)),
        ) ?? sql`false`,
      ) },
    { table: "event_plan_notifications", columns: { title: 180, body: 1000 },
      where: allOf(
        eq(eventPlanNotifications.venueId, venueId),
        or(among(eventPlanNotifications.eventId, records.eventIds), holdsAnyId(eventPlanNotifications.actionPath, records.bookingIds)) ?? sql`false`,
      ) },
  ];
  const changed = new Set<string>(anonymised.map((row) => `proposal_comments:${row.id}`));
  for (const target of kept) for (const id of await reword(tx, target, names)) changed.add(`${target.table}:${id}`);
  const reworded = changed.size;

  const deleted = enquiryIds.length === 0 ? [] : await tx.delete(enquiries)
    .where(inArray(enquiries.id, enquiryIds))
    .returning({ id: enquiries.id });

  // A lead has no venue. Its address is one of theirs, or one their deleted
  // enquiries were sent from, that no other live person here holds; another
  // enquiry anywhere still using it keeps it. The inner table is aliased,
  // the outer column named in full.
  const sentFrom = addresses(records.enquiries.flatMap((row) => [row.email, row.guestEmail]));
  const leadsHeld = await heldByOthers(tx, venueId, records.ids, sentFrom);
  const leadAddresses = distinct([...records.addresses, ...sentFrom.filter((address) => !leadsHeld.has(address))]);
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
    sourceSystem: null,
    sourceId: null,
    updatedAt: input.now,
  }).where(inArray(clientAccounts.id, [...records.householdIds])).returning({ id: clientAccounts.id });
  // A household another live member stays in is theirs now: they become its
  // main contact, and only the erased person's name leaves its text.
  for (const handover of records.handedOver) {
    await tx.update(clientAccounts).set({ primaryContactId: handover.to, updatedAt: input.now })
      .where(eq(clientAccounts.id, handover.householdId));
  }
  const handedOverIds = records.handedOver.map((handover) => handover.householdId);
  const renamed = await reword(tx, { table: "client_accounts", columns: { name: 200, notes: null },
    where: among(clientAccounts.id, handedOverIds) }, records.names);

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

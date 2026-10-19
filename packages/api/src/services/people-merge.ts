import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  MERGE_FILLED_FIELDS,
  MERGE_MOVE_TARGETS,
  MERGE_UNDO_DAYS,
  MergeUndoReportSchema,
  RecordMergeMoveSchema,
  RecordMergeSnapshotSchema,
  type MergeMoves,
  type MergeMoveTarget,
  type MergePreview,
  type MergeResult,
  type MergeSkip,
  type MergeUndoResult,
  type RecordMergeMove,
  type RecordMergeSnapshot,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { accountMemberships, clientAccounts, contactPoints, contacts, enquiries, opportunities, recordMerges } from "../db/schema.js";
import {
  adoptLegacyMirror,
  legacyAdoption,
  lockPerson,
  readPersonState,
  refreshContactMirror,
  toPerson,
  writeOrRefuse,
  type PeopleConn,
  type PeopleTx,
  type PersonLock,
} from "./people-records.js";

// ---------------------------------------------------------------------------
// Merging two records of one person (T-665).
//
// The record that closes (L, the merged) hands everything to the one that
// stays (S, the survivor), in one transaction: its points and memberships,
// the enquiries and deals that name it, the organisations whose primary
// contact it is, and the tombstones of earlier merges into it, so every
// tombstone stays one hop from a live record. Points and memberships S
// already holds are removed rather than moved, and live on in the record's
// snapshot. S's empty fields are filled from L; S's mirrors are refreshed,
// and L's, which now hold nothing. L becomes a tombstone (merged_into_id and
// deleted_at), so an old link answers with where the person went, and a
// record_merges row keeps everything an undo needs for MERGE_UNDO_DAYS.
//
// Locks, in the order every People Book transaction takes them:
// 1. the venue's people-merge advisory lock, so the merges (and undos) at a
//    venue happen one at a time: a second press of the same merge, or the
//    opposite merge pressed at once, waits here and then finds the first
//    merge done (Review Focus 4);
// 2. L and S, FOR UPDATE, the lower id first;
// 3. the rows that point at them, by the merge's own DELETEs and UPDATEs.
//
// Step 8 updates organisations (client_accounts.primary_contact_id) after
// the people. That cannot cycle with a deal being written:
// - The UPDATE changes no column of a unique index on client_accounts (those
//   are id; id, venue_id; venue_id, source_system, source_id), so it takes
//   FOR NO KEY UPDATE, which does not conflict with FOR KEY SHARE. A deal
//   written meanwhile (POST or PATCH /opportunities, Create opportunity)
//   takes KEY SHARE on its organisation, then on its person, through its
//   foreign keys: it never makes this UPDATE wait, and when it waits on L or
//   S it holds nothing the merge goes on to need.
// - The one organisation lock this UPDATE does wait for is Create
//   opportunity's FOR SHARE (people-link.ts holdOrganisation). That
//   transaction takes it only after its own person, and locks no other
//   person after it, so it always finishes and lets go.
// - Locking the organisations before the people instead would put an
//   organisation before a person, the reverse of Create opportunity's
//   person-then-organisation order, which is the order that could cycle.
// What can still cycle is a writer that locks a pointing row first and a
// person second, which no People Book writer does but PATCH /opportunities
// does: moving one of L's deals to S while L is merged into S holds the deal
// and asks for S. PostgreSQL ends that as a deadlock and rolls one of the
// two back whole, so nothing is left half-moved.
// ---------------------------------------------------------------------------

export type MergeFailure =
  | { kind: "not_found" }
  | { kind: "same_record" }
  | { kind: "already_merged"; survivorId: string }
  | { kind: "survivor_merged"; mergedIntoId: string };

/** A refusal rather than a preview or a merge. */
export function isMergeFailure(answer: MergePreview | MergeResult | MergeFailure): answer is MergeFailure {
  return "kind" in answer;
}

/** The lock every merge and undo at a venue takes first. */
export function mergeLockKey(venueId: string): string {
  return `people-merge:${venueId}`;
}

const NOT_FOUND: MergeFailure = { kind: "not_found" };
const SAME_RECORD: MergeFailure = { kind: "same_record" };
const DAY_MS = 86_400_000;

/**
 * A merge record whose stored jsonb does not match its schema, or does not
 * agree with the record it is in. Its message and its one field name only the
 * merge, never what the record holds about a person; the transaction that met
 * it rolls back, so nothing changes, and the request answers 500.
 */
export class UnreadableMergeRecord extends Error {
  readonly mergeId: string;

  constructor(mergeId: string) {
    super(`Merge record ${mergeId} does not match its schema`);
    this.name = "UnreadableMergeRecord";
    this.mergeId = mergeId;
  }
}

type ContactRow = typeof contacts.$inferSelect;
type Checked = { kind: "pair"; closing: ContactRow; survivor: ContactRow } | { kind: "replay" } | MergeFailure;

/**
 * The checks, in order, once both are read at the closing record's venue:
 * either missing (deleted, erased, absent, or the survivor at another venue)
 * is not found; the closing record already merged into this survivor is the
 * same merge again; merged anywhere else, it is already merged; a survivor
 * that has itself been merged cannot take anyone.
 */
function check(closing: PersonLock, survivor: PersonLock, survivorId: string): Checked {
  if (closing.state === "missing" || survivor.state === "missing") return NOT_FOUND;
  if (closing.state === "merged") {
    return closing.mergedIntoId === survivorId ? { kind: "replay" } : { kind: "already_merged", survivorId: closing.mergedIntoId };
  }
  if (survivor.state === "merged") return { kind: "survivor_merged", mergedIntoId: survivor.mergedIntoId };
  return { kind: "pair", closing: closing.row, survivor: survivor.row };
}

/** The venue of the record that closes, within the actor's scope. */
async function venueOf(db: PeopleConn, scopeVenueId: string | null, personId: string): Promise<string | undefined> {
  const [row] = await db.select({ venueId: contacts.venueId }).from(contacts)
    .where(and(eq(contacts.id, personId), scopeVenueId === null ? undefined : eq(contacts.venueId, scopeVenueId)))
    .limit(1);
  return row?.venueId;
}

function countAll(): SQL<number> {
  return sql<number>`count(*)::int`.mapWith(Number);
}

/** What points at the person by enquiry, deal, organisation and tombstone. */
async function pointingCounts(db: PeopleConn, venueId: string, personId: string): Promise<{
  enquiries: number; deals: number; organisations: number; tombstones: number;
}> {
  const [enquiryCount] = await db.select({ n: countAll() }).from(enquiries)
    .where(and(eq(enquiries.contactId, personId), eq(enquiries.venueId, venueId)));
  const [dealCount] = await db.select({ n: countAll() }).from(opportunities)
    .where(and(eq(opportunities.primaryContactId, personId), eq(opportunities.venueId, venueId)));
  const [organisationCount] = await db.select({ n: countAll() }).from(clientAccounts)
    .where(and(eq(clientAccounts.primaryContactId, personId), eq(clientAccounts.venueId, venueId)));
  const [tombstoneCount] = await db.select({ n: countAll() }).from(contacts)
    .where(and(eq(contacts.mergedIntoId, personId), eq(contacts.venueId, venueId)));
  return {
    enquiries: enquiryCount?.n ?? 0,
    deals: dealCount?.n ?? 0,
    organisations: organisationCount?.n ?? 0,
    tombstones: tombstoneCount?.n ?? 0,
  };
}

/** The (kind, value) of each point the person holds, and of each a merge
 *  would adopt for them first (adoptLegacyMirror). */
async function pointKeys(db: PeopleConn, row: ContactRow, adopted: readonly { kind: string; value: string }[]): Promise<string[]> {
  const held = await db.select({ kind: contactPoints.kind, value: contactPoints.value }).from(contactPoints)
    .where(and(eq(contactPoints.contactId, row.id), eq(contactPoints.venueId, row.venueId)));
  return [...held, ...adopted].map((point) => `${point.kind}\u0000${point.value}`);
}

/** The organisations the person belongs to, and the one a merge would adopt. */
async function accountIds(db: PeopleConn, row: ContactRow, adopted: { clientAccountId: string } | null): Promise<string[]> {
  const held = await db.select({ id: accountMemberships.clientAccountId }).from(accountMemberships)
    .where(and(eq(accountMemberships.contactId, row.id), eq(accountMemberships.venueId, row.venueId)));
  return [...held.map((membership) => membership.id), ...(adopted === null ? [] : [adopted.clientAccountId])];
}

/**
 * What merging `mergedId` into `survivorId` would move, with the merge's own
 * checks and counts and no lock or write. Points and memberships a merge
 * would first adopt from an older writer's mirror columns count as the
 * person's. Run it in one read-only snapshot.
 */
export async function previewPersonMerge(
  db: PeopleConn,
  scopeVenueId: string | null,
  mergedId: string,
  survivorId: string,
): Promise<MergePreview | MergeFailure> {
  const closingId = mergedId.toLowerCase();
  const keptId = survivorId.toLowerCase();
  if (closingId === keptId) return SAME_RECORD;
  const venueId = await venueOf(db, scopeVenueId, closingId);
  if (venueId === undefined) return NOT_FOUND;

  const checked = check(await readPersonState(db, venueId, closingId), await readPersonState(db, venueId, keptId), keptId);
  if (checked.kind === "replay") return { kind: "already_merged", survivorId: keptId };
  if (checked.kind !== "pair") return checked;
  const { closing, survivor } = checked;

  const closingAdoption = await legacyAdoption(db, closing);
  const survivorAdoption = await legacyAdoption(db, survivor);
  const survivorPoints = new Set(await pointKeys(db, survivor, survivorAdoption.points));
  const closingPoints = await pointKeys(db, closing, closingAdoption.points);
  const survivorAccounts = new Set(await accountIds(db, survivor, survivorAdoption.membership));
  const closingAccounts = await accountIds(db, closing, closingAdoption.membership);
  const heldPoints = closingPoints.filter((key) => survivorPoints.has(key)).length;
  const heldMemberships = closingAccounts.filter((id) => survivorAccounts.has(id)).length;
  const pointing = await pointingCounts(db, venueId, closing.id);

  return {
    survivor: { id: survivor.id, name: survivor.name },
    merged: { id: closing.id, name: closing.name },
    moves: {
      "contact_points.contact_id": closingPoints.length - heldPoints,
      "account_memberships.contact_id": closingAccounts.length - heldMemberships,
      "enquiries.contact_id": pointing.enquiries,
      "opportunities.primary_contact_id": pointing.deals,
      "client_accounts.primary_contact_id": pointing.organisations,
      "contacts.merged_into_id": pointing.tombstones,
    },
    alreadyHeld: { contactPoints: heldPoints, memberships: heldMemberships },
  };
}

function countsOf(moves: readonly RecordMergeMove[]): MergeMoves {
  const countOf = (target: MergeMoveTarget): number => {
    const move = moves.find((entry) => entry.target === target);
    if (move === undefined) throw new Error(`A merge record has no ${target} move`);
    return move.ids.length;
  };
  return {
    "contact_points.contact_id": countOf("contact_points.contact_id"),
    "account_memberships.contact_id": countOf("account_memberships.contact_id"),
    "enquiries.contact_id": countOf("enquiries.contact_id"),
    "opportunities.primary_contact_id": countOf("opportunities.primary_contact_id"),
    "client_accounts.primary_contact_id": countOf("client_accounts.primary_contact_id"),
    "contacts.merged_into_id": countOf("contacts.merged_into_id"),
  };
}

function resultOf(
  record: { id: string; mergedAt: Date },
  pair: { survivorId: string; mergedId: string },
  moves: readonly RecordMergeMove[],
  removed: RecordMergeSnapshot["removed"],
  replayed: boolean,
): MergeResult {
  return {
    mergeId: record.id,
    survivorId: pair.survivorId,
    mergedId: pair.mergedId,
    moves: countsOf(moves),
    alreadyHeld: { contactPoints: removed.contactPointIds.length, memberships: removed.membershipIds.length },
    undoUntil: new Date(record.mergedAt.getTime() + MERGE_UNDO_DAYS * DAY_MS).toISOString(),
    replayed,
  };
}

/** The newest merge of `mergedId` into `survivorId` not undone, answered
 *  again; undefined when there is none. Its jsonb is parsed before use. */
async function replayMerge(tx: PeopleTx, venueId: string, mergedId: string, survivorId: string): Promise<MergeResult | undefined> {
  const [record] = await tx.select({
    id: recordMerges.id,
    mergedAt: recordMerges.mergedAt,
    moves: recordMerges.moves,
    snapshot: recordMerges.snapshot,
  }).from(recordMerges)
    .where(and(
      eq(recordMerges.venueId, venueId),
      eq(recordMerges.kind, "person"),
      eq(recordMerges.mergedId, mergedId),
      eq(recordMerges.survivorId, survivorId),
      isNull(recordMerges.undoneAt),
    ))
    .orderBy(desc(recordMerges.mergedAt), desc(recordMerges.id))
    .limit(1);
  if (record === undefined) return undefined;
  const moves = RecordMergeMoveSchema.array().safeParse(record.moves);
  const snapshot = RecordMergeSnapshotSchema.safeParse(record.snapshot);
  if (!moves.success || !snapshot.success) throw new UnreadableMergeRecord(record.id);
  return resultOf(record, { survivorId, mergedId }, moves.data, snapshot.data.removed, true);
}

const IdRowsSchema = z.array(z.object({ id: z.string().uuid() }));

/** The ids a DELETE or UPDATE … RETURNING id wrote. */
async function idsWritten(tx: PeopleTx, statement: SQL): Promise<string[]> {
  const result = await tx.execute(statement);
  return IdRowsSchema.parse(result.rows).map((row) => row.id);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Steps 3 to 13: everything after the checks, on two locked, live people. */
async function mergeLocked(tx: PeopleTx, closing: ContactRow, survivor: ContactRow, actorId: string): Promise<MergeResult> {
  const venueId = closing.venueId;
  const L = closing.id;
  const S = survivor.id;

  // So a person an older writer left without points keeps their email,
  // phone and organisation through the merge (and S its own).
  await adoptLegacyMirror(tx, closing);
  await adoptLegacyMirror(tx, survivor);

  // 3. The snapshot: L as they are, and every point and membership they hold.
  const points = await tx.select().from(contactPoints)
    .where(and(eq(contactPoints.contactId, L), eq(contactPoints.venueId, venueId)))
    .orderBy(asc(contactPoints.createdAt), asc(contactPoints.id));
  const memberships = await tx.select().from(accountMemberships)
    .where(and(eq(accountMemberships.contactId, L), eq(accountMemberships.venueId, venueId)))
    .orderBy(asc(accountMemberships.createdAt), asc(accountMemberships.id));

  // 4. Points: those S holds go (kept in the snapshot); the rest move, each
  // primary only while S has no primary of its kind.
  const removedPointIds = await idsWritten(tx, sql`
    DELETE FROM contact_points p
     WHERE p.contact_id = ${L} AND p.venue_id = ${venueId}
       AND EXISTS (SELECT 1 FROM contact_points s
                    WHERE s.contact_id = ${S} AND s.venue_id = ${venueId} AND s.kind = p.kind AND s.value = p.value)
    RETURNING p.id
  `);
  const movedPointIds = await idsWritten(tx, sql`
    UPDATE contact_points p
       SET contact_id = ${S},
           is_primary = p.is_primary AND NOT EXISTS (
             SELECT 1 FROM contact_points s
              WHERE s.contact_id = ${S} AND s.venue_id = ${venueId} AND s.kind = p.kind AND s.is_primary),
           updated_at = clock_timestamp()
     WHERE p.contact_id = ${L} AND p.venue_id = ${venueId}
    RETURNING p.id
  `);

  // 5. Memberships: of organisations S belongs to, they go; the rest move,
  // primary only while S has no primary membership.
  const removedMembershipIds = await idsWritten(tx, sql`
    DELETE FROM account_memberships m
     WHERE m.contact_id = ${L} AND m.venue_id = ${venueId}
       AND EXISTS (SELECT 1 FROM account_memberships s
                    WHERE s.contact_id = ${S} AND s.venue_id = ${venueId} AND s.client_account_id = m.client_account_id)
    RETURNING m.id
  `);
  const movedMembershipIds = await idsWritten(tx, sql`
    UPDATE account_memberships m
       SET contact_id = ${S},
           is_primary = m.is_primary AND NOT EXISTS (
             SELECT 1 FROM account_memberships s WHERE s.contact_id = ${S} AND s.venue_id = ${venueId} AND s.is_primary),
           updated_at = clock_timestamp()
     WHERE m.contact_id = ${L} AND m.venue_id = ${venueId}
    RETURNING m.id
  `);

  // 6 to 9. Every other reference to L, changing no other column.
  const movedEnquiryIds = (await tx.update(enquiries).set({ contactId: S })
    .where(and(eq(enquiries.contactId, L), eq(enquiries.venueId, venueId)))
    .returning({ id: enquiries.id })).map((row) => row.id);
  const movedDealIds = (await tx.update(opportunities).set({ primaryContactId: S })
    .where(and(eq(opportunities.primaryContactId, L), eq(opportunities.venueId, venueId)))
    .returning({ id: opportunities.id })).map((row) => row.id);
  // FOR NO KEY UPDATE on each organisation: see the header for why this,
  // after the people, cannot deadlock with a deal being written.
  const movedOrganisationIds = (await tx.update(clientAccounts).set({ primaryContactId: S })
    .where(and(eq(clientAccounts.primaryContactId, L), eq(clientAccounts.venueId, venueId)))
    .returning({ id: clientAccounts.id })).map((row) => row.id);
  // Earlier tombstones follow L to S, so every tombstone is one hop from a
  // live record. Merges at the venue are serialised by the advisory lock, and
  // no other writer holds a tombstone while it waits for a live person.
  const movedTombstoneIds = (await tx.update(contacts).set({ mergedIntoId: S })
    .where(and(eq(contacts.mergedIntoId, L), eq(contacts.venueId, venueId)))
    .returning({ id: contacts.id })).map((row) => row.id);

  // 10. S's empty fields, filled from L; the later last contact of the two.
  const survivorFilled: RecordMergeSnapshot["survivorFilled"] = [];
  const filled: PgUpdateSetSource<typeof contacts> = {};
  for (const field of MERGE_FILLED_FIELDS) {
    if (field === "lastContactAt") {
      const before = survivor.lastContactAt;
      const after = closing.lastContactAt;
      if (after !== null && (before === null || after.getTime() > before.getTime())) {
        filled.lastContactAt = after;
        survivorFilled.push({ field, before: iso(before), after: after.toISOString() });
      }
      continue;
    }
    const before = survivor[field];
    const after = closing[field];
    if (before === null && after !== null) {
      filled[field] = after;
      survivorFilled.push({ field, before, after });
    }
  }
  if (survivorFilled.length > 0) {
    await tx.update(contacts).set(filled).where(and(eq(contacts.id, S), eq(contacts.venueId, venueId)));
  }

  // 11. S's mirrors from its primaries.
  await refreshContactMirror(tx, S);

  // 12. L becomes a tombstone. Its mirrors follow the points and memberships
  // it no longer holds (none), which also moves updated_at on: a stale email
  // left on a tombstone would be adopted back by the undo's adoptLegacyMirror
  // before its own point could be restored.
  await tx.update(contacts).set({ mergedIntoId: S, deletedAt: sql`now()` })
    .where(and(eq(contacts.id, L), eq(contacts.venueId, venueId)));
  await refreshContactMirror(tx, L);

  // 13. The record, with everything an undo needs.
  const moved: Record<MergeMoveTarget, string[]> = {
    "contact_points.contact_id": movedPointIds,
    "account_memberships.contact_id": movedMembershipIds,
    "enquiries.contact_id": movedEnquiryIds,
    "opportunities.primary_contact_id": movedDealIds,
    "client_accounts.primary_contact_id": movedOrganisationIds,
    "contacts.merged_into_id": movedTombstoneIds,
  };
  const moves: RecordMergeMove[] = MERGE_MOVE_TARGETS.map((target) => ({ target, ids: moved[target] }));
  const snapshot = RecordMergeSnapshotSchema.parse({
    person: { ...toPerson(closing), mergedIntoId: closing.mergedIntoId, erasedAt: iso(closing.erasedAt), deletedAt: iso(closing.deletedAt) },
    contactPoints: points.map((point) => ({
      id: point.id,
      venueId: point.venueId,
      contactId: point.contactId,
      kind: point.kind,
      value: point.value,
      displayValue: point.displayValue,
      label: point.label,
      isPrimary: point.isPrimary,
      sourceSystem: point.sourceSystem,
      sourceId: point.sourceId,
      createdAt: point.createdAt.toISOString(),
      updatedAt: point.updatedAt.toISOString(),
    })),
    memberships: memberships.map((membership) => ({
      id: membership.id,
      venueId: membership.venueId,
      contactId: membership.contactId,
      clientAccountId: membership.clientAccountId,
      roleLabel: membership.roleLabel,
      isPrimary: membership.isPrimary,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    })),
    removed: { contactPointIds: removedPointIds, membershipIds: removedMembershipIds },
    survivorFilled,
  });
  const [record] = await tx.insert(recordMerges).values({
    venueId,
    kind: "person",
    survivorId: S,
    mergedId: L,
    snapshot,
    moves,
    mergedBy: actorId,
  }).returning({ id: recordMerges.id, mergedAt: recordMerges.mergedAt });
  if (record === undefined) throw new Error("The merge record was not written");
  return resultOf(record, { survivorId: S, mergedId: L }, moves, snapshot.removed, false);
}

/**
 * Merges `mergedId` (L, the record that closes) into `survivorId` (S), in one
 * transaction, or answers why not. A second press of a merge already made
 * answers with that merge (`replayed`); the opposite merge pressed at once
 * waits on the venue's lock and then finds its survivor merged.
 */
export async function applyPersonMerge(
  db: Database,
  scopeVenueId: string | null,
  mergedId: string,
  survivorId: string,
  actorId: string,
): Promise<MergeResult | MergeFailure> {
  const closingId = mergedId.toLowerCase();
  const keptId = survivorId.toLowerCase();
  if (closingId === keptId) return SAME_RECORD;

  return db.transaction(async (tx): Promise<MergeResult | MergeFailure> => {
    // 1. L's venue, then the venue's merge lock.
    const venueId = await venueOf(tx, scopeVenueId, closingId);
    if (venueId === undefined) return NOT_FOUND;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${mergeLockKey(venueId)}, 0))`);

    // 2. Both people, the lower id first, at L's venue; then the checks.
    const [lowId, highId] = closingId < keptId ? [closingId, keptId] : [keptId, closingId];
    const low = await lockPerson(tx, venueId, lowId);
    const high = await lockPerson(tx, venueId, highId);
    const checked = closingId === lowId ? check(low, high, keptId) : check(high, low, keptId);
    if (checked.kind === "replay") {
      return (await replayMerge(tx, venueId, closingId, keptId)) ?? { kind: "already_merged", survivorId: keptId };
    }
    if (checked.kind !== "pair") return checked;
    return mergeLocked(tx, checked.closing, checked.survivor, actorId);
  });
}

// ---------------------------------------------------------------------------
// Undoing a merge (T-665, Task 12).
//
// For MERGE_UNDO_DAYS × 24 hours after it was made, counted by the database's
// clock in hours so no session time zone can stretch or shrink it, a merge of
// L into S can be undone, in one transaction:
// - L is live again;
// - every reference the merge moved that is still on S moves back to L;
// - the points and memberships the merge removed are made again for L, with
//   their own ids;
// - each of L's primaries is set as the record's snapshot had it;
// - each of S's fields the merge filled is put back, while it still holds
//   what the merge put there.
// Whatever a colleague changed since (a deal moved on, a field edited, a
// point removed) is left as they left it and named in the report. The record
// is kept, marked undone with its report, so a second press answers with the
// same report. A merge undone out of order would strand references, so while
// S has itself been merged since, that later merge must be undone first.
//
// Locks, in the merge's order:
// 1. the venue's people-merge advisory lock, so merges and undos at a venue
//    happen one at a time, and a second press waits here and then finds the
//    record undone;
// 2. the record, FOR UPDATE. Every writer of record_merges holds the venue's
//    merge lock first, so this row lock can never be part of a cycle;
// 3. L and S, FOR UPDATE, the lower id first;
// 4. the rows that point at them, by the undo's own UPDATEs and INSERTs,
//    exactly the rows the merge took (see the header above for why the
//    organisations after the people cannot deadlock with a deal being made).
// ---------------------------------------------------------------------------

export type UndoFailure =
  | { kind: "not_found" }
  | { kind: "undo_expired" }
  | { kind: "later_merge_first"; laterMergeId: string }
  | { kind: "erased" };

/** A refusal rather than an undo. */
export function isUndoFailure(answer: MergeUndoResult | UndoFailure): answer is UndoFailure {
  return "kind" in answer;
}

/** How long a merge can be undone, in hours: 30 × 24, never "30 days", which
 *  daylight saving in the session's time zone would move by an hour. */
const UNDO_WINDOW_HOURS = MERGE_UNDO_DAYS * 24;

/** A merge record's jsonb, parsed and checked against the record. */
interface ReadableMerge {
  readonly id: string;
  readonly venueId: string;
  readonly mergedId: string;
  readonly survivorId: string;
  readonly moves: ReadonlyMap<MergeMoveTarget, readonly string[]>;
  readonly snapshot: RecordMergeSnapshot;
}

/**
 * The record's moves and snapshot, parsed with their schemas and checked
 * against the record itself before anything is written from them: every
 * target once; the snapshot of the merged person, at the record's venue, with
 * every point and membership theirs and there; and every removed row in the
 * snapshot. Anything else is an unreadable record.
 */
function readMerge(record: {
  id: string; venueId: string; mergedId: string; survivorId: string; moves: unknown; snapshot: unknown;
}): ReadableMerge {
  const moves = RecordMergeMoveSchema.array().safeParse(record.moves);
  const snapshot = RecordMergeSnapshotSchema.safeParse(record.snapshot);
  if (!moves.success || !snapshot.success) throw new UnreadableMergeRecord(record.id);
  const kept = snapshot.data;
  const byTarget = new Map(moves.data.map((move) => [move.target, move.ids] as const));
  const theirs = (row: { venueId: string; contactId: string }): boolean =>
    row.venueId === record.venueId && row.contactId === record.mergedId;
  const pointIds = new Set(kept.contactPoints.map((point) => point.id));
  const membershipIds = new Set(kept.memberships.map((membership) => membership.id));
  const agrees = moves.data.length === MERGE_MOVE_TARGETS.length && byTarget.size === MERGE_MOVE_TARGETS.length
    && kept.person.id === record.mergedId && kept.person.venueId === record.venueId
    && kept.contactPoints.every(theirs) && kept.memberships.every(theirs)
    && kept.removed.contactPointIds.every((id) => pointIds.has(id))
    && kept.removed.membershipIds.every((id) => membershipIds.has(id));
  if (!agrees) throw new UnreadableMergeRecord(record.id);
  return { id: record.id, venueId: record.venueId, mergedId: record.mergedId, survivorId: record.survivorId, moves: byTarget, snapshot: kept };
}

/** The person as stored, FOR UPDATE, whatever their state; undefined when
 *  there is no such person at the venue. */
async function lockRow(tx: PeopleTx, venueId: string, personId: string): Promise<ContactRow | undefined> {
  const [row] = await tx.select().from(contacts)
    .where(and(eq(contacts.id, personId), eq(contacts.venueId, venueId)))
    .limit(1)
    .for("update");
  return row;
}

/** The newest merge of the person into anyone that has not been undone. */
async function newestMergeOf(tx: PeopleTx, venueId: string, personId: string): Promise<string | undefined> {
  const [record] = await tx.select({ id: recordMerges.id }).from(recordMerges)
    .where(and(
      eq(recordMerges.venueId, venueId),
      eq(recordMerges.kind, "person"),
      eq(recordMerges.mergedId, personId),
      isNull(recordMerges.undoneAt),
    ))
    .orderBy(desc(recordMerges.mergedAt), desc(recordMerges.id))
    .limit(1);
  return record?.id;
}

/**
 * Step 6 for one target: of the rows the merge moved from L to S, those still
 * on S move back to L; answers the ids moved. Points and memberships come back
 * not primary (step 8 sets L's primaries). Each UPDATE changes no other column.
 */
async function moveBack(tx: PeopleTx, merge: ReadableMerge, target: MergeMoveTarget): Promise<string[]> {
  const ids = [...(merge.moves.get(target) ?? [])];
  if (ids.length === 0) return [];
  const { venueId, mergedId: L, survivorId: S } = merge;
  switch (target) {
    case "contact_points.contact_id":
      return (await tx.update(contactPoints).set({ contactId: L, isPrimary: false, updatedAt: sql`clock_timestamp()` })
        .where(and(inArray(contactPoints.id, ids), eq(contactPoints.contactId, S), eq(contactPoints.venueId, venueId)))
        .returning({ id: contactPoints.id })).map((row) => row.id);
    case "account_memberships.contact_id":
      return (await tx.update(accountMemberships).set({ contactId: L, isPrimary: false, updatedAt: sql`clock_timestamp()` })
        .where(and(inArray(accountMemberships.id, ids), eq(accountMemberships.contactId, S), eq(accountMemberships.venueId, venueId)))
        .returning({ id: accountMemberships.id })).map((row) => row.id);
    case "enquiries.contact_id":
      return (await tx.update(enquiries).set({ contactId: L })
        .where(and(inArray(enquiries.id, ids), eq(enquiries.contactId, S), eq(enquiries.venueId, venueId)))
        .returning({ id: enquiries.id })).map((row) => row.id);
    case "opportunities.primary_contact_id":
      return (await tx.update(opportunities).set({ primaryContactId: L })
        .where(and(inArray(opportunities.id, ids), eq(opportunities.primaryContactId, S), eq(opportunities.venueId, venueId)))
        .returning({ id: opportunities.id })).map((row) => row.id);
    case "client_accounts.primary_contact_id":
      return (await tx.update(clientAccounts).set({ primaryContactId: L })
        .where(and(inArray(clientAccounts.id, ids), eq(clientAccounts.primaryContactId, S), eq(clientAccounts.venueId, venueId)))
        .returning({ id: clientAccounts.id })).map((row) => row.id);
    case "contacts.merged_into_id":
      return (await tx.update(contacts).set({ mergedIntoId: L })
        .where(and(inArray(contacts.id, ids), eq(contacts.mergedIntoId, S), eq(contacts.venueId, venueId)))
        .returning({ id: contacts.id })).map((row) => row.id);
  }
}

/** The snapshot's rows with these ids, in the order the ids are listed. */
function rowsFor<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}

/**
 * Step 7: the points and memberships the merge removed (S held their like),
 * made again for L as the snapshot kept them, with their own ids and times,
 * not primary. Target-less: any row a unique key refuses is not made, and is
 * named in the report. Answers the ids made.
 */
async function remakeRemoved(tx: PeopleTx, merge: ReadableMerge): Promise<{ points: string[]; memberships: string[] }> {
  const { venueId, mergedId: L, snapshot } = merge;
  const points = rowsFor(snapshot.contactPoints, snapshot.removed.contactPointIds);
  const memberships = rowsFor(snapshot.memberships, snapshot.removed.membershipIds);
  const madePoints = points.length === 0 ? [] : await tx.insert(contactPoints).values(points.map((point) => ({
    id: point.id,
    venueId,
    contactId: L,
    kind: point.kind,
    value: point.value,
    displayValue: point.displayValue,
    label: point.label,
    isPrimary: false,
    sourceSystem: point.sourceSystem,
    sourceId: point.sourceId,
    createdAt: new Date(point.createdAt),
    updatedAt: new Date(point.updatedAt),
  }))).onConflictDoNothing().returning({ id: contactPoints.id });
  const madeMemberships = memberships.length === 0 ? [] : await tx.insert(accountMemberships).values(memberships.map((membership) => ({
    id: membership.id,
    venueId,
    contactId: L,
    clientAccountId: membership.clientAccountId,
    roleLabel: membership.roleLabel,
    isPrimary: false,
    createdAt: new Date(membership.createdAt),
    updatedAt: new Date(membership.updatedAt),
  }))).onConflictDoNothing().returning({ id: accountMemberships.id });
  return { points: madePoints.map((row) => row.id), memberships: madeMemberships.map((row) => row.id) };
}

/**
 * Step 8: each point and membership the snapshot had primary, now back on L,
 * is L's primary again; any other primary of its kind on L stops being one
 * first, so the one-primary keys never see two.
 */
async function restorePrimaries(tx: PeopleTx, merge: ReadableMerge, back: { points: ReadonlySet<string>; memberships: ReadonlySet<string> }): Promise<void> {
  const { venueId, mergedId: L, snapshot } = merge;
  for (const point of snapshot.contactPoints) {
    if (!point.isPrimary || !back.points.has(point.id)) continue;
    await tx.update(contactPoints).set({ isPrimary: false, updatedAt: sql`clock_timestamp()` })
      .where(and(
        eq(contactPoints.contactId, L),
        eq(contactPoints.venueId, venueId),
        eq(contactPoints.kind, point.kind),
        eq(contactPoints.isPrimary, true),
        ne(contactPoints.id, point.id),
      ));
    await tx.update(contactPoints).set({ isPrimary: true, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(contactPoints.id, point.id), eq(contactPoints.contactId, L), eq(contactPoints.venueId, venueId)));
  }
  for (const membership of snapshot.memberships) {
    if (!membership.isPrimary || !back.memberships.has(membership.id)) continue;
    await tx.update(accountMemberships).set({ isPrimary: false, updatedAt: sql`clock_timestamp()` })
      .where(and(
        eq(accountMemberships.contactId, L),
        eq(accountMemberships.venueId, venueId),
        eq(accountMemberships.isPrimary, true),
        ne(accountMemberships.id, membership.id),
      ));
    await tx.update(accountMemberships).set({ isPrimary: true, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(accountMemberships.id, membership.id), eq(accountMemberships.contactId, L), eq(accountMemberships.venueId, venueId)));
  }
}

/**
 * Step 9: each of S's fields the merge filled goes back to what it was, only
 * while it still holds what the merge put there (a last contact compared to
 * the millisecond, the precision the record keeps). Answers the fields left
 * as someone has changed them since.
 */
async function emptyFilled(tx: PeopleTx, merge: ReadableMerge): Promise<MergeSkip[]> {
  const skipped: MergeSkip[] = [];
  for (const { field, before, after } of merge.snapshot.survivorFilled) {
    const column = contacts[field];
    const set: PgUpdateSetSource<typeof contacts> = {};
    let unchanged: SQL;
    if (field === "lastContactAt") {
      set.lastContactAt = before === null ? null : new Date(before);
      unchanged = sql`date_trunc('milliseconds', ${column}) IS NOT DISTINCT FROM ${after}::timestamptz`;
    } else {
      set[field] = before;
      unchanged = sql`${column} IS NOT DISTINCT FROM ${after}`;
    }
    const put = await tx.update(contacts).set(set)
      .where(and(eq(contacts.id, merge.survivorId), eq(contacts.venueId, merge.venueId), unchanged))
      .returning({ id: contacts.id });
    if (put.length === 0) skipped.push({ target: "survivor_field", ref: field });
  }
  return skipped;
}

/** Steps 5 to 11 on a readable, unexpired record whose two people are locked:
 *  L the tombstone of S, neither erased. */
async function undoLocked(tx: PeopleTx, merge: ReadableMerge, actorId: string): Promise<MergeUndoResult> {
  const { venueId, mergedId: L, survivorId: S, snapshot } = merge;

  // 5. L is live again. updated_at moves on in step 10, by the book's own
  // stamp, which is always past the tombstone's (a bare now() might not be).
  const deletedAt = snapshot.person.deletedAt;
  await tx.update(contacts).set({ mergedIntoId: null, deletedAt: deletedAt === null ? null : new Date(deletedAt) })
    .where(and(eq(contacts.id, L), eq(contacts.venueId, venueId)));

  // 6. Every reference still on S moves back, in the reverse of the merge's
  // order; each one no longer on S stays where it is, named.
  const skipped: MergeSkip[] = [];
  const back = new Map<MergeMoveTarget, string[]>();
  for (const target of [...MERGE_MOVE_TARGETS].reverse()) {
    const moved = await moveBack(tx, merge, target);
    back.set(target, moved);
    const returned = new Set(moved);
    for (const id of merge.moves.get(target) ?? []) {
      if (!returned.has(id)) skipped.push({ target, ref: id });
    }
  }

  // 7. What the merge removed, made again.
  const made = await remakeRemoved(tx, merge);
  const madePoints = new Set(made.points);
  const madeMemberships = new Set(made.memberships);
  for (const id of snapshot.removed.contactPointIds) {
    if (!madePoints.has(id)) skipped.push({ target: "removed_row", ref: id });
  }
  for (const id of snapshot.removed.membershipIds) {
    if (!madeMemberships.has(id)) skipped.push({ target: "removed_row", ref: id });
  }

  // 8. L's primaries, as they were.
  const pointsBack = [...(back.get("contact_points.contact_id") ?? []), ...made.points];
  const membershipsBack = [...(back.get("account_memberships.contact_id") ?? []), ...made.memberships];
  await restorePrimaries(tx, merge, { points: new Set(pointsBack), memberships: new Set(membershipsBack) });

  // 9. S's filled fields, emptied again where nobody has changed them.
  skipped.push(...await emptyFilled(tx, merge));

  // 10. Both people's mirrors from their primaries (a kind left with no
  // primary has its oldest point promoted).
  await refreshContactMirror(tx, L);
  await refreshContactMirror(tx, S);

  // 11. The record, undone, with its report. Parsed before it is written, so
  // a second press can always read it back.
  const restored: MergeMoves = {
    "contact_points.contact_id": pointsBack.length,
    "account_memberships.contact_id": membershipsBack.length,
    "enquiries.contact_id": back.get("enquiries.contact_id")?.length ?? 0,
    "opportunities.primary_contact_id": back.get("opportunities.primary_contact_id")?.length ?? 0,
    "client_accounts.primary_contact_id": back.get("client_accounts.primary_contact_id")?.length ?? 0,
    "contacts.merged_into_id": back.get("contacts.merged_into_id")?.length ?? 0,
  };
  const report = MergeUndoReportSchema.parse({ restored, skipped });
  await tx.update(recordMerges).set({ undoneAt: sql`now()`, undoneBy: actorId, undoReport: report })
    .where(eq(recordMerges.id, merge.id));
  return { mergeId: merge.id, ...report, replayed: false };
}

/**
 * Undoes the merge `mergeId` within MERGE_UNDO_DAYS of its making, in one
 * transaction, or answers why not; a refusal keeps nothing (writeOrRefuse).
 * A merge already undone answers with the same report (`replayed`). The
 * restored counts are the rows back on L by each target: for points and
 * memberships, those moved back and those made again.
 */
export async function undoPersonMerge(
  db: Database,
  scopeVenueId: string | null,
  mergeId: string,
  actorId: string,
): Promise<MergeUndoResult | UndoFailure> {
  const id = mergeId.toLowerCase();

  return writeOrRefuse<MergeUndoResult | UndoFailure>(db, async (tx, refuse) => {
    // 1. The record within the actor's scope; the venue's merge lock; then the
    // record again, held, as it stands once every earlier merge or undo at the
    // venue has finished.
    const [found] = await tx.select({ venueId: recordMerges.venueId }).from(recordMerges)
      .where(and(
        eq(recordMerges.id, id),
        eq(recordMerges.kind, "person"),
        scopeVenueId === null ? undefined : eq(recordMerges.venueId, scopeVenueId),
      ))
      .limit(1);
    if (found === undefined) return refuse({ kind: "not_found" });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${mergeLockKey(found.venueId)}, 0))`);
    const [record] = await tx.select({
      id: recordMerges.id,
      venueId: recordMerges.venueId,
      mergedId: recordMerges.mergedId,
      survivorId: recordMerges.survivorId,
      moves: recordMerges.moves,
      snapshot: recordMerges.snapshot,
      undoneAt: recordMerges.undoneAt,
      undoReport: recordMerges.undoReport,
      // 30 × 24 hours by the database's clock.
      expired: sql<boolean>`${recordMerges.mergedAt} + make_interval(hours => ${UNDO_WINDOW_HOURS}) <= now()`,
    }).from(recordMerges)
      .where(eq(recordMerges.id, id))
      .limit(1)
      .for("update");
    // record_merges rows are never deleted.
    if (record === undefined) throw new Error(`Merge record ${id} could not be read again`);

    // 2. Undone already: the same report again.
    if (record.undoneAt !== null) {
      const report = MergeUndoReportSchema.safeParse(record.undoReport);
      if (!report.success) throw new UnreadableMergeRecord(record.id);
      return { mergeId: record.id, ...report.data, replayed: true };
    }

    // 3. Past the window.
    if (record.expired) return refuse({ kind: "undo_expired" });
    const merge = readMerge(record);

    // 4. Both people, the lower id first; what an older writer left on them
    // is adopted before anything moves back. Then the checks: neither erased,
    // and L still S's tombstone (else S has been merged since, and that merge
    // comes first).
    const [lowId, highId] = merge.mergedId < merge.survivorId
      ? [merge.mergedId, merge.survivorId]
      : [merge.survivorId, merge.mergedId];
    const low = await lockRow(tx, merge.venueId, lowId);
    const high = await lockRow(tx, merge.venueId, highId);
    const closing = merge.mergedId === lowId ? low : high;
    const survivor = merge.mergedId === lowId ? high : low;
    if (closing === undefined || survivor === undefined) {
      throw new Error(`Merge record ${merge.id} names a person who is not at its venue`);
    }
    await adoptLegacyMirror(tx, closing);
    await adoptLegacyMirror(tx, survivor);
    if (closing.erasedAt !== null || survivor.erasedAt !== null) return refuse({ kind: "erased" });
    if (closing.mergedIntoId !== merge.survivorId) {
      const later = await newestMergeOf(tx, merge.venueId, merge.survivorId);
      if (later === undefined) throw new Error(`Merge record ${merge.id}'s merged person is not its survivor's tombstone`);
      return refuse({ kind: "later_merge_first", laterMergeId: later });
    }

    return undoLocked(tx, merge, actorId);
  });
}

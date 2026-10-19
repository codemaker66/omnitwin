import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  MERGE_FILLED_FIELDS,
  MERGE_MOVE_TARGETS,
  MERGE_UNDO_DAYS,
  RecordMergeMoveSchema,
  RecordMergeSnapshotSchema,
  type MergeMoves,
  type MergeMoveTarget,
  type MergePreview,
  type MergeResult,
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
  if (!moves.success || !snapshot.success) throw new Error(`Merge record ${record.id} does not match its schema`);
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

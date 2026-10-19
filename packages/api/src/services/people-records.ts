import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql, TransactionRollbackError, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
  ClientAccountKindSchema,
  ContactPointKindSchema,
  ContactPointLabelSchema,
  isUsablePhone,
  normaliseEmail,
  normalisePhone,
  type ContactPoint,
  type ContactPointInput,
  type ContactPointKind,
  type Person,
  type PersonProfile,
  type SetMemberships,
  type UpdatePerson,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { accountMemberships, clientAccounts, contactPoints, contacts, recordMerges, users } from "../db/schema.js";
import { canManageCommercial } from "../utils/query.js";
import { countDuplicateSuggestions } from "./people-duplicates.js";

// ---------------------------------------------------------------------------
// The People Book's records (T-665): the shared connection types, the "live"
// predicates every People Book query uses, and the writes behind /people.
//
// A person is live while it is neither deleted, merged nor erased; a merged
// person is a tombstone (merged_into_id and deleted_at set together) and is
// never deleted. An organisation is live while it is neither deleted nor
// merged.
//
// Every write runs inside one transaction that has locked the person first
// (lockPerson), so the rows that point at the person are only ever changed
// by the one writer holding that lock. The legacy columns contacts.email,
// contacts.phone and contacts.client_account_id mirror the primary email,
// phone and membership; refreshContactMirror rewrites them in the same
// transaction as every write to points or memberships.
// ---------------------------------------------------------------------------

/** A transaction on the People Book's database. */
export type PeopleTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The database itself or a transaction on it. */
export type PeopleConn = Database | PeopleTx;

/**
 * One write transaction whose refusals keep nothing: `work` either returns an
 * answer, which commits, or calls `refuse(answer)`, which rolls back every row
 * the transaction wrote (adopted legacy rows included) and returns that answer.
 */
export async function writeOrRefuse<T>(
  db: Database,
  work: (tx: PeopleTx, refuse: (answer: T) => never) => Promise<T>,
): Promise<T> {
  const refusal: { answer: T | undefined } = { answer: undefined };
  try {
    return await db.transaction((tx) => work(tx, (answer: T): never => {
      refusal.answer = answer;
      return tx.rollback();
    }));
  } catch (error) {
    if (error instanceof TransactionRollbackError && refusal.answer !== undefined) return refusal.answer;
    throw error;
  }
}

/** A live person, on the unaliased `contacts` table. */
export function liveContact(): SQL {
  const live = and(isNull(contacts.deletedAt), isNull(contacts.mergedIntoId), isNull(contacts.erasedAt));
  if (live === undefined) throw new Error("The live person predicate is empty");
  return live;
}

/** A live organisation or household, on the unaliased `client_accounts` table. */
export function liveAccount(): SQL {
  const live = and(isNull(clientAccounts.deletedAt), isNull(clientAccounts.mergedIntoId));
  if (live === undefined) throw new Error("The live organisation predicate is empty");
  return live;
}

/** A person as stored (the API's PersonRow is the serialised shape). */
type ContactRow = typeof contacts.$inferSelect;

export type PersonLock =
  | { state: "missing" }
  | { state: "merged"; mergedIntoId: string }
  | { state: "live"; row: ContactRow };

/** What a person is: erased or absent is missing; a tombstone is merged
 *  (before deleted, since a tombstone is deleted too); else deleted is missing. */
function stateOf(row: ContactRow | undefined): PersonLock {
  if (row === undefined || row.erasedAt !== null) return { state: "missing" };
  if (row.mergedIntoId !== null) return { state: "merged", mergedIntoId: row.mergedIntoId };
  if (row.deletedAt !== null) return { state: "missing" };
  return { state: "live", row };
}

function personAt(scopeVenueId: string | null, personId: string): SQL | undefined {
  return and(eq(contacts.id, personId), scopeVenueId === null ? undefined : eq(contacts.venueId, scopeVenueId));
}

/**
 * Locks the person (`SELECT … FOR UPDATE`) and says what they are: live, a
 * tombstone pointing at the record that speaks for them, or missing (no such
 * person at the scoped venue, deleted or erased). `scopeVenueId` null is a
 * platform admin's unscoped lock.
 */
export async function lockPerson(tx: PeopleTx, scopeVenueId: string | null, personId: string): Promise<PersonLock> {
  const [row] = await tx.select().from(contacts).where(personAt(scopeVenueId, personId)).limit(1).for("update");
  return stateOf(row);
}

/** What lockPerson would answer, read without a lock: for a preview, which
 *  writes nothing and so needs no lock. */
export async function readPersonState(db: PeopleConn, scopeVenueId: string | null, personId: string): Promise<PersonLock> {
  const [row] = await db.select().from(contacts).where(personAt(scopeVenueId, personId)).limit(1);
  return stateOf(row);
}

export interface NewPerson {
  venueId: string;
  name: string;
  givenName?: string | null;
  familyName?: string | null;
  jobTitle?: string | null;
  roleLabel?: string | null;
  postalAddress?: string | null;
  notes?: string | null;
  ownerUserId: string | null;
  sourceEnquiryId?: string | null;
  lastContactAt?: Date | null;
  contactPoints: readonly ContactPointInput[];
}

/** The updated_at a write stamps: now, and always at least a millisecond past
 *  the last stamp, so an edit made from an older read can never match it. */
function nextUpdatedAt(): SQL {
  return sql`GREATEST(${new Date().toISOString()}::timestamptz, date_trunc('milliseconds', ${contacts.updatedAt}) + interval '1 millisecond')`;
}

/** A new person, then each of their points, then the mirrors. */
export async function insertPerson(tx: PeopleTx, input: NewPerson): Promise<string> {
  const [row] = await tx.insert(contacts).values({
    venueId: input.venueId,
    name: input.name,
    givenName: input.givenName ?? null,
    familyName: input.familyName ?? null,
    jobTitle: input.jobTitle ?? null,
    roleLabel: input.roleLabel ?? null,
    postalAddress: input.postalAddress ?? null,
    notes: input.notes ?? null,
    ownerUserId: input.ownerUserId,
    sourceEnquiryId: input.sourceEnquiryId ?? null,
    lastContactAt: input.lastContactAt ?? null,
  }).returning({ id: contacts.id });
  if (row === undefined) throw new Error("The person insert returned no row");
  const person = { id: row.id, venueId: input.venueId };
  for (const point of input.contactPoints) {
    await upsertContactPoint(tx, person, point);
  }
  await refreshContactMirror(tx, row.id);
  return row.id;
}

function normalisedValue(input: ContactPointInput): string {
  const value = input.kind === "email" ? normaliseEmail(input.value) : normalisePhone(input.value);
  if (value === null) throw new Error("A contact point needs a value");
  return value;
}

async function heldPoint(
  tx: PeopleTx,
  person: { id: string; venueId: string },
  kind: ContactPointKind,
  value: string,
): Promise<{ id: string; isPrimary: boolean } | undefined> {
  const [held] = await tx.select({ id: contactPoints.id, isPrimary: contactPoints.isPrimary }).from(contactPoints)
    .where(and(
      eq(contactPoints.contactId, person.id),
      eq(contactPoints.venueId, person.venueId),
      eq(contactPoints.kind, kind),
      eq(contactPoints.value, value),
    ))
    .limit(1);
  return held;
}

async function holdsPrimary(tx: PeopleTx, person: { id: string; venueId: string }, kind: ContactPointKind): Promise<boolean> {
  const [primary] = await tx.select({ id: contactPoints.id }).from(contactPoints)
    .where(and(
      eq(contactPoints.contactId, person.id),
      eq(contactPoints.venueId, person.venueId),
      eq(contactPoints.kind, kind),
      eq(contactPoints.isPrimary, true),
    ))
    .limit(1);
  return primary !== undefined;
}

/** Makes one point the person's primary of its kind: the others first, so the
 *  one-primary index never sees two. */
async function promotePoint(tx: PeopleTx, person: { id: string; venueId: string }, kind: ContactPointKind, pointId: string): Promise<void> {
  await tx.update(contactPoints).set({ isPrimary: false, updatedAt: new Date() })
    .where(and(
      eq(contactPoints.contactId, person.id),
      eq(contactPoints.venueId, person.venueId),
      eq(contactPoints.kind, kind),
      eq(contactPoints.isPrimary, true),
      ne(contactPoints.id, pointId),
    ));
  await tx.update(contactPoints).set({ isPrimary: true, updatedAt: new Date() })
    .where(and(eq(contactPoints.id, pointId), eq(contactPoints.contactId, person.id), eq(contactPoints.venueId, person.venueId)));
}

/**
 * Adds an email or a phone to a person who is locked and live. A value the
 * person already holds, however it was typed, answers with that point
 * (`created: false`), made primary first when asked. A new point is primary
 * when asked or when the person has no primary of that kind yet. The mirrors
 * follow.
 */
export async function upsertContactPoint(
  tx: PeopleTx,
  person: { id: string; venueId: string },
  input: ContactPointInput,
): Promise<{ pointId: string; created: boolean }> {
  const value = normalisedValue(input);
  let held = await heldPoint(tx, person, input.kind, value);
  let created = false;
  if (held === undefined) {
    // Target-less: a schema built from Drizzle without the unique keys still
    // takes it. created_at is the statement's clock, so points written in one
    // transaction keep the order they were written in.
    const [inserted] = await tx.insert(contactPoints).values({
      venueId: person.venueId,
      contactId: person.id,
      kind: input.kind,
      value,
      displayValue: input.value.trim(),
      label: input.label,
      isPrimary: false,
      createdAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    }).onConflictDoNothing().returning({ id: contactPoints.id });
    if (inserted !== undefined) {
      held = { id: inserted.id, isPrimary: false };
      created = true;
    } else {
      held = await heldPoint(tx, person, input.kind, value);
      if (held === undefined) throw new Error("The contact point was neither written nor found");
    }
  }
  const promote = created
    ? input.isPrimary || !(await holdsPrimary(tx, person, input.kind))
    : input.isPrimary && !held.isPrimary;
  if (promote) await promotePoint(tx, person, input.kind, held.id);
  await refreshContactMirror(tx, person.id);
  return { pointId: held.id, created };
}

/** Removes one of this person's points; false when the point is not theirs. */
export async function removeContactPoint(tx: PeopleTx, personId: string, pointId: string): Promise<boolean> {
  const removed = await tx.delete(contactPoints)
    .where(and(eq(contactPoints.id, pointId), eq(contactPoints.contactId, personId)))
    .returning({ id: contactPoints.id });
  if (removed.length === 0) return false;
  await refreshContactMirror(tx, personId);
  return true;
}

/**
 * Sets the organisations a locked, live person belongs to. Every organisation
 * must be live at the person's venue, or nothing changes. Memberships not in
 * the list go; the rest are written, the one marked primary (else the first)
 * primary. A role label left out keeps the one already held. The mirrors
 * follow.
 */
export async function setPersonMemberships(
  tx: PeopleTx,
  person: { id: string; venueId: string },
  input: SetMemberships,
): Promise<"ok" | "organisation_not_found"> {
  // One entry per organisation, its id as the database writes it (the schema
  // refuses repeats, but not one id typed in two cases).
  const wanted = [...new Map(input.memberships.map((membership) => {
    const organisationId = membership.organisationId.toLowerCase();
    return [organisationId, { ...membership, organisationId }] as const;
  })).values()];
  const ids = wanted.map((membership) => membership.organisationId);
  if (ids.length > 0) {
    const found = await tx.select({ id: clientAccounts.id }).from(clientAccounts)
      .where(and(inArray(clientAccounts.id, ids), eq(clientAccounts.venueId, person.venueId), liveAccount()));
    if (found.length !== ids.length) return "organisation_not_found";
  }

  await tx.delete(accountMemberships).where(and(
    eq(accountMemberships.contactId, person.id),
    eq(accountMemberships.venueId, person.venueId),
    ids.length === 0 ? undefined : notInArray(accountMemberships.clientAccountId, ids),
  ));

  const primaryId = (wanted.find((membership) => membership.isPrimary) ?? wanted[0])?.organisationId;
  if (primaryId !== undefined) {
    await tx.update(accountMemberships).set({ isPrimary: false, updatedAt: new Date() }).where(and(
      eq(accountMemberships.contactId, person.id),
      eq(accountMemberships.venueId, person.venueId),
      eq(accountMemberships.isPrimary, true),
      ne(accountMemberships.clientAccountId, primaryId),
    ));
  }

  const held = new Map((await tx.select({
    id: accountMemberships.id,
    clientAccountId: accountMemberships.clientAccountId,
    roleLabel: accountMemberships.roleLabel,
    isPrimary: accountMemberships.isPrimary,
  }).from(accountMemberships).where(and(
    eq(accountMemberships.contactId, person.id),
    eq(accountMemberships.venueId, person.venueId),
  ))).map((row) => [row.clientAccountId, row]));

  for (const membership of wanted) {
    const isPrimary = membership.organisationId === primaryId;
    const existing = held.get(membership.organisationId);
    if (existing === undefined) {
      await tx.insert(accountMemberships).values({
        venueId: person.venueId,
        contactId: person.id,
        clientAccountId: membership.organisationId,
        roleLabel: membership.roleLabel ?? null,
        isPrimary,
        createdAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      }).onConflictDoNothing();
      continue;
    }
    const roleLabel = membership.roleLabel === undefined ? existing.roleLabel : membership.roleLabel;
    if (existing.isPrimary === isPrimary && existing.roleLabel === roleLabel) continue;
    await tx.update(accountMemberships).set({ isPrimary, roleLabel, updatedAt: new Date() })
      .where(and(eq(accountMemberships.id, existing.id), eq(accountMemberships.contactId, person.id)));
  }

  await refreshContactMirror(tx, person.id);
  return "ok";
}

async function holdsKind(db: PeopleConn, person: { id: string; venueId: string }, kind: ContactPointKind): Promise<boolean> {
  const [point] = await db.select({ id: contactPoints.id }).from(contactPoints)
    .where(and(eq(contactPoints.contactId, person.id), eq(contactPoints.venueId, person.venueId), eq(contactPoints.kind, kind)))
    .limit(1);
  return point !== undefined;
}

/** What adoptLegacyMirror would write for a person: each point as its
 *  primary of that kind, and the membership as their primary. */
export interface LegacyAdoption {
  readonly points: readonly { kind: ContactPointKind; value: string; displayValue: string }[];
  readonly membership: { clientAccountId: string; roleLabel: string | null } | null;
}

/**
 * What adoptLegacyMirror would bring into the book for this person, by its
 * rules, read without writing (a merge preview counts it as moving).
 */
export async function legacyAdoption(db: PeopleConn, row: ContactRow): Promise<LegacyAdoption> {
  const person = { id: row.id, venueId: row.venueId };
  const points: { kind: ContactPointKind; value: string; displayValue: string }[] = [];

  const email = normaliseEmail(row.email);
  if (row.email !== null && email !== null && !(await holdsKind(db, person, "email"))) {
    points.push({ kind: "email", value: email, displayValue: row.email.trim() });
  }

  const phone = row.phone !== null && isUsablePhone(row.phone) ? normalisePhone(row.phone) : null;
  if (row.phone !== null && phone !== null && !(await holdsKind(db, person, "phone"))) {
    points.push({ kind: "phone", value: phone, displayValue: row.phone.trim() });
  }

  if (row.clientAccountId === null) return { points, membership: null };
  const [membership] = await db.select({ id: accountMemberships.id }).from(accountMemberships)
    .where(and(eq(accountMemberships.contactId, person.id), eq(accountMemberships.venueId, person.venueId)))
    .limit(1);
  if (membership !== undefined) return { points, membership: null };
  const [account] = await db.select({ id: clientAccounts.id }).from(clientAccounts)
    .where(and(eq(clientAccounts.id, row.clientAccountId), eq(clientAccounts.venueId, person.venueId), liveAccount()))
    .limit(1);
  return { points, membership: account === undefined ? null : { clientAccountId: account.id, roleLabel: row.roleLabel } };
}

/**
 * Brings what an older writer left on a person into the book before it is
 * rebuilt from points and memberships. Today's crm.ts from-enquiry writer,
 * and the rows written before 0096 was deployed, set contacts.email, phone
 * and client_account_id with no points and no membership; refreshing such a
 * person would set those columns to NULL and lose them. So:
 * - an email with no email point becomes the primary email point (none when
 *   it normalises to nothing);
 * - a phone with no phone point becomes the primary phone point, only when it
 *   is usable (the backfill's rule; an unusable phone is left to the refresh,
 *   which clears it, as the backfill does);
 * - an organisation with no membership, live at the person's venue, becomes
 *   the primary membership, with the person's role label.
 * Otherwise it does nothing. It never runs inside refreshContactMirror, where
 * removing the last email would adopt it straight back.
 *
 * Every write path that will refresh a person's mirror calls this first, on each person it has locked.
 */
export async function adoptLegacyMirror(tx: PeopleTx, row: ContactRow): Promise<void> {
  const adoption = await legacyAdoption(tx, row);
  for (const point of adoption.points) {
    await tx.insert(contactPoints).values({
      venueId: row.venueId,
      contactId: row.id,
      kind: point.kind,
      value: point.value,
      displayValue: point.displayValue,
      label: "other",
      isPrimary: true,
      createdAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    }).onConflictDoNothing();
  }
  if (adoption.membership !== null) {
    await tx.insert(accountMemberships).values({
      venueId: row.venueId,
      contactId: row.id,
      clientAccountId: adoption.membership.clientAccountId,
      roleLabel: adoption.membership.roleLabel,
      isPrimary: true,
      createdAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    }).onConflictDoNothing();
  }
}

/**
 * Rewrites the person's mirrors from their primaries. A kind of point with no
 * primary has its oldest point (created_at, then id) made primary. A primary
 * membership whose organisation is no longer live (deleted or merged) stops
 * being primary, and when no membership is primary the oldest one whose
 * organisation is live is made primary. Then contacts.email, contacts.phone
 * and contacts.client_account_id are set from the primaries (so the
 * organisation mirrored is always a live one), and updated_at moves on.
 */
export async function refreshContactMirror(tx: PeopleConn, personId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE contact_points SET is_primary = true, updated_at = clock_timestamp()
    WHERE id IN (
      SELECT DISTINCT ON (p.kind) p.id FROM contact_points p
      WHERE p.contact_id = ${personId}
        AND NOT EXISTS (
          SELECT 1 FROM contact_points q WHERE q.contact_id = p.contact_id AND q.kind = p.kind AND q.is_primary
        )
      ORDER BY p.kind, p.created_at, p.id
    )
  `);
  await tx.execute(sql`
    UPDATE account_memberships m SET is_primary = false, updated_at = clock_timestamp()
    FROM client_accounts
    WHERE m.contact_id = ${personId} AND m.is_primary
      AND client_accounts.id = m.client_account_id AND client_accounts.venue_id = m.venue_id
      AND NOT (${liveAccount()})
  `);
  await tx.execute(sql`
    UPDATE account_memberships SET is_primary = true, updated_at = clock_timestamp()
    WHERE id = (
      SELECT m.id FROM account_memberships m
      JOIN client_accounts ON client_accounts.id = m.client_account_id AND client_accounts.venue_id = m.venue_id
      WHERE m.contact_id = ${personId} AND ${liveAccount()}
        AND NOT EXISTS (SELECT 1 FROM account_memberships q WHERE q.contact_id = m.contact_id AND q.is_primary)
      ORDER BY m.created_at, m.id
      LIMIT 1
    )
  `);
  await tx.execute(sql`
    UPDATE contacts SET
      email = (SELECT p.display_value FROM contact_points p WHERE p.contact_id = contacts.id AND p.kind = 'email' AND p.is_primary),
      phone = (SELECT p.display_value FROM contact_points p WHERE p.contact_id = contacts.id AND p.kind = 'phone' AND p.is_primary),
      client_account_id = (SELECT m.client_account_id FROM account_memberships m WHERE m.contact_id = contacts.id AND m.is_primary),
      updated_at = ${nextUpdatedAt()}
    WHERE contacts.id = ${personId}
  `);
}

/** Whether a user is on the venue's own commercial team (a platform admin's
 *  reach across venues does not count). */
export async function isCommercialMember(db: PeopleConn, venueId: string, userId: string): Promise<boolean> {
  const [user] = await db.select({ role: users.role }).from(users)
    .where(and(eq(users.id, userId), eq(users.venueId, venueId)))
    .limit(1);
  return user !== undefined && canManageCommercial({ role: user.role, venueId, platformRole: "none" }, venueId);
}

const EDITABLE_PERSON_FIELDS = [
  "givenName", "familyName", "jobTitle", "roleLabel", "postalAddress", "notes", "ownerUserId",
] as const;

/**
 * Writes the fields an edit names on a locked, live person. With
 * `expectedUpdatedAt`, the edit lands only on the record as it was read
 * (compared to the millisecond, as the API speaks), else it is "stale".
 */
export async function updatePersonFields(tx: PeopleTx, row: ContactRow, patch: UpdatePerson): Promise<"ok" | "stale"> {
  const changes: PgUpdateSetSource<typeof contacts> = { updatedAt: nextUpdatedAt() };
  if (patch.name !== undefined) changes.name = patch.name;
  for (const field of EDITABLE_PERSON_FIELDS) {
    const value = patch[field];
    if (value !== undefined) changes[field] = value;
  }
  const expected = patch.expectedUpdatedAt;
  const updated = await tx.update(contacts).set(changes)
    .where(and(
      eq(contacts.id, row.id),
      eq(contacts.venueId, row.venueId),
      expected === undefined
        ? undefined
        : sql`date_trunc('milliseconds', ${contacts.updatedAt}) = ${new Date(expected).toISOString()}::timestamptz`,
    ))
    .returning({ id: contacts.id });
  return updated.length === 0 ? "stale" : "ok";
}

/** A person as stored, in the API's shape (dates as ISO strings). */
export function toPerson(row: ContactRow): Person {
  return {
    id: row.id,
    venueId: row.venueId,
    name: row.name,
    givenName: row.givenName,
    familyName: row.familyName,
    jobTitle: row.jobTitle,
    postalAddress: row.postalAddress,
    notes: row.notes,
    roleLabel: row.roleLabel,
    email: row.email,
    phone: row.phone,
    clientAccountId: row.clientAccountId,
    ownerUserId: row.ownerUserId,
    lastContactAt: row.lastContactAt === null ? null : row.lastContactAt.toISOString(),
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    sourceEnquiryId: row.sourceEnquiryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toContactPoint(row: typeof contactPoints.$inferSelect): ContactPoint {
  return {
    id: row.id,
    contactId: row.contactId,
    kind: ContactPointKindSchema.parse(row.kind),
    value: row.value,
    displayValue: row.displayValue,
    label: ContactPointLabelSchema.parse(row.label),
    isPrimary: row.isPrimary,
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Where a tombstone went: the record its merged_into_id names (one hop from a
 * live record, as every merge re-points earlier tombstones), with the newest
 * merge of it that has not been undone. Null when no such merge is recorded,
 * which only a tombstone written outside the book's merge can be.
 */
async function readMergedProfile(db: PeopleConn, row: ContactRow, mergedIntoId: string): Promise<PersonProfile | null> {
  const [merge] = await db.select({ id: recordMerges.id, mergedAt: recordMerges.mergedAt }).from(recordMerges)
    .where(and(
      eq(recordMerges.venueId, row.venueId),
      eq(recordMerges.kind, "person"),
      eq(recordMerges.mergedId, row.id),
      isNull(recordMerges.undoneAt),
    ))
    .orderBy(desc(recordMerges.mergedAt), desc(recordMerges.id))
    .limit(1);
  const [into] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts)
    .where(and(eq(contacts.id, mergedIntoId), eq(contacts.venueId, row.venueId)))
    .limit(1);
  if (merge === undefined || into === undefined) return null;
  return { status: "merged", mergedInto: into, mergeId: merge.id, mergedAt: merge.mergedAt.toISOString() };
}

/**
 * A person as the book shows them. A live person: their points (primary
 * first, then oldest), their live organisations (primary first, then by
 * name), their owner and how many possible duplicates they have. A merged
 * person (a tombstone): where they went, and the merge that took them there,
 * so an old link still leads somewhere. Null when there is no such person at
 * the scoped venue, or they are deleted or erased.
 */
export async function readPersonProfile(db: PeopleConn, scopeVenueId: string | null, personId: string): Promise<PersonProfile | null> {
  const [found] = await db.select().from(contacts).where(personAt(scopeVenueId, personId)).limit(1);
  const state = stateOf(found);
  if (state.state === "merged" && found !== undefined) return readMergedProfile(db, found, state.mergedIntoId);
  if (state.state !== "live") return null;
  const row = state.row;

  const points = await db.select().from(contactPoints)
    .where(and(eq(contactPoints.contactId, row.id), eq(contactPoints.venueId, row.venueId)))
    .orderBy(desc(contactPoints.isPrimary), asc(contactPoints.createdAt), asc(contactPoints.id));

  const memberships = await db.select({
    id: accountMemberships.id,
    roleLabel: accountMemberships.roleLabel,
    isPrimary: accountMemberships.isPrimary,
    organisationId: clientAccounts.id,
    organisationName: clientAccounts.name,
    organisationKind: clientAccounts.kind,
  }).from(accountMemberships)
    .innerJoin(clientAccounts, and(
      eq(clientAccounts.id, accountMemberships.clientAccountId),
      eq(clientAccounts.venueId, accountMemberships.venueId),
    ))
    .where(and(eq(accountMemberships.contactId, row.id), eq(accountMemberships.venueId, row.venueId), liveAccount()))
    .orderBy(desc(accountMemberships.isPrimary), asc(clientAccounts.name), asc(accountMemberships.id));

  const owner = row.ownerUserId === null
    ? undefined
    : (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.ownerUserId)).limit(1))[0];

  return {
    status: "live",
    person: toPerson(row),
    contactPoints: points.map(toContactPoint),
    memberships: memberships.map((membership) => ({
      id: membership.id,
      organisation: {
        id: membership.organisationId,
        name: membership.organisationName,
        kind: ClientAccountKindSchema.parse(membership.organisationKind),
      },
      roleLabel: membership.roleLabel,
      isPrimary: membership.isPrimary,
    })),
    owner: owner ?? null,
    duplicateSuggestionCount: await countDuplicateSuggestions(db, row.venueId, row.id),
  };
}

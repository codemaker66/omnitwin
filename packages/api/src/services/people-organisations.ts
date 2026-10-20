import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
  ClientAccountKindSchema,
  type CreateOrganisation,
  type OrganisationProfile,
  type PeopleOrganisation,
  type UpdateOrganisation,
} from "@omnitwin/types";
import { accountMemberships, clientAccounts, contacts, users } from "../db/schema.js";
import { liveAccount, liveContact, type PeopleConn, type PeopleTx } from "./people-records.js";

// ---------------------------------------------------------------------------
// Organisations and households in the People Book (T-665).
//
// An organisation write locks only its own client_accounts row; it never locks
// the contacts rows of its members afterwards. PUT /people/:id/memberships
// takes the person first and the accounts after, so taking them in the other
// order anywhere would be a deadlock waiting for two presses at once. Reading
// the members for a profile is a plain read.
// ---------------------------------------------------------------------------

/** An organisation or household as stored. */
export type OrganisationRow = typeof clientAccounts.$inferSelect;

/** The updated_at a write stamps: now, and always at least a millisecond past
 *  the last stamp, so an edit made from an older read can never match it. */
function nextUpdatedAt(): SQL {
  return sql`GREATEST(${new Date().toISOString()}::timestamptz, date_trunc('milliseconds', ${clientAccounts.updatedAt}) + interval '1 millisecond')`;
}

/**
 * Locks the organisation (`SELECT … FOR UPDATE`) and returns it, or undefined
 * when there is no live organisation with that id at the scoped venue (another
 * venue's, deleted or merged away). `scopeVenueId` null is a platform admin's
 * unscoped lock.
 */
export async function lockOrganisation(
  tx: PeopleTx,
  scopeVenueId: string | null,
  organisationId: string,
): Promise<OrganisationRow | undefined> {
  const [row] = await tx.select().from(clientAccounts)
    .where(and(
      eq(clientAccounts.id, organisationId),
      scopeVenueId === null ? undefined : eq(clientAccounts.venueId, scopeVenueId),
      liveAccount(),
    ))
    .limit(1)
    .for("update");
  return row;
}

/** A new organisation or household; its id. The account type is the
 *  event-client default every older reader expects. */
export async function insertOrganisation(
  tx: PeopleTx,
  input: CreateOrganisation & {
    ownerUserId: string | null;
    createdBy: string;
    primaryContactId?: string | null;
    sourceEnquiryId?: string | null;
  },
): Promise<string> {
  const [row] = await tx.insert(clientAccounts).values({
    venueId: input.venueId,
    name: input.name,
    kind: input.kind,
    accountType: "event_client",
    address: input.address ?? null,
    website: input.website ?? null,
    vatNumber: input.vatNumber ?? null,
    notes: input.notes ?? null,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    primaryContactId: input.primaryContactId ?? null,
    sourceEnquiryId: input.sourceEnquiryId ?? null,
  }).returning({ id: clientAccounts.id });
  if (row === undefined) throw new Error("The organisation insert returned no row");
  return row.id;
}

const EDITABLE_ORGANISATION_FIELDS = ["address", "website", "vatNumber", "notes", "ownerUserId"] as const;

/**
 * Writes the fields an edit names on a locked, live organisation. With
 * `expectedUpdatedAt`, the edit lands only on the record as it was read
 * (compared to the millisecond, as the API speaks), else it is "stale".
 */
export async function updateOrganisationFields(
  tx: PeopleTx,
  row: OrganisationRow,
  patch: UpdateOrganisation,
): Promise<"ok" | "stale"> {
  const changes: PgUpdateSetSource<typeof clientAccounts> = { updatedAt: nextUpdatedAt() };
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.kind !== undefined) changes.kind = patch.kind;
  for (const field of EDITABLE_ORGANISATION_FIELDS) {
    const value = patch[field];
    if (value !== undefined) changes[field] = value;
  }
  const expected = patch.expectedUpdatedAt;
  const updated = await tx.update(clientAccounts).set(changes)
    .where(and(
      eq(clientAccounts.id, row.id),
      eq(clientAccounts.venueId, row.venueId),
      expected === undefined
        ? undefined
        : sql`date_trunc('milliseconds', ${clientAccounts.updatedAt}) = ${new Date(expected).toISOString()}::timestamptz`,
    ))
    .returning({ id: clientAccounts.id });
  return updated.length === 0 ? "stale" : "ok";
}

function toOrganisation(row: OrganisationRow): PeopleOrganisation {
  return {
    id: row.id,
    venueId: row.venueId,
    name: row.name,
    kind: ClientAccountKindSchema.parse(row.kind),
    accountType: row.accountType,
    address: row.address,
    website: row.website,
    vatNumber: row.vatNumber,
    notes: row.notes,
    ownerUserId: row.ownerUserId,
    primaryContactId: row.primaryContactId,
    sourceSystem: row.sourceSystem,
    sourceId: row.sourceId,
    sourceEnquiryId: row.sourceEnquiryId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A live organisation or household as the book shows it: its live members
 * (those whose primary organisation it is first, then by name) and its owner.
 * A merged or deleted person is not a member. Null when there is no live
 * organisation with that id at the scoped venue.
 */
export async function readOrganisationProfile(
  db: PeopleConn,
  scopeVenueId: string | null,
  organisationId: string,
): Promise<OrganisationProfile | null> {
  const [row] = await db.select().from(clientAccounts)
    .where(and(
      eq(clientAccounts.id, organisationId),
      scopeVenueId === null ? undefined : eq(clientAccounts.venueId, scopeVenueId),
      liveAccount(),
    ))
    .limit(1);
  if (row === undefined) return null;

  const members = await db.select({
    personId: contacts.id,
    name: contacts.name,
    roleLabel: accountMemberships.roleLabel,
    isPrimary: accountMemberships.isPrimary,
  }).from(accountMemberships)
    .innerJoin(contacts, and(
      eq(contacts.id, accountMemberships.contactId),
      eq(contacts.venueId, accountMemberships.venueId),
    ))
    .where(and(
      eq(accountMemberships.clientAccountId, row.id),
      eq(accountMemberships.venueId, row.venueId),
      liveContact(),
    ))
    .orderBy(desc(accountMemberships.isPrimary), asc(contacts.name), asc(contacts.id));

  const owner = row.ownerUserId === null
    ? undefined
    : (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.ownerUserId)).limit(1))[0];

  return { organisation: toOrganisation(row), members, owner: owner ?? null };
}

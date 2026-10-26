import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { RecordMergeSnapshot } from "@omnitwin/types";
import {
  accountMemberships,
  bookings,
  contactPoints,
  contacts,
  emailSends,
  enquiries,
  generalAuditLog,
  guestLeads,
  proposalComments,
  proposals,
  recordMerges,
} from "../db/schema.js";
import { outerColumn } from "../utils/outer-column.js";
import type { PeopleTx } from "./people-records.js";

// ---------------------------------------------------------------------------
// Erasure of one person at one venue (release audit people-privacy-5).
//
// The privacy page promises that a person can ask for their enquiry and
// contact record to be deleted, and that an enquiry which did not become a
// booking goes 24 months after our last contact, with the contact record.
// This is the one place that does it, for the erase route and the nightly
// 24-month pass alike, in the caller's transaction:
//   - the person and every record merged into them (a tombstone keeps its
//     details) are kept as rows, because history points at them, with every
//     personal field cleared and erased_at set: they are never live again,
//     and a merge involving them can no longer be undone (ERASED);
//   - their emails and phones (contact_points) are deleted, their membership
//     role labels cleared;
//   - the merge snapshots that copy them lose the copy: the person's details,
//     the removed contact points and the values copied between records;
//   - their enquiries at this venue are deleted, with each one's status
//     history and the venue's email receipts for it; the guest lead goes too
//     unless another enquiry, anywhere, still uses the address;
//   - comments they left on this venue's proposals are deleted.
// An enquiry that became a booking is kept for six years after the event's
// financial year (the privacy page's accounting rule), so a person with a
// confirmed or live provisional booking is refused, and the venue erases what
// the booking does not need by hand (docs/operations/erasure-requests.md).
//
// Other venues' records of the same person are theirs to erase: nothing here
// crosses the venue, except the guest lead, which has no venue.
// ---------------------------------------------------------------------------

export const ERASED_NAME = "Erased";

export interface ErasureCounts {
  /** The person and the records merged into them. */
  readonly people: number;
  readonly contactPoints: number;
  readonly enquiries: number;
  readonly mergeSnapshots: number;
  readonly guestLeads: number;
  readonly emailReceipts: number;
  readonly comments: number;
}

export type ErasureRefusal = "has_booking";

type ContactRow = typeof contacts.$inferSelect;

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
    },
    contactPoints: [],
    memberships: snapshot.memberships.map((membership) => ({ ...membership, roleLabel: null })),
    survivorFilled: [],
  };
}

/** Lower-cased, trimmed, distinct email addresses. */
function addresses(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.flatMap((value) => {
    const address = value?.trim().toLowerCase() ?? "";
    return address.length > 0 ? [address] : [];
  }))];
}

/** The email receipts this venue sent about an enquiry: their keys end in
 *  the enquiry's id, or carry it before a recipient's (`enquiry-new:<id>:<user>`). */
function receiptsFor(enquiryIds: readonly string[]): SQL | undefined {
  return or(...enquiryIds.map((id) => sql`${emailSends.idempotencyKey} ~ ${`:${id}(:|$)`}`));
}

/**
 * Erase a person the caller has locked (`SELECT … FOR UPDATE`), who is
 * neither merged into someone else nor already erased. Returns the counts,
 * or why it refused; a refusal has changed nothing.
 */
export async function eraseLockedPerson(
  tx: PeopleTx,
  person: ContactRow,
  input: { readonly actorUserId: string | null; readonly now: Date },
): Promise<{ readonly ok: true; readonly counts: ErasureCounts } | { readonly ok: false; readonly refusal: ErasureRefusal }> {
  const chain = await tx.execute<{ id: string }>(sql`
    with recursive chain(id) as (
      select ${person.id}::uuid
      union
      select merged."id" from "contacts" as merged join chain on merged."merged_into_id" = chain.id
    )
    select id from chain`);
  const ids = chain.rows.map((row) => row.id);
  await tx.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids)).for("update");

  const points = await tx.select({ kind: contactPoints.kind, value: contactPoints.value })
    .from(contactPoints).where(inArray(contactPoints.contactId, ids));
  const recorded = await tx.select({ email: contacts.email }).from(contacts).where(inArray(contacts.id, ids));
  const emails = addresses([
    ...recorded.map((row) => row.email),
    ...points.filter((point) => point.kind === "email").map((point) => point.value),
  ]);

  const byAddress = emails.length === 0 ? [] : [
    inArray(sql`lower(${enquiries.email})`, [...emails]),
    inArray(sql`lower(${enquiries.guestEmail})`, [...emails]),
  ];
  const theirEnquiries = await tx.select({ id: enquiries.id }).from(enquiries).where(and(
    eq(enquiries.venueId, person.venueId),
    or(inArray(enquiries.contactId, ids), ...byAddress),
  ));
  const enquiryIds = theirEnquiries.map((row) => row.id);

  if (enquiryIds.length > 0) {
    const [kept] = await tx.select({ id: bookings.id }).from(bookings).where(and(
      inArray(bookings.enquiryId, enquiryIds),
      isNull(bookings.deletedAt),
      or(eq(bookings.kind, "ink"), and(eq(bookings.kind, "hold"), eq(bookings.status, "active"))),
    )).limit(1);
    if (kept !== undefined) return { ok: false, refusal: "has_booking" };
  }

  const receipts = enquiryIds.length === 0 ? [] : await tx.delete(emailSends)
    .where(receiptsFor(enquiryIds))
    .returning({ id: emailSends.id });
  const comments = emails.length === 0 ? [] : await tx.delete(proposalComments)
    .where(and(
      inArray(sql`lower(${proposalComments.authorEmail})`, [...emails]),
      inArray(proposalComments.proposalId, tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.venueId, person.venueId))),
    ))
    .returning({ id: proposalComments.id });
  const deletedEnquiries = enquiryIds.length === 0 ? [] : await tx.delete(enquiries)
    .where(inArray(enquiries.id, enquiryIds))
    .returning({ id: enquiries.id });
  // A lead has no venue; another enquiry anywhere still using the address
  // keeps it. The inner table is aliased, the outer column named in full.
  const leads = emails.length === 0 ? [] : await tx.delete(guestLeads)
    .where(and(
      inArray(sql`lower(${guestLeads.email})`, [...emails]),
      sql`not exists (
        select 1 from "enquiries" as other
        where lower(other."email") = lower(${outerColumn(guestLeads.email)})
          or lower(other."guest_email") = lower(${outerColumn(guestLeads.email)})
      )`,
    ))
    .returning({ id: guestLeads.id });

  const merges = await tx.select({ id: recordMerges.id, snapshot: recordMerges.snapshot }).from(recordMerges).where(and(
    eq(recordMerges.venueId, person.venueId),
    eq(recordMerges.kind, "person"),
    or(inArray(recordMerges.survivorId, ids), inArray(recordMerges.mergedId, ids)),
  ));
  for (const merge of merges) {
    await tx.update(recordMerges).set({ snapshot: erasedSnapshot(merge.snapshot) }).where(eq(recordMerges.id, merge.id));
  }

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
    erasedAt: input.now,
    deletedAt: sql`coalesce(${contacts.deletedAt}, ${input.now.toISOString()}::timestamptz)`,
    updatedAt: input.now,
  }).where(inArray(contacts.id, ids)).returning({ id: contacts.id });

  const counts: ErasureCounts = {
    people: people.length,
    contactPoints: removedPoints.length,
    enquiries: deletedEnquiries.length,
    mergeSnapshots: merges.length,
    guestLeads: leads.length,
    emailReceipts: receipts.length,
    comments: comments.length,
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

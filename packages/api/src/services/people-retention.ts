import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { contacts, emailSends, enquiries } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { eraseLockedPerson, keepsBooking, receiptsFor } from "./people-erasure.js";

// ---------------------------------------------------------------------------
// The 24-month pass (release audit people-privacy-5). The privacy page
// promises that an enquiry which did not become a booking is deleted 24
// months after our last contact with the person, and their contact record on
// the same rule. Every night this pass:
//   - erases each person last in touch more than 24 months ago, through the
//     erase route's own erasure (services/people-erasure.ts), one person per
//     transaction; a person with a booking the venue keeps is left as they
//     are and counted, never half-erased;
//   - deletes each enquiry no person holds that was last touched more than 24
//     months ago and never became a booking, with the venue's email receipts
//     for it.
// "Last in touch" is the later of the People Book's last contact (or the day
// the record was made) and the record's own last change, so a person the team
// is still working with is never taken.
//
// A dry run does every step inside its transaction and rolls it back, so the
// counts are exactly what a real run would do.
// ---------------------------------------------------------------------------

/** The privacy page's 24 months after our last contact. */
export const PEOPLE_RETENTION_DAYS = 730;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeopleRetentionResult {
  readonly dryRun: boolean;
  /** People erased (or who would be). */
  readonly people: number;
  /** People past the 24 months who are kept for a booking. */
  readonly keptForBooking: number;
  /** Enquiries deleted with a person, or on their own. */
  readonly enquiries: number;
}

/** Thrown to roll a rehearsed step back. */
class Rehearsal extends Error {}

export async function eraseLapsedPeople(
  db: Database,
  options: { readonly now?: Date; readonly dryRun?: boolean } = {},
): Promise<PeopleRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date(now.getTime() - PEOPLE_RETENTION_DAYS * DAY_MS);
  const lapsedPerson = and(
    isNull(contacts.erasedAt),
    isNull(contacts.mergedIntoId),
    sql`greatest(coalesce(${contacts.lastContactAt}, ${contacts.createdAt}), ${contacts.updatedAt}) < ${cutoff}`,
  );

  let people = 0;
  let keptForBooking = 0;
  let enquiryCount = 0;

  /** One step in its own transaction, rolled back on a dry run. */
  async function step(run: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<void>): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await run(tx);
        if (dryRun) throw new Rehearsal();
      });
    } catch (error) {
      if (!(error instanceof Rehearsal)) throw error;
    }
  }

  const candidates = await db.select({ id: contacts.id }).from(contacts).where(lapsedPerson);
  for (const candidate of candidates) {
    await step(async (tx) => {
      // Locked and read again: someone may have written to them meanwhile.
      const [person] = await tx.select().from(contacts)
        .where(and(eq(contacts.id, candidate.id), lapsedPerson)).for("update");
      if (person === undefined) return;
      const erased = await eraseLockedPerson(tx, person, { actorUserId: null, now });
      if (erased.ok) {
        people += 1;
        enquiryCount += erased.counts.enquiries;
      } else {
        keptForBooking += 1;
      }
    });
  }

  const lapsedEnquiry = and(
    isNull(enquiries.contactId),
    sql`greatest(${enquiries.createdAt}, ${enquiries.updatedAt}) < ${cutoff}`,
  );
  const orphans = await db.select({ id: enquiries.id }).from(enquiries).where(lapsedEnquiry);
  for (const orphan of orphans) {
    await step(async (tx) => {
      const [enquiry] = await tx.select({ id: enquiries.id }).from(enquiries)
        .where(and(eq(enquiries.id, orphan.id), lapsedEnquiry)).for("update");
      if (enquiry === undefined || await keepsBooking(tx, [], [enquiry.id])) return;
      // Its bookings that never became one (released, lost) keep their rows
      // and lose the link (bookings.enquiry_id ON DELETE SET NULL).
      await tx.delete(emailSends).where(receiptsFor([enquiry.id]));
      const deleted = await tx.delete(enquiries).where(inArray(enquiries.id, [enquiry.id])).returning({ id: enquiries.id });
      enquiryCount += deleted.length;
    });
  }

  return { dryRun, people, keptForBooking, enquiries: enquiryCount };
}

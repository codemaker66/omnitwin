import { and, isNotNull, or, sql } from "drizzle-orm";
import { SUPPLIER_ARRIVAL_RETENTION } from "@omnitwin/types";
import { bookingSupplierArrivals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { outerColumn } from "../utils/outer-column.js";
import { sqlStateOf } from "./dietary-memory.js";

// ---------------------------------------------------------------------------
// Retention for the office's working words about a supplier (T-692; Blake,
// 12 November 2026).
//
// An arrival on the Day Board can carry a contact for the day ("Morven 07700
// 900123") and a note. They are personal data about people who never used
// the product, needed to receive the supplier and to answer questions just
// after the event, and not a year on. So the nightly clean-up clears both a
// year after the arrival's booking ends (SUPPLIER_ARRIVAL_RETENTION, which the
// privacy policy also reads), whatever became of the booking.
//
// What stays is the venue's record: the supplier's name, when they were due,
// the door, and the door marks with the names of the staff who made them.
// Those names are the record of who was in the building and are kept after
// a member of staff's account is closed (Blake's decision): no pass here or
// anywhere erases them. The door's history (booking_supplier_arrival_events)
// holds no contact or note, so it has nothing for this pass to clear.
//
// It runs every night in the scheduled cleanup (scripts/run-cleanup.ts) and
// on demand through POST /admin/cleanup, with a dry run that changes nothing.
// It is idempotent: an arrival already cleared is not matched again. A
// cleared arrival's revision moves, so a form opened on it before the pass
// is refused rather than writing the contact back.
// ---------------------------------------------------------------------------

/** From @omnitwin/types, so the privacy policy says the same. */
export const SUPPLIER_CONTACT_DAYS_AFTER_BOOKING = SUPPLIER_ARRIVAL_RETENTION.daysAfterBooking;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SupplierContactRetentionOptions {
  readonly now?: Date;
  /** Report what would be cleared, and clear nothing. */
  readonly dryRun?: boolean;
}

export interface SupplierContactRetentionResult {
  readonly dryRun: boolean;
  /** Arrivals whose contact or note was (or would be) cleared. */
  readonly arrivals: number;
}

/** The pass failed. Carries the SQLSTATE and nothing else: the database's
 *  own error can quote the failing row, contact included, and the nightly
 *  job's log is public with the repository. */
export class SupplierContactRetentionError extends Error {
  readonly sqlState: string | null;
  constructor(cause: unknown) {
    const sqlState = sqlStateOf(cause);
    super(`Supplier contact retention pass failed${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}`);
    this.name = "SupplierContactRetentionError";
    this.sqlState = sqlState;
  }
}

export async function clearLapsedSupplierContacts(
  db: Database,
  options: SupplierContactRetentionOptions = {},
): Promise<SupplierContactRetentionResult> {
  try {
    return await clearLapsed(db, options);
  } catch (error) {
    throw new SupplierContactRetentionError(error);
  }
}

async function clearLapsed(db: Database, options: SupplierContactRetentionOptions): Promise<SupplierContactRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date(now.getTime() - SUPPLIER_CONTACT_DAYS_AFTER_BOOKING * DAY_MS);
  // Still holding words to clear, and its booking ended before the cutoff.
  // The subquery's table is aliased, so each column binds to the table meant.
  const lapsed = and(
    or(isNotNull(bookingSupplierArrivals.contact), isNotNull(bookingSupplierArrivals.note)),
    sql`exists (
      select 1 from "bookings" as served
      where served."id" = ${outerColumn(bookingSupplierArrivals.bookingId)}
        and served."ends_at" < ${cutoff}
    )`,
  );

  if (dryRun) {
    const due = await db.select({ id: bookingSupplierArrivals.id }).from(bookingSupplierArrivals).where(lapsed);
    return { dryRun, arrivals: due.length };
  }

  const cleared = await db.update(bookingSupplierArrivals)
    .set({
      contact: null,
      note: null,
      revision: sql`${bookingSupplierArrivals.revision} + 1`,
      updatedAt: now,
    })
    .where(lapsed)
    .returning({ id: bookingSupplierArrivals.id });
  return { dryRun, arrivals: cleared.length };
}

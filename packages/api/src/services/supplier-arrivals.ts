import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  SUPPLIER_ARRIVAL_LEAD_MS,
  SUPPLIER_ARRIVAL_STAY_MS,
  type CreateSupplierArrivalData,
  type SupplierArrival,
  type SupplierArrivalListQuery,
  type SupplierArrivalStep,
  type UpdateSupplierArrivalData,
} from "@omnitwin/types";
import { bookingSupplierArrivals, bookings } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canAdministerVenue, canManageVenue, canRecordObservation } from "../utils/query.js";
import type { RequestActor } from "./requests.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692).
//
// The office (a venue administration role) enters, changes and removes an
// arrival against one of its venue's bookings; each change names the
// revision it was made from, so a colleague's newer change is refused rather
// than overwritten. The floor (anyone who records what a room is doing) marks
// a supplier arrived and gone: the first tap wins and a second reads it back,
// so two phones at one door write one fact. Everyone on the floor reads the
// day's arrivals; nobody outside the venue reads anything, and another
// venue's arrival reads as absent.
// ---------------------------------------------------------------------------

export interface ArrivalDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

function deny(status: number, code: string, error: string): ArrivalDeny {
  return { ok: false, status, code, error };
}

export function isArrivalDeny(value: unknown): value is ArrivalDeny {
  return typeof value === "object" && value !== null && "ok" in value && (value as { readonly ok: unknown }).ok === false;
}

type ArrivalRow = typeof bookingSupplierArrivals.$inferSelect;

export function serializeArrival(row: ArrivalRow): SupplierArrival {
  return {
    id: row.id,
    venueId: row.venueId,
    bookingId: row.bookingId,
    supplierName: row.supplierName,
    category: row.category,
    arrivesAt: row.arrivesAt.toISOString(),
    leavesBy: row.leavesBy?.toISOString() ?? null,
    entrance: row.entrance,
    contact: row.contact,
    note: row.note,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    arrivedByName: row.arrivedByName,
    leftAt: row.leftAt?.toISOString() ?? null,
    leftByName: row.leftByName,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const NOT_FOUND = (): ArrivalDeny => deny(404, "ARRIVAL_NOT_FOUND", "That arrival is not on this venue's board.");
const STALE = (): ArrivalDeny => deny(409, "STALE_ARRIVAL", "Someone changed this arrival since you opened it. Read it again.");

interface BookingWindow {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

async function bookingOfVenue(db: Database, venueId: string, bookingId: string): Promise<BookingWindow | null> {
  const [booking] = await db
    .select({ id: bookings.id, venueId: bookings.venueId, startsAt: bookings.startsAt, endsAt: bookings.endsAt, deletedAt: bookings.deletedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  // Another venue's booking reads as absent: the Diary is tenancy-scoped.
  if (booking === undefined || booking.venueId !== venueId || booking.deletedAt !== null) return null;
  return booking;
}

/** An arrival belongs near its booking: from two days before it to its end. */
function outsideBooking(booking: BookingWindow, arrivesAt: Date, leavesBy: Date | null): ArrivalDeny | null {
  if (arrivesAt.getTime() < booking.startsAt.getTime() - SUPPLIER_ARRIVAL_LEAD_MS || arrivesAt.getTime() > booking.endsAt.getTime()) {
    return deny(400, "ARRIVAL_OUTSIDE_BOOKING", "A supplier arrives between two days before the booking and its end.");
  }
  if (leavesBy !== null && (leavesBy.getTime() <= arrivesAt.getTime() || leavesBy.getTime() - arrivesAt.getTime() > SUPPLIER_ARRIVAL_STAY_MS)) {
    return deny(400, "ARRIVAL_LEAVES_BEFORE", "They leave after they arrive, within a day and a half.");
  }
  return null;
}

/** The arrivals due between two instants, for the floor: earliest first. */
export async function listArrivals(
  db: Database,
  actor: RequestActor,
  venueId: string,
  query: SupplierArrivalListQuery,
): Promise<readonly SupplierArrival[] | ArrivalDeny> {
  if (!canManageVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const rows = await db
    .select({ arrival: bookingSupplierArrivals })
    .from(bookingSupplierArrivals)
    .innerJoin(bookings, eq(bookings.id, bookingSupplierArrivals.bookingId))
    .where(and(
      eq(bookingSupplierArrivals.venueId, venueId),
      eq(bookings.venueId, venueId),
      isNull(bookings.deletedAt),
      gte(bookingSupplierArrivals.arrivesAt, new Date(query.from)),
      lt(bookingSupplierArrivals.arrivesAt, new Date(query.to)),
    ))
    .orderBy(asc(bookingSupplierArrivals.arrivesAt), asc(bookingSupplierArrivals.supplierName), asc(bookingSupplierArrivals.id));
  return rows.map((row) => serializeArrival(row.arrival));
}

/** The office adds a supplier to one of its bookings. */
export async function createArrival(
  db: Database,
  actor: RequestActor,
  venueId: string,
  input: CreateSupplierArrivalData,
): Promise<SupplierArrival | ArrivalDeny> {
  if (!canAdministerVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const booking = await bookingOfVenue(db, venueId, input.bookingId);
  if (booking === null) return deny(404, "BOOKING_NOT_FOUND", "That booking is not on this venue's Diary.");
  const arrivesAt = new Date(input.arrivesAt);
  const leavesBy = input.leavesBy === null ? null : new Date(input.leavesBy);
  const outside = outsideBooking(booking, arrivesAt, leavesBy);
  if (outside !== null) return outside;
  const [row] = await db.insert(bookingSupplierArrivals).values({
    venueId,
    bookingId: booking.id,
    supplierName: input.supplierName,
    category: input.category,
    arrivesAt,
    leavesBy,
    entrance: input.entrance,
    contact: input.contact,
    note: input.note,
    createdByUserId: actor.id,
  }).returning();
  if (row === undefined) return deny(500, "ARRIVAL_NOT_SAVED", "The arrival could not be saved.");
  return serializeArrival(row);
}

async function arrivalOfVenue(db: Database, venueId: string, id: string): Promise<ArrivalRow | null> {
  const [row] = await db.select().from(bookingSupplierArrivals)
    .where(and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId)))
    .limit(1);
  return row ?? null;
}

/** The office changes an arrival it can see, from the revision it saw. */
export async function updateArrival(
  db: Database,
  actor: RequestActor,
  venueId: string,
  id: string,
  input: UpdateSupplierArrivalData,
): Promise<SupplierArrival | ArrivalDeny> {
  if (!canAdministerVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const current = await arrivalOfVenue(db, venueId, id);
  if (current === null) return NOT_FOUND();
  if (current.revision !== input.expectedRevision) return STALE();
  const booking = await bookingOfVenue(db, venueId, current.bookingId);
  if (booking === null) return NOT_FOUND();
  const arrivesAt = input.arrivesAt === undefined ? current.arrivesAt : new Date(input.arrivesAt);
  const leavesBy = input.leavesBy === undefined ? current.leavesBy : input.leavesBy === null ? null : new Date(input.leavesBy);
  const outside = outsideBooking(booking, arrivesAt, leavesBy);
  if (outside !== null) return outside;
  const [row] = await db.update(bookingSupplierArrivals)
    .set({
      ...(input.supplierName === undefined ? {} : { supplierName: input.supplierName }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.entrance === undefined ? {} : { entrance: input.entrance }),
      ...(input.contact === undefined ? {} : { contact: input.contact }),
      ...(input.note === undefined ? {} : { note: input.note }),
      arrivesAt,
      leavesBy,
      revision: sql`${bookingSupplierArrivals.revision} + 1`,
      updatedAt: new Date(),
    })
    // The revision decides, not the read above: of two edits from one copy,
    // exactly one lands.
    .where(and(
      eq(bookingSupplierArrivals.id, id),
      eq(bookingSupplierArrivals.venueId, venueId),
      eq(bookingSupplierArrivals.revision, input.expectedRevision),
    ))
    .returning();
  return row === undefined ? STALE() : serializeArrival(row);
}

/** The office removes an arrival, from the revision it saw. */
export async function removeArrival(
  db: Database,
  actor: RequestActor,
  venueId: string,
  id: string,
  expectedRevision: number,
): Promise<{ readonly ok: true } | ArrivalDeny> {
  if (!canAdministerVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const removed = await db.delete(bookingSupplierArrivals)
    .where(and(
      eq(bookingSupplierArrivals.id, id),
      eq(bookingSupplierArrivals.venueId, venueId),
      eq(bookingSupplierArrivals.revision, expectedRevision),
    ))
    .returning({ id: bookingSupplierArrivals.id });
  if (removed.length > 0) return { ok: true };
  return (await arrivalOfVenue(db, venueId, id)) === null ? NOT_FOUND() : STALE();
}

/**
 * The floor records a supplier at the door. The first tap wins: a second
 * reads the first back, so two phones at one door write one fact. Leaving
 * marks the arrival too when nobody did, so the board never holds someone
 * who left without having come.
 */
export async function recordArrivalStep(
  db: Database,
  actor: RequestActor,
  venueId: string,
  id: string,
  step: SupplierArrivalStep,
  now: () => Date = () => new Date(),
): Promise<SupplierArrival | ArrivalDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  const at = now();
  const scope = and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId));
  const [row] = step === "arrived"
    ? await db.update(bookingSupplierArrivals)
      .set({ arrivedAt: at, arrivedByUserId: actor.id, arrivedByName: actor.name })
      .where(and(scope, isNull(bookingSupplierArrivals.arrivedAt)))
      .returning()
    : await db.update(bookingSupplierArrivals)
      .set({
        leftAt: at,
        leftByUserId: actor.id,
        leftByName: actor.name,
        arrivedAt: sql`COALESCE(${bookingSupplierArrivals.arrivedAt}, ${at.toISOString()}::timestamptz)`,
        arrivedByUserId: sql`COALESCE(${bookingSupplierArrivals.arrivedByUserId}, ${actor.id}::uuid)`,
        arrivedByName: sql`COALESCE(${bookingSupplierArrivals.arrivedByName}, ${actor.name})`,
      })
      .where(and(scope, isNull(bookingSupplierArrivals.leftAt)))
      .returning();
  if (row !== undefined) return serializeArrival(row);
  const existing = await arrivalOfVenue(db, venueId, id);
  return existing === null ? NOT_FOUND() : serializeArrival(existing);
}

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
// than overwritten. A supplier the floor has marked in is not removed: the
// tap is taken back first. The floor (anyone who records what a room is
// doing) marks a supplier arrived and gone: the first tap wins and a second
// reads it back, so two phones at one door write one fact; a mistaken tap is
// taken back the same way. Everyone on the floor reads the day's arrivals;
// nobody outside the venue reads anything, and another venue's arrival reads
// as absent. When the Diary moves a booking, its arrivals not yet marked move
// with it, in the move's own transaction.
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

export type ArrivalConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A collection after the event: the hire firm at 00:30, the vases the next morning. */
export const SUPPLIER_ARRIVAL_AFTER_MS = 24 * 3_600_000;
/** How long before they are due the floor may mark a supplier in: the same day's early arrival. */
export const SUPPLIER_STEP_EARLY_MS = 12 * 3_600_000;
/** The column holding who tapped: a longer name is clipped, never refused. */
const NAME_MAX = 160;

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

/** An arrival belongs near its booking: from two days before it to a day after it ends. */
function outsideBooking(booking: BookingWindow, arrivesAt: Date, leavesBy: Date | null): ArrivalDeny | null {
  if (arrivesAt.getTime() < booking.startsAt.getTime() - SUPPLIER_ARRIVAL_LEAD_MS
    || arrivesAt.getTime() > booking.endsAt.getTime() + SUPPLIER_ARRIVAL_AFTER_MS) {
    return deny(400, "ARRIVAL_OUTSIDE_BOOKING", "A supplier arrives between two days before the booking and a day after it ends.");
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
  // The times are held to the booking when they change; a new door or note is not.
  if (input.arrivesAt !== undefined || input.leavesBy !== undefined) {
    const outside = outsideBooking(booking, arrivesAt, leavesBy);
    if (outside !== null) return outside;
  }
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

/** The office removes an arrival, from the revision it saw, while nobody has marked it in. */
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
      // The floor's record of the door is not the office's to delete.
      isNull(bookingSupplierArrivals.arrivedAt),
    ))
    .returning({ id: bookingSupplierArrivals.id });
  if (removed.length > 0) return { ok: true };
  const current = await arrivalOfVenue(db, venueId, id);
  if (current === null) return NOT_FOUND();
  if (current.arrivedAt !== null) {
    return deny(409, "ARRIVAL_MARKED", `${current.arrivedByName ?? "The floor"} has marked ${current.supplierName} in. Undo that on the board first.`);
  }
  return STALE();
}

/** An arrival of a booking still on the venue's Diary. */
async function liveArrival(db: Database, venueId: string, id: string): Promise<ArrivalRow | null> {
  const [row] = await db.select({ arrival: bookingSupplierArrivals })
    .from(bookingSupplierArrivals)
    .innerJoin(bookings, eq(bookings.id, bookingSupplierArrivals.bookingId))
    .where(and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId), isNull(bookings.deletedAt)))
    .limit(1);
  return row?.arrival ?? null;
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
  const current = await liveArrival(db, venueId, id);
  if (current === null) return NOT_FOUND();
  const at = now();
  // A tap belongs to the day: not next week's arrival marked in today.
  if (at.getTime() < current.arrivesAt.getTime() - SUPPLIER_STEP_EARLY_MS) {
    return deny(400, "ARRIVAL_NOT_DUE", `${current.supplierName} is not due yet.`);
  }
  const name = actor.name.slice(0, NAME_MAX);
  const scope = and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId));
  const [row] = step === "arrived"
    ? await db.update(bookingSupplierArrivals)
      .set({ arrivedAt: at, arrivedByUserId: actor.id, arrivedByName: name })
      .where(and(scope, isNull(bookingSupplierArrivals.arrivedAt)))
      .returning()
    : await db.update(bookingSupplierArrivals)
      .set({
        leftAt: at,
        leftByUserId: actor.id,
        leftByName: name,
        arrivedAt: sql`COALESCE(${bookingSupplierArrivals.arrivedAt}, ${at.toISOString()}::timestamptz)`,
        arrivedByUserId: sql`COALESCE(${bookingSupplierArrivals.arrivedByUserId}, ${actor.id}::uuid)`,
        arrivedByName: sql`COALESCE(${bookingSupplierArrivals.arrivedByName}, ${name})`,
      })
      .where(and(scope, isNull(bookingSupplierArrivals.leftAt)))
      .returning();
  if (row !== undefined) return serializeArrival(row);
  const existing = await arrivalOfVenue(db, venueId, id);
  return existing === null ? NOT_FOUND() : serializeArrival(existing);
}

/**
 * The floor takes back a mistaken tap: "gone" clears the leaving; "arrived"
 * clears the arrival while they have not been marked gone. Taking back a tap
 * nobody made changes nothing.
 */
export async function undoArrivalStep(
  db: Database,
  actor: RequestActor,
  venueId: string,
  id: string,
  step: SupplierArrivalStep,
): Promise<SupplierArrival | ArrivalDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  if ((await liveArrival(db, venueId, id)) === null) return NOT_FOUND();
  const scope = and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId));
  const [row] = step === "left"
    ? await db.update(bookingSupplierArrivals)
      .set({ leftAt: null, leftByUserId: null, leftByName: null })
      .where(scope)
      .returning()
    : await db.update(bookingSupplierArrivals)
      .set({ arrivedAt: null, arrivedByUserId: null, arrivedByName: null })
      .where(and(scope, isNull(bookingSupplierArrivals.leftAt)))
      .returning();
  if (row !== undefined) return serializeArrival(row);
  const existing = await arrivalOfVenue(db, venueId, id);
  if (existing === null) return NOT_FOUND();
  return deny(409, "ARRIVAL_GONE", `${existing.supplierName} is marked gone. Undo that first.`);
}

/**
 * When the Diary moves a booking, its arrivals not yet marked move by the
 * same time, so they stay on the day and near the booking they serve. A
 * supplier already marked in or gone is a fact and stays where it was.
 */
export async function moveArrivalsWithBooking(conn: ArrivalConn, bookingId: string, deltaMs: number): Promise<void> {
  if (deltaMs === 0) return;
  const shift = sql`make_interval(secs => ${deltaMs / 1000}::double precision)`;
  await conn.update(bookingSupplierArrivals)
    .set({
      arrivesAt: sql`${bookingSupplierArrivals.arrivesAt} + ${shift}`,
      leavesBy: sql`${bookingSupplierArrivals.leavesBy} + ${shift}`,
      revision: sql`${bookingSupplierArrivals.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(bookingSupplierArrivals.bookingId, bookingId), isNull(bookingSupplierArrivals.arrivedAt)));
}

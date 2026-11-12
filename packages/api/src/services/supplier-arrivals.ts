import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  SUPPLIER_ARRIVAL_LEAD_MS,
  SUPPLIER_ARRIVAL_STAY_MS,
  isLiveBooking,
  type CreateSupplierArrivalData,
  type SupplierArrival,
  type SupplierArrivalListQuery,
  type SupplierArrivalStep,
  type UpdateSupplierArrivalData,
} from "@omnitwin/types";
import { bookingSupplierArrivalEvents, bookingSupplierArrivals, bookings, type SupplierArrivalEventAction } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canAdministerVenue, canManageVenue, canRecordObservation } from "../utils/query.js";
import type { RequestActor } from "./requests.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692).
//
// The office (a venue administration role) enters, changes and removes an
// arrival against one of its venue's bookings; each change names the
// revision it was made from, so a colleague's newer change is refused rather
// than overwritten. An add may carry the client's Idempotency-Key, so a Save
// sent again after a lost answer finds the first arrival instead of making a
// second. The booking is held FOR SHARE while an add or a change is judged
// and written, so a Diary move or exit of it (FOR UPDATE) goes wholly before
// or wholly after: never an arrival filed against where the booking was.
//
// The floor (anyone who records what a room is doing) marks a supplier
// arrived and gone: the first tap wins and a second reads it back, so two
// phones at one door write one fact; a mistaken tap is taken back the same
// way. A tap belongs to the day: not more than twelve hours early, and an
// arrival is not marked in more than a day after the supplier was due to
// leave. Leaving is always the floor's to mark once someone is in.
//
// A booking off the Diary (deleted, or released, expired, cancelled or lost:
// isLiveBooking) takes its suppliers off the board: the floor reads none of
// them and marks none, and the office adds and changes none. Except a
// supplier already marked in and not out, whatever became of the booking:
// they are in the building, so the floor still reads them, still marks them
// gone, and can take that Gone back.
//
// Every mark, mark taken back and removal writes a row of the door's history
// (booking_supplier_arrival_events) in the same transaction: who and when.
// A supplier marked in is not removed: the tap is taken back first.
//
// Everyone on the floor reads the day's arrivals; nobody outside the venue
// reads anything, and another venue's arrival reads as absent. When the
// Diary moves a booking, its arrivals not yet marked move with it, in the
// move's own transaction.
// ---------------------------------------------------------------------------

export interface ArrivalDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

/** An add, and whether it was the first time its key was sent. */
export interface ArrivalAdded {
  readonly ok: true;
  readonly replay: boolean;
  readonly arrival: SupplierArrival;
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
/** How long after they were due to leave (or due, with no leaving time) a supplier may still be marked in. */
export const SUPPLIER_STEP_LATE_MS = 24 * 3_600_000;
/** The column holding who tapped: a longer name is clipped, never refused. */
const NAME_MAX = 160;

const NOT_FOUND = (): ArrivalDeny => deny(404, "ARRIVAL_NOT_FOUND", "That arrival is not on this venue's board.");
const STALE = (): ArrivalDeny => deny(409, "STALE_ARRIVAL", "Someone changed this arrival since you opened it. Read it again.");
const BOOKING_NOT_FOUND = (): ArrivalDeny => deny(404, "BOOKING_NOT_FOUND", "That booking is not on this venue's Diary.");
const BOOKING_NOT_ACTIVE = (): ArrivalDeny => deny(409, "BOOKING_NOT_ACTIVE", "That booking is off the Diary now, so no supplier is due for it.");

/** On the Diary: the Diary's own rule (isLiveBooking), in SQL. */
const BOOKING_LIVE = and(isNull(bookings.deletedAt), eq(bookings.status, "active"));
/** Marked in and not out: in the building, whatever became of the booking. */
const STILL_IN = and(isNotNull(bookingSupplierArrivals.arrivedAt), isNull(bookingSupplierArrivals.leftAt));

/** Clipped by characters, as the column counts them, never through one. */
function clipped(name: string): string {
  return Array.from(name).slice(0, NAME_MAX).join("");
}

interface BookingWindow {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The booking an office add or change is for, held FOR SHARE until it
 * commits: a Diary move or exit, which locks the booking FOR UPDATE, waits
 * for the change, or the change waits for it and reads where it left the
 * booking. Another venue's booking, or a deleted one, reads as absent; one
 * that has left the Diary is a record and takes no supplier.
 */
async function plannableBooking(conn: ArrivalConn, venueId: string, bookingId: string): Promise<BookingWindow | ArrivalDeny> {
  const [booking] = await conn
    .select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt, status: bookings.status, deletedAt: bookings.deletedAt })
    .from(bookings)
    // Scoped by venue in the lookup itself, so another venue's row is never locked.
    .where(and(eq(bookings.id, bookingId), eq(bookings.venueId, venueId)))
    .limit(1)
    .for("share");
  if (booking === undefined || booking.deletedAt !== null) return BOOKING_NOT_FOUND();
  if (!isLiveBooking(booking)) return BOOKING_NOT_ACTIVE();
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
      gte(bookingSupplierArrivals.arrivesAt, new Date(query.from)),
      lt(bookingSupplierArrivals.arrivesAt, new Date(query.to)),
      // A booking off the Diary takes its suppliers off the board, except
      // anyone still in the building: lock-up must know they are there.
      or(BOOKING_LIVE, STILL_IN),
    ))
    .orderBy(asc(bookingSupplierArrivals.arrivesAt), asc(bookingSupplierArrivals.supplierName), asc(bookingSupplierArrivals.id));
  return rows.map((row) => serializeArrival(row.arrival));
}

/** The arrival an earlier add with this key made, or null when none did. */
async function addedBefore(conn: ArrivalConn, venueId: string, key: string, bookingId: string): Promise<ArrivalAdded | ArrivalDeny | null> {
  const [row] = await conn.select().from(bookingSupplierArrivals)
    .where(and(eq(bookingSupplierArrivals.venueId, venueId), eq(bookingSupplierArrivals.idempotencyKey, key)))
    .limit(1);
  if (row === undefined) return null;
  // A key names one add: sent with another booking, it is a mistake, not a replay.
  if (row.bookingId !== bookingId) return deny(409, "IDEMPOTENCY_KEY_REUSED", "That key was already used for another supplier.");
  return { ok: true, replay: true, arrival: serializeArrival(row) };
}

/**
 * The office adds a supplier to one of its bookings. With a key, a Save sent
 * again answers with the arrival the first one made, however the booking has
 * moved since, and two sent at once make one.
 */
export async function createArrival(
  db: Database,
  actor: RequestActor,
  venueId: string,
  input: CreateSupplierArrivalData,
  idempotencyKey: string | null = null,
): Promise<ArrivalAdded | ArrivalDeny> {
  if (!canAdministerVenue(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  return db.transaction(async (tx): Promise<ArrivalAdded | ArrivalDeny> => {
    if (idempotencyKey !== null) {
      const replay = await addedBefore(tx, venueId, idempotencyKey, input.bookingId);
      if (replay !== null) return replay;
    }
    const booking = await plannableBooking(tx, venueId, input.bookingId);
    if (isArrivalDeny(booking)) return booking;
    const arrivesAt = new Date(input.arrivesAt);
    const leavesBy = input.leavesBy === null ? null : new Date(input.leavesBy);
    const outside = outsideBooking(booking, arrivesAt, leavesBy);
    if (outside !== null) return outside;
    const [row] = await tx.insert(bookingSupplierArrivals).values({
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
      idempotencyKey,
    })
      // The index decides, not the read above: of two sends at once, one inserts.
      .onConflictDoNothing({ target: [bookingSupplierArrivals.venueId, bookingSupplierArrivals.idempotencyKey] })
      .returning();
    if (row !== undefined) return { ok: true, replay: false, arrival: serializeArrival(row) };
    const raced = idempotencyKey === null ? null : await addedBefore(tx, venueId, idempotencyKey, input.bookingId);
    return raced ?? deny(500, "ARRIVAL_NOT_SAVED", "The arrival could not be saved.");
  });
}

async function arrivalOfVenue(conn: ArrivalConn, venueId: string, id: string): Promise<ArrivalRow | null> {
  const [row] = await conn.select().from(bookingSupplierArrivals)
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
  return db.transaction(async (tx): Promise<SupplierArrival | ArrivalDeny> => {
    const current = await arrivalOfVenue(tx, venueId, id);
    if (current === null) return NOT_FOUND();
    if (current.revision !== input.expectedRevision) return STALE();
    const booking = await plannableBooking(tx, venueId, current.bookingId);
    if (isArrivalDeny(booking)) return booking.code === "BOOKING_NOT_FOUND" ? NOT_FOUND() : booking;
    const arrivesAt = input.arrivesAt === undefined ? current.arrivesAt : new Date(input.arrivesAt);
    const leavesBy = input.leavesBy === undefined ? current.leavesBy : input.leavesBy === null ? null : new Date(input.leavesBy);
    // The times are held to the booking when they change; a new door or note is not.
    if (input.arrivesAt !== undefined || input.leavesBy !== undefined) {
      const outside = outsideBooking(booking, arrivesAt, leavesBy);
      if (outside !== null) return outside;
    }
    const [row] = await tx.update(bookingSupplierArrivals)
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
      // exactly one lands, and a move that shifted the arrival meanwhile
      // (it bumps the revision) refuses this one.
      .where(and(
        eq(bookingSupplierArrivals.id, id),
        eq(bookingSupplierArrivals.venueId, venueId),
        eq(bookingSupplierArrivals.revision, input.expectedRevision),
      ))
      .returning();
    return row === undefined ? STALE() : serializeArrival(row);
  });
}

/** One row of the door's history, in the transaction of the change it records. */
async function recordDoor(conn: ArrivalConn, row: ArrivalRow, action: SupplierArrivalEventAction, actor: RequestActor, at: Date): Promise<void> {
  await conn.insert(bookingSupplierArrivalEvents).values({
    venueId: row.venueId,
    bookingId: row.bookingId,
    arrivalId: row.id,
    supplierName: row.supplierName,
    action,
    actorUserId: actor.id,
    // A mark names who made it: the venue's record of who was in the
    // building. A removal is the office's, and keeps only the account.
    actorName: action === "removed" ? null : clipped(actor.name),
    at,
  });
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
  return db.transaction(async (tx): Promise<{ readonly ok: true } | ArrivalDeny> => {
    const [removed] = await tx.delete(bookingSupplierArrivals)
      .where(and(
        eq(bookingSupplierArrivals.id, id),
        eq(bookingSupplierArrivals.venueId, venueId),
        eq(bookingSupplierArrivals.revision, expectedRevision),
        // The floor's record of the door is not the office's to delete.
        isNull(bookingSupplierArrivals.arrivedAt),
      ))
      .returning();
    if (removed !== undefined) {
      await recordDoor(tx, removed, "removed", actor, new Date());
      return { ok: true };
    }
    const current = await arrivalOfVenue(tx, venueId, id);
    if (current === null) return NOT_FOUND();
    if (current.arrivedAt !== null) {
      return deny(409, "ARRIVAL_MARKED", `${current.arrivedByName ?? "The floor"} has marked ${current.supplierName} in. Undo that on the board first.`);
    }
    return STALE();
  });
}

/** An arrival of this venue, with whether its booking is still on the Diary. */
async function doorArrival(conn: ArrivalConn, venueId: string, id: string): Promise<{ readonly arrival: ArrivalRow; readonly live: boolean } | null> {
  const [found] = await conn.select({ arrival: bookingSupplierArrivals, status: bookings.status, deletedAt: bookings.deletedAt })
    .from(bookingSupplierArrivals)
    .innerJoin(bookings, eq(bookings.id, bookingSupplierArrivals.bookingId))
    .where(and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId)))
    .limit(1);
  return found === undefined ? null : { arrival: found.arrival, live: isLiveBooking(found) };
}

/** A mark that writes an arrival time belongs to the day it was due. */
function outsideTheDay(arrival: ArrivalRow, at: Date): ArrivalDeny | null {
  // Not next week's arrival marked in today.
  if (at.getTime() < arrival.arrivesAt.getTime() - SUPPLIER_STEP_EARLY_MS) {
    return deny(400, "ARRIVAL_NOT_DUE", `${arrival.supplierName} is not due yet.`);
  }
  // Nor last week's marked in as having come in today.
  if (at.getTime() > (arrival.leavesBy ?? arrival.arrivesAt).getTime() + SUPPLIER_STEP_LATE_MS) {
    return deny(400, "ARRIVAL_PAST", `${arrival.supplierName} was due more than a day ago, too long ago to mark them in now.`);
  }
  return null;
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
  return db.transaction(async (tx): Promise<SupplierArrival | ArrivalDeny> => {
    const found = await doorArrival(tx, venueId, id);
    // Off the Diary, only someone already in is still the floor's to mark.
    if (found === null || (!found.live && found.arrival.arrivedAt === null)) return NOT_FOUND();
    const current = found.arrival;
    // Marked already: the first tap stands, read back.
    if (step === "arrived" ? current.arrivedAt !== null : current.leftAt !== null) return serializeArrival(current);
    const at = now();
    // Gone for someone not yet marked in writes their arrival too, so it is
    // held to the day; Gone for someone in the building never is.
    if (current.arrivedAt === null) {
      const refused = outsideTheDay(current, at);
      if (refused !== null) return refused;
    }
    const name = clipped(actor.name);
    const scope = and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId));
    const [row] = step === "arrived"
      ? await tx.update(bookingSupplierArrivals)
        .set({ arrivedAt: at, arrivedByUserId: actor.id, arrivedByName: name })
        .where(and(scope, isNull(bookingSupplierArrivals.arrivedAt)))
        .returning()
      : await tx.update(bookingSupplierArrivals)
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
    if (row !== undefined) {
      await recordDoor(tx, row, step === "arrived" ? "arrived" : "left", actor, at);
      return serializeArrival(row);
    }
    // Another phone's tap landed between the read and this one: it stands.
    const existing = await arrivalOfVenue(tx, venueId, id);
    return existing === null ? NOT_FOUND() : serializeArrival(existing);
  });
}

/**
 * The floor takes back a mistaken tap: "gone" clears the leaving; "arrived"
 * clears the arrival while they have not been marked gone. Taking back a tap
 * nobody made changes nothing. Once the booking has left the Diary, a Gone
 * can still be taken back, as the supplier may still be in; their arrival
 * cannot, as they were in the building, and Gone records when they left.
 */
export async function undoArrivalStep(
  db: Database,
  actor: RequestActor,
  venueId: string,
  id: string,
  step: SupplierArrivalStep,
  now: () => Date = () => new Date(),
): Promise<SupplierArrival | ArrivalDeny> {
  if (!canRecordObservation(actor, venueId)) return deny(403, "FORBIDDEN", "Forbidden");
  return db.transaction(async (tx): Promise<SupplierArrival | ArrivalDeny> => {
    const found = await doorArrival(tx, venueId, id);
    if (found === null || !(found.live || (step === "left" && found.arrival.arrivedAt !== null))) return NOT_FOUND();
    const scope = and(eq(bookingSupplierArrivals.id, id), eq(bookingSupplierArrivals.venueId, venueId));
    const [row] = step === "left"
      ? await tx.update(bookingSupplierArrivals)
        .set({ leftAt: null, leftByUserId: null, leftByName: null })
        .where(and(scope, isNotNull(bookingSupplierArrivals.leftAt)))
        .returning()
      : await tx.update(bookingSupplierArrivals)
        .set({ arrivedAt: null, arrivedByUserId: null, arrivedByName: null })
        .where(and(scope, isNotNull(bookingSupplierArrivals.arrivedAt), isNull(bookingSupplierArrivals.leftAt)))
        .returning();
    if (row !== undefined) {
      await recordDoor(tx, row, step === "left" ? "left-undone" : "arrived-undone", actor, now());
      return serializeArrival(row);
    }
    const existing = await arrivalOfVenue(tx, venueId, id);
    if (existing === null) return NOT_FOUND();
    if (step === "arrived" && existing.leftAt !== null) {
      return deny(409, "ARRIVAL_GONE", `${existing.supplierName} is marked gone. Undo that first.`);
    }
    return serializeArrival(existing);
  });
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

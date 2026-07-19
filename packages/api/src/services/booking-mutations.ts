import { and, asc, eq, isNull } from "drizzle-orm";
import {
  BookingSchema,
  bookingStateToColumns,
  deriveBookingState,
  isValidBookingTransition,
  type Booking,
  type BookingState,
  type CreateBookingInput,
  type TransitionBookingInput,
  type UpdateBookingInput,
} from "@omnitwin/types";
import { bookings, bookingStatusHistory, events, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
import { canTransitionBooking } from "../state-machines/booking.js";
import {
  resequenceLaddersAfterExit,
  type ResequenceResult,
} from "./hold-hygiene.js";

// ---------------------------------------------------------------------------
// Booking mutation cores (T-537; Canon §9) — extracted VERBATIM from the
// route handlers so the REST surface and the /ws/diary command channel run
// the SAME validation, the same transactions, and the same error vocabulary.
// One dialect, two transports.
//
// Every core returns a transport-neutral result: routes map it onto a
// Fastify reply; the command dispatcher maps it onto a diary.ack envelope.
// Status/code/error strings are the exact ones the routes have always sent —
// the route test suite is the behaviour pin for this extraction.
//
// Cores accept `BookingDbConn` = the Database OR a drizzle transaction, so
// the command path can wrap a core together with its diary_commands ledger
// row in ONE transaction (drizzle nests as a savepoint) — a command and its
// idempotency record commit or vanish together.
// ---------------------------------------------------------------------------

export type BookingRow = typeof bookings.$inferSelect;

/** The Database or a transaction handle — both expose the same query
 *  surface, and `.transaction()` on a transaction nests as a savepoint. */
export type BookingDbConn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The fields mutation logic actually consults — a structural subset of
 *  JwtUser so the ws path (which has no email in hand) can act too. */
export type MutationActor = Pick<JwtUser, "id" | "role" | "venueId" | "platformRole">;

export interface BookingMutationDeny {
  readonly ok: false;
  readonly status: 400 | 403 | 404 | 409 | 500;
  readonly code: string;
  readonly error: string;
  readonly details?: unknown;
}

export interface BookingMutationOk {
  readonly ok: true;
  readonly status: 200 | 201;
  readonly booking: BookingRow;
  readonly changeKind: "booking.created" | "booking.updated" | "booking.transitioned";
  readonly resequence?: ResequenceResult | null;
}

export type BookingMutationResult = BookingMutationOk | BookingMutationDeny;

// --- shared helpers (moved from routes/bookings.ts, byte-equal semantics) ---

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value === undefined || value === null ? null : new Date(value);
}

/** Postgres error code from a driver/drizzle error chain, if any. */
export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return null;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_CHECK_VIOLATION = "23514";
export const PG_UNIQUE_VIOLATION = "23505";

// Diary writes are staff/admin only — hallkeeper is a read-facing ops role
// here, matching the state machine's role policy.
const DIARY_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

export function canWriteBookings(actor: MutationActor, venueId: string): boolean {
  return DIARY_WRITE_ROLES.has(actor.role) && actor.venueId === venueId;
}

const INK_SLOT_TAKEN: BookingMutationDeny = {
  ok: false,
  status: 409,
  code: "INK_SLOT_TAKEN",
  error:
    "That slot has just been inked for this space — the first to confirm wins. Offer the client the next best available option.",
};

const INTEGRITY_VIOLATION: BookingMutationDeny = {
  ok: false,
  status: 400,
  code: "BOOKING_INTEGRITY_VIOLATION",
  error: "Booking violates a database integrity rule",
};

function validationDeny(details: unknown): BookingMutationDeny {
  return {
    ok: false,
    status: 400,
    code: "VALIDATION_ERROR",
    error: "Validation failed",
    details,
  };
}

export function serializeBooking(row: BookingRow): Booking {
  return BookingSchema.parse({
    id: row.id,
    venueId: row.venueId,
    spaceId: row.spaceId,
    eventId: row.eventId,
    kind: row.kind,
    status: row.status,
    state: deriveBookingState(row.kind, row.status),
    title: row.title,
    eventType: row.eventType,
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    rank: row.rank,
    jointFlag: row.jointFlag,
    decisionAt: toIsoOrNull(row.decisionAt),
    ownerUserId: row.ownerUserId,
    nextAction: row.nextAction,
    nextActionDueAt: toIsoOrNull(row.nextActionDueAt),
    seriesId: row.seriesId,
    notes: row.notes,
    createdBy: row.createdBy,
    enquiryId: row.enquiryId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

/** Load a live booking the actor may see, or the deny that explains why. */
export async function loadAccessibleBooking(
  conn: BookingDbConn,
  actor: MutationActor,
  bookingId: string,
): Promise<BookingRow | BookingMutationDeny> {
  const [row] = await conn
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
    .limit(1);
  if (row === undefined) {
    return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", error: "Booking not found" };
  }
  if (!canManageVenue(actor, row.venueId)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }
  return row;
}

/** Merged-row hold hygiene: a live hold must carry all four hygiene fields. */
function holdHygieneIssues(next: {
  kind: string;
  status: string;
  decisionAt: Date | null;
  ownerUserId: string | null;
  nextAction: string | null;
  nextActionDueAt: Date | null;
}): string[] {
  if (next.kind !== "hold" || next.status !== "active") return [];
  const missing: string[] = [];
  if (next.decisionAt === null) missing.push("decisionAt");
  if (next.ownerUserId === null) missing.push("ownerUserId");
  if (next.nextAction === null || next.nextAction.trim().length === 0) missing.push("nextAction");
  if (next.nextActionDueAt === null) missing.push("nextActionDueAt");
  return missing;
}

// --- the three cores -------------------------------------------------------

export async function createBookingCore(
  conn: BookingDbConn,
  actor: MutationActor,
  input: CreateBookingInput,
): Promise<BookingMutationResult> {
  if (!canWriteBookings(actor, input.venueId)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }

  const [space] = await conn
    .select({ id: spaces.id, venueId: spaces.venueId })
    .from(spaces)
    .where(and(eq(spaces.id, input.spaceId), isNull(spaces.deletedAt)))
    .limit(1);
  if (space === undefined || space.venueId !== input.venueId) {
    return {
      ok: false,
      status: 400,
      code: "SPACE_VENUE_MISMATCH",
      error: "The space does not belong to this venue",
    };
  }

  if (input.eventId !== undefined) {
    const [eventRow] = await conn
      .select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1);
    if (eventRow === undefined || eventRow.venueId !== input.venueId) {
      return {
        ok: false,
        status: 400,
        code: "EVENT_VENUE_MISMATCH",
        error: "The event does not belong to this venue",
      };
    }
  }

  try {
    const [created] = await conn
      .insert(bookings)
      .values({
        venueId: input.venueId,
        spaceId: input.spaceId,
        eventId: input.eventId ?? null,
        kind: input.kind,
        status: "active",
        title: input.title,
        eventType: input.eventType ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        rank: input.rank ?? null,
        jointFlag: input.jointFlag ?? false,
        decisionAt: dateOrNull(input.decisionAt),
        ownerUserId: input.ownerUserId ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDueAt: dateOrNull(input.nextActionDueAt),
        seriesId: input.seriesId ?? null,
        notes: input.notes ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (created === undefined) {
      return {
        ok: false,
        status: 500,
        code: "BOOKING_CREATE_FAILED",
        error: "Failed to create booking",
      };
    }
    return { ok: true, status: 201, booking: created, changeKind: "booking.created" };
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === PG_EXCLUSION_VIOLATION) return INK_SLOT_TAKEN;
    if (code === PG_CHECK_VIOLATION) return INTEGRITY_VIOLATION;
    throw error;
  }
}

export async function updateBookingCore(
  conn: BookingDbConn,
  actor: MutationActor,
  bookingId: string,
  patch: UpdateBookingInput,
): Promise<BookingMutationResult> {
  // Role gate before any data access — hallkeeper reads the diary but
  // never edits it (venue scope is verified against the row below).
  if (!DIARY_WRITE_ROLES.has(actor.role)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }

  const row = await loadAccessibleBooking(conn, actor, bookingId);
  if ("ok" in row) return row;

  // Exited bookings are history, and history does not get rewritten —
  // booking_status_history has no field snapshots to audit such an edit.
  if (row.status !== "active") {
    return {
      ok: false,
      status: 409,
      code: "BOOKING_NOT_ACTIVE",
      error: `This booking has exited the diary (${row.status}) — exited bookings are records, not editable plans.`,
    };
  }

  if (patch.rank !== undefined && row.kind !== "hold") {
    return validationDeny([{ path: ["rank"], message: "Only holds carry an option-ladder rank." }]);
  }

  if (patch.eventId !== undefined && patch.eventId !== null) {
    const [eventRow] = await conn
      .select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(and(eq(events.id, patch.eventId), isNull(events.deletedAt)))
      .limit(1);
    if (eventRow === undefined || eventRow.venueId !== row.venueId) {
      return {
        ok: false,
        status: 400,
        code: "EVENT_VENUE_MISMATCH",
        error: "The event does not belong to this venue",
      };
    }
  }

  // Cross-lane move (the Board): the target room must belong to the same
  // venue — the composite bookings_space_venue_fk backs this at the DB.
  if (patch.spaceId !== undefined && patch.spaceId !== row.spaceId) {
    const [space] = await conn
      .select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, patch.spaceId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined || space.venueId !== row.venueId) {
      return {
        ok: false,
        status: 400,
        code: "SPACE_VENUE_MISMATCH",
        error: "The space does not belong to this venue",
      };
    }
  }

  const next = {
    spaceId: patch.spaceId ?? row.spaceId,
    eventId: patch.eventId === undefined ? row.eventId : patch.eventId,
    title: patch.title ?? row.title,
    eventType: patch.eventType === undefined ? row.eventType : patch.eventType,
    startsAt: patch.startsAt === undefined ? row.startsAt : new Date(patch.startsAt),
    endsAt: patch.endsAt === undefined ? row.endsAt : new Date(patch.endsAt),
    rank: patch.rank ?? row.rank,
    jointFlag: patch.jointFlag ?? row.jointFlag,
    decisionAt: patch.decisionAt === undefined ? row.decisionAt : new Date(patch.decisionAt),
    ownerUserId: patch.ownerUserId ?? row.ownerUserId,
    nextAction: patch.nextAction ?? row.nextAction,
    nextActionDueAt:
      patch.nextActionDueAt === undefined ? row.nextActionDueAt : new Date(patch.nextActionDueAt),
    seriesId: patch.seriesId === undefined ? row.seriesId : patch.seriesId,
    notes: patch.notes === undefined ? row.notes : patch.notes,
  };

  if (next.endsAt.getTime() <= next.startsAt.getTime()) {
    return validationDeny([{ path: ["endsAt"], message: "endsAt must be after startsAt." }]);
  }

  const hygieneMissing = holdHygieneIssues({ kind: row.kind, status: row.status, ...next });
  if (hygieneMissing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "HOLD_HYGIENE_REQUIRED",
      error:
        "A live hold keeps its hygiene: decision date, owner, and a dated next action are required.",
      details: hygieneMissing,
    };
  }

  try {
    const [updated] = await conn
      .update(bookings)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(bookings.id, row.id))
      .returning();
    if (updated === undefined) {
      return {
        ok: false,
        status: 500,
        code: "BOOKING_UPDATE_FAILED",
        error: "Failed to update booking",
      };
    }
    return { ok: true, status: 200, booking: updated, changeKind: "booking.updated" };
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === PG_EXCLUSION_VIOLATION) return INK_SLOT_TAKEN;
    if (code === PG_CHECK_VIOLATION) return INTEGRITY_VIOLATION;
    throw error;
  }
}

export async function transitionBookingCore(
  conn: BookingDbConn,
  actor: MutationActor,
  bookingId: string,
  body: TransitionBookingInput,
): Promise<BookingMutationResult> {
  const row = await loadAccessibleBooking(conn, actor, bookingId);
  if ("ok" in row) return row;

  const currentState = deriveBookingState(row.kind, row.status);
  const toState: BookingState = body.toState;

  // Structure first (admin may override structure per the house rule),
  // then role policy.
  if (actor.role !== "admin" && !isValidBookingTransition(currentState, toState)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_TRANSITION",
      error: `A booking cannot move from ${currentState} to ${toState}.`,
    };
  }
  if (!canTransitionBooking(currentState, toState, actor.role)) {
    return {
      ok: false,
      status: 403,
      code: "TRANSITION_ROLE_FORBIDDEN",
      error: "Your role cannot perform this booking transition",
    };
  }

  const columns = bookingStateToColumns(toState, row.kind);
  const holdExited =
    row.kind === "hold" &&
    row.status === "active" &&
    (toState === "released" || toState === "expired" || toState === "lost");

  try {
    const outcome = await conn.transaction(async (tx) => {
      let ladderRows: BookingRow[] = [];
      if (holdExited) {
        // Deterministic lock acquisition (id order) across ALL of this
        // space's active ladder rows: concurrent exits serialize instead
        // of deadlocking, and the waiter re-reads committed state
        // (READ COMMITTED + FOR UPDATE re-evaluation).
        ladderRows = await tx
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.spaceId, row.spaceId),
              eq(bookings.kind, "hold"),
              eq(bookings.status, "active"),
              isNull(bookings.deletedAt),
            ),
          )
          .orderBy(asc(bookings.id))
          .for("update");
      }

      // Compare-and-set on the columns the transition was derived from:
      // if another transaction moved this booking between our read and
      // this write, zero rows match and the conflict is reported honestly
      // instead of double-exiting or resurrecting the row.
      const [updated] = await tx
        .update(bookings)
        .set({
          kind: columns.kind,
          status: columns.status,
          // Promotion to ink resolves the ladder; the rank is cleared
          // (bookings_rank_hold_only backs this at the DB).
          rank: toState === "ink" ? null : row.rank,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(bookings.id, row.id),
            eq(bookings.kind, row.kind),
            eq(bookings.status, row.status),
            isNull(bookings.deletedAt),
          ),
        )
        .returning();
      if (updated === undefined) return "stale" as const;

      await tx.insert(bookingStatusHistory).values({
        bookingId: row.id,
        fromState: currentState,
        toState,
        changedBy: actor.id,
        note: body.note ?? null,
      });

      let resequence: ResequenceResult | null = null;
      if (holdExited) {
        const survivors = ladderRows.filter((survivor) => survivor.id !== row.id);
        resequence = resequenceLaddersAfterExit(
          survivors.map((survivor) => ({
            id: survivor.id,
            title: survivor.title,
            ownerUserId: survivor.ownerUserId,
            rank: survivor.rank,
            jointFlag: survivor.jointFlag,
            createdAt: survivor.createdAt,
            startsAt: survivor.startsAt,
            endsAt: survivor.endsAt,
          })),
          { startsAt: row.startsAt, endsAt: row.endsAt },
        );
        for (const change of resequence.changes) {
          await tx
            .update(bookings)
            .set({ rank: change.toRank, updatedAt: new Date() })
            .where(eq(bookings.id, change.id));
        }
      }

      return { updated, resequence };
    });

    if (outcome === "stale") {
      return {
        ok: false,
        status: 409,
        code: "BOOKING_STATE_CHANGED",
        error: "This booking changed while you were working — reload the diary and try again.",
      };
    }
    return {
      ok: true,
      status: 200,
      booking: outcome.updated,
      changeKind: "booking.transitioned",
      resequence: outcome.resequence,
    };
  } catch (error) {
    const code = pgErrorCode(error);
    // The joint-first race, lost: another coordinator inked this slot
    // between our read and our write. The exclusion constraint arbitrated.
    if (code === PG_EXCLUSION_VIOLATION) return INK_SLOT_TAKEN;
    throw error;
  }
}

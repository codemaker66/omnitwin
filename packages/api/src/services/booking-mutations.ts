import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  BookingSchema,
  VIEWING_BOOKING_KIND,
  VIEWING_HAS_NO_EVENT_MESSAGE,
  bookingKindNeedsEvent,
  bookingStateToColumns,
  deriveBookingState,
  isValidBookingTransition,
  sha256Hex,
  stableCanonicalJson,
  type Booking,
  type BookingState,
  type CreateBookingInput,
  type TransitionBookingInput,
  type UpdateBookingInput,
} from "@omnitwin/types";
import { bookings, bookingStatusHistory, spaces, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { JwtUser } from "../middleware/auth.js";
import { canReadDiary } from "../utils/query.js";
import { canTransitionBooking } from "../state-machines/booking.js";
import {
  resequenceLaddersAfterExit,
  type ResequenceResult,
} from "./hold-hygiene.js";
import { jointlyPromoted, writePromotionNotices, type HoldExit, type PromotionNotice } from "./hold-promotion.js";
import { bindBookingToEvent, movePhasesWithBooking, syncEventStatus, syncEventStatuses, type BindTarget } from "./event-binding.js";

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
  /** Notices written in the transition's transaction for holds that became
   *  1st option; the transport announces them after commit. */
  readonly promotionNotices?: readonly PromotionNotice[];
}

export type BookingMutationResult = BookingMutationOk | BookingMutationDeny;

/** Optional server-prepared decision precondition; existing clients need no
 * additional field. The digest covers the full booking and its update marker,
 * not only the properties a requested patch happens to replace. */
export interface BookingUpdatePrecondition {
  readonly expectedStateDigest: string;
}

export function bookingMutationStateDigest(row: BookingRow): string {
  return sha256Hex(`venviewer.booking-mutation-state.v1\n${stableCanonicalJson({
    ...serializeBooking(row),
    deletedAt: toIsoOrNull(row.deletedAt),
  })}`);
}

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

// Who may ink the diary: the office, staff and admin (goal 19 D2; Blake's
// decision of 10 October 2026, landed with S6). Sales and manager read the
// Diary and work the pipeline but no longer write a time (goal 18 §6 decision
// 6a is superseded); hallkeepers read the day but do not move it, and
// caterers are event-scoped (6b). The client's side proposes a hold through
// canProposeWindow, never through this set.
export const DIARY_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

export function canWriteBookings(actor: MutationActor, venueId: string): boolean {
  return DIARY_WRITE_ROLES.has(actor.role) && actor.venueId === venueId;
}

/** A hold's owner is told about it (hold reminders email them), so the owner
 *  must be someone who works the Diary at the booking's venue. A crafted
 *  request must not name another venue's user, a hallkeeper or a client. */
/** Who may be named as a hold's owner: the office and the pipeline roles at
 *  the booking's venue. Owning a hold is being the person the house asks
 *  about it, not writing the Diary: sales and manager kept it when goal 19
 *  D2 took the write from them. The hallkeeper was never in it. */
export const HOLD_OWNER_ROLES: ReadonlySet<string> = new Set([...DIARY_WRITE_ROLES, "manager", "sales"]);

export async function ownerWorksAtVenue(conn: BookingDbConn, ownerUserId: string, venueId: string): Promise<boolean> {
  const [owner] = await conn
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.venueId, venueId), inArray(users.role, [...HOLD_OWNER_ROLES])))
    .limit(1);
  return owner !== undefined;
}

export const OWNER_VENUE_MISMATCH: BookingMutationDeny = {
  ok: false,
  status: 400,
  code: "OWNER_VENUE_MISMATCH",
  error: "Choose an owner who works at this venue.",
};

const INK_SLOT_TAKEN: BookingMutationDeny = {
  ok: false,
  status: 409,
  code: "INK_SLOT_TAKEN",
  error:
    "That slot has just been confirmed for this room — the first to confirm wins. Offer the client the next best available option.",
};

const INTEGRITY_VIOLATION: BookingMutationDeny = {
  ok: false,
  status: 400,
  code: "BOOKING_INTEGRITY_VIOLATION",
  error: "Booking violates a database integrity rule",
};

const EVENT_VENUE_MISMATCH: BookingMutationDeny = {
  ok: false,
  status: 400,
  code: "EVENT_VENUE_MISMATCH",
  error: "The event does not belong to this venue",
};

/** A provisional or confirmed booking cannot be parted from its event (the
 *  bind); it may move to another event of the same venue. */
const EVENT_REQUIRED: BookingMutationDeny = {
  ok: false,
  status: 400,
  code: "EVENT_REQUIRED",
  error: "A provisional or confirmed booking always belongs to an event. Move it to another of this venue's events instead.",
};

/** An insert or update that returned no row. Thrown inside a transaction so
 *  the rollback takes any event made for it too. */
class BookingWriteMissing extends Error {
  constructor() {
    super("Booking write returned no row");
    this.name = "BookingWriteMissing";
  }
}

/** The transition's compare-and-set matched nothing; thrown so its
 *  transaction rolls back whatever it wrote before. */
class StaleTransition extends Error {
  constructor() {
    super("Booking changed during its transition");
    this.name = "StaleTransition";
  }
}

const BOOKING_STATE_CHANGED: BookingMutationDeny = {
  ok: false,
  status: 409,
  code: "BOOKING_STATE_CHANGED",
  error: "This booking changed while you were working — reload the diary and try again.",
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
    lostReason: row.lostReason,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

/** Load a live booking the actor may see, or the deny that explains why. */
export async function loadAccessibleBooking(
  conn: BookingDbConn,
  actor: MutationActor,
  bookingId: string,
  lockForUpdate = false,
): Promise<BookingRow | BookingMutationDeny> {
  const query = conn
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
    .limit(1);
  const [row] = await (lockForUpdate ? query.for("update") : query);
  if (row === undefined) {
    return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", error: "Booking not found" };
  }
  // Everyone who reads the Diary may load its bookings, sales included (it
  // pencils the holds). Writing is gated again by each mutation: update checks
  // DIARY_WRITE_ROLES, a transition the state machine's roles, so the
  // hallkeeper still only reads.
  if (!canReadDiary(actor, row.venueId)) {
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

  if (input.ownerUserId !== undefined && !(await ownerWorksAtVenue(conn, input.ownerUserId, input.venueId))) {
    return OWNER_VENUE_MISMATCH;
  }

  // The bind: a named event is joined once it is checked to be this venue's
  // (tenant safety before the write, never after); a hold or ink without one
  // gets a new event. Both happen in the booking's own transaction, so no
  // failure can leave an event without its booking or a booking without its
  // event. Interest only and venue blocks join an event only when named.
  const target: BindTarget | null = input.eventId !== undefined
    ? { join: "event", eventId: input.eventId }
    : bookingKindNeedsEvent(input.kind) ? { join: "new" } : null;

  try {
    // Nested under a command's transaction this is a savepoint, so a refused
    // insert never poisons the caller's transaction.
    return await conn.transaction(async (tx): Promise<BookingMutationResult> => {
      let eventId: string | null = null;
      if (target !== null) {
        const bound = await bindBookingToEvent(tx, {
          venueId: input.venueId,
          title: input.title,
          eventType: input.eventType ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          createdBy: actor.id,
        }, target);
        if (!bound.ok) return EVENT_VENUE_MISMATCH;
        eventId = bound.eventId;
      }

      const [created] = await tx
        .insert(bookings)
        .values({
          venueId: input.venueId,
          spaceId: input.spaceId,
          eventId,
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
      // Thrown, not returned: returning would commit a new event with no
      // booking. The rollback takes the event with it.
      if (created === undefined) throw new BookingWriteMissing();
      if (eventId !== null) await syncEventStatus(tx, eventId);
      return { ok: true, status: 201, booking: created, changeKind: "booking.created" };
    });
  } catch (error) {
    if (error instanceof BookingWriteMissing) {
      return { ok: false, status: 500, code: "BOOKING_CREATE_FAILED", error: "Failed to create booking" };
    }
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
  precondition?: BookingUpdatePrecondition,
): Promise<BookingMutationResult> {
  // Role gate before any data access — hallkeeper reads the diary but
  // never edits it (venue scope is verified against the row below).
  if (!DIARY_WRITE_ROLES.has(actor.role)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }

  try {
    // The lock lives through merge, validation and write. Nesting creates a
    // savepoint so a constraint denial cannot poison an owning decision/Diary
    // transaction. Only this target booking is locked; ladder exits retain
    // their existing ordered multi-row lock acquisition.
    return await conn.transaction((tx) => updateBookingLocked(tx, actor, bookingId, patch, precondition));
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === PG_EXCLUSION_VIOLATION) return INK_SLOT_TAKEN;
    if (code === PG_CHECK_VIOLATION) return INTEGRITY_VIOLATION;
    throw error;
  }
}

async function updateBookingLocked(
  conn: BookingDbConn,
  actor: MutationActor,
  bookingId: string,
  patch: UpdateBookingInput,
  precondition: BookingUpdatePrecondition | undefined,
): Promise<BookingMutationResult> {
  const row = await loadAccessibleBooking(conn, actor, bookingId, true);
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

  if (precondition !== undefined && precondition.expectedStateDigest !== bookingMutationStateDigest(row)) {
    return {
      ok: false,
      status: 409,
      code: "BOOKING_STATE_CHANGED",
      error: "This booking changed after the decision was prepared — review its current state before applying it.",
    };
  }

  if (patch.rank !== undefined && row.kind !== "hold") {
    return validationDeny([{ path: ["rank"], message: "Only a provisional hold has an option number." }]);
  }
  // A viewing is a show-round for its enquiry, never part of an event
  // (bookings_viewing_has_no_event backs this at the database).
  if (row.kind === VIEWING_BOOKING_KIND && patch.eventId !== undefined && patch.eventId !== null) {
    return validationDeny([{ path: ["eventId"], message: VIEWING_HAS_NO_EVENT_MESSAGE }]);
  }

  // The bind: a hold or ink may move to another event of its venue, never to
  // none. Interest only and venue blocks may still be detached.
  if (patch.eventId === null && bookingKindNeedsEvent(row.kind)) return EVENT_REQUIRED;
  if (patch.eventId !== undefined && patch.eventId !== null && patch.eventId !== row.eventId) {
    const bound = await bindBookingToEvent(conn, {
      venueId: row.venueId,
      title: row.title,
      eventType: row.eventType,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdBy: actor.id,
    }, { join: "event", eventId: patch.eventId });
    if (!bound.ok) return EVENT_VENUE_MISMATCH;
  }

  // A new owner must work at this venue; keeping the owner it has is not
  // re-checked, so a hold whose owner moved on can still be edited.
  if (patch.ownerUserId !== undefined && patch.ownerUserId !== row.ownerUserId
    && !(await ownerWorksAtVenue(conn, patch.ownerUserId, row.venueId))) {
    return OWNER_VENUE_MISMATCH;
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

  const [updated] = await conn
    .update(bookings)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(bookings.id, row.id), eq(bookings.status, "active"), isNull(bookings.deletedAt)))
    .returning();
  if (updated === undefined) {
    return {
      ok: false,
      status: 500,
      code: "BOOKING_UPDATE_FAILED",
      error: "Failed to update booking",
    };
  }
  // A move reaches its event (release audit events-diary-1/-3): the event's
  // phases on the booking's day follow it, and the event's dates follow its
  // bookings. A booking that moved between events changes what both hold.
  const timesChanged = updated.startsAt.getTime() !== row.startsAt.getTime()
    || updated.endsAt.getTime() !== row.endsAt.getTime();
  const roomChanged = updated.spaceId !== row.spaceId;
  if (row.eventId !== null && updated.eventId === row.eventId && (timesChanged || roomChanged)) {
    await movePhasesWithBooking(conn, {
      bookingId: row.id,
      eventId: row.eventId,
      from: { spaceId: row.spaceId, startsAt: row.startsAt, endsAt: row.endsAt },
      to: { spaceId: updated.spaceId, startsAt: updated.startsAt },
    });
  }
  if (updated.eventId !== row.eventId || timesChanged) await syncEventStatuses(conn, [row.eventId, updated.eventId]);
  return { ok: true, status: 200, booking: updated, changeKind: "booking.updated" };
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

  // A viewing is a different thing from a commitment, not a stage of one: no
  // booking becomes one (a hold or ink would carry its event into a viewing,
  // which takes none). This is the booking's kind, not its lifecycle, so the
  // admin's structural override does not reach it. Book a viewing instead.
  if (toState === VIEWING_BOOKING_KIND && row.kind !== VIEWING_BOOKING_KIND) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_TRANSITION",
      error: "A booking cannot become a viewing. Book the viewing as its own booking.",
    };
  }
  // Nor does a viewing become a commitment: its only move is to be called
  // off (and, by the admin's override, a called-off one put back). A hold or
  // confirmed booking for the same guest is booked as its own booking.
  if (row.kind === VIEWING_BOOKING_KIND && toState !== "cancelled" && toState !== VIEWING_BOOKING_KIND) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_TRANSITION",
      error: "A viewing can only be called off. Book the hold or the confirmed booking as its own booking.",
    };
  }

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

  // A booking made provisional becomes a live hold, which carries its
  // hygiene like any other (roadmap N3): what the request gives over what
  // the booking has, the owner defaulting to whoever makes it provisional.
  // Without this a promoted hold had no decision date, owner or dated next
  // action, and no list or reminder would ever find it.
  const becomesLiveHold = columns.kind === "hold" && columns.status === "active";
  const given = body.hold ?? {};
  if (becomesLiveHold && given.ownerUserId !== undefined && given.ownerUserId !== row.ownerUserId
    && !(await ownerWorksAtVenue(conn, given.ownerUserId, row.venueId))) {
    return OWNER_VENUE_MISMATCH;
  }
  const actorMayOwn = becomesLiveHold && given.ownerUserId === undefined && row.ownerUserId === null
    && await ownerWorksAtVenue(conn, actor.id, row.venueId);
  const mergedHygiene = (base: BookingRow) => ({
    decisionAt: given.decisionAt === undefined ? base.decisionAt : new Date(given.decisionAt),
    ownerUserId: given.ownerUserId ?? base.ownerUserId ?? (actorMayOwn ? actor.id : null),
    nextAction: given.nextAction ?? base.nextAction,
    nextActionDueAt: given.nextActionDueAt === undefined ? base.nextActionDueAt : new Date(given.nextActionDueAt),
    rank: given.rank ?? base.rank,
    jointFlag: given.jointFlag ?? base.jointFlag,
  });
  if (becomesLiveHold) {
    const missing = holdHygieneIssues({ kind: "hold", status: "active", ...mergedHygiene(row) });
    if (missing.length > 0) {
      return {
        ok: false,
        status: 400,
        code: "HOLD_HYGIENE_REQUIRED",
        error: "A provisional hold needs a decision date, an owner and a dated next action.",
        details: missing,
      };
    }
  }

  const holdExit: HoldExit | null =
    row.kind === "hold" && row.status === "active"
      && (toState === "released" || toState === "expired" || toState === "lost")
      ? toState
      : null;
  const holdExited = holdExit !== null;

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
        // A move/exit/delete can remove the target while the ordered query
        // waits. Do not follow it into another ladder and acquire an unordered
        // extra lock after already locking this space's survivors.
        if (!ladderRows.some((candidate) => candidate.id === row.id)) return "stale" as const;
      }

      // A partial edit can commit while this transition waits for its ladder.
      // Lock the target only AFTER the ordered ladder locks, then check the
      // promise the transition was based on. A rank changed by a preceding
      // exit is legitimate: preserve that current rank rather than restoring
      // our earlier observation. No ladder/history writes precede this check.
      const current = await loadAccessibleBooking(tx, actor, row.id, true);
      if ("ok" in current || current.kind !== row.kind || current.status !== row.status
        || current.venueId !== row.venueId || current.spaceId !== row.spaceId || current.eventId !== row.eventId
        || current.startsAt.getTime() !== row.startsAt.getTime() || current.endsAt.getTime() !== row.endsAt.getTime()) {
        return "stale" as const;
      }

      // Merged again from the row as it stands now: an edit that landed
      // meanwhile is kept, and a hold it would leave without its hygiene
      // is reported as a change rather than written.
      const hygiene = becomesLiveHold ? mergedHygiene(current) : null;
      if (hygiene !== null && holdHygieneIssues({ kind: "hold", status: "active", ...hygiene }).length > 0) {
        return "stale" as const;
      }

      // The bind: interest only made provisional or confirmed takes its event
      // now, in this transaction (its enquiry's event when it has one).
      let eventId = current.eventId;
      if (eventId === null && bookingKindNeedsEvent(columns.kind)) {
        const seed = {
          venueId: current.venueId,
          title: current.title,
          eventType: current.eventType,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          createdBy: actor.id,
        };
        const joined = current.enquiryId === null
          ? null
          : await bindBookingToEvent(tx, seed, { join: "enquiry", enquiryId: current.enquiryId });
        const bound = joined?.ok === true ? joined : await bindBookingToEvent(tx, seed, { join: "new" });
        if (!bound.ok) throw new Error("A new event could not be bound");
        eventId = bound.eventId;
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
          eventId,
          // Promotion to ink resolves the ladder; the rank is cleared
          // (bookings_rank_hold_only backs this at the DB).
          rank: toState === "ink" ? null : hygiene?.rank ?? current.rank,
          // The lost reason (migration 0100) is written with the loss and
          // cleared by any other move, so it only ever sits on a lost booking
          // (bookings_lost_reason_check).
          lostReason: toState === "lost" ? body.lostReason ?? null : null,
          ...(hygiene === null ? {} : {
            decisionAt: hygiene.decisionAt,
            ownerUserId: hygiene.ownerUserId,
            nextAction: hygiene.nextAction,
            nextActionDueAt: hygiene.nextActionDueAt,
            jointFlag: hygiene.jointFlag,
          }),
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
      // Thrown, not returned, so an event made for it above rolls back too.
      if (updated === undefined) throw new StaleTransition();

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

      // Blake's 26 September decision: the new 1st option's owner is told in
      // the app, in THIS transaction, so a promotion is never silent and a
      // notice never outlives a rolled-back exit. Nothing is emailed here.
      let promotionNotices: readonly PromotionNotice[] = [];
      if (holdExit !== null && resequence !== null && resequence.promotedToFirst.length > 0) {
        const survivorById = new Map(ladderRows.map((survivor) => [survivor.id, survivor]));
        const promoted = resequence.promotedToFirst.flatMap((hold) => {
          const survivor = survivorById.get(hold.id);
          return survivor === undefined ? [] : [survivor];
        });
        const joint = jointlyPromoted(promoted);
        promotionNotices = await writePromotionNotices(tx, {
          venueId: row.venueId,
          spaceId: row.spaceId,
          exit: holdExit,
          actorUserId: actor.id,
          promoted: promoted.map((survivor) => ({
            id: survivor.id,
            title: survivor.title,
            ownerUserId: survivor.ownerUserId,
            jointFlag: joint.has(survivor.id),
            startsAt: survivor.startsAt,
          })),
          roles: { diaryWriteRoles: DIARY_WRITE_ROLES, holdOwnerRoles: HOLD_OWNER_ROLES },
        });
      }

      // The event follows its bookings: confirmed once inked, lost when its
      // last option goes, cancelled when its confirmed booking does. Last,
      // after every booking lock this transaction takes (the lock order).
      if (updated.eventId !== null) await syncEventStatus(tx, updated.eventId);

      return { updated, resequence, promotionNotices };
    });

    if (outcome === "stale") return BOOKING_STATE_CHANGED;
    return {
      ok: true,
      status: 200,
      booking: outcome.updated,
      changeKind: "booking.transitioned",
      resequence: outcome.resequence,
      promotionNotices: outcome.promotionNotices,
    };
  } catch (error) {
    if (error instanceof StaleTransition) return BOOKING_STATE_CHANGED;
    const code = pgErrorCode(error);
    // The joint-first race, lost: another coordinator inked this slot
    // between our read and our write. The exclusion constraint arbitrated.
    if (code === PG_EXCLUSION_VIOLATION) return INK_SLOT_TAKEN;
    throw error;
  }
}

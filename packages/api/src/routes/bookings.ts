import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  BookingSchema,
  CreateBookingSchema,
  TransitionBookingSchema,
  UpdateBookingSchema,
  bookingStateToColumns,
  deriveBookingState,
  isValidBookingTransition,
  type Booking,
  type BookingState,
} from "@omnitwin/types";
import { z } from "zod";
import { bookings, bookingStatusHistory, events, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
import { canTransitionBooking } from "../state-machines/booking.js";
import {
  resequenceLaddersAfterExit,
  type ResequenceResult,
} from "../services/hold-hygiene.js";

// ---------------------------------------------------------------------------
// Booking write surface (T-487/T-488/T-491; Canon §1–§3).
//
// The Diary's commitment axis over HTTP. Hold hygiene is enforced at this
// boundary: a hold cannot be created or edited into existence without a
// decision date, an owner, and a dated next action (Canon §3 — the wedge;
// §17 universal law). Lifecycle moves go ONLY through /:id/transition, where
// the two-layer state machine (structural matrix + role policy) governs and
// the database exclusion constraint arbitrates the joint-first ink race:
// Postgres 23P01 here becomes a calm 409, never a stack trace.
// ---------------------------------------------------------------------------

type BookingRow = typeof bookings.$inferSelect;

const IdParam = z.object({ id: z.string().uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

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
function pgErrorCode(error: unknown): string | null {
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

const PG_EXCLUSION_VIOLATION = "23P01";
const PG_CHECK_VIOLATION = "23514";

// Diary writes are staff/admin only — hallkeeper is a read-facing ops role
// here, matching the state machine's role policy (review finding: the shared
// canManageVenue helper includes hallkeeper and stays that way for reads).
const DIARY_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

function canWriteBookings(user: JwtUser, venueId: string): boolean {
  return DIARY_WRITE_ROLES.has(user.role) && user.venueId === venueId;
}

function inkSlotTaken(reply: FastifyReply): FastifyReply {
  return reply.status(409).send({
    error:
      "That slot has just been inked for this space — the first to confirm wins. Offer the client the next best available option.",
    code: "INK_SLOT_TAKEN",
  });
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
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

async function requireBookingAccess(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  bookingId: string,
): Promise<BookingRow | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
    .limit(1);
  if (row === undefined) {
    await reply.status(404).send({ error: "Booking not found", code: "BOOKING_NOT_FOUND" });
    return null;
  }
  if (!canManageVenue(request.user, row.venueId)) {
    await reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    return null;
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

export async function bookingRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const input = parsed.data;

    if (!canWriteBookings(request.user, input.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const [space] = await db
      .select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, input.spaceId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined || space.venueId !== input.venueId) {
      return reply.status(400).send({
        error: "The space does not belong to this venue",
        code: "SPACE_VENUE_MISMATCH",
      });
    }

    if (input.eventId !== undefined) {
      const [eventRow] = await db
        .select({ id: events.id, venueId: events.venueId })
        .from(events)
        .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
        .limit(1);
      if (eventRow === undefined || eventRow.venueId !== input.venueId) {
        return reply.status(400).send({
          error: "The event does not belong to this venue",
          code: "EVENT_VENUE_MISMATCH",
        });
      }
    }

    try {
      const [created] = await db
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
          createdBy: request.user.id,
        })
        .returning();
      if (created === undefined) {
        return await reply
          .status(500)
          .send({ error: "Failed to create booking", code: "BOOKING_CREATE_FAILED" });
      }
      return await reply.status(201).send({ data: serializeBooking(created) });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === PG_EXCLUSION_VIOLATION) return inkSlotTaken(reply);
      if (code === PG_CHECK_VIOLATION) {
        return reply.status(400).send({
          error: "Booking violates a database integrity rule",
          code: "BOOKING_INTEGRITY_VIOLATION",
        });
      }
      throw error;
    }
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const row = await requireBookingAccess(db, request, reply, params.data.id);
    if (row === null) return;
    return { data: serializeBooking(row) };
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = UpdateBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const patch = parsed.data;

    // Role gate before any data access — hallkeeper reads the diary but
    // never edits it (venue scope is verified against the row below).
    if (!DIARY_WRITE_ROLES.has(request.user.role)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const row = await requireBookingAccess(db, request, reply, params.data.id);
    if (row === null) return;

    // Exited bookings are history, and history does not get rewritten —
    // booking_status_history has no field snapshots to audit such an edit.
    if (row.status !== "active") {
      return reply.status(409).send({
        error: `This booking has exited the diary (${row.status}) — exited bookings are records, not editable plans.`,
        code: "BOOKING_NOT_ACTIVE",
      });
    }

    if (patch.rank !== undefined && row.kind !== "hold") {
      return validationError(reply, [
        { path: ["rank"], message: "Only holds carry an option-ladder rank." },
      ]);
    }

    if (patch.eventId !== undefined && patch.eventId !== null) {
      const [eventRow] = await db
        .select({ id: events.id, venueId: events.venueId })
        .from(events)
        .where(and(eq(events.id, patch.eventId), isNull(events.deletedAt)))
        .limit(1);
      if (eventRow === undefined || eventRow.venueId !== row.venueId) {
        return reply.status(400).send({
          error: "The event does not belong to this venue",
          code: "EVENT_VENUE_MISMATCH",
        });
      }
    }

    // Cross-lane move (the Board): the target room must belong to the same
    // venue — the composite bookings_space_venue_fk backs this at the DB.
    if (patch.spaceId !== undefined && patch.spaceId !== row.spaceId) {
      const [space] = await db
        .select({ id: spaces.id, venueId: spaces.venueId })
        .from(spaces)
        .where(and(eq(spaces.id, patch.spaceId), isNull(spaces.deletedAt)))
        .limit(1);
      if (space === undefined || space.venueId !== row.venueId) {
        return reply.status(400).send({
          error: "The space does not belong to this venue",
          code: "SPACE_VENUE_MISMATCH",
        });
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
      return validationError(reply, [
        { path: ["endsAt"], message: "endsAt must be after startsAt." },
      ]);
    }

    const hygieneMissing = holdHygieneIssues({ kind: row.kind, status: row.status, ...next });
    if (hygieneMissing.length > 0) {
      return reply.status(400).send({
        error:
          "A live hold keeps its hygiene: decision date, owner, and a dated next action are required.",
        code: "HOLD_HYGIENE_REQUIRED",
        details: hygieneMissing,
      });
    }

    try {
      const [updated] = await db
        .update(bookings)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(bookings.id, row.id))
        .returning();
      if (updated === undefined) {
        return await reply
          .status(500)
          .send({ error: "Failed to update booking", code: "BOOKING_UPDATE_FAILED" });
      }
      return { data: serializeBooking(updated) };
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === PG_EXCLUSION_VIOLATION) return inkSlotTaken(reply);
      if (code === PG_CHECK_VIOLATION) {
        return reply.status(400).send({
          error: "Booking violates a database integrity rule",
          code: "BOOKING_INTEGRITY_VIOLATION",
        });
      }
      throw error;
    }
  });

  server.post("/:id/transition", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = TransitionBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const row = await requireBookingAccess(db, request, reply, params.data.id);
    if (row === null) return;

    const currentState = deriveBookingState(row.kind, row.status);
    const toState: BookingState = parsed.data.toState;

    // Structure first (admin may override structure per the house rule),
    // then role policy.
    if (request.user.role !== "admin" && !isValidBookingTransition(currentState, toState)) {
      return reply.status(400).send({
        error: `A booking cannot move from ${currentState} to ${toState}.`,
        code: "INVALID_TRANSITION",
      });
    }
    if (!canTransitionBooking(currentState, toState, request.user.role)) {
      return reply.status(403).send({
        error: "Your role cannot perform this booking transition",
        code: "TRANSITION_ROLE_FORBIDDEN",
      });
    }

    const columns = bookingStateToColumns(toState, row.kind);
    const holdExited =
      row.kind === "hold" &&
      row.status === "active" &&
      (toState === "released" || toState === "expired" || toState === "lost");

    try {
      const outcome = await db.transaction(async (tx) => {
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
          changedBy: request.user.id,
          note: parsed.data.note ?? null,
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
        return await reply.status(409).send({
          error:
            "This booking changed while you were working — reload the diary and try again.",
          code: "BOOKING_STATE_CHANGED",
        });
      }
      return {
        data: serializeBooking(outcome.updated),
        // The Canon §3 human ping: promotions ride the response so the caller
        // can tell someone "this hold is now 1st option". Delivery is P1.
        resequence: outcome.resequence,
      };
    } catch (error) {
      const code = pgErrorCode(error);
      // The joint-first race, lost: another coordinator inked this slot
      // between our read and our write. The exclusion constraint arbitrated.
      if (code === PG_EXCLUSION_VIOLATION) return inkSlotTaken(reply);
      throw error;
    }
  });
}

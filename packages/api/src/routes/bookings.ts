import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  ConvertEnquirySchema,
  CreateBookingSchema,
  TransitionBookingSchema,
  UpdateBookingSchema,
  type DiaryCommand,
} from "@omnitwin/types";
import { z } from "zod";
import { bookings, enquiries, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { emit, type EventPayload } from "../observability/event-bus.js";
import {
  canWriteBookings,
  createBookingCore,
  loadAccessibleBooking,
  pgErrorCode,
  PG_CHECK_VIOLATION,
  serializeBooking,
  transitionBookingCore,
  updateBookingCore,
  type BookingMutationDeny,
  type BookingRow,
} from "../services/booking-mutations.js";
import {
  ackToHttpReply,
  executeDiaryCommand,
  realDiaryCommandDeps,
} from "../services/diary-commands.js";

// ---------------------------------------------------------------------------
// Booking write surface (T-487/T-488/T-491; Canon §1–§3).
//
// The Diary's commitment axis over HTTP. Since T-537 the create/update/
// transition handlers are thin adapters over the mutation cores in
// services/booking-mutations.ts — the SAME cores the /ws/diary command
// channel dispatches (Canon §9: one validation dialect, two transports).
// Hold hygiene, the two-layer state machine, and the exclusion-constraint
// ink-race arbitration (23P01 → calm 409) all live in the cores now; this
// file only parses, delegates, publishes, and shapes replies.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function sendDeny(reply: FastifyReply, deny: BookingMutationDeny): FastifyReply {
  return reply.status(deny.status).send({
    error: deny.error,
    code: deny.code,
    ...(deny.details === undefined ? {} : { details: deny.details }),
  });
}

type DiaryChangeKind = EventPayload<"diary.changed">["kind"];

/** Emit AFTER the mutation's transaction has committed (Canon §9: commit →
 *  broadcast). Fire-and-forget — the hot path never waits on subscribers. */
function publishDiaryChanged(
  request: FastifyRequest,
  venueId: string,
  kind: DiaryChangeKind,
  bookingId: string,
): void {
  emit(request.log, "diary.changed", {
    venueId,
    kind,
    bookingId,
    actorUserId: request.user.id,
    at: new Date().toISOString(),
  });
}

export { serializeBooking } from "../services/booking-mutations.js";

// --- REST command idempotency (T-538) --------------------------------------
// A mutation carrying an `Idempotency-Key` header (a client-minted uuid
// commandId) runs THROUGH executeDiaryCommand — the same envelope dispatch,
// diary_commands ledger, savepoint law, and replay authorization the
// /ws/diary transport uses. One dialect, two transports, ONE ledger: a
// resend across EITHER transport replays the recorded outcome instead of
// re-executing. Keyless requests take the exact pre-T-538 path.

const IdempotencyKeyValue = z.string().uuid();

type IdempotencyHeader =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "key"; readonly commandId: string };

function readIdempotencyKey(request: FastifyRequest): IdempotencyHeader {
  const raw = request.headers["idempotency-key"];
  if (raw === undefined) return { kind: "absent" };
  const parsed = IdempotencyKeyValue.safeParse(raw);
  if (!parsed.success) return { kind: "invalid" };
  return { kind: "key", commandId: parsed.data };
}

function invalidIdempotencyKey(reply: FastifyReply): FastifyReply {
  return validationError(reply, [
    { path: ["idempotency-key"], message: "Idempotency-Key must be a uuid" },
  ]);
}

/** Dispatch a keyed mutation through the command path and shape the reply
 *  exactly like the keyless adapters (plus the Idempotency-Replay header). */
async function runKeyedCommand(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  command: DiaryCommand,
): Promise<FastifyReply> {
  const actorVenueId = request.user.venueId;
  if (actorVenueId === null) {
    // The ledger records the actor's venue scope (the ws door has the same
    // requirement — "the diary is a venue surface"). Keyless requests from
    // the same actor are unaffected.
    return reply.status(400).send({
      error: "Idempotent diary writes require a venue-scoped session",
      code: "IDEMPOTENCY_REQUIRES_VENUE",
    });
  }
  const execution = await executeDiaryCommand(
    db,
    request.user,
    actorVenueId,
    command,
    realDiaryCommandDeps(db),
  );
  if (execution.changed !== null) {
    // Fresh commit → broadcast, exactly like the keyless adapters (the
    // booking's own venue scopes the event). Replays publish nothing.
    publishDiaryChanged(
      request,
      execution.ack.booking?.venueId ?? actorVenueId,
      execution.changed.kind,
      execution.changed.bookingId,
    );
  }
  const http = ackToHttpReply(command.kind, execution.ack);
  return reply
    .status(http.status)
    .header("idempotency-replay", String(http.replay))
    .send(http.body);
}

export async function bookingRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const key = readIdempotencyKey(request);
    if (key.kind === "invalid") return invalidIdempotencyKey(reply);
    if (key.kind === "key") {
      return runKeyedCommand(db, request, reply, {
        kind: "booking.create",
        commandId: key.commandId,
        payload: parsed.data,
      });
    }

    const result = await createBookingCore(db, request.user, parsed.data);
    if (!result.ok) return sendDeny(reply, result);
    publishDiaryChanged(request, result.booking.venueId, result.changeKind, result.booking.id);
    return reply.status(result.status).send({ data: serializeBooking(result.booking) });
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    // One copy of the fetch + venue policy — the same loadAccessibleBooking
    // the mutation cores use (reviewer P2, T-537). Wire shape unchanged:
    // 404 BOOKING_NOT_FOUND / 403 FORBIDDEN, exactly as before.
    const row = await loadAccessibleBooking(db, request.user, params.data.id);
    if ("ok" in row) return sendDeny(reply, row);
    return { data: serializeBooking(row) };
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = UpdateBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const key = readIdempotencyKey(request);
    if (key.kind === "invalid") return invalidIdempotencyKey(reply);
    if (key.kind === "key") {
      return runKeyedCommand(db, request, reply, {
        kind: "booking.update",
        commandId: key.commandId,
        bookingId: params.data.id,
        payload: parsed.data,
      });
    }

    const result = await updateBookingCore(db, request.user, params.data.id, parsed.data);
    if (!result.ok) return sendDeny(reply, result);
    publishDiaryChanged(request, result.booking.venueId, result.changeKind, result.booking.id);
    return { data: serializeBooking(result.booking) };
  });

  server.post("/:id/transition", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = TransitionBookingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const key = readIdempotencyKey(request);
    if (key.kind === "invalid") return invalidIdempotencyKey(reply);
    if (key.kind === "key") {
      return runKeyedCommand(db, request, reply, {
        kind: "booking.transition",
        commandId: key.commandId,
        bookingId: params.data.id,
        payload: parsed.data,
      });
    }

    const result = await transitionBookingCore(db, request.user, params.data.id, parsed.data);
    if (!result.ok) return sendDeny(reply, result);
    publishDiaryChanged(request, result.booking.venueId, result.changeKind, result.booking.id);
    return {
      data: serializeBooking(result.booking),
      // The Canon §3 human ping: promotions ride the response so the caller
      // can tell someone "this hold is now 1st option".
      resequence: result.resequence ?? null,
    };
  });

  // Enquiry→hold conversion (T-496; Canon §12 P0 "enquiry→hold"). Always a
  // hold, always hygienic — the schema requires the quartet. The enquiry's
  // own lifecycle is deliberately untouched: the commitment axis and the
  // enquiry axis stay independent (Canon §1); provenance lives on
  // bookings.enquiry_id. REST-only for now: the tray conversion is not a
  // board-latency surface, so it is deliberately NOT a ws command kind
  // (architecture doc §13).
  server.post("/from-enquiry", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = ConvertEnquirySchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const input = parsed.data;

    const [enquiry] = await db
      .select()
      .from(enquiries)
      .where(eq(enquiries.id, input.enquiryId))
      .limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "ENQUIRY_NOT_FOUND" });
    }
    if (!canWriteBookings(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const spaceId = input.spaceId ?? enquiry.spaceId;
    const [space] = await db
      .select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined || space.venueId !== enquiry.venueId) {
      return reply.status(400).send({
        error: "The space does not belong to this venue",
        code: "SPACE_VENUE_MISMATCH",
      });
    }

    const fallbackTitle = `${enquiry.name}${enquiry.eventType === null ? "" : ` — ${enquiry.eventType}`}`;
    const title = input.title ?? fallbackTitle.slice(0, 200);

    try {
      const [created]: (BookingRow | undefined)[] = await db
        .insert(bookings)
        .values({
          venueId: enquiry.venueId,
          spaceId,
          eventId: null,
          kind: "hold",
          status: "active",
          title,
          eventType: input.eventType ?? enquiry.eventType,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          rank: input.rank ?? null,
          jointFlag: input.jointFlag ?? false,
          decisionAt: new Date(input.decisionAt),
          ownerUserId: input.ownerUserId,
          nextAction: input.nextAction,
          nextActionDueAt: new Date(input.nextActionDueAt),
          seriesId: null,
          notes: input.notes ?? null,
          createdBy: request.user.id,
          enquiryId: enquiry.id,
        })
        .returning();
      if (created === undefined) {
        return await reply
          .status(500)
          .send({ error: "Failed to convert the enquiry", code: "BOOKING_CREATE_FAILED" });
      }
      publishDiaryChanged(request, created.venueId, "enquiry.converted", created.id);
      return await reply.status(201).send({ data: serializeBooking(created) });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === PG_CHECK_VIOLATION) {
        return reply.status(400).send({
          error: "Booking violates a database integrity rule",
          code: "BOOKING_INTEGRITY_VIOLATION",
        });
      }
      throw error;
    }
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  BookViewingSchema,
  ConvertEnquirySchema,
  CreateBookingSchema,
  TransitionBookingSchema,
  UpdateBookingSchema,
  VIEWING_BOOKING_KIND,
  isBookingEnquiry,
  occasionLabel,
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
  OWNER_VENUE_MISMATCH,
  ownerWorksAtVenue,
  pgErrorCode,
  PG_CHECK_VIOLATION,
  PG_UNIQUE_VIOLATION,
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
import { announcePromotionNotices, loadPromotionDraft } from "../services/hold-promotion.js";
import { bindBookingToEvent, syncEventStatus } from "../services/event-binding.js";
import { canReadDiary } from "../utils/query.js";

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

/** GET /bookings reads exactly one enquiry's bookings: a missing, malformed,
 *  repeated or unknown parameter is a 400, never a wider read. */
const EnquiryBookingsQuery = z.object({ enquiryId: z.string().uuid() }).strict();

/** Far above the bookings any one enquiry holds; the list is never paged. */
const ENQUIRY_BOOKINGS_LIMIT = 100;

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
    announcePromotionNotices(request.log, execution.changed.notices);
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

  // An enquiry's own live bookings (T-635): the Enquiries desk reads where an
  // enquiry stands in the Diary. Live is the Diary's meaning (isLiveBooking:
  // active and not deleted), and only in rooms the Diary still shows, so
  // nothing comes back that GET /calendar would not draw. Gated as the Diary
  // is, by canReadDiary at the enquiry's venue: an unknown enquiry is 404, one
  // the caller may not read is 403, as GET /:id answers for a booking.
  server.get("", { preHandler: [authenticate] }, async (request, reply) => {
    const query = EnquiryBookingsQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const [enquiry] = await db
      .select({ id: enquiries.id, venueId: enquiries.venueId })
      .from(enquiries)
      .where(eq(enquiries.id, query.data.enquiryId))
      .limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "ENQUIRY_NOT_FOUND" });
    }
    if (!canReadDiary(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }

    const rows = await db
      .select({ booking: bookings })
      .from(bookings)
      // The calendar's rooms: this venue's spaces that are not soft-deleted.
      .innerJoin(spaces, and(
        eq(spaces.id, bookings.spaceId),
        eq(spaces.venueId, enquiry.venueId),
        isNull(spaces.deletedAt),
      ))
      .where(and(
        eq(bookings.enquiryId, enquiry.id),
        eq(bookings.venueId, enquiry.venueId),
        eq(bookings.status, "active"),
        isNull(bookings.deletedAt),
      ))
      .orderBy(asc(bookings.startsAt), asc(bookings.id))
      .limit(ENQUIRY_BOOKINGS_LIMIT);
    return { data: rows.map((row) => serializeBooking(row.booking)) };
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

  // The drafted email for a hold that has become 1st option (Blake, 26 Sep):
  // composed for the person reading it, addressed to the client of record,
  // and never sent from here. A person reads it and sends it themselves.
  server.get("/:id/promotion-draft", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await loadPromotionDraft(db, request.user, params.data.id);
    if (!result.ok) return reply.status(result.status).send({ error: result.error, code: result.code });
    return { data: result.draft };
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
    announcePromotionNotices(request.log, result.promotionNotices);
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
  // bookings.enquiry_id. Since the bind (migration 0090) the hold is born
  // with its event: the enquiry's event when it already has one, otherwise a
  // new one (services/event-binding.ts). REST-only for now: the tray
  // conversion is not a board-latency surface, so it is deliberately NOT a
  // ws command kind (architecture doc §13).
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

    // An enquiry whose guest named no room is only filed under one (roadmap
    // N6), so its hold takes the room someone chose, never the filing room.
    if (input.spaceId === undefined && !enquiry.roomChosen) {
      return reply.status(400).send({
        error: "Choose a room for this hold. The guest did not choose one.",
        code: "ROOM_NOT_CHOSEN",
      });
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
    if (!(await ownerWorksAtVenue(db, input.ownerUserId, enquiry.venueId))) {
      return reply.status(OWNER_VENUE_MISMATCH.status).send({ error: OWNER_VENUE_MISMATCH.error, code: OWNER_VENUE_MISMATCH.code });
    }

    const occasion = occasionLabel(enquiry.eventType);
    const fallbackTitle = `${enquiry.name}${occasion === null ? "" : ` — ${occasion}`}`;
    const title = input.title ?? fallbackTitle.slice(0, 200);
    const eventType = input.eventType ?? enquiry.eventType;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    try {
      // The bind: the hold joins the event this enquiry's other holds already
      // have (a second room for the same wedding), or makes the enquiry's
      // first event, in the hold's own transaction. The enquiry row is locked
      // while it does, so two holds pencilled at once still share one event.
      const created = await db.transaction(async (tx): Promise<BookingRow | null> => {
        const bound = await bindBookingToEvent(tx, {
          venueId: enquiry.venueId,
          title,
          eventType,
          startsAt,
          endsAt,
          createdBy: request.user.id,
          clientName: enquiry.name,
        }, { join: "enquiry", enquiryId: enquiry.id });
        // The enquiry was read at this venue above; a mismatch here means it
        // changed meanwhile, and nothing is written.
        if (!bound.ok) return null;
        const [row]: (BookingRow | undefined)[] = await tx
          .insert(bookings)
          .values({
            venueId: enquiry.venueId,
            spaceId,
            eventId: bound.eventId,
            kind: "hold",
            status: "active",
            title,
            eventType,
            startsAt,
            endsAt,
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
        // Thrown so the rollback takes a newly made event with it.
        if (row === undefined) throw new Error("The enquiry's hold insert returned no row");
        await syncEventStatus(tx, bound.eventId);
        return row;
      });
      if (created === null) {
        return await reply.status(409).send({
          error: "This enquiry changed while the hold was being made. Open it again and hold the date.",
          code: "ENQUIRY_CHANGED",
        });
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

  // A viewing booked for an enquiry (migration 0100): a show-round of a room,
  // hosted by its owner (by default whoever books it). Gated as the hold
  // conversion is, by the Diary's write roles at the enquiry's venue. It
  // takes no event, carries no hold's hygiene and never blocks a date: the
  // conflict engine says when it overlaps a confirmed booking or another
  // viewing. Show-rounds per booking, a funnel measure, counts these. The same
  // viewing asked for twice (a double press, a retry) is booked once: the
  // second answer is the first viewing (bookings_viewing_once).
  server.post("/viewings", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = BookViewingSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const input = parsed.data;

    const [enquiry] = await db
      .select({
        id: enquiries.id,
        venueId: enquiries.venueId,
        spaceId: enquiries.spaceId,
        roomChosen: enquiries.roomChosen,
        name: enquiries.name,
        state: enquiries.state,
        eventType: enquiries.eventType,
      })
      .from(enquiries)
      .where(eq(enquiries.id, input.enquiryId))
      .limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "ENQUIRY_NOT_FOUND" });
    }
    if (!canWriteBookings(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Forbidden", code: "FORBIDDEN" });
    }
    // A viewing is shown to someone asking to book a room: never for a draft
    // nobody has sent, nor for a request that books nothing (workspace access,
    // an enquiry about Venviewer itself).
    if (enquiry.state === "draft" || !isBookingEnquiry(enquiry.eventType)) {
      return reply.status(422).send({
        error: "A viewing is booked for an enquiry asking to book a room.",
        code: "NOT_A_BOOKING_ENQUIRY",
      });
    }
    // The room the guest chose, or one someone chooses: never the room an
    // enquiry that named none is only filed under (roadmap N6).
    if (input.spaceId === undefined && !enquiry.roomChosen) {
      return reply.status(400).send({
        error: "Choose a room for this viewing. The guest did not choose one.",
        code: "ROOM_NOT_CHOSEN",
      });
    }
    const spaceId = input.spaceId ?? enquiry.spaceId;
    const [space] = await db
      .select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined || space.venueId !== enquiry.venueId) {
      return reply.status(400).send({ error: "The space does not belong to this venue", code: "SPACE_VENUE_MISMATCH" });
    }
    const ownerUserId = input.ownerUserId ?? request.user.id;
    if (!(await ownerWorksAtVenue(db, ownerUserId, enquiry.venueId))) {
      return reply.status(OWNER_VENUE_MISMATCH.status).send({ error: OWNER_VENUE_MISMATCH.error, code: OWNER_VENUE_MISMATCH.code });
    }

    try {
      const [created] = await db
        .insert(bookings)
        .values({
          // No event, ever: the column's default, and
          // bookings_viewing_has_no_event refuses any other.
          venueId: enquiry.venueId,
          spaceId,
          kind: VIEWING_BOOKING_KIND,
          status: "active",
          title: input.title ?? enquiry.name.slice(0, 200),
          eventType: null,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          rank: null,
          jointFlag: false,
          ownerUserId,
          notes: input.notes ?? null,
          createdBy: request.user.id,
          enquiryId: enquiry.id,
        })
        .returning();
      if (created === undefined) {
        return await reply.status(500).send({ error: "Failed to book the viewing", code: "BOOKING_CREATE_FAILED" });
      }
      publishDiaryChanged(request, created.venueId, "booking.created", created.id);
      return await reply.status(201).send({ data: serializeBooking(created) });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === PG_UNIQUE_VIOLATION) {
        const [booked] = await db.select().from(bookings).where(and(
          eq(bookings.enquiryId, enquiry.id),
          eq(bookings.spaceId, spaceId),
          eq(bookings.startsAt, new Date(input.startsAt)),
          eq(bookings.kind, VIEWING_BOOKING_KIND),
          eq(bookings.status, "active"),
          isNull(bookings.deletedAt),
        )).limit(1);
        if (booked !== undefined) return reply.status(200).send({ data: serializeBooking(booked) });
      }
      if (code === PG_CHECK_VIOLATION) {
        return reply.status(400).send({ error: "Booking violates a database integrity rule", code: "BOOKING_INTEGRITY_VIOLATION" });
      }
      throw error;
    }
  });
}

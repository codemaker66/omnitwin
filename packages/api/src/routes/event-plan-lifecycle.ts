import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, count, desc, eq, exists, getTableColumns, inArray, isNotNull, isNull, lte, not, notExists, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  AWAITING_CHANGES_PER_EVENT,
  AwaitingAcknowledgementQuerySchema,
  ChangeFeedListQuerySchema,
  ChangeFeedItemSchema,
  EventAwaitingAcknowledgementSchema,
  CreateHallkeeperAcknowledgementInputSchema,
  EventPlanAudienceRoleSchema,
  HallkeeperAcknowledgementSchema,
  NotificationListQuerySchema,
  NotificationSchema,
  type EventPlanAudienceRole,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  bookings,
  eventPhases,
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotificationReads,
  eventPlanNotifications,
  events,
  users,
} from "../db/schema.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { canAccessInternalEvent } from "../utils/query.js";
import {
  serializeAcknowledgement,
  serializeEventPlanChange,
  serializeFloorChange,
  serializeNotification,
} from "../services/event-plan-lifecycle.js";
import { pgErrorCode } from "../services/booking-mutations.js";
import { outerColumn } from "../utils/outer-column.js";

const PG_FOREIGN_KEY_VIOLATION = "23503";

const IdParam = z.object({ id: z.uuid() });
const EventIdParam = z.object({ eventId: z.uuid() });
const AcknowledgementListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();

type EventRow = typeof events.$inferSelect;
type NotificationRow = typeof eventPlanNotifications.$inferSelect;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function audienceRoleForRequest(request: FastifyRequest): EventPlanAudienceRole | null {
  const result = EventPlanAudienceRoleSchema.safeParse(request.user.role);
  return result.success ? result.data : null;
}

async function loadEvent(db: Database, eventId: string): Promise<EventRow | null> {
  const [eventRow] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  return eventRow ?? null;
}

async function requireEventAccess(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
): Promise<EventRow | null> {
  const eventRow = await loadEvent(db, eventId);
  if (eventRow === null) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canAccessInternalEvent(request.user, eventRow.venueId)) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return eventRow;
}

function canReadNotification(request: FastifyRequest, row: NotificationRow): boolean {
  if (row.recipientUserId !== null) return row.recipientUserId === request.user.id;
  const role = audienceRoleForRequest(request);
  if (role === null || role !== row.audienceRole) return false;
  if (isPlatformAdmin(request.user)) return true;
  return row.venueId !== null && request.user.venueId === row.venueId;
}

function notificationEventScope(
  db: Database,
  request: FastifyRequest,
): SQL {
  const personal = isNull(eventPlanNotifications.eventId);
  const platformAdmin = isPlatformAdmin(request.user);
  if (!platformAdmin && (request.user.venueId === null || !canAccessInternalEvent(request.user, request.user.venueId))) {
    return personal;
  }
  const conditions = [
    eq(events.id, eventPlanNotifications.eventId),
    eq(events.venueId, eventPlanNotifications.venueId),
    isNull(events.deletedAt),
  ];
  if (!platformAdmin && request.user.venueId !== null) conditions.push(eq(events.venueId, request.user.venueId));
  // Direct addressing is delivery provenance, not a surviving event grant.
  // Apply this in SQL before pagination and on the read-marker write path.
  return or(personal, exists(db.select({ id: events.id }).from(events).where(and(...conditions)))) ?? personal;
}

/**
 * A bell whose Diary move was replaced before anyone acknowledged it (folded
 * into a newer move, taken back, or ended in the past): what it announced no
 * longer holds. Bells nobody opened are taken away when that happens
 * (services/booking-move-feed.ts); one somebody opened stays, as the record
 * of their read, but only for those who opened it. Everyone else in the role
 * never sees it, and it is never counted unread: the newer move, if any,
 * rings its own bell.
 */
function supersededMoveBell(db: Database): SQL {
  return exists(db.select({ id: eventPlanChanges.id })
    .from(eventPlanChanges)
    .where(and(
      eq(eventPlanChanges.id, eventPlanNotifications.changeId),
      isNotNull(eventPlanChanges.moveChainId),
      eq(eventPlanChanges.requiresHallkeeperAcknowledgement, false),
    )));
}

export async function notificationRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const query = NotificationListQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const role = audienceRoleForRequest(request);
    const conditions: SQL[] = [eq(eventPlanNotifications.recipientUserId, request.user.id)];

    if (role !== null) {
      if (isPlatformAdmin(request.user)) {
        const roleCondition = and(
          isNull(eventPlanNotifications.recipientUserId),
          eq(eventPlanNotifications.audienceRole, role),
        );
        if (roleCondition !== undefined) conditions.push(roleCondition);
      } else if (request.user.venueId !== null) {
        const roleCondition = and(
          isNull(eventPlanNotifications.recipientUserId),
          eq(eventPlanNotifications.venueId, request.user.venueId),
          eq(eventPlanNotifications.audienceRole, role),
        );
        if (roleCondition !== undefined) conditions.push(roleCondition);
      }
    }

    const rows = await db
      .select({ notification: eventPlanNotifications, readAt: eventPlanNotificationReads.readAt })
      .from(eventPlanNotifications)
      .leftJoin(eventPlanNotificationReads, and(
        eq(eventPlanNotificationReads.notificationId, eventPlanNotifications.id),
        eq(eventPlanNotificationReads.userId, request.user.id),
      ))
      .where(and(
        or(...conditions),
        notificationEventScope(db, request),
        or(isNotNull(eventPlanNotificationReads.id), not(supersededMoveBell(db))),
        query.data.status === "unread" ? isNull(eventPlanNotificationReads.id)
          : query.data.status === "read" ? isNotNull(eventPlanNotificationReads.id) : undefined,
      ))
      .orderBy(desc(eventPlanNotifications.createdAt), desc(eventPlanNotifications.id))
      .limit(query.data.limit);

    return { data: z.array(NotificationSchema).parse(rows.map(row => serializeNotification(row.notification, row.readAt))) };
  });

  server.patch("/:id/read", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const [notification] = await db
      .select()
      .from(eventPlanNotifications)
      .where(and(eq(eventPlanNotifications.id, params.data.id), notificationEventScope(db, request)))
      .limit(1);

    if (notification === undefined) {
      return reply.status(404).send({ error: "Notification not found", code: "NOT_FOUND" });
    }
    if (!canReadNotification(request, notification)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const now = new Date();
    try {
      await db.insert(eventPlanNotificationReads).values({
        notificationId: notification.id,
        userId: request.user.id,
        readAt: now,
      }).onConflictDoUpdate({
        target: [eventPlanNotificationReads.notificationId, eventPlanNotificationReads.userId],
        set: { readAt: now },
      });
    } catch (error) {
      // Taken away while it was opened: a quick Undo of the move it announced
      // (services/booking-move-feed.ts). Gone, as if it had never rung.
      if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
        return reply.status(404).send({ error: "Notification not found", code: "NOT_FOUND" });
      }
      throw error;
    }

    return { data: serializeNotification(notification, now) };
  });

  // The number on the nav. A count rather than the length of a capped list,
  // so a busy day reads "23" instead of quietly stopping at the page size
  // (Ship Friday slice 10 — requests land here too).
  server.get("/unread-count", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const role = audienceRoleForRequest(request);
    const conditions: SQL[] = [eq(eventPlanNotifications.recipientUserId, request.user.id)];

    if (role !== null) {
      if (isPlatformAdmin(request.user)) {
        const roleCondition = and(
          isNull(eventPlanNotifications.recipientUserId),
          eq(eventPlanNotifications.audienceRole, role),
        );
        if (roleCondition !== undefined) conditions.push(roleCondition);
      } else if (request.user.venueId !== null) {
        const roleCondition = and(
          isNull(eventPlanNotifications.recipientUserId),
          eq(eventPlanNotifications.venueId, request.user.venueId),
          eq(eventPlanNotifications.audienceRole, role),
        );
        if (roleCondition !== undefined) conditions.push(roleCondition);
      }
    }

    const [row] = await db
      .select({ unread: count() })
      .from(eventPlanNotifications)
      .leftJoin(eventPlanNotificationReads, and(
        eq(eventPlanNotificationReads.notificationId, eventPlanNotifications.id),
        eq(eventPlanNotificationReads.userId, request.user.id),
      ))
      .where(and(
        or(...conditions),
        notificationEventScope(db, request),
        isNull(eventPlanNotificationReads.id),
        not(supersededMoveBell(db)),
      ));

    return { data: { unread: row?.unread ?? 0 } };
  });
}

// What the board's read joins each waiting change to: for a Diary move, its
// booking as it stands; for anything else, the phase it may name.
const movedBooking = alias(bookings, "moved_booking");
const changedPhase = alias(eventPhases, "changed_phase");
const BOARD_BOOKING = "board_booking";
const boardBooking = alias(bookings, BOARD_BOOKING);

interface BoardDay { readonly from: Date; readonly to: Date }

/** A place [startsAt, endsAt) on the board's day, as the calendar finds one. */
function onDay(startsAt: SQLWrapper, endsAt: SQLWrapper, day: BoardDay): SQL {
  return sql`(${startsAt} < ${day.to.toISOString()}::timestamptz and ${endsAt} > ${day.from.toISOString()}::timestamptz)`;
}

/** When a phase ends: its start and its minutes, as the calendar reckons it. */
const phaseEnds = sql`${changedPhase.startsAt} + make_interval(mins => ${changedPhase.durationMinutes})`;

/**
 * Whether a waiting change has no place of its own on the board, so the board
 * shows it on every slot of its event (FloorChangeSchema's eventWide): an
 * edit to the event itself; a Diary move of a booking still an enquiry, which
 * no board shows; a phase with no room or no time, which the calendar lists
 * nowhere, or one since removed; and, on the board's day, a phase the day's
 * bookings do not hold (no booking the board shows of its event in its room
 * that day). Any other source is placed: a Diary move by its booking, a phase
 * by its room and time.
 */
function changeHasNoPlace(day: BoardDay | null): SQL {
  const unheldOnDay = day === null ? sql`false` : sql`(${onDay(changedPhase.startsAt, phaseEnds, day)} and not exists (
    select 1 from ${bookings} as ${sql.identifier(BOARD_BOOKING)}
    where ${boardBooking.eventId} = ${outerColumn(eventPlanChanges.eventId)}
      and ${boardBooking.spaceId} = ${changedPhase.spaceId}
      and ${boardBooking.status} = 'active'
      and ${boardBooking.kind} <> 'prospect'
      and ${boardBooking.deletedAt} is null
      and ${onDay(boardBooking.startsAt, boardBooking.endsAt, day)}
  ))`;
  return sql`(case
    when ${eventPlanChanges.sourceId} = ${eventPlanChanges.eventId}::text then true
    when ${eventPlanChanges.moveChainId} is not null then coalesce(${movedBooking.kind} = 'prospect', false)
    when ${changedPhase.id} is null then true
    when ${changedPhase.spaceId} is null or ${changedPhase.startsAt} is null then true
    else ${unheldOnDay}
  end)`;
}

/**
 * Whether a waiting change is placed on the board's day: a Diary move where
 * the floor last knew its booking, where the move put it, or where the
 * booking stands now; a phase by its room's time that day.
 */
function changeIsPlacedOn(day: BoardDay): SQL {
  return sql`(case
    when ${eventPlanChanges.moveChainId} is not null then (
      ${onDay(eventPlanChanges.moveKnownStartsAt, eventPlanChanges.moveKnownEndsAt, day)}
      or ${onDay(eventPlanChanges.moveToStartsAt, eventPlanChanges.moveToEndsAt, day)}
      or (${movedBooking.deletedAt} is null and ${onDay(movedBooking.startsAt, movedBooking.endsAt, day)})
    )
    when ${changedPhase.startsAt} is not null then ${onDay(changedPhase.startsAt, phaseEnds, day)}
    else false
  end)`;
}

export async function eventPlanLifecycleRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  // The Day Board's one read of what waits for the floor (types:
  // EventAwaitingAcknowledgementSchema): for each event asked about that the
  // caller's venue holds, the changes to the plan itself (source kind
  // "event": the event, its phases, its bookings moved in the Diary) that need
  // a hallkeeper's acknowledgement and that nobody has acknowledged, newest
  // first, and who last acknowledged one of them there.
  // With the board's day (from, to), an event's changes are those placed on
  // that day and those with no place of their own, which the board shows on
  // every slot of the event (eventWide); another day's are that day's board's
  // to show. Then at most AWAITING_CHANGES_PER_EVENT of each event, so one busy
  // event never crowds another out, nor another day this one, and the read
  // says when an event had more (truncated).
  // Proposal traffic stays on the event-day board: nothing has changed on the
  // floor until the plan does.
  // The floor acknowledges as one, as the event-day board does: once anyone
  // has, the change is in hand. Events of other venues are left out, not
  // refused, so one board read never fails for a stale id.
  server.get("/awaiting-acknowledgement", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const query = AwaitingAcknowledgementQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const asked = [...new Set(query.data.eventIds)];
    const eventRows = await db.select({ id: events.id, venueId: events.venueId })
      .from(events)
      .where(and(inArray(events.id, asked), isNull(events.deletedAt)));
    const readable = eventRows.filter((row) => canAccessInternalEvent(request.user, row.venueId)).map((row) => row.id);
    if (readable.length === 0) return { data: [] };

    const day = query.data.from === undefined || query.data.to === undefined
      ? null
      : { from: new Date(query.data.from), to: new Date(query.data.to) };
    const ranked = db.select({
      ...getTableColumns(eventPlanChanges),
      eventWide: sql<boolean>`${changeHasNoPlace(day)}`.as("event_wide"),
      place: sql<number>`row_number() over (partition by ${eventPlanChanges.eventId} order by ${eventPlanChanges.createdAt} desc, ${eventPlanChanges.id} desc)`.as("place"),
      waitingOnEvent: sql<number>`(count(*) over (partition by ${eventPlanChanges.eventId}))::int`.as("waiting_on_event"),
    })
      .from(eventPlanChanges)
      // A source is named as text (its kind says what it is): matched as text.
      .leftJoin(movedBooking, and(isNotNull(eventPlanChanges.moveChainId), eq(sql`${movedBooking.id}::text`, eventPlanChanges.sourceId)))
      .leftJoin(changedPhase, and(isNull(eventPlanChanges.moveChainId), eq(sql`${changedPhase.id}::text`, eventPlanChanges.sourceId)))
      .where(and(
        inArray(eventPlanChanges.eventId, readable),
        eq(eventPlanChanges.sourceKind, "event"),
        eq(eventPlanChanges.requiresHallkeeperAcknowledgement, true),
        notExists(db.select({ id: eventPlanChangeAcknowledgements.id })
          .from(eventPlanChangeAcknowledgements)
          .where(eq(eventPlanChangeAcknowledgements.changeId, eventPlanChanges.id))),
        day === null ? undefined : or(changeHasNoPlace(day), changeIsPlacedOn(day)),
      ))
      .as("ranked");
    const pending = await db.select().from(ranked)
      .where(lte(ranked.place, AWAITING_CHANGES_PER_EVENT))
      .orderBy(desc(ranked.createdAt), desc(ranked.id));

    const lastAcknowledgements = await db.selectDistinctOn([eventPlanChangeAcknowledgements.eventId], {
      eventId: eventPlanChangeAcknowledgements.eventId,
      at: eventPlanChangeAcknowledgements.createdAt,
      userId: eventPlanChangeAcknowledgements.acknowledgedBy,
      name: users.name,
      displayName: users.displayName,
    })
      .from(eventPlanChangeAcknowledgements)
      .innerJoin(users, eq(users.id, eventPlanChangeAcknowledgements.acknowledgedBy))
      .innerJoin(eventPlanChanges, eq(eventPlanChanges.id, eventPlanChangeAcknowledgements.changeId))
      .where(and(inArray(eventPlanChangeAcknowledgements.eventId, readable), eq(eventPlanChanges.sourceKind, "event")))
      .orderBy(eventPlanChangeAcknowledgements.eventId, desc(eventPlanChangeAcknowledgements.createdAt));
    const lastByEvent = new Map(lastAcknowledgements.map((row) => [row.eventId, row]));

    return {
      data: z.array(EventAwaitingAcknowledgementSchema).parse(readable.map((eventId) => {
        const last = lastByEvent.get(eventId);
        const by = last === undefined ? "" : (last.displayName ?? "").trim() || last.name.trim();
        const changes = pending.filter((change) => change.eventId === eventId);
        return {
          eventId,
          changes: changes.map((change) => serializeFloorChange(change, change.eventWide)),
          truncated: (changes[0]?.waitingOnEvent ?? 0) > changes.length,
          lastAcknowledgement: last === undefined || by === "" ? null : { at: last.at.toISOString(), by: by.slice(0, 200), byUserId: last.userId },
        };
      })),
    };
  });

  server.get("/:eventId/change-feed", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = ChangeFeedListQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.eventId);
    if (eventRow === null) return;

    const changes = await db
      .select()
      .from(eventPlanChanges)
      .where(eq(eventPlanChanges.eventId, eventRow.id))
      .orderBy(desc(eventPlanChanges.createdAt))
      .limit(query.data.limit);

    return { data: z.array(ChangeFeedItemSchema).parse(changes.map(serializeEventPlanChange)) };
  });

  // Lane 6's event-day board reads acknowledgements from here instead of local
  // component state, so a reload or a second device sees what the room already
  // acknowledged. Same venue-tenancy gate as the POST; every row for the event,
  // newest first, each carrying who acknowledged it and when (createdAt).
  server.get("/:eventId/change-acknowledgements", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = AcknowledgementListQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.eventId);
    if (eventRow === null) return;

    const rows = await db
      .select()
      .from(eventPlanChangeAcknowledgements)
      .where(eq(eventPlanChangeAcknowledgements.eventId, eventRow.id))
      .orderBy(desc(eventPlanChangeAcknowledgements.createdAt))
      .limit(query.data.limit);

    return { data: z.array(HallkeeperAcknowledgementSchema).parse(rows.map(serializeAcknowledgement)) };
  });

  server.post("/:eventId/change-acknowledgements", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = CreateHallkeeperAcknowledgementInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);

    const eventRow = await requireEventAccess(db, request, reply, params.data.eventId);
    if (eventRow === null) return;

    const role = audienceRoleForRequest(request);
    if (role !== "hallkeeper" && role !== "staff" && role !== "admin") {
      return reply.status(403).send({ error: "Only hallkeepers, venue staff, or admins can acknowledge operational changes", code: "FORBIDDEN" });
    }

    const outcome = await db.transaction(async (tx) => {
      // Held until this commits. A Diary move folding this change in
      // (services/booking-move-feed.ts) holds it too, so one of the two lands
      // first and the other sees it: never acknowledged and replaced at once.
      const [change] = await tx
        .select()
        .from(eventPlanChanges)
        .where(and(
          eq(eventPlanChanges.id, body.data.changeId),
          eq(eventPlanChanges.eventId, eventRow.id),
        ))
        .for("update");
      if (change === undefined) return { kind: "missing" } as const;
      if (!change.requiresHallkeeperAcknowledgement) {
        if (change.moveChainId === null) return { kind: "not-required" } as const;
        // A Diary move replaced by a newer one (folded in, or taken back):
        // the floor reads the newer change instead, if one still waits.
        const [newer] = await tx
          .select({ id: eventPlanChanges.id })
          .from(eventPlanChanges)
          .where(and(
            eq(eventPlanChanges.venueId, change.venueId),
            eq(eventPlanChanges.sourceId, change.sourceId),
            eq(eventPlanChanges.moveChainId, change.moveChainId),
            eq(eventPlanChanges.requiresHallkeeperAcknowledgement, true),
            notExists(tx.select({ id: eventPlanChangeAcknowledgements.id })
              .from(eventPlanChangeAcknowledgements)
              .where(eq(eventPlanChangeAcknowledgements.changeId, eventPlanChanges.id))),
          ))
          .orderBy(desc(eventPlanChanges.createdAt))
          .limit(1);
        return { kind: "superseded", by: newer?.id ?? null } as const;
      }

      const [existing] = await tx
        .select()
        .from(eventPlanChangeAcknowledgements)
        .where(and(
          eq(eventPlanChangeAcknowledgements.changeId, change.id),
          eq(eventPlanChangeAcknowledgements.acknowledgedBy, request.user.id),
        ))
        .limit(1);
      if (existing !== undefined) return { kind: "existing", row: existing } as const;

      const [created] = await tx.insert(eventPlanChangeAcknowledgements).values({
        changeId: change.id,
        eventId: eventRow.id,
        acknowledgedBy: request.user.id,
        acknowledgedByRole: role,
        note: body.data.note ?? null,
      }).returning();
      return created === undefined ? { kind: "failed" } as const : { kind: "created", row: created } as const;
    });

    switch (outcome.kind) {
      case "missing":
        return reply.status(404).send({ error: "Change not found", code: "NOT_FOUND" });
      case "not-required":
        return reply.status(422).send({
          error: "This change does not require hallkeeper acknowledgement",
          code: "ACKNOWLEDGEMENT_NOT_REQUIRED",
        });
      case "superseded":
        return reply.status(409).send({
          error: "This change was replaced by a newer one",
          code: "CHANGE_SUPERSEDED",
          details: { supersededBy: outcome.by },
        });
      case "existing":
        return { data: HallkeeperAcknowledgementSchema.parse(serializeAcknowledgement(outcome.row)) };
      case "failed":
        return reply.status(500).send({ error: "Failed to acknowledge change", code: "ACKNOWLEDGEMENT_CREATE_FAILED" });
      case "created":
        return reply.status(201).send({ data: serializeAcknowledgement(outcome.row) });
    }
  });
}

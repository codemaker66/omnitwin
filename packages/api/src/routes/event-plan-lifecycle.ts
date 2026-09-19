import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, exists, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  ChangeFeedListQuerySchema,
  ChangeFeedItemSchema,
  CreateHallkeeperAcknowledgementInputSchema,
  EventPlanAudienceRoleSchema,
  HallkeeperAcknowledgementSchema,
  NotificationListQuerySchema,
  NotificationSchema,
  type EventPlanAudienceRole,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotificationReads,
  eventPlanNotifications,
  events,
} from "../db/schema.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { canAccessInternalEvent } from "../utils/query.js";
import {
  serializeAcknowledgement,
  serializeEventPlanChange,
  serializeNotification,
} from "../services/event-plan-lifecycle.js";

const IdParam = z.object({ id: z.string().uuid() });
const EventIdParam = z.object({ eventId: z.string().uuid() });
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
    await db.insert(eventPlanNotificationReads).values({
      notificationId: notification.id,
      userId: request.user.id,
      readAt: now,
    }).onConflictDoUpdate({
      target: [eventPlanNotificationReads.notificationId, eventPlanNotificationReads.userId],
      set: { readAt: now },
    });

    return { data: serializeNotification(notification, now) };
  });
}

export async function eventPlanLifecycleRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

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

    const [change] = await db
      .select()
      .from(eventPlanChanges)
      .where(and(
        eq(eventPlanChanges.id, body.data.changeId),
        eq(eventPlanChanges.eventId, eventRow.id),
      ))
      .limit(1);
    if (change === undefined) {
      return reply.status(404).send({ error: "Change not found", code: "NOT_FOUND" });
    }
    if (!change.requiresHallkeeperAcknowledgement) {
      return reply.status(422).send({
        error: "This change does not require hallkeeper acknowledgement",
        code: "ACKNOWLEDGEMENT_NOT_REQUIRED",
      });
    }

    const [existing] = await db
      .select()
      .from(eventPlanChangeAcknowledgements)
      .where(and(
        eq(eventPlanChangeAcknowledgements.changeId, change.id),
        eq(eventPlanChangeAcknowledgements.acknowledgedBy, request.user.id),
      ))
      .limit(1);

    if (existing !== undefined) {
      return { data: HallkeeperAcknowledgementSchema.parse(serializeAcknowledgement(existing)) };
    }

    const [acknowledgement] = await db.insert(eventPlanChangeAcknowledgements).values({
      changeId: change.id,
      eventId: eventRow.id,
      acknowledgedBy: request.user.id,
      acknowledgedByRole: role,
      note: body.data.note ?? null,
    }).returning();

    if (acknowledgement === undefined) {
      return reply.status(500).send({ error: "Failed to acknowledge change", code: "ACKNOWLEDGEMENT_CREATE_FAILED" });
    }

    return reply.status(201).send({ data: serializeAcknowledgement(acknowledgement) });
  });
}

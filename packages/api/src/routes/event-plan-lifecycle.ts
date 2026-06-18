import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
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
  type Notification,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotificationReads,
  eventPlanNotifications,
  events,
} from "../db/schema.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";
import {
  serializeAcknowledgement,
  serializeEventPlanChange,
  serializeNotification,
} from "../services/event-plan-lifecycle.js";

const IdParam = z.object({ id: z.string().uuid() });
const EventIdParam = z.object({ eventId: z.string().uuid() });

type EventRow = typeof events.$inferSelect;
type NotificationRow = typeof eventPlanNotifications.$inferSelect;
type NotificationReadRow = typeof eventPlanNotificationReads.$inferSelect;

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
  if (!canAccessResource(request.user, eventRow.createdBy, eventRow.venueId)) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return eventRow;
}

function canReadNotification(request: FastifyRequest, row: NotificationRow): boolean {
  if (row.recipientUserId !== null) return row.recipientUserId === request.user.id;
  const role = audienceRoleForRequest(request);
  if (role === null || role !== row.audienceRole) return false;
  if (request.user.role === "admin") return true;
  return row.venueId !== null && request.user.venueId === row.venueId;
}

function readMapForRows(rows: readonly NotificationReadRow[]): ReadonlyMap<string, Date> {
  const byNotificationId = new Map<string, Date>();
  for (const row of rows) {
    byNotificationId.set(row.notificationId, row.readAt);
  }
  return byNotificationId;
}

async function readRowsForNotifications(
  db: Database,
  userId: string,
  rows: readonly NotificationRow[],
): Promise<ReadonlyMap<string, Date>> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return new Map<string, Date>();
  const readRows = await db
    .select()
    .from(eventPlanNotificationReads)
    .where(and(
      eq(eventPlanNotificationReads.userId, userId),
      inArray(eventPlanNotificationReads.notificationId, ids),
    ));
  return readMapForRows(readRows);
}

function filterNotifications(
  notifications: readonly Notification[],
  status: "all" | "unread" | "read",
): readonly Notification[] {
  if (status === "all") return notifications;
  if (status === "read") return notifications.filter((notification) => notification.readAt !== null);
  return notifications.filter((notification) => notification.readAt === null);
}

export async function notificationRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = NotificationListQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const role = audienceRoleForRequest(request);
    const conditions: SQL[] = [eq(eventPlanNotifications.recipientUserId, request.user.id)];

    if (role !== null) {
      if (request.user.role === "admin") {
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
      .select()
      .from(eventPlanNotifications)
      .where(or(...conditions))
      .orderBy(desc(eventPlanNotifications.createdAt))
      .limit(Math.min(query.data.limit * 3, 100));

    const readByNotificationId = await readRowsForNotifications(db, request.user.id, rows);
    const notifications = rows.map((row) => serializeNotification(row, readByNotificationId.get(row.id) ?? null));
    const filtered = filterNotifications(notifications, query.data.status).slice(0, query.data.limit);

    return { data: z.array(NotificationSchema).parse(filtered) };
  });

  server.patch("/:id/read", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);

    const [notification] = await db
      .select()
      .from(eventPlanNotifications)
      .where(eq(eventPlanNotifications.id, params.data.id))
      .limit(1);

    if (notification === undefined) {
      return reply.status(404).send({ error: "Notification not found", code: "NOT_FOUND" });
    }
    if (!canReadNotification(request, notification)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const now = new Date();
    const [existing] = await db
      .select()
      .from(eventPlanNotificationReads)
      .where(and(
        eq(eventPlanNotificationReads.notificationId, notification.id),
        eq(eventPlanNotificationReads.userId, request.user.id),
      ))
      .limit(1);

    if (existing === undefined) {
      await db.insert(eventPlanNotificationReads).values({
        notificationId: notification.id,
        userId: request.user.id,
        readAt: now,
      });
    } else {
      await db.update(eventPlanNotificationReads)
        .set({ readAt: now })
        .where(eq(eventPlanNotificationReads.id, existing.id));
    }

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

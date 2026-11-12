import {
  ChangeFeedItemSchema,
  FloorChangeSchema,
  HallkeeperAcknowledgementSchema,
  NotificationSchema,
  RecordEventPlanChangeInputSchema,
  type ChangeFeedItem,
  type EventPlanAudienceRole,
  type EventPlanNotificationSeverity,
  type EventPlanRiskLevel,
  type FloorChange,
  type HallkeeperAcknowledgement,
  type Notification,
  type RecordEventPlanChangeInput,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotifications,
} from "../db/schema.js";

type ChangeRow = typeof eventPlanChanges.$inferSelect;
type NotificationRow = typeof eventPlanNotifications.$inferSelect;
type AcknowledgementRow = typeof eventPlanChangeAcknowledgements.$inferSelect;
type ChangeConnection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

function toIso(value: Date): string {
  return value.toISOString();
}
function notificationSeverityForRisk(riskLevel: EventPlanRiskLevel): EventPlanNotificationSeverity {
  switch (riskLevel) {
    case "blocker": return "urgent";
    case "attention": return "attention";
    case "info": return "info";
  }
}

function uniqueRoles(roles: readonly EventPlanAudienceRole[]): EventPlanAudienceRole[] {
  return [...new Set(roles)];
}

export function serializeEventPlanChange(row: ChangeRow): ChangeFeedItem {
  return ChangeFeedItemSchema.parse({
    id: row.id,
    eventId: row.eventId,
    venueId: row.venueId,
    configurationId: row.configurationId,
    proposalId: row.proposalId,
    handoffPackId: row.handoffPackId,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    actorLabel: row.actorLabel,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    title: row.title,
    summary: row.summary,
    beforeSummary: row.beforeSummary,
    afterSummary: row.afterSummary,
    affectedSurfaces: row.affectedSurfaces,
    audienceRoles: row.audienceRoles,
    riskLevel: row.riskLevel,
    requiresHallkeeperAcknowledgement: row.requiresHallkeeperAcknowledgement,
    createdAt: toIso(row.createdAt),
  });
}

/** A change as the floor reads it: for a Diary move, also where it put the
 *  booking (the place is whole or absent, as the table's CHECK keeps it). */
export function serializeFloorChange(row: ChangeRow): FloorChange {
  const movedTo = row.moveToSpaceId !== null && row.moveToStartsAt !== null && row.moveToEndsAt !== null
    ? { spaceId: row.moveToSpaceId, startsAt: toIso(row.moveToStartsAt), endsAt: toIso(row.moveToEndsAt) }
    : null;
  return FloorChangeSchema.parse({ ...serializeEventPlanChange(row), movedTo });
}

export function serializeNotification(row: NotificationRow, readAt: Date | null): Notification {
  return NotificationSchema.parse({
    id: row.id,
    changeId: row.changeId,
    eventId: row.eventId,
    venueId: row.venueId,
    audienceRole: row.audienceRole,
    recipientUserId: row.recipientUserId,
    title: row.title,
    body: row.body,
    severity: row.severity,
    actionPath: row.actionPath,
    createdAt: toIso(row.createdAt),
    readAt: readAt === null ? null : toIso(readAt),
  });
}

export function serializeAcknowledgement(row: AcknowledgementRow): HallkeeperAcknowledgement {
  return HallkeeperAcknowledgementSchema.parse({
    id: row.id,
    changeId: row.changeId,
    eventId: row.eventId,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedByRole: row.acknowledgedByRole,
    note: row.note,
    createdAt: toIso(row.createdAt),
  });
}

export async function recordEventPlanChange(
  db: ChangeConnection,
  input: RecordEventPlanChangeInput,
): Promise<ChangeFeedItem> {
  const parsed = RecordEventPlanChangeInputSchema.parse(input);
  const audienceRoles = uniqueRoles(parsed.audienceRoles);

  return db.transaction(async (tx) => {
    const [change] = await tx.insert(eventPlanChanges).values({
      eventId: parsed.eventId,
      venueId: parsed.venueId,
      configurationId: parsed.configurationId ?? null,
      proposalId: parsed.proposalId ?? null,
      handoffPackId: parsed.handoffPackId ?? null,
      actorUserId: parsed.actorUserId ?? null,
      actorRole: parsed.actorRole,
      actorLabel: parsed.actorLabel,
      sourceKind: parsed.sourceKind,
      sourceId: parsed.sourceId,
      title: parsed.title,
      summary: parsed.summary,
      beforeSummary: parsed.beforeSummary ?? null,
      afterSummary: parsed.afterSummary ?? null,
      affectedSurfaces: [...parsed.affectedSurfaces],
      audienceRoles,
      riskLevel: parsed.riskLevel,
      requiresHallkeeperAcknowledgement: parsed.requiresHallkeeperAcknowledgement,
      ...(parsed.bookingMove === undefined ? {} : {
        moveKnownSpaceId: parsed.bookingMove.known.spaceId,
        moveKnownStartsAt: parsed.bookingMove.known.startsAt,
        moveKnownEndsAt: parsed.bookingMove.known.endsAt,
        moveToSpaceId: parsed.bookingMove.to.spaceId,
        moveToStartsAt: parsed.bookingMove.to.startsAt,
        moveToEndsAt: parsed.bookingMove.to.endsAt,
        moveChainId: parsed.bookingMove.chainId,
      }),
    }).returning();

    if (change === undefined) {
      throw new Error("event plan change insert returned no row");
    }

    const severity = notificationSeverityForRisk(parsed.riskLevel);
    await tx.insert(eventPlanNotifications).values(audienceRoles.map((audienceRole) => ({
      changeId: change.id,
      eventId: parsed.eventId,
      venueId: parsed.venueId,
      audienceRole,
      recipientUserId: null,
      title: parsed.title,
      body: parsed.summary,
      severity,
      actionPath: parsed.actionPath ?? null,
    })));

    return serializeEventPlanChange(change);
  });
}

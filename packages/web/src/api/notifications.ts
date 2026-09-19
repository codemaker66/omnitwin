import { z } from "zod";
import {
  ChangeFeedItemSchema,
  CreateHallkeeperAcknowledgementInputSchema,
  HallkeeperAcknowledgementSchema,
  NotificationSchema,
  type ChangeFeedItem,
  type CreateHallkeeperAcknowledgementInput,
  type HallkeeperAcknowledgement,
  type Notification,
} from "@omnitwin/types";
import { api } from "./client.js";

const NotificationListSchema = z.array(NotificationSchema);
const ChangeFeedListSchema = z.array(ChangeFeedItemSchema);
const HallkeeperAcknowledgementListSchema = z.array(HallkeeperAcknowledgementSchema);

export type NotificationStatusFilter = "all" | "unread" | "read";

export async function listNotifications(
  status: NotificationStatusFilter = "unread",
  limit = 20,
): Promise<Notification[]> {
  const params = new URLSearchParams({
    status,
    limit: String(limit),
  });
  return api.get(`/notifications?${params.toString()}`, NotificationListSchema);
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  return api.patch(`/notifications/${encodeURIComponent(notificationId)}/read`, {}, NotificationSchema);
}

export async function getEventChangeFeed(eventId: string, limit = 50): Promise<ChangeFeedItem[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return api.get(`/events/${encodeURIComponent(eventId)}/change-feed?${params.toString()}`, ChangeFeedListSchema);
}

export async function acknowledgeEventPlanChange(
  eventId: string,
  input: CreateHallkeeperAcknowledgementInput,
): Promise<HallkeeperAcknowledgement> {
  const payload = CreateHallkeeperAcknowledgementInputSchema.parse(input);
  return api.post(
    `/events/${encodeURIComponent(eventId)}/change-acknowledgements`,
    payload,
    false,
    HallkeeperAcknowledgementSchema,
  );
}

/**
 * Persisted change acknowledgements for an event, newest first. The event-day
 * board reads these instead of remembering acknowledgements in component state,
 * so a reload or a second device shows what the room already acknowledged.
 * `createdAt` is the moment the acknowledgement was recorded.
 */
export async function listEventChangeAcknowledgements(
  eventId: string,
  limit = 200,
): Promise<HallkeeperAcknowledgement[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return api.get(
    `/events/${encodeURIComponent(eventId)}/change-acknowledgements?${params.toString()}`,
    HallkeeperAcknowledgementListSchema,
  );
}

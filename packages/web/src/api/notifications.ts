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

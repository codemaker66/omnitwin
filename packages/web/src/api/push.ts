import { z } from "zod";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Push subscriptions (goal 19 S7): the public key to subscribe with, and the
// device's subscription saved against the signed-in person at one venue.
// ---------------------------------------------------------------------------

export type PushDeviceKind = "wall" | "phone" | "desk";

const VapidKeySchema = z.object({ publicKey: z.string().min(1) }).nullable();
const SavedSubscriptionSchema = z.object({ id: z.string(), deviceKind: z.enum(["wall", "phone", "desk"]), createdAt: z.string() });
const MySubscriptionsSchema = z.array(z.object({
  id: z.string(),
  endpoint: z.string(),
  deviceKind: z.enum(["wall", "phone", "desk"]),
  venueId: z.string(),
  createdAt: z.string(),
}));

export interface PushSubscriptionInput {
  readonly venueId: string;
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly deviceKind: PushDeviceKind;
  readonly userAgent?: string;
}

/** Null while push is off on the server. */
export async function getVapidPublicKey(): Promise<string | null> {
  const result = await api.get("/push/vapid-public-key", VapidKeySchema);
  return result?.publicKey ?? null;
}

export async function savePushSubscription(input: PushSubscriptionInput): Promise<z.infer<typeof SavedSubscriptionSchema>> {
  return api.post("/push/subscriptions", input, false, SavedSubscriptionSchema);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await api.delete(`/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`);
}

export async function listMyPushSubscriptions(): Promise<z.infer<typeof MySubscriptionsSchema>> {
  return api.get("/push/subscriptions/mine", MySubscriptionsSchema);
}

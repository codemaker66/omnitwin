import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
// web-push is CommonJS. The API runs as native Node ESM from tsc output,
// where a namespace import of a CommonJS module carries only `default`:
// `import * as webpush` left `sendNotification` undefined in production
// while tsx and the tests (which inject `send`) never noticed.
import webpush from "web-push";
import { pushSends, pushSubscriptions } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Web push (goal 19 S7, D8): three events only, to the devices that asked.
//
// Every attempt is a fact in push_sends, keyed so a second sweep or a replay
// never sends the same word twice. A push service answering 404 or 410 says
// the subscription is gone: it is disabled, never retried. Any other failure
// is recorded and left; the next event tries that device again. Nothing in
// here throws to its caller: a push never fails the request or the message
// that caused it. Without the three VAPID variables push is off, the way
// email is off without a Resend key.
// ---------------------------------------------------------------------------

export type PushEvent = "request.landed" | "request.escalated" | "request.replied";

export interface PushPayload {
  readonly event: PushEvent;
  readonly title: string;
  readonly body: string;
  /** Where a tap opens, as a path on the web app. */
  readonly url: string;
  /** Replaces an earlier notice about the same thing on the device. */
  readonly tag: string;
}

export type PushDeviceKind = "wall" | "phone" | "desk";

export interface PushSendInput extends PushPayload {
  readonly venueId: string;
  readonly userIds: readonly string[];
  /** Devices never told this: a corridor wall is not shown a reply's words (D11). */
  readonly skipDeviceKinds?: readonly PushDeviceKind[];
  /** One send per device per event: the key is this plus the subscription. */
  readonly idempotencyKeyBase: string;
}

export interface PushSubscriptionKeys {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushSendOptions {
  readonly ttlSeconds: number;
  readonly urgency: "normal" | "high";
}

/** The push service call, injected in tests. Resolves on 2xx; rejects with
 *  an error carrying `statusCode` otherwise, as web-push does. */
export type PushSender = (subscription: PushSubscriptionKeys, payload: string, options: PushSendOptions) => Promise<{ readonly statusCode: number }>;

export interface PushSendRecord {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly status: "sent" | "failed" | "gone";
  readonly statusCode: number | null;
}

export interface PushDeps {
  readonly send?: PushSender;
  readonly logger?: FastifyBaseLogger;
  readonly now?: Date;
}

interface VapidConfig {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

function readVapid(): VapidConfig | null {
  const subject = process.env["VAPID_SUBJECT"] ?? "";
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? "";
  const privateKey = process.env["VAPID_PRIVATE_KEY"] ?? "";
  return subject !== "" && publicKey !== "" && privateKey !== "" ? { subject, publicKey, privateKey } : null;
}

export function isPushConfigured(): boolean {
  return readVapid() !== null;
}

/** The public half, for the browser's subscribe call; null while push is off. */
export function vapidPublicKey(): string | null {
  return readVapid()?.publicKey ?? null;
}

const defaultSender: PushSender = async (subscription, payload, options) => {
  const vapid = readVapid();
  if (vapid === null) throw new Error("push is not configured");
  const result = await webpush.sendNotification(subscription, payload, {
    TTL: options.ttlSeconds,
    urgency: options.urgency,
    vapidDetails: vapid,
  });
  return { statusCode: result.statusCode };
};

function statusCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = (error as { readonly statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

const GONE = new Set([404, 410]);
const TTL_SECONDS = 300;

export async function sendPush(db: Database, input: PushSendInput, deps: PushDeps = {}): Promise<readonly PushSendRecord[]> {
  if (deps.send === undefined && !isPushConfigured()) return [];
  if (input.userIds.length === 0) return [];
  const send = deps.send ?? defaultSender;
  const now = deps.now ?? new Date();

  const subscribed = await db
    .select()
    .from(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.venueId, input.venueId),
      inArray(pushSubscriptions.userId, [...input.userIds]),
      isNull(pushSubscriptions.disabledAt),
    ))
    .limit(200);
  const skip = input.skipDeviceKinds ?? [];
  const devices = subscribed.filter((device) => !skip.some((kind) => kind === device.deviceKind));

  const payload = JSON.stringify({ event: input.event, title: input.title, body: input.body, url: input.url, tag: input.tag });
  const records: PushSendRecord[] = [];
  for (const device of devices) {
    // Claim the send; a key already there means this device was told.
    const claimed = await db
      .insert(pushSends)
      .values({ subscriptionId: device.id, event: input.event, idempotencyKey: `${input.idempotencyKeyBase}:${device.id}`, status: "pending", createdAt: now })
      .onConflictDoNothing({ target: pushSends.idempotencyKey })
      .returning({ id: pushSends.id });
    const row = claimed[0];
    if (row === undefined) continue;

    try {
      const result = await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        { ttlSeconds: TTL_SECONDS, urgency: input.event === "request.escalated" ? "high" : "normal" },
      );
      await db.update(pushSends).set({ status: "sent", statusCode: result.statusCode, sentAt: now }).where(eq(pushSends.id, row.id));
      await db.update(pushSubscriptions).set({ lastUsedAt: now }).where(eq(pushSubscriptions.id, device.id));
      records.push({ subscriptionId: device.id, userId: device.userId, status: "sent", statusCode: result.statusCode });
    } catch (error: unknown) {
      const statusCode = statusCodeOf(error);
      const gone = statusCode !== null && GONE.has(statusCode);
      const message = error instanceof Error ? error.message : String(error);
      await db.update(pushSends).set({ status: gone ? "gone" : "failed", statusCode, lastError: message.slice(0, 500) }).where(eq(pushSends.id, row.id));
      if (gone) {
        await db.update(pushSubscriptions).set({ disabledAt: now }).where(eq(pushSubscriptions.id, device.id));
      }
      deps.logger?.warn({ event: "push.failed", subscriptionId: device.id, statusCode, gone }, "push.failed");
      records.push({ subscriptionId: device.id, userId: device.userId, status: gone ? "gone" : "failed", statusCode });
    }
  }
  return records;
}

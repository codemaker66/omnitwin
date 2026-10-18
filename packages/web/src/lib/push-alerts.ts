import { getVapidPublicKey, removePushSubscription, savePushSubscription, type PushDeviceKind } from "../api/push.js";

// ---------------------------------------------------------------------------
// Alerts on this device (goal 19 S7, D8). One subscription per browser, saved
// against the signed-in person at their venue, for three events only: a
// request landed for you, a request escalated to you, a reply to your
// request. The browser owns the permission; the server owns the key.
//
// States, in the words the switch shows:
//   unsupported  no service worker or push here (an iPhone before the app is
//                installed from Share → Add to Home Screen)
//   off-server   the server has no VAPID key yet
//   denied       the person blocked notifications for this site
//   off          nothing subscribed on this device
//   on           this device is subscribed
// ---------------------------------------------------------------------------

export type PushAlertsState = "unsupported" | "off-server" | "denied" | "off" | "on";

export const PUSH_WORKER_PATH = "/sw.js";

/** What this code needs of a subscription: the browser's own type fits. */
export type PushSubscriptionLike = Pick<PushSubscription, "endpoint" | "toJSON" | "unsubscribe">;

export interface PushRegistrationLike {
  readonly pushManager: {
    getSubscription(): Promise<PushSubscriptionLike | null>;
    subscribe(options: PushSubscriptionOptionsInit): Promise<PushSubscriptionLike>;
  };
}

/** The browser's push surface, narrowed so tests can stand one in; the real
 *  `navigator.serviceWorker` fits it as it is. */
export interface PushBrowser {
  readonly serviceWorker: { register(path: string): Promise<unknown>; readonly ready: Promise<PushRegistrationLike> } | undefined;
  readonly pushSupported: boolean;
  readonly permission: () => NotificationPermission;
  readonly requestPermission: () => Promise<NotificationPermission>;
  readonly userAgent: string;
}

export function browserPush(): PushBrowser {
  const hasWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const hasPush = typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
  return {
    serviceWorker: hasWorker ? navigator.serviceWorker : undefined,
    pushSupported: hasWorker && hasPush,
    permission: () => (typeof Notification === "undefined" ? "denied" : Notification.permission),
    requestPermission: () => (typeof Notification === "undefined" ? Promise.resolve("denied" as const) : Notification.requestPermission()),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
}

/** Registers the worker once the page is up. Harmless where unsupported. */
export function registerPushWorker(browser: PushBrowser = browserPush()): void {
  if (!browser.pushSupported || browser.serviceWorker === undefined) return;
  void browser.serviceWorker.register(PUSH_WORKER_PATH).catch(() => undefined);
}

function keyBytes(base64Url: string): Uint8Array {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function currentSubscription(browser: PushBrowser): Promise<PushSubscriptionLike | null> {
  if (!browser.pushSupported || browser.serviceWorker === undefined) return null;
  const registration = await browser.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** What this device says right now, without asking anything of the person. */
export async function readPushAlertsState(browser: PushBrowser = browserPush()): Promise<PushAlertsState> {
  if (!browser.pushSupported) return "unsupported";
  if (browser.permission() === "denied") return "denied";
  const subscription = await currentSubscription(browser);
  return subscription === null ? "off" : "on";
}

/** The press that turns alerts on: asks the browser, subscribes with the
 *  server's key and saves the subscription. Each state is one plain word. */
export async function subscribeThisDevice(
  venueId: string,
  deviceKind: PushDeviceKind,
  browser: PushBrowser = browserPush(),
): Promise<PushAlertsState> {
  if (!browser.pushSupported || browser.serviceWorker === undefined) return "unsupported";
  const publicKey = await getVapidPublicKey();
  if (publicKey === null) return "off-server";
  const permission = browser.permission() === "granted" ? "granted" : await browser.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await browser.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (json.endpoint === undefined || p256dh === undefined || auth === undefined) {
    throw new Error("The browser gave no usable subscription");
  }
  await savePushSubscription({ venueId, endpoint: json.endpoint, keys: { p256dh, auth }, deviceKind, userAgent: browser.userAgent.slice(0, 300) });
  return "on";
}

export async function unsubscribeThisDevice(browser: PushBrowser = browserPush()): Promise<PushAlertsState> {
  const subscription = await currentSubscription(browser);
  if (subscription === null) return browser.pushSupported ? "off" : "unsupported";
  // The server first, so a device that cannot unsubscribe locally is at
  // least never sent to again.
  await removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
  return "off";
}

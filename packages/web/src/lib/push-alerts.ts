import { getVapidPublicKey, listMyPushSubscriptions, removePushSubscription, savePushSubscription, type PushDeviceKind } from "../api/push.js";
import { browserPush, type PushBrowser, type PushSubscriptionLike } from "./push-worker.js";

// The browser surface and the worker registration live in push-worker.ts (no
// API import, so the entry script may load it); re-exported here for callers.
export { PUSH_WORKER_PATH, browserPush, registerPushWorker, type PushBrowser, type PushRegistrationLike, type PushSubscriptionLike } from "./push-worker.js";

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
//   off          nothing subscribed on this device, or the browser's
//                subscription is saved against somebody else (a shared PC)
//   on           this device is subscribed, for the person signed in
//
// Signing out forgets the device on both sides, so the next person at the
// same screen hears nothing meant for the last until they switch it on.
// ---------------------------------------------------------------------------

export type PushAlertsState = "unsupported" | "off-server" | "denied" | "off" | "on";

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

/** What this device says right now, without asking anything of the person.
 *  "On" means the browser's subscription is saved against the person signed
 *  in: a subscription somebody else left on this screen reads as off. When
 *  the server cannot be asked, the browser's word stands. */
export async function readPushAlertsState(browser: PushBrowser = browserPush()): Promise<PushAlertsState> {
  if (!browser.pushSupported) return "unsupported";
  if (browser.permission() === "denied") return "denied";
  const subscription = await currentSubscription(browser);
  if (subscription === null) return "off";
  try {
    const mine = await listMyPushSubscriptions();
    return mine.some((row) => row.endpoint === subscription.endpoint) ? "on" : "off";
  } catch {
    return "on";
  }
}

const SIGN_OUT_FORGET_MS = 1500;

/** Runs the sign-out once this device's alerts are forgotten; where push is
 *  unsupported there is nothing to forget and the sign-out runs at once. */
export function forgetPushAlertsThen(then: () => void, browser: PushBrowser = browserPush()): void {
  if (!browser.pushSupported || browser.serviceWorker === undefined) {
    then();
    return;
  }
  void forgetPushAlertsOnSignOut(browser).finally(then);
}

/** On sign-out: the server forgets this device and the browser drops the
 *  subscription, each on its own; neither failing, nor taking long, holds
 *  the sign-out up. */
export async function forgetPushAlertsOnSignOut(browser: PushBrowser = browserPush()): Promise<void> {
  let subscription: PushSubscriptionLike | null = null;
  try {
    subscription = await currentSubscription(browser);
  } catch {
    return;
  }
  if (subscription === null) return;
  const forget = Promise.allSettled([
    removePushSubscription(subscription.endpoint),
    subscription.unsubscribe(),
  ]).then(() => undefined);
  const deadline = new Promise<void>((resolve) => { setTimeout(resolve, SIGN_OUT_FORGET_MS); });
  await Promise.race([forget, deadline]);
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

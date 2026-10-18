// ---------------------------------------------------------------------------
// The browser's push surface and the worker registration (goal 19 S7). This
// module touches no API code on purpose: the entry script registers the
// worker at start-up, and the entry may reach only the token bridge of the
// API layer by static import (bundle-splitting test). Everything that talks
// to the server lives in push-alerts.ts and loads with the pages that use it.
// ---------------------------------------------------------------------------

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

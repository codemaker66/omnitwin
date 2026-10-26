// ---------------------------------------------------------------------------
// Whether this browser has a network, from `navigator.onLine` and the
// window's `online`/`offline` events: one source for the editor store (which
// tells offline from failed) and every surface that shows it.
//
// `false` is reliable (no network at all); `true` only means "maybe": a
// captive portal or a dead server still fail as NETWORK_ERROR while online.
// The value follows the events once anything listens, as the phone top bar's
// own hook did; with no listener it is read from the browser each time.
// ---------------------------------------------------------------------------

type OnlineListener = (online: boolean) => void;

const listeners = new Set<OnlineListener>();
let current = true;

/** The browser's own answer now, ahead of an online/offline event still
 *  queued (a fetch can fail before its offline event is dispatched). */
export function browserSaysOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function update(online: boolean): void {
  if (online === current) return;
  current = online;
  for (const listener of [...listeners]) listener(online);
}

const onOnline = (): void => { update(true); };
const onOffline = (): void => { update(false); };

export function readOnlineStatus(): boolean {
  return listeners.size > 0 ? current : browserSaysOnline();
}

/** Hear every change; returns the unsubscribe. */
export function subscribeOnlineStatus(listener: OnlineListener): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (listeners.size === 0) {
    current = browserSaysOnline();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

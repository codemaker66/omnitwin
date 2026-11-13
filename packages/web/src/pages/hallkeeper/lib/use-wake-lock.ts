import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// The wall never sleeps (goal 19 S8 item 14). While the wall register is on
// screen the board holds a Screen Wake Lock; the system drops it when the
// tab is hidden, so it is asked for again when the tab is shown. A browser
// without the API, or one that refuses (battery saver, page not visible),
// is left alone: the board runs the same, the tablet's own settings decide.
// Phones and desks keep the system's rule and never hold the lock.
// ---------------------------------------------------------------------------

export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  /** The real sentinel says when the system took the lock back. */
  addEventListener?(type: "release", listener: () => void): void;
}

export interface WakeLockSurface {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** The browser's wake lock where it has one; the real `navigator.wakeLock` fits as it is. */
export function defaultWakeLockSurface(): WakeLockSurface | null {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return null;
  return navigator.wakeLock;
}

export function useWakeLock(active: boolean, surface: WakeLockSurface | null = defaultWakeLockSurface()): void {
  const held = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active || surface === null) return;
    let disposed = false;

    const ask = (): void => {
      if (disposed || (held.current !== null && !held.current.released)) return;
      surface.request("screen").then((sentinel) => {
        if (disposed) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        held.current = sentinel;
        // The system may take it back while the page stays visible (battery
        // saver, a dimmed screen): ask again then, not only on the next show.
        sentinel.addEventListener?.("release", () => {
          if (!disposed && document.visibilityState === "visible") ask();
        });
      }).catch(() => undefined);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") ask();
    };

    ask();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const sentinel = held.current;
      held.current = null;
      if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [active, surface]);
}

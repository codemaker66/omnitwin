import { useCallback, useEffect, useState, type RefObject } from "react";

// -----------------------------------------------------------------------------
// useFullscreen — drive the Fullscreen API for one element (the twin viewer),
// exposing whether it is supported at all (iOS Safari does not do element
// fullscreen for non-video — the button is hidden there rather than shipped as
// a no-op), whether we are currently fullscreen, and a toggle. State is read
// from the browser's own `fullscreenchange` event, so it stays correct when the
// visitor leaves fullscreen by Esc rather than the button.
// -----------------------------------------------------------------------------

export interface FullscreenState {
  /** Whether element fullscreen is available in this browser at all. */
  readonly supported: boolean;
  /** True while the target element owns the fullscreen surface. */
  readonly isFullscreen: boolean;
  /** Enter fullscreen on the target, or exit if already fullscreen. */
  readonly toggle: () => void;
}

/**
 * Is anything currently fullscreen? A read-only subscription for surfaces that
 * must go quiet in immersive mode but own no toggle of their own.
 *
 * The viewer needs this because hiding chrome is only half the job: the nav
 * constellation and the gold rings are drawn INSIDE the canvas by three.js, so
 * no stylesheet can reach them, and a rule that clears the DOM while leaving
 * gold lines across the parquet has not delivered the raw photograph it
 * promised. The browser remains the single source of truth — this listens to
 * `fullscreenchange` exactly as useFullscreen does, so Escape, the button and
 * the browser's own affordances all agree without any shared React state.
 */
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    onChange(); // a component mounting mid-fullscreen must not start windowed
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  return isFullscreen;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenState {
  const supported =
    typeof document !== "undefined" && document.fullscreenEnabled;
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!supported) {
      return;
    }
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [supported]);

  const toggle = useCallback((): void => {
    if (!supported) {
      return;
    }
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => {
        /* the browser may reject (e.g. user gesture lost) — nothing to do */
      });
      return;
    }
    const element = ref.current;
    if (element !== null) {
      void element.requestFullscreen().catch(() => {
        /* denied / unsupported at call time — stay windowed, no throw */
      });
    }
  }, [supported, ref]);

  return { supported, isFullscreen, toggle };
}

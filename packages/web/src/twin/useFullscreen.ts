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

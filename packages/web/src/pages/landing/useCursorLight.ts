import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import {
  RITE_SPRINGS,
  isSpringSettled,
  stepSpring,
  type SpringState,
} from "./rite-motion.js";

/** Instantaneous pointer speed, shared with the flame without re-renders. */
export interface PointerMotion {
  /** px/s, decays to 0 when the pointer rests. */
  speed: number;
}

// -----------------------------------------------------------------------------
// useCursorLight — the carried light of Act I.
//
// Listens for pointer movement over the rite root and drives two CSS custom
// properties (`--light-x`, `--light-y`, in px relative to the viewport) with
// a soft spring so the light feels *carried*, not painted. No React state:
// values go straight to element.style via rAF, and the loop parks itself when
// the springs settle. Touch devices never receive pointermove streams of use,
// so the light is driven by scroll position instead (handled in CSS via
// `--rite-overall`; see rite.css).
// -----------------------------------------------------------------------------

export function useCursorLight(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): MutableRefObject<PointerMotion> {
  const motionRef = useRef<PointerMotion>({ speed: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || root === null) {
      return;
    }

    const x: SpringState = { value: window.innerWidth / 2, velocity: 0 };
    const y: SpringState = { value: window.innerHeight * 0.4, velocity: 0 };
    let targetX = x.value;
    let targetY = y.value;
    let lastEventTime = 0;
    let lastEventX = 0;
    let lastEventY = 0;
    let rafId: number | null = null;
    let lastFrameTime = 0;

    const frame = (now: number): void => {
      const dt = lastFrameTime > 0 ? (now - lastFrameTime) / 1000 : 1 / 60;
      lastFrameTime = now;

      stepSpring(x, targetX, dt, RITE_SPRINGS.cursorLight);
      stepSpring(y, targetY, dt, RITE_SPRINGS.cursorLight);
      root.style.setProperty("--light-x", `${String(Math.round(x.value))}px`);
      root.style.setProperty("--light-y", `${String(Math.round(y.value))}px`);

      // Pointer speed decays between events so the flame steadies at rest.
      motionRef.current.speed *= Math.max(0, 1 - dt * 6);

      if (isSpringSettled(x, targetX, 0.5) && isSpringSettled(y, targetY, 0.5)) {
        rafId = null;
        lastFrameTime = 0;
        return;
      }
      rafId = window.requestAnimationFrame(frame);
    };

    const wake = (): void => {
      rafId ??= window.requestAnimationFrame(frame);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const now = performance.now();
      if (lastEventTime > 0) {
        const dt = (now - lastEventTime) / 1000;
        if (dt > 0) {
          const dx = event.clientX - lastEventX;
          const dy = event.clientY - lastEventY;
          motionRef.current.speed = Math.hypot(dx, dy) / dt;
        }
      }
      lastEventTime = now;
      lastEventX = event.clientX;
      lastEventY = event.clientY;
      targetX = event.clientX;
      targetY = event.clientY;
      root.style.setProperty("--light-on", "1");
      wake();
    };

    const onPointerLeave = (): void => {
      // The light dims rather than vanishes — someone set the candle down.
      root.style.setProperty("--light-on", "0.35");
    };

    root.style.setProperty("--light-on", "0.35");
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave, {
      passive: true,
    });
    wake();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [rootRef, enabled]);

  return motionRef;
}

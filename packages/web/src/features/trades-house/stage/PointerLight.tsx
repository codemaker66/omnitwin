import { useEffect, useRef, type MutableRefObject, type ReactElement } from "react";
import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../../../lib/springs.js";
import { decaySpeed } from "./parallax.js";
import type { StagePoint } from "./stage-geometry.js";
import { useStageRuntime } from "./stage-runtime.js";

// -----------------------------------------------------------------------------
// PointerLight — the carried light, lifted from pages/landing/useCursorLight.ts
// into the stage root.
//
// A radial warm light on two CSS variables (`--light-x`, `--light-y`, px in
// the fixed root, which is the viewport) follows the pointer on a soft spring
// so it feels carried, not painted, and warms what it passes by about 4%
// (stage.css: a screen-blended radial at 0.04–0.09 alpha of the scene's hue).
// No React state: values go to the root's style from the stage loop and the
// step parks when the springs settle and the speed has died.
//
// Reduced motion is DIRECT mode, never off: the lag goes, the light stays
// under the pointer (feedback: freezing pointer-following killed the
// spotlight page's whole mechanic). Touch devices rarely send pointermove of
// use; the light then rests where the scene's brightest practical is.
// -----------------------------------------------------------------------------

/** Instantaneous pointer speed, shared with the Lantern without re-renders. */
export interface PointerMotion {
  /** px/s, decays to 0 when the pointer rests. */
  speed: number;
}

/** Mirrors RITE_SPRINGS.cursorLight: soft, heavy, deliberate. Local so the stage never imports the landing page. */
export const LIGHT_SPRING: SpringConfig = { stiffness: 42, damping: 14 };

/** The light dims to this when the pointer leaves the window: someone set the candle down. */
export const LIGHT_SET_DOWN = 0.35;

/** Below this speed the decay step stops and the loop may park. */
const SPEED_FLOOR_PX_PER_S = 1;
const SETTLE_EPSILON_PX = 0.5;

export interface PointerLightProps {
  readonly reducedMotion: boolean;
  readonly active: boolean;
  /** Where the light rests before the pointer arrives, normalised in the tableau. */
  readonly restAt: StagePoint;
  /** Written every frame; read by the Lantern's pointer uniform. */
  readonly motionRef?: MutableRefObject<PointerMotion>;
}

export function PointerLight({ reducedMotion, active, restAt, motionRef }: PointerLightProps): ReactElement {
  const runtime = useStageRuntime();
  const ownMotionRef = useRef<PointerMotion>({ speed: 0 });
  const motion = motionRef ?? ownMotionRef;

  useEffect(() => {
    if (!active) return undefined;
    const root = runtime.getRoot();
    if (root === null) return undefined;

    const rect = runtime.getTableauRect();
    const seedX = rect === null ? window.innerWidth / 2 : rect.left + rect.width * restAt.x;
    const seedY = rect === null ? window.innerHeight * 0.58 : rect.top + rect.height * restAt.y;
    const x: SpringState = { value: seedX, velocity: 0 };
    const y: SpringState = { value: seedY, velocity: 0 };
    let targetX = seedX;
    let targetY = seedY;
    let removeStep: (() => void) | null = null;

    const write = (px: number, py: number): void => {
      root.style.setProperty("--light-x", `${String(Math.round(px))}px`);
      root.style.setProperty("--light-y", `${String(Math.round(py))}px`);
    };

    const step = (_nowMs: number, dt: number): boolean => {
      if (!reducedMotion) {
        stepSpring(x, targetX, dt, LIGHT_SPRING);
        stepSpring(y, targetY, dt, LIGHT_SPRING);
        write(x.value, y.value);
      }
      motion.current.speed = decaySpeed(motion.current.speed, dt);
      const speedDead = motion.current.speed < SPEED_FLOOR_PX_PER_S;
      if (speedDead) motion.current.speed = 0;
      const settled = reducedMotion
        || (isSpringSettled(x, targetX, SETTLE_EPSILON_PX) && isSpringSettled(y, targetY, SETTLE_EPSILON_PX));
      if (settled && speedDead) {
        removeStep = null;
        return false;
      }
      return true;
    };

    const wake = (): void => {
      removeStep ??= runtime.loop.add(step);
    };

    const unsubscribe = runtime.onPointer((sample) => {
      targetX = sample.clientX;
      targetY = sample.clientY;
      motion.current.speed = sample.speed;
      root.style.setProperty("--light-on", "1");
      if (reducedMotion) {
        // Direct mode: no spring, the light sits exactly under the pointer.
        x.value = targetX;
        y.value = targetY;
        write(targetX, targetY);
      }
      wake();
    });

    const onLeave = (): void => {
      root.style.setProperty("--light-on", String(LIGHT_SET_DOWN));
    };
    document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });

    root.style.setProperty("--light-on", String(LIGHT_SET_DOWN));
    write(seedX, seedY);

    return () => {
      unsubscribe();
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (removeStep !== null) removeStep();
    };
  }, [active, motion, reducedMotion, restAt, runtime]);

  return <div className="stage-light" aria-hidden="true" />;
}

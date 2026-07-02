import { useCallback, useEffect, useRef, useState } from "react";
import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../lib/springs.js";

// -----------------------------------------------------------------------------
// useDive — the signature moment (Twin Phase 2, Task 6).
//
// One spring drives a 0→1 progress for the camera flight between the
// dollhouse orbit and a pano node (either direction). Heavier than a walk
// hop — this is a descent, not a step. The consumer reads `progress` for
// crossfades and the DiveCamera path; `onArrive` fires exactly once at
// settle. Reduced motion resolves instantly (a cut, not a flight).
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase2-dollhouse.md (Task 6).
// -----------------------------------------------------------------------------

/**
 * The slowest spring in the twin — a descent, not a step — critically damped
 * (damping = 2√stiffness) so it lands inside the spec's 1.2 s dive budget
 * without an overshoot bounce at the pano threshold.
 */
export const DIVE_SPRING: SpringConfig = { stiffness: 100, damping: 20 };

export type DiveDirection = "down" | "up";

export interface DiveState {
  readonly diving: boolean;
  readonly progress: number;
  /** Node being dived into ("down") or surfaced from ("up"). */
  readonly target: string | null;
  readonly direction: DiveDirection;
  /** Camera position at flight start (three space). */
  readonly from: readonly [number, number, number];
  readonly dive: (
    nodeId: string,
    opts: {
      readonly position: readonly [number, number, number];
      readonly direction?: DiveDirection;
    },
  ) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useDive({
  onArrive,
}: {
  onArrive: (nodeId: string, direction: DiveDirection) => void;
}): DiveState {
  const [target, setTarget] = useState<string | null>(null);
  const [direction, setDirection] = useState<DiveDirection>("down");
  const [progress, setProgress] = useState(0);
  const [from, setFrom] = useState<readonly [number, number, number]>([0, 0, 0]);

  const rafRef = useRef<number | null>(null);
  const springRef = useRef<SpringState>({ value: 0, velocity: 0 });
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  const cancel = useCallback((): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const dive = useCallback(
    (
      nodeId: string,
      opts: {
        readonly position: readonly [number, number, number];
        readonly direction?: DiveDirection;
      },
    ): void => {
      if (rafRef.current !== null) {
        return; // one flight at a time — a dive is not interruptible
      }
      const dir = opts.direction ?? "down";
      setTarget(nodeId);
      setDirection(dir);
      setFrom(opts.position);

      if (prefersReducedMotion()) {
        setTarget(null);
        setProgress(0);
        onArriveRef.current(nodeId, dir);
        return;
      }

      springRef.current = { value: 0, velocity: 0 };
      setProgress(0);
      let last = 0;
      const frame = (now: number): void => {
        const dt = last > 0 ? (now - last) / 1000 : 1 / 60;
        last = now;
        stepSpring(springRef.current, 1, dt, DIVE_SPRING);
        const clamped = Math.min(Math.max(springRef.current.value, 0), 1);
        setProgress(clamped);
        if (isSpringSettled(springRef.current, 1, 0.004)) {
          rafRef.current = null;
          setTarget(null);
          setProgress(0);
          onArriveRef.current(nodeId, dir);
          return;
        }
        rafRef.current = window.requestAnimationFrame(frame);
      };
      rafRef.current = window.requestAnimationFrame(frame);
    },
    [],
  );

  return { diving: target !== null, progress, target, direction, from, dive };
}

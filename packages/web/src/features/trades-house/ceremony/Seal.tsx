import { useEffect, useRef, type ReactElement } from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { OptionSeal } from "../OptionSeal.js";
import { stampBeat } from "./beats.js";
import { createFrameLoop } from "./spring-loop.js";

// -----------------------------------------------------------------------------
// Seal — the wax seal on an option, and the strike that commits it.
//
// The wax and numeral are OptionSeal (the Hall's own language: every
// Incorporation was founded by a Seal of Cause). This wraps it with the t1
// beat of the ceremony: when the option is committed the seal comes down onto
// the paper on SPRING_PRESETS.strike (420/32, damping ratio 0.78 — one tiny
// overshoot, settled within 0.25 s; `heavy` is a sigh, not a strike), and its
// glow is a ::after whose opacity follows the same spring. Never a box-shadow:
// an animated shadow repaints; an opacity composites. The first frame of the
// strike writes data-beat-at="commit:<ms>" from the rAF clock, which is what
// the reduced-motion e2e reads. Under reduced motion the seal does not move;
// the glow arrives whole, on the same frame, with the same stamp.
// -----------------------------------------------------------------------------

export interface SealProps {
  /** The seat the seal numbers (0..3). */
  readonly seat: number;
  /** True once this seat is the committed one: the strike begins on the next frame. */
  readonly struck: boolean;
  readonly reducedMotion?: boolean;
  /** The strike's first frame, with the rAF timestamp that was stamped. */
  readonly onStrike?: (atMs: number) => void;
}

/** The seal starts this much larger than rest (closer to the eye) and descends. */
export const SEAL_DROP = 0.28;
/** The resting glow, as the ::after opacity once the strike has settled. */
export const SEAL_GLOW = 0.6;

const GLOW_PROPERTY = "--seal-glow";

function rest(root: HTMLElement, glow: number): void {
  root.style.transform = "";
  root.style.setProperty(GLOW_PROPERTY, glow.toFixed(3));
}

export function Seal({ seat, struck, reducedMotion = false, onStrike }: SealProps): ReactElement {
  const rootRef = useRef<HTMLSpanElement>(null);
  // Read through refs so a preference flip mid-strike never restarts the strike.
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onStrikeRef = useRef(onStrike);
  onStrikeRef.current = onStrike;

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    if (!struck) {
      rest(root, 0);
      return undefined;
    }
    const spring: SpringState = { value: 0, velocity: 0 };
    let stamped = false;
    const loop = createFrameLoop((nowMs, dt) => {
      if (!stamped) {
        stamped = true;
        stampBeat(root, "commit", nowMs);
        onStrikeRef.current?.(nowMs);
      }
      if (reducedRef.current) {
        rest(root, SEAL_GLOW);
        return false;
      }
      stepSpring(spring, 1, dt, SPRING_PRESETS.strike);
      if (isSpringSettled(spring, 1)) {
        rest(root, SEAL_GLOW);
        return false;
      }
      const travel = spring.value;
      root.style.transform = `scale(${(1 + SEAL_DROP * (1 - travel)).toFixed(4)})`;
      root.style.setProperty(GLOW_PROPERTY, (Math.min(1, Math.max(0, travel)) * SEAL_GLOW).toFixed(3));
      return true;
    });
    loop.wake();
    return () => { loop.stop(); };
  }, [struck]);

  return (
    <span
      ref={rootRef}
      className={`ceremony-seal${struck ? " is-struck" : ""}`}
      aria-hidden="true"
    >
      <OptionSeal index={seat} />
    </span>
  );
}

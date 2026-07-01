import { useEffect, useRef, useState, type ReactElement } from "react";
import { easeOutCubic } from "./rite-motion.js";
import { useSeen } from "./useSeen.js";

const COUNT_MS = 600;

export interface RiteCountUpProps {
  readonly to: number;
  /** Static rendering (reduced motion): the number simply is. */
  readonly static?: boolean;
}

/**
 * A number that counts up from 0 in ~600 ms when it enters view. Tabular
 * figures in CSS guarantee zero layout shift; the final value is always in
 * the DOM as an aria-label so assistive tech never hears the sweep.
 */
export function RiteCountUp({ to, static: isStatic = false }: RiteCountUpProps): ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  const seen = useSeen(ref);
  const [display, setDisplay] = useState<number>(isStatic ? to : 0);

  useEffect(() => {
    if (isStatic || !seen) {
      return;
    }
    let rafId: number | null = null;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = (now - start) / COUNT_MS;
      setDisplay(Math.round(easeOutCubic(t) * to));
      if (t < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };
    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [seen, to, isStatic]);

  return (
    <span ref={ref} className="rite-count" aria-label={String(to)}>
      <span aria-hidden>{display}</span>
    </span>
  );
}

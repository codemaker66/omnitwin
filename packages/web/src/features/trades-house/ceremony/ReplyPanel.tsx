import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { stampBeat } from "./beats.js";
import { CEREMONY_TIMING, type CeremonyCallbacks, type CeremonyPhase } from "./ceremony-types.js";
import { PRESS_SCALE } from "./OptionColumn.js";
import { createFrameLoop } from "./spring-loop.js";

// -----------------------------------------------------------------------------
// ReplyPanel — the Convener's reply, the latch slot and Continue.
//
// Pre-mounted from the first render as visibility: hidden and inert, so the
// mount is never the long task inside the commit's springs. At t1 + 120 ms
// (the rAF clock, measured from the moment the page moved to "committed") it
// flips visible and rises 8 px on gridSettle, stamping data-beat-at="reply".
// The reply itself (children) is the page's typewriter on the audio clock;
// after it comes the latch line in its own slot and the Continue button,
// which is the only live control and takes focus on the rise — the phone's
// unchosen cards wait for exactly that focus before they retire.
// -----------------------------------------------------------------------------

export interface ReplyPanelProps {
  readonly phase: CeremonyPhase;
  readonly callbacks: CeremonyCallbacks;
  /** "Go on" or "See your Craft": the page knows which scene this is. */
  readonly continueLabel: string;
  readonly reducedMotion?: boolean;
  /** The speaker's name above the reply. */
  readonly who?: string;
  /** The latch line slot (a LatchLine), rendered after the reply. */
  readonly latch?: ReactNode;
  /** The Convener's reply. */
  readonly children?: ReactNode;
  /** The rise's first frame, with the rAF timestamp that was stamped. */
  readonly onReveal?: (atMs: number) => void;
}

const INERT = "inert";

function hide(root: HTMLElement): void {
  root.setAttribute(INERT, "");
  root.style.visibility = "hidden";
  root.style.transform = "";
  root.style.opacity = "";
}

export function ReplyPanel({
  phase,
  callbacks,
  continueLabel,
  reducedMotion = false,
  who = "The Convener",
  latch,
  children,
  onReveal,
}: ReplyPanelProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [revealed, setRevealed] = useState(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // Motion: the panel's rise and the Continue button's press, one loop.
  const riseRef = useRef<{ spring: SpringState; armedAtMs: number | null; revealed: boolean }>({
    spring: { value: CEREMONY_TIMING.replyRisePx, velocity: 0 },
    armedAtMs: null,
    revealed: false,
  });
  const pressRef = useRef<{ spring: SpringState; target: number; releaseAtMs: number | null }>({
    spring: { value: 1, velocity: 0 },
    target: 1,
    releaseAtMs: null,
  });

  const loopRef = useRef(createFrameLoop((nowMs, dt) => {
    const root = rootRef.current;
    if (root === null) return false;
    let active = false;

    const rise = riseRef.current;
    if (rise.armedAtMs !== null) {
      if (nowMs < rise.armedAtMs + CEREMONY_TIMING.replyDelayMs) {
        active = true;
      } else {
        if (!rise.revealed) {
          rise.revealed = true;
          root.removeAttribute(INERT);
          root.style.visibility = "visible";
          stampBeat(root, "reply", nowMs);
          onRevealRef.current?.(nowMs);
          setRevealed(true);
          if (reducedRef.current) {
            rise.spring.value = 0;
            rise.spring.velocity = 0;
          }
        }
        stepSpring(rise.spring, 0, dt, SPRING_PRESETS.gridSettle);
        const y = Math.max(0, rise.spring.value);
        if (isSpringSettled(rise.spring, 0, 0.01)) {
          root.style.transform = "";
          root.style.opacity = "";
          rise.armedAtMs = null;
        } else {
          root.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
          root.style.opacity = (1 - y / CEREMONY_TIMING.replyRisePx).toFixed(3);
          active = true;
        }
      }
    }

    const press = pressRef.current;
    const button = continueRef.current;
    if (button !== null) {
      if (press.releaseAtMs !== null && nowMs >= press.releaseAtMs) {
        press.releaseAtMs = null;
        press.target = 1;
        delete button.dataset["pressed"];
      }
      stepSpring(press.spring, press.target, dt, SPRING_PRESETS.gridSettle);
      const scale = press.spring.value;
      button.style.transform = Math.abs(scale - 1) < 1e-4 ? "" : `scale(${scale.toFixed(4)})`;
      if (!(isSpringSettled(press.spring, press.target, 1e-4) && press.releaseAtMs === null)) active = true;
    }
    return active;
  }));
  useEffect(() => {
    const loop = loopRef.current;
    return () => { loop.stop(); };
  }, []);

  // Hidden and inert before React's first paint, so nothing behind the stage
  // ever tabs into an unrevealed panel.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root !== null && !riseRef.current.revealed) hide(root);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const rise = riseRef.current;
    if (phase === "committed") {
      if (rise.revealed || rise.armedAtMs !== null) return;
      rise.armedAtMs = performance.now();
      rise.spring.value = CEREMONY_TIMING.replyRisePx;
      rise.spring.velocity = 0;
      loopRef.current.wake();
    } else if (phase === "speaking" || phase === "open" || phase === "held") {
      // A new scene: back under the paper until the next commit.
      rise.armedAtMs = null;
      rise.revealed = false;
      hide(root);
      setRevealed(false);
    }
  }, [phase]);

  // Focus goes to the only live control on the rise, as the shipped page does.
  useEffect(() => {
    if (revealed) continueRef.current?.focus();
  }, [revealed]);

  const onContinuePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    const press = pressRef.current;
    if (!reducedRef.current) press.target = PRESS_SCALE;
    press.releaseAtMs = performance.now() + CEREMONY_TIMING.pressScaleMs;
    event.currentTarget.dataset["pressed"] = "true";
    loopRef.current.wake();
  };

  const onContinue = (): void => {
    stampBeat(continueRef.current, "continue", performance.now());
    callbacksRef.current.onContinue();
  };

  return (
    <div
      ref={rootRef}
      className={`ceremony-reply${revealed ? " is-revealed" : " is-hidden"}`}
      role="group"
      aria-label={`${who} replies`}
      data-phase={phase}
    >
      <p className="ceremony-reply-who">{who}</p>
      <div className="ceremony-reply-text">{children}</div>
      <div className="ceremony-reply-latch">{latch}</div>
      <button
        type="button"
        ref={continueRef}
        className="ceremony-continue"
        onPointerDown={onContinuePointerDown}
        onClick={onContinue}
      >
        {continueLabel}
      </button>
    </div>
  );
}

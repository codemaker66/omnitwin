import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { CEREMONY_TIMING, type CeremonyCallbacks, type CeremonyOption } from "./ceremony-types.js";
import { keyToIntent } from "./keyboard-map.js";
import { PRESS_SCALE, COST_PREFIX } from "./OptionColumn.js";
import { createFrameLoop } from "./spring-loop.js";

// -----------------------------------------------------------------------------
// HeldCard — the phone's second tap.
//
// A phone shows four leads; the first tap lifts the option into this overlay
// (lead, body and the cost line, with "Costs you" read through the live
// region) and the second tap, on the card, commits. Escape or a tap away puts
// it back. This is an instrument repair as much as a layout one: the shipped
// phone committed on bare leads with the cost hidden, and the cost is what
// keeps the four options equally choosable.
//
// It lives inside the stage's clip wrapper (position: absolute; inset: 0), so
// it can never add a pixel of scroll. Focus moves to the card on open and
// back to whatever had it on close. The card itself is one <button>: its
// whole face is the second tap, so a screen reader hears lead, body and cost
// as the name of the thing it is about to press.
// -----------------------------------------------------------------------------

export interface HeldCardProps {
  /** The held option, or null when nothing is held (renders nothing). */
  readonly option: CeremonyOption | null;
  readonly callbacks: CeremonyCallbacks;
  /** The caption sink (the page's coalesced live region): the cost line goes through it on open. */
  readonly onCaption: (caption: string) => void;
  readonly reducedMotion?: boolean;
}

export const HELD_HINT = "Tap again to choose";

export function HeldCard({ option, callbacks, onCaption, reducedMotion = false }: HeldCardProps): ReactElement | null {
  const uid = useId();
  const tapRef = useRef<HTMLButtonElement>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const seat = option?.seat ?? null;
  const cost = option?.cost ?? "";

  // Focus in on open, out on close; the cost read aloud on open. Keyed on the
  // seat and the cost text, not the option object, so a page that rebuilds
  // its options each render does not re-announce.
  useEffect(() => {
    if (seat === null) return undefined;
    const previous = document.activeElement;
    tapRef.current?.focus();
    onCaptionRef.current(`${COST_PREFIX}${cost}`);
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [seat, cost]);

  // Escape releases from anywhere on the page while the card is up.
  useEffect(() => {
    if (seat === null) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      callbacksRef.current.onRelease();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [seat]);

  // The second tap's own press: scale(0.97) for 100 ms on gridSettle.
  const pressRef = useRef<{ spring: SpringState; target: number; releaseAtMs: number | null }>({
    spring: { value: 1, velocity: 0 },
    target: 1,
    releaseAtMs: null,
  });
  const loopRef = useRef(createFrameLoop((nowMs, dt) => {
    const press = pressRef.current;
    const element = tapRef.current;
    if (element === null) return false;
    if (press.releaseAtMs !== null && nowMs >= press.releaseAtMs) {
      press.releaseAtMs = null;
      press.target = 1;
      delete element.dataset["pressed"];
    }
    stepSpring(press.spring, press.target, dt, SPRING_PRESETS.gridSettle);
    const scale = press.spring.value;
    element.style.transform = Math.abs(scale - 1) < 1e-4 ? "" : `scale(${scale.toFixed(4)})`;
    return !(isSpringSettled(press.spring, press.target, 1e-4) && press.releaseAtMs === null);
  }));
  useEffect(() => {
    const loop = loopRef.current;
    return () => { loop.stop(); };
  }, []);

  const press = (element: HTMLButtonElement): void => {
    const state = pressRef.current;
    if (!reducedRef.current) state.target = PRESS_SCALE;
    state.releaseAtMs = performance.now() + CEREMONY_TIMING.pressScaleMs;
    element.dataset["pressed"] = "true";
    loopRef.current.wake();
  };

  if (option === null) return null;

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    press(event.currentTarget);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    // A held key must not open and commit in one breath.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    const intent = keyToIntent(event.key, {
      phase: "held",
      isPhone: true,
      focusIn: "held",
      modified: event.ctrlKey || event.metaKey || event.altKey,
    });
    // The browser's own click carries the commit; Escape is handled on the document.
    if (intent === "commit") press(event.currentTarget);
  };

  const leadId = `${uid}-lead`;
  const bodyId = `${uid}-body`;

  return (
    <div className="ceremony-held" data-seat={option.seat}>
      {/* A click, not a pointerdown: releasing on pointerdown would let the
          click land on the option underneath and re-open the card. */}
      <div
        className="ceremony-held-backdrop"
        aria-hidden="true"
        onClick={() => { callbacksRef.current.onRelease(); }}
      />
      <div
        className="ceremony-held-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={leadId}
        aria-describedby={bodyId}
      >
        <button
          type="button"
          ref={tapRef}
          className="ceremony-held-tap"
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onClick={() => { callbacksRef.current.onCommit(option.seat); }}
        >
          <span className="ceremony-held-lead" id={leadId}>{option.lead}</span>
          <span className="ceremony-held-body" id={bodyId}>{option.body}</span>
          <span className="ceremony-held-cost">{COST_PREFIX}{option.cost}</span>
          <span className="ceremony-held-hint">{HELD_HINT}</span>
        </button>
      </div>
    </div>
  );
}

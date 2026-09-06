import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { stampBeat } from "./beats.js";
import {
  CEREMONY_TIMING,
  type CeremonyCallbacks,
  type CeremonyOption,
  type CeremonyPhase,
} from "./ceremony-types.js";
import { keyToIntent } from "./keyboard-map.js";
import { retreatTargets } from "./Retreat.js";
import { Seal } from "./Seal.js";
import { createFrameLoop, type FrameLoop } from "./spring-loop.js";
import "./ceremony.css";

// -----------------------------------------------------------------------------
// OptionColumn — the four answers on the stage, and the choice ceremony's
// first two beats.
//
// Desktop: a column on a translucent paper panel; one tap commits. Phone: a
// two-by-two grid of leads; the first tap lifts the option into the HeldCard
// and the second tap, there, commits. Every option is a real <button> with
// lead, body and the cost line ("Costs you", ≥ 12 px, alpha ≥ 0.9): naming
// the price is what keeps the four options equally choosable.
//
// t0, pointer-down or Enter/Space keydown: scale(0.97) for 100 ms on
// gridSettle (a spring-driven transform, never a CSS transition) and the
// onPress callback, where the page plays the paper touch at -18 dB. The
// native click that follows carries the intent (commit on desktop, hold on a
// phone), so keyboard and pointer share one path and a held key cannot
// re-press. t1 + 40 ms, after the page has moved to "committed": the three
// unchosen cards lean toward the chosen one (inward, never outward — outward
// would extend the panel's overflow) and dim to 0.42 on camera 120/14,
// staggered 40 ms, all in this component's one rAF loop, which writes
// data-beat-at="retreat:<ms>" on its first movement. On phones the unchosen
// cards then leave the visual stack as visibility: hidden; height: 0 with
// tabindex -1, but only after focus has moved to Continue, so a screen reader
// is never standing on a card that vanishes under it.
//
// Motion state lives in refs and element styles; React state holds only what
// the accessibility tree needs (the retired flag).
// -----------------------------------------------------------------------------

export interface OptionColumnProps {
  readonly options: readonly CeremonyOption[];
  readonly phase: CeremonyPhase;
  /** The held seat (phone, phase "held") or the committed seat (from "committed" on). */
  readonly chosenSeat: number | null;
  readonly isPhone: boolean;
  readonly callbacks: CeremonyCallbacks;
  readonly reducedMotion?: boolean;
  /** The group's accessible name. */
  readonly label?: string;
}

export const PRESS_SCALE = 0.97;
/** Anticipation on fine pointers only: a 2 px lift on camera 120/14. */
export const HOVER_LIFT_PX = 2;
/** One slot pitch when the cards have no layout yet (a test, a hidden tab). */
export const FALLBACK_PITCH_PX = 88;
export const COST_PREFIX = "Costs you: ";

interface CardMotion {
  readonly scale: SpringState;
  scaleTarget: number;
  releaseAtMs: number | null;
  readonly lift: SpringState;
  liftTarget: number;
  readonly tx: SpringState;
  txTarget: number;
  readonly ty: SpringState;
  tyTarget: number;
  readonly opacity: SpringState;
  opacityTarget: number;
  retreatAtMs: number | null;
  retreatDxPx: number;
  retreatDyPx: number;
}

function idleMotion(): CardMotion {
  return {
    scale: { value: 1, velocity: 0 },
    scaleTarget: 1,
    releaseAtMs: null,
    lift: { value: 0, velocity: 0 },
    liftTarget: 0,
    tx: { value: 0, velocity: 0 },
    txTarget: 0,
    ty: { value: 0, velocity: 0 },
    tyTarget: 0,
    opacity: { value: 1, velocity: 0 },
    opacityTarget: 1,
    retreatAtMs: null,
    retreatDxPx: 0,
    retreatDyPx: 0,
  };
}

function resetMotion(motion: CardMotion): void {
  const fresh = idleMotion();
  Object.assign(motion.scale, fresh.scale);
  Object.assign(motion.lift, fresh.lift);
  Object.assign(motion.tx, fresh.tx);
  Object.assign(motion.ty, fresh.ty);
  Object.assign(motion.opacity, fresh.opacity);
  motion.scaleTarget = 1;
  motion.releaseAtMs = null;
  motion.liftTarget = 0;
  motion.txTarget = 0;
  motion.tyTarget = 0;
  motion.opacityTarget = 1;
  motion.retreatAtMs = null;
  motion.retreatDxPx = 0;
  motion.retreatDyPx = 0;
}

function writeMotion(element: HTMLElement, motion: CardMotion): void {
  const scale = motion.scale.value;
  const x = motion.tx.value;
  const y = motion.ty.value + motion.lift.value;
  const identity = Math.abs(scale - 1) < 1e-4 && Math.abs(x) < 0.01 && Math.abs(y) < 0.01;
  element.style.transform = identity
    ? ""
    : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
  element.style.opacity = Math.abs(motion.opacity.value - 1) < 1e-3 ? "" : motion.opacity.value.toFixed(3);
}

function motionSettled(motion: CardMotion): boolean {
  return (
    isSpringSettled(motion.scale, motion.scaleTarget, 1e-4)
    && isSpringSettled(motion.lift, motion.liftTarget, 0.01)
    && isSpringSettled(motion.tx, motion.txTarget, 0.01)
    && isSpringSettled(motion.ty, motion.tyTarget, 0.01)
    && isSpringSettled(motion.opacity, motion.opacityTarget, 1e-3)
    && motion.releaseAtMs === null
    && motion.retreatAtMs === null
  );
}

/** Distance between two neighbouring cards along one axis, or null without layout. */
function measuredPitch(
  first: HTMLElement | undefined,
  second: HTMLElement | undefined,
  axis: "x" | "y",
): number | null {
  if (first === undefined || second === undefined) return null;
  const a = first.getBoundingClientRect();
  const b = second.getBoundingClientRect();
  const distance = axis === "x" ? Math.abs(b.left - a.left) : Math.abs(b.top - a.top);
  if (distance > 0) return distance;
  const size = axis === "x" ? a.width : a.height;
  return size > 0 ? size : null;
}

export function OptionColumn({
  options,
  phase,
  chosenSeat,
  isPhone,
  callbacks,
  reducedMotion = false,
  label = "Your four answers",
}: OptionColumnProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef(new Map<number, HTMLButtonElement>());
  const motionsRef = useRef(new Map<number, CardMotion>());
  const loopRef = useRef<FrameLoop | null>(null);
  const retreatStampedRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const [retired, setRetired] = useState(false);

  const interactive = phase === "open";
  const committed = phase === "committed" || phase === "replying" || phase === "latched";

  const motionFor = useCallback((seat: number): CardMotion => {
    const motions = motionsRef.current;
    let motion = motions.get(seat);
    if (motion === undefined) {
      motion = idleMotion();
      motions.set(seat, motion);
    }
    return motion;
  }, []);

  // The one rAF loop: presses, hover lifts, the retreat and its dimming.
  const loop = useCallback((): FrameLoop => {
    if (loopRef.current !== null) return loopRef.current;
    const created = createFrameLoop((nowMs, dt) => {
      let active = false;
      let retreatBegan = false;
      for (const [seat, motion] of motionsRef.current) {
        const element = buttonsRef.current.get(seat);
        if (element === undefined) continue;
        if (motion.releaseAtMs !== null && nowMs >= motion.releaseAtMs) {
          motion.releaseAtMs = null;
          motion.scaleTarget = 1;
          delete element.dataset["pressed"];
        }
        if (motion.retreatAtMs !== null && nowMs >= motion.retreatAtMs) {
          motion.retreatAtMs = null;
          retreatBegan = true;
          motion.opacityTarget = CEREMONY_TIMING.retreatDimOpacity;
          if (reducedRef.current) {
            // Transforms become opacity: the dim arrives whole, on the beat.
            motion.opacity.value = CEREMONY_TIMING.retreatDimOpacity;
            motion.opacity.velocity = 0;
          } else {
            motion.txTarget = motion.retreatDxPx;
            motion.tyTarget = motion.retreatDyPx;
          }
        }
        stepSpring(motion.scale, motion.scaleTarget, dt, SPRING_PRESETS.gridSettle);
        stepSpring(motion.lift, motion.liftTarget, dt, SPRING_PRESETS.camera);
        stepSpring(motion.tx, motion.txTarget, dt, SPRING_PRESETS.camera);
        stepSpring(motion.ty, motion.tyTarget, dt, SPRING_PRESETS.camera);
        stepSpring(motion.opacity, motion.opacityTarget, dt, SPRING_PRESETS.camera);
        writeMotion(element, motion);
        if (!motionSettled(motion)) active = true;
      }
      if (retreatBegan && !retreatStampedRef.current) {
        retreatStampedRef.current = true;
        stampBeat(rootRef.current, "retreat", nowMs);
      }
      return active;
    });
    loopRef.current = created;
    return created;
  }, []);

  useEffect(() => () => { loopRef.current?.stop(); }, []);

  const press = useCallback((seat: number, element: HTMLButtonElement, nowMs: number): void => {
    const motion = motionFor(seat);
    if (!reducedRef.current) motion.scaleTarget = PRESS_SCALE;
    motion.releaseAtMs = nowMs + CEREMONY_TIMING.pressScaleMs;
    element.dataset["pressed"] = "true";
    stampBeat(element, "press", nowMs);
    loop().wake();
    callbacksRef.current.onPress(seat);
  }, [loop, motionFor]);

  // A new scene (or a released hold) puts every card back where it was.
  useEffect(() => {
    if (phase !== "speaking" && phase !== "open") return;
    for (const [seat, motion] of motionsRef.current) {
      resetMotion(motion);
      const element = buttonsRef.current.get(seat);
      if (element !== undefined) {
        writeMotion(element, motion);
        delete element.dataset["pressed"];
      }
    }
    retreatStampedRef.current = false;
    setRetired(false);
  }, [phase]);

  // t1 + 40 ms: the three unchosen cards retreat toward the chosen one.
  useEffect(() => {
    if (phase !== "committed" || chosenSeat === null) return;
    const t1 = performance.now();
    retreatStampedRef.current = false;
    const buttons = buttonsRef.current;
    const layout = isPhone ? "grid" : "column";
    const targets = retreatTargets(chosenSeat, options.length, layout);
    const pitchX = measuredPitch(buttons.get(0), buttons.get(1), "x") ?? FALLBACK_PITCH_PX;
    const pitchY = measuredPitch(buttons.get(0), buttons.get(layout === "grid" ? 2 : 1), "y") ?? FALLBACK_PITCH_PX;
    for (const target of targets) {
      const motion = motionFor(target.seat);
      motion.retreatAtMs = t1 + CEREMONY_TIMING.retreatDelayMs + target.delayMs;
      motion.retreatDxPx = target.dx * pitchX;
      motion.retreatDyPx = target.dy * pitchY;
      motion.liftTarget = 0;
    }
    loop().wake();
  }, [phase, chosenSeat, isPhone, options.length, loop, motionFor]);

  // Phone: the unchosen cards leave the visual stack only after focus has
  // moved to Continue (the reply panel focuses it on the rise).
  useEffect(() => {
    if (!isPhone || !committed) return undefined;
    const root = rootRef.current;
    if (root === null) return undefined;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      setRetired(true);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => { document.removeEventListener("focusin", onFocusIn); };
  }, [isPhone, committed]);

  const focusByOffset = useCallback((fromSeat: number, offset: number | "first" | "last"): void => {
    const seats = options.map((option) => option.seat);
    if (seats.length === 0) return;
    const fromIndex = Math.max(0, seats.indexOf(fromSeat));
    const index = offset === "first"
      ? 0
      : offset === "last"
        ? seats.length - 1
        : (fromIndex + offset + seats.length) % seats.length;
    const seat = seats[index];
    if (seat !== undefined) buttonsRef.current.get(seat)?.focus();
  }, [options]);

  const onKeyDown = (seat: number) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    const intent = keyToIntent(event.key, {
      phase,
      isPhone,
      focusIn: "options",
      modified: event.ctrlKey || event.metaKey || event.altKey,
    });
    switch (intent) {
      case "open":
      case "commit":
        // The press is the keydown; the browser's own click on this button
        // (Enter now, Space on keyup) carries the open or the commit.
        if (!event.repeat) press(seat, event.currentTarget, performance.now());
        return;
      case "next":
        event.preventDefault();
        focusByOffset(seat, 1);
        return;
      case "prev":
        event.preventDefault();
        focusByOffset(seat, -1);
        return;
      case "first":
        event.preventDefault();
        focusByOffset(seat, "first");
        return;
      case "last":
        event.preventDefault();
        focusByOffset(seat, "last");
        return;
      case "release":
        event.preventDefault();
        callbacksRef.current.onRelease();
        return;
      default:
        // mute, captions and everything else bubble to the page.
        return;
    }
  };

  const onPointerDown = (seat: number) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (!interactive || event.button !== 0) return;
    press(seat, event.currentTarget, performance.now());
  };

  const onClick = (seat: number) => (event: MouseEvent<HTMLButtonElement>): void => {
    if (!interactive) return;
    if (isPhone) {
      // The held card returns focus here on release; give it something to return to.
      event.currentTarget.focus();
      callbacksRef.current.onHold(seat);
    } else {
      callbacksRef.current.onCommit(seat);
    }
  };

  const onPointerEnter = (seat: number) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (!interactive || event.pointerType !== "mouse" || reducedRef.current) return;
    motionFor(seat).liftTarget = -HOVER_LIFT_PX;
    loop().wake();
  };

  const onPointerLeave = (seat: number) => (): void => {
    const motion = motionsRef.current.get(seat);
    if (motion === undefined || motion.liftTarget === 0) return;
    motion.liftTarget = 0;
    loop().wake();
  };

  const setButtonRef = (seat: number) => (element: HTMLButtonElement | null): void => {
    if (element === null) buttonsRef.current.delete(seat);
    else buttonsRef.current.set(seat, element);
  };

  return (
    <div
      ref={rootRef}
      className={`ceremony-options ${isPhone ? "is-grid" : "is-column"} phase-${phase}`}
      role="group"
      aria-label={label}
      data-phase={phase}
    >
      {options.map((option) => {
        const chosen = chosenSeat === option.seat;
        const held = phase === "held" && chosen;
        const unchosen = committed && !chosen;
        const retire = isPhone && unchosen && retired;
        const className = [
          "ceremony-option",
          committed && chosen ? "is-chosen" : "",
          unchosen ? "is-unchosen" : "",
          held ? "is-held" : "",
          retire ? "is-retired" : "",
        ].filter(Boolean).join(" ");
        return (
          /* aria-disabled, never disabled: disabling the focused button drops
             keyboard focus to <body> on every answer (the page's own rule). */
          <button
            type="button"
            key={option.seat}
            ref={setButtonRef(option.seat)}
            className={className}
            data-seat={option.seat}
            aria-disabled={interactive ? undefined : true}
            aria-expanded={isPhone ? held : undefined}
            tabIndex={retire ? -1 : 0}
            onPointerDown={onPointerDown(option.seat)}
            onPointerEnter={onPointerEnter(option.seat)}
            onPointerLeave={onPointerLeave(option.seat)}
            onClick={onClick(option.seat)}
            onKeyDown={onKeyDown(option.seat)}
          >
            <Seal seat={option.seat} struck={committed && chosen} reducedMotion={reducedMotion} />
            <span className="ceremony-option-text">
              <strong className="ceremony-option-lead">{option.lead}</strong>
              {isPhone ? null : <span className="ceremony-option-body">{option.body}</span>}
              {isPhone ? null : (
                <em className="ceremony-option-cost">{COST_PREFIX}{option.cost}</em>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

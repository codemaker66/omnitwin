import {
  useCallback, useEffect, useId, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement,
} from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import type { PokeGesture, PokeableState } from "../react/react-types.js";
import { nextRovingIndex, rovingTabIndex } from "./roving-tabindex.js";
import { boxCentre, boxToStyle, clientToStagePoint, rowForCount, type StagePoint } from "./stage-geometry.js";
import type { Prop } from "./stage-manifest.js";
import { useStageRuntime } from "./stage-runtime.js";

// -----------------------------------------------------------------------------
// PropButton — a pokeable is a real <button> with a layperson's name.
//
// Positioned by its manifest box in percent of the tableau, inside the
// "In the room" toolbar: one Tab stop with a roving tabindex (Left, Right,
// Home, End inside it). The button itself paints nothing but a faint
// hand-drawn mark on hover and focus; the object it names is drawn by the
// planes beneath. Anticipation on fine pointers only: a 2 px lift on
// `camera` 120/14, stepped in the stage's loop, parking on settle. Under
// reduced motion the lift becomes a colour step (data-lift), never a
// transform. While the Convener is still speaking the button is
// aria-disabled and does not lift, but a poke still reaches the page, whose
// reducer answers with the speaking caption; that is the design, not a leak.
//
// Gestures: pointer capture on the primary pointer, the second finger
// ignored, 8 px of slop before a tap becomes a sweep, 350 ms of hold before
// it becomes a press. Enter and Space are a tap at the box's centre. A bare
// click (assistive technology) is a tap too; the click that follows a pointer
// or key we already handled is swallowed for 50 ms so one poke never lands
// twice. The point reaches the page normalised 0..1 in the tableau.
// -----------------------------------------------------------------------------

export const PRESS_HOLD_MS = 350;
export const SWEEP_SLOP_PX = 8;
export const LIFT_PX = 2;
/** A click that follows a handled pointerup or keydown within this window is the same poke. */
const CLICK_ECHO_MS = 50;
const LIFT_SETTLE_EPSILON = 0.002;
/** Boxes whose bottom edge sits below this percent show their caption above, so it never leaves the tableau. */
const CAPTION_FLIP_PERCENT = 82;

export type StagePokeHandler = (propId: string, gesture: PokeGesture, point: StagePoint) => void;

/** Pure: what a completed pointer gesture was. */
export function classifyGesture(heldMs: number, travelledPx: number): PokeGesture {
  if (travelledPx >= SWEEP_SLOP_PX) return "sweep";
  return heldMs >= PRESS_HOLD_MS ? "press" : "tap";
}

/** Pure: which side of its box a prop's caption sits. */
export function captionSide(box: Prop["box"]): "above" | "below" {
  return box.y + box.h > CAPTION_FLIP_PERCENT ? "above" : "below";
}

function isFinePointer(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}

interface ActiveGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startAt: number;
  travelled: number;
}

export interface PropButtonProps {
  readonly prop: Prop;
  readonly poke: PokeableState | undefined;
  /** The last caption for this prop, shown beside it. */
  readonly caption: string | undefined;
  readonly speaking: boolean;
  readonly reducedMotion: boolean;
  readonly tabIndex: 0 | -1;
  readonly onFocus: () => void;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
  readonly onPoke: StagePokeHandler;
}

export function PropButton({
  prop, poke, caption, speaking, reducedMotion, tabIndex, onFocus, buttonRef, onPoke,
}: PropButtonProps): ReactElement {
  const runtime = useStageRuntime();
  const captionId = useId();
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const clickEchoUntilRef = useRef(0);
  const liftRef = useRef<SpringState>({ value: 0, velocity: 0 });
  const liftTargetRef = useRef(0);
  const removeLiftStepRef = useRef<(() => void) | null>(null);

  const setElement = useCallback((element: HTMLButtonElement | null): void => {
    elementRef.current = element;
    buttonRef(element);
  }, [buttonRef]);

  // ---- the reduced-motion colour step for the row the count has reached ----
  const count = poke?.count ?? 0;
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    const row = rowForCount(prop, count);
    if (reducedMotion && row !== null) {
      element.style.setProperty("--stage-prop-step", row.reducedMotion.colorStep);
    } else {
      element.style.removeProperty("--stage-prop-step");
    }
  }, [count, prop, reducedMotion]);

  // ---- the lift: a spring in a ref, one step in the shared loop ----
  const setLift = useCallback((target: number): void => {
    const element = elementRef.current;
    if (element === null) return;
    liftTargetRef.current = target;
    if (reducedMotion) {
      // Transforms become colour: the mark warms, nothing moves.
      element.dataset["lift"] = target > 0 ? "1" : "0";
      return;
    }
    removeLiftStepRef.current ??= runtime.loop.add((_nowMs, dt) => {
      const spring = liftRef.current;
      stepSpring(spring, liftTargetRef.current, dt, SPRING_PRESETS.camera);
      element.style.transform = `translate3d(0, ${(-LIFT_PX * spring.value).toFixed(3)}px, 0)`;
      if (isSpringSettled(spring, liftTargetRef.current, LIFT_SETTLE_EPSILON)) {
        removeLiftStepRef.current = null;
        return false;
      }
      return true;
    });
  }, [reducedMotion, runtime]);

  useEffect(() => () => {
    removeLiftStepRef.current?.();
    removeLiftStepRef.current = null;
  }, []);

  const dispatch = useCallback((gesture: PokeGesture, point: StagePoint): void => {
    clickEchoUntilRef.current = performance.now() + CLICK_ECHO_MS;
    onPoke(prop.id, gesture, point);
  }, [onPoke, prop.id]);

  const pointFor = useCallback((clientX: number, clientY: number): StagePoint => {
    const rect = runtime.getTableauRect();
    const point = rect === null ? null : clientToStagePoint(clientX, clientY, rect);
    return point ?? boxCentre(prop.box);
  }, [prop.box, runtime]);

  const onPointerEnter = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (speaking || !isFinePointer(event.pointerType)) return;
    setLift(1);
  };

  const onPointerLeave = (): void => {
    if (liftTargetRef.current !== 0) setLift(0);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (gestureRef.current !== null || event.button !== 0) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: performance.now(),
      travelled: 0,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety (the pointer stays ours through a sweep); an engine without it still pokes.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gesture.travelled = Math.max(gesture.travelled, Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY));
  };

  const endGesture = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing to release when capture was never granted.
    }
    gestureRef.current = null;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    const heldMs = performance.now() - gesture.startAt;
    const kind = classifyGesture(heldMs, gesture.travelled);
    endGesture(event);
    dispatch(kind, pointFor(event.clientX, event.clientY));
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    endGesture(event);
  };

  const onClick = (): void => {
    if (performance.now() < clickEchoUntilRef.current) return;
    dispatch("tap", boxCentre(prop.box));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    dispatch("tap", boxCentre(prop.box));
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === " ") event.preventDefault();
  };

  const hasCaption = caption !== undefined && caption.length > 0;

  return (
    <div
      className="stage-prop"
      style={boxToStyle(prop.box)}
      data-prop-id={prop.id}
      data-caption-side={captionSide(prop.box)}
    >
      <button
        ref={setElement}
        type="button"
        className="stage-prop-button"
        tabIndex={tabIndex}
        aria-disabled={speaking ? "true" : undefined}
        aria-describedby={hasCaption ? captionId : undefined}
        data-poke-stage={poke?.stage ?? "idle"}
        data-poke-count={count}
        onFocus={onFocus}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <span className="stage-prop-name">{prop.label}</span>
        <span className="stage-prop-mark" aria-hidden="true" />
      </button>
      {hasCaption ? (
        <span id={captionId} className="stage-prop-caption">{caption}</span>
      ) : null}
    </div>
  );
}

export interface PropToolbarProps {
  readonly props: readonly Prop[];
  readonly pokes: Readonly<Record<string, PokeableState>>;
  readonly captions: Readonly<Record<string, string>>;
  readonly speaking: boolean;
  readonly reducedMotion: boolean;
  readonly onPoke: StagePokeHandler;
}

/** The "In the room" group: one Tab stop, Left/Right/Home/End inside it. */
export function PropToolbar({ props, pokes, captions, speaking, reducedMotion, onPoke }: PropToolbarProps): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const count = props.length;
  const active = count === 0 ? 0 : Math.min(activeIndex, count - 1);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const next = nextRovingIndex(event.key, active, count);
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div
      className="stage-toolbar"
      role="toolbar"
      aria-label="In the room"
      aria-orientation="horizontal"
      data-speaking={speaking ? "true" : "false"}
      onKeyDown={onKeyDown}
    >
      {props.map((prop, index) => (
        <PropButton
          key={prop.id}
          prop={prop}
          poke={pokes[prop.id]}
          caption={captions[prop.id]}
          speaking={speaking}
          reducedMotion={reducedMotion}
          tabIndex={rovingTabIndex(index, active)}
          onFocus={() => { setActiveIndex(index); }}
          buttonRef={(element) => { buttonsRef.current[index] = element; }}
          onPoke={onPoke}
        />
      ))}
    </div>
  );
}

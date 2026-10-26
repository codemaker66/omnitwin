import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./reduced-motion.js";
import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "./springs.js";

// ---------------------------------------------------------------------------
// use-spring-value — a spring that drives one number straight into the DOM.
//
// The planner chrome's moving parts (the copper underline sliding to a key on
// `detent`, the caption docking to an edge, a phone sheet settling, the hour
// gliding to an act on `dialGlide`) all want the same thing: a value that
// moves on the shared spring core (lib/springs.ts) and is written where it
// renders, a CSS variable or a transform, without a React render per frame.
// No second animation system: chrome that only fades or slides uses the CSS
// motion tokens; anything with mass or in the hand uses this.
//
// The frame loop runs only while the spring is moving and stops the frame it
// settles, writing the exact target. Under reduced motion a new target is set
// directly. A change made from the keyboard is instant (`jump`), and a value
// that follows the pointer is written directly by its caller: pointer-following
// is never gated behind reduced motion.
// ---------------------------------------------------------------------------

/** The frame clock a driver runs on: the browser's, or a test's. */
export interface FrameClock {
  readonly request: (callback: (timeMs: number) => void) => number;
  readonly cancel: (handle: number) => void;
}

export interface SpringDriver {
  /** Move toward a new value from wherever the spring is, keeping its speed. */
  readonly setTarget: (target: number) => void;
  /** Be at a value at once, with no motion: a keyboard change, a first layout. */
  readonly jump: (value: number) => void;
  /** The value last written. */
  readonly value: () => number;
  /** Whether the frame loop is running. */
  readonly isMoving: () => boolean;
  /** Stop for good; a pending frame is cancelled. */
  readonly dispose: () => void;
}

export interface SpringDriverOptions {
  readonly initial: number;
  readonly config: SpringConfig;
  /** Writes a value where it renders. Called once per frame while moving. */
  readonly write: (value: number) => void;
  /** Settled within this distance and speed of the target, in the value's own units. */
  readonly epsilon?: number;
  readonly clock?: FrameClock;
  readonly reducedMotion?: () => boolean;
}

/** One frame at 60 fps: the step for a loop's first frame, which has no previous time. */
const FIRST_FRAME_SECONDS = 1 / 60;
const DEFAULT_EPSILON = 0.01;

function browserClock(): FrameClock | null {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return null;
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => { window.cancelAnimationFrame(handle); },
  };
}

/** A spring with its own frame loop, framework-free, so it can be tested on a fake clock. */
export function createSpringDriver(options: SpringDriverOptions): SpringDriver {
  const { config, write } = options;
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const clock = options.clock ?? browserClock();
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const state: SpringState = { value: options.initial, velocity: 0 };
  let target = options.initial;
  let handle: number | null = null;
  let lastTimeMs: number | null = null;
  let disposed = false;

  const stop = (): void => {
    if (handle !== null && clock !== null) clock.cancel(handle);
    handle = null;
    lastTimeMs = null;
  };

  const settleAt = (value: number): void => {
    stop();
    state.value = value;
    state.velocity = 0;
    target = value;
    write(value);
  };

  const frame = (timeMs: number): void => {
    handle = null;
    if (disposed) return;
    const dt = lastTimeMs === null ? FIRST_FRAME_SECONDS : Math.max(0, (timeMs - lastTimeMs) / 1000);
    lastTimeMs = timeMs;
    stepSpring(state, target, dt, config);
    if (isSpringSettled(state, target, epsilon)) {
      settleAt(target);
      return;
    }
    write(state.value);
    if (clock !== null) handle = clock.request(frame);
  };

  return {
    setTarget: (next: number): void => {
      if (disposed) return;
      // Already resting there: nothing moves and nothing needs writing.
      if (handle === null && state.velocity === 0 && state.value === next) {
        target = next;
        return;
      }
      if (clock === null || reducedMotion()) {
        settleAt(next);
        return;
      }
      target = next;
      if (handle === null && isSpringSettled(state, target, epsilon)) {
        settleAt(target);
        return;
      }
      if (handle === null) handle = clock.request(frame);
    },
    jump: (value: number): void => {
      if (disposed) return;
      settleAt(value);
    },
    value: () => state.value,
    isMoving: () => handle !== null,
    dispose: (): void => {
      stop();
      disposed = true;
    },
  };
}

export interface UseSpringValueOptions {
  /** Settled within this distance of the target, in the value's own units. */
  readonly epsilon?: number;
  /** Set the new target at once: true for a change made from the keyboard. */
  readonly instant?: boolean;
  /** A test's frame clock in place of the browser's. */
  readonly clock?: FrameClock;
}

/**
 * Drive `write` toward `target` on a spring. The first value is written at
 * once (nothing animates in from zero); later targets move on the spring, or
 * at once when `instant`. `write` may change every render without restarting
 * the motion.
 */
export function useSpringValue(
  target: number,
  config: SpringConfig,
  write: (value: number) => void,
  options: UseSpringValueOptions = {},
): void {
  const writeRef = useRef(write);
  writeRef.current = write;
  const driverRef = useRef<SpringDriver | null>(null);
  const { epsilon, instant = false, clock } = options;
  const { stiffness, damping } = config;

  useLayoutEffect(() => {
    const driver = createSpringDriver({
      initial: target,
      config: { stiffness, damping },
      write: (value) => { writeRef.current(value); },
      epsilon,
      clock,
    });
    driverRef.current = driver;
    driver.jump(target);
    return () => {
      driver.dispose();
      driverRef.current = null;
    };
    // One driver per spring character: a new target is not a new driver, it
    // goes through the effect below, so the motion keeps its speed.
  }, [stiffness, damping, epsilon, clock]);

  useLayoutEffect(() => {
    const driver = driverRef.current;
    if (driver === null) return;
    if (instant) driver.jump(target);
    else driver.setTarget(target);
  }, [target, instant]);
}

/**
 * Drive one CSS custom property on an element toward `target`, so the chrome's
 * stylesheet reads the moving value (`transform: translateX(var(--x))`).
 */
export function useSpringCssVariable(
  ref: RefObject<HTMLElement | null>,
  property: `--${string}`,
  target: number,
  config: SpringConfig,
  options: UseSpringValueOptions & { readonly unit?: string } = {},
): void {
  const unit = options.unit ?? "px";
  useSpringValue(target, config, (value) => {
    ref.current?.style.setProperty(property, `${String(Math.round(value * 1000) / 1000)}${unit}`);
  }, options);
}

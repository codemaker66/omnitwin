import { useRef } from "react";
import { useFrame, type RootState } from "@react-three/fiber";
import { captureBoundaryError } from "../../../observability/sentry.js";
import { useArrivalStore } from "./arrival-store.js";

// -----------------------------------------------------------------------------
// arrival-frame-guard — the containment ArrivalErrorBoundary structurally
// cannot provide (branch review, "important": a throw inside any arrival
// useFrame is outside every error boundary).
//
// WHY A BOUNDARY IS NOT ENOUGH, PRECISELY. React error boundaries catch a
// throw that happens inside React's own render or commit work
// (getDerivedStateFromError/componentDidCatch are invoked from the
// reconciler's try/catch — see ArrivalErrorBoundary.tsx's header for the
// react-dom call sites). A useFrame callback runs from @react-three/fiber's
// requestAnimationFrame loop instead: `advance` iterates the subscribers and
// calls each one directly, with no try/catch anywhere in the path and no
// React work on the stack. So a throw there:
//   1. is NOT caught by ArrivalErrorBoundary — it never reaches React;
//   2. recurs at frame rate forever, because nothing unsubscribes the
//      callback that threw;
//   3. aborts the rAF callback mid-iteration, which starves every subscriber
//      and every R3F root ordered AFTER it in the same loop — including roots
//      belonging to entirely different components on the page.
// The hero is decoration; it may never do that to the page hosting it.
//
// CONTAINMENT SHAPE. Per subscriber: catch, disable THAT subscriber for the
// life of the component instance (a crashed frame loop is not retried — the
// next frame would almost certainly throw identically, and a diagnostic per
// frame is a second bug), report once, then fail the arrival store with the
// existing "crash" reason so the hero unwinds to the static hero photograph
// through the SAME path every other failure uses (arrival-store.ts's
// first-reason-wins fail()). Nothing else in the app changes shape: the
// photograph is already on the page and simply carries it (spec §6).
//
// NOT SILENT. Reported exactly the way ArrivalErrorBoundary reports — one
// plain-English console.error, plus captureBoundaryError so the event exists
// in Sentry where an operator can actually see it. It carries its OWN tag
// ("ArrivalFrameLoop"), because "the hero's animation loop threw" and "the
// hero's render threw" have different remedies and must not merge into one
// issue. This failure is invisible by construction — the photograph keeps the
// homepage looking correct — so a visitor will never report it; the telemetry
// is the only way anyone learns it happened.
// -----------------------------------------------------------------------------

/**
 * Every arrival frame loop, by name. A union rather than a bare string so
 * "which useFrame callbacks are guarded" is a compile-time fact: adding a new
 * per-frame driver to the arrival forces a member here, and the Sentry tag
 * values stay a closed, greppable set.
 */
export type ArrivalFrameLabel = "FlightCamera" | "ExplodedHall" | "HallHandoffMesh";

/** The arrival's own frame-callback shape. Deliberately narrower than R3F's
 *  RenderCallback (no XRFrame third argument): no arrival loop uses it, and
 *  widening it later is a one-line change. */
export type ArrivalFrameCallback = (state: RootState, delta: number) => void;

function reportFrameCrash(label: ArrivalFrameLabel, thrown: unknown): void {
  // A throw can be anything at all; Sentry and the ErrorInfo contract both
  // want an Error, so normalise rather than lose the payload.
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));

  // Say it once, and say it plainly — mirrors ArrivalErrorBoundary's own
  // diagnostic, including the "Arrival:" prefix every arrival log line uses
  // (the test suites filter the console channel on it).
  // eslint-disable-next-line no-console
  console.error(
    `Arrival: the hero's ${label} frame loop threw, so the flight has been abandoned and the ` +
      "static hero photo is carrying the page — the rest of the homepage is unaffected. This " +
      "loop is now disabled for the visit; it is not retried, because the next frame would " +
      "almost certainly throw identically.",
    error,
  );

  // The componentStack is SYNTHETIC and says so: there is no React stack to
  // capture here — the throw happened in a requestAnimationFrame callback,
  // not during render — but the tag plus this one line is what tells an
  // operator which of the three loops died. void: fire-and-forget, exactly as
  // ArrivalErrorBoundary and error-boundary.tsx do; the helper is internally
  // guarded (no DSN / failed init → returns without throwing) and a
  // monitoring hiccup must never become a second failure inside a failure
  // handler.
  void captureBoundaryError(
    error,
    {
      componentStack: `\n    in ${label} (arrival useFrame callback — synthetic, no React stack)`,
    },
    "ArrivalFrameLoop",
  );
}

/**
 * useFrame, contained. A drop-in for `useFrame(cb)` at every arrival call
 * site.
 *
 * The subscriber itself stays registered (unsubscribing from inside R3F's own
 * iteration is not something this hook may do safely); it simply becomes a
 * no-op after the first throw, which costs one boolean read per frame until
 * the failed store tears the canvas down a few frames later.
 */
export function useArrivalFrame(label: ArrivalFrameLabel, callback: ArrivalFrameCallback): void {
  const crashed = useRef(false);
  useFrame((state, delta) => {
    if (crashed.current) {
      return;
    }
    try {
      callback(state, delta);
    } catch (thrown) {
      crashed.current = true;
      reportFrameCrash(label, thrown);
      useArrivalStore.getState().fail("crash");
    }
  });
}

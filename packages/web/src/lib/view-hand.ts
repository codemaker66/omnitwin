// ---------------------------------------------------------------------------
// A hand on the view
//
// Whether someone is moving the planner's view or something in it: a pointer
// pressed on the canvas (a finger, the mouse, a pen: orbit, pinch, a piece
// carried, a box), a wheel turned a moment ago, the camera's own gesture
// (cockpit-store, which covers its damped settle), or a piece dragged in from
// the catalogue. The render governor waits for the hand to leave before it
// rebuilds a pipeline, and a phone's pipeline skips bloom while it is on.
// ---------------------------------------------------------------------------

import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";

/** A wheel turn holds the view this long, ms: zooming arrives as separate ticks. */
export const WHEEL_HOLD_MS = 300;

export interface ViewHand {
  /** Whether a hand is on the view at `now`, ms on the performance clock. */
  isOn(now: number): boolean;
  /** Stops listening; the hand then reads as off. */
  dispose(): void;
}

/**
 * Watches `canvas` and the planner's stores for a hand on the view. `onLeave`
 * is called each time the last part of the hand leaves it: the last pressed
 * pointer lifted, a wheel's hold ran out, the camera's gesture or a catalogue
 * drag ended, with nothing else still on the view.
 */
export function watchViewHand(canvas: HTMLElement, onLeave: () => void = () => undefined): ViewHand {
  const pointersDown = new Set<number>();
  let lastWheelAt = -Infinity;
  let wheelTimer = 0;
  let disposed = false;

  const isOn = (now: number): boolean => !disposed && (pointersDown.size > 0 || now - lastWheelAt < WHEEL_HOLD_MS
    || useCockpitStore.getState().cameraInteractionActive || useCatalogueStore.getState().dragActive);
  const maybeLeft = (): void => {
    if (!isOn(performance.now())) onLeave();
  };

  const pressed = (event: PointerEvent): void => { pointersDown.add(event.pointerId); };
  const released = (event: PointerEvent): void => {
    if (pointersDown.delete(event.pointerId)) maybeLeft();
  };
  // A release the page never hears (over a disabled control) ends with the buttons.
  const moved = (event: PointerEvent): void => {
    if (event.buttons === 0) released(event);
  };
  const wheeled = (): void => {
    lastWheelAt = performance.now();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(maybeLeft, WHEEL_HOLD_MS);
  };
  canvas.addEventListener("pointerdown", pressed);
  window.addEventListener("pointerup", released, true);
  window.addEventListener("pointercancel", released, true);
  window.addEventListener("pointermove", moved, true);
  canvas.addEventListener("wheel", wheeled, { passive: true });
  const unsubscribeCockpit = useCockpitStore.subscribe((state, previous) => {
    if (previous.cameraInteractionActive && !state.cameraInteractionActive) maybeLeft();
  });
  const unsubscribeCatalogue = useCatalogueStore.subscribe((state, previous) => {
    if (previous.dragActive && !state.dragActive) maybeLeft();
  });

  return {
    isOn,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(wheelTimer);
      canvas.removeEventListener("pointerdown", pressed);
      window.removeEventListener("pointerup", released, true);
      window.removeEventListener("pointercancel", released, true);
      window.removeEventListener("pointermove", moved, true);
      canvas.removeEventListener("wheel", wheeled);
      unsubscribeCockpit();
      unsubscribeCatalogue();
    },
  };
}

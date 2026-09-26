// ---------------------------------------------------------------------------
// Withdrawing the browser's permission to scroll, mid-gesture (T-619).
//
// `touch-action` is consulted by the compositor when a touch sequence BEGINS.
// Flipping an element to `touch-action: none` after a long press has ripened
// therefore does nothing for the gesture already in flight: the browser
// decided at touchstart that this touch may pan, so the first movement after
// the lift starts a scroll and the page is sent `pointercancel` — the block
// lifts under the finger and then dies. The CSS class still earns its place
// (it governs the NEXT gesture), but on its own it cannot deliver "a long
// press lifts".
//
// The one thing that can withdraw that permission mid-sequence is
// `preventDefault()` on a NON-PASSIVE `touchmove`. Three details matter:
//
//   - The hold is registered at pointerdown, before the press ripens, and
//     decides per EVENT (asks "am I lifted?" each time it fires) rather than
//     per registration.
//   - It listens on `document`, not on the block. A live refetch can replace
//     the block's DOM node while the finger is still down, and a listener on a
//     detached node stops being consulted.
//   - Chromium looks again for non-passive listeners at a sequence's first
//     touchmove, so a hold added at pointerdown is heard. WebKit settles
//     whether it will wait for the page at touchstart, from the listeners
//     present then, so a writable board also keeps a do-nothing non-passive
//     listener for as long as it is mounted (`keepTouchesHoldable`): the
//     pattern dnd-kit's TouchSensor ships for iOS Safari.
//
// `{ passive: false }` is mandatory: document-level `touchmove` defaults to
// passive in Chrome and Safari, where `preventDefault()` is ignored with only
// a console warning — exactly the silent failure this exists to remove.
//
// A touch that lands on a scroll still gliding from a flick is the scroll's:
// it stops the glide. Chromium dispatches that touchstart, and the first
// touchmove after it, uncancelable, so no page can hold that sequence; a lift
// would die on the finger's first movement. `holdable()` reports it, and a
// press whose touchstart came uncancelable does not lift. Phones behave the
// same natively: a touch that stops a fling does not pick up what is under it.
//
// Chromium touch emulation exercises it end to end in
// e2e/diary-timetable.spec.ts; a physical phone remains the final word.
// ---------------------------------------------------------------------------

export interface ScrollHold {
  /** False once the browser dispatched this press's touchstart
   *  uncancelable: it has already given the touch to a scroll, so a lift
   *  could not be held. True until then, and for a pen, which sends no touch
   *  events. */
  readonly holdable: () => boolean;
  /** Stops holding and listening. Safe to call more than once. */
  readonly release: () => void;
}

/**
 * Starts suppressing native scrolling for as long as `isLifted()` answers
 * true, and watches the press's own touchstart for the browser's verdict.
 * Call it at pointerdown: Chromium and WebKit fire a touch's pointer events
 * before its touch events.
 */
export function holdScrollWhileLifted(isLifted: () => boolean): ScrollHold {
  if (typeof document === "undefined") return { holdable: () => true, release: () => undefined };

  let touchStartSeen = false;
  let holdable = true;

  const onTouchStart = (event: TouchEvent): void => {
    // The first touchstart after the pointerdown is this press's own; a
    // second finger's cannot change the answer.
    if (touchStartSeen) return;
    touchStartSeen = true;
    holdable = event.cancelable;
  };

  const onTouchMove = (event: TouchEvent): void => {
    // Per event, deliberately: between pointerdown and the lift this costs one
    // predicate and lets the page scroll exactly as it should.
    if (!isLifted()) return;
    // A listener the browser treated as passive cannot cancel, and calling
    // preventDefault() there only logs. Guarding keeps the caller's
    // expectation and the browser's behaviour from silently diverging.
    if (event.cancelable) event.preventDefault();
  };

  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  let released = false;
  return {
    holdable: () => holdable,
    release: () => {
      if (released) return;
      released = true;
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove);
    },
  };
}

/**
 * Keeps every touch sequence on the page one the page can still hold, by
 * leaving a non-passive `touchmove` listener in place before any touch
 * begins (see above: WebKit). It does nothing itself. Returns the release;
 * calling it more than once is safe.
 */
export function keepTouchesHoldable(): () => void {
  if (typeof document === "undefined") return () => undefined;
  // A fresh function per caller, so one caller's release cannot remove
  // another's listener.
  const listener = (): void => undefined;
  document.addEventListener("touchmove", listener, { passive: false });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener("touchmove", listener);
  };
}

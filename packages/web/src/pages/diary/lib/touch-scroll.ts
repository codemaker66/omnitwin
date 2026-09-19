// ---------------------------------------------------------------------------
// Withdrawing the browser's permission to scroll, mid-gesture (T-619 review
// fix 1).
//
// `touch-action` is consulted by the compositor when a touch sequence BEGINS.
// Flipping an element to `touch-action: none` after a long press has ripened
// therefore does nothing for the gesture already in flight: the browser
// decided at touchstart that this touch may pan, so the first movement after
// the lift starts a scroll and the page is sent `pointercancel` — the block
// lifts under the finger and then dies. The CSS class still earns its place
// (it governs the NEXT gesture, and it is what the brief prescribes), but on
// its own it cannot deliver "a long-press lifts".
//
// The one thing that can withdraw that permission mid-sequence is
// `preventDefault()` on a NON-PASSIVE `touchmove`. Two details matter:
//
//   - The listener is registered at pointerdown, before the press ripens. A
//     listener added later may not be consulted for a sequence already in
//     progress, so the decision has to be per-EVENT (ask "am I lifted?" each
//     time it fires) rather than per-registration.
//   - It listens on `document`, not on the block. A live refetch can replace
//     the block's DOM node while the finger is still down, and a listener on a
//     detached node stops being consulted.
//
// `{ passive: false }` is mandatory: document-level `touchmove` defaults to
// passive in Chrome and Safari, where `preventDefault()` is ignored with only
// a console warning — exactly the silent failure this fix exists to remove.
//
// Measured in Chromium touch emulation; see the probe and its output under
// `D:/claude/ship-friday-plan/sdd/lane5-touch-probe/`. A real device check is
// still outstanding.
// ---------------------------------------------------------------------------

/**
 * Starts suppressing native scrolling for as long as `isLifted()` answers
 * true. Returns the release function; calling it more than once is safe.
 */
export function suppressScrollWhileLifted(isLifted: () => boolean): () => void {
  if (typeof document === "undefined") return () => undefined;

  const onTouchMove = (event: TouchEvent): void => {
    // Per event, deliberately: between pointerdown and the lift this costs one
    // predicate and lets the page scroll exactly as it should.
    if (!isLifted()) return;
    // A listener the browser treated as passive cannot cancel, and calling
    // preventDefault() there only logs. Guarding keeps the caller's
    // expectation and the browser's behaviour from silently diverging.
    if (event.cancelable) event.preventDefault();
  };

  document.addEventListener("touchmove", onTouchMove, { passive: false });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener("touchmove", onTouchMove);
  };
}

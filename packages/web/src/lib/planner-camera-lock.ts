// ---------------------------------------------------------------------------
// Who owns the pointer: the camera, or the thing under the finger.
//
// On desktop the question never arises — OrbitControls' LEFT button is set to
// -1 and left-drag belongs to selection, so the two gestures use different
// inputs and cannot collide. Touch has no second button. One finger has to
// mean "orbit the room" on empty floor and "move this table" on a table, and
// that is decided per press, from a raycast, inside SelectionSystem.
//
// OrbitControls and SelectionSystem both listen on the same canvas element, so
// listener order between them is not something either can rely on: at the
// event target, capture and bubble listeners alike run in registration order.
// This lock therefore does not try to win that race. It does not need to.
// OrbitControls' pointerdown only RECORDS a start position; nothing rotates
// until a pointermove arrives, and every one of its handlers returns early
// while `enabled` is false. Disabling it during the same pointerdown — before
// or after its own handler ran — means the camera never moves.
//
// The lock is a counter rather than a boolean because a gesture can be closed
// from several directions at once (pointerup, pointercancel, lostpointercapture,
// a second finger, unmount, a tool taking over), and two overlapping releases
// must not hand the camera back while a drag is still live.
// ---------------------------------------------------------------------------

let holders = 0;
const listeners = new Set<() => void>();

function notify(): void {
  // Copy first: a listener that unsubscribes itself must not disturb the walk.
  for (const listener of [...listeners]) listener();
}

/**
 * Take the pointer away from the camera for the duration of one object drag.
 * Returns the release. Calling it twice releases once, so a handler wired to
 * both pointerup and lostpointercapture is safe.
 */
export function lockPlannerCamera(): () => void {
  holders += 1;
  if (holders === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) notify();
  };
}

/** True while an object drag owns the pointer and the camera must stay put. */
export function plannerCameraLocked(): boolean {
  return holders > 0;
}

/** Fires on every transition into and out of the locked state. */
export function subscribePlannerCameraLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Drop every hold. Teardown only: a planner that unmounts mid-drag would
 * otherwise leave the next one unable to orbit, and module state outlives the
 * component tree after a route change as surely as it does between tests.
 */
export function resetPlannerCameraLock(): void {
  if (holders === 0) return;
  holders = 0;
  notify();
}

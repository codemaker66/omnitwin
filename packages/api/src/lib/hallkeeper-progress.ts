// ---------------------------------------------------------------------------
// hallkeeper-progress — pure mutation resolution for the progress endpoint.
//
// PATCH /hallkeeper/:configId/progress accepts an optional `checked` flag:
//   - present  → idempotent SET-STATE (force the row to the desired state)
//   - absent   → legacy TOGGLE (flip current state)
//
// Keeping this pure makes the insert/delete/noop decision unit-testable
// without a database, and lets the offline replay queue converge safely:
// re-issuing a set-state PATCH is idempotent, so a lost response or a
// concurrent device can't flip the row to the wrong value. The legacy
// toggle path stays so older clients (and the no-`checked` body) keep
// working unchanged.
// ---------------------------------------------------------------------------

export type ProgressMutation = "insert" | "delete" | "noop";

/**
 * Resolve the storage mutation for a progress PATCH.
 *
 * @param existing whether a checked row already exists on the server
 * @param desired  the requested state, or `undefined` for a legacy toggle
 */
export function resolveProgressMutation(
  existing: boolean,
  desired: boolean | undefined,
): ProgressMutation {
  // Legacy toggle — no desired state supplied, so flip current state.
  if (desired === undefined) return existing ? "delete" : "insert";
  // Idempotent set-state — only mutate when the server differs.
  if (desired === existing) return "noop";
  return desired ? "insert" : "delete";
}

/** The checked state that results from applying a resolved mutation. */
export function checkedStateAfter(mutation: ProgressMutation, existing: boolean): boolean {
  switch (mutation) {
    case "insert":
      return true;
    case "delete":
      return false;
    case "noop":
      return existing;
  }
}

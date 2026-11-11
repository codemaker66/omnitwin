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

/**
 * The event a sheet's ticks belong to, or null for the layout's own,
 * eventless ticks.
 *
 * A layout can be reused across events, so a tick belongs to the event the
 * room was set for, not to the layout: keyed on the layout alone, a reused
 * layout opened with the last event's ticks and the Day Board counted them
 * as tonight's.
 *
 * The event the hallkeeper arrived from (?eventId=) decides when the layout
 * serves it: linked, a live variant, or the latest frozen phase plan in the
 * layout's room, which is how the Day Board offers a layout with no link row
 * (`linkedEventIds`). Any other id (a stale bookmark, a hand-edited link,
 * another event of the venue or another venue's) is ignored, exactly as the
 * sheet's times ignore it (`resolveTiming`), so ticks and times always name
 * the same event (T-695 api-eventday-sheet-6). With no event named, the
 * layout's only event; otherwise none. Ticks stored before events were
 * recorded carry none, so they are never counted towards any event.
 */
export function progressEventFor(input: {
  /** The events the layout serves (hallkeeper-sheet-v2-data.ts linkedEventIds). */
  readonly linkedEventIds: readonly string[];
  readonly requestedEventId: string | null;
}): string | null {
  const { linkedEventIds, requestedEventId } = input;
  if (requestedEventId !== null && linkedEventIds.includes(requestedEventId)) return requestedEventId;
  return linkedEventIds.length === 1 ? linkedEventIds[0] ?? null : null;
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

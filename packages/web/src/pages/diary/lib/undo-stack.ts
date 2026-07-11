// ---------------------------------------------------------------------------
// Undo stack (T-493; Canon §8 "undo-toast over confirm dialogs").
//
// Pure move history. Undo means PATCHing a booking back to its previous
// slot — there is no server-side undo, so this is honest client bookkeeping.
// Caveat (documented in the slice report): undoing after someone else moved
// the same booking re-applies this client's previous values; the Board
// refetches after every mutation so the surface stays truthful.
// ---------------------------------------------------------------------------

export interface MoveSnapshot {
  readonly spaceId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface UndoEntry {
  readonly bookingId: string;
  readonly title: string;
  readonly before: MoveSnapshot;
  readonly after: MoveSnapshot;
  readonly atMs: number;
}

export const UNDO_STACK_LIMIT = 20;

/**
 * Compare-and-delete for optimistic overrides (review P1): a failed PATCH may
 * only roll back the exact override IT wrote. If the user has already moved
 * the same booking again (a newer override object sits under the key), the
 * older failure must not clobber the newer intent.
 */
export function rollbackOverride<T>(
  overrides: ReadonlyMap<string, T>,
  bookingId: string,
  expected: T,
): ReadonlyMap<string, T> {
  if (overrides.get(bookingId) !== expected) return overrides;
  const next = new Map(overrides);
  next.delete(bookingId);
  return next;
}

export function pushMove(
  stack: readonly UndoEntry[],
  entry: UndoEntry,
  limit: number = UNDO_STACK_LIMIT,
): readonly UndoEntry[] {
  const next = [...stack, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popMove(stack: readonly UndoEntry[]): {
  readonly entry: UndoEntry | null;
  readonly stack: readonly UndoEntry[];
} {
  if (stack.length === 0) return { entry: null, stack };
  return { entry: stack[stack.length - 1] ?? null, stack: stack.slice(0, -1) };
}

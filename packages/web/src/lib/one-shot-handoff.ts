// ---------------------------------------------------------------------------
// One-shot handoff — a response one step of a flow already fetched, passed to
// the step that would otherwise request the same thing again straight away.
//
// Deliberately narrower than a cache: one entry, matched by an exact key, and
// the very next take() consumes it whether or not it matches. An entry older
// than maxAgeMs is discarded, so a later, unrelated request never reuses it.
// ---------------------------------------------------------------------------

export interface OneShotHandoff<T> {
  readonly offer: (key: string, value: T) => void;
  /** The value offered under `key` within the age limit, else null. Always empties the slot. */
  readonly take: (key: string) => T | null;
  readonly clear: () => void;
}

export function createOneShotHandoff<T>(maxAgeMs: number, now: () => number = () => Date.now()): OneShotHandoff<T> {
  let entry: { readonly key: string; readonly value: T; readonly offeredAt: number } | null = null;
  return {
    offer: (key, value) => {
      entry = { key, value, offeredAt: now() };
    },
    take: (key) => {
      const current = entry;
      entry = null;
      if (current === null || current.key !== key || now() - current.offeredAt > maxAgeMs) return null;
      return current.value;
    },
    clear: () => {
      entry = null;
    },
  };
}

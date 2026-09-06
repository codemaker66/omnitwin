// -----------------------------------------------------------------------------
// roving-tabindex — the "In the room" group is one Tab stop.
//
// A toolbar of pokeables must not cost the keyboard reader eight Tab presses
// to get past the river. The WAI-ARIA toolbar pattern: one button carries
// tabindex 0, the rest -1, and Left/Right/Home/End move the one. This is the
// pure key map; the toolbar owns the index and the focus() calls.
// -----------------------------------------------------------------------------

export const ROVING_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"] as const;
export type RovingKey = (typeof ROVING_KEYS)[number];

export function isRovingKey(key: string): key is RovingKey {
  return (ROVING_KEYS as readonly string[]).includes(key);
}

/**
 * The index the key moves to, or null when the key is not the toolbar's.
 * Arrows wrap, as the pattern recommends for a toolbar whose ends are not
 * meaningful; Home and End are absolute. An empty group has nowhere to go.
 */
export function nextRovingIndex(key: string, current: number, count: number): number | null {
  if (count <= 0 || !isRovingKey(key)) return null;
  const index = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "ArrowRight":
      return (index + 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }
}

/** The tabIndex a button carries: 0 for the one live stop, -1 for the rest. */
export function rovingTabIndex(index: number, active: number): 0 | -1 {
  return index === active ? 0 : -1;
}

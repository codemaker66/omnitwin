import { useLayoutEffect, type RefObject } from "react";

// ---------------------------------------------------------------------------
// The keyboard, handed on
//
// Parts of the screen leave the page while the keyboard is in them: a sheet
// shut by its own Close, the chosen piece's verbs once the piece is put back,
// the first screen once it is put aside, a receipt once its Undo is pressed.
// A browser then leaves the keyboard on the bare page: the next Tab starts
// again from the top, and a screen reader loses its place. So each such part
// says where the keyboard goes instead, best place first. It goes to the
// first place that can take it: never to the bare page.
// ---------------------------------------------------------------------------

/**
 * Whether a key is on the page to take the keyboard: there, not put away, not
 * off, and laid out. (The phone's top bar shows only the current step, and the
 * primary key stands aside while its own sheet is open.) A page with no layout
 * at all, a test's, lays nothing out: there, being on the page is all there is
 * to ask.
 */
export function canTakeFocus(key: HTMLElement | null): key is HTMLElement {
  if (key === null || !key.isConnected || key.hidden || (key instanceof HTMLButtonElement && key.disabled)) return false;
  if (typeof key.checkVisibility === "function") return key.checkVisibility();
  return key.getClientRects().length > 0 || document.documentElement.getClientRects().length === 0;
}

/** How many hand-offs have been asked for: one still waiting gives way to a later one. */
let asked = 0;

/**
 * Gives the keyboard to the first of these places that can take it. Asked as a
 * part leaves, and done once the screen has settled: a place may only then be
 * back on the page (the cards, behind the verbs) or back in sight (the primary
 * key, aside while its own sheet was open). And only where the keyboard has
 * been left nowhere: not where the part is still up, nor where something else
 * has taken the keyboard meanwhile (a sheet, opening, takes it to its title).
 *
 * Where a second part leaves with the keyboard in it before the first one's
 * turn has come (the first screen's answer opens a sheet, and the sheet is
 * shut at once), the keyboard was somewhere in between, and where it goes now
 * is the second part's to say: the first gives way.
 */
export function handKeyboardOn(places: () => readonly (HTMLElement | null)[]): void {
  asked += 1;
  const mine = asked;
  queueMicrotask(() => {
    if (mine !== asked) return;
    const now = document.activeElement;
    if (now instanceof HTMLElement && now !== document.body && now.isConnected) return;
    places().find(canTakeFocus)?.focus({ preventScroll: true });
  });
}

/**
 * The screen a part stands on, where the keyboard is in that part now; null
 * where it is not. Asked as the part leaves, while it is still on the page.
 */
export function screenWithKeyboardIn(part: HTMLElement): HTMLElement | null {
  return part.contains(document.activeElement) ? part.closest<HTMLElement>(".hud-root") : null;
}

/** Where the keyboard goes when a part leaves with the keyboard in it: places on its screen, best first. */
export type KeyboardPlaces = (screen: HTMLElement) => readonly (HTMLElement | null)[];

/**
 * A part of the screen that can leave with the keyboard in it hands the
 * keyboard on as it goes, to the first of `places` that can take it. However
 * it leaves: its own key pressed, Escape, or a planner key from anywhere.
 * `places` is one function for the part's life: say it outside the component.
 */
export function useKeyboardHandOff(part: RefObject<HTMLElement | null>, places: KeyboardPlaces): void {
  useLayoutEffect(() => {
    const leaving = part.current;
    if (leaving === null) return undefined;
    return () => {
      // Read before the part leaves the page: this runs while it is still on it.
      const screen = screenWithKeyboardIn(leaving);
      if (screen !== null) handKeyboardOn(() => places(screen));
    };
  }, [part, places]);
}

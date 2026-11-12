import { create } from "zustand";
import { closeOpenLayers, lastInputWasKeys } from "../lib/planner-keys.js";

// ---------------------------------------------------------------------------
// Chrome the person folds away (T-680). Blake, 28 Oct 2026: "The UI elements,
// I want to be able to minimise them for cleaner design."
//
// Each of the v1 planner's four chrome units folds on its own to a spine at
// its edge, and this device remembers it. One clear-all hides every unit and
// leaves only the crest; it lasts only as long as the page, so nobody comes
// back to a bare screen. Only the person's own actions write here: Present,
// the Grand Assembly and the selection never do.
// ---------------------------------------------------------------------------

export type ChromeFoldUnit = "left" | "right" | "top" | "bottom";
export type ChromeFolds = Readonly<Record<ChromeFoldUnit, boolean>>;

export const CHROME_FOLD_UNITS: readonly ChromeFoldUnit[] = ["left", "right", "top", "bottom"];
export const CHROME_FOLDS_STORAGE_KEY = "venviewer.planner-chrome-folds";
/** How many times a device is told how to bring cleared chrome back. */
export const CLEAR_HINT_LIMIT = 3;

/** How long chrome takes to arrive or leave (--house-motion-deliberate, the longer of the two). */
export const CHROME_SETTLE_MS = 240;

/** The attribute on <html> that says how one unit stands ("folded", or "unfolding" for one settle). */
export function chromeFoldAttribute(unit: ChromeFoldUnit): string {
  return `data-planner-fold-${unit}`;
}

/** The attribute on <html> that says the chrome is "cleared" (or "restoring" for one settle). */
export const CHROME_CLEARED_ATTRIBUTE = "data-planner-chrome";

/** Every attribute the cockpit mirrors this state onto <html> as; whatever lays itself out around the chrome watches them. */
export const CHROME_PRESENCE_ATTRIBUTES: readonly string[] = [...CHROME_FOLD_UNITS.map(chromeFoldAttribute), CHROME_CLEARED_ATTRIBUTE];

const ALL_OPEN: ChromeFolds = { left: false, right: false, top: false, bottom: false };

interface Remembered {
  readonly folds: ChromeFolds;
  readonly hints: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** This device's folds; anything it cannot read means everything open. */
export function readRememberedFolds(storage: Pick<Storage, "getItem"> | null): Remembered {
  const nothing: Remembered = { folds: ALL_OPEN, hints: 0 };
  if (storage === null) return nothing;
  try {
    const raw = storage.getItem(CHROME_FOLDS_STORAGE_KEY);
    if (raw === null) return nothing;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.folded)) return nothing;
    const folded = parsed.folded;
    if (!CHROME_FOLD_UNITS.every((unit) => typeof folded[unit] === "boolean")) return nothing;
    const hints = typeof parsed.hints === "number" && Number.isInteger(parsed.hints) && parsed.hints >= 0
      ? Math.min(parsed.hints, CLEAR_HINT_LIMIT)
      : 0;
    return {
      folds: { left: folded.left === true, right: folded.right === true, top: folded.top === true, bottom: folded.bottom === true },
      hints,
    };
  } catch {
    return nothing;
  }
}

function deviceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function remember(folds: ChromeFolds, hints: number): void {
  try {
    deviceStorage()?.setItem(CHROME_FOLDS_STORAGE_KEY, JSON.stringify({ v: 1, folded: folds, hints }));
  } catch { /* a convenience only: the page works without it */ }
}

export interface ChromePresenceState {
  readonly folded: ChromeFolds;
  readonly cleared: boolean;
  /** The last change came from the keyboard, so it shows at once (spec 8). */
  readonly instant: boolean;
  /** The clear-all note is due now. */
  readonly hintPending: boolean;
  /** How many times this device has been told how to bring the tools back. */
  readonly hintsShown: number;
  readonly fold: (unit: ChromeFoldUnit) => void;
  readonly unfold: (unit: ChromeFoldUnit) => void;
  readonly toggleFold: (unit: ChromeFoldUnit) => void;
  readonly clearAll: () => void;
  readonly restoreAll: () => void;
  readonly toggleCleared: () => void;
  readonly dismissHint: () => void;
  /** The cockpit is going: clearing lasts only as long as it does. */
  readonly resetCleared: () => void;
}

const initial = readRememberedFolds(deviceStorage());

export const useChromePresenceStore = create<ChromePresenceState>()((set, get) => {
  const setFold = (unit: ChromeFoldUnit, folded: boolean): void => {
    const state = get();
    if (state.folded[unit] === folded) return;
    // A fold closes nothing: a menu inside the unit goes and comes back with
    // it, and the catalogue or a note beside it is not the unit's to close.
    const next: ChromeFolds = { ...state.folded, [unit]: folded };
    set({ folded: next, instant: lastInputWasKeys() });
    remember(next, state.hintsShown);
  };
  return {
    folded: initial.folds,
    cleared: false,
    instant: false,
    hintPending: false,
    hintsShown: initial.hints,
    fold: (unit) => { setFold(unit, true); },
    unfold: (unit) => { setFold(unit, false); },
    toggleFold: (unit) => { setFold(unit, !get().folded[unit]); },
    clearAll: () => {
      const state = get();
      if (state.cleared) return;
      // An Esc on a bare screen must never close something nobody can see.
      closeOpenLayers(["popover", "panel"]);
      const due = state.hintsShown < CLEAR_HINT_LIMIT;
      const hintsShown = due ? state.hintsShown + 1 : state.hintsShown;
      set({ cleared: true, instant: lastInputWasKeys(), hintPending: due, hintsShown });
      if (due) remember(state.folded, hintsShown);
    },
    restoreAll: () => {
      if (!get().cleared) return;
      set({ cleared: false, instant: lastInputWasKeys(), hintPending: false });
    },
    toggleCleared: () => {
      if (get().cleared) get().restoreAll();
      else get().clearAll();
    },
    dismissHint: () => { set({ hintPending: false }); },
    resetCleared: () => { set({ cleared: false, hintPending: false, instant: true }); },
  };
});

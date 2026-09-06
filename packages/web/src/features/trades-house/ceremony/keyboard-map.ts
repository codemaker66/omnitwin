// -----------------------------------------------------------------------------
// keyboard-map — one pure function from a keydown to what it means.
//
// Spec section 5: Enter or Space is the tap (phone: the first opens the held
// card, the second commits); arrows move between options; Escape closes the
// held card; the "In the room" group is one Tab stop with Left, Right, Home
// and End inside it; M mutes; C toggles captions. The components ask this
// table and act; the table never touches the DOM, so every row is a unit test.
// -----------------------------------------------------------------------------
import type { CeremonyPhase } from "./ceremony-types.js";

export type KeyIntent =
  | "press"
  | "open"
  | "commit"
  | "release"
  | "next"
  | "prev"
  | "first"
  | "last"
  | "mute"
  | "captions"
  | "continue";

export type FocusRegion = "options" | "held" | "room" | "continue";

export interface KeyContext {
  readonly phase: CeremonyPhase;
  readonly isPhone: boolean;
  readonly focusIn: FocusRegion;
  /** True when Ctrl, Meta or Alt is held: a shortcut chord is never ours (Ctrl+C is copy). */
  readonly modified?: boolean;
}

function isTapKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

function navigationIntent(key: string): KeyIntent | null {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    case "ArrowUp":
    case "ArrowLeft":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * The intent of a keydown, or null when the key means nothing here. The
 * letters are global (any region, any phase) but yield to modifier chords;
 * everything else depends on where focus is and which phase the scene is in.
 */
export function keyToIntent(key: string, ctx: KeyContext): KeyIntent | null {
  if (ctx.modified === true) return null;
  if (key === "m" || key === "M") return "mute";
  if (key === "c" || key === "C") return "captions";

  switch (ctx.focusIn) {
    case "options": {
      if (ctx.phase === "held") return key === "Escape" ? "release" : null;
      if (ctx.phase === "open") {
        if (isTapKey(key)) return ctx.isPhone ? "open" : "commit";
        return navigationIntent(key);
      }
      // Speaking: the options are inert but the reader may still look along
      // them. Committed and after: the only live control is Continue.
      if (ctx.phase === "speaking") return navigationIntent(key);
      return null;
    }
    case "held": {
      if (ctx.phase !== "held") return null;
      if (isTapKey(key)) return "commit";
      if (key === "Escape") return "release";
      return null;
    }
    case "room": {
      // A poke is a press; the group is one Tab stop with a roving index.
      if (isTapKey(key)) return "press";
      return navigationIntent(key);
    }
    case "continue": {
      return isTapKey(key) ? "continue" : null;
    }
  }
}

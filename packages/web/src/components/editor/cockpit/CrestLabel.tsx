import { useEffect, useState, type FocusEvent, type PointerEvent, type ReactElement } from "react";
import { useEscapeLayer } from "../../../lib/planner-keys.js";
import { useChromePresenceStore } from "../../../stores/chrome-presence-store.js";

// ---------------------------------------------------------------------------
// The crest's name, under it, while the hand rests on the crest or the
// keyboard is on it (T-680). WCAG 1.4.13: the pointer can move onto the name
// without it going, and Esc puts it away without moving either, as the
// tooltip rung at the top of the planner's Escape ladder. While the first-use
// note is saying the same thing beside the crest, the name waits.
// ---------------------------------------------------------------------------

/** How long the hand rests on the crest before its name shows. */
export const CREST_LABEL_DELAY_MS = 400;

interface CrestLabelHandlers {
  readonly onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: () => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: () => void;
}

/** Whether focus came by the keyboard: a click's focus shows no name. */
function focusIsVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

let quietFocus = false;

/**
 * Puts focus on the crest without its name, when the chrome moves focus there
 * itself: the person has just pressed the key the name would teach, and their
 * next Esc should bring the tools back, not put a name away.
 */
export function focusCrestQuietly(crest: HTMLElement): void {
  quietFocus = true;
  try {
    crest.focus({ preventScroll: true });
  } finally {
    quietFocus = false;
  }
}

/** Whether the crest's name shows, and the handlers that show it; spread them on the crest. */
export function useCrestLabel(): { readonly shown: boolean; readonly handlers: CrestLabelHandlers } {
  const [pointerIn, setPointerIn] = useState(false);
  const [rested, setRested] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const noteShowing = useChromePresenceStore((state) => state.hintPending);
  // Pressed (or \ while the hand or the keyboard is on it), the crest has
  // answered its name: it stays away until both have left, so the next Esc
  // brings the tools back instead of putting a name away.
  const cleared = useChromePresenceStore((state) => state.cleared);
  const [answered, setAnswered] = useState(cleared);
  if (answered !== cleared) {
    setAnswered(cleared);
    if (pointerIn || focused) setDismissed(true);
  }
  useEffect(() => {
    if (!pointerIn) return undefined;
    const timer = window.setTimeout(() => { setRested(true); }, CREST_LABEL_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      setRested(false);
    };
  }, [pointerIn]);
  const shown = ((pointerIn && rested) || focused) && !dismissed && !noteShowing;
  useEscapeLayer("tooltip", { open: shown, onEscape: () => { setDismissed(true); } });
  return {
    shown,
    handlers: {
      onPointerEnter: (event) => { if (event.pointerType === "mouse") setPointerIn(true); },
      // Put away with Esc, it stays away until the hand and the keyboard have both left.
      onPointerLeave: () => {
        setPointerIn(false);
        if (!focused) setDismissed(false);
      },
      onFocus: (event) => { setFocused(!quietFocus && focusIsVisible(event.currentTarget)); },
      onBlur: () => {
        setFocused(false);
        if (!pointerIn) setDismissed(false);
      },
    },
  };
}

/** The name itself, inside the crest so the hand can rest on it; a clear band joins the two. */
export function CrestLabel({ text, shown }: { readonly text: string; readonly shown: boolean }): ReactElement {
  return (
    <span className="reference-crest__label" data-shown={shown ? "true" : "false"} aria-hidden="true">
      <span className="reference-crest__label-text">{text}</span>
    </span>
  );
}

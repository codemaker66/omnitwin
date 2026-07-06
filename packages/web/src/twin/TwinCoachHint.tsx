import { useEffect, useState, type ReactElement } from "react";
import { TWIN_COACH_HINT } from "./twin-copy.js";
import { prefersReducedMotion } from "./reduced-motion.js";

// -----------------------------------------------------------------------------
// TwinCoachHint — the one-time "how to move" nudge (finding [3]).
//
// New visitors have no way to know the walk responds to a click, a look-drag,
// or WASD until they try — so a quiet pill names the three gestures, then bows
// out the instant the visitor does any of them (or after a few seconds). It is
// a passive affordance: pointer-events stay off, so the very click that
// dismisses it also travels. A localStorage latch means it greets each person
// once, never again; a browser that forbids storage (private mode) simply shows
// it each visit, which is harmless. aria-hidden — screen-reader users navigate
// by the application role and arrow-key travel, not these pointer gestures.
// -----------------------------------------------------------------------------

const COACH_SEEN_KEY = "vv-twin-coach-seen";
/** Auto-dismiss if the visitor just watches without touching anything. */
const COACH_AUTO_DISMISS_MS = 8000;
/** Matches the CSS fade-out so the node unmounts only once it has played. */
const COACH_FADE_MS = 500;

function coachSeen(): boolean {
  try {
    return window.localStorage.getItem(COACH_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markCoachSeen(): void {
  try {
    window.localStorage.setItem(COACH_SEEN_KEY, "1");
  } catch {
    // Private mode / storage disabled: the hint reappears next visit. Harmless.
  }
}

type CoachPhase = "hidden" | "shown" | "leaving";

export function TwinCoachHint(): ReactElement | null {
  const [phase, setPhase] = useState<CoachPhase>("hidden");

  // First run only: appear, latch "seen" immediately (so a reload can't re-nag),
  // and arm both the idle auto-dismiss and a dismiss-on-first-interaction.
  useEffect(() => {
    if (coachSeen()) {
      return;
    }
    setPhase("shown");
    markCoachSeen();

    const leave = (): void => {
      setPhase((current) => (current === "shown" ? "leaving" : current));
    };
    const autoDismiss = window.setTimeout(leave, COACH_AUTO_DISMISS_MS);
    window.addEventListener("pointerdown", leave);
    window.addEventListener("keydown", leave);
    return () => {
      window.clearTimeout(autoDismiss);
      window.removeEventListener("pointerdown", leave);
      window.removeEventListener("keydown", leave);
    };
  }, []);

  // Leaving → gone once the fade has played (immediately under reduced motion).
  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const fade = window.setTimeout(
      () => { setPhase("hidden"); },
      prefersReducedMotion() ? 0 : COACH_FADE_MS,
    );
    return () => { window.clearTimeout(fade); };
  }, [phase]);

  if (phase === "hidden") {
    return null;
  }
  return (
    <div
      className={phase === "leaving" ? "vv-twin-coach vv-twin-coach--out" : "vv-twin-coach"}
      aria-hidden
      data-testid="twin-coach"
    >
      {TWIN_COACH_HINT}
    </div>
  );
}

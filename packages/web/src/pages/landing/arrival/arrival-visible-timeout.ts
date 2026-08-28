// -----------------------------------------------------------------------------
// arrival-visible-timeout — a timeout that only counts time the page was
// actually VISIBLE.
//
// WHY THIS EXISTS, AND WHY A PLAIN setTimeout WAS THE WRONG INSTRUMENT.
// GoogleTilesStage's stall watchdog is a dead-man's switch: it fires unless
// re-armed by evidence that Google's tiles delivered bytes (`load-tileset`,
// `load-model` — see arrival-config.ts for the arithmetic). Those events can
// only ever arrive as a CONSEQUENCE of `tiles.update()`, and `tiles.update()`
// runs from useArrivalFrame — i.e. from @react-three/fiber's
// requestAnimationFrame loop.
//
// Browsers do not run requestAnimationFrame in a background tab. Chromium
// stops servicing rAF for a hidden page entirely (it is not throttled to a
// slower rate — it stops), and Firefox and WebKit do the same. setTimeout, by
// contrast, keeps running: it is merely clamped (Chromium: ≥1 s per timer in a
// hidden page, and after ~5 minutes hidden it enters intensive throttling at
// ≥1 min). So the OLD watchdog measured wall-clock silence against evidence
// that structurally cannot be produced while the tab is hidden.
//
// The visitor this broke is not exotic. Middle-clicking a link, ⌘/Ctrl-click,
// "Open link in new tab" — every one of those loads the homepage in a
// BACKGROUND tab. The page loads, React mounts, the tiles stage mounts and
// arms the watchdog, and then nothing renders because nothing is visible. Two
// minutes later (ARRIVAL_TILES_FIRST_CONTACT_MS) the watchdog fires
// fail("tiles") into a store whose connection is perfectly healthy; when the
// visitor finally switches to the tab they get the permanent fallback and a
// console line blaming a captive portal. The people the watchdog exists to
// diagnose are, once again, not the people it was hitting.
//
// THE FIX IS TO MEASURE THE THING THE WATCHDOG MEANS TO MEASURE. The budget is
// "how long has this hero been able to make progress and failed to", so time
// the page spent hidden must not be spent from it. This helper holds the
// remaining budget, runs a real timer only while `document.visibilityState`
// is "visible", and banks the elapsed visible time whenever the page hides.
// A tab opened in the background therefore starts with its clock STOPPED and
// does not begin spending until the visitor actually looks at it.
//
// WHAT THIS DELIBERATELY DOES NOT TRY TO BE. Page Visibility does not know
// about a visible-but-fully-occluded window, and a browser may throttle rAF
// for reasons of its own (a hidden `<canvas>`, an inactive display, power
// saving). Those leave the same gap in miniature. They are accepted rather
// than chased: the failure they produce is a watchdog that fires early, whose
// cost — spec §6 — is that the photograph carries the page, which is what the
// visitor was already looking at. Visibility is the one case that is both
// COMMON and TOTAL (rAF stops completely, for minutes at a time), which is why
// it is the one this file handles.
// -----------------------------------------------------------------------------

/** A running visible-time timeout. `cancel()` is idempotent and final. */
export interface VisibleTimeout {
  readonly cancel: () => void;
}

/** True only for a page the visitor could actually be looking at. Anything
 *  that is not literally "visible" (today: "hidden", and historically
 *  "prerender") counts as not-visible, so a new state added to the spec fails
 *  in the safe direction — the clock stops rather than running unwatched. */
function pageIsVisible(): boolean {
  return document.visibilityState === "visible";
}

/**
 * Runs `onElapsed` once `budgetMs` milliseconds of VISIBLE time have passed.
 *
 * Time spent with the page hidden does not count. The callback fires at most
 * once, and never after `cancel()`.
 *
 * `performance.now()` rather than `Date.now()`: the budgets this serves are
 * minutes long (ARRIVAL_TILES_STALL_MS is fifteen), which is exactly the
 * timescale over which an NTP correction or a laptop waking from sleep can
 * move the wall clock. A monotonic clock cannot be moved.
 */
export function startVisibleTimeout(budgetMs: number, onElapsed: () => void): VisibleTimeout {
  let remainingMs = Math.max(0, budgetMs);
  /** When the currently-running timer started, on the monotonic clock, or
   *  null when the clock is stopped (page hidden, fired, or cancelled). */
  let runningSinceMs: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const stopCounting = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (runningSinceMs !== null) {
      remainingMs = Math.max(0, remainingMs - (performance.now() - runningSinceMs));
      runningSinceMs = null;
    }
  };

  const fire = (): void => {
    timer = null;
    runningSinceMs = null;
    remainingMs = 0;
    finished = true;
    // Detached BEFORE the callback: onElapsed is the watchdog's terminal
    // failure path, and a listener still bound to a dead timeout is exactly
    // the "live timer running past the failure it was watching for" shape
    // GoogleTilesStage's own `terminal` flag exists to prevent.
    document.removeEventListener("visibilitychange", onVisibilityChange);
    onElapsed();
  };

  const startCounting = (): void => {
    if (finished || timer !== null || !pageIsVisible()) {
      return;
    }
    runningSinceMs = performance.now();
    timer = setTimeout(fire, remainingMs);
  };

  function onVisibilityChange(): void {
    if (pageIsVisible()) {
      startCounting();
    } else {
      stopCounting();
    }
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  // Nothing starts here if the page is already hidden — the tab-opened-in-the
  // background case, which is the whole point.
  startCounting();

  return {
    cancel: (): void => {
      if (finished) {
        return;
      }
      finished = true;
      stopCounting();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

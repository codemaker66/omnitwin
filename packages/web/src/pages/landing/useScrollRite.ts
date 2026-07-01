import { useEffect, useRef, useState, type RefObject } from "react";
import { riteProgress, type RiteAct } from "./rite-motion.js";

// -----------------------------------------------------------------------------
// useScrollRite — maps live scroll to the dramaturgy.
//
// One passive scroll listener + one rAF write per scrolled frame. Continuous
// values (`--rite-overall`, `--rite-act-progress`) go straight to the root
// element's style so nothing re-renders during scroll; the only React state
// is the discrete current act (nav reveal, skip affordance, aria bookkeeping)
// which changes a handful of times per visit.
//
// Per-element choreography does NOT live here: scroll-scrubbed effects use
// CSS scroll-timelines with an IntersectionObserver `.is-seen` fallback in
// the act components. This hook is only the page-level conductor.
// -----------------------------------------------------------------------------

export const RITE_ENTERED_KEY = "vv-rite-entered";

export function hasEnteredBefore(): boolean {
  try {
    return window.sessionStorage.getItem(RITE_ENTERED_KEY) === "1";
  } catch {
    return false; // storage blocked → treat every visit as the first
  }
}

export function markEntered(): void {
  try {
    window.sessionStorage.setItem(RITE_ENTERED_KEY, "1");
  } catch {
    // Storage blocked — the threshold simply plays again next visit.
  }
}

export interface ScrollRite {
  /** Discrete current act — drives nav reveal and the skip affordance. */
  readonly act: RiteAct;
  /** Chapter index 0..3 while in contemplation, else null. */
  readonly chapterIndex: number | null;
}

export function useScrollRite(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): ScrollRite {
  const [act, setAct] = useState<RiteAct>("threshold");
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const rafPending = useRef<boolean>(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || root === null) {
      return;
    }

    const apply = (): void => {
      rafPending.current = false;
      const viewportH = window.innerHeight;
      if (viewportH <= 0) {
        return;
      }
      const progress = riteProgress(window.scrollY, viewportH);
      root.style.setProperty("--rite-overall", progress.overall.toFixed(4));
      root.style.setProperty(
        "--rite-act-progress",
        progress.actProgress.toFixed(4),
      );
      root.dataset["riteAct"] = progress.act;
      setAct(progress.act);
      setChapterIndex(progress.chapterIndex);
      if (progress.act !== "threshold") {
        markEntered();
      }
    };

    const onScroll = (): void => {
      if (!rafPending.current) {
        rafPending.current = true;
        window.requestAnimationFrame(apply);
      }
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rootRef, enabled]);

  return { act, chapterIndex };
}

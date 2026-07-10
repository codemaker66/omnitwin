import { useEffect, useRef, type MutableRefObject } from "react";

// -----------------------------------------------------------------------------
// useSectionScrollProgress — scroll progress [0..1] through one document
// section, by element id. Same contract as useLivingHallScroll: native
// scroll only, passive + rAF-coalesced, ref-based so per-frame consumers
// (the ink) read it without React re-renders. The range runs from "section
// top enters the viewport bottom" to "section bottom clears half the
// viewport" — the act plays while its panel is the one on stage.
// -----------------------------------------------------------------------------

export function useSectionScrollProgress(
  sectionId: string,
  onChange?: (progress: number) => void,
): MutableRefObject<number> {
  const progressRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let rafId: number | null = null;
    let sectionTop = 0;
    let sectionHeight = 0;

    const measureSection = (): void => {
      const el = document.getElementById(sectionId);
      if (el === null) {
        sectionHeight = 0;
        return;
      }
      const rect = el.getBoundingClientRect();
      sectionTop = rect.top + window.scrollY;
      sectionHeight = rect.height;
    };

    const update = (): void => {
      rafId = null;
      if (sectionHeight <= 0) measureSection();
      if (sectionHeight <= 0) return;
      const vh = window.innerHeight;
      const start = sectionTop - vh;
      const end = sectionTop + sectionHeight - vh * 0.5;
      const span = Math.max(1, end - start);
      const next = Math.min(1, Math.max(0, (window.scrollY - start) / span));
      if (next !== progressRef.current) {
        progressRef.current = next;
        onChangeRef.current?.(next);
      }
    };

    const schedule = (): void => {
      rafId ??= window.requestAnimationFrame(update);
    };
    const remeasure = (): void => {
      measureSection();
      schedule();
    };

    measureSection();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [sectionId]);

  return progressRef;
}

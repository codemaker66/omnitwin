import { useEffect, useRef, type MutableRefObject } from "react";

// -----------------------------------------------------------------------------
// useLivingHallScroll — native document scroll → overall progress [0..1].
//
// The document drives the scene, never the reverse: no wheel interception,
// no virtual scroll, no preventDefault — keyboard paging, space, and the real
// scrollbar all keep working (a P0 accessibility commitment). Progress is
// written to a ref (not state) so the camera can read it per-frame without
// re-rendering React. The listener is passive and rAF-coalesced; `onChange`
// fires at most once per frame so a demand-frameloop canvas can invalidate.
// -----------------------------------------------------------------------------

export function useLivingHallScroll(
  onChange?: (progress: number) => void,
): MutableRefObject<number> {
  const progressRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let rafId: number | null = null;

    const measure = (): void => {
      rafId = null;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const next = scrollable <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / scrollable));
      if (next !== progressRef.current) {
        progressRef.current = next;
        onChangeRef.current?.(next);
      }
    };

    const schedule = (): void => {
      rafId ??= window.requestAnimationFrame(measure);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return progressRef;
}

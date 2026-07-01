import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * True once the element has entered the viewport (one-way latch — the rite
 * never un-reveals). Drives the `.is-seen` reveal fallback everywhere CSS
 * scroll-timelines are unavailable, and the count-up triggers.
 *
 * Environments without IntersectionObserver (happy-dom, ancient browsers)
 * are treated as "seen immediately": content first, choreography second.
 */
export function useSeen<T extends Element>(
  ref: RefObject<T | null>,
  threshold = 0.35,
): boolean {
  const [seen, setSeen] = useState<boolean>(false);
  const latchedRef = useRef<boolean>(false);

  useEffect(() => {
    if (latchedRef.current) {
      return;
    }
    const el = ref.current;
    if (el === null) {
      return;
    }
    if (typeof IntersectionObserver !== "function") {
      latchedRef.current = true;
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            latchedRef.current = true;
            setSeen(true);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, threshold]);

  return seen;
}

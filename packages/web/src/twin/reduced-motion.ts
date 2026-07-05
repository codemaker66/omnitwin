// -----------------------------------------------------------------------------
// reduced-motion — the twin's single motion-preference read.
//
// Promoted out of useTwinWalk/useDive (which carried identical private copies)
// when WalkControls' flick inertia became the third consumer. Read at event
// time, never cached: the visitor may toggle the OS setting mid-session and
// every subsequent gesture must honour it.
// -----------------------------------------------------------------------------

/** True when the visitor asks for reduced motion (cockpit pattern). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

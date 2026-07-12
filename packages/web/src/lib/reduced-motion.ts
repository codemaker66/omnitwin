/** Media-query check shared by canvas-side choreography (02 §6: reduced
 *  motion collapses eases to snaps/fades). DOM chrome uses the CSS media
 *  query directly; this helper is for imperative rAF eases. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

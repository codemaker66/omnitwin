import { useEffect } from "react";

// ---------------------------------------------------------------------------
// use-hash-target — make `#enquire` actually reach the composer (T-616).
//
// The browser resolves a URL's hash once, while the document is parsing. Every
// public page here is a lazy React chunk, so at that moment the target element
// does not exist: the browser finds nothing, gives up, and never looks again.
// A visitor following "Ask about a date" from the room walk, the not-found
// page or a shared /fresh#enquire link landed at the top of a long page with
// no sign of the form they had asked for. That is the defect plan 18 records
// as "a link to /fresh#enquire ... with no hash-scroll handling".
//
// So the page takes the second look the browser will not.
//
// Motion: this scroll is one the visitor explicitly asked for by following a
// link, so under prefers-reduced-motion it jumps rather than glides — it does
// not refuse to move, which would leave them exactly where they started.
// ---------------------------------------------------------------------------

/**
 * Scroll to the element named by the current URL hash, once, after mount.
 *
 * `deps` carries whatever must have rendered before the target exists; the
 * default runs on mount alone.
 */
export function useHashTarget(deps: readonly unknown[] = []): void {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id === "") return;
    // One frame: the target may belong to the commit that scheduled this.
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (target === null) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
    // The dependency array is the CALLER's: it names what must have rendered
    // before the target element exists. No eslint-disable here — this repo's
    // flat config does not register react-hooks/exhaustive-deps, so a disable
    // naming it is itself an error ("Definition for rule ... was not found").
  }, deps);
}

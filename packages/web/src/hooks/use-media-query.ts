import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// useMediaQuery — shared React hook around window.matchMedia.
//
// Three consumers so far: CameraRig (switches camera pose + controls on
// touch devices), VerticalToolbox (bottom rail on narrow viewports),
// EditorPage (safe-area + 100dvh decisions). Centralising the hook here
// avoids three near-identical re-implementations.
//
// SSR-safe: during server render window is undefined, so we initialise
// matches=false and let the effect take over on hydration. The R3F + Vite
// stack only runs client-side today, but the pattern is future-proof.
// ---------------------------------------------------------------------------

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent): void => { setMatches(e.matches); };
    // Snap once on mount in case the initial lazy state was taken before
    // the component actually saw this media query (e.g. SSR → hydration).
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => { mql.removeEventListener("change", onChange); };
  }, [query]);

  return matches;
}

/**
 * True on touch-first devices (phones, tablets). Matches the orientation
 * CameraRig uses when choosing orbit controls — fingers don't hover so the
 * click-to-orbit desktop affordance is the wrong idiom.
 */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery("(hover: none) and (pointer: coarse)");
}

/**
 * True on phone-portrait viewports (≤640 CSS px wide). Coarse-pointer is a
 * separate signal — an iPad Pro landscape is coarse AND wide, so use this
 * for layout-density decisions (bottom toolbar, CSS-var chrome offsets) and
 * the pointer hook for interaction-affordance decisions.
 */
export function useIsNarrowViewport(): boolean {
  return useMediaQuery("(max-width: 640px)");
}

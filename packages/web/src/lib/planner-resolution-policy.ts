/**
 * The resting ceiling. Above 2, each extra tenth of a device pixel ratio costs
 * gaussian-sorting and fill work that no display repays: a 3x phone panel
 * renders 2.25 times the fragments of a 2x one for a difference the eye cannot
 * find at arm's length. Independent of device width.
 */
export const MAX_PLANNER_PIXEL_RATIO = 2;

/**
 * The ratio held while the camera is moving. Detail nobody can resolve
 * mid-orbit is the cheapest thing in the frame to give up, and giving it up is
 * what keeps the drag itself smooth. Restored the moment the camera settles.
 */
export const MOTION_PLANNER_PIXEL_RATIO = 1.5;

/** The display's own ratio, unclamped. Only the resolution media query wants this. */
export function rawDevicePixelRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

/** The browser's device resolution, clamped to the resting ceiling. */
export function nativePlannerPixelRatio(devicePixelRatio: number): number {
  return Math.min(rawDevicePixelRatio(devicePixelRatio), MAX_PLANNER_PIXEL_RATIO);
}

/**
 * What the canvas renders at right now.
 *
 * Never RAISES the ratio: a display below the motion floor keeps its own while
 * moving rather than being upscaled to 1.5, which would make camera motion
 * cost more than rest on exactly the machines that can least afford it.
 */
export function plannerPixelRatioForMotion(restingRatio: number, cameraMoving: boolean): number {
  const resting = nativePlannerPixelRatio(restingRatio);
  return cameraMoving ? Math.min(resting, MOTION_PLANNER_PIXEL_RATIO) : resting;
}

export function readNativePlannerPixelRatio(): number {
  return typeof window === "undefined" ? 1 : nativePlannerPixelRatio(window.devicePixelRatio);
}

/**
 * The resolution query has to track the display's REAL ratio, not the clamped
 * one: a 3x panel watching `(resolution: 2dppx)` would never match and never
 * re-arm, so a move to a 1x monitor would go unnoticed.
 */
function readRawDevicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : rawDevicePixelRatio(window.devicePixelRatio);
}

export function serverPlannerPixelRatio(): number { return 1; }

/** Re-arm after display/zoom changes; camera and tile events never enter this path. */
export function subscribeNativePlannerPixelRatio(notify: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let query: MediaQueryList | null = null;
  function changed(): void {
    query?.removeEventListener("change", changed);
    query = window.matchMedia(`(resolution: ${String(readRawDevicePixelRatio())}dppx)`);
    query.addEventListener("change", changed);
    notify();
  }
  query = window.matchMedia(`(resolution: ${String(readRawDevicePixelRatio())}dppx)`);
  query.addEventListener("change", changed);
  window.addEventListener("resize", changed);
  return () => {
    query?.removeEventListener("change", changed);
    window.removeEventListener("resize", changed);
  };
}

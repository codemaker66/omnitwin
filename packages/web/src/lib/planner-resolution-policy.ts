/** Use the browser's actual device resolution, independent of device width or motion. */
export function nativePlannerPixelRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

export function readNativePlannerPixelRatio(): number {
  return typeof window === "undefined" ? 1 : nativePlannerPixelRatio(window.devicePixelRatio);
}

export function serverPlannerPixelRatio(): number { return 1; }

/** Re-arm after display/zoom changes; camera and tile events never enter this path. */
export function subscribeNativePlannerPixelRatio(notify: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let query: MediaQueryList | null = null;
  function changed(): void {
    query?.removeEventListener("change", changed);
    query = window.matchMedia(`(resolution: ${String(readNativePlannerPixelRatio())}dppx)`);
    query.addEventListener("change", changed);
    notify();
  }
  query = window.matchMedia(`(resolution: ${String(readNativePlannerPixelRatio())}dppx)`);
  query.addEventListener("change", changed);
  window.addEventListener("resize", changed);
  return () => {
    query?.removeEventListener("change", changed);
    window.removeEventListener("resize", changed);
  };
}

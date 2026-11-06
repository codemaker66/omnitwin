// ---------------------------------------------------------------------------
// "Don't measure my visits", the switch on the privacy page (T-685): the way to
// object to the page-speed timings that works on every browser, including
// Safari, which sends neither Global Privacy Control nor Do Not Track. The
// choice is kept on this device, the only thing the measurement ever stores
// here, so later visits respect it; where storage is unavailable it holds for
// this visit.
// ---------------------------------------------------------------------------

export const MEASUREMENT_DECLINED_KEY = "venviewer.measurement.declined";

let declinedThisVisit = false;

/** Whether the visitor has said not to measure their visits on this device. */
export function measurementDeclined(): boolean {
  if (declinedThisVisit) return true;
  try {
    return window.localStorage.getItem(MEASUREMENT_DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Records the visitor's choice, on this device and for this visit. */
export function setMeasurementDeclined(declined: boolean): void {
  declinedThisVisit = declined;
  try {
    if (declined) window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Storage is unavailable (a private window): the choice holds for this visit.
  }
}

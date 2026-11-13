// ---------------------------------------------------------------------------
// "Don't measure my visits", the switch on the privacy page (T-685): the way to
// object to the page-speed timings that works on every browser, including
// Safari, which sends neither Global Privacy Control nor Do Not Track. The
// choice is kept in this browser on this device, the only thing the
// measurement ever stores here, so later visits respect it, until the browser
// clears the site's data: Safari's tracking prevention clears script storage
// after about seven days without a visit, which the privacy page says. A
// browser that will not let the site read its storage at all is never
// measured, whatever is pressed; one that will not keep the choice (storage
// full) is told it holds only for this visit. The reporter reads it again
// each time the page is hidden, before anything is sent, so pressing the
// switch also stops the page load in progress.
// ---------------------------------------------------------------------------

export const MEASUREMENT_DECLINED_KEY = "venviewer.measurement.declined";

let declinedThisVisit = false;

/** The choice as this browser keeps it for later visits. A browser that
 *  refuses the site its storage altogether counts as declined: the choice
 *  could never be kept there, so it is never measured. */
function storedChoice(): boolean {
  try {
    return window.localStorage.getItem(MEASUREMENT_DECLINED_KEY) === "1";
  } catch {
    return true;
  }
}

/** Whether the visitor has said not to measure their visits in this browser. */
export function measurementDeclined(): boolean {
  return declinedThisVisit || storedChoice();
}

/**
 * Records the visitor's choice, in this browser and for this visit. Returns
 * whether the choice now in force holds on later visits too (written, then
 * read back), so the switch never claims a choice the browser threw away.
 * Where the browser refuses its storage altogether, the visitor stays
 * declined whatever they press, on this visit and every later one: that holds.
 */
export function setMeasurementDeclined(declined: boolean): boolean {
  declinedThisVisit = declined;
  try {
    if (declined) window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Storage is full or blocked; the read-back below says what still holds.
  }
  return storedChoice() === measurementDeclined();
}

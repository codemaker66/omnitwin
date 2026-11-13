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
// full) keeps it in memory, until the site is next loaded afresh (a reload,
// or a return from another site), and the switch says so. The reporter reads
// the choice again each time the page is hidden, before anything is sent, so
// pressing the switch also stops the page load in progress. The switch shows
// the choice as it stands (measurementChoiceState), whether it was pressed
// there, before the visitor last left the page, or in another tab of this
// browser (subscribeMeasurementChoice).
// ---------------------------------------------------------------------------

export const MEASUREMENT_DECLINED_KEY = "venviewer.measurement.declined";

/** The choice in memory, for as long as this load of the site lasts. */
let declinedThisVisit = false;

/** Whoever shows the choice: told when it is pressed in this tab. */
const listeners = new Set<() => void>();

/** What this browser keeps for later visits: declined or not, or null where
 *  it refuses the site its storage altogether. */
function readStoredChoice(): boolean | null {
  try {
    return window.localStorage.getItem(MEASUREMENT_DECLINED_KEY) === "1";
  } catch {
    return null;
  }
}

/** The choice as this browser keeps it for later visits. A browser that
 *  refuses the site its storage altogether counts as declined: the choice
 *  could never be kept there, so it is never measured. */
function storedChoice(): boolean {
  return readStoredChoice() ?? true;
}

/** Whether the visitor has said not to measure their visits in this browser. */
export function measurementDeclined(): boolean {
  return declinedThisVisit || storedChoice();
}

/**
 * What the switch shows: measured; declined and kept in this browser for
 * later visits; declined only in memory, as the browser would not keep it
 * (storage full); or never measured, as the browser refuses the site its
 * storage. Nothing else is possible: a choice not to decline that the browser
 * would not keep leaves the stored "declined" in force, which reads as declined.
 */
export type MeasurementChoiceState = "measured" | "declined" | "declined-this-visit" | "storage-refused";

export function measurementChoiceState(): MeasurementChoiceState {
  const stored = readStoredChoice();
  if (stored === null) return "storage-refused";
  if (stored) return "declined";
  return declinedThisVisit ? "declined-this-visit" : "measured";
}

/**
 * Records the visitor's choice, in this browser and for this visit, and tells
 * whoever shows it. Returns whether the choice now in force holds on later
 * visits too (written, then read back), so the switch never claims a choice
 * the browser threw away. Where the browser refuses its storage altogether,
 * the visitor stays declined whatever they press, on this visit and every
 * later one: that holds.
 */
export function setMeasurementDeclined(declined: boolean): boolean {
  declinedThisVisit = declined;
  try {
    if (declined) window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Storage is full or blocked; the read-back below says what still holds.
  }
  for (const listener of [...listeners]) listener();
  return storedChoice() === measurementDeclined();
}

/**
 * Calls `onChange` whenever the choice may have changed: pressed in this tab,
 * or written in another tab of this browser (the `storage` event, which a
 * browser fires only in its other tabs, also for a clear of all the site's
 * storage). A press in another tab is the visitor's latest choice, so a tab
 * showing the switch follows it, its own press in memory included; one not
 * showing it keeps its own press until it is next loaded, which can only
 * measure less. For React's useSyncExternalStore; returns the way to stop.
 */
export function subscribeMeasurementChoice(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== MEASUREMENT_DECLINED_KEY) return;
    if (event.key === MEASUREMENT_DECLINED_KEY) declinedThisVisit = event.newValue === "1";
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

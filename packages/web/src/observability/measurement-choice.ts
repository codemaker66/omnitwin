// ---------------------------------------------------------------------------
// "Don't measure my visits", the switch on the privacy page (T-685): the way to
// object to the page-speed timings that works on every browser, including
// Safari, which sends neither Global Privacy Control nor Do Not Track. The
// choice is kept in this browser on this device, the only thing the
// measurement ever stores here, so later visits respect it, until the browser
// clears the site's data: Safari's tracking prevention clears script storage
// after about seven days without a visit, which the privacy page says.
//
// What the browser keeps is the choice that holds, in every tab. A browser
// that will not let the site read its storage at all is never measured,
// whatever is pressed. A press the browser would not keep (storage full) is
// held in memory in the tab where it was made, until that tab is reloaded or
// leaves the site, or another tab's press changes what the browser keeps; it
// reaches no other tab, and the switch says it holds only in this tab. When
// another tab changes what the browser keeps (its press, or a script there
// clearing the site's storage), every other tab follows it at once, whether
// or not it shows the switch (the storage event, heard once for the module).
// The reporter reads the choice before every send, so a press stops the page
// load in progress too. The switch shows the choice as it stands
// (measurementChoiceState, read through useSyncExternalStore).
// ---------------------------------------------------------------------------

export const MEASUREMENT_DECLINED_KEY = "venviewer.measurement.declined";

/** A press to decline that the browser would not keep (storage full): held
 *  in this tab's memory only, for as long as this load of the site lasts,
 *  or until another tab changes what the browser keeps. */
let declinedThisVisit = false;

/** Whoever shows the choice. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

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

/**
 * Another tab of this browser changed what the browser keeps: a press there,
 * or a script there clearing all of the site's storage (key null). That is
 * now the choice that holds here too, so a press this tab could not keep
 * gives way to it. A browser fires this only in its other tabs, and not at
 * all when its own settings clear the site's data (the next read sees that).
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== MEASUREMENT_DECLINED_KEY) return;
  declinedThisVisit = false;
  notify();
}

// Heard once for the module, so every tab follows, whether or not it shows the switch.
if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

/** Whether the visitor has said not to measure their visits in this browser. */
export function measurementDeclined(): boolean {
  return declinedThisVisit || storedChoice();
}

/**
 * What the switch shows: measured; declined and kept in this browser;
 * declined only in this tab's memory, as the browser would not keep this
 * tab's press (storage full); or never measured, as the browser refuses the
 * site its storage. Only a press the browser would not keep leads to
 * "declined-this-visit": what the browser keeps is otherwise what holds.
 */
export type MeasurementChoiceState = "measured" | "declined" | "declined-this-visit" | "storage-refused";

export function measurementChoiceState(): MeasurementChoiceState {
  const stored = readStoredChoice();
  if (stored === null) return "storage-refused";
  if (stored) return "declined";
  return declinedThisVisit ? "declined-this-visit" : "measured";
}

/**
 * Records the visitor's press, in this browser where it will keep it and in
 * this tab's memory where it will not, and tells whoever shows the choice.
 * Returns whether the choice now in force holds on later visits too (written,
 * then read back). A press not to decline that the browser would not keep
 * leaves its stored "declined" in force; where the browser refuses its
 * storage altogether, the visitor stays declined whatever they press, on
 * this visit and every later one: that holds.
 */
export function setMeasurementDeclined(declined: boolean): boolean {
  try {
    if (declined) window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Storage is full or blocked; the read-back below says what holds.
  }
  declinedThisVisit = declined && readStoredChoice() === false;
  notify();
  return storedChoice() === measurementDeclined();
}

/** Calls `onChange` whenever the choice may have changed: a press in this
 *  tab, or another tab changing what the browser keeps. For React's
 *  useSyncExternalStore; returns the way to stop. */
export function subscribeMeasurementChoice(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

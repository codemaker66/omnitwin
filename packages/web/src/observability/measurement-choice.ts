// ---------------------------------------------------------------------------
// "Don't measure my visits", the switch on the privacy page (T-685): the way to
// object to the page-speed timings that works on every browser, including
// Safari, which sends neither Global Privacy Control nor Do Not Track. The
// choice is kept in this browser on this device, the only thing the
// measurement ever stores here, so later visits respect it, until the browser
// clears the site's data: Safari's tracking prevention clears script storage
// after about seven days without a visit, which the privacy page says.
//
// What the browser keeps (localStorage) is the choice that holds, in every
// tab. A browser that will not let the site read it at all is never measured,
// whatever is pressed. A press to decline that the browser will not keep
// there (storage full) is kept for this tab instead, in its session storage,
// which outlasts the site's own links and reloads until the tab is closed
// (Blake, 13 November 2026: "Keep it for the tab"); where the browser refuses
// that too, it is held in this page's memory only, until the next page load.
// Neither reaches a tab already open, and the switch says how long it holds;
// a browser does copy the tab's copy into a duplicate of the tab or one its
// script opens, and keeps it in a tab it reopens, which can only measure
// less. When another tab presses the switch while this one has the site
// open, every other tab follows at once, whether or not it shows the switch
// (the storage event, heard once for the module); a script there clearing
// all the site's storage changes what the browser keeps, but leaves this
// tab's own objection standing. The reporter reads the
// choice before every send, so a press stops the page load in progress too.
// The switch shows the choice as it stands (measurementChoiceState, read
// through useSyncExternalStore).
// ---------------------------------------------------------------------------

export const MEASUREMENT_DECLINED_KEY = "venviewer.measurement.declined";

/** A press to decline that neither the browser nor this tab's session storage
 *  would keep: held for this page load only. */
let declinedThisPage = false;

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

/** Whether this tab keeps a press the browser would not (session storage). */
function readTabChoice(): boolean {
  try {
    return window.sessionStorage.getItem(MEASUREMENT_DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Keeps a press for this tab, or forgets it; returns whether the tab now
 *  keeps it as asked. */
function writeTabChoice(declined: boolean): boolean {
  try {
    if (declined) window.sessionStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.sessionStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Session storage is full or blocked too: the read-back says what holds.
  }
  return readTabChoice() === declined;
}

/** Whether an event is about this tab's own session storage, which a frame
 *  of this tab could change: the choice the browser keeps is another matter. */
function isSessionStorageEvent(event: StorageEvent): boolean {
  try {
    return event.storageArea !== null && event.storageArea === window.sessionStorage;
  } catch {
    return false;
  }
}

/**
 * The storage event. For what the browser keeps (localStorage), a browser
 * fires it only in the site's other documents (other tabs, or a frame of
 * this one), and not at all when its own settings clear the site's data (the
 * next read sees that): a press there (this key) is the visitor's latest
 * choice, so this tab follows it and forgets its own objection; a script
 * there clearing all of the site's storage (key null) changes what the
 * browser keeps, but this tab's own objection stands. For this tab's own copy
 * (sessionStorage), it can come only from a frame of this tab: the choice is
 * read again, and nothing is forgotten.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== MEASUREMENT_DECLINED_KEY) return;
  // A frame of this tab changed the tab's own copy: read it again, no more.
  if (isSessionStorageEvent(event)) {
    notify();
    return;
  }
  if (event.key === MEASUREMENT_DECLINED_KEY) {
    declinedThisPage = false;
    writeTabChoice(false);
  }
  notify();
}

if (typeof window !== "undefined") {
  // Heard once for the module, so every tab follows, whether or not it shows the switch.
  window.addEventListener("storage", onStorage);
  // A page restored from the back/forward cache missed the events of its time
  // away: whoever shows the choice reads it again.
  window.addEventListener("pageshow", (event) => { if (event.persisted) notify(); });
}

/** Whether the visitor has said not to measure their visits in this browser. */
export function measurementDeclined(): boolean {
  return declinedThisPage || readTabChoice() || storedChoice();
}

/**
 * What the switch shows: measured; declined and kept in this browser;
 * declined for this tab only (session storage), or for this page load only
 * (memory), as the browser would not keep this tab's press; or never
 * measured, as the browser refuses the site its storage. Only a press the
 * browser would not keep leads to either of the tab's own states: what the
 * browser keeps is otherwise what holds.
 */
export type MeasurementChoiceState = "measured" | "declined" | "declined-this-tab" | "declined-this-page" | "storage-refused";

export function measurementChoiceState(): MeasurementChoiceState {
  const stored = readStoredChoice();
  if (stored === null) return "storage-refused";
  if (stored) return "declined";
  if (readTabChoice()) return "declined-this-tab";
  return declinedThisPage ? "declined-this-page" : "measured";
}

/**
 * Records the visitor's press: in this browser where it will keep it; else,
 * for a press to decline, in this tab's session storage, else in this page's
 * memory. Tells whoever shows the choice. Returns whether the choice now in
 * force holds on later visits too (written, then read back). A press not to
 * decline that the browser would not keep leaves its stored "declined" in
 * force; where the browser refuses its storage altogether, the visitor stays
 * declined whatever they press, on this visit and every later one: that holds.
 */
export function setMeasurementDeclined(declined: boolean): boolean {
  try {
    if (declined) window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
    else window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
  } catch {
    // Storage is full or blocked; the read-back below says what holds.
  }
  const notKept = declined && readStoredChoice() === false;
  const keptForTab = writeTabChoice(notKept) && notKept;
  declinedThisPage = notKept && !keptForTab;
  notify();
  return storedChoice() === measurementDeclined();
}

/** Calls `onChange` whenever the choice may have changed: a press in this
 *  tab, another tab changing what the browser keeps, or a return to this page
 *  from the back/forward cache. For React's useSyncExternalStore; returns the
 *  way to stop. */
export function subscribeMeasurementChoice(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

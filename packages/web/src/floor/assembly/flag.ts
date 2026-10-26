// ---------------------------------------------------------------------------
// Whether a saved layout assembles itself when it opens (the Grand Assembly)
//
// Blake reviews the Assembly before it reaches everyone: until then it is off
// unless asked for on this device. `?assembly=accio` turns it on and
// remembers it here; `?assembly=off` turns it off again. Presentation only:
// the layout is the same either way. (The same pattern as hall-sky-access.)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.assembly";

/** The directions a device can ask for. Blake chose Accio (24 October 2026). */
export type AssemblyFlag = "accio";

/** The Assembly this device plays when a saved layout opens, from the URL or the last choice; null when off. */
export function assemblyRequested(search: string): AssemblyFlag | null {
  const asked = new URLSearchParams(search).get("assembly");
  if (asked === "accio") {
    try { window.localStorage.setItem(STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked;
  }
  if (asked === "off" || asked === "0") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* a convenience only */ }
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "accio" ? "accio" : null;
  } catch {
    return null;
  }
}

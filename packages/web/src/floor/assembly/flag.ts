// ---------------------------------------------------------------------------
// When a saved layout assembles itself as it opens (the Grand Assembly)
//
// On for everyone (Blake, 26 October 2026): a layout plays the first time it
// opens on a device. `?assembly=accio` plays it on every open here (demos and
// walks), `?assembly=off` turns it off here, and `?assembly=on` returns this
// device to the default; each choice is remembered on the device.
// Presentation only: the layout is the same either way.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.assembly";

/** first: a layout plays the first time it opens on this device. always: every open. off: never. */
export type AssemblyMode = "first" | "always" | "off";

function remember(value: "accio" | "off" | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch { /* a convenience only */ }
}

/** How this device plays the Assembly when a saved layout opens, from the URL or the last choice made here. */
export function assemblyMode(search: string): AssemblyMode {
  const asked = new URLSearchParams(search).get("assembly");
  if (asked === "accio") { remember("accio"); return "always"; }
  if (asked === "off" || asked === "0") { remember("off"); return "off"; }
  if (asked === "on" || asked === "1") { remember(null); return "first"; }
  try {
    const kept = window.localStorage.getItem(STORAGE_KEY);
    return kept === "accio" ? "always" : kept === "off" ? "off" : "first";
  } catch {
    return "first";
  }
}

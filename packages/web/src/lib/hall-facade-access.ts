// ---------------------------------------------------------------------------
// Whether the Grand Hall's city shows Trades Hall's own modelled front
//
// The Glassford Street front, modelled from its measured specification
// (components/grand-hall/hall-exterior-spec.ts), replaces the LiDAR contour
// model's traced outline of the building under the cut-away hall. Blake judges
// the look before it reaches everyone: until then it is off unless asked for
// on this device. `?facade=1` turns it on and remembers it here; `?facade=0`
// turns it off again. It only matters under the real sky, where the city is
// drawn (hall-sky-access.ts). Presentation only: the layout is the same
// either way.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.hall-facade";

/** Whether this device shows the modelled front, from the URL or the last choice. */
export function hallFacadeRequested(search: string): boolean {
  const asked = new URLSearchParams(search).get("facade");
  if (asked === "1" || asked === "0") {
    try { window.localStorage.setItem(STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked === "1";
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

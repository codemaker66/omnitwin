// ---------------------------------------------------------------------------
// Whether the Grand Hall's city shows Trades Hall's own modelled front
//
// The Glassford Street front, modelled from its measured specification
// (components/grand-hall/hall-exterior-spec.ts), replaces the LiDAR contour
// model's traced outline of the building under the cut-away hall. Blake chose
// on 4 November 2026, on frames of both, to have it wherever the city is
// drawn: on unless this device has turned it off. `?facade=0` turns it off and
// remembers it here; `?facade=1` turns it on again. It only matters under the
// real sky, where the city is drawn (hall-sky-access.ts). Presentation only:
// the layout is the same either way.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.hall-facade";

/** Whether this device shows the modelled front: yes, unless the URL or its last choice says no. */
export function hallFacadeRequested(search: string): boolean {
  const asked = new URLSearchParams(search).get("facade");
  if (asked === "1" || asked === "0") {
    try { window.localStorage.setItem(STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked === "1";
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

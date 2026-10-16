// ---------------------------------------------------------------------------
// Whether the Grand Hall is lit by the real sky
//
// The real sun, moon and sky over Glassford Street (HallSky) are reviewed by
// Blake before they reach everyone: until then they are off unless asked for
// on this device. `?sky=1` turns them on and remembers it here; `?sky=0` turns
// them off again. Presentation only: the layout is the same either way.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.hall-sky";

/** Whether this device shows the hall under the real sky, from the URL or the last choice. */
export function hallSkyRequested(search: string): boolean {
  const asked = new URLSearchParams(search).get("sky");
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

export type HallSetting = "city" | "none";

/**
 * The setting round the hall under the real sky: the Merchant City, unless
 * `?setting=none` leaves the hall under the sky alone (for measuring what the
 * city costs).
 */
export function hallSettingRequested(search: string): HallSetting {
  return new URLSearchParams(search).get("setting") === "none" ? "none" : "city";
}

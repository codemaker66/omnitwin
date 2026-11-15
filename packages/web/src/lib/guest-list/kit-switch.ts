/**
 * The planner's kit is built behind one switch. `?kit=on` turns it on and this
 * device remembers it; `?kit=off` turns it off and forgets it. With neither in
 * the address, what this device remembered decides. Storage is a convenience:
 * when it refuses, `?kit=on` still answers true for that call.
 */

export const KIT_PARAM = "kit";
export const KIT_STORAGE_KEY = "venviewer.planners-kit";

const ON = "on";
const OFF = "off";

/** Whether the kit's pages should answer on this device, for this address. */
export function kitRequested(search: string): boolean {
  const asked = new URLSearchParams(search).get(KIT_PARAM);
  if (asked === ON) {
    try { window.localStorage.setItem(KIT_STORAGE_KEY, ON); } catch { /* a convenience only */ }
    return true;
  }
  if (asked === OFF) {
    try { window.localStorage.removeItem(KIT_STORAGE_KEY); } catch { /* a convenience only */ }
    return false;
  }
  try {
    return window.localStorage.getItem(KIT_STORAGE_KEY) === ON;
  } catch {
    return false;
  }
}

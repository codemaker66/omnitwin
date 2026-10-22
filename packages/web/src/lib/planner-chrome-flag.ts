// ---------------------------------------------------------------------------
// Which chrome the planner wears (T-671, slices 6 to 21).
//
// The new chrome Blake approved on 20 Oct 2026 is built behind one flag:
// `?chrome=v2` turns it on and this device remembers it; `?chrome=v1` turns
// it off again. Old and new chrome never render together. Slice 21 makes v2
// the default and deletes v1, by changing DEFAULT_PLANNER_CHROME alone.
// ---------------------------------------------------------------------------

export type PlannerChrome = "v1" | "v2";

export const PLANNER_CHROME_STORAGE_KEY = "venviewer.planner-chrome";

const DEFAULT_PLANNER_CHROME: PlannerChrome = "v1";

function isPlannerChrome(value: string | null): value is PlannerChrome {
  return value === "v1" || value === "v2";
}

/** The chrome this device asks for, from the address or the last choice here. */
export function plannerChromeRequested(search: string): PlannerChrome {
  const asked = new URLSearchParams(search).get("chrome");
  if (isPlannerChrome(asked)) {
    try { window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, asked); } catch { /* a convenience only */ }
    return asked;
  }
  try {
    const remembered = window.localStorage.getItem(PLANNER_CHROME_STORAGE_KEY);
    return isPlannerChrome(remembered) ? remembered : DEFAULT_PLANNER_CHROME;
  } catch {
    return DEFAULT_PLANNER_CHROME;
  }
}

// ---------------------------------------------------------------------------
// Hallkeeper row-check persistence — localStorage
//
// The sheet is a real-time setup artefact: the hallkeeper walks the room,
// ticks off rows. If they switch tabs or refresh, they shouldn't lose
// their place. Backend persistence is v2 — for now we write to
// localStorage keyed on configId.
//
// Storage shape: a single JSON object per configId mapping manifestKey
// → boolean. Missing entries = unchecked. The manifest key
// (phase|zone|name|afterDepth) is stable across config re-saves, so a
// planner tweaking their layout doesn't reset the hallkeeper's progress.
//
// Bounded size: per-config entries are small (~40 keys × ~80 chars ≈ 3KB).
// A mis-scoped write of every config on the device would still be
// <1MB in any realistic usage. We cap at 50 configs to avoid unbounded
// growth from planners who try every space as an anonymous user.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "omnitwin.hallkeeper.checks.";
const MAX_CONFIGS = 50;

export type CheckMap = Readonly<Record<string, boolean>>;

export function storageKeyFor(configId: string): string {
  return `${STORAGE_PREFIX}${configId}`;
}

/** Load the check map for a config. Returns empty object for first-visit. */
export function loadChecks(configId: string): CheckMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKeyFor(configId));
    if (raw === null || raw === "") return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    // Strict: only accept {string: boolean} entries. Anything else drops.
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Save a full check map for a config. Enforces the MAX_CONFIGS bound by
 * evicting the oldest entry (by localStorage key scan) when full.
 */
export function saveChecks(configId: string, checks: CheckMap): void {
  if (typeof window === "undefined") return;
  try {
    enforceConfigCap(configId);
    window.localStorage.setItem(storageKeyFor(configId), JSON.stringify(checks));
  } catch {
    // localStorage.setItem can throw QuotaExceededError in Safari private
    // mode or when the 5MB budget is exhausted. Silent drop is correct
    // here — the sheet remains usable, just without persistence, and the
    // user's current-tab state is still in React state.
  }
}

/** Toggle a single row's check state. Returns the new map. */
export function toggleCheck(prev: CheckMap, rowKey: string): CheckMap {
  if (prev[rowKey] === true) {
    // Rebuild without the key rather than dynamic-delete (lint rule).
    const next: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(prev)) {
      if (k !== rowKey) next[k] = v;
    }
    return next;
  }
  return { ...prev, [rowKey]: true };
}

function enforceConfigCap(currentConfigId: string): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k !== null && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  // If we're at or over cap AND not overwriting an existing entry,
  // evict the oldest-looking key (lex sort is a proxy for insertion age
  // since keys embed a random configId UUID — fine for a best-effort
  // bound, not a real LRU).
  if (keys.length >= MAX_CONFIGS && !keys.includes(storageKeyFor(currentConfigId))) {
    const oldest = [...keys].sort()[0];
    if (oldest !== undefined) window.localStorage.removeItem(oldest);
  }
}

// ---------------------------------------------------------------------------
// The claim secret this browser holds for a plan it made.
//
// POST /public/configurations gives the creating browser a secret, which
// stores/editor-store.ts keeps with the draft in its tracked list. It proves
// "this plan was made here" twice over: it lets a signed-in account claim the
// plan (lib/planner-claim.ts), and it is what the API asks for before it
// returns a guest plan's notes (api/configurations.ts).
//
// Kept apart from both so neither has to import the other.
// ---------------------------------------------------------------------------

/** The tracked list stores/editor-store.ts writes in createPublicConfig. */
export const TRACKED_CONFIGS_KEY = "omnitwin_my_configs";

export function readTrackedEntries(): readonly unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TRACKED_CONFIGS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isEntryFor(entry: unknown, configId: string): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && (entry as Record<string, unknown>)["configId"] === configId;
}

/** The secret this browser was given for a draft it created, if it holds one. */
export function trackedClaimSecret(configId: string): string | null {
  for (const entry of readTrackedEntries()) {
    if (isEntryFor(entry, configId) && typeof entry["claimSecret"] === "string") return entry["claimSecret"];
  }
  return null;
}

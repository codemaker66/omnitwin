import { claimConfig } from "../api/configurations.js";
import { TRACKED_CONFIGS_KEY, isEntryFor, readTrackedEntries, trackedClaimSecret } from "./tracked-claim-secret.js";

// ---------------------------------------------------------------------------
// Claiming this browser's own draft into the signed-in account (release audit
// public-surface-1, migration 0102).
//
// POST /public/configurations gives the creating browser a claim secret, which
// stores/editor-store.ts keeps with the draft in its tracked list. Only that
// secret lets an account take the plan, so a plan opened from a shared
// /plan/<id> link is never claimed, here or on the server.
// ---------------------------------------------------------------------------

export { trackedClaimSecret };

/** A spent secret proves nothing; drop it, keeping the draft's entry. */
function forgetClaimSecret(configId: string): void {
  try {
    const entries = readTrackedEntries().map((entry) => (isEntryFor(entry, configId)
      ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "claimSecret"))
      : entry));
    window.localStorage.setItem(TRACKED_CONFIGS_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort, like the tracked list itself.
  }
}

export type DraftClaim = "claimed" | "not-created-here";

/**
 * Claims a draft this browser created. "not-created-here", with no request
 * sent, when this browser holds no secret for it: the plan was opened from a
 * link, made in another browser, or made before claim secrets. Rejects with
 * the server's error when the claim is refused or does not arrive.
 */
export async function claimTrackedDraft(configId: string): Promise<DraftClaim> {
  const claimSecret = trackedClaimSecret(configId);
  if (claimSecret === null) return "not-created-here";
  await claimConfig(configId, claimSecret);
  forgetClaimSecret(configId);
  return "claimed";
}

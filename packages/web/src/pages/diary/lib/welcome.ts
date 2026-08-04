// ---------------------------------------------------------------------------
// First-run welcome gating (T-520). The Board greets each coordinator once
// per device; the header's "How the Diary works" button re-opens it any
// time. Storage failures (private browsing, locked-down kiosks) must never
// crash the Board — teaching wins on read errors, dismissal degrades
// silently on write errors.
// ---------------------------------------------------------------------------

export function welcomeStorageKey(userId: string): string {
  return `venviewer:diary-welcome-seen:${userId}`;
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when this user has not dismissed the welcome on this device. */
export function shouldShowWelcome(userId: string, storage: Storage | null = defaultStorage()): boolean {
  if (storage === null) return true;
  try {
    return storage.getItem(welcomeStorageKey(userId)) === null;
  } catch {
    return true;
  }
}

/** Persist the dismissal; failures degrade silently (the panel simply
 *  greets again next visit). */
export function markWelcomeSeen(userId: string, storage: Storage | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    storage.setItem(welcomeStorageKey(userId), "1");
  } catch {
    // Private browsing / quota — dismissal just doesn't persist.
  }
}

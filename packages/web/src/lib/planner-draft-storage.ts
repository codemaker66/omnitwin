// ---------------------------------------------------------------------------
// Where unsaved planner work lives on this device (localStorage), and the
// housekeeping that keeps it from outliving its purpose: a start-up sweep of
// drafts past their age for everyone on the device (guests too), and the
// sign-out purge of one person's drafts. Reading and writing a draft itself
// is anonymous-planner-draft.ts; this module stays free of the editor so the
// app's entry can sweep without loading the planner.
// ---------------------------------------------------------------------------

const GUEST_DRAFT_PREFIX = "venviewer:anonymous-planner-draft:";
const SIGNED_IN_DRAFT_PREFIX = "venviewer:planner-draft:";

/** A kept draft older than this is forgotten. */
export const MAX_PLANNER_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function anonymousPlannerDraftKey(configId: string): string {
  return `${GUEST_DRAFT_PREFIX}${configId}`;
}

export function signedInPlannerDraftKey(ownerUserId: string, configId: string): string {
  return `${SIGNED_IN_DRAFT_PREFIX}${ownerUserId}:${configId}`;
}

function ownerPrefix(ownerUserId: string): string {
  return `${SIGNED_IN_DRAFT_PREFIX}${ownerUserId}:`;
}

function deviceStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Some browsers throw on access when site data is blocked.
    return null;
  }
}

/** Every key under these prefixes, read before any is removed. */
function keysStartingWith(storage: Storage, prefixes: readonly string[]): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function remove(storage: Storage, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** When the draft under this key was last written; null when it cannot be read as one. */
function draftWrittenAtMs(storage: Storage, key: string): number | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const writtenAt: unknown = Reflect.get(parsed, "updatedAtMs");
    return typeof writtenAt === "number" && Number.isFinite(writtenAt) ? writtenAt : null;
  } catch {
    return null;
  }
}

function isLive(storage: Storage, key: string, nowMs: number): boolean {
  const writtenAt = draftWrittenAtMs(storage, key);
  return writtenAt !== null && nowMs - writtenAt <= MAX_PLANNER_DRAFT_AGE_MS;
}

/**
 * Forget every kept draft on this device that is past its age or cannot be
 * read, whoever it belongs to. A draft's own read expires it too, but only
 * when that layout is opened again; this catches the ones never reopened, so
 * they neither linger nor fill the browser's storage. Returns how many went.
 */
export function sweepExpiredPlannerDrafts(nowMs: number = Date.now()): number {
  const storage = deviceStorage();
  if (storage === null) return 0;
  let removed = 0;
  for (const key of keysStartingWith(storage, [GUEST_DRAFT_PREFIX, SIGNED_IN_DRAFT_PREFIX])) {
    if (!isLive(storage, key, nowMs) && remove(storage, key)) removed += 1;
  }
  return removed;
}

/** How many layouts this person has unsaved work for, kept on this device. */
export function countPlannerDraftsOf(ownerUserId: string, nowMs: number = Date.now()): number {
  const storage = deviceStorage();
  if (storage === null) return 0;
  return keysStartingWith(storage, [ownerPrefix(ownerUserId)]).filter((key) => isLive(storage, key, nowMs)).length;
}

/** Told to other open tabs, before the purge, so a planner tab still holding
 *  this person's unsaved work does not write it straight back. */
const SIGNED_OUT_KEY = "venviewer:planner-drafts-signed-out";

/**
 * Forget all of this person's kept work on this device (they are signing out
 * of a browser someone else may use next). Other open tabs hear of it first
 * (signedOutOwnerFrom). Returns how many drafts went.
 */
export function purgePlannerDraftsOf(ownerUserId: string): number {
  const storage = deviceStorage();
  if (storage === null) return 0;
  try {
    storage.setItem(SIGNED_OUT_KEY, JSON.stringify({ userId: ownerUserId, atMs: Date.now() }));
  } catch {
    // The purge still goes ahead; only the other tabs' notice is lost.
  }
  let removed = 0;
  for (const key of keysStartingWith(storage, [ownerPrefix(ownerUserId)])) {
    if (remove(storage, key)) removed += 1;
  }
  remove(storage, SIGNED_OUT_KEY);
  return removed;
}

/** The person another tab is signing out, from a storage event; else null. */
export function signedOutOwnerFrom(event: { readonly key: string | null; readonly newValue: string | null }): string | null {
  if (event.key !== SIGNED_OUT_KEY || event.newValue === null) return null;
  try {
    const parsed: unknown = JSON.parse(event.newValue);
    if (typeof parsed !== "object" || parsed === null) return null;
    const userId: unknown = Reflect.get(parsed, "userId");
    return typeof userId === "string" && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

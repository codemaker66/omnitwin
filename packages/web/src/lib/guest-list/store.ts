/**
 * The planner's kit: keeping the guest list on the planner's own device.
 *
 * This is the only code that touches browser storage for guests' names. The
 * list is stored under its plan id and never sent anywhere. Every storage call
 * is guarded: a refusal or a stored value that is not a list becomes one of the
 * fixed kinds below. Nothing here puts a guest's text, or any stored value, into
 * a thrown value or into anything it returns other than the list itself.
 */

import { openCache, type CacheHandle } from "../idb-cache.js";
import { GuestListSchema, deleteAfter, removedFromWhenUnreadable, repairGuestList, type GuestList } from "./model.js";

export const GUEST_LIST_DB = "venviewer-guest-lists";
export const GUEST_LIST_STORE = "lists";

export type Opened =
  | { readonly kind: "ready"; readonly list: GuestList; readonly repaired: number }
  | { readonly kind: "new" }
  /** Something is stored for this plan but it is not a valid list; it is left in place. */
  | { readonly kind: "unreadable" }
  /** Storage refused the read; a list may be stored that was not seen. Work in memory only. */
  | { readonly kind: "not-kept" }
  /** This browser has no storage for a list (no IndexedDB): nothing is kept here, or can be. */
  | { readonly kind: "no-storage" };

/**
 * What tells one stored copy of a list from every other: the count of saves
 * that made it and the time its writer gave it. Two copies are the same copy
 * only when both are equal. Nothing asks which of two copies is the newer, so
 * a clock that is wrong, or that steps back, cannot hide a change.
 */
export interface Stamp {
  readonly revision: number;
  readonly updatedAt: string;
}

export function stampOf(list: GuestList): Stamp {
  return { revision: list.revision, updatedAt: list.updatedAt };
}

export function sameStamp(a: Stamp, b: Stamp): boolean {
  return a.revision === b.revision && a.updatedAt === b.updatedAt;
}

/** The paper's record on a list: the number of its last printed sheet, when that was, and whether the list has changed since. */
export interface PaperRecord {
  readonly paperVersion: number;
  readonly printedAt: string | null;
  readonly changedSincePrint: boolean;
}

export type Saved =
  /** Written over nothing, or over the very copy the caller had loaded. */
  | { readonly kind: "saved"; readonly stamp: Stamp; readonly paper?: PaperRecord }
  /**
   * Written over a stored copy the caller had not loaded (another tab's), or
   * over a value that was not a list. `paper` is there when that copy had been
   * printed under a larger number than the caller's list: the record written
   * in its place, for the caller to take up.
   */
  | { readonly kind: "saved-over-other"; readonly stamp: Stamp; readonly paper?: PaperRecord }
  /**
   * Nothing is stored where the caller had loaded a copy: the list was removed
   * since (deleted in another tab, or the browser's stored data was cleared).
   * Nothing was written, so a removed list is never written back.
   */
  | { readonly kind: "removed-elsewhere" }
  /**
   * Asked to give way, and a valid stored copy was not the one the caller had
   * loaded: nothing was written. `list` is that copy, as `open` would return it.
   */
  | { readonly kind: "other-kept"; readonly list: GuestList }
  | { readonly kind: "not-kept" };

export interface SaveOptions {
  /**
   * Give way to another tab: when a valid stored copy is not the one the
   * caller loaded, write nothing and answer with that copy. For a change that
   * must never cost another tab its list, such as the record of a print.
   */
  readonly yieldToOther?: boolean;
}

export interface GuestListStore {
  open(planId: string): Promise<Opened>;
  /**
   * Stores the list as given (`updatedAt` is the caller's) but for its
   * `revision`, which is counted here: one more than the larger of the stored
   * copy's and the loaded copy's. `loaded` is the stamp of the copy the caller
   * last opened or saved, or null if none. A stored copy that is not that copy
   * is still replaced, and the answer says so, so the page can say so, unless
   * the caller asked to give way to it. The answer carries the stamp written:
   * the caller's next `loaded`. When nothing is stored and the caller had
   * loaded a copy, nothing is written.
   *
   * The paper's version never goes down on the device. When another tab's
   * copy had been printed under a larger number than the list being saved,
   * that number and its print day are written with the list, marked changed
   * since that print, so the number of a sheet that went out is never given
   * to a different sheet.
   */
  save(list: GuestList, loaded: Stamp | null, opts?: SaveOptions): Promise<Saved>;
  erase(planId: string): Promise<void>;
  /** Removes lists past their delete-after day; answers the plan ids of the lists it removed. */
  sweep(nowMs: number): Promise<readonly string[]>;
}

export function createGuestListStore(handle: CacheHandle<unknown>): GuestListStore {
  async function open(planId: string): Promise<Opened> {
    try {
      const stored = await handle.get(planId);
      if (stored === null) return { kind: "new" };
      const parsed = GuestListSchema.safeParse(stored.value);
      if (!parsed.success) return { kind: "unreadable" };
      const repaired = repairGuestList(parsed.data);
      return { kind: "ready", list: repaired.list, repaired: repaired.unseated };
    } catch {
      return { kind: "not-kept" };
    }
  }

  async function save(list: GuestList, loaded: Stamp | null, opts?: SaveOptions): Promise<Saved> {
    // A list that open would refuse is never written; the stored copy stays as it was.
    const checked = GuestListSchema.safeParse(list);
    if (!checked.success) return { kind: "not-kept" };
    try {
      const stored = await handle.get(checked.data.planId);
      // The copy the caller loaded is gone: it was removed, and is not written back.
      if (stored === null && loaded !== null) return { kind: "removed-elsewhere" };
      // What is stored is another's unless it is the very copy the caller loaded.
      // A stored value that is not a list is another's too; it is replaced.
      let anothers = false;
      let storedRevision = 0;
      /** Another tab's print record, when its sheet went out under a larger number than this list's. */
      let carried: PaperRecord | null = null;
      if (stored !== null) {
        const parsed = GuestListSchema.safeParse(stored.value);
        if (parsed.success) storedRevision = parsed.data.revision;
        anothers = !(parsed.success && loaded !== null && sameStamp(stampOf(parsed.data), loaded));
        // Asked to give way: another's valid copy stands, and nothing is written.
        if (anothers && parsed.success && opts?.yieldToOther === true) {
          return { kind: "other-kept", list: repairGuestList(parsed.data).list };
        }
        if (anothers && parsed.success && parsed.data.paperVersion > checked.data.paperVersion) {
          // Their sheet is out under that number, and it was not this list: changed since that print.
          carried = { paperVersion: parsed.data.paperVersion, printedAt: parsed.data.printedAt, changedSincePrint: true };
        }
      }
      const toStore: GuestList = {
        ...checked.data,
        ...(carried ?? {}),
        revision: Math.max(storedRevision, loaded?.revision ?? 0) + 1,
      };
      const stamp = stampOf(toStore);
      await handle.put(toStore.planId, toStore);
      // Read back: put resolves before the browser commits, so a quota failure would otherwise pass as "saved".
      const back = await handle.get(toStore.planId);
      if (back === null) return { kind: "not-kept" };
      const kept = GuestListSchema.safeParse(back.value);
      if (!kept.success || !sameStamp(stampOf(kept.data), stamp)) return { kind: "not-kept" };
      const kind = anothers ? "saved-over-other" : "saved";
      return carried === null ? { kind, stamp } : { kind, stamp, paper: carried };
    } catch {
      return { kind: "not-kept" };
    }
  }

  async function erase(planId: string): Promise<void> {
    try {
      await handle.delete(planId);
    } catch {
      // Storage refused: there is nothing more to do for this plan here.
    }
  }

  async function sweep(nowMs: number): Promise<readonly string[]> {
    const removed: string[] = [];
    try {
      const rows = await handle.list();
      for (const row of rows) {
        const parsed = GuestListSchema.safeParse(row.stored.value);
        try {
          // A value that cannot be read as a list still goes, so no name in it outlives the rule:
          // by the longer of the two periods, counted from when it was last stored.
          const removeFrom = parsed.success
            ? Date.parse(`${deleteAfter(parsed.data).dateIso}T00:00:00.000Z`)
            : removedFromWhenUnreadable(row.stored.storedAt);
          // Fails safe: a removal moment that cannot be read never removes a list.
          if (!(nowMs >= removeFrom)) continue;
          await handle.delete(row.key);
          // A list is kept under its plan's id.
          removed.push(row.key);
        } catch {
          // This one could not be worked out or removed; carry on with the rest.
        }
      }
    } catch {
      // The lists could not be read: nothing was removed.
    }
    return removed;
  }

  return { open, save, erase, sweep };
}

/**
 * The store of a browser with no IndexedDB. Nothing can be stored, so nothing
 * stored can go unseen: it opens as "no-storage", which is not a read that
 * failed, and keeps nothing.
 */
function noStorageStore(): GuestListStore {
  return {
    open: () => Promise.resolve({ kind: "no-storage" }),
    save: () => Promise.resolve({ kind: "not-kept" }),
    erase: () => Promise.resolve(),
    sweep: () => Promise.resolve([]),
  };
}

let cachedStore: GuestListStore | null = null;

/** The device store, made once. Without IndexedDB it keeps nothing and says so. */
export function guestListStore(): GuestListStore {
  if (cachedStore !== null) return cachedStore;
  cachedStore = typeof indexedDB === "undefined"
    ? noStorageStore()
    : createGuestListStore(openCache<unknown>({ dbName: GUEST_LIST_DB, storeName: GUEST_LIST_STORE }));
  return cachedStore;
}

/**
 * Whether this browser may be keeping a guest list. False only when it is
 * known not to: there is no IndexedDB, or the browser lists its databases and
 * the kit's is not among them. Asking opens nothing, so it never makes the
 * database (using `guestListStore()` would). A browser that cannot list its
 * databases, or refuses to, may be keeping one.
 */
export async function guestListDatabaseMayExist(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  // Typed as always present, but an older browser has no `databases`.
  if (!("databases" in indexedDB)) return true;
  try {
    const known = await indexedDB.databases();
    return known.some((database) => database.name === GUEST_LIST_DB);
  } catch {
    return true;
  }
}

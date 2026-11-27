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

/**
 * Whether the print recorded on another tab's copy (`theirs`) is of a sheet
 * that the print recorded on this list (`ours`) does not account for: a larger
 * number, or the same number printed at another moment, which is another sheet
 * under that number. A copy never printed has no sheet.
 */
export function anotherSheet(
  theirs: Pick<PaperRecord, "paperVersion" | "printedAt">,
  ours: Pick<PaperRecord, "paperVersion" | "printedAt">,
): boolean {
  if (theirs.paperVersion !== ours.paperVersion) return theirs.paperVersion > ours.paperVersion;
  return theirs.paperVersion > 0 && theirs.printedAt !== ours.printedAt;
}

export type Saved =
  /** Written over nothing, or over the very copy the caller had loaded. */
  | { readonly kind: "saved"; readonly stamp: Stamp; readonly paper?: PaperRecord }
  /**
   * Written over a stored copy the caller had not loaded (another tab's), or
   * over a value that was not a list. `paper` is there when that copy had been
   * printed under a larger number than the caller's list, or under the same
   * number at another moment: the record written in its place, for the caller
   * to take up.
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
  /** Another tab was at work on the lists and did not finish in time: nothing was written, and the save can be tried again. */
  | { readonly kind: "busy" }
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
   * copy had been printed under a larger number than the list being saved, or
   * under the same number at another moment (another sheet under that
   * number), that number and its print day are written with the list, marked
   * changed since that print. So the next print takes the next number, and no
   * later sheet is given a number a sheet has carried. Two sheets printed in
   * the same moment by two tabs can still share one: see the paper page.
   */
  save(list: GuestList, loaded: Stamp | null, opts?: SaveOptions): Promise<Saved>;
  erase(planId: string): Promise<void>;
  /**
   * Removes what is stored for a plan only while it still cannot be read as a
   * list, compared and deleted in one step of the store. A list is never
   * removed by it, so one another tab has stored there since is left alone.
   */
  eraseUnreadable(planId: string): Promise<void>;
  /**
   * Removes lists past their delete-after day; answers the plan ids of the
   * lists it removed. Each is removed only while it is still the very copy
   * this sweep read, compared and deleted in one step of the store: a list
   * another tab has saved since is left, and is not answered as removed.
   */
  sweep(nowMs: number): Promise<readonly string[]>;
}

/**
 * Runs a piece of work alone: nothing else that asks through the same lock
 * runs until it has finished. A save reads, writes and reads back in three
 * steps of the store, so without this another tab's delete could land between
 * them and its names be written back.
 */
export type Exclusive = <T>(work: () => Promise<T>) => Promise<Alone<T>>;

/** What became of work asked to run alone: it ran, or another tab held the lock too long and it was not started. */
export type Alone<T> = { readonly ran: true; readonly value: T } | { readonly ran: false };

/** The one name every tab asks the browser's lock by. It says nothing of any plan or guest. */
const LOCK_NAME = "venviewer-guest-lists";

/** How long a save, a delete or a sweep waits for another tab to let the lock go. */
export const LOCK_WAIT_MS = 2_000;

/**
 * One at a time across every tab of this browser, by the browser's own lock
 * (the Web Locks API). The lock is held only while the store's own steps run,
 * never across anything a person waits on. The wait for it is bounded: when
 * another tab still holds it after that, the work is not started at all, for
 * work done without the lock is how a deleted list came back. A browser
 * without the lock, or one that refuses the request outright, does the work
 * unguarded, as every browser did before.
 */
const acrossTabs: Exclusive = async <T>(work: () => Promise<T>): Promise<Alone<T>> => {
  // Typed as always present, but an older browser has no `locks`, or has it empty.
  const locks = typeof navigator === "undefined" ? undefined : (navigator.locks as LockManager | null | undefined);
  if (locks === undefined || locks === null) return { ran: true, value: await work() };
  const asked: { work: Promise<T> | null; gaveUp: boolean } = { work: null, gaveUp: false };
  const waiting = new AbortController();
  const bound = setTimeout(() => {
    asked.gaveUp = true;
    waiting.abort();
  }, LOCK_WAIT_MS);
  // The lock is held until the work has settled, whichever way it settles.
  const run = (): Promise<void> => {
    clearTimeout(bound);
    asked.work = work();
    return asked.work.then(() => undefined, () => undefined);
  };
  try {
    await locks.request(LOCK_NAME, { signal: waiting.signal }, run);
  } catch {
    // Not granted in time, or refused: settled below.
  } finally {
    clearTimeout(bound);
  }
  if (asked.work !== null) return { ran: true, value: await asked.work };
  if (asked.gaveUp) return { ran: false };
  return { ran: true, value: await work() };
};

export function createGuestListStore(handle: CacheHandle<unknown>, exclusive: Exclusive = acrossTabs): GuestListStore {
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
      /** Another tab's print record, when its sheet went out under a larger number than this list's, or under the same number at another moment. */
      let carried: PaperRecord | null = null;
      if (stored !== null) {
        const parsed = GuestListSchema.safeParse(stored.value);
        if (parsed.success) storedRevision = parsed.data.revision;
        anothers = !(parsed.success && loaded !== null && sameStamp(stampOf(parsed.data), loaded));
        // Asked to give way: another's valid copy stands, and nothing is written.
        if (anothers && parsed.success && opts?.yieldToOther === true) {
          return { kind: "other-kept", list: repairGuestList(parsed.data).list };
        }
        if (anothers && parsed.success && anotherSheet(parsed.data, checked.data)) {
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

  async function eraseUnreadable(planId: string): Promise<void> {
    try {
      await handle.deleteIf(planId, (stored) => !GuestListSchema.safeParse(stored.value).success);
    } catch {
      // Storage refused: what is stored stays as it was.
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
          // Removed only while it is still the very entry read above, compared and deleted in one
          // step of the store: the same copy of the list, or the same value that cannot be read,
          // stored at the same time. What another tab has stored since is not past its day on the
          // strength of this read, and stays.
          const read = parsed.success ? stampOf(parsed.data) : null;
          const gone = await handle.deleteIf(row.key, (now) => {
            const again = GuestListSchema.safeParse(now.value);
            if (read === null) return !again.success && now.storedAt === row.stored.storedAt;
            return again.success && sameStamp(stampOf(again.data), read);
          });
          // A list is kept under its plan's id. Only one seen to go is answered as removed.
          if (gone) removed.push(row.key);
        } catch {
          // This one could not be worked out or removed; carry on with the rest.
        }
      }
    } catch {
      // The lists could not be read: nothing was removed.
    }
    return removed;
  }

  // A save (its read, its write and its read-back), a delete and a sweep each run alone, across
  // every tab: a delete cannot land inside another tab's save, nor one save inside another.
  // When another tab holds the lock too long, nothing is done: the save answers "busy", the delete
  // leaves the list (the page reads back and says so), a value that cannot be read stays where
  // it is, and the sweep removes nothing this time.
  return {
    open,
    save: async (list, loaded, opts) => {
      const alone = await exclusive(() => save(list, loaded, opts));
      return alone.ran ? alone.value : { kind: "busy" };
    },
    erase: async (planId) => {
      await exclusive(() => erase(planId));
    },
    eraseUnreadable: async (planId) => {
      await exclusive(() => eraseUnreadable(planId));
    },
    sweep: async (nowMs) => {
      const alone = await exclusive(() => sweep(nowMs));
      return alone.ran ? alone.value : [];
    },
  };
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
    eraseUnreadable: () => Promise.resolve(),
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

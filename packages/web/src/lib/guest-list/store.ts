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
import { GuestListSchema, deleteAfter, repairGuestList, type GuestList } from "./model.js";

export const GUEST_LIST_DB = "venviewer-guest-lists";
export const GUEST_LIST_STORE = "lists";

export type Opened =
  | { readonly kind: "ready"; readonly list: GuestList; readonly repaired: number }
  | { readonly kind: "new" }
  /** Something is stored for this plan but it is not a valid list; it is left in place. */
  | { readonly kind: "unreadable" }
  /** Storage refused; work in memory only. */
  | { readonly kind: "not-kept" };

export type Saved = "saved" | "not-kept" | "newer-copy-kept-ours";

export interface GuestListStore {
  open(planId: string): Promise<Opened>;
  /**
   * Stores the list exactly as given (`updatedAt` is the caller's). `loadedUpdatedAt`
   * is the `updatedAt` of the copy the caller last opened or saved, or null if none.
   * When the device holds a valid copy newer than that, it is still replaced and
   * the answer is "newer-copy-kept-ours", so the page can say so.
   */
  save(list: GuestList, loadedUpdatedAt: string | null): Promise<Saved>;
  erase(planId: string): Promise<void>;
  /** Removes lists past their delete-after day; returns how many it removed. */
  sweep(nowMs: number): Promise<number>;
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

  async function save(list: GuestList, loadedUpdatedAt: string | null): Promise<Saved> {
    // A list that open would refuse is never written; the stored copy stays as it was.
    const checked = GuestListSchema.safeParse(list);
    if (!checked.success) return "not-kept";
    const toStore = checked.data;
    try {
      const stored = await handle.get(toStore.planId);
      let newerCopy = false;
      if (stored !== null) {
        const parsed = GuestListSchema.safeParse(stored.value);
        if (parsed.success) {
          newerCopy =
            loadedUpdatedAt === null ||
            !(Date.parse(parsed.data.updatedAt) <= Date.parse(loadedUpdatedAt));
        }
      }
      await handle.put(toStore.planId, toStore);
      // Read back: put resolves before the browser commits, so a quota failure would otherwise pass as "saved".
      const back = await handle.get(toStore.planId);
      if (back === null) return "not-kept";
      const kept = GuestListSchema.safeParse(back.value);
      if (!kept.success || kept.data.updatedAt !== toStore.updatedAt) return "not-kept";
      return newerCopy ? "newer-copy-kept-ours" : "saved";
    } catch {
      return "not-kept";
    }
  }

  async function erase(planId: string): Promise<void> {
    try {
      await handle.delete(planId);
    } catch {
      // Storage refused: there is nothing more to do for this plan here.
    }
  }

  async function sweep(nowMs: number): Promise<number> {
    let removed = 0;
    try {
      const rows = await handle.list();
      for (const row of rows) {
        const parsed = GuestListSchema.safeParse(row.stored.value);
        if (!parsed.success) continue;
        try {
          const removeFrom = Date.parse(`${deleteAfter(parsed.data).dateIso}T00:00:00.000Z`);
          // Fails safe: a removal moment that cannot be read never removes a list.
          if (!(nowMs >= removeFrom)) continue;
          await handle.delete(row.key);
          removed += 1;
        } catch {
          // This one could not be worked out or removed; carry on with the rest.
        }
      }
    } catch {
      return 0;
    }
    return removed;
  }

  return { open, save, erase, sweep };
}

/** A handle for a browser with no IndexedDB: every call is refused, so the store answers "not-kept". */
function unavailableHandle(): CacheHandle<unknown> {
  const refuse = (): Promise<never> => Promise.reject(new Error("storage unavailable"));
  return { get: refuse, put: refuse, delete: refuse, list: refuse };
}

let cachedStore: GuestListStore | null = null;

/** The device store, made once. Without IndexedDB it keeps nothing and says so. */
export function guestListStore(): GuestListStore {
  if (cachedStore !== null) return cachedStore;
  cachedStore = createGuestListStore(
    typeof indexedDB === "undefined"
      ? unavailableHandle()
      : openCache<unknown>({ dbName: GUEST_LIST_DB, storeName: GUEST_LIST_STORE }),
  );
  return cachedStore;
}

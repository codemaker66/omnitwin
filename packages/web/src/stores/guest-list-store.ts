/**
 * The planner's kit: the guest list pages' state.
 *
 * Holds the list being worked on, saves it to the planner's own device a
 * moment after each change, and keeps a short undo history. This is the only
 * caller of the device store (`lib/guest-list/store.ts`); nothing here talks
 * to a server. No action rejects or throws to its caller, and nothing here
 * logs or puts a guest's text into an error.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { emptyGuestList, type GuestList } from "../lib/guest-list/model.js";
import { sameStamp, stampOf, type GuestListStore, type Opened, type Saved, type Stamp } from "../lib/guest-list/store.js";

/** A change is written to the device within this long of being made. */
export const AUTOSAVE_MS = 600;
/** How many changes undo can step back through. */
export const UNDO_STEPS = 30;

export type KitPhase = "opening" | "ready" | "unreadable";

export type KitNotice =
  | null
  | { readonly kind: "repaired"; readonly unseated: number }
  | { readonly kind: "other-tab" }
  | { readonly kind: "removed-elsewhere" };

export interface GuestListState {
  readonly planId: string | null;
  readonly phase: KitPhase;
  readonly list: GuestList | null;
  /** False while the device is not keeping the list. */
  readonly kept: boolean;
  /**
   * The device could not be read when this plan was opened, so a list may be
   * kept there that this page has not seen. Until a read succeeds, nothing
   * here writes to the device or erases it.
   */
  readonly unread: boolean;
  readonly notice: KitNotice;
  readonly canUndo: boolean;
  /**
   * Counts the lists `refresh` has taken up from another tab (an empty one
   * included), so a page can clear what it was saying about the list before.
   */
  readonly takeUps: number;
  open(planId: string, store: GuestListStore, now?: () => string): Promise<void>;
  apply(change: (list: GuestList) => GuestList, opts?: { readonly undo?: boolean }): void;
  undo(): void;
  dismissNotice(): void;
  /** For "unreadable": erase what is stored and begin a new list. */
  startAgain(): Promise<void>;
  eraseList(): Promise<void>;
  /** Saves now if anything is unsaved; resolves when no save is waiting or running. */
  flush(): Promise<void>;
  /**
   * Takes up another tab's changes. When nothing here is unsaved and no save
   * is running, reads the device again and takes the stored list if it is not
   * the copy last opened or saved here, whichever way the two clocks point;
   * undo is cleared then, as its steps belong to the list before. When nothing
   * is stored any more and this session had opened or saved a list, another
   * tab removed it: an empty list is taken, undo is cleared and the page says
   * so, so the names are not written back. With a change unsaved, nothing is
   * read: the save says if it went over another tab's copy.
   */
  refresh(): Promise<void>;
  reset(): void;
}

/**
 * One opened plan. A session is replaced by the next `open` and ended by
 * `reset`; an answer that arrives for a session no longer current changes
 * nothing on the page.
 */
interface Session {
  readonly planId: string;
  readonly store: GuestListStore;
  readonly now: () => string;
  /** Lists before each recorded change, oldest first. */
  undo: GuestList[];
  /**
   * The stamp of the stored copy this session last opened, took up or saved,
   * or null when it holds none: what the device compares its stored copy with.
   * It comes from the device's answers only, never from the page's list.
   */
  loaded: Stamp | null;
  /** A change has been made that the device has not yet been asked to keep. */
  unsaved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  /** While erasing, nothing is saved. */
  erasing: boolean;
  /** False once replaced or reset. */
  live: boolean;
  /** For a session replaced with a change unsaved: the list still to be saved. */
  final: GuestList | null;
  /**
   * The device could not be read when this plan was opened, so a list may be
   * stored that this session has never seen. Before writing, the device is read
   * again; while anything is stored there, nothing is written over it.
   */
  unread: boolean;
}

const INITIAL = {
  planId: null,
  phase: "opening",
  list: null,
  kept: true,
  unread: false,
  notice: null,
  canUndo: false,
  takeUps: 0,
} as const satisfies Partial<GuestListState>;

const systemNow = (): string => new Date().toISOString();

let current: Session | null = null;
/** The save still running for a session that has been replaced, if any. */
let retiring: Promise<void> | null = null;

async function openSafely(store: GuestListStore, planId: string): Promise<Opened> {
  try {
    return await store.open(planId);
  } catch {
    return { kind: "not-kept" };
  }
}

async function saveSafely(store: GuestListStore, list: GuestList, loaded: Stamp | null): Promise<Saved> {
  try {
    return await store.save(list, loaded);
  } catch {
    return { kind: "not-kept" };
  }
}

async function eraseSafely(store: GuestListStore, planId: string): Promise<void> {
  try {
    await store.erase(planId);
  } catch {
    // Storage refused; there is nothing more to do here.
  }
}

function clearTimer(session: Session): void {
  if (session.timer !== null) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}

export const useGuestListStore: UseBoundStore<StoreApi<GuestListState>> = create<GuestListState>()(
  (set, get) => {
    const isCurrent = (session: Session): boolean => session.live && current === session;
    /** Nothing here is waiting to be kept, being kept or being erased. */
    const quiet = (session: Session): boolean => !session.unsaved && session.running === null && !session.erasing;

    /**
     * Saves one at a time, in order, always the latest list, until nothing is
     * unsaved. A "not-kept" answer stops the loop; the next change tries again.
     * An unread session reads the device first and writes only when nothing is
     * stored; otherwise the change stays unsaved and the list is not kept.
     */
    function saveLoop(session: Session): Promise<void> {
      if (session.running !== null) return session.running;
      const run = (async () => {
        while (session.unsaved && !session.erasing) {
          clearTimer(session);
          if (session.unread) {
            const again = await openSafely(session.store, session.planId);
            if (again.kind !== "new") {
              if (isCurrent(session)) set({ kept: false });
              return;
            }
            session.unread = false;
            session.loaded = null;
            if (isCurrent(session)) set({ unread: false });
            // Check again what may have changed while reading (an erase, a reset).
            continue;
          }
          const list = isCurrent(session) ? get().list : session.final;
          session.unsaved = false;
          if (list === null) return;
          const answer = await saveSafely(session.store, list, session.loaded);
          if (answer.kind === "not-kept") {
            session.unsaved = true;
            if (isCurrent(session)) set({ kept: false });
            return;
          }
          session.loaded = answer.stamp;
          if (isCurrent(session)) {
            set(answer.kind === "saved-over-other" ? { kept: true, notice: { kind: "other-tab" } } : { kept: true });
          }
        }
      })();
      session.running = run.finally(() => {
        session.running = null;
      });
      return session.running;
    }

    function scheduleSave(session: Session): void {
      session.unsaved = true;
      if (session.timer !== null || session.erasing) return;
      session.timer = setTimeout(() => {
        session.timer = null;
        void saveLoop(session);
      }, AUTOSAVE_MS);
    }

    /** Stops a session: a change still unsaved is saved (when asked), nothing reaches the page. */
    function retire(session: Session, saveWhatIsLeft: boolean): void {
      clearTimer(session);
      if (saveWhatIsLeft && session.unsaved) session.final = get().list;
      else session.unsaved = false;
      session.live = false;
      const running = session.unsaved ? saveLoop(session) : session.running;
      if (running === null) return;
      retiring = running;
      void running.then(() => {
        if (retiring === running) retiring = null;
      });
    }

    /** Puts the session's list in place, stamped now, and asks for a save. */
    function setChanged(session: Session, list: GuestList): void {
      set({ list: { ...list, updatedAt: session.now() }, canUndo: session.undo.length > 0 });
      scheduleSave(session);
    }

    return {
      ...INITIAL,

      async open(planId, store, now = systemNow) {
        const previous = current;
        const session: Session = {
          planId,
          store,
          now,
          undo: [],
          loaded: null,
          unsaved: false,
          timer: null,
          running: null,
          erasing: false,
          live: true,
          final: null,
          unread: false,
        };
        if (previous !== null) retire(previous, true);
        current = session;
        set({ ...INITIAL, planId });

        // A change the previous session still had unsaved is written before this plan is read.
        if (retiring !== null) await retiring;
        if (!isCurrent(session)) return;
        const opened = await openSafely(store, planId);
        if (!isCurrent(session)) return;

        switch (opened.kind) {
          case "ready":
            session.loaded = stampOf(opened.list);
            set({
              phase: "ready",
              list: opened.list,
              kept: true,
              notice: opened.repaired > 0 ? { kind: "repaired", unseated: opened.repaired } : null,
            });
            if (opened.repaired > 0) {
              session.unsaved = true;
              void saveLoop(session);
            }
            return;
          case "new":
            set({ phase: "ready", list: emptyGuestList(planId, now()), kept: true });
            return;
          case "unreadable":
            set({ phase: "unreadable", list: null });
            return;
          case "not-kept":
            session.unread = true;
            set({ phase: "ready", list: emptyGuestList(planId, now()), kept: false, unread: true });
            return;
          case "no-storage":
            // Nothing can be stored here, so nothing stored has gone unseen.
            set({ phase: "ready", list: emptyGuestList(planId, now()), kept: false });
            return;
        }
      },

      apply(change, opts) {
        const session = current;
        const list = get().list;
        if (session === null || list === null) return;
        let next: GuestList;
        try {
          next = change(list);
        } catch {
          return;
        }
        if (next === list) return;
        if (opts?.undo !== false) {
          session.undo.push(list);
          if (session.undo.length > UNDO_STEPS) session.undo.shift();
        }
        setChanged(session, next);
      },

      undo() {
        const session = current;
        const list = get().list;
        if (session === null || list === null) return;
        const previous = session.undo.pop();
        if (previous === undefined) return;
        setChanged(session, {
          ...list,
          guests: previous.guests,
          tables: previous.tables,
          title: previous.title,
          eventDate: previous.eventDate,
          sortBy: previous.sortBy,
          changedSincePrint: true,
        });
      },

      dismissNotice() {
        set({ notice: null });
      },

      async startAgain() {
        const session = current;
        if (session === null || get().phase !== "unreadable") return;
        // A session that has not read the device clears the page only.
        if (!session.unread) await eraseSafely(session.store, session.planId);
        if (!isCurrent(session) || get().phase !== "unreadable") return;
        session.undo = [];
        session.loaded = null;
        set({
          phase: "ready",
          list: emptyGuestList(session.planId, session.now()),
          kept: true,
          notice: null,
          canUndo: false,
        });
      },

      async eraseList() {
        const session = current;
        if (session === null || get().phase === "opening") return;
        session.erasing = true;
        clearTimer(session);
        session.unsaved = false;
        if (session.running !== null) await session.running;
        // A list this session never read is not erased unseen: only the page is cleared.
        if (!session.unread) await eraseSafely(session.store, session.planId);
        // Anything changed while erasing is dropped with the rest of the list.
        clearTimer(session);
        session.unsaved = false;
        session.erasing = false;
        if (!isCurrent(session)) return;
        session.undo = [];
        session.loaded = null;
        set({
          phase: "ready",
          list: emptyGuestList(session.planId, session.now()),
          notice: null,
          canUndo: false,
        });
      },

      async flush() {
        if (retiring !== null) await retiring;
        const session = current;
        if (session === null) return;
        clearTimer(session);
        if (session.running !== null) await session.running;
        if (session.unsaved) await saveLoop(session);
      },

      async refresh() {
        const session = current;
        if (session === null || get().phase !== "ready" || !quiet(session)) return;
        const opened = await openSafely(session.store, session.planId);
        // A change made here while reading goes first; so do a reset and another plan.
        if (!isCurrent(session) || get().phase !== "ready" || !quiet(session)) return;
        if (opened.kind === "new") {
          if (session.unread) {
            // Nothing is stored: the device has been read after all.
            session.unread = false;
            session.loaded = null;
            set({ unread: false, kept: true });
          } else if (session.loaded !== null) {
            // This session opened or saved a list that is no longer stored: another tab removed it.
            session.loaded = null;
            session.undo = [];
            set({
              list: emptyGuestList(session.planId, session.now()),
              kept: true,
              canUndo: false,
              notice: { kind: "removed-elsewhere" },
              takeUps: get().takeUps + 1,
            });
          }
          return;
        }
        if (opened.kind !== "ready") return;
        const stored = stampOf(opened.list);
        // The stored copy is the one this session loaded: there is nothing to take.
        if (session.loaded !== null && sameStamp(stored, session.loaded)) return;
        session.unread = false;
        session.loaded = stored;
        session.undo = [];
        set({
          list: opened.list,
          kept: true,
          unread: false,
          canUndo: false,
          notice: opened.repaired > 0 ? { kind: "repaired", unseated: opened.repaired } : get().notice,
          takeUps: get().takeUps + 1,
        });
        if (opened.repaired > 0) {
          session.unsaved = true;
          void saveLoop(session);
        }
      },

      reset() {
        if (current !== null) retire(current, false);
        current = null;
        set({ ...INITIAL });
      },
    };
  },
);

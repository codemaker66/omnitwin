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
import {
  anotherSheet,
  sameStamp,
  stampOf,
  type GuestListStore,
  type Opened,
  type Saved,
  type SaveOptions,
  type Stamp,
} from "../lib/guest-list/store.js";

/** A change is written to the device within this long of being made. */
export const AUTOSAVE_MS = 600;
/** How many changes undo can step back through. */
export const UNDO_STEPS = 30;

export type KitPhase = "opening" | "ready" | "unreadable";

export type KitNotice =
  | null
  | { readonly kind: "repaired"; readonly unseated: number }
  /** A save here went over a copy another tab had kept. */
  | { readonly kind: "other-tab" }
  /** The list this page held is no longer stored: an empty one was taken, and nothing was written back. */
  | { readonly kind: "removed-elsewhere" }
  /** The list was deleted in this tab, and a list another tab stored since has been taken up. */
  | { readonly kind: "added-after-delete" }
  /** This page's own sweep removed the list, past its removal day: an empty one was taken. */
  | { readonly kind: "removed-by-rule" }
  /** A print's save gave way to another tab's list: the sheet printed was of an older copy. */
  | { readonly kind: "print-of-older-copy" }
  /** The device refused a delete asked for here: the list is still kept, and still on the page. */
  | { readonly kind: "not-deleted" }
  /** Another tab is at work on the list: a change here is not kept yet, and is being tried again. */
  | { readonly kind: "other-tab-busy" }
  /** The Print button stopped before the dialog, as what it had just saved is not kept yet while another tab is busy: nothing was printed. */
  | { readonly kind: "print-held" }
  /** The page left this plan with a change waiting while another tab was busy with the list: that change was not kept. */
  | { readonly kind: "last-change-not-kept" };

export interface ApplyOptions {
  /** False for a change undo does not step back through. */
  readonly undo?: boolean;
  /**
   * For a change that gives way to another tab: while every change waiting is
   * such a change, the save writes nothing over a copy another tab has kept.
   * The page takes their list up instead and says so, and what this change
   * means on their list (this function's answer) is saved in its place: it
   * gives way in its turn to any copy stored since, until it lands.
   */
  readonly ifOtherCopy?: (theirs: GuestList) => GuestList;
}

/**
 * What a kit page tells the page state each time it mounts: whether the sweep
 * that mount ran first removed this plan's list (it was past its removal day).
 */
export interface MountRead {
  readonly sweptHere: boolean;
}

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
  /**
   * Opens a plan's list from the device. A page passes `mount` when its own
   * sweep ran first: when that sweep removed this plan's list and nothing is
   * stored, the empty list comes with a notice that the rule removed it.
   */
  open(planId: string, store: GuestListStore, now?: () => string, mount?: MountRead): Promise<void>;
  apply(change: (list: GuestList) => GuestList, opts?: ApplyOptions): void;
  undo(): void;
  dismissNotice(): void;
  /**
   * For "unreadable": removes the stored value that cannot be read and begins
   * a new list. A list another tab has stored there since is never erased: it
   * is taken up instead.
   */
  startAgain(): Promise<void>;
  /**
   * Deletes the list from the device and answers whether it is gone. Only a
   * delete that took leaves an empty list on the page. When the device refuses
   * it, the list is still kept: the page shows what is kept, never an empty
   * list over it, and says it could not be deleted.
   */
  eraseList(): Promise<boolean>;
  /** Saves now if anything is unsaved; resolves when no save is waiting or running. */
  flush(): Promise<void>;
  /**
   * Whether a change is still waiting to be kept, or being kept: true from a
   * change until its save has finished. For the page to ask before the tab is
   * closed over it.
   */
  changeWaiting(): boolean;
  /**
   * For the Print button, before it opens the dialog: whether a change is
   * still waiting because the last try to keep it found another tab busy with
   * the list. While it is, a sheet would leave with a number that is not on
   * the device, so the button stops; this then also says that nothing was
   * printed (but never in place of the word that a printout was made from an
   * older copy). False, and nothing said, in every other case, a device that
   * refuses to keep the list included: there the button prints as it did.
   */
  holdPrint(): boolean;
  /**
   * Takes up another tab's changes. When nothing here is unsaved and no save
   * is running, reads the device again and takes the stored list if it is not
   * the copy last opened or saved here, whichever way the two clocks point;
   * undo is cleared then, as its steps belong to the list before. A list that
   * is found stored after it was deleted in this tab is taken up with a
   * notice. When nothing is stored any more and this session had opened or
   * saved a list, it was removed elsewhere: an empty list is taken, undo is
   * cleared and the page says so, so the names are not written back. With a
   * change unsaved, nothing is read: the save says if it went over another
   * tab's copy, and writes nothing where the list has been removed.
   *
   * A kit page calls it on every mount over a list the page state already
   * holds, and passes `mount`: when that mount's own sweep removed the list,
   * the empty list's notice says the rule removed it, whether this read or a
   * later save is what finds it gone.
   */
  refresh(mount?: MountRead): Promise<void>;
  /**
   * A kit page is on the screen: it has mounted, or the browser has brought it
   * back from its back-forward cache. A change still waiting to be kept, with
   * no save scheduled or running for it, is saved shortly.
   */
  pageHere(): void;
  /**
   * A kit page has gone: it has unmounted, or the browser is hiding it as it is
   * left. Once no kit page is there, nothing stays scheduled, and a change still
   * waiting is tried once, at once; a save that finds another tab busy is then
   * not tried again until a page is back or the next change.
   */
  pageGone(): void;
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
  /** An ordinary change is among those waiting: the next save keeps this tab's list over any other. */
  ordinary: boolean;
  /** The latest waiting change that gives way to another tab's copy: what it means on their list. */
  ifOther: ((theirs: GuestList) => GuestList) | null;
  /**
   * The last try to keep what is waiting found another tab busy with the list.
   * Set by that answer, on the page's own session only; cleared as the next
   * try starts, and wherever nothing is waiting any more. It is not read from
   * the notice, which the planner can close.
   */
  waitingOnBusyTab: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  /** While erasing, nothing is saved. */
  erasing: boolean;
  /**
   * The list was deleted from the device in this tab, and this session has
   * stored none since. A list found stored while this stands was put there by
   * another tab after the delete, and the page says so when it takes it up.
   */
  erasedHere: boolean;
  /**
   * A mount's own sweep removed this plan's list, and the page has not yet
   * said so: when the list is next found gone, the rule is the reason given.
   */
  sweptHere: boolean;
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
/**
 * The plans whose last change was kept, after the page had left them, over a
 * copy another tab had stored. Nobody was on the page to be told, so the plan
 * says so when it is next opened.
 */
const wentOverAnother = new Set<string>();
/**
 * The plans whose last change was not kept, after the page had left them,
 * because another tab was busy with the list. Nobody was on the page to be
 * told, so the plan says so when it is next opened.
 */
const notKeptOnLeaving = new Set<string>();
/**
 * How many kit pages are on the screen. A save that found another tab busy is
 * tried again only while one is, so no timer outlives the page.
 */
let pagesHere = 0;

async function openSafely(store: GuestListStore, planId: string): Promise<Opened> {
  try {
    return await store.open(planId);
  } catch {
    return { kind: "not-kept" };
  }
}

async function saveSafely(store: GuestListStore, list: GuestList, loaded: Stamp | null, opts: SaveOptions): Promise<Saved> {
  try {
    return await store.save(list, loaded, opts);
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

async function eraseUnreadableSafely(store: GuestListStore, planId: string): Promise<void> {
  try {
    await store.eraseUnreadable(planId);
  } catch {
    // Storage refused; what is stored stays as it was.
  }
}

/** Drops whatever was waiting to be kept. */
function nothingWaiting(session: Session): void {
  session.unsaved = false;
  session.ordinary = false;
  session.ifOther = null;
  session.waitingOnBusyTab = false;
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
    /** What is waiting now, read afresh after a wait: a change made meanwhile sets these again. */
    const waitingNow = (session: Session): Pick<Session, "ordinary" | "ifOther"> => ({ ordinary: session.ordinary, ifOther: session.ifOther });

    /**
     * The page takes an empty list in place of one that is no longer stored,
     * and says why: this page's own sweep removed it under the rule, or it was
     * removed elsewhere. Undo goes too: its steps belong to the list that was
     * removed. Nothing is left to save, so the names are not written back.
     */
    function takeEmpty(session: Session): void {
      const notice: KitNotice = session.sweptHere ? { kind: "removed-by-rule" } : { kind: "removed-elsewhere" };
      session.sweptHere = false;
      clearTimer(session);
      nothingWaiting(session);
      session.loaded = null;
      session.undo = [];
      set({
        list: emptyGuestList(session.planId, session.now()),
        kept: true,
        canUndo: false,
        notice,
        takeUps: get().takeUps + 1,
      });
    }

    /**
     * Saves one at a time, in order, always the latest list, until nothing is
     * unsaved. A "not-kept" answer stops the loop; the next change tries again.
     * A "busy" answer stops it too: the change waits, and is tried again
     * shortly while a kit page is there; a session no longer on the page drops
     * it, and its plan says so when it is next opened.
     * An unread session reads the device first and writes only when nothing is
     * stored; otherwise the change stays unsaved and the list is not kept.
     * When the list has been removed from the device since this session loaded
     * it, nothing is written: the page takes an empty list and says so, and a
     * session no longer on the page drops its change.
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
          // What is waiting, taken with the list: the save gives way to another tab's copy only
          // while every change waiting is one that asked to.
          const waiting = waitingNow(session);
          const givesWay = waiting.ordinary ? null : waiting.ifOther;
          session.unsaved = false;
          session.ordinary = false;
          session.ifOther = null;
          // A try starts here: what the try before it found no longer stands.
          session.waitingOnBusyTab = false;
          if (list === null) return;
          const answer = await saveSafely(session.store, list, session.loaded, { yieldToOther: givesWay !== null });
          const since = waitingNow(session);
          if (answer.kind === "not-kept") {
            // What was waiting is waiting again, with whatever has been changed since.
            session.unsaved = true;
            session.ordinary = since.ordinary || waiting.ordinary;
            session.ifOther = since.ifOther ?? waiting.ifOther;
            if (isCurrent(session)) set({ kept: false });
            return;
          }
          if (answer.kind === "busy") {
            // Another tab is at work on the lists and did not finish in time. Nothing was written.
            if (!isCurrent(session)) {
              // The page has gone to another plan: nothing waits on that tab for it. The change is
              // dropped, and the plan says so when it is next opened.
              nothingWaiting(session);
              notKeptOnLeaving.add(session.planId);
              return;
            }
            // The change stays on the page, and the page says so. It is tried again shortly while a
            // kit page is there; with none, it waits here for a page to come back, or the next change.
            session.unsaved = true;
            session.ordinary = since.ordinary || waiting.ordinary;
            session.ifOther = since.ifOther ?? waiting.ifOther;
            // Remembered for the Print button, which opens no dialog while this stands.
            session.waitingOnBusyTab = true;
            // The word that a printout was made from an older copy is never put away for this one:
            // the planner still has that sheet in hand. Nor is the word that a print was held: it
            // says the same of the other tab, and what to do about the print.
            const showing = get().notice?.kind;
            if (showing !== "print-of-older-copy" && showing !== "print-held") set({ notice: { kind: "other-tab-busy" } });
            if (pagesHere > 0) scheduleSave(session);
            return;
          }
          if (answer.kind === "removed-elsewhere") {
            // A change made while this save ran belongs to the removed list, and goes with it.
            if (isCurrent(session)) takeEmpty(session);
            else nothingWaiting(session);
            return;
          }
          if (answer.kind === "other-kept") {
            const theirs = answer.list;
            const onTheirs = since.ifOther ?? givesWay;
            // An ordinary change was made here while this save ran (or the answer was not asked for):
            // this tab's list is kept after all, by an ordinary save that says so.
            if (since.ordinary || onTheirs === null) {
              session.unsaved = true;
              session.ordinary = true;
              continue;
            }
            // Their list stands. This tab takes it up, and what its change means on their list is
            // saved by the next turn of the loop, still as a change that gives way: a copy a third
            // tab has stored by then is taken up in its turn, with the same change made on it, and
            // so on until the save lands. Only an ordinary change made here meanwhile makes that
            // save an ordinary one.
            let next: GuestList;
            try {
              next = onTheirs(theirs);
            } catch {
              next = theirs;
            }
            next = { ...next, updatedAt: session.now() };
            session.loaded = stampOf(theirs);
            session.undo = [];
            session.erasedHere = false;
            session.sweptHere = false;
            session.unsaved = true;
            session.ordinary = false;
            session.ifOther = onTheirs;
            if (isCurrent(session)) {
              set({
                list: next,
                kept: true,
                canUndo: false,
                notice: { kind: "print-of-older-copy" },
                takeUps: get().takeUps + 1,
              });
            } else {
              session.final = next;
            }
            continue;
          }
          session.loaded = answer.stamp;
          // This session has stored a list itself since any delete here, or any sweep.
          session.erasedHere = false;
          session.sweptHere = false;
          if (isCurrent(session)) {
            set({ kept: true });
            // The change that was waiting on another tab is kept now. The word that a print was
            // held is left showing: it still says what to do, and the Print button puts it away.
            if (get().notice?.kind === "other-tab-busy") set({ notice: null });
            // This save went over a copy another tab had kept, and the page says so. The word that
            // a printout was made from an older copy is never put away for it: it still holds, and
            // it is the one that asks something of the planner.
            if (answer.kind === "saved-over-other" && get().notice?.kind !== "print-of-older-copy") {
              set({ notice: { kind: "other-tab" } });
            }
            // The device kept another tab's print record with this list: its sheet has a larger
            // number, or the same number printed at another moment. The page takes that record too,
            // marked changed since, so its next print takes the next number and no later sheet is
            // given one a sheet has carried.
            const onPage = get().list;
            if (answer.paper !== undefined && onPage !== null && anotherSheet(answer.paper, onPage)) {
              set({ list: { ...onPage, ...answer.paper } });
            }
          } else if (answer.kind === "saved-over-other") {
            // Nobody is on this plan's page to be told: it is said when the plan is next opened.
            wentOverAnother.add(session.planId);
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
      else nothingWaiting(session);
      session.live = false;
      const running = session.unsaved ? saveLoop(session) : session.running;
      if (running === null) return;
      retiring = running;
      void running.then(() => {
        if (retiring === running) retiring = null;
      });
    }

    /**
     * Puts the session's list in place, stamped now, and asks for a save: an
     * ordinary one, unless the change is one that gives way to another tab.
     */
    function setChanged(session: Session, list: GuestList, ifOtherCopy?: (theirs: GuestList) => GuestList): void {
      set({ list: { ...list, updatedAt: session.now() }, canUndo: session.undo.length > 0 });
      if (ifOtherCopy === undefined) session.ordinary = true;
      else session.ifOther = ifOtherCopy;
      scheduleSave(session);
    }

    /** A repair made on reading is kept at once, as an ordinary change. */
    function saveRepair(session: Session): void {
      session.unsaved = true;
      session.ordinary = true;
      void saveLoop(session);
    }

    return {
      ...INITIAL,

      async open(planId, store, now = systemNow, mount) {
        const previous = current;
        const session: Session = {
          planId,
          store,
          now,
          undo: [],
          loaded: null,
          unsaved: false,
          ordinary: false,
          ifOther: null,
          waitingOnBusyTab: false,
          timer: null,
          running: null,
          erasing: false,
          erasedHere: false,
          sweptHere: false,
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
          case "ready": {
            session.loaded = stampOf(opened.list);
            // A change left waiting when the page last went from this plan was kept over another tab's copy,
            // or was not kept at all, as another tab was busy with the list. A repair is said before either.
            const keptOverAnother = wentOverAnother.delete(planId);
            const notKept = notKeptOnLeaving.delete(planId);
            let notice: KitNotice = keptOverAnother ? { kind: "other-tab" } : null;
            if (notKept) notice = { kind: "last-change-not-kept" };
            if (opened.repaired > 0) notice = { kind: "repaired", unseated: opened.repaired };
            set({
              phase: "ready",
              list: opened.list,
              kept: true,
              notice,
            });
            if (opened.repaired > 0) {
              saveRepair(session);
            }
            return;
          }
          case "new": {
            // The first change made to this plan's list was not kept when the page left it.
            const notKept = notKeptOnLeaving.delete(planId);
            let notice: KitNotice = notKept ? { kind: "last-change-not-kept" } : null;
            // The page's own sweep removed the list just before this read, and nothing is stored: say why.
            if (mount?.sweptHere === true) notice = { kind: "removed-by-rule" };
            set({ phase: "ready", list: emptyGuestList(planId, now()), kept: true, notice });
            return;
          }
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
        setChanged(session, next, opts?.ifOtherCopy);
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
        if (!session.unread) {
          // Only a value that still cannot be read is removed, compared and deleted in one step of
          // the device: another tab may have started a list here since this page found a value it
          // could not read, and a list is never erased. The device is read after that, so such a
          // list is taken up.
          await eraseUnreadableSafely(session.store, session.planId);
          const now = await openSafely(session.store, session.planId);
          if (!isCurrent(session) || get().phase !== "unreadable") return;
          if (now.kind === "ready") {
            session.undo = [];
            session.loaded = stampOf(now.list);
            set({
              phase: "ready",
              list: now.list,
              kept: true,
              notice: now.repaired > 0 ? { kind: "repaired", unseated: now.repaired } : null,
              canUndo: false,
              takeUps: get().takeUps + 1,
            });
            if (now.repaired > 0) saveRepair(session);
            return;
          }
        }
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
        if (session === null || get().phase === "opening") return false;
        session.erasing = true;
        clearTimer(session);
        nothingWaiting(session);
        if (session.running !== null) await session.running;
        // A list this session never read is not erased unseen: only the page is cleared.
        let gone = true;
        let stillKept: GuestList | null = null;
        if (!session.unread) {
          await eraseSafely(session.store, session.planId);
          // The device is read again: only a delete seen to have taken is remembered, and only that
          // empties the page. A device that refused it still holds the list.
          const after = await openSafely(session.store, session.planId);
          gone = after.kind === "new" || after.kind === "no-storage";
          session.erasedHere = after.kind === "new";
          if (after.kind === "ready") stillKept = after.list;
        }
        // Anything changed while erasing is dropped with the rest of the list.
        clearTimer(session);
        nothingWaiting(session);
        session.erasing = false;
        if (!isCurrent(session)) return gone;
        session.undo = [];
        if (!gone) {
          // The delete was refused, or could not be seen to have taken. A list stays on the page
          // (what the device still holds, when that could be read) and the page says so.
          if (stillKept !== null) {
            session.loaded = stampOf(stillKept);
            set({ phase: "ready", list: stillKept, kept: true, notice: { kind: "not-deleted" }, canUndo: false });
          } else {
            set({ notice: { kind: "not-deleted" }, canUndo: false });
          }
          return false;
        }
        session.loaded = null;
        set({
          phase: "ready",
          list: emptyGuestList(session.planId, session.now()),
          notice: null,
          canUndo: false,
        });
        return true;
      },

      async flush() {
        if (retiring !== null) await retiring;
        const session = current;
        if (session === null) return;
        clearTimer(session);
        if (session.running !== null) await session.running;
        if (session.unsaved) await saveLoop(session);
      },

      changeWaiting() {
        // A list left for another plan is still being kept.
        if (retiring !== null) return true;
        const session = current;
        return session !== null && (session.unsaved || session.running !== null);
      },

      holdPrint() {
        const session = current;
        if (session === null || !session.unsaved || !session.waitingOnBusyTab) return false;
        // Said in place of whatever is showing, but for the word that a printout was made from an
        // older copy: that one is never put away for another.
        if (get().notice?.kind !== "print-of-older-copy") set({ notice: { kind: "print-held" } });
        return true;
      },

      async refresh(mount) {
        const session = current;
        if (session === null) return;
        // Remembered even when nothing is read now: a change still unsaved goes first, and its save finds the list gone.
        if (mount?.sweptHere === true) session.sweptHere = true;
        if (get().phase !== "ready" || !quiet(session)) return;
        const opened = await openSafely(session.store, session.planId);
        // A change made here while reading goes first; so do a reset and another plan.
        if (!isCurrent(session) || get().phase !== "ready" || !quiet(session)) return;
        if (opened.kind === "new") {
          if (session.unread) {
            // Nothing is stored: the device has been read after all.
            session.unread = false;
            session.loaded = null;
            set({ unread: false, kept: true });
          }
          // This session opened or saved a list that is no longer stored, or this page's sweep has just removed one.
          if (session.loaded !== null || session.sweptHere) takeEmpty(session);
          return;
        }
        if (opened.kind !== "ready") return;
        const stored = stampOf(opened.list);
        // The stored copy is the one this session loaded: there is nothing to take.
        if (session.loaded !== null && sameStamp(stored, session.loaded)) return;
        // A list is stored after all: whatever the sweep removed, this one was stored since.
        session.sweptHere = false;
        // Deleted in this tab, and stored again since: another tab added these names.
        const addedAfterDelete = session.erasedHere;
        session.erasedHere = false;
        session.unread = false;
        session.loaded = stored;
        session.undo = [];
        // What the page was saying belonged to the copy before, and goes with it. Only the word that
        // a printout was made from an older copy still holds over the list now taken up.
        const before = get().notice;
        let notice: KitNotice = before?.kind === "print-of-older-copy" ? before : null;
        if (addedAfterDelete) notice = { kind: "added-after-delete" };
        else if (opened.repaired > 0) notice = { kind: "repaired", unseated: opened.repaired };
        set({
          list: opened.list,
          kept: true,
          unread: false,
          canUndo: false,
          notice,
          takeUps: get().takeUps + 1,
        });
        if (opened.repaired > 0) {
          saveRepair(session);
        }
      },

      pageHere() {
        pagesHere += 1;
        const session = current;
        // A change left waiting while no page was here (another tab was busy) is tried again shortly.
        if (session !== null && session.unsaved && session.timer === null && session.running === null && !session.erasing) {
          scheduleSave(session);
        }
      },

      pageGone() {
        pagesHere = Math.max(0, pagesHere - 1);
        const session = current;
        if (pagesHere > 0 || session === null) return;
        // No page is left to wait on: nothing stays scheduled, and a change still waiting is tried
        // once, now. An ordinary change made a moment before leaving is kept so.
        clearTimer(session);
        if (session.unsaved && !session.erasing) void saveLoop(session);
      },

      reset() {
        if (current !== null) retire(current, false);
        current = null;
        pagesHere = 0;
        wentOverAnother.clear();
        notKeptOnLeaving.clear();
        set({ ...INITIAL });
      },
    };
  },
);

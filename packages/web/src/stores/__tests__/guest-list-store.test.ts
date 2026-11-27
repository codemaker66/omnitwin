import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../lib/idb-cache.js";
import { emptyGuestList, printedFromOlderCopy, type Guest, type GuestList } from "../../lib/guest-list/model.js";
import { markPrinted } from "../../lib/guest-list/paper.js";
import {
  createGuestListStore,
  stampOf,
  type GuestListStore,
  type Opened,
  type Saved,
  type Stamp,
} from "../../lib/guest-list/store.js";
import { AUTOSAVE_MS, UNDO_STEPS, useGuestListStore } from "../guest-list-store.js";

const PLAN_A = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const PLAN_B = "6c1b7a1f-8a1c-4e8f-8d4b-3a7a7a1b2c22";
const START = "2026-11-13T10:00:00.000Z";
const CANARY = "CANARY-Q7";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function guest(n: number, tableId: string | null = null, seat: number | null = null): Guest {
  return { id: uuid(1000 + n), name: `Guest ${String(n)}`, party: "", tableId, seat };
}

/** A clock that moves on one second each time it is read. */
function clock(): () => string {
  let ms = Date.parse(START);
  return () => {
    ms += 1000;
    return new Date(ms).toISOString();
  };
}

function device(): { backend: CacheBackend; store: GuestListStore } {
  const backend = memoryBackend();
  return { backend, store: createGuestListStore(withBackend<unknown>(backend)) };
}

const state = () => useGuestListStore.getState();

const titled = (title: string) => (list: GuestList): GuestList => ({ ...list, title });

/** What another device store over the same backend finds: what a reload would open. */
async function reopened(backend: CacheBackend, planId: string): Promise<Opened> {
  return createGuestListStore(withBackend<unknown>(backend)).open(planId);
}

function storedTitle(opened: Opened): string | null {
  return opened.kind === "ready" ? opened.list.title : null;
}

/** Another tab of the same browser: a device store of its own over the same storage, used directly. */
function otherTabOn(backend: CacheBackend): GuestListStore {
  return createGuestListStore(withBackend<unknown>(backend));
}

/** What a tab holds after opening the plan: the list and the stamp of the copy it loaded. */
async function loadedBy(tab: GuestListStore, planId: string): Promise<{ readonly list: GuestList; readonly stamp: Stamp }> {
  const opened = await tab.open(planId);
  if (opened.kind !== "ready") throw new Error("nothing stored to load");
  return { list: opened.list, stamp: stampOf(opened.list) };
}

/** A clock that gives each of `moments` in turn, then stays on the last. */
function clockOf(moments: readonly string[]): () => string {
  let at = 0;
  return () => {
    const moment = moments[Math.min(at, moments.length - 1)] ?? START;
    at += 1;
    return moment;
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  state().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guest list page state: constants", () => {
  it("saves within 600 ms and keeps thirty undo steps", () => {
    expect(AUTOSAVE_MS).toBe(600);
    expect(UNDO_STEPS).toBe(30);
  });
});

describe("guest list page state: opening", () => {
  it("opens a new list in memory and writes nothing until the first change", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    const opening = state().open(PLAN_A, store, clock());
    expect(state().planId).toBe(PLAN_A);
    expect(state().phase).toBe("opening");
    await opening;

    expect(state().phase).toBe("ready");
    expect(state().kept).toBe(true);
    expect(state().list).toEqual(emptyGuestList(PLAN_A, "2026-11-13T10:00:01.000Z"));
    expect(state().canUndo).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(await reopened(backend, PLAN_A)).toEqual({ kind: "new" });
  });

  it("opens a stored list as it was kept", async () => {
    const { store } = device();
    const kept = { ...emptyGuestList(PLAN_A, START), title: "Dinner", guests: [guest(1)] };
    expect((await store.save(kept, null)).kind).toBe("saved");

    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("ready");
    expect(state().list).toEqual({ ...kept, revision: 1 });
    expect(state().kept).toBe(true);
    expect(state().notice).toBeNull();
  });

  it("says how many guests a repair put back to seat, and saves the repaired list", async () => {
    const { backend, store } = device();
    const table = { id: uuid(1), number: 1, name: "", seats: 2 };
    const broken = {
      ...emptyGuestList(PLAN_A, START),
      tables: [table],
      guests: [guest(1, table.id, 1), guest(2, uuid(99), 1), guest(3, table.id, 5)],
    };
    await withBackend<unknown>(backend).put(PLAN_A, broken);
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    expect(state().notice).toEqual({ kind: "repaired", unseated: 2 });
    await state().flush();
    expect(save).toHaveBeenCalledTimes(1);
    const again = await reopened(backend, PLAN_A);
    expect(again.kind === "ready" ? again.repaired : -1).toBe(0);
    expect(again.kind === "ready" ? again.list.guests.map((g) => g.tableId) : []).toEqual([
      table.id,
      null,
      null,
    ]);

    state().dismissNotice();
    expect(state().notice).toBeNull();
  });

  it("leaves the list empty while what is stored cannot be read, until start again", async () => {
    const { backend, store } = device();
    await withBackend<unknown>(backend).put(PLAN_A, { planId: PLAN_A, guests: "not a list" });

    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("unreadable");
    expect(state().list).toBeNull();
    state().apply(titled("Ignored"));
    expect(state().list).toBeNull();
    expect(state().canUndo).toBe(false);

    await state().startAgain();
    expect(state().phase).toBe("ready");
    expect(state().list?.planId).toBe(PLAN_A);
    expect(state().list?.guests).toEqual([]);
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("works in memory when storage refuses, and says the list is not kept", async () => {
    const refuse = (): Promise<never> => Promise.reject(new Error(`refused ${CANARY}`));
    const refusing: CacheBackend = { get: refuse, put: refuse, delete: refuse, deleteIf: refuse, upsert: refuse, list: refuse };
    const store = createGuestListStore(withBackend<unknown>(refusing));

    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("ready");
    expect(state().kept).toBe(false);
    state().apply(titled("Dinner"));
    await state().flush();
    expect(state().kept).toBe(false);
    expect(state().list?.title).toBe("Dinner");
  });

  it("does not let an older open's answer overwrite a newer open", async () => {
    const { store } = device();
    const slow = deferred<Opened>();
    vi.spyOn(store, "open").mockImplementation((planId) =>
      planId === PLAN_A ? slow.promise : Promise.resolve({ kind: "new" }),
    );

    const first = state().open(PLAN_A, store, clock());
    await state().open(PLAN_B, store, clock());
    slow.resolve({ kind: "ready", list: emptyGuestList(PLAN_A, START), repaired: 3 });
    await first;

    expect(state().planId).toBe(PLAN_B);
    expect(state().phase).toBe("ready");
    expect(state().list?.planId).toBe(PLAN_B);
    expect(state().notice).toBeNull();
  });

  it("does not let an older open's answer overwrite a newer open of the same plan", async () => {
    const { store } = device();
    const slow = deferred<Opened>();
    const fresh = { ...emptyGuestList(PLAN_A, START), title: "Newer" };
    vi.spyOn(store, "open")
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => Promise.resolve({ kind: "ready", list: fresh, repaired: 0 }));

    const first = state().open(PLAN_A, store, clock());
    await state().open(PLAN_A, store, clock());
    slow.resolve({ kind: "unreadable" });
    await first;

    expect(state().phase).toBe("ready");
    expect(state().list?.title).toBe("Newer");
  });
});

describe("guest list page state: changes and autosave", () => {
  it("saves a change within 600 ms", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    state().apply(titled("Dinner"));
    expect(state().list?.title).toBe("Dinner");
    expect(state().list?.updatedAt).toBe("2026-11-13T10:00:02.000Z");
    expect(state().canUndo).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    await state().flush();

    expect(state().kept).toBe(true);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Dinner");
  });

  it("makes one save holding the later list for two changes inside 600 ms, without restarting the timer", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    state().apply(titled("First"));
    await vi.advanceTimersByTimeAsync(400);
    state().apply(titled("Second"));
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].title).toBe("Second");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Second");
  });

  it("passes the stamp of the copy it opened or last saved, so another tab's copy is noticed", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    state().apply(titled("One"));
    await state().flush();
    const firstSaved = state().list?.updatedAt;
    state().apply(titled("Two"));
    await state().flush();
    const secondSaved = state().list?.updatedAt;
    state().apply(titled("Three"));
    await state().flush();

    expect(save.mock.calls[0]?.[1]).toBeNull();
    expect(save.mock.calls[1]?.[1]).toEqual({ revision: 1, updatedAt: firstSaved });
    expect(save.mock.calls[2]?.[1]).toEqual({ revision: 2, updatedAt: secondSaved });
  });

  it("opens a stored list and passes its stamp with the first save", async () => {
    const { backend, store } = device();
    await withBackend<unknown>(backend).put(PLAN_A, { ...emptyGuestList(PLAN_A, START), title: "Kept", revision: 7 });
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Changed"));
    await state().flush();

    expect(save.mock.calls[0]?.[1]).toEqual({ revision: 7, updatedAt: START });
    expect(state().notice).toBeNull();
    expect((await loadedBy(otherTabOn(backend), PLAN_A)).stamp.revision).toBe(8);
  });

  it("never reads the revision from the page's list: its own saves are not mistaken for another tab's", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    for (const title of ["One", "Two", "Three"]) {
      state().apply(titled(title));
      await state().flush();
      expect(state().notice).toBeNull();
    }
    // The device counts three saves.
    expect((await loadedBy(otherTabOn(backend), PLAN_A)).stamp.revision).toBe(3);

    // Whatever the page's list says its revision is, the save goes by the stamp of the copy loaded.
    state().apply((list) => ({ ...list, title: "Four", revision: 99 }));
    await state().flush();
    expect(state().notice).toBeNull();
    expect((await loadedBy(otherTabOn(backend), PLAN_A)).stamp.revision).toBe(4);
  });

  it("makes no undo step and no save for a change that changes nothing", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    const before = state().list;

    state().apply((list) => list);
    expect(state().list).toBe(before);
    expect(state().canUndo).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it("makes no undo step when asked not to, and still saves", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    state().apply(titled("Dinner"), { undo: false });
    expect(state().list?.title).toBe("Dinner");
    expect(state().canUndo).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at once on flush when a save is waiting", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    state().apply(titled("Dinner"));
    await state().flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Dinner");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("waits on flush for a save already running, then saves what changed meanwhile", async () => {
    const { backend, store } = device();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    const save = vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded) => {
      await gate.promise;
      return real(list, loaded);
    });
    await state().open(PLAN_A, store, clock());

    state().apply(titled("First"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    state().apply(titled("Second"));
    let flushed = false;
    const flushing = state().flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    gate.resolve(undefined);
    await flushing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Second");
  });

  it("keeps the list in memory when a save is not kept, and tries again after the next change", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save").mockResolvedValueOnce({ kind: "not-kept" });
    await state().open(PLAN_A, store, clock());

    state().apply(titled("First"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(state().kept).toBe(false);
    expect(state().list?.title).toBe("First");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);

    state().apply(titled("Second"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    await state().flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(state().kept).toBe(true);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Second");
  });

  it("says when another tab had kept a copy this tab had not loaded, and keeps this one", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();

    // Another tab saves a later copy of the same list.
    const otherTab = createGuestListStore(withBackend<unknown>(backend));
    const theirs = { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), title: "Theirs" };
    expect((await otherTab.save(theirs, null)).kind).toBe("saved-over-other");

    state().apply(titled("Ours again"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(state().kept).toBe(true);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Ours again");
  });

  it("saves a change still waiting when another plan is opened, before reading the new plan", async () => {
    const { backend, store } = device();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    const save = vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded) => {
      await gate.promise;
      return real(list, loaded);
    });
    const open = vi.spyOn(store, "open");
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Plan A dinner"));

    const opening = state().open(PLAN_B, store, clock());
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    let flushed = false;
    const flushing = state().flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);

    gate.resolve(undefined);
    await opening;
    await flushing;
    expect(open).toHaveBeenCalledTimes(2);
    expect(state().list?.planId).toBe(PLAN_B);
    expect(state().list?.title).toBe("");
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Plan A dinner");
  });

  it("does nothing, and throws nothing, when a change throws", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock());
    const before = state().list;

    expect(() => {
      state().apply(() => {
        throw new Error(CANARY);
      });
    }).not.toThrow();
    expect(state().list).toBe(before);
    expect(state().canUndo).toBe(false);
  });
});

describe("guest list page state: whether a change is still waiting to be kept", () => {
  it("is true from a change until its save has finished, and false before and after", async () => {
    const { store } = device();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded, opts) => {
      await gate.promise;
      return real(list, loaded, opts);
    });
    expect(state().changeWaiting()).toBe(false);
    await state().open(PLAN_A, store, clock());
    expect(state().changeWaiting()).toBe(false);

    // Waiting to be kept: inside the autosave's 600 ms.
    state().apply(titled("Dinner"));
    expect(state().changeWaiting()).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(state().changeWaiting()).toBe(true);

    // Being kept: the save has started and has not answered.
    await vi.advanceTimersByTimeAsync(1);
    expect(state().changeWaiting()).toBe(true);

    gate.resolve(undefined);
    await state().flush();
    expect(state().changeWaiting()).toBe(false);
  });

  it("is true while a list left for another plan is still being kept", async () => {
    const { store } = device();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded, opts) => {
      await gate.promise;
      return real(list, loaded, opts);
    });
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Plan A dinner"));
    const opening = state().open(PLAN_B, store, clock());
    expect(state().changeWaiting()).toBe(true);
    gate.resolve(undefined);
    await opening;
    await state().flush();
    expect(state().changeWaiting()).toBe(false);
  });

  it("stays true while the device is not keeping the change, and is false once the page state is reset", async () => {
    const { store } = device();
    vi.spyOn(store, "save").mockResolvedValue({ kind: "not-kept" });
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));
    await state().flush();
    expect(state().kept).toBe(false);
    expect(state().changeWaiting()).toBe(true);
    state().reset();
    expect(state().changeWaiting()).toBe(false);
  });
});

describe("guest list page state: undo", () => {
  it("returns to the opened list after thirty changes and thirty-one undos", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock());
    const opened = state().list;

    for (let i = 1; i <= 30; i += 1) {
      state().apply((list) => ({ ...list, title: `Step ${String(i)}`, guests: [...list.guests, guest(i)] }));
    }
    expect(state().list?.guests).toHaveLength(30);
    for (let i = 0; i < 31; i += 1) state().undo();

    expect(state().canUndo).toBe(false);
    expect(state().list?.title).toBe(opened?.title);
    expect(state().list?.guests).toEqual(opened?.guests);
    expect(state().list?.tables).toEqual(opened?.tables);
  });

  it("keeps thirty undo steps from thirty-one changes, dropping the oldest", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock());

    for (let i = 1; i <= 31; i += 1) state().apply(titled(`Step ${String(i)}`));
    for (let i = 0; i < 30; i += 1) {
      expect(state().canUndo).toBe(true);
      state().undo();
    }
    expect(state().canUndo).toBe(false);
    expect(state().list?.title).toBe("Step 1");
  });

  it("keeps the paper version and printed time on undo after a print, and marks the list changed since", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    state().apply((list) => ({ ...list, title: "Dinner", eventDate: "2027-02-14", sortBy: "first-word" }));
    state().apply(
      (list) => ({
        ...list,
        paperVersion: list.paperVersion + 1,
        printedAt: "2026-11-13T12:00:00.000Z",
        changedSincePrint: false,
      }),
      { undo: false },
    );
    await state().flush();
    const printedUpdatedAt = state().list?.updatedAt;

    state().undo();
    const undone = state().list;
    expect(undone?.title).toBe("");
    expect(undone?.eventDate).toBeNull();
    expect(undone?.sortBy).toBe("last-word");
    expect(undone?.paperVersion).toBe(1);
    expect(undone?.printedAt).toBe("2026-11-13T12:00:00.000Z");
    expect(undone?.changedSincePrint).toBe(true);
    expect(undone?.updatedAt).not.toBe(printedUpdatedAt);
    expect(state().canUndo).toBe(false);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual(undone);
  });

  it("does nothing on undo with nothing to undo", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    const before = state().list;

    state().undo();
    expect(state().list).toBe(before);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("guest list page state: erasing and resetting", () => {
  it("erases the stored list and leaves a new empty list with no undo and no notice", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));
    await state().flush();
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    useGuestListStore.setState({ notice: { kind: "other-tab" } });

    await state().eraseList();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().phase).toBe("ready");
    expect(state().list?.planId).toBe(PLAN_A);
    expect(state().list?.title).toBe("");
    expect(state().list?.guests).toEqual([]);
    expect(state().canUndo).toBe(false);
    expect(state().notice).toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    await state().flush();
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("waits for a running save before erasing, so nothing is left stored", async () => {
    const { backend, store } = device();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded) => {
      await gate.promise;
      return real(list, loaded);
    });
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);

    const erasing = state().eraseList();
    gate.resolve(undefined);
    await erasing;
    await vi.advanceTimersByTimeAsync(5000);
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().list?.title).toBe("");
  });

  it("cancels a waiting save on reset and returns to the start", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));

    state().reset();
    expect(state().planId).toBeNull();
    expect(state().phase).toBe("opening");
    expect(state().list).toBeNull();
    expect(state().kept).toBe(true);
    expect(state().notice).toBeNull();
    expect(state().canUndo).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(await backend.get(PLAN_A)).toBeNull();
  });
});

/** Refuses the first `count` reads, then works: storage that comes back after a failed open. */
function readsRefusedAtFirst(inner: CacheBackend, count: number): CacheBackend {
  let refusals = count;
  return {
    ...inner,
    get: (key) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(new Error(`refused ${CANARY}`));
      }
      return inner.get(key);
    },
  };
}

describe("guest list page state: a list the device could not read is never overwritten unread", () => {
  const storedList = {
    ...emptyGuestList(PLAN_A, START),
    title: "Kept dinner",
    guests: Array.from({ length: 200 }, (_, i) => guest(i + 1)),
  };

  it("writes nothing over a stored list it could not read at open", async () => {
    const inner = memoryBackend();
    await withBackend<unknown>(inner).put(PLAN_A, storedList);
    const before = JSON.stringify(await inner.get(PLAN_A));
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    expect(state().kept).toBe(false);
    expect(state().list?.guests).toEqual([]);
    state().apply((list) => ({ ...list, guests: [guest(900)] }));
    await state().flush();

    expect(JSON.stringify(await inner.get(PLAN_A))).toBe(before);
    expect(save).not.toHaveBeenCalled();
    expect(state().kept).toBe(false);
    expect(state().notice).toBeNull();
    expect(state().list?.guests).toEqual([guest(900)]);

    // Every later attempt reads again and still writes nothing.
    state().apply((list) => ({ ...list, guests: [...list.guests, guest(901)] }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    await state().flush();
    expect(JSON.stringify(await inner.get(PLAN_A))).toBe(before);
    expect(save).not.toHaveBeenCalled();
    expect(state().kept).toBe(false);
  });

  it("writes nothing over an unreadable stored value it could not read at open", async () => {
    const inner = memoryBackend();
    await withBackend<unknown>(inner).put(PLAN_A, { planId: PLAN_A, guests: "not a list" });
    const before = JSON.stringify(await inner.get(PLAN_A));
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    expect(state().kept).toBe(false);
    state().apply(titled("Typed since"));
    await state().flush();

    expect(JSON.stringify(await inner.get(PLAN_A))).toBe(before);
    expect(save).not.toHaveBeenCalled();
    expect(state().kept).toBe(false);
    expect(state().notice).toBeNull();
  });

  it("saves as usual once a second read finds nothing stored", async () => {
    const inner = memoryBackend();
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    expect(state().kept).toBe(false);
    state().apply(titled("Dinner"));
    await state().flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toBeNull();
    expect(storedTitle(await reopened(inner, PLAN_A))).toBe("Dinner");
    expect(state().kept).toBe(true);
    expect(state().notice).toBeNull();
  });

  it("writes nothing while reads keep failing, and tries again at the next change", async () => {
    const inner = memoryBackend();
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1000)));
    const open = vi.spyOn(store, "open");
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));
    await state().flush();
    expect(open).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    expect(await inner.get(PLAN_A)).toBeNull();
    expect(state().kept).toBe(false);
    expect(state().list?.title).toBe("Dinner");

    // The next change's autosave reads again; the change stays unsaved, so flush reads once more.
    state().apply(titled("Dinner for two"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(open).toHaveBeenCalledTimes(3);
    await state().flush();
    expect(open).toHaveBeenCalledTimes(4);
    expect(save).not.toHaveBeenCalled();
    expect(await inner.get(PLAN_A)).toBeNull();
    expect(state().kept).toBe(false);
  });

  it("says the session is unread until a read succeeds, and a browser with no storage is not unread", async () => {
    const inner = memoryBackend();
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    await state().open(PLAN_A, store, clock());
    expect(state().unread).toBe(true);
    expect(state().kept).toBe(false);
    state().apply(titled("Dinner"));
    await state().flush();
    // The second read found nothing stored, so the session is read and kept.
    expect(state().unread).toBe(false);
    expect(state().kept).toBe(true);
    state().reset();
    expect(state().unread).toBe(false);

    const noStorage: GuestListStore = {
      open: () => Promise.resolve({ kind: "no-storage" }),
      save: () => Promise.resolve({ kind: "not-kept" }),
      erase: () => Promise.resolve(),
      eraseUnreadable: () => Promise.resolve(),
      sweep: () => Promise.resolve([]),
    };
    await state().open(PLAN_A, noStorage, clock());
    expect(state().phase).toBe("ready");
    expect(state().list?.guests).toEqual([]);
    expect(state().kept).toBe(false);
    expect(state().unread).toBe(false);
  });

  it("while unread, erasing clears the page only and never touches the device", async () => {
    const inner = memoryBackend();
    await withBackend<unknown>(inner).put(PLAN_A, storedList);
    const before = JSON.stringify(await inner.get(PLAN_A));
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    const erase = vi.spyOn(store, "erase");

    await state().open(PLAN_A, store, clock());
    expect(state().unread).toBe(true);
    state().apply((list) => ({ ...list, guests: [guest(900)] }));
    await state().eraseList();

    expect(erase).not.toHaveBeenCalled();
    expect(JSON.stringify(await inner.get(PLAN_A))).toBe(before);
    expect(state().list?.guests).toEqual([]);
    expect(state().canUndo).toBe(false);
    expect(state().unread).toBe(true);
    expect(state().kept).toBe(false);
  });

  it("lets a second read that answers after reset change nothing and write nothing", async () => {
    const { backend, store } = device();
    const slow = deferred<Opened>();
    vi.spyOn(store, "open")
      .mockImplementationOnce(() => Promise.resolve({ kind: "not-kept" }))
      .mockImplementationOnce(() => slow.promise);
    const save = vi.spyOn(store, "save");

    await state().open(PLAN_A, store, clock());
    state().apply(titled("Dinner"));
    const flushing = state().flush();
    state().reset();
    slow.resolve({ kind: "new" });
    await flushing;

    expect(save).not.toHaveBeenCalled();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().planId).toBeNull();
    expect(state().list).toBeNull();
  });
});

describe("guest list page state: another tab's changes are taken up", () => {
  /** What another tab of the same browser writes: a later copy of the list, from the copy it had. Answers the list as stored. */
  async function otherTabSaves(backend: CacheBackend, patch: Partial<GuestList>, updatedAt: string): Promise<GuestList> {
    const tab = otherTabOn(backend);
    const before = await loadedBy(tab, PLAN_A);
    const answer = await tab.save({ ...before.list, ...patch, updatedAt }, before.stamp);
    expect(answer.kind).toBe("saved");
    return (await loadedBy(tab, PLAN_A)).list;
  }

  it("takes a newer stored list when nothing is unsaved, clears undo, and saves the next change quietly", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    expect(state().canUndo).toBe(true);

    await otherTabSaves(backend, { title: "Theirs", guests: [guest(1)] }, "2026-11-14T09:00:00.000Z");
    await state().refresh();
    expect(state().list?.title).toBe("Theirs");
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().list?.updatedAt).toBe("2026-11-14T09:00:00.000Z");
    expect(state().canUndo).toBe(false);

    state().apply((list) => ({ ...list, guests: [...list.guests, guest(2)] }));
    await state().flush();
    expect(state().notice).toBeNull();
    const kept = await reopened(backend, PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests : null).toEqual([guest(1), guest(2)]);
    expect(storedTitle(kept)).toBe("Theirs");
  });

  it("a print stamps updatedAt like any other change, so the 90 days count from it, and takes no undo step", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    const before = state().list?.updatedAt;
    state().reset();

    await state().open(PLAN_A, store, clock());
    state().apply((list) => markPrinted(list, "2026-11-14T09:00:00.000Z"), { undo: false });
    expect(state().canUndo).toBe(false);
    expect(state().list?.updatedAt).not.toBe(before);
    await state().flush();
    const kept = await reopened(backend, PLAN_A);
    expect(kept.kind === "ready" ? [kept.list.paperVersion, kept.list.updatedAt] : null).toEqual([1, state().list?.updatedAt]);
  });

  it("takes nothing when the stored list is the one last opened or saved", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    const before = state().list;
    await state().refresh();
    expect(state().list).toBe(before);
    expect(state().canUndo).toBe(true);
  });

  it("with a change unsaved, reads nothing and keeps this tab's change; the save then says another tab changed it", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    await otherTabSaves(backend, { title: "Theirs" }, "2026-11-14T09:00:00.000Z");

    state().apply(titled("Ours again"));
    const open = vi.spyOn(store, "open");
    await state().refresh();
    expect(open).not.toHaveBeenCalled();
    expect(state().list?.title).toBe("Ours again");
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Ours again");
  });

  it("a change made while the device is read goes first: the stored list is not taken", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    const theirs = await otherTabSaves(backend, { title: "Theirs" }, "2026-11-14T09:00:00.000Z");

    const slow = deferred<Opened>();
    vi.spyOn(store, "open").mockImplementationOnce(() => slow.promise);
    const refreshing = state().refresh();
    state().apply(titled("Typed meanwhile"));
    slow.resolve({ kind: "ready", list: theirs, repaired: 0 });
    await refreshing;
    expect(state().list?.title).toBe("Typed meanwhile");
    expect(state().canUndo).toBe(true);
  });

  it("never lowers the paper's version: a print in another tab, then a change here", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();

    // The other tab prints: version 1, printed, unchanged since.
    await otherTabSaves(backend, { paperVersion: 1, changedSincePrint: false, printedAt: "2026-11-14T09:00:00.000Z" }, "2026-11-14T09:00:00.000Z");
    await state().refresh();
    state().apply((list) => ({ ...list, guests: [...list.guests, guest(2)], changedSincePrint: true }));
    await state().flush();

    const kept = await reopened(backend, PLAN_A);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.paperVersion).toBe(1);
    expect(kept.list.printedAt).toBe("2026-11-14T09:00:00.000Z");
    expect(kept.list.changedSincePrint).toBe(true);
    expect(kept.list.guests).toEqual([guest(1), guest(2)]);
  });

  it("an unread session takes the stored list once a read works, and is then read and kept", async () => {
    const inner = memoryBackend();
    const stored = { ...emptyGuestList(PLAN_A, START), title: "Kept dinner", guests: [guest(1)] };
    await withBackend<unknown>(inner).put(PLAN_A, stored);
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    await state().open(PLAN_A, store, clock());
    expect(state().unread).toBe(true);

    await state().refresh();
    expect(state().unread).toBe(false);
    expect(state().kept).toBe(true);
    expect(state().list?.title).toBe("Kept dinner");

    // Nothing stored at all: the session is read, and the next change is kept.
    state().reset();
    const empty = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(memoryBackend(), 1)));
    await state().open(PLAN_A, empty, clock());
    expect(state().unread).toBe(true);
    await state().refresh();
    expect(state().unread).toBe(false);
    expect(state().kept).toBe(true);
  });

  it("counts each take-up, so a page can clear what it was saying", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    expect(state().takeUps).toBe(0);

    await state().refresh();
    expect(state().takeUps).toBe(0);
    await otherTabSaves(backend, { title: "Theirs" }, "2026-11-14T09:00:00.000Z");
    await state().refresh();
    expect(state().takeUps).toBe(1);
    await otherTabSaves(backend, { title: "Theirs again" }, "2026-11-14T10:00:00.000Z");
    await state().refresh();
    expect(state().takeUps).toBe(2);
  });

  it("takes an empty list when another tab deleted it, clears undo, says so, and never writes the names back", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, title: "Ours", guests: [guest(1), guest(2)] }));
    await state().flush();
    expect(state().canUndo).toBe(true);

    await createGuestListStore(withBackend<unknown>(backend)).erase(PLAN_A);
    await state().refresh();
    expect(state().list?.guests).toEqual([]);
    expect(state().list?.title).toBe("");
    expect(state().list?.planId).toBe(PLAN_A);
    expect(state().canUndo).toBe(false);
    expect(state().kept).toBe(true);
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
    expect(state().takeUps).toBe(1);
    // Nothing is written by the take itself.
    await state().flush();
    expect((await reopened(backend, PLAN_A)).kind).toBe("new");

    // The next change stores the empty list, not the names this tab had.
    state().apply(titled("A new start"));
    await state().flush();
    const kept = await reopened(backend, PLAN_A);
    expect(kept.kind === "ready" ? [kept.list.title, kept.list.guests] : null).toEqual(["A new start", []]);
  });

  it("with a change unsaved, a list deleted elsewhere is not read: this tab's list stands, as before", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    await createGuestListStore(withBackend<unknown>(backend)).erase(PLAN_A);

    state().apply(titled("Ours again"));
    const open = vi.spyOn(store, "open");
    await state().refresh();
    expect(open).not.toHaveBeenCalled();
    expect(state().list?.title).toBe("Ours again");
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().canUndo).toBe(true);
    expect(state().notice).toBeNull();
    expect(state().takeUps).toBe(0);
  });

  it("a session that never opened or saved a list takes nothing when nothing is stored", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock());
    const before = state().list;
    await state().refresh();
    expect(state().list).toBe(before);
    expect(state().notice).toBeNull();
    expect(state().takeUps).toBe(0);
  });

  it("changes nothing when the read answers after reset or after another plan is opened", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    const theirs = await otherTabSaves(backend, { title: "Theirs" }, "2026-11-14T09:00:00.000Z");

    const slow = deferred<Opened>();
    vi.spyOn(store, "open").mockImplementationOnce(() => slow.promise);
    const refreshing = state().refresh();
    state().reset();
    slow.resolve({ kind: "ready", list: theirs, repaired: 0 });
    await refreshing;
    expect(state().planId).toBeNull();
    expect(state().list).toBeNull();
  });
});

describe("guest list page state: a list deleted elsewhere is never written back", () => {
  /** This tab holds a kept list of two guests; another tab then deletes it from the device. */
  async function keptThenDeletedElsewhere(): Promise<{ readonly backend: CacheBackend; readonly store: GuestListStore }> {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, title: "Ours", guests: [guest(1), guest(2)] }));
    await state().flush();
    await otherTabOn(backend).erase(PLAN_A);
    return { backend, store };
  }

  it("with a change waiting when another tab deletes the list, the autosave writes nothing and the page takes an empty list and says so", async () => {
    const { backend, store } = await keptThenDeletedElsewhere();
    const put = vi.spyOn(backend, "put");
    state().apply((list) => ({ ...list, guests: [...list.guests, guest(3)] }));
    expect(state().canUndo).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    await state().flush();

    expect(put).not.toHaveBeenCalled();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().list?.guests).toEqual([]);
    expect(state().list?.title).toBe("");
    expect(state().list?.planId).toBe(PLAN_A);
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
    expect(state().canUndo).toBe(false);
    expect(state().kept).toBe(true);
    expect(state().takeUps).toBe(1);

    // Nothing is left unsaved: no later save brings the names back.
    const save = vi.spyOn(store, "save");
    await vi.advanceTimersByTimeAsync(5000);
    await state().flush();
    expect(save).not.toHaveBeenCalled();
    expect(await backend.get(PLAN_A)).toBeNull();
    // Undo has nothing of the deleted list to bring back.
    state().undo();
    expect(state().list?.guests).toEqual([]);

    // The next change here starts a new list.
    state().apply(titled("A new start"));
    await state().flush();
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests, kept.stamp.revision]).toEqual(["A new start", [], 1]);
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
  });

  it("drops a change made while that save was running, with the rest of the deleted list", async () => {
    const { backend, store } = await keptThenDeletedElsewhere();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded) => {
      await gate.promise;
      return real(list, loaded);
    });
    state().apply(titled("Typed first"));
    const flushing = state().flush();
    state().apply(titled("Typed while saving"));
    gate.resolve(undefined);
    await flushing;
    await vi.advanceTimersByTimeAsync(5000);
    await state().flush();

    expect(state().list?.title).toBe("");
    expect(state().list?.guests).toEqual([]);
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("a session left with a change waiting drops it when the list was deleted elsewhere, and the plan opened next is not told", async () => {
    const { backend, store } = await keptThenDeletedElsewhere();
    state().apply(titled("Typed before leaving"));
    await state().open(PLAN_B, store, clock());
    await state().flush();

    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().planId).toBe(PLAN_B);
    expect(state().notice).toBeNull();
    expect(state().takeUps).toBe(0);
    expect(state().list?.planId).toBe(PLAN_B);
  });
});

describe("guest list page state: a list that comes back after it was deleted here is said", () => {
  /** This tab holds a kept list and deletes it; another tab, which holds no copy, then stores a list. */
  async function deletedHereThenAddedElsewhere(): Promise<{ readonly backend: CacheBackend; readonly store: GuestListStore }> {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    await state().eraseList();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().notice).toBeNull();
    return { backend, store };
  }

  async function anotherTabStoresAList(backend: CacheBackend, title: string): Promise<void> {
    const answer = await otherTabOn(backend).save({ ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), title, guests: [guest(7)] }, null);
    expect(answer.kind).toBe("saved");
  }

  it("takes up a list another tab stored after the delete here, and says names were added", async () => {
    const { backend } = await deletedHereThenAddedElsewhere();
    await anotherTabStoresAList(backend, "Theirs");

    await state().refresh();
    expect(state().list?.title).toBe("Theirs");
    expect(state().list?.guests).toEqual([guest(7)]);
    expect(state().notice).toEqual({ kind: "added-after-delete" });
    expect(state().takeUps).toBe(1);
    expect(state().canUndo).toBe(false);
  });

  it("a delete the device refuses leaves the list on the page and says it could not be deleted; one that then takes clears both", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    // The device refuses the delete, so the list is still stored afterwards.
    const refusal = vi.spyOn(backend, "delete").mockRejectedValue(new Error("refused"));
    expect(await state().eraseList()).toBe(false);
    expect(await backend.get(PLAN_A)).not.toBeNull();

    // The page does not show an empty list over names that are still kept: it shows them, and says why.
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().notice).toEqual({ kind: "not-deleted" });
    expect(state().canUndo).toBe(false);

    // A later read finds the very copy the page shows: nothing to take, and no word of names added elsewhere.
    await state().refresh();
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().notice).toEqual({ kind: "not-deleted" });
    // A change is kept over that same copy, as an ordinary save.
    state().apply((list) => ({ ...list, title: "Still here" }));
    await state().flush();
    expect(state().notice).toEqual({ kind: "not-deleted" });
    expect(state().kept).toBe(true);

    // Tried again once the device allows it, the delete takes: an empty list, and the words go.
    refusal.mockRestore();
    expect(await state().eraseList()).toBe(true);
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().list?.guests).toEqual([]);
    expect(state().notice).toBeNull();
  });

  it("a delete that cannot be seen to have taken, because the device cannot be read afterwards, leaves the page's list and says so", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    const refusal = vi.spyOn(backend, "delete").mockRejectedValue(new Error("refused"));
    const unread = vi.spyOn(backend, "get").mockRejectedValue(new Error("refused"));
    expect(await state().eraseList()).toBe(false);
    refusal.mockRestore();
    unread.mockRestore();

    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().notice).toEqual({ kind: "not-deleted" });
    expect(await backend.get(PLAN_A)).not.toBeNull();
    // The next read finds the copy this page had loaded: nothing to take, nothing said of another tab.
    await state().refresh();
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().notice).toEqual({ kind: "not-deleted" });
  });

  it("says it once: the mark clears on that take-up", async () => {
    const { backend } = await deletedHereThenAddedElsewhere();
    await anotherTabStoresAList(backend, "Theirs");
    await state().refresh();
    state().dismissNotice();

    const tab = otherTabOn(backend);
    const theirs = await loadedBy(tab, PLAN_A);
    expect((await tab.save({ ...theirs.list, title: "Theirs again", updatedAt: "2026-11-14T10:00:00.000Z" }, theirs.stamp)).kind).toBe("saved");
    await state().refresh();
    expect(state().list?.title).toBe("Theirs again");
    expect(state().notice).toBeNull();
  });

  it("the mark clears when this tab next stores a list itself", async () => {
    const { backend } = await deletedHereThenAddedElsewhere();
    state().apply(titled("A new start here"));
    await state().flush();
    expect(state().notice).toBeNull();

    const tab = otherTabOn(backend);
    const ours = await loadedBy(tab, PLAN_A);
    expect((await tab.save({ ...ours.list, title: "Changed elsewhere", updatedAt: "2026-11-14T10:00:00.000Z" }, ours.stamp)).kind).toBe("saved");
    await state().refresh();
    expect(state().list?.title).toBe("Changed elsewhere");
    expect(state().notice).toBeNull();
  });

  it("with nothing stored after the delete here, a read takes nothing and says nothing", async () => {
    await deletedHereThenAddedElsewhere();
    const before = state().list;
    await state().refresh();
    expect(state().list).toBe(before);
    expect(state().notice).toBeNull();
    expect(state().takeUps).toBe(0);
  });

  it("a delete that never touched the device (the list here was never read) leaves no mark", async () => {
    const inner = memoryBackend();
    await withBackend<unknown>(inner).put(PLAN_A, { ...emptyGuestList(PLAN_A, START), title: "Kept dinner", guests: [guest(1)] });
    const store = createGuestListStore(withBackend<unknown>(readsRefusedAtFirst(inner, 1)));
    await state().open(PLAN_A, store, clock());
    expect(state().unread).toBe(true);
    await state().eraseList();

    await state().refresh();
    expect(state().list?.title).toBe("Kept dinner");
    expect(state().notice).toBeNull();
  });
});

describe("guest list page state: a list this page's own sweep removed is said to be removed under the rule", () => {
  const SWEPT = { sweptHere: true } as const;

  it("a fresh open after the sweep removed the list shows an empty list and says why", async () => {
    const { store } = device();
    await state().open(PLAN_A, store, clock(), SWEPT);
    expect(state().phase).toBe("ready");
    expect(state().list?.guests).toEqual([]);
    expect(state().notice).toEqual({ kind: "removed-by-rule" });
    expect(state().kept).toBe(true);
  });

  it("a fresh open says nothing of the rule when the sweep removed nothing, or when a list is stored after all", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock(), { sweptHere: false });
    expect(state().notice).toBeNull();
    state().reset();

    // Another tab stored a list between this page's sweep and its read: that list is shown, as it is.
    await otherTabOn(backend).save({ ...emptyGuestList(PLAN_A, START), title: "Stored since", guests: [guest(1)] }, null);
    await state().open(PLAN_A, store, clock(), SWEPT);
    expect(state().list?.title).toBe("Stored since");
    expect(state().notice).toBeNull();
  });

  it("a page mounted again over its list takes an empty list and says the rule removed it, not another tab", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, title: "Ours", guests: [guest(1), guest(2)] }));
    await state().flush();
    // The mount's sweep removes the list from the device, then the mount reads.
    await otherTabOn(backend).erase(PLAN_A);

    await state().refresh(SWEPT);
    expect(state().list?.guests).toEqual([]);
    expect(state().list?.title).toBe("");
    expect(state().notice).toEqual({ kind: "removed-by-rule" });
    expect(state().canUndo).toBe(false);
    expect(state().takeUps).toBe(1);

    // A change then does not bring the old names back.
    state().apply(titled("A new start"));
    await state().flush();
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests]).toEqual(["A new start", []]);
  });

  it("with a change unsaved, the mount's read takes nothing; the save then writes nothing and says the rule removed the list", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    state().apply(titled("Typed before leaving"));
    await otherTabOn(backend).erase(PLAN_A);

    const open = vi.spyOn(store, "open");
    await state().refresh(SWEPT);
    expect(open).not.toHaveBeenCalled();
    expect(state().list?.title).toBe("Typed before leaving");
    expect(state().notice).toBeNull();

    await state().flush();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().list?.guests).toEqual([]);
    expect(state().list?.title).toBe("");
    expect(state().notice).toEqual({ kind: "removed-by-rule" });
  });

  it("says it once: a later removal elsewhere is not laid at the rule's door", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock(), SWEPT);
    state().apply(titled("A new start"));
    await state().flush();
    state().dismissNotice();
    await otherTabOn(backend).erase(PLAN_A);
    await state().refresh();
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
  });

  it("a read with no word about the sweep is as before: a list gone is removed elsewhere", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();
    await otherTabOn(backend).erase(PLAN_A);
    await state().refresh({ sweptHere: false });
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
  });
});

describe("guest list page state: a print gives way to another tab's list", () => {
  const PRINTED_AT = "2026-11-15T10:00:00.000Z";

  /** A print, recorded as the paper page records it: it gives way, and says how it stands on their copy. */
  function recordPrint(): void {
    let printed = 0;
    state().apply(
      (list) => {
        const next = markPrinted(list, PRINTED_AT);
        printed = next.paperVersion;
        return next;
      },
      { undo: false, ifOtherCopy: (theirs) => printedFromOlderCopy(theirs, printed, PRINTED_AT) },
    );
  }

  /** This tab holds a kept list of one guest; another tab then changes it, and this tab is not told. */
  async function changedElsewhereUnseen(patch: Partial<GuestList> = {}): Promise<{ readonly backend: CacheBackend; readonly store: GuestListStore }> {
    const { backend, store } = device();
    await otherTabOn(backend).save({ ...emptyGuestList(PLAN_A, START), title: "Older", guests: [guest(1)] }, null);
    await state().open(PLAN_A, store, clock());
    const tab = otherTabOn(backend);
    const theirs = await loadedBy(tab, PLAN_A);
    const answer = await tab.save(
      { ...theirs.list, title: "Theirs", guests: [guest(1), guest(2)], updatedAt: "2026-11-14T09:00:00.000Z", ...patch },
      theirs.stamp,
    );
    expect(answer.kind).toBe("saved");
    return { backend, store };
  }

  it("asks the device to give way only while every change waiting is one that gives way", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());

    recordPrint();
    await state().flush();
    expect(save.mock.calls[0]?.[2]).toEqual({ yieldToOther: true });

    state().apply(titled("Ordinary"));
    await state().flush();
    expect(save.mock.calls[1]?.[2]).toEqual({ yieldToOther: false });

    // An ordinary change before the print, and one after it, each make the save an ordinary one.
    state().apply(titled("Before the print"));
    recordPrint();
    await state().flush();
    expect(save.mock.calls[2]?.[2]).toEqual({ yieldToOther: false });
    state().apply((list) => ({ ...list, changedSincePrint: true }));
    await state().flush();
    recordPrint();
    state().apply(titled("After the print"));
    await state().flush();
    expect(save.mock.calls[4]?.[2]).toEqual({ yieldToOther: false });
    expect(save).toHaveBeenCalledTimes(5);
  });

  it("a print alone gives way: their list is taken up and kept, with the print recorded as made from an older copy", async () => {
    const { backend } = await changedElsewhereUnseen();
    expect(state().list?.title).toBe("Older");

    recordPrint();
    // The sheet laid out now carries version 1, from the older copy.
    expect(state().list?.paperVersion).toBe(1);
    expect(state().list?.title).toBe("Older");
    await state().flush();

    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
    expect(state().takeUps).toBe(1);
    expect(state().canUndo).toBe(false);
    expect(state().kept).toBe(true);
    expect(state().list?.title).toBe("Theirs");
    expect(state().list?.guests).toEqual([guest(1), guest(2)]);

    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect(kept.list.title).toBe("Theirs");
    expect(kept.list.guests).toEqual([guest(1), guest(2)]);
    // The number that was on the stale sheet, this print's moment, and marked changed since.
    expect(kept.list.paperVersion).toBe(1);
    expect(kept.list.printedAt).toBe(PRINTED_AT);
    expect(kept.list.changedSincePrint).toBe(true);
    // Their copy was revision 2; the print recorded on it is one quiet save more.
    expect(kept.stamp.revision).toBe(3);

    // Nothing is left waiting, and the next change here is an ordinary, quiet one.
    state().dismissNotice();
    state().apply(titled("Ours now"));
    await state().flush();
    expect(state().notice).toBeNull();
  });

  it("gives no later sheet the stale sheet's number: the larger of the two versions is kept", async () => {
    const { backend } = await changedElsewhereUnseen({ paperVersion: 4, printedAt: "2026-11-14T09:00:00.000Z", changedSincePrint: false });
    recordPrint();
    expect(state().list?.paperVersion).toBe(1);
    await state().flush();

    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect(kept.list.paperVersion).toBe(4);
    expect(kept.list.printedAt).toBe(PRINTED_AT);
    expect(kept.list.changedSincePrint).toBe(true);
    // So the next print of the list as it now stands is version 5, a number no sheet has carried.
    expect(markPrinted(kept.list, "2026-11-16T10:00:00.000Z").paperVersion).toBe(5);
  });

  it("an ordinary change waiting with the print keeps this tab's list and says so, as before", async () => {
    const { backend } = await changedElsewhereUnseen();
    state().apply(titled("Ours"));
    recordPrint();
    await state().flush();

    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(state().takeUps).toBe(0);
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests, kept.list.paperVersion]).toEqual(["Ours", [guest(1)], 1]);
  });

  it("an ordinary change made while the print's save is running keeps this tab's list too", async () => {
    const { backend, store } = await changedElsewhereUnseen();
    const gate = deferred<undefined>();
    const real = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (list, loaded, opts) => {
      await gate.promise;
      return real(list, loaded, opts);
    });
    recordPrint();
    const flushing = state().flush();
    state().apply(titled("Typed while the print was being kept"));
    gate.resolve(undefined);
    await flushing;
    await state().flush();

    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(state().list?.title).toBe("Typed while the print was being kept");
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests, kept.list.paperVersion]).toEqual(["Typed while the print was being kept", [guest(1)], 1]);
  });

  it("a print whose save was not kept still gives way at the next try", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save").mockResolvedValueOnce({ kind: "not-kept" });
    await state().open(PLAN_A, store, clock());
    recordPrint();
    await state().flush();
    expect(state().kept).toBe(false);
    await state().flush();
    expect(save.mock.calls.map((call) => call[2])).toEqual([{ yieldToOther: true }, { yieldToOther: true }]);
    expect(state().kept).toBe(true);
  });

  it("a session left with only a print waiting gives way as well, and records the print on their list", async () => {
    const { backend, store } = await changedElsewhereUnseen();
    recordPrint();
    await state().open(PLAN_B, store, clock());
    await state().flush();

    expect(state().planId).toBe(PLAN_B);
    expect(state().notice).toBeNull();
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests, kept.list.paperVersion, kept.list.changedSincePrint]).toEqual(["Theirs", [guest(1), guest(2)], 1, true]);
  });

  // The record of the print on their list gives way too, until it lands: three tabs on one device.

  /** A third tab opens what is kept and saves a change to it. */
  async function thirdTabSaves(backend: CacheBackend): Promise<string> {
    const third = otherTabOn(backend);
    const held = await loadedBy(third, PLAN_A);
    const answer = await third.save(
      { ...held.list, title: "Third", guests: [guest(1), guest(2), guest(3)], updatedAt: "2026-11-14T09:30:00.000Z" },
      held.stamp,
    );
    return answer.kind;
  }

  it("a third tab's copy, stored before the print's record is saved on the second tab's list, is taken up in turn with the print recorded on it", async () => {
    // This page holds "Older"; a second tab has saved "Theirs", unseen here.
    const { backend, store } = await changedElsewhereUnseen();
    const real = store.save.bind(store);
    const thirdSaved: string[] = [];
    let saves = 0;
    // The third tab saves just before this page's second save: the record of the print on the second tab's list.
    const save = vi.spyOn(store, "save").mockImplementation(async (list, loaded, opts) => {
      saves += 1;
      if (saves === 2) thirdSaved.push(await thirdTabSaves(backend));
      return real(list, loaded, opts);
    });

    recordPrint();
    await state().flush();

    expect(thirdSaved).toEqual(["saved"]);
    // The device holds the third tab's content, with the print recorded on it as made from an older copy.
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect([kept.list.title, kept.list.guests]).toEqual(["Third", [guest(1), guest(2), guest(3)]]);
    expect([kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint]).toEqual([1, PRINTED_AT, true]);
    // The page shows that list, and still says the printout was made from an older copy.
    expect(state().list?.title).toBe("Third");
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
    expect(state().takeUps).toBe(2);
    expect(state().kept).toBe(true);
    expect(state().changeWaiting()).toBe(false);
    // The print, and its record on each list taken up, all asked to give way.
    expect(save.mock.calls.map((call) => call[2])).toEqual([{ yieldToOther: true }, { yieldToOther: true }, { yieldToOther: true }]);
  });

  it("an ordinary change made here while the print's record is being saved still makes the next save an ordinary one", async () => {
    const { backend, store } = await changedElsewhereUnseen();
    const real = store.save.bind(store);
    const reached = deferred<undefined>();
    const gate = deferred<undefined>();
    let saves = 0;
    // The second save, the record on their list, is held on its way to the device.
    const save = vi.spyOn(store, "save").mockImplementation(async (list, loaded, opts) => {
      saves += 1;
      if (saves === 2) {
        reached.resolve(undefined);
        await gate.promise;
      }
      return real(list, loaded, opts);
    });

    recordPrint();
    const flushing = state().flush();
    await reached.promise;
    state().apply(titled("Typed while the record was being kept"));
    gate.resolve(undefined);
    await flushing;
    await state().flush();

    expect(save.mock.calls.map((call) => call[2])).toEqual([{ yieldToOther: true }, { yieldToOther: true }, { yieldToOther: false }]);
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    // Their guests, this tab's change on top, and the print recorded on it.
    expect([kept.list.title, kept.list.guests, kept.list.paperVersion]).toEqual(["Typed while the record was being kept", [guest(1), guest(2)], 1]);
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
  });

  it("the word that a printout was made from an older copy is never replaced by the word that this tab's version was kept", async () => {
    const { backend } = await changedElsewhereUnseen();
    recordPrint();
    await state().flush();
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });

    // Another tab saves again, unseen here; an ordinary change here is then kept over its copy.
    const other = otherTabOn(backend);
    const held = await loadedBy(other, PLAN_A);
    expect((await other.save({ ...held.list, title: "Theirs again", updatedAt: "2026-11-14T11:00:00.000Z" }, held.stamp)).kind).toBe("saved");
    state().apply(titled("Ours"));
    await state().flush();

    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Ours");
    // The planner is still told to print again: that word is not put away for the other.
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
  });
});

describe("guest list page state: tabs are told apart by the copy loaded, never by the clock", () => {
  const SAME_MOMENT = "2026-11-13T10:00:05.000Z";

  /** This tab opens and saves once at SAME_MOMENT; another tab then saves a change carrying that same millisecond. */
  async function bothSaveInOneMillisecond(): Promise<{ readonly backend: CacheBackend; readonly store: GuestListStore }> {
    const { backend, store } = device();
    await state().open(PLAN_A, store, () => SAME_MOMENT);
    state().apply(titled("Ours"));
    await state().flush();
    expect(state().list?.updatedAt).toBe(SAME_MOMENT);

    const other = otherTabOn(backend);
    const theirs = await loadedBy(other, PLAN_A);
    expect(theirs.stamp).toEqual({ revision: 1, updatedAt: SAME_MOMENT });
    const answer = await other.save({ ...theirs.list, title: "Theirs", guests: [guest(1)], updatedAt: SAME_MOMENT }, theirs.stamp);
    expect(answer).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: SAME_MOMENT } });
    return { backend, store };
  }

  it("takes up another tab's save that carries the same millisecond as this tab's last save", async () => {
    await bothSaveInOneMillisecond();
    await state().refresh();
    expect(state().list?.title).toBe("Theirs");
    expect(state().list?.guests).toEqual([guest(1)]);
    expect(state().canUndo).toBe(false);
    expect(state().takeUps).toBe(1);
    // Read again: the copy stored is now the one loaded, so nothing more is taken.
    await state().refresh();
    expect(state().takeUps).toBe(1);
  });

  it("with the same millisecond and a change here first, the save says it went over another tab's copy", async () => {
    const { backend } = await bothSaveInOneMillisecond();
    state().apply(titled("Ours again"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(state().kept).toBe(true);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Ours again");
  });

  it("a clock that steps back five minutes between this tab's two saves does not hide the later save from another tab", async () => {
    const { backend, store } = device();
    // The empty list, the first change, then the clock steps back five minutes before the second.
    await state().open(PLAN_A, store, clockOf(["2026-11-13T10:00:00.000Z", "2026-11-13T10:00:10.000Z", "2026-11-13T09:55:10.000Z"]));
    state().apply(titled("First"));
    await state().flush();
    const other = otherTabOn(backend);
    const seen = await loadedBy(other, PLAN_A);
    expect(seen.stamp).toEqual({ revision: 1, updatedAt: "2026-11-13T10:00:10.000Z" });

    state().apply(titled("Second"));
    await state().flush();
    expect(state().list?.updatedAt).toBe("2026-11-13T09:55:10.000Z");

    // Reading again, the other tab finds a copy that is not the one it loaded, though it is stamped earlier.
    const later = await loadedBy(other, PLAN_A);
    expect(later.stamp).toEqual({ revision: 2, updatedAt: "2026-11-13T09:55:10.000Z" });
    expect(later.list.title).toBe("Second");
    // Saving from the copy it loaded, it is told it went over another's.
    const answer = await other.save({ ...seen.list, title: "Theirs", updatedAt: "2026-11-13T09:55:20.000Z" }, seen.stamp);
    expect(answer.kind).toBe("saved-over-other");
  });

  /** Another tab saves, this tab opens, then the other tab's clock steps back five minutes and it saves again. */
  async function otherTabSavesAfterItsClockStepsBack(): Promise<{ readonly backend: CacheBackend }> {
    const { backend, store } = device();
    const other = otherTabOn(backend);
    const first = await other.save({ ...emptyGuestList(PLAN_A, "2026-11-13T10:00:00.000Z"), title: "First" }, null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    await state().open(PLAN_A, store, clock());
    expect(state().list?.title).toBe("First");

    const second = await other.save(
      { ...emptyGuestList(PLAN_A, "2026-11-13T09:55:01.000Z"), title: "Second", guests: [guest(2)] },
      first.stamp,
    );
    expect(second).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: "2026-11-13T09:55:01.000Z" } });
    return { backend };
  }

  it("takes up another tab's later save though it is stamped five minutes before the copy loaded here", async () => {
    await otherTabSavesAfterItsClockStepsBack();
    await state().refresh();
    expect(state().list?.title).toBe("Second");
    expect(state().list?.guests).toEqual([guest(2)]);
    expect(state().takeUps).toBe(1);
  });

  it("says its save went over another tab's later save though that one is stamped before the copy loaded here", async () => {
    const { backend } = await otherTabSavesAfterItsClockStepsBack();
    state().apply(titled("Ours"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab" });
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Ours");
  });

  it("opens a list kept without a revision, and its first save here stores revision 1 quietly", async () => {
    const { backend, store } = device();
    const { revision, ...keptBefore } = { ...emptyGuestList(PLAN_A, START), title: "Kept before", guests: [guest(1)] };
    expect(revision).toBe(0);
    await withBackend<unknown>(backend).put(PLAN_A, keptBefore);

    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("ready");
    expect(state().list?.title).toBe("Kept before");
    expect(state().list?.guests).toEqual([guest(1)]);
    state().apply(titled("Changed"));
    await state().flush();

    expect(state().notice).toBeNull();
    expect(state().kept).toBe(true);
    const kept = await loadedBy(otherTabOn(backend), PLAN_A);
    expect(kept.stamp.revision).toBe(1);
    expect(kept.list.title).toBe("Changed");
  });
});

describe("guest list page state: nothing rejects and no name escapes", () => {
  it("resolves every action when every store call rejects, and logs nothing", async () => {
    const reject = (): Promise<never> => Promise.reject(new Error(`refused ${CANARY}`));
    const save = (_list: GuestList, _loaded: Stamp | null): Promise<Saved> => reject();
    const store: GuestListStore = { open: reject, save, erase: reject, eraseUnreadable: reject, sweep: reject };
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "debug"),
    ];

    await expect(state().open(PLAN_A, store, clock())).resolves.toBeUndefined();
    expect(state().phase).toBe("ready");
    expect(state().kept).toBe(false);
    state().apply((list) => ({ ...list, guests: [{ ...guest(1), name: CANARY }] }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    await expect(state().flush()).resolves.toBeUndefined();
    expect(state().kept).toBe(false);
    await expect(state().refresh()).resolves.toBeUndefined();
    // This session never read the device (its read was refused), so only the page is cleared.
    await expect(state().eraseList()).resolves.toBe(true);

    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Found by a second, independent read of the two-tab code before it was pushed.
// ---------------------------------------------------------------------------

describe("guest list page state: what a second read of the two-tab code found", () => {
  it("a save that goes over another tab's printed copy keeps that print's number, on the device and on the page", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)], paperVersion: 3, changedSincePrint: true }));
    await state().flush();
    // The other tab prints that copy as version 4, and saves.
    const other = otherTabOn(backend);
    const theirs = await loadedBy(other, PLAN_A);
    const printed = markPrinted(theirs.list, "2026-11-14T09:00:00.000Z");
    expect(printed.paperVersion).toBe(4);
    expect((await other.save({ ...printed, updatedAt: "2026-11-14T09:00:00.000Z" }, theirs.stamp)).kind).toBe("saved");

    // This tab has not seen that. Its change goes over their copy, and says so.
    state().apply(titled("Changed here"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab" });
    const kept = await reopened(backend, PLAN_A);
    if (kept.kind !== "ready") throw new Error("nothing is kept");
    expect([kept.list.title, kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint])
      .toEqual(["Changed here", 4, "2026-11-14T09:00:00.000Z", true]);
    // The page has the number too: its next print is 5, and no later sheet is given 4.
    const onPage = state().list;
    if (onPage === null) throw new Error("no list on the page");
    expect([onPage.paperVersion, onPage.printedAt, onPage.changedSincePrint]).toEqual([4, "2026-11-14T09:00:00.000Z", true]);
    expect(markPrinted(onPage, "2026-11-15T09:00:00.000Z").paperVersion).toBe(5);
    // The page's list is the copy kept: nothing more is waiting.
    expect(state().changeWaiting()).toBe(false);
  });

  it("a take-up puts away what the page was saying about the copy before", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    // Another tab deletes the list: this page takes an empty one and says it is no longer kept.
    await otherTabOn(backend).erase(PLAN_A);
    await state().refresh();
    expect(state().notice).toEqual({ kind: "removed-elsewhere" });
    // Then another tab stores a list again. Taking it up, the page no longer says the list is not kept.
    const again = { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), guests: [guest(7)] };
    expect((await otherTabOn(backend).save(again, null)).kind).toBe("saved");
    await state().refresh();
    expect(state().list?.guests).toEqual([guest(7)]);
    expect(state().notice).toBeNull();
  });

  it("a take-up keeps the word that a printout was made from an older copy, which is still true", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    const other = otherTabOn(backend);
    const first = await loadedBy(other, PLAN_A);
    expect((await other.save({ ...first.list, title: "Theirs", updatedAt: "2026-11-14T09:00:00.000Z" }, first.stamp)).kind).toBe("saved");
    // A print here gives way to their list.
    state().apply((list) => markPrinted(list, "2026-11-14T10:00:00.000Z"), {
      undo: false,
      ifOtherCopy: (theirs) => printedFromOlderCopy(theirs, 1, "2026-11-14T10:00:00.000Z"),
    });
    await state().flush();
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
    // They change it again. This page takes that up too, and the printout is still of an older copy.
    const second = await loadedBy(other, PLAN_A);
    expect((await other.save({ ...second.list, title: "Theirs again", updatedAt: "2026-11-14T11:00:00.000Z" }, second.stamp)).kind).toBe("saved");
    await state().refresh();
    expect(state().list?.title).toBe("Theirs again");
    expect(state().notice).toEqual({ kind: "print-of-older-copy" });
  });

  it("starting again over a value that could not be read takes up a list another tab has stored since, and erases nothing", async () => {
    const { backend, store } = device();
    await backend.put(PLAN_A, { storedAt: START, value: { junk: true } });
    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("unreadable");
    // Another tab starts a new list there, over the value that could not be read, and saves it.
    const theirs = { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), guests: [guest(7)] };
    expect((await otherTabOn(backend).save(theirs, null)).kind).toBe("saved-over-other");

    await state().startAgain();
    expect(state().phase).toBe("ready");
    expect(state().list?.guests).toEqual([guest(7)]);
    const kept = await reopened(backend, PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests : null).toEqual([guest(7)]);
    // A change here is then an ordinary save over the copy this page holds.
    state().apply(titled("Kept"));
    await state().flush();
    expect(state().notice).toBeNull();
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Kept");
  });

  it("a change still waiting when the page goes to another plan is kept over another tab's copy, and the plan says so when it is next opened", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    // Another tab saves a change this page does not see.
    const other = otherTabOn(backend);
    const theirs = await loadedBy(other, PLAN_A);
    expect((await other.save({ ...theirs.list, guests: [guest(1), guest(7)], updatedAt: "2026-11-14T09:00:00.000Z" }, theirs.stamp)).kind).toBe("saved");
    // A change here, and within the autosave's wait the page opens another plan.
    state().apply(titled("Changed here"));
    await state().open(PLAN_B, store, clock());
    expect(state().notice).toBeNull();
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Changed here");

    // Back on the first plan, the page says its version was kept over the other tab's.
    await state().open(PLAN_A, store, clock());
    expect(state().list?.title).toBe("Changed here");
    expect(state().notice).toEqual({ kind: "other-tab" });
    // It is said once.
    await state().open(PLAN_B, store, clock());
    await state().open(PLAN_A, store, clock());
    expect(state().notice).toBeNull();
  });
});

describe("guest list page state: another tab is busy with the list", () => {
  it("writes nothing, says so, keeps the change on the page and saves it again shortly", async () => {
    const { backend, store } = device();
    let busy = false;
    // The device store's answer when another tab holds the list's lock past the bound.
    const waits: GuestListStore = {
      ...store,
      save: (list, loaded, opts) => (busy ? Promise.resolve({ kind: "busy" }) : store.save(list, loaded, opts)),
    };
    await state().open(PLAN_A, waits, clock());
    // The save is tried again only while a kit page is there.
    state().pageHere();
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();

    busy = true;
    state().apply(titled("Waiting"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab-busy" });
    expect(state().list?.title).toBe("Waiting");
    expect(state().changeWaiting()).toBe(true);
    expect(storedTitle(await reopened(backend, PLAN_A))).not.toBe("Waiting");

    // The other tab finishes: the change is saved without another keystroke, and the words go.
    busy = false;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    await state().flush();
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Waiting");
    expect(state().notice).toBeNull();
    expect(state().changeWaiting()).toBe(false);
  });

  it("stops trying again when the page goes: nothing stays scheduled, the change waits on the page, and is kept once a page is back", async () => {
    const { backend, store } = device();
    let busy = false;
    let saves = 0;
    const waits: GuestListStore = {
      ...store,
      save: (list, loaded, opts) => {
        saves += 1;
        return busy ? Promise.resolve({ kind: "busy" }) : store.save(list, loaded, opts);
      },
    };
    await state().open(PLAN_A, waits, clock());
    state().pageHere();
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();

    busy = true;
    state().apply(titled("Waiting"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab-busy" });
    // With the page there, the save is to be tried again shortly.
    expect(vi.getTimerCount()).toBe(1);

    // The page goes. Its one attempt meets the busy tab too, and nothing is left scheduled.
    state().pageGone();
    await state().flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(state().list?.title).toBe("Waiting");
    expect(state().changeWaiting()).toBe(true);
    const tried = saves;
    await vi.advanceTimersByTimeAsync(5 * AUTOSAVE_MS);
    expect(saves).toBe(tried);
    expect(vi.getTimerCount()).toBe(0);
    expect(storedTitle(await reopened(backend, PLAN_A))).not.toBe("Waiting");

    // The other tab finishes, and a page is there again: the change is kept shortly, and the words go.
    busy = false;
    state().pageHere();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(saves).toBe(tried);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toBe(tried + 1);
    await state().flush();
    expect(saves).toBe(tried + 1);
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Waiting");
    expect(state().notice).toBeNull();
    expect(state().changeWaiting()).toBe(false);
  });

  it("keeps an ordinary change made a moment before the page goes, at once, and leaves nothing scheduled", async () => {
    const { backend, store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    state().pageHere();
    state().apply(titled("Kept as the page went"));
    expect(vi.getTimerCount()).toBe(1);

    // Within the autosave's wait, the page goes: the save is asked for at once, and the wait is cleared.
    state().pageGone();
    expect(save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await state().flush();
    expect(storedTitle(await reopened(backend, PLAN_A))).toBe("Kept as the page went");
    expect(save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a change another tab was busy over when the page goes to another plan, schedules nothing, and says so once when the plan is next opened", async () => {
    const { backend, store } = device();
    let busy = false;
    const waits: GuestListStore = {
      ...store,
      save: (list, loaded, opts) => (busy ? Promise.resolve({ kind: "busy" }) : store.save(list, loaded, opts)),
    };
    await state().open(PLAN_A, waits, clock());
    state().pageHere();
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();

    busy = true;
    state().apply(titled("Waiting"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab-busy" });

    // The page goes to another plan while the other tab is still at work: the change is not kept, and nothing is tried again.
    await state().open(PLAN_B, waits, clock());
    expect(vi.getTimerCount()).toBe(0);
    expect(state().planId).toBe(PLAN_B);
    expect(state().notice).toBeNull();
    expect(state().changeWaiting()).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * AUTOSAVE_MS);
    const kept = await reopened(backend, PLAN_A);
    if (kept.kind !== "ready") throw new Error("nothing is kept");
    expect(kept.list.title).not.toBe("Waiting");
    expect(kept.list.guests).toEqual([guest(1)]);

    // Back on the first plan, the page says its last change was not kept. It is said once.
    busy = false;
    await state().open(PLAN_A, waits, clock());
    expect(state().list?.title).not.toBe("Waiting");
    expect(state().notice).toEqual({ kind: "last-change-not-kept" });
    await state().open(PLAN_B, waits, clock());
    await state().open(PLAN_A, waits, clock());
    expect(state().notice).toBeNull();
  });

  it("says the last change was not kept on opening a plan whose first change was dropped so, with nothing stored", async () => {
    const { backend, store } = device();
    const waits: GuestListStore = { ...store, save: () => Promise.resolve({ kind: "busy" }) };
    await state().open(PLAN_A, waits, clock());
    state().pageHere();
    state().apply(titled("Never kept"));
    await state().flush();
    expect(state().notice).toEqual({ kind: "other-tab-busy" });

    await state().open(PLAN_B, waits, clock());
    expect(vi.getTimerCount()).toBe(0);
    expect(await reopened(backend, PLAN_A)).toEqual({ kind: "new" });
    await state().open(PLAN_A, store, clock());
    expect(state().list?.title).toBe("");
    expect(state().notice).toEqual({ kind: "last-change-not-kept" });
  });
});

// ---------------------------------------------------------------------------
// Two tabs can each print a sheet under the same number. A save that meets the
// other tab's copy of that number takes its record up, marked changed since,
// so the next print takes the next number.
// ---------------------------------------------------------------------------

describe("guest list page state: another tab's sheet under the same number", () => {
  it("a save that goes over another tab's print of the same number marks the list changed since that print, on the device and on the page", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)], paperVersion: 3, changedSincePrint: true }));
    await state().flush();
    // The other tab prints that copy as version 4, and saves.
    const other = otherTabOn(backend);
    const theirs = await loadedBy(other, PLAN_A);
    const printed = markPrinted(theirs.list, "2026-11-14T09:00:00.000Z");
    expect(printed.paperVersion).toBe(4);
    expect((await other.save({ ...printed, updatedAt: "2026-11-14T09:00:00.000Z" }, theirs.stamp)).kind).toBe("saved");

    // This tab has not seen that. It changes the list and prints it an hour later, as version 4 too.
    // An ordinary change is waiting with the print, so the save keeps this tab's list.
    state().apply(titled("Changed here"));
    state().apply((list) => markPrinted(list, "2026-11-14T10:00:00.000Z"), {
      undo: false,
      ifOtherCopy: (theirList) => printedFromOlderCopy(theirList, 4, "2026-11-14T10:00:00.000Z"),
    });
    expect(state().list?.paperVersion).toBe(4);
    await state().flush();

    expect(state().notice).toEqual({ kind: "other-tab" });
    const kept = await reopened(backend, PLAN_A);
    if (kept.kind !== "ready") throw new Error("nothing is kept");
    // This tab's content stands. Number 4 is on the other tab's sheet too, which was not this list.
    expect([kept.list.title, kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint])
      .toEqual(["Changed here", 4, "2026-11-14T09:00:00.000Z", true]);
    // The page has that record too: its next print is version 5, a number neither sheet has.
    const onPage = state().list;
    if (onPage === null) throw new Error("no list on the page");
    expect([onPage.paperVersion, onPage.printedAt, onPage.changedSincePrint]).toEqual([4, "2026-11-14T09:00:00.000Z", true]);
    expect(markPrinted(onPage, "2026-11-15T09:00:00.000Z").paperVersion).toBe(5);
    expect(state().changeWaiting()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Start again removes only a value that still cannot be read, compared and
// deleted in one step of the device: never a list another tab has stored.
// ---------------------------------------------------------------------------

describe("guest list page state: start again never erases a list", () => {
  /** A device on which another tab saves a list, once, just as it is asked to delete: after this tab's read, before its delete. */
  function savedJustBeforeTheDelete(backend: CacheBackend, theirs: GuestList): { readonly racing: CacheBackend; readonly arm: () => void; readonly saved: string[] } {
    let armed = false;
    const saved: string[] = [];
    const between = async (): Promise<void> => {
      if (!armed) return;
      armed = false;
      saved.push((await otherTabOn(backend).save(theirs, null)).kind);
    };
    const racing: CacheBackend = {
      ...backend,
      delete: async (key) => {
        await between();
        await backend.delete(key);
      },
      deleteIf: async (key, matches) => {
        await between();
        return backend.deleteIf(key, matches);
      },
    };
    return { racing, arm: () => { armed = true; }, saved };
  }

  it("a list another tab stores between this tab's read and its delete is kept, and taken up", async () => {
    const backend = memoryBackend();
    const theirs = { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), guests: [guest(7)] };
    const { racing, arm, saved } = savedJustBeforeTheDelete(backend, theirs);
    await backend.put(PLAN_A, { storedAt: START, value: { junk: true } });
    await state().open(PLAN_A, createGuestListStore(withBackend<unknown>(racing)), clock());
    expect(state().phase).toBe("unreadable");

    arm();
    await state().startAgain();

    // The other tab's list went over the value that could not be read, and it is still kept.
    expect(saved).toEqual(["saved-over-other"]);
    const kept = await reopened(backend, PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests : null).toEqual([guest(7)]);
    // This page shows it, and its next change is an ordinary save over the copy it holds.
    expect(state().phase).toBe("ready");
    expect(state().list?.guests).toEqual([guest(7)]);
    expect(state().notice).toBeNull();
    state().apply(titled("Kept"));
    await state().flush();
    expect(state().notice).toBeNull();
    const after = await reopened(backend, PLAN_A);
    expect(after.kind === "ready" ? [after.list.title, after.list.guests] : null).toEqual(["Kept", [guest(7)]]);
  });

  it("still removes a value that cannot be read, and begins a new list", async () => {
    const backend = memoryBackend();
    const { racing } = savedJustBeforeTheDelete(backend, emptyGuestList(PLAN_A, START));
    await backend.put(PLAN_A, { storedAt: START, value: { junk: true } });
    await state().open(PLAN_A, createGuestListStore(withBackend<unknown>(racing)), clock());

    // No other tab saves this time.
    await state().startAgain();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(state().phase).toBe("ready");
    expect(state().list?.guests).toEqual([]);
    expect(state().notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A list kept by a later version of the kit, which this version cannot read.
// A tab left open across a release still runs this code: it writes nothing
// over that list and does not erase it, and says its own list is not kept.
// ---------------------------------------------------------------------------

describe("guest list page state: a list kept by a later version of the kit", () => {
  /** What a later kit might keep for the plan, as the device holds it. */
  function keptByALaterKit(): { readonly storedAt: string; readonly value: Record<string, unknown> } {
    return {
      storedAt: "2026-11-14T09:00:00.000Z",
      value: { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), version: 2, revision: 9, guests: [guest(1), guest(2)], courses: ["soup"] },
    };
  }

  it("a tab that held the list from before writes nothing over it, by a change or by a print, and says its list is not kept", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply((list) => ({ ...list, guests: [guest(1)] }));
    await state().flush();
    expect(state().kept).toBe(true);
    // A newer tab, running a later kit, keeps the list in its own shape.
    const later = keptByALaterKit();
    await backend.put(PLAN_A, later);

    // A read here takes nothing: the value cannot be read.
    await state().refresh();
    expect(state().list?.guests).toEqual([guest(1)]);
    // A change here is not written over it.
    state().apply(titled("Typed in the older tab"));
    await state().flush();
    expect(state().kept).toBe(false);
    expect(await backend.get(PLAN_A)).toEqual(later);
    // Nor is a print's record, which gives way.
    state().apply((list) => markPrinted(list, "2026-11-15T10:00:00.000Z"), {
      undo: false,
      ifOtherCopy: (theirs) => printedFromOlderCopy(theirs, 1, "2026-11-15T10:00:00.000Z"),
    });
    await state().flush();
    expect(state().kept).toBe(false);
    expect(await backend.get(PLAN_A)).toEqual(later);
    expect(state().list?.title).toBe("Typed in the older tab");
  });

  it("start again does not erase it, and a list begun afterwards is not kept over it", async () => {
    const { backend, store } = device();
    const later = keptByALaterKit();
    await backend.put(PLAN_A, later);
    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("unreadable");

    await state().startAgain();
    expect(await backend.get(PLAN_A)).toEqual(later);
    expect(state().phase).toBe("ready");
    state().apply(titled("Begun again"));
    await state().flush();
    expect(state().kept).toBe(false);
    expect(await backend.get(PLAN_A)).toEqual(later);
  });
});

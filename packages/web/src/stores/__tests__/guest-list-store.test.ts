import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../lib/idb-cache.js";
import { emptyGuestList, type Guest, type GuestList } from "../../lib/guest-list/model.js";
import {
  createGuestListStore,
  type GuestListStore,
  type Opened,
  type Saved,
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
    expect(await store.save(kept, null)).toBe("saved");

    await state().open(PLAN_A, store, clock());
    expect(state().phase).toBe("ready");
    expect(state().list).toEqual(kept);
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
    const refusing: CacheBackend = {
      get: () => Promise.reject(new Error(`refused ${CANARY}`)),
      put: () => Promise.reject(new Error(`refused ${CANARY}`)),
      delete: () => Promise.reject(new Error(`refused ${CANARY}`)),
      list: () => Promise.reject(new Error(`refused ${CANARY}`)),
    };
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

  it("passes the copy it opened or last saved, so another tab's newer copy is noticed", async () => {
    const { store } = device();
    const save = vi.spyOn(store, "save");
    await state().open(PLAN_A, store, clock());
    state().apply(titled("One"));
    await state().flush();
    const firstSaved = state().list?.updatedAt;
    state().apply(titled("Two"));
    await state().flush();

    expect(save.mock.calls[0]?.[1]).toBeNull();
    expect(save.mock.calls[1]?.[1]).toBe(firstSaved);
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
    const save = vi.spyOn(store, "save").mockResolvedValueOnce("not-kept");
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

  it("says when another tab had kept a newer copy, and keeps this one", async () => {
    const { backend, store } = device();
    await state().open(PLAN_A, store, clock());
    state().apply(titled("Ours"));
    await state().flush();

    // Another tab saves a later copy of the same list.
    const otherTab = createGuestListStore(withBackend<unknown>(backend));
    const theirs = { ...emptyGuestList(PLAN_A, "2026-11-14T09:00:00.000Z"), title: "Theirs" };
    expect(await otherTab.save(theirs, null)).toBe("newer-copy-kept-ours");

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

describe("guest list page state: nothing rejects and no name escapes", () => {
  it("resolves every action when every store call rejects, and logs nothing", async () => {
    const reject = (): Promise<never> => Promise.reject(new Error(`refused ${CANARY}`));
    const save = (_list: GuestList, _loaded: string | null): Promise<Saved> => reject();
    const store: GuestListStore = { open: reject, save, erase: reject, sweep: reject };
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
    await expect(state().eraseList()).resolves.toBeUndefined();

    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

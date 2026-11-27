import { afterEach, describe, it, expect, vi } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../idb-cache.js";
import { emptyGuestList, LIST_VERSION, type Guest, type GuestList } from "../model.js";
import { markPrinted } from "../paper.js";
import { anotherSheet, createGuestListStore, GUEST_LIST_DB, GUEST_LIST_STORE, LOCK_WAIT_MS, stampOf, type Exclusive, type GuestListStore, type Stamp } from "../store.js";

const PLAN_A = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const PLAN_B = "6c1b7a1f-8a1c-4e8f-8d4b-3a7a7a1b2c22";
const NOW = "2026-11-13T10:00:00.000Z";
const CANARY = "CANARY-Q7";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function guestAt(n: number, tableId: string | null, seat: number | null, name?: string): Guest {
  return { id: uuid(1000 + n), name: name ?? `Guest ${String(n)}`, party: "", tableId, seat };
}

function listFor(planId: string, patch: Partial<GuestList> = {}): GuestList {
  return { ...emptyGuestList(planId, NOW), ...patch };
}

/** A backend where every call rejects, with a message that carries a guest's name. */
function refusingBackend(): CacheBackend {
  const refuse = (): Promise<never> => Promise.reject(new Error(`storage refused ${CANARY}`));
  return {
    get: refuse,
    put: refuse,
    delete: refuse,
    deleteIf: refuse,
    upsert: refuse,
    list: refuse,
  };
}

/** Reading works, writing and deleting refuse (a full disk, say). */
function readOnlyBackend(inner: CacheBackend): CacheBackend {
  const refuse = (): Promise<never> => Promise.reject(new Error(`storage full ${CANARY}`));
  return { get: (key) => inner.get(key), list: () => inner.list(), put: refuse, delete: refuse, deleteIf: refuse, upsert: refuse };
}

/** A put that resolves and keeps nothing, as a transaction that later aborts does. */
function forgetfulBackend(inner: CacheBackend): CacheBackend {
  return { ...inner, put: () => Promise.resolve() };
}

/** A put that resolves and keeps something else. */
function substitutingBackend(inner: CacheBackend, instead: unknown): CacheBackend {
  return { ...inner, put: (key) => inner.put(key, instead) };
}

function manyGuests(count: number): Guest[] {
  return Array.from({ length: count }, (_, i) => guestAt(i + 1, null, null));
}

/** Two stores over one backend: two tabs of the same browser. */
function twoTabs() {
  const backend = memoryBackend();
  return {
    backend,
    a: createGuestListStore(withBackend<unknown>(backend)),
    b: createGuestListStore(withBackend<unknown>(backend)),
    raw: withBackend<unknown>(backend),
  };
}

const store = () => createGuestListStore(withBackend<unknown>(memoryBackend()));

/** The stamp of the copy a tab holds after opening the plan now. */
async function loadedStamp(tab: GuestListStore, planId: string): Promise<Stamp> {
  const opened = await tab.open(planId);
  if (opened.kind !== "ready") throw new Error("nothing stored to load");
  return stampOf(opened.list);
}

describe("guest list store: names", () => {
  it("names the database and the object store", () => {
    expect(GUEST_LIST_DB).toBe("venviewer-guest-lists");
    expect(GUEST_LIST_STORE).toBe("lists");
  });
});

describe("guest list store: open and save", () => {
  it("opens nothing stored as new", async () => {
    expect(await store().open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("opens what it saved, keyed by plan", async () => {
    const s = store();
    const a = listFor(PLAN_A, { title: "Plan A", guests: [guestAt(1, null, null)] });
    const b = listFor(PLAN_B, { title: "Plan B" });
    expect(await s.save(a, null)).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });
    expect(await s.save(b, null)).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });

    expect(await s.open(PLAN_A)).toEqual({ kind: "ready", list: { ...a, revision: 1 }, repaired: 0 });
    expect(await s.open(PLAN_B)).toEqual({ kind: "ready", list: { ...b, revision: 1 }, repaired: 0 });
  });

  it("stores the list as given, and sets no field of its own but the revision", async () => {
    const s = store();
    const a = listFor(PLAN_A, { updatedAt: "2026-01-02T03:04:05.000Z" });
    await s.save(a, null);
    expect(await s.open(PLAN_A)).toEqual({ kind: "ready", list: { ...a, revision: 1 }, repaired: 0 });
  });

  it("says not-kept, and does not throw, when storage refuses", async () => {
    const s = createGuestListStore(withBackend<unknown>(refusingBackend()));
    expect(await s.open(PLAN_A)).toEqual({ kind: "not-kept" });
    expect(await s.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
    await expect(s.erase(PLAN_A)).resolves.toBeUndefined();
    expect(await s.sweep(Date.parse("2030-01-01T00:00:00Z"))).toEqual([]);
  });

  it("says unreadable for a stored value that is not a list, and leaves it in place", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    expect(await a.open(PLAN_A)).toEqual({ kind: "unreadable" });
    expect((await raw.get(PLAN_A))?.value).toEqual({ junk: true });
  });

  it("says unreadable for a list with an extra field", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { ...listFor(PLAN_A), email: "x@example.com" });
    expect(await a.open(PLAN_A)).toEqual({ kind: "unreadable" });
  });

  it("repairs on open and reports how many it unseated, without writing", async () => {
    const { raw, a } = twoTabs();
    const table = { id: uuid(1), number: 1, name: "", seats: 4 };
    const stored = listFor(PLAN_A, {
      tables: [table],
      guests: [guestAt(1, table.id, 2), guestAt(2, table.id, 2), guestAt(3, table.id, 3)],
    });
    await raw.put(PLAN_A, stored);

    const opened = await a.open(PLAN_A);
    expect(opened.kind).toBe("ready");
    if (opened.kind !== "ready") return;
    expect(opened.repaired).toBe(1);
    expect(opened.list.guests[0]).toMatchObject({ tableId: table.id, seat: 2 });
    expect(opened.list.guests[1]).toMatchObject({ tableId: null, seat: null });
    expect(opened.list.guests[2]).toMatchObject({ tableId: table.id, seat: 3 });
    expect((await raw.get(PLAN_A))?.value).toEqual(stored);
  });

  it("a second tab's copy is not overwritten unseen: the save says it went over another's", async () => {
    const { a, b } = twoTabs();
    const base = listFor(PLAN_A, { updatedAt: "2026-11-13T10:00:00.000Z" });
    expect((await a.save(base, null)).kind).toBe("saved");

    const openedA = await a.open(PLAN_A);
    const openedB = await b.open(PLAN_A);
    if (openedA.kind !== "ready" || openedB.kind !== "ready") throw new Error("not ready");

    const bChanged: GuestList = { ...openedB.list, title: "From B", updatedAt: "2026-11-13T10:05:00.000Z" };
    expect(await b.save(bChanged, stampOf(openedB.list))).toEqual({
      kind: "saved",
      stamp: { revision: 2, updatedAt: "2026-11-13T10:05:00.000Z" },
    });

    const aChanged: GuestList = { ...openedA.list, title: "From A", updatedAt: "2026-11-13T10:06:00.000Z" };
    expect(await a.save(aChanged, stampOf(openedA.list))).toEqual({
      kind: "saved-over-other",
      stamp: { revision: 3, updatedAt: "2026-11-13T10:06:00.000Z" },
    });

    const final = await a.open(PLAN_A);
    expect(final.kind === "ready" ? final.list.title : null).toBe("From A");
  });

  it("answers saved-over-other when it never loaded a copy but one is stored", async () => {
    const { a, b } = twoTabs();
    await b.save(listFor(PLAN_A, { title: "Stored" }), null);
    expect((await a.save(listFor(PLAN_A, { title: "Ours" }), null)).kind).toBe("saved-over-other");
  });

  it("saves quietly when the stored copy is the one it loaded", async () => {
    const s = store();
    const first = listFor(PLAN_A, { updatedAt: "2026-11-13T10:00:00.000Z" });
    const kept = await s.save(first, null);
    if (kept.kind !== "saved") throw new Error("the first save was not kept");
    const next = { ...first, title: "Next", updatedAt: "2026-11-13T10:01:00.000Z" };
    expect(await s.save(next, kept.stamp)).toEqual({
      kind: "saved",
      stamp: { revision: 2, updatedAt: "2026-11-13T10:01:00.000Z" },
    });
  });

  it("saves over a stored value it cannot read, and counts it as another's", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    expect(await a.save(listFor(PLAN_A), null)).toEqual({ kind: "saved-over-other", stamp: { revision: 1, updatedAt: NOW } });
    expect((await a.open(PLAN_A)).kind).toBe("ready");
  });
});

describe("guest list store: a revision travels with the list", () => {
  it("counts the saves that made the stored copy, whatever revision the list it is given says", async () => {
    const { raw, a } = twoTabs();
    const first = await a.save(listFor(PLAN_A, { revision: 40 }), null);
    expect(first).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });
    expect((await raw.get(PLAN_A))?.value).toMatchObject({ revision: 1 });

    if (first.kind !== "saved") throw new Error("the first save was not kept");
    const second = await a.save(listFor(PLAN_A, { title: "Again", revision: 0 }), first.stamp);
    expect(second).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: NOW } });
    expect((await raw.get(PLAN_A))?.value).toMatchObject({ revision: 2, title: "Again" });
  });

  it("a stored list with no revision opens, and its first save stores revision 1", async () => {
    const { raw, a } = twoTabs();
    const { revision, ...keptBefore } = listFor(PLAN_A, { title: "Kept before", guests: [guestAt(1, null, null)] });
    expect(revision).toBe(0);
    await raw.put(PLAN_A, keptBefore);

    const opened = await a.open(PLAN_A);
    if (opened.kind !== "ready") throw new Error("the list kept before did not open");
    expect(opened.list.revision).toBe(0);
    expect(opened.list.title).toBe("Kept before");

    const changed = { ...opened.list, title: "Changed", updatedAt: "2026-11-13T10:01:00.000Z" };
    expect(await a.save(changed, stampOf(opened.list))).toEqual({
      kind: "saved",
      stamp: { revision: 1, updatedAt: "2026-11-13T10:01:00.000Z" },
    });
    expect((await raw.get(PLAN_A))?.value).toMatchObject({ revision: 1, title: "Changed" });
  });

  it("another tab's save in the same millisecond is still another's copy", async () => {
    const { a, b } = twoTabs();
    await a.save(listFor(PLAN_A), null);
    const aLoaded = await loadedStamp(a, PLAN_A);
    const bLoaded = await loadedStamp(b, PLAN_A);
    expect(bLoaded).toEqual(aLoaded);

    // The other tab's change carries the very millisecond of the copy both loaded.
    expect(await b.save(listFor(PLAN_A, { title: "From B" }), bLoaded)).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: NOW } });
    // A read finds a copy that is not the one loaded, though its time is the same.
    expect(await loadedStamp(a, PLAN_A)).not.toEqual(aLoaded);
    // And a save from the copy loaded says it went over another's.
    expect(await a.save(listFor(PLAN_A, { title: "From A" }), aLoaded)).toEqual({
      kind: "saved-over-other",
      stamp: { revision: 3, updatedAt: NOW },
    });
  });

  it("a clock that steps back five minutes between a tab's two saves does not hide the later save", async () => {
    const { a, b } = twoTabs();
    const first = await a.save(listFor(PLAN_A, { title: "First", updatedAt: "2026-11-13T10:00:00.000Z" }), null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    const bLoaded = await loadedStamp(b, PLAN_A);

    // The clock steps back: the later save carries the earlier time.
    const second = await a.save(listFor(PLAN_A, { title: "Second", updatedAt: "2026-11-13T09:55:01.000Z" }), first.stamp);
    expect(second).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: "2026-11-13T09:55:01.000Z" } });

    // The other tab reads again: the copy stored is not the one it loaded.
    expect(await loadedStamp(b, PLAN_A)).not.toEqual(bLoaded);
    // And its save, from the copy it loaded, says it went over another's.
    expect((await b.save(listFor(PLAN_A, { title: "From B", updatedAt: "2026-11-13T09:55:10.000Z" }), bLoaded)).kind).toBe("saved-over-other");
  });

  it("the revision written is one more than the larger of the stored and the loaded", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, listFor(PLAN_A, { revision: 5 }));
    // Never loaded, over a stored revision 5.
    expect(await a.save(listFor(PLAN_A, { title: "Ours" }), null)).toEqual({ kind: "saved-over-other", stamp: { revision: 6, updatedAt: NOW } });
    // Loaded a later revision than the one stored now.
    await raw.put(PLAN_A, listFor(PLAN_A, { revision: 2 }));
    expect(await a.save(listFor(PLAN_A, { title: "Ours" }), { revision: 6, updatedAt: NOW })).toEqual({
      kind: "saved-over-other",
      stamp: { revision: 7, updatedAt: NOW },
    });
  });
});

describe("guest list store: a list removed elsewhere is never written back", () => {
  it("answers removed-elsewhere and writes nothing when nothing is stored where a copy had been loaded", async () => {
    const { backend, a, b } = twoTabs();
    await a.save(listFor(PLAN_A, { guests: [guestAt(1, null, null)] }), null);
    const aLoaded = await loadedStamp(a, PLAN_A);
    await b.erase(PLAN_A);

    const put = vi.spyOn(backend, "put");
    const changed = listFor(PLAN_A, { title: "Typed since", guests: [guestAt(1, null, null)], updatedAt: "2026-11-13T10:01:00.000Z" });
    expect(await a.save(changed, aLoaded)).toEqual({ kind: "removed-elsewhere" });
    expect(put).not.toHaveBeenCalled();
    expect(await backend.get(PLAN_A)).toBeNull();
    expect(await a.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("stores a first save, when nothing is stored and no copy had been loaded", async () => {
    const { a, b } = twoTabs();
    await a.save(listFor(PLAN_A), null);
    await b.erase(PLAN_A);
    // A tab that holds no copy (it opened after the removal, or took the empty list) starts again at revision 1.
    expect(await b.save(listFor(PLAN_A, { title: "A new start" }), null)).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });
  });

  it("puts no guest's name in that answer", async () => {
    const { a, b } = twoTabs();
    await a.save(listFor(PLAN_A), null);
    const aLoaded = await loadedStamp(a, PLAN_A);
    await b.erase(PLAN_A);
    const answer = await a.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, CANARY)] }), aLoaded);
    expect(JSON.stringify(answer)).toBe('{"kind":"removed-elsewhere"}');
  });
});

describe("guest list store: a save that gives way to another tab's copy", () => {
  const YIELD = { yieldToOther: true } as const;

  it("writes nothing over another's valid copy, and answers with that copy as open would return it", async () => {
    const { backend, a, b } = twoTabs();
    await a.save(listFor(PLAN_A, { title: "First" }), null);
    const aLoaded = await loadedStamp(a, PLAN_A);
    // The other tab changes the list: two guests on one seat, so that open must repair it.
    const table = { id: uuid(1), number: 1, name: "", seats: 4 };
    const theirs = listFor(PLAN_A, {
      title: "Theirs",
      tables: [table],
      guests: [guestAt(1, table.id, 2), guestAt(2, table.id, 2)],
      updatedAt: "2026-11-13T10:05:00.000Z",
    });
    expect((await b.save(theirs, await loadedStamp(b, PLAN_A))).kind).toBe("saved");
    const storedBefore = JSON.stringify(await backend.get(PLAN_A));

    const put = vi.spyOn(backend, "put");
    const mine = listFor(PLAN_A, { title: "Mine, from the older copy", paperVersion: 1, updatedAt: "2026-11-13T10:06:00.000Z" });
    const answer = await a.save(mine, aLoaded, YIELD);

    expect(put).not.toHaveBeenCalled();
    expect(JSON.stringify(await backend.get(PLAN_A))).toBe(storedBefore);
    const opened = await a.open(PLAN_A);
    if (opened.kind !== "ready") throw new Error("their copy is no longer stored");
    expect(opened.repaired).toBe(1);
    expect(answer).toEqual({ kind: "other-kept", list: opened.list });
  });

  it("gives way to a valid stored copy when the caller had loaded none", async () => {
    const { a, b } = twoTabs();
    await b.save(listFor(PLAN_A, { title: "Stored" }), null);
    const answer = await a.save(listFor(PLAN_A, { title: "Ours" }), null, YIELD);
    expect(answer.kind).toBe("other-kept");
    expect(answer.kind === "other-kept" ? answer.list.title : null).toBe("Stored");
  });

  it("saves as usual when the stored copy is the one the caller loaded", async () => {
    const { a } = twoTabs();
    await a.save(listFor(PLAN_A, { title: "First" }), null);
    const answer = await a.save(listFor(PLAN_A, { title: "Second" }), await loadedStamp(a, PLAN_A), YIELD);
    expect(answer).toEqual({ kind: "saved", stamp: { revision: 2, updatedAt: NOW } });
  });

  it("handles a stored value it cannot read, and nothing stored, as it does without the option", async () => {
    const { raw, a, b } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    expect((await a.save(listFor(PLAN_A), null, YIELD)).kind).toBe("saved-over-other");

    const aLoaded = await loadedStamp(a, PLAN_A);
    await b.erase(PLAN_A);
    expect(await a.save(listFor(PLAN_A, { title: "Again" }), aLoaded, YIELD)).toEqual({ kind: "removed-elsewhere" });
    expect(await a.save(listFor(PLAN_A, { title: "A new start" }), null, YIELD)).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });
  });

  it("without the option, another's copy is still written over and the answer says so", async () => {
    const { a, b } = twoTabs();
    await a.save(listFor(PLAN_A), null);
    const aLoaded = await loadedStamp(a, PLAN_A);
    await b.save(listFor(PLAN_A, { title: "Theirs" }), await loadedStamp(b, PLAN_A));
    expect((await a.save(listFor(PLAN_A, { title: "Ours" }), aLoaded, { yieldToOther: false })).kind).toBe("saved-over-other");
  });
});

describe("guest list store: a list is checked before and after it is written", () => {
  it("does not write a list with an extra field, and keeps the earlier copy", async () => {
    const { raw, a } = twoTabs();
    const earlier = listFor(PLAN_A, { title: "Earlier" });
    expect((await a.save(earlier, null)).kind).toBe("saved");
    const withExtra = { ...listFor(PLAN_A, { title: "Later", updatedAt: "2026-11-14T10:00:00.000Z" }), dirty: true };
    expect(await a.save(withExtra, await loadedStamp(a, PLAN_A))).toEqual({ kind: "not-kept" });
    expect((await raw.get(PLAN_A))?.value).toEqual({ ...earlier, revision: 1 });
  });

  it("does not write 601 guests, and keeps the earlier copy", async () => {
    const { raw, a } = twoTabs();
    const earlier = listFor(PLAN_A, { guests: manyGuests(600) });
    expect((await a.save(earlier, null)).kind).toBe("saved");
    const tooMany = listFor(PLAN_A, { guests: manyGuests(601), updatedAt: "2026-11-14T10:00:00.000Z" });
    expect(await a.save(tooMany, await loadedStamp(a, PLAN_A))).toEqual({ kind: "not-kept" });
    expect((await raw.get(PLAN_A))?.value).toEqual({ ...earlier, revision: 1 });
  });

  it("stores the parsed value with its revision, and leaves the argument as it was", async () => {
    const { raw, a } = twoTabs();
    const given = listFor(PLAN_A);
    await a.save(given, null);
    const kept = (await raw.get(PLAN_A))?.value;
    expect(kept).toEqual({ ...given, revision: 1 });
    expect(kept).not.toBe(given);
    expect(given.revision).toBe(0);
  });

  it("says not-kept when reading works and writing refuses", async () => {
    const backend = memoryBackend();
    const s = createGuestListStore(withBackend<unknown>(readOnlyBackend(backend)));
    expect(await s.open(PLAN_A)).toEqual({ kind: "new" });
    expect(await s.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
  });

  it("says not-kept when a put resolves but stores nothing", async () => {
    const s = createGuestListStore(withBackend<unknown>(forgetfulBackend(memoryBackend())));
    expect(await s.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
  });

  it("says not-kept when a put resolves but stores something else", async () => {
    const other = listFor(PLAN_A, { title: "Other", updatedAt: "2026-01-01T00:00:00.000Z" });
    const s = createGuestListStore(
      withBackend<unknown>(substitutingBackend(memoryBackend(), other)),
    );
    expect(await s.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
  });

  it("says not-kept unless the copy read back carries both the revision and the time written", async () => {
    /** A valid stored list that is not the one written, as the device wraps it. */
    const kept = (list: GuestList): unknown => ({ storedAt: NOW, value: list });
    // The right time, another revision.
    const otherRevision = createGuestListStore(
      withBackend<unknown>(substitutingBackend(memoryBackend(), kept(listFor(PLAN_A, { title: "Other", revision: 9 })))),
    );
    expect(await otherRevision.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
    // The right revision, another time.
    const otherTime = createGuestListStore(
      withBackend<unknown>(substitutingBackend(memoryBackend(), kept(listFor(PLAN_A, { revision: 1, updatedAt: "2026-01-01T00:00:00.000Z" })))),
    );
    expect(await otherTime.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
    // The very copy written is kept.
    const same = createGuestListStore(
      withBackend<unknown>(substitutingBackend(memoryBackend(), kept(listFor(PLAN_A, { revision: 1 })))),
    );
    expect(await same.save(listFor(PLAN_A), null)).toEqual({ kind: "saved", stamp: { revision: 1, updatedAt: NOW } });
  });
});

describe("guest list store: erase", () => {
  it("erase removes the list and only that list", async () => {
    const s = store();
    await s.save(listFor(PLAN_A), null);
    await s.save(listFor(PLAN_B), null);
    await s.erase(PLAN_A);
    expect(await s.open(PLAN_A)).toEqual({ kind: "new" });
    expect((await s.open(PLAN_B)).kind).toBe("ready");
  });

  it("erase removes a value it cannot read, and erasing nothing is fine", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    await a.erase(PLAN_A);
    expect(await a.open(PLAN_A)).toEqual({ kind: "new" });
    await expect(a.erase(PLAN_B)).resolves.toBeUndefined();
  });
});

describe("guest list store: sweep", () => {
  it("sweeps a list 30 days after its event and 90 days after its last change, and nothing sooner", async () => {
    const s = store();
    // Event 2027-06-13: removed from 2027-07-13 00:00 UTC.
    await s.save(listFor(PLAN_A, { eventDate: "2027-06-13" }), null);
    // No date, last change 2027-01-01 10:00 UTC: removed from 2027-04-01 00:00 UTC.
    await s.save(listFor(PLAN_B, { updatedAt: "2027-01-01T10:00:00.000Z" }), null);

    expect(await s.sweep(Date.parse("2027-03-31T23:59:59.999Z"))).toEqual([]);
    expect(await s.sweep(Date.parse("2027-04-01T00:00:00Z"))).toEqual([PLAN_B]);
    expect(await s.open(PLAN_B)).toEqual({ kind: "new" });
    expect((await s.open(PLAN_A)).kind).toBe("ready");

    expect(await s.sweep(Date.parse("2027-07-12T23:59:59.999Z"))).toEqual([]);
    expect(await s.sweep(Date.parse("2027-07-13T00:00:00Z"))).toEqual([PLAN_A]);
    expect(await s.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("answers the plan of every list it removed, and of none it could not remove", async () => {
    const backend = memoryBackend();
    const s = createGuestListStore(withBackend<unknown>(backend));
    await s.save(listFor(PLAN_A, { eventDate: "2027-06-13" }), null);
    await s.save(listFor(PLAN_B, { eventDate: "2027-06-13" }), null);
    expect([...await s.sweep(Date.parse("2028-01-01T00:00:00Z"))].sort()).toEqual([PLAN_A, PLAN_B].sort());

    // A list past its day that storage refuses to remove is not answered: it is still kept.
    await s.save(listFor(PLAN_A, { eventDate: "2027-06-13" }), null);
    const readOnly = createGuestListStore(withBackend<unknown>(readOnlyBackend(backend)));
    expect(await readOnly.sweep(Date.parse("2028-01-01T00:00:00Z"))).toEqual([]);
    expect((await s.open(PLAN_A)).kind).toBe("ready");
  });

  it("leaves a value it cannot read alone until 90 days after it was last stored, then removes it", async () => {
    const { backend, a } = twoTabs();
    // Stored on 1 August 2026: 90 days later is 30 October.
    await backend.put(PLAN_A, { storedAt: "2026-08-01T00:00:00.000Z", value: { junk: true } });
    expect(await a.sweep(Date.parse("2026-10-29T23:59:59.999Z"))).toEqual([]);
    expect(await backend.get(PLAN_A)).not.toBeNull();
    // No name kept in this browser outlives the rule because the value holding it cannot be read.
    expect(await a.sweep(Date.parse("2026-10-30T00:00:00.000Z"))).toEqual([PLAN_A]);
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("never removes a value it cannot read when the time it was stored cannot be read either", async () => {
    const { backend, a } = twoTabs();
    await backend.put(PLAN_A, { storedAt: "not a time", value: { junk: true } });
    expect(await a.sweep(Date.parse("2099-01-01T00:00:00Z"))).toEqual([]);
    expect(await backend.get(PLAN_A)).not.toBeNull();
  });
});

describe("guest list store: a save over another tab's copy never lowers the paper's version", () => {
  const PRINTED_AT = "2026-11-13T10:00:00.000Z";

  /** Both tabs hold version 3, changed since its print; tab A then prints it as version 4 and saves. */
  async function aPrintsWhileBHoldsTheOlderCopy(): Promise<{ readonly a: GuestListStore; readonly b: GuestListStore; readonly base: GuestList; readonly bLoaded: Stamp }> {
    const { a, b } = twoTabs();
    const base = listFor(PLAN_A, { paperVersion: 3, changedSincePrint: true, printedAt: "2026-11-10T09:00:00.000Z" });
    const first = await a.save(base, null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    const printed = await a.save({ ...base, paperVersion: 4, changedSincePrint: false, printedAt: PRINTED_AT, updatedAt: PRINTED_AT }, first.stamp);
    expect(printed.kind).toBe("saved");
    return { a, b, base, bLoaded: first.stamp };
  }

  it("keeps the stored copy's larger version and its print day, marks the list changed since, and answers with what it wrote", async () => {
    const { a, b, base, bLoaded } = await aPrintsWhileBHoldsTheOlderCopy();
    // Tab B, which loaded the copy before the print, saves a change over the printed one.
    const over = await b.save({ ...base, title: "Changed in B", updatedAt: "2026-11-13T10:00:01.000Z" }, bLoaded);
    if (over.kind !== "saved-over-other") throw new Error("the save did not go over the other tab's copy");
    expect(over.paper).toEqual({ paperVersion: 4, printedAt: PRINTED_AT, changedSincePrint: true });

    const kept = await a.open(PLAN_A);
    if (kept.kind !== "ready") throw new Error("nothing is kept");
    // B's content stands; the number of the sheet that went out is not given back.
    expect([kept.list.title, kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint])
      .toEqual(["Changed in B", 4, PRINTED_AT, true]);
  });

  it("a copy printed under the same number at another moment is another sheet: the list is written as changed since that print, and the next print takes the next number", async () => {
    const { a, b, base, bLoaded } = await aPrintsWhileBHoldsTheOlderCopy();
    // Tab B, from the copy before A's print, prints version 4 itself a minute later, and saves over A's copy.
    const ours = {
      ...base,
      title: "Printed in B",
      paperVersion: 4,
      changedSincePrint: false,
      printedAt: "2026-11-13T10:01:00.000Z",
      updatedAt: "2026-11-13T10:01:00.000Z",
    };
    const over = await b.save(ours, bLoaded);
    if (over.kind !== "saved-over-other") throw new Error("the save did not go over the other tab's copy");
    // The answer carries the record written, for the page to take up.
    expect(over.paper).toEqual({ paperVersion: 4, printedAt: PRINTED_AT, changedSincePrint: true });

    const kept = await a.open(PLAN_A);
    if (kept.kind !== "ready") throw new Error("nothing is kept");
    // B's content stands. Number 4 is on A's sheet as well, which was not this list: changed since that print.
    expect([kept.list.title, kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint])
      .toEqual(["Printed in B", 4, PRINTED_AT, true]);
    // So the next print of the list is version 5, a number neither sheet has.
    expect(markPrinted(kept.list, "2026-11-13T10:02:00.000Z").paperVersion).toBe(5);
  });

  it("tells another tab's sheet from this list's own: a larger number, or the same number printed at another moment", () => {
    const at = (paperVersion: number, printedAt: string | null) => ({ paperVersion, printedAt });
    const LATER = "2026-11-13T10:01:00.000Z";
    expect(anotherSheet(at(5, PRINTED_AT), at(4, LATER))).toBe(true);
    expect(anotherSheet(at(4, PRINTED_AT), at(4, LATER))).toBe(true);
    // The same number at the same moment is the same sheet, and a smaller number is an earlier one.
    expect(anotherSheet(at(4, PRINTED_AT), at(4, PRINTED_AT))).toBe(false);
    expect(anotherSheet(at(3, PRINTED_AT), at(4, LATER))).toBe(false);
    // A copy never printed has no sheet.
    expect(anotherSheet(at(0, null), at(0, null))).toBe(false);
    expect(anotherSheet(at(0, PRINTED_AT), at(0, null))).toBe(false);
    expect(anotherSheet(at(1, PRINTED_AT), at(0, null))).toBe(true);
  });

  it("leaves this tab's print record as it is when its version is the larger, or it is the same sheet (the same number, printed at the same moment)", async () => {
    const { a, b, base, bLoaded } = await aPrintsWhileBHoldsTheOlderCopy();
    const ours = { ...base, paperVersion: 5, changedSincePrint: false, printedAt: "2026-11-13T11:00:00.000Z", updatedAt: "2026-11-13T11:00:00.000Z" };
    const larger = await b.save(ours, bLoaded);
    if (larger.kind !== "saved-over-other") throw new Error("the save did not go over the other tab's copy");
    expect(larger.paper).toBeUndefined();
    const kept = await a.open(PLAN_A);
    expect(kept.kind === "ready" ? [kept.list.paperVersion, kept.list.printedAt, kept.list.changedSincePrint] : null)
      .toEqual([5, "2026-11-13T11:00:00.000Z", false]);

    const same = await a.save({ ...ours, paperVersion: 5, title: "A again", updatedAt: "2026-11-13T12:00:00.000Z" }, null);
    if (same.kind !== "saved-over-other") throw new Error("the save did not go over the other tab's copy");
    expect(same.paper).toBeUndefined();
  });

  it("a save over the very copy this tab loaded carries nothing forward", async () => {
    const { a } = twoTabs();
    const first = await a.save(listFor(PLAN_A, { paperVersion: 4, printedAt: PRINTED_AT }), null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    // An undo here can take the page's list back before a print; that is this tab's own doing.
    const second = await a.save(listFor(PLAN_A, { paperVersion: 4, printedAt: PRINTED_AT, title: "Later" }), first.stamp);
    expect(second.kind === "saved" ? second.paper : "not saved").toBeUndefined();
  });
});

describe("guest list store: sweep fails safe", () => {
  afterEach(() => {
    vi.doUnmock("../model.js");
    vi.resetModules();
  });

  it("leaves a list whose removal day cannot be worked out, and still sweeps the rest", async () => {
    const s = store();
    // 30 days after 9999-12-31 is past the last date a JavaScript Date holds.
    await s.save(listFor(PLAN_A, { eventDate: "9999-12-31" }), null);
    await s.save(listFor(PLAN_B, { updatedAt: "2027-01-01T10:00:00.000Z" }), null);
    expect(await s.sweep(Date.parse("2099-01-01T00:00:00Z"))).toEqual([PLAN_B]);
    expect((await s.open(PLAN_A)).kind).toBe("ready");
    expect(await s.open(PLAN_B)).toEqual({ kind: "new" });
  });

  it("leaves a list when the removal day is not a date", async () => {
    vi.resetModules();
    vi.doMock("../model.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../model.js")>();
      return { ...original, deleteAfter: () => ({ dateIso: "not-a-date", rule: "event" as const }) };
    });
    const { createGuestListStore: make } = await import("../store.js");
    const s = make(withBackend<unknown>(memoryBackend()));
    await s.save(listFor(PLAN_A), null);
    expect(await s.sweep(Date.parse("2099-01-01T00:00:00Z"))).toEqual([]);
    expect((await s.open(PLAN_A)).kind).toBe("ready");
  });
});

describe("guestListStore on a device without IndexedDB", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps nothing and says so: this browser has no storage, which is not a read that failed", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    const { guestListStore } = await import("../store.js");
    const s = guestListStore();
    expect(await s.open(PLAN_A)).toEqual({ kind: "no-storage" });
    expect(await s.save(listFor(PLAN_A), null)).toEqual({ kind: "not-kept" });
    expect(await s.sweep(Date.parse("2099-01-01T00:00:00Z"))).toEqual([]);
    await expect(s.erase(PLAN_A)).resolves.toBeUndefined();
    expect(guestListStore()).toBe(s);
  });
});

describe("guest list store: no name in anything it raises or returns", () => {
  it("no error it raises or returns holds a guest's name", async () => {
    const collected: string[] = [];
    const note = (value: unknown): void => {
      collected.push(JSON.stringify(value));
    };
    const named = listFor(PLAN_A, { guests: [guestAt(1, null, null, CANARY)] });

    // Storage refuses, with a message that carries the name.
    const refusing = createGuestListStore(withBackend<unknown>(refusingBackend()));
    note(await refusing.open(PLAN_A));
    note(await refusing.save(named, null));
    note(await refusing.sweep(0));
    try {
      await refusing.erase(PLAN_A);
      collected.push("erase returned");
    } catch (error) {
      collected.push(String(error));
    }

    // A stored value that is not a list, with the name inside it.
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { guests: [{ name: CANARY, extra: CANARY }] });
    note(await a.open(PLAN_A));
    note(await a.sweep(Date.parse("2099-01-01T00:00:00Z")));

    // A newer copy holding the name.
    const { a: tabA, b: tabB } = twoTabs();
    await tabB.save(named, null);
    note(await tabA.save(named, null));

    // A list that fails the check on save, with the name inside it.
    const withExtra = { ...named, extra: CANARY };
    note(await tabA.save(withExtra, null));
    note(await tabA.save(listFor(PLAN_A, { guests: [...manyGuests(600), guestAt(601, null, null, CANARY)] }), null));

    // Reading works, writing refuses with the name in the message.
    const readOnly = createGuestListStore(withBackend<unknown>(readOnlyBackend(memoryBackend())));
    note(await readOnly.save(named, null));

    // A put that resolves and keeps nothing.
    const forgetful = createGuestListStore(withBackend<unknown>(forgetfulBackend(memoryBackend())));
    note(await forgetful.save(named, null));

    expect(collected.length).toBeGreaterThanOrEqual(11);
    for (const text of collected) expect(text).not.toContain(CANARY);
  });
});

// ---------------------------------------------------------------------------
// One at a time: a save's read, write and read-back, a delete and a sweep each
// run alone, across every tab of the browser.
// ---------------------------------------------------------------------------

describe("guest list store: a save, a delete and a sweep run one at a time across tabs", () => {
  /** The browser's lock, as two tabs share it: whoever asks second waits for the first to finish. */
  function sharedLock(): Exclusive {
    let last: Promise<unknown> = Promise.resolve();
    return <T>(work: () => Promise<T>) => {
      const run = last.then(work, work);
      last = run.catch(() => undefined);
      return run.then((value) => ({ ran: true as const, value }));
    };
  }

  it("a delete asked for while another tab's save is between its read and its write waits, so the names do not come back", async () => {
    const backend = memoryBackend();
    const lock = sharedLock();
    const a = createGuestListStore(withBackend<unknown>(backend), lock);
    // Tab B's device holds one read open until told to go on.
    let hold = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow: CacheBackend = {
      ...backend,
      get: async (key) => {
        const value = await backend.get(key);
        if (hold) {
          hold = false;
          await held;
        }
        return value;
      },
    };
    const b = createGuestListStore(withBackend<unknown>(slow), lock);
    const first = await b.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")] }), null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");

    // B saves a change; while its read is held open, A deletes the list.
    hold = true;
    const saving = b.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")], title: "Changed" }), first.stamp);
    const deleting = a.erase(PLAN_A);
    release();
    const saved = await saving;
    await deleting;

    // The save finished first and the delete then removed what it wrote: nothing is stored.
    if (saved.kind !== "saved") throw new Error("the save was not kept");
    expect(await backend.get(PLAN_A)).toBeNull();
    // B's next save finds the list gone, and writes nothing.
    expect((await b.save(listFor(PLAN_A, { title: "Again" }), saved.stamp)).kind).toBe("removed-elsewhere");
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("asks the browser for its lock by one fixed name where it has one, and still does its work where the request is refused", async () => {
    const names: string[] = [];
    let refuse = false;
    const locks = {
      request: (name: string, _options: unknown, work: () => Promise<unknown>): Promise<unknown> => {
        names.push(name);
        return refuse ? Promise.reject(new Error("refused")) : work();
      },
    };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    try {
      const s = store();
      expect((await s.save(listFor(PLAN_A), null)).kind).toBe("saved");
      await s.sweep(Date.parse(NOW));
      await s.erase(PLAN_A);
      expect(names).toEqual(["venviewer-guest-lists", "venviewer-guest-lists", "venviewer-guest-lists"]);
      expect((await s.open(PLAN_A)).kind).toBe("new");

      refuse = true;
      expect((await s.save(listFor(PLAN_A), null)).kind).toBe("saved");
      expect((await s.open(PLAN_A)).kind).toBe("ready");
    } finally {
      Reflect.deleteProperty(navigator, "locks");
    }
  });
});

describe("guest list store: a lock that is never let go does not hold the page up", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "locks");
  });

  it("waits for the lock no longer than its bound, then answers that another tab is busy, and writes nothing", async () => {
    vi.useFakeTimers();
    let asked = 0;
    const locks = {
      // Another tab holds the lock and never lets go: the request ends only when it is given up.
      request: (_name: string, options: { readonly signal: AbortSignal }, _work: () => Promise<unknown>): Promise<unknown> =>
        new Promise((_resolve, reject) => {
          asked += 1;
          options.signal.addEventListener("abort", () => { reject(new Error("given up")); });
        }),
    };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const s = store();
    const answers: string[] = [];
    void s.save(listFor(PLAN_A), null).then((saved) => { answers.push(saved.kind); });

    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
    expect(asked).toBe(1);
    expect(answers).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    // Nothing was written: writing without the lock is how a deleted list came back.
    expect(answers).toEqual(["busy"]);
    expect((await s.open(PLAN_A)).kind).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// Nothing is removed on the strength of an earlier read. The sweep, and the
// removal of a value that cannot be read, compare and delete in one step of
// the store, so a list another tab stored in between stays, lock or no lock.
// ---------------------------------------------------------------------------

describe("guest list store: nothing is removed on the strength of an earlier read", () => {
  /** No lock at all, as in a browser without one: the store's own steps must be enough. */
  const unguarded: Exclusive = async (work) => ({ ran: true, value: await work() });

  /** A device on which `between` runs just after its lists are read: what another tab does between a sweep's read and its delete. */
  function listThenBetween(inner: CacheBackend, between: () => Promise<void>): CacheBackend {
    return {
      ...inner,
      list: async () => {
        const rows = await inner.list();
        await between();
        return rows;
      },
    };
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("the sweep leaves a list another tab saved between its read and its delete, and does not answer it as removed", async () => {
    const backend = memoryBackend();
    const other = createGuestListStore(withBackend<unknown>(backend), unguarded);
    // No date, last changed on 1 January 2027: due from 1 April 2027.
    const first = await other.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")], updatedAt: "2027-01-01T10:00:00.000Z" }), null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    // A second list, due as well, that no tab touches.
    await other.save(listFor(PLAN_B, { updatedAt: "2027-01-01T10:00:00.000Z" }), null);

    const savedBetween: string[] = [];
    const sweeper = createGuestListStore(
      withBackend<unknown>(listThenBetween(backend, async () => {
        // The other tab keeps a change typed today, so the list is no longer due.
        const changed = listFor(PLAN_A, {
          guests: [guestAt(1, null, null, "Ada Canary"), guestAt(2, null, null, "Bea Example")],
          updatedAt: "2027-04-01T09:00:00.000Z",
        });
        savedBetween.push((await other.save(changed, first.stamp)).kind);
      })),
      unguarded,
    );

    expect(await sweeper.sweep(Date.parse("2027-04-01T09:00:01.000Z"))).toEqual([PLAN_B]);
    expect(savedBetween).toEqual(["saved"]);
    const kept = await other.open(PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests.map((g) => g.name) : null).toEqual(["Ada Canary", "Bea Example"]);
    expect(await other.open(PLAN_B)).toEqual({ kind: "new" });
  });

  it("the sweep removes only the very copy it read: a list still past its day, but saved again in between, waits for the next sweep", async () => {
    const backend = memoryBackend();
    const other = createGuestListStore(withBackend<unknown>(backend), unguarded);
    // Dated 13 June 2027: due from 13 July 2027, whatever is changed.
    const first = await other.save(listFor(PLAN_A, { eventDate: "2027-06-13" }), null);
    if (first.kind !== "saved") throw new Error("the first save was not kept");
    let saveBetween = true;
    const sweeper = createGuestListStore(
      withBackend<unknown>(listThenBetween(backend, async () => {
        if (!saveBetween) return;
        saveBetween = false;
        await other.save(listFor(PLAN_A, { eventDate: "2027-06-13", title: "Changed", updatedAt: "2027-07-14T09:00:00.000Z" }), first.stamp);
      })),
      unguarded,
    );

    expect(await sweeper.sweep(Date.parse("2027-07-14T09:00:01.000Z"))).toEqual([]);
    expect((await other.open(PLAN_A)).kind).toBe("ready");
    expect(await sweeper.sweep(Date.parse("2027-07-14T09:00:02.000Z"))).toEqual([PLAN_A]);
    expect(await other.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("the sweep leaves a list another tab saved over a value it could not read, between its read and its delete", async () => {
    const backend = memoryBackend();
    const other = createGuestListStore(withBackend<unknown>(backend), unguarded);
    // Stored on 1 August 2026 and not a list: due from 30 October 2026.
    await backend.put(PLAN_A, { storedAt: "2026-08-01T00:00:00.000Z", value: { junk: true } });
    const savedBetween: string[] = [];
    const sweeper = createGuestListStore(
      withBackend<unknown>(listThenBetween(backend, async () => {
        savedBetween.push((await other.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")] }), null)).kind);
      })),
      unguarded,
    );

    expect(await sweeper.sweep(Date.parse("2026-10-30T00:00:00.000Z"))).toEqual([]);
    expect(savedBetween).toEqual(["saved-over-other"]);
    const kept = await other.open(PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests.map((g) => g.name) : null).toEqual(["Ada Canary"]);
  });

  it("removes a value it cannot read when asked to, and never a list", async () => {
    const { backend, raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    await a.eraseUnreadable(PLAN_A);
    expect(await backend.get(PLAN_A)).toBeNull();

    // A list is left exactly as it was, however it is asked.
    await a.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")] }), null);
    const before = JSON.stringify(await backend.get(PLAN_A));
    await a.eraseUnreadable(PLAN_A);
    expect(JSON.stringify(await backend.get(PLAN_A))).toBe(before);

    // Nothing stored, and a device that refuses: neither rejects.
    await expect(a.eraseUnreadable(PLAN_B)).resolves.toBeUndefined();
    const refusing = createGuestListStore(withBackend<unknown>(refusingBackend()));
    await expect(refusing.eraseUnreadable(PLAN_A)).resolves.toBeUndefined();
  });

  it("removes nothing when another tab saves a list over the value just as the device is asked to delete it", async () => {
    const backend = memoryBackend();
    const other = createGuestListStore(withBackend<unknown>(backend), unguarded);
    await backend.put(PLAN_A, { storedAt: NOW, value: { junk: true } });
    // Whichever way the device is asked to delete, the other tab's save lands first.
    const between = async (): Promise<void> => {
      await other.save(listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")] }), null);
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
    await createGuestListStore(withBackend<unknown>(racing), unguarded).eraseUnreadable(PLAN_A);
    const kept = await other.open(PLAN_A);
    expect(kept.kind === "ready" ? kept.list.guests.map((g) => g.name) : null).toEqual(["Ada Canary"]);
  });

  it("asks for the browser's lock to remove a value it cannot read, as a delete does", async () => {
    const names: string[] = [];
    const locks = {
      request: (name: string, _options: unknown, work: () => Promise<unknown>): Promise<unknown> => {
        names.push(name);
        return work();
      },
    };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    await a.eraseUnreadable(PLAN_A);
    expect(names).toEqual(["venviewer-guest-lists"]);
    expect(await a.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("a browser with no storage has nothing to remove", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    try {
      const { guestListStore } = await import("../store.js");
      await expect(guestListStore().eraseUnreadable(PLAN_A)).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// A list kept by a later version of the kit, in a shape this version cannot
// read. A tab left open across a release still runs this code: it must never
// write over that list, or erase it for being unreadable.
// ---------------------------------------------------------------------------

describe("guest list store: a list kept by a later version of the kit", () => {
  /** What a later kit might keep: its own version, and a field this version does not know. */
  function keptByALaterKit(): Record<string, unknown> {
    return {
      ...listFor(PLAN_A, { guests: [guestAt(1, null, null, "Ada Canary")], revision: 5 }),
      version: LIST_VERSION + 1,
      courses: ["soup"],
    };
  }

  it("marks every list it saves with its own version, so a later kit can tell the same of this one", async () => {
    const { raw, a } = twoTabs();
    await a.save(listFor(PLAN_A), null);
    expect((await raw.get(PLAN_A))?.value).toMatchObject({ version: LIST_VERSION });
  });

  it("opens as a value it cannot read, and is left in place", async () => {
    const { backend, raw, a } = twoTabs();
    await raw.put(PLAN_A, keptByALaterKit());
    const before = JSON.stringify(await backend.get(PLAN_A));
    expect(await a.open(PLAN_A)).toEqual({ kind: "unreadable" });
    expect(JSON.stringify(await backend.get(PLAN_A))).toBe(before);
  });

  it("is never written over by a save, whether or not the save gives way: nothing is written, and the answer is not-kept", async () => {
    const { backend, raw, a } = twoTabs();
    await raw.put(PLAN_A, keptByALaterKit());
    const before = JSON.stringify(await backend.get(PLAN_A));
    const put = vi.spyOn(backend, "put");

    const ours = listFor(PLAN_A, { title: "From the older tab" });
    expect(await a.save(ours, null)).toEqual({ kind: "not-kept" });
    expect(await a.save(ours, { revision: 4, updatedAt: NOW })).toEqual({ kind: "not-kept" });
    expect(await a.save(ours, { revision: 4, updatedAt: NOW }, { yieldToOther: true })).toEqual({ kind: "not-kept" });
    expect(put).not.toHaveBeenCalled();
    expect(JSON.stringify(await backend.get(PLAN_A))).toBe(before);
  });

  it("is never erased as a value that cannot be read", async () => {
    const { backend, raw, a } = twoTabs();
    await raw.put(PLAN_A, keptByALaterKit());
    const before = JSON.stringify(await backend.get(PLAN_A));
    await a.eraseUnreadable(PLAN_A);
    expect(JSON.stringify(await backend.get(PLAN_A))).toBe(before);
  });

  it("is still removed by the planner's own delete", async () => {
    const { backend, raw, a } = twoTabs();
    await raw.put(PLAN_A, keptByALaterKit());
    await a.erase(PLAN_A);
    expect(await backend.get(PLAN_A)).toBeNull();
  });

  it("a value that cannot be read and names no later version is replaced and erased as before", async () => {
    const { backend, raw, a } = twoTabs();
    for (const value of [{ junk: true }, { version: LIST_VERSION, junk: true }, { version: "2" }, { version: 0 }]) {
      await raw.put(PLAN_A, value);
      await a.eraseUnreadable(PLAN_A);
      expect(await backend.get(PLAN_A)).toBeNull();
      await raw.put(PLAN_A, value);
      expect((await a.save(listFor(PLAN_A), null)).kind).toBe("saved-over-other");
      await a.erase(PLAN_A);
    }
  });
});

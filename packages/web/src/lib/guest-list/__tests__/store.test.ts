import { describe, it, expect } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../idb-cache.js";
import { emptyGuestList, type Guest, type GuestList } from "../model.js";
import { createGuestListStore, GUEST_LIST_DB, GUEST_LIST_STORE } from "../store.js";

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
    list: refuse,
  };
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
    expect(await s.save(a, null)).toBe("saved");
    expect(await s.save(b, null)).toBe("saved");

    expect(await s.open(PLAN_A)).toEqual({ kind: "ready", list: a, repaired: 0 });
    expect(await s.open(PLAN_B)).toEqual({ kind: "ready", list: b, repaired: 0 });
  });

  it("stores the list exactly as given and sets no field of its own", async () => {
    const s = store();
    const a = listFor(PLAN_A, { updatedAt: "2026-01-02T03:04:05.000Z" });
    await s.save(a, null);
    expect(await s.open(PLAN_A)).toEqual({ kind: "ready", list: a, repaired: 0 });
  });

  it("says not-kept, and does not throw, when storage refuses", async () => {
    const s = createGuestListStore(withBackend<unknown>(refusingBackend()));
    expect(await s.open(PLAN_A)).toEqual({ kind: "not-kept" });
    expect(await s.save(listFor(PLAN_A), null)).toBe("not-kept");
    await expect(s.erase(PLAN_A)).resolves.toBeUndefined();
    expect(await s.sweep(Date.parse("2030-01-01T00:00:00Z"))).toBe(0);
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

  it("a second tab's newer copy is not overwritten unseen", async () => {
    const { a, b } = twoTabs();
    const base = listFor(PLAN_A, { updatedAt: "2026-11-13T10:00:00.000Z" });
    expect(await a.save(base, null)).toBe("saved");

    const openedA = await a.open(PLAN_A);
    const openedB = await b.open(PLAN_A);
    if (openedA.kind !== "ready" || openedB.kind !== "ready") throw new Error("not ready");
    const aLoadedAt = openedA.list.updatedAt;
    const bLoadedAt = openedB.list.updatedAt;

    const bChanged: GuestList = { ...openedB.list, title: "From B", updatedAt: "2026-11-13T10:05:00.000Z" };
    expect(await b.save(bChanged, bLoadedAt)).toBe("saved");

    const aChanged: GuestList = { ...openedA.list, title: "From A", updatedAt: "2026-11-13T10:06:00.000Z" };
    expect(await a.save(aChanged, aLoadedAt)).toBe("newer-copy-kept-ours");

    const final = await a.open(PLAN_A);
    expect(final.kind === "ready" ? final.list.title : null).toBe("From A");
  });

  it("answers newer-copy-kept-ours when it never loaded one but one is stored", async () => {
    const { a, b } = twoTabs();
    await b.save(listFor(PLAN_A, { title: "Stored" }), null);
    expect(await a.save(listFor(PLAN_A, { title: "Ours" }), null)).toBe("newer-copy-kept-ours");
  });

  it("saves quietly when the stored copy is the one it loaded", async () => {
    const s = store();
    const first = listFor(PLAN_A, { updatedAt: "2026-11-13T10:00:00.000Z" });
    await s.save(first, null);
    const next = { ...first, title: "Next", updatedAt: "2026-11-13T10:01:00.000Z" };
    expect(await s.save(next, first.updatedAt)).toBe("saved");
  });

  it("saves over a stored value it cannot read, without a warning", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    expect(await a.save(listFor(PLAN_A), null)).toBe("saved");
    expect((await a.open(PLAN_A)).kind).toBe("ready");
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

    expect(await s.sweep(Date.parse("2027-03-31T23:59:59.999Z"))).toBe(0);
    expect(await s.sweep(Date.parse("2027-04-01T00:00:00Z"))).toBe(1);
    expect(await s.open(PLAN_B)).toEqual({ kind: "new" });
    expect((await s.open(PLAN_A)).kind).toBe("ready");

    expect(await s.sweep(Date.parse("2027-07-12T23:59:59.999Z"))).toBe(0);
    expect(await s.sweep(Date.parse("2027-07-13T00:00:00Z"))).toBe(1);
    expect(await s.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("leaves a value it cannot read alone", async () => {
    const { raw, a } = twoTabs();
    await raw.put(PLAN_A, { junk: true });
    expect(await a.sweep(Date.parse("2099-01-01T00:00:00Z"))).toBe(0);
    expect((await raw.get(PLAN_A))?.value).toEqual({ junk: true });
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

    expect(collected.length).toBeGreaterThanOrEqual(7);
    for (const text of collected) expect(text).not.toContain(CANARY);
  });
});

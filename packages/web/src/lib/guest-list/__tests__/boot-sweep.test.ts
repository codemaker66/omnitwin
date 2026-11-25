import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../idb-cache.js";
import { emptyGuestList } from "../model.js";
import type { GuestListStore } from "../store.js";

// ---------------------------------------------------------------------------
// Removal also happens when Venviewer opens in this browser, on any page: the
// boot sweep. It runs for every visitor, so it must make no database for one
// who never kept a list, must never throw, and reads no name into anything
// but the device store's own check of a list's removal day.
// ---------------------------------------------------------------------------

const PLAN_A = "5b0a6f0e-7f0b-4d7e-9c3a-2f6f6f0a1b11";
const PLAN_B = "6c1b7a1f-8a1c-4e8f-8d4b-3a7a7a1b2c22";
const KIT_DATABASE = "venviewer-guest-lists";
const NOW = "2026-11-13T10:00:00.000Z";
const CANARY = "CANARY-Q7";

/** A stand-in for the browser's IndexedDB: what it says its databases are, and a count of every database opened. */
function browserStorage(databases: (() => Promise<{ name?: string }[]>) | undefined): { readonly indexedDB: object; readonly opened: Mock } {
  const opened = vi.fn(() => {
    throw new Error("a database was opened");
  });
  return { indexedDB: databases === undefined ? { open: opened } : { open: opened, databases }, opened };
}

interface Booted {
  readonly sweepGuestListsAtBoot: (nowMs?: number) => Promise<void>;
  /** The device store the boot sweep is given, over storage kept in memory. */
  readonly store: GuestListStore;
  readonly backend: CacheBackend;
  /** Counts each time the boot sweep asks for the device store (which is what opens the database). */
  readonly asked: Mock<() => GuestListStore>;
}

/** The boot sweep, loaded afresh over a stand-in IndexedDB and a device store kept in memory. */
async function boot(indexedDB: unknown, storeOver: (backend: CacheBackend) => CacheBackend = (backend) => backend): Promise<Booted> {
  vi.resetModules();
  vi.stubGlobal("indexedDB", indexedDB);
  const actual = await vi.importActual<typeof import("../store.js")>("../store.js");
  const backend = memoryBackend();
  const store = actual.createGuestListStore(withBackend<unknown>(storeOver(backend)));
  const asked = vi.fn(() => store);
  vi.doMock("../store.js", () => ({ ...actual, guestListStore: asked }));
  const { sweepGuestListsAtBoot } = await import("../boot-sweep.js");
  return { sweepGuestListsAtBoot, store, backend, asked };
}

/** Two lists on the device: plan A's event was on 13 June 2027 (removed from 13 July), plan B's is in 2099. */
async function twoListsKept(backend: CacheBackend): Promise<void> {
  const handle = withBackend<unknown>(backend);
  await handle.put(PLAN_A, { ...emptyGuestList(PLAN_A, NOW), eventDate: "2027-06-13", guests: [{ id: "00000000-0000-4000-8000-000000001001", name: CANARY, party: "", tableId: null, seat: null }] });
  await handle.put(PLAN_B, { ...emptyGuestList(PLAN_B, NOW), eventDate: "2099-06-13" });
}

afterEach(() => {
  vi.doUnmock("../store.js");
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("the boot sweep of guest lists", () => {
  it("removes a list past its removal day, and leaves one that is not yet due", async () => {
    const { indexedDB } = browserStorage(() => Promise.resolve([{ name: "another-database" }, { name: KIT_DATABASE }]));
    const { sweepGuestListsAtBoot, store, backend } = await boot(indexedDB);
    await twoListsKept(backend);

    await expect(sweepGuestListsAtBoot(Date.parse("2027-07-12T23:59:59.999Z"))).resolves.toBeUndefined();
    expect((await store.open(PLAN_A)).kind).toBe("ready");

    await expect(sweepGuestListsAtBoot(Date.parse("2027-07-13T00:00:00.000Z"))).resolves.toBeUndefined();
    expect(await store.open(PLAN_A)).toEqual({ kind: "new" });
    expect((await store.open(PLAN_B)).kind).toBe("ready");
  });

  it("goes by the clock when it is given no time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-07-13T00:00:00.000Z"));
    const { indexedDB } = browserStorage(() => Promise.resolve([{ name: KIT_DATABASE }]));
    const { sweepGuestListsAtBoot, store, backend } = await boot(indexedDB);
    await twoListsKept(backend);
    await sweepGuestListsAtBoot();
    expect(await store.open(PLAN_A)).toEqual({ kind: "new" });
    expect((await store.open(PLAN_B)).kind).toBe("ready");
  });

  it("does nothing, and opens no database, when the browser says it holds no guest list database", async () => {
    for (const known of [[], [{ name: "another-database" }, {}]]) {
      const { indexedDB, opened } = browserStorage(() => Promise.resolve(known));
      const { sweepGuestListsAtBoot, store, backend, asked } = await boot(indexedDB);
      await twoListsKept(backend);
      const sweep = vi.spyOn(store, "sweep");

      await expect(sweepGuestListsAtBoot(Date.parse("2099-12-31T00:00:00.000Z"))).resolves.toBeUndefined();
      // The device store is never asked for (asking is what would open, and so make, the database).
      expect(asked).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      expect(sweep).not.toHaveBeenCalled();
      expect((await store.open(PLAN_A)).kind).toBe("ready");
    }
  });

  it("does nothing in a browser with no IndexedDB at all", async () => {
    const { sweepGuestListsAtBoot, asked } = await boot(undefined);
    await expect(sweepGuestListsAtBoot(Date.parse("2099-12-31T00:00:00.000Z"))).resolves.toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });

  it("sweeps in a browser that cannot say which databases it holds", async () => {
    const { indexedDB } = browserStorage(undefined);
    const { sweepGuestListsAtBoot, store, backend } = await boot(indexedDB);
    await twoListsKept(backend);
    await sweepGuestListsAtBoot(Date.parse("2027-07-13T00:00:00.000Z"));
    expect(await store.open(PLAN_A)).toEqual({ kind: "new" });
  });

  it("never throws when storage refuses, and says nothing", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const refuse = (): Promise<never> => Promise.reject(new Error(`storage refused ${CANARY}`));
    const refusing = (): CacheBackend => ({ get: refuse, put: refuse, delete: refuse, deleteIf: refuse, upsert: refuse, list: refuse });

    // The browser refuses to list its databases: the sweep is still tried, and its own refusal is swallowed too.
    const listing = await boot(browserStorage(refuse).indexedDB, refusing);
    await expect(listing.sweepGuestListsAtBoot()).resolves.toBeUndefined();
    expect(listing.asked).toHaveBeenCalledTimes(1);

    // Listing throws outright, rather than rejecting.
    const throwing = await boot({ databases: () => { throw new Error(`refused ${CANARY}`); } }, refusing);
    await expect(throwing.sweepGuestListsAtBoot()).resolves.toBeUndefined();

    // The device store cannot be made, or its sweep rejects.
    const noStore = await boot(browserStorage(() => Promise.resolve([{ name: KIT_DATABASE }])).indexedDB);
    noStore.asked.mockImplementation(() => {
      throw new Error(`no store ${CANARY}`);
    });
    await expect(noStore.sweepGuestListsAtBoot()).resolves.toBeUndefined();
    const rejecting = await boot(browserStorage(() => Promise.resolve([{ name: KIT_DATABASE }])).indexedDB);
    vi.spyOn(rejecting.store, "sweep").mockRejectedValue(new Error(`sweep refused ${CANARY}`));
    await expect(rejecting.sweepGuestListsAtBoot()).resolves.toBeUndefined();

    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("is loaded late and by itself from the app's entry, never by a static import", () => {
    const entry = readFileSync(resolve("src/main.tsx"), "utf8");
    expect(entry).toMatch(/import\(["']\.\/lib\/guest-list\/boot-sweep\.js["']\)/);
    expect(entry).not.toMatch(/from\s+["']\.\/lib\/guest-list\//);
    expect(entry).not.toMatch(/from\s+["']\.\/stores\/guest-list-store/);
    // In the block that runs a while after the page has settled, with the planner's draft sweep.
    const delayed = /window\.setTimeout\(\(\) => \{([\s\S]*?)\}, PLANNER_DRAFT_SWEEP_DELAY_MS\);/.exec(entry)?.[1] ?? "";
    expect(delayed).toContain('import("./lib/planner-draft-storage.js")');
    expect(delayed).toContain('import("./lib/guest-list/boot-sweep.js")');
  });
});

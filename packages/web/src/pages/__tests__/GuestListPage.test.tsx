import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ApiError } from "../../api/client.js";
import type { Configuration, PlacedObject } from "../../api/configurations.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { memoryBackend, withBackend, type CacheBackend } from "../../lib/idb-cache.js";
import { KIT_STORAGE_KEY } from "../../lib/guest-list/kit-switch.js";
import { deleteAfter, earliestEventDate, emptyGuestList, type Guest, type GuestList, type KitTable } from "../../lib/guest-list/model.js";
import { createGuestListStore, stampOf, type GuestListStore, type Opened } from "../../lib/guest-list/store.js";
import { useGuestListStore } from "../../stores/guest-list-store.js";
import { GuestListPage } from "../GuestListPage.js";

// ---------------------------------------------------------------------------
// The planner's guest list page. Only the one network module is stubbed (the
// read of the plan); the list is kept in a memory store injected as the page's
// store, so every case runs the real paste reader, seating and page state. One
// case has a move refused once (see `mocks.refuseNextMove`); all others seat for real.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getPublicConfig: vi.fn<(configId: string, signal?: AbortSignal) => Promise<Configuration>>(),
  /** A move refused once, as no button can now provoke one (a full table offers none). Null: the real seating. */
  refuseNextMove: { kind: null as null | "seat-taken" | "table-full" | "no-such-table" | "no-such-guest" },
}));
vi.mock("../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/configurations.js")>(),
  getPublicConfig: mocks.getPublicConfig,
}));
vi.mock("../../lib/guest-list/seating.js", async (importOriginal) => {
  const seating = await importOriginal<typeof import("../../lib/guest-list/seating.js")>();
  return {
    ...seating,
    moveGuest: (...args: Parameters<typeof seating.moveGuest>): ReturnType<typeof seating.moveGuest> => {
      const kind = mocks.refuseNextMove.kind;
      if (kind === null) return seating.moveGuest(...args);
      mocks.refuseNextMove.kind = null;
      return { refused: kind };
    },
  };
});

const PLAN_ID = "3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b34";
const PAGE = `/plan/${PLAN_ID}/guests?kit=on`;
const CANARY = "CANARY-Q7";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function assetId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error("fixture slug missing from the catalogue");
  return item.id;
}

const ROUND_TABLE = assetId("round-table-6ft");
const CHAIR = assetId("banquet-chair");

let serial = 0;
function piece(assetDefinitionId: string, groupId: string, x: number): PlacedObject {
  serial += 1;
  return {
    id: `placed-${String(serial)}`,
    configurationId: PLAN_ID,
    assetDefinitionId,
    positionX: String(x),
    positionY: "0",
    positionZ: "0",
    rotationX: "0",
    rotationY: "0",
    rotationZ: "0",
    scale: "1",
    sortOrder: serial,
    metadata: { groupId },
  };
}

/** A plan holding `tables` round tables, each with ten chairs of its own. */
function room(tables: number, name = "Fraser and Okafor"): Configuration {
  const objects: PlacedObject[] = [];
  for (let t = 1; t <= tables; t += 1) {
    const group = `group-${String(t)}`;
    objects.push(piece(ROUND_TABLE, group, t * 4));
    for (let c = 0; c < 10; c += 1) objects.push(piece(CHAIR, group, t * 4));
  }
  return {
    id: PLAN_ID,
    spaceId: "space-1",
    venueId: "venue-1",
    userId: null,
    name,
    isPublicPreview: true,
    revision: 1,
    objects,
  };
}

function guest(n: number, name: string, tableId: string | null = null, seat: number | null = null, party = ""): Guest {
  return { id: uuid(1000 + n), name, party, tableId, seat };
}

function table(n: number, seats = 10, name = ""): KitTable {
  return { id: uuid(n), number: n, name, seats };
}

function listOf(patch: Partial<GuestList>): GuestList {
  return { ...emptyGuestList(PLAN_ID, new Date().toISOString()), ...patch };
}

function memoryStore(backend: CacheBackend = memoryBackend()): GuestListStore {
  return createGuestListStore(withBackend<unknown>(backend));
}

async function storeHolding(list: GuestList): Promise<{ readonly store: GuestListStore; readonly backend: CacheBackend }> {
  const backend = memoryBackend();
  const store = memoryStore(backend);
  expect((await store.save(list, null)).kind).toBe("saved");
  return { store, backend };
}

/**
 * Another tab of the same browser changes the list: a device store of its own
 * over the same storage opens what is kept, changes it and saves it.
 */
async function otherTabSaves(backend: CacheBackend, change: (kept: GuestList) => GuestList): Promise<void> {
  const tab = memoryStore(backend);
  const opened = await tab.open(PLAN_ID);
  if (opened.kind !== "ready") throw new Error("nothing is kept for the other tab to change");
  expect((await tab.save(change(opened.list), stampOf(opened.list))).kind).toBe("saved");
}

function refusingBackend(): CacheBackend {
  const refuse = (): Promise<never> => Promise.reject(new Error("storage refused"));
  return { get: refuse, put: refuse, delete: refuse, deleteIf: refuse, upsert: refuse, list: refuse };
}

/** The first read refuses, then storage works: a read that failed just now. */
function firstReadRefused(inner: CacheBackend): CacheBackend {
  let refused = false;
  return {
    ...inner,
    get: (key) => {
      if (refused) return inner.get(key);
      refused = true;
      return Promise.reject(new Error("storage refused"));
    },
  };
}

const NOT_KEPT_WORDS = "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave.";
const NOT_OPENED = "The list kept here for this plan could not be opened just now. Reload the page to try again. Anything added here is not being kept.";
const OTHER_TAB_WORDS = "This list was also changed in another tab. This tab's version was kept.";
const REMOVED_ELSEWHERE_WORDS = "This list is no longer kept in this browser. It was deleted in another tab, or this browser's stored data was cleared.";
const ADDED_AFTER_DELETE_WORDS = "Names were added to this list in another tab after it was deleted here.";
const REMOVED_BY_RULE_WORDS = "This list was removed from this browser: a list is removed 30 days after its event, or 90 days after its last change.";

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Another page of the same app, where the panel's "Open the room" leads, with a way back to the guest list. */
function Room(): ReactElement {
  return (
    <main data-testid="room">
      <p>room</p>
      <Link to={PAGE}>Back to the guest list</Link>
    </main>
  );
}

function open(entry: string, store?: GuestListStore): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/plan/:code/guests" element={<GuestListPage store={store} />} />
        <Route path="/plan/:code/guests/paper" element={<p data-testid="paper">paper</p>} />
        <Route path="/plan/:code" element={<Room />} />
        <Route path="/plan" element={<p data-testid="planner">planner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function desk(): Promise<HTMLElement> {
  return screen.findByTestId("guest-list-desk");
}

/**
 * Leaves the guest list for another page of the app by the panel's own link.
 * The page unmounts; the page state is left exactly as it was.
 */
async function leaveForTheRoom(): Promise<void> {
  fireEvent.click(screen.getByRole("link", { name: "Open the room" }));
  await screen.findByTestId("room");
  expect(screen.queryByTestId("guest-list-page")).toBeNull();
  expect(state().planId).toBe(PLAN_ID);
}

/** Comes back to the guest list by a link inside the same router: the page mounts again over the same page state. */
async function comeBackToTheList(): Promise<void> {
  fireEvent.click(screen.getByRole("link", { name: "Back to the guest list" }));
  await desk();
}

function metas(name: string): HTMLMetaElement[] {
  return Array.from(document.head.querySelectorAll<HTMLMetaElement>(`meta[name='${name}']`));
}

function names(count: number): string {
  return Array.from({ length: count }, (_, i) => `Ailsa${String(i + 1)} Fraser${String(i + 1)}`).join("\n");
}

function state(): ReturnType<typeof useGuestListStore.getState> {
  return useGuestListStore.getState();
}

function currentList(): GuestList {
  const list = state().list;
  if (list === null) throw new Error("no list open");
  return list;
}

async function flush(): Promise<void> {
  await act(async () => {
    await state().flush();
  });
}

async function pasteAndAdd(text: string, count: number): Promise<void> {
  fireEvent.change(screen.getByLabelText("Paste the names"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: `Add ${String(count)} guests` }));
  await screen.findByText(`0 of ${String(count)} guests have a seat.`);
}

/** Everything the Tab key can reach, in document order (happy-dom has no layout). */
function tabbables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"))
    .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1" && el.closest("[hidden]") === null);
}

/** Presses Tab until `match` holds for the focused element, as a person would. */
function tabUntil(match: (el: HTMLElement) => boolean): HTMLElement {
  for (let step = 0; step < 600; step += 1) {
    const all = tabbables();
    const at = document.activeElement instanceof HTMLElement ? all.indexOf(document.activeElement) : -1;
    const next = all[at + 1];
    if (next === undefined) break;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    next.focus();
    if (match(next)) return next;
  }
  throw new Error("Tab never reached the control");
}

/** Enter on a native button: the browser's default action is a click, which happy-dom does not perform. */
function pressEnter(el: HTMLElement): void {
  expect(el.tagName).toBe("BUTTON");
  fireEvent.keyDown(el, { key: "Enter" });
  fireEvent.click(el);
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  mocks.getPublicConfig.mockReset();
  mocks.getPublicConfig.mockResolvedValue(room(18));
  mocks.refuseNextMove.kind = null;
  fetchSpy = vi.spyOn(globalThis, "fetch");
  window.localStorage.clear();
  document.title = "before";
  state().reset();
});

afterEach(() => {
  cleanup();
  state().reset();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The switch, the address and the head
// ---------------------------------------------------------------------------

describe("the guest list page: the switch and the address", () => {
  it("is the not-found page with the switch off, and makes no request", () => {
    open(`/plan/${PLAN_ID}/guests`, memoryStore());
    expect(screen.getByTestId("not-found")).toBeTruthy();
    expect(screen.queryByTestId("guest-list-page")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a malformed plan id, says the address is not a plan and makes no request", () => {
    open("/plan/not-a-uuid/guests?kit=on", memoryStore());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This address is not a plan");
    expect(screen.getByRole("link", { name: "Open the planner" }).getAttribute("href")).toBe("/plan");
    expect(screen.queryByTestId("guest-list-page")).toBeNull();
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("puts the page on its ivory register when the switch is on and the plan id is well formed", async () => {
    open(PAGE, memoryStore());
    const root = screen.getByTestId("guest-list-page");
    expect(root.className).toBe("gl");
    expect(root.getAttribute("data-register")).toBe("ivory");
    expect(await desk()).toBeTruthy();
  });

  it("answers on a later visit with no parameter once the switch was remembered", async () => {
    window.localStorage.setItem(KIT_STORAGE_KEY, "on");
    open(`/plan/${PLAN_ID}/guests`, memoryStore());
    expect(screen.getByTestId("guest-list-page")).toBeTruthy();
    expect(await desk()).toBeTruthy();
  });

  it("sets noindex and no-referrer in the head and removes them on leaving", async () => {
    const view = open(PAGE, memoryStore());
    await desk();
    expect(document.title).toBe("Guest list");
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
    expect(metas("referrer")).toHaveLength(0);
  });

  it("keeps the head private on the malformed-address sheet too", () => {
    const view = open("/plan/not-a-uuid/guests?kit=on", memoryStore());
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

describe("the guest list page: the desk", () => {
  it("shows the working state while the list opens, then the desk", async () => {
    const opened = deferred<Opened>();
    const store: GuestListStore = { ...memoryStore(), open: () => opened.promise };
    open(PAGE, store);

    expect(screen.getByRole("status").textContent).toContain("Opening your guest list…");
    expect(document.querySelector("[data-activity-indicator='particles']")).not.toBeNull();
    expect(screen.queryByTestId("guest-list-desk")).toBeNull();

    await act(async () => {
      opened.resolve({ kind: "new" });
      await opened.promise;
    });

    const shown = await desk();
    expect(shown.className).toContain("gl-desk");
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
    expect(screen.queryByText("Opening your guest list…")).toBeNull();
  });

  it("shows the desk without waiting for the room", async () => {
    const plan = deferred<Configuration>();
    mocks.getPublicConfig.mockReturnValue(plan.promise);
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    await act(async () => {
      plan.resolve(room(2));
      await plan.promise;
    });
    expect(await screen.findByRole("button", { name: "Use the room's 2 tables" })).toBeTruthy();
  });

  it("paste, add, tables, seat: the sentence and the four counts follow", async () => {
    open(PAGE, memoryStore());
    await desk();

    fireEvent.click(screen.getByRole("button", { name: "Paste a list" }));
    const box = screen.getByLabelText("Paste the names");
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: names(180) } });
    expect(screen.getByText("180 names found. Only names and parties are taken.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 180 guests" }));

    expect(await screen.findByText("0 of 180 guests have a seat.")).toBeTruthy();
    expect(screen.getByText("180 are still to seat.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Use the room's 18 tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));

    expect(screen.getByText("180 of 180 guests have a seat.")).toBeTruthy();
    expect(screen.queryByText(/still to seat/)).toBeNull();
    expect(screen.getByRole("button", { name: "Guests 180" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Seated 180" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To seat 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tables 18" })).toBeTruthy();
    const print = screen.getByRole("link", { name: "Print the table plan" });
    expect(print.getAttribute("href")).toBe(`/plan/${PLAN_ID}/guests/paper?kit=on&sheet=table-plan`);
    expect(screen.getByRole("link", { name: "Open the room" }).getAttribute("href")).toBe(`/plan/${PLAN_ID}`);
    expect(currentList().tables.every((t) => t.seats === 10)).toBe(true);
  });

  it("shows each count's number beside its button and reads it once, as the button's name", async () => {
    open(PAGE, memoryStore());
    await desk();
    for (const label of ["Guests", "Seated", "To seat", "Tables"]) {
      const button = screen.getByRole("button", { name: `${label} 0` });
      // The button lies over its whole tile and draws the tile's focus ring; the number is drawn beside it.
      expect(button.textContent).toBe("");
      const [labelId = "", valueId = ""] = (button.getAttribute("aria-labelledby") ?? "").split(" ");
      expect(document.getElementById(labelId)?.textContent).toBe(label);
      const value = document.getElementById(valueId);
      expect(value?.textContent).toBe("0");
      expect(value?.getAttribute("aria-hidden")).toBe("true");
      expect(value?.parentElement).toBe(button.parentElement);
    }
  });

  it("says only names and parties were taken, and how many columns were left", async () => {
    open(PAGE, memoryStore());
    await desk();
    const text = [
      "Name\tParty\tEmail\tDiet",
      `Ailsa Fraser\tFraser family\t${CANARY}@example.com\tVegetarian`,
      "Chidi Okafor\tOkafor family\tchidi@example.com\tNone",
    ].join("\n");
    fireEvent.change(screen.getByLabelText("Paste the names"), { target: { value: text } });
    expect(screen.getByText("2 names found. Only names and parties are taken. 2 other columns are left on your computer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 guests" }));
    await screen.findByText("0 of 2 guests have a seat.");

    const kept = currentList().guests.map((g) => ({ name: g.name, party: g.party }));
    expect(kept).toEqual([
      { name: "Ailsa Fraser", party: "Fraser family" },
      { name: "Chidi Okafor", party: "Okafor family" },
    ]);
    expect(JSON.stringify(currentList())).not.toContain(CANARY);
    expect(JSON.stringify(currentList())).not.toContain("Vegetarian");
  });

  it("a guest is moved with the keyboard alone", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1), table(2)],
      guests: [
        guest(1, "Ailsa Fraser"),
        guest(2, "Chidi Okafor", uuid(1), 1),
        guest(3, "Morag Kerr", uuid(1), 2),
        guest(4, "Ewan Shaw", uuid(1), 3),
      ],
    }));
    open(PAGE, store);
    await desk();

    pressEnter(tabUntil((el) => el.getAttribute("aria-expanded") === "false" && (el.textContent ?? "").includes("Table 1")));
    pressEnter(tabUntil((el) => el.textContent === "Ailsa Fraser"));
    expect(screen.getByText(/Choose a free seat or a table/)).toBeTruthy();
    pressEnter(tabUntil((el) => (el.textContent ?? "").includes("Seat here") && (el.textContent ?? "").includes("seat 4")));

    const moved = currentList().guests.find((g) => g.id === uuid(1001));
    expect(moved?.tableId).toBe(uuid(1));
    expect(moved?.seat).toBe(4);
    expect(screen.queryByText(/Choose a free seat or a table/)).toBeNull();
    expect(screen.getByText("Ailsa Fraser is at table 1, seat 4.")).toBeTruthy();
  });

  it("Escape lets go of a chosen guest", async () => {
    const { store } = await storeHolding(listOf({ tables: [table(1)], guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    expect(screen.getByText(/Choose a free seat or a table/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/Choose a free seat or a table/)).toBeNull();
    expect(currentList().guests[0]?.tableId).toBeNull();
    expect(screen.getByRole("button", { name: "To seat 1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("offers a chosen guest no seat at a full table, and moves nobody", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 2), table(2, 2)],
      guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor", uuid(1), 1), guest(3, "Morag Kerr", uuid(1), 2)],
    }));
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    // The table with room offers its seat; the full one offers none, so nothing there can be refused.
    expect(screen.getByRole("button", { name: "Seat here at table 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Seat here at table 1" })).toBeNull();
    expect(currentList().guests[0]?.tableId).toBeNull();
  });

  it("keeps the Moving words, the line that says where a guest went and the event's name from a browser's translation", async () => {
    const { store } = await storeHolding(listOf({
      title: "Fraser and Okafor",
      tables: [table(1, 2), table(2, 2)],
      guests: [guest(1, "Ailsa Fraser")],
    }));
    open(PAGE, store);
    await desk();
    expect(screen.getByRole("heading", { name: "Fraser and Okafor" }).getAttribute("translate")).toBe("no");
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    expect(screen.getByText(/^Moving Ailsa Fraser/u).getAttribute("translate")).toBe("no");
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 2" }));
    expect(screen.getByText("Ailsa Fraser is at table 2, seat 1.").getAttribute("translate")).toBe("no");
  });

  it("says a refused move in a status region that is there before the refusal, and is the same node after it", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 2), table(2, 2)],
      guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor", uuid(1), 1)],
    }));
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    const group = screen.getByRole("group", { name: /^Moving / });
    const status = within(group).getByRole("status");
    expect(status.textContent).toBe("");
    mocks.refuseNextMove.kind = "table-full";
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 2" }));
    expect(within(group).getByRole("status")).toBe(status);
    expect(status.textContent).toBe("That table is full.");
    expect(currentList().guests[0]?.tableId).toBeNull();
  });

  it("removing a table shows its guests under To seat with the count", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1), table(2)],
      guests: [
        guest(1, "Ailsa Fraser", uuid(1), 1),
        guest(2, "Chidi Okafor", uuid(2), 1),
        guest(3, "Morag Kerr", uuid(2), 2),
      ],
    }));
    open(PAGE, store);
    await desk();

    fireEvent.click(screen.getByRole("button", { name: /Table 2/, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Remove table 2" }));

    expect(screen.getByText("Table 2 was removed. Its 2 guests are now to seat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "To seat 2" }));
    expect(screen.getByText("Showing the 2 guests with no seat yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kerr, Morag" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Okafor, Chidi" })).toBeTruthy();
    expect(screen.getAllByText("No seat yet")).toHaveLength(2);
    expect(currentList().tables.map((t) => t.number)).toEqual([1]);
  });

  it("says the list is not being kept when this browser has no storage, and still seats guests", async () => {
    mocks.getPublicConfig.mockResolvedValue(room(2));
    open(PAGE, { ...memoryStore(refusingBackend()), open: () => Promise.resolve({ kind: "no-storage" }) });
    await desk();
    const words = NOT_KEPT_WORDS;
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText(NOT_OPENED)).toBeNull();
    expect(screen.queryByText(/These names are kept only in this browser/)).toBeNull();

    await pasteAndAdd(names(5), 5);
    fireEvent.click(await screen.findByRole("button", { name: "Use the room's 2 tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));
    expect(screen.getByText("5 of 5 guests have a seat.")).toBeTruthy();

    await flush();
    expect(state().kept).toBe(false);
    expect(screen.getByText(words)).toBeTruthy();
  });

  it("announces its notices: they appear in a status region always on the page, and the list not being kept is an alert", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    const view = open(PAGE, store);
    await desk();
    const notices = document.querySelector(".gl-notices");
    expect(notices?.getAttribute("role")).toBe("status");
    expect(notices?.children).toHaveLength(0);
    view.unmount();
    state().reset();

    open(PAGE, { ...memoryStore(refusingBackend()), open: () => Promise.resolve({ kind: "no-storage" }) });
    await desk();
    const notKept = screen.getByText(NOT_KEPT_WORDS).closest("[data-notice]");
    expect(notKept?.getAttribute("role")).toBe("alert");
    expect(notKept?.parentElement?.getAttribute("role")).toBe("status");
  });

  it("says, as an alert, when the list kept here could not be opened, offers no delete, and never erases it", async () => {
    const kept = listOf({ guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor"), guest(3, "Morag Kerr")] });
    const { backend } = await storeHolding(kept);
    const before = JSON.stringify(await backend.get(PLAN_ID));
    open(PAGE, memoryStore(firstReadRefused(backend)));
    await desk();

    const notice = screen.getByText(NOT_OPENED).closest("[data-notice]");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(NOT_KEPT_WORDS)).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete the list from this device" })).toBeNull();

    // Work done here is not kept over the list nobody has seen.
    await pasteAndAdd(names(2), 2);
    await flush();
    expect(screen.getByText(NOT_OPENED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete the list from this device" })).toBeNull();
    expect(JSON.stringify(await backend.get(PLAN_ID))).toBe(before);
  });

  it("when the plan answers 404, says the room could not be opened and keeps the list", async () => {
    mocks.getPublicConfig.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    const { store } = await storeHolding(listOf({
      guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor"), guest(3, "Morag Kerr")],
    }));
    open(PAGE, store);
    await desk();

    expect(await screen.findByText("The room for this plan could not be opened, so its tables were not counted. Your list is unaffected.")).toBeTruthy();
    expect(screen.getByText("0 of 3 guests have a seat.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use the room's/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set the tables" }));
    const form = screen.getByRole("form", { name: "Set the tables" });
    fireEvent.change(within(form).getByLabelText("Tables"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set the tables" }));
    expect(currentList().tables).toHaveLength(2);
    expect(currentList().tables.every((t) => t.seats === 10)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));
    expect(screen.getByText("3 of 3 guests have a seat.")).toBeTruthy();
  });

  it("a blank number of tables changes nothing", async () => {
    mocks.getPublicConfig.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    fireEvent.click(await screen.findByRole("button", { name: "Set the tables" }));
    const form = screen.getByRole("form", { name: "Set the tables" });
    fireEvent.change(within(form).getByLabelText("Seats at each table"), { target: { value: "" } });
    fireEvent.change(within(form).getByLabelText("Tables"), { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set the tables" }));
    expect(currentList().tables).toHaveLength(0);
    expect(state().canUndo).toBe(false);
  });

  it("says when the room's tables and the list's differ", async () => {
    mocks.getPublicConfig.mockResolvedValue(room(17));
    const tables = Array.from({ length: 18 }, (_, i) => table(i + 1));
    const { store } = await storeHolding(listOf({ tables, guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    expect(await screen.findByText("The room has 17 tables; your list has 18.")).toBeTruthy();
  });

  it("deleting asks first, in the panel, and then the list is gone from the store", async () => {
    // happy-dom has no browser dialog: a stand-in proves the page never asks through one.
    const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    Object.defineProperty(window, "confirm", { value: confirmSpy, configurable: true, writable: true });
    const { store } = await storeHolding(listOf({
      guests: [guest(1, "Ailsa Fraser"), guest(2, "Chidi Okafor"), guest(3, "Morag Kerr")],
    }));
    open(PAGE, store);
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });

    fireEvent.click(within(panel).getByRole("button", { name: "Delete the list from this device" }));
    expect(within(panel).getByRole("button", { name: "Keep the list" })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Keep the list" }));
    expect((await store.open(PLAN_ID)).kind).toBe("ready");
    expect(screen.getByText("0 of 3 guests have a seat.")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Delete the list from this device" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Delete 3 names for good" }));
    expect(await screen.findByText("There are no guests on this list yet.")).toBeTruthy();
    expect((await store.open(PLAN_ID)).kind).toBe("new");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("asks the plan once, with no body, and asks nothing else", async () => {
    const view = open(PAGE, memoryStore());
    await desk();
    await pasteAndAdd(names(3), 3);
    fireEvent.click(await screen.findByRole("button", { name: "Use the room's 18 tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));
    await flush();

    expect(mocks.getPublicConfig).toHaveBeenCalledTimes(1);
    const call = mocks.getPublicConfig.mock.calls[0];
    expect(call).toHaveLength(2);
    expect(call?.[0]).toBe(PLAN_ID);
    const signal = call?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(fetchSpy).not.toHaveBeenCalled();
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("puts no guest's name in a class, an id or an address", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 10, "Top table")],
      guests: [guest(1, `${CANARY} Fraser`, uuid(1), 1), guest(2, `Ailsa ${CANARY}`)],
    }));
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: /Top table/, expanded: false }));
    for (const el of Array.from(document.querySelectorAll("*"))) {
      for (const attribute of ["class", "id", "href", "for", "aria-controls", "aria-labelledby", "data-testid"]) {
        expect(el.getAttribute(attribute) ?? "").not.toContain(CANARY);
      }
    }
    fireEvent.click(screen.getByRole("button", { name: /Guests 2/ }));
    for (const el of Array.from(document.querySelectorAll("*"))) {
      expect(el.getAttribute("class") ?? "").not.toContain(CANARY);
      expect(el.getAttribute("id") ?? "").not.toContain(CANARY);
    }
  });
});

// ---------------------------------------------------------------------------
// The device's answers, in words
// ---------------------------------------------------------------------------

describe("the guest list page: what the device says", () => {
  it("a list that cannot be read is said so, and a new one can be started", async () => {
    const backend = memoryBackend();
    await backend.put(PLAN_ID, { storedAt: new Date().toISOString(), value: { not: "a list" } });
    open(PAGE, memoryStore(backend));
    expect(await screen.findByText("A list was kept here for this plan, but it cannot be read.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start a new list" }));
    await desk();
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
  });

  it("says how many guests were sent back to seat on opening, and the notice closes", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 1), guest(2, "Chidi Okafor", uuid(1), 1), guest(3, "Morag Kerr", uuid(1), 1)],
    }));
    open(PAGE, store);
    await desk();
    const words = "2 guests were sent back to seat, because their table or seat was no longer there.";
    expect(screen.getByText(words)).toBeTruthy();
    fireEvent.click(within(screen.getByText(words).closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(words)).toBeNull();
  });

  it("says when another tab changed the list and this tab's version was kept", async () => {
    const opened = listOf({ guests: [guest(1, "Ailsa Fraser")] });
    const { store, backend } = await storeHolding(opened);
    open(PAGE, store);
    await desk();
    await otherTabSaves(backend, (kept) => ({ ...kept, title: "Another tab", updatedAt: new Date(Date.now() + 60_000).toISOString() }));

    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    await flush();
    expect(await screen.findByText("This list was also changed in another tab. This tab's version was kept.")).toBeTruthy();
  });

  it("takes up another tab's print when the page is seen again, so a change here never lowers the paper's version", async () => {
    const opened = listOf({ tables: [table(1)], guests: [guest(1, "Ailsa Fraser", uuid(1), 1), guest(2, "Chidi Okafor")] });
    const { store, backend } = await storeHolding(opened);
    open(PAGE, store);
    await desk();

    // The paper, printed in a second tab: version 1.
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      paperVersion: 1,
      changedSincePrint: false,
      printedAt: new Date().toISOString(),
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => { expect(currentList().paperVersion).toBe(1); });

    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));
    await flush();
    const kept = await store.open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.paperVersion).toBe(1);
    expect(kept.list.changedSincePrint).toBe(true);
    expect(kept.list.guests.every((g) => g.seat !== null)).toBe(true);
    expect(screen.queryByText("This list was also changed in another tab. This tab's version was kept.")).toBeNull();
  });

  it("takes up another tab's change when the page becomes visible again", async () => {
    const opened = listOf({ guests: [guest(1, "Ailsa Fraser")] });
    const { store, backend } = await storeHolding(opened);
    open(PAGE, store);
    await desk();
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      guests: [...kept.guests, guest(2, "Chidi Okafor")],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(await screen.findByText("0 of 2 guests have a seat.")).toBeTruthy();
  });

  it("a list deleted in another tab is not written back: the page takes an empty list and says so", async () => {
    const { store, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    await flush();
    await memoryStore(backend).erase(PLAN_ID);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    const words = await screen.findByText(REMOVED_ELSEWHERE_WORDS);
    expect(words.closest("[role='status']")).not.toBeNull();
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
    expect(screen.queryByText(/Ailsa Fraser|Fraser, Ailsa/)).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    await flush();
    expect((await store.open(PLAN_ID)).kind).toBe("new");

    fireEvent.click(within(words.closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(REMOVED_ELSEWHERE_WORDS)).toBeNull();
  });

  it("a change waiting here when another tab deletes the list is not written back: the page takes an empty list and says so", async () => {
    const { store, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    // A change here, still waiting to be kept, when the other tab deletes the list.
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    await memoryStore(backend).erase(PLAN_ID);
    await flush();

    expect((await store.open(PLAN_ID)).kind).toBe("new");
    const words = await screen.findByText(REMOVED_ELSEWHERE_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("removed-elsewhere");
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
    expect(screen.queryByText(/Ailsa Fraser|Fraser, Ailsa/)).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("The event's name").value).toBe("");
    expect(screen.queryByText(OTHER_TAB_WORDS)).toBeNull();
    // Nothing is left to keep: the deleted name is not written later either.
    await flush();
    expect((await store.open(PLAN_ID)).kind).toBe("new");
  });

  it("after the list is deleted here, names another tab adds are taken up and said", async () => {
    const { store, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });
    fireEvent.click(within(panel).getByRole("button", { name: "Delete the list from this device" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Delete 1 name for good" }));
    expect(await screen.findByText("There are no guests on this list yet.")).toBeTruthy();
    expect((await store.open(PLAN_ID)).kind).toBe("new");

    // Another tab, holding no copy of the list, stores one.
    expect((await memoryStore(backend).save(listOf({ guests: [guest(2, "Chidi Okafor")] }), null)).kind).toBe("saved");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    const words = await screen.findByText(ADDED_AFTER_DELETE_WORDS);
    expect(words.closest("[role='status']")).not.toBeNull();
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("added-after-delete");
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    fireEvent.click(within(words.closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(ADDED_AFTER_DELETE_WORDS)).toBeNull();
  });

  it("a take-up from another tab clears the seat line and the date refusal, which spoke of the list before", async () => {
    const opened = listOf({ eventDate: "2099-06-12", tables: [table(1)], guests: [guest(1, "Ailsa Fraser")] });
    const { store, backend } = await storeHolding(opened);
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 1" }));
    const said = screen.getByText("Ailsa Fraser is at table 1, seat 1.");
    await flush();
    const field = screen.getByLabelText<HTMLInputElement>("Date of the event");
    field.focus();
    fireEvent.change(field, { target: { value: "0027-06-12" } });
    fireEvent.blur(field);
    const refusal = "That date would remove this list straight away: a list is removed 30 days after its event. Check the year.";
    expect(screen.getByText(refusal)).toBeTruthy();
    expect(said.textContent).toBe("Ailsa Fraser is at table 1, seat 1.");

    await otherTabSaves(backend, (kept) => ({
      ...kept,
      guests: [{ ...guest(1, "Ailsa Fraser"), tableId: null, seat: null }],
      updatedAt: new Date(Date.parse(kept.updatedAt) + 60_000).toISOString(),
    }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => { expect(currentList().guests[0]?.seat).toBeNull(); });
    expect(said.textContent).toBe("");
    expect(screen.queryByText(refusal)).toBeNull();
  });

  it("removes a list past its removal day on opening, rather than showing it, and says the rule removed it", async () => {
    const { store } = await storeHolding(listOf({ eventDate: "2020-01-01", guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
    expect((await store.open(PLAN_ID)).kind).toBe("new");
    const words = screen.getByText(REMOVED_BY_RULE_WORDS);
    expect(words.closest("[role='status']")).not.toBeNull();
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("removed-by-rule");
    expect(screen.queryByText(/Ailsa Fraser|Fraser, Ailsa/)).toBeNull();
    fireEvent.click(within(words.closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(REMOVED_BY_RULE_WORDS)).toBeNull();
  });

  it("says nothing of the rule on opening a plan that has no list, or a list not yet due", async () => {
    const view = open(PAGE, memoryStore());
    await desk();
    expect(screen.queryByText(REMOVED_BY_RULE_WORDS)).toBeNull();
    view.unmount();
    state().reset();

    open(PAGE, (await storeHolding(listOf({ eventDate: "2099-06-12", guests: [guest(1, "Ailsa Fraser")] }))).store);
    await desk();
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    expect(screen.queryByText(REMOVED_BY_RULE_WORDS)).toBeNull();
  });

  it("says where the names are kept, and that they are removed on or after their day, the next time Venviewer opens here", async () => {
    const dated = listOf({ eventDate: "2099-06-12", guests: [guest(1, "Ailsa Fraser")] });
    const { store } = await storeHolding(dated);
    const view = open(PAGE, store);
    await desk();
    expect(screen.getByText("These names are kept only in this browser, on this device. None of them is sent to Venviewer. They are removed 30 days after the event: on or after 12 July 2099, the next time Venviewer opens in this browser.")).toBeTruthy();
    // The page no longer states the removal day as a fact about the device.
    expect(screen.queryByText(/They are removed on /)).toBeNull();
    view.unmount();
    state().reset();

    const undated = listOf({ guests: [guest(1, "Ailsa Fraser")] });
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(Date.parse(`${deleteAfter(undated).dateIso}T00:00:00.000Z`));
    open(PAGE, (await storeHolding(undated)).store);
    await desk();
    expect(screen.getByText(`These names are kept only in this browser, on this device. None of them is sent to Venviewer. They are removed 90 days after your last change: on or after ${day}, the next time Venviewer opens in this browser.`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Closing the tab inside the autosave's 600 ms. Nothing is written in that
// window by construction, so the page starts the save as it is hidden or
// left, and asks the browser to confirm leaving while a change is not yet kept.
// ---------------------------------------------------------------------------

describe("the guest list page: leaving with a change not yet kept", () => {
  /** The browser's question on closing or reloading the tab; a page that prevents it is asking to be confirmed. */
  function askToLeave(): Event {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it("asks the browser to confirm leaving only while a change is waiting to be kept or being kept", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    const view = open(PAGE, store);
    await desk();
    // Nothing changed: leaving is not questioned.
    expect(askToLeave().defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    expect(askToLeave().defaultPrevented).toBe(true);

    await flush();
    expect(askToLeave().defaultPrevented).toBe(false);
    const kept = await store.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.title : null).toBe("Fraser and Okafor");

    // Once the page has gone, so has its question.
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor, again" } });
    view.unmount();
    expect(askToLeave().defaultPrevented).toBe(false);
  });

  it("asks while a save is still on its way to the device", async () => {
    const { store: inner } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    const held = deferred<undefined>();
    const store: GuestListStore = {
      ...inner,
      save: async (list, loaded, opts) => {
        await held.promise;
        return inner.save(list, loaded, opts);
      },
    };
    open(PAGE, store);
    await desk();
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    const keeping = state().flush();
    expect(askToLeave().defaultPrevented).toBe(true);
    await act(async () => {
      held.resolve(undefined);
      await keeping;
    });
    expect(askToLeave().defaultPrevented).toBe(false);
  });

  it("starts the save as the page is left, without waiting out the 600 ms", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    const save = vi.spyOn(store, "save");
    open(PAGE, store);
    await desk();
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    expect(save).not.toHaveBeenCalled();

    // The page is being left (a close, a reload, a move to another site): the save is asked for at once.
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].title).toBe("Fraser and Okafor");

    await flush();
    const kept = await store.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.title : null).toBe("Fraser and Okafor");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Coming back to the page from another page of the app. The page state lives
// on while the page is away, so every mount reads the device again: each case
// here stays inside ONE router, leaves by the panel's own link, comes back by
// a link, and never resets the page state in between. "Another tab" is a
// second device store over the same storage.
// ---------------------------------------------------------------------------

describe("the guest list page: mounted again over a list it already holds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes up what another tab added meanwhile, and a change here keeps it without a word", async () => {
    const { store, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    await leaveForTheRoom();

    // In another tab the planner adds fifty guests, and they are kept.
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      guests: [...kept.guests, ...Array.from({ length: 50 }, (_, i) => guest(100 + i, `Mary Example${String(i + 1)}`))],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    await comeBackToTheList();
    expect(screen.getByText("0 of 51 guests have a seat.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    await flush();
    const kept = await store.open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.guests).toHaveLength(51);
    expect(kept.list.title).toBe("Fraser and Okafor");
    expect(screen.queryByText(OTHER_TAB_WORDS)).toBeNull();
  });

  it("takes an empty list when another tab deleted it meanwhile, says so, and never stores the deleted name again", async () => {
    const { store, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    await leaveForTheRoom();

    await memoryStore(backend).erase(PLAN_ID);

    await comeBackToTheList();
    expect(screen.getByText(REMOVED_ELSEWHERE_WORDS)).toBeTruthy();
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
    expect(screen.queryByText(/Ailsa Fraser|Fraser, Ailsa/)).toBeNull();

    await pasteAndAdd("Chidi Okafor\nMorag Kerr", 2);
    await flush();
    const kept = await store.open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the new list was not kept");
    expect(kept.list.guests.map((g) => g.name)).toEqual(["Chidi Okafor", "Morag Kerr"]);
    expect(JSON.stringify(kept.list)).not.toContain("Ailsa");
  });

  it("a list that passed its removal day while the page was away is removed, said to be removed under the rule, and not brought back", async () => {
    const now = pinnedNow();
    // The event is five days off: the list's removal day is thirty-five days ahead.
    const eventDate = new Date(now + 5 * 86_400_000).toISOString().slice(0, 10);
    const { store } = await storeHolding(listOf({ eventDate, guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    expect(screen.queryByText(REMOVED_BY_RULE_WORDS)).toBeNull();
    await leaveForTheRoom();

    // Thirty-seven days pass with the app left open on another page.
    vi.setSystemTime(now + 37 * 86_400_000);

    await comeBackToTheList();
    const words = screen.getByText(REMOVED_BY_RULE_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("removed-by-rule");
    expect(screen.queryByText(REMOVED_ELSEWHERE_WORDS)).toBeNull();
    expect(screen.getByText("There are no guests on this list yet.")).toBeTruthy();
    expect(screen.queryByText(/Ailsa Fraser|Fraser, Ailsa/)).toBeNull();
    expect((await store.open(PLAN_ID)).kind).toBe("new");

    // A change then does not bring the old names back.
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "A new start" } });
    await flush();
    const kept = await store.open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the new list was not kept");
    expect(kept.list.title).toBe("A new start");
    expect(kept.list.guests).toEqual([]);
    expect(kept.list.eventDate).toBeNull();
  });

  it("stays in its opening state until this mount's read of the device has returned", async () => {
    const { store: inner, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    const slow = deferred<undefined>();
    let slowReads = false;
    const store: GuestListStore = {
      ...inner,
      open: async (planId) => {
        if (slowReads) await slow.promise;
        return inner.open(planId);
      },
    };
    open(PAGE, store);
    await desk();
    await leaveForTheRoom();
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      guests: [...kept.guests, guest(2, "Chidi Okafor")],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    // The next read of the device is slow.
    slowReads = true;
    fireEvent.click(screen.getByRole("link", { name: "Back to the guest list" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The page state still holds the list as it was, but nothing of it is shown or can be typed over yet.
    expect(state().list?.guests).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Opening your guest list…");
    expect(screen.queryByTestId("guest-list-desk")).toBeNull();
    expect(screen.queryByLabelText("The event's name")).toBeNull();

    await act(async () => {
      slow.resolve(undefined);
      await slow.promise;
    });
    await desk();
    expect(screen.getByText("0 of 2 guests have a seat.")).toBeTruthy();
  });

  it("keeps a change that was not yet kept when the page was left, and the save says it went over another tab's copy", async () => {
    const { store: inner, backend } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    // This tab's save is held on its way to the device, so its change is still not kept when the page comes back.
    const held = deferred<undefined>();
    const store: GuestListStore = {
      ...inner,
      save: async (list, loaded) => {
        await held.promise;
        return inner.save(list, loaded);
      },
    };
    open(PAGE, store);
    await desk();
    fireEvent.change(screen.getByLabelText("The event's name"), { target: { value: "Fraser and Okafor" } });
    const keeping = state().flush();
    await leaveForTheRoom();
    await otherTabSaves(backend, (kept) => ({ ...kept, title: "Another tab", updatedAt: new Date(Date.now() + 60_000).toISOString() }));

    // The mount reads nothing over a change not yet kept: the change is still on the page.
    await comeBackToTheList();
    expect(screen.getByLabelText<HTMLInputElement>("The event's name").value).toBe("Fraser and Okafor");
    expect(screen.queryByText(OTHER_TAB_WORDS)).toBeNull();

    await act(async () => {
      held.resolve(undefined);
      await keeping;
    });
    expect(await screen.findByText(OTHER_TAB_WORDS)).toBeTruthy();
    const kept = await inner.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.title : null).toBe("Fraser and Okafor");
  });
});

// ---------------------------------------------------------------------------
// The event's date: kept when the field is left, and never one that would
// remove the list at once
// ---------------------------------------------------------------------------

const DATE_REFUSED ="That date would remove this list straight away: a list is removed 30 days after its event. Check the year.";

function dateField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>("Date of the event");
}

/** The calendar day `days` days before `now`, in UTC, as the model keeps days. */
function daysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reads the clock once and holds Date there (timers stay real), so the test and
 * the page read the same day even when a run crosses 00:00 UTC.
 */
function pinnedNow(): number {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"], now });
  return now;
}

describe("the guest list page: the event's date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the date when the field is left, never while a year is half typed", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const field = dateField();
    field.focus();
    // A date field holds each keystroke of a four-digit year as a whole date: 0002, 0020, 0209, 2099.
    for (const typed of ["0002-06-12", "0020-06-12", "0209-06-12", "2099-06-12"]) {
      fireEvent.change(field, { target: { value: typed } });
      expect(currentList().eventDate).toBeNull();
    }
    expect(state().canUndo).toBe(false);
    fireEvent.blur(field);
    expect(currentList().eventDate).toBe("2099-06-12");
    await flush();
    const kept = await store.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.eventDate : null).toBe("2099-06-12");
  });

  it("keeps the date on Enter, and Escape puts the kept date back", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const field = dateField();
    field.focus();
    fireEvent.change(field, { target: { value: "2099-06-12" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(currentList().eventDate).toBe("2099-06-12");

    fireEvent.change(field, { target: { value: "2099-07-01" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("2099-06-12");
    fireEvent.blur(field);
    expect(currentList().eventDate).toBe("2099-06-12");
  });

  it("refuses a date that would remove the list at once, says so beside the field, and changes nothing", async () => {
    const now = pinnedNow();
    const thirtyDaysAgo = daysAgo(30, now);
    const twentyNineDaysAgo = daysAgo(29, now);
    const { store } = await storeHolding(listOf({ eventDate: "2099-06-12", guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const field = dateField();
    for (const typed of ["0027-06-12", thirtyDaysAgo, "2020-01-01"]) {
      field.focus();
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.blur(field);
      expect(currentList().eventDate).toBe("2099-06-12");
      expect(field.value).toBe("2099-06-12");
      const alert = screen.getByText(DATE_REFUSED);
      expect(alert.getAttribute("role")).toBe("alert");
      expect(field.closest(".gl-date")?.contains(alert)).toBe(true);
    }
    expect(state().canUndo).toBe(false);
    await flush();
    const kept = await store.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.eventDate : null).toBe("2099-06-12");

    // The next date that can stand clears the words.
    field.focus();
    fireEvent.change(field, { target: { value: twentyNineDaysAgo } });
    fireEvent.blur(field);
    expect(currentList().eventDate).toBe(twentyNineDaysAgo);
    expect(screen.queryByText(DATE_REFUSED)).toBeNull();

    // So does clearing the date.
    field.focus();
    fireEvent.change(field, { target: { value: "0027-06-12" } });
    fireEvent.blur(field);
    expect(screen.getByText(DATE_REFUSED)).toBeTruthy();
    field.focus();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(currentList().eventDate).toBeNull();
    expect(screen.queryByText(DATE_REFUSED)).toBeNull();
  });

  it("clearing the date sets none, and a date left half typed changes nothing", async () => {
    const { store } = await storeHolding(listOf({ eventDate: "2099-06-12", guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const field = dateField();

    // A browser reads a half-typed date as empty, with bad input.
    field.focus();
    Object.defineProperty(field, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(currentList().eventDate).toBe("2099-06-12");
    expect(field.value).toBe("2099-06-12");
    expect(state().canUndo).toBe(false);

    Object.defineProperty(field, "validity", { configurable: true, value: { badInput: false } });
    field.focus();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(currentList().eventDate).toBeNull();
    expect(screen.queryByText(DATE_REFUSED)).toBeNull();
  });

  it("one visit to the field is one undo step", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const field = dateField();
    field.focus();
    fireEvent.change(field, { target: { value: "2099-06-12" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "2099-06-13" } });
    fireEvent.blur(field);
    expect(currentList().eventDate).toBe("2099-06-13");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(currentList().eventDate).toBeNull();
    expect(field.value).toBe("");
    expect(state().canUndo).toBe(false);
  });

  it("offers the earliest date it would take today as the field's least value, as a help", async () => {
    const earliest = earliestEventDate(pinnedNow());
    open(PAGE, memoryStore());
    await desk();
    expect(dateField().getAttribute("min")).toBe(earliest);
  });
});

// ---------------------------------------------------------------------------
// The panel's next step and what is still needed
// ---------------------------------------------------------------------------

describe("the guest list page: the next step and what is still needed", () => {
  it("with no guests, the next step is to paste a list", async () => {
    open(PAGE, memoryStore());
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });
    expect(within(panel).getByRole("button", { name: "Paste a list" })).toBeTruthy();
    expect(within(panel).getByText("There are no tables yet")).toBeTruthy();
    // The version belongs to the paper as a whole, so the panel speaks of the paper, in the paper page's own words.
    expect(within(panel).getByText("The paper is not yet printed")).toBeTruthy();
    expect(within(within(panel).getByRole("link", { name: "Table plan for the door" }).closest("li") ?? panel).getByText("Not yet printed")).toBeTruthy();
    expect(within(panel).queryByText(/table plan has/i)).toBeNull();
    expect(within(panel).queryByText(/Not printed yet/)).toBeNull();
  });

  it("names the guests with no seat, and the print that is out of date", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 2)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 1), guest(2, "Chidi Okafor", uuid(1), 2), guest(3, "Morag Kerr")],
      paperVersion: 2,
      changedSincePrint: true,
      printedAt: "2026-11-10T12:00:00.000Z",
    }));
    open(PAGE, store);
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });
    expect(within(panel).getByText("1 guest has no seat")).toBeTruthy();
    expect(within(panel).getByText("The paper has changed since it was printed")).toBeTruthy();
    expect(within(panel).getByText("Printed 10 November")).toBeTruthy();
    // The one table is full, so seating everyone would seat nobody: the next step is the paper.
    expect(within(panel).getByRole("link", { name: "Print the table plan" })).toBeTruthy();
  });

  it("with nothing left to do, says nothing else is needed", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 2)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 1)],
      paperVersion: 1,
      changedSincePrint: false,
      printedAt: "2026-11-10T12:00:00.000Z",
    }));
    open(PAGE, store);
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });
    expect(within(panel).getByText("Nothing else is needed for the paper.")).toBeTruthy();
    const paper = within(panel).getByRole("link", { name: "Place cards" });
    expect(paper.getAttribute("href")).toBe(`/plan/${PLAN_ID}/guests/paper?kit=on&sheet=place-cards`);
    for (const link of within(panel).getAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").includes("/paper"))) {
      expect(new URLSearchParams((link.getAttribute("href") ?? "").split("?")[1] ?? "").get("kit")).toBe("on");
    }
  });

  it("undo takes back the last change", async () => {
    const { store } = await storeHolding(listOf({ tables: [table(1)], guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Seat everyone" }));
    expect(screen.getByText("1 of 1 guest has a seat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();
    });
  });

  it("undo clears the status line that said where a guest sits, which is no longer true", async () => {
    const { store } = await storeHolding(listOf({ tables: [table(1)], guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();
    fireEvent.click(screen.getByRole("button", { name: "To seat 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 1" }));
    const said = screen.getByText("Ailsa Fraser is at table 1, seat 1.");
    expect(said.getAttribute("role")).toBe("status");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(currentList().guests[0]?.seat).toBeNull();
    expect(said.textContent).toBe("");
    expect(screen.queryByText("Ailsa Fraser is at table 1, seat 1.")).toBeNull();
  });

  it("downloads the list as a file made in the browser", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser", null, null, "Fraser family")] }));
    const made: Blob[] = [];
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (blob instanceof Blob) made.push(blob);
      return "blob:guest-list";
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    open(PAGE, store);
    await desk();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Download the list" }));
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clicked).toEqual(["guest-list.csv"]);
      // The file's address is kept for ten seconds, so a browser that reads it after the click still has it.
      vi.advanceTimersByTime(9_999);
      expect(revokeSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revokeSpy).toHaveBeenCalledWith("blob:guest-list");
    } finally {
      vi.useRealTimers();
    }
    expect(await made[0]?.text()).toContain('"Ailsa Fraser","Fraser family","",""');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deleting the list
// ---------------------------------------------------------------------------

const PASTED = "PASTED-LINE-Z9";

/** Everything the page holds that a person or a screen reader could still find: text, attributes and field values. */
function everythingShown(container: HTMLElement): string {
  const parts = [container.textContent ?? ""];
  for (const el of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of Array.from(el.attributes)) parts.push(attribute.value);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) parts.push(el.value);
  }
  return parts.join("\n");
}

describe("the guest list page: deleting the list", () => {
  it("leaves no guest's name, and nothing typed or pasted, anywhere on the page", async () => {
    const { store } = await storeHolding(listOf({
      title: `${CANARY} wedding`,
      tables: [table(1, 4, `${CANARY} table`)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 1), guest(2, `Chidi ${CANARY}`), guest(3, "Morag Kerr")],
    }));
    const view = open(PAGE, store);
    await desk();

    // A move leaves the guest's name in the status line.
    fireEvent.click(screen.getByRole("button", { name: "To seat 2" }));
    fireEvent.click(screen.getByRole("button", { name: `${CANARY}, Chidi` }));
    fireEvent.click(screen.getByRole("button", { name: "Seat here at table 1" }));
    expect(screen.getByText(`Chidi ${CANARY} is at table 1, seat 2.`)).toBeTruthy();

    // A paste not yet added, and an edit not yet saved.
    fireEvent.click(screen.getByRole("button", { name: "Guests 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Add guests" }));
    fireEvent.change(screen.getByLabelText("Paste the names"), { target: { value: `${PASTED}\nEwan Shaw` } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Morag Kerr" }));
    fireEvent.change(within(screen.getByRole("form", { name: "Edit a guest" })).getByLabelText("Name"), { target: { value: `Morag ${CANARY}` } });
    expect(everythingShown(view.container)).toContain(CANARY);
    expect(everythingShown(view.container)).toContain(PASTED);

    const panel = screen.getByRole("complementary", { name: "The event" });
    fireEvent.click(within(panel).getByRole("button", { name: "Delete the list from this device" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Delete 3 names for good" }));
    expect(await screen.findByText("There are no guests on this list yet.")).toBeTruthy();

    const left = everythingShown(view.container);
    expect(left).not.toContain(CANARY);
    expect(left).not.toContain(PASTED);
    expect(left).not.toContain("Ewan");
    expect(left).not.toContain("Ailsa");
    expect(left).not.toContain("Morag");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Paste the names").value).toBe("");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    });
  });

  it("while the erase runs, the delete is busy and inert, and the list cannot be kept", async () => {
    const erased = deferred<undefined>();
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, { ...store, erase: () => erased.promise });
    await desk();
    const panel = screen.getByRole("complementary", { name: "The event" });

    fireEvent.click(within(panel).getByRole("button", { name: "Delete the list from this device" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Delete 1 name for good" }));
    const busy = within(panel).getByRole("button", { name: "Deleting the list…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(within(panel).getByRole("button", { name: "Keep the list" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(busy);
    expect(screen.getByText("0 of 1 guest has a seat.")).toBeTruthy();

    await act(async () => {
      erased.resolve(undefined);
      await erased.promise;
    });
    expect(await screen.findByText("There are no guests on this list yet.")).toBeTruthy();
  });

  it("offers no delete while the list is opening, or when it cannot be read", async () => {
    const opened = deferred<Opened>();
    open(PAGE, { ...memoryStore(), open: () => opened.promise });
    expect(screen.getByText("Opening your guest list…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete the list from this device" })).toBeNull();

    await act(async () => {
      opened.resolve({ kind: "unreadable" });
      await opened.promise;
    });
    expect(await screen.findByText("A list was kept here for this plan, but it cannot be read.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete the list from this device" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Where the focus goes when its control goes
// ---------------------------------------------------------------------------

describe("the guest list page: the focus is kept", () => {
  it("after a guest is removed: the next row, the row before when it was the last, then the sheet's heading", async () => {
    const { store } = await storeHolding(listOf({
      guests: [guest(1, "Ailsa Fraser"), guest(2, "Morag Kerr"), guest(3, "Chidi Okafor")],
    }));
    open(PAGE, store);
    await desk();

    fireEvent.click(screen.getByRole("button", { name: "Remove Morag Kerr" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Okafor, Chidi" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Chidi Okafor" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fraser, Ailsa" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Ailsa Fraser" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    });
  });

  it("after Edit's Cancel or Save: that guest's Edit button; a refused name is said in fixed words", async () => {
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser"), guest(2, "Morag Kerr")] }));
    open(PAGE, store);
    await desk();

    fireEvent.click(screen.getByRole("button", { name: "Edit Morag Kerr" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Edit a guest" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Morag Kerr" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Morag Kerr" }));
    const form = screen.getByRole("form", { name: "Edit a guest" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(within(form).getByRole("alert").textContent).toBe("A name needs 1 to 80 characters.");

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Morag Kerr-Shaw" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Morag Kerr-Shaw" }));
    });
    expect(currentList().guests[1]?.name).toBe("Morag Kerr-Shaw");
  });

  it("closing a notice: back to the control in use when it appeared, else the sheet's heading", async () => {
    const { store } = await storeHolding(listOf({
      tables: [table(1, 4)],
      guests: [guest(1, "Ailsa Fraser", uuid(1), 3), guest(2, "Chidi Okafor", uuid(1), 4), guest(3, "Morag Kerr", uuid(1), 4)],
    }));
    open(PAGE, store);
    await desk();

    const repaired = screen.getByText("1 guest was sent back to seat, because their table or seat was no longer there.");
    fireEvent.click(within(repaired.closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));

    fireEvent.click(screen.getByRole("button", { name: /Table 1/, expanded: false }));
    const seats = screen.getByLabelText("Seats at table 1");
    seats.focus();
    fireEvent.change(seats, { target: { value: "2" } });
    fireEvent.keyDown(seats, { key: "Enter" });
    const words = screen.getByText("Table 1 now has 2 seats. 2 guests are now to seat.");
    fireEvent.click(within(words.closest("[data-notice]") ?? document.body).getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Table 1 now has 2 seats. 2 guests are now to seat.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Seats at table 1"));
  });

  it("closing the paste step returns to Add guests; cancelling the tables form returns to its opener", async () => {
    const { store } = await storeHolding(listOf({ tables: [table(1)], guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();

    fireEvent.click(screen.getByRole("button", { name: "Add guests" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Paste the names"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add guests" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Change the number of tables" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Set the tables" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change the number of tables" }));
    });
  });

  it("cancelling the tables form opened from the next step returns to that step", async () => {
    mocks.getPublicConfig.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    const { store } = await storeHolding(listOf({ guests: [guest(1, "Ailsa Fraser")] }));
    open(PAGE, store);
    await desk();

    fireEvent.click(await screen.findByRole("button", { name: "Set the tables" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Set the tables" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Set the tables" }));
    });
  });
});

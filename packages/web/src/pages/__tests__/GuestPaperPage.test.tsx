import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { memoryBackend, withBackend, type CacheBackend } from "../../lib/idb-cache.js";
import { KIT_STORAGE_KEY } from "../../lib/guest-list/kit-switch.js";
import { emptyGuestList, type Guest, type GuestList, type KitTable } from "../../lib/guest-list/model.js";
import { createGuestListStore, stampOf, type GuestListStore, type Opened } from "../../lib/guest-list/store.js";
import { useGuestListStore } from "../../stores/guest-list-store.js";
import { GuestPaperPage } from "../GuestPaperPage.js";

// ---------------------------------------------------------------------------
// The planner's paper: the table plan for the door, guests by table, place
// cards and covers for the caterer, all from the one list kept on this device.
// The list is kept in a memory store injected as the page's store, so every
// case runs the real paper functions and page state. The one network module
// is stubbed only so that a call to it, which must never happen here, shows.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({ getPublicConfig: vi.fn() }));
vi.mock("../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/configurations.js")>(),
  getPublicConfig: mocks.getPublicConfig,
}));

const PLAN_ID = "3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b34";
const PAPER = `/plan/${PLAN_ID}/guests/paper`;
const CANARY = "Zanzibar-Q7";
const TABLE_CANARY = "Morag Quillfeather";
const TITLE = "Fraser and Okafor";
const REMOVED_ELSEWHERE_WORDS = "This list is no longer kept in this browser. It was deleted in another tab, or this browser's stored data was cleared.";
const ADDED_AFTER_DELETE_WORDS = "Names were added to this list in another tab after it was deleted here.";
const PRINT_OF_OLDER_COPY_WORDS = "That printout was made from an older copy of this list, which was changed in another tab. Print it again.";
const REMOVED_BY_RULE_WORDS ="This list was removed from this browser: a list is removed 30 days after its event, or 90 days after its last change.";
const SHEET_LINKS = [
  ["Table plan", "table-plan"],
  ["Guests by table", "by-table"],
  ["Place cards", "place-cards"],
  ["Covers for the caterer", "covers"],
] as const;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const FIRST = ["Ailsa", "Brodie", "Catriona", "Duncan", "Eilidh", "Fergus", "Iona", "Lachlan"];
const LAST = [
  "Abbott", "Baird", "Campbell", "Douglas", "Ewing", "Fraser", "Gordon", "Hamilton", "Irvine", "Johnston", "Kerr",
  "Lindsay", "Murray", "Nisbet", "Ogilvie", "Paterson", "Quinn", "Ross", "Stewart", "Thomson", "Urquhart",
  "Wallace", "Young",
];

interface FixtureGuest {
  readonly first: string;
  readonly last: string;
  readonly table: number | null;
  readonly seat: number | null;
}

/**
 * 180 guests and 18 tables of ten. The first 172 are seated in order (tables 1
 * to 17 full, two at table 18); the last 8 have no seat (four Wallaces whose
 * namesakes are seated, and every Young). The fourth guest's surname is the
 * canary; table 2's own name is a person's name.
 */
function fixture(): readonly FixtureGuest[] {
  return Array.from({ length: 180 }, (_, i) => {
    const first = FIRST[i % FIRST.length] ?? "Ailsa";
    const last = i === 3 ? CANARY : LAST[Math.floor(i / FIRST.length)] ?? "Abbott";
    const seated = i < 172;
    return { first, last, table: seated ? Math.floor(i / 10) + 1 : null, seat: seated ? (i % 10) + 1 : null };
  });
}

const GUESTS = fixture();
const SEATED = GUESTS.filter((g) => g.table !== null);
const UNSEATED = GUESTS.filter((g) => g.table === null);

function fullName(g: FixtureGuest): string {
  return `${g.first} ${g.last}`;
}

function table(n: number, name = ""): KitTable {
  return { id: uuid(n), number: n, name, seats: 10 };
}

function list180(patch: Partial<GuestList> = {}): GuestList {
  const guests: Guest[] = GUESTS.map((g, i) => ({
    id: uuid(1000 + i),
    name: fullName(g),
    party: "",
    tableId: g.table === null ? null : uuid(g.table),
    seat: g.seat,
  }));
  const tables = Array.from({ length: 18 }, (_, i) => table(i + 1, i === 0 ? "Top table" : i === 1 ? TABLE_CANARY : ""));
  return {
    ...emptyGuestList(PLAN_ID, "2026-11-14T09:00:00.000Z"),
    title: TITLE,
    eventDate: "2027-06-12",
    guests,
    tables,
    ...patch,
  };
}

function memoryStore(backend: CacheBackend = memoryBackend()): GuestListStore {
  return createGuestListStore(withBackend<unknown>(backend));
}

async function storeHolding(list: GuestList, backend: CacheBackend = memoryBackend()): Promise<GuestListStore> {
  const store = memoryStore(backend);
  expect((await store.save(list, null)).kind).toBe("saved");
  return store;
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

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Where(): ReactElement {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

/** Another page of the same app, where "Back to the list" leads, with a way back to the paper. */
function ListStandIn(): ReactElement {
  return (
    <main data-testid="list">
      <p>list</p>
      <Link to={`${PAPER}?kit=on`}>Back to the paper</Link>
    </main>
  );
}

function open(entry: string, store?: GuestListStore): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/plan/:code/guests/paper" element={<GuestPaperPage store={store} />} />
        <Route path="/plan/:code/guests" element={<ListStandIn />} />
        <Route path="/plan" element={<p data-testid="planner">planner</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

/**
 * Leaves the paper for another page of the app by its own "Back to the list"
 * link. The page unmounts; the page state is left exactly as it was.
 */
async function leaveForTheList(): Promise<void> {
  fireEvent.click(within(tools()).getByRole("link", { name: "Back to the list" }));
  await screen.findByTestId("list");
  expect(screen.queryByTestId("guest-paper-page")).toBeNull();
  expect(state().planId).toBe(PLAN_ID);
}

/** Comes back to the paper by a link inside the same router: the page mounts again over the same page state. */
async function comeBackToThePaper(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("link", { name: "Back to the paper" }));
  return paper("table-plan");
}

function metas(name: string): HTMLMetaElement[] {
  return Array.from(document.head.querySelectorAll<HTMLMetaElement>(`meta[name='${name}']`));
}

function state(): ReturnType<typeof useGuestListStore.getState> {
  return useGuestListStore.getState();
}

function currentList(): GuestList {
  const list = state().list;
  if (list === null) throw new Error("no list open");
  return list;
}

/** The sheet as printed: the paper, not the tools above it. */
async function paper(sheet: string): Promise<HTMLElement> {
  const found = await screen.findByTestId("guest-paper-sheet");
  expect(found.getAttribute("data-sheet")).toBe(sheet);
  return found;
}

function tools(): HTMLElement {
  return screen.getByTestId("guest-paper-tools");
}

function text(element: Element | null | undefined): string {
  return element?.textContent ?? "";
}

function fontsReady(ready: Promise<unknown>): void {
  Object.defineProperty(document, "fonts", { value: { ready }, configurable: true });
}

let fetchSpy: MockInstance<typeof fetch>;
let printSpy: Mock<() => void>;

beforeEach(() => {
  mocks.getPublicConfig.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch");
  printSpy = vi.fn<() => void>();
  Object.defineProperty(window, "print", { value: printSpy, configurable: true, writable: true });
  window.localStorage.clear();
  document.title = "before";
  state().reset();
});

afterEach(() => {
  cleanup();
  state().reset();
  window.localStorage.clear();
  Reflect.deleteProperty(document, "fonts");
  Reflect.deleteProperty(window, "print");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The switch, the address and the head (the kit's gate)
// ---------------------------------------------------------------------------

describe("the guest paper page: the switch and the address", () => {
  it("is the not-found page with the switch off, and makes no request", () => {
    open(PAPER, memoryStore());
    expect(screen.getByTestId("not-found")).toBeTruthy();
    expect(screen.queryByTestId("guest-paper-page")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a malformed plan id, says the address is not a plan and makes no request", () => {
    open("/plan/not-a-uuid/guests/paper?kit=on", memoryStore());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This address is not a plan");
    expect(screen.getByRole("link", { name: "Open the planner" }).getAttribute("href")).toBe("/plan");
    expect(screen.queryByTestId("guest-paper-page")).toBeNull();
    expect(screen.queryByTestId("not-found")).toBeNull();
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("puts the page on its ivory register when the switch is on and the plan id is well formed", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    const root = screen.getByTestId("guest-paper-page");
    expect(root.className).toBe("gp");
    expect(root.getAttribute("data-register")).toBe("ivory");
    await paper("table-plan");
  });

  it("answers on a later visit with no parameter once the switch was remembered", async () => {
    window.localStorage.setItem(KIT_STORAGE_KEY, "on");
    open(PAPER, await storeHolding(list180()));
    await paper("table-plan");
  });

  it("sets noindex and no-referrer in the head and removes them on leaving", async () => {
    const view = open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    expect(document.title).toBe("Table plan and paper");
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
    expect(metas("referrer")).toHaveLength(0);
  });

  it("keeps the head private on the malformed-address sheet too", () => {
    const view = open("/plan/not-a-uuid/guests/paper?kit=on", memoryStore());
    expect(metas("robots").map((m) => m.content)).toEqual(["noindex, nofollow"]);
    expect(metas("referrer").map((m) => m.content)).toEqual(["no-referrer"]);
    view.unmount();
    expect(metas("robots")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Opening the list
// ---------------------------------------------------------------------------

describe("the guest paper page: opening the list", () => {
  it("shows the working state while the list opens, then the sheet", async () => {
    const inner = await storeHolding(list180());
    const gate = deferred<Opened>();
    const store: GuestListStore = { ...inner, open: () => gate.promise };
    open(`${PAPER}?kit=on`, store);
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Opening your guest list…");
    expect(document.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.queryByTestId("guest-paper-sheet")).toBeNull();
    gate.resolve(await inner.open(PLAN_ID));
    await paper("table-plan");
    expect(screen.queryByText("Opening your guest list…")).toBeNull();
    expect(document.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("says when the list kept here cannot be read, and links back to the list", async () => {
    const store: GuestListStore = { ...memoryStore(), open: () => Promise.resolve({ kind: "unreadable" }) };
    open(`${PAPER}?kit=on`, store);
    expect(await screen.findByText("A list was kept here for this plan, but it cannot be read.")).toBeTruthy();
    const back = screen.getByRole("link", { name: "Back to the list" });
    expect(back.getAttribute("href")).toBe(`/plan/${PLAN_ID}/guests?kit=on`);
    expect(screen.queryByTestId("guest-paper-sheet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
  });

  it("keeps the list already open for this plan, with its undo, and reads the device once as it mounts", async () => {
    const store = await storeHolding(list180());
    await act(async () => {
      await state().open(PLAN_ID, store);
      state().apply((list) => ({ ...list, title: "Changed on the list page" }));
      await state().flush();
    });
    expect(state().canUndo).toBe(true);
    const openSpy = vi.spyOn(store, "open");
    open(`${PAPER}?kit=on`, store);
    const sheet = await paper("table-plan");
    // The mount reads the device (once), but opens nothing afresh: the list, and its undo, are the ones held.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(state().canUndo).toBe(true);
    expect(state().takeUps).toBe(0);
    expect(text(sheet.querySelector(".gp-leaf__title"))).toBe("Changed on the list page");
  });

  it("never shows a list past its removal day", async () => {
    const store = await storeHolding(list180({ eventDate: "2020-01-01" }));
    open(`${PAPER}?kit=on`, store);
    const sheet = await paper("table-plan");
    expect(sheet.querySelectorAll(".gp-az__entry")).toHaveLength(0);
    expect(text(sheet)).not.toContain("Abbott");
    expect(await store.open(PLAN_ID)).toEqual({ kind: "new" });
  });
});

// ---------------------------------------------------------------------------
// The table plan for the door
// ---------------------------------------------------------------------------

/** The plan as the door shows it, worked out here independently of the page. */
function expectedPlan(): readonly (readonly [string, string, number])[] {
  const order = new Intl.Collator("en-GB", { sensitivity: "base" });
  return [...SEATED]
    .sort((a, b) => order.compare(`${a.last} ${a.first}`, `${b.last} ${b.first}`))
    .map((g) => [g.last.charAt(0).toUpperCase(), `${g.last}, ${g.first}`, g.table ?? 0] as const);
}

describe("the guest paper page: the table plan", () => {
  it("the table plan holds exactly the seated guests, under their letters", async () => {
    open(`${PAPER}?kit=on&sheet=table-plan`, await storeHolding(list180()));
    const sheet = await paper("table-plan");
    const shown: (readonly [string, string, number])[] = [];
    const letters: string[] = [];
    for (const group of Array.from(sheet.querySelectorAll(".gp-az__group"))) {
      const letter = text(group.querySelector(".gp-az__letter"));
      letters.push(letter);
      for (const entry of Array.from(group.querySelectorAll(".gp-az__entry"))) {
        const number = text(entry.querySelector(".gp-az__table")).replace(/\D/g, "");
        shown.push([letter, text(entry.querySelector(".gp-az__name")), Number(number)]);
      }
    }
    expect(shown).toHaveLength(172);
    expect(shown).toEqual(expectedPlan());
    expect(letters).toEqual([...new Set(expectedPlan().map(([letter]) => letter))]);
    // Each letter's heading stands with its first name, so paper cannot part them.
    for (const group of Array.from(sheet.querySelectorAll(".gp-az__group"))) {
      const lead = group.querySelector(".gp-az__lead");
      expect(lead?.querySelector(".gp-az__letter")).not.toBeNull();
      expect(lead?.querySelectorAll(".gp-az__entry")).toHaveLength(1);
    }
    for (const g of UNSEATED) {
      expect(text(sheet)).not.toContain(fullName(g));
      expect(text(sheet)).not.toContain(`${g.last}, ${g.first}`);
    }
  });

  it("says how many guests are not on it", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    expect(screen.getByText("8 guests have no seat, so they are not on it")).toBeTruthy();
    expect(within(tools()).getByText("172 names")).toBeTruthy();
    expect(within(tools()).getByRole("heading", { level: 1 }).textContent).toBe("Table plan");
  });

  it("says nothing of guests with no seat when everyone is seated", async () => {
    const all = list180();
    open(`${PAPER}?kit=on`, await storeHolding({ ...all, guests: all.guests.slice(0, 172) }));
    await paper("table-plan");
    expect(within(tools()).getByText("172 names")).toBeTruthy();
    expect(screen.queryByText(/no seat, so/)).toBeNull();
  });

  it("heads the plan with the event's date, its name and the words for the door", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    const sheet = await paper("table-plan");
    expect(text(sheet.querySelector(".gp-eyebrow"))).toBe("Saturday 12 June 2027");
    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe(TITLE);
    expect(within(sheet).getByText("Please find your table")).toBeTruthy();
  });

  it("invents nothing when the list has no date and no name", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180({ eventDate: null, title: "" })));
    const sheet = await paper("table-plan");
    expect(sheet.querySelector(".gp-eyebrow")).toBeNull();
    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe("Table plan");
  });

  it("an unknown sheet shows the table plan", async () => {
    open(`${PAPER}?kit=on&sheet=nonsense`, await storeHolding(list180()));
    const sheet = await paper("table-plan");
    expect(sheet.querySelectorAll(".gp-az__entry")).toHaveLength(172);
    expect(within(tools()).getByRole("link", { name: "Table plan" }).getAttribute("aria-current")).toBe("page");
  });
});

// ---------------------------------------------------------------------------
// Guests by table, place cards, covers
// ---------------------------------------------------------------------------

describe("the guest paper page: the other sheets", () => {
  it("lists each table by number, with its own name and its guests by seat", async () => {
    // Table 3's guests are kept out of seat order, to show the sheet orders them.
    const all = list180();
    const guests = [...all.guests.slice(0, 20), ...all.guests.slice(20, 30).reverse(), ...all.guests.slice(30)];
    open(`${PAPER}?kit=on&sheet=by-table`, await storeHolding({ ...all, guests }));
    const sheet = await paper("by-table");
    const blocks = Array.from(sheet.querySelectorAll(".gp-table"));
    expect(blocks).toHaveLength(18);
    expect(text(blocks[0]?.querySelector(".gp-table__number"))).toBe("Table 1");
    expect(text(blocks[0]?.querySelector(".gp-table__name"))).toBe("Top table");
    expect(blocks[2]?.querySelector(".gp-table__name")).toBeNull();
    const third = Array.from(blocks[2]?.querySelectorAll("li") ?? []).map((li) => [
      text(li.querySelector(".gp-table__seat")),
      text(li.querySelector(".gp-table__guest")),
    ]);
    expect(third).toEqual(SEATED.slice(20, 30).map((g) => [String(g.seat), fullName(g)]));
    expect(blocks[17]?.querySelectorAll("li")).toHaveLength(2);
    expect(within(tools()).getByText("172 names")).toBeTruthy();
    expect(within(tools()).getByRole("heading", { level: 1 }).textContent).toBe("Guests by table");
  });

  it("makes one card a seated guest, ten to a page, with the name and the table", async () => {
    open(`${PAPER}?kit=on&sheet=place-cards`, await storeHolding(list180()));
    const sheet = await paper("place-cards");
    const pages = Array.from(sheet.querySelectorAll(".gp-cards-page"));
    expect(pages.map((page) => page.querySelectorAll(".gp-card").length)).toEqual([...Array<number>(17).fill(10), 2]);
    const cards = Array.from(sheet.querySelectorAll(".gp-card")).map((card) => [
      text(card.querySelector(".gp-card__name")),
      text(card.querySelector(".gp-card__table")),
    ]);
    expect(cards).toEqual(SEATED.map((g) => [fullName(g), `Table ${String(g.table)}`]));
    // Every card carries its cut marks.
    for (const card of Array.from(sheet.querySelectorAll(".gp-card"))) {
      expect(card.querySelector(".gp-cut")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(within(tools()).getByText("172 cards")).toBeTruthy();
    expect(screen.getByText("8 guests have no seat, so they are not on it")).toBeTruthy();
    // Cards are cut apart: no version line is printed on them, so no page holds it alone.
    expect(sheet.querySelector(".gp-foot")).toBeNull();
    expect(sheet.querySelector(".gp-running")).toBeNull();
    expect(sheet.querySelector("table, tfoot")).toBeNull();
  });

  it("marks each card's name with the size step for its length, so a long name is set smaller", async () => {
    const medium = "Alexander Hamish Lachlan Macdonald-Stewart";
    const long = "Dame Wilhelmina Christabel Constance Featherstonehaugh Cholmondeley Marjoribanks";
    const all = list180();
    const guests = all.guests.map((g, at) => (at === 0 ? { ...g, name: medium } : at === 1 ? { ...g, name: long } : g));
    open(`${PAPER}?kit=on&sheet=place-cards`, await storeHolding({ ...all, guests }));
    const sheet = await paper("place-cards");
    const steps = new Map(Array.from(sheet.querySelectorAll(".gp-card__name")).map((name) => [text(name), name.getAttribute("data-step")]));
    expect([steps.get(medium), steps.get(long)]).toEqual(["2", "3"]);
    expect(steps.get(fullName(SEATED[2] ?? expect.unreachable("no third seated guest")))).toBe("1");
    expect(new Set(steps.values())).toEqual(new Set(["1", "2", "3"]));
  });

  it("gives the place cards' pages their own margins while, and only while, the cards are shown", async () => {
    open(`${PAPER}?kit=on&sheet=place-cards`, await storeHolding(list180()));
    const sheet = await paper("place-cards");
    const styles = Array.from(screen.getByTestId("guest-paper-page").querySelectorAll("style"));
    expect(styles.map((style) => style.textContent)).toEqual(["@media print{@page{size:A4;margin:10mm 14mm}}"]);
    expect(styles[0]?.closest("[data-sheet]")).toBe(sheet);
    // Two columns of five 90 by 55 mm cards fit inside those margins on A4 (210 by 297 mm).
    const margin = /margin:(\d+)mm (\d+)mm/u.exec(styles[0]?.textContent ?? "");
    const [vertical, horizontal] = [Number(margin?.[1]), Number(margin?.[2])];
    expect(2 * vertical + 5 * 55).toBeLessThanOrEqual(297);
    expect(2 * horizontal + 2 * 90).toBeLessThanOrEqual(210);

    for (const [name, other] of [["Table plan", "table-plan"], ["Guests by table", "by-table"], ["Covers for the caterer", "covers"]] as const) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      await paper(other);
      expect(screen.getByTestId("guest-paper-page").querySelectorAll("style")).toHaveLength(0);
    }
  });

  it("the covers sheet holds no guest's name", async () => {
    open(`${PAPER}?kit=on&sheet=covers`, await storeHolding(list180()));
    const sheet = await paper("covers");
    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe("172 covers, 18 tables");
    const lines = Array.from(sheet.querySelectorAll(".gp-covers__line")).map((line) => text(line));
    expect(lines).toEqual([...Array.from({ length: 17 }, (_, i) => `Table ${String(i + 1)}10`), "Table 182"]);
    expect(within(sheet).getByText(
      "No guest's name is on this sheet. Diets and allergies are not held here: ask each guest, or give the kitchen a count.",
    )).toBeTruthy();
    // The whole page, tools and all: no guest's name, no table's own name, no event name.
    const page = text(screen.getByTestId("guest-paper-page"));
    expect(page).not.toContain(CANARY);
    for (const g of GUESTS) expect(page).not.toContain(fullName(g));
    expect(page).not.toContain(TABLE_CANARY);
    expect(page).not.toContain("Top table");
    expect(page).not.toContain(TITLE);
    expect(within(tools()).getByText("172 covers")).toBeTruthy();
  });

  it("the four sheet links change only the sheet, and every link carries the switch", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    for (const [name, sheet] of SHEET_LINKS) {
      const href = within(tools()).getByRole("link", { name }).getAttribute("href") ?? "";
      const url = new URL(href, "https://venviewer.test");
      expect(url.pathname).toBe(PAPER);
      expect(url.searchParams.get("kit")).toBe("on");
      expect(url.searchParams.get("sheet")).toBe(sheet);
    }
    const back = within(tools()).getByRole("link", { name: "Back to the list" });
    expect(back.getAttribute("href")).toBe(`/plan/${PLAN_ID}/guests?kit=on`);

    fireEvent.click(within(tools()).getByRole("link", { name: "Place cards" }));
    await paper("place-cards");
    expect(within(tools()).getByRole("link", { name: "Place cards" }).getAttribute("aria-current")).toBe("page");
    expect(within(tools()).getByRole("link", { name: "Table plan" }).getAttribute("aria-current")).toBeNull();
    const where = new URL(text(screen.getByTestId("where")), "https://venviewer.test");
    expect(where.searchParams.get("sheet")).toBe("place-cards");
    expect(where.searchParams.get("kit")).toBe("on");

    fireEvent.click(within(tools()).getByRole("link", { name: "Back to the list" }));
    expect(await screen.findByTestId("list")).toBeTruthy();
  });

  it("carries the switch on its links even when the device remembered it and the address did not", async () => {
    window.localStorage.setItem(KIT_STORAGE_KEY, "on");
    open(`${PAPER}?sheet=covers`, await storeHolding(list180()));
    await paper("covers");
    const href = within(tools()).getByRole("link", { name: "Guests by table" }).getAttribute("href") ?? "";
    const url = new URL(href, "https://venviewer.test");
    expect(url.searchParams.get("kit")).toBe("on");
    expect(url.searchParams.get("sheet")).toBe("by-table");
  });
});

// ---------------------------------------------------------------------------
// The version and the print
// ---------------------------------------------------------------------------

describe("the guest paper page: printing", () => {
  /**
   * The version as each sheet shows it: in the tools on screen, and for the
   * three list sheets once in the sheet's foot and once in the footer that
   * paper repeats on every page. That footer is a real table's <tfoot>: a
   * browser repeats a footer group on every printed page only for a real
   * table (Chromium prints a <div> styled as one once, on the last page).
   * Place cards carry no printed version line and no such table.
   */
  async function expectVersionEverywhere(line: string): Promise<void> {
    for (const [name, sheet] of SHEET_LINKS) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      const found = await paper(sheet);
      expect(text(tools().querySelector(".gp-tools__version"))).toBe(line);
      const feet = found.querySelectorAll(".gp-foot");
      const tables = found.querySelectorAll("table");
      const footers = found.querySelectorAll("tfoot");
      if (sheet === "place-cards") {
        expect(feet).toHaveLength(0);
        expect(tables).toHaveLength(0);
        expect(footers).toHaveLength(0);
        expect(found.querySelector(".gp-running")).toBeNull();
      } else {
        // One frame: a table that is not a table to assistive technology, its
        // body holding the whole sheet, and one footer: the version.
        expect(tables).toHaveLength(1);
        const frame = tables[0];
        expect(frame?.getAttribute("role")).toBe("presentation");
        expect(frame?.querySelectorAll(":scope > tbody > tr > td")).toHaveLength(1);
        expect(frame?.querySelector(":scope > tbody > tr > td")?.contains(found.querySelector(".gp-leaf__title"))).toBe(true);
        expect(footers).toHaveLength(1);
        const repeated = frame?.querySelector(':scope > tfoot[aria-hidden="true"]');
        expect(repeated).toBe(footers[0]);
        expect(text(repeated)).toBe(line);
        // The version a screen reader hears: the sheet's own foot, never hidden.
        expect(feet).toHaveLength(1);
        expect(text(feet[0])).toBe(line);
        expect(feet[0]?.closest("[aria-hidden]")).toBeNull();
        expect(feet[0]?.closest("tfoot")).toBeNull();
      }
    }
  }

  it("says \"Not yet printed\" on every sheet before the first print", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    await expectVersionEverywhere("Not yet printed");
  });

  it("carries the version and the day it was printed on every sheet, and on every printed page", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180({ paperVersion: 6, printedAt: "2026-11-13T18:20:00.000Z" })));
    await paper("table-plan");
    await expectVersionEverywhere("Version 6 · printed 13 November 2026");
  });

  it("tells the day of a print in the device's own time zone, and the event's date as it was typed", async () => {
    const zone = process.env.TZ;
    // Summer in Glasgow: 23:30 UTC on 15 July is 00:30 on 16 July there.
    process.env.TZ = "Europe/London";
    try {
      open(`${PAPER}?kit=on`, await storeHolding(list180({
        paperVersion: 6,
        printedAt: "2026-07-15T23:30:00.000Z",
        eventDate: "2027-06-12",
      })));
      const sheet = await paper("table-plan");
      expect(text(sheet.querySelector(".gp-running"))).toBe("Version 6 · printed 16 July 2026");
      expect(text(tools().querySelector(".gp-tools__version"))).toBe("Version 6 · printed 16 July 2026");
      expect(text(sheet.querySelector(".gp-eyebrow"))).toBe("Saturday 12 June 2027");
    } finally {
      if (zone === undefined) Reflect.deleteProperty(process.env, "TZ");
      else process.env.TZ = zone;
    }
  });

  it("Print waits for the fonts, records the version, saves, then prints", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00.000Z"));
    const inner = await storeHolding(list180());
    const events: string[] = [];
    const store: GuestListStore = {
      ...inner,
      save: async (list, loaded) => {
        events.push(`save v${String(list.paperVersion)}`);
        const answer = await inner.save(list, loaded);
        events.push("saved");
        return answer;
      },
    };
    printSpy.mockImplementation(() => {
      // What is on the paper at the moment it prints: the footer every page carries.
      events.push("print", text(document.querySelector(".gp-running")));
    });
    const fonts = deferred<undefined>();
    fontsReady(fonts.promise);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");

    const button = within(tools()).getByRole("button", { name: "Print" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    // A second click while waiting does nothing.
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(printSpy).not.toHaveBeenCalled();
    expect(currentList().paperVersion).toBe(0);
    expect(events).toEqual([]);

    fonts.resolve(undefined);
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(events).toEqual(["save v1", "saved", "print", "Version 1 · printed 15 November 2026"]);
    expect(currentList().paperVersion).toBe(1);
    expect(currentList().printedAt).toBe("2026-11-15T10:00:00.000Z");
    const kept = await inner.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.paperVersion : null).toBe(1);
    await waitFor(() => { expect(button.getAttribute("aria-busy")).toBe("false"); });
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("does not print another page when the planner leaves while Print is waiting", async () => {
    const fonts = deferred<undefined>();
    fontsReady(fonts.promise);
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    fireEvent.click(within(tools()).getByRole("link", { name: "Back to the list" }));
    expect(await screen.findByTestId("list")).toBeTruthy();
    fonts.resolve(undefined);
    await act(async () => {
      await state().flush();
    });
    expect(printSpy).not.toHaveBeenCalled();
    // Nothing went to paper, so no version was recorded.
    expect(currentList().paperVersion).toBe(0);
  });

  it("a first print is version 1, and printing again unchanged keeps the version", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    const button = within(tools()).getByRole("button", { name: "Print" });
    fireEvent.click(button);
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(button.getAttribute("aria-busy")).toBe("false"); });
    expect(currentList().paperVersion).toBe(1);
    fireEvent.click(button);
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(2); });
    expect(currentList().paperVersion).toBe(1);
    expect(text(document.querySelector(".gp-foot"))).toMatch(/^Version 1 · printed /);
  });

  it("a list changed since its last print prints as the next version", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180({
      paperVersion: 6,
      changedSincePrint: true,
      printedAt: "2026-11-13T18:20:00.000Z",
    })));
    await paper("table-plan");
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(currentList().paperVersion).toBe(7);
    expect(currentList().changedSincePrint).toBe(false);
  });

  it("the browser's own Print command records the version before the paper is laid out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00.000Z"));
    const store = await storeHolding(list180({ paperVersion: 2, changedSincePrint: true, printedAt: "2026-11-10T09:00:00.000Z" }));
    open(`${PAPER}?kit=on&sheet=covers`, store);
    const sheet = await paper("covers");
    expect(text(sheet.querySelector(".gp-foot"))).toBe("Version 2 · printed 10 November 2026");
    // A listener added after the page's runs after it, as the browser's print
    // layout does: it reads what will be printed.
    let laidOut = "";
    const read = (): void => { laidOut = text(sheet.querySelector(".gp-running")); };
    window.addEventListener("beforeprint", read);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    window.removeEventListener("beforeprint", read);
    expect(laidOut).toBe("Version 3 · printed 15 November 2026");
    await act(async () => {
      await state().flush();
    });
    const kept = await store.open(PLAN_ID);
    expect(kept.kind === "ready" ? kept.list.paperVersion : null).toBe(3);
  });

  it("prints the newest list kept on this device: a change made in another tab is taken up first, and nothing is lost", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    printSpy.mockImplementation(() => {
      expect(text(document.querySelector(".gp-leaf__title"))).toBe("Fraser and Okafor, at last");
    });
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");

    // The list, changed in a second tab after this one opened it.
    await otherTabSaves(backend, (theirs) => ({
      ...theirs,
      title: "Fraser and Okafor, at last",
      changedSincePrint: true,
      updatedAt: "2026-11-14T10:00:00.000Z",
    }));

    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    await act(async () => {
      await state().flush();
    });
    const kept = await memoryStore(backend).open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.title).toBe("Fraser and Okafor, at last");
    expect(kept.list.paperVersion).toBe(1);
    expect(within(tools()).queryByText("This list was also changed in another tab. This tab's version was kept.")).toBeNull();
  });

  it("takes up another tab's print when the window gains focus, so the next print never goes back a version", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");

    await otherTabSaves(backend, (theirs) => ({
      ...theirs,
      paperVersion: 4,
      changedSincePrint: false,
      printedAt: "2026-11-14T10:00:00.000Z",
      updatedAt: "2026-11-14T10:00:00.000Z",
    }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => { expect(text(within(tools()).getByText(/^Version 4/))).toMatch(/^Version 4 · printed /); });
  });

  it("says in its tools when another tab changed the list and this tab's version was kept, and the notice closes", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    const notices = tools().querySelector(".gp-tools__notices");
    expect(notices).not.toBeNull();

    // A change here, unsaved, while another tab keeps a newer copy: this tab's print keeps its own.
    const fonts = deferred<undefined>();
    fontsReady(fonts.promise);
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await otherTabSaves(backend, (theirs) => ({ ...theirs, title: "Theirs", updatedAt: "2026-11-14T10:00:00.000Z" }));
    state().apply((list) => ({ ...list, title: "Ours", changedSincePrint: true }));
    fonts.resolve(undefined);
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });

    const words = await within(tools()).findByText("This list was also changed in another tab. This tab's version was kept.");
    expect(tools().querySelector(".gp-tools__notices")).toBe(notices);
    fireEvent.click(within(words.closest("[data-notice]") ?? tools()).getByRole("button", { name: "Close" }));
    expect(within(tools()).queryByText("This list was also changed in another tab. This tab's version was kept.")).toBeNull();
  });

  it("says in its tools when the list is no longer kept in this browser, and the notice closes", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await memoryStore(backend).erase(PLAN_ID);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    const words = await within(tools()).findByText(REMOVED_ELSEWHERE_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("removed-elsewhere");
    expect(state().list?.guests).toEqual([]);
    fireEvent.click(within(words.closest("[data-notice]") ?? tools()).getByRole("button", { name: "Close" }));
    expect(within(tools()).queryByText(REMOVED_ELSEWHERE_WORDS)).toBeNull();
  });

  it("a print waiting to be kept when another tab deletes the list is not written back, and the tools say so", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await memoryStore(backend).erase(PLAN_ID);

    // The browser's own Print command, with no read of the device before it.
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    await act(async () => {
      await state().flush();
    });
    expect((await memoryStore(backend).open(PLAN_ID)).kind).toBe("new");
    expect(await within(tools()).findByText(REMOVED_ELSEWHERE_WORDS)).toBeTruthy();
    expect(state().list?.guests).toEqual([]);
  });

  it("says in its tools when names were added in another tab after the list was deleted here", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    // The list is deleted in this tab (from the list page, whose state this page shares).
    await act(async () => {
      await state().eraseList();
    });
    expect((await memoryStore(backend).open(PLAN_ID)).kind).toBe("new");
    expect((await memoryStore(backend).save(list180({ title: "Theirs" }), null)).kind).toBe("saved");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    const words = await within(tools()).findByText(ADDED_AFTER_DELETE_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("added-after-delete");
    expect(state().list?.title).toBe("Theirs");
    fireEvent.click(within(words.closest("[data-notice]") ?? tools()).getByRole("button", { name: "Close" }));
    expect(within(tools()).queryByText(ADDED_AFTER_DELETE_WORDS)).toBeNull();
  });

  it("a print is not a change undo steps back through", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(state().canUndo).toBe(false);
  });

  it("says when the browser is not keeping the list", async () => {
    const refusing: GuestListStore = {
      open: () => Promise.resolve({ kind: "no-storage" }),
      save: () => Promise.resolve({ kind: "not-kept" }),
      erase: () => Promise.resolve(),
      sweep: () => Promise.resolve([]),
    };
    open(`${PAPER}?kit=on`, refusing);
    await paper("table-plan");
    const words = within(tools()).getByText(
      "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave.",
    );
    // Announced: an alert, in the tools' status region that is always on the page.
    expect(words.getAttribute("role")).toBe("alert");
    expect(words.parentElement?.getAttribute("role")).toBe("status");
    expect(words.parentElement?.classList.contains("gp-tools__notices")).toBe(true);
  });

  it("keeps the tools' notices region on the page, announced as a status, while it holds no notice", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    const notices = tools().querySelector(".gp-tools__notices");
    expect(notices?.getAttribute("role")).toBe("status");
    expect(notices?.children).toHaveLength(0);
  });

  it("says, as an alert, when the list kept here could not be opened just now", async () => {
    const unread: GuestListStore = {
      open: () => Promise.resolve({ kind: "not-kept" }),
      save: () => Promise.resolve({ kind: "not-kept" }),
      erase: () => Promise.resolve(),
      sweep: () => Promise.resolve([]),
    };
    open(`${PAPER}?kit=on`, unread);
    await paper("table-plan");
    const words = within(tools()).getByText(
      "The list kept here for this plan could not be opened just now. Reload the page to try again. Anything added here is not being kept.",
    );
    expect(words.getAttribute("role")).toBe("alert");
    expect(within(tools()).queryByText(/This browser is not keeping the list/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A print never writes over another tab's list. The browser's own Print
// command makes no read of the device, so the sheet it lays out can be of an
// older copy: the save then gives way to the other tab's list, records the
// print on it as made from an older copy, and the tools say so.
// ---------------------------------------------------------------------------

describe("the guest paper page: a print gives way to another tab's list", () => {
  it("the browser's own Print command, over a list another tab changed unseen, keeps their list and says the printout is of an older copy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00.000Z"));
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    const sheet = await paper("table-plan");

    // Another tab renames the event and seats one more guest; this page gets no focus or visibility event.
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      title: "Changed in the other tab",
      guests: [...kept.guests, { id: uuid(5000), name: "Morag Example", party: "", tableId: uuid(18), seat: 3 }],
      changedSincePrint: true,
      updatedAt: "2026-11-14T10:00:00.000Z",
    }));
    expect(text(sheet.querySelector(".gp-leaf__title"))).toBe(TITLE);

    // What the browser lays out as the handler returns: the older copy, numbered version 1.
    let laidOut = "";
    let laidOutTitle = "";
    const read = (): void => {
      laidOut = text(document.querySelector(".gp-running"));
      laidOutTitle = text(document.querySelector(".gp-leaf__title"));
    };
    window.addEventListener("beforeprint", read);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    window.removeEventListener("beforeprint", read);
    expect(laidOut).toBe("Version 1 · printed 15 November 2026");
    expect(laidOutTitle).toBe(TITLE);

    await act(async () => {
      await state().flush();
    });

    // The device holds the other tab's list, and nothing of the older content.
    const kept = await memoryStore(backend).open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.title).toBe("Changed in the other tab");
    expect(kept.list.guests).toHaveLength(181);
    expect(kept.list.guests.map((g) => g.name)).toContain("Morag Example");
    // Its version is the number that was on the sheet, and it is marked changed since that print.
    expect(kept.list.paperVersion).toBe(1);
    expect(kept.list.printedAt).toBe("2026-11-15T10:00:00.000Z");
    expect(kept.list.changedSincePrint).toBe(true);

    // The page says so, and shows the other tab's list.
    const words = await within(tools()).findByText(PRINT_OF_OLDER_COPY_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("print-of-older-copy");
    expect(words.closest("[role='status']")).not.toBeNull();
    const now = await paper("table-plan");
    expect(text(now)).toContain("Example, Morag");
    expect(text(now.querySelector(".gp-leaf__title"))).toBe("Changed in the other tab");
    expect(within(tools()).queryByText("This list was also changed in another tab. This tab's version was kept.")).toBeNull();

    fireEvent.click(within(words.closest("[data-notice]") ?? tools()).getByRole("button", { name: "Close" }));
    expect(within(tools()).queryByText(PRINT_OF_OLDER_COPY_WORDS)).toBeNull();

    // Printing it again, as the words ask, gives the changed list the next number.
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(currentList().paperVersion).toBe(2);
    expect(currentList().changedSincePrint).toBe(false);
  });

  it("an ordinary change waiting with the browser's own Print keeps this tab's list and says so, as before", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await otherTabSaves(backend, (kept) => ({ ...kept, title: "Theirs", updatedAt: "2026-11-14T10:00:00.000Z" }));

    act(() => {
      state().apply((list) => ({ ...list, title: "Ours", changedSincePrint: true }));
      window.dispatchEvent(new Event("beforeprint"));
    });
    await act(async () => {
      await state().flush();
    });

    expect(await within(tools()).findByText("This list was also changed in another tab. This tab's version was kept.")).toBeTruthy();
    expect(within(tools()).queryByText(PRINT_OF_OLDER_COPY_WORDS)).toBeNull();
    const kept = await memoryStore(backend).open(PLAN_ID);
    expect(kept.kind === "ready" ? [kept.list.title, kept.list.paperVersion] : null).toEqual(["Ours", 1]);
  });
});

// ---------------------------------------------------------------------------
// Coming back to the paper from another page of the app. The page state lives
// on while the page is away, so every mount reads the device again: each case
// stays inside ONE router, leaves by the paper's own link, comes back by a
// link, and never resets the page state in between. "Another tab" is a second
// device store over the same storage.
// ---------------------------------------------------------------------------

describe("the guest paper page: mounted again over a list it already holds", () => {
  it("lists a guest another tab added meanwhile, and the browser's own Print then records its version without losing that guest", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await leaveForTheList();

    // In another tab the planner seats one more guest at table 18, and it is kept.
    await otherTabSaves(backend, (kept) => ({
      ...kept,
      guests: [...kept.guests, { id: uuid(5000), name: "Morag Example", party: "", tableId: uuid(18), seat: 3 }],
      changedSincePrint: true,
      updatedAt: "2026-11-14T10:00:00.000Z",
    }));

    const sheet = await comeBackToThePaper();
    expect(text(sheet)).toContain("Example, Morag");
    expect(text(tools().querySelector(".gp-tools__count"))).toBe("173 names");

    // The browser's own Print command: the version is recorded at once, with no read of its own.
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(text(sheet.querySelector(".gp-running"))).toMatch(/^Version 1 · printed /);
    await act(async () => {
      await state().flush();
    });
    const kept = await memoryStore(backend).open(PLAN_ID);
    if (kept.kind !== "ready") throw new Error("the list was not kept");
    expect(kept.list.guests.map((g) => g.name)).toContain("Morag Example");
    expect(kept.list.guests).toHaveLength(181);
    expect(kept.list.paperVersion).toBe(1);
    expect(within(tools()).queryByText("This list was also changed in another tab. This tab's version was kept.")).toBeNull();
  });

  it("takes an empty list when another tab deleted it meanwhile, and says so in its tools", async () => {
    const backend = memoryBackend();
    const store = await storeHolding(list180(), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await leaveForTheList();
    await memoryStore(backend).erase(PLAN_ID);

    const sheet = await comeBackToThePaper();
    expect(within(tools()).getByText(REMOVED_ELSEWHERE_WORDS)).toBeTruthy();
    expect(text(tools().querySelector(".gp-tools__count"))).toBe("0 names");
    expect(text(sheet)).not.toContain(CANARY);
  });

  it("a list that passed its removal day while the page was away is not printed, and the tools say the rule removed it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-13T10:00:00.000Z"));
    const backend = memoryBackend();
    // The event was yesterday: the list's removal day is 12 July 2027.
    const store = await storeHolding(list180({ eventDate: "2027-06-12" }), backend);
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await leaveForTheList();

    vi.setSystemTime(new Date("2027-07-12T00:00:00.000Z"));
    const sheet = await comeBackToThePaper();
    const words = within(tools()).getByText(REMOVED_BY_RULE_WORDS);
    expect(words.closest("[data-notice]")?.getAttribute("data-notice")).toBe("removed-by-rule");
    expect(text(sheet)).not.toContain(CANARY);
    expect(text(tools().querySelector(".gp-tools__count"))).toBe("0 names");
    expect((await memoryStore(backend).open(PLAN_ID)).kind).toBe("new");
  });

  it("a fresh open whose own sweep removed the list says the rule removed it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-07-12T00:00:00.000Z"));
    const store = await storeHolding(list180({ eventDate: "2027-06-12" }));
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    expect(within(tools()).getByText(REMOVED_BY_RULE_WORDS)).toBeTruthy();
    expect(text(tools().querySelector(".gp-tools__count"))).toBe("0 names");
  });

  it("stays in its opening state until this mount's read of the device has returned, so nothing can be printed before it", async () => {
    const backend = memoryBackend();
    const inner = await storeHolding(list180(), backend);
    const slow = deferred<undefined>();
    let slowReads = false;
    const store: GuestListStore = {
      ...inner,
      open: async (planId) => {
        if (slowReads) await slow.promise;
        return inner.open(planId);
      },
    };
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    await leaveForTheList();
    await otherTabSaves(backend, (kept) => ({ ...kept, title: "Changed meanwhile", updatedAt: "2026-11-14T10:00:00.000Z" }));

    slowReads = true;
    fireEvent.click(screen.getByRole("link", { name: "Back to the paper" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toContain("Opening your guest list…");
    expect(screen.queryByTestId("guest-paper-sheet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    // The browser's own Print command now has no paper to record a version on.
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(currentList().paperVersion).toBe(0);

    await act(async () => {
      slow.resolve(undefined);
      await slow.promise;
    });
    const sheet = await paper("table-plan");
    expect(text(sheet.querySelector(".gp-leaf__title"))).toBe("Changed meanwhile");
  });
});

// ---------------------------------------------------------------------------
// No name leaves the page
// ---------------------------------------------------------------------------

describe("the guest paper page: names stay on the paper", () => {
  it("makes no request on any sheet, or when printing", async () => {
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    for (const [name, sheet] of [...SHEET_LINKS.slice(1), SHEET_LINKS[0]]) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      await paper(sheet);
    }
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(mocks.getPublicConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it("puts no guest's name in a class name, an attribute, the address, the title or the console", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined));
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    const names = [...GUESTS.flatMap((g) => [fullName(g), `${g.last}, ${g.first}`]), CANARY, TABLE_CANARY];
    const seen: string[] = [];
    for (const [name, sheet] of [...SHEET_LINKS.slice(1), SHEET_LINKS[0]]) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      await paper(sheet);
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        for (const attribute of Array.from(element.attributes)) seen.push(attribute.value);
      }
      seen.push(text(screen.getByTestId("where")), document.title);
    }
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    for (const spy of logs) {
      for (const call of spy.mock.calls) seen.push(call.map((arg) => String(arg)).join(" "));
    }
    expect(seen.length).toBeGreaterThan(100);
    const leaks = seen.filter((value) => names.some((name) => value.includes(name)));
    expect(leaks).toEqual([]);
  });
});

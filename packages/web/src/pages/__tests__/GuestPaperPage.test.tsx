import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { memoryBackend, withBackend } from "../../lib/idb-cache.js";
import { KIT_STORAGE_KEY } from "../../lib/guest-list/kit-switch.js";
import { emptyGuestList, type Guest, type GuestList, type KitTable } from "../../lib/guest-list/model.js";
import { createGuestListStore, type GuestListStore, type Opened } from "../../lib/guest-list/store.js";
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

function memoryStore(): GuestListStore {
  return createGuestListStore(withBackend<unknown>(memoryBackend()));
}

async function storeHolding(list: GuestList): Promise<GuestListStore> {
  const store = memoryStore();
  expect(await store.save(list, null)).toBe("saved");
  return store;
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

function open(entry: string, store?: GuestListStore): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/plan/:code/guests/paper" element={<GuestPaperPage store={store} />} />
        <Route path="/plan/:code/guests" element={<p data-testid="list">list</p>} />
        <Route path="/plan" element={<p data-testid="planner">planner</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
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

  it("uses the list already open for this plan without reading the device again", async () => {
    const store = await storeHolding(list180());
    await act(async () => {
      await state().open(PLAN_ID, store);
    });
    const openSpy = vi.spyOn(store, "open");
    open(`${PAPER}?kit=on`, store);
    await paper("table-plan");
    expect(openSpy).not.toHaveBeenCalled();
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
  it("says \"Not yet printed\" on every sheet before the first print", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    for (const [name, sheet] of SHEET_LINKS) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      const found = await paper(sheet);
      expect(text(found.querySelector(".gp-foot"))).toBe("Not yet printed");
    }
  });

  it("carries the version and the day it was printed on every sheet", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180({ paperVersion: 6, printedAt: "2026-11-13T18:20:00.000Z" })));
    await paper("table-plan");
    for (const [name, sheet] of SHEET_LINKS) {
      fireEvent.click(within(tools()).getByRole("link", { name }));
      const found = await paper(sheet);
      expect(text(found.querySelector(".gp-foot"))).toBe("Version 6 · printed 13 November 2026");
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
      // What is on the paper at the moment it prints.
      events.push("print", text(document.querySelector(".gp-foot")));
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
    const read = (): void => { laidOut = text(sheet.querySelector(".gp-foot")); };
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

  it("a print is not a change undo steps back through", async () => {
    open(`${PAPER}?kit=on`, await storeHolding(list180()));
    await paper("table-plan");
    fireEvent.click(within(tools()).getByRole("button", { name: "Print" }));
    await waitFor(() => { expect(printSpy).toHaveBeenCalledTimes(1); });
    expect(state().canUndo).toBe(false);
  });

  it("says when the browser is not keeping the list", async () => {
    const refusing: GuestListStore = {
      open: () => Promise.resolve({ kind: "not-kept" }),
      save: () => Promise.resolve("not-kept"),
      erase: () => Promise.resolve(),
      sweep: () => Promise.resolve(0),
    };
    open(`${PAPER}?kit=on`, refusing);
    await paper("table-plan");
    expect(within(tools()).getByText(
      "This browser is not keeping the list. It will be gone when you close this tab. Download it before you leave.",
    )).toBeTruthy();
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

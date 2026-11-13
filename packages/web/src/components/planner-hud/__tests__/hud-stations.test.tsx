import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItem } from "../../../lib/catalogue.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../../lib/door-clear-spaces.js";
import { doorBlockers } from "../../../lib/keep-doors-clear.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../../lib/placement.js";
import { plannerFeatureEnabled, setPlannerChromeFeatures, setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParamsRequest } from "../../../lib/setup-cards.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { HudFrame } from "../HudFrame.js";
import { HudSheets } from "../HudSheets.js";

// ---------------------------------------------------------------------------
// The HUD over the real stores (DOCTRINE.md, "letterbox"): the top bar's
// steps, the shelf's seat line and status line, the hand, the one primary
// key, the chosen piece's verbs, the sheets and the first screen. Nothing here
// mocks a store; the keys are pressed as a browser sends them, to the one
// listener on the window (lib/planner-keys.ts).
// ---------------------------------------------------------------------------

let sequence = 0;
function newId(): string {
  sequence += 1;
  return `hud-piece-${String(sequence)}`;
}

function stamp(id: CardId, x: number, z: number, asked: CardParamsRequest = {}): readonly PlacedItem[] {
  const params = cardParamsFor(id, asked);
  if (params === null) throw new Error(`no card ${id}`);
  return stampSetup(params, { x, z }, 0, newId);
}

/**
 * Rounds in two rows down the middle of the hall, clear of one another. The
 * round card's own colourway is white: a table whose cloth is its own. "bare"
 * asks for the plain table that takes a cloth laid on it.
 */
function rounds(count: number, seats = 10, colourway: "white" | "bare" = "white"): readonly PlacedItem[] {
  const pieces: PlacedItem[] = [];
  for (let index = 0; index < count; index += 1) {
    pieces.push(...stamp("round", -6.75 + (index % 4) * 4.5, -2.25 + Math.floor(index / 4) * 4.5, { seats, colourway }));
  }
  return pieces;
}

/** A round of ten standing in the middle of the Grand Hall's first recorded door. */
function roundInADoor(): readonly PlacedItem[] {
  const door = GRAND_HALL_DOOR_CLEAR_SPACES[0];
  if (door === undefined) throw new Error("the Grand Hall has recorded doors");
  return stamp("round", (door.rect.minX + door.rect.maxX) / 2, (door.rect.minZ + door.rect.maxZ) / 2);
}

/** Two rounds a hand's breadth apart: the narrowest aisle wants a look. */
function twoRoundsClose(): readonly PlacedItem[] {
  return [...stamp("round", 0, 0), ...stamp("round", 2.3, 0)];
}

function setPlaced(items: readonly PlacedItem[]): void {
  act(() => { usePlacementStore.setState({ placedItems: items }); });
}

function setGuests(count: number | null): void {
  act(() => { useCockpitStore.getState().setPlannedGuestCount(count); });
}

function recordDoors(): void {
  act(() => { useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES); });
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function tables(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "table");
}

function chairs(): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === "chair");
}

function renderHud(props: { readonly eventGuests?: number | null } = {}): void {
  render(<HudFrame room={null} plaque={<p>The plaque</p>} eventGuests={props.eventGuests ?? null} sheets={<HudSheets />} />);
}

/** A key as a browser sends it, to the window; the event, to ask whether the planner took it. */
function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const key = code.startsWith("Digit") ? code.slice("Digit".length) : code;
  const event = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(event); });
  return event;
}

function cardKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-card="${id}"]`);
  if (found === null) throw new Error(`no ${id} card in the hand`);
  return found;
}

/** The cards in the hand, as they sit, left to right. */
function handIds(): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-card]"), (card) => card.dataset["card"] ?? "");
}

function stepKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-step="${id}"]`);
  if (found === null) throw new Error(`no ${id} step`);
  return found;
}

/** The shelf: the one surface under the room. */
function shelf(): HTMLElement {
  return screen.getByRole("region", { name: "Furniture and the next steps" });
}

/** The shelf's one status line. */
function statusLine(): HTMLElement {
  return within(shelf()).getByRole("status", { name: "The room as it stands" });
}

/** The one primary key, whatever it says now. */
function primaryKey(): HTMLElement {
  const found = shelf().querySelector<HTMLElement>(".hud-shelf__act .hud-act");
  if (found === null) throw new Error("no primary key on the shelf");
  return found;
}

function armed(): string | null {
  return useCatalogueStore.getState().armedCardId;
}

function chosenIds(): readonly string[] {
  return [...useSelectionStore.getState().selectedIds];
}

beforeEach(() => {
  sequence = 0;
  resetPlacedIdCounter();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  // The first screen is asked for in its own tests below; elsewhere it has been answered.
  usePlannerHudStore.setState({ firstOpenDone: true });
});

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useCatalogueStore.getState().clearSelection();
  useSelectionStore.getState().clearSelection();
  useCockpitStore.getState().setPlannedGuestCount(null);
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  usePlacementNoticeStore.getState().dismiss();
  usePlannerHudStore.getState().reset();
  usePlannerEventStore.getState().setEventKind(null);
  setPlannerFeaturesForTesting(null);
  setPlannerChromeFeatures({});
});

describe("the frame", () => {
  it("turns the card switches on while it is on screen and off again when it leaves", () => {
    const names = ["setupCards", "seatsOnTheCard", "tableSets", "tableNumbers", "editingKeys", "fillKeepOuts"] as const;
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} before`).toBe(false);
    renderHud();
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} while mounted`).toBe(true);
    cleanup();
    for (const name of names) expect(plannerFeatureEnabled(name), `${name} after`).toBe(false);
  });

  it("holds the room as its main landmark, and the plaque at the top bar's left", () => {
    render(<HudFrame room={<div data-testid="the-room" />} plaque={<p>The plaque</p>} eventGuests={null} />);
    expect(screen.getByRole("main").contains(screen.getByTestId("the-room"))).toBe(true);
    expect(document.querySelector(".hud-bar .hud-bar__plaque")?.textContent).toBe("The plaque");
  });

  it("is two bars over the room: no column of seals and no side panel", () => {
    renderHud();
    const layers = Array.from(screen.getByTestId("planner-hud").children, (child) => child.className);
    expect(layers).toEqual(["hud-room", "hud-bar", "hud-shelf"]);
    expect(document.querySelector("[data-seal]")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Your room" })).toBeNull();
  });
});

describe("the hand's cards", () => {
  it("deals eight cards and More, with Lay out for me, Undo and Redo beside them, and one primary key", () => {
    renderHud();
    expect(handIds()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "More furniture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lay out for me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    // The separate Send key is gone: the one primary key says the next move, whatever it is.
    expect(screen.queryByRole("button", { name: "Send to Events Team" })).toBeNull();
    expect(shelf().querySelectorAll(".hud-act:not([hidden])")).toHaveLength(1);
  });

  it("takes a card on a click, and puts it back on a second click", () => {
    renderHud();
    const round = cardKey("round");
    expect(round.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(round);
    expect(armed()).toBe("round");
    expect(round.getAttribute("aria-pressed")).toBe("true");
    expect(shelf().getAttribute("data-in-hand")).toBe("true");

    fireEvent.click(round);
    expect(armed()).toBeNull();
    expect(round.getAttribute("aria-pressed")).toBe("false");
    expect(shelf().getAttribute("data-in-hand")).toBeNull();
  });

  it("hands over to another card when a second is taken, one in hand at a time", () => {
    renderHud();
    fireEvent.click(cardKey("round"));
    fireEvent.click(cardKey("long-table"));
    expect(armed()).toBe("long-table");
    expect(cardKey("round").getAttribute("aria-pressed")).toBe("false");
    expect(cardKey("long-table").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll('[data-card][data-armed="true"]')).toHaveLength(1);
  });

  it("closes an open sheet when a card is taken, so the floor is clear to set it on", () => {
    renderHud();
    act(() => { usePlannerHudStore.getState().openSheet("finishing"); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(cardKey("round"));
    expect(usePlannerHudStore.getState().sheet).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(armed()).toBe("round");
  });

  it("opens the whole catalogue from More, and the same key shuts it", () => {
    renderHud();
    const more = screen.getByRole("button", { name: "More furniture" });
    fireEvent.click(more);
    expect(usePlannerHudStore.getState().sheet).toBe("more");
    expect(screen.getByRole("dialog", { name: "Everything the hall has" })).toBeTruthy();
    fireEvent.click(more);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("counts what is in the room beside the name on the card that sets it down", () => {
    renderHud();
    setPlaced(rounds(2));
    const count = within(cardKey("round")).getByText("×2");
    expect(count.closest(".hud-card__name")?.textContent).toBe("Round of 10 ×2");
    expect(cardKey("round").getAttribute("aria-label")).toMatch(/, 2 in the room$/u);
  });
});

describe("the digit keys", () => {
  it("has eight cards for the digits to take", () => {
    renderHud();
    expect(handIds()).toHaveLength(8);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("takes the card in place %i", (digit) => {
    renderHud();
    const ids = handIds();
    const event = press(`Digit${String(digit)}`);
    expect(armed()).toBe(ids[digit - 1]);
    expect(event.defaultPrevented).toBe(true);
    expect(cardKey(ids[digit - 1] ?? "").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the card back when its digit is pressed again", () => {
    renderHud();
    press("Digit1");
    expect(armed()).not.toBeNull();
    press("Digit1");
    expect(armed()).toBeNull();
  });

  it("swaps to the next card when another digit is pressed", () => {
    renderHud();
    const ids = handIds();
    press("Digit1");
    press("Digit3");
    expect(armed()).toBe(ids[2]);
  });

  it("leaves 9 and 0 alone: there is no ninth card", () => {
    renderHud();
    expect(press("Digit9").defaultPrevented).toBe(false);
    expect(press("Digit0").defaultPrevented).toBe(false);
    expect(armed()).toBeNull();
  });

  it("leaves Shift and Ctrl with a digit to the browser", () => {
    renderHud();
    press("Digit1", { shiftKey: true, key: "!" });
    press("Digit1", { ctrlKey: true });
    expect(armed()).toBeNull();
  });

  it("does nothing while a sheet is open, so typing a guest count is never a card", () => {
    renderHud();
    act(() => { usePlannerHudStore.getState().openSheet("event"); });
    press("Digit1");
    expect(armed()).toBeNull();
    const guests = screen.getByRole("spinbutton", { name: "Guests" });
    expect(press("Digit2").defaultPrevented).toBe(false);
    expect(guests).toBeTruthy();
    expect(armed()).toBeNull();
  });

  it("follows the hand when the kind of event changes the cards", () => {
    renderHud();
    act(() => { usePlannerEventStore.getState().setEventKind("corporate"); });
    const ids = handIds();
    expect(ids).toHaveLength(8);
    expect(ids).toContain("piece:lectern");
    press("Digit4");
    expect(armed()).toBe(ids[3]);
  });
});

describe("the status line", () => {
  it("counts the seats placed when no guest count is known", () => {
    renderHud();
    setPlaced(rounds(1));
    expect(statusLine().textContent).toContain("10 seats placed");
  });

  it('reads "N of M seated" once a guest count is set and a round is stamped, and says it once', () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(3));
    const line = statusLine();
    expect(line.textContent).toContain("30 of 120 seated");
    // Derived restatements are gone: the shelf's edge carries how far there is to go.
    expect(line.textContent).not.toContain("to go");
    expect(line.textContent).not.toContain("seats placed");
  });

  it("reads N of N when every guest has a seat", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    expect(statusLine().textContent).toContain("30 of 30 seated");
  });

  it("takes the linked event's guest count, and a count given in the planner comes first", () => {
    renderHud({ eventGuests: 40 });
    setPlaced(rounds(2));
    expect(statusLine().textContent).toContain("20 of 40 seated");
    setGuests(60);
    expect(statusLine().textContent).toContain("20 of 60 seated");
  });

  it("updates as seats are added and taken away", () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(1));
    expect(statusLine().textContent).toContain("10 of 120 seated");
    setPlaced(rounds(2));
    expect(statusLine().textContent).toContain("20 of 120 seated");
    setPlaced([]);
    expect(statusLine().textContent).toContain("0 of 120 seated");
  });

  it("says the doors are clear once the room's doors are recorded, and nothing of them before", () => {
    renderHud();
    setPlaced(rounds(1));
    expect(statusLine().textContent).not.toContain("Doors");
    recordDoors();
    expect(statusLine().textContent).toContain("Doors clear");
    expect(within(statusLine()).queryByRole("button")).toBeNull();
  });

  it("makes a blocked door something to look at, and a press chooses the table in front of it", () => {
    renderHud();
    recordDoors();
    setGuests(10);
    setPlaced(roundInADoor());
    const door = within(statusLine()).getByRole("button", { name: /^1 door blocked\. .+ is in front of/u });
    expect(door.textContent).toBe("1 door blocked");
    fireEvent.click(door);
    const table = tables()[0];
    expect(table).toBeDefined();
    expect(chosenIds()).toContain(table?.id);
    // The cards give way to its verbs, and its name takes the seats' place.
    expect(document.querySelector(".hud-piece")).not.toBeNull();
    expect(within(statusLine()).getByRole("heading", { name: /Round of 10/u })).toBeTruthy();
  });

  it("makes a tight aisle something to look at, and a press chooses the two pieces", () => {
    renderHud();
    setGuests(20);
    setPlaced(twoRoundsClose());
    const aisle = within(statusLine()).getByRole("button", { name: /^Narrowest aisle \d+\.\d m\. The narrowest gap is/u });
    fireEvent.click(aisle);
    expect(chosenIds()).toHaveLength(2);
    expect(tables().every((table) => chosenIds().includes(table.id))).toBe(true);
  });

  it("gives a receipt its place while it shows, with Undo, and takes the place back when it clears", () => {
    renderHud();
    setGuests(120);
    act(() => { usePlacementNoticeStore.getState().post("Laid 12 tables of ten", { undo: true }); });
    const region = screen.getByTestId("hud-notice-region");
    expect(shelf().contains(region)).toBe(true);
    expect(within(region).getByText("Laid 12 tables of ten")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(within(shelf()).queryByRole("status", { name: "The room as it stands" })).toBeNull();

    act(() => { usePlacementNoticeStore.getState().dismiss(); });
    expect(within(region).queryByText("Laid 12 tables of ten")).toBeNull();
    expect(statusLine().textContent).toContain("0 of 120 seated");
  });
});

describe("the one primary key", () => {
  it("asks how many guests while no count is known, opens Your event, and steps aside while it is open", () => {
    renderHud();
    expect(primaryKey().textContent).toBe("Say how many guests");
    fireEvent.click(screen.getByRole("button", { name: "Say how many guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(screen.queryByRole("button", { name: "Say how many guests" })).toBeNull();
  });

  it("lays the room out for the guests on an empty floor, through Lay out", () => {
    renderHud();
    setGuests(120);
    fireEvent.click(screen.getByRole("button", { name: "Lay out the room for 120 guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });

  it("asks to seat the guests still without a seat", () => {
    renderHud();
    setGuests(50);
    setPlaced(rounds(2));
    fireEvent.click(screen.getByRole("button", { name: "Seat 30 more guests" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });

  it("moves a table clear of the door it stands in front of, in one press", () => {
    renderHud();
    recordDoors();
    setGuests(10);
    setPlaced(roundInADoor());
    expect(primaryKey().textContent).toMatch(/^Move .+ clear of the door$/u);
    fireEvent.click(primaryKey());
    expect(doorBlockers(placed(), GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("opens up the narrowest gap by choosing the two pieces either side of it", () => {
    renderHud();
    setGuests(20);
    setPlaced(twoRoundsClose());
    fireEvent.click(screen.getByRole("button", { name: "Open up the narrowest gap" }));
    expect(chosenIds()).toHaveLength(2);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
  });

  it("sends to the events team once every guest has a seat", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    expect(primaryKey().getAttribute("data-move")).toBe("send");
    fireEvent.click(screen.getByRole("button", { name: "Send to the events team" }));
    expect(screen.getByRole("dialog", { name: "Send to the events team" })).toBeTruthy();
  });

  it("says, quietly, that the plan has gone, and opens Send again on a press", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    act(() => { usePlannerHudStore.getState().markSent(); });
    expect(primaryKey().textContent).toBe("Sent to the events team");
    expect(primaryKey().getAttribute("data-move")).toBe("sent");
    fireEvent.click(primaryKey());
    expect(usePlannerHudStore.getState().sheet).toBe("send");
  });
});

describe("the journey and its sheets", () => {
  it("shows four steps with the first current", () => {
    renderHud();
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"), (step) => [step.dataset["step"], step.dataset["state"]]);
    expect(steps).toEqual([["event", "current"], ["layout", "ahead"], ["finishing", "ahead"], ["send", "ahead"]]);
    expect(stepKey("event").getAttribute("aria-current")).toBe("step");
  });

  it("moves its current step on as the room fills and the tables are dressed", async () => {
    renderHud();
    setGuests(30);
    expect(stepKey("event").getAttribute("data-state")).toBe("done");
    expect(stepKey("layout").getAttribute("data-state")).toBe("current");
    // Plain tables: every guest seated, but nothing dressed yet.
    setPlaced(rounds(3, 10, "bare"));
    expect(stepKey("layout").getAttribute("data-state")).toBe("done");
    expect(stepKey("finishing").getAttribute("data-state")).toBe("current");
    expect(stepKey("send").getAttribute("data-state")).toBe("ahead");
    // The same tables in their own white cloth. The pieces are the same in number, so the HUD
    // reads their new places once the hand rests (hud-facts.tsx), not on the instant.
    setPlaced(rounds(3));
    expect(stepKey("finishing").getAttribute("data-state")).toBe("current");
    await waitFor(() => { expect(stepKey("finishing").getAttribute("data-state")).toBe("done"); });
    expect(stepKey("send").getAttribute("data-state")).toBe("current");
    expect(screen.getByRole("button", { name: "Send to the events team" })).toBeTruthy();
  });

  it("opens a step's sheet when it is pressed, and Escape closes it", () => {
    renderHud();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(stepKey("event"));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Your event" })).toBeTruthy();

    const event = press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(usePlannerHudStore.getState().sheet).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("false");
  });

  it("raises the sheet from the shelf, with the shelf still under it", () => {
    renderHud();
    fireEvent.click(stepKey("finishing"));
    const sheet = screen.getByRole("dialog", { name: "Finishing touches" });
    expect(shelf().contains(sheet)).toBe(true);
    expect(handIds()).toHaveLength(8);
  });

  it("closes the sheet when the same step is pressed again", () => {
    renderHud();
    fireEvent.click(stepKey("finishing"));
    expect(screen.getByRole("dialog", { name: "Finishing touches" })).toBeTruthy();
    fireEvent.click(stepKey("finishing"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds one sheet at a time: another step replaces the open one", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.click(stepKey("finishing"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Finishing touches" })).toBeTruthy();
    expect(stepKey("event").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from its own Close key", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets Escape through to nothing when no sheet is open", () => {
    renderHud();
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("takes a guest count from the Your event sheet, which the status line then reads", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "80" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(80);
    expect(statusLine().textContent).toContain("0 of 80 seated");
    // The count given, the next move is the next step's, and the primary key says it.
    expect(screen.getByRole("button", { name: "Lay out the room for 80 guests" })).toBeTruthy();
  });

  it("sends Lay out for me to Your event until there is a guest count, then to Lay out", () => {
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Lay out for me" }));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    act(() => { usePlannerHudStore.getState().closeSheet(); });
    setGuests(50);
    fireEvent.click(screen.getByRole("button", { name: "Lay out for me" }));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });
});

describe("the piece's verbs", () => {
  function chooseTable(): string {
    const table = tables()[0];
    if (table === undefined) throw new Error("no table placed");
    act(() => { useSelectionStore.getState().selectMultiple([table.id]); });
    return table.id;
  }

  it("take the cards' place while something is chosen, and give it back when it is let go", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    const cards = shelf().querySelector<HTMLElement>(".hud-cards");
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(cards?.hidden).toBe(false);
    chooseTable();
    expect(document.querySelector(".hud-piece")).not.toBeNull();
    expect(cards?.hidden).toBe(true);
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(cards?.hidden).toBe(false);
  });

  it("name a chosen round by its seats where the status line's first words were", () => {
    renderHud();
    setGuests(40);
    setPlaced(rounds(1, 8));
    expect(statusLine().textContent).toContain("8 of 40 seated");
    chooseTable();
    expect(within(statusLine()).getByRole("heading", { name: /Round of 8/u })).toBeTruthy();
    expect(statusLine().textContent).not.toContain("seated");
    const stepper = screen.getByRole("group", { name: "Seats at this table" });
    expect(within(stepper).getByText("8 seats")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Round of 8/u }).contains(stepper)).toBe(true);
  });

  it("add a seat with the plus key and take one away with the minus key", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(chairs()).toHaveLength(8);
    const stepper = screen.getByRole("group", { name: "Seats at this table" });

    fireEvent.click(within(stepper).getByRole("button", { name: "One seat more" }));
    expect(chairs()).toHaveLength(9);
    expect(within(screen.getByRole("group", { name: "Seats at this table" })).getByText("9 seats")).toBeTruthy();

    fireEvent.click(within(stepper).getByRole("button", { name: "One seat fewer" }));
    fireEvent.click(within(stepper).getByRole("button", { name: "One seat fewer" }));
    expect(chairs()).toHaveLength(7);
    expect(within(screen.getByRole("group", { name: "Seats at this table" })).getByText("7 seats")).toBeTruthy();
  });

  it("offer no cloths for a table whose cloth is its own", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(screen.queryByRole("radiogroup", { name: "The cloth on this table" })).toBeNull();
  });

  it("dress the chosen table from its three cloths", () => {
    renderHud();
    setPlaced(rounds(1, 8, "bare"));
    chooseTable();
    const cloths = screen.getByRole("radiogroup", { name: "The cloth on this table" });
    expect(within(cloths).getAllByRole("radio")).toHaveLength(3);
    expect(within(cloths).getByRole("radio", { name: "No cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "Black cloth" }));
    expect(tables()[0]?.clothed).toBe(true);
    expect(tables()[0]?.clothStyle).toBe("black");
    expect(within(cloths).getByRole("radio", { name: "Black cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "No cloth" }));
    expect(tables()[0]?.clothed).toBe(false);
  });

  it("put the chosen table and its chairs back, and bring the cards back", () => {
    renderHud();
    setPlaced(rounds(2, 8));
    chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(tables()).toHaveLength(1);
    expect(chairs()).toHaveLength(8);
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(shelf().querySelector<HTMLElement>(".hud-cards")?.hidden).toBe(false);
  });

  it("copy the chosen table with its chairs and choose the copy", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    const original = chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(tables()).toHaveLength(2);
    expect(chairs()).toHaveLength(16);
    expect(useSelectionStore.getState().selectedIds.has(original)).toBe(false);
  });

  it("keep the cards on the shelf while a card is in hand, so the card can be seen", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    press("Digit1");
    expect(armed()).not.toBeNull();
    expect(document.querySelector(".hud-piece")).toBeNull();
    expect(shelf().querySelector<HTMLElement>(".hud-cards")?.hidden).toBe(false);
  });
});

describe("the first screen", () => {
  function ask(): void {
    act(() => { usePlannerHudStore.setState({ firstOpenDone: false }); });
  }

  it("asks what you are planning on an empty floor, on the shelf risen, with three photographs", () => {
    ask();
    renderHud();
    const root = screen.getByTestId("planner-hud");
    expect(root.getAttribute("data-first-open")).toBe("true");
    const first = screen.getByTestId("hud-first-open");
    expect(shelf().contains(first)).toBe(true);
    expect(within(first).getByRole("heading", { name: "What are you planning?" })).toBeTruthy();
    const answers = within(first).getAllByRole("radio");
    expect(answers.map((answer) => answer.querySelector(".hud-first-open__name")?.textContent)).toEqual(["Wedding", "Corporate", "Something else"]);
    expect(answers.every((answer) => answer.querySelector("img") !== null)).toBe(true);
  });

  it("takes an answer as the kind of day, and opens Your event for the guest count", () => {
    ask();
    renderHud();
    fireEvent.click(screen.getByRole("radio", { name: /Corporate/u }));
    expect(usePlannerEventStore.getState().eventKind).toBe("corporate");
    expect(usePlannerHudStore.getState().sheet).toBe("event");
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
    expect(screen.getByTestId("planner-hud").getAttribute("data-first-open")).toBeNull();
  });

  it("is put aside by Start with an empty hall, and is not asked again on this page", () => {
    ask();
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: "Start with an empty hall" }));
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
    expect(usePlannerHudStore.getState().firstOpenDone).toBe(true);
  });

  it("is put aside by Escape", () => {
    ask();
    renderHud();
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
  });

  it("is not asked once the guest count is known", () => {
    ask();
    renderHud({ eventGuests: 80 });
    expect(screen.queryByTestId("hud-first-open")).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItem } from "../../../lib/catalogue.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../../lib/placement.js";
import { plannerFeatureEnabled, setPlannerChromeFeatures, setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { cardParamsFor, stampSetup, type CardId, type CardParamsRequest } from "../../../lib/setup-cards.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerEventStore } from "../../../stores/planner-event-store.js";
import { usePlannerHudStore } from "../../../stores/planner-hud-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { HudFrame } from "../HudFrame.js";
import { HudSheets } from "../HudSheets.js";

// ---------------------------------------------------------------------------
// The HUD's stations over the real stores (design spec, "The stations"): the
// hand, the seat line, the seals, the journey and its sheets, and the piece
// card. Nothing here mocks a store; the keys are pressed as a browser sends
// them, to the one listener on the window (lib/planner-keys.ts).
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

function setPlaced(items: readonly PlacedItem[]): void {
  act(() => { usePlacementStore.setState({ placedItems: items }); });
}

function setGuests(count: number | null): void {
  act(() => { useCockpitStore.getState().setPlannedGuestCount(count); });
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

function sealKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-seal="${id}"]`);
  if (found === null) throw new Error(`no ${id} seal`);
  return found;
}

function stepKey(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-step="${id}"]`);
  if (found === null) throw new Error(`no ${id} step`);
  return found;
}

/** The seat line, the hand's one status line. */
function seatLine(): HTMLElement {
  return within(screen.getByRole("region", { name: "Furniture and the next steps" })).getByRole("status");
}

function armed(): string | null {
  return useCatalogueStore.getState().armedCardId;
}

beforeEach(() => {
  sequence = 0;
  resetPlacedIdCounter();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
});

afterEach(() => {
  cleanup();
  usePlacementStore.setState({ placedItems: [], ghostPosition: null });
  useCatalogueStore.getState().clearSelection();
  useSelectionStore.getState().clearSelection();
  useCockpitStore.getState().setPlannedGuestCount(null);
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

  it("holds the room as its main landmark and the plaque in its own place", () => {
    render(<HudFrame room={<div data-testid="the-room" />} plaque={<p>The plaque</p>} eventGuests={null} />);
    expect(screen.getByRole("main").contains(screen.getByTestId("the-room"))).toBe(true);
    expect(document.querySelector(".hud-station--plaque")?.textContent).toBe("The plaque");
  });
});

describe("the hand's cards", () => {
  it("deals eight cards, then More and Send to Events Team, with Lay out, Undo and Redo beside them", () => {
    renderHud();
    expect(handIds()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "More furniture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to Events Team" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lay out for me" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
  });

  it("takes a card on a click, and puts it back on a second click", () => {
    renderHud();
    const round = cardKey("round");
    expect(round.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(round);
    expect(armed()).toBe("round");
    expect(round.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".hud-hand")?.getAttribute("data-in-hand")).toBe("true");

    fireEvent.click(round);
    expect(armed()).toBeNull();
    expect(round.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".hud-hand")?.getAttribute("data-in-hand")).toBeNull();
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

  it("counts what is in the room on the card that sets it down", () => {
    renderHud();
    setPlaced(rounds(2));
    expect(within(cardKey("round")).getByText("×2")).toBeTruthy();
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

describe("the seat line", () => {
  it("counts the seats placed when no guest count is known", () => {
    renderHud();
    setPlaced(rounds(1));
    expect(seatLine().textContent).toContain("10 seats placed");
  });

  it('reads "N of M seated" once a guest count is set and a round is stamped', () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(3));
    const line = seatLine();
    expect(line.textContent).toContain("30 of 120 seated");
    expect(line.textContent).toContain("90 to go");
    expect(line.textContent).not.toContain("seats placed");
  });

  it("says every guest is seated when the seats cover the count", () => {
    renderHud();
    setGuests(30);
    setPlaced(rounds(3));
    const line = seatLine();
    expect(line.textContent).toContain("30 of 30 seated");
    expect(line.textContent).toContain("Every guest seated");
  });

  it("takes the linked event's guest count, and a count given in the planner comes first", () => {
    renderHud({ eventGuests: 40 });
    setPlaced(rounds(2));
    expect(seatLine().textContent).toContain("20 of 40 seated");
    setGuests(60);
    expect(seatLine().textContent).toContain("20 of 60 seated");
  });

  it("updates as seats are added and taken away", () => {
    renderHud();
    setGuests(120);
    setPlaced(rounds(1));
    expect(seatLine().textContent).toContain("10 of 120 seated");
    setPlaced(rounds(2));
    expect(seatLine().textContent).toContain("20 of 120 seated");
    setPlaced([]);
    expect(seatLine().textContent).toContain("0 of 120 seated");
  });
});

describe("the seals", () => {
  it("lists the wedding's three seals after the room's own", () => {
    renderHud();
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-seal]"), (seal) => seal.dataset["seal"]);
    expect(ids).toContain("seats");
    expect(ids).toContain("aisles");
    expect(ids.slice(-3)).toEqual(["top-table", "dance-floor", "bar"]);
  });

  it("lists the conference's own three for a corporate event", () => {
    renderHud();
    act(() => { usePlannerEventStore.getState().setEventKind("corporate"); });
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-seal]"), (seal) => seal.dataset["seal"]);
    expect(ids.slice(-3)).toEqual(["stage", "lectern", "screen"]);
  });

  it.each([
    ["top-table", "top-table"],
    ["dance-floor", "dance-floor"],
    ["bar", "piece:bar-counter"],
  ] as const)("gives a waiting %s seal's card to the hand when it is pressed", (seal, card) => {
    renderHud();
    expect(sealKey(seal).getAttribute("data-state")).toBe("waiting");
    fireEvent.click(sealKey(seal));
    expect(armed()).toBe(card);
    expect(cardKey(card).getAttribute("aria-pressed")).toBe("true");
  });

  it("gives a conference's waiting stage seal its stage card", () => {
    renderHud();
    act(() => { usePlannerEventStore.getState().setEventKind("corporate"); });
    fireEvent.click(sealKey("stage"));
    expect(armed()).toBe("piece:platform");
  });

  it("closes a sheet when it takes a card", () => {
    renderHud();
    act(() => { usePlannerHudStore.getState().openSheet("finishing"); });
    fireEvent.click(sealKey("dance-floor"));
    expect(usePlannerHudStore.getState().sheet).toBeNull();
    expect(armed()).toBe("dance-floor");
  });

  it("lights a seal once its piece is on the floor, and a lit seal takes no card", () => {
    renderHud();
    setPlaced(stamp("top-table", 0, 0));
    const top = sealKey("top-table");
    expect(top.getAttribute("data-state")).toBe("lit");
    fireEvent.click(top);
    expect(armed()).toBeNull();
  });

  it("says in a sentence what a seal reads when it is pressed, and again hides it", () => {
    renderHud();
    const bar = sealKey("bar");
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Not placed\. Press to take the Bar card\./u)).toBeTruthy();
    fireEvent.click(sealKey("dance-floor"));
    expect(bar.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the seats ring as N / M and opens Your event while no count is given", () => {
    renderHud();
    const seats = sealKey("seats");
    expect(seats.getAttribute("data-state")).toBe("waiting");
    fireEvent.click(seats);
    expect(usePlannerHudStore.getState().sheet).toBe("event");

    act(() => { usePlannerHudStore.getState().closeSheet(); });
    setGuests(120);
    setPlaced(rounds(3));
    expect(sealKey("seats").textContent).toContain("30 / 120");
    expect(sealKey("seats").getAttribute("data-state")).toBe("progress");
    fireEvent.click(sealKey("seats"));
    expect(usePlannerHudStore.getState().sheet).toBe("layout");
  });
});

describe("the journey and its sheets", () => {
  it("shows four steps with the first current, and names the next move", () => {
    renderHud();
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"), (step) => [step.dataset["step"], step.dataset["state"]]);
    expect(steps).toEqual([["event", "current"], ["layout", "ahead"], ["finishing", "ahead"], ["send", "ahead"]]);
    expect(screen.getByRole("button", { name: /^Next:\s*say how many guests are coming/u })).toBeTruthy();
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
    // The same tables in their own white cloth. The pieces are the same in number, so the stations
    // read their new places once the hand rests (hud-facts.tsx), not on the instant.
    setPlaced(rounds(3));
    expect(stepKey("finishing").getAttribute("data-state")).toBe("current");
    await waitFor(() => { expect(stepKey("finishing").getAttribute("data-state")).toBe("done"); });
    expect(stepKey("send").getAttribute("data-state")).toBe("current");
    expect(screen.getByRole("button", { name: /^Next:\s*send it to the events team/u })).toBeTruthy();
  });

  it("asks to seat the guests still without a seat", () => {
    renderHud();
    setGuests(50);
    setPlaced(rounds(2));
    expect(screen.getByRole("button", { name: /^Next:\s*seat 30 more guests/u })).toBeTruthy();
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

  it("opens Your event from the next-move line while no guest count is known", () => {
    renderHud();
    fireEvent.click(screen.getByRole("button", { name: /^Next:/u }));
    expect(usePlannerHudStore.getState().sheet).toBe("event");
  });

  it("takes a guest count from the Your event sheet, which the seat line then reads", () => {
    renderHud();
    fireEvent.click(stepKey("event"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "80" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(80);
    expect(seatLine().textContent).toContain("0 of 80 seated");
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

describe("the piece card", () => {
  function chooseTable(): string {
    const table = tables()[0];
    if (table === undefined) throw new Error("no table placed");
    act(() => { useSelectionStore.getState().selectMultiple([table.id]); });
    return table.id;
  }

  it("is not on screen until something is chosen, and leaves when it is let go", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    expect(document.querySelector(".hud-piece")).toBeNull();
    chooseTable();
    expect(document.querySelector(".hud-piece")).not.toBeNull();
    act(() => { useSelectionStore.getState().clearSelection(); });
    expect(document.querySelector(".hud-piece")).toBeNull();
  });

  it("names a chosen round by its seats and says how many it has", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(screen.getByRole("heading", { name: /Round of 8/u })).toBeTruthy();
    const stepper = screen.getByRole("group", { name: "Seats at this table" });
    expect(within(stepper).getByText("8 seats")).toBeTruthy();
  });

  it("adds a seat with its plus key and takes one away with its minus key", () => {
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

  it("offers no swatches for a table whose cloth is its own", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    chooseTable();
    expect(screen.queryByRole("radiogroup", { name: "The cloth on this table" })).toBeNull();
  });

  it("dresses the chosen table from its swatches", () => {
    renderHud();
    setPlaced(rounds(1, 8, "bare"));
    chooseTable();
    const cloths = screen.getByRole("radiogroup", { name: "The cloth on this table" });
    expect(within(cloths).getByRole("radio", { name: "No cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "Black cloth" }));
    expect(tables()[0]?.clothed).toBe(true);
    expect(tables()[0]?.clothStyle).toBe("black");
    expect(within(cloths).getByRole("radio", { name: "Black cloth" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(cloths).getByRole("radio", { name: "No cloth" }));
    expect(tables()[0]?.clothed).toBe(false);
  });

  it("puts the chosen table and its chairs back, and goes", () => {
    renderHud();
    setPlaced(rounds(2, 8));
    chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(tables()).toHaveLength(1);
    expect(chairs()).toHaveLength(8);
    expect(document.querySelector(".hud-piece")).toBeNull();
  });

  it("copies the chosen table with its chairs and chooses the copy", () => {
    renderHud();
    setPlaced(rounds(1, 8));
    const original = chooseTable();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(tables()).toHaveLength(2);
    expect(chairs()).toHaveLength(16);
    expect(useSelectionStore.getState().selectedIds.has(original)).toBe(false);
  });
});

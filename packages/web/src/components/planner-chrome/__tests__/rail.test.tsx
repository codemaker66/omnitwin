import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rail } from "../Rail.js";
import { armOrCancel } from "../card-keys.js";
import { cardNeeds, type UsableStock } from "../../../lib/card-stock.js";
import { cardParamsFor } from "../../../lib/setup-cards.js";
import { useCardsStore } from "../../../stores/cards-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRailDropStore } from "../../../stores/rail-drop-store.js";

// ---------------------------------------------------------------------------
// The rail (T-671 slice 12′; card-dock spec §3, §4, §7.1, §12; Q-13): eight
// named mini-cards and More at rest, armed by a click or by keys 1–8, the
// card again (or its digit) cancelling; never opening anything on hover; the
// hint on a card's first three arms; hidden in Walk; and its place published
// for putting a piece back.
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  useCardsStore.getState().reset();
  useCatalogueStore.getState().disarm();
  useCockpitStore.getState().setWalkMode(false);
  usePlacementStore.getState().clearAll();
  useRailDropStore.getState().reset();
});
afterEach(cleanup);

function rail(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Furniture cards" });
}

describe("at rest", () => {
  it("shows the eight cards with their names and seats, and More", () => {
    render(<Rail />);
    const cards = within(rail()).getAllByRole("button", { pressed: false });
    expect(cards.map((card) => card.querySelector(".pc-railcard__name")?.textContent)).toEqual([
      "Round of 10", "Top table", "Long table", "Dance floor", "Stage", "Bar", "Poseur", "Cake table",
    ]);
    expect(cards[0]?.textContent).toContain("10 seats");
    expect(within(rail()).getByRole("button", { name: /^More/u })).toBeTruthy();
  });

  it("opens nothing on hover", () => {
    render(<Rail />);
    fireEvent.pointerEnter(within(rail()).getAllByRole("button")[0] as HTMLElement, { pointerType: "mouse" });
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });
});

describe("arming", () => {
  it("arms on a click, says so, shows the hint for the first arms, and cancels on the card again", () => {
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
    expect(round.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Click the floor to set it down");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });

  it("arms on keys 1 to 8, the same digit cancelling", () => {
    render(<Rail />);
    fireEvent.keyDown(window, { key: "4", code: "Digit4" });
    expect(useCatalogueStore.getState().armedCardId).toBe("dance-floor");
    fireEvent.keyDown(window, { key: "4", code: "Digit4" });
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
  });

  it("opens the catalogue from More, and More again closes it", () => {
    render(<Rail />);
    const more = within(rail()).getByRole("button", { name: /^More/u });
    fireEvent.click(more);
    expect(useCardsStore.getState().catalogueOpen).toBe(true);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(more);
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
  });
});

describe("where it shows", () => {
  it("steps aside in Walk", () => {
    render(<Rail />);
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    expect(screen.queryByRole("toolbar", { name: "Furniture cards" })).toBeNull();
  });

  it("publishes its place for putting a piece back, and forgets it when it goes", () => {
    const { unmount } = render(<Rail />);
    expect(useRailDropStore.getState().rect).not.toBeNull();
    unmount();
    expect(useRailDropStore.getState().rect).toBeNull();
  });
});

describe("a card in flight", () => {
  it("is put down silently when released over the rail", () => {
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    fireEvent.pointerDown(round, { pointerId: 1, button: 0, clientX: 300, clientY: 900, pointerType: "mouse" });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 900, pointerType: "mouse" });
    expect(useCatalogueStore.getState().dragActive).toBe(true);
    expect(useCardsStore.getState().inFlight).toBe("round");
    fireEvent.pointerUp(rail(), { pointerId: 1, button: 0, clientX: 320, clientY: 900, pointerType: "mouse" });
    expect(useCatalogueStore.getState().dragActive).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(useCardsStore.getState().inFlight).toBeNull();
  });
});

describe("the store (staff; Blake's B2, hard)", () => {
  function stockOf(card: "round" | "dance-floor", whole: number): UsableStock {
    const params = cardParamsFor(card, {});
    if (params === null) throw new Error(`no ${card} card`);
    return new Map([...cardNeeds(params)].map(([id, need]) => [id, need * whole]));
  }

  it("shows nothing to anyone without stock", () => {
    render(<Rail />);
    expect(rail().textContent).not.toContain("in store");
  });

  it("puts \"×22 in store\" under a card's seats, and says it", () => {
    useCardsStore.getState().setStock(stockOf("round", 22));
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    expect(round.querySelector(".pc-railcard__store")?.textContent).toBe("×22 in store");
    expect(round.getAttribute("aria-label")).toContain("22 in store");
  });

  it("will not arm a card the store has none left of, by click or digit, and says why", () => {
    useCardsStore.getState().setStock(stockOf("round", 0));
    render(<Rail />);
    const round = within(rail()).getByRole("button", { name: /^Round of 10/u });
    expect(round.classList.contains("is-empty")).toBe(true);
    expect(round.querySelector(".pc-railcard__store")?.textContent).toBe("None left");
    expect(round.getAttribute("aria-label")).toContain("none left in store");
    expect(round.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(round);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("None left in store");
    expect(armOrCancel("round")).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
  });
});

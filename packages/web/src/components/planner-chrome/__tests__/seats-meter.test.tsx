import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeatsMeter } from "../SeatsMeter.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// The seats meter (T-671; card-dock spec §9, Q-17): a 3 px bar between the
// rail and the dock. Copper fills with seats over guests, a sage tick when
// everyone has a seat, the part past the room's published seats in the
// attention colour, a card's seats in hand as a cream segment. No digits;
// hidden from assistive technology (the plane says it in words).
// ---------------------------------------------------------------------------

beforeEach(() => {
  useCatalogueStore.getState().disarm();
  usePlannerChromeStore.getState().setFigures(null);
});
afterEach(cleanup);

function meter(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".pc-meter");
  if (element === null) throw new Error("no meter");
  return element;
}

describe("the seats meter", () => {
  it("is nothing until the plane has figures, and never speaks", () => {
    const { container } = render(<SeatsMeter />);
    expect(container.querySelector(".pc-meter")).toBeNull();
    act(() => { usePlannerChromeStore.getState().setFigures({ guests: 100, seats: 80, limit: 180 }); });
    expect(meter(container).getAttribute("aria-hidden")).toBe("true");
    expect(meter(container).textContent).toBe("");
  });

  it("fills with seats over guests and ticks when everyone has a seat", () => {
    usePlannerChromeStore.getState().setFigures({ guests: 100, seats: 80, limit: 180 });
    const { container } = render(<SeatsMeter />);
    expect(meter(container).style.getPropertyValue("--pc-meter-target")).toBe("0.8");
    expect(meter(container).classList.contains("is-full")).toBe(false);
    act(() => { usePlannerChromeStore.getState().setFigures({ guests: 80, seats: 80, limit: 180 }); });
    expect(meter(container).classList.contains("is-full")).toBe(true);
  });

  it("shows the card in hand's seats, and the part past the room's seats", () => {
    usePlannerChromeStore.getState().setFigures({ guests: 100, seats: 80, limit: 85 });
    const { container } = render(<SeatsMeter />);
    act(() => { useCatalogueStore.getState().armCard("round"); });
    expect(meter(container).style.getPropertyValue("--pc-meter-hand")).toBe("0.9");
    expect(meter(container).style.getPropertyValue("--pc-meter-over")).toBe("0.85");
  });
});

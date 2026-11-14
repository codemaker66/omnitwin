import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import {
  activeFurnitureSettleCount,
  clearAllFurnitureSettles,
  subscribeFurnitureLandings,
  type FurnitureLanding,
} from "../../../lib/furniture-motion.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FurnitureMotion } from "../FurnitureMotion.js";

// A newly placed piece is set down onto the floor, and the landing seam hears
// it start down and touch down. Under reduced motion nothing comes down, so
// the piece is announced as landed where it stands (T-700, ruling R84).

interface Heard {
  readonly callback: "pickedUp" | "dropStarted" | "touchedDown" | "landedInPlace";
  readonly id: string;
  readonly landing: FurnitureLanding | null;
  readonly handSpeed: number | null;
  /** The frame loop's frames drawn when it was heard. */
  readonly frame: number;
}

let reduced = false;
let mounted: StubRoot | null = null;
let heard: Heard[] = [];
let frames = 0;
let stopHearing: () => void = () => undefined;

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

beforeEach(() => {
  reduced = false;
  heard = [];
  frames = 0;
  clearAllFurnitureSettles();
  usePlacementStore.setState({ placedItems: [] });
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: reduced && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  stopHearing = subscribeFurnitureLandings({
    pickedUp: (id) => { heard.push({ callback: "pickedUp", id, landing: null, handSpeed: null, frame: frames }); },
    dropStarted: (id, landing, handSpeed) => { heard.push({ callback: "dropStarted", id, landing, handSpeed, frame: frames }); },
    touchedDown: (id, landing, _contactSpeed, handSpeed) => { heard.push({ callback: "touchedDown", id, landing, handSpeed, frame: frames }); },
    landedInPlace: (id, landing, handSpeed) => { heard.push({ callback: "landedInPlace", id, landing, handSpeed, frame: frames }); },
  });
});

afterEach(() => {
  stopHearing();
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
  clearAllFurnitureSettles();
  vi.restoreAllMocks();
});

/** Mounts the motion, lets the frame loop draw and sleep, places a chair and returns its id. */
function placeChair(): { readonly id: string; readonly frame: () => void } {
  mounted = mountInStubRoot(<FurnitureMotion />);
  let seconds = 100;
  const frame = (): void => { frames += 1; act(() => { advance(seconds, true); }); seconds += 1 / 60; };
  frame();
  frame();
  frames = 0;
  act(() => { usePlacementStore.getState().placeItem(catalogueId("banquet-chair"), 2, 1); });
  const placed = usePlacementStore.getState().placedItems.at(-1);
  if (placed === undefined) throw new Error("The chair was not placed");
  return { id: placed.id, frame };
}

describe("FurnitureMotion's landings", () => {
  it("announces a placed piece landed in place under reduced motion, with nothing starting down", () => {
    reduced = true;
    const { id, frame } = placeChair();
    expect(heard).toEqual([{ callback: "landedInPlace", id, landing: "drop-in", handSpeed: 0, frame: 0 }]);
    expect(activeFurnitureSettleCount()).toBe(0);
    for (let i = 0; i < 20; i++) frame();
    expect(heard).toHaveLength(1);
  });

  it("starts a placed piece down at once and hears it touch down on the frame loop's fifth frame", () => {
    const { id, frame } = placeChair();
    expect(heard).toEqual([{ callback: "dropStarted", id, landing: "drop-in", handSpeed: 0, frame: 0 }]);
    for (let i = 0; i < 40; i++) frame();
    expect(heard.filter((entry) => entry.callback === "touchedDown")).toEqual([
      { callback: "touchedDown", id, landing: "drop-in", handSpeed: 0, frame: 5 },
    ]);
    expect(heard.some((entry) => entry.callback === "landedInPlace")).toBe(false);
  });
});

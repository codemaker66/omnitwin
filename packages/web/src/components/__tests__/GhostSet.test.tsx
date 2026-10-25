import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { createGhostWorld, judgeGhost } from "../../lib/ghost-truth.js";
import { judgeCardAt, placeCardAt } from "../../lib/place-in-hand.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { cardParamsFor, stampSetup, type CardParams } from "../../lib/setup-cards.js";
import { useGhostVerdictStore } from "../../stores/ghost-verdict-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { GhostSet, ghostTag } from "../GhostSet.js";

// The frame loop is driven by hand; the set's words are drei's Html, drawn here in the page.
const frames = vi.hoisted(() => ({ latest: null as (() => void) | null }));
const canvas = vi.hoisted(() => ({ element: null as HTMLCanvasElement | null }));
// One three state for the whole render, as R3F gives: a stable invalidate and canvas.
const three = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@react-three/fiber", () => ({
  useThree: () => three.state,
  useFrame: (callback: () => void) => { frames.latest = callback; },
}));
vi.mock("@react-three/drei", () => ({ Html: ({ children }: { readonly children: ReactNode }) => <>{children}</> }));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => null }));
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => null }));

/** A 6 ft round's outermost chair reach along Z: its ring radius and half a chair's depth. */
const CHAIR_REACH = 0.915 + 0.05 + 0.58;

function round(): CardParams {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return params;
}

function ghostAt(z: number): void {
  act(() => {
    usePlacementStore.setState({ ghostPosition: [0, 0, z], ghostRotation: 0 });
    frames.latest?.();
  });
}

function words(): HTMLElement {
  return screen.getByTestId("ghost-set-words");
}

beforeEach(() => {
  frames.latest = null;
  canvas.element = document.createElement("canvas");
  three.state = { camera: { position: { x: 0, y: 0, z: 0 }, getWorldDirection: vi.fn() }, gl: { domElement: canvas.element }, invalidate: vi.fn() };
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null });
  useGhostVerdictStore.getState().setVerdict(null);
  setPlannerFeaturesForTesting({ setupCards: true, truthfulGhost: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setPlannerFeaturesForTesting(null);
});

describe("the truthful ghost's set", () => {
  it("tags a Round of 10 that fits with its seats", () => {
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(0);
    expect(words().dataset.state).toBe("fits");
    expect(words().textContent).toBe("Round of 10 · +10 seats ✓ fits");
  });

  it("says how far it moved a set it pushes clear", () => {
    usePlacementStore.setState({ placedItems: stampSetup(round(), { x: 0, z: 0 }, 0) });
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(2 * CHAIR_REACH - 0.1);
    expect(words().dataset.state).toBe("pushed");
    expect(words().textContent).toMatch(/^Round of 10 · \+10 seats ✓ fits · moved 0\.1\d m$/u);
    expect(useGhostVerdictStore.getState().verdict?.state).toBe("pushed");
  });

  it("refuses a set in another at once, names the obstacle after 80 ms, and outlines it", () => {
    vi.useFakeTimers();
    const placed = stampSetup(round(), { x: 0, z: 0 }, 0);
    usePlacementStore.setState({ placedItems: placed });
    const { container } = render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(CHAIR_REACH);
    expect(words().dataset.state).toBe("refused");
    expect(words().textContent).toBe("Round of 10 · +10 seats · won't fit");
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(screen.queryByTestId("ghost-set-chip")).toBeNull();
    expect(canvas.element?.style.cursor).toBe("not-allowed");
    act(() => { vi.advanceTimersByTime(80); });
    const chip = screen.getByRole("alert");
    expect(chip.textContent).toMatch(/^Won't fit · would overlap the round/u);
    expect(chip.textContent).toContain("Move it clear to set it down");
    expect(container.querySelector("[name='ghost-blocking-outlines']")).not.toBeNull();
  });

  it("tells a card dragged out that letting go puts it back", () => {
    vi.useFakeTimers();
    usePlacementStore.setState({ placedItems: stampSetup(round(), { x: 0, z: 0 }, 0) });
    render(<GhostSet params={round()} warming={false} fromCardDrag />);
    ghostAt(CHAIR_REACH);
    act(() => { vi.advanceTimersByTime(80); });
    expect(screen.getByRole("alert").textContent).toContain("Let go and it goes back to the card");
  });

  it("never sets down what it showed refused: the commit keeps the ghost's hysteresis", () => {
    const placed = stampSetup(round(), { x: 0, z: 0 }, 0);
    usePlacementStore.setState({ placedItems: placed });
    const world = createGhostWorld(placed, GRAND_HALL_RENDER_DIMENSIONS);
    // Find where a fresh judge pushes the set clear but one coming from a refusal still refuses it.
    const band = Array.from({ length: 40 }, (_, i) => 2 * CHAIR_REACH - 0.11 - i * 0.001).find((z) => {
      const stamp = stampSetup(round(), { x: 0, z }, 0);
      return judgeGhost(stamp, world).state === "pushed" && judgeGhost(stamp, world, { previous: "refused" }).state === "refused";
    });
    expect(band).toBeDefined();
    if (band === undefined) return;
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(CHAIR_REACH);
    ghostAt(band);
    expect(words().dataset.state).toBe("refused");
    expect(placeCardAt(round(), { x: 0, z: band }, 0)).toEqual([]);
    expect(usePlacementStore.getState().placedItems).toBe(placed);
  });
});

describe("the ghost as the commit sees it", () => {
  it("judges the set turned as the piece in hand is turned, as the commit will", () => {
    const placed = stampSetup(round(), { x: 0, z: 0 }, 0);
    usePlacementStore.setState({ placedItems: placed });
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    const z = 2 * CHAIR_REACH - 0.1;
    act(() => {
      usePlacementStore.setState({ ghostPosition: [0.4, 0, z], ghostRotation: 0.3 });
      frames.latest?.();
    });
    const world = createGhostWorld(placed, GRAND_HALL_RENDER_DIMENSIONS);
    expect(useGhostVerdictStore.getState().verdict).toEqual(judgeCardAt(round(), { x: 0.4, z, y: 0 }, 0.3, world, undefined).verdict);
    expect(useGhostVerdictStore.getState().verdict).not.toEqual(judgeCardAt(round(), { x: 0.4, z, y: 0 }, 0, world, undefined).verdict);
  });

  it("forgets its verdict when the ghost goes, so the next attempt starts fresh", () => {
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(0);
    expect(useGhostVerdictStore.getState().verdict?.state).toBe("fits");
    act(() => {
      usePlacementStore.setState({ ghostPosition: null });
      frames.latest?.();
    });
    expect(useGhostVerdictStore.getState().verdict).toBeNull();
  });

  it("announces a refusal once per attempt, however its words change, and again after it fits", () => {
    vi.useFakeTimers();
    usePlacementStore.setState({ placedItems: stampSetup(round(), { x: 0, z: 0 }, 0) });
    render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(CHAIR_REACH);
    act(() => { vi.advanceTimersByTime(80); });
    const first = screen.getByRole("alert").textContent;
    expect(first).toMatch(/^Won't fit/u);
    // Further into the same refusal: the chip may change in place, the announcement does not repeat.
    ghostAt(CHAIR_REACH - 0.3);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("alert").textContent).toBe(first);
    ghostAt(-3.5);
    expect(words().dataset.state).toBe("fits");
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(canvas.element?.style.cursor).toBe("crosshair");
    ghostAt(CHAIR_REACH);
    act(() => { vi.advanceTimersByTime(80); });
    expect(screen.getByRole("alert").textContent).toBe(first);
  });

  it("leaves the cursor alone when it goes mid-refusal, after the hand has given it back", () => {
    usePlacementStore.setState({ placedItems: stampSetup(round(), { x: 0, z: 0 }, 0) });
    const { unmount } = render(<GhostSet params={round()} warming={false} fromCardDrag={false} />);
    ghostAt(CHAIR_REACH);
    expect(canvas.element?.style.cursor).toBe("not-allowed");
    // PlacementGhost's own cleanup runs first as the card is put down.
    if (canvas.element !== null) canvas.element.style.cursor = "";
    unmount();
    expect(canvas.element?.style.cursor).toBe("");
  });
});

describe("the ghost's tag", () => {
  it("gives a dance floor its size, with no seats", () => {
    const floor = cardParamsFor("dance-floor");
    if (floor === null) throw new Error("no dance floor");
    expect(ghostTag(floor, null)).toBe("Dance floor · 4.6 m square");
  });
});

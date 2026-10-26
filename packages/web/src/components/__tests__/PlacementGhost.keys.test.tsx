import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene } from "three";
import { PlacementGhost } from "../PlacementGhost.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { lastAnnouncement } from "../../lib/planner-announcer.js";
import { PLANNER_INTERACTION_FLOOR_NAME } from "../../lib/planner-interaction-floor.js";
import { GHOST_WORDS_DELAY_MS, resetEditingMemoryForTesting, selectionKeyBindings, usePlannerToolKeys } from "../../lib/planner-keymap.js";
import { registerKeyBindings } from "../../lib/planner-keys.js";
import { resetPlacedIdCounter, type PlacedItem } from "../../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { cardParamsFor, stampSetup } from "../../lib/setup-cards.js";

// ---------------------------------------------------------------------------
// Placing by keyboard (approved spec §11, §12; QoL B-06) through the ghost
// itself: a card put in hand off the canvas shows its ghost at the middle of
// the visible floor at once; + and − step it, the arrows move it and Enter
// sets it down through the click's own commit, kept in hand; Esc puts it down.
// ---------------------------------------------------------------------------

const graphics = vi.hoisted(() => ({ get: vi.fn<() => {
  scene: Scene;
  camera: PerspectiveCamera;
  raycaster: Raycaster;
  gl: { domElement: HTMLCanvasElement };
  invalidate: () => void;
}>() }));
// The frame loop is driven by hand: moves are followed once a frame.
const frames = vi.hoisted(() => ({ latest: null as (() => void) | null }));
vi.mock("@react-three/fiber", () => ({
  useThree: () => graphics.get(),
  useFrame: (callback: () => void) => { frames.latest = callback; },
}));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => null }));
vi.mock("../GhostSet.js", () => ({ GhostSet: () => null }));
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => null }));

function runFrame(): void {
  act(() => { frames.latest?.(); });
}

const CODES: Readonly<Record<string, string>> = { "+": "Equal", "-": "Minus" };

/** A press as a browser sends it, from `target`: the page, unless a field has focus. */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, code: CODES[key] ?? key, shiftKey: key === "+", bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

function ToolKeys(): null {
  usePlannerToolKeys();
  return null;
}

let canvas: HTMLCanvasElement;
let floor: Mesh<PlaneGeometry, MeshBasicMaterial>;
const pointDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

function ghost(): readonly [number, number, number] | null {
  return usePlacementStore.getState().ghostPosition;
}

function placed(): readonly PlacedItem[] {
  return usePlacementStore.getState().placedItems;
}

function ofCategory(category: string): readonly PlacedItem[] {
  return placed().filter((piece) => getCatalogueItem(piece.catalogueItemId)?.category === category);
}

function seatsInHand(): number | null {
  const params = useCatalogueStore.getState().cardParams;
  return params?.card === "round" ? params.seats : null;
}

/** The pointer resting on the canvas as the piece is put in hand. */
function pointerRestsOnCanvas(): void {
  const matches = canvas.matches.bind(canvas);
  vi.spyOn(canvas, "matches").mockImplementation((selector: string) => selector === ":hover" || matches(selector));
}

function mount(): void {
  render(<><PlacementGhost /><ToolKeys /></>);
}

beforeEach(() => {
  frames.latest = null;
  resetPlacedIdCounter();
  resetEditingMemoryForTesting();
  useTouchGestureStore.getState().end(-Infinity);
  useLayoutTimelinePreviewStore.getState().clear();
  useSelectionStore.setState({ selectedIds: new Set() });
  useCatalogueStore.getState().clearSelection();
  // The seats last chosen at a round are remembered for the session; each test starts at the card's own.
  useCatalogueStore.setState({ rememberedSeats: {} });
  document.getElementById("planner-announcer")?.remove();
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
  usePlacementNoticeStore.getState().dismiss();
  setPlannerFeaturesForTesting({ tableNumbers: true });
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => canvas) });
  const scene = new Scene();
  floor = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ side: DoubleSide }));
  floor.name = PLANNER_INTERACTION_FLOOR_NAME;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.updateMatrixWorld(true);
  // Looking down at the room's middle from the south: Up on the arrows is north (−z), Right is east (+x).
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 4, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  graphics.get.mockReturnValue({ scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate: vi.fn() });
});

afterEach(() => {
  cleanup(); canvas.remove(); floor.geometry.dispose(); floor.material.dispose();
  if (pointDescriptor === undefined) Reflect.deleteProperty(document, "elementFromPoint");
  else Object.defineProperty(document, "elementFromPoint", pointDescriptor);
  setPlannerFeaturesForTesting(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("placing by keyboard", () => {
  it("walk: armed off the canvas, +, +, arrows, Enter, Esc sets down one round with 12 chairs in one step", () => {
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    // Shown at once, at the middle of the visible floor, with no pointer move.
    expect(ghost()?.[0]).toBeCloseTo(0, 6);
    expect(ghost()?.[2]).toBeCloseTo(0, 6);

    press("+");
    press("+");
    expect(seatsInHand()).toBe(12);
    expect(lastAnnouncement()).toBe("Round of 12, 12 seats");

    for (let i = 0; i < 3; i += 1) press("ArrowRight");
    press("ArrowRight", { shiftKey: true });
    press("ArrowUp");
    press("ArrowLeft", { altKey: true });
    expect(ghost()?.[0]).toBeCloseTo(1.29, 9);
    expect(ghost()?.[2]).toBeCloseTo(-0.1, 9);

    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    expect(press("Enter").defaultPrevented).toBe(true);
    unsubscribe();
    expect(writes).toBe(1);
    expect(ofCategory("table")).toHaveLength(1);
    expect(ofCategory("chair")).toHaveLength(12);
    expect(ofCategory("table")[0]?.x).toBeCloseTo(1.29, 9);
    expect(ofCategory("table")[0]?.z).toBeCloseTo(-0.1, 9);
    expect(lastAnnouncement()).toBe("Placed Table 1, Round of 12, 12 seats");
    // Kept in hand for the next.
    expect(useCatalogueStore.getState().armedCardId).toBe("round");

    press("Escape");
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(ghost()).toBeNull();
    expect(placed()).toHaveLength(13);
  });

  it("refuses where the set won't fit, says why, and sets nothing down", () => {
    const params = cardParamsFor("round");
    if (params === null) throw new Error("no round");
    usePlacementStore.getState().placeSetup(stampSetup(params, { x: 0, z: 0 }, 0));
    const before = placed();
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    expect(ghost()).not.toBeNull();
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(placed()).toBe(before);
    expect(usePlacementNoticeStore.getState().notice?.text).toMatch(/^Won't fit · would overlap Table 1/u);
    expect(lastAnnouncement()).not.toMatch(/^Placed/u);
  });

  it("does nothing on Enter with nothing in hand", () => {
    mount();
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(placed()).toHaveLength(0);
    expect(ghost()).toBeNull();
  });

  it("leaves the keys to a field being typed in", () => {
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    const at = ghost();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    try {
      for (const key of ["+", "ArrowRight", "Enter"]) expect(press(key, {}, field).defaultPrevented).toBe(false);
      expect(seatsInHand()).toBe(10);
      expect(ghost()).toBe(at);
      expect(placed()).toHaveLength(0);
    } finally {
      field.remove();
    }
  });

  it("says the card's limit at the end of its seats, and leaves it there", () => {
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    for (let i = 0; i < 3; i += 1) press("+");
    expect(seatsInHand()).toBe(12);
    expect(lastAnnouncement()).toBe("Round of 12, 12 seats, no more seats");
    press("-");
    expect(lastAnnouncement()).toBe("Round of 11, 11 seats");
  });

  it("says where the ghost stands once the arrows stop", () => {
    vi.useFakeTimers();
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    press("ArrowRight");
    press("ArrowRight");
    expect(lastAnnouncement()).not.toMatch(/fits/u);
    vi.advanceTimersByTime(GHOST_WORDS_DELAY_MS);
    expect(lastAnnouncement()).toBe("Round of 10, 10 seats, fits");
  });
});

describe("the ghost of a piece put in hand", () => {
  it("waits for a pointer resting on the canvas, and the first arrow shows it at the middle of the floor without moving it", () => {
    pointerRestsOnCanvas();
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    expect(ghost()).toBeNull();
    press("ArrowRight");
    expect(ghost()?.[0]).toBeCloseTo(0, 6);
    expect(ghost()?.[2]).toBeCloseTo(0, 6);
  });

  it("is shown by an Enter with no ghost yet, and set down by the next, never unseen", () => {
    pointerRestsOnCanvas();
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    press("Enter");
    expect(ghost()).not.toBeNull();
    expect(placed()).toHaveLength(0);
    expect(lastAnnouncement()).toBe("Round of 10, 10 seats, fits");
    press("Enter");
    expect(ofCategory("table")).toHaveLength(1);
  });

  it("takes + from a selection held under a piece in hand with nothing to step", () => {
    const params = cardParamsFor("round");
    const lectern = getCatalogueItemBySlug("lectern");
    if (params === null || lectern === undefined) throw new Error("no round or lectern");
    usePlacementStore.getState().placeSetup(stampSetup(params, { x: 3, z: 3 }, 0));
    const table = ofCategory("table")[0];
    useSelectionStore.getState().select(table?.id ?? "");
    const before = placed();
    mount();
    const unregister = registerKeyBindings(selectionKeyBindings({ invalidate: () => undefined, cancelGesture: () => undefined, screenUp: () => ({ x: 0, z: -1 }) }));
    try {
      act(() => { useCatalogueStore.getState().selectItem(lectern.id); });
      expect(press("+").defaultPrevented).toBe(true);
      expect(placed()).toBe(before);
    } finally {
      unregister();
    }
  });

  it("comes with a drag from the rail, not the middle of the floor, and the arrows leave it to the pointer", () => {
    mount();
    act(() => { useCatalogueStore.getState().startCardDrag("round"); });
    expect(ghost()).toBeNull();
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(ghost()).toBeNull();
  });

  it("stands where the keys left the last card's when another card takes its place in hand", () => {
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    press("ArrowRight", { shiftKey: true });
    press("ArrowUp", { shiftKey: true });
    act(() => { useCatalogueStore.getState().armCard("dance-floor"); });
    expect(ghost()?.[0]).toBeCloseTo(1, 9);
    expect(ghost()?.[2]).toBeCloseTo(-1, 9);
  });

  it("stays where the keys left it through a move that goes nowhere, and follows the pointer's next real move", () => {
    pointerRestsOnCanvas();
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    act(() => { fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50 }); });
    runFrame();
    press("ArrowRight", { shiftKey: true });
    expect(ghost()?.[0]).toBeCloseTo(1, 9);
    act(() => { fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50 }); });
    runFrame();
    expect(ghost()?.[0]).toBeCloseTo(1, 9);
    act(() => { fireEvent.pointerMove(canvas, { clientX: 30, clientY: 50 }); });
    runFrame();
    expect(ghost()?.[0]).toBeLessThan(0);
  });

  it("moves a piece set down alone a whole grid square a press, the square its commit snaps to, and says so", () => {
    vi.useFakeTimers();
    const poseur = getCatalogueItemBySlug("poseur-table");
    if (poseur === undefined) throw new Error("no poseur");
    mount();
    act(() => { useCatalogueStore.getState().selectItem(poseur.id); });
    expect(ghost()?.[0]).toBeCloseTo(0, 9);
    press("ArrowRight");
    expect(ghost()?.[0]).toBeCloseTo(1, 9);
    // Even a fine step moves a square: a smaller one would show and place nothing.
    press("ArrowRight", { altKey: true });
    expect(ghost()?.[0]).toBeCloseTo(2, 9);
    act(() => { vi.advanceTimersByTime(GHOST_WORDS_DELAY_MS); });
    expect(lastAnnouncement()).toBe(`${poseur.name}, fits`);
    press("Enter");
    expect(placed()[0]?.x).toBeCloseTo(2, 9);
  });

  it("takes Enter from the control that holds the piece in hand, and leaves every other control its own", () => {
    mount();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    const other = document.createElement("button");
    const holder = document.createElement("button");
    holder.setAttribute("data-holds-piece", "true");
    document.body.append(other, holder);
    try {
      expect(press("Enter", {}, other).defaultPrevented).toBe(false);
      expect(ofCategory("table")).toHaveLength(0);
      expect(press("Enter", {}, holder).defaultPrevented).toBe(true);
      expect(ofCategory("table")).toHaveLength(1);
    } finally {
      other.remove();
      holder.remove();
    }
  });

  it("makes its live region when it mounts, before the first key needs it", () => {
    expect(document.getElementById("planner-announcer")).toBeNull();
    mount();
    expect(document.getElementById("planner-announcer")).not.toBeNull();
  });
});

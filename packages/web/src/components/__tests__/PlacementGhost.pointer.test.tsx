import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene } from "three";
import { PlacementGhost } from "../PlacementGhost.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { PLANNER_INTERACTION_FLOOR_NAME, placementFloorPoint } from "../../lib/planner-interaction-floor.js";
import { drawnDanceFloor } from "../../lib/setup-cards.js";
import { ghostRaisePx } from "../../lib/touch-arbiter.js";
import { createPlacedItem } from "../../lib/placement.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { noteMainDraw } from "../../lib/main-draw-clock.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";

const graphics = vi.hoisted(() => ({ get: vi.fn<() => {
  scene: Scene;
  camera: PerspectiveCamera;
  raycaster: Raycaster;
  gl: { domElement: HTMLCanvasElement };
  invalidate: () => void;
}>() }));
// The frame loop is driven by hand: moves are followed once a frame.
const frames = vi.hoisted(() => ({ latest: null as (() => void) | null }));
const proxy = vi.hoisted(() => ({ renders: 0 }));
vi.mock("@react-three/fiber", () => ({
  useThree: () => graphics.get(),
  useFrame: (callback: () => void) => { frames.latest = callback; },
}));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => { proxy.renders += 1; return null; } }));
// The set's ghost has its own tests (GhostSet.test.tsx); here, which set it is asked to show, and its warm-up.
const ghostSet = vi.hoisted(() => ({ card: null as string | null, warming: false, groupRef: null as ((group: Group | null) => void) | null }));
vi.mock("../GhostSet.js", () => ({
  GhostSet: ({ params, warming, groupRef }: {
    readonly params: { readonly card: string };
    readonly warming: boolean;
    readonly groupRef?: (group: Group | null) => void;
  }) => {
    ghostSet.card = params.card;
    ghostSet.warming = warming;
    ghostSet.groupRef = groupRef ?? null;
    return null;
  },
}));

function runFrame(): void {
  act(() => { frames.latest?.(); });
}
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => null }));

let canvas: HTMLCanvasElement;
let scene: Scene;
let target: Mesh<PlaneGeometry, MeshBasicMaterial>;
const pointDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const item = getCatalogueItemBySlug("poseur-table");
if (item === undefined) throw new Error("Poseur fixture missing");
const itemId = item.id;

beforeEach(() => {
  frames.latest = null;
  proxy.renders = 0;
  useTouchGestureStore.getState().end(-Infinity);
  useChairDialogStore.getState().clearDialog();
  useLayoutTimelinePreviewStore.getState().clear();
  useSelectionStore.setState({ selectedIds: new Set() });
  useCatalogueStore.setState({ selectedItemId: itemId, dragActive: false });
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null });
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => canvas) });
  scene = new Scene();
  target = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ side: DoubleSide }));
  target.name = PLANNER_INTERACTION_FLOOR_NAME;
  target.visible = false;
  target.rotation.x = -Math.PI / 2;
  scene.add(target);
  scene.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 4, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  graphics.get.mockReturnValue({ scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate: vi.fn() });
});

afterEach(() => {
  cleanup(); canvas.remove(); target.geometry.dispose(); target.material.dispose();
  if (pointDescriptor === undefined) Reflect.deleteProperty(document, "elementFromPoint");
  else Object.defineProperty(document, "elementFromPoint", pointDescriptor);
  vi.restoreAllMocks();
});

it("places from a direct click without requiring an earlier pointer move", () => {
  render(<PlacementGhost />);
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
  act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  expect(usePlacementStore.getState().placedItems[0]).toMatchObject({ catalogueItemId: itemId, x: 0, z: 0 });
});

it.each(["cake-cutting-table", "ceremony-table"])("places %s directly from a canvas click without requesting dining chairs", (slug) => {
  const serviceTable = getCatalogueItemBySlug(slug);
  if (serviceTable === undefined) throw new Error(`Missing ${slug}`);
  useCatalogueStore.setState({ selectedItemId: serviceTable.id });
  render(<PlacementGhost />);
  act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  expect(usePlacementStore.getState().placedItems[0]).toMatchObject({ catalogueItemId: serviceTable.id, x: 0, z: 0 });
  expect(useChairDialogStore.getState().pending).toBeNull();
});

it("says why a tap placed nothing once every piece the venue has is on the floor", () => {
  const platform = getCatalogueItemBySlug("platform-narrow");
  if (platform === undefined) throw new Error("Missing the narrow platform");
  usePlacementNoticeStore.getState().dismiss();
  useCatalogueStore.setState({ selectedItemId: platform.id });
  render(<PlacementGhost />);
  act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  expect(usePlacementNoticeStore.getState().notice).toBeNull();

  act(() => { fireEvent.click(canvas, { clientX: 60, clientY: 60, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(1);
  expect(usePlacementNoticeStore.getState().notice?.text)
    .toBe("The venue has one of these, and it is already placed; move it to use it elsewhere.");
  usePlacementNoticeStore.getState().dismiss();
});

it("sets a Round of 10 armed from v2's rail down whole, in one write, with no chair dialog, the switches as shipped (Q-07, Q-13)", () => {
  setPlannerFeaturesForTesting(null);
  ghostSet.card = null;
  try {
    act(() => { useCatalogueStore.getState().armCard("round"); });
    render(<PlacementGhost />);
    // The ghost is the set the click will set down.
    expect(ghostSet.card).toBe("round");
    let writes = 0;
    const unsubscribe = usePlacementStore.subscribe((state, previous) => { if (state.placedItems !== previous.placedItems) writes += 1; });
    act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    unsubscribe();
    expect(writes).toBe(1);
    expect(usePlacementStore.getState().placedItems).toHaveLength(11);
    expect(useChairDialogStore.getState().pending).toBeNull();
    // The card stays in hand for the next one.
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
  } finally {
    useCatalogueStore.getState().disarm();
  }
});

describe("a card's set warms as a piece does", () => {
  /** A Round of 10 armed, and the set's group as GhostSet would hand it over: one mesh, not yet shown. */
  function armedSet(): { readonly set: Group; readonly mesh: Mesh } {
    setPlannerFeaturesForTesting(null);
    act(() => { useCatalogueStore.getState().armCard("round"); });
    render(<PlacementGhost />);
    const set = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    set.add(mesh);
    set.visible = false;
    act(() => { ghostSet.groupRef?.(set); });
    return { set, mesh };
  }

  /** A frame update, and the main view's draw that follows it. */
  function frameAndDraw(): void {
    runFrame();
    act(() => { noteMainDraw(performance.now()); });
  }

  afterEach(() => { useCatalogueStore.getState().disarm(); });

  it("counts a warm frame only for a main-view draw that takes the set's meshes in", () => {
    const { set, mesh } = armedSet();
    expect(ghostSet.warming).toBe(true);
    // Draws before the commit that shows the set warm nothing: the warm-up waits for it.
    for (let frame = 0; frame < 5; frame += 1) frameAndDraw();
    expect(ghostSet.warming).toBe(true);
    // Shown, but its mesh only on the sun's shadow-caster layer: the main camera draws none of it.
    set.visible = true;
    mesh.layers.set(9);
    frameAndDraw();
    expect(ghostSet.warming).toBe(true);
    mesh.layers.set(0);
    frameAndDraw();
    frameAndDraw();
    expect(ghostSet.warming).toBe(true);
    frameAndDraw();
    expect(ghostSet.warming).toBe(false);
  });

  it("does not wait long for a set that never draws", () => {
    armedSet();
    for (let frame = 0; frame < 60; frame += 1) frameAndDraw();
    expect(ghostSet.warming).toBe(true);
    runFrame();
    expect(ghostSet.warming).toBe(false);
  });

  it("warms the set when a card is armed over the same table picked from the list", () => {
    const table = getCatalogueItemBySlug("round-table-6ft-white");
    if (table === undefined) throw new Error("Missing the round table");
    setPlannerFeaturesForTesting(null);
    act(() => { useCatalogueStore.getState().selectItem(table.id); });
    render(<PlacementGhost />);
    // The piece's warm-up ends (the page draws no three ghost for it here).
    runFrame();
    act(() => { useCatalogueStore.getState().armCard("round"); });
    // The hand holds the same table, now with its ring of chairs: the set warms all the same.
    expect(useCatalogueStore.getState().selectedItemId).toBe(table.id);
    expect(ghostSet.card).toBe("round");
    expect(ghostSet.warming).toBe(true);
  });

  it("leaves the set where GhostSet stands it", () => {
    const set = armedSet();
    set.visible = true;
    runFrame();
    expect(set.position.toArray()).toEqual([0, 0, 0]);
  });
});

it("keeps the seating dialog for an imported dining table", () => {
  const diningTable = getCatalogueItemBySlug("round-table-6ft-white");
  if (diningTable === undefined) throw new Error("Missing imported round table");
  useCatalogueStore.setState({ selectedItemId: diningTable.id });
  render(<PlacementGhost />);
  act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  expect(useChairDialogStore.getState().pending).toMatchObject({ catalogueItemId: diningTable.id, tableShape: "round" });
});

it("does not reuse a valid ghost when the release has no floor target", () => {
  useCatalogueStore.setState({ dragActive: true });
  usePlacementStore.getState().updateGhost(0, 0, itemId);
  render(<PlacementGhost />);
  scene.remove(target);
  act(() => { fireEvent.mouseUp(window, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
  expect(useCatalogueStore.getState().dragActive).toBe(false);
});

it("does not place the previous ghost when a click falls outside the planning floor", () => {
  usePlacementStore.getState().updateGhost(0, 0, itemId);
  render(<PlacementGhost />);
  act(() => { fireEvent.click(canvas, { clientX: 400, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
});

function beginChairBrush(): void {
  const chair = getCatalogueItemBySlug("banquet-chair");
  if (chair === undefined) throw new Error("Chair fixture missing");
  useCatalogueStore.setState({ selectedItemId: chair.id, dragActive: true });
  render(<PlacementGhost />);
  act(() => { fireEvent.pointerDown(canvas, { clientX: 40, clientY: 50, button: 0, buttons: 1 }); });
  act(() => { fireEvent.pointerMove(window, { clientX: 65, clientY: 50, buttons: 1 }); });
  runFrame();
  expect(usePlacementStore.getState().ghostPosition).not.toBeNull();
}

it.each(["outside floor", "covering panel", "removed floor"])("cancels a chair brush released over %s", (releaseTarget) => {
  beginChairBrush();
  if (releaseTarget === "covering panel") {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  } else if (releaseTarget === "removed floor") {
    scene.remove(target);
  }
  act(() => {
    fireEvent.pointerUp(window, { clientX: releaseTarget === "outside floor" ? 400 : 65, clientY: 50, button: 0 });
    fireEvent.mouseUp(window, { clientX: 65, clientY: 50, button: 0 });
    fireEvent.click(canvas, { clientX: 65, clientY: 50, button: 0 });
  });
  expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
  expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  expect(useCatalogueStore.getState().dragActive).toBe(false);
});

it("uses the chair brush release point and places only once through pointer, mouse and click events", () => {
  beginChairBrush();
  const finish = vi.spyOn(usePlacementStore.getState(), "placeChairBrush");
  act(() => {
    fireEvent.pointerUp(window, { clientX: 75, clientY: 50, button: 0 });
    fireEvent.mouseUp(window, { clientX: 75, clientY: 50, button: 0 });
    fireEvent.click(canvas, { clientX: 75, clientY: 50, button: 0 });
  });
  expect(finish).toHaveBeenCalledTimes(1);
  // A 75px release reaches farther than the last preview's 65px move.
  expect(finish.mock.calls[0]?.[3]).toBeCloseTo(1.632993, 5);
  expect(usePlacementStore.getState().placedItems.length).toBeGreaterThan(1);
  expect(useCatalogueStore.getState().dragActive).toBe(false);
});

it("follows five moves before a frame with one ghost update, and never walks the scene for the floor again", () => {
  render(<PlacementGhost />);
  act(() => { fireEvent.pointerMove(canvas, { clientX: 40, clientY: 50 }); });
  runFrame();
  expect(usePlacementStore.getState().ghostPosition).not.toBeNull();
  const update = vi.spyOn(usePlacementStore.getState(), "updateGhost");
  const walk = vi.spyOn(scene, "getObjectByName");
  act(() => { for (const x of [42, 46, 50, 55, 60]) fireEvent.pointerMove(canvas, { clientX: x, clientY: 50 }); });
  expect(update).not.toHaveBeenCalled();
  runFrame();
  expect(update).toHaveBeenCalledTimes(1);
  expect(walk).not.toHaveBeenCalled();
  // The last move is the one followed: right of centre.
  expect(update.mock.calls[0]?.[0]).toBeGreaterThan(0.5);
});

it("moves the ghost without a React commit while its validity holds", () => {
  render(<PlacementGhost />);
  act(() => { fireEvent.pointerMove(canvas, { clientX: 40, clientY: 50 }); });
  runFrame();
  // The piece's warm-up frames end first: that commit is the arming's, not a move's.
  runFrame();
  runFrame();
  const settled = proxy.renders;
  const valid = usePlacementStore.getState().ghostValid;
  // Each lands in another grid cell, all well inside the room.
  for (const x of [55, 60, 65, 70]) {
    act(() => { fireEvent.pointerMove(canvas, { clientX: x, clientY: 50 }); });
    runFrame();
  }
  expect(usePlacementStore.getState().ghostPosition?.[0]).toBeGreaterThan(0);
  expect(usePlacementStore.getState().ghostValid).toBe(valid);
  expect(proxy.renders).toBe(settled);
});

it("raises the ghost above a finger the touch arbiter holds to place, and lets it go when the finger looks round", () => {
  render(<PlacementGhost />);
  act(() => {
    useTouchGestureStore.getState().setMode("place");
    useTouchGestureStore.getState().setFinger({ x: 50, y: 50 + ghostRaisePx(window.innerHeight) });
  });
  runFrame();
  // The point the ghost stands on is the one under (50, 50), above the finger: the room's centre.
  expect(usePlacementStore.getState().ghostPosition?.[0]).toBeCloseTo(0, 5);
  expect(usePlacementStore.getState().ghostPosition?.[2]).toBeCloseTo(0, 5);
  act(() => { useTouchGestureStore.getState().setMode("orbit"); });
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
  // A move the finger made as it turned to looking round is not followed afterwards.
  runFrame();
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
});

it("ignores touch moves the arbiter holds, and the click its tap sends afterwards", () => {
  render(<PlacementGhost />);
  act(() => { useTouchGestureStore.getState().setMode("pending"); });
  act(() => { fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerType: "touch" }); });
  runFrame();
  expect(usePlacementStore.getState().ghostPosition).toBeNull();
  act(() => { useTouchGestureStore.getState().end(performance.now()); });
  act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
  expect(usePlacementStore.getState().placedItems).toHaveLength(0);
});

/** A placed piece drawn under the canvas's centre, as the scene names it, so a click there lands on it. */
function drawPlacedPieceAtCentre(id: string): () => void {
  const furniture = new Group();
  furniture.name = "placed-furniture";
  const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  box.name = `furniture-${id}`;
  box.position.y = 0.5;
  furniture.add(box);
  scene.add(furniture);
  scene.updateMatrixWorld(true);
  return () => { box.geometry.dispose(); box.material.dispose(); };
}

it("picks a placed piece a click lands on where the card's set could not stand, and puts the card down (truthfulGhost)", () => {
  setPlannerFeaturesForTesting({ setupCards: true, truthfulGhost: true });
  const dispose = drawPlacedPieceAtCentre("placed-poseur");
  try {
    usePlacementStore.setState({ placedItems: [createPlacedItem(itemId, 0, 0, 0, null, 0, "placed-poseur")] });
    act(() => { useCatalogueStore.getState().armCard("round"); });
    render(<PlacementGhost />);
    act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    expect(usePlacementStore.getState().placedItems).toHaveLength(1);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(["placed-poseur"]));
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
  } finally {
    dispose();
    useCatalogueStore.getState().disarm();
    setPlannerFeaturesForTesting(null);
  }
});

it("places a piece in hand with no card where a click lands on a placed piece, as before (truthfulGhost)", () => {
  setPlannerFeaturesForTesting({ truthfulGhost: true });
  const dispose = drawPlacedPieceAtCentre("placed-poseur");
  try {
    usePlacementStore.setState({ placedItems: [createPlacedItem(itemId, 3, 0, 0, null, 0, "placed-poseur")] });
    render(<PlacementGhost />);
    act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    expect(usePlacementStore.getState().placedItems).toHaveLength(2);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useCatalogueStore.getState().selectedItemId).toBe(itemId);
  } finally {
    dispose();
    setPlannerFeaturesForTesting(null);
  }
});

it("leaves a card dragged out and let go with its set selected (setupCards)", () => {
  setPlannerFeaturesForTesting({ setupCards: true });
  try {
    act(() => { useCatalogueStore.getState().startCardDrag("round"); });
    render(<PlacementGhost />);
    act(() => { fireEvent.pointerMove(window, { clientX: 50, clientY: 50 }); });
    runFrame();
    act(() => { fireEvent.pointerUp(window, { clientX: 50, clientY: 50, button: 0 }); });
    const placed = usePlacementStore.getState().placedItems;
    expect(placed).toHaveLength(11);
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(placed.map((piece) => piece.id)));
  } finally {
    useCatalogueStore.getState().disarm();
    setPlannerFeaturesForTesting(null);
  }
});

it("draws a dance floor by press-drag in whole panels, sets it down on release, and gives the card back its size (setupCards)", () => {
  setPlannerFeaturesForTesting({ setupCards: true });
  try {
    act(() => { useCatalogueStore.getState().armCard("dance-floor"); });
    render(<PlacementGhost />);
    const rect = new DOMRect(0, 0, 100, 100);
    const three = graphics.get();
    const start = placementFloorPoint(three.scene, three.camera, three.raycaster, rect, 50, 50);
    const end = placementFloorPoint(three.scene, three.camera, three.raycaster, rect, 90, 20);
    const expected = start === null || end === null ? null : drawnDanceFloor(start, end, 0);
    expect(expected).not.toBeNull();
    // A size the card does not hold, so only the drawing can have set it down.
    expect(expected?.cols === 5 && expected.rows === 5).toBe(false);
    act(() => { fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    act(() => { fireEvent.pointerMove(canvas, { clientX: 90, clientY: 20, buttons: 1 }); });
    runFrame();
    act(() => { fireEvent.pointerUp(window, { clientX: 90, clientY: 20, button: 0 }); });
    // The click a release sends afterwards sets nothing more down.
    act(() => { fireEvent.click(canvas, { clientX: 90, clientY: 20, button: 0 }); });
    const placed = usePlacementStore.getState().placedItems;
    expect(placed).toHaveLength((expected?.cols ?? 0) * (expected?.rows ?? 0));
    expect(new Set(placed.map((piece) => piece.groupId)).size).toBe(1);
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ card: "dance-floor", cols: 5, rows: 5 });
  } finally {
    useCatalogueStore.getState().disarm();
    setPlannerFeaturesForTesting(null);
  }
});

describe("a dance floor drawn by press-drag (setupCards)", () => {
  const PANELS_ON_THE_CARD = 25;

  function beginDrawing(): void {
    act(() => { useCatalogueStore.getState().armCard("dance-floor"); });
    render(<PlacementGhost />);
    act(() => { fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    act(() => { fireEvent.pointerMove(canvas, { clientX: 90, clientY: 20, buttons: 1 }); });
    runFrame();
    expect(useCatalogueStore.getState().cardParams).not.toMatchObject({ cols: 5, rows: 5 });
  }

  beforeEach(() => { setPlannerFeaturesForTesting({ setupCards: true }); });
  afterEach(() => {
    useCatalogueStore.getState().disarm();
    setPlannerFeaturesForTesting(null);
  });

  it("is not set down when let go off the canvas, the card gets its size back, and a later click still sets one down", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    beginDrawing();
    act(() => { fireEvent.pointerUp(window, { clientX: 400, clientY: 20, button: 0 }); });
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ cols: 5, rows: 5 });
    // No click came from that release; the next one, a second on, is a placement.
    now.mockReturnValue(11_000);
    act(() => { fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 }); });
    expect(usePlacementStore.getState().placedItems).toHaveLength(PANELS_ON_THE_CARD);
  });

  it("goes back to the card's size when the drag comes back to the press, and a release there sets that size down", () => {
    beginDrawing();
    act(() => { fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, buttons: 1 }); });
    runFrame();
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ cols: 5, rows: 5 });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 50, clientY: 50, button: 0 });
      fireEvent.click(canvas, { clientX: 50, clientY: 50, button: 0 });
    });
    expect(usePlacementStore.getState().placedItems).toHaveLength(PANELS_ON_THE_CARD);
  });

  it("gives the card its size back when the window loses focus mid-draw, and shows no guides while drawing", () => {
    beginDrawing();
    expect(useSelectionStore.getState().activeGuides).toEqual([]);
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ cols: 5, rows: 5 });
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });
});

// The chair brush as the planner draws and sets it (PlacementGhost), on a room's own floor: the chairs
// its preview shows while the pointer is held are the chairs the release sets, and none of them stands
// through a wall (second review of audit editor-save-4, major 2). The walls are judged the slow way.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { PerspectiveCamera, Raycaster, Scene } from "three";
import { PlacementGhost } from "../PlacementGhost.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { roomGeometries } from "../../data/room-geometries.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { plannerRoomOf } from "../../lib/room-floor.js";
import { footprintInsideWalls, insideWalls, type Walls } from "../../lib/__tests__/walls-the-slow-way.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
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
vi.mock("@react-three/fiber", () => ({
  useThree: () => graphics.get(),
  useFrame: (callback: () => void) => { frames.latest = callback; },
}));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => null }));
vi.mock("../GhostSet.js", () => ({ GhostSet: () => null }));
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => null }));
// The floor point under the pointer is answered here, a page pixel a centimetre with the room's origin at
// (1000, 1000): the raycast to the floor has its own tests (PlacementGhost.pointer.test.tsx).
vi.mock("../../lib/planner-interaction-floor.js", async (original) => ({
  ...(await original<typeof import("../../lib/planner-interaction-floor.js")>()),
  placementFloorPoint: (_scene: unknown, _camera: unknown, _raycaster: unknown, _rect: unknown, clientX: number, clientY: number) => ({ x: clientX / 100 - 10, z: clientY / 100 - 10 }),
}));

const found = getCatalogueItemBySlug("burgess-turini-18-3");
if (found === undefined) throw new Error("no chair in the catalogue");
const CHAIR = found;
/** A millimetre: nearer a wall than this, the slow way and the planner may differ by rounding alone. */
const HAIR = 0.001;

let canvas: HTMLCanvasElement;
const pointDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

/** The page pixel over a floor point. */
const pixel = (x: number, z: number): { readonly clientX: number; readonly clientY: number } => ({ clientX: (x + 10) * 100, clientY: (z + 10) * 100 });

function runFrame(): void {
  act(() => { frames.latest?.(); });
}

function openRoom(name: string, snapEnabled: boolean): Walls {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  useRoomDimensionsStore.getState().setDimensions(plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight));
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled });
  return geometry.wallPolygon;
}

beforeEach(() => {
  frames.latest = null;
  useTouchGestureStore.getState().end(-Infinity);
  useSelectionStore.setState({ selectedIds: new Set() });
  useCatalogueStore.setState({ selectedItemId: CHAIR.id, dragActive: false });
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 2000, 2000));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => canvas) });
  graphics.get.mockReturnValue({ scene: new Scene(), camera: new PerspectiveCamera(), raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate: vi.fn() });
});

afterEach(() => {
  cleanup();
  canvas.remove();
  if (pointDescriptor === undefined) Reflect.deleteProperty(document, "elementFromPoint");
  else Object.defineProperty(document, "elementFromPoint", pointDescriptor);
  useCatalogueStore.setState({ selectedItemId: null, dragActive: false });
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, snapEnabled: true });
  vi.restoreAllMocks();
});

/** Where the brush's preview shows a chair, as "x, z" to the millimetre; null when no brush is drawn. */
function previewedChairs(): readonly string[] | null {
  const preview = document.querySelector('[name="chair-brush-preview"]');
  if (preview === null) return null;
  return Array.from(preview.children).map((chair) => {
    const [x, , z] = (chair.getAttribute("position") ?? "").split(",").map(Number);
    return `${(x ?? Number.NaN).toFixed(3)}, ${(z ?? Number.NaN).toFixed(3)}`;
  });
}

/** Presses at one floor point and drags to another, as a person brushing chairs does; the preview's chairs when the pointer gets there. */
function brushTo(from: readonly [number, number], to: readonly [number, number]): readonly string[] | null {
  render(<PlacementGhost />);
  act(() => { fireEvent.pointerDown(canvas, { ...pixel(from[0], from[1]), button: 0, buttons: 1 }); });
  act(() => { fireEvent.pointerMove(canvas, { ...pixel(to[0], to[1]), buttons: 1 }); });
  runFrame();
  return previewedChairs();
}

function release(at: readonly [number, number]): readonly string[] {
  act(() => { fireEvent.pointerUp(window, { ...pixel(at[0], at[1]), button: 0 }); });
  return usePlacementStore.getState().placedItems.map((chair) => `${chair.x.toFixed(3)}, ${chair.z.toFixed(3)}`);
}

const stands = (walls: Walls, at: string): boolean => {
  const [x, z] = at.split(", ").map(Number);
  return x !== undefined && z !== undefined && footprintInsideWalls(walls, x, z, CHAIR.width / 2, CHAIR.depth / 2, HAIR);
};

it.each([
  ["with the grid on", true],
  ["with the grid off", false],
])("shows in the Robert Adam Room exactly the chairs a brush across the step then sets, none through a wall, %s", (_grid, snapEnabled) => {
  const walls = openRoom("Robert Adam Room", snapEnabled);
  // From the upper section to the lower section past the step, both ends on the floor and neither on a grid point.
  const from = [3.2, 0.3] as const;
  const to = [-2.3, 5.4] as const;
  expect(insideWalls(walls, from[0], from[1]) && insideWalls(walls, to[0], to[1])).toBe(true);
  const shown = brushTo(from, to);
  const set = release(to);
  expect(set.length).toBeGreaterThan(20);
  expect(shown).toEqual(set);
  expect(set.filter((at) => !stands(walls, at))).toEqual([]);
  // The chairs it set are the ones left selected: the count it reports is the count on the floor.
  expect(useSelectionStore.getState().selectedIds.size).toBe(set.length);
});

it("shows the one chair of a brush that stands on the floor, and sets that one", () => {
  const walls = openRoom("Robert Adam Room", false);
  // A column down from the upper section along the lower section's east wall, x = −0.1: only its first chair is clear of that wall.
  const from = [-0.2, 3.3] as const;
  const to = [-0.25, 4.6] as const;
  expect(insideWalls(walls, from[0], from[1]) && insideWalls(walls, to[0], to[1])).toBe(true);
  const shown = brushTo(from, to);
  expect(shown).toEqual(["-0.200, 3.300"]);
  expect(release(to)).toEqual(["-0.200, 3.300"]);
});

it("shows no chair for a brush none of which stands on the floor, and sets none", () => {
  const walls = openRoom("Robert Adam Room", false);
  const from = [-0.15, 4.2] as const;
  const to = [-0.15, 7.8] as const;
  expect(insideWalls(walls, from[0], from[1]) && insideWalls(walls, to[0], to[1])).toBe(true);
  expect(brushTo(from, to)).toEqual([]);
  expect(release(to)).toEqual([]);
});

it("shows and sets in the Grand Hall what it always did: the preview from the pointer's own points, the set chairs from the grid's", () => {
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true });
  const shown = brushTo([-3.2, 1.1], [2.4, 3.6]);
  // Ten chairs 0.57 m apart from the press, as the preview has always drawn them; nine from the grid point, as the release has always set them.
  expect(shown).toEqual(Array.from({ length: 10 }, (_, index) => `${(-3.2 + 0.57 * index).toFixed(3)}, 1.100`));
  expect(release([2.4, 3.6])).toEqual(Array.from({ length: 9 }, (_, index) => `${(-3 + 0.57 * index).toFixed(3)}, 1.000`));
});

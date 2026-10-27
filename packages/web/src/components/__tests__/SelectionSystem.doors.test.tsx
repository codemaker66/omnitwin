import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createTableGroup } from "../../lib/table-group.js";
import { PLANNER_INTERACTION_FLOOR_NAME } from "../../lib/planner-interaction-floor.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { LIFT_HOLD_MS, ghostRaisePx } from "../../lib/touch-arbiter.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES } from "../../lib/door-clear-spaces.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlacementNoticeStore } from "../../stores/placement-notice-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { subscribeDoorSlides, useDoorClearSpaceStore, type DoorSlideEvent } from "../../stores/door-clear-space-store.js";

// ---------------------------------------------------------------------------
// Blake's door rule at the hand (27 Oct 2026, "Keep them clear automatically
// (Recommended)"): a round let go in front of the Grand Hall's main door,
// by mouse or by a lifted finger, slides back to the nearest clear spot, and
// one line names the door. The drop lands in the grid cell at (0, 3), where
// the chairs facing the door reach z 4.5 (the door's clear space starts at
// 3.795); at (0, 2) they stop at 3.545, the nearest clear grid point.
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));

let canvas: HTMLCanvasElement;
let camera: PerspectiveCamera;
let invalidate: Mock<() => void>;
let tableId = "";
let groupIds: readonly string[] = [];
let now = 0;
let slides: DoorSlideEvent[] = [];
let unsubscribe: () => void = () => undefined;
const disposables: { dispose(): void }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  setPlannerFeaturesForTesting({ touchArbiter: true });
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useCockpitStore.setState({ walkMode: false, cameraInteractionActive: false });
  useTouchGestureStore.getState().end(-Infinity);
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  usePlacementNoticeStore.getState().dismiss();
  slides = [];
  unsubscribe = subscribeDoorSlides((event) => { slides.push(event); });
  canvas = document.createElement("canvas");
  const captured = new Set<number>();
  canvas.setPointerCapture = (id) => { captured.add(id); };
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => { captured.delete(id); };
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 400));
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 852 });
  // Looking down at the door wall from inside the room.
  camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 12, -6);
  camera.lookAt(0, 0, 2);
  camera.updateMatrixWorld();
  const scene = new Scene();
  const floorGeometry = new PlaneGeometry(40, 40);
  const floorMaterial = new MeshBasicMaterial({ side: DoubleSide });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = PLANNER_INTERACTION_FLOOR_NAME;
  floor.visible = false;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const table = getCatalogueItemBySlug("round-table-6ft-white");
  if (table === undefined) throw new Error("Missing the 6 ft round");
  const group = createTableGroup(table.id, 4, 0, 0, 10);
  const primary = group.find((item) => item.catalogueItemId === table.id);
  if (primary === undefined) throw new Error("Missing primary table");
  tableId = primary.id;
  groupIds = group.map((item) => item.id);
  usePlacementStore.setState({ placedItems: group, snapEnabled: true, ghostPosition: null });
  const root = new Group();
  root.name = "placed-furniture";
  const furniture = new Group();
  furniture.name = `furniture-${primary.id}`;
  furniture.position.set(4, 0, 0);
  const boxGeometry = new BoxGeometry(1.8, 1, 1.8);
  const boxMaterial = new MeshBasicMaterial();
  const pick = new Mesh(boxGeometry, boxMaterial);
  pick.position.y = 0.5;
  furniture.add(pick);
  root.add(furniture);
  scene.add(root);
  scene.updateMatrixWorld(true);
  disposables.push(floorGeometry, floorMaterial, boxGeometry, boxMaterial);
  invalidate = vi.fn<() => void>();
  renderer.value = { scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate };
});

afterEach(() => {
  unsubscribe();
  cleanup();
  canvas.remove();
  for (const item of disposables.splice(0)) item.dispose();
  setPlannerFeaturesForTesting(null);
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  useDoorClearSpaceStore.getState().setCarrying(false);
  usePlacementNoticeStore.getState().dismiss();
  useEditorStore.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Where a floor point shows on the 400 × 400 canvas. */
function screenOf(x: number, z: number): { readonly x: number; readonly y: number } {
  const projected = new Vector3(x, 0, z).project(camera);
  return { x: (projected.x + 1) * 200, y: (1 - projected.y) * 200 };
}

function event(type: "pointerDown" | "pointerMove" | "pointerUp", pointerType: "mouse" | "touch", at: { readonly x: number; readonly y: number }, time: number): void {
  act(() => {
    const elapsed = Math.max(0, time - now);
    now = time;
    vi.advanceTimersByTime(elapsed);
    fireEvent[type](canvas, { pointerId: 1, pointerType, isPrimary: true, button: 0,
      buttons: type === "pointerUp" ? 0 : 1, clientX: at.x, clientY: at.y });
  });
}

function table(): { readonly x: number; readonly z: number } {
  const placed = usePlacementStore.getState().placedItems.find((item) => item.id === tableId);
  if (placed === undefined) throw new Error("Missing table");
  return { x: placed.x, z: placed.z };
}

describe("a round let go in front of the main door", () => {
  it("slides back clear when a mouse drops it, and names the door", () => {
    render(<SelectionSystem />);
    event("pointerDown", "mouse", screenOf(4, 0), 1_000);
    event("pointerMove", "mouse", screenOf(2, 1.5), 1_016);
    expect(useDoorClearSpaceStore.getState().carrying).toBe(true);
    event("pointerMove", "mouse", screenOf(0, 3.1), 1_032);
    event("pointerUp", "mouse", screenOf(0, 3.1), 1_100);
    expect([table().x, table().z]).toEqual([expect.closeTo(0, 6), expect.closeTo(2, 6)]);
    expect(slides.map((slide) => [slide.ids.length, slide.dx, slide.dz])).toEqual([[groupIds.length, 0, -1]]);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
    expect(useDoorClearSpaceStore.getState().carrying).toBe(false);
  });

  it("slides back clear when a lifted finger sets it down", () => {
    render(<SelectionSystem />);
    const raise = ghostRaisePx(852);
    event("pointerDown", "touch", screenOf(4, 0), 1_000);
    act(() => { now = 1_000 + LIFT_HOLD_MS + 20; vi.advanceTimersByTime(LIFT_HOLD_MS + 20); });
    expect(useTouchGestureStore.getState().mode).toBe("lift");
    expect(useDoorClearSpaceStore.getState().carrying).toBe(true);
    // The piece rides `raise` px above the finger: the finger goes below where it should land.
    const over = screenOf(0, 3.1);
    event("pointerMove", "touch", { x: over.x, y: over.y + raise }, 1_400);
    event("pointerUp", "touch", { x: over.x, y: over.y + raise }, 1_500);
    expect([table().x, table().z]).toEqual([expect.closeTo(0, 6), expect.closeTo(2, 6)]);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe("Kept the main door clear.");
    expect(useDoorClearSpaceStore.getState().carrying).toBe(false);
  });

  it("stays where it is let go when it clears every door", () => {
    render(<SelectionSystem />);
    event("pointerDown", "mouse", screenOf(4, 0), 1_000);
    event("pointerMove", "mouse", screenOf(2, 0.5), 1_016);
    event("pointerMove", "mouse", screenOf(0, 1.1), 1_032);
    event("pointerUp", "mouse", screenOf(0, 1.1), 1_100);
    expect([table().x, table().z]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    expect(slides).toEqual([]);
    expect(usePlacementNoticeStore.getState().notice).toBeNull();
  });
});

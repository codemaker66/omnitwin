import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createTableGroup } from "../../lib/table-group.js";
import { PLANNER_INTERACTION_FLOOR_NAME } from "../../lib/planner-interaction-floor.js";
import { setPlannerFeaturesForTesting, type PlannerFeatureOverrides } from "../../lib/planner-features.js";
import { PLACE_HOLD_MS } from "../../lib/touch-arbiter.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { useVisibilityStore } from "../../stores/visibility-store.js";

// ---------------------------------------------------------------------------
// Decision 4 (planner-qol's CB-40, behind `wallClickAlt`): in a room whose
// walls can come down, a plain click that meets a wall first passes through to
// the floor, so the everyday deselect never takes a wall down; Alt-click hides
// it. A finger has no Alt, so a tap never does. Off, any click on a wall hides
// it, as before.
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));

const initialVisibility = useVisibilityStore.getState();
let canvas: HTMLCanvasElement;
let tableId = "";
let now = 0;
const disposables: { dispose(): void }[] = [];

/** The screen point over the near wall, which stands between the camera and the middle of the floor. */
const ON_WALL = { x: 200, y: 200 } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  useVisibilityStore.setState(initialVisibility, true);
  useEditorStore.getState().reset();
  useCatalogueStore.getState().clearSelection();
  useCockpitStore.setState({ walkMode: false, cameraInteractionActive: false });
  useTouchGestureStore.getState().end(-Infinity);
  canvas = document.createElement("canvas");
  const captured = new Set<number>();
  canvas.setPointerCapture = (id) => { captured.add(id); };
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => { captured.delete(id); };
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 400));
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new Scene();
  const floorGeometry = new PlaneGeometry(40, 40);
  const wallGeometry = new PlaneGeometry(10, 4);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const floor = new Mesh(floorGeometry, material);
  floor.name = PLANNER_INTERACTION_FLOOR_NAME;
  floor.visible = false;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // The room's near wall, facing the camera: the ray through the middle of the screen meets it at y = 3.
  const wall = new Mesh(wallGeometry, material);
  wall.name = "wall-front";
  wall.position.set(0, 2, 3);
  scene.add(wall);
  scene.updateMatrixWorld(true);
  disposables.push(floorGeometry, wallGeometry, material);
  // A round to have selected, so a deselect shows.
  const round = getCatalogueItemBySlug("round-table-6ft");
  if (round === undefined) throw new Error("Missing canonical table");
  const group = createTableGroup(round.id, -6, -4, 0, 8);
  tableId = group.find((item) => item.catalogueItemId === round.id)?.id ?? "";
  usePlacementStore.setState({ placedItems: group, snapEnabled: false, ghostPosition: null });
  useSelectionStore.getState().select(tableId);
  renderer.value = { scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate: vi.fn<() => void>() };
});

afterEach(() => {
  cleanup();
  canvas.remove();
  for (const item of disposables.splice(0)) item.dispose();
  setPlannerFeaturesForTesting(null);
  useVisibilityStore.setState(initialVisibility, true);
  useSelectionStore.getState().clearSelection();
  useEditorStore.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(features: PlannerFeatureOverrides): void {
  setPlannerFeaturesForTesting(features);
  render(<SelectionSystem />);
}

/** A mouse click where it stands, with Alt held or not. */
function click(altKey: boolean): void {
  const at = { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: ON_WALL.x, clientY: ON_WALL.y, altKey };
  act(() => {
    fireEvent.pointerDown(canvas, { ...at, buttons: 1 });
    fireEvent.pointerUp(canvas, { ...at, buttons: 0 });
  });
}

/** A quick finger tap where it stands. */
function tap(): void {
  const at = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: ON_WALL.x, clientY: ON_WALL.y };
  act(() => { fireEvent.pointerDown(canvas, { ...at, buttons: 1 }); });
  act(() => {
    now += PLACE_HOLD_MS - 30;
    vi.advanceTimersByTime(PLACE_HOLD_MS - 30);
    fireEvent.pointerUp(canvas, { ...at, buttons: 0 });
  });
}

function wallDown(): boolean {
  const state = useVisibilityStore.getState();
  return state.wallLocks["wall-front"] && !state.walls["wall-front"];
}

describe("a click on a wall, with Alt-click hiding walls (wallClickAlt)", () => {
  it("passes a plain click through to the floor: the wall stays and the selection clears", () => {
    mount({ wallClickAlt: true });
    click(false);
    expect(wallDown()).toBe(false);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("takes the wall down on an Alt-click, and leaves the selection as it was", () => {
    mount({ wallClickAlt: true });
    click(true);
    expect(wallDown()).toBe(true);
    expect(useSelectionStore.getState().selectedIds.has(tableId)).toBe(true);
  });

  it("never takes a wall down on a finger tap, with the touch arbiter or without it", () => {
    for (const touchArbiter of [true, false]) {
      cleanup();
      useSelectionStore.getState().select(tableId);
      mount({ wallClickAlt: true, touchArbiter });
      tap();
      expect(wallDown(), `touchArbiter ${String(touchArbiter)}`).toBe(false);
      expect(useSelectionStore.getState().selectedIds.size, `touchArbiter ${String(touchArbiter)}`).toBe(0);
    }
  });
});

describe("a click on a wall, as before (wallClickAlt off)", () => {
  it("takes the wall down on a plain click and on a tap", () => {
    mount({ wallClickAlt: false });
    click(false);
    expect(wallDown()).toBe(true);

    cleanup();
    useVisibilityStore.setState(initialVisibility, true);
    mount({ wallClickAlt: false, touchArbiter: true });
    tap();
    expect(wallDown()).toBe(true);
  });
});

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createTableGroup } from "../../lib/table-group.js";
import { PLANNER_INTERACTION_FLOOR_NAME, placementFloorPoint } from "../../lib/planner-interaction-floor.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { GHOST_RAISE_PX, LIFT_HOLD_MS, PLACE_HOLD_MS } from "../../lib/touch-arbiter.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

// ---------------------------------------------------------------------------
// The touch arbiter in the planner (spec-card-dock §10.1): a swipe looks
// round even with a piece in hand, a quick tap places under the finger, a
// hold raises the ghost and the lift places it where it was seen, a second
// finger never places, and a still finger on a piece lifts it.
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));

let canvas: HTMLCanvasElement;
let scene: Scene;
let camera: PerspectiveCamera;
let invalidate: Mock<() => void>;
let tableId = "";
let now = 0;
const disposables: { dispose(): void }[] = [];
const poseur = getCatalogueItemBySlug("poseur-table");
if (poseur === undefined) throw new Error("Poseur fixture missing");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  setPlannerFeaturesForTesting({ touchArbiter: true, seatsOnTheCard: true });
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useSelectionStore.getState().clearSelection();
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
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 852 });
  camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene = new Scene();
  // The planning floor the ghost stands on, and one round of eight to lift.
  const floorGeometry = new PlaneGeometry(40, 40);
  const floorMaterial = new MeshBasicMaterial({ side: DoubleSide });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = PLANNER_INTERACTION_FLOOR_NAME;
  floor.visible = false;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing canonical table");
  const group = createTableGroup(table.id, 4, 0, 0, 8);
  const primary = group.find((item) => item.catalogueItemId === table.id);
  if (primary === undefined) throw new Error("Missing primary table");
  tableId = primary.id;
  usePlacementStore.setState({ placedItems: group, snapEnabled: false, ghostPosition: null });
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
  cleanup();
  canvas.remove();
  for (const item of disposables.splice(0)) item.dispose();
  setPlannerFeaturesForTesting(null);
  useEditorStore.getState().reset();
  useCatalogueStore.getState().clearSelection();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type TouchType = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel";

/** The clock moves to `at` ms and the timers due by then run, reading that time. */
function advanceTo(at: number): void {
  const elapsed = Math.max(0, at - now);
  now = at;
  vi.advanceTimersByTime(elapsed);
}

/** A finger event at `at` ms, its timers run up to then. */
function finger(type: TouchType, x: number, y: number, at: number, pointerId = 1): void {
  act(() => {
    advanceTo(at);
    fireEvent[type](canvas, { pointerId, pointerType: "touch", isPrimary: pointerId === 1, button: 0,
      buttons: type === "pointerUp" || type === "pointerCancel" ? 0 : 1, clientX: x, clientY: y });
  });
}

function wait(at: number): void {
  act(() => { advanceTo(at); });
}

function placedPoseurs(): readonly { readonly x: number; readonly z: number }[] {
  return usePlacementStore.getState().placedItems.filter((item) => item.catalogueItemId === poseur?.id);
}

function floorUnder(x: number, y: number): { readonly x: number; readonly z: number } {
  const hit = placementFloorPoint(scene, camera, new Raycaster(), new DOMRect(0, 0, 400, 400), x, y);
  if (hit === null) throw new Error("Off the floor");
  return hit;
}

function tableAt(): { readonly x: number; readonly z: number } {
  const table = usePlacementStore.getState().placedItems.find((item) => item.id === tableId);
  if (table === undefined) throw new Error("Missing table");
  return { x: table.x, z: table.z };
}

/** A hold is judged on the frame after its timer: this long covers that frame. */
const FRAME = 20;

/** A finger move the page hands over late: its own timestamp is when the finger made it. */
function lateMove(x: number, y: number, stamp: number): void {
  act(() => {
    const event = new PointerEvent("pointermove", { pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1, clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(event, "timeStamp", { value: stamp });
    canvas.dispatchEvent(event);
  });
}

/** One pointermove carrying a frame's coalesced samples, as a busy page delivers them; it reports the last. */
function coalescedMoves(samples: readonly (readonly [number, number, number])[]): void {
  act(() => {
    const events = samples.map(([x, y, stamp]) => {
      const sample = new PointerEvent("pointermove", { pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1, clientX: x, clientY: y });
      Object.defineProperty(sample, "timeStamp", { value: stamp });
      return sample;
    });
    const last = events.at(-1);
    if (last === undefined) return;
    const event = new PointerEvent("pointermove", { pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1, clientX: last.clientX, clientY: last.clientY, bubbles: true });
    Object.defineProperty(event, "timeStamp", { value: last.timeStamp });
    Object.defineProperty(event, "getCoalescedEvents", { value: () => events });
    canvas.dispatchEvent(event);
  });
}

/** The screen point over the round of eight. */
const OVER_TABLE = { x: 298, y: 200 } as const;

describe("the touch arbiter", () => {
  it("places exactly one under the finger on a quick tap with a piece in hand", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 220, 1_000);
    finger("pointerUp", 151, 221, 1_000 + PLACE_HOLD_MS - 30);
    const placed = placedPoseurs();
    expect(placed).toHaveLength(1);
    const under = floorUnder(151, 221);
    expect(placed[0]?.x).toBeCloseTo(under.x, 1);
    expect(placed[0]?.z).toBeCloseTo(under.z, 1);
    // Still in hand, and the ghost a finger leaves is gone.
    expect(useCatalogueStore.getState().selectedItemId).toBe(poseur.id);
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
  });

  it("looks round on a swipe with a piece in hand, and places nothing", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 220, 1_000);
    finger("pointerMove", 156, 220, 1_030);
    expect(useTouchGestureStore.getState().cameraHeld).toBe(true);
    finger("pointerMove", 175, 224, 1_060);
    expect(useTouchGestureStore.getState().mode).toBe("orbit");
    expect(useTouchGestureStore.getState().cameraHeld).toBe(false);
    finger("pointerMove", 220, 230, 1_200);
    finger("pointerUp", 220, 230, 1_300);
    expect(placedPoseurs()).toHaveLength(0);
    expect(useTouchGestureStore.getState().mode).toBe("idle");
  });

  it("raises the ghost on a hold, and the lift places it where it was seen 40 ms before", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 260, 1_000);
    wait(1_000 + PLACE_HOLD_MS + FRAME);
    expect(useTouchGestureStore.getState().mode).toBe("place");
    finger("pointerMove", 180, 260, 1_200);
    finger("pointerMove", 200, 262, 1_240);
    expect(useTouchGestureStore.getState().finger).toEqual({ x: 200, y: 262 });
    // The finger rolls 12 px in its last moments on the glass; 40 ms before the lift it was at (200, 262).
    finger("pointerMove", 212, 262, 1_270);
    finger("pointerUp", 212, 262, 1_282);
    const placed = placedPoseurs();
    expect(placed).toHaveLength(1);
    const seen = floorUnder(200, 262 - GHOST_RAISE_PX);
    expect(placed[0]?.x).toBeCloseTo(seen.x, 1);
    expect(placed[0]?.z).toBeCloseTo(seen.z, 1);
  });

  it("reads a swipe the page was too busy to hand over before the hold's timer as the swipe it was", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 220, 1_000);
    // The page is busy: the hold's timer runs at 1 150 ms, before the move the finger made at 1 016 ms arrives
    // (just before the next frame, at 1 160 ms).
    wait(1_000 + PLACE_HOLD_MS + 5);
    lateMove(175, 222, 1_016);
    wait(1_000 + PLACE_HOLD_MS + 50);
    expect(useTouchGestureStore.getState().mode).toBe("orbit");
    finger("pointerUp", 175, 222, 1_300);
    expect(placedPoseurs()).toHaveLength(0);
  });

  it("reads every sample of a coalesced move, so a fast swipe in a slow frame is still a swipe", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 220, 1_000);
    wait(1_000 + 5);
    // The finger crossed the slop at 1 032 ms; the frame that hands the moves over reports the last, at 1 160 ms.
    coalescedMoves([[156, 220, 1_016], [168, 221, 1_032], [190, 222, 1_096], [214, 224, 1_160]]);
    expect(useTouchGestureStore.getState().mode).toBe("orbit");
    finger("pointerUp", 214, 224, 1_300);
    expect(placedPoseurs()).toHaveLength(0);
  });

  it("places nothing once a second finger lands", () => {
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 260, 1_000);
    wait(1_000 + PLACE_HOLD_MS + FRAME);
    finger("pointerMove", 170, 260, 1_200);
    finger("pointerDown", 260, 300, 1_250, 2);
    expect(useTouchGestureStore.getState().mode).toBe("two");
    finger("pointerUp", 170, 260, 1_400);
    finger("pointerUp", 260, 300, 1_420, 2);
    expect(placedPoseurs()).toHaveLength(0);
    expect(usePlacementStore.getState().ghostPosition).toBeNull();
  });

  it("lifts a piece held still for 300 ms, carries it above the finger, and sets it down on the lift", () => {
    render(<SelectionSystem />);
    const before = tableAt();
    finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
    wait(1_000 + LIFT_HOLD_MS - 1);
    expect(useTouchGestureStore.getState().mode).toBe("pending");
    expect(document.querySelector("[data-testid=touch-hold-ring]")).not.toBeNull();
    wait(1_000 + LIFT_HOLD_MS + FRAME);
    expect(useTouchGestureStore.getState().mode).toBe("lift");
    expect(useSelectionStore.getState().selectedIds.has(tableId)).toBe(true);
    // It rose above the finger at once: further from the camera, so further up the screen.
    expect(tableAt().z).toBeLessThan(before.z);
    finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
    finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
    expect(tableAt().x).toBeLessThan(before.x - 0.5);
    expect(useTouchGestureStore.getState().mode).toBe("idle");
  });

  it("returns a lifted piece where it was when a second finger lands", () => {
    render(<SelectionSystem />);
    const before = tableAt();
    finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
    wait(1_000 + LIFT_HOLD_MS + FRAME);
    finger("pointerMove", OVER_TABLE.x - 80, OVER_TABLE.y + 30, 1_400);
    expect(tableAt().x).not.toBeCloseTo(before.x, 2);
    finger("pointerDown", 100, 100, 1_450, 2);
    expect(tableAt().x).toBeCloseTo(before.x, 6);
    expect(tableAt().z).toBeCloseTo(before.z, 6);
  });

  it("selects on a quick tap with nothing in hand, and never lifts on one", () => {
    render(<SelectionSystem />);
    finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
    finger("pointerUp", OVER_TABLE.x, OVER_TABLE.y, 1_120);
    expect(useSelectionStore.getState().selectedIds.has(tableId)).toBe(true);
    expect(useTouchGestureStore.getState().mode).toBe("idle");
  });

  it("leaves the finger to the camera as before when the switch is off", () => {
    setPlannerFeaturesForTesting({ touchArbiter: false });
    useCatalogueStore.getState().selectItem(poseur.id);
    render(<SelectionSystem />);
    finger("pointerDown", 150, 220, 1_000);
    expect(useTouchGestureStore.getState().mode).toBe("idle");
    finger("pointerUp", 150, 220, 1_050);
    expect(placedPoseurs()).toHaveLength(0);
  });
});

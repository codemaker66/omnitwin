import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import {
  activeFurnitureSettleCount,
  carryFurniture,
  clearAllFurnitureSettles,
  stepFurnitureSettles,
} from "../../lib/furniture-motion.js";
import { createTableGroup } from "../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

// ---------------------------------------------------------------------------
// The hand's half of the furniture motion: a carry leans the pieces from the
// way they travel, and letting go sets them down. Under frameloop="demand"
// the hand must wake the loop for what it starts, and each drag must measure
// its own speed, never the last one's.
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => motion.reduced }));
vi.mock("../../lib/furniture-motion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/furniture-motion.js")>();
  return { ...actual, carryFurniture: vi.fn(actual.carryFurniture) };
});

let canvas: HTMLCanvasElement;
let geometry: BoxGeometry;
let material: MeshBasicMaterial;
let invalidate: Mock<() => void>;
let tableId = "";
let now = 0;

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  clearAllFurnitureSettles();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useToolStore.getState().setTool("select");
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
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing canonical table");
  const group = createTableGroup(table.id, 0, 0, 0, 8);
  const primary = group.find((item) => item.catalogueItemId === table.id);
  if (primary === undefined) throw new Error("Missing primary table");
  tableId = primary.id;
  // Snap off: no grid correction on release, so nothing but the set-down
  // itself can wake the loop when the hand lets go.
  usePlacementStore.setState({ placedItems: group, snapEnabled: false });
  useSelectionStore.getState().selectMultiple(group.map((item) => item.id));
  const scene = new Scene();
  const root = new Group();
  root.name = "placed-furniture";
  const furniture = new Group();
  furniture.name = `furniture-${primary.id}`;
  geometry = new BoxGeometry(1, 1, 1);
  material = new MeshBasicMaterial();
  const pickProxy = new Mesh(geometry, material);
  pickProxy.position.y = 0.5;
  furniture.add(pickProxy);
  root.add(furniture);
  scene.add(root);
  scene.updateMatrixWorld(true);
  invalidate = vi.fn<() => void>();
  renderer.value = { scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate };
});

afterEach(() => {
  cleanup();
  canvas.remove();
  geometry.dispose();
  material.dispose();
  clearAllFurnitureSettles();
  useEditorStore.getState().reset();
  vi.restoreAllMocks();
});

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number, at: number): void {
  now = at;
  act(() => { fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", isPrimary: true,
    button: 0, buttons: type === "pointerUp" || type === "pointerCancel" ? 0 : 1, clientX: x, clientY: y }); });
}

function tableAt(): { readonly x: number; readonly z: number } {
  const table = usePlacementStore.getState().placedItems.find((item) => item.id === tableId);
  if (table === undefined) throw new Error("Missing table");
  return { x: table.x, z: table.z };
}

/** The frame loop running while a resting hand's lean decays, until nothing moves. */
function runUntilAtRest(): void {
  for (let frame = 0; frame < 600 && activeFurnitureSettleCount() > 0; frame++) stepFurnitureSettles(1 / 60);
  expect(activeFurnitureSettleCount()).toBe(0);
}

describe("SelectionSystem's carry and release", () => {
  it("wakes the frame loop when it lets go of a piece still in hand, so its set-down is drawn", () => {
    render(<SelectionSystem />);
    pointer("pointerDown", 200, 200, 1_000);
    pointer("pointerMove", 220, 198, 1_016);
    pointer("pointerMove", 226, 197, 1_032);
    // A beat in hand: lifted off the floor, and not yet set down by a resting hand.
    for (let frame = 0; frame < 6; frame++) stepFurnitureSettles(1 / 60);
    invalidate.mockClear();
    pointer("pointerUp", 226, 197, 1_140);
    expect(activeFurnitureSettleCount()).toBeGreaterThan(0);
    expect(invalidate).toHaveBeenCalled();
    expect(stepFurnitureSettles(1 / 60).length).toBeGreaterThan(0);
    runUntilAtRest();
  });

  it("has nothing left to move on release once a hand held still has set the piece down", () => {
    render(<SelectionSystem />);
    pointer("pointerDown", 200, 200, 1_000);
    pointer("pointerMove", 220, 198, 1_016);
    pointer("pointerMove", 226, 197, 1_032);
    // The hand rests: the lean stands up, the piece is set down where it is, and the loop sleeps.
    runUntilAtRest();
    pointer("pointerUp", 226, 197, 3_000);
    // A careful let-go dips nothing, so nothing is left to draw.
    expect(activeFurnitureSettleCount()).toBe(0);
  });

  it("starts no motion and asks for no frame on release under reduced motion", () => {
    motion.reduced = true;
    render(<SelectionSystem />);
    pointer("pointerDown", 200, 200, 1_000);
    pointer("pointerMove", 220, 198, 1_016);
    pointer("pointerMove", 226, 197, 1_032);
    expect(activeFurnitureSettleCount()).toBe(0);
    invalidate.mockClear();
    pointer("pointerUp", 226, 197, 3_000);
    // Nothing else on this release path asks for a frame, so the wake in the
    // test above is the set-down's own.
    expect(invalidate).not.toHaveBeenCalled();
    expect(activeFurnitureSettleCount()).toBe(0);
    expect(carryFurniture).not.toHaveBeenCalled();
  });

  it("leans nothing on a drag's first move and reads its speed from the next", () => {
    render(<SelectionSystem />);
    pointer("pointerDown", 200, 200, 1_000);
    pointer("pointerMove", 220, 198, 1_016);
    // The first move carries the whole drag threshold since the press: no speed in it.
    expect(carryFurniture).not.toHaveBeenCalled();
    const before = tableAt();
    pointer("pointerMove", 224, 198, 1_032);
    const after = tableAt();
    expect(after.x).not.toBe(before.x);
    expect(carryFurniture).toHaveBeenCalledOnce();
    const [, vx, vz] = vi.mocked(carryFurniture).mock.calls[0] ?? [];
    expect(vx).toBeCloseTo((after.x - before.x) / 0.016, 6);
    expect(vz).toBeCloseTo((after.z - before.z) / 0.016, 6);
    pointer("pointerUp", 224, 198, 1_048);
  });

  it("does not hand a cancelled drag's speed to the next drag", () => {
    render(<SelectionSystem />);
    pointer("pointerDown", 200, 200, 1_000);
    pointer("pointerMove", 220, 198, 1_016);
    pointer("pointerMove", 260, 194, 1_032); // a brisk carry
    expect(carryFurniture).toHaveBeenCalledOnce();
    pointer("pointerCancel", 260, 194, 1_040);
    vi.mocked(carryFurniture).mockClear();

    pointer("pointerDown", 200, 200, 5_000);
    pointer("pointerMove", 220, 198, 5_016);
    expect(carryFurniture).not.toHaveBeenCalled();
    const before = tableAt();
    pointer("pointerMove", 222, 198, 5_032);
    const after = tableAt();
    expect(carryFurniture).toHaveBeenCalledOnce();
    const [, vx, vz] = vi.mocked(carryFurniture).mock.calls[0] ?? [];
    // This drag's own slow speed, none of the last one's.
    expect(vx).toBeCloseTo((after.x - before.x) / 0.016, 6);
    expect(vz).toBeCloseTo((after.z - before.z) / 0.016, 6);
    pointer("pointerUp", 222, 198, 5_048);
  });
});

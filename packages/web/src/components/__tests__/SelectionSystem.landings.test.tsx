import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import {
  activeFurnitureSettleCount,
  clearAllFurnitureSettles,
  stepFurnitureSettles,
  subscribeFurnitureLandings,
  type FurnitureLanding,
} from "../../lib/furniture-motion.js";
import { createPlacedItem } from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

// ---------------------------------------------------------------------------
// The hand's half of the landing seam (T-700): a let-go chair starts down at
// the hand's speed and lands on a frame. Under reduced motion nothing comes
// down, so the release announces the chair landed where it stands, at the
// speed the hand was carrying it (ruling R84).
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => motion.reduced }));

interface Heard {
  readonly callback: "pickedUp" | "dropStarted" | "touchedDown" | "landedInPlace";
  readonly id: string;
  readonly landing: FurnitureLanding | null;
  readonly handSpeed: number | null;
}

let canvas: HTMLCanvasElement;
let geometry: BoxGeometry;
let material: MeshBasicMaterial;
let invalidate: Mock<() => void>;
let chairId = "";
let now = 0;
let heard: Heard[] = [];
let stopHearing: () => void = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  now = 1_000;
  heard = [];
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
  const chairType = getCatalogueItemBySlug("banquet-chair");
  if (chairType === undefined) throw new Error("Missing canonical chair");
  const chair = createPlacedItem(chairType.id, 0, 0);
  chairId = chair.id;
  // Snap off: nothing but the hand moves the chair.
  usePlacementStore.setState({ placedItems: [chair], snapEnabled: false });
  useSelectionStore.getState().select(chair.id);
  const scene = new Scene();
  const root = new Group();
  root.name = "placed-furniture";
  const furniture = new Group();
  furniture.name = `furniture-${chair.id}`;
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
  stopHearing = subscribeFurnitureLandings({
    pickedUp: (id) => { heard.push({ callback: "pickedUp", id, landing: null, handSpeed: null }); },
    dropStarted: (id, landing, handSpeed) => { heard.push({ callback: "dropStarted", id, landing, handSpeed }); },
    touchedDown: (id, landing, _contactSpeed, handSpeed) => { heard.push({ callback: "touchedDown", id, landing, handSpeed }); },
    landedInPlace: (id, landing, handSpeed) => { heard.push({ callback: "landedInPlace", id, landing, handSpeed }); },
  });
});

afterEach(() => {
  stopHearing();
  cleanup();
  canvas.remove();
  geometry.dispose();
  material.dispose();
  clearAllFurnitureSettles();
  useEditorStore.getState().reset();
  vi.restoreAllMocks();
});

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number, at: number): void {
  now = at;
  act(() => { fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", isPrimary: true,
    button: 0, buttons: type === "pointerUp" ? 0 : 1, clientX: x, clientY: y }); });
}

function chairAt(): { readonly x: number; readonly z: number } {
  const chair = usePlacementStore.getState().placedItems.find((item) => item.id === chairId);
  if (chair === undefined) throw new Error("Missing chair");
  return { x: chair.x, z: chair.z };
}

/** Presses the chair and carries it: the first move starts the clock, the second is the hand's speed. Returns that speed, m/s. */
function carryChair(): number {
  pointer("pointerDown", 200, 200, 1_000);
  pointer("pointerMove", 220, 198, 1_016);
  const before = chairAt();
  pointer("pointerMove", 226, 197, 1_032);
  const after = chairAt();
  return Math.hypot(after.x - before.x, after.z - before.z) / 0.016;
}

describe("SelectionSystem's landings", () => {
  it("announces a let-go chair landed in place under reduced motion, at the hand's speed, once", () => {
    motion.reduced = true;
    render(<SelectionSystem />);
    const handSpeed = carryChair();
    expect(handSpeed).toBeGreaterThan(0);
    expect(heard).toEqual([]);
    pointer("pointerUp", 226, 197, 1_048);
    expect(heard).toHaveLength(1);
    const [landed] = heard;
    expect(landed?.callback).toBe("landedInPlace");
    expect(landed?.id).toBe(chairId);
    expect(landed?.landing).toBe("let-go");
    expect(landed?.handSpeed).toBeCloseTo(handSpeed, 6);
    // Nothing comes down under reduced motion, so nothing touches down.
    expect(activeFurnitureSettleCount()).toBe(0);
    for (let frame = 0; frame < 30; frame++) stepFurnitureSettles(1 / 60);
    expect(heard).toHaveLength(1);
  });

  it("starts a let-go chair down and hears it touch down, with nothing landed in place, in full motion", () => {
    render(<SelectionSystem />);
    carryChair();
    expect(heard).toEqual([{ callback: "pickedUp", id: chairId, landing: null, handSpeed: null }]);
    // A beat in hand: lifted off the floor, and not yet set down by a resting hand.
    for (let frame = 0; frame < 6; frame++) stepFurnitureSettles(1 / 60);
    pointer("pointerUp", 226, 197, 1_140);
    const drops = heard.filter((entry) => entry.callback === "dropStarted");
    expect(drops).toHaveLength(1);
    expect(drops[0]?.id).toBe(chairId);
    expect(drops[0]?.landing).toBe("let-go");
    expect(drops[0]?.handSpeed).toBeGreaterThan(0);
    for (let frame = 0; frame < 60 && activeFurnitureSettleCount() > 0; frame++) stepFurnitureSettles(1 / 60);
    expect(heard.filter((entry) => entry.callback === "touchedDown")).toEqual([
      { callback: "touchedDown", id: chairId, landing: "let-go", handSpeed: drops[0]?.handSpeed },
    ]);
    expect(heard.some((entry) => entry.callback === "landedInPlace")).toBe(false);
  });
});

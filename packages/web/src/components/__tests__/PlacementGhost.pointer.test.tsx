import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene } from "three";
import { PlacementGhost } from "../PlacementGhost.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { PLANNER_INTERACTION_FLOOR_NAME } from "../../lib/planner-interaction-floor.js";

const graphics = vi.hoisted(() => ({ get: vi.fn<() => {
  scene: Scene;
  camera: PerspectiveCamera;
  raycaster: Raycaster;
  gl: { domElement: HTMLCanvasElement };
  invalidate: () => void;
}>() }));
vi.mock("@react-three/fiber", () => ({ useThree: () => graphics.get() }));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => null }));
vi.mock("../ConstraintViolationSkin.js", () => ({ ConstraintViolationSkin: () => null }));

let canvas: HTMLCanvasElement;
let scene: Scene;
let target: Mesh<PlaneGeometry, MeshBasicMaterial>;
const pointDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
const item = getCatalogueItemBySlug("poseur-table");
if (item === undefined) throw new Error("Poseur fixture missing");
const itemId = item.id;

beforeEach(() => {
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

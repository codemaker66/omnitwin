import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createTableGroup } from "../../lib/table-group.js";
import { PLANNER_INTERACTION_FLOOR_NAME, placementFloorPoint } from "../../lib/planner-interaction-floor.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { PLANNER_CHROME_STORAGE_KEY } from "../../lib/planner-chrome-flag.js";
import { useCameraReferenceStore } from "../../stores/camera-reference-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { GHOST_RAISE_PX, LIFT_HOLD_MS, PLACE_HOLD_MS } from "../../lib/touch-arbiter.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { setLayoutTimelineMutationLock } from "../../lib/layout-timeline-preview-lock.js";
import { asOneUndoStep } from "../../lib/planner-keymap.js";
import * as configApi from "../../api/configurations.js";
import { editorToPlacedItem, placedItemToEditor } from "../editor/EditorBridge.js";

// ---------------------------------------------------------------------------
// The touch arbiter in the planner (spec-card-dock §10.1): a swipe looks
// round even with a piece in hand, a quick tap places under the finger, a
// hold raises the ghost and the lift places it where it was seen, a second
// finger never places, and a still finger on a piece lifts it.
// ---------------------------------------------------------------------------

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));
// Only the save a layout sends is replaced: the cases below hold its answer and choose when it lands.
vi.mock(import("../../api/configurations.js"), async (original) => ({ ...await original(), publicBatchSave: vi.fn() }));

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

/** The layout as loaded: the round and its chairs, unsaved (local ids), in a public draft. */
function seedUnsavedLayout(): void {
  useEditorStore.setState({
    configId: "cfg-touch", spaceId: "space-touch", venueId: "venue-touch", configRevision: 1, isPublicPreview: true,
    objects: usePlacementStore.getState().placedItems.map((item) => placedItemToEditor(item, undefined)),
  });
}

/** The round's id in the editor's document: the server's once its first save has landed. */
function roundIdInTheEditor(): string {
  const round = getCatalogueItemBySlug("round-table-6ft");
  const id = useEditorStore.getState().objects.find((object) => object.assetDefinitionId === round?.id)?.id;
  if (id === undefined) throw new Error("The round is not in the editor's document");
  return id;
}

interface HeldSave {
  readonly sent: () => boolean;
  /**
   * Answers the save as the API does, every insert under a server id. Unless
   * `redraw` is false, the scene then redraws under those ids (`redraw`).
   */
  readonly land: (options?: { readonly redraw?: boolean }) => Promise<boolean>;
  /** EditorBridge's editor-to-placement effect: the scene redraws under the server's ids. */
  readonly redraw: () => void;
}

/** Holds the next save's answer until `land`. */
function holdTheSave(): HeldSave {
  let answer: ((value: configApi.BatchSaveResponse) => void) | null = null;
  let batch: readonly configApi.BatchObjectInput[] = [];
  vi.mocked(configApi.publicBatchSave).mockImplementationOnce(async (_configId, objects, expectedRevision) => {
    batch = objects;
    return new Promise((resolve) => {
      answer = (value) => { resolve({ ...value, revision: expectedRevision + 1 }); };
    });
  });
  let saving: Promise<boolean> | null = null;
  act(() => { saving = useEditorStore.getState().saveToServer(false); });
  const redraw = (): void => {
    act(() => {
      usePlacementStore.setState({ placedItems: useEditorStore.getState().objects.map(editorToPlacedItem) });
    });
    const furniture = scene.getObjectByName(`furniture-${tableId}`);
    const round = getCatalogueItemBySlug("round-table-6ft");
    tableId = usePlacementStore.getState().placedItems.find((item) => item.catalogueItemId === round?.id)?.id ?? tableId;
    if (furniture !== undefined) furniture.name = `furniture-${tableId}`;
  };
  return {
    sent: () => answer !== null,
    redraw,
    land: async ({ redraw: andRedraw = true } = {}) => {
      if (answer === null || saving === null) throw new Error("No save in flight");
      const respond = answer;
      const pending: Promise<boolean> = saving;
      await act(async () => {
        respond({
          revision: 0,
          objects: batch.map((object, index) => ({
            ...object, id: object.id ?? `srv-${String(index)}`, configurationId: "cfg-touch",
            positionX: String(object.positionX), positionY: String(object.positionY), positionZ: String(object.positionZ),
            rotationX: String(object.rotationX), rotationY: String(object.rotationY), rotationZ: String(object.rotationZ),
            scale: String(object.scale), metadata: object.metadata ?? null,
          })),
        });
        await pending;
      });
      if (andRedraw) redraw();
      return pending;
    },
  };
}

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

  describe("while the layout's save is in flight", () => {
    it("lifts the piece held when its first save lands during the hold, under the server's id", async () => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      const localId = tableId;
      const before = tableAt();
      const save = holdTheSave();
      expect(save.sent()).toBe(true);
      finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
      wait(1_100);
      // The save lands inside the 300 ms hold: the round is now the server's row.
      expect(await save.land()).toBe(true);
      expect(tableId).not.toBe(localId);
      expect(usePlacementStore.getState().placedItems.some((item) => item.id === localId)).toBe(false);
      wait(1_000 + LIFT_HOLD_MS + FRAME);
      expect(useTouchGestureStore.getState().mode).toBe("lift");
      expect(window.__plannerTouch?.carrying()).toBe(tableId);
      expect(useSelectionStore.getState().selectedIds.has(tableId)).toBe(true);
      // It rose above the finger at once, and follows it.
      expect(tableAt().z).toBeLessThan(before.z);
      finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
      finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
      expect(tableAt().x).toBeLessThan(before.x - 0.5);
      expect(window.__plannerTouch?.carrying()).toBeNull();
      expect(useTouchGestureStore.getState().mode).toBe("idle");
    });

    it("lifts the piece held when its save lands during the hold but the scene has not yet redrawn under the server's id", async () => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      const localId = tableId;
      const before = tableAt();
      const save = holdTheSave();
      finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
      wait(1_100);
      // The editor holds the server's ids; the scene (EditorBridge's effect, a render later) still has the local one.
      expect(await save.land({ redraw: false })).toBe(true);
      const serverId = roundIdInTheEditor();
      expect(serverId).not.toBe(localId);
      expect(usePlacementStore.getState().placedItems.some((item) => item.id === localId)).toBe(true);
      wait(1_000 + LIFT_HOLD_MS + FRAME);
      // The lift finds the piece under the id it was pressed on, and carries it under the one it is about to take.
      expect(useTouchGestureStore.getState().mode).toBe("lift");
      expect(window.__plannerTouch?.carrying()).toBe(serverId);
      expect(useSelectionStore.getState().selectedIds.has(serverId)).toBe(true);
      save.redraw();
      expect(tableId).toBe(serverId);
      finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
      // Above the finger, from where it was grabbed.
      expect(tableAt().z).toBeLessThan(before.z);
      finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
      expect(tableAt().x).toBeLessThan(before.x - 0.5);
      expect(window.__plannerTouch?.carrying()).toBeNull();
      expect(useTouchGestureStore.getState().mode).toBe("idle");
    });

    it.each([
      ["a quick tap", (): void => { finger("pointerUp", OVER_TABLE.x, OVER_TABLE.y, 1_120); }],
      ["a swipe that turns to the camera", (): void => {
        finger("pointerMove", OVER_TABLE.x + 40, OVER_TABLE.y, 1_060);
        finger("pointerUp", OVER_TABLE.x + 40, OVER_TABLE.y, 1_200);
      }],
      ["a cancelled hold", (): void => { finger("pointerCancel", OVER_TABLE.x, OVER_TABLE.y, 1_150); }],
    ])("holds back no save after %s on a piece", async (_name, end) => {
      seedUnsavedLayout();
      vi.mocked(configApi.publicBatchSave).mockClear();
      render(<SelectionSystem />);
      finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
      // While the finger may yet lift the piece, a save would seal a gesture half made: it waits, as under a mouse press.
      expect(await useEditorStore.getState().saveToServer(false)).toBe(false);
      expect(configApi.publicBatchSave).not.toHaveBeenCalled();
      end();
      expect(window.__plannerTouch?.carrying()).toBeNull();
      const save = holdTheSave();
      expect(save.sent()).toBe(true);
      expect(await save.land()).toBe(true);
    });
  });

  describe("when the press's gesture, or its piece, is gone by the time of the lift", () => {
    it.each([
      // Pressing the tool pill's chip fences the undo timeline: the editor ends every gesture, and says nothing this component hears.
      ["a scrub on the tool pill", (): void => { useEditorStore.getState().bumpHistoryEpoch(); }],
      // An edit from the keys is its own undo step: it ends the gesture, and its write tells this component so.
      ["an edit from the keys", (): void => {
        asOneUndoStep(() => {
          const objects = useEditorStore.getState().objects;
          useEditorStore.getState().replaceObjectsFromScene(objects.map((object) => (object.id === tableId ? object : { ...object, positionX: object.positionX + 0.25 })));
        });
      }],
    ])("still lifts the piece held after %s during the hold, in a gesture of its own", (_name, interrupt) => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      const before = tableAt();
      finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
      wait(1_100);
      act(interrupt);
      wait(1_000 + LIFT_HOLD_MS + FRAME);
      expect(useTouchGestureStore.getState().mode).toBe("lift");
      expect(window.__plannerTouch?.carrying()).toBe(tableId);
      expect(tableAt().z).toBeLessThan(before.z);
      finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
      finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
      expect(tableAt().x).toBeLessThan(before.x - 0.5);
      expect(useTouchGestureStore.getState().mode).toBe("idle");
      // The lift's own gesture ended with its drop: no save is held back.
      expect(holdTheSave().sent()).toBe(true);
    });

    it.each([
      ["the piece has left the layout", (): void => {
        usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.filter((item) => item.id !== tableId) });
      }],
      // A history preview holds the layout still: no gesture can open on it.
      ["a history preview holds the layout", (): void => { setLayoutTimelineMutationLock(true); }],
    ])("hands the finger to the camera, carrying nothing, when %s", (_name, interrupt) => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      try {
        finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
        wait(1_100);
        act(interrupt);
        wait(1_000 + LIFT_HOLD_MS + FRAME);
        // Nothing is carried, so the finger is not held still for nothing: it looks round.
        expect(window.__plannerTouch?.carrying()).toBeNull();
        expect(useTouchGestureStore.getState().mode).toBe("orbit");
        expect(useTouchGestureStore.getState().cameraHeld).toBe(false);
        finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
        expect(useTouchGestureStore.getState().mode).toBe("orbit");
        expect(useTouchGestureStore.getState().cameraHeld).toBe(false);
        finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
        expect(useTouchGestureStore.getState().mode).toBe("idle");
      } finally {
        setLayoutTimelineMutationLock(false);
      }
      // The refused lift left no gesture open: the next save is not held back.
      expect(holdTheSave().sent()).toBe(true);
    });

    // A page too busy to run the hold's timer on time: the lift comes with a move the finger made
    // after the hold, still within the slop, handed over before the timer ran (the arbiter's move
    // judges the hold as its tick does).
    it.each([
      ["the piece has left the layout", (): void => {
        usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.filter((item) => item.id !== tableId) });
      }],
      ["a history preview holds the layout", (): void => { setLayoutTimelineMutationLock(true); }],
    ])("hands the finger to the camera, carrying nothing, when %s and the lift comes with a late move", (_name, interrupt) => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      try {
        finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
        wait(1_100);
        act(interrupt);
        lateMove(OVER_TABLE.x + 2, OVER_TABLE.y, 1_000 + LIFT_HOLD_MS + 5);
        // The move that brought the lift does not hold the camera still for the lift refused.
        expect(window.__plannerTouch?.carrying()).toBeNull();
        expect(useTouchGestureStore.getState().mode).toBe("orbit");
        expect(useTouchGestureStore.getState().cameraHeld).toBe(false);
        // Nor does it stay held for the rest of the touch.
        finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
        expect(useTouchGestureStore.getState().mode).toBe("orbit");
        expect(useTouchGestureStore.getState().cameraHeld).toBe(false);
        finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
        expect(useTouchGestureStore.getState().mode).toBe("idle");
      } finally {
        setLayoutTimelineMutationLock(false);
      }
      expect(holdTheSave().sent()).toBe(true);
    });

    it("lifts the piece held, and holds the camera while it carries, when the lift comes with a late move", () => {
      seedUnsavedLayout();
      render(<SelectionSystem />);
      const before = tableAt();
      finger("pointerDown", OVER_TABLE.x, OVER_TABLE.y, 1_000);
      wait(1_100);
      lateMove(OVER_TABLE.x + 2, OVER_TABLE.y, 1_000 + LIFT_HOLD_MS + 5);
      expect(useTouchGestureStore.getState().mode).toBe("lift");
      expect(window.__plannerTouch?.carrying()).toBe(tableId);
      expect(useTouchGestureStore.getState().cameraHeld).toBe(true);
      finger("pointerMove", OVER_TABLE.x - 60, OVER_TABLE.y, 1_400);
      expect(useTouchGestureStore.getState().cameraHeld).toBe(true);
      finger("pointerUp", OVER_TABLE.x - 60, OVER_TABLE.y, 1_500);
      expect(tableAt().x).toBeLessThan(before.x - 0.5);
      expect(useTouchGestureStore.getState().mode).toBe("idle");
    });
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

describe("a double-click on a placed table (QoL B-01)", () => {
  /** The client point over the round at x 4: where a double-click lands on it. */
  function overTheRound(): { readonly clientX: number; readonly clientY: number } {
    const at = new Vector3(4, 0.5, 0).project(camera);
    return { clientX: ((at.x + 1) / 2) * 400, clientY: ((1 - at.y) / 2) * 400 };
  }

  it("selects the table in v2 and the HUD, which mount no chair dialog, and opens the dialog in v1 as before", () => {
    render(<SelectionSystem />);
    try {
      for (const chrome of ["v2", "hud"]) {
        window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, chrome);
        act(() => { useSelectionStore.getState().clearSelection(); });
        act(() => { fireEvent.dblClick(canvas, { ...overTheRound(), button: 0 }); });
        expect(useChairDialogStore.getState().pending, chrome).toBeNull();
        expect(useSelectionStore.getState().selectedIds.has(tableId), chrome).toBe(true);
      }
      window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v1");
      act(() => { fireEvent.dblClick(canvas, { ...overTheRound(), button: 0 }); });
      expect(useChairDialogStore.getState().pending).toMatchObject({ tableShape: "round" });
    } finally {
      window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
      useChairDialogStore.getState().clearDialog();
    }
  });
});

// The viewpoint's composer is mounted by the first chrome alone (App.tsx). A draft opened under another would be
// shown by nothing, and an open draft holds the camera's keys (lib/camera-rig.ts).
describe("a right click on the room with nothing in hand", () => {
  function rightClickOnTheFloor(): void {
    act(() => {
      fireEvent.mouseDown(canvas, { button: 2, buttons: 2, clientX: 120, clientY: 300 });
      fireEvent.mouseUp(canvas, { button: 2, clientX: 120, clientY: 300 });
    });
  }

  it("opens a viewpoint's draft under the first chrome, which shows it, and none under v2 or the HUD", () => {
    render(<SelectionSystem />);
    try {
      for (const chrome of ["v2", "hud"]) {
        window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, chrome);
        rightClickOnTheFloor();
        expect(useCameraReferenceStore.getState().draft, chrome).toBeNull();
      }
      window.localStorage.setItem(PLANNER_CHROME_STORAGE_KEY, "v1");
      rightClickOnTheFloor();
      expect(useCameraReferenceStore.getState().draft).toMatchObject({ source: "floor" });
    } finally {
      window.localStorage.removeItem(PLANNER_CHROME_STORAGE_KEY);
      useCameraReferenceStore.getState().closeDraft();
    }
  });
});

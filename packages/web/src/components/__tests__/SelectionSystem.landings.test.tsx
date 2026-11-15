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
  type FurnitureLandingListener,
} from "../../lib/furniture-motion.js";
import { createPlacedItem } from "../../lib/placement.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { setPlannerFeaturesForTesting } from "../../lib/planner-features.js";
import { LIFT_HOLD_MS } from "../../lib/touch-arbiter.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

// ---------------------------------------------------------------------------
// The hand's half of the landing seam (T-700): a let-go chair starts down at
// the hand's speed and lands on a frame. Under reduced motion nothing comes
// down, so the release announces the chair landed where it stands, at the
// speed the hand was carrying it (ruling R84). A move cut short with nothing
// let go is set down where it stands; a history change, a preview or an
// unmount is silent (R85).
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

const recorder: FurnitureLandingListener = {
  pickedUp: (id) => { heard.push({ callback: "pickedUp", id, landing: null, handSpeed: null }); },
  dropStarted: (id, landing, handSpeed) => { heard.push({ callback: "dropStarted", id, landing, handSpeed }); },
  touchedDown: (id, landing, _contactSpeed, handSpeed) => { heard.push({ callback: "touchedDown", id, landing, handSpeed }); },
  landedInPlace: (id, landing, handSpeed) => { heard.push({ callback: "landedInPlace", id, landing, handSpeed }); },
};

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
  stopHearing = subscribeFurnitureLandings(recorder);
});

afterEach(() => {
  stopHearing();
  cleanup();
  canvas.remove();
  geometry.dispose();
  material.dispose();
  clearAllFurnitureSettles();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number, at: number): void {
  now = at;
  act(() => { fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", isPrimary: true,
    button: 0, buttons: type === "pointerUp" || type === "pointerCancel" ? 0 : 1, clientX: x, clientY: y }); });
}

function pressEscape(): void {
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); });
}

function blurWindow(): void {
  act(() => { fireEvent.blur(window); });
}

function landedInPlace(): Heard[] {
  return heard.filter((entry) => entry.callback === "landedInPlace");
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

describe("a move cut short (R85)", () => {
  it.each([
    ["Escape", pressEscape],
    ["a cancelled pointer", (): void => { pointer("pointerCancel", 226, 197, 1_100); }],
    ["a lost pointer capture", (): void => { act(() => { fireEvent.lostPointerCapture(canvas, { pointerId: 1 }); }); }],
    ["the window losing focus", blurWindow],
  ])("announces a chair stopped by %s set down where it stands, once, under reduced motion", (_name, stop) => {
    motion.reduced = true;
    render(<SelectionSystem />);
    carryChair();
    stop();
    expect(heard).toEqual([{ callback: "landedInPlace", id: chairId, landing: "set-down", handSpeed: 0 }]);
    // Nothing is left to announce: the release, a second Escape or blur finds the gesture closed.
    pointer("pointerUp", 226, 197, 1_200);
    pressEscape();
    blurWindow();
    expect(heard).toHaveLength(1);
  });

  it("in full motion, announces nothing in place: the resting hand sets the chair down", () => {
    render(<SelectionSystem />);
    carryChair();
    for (let frame = 0; frame < 6; frame++) stepFurnitureSettles(1 / 60);
    pressEscape();
    for (let frame = 0; frame < 120 && activeFurnitureSettleCount() > 0; frame++) stepFurnitureSettles(1 / 60);
    expect(landedInPlace()).toEqual([]);
    expect(heard.filter((entry) => entry.callback === "dropStarted").map((entry) => entry.landing)).toEqual(["set-down"]);
    expect(heard.filter((entry) => entry.callback === "touchedDown").map((entry) => entry.landing)).toEqual(["set-down"]);
  });

  it.each([
    ["an undo", (): void => { act(() => { useEditorStore.getState().undo(); }); }],
    ["a history epoch bump", (): void => { act(() => { useEditorStore.getState().bumpHistoryEpoch(); }); }],
    ["a preview starting", (): void => { act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading phase"); }); }],
  ])("announces nothing when %s ends the move under reduced motion", (_name, end) => {
    motion.reduced = true;
    render(<SelectionSystem />);
    carryChair();
    end();
    pointer("pointerMove", 240, 190, 1_064);
    pointer("pointerUp", 240, 190, 1_080);
    pressEscape();
    blurWindow();
    expect(heard).toEqual([]);
  });

  it("finishes a release whose listener throws: the error is reported, the next listener hears it, the gesture closes", () => {
    motion.reduced = true;
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("a listener's fault");
    // The thrower ahead of the recorder.
    stopHearing();
    const stopThrowing = subscribeFurnitureLandings({
      pickedUp: () => undefined,
      dropStarted: () => undefined,
      touchedDown: () => undefined,
      landedInPlace: () => { throw failure; },
    });
    stopHearing = subscribeFurnitureLandings(recorder);
    try {
      render(<SelectionSystem />);
      carryChair();
      pointer("pointerUp", 226, 197, 1_048);
      expect(reportError).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith(failure);
      expect(landedInPlace().map((entry) => [entry.id, entry.landing])).toEqual([[chairId, "let-go"]]);
      // settleDrop forgot the moved pieces and the gesture closed: a blur or Escape now sets nothing down.
      blurWindow();
      pressEscape();
      expect(heard).toHaveLength(1);
      expect(reportError).toHaveBeenCalledOnce();
    } finally {
      stopThrowing();
    }
  });
});

describe("a touch lift under reduced motion (R85)", () => {
  /** A frame after a timer, as the hold is judged (SelectionSystem.touch.test.tsx). */
  const FRAME = 20;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    setPlannerFeaturesForTesting({ touchArbiter: true });
    useCockpitStore.setState({ walkMode: false, cameraInteractionActive: false });
    useTouchGestureStore.getState().end(-Infinity);
    motion.reduced = true;
  });

  afterEach(() => {
    cleanup();
    setPlannerFeaturesForTesting(null);
    vi.useRealTimers();
  });

  /** A finger event at `at` ms, the timers due by then run first. */
  function finger(type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number, at: number, pointerId = 1): void {
    act(() => {
      const elapsed = Math.max(0, at - now);
      now = at;
      vi.advanceTimersByTime(elapsed);
      fireEvent[type](canvas, { pointerId, pointerType: "touch", isPrimary: pointerId === 1, button: 0,
        buttons: type === "pointerUp" ? 0 : 1, clientX: x, clientY: y });
    });
  }

  function wait(at: number): void {
    act(() => {
      const elapsed = Math.max(0, at - now);
      now = at;
      vi.advanceTimersByTime(elapsed);
    });
  }

  /** Holds a finger still on the chair until it lifts, then carries it. */
  function liftAndCarry(): void {
    finger("pointerDown", 200, 200, 1_000);
    wait(1_000 + LIFT_HOLD_MS + FRAME);
    expect(useTouchGestureStore.getState().mode).toBe("lift");
    finger("pointerMove", 150, 220, 1_400);
  }

  it("announces a lifted chair returned by a second finger landed in place, exactly once", () => {
    render(<SelectionSystem />);
    liftAndCarry();
    expect(heard).toEqual([]);
    finger("pointerDown", 100, 100, 1_450, 2);
    expect(landedInPlace()).toHaveLength(1);
    expect(landedInPlace()[0]?.id).toBe(chairId);
    expect(landedInPlace()[0]?.landing).toBe("let-go");
    expect(landedInPlace()[0]?.handSpeed).toBeGreaterThan(0);
    finger("pointerUp", 150, 220, 1_500);
    finger("pointerUp", 100, 100, 1_520, 2);
    blurWindow();
    expect(heard).toHaveLength(1);
  });

  it("announces nothing when the planner unmounts mid-lift", () => {
    const view = render(<SelectionSystem />);
    liftAndCarry();
    view.unmount();
    blurWindow();
    expect(heard).toEqual([]);
  });

  // The touch blur (registered first) returns the piece and announces its
  // let-go; the window's blur stop then finds nothing left to set down.
  it("announces a lifted chair once, as let go, when the window loses focus", () => {
    render(<SelectionSystem />);
    liftAndCarry();
    blurWindow();
    expect(heard.map((entry) => [entry.callback, entry.id, entry.landing])).toEqual([["landedInPlace", chairId, "let-go"]]);
  });
});

describe("a key edit mid-drag (R88)", () => {
  /** Presses a key on the window, where the planner's one key listener hears it. */
  function pressKey(init: KeyboardEventInit): void {
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
  }

  const stoppingEdits: [string, KeyboardEventInit][] = [
    ["a turn (Q)", { code: "KeyQ", key: "q" }],
    ["a nudge (an arrow)", { code: "ArrowUp", key: "ArrowUp" }],
    ["a cloth (C)", { code: "KeyC", key: "c" }],
    ["a group (Ctrl G)", { code: "KeyG", key: "g", ctrlKey: true }],
    ["an ungroup (Ctrl Shift G)", { code: "KeyG", key: "G", ctrlKey: true, shiftKey: true }],
    ["a duplicate (Ctrl D)", { code: "KeyD", key: "d", ctrlKey: true }],
  ];
  const deleteKey: KeyboardEventInit = { code: "Delete", key: "Delete" };

  beforeEach(() => {
    // Duplicate sits behind the editing keys.
    setPlannerFeaturesForTesting({ editingKeys: true });
  });

  afterEach(() => {
    setPlannerFeaturesForTesting(null);
  });

  it.each(stoppingEdits)("announces the chair set down where it stands, once, when %s stops the drag under reduced motion", (_name, key) => {
    motion.reduced = true;
    render(<SelectionSystem />);
    carryChair();
    pressKey(key);
    expect(heard).toEqual([{ callback: "landedInPlace", id: chairId, landing: "set-down", handSpeed: 0 }]);
    pointer("pointerUp", 226, 197, 1_200);
    pressEscape();
    blurWindow();
    expect(heard).toHaveLength(1);
  });

  it("announces nothing when Delete takes the dragged chair, under reduced motion", () => {
    motion.reduced = true;
    render(<SelectionSystem />);
    carryChair();
    pressKey(deleteKey);
    expect(usePlacementStore.getState().placedItems.some((item) => item.id === chairId)).toBe(false);
    pointer("pointerUp", 226, 197, 1_200);
    pressEscape();
    blurWindow();
    expect(heard).toEqual([]);
  });

  const everyEdit: [string, KeyboardEventInit][] = [...stoppingEdits, ["Delete", deleteKey]];

  it.each(everyEdit)("in full motion, announces nothing in place when %s stops the drag: the resting hand sets the chair down", (_name, key) => {
    render(<SelectionSystem />);
    carryChair();
    for (let frame = 0; frame < 6; frame++) stepFurnitureSettles(1 / 60);
    pressKey(key);
    for (let frame = 0; frame < 120 && activeFurnitureSettleCount() > 0; frame++) stepFurnitureSettles(1 / 60);
    expect(landedInPlace()).toEqual([]);
    expect(heard.filter((entry) => entry.callback === "dropStarted").map((entry) => entry.landing)).toEqual(["set-down"]);
    expect(heard.filter((entry) => entry.callback === "touchedDown").map((entry) => entry.landing)).toEqual(["set-down"]);
  });
});

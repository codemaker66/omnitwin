import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanDrawing } from "../PlanDrawing.js";
import { PlanDrawingSwitch } from "../PlanDrawingSwitch.js";
import { usePlanDrawingStore } from "../plan-drawing-mode.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests, placedItemToEditor } from "../../editor/EditorBridge.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { drawnRoom, fitView, toScreen, type DrawingView } from "../../../lib/plan-drawing-model.js";
import { setPlannerFeaturesForTesting } from "../../../lib/planner-features.js";
import { registerScreenAnchor, type ScreenPoint } from "../../../lib/screen-anchors.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";
import { useToolStore } from "../../../stores/tool-store.js";

// ---------------------------------------------------------------------------
// Plan's Drawing and its switch (T-674; approved spec §4.1, §6.3, §7.2): only
// in Plan; the same layout, selection and undo as the room; a tap selects, a
// drag moves a table with its chairs as one undo step, Esc lets go of a drag,
// the arrows nudge by the page; the caption follows its piece on the paper.
// ---------------------------------------------------------------------------

const after = vi.hoisted(() => ({ callbacks: new Set<() => void>() }));
vi.mock("@react-three/fiber", () => ({
  addAfterEffect: (callback: () => void) => {
    after.callbacks.add(callback);
    return () => { after.callbacks.delete(callback); };
  },
}));
vi.mock("../../../api/configurations.js", () => ({ publicBatchSave: vi.fn(), authBatchSave: vi.fn(), parseRevisionConflict: vi.fn(() => null) }));
vi.mock("../../../api/action-log.js", () => ({ postActionBatch: vi.fn() }));

const STAGE = { width: 1600, height: 1000 };

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}

function piece(id: string, slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { id, catalogueItemId: idOf(slug), x, y: 0, z, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null, ...extra };
}

function table(name: string, label: string, x: number, z: number): PlacedItem[] {
  return [
    piece(name, "round-table-6ft-white", x, z, { groupId: `g-${name}`, label }),
    ...Array.from({ length: 10 }, (_, k) => {
      const angle = (2 * Math.PI * k) / 10;
      return piece(`${name}-c${String(k)}`, "banquet-chair", x + 1.2 * Math.cos(angle), z + 1.2 * Math.sin(angle), { groupId: `g-${name}`, rotationY: -angle - Math.PI / 2 });
    }),
  ];
}

/** The view the drawing fits to on a 1600 × 1000 stage with no chrome round it: the gutters only. */
function expectedView(): DrawingView {
  return fitView(drawnRoom(useRoomDimensionsStore.getState().dimensions, false), { left: 20, top: 20, width: STAGE.width - 40, height: STAGE.height - 40 });
}

function isDrawing(element: Element): boolean {
  return element instanceof HTMLElement && element.dataset["testid"] === "planner-plan-drawing";
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Element) {
    return isDrawing(this) ? new DOMRect(0, 0, STAGE.width, STAGE.height) : new DOMRect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function width(this: HTMLElement) { return isDrawing(this) ? STAGE.width : 0; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function height(this: HTMLElement) { return isDrawing(this) ? STAGE.height : 0; });
  useEditorStore.getState().reset();
  __resetEditorBridgeMountCountForTests();
  const items = [...table("t8", "Table 8", 3, 2), ...table("t3", "Table 3", -4, -1)];
  usePlacementStore.setState({ placedItems: items, snapEnabled: false });
  useEditorStore.setState({ configId: "drawing-layout", configRevision: 1, isPublicPreview: true, objects: items.map((item) => placedItemToEditor(item, undefined)) });
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useToolStore.getState().setTool("select");
  useCockpitStore.getState().setWalkMode(false);
  useHallViewStore.setState({ activePreset: "plan", viewRequest: null });
  usePlanDrawingStore.setState({ register: "model", zoomed: false, fitRequest: 0 });
  useLayoutTimelinePreviewStore.getState().clear();
  after.callbacks.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setPlannerFeaturesForTesting(null);
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
});

async function nextFrame(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); }); });
}

async function openDrawing(): Promise<HTMLElement> {
  render(<><EditorBridge /><PlanDrawingSwitch /><PlanDrawing /></>);
  fireEvent.click(screen.getByRole("radio", { name: "Drawing" }));
  await nextFrame();
  const drawing = screen.getByTestId("planner-plan-drawing");
  await waitFor(() => { expect(drawing.hasAttribute("data-shown")).toBe(true); });
  return drawing;
}

function pieceAt(id: string): Element {
  const element = document.querySelector(`[data-piece="${id}"]`);
  if (element === null) throw new Error(`no ${id} drawn`);
  return element;
}

function screenOf(x: number, z: number): { readonly clientX: number; readonly clientY: number } {
  const at = toScreen(expectedView(), { x, z });
  return { clientX: at.x, clientY: at.y };
}

function press(target: Element, x: number, z: number, extra: Record<string, unknown> = {}): void {
  act(() => { fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, ...screenOf(x, z), ...extra }); });
}

function moveTo(root: Element, x: number, z: number): void {
  act(() => { fireEvent.pointerMove(root, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, ...screenOf(x, z) }); });
}

function letGo(root: Element, x: number, z: number): void {
  act(() => { fireEvent.pointerUp(root, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, ...screenOf(x, z) }); });
}

function placed(id: string): PlacedItem {
  const item = usePlacementStore.getState().placedItems.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`no ${id}`);
  return item;
}

describe("Plan's Model / Drawing switch", () => {
  it("is there only while the view is Plan", () => {
    useHallViewStore.setState({ activePreset: "room" });
    render(<PlanDrawingSwitch />);
    expect(screen.queryByTestId("planner-plan-switch")).toBeNull();
    act(() => { useHallViewStore.setState({ activePreset: "plan" }); });
    const group = within(screen.getByTestId("planner-plan-switch")).getByRole("radiogroup", { name: "Plan as" });
    expect(within(group).getByRole("radio", { name: "Model" }).getAttribute("aria-checked")).toBe("true");
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    expect(screen.queryByTestId("planner-plan-switch")).toBeNull();
  });

  it("sets the drawing over the room and back, never reloading the layout or losing the selection", async () => {
    act(() => { useSelectionStore.getState().select("t8"); });
    const layout = usePlacementStore.getState().placedItems;
    const drawing = await openDrawing();
    expect(drawing.getAttribute("aria-hidden")).toBeNull();
    expect(drawing.querySelector("[data-unit='t8']")?.hasAttribute("data-selected")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Model" }));
    expect(drawing.getAttribute("aria-hidden")).toBe("true");
    expect(drawing.hasAttribute("data-shown")).toBe(false);
    await waitFor(() => { expect(screen.queryByTestId("planner-plan-drawing")).toBeNull(); });
    expect(usePlacementStore.getState().placedItems).toBe(layout);
    expect([...useSelectionStore.getState().selectedIds]).toEqual(["t8"]);
  });

  it("keeps Plan's choice through Room and back", async () => {
    await openDrawing();
    act(() => { useHallViewStore.setState({ activePreset: "room" }); });
    expect(screen.queryByTestId("planner-plan-switch")).toBeNull();
    await waitFor(() => { expect(screen.queryByTestId("planner-plan-drawing")).toBeNull(); });
    act(() => { useHallViewStore.setState({ activePreset: "plan" }); });
    expect(screen.getByRole("radio", { name: "Drawing" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("planner-plan-drawing")).toBeTruthy();
  });

  it("puts the tape down when the drawing is chosen, and shows the model when the pen is taken up", async () => {
    useToolStore.getState().setTool("measure");
    await openDrawing();
    expect(useToolStore.getState().activeTool).toBe("select");
    act(() => { useToolStore.getState().setTool("draw"); });
    expect(usePlanDrawingStore.getState().register).toBe("model");
    expect(screen.getByRole("radio", { name: "Model" }).getAttribute("aria-checked")).toBe("true");
  });

  it("puts down a card in hand when the drawing is chosen", async () => {
    useCatalogueStore.getState().selectItem(idOf("lectern"));
    await openDrawing();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });

  it("says why the drawing waits while an act's layout is showing", () => {
    useLayoutTimelinePreviewStore.setState({ mode: "keyframe" });
    render(<PlanDrawingSwitch />);
    const drawing = screen.getByRole("radio", { name: /^Drawing/u });
    expect(drawing.getAttribute("aria-disabled")).toBe("true");
    expect(drawing.getAttribute("title")).toBe("Close the act's layout first");
    fireEvent.click(drawing);
    expect(usePlanDrawingStore.getState().register).toBe("model");
  });

  it("is not on a phone, where Plan is the model", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("max-width: 767px"), media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
    usePlanDrawingStore.setState({ register: "drawing" });
    render(<><PlanDrawingSwitch /><PlanDrawing /></>);
    expect(screen.queryByTestId("planner-plan-switch")).toBeNull();
    expect(screen.queryByTestId("planner-plan-drawing")).toBeNull();
  });
});

describe("the drawing", () => {
  it("draws each table with its chairs and its own number, and says what is on the floor", async () => {
    const drawing = await openDrawing();
    expect(within(drawing).getByText("Table 8")).toBeTruthy();
    expect(within(drawing).getByText("Table 3")).toBeTruthy();
    expect(drawing.querySelectorAll(".pc-drawing__piece--chair")).toHaveLength(20);
    expect(drawing.querySelectorAll(".pc-drawing__back")).toHaveLength(20);
    expect(within(drawing).getByRole("img").getAttribute("aria-label")).toBe("The drawing of the room: 2 tables and 20 chairs");
    // Drawn to the fit: Table 8's middle where the view puts it.
    const circle = pieceAt("t8");
    const at = toScreen(expectedView(), { x: 3, z: 2 });
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(at.x, 0);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(at.y, 0);
  });

  it("names the Grand Hall's walls, doors and fireplace as staff do", async () => {
    useEditorStore.setState({ space: { id: "s", venueId: "v", name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] } });
    const drawing = await openDrawing();
    for (const words of ["Window wall", "Door wall", "Fireplace wall", "End wall", "Main door", "End door", "Fireplace door", "Fire exit", "Fireplace"]) {
      expect(within(drawing).getByText(words)).toBeTruthy();
    }
    expect(within(drawing).getByRole("img").getAttribute("aria-label")).toBe("The drawing of the Grand Hall: 2 tables and 20 chairs");
  });

  it("selects with a tap, adds with Shift, and clears with a tap on the floor", async () => {
    const drawing = await openDrawing();
    press(pieceAt("t8"), 3, 2);
    letGo(drawing, 3, 2);
    expect([...useSelectionStore.getState().selectedIds]).toEqual(["t8"]);
    press(pieceAt("t3"), -4, -1, { shiftKey: true });
    letGo(drawing, -4, -1);
    expect([...useSelectionStore.getState().selectedIds].sort()).toEqual(["t3", "t8"]);
    press(drawing, 0, 4);
    letGo(drawing, 0, 4);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("moves a table with its chairs as one undo step, and Undo puts it back", async () => {
    const drawing = await openDrawing();
    const before = placed("t8");
    const chair = placed("t8-c0");
    press(pieceAt("t8"), 3, 2);
    moveTo(drawing, 3.5, 2.2);
    moveTo(drawing, 4, 2.5);
    letGo(drawing, 4, 2.5);
    expect(placed("t8").x).toBeCloseTo(before.x + 1, 1);
    expect(placed("t8").z).toBeCloseTo(before.z + 0.5, 1);
    expect(placed("t8-c0").x - chair.x).toBeCloseTo(placed("t8").x - before.x, 6);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    act(() => { useEditorStore.getState().undo(); });
    expect(placed("t8").x).toBeCloseTo(before.x, 6);
    expect(placed("t8-c0").x).toBeCloseTo(chair.x, 6);
  });

  it("lets go of a drag with Esc: the pieces go back and nothing is recorded", async () => {
    const drawing = await openDrawing();
    const before = placed("t8");
    press(pieceAt("t8"), 3, 2);
    moveTo(drawing, 5, 3);
    expect(placed("t8").x).not.toBeCloseTo(before.x, 1);
    act(() => { fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); });
    expect(placed("t8")).toEqual(before);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
    letGo(drawing, 5, 3);
    expect(placed("t8")).toEqual(before);
  });

  it("selects an area with a drag on the floor", async () => {
    const drawing = await openDrawing();
    press(drawing, -7, -4);
    moveTo(drawing, -1, 2);
    letGo(drawing, -1, 2);
    const selected = [...useSelectionStore.getState().selectedIds];
    expect(selected).toContain("t3");
    expect(selected).not.toContain("t8");
  });

  it("nudges by the page: Up is towards the window wall, Right towards the end wall", async () => {
    await openDrawing();
    act(() => { useSelectionStore.getState().select("t8"); });
    const before = placed("t8");
    act(() => { fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp" }); });
    expect(placed("t8").z).toBeCloseTo(before.z - 0.1, 6);
    act(() => { fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", shiftKey: true }); });
    expect(placed("t8").x).toBeCloseTo(before.x + 1, 6);
  });

  it("zooms with the wheel about the pointer, offers Fit, and Fit sets the whole room back", async () => {
    const drawing = await openDrawing();
    const at = screenOf(3, 2);
    const wheel = new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true });
    // happy-dom's WheelEvent leaves out the pointer's position; a browser's carries it.
    Object.defineProperty(wheel, "clientX", { value: at.clientX });
    Object.defineProperty(wheel, "clientY", { value: at.clientY });
    act(() => { drawing.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    await waitFor(() => { expect(usePlanDrawingStore.getState().zoomed).toBe(true); });
    // The table under the pointer stays under it.
    expect(Number(pieceAt("t8").getAttribute("cx"))).toBeCloseTo(at.clientX, 0);
    fireEvent.click(screen.getByRole("button", { name: /^Fit/u }));
    await waitFor(() => { expect(usePlanDrawingStore.getState().zoomed).toBe(false); });
    expect(Number(pieceAt("t3").getAttribute("cx"))).toBeCloseTo(screenOf(-4, -1).clientX, 0);
  });

  it("draws the selection's aisles in the planner's bands where the planner measures them", async () => {
    setPlannerFeaturesForTesting({ liveAisles: true });
    const drawing = await openDrawing();
    act(() => { useSelectionStore.getState().select("t8"); });
    const aisles = drawing.querySelectorAll(".pc-drawing__aisle");
    expect(aisles.length).toBeGreaterThan(0);
    expect([...aisles].every((aisle) => /\d\.\d m/u.test(aisle.textContent ?? ""))).toBe(true);
    act(() => { setPlannerFeaturesForTesting({ liveAisles: false }); useSelectionStore.getState().select("t3"); });
    expect(drawing.querySelectorAll(".pc-drawing__aisle")).toHaveLength(0);
  });

  it("projects the caption's anchor onto the paper, and again after any frame the hidden canvas draws", async () => {
    await openDrawing();
    const written: ScreenPoint[] = [];
    let stop = (): void => undefined;
    // As the caption does: it registers its anchor in the commit that selects its piece.
    act(() => {
      useSelectionStore.getState().select("t8");
      stop = registerScreenAnchor("caption", () => [3, 0.76, 2], (point) => { written.push(point); });
    });
    await nextFrame();
    const at = toScreen(expectedView(), { x: 3, z: 2 });
    expect(written.at(-1)).toMatchObject({ x: at.x, y: at.y, visible: true });
    // A frame of the canvas under the paper writes its own projection; the paper's comes straight after it.
    written.push({ x: -1, y: -1, visible: false });
    act(() => { for (const callback of after.callbacks) callback(); });
    expect(written.at(-1)).toMatchObject({ x: at.x, y: at.y, visible: true });
    stop();
  });
});

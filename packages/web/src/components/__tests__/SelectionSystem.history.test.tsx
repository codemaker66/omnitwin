import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionSystem } from "../SelectionSystem.js";
import { EditorBridge, __resetEditorBridgeMountCountForTests, placedItemToEditor } from "../editor/EditorBridge.js";
import { beginActionLogForConfig, useEditorStore } from "../../stores/editor-store.js";
import { useActionLogStore } from "../../stores/action-log-store.js";
import * as configApi from "../../api/configurations.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { createTableGroup } from "../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";

const renderer = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.value }));
vi.mock("../../api/configurations.js", () => ({
  publicBatchSave: vi.fn(), authBatchSave: vi.fn(), parseRevisionConflict: vi.fn(() => null),
}));
vi.mock("../../api/action-log.js", () => ({ postActionBatch: vi.fn() }));

let canvas: HTMLCanvasElement;
let geometry: BoxGeometry;
let material: MeshBasicMaterial;
let now = 0;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  now = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  localStorage.clear();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  useSelectionStore.getState().clearSelection();
  useCatalogueStore.getState().clearSelection();
  useToolStore.getState().setTool("select");
  __resetEditorBridgeMountCountForTests();
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
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing canonical table");
  const group = createTableGroup(table.id, 0, 0, 0, 8);
  const primary = group.find((item) => item.catalogueItemId === table.id);
  if (primary === undefined) throw new Error("Missing primary table");
  const others = Array.from({ length: 17 }, (_unused, index) => createTableGroup(table.id, 50 + index * 5, 50, 0, 8)).flat();
  const items = [...group, ...others];
  usePlacementStore.setState({ placedItems: items, snapEnabled: true });
  useEditorStore.setState({ configId: "pointer-layout", configRevision: 1, isPublicPreview: true,
    objects: items.map((item) => placedItemToEditor(item, undefined)) });
  useSelectionStore.getState().selectMultiple(group.map((item) => item.id));
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
  renderer.value = { scene, camera, raycaster: new Raycaster(), gl: { domElement: canvas }, invalidate: vi.fn() };
});

afterEach(() => {
  cleanup();
  canvas.remove();
  geometry.dispose();
  material.dispose();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.getState().reset();
  vi.restoreAllMocks();
});

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number): void {
  act(() => { fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", isPrimary: true,
    button: 0, buttons: type === "pointerUp" || type === "pointerCancel" ? 0 : 1, clientX: x, clientY: y }); });
}

function insertionReply(batch: readonly configApi.BatchObjectInput[]): configApi.BatchSaveResponse {
  return { revision: 2, objects: batch.map((item, index) => ({
    id: item.id ?? `server-${String(index)}`, configurationId: "pointer-layout", assetDefinitionId: item.assetDefinitionId,
    positionX: String(item.positionX), positionY: String(item.positionY), positionZ: String(item.positionZ),
    rotationX: String(item.rotationX), rotationY: String(item.rotationY), rotationZ: String(item.rotationZ),
    scale: String(item.scale), sortOrder: item.sortOrder, metadata: item.metadata ?? null,
  })) };
}

describe("SelectionSystem pointer history through EditorBridge", () => {
  it.each(["inside", "outside", "cancel"] as const)("closes a no-movement press released %s without history or a stuck save gate", async (release) => {
    useActionLogStore.getState().reset();
    beginActionLogForConfig("pointer-layout");
    vi.mocked(configApi.publicBatchSave).mockImplementation((_id, batch) => Promise.resolve(insertionReply(batch)));
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    pointer("pointerDown", 200, 200);
    if (release === "inside") pointer("pointerUp", 200, 200);
    if (release === "cancel") pointer("pointerCancel", 200, 200);
    if (release === "outside") act(() => { fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 500, clientY: 500 }); });
    expect(useEditorStore.getState().objects).toBe(initial);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
    expect(useActionLogStore.getState().entries).toHaveLength(0);
    await act(async () => { expect(await useEditorStore.getState().saveToServer()).toBe(true); });
    expect(configApi.publicBatchSave).toHaveBeenCalledOnce();
  });

  it.each([
    { tool: "select", pending: false }, { tool: "rotate", pending: false }, { tool: "scale", pending: false },
    { tool: "select", pending: true }, { tool: "rotate", pending: true }, { tool: "scale", pending: true },
  ] as const)("continues group $tool after INSERT IDs change (pending pointer: $pending)", async ({ tool, pending }) => {
    useActionLogStore.getState().reset();
    beginActionLogForConfig("pointer-layout");
    useToolStore.getState().setTool(tool);
    let acknowledge: ((reply: configApi.BatchSaveResponse) => void) | undefined;
    vi.mocked(configApi.publicBatchSave).mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => { saving = useEditorStore.getState().saveToServer(); });
    const sent = vi.mocked(configApi.publicBatchSave).mock.calls[0]?.[1];
    if (sent === undefined || acknowledge === undefined) throw new Error("Missing insertion request");
    const reply = insertionReply(sent);
    // Rotate/scale require an actual off-centre grab, just as in the planner.
    pointer("pointerDown", tool === "select" ? 200 : 207, 200);
    if (!pending) pointer("pointerMove", tool === "select" ? 220 : 213, 198);
    const beforeAck = useEditorStore.getState().objects;
    await act(async () => { acknowledge?.(reply); expect(await saving).toBe(true); });
    const afterAck = useEditorStore.getState().objects;
    expect(afterAck).toEqual(beforeAck.map((item, index) => ({ ...item, id: reply.objects[index]?.id })));
    expect(useSelectionStore.getState().selectedIds).toEqual(new Set(reply.objects.slice(0, 9).map((item) => item.id)));
    now += 1_500;
    pointer("pointerMove", 240, 180);
    expect(useEditorStore.getState().objects.slice(0, 9)).not.toEqual(afterAck.slice(0, 9));
    now += 1_500;
    pointer("pointerUp", 240, 180);
    const final = useEditorStore.getState().objects;
    expect(final.slice(9)).toEqual(afterAck.slice(9));
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useActionLogStore.getState().entries).toHaveLength(1);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(initial.map((item, index) => ({ ...item, id: reply.objects[index]?.id })));
    act(() => { useEditorStore.getState().redo(); });
    expect(useEditorStore.getState().objects).toEqual(final);
  });

  it("settles the remapped whole group when release is the first event after INSERT acknowledgement", async () => {
    let acknowledge: ((reply: configApi.BatchSaveResponse) => void) | undefined;
    vi.mocked(configApi.publicBatchSave).mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    render(<><SelectionSystem /><EditorBridge /></>);
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => { saving = useEditorStore.getState().saveToServer(); });
    const sent = vi.mocked(configApi.publicBatchSave).mock.calls[0]?.[1];
    if (sent === undefined) throw new Error("Missing request");
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 223, 183);
    await act(async () => { acknowledge?.(insertionReply(sent)); expect(await saving).toBe(true); });
    const before = useEditorStore.getState().objects;
    now += 1_500;
    pointer("pointerUp", 223, 183);
    const final = useEditorStore.getState().objects;
    const dx = (final[0]?.positionX ?? 0) - (before[0]?.positionX ?? 0);
    const dz = (final[0]?.positionZ ?? 0) - (before[0]?.positionZ ?? 0);
    expect(Math.abs(dx) + Math.abs(dz)).toBeGreaterThan(0.001);
    for (let i = 0; i < 9; i++) {
      expect((final[i]?.positionX ?? 0) - (before[i]?.positionX ?? 0)).toBeCloseTo(dx, 10);
      expect((final[i]?.positionZ ?? 0) - (before[i]?.positionZ ?? 0)).toBeCloseTo(dz, 10);
    }
    expect(final.slice(9)).toEqual(before.slice(9));
    expect(useEditorStore.getState().history.past).toHaveLength(1);
  });

  it("does not apply an obsolete ACK's IDs to a new document's active pointer gesture", async () => {
    let acknowledge: ((reply: configApi.BatchSaveResponse) => void) | undefined;
    vi.mocked(configApi.publicBatchSave).mockImplementation(() => new Promise((resolve) => { acknowledge = resolve; }));
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => { saving = useEditorStore.getState().saveToServer(); });
    const sent = vi.mocked(configApi.publicBatchSave).mock.calls[0]?.[1];
    if (sent === undefined) throw new Error("Missing request");
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    act(() => {
      useEditorStore.getState().reset();
      useEditorStore.setState({ configId: "new-document", configRevision: 7, objects: initial, isPublicPreview: true });
      useSelectionStore.getState().selectMultiple(initial.slice(0, 9).map((item) => item.id));
    });
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    const newBeforeAck = useEditorStore.getState().objects;
    await act(async () => { acknowledge?.(insertionReply(sent)); expect(await saving).toBe(false); });
    expect(useEditorStore.getState().objects).toBe(newBeforeAck);
    expect(useEditorStore.getState().configRevision).toBe(7);
    now += 1_500;
    pointer("pointerMove", 240, 180);
    pointer("pointerUp", 240, 180);
    const final = useEditorStore.getState().objects;
    expect(final.slice(0, 9)).not.toEqual(newBeforeAck.slice(0, 9));
    expect(final.map((item) => item.id)).toEqual(initial.map((item) => item.id));
    expect(final.slice(9)).toEqual(initial.slice(9));
    expect(useEditorStore.getState().history.past).toHaveLength(1);
  });

  it("closes a pointer that the browser cancels before capture", () => {
    canvas.setPointerCapture = () => { throw new DOMException("Pointer cancelled", "NotFoundError"); };
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    pointer("pointerMove", 250, 150);
    expect(useEditorStore.getState().objects).toBe(initial);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
  });

  it("undoes one paused group drag including axis changes and release snap, then redoes its final geometry", () => {
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    expect(initial).toHaveLength(162);
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    now += 1_500;
    pointer("pointerMove", 240, 180);
    now += 1_500;
    pointer("pointerUp", 240, 180);
    const final = useEditorStore.getState().objects;
    expect(final.slice(0, 9)).not.toEqual(initial.slice(0, 9));
    expect(final.slice(9)).toEqual(initial.slice(9));
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(initial);
    act(() => { useEditorStore.getState().redo(); });
    expect(useEditorStore.getState().objects).toEqual(final);
  });

  it("starts an independent next pointer gesture and keeps a keyboard rotation separate", () => {
    render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    pointer("pointerUp", 220, 200);
    const between = useEditorStore.getState().objects;
    // The pick proxy deliberately stays at its fixture location; real geometry
    // projection is covered by the separate rendered qualification.
    pointer("pointerDown", 200, 200);
    now += 1_500;
    pointer("pointerMove", 240, 180);
    const beforeRotation = useEditorStore.getState().objects;
    act(() => { fireEvent.keyDown(window, { code: "KeyR" }); });
    const final = useEditorStore.getState().objects;
    pointer("pointerMove", 250, 150);
    expect(useEditorStore.getState().objects).toBe(final);
    expect(useEditorStore.getState().history.past).toHaveLength(3);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(beforeRotation);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(between);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(initial);
  });

  it("ignores another pointer release and closes on the owning pointer released outside canvas", () => {
    render(<><SelectionSystem /><EditorBridge /></>);
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    act(() => { fireEvent.pointerUp(window, { pointerId: 2, button: 0, clientX: 220, clientY: 200 }); });
    now += 1_500;
    pointer("pointerMove", 240, 180);
    act(() => { fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 240, clientY: 180 }); });
    const final = useEditorStore.getState().objects;
    pointer("pointerMove", 250, 150);
    expect(useEditorStore.getState().objects).toBe(final);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
  });

  it.each(["cancel", "blur", "preview", "unmount"] as const)("closes a drag on %s without merging later inspector edits", (ending) => {
    const view = render(<><SelectionSystem /><EditorBridge /></>);
    const initial = useEditorStore.getState().objects;
    pointer("pointerDown", 200, 200);
    pointer("pointerMove", 220, 200);
    const cancelled = useEditorStore.getState().objects;
    if (ending === "cancel") pointer("pointerCancel", 220, 200);
    if (ending === "blur") act(() => { fireEvent.blur(window); });
    if (ending === "preview") act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading phase"); });
    if (ending === "unmount") view.unmount();
    pointer("pointerMove", 250, 150);
    expect(useEditorStore.getState().objects).toBe(cancelled);
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    const first = initial[0];
    if (first === undefined) throw new Error("Missing item");
    act(() => { useEditorStore.getState().updateObject(first.id, { positionX: first.positionX + 4 }); });
    expect(useEditorStore.getState().history.past).toHaveLength(2);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(cancelled);
    act(() => { useEditorStore.getState().undo(); });
    expect(useEditorStore.getState().objects).toEqual(initial);
  });
});

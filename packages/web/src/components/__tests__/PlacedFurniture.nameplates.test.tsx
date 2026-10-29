import { act } from "@testing-library/react";
import { Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D, type Texture } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraBookmark } from "../../lib/camera-animation.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import {
  NAMEPLATE_CLEARANCE_M,
  NAMEPLATE_MAX_WIDTH_M,
  PlacedFurniture,
  nameplateTextures,
} from "../PlacedFurniture.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

/** Every line a plate texture drew, in order. */
const drawnLines: string[] = [];

/** happy-dom has no 2D canvas; the nameplate only needs its drawing calls to exist. */
function recordingContext(): CanvasRenderingContext2D {
  const assigned = new Map<PropertyKey, unknown>();
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_target, property) => {
      if (assigned.has(property)) return assigned.get(property);
      if (property === "measureText") return () => ({ width: 640 });
      if (property === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      if (property === "fillText") return (text: string) => { drawnLines.push(text); };
      return () => undefined;
    },
    set: (_target, property, value) => {
      assigned.set(property, value);
      return true;
    },
  });
}

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing ${slug} fixture`);
  return item.id;
}

function labelledTable(label: string, x: number, groupId: string | null = null): PlacedItem {
  return { ...createPlacedItem(catalogueId("round-table-6ft"), x, 0, 0, groupId), label };
}

function labelledChair(label: string, x: number, groupId: string | null): PlacedItem {
  return { ...createPlacedItem(catalogueId("banquet-chair"), x, 1, 0, groupId), label };
}

function cameraReference(placedItemId: string): CameraBookmark {
  return {
    id: `reference-${placedItemId}`,
    name: "Seat view",
    position: [0, 1.2, 0],
    target: [0, 1.2, -1],
    kind: "reference",
    reference: {
      source: "furniture",
      sourceLabel: "Table",
      placedItemId,
      point: [0, 0],
      baseY: 0,
      yaw: null,
      eyeHeightM: 1.2,
      heightMode: "sitting",
    },
  };
}

interface Plate {
  readonly group: Object3D;
  /** The plane's centre height in the plate group. */
  readonly planeY: number;
  /** The plane's [width, height] in metres, as drawn. */
  readonly size: readonly [number, number];
  readonly texture: Texture;
}

/** Each visible nameplate, in scene order. */
function plates(scene: Object3D): Plate[] {
  const found: Plate[] = [];
  scene.traverse((object) => {
    if (object.name !== "item-nameplate") return;
    const plane = object.children[0];
    if (
      plane instanceof Mesh
      && plane.geometry instanceof PlaneGeometry
      && plane.material instanceof MeshBasicMaterial
      && plane.material.map !== null
    ) {
      found.push({
        group: object,
        planeY: plane.position.y,
        size: [plane.geometry.parameters.width, plane.geometry.parameters.height],
        texture: plane.material.map,
      });
    }
  });
  return found;
}

function plateTextures(scene: Object3D): Texture[] {
  return plates(scene).map(({ texture }) => texture);
}

function onlyPlate(scene: Object3D): Plate {
  const [plate, ...rest] = plates(scene);
  if (plate === undefined || rest.length > 0) throw new Error("Expected exactly one plate");
  return plate;
}

/** Height of the plate's lower edge, in the plate group's untilted frame. */
function lowerEdgeY(plate: Plate): number {
  return plate.group.position.y + plate.planeY - plate.size[1] / 2;
}

let mounted: StubRoot | null = null;

beforeEach(() => {
  // Plate textures outlive their plates for an idle window; tests own that clock.
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recordingContext());
  drawnLines.length = 0;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });
  usePlacementStore.setState({ placedItems: [] });
  useBookmarkStore.setState({ bookmarks: [], activeReferenceId: null });
  useSelectionStore.getState().endMarquee();
  useSelectionStore.getState().clearSelection();
});

describe("the selection nameplate", () => {
  it("shows one plate for a single selected table, and none for separate tables", () => {
    const tables = [labelledTable("Table 1", -5), labelledTable("Table 2", 5)];
    usePlacementStore.setState({ placedItems: tables });
    mounted = mountInStubRoot(<PlacedFurniture />);
    expect(plates(mounted.scene)).toEqual([]);

    act(() => { useSelectionStore.getState().select(tables[1]?.id ?? ""); });
    expect(onlyPlate(mounted.scene).group.position.x).toBe(5);

    // Nothing marks one of two separate tables as the one meant.
    act(() => { useSelectionStore.getState().selectMultiple(tables.map(({ id }) => id)); });
    expect(plates(mounted.scene)).toEqual([]);

    act(() => { useSelectionStore.getState().toggleSelect(tables[1]?.id ?? ""); });
    expect(onlyPlate(mounted.scene).group.position.x).toBe(-5);
  });

  it("puts a selected group's plate on its table, reading its grouped seats, and never on a chair", () => {
    const table = labelledTable("Table 4", 2, "group-4");
    const chairs = [labelledChair("Seat 1", 1, "group-4"), labelledChair("Seat 2", 3, "group-4")];
    usePlacementStore.setState({ placedItems: [table, ...chairs] });
    mounted = mountInStubRoot(<PlacedFurniture />);

    // The outliner selects a table with its seats.
    act(() => { useSelectionStore.getState().selectMultiple([table.id, ...chairs.map(({ id }) => id)]); });
    expect(onlyPlate(mounted.scene).group.position.x).toBe(2);
    expect(drawnLines).toEqual(["Table 4 · 2 seats"]);

    act(() => { useSelectionStore.getState().select(chairs[0]?.id ?? ""); });
    expect(plates(mounted.scene)).toEqual([]);
  });

  it("reads the label alone on a table without grouped seats", () => {
    const table = labelledTable("Top table", 0);
    usePlacementStore.setState({ placedItems: [table] });
    useSelectionStore.getState().select(table.id);
    mounted = mountInStubRoot(<PlacedFurniture />);
    expect(plates(mounted.scene)).toHaveLength(1);
    expect(drawnLines).toEqual(["Top table"]);
  });

  it("draws no selection plate while a marquee sweeps", () => {
    const table = labelledTable("Table 1", 0);
    usePlacementStore.setState({ placedItems: [table] });
    useSelectionStore.getState().select(table.id);
    mounted = mountInStubRoot(<PlacedFurniture />);
    expect(plates(mounted.scene)).toHaveLength(1);

    act(() => { useSelectionStore.getState().startMarquee(10, 10, 0, 0); });
    expect(plates(mounted.scene)).toEqual([]);
    act(() => { useSelectionStore.getState().endMarquee(); });
    expect(plates(mounted.scene)).toHaveLength(1);
  });

  it("keeps the plate at most 2.4 m wide, in its texture's aspect, 0.9 m above the table's top", () => {
    const table = labelledTable("Table 1", 4);
    const tableHeight = getCatalogueItemBySlug("round-table-6ft")?.height ?? Number.NaN;
    usePlacementStore.setState({ placedItems: [table] });
    useSelectionStore.getState().select(table.id);
    mounted = mountInStubRoot(<PlacedFurniture />);

    const plate = onlyPlate(mounted.scene);
    const [width, height] = plate.size;
    const image = plate.texture.image as HTMLCanvasElement;
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(NAMEPLATE_MAX_WIDTH_M);
    expect(width / height).toBeCloseTo(image.width / image.height, 6);
    expect(lowerEdgeY(plate)).toBeCloseTo(tableHeight + NAMEPLATE_CLEARANCE_M, 6);
    expect([plate.group.position.x, plate.group.position.z]).toEqual([4, 0]);
  });
});

describe("camera-reference nameplates", () => {
  it("show while the camera rests, selected or not and during a marquee, at the selection plate's size", () => {
    const tables = [labelledTable("Table 1", -5), labelledTable("Table 2", 5)];
    const tableHeight = getCatalogueItemBySlug("round-table-6ft")?.height ?? Number.NaN;
    usePlacementStore.setState({ placedItems: tables });
    useBookmarkStore.setState({ bookmarks: [cameraReference(tables[0]?.id ?? "")] });
    mounted = mountInStubRoot(<PlacedFurniture />);

    const reference = onlyPlate(mounted.scene);
    expect(reference.group.position.x).toBe(-5);
    expect(reference.size[0]).toBeLessThanOrEqual(NAMEPLATE_MAX_WIDTH_M);
    expect(lowerEdgeY(reference)).toBeCloseTo(tableHeight + NAMEPLATE_CLEARANCE_M, 6);

    act(() => { useSelectionStore.getState().select(tables[1]?.id ?? ""); });
    const [first, second] = plates(mounted.scene);
    if (first === undefined || second === undefined) throw new Error("Missing plates");
    expect(second.size).toEqual(first.size);
    expect(lowerEdgeY(second)).toBeCloseTo(lowerEdgeY(first), 6);

    act(() => { useSelectionStore.getState().startMarquee(10, 10, 0, 0); });
    expect(plates(mounted.scene).map(({ group }) => group.position.x)).toEqual([-5]);

    act(() => { useCockpitStore.setState({ cameraInteractionActive: true }); });
    expect(plates(mounted.scene)).toEqual([]);
  });
});

describe("furniture nameplate textures", () => {
  it("shares identical plates and keeps their textures through a camera gesture", () => {
    const tables = [labelledTable("Table 1", -5), labelledTable("Table 1", 0), labelledTable("Table 2", 5)];
    usePlacementStore.setState({ placedItems: tables });
    useBookmarkStore.setState({ bookmarks: tables.map(({ id }) => cameraReference(id)) });
    mounted = mountInStubRoot(<PlacedFurniture />);
    const initial = plateTextures(mounted.scene);
    expect(initial).toHaveLength(3);
    const [first, twin, second] = initial;
    if (first === undefined || second === undefined) throw new Error("Missing plates");
    expect(twin).toBe(first);
    expect(second).not.toBe(first);
    const disposals = [vi.spyOn(first, "dispose"), vi.spyOn(second, "dispose")];

    act(() => { useCockpitStore.setState({ cameraInteractionActive: true }); });
    expect(plateTextures(mounted.scene)).toEqual([]);
    act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });

    const returned = plateTextures(mounted.scene);
    expect(returned).toHaveLength(3);
    returned.forEach((texture, index) => { expect(texture).toBe(initial[index]); });
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
    expect(nameplateTextures.size).toBe(2);
  });

  it("disposes a replaced label at once and every texture once after the last plate leaves", () => {
    const tables = [labelledTable("Table 1", -5), labelledTable("Table 2", 5)];
    usePlacementStore.setState({ placedItems: tables });
    useBookmarkStore.setState({ bookmarks: tables.map(({ id }) => cameraReference(id)) });
    mounted = mountInStubRoot(<PlacedFurniture />);
    const [kept, replaced] = plateTextures(mounted.scene);
    if (kept === undefined || replaced === undefined) throw new Error("Missing plates");
    const keptDispose = vi.spyOn(kept, "dispose");
    const replacedDispose = vi.spyOn(replaced, "dispose");

    act(() => {
      usePlacementStore.setState({
        placedItems: tables.map((table) => (table.label === "Table 2" ? { ...table, label: "Table 3" } : table)),
      });
    });
    const renamed = plateTextures(mounted.scene);
    expect(renamed[0]).toBe(kept);
    expect(renamed[1]).not.toBe(replaced);
    expect(replacedDispose).toHaveBeenCalledOnce();
    const renamedTexture = renamed[1];
    if (renamedTexture === undefined) throw new Error("Missing renamed plate");
    const renamedDispose = vi.spyOn(renamedTexture, "dispose");

    mounted.unmount();
    mounted = null;
    expect(keptDispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(keptDispose).toHaveBeenCalledOnce();
    expect(renamedDispose).toHaveBeenCalledOnce();
    expect(replacedDispose).toHaveBeenCalledOnce();
    expect(nameplateTextures.size).toBe(0);
  });
});

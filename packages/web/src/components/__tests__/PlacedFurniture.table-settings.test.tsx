import { act } from "@testing-library/react";
import { Raycaster, Vector3, type Intersection, type Material, type Mesh, type Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacedFurniture } from "../PlacedFurniture.js";
import { findFurnitureItemId } from "../SelectionSystem.js";
import { mountTestRoot, type TestRoot } from "../meshes/__tests__/r3f-test-root.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useFurnitureInspectionStore } from "../../stores/furniture-inspection-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

// The saved layout mounted in a real R3F reconciler. Only the model batches
// are stubbed: covers, linen, pick proxies and the layout's shared cover
// resources are the production components.
vi.mock("../editor/InstancedFurnitureLayer.js", () => ({ InstancedFurnitureLayer: () => null }));
vi.mock("../FurnitureProxy.js", () => ({ FurnitureProxy: () => null }));
vi.mock("../editor/TimelinePreviewFurniture.js", () => ({ TimelinePreviewFurniture: () => null }));

const TABLES = 20;
const CHAIRS_PER_TABLE = 10;
const PARTS_PER_COVER = 5;

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`missing fixture ${slug}`);
  return item.id;
}

/** A dressed banquet: round tables in a 5-wide grid, each ringed by ten grouped chairs. */
function dressedBanquet(): readonly PlacedItem[] {
  return Array.from({ length: TABLES }, (_, index) => {
    const groupId = `banquet-${String(index)}`;
    const x = (index % 5) * 3.4 - 6.8;
    const z = Math.floor(index / 5) * 3.4 - 5.1;
    const table: PlacedItem = {
      ...createPlacedItem(catalogueId("round-table-6ft"), x, z, index === 0 ? 0 : index * 0.3, groupId),
      clothed: true,
      clothStyle: "white",
      tableSetting: "dinner",
    };
    const chairs = Array.from({ length: CHAIRS_PER_TABLE }, (_, chair) => createPlacedItem(
      catalogueId("banquet-chair"),
      x + 1.25 * Math.cos((chair * Math.PI * 2) / CHAIRS_PER_TABLE),
      z + 1.25 * Math.sin((chair * Math.PI * 2) / CHAIRS_PER_TABLE),
      0,
      groupId,
    ));
    return [table, ...chairs];
  }).flat();
}

function isMesh(object: Object3D): object is Mesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

function singleMaterial(mesh: Mesh): Material {
  if (Array.isArray(mesh.material)) throw new Error("covers use one material");
  return mesh.material;
}

/** Cover meshes keyed `tableId/setting/part`, in scene order. */
function coverMeshes(root: Object3D): ReadonlyMap<string, Mesh> {
  root.updateMatrixWorld(true);
  const covers = new Map<string, Mesh>();
  root.traverse((object) => {
    if (object.name !== "table-setting-dinner") return;
    const tableId = findFurnitureItemId(object);
    object.children.forEach((setting, settingIndex) => {
      setting.children.forEach((part, partIndex) => {
        if (!isMesh(part)) throw new Error("cover part is not a mesh");
        covers.set(`${String(tableId)}/${String(settingIndex)}/${String(partIndex)}`, part);
      });
    });
  });
  return covers;
}

/** SelectionSystem's pointer target: the first hit that resolves to a placed item. */
function pointerTarget(hits: readonly Intersection[]): string | null {
  for (const hit of hits) {
    const id = findFurnitureItemId(hit.object);
    if (id !== null) return id;
  }
  return null;
}

function tableAt(index: number): PlacedItem {
  const table = usePlacementStore.getState().placedItems.filter((item) => item.tableSetting === "dinner")[index];
  if (table === undefined) throw new Error(`missing table ${String(index)}`);
  return table;
}

let root: TestRoot | null = null;

function mountLayout(): TestRoot {
  root = mountTestRoot(<PlacedFurniture />);
  return root;
}

beforeEach(() => {
  useCockpitStore.setState({ cameraInteractionActive: false });
  useSelectionStore.getState().clearSelection();
  useFurnitureInspectionStore.getState().closeInspection();
  useLayoutTimelinePreviewStore.setState({ mode: "inactive" });
  usePlacementStore.setState({ placedItems: dressedBanquet() });
});

afterEach(() => {
  root?.unmount();
  root = null;
  vi.restoreAllMocks();
});

describe("PlacedFurniture dinner covers", () => {
  it("draws every cover of a 20-table banquet from one layout-owned geometry and material per part", () => {
    const { scene } = mountLayout();
    const covers = coverMeshes(scene);
    expect(covers.size).toBe(TABLES * CHAIRS_PER_TABLE * PARTS_PER_COVER);
    const meshes = [...covers.values()];
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(PARTS_PER_COVER);
    expect(new Set(meshes.map(singleMaterial)).size).toBe(PARTS_PER_COVER);
    // Each cover remains inside its own table's furniture group, so the settle
    // offset FurnitureMotion writes there and picking both still apply.
    const coversPerTable = new Map<string | null, number>();
    for (const mesh of meshes) {
      const tableId = findFurnitureItemId(mesh);
      coversPerTable.set(tableId, (coversPerTable.get(tableId) ?? 0) + 1);
    }
    const dressed = usePlacementStore.getState().placedItems.filter((item) => item.tableSetting === "dinner");
    expect([...coversPerTable.keys()].sort()).toEqual(dressed.map(({ id }) => id).sort());
    for (const count of coversPerTable.values()) expect(count).toBe(CHAIRS_PER_TABLE * PARTS_PER_COVER);
  });

  it("draws no covers when no table is dressed", () => {
    usePlacementStore.setState({
      placedItems: usePlacementStore.getState().placedItems.map((item) => ({ ...item, tableSetting: null })),
    });
    const { scene } = mountLayout();
    expect(coverMeshes(scene).size).toBe(0);
    expect(scene.getObjectByName("table-setting-dinner")).toBeUndefined();
  });

  it("keeps cover meshes and shared resources while the whole banquet is dragged", () => {
    const { scene } = mountLayout();
    const before = coverMeshes(scene);
    const resources = new Map([...before].map(([key, mesh]) => [key, [mesh.geometry, mesh.material] as const]));
    const glassKey = `${tableAt(0).id}/0/2`;
    const glassBefore = before.get(glassKey)?.getWorldPosition(new Vector3());
    if (glassBefore === undefined) throw new Error("missing glass");

    for (let step = 1; step <= 3; step += 1) {
      act(() => {
        usePlacementStore.setState({
          placedItems: usePlacementStore.getState().placedItems.map((item) => ({ ...item, x: item.x + 0.4, z: item.z - 0.25 })),
        });
      });
      const after = coverMeshes(scene);
      expect(after.size).toBe(before.size);
      for (const [key, mesh] of after) {
        expect(mesh).toBe(before.get(key));
        const [geometry, material] = resources.get(key) ?? [];
        expect(mesh.geometry).toBe(geometry);
        expect(mesh.material).toBe(material);
      }
      const glass = after.get(glassKey)?.getWorldPosition(new Vector3());
      if (glass === undefined) throw new Error("missing glass");
      expect(glass.x - glassBefore.x).toBeCloseTo(0.4 * step, 12);
      expect(glass.y - glassBefore.y).toBeCloseTo(0, 12);
      expect(glass.z - glassBefore.z).toBeCloseTo(-0.25 * step, 12);
    }
  });

  it("resolves a pointer over a glass to its table even where the ray misses the table's pick box", () => {
    const { scene } = mountLayout();
    const table = tableAt(0);
    const furniture = scene.getObjectByName(`furniture-${table.id}`);
    const glass = coverMeshes(scene).get(`${table.id}/0/2`);
    const pickBox = furniture?.getObjectByName("item-pick-proxy");
    if (glass === undefined || pickBox === undefined) throw new Error("missing glass or pick proxy");

    // A shallow ray from above the table centre through the rim of a glass.
    const glassTop = new Vector3(0, 0.0525, 0).applyMatrix4(glass.matrixWorld);
    const origin = new Vector3(table.x, glassTop.y + 0.02, glassTop.z);
    const raycaster = new Raycaster(origin, glassTop.clone().sub(origin).normalize());
    const hits = raycaster.intersectObjects(scene.children, true);

    expect(hits[0]?.object).toBe(glass);
    expect(pointerTarget(hits)).toBe(table.id);
    // Without the covers the same pointer would pass over the table's own
    // pick box and select the chair behind it.
    expect(raycaster.intersectObject(pickBox, false)).toHaveLength(0);
    const behind = pointerTarget(hits.filter((hit) => findFurnitureItemId(hit.object) !== table.id));
    expect(behind).not.toBeNull();
    expect(usePlacementStore.getState().placedItems.find((item) => item.id === behind)?.groupId).toBe(table.groupId);
  });

  it("disposes the layout's cover resources once, when the layout unmounts", () => {
    const layout = mountLayout();
    const meshes = [...coverMeshes(layout.scene).values()];
    const geometries = new Set(meshes.map((mesh) => mesh.geometry));
    const materials = new Set(meshes.map(singleMaterial));
    const disposals = [
      ...[...geometries].map((geometry) => vi.spyOn(geometry, "dispose")),
      ...[...materials].map((material) => vi.spyOn(material, "dispose")),
    ];
    expect(disposals).toHaveLength(PARTS_PER_COVER * 2);

    // Undressing one table leaves the layout's shared set alive.
    act(() => {
      usePlacementStore.setState({
        placedItems: usePlacementStore.getState().placedItems.map((item) => (
          item.id === tableAt(0).id ? { ...item, tableSetting: null } : item
        )),
      });
    });
    expect(coverMeshes(layout.scene).size).toBe((TABLES - 1) * CHAIRS_PER_TABLE * PARTS_PER_COVER);
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();

    layout.unmount();
    root = null;
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

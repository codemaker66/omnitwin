import { act } from "@testing-library/react";
import { Mesh, MeshBasicMaterial, type Object3D, type Texture } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { PlacedFurniture, nameplateTextures } from "../PlacedFurniture.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

/** happy-dom has no 2D canvas; the nameplate only needs its drawing calls to exist. */
function recordingContext(): CanvasRenderingContext2D {
  const assigned = new Map<PropertyKey, unknown>();
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_target, property) => {
      if (assigned.has(property)) return assigned.get(property);
      if (property === "measureText") return () => ({ width: 640 });
      if (property === "createLinearGradient") return () => ({ addColorStop: () => undefined });
      return () => undefined;
    },
    set: (_target, property, value) => {
      assigned.set(property, value);
      return true;
    },
  });
}

function labelledTable(label: string, x: number): PlacedItem {
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Missing round table fixture");
  return { ...createPlacedItem(table.id, x, 0), label };
}

/** Each visible nameplate's texture, in scene order. */
function plateTextures(scene: Object3D): Texture[] {
  const textures: Texture[] = [];
  scene.traverse((object) => {
    if (object.name !== "item-nameplate") return;
    const plane = object.children[0];
    if (plane instanceof Mesh && plane.material instanceof MeshBasicMaterial && plane.material.map !== null) {
      textures.push(plane.material.map);
    }
  });
  return textures;
}

let mounted: StubRoot | null = null;

beforeEach(() => {
  // Plate textures outlive their plates for an idle window; tests own that clock.
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recordingContext());
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => { useCockpitStore.setState({ cameraInteractionActive: false }); });
  usePlacementStore.setState({ placedItems: [] });
});

describe("furniture nameplate textures", () => {
  it("shares identical plates and keeps their textures through a camera gesture", () => {
    usePlacementStore.setState({
      placedItems: [labelledTable("Table 1", -5), labelledTable("Table 1", 0), labelledTable("Table 2", 5)],
    });
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

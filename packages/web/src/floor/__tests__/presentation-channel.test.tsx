import { act } from "@testing-library/react";
import { advance } from "@react-three/fiber";
import { Matrix4, Object3D, type InstancedMesh } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { normalizedFurniturePresentationScale } from "../../components/FurnitureProxy.js";
import { mountInStubRoot, type StubRoot } from "../../components/__tests__/stub-r3f-root.js";
import { InstancedFurnitureLayer } from "../../components/editor/InstancedFurnitureLayer.js";
import { FurnitureContactShadows } from "../../components/editor/FurnitureContactShadows.js";
import {
  HIDDEN_MATRIX,
  currentFurniturePresentation,
  placedPresentation,
  presentedPiece,
  publishFurniturePresentation,
  subscribeFurniturePresentation,
  type PresentationFrame,
  type PresentedPiece,
} from "../presentation-channel.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

const CHAIR = catalogueId("banquet-chair");
const first = createPlacedItem(CHAIR, -2, 1, 0.3);
const second = createPlacedItem(CHAIR, 0, 1, 1.1);
const third = createPlacedItem(CHAIR, 2, 1, 2.2);
const chairs: readonly PlacedItem[] = [first, second, third];

function Scene(): React.ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  return (
    <>
      <FurnitureContactShadows />
      <InstancedFurnitureLayer items={items} />
    </>
  );
}

let mounted: StubRoot | null = null;

function frame(): void {
  act(() => { advance(performance.now(), true); });
}

function mount(items: readonly PlacedItem[]): StubRoot {
  usePlacementStore.setState({ placedItems: [...items] });
  mounted = mountInStubRoot(<Scene />);
  frame();
  frame();
  return mounted;
}

function isInstancedMesh(object: Object3D): object is InstancedMesh {
  return (object as Partial<Pick<InstancedMesh, "isInstancedMesh">>).isInstancedMesh === true;
}

/** Every instance buffer drawn, as bytes: furniture batches and contact shadows. */
function drawnBytes(scene: Object3D): number[][] {
  const arrays: number[][] = [];
  scene.traverse((object) => {
    if (isInstancedMesh(object)) arrays.push(Array.from(new Uint8Array(Float32Array.from(object.instanceMatrix.array).buffer)));
  });
  return arrays;
}

function furnitureBatch(scene: Object3D): InstancedMesh {
  const found: InstancedMesh[] = [];
  scene.getObjectByName("instanced-furniture")?.traverse((object) => {
    if (isInstancedMesh(object)) found.push(object);
  });
  const batch = found[0];
  if (batch === undefined) throw new Error("No furniture batch drawn");
  return batch;
}

function shadowMesh(scene: Object3D): InstancedMesh {
  const found = scene.getObjectByName("furniture-contact-shadows");
  if (found === undefined || !isInstancedMesh(found)) throw new Error("No contact shadows drawn");
  return found;
}

function slot(mesh: InstancedMesh, index: number): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16));
}

function placedMatrix(item: PlacedItem): Matrix4 {
  const transform = new Object3D();
  transform.position.set(item.x, item.y, item.z);
  transform.rotation.set(0, item.rotationY, 0);
  transform.scale.setScalar(normalizedFurniturePresentationScale(item.scale));
  transform.updateMatrix();
  return transform.matrix;
}

function lifted(metres: number): PresentedPiece {
  const piece = placedPresentation();
  piece.delta.makeTranslation(0, metres, 0);
  return piece;
}

afterEach(() => {
  publishFurniturePresentation(null);
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

describe("the furniture presentation channel", () => {
  it("tells its followers each frame and the release, and keeps the frame in force", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFurniturePresentation(listener);
    const held: PresentationFrame = { pieces: new Map(), others: "hidden" };
    publishFurniturePresentation(held);
    expect(currentFurniturePresentation()).toBe(held);
    publishFurniturePresentation(null);
    publishFurniturePresentation(null);
    unsubscribe();
    expect(listener.mock.calls).toEqual([[held], [null]]);
    expect(currentFurniturePresentation()).toBeNull();
  });

  it("reads a piece as presented, hidden, or as placed", () => {
    const shown = lifted(1);
    const unseen = placedPresentation();
    unseen.visible = false;
    const presented: PresentationFrame = { pieces: new Map([["a", shown], ["b", unseen]]), others: "placed" };
    expect(presentedPiece(presented, "a")).toBe(shown);
    expect(presentedPiece(presented, "b")).toBe("hidden");
    expect(presentedPiece(presented, "c")).toBeNull();
    expect(presentedPiece({ ...presented, others: "hidden" }, "c")).toBe("hidden");
  });

  it("moves and hides instanced furniture and its shadows, then restores both byte for byte, never writing the store", () => {
    const root = mount(chairs);
    const truth = drawnBytes(root.scene);
    const placed = usePlacementStore.getState().placedItems;
    const batch = furnitureBatch(root.scene);
    const untouched = slot(batch, 2);
    const unseen = placedPresentation();
    unseen.visible = false;
    const shown = lifted(1);
    shown.shadowX = 5;
    shown.shadowZ = 1;
    shown.shadow = 0.5;
    shown.shadowSpread = 1.2;
    act(() => {
      publishFurniturePresentation({ pieces: new Map([[first.id, shown], [second.id, unseen]]), others: "placed" });
    });
    frame();
    // Lifted a metre: delta · placed.
    const expected = new Matrix4().makeTranslation(0, 1, 0).multiply(placedMatrix(first)).elements;
    slot(batch, 0).forEach((value, index) => { expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 5); });
    // Hidden: nothing drawn.
    expect(slot(batch, 1)).toEqual(HIDDEN_MATRIX.elements);
    // Not presented: as placed.
    expect(slot(batch, 2)).toEqual(untouched);
    // Its shadow lies where the frame says; the hidden piece casts none.
    const shadows = shadowMesh(root.scene);
    expect(slot(shadows, 0)[12]).toBeCloseTo(5, 5);
    expect(slot(shadows, 1)).toEqual(HIDDEN_MATRIX.elements);
    act(() => { publishFurniturePresentation(null); });
    frame();
    expect(drawnBytes(root.scene)).toEqual(truth);
    expect(usePlacementStore.getState().placedItems).toBe(placed);
  });

  it("draws the feet's floor shade only under furniture at rest: never under a piece the frame moves or hides", () => {
    const root = mount(chairs);
    const shades: InstancedMesh[] = [];
    root.scene.getObjectByName("instanced-furniture")?.traverse((object) => {
      if (isInstancedMesh(object) && !Array.isArray(object.material) && object.material.name === "crafted:contact") shades.push(object);
    });
    // The crafted chair grounds each foot with its own shade batch.
    expect(shades.length).toBeGreaterThan(0);
    expect(shades.every((mesh) => mesh.visible)).toBe(true);
    // A frame about other pieces leaves these as placed, shade and all.
    act(() => { publishFurniturePresentation({ pieces: new Map([["elsewhere", lifted(1)]]), others: "placed" }); });
    frame();
    expect(shades.every((mesh) => mesh.visible)).toBe(true);
    // Lifted: the shade would float with the chair, so the floor's own contact shadow grounds it alone.
    act(() => { publishFurniturePresentation({ pieces: new Map([[first.id, lifted(1)]]), others: "placed" }); });
    frame();
    expect(shades.some((mesh) => mesh.visible)).toBe(false);
    act(() => { publishFurniturePresentation(null); });
    frame();
    expect(shades.every((mesh) => mesh.visible)).toBe(true);
  });

  it("holds the room empty while a frame says so, even for furniture drawn after it was published", () => {
    act(() => { publishFurniturePresentation({ pieces: new Map(), others: "hidden" }); });
    const root = mount(chairs);
    const batch = furnitureBatch(root.scene);
    for (let index = 0; index < chairs.length; index++) expect(slot(batch, index)).toEqual(HIDDEN_MATRIX.elements);
    act(() => { publishFurniturePresentation(null); });
    frame();
    for (let index = 0; index < chairs.length; index++) expect(slot(batch, index)).not.toEqual(HIDDEN_MATRIX.elements);
  });
});

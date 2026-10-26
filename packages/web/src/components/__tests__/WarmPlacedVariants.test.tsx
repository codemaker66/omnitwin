import { act } from "@testing-library/react";
import { advance, useThree } from "@react-three/fiber";
import { type Camera, type InstancedMesh, type Material, type Object3D, Raycaster, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug, type CatalogueItem } from "../../lib/catalogue.js";
import { plannerChairSlug } from "../../lib/furniture-defaults.js";
import { createPlacedItem } from "../../lib/placement.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { instanceCapacityFor, InstancedFurnitureLayer } from "../editor/InstancedFurnitureLayer.js";
import { noteMainDraw } from "../../lib/main-draw-clock.js";
import { landsWith, poolsLanding, WARM_PLACED_FRAMES, WARM_PLACED_UPDATES, WarmPieceInHand, WarmPlacedVariants } from "../WarmPlacedVariants.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

function catalogueItem(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item;
}

const TABLE = catalogueItem("round-table-6ft");
const CHAIR = catalogueItem(plannerChairSlug());
/** The pool a first piece of a kind is drawn from. */
const FIRST = instanceCapacityFor(1);

let mounted: StubRoot | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
  useCatalogueStore.setState({ selectedItemId: null });
});

/** The pieces a warm-up is drawing templates of, by catalogue id. */
function warming(scene: Object3D): string[] {
  const ids: string[] = [];
  scene.traverse((object) => { if (object.name.startsWith("warm-template-")) ids.push(object.name.slice("warm-template-".length)); });
  return ids;
}

describe("landsWith", () => {
  it("lands a dining table with the planner's chair, and anything else alone", () => {
    expect(landsWith(TABLE)).toEqual([TABLE, CHAIR]);
    expect(landsWith(CHAIR)).toEqual([CHAIR]);
  });
});

describe("poolsLanding", () => {
  const placed = (counts: Readonly<Record<string, number>>) => (id: string): number => counts[id] ?? 0;

  it("warms the first pool of a table and of its seats on an empty floor", () => {
    expect(poolsLanding(TABLE, placed({}))).toEqual([{ item: TABLE, capacity: FIRST }, { item: CHAIR, capacity: FIRST }]);
  });

  it("warms the doubled pool the 33rd chair is drawn from", () => {
    expect(poolsLanding(CHAIR, placed({ [CHAIR.id]: FIRST }))).toEqual([{ item: CHAIR, capacity: instanceCapacityFor(FIRST + 1) }]);
  });

  it("warms both pools a table's seats can land in when they straddle a doubling", () => {
    const pools = poolsLanding(TABLE, placed({ [TABLE.id]: 3, [CHAIR.id]: FIRST - 2 }));
    expect(pools).toEqual([
      { item: TABLE, capacity: FIRST },
      { item: CHAIR, capacity: FIRST },
      { item: CHAIR, capacity: instanceCapacityFor(FIRST + 1) },
    ]);
  });
});

describe("WarmPieceInHand", () => {
  it("warms nothing with nothing in hand, and the table and its seats once a table is armed", () => {
    mounted = mountInStubRoot(<WarmPieceInHand />);
    expect(warming(mounted.scene)).toEqual([]);

    act(() => { useCatalogueStore.setState({ selectedItemId: TABLE.id }); });
    expect(warming(mounted.scene)).toEqual([TABLE.id, CHAIR.id]);
    expect(instancedUnder(mounted.scene, "warm-placed-variants").length).toBeGreaterThan(0);
  });

  it("warms the pool a table's seats grow into once the floor is near a doubling", () => {
    usePlacementStore.setState({ placedItems: Array.from({ length: FIRST - 2 }, (_unused, index) => createPlacedItem(CHAIR.id, index, 0, 0)) });
    mounted = mountInStubRoot(<WarmPieceInHand />);
    act(() => { useCatalogueStore.setState({ selectedItemId: TABLE.id }); });
    const capacities = new Set(instancedUnder(mounted.scene, "warm-placed-variants").map((mesh) => mesh.instanceMatrix.count));
    expect([...capacities].sort((a, b) => a - b)).toEqual([FIRST, instanceCapacityFor(FIRST + 1)]);
  });

  it("never warms table dressing, which lands on a table rather than as a piece", () => {
    const cloth = catalogueItem("white-table-cloth");
    mounted = mountInStubRoot(<WarmPieceInHand />);
    act(() => { useCatalogueStore.setState({ selectedItemId: cloth.id }); });
    expect(warming(mounted.scene)).toEqual([]);
  });
});

/** Render one frame, as the planner's demand loop does after each change. */
function frame(): void {
  act(() => { advance(performance.now(), true); });
}

/** A frame NativeCanvas draws: the update, then the main view's draw. */
function drawnFrame(): void {
  frame();
  noteMainDraw(performance.now());
}

const seen: { camera: Camera | null } = { camera: null };
function CameraProbe(): null {
  seen.camera = useThree((state) => state.camera);
  return null;
}

function StoreLayer(): React.ReactElement {
  const items = usePlacementStore((state) => state.placedItems);
  return <InstancedFurnitureLayer items={items} />;
}

function isInstancedMesh(object: Object3D): object is InstancedMesh {
  return (object as Partial<Pick<InstancedMesh, "isInstancedMesh">>).isInstancedMesh === true;
}

function instancedUnder(scene: Object3D, name: string): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  scene.getObjectByName(name)?.traverse((object) => { if (isInstancedMesh(object)) meshes.push(object); });
  return meshes;
}

/** What a render pipeline is built from: the geometry's layout, the material's kind and state, instancing, shadows. */
function pipelineShape(mesh: InstancedMesh): string {
  const material = mesh.material as Material;
  return JSON.stringify({
    attributes: Object.entries(mesh.geometry.attributes).map(([name, attribute]) => `${name}:${String(attribute.itemSize)}`).sort(),
    indexed: mesh.geometry.index !== null,
    material: material.type,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    side: material.side,
    instanceColor: mesh.instanceColor !== null,
    // three sizes the compiled instance-matrix binding from the pool's capacity.
    capacity: mesh.instanceMatrix.count,
    castShadow: mesh.castShadow,
    receiveShadow: mesh.receiveShadow,
  });
}

describe("WarmPlacedVariants", () => {
  it("draws the batches the furniture layer draws for the same pieces once placed", () => {
    usePlacementStore.setState({ placedItems: [createPlacedItem(TABLE.id, 0, 0, 0), createPlacedItem(CHAIR.id, 1.5, 0, 0)] });
    mounted = mountInStubRoot(
      <>
        <StoreLayer />
        <WarmPlacedVariants pools={[{ item: TABLE, capacity: FIRST }, { item: CHAIR, capacity: FIRST }]} />
      </>,
    );
    frame();

    const placed = instancedUnder(mounted.scene, "instanced-furniture").map(pipelineShape).sort();
    const warm = instancedUnder(mounted.scene, "warm-placed-variants").map(pipelineShape).sort();
    expect(placed.length).toBeGreaterThan(0);
    expect(warm).toEqual(placed);
  });

  it("draws one instance of each, too small to see, just ahead of the camera, for its first draws only", () => {
    mounted = mountInStubRoot(
      <>
        <CameraProbe />
        <WarmPlacedVariants pools={[{ item: TABLE, capacity: FIRST }]} />
      </>,
    );
    const meshes = instancedUnder(mounted.scene, "warm-placed-variants");
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.count).toBe(1);
    const batches = meshes[0]?.parent;
    if (batches === null || batches === undefined || seen.camera === null) throw new Error("Nothing warmed");

    for (let drawn = 0; drawn < WARM_PLACED_FRAMES; drawn++) {
      drawnFrame();
      expect(batches.visible).toBe(true);
    }
    const ahead = seen.camera.getWorldDirection(new Vector3()).add(seen.camera.position);
    expect(batches.position.distanceTo(ahead)).toBeLessThan(1e-9);
    expect(batches.scale.x).toBeLessThan(1e-3);

    frame();
    expect(batches.visible).toBe(false);
  });

  it("keeps warming through updates the paced canvas did not draw, and gives up only after many", () => {
    mounted = mountInStubRoot(<WarmPlacedVariants pools={[{ item: TABLE, capacity: FIRST }]} />);
    const batches = instancedUnder(mounted.scene, "warm-placed-variants")[0]?.parent;
    if (batches === null || batches === undefined) throw new Error("Nothing warmed");

    // Updates that drew nothing (the GPU behind) do not count.
    for (let update = 0; update < WARM_PLACED_FRAMES * 3; update++) frame();
    expect(batches.visible).toBe(true);
    // Where nothing ever draws, the warm-up stops asking.
    for (let update = 0; update < WARM_PLACED_UPDATES; update++) frame();
    expect(batches.visible).toBe(false);
  });

  it("is never found by a raycast through the place it is built", () => {
    mounted = mountInStubRoot(<WarmPlacedVariants pools={[{ item: TABLE, capacity: FIRST }, { item: CHAIR, capacity: FIRST }]} />);
    frame();
    // The templates stand at the origin; a ray straight down through it finds nothing of them.
    const raycaster = new Raycaster(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mounted.scene, true)).toEqual([]);
  });

  it("lets go of the geometry and materials it harvested when the piece leaves the hand", () => {
    mounted = mountInStubRoot(<WarmPlacedVariants pools={[{ item: TABLE, capacity: FIRST }, { item: CHAIR, capacity: FIRST }]} />);
    const meshes = instancedUnder(mounted.scene, "warm-placed-variants");
    expect(meshes.length).toBeGreaterThan(0);
    const released = new Set<object>();
    for (const mesh of meshes) {
      mesh.geometry.addEventListener("dispose", () => { released.add(mesh.geometry); });
      (mesh.material as Material).addEventListener("dispose", () => { released.add(mesh.material as Material); });
    }

    mounted.unmount();
    mounted = null;

    for (const mesh of meshes) {
      expect(released.has(mesh.geometry)).toBe(true);
      expect(released.has(mesh.material as Material)).toBe(true);
    }
  });
});

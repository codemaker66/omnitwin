import { act } from "@testing-library/react";
import { advance, useThree } from "@react-three/fiber";
import { type Camera, type InstancedMesh, type Material, type Object3D, Raycaster, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug, type CatalogueItem } from "../../lib/catalogue.js";
import { DEFAULT_PLANNER_CHAIR_SLUG } from "../../lib/furniture-defaults.js";
import { createPlacedItem } from "../../lib/placement.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { InstancedFurnitureLayer } from "../editor/InstancedFurnitureLayer.js";
import { WARM_PLACED_FRAMES, WarmPlacedVariants } from "../WarmPlacedVariants.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

function catalogueItem(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item;
}

const TABLE = catalogueItem("round-table-6ft");
const CHAIR = catalogueItem(DEFAULT_PLANNER_CHAIR_SLUG);

let mounted: StubRoot | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  usePlacementStore.setState({ placedItems: [] });
});

/** Render one frame, as the planner's demand loop does after each change. */
function frame(): void {
  act(() => { advance(performance.now(), true); });
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
        <WarmPlacedVariants items={[TABLE, CHAIR]} />
      </>,
    );
    frame();

    const placed = instancedUnder(mounted.scene, "instanced-furniture").map(pipelineShape).sort();
    const warm = instancedUnder(mounted.scene, "warm-placed-variants").map(pipelineShape).sort();
    expect(placed.length).toBeGreaterThan(0);
    expect(warm).toEqual(placed);
  });

  it("draws one instance of each, too small to see, just ahead of the camera, for its first frames only", () => {
    mounted = mountInStubRoot(
      <>
        <CameraProbe />
        <WarmPlacedVariants items={[TABLE]} />
      </>,
    );
    const meshes = instancedUnder(mounted.scene, "warm-placed-variants");
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.count).toBe(1);
    const batches = meshes[0]?.parent;
    if (batches === null || batches === undefined || seen.camera === null) throw new Error("Nothing warmed");

    for (let drawn = 0; drawn < WARM_PLACED_FRAMES; drawn++) {
      frame();
      expect(batches.visible).toBe(true);
    }
    const ahead = seen.camera.getWorldDirection(new Vector3()).add(seen.camera.position);
    expect(batches.position.distanceTo(ahead)).toBeLessThan(1e-9);
    expect(batches.scale.x).toBeLessThan(1e-3);

    frame();
    expect(batches.visible).toBe(false);
  });

  it("is never found by a raycast through the place it is built", () => {
    mounted = mountInStubRoot(<WarmPlacedVariants items={[TABLE, CHAIR]} />);
    frame();
    // The templates stand at the origin; a ray straight down through it finds nothing of them.
    const raycaster = new Raycaster(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mounted.scene, true)).toEqual([]);
  });

  it("lets go of the geometry and materials it harvested when the piece leaves the hand", () => {
    mounted = mountInStubRoot(<WarmPlacedVariants items={[TABLE, CHAIR]} />);
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

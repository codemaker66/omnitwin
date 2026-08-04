import {
  Box3,
  Group,
  Mesh,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createBarCounterProxy } from "../createBarCounterProxy.js";
import { createDanceFloorPanelProxy } from "../createDanceFloorPanelProxy.js";
import { createPlatformProxy } from "../createPlatformProxy.js";
import { createTrestleTableProxy } from "../createTrestleTableProxy.js";

interface FactoryOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface GeneratedFactoryFixture {
  readonly slug: string;
  readonly dimensions: readonly [number, number, number];
  readonly keyParts: readonly string[];
  readonly factory: (options?: FactoryOptions) => Group;
}

const GENERATED_FACTORY_FIXTURES = [
  {
    slug: "trestle-6ft",
    dimensions: [1.83, 0.74, 0.76],
    keyParts: ["tabletop", "left-front-leg", "right-rear-leg", "centre-stretcher"],
    factory: createTrestleTableProxy,
  },
  {
    slug: "platform",
    dimensions: [2.44, 0.4, 1.22],
    keyParts: ["deck", "front-left-leg", "rear-right-leg", "front-left-diagonal-brace"],
    factory: createPlatformProxy,
  },
  {
    slug: "bar-counter",
    dimensions: [1.6, 1.208, 0.61],
    keyParts: ["countertop", "guest-panel-2", "staff-service-shelf", "guest-foot-rail"],
    factory: createBarCounterProxy,
  },
  {
    slug: "dancefloor-panel",
    dimensions: [0.91, 0.05, 0.91],
    keyParts: [
      "deck",
      "subframe",
      "corner-lock-front-left",
      "deck-parquet-finger-r1c1-1-detail",
    ],
    factory: createDanceFloorPanelProxy,
  },
] as const satisfies readonly GeneratedFactoryFixture[];

function modelMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

function modelMaterials(root: Object3D): Set<Material> {
  const materials = new Set<Material>();
  for (const mesh of modelMeshes(root)) {
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  }
  return materials;
}

for (const fixture of GENERATED_FACTORY_FIXTURES) {
  describe(fixture.slug, () => {
    it("builds its exact canonical metre envelope from a unit root", () => {
      const root = fixture.factory();
      const bounds = new Box3().setFromObject(root);
      const size = bounds.getSize(new Vector3());

      expect(size.x).toBeCloseTo(fixture.dimensions[0], 3);
      expect(size.y).toBeCloseTo(fixture.dimensions[1], 3);
      expect(size.z).toBeCloseTo(fixture.dimensions[2], 3);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(root.position.toArray()).toEqual([0, 0, 0]);
      expect(root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(root.scale.toArray()).toEqual([1, 1, 1]);
    });

    it("publishes complete named runtime, collider, socket, and destruction maps", () => {
      const root = fixture.factory();
      const runtime = readImg2ThreeSculptRuntime(root);
      const meshes = modelMeshes(root);
      const runtimeMeshes = Object.values(runtime.meshes);

      expect(runtime.nodes.root).toBe(root);
      expect(new Set(runtimeMeshes)).toEqual(new Set(meshes));
      expect(new Set(meshes.map((mesh) => mesh.name)).size).toBe(meshes.length);
      expect(meshes.every((mesh) => mesh.name.trim().length > 0)).toBe(true);
      expect(meshes.every((mesh) => !Array.isArray(mesh.material))).toBe(true);
      expect(Object.keys(runtime.colliders).sort()).toEqual(Object.keys(runtime.nodes).sort());
      expect(Object.keys(runtime.sockets).length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(runtime.destructionGroups).length).toBeGreaterThanOrEqual(5);

      for (const partId of fixture.keyParts) {
        expect(runtime.nodes[partId]).toBeDefined();
        expect(runtime.meshes[partId]).toBeDefined();
        expect(runtime.colliders[partId]).toBeDefined();
      }

      const presentation = createFurniturePresentationRuntime(root, {
        explodeDistance: 0.25,
      });
      const inspectionIds = new Set(presentation.inspectionParts.map((part) => part.id));
      for (const partId of fixture.keyParts) expect(inspectionIds.has(partId)).toBe(true);
    });

    it("keeps subordinate details attached and honours explicit shadow options", () => {
      const root = fixture.factory({ castShadow: false, receiveShadow: true });
      const meshes = modelMeshes(root);
      const details = meshes.filter((mesh) => mesh.userData.surfaceDetail === true);

      expect(details.length).toBeGreaterThan(0);
      expect(details.every((mesh) => mesh.userData.explodeWithParent === true)).toBe(true);
      expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);
      expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);
    });

    it("creates fresh geometry and materials for every owned root", () => {
      const first = fixture.factory();
      const second = fixture.factory();
      const firstMeshes = modelMeshes(first);
      const secondGeometry = new Set(modelMeshes(second).map((mesh) => mesh.geometry));
      const secondMaterials = modelMaterials(second);

      expect(firstMeshes.every((mesh) => !secondGeometry.has(mesh.geometry))).toBe(true);
      expect([...modelMaterials(first)].every((material) => !secondMaterials.has(material)))
        .toBe(true);
    });

    // Every mesh must physically touch something. A part floating in space is
    // invisible in the assembled view but obvious the moment the inspector
    // explodes the model, and it is the signature of a mis-measured constant.
    // This shape of defect was found three times in the Gen-1 factories: a
    // crossbar bolted to nothing 4mm short of its cleat, a stretcher bracket
    // 18mm from any leg, and a rim sealed inside 24mm of solid oak.
    it(`${fixture.slug} has no part floating free of the assembly`, () => {
      const root = fixture.factory();
      root.updateMatrixWorld(true);
      const boxes = modelMeshes(root).map((mesh) => ({
        mesh,
        box: new Box3().setFromObject(mesh),
      }));

      const TOUCH_EPSILON = 0.001; // 1mm — a fabrication tolerance, not a gap.
      const isRelated = (a: Object3D, b: Object3D): boolean => {
        for (let node: Object3D | null = a; node !== null; node = node.parent) {
          if (node === b) return true;
        }
        for (let node: Object3D | null = b; node !== null; node = node.parent) {
          if (node === a) return true;
        }
        return false;
      };

      const orphans = boxes
        .filter(({ mesh, box }) => {
          const grown = box.clone().expandByScalar(TOUCH_EPSILON);
          return !boxes.some(({ mesh: other, box: otherBox }) => (
            other !== mesh && !isRelated(mesh, other) && grown.intersectsBox(otherBox)
          ));
        })
        .map(({ mesh }) => mesh.name);

      expect(orphans, `floating parts in ${fixture.slug}`).toEqual([]);
    });
  });
}

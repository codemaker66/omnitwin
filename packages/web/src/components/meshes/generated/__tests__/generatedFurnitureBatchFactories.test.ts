import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createBanquetChairProxy } from "../createBanquetChairProxy.js";
import { createBarCounterProxy } from "../createBarCounterProxy.js";
import { createDanceFloorPanelProxy } from "../createDanceFloorPanelProxy.js";
import { createLaptopProxy } from "../createLaptopProxy.js";
import { createLecternProxy } from "../createLecternProxy.js";
import { createMicrophoneProxy } from "../createMicrophoneProxy.js";
import { createMicStandProxy } from "../createMicStandProxy.js";
import { createPlatformNarrowProxy } from "../createPlatformNarrowProxy.js";
import { createPlatformProxy } from "../createPlatformProxy.js";
import {
  createPoseurTableBlackProxy,
  createPoseurTableWhiteProxy,
} from "../createPoseurTableClothProxy.js";
import { createPoseurTableProxy } from "../createPoseurTableProxy.js";
import { createProjectorProxy } from "../createProjectorProxy.js";
import { createProjectorScreenProxy } from "../createProjectorScreenProxy.js";
import { createRoundTableProxy } from "../createRoundTableProxy.js";
import { createTrestle4ftProxy } from "../createTrestle4ftProxy.js";
import { createTrestleTableProxy } from "../createTrestleTableProxy.js";
import { GENERATED_FURNITURE_SLUGS } from "../generatedFurnitureRegistry.js";

interface FactoryOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

interface GeneratedFactoryFixture {
  readonly slug: string;
  readonly dimensions: readonly [number, number, number];
  readonly keyParts: readonly string[];
  readonly evidenceSource: string;
  readonly evidenceImage: string | null;
  readonly limitationFragments?: readonly string[];
  readonly minimumDestructionGroups?: number;
  readonly minimumSockets?: number;
  readonly minimumSurfaceDetails?: number;
  readonly factory: (options?: FactoryOptions) => Group;
}

interface ProvenanceManifestEntry {
  readonly referenceImage: string | null;
  readonly referenceSha256: string | null;
  readonly retainedSourceRecord?: {
    readonly kind: "git-blob";
    readonly commit: string;
    readonly blob: string;
    readonly path: string;
  } | null;
  readonly sourceKind: string;
  readonly generator: string;
  readonly geometryKind: string;
  readonly authority: string;
  readonly measuredGeometry: boolean;
  readonly canonicalDimensionsMetres: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly dimensionsSource: string;
  readonly limitations: readonly string[];
}

interface ProvenanceManifest {
  readonly schemaVersion: string;
  readonly purpose: string;
  readonly measuredGeometry: boolean;
  readonly entries: Readonly<Record<string, ProvenanceManifestEntry>>;
}

const PROVENANCE_MANIFEST_PATH =
  "src/assets/generated-furniture/provenance-manifest-v1.json";

const LEGACY_RESTORED_SOURCE_RECORDS = {
  "banquet-chair": {
    kind: "git-blob",
    commit: "9c98b293e984ddf2876c65360d873e7ed03ab539",
    blob: "29ef17657c685c1128ad1f8d427dad4f4ad2b9e1",
    path: "packages/web/src/assets/generated-furniture/banquet-chair-imagegen-v1.png",
  },
  "round-table-6ft": {
    kind: "git-blob",
    commit: "9c98b293e984ddf2876c65360d873e7ed03ab539",
    blob: "6d638169a60fe829a5db20a125cc0f11d74cf016",
    path: "packages/web/src/assets/generated-furniture/round-table-6ft-imagegen-v1.png",
  },
} as const;

const GENERATED_FACTORY_FIXTURES: readonly GeneratedFactoryFixture[] = [
  {
    slug: "banquet-chair",
    dimensions: [0.45, 0.9, 0.45],
    keyParts: ["seat-pad", "backrest-pad", "front-left-leg", "right-lateral-brace"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#banquet-chair",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/banquet-chair-imagegen-v1.png",
    limitationFragments: ["single AI-generated", "not measured venue evidence"],
    factory: createBanquetChairProxy,
  },
  {
    slug: "round-table-6ft",
    dimensions: [1.83, 0.76, 1.83],
    keyParts: [
      "tabletop",
      "trestle-a",
      "front-left-leg",
      "rear-right-leg",
      "left-front-brace",
      "frame-crossbar",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#round-table-6ft",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/round-table-6ft-imagegen-v1.png",
    limitationFragments: ["single AI-generated", "folding kinematics", "not measured venue evidence"],
    minimumSockets: 1,
    factory: createRoundTableProxy,
  },
  {
    slug: "trestle-6ft",
    dimensions: [1.83, 0.74, 0.76],
    keyParts: ["tabletop", "left-front-upright", "right-rear-upright", "stretcher"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#trestle-6ft",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/trestle-6ft-imagegen-v1.png",
    factory: createTrestleTableProxy,
  },
  {
    slug: "platform",
    dimensions: [2.44, 0.4, 1.22],
    keyParts: ["deck-panel", "front-left-upright", "rear-right-upright", "front-left-diagonal-brace"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#platform",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/platform-imagegen-v1.png",
    factory: createPlatformProxy,
  },
  {
    slug: "bar-counter",
    dimensions: [1.6, 1.208, 0.61],
    keyParts: [
      "countertop",
      "front-panel-centre",
      "rear-left-post",
      "service-shelf",
      "guest-foot-rail",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#bar-counter",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/bar-counter-imagegen-v1.png",
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
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#dancefloor-panel",
    evidenceImage: null,
    limitationFragments: ["No retained source image", "procedural planning approximations"],
    factory: createDanceFloorPanelProxy,
  },
  {
    slug: "projector-screen",
    dimensions: [2.5, 1.8, 0.6],
    keyParts: [
      "screen-surface",
      "top-frame-rail",
      "left-lower-post",
      "right-base-rail",
      "left-front-brace",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector-screen",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/projector-screen-imagegen-v1.png",
    factory: createProjectorScreenProxy,
  },
  {
    slug: "lectern",
    dimensions: [0.6, 1.15, 0.5],
    keyParts: [
      "lower-plinth",
      "front-panel-field",
      "shelf-recess",
      "reading-deck",
      "cable-grommet",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#lectern",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/lectern-imagegen-v1.png",
    factory: createLecternProxy,
  },
  {
    slug: "projector",
    dimensions: [0.55, 0.1, 0.35],
    keyParts: [
      "chassis-shell",
      "top-shell",
      "optical-assembly",
      "front-vent-system",
      "side-vent-system",
      "rear-connector-recess",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#projector",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/projector-imagegen-v1.png",
    factory: createProjectorProxy,
  },
  {
    slug: "trestle-4ft",
    dimensions: [1.22, 0.74, 0.76],
    keyParts: ["tabletop", "left-front-upright", "right-rear-upright", "stretcher"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#trestle-4ft",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/trestle-4ft-imagegen-v1.png",
    factory: createTrestle4ftProxy,
  },
  {
    slug: "platform-narrow",
    dimensions: [2.44, 0.4, 1.02],
    keyParts: [
      "deck-panel",
      "front-centre-upright",
      "rear-right-upright",
      "front-centre-left-diagonal-brace",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#platform-narrow",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/platform-narrow-imagegen-v1.png",
    factory: createPlatformNarrowProxy,
  },
  {
    slug: "poseur-table",
    dimensions: [0.6, 1.05, 0.6],
    keyParts: ["top-surface", "rolled-rim", "pedestal-column", "arm-north", "foot-pad-west"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/poseur-table-imagegen-v1.png",
    minimumDestructionGroups: 4,
    minimumSurfaceDetails: 0,
    factory: createPoseurTableProxy,
  },
  {
    slug: "laptop",
    dimensions: [0.36, 0.25, 0.25],
    keyParts: ["base-shell", "upper-deck", "trackpad", "hinge-left", "display-shell", "screen-surface"],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#laptop",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/laptop-imagegen-v1.png",
    limitationFragments: ["single generated view", "hinge articulation", "not measured venue evidence"],
    minimumDestructionGroups: 4,
    minimumSurfaceDetails: 0,
    factory: createLaptopProxy,
  },
  {
    slug: "mic-stand",
    dimensions: [0.5, 1.6, 0.5],
    keyParts: [
      "tripod-hub-shell",
      "lower-upright-pole",
      "boom-hinge-body",
      "boom-tube",
      "empty-clip-left-jaw",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#mic-stand",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/mic-stand-imagegen-v1.png",
    limitationFragments: [
      "passive stand-only",
      "empty microphone clip",
      "no microphone, cable, power system",
      "not measured venue evidence",
    ],
    minimumDestructionGroups: 7,
    factory: createMicStandProxy,
  },
  {
    slug: "microphone",
    dimensions: [0.1, 0.25, 0.1],
    keyParts: [
      "upper-base-shell",
      "mute-switch",
      "gooseneck-core",
      "capsule-barrel",
      "grille-face",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#microphone",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/microphone-imagegen-v1.png",
    limitationFragments: [
      "tabletop gooseneck microphone",
      "No cable, rear connector, or logo is invented",
      "not measured venue evidence",
    ],
    minimumDestructionGroups: 4,
    factory: createMicrophoneProxy,
  },
  {
    slug: "poseur-table-black",
    dimensions: [0.6, 1.05, 0.6],
    keyParts: [
      "cover-assembly",
      "upper-hem",
      "lower-hem",
      "vertical-seam",
      "anchor-pad-front-left",
      "anchor-pad-rear-right",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-black",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/poseur-table-black-imagegen-v1.png",
    limitationFragments: ["generated", "single admitted view", "not measured venue evidence"],
    minimumDestructionGroups: 3,
    factory: createPoseurTableBlackProxy,
  },
  {
    slug: "poseur-table-white",
    dimensions: [0.6, 1.05, 0.6],
    keyParts: [
      "cover-assembly",
      "upper-hem",
      "lower-hem",
      "vertical-seam",
      "anchor-pad-front-right",
      "anchor-pad-rear-left",
    ],
    evidenceSource:
      "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#poseur-table-white",
    evidenceImage:
      "packages/web/src/assets/generated-furniture/poseur-table-white-imagegen-v1.png",
    limitationFragments: [
      "failed foreground admission",
      "low-contrast",
      "material evidence only",
      "admitted black reference",
    ],
    minimumDestructionGroups: 3,
    factory: createPoseurTableWhiteProxy,
  },
];

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
      const catalogueItem = getCatalogueItemBySlug(fixture.slug);
      if (catalogueItem === undefined) {
        throw new Error(`${fixture.slug} is missing from the canonical catalogue`);
      }
      expect([
        catalogueItem.width,
        catalogueItem.height,
        catalogueItem.depth,
      ]).toEqual(fixture.dimensions);

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
      expect(root.userData.provenance).toBe("generated");
      expect(root.userData.authority).toBe("presentation-only");
      expect(root.userData.measuredGeometry).toBe(false);
      expect(root.userData.evidenceSource).toBe(fixture.evidenceSource);
      if (fixture.evidenceImage === null) {
        expect(root.userData.evidenceImage).toBeNull();
      } else {
        expect(root.userData.evidenceImage).toBe(fixture.evidenceImage);
      }
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
      expect(Object.keys(runtime.sockets).length).toBeGreaterThanOrEqual(
        fixture.minimumSockets ?? 3,
      );
      expect(Object.keys(runtime.destructionGroups).length).toBeGreaterThanOrEqual(
        fixture.minimumDestructionGroups ?? 5,
      );

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

      expect(details.length).toBeGreaterThanOrEqual(fixture.minimumSurfaceDetails ?? 1);
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

describe("bar-counter reference-backed correction", () => {
  it("keeps the left return open and carries the service shelf into the bay", () => {
    const root = createBarCounterProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    root.updateMatrixWorld(true);

    expect(runtime.nodes["left-side-wall"]).toBeUndefined();
    for (const partId of [
      "rear-left-post",
      "left-return-lower-rail",
      "left-return-upper-rail",
      "service-shelf",
    ]) {
      expect(runtime.nodes[partId]).toBeDefined();
      expect(runtime.meshes[partId]).toBeDefined();
      expect(runtime.colliders[partId]).toBeDefined();
    }

    const openingRay = new Raycaster(
      new Vector3(-1, 0.8, 0),
      new Vector3(1, 0, 0),
      0,
      2.5,
    );
    const [firstHit] = openingRay.intersectObjects(modelMeshes(root), false);
    expect(firstHit?.object.userData.componentId).toBe("right-return");

    const shelf = runtime.nodes["service-shelf"];
    if (shelf === undefined) throw new Error("bar counter shelf is missing");
    const shelfBounds = new Box3().setFromObject(shelf);
    expect(shelfBounds.min.x).toBeLessThanOrEqual(-0.675);
    expect(shelfBounds.max.x).toBeGreaterThanOrEqual(0.675);
  });

  it("uses directional sRGB grain maps across the visible timber systems", () => {
    const root = createBarCounterProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const expectedMaps = [
      ["countertop-walnut-inset-detail", "bar-counter-countertop-grain"],
      ["front-left-post", "bar-counter-vertical-frame-grain"],
      ["guest-upper-facade-rail", "bar-counter-horizontal-frame-grain"],
      ["front-panel-centre", "bar-counter-recessed-panel-grain"],
      ["service-shelf", "bar-counter-interior-grain"],
      ["lower-plinth", "bar-counter-plinth-grain"],
    ] as const;

    for (const [partId, textureName] of expectedMaps) {
      const mesh = runtime.meshes[partId];
      if (mesh === undefined) throw new Error(`bar counter part ${partId} is missing`);
      const material = mesh.material;
      expect(material).toBeInstanceOf(MeshStandardMaterial);
      if (!(material instanceof MeshStandardMaterial)) {
        throw new Error(`bar counter part ${partId} does not use a standard material`);
      }
      expect(material.map?.name).toBe(textureName);
      expect(material.map?.colorSpace).toBe(SRGBColorSpace);
      expect(material.metalness).toBe(0);
      expect(material.roughness).toBeGreaterThanOrEqual(0.4);
      expect(material.roughness).toBeLessThanOrEqual(0.7);
    }

    const second = readImg2ThreeSculptRuntime(createBarCounterProxy());
    const firstMap = (runtime.meshes["front-panel-centre"]?.material as MeshStandardMaterial).map;
    const secondMap = (second.meshes["front-panel-centre"]?.material as MeshStandardMaterial).map;
    expect(firstMap).toBeDefined();
    expect(secondMap).toBeDefined();
    expect(firstMap).not.toBe(secondMap);
  });
});

describe("generated furniture provenance manifest", () => {
  it("pins the restored reference images, honest authority, and canonical envelopes", async () => {
    const rawManifest = await readFile(PROVENANCE_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(rawManifest) as ProvenanceManifest;

    expect(manifest.schemaVersion).toBe("venviewer.generated-furniture-provenance.v1");
    expect(manifest.purpose).toBe("presentation-only");
    expect(manifest.measuredGeometry).toBe(false);

    expect(Object.keys(manifest.entries).sort()).toEqual(
      [...GENERATED_FURNITURE_SLUGS].sort(),
    );
    expect(GENERATED_FACTORY_FIXTURES.map(({ slug }) => slug).sort()).toEqual(
      [...GENERATED_FURNITURE_SLUGS].sort(),
    );

    for (const fixture of GENERATED_FACTORY_FIXTURES) {
      const entry = manifest.entries[fixture.slug];
      if (entry === undefined) throw new Error(`missing provenance entry ${fixture.slug}`);

      expect(entry).toMatchObject({
        geometryKind: "procedural-generated-stand-in",
        authority: "presentation-only",
        measuredGeometry: false,
        canonicalDimensionsMetres: {
          width: fixture.dimensions[0],
          height: fixture.dimensions[1],
          depth: fixture.dimensions[2],
        },
        dimensionsSource: "canonical-catalogue-spec",
      });
      if (fixture.evidenceImage === null) {
        expect(entry).toMatchObject({
          referenceImage: null,
          referenceSha256: null,
          retainedSourceRecord: null,
          sourceKind: "procedural-code-no-retained-source",
          generator: "Venviewer procedural TypeScript factory",
        });
      } else {
        expect(entry).toMatchObject({
          sourceKind: "ai-generated-image",
          generator: "OpenAI ImageGen",
        });
        if (entry.referenceImage === null) {
          throw new Error(`missing reference image for ${fixture.slug}`);
        }
        const imagePath = resolve(
          dirname(PROVENANCE_MANIFEST_PATH),
          basename(entry.referenceImage),
        );
        const imageHash = createHash("sha256").update(await readFile(imagePath)).digest("hex");
        expect(entry.referenceSha256).toBe(imageHash);
        expect(fixture.evidenceImage.endsWith(basename(entry.referenceImage))).toBe(true);
        if (fixture.slug in LEGACY_RESTORED_SOURCE_RECORDS) {
          const restoredSlug = fixture.slug as keyof typeof LEGACY_RESTORED_SOURCE_RECORDS;
          expect(entry.retainedSourceRecord).toEqual(
            LEGACY_RESTORED_SOURCE_RECORDS[restoredSlug],
          );
        }
      }
      expect(fixture.evidenceSource).toBe(
        `packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#${fixture.slug}`,
      );
      expect(entry.limitations.join(" ")).toContain("not measured venue evidence");
      for (const fragment of fixture.limitationFragments ?? []) {
        expect(entry.limitations.join(" ")).toContain(fragment);
      }
    }
  });
});

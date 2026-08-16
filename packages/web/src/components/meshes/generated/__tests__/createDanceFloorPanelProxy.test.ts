import { Box3, Mesh, Vector3, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createDanceFloorPanelProxy } from "../createDanceFloorPanelProxy.js";

const PANEL_WIDTH = 0.91;
const PANEL_DEPTH = 0.91;
const PANEL_HEIGHT = 0.05;

// 3 cells per axis x 3 fingers per cell = 27 parquet fingers.
const EXPECTED_FINGER_COUNT = 27;

function meshesOf(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

describe("createDanceFloorPanelProxy", () => {
  it("is a 3ft square panel sitting flat on the floor", () => {
    const root = createDanceFloorPanelProxy();
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());

    expect(size.x).toBeCloseTo(PANEL_WIDTH, 3);
    expect(size.z).toBeCloseTo(PANEL_DEPTH, 3);
    expect(size.y).toBeCloseTo(PANEL_HEIGHT, 3);
    expect(box.min.y).toBeCloseTo(0, 5);
    // A dance floor is walked on: the top must be the parquet, at exactly the
    // canonical height, or a guest standing on it would float or sink.
    expect(box.max.y).toBeCloseTo(PANEL_HEIGHT, 5);
  });

  it("lays a full basket weave with alternating finger direction", () => {
    const root = createDanceFloorPanelProxy();
    const runtime = readImg2ThreeSculptRuntime(root);
    const fingerIds = Object.keys(runtime.nodes)
      .filter((id) => id.startsWith("deck-parquet-finger-"));

    expect(fingerIds).toHaveLength(EXPECTED_FINGER_COUNT);

    // Adjacent cells must run at 90 degrees to each other, or the "weave" is
    // just stripes.
    const cellA = runtime.nodes["deck-parquet-finger-r1c1-1-detail"];
    const cellB = runtime.nodes["deck-parquet-finger-r1c2-1-detail"];
    expect(cellA).toBeDefined();
    expect(cellB).toBeDefined();
    if (cellA === undefined || cellB === undefined) return;

    const sizeA = new Box3().setFromObject(cellA).getSize(new Vector3());
    const sizeB = new Box3().setFromObject(cellB).getSize(new Vector3());

    expect(sizeA.x > sizeA.z).toBe(true);
    expect(sizeB.z > sizeB.x).toBe(true);
    expect(sizeA.x).toBeCloseTo(sizeB.z, 4);
  });

  it("keeps every part inside the panel footprint and above the floor", () => {
    const root = createDanceFloorPanelProxy();
    root.updateMatrixWorld(true);
    const runtime = readImg2ThreeSculptRuntime(root);

    for (const [id, node] of Object.entries(runtime.nodes)) {
      if (id === "root") continue;
      const box = new Box3().setFromObject(node);
      expect(box.min.x, `${id} overhangs -x`).toBeGreaterThanOrEqual(-PANEL_WIDTH / 2 - 1e-6);
      expect(box.max.x, `${id} overhangs +x`).toBeLessThanOrEqual(PANEL_WIDTH / 2 + 1e-6);
      expect(box.min.z, `${id} overhangs -z`).toBeGreaterThanOrEqual(-PANEL_DEPTH / 2 - 1e-6);
      expect(box.max.z, `${id} overhangs +z`).toBeLessThanOrEqual(PANEL_DEPTH / 2 + 1e-6);
      expect(box.min.y, `${id} sinks below the floor`).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("exposes the four edge-link sockets a tiled floor registers against", () => {
    const root = createDanceFloorPanelProxy();
    const runtime = readImg2ThreeSculptRuntime(root);

    expect(Object.keys(runtime.sockets).sort()).toEqual([
      "dance-surface-centre",
      "edge-link-front",
      "edge-link-left",
      "edge-link-rear",
      "edge-link-right",
      "floor-contact",
    ]);

    // Each edge link must sit exactly on its edge midpoint, so two panels
    // placed one panel-width apart meet with no seam and no overlap.
    const front = runtime.sockets["edge-link-front"];
    const rear = runtime.sockets["edge-link-rear"];
    const left = runtime.sockets["edge-link-left"];
    const right = runtime.sockets["edge-link-right"];
    expect(front?.position.z).toBeCloseTo(PANEL_DEPTH / 2, 6);
    expect(rear?.position.z).toBeCloseTo(-PANEL_DEPTH / 2, 6);
    expect(left?.position.x).toBeCloseTo(-PANEL_WIDTH / 2, 6);
    expect(right?.position.x).toBeCloseTo(PANEL_WIDTH / 2, 6);
    expect(front?.position.x).toBeCloseTo(0, 6);
    expect(right?.position.z).toBeCloseTo(0, 6);
  });

  it("treats the parquet as one surface — fingers ride the deck and delegate clicks", () => {
    const root = createDanceFloorPanelProxy();
    const runtime = createFurniturePresentationRuntime(root, { explodeDistance: 0.4 });
    const sculpt = readImg2ThreeSculptRuntime(root);
    const finger = sculpt.meshes["deck-parquet-finger-r2c2-2-detail"];
    const deckPivot = sculpt.nodes.deck;
    expect(finger).toBeDefined();
    expect(deckPivot).toBeDefined();
    if (finger === undefined || deckPivot === undefined) return;

    // Clicking a single 9cm finger should select the whole dance surface —
    // nobody wants to select one block of parquet.
    expect(runtime.resolveInspectionPart(finger)?.id).toBe("deck");

    root.updateMatrixWorld(true);
    const fingerBefore = finger.getWorldPosition(new Vector3());
    const deckBefore = deckPivot.getWorldPosition(new Vector3());

    runtime.setExplodeProgress(1);
    root.updateMatrixWorld(true);
    const fingerDelta = finger.getWorldPosition(new Vector3()).sub(fingerBefore);
    const deckDelta = deckPivot.getWorldPosition(new Vector3()).sub(deckBefore);

    expect(fingerDelta.distanceTo(deckDelta)).toBeLessThan(1e-9);
    expect(deckDelta.length()).toBeGreaterThan(0);
  });

  it("returns to its exact resting pose when the explode slider is released", () => {
    const root = createDanceFloorPanelProxy();
    const runtime = createFurniturePresentationRuntime(root, { explodeDistance: 0.4 });
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);

    runtime.setExplodeProgress(1);
    runtime.setExplodeProgress(0);
    root.updateMatrixWorld(true);
    const restored = new Box3().setFromObject(root);

    expect(restored.min.toArray()).toEqual(box.min.toArray());
    expect(restored.max.toArray()).toEqual(box.max.toArray());
  });

  it("publishes honest procedural provenance without inventing a source image", () => {
    const root = createDanceFloorPanelProxy();

    expect(root.name).toBe("dancefloor-panel-proxy");
    expect(root.userData.canonicalDimensionsMetres)
      .toEqual([PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH]);
    expect(root.userData).toMatchObject({
      evidenceSource:
        "packages/web/src/assets/generated-furniture/provenance-manifest-v1.json#dancefloor-panel",
      evidenceImage: null,
      provenance: "generated",
      authority: "presentation-only",
      measuredGeometry: false,
      sourceKind: "procedural-code-no-retained-source",
      generator: "Venviewer procedural TypeScript factory",
      geometryKind: "procedural-generated-stand-in",
      limitations: [
        "No retained source image or measurement evidence exists for this legacy proxy.",
        "Appearance, parquet pattern, subframe, locks, and hidden construction are procedural planning approximations.",
        "The procedural mesh is constrained by the canonical catalogue envelope and is not measured venue evidence.",
      ],
    });
  });

  it("honours an explicit shadow opt-out on every mesh including the fingers", () => {
    const root = createDanceFloorPanelProxy({ castShadow: false, receiveShadow: true });
    const meshes = meshesOf(root);

    expect(meshes.length).toBeGreaterThan(EXPECTED_FINGER_COUNT);
    for (const mesh of meshes) {
      expect(mesh.castShadow, mesh.name).toBe(false);
      expect(mesh.receiveShadow, mesh.name).toBe(true);
    }
  });
});

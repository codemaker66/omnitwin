import { describe, expect, it } from "vitest";
import {
  BatchedMesh,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from "three";
import {
  buildParallaxBatch,
  updateParallaxCorridor,
} from "../ParallaxStage.js";

describe("ParallaxStage geometry batch", () => {
  it("collapses a 144-primitive GLTF-shaped scene into one position-only batch", () => {
    const scene = new Scene();
    const sourceMaterial = new MeshBasicMaterial();
    const sources: Mesh[] = [];
    for (let index = 0; index < 144; index += 1) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), sourceMaterial);
      mesh.position.set(index * 2, 0, 0);
      sources.push(mesh);
      scene.add(mesh);
    }
    const projectiveMaterial = new MeshBasicMaterial();

    const batch = buildParallaxBatch(scene, projectiveMaterial);

    expect(batch).not.toBeNull();
    expect(batch?.sourceMeshCount).toBe(144);
    expect(batch?.mesh).toBeInstanceOf(BatchedMesh);
    expect(batch?.mesh.instanceCount).toBe(144);
    expect(batch?.mesh.material).toBe(projectiveMaterial);
    expect(Object.keys(batch?.mesh.geometry.attributes ?? {})).toEqual(["position"]);
    // Building the walk projection must not clone or rewrite the cached GLTF.
    expect(scene.children).toHaveLength(144);
    expect(sources.every((mesh) => mesh.material === sourceMaterial)).toBe(true);

    batch?.mesh.dispose();
    for (const mesh of sources) mesh.geometry.dispose();
    sourceMaterial.dispose();
    projectiveMaterial.dispose();
  });

  it("hides primitives outside the active hop corridor", () => {
    const scene = new Scene();
    const sourceMaterial = new MeshBasicMaterial();
    const near = new Mesh(new BoxGeometry(1, 1, 1), sourceMaterial);
    const far = new Mesh(new BoxGeometry(1, 1, 1), sourceMaterial);
    far.position.set(30, 0, 0);
    scene.add(near, far);
    const projectiveMaterial = new MeshBasicMaterial();
    const batch = buildParallaxBatch(scene, projectiveMaterial);

    expect(batch).not.toBeNull();
    if (batch === null) return;
    const visible = updateParallaxCorridor(
      batch,
      new Vector3(0, 0, 0),
      new Vector3(2, 0, 0),
      2,
    );

    expect(visible).toBe(1);
    expect(batch.mesh.getVisibleAt(batch.instances[0]?.id ?? -1)).toBe(true);
    expect(batch.mesh.getVisibleAt(batch.instances[1]?.id ?? -1)).toBe(false);

    batch.mesh.dispose();
    near.geometry.dispose();
    far.geometry.dispose();
    sourceMaterial.dispose();
    projectiveMaterial.dispose();
  });
});

import { Group, Matrix4, Mesh, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  FurniturePresentationRuntimeError,
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
  type Img2ThreeSculptRuntime,
} from "../furniture-presentation-runtime.js";

function runtimeFor(
  root: Group,
  parts: Readonly<Record<string, Object3D>>,
): Img2ThreeSculptRuntime {
  return {
    nodes: { root, ...parts },
    meshes: {},
    sockets: {},
    colliders: {},
    destructionGroups: {},
  };
}

function publishRuntime(root: Group, runtime: Img2ThreeSculptRuntime): void {
  root.userData.sculptRuntime = runtime;
}

function namedGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  return group;
}

describe("readImg2ThreeSculptRuntime", () => {
  it("reads the no-implicit-shape runtime emitted by img2threejs", () => {
    const root = namedGroup("chair");
    const seat = namedGroup("seat__pivot");
    const mesh = new Mesh();
    mesh.name = "seat";
    root.add(seat);
    seat.add(mesh);

    const runtime: Img2ThreeSculptRuntime = {
      nodes: { root, seat },
      meshes: { seat: mesh },
      sockets: { grip: new Object3D() },
      colliders: { seat: { shape: "box" } },
      destructionGroups: { upholstery: [seat] },
    };
    publishRuntime(root, runtime);

    expect(readImg2ThreeSculptRuntime(root)).toEqual(runtime);
  });

  it("rejects absent and structurally invalid runtime metadata", () => {
    const missing = namedGroup("missing-runtime");
    expect(() => readImg2ThreeSculptRuntime(missing)).toThrow(
      FurniturePresentationRuntimeError,
    );

    const invalid = namedGroup("invalid-runtime");
    invalid.userData.sculptRuntime = {
      nodes: { root: invalid },
      meshes: { seat: new Object3D() },
      sockets: {},
      colliders: {},
      destructionGroups: {},
    };
    expect(() => readImg2ThreeSculptRuntime(invalid)).toThrow(
      /sculptRuntime\.meshes\.seat/,
    );
  });
});

describe("createFurniturePresentationRuntime", () => {
  it("applies progress from captured local transforms without cumulative drift", () => {
    const root = namedGroup("table");
    const top = namedGroup("tabletop__pivot");
    top.position.set(2, 0.5, 0);
    top.rotation.set(0.2, -0.3, 0.4);
    top.scale.set(1.2, 0.8, 1.1);
    root.add(top);
    publishRuntime(root, runtimeFor(root, { tabletop: top }));

    const originalPosition = top.position.clone();
    const originalQuaternion = top.quaternion.clone();
    const originalScale = top.scale.clone();
    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 2,
    });

    controller.setExplodeProgress(1);
    expect(top.position.x).toBeGreaterThan(originalPosition.x);
    const fullyExplodedPosition = top.position.clone();

    controller.setExplodeProgress(0.25);
    expect(top.position.x).toBeCloseTo(
      originalPosition.x + (fullyExplodedPosition.x - originalPosition.x) * 0.25,
    );
    expect(top.position.y).toBeCloseTo(
      originalPosition.y + (fullyExplodedPosition.y - originalPosition.y) * 0.25,
    );

    for (let iteration = 0; iteration < 100; iteration += 1) {
      controller.setExplodeProgress(1);
      controller.setExplodeProgress(0);
    }

    expect(top.position.toArray()).toEqual(originalPosition.toArray());
    expect(top.quaternion.toArray()).toEqual(originalQuaternion.toArray());
    expect(top.scale.toArray()).toEqual(originalScale.toArray());
    expect(controller.explodeProgress).toBe(0);
  });

  it("keeps marked details with their parent while nested parts separate independently", () => {
    const root = namedGroup("chair");
    const shell = namedGroup("shell__pivot");
    const piping = namedGroup("piping__pivot");
    const legModule = namedGroup("leg-module__pivot");
    const pipingSurface = new Mesh();
    pipingSurface.name = "piping-surface";

    shell.position.set(1, 0, 0);
    piping.position.set(0.25, 0, 0);
    pipingSurface.userData.explodeWithParent = true;
    legModule.position.set(0.5, 0, 0);
    root.add(shell);
    shell.add(piping, legModule);
    piping.add(pipingSurface);
    const runtime = runtimeFor(root, { shell, piping, legModule });
    publishRuntime(root, {
      ...runtime,
      meshes: { piping: pipingSurface },
    });

    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 1,
    });
    controller.setExplodeProgress(1);

    expect(shell.position.x).toBeCloseTo(2);
    expect(piping.position.x).toBeCloseTo(0.25);
    expect(legModule.position.x).toBeCloseTo(1.5);
    root.updateWorldMatrix(true, true);
    expect(piping.getWorldPosition(new Vector3()).x).toBeCloseTo(2.25);
    expect(legModule.getWorldPosition(new Vector3()).x).toBeCloseTo(3.5);

    expect(controller.resolveInspectionPart(pipingSurface)?.id).toBe("shell");
    expect(controller.resolveInspectionPart(legModule)?.id).toBe("legModule");
    expect(controller.resolveInspectionPart(new Object3D())).toBeNull();
  });

  it("keeps explode distance in world units under a scaled model root", () => {
    const root = namedGroup("scaled-table");
    root.scale.set(2, 1, 1);
    const top = namedGroup("top__pivot");
    top.position.set(1, 0, 0);
    root.add(top);
    publishRuntime(root, runtimeFor(root, { top }));

    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 1,
    });
    controller.setExplodeProgress(1);
    root.updateWorldMatrix(true, true);

    expect(top.position.x).toBeCloseTo(1.5);
    expect(top.getWorldPosition(new Vector3()).x).toBeCloseTo(3);
  });

  it("gives a stable separation direction to a part centred on the root", () => {
    const root = namedGroup("centred-chair");
    const centrePart = namedGroup("centre__pivot");
    root.add(centrePart);
    publishRuntime(root, runtimeFor(root, { centrePart }));

    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.75,
    });
    controller.setExplodeProgress(1);

    expect(centrePart.position.length()).toBeCloseTo(0.75);
  });

  it("restores exact local state on dispose, including manual-matrix nodes", () => {
    const root = namedGroup("chair");
    const back = namedGroup("back__pivot");
    back.position.set(-2, 0.75, 0.25);
    back.rotation.set(0.1, 0.2, 0.3);
    back.scale.set(0.9, 1.1, 1.2);
    back.updateMatrix();
    back.matrixAutoUpdate = false;
    root.add(back);
    publishRuntime(root, runtimeFor(root, { back }));

    const originalPosition = back.position.clone();
    const originalQuaternion = back.quaternion.clone();
    const originalScale = back.scale.clone();
    const originalMatrix = back.matrix.clone();
    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 1.5,
    });

    controller.setExplodeProgress(1);
    expect(back.matrix.equals(originalMatrix)).toBe(false);
    root.remove(back);
    controller.dispose();

    expect(back.position.toArray()).toEqual(originalPosition.toArray());
    expect(back.quaternion.toArray()).toEqual(originalQuaternion.toArray());
    expect(back.scale.toArray()).toEqual(originalScale.toArray());
    expect(back.matrix.equals(originalMatrix)).toBe(true);
    expect(controller.disposed).toBe(true);
    expect(controller.explodeProgress).toBe(0);

    controller.setExplodeProgress(1);
    controller.dispose();
    expect(back.matrix.equals(originalMatrix)).toBe(true);
  });

  it("rejects invalid roots, layouts, distances, and progress", () => {
    const root = namedGroup("chair");
    const unnamed = new Group();
    root.add(unnamed);
    publishRuntime(root, runtimeFor(root, { unnamed }));

    expect(() =>
      createFurniturePresentationRuntime(root, { explodeDistance: 1 }),
    ).toThrow(/named part/);
    expect(() =>
      createFurniturePresentationRuntime(root, { explodeDistance: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      createFurniturePresentationRuntime(root, {
        explodeDistance: 1,
        origin: [0, Number.POSITIVE_INFINITY, 0],
      }),
    ).toThrow(RangeError);

    const collapsedRoot = namedGroup("collapsed-chair");
    collapsedRoot.scale.set(0, 1, 1);
    const collapsedPart = namedGroup("collapsed-part__pivot");
    collapsedPart.position.set(1, 0, 0);
    collapsedRoot.add(collapsedPart);
    publishRuntime(collapsedRoot, runtimeFor(collapsedRoot, { collapsedPart }));
    expect(() =>
      createFurniturePresentationRuntime(collapsedRoot, { explodeDistance: 1 }),
    ).toThrow(/not invertible/);

    const validRoot = namedGroup("valid-chair");
    const seat = namedGroup("seat__pivot");
    validRoot.add(seat);
    publishRuntime(validRoot, runtimeFor(validRoot, { seat }));
    const controller = createFurniturePresentationRuntime(validRoot, {
      explodeDistance: 1,
    });

    expect(() => {
      controller.setExplodeProgress(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      controller.setExplodeProgress(1.01);
    }).toThrow(RangeError);
    expect(() => {
      controller.setExplodeProgress(-0.01);
    }).toThrow(RangeError);
  });

  it("rejects a runtime node that is not owned by the model root", () => {
    const root = namedGroup("chair");
    const foreignPart = namedGroup("foreign__pivot");
    const foreignRoot = namedGroup("other-model");
    foreignRoot.add(foreignPart);
    publishRuntime(root, runtimeFor(root, { foreignPart }));

    expect(() =>
      createFurniturePresentationRuntime(root, { explodeDistance: 1 }),
    ).toThrow(/descendant/);
  });

  it("preserves the original matrix snapshot rather than recomposing on restore", () => {
    const root = namedGroup("table");
    const top = namedGroup("top__pivot");
    top.matrixAutoUpdate = false;
    top.matrix.copy(new Matrix4().set(
      1, 0.2, 0, 1,
      0, 1, 0.1, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ));
    root.add(top);
    const runtime = runtimeFor(root, { top });
    const originalMatrix = top.matrix.clone();

    const controller = createFurniturePresentationRuntime(root, {
      explodeDistance: 0.5,
      runtime,
    });
    controller.setExplodeProgress(0.5);
    controller.restore();

    expect(top.matrix.equals(originalMatrix)).toBe(true);
  });
});

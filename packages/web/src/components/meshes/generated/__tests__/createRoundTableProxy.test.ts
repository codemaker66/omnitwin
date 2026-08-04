import { Box3, Mesh, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  createFurniturePresentationRuntime,
  readImg2ThreeSculptRuntime,
} from "../../../../lib/furniture-presentation-runtime.js";
import { createRoundTableProxy } from "../createRoundTableProxy.js";

function modelMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

describe("createRoundTableProxy", () => {
  it("builds the canonical six-foot dimensions in metres", () => {
    const table = createRoundTableProxy();
    const bounds = new Box3().setFromObject(table);
    const size = bounds.getSize(new Vector3());

    expect(size.x).toBeCloseTo(1.83, 3);
    expect(size.y).toBeCloseTo(0.76, 3);
    expect(size.z).toBeCloseTo(1.83, 3);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y).toBeCloseTo(0.76, 3);
  });

  it("creates individually named meshes for the top, frame, braces, hardware, and caps", () => {
    const table = createRoundTableProxy();
    const meshes = modelMeshes(table);
    const names = meshes.map((mesh) => mesh.name);

    expect(meshes.length).toBeGreaterThanOrEqual(25);
    expect(names.every((name) => name.trim().length > 0)).toBe(true);
    expect(new Set(meshes.map((mesh) => mesh.uuid)).size).toBe(meshes.length);
    expect(names).toContain("tabletop");
    expect(names).toContain("frame-a-front-leg-post");
    expect(names).toContain("frame-b-rear-brace-strap");
    expect(names).toContain("frame-a-front-hinge-fastener-lower-detail");
    expect(names).toContain("frame-b-rear-leg-foot-cap-detail");
  });

  it("publishes the semantic hierarchy and destruction sets expected by the presentation runtime", () => {
    const table = createRoundTableProxy();
    const runtime = readImg2ThreeSculptRuntime(table);

    expect(runtime.nodes.root).toBe(table);
    expect(runtime.nodes.tabletop?.name).toBe("tabletop__pivot");
    expect(runtime.nodes["frame-a-front-leg"]?.parent).toBe(runtime.nodes["frame-a"]);
    expect(runtime.nodes["frame-b-rear-brace"]?.parent).toBe(runtime.nodes["frame-b"]);
    expect(runtime.meshes.tabletop).not.toBe(runtime.meshes["frame-a"]);
    expect(runtime.sockets["tabletop-centre"]?.parent).toBe(runtime.nodes.tabletop);
    expect(runtime.destructionGroups["frame-a"]).toContain(runtime.nodes["frame-a-front-leg"]);
    expect(runtime.destructionGroups["frame-b"]).toContain(runtime.nodes["frame-b-rear-brace"]);

    const presentation = createFurniturePresentationRuntime(table, { explodeDistance: 0.25 });
    const frontLeg = presentation.inspectionParts.find((part) => part.id === "frame-a-front-leg");
    expect(frontLeg?.parentPartId).toBe("frame-a");
    expect(presentation.inspectionParts.map((part) => part.id)).toContain("tabletop");
  });

  it("marks subordinate surface details to remain attached during exploded inspection", () => {
    const table = createRoundTableProxy();
    const details = modelMeshes(table).filter((mesh) => mesh.userData.surfaceDetail === true);

    expect(details.length).toBeGreaterThanOrEqual(15);
    expect(details.every((mesh) => mesh.userData.explodeWithParent === true)).toBe(true);
    expect(details.some((mesh) => mesh.name === "tabletop-rim-detail")).toBe(true);
    expect(details.some((mesh) => mesh.name.endsWith("hinge-plate-detail"))).toBe(true);
    expect(details.some((mesh) => mesh.name.endsWith("foot-cap-detail"))).toBe(true);
  });

  // This factory predates the Gen-2 batch harness, so it carries its own copy
  // of the floating-part invariant. The defect was measured, not guessed: the
  // crossbar stopped 4mm short of the cleat it was meant to bolt to, and was
  // the only mesh across all six proxies with no neighbour of any kind.
  it("has no part floating free of the assembly", () => {
    const table = createRoundTableProxy();
    table.updateMatrixWorld(true);
    const boxes = modelMeshes(table).map((mesh) => ({
      mesh,
      box: new Box3().setFromObject(mesh),
    }));
    const isRelated = (a: Object3D, b: Object3D): boolean => {
      for (let n: Object3D | null = a; n !== null; n = n.parent) if (n === b) return true;
      for (let n: Object3D | null = b; n !== null; n = n.parent) if (n === a) return true;
      return false;
    };

    const orphans = boxes
      .filter(({ mesh, box }) => {
        const grown = box.clone().expandByScalar(0.001);
        return !boxes.some(({ mesh: other, box: otherBox }) => (
          other !== mesh && !isRelated(mesh, other) && grown.intersectsBox(otherBox)
        ));
      })
      .map(({ mesh }) => mesh.name);

    expect(orphans).toEqual([]);
  });

  // The rim is a 7mm bead. Buried at mid-depth it sat inside 24mm of oak and
  // rendered nothing; it has to break the tabletop's lower surface to be the
  // edge moulding it is modelled as — while staying inside the 0.915m radius
  // the canonical 1.83m width allows.
  it("shows the tabletop rim below the top rather than sealing it inside", () => {
    const table = createRoundTableProxy();
    table.updateMatrixWorld(true);
    const meshes = modelMeshes(table);
    const rim = meshes.find((mesh) => mesh.name === "tabletop-rim-detail");
    const top = meshes.find((mesh) => mesh.name === "tabletop");
    expect(rim).toBeDefined();
    expect(top).toBeDefined();
    if (rim === undefined || top === undefined) return;

    const rimBox = new Box3().setFromObject(rim);
    const topBox = new Box3().setFromObject(top);

    // Proud of the tabletop's underside, so it is actually visible.
    expect(rimBox.min.y).toBeLessThan(topBox.min.y);
    // Still tucked under the top, not floating below it.
    expect(rimBox.max.y).toBeGreaterThanOrEqual(topBox.min.y);
    // Never wider than the canonical half-width.
    expect(rimBox.max.x).toBeLessThanOrEqual(0.915 + 1e-6);
  });
});

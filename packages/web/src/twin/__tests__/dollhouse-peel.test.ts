import { describe, expect, it } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import { E57_TO_THREE_QUAT, MESH_OFFSET_M } from "../twin-basis.js";
import {
  DOLLHOUSE_CAPS_FLAG,
  DOLLHOUSE_CAPS_REPORT_KEY,
  TRADES_HALL_CAP_RULE,
  applyDollhouseCaps,
  capTriangleIsCapped,
  meshRootWorldMatrix,
  type DollhouseCapReport,
} from "../dollhouse-peel.js";

// -----------------------------------------------------------------------------
// dollhouse-peel — the load-time caps split.
//
// The defect this module answers was reported four times: large segments cut
// away as the camera angle changes. The mechanism (settled by measurement) is
// per-triangle backface culling of an interior-only capture. These tests pin
// the three properties the fix rests on:
//
//   1. The RULE — which triangle classes cap and which stay open — including
//      its boundaries, because the see-in (high flat plates stay cullable) is
//      as load-bearing as the fix (everything else overhead caps).
//   2. The SPLIT is exactly a reorder: same triangles, same vertex buffers,
//      original material untouched at group 0, a DoubleSide clone at group 1.
//   3. The split classifies in the WORLD frame. The cached GLB scene mounts
//      under the twin-basis group; classifying in the raw GLB frame would
//      misfile every surface (down is not down until the E57 quat applies).
// -----------------------------------------------------------------------------

const RULE = TRADES_HALL_CAP_RULE;

describe("capTriangleIsCapped — the rule", () => {
  it("never touches walls and floors", () => {
    expect(capTriangleIsCapped(0, 1, RULE)).toBe(false); // vertical wall
    expect(capTriangleIsCapped(1, 1, RULE)).toBe(false); // floor (up-facing)
    expect(capTriangleIsCapped(-0.1, 0, RULE)).toBe(false); // near-wall lean
  });

  it("keeps HIGH flat plates open — the see-in stays", () => {
    expect(capTriangleIsCapped(-1, 6.8, RULE)).toBe(false); // hall coffered lid
    expect(capTriangleIsCapped(-0.9, 5.8, RULE)).toBe(false); // upper-room lid
  });

  it("caps LOW flat plates — they stand over the storey void", () => {
    expect(capTriangleIsCapped(-1, 0.2, RULE)).toBe(true); // annex plate
    expect(capTriangleIsCapped(-0.95, -0.3, RULE)).toBe(true);
  });

  it("caps steep overheads at any height — the dome cannot arc again", () => {
    expect(capTriangleIsCapped(-0.7, 8, RULE)).toBe(true); // dome flank, high
    expect(capTriangleIsCapped(-0.4, 6, RULE)).toBe(true); // cove
    expect(capTriangleIsCapped(-0.5, 0, RULE)).toBe(true); // low vault
  });

  it("holds its boundaries exactly where the rule says", () => {
    // downNormalYMax is exclusive: at the threshold a triangle is not overhead.
    expect(capTriangleIsCapped(RULE.downNormalYMax, 0, RULE)).toBe(false);
    expect(capTriangleIsCapped(RULE.downNormalYMax - 1e-9, 0, RULE)).toBe(true);
    // plateNormalYMax is exclusive: exactly at it the triangle is steep → caps.
    expect(capTriangleIsCapped(RULE.plateNormalYMax, 100, RULE)).toBe(true);
    expect(capTriangleIsCapped(RULE.plateNormalYMax - 1e-9, 100, RULE)).toBe(false);
    // openPlateMinWorldY is exclusive: a plate exactly at the line caps.
    expect(capTriangleIsCapped(-1, RULE.openPlateMinWorldY, RULE)).toBe(true);
    expect(capTriangleIsCapped(-1, RULE.openPlateMinWorldY + 1e-9, RULE)).toBe(false);
  });

  it("fails toward CAPPED on NaN — a stray sliver of cap, never a hole", () => {
    expect(capTriangleIsCapped(-1, Number.NaN, RULE)).toBe(true);
    // A NaN normal is not below downNormalYMax, so it is not overhead at all.
    expect(capTriangleIsCapped(Number.NaN, 0, RULE)).toBe(false);
  });
});

describe("meshRootWorldMatrix — the twin-basis group as a matrix", () => {
  it("matches composing the quaternion and offset the stage mounts with", () => {
    const [qx, qy, qz, qw] = E57_TO_THREE_QUAT;
    const quaternion = new Quaternion(qx, qy, qz, qw);
    const probe = new Vector3(1.2, -0.4, 2.5);
    const viaMatrix = probe.clone().applyMatrix4(meshRootWorldMatrix());
    const viaGroupMath = probe
      .clone()
      .applyQuaternion(quaternion)
      .add(new Vector3(MESH_OFFSET_M[0], MESH_OFFSET_M[1], MESH_OFFSET_M[2]));
    expect(viaMatrix.distanceTo(viaGroupMath)).toBeLessThan(1e-12);
  });
});

// --- geometry builders -------------------------------------------------------

/** One triangle whose winding normal points DOWN (interior of an overhead). */
function downTriangle(y: number): number[] {
  // AB x AC = (1,0,0) x (0,0,1) = (0,-1,0)
  return [0, y, 0, 1, y, 0, 0, y, 1];
}

/** One triangle whose winding normal points UP (a floor). */
function upTriangle(y: number): number[] {
  return [0, y, 0, 0, y, 1, 1, y, 0];
}

/** One STEEP overhead triangle (unit normal Y ≈ −0.707). */
function steepTriangle(y: number): number[] {
  // AB x AC = (1,0,0) x (0,1,1) = (0,-1,1)
  return [0, y, 0, 1, y, 0, 0, y + 1, 1];
}

function meshOf(triangles: readonly number[][], index?: BufferAttribute): Mesh {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  for (const triangle of triangles) {
    positions.push(...triangle);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const vertexCount = positions.length / 3;
  geometry.setIndex(
    index ?? new BufferAttribute(Uint16Array.from({ length: vertexCount }, (_, i) => i), 1),
  );
  return new Mesh(geometry, new MeshStandardMaterial({ name: "chunk" }));
}

/** The index as a set of sorted triangle keys — order-independent equality. */
function triangleSet(geometry: BufferGeometry): Set<string> {
  const index = geometry.getIndex();
  const out = new Set<string>();
  if (index === null) {
    return out;
  }
  for (let i = 0; i < index.count; i += 3) {
    out.add(
      [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
        .sort((a, b) => a - b)
        .join("/"),
    );
  }
  return out;
}

describe("applyDollhouseCaps — the split", () => {
  function buildFourClassMesh(): Mesh {
    // floor (open) | high flat lid (open) | low plate (cap) | steep dome (cap)
    return meshOf([upTriangle(0), downTriangle(6), downTriangle(0.2), steepTriangle(6)]);
  }

  it("splits a chunk into open and capped groups by the world rule", () => {
    const mesh = buildFourClassMesh();
    const root = new Group();
    root.add(mesh);
    const before = triangleSet(mesh.geometry);
    const report = applyDollhouseCaps(root);

    expect(report.meshes).toBe(1);
    expect(report.meshesCapped).toBe(1);
    expect(report.totalTriangles).toBe(4);
    expect(report.cappedTriangles).toBe(2);
    expect(report.alreadyApplied).toBe(0);

    // The set of triangles is exactly preserved — a reorder, never a rewrite.
    expect(triangleSet(mesh.geometry)).toEqual(before);
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
    ]);
    expect(mesh.geometry.userData[DOLLHOUSE_CAPS_FLAG]).toBe(true);
    expect(root.userData[DOLLHOUSE_CAPS_REPORT_KEY]).toEqual(report);
  });

  it("keeps the original material untouched at slot 0 and a DoubleSide clone at 1", () => {
    const mesh = buildFourClassMesh();
    const original = mesh.material;
    applyDollhouseCaps(mesh);

    expect(Array.isArray(mesh.material)).toBe(true);
    const materials = mesh.material as MeshStandardMaterial[];
    expect(materials).toHaveLength(2);
    expect(materials[0]).toBe(original); // same reference — never cloned
    expect(materials[0]?.side).toBe(FrontSide);
    expect(materials[1]?.side).toBe(DoubleSide);
    expect(materials[1]?.name).toBe("chunk-cap");
  });

  it("shares live clipping-plane identity instead of Material.clone snapshots", () => {
    const mesh = buildFourClassMesh();
    const planes = [new Plane(new Vector3(0, 1, 0), 2)];
    (mesh.material as MeshStandardMaterial).clippingPlanes = planes;
    applyDollhouseCaps(mesh);
    const materials = mesh.material as MeshStandardMaterial[];
    // Identity, not equality: per-frame plane mutations must reach the caps.
    expect(materials[1]?.clippingPlanes).toBe(planes);
  });

  it("shares vertex buffers — only the index is replaced", () => {
    const mesh = buildFourClassMesh();
    const position = mesh.geometry.getAttribute("position");
    applyDollhouseCaps(mesh);
    expect(mesh.geometry.getAttribute("position")).toBe(position);
  });

  it("preserves the index element breed (Uint16 stays Uint16, Uint32 stays Uint32)", () => {
    const small = buildFourClassMesh();
    applyDollhouseCaps(small);
    expect(small.geometry.getIndex()?.array).toBeInstanceOf(Uint16Array);

    const wide = meshOf(
      [downTriangle(0.2)],
      new BufferAttribute(Uint32Array.from([0, 1, 2]), 1),
    );
    applyDollhouseCaps(wide);
    expect(wide.geometry.getIndex()?.array).toBeInstanceOf(Uint32Array);
  });

  it("is idempotent on drei's cached scene across remounts", () => {
    const mesh = buildFourClassMesh();
    const first = applyDollhouseCaps(mesh);
    const indexAfterFirst = mesh.geometry.getIndex();
    const second = applyDollhouseCaps(mesh);

    expect(second.alreadyApplied).toBe(1);
    expect(second.meshesCapped).toBe(0);
    expect(second.cappedTriangles).toBe(0);
    expect(mesh.geometry.getIndex()).toBe(indexAfterFirst);
    expect(mesh.material as MeshStandardMaterial[]).toHaveLength(2);
    // StrictMode double-invokes the mounting memo; the stored report must stay
    // the one from the run that did the split, not the idempotent re-run's
    // row of zeros.
    expect(mesh.userData[DOLLHOUSE_CAPS_REPORT_KEY]).toEqual(first);
  });

  it("classifies in the world frame the caller supplies, not the GLB frame", () => {
    // Down-facing at y = 0.2 caps under identity…
    const identity = meshOf([downTriangle(0.2)]);
    expect(applyDollhouseCaps(identity).cappedTriangles).toBe(1);

    // …but the same authored triangle under a 90° X-rotation is a WALL in
    // world space, and walls are never touched.
    const rotated = meshOf([downTriangle(0.2)]);
    const quarterX = new Matrix4().makeRotationX(Math.PI / 2);
    const report = applyDollhouseCaps(rotated, TRADES_HALL_CAP_RULE, quarterX);
    expect(report.cappedTriangles).toBe(0);
    expect(Array.isArray(rotated.material)).toBe(false);
  });

  it("respects the mesh's own transform inside the hierarchy", () => {
    const mesh = meshOf([downTriangle(0)]); // at the low-plate line pre-lift
    mesh.position.setY(6); // lifted to lid height by its node transform
    const root = new Group();
    root.add(mesh);
    const report = applyDollhouseCaps(root);
    // World y = 6 → a HIGH flat plate → stays open, nothing capped.
    expect(report.cappedTriangles).toBe(0);
  });

  it("adds no groups and clones no material for a chunk with nothing to cap", () => {
    const mesh = meshOf([upTriangle(0), downTriangle(6)]);
    const report = applyDollhouseCaps(mesh);
    expect(report.meshesCapped).toBe(0);
    expect(mesh.geometry.groups).toHaveLength(0);
    expect(Array.isArray(mesh.material)).toBe(false);
    // Still flagged: the decision is settled, not re-derived every mount.
    expect(mesh.geometry.userData[DOLLHOUSE_CAPS_FLAG]).toBe(true);
  });

  it("leaves a mesh that already carries a material array exactly as it is", () => {
    const mesh = buildFourClassMesh();
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    mesh.material = materials;
    const before = triangleSet(mesh.geometry);
    const report = applyDollhouseCaps(mesh);
    expect(report.meshesCapped).toBe(0);
    expect(mesh.material).toBe(materials);
    expect(mesh.geometry.groups).toHaveLength(0);
    expect(triangleSet(mesh.geometry)).toEqual(before);
  });

  it("skips non-indexed geometry rather than guessing at its triangles", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(downTriangle(0.2), 3));
    const mesh = new Mesh(geometry, new MeshStandardMaterial());
    const report = applyDollhouseCaps(mesh);
    expect(report.meshes).toBe(0);
    expect(Array.isArray(mesh.material)).toBe(false);
  });

  it("degrades to a zero report on a mocked scene, never a throw", () => {
    // The dollhouse-shell degrade idiom: an object shaped like a scene with
    // none of Object3D's methods on it (what the mocked useGLTF returns).
    const fake: Partial<Object3D> = { name: "fake-gltf-scene" };
    const report: DollhouseCapReport = applyDollhouseCaps(fake as Object3D);
    expect(report).toEqual({
      meshes: 0,
      meshesCapped: 0,
      cappedTriangles: 0,
      totalTriangles: 0,
      alreadyApplied: 0,
      elapsedMs: 0,
    });
  });
});

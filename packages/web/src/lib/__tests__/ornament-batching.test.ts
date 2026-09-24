import { describe, it, expect } from "vitest";
import { BufferGeometry, Matrix4, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  bakeOrnamentGeometry,
  collectOrnamentDraws,
  createOrnamentGeometry,
  planOrnamentBatches,
  type OrnamentDraw,
  type OrnamentMaterial,
  type OrnamentNode,
} from "../ornament-batching.js";

const stone: OrnamentMaterial = { color: "#d8ccb4", roughness: 0.7, metalness: 0 };
const gilt: OrnamentMaterial = { color: "#c9a24a", roughness: 0.35, metalness: 0.8 };
const glass: OrnamentMaterial = { color: "#dfe8e4", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false };

const mirroredGroup: OrnamentNode = {
  kind: "group",
  position: [-2, 1, 0.5],
  scale: [-1, 1, 1],
  children: [
    { kind: "mesh", position: [0.3, 0, 0], rotation: [0, 0.4, 0.2], geometry: { kind: "box", args: [0.3, 0.3, 0.05] }, material: stone },
  ],
};

/** Every geometry kind, rotated, non-uniformly scaled, mirrored and instanced. */
const mixedNodes: readonly OrnamentNode[] = [
  {
    kind: "group",
    position: [1.25, 2.5, -3.75],
    rotation: [0.3, -1.1, 0.45],
    scale: [1.5, 0.8, 1.2],
    children: [
      { kind: "mesh", geometry: { kind: "box", args: [0.4, 0.2, 0.1] }, material: stone },
      { kind: "mesh", position: [0.2, 0.1, 0], rotation: [0, 0.7, 0], geometry: { kind: "sphere", args: [0.05, 12, 8] }, material: stone },
      { kind: "mesh", position: [-0.3, 0, 0.05], geometry: { kind: "cylinder", args: [0.02, 0.03, 0.5, 10] }, material: stone },
      { kind: "mesh", rotation: [-Math.PI / 2, 0, 0], geometry: { kind: "plane", args: [0.6, 0.3] }, material: stone },
      { kind: "mesh", position: [0, 0.4, 0], geometry: { kind: "circle", args: [0.2, 16, 0, Math.PI] }, material: stone },
      { kind: "mesh", position: [0, -0.4, 0], geometry: { kind: "ring", args: [0.1, 0.18, 24] }, material: stone },
      { kind: "mesh", position: [0.5, 0, 0], geometry: { kind: "torus", args: [0.12, 0.02, 8, 24] }, material: stone },
    ],
  },
  mirroredGroup,
  {
    kind: "instances",
    name: "studs",
    geometry: { kind: "sphere", args: [0.03, 8, 6] },
    material: stone,
    instances: [{ position: [0, 0, 0] }, { position: [0.5, 0.25, -1], rotation: [0, 1, 0] }],
  },
];

/** three's own route: clone, `applyMatrix4`, keep front faces on mirrored parts, `mergeGeometries`. */
function referenceBake(draws: readonly OrnamentDraw[], indices: readonly number[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const drawIndex of indices) {
    const draw = draws[drawIndex];
    if (draw === undefined) throw new Error(`missing draw ${String(drawIndex)}`);
    for (const matrix of draw.matrices) {
      const part = createOrnamentGeometry(draw.geometry).applyMatrix4(matrix);
      const index = part.getIndex();
      if (index === null) throw new Error("unindexed part");
      if (matrix.determinant() < 0) {
        for (let i = 0; i < index.count; i += 3) {
          const b = index.getX(i + 1);
          index.setX(i + 1, index.getX(i + 2));
          index.setX(i + 2, b);
        }
      }
      parts.push(part);
    }
  }
  return mergeGeometries(parts, false);
}

function attributeValues(geometry: BufferGeometry, name: string): number[] {
  return Array.from(geometry.getAttribute(name).array);
}

function indexValues(geometry: BufferGeometry): number[] {
  const index = geometry.getIndex();
  if (index === null) throw new Error("unindexed geometry");
  return Array.from(index.array);
}

describe("bakeOrnamentGeometry", () => {
  it("equals three's clone, applyMatrix4 and mergeGeometries result bit for bit", () => {
    const draws = collectOrnamentDraws(mixedNodes);
    const all = draws.map((_draw, index) => index);
    expect(draws.some((draw) => draw.matrices.some((matrix) => matrix.determinant() < 0))).toBe(true);

    const baked = bakeOrnamentGeometry(draws, all);
    const reference = referenceBake(draws, all);
    for (const name of ["position", "normal", "uv"]) {
      expect(attributeValues(baked, name)).toEqual(attributeValues(reference, name));
    }
    expect(indexValues(baked)).toEqual(indexValues(reference));
    expect(Object.keys(baked.attributes).sort()).toEqual(Object.keys(reference.attributes).sort());
    expect(baked.groups).toEqual([]);
  });

  it("keeps front faces facing out on a mirrored part", () => {
    const draws = collectOrnamentDraws([mirroredGroup]);
    const [draw] = draws;
    expect(draw?.matrices[0]?.determinant()).toBeLessThan(0);
    const baked = bakeOrnamentGeometry(draws, [0]);
    const position = baked.getAttribute("position");
    const normal = baked.getAttribute("normal");
    const index = indexValues(baked);
    const [a, b, c, n] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i < index.length; i += 3) {
      const [ia, ib, ic] = [index[i] ?? -1, index[i + 1] ?? -1, index[i + 2] ?? -1];
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib).sub(a);
      c.fromBufferAttribute(position, ic).sub(a);
      n.fromBufferAttribute(normal, ia);
      expect(b.cross(c).dot(n)).toBeGreaterThan(0);
    }
  });

  it("uses 32-bit indices only once an index can reach 65535", () => {
    const sphere = (count: number): OrnamentDraw => ({
      name: "",
      geometry: { kind: "sphere", args: [1, 63, 31] },
      material: stone,
      matrices: Array.from({ length: count }, (_value, i) => new Matrix4().makeTranslation(i, 0, 0)),
      exact: false,
      instanced: false,
    });
    // 64 x 32 = 2048 vertices per sphere.
    expect(bakeOrnamentGeometry([sphere(31)], [0]).getIndex()?.array).toBeInstanceOf(Uint16Array);
    expect(bakeOrnamentGeometry([sphere(32)], [0]).getIndex()?.array).toBeInstanceOf(Uint32Array);
  });
});

describe("planOrnamentBatches", () => {
  it("merges equal materials within a segment and never across a depth-write-disabled draw", () => {
    const plans = planOrnamentBatches([
      { material: stone },
      { material: gilt },
      { material: { ...stone, color: "#D8CCB4" } },
      { material: glass },
      { material: glass },
      { material: stone },
      { material: stone, exact: true },
      { material: gilt },
      { material: glass, exact: true },
      { material: glass },
    ]);
    expect(plans.map((plan) => plan.draws)).toEqual([[0, 2], [1], [3, 4], [5], [6], [7], [8], [9]]);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { BufferGeometry, DoubleSide, Vector3 } from "three";
import { buildGrandHallOrnamentModel, disposeGrandHallOrnamentModel } from "../GrandHallOrnaments.js";
import {
  collectOrnamentDraws,
  createOrnamentGeometry,
  ornamentMaterialKey,
  type OrnamentBatchSet,
  type OrnamentDraw,
  type OrnamentNode,
} from "../../lib/ornament-batching.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// Where faces of two differently shaded ornament pieces are coplanar and
// overlap, the pixels there are decided by bit-level depth ties. Baking a
// piece into a merged batch moves its vertices by float rounding and would
// reshuffle those pixels, so no such piece may be baked (they keep exact
// draws, see OrnamentMeshNode.exact). This scans every triangle of the real
// Grand Hall description.
// ---------------------------------------------------------------------------

interface Face {
  readonly piece: string;
  readonly baked: boolean;
  readonly key: string;
  readonly doubleSided: boolean;
  readonly corners: readonly [Vector3, Vector3, Vector3];
  readonly normal: Vector3;
  readonly offset: number;
}

const { width, length, height } = GRAND_HALL_RENDER_DIMENSIONS;
const model = buildGrandHallOrnamentModel(width, length, height);
afterAll(() => { disposeGrandHallOrnamentModel(model); });

/** Draw indices that a stand-in bakes (multi-primitive batches); exact batches are not baked. */
function bakedDraws(set: OrnamentBatchSet | null): Set<number> {
  const baked = new Set<number>();
  for (const batch of set?.batches ?? []) {
    if (batch.transform === null) for (const index of batch.sourceDraws) baked.add(index);
  }
  return baked;
}

const geometryCache = new Map<string, BufferGeometry>();
function geometryOf(draw: OrnamentDraw): BufferGeometry {
  const key = JSON.stringify(draw.geometry);
  let geometry = geometryCache.get(key);
  if (geometry === undefined) {
    geometry = createOrnamentGeometry(draw.geometry);
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function facesOf(owner: string, draws: readonly OrnamentDraw[], baked: ReadonlySet<number>): Face[] {
  const faces: Face[] = [];
  draws.forEach((draw, drawIndex) => {
    const geometry = geometryOf(draw);
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (index === null) throw new Error(`${owner} geometry is not indexed`);
    for (const matrix of draw.matrices) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        const corners: [Vector3, Vector3, Vector3] = [
          new Vector3().fromBufferAttribute(position, index.getX(i)).applyMatrix4(matrix),
          new Vector3().fromBufferAttribute(position, index.getX(i + 1)).applyMatrix4(matrix),
          new Vector3().fromBufferAttribute(position, index.getX(i + 2)).applyMatrix4(matrix),
        ];
        const normal = new Vector3().subVectors(corners[1], corners[0]).cross(new Vector3().subVectors(corners[2], corners[0]));
        const area = normal.length();
        if (area < 1e-12) continue;
        normal.divideScalar(area);
        faces.push({
          piece: `${owner}#${String(drawIndex)}${draw.name === "" ? "" : `:${draw.name}`}`,
          baked: baked.has(drawIndex),
          key: ornamentMaterialKey(draw.material),
          doubleSided: draw.material.side === DoubleSide,
          corners,
          normal,
          offset: normal.dot(corners[0]),
        });
      }
    }
  });
  return faces;
}

/** Positive-area overlap of two coplanar triangles (separating-axis test in the plane). */
function overlapInPlane(a: Face, b: Face): boolean {
  const n = a.normal;
  const project = (v: Vector3): [number, number] => (
    Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? [v.y, v.z]
      : Math.abs(n.y) >= Math.abs(n.z) ? [v.x, v.z] : [v.x, v.y]
  );
  const pa = a.corners.map(project);
  const pb = b.corners.map(project);
  for (const polygon of [pa, pb]) {
    for (let i = 0; i < 3; i++) {
      const [x1, y1] = polygon[i] ?? [0, 0];
      const [x2, y2] = polygon[(i + 1) % 3] ?? [0, 0];
      const axis: [number, number] = [y2 - y1, x1 - x2];
      const scale = Math.hypot(axis[0], axis[1]);
      const along = (p: [number, number]): number => (p[0] * axis[0] + p[1] * axis[1]) / scale;
      const ra = pa.map(along);
      const rb = pb.map(along);
      if (Math.max(...ra) <= Math.min(...rb) + 1e-6 || Math.max(...rb) <= Math.min(...ra) + 1e-6) return false;
    }
  }
  return true;
}

/** Faces in the floor plane facing down are only visible from below the floor, which the planner camera never reaches. */
function inFloorFacingDown(face: Face): boolean {
  return face.normal.y < -0.999999 && Math.abs(face.offset) < 1e-6;
}

function allFaces(): Face[] {
  const surfaces = [
    ...model.ceiling,
    ...model.walls.flatMap((layer) => (layer.kind === "surface" ? [layer.entry] : layer.entries)),
    ...model.rosette,
  ];
  const faces = surfaces.flatMap((entry) => facesOf(entry.surface.name, collectOrnamentDraws(entry.surface.children), bakedDraws(entry.standIn)));
  const fittings = collectOrnamentDraws(model.chandeliers.map((chandelier): OrnamentNode => ({
    kind: "group",
    position: chandelier.placement.position,
    scale: chandelier.placement.scale,
    children: chandelier.fittings,
  })));
  const crystal = collectOrnamentDraws(model.chandeliers.map((chandelier): OrnamentNode => ({
    kind: "group",
    position: chandelier.placement.position,
    scale: chandelier.placement.scale,
    children: chandelier.crystal,
  })));
  return [
    ...faces,
    ...facesOf("chandelier-fittings", fittings, bakedDraws(model.chandelierFittings)),
    ...facesOf("chandelier-crystal", crystal, new Set()),
  ];
}

describe("Grand Hall ornament coplanar faces", () => {
  it("never bakes a piece whose face is coplanar with, and overlaps, a differently shaded piece", () => {
    const faces = allFaces();
    const planes = new Map<string, Face[]>();
    const planeKey = (face: Face, sign: number): string =>
      [face.normal.x, face.normal.y, face.normal.z, face.offset].map((v) => Math.round(v * sign * 1e3)).join(",");
    for (const face of faces) {
      const key = planeKey(face, 1);
      planes.set(key, [...(planes.get(key) ?? []), face]);
    }

    const pairs = new Set<string>();
    const violations = new Set<string>();
    for (const face of faces) {
      const candidates = [
        ...(planes.get(planeKey(face, 1)) ?? []),
        ...(face.doubleSided ? planes.get(planeKey(face, -1)) ?? [] : []),
      ];
      for (const other of candidates) {
        if (other.key === face.key || other.piece === face.piece) continue;
        const sameFacing = face.normal.dot(other.normal) > 0.999999 && Math.abs(face.offset - other.offset) < 1e-6;
        const opposed = (face.doubleSided || other.doubleSided)
          && face.normal.dot(other.normal) < -0.999999 && Math.abs(face.offset + other.offset) < 1e-6;
        if (!sameFacing && !opposed) continue;
        if (inFloorFacingDown(face) && inFloorFacingDown(other)) continue;
        if (!overlapInPlane(face, other)) continue;
        const pair = [face.piece, other.piece].sort().join(" <-> ");
        pairs.add(pair);
        if (face.baked || other.baked) violations.add(pair);
      }
    }

    expect([...violations]).toEqual([]);
    // The scan does find the hall's real coplanar contacts, e.g. every
    // chandelier's rod and rose and the crown mouldings against the ceiling panels.
    expect([...pairs].filter((pair) => pair.startsWith("chandelier-fittings"))).toHaveLength(3);
    expect([...pairs].some((pair) => pair.includes("crown-back") && pair.includes("grand-hall-ceiling-ornaments"))).toBe(true);
    expect(pairs.size).toBeGreaterThan(20);
  });
});

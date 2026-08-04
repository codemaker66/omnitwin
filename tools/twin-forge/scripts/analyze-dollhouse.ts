/**
 * analyze-dollhouse — measure the dollhouse mesh's TRUE component structure.
 *
 * The raw matterpak GLB is meshopt-compressed, split into ~144 texture-atlas
 * chunks, and its vertices are NOT welded across chunk/UV-seam boundaries —
 * naive face-adjacency therefore explodes into tens of thousands of
 * "components", which makes debris statistics meaningless. This script:
 *
 *   1. decodes the GLB (gltf-transform + meshopt decoder),
 *   2. WELDS by quantized world position (1 cm grid) across ALL primitives
 *      with a union-find, so surfaces that touch are one component no matter
 *      which chunk or UV island they came from,
 *   3. reports the component distribution (top components + debris tail at
 *      candidate thresholds) so cleanup thresholds are chosen from data.
 *
 * Read-only: prints statistics, writes nothing.
 *
 * Run: cd tools/twin-forge && node_modules/.bin/tsx scripts/analyze-dollhouse.ts
 */
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const GLB_PATH =
  "c:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall/mesh/dollhouse.glb";
/** Weld grid (metres): scan noise exceeds 1 cm, real gaps exceed it too. */
const WELD_M = 0.01;

// --- tiny union-find over dense integer ids ---
class UnionFind {
  private parent: Int32Array;
  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let index = 0; index < size; index += 1) this.parent[index] = index;
  }
  find(a: number): number {
    let root = a;
    const parent = this.parent;
    while (parent[root] !== root) root = parent[root] as number;
    // path compression
    let cursor = a;
    while (parent[cursor] !== root) {
      const next = parent[cursor] as number;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function multiplyMat4Vec3(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    (m[0] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[8] ?? 0) * v[2] + (m[12] ?? 0),
    (m[1] ?? 0) * v[0] + (m[5] ?? 0) * v[1] + (m[9] ?? 0) * v[2] + (m[13] ?? 0),
    (m[2] ?? 0) * v[0] + (m[6] ?? 0) * v[1] + (m[10] ?? 0) * v[2] + (m[14] ?? 0),
  ];
}

interface FaceRecord {
  readonly vertexKeyIds: [number, number, number];
  readonly area: number;
  readonly centroid: [number, number, number];
}

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const document: Document = await io.read(GLB_PATH);
  const root = document.getRoot();

  // Collect world-space triangles across every mesh node.
  const keyToId = new Map<string, number>();
  const keyId = (x: number, y: number, z: number): number => {
    const key = `${String(Math.round(x / WELD_M))},${String(Math.round(y / WELD_M))},${String(Math.round(z / WELD_M))}`;
    const existing = keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = keyToId.size;
    keyToId.set(key, id);
    return id;
  };

  const faces: FaceRecord[] = [];
  let primitiveCount = 0;

  const scenes = root.listScenes();
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh !== null) {
      const world = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        primitiveCount += 1;
        const position = primitive.getAttribute("POSITION");
        if (position === null) continue;
        const indices = primitive.getIndices();
        const vertexCount = indices !== null ? indices.getCount() : position.getCount();
        const element: number[] = [0, 0, 0];
        const face: [number, number, number][] = [];
        for (let cursor = 0; cursor < vertexCount; cursor += 1) {
          const vertexIndex = indices !== null ? (indices.getScalar(cursor)) : cursor;
          position.getElement(vertexIndex, element);
          const world3 = multiplyMat4Vec3(world, [element[0] ?? 0, element[1] ?? 0, element[2] ?? 0]);
          face.push(world3);
          if (face.length === 3) {
            const [a, b, c] = face as [
              [number, number, number],
              [number, number, number],
              [number, number, number],
            ];
            const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2];
            const acx = c[0] - a[0]; const acy = c[1] - a[1]; const acz = c[2] - a[2];
            const crossX = aby * acz - abz * acy;
            const crossY = abz * acx - abx * acz;
            const crossZ = abx * acy - aby * acx;
            const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
            faces.push({
              vertexKeyIds: [
                keyId(a[0], a[1], a[2]),
                keyId(b[0], b[1], b[2]),
                keyId(c[0], c[1], c[2]),
              ],
              area,
              centroid: [
                (a[0] + b[0] + c[0]) / 3,
                (a[1] + b[1] + c[1]) / 3,
                (a[2] + b[2] + c[2]) / 3,
              ],
            });
            face.length = 0;
          }
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of scenes) for (const node of scene.listChildren()) visit(node);

  console.log(`primitives: ${String(primitiveCount)} | faces: ${String(faces.length)} | welded vertex keys: ${String(keyToId.size)}`);

  // Union faces through shared welded vertices.
  const unionFind = new UnionFind(keyToId.size);
  for (const face of faces) {
    unionFind.union(face.vertexKeyIds[0], face.vertexKeyIds[1]);
    unionFind.union(face.vertexKeyIds[0], face.vertexKeyIds[2]);
  }

  interface ComponentStat {
    faces: number;
    area: number;
    min: [number, number, number];
    max: [number, number, number];
  }
  const components = new Map<number, ComponentStat>();
  for (const face of faces) {
    const componentId = unionFind.find(face.vertexKeyIds[0]);
    let stat = components.get(componentId);
    if (stat === undefined) {
      stat = {
        faces: 0,
        area: 0,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      };
      components.set(componentId, stat);
    }
    stat.faces += 1;
    stat.area += face.area;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = face.centroid[axis] ?? 0;
      if (value < (stat.min[axis] ?? Infinity)) stat.min[axis] = value;
      if (value > (stat.max[axis] ?? -Infinity)) stat.max[axis] = value;
    }
  }

  const sorted = [...components.values()].sort((left, right) => right.area - left.area);
  const totalArea = sorted.reduce((sum, statistic) => sum + statistic.area, 0);
  const totalFaces = faces.length;
  const diagonal = (statistic: ComponentStat): number =>
    Math.hypot(
      statistic.max[0] - statistic.min[0],
      statistic.max[1] - statistic.min[1],
      statistic.max[2] - statistic.min[2],
    );

  console.log(`\ncomponents after 1 cm position weld: ${String(sorted.length)}`);
  console.log(`total area ${totalArea.toFixed(1)} m² | total faces ${String(totalFaces)}`);
  console.log(`\ntop 15 components:`);
  for (const statistic of sorted.slice(0, 15)) {
    console.log(
      `  faces ${String(statistic.faces).padStart(7)} | area ${statistic.area.toFixed(2).padStart(9)} m² | diag ${diagonal(statistic).toFixed(2).padStart(6)} m`,
    );
  }

  // High-altitude census: everything whose bbox TOP sits in the scene's upper
  // band (torn roofline skirts live here), excluding the main shell. Prints
  // full extents so debris rules are tuned against MEASURED shapes.
  {
    const sceneMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const sceneMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const statistic of sorted) {
      for (let axis = 0; axis < 3; axis += 1) {
        if ((statistic.min[axis] ?? 0) < (sceneMin[axis] ?? Infinity)) sceneMin[axis] = statistic.min[axis] ?? 0;
        if ((statistic.max[axis] ?? 0) > (sceneMax[axis] ?? -Infinity)) sceneMax[axis] = statistic.max[axis] ?? 0;
      }
    }
    console.log(
      `\nscene bbox min [${sceneMin.map((v) => v.toFixed(1)).join(", ")}] max [${sceneMax.map((v) => v.toFixed(1)).join(", ")}]`,
    );
    // Report per axis-up hypothesis: use the axis with the LARGEST vertical
    // plausibility left to the reader — print top-band components for every axis.
    for (let upAxis = 0; upAxis < 3; upAxis += 1) {
      const top = sceneMax[upAxis] ?? 0;
      const band = sorted.filter(
        (statistic, index) =>
          index !== 0 && (statistic.max[upAxis] ?? 0) > top - 3,
      );
      if (band.length === 0) continue;
      console.log(`\ncomponents (not main shell) topping out within 3 of max along axis ${String(upAxis)}:`);
      for (const statistic of band.slice(0, 12)) {
        const ex = [
          statistic.max[0] - statistic.min[0],
          statistic.max[1] - statistic.min[1],
          statistic.max[2] - statistic.min[2],
        ];
        console.log(
          `  faces ${String(statistic.faces).padStart(6)} | area ${statistic.area.toFixed(2).padStart(8)} | extents [${ex.map((v) => v.toFixed(2)).join(", ")}] | top ${(statistic.max[upAxis] ?? 0).toFixed(2)}`,
        );
      }
    }
  }

  // Attic census: plan-grid histogram of faces in the high band (z-up in this
  // glb). The dome shows as a dense circular blob; torn roofline skirts show
  // as thin isolated LINES of cells — their coordinates seed the hand-cut
  // boxes in clean-dollhouse.ts.
  {
    const CELL = 2;
    const cells = new Map<string, { faces: number; zMin: number; zMax: number }>();
    for (const face of faces) {
      const z = face.centroid[2] ?? 0;
      if (z < 6.8 || z > 9.2) continue;
      const cx = Math.floor((face.centroid[0] ?? 0) / CELL);
      const cy = Math.floor((face.centroid[1] ?? 0) / CELL);
      const key = `${String(cx)},${String(cy)}`;
      const cell = cells.get(key) ?? { faces: 0, zMin: Infinity, zMax: -Infinity };
      cell.faces += 1;
      cell.zMin = Math.min(cell.zMin, z);
      cell.zMax = Math.max(cell.zMax, z);
      cells.set(key, cell);
    }
    console.log(`\nattic band z in [6.8,9.2] — occupied ${String(CELL)}m plan cells (x-range, y-range → faces, z-range):`);
    const entries = [...cells.entries()].sort(
      (left, right) => right[1].faces - left[1].faces,
    );
    for (const [key, cell] of entries) {
      const [cx, cy] = key.split(",").map(Number);
      console.log(
        `  cell(${String((cx ?? 0) * CELL)}..${String(((cx ?? 0) + 1) * CELL)}, ${String((cy ?? 0) * CELL)}..${String(((cy ?? 0) + 1) * CELL)}) faces ${String(cell.faces).padStart(6)} z ${cell.zMin.toFixed(1)}-${cell.zMax.toFixed(1)}`,
      );
    }
  }

  for (const [areaMax, diagMax] of [
    [0.05, 0.4],
    [0.2, 0.8],
    [0.5, 1.2],
  ] as const) {
    const debris = sorted.filter(
      (statistic) => statistic.area < areaMax && diagonal(statistic) < diagMax,
    );
    const debrisFaces = debris.reduce((sum, statistic) => sum + statistic.faces, 0);
    const debrisArea = debris.reduce((sum, statistic) => sum + statistic.area, 0);
    console.log(
      `\nthreshold area<${String(areaMax)} m² AND diag<${String(diagMax)} m → ${String(debris.length)} components, ` +
        `${String(debrisFaces)} faces (${((100 * debrisFaces) / totalFaces).toFixed(1)}% tris, ${((100 * debrisArea) / totalArea).toFixed(2)}% area)`,
    );
  }
}

await main();

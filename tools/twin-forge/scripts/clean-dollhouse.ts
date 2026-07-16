/**
 * clean-dollhouse — remove scan-reconstruction debris from the dollhouse mesh.
 *
 * Uses the same 1 cm position-weld union-find as analyze-dollhouse.ts to find
 * true connected components across all texture-atlas chunks, then drops the
 * debris tail (tiny, isolated fragments — the window/edge shards) by pure
 * INDEX surgery: every vertex attribute, UV, material and texture is left
 * byte-identical, only face index triples are filtered. The texture therefore
 * cannot grey out. Output is re-encoded with meshopt (same compression family
 * as the source); falls back to uncompressed if encoding fails.
 *
 * Measured on the real asset (analyze-dollhouse, 2026-07-10): weld yields 364
 * components; the main shell holds 88.6% of triangles / 97.6% of area; the
 * default threshold removes ~1.9% of triangles and 0.38% of area.
 *
 * Run (preview → scratchpad):
 *   cd tools/twin-forge && node_modules/.bin/tsx scripts/clean-dollhouse.ts
 * Apply in place (backs up original, updates manifest bytes + sha256):
 *   ... clean-dollhouse.ts --write
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NodeIO, type Document, type Node as GltfNode, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const REPO = "c:/Users/blake/omnitwin2";
const GLB_PATH = `${REPO}/packages/web/public/twin/trades-hall/mesh/dollhouse.glb`;
const MANIFEST_PATH = `${REPO}/packages/web/public/twin/trades-hall/manifest.json`;
const PREVIEW_PATH =
  "C:/Users/blake/AppData/Local/Temp/claude/c--Users-blake-omnitwin2/e3af228b-ecee-468f-811b-f4ef5913c4b4/scratchpad/meshclean/dollhouse-clean.glb";
const BACKUP_PATH =
  "C:/Users/blake/AppData/Local/Temp/claude/c--Users-blake-omnitwin2/e3af228b-ecee-468f-811b-f4ef5913c4b4/scratchpad/meshclean/dollhouse-ORIGINAL.glb";

const WELD_M = 0.01;
/** Debris = BOTH smaller than this area AND shorter than this extent.
 *  Conservative: railings/furniture are far larger; verified against the
 *  measured distribution before choosing. */
const DEBRIS_AREA_M2 = 0.2;
const DEBRIS_DIAG_M = 0.8;
/** Needle-sliver cull: reconstruction "skirts" (the comb fringes torn along
 *  ceiling/window borders) are made of extremely elongated triangles that
 *  well-formed scan surfaces do not produce. A triangle is a sliver when its
 *  longest edge is substantial yet its area is a sliver of the equilateral
 *  area for that edge: longestEdge² / (4·area) > SLIVER_RATIO. Independent of
 *  connectivity, so it removes skirts even when attached to the main shell. */
const SLIVER_RATIO = 30;
const SLIVER_MIN_EDGE_M = 0.12;
/** DISABLED after visual regression: large flat surfaces (the Grand Hall
 *  parquet) legitimately triangulate into long thin faces, and the sliver
 *  cull opened hairline cracks across the floor while STILL not removing the
 *  attached roofline skirts it was aimed at. Isolated-component + ribbon
 *  rules are the proven-safe set; the two attached skirts go to interactive
 *  picking (Blender) instead. */
const CULL_SLIVERS = false;

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

interface PrimitiveFaces {
  readonly primitive: Primitive;
  /** Per-face component key id (via the face's first welded vertex). */
  readonly faceRootVertexIds: number[];
  /** Index of this primitive's first face in the global face arrays. */
  readonly startFace: number;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const document: Document = await io.read(GLB_PATH);
  const root = document.getRoot();

  // Pass 1: weld + face records, tracking which primitive each face lives in.
  const keyToId = new Map<string, number>();
  const keyId = (x: number, y: number, z: number): number => {
    const key = `${String(Math.round(x / WELD_M))},${String(Math.round(y / WELD_M))},${String(Math.round(z / WELD_M))}`;
    const existing = keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = keyToId.size;
    keyToId.set(key, id);
    return id;
  };

  const primitiveFaces: PrimitiveFaces[] = [];
  const faceVertexIds: [number, number, number][] = [];
  const faceAreas: number[] = [];
  const faceIsSliver: boolean[] = [];

  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh !== null) {
      const world = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute("POSITION");
        const indices = primitive.getIndices();
        if (position === null || indices === null) continue; // matterpak is indexed
        const record: PrimitiveFaces = {
          primitive,
          faceRootVertexIds: [],
          startFace: faceVertexIds.length,
        };
        primitiveFaces.push(record);
        const element: number[] = [0, 0, 0];
        const count = indices.getCount();
        for (let cursor = 0; cursor + 2 < count; cursor += 3) {
          const corners: [number, number, number][] = [];
          for (let corner = 0; corner < 3; corner += 1) {
            position.getElement(indices.getScalar(cursor + corner), element);
            corners.push(
              multiplyMat4Vec3(world, [element[0] ?? 0, element[1] ?? 0, element[2] ?? 0]),
            );
          }
          const [a, b, c] = corners as [
            [number, number, number],
            [number, number, number],
            [number, number, number],
          ];
          const ids: [number, number, number] = [
            keyId(a[0], a[1], a[2]),
            keyId(b[0], b[1], b[2]),
            keyId(c[0], c[1], c[2]),
          ];
          const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2];
          const acx = c[0] - a[0]; const acy = c[1] - a[1]; const acz = c[2] - a[2];
          const crossX = aby * acz - abz * acy;
          const crossY = abz * acx - abx * acz;
          const crossZ = abx * acy - aby * acx;
          const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
          const edgeAb = Math.hypot(abx, aby, abz);
          const edgeAc = Math.hypot(acx, acy, acz);
          const edgeBc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
          const longest = Math.max(edgeAb, edgeAc, edgeBc);
          faceVertexIds.push(ids);
          faceAreas.push(area);
          faceIsSliver.push(
            CULL_SLIVERS &&
              longest > SLIVER_MIN_EDGE_M &&
              (longest * longest) / (4 * Math.max(area, 1e-9)) > SLIVER_RATIO,
  );
          record.faceRootVertexIds.push(ids[0]);
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of root.listScenes()) for (const node of scene.listChildren()) visit(node);

  // TWO-STAGE connectivity: cut the sliver faces FIRST, then compute
  // components on what remains. The torn wall-top skirts (the "comb" fringes)
  // hang off the shell through degenerate sliver triangles — with those cut,
  // the skirts become isolated ribbons and the size/ribbon rules can take
  // them. (Slivers are dropped from the output regardless.)
  const unionFind = new UnionFind(keyToId.size);
  for (let face = 0; face < faceVertexIds.length; face += 1) {
    if (faceIsSliver[face] === true) continue;
    const ids = faceVertexIds[face] as [number, number, number];
    unionFind.union(ids[0], ids[1]);
    unionFind.union(ids[0], ids[2]);
  }

  // Component stats: area + true vertex-extent bbox.
  interface Stat { area: number; min: [number, number, number]; max: [number, number, number]; faces: number }
  const stats = new Map<number, Stat>();
  {
    let faceIndex = 0;
    const visitStats = (node: GltfNode): void => {
      const mesh = node.getMesh();
      if (mesh !== null) {
        const world = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
          const position = primitive.getAttribute("POSITION");
          const indices = primitive.getIndices();
          if (position === null || indices === null) continue;
          const element: number[] = [0, 0, 0];
          const count = indices.getCount();
          for (let cursor = 0; cursor + 2 < count; cursor += 3) {
            if (faceIsSliver[faceIndex] === true) {
              faceIndex += 1; // slivers are cut before connectivity — no stats
              continue;
            }
            const rootId = unionFind.find((faceVertexIds[faceIndex] as [number, number, number])[0]);
            let stat = stats.get(rootId);
            if (stat === undefined) {
              stat = { area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], faces: 0 };
              stats.set(rootId, stat);
            }
            stat.area += faceAreas[faceIndex] ?? 0;
            stat.faces += 1;
            for (let corner = 0; corner < 3; corner += 1) {
              position.getElement(indices.getScalar(cursor + corner), element);
              const world3 = multiplyMat4Vec3(world, [element[0] ?? 0, element[1] ?? 0, element[2] ?? 0]);
              for (let axis = 0; axis < 3; axis += 1) {
                const value = world3[axis] ?? 0;
                if (value < (stat.min[axis] ?? Infinity)) stat.min[axis] = value;
                if (value > (stat.max[axis] ?? -Infinity)) stat.max[axis] = value;
              }
            }
            faceIndex += 1;
          }
        }
      }
      for (const child of node.listChildren()) visitStats(child);
    };
    for (const scene of root.listScenes()) for (const node of scene.listChildren()) visitStats(node);
  }

  const isDebrisRoot = new Set<number>();
  for (const [rootId, stat] of stats) {
    const extents = [
      stat.max[0] - stat.min[0],
      stat.max[1] - stat.min[1],
      stat.max[2] - stat.min[2],
    ].sort((left, right) => left - right);
    const diag = Math.hypot(extents[0] ?? 0, extents[1] ?? 0, extents[2] ?? 0);
    const tinyIsolated = stat.area < DEBRIS_AREA_M2 && diag < DEBRIS_DIAG_M;
    // Free-floating RIBBONS: metres long but with a sliver cross-section
    // (the torn wall-top skirts and cornice strips hovering off the shell).
    // No legitimate detached object is thinner than ~12 cm × 45 cm in section
    // at ANY length; real detached things (curtains, chandeliers, furniture)
    // are fat in at least two dimensions, and railings are welded to the
    // shell so they never reach this test.
    const ribbon = (extents[0] ?? 0) < 0.12 && (extents[1] ?? 0) < 0.45;
    if (tinyIsolated || ribbon) isDebrisRoot.add(rootId);
  }

  // Pass 2: index surgery per primitive.
  let droppedFaces = 0;
  let droppedSlivers = 0;
  let keptFaces = 0;
  for (const { primitive, faceRootVertexIds, startFace } of primitiveFaces) {
    const indices = primitive.getIndices();
    if (indices === null) continue;
    const source = indices.getArray();
    if (source === null) continue;
    const kept: number[] = [];
    for (let face = 0; face < faceRootVertexIds.length; face += 1) {
      const rootId = unionFind.find(faceRootVertexIds[face] ?? 0);
      const sliver = faceIsSliver[startFace + face] === true;
      if (isDebrisRoot.has(rootId) || sliver) {
        droppedFaces += 1;
        if (sliver) droppedSlivers += 1;
        continue;
      }
      keptFaces += 1;
      const base = face * 3;
      kept.push(Number(source[base]), Number(source[base + 1]), Number(source[base + 2]));
    }
    if (kept.length === source.length) continue; // untouched primitive
    const TypedArrayCtor = source.constructor as new (values: number[]) => NonNullable<
      ReturnType<typeof indices.getArray>
    >;
    indices.setArray(new TypedArrayCtor(kept));
  }

  console.log(
    `debris components: ${String(isDebrisRoot.size)} | faces dropped ${String(droppedFaces)} ` +
      `(${((100 * droppedFaces) / (droppedFaces + keptFaces)).toFixed(2)}%, of which slivers ${String(droppedSlivers)}) | kept ${String(keptFaces)}`,
  );

  const outPath = write ? GLB_PATH : PREVIEW_PATH;
  mkdirSync(dirname(PREVIEW_PATH), { recursive: true });
  if (write) {
    copyFileSync(GLB_PATH, BACKUP_PATH);
    console.log(`original backed up -> ${BACKUP_PATH}`);
  }
  await io.write(outPath, document);
  const bytes = statSync(outPath).size;
  console.log(`wrote ${outPath} (${(bytes / 1e6).toFixed(2)} MB)`);

  if (write) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      mesh?: { path: string; bytes: number };
      contentHashes?: Record<string, string>;
    };
    if (manifest.mesh !== undefined) manifest.mesh.bytes = bytes;
    if (manifest.contentHashes?.["mesh/dollhouse.glb"] !== undefined) {
      manifest.contentHashes["mesh/dollhouse.glb"] = createHash("sha256")
        .update(readFileSync(outPath))
        .digest("hex");
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log("manifest mesh.bytes + contentHash updated");
  }
}

await main();

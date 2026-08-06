/**
 * handcut-dollhouse — apply an interactively authored face cut to the
 * dollhouse mesh.
 *
 * The 2026-07-16 Blender MCP session identified the shell-attached scan
 * artifacts (the wood-tone "comb" skirt, the floating cream cornice strip,
 * the floating sheet over the spiral stair, plus rim/gap wreckage) and saved
 * every doomed face's world-space centroid to a JSON file. This script
 * replays that cut on the pristine glb as pure INDEX surgery — identical
 * technique to clean-dollhouse.ts: vertex attributes, UVs, materials and
 * textures stay byte-identical, only face index triples are filtered — then
 * re-encodes with meshopt and updates the manifest bytes + sha256.
 *
 * Centroids are matched on a 1 mm grid with +-1 cell tolerance per axis
 * (Blender computed them in float64 from dequantized float32 positions; this
 * script recomputes them from the quantized source, so exact equality cannot
 * be assumed).
 *
 * Run (preview -> scratchpad):
 *   cd tools/twin-forge && node_modules/.bin/tsx scripts/handcut-dollhouse.ts
 * Apply in place (fresh backup, updates manifest):
 *   ... handcut-dollhouse.ts --write
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const REPO = "c:/Users/blake/omnitwin2";
const GLB_PATH = `${REPO}/packages/web/public/twin/trades-hall/mesh/dollhouse.glb`;
const MANIFEST_PATH = `${REPO}/packages/web/public/twin/trades-hall/manifest.json`;
const SCRATCH =
  "C:/Users/blake/AppData/Local/Temp/claude/c--Users-blake-omnitwin2/d2df5d04-3d3a-49ac-8f6a-c9d104d22047/scratchpad/meshcut";
const DOOMED_PATH = `${SCRATCH}/doomed.json`;
const PREVIEW_PATH = `${SCRATCH}/dollhouse-handcut.glb`;
const BACKUP_PATH = `${SCRATCH}/dollhouse-pre-handcut-final-backup.glb`;

const KEY_MM = 1000;

function multiplyMat4Vec3(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    (m[0] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[8] ?? 0) * v[2] + (m[12] ?? 0),
    (m[1] ?? 0) * v[0] + (m[5] ?? 0) * v[1] + (m[9] ?? 0) * v[2] + (m[13] ?? 0),
    (m[2] ?? 0) * v[0] + (m[6] ?? 0) * v[1] + (m[10] ?? 0) * v[2] + (m[14] ?? 0),
  ];
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const doomed = JSON.parse(readFileSync(DOOMED_PATH, "utf8")) as {
    count: number;
    centroids: [number, number, number][];
  };
  const doomedKeys = new Set<string>();
  for (const [x, y, z] of doomed.centroids) {
    doomedKeys.add(`${String(Math.round(x * KEY_MM))},${String(Math.round(y * KEY_MM))},${String(Math.round(z * KEY_MM))}`);
  }

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const document: Document = await io.read(GLB_PATH);
  const root = document.getRoot();

  const matchesDoomed = (cx: number, cy: number, cz: number): boolean => {
    const kx = Math.round(cx * KEY_MM);
    const ky = Math.round(cy * KEY_MM);
    const kz = Math.round(cz * KEY_MM);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (doomedKeys.has(`${String(kx + dx)},${String(ky + dy)},${String(kz + dz)}`)) return true;
        }
      }
    }
    return false;
  };

  let droppedFaces = 0;
  let keptFaces = 0;
  const visit = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh !== null) {
      const world = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute("POSITION");
        const indices = primitive.getIndices();
        if (position === null || indices === null) continue;
        const source = indices.getArray();
        if (source === null) continue;
        const element: number[] = [0, 0, 0];
        const kept: number[] = [];
        const count = indices.getCount();
        for (let cursor = 0; cursor + 2 < count; cursor += 3) {
          let cx = 0;
          let cy = 0;
          let cz = 0;
          for (let corner = 0; corner < 3; corner += 1) {
            position.getElement(indices.getScalar(cursor + corner), element);
            const world3 = multiplyMat4Vec3(world, [element[0] ?? 0, element[1] ?? 0, element[2] ?? 0]);
            cx += world3[0] / 3;
            cy += world3[1] / 3;
            cz += world3[2] / 3;
          }
          if (matchesDoomed(cx, cy, cz)) {
            droppedFaces += 1;
            continue;
          }
          keptFaces += 1;
          kept.push(Number(source[cursor]), Number(source[cursor + 1]), Number(source[cursor + 2]));
        }
        if (kept.length === source.length) continue;
        const TypedArrayCtor = source.constructor as new (values: number[]) => NonNullable<
          ReturnType<typeof indices.getArray>
        >;
        indices.setArray(new TypedArrayCtor(kept));
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of root.listScenes()) for (const node of scene.listChildren()) visit(node);

  console.log(
    `doomed centroids: ${String(doomed.count)} | faces dropped ${String(droppedFaces)} | kept ${String(keptFaces)}`,
  );

  const outPath = write ? GLB_PATH : PREVIEW_PATH;
  mkdirSync(dirname(PREVIEW_PATH), { recursive: true });
  if (write) {
    copyFileSync(GLB_PATH, BACKUP_PATH);
    console.log(`pre-surgery glb backed up -> ${BACKUP_PATH}`);
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

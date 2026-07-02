import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

/**
 * Source GLB → bundle dollhouse: dedup/prune/weld, meshopt geometry
 * compression, WebP textures capped at 1024². Target ≤ 8 MB (program spec
 * §6 Phase 2); the CLI warns when the result misses the budget.
 */
export async function optimizeMesh(
  srcGlb: string,
  outDir: string,
): Promise<{ bytes: number; sourceName: string }> {
  const dest = join(outDir, "mesh", "dollhouse.glb");
  const sourceName = basename(srcGlb);
  if (existsSync(dest)) {
    return { bytes: (await stat(dest)).size, sourceName };
  }
  await mkdir(join(outDir, "mesh"), { recursive: true });

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  const doc = await io.read(srcGlb);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  await io.write(dest, doc);
  return { bytes: (await stat(dest)).size, sourceName };
}

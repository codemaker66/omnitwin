import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { TWIN_FACES, TWIN_LODS, twinTilePath } from "@omnitwin/types";
import { assertSourceFiles } from "./source-preflight.js";

export interface TileReport {
  written: number;
  skipped: number;
}

/**
 * Existing 1024² cubemap JPGs → WebP at 1024 (q80) and 256 (q75).
 * Idempotent: existing outputs are skipped so re-runs after adding scans
 * only pay for the new work.
 */
export async function convertTiles(
  cubemapsDir: string,
  outDir: string,
  nodeIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<TileReport> {
  await assertSourceFiles(
    cubemapsDir,
    nodeIds.flatMap((nodeId) => TWIN_FACES.map((face) => `${nodeId}_${face}.jpg`)),
    "cubemap",
  );

  const report: TileReport = { written: 0, skipped: 0 };
  const total = nodeIds.length * TWIN_FACES.length;
  let done = 0;

  for (const nodeId of nodeIds) {
    await mkdir(join(outDir, "tiles", nodeId), { recursive: true });
    for (const face of TWIN_FACES) {
      const srcName = `${nodeId}_${face}.jpg`;
      const src = join(cubemapsDir, srcName);
      done += 1;
      for (const lod of TWIN_LODS) {
        const dest = join(outDir, twinTilePath(nodeId, face, lod));
        if (existsSync(dest)) {
          report.skipped += 1;
          continue;
        }
        // Always normalize to the LOD size: sources may be any square size
        // (lidar-splat faces were 1024²; the photographic skybox faces are
        // 1536²) and the tile contract is exact.
        const pipeline = sharp(src).resize(lod, lod, { kernel: "lanczos3" });
        await pipeline.webp({ quality: lod === 1024 ? 80 : 75 }).toFile(dest);
        report.written += 1;
      }
      onProgress?.(done, total);
    }
  }
  return report;
}

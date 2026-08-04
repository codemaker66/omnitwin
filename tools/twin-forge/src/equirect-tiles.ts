import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  TWIN_EQUIRECT_LODS,
  twinEquirectPath,
  type TwinEquirectLod,
} from "@omnitwin/types";
import { assertSourceFiles } from "./source-preflight.js";

export interface EquirectTileReport {
  written: number;
  skipped: number;
}

/** Per-LOD WebP quality: the 8192 zoom tier trades a couple of quality
 *  points for its 4× pixel count; the 4096 base carries the walkthrough. */
const EQUIRECT_WEBP_QUALITY: Record<TwinEquirectLod, number> = {
  512: 75,
  4096: 82,
  8192: 80,
};

/**
 * Per-sweep world-frame equirect JPGs (extract_equirect_v2.py supersampled
 * outputs) → WebP at the three equirect LODs:
 *
 * - `equirect_512.webp`  (q75) and `equirect_4096.webp` (q82) from the
 *   LANCZOS-prefiltered base `scan_NNN.jpg` (4096×2048);
 * - `equirect_8192.webp` (q80, zoom tier) from the supersampled render
 *   `scan_NNN_8192.jpg` (8192×4096).
 *
 * Both sources must be present — a node missing either is reported missing
 * and skipped whole (a partial LOD ladder would break the manifest
 * contract). Sources already at the target size pass through without a
 * resample; anything else is LANCZOS-resized to the exact 2:1 tile size.
 * Idempotent: existing outputs skip.
 */
export async function convertEquirectTiles(
  equirectDir: string,
  outDir: string,
  nodeIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<EquirectTileReport> {
  await assertSourceFiles(
    equirectDir,
    nodeIds.flatMap((nodeId) => [`${nodeId}.jpg`, `${nodeId}_8192.jpg`]),
    "equirect",
  );

  const report: EquirectTileReport = { written: 0, skipped: 0 };
  const total = nodeIds.length;
  let done = 0;

  for (const nodeId of nodeIds) {
    const baseName = `${nodeId}.jpg`;
    const ssName = `${nodeId}_8192.jpg`;
    const baseSrc = join(equirectDir, baseName);
    const ssSrc = join(equirectDir, ssName);
    done += 1;
    await mkdir(join(outDir, "tiles", nodeId), { recursive: true });
    for (const lod of TWIN_EQUIRECT_LODS) {
      const dest = join(outDir, twinEquirectPath(nodeId, lod));
      if (existsSync(dest)) {
        report.skipped += 1;
        continue;
      }
      const src = lod === 8192 ? ssSrc : baseSrc;
      const image = sharp(src);
      const { width, height } = await image.metadata();
      // Exact 2:1 tile contract; resize only when the source differs.
      const pipeline =
        width === lod && height === lod / 2
          ? image
          : image.resize(lod, lod / 2, { kernel: "lanczos3" });
      await pipeline.webp({ quality: EQUIRECT_WEBP_QUALITY[lod] }).toFile(dest);
      report.written += 1;
    }
    onProgress?.(done, total);
  }
  return report;
}

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { TWIN_EQUIRECT_LODS, twinEquirectPath } from "@omnitwin/types";

export interface EquirectTileReport {
  written: number;
  skipped: number;
  missing: string[];
}

/**
 * Per-sweep world-frame equirect JPGs (`scan_NNN.jpg`, 2048×1024, from
 * extract_equirect.py) → WebP at both equirect LODs:
 * `tiles/<node>/equirect_2048.webp` (q82, full) and
 * `tiles/<node>/equirect_512.webp` (q75, 512×256 preview).
 * Both derive from the full-res source (the extractor's *_preview.jpg is a
 * human convenience, not a forge input). Idempotent: existing outputs skip.
 */
export async function convertEquirectTiles(
  equirectDir: string,
  outDir: string,
  nodeIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<EquirectTileReport> {
  const report: EquirectTileReport = { written: 0, skipped: 0, missing: [] };
  const total = nodeIds.length;
  let done = 0;

  for (const nodeId of nodeIds) {
    const srcName = `${nodeId}.jpg`;
    const src = join(equirectDir, srcName);
    done += 1;
    if (!existsSync(src)) {
      report.missing.push(srcName);
      continue;
    }
    await mkdir(join(outDir, "tiles", nodeId), { recursive: true });
    for (const lod of TWIN_EQUIRECT_LODS) {
      const dest = join(outDir, twinEquirectPath(nodeId, lod));
      if (existsSync(dest)) {
        report.skipped += 1;
        continue;
      }
      // Exact 2:1 tile contract regardless of source dimensions.
      const pipeline = sharp(src).resize(lod, lod / 2, { kernel: "lanczos3" });
      await pipeline.webp({ quality: lod === 2048 ? 82 : 75 }).toFile(dest);
      report.written += 1;
    }
    onProgress?.(done, total);
  }
  return report;
}

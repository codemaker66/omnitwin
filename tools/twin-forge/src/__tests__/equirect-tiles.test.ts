import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertEquirectTiles } from "../equirect-tiles.js";
import { hashBundle } from "../hashes.js";

/** Tiny synthetic 2:1 equirect stand-ins — never real capture data. The
 *  base fake is 64×32; the supersampled fake is 128×64 (double, like the
 *  real 4096/8192 pair), so the source-selection per LOD is observable. */
async function makeFakeEquirect(
  dir: string,
  name: string,
  width: number,
  height: number,
): Promise<void> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 70 } },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(join(dir, name), buf);
}

describe("convertEquirectTiles", () => {
  it("writes 512+4096+8192 webp per complete pano pair and reports missing sources", async () => {
    const src = mkdtempSync(join(tmpdir(), "forge-eq-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-eq-out-"));
    await makeFakeEquirect(src, "scan_000.jpg", 64, 32);
    await makeFakeEquirect(src, "scan_000_8192.jpg", 128, 64);

    const report = await convertEquirectTiles(src, out, ["scan_000", "scan_001"]);
    expect(report.written).toBe(3); // one pano pair × three lods
    expect(report.missing).toEqual(["scan_001.jpg", "scan_001_8192.jpg"]);

    // The 2:1 tile contract is exact regardless of source dimensions.
    for (const lod of [512, 4096, 8192] as const) {
      const tile = join(out, "tiles", "scan_000", `equirect_${String(lod)}.webp`);
      expect(existsSync(tile)).toBe(true);
      const meta = await sharp(tile).metadata();
      expect([meta.width, meta.height]).toEqual([lod, lod / 2]);
    }

    const again = await convertEquirectTiles(src, out, ["scan_000"]);
    expect(again.skipped).toBe(3); // idempotent
    expect(again.written).toBe(0);

    const hashes = await hashBundle(out);
    expect(Object.keys(hashes)).toContain("tiles/scan_000/equirect_512.webp");
    expect(hashes["tiles/scan_000/equirect_4096.webp"]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes["tiles/scan_000/equirect_8192.webp"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips a node whole when only its 8192 source is missing", async () => {
    const src = mkdtempSync(join(tmpdir(), "forge-eq-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-eq-out-"));
    await makeFakeEquirect(src, "scan_002.jpg", 64, 32); // base only

    const report = await convertEquirectTiles(src, out, ["scan_002"]);
    expect(report.written).toBe(0); // no partial LOD ladder
    expect(report.missing).toEqual(["scan_002_8192.jpg"]);
    expect(existsSync(join(out, "tiles", "scan_002"))).toBe(false);
  });
});

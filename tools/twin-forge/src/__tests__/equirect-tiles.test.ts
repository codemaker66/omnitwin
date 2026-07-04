import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertEquirectTiles } from "../equirect-tiles.js";
import { hashBundle } from "../hashes.js";

/** Tiny synthetic 2:1 equirect stand-in (64×32) — never real capture data. */
async function makeFakeEquirect(dir: string, name: string): Promise<void> {
  const buf = await sharp({
    create: { width: 64, height: 32, channels: 3, background: { r: 40, g: 90, b: 70 } },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(join(dir, name), buf);
}

describe("convertEquirectTiles", () => {
  it("writes 512+2048 webp per present pano and reports missing ones", async () => {
    const src = mkdtempSync(join(tmpdir(), "forge-eq-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-eq-out-"));
    await makeFakeEquirect(src, "scan_000.jpg");

    const report = await convertEquirectTiles(src, out, ["scan_000", "scan_001"]);
    expect(report.written).toBe(2); // one pano × two lods
    expect(report.missing).toEqual(["scan_001.jpg"]);

    const full = join(out, "tiles", "scan_000", "equirect_2048.webp");
    const preview = join(out, "tiles", "scan_000", "equirect_512.webp");
    expect(existsSync(full)).toBe(true);
    expect(existsSync(preview)).toBe(true);

    // The 2:1 tile contract is exact regardless of source dimensions.
    const fullMeta = await sharp(full).metadata();
    expect([fullMeta.width, fullMeta.height]).toEqual([2048, 1024]);
    const previewMeta = await sharp(preview).metadata();
    expect([previewMeta.width, previewMeta.height]).toEqual([512, 256]);

    const again = await convertEquirectTiles(src, out, ["scan_000"]);
    expect(again.skipped).toBe(2); // idempotent
    expect(again.written).toBe(0);

    const hashes = await hashBundle(out);
    expect(Object.keys(hashes)).toContain("tiles/scan_000/equirect_512.webp");
    expect(hashes["tiles/scan_000/equirect_2048.webp"]).toMatch(/^[0-9a-f]{64}$/);
  });
});

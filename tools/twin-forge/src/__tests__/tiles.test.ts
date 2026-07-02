import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertTiles } from "../tiles.js";
import { hashBundle } from "../hashes.js";

async function makeFakeFace(dir: string, name: string): Promise<void> {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 160, b: 60 } } })
    .jpeg().toBuffer();
  writeFileSync(join(dir, name), buf);
}

describe("convertTiles", () => {
  it("writes 256+1024 webp per present face and reports missing ones", async () => {
    const src = mkdtempSync(join(tmpdir(), "forge-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-out-"));
    for (const face of ["front", "back", "left", "right", "up"]) {
      await makeFakeFace(src, `scan_000_${face}.jpg`);
    }
    const report = await convertTiles(src, out, ["scan_000"]);
    expect(report.written).toBe(10); // 5 faces × 2 lods
    expect(report.missing).toEqual(["scan_000_down.jpg"]);
    expect(existsSync(join(out, "tiles", "scan_000", "front_256.webp"))).toBe(true);
    expect(existsSync(join(out, "tiles", "scan_000", "front_1024.webp"))).toBe(true);

    const again = await convertTiles(src, out, ["scan_000"]);
    expect(again.skipped).toBe(10); // idempotent

    const hashes = await hashBundle(out);
    expect(Object.keys(hashes)).toContain("tiles/scan_000/front_256.webp");
    expect(hashes["tiles/scan_000/front_256.webp"]).toMatch(/^[0-9a-f]{64}$/);
  });
});

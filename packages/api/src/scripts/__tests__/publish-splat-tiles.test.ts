import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectTiles } from "../publish-splat-tiles.js";

// What reaches R2 is exactly what this walk collects. The prebuilt trees live
// under lod/ beside the tiles and are keyed relative to the room, so the
// header's own chunk names resolve next to it on the bucket as they do on disk.
describe("collectTiles", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("collects the servable tiles of every room and the prebuilt trees under lod/, keyed relative to the room", () => {
    dir = mkdtempSync(join(tmpdir(), "publish-splats-"));
    const room = join(dir, "trades-hall", "saloon");
    mkdirSync(join(room, "lod"), { recursive: true });
    writeFileSync(join(room, "0_0.sog"), Buffer.alloc(3));
    writeFileSync(join(room, "notes.txt"), "not a tile");
    writeFileSync(join(room, "lod", "0_0-lod.rad"), Buffer.alloc(4));
    writeFileSync(join(room, "lod", "0_0-lod-0.radc"), Buffer.alloc(5));
    writeFileSync(join(room, "lod", "0_0-lod.rad.unchunked"), Buffer.alloc(6));
    writeFileSync(join(room, "lod", "README.md"), "not a tile either");

    const tiles = collectTiles(dir, "trades-hall");

    expect(tiles.map((tile) => `${tile.room}/${tile.file}:${String(tile.bytes)}`).sort()).toEqual([
      "saloon/0_0.sog:3",
      "saloon/lod/0_0-lod-0.radc:5",
      "saloon/lod/0_0-lod.rad:4",
    ]);
    expect(tiles.every((tile) => tile.path.startsWith(room))).toBe(true);
  });

  it("returns nothing for a venue that is not staged", () => {
    dir = mkdtempSync(join(tmpdir(), "publish-splats-"));
    expect(collectTiles(dir, "nowhere")).toEqual([]);
  });
});

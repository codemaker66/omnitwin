import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackage, collectTiles, packageContentType, packageUploadAction } from "../publish-splat-tiles.js";

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

// A room package (T-639) is published once per version and never overwritten:
// its manifest goes last, so a reader never finds a manifest whose files are absent.
describe("collectPackage", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const MANIFEST = "{\"schema\":\"venviewer.floor-skin.v1\"}";

  function stagePackage(): string {
    dir = mkdtempSync(join(tmpdir(), "publish-package-"));
    const pkg = join(dir, "trades-hall", "grand-hall", "floor-skin", "v1");
    mkdirSync(join(pkg, "scratch"), { recursive: true });
    writeFileSync(join(pkg, "floor-skin.json"), MANIFEST);
    writeFileSync(join(pkg, "albedo-1024-0.webp"), Buffer.from([1, 2, 3]));
    writeFileSync(join(pkg, "height-5cm.i16"), Buffer.alloc(4));
    writeFileSync(join(pkg, "slab-mask-1024x512.u8"), Buffer.alloc(2));
    writeFileSync(join(pkg, "scratch", "ignored.webp"), Buffer.alloc(1));
    return pkg;
  }

  it("keys every file of the version directory under the bucket prefix, manifest last", () => {
    const pkg = stagePackage();
    const files = collectPackage(dir ?? "", "trades-hall", "grand-hall/floor-skin/v1");

    expect(files.map((file) => `${file.key}|${file.contentType}|${String(file.bytes)}`)).toEqual([
      "splats/trades-hall/grand-hall/floor-skin/v1/albedo-1024-0.webp|image/webp|3",
      "splats/trades-hall/grand-hall/floor-skin/v1/height-5cm.i16|application/octet-stream|4",
      "splats/trades-hall/grand-hall/floor-skin/v1/slab-mask-1024x512.u8|application/octet-stream|2",
      `splats/trades-hall/grand-hall/floor-skin/v1/floor-skin.json|application/json|${String(Buffer.byteLength(MANIFEST))}`,
    ]);
    expect(files[0]?.path).toBe(join(pkg, "albedo-1024-0.webp"));
    expect(files[0]?.sha256).toBe(createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex"));
  });

  it("returns nothing for a package that is not staged", () => {
    dir = mkdtempSync(join(tmpdir(), "publish-package-"));
    expect(collectPackage(dir, "trades-hall", "grand-hall/floor-skin/v1")).toEqual([]);
  });

  it.each([
    "grand-hall",
    "grand-hall/floor-skin",
    "grand-hall/floor-skin/latest",
    "grand-hall/../floor-skin/v1",
    "../grand-hall/floor-skin/v1",
    "Grand-Hall/floor-skin/v1",
    "grand-hall/floor-skin/v1/extra",
    "grand-hall\\floor-skin\\v1",
  ])("refuses the package path %s: it must be <room>/<package>/v<number>", (packagePath) => {
    dir = mkdtempSync(join(tmpdir(), "publish-package-"));
    expect(() => collectPackage(dir ?? "", "trades-hall", packagePath)).toThrow(/package path/i);
  });
});

describe("packageContentType", () => {
  it.each([
    ["floor-skin.json", "application/json"],
    ["albedo-4096-0.webp", "image/webp"],
    ["preview.PNG", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["albedo.ktx2", "image/ktx2"],
    ["height-5cm.i16", "application/octet-stream"],
  ])("labels %s as %s", (name, contentType) => {
    expect(packageContentType(name)).toBe(contentType);
  });
});

describe("packageUploadAction", () => {
  it("puts a file the bucket does not have", () => {
    expect(packageUploadAction("aa", null)).toBe("put");
  });

  it("skips a file already published with the same bytes, so a rerun resumes", () => {
    expect(packageUploadAction("aa", { sha256: "aa" })).toBe("skip");
  });

  it("refuses to overwrite a published version with different or unverifiable bytes", () => {
    expect(packageUploadAction("aa", { sha256: "bb" })).toBe("conflict");
    expect(packageUploadAction("aa", { sha256: undefined })).toBe("conflict");
  });
});

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeBundlePath, listSafeBundleFiles, resolveBundlePath } from "../path-safety.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Twin bundle path confinement", () => {
  it.each([
    "../escape.webp",
    "./same.webp",
    "/root.webp",
    "tiles\\scan.webp",
    "tiles//scan.webp",
    "C:/escape.webp",
    "tiles/%2e%2e/escape.webp",
    "tiles/has space.webp",
  ])("rejects unsafe relative path %s", (path) => {
    expect(() => { assertSafeBundlePath(path); }).toThrow("Unsafe bundle path");
  });

  it("resolves a safe path inside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-path-"));
    cleanup.push(root);
    expect(resolveBundlePath(root, "mesh/dollhouse.glb")).toBe(join(root, "mesh", "dollhouse.glb"));
  });

  it("rejects symbolic links anywhere in the bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-link-"));
    cleanup.push(root);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "image.webp"), "outside");
    await mkdir(join(root, "tiles"));
    await symlink(outside, join(root, "tiles", "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(listSafeBundleFiles(root)).rejects.toThrow("Symbolic links are not accepted");
  });
});

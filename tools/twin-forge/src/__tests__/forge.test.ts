import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { TwinManifestSchema } from "@omnitwin/types";
import type { TwinManifest } from "@omnitwin/types";
import {
  MESH_BUDGET_BYTES,
  assertMeshBudget,
  forgeBundle,
  isRetryableRenameError,
  refreshBundleManifest,
  replaceBundleMesh,
} from "../forge.js";

const RAW_POSES = {
  "0": { rotation: [1, 0, 0, 0] as [number, number, number, number], translation: [0, 0, 1.5] as [number, number, number] },
};

async function makeFace(dir: string, name: string): Promise<void> {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
  await writeFile(join(dir, name), image);
}

async function makeCompleteCube(dir: string): Promise<void> {
  for (const face of ["front", "back", "left", "right", "up", "down"]) {
    await makeFace(dir, `scan_000_${face}.jpg`);
  }
}

function baseOptions(cubemapsDir: string, outDir: string, generatedAt: string) {
  return {
    cubemapsDir,
    outDir,
    rawPoses: RAW_POSES,
    venueSlug: "trades-hall",
    name: "Trades Hall Glasgow",
    tier: "ops-grade-2cm" as const,
    generatedAt,
  };
}

async function runCli(args: readonly string[]): Promise<{ code: number | null; stderr: string }> {
  const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stderr };
}

function preservedManifestFields(manifest: TwinManifest): Record<string, unknown> {
  const preserved = structuredClone(manifest) as Record<string, unknown>;
  Reflect.deleteProperty(preserved, "generatedAt");
  Reflect.deleteProperty(preserved, "mesh");
  Reflect.deleteProperty(preserved, "contentHashes");
  return preserved;
}

function forgeResidue(parent: string): Promise<string[]> {
  return readdir(parent).then((names) => names.filter((name) => name.includes(".forge-")));
}

describe("forgeBundle", () => {
  it("retries only transient Windows directory-rename errors", () => {
    expect(isRetryableRenameError({ code: "EPERM" })).toBe(true);
    expect(isRetryableRenameError({ code: "EBUSY" })).toBe(true);
    expect(isRetryableRenameError({ code: "ENOENT" })).toBe(false);
    expect(isRetryableRenameError(new Error("rename failed"))).toBe(false);
  });

  it("publishes a complete exact bundle and atomically replaces only a prior twin bundle", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-atomic-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    await mkdir(src);
    await makeCompleteCube(src);

    const first = await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    expect(first.report).toEqual({ written: 12, skipped: 0 });
    expect(Object.keys(first.manifest.contentHashes ?? {})).toHaveLength(12);
    expect(() => TwinManifestSchema.parse(first.manifest)).not.toThrow();

    // A prior interrupted/partial bundle is repairable because its valid
    // manifest proves ownership of the directory and no foreign file exists.
    await rm(join(out, "tiles", "scan_000", "down_1024.webp"));
    const second = await forgeBundle(baseOptions(src, out, "2026-07-10T00:01:00.000Z"));
    expect(second.manifest.generatedAt).toBe("2026-07-10T00:01:00.000Z");
    expect((await readdir(parent)).filter((name) => name.includes(".forge-"))).toEqual([]);

    const refreshed = await refreshBundleManifest({
      outDir: out,
      rawPoses: {
        "0": {
          rotation: [1, 0, 0, 0],
          translation: [0, 0, -2.13],
        },
      },
      generatedAt: "2026-07-10T00:01:30.000Z",
    });
    expect(refreshed.manifest.nodes[0]?.floor).toBe(-1);
    expect(refreshed.report).toEqual({ written: 0, skipped: 12 });
    expect((await readdir(parent)).filter((name) => name.includes(".forge-"))).toEqual([]);
    const publishedBeforeFailure = await readFile(join(out, "manifest.json"), "utf8");

    await rm(join(src, "scan_000_down.jpg"));
    await expect(
      forgeBundle(baseOptions(src, out, "2026-07-10T00:02:00.000Z")),
    ).rejects.toThrow("scan_000_down.jpg");
    expect(await readFile(join(out, "manifest.json"), "utf8")).toBe(publishedBeforeFailure);

    await writeFile(join(out, "operator-note.txt"), "must not be deleted");
    await expect(
      forgeBundle(baseOptions(src, out, "2026-07-10T00:03:00.000Z")),
    ).rejects.toThrow("unexpected files: operator-note.txt");
    expect(await readFile(join(out, "operator-note.txt"), "utf8")).toBe("must not be deleted");
  });

  it("refuses to overwrite a non-bundle directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-safe-out-"));
    const src = join(parent, "source");
    const out = join(parent, "not-a-bundle");
    await mkdir(src);
    await mkdir(out);
    await makeCompleteCube(src);
    await writeFile(join(out, "keep.txt"), "operator data");

    await expect(
      forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z")),
    ).rejects.toThrow("Refusing to replace");
    expect(await readFile(join(out, "keep.txt"), "utf8")).toBe("operator data");
  });

  it("hard-fails optimized meshes over the eight-megabyte budget", () => {
    expect(() => {
      assertMeshBudget(MESH_BUDGET_BYTES);
    }).not.toThrow();
    expect(() => {
      assertMeshBudget(MESH_BUDGET_BYTES + 1);
    }).toThrow("8 MiB");
  });
});

describe("replaceBundleMesh", () => {
  it("copies a reviewed mesh byte-for-byte and preserves every unrelated manifest field", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-replace-mesh-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    const initialMesh = join(parent, "initial.glb");
    const prepared = join(parent, "reviewed-cleanup.glb");
    await mkdir(src);
    await makeCompleteCube(src);
    await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    const initialBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 9, 8, 7, 6]);
    await writeFile(initialMesh, initialBytes);
    const first = await replaceBundleMesh({
      outDir: out,
      preparedMeshPath: initialMesh,
      generatedAt: "2026-07-10T00:01:00.000Z",
    });
    const preparedBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
    await writeFile(prepared, preparedBytes);

    const replaced = await replaceBundleMesh({
      outDir: out,
      preparedMeshPath: prepared,
      generatedAt: "2026-07-10T00:05:00.000Z",
    });

    expect(await readFile(join(out, "mesh", "dollhouse.glb"))).toEqual(preparedBytes);
    expect(preservedManifestFields(replaced.manifest)).toEqual(
      preservedManifestFields(first.manifest),
    );
    for (const [path, digest] of Object.entries(first.manifest.contentHashes ?? {})) {
      if (path === "mesh/dollhouse.glb") {
        expect(replaced.manifest.contentHashes?.[path]).not.toBe(digest);
      } else {
        expect(replaced.manifest.contentHashes?.[path]).toBe(digest);
      }
    }
    expect(replaced.manifest.generatedAt).toBe("2026-07-10T00:05:00.000Z");
    expect(replaced.manifest.mesh).toEqual({
      path: "mesh/dollhouse.glb",
      bytes: preparedBytes.byteLength,
      sourceName: "reviewed-cleanup.glb",
    });
    expect(replaced.report).toEqual({ written: 0, skipped: 12 });
    expect(await forgeResidue(parent)).toEqual([]);
  });

  it("rejects a corrupt published bundle without changing it or leaving stage residue", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-replace-corrupt-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    const initialMesh = join(parent, "initial.glb");
    const prepared = join(parent, "reviewed-cleanup.glb");
    await mkdir(src);
    await makeCompleteCube(src);
    await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    const initialBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 5, 4, 3, 2]);
    await writeFile(initialMesh, initialBytes);
    const first = await replaceBundleMesh({ outDir: out, preparedMeshPath: initialMesh });
    const manifestBytes = await readFile(join(out, "manifest.json"));
    const firstPath = Object.keys(first.manifest.contentHashes ?? {}).find(
      (path) => path !== "mesh/dollhouse.glb",
    );
    if (firstPath === undefined) throw new Error("fixture bundle has no content files");
    await writeFile(join(out, firstPath), "corrupt");
    await writeFile(prepared, Buffer.from([1, 2, 3]));

    await expect(
      replaceBundleMesh({ outDir: out, preparedMeshPath: prepared }),
    ).rejects.toThrow(`SHA-256 mismatch for ${firstPath}`);
    expect(await readFile(join(out, "manifest.json"))).toEqual(manifestBytes);
    expect(await readFile(join(out, "mesh", "dollhouse.glb"))).toEqual(initialBytes);
    expect(await forgeResidue(parent)).toEqual([]);
  });

  it("rejects an oversized candidate without changing the published bundle", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-replace-large-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    const initialMesh = join(parent, "initial.glb");
    const prepared = join(parent, "too-large.glb");
    await mkdir(src);
    await makeCompleteCube(src);
    await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    const initialBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 1, 3, 5, 7]);
    await writeFile(initialMesh, initialBytes);
    await replaceBundleMesh({ outDir: out, preparedMeshPath: initialMesh });
    const manifestBytes = await readFile(join(out, "manifest.json"));
    await writeFile(prepared, Buffer.alloc(MESH_BUDGET_BYTES + 1));

    await expect(
      replaceBundleMesh({ outDir: out, preparedMeshPath: prepared }),
    ).rejects.toThrow("8 MiB");
    expect(await readFile(join(out, "manifest.json"))).toEqual(manifestBytes);
    expect(await readFile(join(out, "mesh", "dollhouse.glb"))).toEqual(initialBytes);
    expect(await forgeResidue(parent)).toEqual([]);
  });
});

describe("forge CLI", () => {
  it("exits non-zero without creating an output directory when preflight finds missing input", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-cli-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    const poses = join(parent, "poses.json");
    await mkdir(src);
    await writeFile(poses, JSON.stringify(RAW_POSES));

    const result = await runCli([
      "--cubemaps", src,
      "--poses", poses,
      "--out", out,
      "--venue", "trades-hall",
      "--name", "Trades Hall Glasgow",
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Missing cubemap source files");
    expect(existsSync(out)).toBe(false);
  });

  it("replaces a prepared mesh without poses and rejects ambiguous mode combinations", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-cli-replace-"));
    const src = join(parent, "source");
    const out = join(parent, "published");
    const prepared = join(parent, "reviewed.glb");
    await mkdir(src);
    await makeCompleteCube(src);
    await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    await writeFile(prepared, Buffer.from([9, 8, 7, 6]));

    const result = await runCli(["--replace-mesh", prepared, "--out", out]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(await readFile(join(out, "mesh", "dollhouse.glb"))).toEqual(
      Buffer.from([9, 8, 7, 6]),
    );

    for (const conflict of [["--refresh-manifest"], ["--mesh", prepared]]) {
      const failed = await runCli([
        "--replace-mesh",
        prepared,
        "--out",
        out,
        ...conflict,
      ]);
      expect(failed.code).not.toBe(0);
      expect(failed.stderr).toContain("cannot be combined");
    }
  });
});

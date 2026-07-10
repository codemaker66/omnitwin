import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { TwinManifestSchema } from "@omnitwin/types";
import {
  MESH_BUDGET_BYTES,
  assertMeshBudget,
  forgeBundle,
  isRetryableRenameError,
  orderedCapturePositions,
  refreshBundleManifest,
  refreshBundleMesh,
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

async function writeSourceMesh(dir: string): Promise<string> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 2, 1]))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setIndices(indices).setAttribute("POSITION", position);
  const node = doc.createNode("reversed-triangle").setMesh(doc.createMesh().addPrimitive(primitive));
  doc.createScene().addChild(node);
  const path = join(dir, "trades-hall-web.glb");
  await new NodeIO().write(path, doc);
  return path;
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

describe("forgeBundle", () => {
  it("orders capture witnesses by canonical scan index", () => {
    expect(
      orderedCapturePositions({
        "10": { rotation: [1, 0, 0, 0], translation: [10, 0, 1.5] },
        "2": { rotation: [1, 0, 0, 0], translation: [2, 0, 1.5] },
      }),
    ).toEqual([
      [2, 0, 1.5],
      [10, 0, 1.5],
    ]);
  });

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

  it("atomically refreshes only the mesh while preserving verified imagery", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-refresh-mesh-"));
    const src = join(parent, "source");
    const meshDir = join(parent, "mesh-source");
    const out = join(parent, "published");
    await mkdir(src);
    await mkdir(meshDir);
    await makeCompleteCube(src);
    const meshPath = await writeSourceMesh(meshDir);
    const initial = await forgeBundle(baseOptions(src, out, "2026-07-10T00:00:00.000Z"));
    const initialTileHashes = { ...initial.manifest.contentHashes };

    const refreshed = await refreshBundleMesh({
      outDir: out,
      rawPoses: RAW_POSES,
      meshPath,
      generatedAt: "2026-07-10T00:05:00.000Z",
    });

    expect(refreshed.manifest.mesh?.sourceName).toBe("trades-hall-web.glb");
    expect(refreshed.manifest.contentHashes?.["mesh/dollhouse.glb"]).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshed.report).toEqual({ written: 0, skipped: 12 });
    for (const [path, hash] of Object.entries(initialTileHashes)) {
      expect(refreshed.manifest.contentHashes?.[path]).toBe(hash);
    }
    expect((await readdir(parent)).filter((name) => name.includes(".forge-"))).toEqual([]);
  });
});

describe("forge CLI", () => {
  it("requires an explicit mesh source for the mesh-only refresh path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "forge-cli-refresh-mesh-"));
    const out = join(parent, "published");
    const poses = join(parent, "poses.json");
    await writeFile(poses, JSON.stringify(RAW_POSES));

    const result = await runCli([
      "--refresh-mesh",
      "--poses", poses,
      "--out", out,
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--mesh is required");
    expect(existsSync(out)).toBe(false);
  });

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
});

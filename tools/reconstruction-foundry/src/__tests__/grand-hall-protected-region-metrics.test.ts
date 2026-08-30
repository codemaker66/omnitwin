import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME,
  GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME,
  GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME,
  GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME,
  GrandHallProtectedRegionMetricsError,
  calculateGrandHallProtectedPixelEdgeMetrics,
  captureGrandHallProtectedMetricsOutputParentIdentity,
  evaluateGrandHallProtectedRegionMetrics,
  materializeGrandHallProtectedRegionMetricsPack,
  parseGrandHallProtectedRegionMetricsArguments,
  publishGrandHallProtectedMetricsResultCreateOnly,
  verifyGrandHallProtectedRegionMetricsResult,
} from "../grand-hall-protected-region-metrics.js";

const roots: string[] = [];
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort((a, b) => a.localeCompare(b)).map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function resultDigest(payload: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update("VENVIEWER_GRAND_HALL_PROTECTED_METRICS_RESULT_V1", "ascii").update(Buffer.from([0])).update(canonicalJson(payload), "utf8").digest("hex")}`;
}

function recordMember(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const member = value[key];
  if (typeof member !== "object" || member === null || Array.isArray(member)) throw new Error(`${key} must be an object`);
  return member as Record<string, unknown>;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("value must be an object");
  return value as Record<string, unknown>;
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-protected-metrics-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Rgb = readonly [number, number, number];

async function writeRgbPng(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
  alpha = false,
): Promise<void> {
  const channels = alpha ? 4 : 3;
  const bytes = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = pixel(x, y);
      const offset = (y * width + x) * channels;
      bytes[offset] = colour[0];
      bytes[offset + 1] = colour[1];
      bytes[offset + 2] = colour[2];
      if (alpha) bytes[offset + 3] = 255;
    }
  }
  const png = await sharp(bytes, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, png, { flag: "wx" });
}

async function writeMaskPng(
  path: string,
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
): Promise<void> {
  const bytes = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) bytes[y * width + x] = pixel(x, y);
  }
  const png = await sharp(bytes, { raw: { width, height, channels: 1 } }).toColourspace("b-w").png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, png, { flag: "wx" });
}

interface Harness {
  readonly root: string;
  readonly sourcePath: string;
  readonly candidatePath: string;
  readonly maskPath: string;
  readonly packDirectory: string;
  readonly resultPath: string;
}

async function harness(
  source: (x: number, y: number) => Rgb,
  candidate: (x: number, y: number) => Rgb,
  mask: (x: number, y: number) => number = () => 255,
  width = 96,
  height = 64,
): Promise<Harness> {
  const root = await workspace();
  const sourcePath = resolve(root, "source.png");
  const candidatePath = resolve(root, "candidate.png");
  const maskPath = resolve(root, "mask.png");
  const packDirectory = resolve(root, "evaluator-pack");
  const resultPath = resolve(root, "result.json");
  await Promise.all([
    writeRgbPng(sourcePath, width, height, source),
    writeRgbPng(candidatePath, width, height, candidate),
    writeMaskPng(maskPath, width, height, mask),
  ]);
  await materializeGrandHallProtectedRegionMetricsPack({ outputDirectory: packDirectory });
  return { root, sourcePath, candidatePath, maskPath, packDirectory, resultPath };
}

async function evaluate(input: Harness) {
  return evaluateGrandHallProtectedRegionMetrics({
    sourcePath: input.sourcePath,
    candidatePath: input.candidatePath,
    protectedMaskPath: input.maskPath,
    evaluatorPackDirectory: input.packDirectory,
    outputPath: input.resultPath,
  });
}

async function pixelMetrics(input: Harness) {
  return calculateGrandHallProtectedPixelEdgeMetrics({
    sourcePath: input.sourcePath,
    candidatePath: input.candidatePath,
    protectedMaskPath: input.maskPath,
  });
}

describe("Grand Hall protected-region metrics evaluator", () => {
  it("materializes an exact create-only implementation/configuration/runtime closure", async () => {
    const root = await workspace();
    const outputDirectory = resolve(root, "pack");
    const first = await materializeGrandHallProtectedRegionMetricsPack({ outputDirectory });
    expect(first.receipt).toMatchObject({ authority: "none", receiptWrittenLast: true });
    expect((await stat(outputDirectory)).isDirectory()).toBe(true);
    const names = [
      GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME,
      GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME,
      GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME,
      GRAND_HALL_PROTECTED_METRICS_PACK_RECEIPT_FILENAME,
    ];
    for (const name of names) {
      const bytes = await readFile(resolve(outputDirectory, name));
      expect(bytes.at(-1)).toBe(0x0a);
      expect(JSON.parse(bytes.toString("utf8"))).toBeTypeOf("object");
    }
    await expect(materializeGrandHallProtectedRegionMetricsPack({ outputDirectory })).rejects.toMatchObject({
      code: "OUTPUT_EXISTS",
    });
  });

  it("rejects a renamed and replaced staging directory while preserving the foreign replacement", async () => {
    const root = await workspace();
    const outputDirectory = resolve(root, "pack");
    let replacement = "";
    await expect(materializeGrandHallProtectedRegionMetricsPack({
      outputDirectory,
      beforePublishTestHook: async (stagingDirectory) => {
        const original = `${stagingDirectory}.original`;
        await rename(stagingDirectory, original);
        await mkdir(stagingDirectory);
        replacement = resolve(stagingDirectory, "foreign.txt");
        await writeFile(replacement, "foreign", { flag: "wx" });
      },
    })).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(replacement, "utf8")).resolves.toBe("foreign");
  });

  it("never replaces an evaluator pack directory claimed immediately before publication", async () => {
    const root = await workspace();
    const outputDirectory = resolve(root, "pack");
    await expect(materializeGrandHallProtectedRegionMetricsPack({
      outputDirectory,
      beforePublishTestHook: async () => { await mkdir(outputDirectory); },
    })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect((await stat(outputDirectory)).isDirectory()).toBe(true);
    expect(await readFile(resolve(outputDirectory, "missing"), "utf8").catch(() => "absent")).toBe("absent");
  });

  it("reports exact equality without reading any private Grand Hall evidence", async () => {
    const scene = (x: number): Rgb => x < 16 ? [20, 40, 60] : [220, 200, 180];
    const input = await harness(scene, scene);
    const metrics = await pixelMetrics(input);
    expect(metrics).toMatchObject({
      protectedPixelCount: 96 * 64,
      protectedRgbSampleCount: 96 * 64 * 3,
      protectedRegionMeanAbsoluteError: 0,
      protectedRegionSsim: 1,
      rawProtectedRegionSsim: 1,
      maximumProtectedEdgeDisplacementPixels: 0,
    });
    expect(metrics.sourceProtectedEdgePixelCount).toBeGreaterThan(0);
    expect(metrics.candidateProtectedEdgePixelCount).toBe(metrics.sourceProtectedEdgePixelCount);
  });

  it("computes normalized RGB MAE and a degraded deterministic SSIM", async () => {
    const input = await harness(() => [100, 100, 100], () => [110, 110, 110]);
    const metrics = await pixelMetrics(input);
    expect(metrics.protectedRegionMeanAbsoluteError).toBeCloseTo(10 / 255, 14);
    expect(metrics.protectedRegionSsim).toBeGreaterThan(0);
    expect(metrics.protectedRegionSsim).toBeLessThan(1);
    expect(metrics.sourceProtectedEdgePixelCount).toBe(0);
    expect(metrics.candidateProtectedEdgePixelCount).toBe(0);
    expect(metrics.maximumProtectedEdgeDisplacementPixels).toBe(0);
  });

  it("reports the exact symmetric Hausdorff displacement for shifted edges", async () => {
    const source = (x: number): Rgb => x < 12 ? [0, 0, 0] : [255, 255, 255];
    const candidate = (x: number): Rgb => x < 14 ? [0, 0, 0] : [255, 255, 255];
    const input = await harness(source, candidate);
    const copiedImplementation = resolve(input.root, "protected-evaluator-implementation.bin");
    const copiedConfiguration = resolve(input.root, "protected-evaluator-configuration.json");
    const copiedRuntime = resolve(input.root, "protected-evaluator-runtime.json");
    await Promise.all([
      copyFile(resolve(input.packDirectory, GRAND_HALL_PROTECTED_METRICS_IMPLEMENTATION_FILENAME), copiedImplementation),
      copyFile(resolve(input.packDirectory, GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME), copiedConfiguration),
      copyFile(resolve(input.packDirectory, GRAND_HALL_PROTECTED_METRICS_RUNTIME_FILENAME), copiedRuntime),
    ]);
    const result = await evaluateGrandHallProtectedRegionMetrics({
      sourcePath: input.sourcePath, candidatePath: input.candidatePath, protectedMaskPath: input.maskPath,
      evaluatorImplementationManifestPath: copiedImplementation,
      evaluatorConfigurationPath: copiedConfiguration,
      evaluatorRuntimePath: copiedRuntime,
      outputPath: input.resultPath,
    });
    expect(result.evaluator.packReceipt).toBeNull();
    expect(result.metrics.sourceProtectedEdgePixelCount).toBeGreaterThan(0);
    expect(result.metrics.candidateProtectedEdgePixelCount).toBe(result.metrics.sourceProtectedEdgePixelCount);
    expect(result.metrics.maximumProtectedEdgeDisplacementPixels).toBe(2);
    expect(result.lpipsProcess.rawProtectedRegionLpips).toBeGreaterThan(0);
    expect(result.lpipsProcess.rawStandardProtectedRegionLpips).toBe(result.lpipsProcess.rawProtectedRegionLpips);
    expect(result.lpipsProcess.standardParityAbsoluteDifference).toBe(0);
    expect(result.metrics.protectedRegionLpips).toBe(result.lpipsProcess.rawProtectedRegionLpips);
    const coordinatedMutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { recordMember(recordMember(recordMember(value, "lpipsProcess"), "inputs"), "source").sha256 = "sha256:" + "0".repeat(64); },
      (value) => { (value.lpipsProcess as Record<string, unknown>).nativeWidth = 97; },
      (value) => { (value.lpipsProcess as Record<string, unknown>).protectedPixelCount = 1; },
      (value) => { (value.lpipsProcess as Record<string, unknown>).protectedRegionLpips = 0.25; },
      (value) => { (value.lpipsProcess as Record<string, unknown>).standardParityAbsoluteDifference = 0; (value.lpipsProcess as Record<string, unknown>).rawStandardProtectedRegionLpips = 0; },
      (value) => { recordMember(recordMember(value, "inputs"), "source").role = "candidate"; },
      (value) => { delete ((value.lpipsProcess as Record<string, unknown>).inputs as Record<string, unknown>).implementation; },
      (value) => { ((value.lpipsProcess as Record<string, unknown>).inputs as Record<string, unknown>).surprise = { sha256: "sha256:" + "0".repeat(64), sizeBytes: 1 }; },
    ];
    for (const mutate of coordinatedMutations) {
      const changed = recordValue(structuredClone(result));
      mutate(changed);
      delete changed.resultSha256;
      changed.resultSha256 = resultDigest(changed);
      await writeFile(input.resultPath, `${canonicalJson(changed)}\n`);
      await expect(verifyGrandHallProtectedRegionMetricsResult(input.resultPath)).rejects.toMatchObject({ code: "MATERIAL_INVALID" });
    }
  });

  it("excludes candidate changes wholly outside the protected region", async () => {
    const source = (x: number): Rgb => x < 16 ? [10, 30, 50] : [210, 190, 170];
    const candidate = (x: number): Rgb => x < 4 ? [255, 0, 255] : source(x);
    const protectedRectangle = (x: number, y: number): number => x >= 8 && x <= 23 && y >= 4 && y <= 19 ? 255 : 0;
    const input = await harness(source, candidate, protectedRectangle);
    const metrics = await pixelMetrics(input);
    expect(metrics.protectedPixelCount).toBe(16 * 16);
    expect(metrics.protectedRegionMeanAbsoluteError).toBe(0);
    expect(metrics.protectedRegionSsim).toBe(1);
    expect(metrics.maximumProtectedEdgeDisplacementPixels).toBe(0);
  });

  it("fails closed for a non-binary mask and leaves no result", async () => {
    const input = await harness(() => [0, 0, 0], () => [0, 0, 0], (x, y) => x === 2 && y === 2 ? 128 : 255);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the decoded extents differ", async () => {
    const input = await harness(() => [0, 0, 0], () => [0, 0, 0]);
    await rm(input.candidatePath);
    await writeRgbPng(input.candidatePath, 95, 64, () => [0, 0, 0]);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when only one image has protected edges", async () => {
    const source = (): Rgb => [0, 0, 0];
    const candidate = (x: number): Rgb => x < 16 ? [0, 0, 0] : [255, 255, 255];
    const input = await harness(source, candidate);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "METRIC_UNDEFINED" });
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the mask has no complete Sobel neighbourhood", async () => {
    const narrowMask = (x: number): number => x === 10 ? 255 : 0;
    const input = await harness(() => [40, 40, 40], () => [40, 40, 40], narrowMask);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "METRIC_UNDEFINED" });
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects alpha-bearing images instead of silently flattening them", async () => {
    const input = await harness(() => [20, 20, 20], () => [20, 20, 20]);
    await rm(input.candidatePath);
    await writeRgbPng(input.candidatePath, 96, 64, () => [20, 20, 20], true);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects tampered evaluator material before computing a result", async () => {
    const input = await harness(() => [20, 20, 20], () => [20, 20, 20]);
    const configurationPath = resolve(input.packDirectory, GRAND_HALL_PROTECTED_METRICS_CONFIGURATION_FILENAME);
    const parsed = JSON.parse((await readFile(configurationPath)).toString("utf8")) as Record<string, unknown>;
    parsed.authority = "execution";
    await writeFile(configurationPath, `${JSON.stringify(parsed)}\n`);
    await expect(evaluate(input)).rejects.toMatchObject({ code: "MATERIAL_INVALID" });
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects LPIPS implementation pathname replacement before runtime verification or bootstrap", async () => {
    const input = await harness(() => [0, 0, 0], () => [255, 255, 255]);
    let implementationPath = "";
    let backupPath = "";
    try {
      await expect(evaluateGrandHallProtectedRegionMetrics({
        sourcePath: input.sourcePath, candidatePath: input.candidatePath, protectedMaskPath: input.maskPath,
        evaluatorPackDirectory: input.packDirectory, outputPath: input.resultPath,
        beforeLpipsImplementationBootstrapTestHook: async (path) => {
          implementationPath = path;
          backupPath = `${path}.protected-metrics-test-backup`;
          await rename(path, backupPath);
          await writeFile(path, "raise RuntimeError('foreign')\n", { flag: "wx" });
        },
      })).rejects.toMatchObject({ code: "INPUT_RACE" });
    } finally {
      if (implementationPath !== "" && backupPath !== "") {
        await rm(implementationPath, { force: true });
        await rename(backupPath, implementationPath);
      }
    }
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a current LPIPS implementation whose bytes differ from the verified manifest member", async () => {
    const input = await harness(() => [0, 0, 0], () => [255, 255, 255]);
    const implementationPath = resolve(import.meta.dirname, "..", "grand-hall-protected-region-lpips.py");
    const backupPath = `${implementationPath}.protected-metrics-test-backup`;
    await rename(implementationPath, backupPath);
    await writeFile(implementationPath, "raise RuntimeError('foreign')\n", { flag: "wx" });
    try {
      await expect(evaluate(input)).rejects.toMatchObject({ code: "MATERIAL_INVALID" });
    } finally {
      await rm(implementationPath, { force: true });
      await rename(backupPath, implementationPath);
    }
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never overwrites an existing result path", async () => {
    const input = await harness(() => [20, 20, 20], () => [20, 20, 20]);
    await writeFile(input.resultPath, "foreign", { flag: "wx" });
    await expect(evaluate(input)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    await expect(readFile(input.resultPath, "utf8")).resolves.toBe("foreign");
  });

  it("rejects replacement of the originally captured result parent and preserves the foreign replacement", async () => {
    const input = await harness(() => [0, 0, 0], () => [0, 0, 0]);
    const displacedOriginal = `${input.root}.original`;
    roots.push(displacedOriginal);
    let foreignPath = "";
    const expectedParentIdentity = await captureGrandHallProtectedMetricsOutputParentIdentity(input.resultPath);
    await expect(publishGrandHallProtectedMetricsResultCreateOnly({
      outputPath: input.resultPath,
      bytes: Buffer.from("{}\n", "utf8"),
      expectedParentIdentity,
      beforePublishTestHook: async (stagingPath) => {
        await rename(input.root, displacedOriginal);
        await mkdir(input.root);
        foreignPath = stagingPath;
        await writeFile(foreignPath, "foreign", { flag: "wx" });
      },
    })).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(readFile(foreignPath, "utf8")).resolves.toBe("foreign");
    await expect(stat(input.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never overwrites a foreign result claimed immediately before atomic publication", async () => {
    const input = await harness(() => [0, 0, 0], () => [0, 0, 0]);
    const expectedParentIdentity = await captureGrandHallProtectedMetricsOutputParentIdentity(input.resultPath);
    await expect(publishGrandHallProtectedMetricsResultCreateOnly({
      outputPath: input.resultPath,
      bytes: Buffer.from("{}\n", "utf8"),
      expectedParentIdentity,
      beforePublishTestHook: async () => { await writeFile(input.resultPath, "foreign", { flag: "wx" }); },
    })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    await expect(readFile(input.resultPath, "utf8")).resolves.toBe("foreign");
  });

  it("parses only the closed CLI surface", () => {
    expect(parseGrandHallProtectedRegionMetricsArguments([
      "evaluate",
      "--source", "C:\\source.png",
      "--candidate", "C:\\candidate.png",
      "--protected-mask", "C:\\mask.png",
      "--evaluator-pack", "C:\\pack",
      "--output", "C:\\result.json",
    ])).toMatchObject({ command: "evaluate", sourcePath: "C:\\source.png" });
    expect(() => parseGrandHallProtectedRegionMetricsArguments([
      "materialize", "--output-dir", "C:\\pack", "--output-dir", "C:\\other",
    ])).toThrow(GrandHallProtectedRegionMetricsError);
    expect(() => parseGrandHallProtectedRegionMetricsArguments([
      "evaluate", "--source", "C:\\source.png", "--surprise", "true",
    ])).toThrow(/Unknown option/u);
  });
});

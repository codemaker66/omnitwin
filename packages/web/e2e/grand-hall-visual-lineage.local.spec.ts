import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  constants as fileSystemConstants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  VisualLineageBenchmarkV0Schema,
  type VisualLineageActualCameraV0,
  type VisualLineageActualRendererV0,
  type VisualLineageFixtureSettingsV0,
  type VisualLineagePlyMeshRuntimeStateV0,
  type VisualLineageSparkRuntimeStateV0,
  type VisualLineageSourceMemberV0,
} from "@omnitwin/types";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  GRAND_HALL_CAPTURED_SOURCE,
} from "../src/lib/grand-hall-captured-source.js";
import {
  classifyWebGlRenderer,
  GRAND_HALL_CAPTURED_SPZ_MEMBERS,
  GRAND_HALL_LINEAGE_CAMERA,
  GRAND_HALL_LINEAGE_INITIAL_BENCHMARK,
  GRAND_HALL_PLY_RENDERER_SETTINGS,
  GRAND_HALL_PLY_SOURCE_MEMBER,
  grandHallLineageCameraMatches,
  grandHallLineageFixturePath,
  grandHallPlyLineageFixturePath,
} from "../src/lib/grand-hall-visual-lineage.js";
import {
  GRAND_HALL_DIFIX_CAPTURE_MODE,
  deriveGrandHallLineageCaptureProfile,
  grandHallCaptureEvidenceLimitation,
  requireDifixCapturePaths,
} from "./grand-hall-visual-lineage-capture-mode.js";
import {
  GRAND_HALL_LINEAGE_SOURCE_PATHSPEC,
  grandHallLineageSourceStateSha256,
} from "./grand-hall-visual-lineage-source-state.js";

const SOURCE_ROOT = process.env["GRAND_HALL_LINEAGE_ROOT"];
const EVIDENCE_DIR = process.env["GRAND_HALL_LINEAGE_EVIDENCE_DIR"];
const ENABLED = SOURCE_ROOT !== undefined && EVIDENCE_DIR !== undefined;
const BOUND_SOURCE_BASE_URL = "http://grand-hall-lineage.local/";
const REQUESTED_CAPTURE_MODE = process.env["GRAND_HALL_LINEAGE_CAPTURE_MODE"];

function boundedFrameCount(
  raw: string | undefined,
  fallback: number,
  allowZero: boolean,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= 600 ? parsed : fallback;
}

function boundedTimeoutMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 60_000 && parsed <= 14_400_000
    ? parsed
    : 7_200_000;
}

const REQUESTED_DIFIX_MODE = REQUESTED_CAPTURE_MODE === GRAND_HALL_DIFIX_CAPTURE_MODE;
const DEFAULT_WARMUP_FRAME_COUNT = REQUESTED_DIFIX_MODE
  ? 120
  : boundedFrameCount(process.env["GRAND_HALL_LINEAGE_WARMUP_FRAMES"], 120, true);
const DEFAULT_FRAME_SAMPLE_COUNT = REQUESTED_DIFIX_MODE
  ? 600
  : boundedFrameCount(process.env["GRAND_HALL_LINEAGE_FRAME_SAMPLES"], 600, false);
const CAPTURE_PROFILE = deriveGrandHallLineageCaptureProfile(
  REQUESTED_CAPTURE_MODE,
  DEFAULT_WARMUP_FRAME_COUNT,
  DEFAULT_FRAME_SAMPLE_COUNT,
);
requireDifixCapturePaths(CAPTURE_PROFILE, SOURCE_ROOT, EVIDENCE_DIR);
const DIFIX_NO_REFERENCE_CAPTURE_ENABLED = CAPTURE_PROFILE.difixNoReference;
const CAPTURE_VIEWPORT = CAPTURE_PROFILE.viewport;
const WARMUP_FRAME_COUNT = CAPTURE_PROFILE.warmupFrameCount;
const FRAME_SAMPLE_COUNT = CAPTURE_PROFILE.frameSampleCount;
const TEST_TIMEOUT_MS = boundedTimeoutMs(process.env["GRAND_HALL_LINEAGE_TEST_TIMEOUT_MS"]);

interface FixtureBridgeSnapshot {
  readonly status: "loading" | "loaded" | "error";
  readonly startedAtMs: number;
  readonly results: readonly {
    readonly url: string;
    readonly ok: boolean;
    readonly splatCount?: number;
    readonly bounds?: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    } | null;
    readonly elapsedMs: number;
    readonly error?: string;
  }[];
  readonly settings?: VisualLineageFixtureSettingsV0;
  readonly actualCamera?: VisualLineageActualCameraV0;
  readonly actualRenderer?: VisualLineageActualRendererV0;
  readonly renderedFrameCount: number;
  readonly sparkRuntimeState?: VisualLineageSparkRuntimeStateV0;
  readonly plyMeshRuntimeState?: VisualLineagePlyMeshRuntimeStateV0;
}

interface FrameSummary {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return `sha256:${hash.digest("hex")}`;
}

async function assertPathAbsent(filePath: string): Promise<void> {
  try {
    await lstat(filePath);
  } catch (error: unknown) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) return;
    throw error;
  }
  throw new Error(`Difix capture output already exists and will not be replaced: ${filePath}`);
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index] ?? 0;
}

function summarizeFrames(samples: readonly number[]): FrameSummary {
  const sorted = [...samples].sort((left: number, right: number) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1) ?? 0,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fixtureBridge(
  page: Page,
  evaluationTimeoutMs = 600_000,
): Promise<FixtureBridgeSnapshot | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(() => {
        const target = window as Window & { __splatFixture?: FixtureBridgeSnapshot };
        return target.__splatFixture ?? null;
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(
            `Grand Hall fixture bridge did not respond within ${String(evaluationTimeoutMs)} ms.`,
          ));
        }, evaluationTimeoutMs);
      }),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /Execution context was destroyed|most likely because of a navigation|Cannot find context/i.test(
        message,
      )
    ) {
      return null;
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function waitForLoadedFixture(page: Page, timeoutMs = 600_000): Promise<FixtureBridgeSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const bridge = await fixtureBridge(page, remainingMs);
    if (bridge?.status === "loaded") return bridge;
    if (bridge?.status === "error") {
      const failures = bridge.results
        .filter((result) => !result.ok)
        .map((result) => result.error ?? result.url)
        .join("; ");
      throw new Error(`Grand Hall fixture failed to load: ${failures}`);
    }
    await delay(250);
  }
  throw new Error(`Grand Hall fixture did not load within ${String(timeoutMs)} ms.`);
}

async function renderFixtureFrames(page: Page, count: number): Promise<readonly number[]> {
  const frameDurations: number[] = [];
  let previousFrameCount = (await fixtureBridge(page))?.renderedFrameCount ?? 0;
  for (let index = 0; index < count; index += 1) {
    const startedAt = Date.now();
    await page.evaluate(() => {
      const target = window as Window & { __splatFixtureRequestRender?: () => void };
      if (target.__splatFixtureRequestRender === undefined) {
        throw new Error("Grand Hall fixture render control is unavailable.");
      }
      target.__splatFixtureRequestRender();
    });

    const deadline = startedAt + 240_000;
    let observed = false;
    while (Date.now() < deadline) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const bridge = await fixtureBridge(page, remainingMs);
      if (bridge?.status === "error") {
        throw new Error("Grand Hall fixture entered an error state while rendering.");
      }
      if ((bridge?.renderedFrameCount ?? 0) > previousFrameCount) {
        previousFrameCount = bridge?.renderedFrameCount ?? previousFrameCount;
        frameDurations.push(Date.now() - startedAt);
        observed = true;
        break;
      }
      await delay(50);
    }
    if (!observed) {
      throw new Error(`Grand Hall fixture did not complete rendered frame ${String(index + 1)} within 240000 ms.`);
    }
  }
  return frameDurations;
}

async function waitForStableVisibleFixture(
  page: Page,
  timeoutMs = 600_000,
): Promise<FixtureBridgeSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bridge = await fixtureBridge(page, Math.max(1, deadline - Date.now()));
    const renderer = bridge?.sparkRuntimeState;
    if (
      bridge?.status === "loaded"
      && renderer !== undefined
      && renderer.activeSplats > 0
      && !renderer.sorting
      && !renderer.sortDirty
      && !renderer.dirty
    ) {
      return bridge;
    }
    await renderFixtureFrames(page, 1);
    await delay(50);
  }
  throw new Error(`Grand Hall fixture did not reach a visible settled Spark state within ${String(timeoutMs)} ms.`);
}

function pngDimensions(bytes: Buffer): { readonly width: number; readonly height: number } {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Lineage screenshot is not a valid PNG header.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

interface PixelCoverage {
  readonly backgroundRgb: readonly [number, number, number];
  readonly nonBackgroundPixelCount: number;
  readonly nonBackgroundPixelRatio: number;
}

async function analyzePngPixels(page: Page, bytes: Buffer): Promise<PixelCoverage> {
  return page.evaluate(async (base64Png) => {
    const backgroundRgb = [16, 18, 23] as const;
    const response = await fetch(`data:image/png;base64,${base64Png}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Could not create the screenshot pixel-analysis context.");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBackgroundPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      if (
        Math.abs(red - backgroundRgb[0]) > 6
        || Math.abs(green - backgroundRgb[1]) > 6
        || Math.abs(blue - backgroundRgb[2]) > 6
      ) {
        nonBackgroundPixelCount += 1;
      }
    }
    return {
      backgroundRgb,
      nonBackgroundPixelCount,
      nonBackgroundPixelRatio: nonBackgroundPixelCount / (canvas.width * canvas.height),
    };
  }, bytes.toString("base64"));
}

function sourceVariant(format: "sog" | "spz"): string {
  return format === "sog" ? "scans_BIG_MODEL_TH_GH_1" : "scans_BIG_MODEL_TH_GH_4";
}

interface BoundSourceMember {
  readonly receipt: VisualLineageSourceMemberV0;
  readonly bytes: Buffer;
  readonly url: string;
  readonly expectedSplatCount?: number;
}

interface BoundPlySource {
  readonly receipt: VisualLineageSourceMemberV0;
  readonly url: string;
  readonly requestCount: () => number;
}

async function bindPlySource(page: Page, sourceRoot: string): Promise<BoundPlySource> {
  const absolutePath = path.join(sourceRoot, GRAND_HALL_PLY_SOURCE_MEMBER.relativePath);
  const bytes = await readFile(absolutePath);
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (
    bytes.byteLength !== GRAND_HALL_PLY_SOURCE_MEMBER.sizeBytes
    || sha256 !== GRAND_HALL_PLY_SOURCE_MEMBER.sha256
  ) {
    throw new Error("Pinned Grand Hall PLY source receipt mismatch.");
  }
  const normalizedRelativePath = GRAND_HALL_PLY_SOURCE_MEMBER.relativePath.replaceAll("\\", "/");
  const url = new URL(normalizedRelativePath, BOUND_SOURCE_BASE_URL).toString();
  let requests = 0;
  await page.route(`${BOUND_SOURCE_BASE_URL}**`, async (route) => {
    if (route.request().url() !== url) {
      await route.abort("blockedbyclient");
      return;
    }
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
      body: bytes,
    });
  });
  return {
    receipt: {
      relativePath: normalizedRelativePath,
      sizeBytes: bytes.byteLength,
      sha256,
    },
    url,
    requestCount: () => requests,
  };
}

async function bindSourceMembers(
  page: Page,
  sourceRoot: string,
  format: "sog" | "spz",
): Promise<readonly BoundSourceMember[]> {
  const variant = sourceVariant(format);
  const expectedMembers = format === "sog"
    ? GRAND_HALL_CAPTURED_SOG_MEMBERS
    : GRAND_HALL_CAPTURED_SPZ_MEMBERS;
  const boundMembers: BoundSourceMember[] = [];
  for (const member of expectedMembers) {
    const fileName = member.fileName;
    const relativePath = path.join(variant, "lcc2-result", "data", "3dgs", fileName);
    const normalizedRelativePath = relativePath.replaceAll("\\", "/");
    const absolutePath = path.join(sourceRoot, relativePath);
    const bytes = await readFile(absolutePath);
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength !== member.sizeBytes || sha256 !== `sha256:${member.sha256}`) {
      throw new Error(`Pinned ${format.toUpperCase()} member receipt mismatch: ${member.fileName}`);
    }
    boundMembers.push({
      receipt: { relativePath: normalizedRelativePath, sizeBytes: bytes.byteLength, sha256 },
      bytes,
      url: new URL(normalizedRelativePath, BOUND_SOURCE_BASE_URL).toString(),
      expectedSplatCount: member.gaussianCount,
    });
  }

  const sourcesByUrl = new Map(boundMembers.map((member) => [member.url, member.bytes]));
  await page.route(`${BOUND_SOURCE_BASE_URL}**`, async (route) => {
    const sourceBytes = sourcesByUrl.get(route.request().url());
    if (sourceBytes === undefined) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
      body: sourceBytes,
    });
  });
  return boundMembers;
}

interface GitIdentity {
  readonly sha: string;
  readonly dirty: boolean;
  readonly sourceStateSha256: string;
}

async function filesBelow(root: string, relativeRoot = ""): Promise<readonly string[]> {
  const directory = path.join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function gitIdentity(): Promise<GitIdentity> {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const statusPathspec = [
    "--",
    ".",
    ":(exclude)docs/evidence/grand-hall-lineage/**",
    ":(exclude)packages/web/test-results/**",
    ":(exclude)packages/web/playwright-report/**",
  ];
  const sourcePathspec = GRAND_HALL_LINEAGE_SOURCE_PATHSPEC;
  const gitOptions = { cwd: repoRoot, encoding: "utf8" } as const;
  const sha = execFileSync("git", ["rev-parse", "HEAD"], gitOptions).trim();
  const status = execFileSync("git", ["--no-optional-locks", "status", "--porcelain=v1", ...statusPathspec], {
    ...gitOptions,
  });
  const trackedInputs = execFileSync(
    "git",
    ["ls-files", "-z", ...sourcePathspec],
    { ...gitOptions, maxBuffer: 16 * 1024 * 1024 },
  ).split("\0").filter((entry) => entry !== "");
  if (trackedInputs.length === 0) {
    throw new Error("Grand Hall lineage source-state pathspec resolved no tracked inputs.");
  }
  const trackedDiff = execFileSync("git", ["diff", "--binary", "HEAD", ...sourcePathspec], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  });
  const untrackedOutput = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", ...sourcePathspec],
    { ...gitOptions, maxBuffer: 16 * 1024 * 1024 },
  );
  const untrackedFiles = untrackedOutput.split("\0").filter((entry) => entry !== "").sort();
  const untrackedStateFiles = await Promise.all(untrackedFiles.map(async (relativePath) => ({
    relativePath,
    bytes: await readFile(path.resolve(repoRoot, relativePath)),
  })));
  const typesRuntimeRoot = path.resolve(repoRoot, "packages/types/dist");
  const typesRuntimeFiles = await filesBelow(typesRuntimeRoot);
  if (typesRuntimeFiles.length === 0) {
    throw new Error("Grand Hall lineage requires a built @omnitwin/types runtime.");
  }
  const runtimeStateFiles = await Promise.all(typesRuntimeFiles.map(async (relativePath) => ({
    relativePath: `packages/types/dist/${relativePath.replaceAll("\\", "/")}`,
    bytes: await readFile(path.join(typesRuntimeRoot, relativePath)),
  })));
  return {
    sha,
    dirty: status.trim().length > 0,
    sourceStateSha256: grandHallLineageSourceStateSha256({
      trackedDiff,
      untrackedFiles: untrackedStateFiles,
      runtimeFiles: runtimeStateFiles,
    }),
  };
}

test.describe("Grand Hall local fixed-camera visual lineage", () => {
  test.skip(!ENABLED, "Set GRAND_HALL_LINEAGE_ROOT and GRAND_HALL_LINEAGE_EVIDENCE_DIR.");
  test.describe.configure({ mode: "serial" });

  for (const format of ["sog", "spz"] as const) {
    test(`${format.toUpperCase()} exact-frontier names at the source-pose interior camera`, async ({ page }) => {
      test.skip(
        DIFIX_NO_REFERENCE_CAPTURE_ENABLED && format !== "sog",
        "The explicit Difix no-reference input capture is SOG-only.",
      );
      test.setTimeout(TEST_TIMEOUT_MS);
      if (SOURCE_ROOT === undefined || EVIDENCE_DIR === undefined) return;
      await mkdir(EVIDENCE_DIR, { recursive: true });
      const sampleLabel = DIFIX_NO_REFERENCE_CAPTURE_ENABLED
        ? GRAND_HALL_DIFIX_CAPTURE_MODE
        : WARMUP_FRAME_COUNT >= 120 && FRAME_SAMPLE_COUNT >= 600
          ? `diagnostic-controlled-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`
          : `diagnostic-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`;
      const artifactStem = `grand-hall-${format}-${GRAND_HALL_LINEAGE_CAMERA.id}-${sampleLabel}`;
      const screenshotPath = path.join(EVIDENCE_DIR, `${artifactStem}.png`);
      const recordPath = path.join(EVIDENCE_DIR, `${artifactStem}.json`);
      const temporaryNonce = DIFIX_NO_REFERENCE_CAPTURE_ENABLED
        ? randomUUID()
        : String(process.pid);
      const screenshotTempPath = path.join(
        EVIDENCE_DIR,
        `.tmp-${temporaryNonce}-grand-hall-${format}-${sampleLabel}.png`,
      );
      const recordTempPath = path.join(
        EVIDENCE_DIR,
        `.tmp-${temporaryNonce}-grand-hall-${format}-${sampleLabel}.json`,
      );
      if (CAPTURE_PROFILE.publication === "create_exclusive") {
        await Promise.all([
          assertPathAbsent(screenshotPath),
          assertPathAbsent(recordPath),
          assertPathAbsent(screenshotTempPath),
          assertPathAbsent(recordTempPath),
        ]);
      } else {
        await Promise.all([
          rm(screenshotPath, { force: true }),
          rm(recordPath, { force: true }),
          rm(screenshotTempPath, { force: true }),
          rm(recordTempPath, { force: true }),
        ]);
      }
      const gitAtStart = await gitIdentity();
      await page.setViewportSize(CAPTURE_VIEWPORT);
      const boundMembers = await bindSourceMembers(page, SOURCE_ROOT, format);
      const fixturePath = grandHallLineageFixturePath(format, BOUND_SOURCE_BASE_URL);
      const startedAt = Date.now();
      const runStartedAt = new Date(startedAt).toISOString();
      await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
      let bridge = await waitForLoadedFixture(page);
      if (bridge.actualCamera === undefined || bridge.settings === undefined) {
        throw new Error("Loaded lineage fixture did not expose its camera and renderer settings.");
      }
      expect(bridge.results).toHaveLength(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
      expect(bridge.results.every((result) => result.ok)).toBe(true);
      expect(bridge.results.map((result) => result.url).sort()).toEqual(
        boundMembers.map((member) => member.url).sort(),
      );
      const resultsByUrl = new Map(bridge.results.map((result) => [result.url, result]));
      for (const member of boundMembers) {
        expect(resultsByUrl.get(member.url)?.splatCount).toBe(member.expectedSplatCount);
      }
      const decodedSplatCount = bridge.results.reduce(
        (sum, entry) => sum + (entry.splatCount ?? 0),
        0,
      );
      expect(decodedSplatCount).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
      if (!grandHallLineageCameraMatches(bridge.actualCamera)) {
        throw new Error(`Grand Hall fixture camera deviated from its complete fixed-camera contract: ${JSON.stringify(bridge.actualCamera)}`);
      }

      bridge = await waitForStableVisibleFixture(page);
      expect(bridge.sparkRuntimeState?.sortRadial).toBe(false);
      expect(bridge.sparkRuntimeState?.activeSplats).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
      const stableAtMs = Date.now() - startedAt;
      await renderFixtureFrames(page, WARMUP_FRAME_COUNT);
      const frames = summarizeFrames(await renderFixtureFrames(page, FRAME_SAMPLE_COUNT));
      bridge = await fixtureBridge(page) ?? bridge;
      if (
        bridge.status !== "loaded"
        || bridge.actualCamera === undefined
        || bridge.actualRenderer === undefined
        || bridge.sparkRuntimeState === undefined
      ) {
        throw new Error("Final lineage frame did not expose complete post-render runtime state.");
      }
      const environment = await page.locator("canvas").evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Lineage target is not a canvas.");
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (gl === null) throw new Error("WebGL context unavailable after lineage render.");
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          browser: navigator.userAgent,
          operatingSystem: navigator.userAgent,
          webglVendor: debug === null ? String(gl.getParameter(gl.VENDOR)) : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
          webglRenderer: debug === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
          webglVersion: String(gl.getParameter(gl.VERSION)),
          contextLost: gl.isContextLost(),
          contextAntialias: gl.getContextAttributes()?.antialias ?? null,
          devicePixelRatio: window.devicePixelRatio,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };
      });
      expect(environment.contextAntialias).toBe(false);
      expect(environment.devicePixelRatio).toBeCloseTo(1, 6);
      expect(environment.contextLost).toBe(false);
      expect(environment.canvasWidth).toBe(CAPTURE_VIEWPORT.width);
      expect(environment.canvasHeight).toBe(CAPTURE_VIEWPORT.height);
      const rendererClass = classifyWebGlRenderer(
        environment.webglVendor,
        environment.webglRenderer,
      );
      if (rendererClass !== "hardware") {
        throw new Error(
          `Grand Hall lineage requires explicit hardware WebGL evidence; classified ${rendererClass}: ${environment.webglVendor} / ${environment.webglRenderer}`,
        );
      }

      await page.locator("canvas").screenshot({ path: screenshotTempPath });
      const screenshotStat = await stat(screenshotTempPath);
      const screenshotBytes = await readFile(screenshotTempPath);
      const screenshotDimensions = pngDimensions(screenshotBytes);
      if (
        screenshotDimensions.width !== environment.canvasWidth
        || screenshotDimensions.height !== environment.canvasHeight
      ) {
        await rm(screenshotTempPath, { force: true });
        throw new Error("Lineage PNG dimensions do not match the rendered canvas backing buffer.");
      }
      const pixelCoverage = await analyzePngPixels(page, screenshotBytes);
      if (pixelCoverage.nonBackgroundPixelRatio <= 0.001) {
        await rm(screenshotTempPath, { force: true });
        throw new Error(
          `Lineage PNG contains no material captured-pixel coverage above background. ${JSON.stringify({
            camera: bridge.actualCamera,
            bounds: bridge.results.map((result) => ({ url: result.url, bounds: result.bounds })),
          })}`,
        );
      }
      const screenshotSha256 = await hashFile(screenshotTempPath);
      const gitAtEnd = await gitIdentity();
      if (
        gitAtEnd.sha !== gitAtStart.sha
        || gitAtEnd.dirty !== gitAtStart.dirty
        || gitAtEnd.sourceStateSha256 !== gitAtStart.sourceStateSha256
      ) {
        await rm(screenshotTempPath, { force: true });
        throw new Error("Worktree source state changed during the lineage run; discarded its screenshot.");
      }

      const sourceMembers = boundMembers.map((member) => member.receipt);

      const result = {
        ...GRAND_HALL_LINEAGE_INITIAL_BENCHMARK,
        benchmarkId: DIFIX_NO_REFERENCE_CAPTURE_ENABLED
          ? "grand-hall-sog-source-pose-19890-difix-input-1024x576-v1"
          : `grand-hall-${format}-source-pose-local-${sampleLabel}-v1`,
        viewport: {
          width: CAPTURE_VIEWPORT.width,
          height: CAPTURE_VIEWPORT.height,
          devicePixelRatio: DIFIX_NO_REFERENCE_CAPTURE_ENABLED
            ? environment.devicePixelRatio
            : 1,
        },
        representations: [{
          id: format === "sog" ? "exact-sog-frontier" : "name-matched-spz-candidate",
          format,
          lineage: format === "sog"
            ? "Grand_Hall.lcc2 exact non-environment fine frontier"
            : "Grand_Hall.lcc2 hash-pinned non-environment SPZ fine frontier from the matching XGRIDS hierarchy",
          status: "diagnostic",
          visualAssessment: "not_reviewed",
          cameraRegistration: "inspection_only",
          rendererProfile: "diagnostic_resolved_defaults",
          sourceRefs: sourceMembers.map((member) => member.sha256),
          limitations: [
            "Local dev fixture run; not the authenticated package transport.",
            "The camera position is transformed from source pose 19890, but its horizontal look direction and FOV remain inspection-only and have not been matched to a source optical camera.",
            "The supplied LCC2 depth-sort convention is explicitly applied; the remaining Spark numeric values are inherited resolved defaults.",
            "The fixture records resolved Spark runtime values, but those inherited defaults were not supplied as a controlled explicit profile.",
            "Frame percentiles are demand-render request-to-observed-frame wall times, not GPU timer-query measurements.",
            "The non-background pixel gate proves render presence only; it does not establish completeness, fidelity, room identity, or visual acceptance.",
            ...(format === "spz"
              ? ["SOG and SPZ positions agree within the audited tolerance, but full attribute-level representation equivalence has not been established."]
              : []),
            ...(WARMUP_FRAME_COUNT < 120 || FRAME_SAMPLE_COUNT < 600
              ? [`Diagnostic ${String(WARMUP_FRAME_COUNT)}-warm-up/${String(FRAME_SAMPLE_COUNT)}-timed-frame sample; below the controlled 120-warm-up/600-timed-frame profile.`]
              : []),
            ...(DIFIX_NO_REFERENCE_CAPTURE_ENABLED
              ? [
                  "Direct 1024x576 canvas capture for a non-reference Difix diagnostic input; no resize, provider execution, truth replacement, runtime authority, or promotion is granted.",
                  grandHallCaptureEvidenceLimitation(environment),
                ]
              : []),
          ],
          screenshot: {
            path: screenshotPath,
            sha256: screenshotSha256,
            sizeBytes: screenshotStat.size,
            width: screenshotDimensions.width,
            height: screenshotDimensions.height,
            backgroundRgb: pixelCoverage.backgroundRgb,
            nonBackgroundPixelCount: pixelCoverage.nonBackgroundPixelCount,
            nonBackgroundPixelRatio: pixelCoverage.nonBackgroundPixelRatio,
          },
          timings: {
            loadMs: Math.max(...bridge.results.map((entry) => entry.elapsedMs)),
            stableMs: stableAtMs,
            frameP50Ms: frames.p50Ms,
            frameP95Ms: frames.p95Ms,
            frameP99Ms: frames.p99Ms,
          },
          environment: {
            browser: environment.browser,
            operatingSystem: environment.operatingSystem,
            webglVendor: environment.webglVendor,
            webglRenderer: environment.webglRenderer,
            webglVersion: environment.webglVersion,
            contextLost: environment.contextLost,
          },
          sourceMembers,
          decodedSplatCount,
          warmupFrameCount: WARMUP_FRAME_COUNT,
          frameSampleCount: FRAME_SAMPLE_COUNT,
          frameMaxMs: frames.maxMs,
          fixtureSettings: bridge.settings,
          sparkRuntimeState: bridge.sparkRuntimeState,
          actualCamera: bridge.actualCamera,
          actualRenderer: bridge.actualRenderer,
        }],
      };
      let validatedResult;
      try {
        validatedResult = VisualLineageBenchmarkV0Schema.parse({
          ...result,
          gitSha: gitAtStart.sha,
          worktreeDirty: gitAtStart.dirty,
          worktreeSourceStateSha256: gitAtStart.sourceStateSha256,
          runStartedAt,
          runCompletedAt: new Date().toISOString(),
        });
      } catch (error: unknown) {
        await rm(screenshotTempPath, { force: true });
        throw error;
      }
      await writeFile(
        recordTempPath,
        `${JSON.stringify(validatedResult, null, 2)}\n`,
        CAPTURE_PROFILE.publication === "create_exclusive"
          ? { encoding: "utf8", flag: "wx" }
          : { encoding: "utf8" },
      );
      if (CAPTURE_PROFILE.publication === "create_exclusive") {
        await copyFile(screenshotTempPath, screenshotPath, fileSystemConstants.COPYFILE_EXCL);
        await copyFile(recordTempPath, recordPath, fileSystemConstants.COPYFILE_EXCL);
        await Promise.all([
          rm(screenshotTempPath, { force: true }),
          rm(recordTempPath, { force: true }),
        ]);
      } else {
        await rename(screenshotTempPath, screenshotPath);
        await rename(recordTempPath, recordPath);
      }
    });
  }

  test("supplied PLY at the source-pose interior camera is structural evidence only", async ({ page }) => {
    test.skip(
      DIFIX_NO_REFERENCE_CAPTURE_ENABLED,
      "The explicit Difix no-reference input capture is SOG-only.",
    );
    test.setTimeout(TEST_TIMEOUT_MS);
    if (SOURCE_ROOT === undefined || EVIDENCE_DIR === undefined) return;
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const sampleLabel = WARMUP_FRAME_COUNT >= 120 && FRAME_SAMPLE_COUNT >= 600
      ? `structural-diagnostic-controlled-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`
      : `structural-diagnostic-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`;
    const artifactStem = `grand-hall-ply-${GRAND_HALL_LINEAGE_CAMERA.id}-${sampleLabel}`;
    const screenshotPath = path.join(EVIDENCE_DIR, `${artifactStem}.png`);
    const recordPath = path.join(EVIDENCE_DIR, `${artifactStem}.json`);
    const screenshotTempPath = path.join(EVIDENCE_DIR, `.tmp-${String(process.pid)}-${artifactStem}.png`);
    const recordTempPath = path.join(EVIDENCE_DIR, `.tmp-${String(process.pid)}-${artifactStem}.json`);
    await Promise.all([
      rm(screenshotPath, { force: true }),
      rm(recordPath, { force: true }),
      rm(screenshotTempPath, { force: true }),
      rm(recordTempPath, { force: true }),
    ]);

    const gitAtStart = await gitIdentity();
    await page.setViewportSize({ width: 1600, height: 900 });
    const boundSource = await bindPlySource(page, SOURCE_ROOT);
    const fixturePath = grandHallPlyLineageFixturePath(BOUND_SOURCE_BASE_URL);
    const startedAt = Date.now();
    const runStartedAt = new Date(startedAt).toISOString();
    await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
    let bridge = await waitForLoadedFixture(page);
    if (
      bridge.actualCamera === undefined
      || bridge.actualRenderer === undefined
      || bridge.settings === undefined
      || bridge.plyMeshRuntimeState === undefined
    ) {
      throw new Error("Loaded PLY fixture did not expose complete camera, renderer, settings, and geometry evidence.");
    }
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ url: boundSource.url, ok: true });
    expect(boundSource.requestCount()).toBe(1);
    expect(bridge.sparkRuntimeState).toBeUndefined();
    if (!grandHallLineageCameraMatches(bridge.actualCamera)) {
      throw new Error(`Grand Hall PLY camera deviated from its complete fixed-camera contract: ${JSON.stringify(bridge.actualCamera)}`);
    }

    const runtime = bridge.plyMeshRuntimeState;
    expect(runtime.sourceSizeBytes).toBe(GRAND_HALL_PLY_SOURCE_MEMBER.sizeBytes);
    expect(runtime.sourceSha256).toBe(GRAND_HALL_PLY_SOURCE_MEMBER.sha256);
    expect(runtime.header).toMatchObject({ vertexCount: 34_040, faceCount: 59_763 });
    expect(runtime.geometry).toMatchObject({
      indexed: true,
      positionCount: 34_040,
      positionItemSize: 3,
      positionArrayType: "Float32Array",
      indexCount: 179_289,
      indexArrayType: "Uint16Array",
      triangleCount: 59_763,
      degenerateTriangleCount: 174,
      nonFinitePositionScalarCount: 0,
      outOfRangeIndexCount: 0,
      sourceAttributes: ["position"],
      derivedAttributes: ["normal"],
      localBounds: {
        min: [-31.858928680419922, -23.6622371673584, -6.327584743499756],
        max: [3.825000047683716, 4.925000190734863, 8.617471694946289],
      },
    });
    expect(runtime.material).toEqual({
      type: "MeshNormalMaterial",
      side: "FrontSide",
      flatShading: true,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    expect(runtime.provenance).toEqual({
      truthClass: "RECONSTRUCTED",
      byteTreatment: "source_bytes_unchanged",
      geometryRole: "structural_evidence_only",
      appearanceRole: "deterministic_debug_visualization_not_source_appearance",
      registrationAuthority: "inspection_only",
    });

    const stableAtMs = Date.now() - startedAt;
    await renderFixtureFrames(page, WARMUP_FRAME_COUNT);
    const frames = summarizeFrames(await renderFixtureFrames(page, FRAME_SAMPLE_COUNT));
    bridge = await fixtureBridge(page) ?? bridge;
    if (
      bridge.status !== "loaded"
      || bridge.actualCamera === undefined
      || bridge.actualRenderer === undefined
      || bridge.settings === undefined
      || bridge.plyMeshRuntimeState === undefined
    ) {
      throw new Error("Final PLY lineage frame did not expose complete post-render evidence.");
    }

    const environment = await page.locator("canvas").evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Lineage target is not a canvas.");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl === null) throw new Error("WebGL context unavailable after PLY lineage render.");
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        browser: navigator.userAgent,
        operatingSystem: navigator.userAgent,
        webglVendor: debug === null ? String(gl.getParameter(gl.VENDOR)) : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
        webglRenderer: debug === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
        webglVersion: String(gl.getParameter(gl.VERSION)),
        contextLost: gl.isContextLost(),
        contextAntialias: gl.getContextAttributes()?.antialias ?? null,
        devicePixelRatio: window.devicePixelRatio,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      };
    });
    expect(environment.contextAntialias).toBe(false);
    expect(environment.devicePixelRatio).toBeCloseTo(1, 6);
    expect(environment.contextLost).toBe(false);
    expect(environment.canvasWidth).toBe(1600);
    expect(environment.canvasHeight).toBe(900);
    const rendererClass = classifyWebGlRenderer(environment.webglVendor, environment.webglRenderer);
    if (rendererClass !== "hardware") {
      throw new Error(
        `Grand Hall PLY lineage requires explicit hardware WebGL evidence; classified ${rendererClass}: ${environment.webglVendor} / ${environment.webglRenderer}`,
      );
    }

    await page.locator("canvas").screenshot({ path: screenshotTempPath });
    const screenshotStat = await stat(screenshotTempPath);
    const screenshotBytes = await readFile(screenshotTempPath);
    const screenshotDimensions = pngDimensions(screenshotBytes);
    if (
      screenshotDimensions.width !== environment.canvasWidth
      || screenshotDimensions.height !== environment.canvasHeight
    ) {
      await rm(screenshotTempPath, { force: true });
      throw new Error("PLY lineage PNG dimensions do not match the rendered canvas backing buffer.");
    }
    const pixelCoverage = await analyzePngPixels(page, screenshotBytes);
    if (pixelCoverage.nonBackgroundPixelRatio <= 0.001) {
      await rm(screenshotTempPath, { force: true });
      throw new Error("PLY lineage PNG contains no material structural coverage above background.");
    }
    const screenshotSha256 = await hashFile(screenshotTempPath);
    const gitAtEnd = await gitIdentity();
    if (
      gitAtEnd.sha !== gitAtStart.sha
      || gitAtEnd.dirty !== gitAtStart.dirty
      || gitAtEnd.sourceStateSha256 !== gitAtStart.sourceStateSha256
    ) {
      await rm(screenshotTempPath, { force: true });
      throw new Error("Worktree source state changed during the PLY lineage run; discarded its screenshot.");
    }

    const result = {
      ...GRAND_HALL_LINEAGE_INITIAL_BENCHMARK,
      benchmarkId: `grand-hall-ply-source-pose-local-${sampleLabel}-v1`,
      rendererSettings: GRAND_HALL_PLY_RENDERER_SETTINGS,
      representations: [{
        id: "supplied-ply-mesh",
        format: "ply_mesh",
        lineage: "Exact supplied reconstructed triangle PLY with deterministic computed-normal debug shading",
        status: "diagnostic",
        visualAssessment: "not_reviewed",
        cameraRegistration: "inspection_only",
        rendererProfile: "controlled_explicit",
        sourceRefs: [boundSource.receipt.sha256],
        limitations: [
          "Structural evidence only; this row is excluded from captured-radiance beauty ranking.",
          "The source contains positions and triangle indices only; displayed normal colours are deterministic derived debug appearance.",
          "The supplied mesh is rendered byte-complete and uncropped; its broad extent includes geometry outside the current Grand Hall visual frontier.",
          "Grand Hall boundary membership and room-interface decisions have not yet been human accepted for this mesh.",
          "The camera is the shared inspection camera, not a recovered optical camera.",
          ...(WARMUP_FRAME_COUNT < 120 || FRAME_SAMPLE_COUNT < 600
            ? [`Diagnostic ${String(WARMUP_FRAME_COUNT)}-warm-up/${String(FRAME_SAMPLE_COUNT)}-timed-frame sample; below the controlled 120-warm-up/600-timed-frame profile.`]
            : []),
        ],
        screenshot: {
          path: screenshotPath,
          sha256: screenshotSha256,
          sizeBytes: screenshotStat.size,
          width: screenshotDimensions.width,
          height: screenshotDimensions.height,
          backgroundRgb: pixelCoverage.backgroundRgb,
          nonBackgroundPixelCount: pixelCoverage.nonBackgroundPixelCount,
          nonBackgroundPixelRatio: pixelCoverage.nonBackgroundPixelRatio,
        },
        timings: {
          loadMs: bridge.results[0]?.elapsedMs ?? 0,
          stableMs: stableAtMs,
          frameP50Ms: frames.p50Ms,
          frameP95Ms: frames.p95Ms,
          frameP99Ms: frames.p99Ms,
        },
        environment: {
          browser: environment.browser,
          operatingSystem: environment.operatingSystem,
          webglVendor: environment.webglVendor,
          webglRenderer: environment.webglRenderer,
          webglVersion: environment.webglVersion,
          contextLost: environment.contextLost,
        },
        sourceMembers: [boundSource.receipt],
        warmupFrameCount: WARMUP_FRAME_COUNT,
        frameSampleCount: FRAME_SAMPLE_COUNT,
        frameMaxMs: frames.maxMs,
        fixtureSettings: bridge.settings,
        plyMeshRuntimeState: bridge.plyMeshRuntimeState,
        actualCamera: bridge.actualCamera,
        actualRenderer: bridge.actualRenderer,
      }],
    };
    let validatedResult;
    try {
      validatedResult = VisualLineageBenchmarkV0Schema.parse({
        ...result,
        gitSha: gitAtStart.sha,
        worktreeDirty: gitAtStart.dirty,
        worktreeSourceStateSha256: gitAtStart.sourceStateSha256,
        runStartedAt,
        runCompletedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      await rm(screenshotTempPath, { force: true });
      throw error;
    }
    await writeFile(recordTempPath, `${JSON.stringify(validatedResult, null, 2)}\n`, "utf8");
    await rename(screenshotTempPath, screenshotPath);
    await rename(recordTempPath, recordPath);
  });
});

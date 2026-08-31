import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
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
  GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS,
  grandHallBrowserSourceResidencyEvidence,
  grandHallVisibleFirstRequiresSourceNavigation,
  grandHallVisibleFirstRunLabel,
  parseGrandHallVisibleFirstRepresentation,
  type GrandHallVisibleFirstCaptureRun,
} from "./grand-hall-visual-lineage-bakeoff.js";
import {
  grandHallSharedCameraProfileEvidence,
  grandHallSharedCameraProfileMatchesActual,
  readGrandHallSharedCameraProfile,
  type GrandHallSharedCameraProfileBinding,
} from "./grand-hall-visual-lineage-camera-profile.js";
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
import {
  GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV,
  assertGrandHallBrowserVersionMatchesProfile,
  assertGrandHallHardwareEvidenceMatchesProfile,
  grandHallHardwarePreflightEvidenceMarker,
  parseGrandHallHardwareBrowserProfile,
  readGrandHallWebGlEvidence,
  type GrandHallHardwareBrowserProfileV1,
} from "./grand-hall-browser-hardware.js";

const SOURCE_ROOT = process.env["GRAND_HALL_LINEAGE_ROOT"];
const EVIDENCE_DIR = process.env["GRAND_HALL_LINEAGE_EVIDENCE_DIR"];
const ENABLED = SOURCE_ROOT !== undefined && EVIDENCE_DIR !== undefined;
const REQUESTED_CAPTURE_MODE = process.env["GRAND_HALL_LINEAGE_CAPTURE_MODE"];
const ORCHESTRATED_VISIBLE_FIRST = process.env["GRAND_HALL_LINEAGE_ORCHESTRATED"] === "1";
const SELECTED_REPRESENTATION = parseGrandHallVisibleFirstRepresentation(
  process.env["GRAND_HALL_LINEAGE_REPRESENTATION"],
);
const EXPECTED_GIT_SHA = process.env["GRAND_HALL_LINEAGE_EXPECTED_GIT_SHA"];
const EXPECTED_CAMERA_PROFILE_SHA256 =
  process.env["GRAND_HALL_LINEAGE_EXPECTED_CAMERA_PROFILE_SHA256"];
const HARDWARE_BROWSER_PROFILE_RAW =
  process.env[GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV];
const HARDWARE_BROWSER_PROFILE = HARDWARE_BROWSER_PROFILE_RAW === undefined
  ? undefined
  : parseGrandHallHardwareBrowserProfile(HARDWARE_BROWSER_PROFILE_RAW);
const HARDWARE_BROWSER_PROFILE_SHA256 = HARDWARE_BROWSER_PROFILE_RAW === undefined
  ? undefined
  : `sha256:${createHash("sha256").update(HARDWARE_BROWSER_PROFILE_RAW, "utf8").digest("hex")}`;

if (ORCHESTRATED_VISIBLE_FIRST && SELECTED_REPRESENTATION === undefined) {
  throw new Error(
    "The visible-first orchestrator must select exactly one GRAND_HALL_LINEAGE_REPRESENTATION.",
  );
}
if (ORCHESTRATED_VISIBLE_FIRST && REQUESTED_CAPTURE_MODE !== undefined) {
  throw new Error("The visible-first orchestrator cannot be combined with an alternate capture mode.");
}
if (
  ORCHESTRATED_VISIBLE_FIRST
  && (EXPECTED_GIT_SHA === undefined || !/^[a-f0-9]{40}$/u.test(EXPECTED_GIT_SHA))
) {
  throw new Error("The visible-first orchestrator requires a 40-character expected Git SHA.");
}
if (
  ORCHESTRATED_VISIBLE_FIRST
  && (
    EXPECTED_CAMERA_PROFILE_SHA256 === undefined
    || !/^sha256:[a-f0-9]{64}$/u.test(EXPECTED_CAMERA_PROFILE_SHA256)
  )
) {
  throw new Error("The visible-first orchestrator requires an expected shared-camera SHA-256.");
}
if (
  ORCHESTRATED_VISIBLE_FIRST
  && (HARDWARE_BROWSER_PROFILE === undefined || HARDWARE_BROWSER_PROFILE_SHA256 === undefined)
) {
  throw new Error("The visible-first orchestrator requires a validated hardware browser profile.");
}

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
const SINGLE_LEGACY_CAPTURE_RUN = GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS.slice(0, 1);
const CAPTURE_RUNS: readonly GrandHallVisibleFirstCaptureRun[] = ORCHESTRATED_VISIBLE_FIRST
  ? GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS
  : SINGLE_LEGACY_CAPTURE_RUN;

interface FixtureBridgeSnapshot {
  readonly runtimeInstanceId?: string;
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

interface BrowserHardwarePreflightBinding {
  readonly profile: GrandHallHardwareBrowserProfileV1;
  readonly marker: string;
}

async function browserHardwarePreflightBeforeSourceNavigation(
  page: Page,
  browserVersion: string,
): Promise<BrowserHardwarePreflightBinding | undefined> {
  if (!ORCHESTRATED_VISIBLE_FIRST) return undefined;
  if (HARDWARE_BROWSER_PROFILE === undefined || HARDWARE_BROWSER_PROFILE_SHA256 === undefined) {
    throw new Error("Orchestrated browser hardware preflight has no selected profile.");
  }
  const evidence = await readGrandHallWebGlEvidence(page);
  assertGrandHallBrowserVersionMatchesProfile(HARDWARE_BROWSER_PROFILE, browserVersion);
  assertGrandHallHardwareEvidenceMatchesProfile(HARDWARE_BROWSER_PROFILE, evidence);
  return {
    profile: HARDWARE_BROWSER_PROFILE,
    marker: grandHallHardwarePreflightEvidenceMarker({
      profileSha256: HARDWARE_BROWSER_PROFILE_SHA256,
      browserVersion,
    }),
  };
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
  readonly expectedSplatCount?: number;
}

interface BoundSourceServer {
  readonly baseUrl: string;
  readonly urlFor: (member: BoundSourceMember) => string;
  readonly totalRequestCount: () => number;
  readonly requestCountFor: (member: BoundSourceMember) => number;
  readonly close: () => Promise<void>;
}

async function readPlySource(sourceRoot: string): Promise<BoundSourceMember> {
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
  return {
    receipt: {
      relativePath: normalizedRelativePath,
      sizeBytes: bytes.byteLength,
      sha256,
    },
    bytes,
  };
}

async function readSourceMembers(
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
      expectedSplatCount: member.gaussianCount,
    });
  }

  return boundMembers;
}

function serverRequestPath(member: BoundSourceMember): string {
  return `/${member.receipt.relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function startBoundSourceServer(
  members: readonly BoundSourceMember[],
): Promise<BoundSourceServer> {
  const sourcesByPath = new Map(members.map((member) => [serverRequestPath(member), member]));
  const requestCounts = new Map<string, number>();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const member = sourcesByPath.get(requestUrl.pathname);
    if (request.method !== "GET" || member === undefined) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    requestCounts.set(
      member.receipt.relativePath,
      (requestCounts.get(member.receipt.relativePath) ?? 0) + 1,
    );
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(member.bytes.byteLength),
      "Content-Type": "application/octet-stream",
      ETag: `"${member.receipt.sha256}"`,
    });
    response.end(member.bytes);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeHttpServer(server);
    throw new Error("Grand Hall bound-source server did not expose a TCP address.");
  }
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${String(port)}/`;

  return {
    baseUrl,
    urlFor: (member) => new URL(serverRequestPath(member), baseUrl).toString(),
    totalRequestCount: () => [...requestCounts.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    requestCountFor: (member) => requestCounts.get(member.receipt.relativePath) ?? 0,
    close: () => closeHttpServer(server),
  };
}

interface GitIdentity {
  readonly sha: string;
  readonly dirty: boolean;
  readonly sourceStateSha256: string;
}

function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
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
  const repoRoot = repositoryRoot();
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

function assertOrchestratedGitIdentity(identity: GitIdentity): void {
  if (!ORCHESTRATED_VISIBLE_FIRST) return;
  if (identity.dirty) {
    throw new Error("The visible-first bake-off refuses a dirty source worktree.");
  }
  if (identity.sha !== EXPECTED_GIT_SHA) {
    throw new Error(
      `The visible-first bake-off expected HEAD ${String(EXPECTED_GIT_SHA)} but observed ${identity.sha}.`,
    );
  }
}

function assertOrchestratedCameraProfile(
  binding: GrandHallSharedCameraProfileBinding,
): void {
  if (!ORCHESTRATED_VISIBLE_FIRST) return;
  if (binding.sha256 !== EXPECTED_CAMERA_PROFILE_SHA256) {
    throw new Error(
      `The shared camera profile changed: expected ${String(EXPECTED_CAMERA_PROFILE_SHA256)}, observed ${binding.sha256}.`,
    );
  }
}

function assertSourceResidencyState(input: {
  readonly run: GrandHallVisibleFirstCaptureRun;
  readonly members: readonly BoundSourceMember[];
  readonly sourceServer: BoundSourceServer;
  readonly requestCountBefore: number;
  readonly requestCountAfter: number;
}): void {
  if (!ORCHESTRATED_VISIBLE_FIRST) return;
  if (input.run.residencyState === "cold_load") {
    expect(input.requestCountBefore).toBe(0);
  } else {
    expect(input.requestCountBefore).toBe(input.members.length);
  }
  expect(input.requestCountAfter).toBe(input.members.length);
  for (const member of input.members) {
    expect(input.sourceServer.requestCountFor(member)).toBe(1);
  }
}

test.describe("Grand Hall local fixed-camera visual lineage", () => {
  test.skip(!ENABLED, "Set GRAND_HALL_LINEAGE_ROOT and GRAND_HALL_LINEAGE_EVIDENCE_DIR.");
  test.describe.configure({ mode: "serial" });

  for (const format of ["sog", "spz"] as const) {
    test(`${format.toUpperCase()} exact-frontier names at the source-pose interior camera`, async ({ browser, page }) => {
      test.skip(
        SELECTED_REPRESENTATION !== undefined && SELECTED_REPRESENTATION !== format,
        `The orchestrator selected the ${String(SELECTED_REPRESENTATION)} representation.`,
      );
      test.skip(
        DIFIX_NO_REFERENCE_CAPTURE_ENABLED && format !== "sog",
        "The explicit Difix no-reference input capture is SOG-only.",
      );
      test.setTimeout(TEST_TIMEOUT_MS);
      if (SOURCE_ROOT === undefined || EVIDENCE_DIR === undefined) return;
      const browserPreflight = await browserHardwarePreflightBeforeSourceNavigation(
        page,
        browser.version(),
      );
      await mkdir(EVIDENCE_DIR, { recursive: true });
      const boundMembers = await readSourceMembers(SOURCE_ROOT, format);
      const sourceServer = await startBoundSourceServer(boundMembers);
      const cameraProfile = await readGrandHallSharedCameraProfile(repositoryRoot());
      assertOrchestratedCameraProfile(cameraProfile);
      await page.setViewportSize(CAPTURE_VIEWPORT);
      const fixturePath = grandHallLineageFixturePath(format, sourceServer.baseUrl);
      let residentFixtureUrl: string | undefined;
      let residentRuntimeInstanceId: string | undefined;
      try {
        for (const captureRun of CAPTURE_RUNS) {
          await test.step(grandHallVisibleFirstRunLabel(captureRun), async () => {
      const sampleLabel = DIFIX_NO_REFERENCE_CAPTURE_ENABLED
        ? GRAND_HALL_DIFIX_CAPTURE_MODE
        : WARMUP_FRAME_COUNT >= 120 && FRAME_SAMPLE_COUNT >= 600
          ? `diagnostic-controlled-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`
          : `diagnostic-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`;
      const runLabel = grandHallVisibleFirstRunLabel(captureRun);
      const artifactStem = ORCHESTRATED_VISIBLE_FIRST
        ? `grand-hall-${format}-${GRAND_HALL_LINEAGE_CAMERA.id}-${runLabel}-${sampleLabel}`
        : `grand-hall-${format}-${GRAND_HALL_LINEAGE_CAMERA.id}-${sampleLabel}`;
      const screenshotPath = path.join(EVIDENCE_DIR, `${artifactStem}.png`);
      const recordPath = path.join(EVIDENCE_DIR, `${artifactStem}.json`);
      const temporaryNonce = DIFIX_NO_REFERENCE_CAPTURE_ENABLED
        ? randomUUID()
        : `${String(process.pid)}-${String(captureRun.ordinal)}`;
      const screenshotTempPath = path.join(
        EVIDENCE_DIR,
        `.tmp-${temporaryNonce}-grand-hall-${format}-${sampleLabel}.png`,
      );
      const recordTempPath = path.join(
        EVIDENCE_DIR,
        `.tmp-${temporaryNonce}-grand-hall-${format}-${sampleLabel}.json`,
      );
      const createExclusive = ORCHESTRATED_VISIBLE_FIRST
        || CAPTURE_PROFILE.publication === "create_exclusive";
      if (createExclusive) {
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
      assertOrchestratedGitIdentity(gitAtStart);
      const sourceRequestCountBefore = sourceServer.totalRequestCount();
      const startedAt = Date.now();
      const runStartedAt = new Date(startedAt).toISOString();
      if (grandHallVisibleFirstRequiresSourceNavigation(captureRun)) {
        await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
        residentFixtureUrl = page.url();
      } else {
        expect(residentFixtureUrl).toBeDefined();
        expect(page.url()).toBe(residentFixtureUrl);
      }
      let bridge = await waitForLoadedFixture(page);
      if (
        bridge.actualCamera === undefined
        || bridge.settings === undefined
        || bridge.runtimeInstanceId === undefined
      ) {
        throw new Error(
          "Loaded lineage fixture did not expose its camera, renderer settings, and runtime identity.",
        );
      }
      residentRuntimeInstanceId ??= bridge.runtimeInstanceId;
      expect(bridge.runtimeInstanceId).toBe(residentRuntimeInstanceId);
      expect(bridge.results).toHaveLength(boundMembers.length);
      expect(bridge.results.every((result) => result.ok)).toBe(true);
      expect(bridge.results.map((result) => result.url).sort()).toEqual(
        boundMembers.map((member) => sourceServer.urlFor(member)).sort(),
      );
      const resultsByUrl = new Map(bridge.results.map((result) => [result.url, result]));
      for (const member of boundMembers) {
        expect(resultsByUrl.get(sourceServer.urlFor(member))?.splatCount).toBe(
          member.expectedSplatCount,
        );
      }
      const decodedSplatCount = bridge.results.reduce(
        (sum, entry) => sum + (entry.splatCount ?? 0),
        0,
      );
      expect(decodedSplatCount).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
      if (!grandHallLineageCameraMatches(bridge.actualCamera)) {
        throw new Error(`Grand Hall fixture camera deviated from its complete fixed-camera contract: ${JSON.stringify(bridge.actualCamera)}`);
      }
      if (!grandHallSharedCameraProfileMatchesActual(cameraProfile, bridge.actualCamera)) {
        throw new Error("Grand Hall fixture camera deviated from the shared native/browser profile.");
      }

      bridge = await waitForStableVisibleFixture(page);
      expect(bridge.sparkRuntimeState?.sortRadial).toBe(false);
      expect(bridge.sparkRuntimeState?.activeSplats).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
      expect(bridge.runtimeInstanceId).toBe(residentRuntimeInstanceId);
      const renderedFrameCountBefore = bridge.renderedFrameCount;
      const stableAtMs = Date.now() - startedAt;
      await renderFixtureFrames(page, WARMUP_FRAME_COUNT);
      const frames = summarizeFrames(await renderFixtureFrames(page, FRAME_SAMPLE_COUNT));
      bridge = await fixtureBridge(page) ?? bridge;
      if (
        bridge.status !== "loaded"
        || bridge.actualCamera === undefined
        || bridge.actualRenderer === undefined
        || bridge.sparkRuntimeState === undefined
        || bridge.runtimeInstanceId === undefined
      ) {
        throw new Error("Final lineage frame did not expose complete post-render runtime state.");
      }
      expect(bridge.runtimeInstanceId).toBe(residentRuntimeInstanceId);
      const renderedFrameCountAfter = bridge.renderedFrameCount;
      expect(renderedFrameCountAfter - renderedFrameCountBefore).toBeGreaterThanOrEqual(
        WARMUP_FRAME_COUNT + FRAME_SAMPLE_COUNT,
      );
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
      if (browserPreflight !== undefined) {
        assertGrandHallHardwareEvidenceMatchesProfile(browserPreflight.profile, {
          userAgent: environment.browser,
          webglVendor: environment.webglVendor,
          webglRenderer: environment.webglRenderer,
          webglVersion: environment.webglVersion,
          contextLost: environment.contextLost,
        });
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
      const sourceRequestCountAfter = sourceServer.totalRequestCount();
      try {
        assertSourceResidencyState({
          run: captureRun,
          members: boundMembers,
          sourceServer,
          requestCountBefore: sourceRequestCountBefore,
          requestCountAfter: sourceRequestCountAfter,
        });
      } catch (error: unknown) {
        await rm(screenshotTempPath, { force: true });
        throw error;
      }
      const screenshotSha256 = await hashFile(screenshotTempPath);
      const gitAtEnd = await gitIdentity();
      assertOrchestratedGitIdentity(gitAtEnd);
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
          : ORCHESTRATED_VISIBLE_FIRST
            ? `grand-hall-${format}-source-pose-local-${runLabel}-${sampleLabel}-v1`
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
            grandHallSharedCameraProfileEvidence(cameraProfile),
            ...(ORCHESTRATED_VISIBLE_FIRST
              ? [grandHallBrowserSourceResidencyEvidence({
                  representation: format,
                  run: captureRun,
                  sourceRequestCountBefore,
                  sourceRequestCountAfter,
                  runtimeInstanceId: bridge.runtimeInstanceId,
                  renderedFrameCountBefore,
                  renderedFrameCountAfter,
                })]
              : []),
            ...(captureRun.residencyState === "resident"
              ? [
                  "Resident capture reuses one live fixture runtime; no navigation, source fetch, decode, or scene attachment is performed. It measures long-lived decoded-runtime stability, not HTTP-cache reload performance.",
                ]
              : []),
            ...(browserPreflight === undefined ? [] : [browserPreflight.marker]),
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
            loadMs: captureRun.residencyState === "cold_load"
              ? Math.max(...bridge.results.map((entry) => entry.elapsedMs))
              : 0,
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
        createExclusive
          ? { encoding: "utf8", flag: "wx" }
          : { encoding: "utf8" },
      );
      if (createExclusive) {
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
      } finally {
        await sourceServer.close();
      }
    });
  }

  test("supplied PLY at the source-pose interior camera is structural evidence only", async ({ browser, page }) => {
    test.skip(
      SELECTED_REPRESENTATION !== undefined && SELECTED_REPRESENTATION !== "ply",
      `The orchestrator selected the ${String(SELECTED_REPRESENTATION)} representation.`,
    );
    test.skip(
      DIFIX_NO_REFERENCE_CAPTURE_ENABLED,
      "The explicit Difix no-reference input capture is SOG-only.",
    );
    test.setTimeout(TEST_TIMEOUT_MS);
    if (SOURCE_ROOT === undefined || EVIDENCE_DIR === undefined) return;
    const browserPreflight = await browserHardwarePreflightBeforeSourceNavigation(
      page,
      browser.version(),
    );
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const boundSource = await readPlySource(SOURCE_ROOT);
    const sourceServer = await startBoundSourceServer([boundSource]);
    const cameraProfile = await readGrandHallSharedCameraProfile(repositoryRoot());
    assertOrchestratedCameraProfile(cameraProfile);
    await page.setViewportSize({ width: 1600, height: 900 });
    const fixturePath = grandHallPlyLineageFixturePath(sourceServer.baseUrl);
    let residentFixtureUrl: string | undefined;
    let residentRuntimeInstanceId: string | undefined;
    try {
      for (const captureRun of CAPTURE_RUNS) {
        await test.step(grandHallVisibleFirstRunLabel(captureRun), async () => {
    const sampleLabel = WARMUP_FRAME_COUNT >= 120 && FRAME_SAMPLE_COUNT >= 600
      ? `structural-diagnostic-controlled-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`
      : `structural-diagnostic-${String(WARMUP_FRAME_COUNT)}w-${String(FRAME_SAMPLE_COUNT)}f`;
    const runLabel = grandHallVisibleFirstRunLabel(captureRun);
    const artifactStem = ORCHESTRATED_VISIBLE_FIRST
      ? `grand-hall-ply-${GRAND_HALL_LINEAGE_CAMERA.id}-${runLabel}-${sampleLabel}`
      : `grand-hall-ply-${GRAND_HALL_LINEAGE_CAMERA.id}-${sampleLabel}`;
    const screenshotPath = path.join(EVIDENCE_DIR, `${artifactStem}.png`);
    const recordPath = path.join(EVIDENCE_DIR, `${artifactStem}.json`);
    const temporaryNonce = `${String(process.pid)}-${String(captureRun.ordinal)}`;
    const screenshotTempPath = path.join(EVIDENCE_DIR, `.tmp-${temporaryNonce}-${artifactStem}.png`);
    const recordTempPath = path.join(EVIDENCE_DIR, `.tmp-${temporaryNonce}-${artifactStem}.json`);
    if (ORCHESTRATED_VISIBLE_FIRST) {
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
    assertOrchestratedGitIdentity(gitAtStart);
    const sourceRequestCountBefore = sourceServer.totalRequestCount();
    const startedAt = Date.now();
    const runStartedAt = new Date(startedAt).toISOString();
    if (grandHallVisibleFirstRequiresSourceNavigation(captureRun)) {
      await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
      residentFixtureUrl = page.url();
    } else {
      expect(residentFixtureUrl).toBeDefined();
      expect(page.url()).toBe(residentFixtureUrl);
    }
    let bridge = await waitForLoadedFixture(page);
    if (
      bridge.actualCamera === undefined
      || bridge.actualRenderer === undefined
      || bridge.settings === undefined
      || bridge.plyMeshRuntimeState === undefined
      || bridge.runtimeInstanceId === undefined
    ) {
      throw new Error("Loaded PLY fixture did not expose complete camera, renderer, settings, geometry, and runtime-identity evidence.");
    }
    residentRuntimeInstanceId ??= bridge.runtimeInstanceId;
    expect(bridge.runtimeInstanceId).toBe(residentRuntimeInstanceId);
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ url: sourceServer.urlFor(boundSource), ok: true });
    expect(sourceServer.requestCountFor(boundSource)).toBe(1);
    expect(bridge.sparkRuntimeState).toBeUndefined();
    if (!grandHallLineageCameraMatches(bridge.actualCamera)) {
      throw new Error(`Grand Hall PLY camera deviated from its complete fixed-camera contract: ${JSON.stringify(bridge.actualCamera)}`);
    }
    if (!grandHallSharedCameraProfileMatchesActual(cameraProfile, bridge.actualCamera)) {
      throw new Error("Grand Hall PLY camera deviated from the shared native/browser profile.");
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

    const renderedFrameCountBefore = bridge.renderedFrameCount;
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
      || bridge.runtimeInstanceId === undefined
    ) {
      throw new Error("Final PLY lineage frame did not expose complete post-render evidence.");
    }
    expect(bridge.runtimeInstanceId).toBe(residentRuntimeInstanceId);
    const renderedFrameCountAfter = bridge.renderedFrameCount;
    expect(renderedFrameCountAfter - renderedFrameCountBefore).toBeGreaterThanOrEqual(
      WARMUP_FRAME_COUNT + FRAME_SAMPLE_COUNT,
    );

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
    if (browserPreflight !== undefined) {
      assertGrandHallHardwareEvidenceMatchesProfile(browserPreflight.profile, {
        userAgent: environment.browser,
        webglVendor: environment.webglVendor,
        webglRenderer: environment.webglRenderer,
        webglVersion: environment.webglVersion,
        contextLost: environment.contextLost,
      });
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
    const sourceRequestCountAfter = sourceServer.totalRequestCount();
    try {
      assertSourceResidencyState({
        run: captureRun,
        members: [boundSource],
        sourceServer,
        requestCountBefore: sourceRequestCountBefore,
        requestCountAfter: sourceRequestCountAfter,
      });
    } catch (error: unknown) {
      await rm(screenshotTempPath, { force: true });
      throw error;
    }
    const screenshotSha256 = await hashFile(screenshotTempPath);
    const gitAtEnd = await gitIdentity();
    assertOrchestratedGitIdentity(gitAtEnd);
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
      benchmarkId: ORCHESTRATED_VISIBLE_FIRST
        ? `grand-hall-ply-source-pose-local-${runLabel}-${sampleLabel}-v1`
        : `grand-hall-ply-source-pose-local-${sampleLabel}-v1`,
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
          grandHallSharedCameraProfileEvidence(cameraProfile),
          ...(ORCHESTRATED_VISIBLE_FIRST
            ? [grandHallBrowserSourceResidencyEvidence({
                representation: "ply",
                run: captureRun,
                sourceRequestCountBefore,
                sourceRequestCountAfter,
                runtimeInstanceId: bridge.runtimeInstanceId,
                renderedFrameCountBefore,
                renderedFrameCountAfter,
              })]
            : []),
          ...(captureRun.residencyState === "resident"
            ? [
                "Resident capture reuses one live fixture runtime; no navigation, source fetch, decode, or scene attachment is performed. It measures long-lived decoded-runtime stability, not HTTP-cache reload performance.",
              ]
            : []),
          ...(browserPreflight === undefined ? [] : [browserPreflight.marker]),
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
          loadMs: captureRun.residencyState === "cold_load"
            ? bridge.results[0]?.elapsedMs ?? 0
            : 0,
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
    await writeFile(
      recordTempPath,
      `${JSON.stringify(validatedResult, null, 2)}\n`,
      ORCHESTRATED_VISIBLE_FIRST
        ? { encoding: "utf8", flag: "wx" }
        : { encoding: "utf8" },
    );
    if (ORCHESTRATED_VISIBLE_FIRST) {
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
    } finally {
      await sourceServer.close();
    }
  });
});

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { constants as fileSystemConstants, copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV,
  GRAND_HALL_HARDWARE_PREFLIGHT_MARKER,
  assertGrandHallHardwareEvidenceMatchesProfile,
  selectGrandHallHardwareBrowserProfile,
  serializeGrandHallHardwareBrowserProfile,
  type GrandHallHardwareBrowserProfileV1,
} from "./grand-hall-browser-hardware.ts";

const CAMERA_ID = "source-pose-19890-interior-v1";
const CAMERA_PROFILE_RELATIVE_PATH =
  "tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json";
const CAMERA_PROFILE_MARKER = "VENVIEWER_SHARED_CAMERA_PROFILE_V1:";
const CACHE_MARKER = "VENVIEWER_BROWSER_CACHE_STATE_V1:";
const DEFAULT_BASE_PORT = 5_189;
const EXPECTED_DECODED_SPLAT_COUNT = 6_019_684;
const CONTROLLED_WARMUP_FRAME_COUNT = 120;
const CONTROLLED_FRAME_SAMPLE_COUNT = 600;

export const GRAND_HALL_VISIBLE_FIRST_LANES = Object.freeze([
  {
    representation: "sog",
    representationId: "exact-sog-frontier",
    recordFormat: "sog",
    sourceMemberCount: 11,
    sourceSizeBytes: 106_479_738,
    radianceRankingEligible: true,
  },
  {
    representation: "spz",
    representationId: "name-matched-spz-candidate",
    recordFormat: "spz",
    sourceMemberCount: 11,
    sourceSizeBytes: 178_415_360,
    radianceRankingEligible: true,
  },
  {
    representation: "ply",
    representationId: "supplied-ply-mesh",
    recordFormat: "ply_mesh",
    sourceMemberCount: 1,
    sourceSizeBytes: 1_185_642,
    radianceRankingEligible: false,
  },
] as const);

type Lane = (typeof GRAND_HALL_VISIBLE_FIRST_LANES)[number];

export interface GrandHallVisibleFirstLanePlan {
  readonly lane: Lane;
  readonly evidenceDirectory: string;
  readonly baseUrl: string;
}

interface CameraProfileBinding {
  readonly profileId: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly bytes: Buffer;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly aspect: number;
}

interface ValidatedCaptureReceipt {
  readonly runOrdinal: number;
  readonly cacheState: "cold" | "warm";
  readonly cacheRunOrdinal: number;
  readonly recordPath: string;
  readonly recordSha256: string;
  readonly screenshotPath: string;
  readonly screenshotSha256: string;
}

interface LaneExecutionReceipt {
  readonly representation: Lane["representation"];
  readonly runnerPid: number;
  readonly baseUrl: string;
  readonly browserProfileSha256: string;
  readonly radianceRankingEligible: boolean;
  readonly captures: readonly ValidatedCaptureReceipt[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Receipt field ${key} must be an object.`);
  return value;
}

function requiredArray(record: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Receipt field ${key} must be an array.`);
  return value;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Receipt field ${key} must be a non-empty string.`);
  }
  return value;
}

function requiredNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Receipt field ${key} must be a finite number.`);
  }
  return value;
}

function requiredBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Receipt field ${key} must be boolean.`);
  return value;
}

function requiredVec3(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly [number, number, number] {
  const value = record[key];
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(`Receipt field ${key} must be a finite vec3.`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function assertPathAbsent(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to replace existing evidence path: ${targetPath}`);
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function gitStatus(
  repositoryRoot: string,
  evidenceDirectory?: string,
): string {
  const pathspec = ["--", ".", ":(exclude)packages/web/test-results/**", ":(exclude)packages/web/playwright-report/**"];
  if (evidenceDirectory !== undefined) {
    const relativeEvidence = path.relative(repositoryRoot, evidenceDirectory).replaceAll("\\", "/");
    pathspec.push(`:(exclude)${relativeEvidence}/**`);
  }
  return git(repositoryRoot, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    ...pathspec,
  ]);
}

function packageManagerInvocation(): { readonly command: string; readonly leadingArgs: readonly string[] } {
  const npmExecPath = process.env["npm_execpath"];
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return { command: process.execPath, leadingArgs: [npmExecPath] };
  }
  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    leadingArgs: [],
  };
}

function runTypesBuild(repositoryRoot: string): void {
  const invocation = packageManagerInvocation();
  const result = spawnSync(
    invocation.command,
    [...invocation.leadingArgs, "--filter", "@omnitwin/types", "build"],
    { cwd: repositoryRoot, stdio: "inherit", windowsHide: true },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`@omnitwin/types build exited ${String(result.status)}.`);
  }
}

function parseCameraProfile(bytes: Buffer, sourcePath: string): CameraProfileBinding {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed)) throw new Error("Shared camera profile root must be an object.");
  const frames = requiredRecord(parsed, "frames");
  const three = requiredRecord(frames, "three");
  const projection = requiredRecord(parsed, "projection");
  const profileId = requiredString(parsed, "profileId");
  const position = requiredVec3(three, "position");
  const target = requiredVec3(three, "target");
  const fov = requiredNumber(projection, "verticalFieldOfViewDegrees");
  const near = requiredNumber(projection, "nearClipMetres");
  const far = requiredNumber(projection, "farClipMetres");
  const aspect = requiredNumber(projection, "aspect");
  if (
    requiredString(parsed, "schemaVersion") !== "venviewer.grand-hall.fixed-camera-profile.v1"
    || requiredString(parsed, "authority") !== "none"
    || profileId !== CAMERA_ID
    || !arraysEqual(position, [-0.03426186932373998, 2.15606153541565, 8.015104841842623])
    || !arraysEqual(target, [0.15796363067625974, 2.15606153541565, -0.19184415815737577])
    || fov !== 60
    || near !== 0.05
    || far !== 80
    || aspect !== 16 / 9
  ) {
    throw new Error("Shared camera profile identity, authority, camera, or projection deviates.");
  }
  return {
    profileId,
    sourcePath,
    sha256: sha256(bytes),
    bytes,
    position,
    target,
    fov,
    near,
    far,
    aspect,
  };
}

async function readCameraProfile(repositoryRoot: string): Promise<CameraProfileBinding> {
  const sourcePath = path.resolve(repositoryRoot, CAMERA_PROFILE_RELATIVE_PATH);
  return parseCameraProfile(await readFile(sourcePath), sourcePath);
}

export function grandHallVisibleFirstLanePlan(
  evidenceDirectory: string,
  basePort = DEFAULT_BASE_PORT,
): readonly GrandHallVisibleFirstLanePlan[] {
  if (!Number.isInteger(basePort) || basePort < 1_024 || basePort > 65_532) {
    throw new Error("GRAND_HALL_LINEAGE_BASE_PORT must reserve three valid user ports.");
  }
  return GRAND_HALL_VISIBLE_FIRST_LANES.map((lane, index) => ({
    lane,
    evidenceDirectory: path.join(evidenceDirectory, lane.representation),
    baseUrl: `http://127.0.0.1:${String(basePort + index)}`,
  }));
}

export function grandHallVisibleFirstSanitizedParentEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const prohibitedInheritedKeys = new Set([
    "CI",
    "E2E_BROWSER_CHANNEL",
    "E2E_WEB_SERVER",
    GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV,
    "GRAND_HALL_LINEAGE_CAPTURE_MODE",
  ]);
  return Object.fromEntries(
    Object.entries(parentEnvironment).filter(([key]) => !prohibitedInheritedKeys.has(key)),
  );
}

function markerPayload(
  limitations: readonly unknown[],
  prefix: string,
): Readonly<Record<string, unknown>> {
  const marker = limitations.find((entry) => typeof entry === "string" && entry.startsWith(prefix));
  if (typeof marker !== "string") throw new Error(`Evidence limitation ${prefix} is missing.`);
  const parsed: unknown = JSON.parse(marker.slice(prefix.length));
  if (!isRecord(parsed)) throw new Error(`Evidence limitation ${prefix} is malformed.`);
  return parsed;
}

async function validateCaptureRecord(input: {
  readonly recordPath: string;
  readonly lane: Lane;
  readonly gitSha: string;
  readonly cameraProfile: CameraProfileBinding;
  readonly browserProfile: GrandHallHardwareBrowserProfileV1;
  readonly browserProfileSha256: string;
}): Promise<ValidatedCaptureReceipt> {
  const recordBytes = await readFile(input.recordPath);
  const parsed: unknown = JSON.parse(recordBytes.toString("utf8"));
  if (!isRecord(parsed)) throw new Error(`Capture record is not an object: ${input.recordPath}`);
  const camera = requiredRecord(parsed, "camera");
  const representations = requiredArray(parsed, "representations");
  if (representations.length !== 1 || !isRecord(representations[0])) {
    throw new Error(`Capture record must contain one representation: ${input.recordPath}`);
  }
  const representation = representations[0];
  const limitations = requiredArray(representation, "limitations");
  const actualCamera = requiredRecord(representation, "actualCamera");
  const environment = requiredRecord(representation, "environment");
  const sourceMembers = requiredArray(representation, "sourceMembers");
  const sourceSizeBytes = sourceMembers.reduce<number>((total, member) => {
    if (!isRecord(member)) throw new Error("Source member receipt must be an object.");
    return total + requiredNumber(member, "sizeBytes");
  }, 0);
  if (
    requiredString(parsed, "gitSha") !== input.gitSha
    || requiredBoolean(parsed, "worktreeDirty")
    || requiredString(camera, "id") !== CAMERA_ID
    || !arraysEqual(requiredVec3(camera, "position"), input.cameraProfile.position)
    || requiredNumber(camera, "fov") !== input.cameraProfile.fov
    || requiredNumber(camera, "near") !== input.cameraProfile.near
    || requiredNumber(camera, "far") !== input.cameraProfile.far
    || requiredNumber(camera, "aspect") !== input.cameraProfile.aspect
    || !arraysEqual(requiredVec3(actualCamera, "position"), input.cameraProfile.position)
    || requiredString(representation, "id") !== input.lane.representationId
    || requiredString(representation, "format") !== input.lane.recordFormat
    || requiredString(representation, "status") !== "diagnostic"
    || requiredString(representation, "visualAssessment") !== "not_reviewed"
    || requiredNumber(representation, "warmupFrameCount") !== CONTROLLED_WARMUP_FRAME_COUNT
    || requiredNumber(representation, "frameSampleCount") !== CONTROLLED_FRAME_SAMPLE_COUNT
    || sourceMembers.length !== input.lane.sourceMemberCount
    || sourceSizeBytes !== input.lane.sourceSizeBytes
  ) {
    throw new Error(`Capture record contract mismatch: ${input.recordPath}`);
  }
  if (
    input.lane.representation !== "ply"
    && requiredNumber(representation, "decodedSplatCount") !== EXPECTED_DECODED_SPLAT_COUNT
  ) {
    throw new Error(`Captured-radiance decoded count mismatch: ${input.recordPath}`);
  }
  if (input.lane.representation === "ply") {
    const plyRuntime = requiredRecord(representation, "plyMeshRuntimeState");
    const provenance = requiredRecord(plyRuntime, "provenance");
    if (
      requiredString(provenance, "geometryRole") !== "structural_evidence_only"
      || requiredString(provenance, "appearanceRole")
        !== "deterministic_debug_visualization_not_source_appearance"
    ) {
      throw new Error(`PLY escaped its structural-only evidence role: ${input.recordPath}`);
    }
  }

  const cameraMarker = markerPayload(limitations, CAMERA_PROFILE_MARKER);
  if (
    requiredString(cameraMarker, "profileId") !== CAMERA_ID
    || requiredString(cameraMarker, "sha256") !== input.cameraProfile.sha256
  ) {
    throw new Error(`Capture record camera-profile binding mismatch: ${input.recordPath}`);
  }
  const cacheMarker = markerPayload(limitations, CACHE_MARKER);
  const runOrdinal = requiredNumber(cacheMarker, "runOrdinal");
  const cacheState = requiredString(cacheMarker, "cacheState");
  const cacheRunOrdinal = requiredNumber(cacheMarker, "cacheRunOrdinal");
  const requestCountBefore = requiredNumber(cacheMarker, "sourceRequestCountBefore");
  const requestCountAfter = requiredNumber(cacheMarker, "sourceRequestCountAfter");
  if (
    requiredString(cacheMarker, "representation") !== input.lane.representation
    || requiredString(cacheMarker, "browserProcessScope")
      !== "one_representation_cold_plus_three_warm"
    || (cacheState !== "cold" && cacheState !== "warm")
    || (cacheState === "cold"
      ? runOrdinal !== 1 || cacheRunOrdinal !== 1 || requestCountBefore !== 0
      : runOrdinal < 2 || runOrdinal > 4 || cacheRunOrdinal !== runOrdinal - 1)
    || requestCountAfter !== input.lane.sourceMemberCount
    || (cacheState === "warm" && requestCountBefore !== requestCountAfter)
  ) {
    throw new Error(`Capture record cache-state contract mismatch: ${input.recordPath}`);
  }

  const browserMarker = markerPayload(limitations, GRAND_HALL_HARDWARE_PREFLIGHT_MARKER);
  const capturedBrowserEvidence = {
    userAgent: requiredString(environment, "browser"),
    webglVendor: requiredString(environment, "webglVendor"),
    webglRenderer: requiredString(environment, "webglRenderer"),
    webglVersion: requiredString(environment, "webglVersion"),
    contextLost: requiredBoolean(environment, "contextLost"),
  };
  assertGrandHallHardwareEvidenceMatchesProfile(input.browserProfile, capturedBrowserEvidence);
  if (
    requiredString(browserMarker, "profileSha256") !== input.browserProfileSha256
    || !requiredBoolean(browserMarker, "completedBeforeSourceNavigation")
    || requiredString(browserMarker, "browserVersion") !== input.browserProfile.browserVersion
    || requiredString(browserMarker, "userAgent") !== capturedBrowserEvidence.userAgent
    || requiredString(browserMarker, "webglVendor") !== capturedBrowserEvidence.webglVendor
    || requiredString(browserMarker, "webglRenderer") !== capturedBrowserEvidence.webglRenderer
    || requiredString(browserMarker, "webglVersion") !== capturedBrowserEvidence.webglVersion
    || requiredBoolean(browserMarker, "contextLost")
  ) {
    throw new Error(`Capture record hardware-preflight binding mismatch: ${input.recordPath}`);
  }

  const screenshot = requiredRecord(representation, "screenshot");
  const screenshotPath = path.resolve(requiredString(screenshot, "path"));
  const screenshotBytes = await readFile(screenshotPath);
  const screenshotSha256 = sha256(screenshotBytes);
  if (
    screenshotSha256 !== requiredString(screenshot, "sha256")
    || (await stat(screenshotPath)).size !== requiredNumber(screenshot, "sizeBytes")
  ) {
    throw new Error(`Capture screenshot receipt mismatch: ${screenshotPath}`);
  }
  const runLabel = cacheState === "cold" ? "cold-run-1" : `warm-run-${String(cacheRunOrdinal)}`;
  if (!path.basename(input.recordPath).includes(runLabel)) {
    throw new Error(`Capture filename does not bind its ${runLabel} state: ${input.recordPath}`);
  }
  return {
    runOrdinal,
    cacheState,
    cacheRunOrdinal,
    recordPath: input.recordPath,
    recordSha256: sha256(recordBytes),
    screenshotPath,
    screenshotSha256,
  };
}

async function validateLaneEvidence(input: {
  readonly plan: GrandHallVisibleFirstLanePlan;
  readonly gitSha: string;
  readonly cameraProfile: CameraProfileBinding;
  readonly browserProfile: GrandHallHardwareBrowserProfileV1;
  readonly browserProfileSha256: string;
}): Promise<readonly ValidatedCaptureReceipt[]> {
  const entries = await readdir(input.plan.evidenceDirectory, { withFileTypes: true });
  const recordPaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(input.plan.evidenceDirectory, entry.name));
  const pngCount = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".png")).length;
  if (recordPaths.length !== 4 || pngCount !== 4 || entries.length !== 8) {
    throw new Error(
      `${input.plan.lane.representation} must publish exactly four JSON and four PNG files.`,
    );
  }
  const validated = await Promise.all(recordPaths.map((recordPath) => validateCaptureRecord({
    recordPath,
    lane: input.plan.lane,
    gitSha: input.gitSha,
    cameraProfile: input.cameraProfile,
    browserProfile: input.browserProfile,
    browserProfileSha256: input.browserProfileSha256,
  })));
  validated.sort((left, right) => left.runOrdinal - right.runOrdinal);
  if (
    validated.map((capture) => `${capture.cacheState}:${String(capture.cacheRunOrdinal)}`).join(",")
    !== "cold:1,warm:1,warm:2,warm:3"
  ) {
    throw new Error(`${input.plan.lane.representation} did not produce cold + three warm captures.`);
  }
  return validated;
}

function runPlaywrightLane(input: {
  readonly webRoot: string;
  readonly plan: GrandHallVisibleFirstLanePlan;
  readonly sourceRoot: string;
  readonly gitSha: string;
  readonly cameraProfileSha256: string;
  readonly browserProfileSerialized: string;
}): number {
  const playwrightCli = path.resolve(input.webRoot, "node_modules/@playwright/test/cli.js");
  const result = spawnSync(
    process.execPath,
    [
      playwrightCli,
      "test",
      "e2e/grand-hall-visual-lineage.local.spec.ts",
      "--project=chromium",
      "--workers=1",
      "--retries=0",
      "--reporter=line",
    ],
    {
      cwd: input.webRoot,
      env: {
        ...grandHallVisibleFirstSanitizedParentEnvironment(process.env),
        GRAND_HALL_LINEAGE_ROOT: input.sourceRoot,
        GRAND_HALL_LINEAGE_EVIDENCE_DIR: input.plan.evidenceDirectory,
        GRAND_HALL_LINEAGE_ORCHESTRATED: "1",
        GRAND_HALL_LINEAGE_REPRESENTATION: input.plan.lane.representation,
        GRAND_HALL_LINEAGE_EXPECTED_GIT_SHA: input.gitSha,
        GRAND_HALL_LINEAGE_EXPECTED_CAMERA_PROFILE_SHA256: input.cameraProfileSha256,
        [GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV]: input.browserProfileSerialized,
        GRAND_HALL_LINEAGE_WARMUP_FRAMES: String(CONTROLLED_WARMUP_FRAME_COUNT),
        GRAND_HALL_LINEAGE_FRAME_SAMPLES: String(CONTROLLED_FRAME_SAMPLE_COUNT),
        E2E_BASE_URL: input.plan.baseUrl,
        E2E_REUSE_EXISTING_SERVER: "false",
        E2E_START_SERVER: "true",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${input.plan.lane.representation.toUpperCase()} Playwright process exited ${String(result.status)}.`,
    );
  }
  return result.pid;
}

async function main(): Promise<void> {
  const sourceRootValue = process.env["GRAND_HALL_LINEAGE_ROOT"];
  const evidenceDirectoryValue = process.env["GRAND_HALL_LINEAGE_EVIDENCE_DIR"];
  if (
    sourceRootValue === undefined
    || evidenceDirectoryValue === undefined
    || !path.isAbsolute(sourceRootValue)
    || !path.isAbsolute(evidenceDirectoryValue)
  ) {
    throw new Error(
      "Set absolute GRAND_HALL_LINEAGE_ROOT and GRAND_HALL_LINEAGE_EVIDENCE_DIR paths.",
    );
  }
  const repositoryRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const sourceRoot = path.resolve(sourceRootValue);
  const evidenceDirectory = path.resolve(evidenceDirectoryValue);
  const allowedEvidenceRoot = path.resolve(repositoryRoot, "docs/evidence/grand-hall-lineage");
  const evidenceRelative = path.relative(allowedEvidenceRoot, evidenceDirectory);
  if (
    evidenceRelative === ""
    || evidenceRelative.startsWith("..")
    || path.isAbsolute(evidenceRelative)
  ) {
    throw new Error("Evidence directory must be a new child of docs/evidence/grand-hall-lineage.");
  }
  if (!(await stat(sourceRoot)).isDirectory()) {
    throw new Error("GRAND_HALL_LINEAGE_ROOT must be a directory.");
  }
  await assertPathAbsent(evidenceDirectory);
  const gitSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const initialStatus = gitStatus(repositoryRoot);
  if (initialStatus.length > 0) {
    throw new Error(`The visible-first bake-off requires a clean worktree:\n${initialStatus}`);
  }

  runTypesBuild(repositoryRoot);
  if (git(repositoryRoot, ["rev-parse", "HEAD"]) !== gitSha || gitStatus(repositoryRoot).length > 0) {
    throw new Error("HEAD or tracked source state changed during the prerequisite build.");
  }
  const cameraProfile = await readCameraProfile(repositoryRoot);
  const basePortRaw = process.env["GRAND_HALL_LINEAGE_BASE_PORT"];
  const basePort = basePortRaw === undefined ? DEFAULT_BASE_PORT : Number.parseInt(basePortRaw, 10);
  const plans = grandHallVisibleFirstLanePlan(evidenceDirectory, basePort);
  const browserSelection = await selectGrandHallHardwareBrowserProfile();
  const browserProfileSerialized = serializeGrandHallHardwareBrowserProfile(
    browserSelection.profile,
  );
  const browserProfileSha256 = sha256(Buffer.from(browserProfileSerialized, "utf8"));
  if (
    git(repositoryRoot, ["rev-parse", "HEAD"]) !== gitSha
    || gitStatus(repositoryRoot).length > 0
  ) {
    throw new Error("HEAD or source worktree state changed during the hardware browser preflight.");
  }

  await mkdir(path.dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory);
  const cameraArtifactName = `${cameraProfile.profileId}-${cameraProfile.sha256.slice("sha256:".length)}.json`;
  const cameraArtifactPath = path.join(evidenceDirectory, cameraArtifactName);
  await copyFile(
    cameraProfile.sourcePath,
    cameraArtifactPath,
    fileSystemConstants.COPYFILE_EXCL,
  );
  if (sha256(await readFile(cameraArtifactPath)) !== cameraProfile.sha256) {
    throw new Error("Digest-addressed camera profile copy does not match its source bytes.");
  }

  const startedAt = new Date().toISOString();
  const laneReceipts: LaneExecutionReceipt[] = [];
  for (const plan of plans) {
    await mkdir(plan.evidenceDirectory);
    process.stdout.write(
      `Starting ${plan.lane.representation.toUpperCase()} in a new Playwright OS process at ${plan.baseUrl}.\n`,
    );
    const runnerPid = runPlaywrightLane({
      webRoot: path.resolve(repositoryRoot, "packages/web"),
      plan,
      sourceRoot,
      gitSha,
      cameraProfileSha256: cameraProfile.sha256,
      browserProfileSerialized,
    });
    const captures = await validateLaneEvidence({
      plan,
      gitSha,
      cameraProfile,
      browserProfile: browserSelection.profile,
      browserProfileSha256,
    });
    laneReceipts.push({
      representation: plan.lane.representation,
      runnerPid,
      baseUrl: plan.baseUrl,
      browserProfileSha256,
      radianceRankingEligible: plan.lane.radianceRankingEligible,
      captures,
    });
  }
  if (new Set(laneReceipts.map((receipt) => receipt.runnerPid)).size !== laneReceipts.length) {
    throw new Error("Playwright runner process IDs were not distinct across representations.");
  }
  if (
    git(repositoryRoot, ["rev-parse", "HEAD"]) !== gitSha
    || gitStatus(repositoryRoot, evidenceDirectory).length > 0
  ) {
    throw new Error("HEAD or source worktree state changed during the browser bake-off.");
  }

  const receiptPath = path.join(evidenceDirectory, "visible-first-browser-bakeoff-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify({
    schemaVersion: "venviewer.grand-hall.visible-first-browser-bakeoff.v2",
    authority: "none",
    gitSha,
    worktreeDirty: false,
    startedAt,
    completedAt: new Date().toISOString(),
    cameraProfile: {
      profileId: cameraProfile.profileId,
      sourcePath: CAMERA_PROFILE_RELATIVE_PATH,
      artifactPath: cameraArtifactPath,
      sha256: cameraProfile.sha256,
      target: cameraProfile.target,
    },
    processIsolation: "one_fresh_playwright_and_browser_process_per_representation",
    browserHardwarePreflight: {
      profileSha256: browserProfileSha256,
      selectedProfile: browserSelection.profile,
      attempts: browserSelection.attempts,
      completedBeforeEvidenceDirectoryCreation: true,
    },
    executionOrder: GRAND_HALL_VISIBLE_FIRST_LANES.map((lane) => lane.representation),
    radianceRankingEligibleRepresentations: ["sog", "spz"],
    structuralOnlyRepresentations: ["ply"],
    lanes: laneReceipts,
    limitations: [
      "The shared camera is inspection-only, not a recovered optical camera.",
      "PLY is reconstructed structural evidence and is excluded from radiance ranking.",
      "No human visual acceptance, winner selection, room admission, staging, deployment, or production authority is granted.",
    ],
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`Visible-first browser bake-off receipt: ${receiptPath}\n`);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined
  && import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

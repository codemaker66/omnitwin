import {
  lstat,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { arch, platform } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  sha256Bytes,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { VisualLineageBenchmarkV0Schema } from "@omnitwin/types";
import sharp from "sharp";
import { z } from "zod";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_VISIBLE_FIRST_COMPARISON_SCHEMA =
  "venviewer.grand-hall.visible-first-radiance-comparison.v1";
export const GRAND_HALL_VISIBLE_FIRST_BAKEOFF_SCHEMA =
  "venviewer.grand-hall.visible-first-browser-bakeoff.v3";
export const GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME =
  "sog-left-spz-right.png";
export const GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME =
  "sog-spz-absolute-rgb-difference-x8.png";
export const GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME =
  "comparison-receipt.json";

const WIDTH = 1_600;
const HEIGHT = 900;
const CHANNELS = 3;
const GAP_WIDTH = 8;
const GAP_RGB = [8, 10, 14] as const;
const DIFFERENCE_AMPLIFICATION = 8;
const CONTROLLED_FRAME_COUNT = 720;
const CAMERA_ID = "source-pose-19890-interior-v1";
const CANONICAL_CAMERA_PROFILE_SHA256 =
  "sha256:9eca9b6582b7301ec1c059b1a5be699e5a4983773afecb2beea46c2668305922";
const HARDWARE_PROFILE_SCHEMA = "venviewer.grand-hall.hardware-browser-profile.v1";
const CAMERA_MARKER = "VENVIEWER_SHARED_CAMERA_PROFILE_V1:";
const RESIDENCY_MARKER = "VENVIEWER_BROWSER_SOURCE_RESIDENCY_V1:";
const HARDWARE_MARKER = "VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1:";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const HARDWARE_MARKERS = [
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "intel",
  "apple gpu",
  "adreno",
  "qualcomm",
  "mali",
  "powervr",
] as const;
const SOFTWARE_MARKERS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software rasterizer",
  "microsoft basic render driver",
  "mesa offscreen",
] as const;
const HARDWARE_LAUNCH_ARGS = [
  "--use-angle=d3d11",
  "--disable-software-rasterizer",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--force-device-scale-factor=1",
] as const;
const EXPECTED_LIMITATIONS = [
  "The shared camera is inspection-only, not a recovered optical camera.",
  "PLY is reconstructed structural evidence and is excluded from radiance ranking.",
  "Each representation receives one cold source navigation/load and four total captures from one live fixture runtime. The following three resident captures perform no navigation, source fetch, decode, or scene attachment. They measure visual and frame-time stability of the long-lived decoded runtime; they do not claim HTTP-cache reload performance.",
  "No human visual acceptance, winner selection, room admission, staging, deployment, or production authority is granted.",
] as const;
const COMPARISON_LIMITATIONS = [
  "SOG and SPZ are the two receipt-designated radiance-eligible representations in this hardware-v3 bundle; this comparison does not establish independent ground truth.",
  "Full-frame sRGB byte disagreement cannot determine which representation is more accurate or more beautiful.",
  "One fixed inspection camera cannot establish architectural fidelity or whole-room completeness.",
  "This comparison grants no winner, visual acceptance, room admission, staging, deployment, publication, or production authority.",
] as const;

const REPRESENTATION_CONTRACT = {
  sog: {
    representationId: "exact-sog-frontier",
    format: "sog",
    sourceMemberCount: 11,
    sourceSizeBytes: 106_479_738,
    radianceRankingEligible: true,
  },
  spz: {
    representationId: "name-matched-spz-candidate",
    format: "spz",
    sourceMemberCount: 11,
    sourceSizeBytes: 178_415_360,
    radianceRankingEligible: true,
  },
  ply: {
    representationId: "supplied-ply-mesh",
    format: "ply_mesh",
    sourceMemberCount: 1,
    sourceSizeBytes: 1_185_642,
    radianceRankingEligible: false,
  },
} as const;

type Representation = keyof typeof REPRESENTATION_CONTRACT;
type RadianceRepresentation = Exclude<Representation, "ply">;

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const sha256Schema = z.string().regex(SHA256_PATTERN);
const gitShaSchema = z.string().regex(GIT_SHA_PATTERN);
const nonEmptyString = z.string().min(1);

const CandidateSchema = z.object({
  candidateId: nonEmptyString,
  browserName: z.literal("chromium"),
  channel: z.enum(["chrome", "msedge"]),
  headless: z.boolean(),
  launchArgs: z.array(nonEmptyString).min(1),
}).strict();

const HardwareEvidenceSchema = z.object({
  browserVersion: nonEmptyString,
  userAgent: nonEmptyString,
  webglVendor: nonEmptyString,
  webglRenderer: nonEmptyString,
  webglVersion: nonEmptyString,
  contextLost: z.literal(false),
  probeDurationMs: nonNegativeInteger,
}).strict();

const HardwareProfileSchema = CandidateSchema.extend({
  schemaVersion: z.literal(HARDWARE_PROFILE_SCHEMA),
  browserVersion: nonEmptyString,
  userAgent: nonEmptyString,
  webglVendor: nonEmptyString,
  webglRenderer: nonEmptyString,
  webglVersion: nonEmptyString,
  contextLost: z.literal(false),
  probeDurationMs: nonNegativeInteger,
}).strict();

const HardwareAttemptSchema = z.object({
  candidate: CandidateSchema,
  outcome: z.enum([
    "launch_failed",
    "rejected_software",
    "rejected_unknown",
    "selected_hardware",
  ]),
  evidence: HardwareEvidenceSchema.optional(),
  error: nonEmptyString.optional(),
}).strict().superRefine((attempt, context) => {
  if (attempt.outcome === "launch_failed") {
    if (attempt.error === undefined || attempt.evidence !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A failed launch requires only an error." });
    }
  } else if (attempt.evidence === undefined || attempt.error !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A completed hardware probe requires only evidence." });
  }
});

const CaptureReceiptSchema = z.object({
  runOrdinal: z.number().int().min(1).max(4),
  residencyState: z.enum(["cold_load", "resident"]),
  residencyRunOrdinal: z.number().int().min(1).max(3),
  sourceRequestCountBefore: nonNegativeInteger,
  sourceRequestCountAfter: positiveInteger,
  runtimeInstanceId: nonEmptyString,
  renderedFrameCountBefore: nonNegativeInteger,
  renderedFrameCountAfter: nonNegativeInteger,
  recordPath: nonEmptyString,
  recordSha256: sha256Schema,
  screenshotPath: nonEmptyString,
  screenshotSha256: sha256Schema,
}).strict();

const LaneReceiptSchema = z.object({
  representation: z.enum(["sog", "spz", "ply"]),
  runnerPid: positiveInteger,
  baseUrl: z.string().url(),
  browserProfileSha256: sha256Schema,
  radianceRankingEligible: z.boolean(),
  captures: z.array(CaptureReceiptSchema).length(4),
}).strict();

const BakeoffReceiptSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_VISIBLE_FIRST_BAKEOFF_SCHEMA),
  authority: z.literal("none"),
  gitSha: gitShaSchema,
  worktreeDirty: z.literal(false),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  cameraProfile: z.object({
    profileId: z.literal(CAMERA_ID),
    sourcePath: z.literal("tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json"),
    artifactPath: nonEmptyString,
    sha256: z.literal(CANONICAL_CAMERA_PROFILE_SHA256),
    target: z.tuple([finiteNumber, finiteNumber, finiteNumber]),
  }).strict(),
  processIsolation: z.literal("one_fresh_playwright_and_browser_process_per_representation"),
  browserHardwarePreflight: z.object({
    profileSha256: sha256Schema,
    selectedProfile: HardwareProfileSchema,
    attempts: z.array(HardwareAttemptSchema).min(1),
    completedBeforeEvidenceDirectoryCreation: z.literal(true),
  }).strict(),
  executionOrder: z.tuple([z.literal("sog"), z.literal("spz"), z.literal("ply")]),
  radianceRankingEligibleRepresentations: z.tuple([z.literal("sog"), z.literal("spz")]),
  structuralOnlyRepresentations: z.tuple([z.literal("ply")]),
  lanes: z.array(LaneReceiptSchema).length(3),
  limitations: z.tuple(EXPECTED_LIMITATIONS.map((value) => z.literal(value)) as [
    z.ZodLiteral<(typeof EXPECTED_LIMITATIONS)[0]>,
    z.ZodLiteral<(typeof EXPECTED_LIMITATIONS)[1]>,
    z.ZodLiteral<(typeof EXPECTED_LIMITATIONS)[2]>,
    z.ZodLiteral<(typeof EXPECTED_LIMITATIONS)[3]>,
  ]),
}).strict();

const vec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const FixedCameraProfileSchema = z.object({
  schemaVersion: z.literal("venviewer.grand-hall.fixed-camera-profile.v1"),
  profileId: z.literal(CAMERA_ID),
  authority: z.literal("none"),
  truthClass: z.literal("RECONSTRUCTED_DIAGNOSTIC"),
  roomRef: z.literal("trades-hall/grand-hall"),
  sourcePoseIndex: z.literal(19_890),
  sourcePoseTimestamp: z.string().regex(/^\d+\.\d+$/u),
  frames: z.object({
    source: z.object({
      id: z.literal("xgrids_lcc2_source_z_up"),
      position: vec3Schema,
      target: vec3Schema,
      up: vec3Schema,
    }).strict(),
    native: z.object({
      id: z.literal("xgrids_lcceditor_unity_y_up"),
      expectedPosition: vec3Schema,
      expectedTarget: vec3Schema,
      expectedUp: vec3Schema,
      expectedDirection: vec3Schema,
      expectedQuaternionXyzw: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]),
      assertionTolerance: finiteNumber.positive(),
    }).strict(),
    three: z.object({
      id: z.literal("venviewer_browser_centered_y_up"),
      position: vec3Schema,
      target: vec3Schema,
      up: vec3Schema,
      mappingStatus: z.literal("diagnostic_browser_frontier_mapping_not_accepted_room_transform"),
    }).strict(),
  }).strict(),
  projection: z.object({
    type: z.literal("perspective"),
    verticalFieldOfViewDegrees: finiteNumber.positive().max(179),
    nearClipMetres: finiteNumber.positive(),
    farClipMetres: finiteNumber.positive(),
    aspect: finiteNumber.positive(),
  }).strict(),
  output: z.object({
    width: positiveInteger,
    height: positiveInteger,
    devicePixelRatio: finiteNumber.positive(),
  }).strict(),
  environment: z.object({
    include: z.literal(false),
    reason: z.literal("browser_frontier_parity_env_sog_excluded"),
    visibilityGetterAvailable: z.literal(false),
  }).strict(),
  targetDerivation: z.literal("pose_q05_q95_horizontal_centre_at_source_pose_height"),
  inspectionOnly: z.literal(true),
  limitations: z.tuple([
    z.literal("The look target is an inspection-only q05/q95 pose-envelope centre, not a calibrated source-camera orientation."),
    z.literal("The Three.js mapping is diagnostic and is not an accepted room transform."),
    z.literal("This profile grants no room-scope, geometry, transform, architectural-truth, staging, publication, or production authority."),
  ]),
}).strict().superRefine((profile, context) => {
  if (profile.projection.farClipMetres <= profile.projection.nearClipMetres) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["projection", "farClipMetres"], message: "Far clip must exceed near clip." });
  }
  if (profile.output.width / profile.output.height !== profile.projection.aspect) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["projection", "aspect"], message: "Projection aspect must equal output aspect." });
  }
});

const CameraMarkerSchema = z.object({
  profileId: z.literal(CAMERA_ID),
  relativePath: z.literal("tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json"),
  sha256: z.literal(CANONICAL_CAMERA_PROFILE_SHA256),
}).strict();

const ResidencyMarkerSchema = z.object({
  representation: z.enum(["sog", "spz", "ply"]),
  runOrdinal: z.number().int().min(1).max(4),
  residencyState: z.enum(["cold_load", "resident"]),
  residencyRunOrdinal: z.number().int().min(1).max(3),
  sourceRequestCountBefore: nonNegativeInteger,
  sourceRequestCountAfter: positiveInteger,
  runtimeInstanceId: nonEmptyString,
  renderedFrameCountBefore: nonNegativeInteger,
  renderedFrameCountAfter: nonNegativeInteger,
  browserProcessScope: z.literal("one_representation_one_cold_load_plus_three_resident_captures"),
}).strict();

const HardwareMarkerSchema = z.object({
  profileSha256: sha256Schema,
  completedBeforeSourceNavigation: z.literal(true),
  browserVersion: nonEmptyString,
}).strict();

export interface GrandHallVisibleFirstComparisonArguments {
  readonly mode: "write" | "check";
  readonly bakeoffReceiptPath: string;
  readonly outputDirectory: string;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}

interface ReadFileReceipt {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly sizeBytes: number;
}

interface DecodedRgb {
  readonly bytes: Buffer;
  readonly width: typeof WIDTH;
  readonly height: typeof HEIGHT;
}

interface ValidatedRadianceLane {
  readonly representation: RadianceRepresentation;
  readonly selectedRecord: ReadFileReceipt & { readonly fileName: string };
  readonly selectedScreenshot: ReadFileReceipt & { readonly fileName: string };
  readonly decoded: DecodedRgb;
  readonly runtimeInstanceId: string;
  readonly screenshotSha256: string;
  readonly comparisonBindings: unknown;
  readonly stages: readonly {
    readonly runOrdinal: number;
    readonly residencyState: "cold_load" | "resident";
    readonly residencyRunOrdinal: number;
    readonly renderedFrameCountBefore: number;
    readonly renderedFrameCountAfter: number;
  }[];
}

export interface GrandHallVisibleFirstComparisonArtifacts {
  readonly sideBySidePng: Buffer;
  readonly absoluteDifferencePng: Buffer;
  readonly receiptJson: Buffer;
  readonly receipt: Readonly<Record<string, unknown>>;
}

export class GrandHallVisibleFirstComparisonError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallVisibleFirstComparisonError";
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new GrandHallVisibleFirstComparisonError(code, message, cause);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${sha256Bytes(bytes)}`;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

function sameFileSystemObject(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function identity(stat: Awaited<ReturnType<FileHandle["stat"]>>): FileIdentity {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    nlink: Number(stat.nlink),
  };
}

async function readStableRegularFile(path: string, label: string): Promise<ReadFileReceipt> {
  let pathBefore;
  try {
    pathBefore = await lstat(path);
  } catch (error) {
    fail("INPUT_FILE_UNREADABLE", `${label} is not readable: ${path}`, error);
  }
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1) {
    fail("INPUT_FILE_UNSAFE", `${label} must be a direct, singly linked regular file: ${path}`);
  }
  const beforeIdentity = identity(pathBefore);
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    fail("INPUT_FILE_UNREADABLE", `${label} cannot be opened: ${path}`, error);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(beforeIdentity, identity(opened))) {
      fail("INPUT_FILE_CHANGED", `${label} changed while it was opened: ${path}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      bytes.length !== opened.size
      || !sameIdentity(identity(opened), identity(after))
      || pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || !sameIdentity(identity(after), identity(pathAfter))
    ) {
      fail("INPUT_FILE_CHANGED", `${label} changed while it was read: ${path}`);
    }
    return { bytes, sha256: sha256(bytes), sizeBytes: bytes.length };
  } finally {
    await handle.close();
  }
}

async function assertDirectDirectory(path: string, label: string): Promise<string> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    fail("DIRECTORY_UNREADABLE", `${label} is not readable: ${path}`, error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("DIRECTORY_UNSAFE", `${label} must be a direct directory: ${path}`);
  }
  return realpath(path);
}

function relativeIsWithin(parent: string, child: string): boolean {
  const result = relative(parent, child);
  return result === "" || (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result));
}

function safePersistedLeaf(
  bundleRoot: string,
  persistedPath: string,
  expectedParent: string | null,
  expectedFileName: string,
): string {
  if (persistedPath.includes("\0")) fail("PATH_ESCAPE", "Persisted evidence paths cannot contain NUL bytes.");
  if (!/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(persistedPath)) {
    fail("PATH_MISMATCH", `Persisted evidence path is not an absolute declaration: ${persistedPath}`);
  }
  const components = persistedPath.replaceAll("\\", "/").split("/").filter((part) => part.length > 0);
  if (components.some((part) => part === "." || part === "..")) {
    fail("PATH_ESCAPE", `Persisted evidence path contains traversal: ${persistedPath}`);
  }
  if (components.at(-1) !== expectedFileName) {
    fail("PATH_MISMATCH", `Persisted evidence path does not end in ${expectedFileName}.`);
  }
  if (expectedParent !== null && components.at(-2) !== expectedParent) {
    fail("PATH_MISMATCH", `Persisted evidence path does not identify the ${expectedParent} lane.`);
  }
  const resolved = expectedParent === null
    ? join(bundleRoot, expectedFileName)
    : join(bundleRoot, expectedParent, expectedFileName);
  if (!relativeIsWithin(bundleRoot, resolved)) fail("PATH_ESCAPE", "Resolved evidence path escaped its bundle.");
  return resolved;
}

function captureStem(representation: Representation, capture: z.infer<typeof CaptureReceiptSchema>): string {
  const runLabel = capture.residencyState === "cold_load"
    ? "cold-load-1"
    : `resident-capture-${String(capture.residencyRunOrdinal)}`;
  const role = representation === "ply" ? "structural-diagnostic" : "diagnostic";
  return `grand-hall-${representation}-${CAMERA_ID}-${runLabel}-${role}-controlled-120w-600f`;
}

function parseMarker<T>(
  limitations: readonly string[],
  prefix: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const matches = limitations.filter((limitation) => limitation.startsWith(prefix));
  if (matches.length !== 1) fail("CAPTURE_RECORD_INVALID", `${label} must occur exactly once.`);
  const marker = matches[0];
  if (marker === undefined) fail("CAPTURE_RECORD_INVALID", `${label} is missing.`);
  try {
    return schema.parse(parseGrandHallT554StrictJson(Buffer.from(marker.slice(prefix.length), "utf8")));
  } catch (error) {
    fail("CAPTURE_RECORD_INVALID", `${label} is malformed.`, error);
  }
}

function assertResidencySequence(
  representation: Representation,
  captures: readonly z.infer<typeof CaptureReceiptSchema>[],
): void {
  const expected = [
    { runOrdinal: 1, residencyState: "cold_load", residencyRunOrdinal: 1 },
    { runOrdinal: 2, residencyState: "resident", residencyRunOrdinal: 1 },
    { runOrdinal: 3, residencyState: "resident", residencyRunOrdinal: 2 },
    { runOrdinal: 4, residencyState: "resident", residencyRunOrdinal: 3 },
  ] as const;
  const sourceMemberCount = REPRESENTATION_CONTRACT[representation].sourceMemberCount;
  const runtimeInstanceId = captures[0]?.runtimeInstanceId;
  let previousAfter: number | undefined;
  for (const [index, capture] of captures.entries()) {
    const wanted = expected[index];
    if (
      wanted === undefined
      || capture.runOrdinal !== wanted.runOrdinal
      || capture.residencyState !== wanted.residencyState
      || capture.residencyRunOrdinal !== wanted.residencyRunOrdinal
      || capture.sourceRequestCountBefore !== (capture.residencyState === "cold_load" ? 0 : sourceMemberCount)
      || capture.sourceRequestCountAfter !== sourceMemberCount
      || capture.runtimeInstanceId !== runtimeInstanceId
      || capture.renderedFrameCountAfter - capture.renderedFrameCountBefore < CONTROLLED_FRAME_COUNT
      || (previousAfter !== undefined && capture.renderedFrameCountBefore < previousAfter)
    ) {
      fail("RESIDENCY_INVALID", `${representation} does not preserve the exact four-stage residency invariant.`);
    }
    previousAfter = capture.renderedFrameCountAfter;
  }
}

function assertHardwareProfile(receipt: z.infer<typeof BakeoffReceiptSchema>): void {
  const preflight = receipt.browserHardwarePreflight;
  const profile = preflight.selectedProfile;
  const expectedCandidateId = `${profile.channel === "chrome" ? "chrome" : "edge"}-stable-${profile.headless ? "headless" : "headed"}-d3d11`;
  if (
    profile.candidateId !== expectedCandidateId
    || stableCanonicalJson(toCanonicalJson(profile.launchArgs))
      !== stableCanonicalJson(toCanonicalJson(HARDWARE_LAUNCH_ARGS))
    || preflight.attempts.some((attempt) => {
      const expectedAttemptId = `${attempt.candidate.channel === "chrome" ? "chrome" : "edge"}-stable-${attempt.candidate.headless ? "headless" : "headed"}-d3d11`;
      return attempt.candidate.candidateId !== expectedAttemptId
        || stableCanonicalJson(toCanonicalJson(attempt.candidate.launchArgs))
          !== stableCanonicalJson(toCanonicalJson(HARDWARE_LAUNCH_ARGS));
    })
  ) {
    fail("HARDWARE_PROFILE_INVALID", "Hardware preflight does not match a fail-closed browser launch candidate.");
  }
  const profileBytes = Buffer.from(JSON.stringify({
    schemaVersion: profile.schemaVersion,
    candidateId: profile.candidateId,
    browserName: profile.browserName,
    channel: profile.channel,
    headless: profile.headless,
    launchArgs: profile.launchArgs,
    browserVersion: profile.browserVersion,
    userAgent: profile.userAgent,
    webglVendor: profile.webglVendor,
    webglRenderer: profile.webglRenderer,
    webglVersion: profile.webglVersion,
    contextLost: profile.contextLost,
    probeDurationMs: profile.probeDurationMs,
  }), "utf8");
  if (sha256(profileBytes) !== preflight.profileSha256) {
    fail("HARDWARE_PROFILE_INVALID", "The selected browser profile hash does not match its serialized profile.");
  }
  const identityText = `${profile.webglVendor} ${profile.webglRenderer}`.toLowerCase();
  if (
    SOFTWARE_MARKERS.some((marker) => identityText.includes(marker))
    || !HARDWARE_MARKERS.some((marker) => identityText.includes(marker))
  ) {
    fail("HARDWARE_PROFILE_INVALID", "The selected WebGL profile is not explicit hardware rendering.");
  }
  const selected = preflight.attempts.filter((attempt) => attempt.outcome === "selected_hardware");
  const finalAttempt = preflight.attempts.at(-1);
  if (selected.length !== 1 || finalAttempt?.outcome !== "selected_hardware" || finalAttempt.evidence === undefined) {
    fail("HARDWARE_PROFILE_INVALID", "The preflight must end with exactly one selected hardware attempt.");
  }
  const selectedMaterial = {
    ...finalAttempt.candidate,
    schemaVersion: HARDWARE_PROFILE_SCHEMA,
    ...finalAttempt.evidence,
  };
  if (stableCanonicalJson(toCanonicalJson(selectedMaterial)) !== stableCanonicalJson(toCanonicalJson(profile))) {
    fail("HARDWARE_PROFILE_INVALID", "The selected attempt and selected hardware profile disagree.");
  }
}

async function decodeOpaqueRgb8Png(bytes: Buffer, label: string): Promise<DecodedRgb> {
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: WIDTH * HEIGHT }).metadata();
  } catch (error) {
    fail("IMAGE_INVALID", `${label} is not a valid PNG.`, error);
  }
  if (
    metadata.format !== "png"
    || metadata.width !== WIDTH
    || metadata.height !== HEIGHT
    || metadata.channels !== CHANNELS
    || metadata.hasAlpha
    || metadata.depth !== "uchar"
    || metadata.space !== "srgb"
    || metadata.isPalette
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || (metadata.bitsPerSample !== undefined && metadata.bitsPerSample !== 8)
    || (metadata.orientation !== undefined && metadata.orientation !== 1)
    || metadata.icc !== undefined
    || metadata.exif !== undefined
    || metadata.xmp !== undefined
    || metadata.iptc !== undefined
  ) {
    fail("IMAGE_INVALID", `${label} must be an opaque, unprofiled RGB8 sRGB PNG at exactly 1600x900.`);
  }
  try {
    const decoded = await sharp(bytes, { failOn: "error", limitInputPixels: WIDTH * HEIGHT })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== WIDTH
      || decoded.info.height !== HEIGHT
      || decoded.info.channels !== CHANNELS
      || decoded.data.length !== WIDTH * HEIGHT * CHANNELS
    ) {
      fail("IMAGE_INVALID", `${label} did not decode to the required RGB8 raster.`);
    }
    return { bytes: decoded.data, width: WIDTH, height: HEIGHT };
  } catch (error) {
    if (error instanceof GrandHallVisibleFirstComparisonError) throw error;
    fail("IMAGE_INVALID", `${label} could not be decoded.`, error);
  }
}

function backgroundCoverage(rgb: Buffer): {
  readonly backgroundRgb: readonly [16, 18, 23];
  readonly nonBackgroundPixelCount: number;
  readonly nonBackgroundPixelRatio: number;
} {
  let nonBackgroundPixelCount = 0;
  for (let offset = 0; offset < rgb.length; offset += CHANNELS) {
    if (
      Math.abs((rgb[offset] ?? 0) - 16) > 6
      || Math.abs((rgb[offset + 1] ?? 0) - 18) > 6
      || Math.abs((rgb[offset + 2] ?? 0) - 23) > 6
    ) {
      nonBackgroundPixelCount += 1;
    }
  }
  return {
    backgroundRgb: [16, 18, 23],
    nonBackgroundPixelCount,
    nonBackgroundPixelRatio: nonBackgroundPixelCount / (WIDTH * HEIGHT),
  };
}

function exactDirectoryInventory(expectedNames: readonly string[], actualNames: readonly string[], label: string): void {
  const expected = [...expectedNames].sort((left, right) => left.localeCompare(right));
  const actual = [...actualNames].sort((left, right) => left.localeCompare(right));
  if (stableCanonicalJson(toCanonicalJson(expected)) !== stableCanonicalJson(toCanonicalJson(actual))) {
    fail("INVENTORY_INVALID", `${label} has missing or unexpected entries.`);
  }
}

async function validateLane(
  bundleRoot: string,
  receipt: z.infer<typeof BakeoffReceiptSchema>,
  lane: z.infer<typeof LaneReceiptSchema>,
  cameraProfile: z.infer<typeof FixedCameraProfileSchema>,
): Promise<ValidatedRadianceLane | null> {
  const representation = lane.representation;
  const contract = REPRESENTATION_CONTRACT[representation];
  if (
    lane.radianceRankingEligible !== contract.radianceRankingEligible
    || lane.browserProfileSha256 !== receipt.browserHardwarePreflight.profileSha256
  ) {
    fail("LANE_INVALID", `${representation} lane authority or hardware binding is invalid.`);
  }
  assertResidencySequence(representation, lane.captures);
  const laneRoot = join(bundleRoot, representation);
  await assertDirectDirectory(laneRoot, `${representation} lane directory`);
  const expectedNames = lane.captures.flatMap((capture) => {
    const stem = captureStem(representation, capture);
    return [`${stem}.json`, `${stem}.png`];
  });
  const entries = await readdir(laneRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("INVENTORY_INVALID", `${representation} lane may contain only direct regular files.`);
  }
  exactDirectoryInventory(expectedNames, entries.map((entry) => entry.name), `${representation} lane`);

  const screenshotHashes = new Set<string>();
  let selectedRecord: (ReadFileReceipt & { readonly fileName: string }) | undefined;
  let selectedScreenshot: (ReadFileReceipt & { readonly fileName: string }) | undefined;
  let selectedDecoded: DecodedRgb | undefined;
  let laneDecoded: DecodedRgb | undefined;
  const decodedBySha256 = new Map<string, DecodedRgb>();
  let comparisonBindings: unknown;
  for (const capture of lane.captures) {
    const stem = captureStem(representation, capture);
    const recordName = `${stem}.json`;
    const screenshotName = `${stem}.png`;
    const recordPath = safePersistedLeaf(bundleRoot, capture.recordPath, representation, recordName);
    const screenshotPath = safePersistedLeaf(bundleRoot, capture.screenshotPath, representation, screenshotName);
    const record = await readStableRegularFile(recordPath, `${representation} capture record`);
    const screenshot = await readStableRegularFile(screenshotPath, `${representation} screenshot`);
    if (record.sha256 !== capture.recordSha256 || screenshot.sha256 !== capture.screenshotSha256) {
      fail("HASH_MISMATCH", `${representation} capture bytes do not match the v3 receipt.`);
    }
    screenshotHashes.add(screenshot.sha256);
    let captureDecoded = decodedBySha256.get(screenshot.sha256);
    if (captureDecoded === undefined) {
      captureDecoded = await decodeOpaqueRgb8Png(screenshot.bytes, `${representation} screenshot`);
      decodedBySha256.set(screenshot.sha256, captureDecoded);
    }
    laneDecoded ??= captureDecoded;

    let benchmark;
    try {
      benchmark = VisualLineageBenchmarkV0Schema.parse(parseGrandHallT554StrictJson(record.bytes));
    } catch (error) {
      fail("CAPTURE_RECORD_INVALID", `${representation} capture record does not satisfy visual-lineage v0.`, error);
    }
    const representationRecord = benchmark.representations[0];
    if (benchmark.representations.length !== 1 || representationRecord === undefined) {
      fail("CAPTURE_RECORD_INVALID", `${representation} capture must contain exactly one representation.`);
    }
    const screenshotReceipt = representationRecord.screenshot;
    const timings = representationRecord.timings;
    const environment = representationRecord.environment;
    const limitations = representationRecord.limitations;
    const sourceMembers = representationRecord.sourceMembers;
    const fixtureSettings = representationRecord.fixtureSettings;
    const coverage = backgroundCoverage(captureDecoded.bytes);
    const expectedBenchmarkId = `grand-hall-${representation}-source-pose-local-${capture.residencyState === "cold_load" ? "cold-load-1" : `resident-capture-${String(capture.residencyRunOrdinal)}`}-${representation === "ply" ? "structural-diagnostic" : "diagnostic"}-controlled-120w-600f-v1`;
    if (
      benchmark.benchmarkId !== expectedBenchmarkId
      || benchmark.roomRef !== "trades-hall/grand-hall"
      || benchmark.gitSha !== receipt.gitSha
      || benchmark.worktreeDirty
      || benchmark.camera.id !== CAMERA_ID
      || stableCanonicalJson(toCanonicalJson(benchmark.camera.position))
        !== stableCanonicalJson(toCanonicalJson(cameraProfile.frames.three.position))
      || benchmark.camera.fov !== cameraProfile.projection.verticalFieldOfViewDegrees
      || benchmark.camera.near !== cameraProfile.projection.nearClipMetres
      || benchmark.camera.far !== cameraProfile.projection.farClipMetres
      || benchmark.camera.aspect !== cameraProfile.projection.aspect
      || benchmark.viewport.width !== WIDTH
      || benchmark.viewport.height !== HEIGHT
      || benchmark.viewport.devicePixelRatio !== 1
      || benchmark.viewport.width !== cameraProfile.output.width
      || benchmark.viewport.height !== cameraProfile.output.height
      || benchmark.viewport.devicePixelRatio !== cameraProfile.output.devicePixelRatio
      || representationRecord.id !== contract.representationId
      || representationRecord.format !== contract.format
      || representationRecord.status !== "diagnostic"
      || representationRecord.visualAssessment !== "not_reviewed"
      || representationRecord.cameraRegistration !== "inspection_only"
      || representationRecord.rendererProfile !== (representation === "ply" ? "controlled_explicit" : "diagnostic_resolved_defaults")
      || representationRecord.warmupFrameCount !== 120
      || representationRecord.frameSampleCount !== 600
      || fixtureSettings === undefined
      || stableCanonicalJson(toCanonicalJson(fixtureSettings.camera.position))
        !== stableCanonicalJson(toCanonicalJson(cameraProfile.frames.three.position))
      || stableCanonicalJson(toCanonicalJson(fixtureSettings.camera.target))
        !== stableCanonicalJson(toCanonicalJson(cameraProfile.frames.three.target))
      || fixtureSettings.camera.fov !== cameraProfile.projection.verticalFieldOfViewDegrees
      || fixtureSettings.camera.near !== cameraProfile.projection.nearClipMetres
      || fixtureSettings.camera.far !== cameraProfile.projection.farClipMetres
      || (representation !== "ply" && representationRecord.decodedSplatCount !== 6_019_684)
      || sourceMembers?.length !== contract.sourceMemberCount
      || sourceMembers.reduce((sum, member) => sum + member.sizeBytes, 0) !== contract.sourceSizeBytes
      || screenshotReceipt === undefined
      || screenshotReceipt.sha256 !== screenshot.sha256
      || screenshotReceipt.sizeBytes !== screenshot.sizeBytes
      || screenshotReceipt.width !== WIDTH
      || screenshotReceipt.height !== HEIGHT
      || stableCanonicalJson(toCanonicalJson(screenshotReceipt.backgroundRgb))
        !== stableCanonicalJson(toCanonicalJson(coverage.backgroundRgb))
      || screenshotReceipt.nonBackgroundPixelCount !== coverage.nonBackgroundPixelCount
      || screenshotReceipt.nonBackgroundPixelRatio !== coverage.nonBackgroundPixelRatio
      || timings === undefined
      || (capture.residencyState === "resident" && timings.loadMs !== 0)
      || environment === undefined
      || environment.browser !== receipt.browserHardwarePreflight.selectedProfile.userAgent
      || environment.webglVendor !== receipt.browserHardwarePreflight.selectedProfile.webglVendor
      || environment.webglRenderer !== receipt.browserHardwarePreflight.selectedProfile.webglRenderer
      || environment.webglVersion !== receipt.browserHardwarePreflight.selectedProfile.webglVersion
      || environment.contextLost
      || (representation === "ply" && representationRecord.plyMeshRuntimeState === undefined)
    ) {
      fail("CAPTURE_RECORD_INVALID", `${representation} capture record deviates from the v3 controlled contract.`);
    }
    safePersistedLeaf(bundleRoot, screenshotReceipt.path, representation, screenshotName);
    parseMarker(limitations, CAMERA_MARKER, CameraMarkerSchema, "camera marker");
    const residencyMarker = parseMarker(limitations, RESIDENCY_MARKER, ResidencyMarkerSchema, "residency marker");
    const hardwareMarker = parseMarker(limitations, HARDWARE_MARKER, HardwareMarkerSchema, "hardware marker");
    if (
      stableCanonicalJson(toCanonicalJson(residencyMarker)) !== stableCanonicalJson(toCanonicalJson({
        representation,
        runOrdinal: capture.runOrdinal,
        residencyState: capture.residencyState,
        residencyRunOrdinal: capture.residencyRunOrdinal,
        sourceRequestCountBefore: capture.sourceRequestCountBefore,
        sourceRequestCountAfter: capture.sourceRequestCountAfter,
        runtimeInstanceId: capture.runtimeInstanceId,
        renderedFrameCountBefore: capture.renderedFrameCountBefore,
        renderedFrameCountAfter: capture.renderedFrameCountAfter,
        browserProcessScope: "one_representation_one_cold_load_plus_three_resident_captures",
      }))
      || hardwareMarker.profileSha256 !== receipt.browserHardwarePreflight.profileSha256
      || hardwareMarker.browserVersion !== receipt.browserHardwarePreflight.selectedProfile.browserVersion
      || stableCanonicalJson(toCanonicalJson(fixtureSettings.camera.target))
        !== stableCanonicalJson(toCanonicalJson(receipt.cameraProfile.target))
    ) {
      fail("CAPTURE_RECORD_INVALID", `${representation} capture marker binding is invalid.`);
    }
    const bindings = {
      worktreeSourceStateSha256: benchmark.worktreeSourceStateSha256 ?? null,
      camera: benchmark.camera,
      viewport: benchmark.viewport,
      rendererSettings: benchmark.rendererSettings,
      fixtureSettings: representationRecord.fixtureSettings,
      actualCamera: representationRecord.actualCamera,
      actualRenderer: representationRecord.actualRenderer,
      sparkRuntimeState: representationRecord.sparkRuntimeState ?? null,
    };
    if (comparisonBindings === undefined) comparisonBindings = bindings;
    else if (
      stableCanonicalJson(toCanonicalJson(bindings))
      !== stableCanonicalJson(toCanonicalJson(comparisonBindings))
    ) {
      fail("CAPTURE_STATE_MISMATCH", `${representation} captures do not share one exact controlled state.`);
    }
    if (capture.runOrdinal === 1 && representation !== "ply") {
      selectedRecord = { ...record, fileName: recordName };
      selectedScreenshot = { ...screenshot, fileName: screenshotName };
      selectedDecoded = laneDecoded;
    }
  }
  if (screenshotHashes.size !== 1) {
    fail("RESIDENCY_INVALID", `${representation} screenshots are not byte-stable across all four captures.`);
  }
  if (representation === "ply") return null;
  if (selectedRecord === undefined || selectedScreenshot === undefined || selectedDecoded === undefined) {
    fail("LANE_INVALID", `${representation} cold-load evidence is missing.`);
  }
  return {
    representation,
    selectedRecord,
    selectedScreenshot,
    decoded: selectedDecoded,
    runtimeInstanceId: lane.captures[0]?.runtimeInstanceId ?? fail("LANE_INVALID", "Runtime identity is missing."),
    screenshotSha256: lane.captures[0]?.screenshotSha256 ?? fail("LANE_INVALID", "Screenshot hash is missing."),
    comparisonBindings,
    stages: lane.captures.map((capture) => ({
      runOrdinal: capture.runOrdinal,
      residencyState: capture.residencyState,
      residencyRunOrdinal: capture.residencyRunOrdinal,
      renderedFrameCountBefore: capture.renderedFrameCountBefore,
      renderedFrameCountAfter: capture.renderedFrameCountAfter,
    })),
  };
}

async function validateBundle(bakeoffReceiptPath: string): Promise<{
  readonly bundleRoot: string;
  readonly bakeoffReceipt: ReadFileReceipt & { readonly fileName: string };
  readonly parsed: z.infer<typeof BakeoffReceiptSchema>;
  readonly sog: ValidatedRadianceLane;
  readonly spz: ValidatedRadianceLane;
}> {
  if (!isAbsolute(bakeoffReceiptPath) || resolve(bakeoffReceiptPath) !== bakeoffReceiptPath) {
    fail("ARGUMENT_INVALID", "--bakeoff-receipt must be an absolute, normalized path.");
  }
  const bundleRoot = await assertDirectDirectory(dirname(bakeoffReceiptPath), "Bake-off bundle root");
  const receiptPath = join(bundleRoot, basename(bakeoffReceiptPath));
  if (receiptPath !== bakeoffReceiptPath) {
    fail("PATH_ESCAPE", "The bake-off receipt must be a direct child of its canonical bundle root.");
  }
  const bakeoffReceipt = await readStableRegularFile(receiptPath, "Bake-off v3 receipt");
  let parsed;
  try {
    parsed = BakeoffReceiptSchema.parse(parseGrandHallT554StrictJson(bakeoffReceipt.bytes));
  } catch (error) {
    fail("BAKEOFF_RECEIPT_INVALID", "The bake-off receipt is not the strict hardware-v3 contract.", error);
  }
  if (Date.parse(parsed.completedAt) < Date.parse(parsed.startedAt)) {
    fail("BAKEOFF_RECEIPT_INVALID", "The bake-off completion precedes its start.");
  }
  assertHardwareProfile(parsed);
  if (
    parsed.lanes.map((lane) => lane.representation).join(",") !== "sog,spz,ply"
    || new Set(parsed.lanes.map((lane) => lane.runnerPid)).size !== 3
  ) {
    fail("BAKEOFF_RECEIPT_INVALID", "The v3 receipt must contain ordered, process-isolated SOG, SPZ, and PLY lanes.");
  }
  const lanePorts = parsed.lanes.map((lane) => {
    const url = new URL(lane.baseUrl);
    if (
      url.protocol !== "http:"
      || url.hostname !== "127.0.0.1"
      || url.username !== ""
      || url.password !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
      || url.port === ""
    ) {
      fail("BAKEOFF_RECEIPT_INVALID", "Every capture lane must use a direct loopback HTTP origin.");
    }
    return url.port;
  });
  if (new Set(lanePorts).size !== 3) fail("BAKEOFF_RECEIPT_INVALID", "Capture lane ports must be distinct.");
  const cameraName = basename(parsed.cameraProfile.artifactPath.replaceAll("\\", "/"));
  const expectedCameraName = `${CAMERA_ID}-${parsed.cameraProfile.sha256.slice("sha256:".length)}.json`;
  if (cameraName !== expectedCameraName) fail("PATH_MISMATCH", "The camera artifact filename is not content-addressed.");
  const cameraPath = safePersistedLeaf(bundleRoot, parsed.cameraProfile.artifactPath, null, expectedCameraName);
  const cameraArtifact = await readStableRegularFile(cameraPath, "Camera profile artifact");
  if (cameraArtifact.sha256 !== parsed.cameraProfile.sha256) fail("HASH_MISMATCH", "The camera profile artifact hash is invalid.");
  let cameraProfile: z.infer<typeof FixedCameraProfileSchema>;
  try {
    cameraProfile = FixedCameraProfileSchema.parse(parseGrandHallT554StrictJson(cameraArtifact.bytes));
  } catch (error) {
    fail("CAMERA_PROFILE_INVALID", "The bundled fixed-camera artifact does not satisfy its exact v1 schema.", error);
  }
  if (
    stableCanonicalJson(toCanonicalJson(cameraProfile.frames.three.target))
      !== stableCanonicalJson(toCanonicalJson(parsed.cameraProfile.target))
    || stableCanonicalJson(toCanonicalJson(cameraProfile.frames.three.up))
      !== stableCanonicalJson(toCanonicalJson([0, 1, 0]))
    || cameraProfile.output.width !== WIDTH
    || cameraProfile.output.height !== HEIGHT
    || cameraProfile.output.devicePixelRatio !== 1
  ) {
    fail("CAMERA_PROFILE_INVALID", "The fixed-camera artifact does not bind the receipt target, Y-up frame, projection, or viewport.");
  }

  const rootEntries = await readdir(bundleRoot, { withFileTypes: true });
  exactDirectoryInventory(
    [basename(receiptPath), expectedCameraName, "sog", "spz", "ply"],
    rootEntries.map((entry) => entry.name),
    "Bake-off bundle root",
  );
  if (rootEntries.some((entry) => entry.isSymbolicLink())) fail("INVENTORY_INVALID", "The bundle root contains a symbolic link.");

  const validated = await Promise.all(parsed.lanes.map((lane) => validateLane(bundleRoot, parsed, lane, cameraProfile)));
  const sog = validated[0];
  const spz = validated[1];
  if (
    sog === undefined
    || spz === undefined
    || sog === null
    || spz === null
    || sog.representation !== "sog"
    || spz.representation !== "spz"
  ) {
    fail("LANE_INVALID", "Only ordered SOG and SPZ lanes may enter the radiance comparison.");
  }
  if (
    stableCanonicalJson(toCanonicalJson(sog.comparisonBindings))
    !== stableCanonicalJson(toCanonicalJson(spz.comparisonBindings))
  ) {
    fail("CAPTURE_STATE_MISMATCH", "SOG and SPZ were not captured with the same exact camera, renderer, fixture, and Spark state.");
  }
  return {
    bundleRoot,
    bakeoffReceipt: { ...bakeoffReceipt, fileName: basename(receiptPath) },
    parsed,
    sog,
    spz,
  };
}

function comparisonRaster(left: Buffer, right: Buffer): {
  readonly sideBySide: Buffer;
  readonly difference: Buffer;
  readonly metrics: Readonly<Record<string, unknown>>;
} {
  const pixelCount = WIDTH * HEIGHT;
  const sampleCount = pixelCount * CHANNELS;
  const difference = Buffer.allocUnsafe(sampleCount);
  const channelAbsoluteSums = [0, 0, 0];
  let absoluteSum = 0;
  let squaredSum = 0;
  let changedPixels = 0;
  let changedSamples = 0;
  let maximumChannelDelta = 0;
  let clippedSamples = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let pixelChanged = false;
    const offset = pixel * CHANNELS;
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const sampleIndex = offset + channel;
      const delta = Math.abs((left[sampleIndex] ?? 0) - (right[sampleIndex] ?? 0));
      difference[sampleIndex] = Math.min(255, delta * DIFFERENCE_AMPLIFICATION);
      channelAbsoluteSums[channel] = (channelAbsoluteSums[channel] ?? 0) + delta;
      absoluteSum += delta;
      squaredSum += delta * delta;
      if (delta > 0) {
        pixelChanged = true;
        changedSamples += 1;
      }
      if (delta > maximumChannelDelta) maximumChannelDelta = delta;
      if (delta * DIFFERENCE_AMPLIFICATION > 255) clippedSamples += 1;
    }
    if (pixelChanged) changedPixels += 1;
  }
  const meanSquaredError = squaredSum / sampleCount;
  const rootMeanSquaredError = Math.sqrt(meanSquaredError);
  const sideWidth = WIDTH * 2 + GAP_WIDTH;
  const sideBySide = Buffer.alloc(sideWidth * HEIGHT * CHANNELS);
  for (let y = 0; y < HEIGHT; y += 1) {
    const sourceStart = y * WIDTH * CHANNELS;
    const sourceEnd = sourceStart + WIDTH * CHANNELS;
    const rowStart = y * sideWidth * CHANNELS;
    left.copy(sideBySide, rowStart, sourceStart, sourceEnd);
    for (let x = 0; x < GAP_WIDTH; x += 1) {
      const gapOffset = rowStart + (WIDTH + x) * CHANNELS;
      sideBySide[gapOffset] = GAP_RGB[0];
      sideBySide[gapOffset + 1] = GAP_RGB[1];
      sideBySide[gapOffset + 2] = GAP_RGB[2];
    }
    right.copy(sideBySide, rowStart + (WIDTH + GAP_WIDTH) * CHANNELS, sourceStart, sourceEnd);
  }
  return {
    sideBySide,
    difference,
    metrics: {
      exactEquality: changedSamples === 0,
      width: WIDTH,
      height: HEIGHT,
      totalPixels: pixelCount,
      changedPixels,
      changedPixelRatio: changedPixels / pixelCount,
      totalRgbSamples: sampleCount,
      changedRgbSamples: changedSamples,
      changedRgbSampleRatio: changedSamples / sampleCount,
      perChannelMeanAbsoluteErrorBytes: {
        red: (channelAbsoluteSums[0] ?? 0) / pixelCount,
        green: (channelAbsoluteSums[1] ?? 0) / pixelCount,
        blue: (channelAbsoluteSums[2] ?? 0) / pixelCount,
      },
      aggregateMeanAbsoluteErrorBytes: absoluteSum / sampleCount,
      normalizedMeanAbsoluteError: absoluteSum / sampleCount / 255,
      meanSquaredErrorBytesSquared: meanSquaredError,
      rootMeanSquaredErrorBytes: rootMeanSquaredError,
      peakSignalToNoiseRatioDb: meanSquaredError === 0
        ? null
        : 20 * Math.log10(255 / rootMeanSquaredError),
      maximumChannelDelta,
      differenceAmplificationFactor: DIFFERENCE_AMPLIFICATION,
      differenceX8ClippedRgbSampleCount: clippedSamples,
    },
  };
}

async function encodePng(raw: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(raw, { raw: { width, height, channels: CHANNELS } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
}

function outputReceipt(bytes: Buffer, fileName: string, width: number, height: number) {
  return { fileName, sha256: sha256(bytes), sizeBytes: bytes.length, width, height };
}

export async function buildGrandHallVisibleFirstRadianceComparison(
  bakeoffReceiptPath: string,
): Promise<GrandHallVisibleFirstComparisonArtifacts> {
  const input = await validateBundle(bakeoffReceiptPath);
  const compared = comparisonRaster(input.sog.decoded.bytes, input.spz.decoded.bytes);
  const sideWidth = WIDTH * 2 + GAP_WIDTH;
  const [sideBySidePng, absoluteDifferencePng] = await Promise.all([
    encodePng(compared.sideBySide, sideWidth, HEIGHT),
    encodePng(compared.difference, WIDTH, HEIGHT),
  ]);
  const receipt: Readonly<Record<string, unknown>> = {
    schemaVersion: GRAND_HALL_VISIBLE_FIRST_COMPARISON_SCHEMA,
    authority: "none",
    comparisonKind: "symmetric_representation_disagreement",
    decisionStatus: "not_evaluated",
    winner: null,
    visualAcceptance: "not_reviewed",
    rankingPermitted: false,
    sourceFidelityReferenceAvailable: false,
    humanReviewRequired: true,
    input: {
      bakeoffReceipt: {
        fileName: input.bakeoffReceipt.fileName,
        sha256: input.bakeoffReceipt.sha256,
        sizeBytes: input.bakeoffReceipt.sizeBytes,
        schemaVersion: input.parsed.schemaVersion,
        gitSha: input.parsed.gitSha,
      },
      cameraProfile: {
        profileId: input.parsed.cameraProfile.profileId,
        sha256: input.parsed.cameraProfile.sha256,
        target: input.parsed.cameraProfile.target,
      },
      browserHardwareProfile: {
        profileSha256: input.parsed.browserHardwarePreflight.profileSha256,
        candidateId: input.parsed.browserHardwarePreflight.selectedProfile.candidateId,
        browserVersion: input.parsed.browserHardwarePreflight.selectedProfile.browserVersion,
        webglVendor: input.parsed.browserHardwarePreflight.selectedProfile.webglVendor,
        webglRenderer: input.parsed.browserHardwarePreflight.selectedProfile.webglRenderer,
        webglVersion: input.parsed.browserHardwarePreflight.selectedProfile.webglVersion,
        contextLost: false,
      },
      selectedCaptures: {
        sog: {
          representationId: REPRESENTATION_CONTRACT.sog.representationId,
          record: {
            fileName: input.sog.selectedRecord.fileName,
            sha256: input.sog.selectedRecord.sha256,
            sizeBytes: input.sog.selectedRecord.sizeBytes,
          },
          screenshot: {
            fileName: input.sog.selectedScreenshot.fileName,
            sha256: input.sog.selectedScreenshot.sha256,
            sizeBytes: input.sog.selectedScreenshot.sizeBytes,
          },
        },
        spz: {
          representationId: REPRESENTATION_CONTRACT.spz.representationId,
          record: {
            fileName: input.spz.selectedRecord.fileName,
            sha256: input.spz.selectedRecord.sha256,
            sizeBytes: input.spz.selectedRecord.sizeBytes,
          },
          screenshot: {
            fileName: input.spz.selectedScreenshot.fileName,
            sha256: input.spz.selectedScreenshot.sha256,
            sizeBytes: input.spz.selectedScreenshot.sizeBytes,
          },
        },
      },
      residentStability: {
        sog: {
          runtimeInstanceId: input.sog.runtimeInstanceId,
          allFourScreenshotsByteIdentical: true,
          screenshotSha256: input.sog.screenshotSha256,
          stages: input.sog.stages,
        },
        spz: {
          runtimeInstanceId: input.spz.runtimeInstanceId,
          allFourScreenshotsByteIdentical: true,
          screenshotSha256: input.spz.screenshotSha256,
          stages: input.spz.stages,
        },
      },
      plyDisposition: "structural_only_excluded_from_radiance_comparison",
    },
    imageContract: {
      width: WIDTH,
      height: HEIGHT,
      channels: "RGB",
      sampleDepth: "uint8",
      colourSpace: "srgb_without_embedded_profile",
      alpha: "absent",
      sideBySideLayout: {
        left: "sog",
        right: "spz",
        gapWidthPixels: GAP_WIDTH,
        gapRgb: GAP_RGB,
      },
      absoluteDifferenceFormula: "min(255, abs(sogRgb8 - spzRgb8) * 8) per RGB channel",
    },
    metrics: compared.metrics,
    runtimeAttestation: {
      nodeVersion: process.version,
      sharpVersion: sharp.versions.sharp,
      libvipsVersion: sharp.versions.vips,
      platform: platform(),
      architecture: arch(),
      outputEncoding: "png_rgb8_no_metadata",
      differenceAmplificationFactor: DIFFERENCE_AMPLIFICATION,
    },
    generatedFiles: [
      outputReceipt(sideBySidePng, GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME, sideWidth, HEIGHT),
      outputReceipt(absoluteDifferencePng, GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME, WIDTH, HEIGHT),
    ],
    outputInventory: [
      GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME,
      GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME,
      GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME,
    ],
    limitations: COMPARISON_LIMITATIONS,
  };
  return {
    sideBySidePng,
    absoluteDifferencePng,
    receiptJson: canonicalBytes(receipt),
    receipt,
  };
}

async function assertOutputLocation(
  bakeoffReceiptPath: string,
  outputDirectory: string,
): Promise<{ readonly target: string; readonly parent: string }> {
  if (!isAbsolute(outputDirectory) || resolve(outputDirectory) !== outputDirectory) {
    fail("ARGUMENT_INVALID", "--output must be an absolute, normalized path.");
  }
  const target = outputDirectory;
  const parent = await assertDirectDirectory(dirname(target), "Output parent directory");
  if (join(parent, basename(target)) !== target) fail("OUTPUT_UNSAFE", "Output must be a direct child of its canonical parent.");
  const bundleRoot = await realpath(dirname(bakeoffReceiptPath));
  if (relativeIsWithin(bundleRoot, target) || relativeIsWithin(target, bundleRoot)) {
    fail("OUTPUT_UNSAFE", "Output must not contain or be contained by the input bundle.");
  }
  return { target, parent };
}

async function writeExclusive(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (result.bytesWritten <= 0) fail("OUTPUT_WRITE_FAILED", "An output write made no progress.");
    offset += result.bytesWritten;
  }
  await handle.sync();
}

interface ClaimedComparisonStagingDirectory {
  readonly target: string;
  readonly staging: string;
  readonly identity: FileIdentity;
}

export interface GrandHallVisibleFirstComparisonWriteTestHooks {
  readonly beforePublish?: (input: {
    readonly stagingDirectory: string;
    readonly targetDirectory: string;
  }) => Promise<void>;
  readonly afterPublishedIdentityRead?: (input: {
    readonly targetDirectory: string;
  }) => Promise<void>;
}

export interface GrandHallVisibleFirstComparisonWriteOptions {
  readonly testHooks?: GrandHallVisibleFirstComparisonWriteTestHooks;
}

async function requireAbsent(path: string, label: string): Promise<void> {
  if (await pathExists(path)) fail("OUTPUT_EXISTS", `${label} must remain absent: ${path}`);
}

async function claimComparisonStagingDirectory(
  location: { readonly target: string; readonly parent: string },
): Promise<ClaimedComparisonStagingDirectory> {
  await requireAbsent(location.target, "Comparison output");
  const staging = await mkdtemp(join(location.parent, `.${basename(location.target)}.staging-`));
  const metadata = await lstat(staging);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(staging) !== staging
  ) {
    fail("OUTPUT_UNSAFE", "Claimed comparison staging directory is not direct.");
  }
  return { target: location.target, staging, identity: identity(metadata) };
}

async function requireComparisonStagingIdentity(
  claim: ClaimedComparisonStagingDirectory,
): Promise<void> {
  const metadata = await lstat(claim.staging).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Claimed comparison staging directory disappeared.", error));
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || !sameFileSystemObject(claim.identity, identity(metadata))
    || await realpath(claim.staging) !== claim.staging
  ) {
    fail("OUTPUT_UNSAFE", "Claimed comparison staging directory identity changed.");
  }
}

async function writeOutputFile(
  claim: ClaimedComparisonStagingDirectory,
  fileName: string,
  bytes: Buffer,
): Promise<void> {
  await requireComparisonStagingIdentity(claim);
  const path = resolve(claim.staging, fileName);
  if (dirname(path) !== claim.staging) fail("OUTPUT_UNSAFE", `Unsafe comparison output member: ${fileName}`);
  const handle = await open(path, "wx", 0o600);
  try {
    await writeExclusive(handle, bytes);
  } finally {
    await handle.close();
  }
  await requireComparisonStagingIdentity(claim);
}

async function publishComparisonStagingDirectory(
  claim: ClaimedComparisonStagingDirectory,
  hooks: GrandHallVisibleFirstComparisonWriteTestHooks | undefined,
): Promise<void> {
  await requireComparisonStagingIdentity(claim);
  await hooks?.beforePublish?.({ stagingDirectory: claim.staging, targetDirectory: claim.target });
  await requireComparisonStagingIdentity(claim);
  await requireAbsent(claim.target, "Comparison output");
  await rename(claim.staging, claim.target).catch((error: unknown) =>
    fail("OUTPUT_EXISTS", "Atomic comparison publication failed because its output target is no longer absent.", error));
  const published = await lstat(claim.target).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Published comparison output disappeared.", error));
  await hooks?.afterPublishedIdentityRead?.({ targetDirectory: claim.target });
  const physical = await realpath(claim.target).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Published comparison output cannot be resolved.", error));
  const publishedAfter = await lstat(claim.target).catch((error: unknown) =>
    fail("OUTPUT_UNSAFE", "Published comparison output changed after publication.", error));
  if (
    !published.isDirectory()
    || published.isSymbolicLink()
    || !publishedAfter.isDirectory()
    || publishedAfter.isSymbolicLink()
    || !sameFileSystemObject(claim.identity, identity(published))
    || !sameFileSystemObject(claim.identity, identity(publishedAfter))
    || physical !== claim.target
  ) {
    fail("OUTPUT_UNSAFE", "Published comparison output identity differs from its verified staging directory.");
  }
}

async function cleanupComparisonStagingDirectory(claim: ClaimedComparisonStagingDirectory): Promise<void> {
  try {
    await requireComparisonStagingIdentity(claim);
    await rm(claim.staging, { recursive: true, force: false });
  } catch {
    // Never remove a path after its identity diverges from the staging directory created here.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function writeGrandHallVisibleFirstRadianceComparison(
  bakeoffReceiptPath: string,
  outputDirectory: string,
  options: GrandHallVisibleFirstComparisonWriteOptions = {},
): Promise<Readonly<Record<string, unknown>>> {
  const location = await assertOutputLocation(bakeoffReceiptPath, outputDirectory);
  if (await pathExists(location.target)) fail("OUTPUT_EXISTS", `Refusing to replace existing output: ${location.target}`);
  const artifacts = await buildGrandHallVisibleFirstRadianceComparison(bakeoffReceiptPath);
  const claim = await claimComparisonStagingDirectory(location);
  let published = false;
  try {
    await writeOutputFile(claim, GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME, artifacts.sideBySidePng);
    await writeOutputFile(claim, GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME, artifacts.absoluteDifferencePng);
    await writeOutputFile(claim, GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME, artifacts.receiptJson);
    await requireComparisonStagingIdentity(claim);
    const entries = await readdir(claim.staging, { withFileTypes: true });
    exactDirectoryInventory(
      [
        GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME,
        GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME,
        GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME,
      ],
      entries.map((entry) => entry.name),
      "Comparison output",
    );
    await publishComparisonStagingDirectory(claim, options.testHooks);
    published = true;
    return artifacts.receipt;
  } finally {
    if (!published) await cleanupComparisonStagingDirectory(claim);
  }
}

export async function checkGrandHallVisibleFirstRadianceComparison(
  bakeoffReceiptPath: string,
  outputDirectory: string,
): Promise<Readonly<Record<string, unknown>>> {
  const location = await assertOutputLocation(bakeoffReceiptPath, outputDirectory);
  await assertDirectDirectory(location.target, "Comparison output directory");
  const entries = await readdir(location.target, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("OUTPUT_INVALID", "Comparison output may contain only direct regular files.");
  }
  exactDirectoryInventory(
    [
      GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME,
      GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME,
      GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME,
    ],
    entries.map((entry) => entry.name),
    "Comparison output",
  );
  const actual = await Promise.all([
    readStableRegularFile(join(location.target, GRAND_HALL_VISIBLE_FIRST_SIDE_BY_SIDE_FILENAME), "Side-by-side output"),
    readStableRegularFile(join(location.target, GRAND_HALL_VISIBLE_FIRST_DIFFERENCE_FILENAME), "Difference output"),
    readStableRegularFile(join(location.target, GRAND_HALL_VISIBLE_FIRST_COMPARISON_RECEIPT_FILENAME), "Comparison receipt"),
  ]);
  try {
    const parsedReceipt = parseGrandHallT554StrictJson(actual[2].bytes);
    if (canonicalBytes(parsedReceipt).compare(actual[2].bytes) !== 0) {
      fail("OUTPUT_INVALID", "Comparison receipt is not canonical JSON with one trailing newline.");
    }
  } catch (error) {
    if (error instanceof GrandHallVisibleFirstComparisonError) throw error;
    fail("OUTPUT_INVALID", "Comparison receipt is invalid JSON.", error);
  }
  const expected = await buildGrandHallVisibleFirstRadianceComparison(bakeoffReceiptPath);
  if (
    actual[0].bytes.compare(expected.sideBySidePng) !== 0
    || actual[1].bytes.compare(expected.absoluteDifferencePng) !== 0
    || actual[2].bytes.compare(expected.receiptJson) !== 0
  ) {
    fail("OUTPUT_MISMATCH", "Comparison output is not the deterministic regeneration of its bound input.");
  }
  return expected.receipt;
}

export function parseGrandHallVisibleFirstRadianceComparisonArguments(
  argv: readonly string[],
): GrandHallVisibleFirstComparisonArguments {
  if (argv.length !== 5 || (argv[0] !== "write" && argv[0] !== "check")) {
    fail("USAGE", "Usage: <write|check> --bakeoff-receipt <absolute-v3-receipt> --output <absolute-directory>");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if ((key !== "--bakeoff-receipt" && key !== "--output") || value === undefined || values.has(key)) {
      fail("USAGE", "Arguments must provide --bakeoff-receipt and --output exactly once.");
    }
    values.set(key, value);
  }
  const bakeoffReceiptPath = values.get("--bakeoff-receipt");
  const outputDirectory = values.get("--output");
  if (bakeoffReceiptPath === undefined || outputDirectory === undefined) {
    fail("USAGE", "Arguments must provide --bakeoff-receipt and --output exactly once.");
  }
  return { mode: argv[0], bakeoffReceiptPath, outputDirectory };
}

export async function runGrandHallVisibleFirstRadianceComparisonCli(
  argv: readonly string[],
): Promise<string> {
  const options = parseGrandHallVisibleFirstRadianceComparisonArguments(argv);
  const receipt = options.mode === "write"
    ? await writeGrandHallVisibleFirstRadianceComparison(options.bakeoffReceiptPath, options.outputDirectory)
    : await checkGrandHallVisibleFirstRadianceComparison(options.bakeoffReceiptPath, options.outputDirectory);
  return stableCanonicalJson(toCanonicalJson({
    mode: options.mode,
    outputDirectory: options.outputDirectory,
    schemaVersion: receipt["schemaVersion"],
    authority: receipt["authority"],
    decisionStatus: receipt["decisionStatus"],
  }));
}

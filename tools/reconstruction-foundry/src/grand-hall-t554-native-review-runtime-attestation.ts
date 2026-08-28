import { execFile } from "node:child_process";
import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
  assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1,
  isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
  reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV1,
  verifyGrandHallT554NativeReviewImplementationPack,
  type GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  type GrandHallT554NativeReviewImplementationRuntimeV1,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTATION_CANDIDATE_V1 =
  "venviewer.grand-hall-t554-native-review-runtime-attestation-candidate.v1";

const execFileAsync = promisify(execFile);
const MAXIMUM_CHILD_OUTPUT_BYTES = 256 * 1_024;
const CHILD_TIMEOUT_MS = 60_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RUNTIME_ATTESTATION_CANDIDATE_IDENTITIES = new WeakSet();

const Sha256Schema = z.string().regex(SHA256_PATTERN);
const ManifestBindingSchema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
    ),
    implementationId: z.literal(
      "grand-hall-t554-native-review-workbench-v1",
    ),
    semanticSha256: Sha256Schema,
    fileSha256: Sha256Schema,
    byteLength: z.number().int().positive().max(512 * 1_024),
  })
  .strict();
const RuntimeSchema = z
  .object({
    nodeVersion: z.string().min(1).max(64),
    nodeModulesAbi: z.string().min(1).max(64),
    nodeNapiVersion: z.string().min(1).max(64),
    platform: z.literal("win32"),
    architecture: z.literal("x64"),
  })
  .strict();
const BootstrapSchema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1",
    ),
    sharpVersion: z.literal("0.35.3"),
    libvipsVersion: z.literal("8.18.3"),
    probe: z
      .object({
        byteLength: z.literal(879),
        sha256: z.literal(
          "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078",
        ),
        width: z.literal(3),
        height: z.literal(2),
        channels: z.literal(3),
        decodedRgbByteLength: z.literal(18),
        decodedRgbSha256: z.literal(
          "sha256:a288b3c068b98e427b04229ade2ebd0e0fd65106d8d1fc77e03794878cce90be",
        ),
      })
      .strict(),
    loadedModuleCount: z.number().int().min(4).max(4_096),
    loadedReviewedNativeMembers: z.tuple([
      z.literal(
        "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node",
      ),
      z.literal("vendor/sharp/sharp-win32-x64-0.35.3.node"),
      z.literal("vendor/libvips/libvips-42.dll"),
      z.literal("vendor/libvips/libvips-cpp-8.18.3.dll"),
    ]),
    loadedReviewedNativeMemberSetSha256: z.literal(
      "sha256:fdc9e7a4870e09596b0d2f46094a1f7349c49476428f8da02927261e4c1e0d25",
    ),
    targetNativeModulesAbsentBeforeSharpImport: z.literal(true),
    exactReviewedNativeModuleMultiplicityVerified: z.literal(true),
    loadedModuleInventoryStableAcrossDecode: z.literal(true),
    loadedModuleInventoryStableAfterDllDirectoryRemoval: z.literal(true),
    dllDirectoryConfiguredBeforeSharpImport: z.literal(true),
    dllDirectoryRevalidatedBeforeSharpImport: z.literal(true),
    dllDirectoryRevalidatedAfterDecode: z.literal(true),
    dllDirectoryRemoved: z.literal(true),
    authority: z.literal("none"),
  })
  .strict();
const ProcessIsolationSchema = z
  .object({
    freshChildProcess: z.literal(true),
    execArgvEmpty: z.literal(true),
    environmentCleared: z.literal(true),
    cwdBoundToPackRoot: z.literal(true),
    entryArgvBoundToAttestor: z.literal(true),
    commonJsResolutionRestrictedToBuiltinsAndExactReviewedNativeAddons:
      z.literal(true),
    selectedNetworkEntrypointsPatched: z.literal(true),
    dynamicEsmImportsBoundToExactPackMembers: z.literal(true),
    postImportPackReverified: z.literal(true),
  })
  .strict();
const ChildObservationSchema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-runtime-attestation-child-observation.v1",
    ),
    manifestBinding: ManifestBindingSchema,
    memberInventorySha256: Sha256Schema,
    memberCount: z.number().int().positive().max(128),
    totalMemberBytes: z.number().int().positive().max(128 * 1_024 * 1_024),
    runtime: RuntimeSchema,
    bootstrap: BootstrapSchema,
    processIsolation: ProcessIsolationSchema,
    authority: z.literal("none"),
    productionRuntimeAuthorityMinted: z.literal(false),
  })
  .strict();

type ChildObservation = z.infer<typeof ChildObservationSchema>;

export interface GrandHallT554NativeReviewRuntimeAttestationCandidateV1 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTATION_CANDIDATE_V1;
  readonly manifestBinding: ChildObservation["manifestBinding"];
  readonly memberInventorySha256: ChildObservation["memberInventorySha256"];
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  readonly runtime: GrandHallT554NativeReviewImplementationRuntimeV1;
  readonly bootstrap: ChildObservation["bootstrap"];
  readonly processIsolation: ChildObservation["processIsolation"];
  readonly diagnosticOnly: true;
  readonly authority: "none";
  readonly productionRuntimeAuthorityMinted: false;
}

export type GrandHallT554NativeReviewRuntimeAttestationErrorCode =
  | "ARGUMENT_INVALID"
  | "CANDIDATE_UNVERIFIED"
  | "RUNTIME_INSPECTOR_NOT_REVIEWED"
  | "CHILD_FAILED"
  | "OBSERVATION_INVALID"
  | "CANDIDATE_MISMATCH"
  | "PRODUCTION_AUTHORITY_UNAVAILABLE";

export class GrandHallT554NativeReviewRuntimeAttestationError extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewRuntimeAttestationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GrandHallT554NativeReviewRuntimeAttestationError";
  }
}

function fail(
  code: GrandHallT554NativeReviewRuntimeAttestationErrorCode,
  message: string,
): GrandHallT554NativeReviewRuntimeAttestationError {
  return new GrandHallT554NativeReviewRuntimeAttestationError(code, message);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function reverifyExpectedCandidate(
  implementationPackRoot: string,
  expected: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
): Promise<void> {
  try {
    await reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV1({
      implementationPackRoot,
      candidate: expected,
    });
  } catch {
    throw fail(
      "CANDIDATE_MISMATCH",
      "Implementation-pack candidate did not survive exact runtime re-verification.",
    );
  }
}

function sanitizedChildEnvironment(): NodeJS.ProcessEnv {
  return {};
}

interface FixedReviewedRuntimeInspector {
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
}

function fixedReviewedRuntimeInspector(): FixedReviewedRuntimeInspector | null {
  return Object.freeze({
    sha256:
      "sha256:e6feb1e3266da498aab4417d356da26c83160bed7be24aef7bc0ab4f5455929b",
    byteLength: 304_128,
  });
}

export function isGrandHallT554NativeReviewRuntimeAttestationCandidateV1(
  value: unknown,
): value is GrandHallT554NativeReviewRuntimeAttestationCandidateV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    RUNTIME_ATTESTATION_CANDIDATE_IDENTITIES.has(value)
  );
}

/**
 * Runs the exact pack-owned attestor in a fresh, environment-cleared child.
 * No observation, module path, version, digest, or teardown fact is accepted
 * from the caller.
 */
export async function attestGrandHallT554NativeReviewRuntimeCandidateV1(input: {
  readonly implementationPackRoot: string;
  readonly candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1;
}): Promise<GrandHallT554NativeReviewRuntimeAttestationCandidateV1> {
  if (
    typeof input.implementationPackRoot !== "string" ||
    !isAbsolute(input.implementationPackRoot) ||
    input.implementationPackRoot.startsWith("\\\\") ||
    input.implementationPackRoot.startsWith("//") ||
    input.implementationPackRoot.startsWith("\\\\?\\") ||
    input.implementationPackRoot.startsWith("\\\\.\\")
  ) {
    throw fail("ARGUMENT_INVALID", "Implementation-pack root must be absolute.");
  }
  if (!isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(input.candidate)) {
    throw fail(
      "CANDIDATE_UNVERIFIED",
      "Runtime attestation requires an exact same-instance candidate handle.",
    );
  }
  try {
    assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
      input.candidate,
      input.implementationPackRoot,
    );
  } catch {
    throw fail(
      "CANDIDATE_MISMATCH",
      "Runtime-attestation candidate does not bind this exact pack root.",
    );
  }
  const fixedInspector = fixedReviewedRuntimeInspector();
  if (fixedInspector === null) {
    throw fail(
      "RUNTIME_INSPECTOR_NOT_REVIEWED",
      "No repaired reproducible runtime-inspector release has been fixed for attestation.",
    );
  }
  const inspectorMember = input.candidate.manifest.members.find(
    (member) =>
      member.relativePath ===
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
  );
  if (
    inspectorMember === undefined ||
    inspectorMember.sha256 !== fixedInspector.sha256 ||
    inspectorMember.byteLength !== fixedInspector.byteLength
  ) {
    throw fail(
      "CANDIDATE_MISMATCH",
      "Candidate runtime inspector differs from the private reviewed release anchor.",
    );
  }
  const packRoot = await realpath(input.implementationPackRoot).catch(() => {
    throw fail("ARGUMENT_INVALID", "Implementation-pack root is unavailable.");
  });
  const relativeRoot = relative(
    comparablePath(packRoot),
    comparablePath(input.implementationPackRoot),
  );
  if (relativeRoot !== "") {
    throw fail("ARGUMENT_INVALID", "Implementation-pack root must be canonical.");
  }
  const rootStatsBefore = await lstat(packRoot, { bigint: true }).catch(() => {
    throw fail("ARGUMENT_INVALID", "Implementation-pack root is unavailable.");
  });
  if (!rootStatsBefore.isDirectory() || rootStatsBefore.isSymbolicLink()) {
    throw fail("ARGUMENT_INVALID", "Implementation-pack root is not direct.");
  }
  await reverifyExpectedCandidate(packRoot, input.candidate);
  const attestorPath = resolve(
    packRoot,
    ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER.split("/"),
  );
  const attestorStats = await lstat(attestorPath, { bigint: true }).catch(() => {
    throw fail("ARGUMENT_INVALID", "Runtime-attestor member is unavailable.");
  });
  if (!attestorStats.isFile() || attestorStats.isSymbolicLink() || attestorStats.nlink !== 1n) {
    throw fail("ARGUMENT_INVALID", "Runtime-attestor member is not a direct file.");
  }

  let stdout: string;
  let stderr: string;
  try {
    const result = await execFileAsync(process.execPath, [attestorPath], {
      cwd: packRoot,
      encoding: "utf8",
      env: sanitizedChildEnvironment(),
      maxBuffer: MAXIMUM_CHILD_OUTPUT_BYTES,
      timeout: CHILD_TIMEOUT_MS,
      windowsHide: true,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch {
    throw fail("CHILD_FAILED", "Isolated runtime-attestor child failed closed.");
  }
  if (
    stderr.length !== 0 ||
    Buffer.byteLength(stdout, "utf8") > MAXIMUM_CHILD_OUTPUT_BYTES ||
    !stdout.endsWith("\n") ||
    stdout.slice(0, -1).includes("\n") ||
    stdout.includes("\0")
  ) {
    throw fail("OBSERVATION_INVALID", "Runtime-attestor child output is not exact.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(0, -1)) as unknown;
  } catch {
    throw fail("OBSERVATION_INVALID", "Runtime-attestor child output is not JSON.");
  }
  const observationResult = ChildObservationSchema.safeParse(parsed);
  if (!observationResult.success) {
    throw fail("OBSERVATION_INVALID", "Runtime-attestor child observation is invalid.");
  }
  const observation = observationResult.data;
  await reverifyExpectedCandidate(packRoot, input.candidate);
  const [rootStatsAfter, attestorStatsAfter, attestorCanonicalAfter] =
    await Promise.all([
      lstat(packRoot, { bigint: true }),
      lstat(attestorPath, { bigint: true }),
      realpath(attestorPath),
    ]).catch(() => {
      throw fail(
        "CANDIDATE_MISMATCH",
        "Implementation-pack identity changed after child attestation.",
      );
    });
  if (
    !sameFileState(rootStatsBefore, rootStatsAfter) ||
    !sameFileState(attestorStats, attestorStatsAfter) ||
    comparablePath(attestorCanonicalAfter) !== comparablePath(attestorPath)
  ) {
    throw fail(
      "CANDIDATE_MISMATCH",
      "Implementation-pack identity changed across child attestation.",
    );
  }
  if (
    !canonicalEqual(observation.manifestBinding, input.candidate.manifestBinding) ||
    observation.memberInventorySha256 !== input.candidate.memberInventorySha256 ||
    observation.memberCount !== input.candidate.memberCount ||
    observation.totalMemberBytes !== input.candidate.totalMemberBytes ||
    !canonicalEqual(observation.runtime, input.candidate.manifest.runtime)
  ) {
    throw fail(
      "CANDIDATE_MISMATCH",
      "Runtime observation does not bind the exact caller-anchored candidate.",
    );
  }

  const candidate: GrandHallT554NativeReviewRuntimeAttestationCandidateV1 = deepFreeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTATION_CANDIDATE_V1,
    manifestBinding: observation.manifestBinding,
    memberInventorySha256: observation.memberInventorySha256,
    memberCount: observation.memberCount,
    totalMemberBytes: observation.totalMemberBytes,
    runtime: observation.runtime,
    bootstrap: observation.bootstrap,
    processIsolation: observation.processIsolation,
    diagnosticOnly: true as const,
    authority: "none" as const,
    productionRuntimeAuthorityMinted: false as const,
  });
  RUNTIME_ATTESTATION_CANDIDATE_IDENTITIES.add(candidate);
  return candidate;
}

/**
 * Production runtime authority remains unavailable until a module-private fixed
 * reviewed pack exists. This function cannot mint diagnostic facts into the
 * production authority brand.
 */
export async function attestGrandHallT554NativeReviewProductionRuntimeAuthorityV1(): Promise<GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1> {
  await verifyGrandHallT554NativeReviewImplementationPack();
  throw fail(
    "PRODUCTION_AUTHORITY_UNAVAILABLE",
    "Production runtime authority has no configured fixed reviewed attestor.",
  );
}

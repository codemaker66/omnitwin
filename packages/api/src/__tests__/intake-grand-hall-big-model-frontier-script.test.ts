import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Lcc2HighestDetailFrontierReceiptV0 } from "@omnitwin/reconstruction-foundry-cli";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_MANIFEST_FILE_NAME,
  GRAND_HALL_MANIFEST_SHA256,
  type GrandHallFrontierMemberSpec,
} from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV,
  GRAND_HALL_INTAKE_CONFIRMATION,
  GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV,
  GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS,
  GRAND_HALL_INTAKE_STAGING_TARGET_ID,
  GRAND_HALL_MAX_API_RESPONSE_BYTES,
  GRAND_HALL_MAX_MEMBER_BUFFER_BYTES,
  GRAND_HALL_SOURCE_ADMISSION_FLAG,
  assertGrandHallReviewedGitState,
  grandHallFrontierEvidenceOutput,
  grandHallFrontierIntakeFailureOutput,
  inspectGrandHallGitState,
  parseGrandHallFrontierIntakeArgs,
  readBoundedGrandHallMember,
  runGrandHallFrontierIntake,
  serializeGrandHallFrontierEvidenceReceipt,
  verifyGrandHallMemberBuffer,
  writeGrandHallFrontierEvidenceOutputAtomic,
  type GrandHallFrontierIntakeDependencies,
  type GrandHallFrontierIntakeFailureReport,
  type GrandHallIntakeFetch,
  type GrandHallLocalPathInspection,
} from "../scripts/intake-grand-hall-big-model-frontier.js";
import {
  GRAND_HALL_ADMIN_TOKEN_RELAY_ENV,
  GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE,
} from "../scripts/grand-hall-admin-token-loopback-relay.js";

const MANIFEST_PATH = resolve("test-fixtures", GRAND_HALL_MANIFEST_FILE_NAME);
const API_ORIGIN = "https://trades-hall-grand-hall-staging.up.railway.app";
const TARGET_ID = GRAND_HALL_INTAKE_STAGING_TARGET_ID;
const NON_STAGING_TARGET_ID = "production-eu-1";
const ADMIN_TOKEN = "admin-token-kept-out-of-cli-output";
const ADMIN_USER_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_BINDING = "c".repeat(64);
const CONTENT_DIGEST = "d".repeat(64);
const REVIEWED_GIT_SHA = "e".repeat(40);
const REPOSITORY_ROOT = resolve("fixture-reviewed-worktree");
const ACTUAL_REPOSITORY_ROOT = resolve("..", "..");
const RECORDED_AT = new Date("2026-08-22T12:00:00.000Z");
const RUNTIME_PACKAGE_ID = "00000000-0000-4000-8000-000000000012";
const UPLOAD_INDEX = GRAND_HALL_FRONTIER_MEMBERS.length - 1;
const UPLOAD_MEMBER = GRAND_HALL_FRONTIER_MEMBERS[UPLOAD_INDEX];
const FIRST_ADMISSION_INDEX = GRAND_HALL_FRONTIER_MEMBERS.length - 2;
const FIRST_ADMISSION_MEMBER = GRAND_HALL_FRONTIER_MEMBERS[
  FIRST_ADMISSION_INDEX
];
const TEST_MEMBER_BUFFERS = new Map<number, Buffer>();
const TEST_EVIDENCE_PATHS: string[] = [];
let evidencePathSequence = 0;

if (UPLOAD_MEMBER === undefined || FIRST_ADMISSION_MEMBER === undefined) {
  throw new Error("The canonical Grand Hall test frontier is empty.");
}

interface FixtureUpload {
  readonly path: string;
  readonly headers: Record<string, string>;
}

interface FixturePreflightMember {
  memberIndex: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  status: "verified_existing" | "upload_required";
  upload?: FixtureUpload;
}

interface FixturePreflightEnvelope {
  data: {
    operatorUserId: string;
    targetId: string;
    deployedGitSha: string;
    apiOrigin: string;
    targetBindingSha256: string;
    manifestSha256: string;
    frontierReceiptSha256: string;
    memberCount: number;
    members: FixturePreflightMember[];
    existingMemberCount: number;
    uploadRequiredCount: number;
  };
}

interface FixtureCommitEnvelope {
  data: {
    operatorUserId: string;
    targetId: string;
    deployedGitSha: string;
    runtimePackageId: string;
    revision: number;
    contentDigest: string;
    created: boolean;
    memberCount: number;
    totalBytes: number;
    gaussianCount: number;
  };
}

interface RecordedRequest {
  readonly input: string;
  readonly init: Parameters<GrandHallIntakeFetch>[1];
}

function canonicalReceipt(): Lcc2HighestDetailFrontierReceiptV0 {
  return {
    schemaVersion: "omnitwin.reconstruction-foundry/lcc2-highest-detail-frontier-receipt/v0",
    sourceManifest: {
      fileName: GRAND_HALL_MANIFEST_FILE_NAME,
      sizeBytes: 124_070,
      sha256: `sha256:${GRAND_HALL_MANIFEST_SHA256}`,
    },
    source: {
      lcc2Version: "0.0.3",
      guid: "2d483e031ad40e259c75f765d6f5fcbb",
      fileType: "quality",
      splatType: ".sog",
      totalLevels: 5,
      totalSplatsAcrossAlternatives: 11_487_038,
      lodSplatsHighestToLowest: [
        6_019_684,
        2_945_194,
        1_451_051,
        715_516,
        355_593,
      ],
    },
    selection: {
      policy: "authoritative_leaf_nodes_v1",
      depth: 5,
      nodeCount: 37,
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      sizeBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
      members: GRAND_HALL_FRONTIER_MEMBERS.map((member) => ({
        fileIndex: member.fileIndex,
        relativePath: member.relativePath,
        depth: member.depth,
        nodeIds: Array.from(
          { length: member.nodeCount },
          (_, index) => `${member.fileName}:${String(index)}`,
        ),
        nodeCount: member.nodeCount,
        gaussianCount: member.gaussianCount,
        sizeBytes: member.sizeBytes,
        sha256: `sha256:${member.sha256}`,
      })),
    },
    ancestorAlternatives: Array.from({ length: 12 }, (_, index) => ({
      fileIndex: index,
      relativePath: `data/3dgs/ancestor-${String(index)}.sog`,
      depth: Math.min(index + 1, 4),
      nodeIds: [`ancestor-${String(index)}`],
      nodeCount: 1,
      gaussianCount: 1,
      sizeBytes: 1,
      sha256: `sha256:${"a".repeat(64)}`,
    })),
    environment: {
      policy: "exclude",
      runtimeLoaded: false,
      fileIndex: 23,
      relativePath: "data/3dgs/env.sog",
      gaussianCount: 11_296,
      sizeBytes: 414_176,
      sha256: `sha256:${"b".repeat(64)}`,
    },
    runtime: {
      memberPaths: GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.relativePath),
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      sizeBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
    },
    proof: {
      sourceOfTruth: "root.child[].data.3dgs",
      everyLeafAtHighestDepth: true,
      everyDeclaredNonEnvironmentFileReferenced: true,
      everyFileUsedByExactlyOneDepth: true,
      everyFileRangeContiguousAndNonOverlapping: true,
      everyLevelMatchesPublishedLodCount: true,
      parentAndChildFilesAreAlternatives: true,
      levels: [],
      everyDeclaredSplatFilePresent: true,
      noDeclaredSplatPathIsLinked: true,
      everyDeclaredContainerValidated: true,
      everyEmbeddedGaussianCountMatchesManifest: true,
      allHashedFilesStable: true,
      networkAccess: "none",
      sourceWrites: "none",
    },
    receiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  };
}

function nextTestEvidencePath(): string {
  evidencePathSequence += 1;
  const path = join(
    tmpdir(),
    `venviewer-intake-evidence-${String(process.pid)}-${String(evidencePathSequence)}.json`,
  );
  TEST_EVIDENCE_PATHS.push(path);
  return path;
}

function cliArgs(outPath: string = nextTestEvidencePath()): readonly string[] {
  return [
    "--out",
    outPath,
    "--manifest",
    MANIFEST_PATH,
    "--apply",
    "--api-origin",
    API_ORIGIN,
    "--target-id",
    TARGET_ID,
    "--reviewed-git-sha",
    REVIEWED_GIT_SHA,
  ];
}

function rehearsalCliArgs(
  outPath: string = nextTestEvidencePath(),
): readonly string[] {
  return cliArgs(outPath).map((argument) =>
    argument === "--apply" ? "--rehearse-conditional-put" : argument
  );
}

function admissionCliArgs(
  outPath: string = nextTestEvidencePath(),
): readonly string[] {
  return cliArgs(outPath).map((argument) =>
    argument === "--apply" ? GRAND_HALL_SOURCE_ADMISSION_FLAG : argument
  );
}

function verifyDisabledCliArgs(
  outPath: string = nextTestEvidencePath(),
): readonly string[] {
  return [
    "--out",
    outPath,
    "--verify-disabled",
    "--api-origin",
    API_ORIGIN,
    "--target-id",
    TARGET_ID,
    "--reviewed-git-sha",
    REVIEWED_GIT_SHA,
  ];
}

function withTargetId(args: readonly string[], targetId: string): readonly string[] {
  const targetIndex = args.indexOf("--target-id") + 1;
  return args.map((argument, index) => index === targetIndex ? targetId : argument);
}

function uploadCapability(index: number): FixtureUpload {
  const member = GRAND_HALL_FRONTIER_MEMBERS[index];
  if (member === undefined) throw new Error("Unknown fixture member.");
  return {
    path: `/admin/assets/grand-hall-frontier-intake/members/${String(index)}`,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(member.sizeBytes),
      "x-venviewer-intake-target-id": TARGET_ID,
      "x-venviewer-intake-api-origin": API_ORIGIN,
      "x-venviewer-intake-target-binding-sha256": TARGET_BINDING,
      "x-venviewer-intake-deployed-git-sha": REVIEWED_GIT_SHA,
      "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
      "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    },
  };
}

function preflightEnvelope(
  uploadIndices: readonly number[] = [],
): FixturePreflightEnvelope {
  const uploadSet = new Set(uploadIndices);
  const members = GRAND_HALL_FRONTIER_MEMBERS.map((member, index) => {
    const uploadRequired = uploadSet.has(index);
    return {
      memberIndex: index,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
      status: uploadRequired ? "upload_required" : "verified_existing",
      ...(uploadRequired ? { upload: uploadCapability(index) } : {}),
    } satisfies FixturePreflightMember;
  });
  return {
    data: {
      operatorUserId: ADMIN_USER_ID,
      targetId: TARGET_ID,
      deployedGitSha: REVIEWED_GIT_SHA,
      apiOrigin: API_ORIGIN,
      targetBindingSha256: TARGET_BINDING,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
      memberCount: GRAND_HALL_FRONTIER_MEMBERS.length,
      members,
      existingMemberCount: members.length - uploadSet.size,
      uploadRequiredCount: uploadSet.size,
    },
  };
}

function commitEnvelope(
  overrides: Partial<FixtureCommitEnvelope["data"]> = {},
): FixtureCommitEnvelope {
  return {
    data: {
      operatorUserId: ADMIN_USER_ID,
      targetId: TARGET_ID,
      deployedGitSha: REVIEWED_GIT_SHA,
      runtimePackageId: RUNTIME_PACKAGE_ID,
      revision: 1,
      contentDigest: CONTENT_DIGEST,
      created: true,
      memberCount: GRAND_HALL_FRONTIER_MEMBERS.length,
      totalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      ...overrides,
    },
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function uploadEnvelope(
  memberIndex: number,
  created: boolean,
  operatorUserId = ADMIN_USER_ID,
) {
  const member = GRAND_HALL_FRONTIER_MEMBERS[memberIndex];
  if (member === undefined) throw new Error("Unknown upload fixture member.");
  return {
    data: {
      operatorUserId,
      created,
      memberIndex,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
    },
  };
}

function rehearsalEnvelope() {
  const member = GRAND_HALL_FRONTIER_MEMBERS[0];
  if (member === undefined) throw new Error("Rehearsal fixture member missing.");
  return {
    data: {
      schemaVersion: "venviewer.grand-hall-intake-rehearsal.v1",
      operatorUserId: ADMIN_USER_ID,
      targetId: TARGET_ID,
      deployedGitSha: REVIEWED_GIT_SHA,
      apiOrigin: API_ORIGIN,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
      member: {
        memberIndex: 0,
        fileName: member.fileName,
        sizeBytes: member.sizeBytes,
        sha256: member.sha256,
      },
      initialPreflight: {
        existingMemberCount: 0,
        uploadRequiredCount: GRAND_HALL_FRONTIER_MEMBERS.length,
      },
      conditionalPut: {
        created: { statusCode: 201, created: true },
        exactRetry: { statusCode: 200, created: false },
        corruptCopy: {
          statusCode: 409,
          code: "GRAND_HALL_STORAGE_CONFLICT",
          storedBytesUnchanged: true,
        },
      },
      finalPreflight: {
        existingMemberCount: 1,
        uploadRequiredCount: GRAND_HALL_FRONTIER_MEMBERS.length - 1,
      },
      commitAttempted: false,
      registrationAttempted: false,
    },
  } as const;
}

function regularInspection(sizeBytes: number): GrandHallLocalPathInspection {
  return {
    kind: "file",
    sizeBytes,
    device: 4,
    inode: 12,
    modifiedTimeMs: 20,
  };
}

function fixtureMemberForPath(path: string): GrandHallFrontierMemberSpec {
  const member = GRAND_HALL_FRONTIER_MEMBERS.find((candidate) =>
    path.endsWith(candidate.fileName)
  );
  if (member === undefined) throw new Error("Unknown fixture member path.");
  return member;
}

function fixtureMemberBuffer(member: GrandHallFrontierMemberSpec): Buffer {
  const existing = TEST_MEMBER_BUFFERS.get(member.fileIndex);
  if (existing !== undefined) return existing;
  const created = Buffer.allocUnsafe(member.sizeBytes);
  TEST_MEMBER_BUFFERS.set(member.fileIndex, created);
  return created;
}

function fixtureLocalDependencies(): GrandHallFrontierIntakeDependencies {
  return {
    inspectFrontier: () => Promise.resolve(canonicalReceipt()),
    inspectGitState: () => Promise.resolve({
      headSha: REVIEWED_GIT_SHA,
      reviewedCommitExists: true,
      clean: true,
      repositoryRoot: REPOSITORY_ROOT,
    }),
    inspectLocalPath: (path) => {
      const member = fixtureMemberForPath(path);
      return Promise.resolve(regularInspection(member.sizeBytes));
    },
    readLocalMember: (path, expectedSizeBytes) => {
      const member = fixtureMemberForPath(path);
      expect(expectedSizeBytes).toBe(member.sizeBytes);
      return Promise.resolve(fixtureMemberBuffer(member));
    },
    verifyMemberBuffer: () => undefined,
  };
}

function intakeEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
    [GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV]: ADMIN_TOKEN,
    ...overrides,
  };
}

function defaultDependencies(
  fetchImpl: GrandHallIntakeFetch,
): GrandHallFrontierIntakeDependencies {
  return {
    inspectFrontier: vi.fn(() => Promise.resolve(canonicalReceipt())),
    fetchImpl,
  };
}

function runWith(
  dependencies: GrandHallFrontierIntakeDependencies,
  log: (line: string) => void = () => undefined,
) {
  return runWithArgs(cliArgs(), dependencies, log);
}

function runWithArgs(
  args: readonly string[],
  dependencies: GrandHallFrontierIntakeDependencies,
  log: (line: string) => void = () => undefined,
) {
  return runGrandHallFrontierIntake({
    args,
    env: intakeEnv(),
    dependencies: {
      ...fixtureLocalDependencies(),
      now: () => RECORDED_AT,
      ...dependencies,
    },
    log,
  });
}

async function failureReport(
  operation: Promise<unknown>,
): Promise<GrandHallFrontierIntakeFailureReport> {
  try {
    await operation;
  } catch (error) {
    return JSON.parse(
      grandHallFrontierIntakeFailureOutput(error),
    ) as GrandHallFrontierIntakeFailureReport;
  }
  throw new Error("Expected the Grand Hall intake operation to fail.");
}

afterAll(() => {
  for (const buffer of TEST_MEMBER_BUFFERS.values()) buffer.fill(0);
  TEST_MEMBER_BUFFERS.clear();
  return Promise.all(TEST_EVIDENCE_PATHS.map((path) =>
    rm(path, { force: true })
  )).then(() => undefined);
});

describe("Grand Hall server-bound intake argument boundary", () => {
  it("requires the explicit apply selections and normalizes only the manifest path", () => {
    const outPath = nextTestEvidencePath();
    expect(parseGrandHallFrontierIntakeArgs(cliArgs(outPath))).toEqual({
      manifestPath: MANIFEST_PATH,
      apiOrigin: API_ORIGIN,
      targetId: TARGET_ID,
      reviewedGitSha: REVIEWED_GIT_SHA,
      outPath,
      mode: "apply",
    });
  });

  it("selects the bounded conditional-PUT rehearsal instead of apply", () => {
    expect(parseGrandHallFrontierIntakeArgs(rehearsalCliArgs())).toMatchObject({
      reviewedGitSha: REVIEWED_GIT_SHA,
      mode: "conditional_put_rehearsal",
    });
  });

  it("selects one-member source admission instead of apply", () => {
    expect(parseGrandHallFrontierIntakeArgs(admissionCliArgs())).toMatchObject({
      reviewedGitSha: REVIEWED_GIT_SHA,
      mode: "admit_next_member",
    });
  });

  it("selects read-only disabled verification without accepting a manifest", () => {
    const outPath = nextTestEvidencePath();
    expect(parseGrandHallFrontierIntakeArgs(verifyDisabledCliArgs(outPath))).toEqual({
      apiOrigin: API_ORIGIN,
      targetId: TARGET_ID,
      reviewedGitSha: REVIEWED_GIT_SHA,
      outPath,
      mode: "verify_disabled",
    });
    expect(() => parseGrandHallFrontierIntakeArgs([
      ...verifyDisabledCliArgs(),
      "--manifest",
      MANIFEST_PATH,
    ])).toThrow("does not accept --manifest");
  });

  it("normalizes a create-only evidence output selection without adding it to the receipt", () => {
    const relativeOutPath = join("evidence", "disabled.json");
    expect(parseGrandHallFrontierIntakeArgs(
      verifyDisabledCliArgs(relativeOutPath),
    )).toMatchObject({
      mode: "verify_disabled",
      outPath: resolve(relativeOutPath),
    });
  });

  it.each([
    ["apply", cliArgs()],
    ["source admission", admissionCliArgs()],
    ["conditional-PUT rehearsal", rehearsalCliArgs()],
    ["disabled verification", verifyDisabledCliArgs()],
  ] as const)("pins %s to the dedicated Grand Hall staging target", (_name, args) => {
    expect(() => parseGrandHallFrontierIntakeArgs(withTargetId(args, NON_STAGING_TARGET_ID)))
      .toThrow(GRAND_HALL_INTAKE_STAGING_TARGET_ID);
  });

  it.each([
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--api-origin", API_ORIGIN, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "exactly one operation"],
    [["--out", nextTestEvidencePath(), "--manifest", "Grand_Hall.lcc2", "--apply", "--api-origin", API_ORIGIN, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "absolute"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "--api-origin"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", API_ORIGIN, "--reviewed-git-sha", REVIEWED_GIT_SHA], "--target-id"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", "http://api.example.test", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", `${API_ORIGIN}/v1`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", `${API_ORIGIN}?redirect=1`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", `${API_ORIGIN}/`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", "https://trades-hall-grand-hall-staging.up.railway.app:443", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", "https://user:pass@api.example.test", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", ` ${API_ORIGIN}`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--out", nextTestEvidencePath(), "--manifest", MANIFEST_PATH, "--apply", "--api-origin", API_ORIGIN, "--target-id", "UPPERCASE", "--reviewed-git-sha", REVIEWED_GIT_SHA], "deployment identifier"],
    [[...cliArgs().slice(0, -2)], "--reviewed-git-sha"],
    [cliArgs().slice(2), "--out is required"],
    [[...cliArgs(), "--rehearse-conditional-put"], "exactly one operation"],
    [[...cliArgs(), GRAND_HALL_SOURCE_ADMISSION_FLAG], "exactly one operation"],
    [[...cliArgs(), "--verify-disabled"], "exactly one operation"],
    [[...verifyDisabledCliArgs(), "--out"], "--out requires a value"],
    [[...verifyDisabledCliArgs(), "--out", "first.json", "--out", "second.json"], "--out may only be supplied once"],
  ] satisfies readonly (readonly [readonly string[], string])[])(
    "rejects an incomplete or unsafe invocation %#",
    (args, message) => {
      expect(() => parseGrandHallFrontierIntakeArgs(args)).toThrow(message);
    },
  );

  it.each([
    ["--database-url", "postgres://forbidden"],
    ["--r2-access-key", "forbidden"],
    ["--object-prefix", "forbidden/"],
    ["--capture-session-id", "00000000-0000-4000-8000-000000000001"],
    ["--token", ADMIN_TOKEN],
  ])("refuses forbidden client-side authority flag %s", (flag, value) => {
    expect(() => parseGrandHallFrontierIntakeArgs([...cliArgs(), flag, value]))
      .toThrow("Unknown or unsupported argument");
  });

  it("validates the independent exact staging origin before reading the admin token", async () => {
    let tokenRead = false;
    const env: Record<string, string | undefined> = {
      [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]:
        "https://different-staging-api.example.test",
    };
    Object.defineProperty(env, GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV, {
      enumerable: true,
      get: () => {
        tokenRead = true;
        return ADMIN_TOKEN;
      },
    });
    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runGrandHallFrontierIntake({
      args: cliArgs(),
      env,
      dependencies: { inspectFrontier, fetchImpl },
      log: () => undefined,
    })).rejects.toThrow(GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV);
    expect(tokenRead).toBe(false);
    expect(inspectFrontier).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the bearer token only after local admission and immediately before network", async () => {
    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runGrandHallFrontierIntake({
      args: cliArgs(),
      env: {
        [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
      },
      dependencies: {
        inspectGitState: () => Promise.resolve({
          headSha: REVIEWED_GIT_SHA,
          reviewedCommitExists: true,
          clean: true,
          repositoryRoot: REPOSITORY_ROOT,
        }),
        inspectFrontier,
        fetchImpl,
      },
      log: () => undefined,
    })).rejects.toThrow(GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV);
    expect(inspectFrontier).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Grand Hall just-in-time admin token boundary", () => {
  it.each([
    ["apply", 2],
    ["admission", 2],
    ["rehearsal", 1],
    ["disabled verification", 1],
  ] as const)(
    "opens a fresh encrypted browser relay immediately before every %s request",
    async (mode, expectedRequests) => {
      const events: string[] = [];
      let tokenCount = 0;
      let requestCount = 0;
      const receiveAdminTokenFromBrowser = vi.fn(() => {
        tokenCount += 1;
        const token = `fresh-relay-token-${String(tokenCount)}`;
        events.push(`token:${token}`);
        return Promise.resolve(token);
      });
      const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
        requestCount += 1;
        events.push(`request:${init.headers.authorization ?? "missing"}`);
        if (mode === "rehearsal") return jsonResponse(rehearsalEnvelope());
        if (mode === "disabled verification") {
          return jsonResponse({
            error: "Grand Hall intake is disabled.",
            code: "GRAND_HALL_INTAKE_DISABLED",
          }, 503);
        }
        if (requestCount === 1) {
          return jsonResponse(mode === "admission"
            ? preflightEnvelope([UPLOAD_INDEX])
            : preflightEnvelope());
        }
        return mode === "admission"
          ? jsonResponse(uploadEnvelope(UPLOAD_INDEX, true), 201)
          : jsonResponse(commitEnvelope(), 201);
      };
      const args = mode === "apply"
        ? cliArgs()
        : mode === "admission"
          ? admissionCliArgs()
          : mode === "rehearsal"
            ? rehearsalCliArgs()
            : verifyDisabledCliArgs();

      await runGrandHallFrontierIntake({
        args,
        env: {
          [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
          [GRAND_HALL_ADMIN_TOKEN_RELAY_ENV]:
            GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE,
        },
        dependencies: {
          ...fixtureLocalDependencies(),
          receiveAdminTokenFromBrowser,
          fetchImpl,
          now: () => RECORDED_AT,
        },
        log: () => undefined,
      });

      expect(receiveAdminTokenFromBrowser).toHaveBeenCalledTimes(expectedRequests);
      expect(requestCount).toBe(expectedRequests);
      expect(events).toEqual(Array.from(
        { length: expectedRequests },
        (_, index) => {
          const token = `fresh-relay-token-${String(index + 1)}`;
          return [`token:${token}`, `request:Bearer ${token}`];
        },
      ).flat());
    },
  );

  it("re-reads the process-local compatibility token immediately before each request", async () => {
    const events: string[] = [];
    let tokenReadCount = 0;
    let requestCount = 0;
    const env: Record<string, string | undefined> = {
      [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
    };
    Object.defineProperty(env, GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV, {
      enumerable: true,
      get: () => {
        tokenReadCount += 1;
        const token = `fresh-env-token-${String(tokenReadCount)}`;
        events.push(`token:${token}`);
        return token;
      },
    });
    const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
      requestCount += 1;
      events.push(`request:${init.headers.authorization ?? "missing"}`);
      return requestCount === 1
        ? jsonResponse(preflightEnvelope())
        : jsonResponse(commitEnvelope(), 201);
    };

    await runGrandHallFrontierIntake({
      args: cliArgs(),
      env,
      dependencies: {
        ...fixtureLocalDependencies(),
        fetchImpl,
        now: () => RECORDED_AT,
      },
      log: () => undefined,
    });

    expect(tokenReadCount).toBe(2);
    expect(events).toEqual([
      "token:fresh-env-token-1",
      "request:Bearer fresh-env-token-1",
      "token:fresh-env-token-2",
      "request:Bearer fresh-env-token-2",
    ]);
  });

  it("does not enter the next request when fresh relay acquisition fails", async () => {
    let tokenCount = 0;
    const receiveAdminTokenFromBrowser = vi.fn(() => {
      tokenCount += 1;
      return tokenCount === 1
        ? Promise.resolve("fresh-relay-token-1")
        : Promise.reject(new Error(ADMIN_TOKEN));
    });
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() =>
      jsonResponse(preflightEnvelope())
    );

    const report = await failureReport(runGrandHallFrontierIntake({
      args: cliArgs(),
      env: {
        [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
        [GRAND_HALL_ADMIN_TOKEN_RELAY_ENV]:
          GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE,
      },
      dependencies: {
        ...fixtureLocalDependencies(),
        receiveAdminTokenFromBrowser,
        fetchImpl,
        now: () => RECORDED_AT,
      },
      log: () => undefined,
    }));

    expect(receiveAdminTokenFromBrowser).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(report).toEqual({
      class: "safe_to_retry",
      code: "TOKEN_ACQUISITION_FAILED",
    });
  });

  it("keeps a relay failure before rehearsal request entry non-terminal", async () => {
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    const report = await failureReport(runGrandHallFrontierIntake({
      args: rehearsalCliArgs(),
      env: {
        [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
        [GRAND_HALL_ADMIN_TOKEN_RELAY_ENV]:
          GRAND_HALL_ADMIN_TOKEN_RELAY_VALUE,
      },
      dependencies: {
        ...fixtureLocalDependencies(),
        receiveAdminTokenFromBrowser: () => Promise.reject(new Error(ADMIN_TOKEN)),
        fetchImpl,
      },
      log: () => undefined,
    }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toEqual({
      class: "safe_to_retry",
      code: "TOKEN_ACQUISITION_FAILED",
    });
  });
});

describe("Grand Hall disabled-intake verification", () => {
  it("calls only authenticated preflight and preserves the explicit disabled code", async () => {
    const requests: RecordedRequest[] = [];
    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const inspectLocalPath = vi.fn(() => Promise.reject(new Error("source read forbidden")));
    const readLocalMember = vi.fn(() => Promise.reject(new Error("source read forbidden")));
    const verifyMemberBuffer = vi.fn();
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return jsonResponse({
        error: "Grand Hall intake is disabled or incompletely configured on this server.",
        code: "GRAND_HALL_INTAKE_DISABLED",
      }, 503);
    };

    const result = await runGrandHallFrontierIntake({
      args: verifyDisabledCliArgs(),
      env: intakeEnv(),
      dependencies: {
        inspectGitState: () => Promise.resolve({
          headSha: REVIEWED_GIT_SHA,
          reviewedCommitExists: true,
          clean: true,
          repositoryRoot: REPOSITORY_ROOT,
        }),
        inspectFrontier,
        inspectLocalPath,
        readLocalMember,
        verifyMemberBuffer,
        fetchImpl,
        now: () => RECORDED_AT,
      },
      log: () => undefined,
    });

    expect(result).toEqual({
      schemaVersion: "venviewer.grand-hall-frontier-intake-disabled-evidence.v1",
      mode: "verify_disabled",
      recordedAt: RECORDED_AT.toISOString(),
      reviewedGitSha: REVIEWED_GIT_SHA,
      targetId: TARGET_ID,
      apiOrigin: API_ORIGIN,
      httpStatus: 503,
      errorCode: "GRAND_HALL_INTAKE_DISABLED",
      disabled: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      `${API_ORIGIN}/admin/assets/grand-hall-frontier-intake/preflight`,
    );
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      redirect: "error",
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      targetId: TARGET_ID,
      apiOrigin: API_ORIGIN,
      reviewedGitSha: REVIEWED_GIT_SHA,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    });
    expect(inspectFrontier).not.toHaveBeenCalled();
    expect(inspectLocalPath).not.toHaveBeenCalled();
    expect(readLocalMember).not.toHaveBeenCalled();
    expect(verifyMemberBuffer).not.toHaveBeenCalled();
  });

  it.each([
    [200, preflightEnvelope(), "required HTTP 503"],
    [503, { error: "busy", code: "GRAND_HALL_INTAKE_BUSY" }, "did not return GRAND_HALL_INTAKE_DISABLED"],
    [503, { error: "disabled", code: "GRAND_HALL_INTAKE_DISABLED", details: "unexpected" }, "did not return GRAND_HALL_INTAKE_DISABLED"],
  ] as const)(
    "rejects HTTP %s without the one strict disabled response",
    async (status, body, message) => {
      const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
      const fetchImpl = vi.fn<GrandHallIntakeFetch>(() => jsonResponse(body, status));
      await expect(runGrandHallFrontierIntake({
        args: verifyDisabledCliArgs(),
        env: intakeEnv(),
        dependencies: {
          inspectGitState: () => Promise.resolve({
            headSha: REVIEWED_GIT_SHA,
            reviewedCommitExists: true,
            clean: true,
            repositoryRoot: REPOSITORY_ROOT,
          }),
          inspectFrontier,
          fetchImpl,
        },
        log: () => undefined,
      })).rejects.toThrow(message);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(inspectFrontier).not.toHaveBeenCalled();
    },
  );
});

describe("Grand Hall evidence output", () => {
  const disabledReceipt = {
    schemaVersion: "venviewer.grand-hall-frontier-intake-disabled-evidence.v1",
    mode: "verify_disabled",
    recordedAt: RECORDED_AT.toISOString(),
    reviewedGitSha: REVIEWED_GIT_SHA,
    targetId: TARGET_ID,
    apiOrigin: API_ORIGIN,
    httpStatus: 503,
    errorCode: "GRAND_HALL_INTAKE_DISABLED",
    disabled: true,
  } as const;

  it("writes the exact emitted bytes once and refuses overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-evidence-"));
    const outPath = join(directory, "disabled-receipt.json");
    const output = grandHallFrontierEvidenceOutput(disabledReceipt);
    try {
      expect(output.endsWith("\n")).toBe(true);
      expect(output.slice(0, -1)).toBe(
        serializeGrandHallFrontierEvidenceReceipt(disabledReceipt),
      );
      expect(output).not.toContain(ADMIN_TOKEN);
      expect(output).not.toContain(MANIFEST_PATH);
      expect(output).not.toContain(outPath);

      await writeGrandHallFrontierEvidenceOutputAtomic(outPath, disabledReceipt);
      expect(await readFile(outPath, "utf8")).toBe(output);
      expect(await readdir(directory)).toEqual(["disabled-receipt.json"]);

      await expect(writeGrandHallFrontierEvidenceOutputAtomic(
        outPath,
        {
          ...disabledReceipt,
          recordedAt: "2026-08-22T12:01:00.000Z",
        },
      )).rejects.toThrow("refusing overwrite");
      expect(await readFile(outPath, "utf8")).toBe(output);
      expect(await readdir(directory)).toEqual(["disabled-receipt.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reserves an external output before the request and finalizes the exact emitted bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-run-output-"));
    const outPath = join(directory, "disabled-receipt.json");
    const requests: RecordedRequest[] = [];
    try {
      const result = await runGrandHallFrontierIntake({
        args: verifyDisabledCliArgs(outPath),
        env: intakeEnv(),
        dependencies: {
          inspectGitState: () => Promise.resolve({
            headSha: REVIEWED_GIT_SHA,
            reviewedCommitExists: true,
            clean: true,
            repositoryRoot: ACTUAL_REPOSITORY_ROOT,
          }),
          fetchImpl: (input, init) => {
            requests.push({ input, init });
            return jsonResponse({
              error: "Grand Hall intake is disabled.",
              code: "GRAND_HALL_INTAKE_DISABLED",
            }, 503);
          },
          now: () => RECORDED_AT,
        },
        log: () => undefined,
      });
      expect(requests).toHaveLength(1);
      expect(await readFile(outPath, "utf8")).toBe(
        grandHallFrontierEvidenceOutput(result),
      );
      expect(await readdir(directory)).toEqual(["disabled-receipt.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["existing", "unwritable-parent"] as const)(
    "rejects an %s output before reading the token, source, or network",
    async (failureKind) => {
      const directory = await mkdtemp(join(tmpdir(), "grand-hall-output-fail-"));
      const existingPath = join(directory, "existing.json");
      const parentFile = join(directory, "not-a-directory");
      const outPath = failureKind === "existing"
        ? existingPath
        : join(parentFile, "receipt.json");
      await writeFile(
        failureKind === "existing" ? existingPath : parentFile,
        "must-remain-unchanged",
      );
      let tokenRead = false;
      const env: Record<string, string | undefined> = {
        [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
      };
      Object.defineProperty(env, GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV, {
        enumerable: true,
        get: () => {
          tokenRead = true;
          return ADMIN_TOKEN;
        },
      });
      const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
      const fetchImpl = vi.fn<GrandHallIntakeFetch>();
      try {
        await expect(runGrandHallFrontierIntake({
          args: verifyDisabledCliArgs(outPath),
          env,
          dependencies: {
            inspectGitState: () => Promise.resolve({
              headSha: REVIEWED_GIT_SHA,
              reviewedCommitExists: true,
              clean: true,
              repositoryRoot: ACTUAL_REPOSITORY_ROOT,
            }),
            inspectFrontier,
            fetchImpl,
          },
          log: () => undefined,
        })).rejects.toThrow(failureKind === "existing"
          ? "refusing overwrite"
          : "could not be reserved safely");
        expect(tokenRead).toBe(false);
        expect(inspectFrontier).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(await readFile(
          failureKind === "existing" ? existingPath : parentFile,
          "utf8",
        )).toBe("must-remain-unchanged");
        expect(await readdir(directory)).toEqual([
          failureKind === "existing" ? "existing.json" : "not-a-directory",
        ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects output inside the reviewed worktree before reservation or network", async () => {
    const outPath = resolve("grand-hall-forbidden-evidence.json");
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runGrandHallFrontierIntake({
      args: verifyDisabledCliArgs(outPath),
      env: intakeEnv(),
      dependencies: {
        inspectGitState: () => Promise.resolve({
          headSha: REVIEWED_GIT_SHA,
          reviewedCommitExists: true,
          clean: true,
          repositoryRoot: ACTUAL_REPOSITORY_ROOT,
        }),
        fetchImpl,
      },
      log: () => undefined,
    })).rejects.toThrow("outside the reviewed Git worktree");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects evidence output inside a different Git worktree before token or network", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-other-worktree-"));
    const outPath = join(directory, "forbidden-receipt.json");
    let tokenRead = false;
    const env: Record<string, string | undefined> = {
      [GRAND_HALL_INTAKE_EXPECTED_STAGING_API_ORIGIN_ENV]: API_ORIGIN,
    };
    Object.defineProperty(env, GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV, {
      enumerable: true,
      get: () => {
        tokenRead = true;
        return ADMIN_TOKEN;
      },
    });
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    try {
      await expect(runGrandHallFrontierIntake({
        args: verifyDisabledCliArgs(outPath),
        env,
        dependencies: {
          inspectGitState: () => Promise.resolve({
            headSha: REVIEWED_GIT_SHA,
            reviewedCommitExists: true,
            clean: true,
            repositoryRoot: ACTUAL_REPOSITORY_ROOT,
          }),
          discoverEvidenceGitRoot: () => Promise.resolve(directory),
          fetchImpl,
        },
        log: () => undefined,
      })).rejects.toThrow("outside every Git worktree");
      expect(tokenRead).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when Git refuses a destination that still has a Git marker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-indeterminate-worktree-"));
    const outPath = join(directory, "forbidden-receipt.json");
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    try {
      await writeFile(join(directory, ".git"), "malformed-gitdir-marker", "utf8");
      await expect(runGrandHallFrontierIntake({
        args: verifyDisabledCliArgs(outPath),
        env: intakeEnv(),
        dependencies: {
          inspectGitState: () => Promise.resolve({
            headSha: REVIEWED_GIT_SHA,
            reviewedCommitExists: true,
            clean: true,
            repositoryRoot: ACTUAL_REPOSITORY_ROOT,
          }),
          fetchImpl,
        },
        log: () => undefined,
      })).rejects.toThrow("Git boundary is indeterminate");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([".git"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains the empty exclusive destination reservation when the operation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-output-cleanup-"));
    const outPath = join(directory, "failed-receipt.json");
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() =>
      jsonResponse({ error: "not disabled", code: "UNEXPECTED" }, 500)
    );
    try {
      await expect(runGrandHallFrontierIntake({
        args: verifyDisabledCliArgs(outPath),
        env: intakeEnv(),
        dependencies: {
          inspectGitState: () => Promise.resolve({
            headSha: REVIEWED_GIT_SHA,
            reviewedCommitExists: true,
            clean: true,
            repositoryRoot: ACTUAL_REPOSITORY_ROOT,
          }),
          fetchImpl,
        },
        log: () => undefined,
      })).rejects.toThrow("required HTTP 503");
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(await readFile(outPath)).toHaveLength(0);
      expect(await readdir(directory)).toEqual(["failed-receipt.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Grand Hall reviewed Git admission", () => {
  it("accepts only an existing reviewed commit that is exact HEAD in a clean worktree", () => {
    expect(() => {
      assertGrandHallReviewedGitState({
        headSha: REVIEWED_GIT_SHA,
        reviewedCommitExists: true,
        clean: true,
        repositoryRoot: REPOSITORY_ROOT,
      }, REVIEWED_GIT_SHA);
    }).not.toThrow();
  });

  it.each([
    ["missing commit", {
      headSha: REVIEWED_GIT_SHA,
      reviewedCommitExists: false,
      clean: true,
      repositoryRoot: REPOSITORY_ROOT,
    }, "does not exist"],
    ["different HEAD", {
      headSha: "f".repeat(40),
      reviewedCommitExists: true,
      clean: true,
      repositoryRoot: REPOSITORY_ROOT,
    }, "HEAD does not equal"],
    ["tracked or untracked changes", {
      headSha: REVIEWED_GIT_SHA,
      reviewedCommitExists: true,
      clean: false,
      repositoryRoot: REPOSITORY_ROOT,
    }, "not clean"],
  ] as const)("rejects %s before source inspection or network", async (_name, state, message) => {
    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runWith({
      inspectGitState: () => Promise.resolve(state),
      inspectFrontier,
      fetchImpl,
    })).rejects.toThrow(message);
    expect(inspectFrontier).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the dirty executable checkout instead of a clean ambient checkout", async () => {
    const executableRoot = resolve("dirty-executable-checkout");
    const ambientRoot = resolve("clean-ambient-checkout");
    const scriptFilePath = resolve(executableRoot, "packages/api/src/scripts/intake.ts");
    const calls: string[][] = [];
    const state = await inspectGrandHallGitState(REVIEWED_GIT_SHA, {
      scriptFilePath,
      resolveRealPath: (path) => Promise.resolve(path),
      executeGit: (args) => {
        calls.push([...args]);
        expect(args).not.toContain(ambientRoot);
        if (args.includes("--show-toplevel")) return Promise.resolve(executableRoot);
        if (args.includes("status")) return Promise.resolve("?? untracked-in-executable-checkout");
        return Promise.resolve(REVIEWED_GIT_SHA);
      },
    });
    expect(state.clean).toBe(false);
    expect(calls.every((args) => args.includes(executableRoot) || args.includes(dirname(scriptFilePath)))).toBe(true);

    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runWith({
      inspectGitState: () => Promise.resolve(state),
      inspectFrontier,
      fetchImpl,
    })).rejects.toThrow("not clean");
    expect(inspectFrontier).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Grand Hall server-bound intake response binding", () => {
  it("validates locally, binds both POSTs to one target, and emits no secrets or paths", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return requests.length === 1
        ? jsonResponse(preflightEnvelope())
        : jsonResponse(commitEnvelope(), 201);
    };
    const logs: string[] = [];
    const inspectLocalPath = vi.fn();
    const readLocalMember = vi.fn();
    const dependencies = {
      ...defaultDependencies(fetchImpl),
      inspectLocalPath,
      readLocalMember,
    };
    const result = await runWith(dependencies, (line) => logs.push(line));

    expect(result).toMatchObject({
      schemaVersion: "venviewer.grand-hall-frontier-intake-evidence.v1",
      mode: "apply",
      recordedAt: RECORDED_AT.toISOString(),
      reviewedGitSha: REVIEWED_GIT_SHA,
      deployedGitSha: REVIEWED_GIT_SHA,
      operatorUserId: ADMIN_USER_ID,
      targetId: TARGET_ID,
      apiOrigin: API_ORIGIN,
      targetBindingSha256: TARGET_BINDING,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
      preflight: {
        existingMemberCount: GRAND_HALL_FRONTIER_MEMBERS.length,
        uploadRequiredCount: 0,
      },
      puts: [],
      package: {
        runtimePackageId: RUNTIME_PACKAGE_ID,
        revision: 1,
        contentDigest: CONTENT_DIGEST,
        created: true,
        memberCount: GRAND_HALL_FRONTIER_MEMBERS.length,
        totalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
        gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      },
    });
    expect(requests).toHaveLength(2);
    expect(inspectLocalPath).not.toHaveBeenCalled();
    expect(readLocalMember).not.toHaveBeenCalled();
    expect(requests.every((request) => request.init.signal instanceof AbortSignal)).toBe(true);
    expect(requests[0]?.input).toBe(`${API_ORIGIN}/admin/assets/grand-hall-frontier-intake/preflight`);
    expect(requests[1]?.input).toBe(`${API_ORIGIN}/admin/assets/grand-hall-frontier-intake/commit`);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      targetId: TARGET_ID,
      apiOrigin: API_ORIGIN,
      reviewedGitSha: REVIEWED_GIT_SHA,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
    });
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      targetId: TARGET_ID,
      apiOrigin: API_ORIGIN,
      reviewedGitSha: REVIEWED_GIT_SHA,
      manifestSha256: GRAND_HALL_MANIFEST_SHA256,
      frontierReceiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
      targetBindingSha256: TARGET_BINDING,
      confirmation: GRAND_HALL_INTAKE_CONFIRMATION,
    });
    const output = logs.join("\n");
    expect(output).not.toContain(API_ORIGIN);
    expect(output).not.toContain(MANIFEST_PATH);
    expect(output).not.toContain(ADMIN_TOKEN);
    expect(output).not.toContain("/admin/assets/");
    const serialized = serializeGrandHallFrontierEvidenceReceipt(result);
    expect(JSON.parse(serialized)).toEqual(result);
    expect(serialized).not.toContain(MANIFEST_PATH);
    expect(serialized).not.toContain(ADMIN_TOKEN);
  });

  it("rejects a locally inspected frontier mismatch before calling the server", async () => {
    const receipt = canonicalReceipt();
    const firstMember = receipt.selection.members[0];
    if (firstMember === undefined) throw new Error("Fixture member missing.");
    const invalidReceipt: Lcc2HighestDetailFrontierReceiptV0 = {
      ...receipt,
      selection: {
        ...receipt.selection,
        members: [
          { ...firstMember, sha256: `sha256:${"0".repeat(64)}` },
          ...receipt.selection.members.slice(1),
        ],
      },
    };
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(invalidReceipt),
      fetchImpl,
    })).rejects.toThrow("pinned frontier receipt");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["target", (body: FixturePreflightEnvelope) => {
      body.data.targetId = "different-target";
    }],
    ["API origin", (body: FixturePreflightEnvelope) => {
      body.data.apiOrigin = "https://different.example.test";
    }],
    ["deployed Git SHA", (body: FixturePreflightEnvelope) => {
      body.data.deployedGitSha = "f".repeat(40);
    }],
    ["manifest hash", (body: FixturePreflightEnvelope) => {
      body.data.manifestSha256 = "0".repeat(64);
    }],
    ["frontier hash", (body: FixturePreflightEnvelope) => {
      body.data.frontierReceiptSha256 = `sha256:${"0".repeat(64)}`;
    }],
    ["binding hash", (body: FixturePreflightEnvelope) => {
      body.data.targetBindingSha256 = "not-a-binding";
    }],
    ["member order", (body: FixturePreflightEnvelope) => {
      body.data.members.reverse();
    }],
    ["member counts", (body: FixturePreflightEnvelope) => {
      body.data.existingMemberCount -= 1;
    }],
  ] satisfies readonly (readonly [string, (body: FixturePreflightEnvelope) => void])[])(
    "rejects a mismatched preflight %s after local admission and before commit",
    async (_name, mutate) => {
      const body = preflightEnvelope();
      mutate(body);
      const requests: RecordedRequest[] = [];
      const fetchImpl: GrandHallIntakeFetch = (input, init) => {
        requests.push({ input, init });
        return jsonResponse(body);
      };
      await expect(runWith({
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        fetchImpl,
      })).rejects.toThrow(/preflight/u);
      expect(requests).toHaveLength(1);
    },
  );

  it("rejects injected upload headers after local admission and before PUT", async () => {
    const body = preflightEnvelope([UPLOAD_INDEX]);
    const upload = body.data.members[UPLOAD_INDEX]?.upload;
    if (upload === undefined) throw new Error("Fixture upload missing.");
    upload.headers.authorization = "injected";
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      fetchImpl: () => jsonResponse(body),
    })).rejects.toThrow("unexpected upload headers");
  });

  it("does not disclose a server response body, API URL, token, or local path on failure", async () => {
    const responseBody = {
      error: `${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`,
    };
    let caught: unknown;
    try {
      await runWith(defaultDependencies(() => jsonResponse(responseBody, 500)));
    } catch (error) {
      caught = error;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe("Grand Hall intake preflight failed with HTTP 500.");
    expect(message).not.toContain(ADMIN_TOKEN);
    expect(message).not.toContain(API_ORIGIN);
    expect(message).not.toContain(MANIFEST_PATH);
  });

  it("rejects an API response whose declared length exceeds the fixed cap", async () => {
    const response = new Response(JSON.stringify(preflightEnvelope()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(GRAND_HALL_MAX_API_RESPONSE_BYTES + 1),
      },
    });
    const report = await failureReport(runWith(defaultDependencies(() => response)));
    expect(report).toEqual({ class: "stop", code: "INVALID_RESPONSE" });
  });

  it("cancels and rejects a chunked API response that crosses the fixed cap", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(GRAND_HALL_MAX_API_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        canceled = true;
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const report = await failureReport(runWith(defaultDependencies(() => response)));
    expect(report).toEqual({ class: "stop", code: "INVALID_RESPONSE" });
    expect(canceled).toBe(true);
  });
});

describe("Grand Hall operator-safe failure classification", () => {
  it("serializes only the closed failure fields and fails closed for unknown errors", () => {
    let caught: unknown;
    try {
      parseGrandHallFrontierIntakeArgs(["--token", ADMIN_TOKEN]);
    } catch (error) {
      caught = error;
    }

    const output = grandHallFrontierIntakeFailureOutput(caught);
    expect(output.endsWith("\n")).toBe(true);
    expect(JSON.parse(output)).toEqual({
      class: "stop",
      code: "LOCAL_PRECONDITION_FAILED",
    });
    expect(output).not.toContain(ADMIN_TOKEN);
    expect(JSON.parse(grandHallFrontierIntakeFailureOutput(
      new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`),
    ))).toEqual({
      class: "stop",
      code: "UNEXPECTED_FAILURE",
    });
  });

  it("exposes only an allowlisted transient preflight code, status, and bounded Retry-After", async () => {
    const report = await failureReport(runWith(defaultDependencies(() =>
      jsonResponse({
        error: `${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`,
        code: "GRAND_HALL_INTAKE_BUSY",
      }, 429, {
        "retry-after": "1",
        "x-private-diagnostic": ADMIN_TOKEN,
      })
    )));

    expect(report).toEqual({
      class: "safe_to_retry",
      code: "GRAND_HALL_INTAKE_BUSY",
      status: 429,
      retryAfterSeconds: 1,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(ADMIN_TOKEN);
    expect(serialized).not.toContain(API_ORIGIN);
    expect(serialized).not.toContain(MANIFEST_PATH);
  });

  it("does not echo an arbitrary response code or unbounded Retry-After", async () => {
    const report = await failureReport(runWith(defaultDependencies(() =>
      jsonResponse({
        error: ADMIN_TOKEN,
        code: `SECRET_${ADMIN_TOKEN}`,
      }, 500, { "retry-after": "999999" })
    )));

    expect(report).toEqual({
      class: "safe_to_retry",
      code: "HTTP_ERROR",
      status: 500,
    });
    expect(JSON.stringify(report)).not.toContain(ADMIN_TOKEN);
  });

  it("classifies an authenticated refusal as stop without exposing its message", async () => {
    const report = await failureReport(runWith(defaultDependencies(() =>
      jsonResponse({ error: ADMIN_TOKEN, code: "UNAUTHORIZED" }, 401)
    )));
    expect(report).toEqual({
      class: "stop",
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("preserves uncertain admission outcome for a lost PUT response", async () => {
    let requestCount = 0;
    const report = await failureReport(runWithArgs(admissionCliArgs(), {
      fetchImpl: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return jsonResponse(preflightEnvelope([UPLOAD_INDEX]));
        }
        throw new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`);
      },
    }));

    expect(report).toEqual({
      class: "reconcile_admission",
      code: "REQUEST_OUTCOME_UNKNOWN",
    });
    expect(requestCount).toBe(2);
  });

  it("preserves admission reconciliation and Retry-After for a definite busy response", async () => {
    let requestCount = 0;
    const report = await failureReport(runWithArgs(admissionCliArgs(), {
      fetchImpl: () => {
        requestCount += 1;
        return requestCount === 1
          ? jsonResponse(preflightEnvelope([UPLOAD_INDEX]))
          : jsonResponse(
              { error: ADMIN_TOKEN, code: "GRAND_HALL_INTAKE_BUSY" },
              429,
              { "retry-after": "1" },
            );
      },
    }));

    expect(report).toEqual({
      class: "reconcile_admission",
      code: "GRAND_HALL_INTAKE_BUSY",
      status: 429,
      retryAfterSeconds: 1,
    });
  });

  it("preserves uncertain apply outcome for a lost commit response", async () => {
    let requestCount = 0;
    const report = await failureReport(runWith(defaultDependencies(() => {
      requestCount += 1;
      if (requestCount === 1) return jsonResponse(preflightEnvelope());
      throw new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`);
    })));

    expect(report).toEqual({
      class: "reconcile_apply",
      code: "REQUEST_OUTCOME_UNKNOWN",
    });
    expect(requestCount).toBe(2);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [429, "GRAND_HALL_INTAKE_BUSY"],
    [500, "GRAND_HALL_INTAKE_FAILED"],
  ] as const)(
    "makes rehearsal HTTP %s terminal from request entry even when code %s is otherwise retryable",
    async (status, code) => {
      const report = await failureReport(runWithArgs(rehearsalCliArgs(), {
        fetchImpl: () => jsonResponse(
          { error: ADMIN_TOKEN, code },
          status,
          { "retry-after": "1" },
        ),
      }));

      expect(report).toEqual({
        class: "terminal_rehearsal",
        code,
        status,
      });
    },
  );

  it("makes a synchronous rehearsal transport failure terminal once request entry begins", async () => {
    const report = await failureReport(runWithArgs(rehearsalCliArgs(), {
      fetchImpl: () => {
        throw new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`);
      },
    }));
    expect(report).toEqual({
      class: "terminal_rehearsal",
      code: "REQUEST_OUTCOME_UNKNOWN",
    });
  });

  it("keeps local rehearsal failures before request entry non-terminal", async () => {
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    const report = await failureReport(runWithArgs(rehearsalCliArgs(), {
      inspectFrontier: () => Promise.reject(new Error(ADMIN_TOKEN)),
      fetchImpl,
    }));
    expect(report).toEqual({
      class: "stop",
      code: "LOCAL_PRECONDITION_FAILED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["apply", "reconcile_apply"],
    ["admission", "reconcile_admission"],
    ["rehearsal", "terminal_rehearsal"],
  ] as const)(
    "preserves %s ambiguity when receipt construction fails after a successful mutation response",
    async (mode, expectedClass) => {
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = () => {
        requestCount += 1;
        if (mode === "rehearsal") return jsonResponse(rehearsalEnvelope());
        if (requestCount === 1) {
          return jsonResponse(mode === "admission"
            ? preflightEnvelope([UPLOAD_INDEX])
            : preflightEnvelope());
        }
        return mode === "admission"
          ? jsonResponse(uploadEnvelope(UPLOAD_INDEX, true), 201)
          : jsonResponse(commitEnvelope(), 201);
      };
      const args = mode === "apply"
        ? cliArgs()
        : mode === "admission"
          ? admissionCliArgs()
          : rehearsalCliArgs();
      const report = await failureReport(runWithArgs(args, {
        fetchImpl,
        now: () => {
          throw new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`);
        },
      }));

      expect(report).toEqual({
        class: expectedClass,
        code: "EVIDENCE_FINALIZATION_FAILED",
      });
      expect(requestCount).toBe(mode === "rehearsal" ? 1 : 2);
    },
  );

  it.each([
    ["apply", "reconcile_apply"],
    ["admission", "reconcile_admission"],
    ["rehearsal", "terminal_rehearsal"],
  ] as const)(
    "preserves %s ambiguity when the reserved evidence file cannot be flushed",
    async (mode, expectedClass) => {
      const directory = await mkdtemp(join(tmpdir(), "grand-hall-flush-fail-"));
      const outPath = join(directory, "receipt.json");
      const probe = await open(join(directory, "probe"), "w");
      const fileHandlePrototype = Object.getPrototypeOf(probe) as {
        sync: () => Promise<void>;
      };
      await probe.close();
      const sync = vi.spyOn(fileHandlePrototype, "sync").mockRejectedValueOnce(
        new Error(`${ADMIN_TOKEN} ${API_ORIGIN} ${MANIFEST_PATH}`),
      );
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = () => {
        requestCount += 1;
        if (mode === "rehearsal") return jsonResponse(rehearsalEnvelope());
        if (requestCount === 1) {
          return jsonResponse(mode === "admission"
            ? preflightEnvelope([UPLOAD_INDEX])
            : preflightEnvelope());
        }
        return mode === "admission"
          ? jsonResponse(uploadEnvelope(UPLOAD_INDEX, true), 201)
          : jsonResponse(commitEnvelope(), 201);
      };
      const args = mode === "apply"
        ? cliArgs(outPath)
        : mode === "admission"
          ? admissionCliArgs(outPath)
          : rehearsalCliArgs(outPath);

      try {
        const report = await failureReport(runWithArgs(args, { fetchImpl }));
        expect(report).toEqual({
          class: expectedClass,
          code: "EVIDENCE_FINALIZATION_FAILED",
        });
      } finally {
        sync.mockRestore();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("Grand Hall exact local upload", () => {
  it("makes apply commit-only and refuses an incomplete server frontier without reading member bytes", async () => {
    const inspectLocalPath = vi.fn();
    const readLocalMember = vi.fn();
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return jsonResponse(preflightEnvelope([UPLOAD_INDEX]));
    };
    await expect(runWith({
      inspectLocalPath,
      readLocalMember,
      fetchImpl,
    })).rejects.toThrow("requires all eleven Grand Hall members");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.init.method).toBe("POST");
    expect(inspectLocalPath).not.toHaveBeenCalled();
    expect(readLocalMember).not.toHaveBeenCalled();
  });

  it.each([200, 201])(
    "admits only the first next exact member through the selected API after HTTP %s and never commits",
    async (uploadStatus) => {
      const requests: RecordedRequest[] = [];
      const missingIndices = [FIRST_ADMISSION_INDEX, UPLOAD_INDEX];
      const fetchImpl: GrandHallIntakeFetch = (input, init) => {
        requests.push({ input, init });
        if (requests.length === 1) {
          return jsonResponse(preflightEnvelope(missingIndices));
        }
        return jsonResponse(
          uploadEnvelope(FIRST_ADMISSION_INDEX, uploadStatus === 201),
          uploadStatus,
        );
      };
      const inspectLocalPath = vi.fn((path: string) => {
        const member = fixtureMemberForPath(path);
        return Promise.resolve(regularInspection(member.sizeBytes));
      });
      const readLocalMember = vi.fn((path: string) => {
        const member = fixtureMemberForPath(path);
        return Promise.resolve(fixtureMemberBuffer(member));
      });
      const verifyMemberBuffer = vi.fn((
        bytes: Buffer,
        member: GrandHallFrontierMemberSpec,
      ) => {
        expect(bytes).toBe(fixtureMemberBuffer(member));
      });

      const result = await runWithArgs(admissionCliArgs(), {
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        inspectLocalPath,
        readLocalMember,
        verifyMemberBuffer,
        fetchImpl,
      });

      expect(result).toMatchObject({
        schemaVersion: "venviewer.grand-hall-frontier-source-admission-evidence.v1",
        mode: "admit_next_member",
        admittedMember: {
          memberIndex: FIRST_ADMISSION_INDEX,
          fileName: FIRST_ADMISSION_MEMBER.fileName,
          httpStatus: uploadStatus,
          created: uploadStatus === 201,
        },
        progress: {
          existingMemberCountBefore: GRAND_HALL_FRONTIER_MEMBERS.length - 2,
          uploadRequiredCountBefore: 2,
          existingMemberCountAfter: GRAND_HALL_FRONTIER_MEMBERS.length - 1,
          uploadRequiredCountAfter: 1,
          allMembersVerified: false,
        },
        committed: false,
        registered: false,
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]?.init.method).toBe("PUT");
      expect(requests[1]?.init.headers).toEqual({
        ...uploadCapability(FIRST_ADMISSION_INDEX).headers,
        authorization: `Bearer ${ADMIN_TOKEN}`,
      });
      expect(requests[1]?.init.body).toBe(
        fixtureMemberBuffer(FIRST_ADMISSION_MEMBER),
      );
      expect(requests[1]?.init.redirect).toBe("error");
      expect(requests[1]?.input).toBe(
        `${API_ORIGIN}${uploadCapability(FIRST_ADMISSION_INDEX).path}`,
      );
      expect(requests.some((request) => request.input.endsWith("/commit"))).toBe(false);
      expect(inspectLocalPath).toHaveBeenCalledTimes(2);
      expect(readLocalMember).toHaveBeenCalledTimes(1);
      expect(readLocalMember).toHaveBeenCalledWith(
        expect.stringContaining(FIRST_ADMISSION_MEMBER.fileName),
        FIRST_ADMISSION_MEMBER.sizeBytes,
        GRAND_HALL_MAX_MEMBER_BUFFER_BYTES,
      );
      expect(verifyMemberBuffer).toHaveBeenCalledOnce();
      expect(verifyMemberBuffer.mock.calls[0]?.[0]).toBe(
        fixtureMemberBuffer(FIRST_ADMISSION_MEMBER),
      );
      expect(verifyMemberBuffer.mock.calls[0]?.[1]).toBe(
        FIRST_ADMISSION_MEMBER,
      );
    },
  );

  it("rejects an upload performed by a different admin than the preflight operator", async () => {
    let requestCount = 0;
    const report = await failureReport(runWithArgs(admissionCliArgs(), {
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath: () => Promise.resolve(
        regularInspection(FIRST_ADMISSION_MEMBER.sizeBytes),
      ),
      readLocalMember: () => Promise.resolve(
        fixtureMemberBuffer(FIRST_ADMISSION_MEMBER),
      ),
      verifyMemberBuffer: (bytes, member) => {
        expect(bytes).toBe(fixtureMemberBuffer(member));
      },
      fetchImpl: () => {
        requestCount += 1;
        return requestCount === 1
          ? jsonResponse(preflightEnvelope([FIRST_ADMISSION_INDEX]))
          : jsonResponse(uploadEnvelope(
              FIRST_ADMISSION_INDEX,
              true,
              "10000000-0000-4000-8000-000000000002",
            ), 201);
      },
    }));
    expect(report).toEqual({
      class: "reconcile_admission",
      code: "INVALID_RESPONSE",
    });
  });

  it("emits complete progress without reading, uploading, or committing when all members already exist", async () => {
    const inspectLocalPath = vi.fn();
    const readLocalMember = vi.fn();
    const requests: RecordedRequest[] = [];
    const result = await runWithArgs(admissionCliArgs(), {
      inspectLocalPath,
      readLocalMember,
      fetchImpl: (input, init) => {
        requests.push({ input, init });
        return jsonResponse(preflightEnvelope());
      },
    });
    expect(result).toMatchObject({
      mode: "admit_next_member",
      admittedMember: null,
      progress: {
        existingMemberCountBefore: GRAND_HALL_FRONTIER_MEMBERS.length,
        uploadRequiredCountBefore: 0,
        existingMemberCountAfter: GRAND_HALL_FRONTIER_MEMBERS.length,
        uploadRequiredCountAfter: 0,
        allMembersVerified: true,
      },
      committed: false,
      registered: false,
    });
    expect(requests).toHaveLength(1);
    expect(inspectLocalPath).not.toHaveBeenCalled();
    expect(readLocalMember).not.toHaveBeenCalled();
  });

  it.each([
    ["symlink", { ...regularInspection(UPLOAD_MEMBER.sizeBytes), kind: "symlink" as const }],
    ["non-file", { ...regularInspection(UPLOAD_MEMBER.sizeBytes), kind: "other" as const }],
  ])("rejects an upload member that is a %s", async (_name, inspection) => {
    const readLocalMember = vi.fn(() =>
      Promise.resolve(fixtureMemberBuffer(UPLOAD_MEMBER))
    );
    await expect(runWithArgs(admissionCliArgs(), {
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath: () => Promise.resolve(inspection),
      readLocalMember,
      verifyMemberBuffer: () => undefined,
      fetchImpl: () => jsonResponse(preflightEnvelope([UPLOAD_INDEX])),
    })).rejects.toThrow("not an exact regular file");
    expect(readLocalMember).not.toHaveBeenCalled();
  });

  it("rejects an exact-size Buffer with the wrong SHA before PUT", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return jsonResponse(preflightEnvelope([UPLOAD_INDEX]));
    };
    await expect(runWithArgs(admissionCliArgs(), {
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath: () => Promise.resolve(regularInspection(UPLOAD_MEMBER.sizeBytes)),
      readLocalMember: () => Promise.resolve(Buffer.alloc(UPLOAD_MEMBER.sizeBytes, 0x4a)),
      verifyMemberBuffer: verifyGrandHallMemberBuffer,
      fetchImpl,
    })).rejects.toThrow("failed exact local byte verification");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.init.method).toBe("POST");
  });

  it("does not commit after a non-race upload failure", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return requests.length === 1
        ? jsonResponse(preflightEnvelope([UPLOAD_INDEX]))
        : new Response(null, { status: 400 });
    };
    await expect(runWithArgs(admissionCliArgs(), {
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      fetchImpl,
    })).rejects.toThrow("upload failed with HTTP 400");
    expect(requests).toHaveLength(2);
  });

  it("detects a path replacement after preflight and before PUT", async () => {
    const inspections = [
      regularInspection(UPLOAD_MEMBER.sizeBytes),
      { ...regularInspection(UPLOAD_MEMBER.sizeBytes), inode: 99 },
    ];
    const inspectLocalPath = vi.fn(() => {
      const inspection = inspections.shift();
      if (inspection === undefined) throw new Error("Unexpected inspection.");
      return Promise.resolve(inspection);
    });
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() =>
      jsonResponse(preflightEnvelope([UPLOAD_INDEX]))
    );
    await expect(runWithArgs(admissionCliArgs(), {
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath,
      verifyMemberBuffer: () => undefined,
      fetchImpl,
    })).rejects.toThrow("changed while it was read");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("verifies SHA-256 over the exact Buffer rather than metadata", () => {
    const bytes = Buffer.from("exact-buffer");
    const member = {
      fileName: "test.sog",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    expect(() => {
      verifyGrandHallMemberBuffer(bytes, member);
    }).not.toThrow();
    expect(() => {
      verifyGrandHallMemberBuffer(Buffer.from("wrong-buffer"), member);
    }).toThrow("failed exact local byte verification");
  });

  it("bounds the production file reader and returns exactly the source bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grand-hall-intake-"));
    const filePath = join(directory, "member.sog");
    const expected = Buffer.from("bounded-member");
    try {
      await writeFile(filePath, expected);
      await expect(readBoundedGrandHallMember(
        filePath,
        expected.byteLength,
        expected.byteLength,
      )).resolves.toEqual(expected);
      await expect(readBoundedGrandHallMember(
        filePath,
        expected.byteLength,
        expected.byteLength - 1,
      )).rejects.toThrow("buffer limit");
      await expect(readBoundedGrandHallMember(
        filePath,
        expected.byteLength - 1,
        expected.byteLength,
      )).rejects.toThrow("changed before it could be read");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Grand Hall commit evidence", () => {
  it.each([
    ["target", { targetId: "different-target" }],
    ["deployed Git SHA", { deployedGitSha: "f".repeat(40) }],
    ["member count", { memberCount: GRAND_HALL_FRONTIER_MEMBERS.length - 1 }],
    ["byte total", { totalBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES - 1 }],
    ["Gaussian total", { gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT - 1 }],
    ["content digest", { contentDigest: "invalid" }],
  ] satisfies readonly (readonly [string, Partial<FixtureCommitEnvelope["data"]>])[])(
    "rejects mismatched commit %s",
    async (_name, overrides) => {
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = () => {
        requestCount += 1;
        return requestCount === 1
          ? jsonResponse(preflightEnvelope())
          : jsonResponse(commitEnvelope(overrides));
      };
      await expect(runWith(defaultDependencies(fetchImpl))).rejects.toThrow(/commit/u);
      expect(requestCount).toBe(2);
    },
  );

  it("makes an idempotent repeated run demonstrable with the same package identity", async () => {
    const run = (created: boolean) => {
      let requestCount = 0;
      return runWith(defaultDependencies(() => {
        requestCount += 1;
        return requestCount === 1
          ? jsonResponse(preflightEnvelope())
          : jsonResponse(commitEnvelope({ created }), created ? 201 : 200);
      }));
    };
    const first = await run(true);
    const repeated = await run(false);
    if (first.mode !== "apply" || repeated.mode !== "apply") {
      throw new Error("Expected apply evidence receipts.");
    }
    expect(repeated.package).toEqual({
      ...first.package,
      created: false,
    });
    expect(first.package.created).toBe(true);
    expect(repeated.puts).toEqual([]);
  });
});

describe("Grand Hall CLI absolute HTTP deadlines", () => {
  it("uses a finite production deadline", () => {
    expect(GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS).toBe(600_000);
  });

  it.each(["preflight", "upload", "commit", "rehearsal"] as const)(
    "aborts a stalled %s request at its absolute deadline",
    async (stalledOperation) => {
      const signals: AbortSignal[] = [];
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
        requestCount += 1;
        signals.push(init.signal);
        const shouldStall = stalledOperation === "preflight" ||
          stalledOperation === "rehearsal" || requestCount === 2;
        if (shouldStall) return new Promise<Response>(() => undefined);
        return jsonResponse(stalledOperation === "upload"
          ? preflightEnvelope([UPLOAD_INDEX])
          : preflightEnvelope());
      };
      const operationArgs = stalledOperation === "upload"
        ? admissionCliArgs()
        : stalledOperation === "rehearsal"
          ? rehearsalCliArgs()
          : cliArgs();
      await expect(runWithArgs(operationArgs, {
        fetchImpl,
        httpRequestDeadlineMs: 10,
      })).rejects.toThrow("absolute request deadline");
      expect(requestCount).toBe(
        stalledOperation === "preflight" || stalledOperation === "rehearsal"
          ? 1
          : 2,
      );
      expect(signals).toHaveLength(requestCount);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
      expect(signals.at(-1)?.aborted).toBe(true);
    },
  );

  it.each(["preflight", "upload", "commit", "rehearsal"] as const)(
    "includes a stalled %s response body in the deadline and makes no later request",
    async (stalledOperation) => {
      const signals: AbortSignal[] = [];
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
        requestCount += 1;
        signals.push(init.signal);
        const bodyMustStall = stalledOperation === "preflight" ||
          stalledOperation === "rehearsal" || requestCount === 2;
        if (bodyMustStall) {
          return new Response(new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
          }), {
            status: stalledOperation === "upload" ? 201 : 200,
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse(stalledOperation === "upload"
          ? preflightEnvelope([UPLOAD_INDEX])
          : preflightEnvelope());
      };

      const operationArgs = stalledOperation === "upload"
        ? admissionCliArgs()
        : stalledOperation === "rehearsal"
          ? rehearsalCliArgs()
          : cliArgs();
      await expect(runWithArgs(operationArgs, {
        fetchImpl,
        httpRequestDeadlineMs: 10,
      })).rejects.toThrow("absolute request deadline");
      expect(requestCount).toBe(
        stalledOperation === "preflight" || stalledOperation === "rehearsal"
          ? 1
          : 2,
      );
      expect(signals.at(-1)?.aborted).toBe(true);
    },
  );
});

describe("Grand Hall conditional-PUT staging rehearsal", () => {
  it("delegates the complete proof to one authenticated binary request", async () => {
    const member = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (member === undefined) throw new Error("Rehearsal fixture member missing.");
    const memberBytes = fixtureMemberBuffer(member);
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return jsonResponse(rehearsalEnvelope());
    };
    const readLocalMember = vi.fn(() => Promise.resolve(memberBytes));
    const inspectLocalPath = vi.fn((path: string) => {
      const member = GRAND_HALL_FRONTIER_MEMBERS.find((candidate) =>
        path.endsWith(candidate.fileName)
      );
      if (member === undefined) throw new Error("Unknown rehearsal fixture path.");
      return Promise.resolve(regularInspection(member.sizeBytes));
    });

    const result = await runGrandHallFrontierIntake({
      args: rehearsalCliArgs(),
      env: intakeEnv(),
      dependencies: {
        ...fixtureLocalDependencies(),
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        inspectLocalPath,
        readLocalMember,
        verifyMemberBuffer: () => undefined,
        fetchImpl,
        now: () => RECORDED_AT,
      },
      log: () => undefined,
    });

    expect(result).toMatchObject({
      schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v2",
      mode: "conditional_put_rehearsal",
      recordedAt: RECORDED_AT.toISOString(),
      reviewedGitSha: REVIEWED_GIT_SHA,
      serverEvidence: rehearsalEnvelope().data,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      `${API_ORIGIN}/admin/assets/grand-hall-frontier-intake/rehearsal`,
    );
    expect(requests[0]?.init).toMatchObject({
      method: "PUT",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-length": String(member.sizeBytes),
        "content-type": "application/octet-stream",
        "x-venviewer-frontier-receipt-sha256": GRAND_HALL_FRONTIER_RECEIPT_SHA256,
        "x-venviewer-intake-api-origin": API_ORIGIN,
        "x-venviewer-intake-deployed-git-sha": REVIEWED_GIT_SHA,
        "x-venviewer-intake-target-id": TARGET_ID,
        "x-venviewer-manifest-sha256": GRAND_HALL_MANIFEST_SHA256,
      },
      redirect: "error",
    });
    expect(requests[0]?.init.body).toBe(memberBytes);
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(readLocalMember).toHaveBeenCalledOnce();
    expect(inspectLocalPath).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("rejects a non-success or changed server proof after one request", async () => {
    const readLocalMember = vi.fn((path: string) =>
      Promise.resolve(fixtureMemberBuffer(fixtureMemberForPath(path)))
    );
    const changed = rehearsalEnvelope();
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() => jsonResponse({
      ...changed,
      data: {
        ...changed.data,
        apiOrigin: "https://wrong.example.test",
      },
    }));
    await expect(runGrandHallFrontierIntake({
      args: rehearsalCliArgs(),
      env: intakeEnv(),
      dependencies: {
        ...fixtureLocalDependencies(),
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        readLocalMember,
        fetchImpl,
      },
      log: () => undefined,
    })).rejects.toThrow("invalid or mismatched evidence");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readLocalMember).toHaveBeenCalledTimes(1);
  });
});

describe("Grand Hall intake static authority boundary", () => {
  it("contains no direct database, object-store credential, prefix, or capture-session input", async () => {
    const source = await readFile(
      resolve("src/scripts/intake-grand-hall-big-model-frontier.ts"),
      "utf8",
    );
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("R2_ACCESS_KEY_ID");
    expect(source).not.toContain("R2_SECRET_ACCESS_KEY");
    expect(source).not.toContain("--object-prefix");
    expect(source).not.toContain("--capture-session-id");
    expect(source).not.toContain("--token");
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("process.exit(");
    expect(source).not.toContain("timer.unref(");
    expect(source).toContain("serializeGrandHallFrontierEvidenceReceipt(result)");
  });

  it("runs the server-bound command without loading a local API .env file", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    const command = packageJson.scripts?.["assets:intake-grand-hall-big-model-frontier"];
    expect(command).toBe(
      "node --import tsx src/scripts/intake-grand-hall-big-model-frontier.ts",
    );
    expect(command).not.toContain("--env-file");
  });
});

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  GRAND_HALL_INTAKE_HTTP_REQUEST_DEADLINE_MS,
  GRAND_HALL_MAX_MEMBER_BUFFER_BYTES,
  assertGrandHallReviewedGitState,
  inspectGrandHallGitState,
  parseGrandHallFrontierIntakeArgs,
  readBoundedGrandHallMember,
  runGrandHallFrontierIntake,
  serializeGrandHallFrontierEvidenceReceipt,
  verifyGrandHallMemberBuffer,
  type GrandHallFrontierIntakeDependencies,
  type GrandHallIntakeFetch,
  type GrandHallLocalPathInspection,
} from "../scripts/intake-grand-hall-big-model-frontier.js";

const MANIFEST_PATH = resolve("test-fixtures", GRAND_HALL_MANIFEST_FILE_NAME);
const API_ORIGIN = "https://api.production.example.test";
const TARGET_ID = "production-eu-1";
const ADMIN_TOKEN = "admin-token-kept-out-of-cli-output";
const ADMIN_USER_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_BINDING = "c".repeat(64);
const CONTENT_DIGEST = "d".repeat(64);
const REVIEWED_GIT_SHA = "e".repeat(40);
const RECORDED_AT = new Date("2026-08-22T12:00:00.000Z");
const RUNTIME_PACKAGE_ID = "00000000-0000-4000-8000-000000000012";
const UPLOAD_INDEX = GRAND_HALL_FRONTIER_MEMBERS.length - 1;
const UPLOAD_MEMBER = GRAND_HALL_FRONTIER_MEMBERS[UPLOAD_INDEX];
const TEST_MEMBER_BUFFERS = new Map<number, Buffer>();

if (UPLOAD_MEMBER === undefined) {
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

function cliArgs(): readonly string[] {
  return [
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

function rehearsalCliArgs(): readonly string[] {
  return cliArgs().map((argument) =>
    argument === "--apply" ? "--rehearse-conditional-put" : argument
  );
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function uploadEnvelope(memberIndex: number, created: boolean) {
  const member = GRAND_HALL_FRONTIER_MEMBERS[memberIndex];
  if (member === undefined) throw new Error("Unknown upload fixture member.");
  return {
    data: {
      created,
      memberIndex,
      fileName: member.fileName,
      sizeBytes: member.sizeBytes,
      sha256: member.sha256,
    },
  };
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
  return runGrandHallFrontierIntake({
    args: cliArgs(),
    env: { [GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV]: ADMIN_TOKEN },
    dependencies: {
      ...fixtureLocalDependencies(),
      now: () => RECORDED_AT,
      ...dependencies,
    },
    log,
  });
}

afterAll(() => {
  for (const buffer of TEST_MEMBER_BUFFERS.values()) buffer.fill(0);
  TEST_MEMBER_BUFFERS.clear();
});

describe("Grand Hall server-bound intake argument boundary", () => {
  it("requires the explicit apply selections and normalizes only the manifest path", () => {
    expect(parseGrandHallFrontierIntakeArgs(cliArgs())).toEqual({
      manifestPath: MANIFEST_PATH,
      apiOrigin: API_ORIGIN,
      targetId: TARGET_ID,
      reviewedGitSha: REVIEWED_GIT_SHA,
      mode: "apply",
    });
  });

  it("selects the bounded conditional-PUT rehearsal instead of apply", () => {
    expect(parseGrandHallFrontierIntakeArgs(rehearsalCliArgs())).toMatchObject({
      reviewedGitSha: REVIEWED_GIT_SHA,
      mode: "conditional_put_rehearsal",
    });
  });

  it.each([
    [["--manifest", MANIFEST_PATH, "--api-origin", API_ORIGIN, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "exactly one operation"],
    [["--manifest", "Grand_Hall.lcc2", "--apply", "--api-origin", API_ORIGIN, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "absolute"],
    [["--manifest", MANIFEST_PATH, "--apply", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "--api-origin"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", API_ORIGIN, "--reviewed-git-sha", REVIEWED_GIT_SHA], "--target-id"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", "http://api.example.test", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "HTTPS"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", `${API_ORIGIN}/v1`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", `${API_ORIGIN}?redirect=1`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", "https://user:pass@api.example.test", "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", ` ${API_ORIGIN}`, "--target-id", TARGET_ID, "--reviewed-git-sha", REVIEWED_GIT_SHA], "clean HTTPS"],
    [["--manifest", MANIFEST_PATH, "--apply", "--api-origin", API_ORIGIN, "--target-id", "UPPERCASE", "--reviewed-git-sha", REVIEWED_GIT_SHA], "deployment identifier"],
    [[...cliArgs().slice(0, -2)], "--reviewed-git-sha"],
    [[...cliArgs(), "--rehearse-conditional-put"], "exactly one operation"],
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

  it("requires the bearer token from its one environment variable before inspection or network access", async () => {
    const inspectFrontier = vi.fn(() => Promise.resolve(canonicalReceipt()));
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runGrandHallFrontierIntake({
      args: cliArgs(),
      env: {},
      dependencies: { inspectFrontier, fetchImpl },
      log: () => undefined,
    })).rejects.toThrow(GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV);
    expect(inspectFrontier).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Grand Hall reviewed Git admission", () => {
  it("accepts only an existing reviewed commit that is exact HEAD in a clean worktree", () => {
    expect(() => {
      assertGrandHallReviewedGitState({
        headSha: REVIEWED_GIT_SHA,
        reviewedCommitExists: true,
        clean: true,
      }, REVIEWED_GIT_SHA);
    }).not.toThrow();
  });

  it.each([
    ["missing commit", {
      headSha: REVIEWED_GIT_SHA,
      reviewedCommitExists: false,
      clean: true,
    }, "does not exist"],
    ["different HEAD", {
      headSha: "f".repeat(40),
      reviewedCommitExists: true,
      clean: true,
    }, "HEAD does not equal"],
    ["tracked or untracked changes", {
      headSha: REVIEWED_GIT_SHA,
      reviewedCommitExists: true,
      clean: false,
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
    const dependencies = defaultDependencies(fetchImpl);
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
});

describe("Grand Hall exact local upload", () => {
  const uploadBytes = Buffer.alloc(UPLOAD_MEMBER.sizeBytes, 0x4a);

  afterAll(() => {
    uploadBytes.fill(0);
  });

  it("admits every apply member before the first network request", async () => {
    let readCount = 0;
    const fetchImpl = vi.fn<GrandHallIntakeFetch>();
    await expect(runWith({
      readLocalMember: (path) => {
        readCount += 1;
        if (readCount === 5) throw new Error("fixture local read failure");
        return Promise.resolve(fixtureMemberBuffer(fixtureMemberForPath(path)));
      },
      fetchImpl,
    })).rejects.toThrow("could not be read safely");
    expect(readCount).toBe(5);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([200, 201])(
    "PUTs the exact verified Buffer through the selected API and commits after HTTP %s",
    async (uploadStatus) => {
      const requests: RecordedRequest[] = [];
      const fetchImpl: GrandHallIntakeFetch = (input, init) => {
        requests.push({ input, init });
        if (requests.length === 1) {
          return jsonResponse(preflightEnvelope([UPLOAD_INDEX]));
        }
        if (requests.length === 2) {
          return jsonResponse(
            uploadEnvelope(UPLOAD_INDEX, uploadStatus === 201),
            uploadStatus,
          );
        }
        return jsonResponse(commitEnvelope(), 201);
      };
      const inspectLocalPath = vi.fn((path: string) => {
        const member = fixtureMemberForPath(path);
        return Promise.resolve(regularInspection(member.sizeBytes));
      });
      const readLocalMember = vi.fn((path: string) => {
        const member = fixtureMemberForPath(path);
        return Promise.resolve(member === UPLOAD_MEMBER
          ? uploadBytes
          : fixtureMemberBuffer(member));
      });
      const verifyMemberBuffer = vi.fn((
        bytes: Buffer,
        member: GrandHallFrontierMemberSpec,
      ) => {
        expect(bytes).toBe(member === UPLOAD_MEMBER
          ? uploadBytes
          : fixtureMemberBuffer(member));
      });

      const result = await runWith({
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        inspectLocalPath,
        readLocalMember,
        verifyMemberBuffer,
        fetchImpl,
      });

      expect(result).toMatchObject({
        mode: "apply",
        puts: [{
          memberIndex: UPLOAD_INDEX,
          httpStatus: uploadStatus,
          created: uploadStatus === 201,
        }],
      });
      expect(requests).toHaveLength(3);
      expect(requests[1]?.init.method).toBe("PUT");
      expect(requests[1]?.init.headers).toEqual({
        ...uploadCapability(UPLOAD_INDEX).headers,
        authorization: `Bearer ${ADMIN_TOKEN}`,
      });
      expect(requests[1]?.init.body).toBe(uploadBytes);
      expect(requests[1]?.init.redirect).toBe("error");
      expect(requests[1]?.input).toBe(
        `${API_ORIGIN}${uploadCapability(UPLOAD_INDEX).path}`,
      );
      expect(inspectLocalPath).toHaveBeenCalledTimes(GRAND_HALL_FRONTIER_MEMBERS.length * 2);
      expect(readLocalMember).toHaveBeenCalledWith(
        expect.stringContaining(UPLOAD_MEMBER.fileName),
        UPLOAD_MEMBER.sizeBytes,
        GRAND_HALL_MAX_MEMBER_BUFFER_BYTES,
      );
      const verificationCall = verifyMemberBuffer.mock.calls.find((call) =>
        call[1] === UPLOAD_MEMBER
      );
      expect(verificationCall?.[0]).toBe(uploadBytes);
      expect(verificationCall?.[1]).toBe(UPLOAD_MEMBER);
    },
  );

  it.each([
    ["symlink", { ...regularInspection(UPLOAD_MEMBER.sizeBytes), kind: "symlink" as const }],
    ["non-file", { ...regularInspection(UPLOAD_MEMBER.sizeBytes), kind: "other" as const }],
  ])("rejects an upload member that is a %s", async (_name, inspection) => {
    const readLocalMember = vi.fn(() => Promise.resolve(uploadBytes));
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath: () => Promise.resolve(inspection),
      readLocalMember,
      verifyMemberBuffer: () => undefined,
      fetchImpl: () => jsonResponse(preflightEnvelope([UPLOAD_INDEX])),
    })).rejects.toThrow("not an exact regular file");
    expect(readLocalMember).not.toHaveBeenCalled();
  });

  it("rejects an exact-size Buffer with the wrong SHA before PUT", async () => {
    const wrongMember = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (wrongMember === undefined) throw new Error("Missing wrong-SHA fixture member.");
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return jsonResponse(preflightEnvelope([UPLOAD_INDEX]));
    };
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath: () => Promise.resolve(regularInspection(wrongMember.sizeBytes)),
      readLocalMember: () => Promise.resolve(Buffer.alloc(wrongMember.sizeBytes, 0x4a)),
      verifyMemberBuffer: verifyGrandHallMemberBuffer,
      fetchImpl,
    })).rejects.toThrow("failed exact local byte verification");
    expect(requests).toHaveLength(0);
  });

  it("does not commit after a non-race upload failure", async () => {
    const requests: RecordedRequest[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      return requests.length === 1
        ? jsonResponse(preflightEnvelope([UPLOAD_INDEX]))
        : new Response(null, { status: 400 });
    };
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      fetchImpl,
    })).rejects.toThrow("upload failed with HTTP 400");
    expect(requests).toHaveLength(2);
  });

  it("detects a path replacement before the first network request", async () => {
    const firstMember = GRAND_HALL_FRONTIER_MEMBERS[0];
    if (firstMember === undefined) throw new Error("Missing path-replacement fixture member.");
    const inspections = [
      regularInspection(firstMember.sizeBytes),
      { ...regularInspection(firstMember.sizeBytes), inode: 99 },
    ];
    const inspectLocalPath = vi.fn(() => {
      const inspection = inspections.shift();
      if (inspection === undefined) throw new Error("Unexpected inspection.");
      return Promise.resolve(inspection);
    });
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() =>
      jsonResponse(preflightEnvelope([UPLOAD_INDEX]))
    );
    await expect(runWith({
      inspectFrontier: () => Promise.resolve(canonicalReceipt()),
      inspectLocalPath,
      verifyMemberBuffer: () => undefined,
      fetchImpl,
    })).rejects.toThrow("changed while it was read");
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it.each(["preflight", "upload", "commit"] as const)(
    "aborts a stalled %s request at its absolute deadline",
    async (stalledOperation) => {
      const signals: AbortSignal[] = [];
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
        requestCount += 1;
        signals.push(init.signal);
        const shouldStall = stalledOperation === "preflight" || requestCount === 2;
        if (shouldStall) return new Promise<Response>(() => undefined);
        return jsonResponse(stalledOperation === "upload"
          ? preflightEnvelope([UPLOAD_INDEX])
          : preflightEnvelope());
      };
      await expect(runWith({
        fetchImpl,
        httpRequestDeadlineMs: 10,
      })).rejects.toThrow("absolute request deadline");
      expect(requestCount).toBe(stalledOperation === "preflight" ? 1 : 2);
      expect(signals).toHaveLength(requestCount);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
      expect(signals.at(-1)?.aborted).toBe(true);
    },
  );

  it.each(["preflight", "upload", "commit"] as const)(
    "includes a stalled %s response body in the deadline and makes no later request",
    async (stalledOperation) => {
      const signals: AbortSignal[] = [];
      let requestCount = 0;
      const fetchImpl: GrandHallIntakeFetch = (_input, init) => {
        requestCount += 1;
        signals.push(init.signal);
        const bodyMustStall = stalledOperation === "preflight" || requestCount === 2;
        if (bodyMustStall) {
          return {
            status: stalledOperation === "upload" ? 201 : 200,
            text: () => new Promise<string>(() => undefined),
          } as Response;
        }
        return jsonResponse(stalledOperation === "upload"
          ? preflightEnvelope([UPLOAD_INDEX])
          : preflightEnvelope());
      };

      await expect(runWith({
        fetchImpl,
        httpRequestDeadlineMs: 10,
      })).rejects.toThrow("absolute request deadline");
      expect(requestCount).toBe(stalledOperation === "preflight" ? 1 : 2);
      expect(signals.at(-1)?.aborted).toBe(true);
    },
  );
});

describe("Grand Hall conditional-PUT staging rehearsal", () => {
  it("proves duplicate create-only PUT and corrupt rejection without commit or registration", async () => {
    const allIndices = GRAND_HALL_FRONTIER_MEMBERS.map((_member, index) => index);
    const stillMissing = allIndices.slice(1);
    const requests: RecordedRequest[] = [];
    const putBodies: Buffer[] = [];
    const putFirstBytes: number[] = [];
    const fetchImpl: GrandHallIntakeFetch = (input, init) => {
      requests.push({ input, init });
      if (Buffer.isBuffer(init.body)) {
        putBodies.push(init.body);
        putFirstBytes.push(init.body[0] ?? -1);
      }
      switch (requests.length) {
        case 1:
          return jsonResponse(preflightEnvelope(allIndices));
        case 2:
          return jsonResponse(uploadEnvelope(0, true), 201);
        case 3:
          return jsonResponse(uploadEnvelope(0, false), 200);
        case 4:
          return jsonResponse({
            error: "The uploaded bytes do not match the canonical Grand Hall member.",
            code: "GRAND_HALL_STORAGE_CONFLICT",
          }, 409);
        case 5:
          return jsonResponse(preflightEnvelope(stillMissing));
        default:
          throw new Error("Unexpected rehearsal request.");
      }
    };
    const readLocalMember = vi.fn((
      _path: string,
      expectedSizeBytes: number,
    ) => Promise.resolve(Buffer.alloc(expectedSizeBytes, 0x4a)));
    const inspectLocalPath = vi.fn((path: string) => {
      const member = GRAND_HALL_FRONTIER_MEMBERS.find((candidate) =>
        path.endsWith(candidate.fileName)
      );
      if (member === undefined) throw new Error("Unknown rehearsal fixture path.");
      return Promise.resolve(regularInspection(member.sizeBytes));
    });

    const result = await runGrandHallFrontierIntake({
      args: rehearsalCliArgs(),
      env: { [GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV]: ADMIN_TOKEN },
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
      schemaVersion: "venviewer.grand-hall-frontier-rehearsal-evidence.v1",
      mode: "conditional_put_rehearsal",
      operatorUserId: ADMIN_USER_ID,
      memberZeroPuts: [
        { memberIndex: 0, httpStatus: 201, created: true },
        { memberIndex: 0, httpStatus: 200, created: false },
      ],
      corruptBufferRejection: {
        memberIndex: 1,
        httpStatus: 409,
        errorCode: "GRAND_HALL_STORAGE_CONFLICT",
        remainsUploadRequired: true,
      },
      verificationPreflight: {
        existingMemberCount: 1,
        uploadRequiredCount: GRAND_HALL_FRONTIER_MEMBERS.length - 1,
      },
      committed: false,
      registered: false,
    });
    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.init.signal instanceof AbortSignal)).toBe(true);
    expect(requests.some((request) => request.input.endsWith("/commit"))).toBe(false);
    expect(requests.slice(1, 3).map((request) => request.input)).toEqual([
      `${API_ORIGIN}${uploadCapability(0).path}`,
      `${API_ORIGIN}${uploadCapability(0).path}`,
    ]);
    expect(requests[1]?.init.headers).toEqual(requests[2]?.init.headers);
    expect(putBodies).toHaveLength(3);
    expect(putBodies[0]).toBe(putBodies[1]);
    expect(putBodies[2]?.byteLength).toBe(GRAND_HALL_FRONTIER_MEMBERS[1]?.sizeBytes);
    expect(putFirstBytes).toEqual([0x4a, 0x4a, 0xb5]);
    expect(readLocalMember).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("fails closed after local admission when staging is not fresh", async () => {
    const readLocalMember = vi.fn((path: string) =>
      Promise.resolve(fixtureMemberBuffer(fixtureMemberForPath(path)))
    );
    const fetchImpl = vi.fn<GrandHallIntakeFetch>(() => jsonResponse(preflightEnvelope()));
    await expect(runGrandHallFrontierIntake({
      args: rehearsalCliArgs(),
      env: { [GRAND_HALL_INTAKE_ADMIN_TOKEN_ENV]: ADMIN_TOKEN },
      dependencies: {
        ...fixtureLocalDependencies(),
        inspectFrontier: () => Promise.resolve(canonicalReceipt()),
        readLocalMember,
        fetchImpl,
      },
      log: () => undefined,
    })).rejects.toThrow("fresh dedicated staging target");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readLocalMember).toHaveBeenCalledTimes(2);
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

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";

import {
  parseGrandHallT554NativeReviewStage1CandidateArguments,
} from "../grand-hall-t554-native-review-stage1-candidate-cli.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME,
  GrandHallT554NativeReviewStage1CandidateSchema,
  GrandHallT554NativeReviewStage1ReceiptSchema,
  checkGrandHallT554NativeReviewStage1Candidate,
  generateGrandHallT554NativeReviewStage1Candidate,
  grandHallT554NativeReviewStage1OutputIsOutsideWorkspace,
} from "../grand-hall-t554-native-review-stage1-candidate.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
  __testOnlyGrandHallT554NativeReviewImplementationManifestV2,
} from "../grand-hall-t554-native-review-implementation-manifest-v2.js";

const temporaryRoots: string[] = [];
const WORKSPACE_ROOT = resolve(process.cwd(), "..", "..");
const REVIEWED_GIT_SHA = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: WORKSPACE_ROOT,
  encoding: "utf8",
}).trim();
const REVIEWED_GIT_TREE_SHA = execFileSync(
  "git",
  ["rev-parse", `${REVIEWED_GIT_SHA}^{tree}`],
  { cwd: WORKSPACE_ROOT, encoding: "utf8" },
).trim();
const CANDIDATE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_V1";
const RECEIPT_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_V1";

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

function semanticDigest(domain: string, value: unknown): `sha256:${string}` {
  const canonical = stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
  return `sha256:${createHash("sha256").update(`${domain}\n${canonical}`).digest("hex")}`;
}

function fileDigest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe("Grand Hall T-554 Stage 1 candidate CLI", () => {
  it("separates generate and persisted-check argument surfaces", () => {
    expect(
      parseGrandHallT554NativeReviewStage1CandidateArguments([
        "--workspace",
        "C:\\reviewed-worktree",
        "--reviewed-git-sha",
        REVIEWED_GIT_SHA,
        "--output",
        "D:\\candidate",
      ]),
    ).toEqual({
      mode: "generate",
      workspaceRoot: "C:\\reviewed-worktree",
      reviewedGitSha: REVIEWED_GIT_SHA,
      outputRoot: "D:\\candidate",
    });
    expect(
      parseGrandHallT554NativeReviewStage1CandidateArguments([
        "--check",
        "--output",
        "D:\\candidate",
      ]),
    ).toEqual({ mode: "check", outputRoot: "D:\\candidate" });
    expect(() =>
      parseGrandHallT554NativeReviewStage1CandidateArguments([
        "--check",
        "--workspace",
        "C:\\reviewed-worktree",
        "--output",
        "D:\\candidate",
      ]),
    ).toThrow(/accepts only --output/u);
    expect(
      grandHallT554NativeReviewStage1OutputIsOutsideWorkspace(
        "C:\\reviewed-worktree",
        "D:\\candidate",
      ),
    ).toBe(true);
    expect(
      grandHallT554NativeReviewStage1OutputIsOutsideWorkspace(
        "C:\\reviewed-worktree",
        "C:\\reviewed-worktree\\candidate",
      ),
    ).toBe(false);
  });
});

describe.runIf(process.platform === "win32" && process.arch === "x64")(
  "Grand Hall T-554 deterministic Stage 1 candidate",
  () => {
    it("publishes two exact payloads and independently rejects candidate-record drift", async () => {
      const parent = await mkdtemp(resolve(tmpdir(), "t554-stage1-candidate-test-"));
      temporaryRoots.push(parent);
      const outputRoot = resolve(parent, "candidate");
      const generated = await generateGrandHallT554NativeReviewStage1Candidate({
        workspaceRoot: WORKSPACE_ROOT,
        outputRoot,
        reviewedGitSha: REVIEWED_GIT_SHA,
        __testOnlyWorkspaceGitProbe: () => ({
          sha: REVIEWED_GIT_SHA,
          treeSha: REVIEWED_GIT_TREE_SHA,
          clean: true,
        }),
      });

      expect(generated.candidate).toMatchObject({
        authority: "none",
        state: "deterministic_unreviewed_candidate",
        reviewedGitSha: REVIEWED_GIT_SHA,
        reviewedGitTreeSha: REVIEWED_GIT_TREE_SHA,
        sourceMaterialization: {
          mode: "two_independent_git_archive_snapshots",
          snapshotCount: 2,
          liveWorktreeSourceBytesCompiled: false,
        },
        builderVersion:
          "venviewer.grand-hall-t554-native-review-compiled-pack-builder.v2",
        buildCount: 2,
        deterministicComparison: {
          allRequiredComparisonsIdentical: true,
          everyPayloadMemberByteIdentical: true,
        },
        guards: {
          stage1HashApprovalRequired: true,
          stage1HashApproved: false,
          stage2CapsuleIncluded: false,
          listenerIncluded: false,
          browserLaunchIncluded: false,
          sourceAccessed: false,
          reconstructionAuthorized: false,
          generatedContentAuthorized: false,
          externalNetworkAuthorized: false,
          productionAuthorized: false,
        },
      });
      expect(generated.candidate.builds[1]).toMatchObject({
        manifest: generated.candidate.builds[0].manifest,
        memberInventorySha256:
          generated.candidate.builds[0].memberInventorySha256,
        memberCount: generated.candidate.builds[0].memberCount,
        totalMemberBytes: generated.candidate.builds[0].totalMemberBytes,
      });
      const checked = await checkGrandHallT554NativeReviewStage1Candidate({
        outputRoot,
      });
      expect(checked.receipt).toMatchObject({
        receiptWrittenLast: true,
        stage1HashApprovalRequired: true,
        stage1HashApproved: false,
        totalFileCount: 34,
      });

      const racedCorePath = resolve(
        outputRoot,
        "build-a",
        ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2.split("/"),
      );
      const exactRacedCoreBytes = await readFile(racedCorePath);
      try {
        await expect(
          checkGrandHallT554NativeReviewStage1Candidate({
            outputRoot,
            __testOnlyAfterVerifiedBuild: async ({ label }) => {
              if (label !== "build-a") return;
              await writeFile(
                racedCorePath,
                Buffer.concat([
                  Buffer.from('import "node:os";\n', "utf8"),
                  exactRacedCoreBytes,
                ]),
              );
            },
          }),
        ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
      } finally {
        await writeFile(racedCorePath, exactRacedCoreBytes);
      }

      const candidatePath = resolve(
        outputRoot,
        GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME,
      );
      const receiptPath = resolve(
        outputRoot,
        GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME,
      );
      const exactBytes = await readFile(candidatePath);
      const exactReceiptBytes = await readFile(receiptPath);
      const exactCandidate = GrandHallT554NativeReviewStage1CandidateSchema.parse(
        JSON.parse(exactBytes.toString("utf8")),
      );
      const exactReceipt = GrandHallT554NativeReviewStage1ReceiptSchema.parse(
        JSON.parse(exactReceiptBytes.toString("utf8")),
      );

      const { candidateSha256: _candidateSha256, ...candidateMaterial } =
        exactCandidate;
      const falseAnchorMaterial = {
        ...candidateMaterial,
        reviewAnchor: {
          ...candidateMaterial.reviewAnchor,
          manifestSemanticSha256: `sha256:${"f".repeat(64)}`,
        },
      };
      const falseAnchorCandidate = {
        ...falseAnchorMaterial,
        candidateSha256: semanticDigest(
          CANDIDATE_DIGEST_DOMAIN,
          falseAnchorMaterial,
        ),
      };
      const falseAnchorBytes = canonicalBytes(falseAnchorCandidate);
      const { receiptSha256: _receiptSha256, ...receiptMaterial } = exactReceipt;
      const falseAnchorReceiptMaterial = {
        ...receiptMaterial,
        candidateSha256: falseAnchorCandidate.candidateSha256,
        candidateRecord: {
          ...receiptMaterial.candidateRecord,
          byteLength: falseAnchorBytes.length,
          sha256: fileDigest(falseAnchorBytes),
        },
      };
      const falseAnchorReceipt = {
        ...falseAnchorReceiptMaterial,
        receiptSha256: semanticDigest(
          RECEIPT_DIGEST_DOMAIN,
          falseAnchorReceiptMaterial,
        ),
      };
      await writeFile(candidatePath, canonicalBytes(falseAnchorCandidate));
      await writeFile(receiptPath, canonicalBytes(falseAnchorReceipt));
      await expect(
        checkGrandHallT554NativeReviewStage1Candidate({ outputRoot }),
      ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });

      const expectResealedFalseSurfaceRejected = async (
        closedModuleSurface: typeof candidateMaterial.closedModuleSurface,
      ): Promise<void> => {
        const falseSurfaceMaterial = {
          ...candidateMaterial,
          closedModuleSurface,
        };
        const falseSurfaceCandidate = {
          ...falseSurfaceMaterial,
          candidateSha256: semanticDigest(
            CANDIDATE_DIGEST_DOMAIN,
            falseSurfaceMaterial,
          ),
        };
        const falseSurfaceBytes = canonicalBytes(falseSurfaceCandidate);
        const falseSurfaceReceiptMaterial = {
          ...receiptMaterial,
          candidateSha256: falseSurfaceCandidate.candidateSha256,
          candidateRecord: {
            ...receiptMaterial.candidateRecord,
            byteLength: falseSurfaceBytes.length,
            sha256: fileDigest(falseSurfaceBytes),
          },
        };
        const falseSurfaceReceipt = {
          ...falseSurfaceReceiptMaterial,
          receiptSha256: semanticDigest(
            RECEIPT_DIGEST_DOMAIN,
            falseSurfaceReceiptMaterial,
          ),
        };
        await writeFile(candidatePath, falseSurfaceBytes);
        await writeFile(receiptPath, canonicalBytes(falseSurfaceReceipt));
        await expect(
          checkGrandHallT554NativeReviewStage1Candidate({ outputRoot }),
        ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
      };

      await expectResealedFalseSurfaceRejected({
        ...candidateMaterial.closedModuleSurface,
        externalImports: {
          ...candidateMaterial.closedModuleSurface.externalImports,
          core: [
            ...candidateMaterial.closedModuleSurface.externalImports.core,
            "node:child_process",
          ],
        },
        emittedImports: {
          ...candidateMaterial.closedModuleSurface.emittedImports,
          core: [
            ...candidateMaterial.closedModuleSurface.emittedImports.core,
            {
              path: "node:child_process",
              kind: "import-statement",
              external: true,
            },
          ],
        },
      });
      await expectResealedFalseSurfaceRejected({
        ...candidateMaterial.closedModuleSurface,
        emittedImports: {
          ...candidateMaterial.closedModuleSurface.emittedImports,
          core: [],
        },
      });

      await writeFile(candidatePath, exactBytes);
      const falseCountReceiptMaterial = {
        ...receiptMaterial,
        payloadFileCountPerBuild: 1,
        totalFileCount: 7,
      };
      const falseCountReceipt = {
        ...falseCountReceiptMaterial,
        receiptSha256: semanticDigest(
          RECEIPT_DIGEST_DOMAIN,
          falseCountReceiptMaterial,
        ),
      };
      await writeFile(receiptPath, canonicalBytes(falseCountReceipt));
      await expect(
        checkGrandHallT554NativeReviewStage1Candidate({ outputRoot }),
      ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });

      await writeFile(receiptPath, exactReceiptBytes);
      await writeFile(candidatePath, Buffer.concat([exactBytes, Buffer.from("\n")]));
      await expect(
        checkGrandHallT554NativeReviewStage1Candidate({ outputRoot }),
      ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });

      await writeFile(candidatePath, exactBytes);
      await writeFile(receiptPath, exactReceiptBytes);
      const forgedBuildFacts = await Promise.all(
        (["build-a", "build-b"] as const).map(async (label) => {
          const packRoot = resolve(outputRoot, label);
          const manifestPath = resolve(
            packRoot,
            GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
          );
          const manifestBytes = await readFile(manifestPath);
          const manifest =
            __testOnlyGrandHallT554NativeReviewImplementationManifestV2.parseCanonicalManifestBytes(
              manifestBytes,
            );
          const corePath = resolve(
            packRoot,
            ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2.split("/"),
          );
          const forgedCoreBytes = Buffer.concat([
            Buffer.from('import "node:os";\n', "utf8"),
            await readFile(corePath),
          ]);
          await writeFile(corePath, forgedCoreBytes);
          const members = manifest.members.map((member) =>
            member.relativePath ===
            GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2
              ? {
                  ...member,
                  sha256: fileDigest(forgedCoreBytes),
                  byteLength: forgedCoreBytes.length,
                }
              : member,
          );
          const totalMemberBytes = members.reduce(
            (total, member) => total + member.byteLength,
            0,
          );
          const manifestWithStaleDigest = {
            ...manifest,
            members,
            totalMemberBytes,
          };
          const forgedManifest = {
            ...manifestWithStaleDigest,
            semanticSha256:
              __testOnlyGrandHallT554NativeReviewImplementationManifestV2.computeManifestSemanticSha256(
                manifestWithStaleDigest,
              ),
          };
          const forgedManifestBytes = canonicalBytes(forgedManifest);
          await writeFile(manifestPath, forgedManifestBytes);
          const coreMember = members.find(
            (member) =>
              member.relativePath ===
              GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
          );
          if (coreMember === undefined) throw new Error("Forged core member vanished.");
          return {
            label,
            manifest: forgedManifest,
            manifestBytes: forgedManifestBytes,
            memberInventorySha256:
              __testOnlyGrandHallT554NativeReviewImplementationManifestV2.computeMemberInventorySha256(
                members,
              ),
            coreMember,
          };
        }),
      );
      const firstForgedBuild = forgedBuildFacts[0];
      const secondForgedBuild = forgedBuildFacts[1];
      if (firstForgedBuild === undefined || secondForgedBuild === undefined) {
        throw new Error("Both forged builds are required.");
      }
      const forgedCandidateMaterial = {
        ...candidateMaterial,
        builds: [
          {
            ...candidateMaterial.builds[0],
            manifest: {
              ...candidateMaterial.builds[0].manifest,
              semanticSha256: firstForgedBuild.manifest.semanticSha256,
              fileSha256: fileDigest(firstForgedBuild.manifestBytes),
              byteLength: firstForgedBuild.manifestBytes.length,
            },
            memberInventorySha256:
              firstForgedBuild.memberInventorySha256,
            totalMemberBytes: firstForgedBuild.manifest.totalMemberBytes,
          },
          {
            ...candidateMaterial.builds[1],
            manifest: {
              ...candidateMaterial.builds[1].manifest,
              semanticSha256: secondForgedBuild.manifest.semanticSha256,
              fileSha256: fileDigest(secondForgedBuild.manifestBytes),
              byteLength: secondForgedBuild.manifestBytes.length,
            },
            memberInventorySha256:
              secondForgedBuild.memberInventorySha256,
            totalMemberBytes: secondForgedBuild.manifest.totalMemberBytes,
          },
        ],
        reviewAnchor: {
          manifestSemanticSha256: firstForgedBuild.manifest.semanticSha256,
          manifestFileSha256: fileDigest(firstForgedBuild.manifestBytes),
          manifestFileByteLength: firstForgedBuild.manifestBytes.length,
          memberInventorySha256: firstForgedBuild.memberInventorySha256,
          memberCount: firstForgedBuild.manifest.memberCount,
          totalMemberBytes: firstForgedBuild.manifest.totalMemberBytes,
        },
        members: firstForgedBuild.manifest.members,
        importantMembers: {
          ...candidateMaterial.importantMembers,
          workbenchCore: firstForgedBuild.coreMember,
        },
      };
      const forgedCandidate = {
        ...forgedCandidateMaterial,
        candidateSha256: semanticDigest(
          CANDIDATE_DIGEST_DOMAIN,
          forgedCandidateMaterial,
        ),
      };
      const forgedCandidateBytes = canonicalBytes(forgedCandidate);
      const forgedReceiptMaterial = {
        ...receiptMaterial,
        candidateSha256: forgedCandidate.candidateSha256,
        candidateRecord: {
          ...receiptMaterial.candidateRecord,
          byteLength: forgedCandidateBytes.length,
          sha256: fileDigest(forgedCandidateBytes),
        },
        builds: [
          {
            ...receiptMaterial.builds[0],
            manifest: {
              ...receiptMaterial.builds[0].manifest,
              byteLength: firstForgedBuild.manifestBytes.length,
              sha256: fileDigest(firstForgedBuild.manifestBytes),
            },
            memberInventorySha256:
              firstForgedBuild.memberInventorySha256,
            totalMemberBytes: firstForgedBuild.manifest.totalMemberBytes,
          },
          {
            ...receiptMaterial.builds[1],
            manifest: {
              ...receiptMaterial.builds[1].manifest,
              byteLength: secondForgedBuild.manifestBytes.length,
              sha256: fileDigest(secondForgedBuild.manifestBytes),
            },
            memberInventorySha256:
              secondForgedBuild.memberInventorySha256,
            totalMemberBytes: secondForgedBuild.manifest.totalMemberBytes,
          },
        ],
      };
      const forgedReceipt = {
        ...forgedReceiptMaterial,
        receiptSha256: semanticDigest(
          RECEIPT_DIGEST_DOMAIN,
          forgedReceiptMaterial,
        ),
      };
      await writeFile(candidatePath, forgedCandidateBytes);
      await writeFile(receiptPath, canonicalBytes(forgedReceipt));
      await expect(
        checkGrandHallT554NativeReviewStage1Candidate({ outputRoot }),
      ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    });

    it("refuses a dirty or differently committed source worktree before building", async () => {
      const parent = await mkdtemp(resolve(tmpdir(), "t554-stage1-git-test-"));
      temporaryRoots.push(parent);
      for (const [index, invalidSha] of [
        REVIEWED_GIT_SHA.toUpperCase(),
        ` ${REVIEWED_GIT_SHA}`,
      ].entries()) {
        await expect(
          generateGrandHallT554NativeReviewStage1Candidate({
            workspaceRoot: WORKSPACE_ROOT,
            outputRoot: resolve(parent, `invalid-sha-${String(index)}`),
            reviewedGitSha: invalidSha,
          }),
        ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
      }
      await expect(
        generateGrandHallT554NativeReviewStage1Candidate({
          workspaceRoot: WORKSPACE_ROOT,
          outputRoot: resolve(parent, "candidate"),
          reviewedGitSha: REVIEWED_GIT_SHA,
          __testOnlyWorkspaceGitProbe: () => ({
            sha: "b".repeat(40),
            treeSha: REVIEWED_GIT_TREE_SHA,
            clean: false,
          }),
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_NOT_REVIEWABLE" });
    });

    it("discards both builds if the reviewed worktree changes during compilation", async () => {
      const parent = await mkdtemp(resolve(tmpdir(), "t554-stage1-race-test-"));
      temporaryRoots.push(parent);
      const outputRoot = resolve(parent, "candidate");
      let probeCount = 0;
      await expect(
        generateGrandHallT554NativeReviewStage1Candidate({
          workspaceRoot: WORKSPACE_ROOT,
          outputRoot,
          reviewedGitSha: REVIEWED_GIT_SHA,
          __testOnlyWorkspaceGitProbe: () => {
            probeCount += 1;
            return {
              sha: REVIEWED_GIT_SHA,
              treeSha: REVIEWED_GIT_TREE_SHA,
              clean: probeCount === 1,
            };
          },
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_NOT_REVIEWABLE" });
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    });
  },
);

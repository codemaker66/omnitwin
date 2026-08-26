import { createHash } from "node:crypto";
import { linkSync, renameSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { GrandHallScopeReviewPackV1Schema } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import { stableCanonicalJson, type JsonValue } from "../grand-hall-room9-boundary.js";
import { GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN } from "../grand-hall-t554-boundary-review.js";

import {
  GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME,
  GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME,
  GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME,
  buildGrandHallT554RootReviewPack,
  verifyPersistedGrandHallT554RootReviewPack,
  writeGrandHallT554RootReviewPack,
} from "../grand-hall-t554-review-pack.js";

const CHECKED_IN_REVIEW_ROOT = fileURLToPath(
  new URL("../../../../docs/operations/grand-hall-t554-review-pack/", import.meta.url),
);
const EXPECTED_INTERFACE_IDS = [
  "matterpak-1-9-0-2",
  "matterpak-1-9-0-3",
  "matterpak-1-9-0-4",
  "matterpak-1-9-1-10",
  "matterpak-1-9-1-11",
  "matterpak-1-9-1-12",
  "matterpak-1-9-1-13",
  "matterpak-1-9-1-14",
] as const;
const temporaryRoots: string[] = [];

function mutableRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-root-test-"));
  temporaryRoots.push(root);
  return root;
}

async function copyReviewSubpacks(target: string): Promise<void> {
  await mkdir(target, { recursive: false });
  await cp(
    join(CHECKED_IN_REVIEW_ROOT, GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME),
    join(target, GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME),
    { recursive: true },
  );
  await cp(
    join(CHECKED_IN_REVIEW_ROOT, GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME),
    join(target, GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME),
    { recursive: true },
  );
}

async function copyCompleteReviewPack(target: string): Promise<void> {
  await cp(CHECKED_IN_REVIEW_ROOT, target, { recursive: true });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("Grand Hall T-554 root authority-none review descriptor", () => {
  it("exactly regenerates the checked-in descriptor from both persisted generator manifests", async () => {
    const verified = await verifyPersistedGrandHallT554RootReviewPack(CHECKED_IN_REVIEW_ROOT);
    const persisted = GrandHallScopeReviewPackV1Schema.parse(
      JSON.parse(
        await readFile(
          join(CHECKED_IN_REVIEW_ROOT, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
          "utf8",
        ),
      ),
    );

    expect(verified).toMatchObject({
      artifactSha256: persisted.artifactSha256,
      authority: "none",
      exactRegenerationVerified: true,
    });
    expect(verified.boundaryManifestSha256).toBe(
      "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3",
    );
    expect(verified.interfaceAtlasManifestSha256).toBe(
      "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc",
    );
    expect(verified.panoramaManifestSha256).toBe(
      "sha256:4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc",
    );
  }, 30_000);

  it("maps the exact eight interfaces, all 148 files, and only the 50 candidate sweeps", async () => {
    const built = await buildGrandHallT554RootReviewPack(CHECKED_IN_REVIEW_ROOT);

    expect(built.artifact.interfaceCandidates.map((candidate) => candidate.interfaceId)).toEqual(
      EXPECTED_INTERFACE_IDS,
    );
    expect(built.artifact.interfaceCandidates.map((candidate) => candidate.sharedSourceVertexCount)).toEqual(
      [10, 2, 15, 6, 6, 3, 72, 62],
    );
    expect(
      built.artifact.interfaceCandidates.map((candidate) => candidate.sharedSourceVertexSetSha256),
    ).toEqual([
      "sha256:976d29bc2f481e8704f72477362150c307fb02cff99c74b7ae4acab4565ad5e0",
      "sha256:b01464499a7e07b27e7b0845a2c4707be6cf7eebcaa6dc707a663c46b182b025",
      "sha256:a872d4e26a0a6a5f55c259922f055bafb7ec7d81e171ba3cd83dddf1e59ded92",
      "sha256:338dff979ab7ae3af6fe0a902ed92bcac0b6a26a8faf7a3deeb49f17e71e3b3c",
      "sha256:e8d75ce3a07e1da09b869aa8df61603cecf2ae0951d6ec2986fc3ddc40e00d5a",
      "sha256:c74aeb2257623ce6320ebcfdf8848697da9576ff52be471ac5ecbf1e4b36c936",
      "sha256:6398925c3ed06f15ac46b78c15c6020753ba93a2399ea1a8810e5e0f3dc7248d",
      "sha256:c864c649749a644f199f51c5827b73f9cdcebcc3925c899983a284e15092d31b",
    ]);
    expect(built.artifact.interfaceCandidates.at(0)?.boundsMeters).toEqual({
      min: [-1.33, -10.347, -0.595],
      max: [5.197, -6.378, 0.162],
    });
    expect(built.artifact.interfaceCandidates.at(-1)?.boundsMeters).toEqual({
      min: [-0.626, 0.063, 0.010507],
      max: [0.878, 0.338, 2.897],
    });
    expect(built.artifact.panoramaDirectoryFiles).toHaveLength(148);
    expect(built.artifact.candidatePanoramaSources).toHaveLength(50);
    expect(built.artifact.candidatePanoramaSources.at(0)).toMatchObject({
      sweepNumber: 1,
      fileName: "sweep_001jpg.jpg",
    });
    expect(built.artifact.candidatePanoramaSources.at(-1)).toMatchObject({
      sweepNumber: 50,
      fileName: "sweep_050jpg.jpg",
    });
    expect(built.artifact.candidatePanoramaSources.at(0)).not.toHaveProperty("scanIndex");
    expect(built.artifact.panoramaE57SequenceHypotheses).toHaveLength(50);
    expect(built.artifact.panoramaE57SequenceHypotheses.at(0)).toMatchObject({
      sourceSweepNumber: 1,
      candidateScanIndex: 0,
      state: "sequence_hypothesis_unverified",
      authority: "none",
      geometricCameraAuthority: "none",
      trainingAuthority: "none",
      reconstructionAuthority: "none",
      runtimeAuthority: "none",
    });
    const directoryFileNames = built.artifact.panoramaDirectoryFiles.map((file) => file.fileName);
    expect(directoryFileNames).toContain("sweep_099pg.jpg");
    expect(directoryFileNames).toContain("sweep_145pg.jpg");
    expect(directoryFileNames).toContain("sweep_0148jpg.jpg");
    expect(directoryFileNames).toContain("sweep_0149jpg.jpg");
    expect(directoryFileNames).not.toContain("sweep_093jpg.jpg");
    expect(built.bytes.toString("utf8")).not.toMatch(/[A-Za-z]:[\\/]/u);
    expect(built.bytes.toString("utf8")).not.toContain("MATTERPORT_PANORAMA_ROOT");
  }, 30_000);

  it("records no fabricated portal, closed-volume, or panorama-mask proposal", async () => {
    const { artifact } = await buildGrandHallT554RootReviewPack(CHECKED_IN_REVIEW_ROOT);

    expect(artifact.proposalArtifacts).toEqual({
      roomMembership: {
        state: "source_candidate_present_human_pending",
        artifactSha256:
          "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68",
      },
      portalDecisions: { state: "not_authored_human_pending", artifactSha256: null },
      closedSelectionVolume: { state: "not_authored_human_pending", artifactSha256: null },
      panoramaMaskSet: { state: "not_authored_human_pending", artifactSha256: null },
    });
    expect(artifact.deferredArtifacts).toEqual({
      reviewedTransform: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
      outputInventoryMask: {
        state: "not_available_deferred_to_t557",
        proposalSha256: null,
        artifactSha256: null,
        humanDecisionRequested: false,
      },
    });
    expect(artifact).toMatchObject({
      authority: "none",
      reviewState: "human_pending",
      runtimeAuthorized: false,
      trainingAuthorized: false,
      generatedContentAuthorized: false,
      productionTrust: null,
      sourceEvidence: {
        t550PendingMembershipV1Sha256:
          "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68",
        t551SourceEvidenceSha256:
          "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
        t551SourceReceiptSha256:
          "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
        xgridsSourceReceiptSha256:
          "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a",
        matterPakE57SourceReceiptSha256:
          "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
        boundaryReviewManifestSha256:
          "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3",
        interfaceTopologyAtlasManifestSha256:
          "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc",
        panoramaReviewManifestSha256:
          "sha256:4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc",
      },
    });
  }, 30_000);

  it.each([
    {
      label: "boundary",
      manifestRelativePath: join(GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME, "manifest.json"),
      original: '"interfaceCount": 8',
      replacement: '"interfaceCount": 7',
    },
    {
      label: "panorama",
      manifestRelativePath: join(
        GRAND_HALL_T554_PANORAMA_DIRECTORY_NAME,
        "panorama-review-manifest-authority-none.json",
      ),
      original: '"candidateRecordCount": 50',
      replacement: '"candidateRecordCount": 49',
    },
  ])("rejects $label generator-manifest drift before issuing a root descriptor", async (testCase) => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyCompleteReviewPack(copied);
    const manifestPath = join(copied, testCase.manifestRelativePath);
    const original = await readFile(manifestPath, "utf8");
    const mutated = original.replace(testCase.original, testCase.replacement);
    expect(mutated).not.toBe(original);
    await writeFile(manifestPath, mutated, "utf8");

    await expect(buildGrandHallT554RootReviewPack(copied)).rejects.toThrow();
  }, 30_000);

  it("rejects a canonically resealed boundary summary that the exact atlas does not bind", async () => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyCompleteReviewPack(copied);
    const manifestPath = join(copied, GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME, "manifest.json");
    const manifest = mutableRecord(JSON.parse(await readFile(manifestPath, "utf8")), "boundary manifest");
    const exhaustive = mutableRecord(manifest.exhaustiveSharedInterfaces, "boundary interfaces");
    const interfaces = exhaustive.interfaces;
    if (!Array.isArray(interfaces)) throw new Error("boundary interface inventory is absent");
    mutableRecord(interfaces[0], "first boundary interface").sharedPositionsSha256 =
      `sha256:${"f".repeat(64)}`;
    delete manifest.manifestSha256;
    manifest.manifestSha256 = `sha256:${createHash("sha256")
      .update(
        `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}\n${stableCanonicalJson(manifest as JsonValue)}`,
        "utf8",
      )
      .digest("hex")}`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(buildGrandHallT554RootReviewPack(copied)).rejects.toThrow(
      /atlas does not bind the exact boundary review manifest/u,
    );
  }, 30_000);

  it("rejects a byte-identical same-path manifest replacement after opening it", async () => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyCompleteReviewPack(copied);
    const manifestPath = join(
      copied,
      GRAND_HALL_T554_BOUNDARY_DIRECTORY_NAME,
      "manifest.json",
    );
    const originalBytes = await readFile(manifestPath);
    let replaced = false;

    await expect(
      buildGrandHallT554RootReviewPack(copied, {
        afterOpenBeforeRead: (openedPath, label) => {
          if (replaced || label !== "T-554 boundary manifest") return;
          replaced = true;
          renameSync(openedPath, `${openedPath}.opened-original`);
          writeFileSync(openedPath, originalBytes, { flag: "wx" });
        },
      }),
    ).rejects.toThrow("T-554 boundary manifest changed during its stable read");

    expect(replaced).toBe(true);
    expect(await readFile(manifestPath)).toEqual(originalBytes);
  }, 30_000);

  it("publishes one descriptor atomically and refuses to overwrite it", async () => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyReviewSubpacks(copied);

    const artifactSha256 = await writeGrandHallT554RootReviewPack(copied);
    const verified = await verifyPersistedGrandHallT554RootReviewPack(copied);
    const entries = await readdir(copied);

    expect(verified.artifactSha256).toBe(artifactSha256);
    expect(entries.filter((entry) => entry.includes(".partial-"))).toEqual([]);
    await expect(writeGrandHallT554RootReviewPack(copied)).rejects.toThrow(
      "T-554 root review descriptor already exists",
    );
  }, 45_000);

  it("rejects an externally hard-linked persisted root descriptor", async () => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyCompleteReviewPack(copied);
    linkSync(
      join(copied, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
      join(parent, "review-pack-alias.json"),
    );

    await expect(verifyPersistedGrandHallT554RootReviewPack(copied)).rejects.toThrow(/hard-link count/u);
  }, 30_000);

  it("preserves a replacement path when post-publication verification fails", async () => {
    const parent = await temporaryRoot();
    const copied = join(parent, "review-pack");
    await copyReviewSubpacks(copied);
    const replacementBytes = Buffer.from('{"replacement":"belongs-to-another-writer"}\n', "utf8");

    await expect(
      writeGrandHallT554RootReviewPack(copied, {
        afterPublishBeforeVerification: async (outputPath) => {
          await rm(outputPath);
          await writeFile(outputPath, replacementBytes, { flag: "wx" });
        },
      }),
    ).rejects.toThrow();

    const outputPath = join(copied, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME);
    expect(await readFile(outputPath)).toEqual(replacementBytes);
    expect((await readdir(copied)).filter((entry) => entry.includes(".partial-"))).toEqual([]);
  }, 45_000);
});

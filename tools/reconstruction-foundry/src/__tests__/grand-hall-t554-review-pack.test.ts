import { renameSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { GrandHallScopeReviewPackV1Schema } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

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
      "sha256:6d0f6a230053ccc85275a80260c7b27cfd612ee5c7ca9964bc0ca8653b84de27",
    );
    expect(verified.panoramaManifestSha256).toBe(
      "sha256:c2d74ee55b27be9b4641d3b94968591d37735d353987d30adca4fc785b3636ef",
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
      "sha256:cfe00a7f08d306b1a747fadd2221a08cf8b22982591a59a12fa48c0f7420d8e1",
      "sha256:87456dca0b012a246a9eacdb478270d9a0bd6720cad1895cfc24962d4cd251d5",
      "sha256:ac728edd912d998dfaa6dc54f0ac05efebe4f80102d4ff9757ea0dcfc93574a7",
      "sha256:0e35ffb16067beb58f778fb73425a7697819821db3c4b9df47b53e37ae410e62",
      "sha256:28885fff2edc591a01b4e99fb4c3a7d732b5826401332d9064799315859da026",
      "sha256:e5b0bb24dcb580ed02ca1d4164a05c7d417af91486ad293acd4bd28af627e3e0",
      "sha256:5e7c47389a2db1a762a59a47e60e278f85a5e383e1ecab914c83baa4c70ddbdd",
      "sha256:00451c30639f3f601e6a8b6980a790a80bc236ebf9677911d94f58402abeb8e0",
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
      scanIndex: 0,
      sweepNumber: 1,
      fileName: "sweep_001jpg.jpg",
    });
    expect(built.artifact.candidatePanoramaSources.at(-1)).toMatchObject({
      scanIndex: 49,
      sweepNumber: 50,
      fileName: "sweep_050jpg.jpg",
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
          "sha256:6d0f6a230053ccc85275a80260c7b27cfd612ee5c7ca9964bc0ca8653b84de27",
        panoramaReviewManifestSha256:
          "sha256:c2d74ee55b27be9b4641d3b94968591d37735d353987d30adca4fc785b3636ef",
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

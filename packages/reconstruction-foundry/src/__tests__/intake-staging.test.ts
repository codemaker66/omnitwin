import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FoundryIntakeAdmissionResultPayloadSchema,
  FoundryIntakeAdmissionReviewPayloadSchema,
  computeFoundryIntakeAdmissionResultSha256,
  finalizeFoundryIntakeAdmissionReview,
} from "@omnitwin/types";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { sha256Bytes } from "../hash.js";
import { inspectUniversalIntake, type FoundryUniversalIntakeReceipt } from "../intake-receipt.js";
import {
  FoundryIntakeStagingIndexV0Schema,
  stageUniversalIntakeDraft,
  type FoundryIntakeStagingIndexV0,
  verifyUniversalIntakeStage,
} from "../intake-staging.js";

const cleanup: string[] = [];
const FIXED_TIME = new Date("2026-07-13T12:34:56.000Z");
const STAGING_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function withStagingDigest(
  index: FoundryIntakeStagingIndexV0,
): FoundryIntakeStagingIndexV0 {
  const { stagingSha256: _stagingSha256, ...payload } = index;
  return {
    ...payload,
    stagingSha256: domainSeparatedSha256(
      STAGING_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

function replaceIndexedFile(
  index: FoundryIntakeStagingIndexV0,
  path: string,
  bytes: Buffer,
): FoundryIntakeStagingIndexV0 {
  let replaced = false;
  const files = index.files.map((file) => {
    if (file.path !== path) return file;
    replaced = true;
    return {
      ...file,
      sizeBytes: bytes.length,
      sha256: sha256Bytes(bytes),
    };
  });
  if (!replaced) throw new Error(`missing indexed fixture path: ${path}`);
  return withStagingDigest({
    ...index,
    files,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
  });
}

async function writeStageIndex(
  output: string,
  index: FoundryIntakeStagingIndexV0,
): Promise<void> {
  await writeFile(join(output, "staging-index.json"), jsonBytes(index));
}

async function createDirectoryAlias(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

async function stagingFixture(): Promise<{
  workspace: string;
  source: string;
  output: string;
  receipt: FoundryUniversalIntakeReceipt;
  review: ReturnType<typeof finalizeFoundryIntakeAdmissionReview>;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "foundry-staging-"));
  cleanup.push(workspace);
  const source = join(workspace, "source-drop");
  const output = join(workspace, "staged-draft");
  await mkdir(source);
  await writeFile(join(source, "capture.e57"), Buffer.from("ASTM-E57\0stage-fixture", "ascii"));
  await writeFile(join(source, "view.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await Promise.all([
    utimes(join(source, "capture.e57"), FIXED_TIME, FIXED_TIME),
    utimes(join(source, "view.jpg"), FIXED_TIME, FIXED_TIME),
  ]);
  const receipt = await inspectUniversalIntake(source);
  const capture = receipt.files.find((file) => file.path === "capture.e57");
  if (capture === undefined) throw new Error("missing capture fixture");
  const payload = FoundryIntakeAdmissionReviewPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "staging-fixture",
    reviewedAt: FIXED_TIME.toISOString(),
    reviewedBy: "operator-fixture",
    sourceRoot: {
      id: "staged-drop",
      kind: "local_directory",
      displayName: "Verified local stage",
      locationRedacted: "FOUNDRY_STAGE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    },
    coordinateFrames: [],
    transforms: [],
    decisions: [
      {
        action: "admit",
        path: capture.path,
        classification: {
          method: "accepted_detector_candidate",
          rationale: "ASTM E57 signature accepted for draft local staging.",
          evidenceReferences: ["intake-receipt:bounded-signature"],
        },
        asset: {
          id: "capture-e57",
          sourceRootId: "staged-drop",
          relativePath: capture.path,
          inputType: "generic_e57",
          mediaType: "model/e57",
          sizeBytes: capture.sizeBytes,
          sha256: `sha256:${capture.sha256}`,
          immutable: true,
          captureState: "raw_capture",
          accessState: "direct",
          capturedAt: null,
          coordinateFrameId: null,
          calibrationAssetIds: [],
          parentAssetIds: [],
          rights: {
            basis: "unknown",
            commercialUse: "unknown",
            modelTrainingUse: "unknown",
            redistribution: "unknown",
            termsReviewedAt: null,
            termsReference: null,
            restrictions: ["Rights remain unreviewed."],
          },
          provenanceClass: "captured",
          evidenceKinds: [],
          inspection: {
            geometryValue: "unknown",
            appearanceValue: "unknown",
            calibrationValue: "unknown",
            scaleValue: "unknown",
            metadataKeys: [],
            decisiveNextTest: "Run a bounded E57 metadata inspection.",
          },
          notes: [],
        },
      },
      {
        action: "exclude",
        path: "view.jpg",
        reason: "provenance_unknown",
        rationale: "Image class and rights require operator review before admission.",
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  return {
    workspace,
    source,
    output,
    receipt,
    review: finalizeFoundryIntakeAdmissionReview(payload),
  };
}

describe("universal intake local staging", () => {
  it("rehashes, copies, indexes, promotes, and re-verifies an admitted subset", async () => {
    const fixture = await stagingFixture();
    const sourceBefore = await readFile(join(fixture.source, "capture.e57"));

    const staged = await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });

    expect(staged.outputDirectory).toBe(fixture.output);
    expect(staged.index.stagedAssetCount).toBe(1);
    expect(staged.index.files.map((file) => file.path)).toEqual([
      "evidence/admission-result.json",
      "evidence/admission-review.json",
      "evidence/exclusions.json",
      "evidence/intake-receipt.json",
      "manifest/foundry-ingest-manifest-v0.json",
      "source/capture.e57",
    ]);
    expect(staged.index.capabilities).toEqual({
      localStaging: "completed_verified",
      jobPlanning: "not_authorized",
      execution: "not_authorized",
      modelTraining: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    });
    expect(await readFile(join(fixture.output, "source", "capture.e57"))).toEqual(sourceBefore);
    expect(await readFile(join(fixture.source, "capture.e57"))).toEqual(sourceBefore);
    expect(await verifyUniversalIntakeStage(fixture.output)).toEqual(staged.index);
    expect(
      FoundryIntakeStagingIndexV0Schema.safeParse(
        JSON.parse((await readFile(join(fixture.output, "staging-index.json"))).toString("utf8")),
      ).success,
    ).toBe(true);
  });

  it("rejects source-byte drift even when size and mtime are restored", async () => {
    const fixture = await stagingFixture();
    const original = await readFile(join(fixture.source, "capture.e57"));
    const changed = Buffer.from(original);
    changed[changed.length - 1] = changed[changed.length - 1] === 0x65 ? 0x66 : 0x65;
    await writeFile(join(fixture.source, "capture.e57"), changed);
    await utimes(join(fixture.source, "capture.e57"), FIXED_TIME, FIXED_TIME);

    await expect(
      stageUniversalIntakeDraft({
        sourcePath: fixture.source,
        outputDirectory: fixture.output,
        receipt: fixture.receipt,
        review: fixture.review,
      }),
    ).rejects.toThrow("Source bytes or tree changed after the reviewed intake receipt");
  });

  it("refuses output overlap and an existing output directory", async () => {
    const fixture = await stagingFixture();
    await expect(
      stageUniversalIntakeDraft({
        sourcePath: fixture.source,
        outputDirectory: join(fixture.source, "stage"),
        receipt: fixture.receipt,
        review: fixture.review,
      }),
    ).rejects.toThrow("Staging output must not overlap the source directory");

    await mkdir(fixture.output);
    await expect(
      stageUniversalIntakeDraft({
        sourcePath: fixture.source,
        outputDirectory: fixture.output,
        receipt: fixture.receipt,
        review: fixture.review,
      }),
    ).rejects.toThrow("Staging output already exists");
  });

  it("rejects source, destination, and verification aliases at the stage boundary", async () => {
    const fixture = await stagingFixture();
    const sourceAlias = join(fixture.workspace, "source-alias");
    await createDirectoryAlias(fixture.source, sourceAlias);

    await expect(
      stageUniversalIntakeDraft({
        sourcePath: sourceAlias,
        outputDirectory: fixture.output,
        receipt: fixture.receipt,
        review: fixture.review,
      }),
    ).rejects.toThrow("Staging source cannot be a symbolic link");
    await expect(
      stageUniversalIntakeDraft({
        sourcePath: fixture.source,
        outputDirectory: join(sourceAlias, "stage"),
        receipt: fixture.receipt,
        review: fixture.review,
      }),
    ).rejects.toThrow("Staging output must not overlap the source directory");

    await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    const outputAlias = join(fixture.workspace, "stage-alias");
    await createDirectoryAlias(fixture.output, outputAlias);
    await expect(verifyUniversalIntakeStage(outputAlias)).rejects.toThrow(
      "Staged output root must be a regular directory",
    );
  });

  it("binds every staging role to its canonical artifact path", async () => {
    const fixture = await stagingFixture();
    const staged = await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    const files = staged.index.files.map((file) => {
      if (file.path === "evidence/intake-receipt.json") {
        return { ...file, role: "admission_review" as const };
      }
      if (file.path === "evidence/admission-review.json") {
        return { ...file, role: "intake_receipt" as const };
      }
      return file;
    });
    const forged = withStagingDigest({ ...staged.index, files });

    expect(FoundryIntakeStagingIndexV0Schema.safeParse(forged).success).toBe(false);
  });

  it("rejects an indexed staged source outside the admitted manifest", async () => {
    const fixture = await stagingFixture();
    const staged = await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    const extraBytes = Buffer.from("not-admitted", "utf8");
    await writeFile(join(fixture.output, "source", "extra.bin"), extraBytes);
    const files = [
      ...staged.index.files,
      {
        path: "source/extra.bin",
        role: "staged_source" as const,
        sizeBytes: extraBytes.length,
        sha256: sha256Bytes(extraBytes),
      },
    ].sort((left, right) => left.path.localeCompare(right.path));
    const forged = withStagingDigest({
      ...staged.index,
      stagedAssetCount: staged.index.stagedAssetCount + 1,
      indexedFileCount: staged.index.indexedFileCount + 1,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      files,
    });
    expect(FoundryIntakeStagingIndexV0Schema.safeParse(forged).success).toBe(true);
    await writeStageIndex(fixture.output, forged);

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staged source ledger does not exactly match the admitted manifest asset set",
    );
  });

  it("rejects an exclusion ledger that diverges from the admission result", async () => {
    const fixture = await stagingFixture();
    const staged = await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    const exclusionsBytes = jsonBytes([]);
    await writeFile(join(fixture.output, "evidence", "exclusions.json"), exclusionsBytes);
    const forged = replaceIndexedFile(
      staged.index,
      "evidence/exclusions.json",
      exclusionsBytes,
    );
    await writeStageIndex(fixture.output, forged);

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staged exclusion ledger does not match the deterministic admission result",
    );
  });

  it("rejects self-digested result evidence not reproduced by receipt and review", async () => {
    const fixture = await stagingFixture();
    const staged = await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    const originalResult = JSON.parse(
      (await readFile(join(fixture.output, "evidence", "admission-result.json"))).toString("utf8"),
    ) as Record<string, unknown>;
    const { resultSha256: _resultSha256, ...originalPayload } = originalResult;
    const payload = FoundryIntakeAdmissionResultPayloadSchema.parse({
      ...originalPayload,
      exclusions: (originalPayload.exclusions as Array<Record<string, unknown>>).map(
        (exclusion) => ({ ...exclusion, rationale: "forged but self-digested rationale" }),
      ),
    });
    const forgedResult = {
      ...payload,
      resultSha256: computeFoundryIntakeAdmissionResultSha256(payload),
    };
    const resultBytes = jsonBytes(forgedResult);
    const exclusionsBytes = jsonBytes(forgedResult.exclusions);
    await Promise.all([
      writeFile(join(fixture.output, "evidence", "admission-result.json"), resultBytes),
      writeFile(join(fixture.output, "evidence", "exclusions.json"), exclusionsBytes),
    ]);
    let forgedIndex = replaceIndexedFile(
      { ...staged.index, resultSha256: forgedResult.resultSha256 },
      "evidence/admission-result.json",
      resultBytes,
    );
    forgedIndex = replaceIndexedFile(
      forgedIndex,
      "evidence/exclusions.json",
      exclusionsBytes,
    );
    await writeStageIndex(fixture.output, forgedIndex);

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staged admission evidence does not bind one receipt, review, result, and manifest",
    );
  });

  it("detects staged-source tampering", async () => {
    const fixture = await stagingFixture();
    await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    await writeFile(join(fixture.output, "source", "capture.e57"), "tampered");

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staged output file does not match its index",
    );
  });

  it("rejects an outside hardlink alias to any staged file", async () => {
    const fixture = await stagingFixture();
    await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    await link(
      join(fixture.output, "source", "capture.e57"),
      join(fixture.workspace, "outside-stage-alias.e57"),
    );

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staged output file must be one private regular file with no hardlink alias",
    );
  });

  it("rejects an outside hardlink alias to the staging index", async () => {
    const fixture = await stagingFixture();
    await stageUniversalIntakeDraft({
      sourcePath: fixture.source,
      outputDirectory: fixture.output,
      receipt: fixture.receipt,
      review: fixture.review,
    });
    await link(
      join(fixture.output, "staging-index.json"),
      join(fixture.workspace, "outside-index-alias.json"),
    );

    await expect(verifyUniversalIntakeStage(fixture.output)).rejects.toThrow(
      "Staging index must be one private regular file with no hardlink alias",
    );
  });
});

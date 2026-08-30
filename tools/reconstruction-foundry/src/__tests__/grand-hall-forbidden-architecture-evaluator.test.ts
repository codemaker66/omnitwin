import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_CANDIDATE_OVERLAY_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONTACT_SHEET_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_HEATMAP_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_SEMANTIC_RESULT_FILENAME,
  GRAND_HALL_FORBIDDEN_ARCHITECTURE_SOURCE_OVERLAY_FILENAME,
  GrandHallForbiddenArchitectureEvidenceSchema,
  GrandHallForbiddenArchitecturePublicationReceiptSchema,
  prepareGrandHallForbiddenArchitectureEvaluatorMaterials,
  runGrandHallForbiddenArchitectureEvaluator,
} from "../grand-hall-forbidden-architecture-evaluator.js";

const roots: string[] = [];
const IMPLEMENTATION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../grand-hall-forbidden-architecture-evaluator.ts",
);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-forbidden-architecture-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function pngRgb(width: number, height: number, bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function pngMask(width: number, height: number, values: Buffer): Promise<Buffer> {
  return sharp(values, { raw: { width, height, channels: 1 } })
    .toColourspace("b-w")
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function fixture(options: { readonly candidateWidth?: number; readonly changePixel?: number } = {}) {
  const root = await temporaryRoot();
  const width = 4;
  const height = 3;
  const candidateWidth = options.candidateWidth ?? width;
  const source = Buffer.alloc(width * height * 3, 64);
  const candidate = Buffer.alloc(candidateWidth * height * 3, 64);
  if (options.changePixel !== undefined) {
    const offset = options.changePixel * 3;
    candidate[offset] = 192;
  }
  const protectedMask = Buffer.alloc(width * height, 255);
  const generatedMask = Buffer.alloc(width * height, 0);
  const paths = {
    source: join(root, "source.png"),
    candidate: join(root, "candidate.png"),
    protectedMask: join(root, "protected-mask.png"),
    generatedMask: join(root, "generated-mask.png"),
    materials: join(root, "materials"),
    output: join(root, "evidence"),
  };
  await Promise.all([
    writeFile(paths.source, await pngRgb(width, height, source), { flag: "wx" }),
    writeFile(paths.candidate, await pngRgb(candidateWidth, height, candidate), { flag: "wx" }),
    writeFile(paths.protectedMask, await pngMask(width, height, protectedMask), { flag: "wx" }),
    writeFile(paths.generatedMask, await pngMask(width, height, generatedMask), { flag: "wx" }),
  ]);
  await prepareGrandHallForbiddenArchitectureEvaluatorMaterials({
    implementationPath: IMPLEMENTATION_PATH,
    sourceImagePath: paths.source,
    protectedMaskPath: paths.protectedMask,
    generatedRegionMaskPath: paths.generatedMask,
    width,
    height,
    outputDirectory: paths.materials,
  });
  return paths;
}

function runOptions(paths: Awaited<ReturnType<typeof fixture>>) {
  return {
    sourceImagePath: paths.source,
    candidateImagePath: paths.candidate,
    protectedMaskPath: paths.protectedMask,
    generatedRegionMaskPath: paths.generatedMask,
    implementationPath: IMPLEMENTATION_PATH,
    configurationPath: join(paths.materials, GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONFIGURATION_FILENAME),
    runtimePath: join(paths.materials, GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME),
    outputDirectory: paths.output,
  };
}

describe("Grand Hall forbidden-architecture review-evidence evaluator", () => {
  it("prepares exact offline evaluator materials create-only", async () => {
    const paths = await fixture();
    const receipt = JSON.parse(await readFile(
      join(paths.materials, GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME),
      "utf8",
    )) as { receiptWrittenLast?: unknown; authority?: unknown };
    expect(receipt).toMatchObject({ receiptWrittenLast: true, authority: "none" });
    await expect(prepareGrandHallForbiddenArchitectureEvaluatorMaterials({
      implementationPath: IMPLEMENTATION_PATH,
      sourceImagePath: paths.source,
      protectedMaskPath: paths.protectedMask,
      generatedRegionMaskPath: paths.generatedMask,
      width: 4,
      height: 3,
      outputDirectory: paths.materials,
    })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  });

  it("generates deterministic pixel-difference evidence but never infers architectural detections", async () => {
    const paths = await fixture({ changePixel: 5 });
    const copiedImplementation = join(dirname(paths.output), "semantic-evaluator-implementation.bin");
    await copyFile(IMPLEMENTATION_PATH, copiedImplementation);
    await runGrandHallForbiddenArchitectureEvaluator({
      ...runOptions(paths),
      implementationPath: copiedImplementation,
    });
    const evidence = GrandHallForbiddenArchitectureEvidenceSchema.parse(JSON.parse(await readFile(
      join(paths.output, GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME),
      "utf8",
    )));
    const semanticResult = JSON.parse(await readFile(
      join(paths.output, GRAND_HALL_FORBIDDEN_ARCHITECTURE_SEMANTIC_RESULT_FILENAME),
      "utf8",
    )) as { status?: unknown; uncertainty?: unknown; detections?: unknown; evaluatorReceiptArtifact?: unknown };
    expect(evidence).toMatchObject({
      semanticStatus: "not_evaluated",
      humanReviewRequired: true,
      automaticSemanticDetectionPerformed: false,
      semanticDetections: null,
      changedPixelCount: 1,
      changedOutsideGeneratedRegionPixelCount: 1,
      maximumChannelDifference: 128,
    });
    expect(semanticResult).toMatchObject({
      status: "not_evaluated",
      uncertainty: "unknown",
      detections: null,
      evaluatorReceiptArtifact: null,
    });
    const receipt = GrandHallForbiddenArchitecturePublicationReceiptSchema.parse(JSON.parse(await readFile(
      join(paths.output, GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME),
      "utf8",
    )));
    expect(receipt.filesBeforeReceipt.map((file) => file.fileName)).toEqual([
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_SOURCE_OVERLAY_FILENAME,
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_CANDIDATE_OVERLAY_FILENAME,
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_HEATMAP_FILENAME,
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONTACT_SHEET_FILENAME,
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_SEMANTIC_RESULT_FILENAME,
      GRAND_HALL_FORBIDDEN_ARCHITECTURE_EVIDENCE_FILENAME,
    ]);
    await expect(stat(join(paths.output, GRAND_HALL_FORBIDDEN_ARCHITECTURE_CONTACT_SHEET_FILENAME)))
      .resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("fails before publication when source and candidate dimensions differ", async () => {
    const paths = await fixture({ candidateWidth: 5 });
    await expect(runGrandHallForbiddenArchitectureEvaluator(runOptions(paths)))
      .rejects.toThrow(/dimensions must match exactly/u);
    await expect(stat(paths.output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects substituted runtime bindings and preserves create-only evidence", async () => {
    const paths = await fixture();
    await writeFile(
      join(paths.materials, GRAND_HALL_FORBIDDEN_ARCHITECTURE_RUNTIME_FILENAME),
      "{}\n",
    );
    await expect(runGrandHallForbiddenArchitectureEvaluator(runOptions(paths))).rejects.toThrow();
    await expect(stat(paths.output)).rejects.toMatchObject({ code: "ENOENT" });

    const second = await fixture();
    await runGrandHallForbiddenArchitectureEvaluator(runOptions(second));
    await expect(runGrandHallForbiddenArchitectureEvaluator(runOptions(second)))
      .rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  });

  it("rejects source/candidate aliasing, swapped mask roles, and arbitrary replacement masks", async () => {
    const aliased = await fixture();
    await expect(runGrandHallForbiddenArchitectureEvaluator({
      ...runOptions(aliased),
      candidateImagePath: aliased.source,
    })).rejects.toMatchObject({ code: "INPUT_INVALID" });

    const swapped = await fixture();
    await expect(runGrandHallForbiddenArchitectureEvaluator({
      ...runOptions(swapped),
      protectedMaskPath: swapped.generatedMask,
      generatedRegionMaskPath: swapped.protectedMask,
    })).rejects.toThrow(/exact bound configuration role and digest/u);

    const arbitrary = await fixture();
    await rm(arbitrary.generatedMask);
    await writeFile(arbitrary.generatedMask, await pngMask(4, 3, Buffer.from([
      255, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ])), { flag: "wx" });
    await expect(runGrandHallForbiddenArchitectureEvaluator(runOptions(arbitrary)))
      .rejects.toThrow(/exact bound configuration role and digest/u);
  });

  it("detects staging-directory replacement and never publishes the attacker-controlled directory", async () => {
    const paths = await fixture({ changePixel: 1 });
    const displaced = join(dirname(paths.output), "displaced-staging");
    await expect(runGrandHallForbiddenArchitectureEvaluator({
      ...runOptions(paths),
      testHooks: {
        afterStagingClaimed: async ({ stagingDirectory }) => {
          await rename(stagingDirectory, displaced);
          await mkdir(stagingDirectory);
        },
      },
    })).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    await expect(stat(paths.output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("detects replacement between published lstat and realpath and never returns the replacement", async () => {
    const paths = await fixture({ changePixel: 1 });
    const displaced = join(dirname(paths.output), "displaced-published-output");
    await expect(runGrandHallForbiddenArchitectureEvaluator({
      ...runOptions(paths),
      testHooks: {
        afterPublishedIdentityRead: async ({ targetDirectory }) => {
          await rename(targetDirectory, displaced);
          await mkdir(targetDirectory);
        },
      },
    })).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    await expect(stat(join(paths.output, GRAND_HALL_FORBIDDEN_ARCHITECTURE_PUBLICATION_RECEIPT_FILENAME)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});

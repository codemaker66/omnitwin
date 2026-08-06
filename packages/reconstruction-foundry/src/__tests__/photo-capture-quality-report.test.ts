import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0,
  FOUNDRY_RECEPTION_30_BUILD_SLOTS,
  FOUNDRY_RECEPTION_30_HELDOUT_SLOTS,
  FoundryPhotoCaptureQualityReportV0Schema,
  classifyFoundryReceptionPilotPhotoNameV0,
  compileFoundryPhotoCaptureQualityReportV0,
  inspectUniversalIntake,
  listFoundryPhotoCaptureQualityCandidatesV0,
  runFoundryPhotoCaptureQualityWorkerV0,
  serializeFoundryPhotoCaptureQualityReportV0,
  type FoundryPhotoCaptureQualityAssignmentV0,
  type FoundryPhotoCaptureQualityPhotoV0,
} from "../index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

function sha(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function imageId(index: number): string {
  return `photo-${index.toString(16).padStart(24, "0")}`;
}

function successfulPhoto(
  assignment: FoundryPhotoCaptureQualityAssignmentV0 & {
    readonly role: "build" | "heldout";
  },
  index: number,
): FoundryPhotoCaptureQualityPhotoV0 {
  return {
    imageId: imageId(index),
    source: assignment,
    decode: {
      status: "decoded",
      mediaType: "image/jpeg",
      metrics: {
        sourceWidthPx: 6_000,
        sourceHeightPx: 4_000,
        sourceMegapixels: 24,
        analysisWidthPx: 512,
        analysisHeightPx: 341,
        lumaMean: 0.5,
        lumaStandardDeviation: 0.2,
        lumaP05: 0.1,
        lumaP50: 0.5,
        lumaP95: 0.9,
        shadowClippedFraction: 0,
        highlightClippedFraction: 0,
        tenengrad: 0.05,
        meanRgb: [0.5, 0.5, 0.5],
        differenceHash64: index.toString(16).padStart(16, "0"),
      },
      thumbnail: {
        mediaType: "image/webp",
        widthPx: 360,
        heightPx: 240,
        sizeBytes: 100 + index,
        sha256: sha(index + 100),
      },
    },
    rawCounterpart: {
      state: "present_unreviewed",
      paths: [
        `raw/${assignment.protocolSlot ?? `photo-${String(index)}`}.DNG`,
      ],
    },
    colourDistanceFromRoleMedian: 0,
    issues: [],
    verdict: "pass",
  };
}

function completeProtocolInput(): {
  readonly assignments: FoundryPhotoCaptureQualityAssignmentV0[];
  readonly photos: FoundryPhotoCaptureQualityPhotoV0[];
} {
  const slots = [
    ...FOUNDRY_RECEPTION_30_BUILD_SLOTS.map((slot) => ({ slot, role: "build" as const })),
    ...FOUNDRY_RECEPTION_30_HELDOUT_SLOTS.map((slot) => ({ slot, role: "heldout" as const })),
  ];
  const assignments = slots.map(({ slot, role }, index) => ({
    path: `jpeg/${slot}.JPG`,
    sha256: sha(index + 1),
    sizeBytes: 1_000 + index,
    role,
    protocolSlot: slot,
  }));
  return {
    assignments,
    photos: assignments.map((assignment, index) => successfulPhoto(assignment, index + 1)),
  };
}

describe("photo capture-quality report v0", () => {
  it("compiles a digest-bound complete 18/12 split without granting authority", () => {
    const input = completeProtocolInput();
    const report = compileFoundryPhotoCaptureQualityReportV0({
      generatedAt: "2026-07-18T12:00:00.000Z",
      sourceReceiptSha256: "a".repeat(64),
      assignments: input.assignments,
      photos: input.photos,
      similarityFindings: [],
      candidateSessionNotePaths: ["camera-settings.txt"],
    });

    expect(report.schemaVersion).toBe(FOUNDRY_PHOTO_CAPTURE_QUALITY_REPORT_V0);
    expect(report.authority).toBe("none");
    expect(report.resultType).toBe("capture_quality_triage_not_reconstruction");
    expect(report.protocolCoverage).toMatchObject({
      status: "complete_unreviewed",
      matchedBuildCount: 18,
      matchedHeldoutCount: 12,
      missingBuildSlots: [],
      missingHeldoutSlots: [],
    });
    expect(report.summary).toMatchObject({
      assignedBuildCount: 18,
      assignedHeldoutCount: 12,
      heldoutPolicy: "excluded_from_build_tuning_and_selection",
      readiness: "capture_quality_ready",
    });
    expect(serializeFoundryPhotoCaptureQualityReportV0(report)).toContain(
      report.reportSha256,
    );
  });

  it("derives missing and misassigned protocol slots instead of hiding them", () => {
    const input = completeProtocolInput();
    const assignments = input.assignments.slice(1).map((assignment, index) =>
      index === 0 ? { ...assignment, role: "heldout" as const } : assignment
    );
    const photos = assignments.map((assignment, index) =>
      successfulPhoto(
        assignment as typeof assignment & { readonly role: "build" | "heldout" },
        index + 1,
      )
    );
    const report = compileFoundryPhotoCaptureQualityReportV0({
      generatedAt: "2026-07-18T12:00:00.000Z",
      sourceReceiptSha256: "b".repeat(64),
      assignments,
      photos,
      similarityFindings: [],
      candidateSessionNotePaths: [],
    });

    expect(report.protocolCoverage.status).toBe("incomplete");
    expect(report.protocolCoverage.missingBuildSlots).toContain("RR-PILOT-MAP-A-01");
    expect(report.protocolCoverage.misassignedSlots).toContain("RR-PILOT-MAP-A-02");
    expect(report.summary.readiness).toBe("retake_required");
  });

  it("rejects report payload tampering even when the shape still looks valid", () => {
    const input = completeProtocolInput();
    const report = compileFoundryPhotoCaptureQualityReportV0({
      generatedAt: "2026-07-18T12:00:00.000Z",
      sourceReceiptSha256: "c".repeat(64),
      assignments: input.assignments,
      photos: input.photos,
      similarityFindings: [],
      candidateSessionNotePaths: ["session.txt"],
    });

    expect(
      FoundryPhotoCaptureQualityReportV0Schema.safeParse({
        ...report,
        originalsModified: true,
      }).success,
    ).toBe(false);
    expect(
      FoundryPhotoCaptureQualityReportV0Schema.safeParse({
        ...report,
        reportSha256: "0".repeat(64),
      }).success,
    ).toBe(false);
  });
});

describe("photo capture-quality worker v0", () => {
  async function createPhotoFolder(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "foundry-photo-quality-"));
    temporaryDirectories.push(root);
    const width = 640;
    const height = 480;
    const checker = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 24 : 232;
        const offset = (y * width + x) * 3;
        checker[offset] = value;
        checker[offset + 1] = value;
        checker[offset + 2] = value;
      }
    }
    await sharp(checker, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 92 })
      .toFile(join(root, "RR-PILOT-MAP-A-01.JPG"));
    await sharp(checker, { raw: { width, height, channels: 3 } })
      .blur(12)
      .png()
      .toFile(join(root, "RR-PILOT-S01-A.png"));
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 120, g: 100, b: 90 },
      },
    })
      .jpeg()
      .toFile(join(root, "colour-card.jpg"));
    await writeFile(join(root, "camera-settings.txt"), "manual exposure\n", "utf8");
    return root;
  }

  it("binds real decoded pixels and memory-only thumbnails to the intake receipt", async () => {
    const root = await createPhotoFolder();
    const receipt = await inspectUniversalIntake(root);
    const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);
    const before = await Promise.all(
      candidates.map((candidate) => readFile(join(root, candidate.path))),
    );
    const progress: number[] = [];

    const result = await runFoundryPhotoCaptureQualityWorkerV0({
      sourceRoot: root,
      receipt,
      assignments: candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
      generatedAt: "2026-07-18T12:00:00.000Z",
      onProgress: (value) => progress.push(value.completed),
    });

    expect(candidates.map((candidate) => candidate.suggestedRole)).toEqual([
      "build",
      "heldout",
      "ignore",
    ]);
    expect(result.report.photos).toHaveLength(2);
    expect(result.report.photos.every((photo) => photo.decode.status === "decoded")).toBe(true);
    expect(result.thumbnails.size).toBe(2);
    expect(result.report.sourceReceiptSha256).toBe(receipt.receiptSha256);
    expect(result.report.originalsModified).toBe(false);
    expect(result.report.externalRequests).toBe(0);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(2);
    const build = result.report.photos.find((photo) => photo.source.role === "build");
    const heldout = result.report.photos.find((photo) => photo.source.role === "heldout");
    if (
      build?.decode.status !== "decoded" ||
      heldout?.decode.status !== "decoded"
    ) {
      throw new Error("expected both fixture photos to decode");
    }
    expect(build.decode.metrics.tenengrad).toBeGreaterThan(
      heldout.decode.metrics.tenengrad,
    );
    const after = await Promise.all(
      candidates.map((candidate) => readFile(join(root, candidate.path))),
    );
    expect(after).toEqual(before);
  });

  it("rejects omitted, duplicated, or unknown browser assignments", async () => {
    const root = await createPhotoFolder();
    const receipt = await inspectUniversalIntake(root);
    const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);

    await expect(
      runFoundryPhotoCaptureQualityWorkerV0({
        sourceRoot: root,
        receipt,
        assignments: candidates.slice(0, 2).map((candidate) => ({
          path: candidate.path,
          role: candidate.suggestedRole,
        })),
      }),
    ).rejects.toMatchObject({ code: "PHOTO_ASSIGNMENT_SET_MISMATCH" });
    await expect(
      runFoundryPhotoCaptureQualityWorkerV0({
        sourceRoot: root,
        receipt,
        assignments: [
          ...candidates.map((candidate) => ({
            path: candidate.path,
            role: candidate.suggestedRole,
          })),
          { path: candidates[0]?.path ?? "missing.jpg", role: "ignore" },
        ],
      }),
    ).rejects.toMatchObject({ code: "PHOTO_ASSIGNMENT_SET_MISMATCH" });
  });

  it("fails closed when a photo changes after intake", async () => {
    const root = await createPhotoFolder();
    const receipt = await inspectUniversalIntake(root);
    const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);
    const first = candidates[0];
    if (first === undefined) throw new Error("missing fixture photo candidate");
    await writeFile(join(root, first.path), Buffer.from("changed"));

    await expect(
      runFoundryPhotoCaptureQualityWorkerV0({
        sourceRoot: root,
        receipt,
        assignments: candidates.map((candidate) => ({
          path: candidate.path,
          role: candidate.suggestedRole,
        })),
      }),
    ).rejects.toMatchObject({ code: "PHOTO_SOURCE_SIZE_CHANGED" });
  });

  it("honours cancellation before any source bytes are accepted", async () => {
    const root = await createPhotoFolder();
    const receipt = await inspectUniversalIntake(root);
    const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(
      runFoundryPhotoCaptureQualityWorkerV0({
        sourceRoot: root,
        receipt,
        assignments: candidates.map((candidate) => ({
          path: candidate.path,
          role: candidate.suggestedRole,
        })),
        signal: cancellation.signal,
      }),
    ).rejects.toMatchObject({ code: "PHOTO_CAPTURE_QUALITY_CANCELLED" });
  });

  it("classifies only the frozen pilot slots", () => {
    expect(classifyFoundryReceptionPilotPhotoNameV0("nested/RR-PILOT-MAP-B-09.jpeg"))
      .toEqual({ role: "build", protocolSlot: "RR-PILOT-MAP-B-09" });
    expect(classifyFoundryReceptionPilotPhotoNameV0("RR-PILOT-S06-B.PNG"))
      .toEqual({ role: "heldout", protocolSlot: "RR-PILOT-S06-B" });
    expect(classifyFoundryReceptionPilotPhotoNameV0("marketing-hero.jpg"))
      .toEqual({ role: "ignore", protocolSlot: null });
  });
});

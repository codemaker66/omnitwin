import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewPayloadSchema,
  finalizeFoundryIntakeAdmissionReview,
  type FoundryIntakeAdmissionReviewPayload,
} from "@omnitwin/types";
import { admitUniversalIntakeReceipt } from "../intake-admission.js";
import { inspectUniversalIntake, type FoundryUniversalIntakeReceipt } from "../intake-receipt.js";

const cleanup: string[] = [];
const REVIEWED_AT = "2026-07-13T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function receiptFixture(): Promise<FoundryUniversalIntakeReceipt> {
  const root = await mkdtemp(join(tmpdir(), "foundry-admission-"));
  cleanup.push(root);
  const files = new Map<string, Uint8Array | string>([
    ["capture.e57", Buffer.from("ASTM-E57\0fixture", "ascii")],
    ["model.xbin", Buffer.from("XBAGfixture", "ascii")],
    ["view.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
  ]);
  for (const [name, contents] of files) {
    const path = join(root, name);
    await writeFile(path, contents);
    await utimes(path, new Date(REVIEWED_AT), new Date(REVIEWED_AT));
  }
  return inspectUniversalIntake(root);
}

function admittedAsset(
  receipt: FoundryUniversalIntakeReceipt,
  path: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const file = receipt.files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`missing fixture file: ${path}`);
  const inputType = file.detection.candidates[0]?.inputType;
  if (inputType === undefined) throw new Error(`fixture has no detected type: ${path}`);
  return {
    id: path.replaceAll(".", "-"),
    sourceRootId: "drop-root",
    relativePath: path,
    inputType,
    mediaType: "application/octet-stream",
    sizeBytes: file.sizeBytes,
    sha256: `sha256:${file.sha256}`,
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
      restrictions: ["Rights review is required before processing."],
    },
    provenanceClass: "captured",
    evidenceKinds: [],
    inspection: {
      geometryValue: "unknown",
      appearanceValue: "unknown",
      calibrationValue: "unknown",
      scaleValue: "unknown",
      metadataKeys: [],
      decisiveNextTest: "Run the approved format-aware read-only inspector.",
    },
    notes: [],
    ...overrides,
  };
}

function reviewPayload(
  receipt: FoundryUniversalIntakeReceipt,
  admittedPath = "capture.e57",
  assetOverrides: Record<string, unknown> = {},
): FoundryIntakeAdmissionReviewPayload {
  const decisions = receipt.files.map((file) =>
    file.path === admittedPath
      ? {
          action: "admit" as const,
          path: file.path,
          classification: {
            method: "accepted_detector_candidate" as const,
            rationale: "The operator accepts the bounded signature candidate for draft admission.",
            evidenceReferences: ["intake-receipt:bounded-signature"],
          },
          asset: admittedAsset(receipt, file.path, assetOverrides),
        }
      : {
          action: "exclude" as const,
          path: file.path,
          reason: "operator_rejected" as const,
          rationale: "This file remains outside the draft manifest pending separate review.",
        },
  );
  return FoundryIntakeAdmissionReviewPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "admission-fixture",
    reviewedAt: REVIEWED_AT,
    reviewedBy: "operator-fixture",
    sourceRoot: {
      id: "drop-root",
      kind: "local_directory",
      displayName: "Operator drop",
      locationRedacted: "LOCAL_DROP/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    },
    coordinateFrames: [],
    transforms: [],
    decisions,
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
}

describe("universal intake admission", () => {
  it("binds an all-path review to a deterministic, non-authoritative draft manifest", async () => {
    const receipt = await receiptFixture();
    const review = finalizeFoundryIntakeAdmissionReview(reviewPayload(receipt));

    const first = admitUniversalIntakeReceipt(receipt, review);
    const second = admitUniversalIntakeReceipt(receipt, review);

    expect(second).toEqual(first);
    expect(first.receiptSha256).toBe(receipt.receiptSha256);
    expect(first.reviewSha256).toBe(review.reviewSha256);
    expect(first.manifest.assets.map((asset) => asset.relativePath)).toEqual(["capture.e57"]);
    expect(first.exclusions.map((decision) => decision.path)).toEqual(["model.xbin", "view.jpg"]);
    expect(first.manifest.legalReviewState).toBe("requires_review");
    expect(first.manifest.sourceMutationPermitted).toBe(false);
    expect(first.authority).toBe("none");
    expect(first.capabilities).toEqual(FOUNDRY_INTAKE_ADMISSION_CAPABILITIES);
    expect(first.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.resultSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects a review bound to another receipt", async () => {
    const receipt = await receiptFixture();
    const payload = reviewPayload(receipt);
    const review = finalizeFoundryIntakeAdmissionReview({
      ...payload,
      receiptSha256: "0".repeat(64),
    });

    expect(() => admitUniversalIntakeReceipt(receipt, review)).toThrow(
      "Admission review does not bind the supplied intake receipt",
    );
  });

  it("rejects byte identity drift even when the review is internally self-consistent", async () => {
    const receipt = await receiptFixture();
    const file = receipt.files.find((candidate) => candidate.path === "capture.e57");
    if (file === undefined) throw new Error("missing capture fixture");
    const review = finalizeFoundryIntakeAdmissionReview(
      reviewPayload(receipt, "capture.e57", { sizeBytes: file.sizeBytes + 1 }),
    );

    expect(() => admitUniversalIntakeReceipt(receipt, review)).toThrow(
      "Admitted asset bytes do not match the receipt",
    );
  });

  it("requires an explicit evidence-backed override for a non-candidate type", async () => {
    const receipt = await receiptFixture();
    const mismatched = finalizeFoundryIntakeAdmissionReview(
      reviewPayload(receipt, "capture.e57", { inputType: "obj" }),
    );
    expect(() => admitUniversalIntakeReceipt(receipt, mismatched)).toThrow(
      "Selected input type was not a detector candidate",
    );

    const payload = reviewPayload(receipt, "capture.e57", { inputType: "obj" });
    const decisions = payload.decisions.map((decision) =>
      decision.action === "admit"
        ? {
            ...decision,
            classification: {
              method: "operator_override" as const,
              rationale: "A separate parser report identifies this payload as OBJ.",
              evidenceReferences: ["parser-report:sha256:fixture"],
            },
          }
        : decision,
    );
    const overridden = finalizeFoundryIntakeAdmissionReview({ ...payload, decisions });
    expect(admitUniversalIntakeReceipt(receipt, overridden).manifest.assets[0]?.inputType).toBe(
      "obj",
    );
  });

  it("keeps XGRIDS raw payloads technically blocked", async () => {
    const receipt = await receiptFixture();
    const direct = finalizeFoundryIntakeAdmissionReview(reviewPayload(receipt, "model.xbin"));
    expect(() => admitUniversalIntakeReceipt(receipt, direct)).toThrow(
      "Proprietary raw payload must remain metadata-only or technically blocked",
    );

    const blocked = finalizeFoundryIntakeAdmissionReview(
      reviewPayload(receipt, "model.xbin", {
        captureState: "reference",
        accessState: "blocked_technical",
      }),
    );
    expect(admitUniversalIntakeReceipt(receipt, blocked).manifest.assets[0]).toMatchObject({
      inputType: "xgrids_xbin",
      accessState: "blocked_technical",
    });
  });

  it("detects review and result tampering", async () => {
    const receipt = await receiptFixture();
    const review = finalizeFoundryIntakeAdmissionReview(reviewPayload(receipt));
    expect(
      FoundryIntakeAdmissionReviewPayloadSchema.safeParse({
        ...review,
        reviewSha256: undefined,
      }).success,
    ).toBe(false);
    expect(() => admitUniversalIntakeReceipt(receipt, { ...review, reviewedBy: "tampered" })).toThrow(
      "Intake admission review is invalid",
    );
    const result = admitUniversalIntakeReceipt(receipt, review);
    expect(
      FoundryIntakeAdmissionResultV0Schema.safeParse({
        ...result,
        manifestSha256: `sha256:${"f".repeat(64)}`,
      }).success,
    ).toBe(false);
  });
});

import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
} from "@omnitwin/types";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  compileGuidedAdmissionDraft,
  type FoundryGuidedAdmissionDraftInput,
  type FoundryGuidedAdmissionFileChoice,
} from "../guided-admission.js";
import {
  inspectUniversalIntake,
  type FoundryUniversalIntakeReceipt,
} from "../intake-receipt.js";

const cleanup: string[] = [];
const REVIEWED_AT = "2026-07-13T16:30:00.000Z";

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function receiptFixture(): Promise<FoundryUniversalIntakeReceipt> {
  const root = await mkdtemp(join(tmpdir(), "foundry-guided-admission-"));
  cleanup.push(root);
  const files = new Map<string, Uint8Array | string>([
    ["capture.e57", Buffer.from("ASTM-E57\0fixture", "ascii")],
    ["mystery.bin", Buffer.from("unknown-fixture", "ascii")],
    ["model.xbin", Buffer.from("XBAGfixture", "ascii")],
    ["plan.pdf", Buffer.from("%PDF-1.7 fixture", "ascii")],
    ["view.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
  ]);
  for (const [name, contents] of files) {
    const path = join(root, name);
    await writeFile(path, contents);
    await utimes(path, new Date(REVIEWED_AT), new Date(REVIEWED_AT));
  }
  return inspectUniversalIntake(root);
}

async function duplicateReceiptFixture(): Promise<FoundryUniversalIntakeReceipt> {
  const root = await mkdtemp(join(tmpdir(), "foundry-guided-duplicate-"));
  cleanup.push(root);
  const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
  const files = new Map<string, Uint8Array | string>([
    ["capture.e57", Buffer.from("ASTM-E57\0fixture", "ascii")],
    ["copy-a.obj", triangle],
    ["copy-b.obj", triangle],
  ]);
  for (const [name, contents] of files) {
    const path = join(root, name);
    await writeFile(path, contents);
    await utimes(path, new Date(REVIEWED_AT), new Date(REVIEWED_AT));
  }
  return inspectUniversalIntake(root);
}

function baseInput(receipt: FoundryUniversalIntakeReceipt): FoundryGuidedAdmissionDraftInput {
  const decisions: FoundryGuidedAdmissionFileChoice[] = receipt.files.map((file) => {
    if (file.path === "capture.e57") {
      return {
        action: "admit",
        path: file.path,
        inputType: "generic_e57",
        role: "raw_capture",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      };
    }
    if (file.path === "model.xbin") {
      return {
        action: "admit",
        path: file.path,
        inputType: "xgrids_xbin",
        role: "reference_only",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      };
    }
    if (file.path === "view.jpg") {
      return {
        action: "admit",
        path: file.path,
        inputType: "generic_image",
        role: "raw_capture",
        formatDecision: "operator_override",
        formatEvidencePaths: [file.path],
        parentPaths: [],
        evidenceKinds: [],
      };
    }
    return {
      action: "exclude",
      path: file.path,
      reason: file.path === "plan.pdf" ? "unsupported_format" : "provenance_unknown",
    };
  });
  return {
    schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "reception-room-guided-pilot",
    reviewedAt: REVIEWED_AT,
    reviewedBy: "local-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions,
  };
}

function replaceChoice(
  input: FoundryGuidedAdmissionDraftInput,
  path: string,
  replacement: FoundryGuidedAdmissionFileChoice,
): FoundryGuidedAdmissionDraftInput {
  return {
    ...input,
    decisions: input.decisions.map((decision) =>
      decision.path === path ? replacement : decision,
    ),
  };
}

function admittedChoice(
  input: FoundryGuidedAdmissionDraftInput,
  path: string,
): Extract<FoundryGuidedAdmissionFileChoice, { action: "admit" }> {
  const choice = input.decisions.find((decision) => decision.path === path);
  if (choice?.action !== "admit") throw new Error(`missing admitted fixture choice: ${path}`);
  return choice;
}

function expectIntegrityCode(run: () => unknown, code: string): FoundryIntegrityError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
    return error as FoundryIntegrityError;
  }
  throw new Error(`expected FoundryIntegrityError ${code}`);
}

describe("guided admission draft compiler", () => {
  it("creates deterministic, self-digested review and result records without granting authority", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);

    const first = compileGuidedAdmissionDraft(receipt, input);
    const second = compileGuidedAdmissionDraft(receipt, input);
    const reordered = compileGuidedAdmissionDraft(receipt, {
      ...input,
      decisions: [...input.decisions].reverse(),
    });

    expect(second).toEqual(first);
    expect(reordered).toEqual(first);
    expect(FoundryIntakeAdmissionReviewV0Schema.parse(first.review)).toEqual(first.review);
    expect(FoundryIntakeAdmissionResultV0Schema.parse(first.result)).toEqual(first.result);
    expect(first.result.receiptSha256).toBe(receipt.receiptSha256);
    expect(first.result.reviewSha256).toBe(first.review.reviewSha256);
    expect(first.review.legalReviewState).toBe("requires_review");
    expect(first.review.sourceMutationPermitted).toBe(false);
    expect(first.review.authority).toBe("none");
    expect(first.review.capabilities).toEqual(FOUNDRY_INTAKE_ADMISSION_CAPABILITIES);
    expect(first.result.capabilities).toEqual(FOUNDRY_INTAKE_ADMISSION_CAPABILITIES);
    expect(first.result.manifest.generatedRegions).toEqual([]);
    expect(first.result.manifest.sourceRoots[0]).toMatchObject({
      id: "guided-intake-source",
      locationRedacted: "LOCAL_SOURCE/[redacted]",
      readOnly: true,
    });
    expect(first.result.manifest.assets.map((asset) => asset.relativePath)).toEqual([
      "capture.e57",
      "model.xbin",
      "view.jpg",
    ]);
    expect(first.result.exclusions.map((choice) => choice.path)).toEqual([
      "mystery.bin",
      "plan.pdf",
    ]);
  });

  it("copies only receipt byte identities and keeps XGRIDS bytes metadata-only", async () => {
    const receipt = await receiptFixture();
    const { result } = compileGuidedAdmissionDraft(receipt, baseInput(receipt));

    for (const asset of result.manifest.assets) {
      const receiptFile = receipt.files.find((file) => file.path === asset.relativePath);
      if (receiptFile === undefined) throw new Error(`missing receipt file: ${asset.relativePath}`);
      expect(asset.sizeBytes).toBe(receiptFile.sizeBytes);
      expect(asset.sha256).toBe(`sha256:${receiptFile.sha256}`);
    }
    expect(result.manifest.assets.find((asset) => asset.inputType === "xgrids_xbin")).toMatchObject({
      captureState: "reference",
      accessState: "metadata_only",
      provenanceClass: "captured",
    });
  });

  it("rejects a changed receipt and choices made for another receipt", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft({ ...receipt, source: { ...receipt.source, label: "changed" } }, input),
      "GUIDED_ADMISSION_RECEIPT_INVALID",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, { ...input, receiptSha256: "0".repeat(64) }),
      "GUIDED_ADMISSION_RECEIPT_DIGEST_MISMATCH",
    );
  });

  it("requires exactly one choice for every receipt file", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        decisions: input.decisions.filter((decision) => decision.path !== "plan.pdf"),
      }),
      "GUIDED_ADMISSION_FILE_CHOICE_MISSING",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        decisions: [...input.decisions, input.decisions[0]],
      }),
      "GUIDED_ADMISSION_DUPLICATE_FILE_CHOICE",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        decisions: [
          ...input.decisions,
          { action: "exclude", path: "not-in-receipt.obj", reason: "operator_rejected" },
        ],
      }),
      "GUIDED_ADMISSION_FILE_NOT_IN_RECEIPT",
    );
  });

  it("does not let an operator claim a unique file is an exact duplicate", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    expect(receipt.duplicateGroups).toEqual([]);

    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "mystery.bin", {
        action: "exclude",
        path: "mystery.bin",
        reason: "duplicate_content",
      })),
      "GUIDED_ADMISSION_FALSE_DUPLICATE_EXCLUSION",
    );
  });

  it("requires one receipt-confirmed exact copy to remain when another is excluded as a duplicate", async () => {
    const receipt = await duplicateReceiptFixture();
    expect(receipt.duplicateGroups).toHaveLength(1);
    const shared: Omit<FoundryGuidedAdmissionDraftInput, "decisions"> = {
      schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
      receiptSha256: receipt.receiptSha256,
      projectId: "duplicate-review",
      reviewedAt: REVIEWED_AT,
      reviewedBy: "local-operator",
      sourceMedia: "local" as const,
      caseSensitivity: "insensitive" as const,
    };
    const keepOne: FoundryGuidedAdmissionDraftInput = {
      ...shared,
      decisions: [
        {
          action: "admit",
          path: "capture.e57",
          inputType: "generic_e57",
          role: "raw_capture",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        },
        {
          action: "admit",
          path: "copy-a.obj",
          inputType: "obj",
          role: "official_export",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        },
        { action: "exclude", path: "copy-b.obj", reason: "duplicate_content" },
      ],
    };
    const kept = compileGuidedAdmissionDraft(receipt, keepOne);
    expect(kept.result.manifest.assets.map((asset) => asset.relativePath)).toEqual([
      "capture.e57",
      "copy-a.obj",
    ]);
    expect(kept.result.exclusions).toEqual([
      expect.objectContaining({ path: "copy-b.obj", reason: "duplicate_content" }),
    ]);

    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...keepOne,
        decisions: keepOne.decisions.map((decision) =>
          decision.path === "copy-a.obj"
            ? { action: "exclude" as const, path: "copy-a.obj", reason: "duplicate_content" as const }
            : decision,
        ),
      }),
      "GUIDED_ADMISSION_DUPLICATE_SOURCE_NOT_ADMITTED",
    );
  });

  it("does not silently admit ambiguous, unknown, or low-confidence formats", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const view = admittedChoice(input, "view.jpg");
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
      })),
      "GUIDED_ADMISSION_FORMAT_NEEDS_OVERRIDE",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "mystery.bin", {
        action: "admit",
        path: "mystery.bin",
        inputType: "manual_evidence",
        role: "reference_only",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      })),
      "GUIDED_ADMISSION_FORMAT_NEEDS_OVERRIDE",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "plan.pdf", {
        action: "admit",
        path: "plan.pdf",
        inputType: "floor_plan",
        role: "reference_only",
        formatDecision: "accept_detector",
        formatEvidencePaths: [],
        parentPaths: [],
        evidenceKinds: [],
      })),
      "GUIDED_ADMISSION_LOW_CONFIDENCE_NEEDS_OVERRIDE",
    );
  });

  it("requires override evidence to name exact files in the same receipt", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const view = admittedChoice(input, "view.jpg");
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        formatEvidencePaths: [],
      })),
      "GUIDED_ADMISSION_OVERRIDE_EVIDENCE_REQUIRED",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        formatEvidencePaths: ["outside-report.json"],
      })),
      "GUIDED_ADMISSION_FORMAT_EVIDENCE_NOT_IN_RECEIPT",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        formatEvidencePaths: ["view.jpg", "view.jpg"],
      })),
      "GUIDED_ADMISSION_DUPLICATE_FORMAT_EVIDENCE",
    );
  });

  it("prevents raw XGRIDS data from being relabelled or processed", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const xbin = admittedChoice(input, "model.xbin");
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "model.xbin", {
        ...xbin,
        inputType: "obj",
        formatDecision: "operator_override",
        formatEvidencePaths: ["model.xbin"],
      })),
      "GUIDED_ADMISSION_XBIN_CANNOT_BE_RELABELLED",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "model.xbin", {
        ...xbin,
        role: "raw_capture",
      })),
      "GUIDED_ADMISSION_XBIN_REFERENCE_ONLY",
    );
  });

  it("keeps generated and enhanced derivatives structurally separate from captured truth", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const view = admittedChoice(input, "view.jpg");
    const enhancedInput = replaceChoice(input, "view.jpg", {
      ...view,
      role: "enhanced_captured_derivative",
      parentPaths: ["capture.e57"],
      derivation: {
        operationVersion: "photo-registration-and-refinement.v1",
        environmentEvidencePath: "mystery.bin",
      },
    });
    const enhancedResult = compileGuidedAdmissionDraft(receipt, enhancedInput).result;
    expect(enhancedResult.manifest.assets.find((asset) => asset.relativePath === "view.jpg")).toMatchObject({
      captureState: "derived",
      provenanceClass: "enhanced_captured",
    });
    expect(enhancedResult.manifest.provenanceEdges).toHaveLength(1);
    expect(enhancedResult.manifest.generatedRegions).toEqual([]);

    const withMask = replaceChoice(input, "plan.pdf", {
      action: "admit",
      path: "plan.pdf",
      inputType: "floor_plan",
      role: "reference_only",
      formatDecision: "operator_override",
      formatEvidencePaths: ["plan.pdf"],
      parentPaths: [],
      evidenceKinds: ["mask"],
    });
    const generatedInput = replaceChoice(withMask, "view.jpg", {
      ...view,
      role: "generated_cinematic_derivative",
      parentPaths: ["capture.e57", "plan.pdf"],
      derivation: {
        operationVersion: "declared-cinematic-generation.v2",
        environmentEvidencePath: "mystery.bin",
      },
      generation: {
        maskPath: "plan.pdf",
        modelName: "declared-model",
        modelVersion: "2.0",
        checkpointPath: "mystery.bin",
        conditionPath: "plan.pdf",
        confidence: 0.5,
        exportRestrictions: ["Generated appearance must remain visibly labelled."],
        truthModeDisclosure: "Generated cinematic appearance; not captured or metric evidence.",
      },
    });

    const { result } = compileGuidedAdmissionDraft(receipt, generatedInput);
    const generated = result.manifest.assets.find((asset) => asset.relativePath === "view.jpg");
    const source = result.manifest.assets.find((asset) => asset.relativePath === "capture.e57");
    const mask = result.manifest.assets.find((asset) => asset.relativePath === "plan.pdf");
    expect(generated).toMatchObject({
      captureState: "derived",
      provenanceClass: "generated_cinematic",
      parentAssetIds: [source?.id, mask?.id],
    });
    expect(generated?.notes).toContain(
      "This asset is explicitly generated and cannot act as captured or metric truth.",
    );
    expect(result.manifest.provenanceEdges).toHaveLength(1);
    expect(result.manifest.generatedRegions).toHaveLength(1);
    expect(result.manifest.generatedRegions[0]).toMatchObject({
      outputAssetId: generated?.id,
      sourceAssetIds: [source?.id],
      maskAssetId: mask?.id,
      provenanceClass: "generated_cinematic",
      modelName: "declared-model",
    });
    const mystery = receipt.files.find((file) => file.path === "mystery.bin");
    const plan = receipt.files.find((file) => file.path === "plan.pdf");
    if (mystery === undefined || plan === undefined) throw new Error("missing generation evidence fixture");
    expect(result.manifest.provenanceEdges[0]?.environmentDigest).toBe(
      `sha256:${mystery.sha256}`,
    );
    expect(result.manifest.generatedRegions[0]?.checkpointSha256).toBe(
      `sha256:${mystery.sha256}`,
    );
    expect(result.manifest.generatedRegions[0]?.promptOrConditionDigest).toBe(
      `sha256:${plan.sha256}`,
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        role: "enhanced_captured_derivative",
        parentPaths: [],
      })),
      "GUIDED_ADMISSION_DERIVATIVE_PARENT_REQUIRED",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        role: "enhanced_captured_derivative",
        parentPaths: ["capture.e57"],
      })),
      "GUIDED_ADMISSION_DERIVATION_EVIDENCE_REQUIRED",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        role: "enhanced_captured_derivative",
        parentPaths: ["capture.e57"],
        derivation: {
          operationVersion: "missing-environment-evidence.v1",
          environmentEvidencePath: "not-inspected.json",
        },
      })),
      "GUIDED_ADMISSION_ENVIRONMENT_EVIDENCE_NOT_IN_RECEIPT",
    );
    const maskWithoutRole = replaceChoice(generatedInput, "plan.pdf", {
      action: "admit",
      path: "plan.pdf",
      inputType: "floor_plan",
      role: "reference_only",
      formatDecision: "operator_override",
      formatEvidencePaths: ["plan.pdf"],
      parentPaths: [],
      evidenceKinds: [],
    });
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, maskWithoutRole),
      "GUIDED_ADMISSION_GENERATION_MASK_ROLE_REQUIRED",
    );
  });

  it("rejects missing, self-referential, excluded, and cyclic parents", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const view = admittedChoice(input, "view.jpg");
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        role: "captured_derivative",
        parentPaths: ["view.jpg"],
        derivation: {
          operationVersion: "self-parent-fixture.v1",
          environmentEvidencePath: "mystery.bin",
        },
      })),
      "GUIDED_ADMISSION_SELF_PARENT",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, replaceChoice(input, "view.jpg", {
        ...view,
        role: "captured_derivative",
        parentPaths: ["plan.pdf"],
        derivation: {
          operationVersion: "excluded-parent-fixture.v1",
          environmentEvidencePath: "mystery.bin",
        },
      })),
      "GUIDED_ADMISSION_PARENT_NOT_ADMITTED",
    );
    const capture = admittedChoice(input, "capture.e57");
    const cyclic = replaceChoice(
      replaceChoice(input, "capture.e57", {
        ...capture,
        role: "captured_derivative",
        parentPaths: ["view.jpg"],
        derivation: {
          operationVersion: "cycle-fixture-a.v1",
          environmentEvidencePath: "mystery.bin",
        },
      }),
      "view.jpg",
      {
        ...view,
        role: "captured_derivative",
        parentPaths: ["capture.e57"],
        derivation: {
          operationVersion: "cycle-fixture-b.v1",
          environmentEvidencePath: "mystery.bin",
        },
      },
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, cyclic),
      "GUIDED_ADMISSION_PARENT_CYCLE",
    );
  });

  it("rejects attempts to inject paths, byte hashes, asset IDs, or authority fields", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        sourcePath: "C:\\private\\capture",
      }),
      "GUIDED_ADMISSION_CHOICES_INVALID",
    );
    const first = input.decisions[0];
    if (first === undefined) throw new Error("missing fixture decision");
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        decisions: [
          { ...first, sha256: `sha256:${"f".repeat(64)}`, assetId: "injected" },
          ...input.decisions.slice(1),
        ],
      }),
      "GUIDED_ADMISSION_CHOICES_INVALID",
    );
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, {
        ...input,
        legalReviewState: "approved",
        execution: "authorized",
      }),
      "GUIDED_ADMISSION_CHOICES_INVALID",
    );
  });

  it("does not create an admission review when every file is excluded", async () => {
    const receipt = await receiptFixture();
    const input = baseInput(receipt);
    const excluded: FoundryGuidedAdmissionDraftInput = {
      ...input,
      decisions: receipt.files.map((file) => ({
        action: "exclude",
        path: file.path,
        reason: "operator_rejected",
      })),
    };
    expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, excluded),
      "GUIDED_ADMISSION_NO_FILES_ADMITTED",
    );
  });

  it("rejects an empty receipt with a plain-language error", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-guided-empty-"));
    cleanup.push(root);
    const receipt = await inspectUniversalIntake(root);
    const input: FoundryGuidedAdmissionDraftInput = {
      schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
      receiptSha256: receipt.receiptSha256,
      projectId: "empty-intake",
      reviewedAt: REVIEWED_AT,
      reviewedBy: "local-operator",
      sourceMedia: "local",
      caseSensitivity: "insensitive",
      decisions: [],
    };
    const error = expectIntegrityCode(
      () => compileGuidedAdmissionDraft(receipt, input),
      "GUIDED_ADMISSION_EMPTY_RECEIPT",
    );
    expect(error.message).toBe("The receipt contains no files, so there is nothing to admit.");
  });
});

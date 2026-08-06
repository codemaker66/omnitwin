import { describe, expect, it } from "vitest";
import {
  FOUNDRY_PREPARED_HD_DATASET_CAPABILITIES_V0,
  FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0,
  FOUNDRY_PREPARED_HD_DATASET_READINESS_DIGEST_DOMAIN,
  FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0,
  FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0,
  FOUNDRY_PREPARED_HD_DATASET_PYTHON_SUMMARY_V0,
  FOUNDRY_PREPARED_HD_DATASET_READINESS_V0,
  FOUNDRY_PREPARED_HD_DATASET_RESULT_V0,
  FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0,
  compileFoundryPreparedHdDatasetReadinessReceiptV0,
  serializeFoundryPreparedHdDatasetReadinessReceiptV0,
  verifyFoundryPreparedHdDatasetReadinessReceiptV0,
  type CompileFoundryPreparedHdDatasetReadinessReceiptV0Input,
  type FoundryPreparedHdDatasetFileReceiptV0,
  type FoundryPreparedHdDatasetPythonSummaryV0,
  type FoundryPreparedHdDatasetReadinessReceiptV0,
} from "../prepared-hd-dataset-readiness.js";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "../canonical-json.js";
import {
  FOUNDRY_QUARANTINE_NEXT_ACTIONS,
  FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0,
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeFile,
  type FoundryUniversalIntakeReceipt,
} from "../intake-receipt.js";

function sha256(character: string): string {
  return character.repeat(64);
}

function sourceFile(
  path: string,
  sizeBytes: number,
  hashCharacter: string,
): FoundryUniversalIntakeFile {
  return {
    path,
    sizeBytes,
    modifiedAt: "2026-07-22T12:00:00.000Z",
    sha256: sha256(hashCharacter),
    detection: { status: "unknown", candidates: [], caveats: [] },
    inspection: {
      method: "bounded_stream",
      hashBufferBytes: 8 * 1024 * 1024,
      headerBytesRead: 0,
      magicHex: "",
    },
    status: "quarantined",
    manifestEligible: false,
    quarantine: [
      {
        reason: "format_unknown",
        nextAction: FOUNDRY_QUARANTINE_NEXT_ACTIONS.format_unknown,
      },
      {
        reason: "rights_unreviewed",
        nextAction: FOUNDRY_QUARANTINE_NEXT_ACTIONS.rights_unreviewed,
      },
      {
        reason: "provenance_unreviewed",
        nextAction: FOUNDRY_QUARANTINE_NEXT_ACTIONS.provenance_unreviewed,
      },
    ],
    duplicate: { status: "unique", groupSha256: null },
  };
}

function preparedFileReceipts(): FoundryPreparedHdDatasetFileReceiptV0[] {
  return [
    { path: "dataset/images/heldout.png", sizeBytes: 80, sha256: sha256("7") },
    { path: "dataset/images/train-a.png", sizeBytes: 81, sha256: sha256("8") },
    { path: "dataset/images/train-b.png", sizeBytes: 82, sha256: sha256("9") },
    { path: "dataset/images_2/heldout.png", sizeBytes: 30, sha256: sha256("a") },
    { path: "dataset/images_2/train-a.png", sizeBytes: 31, sha256: sha256("b") },
    { path: "dataset/images_2/train-b.png", sizeBytes: 32, sha256: sha256("c") },
    { path: "dataset/sparse/0/cameras.bin", sizeBytes: 40, sha256: sha256("3") },
    { path: "dataset/sparse/0/images.bin", sizeBytes: 50, sha256: sha256("4") },
    { path: "dataset/sparse/0/points3D.bin", sizeBytes: 60, sha256: sha256("5") },
    { path: "dataset/splits.json", sizeBytes: 70, sha256: sha256("6") },
    { path: "depths/train-a.npz", sizeBytes: 90, sha256: sha256("d") },
    { path: "depths/train-b.npz", sizeBytes: 91, sha256: sha256("e") },
  ];
}

function intakeFilesFromPrepared(
  files: readonly FoundryPreparedHdDatasetFileReceiptV0[] = preparedFileReceipts(),
): FoundryUniversalIntakeFile[] {
  return files.map((file) =>
    sourceFile(file.path, file.sizeBytes, file.sha256[0] ?? "0"),
  );
}

function intakeReceipt(
  files: readonly FoundryUniversalIntakeFile[] = intakeFilesFromPrepared(),
): FoundryUniversalIntakeReceipt {
  const payload = {
    schemaVersion: FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0,
    source: { kind: "directory" as const, label: "capture" },
    policy: {
      sourceAccess: "read_only" as const,
      networkAccess: "no_network_clients" as const,
      cloudDispatch: "none" as const,
      reconstruction: "none" as const,
      manifestPromotion: "none" as const,
      rightsStatus: "unreviewed" as const,
      filesystemTrust: "local_or_removable_operator_controlled" as const,
    },
    summary: {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      quarantinedCount: files.length,
      unknownFormatCount: files.length,
      ambiguousFormatCount: 0,
      duplicateGroupCount: 0,
    },
    files: [...files],
    duplicateGroups: [],
  };
  return FoundryUniversalIntakeReceiptSchema.parse({
    ...payload,
    receiptSha256: domainSeparatedSha256(
      "VENVIEWER_FOUNDRY_INTAKE_RECEIPT_V0",
      toCanonicalJson(payload),
    ),
  });
}

function pythonSummary(): FoundryPreparedHdDatasetPythonSummaryV0 {
  return {
    schemaVersion: FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0,
    ok: true,
    summary: {
      schemaVersion: FOUNDRY_PREPARED_HD_DATASET_PYTHON_SUMMARY_V0,
      binaryFormat: { format: "COLMAP sparse binary", endianness: "little" },
      parserSemantics: {
        implementation: "gsplat v1.5.3 examples/datasets/colmap.py",
        dataFactor: 2,
        testEvery: 8,
        splitRule: "sorted_filename_index_modulo_test_every",
        runtimeImageDirectory: "images_2",
        extMetadataAccepted: false,
      },
      files: {
        "cameras.bin": { bytes: 40, sha256: sha256("3") },
        "images.bin": { bytes: 50, sha256: sha256("4") },
        "points3D.bin": { bytes: 60, sha256: sha256("5") },
        "splits.json": { bytes: 70, sha256: sha256("6") },
      },
      cameraCount: 2,
      cameras: [
        {
          cameraId: 1,
          modelId: 1,
          model: "PINHOLE",
          width: 8,
          height: 6,
          params: [8, 8, 4, 3],
        },
        {
          cameraId: 2,
          modelId: 1,
          model: "PINHOLE",
          width: 8,
          height: 6,
          params: [9, 9, 4, 3],
        },
      ],
      imageCount: 3,
      images: [
        {
          imageId: 1,
          name: "heldout.png",
          cameraId: 1,
          cameraModel: "PINHOLE",
          width: 8,
          height: 6,
          observationCount: 2,
          sha256: sha256("7"),
        },
        {
          imageId: 2,
          name: "train-a.png",
          cameraId: 1,
          cameraModel: "PINHOLE",
          width: 8,
          height: 6,
          observationCount: 2,
          sha256: sha256("8"),
        },
        {
          imageId: 3,
          name: "train-b.png",
          cameraId: 2,
          cameraModel: "PINHOLE",
          width: 8,
          height: 6,
          observationCount: 1,
          sha256: sha256("9"),
        },
      ],
      runtimeImageCount: 3,
      runtimeImages: [
        {
          sourceName: "heldout.png",
          name: "heldout.png",
          width: 4,
          height: 3,
          sha256: sha256("a"),
        },
        {
          sourceName: "train-a.png",
          name: "train-a.png",
          width: 4,
          height: 3,
          sha256: sha256("b"),
        },
        {
          sourceName: "train-b.png",
          name: "train-b.png",
          width: 4,
          height: 3,
          sha256: sha256("c"),
        },
      ],
      point3DCount: 2,
      pointObservationCount: 5,
      splits: {
        train: ["train-a.png", "train-b.png"],
        heldout: ["heldout.png"],
        trainCount: 2,
        heldoutCount: 1,
      },
      depth: {
        required: true,
        priorCount: 2,
        priors: [
          {
            fileName: "train-a.npz",
            imageName: "train-a.png",
            sha256: sha256("d"),
            sampleCount: 2,
            width: 8,
            height: 6,
            uvDtype: "float32",
            depthDtype: "float32",
          },
          {
            fileName: "train-b.npz",
            imageName: "train-b.png",
            sha256: sha256("e"),
            sampleCount: 1,
            width: 8,
            height: 6,
            uvDtype: "float32",
            depthDtype: "float32",
          },
        ],
      },
    },
  };
}

function validInput(
  receipt: FoundryUniversalIntakeReceipt = intakeReceipt(),
): CompileFoundryPreparedHdDatasetReadinessReceiptV0Input {
  return {
    sourceReceiptBefore: receipt,
    sourceReceiptAfter: receipt,
    consumedSourceMembers: receipt.files.map((file) => ({
      intakeReceiptSha256: receipt.receiptSha256,
      file,
    })),
    toolReceipts: {
      parser: {
        path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.parser,
        sizeBytes: 1_001,
        sha256: sha256("f"),
      },
      cli: {
        path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.cli,
        sizeBytes: 1_002,
        sha256: sha256("0"),
      },
      config: {
        path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.config,
        sizeBytes: 1_003,
        sha256: sha256("1"),
      },
      sourceLock: {
        path: FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.sourceLock,
        sizeBytes: 1_004,
        sha256: sha256("2"),
      },
    },
    preparedFiles: preparedFileReceipts(),
    pythonSummary: pythonSummary(),
  };
}

function compileValid(): FoundryPreparedHdDatasetReadinessReceiptV0 {
  return compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput());
}

describe("prepared HD dataset readiness V0", () => {
  it("compiles and verifies one canonical authority-none validation receipt", () => {
    const receipt = compileValid();

    expect(verifyFoundryPreparedHdDatasetReadinessReceiptV0(receipt)).toEqual(receipt);
    expect(receipt.schemaVersion).toBe(FOUNDRY_PREPARED_HD_DATASET_READINESS_V0);
    expect(receipt.authority).toBe("none");
    expect(receipt.result).toBe(FOUNDRY_PREPARED_HD_DATASET_RESULT_V0);
    expect(receipt.configB).toEqual(FOUNDRY_PREPARED_HD_DATASET_CONFIG_B_V0);
    expect(receipt.capabilities).toEqual(FOUNDRY_PREPARED_HD_DATASET_CAPABILITIES_V0);
    expect(receipt.limitations).toEqual(FOUNDRY_PREPARED_HD_DATASET_LIMITATIONS_V0);
    expect(receipt.source.unchanged).toBe(true);
    expect(receipt.preparedPackageSummary).toEqual({
      fileCount: 12,
      totalBytes: 737,
      datasetFileCount: 10,
      depthFileCount: 2,
    });
  });

  it("is deterministic and independent of any absolute workspace path", () => {
    const left = compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput());
    const right = compileFoundryPreparedHdDatasetReadinessReceiptV0(
      structuredClone(validInput()),
    );

    expect(left.receiptSha256).toBe(right.receiptSha256);
    expect(serializeFoundryPreparedHdDatasetReadinessReceiptV0(left)).toBe(
      serializeFoundryPreparedHdDatasetReadinessReceiptV0(right),
    );
    expect(serializeFoundryPreparedHdDatasetReadinessReceiptV0(left)).not.toContain(
      "C:\\",
    );
  });

  it("rejects a missing, extra, or substituted prepared member", () => {
    const missingBase = validInput();
    const missing = { ...missingBase, preparedFiles: missingBase.preparedFiles.slice(1) };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(missing)).toThrow();

    const extraBase = validInput();
    const extra = {
      ...extraBase,
      preparedFiles: [
        ...extraBase.preparedFiles,
        { path: "depths/unconsumed.npz", sizeBytes: 1, sha256: sha256("f") },
      ],
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(extra)).toThrow();

    const substitutedBase = validInput();
    const substituted = {
      ...substitutedBase,
      preparedFiles: substitutedBase.preparedFiles.map((file) =>
        file.path === "dataset/images/train-a.png"
          ? { ...file, sha256: sha256("0") }
          : file,
      ),
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(substituted)).toThrow();
  });

  it("rejects omitted, extra, and substituted consumed source receipts", () => {
    const missingBase = validInput();
    const missing = {
      ...missingBase,
      consumedSourceMembers: missingBase.consumedSourceMembers.slice(1),
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(missing)).toThrow();

    const extraBase = validInput();
    const extra = {
      ...extraBase,
      consumedSourceMembers: [
        ...extraBase.consumedSourceMembers,
        extraBase.consumedSourceMembers[0]!,
      ],
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(extra)).toThrow();

    const substitutedBase = validInput();
    const substituted = {
      ...substitutedBase,
      consumedSourceMembers: substitutedBase.consumedSourceMembers.map(
        (member, index) =>
          index === 0
            ? { ...member, file: { ...member.file, sha256: sha256("f") } }
            : member,
      ),
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(substituted)).toThrow();
  });

  it("rejects an unrelated source package member in place of a prepared file", () => {
    const unrelatedFiles = preparedFileReceipts()
      .map((file) =>
        file.path === "dataset/images/heldout.png"
          ? { ...file, path: "dataset/images/unrelated.png" }
          : file,
      )
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const receipt = intakeReceipt(intakeFilesFromPrepared(unrelatedFiles));

    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput(receipt)),
    ).toThrow();
  });

  it("rejects missing or extra source package members", () => {
    const missingReceipt = intakeReceipt(intakeFilesFromPrepared(preparedFileReceipts().slice(1)));
    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput(missingReceipt)),
    ).toThrow();

    const extraPrepared = [
      ...preparedFileReceipts(),
      { path: "dataset/unconsumed.bin", sizeBytes: 1, sha256: sha256("f") },
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const extraReceipt = intakeReceipt(intakeFilesFromPrepared(extraPrepared));
    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput(extraReceipt)),
    ).toThrow();
  });

  it("rejects a source package byte-size or hash mismatch", () => {
    const sizeMismatch = preparedFileReceipts().map((file) =>
      file.path === "dataset/images/train-a.png"
        ? { ...file, sizeBytes: file.sizeBytes + 1 }
        : file,
    );
    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(
        validInput(intakeReceipt(intakeFilesFromPrepared(sizeMismatch))),
      ),
    ).toThrow();

    const hashMismatch = preparedFileReceipts().map((file) =>
      file.path === "dataset/images/train-a.png"
        ? { ...file, sha256: sha256("f") }
        : file,
    );
    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(
        validInput(intakeReceipt(intakeFilesFromPrepared(hashMismatch))),
      ),
    ).toThrow();
  });

  it("rejects exact duplicate and case-colliding prepared paths", () => {
    const duplicateBase = validInput();
    const duplicate = {
      ...duplicateBase,
      preparedFiles: [
        ...duplicateBase.preparedFiles,
        duplicateBase.preparedFiles[duplicateBase.preparedFiles.length - 1]!,
      ],
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(duplicate)).toThrow();

    const collisionBase = validInput();
    const collision = {
      ...collisionBase,
      preparedFiles: [
        ...collisionBase.preparedFiles,
        { path: "dataset/Images/train-a.png", sizeBytes: 1, sha256: sha256("f") },
      ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(collision)).toThrow();
  });

  it("rejects case-colliding intake members even when the intake self-digest is valid", () => {
    const collisionReceipt = intakeReceipt([
      sourceFile("capture/A.bin", 101, "1"),
      sourceFile("capture/a.bin", 202, "2"),
    ]);

    expect(() =>
      compileFoundryPreparedHdDatasetReadinessReceiptV0(validInput(collisionReceipt)),
    ).toThrow();
  });

  it("rejects invalid split semantics", () => {
    const input = validInput();
    input.pythonSummary.summary.splits = {
      train: ["heldout.png", "train-b.png"],
      heldout: ["train-a.png"],
      trainCount: 2,
      heldoutCount: 1,
    };

    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(input)).toThrow();
  });

  it("rejects missing, held-out, or mismatched depth mappings", () => {
    const missing = validInput();
    missing.pythonSummary.summary.depth.priors =
      missing.pythonSummary.summary.depth.priors.slice(1);
    missing.pythonSummary.summary.depth.priorCount = 1;
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(missing)).toThrow();

    const heldout = validInput();
    heldout.pythonSummary.summary.depth.priors = [
      ...heldout.pythonSummary.summary.depth.priors,
      {
        fileName: "heldout.npz",
        imageName: "heldout.png",
        sha256: sha256("f"),
        sampleCount: 1,
        width: 8,
        height: 6,
        uvDtype: "float32",
        depthDtype: "float32",
      },
    ];
    heldout.pythonSummary.summary.depth.priorCount = 3;
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(heldout)).toThrow();

    const mismatch = validInput();
    mismatch.pythonSummary.summary.depth.priors[0] = {
      ...mismatch.pythonSummary.summary.depth.priors[0]!,
      width: 10,
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(mismatch)).toThrow();
  });

  it("rejects invalid runtime mappings and factor-2 dimensions", () => {
    const mapping = validInput();
    mapping.pythonSummary.summary.runtimeImages[1] = {
      ...mapping.pythonSummary.summary.runtimeImages[1]!,
      sourceName: "train-b.png",
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(mapping)).toThrow();

    const dimensions = validInput();
    dimensions.pythonSummary.summary.runtimeImages[1] = {
      ...dimensions.pythonSummary.summary.runtimeImages[1]!,
      width: 5,
    };
    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(dimensions)).toThrow();
  });

  it("rejects a stale or mutated post-validation intake receipt", () => {
    const input = {
      ...validInput(),
      sourceReceiptAfter: intakeReceipt([
        sourceFile("capture/aligned-cameras.json", 101, "1"),
        sourceFile("capture/panorama-a.png", 203, "f"),
      ]),
    };

    expect(() => compileFoundryPreparedHdDatasetReadinessReceiptV0(input)).toThrowError(
      expect.objectContaining({ code: "PREPARED_HD_DATASET_SOURCE_MUTATED" }),
    );
  });

  it("rejects receipt digest tamper", () => {
    const receipt = compileValid();
    const tampered = { ...receipt, receiptSha256: sha256("0") };

    expect(() => verifyFoundryPreparedHdDatasetReadinessReceiptV0(tampered)).toThrowError(
      expect.objectContaining({ code: "PREPARED_HD_DATASET_RECEIPT_INVALID" }),
    );
  });

  it("rejects authority escalation even after an attacker recomputes the outer digest", () => {
    const receipt = compileValid();
    const { receiptSha256: _oldDigest, ...payload } = receipt;
    const escalatedPayload = {
      ...payload,
      authority: "operator",
      capabilities: { ...payload.capabilities, training: true, execution: true },
    };
    const escalated = {
      ...escalatedPayload,
      receiptSha256: domainSeparatedSha256(
        FOUNDRY_PREPARED_HD_DATASET_READINESS_DIGEST_DOMAIN,
        toCanonicalJson(escalatedPayload),
      ),
    };

    expect(() => verifyFoundryPreparedHdDatasetReadinessReceiptV0(escalated)).toThrowError(
      expect.objectContaining({ code: "PREPARED_HD_DATASET_RECEIPT_INVALID" }),
    );
  });
});

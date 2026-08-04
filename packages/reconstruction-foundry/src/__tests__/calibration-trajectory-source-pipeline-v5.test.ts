import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_QUARANTINE_NEXT_ACTIONS,
  inspectUniversalIntakeWithSourceFactsV4,
  inspectUniversalIntakeWithSourceFactsV5,
} from "../intake-receipt.js";
import {
  FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
} from "../source-facts-v4.js";
import {
  FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS,
  FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS,
  FoundryUniversalSourceFactsV5Schema,
  UniversalSourceFactsV5AssetSchema,
  createUniversalSourceFactsV5ArtifactFromReceipt,
  createUniversalSourceFactsV5StreamCollector,
  serializeUniversalSourceFactsV5Artifact,
  type UniversalSourceFactsV5FileResult,
  type UniversalSourceFactsV5ReceiptFileIdentity,
} from "../source-facts-v5.js";
import type { FoundryCalibrationTrajectorySourceFactsOutcome } from "../calibration-trajectory-source-facts.js";
import { compileFoundrySourceReadinessMapV5 } from "../source-readiness-v5.js";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-registration-documents-v5-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(root, name), bytes);
  return root;
}

const HEADERLESS_POSES_CSV = Buffer.from([
  "1780322782.895321,0.000415,0.001354,0.004690,-0.505607,0.009709,-0.001803,0.862707",
  "1780322782.995328,0.000481,0.001416,0.005078,-0.505696,0.009559,-0.002523,0.862655",
  "",
].join("\n"), "utf8");

function gaussianPlyFixture(): Buffer {
  const properties = [
    "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "rot_0", "rot_1", "rot_2", "rot_3",
    "scale_0", "scale_1", "scale_2", "x", "y", "z",
  ];
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    "element vertex 1",
    ...properties.map((name) => `property float ${name}`),
    "end_header",
    properties.map(() => "0").join(" "),
    "",
  ].join("\n"), "ascii");
}

function ordinaryPointPlyFixture(): Buffer {
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    "element vertex 1",
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "0 0 0",
    "",
  ].join("\n"), "ascii");
}

function registrationIdentity(
  path: string,
  bytes: Buffer,
): UniversalSourceFactsV5ReceiptFileIdentity {
  return {
    path,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    magicHex: bytes.subarray(0, 128).toString("hex"),
    detection: {
      status: "detected",
      candidates: [{
        inputType: "trajectory",
        confidence: "medium",
        evidence: ["trajectory_filename"],
      }],
      caveats: [],
    },
  };
}

describe("calibration and trajectory Source Facts V5 intake pipeline", () => {
  it("establishes complete CSV record structure without inventing pose semantics", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "poses.csv": HEADERLESS_POSES_CSV }),
    );

    expect(inspected.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: { assetCount: 1, establishedCount: 1, factsNotEstablishedCount: 0 },
      assets: [{
        source: {
          path: "poses.csv",
          inputType: "trajectory",
          receiptCandidateInputTypes: ["trajectory"],
        },
        format: "csv",
        inspection: {
          state: "established",
          code: "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED",
          coverage: "complete_record_structure",
        },
        facts: {
          format: "csv",
          profile: "utf8_csv_record_structure_v0",
          records: {
            count: 2,
            uniformFieldCount: true,
            minimumFieldCount: 8,
            maximumFieldCount: 8,
          },
        },
        unknowns: FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS,
      }],
    });
    expect(FoundryUniversalSourceFactsV5Schema.parse(inspected.sourceFacts)).toEqual(
      inspected.sourceFacts,
    );
    expect(FoundryUniversalSourceFactsV5Schema.parse(
      JSON.parse(serializeUniversalSourceFactsV5Artifact(inspected.sourceFacts)),
    )).toEqual(inspected.sourceFacts);
  });

  it("establishes JSON syntax and shape for trajectory and calibration candidates only", async () => {
    const trajectory = Buffer.from(
      '{"poses":[{"ts":"1780322782.995263100","T":[0.001181,-0.000649,-0.000014],"R":[0.863383,-0.504424,0.011193,0.000201],"RGB":null}],"fusionPoses":null}',
      "utf8",
    );
    const calibration = Buffer.from(
      '{"camera_model":"PINHOLE","fl_x":512,"fl_y":512,"cx":512,"cy":512,"w":1024,"h":1024,"frames":[{"file_path":"frame-0001.png","transform_matrix":[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}]}',
      "utf8",
    );
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({
        "poses.json": trajectory,
        "camera-calibration.json": calibration,
      }),
    );

    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 2, establishedCount: 2 },
      assets: [
        {
          source: { path: "camera-calibration.json", inputType: "calibration_bundle" },
          format: "json",
          facts: {
            format: "json",
            profile: "bounded_json_syntax_shape_v0",
            root: { kind: "object" },
          },
          unknowns: FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS,
        },
        {
          source: { path: "poses.json", inputType: "trajectory" },
          format: "json",
          facts: {
            format: "json",
            profile: "bounded_json_syntax_shape_v0",
            root: { kind: "object" },
          },
          unknowns: FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS,
        },
      ],
    });
  });

  it("keeps unsupported YAML neutral and leaves a two-family filename ambiguous", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({
        "camera.yaml": Buffer.from("camera_model: pinhole\n", "utf8"),
        "calibration-trajectory.json": Buffer.from("{}", "utf8"),
      }),
    );

    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: {
        receiptFileCount: 2,
        assetCount: 1,
        establishedCount: 0,
        factsNotEstablishedCount: 1,
        untargetedFileCount: 1,
      },
      assets: [{
        source: { path: "camera.yaml", inputType: "calibration_bundle" },
        format: "calibration_trajectory_document",
        inspection: {
          state: "facts_not_established",
          category: "unsupported_variant",
          code: "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED",
          coverage: "none",
        },
        facts: null,
      }],
    });
    expect(inspected.receipt.files.find((file) => file.path === "calibration-trajectory.json")?.detection)
      .toMatchObject({
        status: "ambiguous",
        candidates: [
          { inputType: "calibration_bundle" },
          { inputType: "trajectory" },
        ],
      });

    const failedAsset = inspected.sourceFacts.state === "available"
      ? inspected.sourceFacts.assets[0]
      : undefined;
    expect(failedAsset).toBeDefined();
    expect(UniversalSourceFactsV5AssetSchema.safeParse({
      ...failedAsset,
      inspection: {
        state: "facts_not_established",
        category: "unsupported_variant",
        code: "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
        coverage: "none",
      },
    }).success).toBe(false);
  });

  it("rejects inspector outcomes bound to different bytes", () => {
    const sha256 = createHash("sha256").update(HEADERLESS_POSES_CSV).digest("hex");
    const collector = createUniversalSourceFactsV5StreamCollector("poses.csv");
    collector.observe(HEADERLESS_POSES_CSV, 0);
    const mismatched: FoundryCalibrationTrajectorySourceFactsOutcome = {
      sourceSha256: "f".repeat(64),
      sourceSizeBytes: HEADERLESS_POSES_CSV.length,
      state: "facts_not_established",
      category: "parse_failure",
      code: "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
    };
    expect(() => collector.finalize({
      path: "poses.csv",
      sizeBytes: HEADERLESS_POSES_CSV.length,
      sha256,
      detection: {
        status: "detected",
        candidates: [{
          inputType: "trajectory",
          confidence: "medium",
          evidence: ["trajectory_filename"],
        }],
        caveats: [],
      },
      magicHex: HEADERLESS_POSES_CSV.subarray(0, 128).toString("hex"),
    }, { calibrationTrajectoryInspection: mismatched })).toThrowError(
      expect.objectContaining({
        name: "FoundryIntegrityError",
        code: "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_INSPECTION_SOURCE_MISMATCH",
      }),
    );
  });

  it("issues no artifact for cancellation and rejects format-inapplicable failure codes", async () => {
    const csvIdentity = registrationIdentity("poses.csv", HEADERLESS_POSES_CSV);
    const cancelledCollector = createUniversalSourceFactsV5StreamCollector("poses.csv");
    cancelledCollector.observe(HEADERLESS_POSES_CSV, 0);
    expect(() => cancelledCollector.finalize(csvIdentity, {
      calibrationTrajectoryInspection: {
        sourceSha256: csvIdentity.sha256,
        sourceSizeBytes: csvIdentity.sizeBytes,
        state: "facts_not_established",
        category: "cancelled",
        code: "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
      },
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
    }));

    const csvWithJsonCode = createUniversalSourceFactsV5StreamCollector("poses.csv");
    csvWithJsonCode.observe(HEADERLESS_POSES_CSV, 0);
    expect(() => csvWithJsonCode.finalize(csvIdentity, {
      calibrationTrajectoryInspection: {
        sourceSha256: csvIdentity.sha256,
        sourceSizeBytes: csvIdentity.sizeBytes,
        state: "facts_not_established",
        category: "parse_failure",
        code: "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY",
      },
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FAILURE_CODE_FORMAT_MISMATCH",
    }));

    const jsonBytes = Buffer.from("{}", "utf8");
    const jsonIdentity = registrationIdentity("poses.json", jsonBytes);
    const jsonWithCsvCode = createUniversalSourceFactsV5StreamCollector("poses.json");
    jsonWithCsvCode.observe(jsonBytes, 0);
    expect(() => jsonWithCsvCode.finalize(jsonIdentity, {
      calibrationTrajectoryInspection: {
        sourceSha256: jsonIdentity.sha256,
        sourceSizeBytes: jsonIdentity.sizeBytes,
        state: "facts_not_established",
        category: "parse_failure",
        code: "CALIBRATION_TRAJECTORY_CSV_NUL_BYTE",
      },
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FAILURE_CODE_FORMAT_MISMATCH",
    }));

    const malformed = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "poses.csv": Buffer.from("\"unterminated", "utf8") }),
    );
    const failedAsset = malformed.sourceFacts.state === "available"
      ? malformed.sourceFacts.assets[0]
      : undefined;
    if (failedAsset === undefined) throw new Error("expected failed CSV asset");
    expect(UniversalSourceFactsV5AssetSchema.safeParse({
      ...failedAsset,
      inspection: {
        ...failedAsset.inspection,
        category: "parse_failure",
        code: "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY",
      },
    }).success).toBe(false);
  });

  it("preserves Gaussian-over-SPZ precedence for mixed inherited candidates", async () => {
    const bytes = gaussianPlyFixture();
    const baseline = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "scene.spz": bytes }),
    );
    const baselineFile = baseline.receipt.files[0];
    const spzCandidate = baselineFile?.detection.candidates.find(
      (candidate) => candidate.inputType === "spz",
    );
    if (baselineFile === undefined || spzCandidate === undefined) {
      throw new Error("expected a receipt-bound SPZ candidate");
    }
    const detection = {
      status: "ambiguous" as const,
      candidates: [{
        ...spzCandidate,
        inputType: "gaussian_ply" as const,
        evidence: ["bounded_header_gaussian_properties"],
      }, spzCandidate],
      caveats: ["multiple_source_families_match"],
    };
    const identity: UniversalSourceFactsV5ReceiptFileIdentity = {
      path: baselineFile.path,
      sizeBytes: baselineFile.sizeBytes,
      sha256: baselineFile.sha256,
      magicHex: baselineFile.inspection.magicHex,
      detection,
    };
    const collector = createUniversalSourceFactsV5StreamCollector(identity.path);
    collector.observe(bytes, 0);
    const result = collector.finalize(identity, {
      gaussianPlyInspection: {
        sourceSizeBytes: identity.sizeBytes,
        sourceSha256: identity.sha256,
        state: "facts_not_established",
        category: "unsupported_variant",
        code: "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
      },
    });
    const {
      receiptSha256: _baselineReceiptSha256,
      ...baselineReceiptPayload
    } = baseline.receipt;
    const receiptPayload = {
      ...baselineReceiptPayload,
      summary: {
        ...baselineReceiptPayload.summary,
        ambiguousFormatCount: 1,
      },
      files: [{
        ...baselineFile,
        detection,
        quarantine: [{
          reason: "format_ambiguous" as const,
          nextAction: FOUNDRY_QUARANTINE_NEXT_ACTIONS.format_ambiguous,
        }, ...baselineFile.quarantine],
      }],
    };
    const receipt = {
      ...receiptPayload,
      receiptSha256: domainSeparatedSha256(
        "VENVIEWER_FOUNDRY_INTAKE_RECEIPT_V0",
        toCanonicalJson(receiptPayload),
      ),
    };
    const sourceFacts = createUniversalSourceFactsV5ArtifactFromReceipt(
      receipt.receiptSha256,
      [identity],
      [result],
    );
    expect(sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1 },
      assets: [{
        source: { inputType: "gaussian_ply" },
        format: "gaussian_ply",
      }],
    });
    expect(compileFoundrySourceReadinessMapV5({ receipt, sourceFacts })).toMatchObject({
      state: "available",
      files: [{ inputType: "gaussian_ply", format: "gaussian_ply" }],
    });
  });

  it("does not fall through from an ordinary PLY claimant to drone media", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "drone.ply": ordinaryPointPlyFixture() }),
    );
    expect(inspected.receipt.files[0]?.detection.candidates.map(
      (candidate) => candidate.inputType,
    )).toEqual(expect.arrayContaining(["drone_media", "ply_point_cloud"]));
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 0, untargetedFileCount: 1 },
      assets: [],
    });
    expect(compileFoundrySourceReadinessMapV5(inspected)).toMatchObject({
      state: "available",
      summary: { ambiguousFormatCount: 1 },
    });
  });

  it("rejects inherited assets that contradict an untargeted receipt identity", async () => {
    const textBytes = Buffer.from("plain text", "utf8");
    const textSha256 = createHash("sha256").update(textBytes).digest("hex");
    const untargetedIdentity: UniversalSourceFactsV5ReceiptFileIdentity = {
      path: "notes.txt",
      sizeBytes: textBytes.length,
      sha256: textSha256,
      magicHex: textBytes.toString("hex"),
      detection: { status: "unknown", candidates: [], caveats: [] },
    };
    const forgedMedia: UniversalSourceFactsV5FileResult = {
      kind: "asset",
      asset: {
        source: {
          path: "notes.txt",
          sizeBytes: textBytes.length,
          sha256: textSha256,
          inputType: "generic_image",
          receiptCandidateInputTypes: ["generic_image"],
        },
        format: "media_container",
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "MEDIA_CONTAINER_INSPECTION_FAILED",
          coverage: "none",
        },
        facts: null,
        unknowns: [...FOUNDRY_MEDIA_CONTAINER_UNKNOWNS],
      },
    };
    expect(() => createUniversalSourceFactsV5ArtifactFromReceipt(
      "0".repeat(64),
      [untargetedIdentity],
      [forgedMedia],
    )).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V5_INHERITED_RESULT_INVALID",
    }));

    const objBytes = Buffer.from("v 0 0 0\n", "utf8");
    const objRun = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "mesh.obj": objBytes }),
    );
    const notesRun = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "notes.txt": objBytes }),
    );
    const objAsset = objRun.sourceFacts.state === "available"
      ? objRun.sourceFacts.assets[0]
      : undefined;
    if (objAsset?.source.inputType !== "obj" || objAsset.format !== "obj") {
      throw new Error("expected one legitimate OBJ asset");
    }
    const notesFile = notesRun.receipt.files[0];
    if (notesFile === undefined) throw new Error("expected notes receipt identity");
    const forgedObj: UniversalSourceFactsV5FileResult = {
      kind: "asset",
      asset: {
        ...objAsset,
        source: { ...objAsset.source, path: notesFile.path },
      },
    };
    expect(() => createUniversalSourceFactsV5ArtifactFromReceipt(
      notesRun.receipt.receiptSha256,
      [{
        path: notesFile.path,
        sizeBytes: notesFile.sizeBytes,
        sha256: notesFile.sha256,
        magicHex: notesFile.inspection.magicHex,
        detection: notesFile.detection,
      }],
      [forgedObj],
    )).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V5_RESULT_TARGET_MISMATCH",
    }));
  });

  it("keeps V4 issuance immutable and XBIN atomic", async () => {
    const source = await sourceRoot({ "poses.csv": HEADERLESS_POSES_CSV });
    const before = await inspectUniversalIntakeWithSourceFactsV4(source);
    expect(before.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v4",
      state: "available",
      summary: { assetCount: 0, untargetedFileCount: 1 },
    });
    await inspectUniversalIntakeWithSourceFactsV5(source);
    const after = await inspectUniversalIntakeWithSourceFactsV4(source);
    expect(after.sourceFacts).toEqual(before.sourceFacts);

    const blocked = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({
        "poses.csv": HEADERLESS_POSES_CSV,
        "vendor.xbin": Buffer.from([1, 2, 3, 4]),
      }),
    );
    expect(blocked.sourceFacts).toMatchObject({
      state: "unavailable",
      assets: [],
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
    });
  });
});

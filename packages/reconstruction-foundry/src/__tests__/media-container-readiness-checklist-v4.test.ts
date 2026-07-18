import { createHash } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES,
  FoundryOperatorEvidenceChecklistV4Schema,
  compileFoundryOperatorEvidenceChecklistV4,
  serializeFoundryOperatorEvidenceChecklistV4,
} from "../operator-evidence-checklist-v4.js";
import {
  inspectUniversalIntakeWithSourceFacts,
  inspectUniversalIntakeWithSourceFactsV2,
  inspectUniversalIntakeWithSourceFactsV3,
  inspectUniversalIntakeWithSourceFactsV4,
} from "../intake-receipt.js";
import {
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4_DIGEST_DOMAIN,
  FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
  FoundryUniversalSourceFactsV4Schema,
} from "../source-facts-v4.js";
import { serializeUniversalSourceFactsArtifact } from "../source-facts.js";
import { serializeUniversalSourceFactsV2Artifact } from "../source-facts-v2.js";
import { serializeUniversalSourceFactsV3Artifact } from "../source-facts-v3.js";
import {
  FOUNDRY_SOURCE_READINESS_MAP_V4_DIGEST_DOMAIN,
  FoundrySourceReadinessMapV4Schema,
  compileFoundrySourceReadinessMapV4,
  serializeFoundrySourceReadinessMapV4,
} from "../source-readiness-v4.js";

const roots: string[] = [];
const FIXED_MTIME = new Date("2026-07-17T12:00:00.000Z");
const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function smallLegacySpz(): Buffer {
  const count = 2;
  const bytesPerGaussian = 20;
  const payload = Buffer.alloc(16 + count * bytesPerGaussian);
  payload.writeUInt32LE(0x5053474e, 0);
  payload.writeUInt32LE(3, 4);
  payload.writeUInt32LE(count, 8);
  payload.writeUInt8(0, 12);
  payload.writeUInt8(12, 13);
  payload.writeUInt8(0, 14);
  payload.writeUInt8(0, 15);
  for (let index = 16; index < payload.length; index += 1) {
    payload[index] = index & 0xff;
  }
  return gzipSync(payload);
}

function smallGaussianPly(): Buffer {
  const properties = [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 1",
    ...properties.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n"), "ascii");
  return Buffer.concat([header, Buffer.alloc(properties.length * 4)]);
}

function serializedSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-media-readiness-v4-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name);
    await writeFile(path, bytes);
    await utimes(path, FIXED_MTIME, FIXED_MTIME);
  }
  return root;
}

function resignV4Artifact<T extends { readonly factsSha256: string }>(artifact: T): T {
  const { factsSha256: _factsSha256, ...payload } = artifact;
  return {
    ...artifact,
    factsSha256: domainSeparatedSha256(
      FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

function resignReadinessArtifact<T extends { readonly readinessSha256: string }>(
  artifact: T,
): T {
  const { readinessSha256: _readinessSha256, ...payload } = artifact;
  return {
    ...artifact,
    readinessSha256: domainSeparatedSha256(
      FOUNDRY_SOURCE_READINESS_MAP_V4_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

describe("media-container Source Readiness and Operator Evidence V4", () => {
  it("establishes PNG container facts without selecting a camera, panorama, or provenance role", async () => {
    const root = await sourceRoot({ "reference.png": SMALL_PNG });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);

    expect(inspected.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v4",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 0,
      },
      assets: [{
        source: {
          path: "reference.png",
          inputType: "generic_image",
          receiptCandidateInputTypes: [
            "matterport_panorama",
            "dslr_image",
            "generic_image",
            "panorama_360",
            "phone_image",
          ],
        },
        format: "png",
        inspection: {
          state: "established",
          code: "MEDIA_CONTAINER_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: { format: "png", container: { sourceSizeBytes: SMALL_PNG.length } },
      }],
    });
    if (inspected.sourceFacts.state !== "available") throw new Error("expected V4 facts");
    const asset = inspected.sourceFacts.assets[0];
    if (asset === undefined) throw new Error("missing PNG asset");
    expect(asset.unknowns).toEqual(FOUNDRY_MEDIA_CONTAINER_UNKNOWNS);
    expect(asset.unknowns.map((unknown) => unknown.code)).toEqual(
      expect.arrayContaining([
        "MEDIA_CAPTURE_ROLE_UNKNOWN",
        "MEDIA_PROVENANCE_CLASS_UNKNOWN",
        "MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN",
        "MEDIA_RIGHTS_UNKNOWN",
      ]),
    );

    const readiness = compileFoundrySourceReadinessMapV4(inspected);
    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v4",
      state: "available",
      summary: {
        factsEstablishedCount: 1,
        factsNotEstablishedCount: 0,
        outsideSourceFactsV4Count: 0,
      },
      files: [{
        path: "reference.png",
        status: "facts_established",
        inputType: "generic_image",
        format: "png",
        laneIds: ["image_video"],
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V4 readiness");
    expect(readiness.lanes.find((lane) => lane.id === "image_video")).toMatchObject({
      status: "all_observed_facts_established",
      counts: { observedFileCount: 1, factsEstablishedCount: 1 },
    });

    const checklist = compileFoundryOperatorEvidenceChecklistV4({ readiness });
    expect(checklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v4",
      state: "available",
      summary: { normalCount: 10, conditionalCount: 1 },
    });
    if (checklist.state !== "available") throw new Error("expected V4 checklist");
    const mediaItems = checklist.items.filter((item) => item.evidenceCode.startsWith("MEDIA_"));
    expect(mediaItems.map((item) => item.evidenceCode).sort()).toEqual(
      FOUNDRY_MEDIA_CONTAINER_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(new Map(mediaItems.map((item) => [item.evidenceCode, item.category]))).toEqual(
      new Map([
        ["MEDIA_CAMERA_CALIBRATION_UNKNOWN", "registration_input"],
        ["MEDIA_CAPTURE_DEVICE_UNKNOWN", "source_provenance"],
        ["MEDIA_CAPTURE_ROLE_UNKNOWN", "source_provenance"],
        ["MEDIA_CAPTURE_TIME_UNKNOWN", "source_provenance"],
        ["MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN", "bounded_inspection"],
        ["MEDIA_PROJECTION_UNKNOWN", "registration_input"],
        ["MEDIA_PROVENANCE_CLASS_UNKNOWN", "source_provenance"],
        ["MEDIA_RIGHTS_UNKNOWN", "rights_decision"],
        ["MEDIA_SEQUENCE_RELATIONSHIP_UNKNOWN", "registration_input"],
        ["MEDIA_VISUAL_FIDELITY_UNKNOWN", "appearance_reference"],
      ]),
    );
    expect(FoundryUniversalSourceFactsV4Schema.parse(inspected.sourceFacts)).toEqual(inspected.sourceFacts);
    expect(FoundrySourceReadinessMapV4Schema.parse(readiness)).toEqual(readiness);
    expect(FoundryOperatorEvidenceChecklistV4Schema.parse(checklist)).toEqual(checklist);
    expect(serializeFoundrySourceReadinessMapV4(readiness)).toContain(readiness.readinessSha256);
    expect(serializeFoundryOperatorEvidenceChecklistV4(checklist)).toContain(checklist.checklistSha256);
  });

  it("lets recognized bytes override a misleading video extension while retaining the receipt candidate", async () => {
    const root = await sourceRoot({ "misleading.mp4": SMALL_PNG });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    expect(inspected.receipt.files[0]?.detection.candidates.map((candidate) => candidate.inputType)).toEqual([
      "video",
    ]);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        source: {
          inputType: "generic_image",
          receiptCandidateInputTypes: ["video"],
        },
        format: "png",
        inspection: { state: "established" },
      }],
    });
    const readiness = compileFoundrySourceReadinessMapV4(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      files: [{ inputType: "generic_image", format: "png", laneIds: ["image_video"] }],
    });
  });

  it("rejects a re-signed PNG-to-JPEG fact substitution against the receipt signature", async () => {
    const root = await sourceRoot({ "reference.png": SMALL_PNG });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    if (inspected.sourceFacts.state !== "available") throw new Error("expected V4 facts");
    const pngAsset = inspected.sourceFacts.assets[0];
    if (pngAsset?.format !== "png" || pngAsset.facts?.format !== "png") {
      throw new Error("expected established PNG asset");
    }
    const formatTamper = FoundryUniversalSourceFactsV4Schema.parse(resignV4Artifact({
      ...inspected.sourceFacts,
      assets: [{
        ...pngAsset,
        format: "jpeg" as const,
        facts: {
          format: "jpeg" as const,
          profile: "jpeg_sof0_or_sof2_8bit_huffman" as const,
          inspectionCoverage: "complete_marker_and_entropy_structure" as const,
          dimensions: pngAsset.facts.dimensions,
          coding: {
            process: "baseline_sequential_dct" as const,
            samplePrecisionBits: 8 as const,
            componentCount: 3 as const,
            scanCount: 1,
            restartMarkerCount: 0,
          },
          structure: {
            markerCount: 4,
            appSegmentCount: 0,
            commentSegmentCount: 0,
            metadataPayloadBytes: 0,
            eoiOffsetBytes: pngAsset.source.sizeBytes - 2,
          },
          container: pngAsset.facts.container,
          limitations: pngAsset.facts.limitations,
        },
      }],
    }));

    expect(() => compileFoundrySourceReadinessMapV4({
      receipt: inspected.receipt,
      sourceFacts: formatTamper,
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_READINESS_FACTS_TARGET_CONTRADICTION",
    }));
  });

  it("keeps unsupported image containers as explicit facts-not-established media gaps", async () => {
    const root = await sourceRoot({
      "raw.tiff": Buffer.from("49492a000800000000000000", "hex"),
    });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        source: { inputType: "generic_image" },
        format: "media_container",
        inspection: { state: "facts_not_established", category: "unsupported_container" },
        facts: null,
      }],
    });
    const readiness = compileFoundrySourceReadinessMapV4(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      summary: { factsNotEstablishedCount: 1, outsideSourceFactsV4Count: 0 },
      files: [{ status: "facts_not_established", format: "media_container" }],
    });
    if (readiness.state !== "available") throw new Error("expected V4 readiness");
    expect(readiness.gaps.map((gap) => gap.code)).toContain("SOURCE_FACTS_NOT_ESTABLISHED");
    const checklist = compileFoundryOperatorEvidenceChecklistV4({ readiness });
    if (checklist.state !== "available") throw new Error("expected V4 checklist");
    expect(checklist.items.map((item) => item.evidenceCode)).toEqual(
      expect.arrayContaining([
        "SOURCE_FACTS_NOT_ESTABLISHED",
        "MEDIA_CAPTURE_ROLE_UNKNOWN",
        "MEDIA_PROVENANCE_CLASS_UNKNOWN",
      ]),
    );
  });

  it("keeps failed drone-only candidates neutral instead of inventing still or video semantics", async () => {
    const root = await sourceRoot({
      "dji_payload.bin": Buffer.from("unrecognized drone payload", "utf8"),
    });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    expect(inspected.receipt.files[0]?.detection.candidates.map((candidate) => candidate.inputType))
      .toEqual(["drone_media"]);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        source: {
          inputType: "drone_media",
          receiptCandidateInputTypes: ["drone_media"],
        },
        format: "media_container",
        inspection: { state: "facts_not_established" },
        facts: null,
      }],
    });
    const readiness = compileFoundrySourceReadinessMapV4(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      files: [{
        inputType: "drone_media",
        format: "media_container",
        status: "facts_not_established",
        laneIds: ["image_video"],
      }],
    });
  });

  it("rejects re-digested readiness maps whose media format contradicts fact state", async () => {
    const establishedRoot = await sourceRoot({ "reference.png": SMALL_PNG });
    const established = compileFoundrySourceReadinessMapV4(
      await inspectUniversalIntakeWithSourceFactsV4(establishedRoot),
    );
    if (established.state !== "available") throw new Error("expected established readiness");
    const exactFormatAsFailed = resignReadinessArtifact({
      ...established,
      files: established.files.map((file, index) => index === 0
        ? {
            ...file,
            status: "facts_not_established" as const,
            inspection: file.inspection === null
              ? null
              : { ...file.inspection, state: "facts_not_established" as const },
          }
        : file),
    });
    const exactResult = FoundrySourceReadinessMapV4Schema.safeParse(exactFormatAsFailed);
    expect(exactResult.success).toBe(false);
    if (exactResult.success) throw new Error("expected exact media format rejection");
    expect(exactResult.error.issues.map((issue) => issue.message)).toContain(
      "media_container is reserved for facts-not-established while exact media formats require established facts",
    );

    const failedRoot = await sourceRoot({
      "raw.tiff": Buffer.from("49492a000800000000000000", "hex"),
    });
    const failed = compileFoundrySourceReadinessMapV4(
      await inspectUniversalIntakeWithSourceFactsV4(failedRoot),
    );
    if (failed.state !== "available") throw new Error("expected failed readiness");
    const placeholderAsEstablished = resignReadinessArtifact({
      ...failed,
      files: failed.files.map((file, index) => index === 0
        ? {
            ...file,
            status: "facts_established" as const,
            inspection: file.inspection === null
              ? null
              : { ...file.inspection, state: "established" as const },
          }
        : file),
    });
    const placeholderResult = FoundrySourceReadinessMapV4Schema.safeParse(
      placeholderAsEstablished,
    );
    expect(placeholderResult.success).toBe(false);
    if (placeholderResult.success) throw new Error("expected placeholder media rejection");
    expect(placeholderResult.error.issues.map((issue) => issue.message)).toContain(
      "media_container is reserved for facts-not-established while exact media formats require established facts",
    );
  });

  it("rejects candidate-list and identity substitution even when the V4 artifact is re-signed", async () => {
    const root = await sourceRoot({ "reference.png": SMALL_PNG });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    if (inspected.sourceFacts.state !== "available") throw new Error("expected V4 facts");

    const originalAsset = inspected.sourceFacts.assets[0];
    if (
      originalAsset === undefined ||
      !("receiptCandidateInputTypes" in originalAsset.source)
    ) {
      throw new Error("missing media source");
    }
    const candidateTamper = resignV4Artifact({
      ...inspected.sourceFacts,
      assets: inspected.sourceFacts.assets.map((asset, index) =>
        index === 0
          ? {
              ...asset,
              source: {
                ...asset.source,
                receiptCandidateInputTypes: ["generic_image"] as const,
              },
            }
          : asset,
      ),
    });
    expect(() => compileFoundrySourceReadinessMapV4({
      receipt: inspected.receipt,
      sourceFacts: candidateTamper,
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_READINESS_MEDIA_CANDIDATE_BINDING_MISMATCH",
    }));

    const identityTamper = resignV4Artifact({
      ...inspected.sourceFacts,
      assets: inspected.sourceFacts.assets.map((asset, index) =>
        index === 0
          ? {
              ...asset,
              source: { ...asset.source, sha256: "f".repeat(64) },
            }
          : asset,
      ),
    });
    expect(() => compileFoundrySourceReadinessMapV4({
      receipt: inspected.receipt,
      sourceFacts: identityTamper,
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_READINESS_SOURCE_IDENTITY_MISMATCH",
    }));
  });

  it("rejects re-signed media artifacts with impossible nested PNG facts", async () => {
    const root = await sourceRoot({ "reference.png": SMALL_PNG });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    if (inspected.sourceFacts.state !== "available") throw new Error("expected V4 facts");
    const asset = inspected.sourceFacts.assets[0];
    if (asset?.format !== "png" || asset.facts?.format !== "png") {
      throw new Error("expected PNG facts");
    }
    const impossible = resignV4Artifact({
      ...inspected.sourceFacts,
      assets: [{
        ...asset,
        facts: {
          ...asset.facts,
          image: { ...asset.facts.image, channelCount: 1 as const },
        },
      }],
    });
    expect(FoundryUniversalSourceFactsV4Schema.safeParse(impossible).success).toBe(false);
  });

  it("keeps XBIN atomic and exposes no partial media facts", async () => {
    const root = await sourceRoot({
      "reference.png": SMALL_PNG,
      "vendor.xbin": Buffer.from([1, 2, 3, 4]),
    });
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "unavailable",
      assets: [],
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
    });
    const readiness = compileFoundrySourceReadinessMapV4(inspected);
    expect(readiness).toMatchObject({ state: "blocked", files: [], gaps: [] });
    expect(compileFoundryOperatorEvidenceChecklistV4({ readiness })).toMatchObject({
      state: "blocked",
      groups: [],
      items: [],
    });
  });

  it("keeps checked-in V1, V2, and V3 active-profile serialization goldens immutable", async () => {
    const objRoot = await sourceRoot({
      "mesh.obj": Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "ascii"),
    });
    const spzRoot = await sourceRoot({ "scene.spz": smallLegacySpz() });
    const plyRoot = await sourceRoot({ "gaussian.ply": smallGaussianPly() });
    const objPath = join(objRoot, "mesh.obj");
    const spzPath = join(spzRoot, "scene.spz");
    const plyPath = join(plyRoot, "gaussian.ply");

    const beforeV1 = await inspectUniversalIntakeWithSourceFacts(objPath);
    const beforeV2 = await inspectUniversalIntakeWithSourceFactsV2(spzPath);
    const beforeV3 = await inspectUniversalIntakeWithSourceFactsV3(plyPath);
    expect(beforeV1.sourceFacts).toMatchObject({
      state: "available",
      assets: [{ format: "obj", inspection: { state: "established" } }],
    });
    expect(beforeV2.sourceFacts).toMatchObject({
      state: "available",
      assets: [{ format: "spz", inspection: { state: "established" } }],
    });
    expect(beforeV3.sourceFacts).toMatchObject({
      state: "available",
      assets: [{ format: "gaussian_ply", inspection: { state: "established" } }],
    });
    const frozen = {
      v1: serializeUniversalSourceFactsArtifact(beforeV1.sourceFacts),
      v2: serializeUniversalSourceFactsV2Artifact(beforeV2.sourceFacts),
      v3: serializeUniversalSourceFactsV3Artifact(beforeV3.sourceFacts),
    };
    expect({
      v1: serializedSha256(frozen.v1),
      v2: serializedSha256(frozen.v2),
      v3: serializedSha256(frozen.v3),
    }).toEqual({
      v1: "86021003037f5b7d500eefea47da1c7dbacee7724dd5b40783d56498efd55fc0",
      v2: "55c1d4264b675c0ef3a024bbcac12fdcada623dae18e75d257fb0b7d26c70335",
      v3: "39424f1a15bfa7df70e0483f19c4df55a9d80420277eaa3abaeb3e5a82e8a3be",
    });

    await inspectUniversalIntakeWithSourceFactsV4(objPath);
    await inspectUniversalIntakeWithSourceFactsV4(spzPath);
    await inspectUniversalIntakeWithSourceFactsV4(plyPath);

    const afterV1 = await inspectUniversalIntakeWithSourceFacts(objPath);
    const afterV2 = await inspectUniversalIntakeWithSourceFactsV2(spzPath);
    const afterV3 = await inspectUniversalIntakeWithSourceFactsV3(plyPath);
    expect(serializeUniversalSourceFactsArtifact(afterV1.sourceFacts)).toBe(frozen.v1);
    expect(serializeUniversalSourceFactsV2Artifact(afterV2.sourceFacts)).toBe(frozen.v2);
    expect(serializeUniversalSourceFactsV3Artifact(afterV3.sourceFacts)).toBe(frozen.v3);
  });

  it("freezes the explicit V4 media evidence-code registry", () => {
    expect(Object.isFrozen(FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES)).toBe(true);
    expect(
      FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES.filter((code) => code.startsWith("MEDIA_")),
    ).toEqual(
      FOUNDRY_MEDIA_CONTAINER_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
  });
});

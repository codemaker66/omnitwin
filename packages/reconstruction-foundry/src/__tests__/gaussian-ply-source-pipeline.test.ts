import { createHash } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileFoundryOperatorEvidenceChecklistV3 } from "../operator-evidence-checklist-v3.js";
import {
  inspectUniversalIntakeWithSourceFacts,
  inspectUniversalIntakeWithSourceFactsV2,
  inspectUniversalIntakeWithSourceFactsV3,
} from "../intake-receipt.js";
import {
  FOUNDRY_GAUSSIAN_PLY_UNKNOWNS,
  FoundryGaussianPlyFactsV3Schema,
  FoundryUniversalSourceFactsV3Schema,
  createUniversalSourceFactsV3StreamCollector,
  serializeUniversalSourceFactsV3Artifact,
} from "../source-facts-v3.js";
import { serializeUniversalSourceFactsV2Artifact } from "../source-facts-v2.js";
import { serializeUniversalSourceFactsArtifact } from "../source-facts.js";
import { compileFoundrySourceReadinessMapV3 } from "../source-readiness-v3.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

interface FixtureProperty {
  readonly type: string;
  readonly name: string;
}

const WIDTH_BY_TYPE: Readonly<Record<string, number>> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function restProperties(count: 0 | 9 | 24 | 45 | 72): FixtureProperty[] {
  return Array.from({ length: count }, (_, index) => ({ type: "float", name: `f_rest_${String(index)}` }));
}

function brushProperties(
  restCount: 0 | 9 | 24 | 45 | 72,
  extras: readonly FixtureProperty[] = [],
): FixtureProperty[] {
  return [
    { type: "float", name: "f_dc_0" },
    { type: "float", name: "f_dc_1" },
    { type: "float", name: "f_dc_2" },
    ...restProperties(restCount).sort((left, right) => left.name.localeCompare(right.name)),
    { type: "float", name: "opacity" },
    { type: "float", name: "rot_0" },
    { type: "float", name: "rot_1" },
    { type: "float", name: "rot_2" },
    { type: "float", name: "rot_3" },
    { type: "float", name: "scale_0" },
    { type: "float", name: "scale_1" },
    { type: "float", name: "scale_2" },
    ...extras,
    { type: "float", name: "x" },
    { type: "float", name: "y" },
    { type: "float", name: "z" },
  ];
}

function binaryPly(
  properties: readonly FixtureProperty[],
  count = 2,
  separator = " ",
): Buffer {
  const header = Buffer.from([
    "ply",
    ["format", "binary_little_endian", "1.0"].join(separator),
    "comment Exported from Brush",
    "comment SH degree is a non-authoritative producer claim",
    ["element", "vertex", String(count)].join(separator),
    ...properties.map((property) =>
      ["property", property.type, property.name].join(separator)
    ),
    "end_header",
    "",
  ].join("\n"), "ascii");
  const stride = properties.reduce((total, property) => total + (WIDTH_BY_TYPE[property.type] ?? 0), 0);
  return Buffer.concat([header, Buffer.alloc(count * stride)]);
}

function gaussianFixture(): Buffer {
  return binaryPly(brushProperties(45, [
    { type: "uchar", name: "9.vendor:confidence" },
    { type: "double", name: "timestamp" },
  ]), 3);
}

function gaussianFixtureWithShuffledNormals(): Buffer {
  return binaryPly(brushProperties(0, [
    { type: "float", name: "nz" },
    { type: "float", name: "nx" },
    { type: "float", name: "ny" },
  ]), 1);
}

function gaussianFloat32TabbedFixture(): Buffer {
  return binaryPly(
    brushProperties(0).map((property) => ({ ...property, type: "float32" })),
    1,
    "\t",
  );
}

function gaussianLongHeaderFixture(): Buffer {
  const properties = brushProperties(0);
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `comment ${"a".repeat(40_000)}`,
    `comment ${"b".repeat(40_000)}`,
    "element vertex 1",
    ...properties.map((property) => `property ${property.type} ${property.name}`),
    "end_header",
    "",
  ].join("\n"), "ascii");
  const stride = properties.reduce(
    (total, property) => total + (WIDTH_BY_TYPE[property.type] ?? 0),
    0,
  );
  return Buffer.concat([header, Buffer.alloc(stride)]);
}

function ordinaryPointPly(): Buffer {
  return binaryPly([
    { type: "float", name: "x" },
    { type: "float", name: "y" },
    { type: "float", name: "z" },
    { type: "uchar", name: "red" },
    { type: "uchar", name: "green" },
    { type: "uchar", name: "blue" },
  ]);
}

function asciiGaussianPly(): Buffer {
  const properties = brushProperties(0);
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    "element vertex 1",
    ...properties.map((property) => `property ${property.type} ${property.name}`),
    "end_header",
    Array.from({ length: properties.length }, () => "0").join(" "),
    "",
  ].join("\n"), "ascii");
}

async function sourceRoot(name: string, bytes: Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-gaussian-ply-pipeline-"));
  roots.push(root);
  await writeFile(join(root, name), bytes);
  return root;
}

describe("Gaussian PLY Source Facts V3 pipeline", () => {
  it("carries arbitrary Brush order and fixed-width scalar extras through the V3 chain", async () => {
    const root = await sourceRoot("scene.ply", gaussianFixture());
    const first = await inspectUniversalIntakeWithSourceFactsV3(root);
    const second = await inspectUniversalIntakeWithSourceFactsV3(root);

    expect(first.receipt).toEqual(second.receipt);
    expect(first.sourceFacts).toEqual(second.sourceFacts);
    expect(first.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v3",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 0,
      },
      assets: [{
        source: { path: "scene.ply", inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: {
          state: "established",
          code: "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: {
          gaussians: {
            count: 3,
            sphericalHarmonics: { degree: 3, nonDcPropertyCount: 45 },
            extraProperties: { count: 2, names: ["9.vendor:confidence", "timestamp"] },
          },
        },
      }],
    });
    if (first.sourceFacts.state !== "available") throw new Error("expected available V3 facts");
    const asset = first.sourceFacts.assets[0];
    if (asset?.format !== "gaussian_ply" || asset.facts === null) throw new Error("expected Gaussian PLY facts");
    expect(asset.facts.gaussians.properties.find((property) => property.name === "9.vendor:confidence")).toMatchObject({
      declaredType: "uchar",
      canonicalType: "uint8",
      byteWidth: 1,
      role: "extra",
    });
    expect(asset.facts.gaussians.properties.find((property) => property.name === "timestamp")).toMatchObject({
      declaredType: "double",
      canonicalType: "float64",
      byteWidth: 8,
      role: "extra",
    });
    const contradictoryScalarFacts = structuredClone(asset.facts);
    const confidence = contradictoryScalarFacts.gaussians.properties.find(
      (property) => property.name === "9.vendor:confidence",
    );
    if (confidence === undefined) throw new Error("missing confidence property");
    confidence.canonicalType = "float32";
    expect(FoundryGaussianPlyFactsV3Schema.safeParse(contradictoryScalarFacts).success).toBe(false);
    expect(asset.unknowns).toEqual(FOUNDRY_GAUSSIAN_PLY_UNKNOWNS);
    expect(asset.unknowns).toHaveLength(11);
    expect(FoundryUniversalSourceFactsV3Schema.parse(first.sourceFacts)).toEqual(first.sourceFacts);
    expect(serializeUniversalSourceFactsV3Artifact(first.sourceFacts)).toBe(
      serializeUniversalSourceFactsV3Artifact(second.sourceFacts),
    );

    const readiness = compileFoundrySourceReadinessMapV3(first);
    expect(readiness).toMatchObject({
      state: "available",
      files: [{
        path: "scene.ply",
        status: "facts_established",
        inputType: "gaussian_ply",
        format: "gaussian_ply",
        laneIds: ["visual_scene_representation"],
      }],
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV3({ readiness });
    expect(checklist).toMatchObject({ state: "available", summary: { normalCount: 11 } });
  });

  it("keeps normal offsets in nx/ny/nz semantic order when declarations are shuffled", async () => {
    const root = await sourceRoot(
      "shuffled-normals.ply",
      gaussianFixtureWithShuffledNormals(),
    );
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 1 },
      assets: [{
        format: "gaussian_ply",
        facts: {
          gaussians: {
            normals: { state: "present", offsets: [48, 52, 44] },
          },
        },
      }],
    });
  });

  it("routes complete float32/tabbed classic headers into V3 instead of ordinary PLY", async () => {
    const root = await sourceRoot(
      "float32-tabbed.ply",
      gaussianFloat32TabbedFixture(),
    );
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.receipt.files[0]?.detection.candidates[0]?.inputType).toBe(
      "gaussian_ply",
    );
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 1 },
      assets: [{
        format: "gaussian_ply",
        facts: { profile: "classic_3dgs_float32_scalar" },
      }],
    });
  });

  it("refines a valid Gaussian header beyond the 64 KiB receipt probe on the V3 handle", async () => {
    const root = await sourceRoot("long-header.ply", gaussianLongHeaderFixture());
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.receipt.files[0]).toMatchObject({
      detection: {
        candidates: [{ inputType: "ply_point_cloud" }],
        caveats: expect.arrayContaining([
          expect.stringContaining("classification is inconclusive"),
        ]),
      },
    });
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 1, untargetedFileCount: 0 },
      assets: [{
        source: { inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: { code: "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED" },
      }],
    });
    expect(compileFoundrySourceReadinessMapV3(result)).toMatchObject({
      state: "available",
      files: [{ inputType: "gaussian_ply", format: "gaussian_ply" }],
    });
  });

  it("leaves ordinary point-cloud PLY outside Source Facts V3", async () => {
    const root = await sourceRoot("points.ply", ordinaryPointPly());
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.receipt.files[0]?.detection.candidates[0]?.inputType).toBe("ply_point_cloud");
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { receiptFileCount: 1, assetCount: 0, untargetedFileCount: 1 },
      assets: [],
    });
  });

  it("preserves a stable failed Gaussian inspection without promoting format facts", async () => {
    const root = await sourceRoot("broken.ply", asciiGaussianPly());
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        format: "gaussian_ply",
        inspection: {
          state: "facts_not_established",
          category: "unsupported_variant",
          code: "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
          coverage: "none",
        },
        facts: null,
      }],
    });
  });

  it("rejects a Gaussian outcome whose source binding differs", async () => {
    const bytes = gaussianFixture();
    const root = await sourceRoot("scene.ply", bytes);
    const inspected = await inspectUniversalIntakeWithSourceFactsV3(root);
    const receiptFile = inspected.receipt.files[0];
    if (receiptFile === undefined) throw new Error("missing receipt file");
    const collector = createUniversalSourceFactsV3StreamCollector("scene.ply");
    collector.observe(bytes, 0);
    expect(() => collector.finalize({
      path: receiptFile.path,
      sizeBytes: receiptFile.sizeBytes,
      sha256: receiptFile.sha256,
      detection: receiptFile.detection,
    }, {
      gaussianPlyInspection: {
        sourceSizeBytes: bytes.length,
        sourceSha256: "0".repeat(64),
        state: "facts_not_established",
        category: "unsupported_variant",
        code: "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
      },
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V3_GAUSSIAN_PLY_INSPECTION_SOURCE_MISMATCH",
    }));

    const contradictoryCollector = createUniversalSourceFactsV3StreamCollector("scene.ply");
    contradictoryCollector.observe(bytes, 0);
    expect(() => contradictoryCollector.finalize({
      path: receiptFile.path,
      sizeBytes: receiptFile.sizeBytes,
      sha256: receiptFile.sha256,
      detection: receiptFile.detection,
    }, {
      gaussianPlyInspection: {
        sourceSizeBytes: bytes.length,
        sourceSha256: receiptFile.sha256,
        state: "facts_not_established",
        category: "parse_failure",
        code: "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
      },
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_GAUSSIAN_PLY_OUTCOME_INVALID",
    }));
  });

  it("gives verified E57/GLB magic precedence over a contradictory Gaussian candidate", () => {
    const bytes = Buffer.from("glTF-not-a-real-container", "ascii");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const collector = createUniversalSourceFactsV3StreamCollector("misleading.ply");
    collector.observe(bytes, 0);
    expect(() => collector.finalize({
      path: "misleading.ply",
      sizeBytes: bytes.length,
      sha256,
      detection: {
        status: "detected",
        candidates: [{ inputType: "gaussian_ply", confidence: "high", evidence: ["bounded_header_gaussian_properties"] }],
        caveats: [],
      },
    }, {
      gaussianPlyInspection: {
        sourceSizeBytes: bytes.length,
        sourceSha256: sha256,
        state: "facts_not_established",
        category: "unsupported_container",
        code: "GAUSSIAN_PLY_CONTAINER_UNRECOGNIZED",
      },
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V3_UNEXPECTED_GAUSSIAN_PLY_INSPECTION",
    }));
  });

  it("keeps the XBIN receipt boundary atomic and exposes no partial Gaussian facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-gaussian-ply-xbin-"));
    roots.push(root);
    await writeFile(join(root, "scene.ply"), gaussianFixture());
    await writeFile(join(root, "vendor.xbin"), Buffer.from([1, 2, 3, 4]));
    const result = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(result.sourceFacts).toMatchObject({
      state: "unavailable",
      assets: [],
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
    });
  });

  it("leaves immutable V1/V2 PLY-outside-facts bytes unchanged across a V3 inspection", async () => {
    const root = await sourceRoot("scene.ply", gaussianFixture());
    const sourcePath = join(root, "scene.ply");
    const fixedTime = new Date("2026-01-02T03:04:05.000Z");
    await utimes(sourcePath, fixedTime, fixedTime);
    const v1Before = await inspectUniversalIntakeWithSourceFacts(sourcePath);
    const v2Before = await inspectUniversalIntakeWithSourceFactsV2(sourcePath);
    await inspectUniversalIntakeWithSourceFactsV3(sourcePath);
    const v1After = await inspectUniversalIntakeWithSourceFacts(sourcePath);
    const v2After = await inspectUniversalIntakeWithSourceFactsV2(sourcePath);
    expect(v1Before.sourceFacts).toMatchObject({ state: "available", summary: { assetCount: 0, untargetedFileCount: 1 } });
    expect(v2Before.sourceFacts).toMatchObject({ state: "available", summary: { assetCount: 0, untargetedFileCount: 1 } });
    expect(serializeUniversalSourceFactsArtifact(v1Before.sourceFacts)).toBe(
      serializeUniversalSourceFactsArtifact(v1After.sourceFacts),
    );
    expect(serializeUniversalSourceFactsV2Artifact(v2Before.sourceFacts)).toBe(
      serializeUniversalSourceFactsV2Artifact(v2After.sourceFacts),
    );
  });

  it("fails closed on cancellation and keeps raw V3 issuer surfaces internal", async () => {
    const root = await sourceRoot("scene.ply", gaussianFixture());
    const controller = new AbortController();
    controller.abort();
    await expect(inspectUniversalIntakeWithSourceFactsV3(root, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "FoundryIntegrityError", code: "INTAKE_CANCELLED" });

    const entrypoint = await import("../index.js");
    expect(entrypoint.inspectUniversalIntakeWithSourceFactsV3).toBeTypeOf("function");
    expect(entrypoint.FoundryUniversalSourceFactsV3Schema).toBeDefined();
    expect(entrypoint.FOUNDRY_GAUSSIAN_PLY_UNKNOWNS).toEqual(FOUNDRY_GAUSSIAN_PLY_UNKNOWNS);
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV3ArtifactFromReceipt");
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV3StreamCollector");
  });
});

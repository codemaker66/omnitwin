import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  inspectUniversalIntake,
  inspectUniversalIntakeWithSourceFacts,
  inspectUniversalIntakeWithSourceFactsV2,
  inspectUniversalIntakeWithSourceFactsV3,
  inspectUniversalIntakeWithSourceFactsV4,
  inspectUniversalIntakeWithSourceFactsV5,
  inspectUniversalIntakeWithSourceFactsV6,
} from "../intake-receipt.js";
import { serializeUniversalSourceFactsArtifact } from "../source-facts.js";
import { serializeUniversalSourceFactsV2Artifact } from "../source-facts-v2.js";
import { serializeUniversalSourceFactsV3Artifact } from "../source-facts-v3.js";
import { serializeUniversalSourceFactsV4Artifact } from "../source-facts-v4.js";
import { serializeUniversalSourceFactsV5Artifact } from "../source-facts-v5.js";
import {
  FOUNDRY_POINT_PLY_UNKNOWNS,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN,
  FoundryPlyPointCloudFactsV6Schema,
  FoundryUniversalSourceFactsV6Schema,
  createUniversalSourceFactsV6StreamCollector,
  serializeUniversalSourceFactsV6Artifact,
  type UniversalSourceFactsV6ReceiptFileIdentity,
} from "../source-facts-v6.js";
import { compileFoundrySourceReadinessMapV6 } from "../source-readiness-v6.js";
import type { FoundryGaussianPlySourceFactsOutcome } from "../gaussian-ply-source-facts.js";
import {
  FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
  type FoundryPlyPointCloudSourceFactsOutcome,
} from "../ply-point-cloud-source-facts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

interface FixtureProperty {
  readonly type: "float" | "uchar";
  readonly name: string;
}

const WIDTH_BY_TYPE = { float: 4, uchar: 1 } as const;

function binaryPly(
  properties: readonly FixtureProperty[],
  count = 2,
): Buffer {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "comment fixture declaration is non-authoritative",
    `element vertex ${String(count)}`,
    ...properties.map((property) =>
      `property ${property.type} ${property.name}`
    ),
    "end_header",
    "",
  ].join("\n"), "ascii");
  const stride = properties.reduce(
    (total, property) => total + WIDTH_BY_TYPE[property.type],
    0,
  );
  return Buffer.concat([header, Buffer.alloc(count * stride, 0x7f)]);
}

const ORDINARY_PROPERTIES: readonly FixtureProperty[] = [
  { type: "float", name: "x" },
  { type: "float", name: "y" },
  { type: "float", name: "z" },
  { type: "float", name: "nx" },
  { type: "float", name: "ny" },
  { type: "float", name: "nz" },
  { type: "uchar", name: "red" },
  { type: "uchar", name: "green" },
  { type: "uchar", name: "blue" },
];

function ordinaryPointPly(): Buffer {
  return binaryPly(ORDINARY_PROPERTIES, 3);
}

function gaussianPly(): Buffer {
  return binaryPly(GAUSSIAN_PROPERTIES, 1);
}

const GAUSSIAN_PROPERTIES: readonly FixtureProperty[] = [
    { type: "float", name: "f_dc_0" },
    { type: "float", name: "f_dc_1" },
    { type: "float", name: "f_dc_2" },
    { type: "float", name: "opacity" },
    { type: "float", name: "rot_0" },
    { type: "float", name: "rot_1" },
    { type: "float", name: "rot_2" },
    { type: "float", name: "rot_3" },
    { type: "float", name: "scale_0" },
    { type: "float", name: "scale_1" },
    { type: "float", name: "scale_2" },
    { type: "float", name: "x" },
    { type: "float", name: "y" },
    { type: "float", name: "z" },
];

function longHeaderGaussianPly(): Buffer {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `comment ${"a".repeat(40_000)}`,
    `comment ${"b".repeat(40_000)}`,
    "element vertex 1",
    ...GAUSSIAN_PROPERTIES.map((property) =>
      `property ${property.type} ${property.name}`
    ),
    "end_header",
    "",
  ].join("\n"), "ascii");
  const stride = GAUSSIAN_PROPERTIES.reduce(
    (total, property) => total + WIDTH_BY_TYPE[property.type],
    0,
  );
  return Buffer.concat([header, Buffer.alloc(stride)]);
}

function asciiPointPly(): Buffer {
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

function asciiGaussianPly(): Buffer {
  const names = [
    "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "rot_0", "rot_1", "rot_2", "rot_3",
    "scale_0", "scale_1", "scale_2", "x", "y", "z",
  ];
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    "element vertex 1",
    ...names.map((name) => `property float ${name}`),
    "end_header",
    names.map(() => "0").join(" "),
    "",
  ].join("\n"), "ascii");
}

function meshPly(): Buffer {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 3",
    "property float x",
    "property float y",
    "property float z",
    "element face 1",
    "property list uchar int vertex_indices",
    "end_header",
    "",
  ].join("\n"), "ascii");
  return Buffer.concat([header, Buffer.alloc(36 + 13)]);
}

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-point-ply-v6-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(join(root, name), bytes);
  }
  return root;
}

function receiptIdentity(
  receipt: Awaited<ReturnType<typeof inspectUniversalIntake>>,
): UniversalSourceFactsV6ReceiptFileIdentity {
  const file = receipt.files[0];
  if (file === undefined) throw new Error("expected one receipt file");
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    magicHex: file.inspection.magicHex,
    detection: file.detection,
  };
}

describe("ordinary point PLY Source Facts V6 pipeline", () => {
  it("establishes exact fixed-width point layout without decoding values", async () => {
    const root = await sourceRoot({ "fused.ply": ordinaryPointPly() });
    const first = await inspectUniversalIntakeWithSourceFactsV6(root);
    const second = await inspectUniversalIntakeWithSourceFactsV6(root);

    expect(first.receipt).toEqual(second.receipt);
    expect(first.sourceFacts).toEqual(second.sourceFacts);
    expect(first.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v6",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 0,
      },
      assets: [{
        source: { path: "fused.ply", inputType: "ply_point_cloud" },
        format: "ply",
        inspection: {
          state: "established",
          category: "established",
          code: "POINT_PLY_SOURCE_FACTS_ESTABLISHED",
          coverage: "complete_header_and_exact_fixed_width_payload_layout",
        },
        facts: {
          format: "ply_binary_little_endian",
          profile: "ordinary_point_geometry_fixed_width_scalar",
          vertices: {
            count: 3,
            recordStrideBytes: 27,
            payloadBytes: 81,
            requiredCoordinateProperties: {
              names: ["x", "y", "z"],
              ordinals: [0, 1, 2],
              byteOffsets: [0, 4, 8],
              canonicalTypes: ["float32", "float32", "float32"],
            },
            additionalProperties: {
              count: 6,
              names: ["nx", "ny", "nz", "red", "green", "blue"],
            },
          },
          container: { exactFileLengthVerified: true, trailingBytes: 0 },
        },
        unknowns: FOUNDRY_POINT_PLY_UNKNOWNS,
      }],
    });
    if (first.sourceFacts.state !== "available") throw new Error("expected V6 facts");
    const asset = first.sourceFacts.assets[0];
    if (asset?.format !== "ply" || asset.facts === null) {
      throw new Error("expected point PLY facts");
    }
    expect(FoundryPlyPointCloudFactsV6Schema.parse(asset.facts)).toEqual(asset.facts);
    expect(FoundryUniversalSourceFactsV6Schema.parse(first.sourceFacts)).toEqual(
      first.sourceFacts,
    );
    expect(serializeUniversalSourceFactsV6Artifact(first.sourceFacts)).toBe(
      serializeUniversalSourceFactsV6Artifact(second.sourceFacts),
    );
  });

  it("rejects impossible point-header byte claims and overlong property lines", async () => {
    const result = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "fused.ply": ordinaryPointPly() }),
    );
    if (result.sourceFacts.state !== "available") {
      throw new Error("expected available V6 facts");
    }
    const asset = result.sourceFacts.assets[0];
    if (asset?.format !== "ply" || asset.facts === null) {
      throw new Error("expected ordinary point facts");
    }
    const facts = asset.facts;
    const withHeaderBytes = (bytes: number) => ({
      ...facts,
      header: { ...facts.header, bytes },
      container: {
        ...facts.container,
        sourceSizeBytes: bytes + facts.vertices.payloadBytes,
        headerBytes: bytes,
        payloadOffsetBytes: bytes,
      },
    });
    for (const impossible of [withHeaderBytes(1), withHeaderBytes(1024 * 1024)]) {
      const parsed = FoundryPlyPointCloudFactsV6Schema.safeParse(impossible);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected header-bound rejection");
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["header", "bytes"] }),
      ]));
    }

    const overlongName = "a".repeat(FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES);
    const properties = facts.vertices.properties.map((property, index) =>
      index === facts.vertices.properties.length - 1
        ? { ...property, name: overlongName }
        : property
    );
    const additionalNames = properties
      .filter((property) => !["x", "y", "z"].includes(property.name))
      .map((property) => property.name);
    const headerBytes = 100_000;
    const overlongDeclaration = {
      ...facts,
      header: { ...facts.header, bytes: headerBytes },
      vertices: {
        ...facts.vertices,
        properties,
        additionalProperties: {
          count: additionalNames.length,
          names: additionalNames,
        },
      },
      container: {
        ...facts.container,
        sourceSizeBytes: headerBytes + facts.vertices.payloadBytes,
        headerBytes,
        payloadOffsetBytes: headerBytes,
      },
    };
    const declarationParse =
      FoundryPlyPointCloudFactsV6Schema.safeParse(overlongDeclaration);
    expect(declarationParse.success).toBe(false);
    if (declarationParse.success) {
      throw new Error("expected property-line rejection");
    }
    expect(declarationParse.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("property declaration"),
      }),
    ]));
  });

  it("preserves Gaussian precedence and never falls through an explicit Gaussian failure", async () => {
    const inherited = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "scene.ply": gaussianPly() }),
    );
    expect(inherited.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 1 },
      assets: [{
        source: { inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: { code: "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED" },
      }],
    });

    const failed = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "failed-gaussian.ply": asciiGaussianPly() }),
    );
    expect(failed.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        source: { inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: { code: "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED" },
        facts: null,
      }],
    });
  });

  it("refines a long-header Gaussian candidate and rejects an ordinary-point masquerade", async () => {
    const result = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "long-header.ply": longHeaderGaussianPly() }),
    );
    expect(result.receipt.files[0]).toMatchObject({
      detection: { candidates: [{ inputType: "ply_point_cloud" }] },
    });
    if (result.sourceFacts.state !== "available") {
      throw new Error("expected available V6 facts");
    }
    const asset = result.sourceFacts.assets[0];
    if (
      asset?.format !== "gaussian_ply" ||
      asset.facts === null ||
      !("gaussians" in asset.facts)
    ) {
      throw new Error("expected refined Gaussian facts");
    }
    const properties = asset.facts.gaussians.properties.map((property) => ({
      ordinal: property.ordinal,
      name: property.name,
      declaredType: property.declaredType,
      canonicalType: property.canonicalType,
      byteOffset: property.byteOffset,
      byteWidth: property.byteWidth,
    }));
    const coordinates = ["x", "y", "z"].map((name) =>
      properties.find((property) => property.name === name)
    );
    if (coordinates.some((property) => property === undefined)) {
      throw new Error("expected Gaussian coordinate properties");
    }
    const [x, y, z] = coordinates;
    if (x === undefined || y === undefined || z === undefined) {
      throw new Error("expected Gaussian coordinate properties");
    }
    const additionalNames = properties
      .filter((property) => !["x", "y", "z"].includes(property.name))
      .map((property) => property.name);
    const pointFacts = {
      format: "ply_binary_little_endian" as const,
      profile: "ordinary_point_geometry_fixed_width_scalar" as const,
      inspectionCoverage:
        "complete_header_and_exact_fixed_width_payload_layout" as const,
      plyVersion: "1.0" as const,
      header: asset.facts.header,
      vertices: {
        count: asset.facts.gaussians.count,
        recordStrideBytes: asset.facts.gaussians.vertexStrideBytes,
        payloadBytes: asset.facts.gaussians.payloadBytes,
        properties,
        requiredCoordinateProperties: {
          names: ["x", "y", "z"] as const,
          ordinals: [x.ordinal, y.ordinal, z.ordinal] as const,
          byteOffsets: [x.byteOffset, y.byteOffset, z.byteOffset] as const,
          canonicalTypes: [
            x.canonicalType,
            y.canonicalType,
            z.canonicalType,
          ] as const,
        },
        additionalProperties: {
          count: additionalNames.length,
          names: additionalNames,
        },
      },
      container: asset.facts.container,
      limitations: FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
    };
    const pointParse = FoundryPlyPointCloudFactsV6Schema.safeParse(pointFacts);
    expect(pointParse.success).toBe(false);
    if (pointParse.success) throw new Error("expected point schema rejection");
    expect(pointParse.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["vertices", "properties"],
        message: expect.stringContaining("classic Gaussian PLY"),
      }),
    ]));

    const unsigned = {
      ...result.sourceFacts,
      assets: [{
        source: { ...asset.source, inputType: "ply_point_cloud" as const },
        format: "ply" as const,
        inspection: {
          state: "established" as const,
          category: "established" as const,
          code: "POINT_PLY_SOURCE_FACTS_ESTABLISHED" as const,
          coverage:
            "complete_header_and_exact_fixed_width_payload_layout" as const,
        },
        facts: pointFacts,
        unknowns: FOUNDRY_POINT_PLY_UNKNOWNS,
      }],
      factsSha256: "0".repeat(64),
    };
    const { factsSha256: _factsSha256, ...payload } = unsigned;
    const forged = {
      ...unsigned,
      factsSha256: domainSeparatedSha256(
        FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN,
        toCanonicalJson(payload),
      ),
    };
    expect(FoundryUniversalSourceFactsV6Schema.safeParse(forged).success).toBe(
      false,
    );
    expect(() => compileFoundrySourceReadinessMapV6({
      receipt: result.receipt,
      sourceFacts: forged,
    })).toThrow();
  });

  it("retains unsupported ordinary ASCII and mesh variants as failed point assets", async () => {
    const result = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({
        "ascii.ply": asciiPointPly(),
        "mesh.ply": meshPly(),
      }),
    );
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 2, establishedCount: 0, factsNotEstablishedCount: 2 },
      assets: [
        {
          source: { path: "ascii.ply", inputType: "ply_point_cloud" },
          format: "ply",
          inspection: {
            state: "facts_not_established",
            category: "unsupported_variant",
            code: "POINT_PLY_ASCII_ENCODING_UNSUPPORTED",
            coverage: "none",
          },
          facts: null,
        },
        {
          source: { path: "mesh.ply", inputType: "ply_point_cloud" },
          format: "ply",
          inspection: {
            state: "facts_not_established",
            category: "unsupported_variant",
            code: "POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED",
            coverage: "none",
          },
          facts: null,
        },
      ],
    });
  });

  it("rejects mismatched or cancelled point outcomes before artifact issuance", async () => {
    const bytes = ordinaryPointPly();
    const receipt = await inspectUniversalIntake(
      await sourceRoot({ "fused.ply": bytes }),
    );
    const identity = receiptIdentity(receipt);
    const gaussianFailure: FoundryGaussianPlySourceFactsOutcome = {
      sourceSha256: identity.sha256,
      sourceSizeBytes: identity.sizeBytes,
      state: "facts_not_established",
      category: "unsupported_variant",
      code: "GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING",
    };
    const mismatched: FoundryPlyPointCloudSourceFactsOutcome = {
      sourceSha256: "f".repeat(64),
      sourceSizeBytes: identity.sizeBytes,
      state: "facts_not_established",
      category: "parse_failure",
      code: "POINT_PLY_PAYLOAD_LENGTH_MISMATCH",
    };
    const mismatchCollector = createUniversalSourceFactsV6StreamCollector(identity.path);
    mismatchCollector.observe(bytes, 0);
    expect(() => mismatchCollector.finalize(identity, {
      gaussianPlyInspection: gaussianFailure,
      plyPointCloudInspection: mismatched,
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V6_POINT_PLY_INSPECTION_SOURCE_MISMATCH",
    }));

    const cancelledCollector = createUniversalSourceFactsV6StreamCollector(identity.path);
    cancelledCollector.observe(bytes, 0);
    expect(() => cancelledCollector.finalize(identity, {
      gaussianPlyInspection: gaussianFailure,
      plyPointCloudInspection: {
        sourceSha256: identity.sha256,
        sourceSizeBytes: identity.sizeBytes,
        state: "facts_not_established",
        category: "cancelled",
        code: "POINT_PLY_INSPECTION_CANCELLED",
      },
    })).toThrowError(expect.objectContaining({
      code: "SOURCE_FACTS_V6_POINT_PLY_INSPECTION_CANCELLED",
    }));
  });

  it("keeps V1-V5 issuance immutable and XBIN receipt scope atomic", async () => {
    const root = await sourceRoot({ "fused.ply": ordinaryPointPly() });
    const before = await Promise.all([
      inspectUniversalIntakeWithSourceFacts(root),
      inspectUniversalIntakeWithSourceFactsV2(root),
      inspectUniversalIntakeWithSourceFactsV3(root),
      inspectUniversalIntakeWithSourceFactsV4(root),
      inspectUniversalIntakeWithSourceFactsV5(root),
    ]);
    await inspectUniversalIntakeWithSourceFactsV6(root);
    const after = await Promise.all([
      inspectUniversalIntakeWithSourceFacts(root),
      inspectUniversalIntakeWithSourceFactsV2(root),
      inspectUniversalIntakeWithSourceFactsV3(root),
      inspectUniversalIntakeWithSourceFactsV4(root),
      inspectUniversalIntakeWithSourceFactsV5(root),
    ]);
    expect(serializeUniversalSourceFactsArtifact(before[0].sourceFacts)).toBe(
      serializeUniversalSourceFactsArtifact(after[0].sourceFacts),
    );
    expect(serializeUniversalSourceFactsV2Artifact(before[1].sourceFacts)).toBe(
      serializeUniversalSourceFactsV2Artifact(after[1].sourceFacts),
    );
    expect(serializeUniversalSourceFactsV3Artifact(before[2].sourceFacts)).toBe(
      serializeUniversalSourceFactsV3Artifact(after[2].sourceFacts),
    );
    expect(serializeUniversalSourceFactsV4Artifact(before[3].sourceFacts)).toBe(
      serializeUniversalSourceFactsV4Artifact(after[3].sourceFacts),
    );
    expect(serializeUniversalSourceFactsV5Artifact(before[4].sourceFacts)).toBe(
      serializeUniversalSourceFactsV5Artifact(after[4].sourceFacts),
    );

    const blocked = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({
        "fused.ply": ordinaryPointPly(),
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

  it("fails closed on cancellation and keeps raw V5/V6 issuers internal", async () => {
    const root = await sourceRoot({ "fused.ply": ordinaryPointPly() });
    const controller = new AbortController();
    controller.abort();
    await expect(inspectUniversalIntakeWithSourceFactsV6(root, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "FoundryIntegrityError", code: "INTAKE_CANCELLED" });

    const entrypoint = await import("../index.js");
    expect(entrypoint.inspectUniversalIntakeWithSourceFactsV6).toBeTypeOf("function");
    expect(entrypoint.FoundryUniversalSourceFactsV6Schema).toBeDefined();
    expect(entrypoint.FOUNDRY_POINT_PLY_UNKNOWNS).toEqual(FOUNDRY_POINT_PLY_UNKNOWNS);
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV5ArtifactFromReceipt");
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV5StreamCollector");
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV6ArtifactFromReceipt");
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV6StreamCollector");
  });

});

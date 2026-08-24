import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FoundryUniversalSourceFactsV6Schema,
  createUniversalSourceFactsV5ArtifactFromReceipt,
  createUniversalSourceFactsV6ArtifactFromV5,
  inspectUniversalIntakeWithSourceFactsV6,
  serializeUniversalSourceFactsV6Artifact,
  verifyUniversalIntakeWithSourceFactsV6Result,
} from "../index.js";
import { UniversalSourceFactsV5FileResultSchema } from "../source-facts-v5.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

interface Property {
  readonly type: "float" | "uchar" | "uint";
  readonly name: string;
}

const WIDTH_BY_TYPE: Readonly<Record<Property["type"], number>> = {
  float: 4,
  uchar: 1,
  uint: 4,
};

function pointPly(properties: readonly Property[], count = 2): Buffer {
  const header = Buffer.from(
    `${[
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${String(count)}`,
      ...properties.map(
        (property) => `property ${property.type} ${property.name}`,
      ),
      "end_header",
    ].join("\n")}\n`,
    "ascii",
  );
  const stride = properties.reduce(
    (total, property) => total + WIDTH_BY_TYPE[property.type],
    0,
  );
  return Buffer.concat([header, Buffer.alloc(stride * count)]);
}

const ORDINARY_PROPERTIES: readonly Property[] = [
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

const GAUSSIAN_PROPERTIES: readonly Property[] = [
  { type: "float", name: "x" },
  { type: "float", name: "y" },
  { type: "float", name: "z" },
  { type: "float", name: "f_dc_0" },
  { type: "float", name: "f_dc_1" },
  { type: "float", name: "f_dc_2" },
  { type: "float", name: "opacity" },
  { type: "float", name: "scale_0" },
  { type: "float", name: "scale_1" },
  { type: "float", name: "scale_2" },
  { type: "float", name: "rot_0" },
  { type: "float", name: "rot_1" },
  { type: "float", name: "rot_2" },
  { type: "float", name: "rot_3" },
];

function faceMeshPly(): Buffer {
  const header = Buffer.from(
    `${[
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "element face 1",
      "property list uchar uint vertex_indices",
      "end_header",
    ].join("\n")}\n`,
    "ascii",
  );
  return Buffer.concat([header, Buffer.alloc(3 * 12 + 1 + 3 * 4)]);
}

function e57Fixture(size = 64): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write("ASTM-E57", 0, "ascii");
  bytes.writeUInt32LE(1, 8);
  bytes.writeUInt32LE(0, 12);
  bytes.writeBigUInt64LE(BigInt(size), 16);
  bytes.writeBigUInt64LE(48n, 24);
  bytes.writeBigUInt64LE(0n, 32);
  bytes.writeBigUInt64LE(1024n, 40);
  return bytes;
}

async function temporaryBundle(
  files: Readonly<Record<string, Uint8Array>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-source-facts-v6-"));
  roots.push(root);
  await Promise.all(
    Object.entries(files).map(([name, bytes]) =>
      writeFile(join(root, name), bytes),
    ),
  );
  return root;
}

describe("Universal Source Facts V6 ordinary point PLY refinement", () => {
  it("establishes ordinary point structure without claiming units, authority, or movable-object classification", async () => {
    const root = await temporaryBundle({
      "room-points.ply": pointPly(ORDINARY_PROPERTIES, 852),
    });
    const result = await inspectUniversalIntakeWithSourceFactsV6(root);
    expect(verifyUniversalIntakeWithSourceFactsV6Result(result)).toEqual(
      result,
    );

    expect(result.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v6",
      state: "available",
      receiptSha256: result.receipt.receiptSha256,
      baseFactsV5Sha256: result.sourceFacts.baseFactsV5.factsSha256,
      summary: {
        receiptFileCount: 1,
        targetedPointPlyCount: 1,
        establishedPointPlyCount: 1,
        factsNotEstablishedPointPlyCount: 0,
      },
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        pointCloudInspection: "bounded_header_and_exact_payload_extent",
        rights: "not_evaluated",
        authority: "none",
      },
      pointCloudPlyRefinements: [
        {
          source: {
            path: "room-points.ply",
            receiptCandidateInputTypes: ["ply_point_cloud"],
          },
          outcome: {
            state: "established",
            facts: {
              profile: "ordinary_point_geometry_fixed_width_scalar",
              vertices: {
                count: 852,
                recordStrideBytes: 27,
                requiredCoordinateProperties: {
                  names: ["x", "y", "z"],
                  ordinals: [0, 1, 2],
                },
              },
            },
          },
          authority: "none",
        },
      ],
    });
    expect(
      result.sourceFacts.pointCloudPlyRefinements[0]?.nextActions,
    ).toContain(
      "Classify captured movable objects and exclude them from placement, measurement, collision, and export authority.",
    );
  });

  it("is deterministic for unchanged bytes and rejects a tampered refinement", async () => {
    const root = await temporaryBundle({
      "points.ply": pointPly(ORDINARY_PROPERTIES),
    });
    const first = await inspectUniversalIntakeWithSourceFactsV6(root);
    const second = await inspectUniversalIntakeWithSourceFactsV6(root);

    expect(second.sourceFacts.factsSha256).toBe(first.sourceFacts.factsSha256);
    expect(serializeUniversalSourceFactsV6Artifact(second.sourceFacts)).toBe(
      serializeUniversalSourceFactsV6Artifact(first.sourceFacts),
    );

    const tampered = structuredClone(first.sourceFacts);
    const refinement = tampered.pointCloudPlyRefinements[0];
    if (refinement?.outcome.state !== "established") {
      throw new Error("expected established point PLY refinement");
    }
    refinement.outcome.facts.vertices.recordStrideBytes += 1;
    expect(
      FoundryUniversalSourceFactsV6Schema.safeParse(tampered).success,
    ).toBe(false);
  });

  it("does not reclassify Gaussian PLY or face meshes as ordinary point geometry", async () => {
    const root = await temporaryBundle({
      "appearance.ply": pointPly(GAUSSIAN_PROPERTIES, 1),
      "mesh.ply": faceMeshPly(),
    });
    const { sourceFacts } = await inspectUniversalIntakeWithSourceFactsV6(root);
    const outcomes = new Map(
      sourceFacts.pointCloudPlyRefinements.map(
        (refinement) => [refinement.source.path, refinement.outcome] as const,
      ),
    );

    expect(outcomes.get("appearance.ply")).toBeUndefined();
    expect(sourceFacts.baseFactsV5.state).toBe("available");
    if (sourceFacts.baseFactsV5.state !== "available") {
      throw new Error("expected available base facts");
    }
    expect(
      sourceFacts.baseFactsV5.assets.find(
        (asset) => asset.source.path === "appearance.ply",
      ),
    ).toMatchObject({
      format: "gaussian_ply",
      inspection: { state: "established" },
    });
    expect(outcomes.get("mesh.ply")).toMatchObject({
      state: "facts_not_established",
      category: "unsupported_variant",
      code: "POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED",
    });
    expect(sourceFacts.summary).toMatchObject({
      targetedPointPlyCount: 1,
      establishedPointPlyCount: 0,
      factsNotEstablishedPointPlyCount: 1,
    });
  });

  it("preserves the atomic XBIN stop and issues no partial point refinement", async () => {
    const root = await temporaryBundle({
      "capture.xbin": Buffer.from("XBAG-uninterpreted-vendor-payload", "ascii"),
      "points.ply": pointPly(ORDINARY_PROPERTIES),
    });
    const { receipt, sourceFacts } =
      await inspectUniversalIntakeWithSourceFactsV6(root);

    expect(sourceFacts).toMatchObject({
      state: "unavailable",
      receiptSha256: receipt.receiptSha256,
      pointCloudPlyRefinements: [],
      summary: {
        receiptFileCount: 2,
        targetedPointPlyCount: 0,
        establishedPointPlyCount: 0,
        factsNotEstablishedPointPlyCount: 0,
      },
    });
  });

  it("requires the exact complete receipt-derived refinement set", async () => {
    const root = await temporaryBundle({
      "points.ply": pointPly(ORDINARY_PROPERTIES),
    });
    const { receipt, sourceFacts } =
      await inspectUniversalIntakeWithSourceFactsV6(root);
    const identity = receipt.files[0];
    if (identity === undefined) throw new Error("expected receipt file");

    expect(() =>
      createUniversalSourceFactsV6ArtifactFromV5(
        sourceFacts.baseFactsV5,
        [
          {
            path: identity.path,
            sizeBytes: identity.sizeBytes,
            sha256: identity.sha256,
            magicHex: identity.inspection.magicHex,
            detection: identity.detection,
          },
        ],
        [],
      ),
    ).toThrowError(/one point PLY refinement/u);
  });

  it("preserves an actionable zero-byte PLY failure instead of losing the V6 artifact", async () => {
    const root = await temporaryBundle({ "empty.ply": Buffer.alloc(0) });
    const result = await inspectUniversalIntakeWithSourceFactsV6(root);

    expect(result.sourceFacts.pointCloudPlyRefinements).toHaveLength(1);
    expect(
      result.sourceFacts.pointCloudPlyRefinements[0]?.outcome,
    ).toMatchObject({
      state: "facts_not_established",
      category: "resource_limit",
      code: "POINT_PLY_SOURCE_SIZE_INVALID",
      sourceSizeBytes: 0,
    });
    expect(verifyUniversalIntakeWithSourceFactsV6Result(result)).toEqual(
      result,
    );
  });

  it("rejects a V6 identity declaration substituted away from its full receipt", async () => {
    const root = await temporaryBundle({
      "points.ply": pointPly(ORDINARY_PROPERTIES),
    });
    const result = await inspectUniversalIntakeWithSourceFactsV6(root);
    const substituted = structuredClone(result);
    const identity = substituted.sourceFacts.receiptFileIdentities[0];
    if (identity === undefined) throw new Error("expected retained identity");
    identity.path = "substituted.ply";

    expect(() =>
      verifyUniversalIntakeWithSourceFactsV6Result(substituted),
    ).toThrowError();
  });

  it("rejects a fully re-digested V5/V6 substitution paired with the genuine receipt", async () => {
    const root = await temporaryBundle({
      "points.ply": pointPly(ORDINARY_PROPERTIES),
    });
    const genuine = await inspectUniversalIntakeWithSourceFactsV6(root);
    const file = genuine.receipt.files[0];
    const refinement = genuine.sourceFacts.pointCloudPlyRefinements[0];
    if (file === undefined || refinement === undefined) {
      throw new Error("expected one receipt-bound point PLY refinement");
    }
    const forgedIdentity = {
      path: "substituted.ply",
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      magicHex: file.inspection.magicHex,
      detection: file.detection,
    };
    const forgedV5 = createUniversalSourceFactsV5ArtifactFromReceipt(
      genuine.receipt.receiptSha256,
      [forgedIdentity],
      [
        {
          kind: "untargeted",
          source: {
            path: forgedIdentity.path,
            sizeBytes: forgedIdentity.sizeBytes,
            sha256: forgedIdentity.sha256,
          },
        },
      ],
    );
    const forgedV6 = createUniversalSourceFactsV6ArtifactFromV5(
      forgedV5,
      [forgedIdentity],
      [{ path: forgedIdentity.path, outcome: refinement.outcome }],
    );

    expect(() =>
      verifyUniversalIntakeWithSourceFactsV6Result({
        receipt: genuine.receipt,
        sourceFacts: forgedV6,
      }),
    ).toThrowError(/identities do not match the complete/u);
  });

  it("re-derives embedded V5 routing from the genuine receipt before accepting the pair", async () => {
    const root = await temporaryBundle({
      "points.ply": pointPly(ORDINARY_PROPERTIES),
      "survey.e57": e57Fixture(),
    });
    const genuine = await inspectUniversalIntakeWithSourceFactsV6(root);
    if (genuine.sourceFacts.baseFactsV5.state !== "available") {
      throw new Error("expected available V5 facts");
    }
    const surveyAsset = genuine.sourceFacts.baseFactsV5.assets.find(
      (asset) => asset.source.path === "survey.e57",
    );
    const refinement = genuine.sourceFacts.pointCloudPlyRefinements.find(
      (candidate) => candidate.source.path === "points.ply",
    );
    if (surveyAsset === undefined || refinement === undefined) {
      throw new Error("expected E57 V5 asset and PLY V6 refinement");
    }
    const genuineIdentities = genuine.receipt.files.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      magicHex: file.inspection.magicHex,
      detection: file.detection,
    }));
    const forgedIdentities = genuineIdentities.map((identity) =>
      identity.path === "survey.e57"
        ? { ...identity, path: "substituted.e57" }
        : identity,
    );
    const forgedV5 = createUniversalSourceFactsV5ArtifactFromReceipt(
      genuine.receipt.receiptSha256,
      forgedIdentities,
      forgedIdentities.map((identity) =>
        UniversalSourceFactsV5FileResultSchema.parse(
          identity.path === "substituted.e57"
            ? {
                kind: "asset" as const,
                asset: {
                  ...surveyAsset,
                  source: { ...surveyAsset.source, path: identity.path },
                },
              }
            : {
                kind: "untargeted" as const,
                source: {
                  path: identity.path,
                  sizeBytes: identity.sizeBytes,
                  sha256: identity.sha256,
                },
              },
        ),
      ),
    );
    const forgedV6 = createUniversalSourceFactsV6ArtifactFromV5(
      forgedV5,
      genuineIdentities,
      [{ path: "points.ply", outcome: refinement.outcome }],
    );

    expect(() =>
      verifyUniversalIntakeWithSourceFactsV6Result({
        receipt: genuine.receipt,
        sourceFacts: forgedV6,
      }),
    ).toThrowError(/V5 result|receipt/u);
  });
});

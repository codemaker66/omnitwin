import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  inspectUniversalIntakeWithSourceFactsV6,
  inspectUniversalIntakeWithSourceFactsV7,
} from "../intake-receipt.js";
import {
  FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN,
  FOUNDRY_POTREE_V2_UNKNOWNS,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7_DIGEST_DOMAIN,
  FoundryPotreeV2BundleAssetV7Schema,
  FoundryUniversalSourceFactsV7Schema,
  serializeUniversalSourceFactsV7Artifact,
} from "../source-facts-v7.js";
import { FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN } from
  "../source-facts-v6.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function attribute(
  name: "position" | "intensity" | "lcc prediction",
): Record<string, unknown> {
  const position = name === "position";
  return {
    name,
    description: "fixture declaration is not semantic authority",
    size: position ? 12 : 1,
    numElements: position ? 3 : 1,
    elementSize: position ? 4 : 1,
    type: position ? "int32" : "uint8",
    min: position ? [0, 0, 0] : [0],
    max: position ? [10, 20, 30] : [255],
    scale: position ? [1, 1, 1] : [1],
    offset: position ? [0, 0, 0] : [0],
  };
}

function metadata(pointCount = 2): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "deterministic Potree V2 pipeline fixture",
    points: pointCount,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position"),
      attribute("intensity"),
      attribute("lcc prediction"),
    ],
  }), "utf8");
}

function oneLeafHierarchy(pointCount = 2): Buffer {
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0);
  hierarchy.writeUInt8(0, 1);
  hierarchy.writeUInt32LE(pointCount, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(BigInt(pointCount * 14), 14);
  return hierarchy;
}

function completeBundle(
  metadataBytes = metadata(),
  hierarchyBytes = oneLeafHierarchy(),
): Readonly<Record<string, Buffer>> {
  return {
    "model/metadata.json": metadataBytes,
    "model/hierarchy.bin": hierarchyBytes,
    "model/octree.bin": Buffer.alloc(28, 0x7f),
    "notes.txt": Buffer.from("not part of the Potree bundle", "utf8"),
  };
}

function ordinaryPointPly(): Buffer {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 1",
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "",
  ].join("\n"), "ascii");
  return Buffer.concat([header, Buffer.alloc(12)]);
}

function redigest<T extends { readonly factsSha256: string }>(
  value: T,
  domain: string,
): T {
  const { factsSha256: _factsSha256, ...payload } = value;
  return {
    ...value,
    factsSha256: domainSeparatedSha256(domain, toCanonicalJson(payload)),
  } as T;
}

async function sourceRoot(
  files: Readonly<Record<string, Buffer>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-potree-pipeline-v7-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return root;
}

describe("Potree v2 Source Facts V7 intake pipeline", () => {
  it("issues a deterministic exact-member wrapper while preserving V6", async () => {
    const root = await sourceRoot(completeBundle());
    const inherited = await inspectUniversalIntakeWithSourceFactsV6(root);
    const first = await inspectUniversalIntakeWithSourceFactsV7(root);
    const second = await inspectUniversalIntakeWithSourceFactsV7(root);

    expect(first).toEqual(second);
    expect(first.sourceFacts.inherited).toEqual(inherited.sourceFacts);
    expect(first.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v7",
      state: "available",
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        decodedGeometry: "none",
        authority: "none",
      },
      summary: {
        receiptFileCount: 4,
        potreeBundleCount: 1,
        establishedPotreeBundleCount: 1,
        factsNotEstablishedPotreeBundleCount: 0,
        targetedMemberFileCount: 3,
        untargetedFileCount: 1,
      },
      potreeBundles: [{
        bundleRoot: "model",
        members: [
          { role: "metadata", path: "model/metadata.json" },
          { role: "hierarchy", path: "model/hierarchy.bin" },
          { role: "octree", path: "model/octree.bin" },
        ],
        inspection: {
          state: "established",
          category: "established",
          code: "POTREE_V2_SOURCE_FACTS_ESTABLISHED",
          coverage: "complete_metadata_hierarchy_and_exact_octree_layout",
        },
        facts: {
          profile: "xgrids_default_position_intensity_lcc_prediction_14_byte",
          metadata: {
            pointCount: 2,
            recordStrideBytes: 14,
            declaredOffset: [0, 0, 0],
          },
          hierarchy: {
            logicalNodeCount: 1,
            leafNodeCount: 1,
            pointCountSum: 2,
            declaredDepthMatchesObservedMaximum: true,
          },
          octree: {
            sourceSizeBytes: 28,
            expectedSizeFromMetadataBytes: 28,
            coveredBytes: 28,
          },
        },
        unknowns: FOUNDRY_POTREE_V2_UNKNOWNS,
      }],
    });
    expect(FoundryUniversalSourceFactsV7Schema.parse(first.sourceFacts)).toEqual(
      first.sourceFacts,
    );
    expect(serializeUniversalSourceFactsV7Artifact(first.sourceFacts)).toBe(
      serializeUniversalSourceFactsV7Artifact(second.sourceFacts),
    );
  });

  it("records an incomplete two-member candidate without inventing facts", async () => {
    const root = await sourceRoot({
      "model/metadata.json": metadata(),
      "model/hierarchy.bin": oneLeafHierarchy(),
    });
    const result = await inspectUniversalIntakeWithSourceFactsV7(root);

    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: {
        potreeBundleCount: 1,
        establishedPotreeBundleCount: 0,
        factsNotEstablishedPotreeBundleCount: 1,
        targetedMemberFileCount: 2,
        untargetedFileCount: 0,
      },
      potreeBundles: [{
        members: [
          { role: "metadata" },
          { role: "hierarchy" },
        ],
        inspection: {
          state: "facts_not_established",
          code: "POTREE_V2_MEMBER_SET_INVALID",
          coverage: "none",
        },
        facts: null,
      }],
    });
  });

  it("fails the facts lane closed on real structural contradictions", async () => {
    const invalidJson = await inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot(completeBundle(Buffer.from("{", "utf8"))),
    );
    expect(invalidJson.sourceFacts).toMatchObject({
      potreeBundles: [{
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "POTREE_V2_METADATA_JSON_INVALID",
        },
        facts: null,
      }],
    });

    const pointMismatch = await inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot(completeBundle(metadata(2), oneLeafHierarchy(1))),
    );
    expect(pointMismatch.sourceFacts).toMatchObject({
      potreeBundles: [{
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "POTREE_V2_HIERARCHY_POINT_COUNT_MISMATCH",
        },
        facts: null,
      }],
    });
  });

  it("rejects self-redigested fact, member-path, and inherited-overlap contradictions", async () => {
    const result = await inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot({
        ...completeBundle(),
        "fused.ply": ordinaryPointPly(),
      }),
    );
    if (result.sourceFacts.state !== "available") {
      throw new Error("expected available V7 facts");
    }

    const factTamper = structuredClone(result.sourceFacts);
    const factBundle = factTamper.potreeBundles[0];
    if (factBundle?.facts === null || factBundle?.facts === undefined) {
      throw new Error("expected established Potree facts");
    }
    factBundle.facts.metadata.pointCount += 1;
    const factRedigested = redigest(
      factTamper,
      FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7_DIGEST_DOMAIN,
    );
    expect(FoundryUniversalSourceFactsV7Schema.safeParse(factRedigested).success)
      .toBe(false);

    const pathTamper = structuredClone(result.sourceFacts);
    const pathBundle = pathTamper.potreeBundles[0];
    const pathMember = pathBundle?.members[0];
    if (pathBundle === undefined || pathMember === undefined) {
      throw new Error("expected exact Potree member identities");
    }
    pathMember.path = "wrong/metadata.json";
    pathBundle.bundleSha256 = domainSeparatedSha256(
      FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN,
      toCanonicalJson({
        bundleRoot: pathBundle.bundleRoot,
        members: pathBundle.members,
      }),
    );
    expect(FoundryPotreeV2BundleAssetV7Schema.safeParse(pathBundle).success)
      .toBe(false);

    const overlapTamper = structuredClone(result.sourceFacts);
    if (overlapTamper.inherited.state !== "available") {
      throw new Error("expected available inherited V6 facts");
    }
    const inheritedAsset = overlapTamper.inherited.assets[0];
    if (inheritedAsset === undefined) throw new Error("expected point PLY asset");
    inheritedAsset.source.path = "model/metadata.json";
    overlapTamper.inherited = redigest(
      overlapTamper.inherited,
      FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN,
    );
    const overlapRedigested = redigest(
      overlapTamper,
      FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7_DIGEST_DOMAIN,
    );
    expect(
      FoundryUniversalSourceFactsV7Schema.safeParse(overlapRedigested).success,
    ).toBe(false);
  });

  it("binds non-established inspections to the frozen failure registry", async () => {
    const result = await inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot(completeBundle(metadata(2), oneLeafHierarchy(1))),
    );
    if (result.sourceFacts.state !== "available") {
      throw new Error("expected available V7 facts");
    }
    const bundle = result.sourceFacts.potreeBundles[0];
    if (bundle?.inspection.state !== "facts_not_established") {
      throw new Error("expected a non-established Potree bundle");
    }

    const fakeCode = structuredClone(bundle) as Record<string, unknown>;
    fakeCode.inspection = {
      state: "facts_not_established",
      category: "unsupported_container",
      code: "FAKE_STABLE_CODE",
      coverage: "none",
    };
    expect(FoundryPotreeV2BundleAssetV7Schema.safeParse(fakeCode).success)
      .toBe(false);

    const wrongCategory = structuredClone(bundle) as Record<string, unknown>;
    wrongCategory.inspection = {
      state: "facts_not_established",
      category: "resource_limit",
      code: "POTREE_V2_OCTREE_LENGTH_MISMATCH",
      coverage: "none",
    };
    expect(FoundryPotreeV2BundleAssetV7Schema.safeParse(wrongCategory).success)
      .toBe(false);

    const cancelled = structuredClone(bundle) as Record<string, unknown>;
    cancelled.inspection = {
      state: "facts_not_established",
      category: "parse_failure",
      code: "POTREE_V2_INSPECTION_CANCELLED",
      coverage: "none",
    };
    expect(FoundryPotreeV2BundleAssetV7Schema.safeParse(cancelled).success)
      .toBe(false);
  });

  it("retains the inherited atomic XBIN stop and fails closed on cancellation", async () => {
    const blocked = await inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot({
        ...completeBundle(),
        "vendor.xbin": Buffer.from([1, 2, 3, 4]),
      }),
    );
    expect(blocked.sourceFacts).toMatchObject({
      state: "unavailable",
      potreeBundles: [],
      summary: {
        potreeBundleCount: 0,
        targetedMemberFileCount: 0,
        blockedSourceCount: 1,
      },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(inspectUniversalIntakeWithSourceFactsV7(
      await sourceRoot(completeBundle()),
      { signal: controller.signal },
    )).rejects.toMatchObject({
      name: "FoundryIntegrityError",
      code: "INTAKE_CANCELLED",
    });
  });

  it("exports the V7 operator surface without raw artifact issuers", async () => {
    const entrypoint = await import("../index.js");
    expect(entrypoint.inspectUniversalIntakeWithSourceFactsV7).toBeTypeOf(
      "function",
    );
    expect(entrypoint.FoundryUniversalSourceFactsV7Schema).toBeDefined();
    expect(entrypoint.serializeUniversalSourceFactsV7Artifact).toBeTypeOf(
      "function",
    );
    expect(entrypoint).not.toHaveProperty(
      "createUniversalSourceFactsV7ArtifactFromReceipt",
    );
    expect(entrypoint).not.toHaveProperty(
      "createPotreeV2SourceFactsCollector",
    );
  });
});

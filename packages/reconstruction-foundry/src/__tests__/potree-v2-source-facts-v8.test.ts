import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { inspectUniversalIntakeWithSourceFactsV7 } from
  "../intake-receipt.js";
import {
  FoundryPotreeV2PointValueFactsSchema,
  FoundryPotreeV2PointValuesOutcomeSchema,
  inspectPotreeV2PointValuesFromBuffers,
  type FoundryPotreeV2PointValuesOutcome,
} from "../potree-v2-point-values.js";
import {
  FOUNDRY_POTREE_V2_UNKNOWNS,
  type FoundryUniversalSourceFactsV7,
} from "../source-facts-v7.js";
import {
  FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8_DIGEST_DOMAIN,
  FoundryUniversalSourceFactsV8Schema,
  createUniversalSourceFactsV8ArtifactFromV7,
  serializeUniversalSourceFactsV8Artifact,
  type FoundryUniversalSourceFactsV8,
} from "../source-facts-v8.js";

const roots: string[] = [];

afterAll(async () => {
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
    description: "deterministic Potree V8 fixture",
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

function pointRecord(
  x: number,
  y: number,
  z: number,
  intensity: number,
  opaqueVendorByte: number,
): Buffer {
  const record = Buffer.alloc(14);
  record.writeInt32LE(x, 0);
  record.writeInt32LE(y, 4);
  record.writeInt32LE(z, 8);
  record.writeUInt8(intensity, 12);
  record.writeUInt8(opaqueVendorByte, 13);
  return record;
}

function octree(): Buffer {
  return Buffer.concat([
    pointRecord(1_000, 2_000, 3_000, 32, 20),
    pointRecord(4_000, 5_000, 6_000, 224, 100),
  ]);
}

function completeBundle(
  bundleRoot: string,
): Readonly<Record<string, Buffer>> {
  return {
    [`${bundleRoot}/metadata.json`]: metadata(),
    [`${bundleRoot}/hierarchy.bin`]: oneLeafHierarchy(),
    [`${bundleRoot}/octree.bin`]: octree(),
  };
}

async function sourceRoot(
  files: Readonly<Record<string, Buffer>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-potree-v8-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return root;
}

async function v7For(
  files: Readonly<Record<string, Buffer>>,
): Promise<FoundryUniversalSourceFactsV7> {
  return (await inspectUniversalIntakeWithSourceFactsV7(
    await sourceRoot(files),
  )).sourceFacts;
}

function establishedBundle(
  facts: FoundryUniversalSourceFactsV7,
  bundleRoot = "model",
) {
  if (facts.state !== "available") {
    throw new Error("expected available V7 facts");
  }
  const bundle = facts.potreeBundles.find(
    (candidate) => candidate.bundleRoot === bundleRoot,
  );
  if (bundle?.inspection.state !== "established") {
    throw new Error(`expected established V7 bundle ${bundleRoot}`);
  }
  return bundle;
}

function inspectValues(
  facts: FoundryUniversalSourceFactsV7,
  bundleRoot = "model",
  octreeBytes: Uint8Array = octree(),
): FoundryPotreeV2PointValuesOutcome {
  const result = inspectPotreeV2PointValuesFromBuffers({
    bundle: establishedBundle(facts, bundleRoot),
    hierarchyBytes: oneLeafHierarchy(),
    octreeBytes,
    signal: new AbortController().signal,
  });
  return FoundryPotreeV2PointValuesOutcomeSchema.parse(result.outcome);
}

function redigest(
  artifact: FoundryUniversalSourceFactsV8,
): FoundryUniversalSourceFactsV8 {
  const { factsSha256: _factsSha256, ...payload } = artifact;
  return {
    ...artifact,
    factsSha256: domainSeparatedSha256(
      FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

let positiveV7: FoundryUniversalSourceFactsV7;
let positiveOutcome: FoundryPotreeV2PointValuesOutcome;
let failureOutcome: FoundryPotreeV2PointValuesOutcome;
let unavailableV7: FoundryUniversalSourceFactsV7;
let structurallyFailedV7: FoundryUniversalSourceFactsV7;
let twoBundleV7: FoundryUniversalSourceFactsV7;
let twoBundleOutcomes: FoundryPotreeV2PointValuesOutcome[];

beforeAll(async () => {
  positiveV7 = await v7For(completeBundle("model"));
  positiveOutcome = inspectValues(positiveV7);

  const changedOctree = Buffer.from(octree());
  changedOctree[0] = (changedOctree[0] ?? 0) ^ 0xff;
  failureOutcome = inspectValues(positiveV7, "model", changedOctree);

  unavailableV7 = await v7For({
    ...completeBundle("model"),
    "vendor.xbin": Buffer.from([1, 2, 3, 4]),
  });
  structurallyFailedV7 = await v7For({
    "model/metadata.json": Buffer.from("{", "utf8"),
    "model/hierarchy.bin": oneLeafHierarchy(),
    "model/octree.bin": octree(),
  });
  twoBundleV7 = await v7For({
    ...completeBundle("alpha"),
    ...completeBundle("beta"),
  });
  twoBundleOutcomes = [
    inspectValues(twoBundleV7, "alpha"),
    inspectValues(twoBundleV7, "beta"),
  ];
});

describe("Potree v2 Source Facts V8 immutable wrapper", () => {
  it("issues deterministic established evidence and resolves exactly one V7 unknown", () => {
    const first = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const second = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [structuredClone(positiveOutcome)],
    );

    expect(first).toEqual(second);
    expect(serializeUniversalSourceFactsV8Artifact(first)).toBe(
      serializeUniversalSourceFactsV8Artifact(second),
    );
    expect(first.inherited).toEqual(positiveV7);
    expect(first).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v8",
      state: "available",
      inheritedFactsSha256: positiveV7.factsSha256,
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        decodedGeometry: "bounded_numeric_observation",
        preview: "local_diagnostic_only",
        networkAccess: "none",
        externalProcess: "none",
        authority: "none",
        rights: "not_evaluated",
        accuracy: "not_evaluated",
        registration: "not_evaluated",
      },
      summary: {
        potreeBundleCount: 1,
        structurallyEstablishedPotreeBundleCount: 1,
        pointValueBundleCount: 1,
        pointValueEstablishedBundleCount: 1,
        pointValueFactsNotEstablishedBundleCount: 0,
        decodedRecordCount: 2,
        previewImageCount: 12,
        resolvedPotreeUnknownCount: 1,
        remainingPotreeUnknownCount: FOUNDRY_POTREE_V2_UNKNOWNS.length - 1,
      },
      pointValueBundles: [{
        bundleRoot: "model",
        pointValues: {
          state: "established",
          category: "established",
          code: "POTREE_V2_POINT_VALUES_ESTABLISHED",
          coverage: "all_records_numeric_values_and_deterministic_previews",
        },
        resolvedUnknownCodes: [
          FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
        ],
        remainingUnknownCodes: FOUNDRY_POTREE_V2_UNKNOWNS
          .slice(1)
          .map((unknown) => unknown.code),
      }],
    });
    if (positiveOutcome.state !== "established") {
      throw new Error("expected established point-value fixture");
    }
    expect(first.summary.qualityWarningCount).toBe(
      positiveOutcome.facts.qualityWarnings.length,
    );
    expect(FoundryUniversalSourceFactsV8Schema.parse(first)).toEqual(first);
  });

  it("retains the inherited unavailable state with no partial V8 overlay", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(unavailableV7);
    expect(artifact).toMatchObject({
      state: "unavailable",
      inherited: unavailableV7,
      pointValueBundles: [],
      summary: {
        potreeBundleCount: 0,
        pointValueBundleCount: 0,
        decodedRecordCount: 0,
        previewImageCount: 0,
        resolvedPotreeUnknownCount: 0,
        remainingPotreeUnknownCount: 0,
      },
    });
    expect(() => createUniversalSourceFactsV8ArtifactFromV7(
      unavailableV7,
      [positiveOutcome],
    )).toThrowError(/cannot attach point-value evidence/iu);
  });

  it("retains a low-level failure without resolving any V7 unknown", () => {
    expect(failureOutcome).toMatchObject({
      state: "facts_not_established",
      coverage: "none",
      facts: null,
    });
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [failureOutcome],
    );
    expect(artifact).toMatchObject({
      summary: {
        pointValueEstablishedBundleCount: 0,
        pointValueFactsNotEstablishedBundleCount: 1,
        decodedRecordCount: 0,
        previewImageCount: 0,
        qualityWarningCount: 0,
        resolvedPotreeUnknownCount: 0,
        remainingPotreeUnknownCount: FOUNDRY_POTREE_V2_UNKNOWNS.length,
      },
      pointValueBundles: [{
        resolvedUnknownCodes: [],
        remainingUnknownCodes: FOUNDRY_POTREE_V2_UNKNOWNS.map(
          (unknown) => unknown.code,
        ),
      }],
    });
  });

  it("does not create overlays for V7 structural failures", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      structurallyFailedV7,
    );
    expect(artifact).toMatchObject({
      state: "available",
      summary: {
        potreeBundleCount: 1,
        structurallyEstablishedPotreeBundleCount: 0,
        pointValueBundleCount: 0,
        resolvedPotreeUnknownCount: 0,
        remainingPotreeUnknownCount: FOUNDRY_POTREE_V2_UNKNOWNS.length,
      },
      pointValueBundles: [],
    });
  });

  it("rejects missing and extra point-value result sets", () => {
    expect(() => createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
    )).toThrowError(/one point-value outcome/iu);
    expect(() => createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome, positiveOutcome],
    )).toThrowError(/one point-value outcome/iu);
  });

  it("rejects an outcome bound to another exact bundle", async () => {
    const otherV7 = await v7For(completeBundle("other"));
    const otherOutcome = inspectValues(otherV7, "other");
    expect(() => createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [otherOutcome],
    )).toThrowError(/does not match its exact V7 bundle identity/iu);
  });

  it("canonicalizes issuer input order and rejects a redigested artifact reorder", () => {
    const canonical = createUniversalSourceFactsV8ArtifactFromV7(
      twoBundleV7,
      [...twoBundleOutcomes].reverse(),
    );
    expect(canonical.pointValueBundles.map((bundle) => bundle.bundleRoot))
      .toEqual(["alpha", "beta"]);

    const reordered = structuredClone(canonical);
    reordered.pointValueBundles.reverse();
    expect(FoundryUniversalSourceFactsV8Schema.safeParse(
      redigest(reordered),
    ).success).toBe(false);
  });

  it("rejects ordinary digest tampering", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const tampered = structuredClone(artifact);
    tampered.summary.decodedRecordCount += 1;
    expect(FoundryUniversalSourceFactsV8Schema.safeParse(tampered).success)
      .toBe(false);
  });

  it("rejects self-redigested unknown and summary contradictions", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const unknownTamper = structuredClone(artifact);
    const overlay = unknownTamper.pointValueBundles[0];
    if (overlay === undefined) throw new Error("expected one V8 overlay");
    overlay.resolvedUnknownCodes = [];
    overlay.remainingUnknownCodes = FOUNDRY_POTREE_V2_UNKNOWNS.map(
      (unknown) => unknown.code,
    );
    unknownTamper.summary.resolvedPotreeUnknownCount = 0;
    unknownTamper.summary.remainingPotreeUnknownCount =
      FOUNDRY_POTREE_V2_UNKNOWNS.length;
    expect(FoundryUniversalSourceFactsV8Schema.safeParse(
      redigest(unknownTamper),
    ).success).toBe(false);

    const summaryTamper = structuredClone(artifact);
    summaryTamper.summary.previewImageCount += 1;
    expect(FoundryUniversalSourceFactsV8Schema.safeParse(
      redigest(summaryTamper),
    ).success).toBe(false);
  });

  it("rejects a forged low-level code/category correlation after redigest", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const forged = structuredClone(artifact);
    const pointValues = forged.pointValueBundles[0]?.pointValues;
    if (pointValues === undefined) throw new Error("expected point-value facts");
    Reflect.set(pointValues, "category", "validation_failure");
    expect(FoundryUniversalSourceFactsV8Schema.safeParse(
      redigest(forged),
    ).success).toBe(false);
  });

  it("rejects self-redigested nested bundle identity contradictions", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    for (const field of ["bundleRoot", "bundleSha256"] as const) {
      const forged = structuredClone(artifact);
      const pointValues = forged.pointValueBundles[0]?.pointValues;
      if (pointValues?.state !== "established") {
        throw new Error("expected established point-value facts");
      }
      Reflect.set(
        pointValues.facts,
        field,
        field === "bundleRoot" ? "another-root" : "f".repeat(64),
      );
      expect(FoundryUniversalSourceFactsV8Schema.safeParse(
        redigest(forged),
      ).success).toBe(false);
    }
  });

  it("rejects self-redigested byte-distribution contradictions", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const mutations: Array<(value: FoundryUniversalSourceFactsV8) => void> = [
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        Reflect.set(pointValues.facts.intensity, "byteOffset", 13);
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        Reflect.set(pointValues.facts.opaqueVendorByte, "byteOffset", 12);
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        pointValues.facts.intensity.observedMin += 1;
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        pointValues.facts.opaqueVendorByte.observedMax -= 1;
      },
    ];
    for (const mutate of mutations) {
      const forged = structuredClone(artifact);
      mutate(forged);
      expect(FoundryUniversalSourceFactsV8Schema.safeParse(
        redigest(forged),
      ).success).toBe(false);
    }
  });

  it("rejects self-redigested preview registry contradictions", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const mutations: Array<(value: FoundryUniversalSourceFactsV8) => void> = [
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        const image = pointValues.facts.previews.images[0];
        if (image === undefined) throw new Error("fixture");
        Reflect.set(
          image,
          "projectedAxes",
          [0, 2],
        );
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        const image = pointValues.facts.previews.images[0];
        if (image === undefined) throw new Error("fixture");
        Reflect.set(
          image,
          "colorMap",
          "raw_uint8_grayscale_v1",
        );
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        const image = pointValues.facts.previews.images[0];
        if (image === undefined) throw new Error("fixture");
        Reflect.set(
          image,
          "fileName",
          "potree-v2-position-0-1.png",
        );
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        const first = pointValues.facts.previews.images[0];
        const second = pointValues.facts.previews.images[1];
        if (first === undefined || second === undefined) throw new Error("fixture");
        pointValues.facts.previews.images[0] = second;
        pointValues.facts.previews.images[1] = first;
      },
    ];
    for (const mutate of mutations) {
      const forged = structuredClone(artifact);
      mutate(forged);
      expect(FoundryUniversalSourceFactsV8Schema.safeParse(
        redigest(forged),
      ).success).toBe(false);
    }
  });

  it("rejects self-redigested exact-profile and decode equations", () => {
    const artifact = createUniversalSourceFactsV8ArtifactFromV7(
      positiveV7,
      [positiveOutcome],
    );
    const mutations: Array<(value: FoundryUniversalSourceFactsV8) => void> = [
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (
          pointValues?.state !== "established" ||
          pointValues.facts.deepProfile.state !== "performed"
        ) throw new Error("fixture");
        pointValues.facts.deepProfile.uniquePositionCount -= 1;
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (
          pointValues?.state !== "established" ||
          pointValues.facts.deepProfile.state !== "performed"
        ) throw new Error("fixture");
        const axis = pointValues.facts.deepProfile.rawPositionQuantilesByAxis[0];
        axis[1] = axis[0] - 1;
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (
          pointValues?.state !== "established" ||
          pointValues.facts.deepProfile.state !== "performed"
        ) throw new Error("fixture");
        pointValues.facts.deepProfile.decodedPositionQuantilesByAxis[0][4] -=
          0.0001;
      },
      (value) => {
        const pointValues = value.pointValueBundles[0]?.pointValues;
        if (pointValues?.state !== "established") throw new Error("fixture");
        pointValues.facts.position.decodedMin[0] -= 0.0001;
      },
    ];
    for (const mutate of mutations) {
      const forged = structuredClone(artifact);
      mutate(forged);
      expect(FoundryUniversalSourceFactsV8Schema.safeParse(
        redigest(forged),
      ).success).toBe(false);
    }
  });

  it("does not warn for a small all-unique point set", () => {
    if (positiveOutcome.state !== "established") {
      throw new Error("expected established point-value fixture");
    }
    expect(positiveOutcome.facts.recordCount).toBe(2);
    expect(positiveOutcome.facts.deepProfile).toMatchObject({
      state: "performed",
      maximumPositionMultiplicity: 1,
      positionsWithMultiplicity: 0,
    });
    expect(positiveOutcome.facts.qualityWarnings).toEqual([]);
  });

  it("derives the duplicate warning at the exact excess-record boundary", () => {
    if (positiveOutcome.state !== "established") {
      throw new Error("expected established point-value fixture");
    }
    const establishedFacts = positiveOutcome.facts;
    const boundaryFacts = (recordCount: number, warning: boolean) => {
      const facts = structuredClone(establishedFacts);
      facts.recordCount = recordCount;
      facts.position.finiteComponentCount = recordCount * 3;
      facts.intensity.histogram.fill(0);
      facts.intensity.histogram[32] = recordCount;
      facts.intensity.observedMin = 32;
      facts.intensity.observedMax = 32;
      facts.intensity.sum = recordCount * 32;
      facts.intensity.distinctCount = 1;
      facts.opaqueVendorByte.histogram.fill(0);
      facts.opaqueVendorByte.histogram[20] = recordCount;
      facts.opaqueVendorByte.observedMin = 20;
      facts.opaqueVendorByte.observedMax = 20;
      facts.opaqueVendorByte.sum = recordCount * 20;
      facts.opaqueVendorByte.distinctCount = 1;
      if (facts.deepProfile.state !== "performed") throw new Error("fixture");
      facts.deepProfile.uniquePositionCount = recordCount - 1;
      facts.deepProfile.duplicatePositionRecordCount = 1;
      facts.deepProfile.positionsWithMultiplicity = 1;
      facts.deepProfile.maximumPositionMultiplicity = 2;
      facts.deepProfile.uniqueFullRecordCount = recordCount;
      facts.deepProfile.duplicateFullRecordCount = 0;
      facts.qualityWarnings = warning
        ? ["exact_position_duplicate_concentration_observed"]
        : [];
      return facts;
    };

    expect(FoundryPotreeV2PointValueFactsSchema.safeParse(
      boundaryFacts(100, true),
    ).success).toBe(true);
    expect(FoundryPotreeV2PointValueFactsSchema.safeParse(
      boundaryFacts(100, false),
    ).success).toBe(false);
    expect(FoundryPotreeV2PointValueFactsSchema.safeParse(
      boundaryFacts(101, false),
    ).success).toBe(true);
    expect(FoundryPotreeV2PointValueFactsSchema.safeParse(
      boundaryFacts(101, true),
    ).success).toBe(false);
  });
});

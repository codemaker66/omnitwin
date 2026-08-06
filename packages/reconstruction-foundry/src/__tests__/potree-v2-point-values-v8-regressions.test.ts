import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectUniversalIntakeWithSourceFactsV7 } from
  "../intake-receipt.js";
import {
  inspectPotreeV2PointValuesFromBuffers,
  type InspectPotreeV2PointValuesResult,
} from "../potree-v2-point-values.js";
import type { FoundryPotreeV2BundleAssetV7 } from
  "../source-facts-v7.js";

interface Fixture {
  readonly metadata: Buffer;
  readonly hierarchy: Buffer;
  readonly octree: Buffer;
}

interface HierarchyRecord {
  readonly type: 0 | 1;
  readonly childMask: number;
  readonly pointCount: number;
  readonly byteOffset: number;
}

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function attribute(
  name: "position" | "intensity" | "lcc prediction",
  positionMax: readonly [number, number, number],
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
    max: position ? positionMax : [255],
    scale: position ? [1, 1, 1] : [1],
    offset: position ? [0, 0, 0] : [0],
  };
}

function metadata(
  pointCount: number,
  hierarchyByteLength: number,
  positionMax: readonly [number, number, number] = [10, 20, 30],
): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "focused V8 point-value regression fixture",
    points: pointCount,
    projection: "",
    hierarchy: {
      firstChunkSize: hierarchyByteLength,
      stepSize: 4,
      depth: hierarchyByteLength === 22 ? 0 : 1,
    },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position", positionMax),
      attribute("intensity", positionMax),
      attribute("lcc prediction", positionMax),
    ],
  }), "utf8");
}

function hierarchyRecord(record: HierarchyRecord): Buffer {
  const bytes = Buffer.alloc(22);
  bytes.writeUInt8(record.type, 0);
  bytes.writeUInt8(record.childMask, 1);
  bytes.writeUInt32LE(record.pointCount, 2);
  bytes.writeBigUInt64LE(BigInt(record.byteOffset), 6);
  bytes.writeBigUInt64LE(BigInt(record.pointCount * 14), 14);
  return bytes;
}

function pointRecord(
  x: number,
  y: number,
  z: number,
  intensity = 32,
  opaqueVendorByte = 20,
): Buffer {
  const bytes = Buffer.alloc(14);
  bytes.writeInt32LE(x, 0);
  bytes.writeInt32LE(y, 4);
  bytes.writeInt32LE(z, 8);
  bytes.writeUInt8(intensity, 12);
  bytes.writeUInt8(opaqueVendorByte, 13);
  return bytes;
}

function rootLeafFixture(
  record = pointRecord(1_000, 2_000, 3_000),
  positionMax: readonly [number, number, number] = [10, 20, 30],
): Fixture {
  const hierarchy = hierarchyRecord({
    type: 1,
    childMask: 0,
    pointCount: 1,
    byteOffset: 0,
  });
  return {
    metadata: metadata(1, hierarchy.length, positionMax),
    hierarchy,
    octree: record,
  };
}

function rootAndChildZeroFixture(childRecord: Buffer): Fixture {
  const hierarchy = Buffer.concat([
    hierarchyRecord({
      type: 0,
      childMask: 0b00000001,
      pointCount: 1,
      byteOffset: 0,
    }),
    hierarchyRecord({
      type: 1,
      childMask: 0,
      pointCount: 1,
      byteOffset: 14,
    }),
  ]);
  return {
    metadata: metadata(2, hierarchy.length),
    hierarchy,
    octree: Buffer.concat([
      pointRecord(1_000, 2_000, 3_000, 16, 20),
      childRecord,
    ]),
  };
}

async function establishBundle(
  fixture: Fixture,
): Promise<FoundryPotreeV2BundleAssetV7> {
  const root = await mkdtemp(join(tmpdir(), "foundry-potree-v8-regression-"));
  roots.push(root);
  for (const [relativePath, bytes] of Object.entries({
    "model/metadata.json": fixture.metadata,
    "model/hierarchy.bin": fixture.hierarchy,
    "model/octree.bin": fixture.octree,
  })) {
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }

  const facts = (await inspectUniversalIntakeWithSourceFactsV7(root)).sourceFacts;
  if (facts.state !== "available") {
    throw new Error("expected V7 source facts to be available");
  }
  const bundle = facts.potreeBundles.find(
    (candidate) => candidate.bundleRoot === "model",
  );
  if (bundle?.inspection.state !== "established") {
    throw new Error("expected V7 intake to establish exact fixture identities");
  }
  return bundle;
}

function inspectExact(
  bundle: FoundryPotreeV2BundleAssetV7,
  fixture: Fixture,
): InspectPotreeV2PointValuesResult {
  return inspectPotreeV2PointValuesFromBuffers({
    bundle,
    hierarchyBytes: fixture.hierarchy,
    octreeBytes: fixture.octree,
    signal: new AbortController().signal,
  });
}

describe("Potree v2 point-value V8 product-correctness regressions", () => {
  it("returns the canonical invalid-bundle outcome for null, undefined, and primitive inputs without throwing", () => {
    const invalidBundles: unknown[] = [
      null,
      undefined,
      false,
      0,
      "model",
      1n,
      Symbol("invalid bundle"),
    ];

    for (const bundle of invalidBundles) {
      let result: InspectPotreeV2PointValuesResult | undefined;
      expect(() => {
        result = inspectPotreeV2PointValuesFromBuffers({
          bundle: bundle as FoundryPotreeV2BundleAssetV7,
          hierarchyBytes: new Uint8Array(),
          octreeBytes: new Uint8Array(),
          signal: new AbortController().signal,
        });
      }).not.toThrow();
      expect(result?.outcome).toMatchObject({
        state: "facts_not_established",
        category: "validation_failure",
        code: "POTREE_V2_POINT_VALUES_BUNDLE_INVALID",
        coverage: "none",
        facts: null,
      });
      expect(result?.previewFiles).toEqual([]);
    }
  });

  it("rejects a mismatched non-Buffer byteLength before attempting conversion", async () => {
    const fixture = rootLeafFixture();
    const bundle = await establishBundle(fixture);
    let conversionAttempted = false;
    const poisonedOctree = new Proxy(
      { byteLength: fixture.octree.byteLength + 1 },
      {
        get(target, property, receiver) {
          if (property === "byteLength") {
            return Reflect.get(target, property, receiver);
          }
          conversionAttempted = true;
          throw new Error(`unexpected conversion access: ${String(property)}`);
        },
      },
    ) as Uint8Array;

    const result = inspectPotreeV2PointValuesFromBuffers({
      bundle,
      hierarchyBytes: fixture.hierarchy,
      octreeBytes: poisonedOctree,
      signal: new AbortController().signal,
    });

    expect(conversionAttempted).toBe(false);
    expect(result.outcome).toMatchObject({
      state: "facts_not_established",
      category: "validation_failure",
      code: "POTREE_V2_POINT_VALUES_MEMBER_IDENTITY_MISMATCH",
    });
    expect(result.previewFiles).toEqual([]);
  });

  it("rejects a globally valid child0 record that lies outside the child node box", async () => {
    const fixture = rootAndChildZeroFixture(
      pointRecord(6_000, 5_000, 5_000, 64, 40),
    );
    const bundle = await establishBundle(fixture);
    const result = inspectExact(bundle, fixture);

    expect(result.outcome).toMatchObject({
      state: "facts_not_established",
      category: "validation_failure",
      code: "POTREE_V2_POINT_VALUES_NODE_BOUNDS_VIOLATION",
    });
    expect(result.previewFiles).toEqual([]);
  });

  it("rejects a root-leaf record inside the global box but above the declared attribute maximum", async () => {
    const fixture = rootLeafFixture(
      pointRecord(6_000, 5_000, 5_000, 64, 40),
      [5, 20, 30],
    );
    const bundle = await establishBundle(fixture);
    const result = inspectExact(bundle, fixture);

    expect(result.outcome).toMatchObject({
      state: "facts_not_established",
      category: "validation_failure",
      code: "POTREE_V2_POINT_VALUES_DECLARED_RANGE_VIOLATION",
    });
    expect(result.previewFiles).toEqual([]);
  });

  it("accepts a child0 record exactly one declared scale unit beyond the child boundary", async () => {
    const fixture = rootAndChildZeroFixture(
      pointRecord(5_001, 5_000, 5_000, 64, 40),
    );
    const bundle = await establishBundle(fixture);
    const result = inspectExact(bundle, fixture);

    expect(result.outcome).toMatchObject({
      state: "established",
      category: "established",
      code: "POTREE_V2_POINT_VALUES_ESTABLISHED",
      facts: {
        recordCount: 2,
        position: {
          decodedMax: [5.001, 5, 5],
          nodeBoundsViolationCount: 0,
          toleranceByAxis: [0.001, 0.001, 0.001],
        },
      },
    });
    expect(result.previewFiles).toHaveLength(12);
  }, 30_000);
});

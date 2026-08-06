import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectUniversalIntakeWithSourceFactsV8,
} from "../intake-receipt.js";
import {
  FoundryUniversalSourceFactsV8Schema,
  serializeUniversalSourceFactsV8Artifact,
} from "../source-facts-v8.js";

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

function metadata(pointCount: number): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "deterministic Potree V8 pipeline fixture",
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

function oneLeafHierarchy(pointCount: number): Buffer {
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0);
  hierarchy.writeUInt8(0, 1);
  hierarchy.writeUInt32LE(pointCount, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(BigInt(pointCount * 14), 14);
  return hierarchy;
}

function pointRecord(
  position: readonly [number, number, number],
  intensity: number,
  opaqueVendorByte: number,
): Buffer {
  const record = Buffer.alloc(14);
  record.writeInt32LE(position[0], 0);
  record.writeInt32LE(position[1], 4);
  record.writeInt32LE(position[2], 8);
  record.writeUInt8(intensity, 12);
  record.writeUInt8(opaqueVendorByte, 13);
  return record;
}

async function sourceRoot(octreeBytes: Buffer): Promise<string> {
  const files = {
    "model/metadata.json": metadata(octreeBytes.length / 14),
    "model/hierarchy.bin": oneLeafHierarchy(octreeBytes.length / 14),
    "model/octree.bin": octreeBytes,
    "notes.txt": Buffer.from("not part of the Potree bundle", "utf8"),
  } as const;
  const root = await mkdtemp(join(tmpdir(), "foundry-potree-pipeline-v8-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return root;
}

describe("Potree v2 Source Facts V8 intake pipeline", () => {
  it("issues deterministic full-value evidence and private PNG sidecars", async () => {
    const root = await sourceRoot(Buffer.concat([
      pointRecord([0, 0, 0], 10, 20),
      pointRecord([10_000, 20_000, 30_000], 255, 100),
    ]));
    const first = await inspectUniversalIntakeWithSourceFactsV8(root);
    const second = await inspectUniversalIntakeWithSourceFactsV8(root);

    expect(FoundryUniversalSourceFactsV8Schema.parse(first.sourceFacts)).toEqual(
      first.sourceFacts,
    );
    expect(serializeUniversalSourceFactsV8Artifact(first.sourceFacts)).toBe(
      serializeUniversalSourceFactsV8Artifact(second.sourceFacts),
    );
    expect(first.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v8",
      state: "available",
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        decodedGeometry: "bounded_numeric_observation",
        preview: "local_diagnostic_only",
        networkAccess: "none",
        authority: "none",
      },
      summary: {
        structurallyEstablishedPotreeBundleCount: 1,
        pointValueEstablishedBundleCount: 1,
        decodedRecordCount: 2,
        previewImageCount: 12,
        resolvedPotreeUnknownCount: 1,
        remainingPotreeUnknownCount: 9,
      },
      pointValueBundles: [{
        bundleRoot: "model",
        pointValues: {
          state: "established",
          category: "established",
          code: "POTREE_V2_POINT_VALUES_ESTABLISHED",
          coverage: "all_records_numeric_values_and_deterministic_previews",
          facts: {
            recordCount: 2,
            previews: { images: expect.any(Array) },
          },
        },
        resolvedUnknownCodes: ["POTREE_POINT_ATTRIBUTE_VALUES_UNKNOWN"],
      }],
    });
    expect(first.pointPreviewFiles).toHaveLength(12);
    expect(first.pointPreviewFiles.map((file) => ({
      bundleRoot: file.bundleRoot,
      bundleSha256: file.bundleSha256,
      viewId: file.viewId,
      mode: file.mode,
      fileName: file.fileName,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      sha256: file.sha256,
      bytes: file.bytes,
    }))).toEqual(second.pointPreviewFiles.map((file) => ({
      bundleRoot: file.bundleRoot,
      bundleSha256: file.bundleSha256,
      viewId: file.viewId,
      mode: file.mode,
      fileName: file.fileName,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      sha256: file.sha256,
      bytes: file.bytes,
    })));
    for (const file of first.pointPreviewFiles) {
      expect(file.mediaType).toBe("image/png");
      expect(file.bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(file.byteLength).toBe(file.bytes.length);
    }
  });

  it("records a declared-range contradiction without preview sidecars", async () => {
    const root = await sourceRoot(pointRecord([20_000, 0, 0], 10, 20));
    const result = await inspectUniversalIntakeWithSourceFactsV8(root);

    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: {
        pointValueEstablishedBundleCount: 0,
        pointValueFactsNotEstablishedBundleCount: 1,
        decodedRecordCount: 0,
        previewImageCount: 0,
        resolvedPotreeUnknownCount: 0,
        remainingPotreeUnknownCount: 10,
      },
      pointValueBundles: [{
        pointValues: {
          state: "facts_not_established",
          category: "validation_failure",
          coverage: "none",
          facts: null,
        },
        resolvedUnknownCodes: [],
      }],
    });
    expect(result.pointPreviewFiles).toEqual([]);
  });

  it("issues no artifact after cancellation", async () => {
    const root = await sourceRoot(pointRecord([0, 0, 0], 10, 20));
    const controller = new AbortController();
    controller.abort();
    await expect(inspectUniversalIntakeWithSourceFactsV8(
      root,
      { signal: controller.signal },
    )).rejects.toMatchObject({
      name: "FoundryIntegrityError",
      code: "INTAKE_CANCELLED",
    });
  });

  it("exports the V8 intake surface without raw issuers or buffer inspectors", async () => {
    const entrypoint = await import("../index.js");
    expect(entrypoint.inspectUniversalIntakeWithSourceFactsV8).toBeTypeOf(
      "function",
    );
    expect(entrypoint.FoundryUniversalSourceFactsV8Schema).toBeDefined();
    expect(entrypoint.serializeUniversalSourceFactsV8Artifact).toBeTypeOf(
      "function",
    );
    expect(entrypoint).not.toHaveProperty(
      "createUniversalSourceFactsV8ArtifactFromV7",
    );
    expect(entrypoint).not.toHaveProperty(
      "inspectPotreeV2PointValuesFromBuffers",
    );
    expect(entrypoint).not.toHaveProperty("preflightPotreeV2PointValues");
  });
});

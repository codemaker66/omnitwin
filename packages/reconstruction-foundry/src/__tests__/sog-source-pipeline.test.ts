import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFoundryInputFile } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import { inspectUniversalIntakeWithSourceFacts } from "../intake-receipt.js";
import { compileFoundryOperatorEvidenceChecklistV1 } from "../operator-evidence-checklist.js";
import { inspectStoredZipSogV2SourceFacts } from "../sog-source-facts.js";
import { createUniversalSourceFactsStreamCollector } from "../source-facts.js";
import { compileFoundrySourceReadinessMapV1 } from "../source-readiness.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function vp8l(width: number, height: number): Buffer {
  const widthValue = width - 1;
  const heightValue = height - 1;
  const data = Buffer.from([
    0x2f,
    widthValue & 0xff,
    ((widthValue >> 8) & 0x3f) | ((heightValue & 0x03) << 6),
    (heightValue >> 2) & 0xff,
    (heightValue >> 10) & 0x0f,
  ]);
  const chunk = Buffer.alloc(8 + data.length + 1);
  chunk.write("VP8L", 0, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  const output = Buffer.alloc(12 + chunk.length);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WEBP", 8, "ascii");
  chunk.copy(output, 12);
  return output;
}

function sogMeta(count: number, shBands?: 1 | 2 | 3): Buffer {
  const codebook = Array.from({ length: 256 }, (_, index) => index / 255);
  const value: Record<string, unknown> = {
    version: 2,
    asset: { generator: "pipeline-fixture" },
    count,
    antialias: false,
    means: {
      mins: [-2, -1, -3],
      maxs: [2, 3, 1],
      files: ["means_l.webp", "means_u.webp"],
    },
    scales: { codebook, files: ["scales.webp"] },
    quats: { files: ["quats.webp"] },
    sh0: { codebook, files: ["sh0.webp"] },
  };
  if (shBands !== undefined) {
    value.shN = {
      count: 65,
      bands: shBands,
      codebook,
      files: ["shN_centroids.webp", "shN_labels.webp"],
    };
  }
  return Buffer.from(JSON.stringify(value), "utf8");
}

function storedZip(
  entries: readonly { readonly name: string; readonly bytes: Buffer }[],
  signedDataDescriptors = false,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(signedDataDescriptors ? 0x0008 : 0, 6);
    local.writeUInt32LE(signedDataDescriptors ? 0 : checksum, 14);
    local.writeUInt32LE(signedDataDescriptors ? 0 : entry.bytes.length, 18);
    local.writeUInt32LE(signedDataDescriptors ? 0 : entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const descriptor = signedDataDescriptors ? Buffer.alloc(16) : Buffer.alloc(0);
    if (signedDataDescriptors) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(entry.bytes.length, 8);
      descriptor.writeUInt32LE(entry.bytes.length, 12);
    }
    localParts.push(local, name, entry.bytes, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(signedDataDescriptors ? 0x0008 : 0, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.bytes.length + descriptor.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function validSog(
  count = 4,
  options: { readonly shBands?: 1 | 2 | 3; readonly signedDataDescriptors?: boolean } = {},
): Buffer {
  const plane = vp8l(2, 2);
  const entries = [
    { name: "meta.json", bytes: sogMeta(count, options.shBands) },
    { name: "means_l.webp", bytes: plane },
    { name: "means_u.webp", bytes: plane },
    { name: "scales.webp", bytes: plane },
    { name: "quats.webp", bytes: plane },
    { name: "sh0.webp", bytes: plane },
  ];
  if (options.shBands !== undefined) {
    const centroidWidth = options.shBands === 1 ? 192 : options.shBands === 2 ? 512 : 960;
    entries.push(
      { name: "shN_centroids.webp", bytes: vp8l(centroidWidth, 2) },
      { name: "shN_labels.webp", bytes: plane },
    );
  }
  return storedZip(entries, options.signedDataDescriptors === true);
}

async function fixture(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-sog-pipeline-"));
  cleanup.push(root);
  await Promise.all(Object.entries(files).map(async ([name, bytes]) => {
    await writeFile(join(root, name), bytes);
  }));
  return root;
}

describe("SOG Source Facts V1 pipeline", () => {
  it("keeps signed-descriptor higher-order SH facts valid through the canonical V1 schema", async () => {
    const root = await fixture({
      "scene.sog": validSog(4, { shBands: 1, signedDataDescriptors: true }),
    });
    const inspected = await inspectUniversalIntakeWithSourceFacts(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { establishedCount: 1 },
      assets: [{
        inspection: { state: "established" },
        facts: {
          sphericalHarmonics: { higherOrderPresent: true, bands: 1, paletteCount: 65 },
          container: {
            entryCount: 8,
            dataDescriptorCount: 8,
            allDataDescriptorsVerified: true,
            localHeaderFieldsConsistentWithCentralDirectory: true,
          },
          planes: expect.arrayContaining([
            expect.objectContaining({ role: "shN_centroids", width: 192, height: 2 }),
          ]),
        },
      }],
    });
  });

  it("rejects a same-size SOG inspection outcome substituted across source digests", async () => {
    const inspectedBytes = validSog(3);
    const targetBytes = validSog(4);
    expect(inspectedBytes.length).toBe(targetBytes.length);
    const inspectedSha256 = createHash("sha256").update(inspectedBytes).digest("hex");
    const targetSha256 = createHash("sha256").update(targetBytes).digest("hex");
    expect(inspectedSha256).not.toBe(targetSha256);

    const root = await fixture({ "inspected.sog": inspectedBytes });
    const handle = await open(join(root, "inspected.sog"), "r");
    let substitutedInspection;
    try {
      substitutedInspection = await inspectStoredZipSogV2SourceFacts(
        handle,
        inspectedBytes.length,
        inspectedSha256,
      );
    } finally {
      await handle.close();
    }
    expect(substitutedInspection).toMatchObject({
      state: "established",
      sourceSha256: inspectedSha256,
      sourceSizeBytes: inspectedBytes.length,
    });

    const path = "target.sog";
    const collector = createUniversalSourceFactsStreamCollector(path);
    collector.observe(targetBytes, 0);
    const targetIdentity = {
      path,
      sizeBytes: targetBytes.length,
      sha256: targetSha256,
      detection: detectFoundryInputFile({
        relativePath: path,
        magicHex: targetBytes.subarray(0, 64).toString("hex"),
        boundedHeaderText: null,
      }),
    };
    let failure: unknown;
    try {
      collector.finalize(targetIdentity, { sogInspection: substitutedInspection });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_SOG_INSPECTION_SOURCE_MISMATCH",
    });
  });

  it("carries established stored-ZIP SOG v2 facts through readiness and the checklist", async () => {
    const root = await fixture({ "scene.sog": validSog() });
    const first = await inspectUniversalIntakeWithSourceFacts(root);
    const second = await inspectUniversalIntakeWithSourceFacts(root);
    expect(second).toEqual(first);
    expect(first.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v1",
      state: "available",
      summary: { receiptFileCount: 1, assetCount: 1, establishedCount: 1 },
      assets: [{
        source: { path: "scene.sog", inputType: "sog" },
        format: "sog",
        inspection: {
          state: "established",
          code: "SOG_V2_STORED_ZIP_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: {
          count: 4,
          encodedMeansRange: { mins: [-2, -1, -3], maxs: [2, 3, 1] },
          container: { entryCount: 6, allMemberCrc32Verified: true },
          sharedPerGaussianImage: { width: 2, height: 2, capacityPixels: 4 },
        },
      }],
    });
    if (first.sourceFacts.state !== "available") throw new Error("expected available Source Facts");
    expect(JSON.stringify(first.sourceFacts.assets[0]?.facts)).not.toContain(".webp");
    expect(first.sourceFacts.assets[0]?.unknowns.map((unknown) => unknown.code)).toHaveLength(10);

    const readiness = compileFoundrySourceReadinessMapV1({
      receipt: first.receipt,
      sourceFacts: first.sourceFacts,
    });
    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v1",
      state: "available",
      files: [{
        path: "scene.sog",
        status: "facts_established",
        inputType: "sog",
        format: "sog",
        laneIds: ["visual_scene_representation"],
      }],
    });
    if (readiness.state !== "available") throw new Error("expected available readiness");
    expect(readiness.gaps.map((gap) => gap.code)).not.toContain("OUTSIDE_SOURCE_FACTS_V1");
    expect(readiness.gaps.map((gap) => gap.code)).not.toContain("SOURCE_FACTS_NOT_ESTABLISHED");
    expect(readiness.lanes.find((lane) => lane.id === "visual_scene_representation")).toMatchObject({
      status: "all_observed_facts_established",
      counts: { observedFileCount: 1, factsEstablishedCount: 1, outsideSourceFactsV1Count: 0 },
    });

    const checklist = compileFoundryOperatorEvidenceChecklistV1({ readiness });
    if (checklist.state !== "available") throw new Error("expected available checklist");
    const evidenceCodes = checklist.items.map((item) => item.evidenceCode);
    expect(evidenceCodes.filter((code) => code.startsWith("SOG_"))).toHaveLength(10);
    expect(evidenceCodes).not.toContain("OUTSIDE_SOURCE_FACTS_V1");
    expect(evidenceCodes).not.toContain("SOURCE_FACTS_NOT_ESTABLISHED");
    expect(checklist.items.find((item) => item.evidenceCode === "SOG_PHYSICAL_BOUNDS_UNKNOWN")).toMatchObject({
      category: "bounded_inspection",
      affectedSources: [{ path: "scene.sog", readinessStatus: "facts_established" }],
    });
  });

  it("keeps malformed SOG as a targeted per-file facts gap", async () => {
    const root = await fixture({ "broken.sog": Buffer.from("not-a-zip", "ascii") });
    const inspected = await inspectUniversalIntakeWithSourceFacts(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        format: "sog",
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "SOG_ZIP_EOCD_NOT_FOUND",
          coverage: "none",
        },
        facts: null,
      }],
    });
    const readiness = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (readiness.state !== "available") throw new Error("expected available readiness");
    expect(readiness.files[0]).toMatchObject({ status: "facts_not_established", format: "sog" });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({ readiness });
    if (checklist.state !== "available") throw new Error("expected available checklist");
    expect(checklist.items.map((item) => item.evidenceCode)).toContain("SOURCE_FACTS_NOT_ESTABLISHED");
  });

  it("preserves the receipt-first XBIN block with zero partial SOG facts", async () => {
    const root = await fixture({
      "scene.sog": validSog(),
      "sealed.xbin": Buffer.from([0x58, 0x42, 0x49, 0x4e, 0x00]),
    });
    const inspected = await inspectUniversalIntakeWithSourceFacts(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "unavailable",
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      assets: [],
      affectedSources: [{ path: "sealed.xbin" }],
    });
  });
});

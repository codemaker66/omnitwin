import { createHash } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileFoundryOperatorEvidenceChecklistV1,
  serializeFoundryOperatorEvidenceChecklistV1,
} from "../operator-evidence-checklist.js";
import {
  FoundryOperatorEvidenceChecklistV2Schema,
  compileFoundryOperatorEvidenceChecklistV2,
  serializeFoundryOperatorEvidenceChecklistV2,
} from "../operator-evidence-checklist-v2.js";
import {
  inspectUniversalIntakeWithSourceFacts,
  inspectUniversalIntakeWithSourceFactsV2,
} from "../intake-receipt.js";
import {
  FOUNDRY_SPZ_UNKNOWNS,
  FoundryUniversalSourceFactsV2Schema,
  createUniversalSourceFactsV2StreamCollector,
  serializeUniversalSourceFactsV2Artifact,
} from "../source-facts-v2.js";
import { serializeUniversalSourceFactsArtifact } from "../source-facts.js";
import {
  compileFoundrySourceReadinessMapV1,
  serializeFoundrySourceReadinessMapV1,
} from "../source-readiness.js";
import {
  FoundrySourceReadinessMapV2Schema,
  compileFoundrySourceReadinessMapV2,
  serializeFoundrySourceReadinessMapV2,
} from "../source-readiness-v2.js";
import { inspectSpzSourceFacts } from "../spz-source-facts.js";

const roots: string[] = [];
const GOLDEN_LEGACY_V3_SPZ = Buffer.from(
  "1f8b080000000000000af3730f0e606660606061606060e06160101014121611151397909492969195935750545256515553d7d0d4d2d6d1d5d33730343236313533b7b0b4b2b6b1b5b37770747276717573f7f0f4f2f6f1f5f30f080c0a0e090d0b8f888c8a8e898d8b0700153d0c6360000000",
  "hex",
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function legacyV3Fixture(count = 4, extensionBytes: Buffer = Buffer.alloc(0)): Buffer {
  const coreEnd = 16 + count * 20;
  const bytes = Buffer.alloc(coreEnd + extensionBytes.length);
  bytes.writeUInt32LE(0x5053474e, 0);
  bytes.writeUInt32LE(3, 4);
  bytes.writeUInt32LE(count, 8);
  bytes.writeUInt8(0, 12);
  bytes.writeUInt8(12, 13);
  bytes.writeUInt8(extensionBytes.length > 0 ? 0x02 : 0, 14);
  for (let index = 16; index < coreEnd; index += 1) bytes[index] = index & 0xff;
  extensionBytes.copy(bytes, coreEnd);
  return gzipSync(bytes);
}

function extensionRecord(type: number, payload: Buffer): Buffer {
  const record = Buffer.alloc(8 + payload.length);
  record.writeUInt32LE(type, 0);
  record.writeUInt32LE(payload.length, 4);
  payload.copy(record, 8);
  return record;
}

function utf8Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function v4Fixture(count = 4): Buffer {
  const rawSizes = [count * 9, count, count * 3, count * 3, count * 4];
  const streams = rawSizes.map((size, streamIndex) => {
    const raw = Buffer.alloc(size, streamIndex + 1);
    return zstdCompressSync(raw);
  });
  const headerAndToc = Buffer.alloc(32 + streams.length * 16);
  headerAndToc.writeUInt32LE(0x5053474e, 0);
  headerAndToc.writeUInt32LE(4, 4);
  headerAndToc.writeUInt32LE(count, 8);
  headerAndToc.writeUInt8(0, 12);
  headerAndToc.writeUInt8(12, 13);
  headerAndToc.writeUInt8(streams.length, 15);
  headerAndToc.writeUInt32LE(32, 16);
  for (const [index, stream] of streams.entries()) {
    headerAndToc.writeBigUInt64LE(BigInt(stream.length), 32 + index * 16);
    headerAndToc.writeBigUInt64LE(BigInt(rawSizes[index] ?? 0), 32 + index * 16 + 8);
  }
  return Buffer.concat([headerAndToc, ...streams]);
}

async function sourceRoot(name: string, bytes: Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-spz-pipeline-"));
  roots.push(root);
  await writeFile(join(root, name), bytes);
  return root;
}

describe("SPZ Source Facts V2 pipeline", () => {
  for (const [label, fixture, expectedFormat] of [
    ["legacy v3", legacyV3Fixture, "spz_legacy_gzip"],
    ["current v4", v4Fixture, "spz_v4_zstd"],
  ] as const) {
    it(`carries established ${label} facts through V2 readiness and the checklist`, async () => {
      const root = await sourceRoot("scene.spz", fixture(4));
      const first = await inspectUniversalIntakeWithSourceFactsV2(root);
      const second = await inspectUniversalIntakeWithSourceFactsV2(root);
      expect(first.receipt).toEqual(second.receipt);
      expect(first.sourceFacts).toEqual(second.sourceFacts);
      expect(first.sourceFacts).toMatchObject({
        schemaVersion: "omnitwin.foundry.universal-source-facts.v2",
        state: "available",
        summary: {
          receiptFileCount: 1,
          assetCount: 1,
          establishedCount: 1,
          factsNotEstablishedCount: 0,
          untargetedFileCount: 0,
        },
        assets: [{
          source: { path: "scene.spz", inputType: "spz" },
          format: "spz",
          inspection: { state: "established", code: "SPZ_FORMAT_FACTS_ESTABLISHED" },
          facts: { format: expectedFormat, count: 4 },
        }],
      });
      if (first.sourceFacts.state !== "available") throw new Error("expected available V2 facts");
      expect(first.sourceFacts.assets[0]?.unknowns.map((unknown) => unknown.code)).toHaveLength(10);
      expect(FoundryUniversalSourceFactsV2Schema.parse(first.sourceFacts)).toEqual(first.sourceFacts);

      const readiness = compileFoundrySourceReadinessMapV2(first);
      expect(readiness).toMatchObject({
        schemaVersion: "omnitwin.foundry.source-readiness-map.v2",
        state: "available",
        summary: {
          factsEstablishedCount: 1,
          factsNotEstablishedCount: 0,
          outsideSourceFactsV2Count: 0,
        },
        files: [{
          path: "scene.spz",
          status: "facts_established",
          inputType: "spz",
          format: "spz",
          laneIds: ["visual_scene_representation"],
        }],
      });
      if (readiness.state !== "available") throw new Error("expected available V2 readiness");
      expect(readiness.gaps.map((gap) => gap.code)).not.toContain("OUTSIDE_SOURCE_FACTS_V2");
      expect(FoundrySourceReadinessMapV2Schema.parse(readiness)).toEqual(readiness);

      const checklist = compileFoundryOperatorEvidenceChecklistV2({ readiness });
      expect(checklist).toMatchObject({
        schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v2",
        state: "available",
        summary: { evidenceRequestCount: 11, highCount: 0, normalCount: 10, conditionalCount: 1 },
      });
      if (checklist.state !== "available") throw new Error("expected available V2 checklist");
      expect(checklist.items
        .map((item) => item.evidenceCode)
        .filter((code) => code.startsWith("SPZ_"))
        .sort()).toEqual([
        "SPZ_ACCURACY_UNKNOWN",
        "SPZ_ATTRIBUTE_VALUES_UNKNOWN",
        "SPZ_FRAME_UNKNOWN",
        "SPZ_PHYSICAL_BOUNDS_UNKNOWN",
        "SPZ_PROVENANCE_UNKNOWN",
        "SPZ_REGISTRATION_UNKNOWN",
        "SPZ_RENDERER_COMPATIBILITY_UNKNOWN",
        "SPZ_RIGHTS_UNKNOWN",
        "SPZ_UNITS_UNKNOWN",
        "SPZ_VISUAL_FIDELITY_UNKNOWN",
      ]);
      expect(FoundryOperatorEvidenceChecklistV2Schema.parse(checklist)).toEqual(checklist);
      expect(serializeUniversalSourceFactsV2Artifact(first.sourceFacts)).toBe(
        serializeUniversalSourceFactsV2Artifact(second.sourceFacts),
      );
      expect(serializeFoundrySourceReadinessMapV2(readiness)).toContain(readiness.readinessSha256);
      expect(serializeFoundryOperatorEvidenceChecklistV2(checklist)).toContain(checklist.checklistSha256);
    });
  }

  it("carries legacy extension facts through the V2 schema", async () => {
    const root = await sourceRoot(
      "extended.spz",
      legacyV3Fixture(4, extensionRecord(0x12345678, Buffer.from([1, 2, 3]))),
    );
    const result = await inspectUniversalIntakeWithSourceFactsV2(root);
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        format: "spz",
        inspection: { state: "established" },
        facts: {
          extensions: {
            declared: true,
            totalBytes: 11,
            records: [{ typeCodeHex: "12345678", payloadBytes: 3, recognizedType: "unknown" }],
          },
          container: { kind: "legacy_gzip", extensionBytes: 11 },
        },
      }],
    });
    expect(FoundryUniversalSourceFactsV2Schema.parse(result.sourceFacts)).toEqual(result.sourceFacts);
  });

  it("leaves the immutable V1 chain unchanged while V2 targets SPZ", async () => {
    const root = await sourceRoot("scene.spz", legacyV3Fixture());
    const v1 = await inspectUniversalIntakeWithSourceFacts(root);
    expect(v1.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v1",
      state: "available",
      summary: { assetCount: 0, untargetedFileCount: 1 },
    });
    const readinessV1 = compileFoundrySourceReadinessMapV1(v1);
    expect(readinessV1).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v1",
      state: "available",
      files: [{ path: "scene.spz", status: "outside_source_facts_v1" }],
    });
    expect(compileFoundryOperatorEvidenceChecklistV1({ readiness: readinessV1 })).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v1",
    });

    const v2 = await inspectUniversalIntakeWithSourceFactsV2(root);
    expect(v2.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v2",
      state: "available",
      summary: { assetCount: 1, establishedCount: 1 },
    });
  });

  it("keeps the exact V1 SPZ-outside-facts serialization chain immutable", async () => {
    const root = await sourceRoot("scene.spz", GOLDEN_LEGACY_V3_SPZ);
    const sourcePath = join(root, "scene.spz");
    const fixedTime = new Date("2026-01-02T03:04:05.000Z");
    await utimes(sourcePath, fixedTime, fixedTime);

    const inspected = await inspectUniversalIntakeWithSourceFacts(sourcePath);
    const readiness = compileFoundrySourceReadinessMapV1(inspected);
    const checklist = compileFoundryOperatorEvidenceChecklistV1({ readiness });
    const factsJson = serializeUniversalSourceFactsArtifact(inspected.sourceFacts);
    const readinessJson = serializeFoundrySourceReadinessMapV1(readiness);
    const checklistJson = serializeFoundryOperatorEvidenceChecklistV1(checklist);

    expect({
      sourceFileSha256: inspected.receipt.files[0]?.sha256,
      receiptSha256: inspected.receipt.receiptSha256,
      factsSha256: inspected.sourceFacts.factsSha256,
      factsBytes: Buffer.byteLength(factsJson, "utf8"),
      factsSerializationSha256: utf8Sha256(factsJson),
      readinessSha256: readiness.readinessSha256,
      readinessBytes: Buffer.byteLength(readinessJson, "utf8"),
      readinessSerializationSha256: utf8Sha256(readinessJson),
      checklistSha256: checklist.checklistSha256,
      checklistBytes: Buffer.byteLength(checklistJson, "utf8"),
      checklistSerializationSha256: utf8Sha256(checklistJson),
    }).toEqual({
      sourceFileSha256: "6b3882d1bddfd5d9ff5bdaa7441f494952aa42189c391dc57be0c64d4ab258ed",
      receiptSha256: "47d99e61a042578bb2839926c28fa069338a00f37d6644ee4d995fc5537b44dd",
      factsSha256: "bbcebb9b4384f8e40a9a56aedb6754d3630216c59e62ac1ba65912a60bffe30d",
      factsBytes: 1186,
      factsSerializationSha256: "5e759c535358d56b1454dc26c13a493e8c26f213b0dbaa1021c0b34409411ec3",
      readinessSha256: "310f865028b20b2eb1d3524a5eaba87c965fe39586bf54c1044e543fc4341daa",
      readinessBytes: 8438,
      readinessSerializationSha256: "b3854c88c924e64afd733e86d14acd6222dd6000455f890044f7c39d01d730bb",
      checklistSha256: "5eec7d7abffe6922b7442bd3519f6367bf08877f2b18cbaf92747265e3be5f7e",
      checklistBytes: 5908,
      checklistSerializationSha256: "e06b0c1c7513cf952f4eaddb31b01d51fa300c442e5382511ddac5b304162f18",
    });
  });

  it("preserves a stable failed-inspection outcome through V2 readiness", async () => {
    const root = await sourceRoot("broken.spz", Buffer.from("not-spz"));
    const result = await inspectUniversalIntakeWithSourceFactsV2(root);
    expect(result.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        format: "spz",
        inspection: {
          state: "facts_not_established",
          category: "unsupported_container",
          code: "SPZ_CONTAINER_UNRECOGNIZED",
        },
        facts: null,
      }],
    });
    const readiness = compileFoundrySourceReadinessMapV2(result);
    expect(readiness).toMatchObject({
      state: "available",
      files: [{ status: "facts_not_established", format: "spz" }],
    });
    if (readiness.state !== "available") throw new Error("expected available readiness");
    expect(readiness.gaps.map((gap) => gap.code)).toContain("SOURCE_FACTS_NOT_ESTABLISHED");
    const checklist = compileFoundryOperatorEvidenceChecklistV2({ readiness });
    expect(checklist).toMatchObject({ state: "available", summary: { evidenceRequestCount: 12 } });
    if (result.sourceFacts.state !== "available" || checklist.state !== "available") {
      throw new Error("expected available failed-inspection evidence chain");
    }
    const unknowns = result.sourceFacts.assets[0]?.unknowns ?? [];
    expect(unknowns).toHaveLength(10);
    expect(unknowns.every((unknown) => unknown.reason.startsWith("This inspection does not"))).toBe(true);
    expect(unknowns.map((unknown) => unknown.reason).join(" ")).not.toMatch(
      /\b(?:validated|traversed|structurally valid)\b/iu,
    );
    const checklistReasonByCode = new Map<string, string>(
      checklist.items.map((item) => [item.evidenceCode, item.reason]),
    );
    for (const unknown of unknowns) {
      expect(checklistReasonByCode.get(unknown.code)).toBe(unknown.reason);
    }
  });

  it("fails closed without issuing a V2 artifact when the pipeline is cancelled", async () => {
    const root = await sourceRoot("scene.spz", legacyV3Fixture());
    const controller = new AbortController();
    const pending = inspectUniversalIntakeWithSourceFactsV2(root, { signal: controller.signal });
    controller.abort();
    const [outcome] = await Promise.allSettled([pending]);
    if (outcome === undefined || outcome.status === "fulfilled") {
      throw new Error("cancelled V2 inspection issued an artifact");
    }
    expect(outcome.reason).toMatchObject({
      name: "FoundryIntegrityError",
      code: "INTAKE_CANCELLED",
      message: "The read-only intake inspection was cancelled.",
    });
    expect(outcome).not.toHaveProperty("value");
  });

  it("rejects a cancelled direct-SPZ outcome before a collector can issue V2 facts", async () => {
    const bytes = legacyV3Fixture();
    const root = await sourceRoot("scene.spz", bytes);
    const inspected = await inspectUniversalIntakeWithSourceFactsV2(root);
    const receiptFile = inspected.receipt.files[0];
    if (receiptFile === undefined) throw new Error("missing receipt identity");
    const collector = createUniversalSourceFactsV2StreamCollector("scene.spz");
    collector.observe(bytes, 0);
    expect(() => collector.finalize(
      {
        path: receiptFile.path,
        sizeBytes: receiptFile.sizeBytes,
        sha256: receiptFile.sha256,
        detection: receiptFile.detection,
      },
      {
        spzInspection: {
          sourceSizeBytes: receiptFile.sizeBytes,
          sourceSha256: receiptFile.sha256,
          state: "facts_not_established",
          category: "cancelled",
          code: "SPZ_INSPECTION_CANCELLED",
        },
      },
    )).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_SPZ_INSPECTION_CANCELLED",
    }));
  });

  it("freezes SPZ unknown definitions and exposes versioned V2 evidence-code aliases", async () => {
    expect(Object.isFrozen(FOUNDRY_SPZ_UNKNOWNS)).toBe(true);
    expect(FOUNDRY_SPZ_UNKNOWNS.every((unknown) => Object.isFrozen(unknown))).toBe(true);
    const entrypoint = await import("../index.js");
    expect(entrypoint.FOUNDRY_OPERATOR_EVIDENCE_GAP_CODES_V2).toContain("OUTSIDE_SOURCE_FACTS_V2");
    expect(entrypoint.FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES_V2).toContain("SPZ_ATTRIBUTE_VALUES_UNKNOWN");
    expect(Object.isFrozen(entrypoint.FOUNDRY_OPERATOR_EVIDENCE_GAP_CODES_V2)).toBe(true);
    expect(Object.isFrozen(entrypoint.FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES_V2)).toBe(true);
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV2ArtifactFromReceipt");
    expect(entrypoint).not.toHaveProperty("createUniversalSourceFactsV2StreamCollector");
  });

  it("keeps XBIN atomic and exposes no partial SPZ facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-spz-xbin-"));
    roots.push(root);
    await writeFile(join(root, "scene.spz"), legacyV3Fixture());
    await writeFile(join(root, "vendor.xbin"), Buffer.from([1, 2, 3, 4]));
    const result = await inspectUniversalIntakeWithSourceFactsV2(root);
    expect(result.sourceFacts).toMatchObject({
      state: "unavailable",
      assets: [],
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
    });
    const readiness = compileFoundrySourceReadinessMapV2(result);
    expect(readiness).toMatchObject({ state: "blocked", files: [], gaps: [] });
    expect(compileFoundryOperatorEvidenceChecklistV2({ readiness })).toMatchObject({
      state: "blocked",
      groups: [],
      items: [],
    });
  });

  it("rejects a same-size outcome from different source bytes", async () => {
    const first = legacyV3Fixture(2);
    const second = Buffer.from(first);
    second[second.length - 9] = (second[second.length - 9] ?? 0) ^ 1;
    const root = await sourceRoot("scene.spz", first);
    const digest = createHash("sha256").update(first).digest("hex");
    const detection = (await inspectUniversalIntakeWithSourceFactsV2(root)).receipt.files[0]?.detection;
    if (detection === undefined) throw new Error("missing detection");
    const collector = createUniversalSourceFactsV2StreamCollector("scene.spz");
    collector.observe(first, 0);

    const otherRoot = await sourceRoot("other.spz", second);
    const other = await inspectUniversalIntakeWithSourceFactsV2(otherRoot);
    const otherAsset = other.sourceFacts.state === "available" ? other.sourceFacts.assets[0] : undefined;
    if (otherAsset === undefined) throw new Error("missing other asset");
    expect(() => collector.finalize(
      { path: "scene.spz", sizeBytes: first.length, sha256: digest, detection },
      {
        spzInspection: {
          sourceSizeBytes: first.length,
          sourceSha256: otherAsset.source.sha256,
          state: "facts_not_established",
          category: "parse_failure",
          code: "SPZ_GZIP_TRAILER_INVALID",
        },
      },
    )).toThrow(/does not match/u);
  });

  it("rejects canonical V2 digest and SPZ fact tampering", async () => {
    const root = await sourceRoot("scene.spz", legacyV3Fixture());
    const result = await inspectUniversalIntakeWithSourceFactsV2(root);
    const tampered = structuredClone(result.sourceFacts);
    if (tampered.state !== "available") throw new Error("expected available facts");
    const asset = tampered.assets[0];
    if (asset?.format !== "spz" || asset.facts === null) throw new Error("expected SPZ facts");
    asset.facts.fractionalBitsRaw = 13;
    expect(FoundryUniversalSourceFactsV2Schema.safeParse(tampered).success).toBe(false);

    const digestOnly = structuredClone(result.sourceFacts);
    digestOnly.factsSha256 = "0".repeat(64);
    expect(FoundryUniversalSourceFactsV2Schema.safeParse(digestOnly).success).toBe(false);
  });

  it("binds the direct inspector to the supplied completed digest", async () => {
    const bytes = legacyV3Fixture();
    const root = await sourceRoot("scene.spz", bytes);
    const handle = await import("node:fs/promises").then(({ open }) => open(join(root, "scene.spz"), "r"));
    try {
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(await inspectSpzSourceFacts(handle, bytes.length, digest)).toMatchObject({
        state: "established",
        sourceSha256: digest,
        sourceSizeBytes: bytes.length,
      });
    } finally {
      await handle.close();
    }
  });
});

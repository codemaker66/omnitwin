import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyUniversalIntakeProbe,
  inspectUniversalIntakeWithSourceFactsV4,
} from "../intake-receipt.js";
import {
  FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES,
  FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
  FoundryUniversalSourceFactsV4Schema,
  UniversalSourceFactsV4FileResultSchema,
  createUniversalSourceFactsV4ArtifactFromReceipt,
  createUniversalSourceFactsV4StreamCollector,
} from "../source-facts-v4.js";
import type { FoundryMediaContainerSourceFactsOutcome } from "../media-container-source-facts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function jpegFixture(): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x01, 0x02, 0xff, 0x00, 0x03,
    0xff, 0xd9,
  ]);
}

function box(type: string, ...payloads: readonly Buffer[]): Buffer {
  const payload = Buffer.concat(payloads);
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function isoBmffFixture(): Buffer {
  const ftyp = Buffer.alloc(12);
  ftyp.write("isom", 0, 4, "ascii");
  ftyp.writeUInt32BE(1, 4);
  ftyp.write("mp42", 8, 4, "ascii");
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(2_000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd[3] = 1;
  tkhd.writeUInt32BE(1, 12);
  tkhd.writeUInt32BE(3 * 65_536, 76);
  tkhd.writeUInt32BE(2 * 65_536, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1_000, 12);
  mdhd.writeUInt32BE(2_000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, 4, "ascii");
  const visual = Buffer.alloc(78);
  visual.writeUInt16BE(3, 24);
  visual.writeUInt16BE(2, 26);
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);
  const trak = box(
    "trak",
    box("tkhd", tkhd),
    box(
      "mdia",
      box("mdhd", mdhd),
      box("hdlr", hdlr),
      box("minf", box("stbl", box("stsd", stsd, box("avc1", visual)))),
    ),
  );
  return Buffer.concat([
    box("ftyp", ftyp),
    box("moov", box("mvhd", mvhd), trak),
    box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-media-container-v4-pipeline-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(root, name), bytes);
  return root;
}

describe("media-container Source Facts V4 intake pipeline", () => {
  it("establishes JPEG facts while preserving the exact canonical receipt ambiguity", async () => {
    const bytes = jpegFixture();
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "reference.jpg": bytes }),
    );
    expect(inspected.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v4",
      state: "available",
      summary: { assetCount: 1, establishedCount: 1, factsNotEstablishedCount: 0 },
      assets: [{
        source: {
          path: "reference.jpg",
          inputType: "generic_image",
          receiptCandidateInputTypes: [
            "matterport_panorama",
            "dslr_image",
            "generic_image",
            "panorama_360",
            "phone_image",
          ],
        },
        format: "jpeg",
        inspection: { state: "established", code: "MEDIA_CONTAINER_FORMAT_FACTS_ESTABLISHED" },
        facts: { format: "jpeg", dimensions: { width: 3, height: 2 } },
        unknowns: FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
      }],
    });
    expect(FoundryUniversalSourceFactsV4Schema.parse(inspected.sourceFacts)).toEqual(inspected.sourceFacts);
  });

  it("lets established ISO-BMFF bytes override a misleading JPEG extension", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "misleading.jpg": isoBmffFixture() }),
    );
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        source: {
          inputType: "video",
          receiptCandidateInputTypes: [
            "matterport_panorama",
            "dslr_image",
            "generic_image",
            "panorama_360",
            "phone_image",
          ],
        },
        format: "iso_bmff",
        facts: { format: "iso_bmff" },
      }],
    });
  });

  it("keeps ordinary inspection failures as explicit neutral media-container gaps", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "broken.jpg": Buffer.from([0xff, 0xd8, 0xff]) }),
    );
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 1, establishedCount: 0, factsNotEstablishedCount: 1 },
      assets: [{
        source: { inputType: "generic_image" },
        format: "media_container",
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "JPEG_MARKER_STRUCTURE_INVALID",
          coverage: "none",
        },
        facts: null,
      }],
    });
  });

  it("keeps failed timed-media inputs neutral and does not downgrade them to a still-image role", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "broken.mp4": Buffer.from([0, 1, 2, 3, 4]) }),
    );
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        source: { inputType: "video", receiptCandidateInputTypes: ["video"] },
        format: "media_container",
        inspection: {
          state: "facts_not_established",
          category: "unsupported_container",
          code: "MEDIA_CONTAINER_UNRECOGNIZED",
        },
        facts: null,
        unknowns: FOUNDRY_MEDIA_CONTAINER_UNKNOWNS,
      }],
    });
  });

  it("keeps inherited OBJ targeting ahead of broad drone-media evidence", async () => {
    const obj = Buffer.from([
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "f 1 2 3",
      "",
    ].join("\n"), "utf8");
    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "drone_scene.obj": obj }),
    );
    expect(inspected.receipt.files[0]?.detection.candidates.map((candidate) => candidate.inputType)).toEqual([
      "drone_media",
      "obj",
    ]);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      assets: [{
        source: { inputType: "obj" },
        format: "obj",
        inspection: { state: "established", code: "OBJ_STREAM_FACTS_ESTABLISHED" },
      }],
    });
  });

  it("rejects a media inspection outcome bound to different bytes", () => {
    const bytes = jpegFixture();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const detection = classifyUniversalIntakeProbe({
      relativePath: "reference.jpg",
      magicHex: bytes.subarray(0, 64).toString("hex"),
      boundedHeaderText: null,
    });
    const collector = createUniversalSourceFactsV4StreamCollector("reference.jpg");
    collector.observe(bytes, 0);
    expect(() => collector.finalize({
      path: "reference.jpg",
      sizeBytes: bytes.length,
      sha256,
      detection,
      magicHex: bytes.toString("hex"),
    }, {
      mediaContainerInspection: {
        sourceSha256: "f".repeat(64),
        sourceSizeBytes: bytes.length,
        state: "facts_not_established",
        category: "unsupported_container",
        code: "MEDIA_CONTAINER_UNRECOGNIZED",
      },
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V4_MEDIA_INSPECTION_SOURCE_MISMATCH",
    }));
    expect(FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES).toHaveLength(7);
  });

  it("binds the collector prefix and artifact candidate list to the exact receipt evidence", async () => {
    const bytes = jpegFixture();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const detection = classifyUniversalIntakeProbe({
      relativePath: "reference.jpg",
      magicHex: bytes.toString("hex"),
      boundedHeaderText: null,
    });
    const prefixCollector = createUniversalSourceFactsV4StreamCollector("reference.jpg");
    prefixCollector.observe(bytes, 0);
    expect(() => prefixCollector.finalize({
      path: "reference.jpg",
      sizeBytes: bytes.length,
      sha256,
      detection,
      magicHex: "00",
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V4_MAGIC_BINDING_MISMATCH",
    }));

    const inspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "reference.jpg": bytes }),
    );
    if (inspected.sourceFacts.state !== "available") throw new Error("expected V4 facts");
    const asset = inspected.sourceFacts.assets[0];
    const receiptFile = inspected.receipt.files[0];
    if (
      asset === undefined ||
      receiptFile === undefined ||
      !("receiptCandidateInputTypes" in asset.source)
    ) {
      throw new Error("expected media asset and receipt file");
    }
    const tamperedResult = UniversalSourceFactsV4FileResultSchema.parse({
      kind: "asset",
      asset: {
        ...asset,
        source: {
          ...asset.source,
          receiptCandidateInputTypes: ["generic_image"],
        },
      },
    });
    expect(() => createUniversalSourceFactsV4ArtifactFromReceipt(
      inspected.receipt.receiptSha256,
      [{
        path: receiptFile.path,
        sizeBytes: receiptFile.sizeBytes,
        sha256: receiptFile.sha256,
        detection: receiptFile.detection,
        magicHex: receiptFile.inspection.magicHex,
      }],
      [tamperedResult],
    )).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V4_MEDIA_CANDIDATE_BINDING_MISMATCH",
    }));

    const isoInspected = await inspectUniversalIntakeWithSourceFactsV4(
      await sourceRoot({ "movie.mp4": isoBmffFixture() }),
    );
    if (isoInspected.sourceFacts.state !== "available") throw new Error("expected ISO facts");
    const isoAsset = isoInspected.sourceFacts.assets[0];
    if (isoAsset?.format !== "iso_bmff") throw new Error("expected ISO-BMFF asset");
    const isoFacts = isoAsset?.facts;
    if (isoFacts?.format !== "iso_bmff") {
      throw new Error("expected ISO-BMFF facts");
    }
    const formatCollector = createUniversalSourceFactsV4StreamCollector("reference.jpg");
    formatCollector.observe(bytes, 0);
    expect(() => formatCollector.finalize({
      path: "reference.jpg",
      sizeBytes: bytes.length,
      sha256,
      detection,
      magicHex: bytes.toString("hex"),
    }, {
      mediaContainerInspection: {
        sourceSha256: sha256,
        sourceSizeBytes: bytes.length,
        state: "established",
        facts: isoFacts,
      },
    })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V4_MEDIA_FORMAT_BINDING_MISMATCH",
    }));
  });

  it("refuses to issue a V4 artifact when the same-handle media inspector was cancelled", () => {
    const bytes = jpegFixture();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const detection = classifyUniversalIntakeProbe({
      relativePath: "reference.jpg",
      magicHex: bytes.subarray(0, 64).toString("hex"),
      boundedHeaderText: null,
    });
    const cancelled: FoundryMediaContainerSourceFactsOutcome = {
      sourceSha256: sha256,
      sourceSizeBytes: bytes.length,
      state: "facts_not_established",
      category: "cancelled",
      code: "MEDIA_CONTAINER_INSPECTION_CANCELLED",
    };
    const collector = createUniversalSourceFactsV4StreamCollector("reference.jpg");
    collector.observe(bytes, 0);
    expect(() => collector.finalize({
      path: "reference.jpg",
      sizeBytes: bytes.length,
      sha256,
      detection,
      magicHex: bytes.toString("hex"),
    }, { mediaContainerInspection: cancelled })).toThrowError(expect.objectContaining({
      name: "FoundryIntegrityError",
      code: "SOURCE_FACTS_V4_MEDIA_INSPECTION_CANCELLED",
    }));
  });
});

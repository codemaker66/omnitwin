import { createHash } from "node:crypto";
import { detectFoundryInputFile } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  E57AggregateMetadataSchema,
  FOUNDRY_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  FoundryUniversalSourceFactsSchema,
  createUniversalSourceFactsArtifactFromReceipt,
  createUniversalSourceFactsStreamCollector,
  serializeUniversalSourceFactsArtifact,
  withUniversalSourceFactsE57Aggregate,
  type UniversalSourceFactsFileResult,
  type UniversalSourceFactsReceiptFileIdentity,
} from "../source-facts.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function identity(
  path: string,
  bytes: Uint8Array,
): UniversalSourceFactsReceiptFileIdentity {
  return {
    path,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    detection: detectFoundryInputFile({
      relativePath: path,
      magicHex: Buffer.from(bytes.subarray(0, 64)).toString("hex"),
      boundedHeaderText: null,
    }),
  };
}

function collect(
  path: string,
  bytes: Uint8Array,
  chunkSizes: readonly number[] = [bytes.length],
): { readonly identity: UniversalSourceFactsReceiptFileIdentity; readonly result: UniversalSourceFactsFileResult } {
  const collector = createUniversalSourceFactsStreamCollector(path);
  let offset = 0;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    const requested = chunkSizes[chunkIndex % chunkSizes.length] ?? bytes.length;
    const end = Math.min(bytes.length, offset + Math.max(1, requested));
    collector.observe(bytes.subarray(offset, end), offset);
    offset = end;
    chunkIndex += 1;
  }
  const fileIdentity = identity(path, bytes);
  return { identity: fileIdentity, result: collector.finalize(fileIdentity) };
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

function glbFixtureFromJson(json: string, overrides: {
  readonly chunkType?: number;
  readonly declaredJsonBytes?: number;
  readonly declaredFileBytes?: number;
  readonly rawJsonBytes?: Uint8Array;
} = {}): Buffer {
  const raw = Buffer.from(overrides.rawJsonBytes ?? Buffer.from(json, "utf8"));
  const paddedLength = Math.ceil(raw.length / 4) * 4;
  const bytes = Buffer.alloc(20 + paddedLength, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(overrides.declaredFileBytes ?? bytes.length, 8);
  bytes.writeUInt32LE(overrides.declaredJsonBytes ?? paddedLength, 12);
  bytes.writeUInt32LE(overrides.chunkType ?? 0x4e4f534a, 16);
  raw.copy(bytes, 20);
  return bytes;
}

function aggregateFixture(byteSize: number): ReturnType<typeof E57AggregateMetadataSchema.parse> {
  return E57AggregateMetadataSchema.parse({
    adapter: { name: "pye57", version: "0.4.19" },
    imageBlobBytesRead: false,
    openMode: "read-only",
    pointRecordsRead: false,
    runtimeVersions: { numpy: "2.3.1", python: "3.13.5" },
    blobDeclarationHistogram: [
      { declarationCount: 1, declaredByteTotal: "12", kind: "jpegImage" },
    ],
    coordinateMetadata: {
      present: true,
      sha256: "a".repeat(64),
      utf8ByteCount: 9,
    },
    declaredImageBlobByteTotal: "12",
    declaredPointRecordTotal: "42",
    file: { byteSize },
    imageCount: 1,
    imagePoseCounts: { absent: 0, present: 1 },
    imageRepresentationCardinality: { absent: 0, multiple: 0, single: 1 },
    imageRepresentationHistogram: [
      { declarationCount: 1, kind: "pinholeRepresentation" },
    ],
    pointFieldCoverage: [
      { field: "cartesianX", scanCount: 2 },
      { field: "cartesianY", scanCount: 2 },
      { field: "cartesianZ", scanCount: 2 },
    ],
    scanCount: 2,
    scanPoseCounts: { absent: 1, present: 1 },
  });
}

describe("Universal Source Facts V1", () => {
  it("binds deterministic E57 physical-header facts to exact streamed bytes and receipt identity", () => {
    const bytes = e57Fixture();
    const oneChunk = collect("capture.e57", bytes);
    const split = collect("capture.e57", bytes, [1, 2, 7, 3, 11]);
    expect(split.result).toEqual(oneChunk.result);
    expect(split.result).toMatchObject({
      kind: "asset",
      asset: {
        format: "e57",
        inspection: {
          state: "established",
          code: "E57_PHYSICAL_HEADER_ESTABLISHED",
          coverage: "physical_header",
        },
        facts: {
          signature: "ASTM-E57",
          versionMajor: 1,
          physicalLengthBytes: bytes.length,
          fileLengthMatchesHeader: true,
          aggregateMetadata: null,
        },
      },
    });

    const receiptSha256 = "1".repeat(64);
    const first = createUniversalSourceFactsArtifactFromReceipt(
      receiptSha256,
      [oneChunk.identity],
      [oneChunk.result],
    );
    const second = createUniversalSourceFactsArtifactFromReceipt(
      receiptSha256,
      [split.identity],
      [split.result],
    );
    expect(second).toEqual(first);
    expect(first.limitations).toEqual(FOUNDRY_SOURCE_FACTS_LIMITATIONS);
    expect(first.factsSha256).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = serializeUniversalSourceFactsArtifact(first);
    expect(serialized).not.toContain("generatedAt");
    expect(serialized).not.toContain("C:\\");
    expect(FoundryUniversalSourceFactsSchema.parse(JSON.parse(serialized))).toEqual(first);

    expect(FoundryUniversalSourceFactsSchema.safeParse({
      ...first,
      receiptSha256: "2".repeat(64),
    }).success).toBe(false);
  });

  it("attaches bounded E57 aggregate metadata immutably and re-derives probe policy", () => {
    const collected = collect("capture.e57", e57Fixture());
    const attached = withUniversalSourceFactsE57Aggregate(
      collected.result,
      aggregateFixture(collected.identity.sizeBytes),
    );
    expect(collected.result).toMatchObject({ kind: "asset", asset: { facts: { aggregateMetadata: null } } });
    expect(attached).toMatchObject({
      kind: "asset",
      asset: {
        facts: { aggregateMetadata: { scanCount: 2, declaredPointRecordTotal: "42" } },
      },
    });
    if (attached.kind !== "asset") throw new Error("expected E57 asset");
    expect(attached.asset.unknowns.map((item) => item.code)).not.toContain("E57_SCAN_COUNT_UNKNOWN");
    expect(attached.asset.unknowns.map((item) => item.code)).toEqual(expect.arrayContaining([
      "E57_UNITS_UNKNOWN",
      "E57_CRS_UNKNOWN",
      "E57_BOUNDS_UNKNOWN",
      "E57_ACCURACY_UNKNOWN",
      "E57_REGISTRATION_UNKNOWN",
      "E57_RIGHTS_UNKNOWN",
    ]));

    const artifact = createUniversalSourceFactsArtifactFromReceipt(
      "3".repeat(64),
      [collected.identity],
      [attached],
    );
    expect(artifact.policy).toMatchObject({
      externalProcess: "local_pye57_read_only",
      metadataProbe: "local_pye57_read_only",
      networkAccess: "none",
      mutation: "none",
      reconstruction: "none",
    });

    const { factsSha256: _digest, ...payload } = artifact;
    const contradictoryPayload = {
      ...payload,
      policy: { ...payload.policy, externalProcess: "none", metadataProbe: "none" },
    };
    const contradictory = {
      ...contradictoryPayload,
      factsSha256: domainSeparatedSha256(
        FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN,
        toCanonicalJson(contradictoryPayload),
      ),
    };
    expect(FoundryUniversalSourceFactsSchema.safeParse(contradictory).success).toBe(false);
    expect(() => withUniversalSourceFactsE57Aggregate(
      collected.result,
      aggregateFixture(collected.identity.sizeBytes + 1),
    )).toThrow("byte size does not match");
    expect(E57AggregateMetadataSchema.safeParse({
      ...aggregateFixture(collected.identity.sizeBytes),
      declaredImageBlobByteTotal: "13",
    }).success).toBe(false);
  });

  it("extracts bounded GLB declarations without exposing URI values or decoding BIN data", () => {
    const secretUri = "https://private.invalid/textures/secret.png";
    const bytes = glbFixtureFromJson(JSON.stringify({
      asset: { version: "2.0", minVersion: "2.0", generator: "fixture" },
      extensionsUsed: ["KHR_texture_transform", "EXT_meshopt_compression"],
      extensionsRequired: ["EXT_meshopt_compression"],
      buffers: [{ byteLength: 4, uri: "buffer.bin" }],
      images: [{ uri: secretUri }],
      materials: [{}],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      meshes: [{
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 },
          { attributes: { POSITION: 0, TEXCOORD_0: 2 }, mode: 5 },
          { attributes: { POSITION: 0 }, mode: 99 },
        ],
      }],
      extras: { uri: "other.bin" },
    }));
    const one = collect("model.glb", bytes);
    const split = collect("model.glb", bytes, [1]);
    expect(split.result).toEqual(one.result);
    expect(one.result).toMatchObject({
      kind: "asset",
      asset: {
        format: "glb",
        inspection: {
          state: "established",
          code: "GLB_CONTAINER_JSON_FACTS_ESTABLISHED",
          coverage: "container_header_and_json",
        },
        facts: {
          container: {
            magic: "glTF",
            version: 2,
            fileLengthMatchesDeclaration: true,
          },
          json: {
            declaredCounts: { buffers: "1", images: "1", meshes: "1", nodes: "1" },
            extensionsUsed: ["EXT_meshopt_compression", "KHR_texture_transform"],
            primitiveModes: [{ mode: 4, count: "1" }, { mode: 5, count: "1" }],
            invalidPrimitiveModeDeclarationCount: "1",
            attributeSemantics: ["NORMAL", "POSITION", "TEXCOORD_0"],
            uriDeclarations: { total: "3", buffers: "1", images: "1", other: "1" },
          },
        },
      },
    });
    expect(JSON.stringify(one.result)).not.toContain(secretUri);
    expect(JSON.stringify(one.result)).not.toContain("buffer.bin");
  });

  it.each([
    [
      "duplicate key",
      glbFixtureFromJson('{"asset":{"version":"2.0"},"nodes":[],"nodes":[]}'),
      "GLB_JSON_DUPLICATE_KEY",
      "parse_failure",
    ],
    [
      "invalid UTF-8",
      glbFixtureFromJson("", { rawJsonBytes: Uint8Array.from([0xff, 0xfe, 0x20, 0x20]) }),
      "GLB_JSON_UTF8_INVALID",
      "parse_failure",
    ],
    [
      "non-JSON first chunk",
      glbFixtureFromJson('{"asset":{"version":"2.0"}}', { chunkType: 0x004e4942 }),
      "GLB_FIRST_CHUNK_IS_NOT_JSON",
      "unsupported_container",
    ],
    [
      "declared over-limit JSON",
      glbFixtureFromJson("{}", { declaredJsonBytes: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES + 4 }),
      "GLB_JSON_CHUNK_LIMIT_EXCEEDED",
      "resource_limit",
    ],
    [
      "excessive JSON depth",
      glbFixtureFromJson(`${"[".repeat(130)}0${"]".repeat(130)}`),
      "GLB_JSON_DEPTH_LIMIT_EXCEEDED",
      "resource_limit",
    ],
  ] as const)("reports %s as facts_not_established with a stable code", (_label, bytes, code, category) => {
    expect(collect("model.glb", bytes, [2, 3, 5]).result).toMatchObject({
      kind: "asset",
      asset: {
        inspection: { state: "facts_not_established", code, category },
      },
    });
  });

  it("keeps JSON .gltf explicitly unsupported instead of treating it as binary GLB", () => {
    const bytes = Buffer.from('{"asset":{"version":"2.0"}}', "utf8");
    expect(collect("model.gltf", bytes).result).toMatchObject({
      kind: "asset",
      asset: {
        format: "gltf_json",
        facts: null,
        inspection: {
          state: "facts_not_established",
          category: "unsupported_variant",
          code: "GLTF_JSON_VARIANT_UNSUPPORTED",
        },
      },
    });
  });

  it("streams OBJ across BOM/CRLF/chunk boundaries and validates point-of-use face indices", () => {
    const text = [
      "# source comment",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "v 0 0 1",
      "vt 0.5 0.5",
      "vn 0 0 1",
      "vp 0.25 0.75",
      "f 1 2 3",
      "f -4/-1 -3/-1 -2/-1",
      "f 1//1 2//1 3//1",
      "f 1/1/1 2/1/1 3/1/1 4/1/1",
      "f 5 2 3 # positive forward/out-of-range reference at point of use",
      "f -5 -2 -1",
      "l 1 2 3",
      "p 1",
      "o shell",
      "g room",
      "mtllib materials.mtl",
      "usemtl stone",
      "s 1",
      "v 0x10 0 0",
      "",
    ].join("\r\n");
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
    const one = collect("mesh.obj", bytes);
    const split = collect("mesh.obj", bytes, [1, 7, 2, 13]);
    expect(split.result).toEqual(one.result);
    expect(one.result).toMatchObject({
      kind: "asset",
      asset: {
        format: "obj",
        inspection: { state: "established", coverage: "complete_stream" },
        facts: {
          statementCounts: {
            comment: "1",
            vertexPosition: "5",
            textureCoordinate: "1",
            normal: "1",
            parameterSpaceVertex: "1",
            face: "6",
            line: "1",
            point: "1",
            materialLibrary: "1",
            useMaterial: "1",
            malformed: "3",
          },
          validVertexPositionCount: "4",
          validTextureCoordinateCount: "1",
          validNormalCount: "1",
          validFaceStatementCount: "4",
          validFaceCornerCount: "13",
          fanTriangleEquivalentCount: "5",
          faceForms: {
            vertexOnly: "1",
            vertexTexture: "1",
            vertexNormal: "1",
            vertexTextureNormal: "1",
          },
          faceIndexReferences: { positive: "21", negative: "6" },
          faceArities: [{ arity: 3, faceCount: "3" }, { arity: 4, faceCount: "1" }],
          nativeCoordinateBounds: { min: [0, 0, 0], max: [1, 1, 1] },
          materialLibraryDeclarationCount: "1",
          materialUseDeclarationCount: "1",
        },
      },
    });
  });

  it("fails closed on overlong OBJ logical lines and invalid UTF-8", () => {
    const overlong = Buffer.from(`v ${"1".repeat(FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES)} 0 0`, "ascii");
    expect(collect("mesh.obj", overlong, [4_096]).result).toMatchObject({
      kind: "asset",
      asset: { inspection: { state: "facts_not_established", category: "resource_limit", code: "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED" }, facts: null },
    });
    expect(collect("mesh.obj", Uint8Array.from([0x76, 0x20, 0xff, 0x0a])).result).toMatchObject({
      kind: "asset",
      asset: { inspection: { state: "facts_not_established", code: "OBJ_UTF8_INVALID" }, facts: null },
    });
  });

  it("hard-stops the whole artifact from receipt detection before any format result is required", () => {
    const e57 = identity("capture.e57", e57Fixture());
    const xbinBytes = Buffer.from("XBAGopaque", "ascii");
    const xbin = identity("nested/model.xbin", xbinBytes);
    const artifact = createUniversalSourceFactsArtifactFromReceipt(
      "4".repeat(64),
      [xbin, e57],
    );
    expect(artifact).toMatchObject({
      state: "unavailable",
      assets: [],
      affectedSources: [{
        path: "nested/model.xbin",
        sizeBytes: xbinBytes.length,
        sha256: sha256(xbinBytes),
        inputType: "xgrids_xbin",
      }],
      reason: {
        code: "XGRIDS_XBIN_UNSUPPORTED",
        nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
      },
      summary: {
        receiptFileCount: 2,
        assetCount: 0,
        blockedSourceCount: 1,
        untargetedFileCount: 1,
      },
    });
    expect(artifact.factsSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("sorts assets, rejects incomplete receipt result sets, and enforces stream identity", () => {
    const obj = collect("z.obj", Buffer.from("v 0 0 0\n", "utf8"), [2]);
    const e57 = collect("a.e57", e57Fixture(), [5]);
    const artifact = createUniversalSourceFactsArtifactFromReceipt(
      "5".repeat(64),
      [obj.identity, e57.identity],
      [obj.result, e57.result],
    );
    expect(artifact.assets.map((asset) => asset.source.path)).toEqual(["a.e57", "z.obj"]);
    expect(() => createUniversalSourceFactsArtifactFromReceipt(
      "5".repeat(64),
      [obj.identity, e57.identity],
      [obj.result],
    )).toThrow("one finalized result per receipt file");

    const noncontiguous = createUniversalSourceFactsStreamCollector("mesh.obj");
    expect(() => { noncontiguous.observe(Buffer.from("v", "ascii"), 1); }).toThrow("contiguous");

    const wrongHash = createUniversalSourceFactsStreamCollector("mesh.obj");
    const bytes = Buffer.from("v 0 0 0\n", "ascii");
    wrongHash.observe(bytes, 0);
    expect(() => wrongHash.finalize({ ...identity("mesh.obj", bytes), sha256: "0".repeat(64) })).toThrow("SHA-256");
  });
});

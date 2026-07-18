import { mkdtemp, open, rm, utimes, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_POINT_PLY_HEADER_MAX_BYTES,
  FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT,
  inspectPlyPointCloudSourceFacts,
  type FoundryPlyPointCloudSourceFactsOutcome,
} from "../ply-point-cloud-source-facts.js";

const roots: string[] = [];
const SHA256 = "c".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

interface FixtureProperty {
  readonly type: string;
  readonly name: string;
}

const WIDTH_BY_TYPE: Readonly<Record<string, number>> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const REAL_REPLAY_LAYOUT: readonly FixtureProperty[] = [
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

function pointPlyFixture(options: {
  readonly properties?: readonly FixtureProperty[];
  readonly count?: number;
  readonly encoding?: string;
  readonly version?: string;
  readonly eol?: "\n" | "\r\n";
  readonly comments?: readonly string[];
  readonly objInfo?: readonly string[];
  readonly payloadDelta?: number;
  readonly extraHeaderLines?: readonly string[];
} = {}): Buffer {
  const properties = options.properties ?? REAL_REPLAY_LAYOUT;
  const count = options.count ?? 2;
  const eol = options.eol ?? "\n";
  const header = Buffer.from(`${[
    "ply",
    `format ${options.encoding ?? "binary_little_endian"} ${options.version ?? "1.0"}`,
    ...(options.comments ?? []).map((comment) => `comment ${comment}`),
    ...(options.objInfo ?? []).map((item) => `obj_info ${item}`),
    `element vertex ${String(count)}`,
    ...properties.map((property) => `property ${property.type} ${property.name}`),
    ...(options.extraHeaderLines ?? []),
    "end_header",
  ].join(eol)}${eol}`, "ascii");
  const stride = properties.reduce(
    (total, property) => total + (WIDTH_BY_TYPE[property.type] ?? 0),
    0,
  );
  const payloadBytes = Math.max(0, count * stride + (options.payloadDelta ?? 0));
  return Buffer.concat([header, Buffer.alloc(payloadBytes)]);
}

function classicGaussianFixture(): Buffer {
  const properties = [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ].map((name) => ({ type: "float", name }));
  return pointPlyFixture({ properties, count: 1 });
}

function packedGaussianFixture(): Buffer {
  const chunkNames = [
    "min_x", "min_y", "min_z", "max_x", "max_y", "max_z",
    "min_scale_x", "min_scale_y", "min_scale_z",
    "max_scale_x", "max_scale_y", "max_scale_z",
  ];
  const vertexNames = [
    "packed_position", "packed_rotation", "packed_scale", "packed_color",
  ];
  const vertexCount = 257;
  const chunkCount = 2;
  const header = Buffer.from(`${[
    "ply",
    "format binary_little_endian 1.0",
    `element chunk ${String(chunkCount)}`,
    ...chunkNames.map((name) => `property float ${name}`),
    `element vertex ${String(vertexCount)}`,
    ...vertexNames.map((name) => `property uint ${name}`),
    "end_header",
  ].join("\n")}\n`, "ascii");
  return Buffer.concat([
    header,
    Buffer.alloc(chunkCount * chunkNames.length * 4 + vertexCount * vertexNames.length * 4),
  ]);
}

function faceMeshFixture(): Buffer {
  const header = Buffer.from(`${[
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 3",
    "property float x",
    "property float y",
    "property float z",
    "element face 1",
    "property list uchar int vertex_indices",
    "end_header",
  ].join("\n")}\n`, "ascii");
  const payload = Buffer.alloc(3 * 12 + 1 + 3 * 4);
  payload.writeUInt8(3, 3 * 12);
  return Buffer.concat([header, payload]);
}

async function withHandle<T>(
  bytes: Buffer,
  action: (handle: FileHandle, path: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "foundry-point-ply-facts-"));
  roots.push(root);
  const path = join(root, "points.ply");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await action(handle, path);
  } finally {
    await handle.close();
  }
}

async function inspect(
  bytes: Buffer,
  options: { readonly signal?: AbortSignal; readonly fileSize?: number } = {},
): Promise<FoundryPlyPointCloudSourceFactsOutcome> {
  return withHandle(bytes, (handle) => inspectPlyPointCloudSourceFacts(
    handle,
    options.fileSize ?? bytes.length,
    SHA256,
    options.signal,
  ));
}

function expectFailure(
  outcome: FoundryPlyPointCloudSourceFactsOutcome,
  code: keyof typeof FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
    sourceSha256: SHA256,
  });
}

describe("ordinary point PLY Source Facts", () => {
  it("establishes the real replay layout and exact fixed-width payload equation", async () => {
    const bytes = pointPlyFixture({ count: 852 });
    const outcome = await inspect(bytes);
    expect(outcome).toMatchObject({
      state: "established",
      sourceSha256: SHA256,
      sourceSizeBytes: bytes.length,
      facts: {
        format: "ply_binary_little_endian",
        profile: "ordinary_point_geometry_fixed_width_scalar",
        inspectionCoverage: "complete_header_and_exact_fixed_width_payload_layout",
        plyVersion: "1.0",
        header: {
          lineEndings: "lf",
          comments: { count: 0, retainedVerbatim: false, authoritative: false },
          objInfo: { count: 0, retainedVerbatim: false, authoritative: false },
        },
        vertices: {
          count: 852,
          recordStrideBytes: 27,
          payloadBytes: 852 * 27,
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
        container: {
          sourceSizeBytes: bytes.length,
          payloadBytes: 852 * 27,
          exactFileLengthVerified: true,
          trailingBytes: 0,
        },
      },
    });
    if (outcome.state !== "established") throw new Error("expected point facts");
    expect(outcome.facts.container.headerBytes + outcome.facts.vertices.payloadBytes)
      .toBe(bytes.length);
    expect(outcome.facts.vertices.properties.map((property) => property.byteOffset))
      .toEqual([0, 4, 8, 12, 16, 20, 24, 25, 26]);
  });

  it("accepts every original and width-explicit scalar spelling case-sensitively", async () => {
    const aliases = Object.keys(WIDTH_BY_TYPE);
    const properties = [
      { type: "float", name: "x" },
      { type: "double", name: "y" },
      { type: "int", name: "z" },
      ...aliases.map((type, index) => ({ type, name: `vendor_${String(index)}` })),
    ];
    const outcome = await inspect(pointPlyFixture({
      properties,
      count: 1,
      eol: "\r\n",
      comments: ["units meters is not authoritative"],
      objInfo: ["EPSG:27700 is not authoritative"],
    }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        header: { lineEndings: "crlf", comments: { count: 1 }, objInfo: { count: 1 } },
        vertices: {
          requiredCoordinateProperties: {
            canonicalTypes: ["float32", "float64", "int32"],
          },
        },
      },
    });
    if (outcome.state !== "established") throw new Error("expected point facts");
    expect(outcome.facts.vertices.properties.slice(-aliases.length)
      .map((property) => property.canonicalType)).toEqual([
        "int8", "int8", "uint8", "uint8", "int16", "int16", "uint16", "uint16",
        "int32", "int32", "uint32", "uint32", "float32", "float32", "float64", "float64",
      ]);
  });

  it("keeps payload values uninterpreted while requiring exact payload length", async () => {
    expectFailure(
      await inspect(pointPlyFixture({ payloadDelta: -1 })),
      "POINT_PLY_PAYLOAD_LENGTH_MISMATCH",
    );
    expectFailure(
      await inspect(pointPlyFixture({ payloadDelta: 1 })),
      "POINT_PLY_PAYLOAD_LENGTH_MISMATCH",
    );
    const arbitrary = pointPlyFixture();
    arbitrary.fill(0xff, arbitrary.length - 2 * 27);
    expect((await inspect(arbitrary)).state).toBe("established");
  });

  it("freezes ASCII, big-endian, compressed, face/list, and vertex-list variants as unsupported", async () => {
    expectFailure(
      await inspect(pointPlyFixture({ encoding: "ascii" })),
      "POINT_PLY_ASCII_ENCODING_UNSUPPORTED",
    );
    expectFailure(
      await inspect(pointPlyFixture({ encoding: "binary_big_endian" })),
      "POINT_PLY_BINARY_BIG_ENDIAN_UNSUPPORTED",
    );
    expectFailure(
      await inspect(pointPlyFixture({ encoding: "binary_little_endian_compressed" })),
      "POINT_PLY_COMPRESSED_LAYOUT_UNSUPPORTED",
    );
    expectFailure(await inspect(faceMeshFixture()), "POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED");
    const vertexList = Buffer.from(`${[
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "property list uchar float samples",
      "end_header",
      "",
    ].join("\n")}`, "ascii");
    expectFailure(await inspect(vertexList), "POINT_PLY_LIST_PROPERTY_UNSUPPORTED");
  });

  it("excludes classic and packed Gaussian layouts without consulting comments", async () => {
    expectFailure(
      await inspect(classicGaussianFixture()),
      "POINT_PLY_GAUSSIAN_PROFILE_EXCLUDED",
    );
    expectFailure(
      await inspect(packedGaussianFixture()),
      "POINT_PLY_PACKED_GAUSSIAN_PROFILE_EXCLUDED",
    );
    expect((await inspect(pointPlyFixture({
      comments: [
        "property float f_dc_0",
        "property float scale_0",
        "property float rot_0",
      ],
    }))).state).toBe("established");
  });

  it("rejects missing or duplicated coordinate names and malformed property declarations", async () => {
    expectFailure(
      await inspect(pointPlyFixture({
        properties: REAL_REPLAY_LAYOUT.filter((property) => property.name !== "z"),
      })),
      "POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING",
    );
    expectFailure(
      await inspect(pointPlyFixture({
        properties: [...REAL_REPLAY_LAYOUT, { type: "float", name: "x" }],
      })),
      "POINT_PLY_DUPLICATE_PROPERTY",
    );
    expectFailure(
      await inspect(pointPlyFixture({
        properties: REAL_REPLAY_LAYOUT.map((property) =>
          property.name === "x" ? { ...property, type: "FLOAT" } : property
        ),
      })),
      "POINT_PLY_SCALAR_TYPE_UNSUPPORTED",
    );
  });

  it("rejects malformed magic, format, counts, sentinels, and header bytes", async () => {
    expectFailure(
      await inspect(Buffer.from(" ply\nformat binary_little_endian 1.0\nend_header\n")),
      "POINT_PLY_CONTAINER_UNRECOGNIZED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nelement vertex 1\nend_header\n")),
      "POINT_PLY_FORMAT_DECLARATION_INVALID",
    );
    expectFailure(
      await inspect(pointPlyFixture({ version: "1.1" })),
      "POINT_PLY_VERSION_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 0\nend_header\n")),
      "POINT_PLY_VERTEX_COUNT_INVALID",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex +1\nend_header\n")),
      "POINT_PLY_VERTEX_COUNT_INVALID",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\n end_header \n")),
      "POINT_PLY_HEADER_GRAMMAR_INVALID",
    );
    const invalid = Buffer.from("ply\nformat binary_little_endian 1.0\ncomment x\nelement vertex 1\nend_header\n");
    invalid[44] = 0xff;
    expectFailure(await inspect(invalid), "POINT_PLY_HEADER_ENCODING_INVALID");
  });

  it("enforces header, declaration, count, and stride limits without allocating payloads", async () => {
    const longLine = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      `comment ${"a".repeat(FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES + 1)}`,
      "end_header",
      "",
    ].join("\n"));
    expectFailure(await inspect(longLine), "POINT_PLY_HEADER_LINE_LIMIT_EXCEEDED");

    const largeHeader = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      ...Array.from({ length: 20 }, (_, index) => `comment ${String(index)} ${"a".repeat(60_000)}`),
      "end_header",
      "",
    ].join("\n"));
    expect(largeHeader.length).toBeGreaterThan(FOUNDRY_POINT_PLY_HEADER_MAX_BYTES);
    expectFailure(await inspect(largeHeader), "POINT_PLY_HEADER_SIZE_LIMIT_EXCEEDED");

    expectFailure(
      await inspect(pointPlyFixture({
        comments: Array.from({ length: FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT + 1 }, () => "x"),
      })),
      "POINT_PLY_COMMENT_LIMIT_EXCEEDED",
    );
    const manyElements = Buffer.from(`${[
      "ply",
      "format binary_little_endian 1.0",
      ...Array.from({ length: FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT + 1 }, (_, index) =>
        `element ${index === 0 ? "vertex" : `vendor_${String(index)}`} 1`
      ),
      "end_header",
      "",
    ].join("\n")}`, "ascii");
    expectFailure(await inspect(manyElements), "POINT_PLY_ELEMENT_LIMIT_EXCEEDED");
    expectFailure(
      await inspect(pointPlyFixture({
        count: 1,
        properties: [
          ...REAL_REPLAY_LAYOUT,
          ...Array.from(
            { length: FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - REAL_REPLAY_LAYOUT.length + 1 },
            (_, index) => ({ type: "uchar", name: `vendor_${String(index)}` }),
          ),
        ],
      })),
      "POINT_PLY_PROPERTY_LIMIT_EXCEEDED",
    );
    const tooManyVertices = Buffer.from(`${[
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${String(FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT + 1)}`,
      "end_header",
      "",
    ].join("\n")}`, "ascii");
    expectFailure(await inspect(tooManyVertices), "POINT_PLY_VERTEX_COUNT_LIMIT_EXCEEDED");
    const strideOverflow = Buffer.from(`${[
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${String(FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT)}`,
      "property double x",
      "property double y",
      "property double z",
      ...Array.from({ length: 200 }, (_, index) =>
        `property double vendor_${String(index)}`
      ),
      "end_header",
      "",
    ].join("\n")}`, "ascii");
    expectFailure(await inspect(strideOverflow), "POINT_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
  });

  it("returns stable source-size, same-handle mutation, read, and cancellation outcomes", async () => {
    const bytes = pointPlyFixture();
    expectFailure(await inspect(bytes, { fileSize: -1 }), "POINT_PLY_SOURCE_SIZE_INVALID");
    expectFailure(
      await inspect(bytes, { fileSize: FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES + 1 }),
      "POINT_PLY_SOURCE_SIZE_LIMIT_EXCEEDED",
    );
    expectFailure(
      await inspect(bytes, { fileSize: bytes.length + 1 }),
      "POINT_PLY_SOURCE_SIZE_MISMATCH",
    );

    await withHandle(bytes, async (handle, path) => {
      const realRead = handle.read.bind(handle);
      Object.defineProperty(handle, "read", {
        configurable: true,
        value: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const result = await realRead(buffer, offset, length, position);
          const changed = new Date(Date.now() + 10_000);
          await utimes(path, changed, changed);
          return result;
        },
      });
      expectFailure(
        await inspectPlyPointCloudSourceFacts(handle, bytes.length, SHA256),
        "POINT_PLY_SOURCE_CHANGED",
      );
    });

    await withHandle(bytes, async (handle) => {
      Object.defineProperty(handle, "read", {
        configurable: true,
        value: async () => {
          await Promise.resolve();
          throw new Error("fixture read failure");
        },
      });
      expectFailure(
        await inspectPlyPointCloudSourceFacts(handle, bytes.length, SHA256),
        "POINT_PLY_HANDLE_READ_FAILED",
      );
    });

    const controller = new AbortController();
    controller.abort();
    expectFailure(
      await inspect(bytes, { signal: controller.signal }),
      "POINT_PLY_INSPECTION_CANCELLED",
    );
  });

  it("keeps the failure registry frozen, ordered, and category-complete", () => {
    expect(Object.isFrozen(FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toBe(true);
    expect(Object.keys(FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toEqual(
      FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES,
    );
    expect(FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE
      .POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING).toBe("unsupported_variant");
  });
});

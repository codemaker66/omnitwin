import { mkdtemp, open, rm, utimes, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  inspectGaussianPlySourceFacts,
  type FoundryGaussianPlySourceFactsOutcome,
} from "../gaussian-ply-source-facts.js";

const roots: string[] = [];
const SHA256 = "b".repeat(64);

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

function coreProperties(type = "float"): FixtureProperty[] {
  return [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ].map((name) => ({ type, name }));
}

function restProperties(count: 0 | 9 | 24 | 45 | 72, type = "float"): FixtureProperty[] {
  return Array.from({ length: count }, (_, index) => ({ type, name: `f_rest_${String(index)}` }));
}

function graphdecoProperties(restCount: 0 | 9 | 24 | 45 | 72): FixtureProperty[] {
  return [
    { type: "float", name: "x" },
    { type: "float", name: "y" },
    { type: "float", name: "z" },
    { type: "float", name: "nx" },
    { type: "float", name: "ny" },
    { type: "float", name: "nz" },
    { type: "float", name: "f_dc_0" },
    { type: "float", name: "f_dc_1" },
    { type: "float", name: "f_dc_2" },
    ...restProperties(restCount),
    { type: "float", name: "opacity" },
    { type: "float", name: "scale_0" },
    { type: "float", name: "scale_1" },
    { type: "float", name: "scale_2" },
    { type: "float", name: "rot_0" },
    { type: "float", name: "rot_1" },
    { type: "float", name: "rot_2" },
    { type: "float", name: "rot_3" },
  ];
}

function brushProperties(restCount: 0 | 9 | 24 | 45 | 72): FixtureProperty[] {
  return [
    { type: "float", name: "f_dc_0" },
    { type: "float", name: "f_dc_1" },
    { type: "float", name: "f_dc_2" },
    ...restProperties(restCount).sort((left, right) => left.name.localeCompare(right.name)),
    { type: "float", name: "opacity" },
    { type: "float", name: "rot_0" },
    { type: "float", name: "rot_1" },
    { type: "float", name: "rot_2" },
    { type: "float", name: "rot_3" },
    { type: "float", name: "scale_0" },
    { type: "float", name: "scale_1" },
    { type: "float", name: "scale_2" },
    { type: "float", name: "x" },
    { type: "float", name: "y" },
    { type: "float", name: "z" },
  ];
}

const PACKED_REQUIRED_CHUNK_PROPERTIES = [
  "min_x", "min_y", "min_z",
  "max_x", "max_y", "max_z",
  "min_scale_x", "min_scale_y", "min_scale_z",
  "max_scale_x", "max_scale_y", "max_scale_z",
] as const;
const PACKED_COLOR_CHUNK_PROPERTIES = [
  "min_r", "min_g", "min_b",
  "max_r", "max_g", "max_b",
] as const;
const PACKED_VERTEX_PROPERTIES = [
  "packed_position", "packed_rotation", "packed_scale", "packed_color",
] as const;

function packedPlyFixture(options: {
  readonly colorChunkBounds?: boolean;
  readonly shPropertyCount?: 0 | 9 | 24 | 45;
  readonly vertexCount?: number;
  readonly chunkCountDelta?: number;
} = {}): Buffer {
  const vertexCount = options.vertexCount ?? 257;
  const chunkCount = Math.ceil(vertexCount / 256) + (options.chunkCountDelta ?? 0);
  const chunkProperties = [
    ...PACKED_REQUIRED_CHUNK_PROPERTIES,
    ...(options.colorChunkBounds === true ? PACKED_COLOR_CHUNK_PROPERTIES : []),
  ];
  const shPropertyCount = options.shPropertyCount ?? 0;
  const lines = [
    "ply",
    "format binary_little_endian 1.0",
    `element chunk ${String(chunkCount)}`,
    ...chunkProperties.map((name) => `property float ${name}`),
    `element vertex ${String(vertexCount)}`,
    ...PACKED_VERTEX_PROPERTIES.map((name) => `property uint ${name}`),
    ...(shPropertyCount === 0
      ? []
      : [
          `element sh ${String(vertexCount)}`,
          ...Array.from({ length: shPropertyCount }, (_, index) =>
            `property uchar f_rest_${String(index)}`
          ),
        ]),
    "end_header",
    "",
  ];
  const header = Buffer.from(lines.join("\n"), "ascii");
  const payloadBytes = chunkCount * chunkProperties.length * 4 +
    vertexCount * PACKED_VERTEX_PROPERTIES.length * 4 +
    vertexCount * shPropertyCount;
  return Buffer.concat([header, Buffer.alloc(payloadBytes)]);
}

function plyFixture(options: {
  readonly properties?: readonly FixtureProperty[];
  readonly count?: number;
  readonly eol?: "\n" | "\r\n";
  readonly comments?: readonly string[];
  readonly objInfo?: readonly string[];
  readonly payloadDelta?: number;
} = {}): Buffer {
  const properties = options.properties ?? coreProperties();
  const count = options.count ?? 2;
  const eol = options.eol ?? "\n";
  const lines = [
    "ply",
    "format binary_little_endian 1.0",
    ...(options.comments ?? []).map((comment) => `comment ${comment}`),
    ...(options.objInfo ?? []).map((item) => `obj_info ${item}`),
    `element vertex ${String(count)}`,
    ...properties.map((property) => `property ${property.type} ${property.name}`),
    "end_header",
  ];
  const header = Buffer.from(`${lines.join(eol)}${eol}`, "ascii");
  const stride = properties.reduce((total, property) => total + (WIDTH_BY_TYPE[property.type] ?? 0), 0);
  const payloadBytes = Math.max(0, count * stride + (options.payloadDelta ?? 0));
  return Buffer.concat([header, Buffer.alloc(payloadBytes)]);
}

async function withHandle<T>(
  bytes: Buffer,
  action: (handle: FileHandle, path: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "foundry-gaussian-ply-facts-"));
  roots.push(root);
  const path = join(root, "scene.ply");
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
): Promise<FoundryGaussianPlySourceFactsOutcome> {
  return withHandle(bytes, (handle) => inspectGaussianPlySourceFacts(
    handle,
    options.fileSize ?? bytes.length,
    SHA256,
    options.signal,
  ));
}

function expectFailure(
  outcome: FoundryGaussianPlySourceFactsOutcome,
  code: keyof typeof FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
    sourceSha256: SHA256,
  });
}

describe("Gaussian PLY Source Facts", () => {
  it("establishes the alternate lexicographic Brush SH3 property order", async () => {
    const properties = brushProperties(45);
    const bytes = plyFixture({
      properties,
      count: 3,
      comments: ["Exported from Brush", "Vertical axis: y", "SH degree: 3", "end_header is data"],
    });
    const outcome = await inspect(bytes);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        format: "gaussian_ply_binary_little_endian",
        profile: "classic_3dgs_float32_scalar",
        inspectionCoverage: "complete_header_and_exact_fixed_width_payload_layout",
        plyVersion: "1.0",
        header: {
          lineEndings: "lf",
          comments: { count: 4, retainedVerbatim: false, authoritative: false },
        },
        gaussians: {
          count: 3,
          vertexStrideBytes: 59 * 4,
          payloadBytes: 3 * 59 * 4,
          sphericalHarmonics: {
            degree: 3,
            dcPropertyCount: 3,
            nonDcPropertyCount: 45,
            indicesContiguous: true,
          },
          normals: { state: "absent", offsets: [] },
          extraProperties: { count: 0, names: [] },
        },
        container: {
          sourceSizeBytes: bytes.length,
          exactFileLengthVerified: true,
          trailingBytes: 0,
        },
      },
    });
    if (outcome.state !== "established") throw new Error("expected established facts");
    expect(outcome.facts.gaussians.properties.map((property) => property.name)).toEqual(
      properties.map((property) => property.name),
    );
    expect(outcome.facts.gaussians.properties.find((property) => property.name === "x"))
      .toMatchObject({ byteOffset: 56 * 4, role: "position", roleIndex: 0 });
  });

  it("establishes Graphdeco-style optional normals and reports their offsets", async () => {
    const outcome = await inspect(plyFixture({ properties: graphdecoProperties(45), count: 1 }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        gaussians: {
          vertexStrideBytes: 62 * 4,
          normals: { state: "present", offsets: [12, 16, 20] },
          sphericalHarmonics: { degree: 3 },
        },
      },
    });
  });

  for (const [degree, restCount] of [[0, 0], [1, 9], [2, 24], [3, 45], [4, 72]] as const) {
    it(`derives complete contiguous SH degree ${String(degree)}`, async () => {
      const outcome = await inspect(plyFixture({
        properties: [...coreProperties(), ...restProperties(restCount)],
      }));
      expect(outcome).toMatchObject({
        state: "established",
        facts: { gaussians: { sphericalHarmonics: { degree, nonDcPropertyCount: restCount } } },
      });
    });
  }

  it("normalizes every classic scalar alias for fixed-width extras and accepts CRLF", async () => {
    const aliases = Object.keys(WIDTH_BY_TYPE);
    const extras = aliases.map((type, index) => ({ type, name: `vendor_${String(index)}` }));
    const outcome = await inspect(plyFixture({
      properties: [...coreProperties("float32"), ...extras],
      eol: "\r\n",
      objInfo: ["non-authoritative declaration"],
    }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        header: {
          lineEndings: "crlf",
          objInfo: { count: 1, retainedVerbatim: false, authoritative: false },
        },
        gaussians: { extraProperties: { count: aliases.length, names: extras.map((item) => item.name) } },
      },
    });
    if (outcome.state !== "established") throw new Error("expected established facts");
    expect(outcome.facts.gaussians.properties.slice(-aliases.length).map((property) => property.canonicalType))
      .toEqual([
        "int8", "int8", "uint8", "uint8", "int16", "int16", "uint16", "uint16",
        "int32", "int32", "uint32", "uint32", "float32", "float32", "float64", "float64",
      ]);
  });

  it("accepts printable non-whitespace PLY names for fixed-width extras", async () => {
    const extraNames = ["0_vendor", "vendor:confidence", "vendor+quality", "vendor@source"];
    const outcome = await inspect(plyFixture({
      properties: [
        ...coreProperties(),
        ...extraNames.map((name) => ({ type: "float", name })),
      ],
    }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: { gaussians: { extraProperties: { count: extraNames.length, names: extraNames } } },
    });

    const extraElement = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      ...coreProperties().map((property) => `property ${property.type} ${property.name}`),
      "element 0-vendor:metadata 0",
      "property uchar vendor+flag",
      "end_header",
      "",
    ].join("\n");
    expectFailure(
      await inspect(Buffer.concat([Buffer.from(extraElement), Buffer.alloc(14 * 4)])),
      "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED",
    );
  });

  it("does not promote noncanonical or out-of-range reserved-family confusers", async () => {
    const confusers = ["f_dc_3", "f_dc_x", "f_rest_01", "scale_3", "scale_x", "rot_4", "rot_x"];
    const outcome = await inspect(plyFixture({
      properties: [...coreProperties(), ...confusers.map((name) => ({ type: "float", name }))],
    }));
    expect(outcome).toMatchObject({
      state: "established",
      facts: { gaussians: { sphericalHarmonics: { degree: 0 }, extraProperties: { names: confusers } } },
    });
    if (outcome.state !== "established") throw new Error("expected established facts");
    expect(outcome.facts.gaussians.properties
      .filter((property) => confusers.includes(property.name))
      .every((property) => property.role === "extra" && property.roleIndex === null)).toBe(true);
  });

  it("classifies missing, mistyped, incomplete-normal, and incomplete-SH profiles as unsupported", async () => {
    expectFailure(
      await inspect(plyFixture({ properties: coreProperties().filter((property) => property.name !== "opacity") })),
      "GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING",
    );
    expectFailure(
      await inspect(plyFixture({
        properties: coreProperties().map((property) =>
          property.name === "x" ? { ...property, type: "double" } : property
        ),
      })),
      "GAUSSIAN_PLY_REQUIRED_PROPERTY_TYPE_MISMATCH",
    );
    expectFailure(
      await inspect(plyFixture({ properties: [...coreProperties(), { type: "float", name: "nx" }] })),
      "GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID",
    );
    const shWithReplacement = restProperties(9).map((property) =>
      property.name === "f_rest_1" ? { ...property, name: "f_rest_01" } : property
    );
    expectFailure(
      await inspect(plyFixture({ properties: [...coreProperties(), ...shWithReplacement] })),
      "GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED",
    );
  });

  it("rejects duplicate properties and malformed classic headers", async () => {
    expectFailure(
      await inspect(plyFixture({ properties: [...coreProperties(), { type: "float", name: "x" }] })),
      "GAUSSIAN_PLY_DUPLICATE_PROPERTY",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex nope\nend_header\n")),
      "GAUSSIAN_PLY_VERTEX_COUNT_INVALID",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\n end_header \n")),
      "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID",
    );
    expectFailure(
      await inspect(Buffer.from(" ply\nformat binary_little_endian 1.0\nend_header\n")),
      "GAUSSIAN_PLY_CONTAINER_UNRECOGNIZED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID",
    );
  });

  it("does not case-fold format encodings or declared scalar types", async () => {
    expectFailure(
      await inspect(Buffer.from("ply\nformat BINARY_LITTLE_ENDIAN 1.0\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat Binary_Little_Endian 1.0\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
    );
    for (const type of ["FLOAT", "Float"]) {
      expectFailure(
        await inspect(plyFixture({
          properties: coreProperties().map((property) =>
            property.name === "x" ? { ...property, type } : property
          ),
        })),
        "GAUSSIAN_PLY_SCALAR_TYPE_UNSUPPORTED",
      );
    }
  });

  it("classifies excluded PLY encodings, versions, elements, lists, and scalar types", async () => {
    expectFailure(
      await inspect(Buffer.from("ply\nformat ascii 1.0\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_big_endian 1.0\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.1\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_VERSION_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian_compressed 1.0\nelement vertex 1\nend_header\n")),
      "GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty list uchar int vertex_indices\nend_header\n")),
      "GAUSSIAN_PLY_LIST_PROPERTY_UNSUPPORTED",
    );
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty half x\nend_header\n")),
      "GAUSSIAN_PLY_SCALAR_TYPE_UNSUPPORTED",
    );
    const extraElement = [
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      ...coreProperties().map((property) => `property ${property.type} ${property.name}`),
      "element face 0",
      "end_header",
      "",
    ].join("\n");
    expectFailure(await inspect(Buffer.concat([Buffer.from(extraElement), Buffer.alloc(14 * 4)])),
      "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED");
  });

  it("recognizes complete legacy and current PlayCanvas packed schemas", async () => {
    for (const fixture of [
      packedPlyFixture(),
      packedPlyFixture({ colorChunkBounds: true }),
      packedPlyFixture({ colorChunkBounds: true, shPropertyCount: 9 }),
      packedPlyFixture({ colorChunkBounds: true, shPropertyCount: 24 }),
      packedPlyFixture({ colorChunkBounds: true, shPropertyCount: 45 }),
    ]) {
      expectFailure(await inspect(fixture), "GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED");
    }
  });

  it("does not classify isolated packed-looking extras or incomplete schemas as compressed", async () => {
    const classicWithPackedExtras = await inspect(plyFixture({
      properties: [
        ...coreProperties(),
        ...PACKED_VERTEX_PROPERTIES.map((name) => ({ type: "uint", name })),
      ],
    }));
    expect(classicWithPackedExtras).toMatchObject({
      state: "established",
      facts: {
        gaussians: {
          extraProperties: { count: PACKED_VERTEX_PROPERTIES.length, names: PACKED_VERTEX_PROPERTIES },
        },
      },
    });

    expectFailure(
      await inspect(packedPlyFixture({ chunkCountDelta: 1 })),
      "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED",
    );

    const incomplete = [
      "ply",
      "format binary_little_endian 1.0",
      "element chunk 1",
      ...PACKED_REQUIRED_CHUNK_PROPERTIES.map((name) => `property float ${name}`),
      "element vertex 1",
      ...PACKED_VERTEX_PROPERTIES.slice(0, -1).map((name) => `property uint ${name}`),
      "end_header",
      "",
    ].join("\n");
    expectFailure(await inspect(Buffer.from(incomplete)), "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED");
  });

  it("reports bounded-header encoding and truncation failures", async () => {
    expectFailure(
      await inspect(Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\n")),
      "GAUSSIAN_PLY_HEADER_TRUNCATED",
    );
    const invalid = Buffer.from("ply\nformat binary_little_endian 1.0\ncomment x\nelement vertex 1\nend_header\n");
    invalid[44] = 0xff;
    expectFailure(await inspect(invalid), "GAUSSIAN_PLY_HEADER_ENCODING_INVALID");
  });

  it("enforces header, line, declaration, vertex, and layout resource limits", async () => {
    const longLine = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      `comment ${"a".repeat(FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES + 1)}`,
      "end_header",
      "",
    ].join("\n"));
    expectFailure(await inspect(longLine), "GAUSSIAN_PLY_HEADER_LINE_LIMIT_EXCEEDED");

    const largeHeader = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      ...Array.from({ length: 20 }, (_, index) => `comment ${String(index)} ${"a".repeat(60_000)}`),
      "end_header",
      "",
    ].join("\n"));
    expect(largeHeader.length).toBeGreaterThan(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES);
    expectFailure(await inspect(largeHeader), "GAUSSIAN_PLY_HEADER_SIZE_LIMIT_EXCEEDED");

    const manyComments = plyFixture({
      comments: Array.from({ length: FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT + 1 }, () => "x"),
    });
    expectFailure(await inspect(manyComments), "GAUSSIAN_PLY_COMMENT_LIMIT_EXCEEDED");

    const manyElements = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      ...Array.from({ length: FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT + 1 }, (_, index) =>
        `element ${index === 0 ? "vertex" : `vendor_${String(index)}`} 1`
      ),
      "end_header",
      "",
    ].join("\n"));
    expectFailure(await inspect(manyElements), "GAUSSIAN_PLY_ELEMENT_LIMIT_EXCEEDED");

    const manyProperties = plyFixture({
      properties: [
        ...coreProperties(),
        ...Array.from(
          { length: FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT - coreProperties().length + 1 },
          (_, index) => ({ type: "uchar", name: `vendor_${String(index)}` }),
        ),
      ],
      count: 1,
    });
    expectFailure(await inspect(manyProperties), "GAUSSIAN_PLY_PROPERTY_LIMIT_EXCEEDED");

    const tooManyVertices = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${String(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT + 1)}`,
      "end_header",
      "",
    ].join("\n"));
    expectFailure(await inspect(tooManyVertices), "GAUSSIAN_PLY_VERTEX_COUNT_LIMIT_EXCEEDED");

    const oversizedLayout = Buffer.from([
      "ply",
      "format binary_little_endian 1.0",
      `element vertex ${String(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT)}`,
      ...coreProperties().map((property) => `property ${property.type} ${property.name}`),
      ...Array.from({ length: 250 }, (_, index) => `property double vendor_${String(index)}`),
      "end_header",
      "",
    ].join("\n"));
    expectFailure(await inspect(oversizedLayout), "GAUSSIAN_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
  });

  it("requires exact payload length without decoding attribute values", async () => {
    expectFailure(await inspect(plyFixture({ payloadDelta: -1 })), "GAUSSIAN_PLY_PAYLOAD_LENGTH_MISMATCH");
    expectFailure(await inspect(plyFixture({ payloadDelta: 1 })), "GAUSSIAN_PLY_PAYLOAD_LENGTH_MISMATCH");
    const arbitraryValues = plyFixture();
    arbitraryValues.fill(0xff, arbitraryValues.length - 14 * 4 * 2);
    expect((await inspect(arbitraryValues)).state).toBe("established");
  });

  it("returns stable source-size, same-handle mutation, read, and cancellation outcomes", async () => {
    const bytes = plyFixture();
    expectFailure(await inspect(bytes, { fileSize: -1 }), "GAUSSIAN_PLY_SOURCE_SIZE_INVALID");
    expectFailure(
      await inspect(bytes, { fileSize: FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES + 1 }),
      "GAUSSIAN_PLY_SOURCE_SIZE_LIMIT_EXCEEDED",
    );
    expectFailure(await inspect(bytes, { fileSize: bytes.length + 1 }), "GAUSSIAN_PLY_SOURCE_SIZE_MISMATCH");

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
        await inspectGaussianPlySourceFacts(handle, bytes.length, SHA256),
        "GAUSSIAN_PLY_SOURCE_CHANGED",
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
        await inspectGaussianPlySourceFacts(handle, bytes.length, SHA256),
        "GAUSSIAN_PLY_HANDLE_READ_FAILED",
      );
    });

    const controller = new AbortController();
    controller.abort();
    expectFailure(await inspect(bytes, { signal: controller.signal }), "GAUSSIAN_PLY_INSPECTION_CANCELLED");
  });

  it("keeps the failure registries frozen and category-complete", () => {
    expect(Object.isFrozen(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toBe(true);
    expect(Object.keys(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE)).toEqual(
      FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES,
    );
    expect(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE.GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING)
      .toBe("unsupported_variant");
  });
});

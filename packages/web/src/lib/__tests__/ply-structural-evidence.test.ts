import { describe, expect, it } from "vitest";
import { parsePlyStructuralEvidence } from "../ply-structural-evidence.js";

function binaryPly(
  positions: readonly (readonly [number, number, number])[],
  faces: readonly (readonly number[])[],
  options: {
    readonly extraHeaderLines?: readonly string[];
    readonly trailingByteCount?: number;
  } = {},
): ArrayBuffer {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${String(positions.length)}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${String(faces.length)}`,
    "property list uchar uint vertex_indices",
    ...(options.extraHeaderLines ?? []),
    "end_header",
    "",
  ].join("\n");
  const headerBytes = new TextEncoder().encode(header);
  const bodyBytes = positions.length * 12
    + faces.reduce((total, face) => total + 1 + face.length * 4, 0)
    + (options.trailingByteCount ?? 0);
  const bytes = new Uint8Array(headerBytes.length + bodyBytes);
  bytes.set(headerBytes);
  const view = new DataView(bytes.buffer);
  let offset = headerBytes.length;
  for (const position of positions) {
    for (const value of position) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  for (const face of faces) {
    view.setUint8(offset, face.length);
    offset += 1;
    for (const index of face) {
      view.setUint32(offset, index, true);
      offset += 4;
    }
  }
  return bytes.buffer;
}

describe("parsePlyStructuralEvidence", () => {
  it("preserves indexed source geometry and labels computed normals as derived", () => {
    const parsed = parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 1, 2]],
    ));

    expect(parsed.header).toMatchObject({ vertexCount: 3, faceCount: 1 });
    expect(parsed.geometryState).toMatchObject({
      indexed: true,
      positionCount: 3,
      indexCount: 3,
      triangleCount: 1,
      degenerateTriangleCount: 0,
      nonFinitePositionScalarCount: 0,
      outOfRangeIndexCount: 0,
      sourceAttributes: ["position"],
      derivedAttributes: ["normal"],
      localBounds: { min: [0, 0, 0], max: [1, 1, 0] },
    });
    expect(parsed.geometry.getAttribute("normal")).toBeDefined();
    parsed.geometry.dispose();
  });

  it("rejects point-only and non-triangle topology", () => {
    expect(() => parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [],
    ))).toThrow(/positive face count|indexed triangle geometry/u);
    expect(() => parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0, 1, 2, 3]],
    ))).toThrow(/exactly three/u);
    expect(() => parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0, 1, 2, 3], [0, 1]],
    ))).toThrow(/exactly three/u);
  });

  it("rejects unsupported header fields and unconsumed body bytes", () => {
    const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as const;
    const faces = [[0, 1, 2]] as const;
    expect(() => parsePlyStructuralEvidence(binaryPly(
      positions,
      faces,
      { extraHeaderLines: ["property uchar confidence"] },
    ))).toThrow(/unsupported elements or properties/u);
    expect(() => parsePlyStructuralEvidence(binaryPly(
      positions,
      faces,
      { trailingByteCount: 1 },
    ))).toThrow(/trailing body bytes/u);
  });

  it("rejects non-finite positions and out-of-range indices", () => {
    expect(() => parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [Number.NaN, 0, 0], [0, 1, 0]],
      [[0, 1, 2]],
    ))).toThrow(/non-finite/u);
    expect(() => parsePlyStructuralEvidence(binaryPly(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 1, 7]],
    ))).toThrow(/out-of-range/u);
  });
});

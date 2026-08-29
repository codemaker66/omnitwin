import type { VisualLineagePlyMeshRuntimeStateV0 } from "@omnitwin/types";
import { BufferAttribute, type BufferGeometry } from "three";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

type PlyHeaderState = VisualLineagePlyMeshRuntimeStateV0["header"];
type PlyGeometryState = VisualLineagePlyMeshRuntimeStateV0["geometry"];

export interface ParsedPlyStructuralEvidence {
  readonly geometry: BufferGeometry;
  readonly header: PlyHeaderState;
  readonly geometryState: PlyGeometryState;
}

interface ParsedPlyHeader {
  readonly state: PlyHeaderState;
  readonly bodyOffset: number;
}

function parsePositiveCount(line: string | undefined, element: "vertex" | "face"): number {
  const match = new RegExp(`^element ${element} ([0-9]+)$`, "u").exec(line ?? "");
  const count = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`PLY structural evidence requires a positive ${element} count.`);
  }
  return count;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function parseHeader(bytes: ArrayBuffer): ParsedPlyHeader {
  const prefixLength = Math.min(bytes.byteLength, 64 * 1024);
  const prefixBytes = new Uint8Array(bytes, 0, prefixLength);
  const lfMarker = new TextEncoder().encode("end_header\n");
  const crlfMarker = new TextEncoder().encode("end_header\r\n");
  const lfIndex = findBytes(prefixBytes, lfMarker);
  const crlfIndex = findBytes(prefixBytes, crlfMarker);
  const useCrLf = crlfIndex >= 0 && (lfIndex < 0 || crlfIndex <= lfIndex);
  const marker = useCrLf ? crlfMarker : lfMarker;
  const markerIndex = useCrLf ? crlfIndex : lfIndex;
  if (markerIndex < 0) {
    throw new Error("PLY structural evidence is missing a bounded end_header marker.");
  }
  const bodyOffset = markerIndex + marker.length;
  const headerText = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(bytes, 0, bodyOffset),
  );
  const lines = headerText
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("comment "));
  if (lines[0] !== "ply" || lines[1] !== "format binary_little_endian 1.0") {
    throw new Error("PLY structural evidence requires binary little-endian PLY 1.0.");
  }
  const vertexElementIndex = lines.findIndex((line) => line.startsWith("element vertex "));
  const faceElementIndex = lines.findIndex((line) => line.startsWith("element face "));
  if (vertexElementIndex < 0 || faceElementIndex <= vertexElementIndex) {
    throw new Error("PLY structural evidence requires ordered vertex and face elements.");
  }
  const vertexCount = parsePositiveCount(lines[vertexElementIndex], "vertex");
  const faceCount = parsePositiveCount(lines[faceElementIndex], "face");
  const vertexProperties = lines.slice(vertexElementIndex + 1, faceElementIndex);
  if (
    vertexProperties.length !== 3
    || vertexProperties[0] !== "property float x"
    || vertexProperties[1] !== "property float y"
    || vertexProperties[2] !== "property float z"
  ) {
    throw new Error("PLY structural evidence requires XYZ float positions and no unlabelled vertex appearance channels.");
  }
  if (lines[faceElementIndex + 1] !== "property list uchar uint vertex_indices") {
    throw new Error("PLY structural evidence requires uchar/uint indexed faces.");
  }
  if (
    vertexElementIndex !== 2
    || faceElementIndex !== 6
    || lines.length !== 9
    || lines[8] !== "end_header"
  ) {
    throw new Error("PLY structural evidence contains unsupported elements or properties.");
  }
  return {
    bodyOffset,
    state: {
      encoding: "binary_little_endian",
      version: "1.0",
      vertexCount,
      faceCount,
      vertexProperties: ["float x", "float y", "float z"],
      faceList: { countType: "uchar", itemType: "uint", name: "vertex_indices" },
    },
  };
}

function validateBinaryTriangleBody(
  bytes: ArrayBuffer,
  header: PlyHeaderState,
  bodyOffset: number,
): void {
  const vertexBytes = header.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(vertexBytes) || bodyOffset + vertexBytes > bytes.byteLength) {
    throw new Error("PLY structural evidence has a truncated or unsafe vertex body.");
  }
  let offset = bodyOffset + vertexBytes;
  const triangleIndexBytes = 3 * Uint32Array.BYTES_PER_ELEMENT;
  const view = new DataView(bytes);
  for (let face = 0; face < header.faceCount; face += 1) {
    if (offset >= bytes.byteLength) {
      throw new Error(`PLY structural evidence is truncated before face ${String(face)}.`);
    }
    const arity = view.getUint8(offset);
    offset += Uint8Array.BYTES_PER_ELEMENT;
    if (arity !== 3) {
      throw new Error(
        `PLY structural evidence face ${String(face)} has ${String(arity)} indices; every source face must have exactly three.`,
      );
    }
    if (offset + triangleIndexBytes > bytes.byteLength) {
      throw new Error(`PLY structural evidence is truncated within face ${String(face)}.`);
    }
    offset += triangleIndexBytes;
  }
  if (offset !== bytes.byteLength) {
    throw new Error(
      `PLY structural evidence has ${String(bytes.byteLength - offset)} trailing body bytes.`,
    );
  }
}

function typedIndexName(array: ArrayLike<number>): "Uint16Array" | "Uint32Array" {
  if (array instanceof Uint16Array) return "Uint16Array";
  if (array instanceof Uint32Array) return "Uint32Array";
  throw new Error(`PLY structural evidence requires a Uint16Array or Uint32Array index; received ${array.constructor.name}.`);
}

/**
 * Decodes exact source bytes into immutable-position structural evidence.
 * Normals are computed only after source attributes are recorded and remain
 * explicitly derived debug appearance, never captured appearance.
 */
export function parsePlyStructuralEvidence(bytes: ArrayBuffer): ParsedPlyStructuralEvidence {
  const parsedHeader = parseHeader(bytes);
  const header = parsedHeader.state;
  validateBinaryTriangleBody(bytes, header, parsedHeader.bodyOffset);
  const geometry = new PLYLoader().parse(bytes);
  try {
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!(position instanceof BufferAttribute) || index === null) {
      throw new Error("PLY structural evidence requires indexed triangle geometry.");
    }
    if (position.itemSize !== 3 || !(position.array instanceof Float32Array)) {
      throw new Error("PLY structural evidence requires Float32 XYZ positions.");
    }
    if (position.count !== header.vertexCount || index.count % 3 !== 0) {
      throw new Error("PLY structural evidence decoded counts do not match indexed triangle geometry.");
    }

    let nonFinitePositionScalarCount = 0;
    for (const value of position.array) {
      if (!Number.isFinite(value)) nonFinitePositionScalarCount += 1;
    }
    if (nonFinitePositionScalarCount !== 0) {
      throw new Error(`PLY structural evidence contains ${String(nonFinitePositionScalarCount)} non-finite position scalars.`);
    }

    let outOfRangeIndexCount = 0;
    for (const value of index.array) {
      if (!Number.isInteger(value) || value < 0 || value >= position.count) {
        outOfRangeIndexCount += 1;
      }
    }
    if (outOfRangeIndexCount !== 0) {
      throw new Error(`PLY structural evidence contains ${String(outOfRangeIndexCount)} out-of-range indices.`);
    }

    const triangleCount = index.count / 3;
    if (triangleCount !== header.faceCount) {
      throw new Error(
        `PLY structural evidence face count ${String(header.faceCount)} does not match ${String(triangleCount)} decoded triangles.`,
      );
    }
    let degenerateTriangleCount = 0;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = Number(index.array[triangle * 3] ?? -1) * 3;
      const ib = Number(index.array[triangle * 3 + 1] ?? -1) * 3;
      const ic = Number(index.array[triangle * 3 + 2] ?? -1) * 3;
      const abx = (position.array[ib] ?? 0) - (position.array[ia] ?? 0);
      const aby = (position.array[ib + 1] ?? 0) - (position.array[ia + 1] ?? 0);
      const abz = (position.array[ib + 2] ?? 0) - (position.array[ia + 2] ?? 0);
      const acx = (position.array[ic] ?? 0) - (position.array[ia] ?? 0);
      const acy = (position.array[ic + 1] ?? 0) - (position.array[ia + 1] ?? 0);
      const acz = (position.array[ic + 2] ?? 0) - (position.array[ia + 2] ?? 0);
      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;
      if (crossX * crossX + crossY * crossY + crossZ * crossZ === 0) {
        degenerateTriangleCount += 1;
      }
    }

    const sourceAttributes = Object.keys(geometry.attributes).sort();
    if (sourceAttributes.length !== 1 || sourceAttributes[0] !== "position") {
      throw new Error("PLY structural evidence decoded unexpected source attributes.");
    }
    geometry.computeVertexNormals();
    const derivedAttributes = Object.keys(geometry.attributes)
      .filter((name) => !sourceAttributes.includes(name))
      .sort();
    if (derivedAttributes.length !== 1 || derivedAttributes[0] !== "normal") {
      throw new Error("PLY structural evidence did not derive exactly one normal attribute.");
    }
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds === null) throw new Error("PLY structural evidence could not compute local bounds.");

    return {
      geometry,
      header,
      geometryState: {
        indexed: true,
        positionCount: position.count,
        positionItemSize: 3,
        positionArrayType: "Float32Array",
        indexCount: index.count,
        indexArrayType: typedIndexName(index.array),
        triangleCount,
        degenerateTriangleCount,
        degenerateTriangleCriterion: "exact_cross_product_squared_equals_zero",
        nonFinitePositionScalarCount,
        outOfRangeIndexCount,
        sourceAttributes: ["position"],
        derivedAttributes: ["normal"],
        localBounds: {
          min: [bounds.min.x, bounds.min.y, bounds.min.z],
          max: [bounds.max.x, bounds.max.y, bounds.max.z],
        },
      },
    };
  } catch (error: unknown) {
    geometry.dispose();
    throw error;
  }
}

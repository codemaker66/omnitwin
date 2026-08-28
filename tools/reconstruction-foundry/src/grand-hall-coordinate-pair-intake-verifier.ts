import { createHash } from "node:crypto";
import { isSharedArrayBuffer } from "node:util/types";

import {
  GRAND_HALL_COORDINATE_PAIR_MAX_ABS_METRES,
  GrandHallCoordinatePairIntakeV1Schema,
  computeGrandHallRoom9FaceOrdinalInventorySha256,
  computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256,
  computeGrandHallRoom9SharedVertexInventorySha256,
  verifyGrandHallCoordinatePairIntakeV1Successor,
  type GrandHallCoordinatePairExactObjIdentity,
  type GrandHallCoordinatePairIntakeV1,
  type GrandHallCoordinatePairObjAnchorV1,
  type GrandHallCoordinatePairQ9Vec3,
} from "@omnitwin/types";

/**
 * Deferred T-557 library verifier. It is intentionally not wired to the CLI,
 * API, runtime, or supplied real OBJs in this checkpoint and cannot create a
 * landmark, transform, solve, E57 point claim, or authority-bearing handle.
 */

interface ParsedObjFace {
  readonly sourceFaceOrdinal0Based: number;
  readonly resolvedVertexIndices0Based: readonly [number, number, number];
  readonly groupName: string | null;
  readonly materialName: string | null;
}

interface ParsedObj {
  readonly sha256: `sha256:${string}`;
  readonly byteLength: number;
  readonly vertices: readonly GrandHallCoordinatePairQ9Vec3[];
  readonly faces: readonly ParsedObjFace[];
  readonly bounds: {
    readonly min: GrandHallCoordinatePairQ9Vec3;
    readonly max: GrandHallCoordinatePairQ9Vec3;
  };
}

export interface VerifyGrandHallCoordinatePairIntakeObjsInput {
  readonly packet: GrandHallCoordinatePairIntakeV1;
  readonly predecessor?: GrandHallCoordinatePairIntakeV1;
  readonly sourceBigObjBytes: Uint8Array;
  readonly targetMatterPakObjBytes: Uint8Array;
}

export interface VerifiedGrandHallCoordinatePairIntakeObjs {
  readonly authority: "none";
  readonly packetArtifactSha256: string;
  readonly packetState: GrandHallCoordinatePairIntakeV1["state"];
  readonly sourceObjSha256: string;
  readonly targetObjSha256: string;
  readonly sourceAnchorCount: number;
  readonly targetAnchorCount: number;
  readonly room9FaceCount: number;
  readonly room9SharedVertexCount: number;
  readonly rejectedInterfaceFaceCount: number;
  readonly cleanupMarkerFacesVerified: false;
  readonly e57PointSupportVerified: false;
  readonly transformCreated: false;
}

export class GrandHallCoordinatePairIntakeObjVerificationError extends Error {
  readonly code:
    | "INVALID_PACKET"
    | "INVALID_SUCCESSOR"
    | "INVALID_OBJ"
    | "OBJ_IDENTITY_MISMATCH"
    | "ROOM9_INVENTORY_MISMATCH"
    | "ANCHOR_MISMATCH"
    | "INTERFACE_ANCHOR_REJECTED";

  constructor(
    code: GrandHallCoordinatePairIntakeObjVerificationError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GrandHallCoordinatePairIntakeObjVerificationError";
    this.code = code;
  }
}

function fail(
  code: GrandHallCoordinatePairIntakeObjVerificationError["code"],
  message: string,
  cause?: unknown,
): GrandHallCoordinatePairIntakeObjVerificationError {
  return new GrandHallCoordinatePairIntakeObjVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

const Q9_SCALE = 1_000_000_000n;
const MAX_ABS_Q9_INTEGER = BigInt(GRAND_HALL_COORDINATE_PAIR_MAX_ABS_METRES) * Q9_SCALE;
const MAX_OBJ_NUMERIC_TOKEN_LENGTH = 128;
const OBJ_DECIMAL_TOKEN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u;

function q9Integer(value: number): bigint {
  const fixed = value.toFixed(9);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [wholeText = "", fractionText = ""] = unsigned.split(".");
  const whole = BigInt(wholeText.length === 0 ? "0" : wholeText);
  const fraction = BigInt(fractionText.padEnd(9, "0").slice(0, 9));
  const magnitude = whole * Q9_SCALE + fraction;
  return negative ? -magnitude : magnitude;
}

/** Rounds an exact Q18 numerator to Q9, with half steps away from zero. */
function roundQ18NumeratorToQ9(numerator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / Q9_SCALE;
  const remainder = magnitude % Q9_SCALE;
  if (remainder * 2n >= Q9_SCALE) quotient += 1n;
  return negative ? -quotient : quotient;
}

function q9Number(value: bigint): number {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / Q9_SCALE;
  const fraction = (magnitude % Q9_SCALE).toString().padStart(9, "0");
  const parsed = Number(`${negative ? "-" : ""}${whole.toString()}.${fraction}`);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function parseFiniteQ9(value: string | undefined, label: string): number {
  if (value === undefined || value.length === 0) throw fail("INVALID_OBJ", `${label} is missing`);
  if (value.length > MAX_OBJ_NUMERIC_TOKEN_LENGTH) {
    throw fail("INVALID_OBJ", `${label} exceeds the bounded decimal token length`);
  }
  const match = OBJ_DECIMAL_TOKEN.exec(value);
  if (match === null) throw fail("INVALID_OBJ", `${label} is not a finite decimal token`);
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number.parseInt(match[5] ?? "0", 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_OBJ_NUMERIC_TOKEN_LENGTH) {
    throw fail("INVALID_OBJ", `${label} exponent is outside the bounded decimal domain`);
  }
  const digits = `${whole}${fraction}`.replace(/^0+/u, "") || "0";
  let magnitudeQ9 = BigInt(digits);
  const q9Shift = 9 + exponent - fraction.length;
  if (q9Shift >= 0) {
    magnitudeQ9 *= 10n ** BigInt(q9Shift);
  } else {
    const divisor = 10n ** BigInt(-q9Shift);
    let quotient = magnitudeQ9 / divisor;
    const remainder = magnitudeQ9 % divisor;
    if (remainder * 2n >= divisor) quotient += 1n;
    magnitudeQ9 = quotient;
  }
  if (magnitudeQ9 > MAX_ABS_Q9_INTEGER) {
    throw fail("INVALID_OBJ", `${label} is outside the exact Q9 coordinate domain`);
  }
  const signedQ9 = match[1] === "-" && magnitudeQ9 !== 0n ? -magnitudeQ9 : magnitudeQ9;
  return q9Number(signedQ9);
}

function resolveVertexIndex(
  token: string | undefined,
  vertexCount: number,
  lineNumber: number,
): number {
  const raw = token?.split("/", 1)[0];
  if (raw === undefined || !/^-?\d+$/u.test(raw)) {
    throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} has a malformed face index`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed === 0) throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} uses forbidden vertex index zero`);
  const resolved = parsed > 0 ? parsed - 1 : vertexCount + parsed;
  if (resolved < 0 || resolved >= vertexCount) {
    throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} resolves a vertex outside the current inventory`);
  }
  return resolved;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.startsWith("\uFEFF")) throw new Error("UTF-8 BOM is not canonical OBJ input");
    return decoded;
  } catch (error) {
    throw fail("INVALID_OBJ", `${label} is not canonical UTF-8 OBJ text`, error);
  }
}

function parseExactObj(bytes: Uint8Array, label: string): ParsedObj {
  const vertices: GrandHallCoordinatePairQ9Vec3[] = [];
  const faces: ParsedObjFace[] = [];
  let groupName: string | null = null;
  let materialName: string | null = null;
  const text = decodeUtf8(bytes, label);
  const lines = text.split(/\r?\n/u);
  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const fields = line.split(/\s+/u);
    const record = fields[0];
    if (record === "v") {
      if (fields.length !== 4) {
        throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} must contain exactly one xyz vertex`);
      }
      vertices.push([
        parseFiniteQ9(fields[1], `OBJ line ${String(lineNumber)} x`),
        parseFiniteQ9(fields[2], `OBJ line ${String(lineNumber)} y`),
        parseFiniteQ9(fields[3], `OBJ line ${String(lineNumber)} z`),
      ]);
      continue;
    }
    if (record === "g") {
      if (fields.length !== 2 || fields[1] === undefined) {
        throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} must contain exactly one group name`);
      }
      groupName = fields[1];
      continue;
    }
    if (record === "usemtl") {
      if (fields.length !== 2 || fields[1] === undefined) {
        throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} must contain exactly one material name`);
      }
      materialName = fields[1];
      continue;
    }
    if (record === "f") {
      if (fields.length !== 4) {
        throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} is not an original triangle; triangulation is forbidden`);
      }
      const indices = [
        resolveVertexIndex(fields[1], vertices.length, lineNumber),
        resolveVertexIndex(fields[2], vertices.length, lineNumber),
        resolveVertexIndex(fields[3], vertices.length, lineNumber),
      ] as const;
      if (new Set(indices).size !== 3) {
        throw fail("INVALID_OBJ", `OBJ line ${String(lineNumber)} repeats a vertex index`);
      }
      faces.push({
        sourceFaceOrdinal0Based: faces.length,
        resolvedVertexIndices0Based: indices,
        groupName,
        materialName,
      });
    }
  }
  if (vertices.length === 0 || faces.length === 0) {
    throw fail("INVALID_OBJ", `${label} contains no complete vertex/triangle inventory`);
  }
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const vertex of vertices) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return {
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
    vertices,
    faces,
    bounds: { min, max },
  };
}

function vec3Equal(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function verifyObjIdentity(
  actual: ParsedObj,
  expected: GrandHallCoordinatePairExactObjIdentity,
  label: string,
): void {
  if (
    actual.sha256 !== expected.sha256 ||
    actual.byteLength !== expected.byteLength ||
    actual.vertices.length !== expected.vertexRecordCount ||
    actual.faces.length !== expected.faceRecordCount ||
    !vec3Equal(actual.bounds.min, expected.bounds.min) ||
    !vec3Equal(actual.bounds.max, expected.bounds.max)
  ) {
    throw fail("OBJ_IDENTITY_MISMATCH", `${label} bytes, inventory counts, or Q9 bounds differ from the packet binding`);
  }
}

function room9Inventories(
  target: ParsedObj,
  suffix: string,
): {
  readonly faceOrdinals: readonly number[];
  readonly sharedVertexIndices: ReadonlySet<number>;
  readonly interfaceFaceOrdinals: ReadonlySet<number>;
} {
  const roomVertices = new Set<number>();
  const outsideVertices = new Set<number>();
  const faceOrdinals: number[] = [];
  for (const face of target.faces) {
    const isRoom9 = face.groupName?.endsWith(suffix) === true;
    if (isRoom9) faceOrdinals.push(face.sourceFaceOrdinal0Based);
    for (const index of face.resolvedVertexIndices0Based) {
      (isRoom9 ? roomVertices : outsideVertices).add(index);
    }
  }
  const sharedVertexIndices = new Set(
    [...roomVertices].filter((index) => outsideVertices.has(index)).sort((left, right) => left - right),
  );
  const interfaceFaceOrdinals = new Set(
    target.faces
      .filter(
        (face) =>
          face.groupName?.endsWith(suffix) === true &&
          face.resolvedVertexIndices0Based.some((index) => sharedVertexIndices.has(index)),
      )
      .map((face) => face.sourceFaceOrdinal0Based),
  );
  return { faceOrdinals, sharedVertexIndices, interfaceFaceOrdinals };
}

function verifyRoom9Binding(
  packet: GrandHallCoordinatePairIntakeV1,
  target: ParsedObj,
): ReturnType<typeof room9Inventories> {
  const binding = packet.targetBindings.room9;
  const inventories = room9Inventories(target, binding.exactObjGroupSuffix);
  const shared = [...inventories.sharedVertexIndices];
  const interfaces = [...inventories.interfaceFaceOrdinals];
  if (
    inventories.faceOrdinals.length !== binding.faceCount ||
    computeGrandHallRoom9FaceOrdinalInventorySha256(inventories.faceOrdinals) !==
      binding.verifiedFaceOrdinalInventorySha256 ||
    shared.length !== binding.sharedVertexCount ||
    computeGrandHallRoom9SharedVertexInventorySha256(shared) !== binding.sharedVertexInventorySha256 ||
    interfaces.length !== binding.interfaceFaceCount ||
    computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256(interfaces) !==
      binding.interfaceFaceOrdinalInventorySha256
  ) {
    throw fail("ROOM9_INVENTORY_MISMATCH", "MatterPak room-9 face, shared-vertex, or interface-face inventory drifted");
  }
  return inventories;
}

function anchorPosition(
  vertices: readonly [
    GrandHallCoordinatePairQ9Vec3,
    GrandHallCoordinatePairQ9Vec3,
    GrandHallCoordinatePairQ9Vec3,
  ],
  weights: readonly [number, number, number],
): GrandHallCoordinatePairQ9Vec3 {
  const valueAt = (axis: 0 | 1 | 2): number => q9Number(
    roundQ18NumeratorToQ9(
      q9Integer(vertices[0][axis]) * BigInt(weights[0]) +
      q9Integer(vertices[1][axis]) * BigInt(weights[1]) +
      q9Integer(vertices[2][axis]) * BigInt(weights[2]),
    ),
  );
  return [valueAt(0), valueAt(1), valueAt(2)];
}

function verifyAnchor(
  anchor: GrandHallCoordinatePairObjAnchorV1,
  obj: ParsedObj,
  label: string,
  interfaceFaceOrdinals?: ReadonlySet<number>,
): void {
  if (anchor.objSha256 !== obj.sha256) {
    throw fail("ANCHOR_MISMATCH", `${label} names a different OBJ digest`);
  }
  const face = obj.faces[anchor.sourceFaceOrdinal0Based];
  if (face === undefined) throw fail("ANCHOR_MISMATCH", `${label} face ordinal is outside the exact OBJ`);
  if (interfaceFaceOrdinals?.has(face.sourceFaceOrdinal0Based) === true) {
    throw fail("INTERFACE_ANCHOR_REJECTED", `${label} lies on a room-9 face that shares source vertices with another room group`);
  }
  if (
    face.resolvedVertexIndices0Based.some(
      (value, index) => value !== anchor.resolvedVertexIndices0Based[index],
    ) ||
    face.groupName !== anchor.expectedGroupName ||
    face.materialName !== anchor.expectedMaterialName
  ) {
    throw fail("ANCHOR_MISMATCH", `${label} face topology, group, or material differs from the exact source record`);
  }
  const vertices = face.resolvedVertexIndices0Based.map((index) => obj.vertices[index]);
  if (vertices.some((vertex) => vertex === undefined)) {
    throw fail("ANCHOR_MISMATCH", `${label} references a missing source vertex`);
  }
  const exactVertices = vertices as [
    GrandHallCoordinatePairQ9Vec3,
    GrandHallCoordinatePairQ9Vec3,
    GrandHallCoordinatePairQ9Vec3,
  ];
  for (const index of [0, 1, 2] as const) {
    if (!vec3Equal(exactVertices[index], anchor.vertexPositionsQ9[index])) {
      throw fail("ANCHOR_MISMATCH", `${label} Q9 vertex positions differ from the exact source OBJ`);
    }
  }
  const expectedPosition = anchorPosition(exactVertices, anchor.barycentricWeightsQ9);
  if (!vec3Equal(expectedPosition, anchor.positionQ9)) {
    throw fail("ANCHOR_MISMATCH", `${label} position does not equal its exact Q9 barycentric reconstruction`);
  }
}

/**
 * Reopens and verifies only the two exact OBJ witnesses. It creates no point,
 * landmark, transform, solver output, E57 claim, or authority-bearing handle.
 * V1 rejects room-9 faces sharing source vertices with another room group.
 * Cleanup-marker face exclusion remains a separate, explicitly unverified gate.
 */
export function verifyGrandHallCoordinatePairIntakeObjs(
  input: VerifyGrandHallCoordinatePairIntakeObjsInput,
): VerifiedGrandHallCoordinatePairIntakeObjs {
  const privateSnapshot = (value: Uint8Array, label: string): Uint8Array => {
    if (isSharedArrayBuffer(value.buffer)) {
      throw fail("INVALID_OBJ", `${label} cannot use caller-mutable SharedArrayBuffer storage`);
    }
    const snapshot = new Uint8Array(value.byteLength);
    snapshot.set(value);
    return snapshot;
  };
  const sourceBytes = privateSnapshot(input.sourceBigObjBytes, "source BIG OBJ");
  const targetBytes = privateSnapshot(input.targetMatterPakObjBytes, "target MatterPak OBJ");
  let packet: GrandHallCoordinatePairIntakeV1;
  try {
    packet = GrandHallCoordinatePairIntakeV1Schema.parse(input.packet);
  } catch (error) {
    throw fail("INVALID_PACKET", "coordinate-pair packet failed strict schema and digest verification", error);
  }
  if (input.predecessor !== undefined) {
    try {
      verifyGrandHallCoordinatePairIntakeV1Successor(input.predecessor, packet);
    } catch (error) {
      throw fail("INVALID_SUCCESSOR", "coordinate-pair predecessor edge is not exact and immutable", error);
    }
  } else if (packet.revision !== 1) {
    throw fail("INVALID_SUCCESSOR", "a later coordinate-pair revision requires its exact predecessor packet");
  }

  const source = parseExactObj(sourceBytes, "source BIG OBJ");
  const target = parseExactObj(targetBytes, "target MatterPak OBJ");
  verifyObjIdentity(source, packet.sourceBindings.bigObj, "source BIG OBJ");
  verifyObjIdentity(target, packet.targetBindings.matterPakObj, "target MatterPak OBJ");
  const room9 = verifyRoom9Binding(packet, target);

  for (const [index, pair] of packet.coordinatePairs.entries()) {
    verifyAnchor(pair.sourcePoint.anchor, source, `coordinatePairs[${String(index)}].sourcePoint`);
    verifyAnchor(
      pair.targetPoint.anchor,
      target,
      `coordinatePairs[${String(index)}].targetPoint`,
      room9.interfaceFaceOrdinals,
    );
  }

  return Object.freeze({
    authority: "none",
    packetArtifactSha256: packet.artifactSha256,
    packetState: packet.state,
    sourceObjSha256: source.sha256,
    targetObjSha256: target.sha256,
    sourceAnchorCount: packet.coordinatePairs.length,
    targetAnchorCount: packet.coordinatePairs.length,
    room9FaceCount: room9.faceOrdinals.length,
    room9SharedVertexCount: room9.sharedVertexIndices.size,
    rejectedInterfaceFaceCount: room9.interfaceFaceOrdinals.size,
    cleanupMarkerFacesVerified: false,
    e57PointSupportVerified: false,
    transformCreated: false,
  });
}

import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  GrandHallProcessedBigReviewedInventoryV1Schema,
  computeGrandHallProcessedBigInventorySha256,
  computeGrandHallProcessedBigManifestSha256,
  type GrandHallProcessedBigInventoryV1Material,
  type GrandHallProcessedBigReviewedInventoryV1,
} from "@omnitwin/types";
import { z } from "zod";

import {
  GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_DOMAIN,
  GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_SCHEMA,
  GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_STATE,
  GrandHallPoseLineageAuthorityGuardsSchema,
  GrandHallXgridsLccPoseLineageMaterialSchema,
  GrandHallXgridsLccPoseLineageSchema,
  type GrandHallPoseLineageAuthorityGuards,
  type GrandHallXgridsLccPoseLineage,
  type GrandHallXgridsLccPoseLineageMaterial,
} from "./grand-hall-xgrids-lcc-pose-lineage-contract.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import { GRAND_HALL_XGRIDS_SOURCE_POLICY_V1 } from "./grand-hall-xgrids-lcc-preflight.js";

const MAX_RAW_POSES_BYTES = 4 * 1_024 * 1_024;
const MAX_PROCESSED_POSES_BYTES = 3 * 1_024 * 1_024;
const MAX_REPORT_BYTES = 4 * 1_024;
const MAX_INVENTORY_BYTES = 256 * 1_024;
const EXPECTED_RAW_POSE_COUNT = 42_850;
const EXPECTED_PROCESSED_POSE_COUNT = 21_417;
const RETAINED_PROCESSED_POSE_INDEX = 19_890;
const RAW_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)\.\d{6}$/u;
const RAW_TIMESTAMP_PATTERN = /^(?:0|[1-9]\d*)\.\d{6}$/u;
const PROCESSED_TIMESTAMP_PATTERN = /^(?:0|[1-9]\d*)\.\d{1,9}$/u;

export const GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES = Object.freeze({
  rawPosesCsv: Object.freeze({
    locator: "XGRIDS_CAPTURE_ROOT/project_data/poses.csv",
    byteLength: 3_659_287,
    sha256: "sha256:b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127",
  }),
  processedInventory: Object.freeze({
    locator: "REPOSITORY/docs/operations/grand-hall-processed-big-inventory-v1.json",
    byteLength: 111_881,
    sha256: "sha256:f49e04740f11d1d802babcb90995b3e083d91608beba1d0310f76dddc028ebfd",
    inventorySha256: "sha256:1369a3e897e8c6509abc69605ec87de7378fe0a7c38777c24eba95862cbb63fd",
    manifestSha256: "sha256:1837981b720e49c1f251c0cf9658281fba50d698b37882187b651478500389d5",
  }),
  processedPoses: Object.freeze({
    byteLength: 2_561_254,
    sha256: "sha256:7a020e5f1cc00029ce773d1f448804fa1b7f16355412b023320975122556418d",
  }),
  processedReport: Object.freeze({
    byteLength: 607,
    sha256: "sha256:4ebe53c9de2c59a34d5748157f3581acc929d59f75680f6b1cb15aa2944165cb",
  }),
} as const);

const ProcessedPoseSchema = z.object({
  ts: z.string().regex(PROCESSED_TIMESTAMP_PATTERN),
  T: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  R: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  RGB: z.null(),
}).strict();

const ProcessedPoseDocumentSchema = z.object({
  poses: z.array(ProcessedPoseSchema).min(1),
  fusionPoses: z.null(),
}).strict();

export interface GrandHallRawPoseRow {
  readonly timestampNanoseconds: bigint;
  readonly position: readonly [number, number, number];
  readonly quaternionTuple: readonly [number, number, number, number];
}

export interface GrandHallProcessedPoseRow {
  readonly timestampNanoseconds: bigint;
  readonly translation: readonly [number, number, number];
  readonly rotationTuple: readonly [number, number, number, number];
}

interface StableFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly stats: BigIntStats;
}

interface PosePair {
  readonly processedIndex: number;
  readonly rawIndex: number;
  readonly processed: GrandHallProcessedPoseRow;
  readonly raw: GrandHallRawPoseRow;
  readonly absoluteDeltaNanoseconds: number;
}

interface Distribution {
  readonly method: "sorted_nearest_rank_p95_population_mean";
  readonly count: number;
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

export interface GrandHallPoseLineageFileOptions {
  readonly rawRoot: string;
  readonly processedRoot: string;
  readonly inventoryPath: string;
}

export interface GrandHallPoseLineageWriteOptions extends GrandHallPoseLineageFileOptions {
  readonly outputPath: string;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function comparablePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relationship = relative(comparablePath(root), comparablePath(candidate));
  return relationship === "" || (
    relationship !== ".." &&
    !relationship.startsWith(`..${sep}`) &&
    !isAbsolute(relationship)
  );
}

function hasTraversalSegment(value: string): boolean {
  const withoutDrive = /^[A-Za-z]:/u.test(value) ? value.slice(2) : value;
  return withoutDrive.replaceAll("\\", "/").split("/").some(
    (segment) => segment === "." || segment === "..",
  );
}

function requireAbsoluteLocalPath(value: string, label: string): string {
  if (
    value.length === 0 || value.includes("\u0000") || !isAbsolute(value) ||
    value.startsWith("\\\\") || value.startsWith("//") || hasTraversalSegment(value) ||
    (process.platform === "win32" && value.slice(2).includes(":"))
  ) {
    throw new Error(`${label} must be one traversal-free absolute local non-device path.`);
  }
  return resolve(value);
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.birthtimeNs === right.birthtimeNs;
}

async function readExact(handle: FileHandle, byteLength: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const result = await handle.read(bytes, offset, byteLength - offset, offset);
    if (result.bytesRead < 1) throw new Error("Evidence file ended during its exact read.");
    offset += result.bytesRead;
  }
  const probe = Buffer.alloc(1);
  const trailing = await handle.read(probe, 0, 1, byteLength);
  if (trailing.bytesRead !== 0) throw new Error("Evidence file grew during its exact read.");
  return bytes;
}

async function stableRead(
  inputPath: string,
  label: string,
  maximumBytes: number,
  afterRead?: () => Promise<void> | void,
): Promise<StableFile> {
  const absolutePath = requireAbsoluteLocalPath(inputPath, label);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(absolutePath, { bigint: true });
    const canonicalBefore = await realpath(absolutePath);
    if (
      !before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size < 1n || before.size > BigInt(maximumBytes) ||
      comparablePath(absolutePath) !== comparablePath(canonicalBefore)
    ) {
      throw new Error(`${label} must be one bounded direct regular file.`);
    }
    handle = await open(absolutePath, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!sameFileState(before, descriptorBefore)) {
      throw new Error(`${label} descriptor was not bound to its path.`);
    }
    const bytes = await readExact(handle, Number(before.size));
    await afterRead?.();
    const descriptorAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    const canonicalAfter = await realpath(absolutePath);
    if (
      !sameFileState(before, descriptorAfter) || !sameFileState(before, pathAfter) ||
      comparablePath(absolutePath) !== comparablePath(canonicalAfter)
    ) {
      throw new Error(`${label} changed during its stable read.`);
    }
    return {
      absolutePath,
      bytes,
      byteLength: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      stats: pathAfter,
    };
  } finally {
    await handle?.close();
  }
}

async function requireUnchanged(file: StableFile, label: string, maximumBytes: number): Promise<void> {
  const repeated = await stableRead(file.absolutePath, label, maximumBytes);
  if (
    !sameFileState(file.stats, repeated.stats) || file.byteLength !== repeated.byteLength ||
    file.sha256 !== repeated.sha256 || !file.bytes.equals(repeated.bytes)
  ) {
    throw new Error(`${label} changed after its initial stable read.`);
  }
}

function assertIdentity(
  file: StableFile,
  expected: { readonly byteLength: number; readonly sha256: string },
  label: string,
): void {
  if (file.byteLength !== expected.byteLength || file.sha256 !== expected.sha256) {
    throw new Error(`${label} does not match its frozen exact identity.`);
  }
}

function timestampNanoseconds(value: string, pattern: RegExp, label: string): bigint {
  if (!pattern.test(value)) throw new Error(`${label} is not one strict decimal timestamp.`);
  const [whole, fraction = ""] = value.split(".");
  if (whole === undefined) throw new Error(`${label} is missing its whole seconds.`);
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

function requireNonzeroQuaternion(tuple: readonly number[], label: string): void {
  const squaredNorm = tuple.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredNorm) || squaredNorm <= Number.EPSILON) {
    throw new Error(`${label} contains a zero or non-finite quaternion tuple.`);
  }
}

export function parseGrandHallRawPoseCsv(bytes: Buffer): readonly GrandHallRawPoseRow[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("Raw XGRIDS poses.csv is not strict UTF-8.", { cause: error });
  }
  if (text.includes("\r") || text.includes("\u0000")) {
    throw new Error("Raw XGRIDS poses.csv must use LF-only text without NUL bytes.");
  }
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body.length === 0 || body.includes("\n\n")) {
    throw new Error("Raw XGRIDS poses.csv is empty or contains a blank row.");
  }
  const rows: GrandHallRawPoseRow[] = [];
  let previousTimestamp: bigint | null = null;
  for (const [index, line] of body.split("\n").entries()) {
    const fields = line.split(",");
    if (
      fields.length !== 8 || !RAW_TIMESTAMP_PATTERN.test(fields[0] ?? "") ||
      fields.slice(1).some((field) => !RAW_NUMBER_PATTERN.test(field) || !Number.isFinite(Number(field)))
    ) {
      throw new Error(`Raw XGRIDS pose row ${String(index)} is not eight strict finite decimal columns.`);
    }
    const timestamp = timestampNanoseconds(fields[0] ?? "", RAW_TIMESTAMP_PATTERN, "Raw timestamp");
    if (previousTimestamp !== null && timestamp <= previousTimestamp) {
      throw new Error("Raw XGRIDS pose timestamps must be strictly increasing.");
    }
    previousTimestamp = timestamp;
    const numeric = fields.slice(1).map(Number) as [number, number, number, number, number, number, number];
    const quaternion: readonly [number, number, number, number] = [
      numeric[3], numeric[4], numeric[5], numeric[6],
    ];
    requireNonzeroQuaternion(quaternion, `Raw pose row ${String(index)}`);
    rows.push({
      timestampNanoseconds: timestamp,
      position: [numeric[0], numeric[1], numeric[2]],
      quaternionTuple: quaternion,
    });
  }
  return deepFreeze(rows);
}

export function parseGrandHallProcessedPoseJson(bytes: Buffer): readonly GrandHallProcessedPoseRow[] {
  const document = ProcessedPoseDocumentSchema.parse(parseGrandHallT554StrictJson(bytes));
  const rows: GrandHallProcessedPoseRow[] = [];
  let previousTimestamp: bigint | null = null;
  for (const [index, pose] of document.poses.entries()) {
    const timestamp = timestampNanoseconds(pose.ts, PROCESSED_TIMESTAMP_PATTERN, "Processed timestamp");
    if (previousTimestamp !== null && timestamp <= previousTimestamp) {
      throw new Error("Processed LCC pose timestamps must be strictly increasing.");
    }
    previousTimestamp = timestamp;
    requireNonzeroQuaternion(pose.R, `Processed pose row ${String(index)}`);
    rows.push({
      timestampNanoseconds: timestamp,
      translation: pose.T,
      rotationTuple: pose.R,
    });
  }
  return deepFreeze(rows);
}

function round(value: number, decimalPlaces = 9): number {
  const scale = 10 ** decimalPlaces;
  const result = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Distribution values must be non-empty, finite, and non-negative.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle] as number
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] as number;
  return {
    method: "sorted_nearest_rank_p95_population_mean",
    count: sorted.length,
    minimum: round(sorted[0] as number),
    median: round(median),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: round(p95),
    maximum: round(sorted[sorted.length - 1] as number),
  };
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function pairGrandHallPoseTrajectories(
  rawRows: readonly GrandHallRawPoseRow[],
  processedRows: readonly GrandHallProcessedPoseRow[],
): readonly PosePair[] {
  if (rawRows.length < 2 || processedRows.length < 1) {
    throw new Error("Trajectory pairing requires at least two raw rows and one processed row.");
  }
  const pairs: PosePair[] = [];
  let candidateIndex = 0;
  let previousRawIndex = -1;
  for (const [processedIndex, processed] of processedRows.entries()) {
    while (candidateIndex + 1 < rawRows.length) {
      const current = rawRows[candidateIndex] as GrandHallRawPoseRow;
      const next = rawRows[candidateIndex + 1] as GrandHallRawPoseRow;
      const currentDelta = processed.timestampNanoseconds >= current.timestampNanoseconds
        ? processed.timestampNanoseconds - current.timestampNanoseconds
        : current.timestampNanoseconds - processed.timestampNanoseconds;
      const nextDelta = processed.timestampNanoseconds >= next.timestampNanoseconds
        ? processed.timestampNanoseconds - next.timestampNanoseconds
        : next.timestampNanoseconds - processed.timestampNanoseconds;
      if (nextDelta >= currentDelta) break;
      candidateIndex += 1;
    }
    if (candidateIndex <= previousRawIndex) {
      throw new Error("Nearest timestamp pairing is not strictly monotonic in raw indices.");
    }
    previousRawIndex = candidateIndex;
    const raw = rawRows[candidateIndex] as GrandHallRawPoseRow;
    const delta = processed.timestampNanoseconds >= raw.timestampNanoseconds
      ? processed.timestampNanoseconds - raw.timestampNanoseconds
      : raw.timestampNanoseconds - processed.timestampNanoseconds;
    if (delta > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Timestamp pairing delta exceeds exact integer range.");
    }
    pairs.push({
      processedIndex,
      rawIndex: candidateIndex,
      processed,
      raw,
      absoluteDeltaNanoseconds: Number(delta),
    });
  }
  return deepFreeze(pairs);
}

function normalizedQuaternion(tuple: readonly [number, number, number, number]): readonly [number, number, number, number] {
  const norm = Math.hypot(...tuple);
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
    throw new Error("Quaternion normalization requires a finite non-zero tuple.");
  }
  return [tuple[0] / norm, tuple[1] / norm, tuple[2] / norm, tuple[3] / norm];
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index] as T;
    const rest = values.filter((_value, candidateIndex) => candidateIndex !== index);
    for (const tail of permutations(rest)) output.push([head, ...tail]);
  }
  return output;
}

const QUATERNION_COMPONENTS = ["x", "y", "z", "w"] as const;
type QuaternionComponent = (typeof QUATERNION_COMPONENTS)[number];
const QUATERNION_COMPONENT_INDEX: Readonly<Record<QuaternionComponent, number>> = {
  x: 0,
  y: 1,
  z: 2,
  w: 3,
};

export function evaluateGrandHallQuaternionPermutations(pairs: readonly PosePair[]) {
  if (pairs.length < 1) throw new Error("Quaternion diagnostics require paired trajectories.");
  const unranked = permutations(QUATERNION_COMPONENTS).map((componentOrder) => {
    const label = componentOrder.join("");
    const angles = pairs.map((pair) => {
      const rawReordered = componentOrder.map(
        (component) => pair.raw.quaternionTuple[QUATERNION_COMPONENT_INDEX[component]],
      ) as [number, number, number, number];
      const raw = normalizedQuaternion(rawReordered);
      const processed = normalizedQuaternion(pair.processed.rotationTuple);
      const dot = Math.abs(
        raw[0] * processed[0] + raw[1] * processed[1] +
        raw[2] * processed[2] + raw[3] * processed[3],
      );
      return 2 * Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
    });
    const summary = distribution(angles);
    return {
      label,
      summary,
      residualMicrodegreesSha256: digest(
        "VENVIEWER.GRAND_HALL.POSE_LINEAGE.QUATERNION_RESIDUAL_MICRODEGREES.V1",
        angles.map((angle) => Math.round(angle * 1_000_000)),
      ),
    };
  }).sort((left, right) => left.summary.mean - right.summary.mean || left.label.localeCompare(right.label));
  const scores = unranked.map((score, index) => ({
    rank: index + 1,
    rawComponentOrderToProcessedTuple: score.label,
    signInvariantAngleDegrees: score.summary,
    residualMicrodegreesSha256: score.residualMicrodegreesSha256,
  }));
  const best = scores[0];
  const runnerUp = scores[1];
  if (best?.rawComponentOrderToProcessedTuple !== "wxyz" || runnerUp === undefined) {
    throw new Error("Exact Grand Hall pose evidence no longer yields the frozen wxyz candidate ordering.");
  }
  return deepFreeze({
    method: "normalize_then_sign_invariant_geodesic_angle_all_24_component_permutations" as const,
    rawTupleSemanticsAccepted: false as const,
    processedTupleSemanticsAccepted: false as const,
    scores,
    uniquelyBestCandidate: {
      rawComponentOrderToProcessedTuple: "wxyz" as const,
      runnerUpRawComponentOrderToProcessedTuple: runnerUp.rawComponentOrderToProcessedTuple,
      meanAngleMarginDegrees: round(
        runnerUp.signInvariantAngleDegrees.mean - best.signInvariantAngleDegrees.mean,
      ),
      status: "candidate_component_ordering_only" as const,
    },
  });
}

type Vector3 = readonly [number, number, number];
type Matrix3 = readonly [Vector3, Vector3, Vector3];

function centroid(points: readonly Vector3[]): Vector3 {
  const sum = points.reduce<Vector3>(
    (value, point) => [value[0] + point[0], value[1] + point[1], value[2] + point[2]] as Vector3,
    [0, 0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scaleVector(scale: number, value: Vector3): Vector3 {
  return [scale * value[0], scale * value[1], scale * value[2]];
}

function multiplyMatrixVector(matrix: Matrix3, value: Vector3): Vector3 {
  return [
    matrix[0][0] * value[0] + matrix[0][1] * value[1] + matrix[0][2] * value[2],
    matrix[1][0] * value[0] + matrix[1][1] * value[1] + matrix[1][2] * value[2],
    matrix[2][0] * value[0] + matrix[2][1] * value[1] + matrix[2][2] * value[2],
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function largestEigenvectorSymmetric4(matrix: readonly (readonly number[])[]): readonly [number, number, number, number] {
  const a = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: 4 }, (_value, row) =>
    Array.from({ length: 4 }, (_other, column): number => row === column ? 1 : 0));
  for (let iteration = 0; iteration < 128; iteration += 1) {
    let p = 0;
    let q = 1;
    let maximum = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let column = row + 1; column < 4; column += 1) {
        const magnitude = Math.abs(a[row]?.[column] ?? 0);
        if (magnitude > maximum) {
          maximum = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (maximum < 1e-14) break;
    const app = a[p]?.[p] ?? 0;
    const aqq = a[q]?.[q] ?? 0;
    const apq = a[p]?.[q] ?? 0;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < 4; index += 1) {
      if (index === p || index === q) continue;
      const aip = a[index]?.[p] ?? 0;
      const aiq = a[index]?.[q] ?? 0;
      const updatedP = cosine * aip - sine * aiq;
      const updatedQ = sine * aip + cosine * aiq;
      const rowIndex = a[index];
      const rowP = a[p];
      const rowQ = a[q];
      if (rowIndex !== undefined && rowP !== undefined && rowQ !== undefined) {
        rowIndex[p] = updatedP;
        rowP[index] = updatedP;
        rowIndex[q] = updatedQ;
        rowQ[index] = updatedQ;
      }
    }
    const rowP = a[p];
    const rowQ = a[q];
    if (rowP !== undefined && rowQ !== undefined) {
      rowP[p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
      rowQ[q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
      rowP[q] = 0;
      rowQ[p] = 0;
    }
    for (let row = 0; row < 4; row += 1) {
      const vip = vectors[row]?.[p] ?? 0;
      const viq = vectors[row]?.[q] ?? 0;
      const vectorRow = vectors[row];
      if (vectorRow !== undefined) {
        vectorRow[p] = cosine * vip - sine * viq;
        vectorRow[q] = sine * vip + cosine * viq;
      }
    }
  }
  let selected = 0;
  for (let index = 1; index < 4; index += 1) {
    if ((a[index]?.[index] ?? Number.NEGATIVE_INFINITY) > (a[selected]?.[selected] ?? Number.NEGATIVE_INFINITY)) {
      selected = index;
    }
  }
  const result = [
    vectors[0]?.[selected] ?? 0,
    vectors[1]?.[selected] ?? 0,
    vectors[2]?.[selected] ?? 0,
    vectors[3]?.[selected] ?? 0,
  ] as [number, number, number, number];
  const normalized = normalizedQuaternion(result);
  return normalized[0] < 0
    ? [-normalized[0], -normalized[1], -normalized[2], -normalized[3]]
    : normalized;
}

function quaternionWxyzToMatrix(quaternion: readonly [number, number, number, number]): Matrix3 {
  const [w, x, y, z] = quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function matrixDeterminant(matrix: Matrix3): number {
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}

function roundedVector3(value: Vector3): Vector3 {
  return [round(value[0], 12), round(value[1], 12), round(value[2], 12)];
}

function roundedMatrix3(value: Matrix3): Matrix3 {
  return [roundedVector3(value[0]), roundedVector3(value[1]), roundedVector3(value[2])];
}

function residualSummary(values: readonly number[]) {
  const summary = distribution(values);
  return {
    count: values.length,
    units: "unaccepted_source_coordinate_units" as const,
    rmse: round(Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)),
    median: summary.median,
    p95: summary.p95,
    maximum: summary.maximum,
    residualNanounitsSha256: digest(
      "VENVIEWER.GRAND_HALL.POSE_LINEAGE.SIMILARITY_RESIDUAL_NANOUNITS.V1",
      values.map((value) => Math.round(value * 1_000_000_000)),
    ),
  };
}

export function fitGrandHallDiagnosticSimilarity(pairs: readonly PosePair[]) {
  if (pairs.length < 10) throw new Error("Diagnostic similarity fit requires at least ten pairs.");
  const fitPairs = pairs.filter((pair) => pair.processedIndex % 5 !== 0);
  const heldOutPairs = pairs.filter((pair) => pair.processedIndex % 5 === 0);
  const sourceCentroid = centroid(fitPairs.map((pair) => pair.raw.position));
  const targetCentroid = centroid(fitPairs.map((pair) => pair.processed.translation));
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  let sourceVariance = 0;
  for (const pair of fitPairs) {
    const source = subtract(pair.raw.position, sourceCentroid);
    const target = subtract(pair.processed.translation, targetCentroid);
    sourceVariance += dot(source, source);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const covarianceRow = covariance[row];
        if (covarianceRow !== undefined) {
          covarianceRow[column] = (covarianceRow[column] ?? 0) +
            (source[row] as number) * (target[column] as number);
        }
      }
    }
  }
  if (!Number.isFinite(sourceVariance) || sourceVariance <= Number.EPSILON) {
    throw new Error("Diagnostic similarity fit has degenerate source variance.");
  }
  const sxx = covariance[0]?.[0] ?? 0;
  const sxy = covariance[0]?.[1] ?? 0;
  const sxz = covariance[0]?.[2] ?? 0;
  const syx = covariance[1]?.[0] ?? 0;
  const syy = covariance[1]?.[1] ?? 0;
  const syz = covariance[1]?.[2] ?? 0;
  const szx = covariance[2]?.[0] ?? 0;
  const szy = covariance[2]?.[1] ?? 0;
  const szz = covariance[2]?.[2] ?? 0;
  const quaternion = largestEigenvectorSymmetric4([
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ]);
  const rotation = quaternionWxyzToMatrix(quaternion);
  let scaleNumerator = 0;
  for (const pair of fitPairs) {
    const source = subtract(pair.raw.position, sourceCentroid);
    const target = subtract(pair.processed.translation, targetCentroid);
    scaleNumerator += dot(target, multiplyMatrixVector(rotation, source));
  }
  const scale = scaleNumerator / sourceVariance;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("Diagnostic similarity fit produced a non-positive scale.");
  }
  const translation = subtract(targetCentroid, scaleVector(scale, multiplyMatrixVector(rotation, sourceCentroid)));
  const residuals = (selectedPairs: readonly PosePair[]) => selectedPairs.map((pair) => {
    const predicted = add(scaleVector(scale, multiplyMatrixVector(rotation, pair.raw.position)), translation);
    const difference = subtract(predicted, pair.processed.translation);
    return Math.hypot(...difference);
  });
  return deepFreeze({
    method: "horn_similarity_raw_position_to_processed_translation" as const,
    split: {
      method: "processed_index_modulo_5_equals_0_held_out" as const,
      fitCount: fitPairs.length,
      heldOutCount: heldOutPairs.length,
      splitPredeclaredBeforeFit: true as const,
    },
    scale: round(scale, 12),
    rotation: roundedMatrix3(rotation),
    translation: roundedVector3(translation),
    rotationDeterminant: round(matrixDeterminant(rotation), 12),
    fitResiduals: residualSummary(residuals(fitPairs)),
    heldOutResiduals: residualSummary(residuals(heldOutPairs)),
    interpretation: "diagnostic_alignment_only_residuals_forbid_metric_transform_promotion" as const,
  });
}

function authorityGuards(): GrandHallPoseLineageAuthorityGuards {
  return GrandHallPoseLineageAuthorityGuardsSchema.parse({
    authority: "none",
    trajectoryLineageAccepted: false,
    quaternionComponentOrderingAccepted: false,
    cameraExtrinsicKnown: false,
    poseDirectionKnown: false,
    handednessKnown: false,
    axisSemanticsKnown: false,
    fovKnown: false,
    intrinsicsKnown: false,
    metricUnitsAccepted: false,
    metricTransformAccepted: false,
    e57ToXgridsTransformAccepted: false,
    roomMembershipAccepted: false,
    generatedContentUsed: false,
    trainingPermitted: false,
    reconstructionPermitted: false,
    providerInputPermitted: false,
    runtimePermitted: false,
    stagingPermitted: false,
    publicationPermitted: false,
    productionTrustPermitted: false,
  });
}

function rawPolicyInventorySha256(): string {
  return digest(
    "OMNITWIN_GRAND_HALL_XGRIDS_SOURCE_INVENTORY_V1",
    GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.expectedFiles,
  );
}

function materialFromBundle(bundle: GrandHallXgridsLccPoseLineage): GrandHallXgridsLccPoseLineageMaterial {
  const { bundleSha256: _bundleSha256, ...material } = bundle;
  return GrandHallXgridsLccPoseLineageMaterialSchema.parse(material);
}

function bundleDigest(material: GrandHallXgridsLccPoseLineageMaterial): string {
  return digest(GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_DOMAIN, material);
}

export function sealGrandHallXgridsLccPoseLineage(
  material: GrandHallXgridsLccPoseLineageMaterial,
): GrandHallXgridsLccPoseLineage {
  const parsed = GrandHallXgridsLccPoseLineageMaterialSchema.parse(material);
  return deepFreeze(GrandHallXgridsLccPoseLineageSchema.parse({
    ...parsed,
    bundleSha256: bundleDigest(parsed),
  }));
}

export function serializeGrandHallXgridsLccPoseLineage(bundle: GrandHallXgridsLccPoseLineage): Buffer {
  const parsed = GrandHallXgridsLccPoseLineageSchema.parse(bundle);
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(parsed))}\n`, "utf8");
}

export function parseGrandHallXgridsLccPoseLineage(bytes: Buffer): GrandHallXgridsLccPoseLineage {
  const parsed = GrandHallXgridsLccPoseLineageSchema.parse(parseGrandHallT554StrictJson(bytes));
  const material = materialFromBundle(parsed);
  if (parsed.bundleSha256 !== bundleDigest(material)) {
    throw new Error("Grand Hall pose-lineage receipt self-digest does not match its material.");
  }
  if (!serializeGrandHallXgridsLccPoseLineage(parsed).equals(bytes)) {
    throw new Error("Grand Hall pose-lineage receipt bytes are not canonical.");
  }
  return deepFreeze(parsed);
}

function inventoryMaterial(
  inventory: GrandHallProcessedBigReviewedInventoryV1,
): GrandHallProcessedBigInventoryV1Material {
  const { manifestSha256: _manifestSha256, ...material } = inventory;
  return material;
}

function parseProcessedInventory(file: StableFile): GrandHallProcessedBigReviewedInventoryV1 {
  assertIdentity(file, GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES.processedInventory, "Processed BIG inventory");
  const inventory = GrandHallProcessedBigReviewedInventoryV1Schema.parse(
    parseGrandHallT554StrictJson(file.bytes),
  );
  const expected = GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES.processedInventory;
  if (
    inventory.inventorySha256 !== expected.inventorySha256 ||
    inventory.manifestSha256 !== expected.manifestSha256 ||
    computeGrandHallProcessedBigInventorySha256(inventory.members) !== inventory.inventorySha256 ||
    computeGrandHallProcessedBigManifestSha256(inventoryMaterial(inventory)) !== inventory.manifestSha256
  ) {
    throw new Error("Processed BIG inventory self-digests or reviewed identity drifted.");
  }
  const canonical = Buffer.from(`${stableCanonicalJson(toCanonicalJson(inventory))}\n`, "utf8");
  if (!canonical.equals(file.bytes)) throw new Error("Processed BIG inventory is not canonical JSON.");
  return deepFreeze(inventory);
}

function expectedSidecars(
  inventory: GrandHallProcessedBigReviewedInventoryV1,
  suffix: "poses.json" | "report.json",
) {
  const members = inventory.members.filter((member) => member.relativePath.endsWith(suffix));
  if (members.length !== 9) throw new Error(`Processed BIG inventory must bind exactly nine ${suffix} sidecars.`);
  const packages = new Set(members.map((member) => member.relativePath.split("/")[0]));
  if (packages.size !== 9) throw new Error(`Processed BIG ${suffix} sidecars must cover all nine packages.`);
  return members;
}

async function readProcessedSidecars(
  processedRoot: string,
  inventory: GrandHallProcessedBigReviewedInventoryV1,
  suffix: "poses.json" | "report.json",
) {
  const root = requireAbsoluteLocalPath(processedRoot, "Processed BIG root");
  const rootStat = await lstat(root, { bigint: true });
  const canonicalRoot = await realpath(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || comparablePath(root) !== comparablePath(canonicalRoot)) {
    throw new Error("Processed BIG root must be one direct local directory.");
  }
  const maximumBytes = suffix === "poses.json" ? MAX_PROCESSED_POSES_BYTES : MAX_REPORT_BYTES;
  return Promise.all(expectedSidecars(inventory, suffix).map(async (member) => {
    const absolutePath = resolve(root, ...member.relativePath.split("/"));
    if (!pathIsWithin(root, absolutePath)) throw new Error("Processed sidecar escaped its bound root.");
    const file = await stableRead(absolutePath, `Processed ${suffix} sidecar`, maximumBytes);
    assertIdentity(file, { byteLength: member.sizeBytes, sha256: member.sha256 }, `Processed ${suffix} sidecar`);
    const packageName = member.relativePath.split("/")[0];
    if (packageName === undefined) throw new Error("Processed sidecar package name is absent.");
    return { file, packageName, relativePath: member.relativePath };
  }));
}

function sidecarReceipt(
  value: { readonly file: StableFile; readonly packageName: string; readonly relativePath: string },
) {
  return {
    packageName: value.packageName,
    relativePath: value.relativePath,
    byteLength: value.file.byteLength,
    sha256: value.file.sha256,
  };
}

function assertJsonFinite(value: unknown, label: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${label} contains a non-finite number.`);
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonFinite(item, label);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertJsonFinite(item, label);
  }
}

export async function buildGrandHallXgridsLccPoseLineageFromFiles(
  options: GrandHallPoseLineageFileOptions,
): Promise<GrandHallXgridsLccPoseLineage> {
  const rawRoot = requireAbsoluteLocalPath(options.rawRoot, "Raw XGRIDS root");
  const processedRoot = requireAbsoluteLocalPath(options.processedRoot, "Processed BIG root");
  const inventoryPath = requireAbsoluteLocalPath(options.inventoryPath, "Processed inventory path");
  const rawRelativePath = GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.posesRelativePath;
  const rawPath = resolve(rawRoot, ...rawRelativePath.split("/"));
  if (!pathIsWithin(rawRoot, rawPath)) throw new Error("Raw pose path escaped its bound root.");

  const [rawFile, inventoryFile] = await Promise.all([
    stableRead(rawPath, "Raw XGRIDS poses.csv", MAX_RAW_POSES_BYTES),
    stableRead(inventoryPath, "Processed BIG inventory", MAX_INVENTORY_BYTES),
  ]);
  assertIdentity(rawFile, GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES.rawPosesCsv, "Raw XGRIDS poses.csv");
  const inventory = parseProcessedInventory(inventoryFile);
  const [poseSidecars, reportSidecars] = await Promise.all([
    readProcessedSidecars(processedRoot, inventory, "poses.json"),
    readProcessedSidecars(processedRoot, inventory, "report.json"),
  ]);
  const poseIdentity = GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES.processedPoses;
  const reportIdentity = GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES.processedReport;
  for (const sidecar of poseSidecars) assertIdentity(sidecar.file, poseIdentity, "Processed pose sidecar");
  for (const sidecar of reportSidecars) assertIdentity(sidecar.file, reportIdentity, "Processed report sidecar");
  const firstPoseBytes = poseSidecars[0]?.file.bytes;
  const firstReportBytes = reportSidecars[0]?.file.bytes;
  if (
    firstPoseBytes === undefined || firstReportBytes === undefined ||
    poseSidecars.some((sidecar) => !sidecar.file.bytes.equals(firstPoseBytes)) ||
    reportSidecars.some((sidecar) => !sidecar.file.bytes.equals(firstReportBytes))
  ) {
    throw new Error("The nine processed pose/report sidecar sets are not byte-identical.");
  }

  const rawRows = parseGrandHallRawPoseCsv(rawFile.bytes);
  const processedRows = parseGrandHallProcessedPoseJson(firstPoseBytes);
  if (rawRows.length !== EXPECTED_RAW_POSE_COUNT || processedRows.length !== EXPECTED_PROCESSED_POSE_COUNT) {
    throw new Error("Exact Grand Hall raw or processed pose row count drifted.");
  }
  for (const report of reportSidecars) {
    const value = parseGrandHallT554StrictJson(report.file.bytes);
    assertJsonFinite(value, "Processed report sidecar");
  }
  const pairs = pairGrandHallPoseTrajectories(rawRows, processedRows);
  const increments = new Map<number, number>();
  for (let index = 1; index < pairs.length; index += 1) {
    const increment = (pairs[index]?.rawIndex as number) - (pairs[index - 1]?.rawIndex as number);
    if (increment <= 0) throw new Error("Raw pairing increments must remain positive.");
    increments.set(increment, (increments.get(increment) ?? 0) + 1);
  }
  const pairReceipt = (pair: PosePair) => ({
    processedIndex: pair.processedIndex,
    rawIndex: pair.rawIndex,
    processedTimestampNanoseconds: pair.processed.timestampNanoseconds.toString(),
    rawTimestampNanoseconds: pair.raw.timestampNanoseconds.toString(),
    absoluteDeltaNanoseconds: pair.absoluteDeltaNanoseconds,
  });
  const pairing = {
    method: "nearest_raw_timestamp_monotonic_tie_to_lower_index" as const,
    processedPoseCount: processedRows.length,
    rawPoseCount: rawRows.length,
    pairCount: pairs.length,
    rawIndicesStrictlyIncreasing: true as const,
    firstPair: pairReceipt(pairs[0] as PosePair),
    lastPair: pairReceipt(pairs[pairs.length - 1] as PosePair),
    rawIndexIncrementHistogram: Object.fromEntries(
      [...increments.entries()].sort(([left], [right]) => left - right).map(
        ([increment, count]) => [String(increment), count],
      ),
    ),
    absoluteTimestampDeltaNanoseconds: distribution(
      pairs.map((pair) => pair.absoluteDeltaNanoseconds),
    ),
    pairTableSha256: digest(
      "VENVIEWER.GRAND_HALL.POSE_LINEAGE.NEAREST_TIMESTAMP_PAIR_TABLE.V1",
      pairs.map((pair) => [
        pair.processedIndex,
        pair.rawIndex,
        pair.processed.timestampNanoseconds.toString(),
        pair.raw.timestampNanoseconds.toString(),
        pair.absoluteDeltaNanoseconds,
      ]),
    ),
  };
  const permutationDiagnostic = evaluateGrandHallQuaternionPermutations(pairs);
  const similarityFit = fitGrandHallDiagnosticSimilarity(pairs);
  if (
    similarityFit.split.fitCount !== 17_133 || similarityFit.split.heldOutCount !== 4_284 ||
    similarityFit.heldOutResiduals.rmse < 0.1
  ) {
    throw new Error("Diagnostic similarity evidence no longer supports the frozen non-metric interpretation.");
  }
  const retainedPair = pairs[RETAINED_PROCESSED_POSE_INDEX];
  if (retainedPair === undefined) throw new Error("Retained processed pose candidate is absent.");
  const rawReorderedWxyz = [
    retainedPair.raw.quaternionTuple[3],
    retainedPair.raw.quaternionTuple[0],
    retainedPair.raw.quaternionTuple[1],
    retainedPair.raw.quaternionTuple[2],
  ] as const;

  const material = GrandHallXgridsLccPoseLineageMaterialSchema.parse({
    schemaVersion: GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_SCHEMA,
    state: GRAND_HALL_XGRIDS_LCC_POSE_LINEAGE_STATE,
    authority: "none",
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      scope: "raw_xgrids_to_processed_lcc_pose_sidecar_lineage_diagnostic",
    },
    sourceBindings: {
      rawSourcePolicy: {
        locator: "XGRIDS_CAPTURE_ROOT",
        policy: "GRAND_HALL_XGRIDS_SOURCE_POLICY_V1",
        inventorySha256: rawPolicyInventorySha256(),
        fullTreeReverifiedByThisReceipt: false,
      },
      rawPosesCsv: {
        locator: "XGRIDS_CAPTURE_ROOT/project_data/poses.csv",
        byteLength: rawFile.byteLength,
        sha256: rawFile.sha256,
        rowCount: rawRows.length,
        columnCount: 8,
        timestampUnit: "seconds",
        positionTupleSemantics: "unaccepted_raw_columns_1_2_3",
        quaternionTupleSemantics: "unaccepted_raw_columns_4_5_6_7",
      },
      processedInventory: {
        locator: "REPOSITORY/docs/operations/grand-hall-processed-big-inventory-v1.json",
        byteLength: inventoryFile.byteLength,
        sha256: inventoryFile.sha256,
        schemaVersion: inventory.schemaVersion,
        inventoryId: inventory.inventoryId,
        inventorySha256: inventory.inventorySha256,
        manifestSha256: inventory.manifestSha256,
      },
      processedPoseSidecars: poseSidecars.map(sidecarReceipt),
      processedReportSidecars: reportSidecars.map(sidecarReceipt),
      sharedProcessedPoses: {
        byteLength: poseIdentity.byteLength,
        sha256: poseIdentity.sha256,
        poseCount: processedRows.length,
        fusionPoses: null,
        rgbValues: "all_null",
        allNineFilesByteIdentical: true,
      },
      sharedProcessedReport: {
        byteLength: reportIdentity.byteLength,
        sha256: reportIdentity.sha256,
        allNineFilesByteIdentical: true,
      },
    },
    trajectoryPairing: pairing,
    quaternionPermutationDiagnostic: permutationDiagnostic,
    diagnosticSimilarityFit: similarityFit,
    retainedRotationCandidate: {
      processedPoseIndex: RETAINED_PROCESSED_POSE_INDEX,
      processedTimestampNanoseconds: retainedPair.processed.timestampNanoseconds.toString(),
      processedTranslation: retainedPair.processed.translation,
      processedRotationTuple: retainedPair.processed.rotationTuple,
      pairedRawIndex: retainedPair.rawIndex,
      pairedRawTimestampNanoseconds: retainedPair.raw.timestampNanoseconds.toString(),
      pairedRawTupleReorderedByCandidateWxyz: rawReorderedWxyz,
      status: "trajectory_rotation_tuple_candidate_not_optical_camera_orientation",
      fixedFovApplied: false,
    },
    contract: authorityGuards(),
    blockers: [
      "raw_tuple_semantics_unverified",
      "processed_tuple_semantics_unverified",
      "body_to_camera_extrinsic_absent",
      "pose_direction_unverified",
      "handedness_and_axes_unverified",
      "camera_intrinsics_and_fov_absent",
      "metric_units_unaccepted",
      "diagnostic_similarity_residuals_exceed_metric_use",
      "e57_to_xgrids_transform_absent",
      "grand_hall_room_scope_unaccepted",
    ],
  });

  await Promise.all([
    requireUnchanged(rawFile, "Raw XGRIDS poses.csv", MAX_RAW_POSES_BYTES),
    requireUnchanged(inventoryFile, "Processed BIG inventory", MAX_INVENTORY_BYTES),
    ...poseSidecars.map((sidecar) => requireUnchanged(
      sidecar.file,
      `Processed ${sidecar.relativePath}`,
      MAX_PROCESSED_POSES_BYTES,
    )),
    ...reportSidecars.map((sidecar) => requireUnchanged(
      sidecar.file,
      `Processed ${sidecar.relativePath}`,
      MAX_REPORT_BYTES,
    )),
  ]);
  return sealGrandHallXgridsLccPoseLineage(material);
}

function assertOutputPath(outputPath: string): string {
  return requireAbsoluteLocalPath(outputPath, "Pose-lineage output path");
}

export async function writeGrandHallXgridsLccPoseLineage(
  options: GrandHallPoseLineageWriteOptions,
): Promise<GrandHallXgridsLccPoseLineage> {
  const outputPath = assertOutputPath(options.outputPath);
  const parent = await lstat(dirname(outputPath), { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Pose-lineage output parent must be one direct existing directory.");
  }
  const receipt = await buildGrandHallXgridsLccPoseLineageFromFiles(options);
  const bytes = serializeGrandHallXgridsLccPoseLineage(receipt);
  await writeFile(outputPath, bytes, { flag: "wx" });
  const persisted = await stableRead(outputPath, "Pose-lineage output", MAX_INVENTORY_BYTES);
  const parsed = parseGrandHallXgridsLccPoseLineage(persisted.bytes);
  if (!persisted.bytes.equals(bytes)) throw new Error("Persisted pose-lineage bytes differ from generation.");
  return parsed;
}

export async function checkGrandHallXgridsLccPoseLineage(
  options: GrandHallPoseLineageWriteOptions,
): Promise<GrandHallXgridsLccPoseLineage> {
  const outputPath = assertOutputPath(options.outputPath);
  const expected = await buildGrandHallXgridsLccPoseLineageFromFiles(options);
  const expectedBytes = serializeGrandHallXgridsLccPoseLineage(expected);
  const persisted = await stableRead(outputPath, "Pose-lineage output", MAX_INVENTORY_BYTES);
  const parsed = parseGrandHallXgridsLccPoseLineage(persisted.bytes);
  if (!persisted.bytes.equals(expectedBytes)) {
    throw new Error("Persisted pose-lineage receipt is not the exact regeneration from bound sources.");
  }
  return parsed;
}

export interface GrandHallPoseLineageArguments extends GrandHallPoseLineageWriteOptions {
  readonly check: boolean;
}

export const GRAND_HALL_POSE_LINEAGE_USAGE = [
  "Usage:",
  "  tsx src/grand-hall-xgrids-lcc-pose-lineage-entry.ts --raw-root <absolute XGRIDS capture root> --processed-root <absolute BIG root> --inventory <absolute reviewed inventory JSON> --out <new absolute receipt JSON>",
  "  tsx src/grand-hall-xgrids-lcc-pose-lineage-entry.ts --check --raw-root <absolute XGRIDS capture root> --processed-root <absolute BIG root> --inventory <absolute reviewed inventory JSON> --out <existing absolute receipt JSON>",
].join("\n");

type PathFlag = "--raw-root" | "--processed-root" | "--inventory" | "--out";

function isPathFlag(value: string | undefined): value is PathFlag {
  return value === "--raw-root" || value === "--processed-root" ||
    value === "--inventory" || value === "--out";
}

export function parseGrandHallPoseLineageArguments(
  args: readonly string[],
): GrandHallPoseLineageArguments {
  const values = new Map<PathFlag, string>();
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--check") {
      if (check) throw new Error("Duplicate CLI option: --check.");
      check = true;
      continue;
    }
    if (!isPathFlag(flag)) throw new Error(`Unknown CLI option: ${flag ?? "missing option"}.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate CLI option: ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  const required = (flag: PathFlag): string => {
    const value = values.get(flag)?.trim();
    if (value === undefined || value.length === 0) throw new Error(`Missing required CLI option: ${flag}.`);
    return value;
  };
  return {
    rawRoot: required("--raw-root"),
    processedRoot: required("--processed-root"),
    inventoryPath: required("--inventory"),
    outputPath: required("--out"),
    check,
  };
}

export const __testOnlyGrandHallPoseLineage = Object.freeze({
  stableRead,
  distribution,
  digest,
});

import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
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
  sha256RegularFileWithHead,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import {
  GRAND_HALL_XGRIDS_SOURCE_POLICY_V1,
  verifyGrandHallXgridsSource,
  type GrandHallXgridsVerifiedSourceV1,
} from "./grand-hall-xgrids-lcc-preflight.js";

export const GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_SCHEMA =
  "venviewer.grand-hall.xgrids-xbag-camera-calibration-authority-none.v1";
export const GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_STATE =
  "factory_camera_calibration_recovered_optical_mapping_and_transform_direction_pending";
export const GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_DOMAIN =
  "VENVIEWER.GRAND_HALL.XGRIDS.XBAG.CAMERA_CALIBRATION.AUTHORITY_NONE.V1";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const HEADER_READ_BYTES = 16 * 1024;
const CONFIG_BLOCK_LENGTH_OFFSET = 4_563;
const CONFIG_BLOCK_PAYLOAD_OFFSET = 4_567;
const CONFIG_BLOCK_BYTE_LENGTH = 6_697;
const CONFIG_BLOCK_END_EXCLUSIVE =
  CONFIG_BLOCK_PAYLOAD_OFFSET + CONFIG_BLOCK_BYTE_LENGTH;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const XBIN_EXPECTED = (() => {
  const expected = GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.expectedFiles.find(
    (file) => file.relativePath === GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.xbinRelativePath,
  );
  if (expected === undefined) {
    throw new Error("The frozen Grand Hall XGRIDS policy does not bind its XBIN file.");
  }
  return expected;
})();
const EXPECTED_SOURCE_INVENTORY_SHA256 = `sha256:${domainSeparatedSha256(
  "OMNITWIN_GRAND_HALL_XGRIDS_SOURCE_INVENTORY_V1",
  toCanonicalJson(GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.expectedFiles),
)}`;

export interface GrandHallXbagExpectedRecordV1 {
  readonly fileName:
    | "camera.yaml"
    | "extrinsic_camera_lidar.yaml"
    | "extrinsic_imu_lidar.yaml"
    | "extrinsic_rtk.yaml"
    | "imu.yaml"
    | "lidar_param.yaml";
  readonly recordOffset: number;
  readonly recordMessageByteLength: number;
  readonly recordTimestampMicroseconds: string;
  readonly payloadOffset: number;
  readonly payloadByteLength: number;
  readonly payloadSha256: string;
  readonly finalNewline: boolean;
}

export const GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1 = Object.freeze({
  headerReadBytes: HEADER_READ_BYTES,
  configBlockLengthOffset: CONFIG_BLOCK_LENGTH_OFFSET,
  configBlockPayloadOffset: CONFIG_BLOCK_PAYLOAD_OFFSET,
  configBlockByteLength: CONFIG_BLOCK_BYTE_LENGTH,
  configBlockEndExclusive: CONFIG_BLOCK_END_EXCLUSIVE,
  records: Object.freeze([
    Object.freeze({
      fileName: "camera.yaml",
      recordOffset: 4_567,
      recordMessageByteLength: 2_592,
      recordTimestampMicroseconds: "1780219117551538",
      payloadOffset: 4_597,
      payloadByteLength: 2_565,
      payloadSha256: "sha256:f5d9a485b4a38ac87e1c61c2e912f2e17e567e090af731c3bd2347c8f976f744",
      finalNewline: false,
    }),
    Object.freeze({
      fileName: "extrinsic_camera_lidar.yaml",
      recordOffset: 7_162,
      recordMessageByteLength: 363,
      recordTimestampMicroseconds: "1780219117553252",
      payloadOffset: 7_208,
      payloadByteLength: 320,
      payloadSha256: "sha256:2902d2c132b5f79769d5232cf18f1c59ec2884af1d76f0750a498a0bf71d1e95",
      finalNewline: false,
    }),
    Object.freeze({
      fileName: "extrinsic_imu_lidar.yaml",
      recordOffset: 7_528,
      recordMessageByteLength: 242,
      recordTimestampMicroseconds: "1780219117554730",
      payloadOffset: 7_571,
      payloadByteLength: 202,
      payloadSha256: "sha256:0630cc18e60bb7c52f6f87f3ccfac1a502363a3dacd7f8b0a4253f1a927ce510",
      finalNewline: true,
    }),
    Object.freeze({
      fileName: "extrinsic_rtk.yaml",
      recordOffset: 7_773,
      recordMessageByteLength: 186,
      recordTimestampMicroseconds: "1780219117556046",
      payloadOffset: 7_810,
      payloadByteLength: 152,
      payloadSha256: "sha256:946920e1c684cffb4ec25a0479bcd244926663e6a5bef2f3307b2730697f0303",
      finalNewline: true,
    }),
    Object.freeze({
      fileName: "imu.yaml",
      recordOffset: 7_962,
      recordMessageByteLength: 298,
      recordTimestampMicroseconds: "1780219117556244",
      payloadOffset: 7_989,
      payloadByteLength: 274,
      payloadSha256: "sha256:48fd7beebb760206f3481afa251f811d8484029f0ab58cae4d681d81a1eca6e2",
      finalNewline: true,
    }),
    Object.freeze({
      fileName: "lidar_param.yaml",
      recordOffset: 8_263,
      recordMessageByteLength: 2_998,
      recordTimestampMicroseconds: "1780219117557559",
      payloadOffset: 8_298,
      payloadByteLength: 2_966,
      payloadSha256: "sha256:33a24da5b92632b44f36a4c633bed186693f5f666d163dafa166f3bb62dad2ee",
      finalNewline: true,
    }),
  ] satisfies readonly GrandHallXbagExpectedRecordV1[]),
} as const);

const FiniteNumberSchema = z.number().finite();
const Matrix16Schema = z.array(FiniteNumberSchema).length(16);
const SourceRecordSchema = z.object({
  fileName: z.enum([
    "camera.yaml",
    "extrinsic_camera_lidar.yaml",
    "extrinsic_imu_lidar.yaml",
    "extrinsic_rtk.yaml",
    "imu.yaml",
    "lidar_param.yaml",
  ]),
  recordOffset: z.number().int().nonnegative(),
  recordMessageByteLength: z.number().int().positive(),
  recordTimestampMicroseconds: z.string().regex(/^(?:0|[1-9]\d*)$/u),
  payloadOffset: z.number().int().nonnegative(),
  payloadByteLength: z.number().int().positive(),
  payloadSha256: z.string().regex(SHA256_PATTERN),
  payloadUtf8: z.string().min(1).nullable(),
  finalNewline: z.boolean(),
}).strict();

const MatrixFactsSchema = z.object({
  rowMajor: Matrix16Schema,
  rotationDeterminant: FiniteNumberSchema,
  rotationOrthonormalMaximumAbsoluteError: FiniteNumberSchema.nonnegative(),
  homogeneousLastRow: z.tuple([
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
  ]),
  properRigidTransformNumericallyValidated: z.literal(true),
  sourceMatrixDirection: z.literal("unresolved_source_label_only"),
}).strict();

const CameraSchema = z.object({
  cameraId: z.enum(["camera_0", "camera_1", "camera_2", "camera_3"]),
  deviceCameraName: z.null(),
  deviceCameraNameMappingState: z.literal("unresolved_requires_optical_observation"),
  calibrated: z.literal(true),
  imageWidthPx: z.literal(4_000),
  imageHeightPx: z.literal(3_000),
  cameraModel: z.enum(["kb4", "pinhole"]),
  intrinsicSourceOrder: z.tuple([
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
  ]),
  intrinsicCoefficientSemantics: z.literal("unresolved_source_order_four_values"),
  distortionSourceOrder: z.tuple([
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
    FiniteNumberSchema,
  ]),
  distortionCoefficientSemantics: z.literal("unresolved_source_order"),
  cameraPose: MatrixFactsSchema,
}).strict();

const CrossSensorTransformSchema = z.object({
  sourceFileName: z.enum([
    "extrinsic_camera_lidar.yaml",
    "extrinsic_imu_lidar.yaml",
  ]),
  sourceLabel: z.enum(["camera_lidar", "imu_lidar"]),
  calibrated: z.literal(true),
  calibrationVersion: z.literal("V3.1.1"),
  transform: MatrixFactsSchema,
}).strict();

export const GrandHallXgridsXbagCameraCalibrationMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_SCHEMA),
  state: z.literal(GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_STATE),
  authority: z.literal("none"),
  receiptAuthentication: z.literal("self_digest_integrity_only_live_source_check_required"),
  subject: z.object({
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    scope: z.literal("exact_xbag_factory_camera_calibration_recovery"),
  }).strict(),
  sourceBindings: z.object({
    rawSource: z.object({
      locator: z.literal("XGRIDS_CAPTURE_ROOT"),
      policy: z.literal("GRAND_HALL_XGRIDS_SOURCE_POLICY_V1"),
      exactAllowlistedTreeReverified: z.literal(true),
      inventorySha256: z.literal(EXPECTED_SOURCE_INVENTORY_SHA256),
      xbin: z.object({
        locator: z.literal("XGRIDS_CAPTURE_ROOT/2026-05-31-101837.xbin"),
        byteLength: z.literal(41_095_196_672),
        sha256: z.literal("sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0"),
        signatureHex: z.literal("58424147"),
      }).strict(),
      projectMetadata: z.object({
        locator: z.literal("XGRIDS_CAPTURE_ROOT/project_data/log/project.json"),
        byteLength: z.literal(2_415),
        sha256: z.literal("sha256:3fab1721433beb64e5a34c1916e60730195083dd0887f12db0a0f6b69035bc77"),
        deviceModel: z.literal("PortalCam"),
        cameraNamesSourceOrder: z.tuple([
          z.literal("left_main"),
          z.literal("left_seco"),
          z.literal("right_main"),
          z.literal("right_seco"),
        ]),
      }).strict(),
    }).strict(),
    xbagConfigBlock: z.object({
      framing: z.literal("uint32le_length_prefixed_protobuf_repeated_config_record_v1"),
      headerReadBytes: z.literal(HEADER_READ_BYTES),
      lengthOffset: z.literal(CONFIG_BLOCK_LENGTH_OFFSET),
      payloadOffset: z.literal(CONFIG_BLOCK_PAYLOAD_OFFSET),
      byteLength: z.literal(CONFIG_BLOCK_BYTE_LENGTH),
      endExclusive: z.literal(CONFIG_BLOCK_END_EXCLUSIVE),
      payloadTextRetention: z.literal("camera_and_cross_sensor_calibration_only"),
      records: z.array(SourceRecordSchema).length(6),
    }).strict(),
  }).strict(),
  calibration: z.object({
    sourceCalibrationVersion: z.literal("V3.1.1"),
    sourceCalibrated: z.literal(true),
    deviceCameraNames: z.tuple([
      z.literal("left_main"),
      z.literal("left_seco"),
      z.literal("right_main"),
      z.literal("right_seco"),
    ]),
    sourceCameraIds: z.tuple([
      z.literal("camera_0"),
      z.literal("camera_1"),
      z.literal("camera_2"),
      z.literal("camera_3"),
    ]),
    cameraNameMapping: z.literal("unresolved_requires_optical_observation"),
    cameras: z.array(CameraSchema).length(4),
    crossSensorTransforms: z.array(CrossSensorTransformSchema).length(2),
  }).strict(),
  proof: z.object({
    exactXbinFullFileIdentityVerified: z.literal(true),
    exactAllowlistedSourceTreeVerified: z.literal(true),
    xbagHeaderStableDescriptorRead: z.literal(true),
    protobufWireLengthsParsedNotOffsetSliced: z.literal(true),
    allSixPayloadHashesMatched: z.literal(true),
    allPayloadsStrictUtf8: z.literal(true),
    cameraIntrinsicsRecovered: z.literal(true),
    cameraDistortionCoefficientsRecovered: z.literal(true),
    cameraPoseMatricesRecovered: z.literal(true),
    crossSensorMatricesRecovered: z.literal(true),
    matrixNumericValidityEstablished: z.literal(true),
    cameraNameMappingEstablished: z.literal(false),
    transformDirectionEstablished: z.literal(false),
    opticalFramePayloadRecovered: z.literal(false),
    xgridsToE57TransformEstablished: z.literal(false),
    metricAuthorityGranted: z.literal(false),
    roomMembershipAccepted: z.literal(false),
    generatedContentUsed: z.literal(false),
    trainingPermitted: z.literal(false),
    reconstructionPermitted: z.literal(false),
    providerInputPermitted: z.literal(false),
    runtimePermitted: z.literal(false),
    stagingPermitted: z.literal(false),
    publicationPermitted: z.literal(false),
    deploymentPermitted: z.literal(false),
    productionTrustPermitted: z.literal(false),
    sourceWrites: z.literal("none"),
    applicationNetworkRequests: z.literal("none"),
    authority: z.literal("none"),
  }).strict(),
  blockers: z.tuple([
    z.literal("camera_id_to_device_name_mapping_unresolved"),
    z.literal("camera_pose_matrix_direction_unresolved"),
    z.literal("camera_lidar_matrix_direction_unresolved"),
    z.literal("imu_lidar_matrix_direction_unresolved"),
    z.literal("optical_frame_payload_not_recovered"),
    z.literal("xgrids_to_e57_transform_absent"),
    z.literal("grand_hall_room_scope_unaccepted"),
  ]),
}).strict();

export const GrandHallXgridsXbagCameraCalibrationSchema =
  GrandHallXgridsXbagCameraCalibrationMaterialSchema.extend({
    receiptSha256: z.string().regex(SHA256_PATTERN),
  }).strict();

export type GrandHallXgridsXbagCameraCalibrationMaterial = z.infer<
  typeof GrandHallXgridsXbagCameraCalibrationMaterialSchema
>;
export type GrandHallXgridsXbagCameraCalibration = z.infer<
  typeof GrandHallXgridsXbagCameraCalibrationSchema
>;

interface ParsedWireRecord {
  readonly fileName: GrandHallXbagExpectedRecordV1["fileName"];
  readonly recordOffset: number;
  readonly recordMessageByteLength: number;
  readonly recordTimestampMicroseconds: string;
  readonly payloadOffset: number;
  readonly payload: Buffer;
  readonly payloadSha256: string;
  readonly payloadUtf8: string;
  readonly finalNewline: boolean;
}

interface ParsedCameraYaml {
  readonly calibrated: true;
  readonly version: "V3.1.1";
  readonly cameras: readonly ParsedCamera[];
}

interface ParsedCamera {
  readonly cameraId: "camera_0" | "camera_1" | "camera_2" | "camera_3";
  readonly calibrated: true;
  readonly imageWidthPx: 4_000;
  readonly imageHeightPx: 3_000;
  readonly cameraModel: "kb4" | "pinhole";
  readonly intrinsic: readonly [number, number, number, number];
  readonly distortion: readonly [number, number, number, number];
  readonly cameraPose: readonly number[];
}

interface ParsedTransformYaml {
  readonly calibrated: true;
  readonly version: "V3.1.1";
  readonly transform: readonly number[];
}

export interface GrandHallXbagCalibrationFileOptions {
  readonly rawRoot: string;
  readonly outputPath: string;
  /** @internal Test-only seam; rejected unless NODE_ENV=test. */
  readonly testOnlyBuildReceipt?: () => Promise<GrandHallXgridsXbagCameraCalibration>;
  /** @internal Test-only seam; rejected unless NODE_ENV=test. */
  readonly testOnlyAfterSourceBuild?: () => Promise<void>;
  /** @internal Test-only seam; rejected unless NODE_ENV=test. */
  readonly testOnlyAfterOutputOpen?: (outputPath: string) => Promise<void>;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function comparablePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLocaleLowerCase("en-US")
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
  const windows = value.replaceAll("/", "\\");
  if (
    value.length === 0 || value.includes("\u0000") || !isAbsolute(value) ||
    windows.startsWith("\\\\") || windows.startsWith("\\?\\") ||
    windows.startsWith("\\.\\") || hasTraversalSegment(value) ||
    (process.platform === "win32" && (!/^[A-Za-z]:\\/u.test(windows) || windows.slice(2).includes(":")))
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

function decodeVarint(
  bytes: Uint8Array,
  start: number,
  end: number,
  label: string,
): { readonly value: number; readonly next: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = start;
  while (cursor < end && cursor - start < 10) {
    const byte = bytes[cursor];
    if (byte === undefined) break;
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} exceeds the safe integer range.`);
      }
      if (cursor - start > 1) {
        const minimum = 1n << BigInt(7 * (cursor - start - 1));
        if (value < minimum) throw new Error(`${label} uses a non-canonical varint.`);
      }
      return { value: Number(value), next: cursor };
    }
    shift += 7n;
  }
  throw new Error(`${label} is truncated or exceeds ten varint bytes.`);
}

interface LengthDelimitedField {
  readonly fieldNumber: number;
  readonly fieldOffset: number;
  readonly dataOffset: number;
  readonly dataEnd: number;
  readonly next: number;
}

function readLengthDelimitedField(
  bytes: Uint8Array,
  cursor: number,
  end: number,
  label: string,
): LengthDelimitedField {
  const fieldOffset = cursor;
  const tag = decodeVarint(bytes, cursor, end, `${label} tag`);
  const fieldNumber = Math.floor(tag.value / 8);
  const wireType = tag.value & 7;
  if (fieldNumber < 1 || wireType !== 2) {
    throw new Error(`${label} must be one positive length-delimited protobuf field.`);
  }
  const length = decodeVarint(bytes, tag.next, end, `${label} length`);
  const dataEnd = length.next + length.value;
  if (dataEnd > end || dataEnd < length.next) {
    throw new Error(`${label} payload escapes its containing message.`);
  }
  return {
    fieldNumber,
    fieldOffset,
    dataOffset: length.next,
    dataEnd,
    next: dataEnd,
  };
}

function strictUtf8(bytes: Uint8Array, label: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw new Error(`${label} is not strict UTF-8.`, { cause: error });
  }
  if (
    text.length === 0 || text.charCodeAt(0) === 0xfeff ||
    text.includes("\u0000") || text.includes("\r")
  ) {
    throw new Error(`${label} must be non-empty, BOM-free, NUL-free, LF-only UTF-8.`);
  }
  return text;
}

function parseRecordTimestamp(metadata: Uint8Array, label: string): string {
  const tag = decodeVarint(metadata, 0, metadata.byteLength, `${label} metadata tag`);
  if (tag.value !== 16) throw new Error(`${label} metadata must contain protobuf field 2 varint.`);
  const encoded = decodeVarint(metadata, tag.next, metadata.byteLength, `${label} timestamp`);
  if (encoded.next !== metadata.byteLength) throw new Error(`${label} metadata has trailing bytes.`);
  const unsigned = BigInt(encoded.value);
  const timestamp = (unsigned >> 1n) ^ -(unsigned & 1n);
  if (timestamp < 0n || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} ZigZag timestamp is outside the supported positive safe range.`);
  }
  return timestamp.toString();
}

export function inspectGrandHallXgridsXbagConfigHeader(
  header: Buffer,
  expectedRecords: readonly GrandHallXbagExpectedRecordV1[] =
    GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records,
): readonly ParsedWireRecord[] {
  if (header.byteLength < CONFIG_BLOCK_END_EXCLUSIVE) {
    throw new Error("The XBIN calibration header is truncated.");
  }
  if (header.subarray(0, 4).toString("hex") !== "58424147") {
    throw new Error("The raw source does not begin with the XBAG signature.");
  }
  if (header.readUInt32LE(CONFIG_BLOCK_LENGTH_OFFSET) !== CONFIG_BLOCK_BYTE_LENGTH) {
    throw new Error("The XBIN calibration block length drifted.");
  }
  const records: ParsedWireRecord[] = [];
  let cursor = CONFIG_BLOCK_PAYLOAD_OFFSET;
  while (cursor < CONFIG_BLOCK_END_EXCLUSIVE) {
    const outer = readLengthDelimitedField(
      header,
      cursor,
      CONFIG_BLOCK_END_EXCLUSIVE,
      `XBIN config record ${String(records.length)}`,
    );
    if (outer.fieldNumber !== 1) throw new Error("The XBIN config block contains an unexpected field.");
    let innerCursor = outer.dataOffset;
    const metadata = readLengthDelimitedField(header, innerCursor, outer.dataEnd, "Config metadata");
    innerCursor = metadata.next;
    const name = readLengthDelimitedField(header, innerCursor, outer.dataEnd, "Config filename");
    innerCursor = name.next;
    const payload = readLengthDelimitedField(header, innerCursor, outer.dataEnd, "Config payload");
    innerCursor = payload.next;
    if (
      metadata.fieldNumber !== 1 || name.fieldNumber !== 2 || payload.fieldNumber !== 3 ||
      innerCursor !== outer.dataEnd
    ) {
      throw new Error("Each XBIN config record must contain exactly metadata, filename, and payload fields.");
    }
    const fileNameText = strictUtf8(header.subarray(name.dataOffset, name.dataEnd), "Config filename");
    const expected = expectedRecords[records.length];
    if (expected === undefined || fileNameText !== expected.fileName) {
      throw new Error("The XBIN config record order or filename drifted.");
    }
    const payloadBytes = Buffer.from(header.subarray(payload.dataOffset, payload.dataEnd));
    const payloadSha256 = digestBytes(payloadBytes);
    const recordMessageByteLength = outer.dataEnd - outer.dataOffset;
    const recordTimestampMicroseconds = parseRecordTimestamp(
      header.subarray(metadata.dataOffset, metadata.dataEnd),
      expected.fileName,
    );
    if (
      outer.fieldOffset !== expected.recordOffset ||
      recordMessageByteLength !== expected.recordMessageByteLength ||
      recordTimestampMicroseconds !== expected.recordTimestampMicroseconds ||
      payload.dataOffset !== expected.payloadOffset ||
      payloadBytes.byteLength !== expected.payloadByteLength ||
      payloadSha256 !== expected.payloadSha256
    ) {
      throw new Error(`The exact ${expected.fileName} framing or payload identity drifted.`);
    }
    const payloadUtf8 = strictUtf8(payloadBytes, expected.fileName);
    records.push({
      fileName: expected.fileName,
      recordOffset: outer.fieldOffset,
      recordMessageByteLength,
      recordTimestampMicroseconds,
      payloadOffset: payload.dataOffset,
      payload: payloadBytes,
      payloadSha256,
      payloadUtf8,
      finalNewline: payloadUtf8.endsWith("\n"),
    });
    cursor = outer.next;
  }
  if (cursor !== CONFIG_BLOCK_END_EXCLUSIVE || records.length !== expectedRecords.length) {
    throw new Error("The XBIN config block did not end with the exact six expected records.");
  }
  return deepFreeze(records);
}

function parseNumber(value: string, label: string): number {
  if (!NUMBER_PATTERN.test(value)) throw new Error(`${label} is not one strict finite YAML number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not finite.`);
  return parsed;
}

function parseInlineNumberList(value: string, label: string): readonly number[] {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    throw new Error(`${label} must be one inline numeric YAML list.`);
  }
  const body = value.slice(1, -1);
  if (body.length === 0) return [];
  return body.split(",").map((item, index) => parseNumber(item.trim(), `${label}[${String(index)}]`));
}

interface MutableCamera {
  cameraId: ParsedCamera["cameraId"];
  calibrated?: true;
  imageWidthPx?: 4_000;
  imageHeightPx?: 3_000;
  cameraModel?: ParsedCamera["cameraModel"];
  intrinsic?: number[];
  distortion?: number[];
  cameraPose?: number[];
}

function exactTuple4(values: readonly number[] | undefined, label: string): [number, number, number, number] {
  if (values === undefined || values.length !== 4) throw new Error(`${label} must contain exactly four numbers.`);
  return [values[0] as number, values[1] as number, values[2] as number, values[3] as number];
}

export function parseGrandHallPortalCamCameraYaml(text: string): ParsedCameraYaml {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const cameras = new Map<ParsedCamera["cameraId"], MutableCamera>();
  let current: MutableCamera | null = null;
  let listKey: "cameraPose" | "intrinsic" | "distortion" | null = null;
  let rootCalibrated: true | undefined;
  let rootVersion: "V3.1.1" | undefined;
  for (const [lineIndex, line] of lines.entries()) {
    const cameraMatch = /^(camera_[0-3]):$/u.exec(line);
    if (cameraMatch !== null) {
      const cameraId = cameraMatch[1] as ParsedCamera["cameraId"];
      if (cameras.has(cameraId)) throw new Error(`camera.yaml duplicates ${cameraId}.`);
      current = { cameraId };
      cameras.set(cameraId, current);
      listKey = null;
      continue;
    }
    const listMatch = /^ {4}- (.+)$/u.exec(line);
    if (listMatch !== null) {
      if (current === null || listKey === null) {
        throw new Error(`camera.yaml line ${String(lineIndex + 1)} has an orphan list item.`);
      }
      (current[listKey] ??= []).push(parseNumber(listMatch[1] as string, `${current.cameraId}.${listKey}`));
      continue;
    }
    const memberMatch = /^ {2}([a-z_]+):(?: (.+))?$/u.exec(line);
    if (memberMatch !== null) {
      if (current === null) throw new Error("camera.yaml has a camera member outside a camera block.");
      const key = memberMatch[1] as string;
      const value = memberMatch[2];
      listKey = null;
      if (value === undefined) {
        if (key === "camera_pose") listKey = "cameraPose";
        else if (key === "intrinsic") listKey = "intrinsic";
        else if (key === "distortion") listKey = "distortion";
        else throw new Error(`camera.yaml contains unsupported list key ${key}.`);
        if (current[listKey] !== undefined) throw new Error(`camera.yaml duplicates ${current.cameraId}.${key}.`);
        current[listKey] = [];
      } else if (key === "calibrated" && value === "true" && current.calibrated === undefined) {
        current.calibrated = true;
      } else if (key === "image_height" && value === "3000" && current.imageHeightPx === undefined) {
        current.imageHeightPx = 3_000;
      } else if (key === "image_width" && value === "4000" && current.imageWidthPx === undefined) {
        current.imageWidthPx = 4_000;
      } else if (
        key === "camera_model" && (value === "kb4" || value === "pinhole") &&
        current.cameraModel === undefined
      ) {
        current.cameraModel = value;
      } else {
        throw new Error(`camera.yaml contains a duplicate or unsupported camera scalar ${key}.`);
      }
      continue;
    }
    const rootMatch = /^([a-z_]+): (.+)$/u.exec(line);
    if (rootMatch !== null) {
      current = null;
      listKey = null;
      const key = rootMatch[1] as string;
      const value = rootMatch[2];
      if (key === "calibrated" && value === "true" && rootCalibrated === undefined) {
        rootCalibrated = true;
      } else if (key === "version" && value === "V3.1.1" && rootVersion === undefined) {
        rootVersion = "V3.1.1";
      } else {
        throw new Error(`camera.yaml contains a duplicate or unsupported root scalar ${key}.`);
      }
      continue;
    }
    throw new Error(`camera.yaml line ${String(lineIndex + 1)} is outside the supported exact subset.`);
  }
  if (rootCalibrated !== true || rootVersion !== "V3.1.1" || cameras.size !== 4) {
    throw new Error("camera.yaml is missing its exact root calibration facts or four cameras.");
  }
  const orderedIds = ["camera_0", "camera_1", "camera_2", "camera_3"] as const;
  const parsed = orderedIds.map((cameraId): ParsedCamera => {
    const camera = cameras.get(cameraId);
    if (
      camera?.calibrated !== true || camera.imageWidthPx !== 4_000 ||
      camera.imageHeightPx !== 3_000 || camera.cameraModel === undefined ||
      camera.cameraPose?.length !== 16
    ) {
      throw new Error(`${cameraId} is missing exact calibration fields.`);
    }
    return {
      cameraId,
      calibrated: true,
      imageWidthPx: 4_000,
      imageHeightPx: 3_000,
      cameraModel: camera.cameraModel,
      intrinsic: exactTuple4(camera.intrinsic, `${cameraId}.intrinsic`),
      distortion: exactTuple4(camera.distortion, `${cameraId}.distortion`),
      cameraPose: [...camera.cameraPose],
    };
  });
  if (
    parsed.filter((camera) => camera.cameraModel === "kb4").length !== 2 ||
    parsed.filter((camera) => camera.cameraModel === "pinhole").length !== 2
  ) {
    throw new Error("camera.yaml must describe exactly two KB4 and two pinhole cameras.");
  }
  return deepFreeze({ calibrated: true, version: "V3.1.1", cameras: parsed });
}

export function parseGrandHallPortalCamTransformYaml(
  text: string,
  label: string,
): ParsedTransformYaml {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  let transform: number[] | undefined;
  let calibrated: true | undefined;
  let version: "V3.1.1" | undefined;
  let collecting = false;
  for (const [lineIndex, line] of lines.entries()) {
    if (line === "transform:") {
      if (transform !== undefined) throw new Error(`${label} duplicates transform.`);
      transform = [];
      collecting = true;
      continue;
    }
    const inline = /^transform: (\[.*\])$/u.exec(line);
    if (inline !== null) {
      if (transform !== undefined) throw new Error(`${label} duplicates transform.`);
      transform = [...parseInlineNumberList(inline[1] as string, `${label}.transform`)];
      collecting = false;
      continue;
    }
    const listItem = /^ {2}- (.+)$/u.exec(line);
    if (listItem !== null) {
      if (!collecting || transform === undefined) throw new Error(`${label} has an orphan list item.`);
      transform.push(parseNumber(listItem[1] as string, `${label}.transform`));
      continue;
    }
    collecting = false;
    if (line === "calibrated: true" && calibrated === undefined) calibrated = true;
    else if (line === "version: V3.1.1" && version === undefined) version = "V3.1.1";
    else throw new Error(`${label} line ${String(lineIndex + 1)} is unsupported or duplicated.`);
  }
  if (transform?.length !== 16 || calibrated !== true || version !== "V3.1.1") {
    throw new Error(`${label} must contain one calibrated V3.1.1 4x4 transform.`);
  }
  return deepFreeze({ transform, calibrated: true, version: "V3.1.1" });
}

function roundedMetric(value: number): number {
  if (!Number.isFinite(value)) throw new Error("A matrix metric is non-finite.");
  const rounded = Number(value.toPrecision(15));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function matrixFacts(matrix: readonly number[], label: string) {
  if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must be one finite row-major 4x4 matrix.`);
  }
  const r = [
    [matrix[0] as number, matrix[1] as number, matrix[2] as number],
    [matrix[4] as number, matrix[5] as number, matrix[6] as number],
    [matrix[8] as number, matrix[9] as number, matrix[10] as number],
  ] as const;
  const determinant =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  let orthonormalError = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let dot = 0;
      for (let index = 0; index < 3; index += 1) {
        dot += (r[index]?.[row] as number) * (r[index]?.[column] as number);
      }
      orthonormalError = Math.max(orthonormalError, Math.abs(dot - (row === column ? 1 : 0)));
    }
  }
  const lastRow = [
    matrix[12] as number,
    matrix[13] as number,
    matrix[14] as number,
    matrix[15] as number,
  ] as const;
  if (
    Math.abs(determinant - 1) > 1e-5 || orthonormalError > 1e-5 ||
    Math.abs(lastRow[0]) > 1e-12 || Math.abs(lastRow[1]) > 1e-12 ||
    Math.abs(lastRow[2]) > 1e-12 || Math.abs(lastRow[3] - 1) > 1e-12
  ) {
    throw new Error(`${label} is not a numerically proper homogeneous rigid transform.`);
  }
  return deepFreeze({
    rowMajor: [...matrix],
    rotationDeterminant: roundedMetric(determinant),
    rotationOrthonormalMaximumAbsoluteError: roundedMetric(orthonormalError),
    homogeneousLastRow: lastRow,
    properRigidTransformNumericallyValidated: true as const,
    sourceMatrixDirection: "unresolved_source_label_only" as const,
  });
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function assertMaterialCalibrationSemantics(
  material: GrandHallXgridsXbagCameraCalibrationMaterial,
): void {
  const records = material.sourceBindings.xbagConfigBlock.records;
  for (const [index, record] of records.entries()) {
    const expected = GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records[index];
    if (
      expected === undefined || record.fileName !== expected.fileName ||
      record.recordOffset !== expected.recordOffset ||
      record.recordMessageByteLength !== expected.recordMessageByteLength ||
      record.recordTimestampMicroseconds !== expected.recordTimestampMicroseconds ||
      record.payloadOffset !== expected.payloadOffset ||
      record.payloadByteLength !== expected.payloadByteLength ||
      record.payloadSha256 !== expected.payloadSha256 ||
      record.finalNewline !== expected.finalNewline
    ) {
      throw new Error("The receipt config-record profile is not the exact source-bound profile.");
    }
    const retainPayloadText = index < 3;
    if (retainPayloadText) {
      if (record.payloadUtf8 === null) {
        throw new Error(`${record.fileName} plaintext is required to validate derived calibration facts.`);
      }
      const payloadBytes = Buffer.from(record.payloadUtf8, "utf8");
      if (
        payloadBytes.byteLength !== expected.payloadByteLength ||
        digestBytes(payloadBytes) !== expected.payloadSha256 ||
        record.payloadUtf8.endsWith("\n") !== expected.finalNewline
      ) {
        throw new Error(`${record.fileName} retained plaintext does not match its exact source binding.`);
      }
    } else if (record.payloadUtf8 !== null) {
      throw new Error(`${record.fileName} plaintext must not be serialized into the bounded receipt.`);
    }
  }

  const cameraText = records[0]?.payloadUtf8;
  const cameraLidarText = records[1]?.payloadUtf8;
  const imuLidarText = records[2]?.payloadUtf8;
  if (cameraText === null || cameraText === undefined ||
      cameraLidarText === null || cameraLidarText === undefined ||
      imuLidarText === null || imuLidarText === undefined) {
    throw new Error("The retained calibration plaintext set is incomplete.");
  }
  const cameraYaml = parseGrandHallPortalCamCameraYaml(cameraText);
  const cameraLidar = parseGrandHallPortalCamTransformYaml(
    cameraLidarText,
    "extrinsic_camera_lidar.yaml",
  );
  const imuLidar = parseGrandHallPortalCamTransformYaml(
    imuLidarText,
    "extrinsic_imu_lidar.yaml",
  );
  const expectedCameras = cameraYaml.cameras.map((camera) => ({
    cameraId: camera.cameraId,
    deviceCameraName: null,
    deviceCameraNameMappingState: "unresolved_requires_optical_observation" as const,
    calibrated: true as const,
    imageWidthPx: camera.imageWidthPx,
    imageHeightPx: camera.imageHeightPx,
    cameraModel: camera.cameraModel,
    intrinsicSourceOrder: camera.intrinsic,
    intrinsicCoefficientSemantics: "unresolved_source_order_four_values" as const,
    distortionSourceOrder: camera.distortion,
    distortionCoefficientSemantics: "unresolved_source_order" as const,
    cameraPose: matrixFacts(camera.cameraPose, `${camera.cameraId}.camera_pose`),
  }));
  const expectedTransforms = [
    {
      sourceFileName: "extrinsic_camera_lidar.yaml" as const,
      sourceLabel: "camera_lidar" as const,
      calibrated: true as const,
      calibrationVersion: cameraLidar.version,
      transform: matrixFacts(cameraLidar.transform, "camera_lidar transform"),
    },
    {
      sourceFileName: "extrinsic_imu_lidar.yaml" as const,
      sourceLabel: "imu_lidar" as const,
      calibrated: true as const,
      calibrationVersion: imuLidar.version,
      transform: matrixFacts(imuLidar.transform, "imu_lidar transform"),
    },
  ];
  if (
    !canonicalValuesEqual(material.calibration.cameras, expectedCameras) ||
    !canonicalValuesEqual(material.calibration.crossSensorTransforms, expectedTransforms)
  ) {
    throw new Error("The receipt calibration facts do not exactly derive from retained source plaintext.");
  }
}

function materialFromRecords(
  source: GrandHallXgridsVerifiedSourceV1,
  records: readonly ParsedWireRecord[],
): GrandHallXgridsXbagCameraCalibrationMaterial {
  const byName = new Map(records.map((record) => [record.fileName, record]));
  const cameraRecord = byName.get("camera.yaml");
  const cameraLidarRecord = byName.get("extrinsic_camera_lidar.yaml");
  const imuLidarRecord = byName.get("extrinsic_imu_lidar.yaml");
  if (cameraRecord === undefined || cameraLidarRecord === undefined || imuLidarRecord === undefined) {
    throw new Error("The exact optical calibration records are incomplete.");
  }
  const cameraYaml = parseGrandHallPortalCamCameraYaml(cameraRecord.payloadUtf8);
  const cameraLidar = parseGrandHallPortalCamTransformYaml(
    cameraLidarRecord.payloadUtf8,
    "extrinsic_camera_lidar.yaml",
  );
  const imuLidar = parseGrandHallPortalCamTransformYaml(
    imuLidarRecord.payloadUtf8,
    "extrinsic_imu_lidar.yaml",
  );
  const retainedPayloadNames = new Set<GrandHallXbagExpectedRecordV1["fileName"]>([
    "camera.yaml",
    "extrinsic_camera_lidar.yaml",
    "extrinsic_imu_lidar.yaml",
  ]);
  const sourceRecords = records.map((record) => ({
    fileName: record.fileName,
    recordOffset: record.recordOffset,
    recordMessageByteLength: record.recordMessageByteLength,
    recordTimestampMicroseconds: record.recordTimestampMicroseconds,
    payloadOffset: record.payloadOffset,
    payloadByteLength: record.payload.byteLength,
    payloadSha256: record.payloadSha256,
    payloadUtf8: retainedPayloadNames.has(record.fileName) ? record.payloadUtf8 : null,
    finalNewline: record.finalNewline,
  }));
  return GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
    schemaVersion: GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_SCHEMA,
    state: GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_STATE,
    authority: "none",
    receiptAuthentication: "self_digest_integrity_only_live_source_check_required",
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      scope: "exact_xbag_factory_camera_calibration_recovery",
    },
    sourceBindings: {
      rawSource: {
        locator: "XGRIDS_CAPTURE_ROOT",
        policy: "GRAND_HALL_XGRIDS_SOURCE_POLICY_V1",
        exactAllowlistedTreeReverified: true,
        inventorySha256: source.inventorySha256,
        xbin: {
          locator: "XGRIDS_CAPTURE_ROOT/2026-05-31-101837.xbin",
          byteLength: XBIN_EXPECTED.sizeBytes,
          sha256: `sha256:${XBIN_EXPECTED.sha256}`,
          signatureHex: "58424147",
        },
        projectMetadata: {
          locator: "XGRIDS_CAPTURE_ROOT/project_data/log/project.json",
          byteLength: source.portalCam.metadataSizeBytes,
          sha256: source.portalCam.metadataSha256,
          deviceModel: source.portalCam.deviceModel,
          cameraNamesSourceOrder: source.portalCam.cameraList,
        },
      },
      xbagConfigBlock: {
        framing: "uint32le_length_prefixed_protobuf_repeated_config_record_v1",
        headerReadBytes: HEADER_READ_BYTES,
        lengthOffset: CONFIG_BLOCK_LENGTH_OFFSET,
        payloadOffset: CONFIG_BLOCK_PAYLOAD_OFFSET,
        byteLength: CONFIG_BLOCK_BYTE_LENGTH,
        endExclusive: CONFIG_BLOCK_END_EXCLUSIVE,
        payloadTextRetention: "camera_and_cross_sensor_calibration_only",
        records: sourceRecords,
      },
    },
    calibration: {
      sourceCalibrationVersion: cameraYaml.version,
      sourceCalibrated: cameraYaml.calibrated,
      deviceCameraNames: source.portalCam.cameraList,
      sourceCameraIds: ["camera_0", "camera_1", "camera_2", "camera_3"],
      cameraNameMapping: "unresolved_requires_optical_observation",
      cameras: cameraYaml.cameras.map((camera) => ({
        cameraId: camera.cameraId,
        deviceCameraName: null,
        deviceCameraNameMappingState: "unresolved_requires_optical_observation",
        calibrated: true,
        imageWidthPx: camera.imageWidthPx,
        imageHeightPx: camera.imageHeightPx,
        cameraModel: camera.cameraModel,
        intrinsicSourceOrder: camera.intrinsic,
        intrinsicCoefficientSemantics: "unresolved_source_order_four_values",
        distortionSourceOrder: camera.distortion,
        distortionCoefficientSemantics: "unresolved_source_order",
        cameraPose: matrixFacts(camera.cameraPose, `${camera.cameraId}.camera_pose`),
      })),
      crossSensorTransforms: [
        {
          sourceFileName: "extrinsic_camera_lidar.yaml",
          sourceLabel: "camera_lidar",
          calibrated: true,
          calibrationVersion: cameraLidar.version,
          transform: matrixFacts(cameraLidar.transform, "camera_lidar transform"),
        },
        {
          sourceFileName: "extrinsic_imu_lidar.yaml",
          sourceLabel: "imu_lidar",
          calibrated: true,
          calibrationVersion: imuLidar.version,
          transform: matrixFacts(imuLidar.transform, "imu_lidar transform"),
        },
      ],
    },
    proof: {
      exactXbinFullFileIdentityVerified: true,
      exactAllowlistedSourceTreeVerified: true,
      xbagHeaderStableDescriptorRead: true,
      protobufWireLengthsParsedNotOffsetSliced: true,
      allSixPayloadHashesMatched: true,
      allPayloadsStrictUtf8: true,
      cameraIntrinsicsRecovered: true,
      cameraDistortionCoefficientsRecovered: true,
      cameraPoseMatricesRecovered: true,
      crossSensorMatricesRecovered: true,
      matrixNumericValidityEstablished: true,
      cameraNameMappingEstablished: false,
      transformDirectionEstablished: false,
      opticalFramePayloadRecovered: false,
      xgridsToE57TransformEstablished: false,
      metricAuthorityGranted: false,
      roomMembershipAccepted: false,
      generatedContentUsed: false,
      trainingPermitted: false,
      reconstructionPermitted: false,
      providerInputPermitted: false,
      runtimePermitted: false,
      stagingPermitted: false,
      publicationPermitted: false,
      deploymentPermitted: false,
      productionTrustPermitted: false,
      sourceWrites: "none",
      applicationNetworkRequests: "none",
      authority: "none",
    },
    blockers: [
      "camera_id_to_device_name_mapping_unresolved",
      "camera_pose_matrix_direction_unresolved",
      "camera_lidar_matrix_direction_unresolved",
      "imu_lidar_matrix_direction_unresolved",
      "optical_frame_payload_not_recovered",
      "xgrids_to_e57_transform_absent",
      "grand_hall_room_scope_unaccepted",
    ],
  });
}

function materialDigest(material: GrandHallXgridsXbagCameraCalibrationMaterial): string {
  return `sha256:${domainSeparatedSha256(
    GRAND_HALL_XGRIDS_XBAG_CAMERA_CALIBRATION_DOMAIN,
    toCanonicalJson(material),
  )}`;
}

export function sealGrandHallXgridsXbagCameraCalibration(
  material: GrandHallXgridsXbagCameraCalibrationMaterial,
): GrandHallXgridsXbagCameraCalibration {
  const parsed = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse(material);
  assertMaterialCalibrationSemantics(parsed);
  return deepFreeze(GrandHallXgridsXbagCameraCalibrationSchema.parse({
    ...parsed,
    receiptSha256: materialDigest(parsed),
  }));
}

export function serializeGrandHallXgridsXbagCameraCalibration(
  receipt: GrandHallXgridsXbagCameraCalibration,
): Buffer {
  const parsed = GrandHallXgridsXbagCameraCalibrationSchema.parse(receipt);
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(parsed))}\n`, "utf8");
}

function receiptMaterial(
  receipt: GrandHallXgridsXbagCameraCalibration,
): GrandHallXgridsXbagCameraCalibrationMaterial {
  const { receiptSha256: _receiptSha256, ...material } = receipt;
  return GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse(material);
}

export function parseGrandHallXgridsXbagCameraCalibration(
  bytes: Buffer,
): GrandHallXgridsXbagCameraCalibration {
  const receipt = GrandHallXgridsXbagCameraCalibrationSchema.parse(
    parseGrandHallT554StrictJson(bytes),
  );
  const material = receiptMaterial(receipt);
  assertMaterialCalibrationSemantics(material);
  if (receipt.receiptSha256 !== materialDigest(material)) {
    throw new Error("The XBAG camera-calibration receipt self-digest does not match its material.");
  }
  if (!serializeGrandHallXgridsXbagCameraCalibration(receipt).equals(bytes)) {
    throw new Error("The XBAG camera-calibration receipt is not canonical JSON with one final LF.");
  }
  return deepFreeze(receipt);
}

async function verifyExactSourceWithDigestBoundXbinHeader(
  rawRoot: string,
): Promise<{
  readonly source: GrandHallXgridsVerifiedSourceV1;
  readonly xbinHeader: Buffer;
}> {
  const xbinPath = resolve(rawRoot, GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.xbinRelativePath);
  const captured: { xbinHeader?: Buffer } = {};
  const source = await verifyGrandHallXgridsSource({
    sourceRoot: rawRoot,
    hashFile: async (input) => {
      const isXbin = comparablePath(input.absolutePath) === comparablePath(xbinPath);
      const capturedContents = input.captureContents
        ? Buffer.allocUnsafe(input.expectedIdentity.size)
        : null;
      const digest = await sha256RegularFileWithHead(
        input.absolutePath,
        isXbin ? HEADER_READ_BYTES : input.headBytes,
        input.expectedIdentity,
        input.signal,
        capturedContents === null
          ? undefined
          : (chunk, offset) => {
              Buffer.from(chunk).copy(capturedContents, offset);
            },
      );
      if (isXbin) {
        if (
          digest.sizeBytes !== XBIN_EXPECTED.sizeBytes ||
          digest.sha256 !== XBIN_EXPECTED.sha256 ||
          digest.headBytes.byteLength !== HEADER_READ_BYTES
        ) {
          throw new Error("The digest-bound XBIN calibration header does not match exact policy.");
        }
        captured.xbinHeader = Buffer.from(digest.headBytes);
      }
      return {
        sha256: digest.sha256,
        sizeBytes: digest.sizeBytes,
        headBytes: digest.headBytes.subarray(0, input.headBytes),
        capturedContents,
      };
    },
  });
  if (captured.xbinHeader === undefined) {
    throw new Error("The exact source verifier did not capture the XBIN calibration header.");
  }
  return { source, xbinHeader: captured.xbinHeader };
}

async function buildFromExactSource(
  rawRootInput: string,
): Promise<GrandHallXgridsXbagCameraCalibration> {
  const rawRoot = requireAbsoluteLocalPath(rawRootInput, "Raw XGRIDS root");
  const xbinPath = resolve(rawRoot, GRAND_HALL_XGRIDS_SOURCE_POLICY_V1.xbinRelativePath);
  if (!pathIsWithin(rawRoot, xbinPath)) throw new Error("The XBIN path escaped its verified source root.");
  const verified = await verifyExactSourceWithDigestBoundXbinHeader(rawRoot);
  const records = inspectGrandHallXgridsXbagConfigHeader(verified.xbinHeader);
  return sealGrandHallXgridsXbagCameraCalibration(materialFromRecords(verified.source, records));
}

async function stableReadOutput(outputPathInput: string): Promise<Buffer> {
  const outputPath = requireAbsoluteLocalPath(outputPathInput, "Calibration receipt output");
  const before = await lstat(outputPath, { bigint: true });
  const canonicalBefore = await realpath(outputPath);
  if (
    !before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    before.size < 1n || before.size > BigInt(MAX_OUTPUT_BYTES) ||
    comparablePath(outputPath) !== comparablePath(canonicalBefore)
  ) {
    throw new Error("The calibration receipt output must be one bounded direct regular file.");
  }
  const handle = await open(outputPath, "r");
  try {
    const descriptorBefore = await handle.stat({ bigint: true });
    if (!sameFileState(before, descriptorBefore)) throw new Error("The receipt descriptor is not path-bound.");
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let cursor = 0;
    while (cursor < bytes.byteLength) {
      const read = await handle.read(bytes, cursor, bytes.byteLength - cursor, cursor);
      if (read.bytesRead < 1) throw new Error("The calibration receipt ended during its exact read.");
      cursor += read.bytesRead;
    }
    const descriptorAfter = await handle.stat({ bigint: true });
    const after = await lstat(outputPath, { bigint: true });
    if (!sameFileState(before, descriptorAfter) || !sameFileState(before, after)) {
      throw new Error("The calibration receipt changed during its stable read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

interface DirectParentBinding {
  readonly path: string;
  readonly canonicalPath: string;
  readonly state: BigIntStats;
}

function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.isDirectory() && right.isDirectory() && !left.isSymbolicLink() && !right.isSymbolicLink();
}

async function bindDirectParent(outputPath: string): Promise<DirectParentBinding> {
  const parent = dirname(outputPath);
  const stats = await lstat(parent, { bigint: true });
  const canonical = await realpath(parent);
  if (
    !stats.isDirectory() || stats.isSymbolicLink() ||
    comparablePath(parent) !== comparablePath(canonical)
  ) {
    throw new Error("The calibration receipt parent must be one existing direct local directory.");
  }
  return { path: parent, canonicalPath: canonical, state: stats };
}

async function assertDirectParentBinding(binding: DirectParentBinding): Promise<void> {
  const state = await lstat(binding.path, { bigint: true });
  const canonical = await realpath(binding.path);
  if (
    !sameDirectoryIdentity(binding.state, state) ||
    comparablePath(binding.canonicalPath) !== comparablePath(canonical)
  ) {
    throw new Error("The calibration receipt parent changed after it was bound.");
  }
}

async function assertOutputAbsent(outputPath: string): Promise<void> {
  try {
    await lstat(outputPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("The calibration receipt output already exists; write mode is create-only.");
}

async function requireOutputDisjointFromRawRoot(
  rawRootInput: string,
  outputPath: string,
): Promise<string> {
  const rawRoot = requireAbsoluteLocalPath(rawRootInput, "Raw XGRIDS root");
  const rawState = await lstat(rawRoot);
  const canonicalRawRoot = await realpath(rawRoot);
  if (
    !rawState.isDirectory() || rawState.isSymbolicLink() ||
    comparablePath(rawRoot) !== comparablePath(canonicalRawRoot)
  ) {
    throw new Error("The raw XGRIDS root must be one existing direct canonical directory.");
  }
  if (pathIsWithin(rawRoot, outputPath)) {
    throw new Error("The calibration receipt output must remain outside the raw XGRIDS source tree.");
  }
  return rawRoot;
}

function assertTestOnlyWriteSeamsAllowed(options: GrandHallXbagCalibrationFileOptions): void {
  const hasTestOnlySeam = options.testOnlyBuildReceipt !== undefined ||
    options.testOnlyAfterSourceBuild !== undefined || options.testOnlyAfterOutputOpen !== undefined;
  if (hasTestOnlySeam && process.env.NODE_ENV !== "test") {
    throw new Error("Calibration write test seams are forbidden outside NODE_ENV=test.");
  }
}

async function assertOpenedOutputBinding(
  handle: FileHandle,
  outputPath: string,
  parentBinding: DirectParentBinding,
  rawRoot: string,
): Promise<void> {
  await assertDirectParentBinding(parentBinding);
  const descriptor = await handle.stat({ bigint: true });
  const pathState = await lstat(outputPath, { bigint: true });
  const canonicalOutput = await realpath(outputPath);
  if (
    !descriptor.isFile() || descriptor.nlink !== 1n || descriptor.size !== 0n ||
    !sameFileState(descriptor, pathState) || pathState.isSymbolicLink() ||
    comparablePath(outputPath) !== comparablePath(canonicalOutput) ||
    comparablePath(dirname(canonicalOutput)) !== comparablePath(parentBinding.canonicalPath) ||
    pathIsWithin(rawRoot, canonicalOutput)
  ) {
    throw new Error("The empty output descriptor is not bound to the approved disjoint parent path.");
  }
}

export async function writeGrandHallXgridsXbagCameraCalibration(
  options: GrandHallXbagCalibrationFileOptions,
): Promise<GrandHallXgridsXbagCameraCalibration> {
  assertTestOnlyWriteSeamsAllowed(options);
  const outputPath = requireAbsoluteLocalPath(options.outputPath, "Calibration receipt output");
  const parentBinding = await bindDirectParent(outputPath);
  await assertOutputAbsent(outputPath);
  const rawRoot = await requireOutputDisjointFromRawRoot(options.rawRoot, outputPath);
  const receipt = options.testOnlyBuildReceipt === undefined
    ? await buildFromExactSource(rawRoot)
    : await options.testOnlyBuildReceipt();
  await options.testOnlyAfterSourceBuild?.();
  await assertDirectParentBinding(parentBinding);
  await assertOutputAbsent(outputPath);
  const bytes = serializeGrandHallXgridsXbagCameraCalibration(receipt);
  const handle = await open(outputPath, "wx+", 0o600);
  try {
    await options.testOnlyAfterOutputOpen?.(outputPath);
    await assertOpenedOutputBinding(handle, outputPath, parentBinding, rawRoot);
    await handle.writeFile(bytes);
    await handle.sync();
    const descriptorBeforeRead = await handle.stat({ bigint: true });
    if (
      !descriptorBeforeRead.isFile() || descriptorBeforeRead.nlink !== 1n ||
      descriptorBeforeRead.size !== BigInt(bytes.byteLength)
    ) {
      throw new Error("The created calibration receipt descriptor has an unexpected identity or size.");
    }
    const published = Buffer.allocUnsafe(bytes.byteLength);
    let cursor = 0;
    while (cursor < published.byteLength) {
      const read = await handle.read(published, cursor, published.byteLength - cursor, cursor);
      if (read.bytesRead < 1) throw new Error("The created calibration receipt ended during verification.");
      cursor += read.bytesRead;
    }
    const descriptorAfterRead = await handle.stat({ bigint: true });
    const pathState = await lstat(outputPath, { bigint: true });
    const canonicalPath = await realpath(outputPath);
    await assertDirectParentBinding(parentBinding);
    if (
      !sameFileState(descriptorBeforeRead, descriptorAfterRead) ||
      !sameFileState(descriptorBeforeRead, pathState) || pathState.isSymbolicLink() ||
      comparablePath(outputPath) !== comparablePath(canonicalPath) ||
      comparablePath(dirname(canonicalPath)) !== comparablePath(parentBinding.canonicalPath) ||
      pathIsWithin(rawRoot, canonicalPath)
    ) {
      throw new Error("The created calibration receipt path changed during descriptor-bound verification.");
    }
    const parsed = parseGrandHallXgridsXbagCameraCalibration(published);
    if (!published.equals(bytes) || parsed.receiptSha256 !== receipt.receiptSha256) {
      throw new Error("The published calibration receipt does not match its exact generated bytes.");
    }
    return receipt;
  } finally {
    await handle.close();
  }
}

export async function checkGrandHallXgridsXbagCameraCalibration(
  options: GrandHallXbagCalibrationFileOptions,
): Promise<GrandHallXgridsXbagCameraCalibration> {
  const existing = await stableReadOutput(options.outputPath);
  const parsed = parseGrandHallXgridsXbagCameraCalibration(existing);
  const regenerated = await buildFromExactSource(options.rawRoot);
  const regeneratedBytes = serializeGrandHallXgridsXbagCameraCalibration(regenerated);
  if (!existing.equals(regeneratedBytes) || parsed.receiptSha256 !== regenerated.receiptSha256) {
    throw new Error("The existing calibration receipt is not the exact regeneration from live source bytes.");
  }
  return regenerated;
}

export const GRAND_HALL_XBAG_CAMERA_CALIBRATION_USAGE = [
  "Usage:",
  "  tsx src/grand-hall-xgrids-xbag-camera-calibration-entry.ts --raw-root <absolute Grand Hall XGRIDS capture root> --out <new absolute receipt JSON>",
  "  tsx src/grand-hall-xgrids-xbag-camera-calibration-entry.ts --check --raw-root <absolute Grand Hall XGRIDS capture root> --out <existing absolute receipt JSON>",
].join("\n");

export function parseGrandHallXbagCameraCalibrationArguments(arguments_: readonly string[]): {
  readonly check: boolean;
  readonly rawRoot: string;
  readonly outputPath: string;
} {
  let check = false;
  let rawRoot: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--check") {
      if (check) throw new Error("--check may be supplied only once.");
      check = true;
    } else if (argument === "--raw-root") {
      if (rawRoot !== undefined) throw new Error("--raw-root may be supplied only once.");
      rawRoot = arguments_[index + 1];
      index += 1;
    } else if (argument === "--out") {
      if (outputPath !== undefined) throw new Error("--out may be supplied only once.");
      outputPath = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument ?? "<missing>"}.`);
    }
  }
  if (rawRoot === undefined || outputPath === undefined) {
    throw new Error(GRAND_HALL_XBAG_CAMERA_CALIBRATION_USAGE);
  }
  return { check, rawRoot, outputPath };
}

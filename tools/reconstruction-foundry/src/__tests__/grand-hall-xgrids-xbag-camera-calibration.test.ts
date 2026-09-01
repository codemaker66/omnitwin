import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1,
  GrandHallXgridsXbagCameraCalibrationMaterialSchema,
  GrandHallXgridsXbagCameraCalibrationSchema,
  inspectGrandHallXgridsXbagConfigHeader,
  parseGrandHallPortalCamCameraYaml,
  parseGrandHallPortalCamTransformYaml,
  parseGrandHallXbagCameraCalibrationArguments,
  parseGrandHallXgridsXbagCameraCalibration,
  sealGrandHallXgridsXbagCameraCalibration,
  serializeGrandHallXgridsXbagCameraCalibration,
  writeGrandHallXgridsXbagCameraCalibration,
  type GrandHallXbagExpectedRecordV1,
  type GrandHallXgridsXbagCameraCalibrationMaterial,
} from "../grand-hall-xgrids-xbag-camera-calibration.js";

const RECORD_NAMES = [
  "camera.yaml",
  "extrinsic_camera_lidar.yaml",
  "extrinsic_imu_lidar.yaml",
  "extrinsic_rtk.yaml",
  "imu.yaml",
  "lidar_param.yaml",
] as const;

type RecordName = (typeof RECORD_NAMES)[number];

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function encodeVarint(input: number | bigint): Buffer {
  let value = BigInt(input);
  if (value < 0n) throw new Error("Synthetic protobuf varints must be non-negative.");
  const bytes: number[] = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0n);
  return Buffer.from(bytes);
}

function lengthDelimitedField(fieldNumber: number, bytes: Uint8Array): Buffer {
  return Buffer.concat([
    encodeVarint(fieldNumber * 8 + 2),
    encodeVarint(bytes.byteLength),
    Buffer.from(bytes),
  ]);
}

interface SyntheticHeader {
  readonly header: Buffer;
  readonly expected: readonly GrandHallXbagExpectedRecordV1[];
  readonly payloads: Readonly<Record<RecordName, Buffer>>;
}

function buildSyntheticHeader(
  overrides: Readonly<Partial<Record<RecordName, Buffer>>> = {},
): SyntheticHeader {
  const profile = GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1;
  const header = Buffer.alloc(profile.headerReadBytes);
  header.write("XBAG", 0, "ascii");
  const payloads = {} as Record<RecordName, Buffer>;
  const expected: GrandHallXbagExpectedRecordV1[] = [];
  let cursor = profile.configBlockPayloadOffset;

  for (const [index, sourceProfile] of profile.records.entries()) {
    const defaultPayload = Buffer.alloc(
      sourceProfile.payloadByteLength,
      0x41 + index,
    );
    defaultPayload[defaultPayload.byteLength - 1] = index < 2 ? 0x31 : 0x0a;
    const payload = Buffer.from(overrides[sourceProfile.fileName] ?? defaultPayload);
    if (payload.byteLength !== sourceProfile.payloadByteLength) {
      throw new Error(`Synthetic ${sourceProfile.fileName} changed its frozen payload length.`);
    }
    payloads[sourceProfile.fileName] = payload;

    const timestamp = BigInt(sourceProfile.recordTimestampMicroseconds);
    const metadata = lengthDelimitedField(
      1,
      Buffer.concat([
        encodeVarint(16),
        encodeVarint(timestamp << 1n),
      ]),
    );
    const fileName = lengthDelimitedField(2, Buffer.from(sourceProfile.fileName, "utf8"));
    const payloadPrefix = Buffer.concat([
      encodeVarint(26),
      encodeVarint(payload.byteLength),
    ]);
    const inner = Buffer.concat([metadata, fileName, payloadPrefix, payload]);
    const outerPrefix = Buffer.concat([encodeVarint(10), encodeVarint(inner.byteLength)]);
    const record = Buffer.concat([outerPrefix, inner]);
    const payloadOffset = cursor + outerPrefix.byteLength + metadata.byteLength +
      fileName.byteLength + payloadPrefix.byteLength;

    if (
      cursor !== sourceProfile.recordOffset ||
      payloadOffset !== sourceProfile.payloadOffset
    ) {
      throw new Error(`Synthetic ${sourceProfile.fileName} framing no longer matches the exact profile.`);
    }
    record.copy(header, cursor);
    expected.push({
      fileName: sourceProfile.fileName,
      recordOffset: cursor,
      recordMessageByteLength: inner.byteLength,
      recordTimestampMicroseconds: timestamp.toString(),
      payloadOffset,
      payloadByteLength: payload.byteLength,
      payloadSha256: sha256(payload),
      finalNewline: payload.at(-1) === 0x0a,
    });
    cursor += record.byteLength;
  }

  const blockLength = cursor - profile.configBlockPayloadOffset;
  if (
    blockLength !== profile.configBlockByteLength ||
    cursor !== profile.configBlockEndExclusive
  ) {
    throw new Error("Synthetic XBAG config block does not fill the exact framed region.");
  }
  header.writeUInt32LE(blockLength, profile.configBlockLengthOffset);
  return { header, expected, payloads };
}

function cameraBlock(
  cameraId: Record<"id", "camera_0" | "camera_1" | "camera_2" | "camera_3">["id"],
  model: "kb4" | "pinhole",
  seed: number,
): readonly string[] {
  const pose = [
    1, 0, 0, seed,
    0, 1, 0, seed + 0.1,
    0, 0, 1, seed + 0.2,
    0, 0, 0, 1,
  ];
  return [
    `${cameraId}:`,
    "  camera_pose:",
    ...pose.map((value) => `    - ${String(value)}`),
    "  calibrated: true",
    "  image_height: 3000",
    "  image_width: 4000",
    `  camera_model: ${model}`,
    "  intrinsic:",
    `    - ${String(700 + seed)}`,
    `    - ${String(701 + seed)}`,
    "    - 2000",
    "    - 1500",
    "  distortion:",
    "    - 0.1",
    "    - -0.01",
    "    - 0.001",
    "    - 0",
  ];
}

function validCameraYaml(): string {
  return [
    ...cameraBlock("camera_0", "kb4", 0),
    ...cameraBlock("camera_3", "pinhole", 3),
    ...cameraBlock("camera_2", "pinhole", 2),
    ...cameraBlock("camera_1", "kb4", 1),
    "calibrated: true",
    "version: V3.1.1",
  ].join("\n");
}

const EXACT_CAMERA_YAML = `camera_0:
  camera_pose:
    - 1
    - 0
    - 0
    - 0
    - 0
    - 1
    - 0
    - 0
    - 0
    - 0
    - 1
    - 0
    - 0
    - 0
    - 0
    - 1
  calibrated: true
  image_height: 3000
  image_width: 4000
  camera_model: kb4
  intrinsic:
    - 791.5354272942999
    - 791.3903141874899
    - 2006.660493306206
    - 1505.622160360652
  distortion:
    - 0.0832349818488848
    - -0.001647448455028685
    - -0.01617600564349106
    - 0.003906064169159346
camera_3:
  calibrated: true
  camera_pose:
    - 0.009296758013472975
    - -0.002577997669893715
    - 0.9999534610262881
    - 0.03071752484364806
    - -0.005728859847827634
    - 0.9999801279395486
    - 0.002631328722804653
    - 0.004774189868008573
    - -0.9999403734499785
    - -0.005753056058959696
    - 0.009281804280397037
    - -0.06077510251773881
    - 0
    - 0
    - 0
    - 1
  image_height: 3000
  image_width: 4000
  camera_model: pinhole
  intrinsic:
    - 1928.593853074948
    - 1931.545857317827
    - 1942.187657607921
    - 1725.510798644969
  distortion:
    - -0.02090822986117007
    - -0.0454533009039734
    - 0.0003269090952008118
    - 0.0009556824908978652
camera_2:
  calibrated: true
  camera_pose:
    - 0.008297801653838806
    - -0.001160476302446858
    - 0.999964899275202
    - 0.03052636594551077
    - 0.01146795870958081
    - 0.9999336733534278
    - 0.001065277877224241
    - 0.004574532718363215
    - -0.9998998111864752
    - 0.01145871671138662
    - 0.00831055958280125
    - -0.03104768410194399
    - 0
    - 0
    - 0
    - 1
  image_height: 3000
  image_width: 4000
  camera_model: pinhole
  intrinsic:
    - 1928.713249193157
    - 1931.912834553417
    - 1941.865358868595
    - 1727.771399760032
  distortion:
    - -0.01367884694597883
    - -0.05614740582278507
    - -0.0001007910583584733
    - 0.0002434916629774321
camera_1:
  calibrated: true
  camera_pose:
    - -0.9996269125260729
    - -0.003370415876862033
    - 0.02710490823463626
    - 0.001118970997283801
    - -0.00327098949207115
    - 0.9999877618511736
    - 0.003711707911921388
    - 0.0002057520118776412
    - -0.0271170865200121
    - 0.003621663250173475
    - -0.9996257035380637
    - -0.09235574841435108
    - 0
    - 0
    - 0
    - 1
  image_height: 3000
  image_width: 4000
  camera_model: kb4
  intrinsic:
    - 793.3213047937273
    - 793.845115961021
    - 1995.639178232216
    - 1501.23534364115
  distortion:
    - 0.09680203799792163
    - -0.02776613617577963
    - 0.007163102804534311
    - -0.002809399473577998
calibrated: true
version: V3.1.1`;

const EXACT_CAMERA_LIDAR_YAML = `transform:
  - -0.00217090698638494
  - 0.0154371859711254
  - 0.9998784828428651
  - -0.0104
  - -0.9999635755024366
  - 0.00821990676321996
  - -0.002297999387910693
  - -0.04
  - -0.008254382547430786
  - -0.9998470515144289
  - 0.01541877902636306
  - -0.0464
  - 0
  - 0
  - 0
  - 1
calibrated: true
version: V3.1.1`;

const EXACT_IMU_LIDAR_YAML = `transform: [-0.008448773, -0.9999462, -0.006001541, 0.00425, -0.9999173, 0.008506507, -0.009640303, 0.00418, 0.009690838, 0.005919596, -0.9999354, -0.00446, 0, 0, 0, 1]
calibrated: true
version: V3.1.1
`;

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function roundedFixtureMetric(value: number): number {
  const rounded = Number(value.toPrecision(15));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function matrixFacts(matrix: readonly number[]) {
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
      orthonormalError = Math.max(
        orthonormalError,
        Math.abs(dot - (row === column ? 1 : 0)),
      );
    }
  }
  return {
    rowMajor: [...matrix],
    rotationDeterminant: roundedFixtureMetric(determinant),
    rotationOrthonormalMaximumAbsoluteError: roundedFixtureMetric(orthonormalError),
    homogeneousLastRow: [
      matrix[12] as number,
      matrix[13] as number,
      matrix[14] as number,
      matrix[15] as number,
    ] as const,
    properRigidTransformNumericallyValidated: true as const,
    sourceMatrixDirection: "unresolved_source_label_only" as const,
  };
}

function materialFixture(): GrandHallXgridsXbagCameraCalibrationMaterial {
  const cameraYaml = parseGrandHallPortalCamCameraYaml(EXACT_CAMERA_YAML);
  const cameraLidar = parseGrandHallPortalCamTransformYaml(
    EXACT_CAMERA_LIDAR_YAML,
    "extrinsic_camera_lidar.yaml",
  );
  const imuLidar = parseGrandHallPortalCamTransformYaml(
    EXACT_IMU_LIDAR_YAML,
    "extrinsic_imu_lidar.yaml",
  );
  return GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
    schemaVersion: "venviewer.grand-hall.xgrids-xbag-camera-calibration-authority-none.v1",
    state: "factory_camera_calibration_recovered_optical_mapping_and_transform_direction_pending",
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
        inventorySha256: "sha256:6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236",
        xbin: {
          locator: "XGRIDS_CAPTURE_ROOT/2026-05-31-101837.xbin",
          byteLength: 41_095_196_672,
          sha256: "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
          signatureHex: "58424147",
        },
        projectMetadata: {
          locator: "XGRIDS_CAPTURE_ROOT/project_data/log/project.json",
          byteLength: 2_415,
          sha256: "sha256:3fab1721433beb64e5a34c1916e60730195083dd0887f12db0a0f6b69035bc77",
          deviceModel: "PortalCam",
          cameraNamesSourceOrder: [
            "left_main",
            "left_seco",
            "right_main",
            "right_seco",
          ],
        },
      },
      xbagConfigBlock: {
        framing: "uint32le_length_prefixed_protobuf_repeated_config_record_v1",
        headerReadBytes: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.headerReadBytes,
        lengthOffset: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.configBlockLengthOffset,
        payloadOffset: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.configBlockPayloadOffset,
        byteLength: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.configBlockByteLength,
        endExclusive: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.configBlockEndExclusive,
        payloadTextRetention: "camera_and_cross_sensor_calibration_only",
        records: GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records.map((record, index) => ({
          fileName: record.fileName,
          recordOffset: record.recordOffset,
          recordMessageByteLength: record.recordMessageByteLength,
          recordTimestampMicroseconds: record.recordTimestampMicroseconds,
          payloadOffset: record.payloadOffset,
          payloadByteLength: record.payloadByteLength,
          payloadSha256: record.payloadSha256,
          payloadUtf8: index === 0
            ? EXACT_CAMERA_YAML
            : index === 1
              ? EXACT_CAMERA_LIDAR_YAML
              : index === 2
                ? EXACT_IMU_LIDAR_YAML
                : null,
          finalNewline: record.finalNewline,
        })),
      },
    },
    calibration: {
      sourceCalibrationVersion: "V3.1.1",
      sourceCalibrated: true,
      deviceCameraNames: ["left_main", "left_seco", "right_main", "right_seco"],
      sourceCameraIds: ["camera_0", "camera_1", "camera_2", "camera_3"],
      cameraNameMapping: "unresolved_requires_optical_observation",
      cameras: cameraYaml.cameras.map(
        (camera) => ({
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
          cameraPose: matrixFacts(camera.cameraPose),
        }),
      ),
      crossSensorTransforms: [
        {
          sourceFileName: "extrinsic_camera_lidar.yaml",
          sourceLabel: "camera_lidar",
          calibrated: true,
          calibrationVersion: cameraLidar.version,
          transform: matrixFacts(cameraLidar.transform),
        },
        {
          sourceFileName: "extrinsic_imu_lidar.yaml",
          sourceLabel: "imu_lidar",
          calibrated: true,
          calibrationVersion: imuLidar.version,
          transform: matrixFacts(imuLidar.transform),
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

function requireFixtureValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Fixture is missing ${label}.`);
  return value;
}

function expectSealAndParseToReject(
  material: GrandHallXgridsXbagCameraCalibrationMaterial,
  message: string,
): void {
  expect(() => sealGrandHallXgridsXbagCameraCalibration(material)).toThrow(message);
  const forgedReceipt = GrandHallXgridsXbagCameraCalibrationSchema.parse({
    ...material,
    receiptSha256: `sha256:${"0".repeat(64)}`,
  });
  const forgedBytes = serializeGrandHallXgridsXbagCameraCalibration(forgedReceipt);
  expect(() => parseGrandHallXgridsXbagCameraCalibration(forgedBytes)).toThrow(message);
}

describe("Grand Hall XBAG calibration protobuf header", () => {
  it("binds the six reconciled wire payload identities and boundaries", () => {
    expect(GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records).toEqual([
      {
        fileName: "camera.yaml",
        recordOffset: 4_567,
        recordMessageByteLength: 2_592,
        recordTimestampMicroseconds: "1780219117551538",
        payloadOffset: 4_597,
        payloadByteLength: 2_565,
        payloadSha256: "sha256:f5d9a485b4a38ac87e1c61c2e912f2e17e567e090af731c3bd2347c8f976f744",
        finalNewline: false,
      },
      {
        fileName: "extrinsic_camera_lidar.yaml",
        recordOffset: 7_162,
        recordMessageByteLength: 363,
        recordTimestampMicroseconds: "1780219117553252",
        payloadOffset: 7_208,
        payloadByteLength: 320,
        payloadSha256: "sha256:2902d2c132b5f79769d5232cf18f1c59ec2884af1d76f0750a498a0bf71d1e95",
        finalNewline: false,
      },
      {
        fileName: "extrinsic_imu_lidar.yaml",
        recordOffset: 7_528,
        recordMessageByteLength: 242,
        recordTimestampMicroseconds: "1780219117554730",
        payloadOffset: 7_571,
        payloadByteLength: 202,
        payloadSha256: "sha256:0630cc18e60bb7c52f6f87f3ccfac1a502363a3dacd7f8b0a4253f1a927ce510",
        finalNewline: true,
      },
      {
        fileName: "extrinsic_rtk.yaml",
        recordOffset: 7_773,
        recordMessageByteLength: 186,
        recordTimestampMicroseconds: "1780219117556046",
        payloadOffset: 7_810,
        payloadByteLength: 152,
        payloadSha256: "sha256:946920e1c684cffb4ec25a0479bcd244926663e6a5bef2f3307b2730697f0303",
        finalNewline: true,
      },
      {
        fileName: "imu.yaml",
        recordOffset: 7_962,
        recordMessageByteLength: 298,
        recordTimestampMicroseconds: "1780219117556244",
        payloadOffset: 7_989,
        payloadByteLength: 274,
        payloadSha256: "sha256:48fd7beebb760206f3481afa251f811d8484029f0ab58cae4d681d81a1eca6e2",
        finalNewline: true,
      },
      {
        fileName: "lidar_param.yaml",
        recordOffset: 8_263,
        recordMessageByteLength: 2_998,
        recordTimestampMicroseconds: "1780219117557559",
        payloadOffset: 8_298,
        payloadByteLength: 2_966,
        payloadSha256: "sha256:33a24da5b92632b44f36a4c633bed186693f5f666d163dafa166f3bb62dad2ee",
        finalNewline: true,
      },
    ]);
  });

  it("parses one exact synthetic framed block without stealing the next record tag", () => {
    const synthetic = buildSyntheticHeader();
    const records = inspectGrandHallXgridsXbagConfigHeader(
      synthetic.header,
      synthetic.expected,
    );

    expect(records.map((record) => record.fileName)).toEqual(RECORD_NAMES);
    expect(records.map((record) => record.recordOffset)).toEqual(
      GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records.map((record) => record.recordOffset),
    );
    expect(records.map((record) => record.recordMessageByteLength)).toEqual(
      GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records.map(
        (record) => record.recordMessageByteLength,
      ),
    );
    expect(records.map((record) => record.recordTimestampMicroseconds)).toEqual(
      GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records.map(
        (record) => record.recordTimestampMicroseconds,
      ),
    );
    expect(records.map((record) => record.payloadOffset)).toEqual(
      GRAND_HALL_XGRIDS_XBAG_CONFIG_PROFILE_V1.records.map((record) => record.payloadOffset),
    );
    expect(records.map((record) => record.finalNewline)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(records[0]?.payload.byteLength).toBe(2_565);
    expect(records[0]?.payload[2_564]).toBe(0x31);
    expect(synthetic.header[7_162]).toBe(0x0a);
    expect(records[2]?.payload[201]).toBe(0x0a);
    expect(synthetic.header[7_773]).toBe(0x0a);
    expect(records.every((record) => record.payloadSha256 === sha256(record.payload))).toBe(true);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);

    const firstPayloadByte = records[0]?.payload[0];
    synthetic.header[4_597] = 0;
    expect(records[0]?.payload[0]).toBe(firstPayloadByte);
  });

  it("fails closed on block, payload, record-boundary, and source-identity drift", () => {
    const synthetic = buildSyntheticHeader();

    const wrongSignature = Buffer.from(synthetic.header);
    wrongSignature[0] = 0;
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      wrongSignature,
      synthetic.expected,
    )).toThrow("XBAG signature");

    const wrongBlockLength = Buffer.from(synthetic.header);
    wrongBlockLength.writeUInt32LE(6_698, 4_563);
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      wrongBlockLength,
      synthetic.expected,
    )).toThrow("block length drifted");

    const payloadDrift = Buffer.from(synthetic.header);
    payloadDrift.writeUInt8(payloadDrift.readUInt8(4_597) ^ 1, 4_597);
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      payloadDrift,
      synthetic.expected,
    )).toThrow("framing or payload identity drifted");

    const boundaryEscape = Buffer.from(synthetic.header);
    boundaryEscape[4_595] = 0x86;
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      boundaryEscape,
      synthetic.expected,
    )).toThrow("payload escapes its containing message");

    const wrongOuterField = Buffer.from(synthetic.header);
    wrongOuterField[7_162] = 0x12;
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      wrongOuterField,
      synthetic.expected,
    )).toThrow("unexpected field");

    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      Buffer.from(synthetic.header.subarray(0, 11_263)),
      synthetic.expected,
    )).toThrow("header is truncated");
  });

  it("rejects malformed payload UTF-8 after its exact framing and digest pass", () => {
    const invalidCamera = Buffer.alloc(2_565, 0x41);
    invalidCamera[0] = 0xc3;
    invalidCamera[1] = 0x28;
    const synthetic = buildSyntheticHeader({ "camera.yaml": invalidCamera });
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      synthetic.header,
      synthetic.expected,
    )).toThrow("camera.yaml is not strict UTF-8");

    const carriageReturnCamera = Buffer.alloc(2_565, 0x41);
    carriageReturnCamera[100] = 0x0d;
    const carriageReturn = buildSyntheticHeader({ "camera.yaml": carriageReturnCamera });
    expect(() => inspectGrandHallXgridsXbagConfigHeader(
      carriageReturn.header,
      carriageReturn.expected,
    )).toThrow("LF-only UTF-8");
  });
});

describe("Grand Hall PortalCam calibration YAML", () => {
  it("parses four strict camera blocks in canonical camera-id order", () => {
    const parsed = parseGrandHallPortalCamCameraYaml(validCameraYaml());
    expect(parsed).toMatchObject({ calibrated: true, version: "V3.1.1" });
    expect(parsed.cameras.map((camera) => camera.cameraId)).toEqual([
      "camera_0",
      "camera_1",
      "camera_2",
      "camera_3",
    ]);
    expect(parsed.cameras.map((camera) => camera.cameraModel)).toEqual([
      "kb4",
      "kb4",
      "pinhole",
      "pinhole",
    ]);
    expect(parsed.cameras[1]?.intrinsic).toEqual([701, 702, 2_000, 1_500]);
    expect(parsed.cameras.every((camera) => camera.cameraPose.length === 16)).toBe(true);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.cameras)).toBe(true);
  });

  it("rejects duplicate cameras, malformed scalars, non-finite numbers, and model drift", () => {
    const valid = validCameraYaml();
    expect(() => parseGrandHallPortalCamCameraYaml(
      valid.replace("camera_3:", "camera_0:"),
    )).toThrow("duplicates camera_0");
    expect(() => parseGrandHallPortalCamCameraYaml(
      valid.replace("  image_width: 4000", "  image_width: 3999"),
    )).toThrow("unsupported camera scalar image_width");
    expect(() => parseGrandHallPortalCamCameraYaml(
      valid.replace("    - 1\n", "    - NaN\n"),
    )).toThrow("strict finite YAML number");
    expect(() => parseGrandHallPortalCamCameraYaml(
      valid.replace("  camera_model: pinhole", "  camera_model: kb4"),
    )).toThrow("exactly two KB4 and two pinhole");
    expect(() => parseGrandHallPortalCamCameraYaml(
      valid.replace("  distortion:\n", "  unsupported:\n"),
    )).toThrow("unsupported list key");
  });

  it("parses block and inline transforms but rejects duplicate or incomplete matrices", () => {
    const block = [
      "transform:",
      ...IDENTITY_MATRIX.map((value) => `  - ${String(value)}`),
      "calibrated: true",
      "version: V3.1.1",
      "",
    ].join("\n");
    expect(parseGrandHallPortalCamTransformYaml(block, "block.yaml")).toEqual({
      transform: [...IDENTITY_MATRIX],
      calibrated: true,
      version: "V3.1.1",
    });

    const inline = [
      `transform: [${IDENTITY_MATRIX.join(", ")}]`,
      "calibrated: true",
      "version: V3.1.1",
    ].join("\n");
    expect(parseGrandHallPortalCamTransformYaml(inline, "inline.yaml").transform).toEqual(
      [...IDENTITY_MATRIX],
    );
    expect(() => parseGrandHallPortalCamTransformYaml(
      inline.replace("transform:", "transform: [1]\ntransform:"),
      "duplicate.yaml",
    )).toThrow("duplicates transform");
    expect(() => parseGrandHallPortalCamTransformYaml(
      inline.replace(", 1]", "]"),
      "short.yaml",
    )).toThrow("4x4 transform");
    expect(() => parseGrandHallPortalCamTransformYaml(
      inline.replace("[1,", "[NaN,"),
      "nan.yaml",
    )).toThrow("strict finite YAML number");
  });
});

describe("Grand Hall XBAG calibration receipt and CLI", () => {
  it("seals, canonically serializes, and independently verifies one authority-none receipt", () => {
    const material = materialFixture();
    const receipt = sealGrandHallXgridsXbagCameraCalibration(material);
    const repeated = sealGrandHallXgridsXbagCameraCalibration(material);
    const bytes = serializeGrandHallXgridsXbagCameraCalibration(receipt);

    expect(receipt.receiptSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(repeated.receiptSha256).toBe(receipt.receiptSha256);
    expect(receipt.receiptAuthentication).toBe(
      "self_digest_integrity_only_live_source_check_required",
    );
    expect(receipt.sourceBindings.xbagConfigBlock.payloadTextRetention).toBe(
      "camera_and_cross_sensor_calibration_only",
    );
    expect(receipt.sourceBindings.xbagConfigBlock.records.map(
      (record) => record.payloadUtf8 === null,
    )).toEqual([false, false, false, true, true, true]);
    expect(receipt.calibration.cameras[0]).toMatchObject({
      intrinsicSourceOrder: [
        791.5354272942999,
        791.3903141874899,
        2006.660493306206,
        1505.622160360652,
      ],
      intrinsicCoefficientSemantics: "unresolved_source_order_four_values",
    });
    expect(bytes.at(-1)).toBe(0x0a);
    expect(bytes.includes(Buffer.from("\r"))).toBe(false);
    expect(parseGrandHallXgridsXbagCameraCalibration(bytes)).toEqual(receipt);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.proof)).toBe(true);
    expect(receipt.proof).toMatchObject({
      authority: "none",
      cameraNameMappingEstablished: false,
      transformDirectionEstablished: false,
      xgridsToE57TransformEstablished: false,
      metricAuthorityGranted: false,
      trainingPermitted: false,
      reconstructionPermitted: false,
      runtimePermitted: false,
      productionTrustPermitted: false,
    });
  });

  it("makes matrix facts and derived intrinsic values non-forgeable at seal and parse", () => {
    const material = materialFixture();
    const changedMatrixFacts = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      calibration: {
        ...material.calibration,
        cameras: material.calibration.cameras.map((camera, index) => index === 0
          ? {
              ...camera,
              cameraPose: {
                ...camera.cameraPose,
                rotationDeterminant: camera.cameraPose.rotationDeterminant + 0.001,
              },
            }
          : camera),
      },
    });
    expectSealAndParseToReject(changedMatrixFacts, "do not exactly derive");

    const changedIntrinsic = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      calibration: {
        ...material.calibration,
        cameras: material.calibration.cameras.map((camera, index) => index === 0
          ? {
              ...camera,
              intrinsicSourceOrder: [
                camera.intrinsicSourceOrder[0] + 1,
                camera.intrinsicSourceOrder[1],
                camera.intrinsicSourceOrder[2],
                camera.intrinsicSourceOrder[3],
              ],
            }
          : camera),
      },
    });
    expectSealAndParseToReject(changedIntrinsic, "do not exactly derive");
  });

  it("rejects duplicate or reordered source-bound record profiles at seal and parse", () => {
    const material = materialFixture();
    const block = material.sourceBindings.xbagConfigBlock;
    const first = requireFixtureValue(block.records[0], "record zero");
    const second = requireFixtureValue(block.records[1], "record one");
    const tail = block.records.slice(2);

    const reordered = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      sourceBindings: {
        ...material.sourceBindings,
        xbagConfigBlock: { ...block, records: [second, first, ...tail] },
      },
    });
    expectSealAndParseToReject(reordered, "not the exact source-bound profile");

    const duplicated = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      sourceBindings: {
        ...material.sourceBindings,
        xbagConfigBlock: { ...block, records: [first, first, ...tail] },
      },
    });
    expectSealAndParseToReject(duplicated, "not the exact source-bound profile");
  });

  it("cross-binds retained plaintext to its hashes and omits unrelated config text", () => {
    const material = materialFixture();
    const block = material.sourceBindings.xbagConfigBlock;
    const textDrift = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      sourceBindings: {
        ...material.sourceBindings,
        xbagConfigBlock: {
          ...block,
          records: block.records.map((record, index) => index === 0
            ? {
                ...record,
                payloadUtf8: EXACT_CAMERA_YAML.replace(
                  "791.5354272942999",
                  "792.5354272942999",
                ),
              }
            : record),
        },
      },
    });
    expectSealAndParseToReject(textDrift, "retained plaintext does not match");

    for (const index of [3, 4, 5]) {
      const unexpectedRecord = requireFixtureValue(block.records[index], `record ${String(index)}`);
      const unexpectedText = GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
        ...material,
        sourceBindings: {
          ...material.sourceBindings,
          xbagConfigBlock: {
            ...block,
            records: block.records.map((record, candidateIndex) => candidateIndex === index
              ? { ...record, payloadUtf8: "unexpected plaintext" }
              : record),
          },
        },
      });
      expectSealAndParseToReject(
        unexpectedText,
        `${unexpectedRecord.fileName} plaintext must not be serialized`,
      );
    }

    expect(() => GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      receiptAuthentication: "authenticated",
    })).toThrow();
    expect(() => GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      sourceBindings: {
        ...material.sourceBindings,
        xbagConfigBlock: { ...block, payloadTextRetention: "all" },
      },
    })).toThrow();
  });

  it("rejects self-digest drift, non-canonical bytes, and elevated authority", () => {
    const material = materialFixture();
    const receipt = sealGrandHallXgridsXbagCameraCalibration(material);
    const bytes = serializeGrandHallXgridsXbagCameraCalibration(receipt);
    const replacement = `${receipt.receiptSha256.slice(0, -1)}${
      receipt.receiptSha256.endsWith("0") ? "1" : "0"
    }`;
    const digestDrift = Buffer.from(
      bytes.toString("utf8").replace(receipt.receiptSha256, replacement),
      "utf8",
    );
    expect(() => parseGrandHallXgridsXbagCameraCalibration(digestDrift)).toThrow(
      "self-digest does not match",
    );
    expect(() => parseGrandHallXgridsXbagCameraCalibration(
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    )).toThrow("not canonical JSON");
    expect(() => parseGrandHallXgridsXbagCameraCalibration(
      Buffer.concat([bytes, Buffer.from("\n")]),
    )).toThrow("not canonical JSON");

    expect(() => GrandHallXgridsXbagCameraCalibrationMaterialSchema.parse({
      ...material,
      proof: { ...material.proof, runtimePermitted: true },
    })).toThrow();
  });

  it("accepts only one complete set of CLI arguments", () => {
    expect(parseGrandHallXbagCameraCalibrationArguments([
      "--check",
      "--raw-root",
      "F:\\raw-grand-hall",
      "--out",
      "C:\\evidence\\calibration.json",
    ])).toEqual({
      check: true,
      rawRoot: "F:\\raw-grand-hall",
      outputPath: "C:\\evidence\\calibration.json",
    });
    expect(parseGrandHallXbagCameraCalibrationArguments([
      "--raw-root",
      "F:\\raw-grand-hall",
      "--out",
      "C:\\evidence\\calibration.json",
    ])).toMatchObject({ check: false });
    expect(() => parseGrandHallXbagCameraCalibrationArguments([
      "--check",
      "--check",
      "--raw-root",
      "F:\\raw",
      "--out",
      "C:\\out.json",
    ])).toThrow("--check may be supplied only once");
    expect(() => parseGrandHallXbagCameraCalibrationArguments([
      "--raw-root",
      "F:\\raw",
      "--raw-root",
      "F:\\other",
      "--out",
      "C:\\out.json",
    ])).toThrow("--raw-root may be supplied only once");
    expect(() => parseGrandHallXbagCameraCalibrationArguments([
      "--raw-root",
      "F:\\raw",
    ])).toThrow("Usage:");
    expect(() => parseGrandHallXbagCameraCalibrationArguments(["--unknown"])).toThrow(
      "Unknown argument",
    );
  });

  it("rejects an existing output before inspecting a bogus raw root", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-xbag-calibration-no-replace-"));
    const outputPath = resolve(root, "already-exists.json");
    const bogusRawRoot = resolve(root, "deliberately-missing-raw-root");
    await writeFile(outputPath, "operator-owned-existing-bytes", "utf8");
    try {
      await expect(writeGrandHallXgridsXbagCameraCalibration({
        rawRoot: bogusRawRoot,
        outputPath,
      })).rejects.toThrow("output already exists; write mode is create-only");
      expect(await readFile(outputPath, "utf8")).toBe("operator-owned-existing-bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an absent output inside the raw root before source verification", async () => {
    const rawRoot = await mkdtemp(join(tmpdir(), "grand-hall-xbag-calibration-disjoint-"));
    const outputPath = resolve(rawRoot, "must-not-be-created.json");
    try {
      await expect(writeGrandHallXgridsXbagCameraCalibration({
        rawRoot,
        outputPath,
      })).rejects.toThrow("output must remain outside the raw XGRIDS source tree");
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(rawRoot, { recursive: true, force: true });
    }
  });

  it("rejects a replaced output parent after source build and before opening output", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-xbag-calibration-parent-race-"));
    const rawRoot = resolve(root, "raw");
    const outputParent = resolve(root, "output");
    const movedOutputParent = resolve(root, "output-bound-before-race");
    const outputPath = resolve(outputParent, "calibration.json");
    const movedOutputPath = resolve(movedOutputParent, "calibration.json");
    const receipt = sealGrandHallXgridsXbagCameraCalibration(materialFixture());
    await mkdir(rawRoot);
    await mkdir(outputParent);
    try {
      await expect(writeGrandHallXgridsXbagCameraCalibration({
        rawRoot,
        outputPath,
        testOnlyBuildReceipt: () => Promise.resolve(receipt),
        testOnlyAfterSourceBuild: async () => {
          await rename(outputParent, movedOutputParent);
          await mkdir(outputParent);
        },
      })).rejects.toThrow("calibration receipt parent changed after it was bound");
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(movedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a replaced output path after open without writing either path", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-xbag-calibration-output-race-"));
    const rawRoot = resolve(root, "raw");
    const outputParent = resolve(root, "output");
    const outputPath = resolve(outputParent, "calibration.json");
    const movedOutputPath = resolve(outputParent, "opened-empty-calibration.json");
    const replacementBytes = Buffer.from("operator-owned-race-replacement", "utf8");
    const receipt = sealGrandHallXgridsXbagCameraCalibration(materialFixture());
    await mkdir(rawRoot);
    await mkdir(outputParent);
    try {
      await expect(writeGrandHallXgridsXbagCameraCalibration({
        rawRoot,
        outputPath,
        testOnlyBuildReceipt: () => Promise.resolve(receipt),
        testOnlyAfterOutputOpen: async (openedPath) => {
          expect(openedPath).toBe(outputPath);
          await rename(outputPath, movedOutputPath);
          await writeFile(outputPath, replacementBytes);
        },
      })).rejects.toThrow(
        "empty output descriptor is not bound to the approved disjoint parent path",
      );
      expect(await readFile(outputPath)).toEqual(replacementBytes);
      expect((await readFile(movedOutputPath)).byteLength).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

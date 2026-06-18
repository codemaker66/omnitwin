import { describe, expect, it } from "vitest";
import type {
  RuntimeControlCoordinatePairIntakeV0,
  RuntimeControlCoordinatePairPacketBuildReportV0,
  RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";
import { RuntimeControlCoordinatePairIntakeV0Schema } from "@omnitwin/types";
import {
  formatRuntimeControlCoordinatePairPacketBuildReport,
  loadRuntimeControlSourcePacket,
  runBuildRuntimeControlPacketFromCoordinatePairs,
} from "../scripts/build-runtime-control-packet-from-coordinate-pairs.js";

const SOURCE_PACKET_FILE =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const INTAKE_FILE = "docs/operations/reception-room-coordinate-pair-intake-reviewed.json";

function sourcePacket(): RuntimeControlEvidencePacketV0 {
  return loadRuntimeControlSourcePacket();
}

function coordinatePairIntakeFixture(): RuntimeControlCoordinatePairIntakeV0 {
  const packet = sourcePacket();
  const coordinatePairs = packet.landmarks.map((landmark, index) => {
    const evidenceRef = landmark.evidenceRefs[0];
    if (evidenceRef === undefined) {
      throw new Error("Expected landmark fixture to include evidence refs.");
    }
    const residualM = 0.012 + index * 0.001;
    return {
      landmarkId: landmark.landmarkId,
      sourcePoint: {
        frame: "ARF",
        coordinate: [index, index + 0.1, index + 0.2] as [number, number, number],
        evidenceRefs: [evidenceRef],
      },
      targetPoint: {
        frame: "CVF",
        coordinate: [index + 1, index + 1.1, index + 1.2] as [number, number, number],
        evidenceRefs: [evidenceRef],
      },
      residualM,
      reviewerRole: "runtime_reviewer",
      evidenceRefs: [evidenceRef],
      note: "Reviewed synthetic coordinate pair for script regression only.",
    };
  });
  const residuals = coordinatePairs.map((pair) => pair.residualM);

  return RuntimeControlCoordinatePairIntakeV0Schema.parse({
    schemaVersion: "runtime-control-coordinate-pair-intake.v0",
    intakeId: "reception-room-coordinate-pair-intake-test",
    sourcePacketId: packet.packetId,
    venueSlug: packet.venueSlug,
    roomSlug: packet.roomSlug,
    runtimePackageId: packet.runtimePackageId,
    recordedAt: "2026-06-16T17:00:00.000Z",
    recordedBy: "runtime-review-operator",
    sourceFrame: "ARF",
    targetFrame: "CVF",
    qaStatus: "human_reviewed",
    coordinatePairs,
    residualRmseM: Math.sqrt(
      residuals.reduce((total, residual) => total + residual * residual, 0) /
        residuals.length,
    ),
    maxResidualM: Math.max(...residuals),
    evidenceRefs: [
      {
        kind: "measurement_record",
        label: "Synthetic coordinate-pair intake fixture",
        ref: INTAKE_FILE,
      },
    ],
    guardrails: {
      sourcePacketMutated: false,
      reviewedPacketCreated: false,
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    },
  });
}

describe("build-runtime-control-packet-from-coordinate-pairs script", () => {
  it("writes a blocked report and no reviewed packet when no coordinate-pair intake is provided", () => {
    const reports: RuntimeControlCoordinatePairPacketBuildReportV0[] = [];
    const packets: RuntimeControlEvidencePacketV0[] = [];
    const logs: string[] = [];

    const report = runBuildRuntimeControlPacketFromCoordinatePairs({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE: "reports/coordinate-build-report.json",
        REVIEWED_RUNTIME_CONTROL_PACKET_FILE: "reports/reviewed-packet.json",
      },
      now: () => new Date("2026-06-16T17:05:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      reportFileExists: () => false,
      reviewedPacketFileExists: () => false,
      writeReport: (_filePath, writtenReport) => {
        reports.push(writtenReport);
      },
      writeReviewedPacket: (_filePath, packet) => {
        packets.push(packet);
      },
      log: (message) => logs.push(message),
    });

    expect(report.status).toBe("blocked_missing_coordinate_pair_intake");
    expect(report.reviewedPacket).toBeNull();
    expect(reports).toHaveLength(1);
    expect(packets).toHaveLength(0);
    expect(report.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
    expect(logs).toContain(
      "Runtime-control coordinate-pair packet build: blocked_missing_coordinate_pair_intake.",
    );
  });

  it("writes a reviewed runtime-control packet from reviewed coordinate-pair intake", () => {
    const reports: RuntimeControlCoordinatePairPacketBuildReportV0[] = [];
    const packets: RuntimeControlEvidencePacketV0[] = [];

    const report = runBuildRuntimeControlPacketFromCoordinatePairs({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE: INTAKE_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE: "reports/coordinate-build-report.json",
        REVIEWED_RUNTIME_CONTROL_PACKET_FILE: "reports/reviewed-packet.json",
        REVIEWED_RUNTIME_CONTROL_PACKET_ID: "reception-room-reviewed-coordinate-pairs-test",
      },
      now: () => new Date("2026-06-16T17:10:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      readCoordinatePairIntake: () => coordinatePairIntakeFixture(),
      reportFileExists: () => false,
      reviewedPacketFileExists: () => false,
      writeReport: (_filePath, writtenReport) => {
        reports.push(writtenReport);
      },
      writeReviewedPacket: (_filePath, packet) => {
        packets.push(packet);
      },
      log: () => undefined,
    });

    expect(report.status).toBe("packet_built");
    expect(report.reviewedPacket?.packetId).toBe("reception-room-reviewed-coordinate-pairs-test");
    expect(report.reviewedPacketSummary?.reviewedLandmarks).toBe(4);
    expect(reports).toHaveLength(1);
    expect(packets).toHaveLength(1);
    expect(packets[0]?.disposition).toBe("ready_for_capture_control_registration");
  });

  it("formats blocked coordinate-pair reports with explicit blockers", () => {
    const report = runBuildRuntimeControlPacketFromCoordinatePairs({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
      },
      now: () => new Date("2026-06-16T17:15:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      log: () => undefined,
    });

    expect(formatRuntimeControlCoordinatePairPacketBuildReport(report)).toContain(
      "Blocker: No reviewed coordinate-pair intake file was provided.",
    );
  });
});

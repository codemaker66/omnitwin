import { describe, expect, it } from "vitest";
import type {
  RuntimeControlCoordinatePairIntakeInspectionV0,
  RuntimeControlCoordinatePairIntakeV0,
  RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";
import { RuntimeControlCoordinatePairIntakeV0Schema } from "@omnitwin/types";
import {
  formatRuntimeControlCoordinatePairIntakeInspection,
  runInspectRuntimeControlCoordinatePairIntake,
} from "../scripts/inspect-runtime-control-coordinate-pair-intake.js";
import { loadRuntimeControlSourcePacket } from "../scripts/build-runtime-control-packet-from-coordinate-pairs.js";

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
      note: "Reviewed synthetic coordinate pair for inspection regression only.",
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
    recordedAt: "2026-06-16T17:30:00.000Z",
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

describe("inspect-runtime-control-coordinate-pair-intake script", () => {
  it("writes a missing-intake inspection when no intake file is provided", () => {
    const reports: RuntimeControlCoordinatePairIntakeInspectionV0[] = [];
    const logs: string[] = [];

    const report = runInspectRuntimeControlCoordinatePairIntake({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_FILE: "reports/intake-inspection.json",
      },
      now: () => new Date("2026-06-16T17:35:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      reportFileExists: () => false,
      writeReport: (_filePath, writtenReport) => {
        reports.push(writtenReport);
      },
      log: (message) => logs.push(message),
    });

    expect(report.status).toBe("missing_intake_file");
    expect(report.readyForReviewedPacketBuild).toBe(false);
    expect(report.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
    expect(reports).toHaveLength(1);
    expect(logs).toContain("Runtime-control coordinate-pair intake inspection: missing_intake_file.");
  });

  it("reports invalid intake schema issues without throwing", () => {
    const report = runInspectRuntimeControlCoordinatePairIntake({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE: INTAKE_FILE,
      },
      now: () => new Date("2026-06-16T17:40:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      readCoordinatePairIntake: () => ({
        schemaVersion: "runtime-control-coordinate-pair-intake.v0",
      }),
      log: () => undefined,
    });

    expect(report.status).toBe("invalid_intake");
    expect(report.readyForReviewedPacketBuild).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it("reports ready when a reviewed coordinate-pair intake matches the source packet", () => {
    const report = runInspectRuntimeControlCoordinatePairIntake({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE: INTAKE_FILE,
      },
      now: () => new Date("2026-06-16T17:45:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      readCoordinatePairIntake: () => coordinatePairIntakeFixture(),
      log: () => undefined,
    });

    expect(report.status).toBe("ready_for_reviewed_packet_build");
    expect(report.readyForReviewedPacketBuild).toBe(true);
    expect(report.coordinatePairIntakeSummary?.coordinatePairCount).toBe(4);
    expect(report.blockers).toEqual([]);
  });

  it("formats missing-intake inspection blockers", () => {
    const report = runInspectRuntimeControlCoordinatePairIntake({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
      },
      now: () => new Date("2026-06-16T17:50:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      log: () => undefined,
    });

    expect(formatRuntimeControlCoordinatePairIntakeInspection(report)).toContain(
      "Blocker: No reviewed coordinate-pair intake file was provided.",
    );
  });
});

import { describe, expect, it } from "vitest";
import type {
  RegisterCaptureControlSourceRecordInput,
  RuntimeControlCaptureControlPayloadBuildReportV0,
  RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";
import { RuntimeControlEvidencePacketV0Schema } from "@omnitwin/types";
import {
  formatRuntimeControlCaptureControlPayloadBuildReport,
  loadRuntimeControlEvidencePacket,
  runBuildCaptureControlSourceFromRuntimeControl,
} from "../scripts/build-capture-control-source-from-runtime-control.js";

const PACKET_FILE =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";

function currentPacket(): RuntimeControlEvidencePacketV0 {
  return loadRuntimeControlEvidencePacket();
}

function reviewedLandmark(
  landmark: RuntimeControlEvidencePacketV0["landmarks"][number],
  index: number,
): RuntimeControlEvidencePacketV0["landmarks"][number] {
  const evidenceRef = landmark.evidenceRefs[0];
  if (evidenceRef === undefined) {
    throw new Error("Expected landmark fixture to include evidence refs.");
  }

  return {
    ...landmark,
    status: "reviewed",
    sourcePoint: {
      frame: "ARF",
      coordinate: [index, index + 0.1, index + 0.2],
      evidenceRefs: [evidenceRef],
    },
    targetPoint: {
      frame: "CVF",
      coordinate: [index + 1, index + 1.1, index + 1.2],
      evidenceRefs: [evidenceRef],
    },
    residualM: 0.01 + index * 0.001,
    reviewerRole: "runtime_reviewer",
    note: "Reviewed synthetic landmark pair for script regression only.",
  };
}

function readyPacket(): RuntimeControlEvidencePacketV0 {
  const packet = currentPacket();

  return RuntimeControlEvidencePacketV0Schema.parse({
    ...packet,
    disposition: "ready_for_capture_control_registration",
    intendedCaptureControl: {
      ...packet.intendedCaptureControl,
      qaStatus: "human_reviewed",
    },
    landmarks: packet.landmarks.map(reviewedLandmark),
    blockers: [],
    requiredBeforeRegistration: [],
  });
}

describe("build-capture-control-source-from-runtime-control script", () => {
  it("loads the checked-in Reception Room landmark-control packet", () => {
    const packet = currentPacket();

    expect(packet.packetId).toBe("reception-room-landmark-control-intake-2026-06-16");
    expect(packet.disposition).toBe("candidate_landmarks_recorded");
  });

  it("writes a blocked report and no payload for the current visible-only packet", () => {
    const reports: RuntimeControlCaptureControlPayloadBuildReportV0[] = [];
    const payloads: RegisterCaptureControlSourceRecordInput[] = [];
    const logs: string[] = [];

    const report = runBuildCaptureControlSourceFromRuntimeControl({
      env: {
        RUNTIME_CONTROL_PACKET_FILE: PACKET_FILE,
        RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE: "reports/blocked-report.json",
        CAPTURE_CONTROL_SOURCE_FILE: "reports/manual-landmarks-source.json",
      },
      now: () => new Date("2026-06-16T16:00:00.000Z"),
      readPacket: () => currentPacket(),
      reportFileExists: () => false,
      payloadFileExists: () => false,
      writeReport: (_filePath, writtenReport) => {
        reports.push(writtenReport);
      },
      writePayload: (_filePath, payload) => {
        payloads.push(payload);
      },
      log: (message) => logs.push(message),
    });

    expect(report.status).toBe("blocked_current_packet");
    expect(report.payload).toBeNull();
    expect(report.payloadFile).toBeNull();
    expect(reports).toHaveLength(1);
    expect(payloads).toHaveLength(0);
    expect(report.blockers).toContain("Packet still lists open blockers.");
    expect(logs).toContain("Runtime-control payload build: blocked_current_packet.");
  });

  it("writes a capture-control payload from a reviewed packet", () => {
    const reports: RuntimeControlCaptureControlPayloadBuildReportV0[] = [];
    const payloads: RegisterCaptureControlSourceRecordInput[] = [];

    const report = runBuildCaptureControlSourceFromRuntimeControl({
      env: {
        RUNTIME_CONTROL_PACKET_FILE: PACKET_FILE,
        RUNTIME_CONTROL_PACKET_REF: PACKET_FILE,
        RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE: "reports/built-report.json",
        CAPTURE_CONTROL_SOURCE_FILE: "reports/manual-landmarks-source.json",
        RUNTIME_CONTROL_CAPTURE_CONTROL_SOURCE_ID: "reception-room-reviewed-manual-landmarks-v0",
      },
      now: () => new Date("2026-06-16T16:05:00.000Z"),
      readPacket: () => readyPacket(),
      reportFileExists: () => false,
      payloadFileExists: () => false,
      writeReport: (_filePath, writtenReport) => {
        reports.push(writtenReport);
      },
      writePayload: (_filePath, payload) => {
        payloads.push(payload);
      },
      log: () => undefined,
    });

    expect(report.status).toBe("payload_built");
    expect(
      report.payloadFile?.replaceAll("\\", "/").endsWith("reports/manual-landmarks-source.json"),
    ).toBe(true);
    expect(reports).toHaveLength(1);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.source.sourceId).toBe("reception-room-reviewed-manual-landmarks-v0");
    expect(payloads[0]?.source.sourceClass).toBe("manual_landmarks");
    expect(payloads[0]?.source.sourceRefs).toContainEqual({
      refType: "landmark_set",
      ref: PACKET_FILE,
      role: "reviewed_landmark_packet",
    });
  });

  it("formats blocked reports with explicit blockers", () => {
    const report = runBuildCaptureControlSourceFromRuntimeControl({
      env: {
        RUNTIME_CONTROL_PACKET_FILE: PACKET_FILE,
      },
      now: () => new Date("2026-06-16T16:10:00.000Z"),
      readPacket: () => currentPacket(),
      log: () => undefined,
    });

    expect(formatRuntimeControlCaptureControlPayloadBuildReport(report)).toContain(
      "Blocker: Packet disposition is not ready for capture-control registration.",
    );
  });

  it("refuses to overwrite an existing build report without the overwrite flag", () => {
    expect(() => runBuildCaptureControlSourceFromRuntimeControl({
      env: {
        RUNTIME_CONTROL_PACKET_FILE: PACKET_FILE,
        RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE: "reports/existing-report.json",
      },
      reportFileExists: () => true,
      log: () => undefined,
    })).toThrow("Refusing to overwrite");
  });
});

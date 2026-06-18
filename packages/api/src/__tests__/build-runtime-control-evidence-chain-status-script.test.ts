import { describe, expect, it } from "vitest";
import type { RuntimeControlEvidenceChainStatusV0 } from "@omnitwin/types";
import {
  formatRuntimeControlEvidenceChainStatus,
  runBuildRuntimeControlEvidenceChainStatus,
} from "../scripts/build-runtime-control-evidence-chain-status.js";

const SOURCE_PACKET_FILE =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const REQUEST_FILE =
  "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json";
const INSPECTION_FILE =
  "docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json";
const PACKET_BUILD_REPORT_FILE =
  "docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json";
const PAYLOAD_BUILD_REPORT_FILE =
  "docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json";
const TRANSFORM_READINESS_FILE =
  "docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json";
const CHAIN_STATUS_FILE =
  "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json";

function currentEnv(): Readonly<Record<string, string>> {
  return {
    RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
    RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE: REQUEST_FILE,
    RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_FILE: INSPECTION_FILE,
    RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE: PACKET_BUILD_REPORT_FILE,
    RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE: PAYLOAD_BUILD_REPORT_FILE,
    RUNTIME_TRANSFORM_READINESS_FILE: TRANSFORM_READINESS_FILE,
  };
}

describe("build-runtime-control-evidence-chain-status script", () => {
  it("writes a blocked chain-status report from current Reception Room artifacts", () => {
    const statuses: RuntimeControlEvidenceChainStatusV0[] = [];
    const logs: string[] = [];

    const status = runBuildRuntimeControlEvidenceChainStatus({
      env: {
        ...currentEnv(),
        RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_FILE: CHAIN_STATUS_FILE,
      },
      now: () => new Date("2026-06-16T19:20:00.000Z"),
      statusFileExists: () => false,
      writeStatus: (_filePath, writtenStatus) => {
        statuses.push(writtenStatus);
      },
      log: (message) => logs.push(message),
    });

    expect(status.chainStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.coordinatePairIntakeRequestStatus).toBe("coordinate_pairs_required");
    expect(status.coordinatePairIntakeInspectionStatus).toBe("missing_intake_file");
    expect(status.coordinatePairPacketBuildStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.captureControlPayloadBuildStatus).toBe("blocked_current_packet");
    expect(status.transformReadinessDisposition).toBe("blocked_visual_alignment_only");
    expect(status.requiredCoordinatePairCount).toBe(4);
    expect(status.reviewedCoordinatePairCount).toBe(0);
    expect(status.guardrails.coordinatePairIntakeCreated).toBe(false);
    expect(status.guardrails.reviewedPacketCreated).toBe(false);
    expect(status.guardrails.captureControlSourceCreated).toBe(false);
    expect(status.guardrails.signedTransformCreated).toBe(false);
    expect(statuses).toHaveLength(1);
    expect(logs).toContain(
      "Runtime-control evidence chain status: blocked_missing_coordinate_pair_intake.",
    );
    expect(logs).toContain("Required coordinate pairs: 4; reviewed coordinate pairs: 0.");
  });

  it("refuses to overwrite an existing chain-status report unless the overwrite flag is set", () => {
    expect(() => runBuildRuntimeControlEvidenceChainStatus({
      env: {
        ...currentEnv(),
        RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_FILE: CHAIN_STATUS_FILE,
      },
      statusFileExists: () => true,
      writeStatus: () => undefined,
      log: () => undefined,
    })).toThrow("Refusing to overwrite");
  });

  it("formats blockers and next actions for operators", () => {
    const status = runBuildRuntimeControlEvidenceChainStatus({
      env: currentEnv(),
      now: () => new Date("2026-06-16T19:25:00.000Z"),
      log: () => undefined,
    });

    expect(formatRuntimeControlEvidenceChainStatus(status)).toContain(
      "Blocker: No reviewed coordinate-pair intake file was provided.",
    );
    expect(formatRuntimeControlEvidenceChainStatus(status)).toContain(
      "Next: Create the reviewed coordinate-pair intake file from the requested ARF and CVF landmark measurements.",
    );
  });
});

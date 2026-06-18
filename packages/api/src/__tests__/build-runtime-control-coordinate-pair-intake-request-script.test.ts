import { describe, expect, it } from "vitest";
import type {
  RuntimeControlCoordinatePairIntakeRequestV0,
  RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";
import {
  formatRuntimeControlCoordinatePairIntakeRequest,
  runBuildRuntimeControlCoordinatePairIntakeRequest,
} from "../scripts/build-runtime-control-coordinate-pair-intake-request.js";
import { loadRuntimeControlSourcePacket } from "../scripts/build-runtime-control-packet-from-coordinate-pairs.js";

const SOURCE_PACKET_FILE =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const REQUEST_FILE =
  "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json";

function sourcePacket(): RuntimeControlEvidencePacketV0 {
  return loadRuntimeControlSourcePacket();
}

describe("build-runtime-control-coordinate-pair-intake-request script", () => {
  it("writes a coordinate-pair intake request without writing coordinates", () => {
    const requests: RuntimeControlCoordinatePairIntakeRequestV0[] = [];
    const logs: string[] = [];

    const request = runBuildRuntimeControlCoordinatePairIntakeRequest({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE: REQUEST_FILE,
      },
      now: () => new Date("2026-06-16T18:20:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      requestFileExists: () => false,
      writeRequest: (_filePath, writtenRequest) => {
        requests.push(writtenRequest);
      },
      log: (message) => logs.push(message),
    });

    expect(request.status).toBe("coordinate_pairs_required");
    expect(request.requiredCoordinatePairCount).toBe(4);
    expect(request.landmarkRequests.every((landmark) => !("sourcePoint" in landmark))).toBe(true);
    expect(request.landmarkRequests.every((landmark) => !("targetPoint" in landmark))).toBe(true);
    expect(request.guardrails.coordinatePairIntakeCreated).toBe(false);
    expect(requests).toHaveLength(1);
    expect(logs).toContain("Runtime-control coordinate-pair intake request: coordinate_pairs_required.");
    expect(logs).toContain("Required coordinate pairs: 4.");
  });

  it("refuses to overwrite an existing request unless the overwrite flag is set", () => {
    expect(() => runBuildRuntimeControlCoordinatePairIntakeRequest({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE: REQUEST_FILE,
      },
      readSourcePacket: () => sourcePacket(),
      requestFileExists: () => true,
      writeRequest: () => undefined,
      log: () => undefined,
    })).toThrow("Refusing to overwrite");
  });

  it("formats required landmark measurements", () => {
    const request = runBuildRuntimeControlCoordinatePairIntakeRequest({
      env: {
        RUNTIME_CONTROL_SOURCE_PACKET_FILE: SOURCE_PACKET_FILE,
      },
      now: () => new Date("2026-06-16T18:25:00.000Z"),
      readSourcePacket: () => sourcePacket(),
      log: () => undefined,
    });

    expect(formatRuntimeControlCoordinatePairIntakeRequest(request)).toContain(
      "Measure: reception-door-left-jamb-base (Reception room door left jamb base candidate) ARF->CVF.",
    );
  });
});

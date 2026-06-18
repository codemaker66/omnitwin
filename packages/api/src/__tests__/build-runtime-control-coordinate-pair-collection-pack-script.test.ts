import { describe, expect, it } from "vitest";
import type { RuntimeControlCoordinatePairIntakeRequestV0 } from "@omnitwin/types";
import {
  formatRuntimeControlCoordinatePairCollectionPack,
  formatRuntimeControlCoordinatePairCollectionPackSummary,
  runBuildRuntimeControlCoordinatePairCollectionPack,
} from "../scripts/build-runtime-control-coordinate-pair-collection-pack.js";
import { runBuildRuntimeControlCoordinatePairIntakeRequest } from "../scripts/build-runtime-control-coordinate-pair-intake-request.js";
import { loadRuntimeControlSourcePacket } from "../scripts/build-runtime-control-packet-from-coordinate-pairs.js";

const REQUEST_FILE =
  "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json";
const COLLECTION_PACK_FILE =
  "docs/operations/reception-room-coordinate-pair-collection-pack-2026-06-16.md";

function requestFixture(): RuntimeControlCoordinatePairIntakeRequestV0 {
  return runBuildRuntimeControlCoordinatePairIntakeRequest({
    env: {
      RUNTIME_CONTROL_SOURCE_PACKET_FILE:
        "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    },
    now: () => new Date("2026-06-16T20:30:00.000Z"),
    readSourcePacket: () => loadRuntimeControlSourcePacket(),
    log: () => undefined,
  });
}

describe("build-runtime-control-coordinate-pair-collection-pack script", () => {
  it("writes a human-readable collection pack without creating reviewed evidence", () => {
    const written: string[] = [];
    const logs: string[] = [];

    const markdown = runBuildRuntimeControlCoordinatePairCollectionPack({
      env: {
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE: REQUEST_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK_FILE: COLLECTION_PACK_FILE,
      },
      readRequest: () => requestFixture(),
      packFileExists: () => false,
      writePack: (_filePath, value) => {
        written.push(value);
      },
      log: (message) => logs.push(message),
    });

    expect(written).toEqual([markdown]);
    expect(markdown).toContain("# Reception Room coordinate-pair collection pack");
    expect(markdown).toContain("Required coordinate pairs | 4");
    expect(markdown).toContain("reception-door-left-jamb-base");
    expect(markdown).toContain("| reception-door-left-jamb-base | Reception room door left jamb base candidate |");
    expect(markdown).toContain("ARF source coordinate");
    expect(markdown).toContain("CVF target coordinate");
    expect(markdown).toContain("Coordinate-pair intake | no");
    expect(markdown).toContain("Reviewed runtime-control packet | no");
    expect(markdown).toContain("Signed transform | no");
    expect(markdown).not.toContain("\"coordinate\":");
    expect(markdown).not.toContain("sourcePoint");
    expect(markdown).not.toContain("targetPoint");
    expect(logs).toContain("Runtime-control coordinate-pair collection pack: coordinate_pairs_required.");
    expect(logs).toContain("Required coordinate pairs: 4.");
    expect(logs).toContain(
      "No reviewed intake, reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created.",
    );
  });

  it("refuses to overwrite an existing collection pack unless the overwrite flag is set", () => {
    expect(() => runBuildRuntimeControlCoordinatePairCollectionPack({
      env: {
        RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE: REQUEST_FILE,
        RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK_FILE: COLLECTION_PACK_FILE,
      },
      readRequest: () => requestFixture(),
      packFileExists: () => true,
      writePack: () => undefined,
      log: () => undefined,
    })).toThrow("Refusing to overwrite");
  });

  it("formats scope, claim boundary, and required landmark rows", () => {
    const request = requestFixture();
    const markdown = formatRuntimeControlCoordinatePairCollectionPack(
      request,
      REQUEST_FILE,
    );
    const summary = formatRuntimeControlCoordinatePairCollectionPackSummary(
      request,
      COLLECTION_PACK_FILE,
    );

    expect(markdown).toContain("Use this pack to collect measurements only.");
    expect(markdown).toContain("Convert the collected values into a separate `runtime-control-coordinate-pair-intake.v0` JSON file.");
    expect(markdown).toContain("reception-column-plinth-front-corner");
    expect(markdown).toContain("per landmark residual m");
    expect(summary).toContain(`Collection pack: ${COLLECTION_PACK_FILE}.`);
  });
});

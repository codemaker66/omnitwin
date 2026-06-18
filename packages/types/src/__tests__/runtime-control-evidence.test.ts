import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_CONTROL_EVIDENCE_PACKET_V0_SCHEMA_VERSION,
  RuntimeControlCaptureControlPayloadBuildReportV0Schema,
  RuntimeControlCoordinatePairIntakeInspectionV0Schema,
  RuntimeControlCoordinatePairIntakeRequestV0Schema,
  RuntimeControlCoordinatePairIntakeV0Schema,
  RuntimeControlCoordinatePairPacketBuildReportV0Schema,
  RuntimeControlEvidenceChainStatusV0Schema,
  RuntimeControlEvidencePacketV0Schema,
  buildReviewedRuntimeControlPacketFromCoordinatePairIntake,
  buildRuntimeControlCoordinatePairIntakeRequest,
  buildRuntimeControlCoordinatePairPacketReport,
  buildManualLandmarksCaptureControlSourcePayload,
  buildRuntimeControlCaptureControlPayloadReport,
  buildRuntimeControlEvidenceChainStatus,
  inspectRuntimeControlCoordinatePairIntake,
  runtimeControlCoordinatePairIntakeRequestBlockers,
  runtimeControlCoordinatePairPacketBuildBlockers,
  runtimeControlLandmarkSetSummary,
  runtimeControlPacketManualLandmarkPayloadBlockers,
  type RuntimeControlCoordinatePairIntakeV0,
  type RuntimeControlEvidencePacketV0,
} from "../runtime-control-evidence.js";
import { RuntimeTransformReadinessV0Schema } from "../runtime-transform-readiness.js";

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomLandmarkControlPacket(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
  );
}

function loadReceptionRoomManualLandmarksBuildReport(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json",
  );
}

function loadReceptionRoomCoordinatePairPacketBuildReport(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json",
  );
}

function loadReceptionRoomCoordinatePairIntakeInspection(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json",
  );
}

function loadReceptionRoomCoordinatePairIntakeRequest(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json",
  );
}

function loadReceptionRoomRuntimeTransformReadiness(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json",
  );
}

function loadReceptionRoomRuntimeControlEvidenceChainStatus(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
  );
}

function parsedPacket(): RuntimeControlEvidencePacketV0 {
  return RuntimeControlEvidencePacketV0Schema.parse(
    loadReceptionRoomLandmarkControlPacket(),
  );
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
    residualM: 0.012 + index * 0.001,
    reviewerRole: "runtime_reviewer",
    note: "Reviewed synthetic landmark pair for schema regression only.",
  };
}

function readyPacketFixture(): RuntimeControlEvidencePacketV0 {
  const packet = parsedPacket();

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

function coordinatePairIntakeFixture(): RuntimeControlCoordinatePairIntakeV0 {
  const packet = parsedPacket();
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
      note: "Reviewed synthetic coordinate pair for schema regression only.",
    };
  });
  const residuals = coordinatePairs.map((pair) => pair.residualM);
  const residualRmseM = Math.sqrt(
    residuals.reduce((total, residual) => total + residual * residual, 0) /
      residuals.length,
  );

  return RuntimeControlCoordinatePairIntakeV0Schema.parse({
    schemaVersion: "runtime-control-coordinate-pair-intake.v0",
    intakeId: "reception-room-coordinate-pair-intake-test",
    sourcePacketId: packet.packetId,
    venueSlug: packet.venueSlug,
    roomSlug: packet.roomSlug,
    runtimePackageId: packet.runtimePackageId,
    recordedAt: "2026-06-16T16:30:00.000Z",
    recordedBy: "runtime-review-operator",
    sourceFrame: "ARF",
    targetFrame: "CVF",
    qaStatus: "human_reviewed",
    coordinatePairs,
    residualRmseM,
    maxResidualM: Math.max(...residuals),
    evidenceRefs: [
      {
        kind: "measurement_record",
        label: "Synthetic coordinate-pair intake fixture",
        ref: "docs/operations/reception-room-coordinate-pair-intake-test.json",
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

describe("Runtime control evidence packet", () => {
  it("validates the Reception Room landmark/control intake packet as visible-only candidates", () => {
    const packet = parsedPacket();

    expect(packet.schemaVersion).toBe(RUNTIME_CONTROL_EVIDENCE_PACKET_V0_SCHEMA_VERSION);
    expect(packet.packetId).toBe("reception-room-landmark-control-intake-2026-06-16");
    expect(packet.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(packet.disposition).toBe("candidate_landmarks_recorded");
    expect(packet.sourceFrame).toBe("ARF");
    expect(packet.targetFrame).toBe("CVF");
    expect(packet.intendedCaptureControl.sourceClass).toBe("manual_landmarks");
    expect(packet.intendedCaptureControl.poseAuthorityLevel).toBe("manual_landmark_control");
    expect(packet.intendedCaptureControl.alignmentMethods).toEqual(["landmark_solve"]);
    expect(packet.intendedCaptureControl.qaStatus).toBe("requires_human_review");
    expect(packet.targetTransformArtifactId).toBeNull();
    expect(packet.landmarks).toHaveLength(4);
    expect(packet.landmarks.every((landmark) =>
      landmark.status === "candidate_visible_only" &&
      landmark.sourcePoint === null &&
      landmark.targetPoint === null &&
      landmark.residualM === null,
    )).toBe(true);
    expect(packet.guardrails).toEqual({
      captureControlSourceCreated: false,
      transformPayloadCreated: false,
      signedTransformCreated: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    });
    expect(runtimeControlLandmarkSetSummary(packet)).toEqual({
      totalLandmarks: 4,
      nonRejectedLandmarks: 4,
      reviewedLandmarks: 0,
      sourceFrame: "ARF",
      targetFrame: "CVF",
      residualRmseM: null,
      maxResidualM: null,
      allNonRejectedLandmarksReviewed: false,
    });
  });

  it("accepts a ready synthetic packet only with reviewed coordinate pairs", () => {
    const packet = readyPacketFixture();

    expect(packet.disposition).toBe("ready_for_capture_control_registration");
    expect(packet.intendedCaptureControl.qaStatus).toBe("human_reviewed");
    expect(packet.landmarks.every((landmark) => landmark.status === "reviewed")).toBe(true);
    expect(packet.blockers).toEqual([]);
    expect(runtimeControlLandmarkSetSummary(packet).reviewedLandmarks).toBe(4);
    expect(runtimeControlLandmarkSetSummary(packet).residualRmseM).toBeGreaterThan(0);
    expect(runtimeControlLandmarkSetSummary(packet).maxResidualM).toBeGreaterThan(0);
  });

  it("builds a coordinate-pair intake request without creating coordinates", () => {
    const sourcePacket = parsedPacket();
    const request = buildRuntimeControlCoordinatePairIntakeRequest(sourcePacket, {
      generatedAt: "2026-06-16T18:10:00.000Z",
      sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    });

    expect(request.status).toBe("coordinate_pairs_required");
    expect(request.requiredCoordinatePairCount).toBe(4);
    expect(request.blockers).toEqual([]);
    expect(request.landmarkRequests.every((landmark) => landmark.required)).toBe(true);
    expect(request.landmarkRequests.every((landmark) => !("sourcePoint" in landmark))).toBe(true);
    expect(request.landmarkRequests.every((landmark) => !("targetPoint" in landmark))).toBe(true);
    expect(request.guardrails.coordinatePairIntakeCreated).toBe(false);
    expect(request.guardrails.reviewedPacketCreated).toBe(false);
  });

  it("blocks coordinate-pair intake requests with fewer than three required landmarks", () => {
    const sourcePacket = parsedPacket();
    const insufficientPacket = RuntimeControlEvidencePacketV0Schema.parse({
      ...sourcePacket,
      landmarks: sourcePacket.landmarks.map((landmark, index) => ({
        ...landmark,
        status: index < 2 ? landmark.status : "rejected",
      })),
    });
    const blockers = runtimeControlCoordinatePairIntakeRequestBlockers(insufficientPacket);
    const request = buildRuntimeControlCoordinatePairIntakeRequest(insufficientPacket, {
      generatedAt: "2026-06-16T18:15:00.000Z",
      sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    });

    expect(blockers).toContain(
      "At least three non-rejected landmark candidates are required; the source packet has 2.",
    );
    expect(request.status).toBe("blocked_insufficient_landmark_candidates");
    expect(request.requiredCoordinatePairCount).toBe(2);
    expect(request.landmarkRequests.filter((landmark) => landmark.required)).toHaveLength(2);
  });

  it("builds a reviewed runtime-control packet from reviewed coordinate-pair intake", () => {
    const sourcePacket = parsedPacket();
    const intake = coordinatePairIntakeFixture();
    const reviewedPacket = buildReviewedRuntimeControlPacketFromCoordinatePairIntake(
      sourcePacket,
      intake,
      {
        packetId: "reception-room-reviewed-coordinate-pairs-test",
        recordedAt: "2026-06-16T16:40:00.000Z",
        recordedBy: "runtime-review-operator",
      },
    );

    expect(reviewedPacket.packetId).toBe("reception-room-reviewed-coordinate-pairs-test");
    expect(reviewedPacket.disposition).toBe("ready_for_capture_control_registration");
    expect(reviewedPacket.intendedCaptureControl.qaStatus).toBe("human_reviewed");
    expect(reviewedPacket.blockers).toEqual([]);
    expect(reviewedPacket.requiredBeforeRegistration).toEqual([]);
    expect(runtimeControlLandmarkSetSummary(reviewedPacket).reviewedLandmarks).toBe(4);
    expect(runtimeControlPacketManualLandmarkPayloadBlockers(reviewedPacket)).toEqual([]);
  });

  it("reports missing and incompatible coordinate-pair intake without building a reviewed packet", () => {
    const sourcePacket = parsedPacket();
    const missingReport = buildRuntimeControlCoordinatePairPacketReport(
      sourcePacket,
      null,
      {
        generatedAt: "2026-06-16T16:45:00.000Z",
        sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
        recordedAt: "2026-06-16T16:45:00.000Z",
        recordedBy: "runtime-review-operator",
      },
    );
    const incompleteIntake = RuntimeControlCoordinatePairIntakeV0Schema.parse({
      ...coordinatePairIntakeFixture(),
      coordinatePairs: coordinatePairIntakeFixture().coordinatePairs.slice(0, 3),
      residualRmseM: Math.sqrt(
        coordinatePairIntakeFixture().coordinatePairs.slice(0, 3).reduce(
          (total, pair) => total + pair.residualM * pair.residualM,
          0,
        ) / 3,
      ),
      maxResidualM: Math.max(...coordinatePairIntakeFixture().coordinatePairs.slice(0, 3).map((pair) => pair.residualM)),
    });
    const incompatibleBlockers = runtimeControlCoordinatePairPacketBuildBlockers(
      sourcePacket,
      incompleteIntake,
    );

    expect(missingReport.status).toBe("blocked_missing_coordinate_pair_intake");
    expect(missingReport.reviewedPacket).toBeNull();
    expect(missingReport.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
    expect(incompatibleBlockers).toContain(
      "Missing reviewed coordinate pair for landmark reception-skirting-floor-corner-left.",
    );
  });

  it("inspects coordinate-pair intake readiness without building packets", () => {
    const sourcePacket = parsedPacket();
    const missingInspection = inspectRuntimeControlCoordinatePairIntake(sourcePacket, null, {
      generatedAt: "2026-06-16T17:20:00.000Z",
      sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    });
    const readyInspection = inspectRuntimeControlCoordinatePairIntake(
      sourcePacket,
      coordinatePairIntakeFixture(),
      {
        generatedAt: "2026-06-16T17:25:00.000Z",
        sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
        coordinatePairIntakeRef: "docs/operations/reception-room-coordinate-pair-intake-reviewed.json",
      },
    );

    expect(missingInspection.status).toBe("missing_intake_file");
    expect(missingInspection.readyForReviewedPacketBuild).toBe(false);
    expect(missingInspection.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
    expect(readyInspection.status).toBe("ready_for_reviewed_packet_build");
    expect(readyInspection.readyForReviewedPacketBuild).toBe(true);
    expect(readyInspection.coordinatePairIntakeSummary?.coordinatePairCount).toBe(4);
    expect(readyInspection.blockers).toEqual([]);
  });

  it("rejects coordinate-pair intake with inconsistent residual summaries", () => {
    const intake = coordinatePairIntakeFixture();
    const result = RuntimeControlCoordinatePairIntakeV0Schema.safeParse({
      ...intake,
      residualRmseM: intake.residualRmseM + 0.1,
    });

    expect(result.success).toBe(false);
  });

  it("validates the checked-in blocked coordinate-pair packet build report", () => {
    const report = RuntimeControlCoordinatePairPacketBuildReportV0Schema.parse(
      loadReceptionRoomCoordinatePairPacketBuildReport(),
    );

    expect(report.status).toBe("blocked_missing_coordinate_pair_intake");
    expect(report.reviewedPacket).toBeNull();
    expect(report.reviewedPacketSummary).toBeNull();
    expect(report.sourcePacketSummary.reviewedLandmarks).toBe(0);
    expect(report.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
  });

  it("validates the checked-in missing coordinate-pair intake inspection", () => {
    const inspection = RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse(
      loadReceptionRoomCoordinatePairIntakeInspection(),
    );

    expect(inspection.status).toBe("missing_intake_file");
    expect(inspection.readyForReviewedPacketBuild).toBe(false);
    expect(inspection.coordinatePairIntakeSummary).toBeNull();
    expect(inspection.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
  });

  it("validates the checked-in coordinate-pair intake request", () => {
    const request = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(
      loadReceptionRoomCoordinatePairIntakeRequest(),
    );

    expect(request.status).toBe("coordinate_pairs_required");
    expect(request.requiredCoordinatePairCount).toBe(4);
    expect(request.blockers).toEqual([]);
    expect(request.landmarkRequests).toHaveLength(4);
    expect(request.landmarkRequests.every((landmark) => landmark.required)).toBe(true);
  });

  it("builds the current chain-status report from existing runtime-control artifacts", () => {
    const status = buildRuntimeControlEvidenceChainStatus(
      parsedPacket(),
      RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(
        loadReceptionRoomCoordinatePairIntakeRequest(),
      ),
      RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse(
        loadReceptionRoomCoordinatePairIntakeInspection(),
      ),
      RuntimeControlCoordinatePairPacketBuildReportV0Schema.parse(
        loadReceptionRoomCoordinatePairPacketBuildReport(),
      ),
      RuntimeControlCaptureControlPayloadBuildReportV0Schema.parse(
        loadReceptionRoomManualLandmarksBuildReport(),
      ),
      RuntimeTransformReadinessV0Schema.parse(loadReceptionRoomRuntimeTransformReadiness()),
      {
        generatedAt: "2026-06-16T19:05:00.000Z",
        sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
        coordinatePairIntakeRequestRef: "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json",
        coordinatePairIntakeInspectionRef: "docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json",
        coordinatePairPacketBuildReportRef: "docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json",
        captureControlPayloadBuildReportRef: "docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json",
        transformReadinessRef: "docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json",
      },
    );

    expect(status.chainStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.coordinatePairIntakeInspectionStatus).toBe("missing_intake_file");
    expect(status.coordinatePairPacketBuildStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.captureControlPayloadBuildStatus).toBe("blocked_current_packet");
    expect(status.requiredCoordinatePairCount).toBe(4);
    expect(status.reviewedCoordinatePairCount).toBe(0);
    expect(status.captureControlPayloadReady).toBe(false);
    expect(status.consistencyIssues).toEqual([]);
    expect(status.blockers).toContain("No reviewed coordinate-pair intake file was provided.");
    expect(status.nextActions).toEqual([
      "Create the reviewed coordinate-pair intake file from the requested ARF and CVF landmark measurements.",
    ]);
    expect(status.guardrails.reviewedPacketCreated).toBe(false);
    expect(status.guardrails.operationalGeometryCreated).toBe(false);
  });

  it("marks stale or cross-package chain artifacts as inconsistent", () => {
    const request = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(
      loadReceptionRoomCoordinatePairIntakeRequest(),
    );
    const staleRequest = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse({
      ...request,
      runtimePackageId: "00000000-0000-4000-8000-000000000000",
    });

    const status = buildRuntimeControlEvidenceChainStatus(
      parsedPacket(),
      staleRequest,
      RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse(
        loadReceptionRoomCoordinatePairIntakeInspection(),
      ),
      RuntimeControlCoordinatePairPacketBuildReportV0Schema.parse(
        loadReceptionRoomCoordinatePairPacketBuildReport(),
      ),
      RuntimeControlCaptureControlPayloadBuildReportV0Schema.parse(
        loadReceptionRoomManualLandmarksBuildReport(),
      ),
      RuntimeTransformReadinessV0Schema.parse(loadReceptionRoomRuntimeTransformReadiness()),
      {
        generatedAt: "2026-06-16T19:10:00.000Z",
        sourcePacketRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
        coordinatePairIntakeRequestRef: "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json",
        coordinatePairIntakeInspectionRef: "docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json",
        coordinatePairPacketBuildReportRef: "docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json",
        captureControlPayloadBuildReportRef: "docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json",
        transformReadinessRef: "docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json",
      },
    );

    expect(status.chainStatus).toBe("chain_inconsistent");
    expect(status.consistencyIssues).toContain(
      "Coordinate-pair intake request runtime package id does not match the source packet.",
    );
    expect(status.blockers).toEqual(status.consistencyIssues);
  });

  it("validates the checked-in runtime-control evidence-chain status", () => {
    const status = RuntimeControlEvidenceChainStatusV0Schema.parse(
      loadReceptionRoomRuntimeControlEvidenceChainStatus(),
    );

    expect(status.chainStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.sourcePacketSummary.reviewedLandmarks).toBe(0);
    expect(status.captureControlPayloadReady).toBe(false);
    expect(status.guardrails.coordinatePairIntakeCreated).toBe(false);
    expect(status.guardrails.publicExposureChanged).toBe(false);
  });

  it("keeps the current visible-only packet blocked from manual-landmarks payload build", () => {
    const packet = parsedPacket();
    const blockers = runtimeControlPacketManualLandmarkPayloadBlockers(packet);

    expect(blockers).toContain("Packet disposition is not ready for capture-control registration.");
    expect(blockers).toContain("Packet QA status is not human_reviewed or accepted.");
    expect(blockers).toContain("Packet still lists open blockers.");
    expect(blockers).toContain("Fewer than three reviewed landmark coordinate pairs are present.");
    expect(() => buildManualLandmarksCaptureControlSourcePayload(packet, {
      packetRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    })).toThrow("Runtime control packet cannot build a manual_landmarks payload");
  });

  it("builds a capture-control payload only from a reviewed manual-landmark packet", () => {
    const packet = readyPacketFixture();
    const payload = buildManualLandmarksCaptureControlSourcePayload(packet, {
      packetRef: "docs/operations/reception-room-landmark-control-intake-reviewed.json",
      sourceId: "reception-room-reviewed-manual-landmarks-v0",
      reviewerRole: "runtime_reviewer",
    });

    expect(payload.venueSlug).toBe("trades-hall");
    expect(payload.roomSlug).toBe("reception-room");
    expect(payload.runtimePackageId).toBe(packet.runtimePackageId);
    expect(payload.transformArtifactId).toBeNull();
    expect(payload.source.sourceId).toBe("reception-room-reviewed-manual-landmarks-v0");
    expect(payload.source.sourceClass).toBe("manual_landmarks");
    expect(payload.source.poseAuthorityLevel).toBe("manual_landmark_control");
    expect(payload.source.alignmentMethods).toEqual(["landmark_solve"]);
    expect(payload.source.qaStatus).toBe("human_reviewed");
    expect(payload.source.sourceRefs).toContainEqual({
      refType: "landmark_set",
      ref: "docs/operations/reception-room-landmark-control-intake-reviewed.json",
      role: "reviewed_landmark_packet",
    });
    expect(payload.source.residualMetricRefs).toContainEqual({
      refType: "landmark_set",
      ref: "docs/operations/reception-room-landmark-control-intake-reviewed.json",
      role: "residual_metrics",
    });
    expect(payload.source.staleWhen).toEqual([
      "runtime_package_changed",
      "landmark_set_changed",
      "review_expired",
      "manual_contestation",
    ]);
  });

  it("emits machine-readable blocked and built payload reports", () => {
    const blockedReport = buildRuntimeControlCaptureControlPayloadReport(parsedPacket(), {
      generatedAt: "2026-06-16T15:30:00.000Z",
      packetRef: "docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    });
    const builtReport = buildRuntimeControlCaptureControlPayloadReport(readyPacketFixture(), {
      generatedAt: "2026-06-16T15:35:00.000Z",
      packetRef: "docs/operations/reception-room-landmark-control-intake-reviewed.json",
      payloadFile: "docs/operations/reception-room-manual-landmarks-capture-control-source-reviewed.json",
      sourceId: "reception-room-reviewed-manual-landmarks-v0",
    });

    expect(blockedReport.status).toBe("blocked_current_packet");
    expect(blockedReport.landmarkSetSummary.reviewedLandmarks).toBe(0);
    expect(blockedReport.payload).toBeNull();
    expect(blockedReport.payloadFile).toBeNull();
    expect(blockedReport.guardrails.captureControlSourceCreated).toBe(false);
    expect(builtReport.status).toBe("payload_built");
    expect(builtReport.landmarkSetSummary.residualRmseM).toBeGreaterThan(0);
    expect(builtReport.payload?.source.sourceClass).toBe("manual_landmarks");
    expect(builtReport.blockers).toEqual([]);
  });

  it("validates the checked-in blocked manual-landmarks payload build report", () => {
    const report = RuntimeControlCaptureControlPayloadBuildReportV0Schema.parse(
      loadReceptionRoomManualLandmarksBuildReport(),
    );

    expect(report.status).toBe("blocked_current_packet");
    expect(report.landmarkSetSummary).toEqual({
      totalLandmarks: 4,
      nonRejectedLandmarks: 4,
      reviewedLandmarks: 0,
      sourceFrame: "ARF",
      targetFrame: "CVF",
      residualRmseM: null,
      maxResidualM: null,
      allNonRejectedLandmarksReviewed: false,
    });
    expect(report.payload).toBeNull();
    expect(report.payloadFile).toBeNull();
    expect(report.blockers).toContain("Fewer than three reviewed landmark coordinate pairs are present.");
    expect(report.guardrails.liveRegistrationAttempted).toBe(false);
  });

  it("rejects visible-only candidates that carry coordinates or reviewer roles", () => {
    const packet = parsedPacket();
    const firstLandmark = packet.landmarks[0];

    if (firstLandmark === undefined) {
      throw new Error("Expected packet to include landmarks.");
    }

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      landmarks: [
        {
          ...firstLandmark,
          sourcePoint: {
            frame: "ARF",
            coordinate: [0, 0, 0],
            evidenceRefs: firstLandmark.evidenceRefs,
          },
          reviewerRole: "runtime_reviewer",
        },
        ...packet.landmarks.slice(1),
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects landmark coordinate frames that differ from the packet frames", () => {
    const packet = readyPacketFixture();
    const firstLandmark = packet.landmarks[0];

    if (firstLandmark === undefined || firstLandmark.sourcePoint === null) {
      throw new Error("Expected reviewed packet fixture to include source points.");
    }

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      landmarks: [
        {
          ...firstLandmark,
          sourcePoint: {
            ...firstLandmark.sourcePoint,
            frame: "CVF",
          },
        },
        ...packet.landmarks.slice(1),
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects ready packets without at least three reviewed landmarks", () => {
    const packet = readyPacketFixture();

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      landmarks: packet.landmarks.map((landmark, index) =>
        index < 2
          ? {
              ...landmark,
              status: "paired_coordinates_recorded",
              reviewerRole: null,
            }
          : landmark,
      ),
    });

    expect(result.success).toBe(false);
  });

  it("rejects reviewed landmarks without residuals", () => {
    const packet = readyPacketFixture();

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      landmarks: packet.landmarks.map((landmark, index) =>
        index === 0
          ? {
              ...landmark,
              residualM: null,
            }
          : landmark,
      ),
    });

    expect(result.success).toBe(false);
  });

  it("rejects ready packets with unreviewed QA status", () => {
    const packet = readyPacketFixture();

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      intendedCaptureControl: {
        ...packet.intendedCaptureControl,
        qaStatus: "requires_human_review",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects incompatible capture-control source authority combinations", () => {
    const packet = parsedPacket();

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      intendedCaptureControl: {
        ...packet.intendedCaptureControl,
        sourceClass: "artist_blender_alignment_refs",
        poseAuthorityLevel: "manual_landmark_control",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects packets that claim capture-control or signed-transform side effects", () => {
    const packet = parsedPacket();

    const result = RuntimeControlEvidencePacketV0Schema.safeParse({
      ...packet,
      guardrails: {
        ...packet.guardrails,
        captureControlSourceCreated: true,
      },
    });

    expect(result.success).toBe(false);
  });
});

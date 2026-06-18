import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_CONTROL_ALIGNMENT_METHODS,
  CAPTURE_CONTROL_QA_STATUSES,
  CAPTURE_CONTROL_REFERENCE_TYPES,
  CAPTURE_CONTROL_REGISTRATION_REPORT_INSPECTION_STATUSES,
  CAPTURE_CONTROL_SOURCE_CLASSES,
  CAPTURE_CONTROL_STALENESS_TRIGGERS,
  CAPTURE_POSE_AUTHORITY_LEVELS,
  CaptureControlAlignmentMethodSchema,
  CaptureControlQaStatusSchema,
  CaptureControlRegistrationReportInspectionSchema,
  CaptureControlReferenceTypeSchema,
  CaptureControlRegistrationReportSchema,
  CaptureControlSourceClassSchema,
  CaptureControlSourceRegistrationSchema,
  CaptureControlSourceRecordSchema,
  CaptureControlSourceRecordQuerySchema,
  CaptureControlStalenessTriggerSchema,
  CapturePoseAuthorityLevelSchema,
  RegisterCaptureControlSourceRecordInputSchema,
  captureControlAlignmentMethodsForSource,
  captureControlAuthorityLevelsForSource,
  type CaptureControlSourceRecord,
  type CaptureControlRegistrationReportInspection,
  type CaptureControlRegistrationReport,
} from "../capture-control.js";
import {
  TRUTH_CONFIDENCE_TIERS,
  TRUTH_EVIDENCE_SOURCE_STATES,
} from "../truth-mode.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

function validRecord(
  overrides: Partial<CaptureControlSourceRecord> = {},
): CaptureControlSourceRecord {
  return {
    sourceId: "trades-hall-e57-poses-2026-05",
    sourceClass: "raw_structured_e57_poses",
    poseAuthorityLevel: "measured_control",
    alignmentMethods: ["e57_pose_extraction"],
    qaStatus: "machine_checked",
    sourceRefs: [
      {
        refType: "capture_session",
        ref: "trades-hall-e57-session-2026-05",
        role: "source_capture",
      },
    ],
    transformArtifactRefs: [],
    residualMetricRefs: [],
    staleWhen: ["capture_session_superseded"],
    reviewerRole: null,
    notes: null,
    ...overrides,
  };
}

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomVisualAlignmentPayload(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-visual-alignment-capture-control-source-2026-06-16.json",
  );
}

function loadReceptionRoomCaptureControlDryRunReport(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-capture-control-dry-run-report-2026-06-16.json",
  );
}

function loadReceptionRoomCaptureControlInspection(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-capture-control-inspection-2026-06-16.json",
  );
}

function validRegistrationReport(
  overrides: Partial<CaptureControlRegistrationReport> = {},
): CaptureControlRegistrationReport {
  return {
    schemaVersion: "venviewer.capture-control-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "registered",
    apiUrl: "http://localhost:3001",
    payloadFile: "docs/operations/reception-room-visual-alignment-capture-control-source-2026-06-16.json",
    payload: {
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      sourceId: "reception-room-approximate-view-transform-v0",
      sourceClass: "artist_blender_alignment_refs",
      poseAuthorityLevel: "visual_alignment_only",
      qaStatus: "requires_human_review",
      runtimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      transformArtifactId: null,
      staleWhen: ["runtime_package_changed", "scene_authority_map_changed"],
    },
    preflight: {
      payloadRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      latestRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      latestRuntimePackageRuntimeStatus: "internal_ready",
      latestRuntimePackageEvidenceStatus: "machine_checked",
      runtimePackageMatchesLatest: true,
      runtimePackageDriftAllowed: false,
    },
    registration: {
      captureControlSourceId: "10000000-0000-4000-8000-000000000009",
      sourceId: "reception-room-approximate-view-transform-v0",
      qaStatus: "requires_human_review",
      registeredBy: "10000000-0000-4000-8000-000000000007",
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    },
    roomStatus: {
      latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000009",
      latestCaptureControlSourceId: "reception-room-approximate-view-transform-v0",
      latestCaptureControlSourceClass: "artist_blender_alignment_refs",
      latestCaptureControlPoseAuthorityLevel: "visual_alignment_only",
      latestCaptureControlQaStatus: "requires_human_review",
      captureControlStatus: "source_registered",
      captureControlFreshnessStatus: "current_for_runtime_package",
      activeStalenessTriggers: [],
      captureControlSafeCopy: "capture-control source registered; signed transform still required",
      captureControlAuthoritySafeCopy: "visual-only alignment source recorded; not measurement control",
    },
    guardrails: {
      runtimePackageDriftAllowed: false,
      staleReadbackAllowed: false,
      signedTransformCreated: false,
      publicExposureChanged: false,
    },
    ...overrides,
  };
}

function validRegistrationReportInspection(
  overrides: Partial<CaptureControlRegistrationReportInspection> = {},
): CaptureControlRegistrationReportInspection {
  return {
    schemaVersion: "venviewer.capture-control-registration-report-inspection.v0",
    generatedAt: "2026-06-16T12:05:00.000Z",
    inspectedReportFile: "docs/operations/reception-room-capture-control-dry-run-report.json",
    inspectedReportGeneratedAt: "2026-06-16T12:00:00.000Z",
    status: "ready_for_live_registration",
    liveRegistrationReady: true,
    mode: "dry_run",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    sourceId: "reception-room-approximate-view-transform-v0",
    reportRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
    reportLatestRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
    reportRuntimePackageMatchesLatest: true,
    reportRuntimePackageDriftAllowed: false,
    reportStaleReadbackAllowed: false,
    blockers: [],
    messages: [
      "Report schema is valid for reception-room-approximate-view-transform-v0 in trades-hall/reception-room.",
      "Report records no signed transform creation and no public exposure change.",
      "Dry-run report is current for live capture-control registration preflight.",
    ],
    ...overrides,
  };
}

describe("Capture Control Network vocabulary", () => {
  it("pins source classes from CCN-001", () => {
    expect(CAPTURE_CONTROL_SOURCE_CLASSES).toEqual([
      "raw_structured_e57_poses",
      "matterport_api_sdk_poses",
      "colmap_poses",
      "apriltags",
      "charuco_boards",
      "manual_landmarks",
      "control_distances",
      "artist_blender_alignment_refs",
      "known_pose_colmap_model",
    ]);

    for (const sourceClass of CAPTURE_CONTROL_SOURCE_CLASSES) {
      expect(CaptureControlSourceClassSchema.safeParse(sourceClass).success).toBe(true);
    }
  });

  it("pins pose authority levels separately from Truth Mode confidence", () => {
    expect(CAPTURE_POSE_AUTHORITY_LEVELS).toEqual([
      "measured_control",
      "validated_fiducial_control",
      "manual_landmark_control",
      "known_pose_colmap",
      "colmap_reconstructed",
      "visual_alignment_only",
    ]);

    expect(overlap(CAPTURE_POSE_AUTHORITY_LEVELS, TRUTH_CONFIDENCE_TIERS)).toEqual([]);
    expect(CapturePoseAuthorityLevelSchema.safeParse("known_pose_colmap").success).toBe(true);
    expect(CapturePoseAuthorityLevelSchema.safeParse("ops_grade").success).toBe(false);
  });

  it("pins alignment methods that distinguish fiducials, known COLMAP, and visual-only placement", () => {
    expect(CAPTURE_CONTROL_ALIGNMENT_METHODS).toEqual([
      "e57_pose_extraction",
      "matterport_pose_extraction",
      "fiducial_solve",
      "landmark_solve",
      "control_distance_scale_check",
      "icp",
      "known_pose_colmap",
      "unconstrained_colmap",
      "artist_blender_alignment",
      "visual_alignment",
    ]);

    expect(CaptureControlAlignmentMethodSchema.safeParse("fiducial_solve").success).toBe(true);
    expect(CaptureControlAlignmentMethodSchema.safeParse("photoreal").success).toBe(false);
  });

  it("pins QA statuses and staleness triggers as metadata-only vocabulary", () => {
    expect(CAPTURE_CONTROL_QA_STATUSES).toEqual([
      "source_registered",
      "machine_checked",
      "requires_human_review",
      "human_reviewed",
      "accepted",
      "rejected",
      "contested",
      "stale",
      "superseded",
    ]);
    expect(CAPTURE_CONTROL_STALENESS_TRIGGERS).toEqual([
      "capture_session_superseded",
      "venue_geometry_changed",
      "control_network_changed",
      "source_pose_rejected",
      "landmark_set_changed",
      "fiducial_marker_set_changed",
      "control_distance_changed",
      "runtime_package_changed",
      "scene_authority_map_changed",
      "annual_refresh_delta_exceeded",
      "review_expired",
      "manual_contestation",
    ]);

    expect(CaptureControlQaStatusSchema.safeParse("machine_checked").success).toBe(true);
    expect(CaptureControlStalenessTriggerSchema.safeParse("stale").success).toBe(false);
  });

  it("pins reference types without reusing Truth Mode source states", () => {
    expect(CAPTURE_CONTROL_REFERENCE_TYPES).toEqual([
      "capture_session",
      "source_asset",
      "asset_version",
      "runtime_package",
      "transform_artifact",
      "control_network",
      "landmark_set",
      "fiducial_set",
      "control_distance_set",
      "qa_report",
      "review_record",
      "operator_note",
    ]);

    expect(overlap(CAPTURE_CONTROL_REFERENCE_TYPES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(CaptureControlReferenceTypeSchema.safeParse("transform_artifact").success).toBe(true);
    expect(CaptureControlReferenceTypeSchema.safeParse("scan_observed").success).toBe(false);
  });

  it("accepts a measured E57 source record with machine QA", () => {
    const parsed = CaptureControlSourceRecordSchema.parse(validRecord());

    expect(parsed.sourceClass).toBe("raw_structured_e57_poses");
    expect(parsed.poseAuthorityLevel).toBe("measured_control");
  });

  it("accepts known-pose COLMAP as distinct from unconstrained COLMAP", () => {
    const parsed = CaptureControlSourceRecordSchema.parse(
      validRecord({
        sourceId: "trades-hall-known-pose-colmap-2026-05",
        sourceClass: "known_pose_colmap_model",
        poseAuthorityLevel: "known_pose_colmap",
        alignmentMethods: ["known_pose_colmap"],
      }),
    );

    expect(parsed.poseAuthorityLevel).toBe("known_pose_colmap");
    expect(captureControlAuthorityLevelsForSource("known_pose_colmap_model")).toEqual([
      "known_pose_colmap",
    ]);
  });

  it("rejects visual placement that claims measured control", () => {
    const result = CaptureControlSourceRecordSchema.safeParse(
      validRecord({
        sourceId: "trades-hall-visual-placement",
        sourceClass: "artist_blender_alignment_refs",
        poseAuthorityLevel: "measured_control",
        alignmentMethods: ["visual_alignment"],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects unconstrained COLMAP that claims known-pose authority", () => {
    const result = CaptureControlSourceRecordSchema.safeParse(
      validRecord({
        sourceId: "trades-hall-colmap-2026-05",
        sourceClass: "colmap_poses",
        poseAuthorityLevel: "known_pose_colmap",
        alignmentMethods: ["unconstrained_colmap"],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects incompatible alignment methods for a source class", () => {
    const result = CaptureControlSourceRecordSchema.safeParse(
      validRecord({
        sourceClass: "manual_landmarks",
        poseAuthorityLevel: "manual_landmark_control",
        alignmentMethods: ["unconstrained_colmap"],
      }),
    );

    expect(result.success).toBe(false);
    expect(captureControlAlignmentMethodsForSource("manual_landmarks")).toEqual([
      "landmark_solve",
    ]);
  });

  it("requires reviewer roles for review-gated or accepted sources", () => {
    const result = CaptureControlSourceRecordSchema.safeParse(
      validRecord({
        qaStatus: "accepted",
        reviewerRole: null,
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects reviewer-role leakage on machine-only statuses", () => {
    const result = CaptureControlSourceRecordSchema.safeParse(
      validRecord({
        qaStatus: "machine_checked",
        reviewerRole: "venue_ops_reviewer",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts a pre-transform Reception Room manual-landmark source record", () => {
    const source = validRecord({
      sourceId: "reception-room-manual-landmarks-v0",
      sourceClass: "manual_landmarks",
      poseAuthorityLevel: "manual_landmark_control",
      alignmentMethods: ["landmark_solve"],
      qaStatus: "requires_human_review",
      sourceRefs: [
        {
          refType: "landmark_set",
          ref: "docs/operations/reception-room-landmarks-v0.json",
          role: "source_landmarks",
        },
      ],
      staleWhen: ["landmark_set_changed", "runtime_package_changed"],
      reviewerRole: "runtime_reviewer",
      notes: "Candidate landmark set; not yet a signed transform.",
    });

    const parsed = RegisterCaptureControlSourceRecordInputSchema.parse({
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      runtimePackageId: null,
      transformArtifactId: null,
      source,
      reviewNote: "Manual landmarks are registered as evidence intake only.",
    });

    expect(parsed.source.poseAuthorityLevel).toBe("manual_landmark_control");
  });

  it("validates the Reception Room visual-alignment-only registration payload", () => {
    const parsed = RegisterCaptureControlSourceRecordInputSchema.parse(
      loadReceptionRoomVisualAlignmentPayload(),
    );

    expect(parsed.venueSlug).toBe("trades-hall");
    expect(parsed.roomSlug).toBe("reception-room");
    expect(parsed.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(parsed.transformArtifactId).toBeNull();
    expect(parsed.source.sourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(parsed.source.sourceClass).toBe("artist_blender_alignment_refs");
    expect(parsed.source.poseAuthorityLevel).toBe("visual_alignment_only");
    expect(parsed.source.alignmentMethods).toEqual(["visual_alignment"]);
    expect(parsed.source.qaStatus).toBe("requires_human_review");
    expect(parsed.source.transformArtifactRefs).toEqual([]);
    expect(parsed.source.notes).toContain("not a signed room-local transform");
  });

  it("validates the Reception Room capture-control dry-run report and inspection artifacts", () => {
    const report = CaptureControlRegistrationReportSchema.parse(
      loadReceptionRoomCaptureControlDryRunReport(),
    );
    const inspection = CaptureControlRegistrationReportInspectionSchema.parse(
      loadReceptionRoomCaptureControlInspection(),
    );

    expect(report.mode).toBe("dry_run");
    expect(report.payloadFile).toContain(
      "reception-room-visual-alignment-capture-control-source-2026-06-16.json",
    );
    expect(report.payload.sourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(report.payload.poseAuthorityLevel).toBe("visual_alignment_only");
    expect(report.preflight.runtimePackageMatchesLatest).toBe(true);
    expect(report.preflight.runtimePackageDriftAllowed).toBe(false);
    expect(report.registration).toBeNull();
    expect(report.roomStatus).toBeNull();
    expect(report.guardrails.signedTransformCreated).toBe(false);
    expect(report.guardrails.publicExposureChanged).toBe(false);

    expect(inspection.inspectedReportFile).toContain(
      "reception-room-capture-control-dry-run-report-2026-06-16.json",
    );
    expect(inspection.status).toBe("ready_for_live_registration");
    expect(inspection.liveRegistrationReady).toBe(true);
    expect(inspection.mode).toBe("dry_run");
    expect(inspection.reportRuntimePackageId).toBe(report.payload.runtimePackageId);
    expect(inspection.reportLatestRuntimePackageId).toBe(
      report.preflight.latestRuntimePackageId,
    );
    expect(inspection.reportRuntimePackageDriftAllowed).toBe(false);
    expect(inspection.reportStaleReadbackAllowed).toBe(false);
    expect(inspection.blockers).toEqual([]);
  });

  it("requires transform-linked control sources to cite the transform artifact", () => {
    const result = RegisterCaptureControlSourceRecordInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      runtimePackageId: "10000000-0000-4000-8000-000000000004",
      transformArtifactId: "reception-room-landmark-solve-v0",
      source: validRecord({
        sourceId: "reception-room-manual-landmarks-v0",
        sourceClass: "manual_landmarks",
        poseAuthorityLevel: "manual_landmark_control",
        alignmentMethods: ["landmark_solve"],
        sourceRefs: [
          {
            refType: "landmark_set",
            ref: "docs/operations/reception-room-landmarks-v0.json",
            role: "source_landmarks",
          },
        ],
      }),
    });

    expect(result.success).toBe(false);
  });

  it("parses a persisted transform-linked capture control source", () => {
    const source = validRecord({
      sourceId: "reception-room-control-network-v0",
      sourceClass: "manual_landmarks",
      poseAuthorityLevel: "manual_landmark_control",
      alignmentMethods: ["landmark_solve"],
      qaStatus: "human_reviewed",
      sourceRefs: [
        {
          refType: "landmark_set",
          ref: "docs/operations/reception-room-landmarks-v0.json",
          role: "source_landmarks",
        },
      ],
      transformArtifactRefs: [
        {
          refType: "transform_artifact",
          ref: "reception-room-landmark-solve-v0",
          role: "signed_transform",
        },
      ],
      reviewerRole: "runtime_reviewer",
    });

    const parsed = CaptureControlSourceRegistrationSchema.parse({
      id: "row-1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      runtimePackageId: "10000000-0000-4000-8000-000000000004",
      transformArtifactId: "reception-room-landmark-solve-v0",
      sourceId: source.sourceId,
      sourceClass: source.sourceClass,
      poseAuthorityLevel: source.poseAuthorityLevel,
      qaStatus: source.qaStatus,
      source,
      reviewNote: null,
      registeredBy: "10000000-0000-4000-8000-000000000005",
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
    });

    expect(parsed.transformArtifactId).toBe("reception-room-landmark-solve-v0");
  });

  it("validates capture control source queries before listing evidence", () => {
    expect(CaptureControlSourceRecordQuerySchema.parse({
      venue: "trades-hall",
      room: "reception-room",
    }).room).toBe("reception-room");

    expect(CaptureControlSourceRecordQuerySchema.safeParse({
      venue: "trades-hall",
      room: "unsupported-room",
    }).success).toBe(false);

    expect(CaptureControlSourceRecordQuerySchema.safeParse({
      venue: "trades-hall",
      transformArtifactId: "reception-room-landmark-solve-v0",
    }).success).toBe(false);
  });

  it("parses machine-readable capture-control registration reports", () => {
    const parsed = CaptureControlRegistrationReportSchema.parse(validRegistrationReport());

    expect(parsed.schemaVersion).toBe("venviewer.capture-control-registration-report.v0");
    expect(parsed.preflight.runtimePackageMatchesLatest).toBe(true);
    expect(parsed.guardrails.signedTransformCreated).toBe(false);
    expect(parsed.guardrails.publicExposureChanged).toBe(false);
  });

  it("keeps dry-run registration reports non-mutating", () => {
    const report = validRegistrationReport({
      mode: "dry_run",
      registration: null,
      roomStatus: null,
    });

    expect(CaptureControlRegistrationReportSchema.parse(report).mode).toBe("dry_run");
    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...report,
      registration: validRegistrationReport().registration,
    }).success).toBe(false);
  });

  it("rejects drift and exposure changes in capture-control reports", () => {
    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validRegistrationReport(),
      preflight: {
        ...validRegistrationReport().preflight,
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageMatchesLatest: false,
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validRegistrationReport(),
      guardrails: {
        ...validRegistrationReport().guardrails,
        publicExposureChanged: true,
      },
    }).success).toBe(false);
  });

  it("rejects internally inconsistent capture-control registration reports", () => {
    const validReport = validRegistrationReport();
    const registration = validReport.registration;
    const roomStatus = validReport.roomStatus;

    if (registration === null || roomStatus === null) {
      throw new Error("Expected valid registration report helper to include registered readback.");
    }

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      preflight: {
        ...validReport.preflight,
        payloadRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      registration: {
        ...registration,
        sourceId: "reception-room-other-source-v0",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      registration: {
        ...registration,
        qaStatus: "accepted",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000011",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        latestCaptureControlSourceId: "reception-room-other-source-v0",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        latestCaptureControlSourceClass: "manual_landmarks",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        latestCaptureControlPoseAuthorityLevel: "manual_landmark_control",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        latestCaptureControlQaStatus: "accepted",
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.safeParse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        captureControlFreshnessStatus: "stale_for_runtime_package",
        activeStalenessTriggers: ["runtime_package_changed"],
      },
      guardrails: {
        ...validReport.guardrails,
        staleReadbackAllowed: false,
      },
    }).success).toBe(false);

    expect(CaptureControlRegistrationReportSchema.parse({
      ...validReport,
      roomStatus: {
        ...roomStatus,
        captureControlFreshnessStatus: "stale_for_runtime_package",
        activeStalenessTriggers: ["runtime_package_changed"],
      },
      guardrails: {
        ...validReport.guardrails,
        staleReadbackAllowed: true,
      },
    }).guardrails.staleReadbackAllowed).toBe(true);
  });

  it("parses machine-readable capture-control report inspection artifacts", () => {
    const parsed = CaptureControlRegistrationReportInspectionSchema.parse(
      validRegistrationReportInspection(),
    );

    expect(CAPTURE_CONTROL_REGISTRATION_REPORT_INSPECTION_STATUSES).toEqual([
      "ready_for_live_registration",
      "not_ready_for_live_registration",
      "registered_report_verified",
      "invalid_report",
    ]);
    expect(parsed.schemaVersion).toBe("venviewer.capture-control-registration-report-inspection.v0");
    expect(parsed.liveRegistrationReady).toBe(true);
    expect(parsed.mode).toBe("dry_run");
    expect(parsed.blockers).toEqual([]);
  });

  it("rejects inconsistent ready capture-control report inspection artifacts", () => {
    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        mode: "registered",
      }),
    ).success).toBe(false);

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        blockers: ["operator override was enabled"],
      }),
    ).success).toBe(false);

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        reportLatestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
      }),
    ).success).toBe(false);

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        reportRuntimePackageDriftAllowed: true,
      }),
    ).success).toBe(false);

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        reportStaleReadbackAllowed: true,
      }),
    ).success).toBe(false);
  });

  it("pins non-ready capture-control report inspection artifacts to explicit blockers", () => {
    expect(CaptureControlRegistrationReportInspectionSchema.parse(
      validRegistrationReportInspection({
        status: "not_ready_for_live_registration",
        liveRegistrationReady: false,
        reportLatestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        reportRuntimePackageMatchesLatest: false,
        reportRuntimePackageDriftAllowed: true,
        blockers: [
          "Payload runtime package is not the latest loadable runtime package.",
          "Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
        ],
      }),
    ).status).toBe("not_ready_for_live_registration");

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        status: "not_ready_for_live_registration",
        liveRegistrationReady: false,
        blockers: [],
      }),
    ).success).toBe(false);
  });

  it("keeps registered and invalid report inspections out of live-registration readiness", () => {
    expect(CaptureControlRegistrationReportInspectionSchema.parse(
      validRegistrationReportInspection({
        status: "registered_report_verified",
        liveRegistrationReady: false,
        mode: "registered",
        blockers: [
          "Report already records a live registration; use it as audit evidence, not authorization for another POST.",
        ],
      }),
    ).liveRegistrationReady).toBe(false);

    expect(CaptureControlRegistrationReportInspectionSchema.parse(
      validRegistrationReportInspection({
        status: "invalid_report",
        liveRegistrationReady: false,
        inspectedReportGeneratedAt: null,
        mode: null,
        venueSlug: null,
        roomSlug: null,
        sourceId: null,
        reportRuntimePackageId: null,
        reportLatestRuntimePackageId: null,
        reportRuntimePackageMatchesLatest: null,
        reportRuntimePackageDriftAllowed: null,
        reportStaleReadbackAllowed: null,
        blockers: ["generatedAt: Required"],
        messages: ["Report failed CaptureControlRegistrationReportSchema validation."],
      }),
    ).status).toBe("invalid_report");

    expect(CaptureControlRegistrationReportInspectionSchema.safeParse(
      validRegistrationReportInspection({
        status: "invalid_report",
        liveRegistrationReady: true,
        blockers: ["generatedAt: Required"],
      }),
    ).success).toBe(false);
  });
});

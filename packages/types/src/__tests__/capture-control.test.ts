import { describe, expect, it } from "vitest";
import {
  CAPTURE_CONTROL_ALIGNMENT_METHODS,
  CAPTURE_CONTROL_QA_STATUSES,
  CAPTURE_CONTROL_REFERENCE_TYPES,
  CAPTURE_CONTROL_SOURCE_CLASSES,
  CAPTURE_CONTROL_STALENESS_TRIGGERS,
  CAPTURE_POSE_AUTHORITY_LEVELS,
  CaptureControlAlignmentMethodSchema,
  CaptureControlQaStatusSchema,
  CaptureControlReferenceTypeSchema,
  CaptureControlSourceClassSchema,
  CaptureControlSourceRecordSchema,
  CaptureControlStalenessTriggerSchema,
  CapturePoseAuthorityLevelSchema,
  captureControlAlignmentMethodsForSource,
  captureControlAuthorityLevelsForSource,
  type CaptureControlSourceRecord,
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
});

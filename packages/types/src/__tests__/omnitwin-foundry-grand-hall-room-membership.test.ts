import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES,
  GRAND_HALL_VISUAL_CORE_SCAN_INDICES,
  GRAND_HALL_VISUAL_EXCLUDED_SCAN_INDICES,
  GRAND_HALL_VISUAL_PORTAL_SCAN_INDICES,
  FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema,
  FoundryGrandHallPanoramaCrosswalkEvidenceV1Schema,
  FoundryGrandHallRoomMembershipV1MaterialSchema,
  FoundryGrandHallRoomMembershipV1Schema,
  computeFoundryGrandHallPanoramaCrosswalkEvidenceV1Sha256,
  computeFoundryGrandHallRoomMembershipV1Sha256,
  type FoundryGrandHallRoomMembershipV1,
} from "../omnitwin-foundry-grand-hall-room-membership.js";
import {
  FoundryIngestManifestV0Schema,
  computeFoundryIngestManifestSha256,
} from "../omnitwin-foundry.js";

const MEMBERSHIP_ARTIFACT =
  "../../../../docs/operations/grand-hall-room-membership-v1.json";
const HISTORICAL_PILOT_ARTIFACT =
  "../../../../docs/operations/grand-hall-pilot-ingest-manifest-2026-07-19.json";

function artifactBytes(relativePath: string): Buffer {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)));
}

function artifactJson(relativePath: string): unknown {
  return JSON.parse(artifactBytes(relativePath).toString("utf8")) as unknown;
}

function parsedMembership(): FoundryGrandHallRoomMembershipV1 {
  return FoundryGrandHallRoomMembershipV1Schema.parse(
    artifactJson(MEMBERSHIP_ARTIFACT),
  );
}

describe("Grand Hall visual room-scope successor evidence", () => {
  it("validates the authority-free artifact and its canonical self-digest", () => {
    const membership = parsedMembership();
    const { membershipSha256, ...materialInput } = membership;
    const material = FoundryGrandHallRoomMembershipV1MaterialSchema.parse(materialInput);

    expect(membershipSha256).toBe(
      "sha256:e2822de20e28bbeeb7ca81c8aad96214852e39bdc206e3d378d37d80c2904c68",
    );
    expect(computeFoundryGrandHallRoomMembershipV1Sha256(material)).toBe(
      membershipSha256,
    );
    expect(membership.authority).toBe("none");
    expect(membership.reviewState).toBe("agent_visual_audited_human_pending");
    expect(membership.humanReview).toEqual({
      state: "pending",
      reviewer: null,
      reviewedAt: null,
      acceptedMembershipSha256: null,
    });
  });

  it("pins the exact visual core, portal, and adjacent inference sets", () => {
    const records = parsedMembership().scanRecords;
    const indicesFor = (
      inference: (typeof records)[number]["visualLocationInference"],
    ): number[] =>
      records
        .filter((record) => record.visualLocationInference === inference)
        .map((record) => record.scanIndex);

    expect(indicesFor("visually_consistent_grand_hall_interior")).toEqual(
      GRAND_HALL_VISUAL_CORE_SCAN_INDICES,
    );
    expect(indicesFor("visually_mixed_portal_threshold")).toEqual(
      GRAND_HALL_VISUAL_PORTAL_SCAN_INDICES,
    );
    expect(indicesFor("visually_consistent_adjacent_space")).toEqual(
      GRAND_HALL_VISUAL_EXCLUDED_SCAN_INDICES,
    );
    expect(records.map((record) => record.scanIndex)).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
  });

  it("never upgrades visual inference into geometric camera-centre membership", () => {
    const membership = parsedMembership();
    const byScan = new Map(
      membership.scanRecords.map((record) => [record.scanIndex, record]),
    );

    expect(membership.scopeRules).toMatchObject({
      visualLocationInferenceOnly: true,
      geometricCameraCentreMembershipEstablished: false,
      roomBoundaryArtifactState: "required_not_authored",
      trainingAuthorized: false,
      runtimeAuthorized: false,
      structuralAuthorityGranted: false,
    });
    expect(byScan.get(18)).toMatchObject({
      candidatePanoramaSweepNumber: 19,
      visualLocationInference: "visually_consistent_adjacent_space",
      inferenceConfidence: "provisional_human_review_required",
      pixelMaskState: "not_applicable_whole_frame_excluded",
      wholeFrameExclusionReason: "outside_room_camera_view",
    });
    expect(byScan.get(48)).toMatchObject({
      candidatePanoramaSweepNumber: 49,
      visualLocationInference: "visually_mixed_portal_threshold",
      pixelMaskState: "required_not_authored",
      wholeFrameExclusionReason: null,
    });
    expect(byScan.get(49)).toMatchObject({
      candidatePanoramaSweepNumber: 50,
      visualLocationInference: "visually_consistent_adjacent_space",
      pixelMaskState: "not_applicable_whole_frame_excluded",
    });
  });

  it("keeps 44 panorama pairings provisional and binds six diagnostic reviews", () => {
    const membership = parsedMembership();
    const records = membership.scanRecords;
    const reviewed = records
      .filter((record) => record.panoramaCorrespondenceState === "diagnostic_pair_agent_reviewed")
      .map((record) => record.scanIndex);
    const unverified = records.filter(
      (record) => record.panoramaCorrespondenceState === "candidate_sequence_unverified",
    );

    expect(reviewed).toEqual(
      GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES,
    );
    expect(unverified).toHaveLength(44);
    expect(membership.sourceBindings.panoramaAuditSet).toMatchObject({
      auditedFileCount: 50,
      provisionalMaskAuthoringCandidateCount: 48,
      wholeFrameExcludedCount: 2,
      candidateSequenceHypothesis:
        "candidate_sweep_number_equals_e57_scan_index_plus_one",
      lineageState: "historical_correspondence_not_byte_lineage",
    });
  });

  it("validates reproducible crosswalk metrics without claiming E57 byte lineage", () => {
    const crosswalk = parsedMembership().sourceBindings.panoramaAuditSet.crosswalkEvidence;
    const { evidenceSha256, ...materialInput } = crosswalk;
    const material = FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema.parse(
      materialInput,
    );

    expect(evidenceSha256).toBe(
      "sha256:aecf6168948d66dbde4d6e302c682a72cef323106fb3eaf52e20587c9844ca7f",
    );
    expect(computeFoundryGrandHallPanoramaCrosswalkEvidenceV1Sha256(material)).toBe(
      evidenceSha256,
    );
    expect(crosswalk.pairResults.map((result) => result.scanIndex)).toEqual(
      GRAND_HALL_REVIEWED_PANORAMA_CROSSWALK_SCAN_INDICES,
    );
    expect(crosswalk.pairResults[0]).toMatchObject({
      scanIndex: 0,
      candidateMatchRank: 2,
      runnerUpScanIndex: 17,
      candidateMinusRunnerUpScore: -0.023486435796,
      humanConfirmationRecorded: false,
      e57ByteLineageEstablished: false,
    });
    expect(crosswalk.pairResults[5]).toMatchObject({
      scanIndex: 49,
      candidateMatchRank: 1,
      runnerUpScanIndex: 18,
      candidateMinusRunnerUpScore: 0.017743456296,
    });
  });

  it("pins all supplied source anchors and fails XGRIDS closed locally", () => {
    const sources = parsedMembership().sourceBindings;

    expect(sources.e57).toMatchObject({
      sha256: "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
      byteLength: 20_518_437_888,
      scope: "whole_building_not_room_isolated",
    });
    expect(sources.matterpak).toMatchObject({
      objSha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      mtlSha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
      lineageRelationship: "common_vendor_lineage_not_independent_control",
    });
    expect(sources.xgridsRawProject).toMatchObject({
      captureLogRef: "state/capture_log.json",
      observedProjectFileCount: 12,
      observedProjectByteLength: 41_296_996_984,
      projectReceiptState: "required_not_generated",
      roomMembershipState: "unclassified_pending_lcc_point_cloud_preview",
      trainingEligible: false,
      runtimeEligible: false,
      exactRuntimeSubstitutionPermitted: false,
      creatorDataState: "not_exported",
    });
    expect(sources.xgridsRawProject.xbin).toMatchObject({
      sha256: "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
      byteLength: 41_095_196_672,
    });
    expect(sources.xgridsRawProject.poses).toEqual({
      relativePath: "project_data/poses.csv",
      sha256: "sha256:b86bc45d15b8b5a84d61160afe3e16e7659e195557a2b8c6567039bb74d83127",
      byteLength: 3_659_287,
      rowCount: 42_850,
      durationSeconds: 4_285.622582,
    });
  });

  it("explicitly forbids the procedural nadir fill behind the false dark floor", () => {
    const scope = parsedMembership().scopeRules;

    expect(scope).toMatchObject({
      generatedFillPermitted: false,
      proceduralPixelReplacementPermitted: false,
      synthesizedPixelReplacementPermitted: false,
      panoStageNadirCrownPermitted: false,
      maskedOrUnknownPixelDisposition: "remain_transparent_or_unknown_never_filled",
      neighbouringRoomPixelsPermitted: false,
      facadeAssetsPermitted: false,
    });
    expect(scope.panoramaMaskArtifactRequirement).toEqual({
      state: "required_not_authored",
      appliesTo: "non_excluded_candidate_panoramas_only",
      coordinateSpace: "original_8192x4096_equirectangular_pixel_grid",
      maskPolarity: "stored_value_255_means_excluded",
      horizontalSeamRule: "wraps_between_x_8191_and_x_0",
      verticalRule: "clamped_y_0_through_y_4095",
      encoding: "png_grayscale8_binary_v1",
      mediaType: "image/png",
      widthPx: 8192,
      heightPx: 4096,
      sampleLayout: "single_channel_grayscale_8bit",
      permittedStoredValues: [0, 255],
      includedValue: 0,
      excludedValue: 255,
      alphaChannelPermitted: false,
      colorProfilePermitted: false,
      embeddedOrientationPermitted: false,
      pixelOrigin: "top_left_x_increases_right_y_increases_down",
      resamplingPermitted: false,
      unionSemantics: "pixel_excluded_if_any_reason_mask_stored_value_is_255",
      allowedReasonCodes: [
        "outside_room_through_portal",
        "nadir_capture_rig",
        "nadir_blur_or_stitch_cap",
        "zenith_blur_or_stitch_cap",
        "operator_or_moving_person",
        "stitching_seam",
      ],
    });
  });

  it("preserves T-507 without reinterpreting it as room membership", () => {
    const bytes = artifactBytes(HISTORICAL_PILOT_ARTIFACT);
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const historical = FoundryIngestManifestV0Schema.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );

    expect(bytes.byteLength).toBe(638_899);
    expect(fileSha256).toBe(
      "af47826e91d9cbbac0730019d3c2349ec5534fe4daafe9ac1975ebea4492a4c4",
    );
    expect(historical.assets).toHaveLength(310);
    expect(computeFoundryIngestManifestSha256(historical)).toBe(
      "sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89",
    );
    expect(parsedMembership().sourceBindings.historicalPilotManifest).toMatchObject({
      preservation: "immutable_do_not_rewrite",
      relationship: "successor_evidence_does_not_modify_t507",
      historicalCandidateScope: "authority_none_diagnostic_not_room_membership",
    });
  });

  it("rejects missing, duplicate, or reordered scan evidence", () => {
    const membership = parsedMembership();
    const first = membership.scanRecords[0];
    const second = membership.scanRecords[1];
    const penultimate = membership.scanRecords[48];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(penultimate).toBeDefined();
    if (first === undefined || second === undefined || penultimate === undefined) return;

    const reordered = {
      ...membership,
      scanRecords: [second, first, ...membership.scanRecords.slice(2)],
    };
    const missing = {
      ...membership,
      scanRecords: membership.scanRecords.slice(0, 49),
    };
    const duplicate = {
      ...membership,
      scanRecords: [...membership.scanRecords.slice(0, 49), penultimate],
    };

    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(reordered).success).toBe(false);
    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(missing).success).toBe(false);
    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects inference, pixel, source, or authority escalation", () => {
    const membership = parsedMembership();
    const promotedAdjacent = {
      ...membership,
      scanRecords: membership.scanRecords.map((record) =>
        record.scanIndex === 18
          ? {
              ...record,
              visualLocationInference: "visually_consistent_grand_hall_interior",
              allowedUse: "mask_authoring_candidate_only",
              pixelMaskState: "required_not_authored",
              wholeFrameExclusionReason: null,
            }
          : record,
      ),
    };
    const unmaskedPortal = {
      ...membership,
      scanRecords: membership.scanRecords.map((record) =>
        record.scanIndex === 48
          ? { ...record, fullFrameTrainingEligible: true }
          : record,
      ),
    };
    const xgridsSubstitution = {
      ...membership,
      sourceBindings: {
        ...membership.sourceBindings,
        xgridsRawProject: {
          ...membership.sourceBindings.xgridsRawProject,
          runtimeEligible: true,
          exactRuntimeSubstitutionPermitted: true,
        },
      },
    };
    const escalated = {
      ...membership,
      authority: "measured",
      scopeRules: {
        ...membership.scopeRules,
        trainingAuthorized: true,
        proceduralPixelReplacementPermitted: true,
      },
    };

    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(promotedAdjacent).success).toBe(false);
    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(unmaskedPortal).success).toBe(false);
    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(xgridsSubstitution).success).toBe(false);
    expect(FoundryGrandHallRoomMembershipV1Schema.safeParse(escalated).success).toBe(false);
  });

  it("independently rejects stale nested and enclosing evidence digests", () => {
    const membership = parsedMembership();
    const crosswalk = membership.sourceBindings.panoramaAuditSet.crosswalkEvidence;
    const { evidenceSha256: originalEvidenceSha256, ...crosswalkMaterial } = crosswalk;
    const changedCrosswalkMaterial = {
      ...crosswalkMaterial,
      createdBy: "independent-crosswalk-reviewer",
    };

    expect(
      FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema.safeParse(
        changedCrosswalkMaterial,
      ).success,
    ).toBe(true);

    const staleNestedDigest = FoundryGrandHallPanoramaCrosswalkEvidenceV1Schema.safeParse({
      ...changedCrosswalkMaterial,
      evidenceSha256: originalEvidenceSha256,
    });
    expect(staleNestedDigest.success).toBe(false);
    if (!staleNestedDigest.success) {
      expect(staleNestedDigest.error.issues.some(
        (issue) => issue.path.join(".") === "evidenceSha256",
      )).toBe(true);
    }

    const rehashedCrosswalk = {
      ...changedCrosswalkMaterial,
      evidenceSha256: computeFoundryGrandHallPanoramaCrosswalkEvidenceV1Sha256(
        FoundryGrandHallPanoramaCrosswalkEvidenceV1MaterialSchema.parse(
          changedCrosswalkMaterial,
        ),
      ),
    };
    expect(
      FoundryGrandHallPanoramaCrosswalkEvidenceV1Schema.safeParse(rehashedCrosswalk)
        .success,
    ).toBe(true);

    const staleOuterDigest = FoundryGrandHallRoomMembershipV1Schema.safeParse({
      ...membership,
      sourceBindings: {
        ...membership.sourceBindings,
        panoramaAuditSet: {
          ...membership.sourceBindings.panoramaAuditSet,
          crosswalkEvidence: rehashedCrosswalk,
        },
      },
    });
    expect(staleOuterDigest.success).toBe(false);
    if (!staleOuterDigest.success) {
      expect(staleOuterDigest.error.issues.some(
        (issue) => issue.path.join(".") === "membershipSha256",
      )).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { GeometryApproximationKindSchema } from "../geometry-approximation.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import { RuntimeLayerKindSchema } from "../runtime-venue-manifest.js";
import {
  EVENT_OBJECT_FLOOR_LOADING_RELEVANCE,
  EVENT_OBJECT_FOOTPRINT_KINDS,
  EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE,
  EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS,
  EVENT_OBJECT_OPERATIONAL_SCHEMA_VERSION,
  EVENT_OBJECT_RIGGING_REQUIREMENTS,
  EVENT_OBJECT_SEMANTIC_METADATA_FIELDS,
  EVENT_OBJECT_STAGE_PLATFORM_STATUSES,
  EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES,
  EventObjectFloorLoadingRelevanceSchema,
  EventObjectFootprintKindSchema,
  EventObjectHeatOutputRelevanceSchema,
  EventObjectHumanReviewTriggerSchema,
  EventObjectOperationalSemanticsSchema,
  EventObjectRiggingRequirementSchema,
  EventObjectSemanticMetadataFieldSchema,
  EventObjectStagePlatformStatusSchema,
  EventObjectTemporaryStructureStatusSchema,
  type EventObjectOperationalSemantics,
} from "../event-object-semantics.js";

const BASIC_OBJECT: EventObjectOperationalSemantics = {
  schemaVersion: EVENT_OBJECT_OPERATIONAL_SCHEMA_VERSION,
  objectRef: "object_round_table_001",
  footprintKind: "catalogue_footprint",
  footprintApproximationKind: "exact_footprint",
  heightM: 0.75,
  topElevationM: 0.75,
  loadEstimateKg: 45,
  heatOutputW: null,
  temporaryStructureStatus: "not_temporary",
  stagePlatformStatus: "not_stage_or_platform",
  riggingRequirement: "none",
  floorLoadingRelevance: "lightweight_object",
  heatOutputRelevance: "not_relevant",
  humanReviewTriggers: [],
};

describe("Event Object Semantics vocabulary", () => {
  it("pins semantic metadata fields from STACK-001", () => {
    expect(EVENT_OBJECT_SEMANTIC_METADATA_FIELDS).toEqual([
      "footprintKind",
      "footprintApproximationKind",
      "heightM",
      "topElevationM",
      "loadEstimateKg",
      "heatOutputW",
      "temporaryStructureStatus",
      "stagePlatformStatus",
      "riggingRequirement",
      "floorLoadingRelevance",
      "heatOutputRelevance",
      "humanReviewTriggers",
    ]);

    for (const field of EVENT_OBJECT_SEMANTIC_METADATA_FIELDS) {
      expect(EventObjectSemanticMetadataFieldSchema.safeParse(field).success).toBe(true);
    }
  });

  it("pins footprint kinds and operational statuses", () => {
    expect(EVENT_OBJECT_FOOTPRINT_KINDS).toEqual([
      "catalogue_footprint",
      "measured_polygon",
      "venue_supplied_dimensions",
      "manual_polygon",
      "generated_clearance_hull",
      "visual_mesh_projection",
      "unsupported_footprint",
    ]);

    expect(EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES).toEqual([
      "not_temporary",
      "temporary_non_structural",
      "temporary_structure",
      "unknown_requires_review",
    ]);

    expect(EVENT_OBJECT_STAGE_PLATFORM_STATUSES).toEqual([
      "not_stage_or_platform",
      "low_platform",
      "raised_stage",
      "performance_platform",
      "unknown_requires_review",
    ]);
  });

  it("pins rigging, floor-loading, heat-output, and review trigger vocabularies", () => {
    expect(EVENT_OBJECT_RIGGING_REQUIREMENTS).toEqual([
      "none",
      "floor_supported",
      "suspended_overhead",
      "truss_or_frame",
      "unknown_requires_review",
    ]);

    expect(EVENT_OBJECT_FLOOR_LOADING_RELEVANCE).toEqual([
      "not_relevant",
      "lightweight_object",
      "load_estimate_required",
      "point_load_review_required",
      "unknown_requires_review",
    ]);

    expect(EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE).toEqual([
      "not_relevant",
      "low_heat",
      "heat_output_declared",
      "heat_review_required",
      "unknown_requires_review",
    ]);

    expect(EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS).toEqual([
      "unsupported_operational_footprint",
      "unverified_height_or_top_elevation",
      "temporary_structure_review",
      "stage_platform_review",
      "rigging_review",
      "floor_loading_review",
      "heat_output_review",
      "heritage_contact_review",
      "venue_policy_review",
    ]);
  });

  it("parses basic operational metadata without creating review claims", () => {
    expect(EventObjectOperationalSemanticsSchema.parse(BASIC_OBJECT)).toEqual(BASIC_OBJECT);
  });

  it("requires explicit review triggers for unsupported or risk-relevant metadata", () => {
    const reviewHeavyObject: EventObjectOperationalSemantics = {
      ...BASIC_OBJECT,
      objectRef: "object_stage_rig_001",
      footprintKind: "unsupported_footprint",
      footprintApproximationKind: "unsupported_geometry",
      temporaryStructureStatus: "temporary_structure",
      stagePlatformStatus: "raised_stage",
      riggingRequirement: "truss_or_frame",
      floorLoadingRelevance: "point_load_review_required",
      heatOutputRelevance: "heat_output_declared",
      humanReviewTriggers: [
        "unsupported_operational_footprint",
        "temporary_structure_review",
        "stage_platform_review",
        "rigging_review",
        "floor_loading_review",
        "heat_output_review",
      ],
    };

    expect(EventObjectOperationalSemanticsSchema.safeParse(reviewHeavyObject).success).toBe(true);

    expect(EventObjectOperationalSemanticsSchema.safeParse({
      ...reviewHeavyObject,
      humanReviewTriggers: reviewHeavyObject.humanReviewTriggers.filter(
        (trigger) => trigger !== "floor_loading_review",
      ),
    }).success).toBe(false);

    expect(EventObjectOperationalSemanticsSchema.safeParse({
      ...reviewHeavyObject,
      humanReviewTriggers: reviewHeavyObject.humanReviewTriggers.filter(
        (trigger) => trigger !== "heat_output_review",
      ),
    }).success).toBe(false);
  });

  it("rejects unknown fields and visual-layer substitutions", () => {
    expect(EventObjectOperationalSemanticsSchema.safeParse({
      ...BASIC_OBJECT,
      visualMeshUrl: "/assets/demo.glb",
    }).success).toBe(false);

    expect(EventObjectFootprintKindSchema.safeParse("mesh").success).toBe(false);
    expect(EventObjectFootprintKindSchema.safeParse("gaussian_splat").success).toBe(false);
    expect(RuntimeLayerKindSchema.safeParse("catalogue_footprint").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("raised_stage").success).toBe(false);
    expect(GeometryApproximationKindSchema.safeParse(BASIC_OBJECT.footprintApproximationKind).success).toBe(
      true,
    );
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      EVENT_OBJECT_SEMANTIC_METADATA_FIELDS,
      EVENT_OBJECT_FOOTPRINT_KINDS,
      EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES,
      EVENT_OBJECT_STAGE_PLATFORM_STATUSES,
      EVENT_OBJECT_RIGGING_REQUIREMENTS,
      EVENT_OBJECT_FLOOR_LOADING_RELEVANCE,
      EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE,
      EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }

    for (const value of EVENT_OBJECT_FOOTPRINT_KINDS) {
      expect(EventObjectFootprintKindSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES) {
      expect(EventObjectTemporaryStructureStatusSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_STAGE_PLATFORM_STATUSES) {
      expect(EventObjectStagePlatformStatusSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_RIGGING_REQUIREMENTS) {
      expect(EventObjectRiggingRequirementSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_FLOOR_LOADING_RELEVANCE) {
      expect(EventObjectFloorLoadingRelevanceSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE) {
      expect(EventObjectHeatOutputRelevanceSchema.safeParse(value).success).toBe(true);
    }

    for (const value of EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS) {
      expect(EventObjectHumanReviewTriggerSchema.safeParse(value).success).toBe(true);
    }
  });
});

import { z } from "zod";
import { GeometryApproximationKindSchema } from "./geometry-approximation.js";

export const EVENT_OBJECT_OPERATIONAL_SCHEMA_VERSION = "venviewer.event-object-operational.v0";

const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const EVENT_OBJECT_SEMANTIC_METADATA_FIELDS = [
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
] as const;
export const EventObjectSemanticMetadataFieldSchema = z.enum(
  EVENT_OBJECT_SEMANTIC_METADATA_FIELDS,
);
export type EventObjectSemanticMetadataField = z.infer<
  typeof EventObjectSemanticMetadataFieldSchema
>;

export const EVENT_OBJECT_FOOTPRINT_KINDS = [
  "catalogue_footprint",
  "measured_polygon",
  "venue_supplied_dimensions",
  "manual_polygon",
  "generated_clearance_hull",
  "visual_mesh_projection",
  "unsupported_footprint",
] as const;
export const EventObjectFootprintKindSchema = z.enum(EVENT_OBJECT_FOOTPRINT_KINDS);
export type EventObjectFootprintKind = z.infer<typeof EventObjectFootprintKindSchema>;

export const EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES = [
  "not_temporary",
  "temporary_non_structural",
  "temporary_structure",
  "unknown_requires_review",
] as const;
export const EventObjectTemporaryStructureStatusSchema = z.enum(
  EVENT_OBJECT_TEMPORARY_STRUCTURE_STATUSES,
);
export type EventObjectTemporaryStructureStatus = z.infer<
  typeof EventObjectTemporaryStructureStatusSchema
>;

export const EVENT_OBJECT_STAGE_PLATFORM_STATUSES = [
  "not_stage_or_platform",
  "low_platform",
  "raised_stage",
  "performance_platform",
  "unknown_requires_review",
] as const;
export const EventObjectStagePlatformStatusSchema = z.enum(
  EVENT_OBJECT_STAGE_PLATFORM_STATUSES,
);
export type EventObjectStagePlatformStatus = z.infer<typeof EventObjectStagePlatformStatusSchema>;

export const EVENT_OBJECT_RIGGING_REQUIREMENTS = [
  "none",
  "floor_supported",
  "suspended_overhead",
  "truss_or_frame",
  "unknown_requires_review",
] as const;
export const EventObjectRiggingRequirementSchema = z.enum(EVENT_OBJECT_RIGGING_REQUIREMENTS);
export type EventObjectRiggingRequirement = z.infer<typeof EventObjectRiggingRequirementSchema>;

export const EVENT_OBJECT_FLOOR_LOADING_RELEVANCE = [
  "not_relevant",
  "lightweight_object",
  "load_estimate_required",
  "point_load_review_required",
  "unknown_requires_review",
] as const;
export const EventObjectFloorLoadingRelevanceSchema = z.enum(
  EVENT_OBJECT_FLOOR_LOADING_RELEVANCE,
);
export type EventObjectFloorLoadingRelevance = z.infer<
  typeof EventObjectFloorLoadingRelevanceSchema
>;

export const EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE = [
  "not_relevant",
  "low_heat",
  "heat_output_declared",
  "heat_review_required",
  "unknown_requires_review",
] as const;
export const EventObjectHeatOutputRelevanceSchema = z.enum(EVENT_OBJECT_HEAT_OUTPUT_RELEVANCE);
export type EventObjectHeatOutputRelevance = z.infer<
  typeof EventObjectHeatOutputRelevanceSchema
>;

export const EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS = [
  "unsupported_operational_footprint",
  "unverified_height_or_top_elevation",
  "temporary_structure_review",
  "stage_platform_review",
  "rigging_review",
  "floor_loading_review",
  "heat_output_review",
  "heritage_contact_review",
  "venue_policy_review",
] as const;
export const EventObjectHumanReviewTriggerSchema = z.enum(
  EVENT_OBJECT_HUMAN_REVIEW_TRIGGERS,
);
export type EventObjectHumanReviewTrigger = z.infer<typeof EventObjectHumanReviewTriggerSchema>;

export const EventObjectOperationalSemanticsSchema = z.object({
  schemaVersion: z.literal(EVENT_OBJECT_OPERATIONAL_SCHEMA_VERSION),
  objectRef: z.string().trim().min(1).max(255).regex(SLUG_TOKEN),
  footprintKind: EventObjectFootprintKindSchema,
  footprintApproximationKind: GeometryApproximationKindSchema.nullable(),
  heightM: z.number().nonnegative().max(100).nullable(),
  topElevationM: z.number().nonnegative().max(100).nullable(),
  loadEstimateKg: z.number().nonnegative().max(100_000).nullable(),
  heatOutputW: z.number().nonnegative().max(1_000_000).nullable(),
  temporaryStructureStatus: EventObjectTemporaryStructureStatusSchema,
  stagePlatformStatus: EventObjectStagePlatformStatusSchema,
  riggingRequirement: EventObjectRiggingRequirementSchema,
  floorLoadingRelevance: EventObjectFloorLoadingRelevanceSchema,
  heatOutputRelevance: EventObjectHeatOutputRelevanceSchema,
  humanReviewTriggers: z.array(EventObjectHumanReviewTriggerSchema),
}).strict().superRefine((metadata, ctx) => {
  const reviewTriggers = new Set(metadata.humanReviewTriggers);

  if (
    metadata.footprintKind === "unsupported_footprint" &&
    !reviewTriggers.has("unsupported_operational_footprint")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Unsupported footprints must trigger operational footprint review.",
    });
  }

  if (
    metadata.temporaryStructureStatus !== "not_temporary" &&
    !reviewTriggers.has("temporary_structure_review")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Temporary structure status must trigger review.",
    });
  }

  if (
    metadata.stagePlatformStatus !== "not_stage_or_platform" &&
    !reviewTriggers.has("stage_platform_review")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Stage or platform status must trigger review.",
    });
  }

  if (metadata.riggingRequirement !== "none" && !reviewTriggers.has("rigging_review")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Rigging requirement must trigger review.",
    });
  }

  if (
    (metadata.floorLoadingRelevance === "load_estimate_required" ||
      metadata.floorLoadingRelevance === "point_load_review_required" ||
      metadata.floorLoadingRelevance === "unknown_requires_review") &&
    !reviewTriggers.has("floor_loading_review")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Floor-loading relevance must trigger review.",
    });
  }

  if (
    (metadata.heatOutputRelevance === "heat_output_declared" ||
      metadata.heatOutputRelevance === "heat_review_required" ||
      metadata.heatOutputRelevance === "unknown_requires_review") &&
    !reviewTriggers.has("heat_output_review")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["humanReviewTriggers"],
      message: "Heat-output relevance must trigger review.",
    });
  }
});
export type EventObjectOperationalSemantics = z.infer<
  typeof EventObjectOperationalSemanticsSchema
>;

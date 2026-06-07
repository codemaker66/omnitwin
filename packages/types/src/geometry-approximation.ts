import { z } from "zod";

export const GEOMETRY_APPROXIMATION_KINDS = [
  "exact_footprint",
  "conservative_bounding_box",
  "oriented_bounding_box",
  "capsule_clearance_hull",
  "convex_hull",
  "aabb_approximation",
  "unsupported_geometry",
] as const;
export const GeometryApproximationKindSchema = z.enum(GEOMETRY_APPROXIMATION_KINDS);
export type GeometryApproximationKind = z.infer<typeof GeometryApproximationKindSchema>;

export const GEOMETRY_APPROXIMATION_METADATA_FIELDS = [
  "visualGeometryRef",
  "proofGeometryRef",
  "approximationKind",
  "purpose",
  "sourceObjectIds",
  "coordinateFrame",
  "units",
  "tolerance",
  "isConservative",
  "conservatismDirection",
  "generatedBy",
  "generatedAt",
  "limitations",
  "truthModeLabel",
  "evidenceDisclosure",
] as const;
export const GeometryApproximationMetadataFieldSchema = z.enum(
  GEOMETRY_APPROXIMATION_METADATA_FIELDS,
);
export type GeometryApproximationMetadataField = z.infer<
  typeof GeometryApproximationMetadataFieldSchema
>;

export const GEOMETRY_APPROXIMATION_PURPOSES = [
  "proposal_preview",
  "capacity_planning",
  "space_utilization",
  "clearance_check",
  "route_width_check",
  "accessibility_planning",
  "egress_planning",
  "forbidden_zone_check",
  "staff_supplier_route",
  "event_ops_setup",
] as const;
export const GeometryApproximationPurposeSchema = z.enum(GEOMETRY_APPROXIMATION_PURPOSES);
export type GeometryApproximationPurpose = z.infer<typeof GeometryApproximationPurposeSchema>;

export const GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS = [
  "not_applicable_exact",
  "overstates_occupied_area",
  "understates_available_space",
  "inflates_clearance_envelope",
  "unknown_or_unverified",
] as const;
export const GeometryApproximationConservatismDirectionSchema = z.enum(
  GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS,
);
export type GeometryApproximationConservatismDirection = z.infer<
  typeof GeometryApproximationConservatismDirectionSchema
>;

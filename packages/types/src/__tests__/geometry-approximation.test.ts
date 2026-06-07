import { describe, expect, it } from "vitest";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  RUNTIME_LAYER_KINDS,
  RuntimeLayerKindSchema,
} from "../runtime-venue-manifest.js";
import {
  GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS,
  GEOMETRY_APPROXIMATION_KINDS,
  GEOMETRY_APPROXIMATION_METADATA_FIELDS,
  GEOMETRY_APPROXIMATION_PURPOSES,
  GeometryApproximationConservatismDirectionSchema,
  GeometryApproximationKindSchema,
  GeometryApproximationMetadataFieldSchema,
  GeometryApproximationPurposeSchema,
} from "../geometry-approximation.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Geometry Approximation vocabulary", () => {
  it("pins approximation kinds from GAP-001", () => {
    expect(GEOMETRY_APPROXIMATION_KINDS).toEqual([
      "exact_footprint",
      "conservative_bounding_box",
      "oriented_bounding_box",
      "capsule_clearance_hull",
      "convex_hull",
      "aabb_approximation",
      "unsupported_geometry",
    ]);

    for (const kind of GEOMETRY_APPROXIMATION_KINDS) {
      expect(GeometryApproximationKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("pins required metadata field names", () => {
    expect(GEOMETRY_APPROXIMATION_METADATA_FIELDS).toEqual([
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
    ]);

    for (const field of GEOMETRY_APPROXIMATION_METADATA_FIELDS) {
      expect(GeometryApproximationMetadataFieldSchema.safeParse(field).success).toBe(true);
    }
  });

  it("pins purpose categories for proof geometry approximation", () => {
    expect(GEOMETRY_APPROXIMATION_PURPOSES).toEqual([
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
    ]);

    for (const purpose of GEOMETRY_APPROXIMATION_PURPOSES) {
      expect(GeometryApproximationPurposeSchema.safeParse(purpose).success).toBe(true);
    }
  });

  it("pins conservatism direction labels", () => {
    expect(GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS).toEqual([
      "not_applicable_exact",
      "overstates_occupied_area",
      "understates_available_space",
      "inflates_clearance_envelope",
      "unknown_or_unverified",
    ]);

    for (const direction of GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS) {
      expect(GeometryApproximationConservatismDirectionSchema.safeParse(direction).success).toBe(
        true,
      );
    }
  });

  it("keeps approximation kinds separate from visual runtime layers and claim statuses", () => {
    expect(overlap(GEOMETRY_APPROXIMATION_KINDS, RUNTIME_LAYER_KINDS)).toEqual([]);
    expect(overlap(GEOMETRY_APPROXIMATION_KINDS, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(GeometryApproximationKindSchema.safeParse("mesh").success).toBe(false);
    expect(GeometryApproximationKindSchema.safeParse("gaussian_splat").success).toBe(false);
    expect(GeometryApproximationKindSchema.safeParse("pass").success).toBe(false);
    expect(GeometryApproximationKindSchema.safeParse("fail").success).toBe(false);
    expect(RuntimeLayerKindSchema.safeParse("conservative_bounding_box").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("unsupported_geometry").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      GEOMETRY_APPROXIMATION_KINDS,
      GEOMETRY_APPROXIMATION_METADATA_FIELDS,
      GEOMETRY_APPROXIMATION_PURPOSES,
      GEOMETRY_APPROXIMATION_CONSERVATISM_DIRECTIONS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});

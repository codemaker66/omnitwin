import { describe, expect, it } from "vitest";
import { DataSufficiencyOutcomeSchema } from "../data-sufficiency.js";
import { GeometryApproximationKindSchema } from "../geometry-approximation.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import {
  OPERATIONAL_GEOJSON_GEOMETRY_TYPES,
  OPERATIONAL_GEOMETRY_CLASS_GEOMETRY_TYPES,
  OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_CHECK_IDS,
  OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_STATUSES,
  OPERATIONAL_GEOMETRY_FEATURE_CLASSES,
  OPERATIONAL_GEOMETRY_HASH_DOMAIN_PREFIX,
  OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION,
  OPERATIONAL_GEOMETRY_PURPOSES,
  OPERATIONAL_GEOMETRY_ROUTE_DISCOVERY_MODES,
  OPERATIONAL_GEOMETRY_SCHEMA_VERSION,
  OPERATIONAL_GEOMETRY_SOURCE_KINDS,
  OperationalGeoJsonFeatureCollectionV0Schema,
  OperationalGeoJsonGeometryTypeSchema,
  OperationalGeometryDataSufficiencyCheckRequestSchema,
  OperationalGeometryDataSufficiencyFindingSchema,
  OperationalGeometryDataSufficiencyStatusSchema,
  OperationalGeometryFeatureClassSchema,
  OperationalGeometryHashMaterialV0Schema,
  OperationalGeometryPurposeSchema,
  OperationalGeometrySourceKindSchema,
  isOperationalGeometryDataSufficiencyOutcome,
  operationalGeometryDataSufficiencyFindings,
  operationalGeometryHash,
  operationalGeometryHashJson,
  operationalGeometryHashMaterial,
  type OperationalGeoJsonGeometry,
  type OperationalGeoJsonFeature,
  type OperationalGeoJsonFeatureCollectionV0,
  type OperationalGeometryDataSufficiency,
  type OperationalGeometryDataSufficiencyCheckRequest,
  type OperationalGeometryFeatureProperties,
  type OperationalGeometryReference,
} from "../operational-geometry.js";
import { RuntimeLayerKindSchema } from "../runtime-venue-manifest.js";

function ref(ref: string, role: string): OperationalGeometryReference {
  return { refType: "test_ref", ref, role };
}

function sufficientData(): OperationalGeometryDataSufficiency {
  return {
    status: "sufficient",
    requiredInputRefs: [ref("layout_snapshot:grand-hall-draft", "source")],
    missingInputRefs: [],
    messageKey: null,
    reviewRole: null,
  };
}

function reviewData(): OperationalGeometryDataSufficiency {
  return {
    status: "requires_human_review",
    requiredInputRefs: [ref("venue_data:door-widths", "required")],
    missingInputRefs: [ref("venue_data:door-widths", "missing")],
    messageKey: "operational_geometry.requires_human_review",
    reviewRole: "venue_ops_reviewer",
  };
}

const BASE_PROPERTIES: OperationalGeometryFeatureProperties = {
  featureId: "feature_placeholder",
  featureClass: "walkable_area",
  coordinateFrame: "CVF_XY",
  units: { lengthUnit: "metre", angleUnit: "radian" },
  purposes: ["flow_simulation", "layout_evidence_pack"],
  sourceKind: "measured_room_geometry",
  sourceRefs: [ref("room:grand-hall", "source")],
  provenanceRefs: [ref("artifact:room-shell-v0", "provenance")],
  assumptionRefs: [],
  policyRefs: [],
  relatedFeatureIds: [],
  connectedFeatureIds: [],
  sourceObjectRefs: [],
  flowZoneKind: null,
  levelId: null,
  roomSlug: "grand-hall",
  venueSlug: "trades-hall",
  approximationKind: null,
  approximationPurpose: null,
  dataSufficiency: sufficientData(),
  notes: null,
};

function feature(
  id: string,
  featureClass: OperationalGeometryFeatureProperties["featureClass"],
  geometry: OperationalGeoJsonGeometry,
  overrides: Partial<OperationalGeometryFeatureProperties> = {},
): OperationalGeoJsonFeature {
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      ...BASE_PROPERTIES,
      featureId: id,
      featureClass,
      ...overrides,
    },
  };
}

const SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

const COLLECTION: OperationalGeoJsonFeatureCollectionV0 = {
  schemaVersion: OPERATIONAL_GEOMETRY_SCHEMA_VERSION,
  type: "FeatureCollection",
  metadata: {
    schemaVersion: OPERATIONAL_GEOMETRY_SCHEMA_VERSION,
    geometryId: "grand-hall-operational-geometry-v0",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    coordinateFrame: "CVF_XY",
    units: { lengthUnit: "metre", angleUnit: "radian" },
    purposes: ["flow_simulation", "layout_evidence_pack"],
    compilerVersion: "manual-schema-v0",
    layoutSnapshotDigest: "a".repeat(64),
    generatedAt: "2026-06-07T12:00:00.000Z",
    sourceRefs: [ref("layout_snapshot:grand-hall-draft", "source")],
    dataSufficiency: sufficientData(),
  },
  features: [
    feature("room_boundary:grand-hall", "room_boundary", {
      type: "Polygon",
      coordinates: [SQUARE],
    }),
    feature("walkable_area:grand-hall-main", "walkable_area", {
      type: "Polygon",
      coordinates: [SQUARE],
    }),
    feature(
      "furniture_footprint:round-table-001",
      "furniture_footprint",
      {
        type: "Polygon",
        coordinates: [[
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ]],
      },
      {
        sourceKind: "layout_snapshot_object",
        sourceObjectRefs: ["object:round-table-001"],
        approximationKind: "exact_footprint",
        approximationPurpose: "clearance_check",
      },
    ),
    feature(
      "portal:main-door",
      "portal",
      { type: "LineString", coordinates: [[0, 4], [0, 6]] },
      {
        connectedFeatureIds: ["room_boundary:grand-hall", "walkable_area:grand-hall-main"],
      },
    ),
    feature(
      "accessibility_connector:main-door",
      "accessibility_connector",
      { type: "LineString", coordinates: [[0, 5], [1, 5]] },
      {
        connectedFeatureIds: ["portal:main-door", "walkable_area:grand-hall-main"],
        dataSufficiency: reviewData(),
      },
    ),
    feature("queue_zone:bar-preview", "queue_zone", {
      type: "Polygon",
      coordinates: [[
        [6, 1],
        [9, 1],
        [9, 2],
        [6, 2],
        [6, 1],
      ]],
    }),
    feature("staff_only_zone:service-edge", "staff_only_zone", {
      type: "LineString",
      coordinates: [[9, 0], [9, 3]],
    }),
    feature(
      "unknown_or_unverified_area:stage-edge",
      "unknown_or_unverified_area",
      {
        type: "Polygon",
        coordinates: [[
          [8, 8],
          [10, 8],
          [10, 10],
          [8, 10],
          [8, 8],
        ]],
      },
      {
        sourceKind: "unknown_or_unverified",
        dataSufficiency: {
          status: "degraded_evidence",
          requiredInputRefs: [ref("venue_data:stage-edge", "required")],
          missingInputRefs: [ref("venue_data:stage-edge", "missing")],
          messageKey: "operational_geometry.degraded_evidence",
          reviewRole: null,
        },
      },
    ),
  ],
};

function firstFeature(): OperationalGeoJsonFeature {
  const first = COLLECTION.features[0];
  if (first === undefined) {
    throw new Error("fixture needs at least one feature");
  }
  return first;
}

function withFirstFeature(
  patch: Partial<OperationalGeoJsonFeature>,
): OperationalGeoJsonFeatureCollectionV0 {
  const first = firstFeature();
  return {
    ...COLLECTION,
    features: [{ ...first, ...patch }, ...COLLECTION.features.slice(1)],
  };
}

function withFirstFeatureInput(patch: {
  id?: unknown;
  geometry?: unknown;
  properties?: unknown;
}) {
  const first = firstFeature();
  return {
    ...COLLECTION,
    features: [{ ...first, ...patch }, ...COLLECTION.features.slice(1)],
  };
}

function hashFixture(): OperationalGeoJsonFeatureCollectionV0 {
  return patchFeatureProperties(
    patchFeatureProperties(
      {
        ...COLLECTION,
        metadata: {
          ...COLLECTION.metadata,
          sourceRefs: [
            ref("layout_snapshot:grand-hall-draft", "source"),
            ref("room_geometry:grand-hall-shell-v1", "canonical_geometry"),
          ],
        },
      },
      "furniture_footprint:round-table-001",
      (properties) => ({
        ...properties,
        assumptionRefs: [ref("assumption:round-table-clearance-buffer", "scenario_assumption")],
        policyRefs: [ref("policy:clearance-envelope-v1", "policy")],
        sourceRefs: [ref("layout_object:round-table-001", "source")],
      }),
    ),
    "queue_zone:bar-preview",
    (properties) => ({
      ...properties,
      sourceKind: "authored_flow_zone",
      sourceRefs: [ref("flow_zone:bar-preview", "source")],
      provenanceRefs: [ref("operator_annotation:bar-preview-v1", "provenance")],
    }),
  );
}

function patchFeatureProperties(
  collection: OperationalGeoJsonFeatureCollectionV0,
  featureId: string,
  patch: (
    properties: OperationalGeometryFeatureProperties,
  ) => OperationalGeometryFeatureProperties,
): OperationalGeoJsonFeatureCollectionV0 {
  let patched = false;
  const features = collection.features.map((candidate) => {
    if (candidate.id !== featureId) {
      return candidate;
    }

    patched = true;
    return {
      ...candidate,
      properties: patch(candidate.properties),
    };
  });

  if (!patched) {
    throw new Error(`Missing fixture feature ${featureId}.`);
  }

  return { ...collection, features };
}

function patchFeatureGeometry(
  collection: OperationalGeoJsonFeatureCollectionV0,
  featureId: string,
  geometry: OperationalGeoJsonGeometry,
): OperationalGeoJsonFeatureCollectionV0 {
  let patched = false;
  const features = collection.features.map((candidate) => {
    if (candidate.id !== featureId) {
      return candidate;
    }

    patched = true;
    return {
      ...candidate,
      geometry,
    };
  });

  if (!patched) {
    throw new Error(`Missing fixture feature ${featureId}.`);
  }

  return { ...collection, features };
}

function referenceKey(reference: OperationalGeometryReference): string {
  return `${reference.refType}:${reference.ref}:${reference.role}`;
}

function sufficiencyRequest(
  overrides: Partial<OperationalGeometryDataSufficiencyCheckRequest> = {},
): OperationalGeometryDataSufficiencyCheckRequest {
  return {
    purposes: ["route_validation", "layout_evidence_pack"],
    needsDoorWidths: false,
    needsVerifiedFurnitureFootprints: false,
    needsConnectorGraph: false,
    routeDiscoveryMode: "none",
    submittedRouteRef: null,
    requiredPolicyRefs: [],
    requiredFeatureClasses: [],
    ...overrides,
  };
}

describe("Operational Geometry GeoJSON schema", () => {
  it("pins feature classes from OGC-001", () => {
    expect(OPERATIONAL_GEOMETRY_FEATURE_CLASSES).toEqual([
      "room_boundary",
      "walkable_area",
      "obstacle",
      "furniture_footprint",
      "clearance_envelope",
      "door",
      "portal",
      "connector",
      "queue_zone",
      "spawn_zone",
      "goal_zone",
      "staff_only_zone",
      "service_zone",
      "heritage_restricted_zone",
      "accessibility_connector",
      "unknown_or_unverified_area",
    ]);

    for (const featureClass of OPERATIONAL_GEOMETRY_FEATURE_CLASSES) {
      expect(OperationalGeometryFeatureClassSchema.safeParse(featureClass).success).toBe(true);
      expect(OPERATIONAL_GEOMETRY_CLASS_GEOMETRY_TYPES[featureClass].length).toBeGreaterThan(0);
    }
  });

  it("pins purposes, source kinds, geometry types, and data sufficiency statuses", () => {
    expect(OPERATIONAL_GEOMETRY_PURPOSES).toEqual([
      "route_validation",
      "flow_simulation",
      "capacity_planning",
      "clearance_check",
      "event_ops_setup",
      "hallkeeper_setup",
      "layout_evidence_pack",
      "truth_mode_disclosure",
      "scotland_policy_bundle",
    ]);

    expect(OPERATIONAL_GEOMETRY_SOURCE_KINDS).toEqual([
      "measured_room_geometry",
      "venue_supplied_data",
      "layout_snapshot_object",
      "catalogue_footprint",
      "authored_flow_zone",
      "policy_bundle",
      "manual_review",
      "unknown_or_unverified",
    ]);

    expect(OPERATIONAL_GEOJSON_GEOMETRY_TYPES).toEqual([
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ]);

    expect(OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_STATUSES).toEqual([
      "sufficient",
      "unsupported_request",
      "not_checked",
      "degraded_evidence",
      "requires_human_review",
    ]);

    expect(OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_CHECK_IDS).toEqual([
      "missing_door_widths",
      "unverified_furniture_footprints",
      "unavailable_connector_graph",
      "unsupported_route_discovery_request",
      "geometry_policy_gap",
    ]);

    expect(OPERATIONAL_GEOMETRY_ROUTE_DISCOVERY_MODES).toEqual([
      "none",
      "submitted_route",
      "arbitrary_route",
    ]);

    for (const purpose of OPERATIONAL_GEOMETRY_PURPOSES) {
      expect(OperationalGeometryPurposeSchema.safeParse(purpose).success).toBe(true);
    }

    for (const sourceKind of OPERATIONAL_GEOMETRY_SOURCE_KINDS) {
      expect(OperationalGeometrySourceKindSchema.safeParse(sourceKind).success).toBe(true);
    }

    for (const geometryType of OPERATIONAL_GEOJSON_GEOMETRY_TYPES) {
      expect(OperationalGeoJsonGeometryTypeSchema.safeParse(geometryType).success).toBe(true);
    }

    expect(OperationalGeometryDataSufficiencyCheckRequestSchema.safeParse({
      ...sufficiencyRequest(),
      routeDiscoveryMode: "pass",
    }).success).toBe(false);
    expect(OperationalGeometryDataSufficiencyCheckRequestSchema.safeParse({
      ...sufficiencyRequest({
        routeDiscoveryMode: "none",
        submittedRouteRef: ref("layout_route:ceremony-entry", "submitted_route"),
      }),
    }).success).toBe(false);
    expect(OperationalGeometryDataSufficiencyCheckRequestSchema.safeParse(
      sufficiencyRequest({
        routeDiscoveryMode: "submitted_route",
        submittedRouteRef: ref("layout_route:ceremony-entry", "submitted_route"),
      }),
    ).success).toBe(true);
    expect(OperationalGeometryDataSufficiencyFindingSchema.safeParse({
      checkId: "missing_door_widths",
      status: "fail",
      messageKey: "operational_geometry.bad",
      affectedFeatureIds: [],
      requiredInputRefs: [],
      missingInputRefs: [],
      policyRefs: [],
      reviewRole: null,
    }).success).toBe(false);
  });

  it("parses an operational GeoJSON feature collection with required metadata", () => {
    expect(OperationalGeoJsonFeatureCollectionV0Schema.parse(COLLECTION)).toEqual(COLLECTION);
  });

  it("keeps operational classes separate from visual layers and verdict statuses", () => {
    expect(OperationalGeometryFeatureClassSchema.safeParse("mesh").success).toBe(false);
    expect(OperationalGeometryFeatureClassSchema.safeParse("gaussian_splat").success).toBe(false);
    expect(OperationalGeometryFeatureClassSchema.safeParse("pass").success).toBe(false);
    expect(OperationalGeometryFeatureClassSchema.safeParse("fail").success).toBe(false);
    expect(RuntimeLayerKindSchema.safeParse("walkable_area").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("portal").success).toBe(false);
    expect(GeometryApproximationKindSchema.safeParse("furniture_footprint").success).toBe(false);
  });

  it("rejects invalid GeoJSON geometry for the declared operational class", () => {
    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeature({
      geometry: { type: "Point", coordinates: [0, 0] },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse({
      ...COLLECTION,
      features: [
        feature("connector:bad-polygon", "connector", {
          type: "Polygon",
          coordinates: [SQUARE],
        }),
      ],
    }).success).toBe(false);
  });

  it("rejects unclosed polygon rings and unsupported GeoJSON geometry collections", () => {
    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
      },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      geometry: {
        type: "GeometryCollection",
        geometries: [],
      },
    })).success).toBe(false);
  });

  it("rejects feature identity drift and duplicate feature IDs", () => {
    const first = firstFeature();

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        featureId: "room_boundary:different",
      },
    })).success).toBe(false);

    const duplicated = {
      ...COLLECTION,
      features: [COLLECTION.features[0], COLLECTION.features[0]],
    };
    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(duplicated).success).toBe(false);
  });

  it("rejects features from a different venue or room than the collection metadata", () => {
    const first = firstFeature();

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        venueSlug: "other-venue",
      },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        roomSlug: "saloon",
      },
    })).success).toBe(false);
  });

  it("requires connector links and object references where geometry depends on them", () => {
    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse({
      ...COLLECTION,
      features: [
        feature("portal:missing-links", "portal", {
          type: "LineString",
          coordinates: [[0, 1], [0, 2]],
        }),
      ],
    }).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse({
      ...COLLECTION,
      features: [
        feature("furniture_footprint:no-object-ref", "furniture_footprint", {
          type: "Polygon",
          coordinates: [SQUARE],
        }),
      ],
    }).success).toBe(false);
  });

  it("rejects hidden data insufficiency", () => {
    const first = firstFeature();

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        dataSufficiency: {
          ...sufficientData(),
          missingInputRefs: [ref("venue_data:door-width", "missing")],
        },
      },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        dataSufficiency: {
          ...sufficientData(),
          messageKey: "operational_geometry.sufficient_but_warns",
        },
      },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(withFirstFeatureInput({
      properties: {
        ...first.properties,
        dataSufficiency: {
          status: "degraded_evidence",
          requiredInputRefs: [ref("venue_data:door-width", "required")],
          missingInputRefs: [ref("venue_data:door-width", "missing")],
          messageKey: null,
          reviewRole: null,
        },
      },
    })).success).toBe(false);

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse({
      ...COLLECTION,
      features: [
        feature("unknown_or_unverified_area:bad", "unknown_or_unverified_area", {
          type: "Polygon",
          coordinates: [SQUARE],
        }),
      ],
    }).success).toBe(false);
  });

  it("keeps data sufficiency statuses compatible with DSC outcomes without using pass/fail", () => {
    expect(isOperationalGeometryDataSufficiencyOutcome("sufficient")).toBe(false);
    expect(isOperationalGeometryDataSufficiencyOutcome("not_checked")).toBe(true);
    expect(DataSufficiencyOutcomeSchema.safeParse("sufficient").success).toBe(false);
    expect(OperationalGeometryDataSufficiencyStatusSchema.safeParse("pass").success).toBe(false);
    expect(OperationalGeometryDataSufficiencyStatusSchema.safeParse("fail").success).toBe(false);
  });

  it("rejects review roles on data-sufficiency states that do not require human review", () => {
    expect(OperationalGeometryDataSufficiencyStatusSchema.safeParse("sufficient").success).toBe(
      true,
    );

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse({
      ...COLLECTION,
      metadata: {
        ...COLLECTION.metadata,
        dataSufficiency: {
          status: "degraded_evidence",
          requiredInputRefs: [ref("venue_data:door-widths", "required")],
          missingInputRefs: [ref("venue_data:door-widths", "missing")],
          messageKey: "operational_geometry.degraded_evidence",
          reviewRole: "venue_ops_reviewer",
        },
      },
    }).success).toBe(false);
  });
});

describe("Operational Geometry data sufficiency checks", () => {
  it("emits a human-review finding when door or portal width evidence is missing", () => {
    const findings = operationalGeometryDataSufficiencyFindings(
      COLLECTION,
      sufficiencyRequest({ needsDoorWidths: true }),
    );

    expect(findings).toMatchObject([
      {
        checkId: "missing_door_widths",
        status: "requires_human_review",
        messageKey: "operational_geometry.door_widths.requires_human_review",
        affectedFeatureIds: ["portal:main-door"],
        reviewRole: "venue_ops_reviewer",
      },
    ]);
    expect(OperationalGeometryDataSufficiencyFindingSchema.parse(findings[0])).toEqual(
      findings[0],
    );
  });

  it("accepts explicit door-width evidence without inventing a finding", () => {
    const withDoorWidth = patchFeatureProperties(
      COLLECTION,
      "portal:main-door",
      (properties) => ({
        ...properties,
        sourceRefs: [
          ...properties.sourceRefs,
          { refType: "venue_data", ref: "door-widths-v1", role: "door_width" },
        ],
      }),
    );

    expect(operationalGeometryDataSufficiencyFindings(
      withDoorWidth,
      sufficiencyRequest({ needsDoorWidths: true }),
    )).toEqual([]);
  });

  it("downgrades evidence for unverified or unsupported furniture footprints", () => {
    const unverifiedFurniture = patchFeatureProperties(
      COLLECTION,
      "furniture_footprint:round-table-001",
      (properties) => ({
        ...properties,
        approximationKind: "unsupported_geometry",
      }),
    );

    expect(operationalGeometryDataSufficiencyFindings(
      unverifiedFurniture,
      sufficiencyRequest({ needsVerifiedFurnitureFootprints: true }),
    )).toMatchObject([
      {
        checkId: "unverified_furniture_footprints",
        status: "degraded_evidence",
        affectedFeatureIds: ["furniture_footprint:round-table-001"],
      },
    ]);
  });

  it("reports unavailable connector graph data without treating it as a route result", () => {
    const noConnectorGraph: OperationalGeoJsonFeatureCollectionV0 = {
      ...COLLECTION,
      features: COLLECTION.features.filter(
        (candidate) =>
          candidate.properties.featureClass !== "portal" &&
          candidate.properties.featureClass !== "accessibility_connector",
      ),
    };

    expect(operationalGeometryDataSufficiencyFindings(
      noConnectorGraph,
      sufficiencyRequest({ needsConnectorGraph: true }),
    )).toMatchObject([
      {
        checkId: "unavailable_connector_graph",
        status: "not_checked",
        messageKey: "operational_geometry.connector_graph.not_checked",
      },
    ]);
  });

  it("review-gates connector links that reference missing features", () => {
    const brokenConnectorGraph = patchFeatureProperties(
      COLLECTION,
      "portal:main-door",
      (properties) => ({
        ...properties,
        connectedFeatureIds: ["walkable_area:grand-hall-main", "room_boundary:missing"],
      }),
    );

    expect(operationalGeometryDataSufficiencyFindings(
      brokenConnectorGraph,
      sufficiencyRequest({ needsConnectorGraph: true }),
    )).toMatchObject([
      {
        checkId: "unavailable_connector_graph",
        status: "requires_human_review",
        affectedFeatureIds: ["portal:main-door"],
        reviewRole: "venue_ops_reviewer",
      },
    ]);
  });

  it("turns unsupported route discovery and missing submitted routes into explicit outcomes", () => {
    expect(operationalGeometryDataSufficiencyFindings(
      COLLECTION,
      sufficiencyRequest({ routeDiscoveryMode: "arbitrary_route" }),
    )).toMatchObject([
      {
        checkId: "unsupported_route_discovery_request",
        status: "unsupported_request",
      },
    ]);

    expect(operationalGeometryDataSufficiencyFindings(
      COLLECTION,
      sufficiencyRequest({ routeDiscoveryMode: "submitted_route", submittedRouteRef: null }),
    )).toMatchObject([
      {
        checkId: "unsupported_route_discovery_request",
        status: "not_checked",
        messageKey: "operational_geometry.route_discovery.submitted_route_missing",
      },
    ]);
  });

  it("surfaces policy and required-geometry gaps as data-sufficiency findings", () => {
    const findings = operationalGeometryDataSufficiencyFindings(
      COLLECTION,
      sufficiencyRequest({
        requiredPolicyRefs: [ref("policy:clearance-envelope-v1", "policy")],
        requiredFeatureClasses: ["connector"],
      }),
    );

    expect(findings).toMatchObject([
      {
        checkId: "geometry_policy_gap",
        status: "requires_human_review",
        messageKey: "operational_geometry.policy_gap.requires_human_review",
        reviewRole: "venue_ops_reviewer",
      },
    ]);
    expect(findings[0]?.missingInputRefs.map(referenceKey)).toEqual([
      "missing_input:operational_feature_class:connector:required",
      "test_ref:policy:clearance-envelope-v1:policy",
    ]);
  });

  it("propagates collection-level insufficient data without losing the original outcome", () => {
    const collectionLevelGap: OperationalGeoJsonFeatureCollectionV0 = {
      ...COLLECTION,
      metadata: {
        ...COLLECTION.metadata,
        dataSufficiency: {
          status: "degraded_evidence",
          requiredInputRefs: [ref("venue_data:door-widths", "required")],
          missingInputRefs: [ref("venue_data:door-widths", "missing")],
          messageKey: "operational_geometry.collection.degraded_evidence",
          reviewRole: null,
        },
      },
    };

    expect(operationalGeometryDataSufficiencyFindings(
      collectionLevelGap,
      sufficiencyRequest(),
    )).toMatchObject([
      {
        checkId: "geometry_policy_gap",
        status: "degraded_evidence",
        messageKey: "operational_geometry.collection.degraded_evidence",
      },
    ]);
  });

  it("rejects review roles on data-sufficiency findings that do not require human review", () => {
    expect(OperationalGeometryDataSufficiencyFindingSchema.safeParse({
      checkId: "unverified_furniture_footprints",
      status: "degraded_evidence",
      messageKey: "operational_geometry.furniture_footprints.degraded_evidence",
      affectedFeatureIds: ["furniture_footprint:round-table-001"],
      requiredInputRefs: [],
      missingInputRefs: [],
      policyRefs: [],
      reviewRole: "venue_ops_reviewer",
    }).success).toBe(false);
  });
});

describe("Operational Geometry hash policy", () => {
  it("builds hash material over compiler, layout, geometry refs, zones, portals, and assumptions", () => {
    const material = operationalGeometryHashMaterial(hashFixture());

    expect(OperationalGeometryHashMaterialV0Schema.parse(material)).toEqual(material);
    expect(material.hashPolicyVersion).toBe(OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION);
    expect(OPERATIONAL_GEOMETRY_HASH_DOMAIN_PREFIX).toBe(
      "venviewer.operational-geometry.hash.v0\n",
    );
    expect(material.compilerVersion).toBe("manual-schema-v0");
    expect(material.layoutSnapshotDigest).toBe("a".repeat(64));
    expect(material.canonicalRoomGeometryRefs.map(referenceKey)).toEqual([
      "test_ref:artifact:room-shell-v0:provenance",
      "test_ref:layout_snapshot:grand-hall-draft:source",
      "test_ref:room_geometry:grand-hall-shell-v1:canonical_geometry",
      "test_ref:room:grand-hall:source",
    ]);
    expect(material.furnitureFootprintRefs).toEqual(["object:round-table-001"]);
    expect(material.venueZoneFeatureIds).toEqual([
      "queue_zone:bar-preview",
      "staff_only_zone:service-edge",
    ]);
    expect(material.portalConnectorFeatureIds).toEqual([
      "accessibility_connector:main-door",
      "portal:main-door",
    ]);
    expect(material.policyRefs.map(referenceKey)).toEqual([
      "test_ref:policy:clearance-envelope-v1:policy",
    ]);
    expect(material.scenarioAssumptionRefs.map(referenceKey)).toEqual([
      "test_ref:assumption:round-table-clearance-buffer:scenario_assumption",
    ]);
    expect(material.features.map((feature) => feature.id)).toEqual([
      "accessibility_connector:main-door",
      "furniture_footprint:round-table-001",
      "portal:main-door",
      "queue_zone:bar-preview",
      "room_boundary:grand-hall",
      "staff_only_zone:service-edge",
      "unknown_or_unverified_area:stage-edge",
      "walkable_area:grand-hall-main",
    ]);
    expect(operationalGeometryHashJson(hashFixture())).toContain(
      "\"hashPolicyVersion\":\"venviewer.operational-geometry.hash.v0\"",
    );
    expect(operationalGeometryHash(hashFixture())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the hash stable across semantically unordered arrays and feature order", () => {
    const base = hashFixture();
    const reordered: OperationalGeoJsonFeatureCollectionV0 = {
      ...base,
      metadata: {
        ...base.metadata,
        purposes: [...base.metadata.purposes].reverse(),
        sourceRefs: [...base.metadata.sourceRefs].reverse(),
        dataSufficiency: {
          ...base.metadata.dataSufficiency,
          requiredInputRefs: [...base.metadata.dataSufficiency.requiredInputRefs].reverse(),
          missingInputRefs: [...base.metadata.dataSufficiency.missingInputRefs].reverse(),
        },
      },
      features: [...base.features].reverse().map((candidate) => ({
        ...candidate,
        properties: {
          ...candidate.properties,
          purposes: [...candidate.properties.purposes].reverse(),
          sourceRefs: [...candidate.properties.sourceRefs].reverse(),
          provenanceRefs: [...candidate.properties.provenanceRefs].reverse(),
          assumptionRefs: [...candidate.properties.assumptionRefs].reverse(),
          policyRefs: [...candidate.properties.policyRefs].reverse(),
          connectedFeatureIds: [...candidate.properties.connectedFeatureIds].reverse(),
          sourceObjectRefs: [...candidate.properties.sourceObjectRefs].reverse(),
          dataSufficiency: {
            ...candidate.properties.dataSufficiency,
            requiredInputRefs: [
              ...candidate.properties.dataSufficiency.requiredInputRefs,
            ].reverse(),
            missingInputRefs: [
              ...candidate.properties.dataSufficiency.missingInputRefs,
            ].reverse(),
          },
        },
      })),
    };

    expect(OperationalGeoJsonFeatureCollectionV0Schema.safeParse(reordered).success).toBe(true);
    expect(operationalGeometryHashJson(reordered)).toBe(operationalGeometryHashJson(base));
    expect(operationalGeometryHash(reordered)).toBe(operationalGeometryHash(base));
  });

  it("ignores generatedAt and notes because they are not operational geometry identity", () => {
    const base = hashFixture();
    const changedAnnotations: OperationalGeoJsonFeatureCollectionV0 = {
      ...base,
      metadata: {
        ...base.metadata,
        generatedAt: "2026-06-08T13:30:00.000Z",
      },
      features: base.features.map((candidate) => ({
        ...candidate,
        properties: {
          ...candidate.properties,
          notes: `operator note for ${candidate.id}`,
        },
      })),
    };

    expect(operationalGeometryHashJson(changedAnnotations)).toBe(
      operationalGeometryHashJson(base),
    );
    expect(operationalGeometryHash(changedAnnotations)).toBe(operationalGeometryHash(base));
  });

  it("changes the hash when compiler, layout, policy, assumption, source object, or geometry changes", () => {
    const base = hashFixture();
    const compilerChanged: OperationalGeoJsonFeatureCollectionV0 = {
      ...base,
      metadata: { ...base.metadata, compilerVersion: "manual-schema-v1" },
    };
    const layoutChanged: OperationalGeoJsonFeatureCollectionV0 = {
      ...base,
      metadata: { ...base.metadata, layoutSnapshotDigest: "b".repeat(64) },
    };
    const policyChanged = patchFeatureProperties(
      base,
      "furniture_footprint:round-table-001",
      (properties) => ({
        ...properties,
        policyRefs: [ref("policy:clearance-envelope-v2", "policy")],
      }),
    );
    const assumptionChanged = patchFeatureProperties(
      base,
      "furniture_footprint:round-table-001",
      (properties) => ({
        ...properties,
        assumptionRefs: [ref("assumption:alternate-table-spacing", "scenario_assumption")],
      }),
    );
    const sourceObjectChanged = patchFeatureProperties(
      base,
      "furniture_footprint:round-table-001",
      (properties) => ({
        ...properties,
        sourceObjectRefs: ["object:round-table-002"],
      }),
    );
    const geometryChanged = patchFeatureGeometry(
      base,
      "walkable_area:grand-hall-main",
      {
        type: "Polygon",
        coordinates: [[
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ]],
      },
    );

    const baseHash = operationalGeometryHash(base);
    expect(operationalGeometryHash(compilerChanged)).not.toBe(baseHash);
    expect(operationalGeometryHash(layoutChanged)).not.toBe(baseHash);
    expect(operationalGeometryHash(policyChanged)).not.toBe(baseHash);
    expect(operationalGeometryHash(assumptionChanged)).not.toBe(baseHash);
    expect(operationalGeometryHash(sourceObjectChanged)).not.toBe(baseHash);
    expect(operationalGeometryHash(geometryChanged)).not.toBe(baseHash);
  });
});

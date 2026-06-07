import { z } from "zod";
import {
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-layout-snapshot.js";
import { DataSufficiencyOutcomeSchema } from "./data-sufficiency.js";
import {
  GeometryApproximationKindSchema,
  GeometryApproximationPurposeSchema,
} from "./geometry-approximation.js";

export const OPERATIONAL_GEOMETRY_SCHEMA_VERSION = "venviewer.operational-geojson.v0";
export const OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION =
  "venviewer.operational-geometry.hash.v0";
export const OPERATIONAL_GEOMETRY_HASH_DOMAIN_PREFIX =
  `${OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION}\n`;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const MESSAGE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const FEATURE_ID = /^[a-z][a-z0-9]*(?:[_:-][a-z0-9]+)*$/;

export const OPERATIONAL_GEOMETRY_FEATURE_CLASSES = [
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
] as const;
export const OperationalGeometryFeatureClassSchema = z.enum(
  OPERATIONAL_GEOMETRY_FEATURE_CLASSES,
);
export type OperationalGeometryFeatureClass = z.infer<
  typeof OperationalGeometryFeatureClassSchema
>;

export const OPERATIONAL_GEOMETRY_PURPOSES = [
  "route_validation",
  "flow_simulation",
  "capacity_planning",
  "clearance_check",
  "event_ops_setup",
  "hallkeeper_setup",
  "layout_evidence_pack",
  "truth_mode_disclosure",
  "scotland_policy_bundle",
] as const;
export const OperationalGeometryPurposeSchema = z.enum(OPERATIONAL_GEOMETRY_PURPOSES);
export type OperationalGeometryPurpose = z.infer<typeof OperationalGeometryPurposeSchema>;

export const OPERATIONAL_GEOMETRY_SOURCE_KINDS = [
  "measured_room_geometry",
  "venue_supplied_data",
  "layout_snapshot_object",
  "catalogue_footprint",
  "authored_flow_zone",
  "policy_bundle",
  "manual_review",
  "unknown_or_unverified",
] as const;
export const OperationalGeometrySourceKindSchema = z.enum(
  OPERATIONAL_GEOMETRY_SOURCE_KINDS,
);
export type OperationalGeometrySourceKind = z.infer<
  typeof OperationalGeometrySourceKindSchema
>;

export const OPERATIONAL_GEOJSON_GEOMETRY_TYPES = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
] as const;
export const OperationalGeoJsonGeometryTypeSchema = z.enum(
  OPERATIONAL_GEOJSON_GEOMETRY_TYPES,
);
export type OperationalGeoJsonGeometryType = z.infer<
  typeof OperationalGeoJsonGeometryTypeSchema
>;

export const OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_STATUSES = [
  "sufficient",
  "unsupported_request",
  "not_checked",
  "degraded_evidence",
  "requires_human_review",
] as const;
export const OperationalGeometryDataSufficiencyStatusSchema = z.enum(
  OPERATIONAL_GEOMETRY_DATA_SUFFICIENCY_STATUSES,
);
export type OperationalGeometryDataSufficiencyStatus = z.infer<
  typeof OperationalGeometryDataSufficiencyStatusSchema
>;

export const OperationalGeometryFeatureIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(FEATURE_ID, "Operational geometry feature IDs must be stable slug tokens.");
export type OperationalGeometryFeatureId = z.infer<
  typeof OperationalGeometryFeatureIdSchema
>;

export const OperationalGeometryUnitsSchema = z
  .object({
    lengthUnit: z.literal("metre"),
    angleUnit: z.literal("radian"),
  })
  .strict();
export type OperationalGeometryUnits = z.infer<typeof OperationalGeometryUnitsSchema>;

export const OperationalGeometryCoordinateFrameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_:-]*$/);
export type OperationalGeometryCoordinateFrame = z.infer<
  typeof OperationalGeometryCoordinateFrameSchema
>;

export const OperationalGeometryPoint2Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
]);
export type OperationalGeometryPoint2 = z.infer<typeof OperationalGeometryPoint2Schema>;

export const OperationalGeometryLineStringCoordinatesSchema = z
  .array(OperationalGeometryPoint2Schema)
  .min(2);
export type OperationalGeometryLineStringCoordinates = z.infer<
  typeof OperationalGeometryLineStringCoordinatesSchema
>;

export const OperationalGeometryLinearRingSchema = z
  .array(OperationalGeometryPoint2Schema)
  .min(4)
  .superRefine((ring, ctx) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first === undefined || last === undefined || first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational GeoJSON polygon rings must be closed.",
      });
    }
  });
export type OperationalGeometryLinearRing = z.infer<
  typeof OperationalGeometryLinearRingSchema
>;

export const OperationalGeometryPolygonCoordinatesSchema = z
  .array(OperationalGeometryLinearRingSchema)
  .min(1);
export type OperationalGeometryPolygonCoordinates = z.infer<
  typeof OperationalGeometryPolygonCoordinatesSchema
>;

export const OperationalGeoJsonPointGeometrySchema = z
  .object({
    type: z.literal("Point"),
    coordinates: OperationalGeometryPoint2Schema,
  })
  .strict();

export const OperationalGeoJsonMultiPointGeometrySchema = z
  .object({
    type: z.literal("MultiPoint"),
    coordinates: z.array(OperationalGeometryPoint2Schema).min(1),
  })
  .strict();

export const OperationalGeoJsonLineStringGeometrySchema = z
  .object({
    type: z.literal("LineString"),
    coordinates: OperationalGeometryLineStringCoordinatesSchema,
  })
  .strict();

export const OperationalGeoJsonMultiLineStringGeometrySchema = z
  .object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(OperationalGeometryLineStringCoordinatesSchema).min(1),
  })
  .strict();

export const OperationalGeoJsonPolygonGeometrySchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: OperationalGeometryPolygonCoordinatesSchema,
  })
  .strict();

export const OperationalGeoJsonMultiPolygonGeometrySchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(OperationalGeometryPolygonCoordinatesSchema).min(1),
  })
  .strict();

export const OperationalGeoJsonGeometrySchema = z.discriminatedUnion("type", [
  OperationalGeoJsonPointGeometrySchema,
  OperationalGeoJsonMultiPointGeometrySchema,
  OperationalGeoJsonLineStringGeometrySchema,
  OperationalGeoJsonMultiLineStringGeometrySchema,
  OperationalGeoJsonPolygonGeometrySchema,
  OperationalGeoJsonMultiPolygonGeometrySchema,
]);
export type OperationalGeoJsonGeometry = z.infer<typeof OperationalGeoJsonGeometrySchema>;

export const OperationalGeometryReferenceSchema = z
  .object({
    refType: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(SLUG_TOKEN),
    ref: z.string().trim().min(1).max(512),
    role: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(SLUG_TOKEN),
  })
  .strict();
export type OperationalGeometryReference = z.infer<
  typeof OperationalGeometryReferenceSchema
>;

export const OperationalGeometryDataSufficiencySchema = z
  .object({
    status: OperationalGeometryDataSufficiencyStatusSchema,
    requiredInputRefs: z.array(OperationalGeometryReferenceSchema),
    missingInputRefs: z.array(OperationalGeometryReferenceSchema),
    messageKey: z.string().trim().min(1).max(160).regex(MESSAGE_KEY).nullable(),
    reviewRole: z.string().trim().min(1).max(120).regex(SLUG_TOKEN).nullable(),
  })
  .strict()
  .superRefine((dataSufficiency, ctx) => {
    if (
      dataSufficiency.status === "sufficient" &&
      dataSufficiency.missingInputRefs.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["missingInputRefs"],
        message: "Sufficient operational geometry cannot list missing inputs.",
      });
    }

    if (dataSufficiency.status !== "sufficient" && dataSufficiency.messageKey === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messageKey"],
        message: "Insufficient operational geometry needs a stable message key.",
      });
    }

    if (
      dataSufficiency.status === "requires_human_review" &&
      dataSufficiency.reviewRole === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewRole"],
        message: "Human-review data sufficiency outcomes need a review role.",
      });
    }
  });
export type OperationalGeometryDataSufficiency = z.infer<
  typeof OperationalGeometryDataSufficiencySchema
>;

export const OperationalGeometryFeaturePropertiesSchema = z
  .object({
    featureId: OperationalGeometryFeatureIdSchema,
    featureClass: OperationalGeometryFeatureClassSchema,
    coordinateFrame: OperationalGeometryCoordinateFrameSchema,
    units: OperationalGeometryUnitsSchema,
    purposes: z.array(OperationalGeometryPurposeSchema).min(1),
    sourceKind: OperationalGeometrySourceKindSchema,
    sourceRefs: z.array(OperationalGeometryReferenceSchema),
    provenanceRefs: z.array(OperationalGeometryReferenceSchema),
    assumptionRefs: z.array(OperationalGeometryReferenceSchema),
    policyRefs: z.array(OperationalGeometryReferenceSchema),
    relatedFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    connectedFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    sourceObjectRefs: z.array(z.string().trim().min(1).max(160).regex(FEATURE_ID)),
    flowZoneKind: z.string().trim().min(1).max(80).regex(SLUG_TOKEN).nullable(),
    levelId: z.string().trim().min(1).max(120).regex(FEATURE_ID).nullable(),
    roomSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    venueSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    approximationKind: GeometryApproximationKindSchema.nullable(),
    approximationPurpose: GeometryApproximationPurposeSchema.nullable(),
    dataSufficiency: OperationalGeometryDataSufficiencySchema,
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict();
export type OperationalGeometryFeatureProperties = z.infer<
  typeof OperationalGeometryFeaturePropertiesSchema
>;

export const OPERATIONAL_GEOMETRY_CLASS_GEOMETRY_TYPES = {
  room_boundary: ["Polygon", "MultiPolygon"],
  walkable_area: ["Polygon", "MultiPolygon"],
  obstacle: ["Polygon", "MultiPolygon"],
  furniture_footprint: ["Polygon", "MultiPolygon"],
  clearance_envelope: ["Polygon", "MultiPolygon"],
  door: ["Point", "LineString", "Polygon"],
  portal: ["Point", "LineString", "Polygon"],
  connector: ["LineString", "MultiLineString"],
  queue_zone: ["Polygon", "MultiPolygon", "LineString"],
  spawn_zone: ["Point", "MultiPoint", "LineString", "Polygon", "MultiPolygon"],
  goal_zone: ["Point", "MultiPoint", "LineString", "Polygon", "MultiPolygon"],
  staff_only_zone: ["Polygon", "MultiPolygon", "LineString", "MultiLineString"],
  service_zone: ["Polygon", "MultiPolygon", "Point", "LineString"],
  heritage_restricted_zone: ["Polygon", "MultiPolygon"],
  accessibility_connector: ["LineString", "MultiLineString"],
  unknown_or_unverified_area: ["Polygon", "MultiPolygon"],
} as const satisfies Record<
  OperationalGeometryFeatureClass,
  readonly OperationalGeoJsonGeometryType[]
>;

export const OperationalGeoJsonFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    id: OperationalGeometryFeatureIdSchema,
    geometry: OperationalGeoJsonGeometrySchema,
    properties: OperationalGeometryFeaturePropertiesSchema,
  })
  .strict()
  .superRefine((feature, ctx) => {
    if (feature.id !== feature.properties.featureId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", "featureId"],
        message: "Feature id and properties.featureId must match.",
      });
    }

    const allowedGeometryTypes: readonly OperationalGeoJsonGeometryType[] =
      OPERATIONAL_GEOMETRY_CLASS_GEOMETRY_TYPES[feature.properties.featureClass];
    if (!allowedGeometryTypes.includes(feature.geometry.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geometry", "type"],
        message: `${feature.properties.featureClass} cannot use ${feature.geometry.type} geometry.`,
      });
    }

    if (
      (feature.properties.featureClass === "portal" ||
        feature.properties.featureClass === "connector" ||
        feature.properties.featureClass === "accessibility_connector") &&
      feature.properties.connectedFeatureIds.length < 2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", "connectedFeatureIds"],
        message: "Portal and connector features need at least two connected feature IDs.",
      });
    }

    if (
      (feature.properties.featureClass === "furniture_footprint" ||
        feature.properties.featureClass === "clearance_envelope") &&
      feature.properties.sourceObjectRefs.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", "sourceObjectRefs"],
        message: "Object-derived operational geometry needs a source object reference.",
      });
    }

    if (
      feature.properties.featureClass === "unknown_or_unverified_area" &&
      feature.properties.dataSufficiency.status === "sufficient"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", "dataSufficiency", "status"],
        message: "Unknown or unverified areas cannot be marked data-sufficient.",
      });
    }
  });
export type OperationalGeoJsonFeature = z.infer<typeof OperationalGeoJsonFeatureSchema>;

export const OperationalGeometryCollectionMetadataSchema = z
  .object({
    schemaVersion: z.literal(OPERATIONAL_GEOMETRY_SCHEMA_VERSION),
    geometryId: z.string().trim().min(1).max(160).regex(FEATURE_ID),
    venueSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    roomSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    coordinateFrame: OperationalGeometryCoordinateFrameSchema,
    units: OperationalGeometryUnitsSchema,
    purposes: z.array(OperationalGeometryPurposeSchema).min(1),
    compilerVersion: z.string().trim().min(1).max(120),
    layoutSnapshotDigest: z.string().trim().length(64).regex(/^[a-f0-9]+$/).nullable(),
    generatedAt: z.string().regex(ISO_DATE_TIME, "generatedAt must be an ISO datetime."),
    sourceRefs: z.array(OperationalGeometryReferenceSchema).min(1),
    dataSufficiency: OperationalGeometryDataSufficiencySchema,
  })
  .strict();
export type OperationalGeometryCollectionMetadata = z.infer<
  typeof OperationalGeometryCollectionMetadataSchema
>;

export const OperationalGeoJsonFeatureCollectionV0Schema = z
  .object({
    schemaVersion: z.literal(OPERATIONAL_GEOMETRY_SCHEMA_VERSION),
    type: z.literal("FeatureCollection"),
    metadata: OperationalGeometryCollectionMetadataSchema,
    features: z.array(OperationalGeoJsonFeatureSchema).min(1),
  })
  .strict()
  .superRefine((collection, ctx) => {
    const featureIds = new Set<OperationalGeometryFeatureId>();
    for (const [index, feature] of collection.features.entries()) {
      if (featureIds.has(feature.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", index, "id"],
          message: `Duplicate operational geometry feature id: ${feature.id}`,
        });
      }
      featureIds.add(feature.id);

      if (feature.properties.coordinateFrame !== collection.metadata.coordinateFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", index, "properties", "coordinateFrame"],
          message: "Feature coordinate frame must match collection metadata.",
        });
      }
    }
  });
export type OperationalGeoJsonFeatureCollectionV0 = z.infer<
  typeof OperationalGeoJsonFeatureCollectionV0Schema
>;

export const OperationalGeometryHashFeatureSchema = z
  .object({
    id: OperationalGeometryFeatureIdSchema,
    featureClass: OperationalGeometryFeatureClassSchema,
    geometry: OperationalGeoJsonGeometrySchema,
    coordinateFrame: OperationalGeometryCoordinateFrameSchema,
    units: OperationalGeometryUnitsSchema,
    roomSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    venueSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    levelId: z.string().trim().min(1).max(120).regex(FEATURE_ID).nullable(),
    flowZoneKind: z.string().trim().min(1).max(80).regex(SLUG_TOKEN).nullable(),
    purposes: z.array(OperationalGeometryPurposeSchema).min(1),
    sourceKind: OperationalGeometrySourceKindSchema,
    sourceRefs: z.array(OperationalGeometryReferenceSchema),
    provenanceRefs: z.array(OperationalGeometryReferenceSchema),
    policyRefs: z.array(OperationalGeometryReferenceSchema),
    assumptionRefs: z.array(OperationalGeometryReferenceSchema),
    relatedFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    connectedFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    sourceObjectRefs: z.array(z.string().trim().min(1).max(160).regex(FEATURE_ID)),
    approximationKind: GeometryApproximationKindSchema.nullable(),
    approximationPurpose: GeometryApproximationPurposeSchema.nullable(),
    dataSufficiency: OperationalGeometryDataSufficiencySchema,
  })
  .strict();
export type OperationalGeometryHashFeature = z.infer<
  typeof OperationalGeometryHashFeatureSchema
>;

export const OperationalGeometryHashMaterialV0Schema = z
  .object({
    hashPolicyVersion: z.literal(OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION),
    schemaVersion: z.literal(OPERATIONAL_GEOMETRY_SCHEMA_VERSION),
    geometryId: z.string().trim().min(1).max(160).regex(FEATURE_ID),
    venueSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    roomSlug: z.string().trim().min(1).max(120).regex(SLUG_TOKEN),
    coordinateFrame: OperationalGeometryCoordinateFrameSchema,
    units: OperationalGeometryUnitsSchema,
    purposes: z.array(OperationalGeometryPurposeSchema).min(1),
    compilerVersion: z.string().trim().min(1).max(120),
    layoutSnapshotDigest: z.string().trim().length(64).regex(/^[a-f0-9]+$/).nullable(),
    canonicalRoomGeometryRefs: z.array(OperationalGeometryReferenceSchema),
    furnitureFootprintRefs: z.array(z.string().trim().min(1).max(160).regex(FEATURE_ID)),
    venueZoneFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    venueZoneRefs: z.array(OperationalGeometryReferenceSchema),
    portalConnectorFeatureIds: z.array(OperationalGeometryFeatureIdSchema),
    policyRefs: z.array(OperationalGeometryReferenceSchema),
    scenarioAssumptionRefs: z.array(OperationalGeometryReferenceSchema),
    sourceRefs: z.array(OperationalGeometryReferenceSchema),
    dataSufficiency: OperationalGeometryDataSufficiencySchema,
    features: z.array(OperationalGeometryHashFeatureSchema).min(1),
  })
  .strict();
export type OperationalGeometryHashMaterialV0 = z.infer<
  typeof OperationalGeometryHashMaterialV0Schema
>;

export function operationalGeometryHashMaterial(
  collection: OperationalGeoJsonFeatureCollectionV0,
): OperationalGeometryHashMaterialV0 {
  const parsed = OperationalGeoJsonFeatureCollectionV0Schema.parse(collection);
  const features = parsed.features
    .map(normalizeOperationalGeometryFeatureForHash)
    .sort(compareHashFeatures);

  return OperationalGeometryHashMaterialV0Schema.parse({
    hashPolicyVersion: OPERATIONAL_GEOMETRY_HASH_POLICY_VERSION,
    schemaVersion: parsed.schemaVersion,
    geometryId: parsed.metadata.geometryId,
    venueSlug: parsed.metadata.venueSlug,
    roomSlug: parsed.metadata.roomSlug,
    coordinateFrame: parsed.metadata.coordinateFrame,
    units: parsed.metadata.units,
    purposes: uniqueSortedPurposes(parsed.metadata.purposes),
    compilerVersion: parsed.metadata.compilerVersion,
    layoutSnapshotDigest: parsed.metadata.layoutSnapshotDigest,
    canonicalRoomGeometryRefs: canonicalRoomGeometryRefs(features, parsed.metadata.sourceRefs),
    furnitureFootprintRefs: furnitureFootprintRefs(features),
    venueZoneFeatureIds: venueZoneFeatureIds(features),
    venueZoneRefs: venueZoneRefs(features),
    portalConnectorFeatureIds: portalConnectorFeatureIds(features),
    policyRefs: uniqueSortedReferences(features.flatMap((feature) => feature.policyRefs)),
    scenarioAssumptionRefs: uniqueSortedReferences(
      features.flatMap((feature) => feature.assumptionRefs),
    ),
    sourceRefs: uniqueSortedReferences([
      ...parsed.metadata.sourceRefs,
      ...features.flatMap((feature) => feature.sourceRefs),
      ...features.flatMap((feature) => feature.provenanceRefs),
    ]),
    dataSufficiency: normalizeOperationalGeometryDataSufficiencyForHash(
      parsed.metadata.dataSufficiency,
    ),
    features,
  });
}

export function operationalGeometryHashJson(
  collection: OperationalGeoJsonFeatureCollectionV0,
): string {
  return stableCanonicalJson(
    operationalGeometryHashMaterial(collection) as CanonicalJsonValue,
  );
}

export function operationalGeometryHash(
  collection: OperationalGeoJsonFeatureCollectionV0,
): string {
  return sha256Hex(
    `${OPERATIONAL_GEOMETRY_HASH_DOMAIN_PREFIX}${operationalGeometryHashJson(collection)}`,
  );
}

export function isOperationalGeometryDataSufficiencyOutcome(
  status: OperationalGeometryDataSufficiencyStatus,
): boolean {
  return status !== "sufficient" && DataSufficiencyOutcomeSchema.safeParse(status).success;
}

const ROOM_GEOMETRY_CLASSES: readonly OperationalGeometryFeatureClass[] = [
  "room_boundary",
  "walkable_area",
];

const FURNITURE_FOOTPRINT_CLASSES: readonly OperationalGeometryFeatureClass[] = [
  "furniture_footprint",
  "clearance_envelope",
];

const VENUE_ZONE_CLASSES: readonly OperationalGeometryFeatureClass[] = [
  "queue_zone",
  "spawn_zone",
  "goal_zone",
  "staff_only_zone",
  "service_zone",
  "heritage_restricted_zone",
];

const PORTAL_CONNECTOR_CLASSES: readonly OperationalGeometryFeatureClass[] = [
  "portal",
  "connector",
  "accessibility_connector",
];

function normalizeOperationalGeometryFeatureForHash(
  feature: OperationalGeoJsonFeature,
): OperationalGeometryHashFeature {
  return OperationalGeometryHashFeatureSchema.parse({
    id: feature.id,
    featureClass: feature.properties.featureClass,
    geometry: feature.geometry,
    coordinateFrame: feature.properties.coordinateFrame,
    units: feature.properties.units,
    roomSlug: feature.properties.roomSlug,
    venueSlug: feature.properties.venueSlug,
    levelId: feature.properties.levelId,
    flowZoneKind: feature.properties.flowZoneKind,
    purposes: uniqueSortedPurposes(feature.properties.purposes),
    sourceKind: feature.properties.sourceKind,
    sourceRefs: uniqueSortedReferences(feature.properties.sourceRefs),
    provenanceRefs: uniqueSortedReferences(feature.properties.provenanceRefs),
    policyRefs: uniqueSortedReferences(feature.properties.policyRefs),
    assumptionRefs: uniqueSortedReferences(feature.properties.assumptionRefs),
    relatedFeatureIds: uniqueSortedFeatureIds(feature.properties.relatedFeatureIds),
    connectedFeatureIds: uniqueSortedFeatureIds(feature.properties.connectedFeatureIds),
    sourceObjectRefs: uniqueSortedStrings(feature.properties.sourceObjectRefs),
    approximationKind: feature.properties.approximationKind,
    approximationPurpose: feature.properties.approximationPurpose,
    dataSufficiency: normalizeOperationalGeometryDataSufficiencyForHash(
      feature.properties.dataSufficiency,
    ),
  });
}

function normalizeOperationalGeometryDataSufficiencyForHash(
  dataSufficiency: OperationalGeometryDataSufficiency,
): OperationalGeometryDataSufficiency {
  return OperationalGeometryDataSufficiencySchema.parse({
    ...dataSufficiency,
    requiredInputRefs: uniqueSortedReferences(dataSufficiency.requiredInputRefs),
    missingInputRefs: uniqueSortedReferences(dataSufficiency.missingInputRefs),
  });
}

function canonicalRoomGeometryRefs(
  features: readonly OperationalGeometryHashFeature[],
  collectionSourceRefs: readonly OperationalGeometryReference[],
): OperationalGeometryReference[] {
  const roomFeatureRefs = features
    .filter((feature) => featureClassIn(feature.featureClass, ROOM_GEOMETRY_CLASSES))
    .flatMap((feature) => [...feature.sourceRefs, ...feature.provenanceRefs]);
  return uniqueSortedReferences([...collectionSourceRefs, ...roomFeatureRefs]);
}

function furnitureFootprintRefs(
  features: readonly OperationalGeometryHashFeature[],
): string[] {
  return uniqueSortedStrings(
    features
      .filter((feature) => featureClassIn(feature.featureClass, FURNITURE_FOOTPRINT_CLASSES))
      .flatMap((feature) => feature.sourceObjectRefs),
  );
}

function venueZoneFeatureIds(
  features: readonly OperationalGeometryHashFeature[],
): OperationalGeometryFeatureId[] {
  return uniqueSortedFeatureIds(
    features
      .filter((feature) => featureClassIn(feature.featureClass, VENUE_ZONE_CLASSES))
      .map((feature) => feature.id),
  );
}

function venueZoneRefs(
  features: readonly OperationalGeometryHashFeature[],
): OperationalGeometryReference[] {
  return uniqueSortedReferences(
    features
      .filter((feature) => featureClassIn(feature.featureClass, VENUE_ZONE_CLASSES))
      .flatMap((feature) => [...feature.sourceRefs, ...feature.provenanceRefs]),
  );
}

function portalConnectorFeatureIds(
  features: readonly OperationalGeometryHashFeature[],
): OperationalGeometryFeatureId[] {
  return uniqueSortedFeatureIds(
    features
      .filter((feature) => featureClassIn(feature.featureClass, PORTAL_CONNECTOR_CLASSES))
      .map((feature) => feature.id),
  );
}

function featureClassIn(
  featureClass: OperationalGeometryFeatureClass,
  featureClasses: readonly OperationalGeometryFeatureClass[],
): boolean {
  return featureClasses.includes(featureClass);
}

function uniqueSortedPurposes(
  purposes: readonly OperationalGeometryPurpose[],
): OperationalGeometryPurpose[] {
  return [...new Set(purposes)].sort();
}

function uniqueSortedFeatureIds(
  featureIds: readonly OperationalGeometryFeatureId[],
): OperationalGeometryFeatureId[] {
  return [...new Set(featureIds)].sort();
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueSortedReferences(
  references: readonly OperationalGeometryReference[],
): OperationalGeometryReference[] {
  const referencesByKey = new Map<string, OperationalGeometryReference>();
  for (const reference of references) {
    referencesByKey.set(operationalGeometryReferenceKey(reference), reference);
  }
  return [...referencesByKey.values()].sort(compareOperationalGeometryReferences);
}

function compareHashFeatures(
  left: OperationalGeometryHashFeature,
  right: OperationalGeometryHashFeature,
): number {
  return left.id.localeCompare(right.id);
}

function compareOperationalGeometryReferences(
  left: OperationalGeometryReference,
  right: OperationalGeometryReference,
): number {
  return operationalGeometryReferenceKey(left).localeCompare(
    operationalGeometryReferenceKey(right),
  );
}

function operationalGeometryReferenceKey(reference: OperationalGeometryReference): string {
  return `${reference.refType}\u0000${reference.ref}\u0000${reference.role}`;
}

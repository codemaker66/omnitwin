import { z } from "zod";
import {
  AssetDefinitionIdSchema,
  ConfigurationIdSchema,
  LayoutStyleSchema,
  PlacedObjectIdSchema,
  Vec3Schema,
  VisibilitySchema,
} from "./configuration.js";
import { FurnitureCategorySchema } from "./furniture.js";
import {
  FloorPlanOutlineSchema,
  SpaceDimensionsSchema,
  SpaceIdSchema,
  SpaceSlugSchema,
} from "./space.js";
import { UserIdSchema } from "./user.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";
import { LayoutProofScenarioAssumptionCategorySchema } from "./layout-proof-object.js";

export const CANONICAL_LAYOUT_SNAPSHOT_V0_SCHEMA_VERSION = "layout_snapshot.v0";
export const CANONICAL_LAYOUT_SNAPSHOT_DOMAIN_PREFIX = "venviewer.layout_snapshot.v0\n";

const SHA256_HEX = /^[a-f0-9]{64}$/;

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export const CanonicalJsonValueSchema: z.ZodType<CanonicalJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(CanonicalJsonValueSchema),
    z.record(CanonicalJsonValueSchema),
  ]),
);

export const LayoutSnapshotSourceStateSchema = z.enum([
  "saved_configuration",
  "submitted_configuration",
  "approved_configuration",
]);
export type LayoutSnapshotSourceState = z.infer<typeof LayoutSnapshotSourceStateSchema>;

export const LayoutSnapshotAssumptionSourceSchema = z.enum([
  "planner_input",
  "venue_default",
  "policy_bundle",
  "system_default",
  "human_reviewer",
]);
export type LayoutSnapshotAssumptionSource = z.infer<
  typeof LayoutSnapshotAssumptionSourceSchema
>;

export const LayoutSnapshotRoomGeometrySourceSchema = z.enum([
  "space_floor_plan_outline",
  "hand_authored_room_geometry",
  "runtime_manifest",
]);
export type LayoutSnapshotRoomGeometrySource = z.infer<
  typeof LayoutSnapshotRoomGeometrySourceSchema
>;

export const LayoutSnapshotGeneratorTypeSchema = z.enum([
  "human",
  "ai_generated",
  "ai_assisted",
  "template",
  "imported",
]);
export type LayoutSnapshotGeneratorType = z.infer<typeof LayoutSnapshotGeneratorTypeSchema>;

export const LayoutSnapshotUnitsSchema = z.object({
  lengthUnit: z.literal("metre"),
  angleUnit: z.literal("radian"),
  timeUnit: z.literal("iso8601_utc_timestamp"),
  currency: z.literal("GBP").nullable(),
}).strict();
export type LayoutSnapshotUnits = z.infer<typeof LayoutSnapshotUnitsSchema>;

export const LayoutSnapshotTolerancePolicySchema = z.object({
  positionPrecisionM: z.literal(0.001),
  rotationPrecisionRad: z.literal(0.00001),
  scalePrecision: z.literal(0.001),
  floorContainmentToleranceM: z.number().positive().max(1),
  clearanceToleranceM: z.number().positive().max(1),
  currencyPrecisionMinorUnit: z.literal(1),
}).strict();
export type LayoutSnapshotTolerancePolicy = z.infer<
  typeof LayoutSnapshotTolerancePolicySchema
>;

export const LayoutSnapshotAssetDefinitionSchema = z.object({
  assetDefinitionId: AssetDefinitionIdSchema,
  category: FurnitureCategorySchema,
  widthM: z.number().positive().max(100),
  depthM: z.number().positive().max(100),
  heightM: z.number().positive().max(100),
  seatCount: z.number().int().positive().nullable(),
  collisionType: z.string().trim().min(1).max(40),
}).strict();
export type LayoutSnapshotAssetDefinition = z.infer<
  typeof LayoutSnapshotAssetDefinitionSchema
>;

export const LayoutSnapshotPlacedObjectSchema = z.object({
  objectId: PlacedObjectIdSchema,
  assetDefinition: LayoutSnapshotAssetDefinitionSchema,
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: z.number().positive().max(100),
  sortOrder: z.number().int().nonnegative(),
  groupId: z.string().trim().min(1).max(120).nullable(),
  metadata: z.record(CanonicalJsonValueSchema).nullable(),
}).strict();
export type LayoutSnapshotPlacedObject = z.infer<typeof LayoutSnapshotPlacedObjectSchema>;

export const LayoutSnapshotEventMetadataSchema = z.object({
  eventType: z.string().trim().min(1).max(120).nullable(),
  guestCount: z.number().int().nonnegative(),
  preferredDate: z.string().trim().min(1).max(40).nullable(),
  startTime: z.string().trim().min(1).max(40).nullable(),
  endTime: z.string().trim().min(1).max(40).nullable(),
  specialInstructions: z.string().trim().max(4000).nullable(),
}).strict();
export type LayoutSnapshotEventMetadata = z.infer<
  typeof LayoutSnapshotEventMetadataSchema
>;

export const LayoutSnapshotScenarioAssumptionSchema = z.object({
  category: LayoutProofScenarioAssumptionCategorySchema,
  value: CanonicalJsonValueSchema,
  source: LayoutSnapshotAssumptionSourceSchema,
  sourceReference: z.string().trim().min(1).max(255).nullable(),
}).strict();
export type LayoutSnapshotScenarioAssumption = z.infer<
  typeof LayoutSnapshotScenarioAssumptionSchema
>;

export const LayoutSnapshotVenueRuntimeReferenceSchema = z.object({
  venueId: VenueIdSchema,
  venueSlug: VenueSlugSchema,
  spaceId: SpaceIdSchema,
  spaceSlug: SpaceSlugSchema,
  spaceName: z.string().trim().min(1).max(200),
  floorPlanOutline: FloorPlanOutlineSchema,
  floorPlanOutlineDigest: z.string().regex(SHA256_HEX).nullable(),
  spaceDimensions: SpaceDimensionsSchema,
  roomGeometrySource: LayoutSnapshotRoomGeometrySourceSchema,
  runtimeVenueManifestDigest: z.string().regex(SHA256_HEX).nullable(),
  runtimePackageId: z.string().trim().min(1).max(160).nullable(),
}).strict();
export type LayoutSnapshotVenueRuntimeReference = z.infer<
  typeof LayoutSnapshotVenueRuntimeReferenceSchema
>;

export const LayoutSnapshotPolicyBundleReferenceSchema = z.object({
  policyBundleId: z.string().trim().min(1).max(160),
  policyBundleDigest: z.string().regex(SHA256_HEX).nullable(),
  policyBundleVersion: z.string().trim().min(1).max(80),
  effectiveFrom: z.string().datetime().nullable(),
  effectiveTo: z.string().datetime().nullable(),
  jurisdiction: z.string().trim().min(1).max(160),
  venueRuleSet: z.string().trim().min(1).max(160),
  humanReviewRequiredFor: z.array(z.string().trim().min(1).max(160)),
}).strict();
export type LayoutSnapshotPolicyBundleReference = z.infer<
  typeof LayoutSnapshotPolicyBundleReferenceSchema
>;

export const LayoutSnapshotGeneratorProvenanceSchema = z.object({
  generatorType: LayoutSnapshotGeneratorTypeSchema,
  generatorName: z.string().trim().min(1).max(160).nullable(),
  generatorVersion: z.string().trim().min(1).max(80).nullable(),
  promptDigest: z.string().regex(SHA256_HEX).nullable(),
  sourceTemplateId: z.string().trim().min(1).max(160).nullable(),
  humanEditedAfterGeneration: z.boolean(),
  generatedAt: z.string().datetime().nullable(),
}).strict();
export type LayoutSnapshotGeneratorProvenance = z.infer<
  typeof LayoutSnapshotGeneratorProvenanceSchema
>;

export const CanonicalLayoutSnapshotV0Schema = z.object({
  schemaVersion: z.literal(CANONICAL_LAYOUT_SNAPSHOT_V0_SCHEMA_VERSION),
  configurationId: ConfigurationIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  layoutName: z.string().trim().min(1).max(200),
  layoutStyle: LayoutStyleSchema,
  visibility: VisibilitySchema,
  guestCount: z.number().int().nonnegative(),
  createdFromConfigurationUpdatedAt: z.string().datetime(),
  createdBy: UserIdSchema.nullable(),
  snapshotCreatedAt: z.string().datetime(),
  sourceState: LayoutSnapshotSourceStateSchema,
  units: LayoutSnapshotUnitsSchema,
  tolerancePolicy: LayoutSnapshotTolerancePolicySchema,
  eventMetadata: LayoutSnapshotEventMetadataSchema,
  scenarioAssumptions: z.array(LayoutSnapshotScenarioAssumptionSchema),
  venueRuntime: LayoutSnapshotVenueRuntimeReferenceSchema,
  policyBundle: LayoutSnapshotPolicyBundleReferenceSchema,
  generatorProvenance: LayoutSnapshotGeneratorProvenanceSchema,
  objects: z.array(LayoutSnapshotPlacedObjectSchema),
}).strict();
export type CanonicalLayoutSnapshotV0 = z.infer<typeof CanonicalLayoutSnapshotV0Schema>;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizedObject(object: LayoutSnapshotPlacedObject): LayoutSnapshotPlacedObject {
  return {
    ...object,
    position: {
      x: roundTo(object.position.x, 3),
      y: roundTo(object.position.y, 3),
      z: roundTo(object.position.z, 3),
    },
    rotation: {
      x: roundTo(object.rotation.x, 5),
      y: roundTo(object.rotation.y, 5),
      z: roundTo(object.rotation.z, 5),
    },
    scale: roundTo(object.scale, 3),
  };
}

export function normalizeCanonicalLayoutSnapshot(
  snapshot: CanonicalLayoutSnapshotV0,
): CanonicalLayoutSnapshotV0 {
  const parsed = CanonicalLayoutSnapshotV0Schema.parse(snapshot);
  return {
    ...parsed,
    objects: [...parsed.objects]
      .map(normalizedObject)
      .sort((left, right) => left.objectId.localeCompare(right.objectId)),
    scenarioAssumptions: [...parsed.scenarioAssumptions].sort((left, right) => {
      const leftKey = `${left.category}\u0000${left.source}\u0000${stableCanonicalJson(left.value)}`;
      const rightKey = `${right.category}\u0000${right.source}\u0000${stableCanonicalJson(right.value)}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}

function isCanonicalObject(value: CanonicalJsonValue): value is {
  readonly [key: string]: CanonicalJsonValue;
} {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalArray(value: CanonicalJsonValue): value is readonly CanonicalJsonValue[] {
  return Array.isArray(value);
}

export function stableCanonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON cannot encode non-finite numbers");
    }
    return JSON.stringify(value);
  }

  if (isCanonicalArray(value)) {
    return `[${value.map((entry) => stableCanonicalJson(entry)).join(",")}]`;
  }

  if (isCanonicalObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key] ?? null)}`)
      .join(",")}}`;
  }

  throw new Error("unsupported canonical JSON value");
}

export function canonicalLayoutSnapshotJson(snapshot: CanonicalLayoutSnapshotV0): string {
  return stableCanonicalJson(normalizeCanonicalLayoutSnapshot(snapshot) as CanonicalJsonValue);
}

function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

const SHA256_INITIAL_STATE = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8Bytes(input) : input;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bitLength = bytes.length * 8;
  const dataView = new DataView(padded.buffer);
  dataView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  dataView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = dataView.getUint32(offset + index * 4);
    }

    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;

    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 =
        ((h ?? 0) +
          bigSigma1 +
          choice +
          (SHA256_ROUND_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const bigSigma0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + (a ?? 0)) >>> 0;
    state[1] = ((state[1] ?? 0) + (b ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) + (c ?? 0)) >>> 0;
    state[3] = ((state[3] ?? 0) + (d ?? 0)) >>> 0;
    state[4] = ((state[4] ?? 0) + (e ?? 0)) >>> 0;
    state[5] = ((state[5] ?? 0) + (f ?? 0)) >>> 0;
    state[6] = ((state[6] ?? 0) + (g ?? 0)) >>> 0;
    state[7] = ((state[7] ?? 0) + (h ?? 0)) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function canonicalLayoutSnapshotDigest(snapshot: CanonicalLayoutSnapshotV0): string {
  return sha256Hex(
    `${CANONICAL_LAYOUT_SNAPSHOT_DOMAIN_PREFIX}${canonicalLayoutSnapshotJson(snapshot)}`,
  );
}

export const CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE: CanonicalLayoutSnapshotV0 = {
  schemaVersion: CANONICAL_LAYOUT_SNAPSHOT_V0_SCHEMA_VERSION,
  configurationId: "11111111-1111-4111-8111-111111111111",
  venueId: "22222222-2222-4222-8222-222222222222",
  spaceId: "33333333-3333-4333-8333-333333333333",
  layoutName: "Grand Hall saved dinner layout",
  layoutStyle: "dinner-rounds",
  visibility: "private",
  guestCount: 120,
  createdFromConfigurationUpdatedAt: "2026-06-07T10:00:00.000Z",
  createdBy: "44444444-4444-4444-8444-444444444444",
  snapshotCreatedAt: "2026-06-07T10:05:00.000Z",
  sourceState: "saved_configuration",
  units: {
    lengthUnit: "metre",
    angleUnit: "radian",
    timeUnit: "iso8601_utc_timestamp",
    currency: "GBP",
  },
  tolerancePolicy: {
    positionPrecisionM: 0.001,
    rotationPrecisionRad: 0.00001,
    scalePrecision: 0.001,
    floorContainmentToleranceM: 0.01,
    clearanceToleranceM: 0.01,
    currencyPrecisionMinorUnit: 1,
  },
  eventMetadata: {
    eventType: "dinner",
    guestCount: 120,
    preferredDate: null,
    startTime: null,
    endTime: null,
    specialInstructions: null,
  },
  scenarioAssumptions: [
    {
      category: "guest_count",
      value: 120,
      source: "planner_input",
      sourceReference: "configuration.guestCount",
    },
    {
      category: "seating_style",
      value: "dinner-rounds",
      source: "planner_input",
      sourceReference: "configuration.layoutStyle",
    },
  ],
  venueRuntime: {
    venueId: "22222222-2222-4222-8222-222222222222",
    venueSlug: "trades-hall",
    spaceId: "33333333-3333-4333-8333-333333333333",
    spaceSlug: "grand-hall",
    spaceName: "Grand Hall",
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10.5 },
      { x: 0, y: 10.5 },
    ],
    floorPlanOutlineDigest: null,
    spaceDimensions: {
      width: 21,
      length: 10.5,
      height: 7,
    },
    roomGeometrySource: "space_floor_plan_outline",
    runtimeVenueManifestDigest: null,
    runtimePackageId: null,
  },
  policyBundle: {
    policyBundleId: "trades-hall-planning-draft-v0",
    policyBundleDigest: null,
    policyBundleVersion: "0.0.0",
    effectiveFrom: null,
    effectiveTo: null,
    jurisdiction: "Scotland planning evidence draft",
    venueRuleSet: "trades-hall-draft",
    humanReviewRequiredFor: ["egress_planning", "accessibility_planning"],
  },
  generatorProvenance: {
    generatorType: "human",
    generatorName: null,
    generatorVersion: null,
    promptDigest: null,
    sourceTemplateId: null,
    humanEditedAfterGeneration: false,
    generatedAt: null,
  },
  objects: [
    {
      objectId: "55555555-5555-4555-8555-555555555555",
      assetDefinition: {
        assetDefinitionId: "66666666-6666-4666-8666-666666666666",
        category: "table",
        widthM: 1.83,
        depthM: 1.83,
        heightM: 0.75,
        seatCount: 10,
        collisionType: "circle",
      },
      position: { x: 5.1234, y: 0, z: 4.9876 },
      rotation: { x: 0, y: 0.123456, z: 0 },
      scale: 1.0004,
      sortOrder: 2,
      groupId: null,
      metadata: {
        phase: "dinner",
      },
    },
    {
      objectId: "77777777-7777-4777-8777-777777777777",
      assetDefinition: {
        assetDefinitionId: "88888888-8888-4888-8888-888888888888",
        category: "chair",
        widthM: 0.45,
        depthM: 0.5,
        heightM: 0.9,
        seatCount: 1,
        collisionType: "box",
      },
      position: { x: 7, y: 0, z: 4 },
      rotation: { x: 0, y: 1.570796, z: 0 },
      scale: 1,
      sortOrder: 1,
      groupId: "group_table_1",
      metadata: {
        side: "north",
      },
    },
  ],
};

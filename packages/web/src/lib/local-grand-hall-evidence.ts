import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import { z } from "zod";

export const LOCAL_GRAND_HALL_EVIDENCE_QUERY_PARAM = "localRoomEvidence";
export const LOCAL_GRAND_HALL_EVIDENCE_SCHEMA_VERSION =
  "omnitwin.local-foundry.room-evidence-candidate.v0";
export const LOCAL_GRAND_HALL_PRESENTATION_MANIFEST_SHA256 =
  "sha256:9b23c1d0777be1f4bc320ac3ebbde6f24eea72dc08cb743e204653f106f77344";

const EXPECTED_DESCRIPTOR_PATH = "/api/local-room-evidence-candidate";
const EXPECTED_MEMBER_PATH_PREFIX =
  "/api/local-room-evidence-candidate/members/";
const EXPECTED_TWIN_PATH_PREFIX =
  "/api/local-room-evidence-candidate/twin/";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SUFFIX_PATTERN = /^[a-z0-9]{2,8}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const GRAND_HALL_OWNER_ATTESTATION =
  "The operator attests that the customer owns all supplied venue data and derivatives, whether commissioned, created, or captured by the customer, and authorizes their use for all Venviewer product purposes, including internal development, customer-facing experiences, derived assets, model-assisted reconstruction, publication, and distribution.";

// Updated together with the gateway once the final all-source descriptor is
// sealed. Keeping this as a named constant makes an accidental regex-only
// candidate binding impossible to miss in review.
export const LOCAL_GRAND_HALL_EVIDENCE_CANDIDATE_DIGEST =
  "sha256:8491c7d8c2dbbf7179d560a4c835ac4315c483e51d76a059a4d4bbd4d4018e4d";
export const LOCAL_GRAND_HALL_EVIDENCE_ATTESTATION_SHA256 =
  "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb";

const PinnedMemberSchema = z.object({
  memberId: z.string().regex(MEMBER_ID_PATTERN),
  role: z.string().min(1).max(96),
  mediaType: z.string().min(1).max(96),
  suffix: z.string().regex(SUFFIX_PATTERN),
  sha256: z.string().regex(SHA256_PATTERN),
  sizeBytes: z.number().int().positive().max(96 * 1024 * 1024),
  url: z.string().url().max(2_048),
  authority: z.literal("none"),
  alignment: z.enum(["unregistered", "source_manifest_frame_only"]),
  provenance: z.string().min(1).max(160),
  width: z.number().int().positive().max(16_384).optional(),
  height: z.number().int().positive().max(8_192).optional(),
  classification: z.string().min(1).max(96).optional(),
  vertexCount: z.number().int().nonnegative().max(10_000_000).optional(),
  faceCount: z.number().int().nonnegative().max(20_000_000).optional(),
}).strict();

const SourceInventorySchema = z.object({
  sourceId: z.string().min(1).max(96),
  state: z.enum([
    "present_all_52_current_bytes_validated",
    "present_manifest_and_all_448_current_member_bytes_validated",
    "present_current_paths_sizes_matched_audit_hashes_not_recomputed",
    "present_stage_manifest_and_inspection_validated_e57_obj_sizes_matched_large_member_hashes_not_recomputed",
  ]),
  fileCount: z.number().int().positive(),
  totalBytes: z.number().int().positive(),
  manifestSha256: z.string().regex(SHA256_PATTERN).optional(),
}).strict();

const ReferenceIdentitySchema = z.object({
  id: z.string().min(1).max(96),
  sizeBytes: z.number().int().nonnegative(),
  recordedSha256: z.string().regex(SHA256_PATTERN),
  verificationState: z.enum([
    "audit_sha256_recorded_current_size_matched_hash_not_recomputed",
    "manifest_verified_current_size_matched_hash_not_recomputed",
  ]),
  mediaType: z.string().min(1).max(96),
  role: z.string().min(1).max(96),
  state: z.literal("inventory_only"),
  authority: z.literal("none"),
  alignment: z.literal("unregistered"),
  reason: z.string().min(1).max(320),
}).strict();

const BtreeIdentitySchema = z.object({
  id: z.string().regex(/^\d+(?:_\d+){3}\.btree$/u),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_PATTERN),
  mediaType: z.literal("application/octet-stream"),
  role: z.literal("vendor_spatial_index"),
}).strict();

const BtreeReferenceSchema = z.object({
  id: z.literal("lcc2-btree-indexes"),
  state: z.literal("inventory_only_current_bytes_validated_not_streamed"),
  count: z.literal(14),
  identities: z.array(BtreeIdentitySchema).length(14),
  authority: z.literal("none"),
  reason: z.literal(
    "No reviewed browser decoder; mesh PLY siblings are granted separately.",
  ),
}).strict();

const SogIdentitySchema = z.object({
  id: z.string().regex(/^(?:env|\d+(?:_\d+)+)\.sog$/u),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_PATTERN),
  mediaType: z.literal("application/x-sog"),
  role: z.enum(["captured_visual_splat", "excluded_environment_splat"]),
}).strict();

const SogReferenceSchema = z.object({
  id: z.literal("lcc2-sog-inventory"),
  state: z.literal("current_bytes_validated"),
  count: z.literal(19),
  selectedRenderableCount: z.literal(7),
  identities: z.array(SogIdentitySchema).length(19),
  authority: z.literal("none"),
  reason: z.literal(
    "Seven room-only members are selected by the subordinate SOG descriptor; ancestor, alternate-LOD, and environment members remain unstreamed.",
  ),
}).strict();

const StageReferenceSchema = z.object({
  id: z.literal("matterport-e57-stage"),
  state: z.literal("inventory_only"),
  manifestSha256: z.literal(
    "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff",
  ),
  manifestSizeBytes: z.literal(50_122),
  inspectionSha256: z.literal(
    "sha256:368a4fc7799470feadac5820485854b9093c8b7de2f5ab2fc2288f2777c815c8",
  ),
  inspectionSizeBytes: z.literal(6_099_107),
  verificationState: z.literal(
    "stage_manifest_and_inspection_current_bytes_validated_large_members_size_matched_hash_not_recomputed",
  ),
  fileCount: z.literal(156),
  totalBytes: z.literal(22_277_494_876),
  role: z.literal("immutable_capture_stage"),
  authority: z.literal("none"),
  reason: z.literal(
    "The stage ledger is retained as provenance; large raw members are not exposed by this bounded review gateway.",
  ),
}).strict();

const RejectedReferenceSchema = z.object({
  id: z.literal("brush-splat-ply-series"),
  state: z.literal("rejected"),
  reason: z.string().min(1).max(320),
  authority: z.literal("none"),
}).strict();

const HistoricalReferenceSchema = z.object({
  id: z.literal("historical-colmap-cubefaces"),
  state: z.literal("inventory_only"),
  rawManifestSha256: z.literal(
    "sha256:af47826e91d9cbbac0730019d3c2349ec5534fe4daafe9ac1975ebea4492a4c4",
  ),
  canonicalManifestSha256: z.literal(
    "sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89",
  ),
  manifestSizeBytes: z.literal(638_899),
  memberCount: z.literal(300),
  role: z.literal("historical_source_imagery"),
  reason: z.string().min(1).max(320),
  authority: z.literal("none"),
}).strict();

const ReferenceOnlySchema = z.union([
  BtreeReferenceSchema,
  SogReferenceSchema,
  ReferenceIdentitySchema,
  StageReferenceSchema,
  RejectedReferenceSchema,
  HistoricalReferenceSchema,
]);

const PipelineSlotSchema = z.object({
  id: z.enum([
    "registered_metric_room_mesh",
    "e57_bounded_room_crop",
    "obj_normalized_room_glb",
    "movable_object_mask",
  ]),
  state: z.literal("not_produced"),
  reason: z.string().min(1).max(320),
}).strict();

const SubordinateSogMemberSchema = z.object({
  memberId: z.string().regex(MEMBER_ID_PATTERN),
  relativePath: z.string().min(1).max(192),
  sha256: z.string().regex(SHA256_PATTERN),
  sizeBytes: z.number().int().positive().max(16 * 1024 * 1024),
  splatCount: z.number().int().positive().max(1_000_000),
}).strict();

const SubordinateSogTierSchema = z.object({
  id: z.enum(["desktop", "mobile"]),
  memberCount: z.number().int().min(3).max(4),
  splatCount: z.number().int().positive().max(3_000_000),
  sizeBytes: z.number().int().positive().max(48 * 1024 * 1024),
  members: z.array(SubordinateSogMemberSchema).min(3).max(4),
}).strict();

export const LocalGrandHallEvidenceDescriptorSchema = z.object({
  schemaVersion: z.literal(LOCAL_GRAND_HALL_EVIDENCE_SCHEMA_VERSION),
  candidateId: z.literal("grand-hall-owner-authorized-local-evidence-v1"),
  candidateRevision: z.literal(1),
  candidateDigest: z.string().regex(SHA256_PATTERN),
  profileDigest: z.string().regex(SHA256_PATTERN),
  profile: z.record(z.string(), z.unknown()),
  runtimeRegistration: z.literal("not_registered"),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  usage: z.literal("local_multimodal_review"),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    domain: z.literal("VENVIEWER_LOCAL_GRAND_HALL_ROOM_EVIDENCE_CANDIDATE_V0"),
    canonicalization: z.literal(
      "utf8_json_recursive_lexicographic_object_keys_array_order_preserved",
    ),
  }).strict(),
  rights: z.object({
    basis: z.literal("customer_owned"),
    evidenceState: z.literal("operator_supplied_unverified"),
    evidenceStateMeaning: z.literal(
      "provenance_authentication_state_only_not_a_use_limitation",
    ),
    attestationStatement: z.string().min(1).max(512),
    attestationSha256: z.string().regex(SHA256_PATTERN),
    licensedUse: z.literal("authorized_for_all_venviewer_product_purposes"),
    publicationAndDistributionRights: z.literal("owner_authorized"),
    licensingBlocker: z.literal(false),
    runtimeActivation: z.literal(
      "technically_inactive_pending_alignment_qa_and_promotion",
    ),
  }).strict(),
  authority: z.object({
    appearance: z.literal("local_unreviewed_candidate"),
    geometry: z.literal("none"),
    placement: z.literal("none"),
    measurement: z.literal("none"),
    collision: z.literal("none"),
    export: z.literal("none"),
  }).strict(),
  alignment: z.object({
    state: z.literal("sources_not_registered"),
    canonicalFrame: z.null(),
    transforms: z.tuple([]),
    operationalAuthority: z.literal("none"),
  }).strict(),
  sources: z.array(SourceInventorySchema).length(4),
  presentations: z.object({
    splat: z.object({
      state: z.literal("renderable"),
      descriptorUrl: z.string().url().max(2_048),
      usage: z.literal("appearance_only"),
      candidateId: z.literal("grand-hall-small-lcc2-8539a478-v1"),
      candidateRevision: z.literal(1),
      candidateDigest: z.literal(
        "sha256:1a2303e1d3c850d85e078edf966f3b10c9e06d7a8134403302a18e78f7a45b00",
      ),
      manifestSha256: z.literal(
        "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d",
      ),
      frontierReceiptSha256: z.literal(
        "sha256:fb6c12052b4029457c28e812b8d3290553415e5e69e9ae31cb08ad92d1a5d5f1",
      ),
      tiers: z.array(SubordinateSogTierSchema).length(2),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    panoramaWalk: z.object({
      state: z.literal("renderable"),
      sourceId: z.literal("trades-hall-twin-0"),
      assetBaseUrl: z.string().url().max(2_048),
      sourceManifestSha256: z.literal(
        "sha256:96b5448ae8fbb706d85530a288b9462c7eca4ea8f8d9ff668058954901996220",
      ),
      sourceManifestSizeBytes: z.literal(136_368),
      sourceManifestMemberCount: z.literal(448),
      grantedMemberCount: z.literal(148),
      presentationManifestSha256: z.literal(
        LOCAL_GRAND_HALL_PRESENTATION_MANIFEST_SHA256,
      ),
      presentationManifest: TwinManifestSchema,
      projectionPolicy: z.literal(
        "ordered_scan_000_through_scan_048_edges_with_both_endpoints_in_subset_147_panorama_members_plus_one_mesh",
      ),
      projectionReason: z.literal(
        "Only the verified Grand Hall node subset is admitted to this bounded presentation lease.",
      ),
      defaultLod: z.literal(4096),
      maxAutomaticLod: z.literal(4096),
      manualLod: z.literal(8192),
      manualLodReason: z.literal(
        "8192×4096 equirectangles are granted for one-at-a-time zoom intent only; they are never the automatic default.",
      ),
      sourceDeclaredTier: z.literal("ops-grade-2cm"),
      sourceDeclaredTierAdoptedAsOperationalAuthority: z.literal(false),
      authority: z.literal("none"),
      alignment: z.literal("source_manifest_frame_only"),
    }).strict(),
    venueContextMesh: PinnedMemberSchema.extend({
      state: z.literal("renderable"),
    }).strict(),
    meshReview: z.object({
      state: z.literal("reference_only"),
      members: z.array(PinnedMemberSchema).length(15),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    capturedImages: z.object({
      state: z.literal("renderable"),
      reason: z.null(),
      members: z.array(PinnedMemberSchema).length(5),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    unclassifiedImages: z.object({
      state: z.literal("renderable"),
      reason: z.null(),
      members: z.array(PinnedMemberSchema).length(1),
      lineage: z.literal("operator_supplied_reference_lineage_unverified"),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    generatedImages: z.object({
      state: z.literal("renderable"),
      reason: z.null(),
      members: z.array(PinnedMemberSchema).length(1),
      provenance: z.literal(
        "embedded_c2pa_claim_inspected_not_cryptographically_validated_trained_algorithmic_media_openai",
      ),
      persistentBadge: z.literal("GENERATED"),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    videoReference: z.object({
      state: z.literal("renderable"),
      member: PinnedMemberSchema,
      provenanceClass: z.literal("edited_reference_video"),
      lineage: z.literal("capture_or_generation_lineage_unverified"),
      playback: z.literal("manual_only"),
      preload: z.literal("metadata"),
      reportedMetadata: z.object({
        codec: z.literal("h264"),
        width: z.literal(1920),
        height: z.literal(1080),
        framesPerSecond: z.literal(60),
        durationSeconds: z.literal(9.37),
        audio: z.literal("stereo_lpcm"),
        producingSoftware: z.literal("Blackmagic Design DaVinci Resolve"),
      }).strict(),
      authority: z.literal("none"),
      alignment: z.literal("unregistered"),
    }).strict(),
    reports: z.object({
      state: z.literal("reference_only"),
      members: z.array(PinnedMemberSchema).length(2),
      poseCount: z.literal(2_894),
      authority: z.literal("none"),
    }).strict(),
  }).strict(),
  referenceOnly: z.array(ReferenceOnlySchema).length(19),
  pipelineReadySlots: z.array(PipelineSlotSchema).length(4),
  capabilities: z.object({
    localReview: z.literal(true),
    publicationRights: z.literal(true),
    publicationRuntimeActive: z.literal(false),
    exportRights: z.literal(true),
    operationalExportActive: z.literal(false),
    measurement: z.literal(false),
    placement: z.literal(false),
    collision: z.literal(false),
    activation: z.literal(false),
  }).strict(),
}).strict();

const LocalGrandHallEvidenceLeaseMemberSchema = z.object({
  memberId: z.string().regex(MEMBER_ID_PATTERN),
  suffix: z.string().regex(SUFFIX_PATTERN),
  url: z.string().url().max(2_048),
}).strict();

const LocalGrandHallEvidenceWireSchema = z.object({
  schemaVersion: z.literal(LOCAL_GRAND_HALL_EVIDENCE_SCHEMA_VERSION),
  candidateId: z.literal("grand-hall-owner-authorized-local-evidence-v1"),
  candidateRevision: z.literal(1),
  candidateDigest: z.literal(LOCAL_GRAND_HALL_EVIDENCE_CANDIDATE_DIGEST),
  profileDigest: z.literal(LOCAL_GRAND_HALL_EVIDENCE_CANDIDATE_DIGEST),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    domain: z.literal("VENVIEWER_LOCAL_GRAND_HALL_ROOM_EVIDENCE_CANDIDATE_V0"),
    canonicalization: z.literal(
      "utf8_json_recursive_lexicographic_object_keys_array_order_preserved",
    ),
  }).strict(),
  profile: z.record(z.string(), z.unknown()),
  leases: z.object({
    splatDescriptorUrl: z.string().url().max(2_048),
    panoramaAssetBaseUrl: z.string().url().max(2_048),
    venueContextMeshUrl: z.string().url().max(2_048),
    members: z.array(LocalGrandHallEvidenceLeaseMemberSchema).length(26),
  }).strict(),
}).strict();

export type LocalGrandHallEvidenceDescriptor = z.infer<
  typeof LocalGrandHallEvidenceDescriptorSchema
>;
export type LocalGrandHallEvidenceMember = z.infer<typeof PinnedMemberSchema>;
export type LocalGrandHallEvidenceReference = z.infer<
  typeof ReferenceOnlySchema
>;

export type LocalGrandHallEvidenceRequest =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "ready"; readonly descriptorUrl: string };

const MAX_NORMALIZED_DATA_NODES = 8_192;
const MAX_NORMALIZED_STRING_UNITS = 512 * 1024;

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new Error("The descriptor contains an accessor or a missing field.");
  }
  return descriptor.value;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The descriptor contains a non-record object.");
  }
  const prototype: unknown = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("The descriptor contains a non-data object.");
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("The descriptor field is not an array.");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.value !== length
  ) {
    throw new Error("The descriptor array exceeds its exact bounded shape.");
  }
  return value;
}

function recordKeyCount(value: unknown, count: number): void {
  const record = dataRecord(value);
  if (Object.keys(Object.getOwnPropertyDescriptors(record)).length !== count) {
    throw new Error("The descriptor record exceeds its exact bounded shape.");
  }
}

function cheapExactShapePreflight(value: unknown): void {
  const root = dataRecord(value);
  const profile = dataRecord(ownDataValue(root, "profile"));
  exactArray(ownDataValue(profile, "sources"), 4);
  exactArray(ownDataValue(profile, "referenceOnly"), 19);
  exactArray(ownDataValue(profile, "pipelineReadySlots"), 4);

  const presentations = dataRecord(ownDataValue(profile, "presentations"));
  const splat = dataRecord(ownDataValue(presentations, "splat"));
  const tiers = exactArray(ownDataValue(splat, "tiers"), 2);
  exactArray(ownDataValue(dataRecord(ownDataValue(tiers, "0")), "members"), 4);
  exactArray(ownDataValue(dataRecord(ownDataValue(tiers, "1")), "members"), 3);
  exactArray(
    ownDataValue(dataRecord(ownDataValue(presentations, "meshReview")), "members"),
    15,
  );
  exactArray(
    ownDataValue(dataRecord(ownDataValue(presentations, "capturedImages")), "members"),
    5,
  );
  exactArray(
    ownDataValue(dataRecord(ownDataValue(presentations, "unclassifiedImages")), "members"),
    1,
  );
  exactArray(
    ownDataValue(dataRecord(ownDataValue(presentations, "generatedImages")), "members"),
    1,
  );
  exactArray(
    ownDataValue(dataRecord(ownDataValue(presentations, "reports")), "members"),
    2,
  );
  const panorama = dataRecord(ownDataValue(presentations, "panoramaWalk"));
  const manifest = dataRecord(ownDataValue(panorama, "presentationManifest"));
  exactArray(ownDataValue(manifest, "nodes"), 49);
  exactArray(ownDataValue(manifest, "edges"), 109);
  recordKeyCount(ownDataValue(manifest, "contentHashes"), 148);

  const sourceLedger = dataRecord(ownDataValue(profile, "sourceLedger"));
  const lcc2 = dataRecord(ownDataValue(sourceLedger, "lcc2"));
  exactArray(ownDataValue(lcc2, "members"), 51);
  const subordinate = dataRecord(ownDataValue(lcc2, "subordinateSog"));
  const profileTiers = exactArray(ownDataValue(subordinate, "tiers"), 2);
  exactArray(
    ownDataValue(dataRecord(ownDataValue(profileTiers, "0")), "members"),
    4,
  );
  exactArray(
    ownDataValue(dataRecord(ownDataValue(profileTiers, "1")), "members"),
    3,
  );
  const twin = dataRecord(ownDataValue(sourceLedger, "twin"));
  exactArray(ownDataValue(twin, "sourceMembers"), 448);
  const profileManifest = dataRecord(ownDataValue(twin, "presentationManifest"));
  exactArray(ownDataValue(profileManifest, "nodes"), 49);
  exactArray(ownDataValue(profileManifest, "edges"), 109);
  recordKeyCount(ownDataValue(profileManifest, "contentHashes"), 148);
  const xgrids = dataRecord(ownDataValue(sourceLedger, "xgrids"));
  exactArray(ownDataValue(xgrids, "members"), 12);
  const leases = dataRecord(ownDataValue(root, "leases"));
  exactArray(ownDataValue(leases, "members"), 26);
}

interface CloneBudget {
  nodes: number;
  stringUnits: number;
}

function cloneBoundedJsonData(
  value: unknown,
  budget: CloneBudget,
  depth = 0,
): unknown {
  if (depth > 32) throw new Error("The descriptor data is nested too deeply.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("The descriptor contains a non-finite number.");
    return value;
  }
  if (typeof value === "string") {
    budget.stringUnits += value.length;
    if (budget.stringUnits > MAX_NORMALIZED_STRING_UNITS) {
      throw new Error("The descriptor string data exceeds its safety limit.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error("The descriptor contains a non-JSON value.");
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_NORMALIZED_DATA_NODES) {
    throw new Error("The descriptor data exceeds its object safety limit.");
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      lengthDescriptor.value > 512
    ) {
      throw new Error("The descriptor array is too large.");
    }
    const length = lengthDescriptor.value;
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw new Error("The descriptor array is sparse or contains an accessor.");
      }
      clone.push(cloneBoundedJsonData(descriptor.value, budget, depth + 1));
    }
    if (
      Object.keys(descriptors).some(
        (key) => key !== "length" && !/^\d+$/u.test(key),
      )
    ) {
      throw new Error("The descriptor array has non-index properties.");
    }
    return clone;
  }
  const record = dataRecord(value);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const keys = Object.keys(descriptors);
  if (Reflect.ownKeys(record).some((key) => typeof key !== "string")) {
    throw new Error("The descriptor record contains a symbol key.");
  }
  if (keys.length > 512) throw new Error("The descriptor record is too large.");
  if (keys.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw new Error("The descriptor record contains a prototype-control key.");
  }
  const clone = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new Error("The descriptor record contains an accessor.");
    }
    Object.defineProperty(clone, key, {
      value: cloneBoundedJsonData(descriptor.value, budget, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone;
}

function normalizedDescriptorData(value: unknown): unknown {
  try {
    cheapExactShapePreflight(value);
    return cloneBoundedJsonData(value, { nodes: 0, stringUnits: 0 });
  } catch {
    throw new Error(
      "The local room-evidence descriptor is not safe data with the exact bounded shape.",
    );
  }
}

interface PinnedMemberIdentity {
  readonly memberId: string;
  readonly role: string;
  readonly mediaType: string;
  readonly suffix: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly alignment: "unregistered" | "source_manifest_frame_only";
  readonly provenance: string;
  readonly width?: number;
  readonly height?: number;
  readonly classification?: string;
  readonly vertexCount?: number;
  readonly faceCount?: number;
}

const MESH_REVIEW_MEMBERS: readonly PinnedMemberIdentity[] = [
  ["mesh-0-0-0-0", 104_947, "8e806d3ec8c0b17623b05986b4ccd0d5a2bf9822f3f1ff0388ce990c4cce91c9", 4_030, 4_337],
  ["mesh-0-0-0-1", 102_266, "a57a102518ab9837f9b7daebc27f55a6c59c9f8cead83cb5c1811a4869ad80db", 3_799, 4_344],
  ["mesh-0-1-0-0", 144_256, "ad347ac9d5cb1570a2a026fe5d4f8dbcd2a5734b8f5c1f87e480d6a97aed9dc2", 5_164, 6_314],
  ["mesh-0-1-0-1", 59_494, "1336c3033e9d2db7038907b694a5d1f230275b94cc0fce0b925a95abd84148c1", 2_228, 2_504],
  ["mesh-0-2-0-0", 106_255, "8a350100ea2f30c1f0d6cf145afa6cef7f8eaa2f6571f0941be317013784c064", 4_373, 4_121],
  ["mesh-0-2-0-1", 36_926, "e36efdc9c27766d894b2ccb805f306bae83897b11bac1737944999f67b1ce092", 1_474, 1_464],
  ["mesh-0-3-0-0", 107_961, "6757f389ae1dcae7151ef577081e226543d4e41520e8712ad73a016678f90569", 4_500, 4_135],
  ["mesh-0-3-0-1", 53_074, "3f5921c381f6d8377c3735144895d8c913b072b69dfd0c92758341fb3ef6bee4", 2_018, 2_204],
  ["mesh-0-4-0-0", 57_704, "f6c0a766127c43f32620067416cf1c1da89c58cb9b2b9a99283a959e0306498d", 2_367, 2_238],
  ["mesh-0-4-0-1", 147_368, "0f3aec59336a83463f56464afd052a46217d5866c796552bb4e407d2c57767d0", 5_744, 6_018],
  ["mesh-0-5-0-0", 210_201, "d3ffca0ce8867e01ba9167ba49b6c601acbfb827e0016cbbf6aa36ea74cd9a0c", 7_105, 9_595],
  ["mesh-0-6-0-0", 212_218, "9970b7e1e6931c3443c1032bfb652c4ae894cb6e7b99bc1698c4483f2fd8efb5", 8_052, 8_876],
  ["mesh-0-7-0-0", 54_261, "773f5961c7ab00953f6951e641e847434657cc7c783c21dea95708d463265b91", 2_313, 2_023],
  ["mesh-0-7-0-1", 163_566, "430411019ba33888dacc0182b5882700785826428d540912bbbf488e13ca4ac0", 5_770, 7_240],
].map(([memberId, sizeBytes, digest, vertexCount, faceCount]) => ({
  memberId: String(memberId),
  role: "unregistered_reference_mesh_chunk",
  mediaType: "application/octet-stream",
  suffix: "ply",
  sha256: `sha256:${String(digest)}`,
  sizeBytes: Number(sizeBytes),
  alignment: "unregistered" as const,
  provenance: "xgrids_lcc2_validated_manifest_bundle",
  vertexCount: Number(vertexCount),
  faceCount: Number(faceCount),
})).concat({
  memberId: "lcc2-reference-obj",
  role: "unregistered_reference_geometry",
  mediaType: "model/obj",
  suffix: "obj",
  sha256: "sha256:3ff14dc72ce1c2d6e23c3a32062d2f1866c47411616ef1c080eb8345b427026e",
  sizeBytes: 2_003_946,
  alignment: "unregistered",
  provenance: "xgrids_lcc2_mesh_export",
  vertexCount: 29_562,
  faceCount: 57_191,
});

const CAPTURED_IMAGE_MEMBERS: readonly PinnedMemberIdentity[] = [
  ["reference-grand-hall-room", "jpg", "image/jpeg", 530_489, "d57068f806f1d0d826a55b9cc2c19a63523fc47d71d326375d23427352e7905a", 1_535, 1_024, "captured_reference_image"],
  ["reference-grand-hall-dark", "jpg", "image/jpeg", 187_509, "d1973ea03f25251106780b1e8cf0825a457fb6355cc77b764132ed57c26af45f", 1_672, 941, "captured_reference_image"],
  ["reference-grand-hall-scaled", "jpg", "image/jpeg", 441_993, "1a12a119faf4621d48efeec7c51ff061e9c06c33ef2d8f9007341952e72351bb", 1_400, 934, "captured_reference_image"],
  ["reference-grand-hall-facade", "jpg", "image/jpeg", 2_723_505, "cfe61807deb0dbae2bdeaee7abf4617d6fd7523c004e6763914c0c7c47d69601", 1_400, 990, "venue_exterior_reference_image"],
  ["reference-grand-hall-floorplan", "png", "image/png", 53_188, "532c8bc1f3a18a81aac246234ae401facd3e4d33645393d5d58dfba9bd752aad", 1_000, 644, "reference_floorplan_image"],
].map(([memberId, suffix, mediaType, sizeBytes, digest, width, height, classification]) => ({
  memberId: String(memberId),
  role: String(classification),
  mediaType: String(mediaType),
  suffix: String(suffix),
  sha256: `sha256:${String(digest)}`,
  sizeBytes: Number(sizeBytes),
  alignment: "unregistered" as const,
  provenance: "venviewer_public_reference_media_exact_bytes",
  width: Number(width),
  height: Number(height),
  classification: String(classification),
}));

const UNCLASSIFIED_IMAGE_MEMBERS: readonly PinnedMemberIdentity[] = [{
  memberId: "operator-grand-hall-reference-image",
  role: "operator_supplied_reference_image",
  mediaType: "image/jpeg",
  suffix: "jpg",
  sha256: "sha256:93d3d926f28f0f5fad0d04f8e7f6db196f5c8849c6392a491d9cf7dd71853e53",
  sizeBytes: 566_888,
  alignment: "unregistered",
  provenance: "operator_supplied_reference_lineage_unverified",
  width: 1_500,
  height: 1_001,
  classification: "capture_lineage_unverified",
}];

const GENERATED_IMAGE_MEMBERS: readonly PinnedMemberIdentity[] = [{
  memberId: "operator-generated-grand-hall-reference",
  role: "generated_reference_image",
  mediaType: "image/png",
  suffix: "png",
  sha256: "sha256:9ecae501d7de555fb9669d5ef1223045cac7fe1f4a0a8243ac037da0dadbf49d",
  sizeBytes: 2_667_303,
  alignment: "unregistered",
  provenance: "embedded_c2pa_claim_inspected_not_cryptographically_validated_trained_algorithmic_media_openai",
  width: 1_122,
  height: 1_402,
  classification: "generated_reference_image",
}];

const VIDEO_MEMBER: PinnedMemberIdentity = {
  memberId: "edited-trades-hall-reference-video",
  role: "edited_reference_video",
  mediaType: "video/quicktime",
  suffix: "mov",
  sha256: "sha256:e0c0e4e63e6466cc2649e274a067c29848ae9c6c9ca993fd56413659b9e579da",
  sizeBytes: 75_597_063,
  alignment: "unregistered",
  provenance: "operator_supplied_edited_reference_export",
  classification: "capture_or_generation_lineage_unverified",
};

const REPORT_MEMBERS: readonly PinnedMemberIdentity[] = [{
  memberId: "lcc2-poses",
  role: "unregistered_camera_poses",
  mediaType: "application/json",
  suffix: "json",
  sha256: "sha256:9025889ae00a8aa36350f1596fb536cf323c3e5eefa865b063053cac99de2006",
  sizeBytes: 345_181,
  alignment: "unregistered",
  provenance: "xgrids_lcc2_export",
}, {
  memberId: "lcc2-report",
  role: "capture_report",
  mediaType: "application/json",
  suffix: "json",
  sha256: "sha256:4cadcc8ec2b4aca3ceb9ba0a32d868089b3dd1590c21f501dd3470372c423212",
  sizeBytes: 545,
  alignment: "unregistered",
  provenance: "xgrids_lcc2_export",
}];

const VENUE_CONTEXT_MESH: PinnedMemberIdentity = {
  memberId: "twin-dollhouse-mesh",
  role: "venue_context_mesh",
  mediaType: "model/gltf-binary",
  suffix: "glb",
  sha256: "sha256:21ee097393cdaf80d5924a876fc73cbf149c0d4b050bcb56011dad2e1dd3aa9a",
  sizeBytes: 7_342_964,
  alignment: "source_manifest_frame_only",
  provenance: "verified_trades_hall_twin_0_source_manifest",
};

function descriptorUrlError(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "The local room-evidence descriptor URL is invalid.";
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port.length === 0
  ) {
    return "The local room-evidence descriptor must use an explicit IPv4 loopback HTTP origin and port.";
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    return "The local room-evidence descriptor URL cannot contain credentials or a fragment.";
  }
  if (url.pathname !== EXPECTED_DESCRIPTOR_PATH) {
    return "The local room-evidence descriptor path is not supported.";
  }
  const keys = [...url.searchParams.keys()];
  const token = url.searchParams.get("token") ?? "";
  if (keys.length !== 1 || keys[0] !== "token" || !TOKEN_PATTERN.test(token)) {
    return "The local room-evidence descriptor requires one valid ephemeral token.";
  }
  return null;
}

export function localGrandHallEvidenceRequestFromSearchParams(
  searchParams: URLSearchParams,
  developmentEnabled: boolean,
): LocalGrandHallEvidenceRequest {
  const values = searchParams.getAll(LOCAL_GRAND_HALL_EVIDENCE_QUERY_PARAM);
  if (values.length === 0) return { kind: "none" };
  if (!developmentEnabled) {
    return {
      kind: "invalid",
      message: "Local room evidence is disabled outside development builds.",
    };
  }
  if (values.length !== 1) {
    return {
      kind: "invalid",
      message: "Exactly one local room-evidence descriptor may be requested.",
    };
  }
  const descriptorUrl = values[0]?.trim() ?? "";
  if (descriptorUrl.length === 0 || descriptorUrl.length > 2_048) {
    return {
      kind: "invalid",
      message: "The local room-evidence descriptor URL is empty or too long.",
    };
  }
  const error = descriptorUrlError(descriptorUrl);
  return error === null
    ? { kind: "ready", descriptorUrl }
    : { kind: "invalid", message: error };
}

function assertSessionUrl(
  rawUrl: string,
  descriptorUrl: URL,
  expectedPath: string,
  label: string,
): URL {
  const url = new URL(rawUrl);
  if (
    url.origin !== descriptorUrl.origin ||
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.pathname !== expectedPath
  ) {
    throw new Error(`${label} is outside its exact local session route.`);
  }
  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== 1 ||
    keys[0] !== "token" ||
    url.searchParams.get("token") !== descriptorUrl.searchParams.get("token")
  ) {
    throw new Error(`${label} does not carry the descriptor session token.`);
  }
  return url;
}

function assertMemberUrl(
  member: LocalGrandHallEvidenceMember,
  descriptorUrl: URL,
): void {
  assertSessionUrl(
    member.url,
    descriptorUrl,
    `${EXPECTED_MEMBER_PATH_PREFIX}${encodeURIComponent(member.memberId)}.${member.suffix}`,
    `Evidence member ${member.memberId}`,
  );
}

function assertSplatDescriptorUrl(rawUrl: string, descriptorUrl: URL): void {
  assertSessionUrl(
    rawUrl,
    descriptorUrl,
    "/api/local-sog-candidate",
    "The nested SOG descriptor",
  );
}

function assertTwinAssetBase(rawUrl: string, descriptorUrl: URL): void {
  const url = new URL(rawUrl);
  const token = descriptorUrl.searchParams.get("token") ?? "";
  const expectedPath = `${EXPECTED_TWIN_PATH_PREFIX}${encodeURIComponent(token)}/`;
  if (
    url.origin !== descriptorUrl.origin ||
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0 ||
    url.pathname !== expectedPath
  ) {
    throw new Error("The Twin asset base is outside its exact path-token session lease.");
  }
}

function assertNormalizedTwinAssetBase(rawUrl: string, descriptorUrl: URL): void {
  const url = new URL(rawUrl);
  const token = descriptorUrl.searchParams.get("token") ?? "";
  const expectedPath = `${EXPECTED_TWIN_PATH_PREFIX}${encodeURIComponent(token)}`;
  if (
    url.origin !== descriptorUrl.origin ||
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0 ||
    url.pathname !== expectedPath
  ) {
    throw new Error("The normalized Twin asset base is outside its exact path-token session lease.");
  }
}

function assertTwinMemberUrl(
  rawUrl: string,
  descriptorUrl: URL,
  relativePath: string,
): void {
  const token = descriptorUrl.searchParams.get("token") ?? "";
  const url = new URL(rawUrl);
  const expectedPath =
    `${EXPECTED_TWIN_PATH_PREFIX}${encodeURIComponent(token)}/${relativePath}`;
  if (
    url.origin !== descriptorUrl.origin ||
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0 ||
    url.pathname !== expectedPath
  ) {
    throw new Error("The venue-context mesh is outside its exact Twin session lease.");
  }
}

function comparableMember(member: LocalGrandHallEvidenceMember): PinnedMemberIdentity {
  return {
    memberId: member.memberId,
    role: member.role,
    mediaType: member.mediaType,
    suffix: member.suffix,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    alignment: member.alignment,
    provenance: member.provenance,
    ...(member.width === undefined ? {} : { width: member.width }),
    ...(member.height === undefined ? {} : { height: member.height }),
    ...(member.classification === undefined
      ? {}
      : { classification: member.classification }),
    ...(member.vertexCount === undefined
      ? {}
      : { vertexCount: member.vertexCount }),
    ...(member.faceCount === undefined ? {} : { faceCount: member.faceCount }),
  };
}

function assertPinnedMembers(
  actual: readonly LocalGrandHallEvidenceMember[],
  expected: readonly PinnedMemberIdentity[],
  label: string,
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label} does not contain the exact pinned member count.`);
  }
  actual.forEach((member, index) => {
    const expectedMember = expected[index];
    if (
      expectedMember === undefined ||
      JSON.stringify(comparableMember(member)) !== JSON.stringify(expectedMember)
    ) {
      throw new Error(`${label} member ${String(index)} does not match its exact identity.`);
    }
  });
}

function assertPresentationManifest(manifest: TwinManifest): void {
  if (
    manifest.venueSlug !== "trades-hall" ||
    manifest.name !== "Trades Hall Glasgow — Grand Hall review subset" ||
    manifest.capture.kind !== "matterport-e57" ||
    manifest.capture.scanCount !== 49 ||
    manifest.tier !== "ops-grade-2cm" ||
    manifest.imagery !== "equirect" ||
    manifest.nodes.length !== 49 ||
    manifest.edges.length !== 109 ||
    manifest.entryNodeId !== "scan_000" ||
    manifest.mesh?.path !== "mesh/dollhouse.glb" ||
    manifest.mesh.bytes !== 7_342_964 ||
    manifest.mesh.sourceName !== "trades-hall-dollhouse-reviewed.glb"
  ) {
    throw new Error("The Twin presentation manifest is not the exact Grand Hall subset.");
  }
  const ids = new Set<string>();
  for (const [index, node] of manifest.nodes.entries()) {
    const expectedId = `scan_${String(index).padStart(3, "0")}`;
    if (node.id !== expectedId || node.index !== index || ids.has(node.id)) {
      throw new Error("The Twin presentation node order or identity changed.");
    }
    ids.add(node.id);
  }
  if (manifest.edges.some((edge) => !ids.has(edge.a) || !ids.has(edge.b))) {
    throw new Error("The Twin presentation graph escapes the Grand Hall node subset.");
  }
  const hashes = manifest.contentHashes ?? {};
  const expectedPaths = ["mesh/dollhouse.glb"];
  for (const id of ids) {
    for (const lod of [512, 4096, 8192] as const) {
      expectedPaths.push(`tiles/${id}/equirect_${String(lod)}.webp`);
    }
  }
  if (
    Object.keys(hashes).length !== 148 ||
    expectedPaths.some(
      (path) => hashes[path] === undefined || !/^[0-9a-f]{64}$/u.test(hashes[path]),
    )
  ) {
    throw new Error("The Twin presentation member inventory changed.");
  }
}

function assertSources(candidate: LocalGrandHallEvidenceDescriptor): void {
  const expected = [
    ["grand-hall-small-lcc2", "present_all_52_current_bytes_validated", 52, 182_313_418, "sha256:f4ba054a560ec86fa75d623d10924ba6bf00c6790745137ec4a2c144a64da12d"],
    ["trades-hall-twin-0", "present_manifest_and_all_448_current_member_bytes_validated", 449, 576_580_078, "sha256:96b5448ae8fbb706d85530a288b9462c7eca4ea8f8d9ff668058954901996220"],
    ["raw-xgrids-portalcam", "present_current_paths_sizes_matched_audit_hashes_not_recomputed", 12, 5_637_931_654, undefined],
    ["matterport-e57-stage", "present_stage_manifest_and_inspection_validated_e57_obj_sizes_matched_large_member_hashes_not_recomputed", 156, 22_277_494_876, "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff"],
  ] as const;
  const actual = candidate.sources.map((source) => [
    source.sourceId,
    source.state,
    source.fileCount,
    source.totalBytes,
    source.manifestSha256,
  ] as const);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The all-source Grand Hall evidence inventory changed.");
  }
}

function assertReferenceInventory(
  candidate: LocalGrandHallEvidenceDescriptor,
): void {
  const ids = candidate.referenceOnly.map((item) => item.id);
  const expectedIds = [
    "lcc2-btree-indexes",
    "lcc2-sog-inventory",
    "portalcam-xbin",
    "portalcam-control-points",
    "portalcam-gnss",
    "portalcam-ulg",
    "portalcam-lixel",
    "portalcam-project",
    "portalcam-hierarchy",
    "portalcam-log",
    "portalcam-metadata",
    "portalcam-octree",
    "portalcam-poses",
    "portalcam-preview",
    "matterport-e57",
    "matterpak-obj",
    "matterport-e57-stage",
    "brush-splat-ply-series",
    "historical-colmap-cubefaces",
  ];
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    throw new Error("The reference-only Grand Hall evidence inventory changed.");
  }
  const identityPins = new Map<string, readonly [number, string, string, string]>([
    ["portalcam-xbin", [5_587_927_040, "sha256:a7cc3b3198385e62598301f529a9df8dbc9b5b26e5ff8aad98a6ae58dd378d2c", "application/x-xgrids-xbin", "raw_portalcam_capture"]],
    ["portalcam-control-points", [0, "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "text/csv", "control_points"]],
    ["portalcam-gnss", [823_731, "sha256:6ca560af782965315b00c616cbedd8a25950c23099a095437e9cb577b47d0494", "text/csv", "gnss_trajectory"]],
    ["portalcam-ulg", [7_631_121, "sha256:e212e38f815182d9e17947cff2e9cd944996ede521037a05bad99392ed41c723", "application/octet-stream", "flight_log"]],
    ["portalcam-lixel", [34_676_446, "sha256:0ab6ef2350a071d7ccdcad8c22fa5853eb47bac58ff6fa809172efc5ad521dd3", "application/zip", "vendor_archive"]],
    ["portalcam-project", [2_415, "sha256:fc5f59bf39a90cdea9c1529d446dbf708fe56d56928ae589de25894d085163ef", "application/json", "project_metadata"]],
    ["portalcam-hierarchy", [4_708, "sha256:5ed241c3db8e02c42026e1f983870a55d44978e36125efb67977171fd0bab711", "application/octet-stream", "vendor_hierarchy"]],
    ["portalcam-log", [22_541, "sha256:2496228c6d1630b8589e754236041d5839cab1d62ae9e0f1e3adace8fcf154bd", "text/plain", "processing_log"]],
    ["portalcam-metadata", [1_299, "sha256:466839fd562a5ba838dc6d1e8d26072d581b8cde7796d9849b04d344fc3cc7ab", "application/json", "capture_metadata"]],
    ["portalcam-octree", [6_080_872, "sha256:fa2c8d21ae72ab0cb6b25191e4a381522b96ab00368ad9083c4b2a3727f2a077", "application/octet-stream", "vendor_octree"]],
    ["portalcam-poses", [496_660, "sha256:c9088c482e29ddfee315de1030ad1d0dd7bd998804d9484ca45bc64c9b8d1ccd", "text/csv", "camera_trajectory"]],
    ["portalcam-preview", [264_821, "sha256:502092cd4569f470fd810481cf028f2772373e346fc5f1c63081543a87a21afc", "image/jpeg", "capture_preview"]],
    ["matterport-e57", [20_518_437_888, "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd", "model/e57", "metric_point_cloud_capture"]],
    ["matterpak-obj", [38_381_816, "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7", "model/obj", "venue_wide_reference_geometry"]],
  ]);
  for (const item of candidate.referenceOnly) {
    const pin = identityPins.get(item.id);
    if (pin === undefined) continue;
    if (!("sizeBytes" in item) || !("recordedSha256" in item)) {
      throw new Error(`Reference identity ${item.id} lost its immutable binding.`);
    }
    if (
      item.sizeBytes !== pin[0] ||
      item.recordedSha256 !== pin[1] ||
      item.mediaType !== pin[2] ||
      item.role !== pin[3]
    ) {
      throw new Error(`Reference identity ${item.id} does not match its pinned bytes.`);
    }
    const expectedReason = item.id === "portalcam-xbin"
      ? "No reviewed local XBIN decoder; the audited SHA is recorded and current size matched, but the 5.6 GB file was not rehashed at gateway startup."
      : item.id.startsWith("portalcam-")
        ? "Raw PortalCam sidecar retained for provenance; not required by a reviewed browser renderer."
        : item.id === "matterport-e57"
          ? "Raw 20.5 GB E57 is inventory-only; the browser requires a bounded reviewed derivative."
          : "Large venue-wide OBJ and external texture set remain inventory-only; the recorded SHA comes from the validated stage manifest and current size matched, but bytes were not rehashed at gateway startup.";
    const expectedVerification = item.id === "matterport-e57" || item.id === "matterpak-obj"
      ? "manifest_verified_current_size_matched_hash_not_recomputed"
      : "audit_sha256_recorded_current_size_matched_hash_not_recomputed";
    if (
      item.reason !== expectedReason ||
      item.verificationState !== expectedVerification
    ) {
      throw new Error(`Reference identity ${item.id} changed its verification disclosure.`);
    }
  }
  const btree = candidate.referenceOnly[0];
  if (btree?.id !== "lcc2-btree-indexes" || !("identities" in btree)) {
    throw new Error("The LCC2 spatial-index evidence is missing.");
  }
  const expectedBtreeIdentities = [
    ["0_0_0_0.btree", 20_896, "sha256:e87cce2bfdf99e16274577d3fed8e5339c2450936c8162bceb44627d6afd718d"],
    ["0_0_0_1.btree", 21_536, "sha256:67ad3100f1eb404065e3a8693178545c7b7fbbc360d57decc753b44cee81a19c"],
    ["0_1_0_0.btree", 30_240, "sha256:e8e61d2c7b84eeb3dec0215bb9f80c089ad48f523d51e26213a8823666ee4115"],
    ["0_1_0_1.btree", 11_808, "sha256:6e2901ba1cf46df40aceabf41d44064fd47df99b135723d4d70282358d8f7bb1"],
    ["0_2_0_0.btree", 19_808, "sha256:88ae80450fbbdf5ec6f1c09ca631736b33676dc353f03070de77b13c68f2f5e4"],
    ["0_2_0_1.btree", 7_328, "sha256:7756fe3463405dc9ab49a5119e4bf2ed1f5e876e9e4ed8921f8b8f0dae7deb27"],
    ["0_3_0_0.btree", 20_192, "sha256:a6b4cda28ecb9e7f731158a313c169d4be0e8252e5e3511db5acde4c70ec2635"],
    ["0_3_0_1.btree", 10_464, "sha256:2dafe5346c4cab0e124311a7e448a085de95947b77d9e5948011276a4f92092e"],
    ["0_4_0_0.btree", 10_976, "sha256:1327e2e763ef6fec4a9e62c1c28999c26db2cfe27cd6edbfa00dd04762791b61"],
    ["0_4_0_1.btree", 28_192, "sha256:5c0f5b4d1979f363031ad5bc1159641a9a5aac3dcf20f97c64f2a85d4fd352d0"],
    ["0_5_0_0.btree", 44_896, "sha256:c220fea7f9864c243a7b7d888d9ad8a507f074daede20d53892ffe85a97f1c6d"],
    ["0_6_0_0.btree", 43_232, "sha256:c757c0d65bf264ffae1df9776c85ed7fd7c06a1fa5f29365a5affee2a810a34f"],
    ["0_7_0_0.btree", 9_760, "sha256:2041ebd710142a35aeeb5ece793ecfd39cfebaf79899d093f19332c335fef370"],
    ["0_7_0_1.btree", 34_848, "sha256:2f39e3d5b727982348f857974c24437a2ef718856d683449b85bbc139f5ad615"],
  ];
  const actualBtreeIdentities = btree.identities.map((item) => [
    item.id,
    item.sizeBytes,
    item.sha256,
  ]);
  if (JSON.stringify(actualBtreeIdentities) !== JSON.stringify(expectedBtreeIdentities)) {
    throw new Error("The LCC2 spatial-index identities changed.");
  }
  const sog = candidate.referenceOnly[1];
  if (sog?.id !== "lcc2-sog-inventory" || !("identities" in sog)) {
    throw new Error("The LCC2 SOG evidence inventory is missing.");
  }
  const sogIds = sog.identities.map((item) => item.id);
  if (
    sogIds.length !== 19 ||
    sogIds.at(-1) !== "env.sog" ||
    new Set(sogIds).size !== 19
  ) {
    throw new Error("The LCC2 SOG evidence inventory changed.");
  }
}

function assertPipelineSlots(candidate: LocalGrandHallEvidenceDescriptor): void {
  const ids = candidate.pipelineReadySlots.map((slot) => slot.id);
  if (JSON.stringify(ids) !== JSON.stringify([
    "registered_metric_room_mesh",
    "e57_bounded_room_crop",
    "obj_normalized_room_glb",
    "movable_object_mask",
  ])) {
    throw new Error("The Grand Hall technical pipeline-slot ledger changed.");
  }
}

function descriptorMemberProfileValue(
  member: LocalGrandHallEvidenceMember,
): Readonly<Record<string, unknown>> {
  return {
    memberId: member.memberId,
    sizeBytes: member.sizeBytes,
    sha256: member.sha256,
    suffix: member.suffix,
    mediaType: member.mediaType,
    role: member.role,
    authority: member.authority,
    alignment: member.alignment,
    provenance: member.provenance,
    ...(member.width === undefined ? {} : { width: member.width }),
    ...(member.height === undefined ? {} : { height: member.height }),
    ...(member.classification === undefined
      ? {}
      : { classification: member.classification }),
    ...(member.vertexCount === undefined
      ? {}
      : { vertexCount: member.vertexCount }),
    ...(member.faceCount === undefined ? {} : { faceCount: member.faceCount }),
  };
}

function profileMemberValue(value: unknown): Readonly<Record<string, unknown>> {
  const member = dataRecord(value);
  return {
    memberId: member["memberId"],
    sizeBytes: member["sizeBytes"],
    sha256: member["sha256"],
    suffix: member["suffix"],
    mediaType: member["mediaType"],
    role: member["role"],
    authority: member["authority"],
    alignment: member["alignment"],
    provenance: member["provenance"],
    ...(member["width"] === undefined ? {} : { width: member["width"] }),
    ...(member["height"] === undefined ? {} : { height: member["height"] }),
    ...(member["classification"] === undefined
      ? {}
      : { classification: member["classification"] }),
    ...(member["vertexCount"] === undefined
      ? {}
      : { vertexCount: member["vertexCount"] }),
    ...(member["faceCount"] === undefined
      ? {}
      : { faceCount: member["faceCount"] }),
  };
}

function profileField(
  profile: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  if (!(key in profile)) throw new Error(`The exact evidence profile is missing ${key}.`);
  return profile[key];
}

function assertCanonicalEqual(actual: unknown, expected: unknown, label: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not mirror the sealed evidence profile.`);
  }
}

function assertDescriptorMirrorsProfile(
  candidate: LocalGrandHallEvidenceDescriptor,
): void {
  const profile = candidate.profile;
  if (Object.hasOwn(profile, "sourceLedger")) {
    const withoutSessionLeaseValues = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(withoutSessionLeaseValues);
      if (value === null || typeof value !== "object") return value;
      const record = value as Readonly<Record<string, unknown>>;
      const stable = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key === "url" || key === "descriptorUrl" || key === "assetBaseUrl") {
          continue;
        }
        Object.defineProperty(stable, key, {
          value: withoutSessionLeaseValues(record[key]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return stable;
    };
    assertCanonicalEqual(candidate.rights, profileField(profile, "rights"), "Rights disclosure");
    assertCanonicalEqual(
      candidate.authority,
      profileField(profile, "authority"),
      "Operational authority disclosure",
    );
    assertCanonicalEqual(
      candidate.alignment,
      profileField(profile, "alignment"),
      "Alignment disclosure",
    );
    assertCanonicalEqual(candidate.sources, profileField(profile, "sources"), "Source inventory");
    assertCanonicalEqual(
      withoutSessionLeaseValues(candidate.presentations),
      profileField(profile, "presentations"),
      "Multimodal presentations",
    );
    assertCanonicalEqual(
      candidate.referenceOnly,
      profileField(profile, "referenceOnly"),
      "Reference-only inventory",
    );
    assertCanonicalEqual(
      candidate.pipelineReadySlots,
      profileField(profile, "pipelineReadySlots"),
      "Pipeline-ready slots",
    );
    assertCanonicalEqual(
      candidate.capabilities,
      profileField(profile, "capabilities"),
      "Technical capabilities",
    );
    return;
  }
  const profileRights = dataRecord(profileField(profile, "rights"));
  assertCanonicalEqual(
    {
      basis: candidate.rights.basis,
      evidenceState: candidate.rights.evidenceState,
      attestationStatement: candidate.rights.attestationStatement,
      attestationSha256: candidate.rights.attestationSha256,
      licensedUse: candidate.rights.licensedUse,
      publicationAndDistributionRights:
        candidate.rights.publicationAndDistributionRights,
      licensingBlocker: candidate.rights.licensingBlocker,
    },
    profileRights,
    "Rights disclosure",
  );

  const splat = candidate.presentations.splat;
  assertCanonicalEqual(
    {
      candidateId: splat.candidateId,
      candidateRevision: splat.candidateRevision,
      candidateDigest: splat.candidateDigest,
      manifestSha256: splat.manifestSha256,
      frontierReceiptSha256: splat.frontierReceiptSha256,
      tiers: splat.tiers,
    },
    profileField(profile, "subordinateSog"),
    "Subordinate SOG presentation",
  );

  const twin = dataRecord(profileField(profile, "twin"));
  const panorama = candidate.presentations.panoramaWalk;
  assertCanonicalEqual(
    panorama.presentationManifest,
    profileField(twin, "presentationManifest"),
    "Panorama presentation manifest",
  );
  if (
    panorama.presentationManifestSha256 !==
      profileField(twin, "presentationManifestSha256") ||
    panorama.sourceManifestSha256 !== profileField(twin, "sourceManifestSha256") ||
    panorama.sourceManifestSizeBytes !== profileField(twin, "sourceManifestSizeBytes") ||
    panorama.sourceManifestMemberCount !== profileField(twin, "sourceManifestMemberCount")
  ) {
    throw new Error("Panorama presentation metadata does not mirror the sealed profile.");
  }
  const twinMembers = exactArray(profileField(twin, "members"), 148);
  const twinMesh = twinMembers.find(
    (value) => dataRecord(value)["role"] === "venue_context_mesh",
  );
  if (twinMesh === undefined) throw new Error("The sealed Twin profile has no context mesh.");
  assertCanonicalEqual(
    descriptorMemberProfileValue(candidate.presentations.venueContextMesh),
    profileMemberValue(twinMesh),
    "Venue context mesh",
  );

  const lcc2 = dataRecord(profileField(profile, "lcc2"));
  const lcc2Members = exactArray(profileField(lcc2, "members"), 18);
  const btreeReference = candidate.referenceOnly.find(
    (item) => item.id === "lcc2-btree-indexes",
  );
  const sogReference = candidate.referenceOnly.find(
    (item) => item.id === "lcc2-sog-inventory",
  );
  if (
    btreeReference?.id !== "lcc2-btree-indexes" ||
    !("identities" in btreeReference) ||
    sogReference?.id !== "lcc2-sog-inventory" ||
    !("identities" in sogReference)
  ) {
    throw new Error("The subordinate LCC2 inventory ledgers are missing.");
  }
  const profileInventoryIdentity = (value: unknown): Readonly<Record<string, unknown>> => {
    const item = dataRecord(value);
    return {
      id: item["id"],
      sizeBytes: item["sizeBytes"],
      sha256: item["sha256"],
      mediaType: item["mediaType"],
      role: item["role"],
    };
  };
  assertCanonicalEqual(
    btreeReference.identities,
    exactArray(profileField(lcc2, "btreeInventory"), 14).map(
      profileInventoryIdentity,
    ),
    "LCC2 spatial-index ledger",
  );
  assertCanonicalEqual(
    sogReference.identities,
    exactArray(profileField(lcc2, "sogInventory"), 19).map(
      profileInventoryIdentity,
    ),
    "LCC2 SOG ledger",
  );
  const profileMeshes = lcc2Members
    .filter((value) => {
      const suffix = dataRecord(value)["suffix"];
      return suffix === "ply" || suffix === "obj";
    })
    .map(profileMemberValue);
  const profileReports = lcc2Members
    .filter((value) => dataRecord(value)["suffix"] === "json")
    .map(profileMemberValue);
  assertCanonicalEqual(
    candidate.presentations.meshReview.members.map(descriptorMemberProfileValue),
    profileMeshes,
    "Mesh review members",
  );
  assertCanonicalEqual(
    candidate.presentations.reports.members.map(descriptorMemberProfileValue),
    profileReports,
    "Source report members",
  );
  assertCanonicalEqual(
    candidate.presentations.capturedImages.members.map(descriptorMemberProfileValue),
    exactArray(profileField(profile, "publicImages"), 5).map(profileMemberValue),
    "Captured reference images",
  );
  assertCanonicalEqual(
    candidate.presentations.unclassifiedImages.members.map(
      descriptorMemberProfileValue,
    ),
    [profileMemberValue(profileField(profile, "externalCaptured"))],
    "Unclassified operator reference image",
  );
  assertCanonicalEqual(
    candidate.presentations.generatedImages.members.map(
      descriptorMemberProfileValue,
    ),
    [profileMemberValue(profileField(profile, "externalGenerated"))],
    "Generated reference image",
  );
  assertCanonicalEqual(
    descriptorMemberProfileValue(candidate.presentations.videoReference.member),
    profileMemberValue(profileField(profile, "externalVideo")),
    "Edited reference video",
  );
  assertCanonicalEqual(
    candidate.pipelineReadySlots,
    profileField(profile, "pipelineReadySlots"),
    "Pipeline-ready slots",
  );
  const brush = candidate.referenceOnly.find(
    (item) => item.id === "brush-splat-ply-series",
  );
  const historical = candidate.referenceOnly.find(
    (item) => item.id === "historical-colmap-cubefaces",
  );
  assertCanonicalEqual(brush, profileField(profile, "brushLedger"), "Brush ledger");
  assertCanonicalEqual(
    historical,
    profileField(profile, "historicalColmapLedger"),
    "Historical imagery ledger",
  );
}

function assertExactProfile(
  candidate: LocalGrandHallEvidenceDescriptor,
  descriptorUrl: URL,
): void {
  if (
    candidate.candidateDigest !== LOCAL_GRAND_HALL_EVIDENCE_CANDIDATE_DIGEST ||
    candidate.rights.attestationStatement !== GRAND_HALL_OWNER_ATTESTATION ||
    candidate.rights.attestationSha256 !== LOCAL_GRAND_HALL_EVIDENCE_ATTESTATION_SHA256
  ) {
    throw new Error("The room-evidence candidate seal or owner attestation changed.");
  }
  assertSources(candidate);
  assertPresentationManifest(
    candidate.presentations.panoramaWalk.presentationManifest,
  );
  assertSplatDescriptorUrl(candidate.presentations.splat.descriptorUrl, descriptorUrl);
  assertNormalizedTwinAssetBase(candidate.presentations.panoramaWalk.assetBaseUrl, descriptorUrl);
  assertPinnedMembers(
    [candidate.presentations.venueContextMesh],
    [VENUE_CONTEXT_MESH],
    "Venue context mesh",
  );
  assertTwinMemberUrl(
    candidate.presentations.venueContextMesh.url,
    descriptorUrl,
    "mesh/dollhouse.glb",
  );
  assertPinnedMembers(
    candidate.presentations.meshReview.members,
    MESH_REVIEW_MEMBERS,
    "Mesh review",
  );
  assertPinnedMembers(
    candidate.presentations.capturedImages.members,
    CAPTURED_IMAGE_MEMBERS,
    "Captured images",
  );
  assertPinnedMembers(
    candidate.presentations.unclassifiedImages.members,
    UNCLASSIFIED_IMAGE_MEMBERS,
    "Unclassified operator reference images",
  );
  assertPinnedMembers(
    candidate.presentations.generatedImages.members,
    GENERATED_IMAGE_MEMBERS,
    "Generated images",
  );
  assertPinnedMembers(
    [candidate.presentations.videoReference.member],
    [VIDEO_MEMBER],
    "Edited reference video",
  );
  assertPinnedMembers(
    candidate.presentations.reports.members,
    REPORT_MEMBERS,
    "Source reports",
  );
  const streamMembers = [
    ...candidate.presentations.meshReview.members,
    ...candidate.presentations.capturedImages.members,
    ...candidate.presentations.unclassifiedImages.members,
    ...candidate.presentations.generatedImages.members,
    candidate.presentations.videoReference.member,
    ...candidate.presentations.reports.members,
  ];
  const ids = new Set<string>();
  for (const member of streamMembers) {
    assertMemberUrl(member, descriptorUrl);
    if (ids.has(member.memberId)) {
      throw new Error(`Evidence member ${member.memberId} is duplicated.`);
    }
    ids.add(member.memberId);
  }
  assertReferenceInventory(candidate);
  assertPipelineSlots(candidate);
  assertDescriptorMirrorsProfile(candidate);
}

export function parseLocalGrandHallEvidenceDescriptor(
  value: unknown,
  descriptorUrlString: string,
): LocalGrandHallEvidenceDescriptor {
  const requestError = descriptorUrlError(descriptorUrlString);
  if (requestError !== null) throw new Error(requestError);
  const descriptorUrl = new URL(descriptorUrlString);
  const wire = LocalGrandHallEvidenceWireSchema.parse(
    normalizedDescriptorData(value),
  );
  const profile = wire.profile;
  const presentations = dataRecord(profileField(profile, "presentations"));
  const sourceLedger = dataRecord(profileField(profile, "sourceLedger"));
  const lcc2Ledger = dataRecord(profileField(sourceLedger, "lcc2"));
  const leasesById = new Map<string, { readonly suffix: string; readonly url: string }>();

  for (const lease of wire.leases.members) {
    if (leasesById.has(lease.memberId)) {
      throw new Error(`Evidence member ${lease.memberId} has duplicate session leases.`);
    }
    assertSessionUrl(
      lease.url,
      descriptorUrl,
      `${EXPECTED_MEMBER_PATH_PREFIX}${encodeURIComponent(lease.memberId)}.${lease.suffix}`,
      `Evidence member ${lease.memberId}`,
    );
    leasesById.set(lease.memberId, lease);
  }

  const expectedLeasedMembers = [
    ...exactArray(profileField(lcc2Ledger, "members"), 51)
      .map((member) => dataRecord(member))
      .filter((member) => typeof member["memberId"] === "string"),
    ...exactArray(
      profileField(
        dataRecord(profileField(presentations, "capturedImages")),
        "members",
      ),
      5,
    ).map((member) => dataRecord(member)),
    ...exactArray(
      profileField(
        dataRecord(profileField(presentations, "unclassifiedImages")),
        "members",
      ),
      1,
    ).map((member) => dataRecord(member)),
    ...exactArray(
      profileField(
        dataRecord(profileField(presentations, "generatedImages")),
        "members",
      ),
      1,
    ).map((member) => dataRecord(member)),
    dataRecord(
      profileField(
        dataRecord(profileField(presentations, "videoReference")),
        "member",
      ),
    ),
  ];
  if (expectedLeasedMembers.length !== 26) {
    throw new Error("The evidence profile does not declare the exact leased member set.");
  }
  const expectedLeaseIds = new Set<string>();
  for (const member of expectedLeasedMembers) {
    const memberId = profileField(member, "memberId");
    const suffix = profileField(member, "suffix");
    if (
      typeof memberId !== "string" ||
      typeof suffix !== "string" ||
      expectedLeaseIds.has(memberId) ||
      leasesById.get(memberId)?.suffix !== suffix
    ) {
      throw new Error("The evidence session leases do not match the sealed profile members.");
    }
    expectedLeaseIds.add(memberId);
  }
  if (
    expectedLeaseIds.size !== leasesById.size ||
    [...leasesById.keys()].some((memberId) => !expectedLeaseIds.has(memberId))
  ) {
    throw new Error("The evidence session leases contain an unsealed member.");
  }

  const resolveMember = (memberValue: unknown): Readonly<Record<string, unknown>> => {
    const member = dataRecord(memberValue);
    const memberId = profileField(member, "memberId");
    if (typeof memberId !== "string") {
      throw new Error("A sealed evidence member has no valid member identity.");
    }
    const lease = leasesById.get(memberId);
    if (lease === undefined) {
      throw new Error(`Evidence member ${memberId} has no exact session lease.`);
    }
    return { ...member, url: lease.url };
  };
  const resolveMemberArray = (
    containerValue: unknown,
    length: number,
  ): readonly Readonly<Record<string, unknown>>[] => {
    const container = dataRecord(containerValue);
    return exactArray(profileField(container, "members"), length).map(resolveMember);
  };

  assertSplatDescriptorUrl(wire.leases.splatDescriptorUrl, descriptorUrl);
  assertTwinAssetBase(wire.leases.panoramaAssetBaseUrl, descriptorUrl);
  assertTwinMemberUrl(
    wire.leases.venueContextMeshUrl,
    descriptorUrl,
    "mesh/dollhouse.glb",
  );
  const splat = dataRecord(profileField(presentations, "splat"));
  const panoramaWalk = dataRecord(profileField(presentations, "panoramaWalk"));
  const venueContextMesh = dataRecord(
    profileField(presentations, "venueContextMesh"),
  );
  const meshReview = dataRecord(profileField(presentations, "meshReview"));
  const capturedImages = dataRecord(profileField(presentations, "capturedImages"));
  const unclassifiedImages = dataRecord(
    profileField(presentations, "unclassifiedImages"),
  );
  const generatedImages = dataRecord(
    profileField(presentations, "generatedImages"),
  );
  const videoReference = dataRecord(
    profileField(presentations, "videoReference"),
  );
  const reports = dataRecord(profileField(presentations, "reports"));
  const candidate = LocalGrandHallEvidenceDescriptorSchema.parse({
    schemaVersion: wire.schemaVersion,
    candidateId: wire.candidateId,
    candidateRevision: wire.candidateRevision,
    candidateDigest: wire.candidateDigest,
    profileDigest: wire.profileDigest,
    profile,
    runtimeRegistration: profileField(profile, "runtimeRegistration"),
    venueSlug: profileField(profile, "venueSlug"),
    roomSlug: profileField(profile, "roomSlug"),
    usage: profileField(profile, "usage"),
    integrity: profileField(profile, "integrity"),
    rights: profileField(profile, "rights"),
    authority: profileField(profile, "authority"),
    alignment: profileField(profile, "alignment"),
    sources: profileField(profile, "sources"),
    presentations: {
      splat: { ...splat, descriptorUrl: wire.leases.splatDescriptorUrl },
      panoramaWalk: {
        ...panoramaWalk,
        // The strict gateway lease is a directory URL and therefore ends in
        // `/`; the established Twin path helpers add their own separator.
        // Expose one canonical separator to prevent a rejected `//tiles/...`
        // request without weakening the raw lease assertion above.
        assetBaseUrl: wire.leases.panoramaAssetBaseUrl.slice(0, -1),
      },
      venueContextMesh: {
        ...venueContextMesh,
        url: wire.leases.venueContextMeshUrl,
      },
      meshReview: {
        ...meshReview,
        members: resolveMemberArray(meshReview, 15),
      },
      capturedImages: {
        ...capturedImages,
        members: resolveMemberArray(capturedImages, 5),
      },
      unclassifiedImages: {
        ...unclassifiedImages,
        members: resolveMemberArray(unclassifiedImages, 1),
      },
      generatedImages: {
        ...generatedImages,
        members: resolveMemberArray(generatedImages, 1),
      },
      videoReference: {
        ...videoReference,
        member: resolveMember(profileField(videoReference, "member")),
      },
      reports: {
        ...reports,
        members: resolveMemberArray(reports, 2),
      },
    },
    referenceOnly: profileField(profile, "referenceOnly"),
    pipelineReadySlots: profileField(profile, "pipelineReadySlots"),
    capabilities: profileField(profile, "capabilities"),
  });
  if (
    profileField(profile, "schemaVersion") !== wire.schemaVersion ||
    profileField(profile, "candidateId") !== wire.candidateId ||
    profileField(profile, "candidateRevision") !== wire.candidateRevision ||
    canonicalJson(profileField(profile, "integrity")) !==
      canonicalJson(wire.integrity)
  ) {
    throw new Error("The descriptor envelope does not mirror its sealed profile.");
  }
  assertExactProfile(candidate, descriptorUrl);
  return candidate;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyLocalGrandHallPresentationManifest(
  candidate: LocalGrandHallEvidenceDescriptor,
): Promise<void> {
  const subtle = globalThis.crypto.subtle;
  const profileBytes = new TextEncoder().encode(
    `${candidate.integrity.domain}\n${canonicalJson(candidate.profile)}`,
  );
  const profileDigest = `sha256:${hex(await subtle.digest("SHA-256", profileBytes))}`;
  if (
    profileDigest !== candidate.profileDigest ||
    profileDigest !== candidate.candidateDigest ||
    profileDigest !== LOCAL_GRAND_HALL_EVIDENCE_CANDIDATE_DIGEST
  ) {
    throw new Error("The local room-evidence profile digest does not match its exact grant.");
  }
  const bytes = new TextEncoder().encode(
    canonicalJson(candidate.presentations.panoramaWalk.presentationManifest),
  );
  const digest = `sha256:${hex(await subtle.digest("SHA-256", bytes))}`;
  if (
    digest !== candidate.presentations.panoramaWalk.presentationManifestSha256
  ) {
    throw new Error("The local Twin presentation manifest digest does not match its exact grant.");
  }
}

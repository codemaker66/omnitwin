import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  GRAND_HALL_EXACT_INTERFACE_COUNT,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GrandHallClosedBoundaryV1Schema,
  GrandHallInterfaceCandidateSchema,
  GrandHallPanoramaMaskRecordSchema,
  GrandHallPortalDecisionsV1Schema,
  computeGrandHallInterfaceInventorySha256,
  type GrandHallClosedBoundaryV1,
  type GrandHallPortalDecisionsV1,
} from "./grand-hall-room-scope-artifacts.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

export const GRAND_HALL_SCOPE_REVIEW_PACK_V2 =
  "venviewer.grand-hall-scope-review-pack.v2";
export const GRAND_HALL_T554_HUMAN_DECISIONS_V2 =
  "venviewer.grand-hall-t554-human-decisions.v2";
export const GRAND_HALL_ROOM_MEMBERSHIP_V3 =
  "omnitwin.foundry.grand-hall-room-membership.v3";
export const GRAND_HALL_PANORAMA_MASK_SET_V2 =
  "venviewer.grand-hall-panorama-mask-set.v2";
export const GRAND_HALL_PANORAMA_SOURCE_INVENTORY_V3 =
  "venviewer.grand-hall-panorama-source-inventory.v3";
export const GRAND_HALL_PANORAMA_OBSERVATION_INVENTORY_V2 =
  "venviewer.grand-hall-panorama-observation-inventory.v2";
export const GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1 =
  "venviewer.grand-hall-t554-closed-volume-review.v1";
export const GRAND_HALL_T561_OBSERVATION_INPUT_V1 =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-input.v1";
export const GRAND_HALL_T561_OBSERVATION_MANIFEST_V1 =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-pack.v1";
export const GRAND_HALL_T561_OBSERVATION_RECEIPT_V1 =
  "omnitwin.foundry.grand-hall-t561-panorama-visual-observation-receipt.v1";

const GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_DIGEST_V1 =
  "venviewer.grand-hall-t554-closed-volume-review-digest.v1";

export const GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT =
  GRAND_HALL_PANORAMA_DIRECTORY_FILE_COUNT;
export const GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT = 74;
export const GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT = 74;
export const GRAND_HALL_MISSING_SUPPLIED_SWEEP_NUMBER = 93;
export const GRAND_HALL_MAX_SUPPLIED_SWEEP_NUMBER = 149;

export const GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS = Object.freeze(
  Array.from(
    { length: GRAND_HALL_MAX_SUPPLIED_SWEEP_NUMBER },
    (_, index) => index + 1,
  ).filter((sweepNumber) => sweepNumber !== GRAND_HALL_MISSING_SUPPLIED_SWEEP_NUMBER),
);

export const GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS = Object.freeze([
  ...Array.from({ length: 61 }, (_, index) => index + 1),
  ...Array.from({ length: 11 }, (_, index) => index + 65),
  148,
  149,
]);

const OBSERVED_POSITIVE_SWEEPS = new Set<number>(
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
);
const PositiveByteLengthSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const SafeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const IsoInstantSchema = z.string().datetime({ offset: true });
function hasSafePathUnicode(value: string): boolean {
  for (const character of Array.from(value)) {
    const code = character.charCodeAt(0);
    const codePoint = character.codePointAt(0) ?? code;
    const bidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff;
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      bidiControl ||
      (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    ) return false;
  }
  return true;
}

function isSafeGrandHallRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value) ||
    !hasSafePathUnicode(value)
  ) return false;
  return value.split("/").every((segment) => {
    const windowsStem = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    return segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !/^(?:CON|PRN|AUX|NUL|COM(?:[1-9]|[¹²³])|LPT(?:[1-9]|[¹²³]))$/u.test(windowsStem);
  });
}

const SafeRelativeFileSchema = z.string().superRefine((value, ctx) => {
  if (!isSafeGrandHallRelativePath(value)) {
    addIssue(ctx, [], "file must be a canonical traversal-free POSIX relative path");
  }
});

function canonicalDigest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

export const GrandHallPanoramaSourceJpgIdentityV2Schema = z
  .object({
    inventoryIndex: z.number().int().min(0).max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT - 1),
    sweepNumber: z.number().int().min(1).max(GRAND_HALL_MAX_SUPPLIED_SWEEP_NUMBER),
    fileName: SafeRelativeFileSchema.refine(
      (value) => /\.(?:jpg|jpeg)$/iu.test(value),
      "source panorama identity must name a JPEG file",
    ),
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
  })
  .strict()
  .superRefine((source, ctx) => {
    const match = /^sweep_(\d{3,4})(?:jpg|pg)\.jpg$/u.exec(source.fileName);
    if (match === null) {
      addIssue(
        ctx,
        ["fileName"],
        "source panorama filename must use the supplied sweep_<3-or-4-digits><jpg-or-pg>.jpg form",
      );
      return;
    }
    const encodedSweepNumber = Number.parseInt(match[1] ?? "", 10);
    if (encodedSweepNumber !== source.sweepNumber) {
      addIssue(
        ctx,
        ["fileName"],
        "source panorama filename must encode the same sweep number as its identity",
      );
    }
  });

export type GrandHallPanoramaSourceJpgIdentityV2 = z.infer<
  typeof GrandHallPanoramaSourceJpgIdentityV2Schema
>;

function refineExactPanoramaSources(
  sources: readonly GrandHallPanoramaSourceJpgIdentityV2[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  sources.forEach((source, index) => {
    if (source.inventoryIndex !== index) {
      addIssue(
        ctx,
        [...path, index, "inventoryIndex"],
        "panorama sources must preserve exact zero-based directory inventory order",
      );
    }
    if (source.sweepNumber !== GRAND_HALL_SUPPLIED_PANORAMA_SWEEP_NUMBERS[index]) {
      addIssue(
        ctx,
        [...path, index, "sweepNumber"],
        "panorama sources must preserve exact sweep order 1..149 with absent sweep 93",
      );
    }
  });
  if (new Set(sources.map((source) => source.fileName)).size !== sources.length) {
    addIssue(ctx, path, "source panorama filenames must be unique");
  }
  if (new Set(sources.map((source) => source.sweepNumber)).size !== sources.length) {
    addIssue(ctx, path, "source panorama sweep numbers must be unique");
  }
}

export const GrandHallPanoramaSourceInventoryV3Schema = z
  .array(GrandHallPanoramaSourceJpgIdentityV2Schema)
  .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT)
  .superRefine((sources, ctx) => {
    refineExactPanoramaSources(sources, ctx, []);
  });

export type GrandHallPanoramaSourceInventoryV3 = z.infer<
  typeof GrandHallPanoramaSourceInventoryV3Schema
>;

function panoramaSourceInventoryV3Digest(
  sources: readonly GrandHallPanoramaSourceJpgIdentityV2[],
): string {
  return canonicalDigest(GRAND_HALL_PANORAMA_SOURCE_INVENTORY_V3, sources);
}

export function computeGrandHallPanoramaSourceInventoryV3Sha256(
  sources: readonly GrandHallPanoramaSourceJpgIdentityV2[],
): string {
  const parsed = GrandHallPanoramaSourceInventoryV3Schema.parse(sources);
  return panoramaSourceInventoryV3Digest(parsed);
}

export const GrandHallPanoramaObservationV2Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("grand_hall_pixels_observed_human_pending"),
      proposedDisposition: z.literal("include_with_binary_pixel_mask"),
      maskAuthoringState: z.literal("required_not_authored"),
    })
    .strict(),
  z
    .object({
      state: z.literal("no_grand_hall_pixels_observed_human_pending"),
      proposedDisposition: z.literal("exclude_whole_frame"),
      maskAuthoringState: z.literal("not_required_if_human_confirms_exclusion"),
    })
    .strict(),
]);

export type GrandHallPanoramaObservationV2 = z.infer<
  typeof GrandHallPanoramaObservationV2Schema
>;

export const GrandHallPanoramaObservationBindingV2Schema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    observation: GrandHallPanoramaObservationV2Schema,
  })
  .strict();

export type GrandHallPanoramaObservationBindingV2 = z.infer<
  typeof GrandHallPanoramaObservationBindingV2Schema
>;

function expectedObservationState(
  sweepNumber: number,
): GrandHallPanoramaObservationV2["state"] {
  return OBSERVED_POSITIVE_SWEEPS.has(sweepNumber)
    ? "grand_hall_pixels_observed_human_pending"
    : "no_grand_hall_pixels_observed_human_pending";
}

function refineExactObservationBindings(
  bindings: readonly GrandHallPanoramaObservationBindingV2[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  refineExactPanoramaSources(bindings.map((binding) => binding.source), ctx, path);
  bindings.forEach((binding, index) => {
    if (binding.observation.state !== expectedObservationState(binding.source.sweepNumber)) {
      addIssue(
        ctx,
        [...path, index, "observation", "state"],
        "observation must match the frozen authority-none 74/74 source review",
      );
    }
  });
}

export const GrandHallPanoramaObservationInventoryV2Schema = z
  .array(GrandHallPanoramaObservationBindingV2Schema)
  .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT)
  .superRefine((bindings, ctx) => {
    refineExactObservationBindings(bindings, ctx, []);
  });

function panoramaObservationInventoryV2Digest(
  bindings: readonly GrandHallPanoramaObservationBindingV2[],
): string {
  return canonicalDigest(GRAND_HALL_PANORAMA_OBSERVATION_INVENTORY_V2, bindings);
}

export function computeGrandHallPanoramaObservationInventoryV2Sha256(
  bindings: readonly GrandHallPanoramaObservationBindingV2[],
): string {
  const parsed = GrandHallPanoramaObservationInventoryV2Schema.parse(bindings);
  return panoramaObservationInventoryV2Digest(parsed);
}

const AuthorityNonePanoramaReviewRecordSchema = GrandHallPanoramaObservationBindingV2Schema
  .extend({
    observationBasis: z.literal("agent_visual_inspection_of_digest_bound_source_panorama"),
    humanReviewState: z.literal("pending"),
    authority: z.literal("none"),
    trainingAuthorized: z.literal(false),
    reconstructionAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    publicEvidenceAuthorized: z.literal(false),
  })
  .strict();

export type GrandHallAuthorityNonePanoramaReviewRecordV2 = z.infer<
  typeof AuthorityNonePanoramaReviewRecordSchema
>;

const ScopeReviewSourceEvidenceV2Schema = z
  .object({
    predecessorReviewPack: z
      .object({
        schemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V1),
        artifactSha256: RuntimeSha256Schema,
        relationship: z.literal("immutable_predecessor_lineage_only"),
      })
      .strict(),
    t550PendingMembershipV1Sha256: RuntimeSha256Schema,
    t551SourceEvidenceSha256: RuntimeSha256Schema,
    t551SourceReceiptSha256: RuntimeSha256Schema,
    xgridsSourceReceiptSha256: RuntimeSha256Schema,
    matterPakE57SourceReceiptSha256: RuntimeSha256Schema,
    panoramaDirectoryInventorySha256: RuntimeSha256Schema,
    boundaryReviewManifestSha256: RuntimeSha256Schema,
    interfaceTopologyAtlasManifestSha256: RuntimeSha256Schema,
    panoramaReviewManifestSha256: RuntimeSha256Schema,
    t561AuthorityNoneObservation: z
      .object({
        inputSchemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_INPUT_V1),
        manifestSchemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_MANIFEST_V1),
        receiptSchemaVersion: z.literal(GRAND_HALL_T561_OBSERVATION_RECEIPT_V1),
        manifestSha256: RuntimeSha256Schema,
        receiptSha256: RuntimeSha256Schema,
        observationSetSha256: RuntimeSha256Schema,
        sourceRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
        absentSweepNumbersWithin1To149: z.tuple([
          z.literal(GRAND_HALL_MISSING_SUPPLIED_SWEEP_NUMBER),
        ]),
        grandHallPixelsObservedCount: z.literal(
          GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
        ),
        noGrandHallPixelsObservedCount: z.literal(
          GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
        ),
        uncertainPossibleGrandHallPixelsCount: z.literal(0),
        authority: z.literal("none"),
        reviewState: z.literal("agent_observation_complete_human_pending"),
        inspection: z
          .object({
            method: z.literal("agent_visual_review_of_exact_source_file"),
            displayedWidthPx: z.literal(2_048),
            displayedHeightPx: z.literal(1_024),
            displayMayHaveBeenResampled: z.literal(true),
            nativeResolutionHumanReviewCompleted: z.literal(false),
            humanAcceptanceRecorded: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    legacy50By98PartitionUsed: z.literal(false),
  })
  .strict();

const ObservationSummaryV2Schema = z
  .object({
    sourceRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    grandHallPixelsObservedHumanPendingCount: z.literal(
      GRAND_HALL_OBSERVED_POSITIVE_PANORAMA_COUNT,
    ),
    noGrandHallPixelsObservedHumanPendingCount: z.literal(
      GRAND_HALL_NO_OBSERVED_PIXEL_PANORAMA_COUNT,
    ),
    humanPendingCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
  })
  .strict();

const GrandHallScopeReviewPackMaterialV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    createdAt: IsoInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    authority: z.literal("none"),
    reviewState: z.literal("human_pending"),
    runtimeAuthorized: z.literal(false),
    trainingAuthorized: z.literal(false),
    generatedContentAuthorized: z.literal(false),
    productionTrust: z.null(),
    sourceEvidence: ScopeReviewSourceEvidenceV2Schema,
    panoramaRecords: z
      .array(AuthorityNonePanoramaReviewRecordSchema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    panoramaSourceInventorySha256: RuntimeSha256Schema,
    panoramaObservationInventorySha256: RuntimeSha256Schema,
    observationSummary: ObservationSummaryV2Schema,
    interfaceCandidates: z
      .array(GrandHallInterfaceCandidateSchema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    interfaceInventorySha256: RuntimeSha256Schema,
    requiredHumanDecisions: z.tuple([
      z.literal("accept_or_reject_room_membership"),
      z.literal("resolve_every_interface"),
      z.literal("accept_or_reject_closed_selection_volume"),
      z.literal("resolve_all_148_panorama_sources"),
      z.literal("accept_or_reject_every_included_panorama_mask"),
    ]),
  })
  .strict();

type GrandHallScopeReviewPackMaterialV2Object = z.infer<
  typeof GrandHallScopeReviewPackMaterialV2ObjectSchema
>;

function observationBindingsFromReviewPack(
  material: GrandHallScopeReviewPackMaterialV2Object,
): readonly GrandHallPanoramaObservationBindingV2[] {
  return material.panoramaRecords.map((record) => ({
    source: record.source,
    observation: record.observation,
  }));
}

function refineExactInterfaceInventoryV2(
  candidates: readonly z.infer<typeof GrandHallInterfaceCandidateSchema>[],
  inventorySha256: string,
  ctx: z.RefinementCtx,
  candidatesPath: readonly (string | number)[],
  digestPath: readonly (string | number)[],
): void {
  const ids = candidates.map((candidate) => candidate.interfaceId);
  if (new Set(ids).size !== ids.length) {
    addIssue(ctx, candidatesPath, "interface candidate identifiers must be unique");
  }
  ids.forEach((interfaceId, index) => {
    const previous = ids[index - 1];
    if (previous !== undefined && previous.localeCompare(interfaceId) >= 0) {
      addIssue(
        ctx,
        [...candidatesPath, index, "interfaceId"],
        "interface candidates must remain in strict canonical identifier order",
      );
    }
  });
  if (
    inventorySha256 !== computeGrandHallInterfaceInventorySha256(candidates)
  ) {
    addIssue(
      ctx,
      digestPath,
      "interface inventory digest must bind every exact interface candidate",
    );
  }
}

function refineScopeReviewPackV2(
  material: GrandHallScopeReviewPackMaterialV2Object,
  ctx: z.RefinementCtx,
): void {
  const bindings = observationBindingsFromReviewPack(material);
  refineExactObservationBindings(bindings, ctx, ["panoramaRecords"]);
  if (
    material.panoramaSourceInventorySha256 !==
    panoramaSourceInventoryV3Digest(bindings.map((binding) => binding.source))
  ) {
    addIssue(
      ctx,
      ["panoramaSourceInventorySha256"],
      "source inventory digest must bind all 148 exact source JPEG identities",
    );
  }
  if (
    material.panoramaObservationInventorySha256 !==
    panoramaObservationInventoryV2Digest(bindings)
  ) {
    addIssue(
      ctx,
      ["panoramaObservationInventorySha256"],
      "observation inventory digest must bind the exact authority-none 74/74 review",
    );
  }
  refineExactInterfaceInventoryV2(
    material.interfaceCandidates,
    material.interfaceInventorySha256,
    ctx,
    ["interfaceCandidates"],
    ["interfaceInventorySha256"],
  );
}

export const GrandHallScopeReviewPackMaterialV2Schema =
  GrandHallScopeReviewPackMaterialV2ObjectSchema.superRefine(refineScopeReviewPackV2);

export type GrandHallScopeReviewPackMaterialV2 = z.infer<
  typeof GrandHallScopeReviewPackMaterialV2Schema
>;

export function computeGrandHallScopeReviewPackV2Sha256(
  material: GrandHallScopeReviewPackMaterialV2,
): string {
  const parsed = GrandHallScopeReviewPackMaterialV2Schema.parse(material);
  return canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V2, parsed);
}

const GrandHallScopeReviewPackV2ObjectSchema = GrandHallScopeReviewPackMaterialV2ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallScopeReviewPackV2Schema =
  GrandHallScopeReviewPackV2ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineScopeReviewPackV2(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_SCOPE_REVIEW_PACK_V2, material)) {
      addIssue(
        ctx,
        ["artifactSha256"],
        "review-pack digest must bind the complete unified authority-none descriptor",
      );
    }
  });

export type GrandHallScopeReviewPackV2 = z.infer<
  typeof GrandHallScopeReviewPackV2Schema
>;

const HumanReviewerV2Schema = z
  .object({
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    reviewedAt: IsoInstantSchema,
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    agentDecisionAuthority: z.literal("none"),
  })
  .strict();

const GrandHallT554ClosedVolumeReviewV1ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    reviewPackSha256: RuntimeSha256Schema,
    authority: z.literal("none"),
    reviewState: z.enum(["human_pending", "human_accepted", "human_rejected"]),
    finalDecision: z.enum(["PENDING", "ACCEPT", "REJECT"]),
    reviewer: HumanReviewerV2Schema.nullable(),
    sourceFrame: z.literal(GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME),
    units: z.literal("meters"),
    geometryRole: z.literal("non_rendered_selection_volume"),
    construction: z.literal("extruded_simple_xy_polygon"),
    footprintXY: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(2_048),
    zMin: z.number().finite().nullable(),
    zMax: z.number().finite().nullable(),
    rendered: z.literal(false),
    collisionGeometry: z.literal(false),
    exportedAsArchitecture: z.literal(false),
    generatedGeometryCreated: z.literal(false),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

type GrandHallT554ClosedVolumeReviewV1Object = z.infer<
  typeof GrandHallT554ClosedVolumeReviewV1ObjectSchema
>;

function refineClosedVolumeReviewLifecycle(
  document: GrandHallT554ClosedVolumeReviewV1Object,
  ctx: z.RefinementCtx,
): void {
  const expectedFinal = document.reviewState === "human_pending"
    ? "PENDING"
    : document.reviewState === "human_accepted"
    ? "ACCEPT"
    : "REJECT";
  if (document.finalDecision !== expectedFinal) {
    addIssue(ctx, ["finalDecision"], "volume review state and final decision must agree");
  }
  if ((document.reviewState === "human_pending") !== (document.reviewer === null)) {
    addIssue(ctx, ["reviewer"], "only a human-pending volume review may omit its reviewer");
  }
  if (document.reviewState === "human_pending") {
    if (
      document.footprintXY.length !== 0 ||
      document.zMin !== null ||
      document.zMax !== null
    ) {
      addIssue(ctx, [], "a pending volume review cannot contain authored geometry");
    }
    return;
  }
  if (
    document.reviewState === "human_accepted" &&
    (
      document.footprintXY.length < 3 ||
      document.zMin === null ||
      document.zMax === null ||
      document.note === null
    )
  ) {
    addIssue(ctx, [], "an accepted volume review requires footprint, Z extent, and note");
  }
}

export const GrandHallT554ClosedVolumeReviewV1Schema =
  GrandHallT554ClosedVolumeReviewV1ObjectSchema.superRefine(
    refineClosedVolumeReviewLifecycle,
  );

export type GrandHallT554ClosedVolumeReviewV1 = z.infer<
  typeof GrandHallT554ClosedVolumeReviewV1Schema
>;

export function computeGrandHallT554ClosedVolumeReviewV1Sha256(
  review: GrandHallT554ClosedVolumeReviewV1,
): string {
  const parsed = GrandHallT554ClosedVolumeReviewV1Schema.parse(review);
  return canonicalDigest(GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_DIGEST_V1, parsed);
}

const ClosedSelectionVolumeDecisionV2Schema = z
  .object({
    reviewSchemaVersion: z.literal(GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1),
    reviewArtifactSha256: RuntimeSha256Schema.nullable(),
    result: z.enum([
      "UNSURE",
      "ACCEPT_NON_RENDERED_SELECTION_VOLUME",
      "REJECT_SELECTION_VOLUME",
    ]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.result === "UNSURE") {
      if (decision.reviewArtifactSha256 !== null || decision.note !== null) {
        addIssue(ctx, [], "an unsure closed-volume decision cannot bind accepted evidence");
      }
      return;
    }
    if (decision.reviewArtifactSha256 === null || decision.note === null) {
      addIssue(ctx, [], "a resolved closed-volume decision requires its exact review digest and note");
    }
  });

const ReviewedMaskBindingV2Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    byteLength: PositiveByteLengthSchema,
    includedPixelCount: z.number().int().positive()
      .max(GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX),
    excludedPixelCount: SafeCountSchema
      .max(GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX),
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (
      binding.includedPixelCount + binding.excludedPixelCount !==
      GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX
    ) {
      addIssue(
        ctx,
        ["excludedPixelCount"],
        "reviewed mask counts must cover the exact source panorama grid",
      );
    }
  });

const PanoramaClassificationV2Schema = z.enum([
  "grand_hall_core",
  "grand_hall_portal_threshold",
  "no_observed_grand_hall_pixels",
]);

const PanoramaMaskReasonV2Schema = z.enum([
  "adjacent_room_pixels",
  "portal_beyond_grand_hall_plane",
  "facade_or_exterior_pixels",
  "capture_artifact_outside_verified_room",
  "unverified_or_unknown_pixels",
]);

const PanoramaHumanDecisionV2ObjectSchema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceObservation: GrandHallPanoramaObservationV2Schema,
    result: z.enum(["UNSURE", "INCLUDE", "EXCLUDE"]),
    classification: PanoramaClassificationV2Schema.nullable(),
    maskFileName: SafeRelativeFileSchema.refine(
      (value) => /\.png$/iu.test(value),
      "mask file must name a PNG",
    ).nullable(),
    reviewedMaskBinding: ReviewedMaskBindingV2Schema.nullable(),
    maskReviewed: z.boolean(),
    maskReasonCodes: z.array(PanoramaMaskReasonV2Schema).max(5),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

type PanoramaHumanDecisionV2Object = z.infer<
  typeof PanoramaHumanDecisionV2ObjectSchema
>;

function validPanoramaDecisionShape(decision: PanoramaHumanDecisionV2Object): boolean {
  if (decision.result === "UNSURE") {
    return decision.classification === null &&
      decision.maskFileName === null &&
      decision.reviewedMaskBinding === null &&
      !decision.maskReviewed &&
      decision.maskReasonCodes.length === 0;
  }
  if (decision.result === "INCLUDE") {
    return (
      decision.classification === "grand_hall_core" ||
      decision.classification === "grand_hall_portal_threshold"
    ) && decision.maskFileName !== null && decision.note !== null;
  }
  return decision.classification === "no_observed_grand_hall_pixels" &&
    decision.maskFileName === null &&
    decision.reviewedMaskBinding === null &&
    !decision.maskReviewed &&
    decision.maskReasonCodes.length === 0 &&
    decision.note !== null;
}

export const GrandHallPanoramaHumanDecisionV2Schema =
  PanoramaHumanDecisionV2ObjectSchema.superRefine((decision, ctx) => {
    if (new Set(decision.maskReasonCodes).size !== decision.maskReasonCodes.length) {
      addIssue(ctx, ["maskReasonCodes"], "mask reason codes must be unique");
    }
    if (!validPanoramaDecisionShape(decision)) {
      addIssue(
        ctx,
        [],
        "panorama decision fields do not form one fail-closed UNSURE, INCLUDE, or EXCLUDE state",
      );
    }
  });

const MatterPakRoomHumanDecisionV2Schema = z
  .object({
    sourceRoomKey: z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY),
    sourceMembershipV1Sha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    result: z.enum(["UNSURE", "ACCEPT_AS_GRAND_HALL", "REJECT_AS_GRAND_HALL"]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.result !== "UNSURE" && decision.note === null) {
      addIssue(ctx, ["note"], "a resolved MatterPak room decision requires a human note");
    }
  });

const CleanupArtifactInspectionV2Schema = z
  .object({
    artifactClass: z.enum(["Window", "Mirror"]),
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    result: z.enum([
      "UNSURE",
      "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY",
      "REJECT_SOURCE_SCOPE_HANDLING",
    ]),
    note: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (inspection.result !== "UNSURE" && inspection.note === null) {
      addIssue(ctx, ["note"], "a resolved cleanup-artifact inspection requires a human note");
    }
  });

const InterfaceHumanDecisionV2Schema = z
  .object({
    source: GrandHallInterfaceCandidateSchema,
    result: z.enum([
      "UNSURE",
      "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE",
      "EXCLUDE_BEYOND_INTERFACE",
      "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT",
    ]),
    note: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (decision.result !== "UNSURE" && decision.note === null) {
      addIssue(ctx, ["note"], "a resolved interface requires a human note");
    }
  });

const GrandHallT554HumanDecisionsV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V2),
    reviewPackSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    authority: z.literal("none"),
    reviewState: z.enum(["human_pending", "human_accepted", "human_rejected"]),
    finalDecision: z.enum(["PENDING", "ACCEPT", "REJECT"]),
    reviewer: HumanReviewerV2Schema.nullable(),
    generatedFillPermitted: z.literal(false),
    geometricCameraAuthority: z.literal("none"),
    matterPakRoomDecision: MatterPakRoomHumanDecisionV2Schema,
    cleanupArtifactInspections: z.array(CleanupArtifactInspectionV2Schema).length(2),
    closedSelectionVolumeDecision: ClosedSelectionVolumeDecisionV2Schema,
    panoramaDecisionCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    panoramaDecisions: z
      .array(GrandHallPanoramaHumanDecisionV2Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    interfaceDecisions: z.array(InterfaceHumanDecisionV2Schema)
      .length(GRAND_HALL_EXACT_INTERFACE_COUNT),
    sourceInterfaceInventorySha256: RuntimeSha256Schema,
  })
  .strict();

type GrandHallT554HumanDecisionsV2Object = z.infer<
  typeof GrandHallT554HumanDecisionsV2ObjectSchema
>;

function refineHumanDecisionLifecycle(
  document: GrandHallT554HumanDecisionsV2Object,
  ctx: z.RefinementCtx,
): void {
  const expectedFinal = document.reviewState === "human_pending"
    ? "PENDING"
    : document.reviewState === "human_accepted"
    ? "ACCEPT"
    : "REJECT";
  if (document.finalDecision !== expectedFinal) {
    addIssue(ctx, ["finalDecision"], "review state and final decision must describe one lifecycle state");
  }
  if ((document.reviewState === "human_pending") !== (document.reviewer === null)) {
    addIssue(ctx, ["reviewer"], "only a human-pending decision document may omit its reviewer");
  }
}

function observationBindingsFromHumanDecisions(
  document: GrandHallT554HumanDecisionsV2Object,
): readonly GrandHallPanoramaObservationBindingV2[] {
  return document.panoramaDecisions.map((decision) => ({
    source: decision.source,
    observation: decision.sourceObservation,
  }));
}

function refineHumanDecisionInventories(
  document: GrandHallT554HumanDecisionsV2Object,
  ctx: z.RefinementCtx,
): void {
  const bindings = observationBindingsFromHumanDecisions(document);
  refineExactObservationBindings(bindings, ctx, ["panoramaDecisions"]);
  if (
    document.sourcePanoramaInventorySha256 !==
    panoramaSourceInventoryV3Digest(bindings.map((binding) => binding.source))
  ) {
    addIssue(ctx, ["sourcePanoramaInventorySha256"], "human decisions must bind all 148 source identities");
  }
  if (
    document.sourceObservationInventorySha256 !==
    panoramaObservationInventoryV2Digest(bindings)
  ) {
    addIssue(ctx, ["sourceObservationInventorySha256"], "human decisions must bind the frozen observation inventory");
  }
}

function refineAcceptedHumanDecisions(
  document: GrandHallT554HumanDecisionsV2Object,
  ctx: z.RefinementCtx,
): void {
  if (document.reviewState !== "human_accepted") return;
  if (document.matterPakRoomDecision.result !== "ACCEPT_AS_GRAND_HALL") {
    addIssue(ctx, ["matterPakRoomDecision", "result"], "accepted scope requires explicit room acceptance");
  }
  document.cleanupArtifactInspections.forEach((inspection, index) => {
    if (inspection.result !== "ACCEPT_SOURCE_SCOPE_HANDLING_NO_ARCHITECTURAL_AUTHORITY") {
      addIssue(ctx, ["cleanupArtifactInspections", index, "result"], "accepted scope requires both cleanup inspections");
    }
  });
  if (
    document.closedSelectionVolumeDecision.result !==
      "ACCEPT_NON_RENDERED_SELECTION_VOLUME" ||
    document.closedSelectionVolumeDecision.reviewArtifactSha256 === null
  ) {
    addIssue(
      ctx,
      ["closedSelectionVolumeDecision"],
      "accepted scope requires an accepted digest-bound closed-selection-volume review",
    );
  }
  document.panoramaDecisions.forEach((decision, index) => {
    if (decision.result === "UNSURE") {
      addIssue(ctx, ["panoramaDecisions", index, "result"], "accepted scope must resolve all 148 panorama identities");
    }
    if (
      decision.result === "INCLUDE" &&
      (!decision.maskReviewed || decision.reviewedMaskBinding === null)
    ) {
      addIssue(ctx, ["panoramaDecisions", index, "reviewedMaskBinding"], "accepted inclusion requires exact reviewed mask evidence");
    }
  });
  document.interfaceDecisions.forEach((decision, index) => {
    if (decision.result === "UNSURE") {
      addIssue(ctx, ["interfaceDecisions", index, "result"], "accepted scope must resolve every interface");
    }
  });
}

function refineHumanDecisionExactCoverage(
  document: GrandHallT554HumanDecisionsV2Object,
  ctx: z.RefinementCtx,
): void {
  const expectedCleanupClasses = ["Window", "Mirror"] as const;
  document.cleanupArtifactInspections.forEach((inspection, index) => {
    if (inspection.artifactClass !== expectedCleanupClasses[index]) {
      addIssue(
        ctx,
        ["cleanupArtifactInspections", index, "artifactClass"],
        "cleanup inspections must contain exactly Window then Mirror",
      );
    }
  });
  const candidates = document.interfaceDecisions.map((decision) => decision.source);
  refineExactInterfaceInventoryV2(
    candidates,
    document.sourceInterfaceInventorySha256,
    ctx,
    ["interfaceDecisions"],
    ["sourceInterfaceInventorySha256"],
  );
  const includedMaskNames = document.panoramaDecisions.flatMap((decision) =>
    decision.result === "INCLUDE" && decision.maskFileName !== null
      ? [decision.maskFileName]
      : []
  );
  if (
    new Set(includedMaskNames.map((fileName) => fileName.toUpperCase())).size !==
      includedMaskNames.length
  ) {
    addIssue(
      ctx,
      ["panoramaDecisions"],
      "included mask filenames must be unique under case-insensitive Windows comparison",
    );
  }
}

function refineHumanDecisionsV2(
  document: GrandHallT554HumanDecisionsV2Object,
  ctx: z.RefinementCtx,
): void {
  refineHumanDecisionLifecycle(document, ctx);
  refineHumanDecisionInventories(document, ctx);
  refineHumanDecisionExactCoverage(document, ctx);
  refineAcceptedHumanDecisions(document, ctx);
}

export const GrandHallT554HumanDecisionsV2Schema =
  GrandHallT554HumanDecisionsV2ObjectSchema.superRefine(refineHumanDecisionsV2);

export type GrandHallT554HumanDecisionsV2 = z.infer<
  typeof GrandHallT554HumanDecisionsV2Schema
>;

export function computeGrandHallT554HumanDecisionsV2Sha256(
  decisions: GrandHallT554HumanDecisionsV2,
): string {
  const parsed = GrandHallT554HumanDecisionsV2Schema.parse(decisions);
  return canonicalDigest(GRAND_HALL_T554_HUMAN_DECISIONS_V2, parsed);
}

const AcceptedHumanReviewV2Schema = z
  .object({
    state: z.literal("human_accepted"),
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    reviewedAt: IsoInstantSchema,
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    agentDecisionAuthority: z.literal("none"),
  })
  .strict();

const AcceptedMembershipDecisionV3Schema = z.discriminatedUnion("disposition", [
  z
    .object({
      disposition: z.literal("include_with_binary_pixel_mask"),
      classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
      maskRequired: z.literal(true),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
  z
    .object({
      disposition: z.literal("exclude_whole_frame"),
      classification: z.literal("no_observed_grand_hall_pixels"),
      maskRequired: z.literal(false),
      generatedFillPermitted: z.literal(false),
    })
    .strict(),
]);

const AcceptedMembershipPanoramaRecordV3Schema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    decision: AcceptedMembershipDecisionV3Schema,
    decisionEvidenceSha256: RuntimeSha256Schema,
  })
  .strict();

const GrandHallRoomMembershipMaterialV3ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V3),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V2),
    reviewPackSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V2),
    humanDecisionsSha256: RuntimeSha256Schema,
    sourceMembershipV1Sha256: RuntimeSha256Schema,
    sourceBoundaryEvidenceSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    matterPakRoomMembership: z
      .object({
        includedRoomKeys: z.tuple([z.literal(GRAND_HALL_MATTERPAK_ROOM_KEY)]),
        neighbouringRoomGeometryIncluded: z.literal(false),
        facadeGeometryIncluded: z.literal(false),
      })
      .strict(),
    panoramaRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    includedFrameCount: z.number().int().positive().max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    wholeFrameExclusionCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    panoramaRecords: z
      .array(AcceptedMembershipPanoramaRecordV3Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    acceptedUnknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    humanReview: AcceptedHumanReviewV2Schema,
  })
  .strict();

type GrandHallRoomMembershipMaterialV3Object = z.infer<
  typeof GrandHallRoomMembershipMaterialV3ObjectSchema
>;

function refineRoomMembershipV3(
  material: GrandHallRoomMembershipMaterialV3Object,
  ctx: z.RefinementCtx,
): void {
  const sources = material.panoramaRecords.map((record) => record.source);
  refineExactPanoramaSources(sources, ctx, ["panoramaRecords"]);
  if (
    material.sourcePanoramaInventorySha256 !==
    panoramaSourceInventoryV3Digest(sources)
  ) {
    addIssue(ctx, ["sourcePanoramaInventorySha256"], "accepted membership must bind all 148 source identities");
  }
  const included = material.panoramaRecords.filter(
    (record) => record.decision.disposition === "include_with_binary_pixel_mask",
  ).length;
  const excluded = material.panoramaRecords.length - included;
  if (material.includedFrameCount !== included) {
    addIssue(ctx, ["includedFrameCount"], "included frame count must match the exact accepted decisions");
  }
  if (material.wholeFrameExclusionCount !== excluded) {
    addIssue(ctx, ["wholeFrameExclusionCount"], "whole-frame exclusion count must match the exact accepted decisions");
  }
  material.panoramaRecords.forEach((record, index) => {
    if (record.decisionEvidenceSha256 !== material.humanDecisionsSha256) {
      addIssue(ctx, ["panoramaRecords", index, "decisionEvidenceSha256"], "every membership decision must bind one exact human-decision document");
    }
  });
}

export const GrandHallRoomMembershipV3MaterialSchema =
  GrandHallRoomMembershipMaterialV3ObjectSchema.superRefine(refineRoomMembershipV3);

export type GrandHallRoomMembershipV3Material = z.infer<
  typeof GrandHallRoomMembershipV3MaterialSchema
>;

export function computeGrandHallRoomMembershipV3Sha256(
  material: GrandHallRoomMembershipV3Material,
): string {
  const parsed = GrandHallRoomMembershipV3MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V3, parsed);
}

const GrandHallRoomMembershipV3ObjectSchema = GrandHallRoomMembershipMaterialV3ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallRoomMembershipV3Schema =
  GrandHallRoomMembershipV3ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refineRoomMembershipV3(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_ROOM_MEMBERSHIP_V3, material)) {
      addIssue(ctx, ["artifactSha256"], "membership digest must bind all 148 accepted decisions");
    }
  });

export type GrandHallRoomMembershipV3 = z.infer<
  typeof GrandHallRoomMembershipV3Schema
>;

export const GrandHallPanoramaMaskRecordV2Schema =
  GrandHallPanoramaMaskRecordSchema.superRefine((mask, ctx) => {
    if (!isSafeGrandHallRelativePath(mask.fileName)) {
      addIssue(
        ctx,
        ["fileName"],
        "mask file must be a canonical traversal-free POSIX relative path",
      );
    }
    if (!isSafeGrandHallRelativePath(mask.sourceJpgFileName)) {
      addIssue(
        ctx,
        ["sourceJpgFileName"],
        "mask source must be a canonical traversal-free POSIX relative path",
      );
    }
  });

export type GrandHallPanoramaMaskRecordV2 = z.infer<
  typeof GrandHallPanoramaMaskRecordV2Schema
>;

const PanoramaMaskSourceRecordV2Schema = z.discriminatedUnion("disposition", [
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentityV2Schema,
      disposition: z.literal("include_with_binary_pixel_mask"),
      mask: GrandHallPanoramaMaskRecordV2Schema,
      wholeFrameExclusionReason: z.null(),
    })
    .strict(),
  z
    .object({
      source: GrandHallPanoramaSourceJpgIdentityV2Schema,
      disposition: z.literal("exclude_whole_frame"),
      mask: z.null(),
      wholeFrameExclusionReason: z.literal("no_observed_grand_hall_pixels_human_confirmed"),
    })
    .strict(),
]);

const GrandHallPanoramaMaskSetMaterialV2ObjectSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PANORAMA_MASK_SET_V2),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    authority: z.literal("human_accepted"),
    productionTrust: z.null(),
    reviewPackSchemaVersion: z.literal(GRAND_HALL_SCOPE_REVIEW_PACK_V2),
    reviewPackSha256: RuntimeSha256Schema,
    membershipSchemaVersion: z.literal(GRAND_HALL_ROOM_MEMBERSHIP_V3),
    membershipArtifactSha256: RuntimeSha256Schema,
    humanDecisionsSchemaVersion: z.literal(GRAND_HALL_T554_HUMAN_DECISIONS_V2),
    humanDecisionsSha256: RuntimeSha256Schema,
    portalDecisionArtifactSha256: RuntimeSha256Schema,
    sourcePanoramaInventorySha256: RuntimeSha256Schema,
    sourceObservationInventorySha256: RuntimeSha256Schema,
    geometricCameraAuthority: z.literal("none"),
    sourceRecordCount: z.literal(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    maskCount: z.number().int().positive().max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    wholeFrameExclusionCount: SafeCountSchema.max(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    sourceRecords: z
      .array(PanoramaMaskSourceRecordV2Schema)
      .length(GRAND_HALL_ALL_SOURCE_PANORAMA_COUNT),
    unknownPixelDisposition: z.literal("transparent_or_unknown_never_filled"),
    generatedFillPermitted: z.literal(false),
    humanReview: AcceptedHumanReviewV2Schema,
  })
  .strict();

type GrandHallPanoramaMaskSetMaterialV2Object = z.infer<
  typeof GrandHallPanoramaMaskSetMaterialV2ObjectSchema
>;

function refineIncludedMaskBinding(
  record: Extract<
    GrandHallPanoramaMaskSetMaterialV2Object["sourceRecords"][number],
    { readonly disposition: "include_with_binary_pixel_mask" }
  >,
  index: number,
  ctx: z.RefinementCtx,
): void {
  if (
    record.mask.sourceJpgFileName !== record.source.fileName ||
    record.mask.sourceJpgSha256 !== record.source.sha256
  ) {
    addIssue(
      ctx,
      ["sourceRecords", index, "mask"],
      "each mask must bind the exact source JPEG filename and byte identity",
    );
  }
}

function refinePanoramaMaskSetV2(
  material: GrandHallPanoramaMaskSetMaterialV2Object,
  ctx: z.RefinementCtx,
): void {
  const sources = material.sourceRecords.map((record) => record.source);
  refineExactPanoramaSources(sources, ctx, ["sourceRecords"]);
  if (
    material.sourcePanoramaInventorySha256 !==
    panoramaSourceInventoryV3Digest(sources)
  ) {
    addIssue(ctx, ["sourcePanoramaInventorySha256"], "mask set must bind all 148 source identities");
  }
  const included = material.sourceRecords.filter(
    (record) => record.disposition === "include_with_binary_pixel_mask",
  );
  const excluded = material.sourceRecords.filter(
    (record) => record.disposition === "exclude_whole_frame",
  );
  if (material.maskCount !== included.length) {
    addIssue(ctx, ["maskCount"], "mask count must match every included source exactly");
  }
  if (material.wholeFrameExclusionCount !== excluded.length) {
    addIssue(ctx, ["wholeFrameExclusionCount"], "exclusion count must match every excluded source exactly");
  }
  included.forEach((record) => {
    refineIncludedMaskBinding(record, record.source.inventoryIndex, ctx);
  });
  const maskNames = included.map((record) => record.mask.fileName);
  const maskCollisionKeys = maskNames.map((fileName) => fileName.toUpperCase());
  if (new Set(maskCollisionKeys).size !== maskNames.length) {
    addIssue(
      ctx,
      ["sourceRecords"],
      "included panorama masks must have unique case-insensitive Windows-safe filenames",
    );
  }
}

export const GrandHallPanoramaMaskSetV2MaterialSchema =
  GrandHallPanoramaMaskSetMaterialV2ObjectSchema.superRefine(refinePanoramaMaskSetV2);

export type GrandHallPanoramaMaskSetV2Material = z.infer<
  typeof GrandHallPanoramaMaskSetV2MaterialSchema
>;

export function computeGrandHallPanoramaMaskSetV2Sha256(
  material: GrandHallPanoramaMaskSetV2Material,
): string {
  const parsed = GrandHallPanoramaMaskSetV2MaterialSchema.parse(material);
  return canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V2, parsed);
}

const GrandHallPanoramaMaskSetV2ObjectSchema = GrandHallPanoramaMaskSetMaterialV2ObjectSchema
  .extend({ artifactSha256: RuntimeSha256Schema })
  .strict();

export const GrandHallPanoramaMaskSetV2Schema =
  GrandHallPanoramaMaskSetV2ObjectSchema.superRefine((artifact, ctx) => {
    const { artifactSha256, ...material } = artifact;
    refinePanoramaMaskSetV2(material, ctx);
    if (artifactSha256 !== canonicalDigest(GRAND_HALL_PANORAMA_MASK_SET_V2, material)) {
      addIssue(ctx, ["artifactSha256"], "mask-set digest must bind all 148 source dispositions and exact masks");
    }
  });

export type GrandHallPanoramaMaskSetV2 = z.infer<
  typeof GrandHallPanoramaMaskSetV2Schema
>;

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

function expectedPortalResolution(
  result: GrandHallT554HumanDecisionsV2["interfaceDecisions"][number]["result"],
): GrandHallPortalDecisionsV1["decisions"][number]["resolution"] | null {
  if (result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") {
    return "close_at_reviewed_grand_hall_plane";
  }
  if (result === "EXCLUDE_BEYOND_INTERFACE") return "exclude_beyond_interface";
  if (result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT") {
    return "not_a_portal_source_topology_artifact";
  }
  return null;
}

function expectedBoundaryOperation(
  result: GrandHallT554HumanDecisionsV2["interfaceDecisions"][number]["result"],
): GrandHallClosedBoundaryV1["semanticRefinements"][number]["operation"] | null {
  if (result === "CLOSE_AT_REVIEWED_GRAND_HALL_PLANE") return "retain_grand_hall_side";
  if (result === "EXCLUDE_BEYOND_INTERFACE") return "exclude_beyond_interface";
  if (result === "NOT_A_PORTAL_SOURCE_TOPOLOGY_ARTIFACT") {
    return "remove_non_architectural_capture_artifact";
  }
  return null;
}

function refineAcceptedChainReviewBindings(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, closedVolumeReview } = chain;
  if (
    humanDecisions.reviewState !== "human_accepted" ||
    humanDecisions.finalDecision !== "ACCEPT" ||
    humanDecisions.reviewer === null
  ) {
    addIssue(ctx, ["humanDecisions"], "combined accepted chain requires accepted human decisions");
  }
  if (
    humanDecisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    humanDecisions.sourcePanoramaInventorySha256 !==
      reviewPack.panoramaSourceInventorySha256 ||
    humanDecisions.sourceObservationInventorySha256 !==
      reviewPack.panoramaObservationInventorySha256 ||
    humanDecisions.sourceInterfaceInventorySha256 !== reviewPack.interfaceInventorySha256
  ) {
    addIssue(
      ctx,
      ["humanDecisions"],
      "human decisions must bind the exact review pack and all three source inventories",
    );
  }
  if (
    !canonicalValuesEqual(
      humanDecisions.panoramaDecisions.map((decision) => ({
        source: decision.source,
        observation: decision.sourceObservation,
      })),
      reviewPack.panoramaRecords.map((record) => ({
        source: record.source,
        observation: record.observation,
      })),
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions", "panoramaDecisions"],
      "human decisions must retain every exact review-pack source and observation",
    );
  }
  if (
    !canonicalValuesEqual(
      humanDecisions.interfaceDecisions.map((decision) => decision.source),
      reviewPack.interfaceCandidates,
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions", "interfaceDecisions"],
      "human interface decisions must equal the review-pack inventory exactly",
    );
  }
  if (
    humanDecisions.matterPakRoomDecision.sourceMembershipV1Sha256 !==
      reviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    humanDecisions.matterPakRoomDecision.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    humanDecisions.cleanupArtifactInspections.some(
      (inspection) =>
        inspection.sourceBoundaryEvidenceSha256 !==
          reviewPack.sourceEvidence.t551SourceEvidenceSha256,
    )
  ) {
    addIssue(
      ctx,
      ["humanDecisions"],
      "room and cleanup decisions must bind the exact review-pack source evidence",
    );
  }
  const volumeDecision = humanDecisions.closedSelectionVolumeDecision;
  if (
    closedVolumeReview.reviewPackSha256 !== reviewPack.artifactSha256 ||
    closedVolumeReview.reviewState !== "human_accepted" ||
    closedVolumeReview.finalDecision !== "ACCEPT" ||
    closedVolumeReview.reviewer === null ||
    volumeDecision.result !== "ACCEPT_NON_RENDERED_SELECTION_VOLUME" ||
    volumeDecision.reviewArtifactSha256 !==
      computeGrandHallT554ClosedVolumeReviewV1Sha256(closedVolumeReview)
  ) {
    addIssue(
      ctx,
      ["closedVolumeReview"],
      "combined chain requires the exact accepted closed-volume review bound by human decisions",
    );
  }
}

function refineAcceptedChainMembership(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership } = chain;
  const decisionsSha256 = canonicalDigest(
    GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    humanDecisions,
  );
  if (
    membership.reviewPackSha256 !== reviewPack.artifactSha256 ||
    membership.humanDecisionsSha256 !== decisionsSha256 ||
    membership.sourceMembershipV1Sha256 !==
      reviewPack.sourceEvidence.t550PendingMembershipV1Sha256 ||
    membership.sourceBoundaryEvidenceSha256 !== reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    membership.sourcePanoramaInventorySha256 !== reviewPack.panoramaSourceInventorySha256 ||
    membership.sourceObservationInventorySha256 !== reviewPack.panoramaObservationInventorySha256
  ) {
    addIssue(
      ctx,
      ["membership"],
      "membership must bind the exact accepted decisions and review-pack evidence",
    );
  }
  membership.panoramaRecords.forEach((record, index) => {
    const decision = humanDecisions.panoramaDecisions[index];
    if (decision === undefined || !canonicalValuesEqual(record.source, decision.source)) {
      addIssue(ctx, ["membership", "panoramaRecords", index], "membership source identity drift");
      return;
    }
    const expectedDisposition = decision.result === "INCLUDE"
      ? "include_with_binary_pixel_mask"
      : "exclude_whole_frame";
    const expectedClassification = decision.result === "INCLUDE"
      ? decision.classification
      : "no_observed_grand_hall_pixels";
    if (
      record.decision.disposition !== expectedDisposition ||
      record.decision.classification !== expectedClassification
    ) {
      addIssue(
        ctx,
        ["membership", "panoramaRecords", index, "decision"],
        "membership disposition and classification must equal the human decision",
      );
    }
  });
}

function refineAcceptedChainInterfaces(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership, portalDecisions, closedBoundary } = chain;
  const decisionsSha256 = canonicalDigest(
    GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    humanDecisions,
  );
  if (
    portalDecisions.reviewPackSha256 !== reviewPack.artifactSha256 ||
    portalDecisions.sourceBoundaryEvidenceSha256 !==
      reviewPack.sourceEvidence.t551SourceEvidenceSha256 ||
    portalDecisions.interfaceInventorySha256 !== reviewPack.interfaceInventorySha256 ||
    !canonicalValuesEqual(portalDecisions.interfaceCandidates, reviewPack.interfaceCandidates)
  ) {
    addIssue(
      ctx,
      ["portalDecisions"],
      "portal artifact must bind the exact review-pack interface inventory and evidence",
    );
  }
  portalDecisions.decisions.forEach((decision, index) => {
    const humanDecision = humanDecisions.interfaceDecisions[index];
    if (
      humanDecision === undefined ||
      decision.interfaceId !== humanDecision.source.interfaceId ||
      decision.resolution !== expectedPortalResolution(humanDecision.result) ||
      decision.grandHallSideEvidenceSha256 !== decisionsSha256 ||
      decision.decisionNote !== humanDecision.note
    ) {
      addIssue(
        ctx,
        ["portalDecisions", "decisions", index],
        "portal decision must exactly realize the corresponding resolved human decision",
      );
    }
  });
  if (
    closedBoundary.reviewPackSha256 !== reviewPack.artifactSha256 ||
    closedBoundary.roomMembershipArtifactSha256 !== membership.artifactSha256 ||
    closedBoundary.portalDecisionArtifactSha256 !== portalDecisions.artifactSha256 ||
    closedBoundary.portalInterfaceInventorySha256 !== reviewPack.interfaceInventorySha256 ||
    !canonicalValuesEqual(
      closedBoundary.portalInterfaceIds,
      reviewPack.interfaceCandidates.map((candidate) => candidate.interfaceId),
    )
  ) {
    addIssue(
      ctx,
      ["closedBoundary"],
      "closed boundary must bind membership, portal decisions, and every reviewed interface",
    );
  }
  closedBoundary.semanticRefinements.forEach((refinement, index) => {
    const humanDecision = humanDecisions.interfaceDecisions[index];
    if (
      humanDecision === undefined ||
      refinement.interfaceId !== humanDecision.source.interfaceId ||
      refinement.operation !== expectedBoundaryOperation(humanDecision.result) ||
      refinement.evidenceSha256 !== decisionsSha256
    ) {
      addIssue(
        ctx,
        ["closedBoundary", "semanticRefinements", index],
        "boundary refinement must exactly realize and bind the corresponding human decision",
      );
    }
  });
}

function refineAcceptedChainVolumeGeometry(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const { closedVolumeReview: review, closedBoundary: boundary } = chain;
  const reviewGeometry = {
    sourceFrame: review.sourceFrame,
    units: review.units,
    geometryRole: review.geometryRole,
    construction: review.construction,
    footprintXY: review.footprintXY,
    zMin: review.zMin,
    zMax: review.zMax,
    rendered: review.rendered,
    collisionGeometry: review.collisionGeometry,
    exportedAsArchitecture: review.exportedAsArchitecture,
    generatedGeometryCreated: review.generatedGeometryCreated,
  };
  const boundaryGeometry = {
    sourceFrame: boundary.sourceFrame,
    units: boundary.units,
    geometryRole: boundary.geometryRole,
    construction: boundary.construction,
    footprintXY: boundary.footprintXY,
    zMin: boundary.zMin,
    zMax: boundary.zMax,
    rendered: boundary.rendered,
    collisionGeometry: boundary.collisionGeometry,
    exportedAsArchitecture: boundary.exportedAsArchitecture,
    generatedGeometryCreated: boundary.generatedGeometryCreated,
  };
  if (!canonicalValuesEqual(reviewGeometry, boundaryGeometry)) {
    addIssue(
      ctx,
      ["closedBoundary"],
      "closed boundary geometry must exactly equal the accepted closed-volume review",
    );
  }
}

function refineAcceptedChainMasks(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const { reviewPack, humanDecisions, membership, portalDecisions, maskSet } = chain;
  if (
    maskSet.reviewPackSha256 !== reviewPack.artifactSha256 ||
    maskSet.membershipArtifactSha256 !== membership.artifactSha256 ||
    maskSet.humanDecisionsSha256 !== membership.humanDecisionsSha256 ||
    maskSet.portalDecisionArtifactSha256 !== portalDecisions.artifactSha256 ||
    maskSet.sourcePanoramaInventorySha256 !== reviewPack.panoramaSourceInventorySha256 ||
    maskSet.sourceObservationInventorySha256 !== reviewPack.panoramaObservationInventorySha256
  ) {
    addIssue(
      ctx,
      ["maskSet"],
      "mask set must bind the exact review, decisions, membership, portal, and source inventories",
    );
  }
  maskSet.sourceRecords.forEach((record, index) => {
    const decision = humanDecisions.panoramaDecisions[index];
    const membershipRecord = membership.panoramaRecords[index];
    if (
      decision === undefined ||
      membershipRecord === undefined ||
      !canonicalValuesEqual(record.source, decision.source) ||
      !canonicalValuesEqual(record.source, membershipRecord.source)
    ) {
      addIssue(ctx, ["maskSet", "sourceRecords", index], "mask-set source identity drift");
      return;
    }
    if (decision.result === "INCLUDE") {
      const reviewed = decision.reviewedMaskBinding;
      if (
        record.disposition !== "include_with_binary_pixel_mask" ||
        membershipRecord.decision.disposition !== "include_with_binary_pixel_mask" ||
        reviewed === null ||
        record.mask.fileName !== decision.maskFileName ||
        record.mask.sha256 !== reviewed.sha256 ||
        record.mask.byteLength !== reviewed.byteLength ||
        record.mask.includedPixelCount !== reviewed.includedPixelCount ||
        record.mask.excludedPixelCount !== reviewed.excludedPixelCount ||
        !canonicalValuesEqual(record.mask.reasonCodes, decision.maskReasonCodes)
      ) {
        addIssue(
          ctx,
          ["maskSet", "sourceRecords", index],
          "included mask must exactly realize the human-reviewed mask binding",
        );
      }
      return;
    }
    if (
      record.disposition !== "exclude_whole_frame" ||
      membershipRecord.decision.disposition !== "exclude_whole_frame"
    ) {
      addIssue(
        ctx,
        ["maskSet", "sourceRecords", index],
        "whole-frame exclusion must agree across human decision, membership, and mask set",
      );
    }
  });
}

function refineAcceptedChainReviewers(
  chain: GrandHallAcceptedScopeChainV2Object,
  ctx: z.RefinementCtx,
): void {
  const decisionsReviewer = chain.humanDecisions.reviewer;
  const volumeReviewer = chain.closedVolumeReview.reviewer;
  if (
    decisionsReviewer === null ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.membership.humanReview,
    ) ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.portalDecisions.humanReview,
    ) ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...decisionsReviewer },
      chain.maskSet.humanReview,
    )
  ) {
    addIssue(
      ctx,
      [],
      "membership, portal, and mask artifacts must bind the decisions reviewer exactly",
    );
  }
  if (
    volumeReviewer === null ||
    !canonicalValuesEqual(
      { state: "human_accepted", ...volumeReviewer },
      chain.closedBoundary.humanReview,
    )
  ) {
    addIssue(ctx, [], "closed boundary must bind the closed-volume reviewer exactly");
  }
}

const GrandHallAcceptedScopeChainV2ObjectSchema = z
  .object({
    reviewPack: GrandHallScopeReviewPackV2Schema,
    humanDecisions: GrandHallT554HumanDecisionsV2Schema,
    closedVolumeReview: GrandHallT554ClosedVolumeReviewV1Schema,
    membership: GrandHallRoomMembershipV3Schema,
    portalDecisions: GrandHallPortalDecisionsV1Schema,
    closedBoundary: GrandHallClosedBoundaryV1Schema,
    maskSet: GrandHallPanoramaMaskSetV2Schema,
  })
  .strict();

type GrandHallAcceptedScopeChainV2Object = z.infer<
  typeof GrandHallAcceptedScopeChainV2ObjectSchema
>;

export const GrandHallAcceptedScopeChainV2Schema =
  GrandHallAcceptedScopeChainV2ObjectSchema.superRefine((chain, ctx) => {
    refineAcceptedChainReviewBindings(chain, ctx);
    refineAcceptedChainMembership(chain, ctx);
    refineAcceptedChainInterfaces(chain, ctx);
    refineAcceptedChainVolumeGeometry(chain, ctx);
    refineAcceptedChainMasks(chain, ctx);
    refineAcceptedChainReviewers(chain, ctx);
  });

export type GrandHallAcceptedScopeChainV2 = z.infer<
  typeof GrandHallAcceptedScopeChainV2Schema
>;

export function verifyGrandHallAcceptedScopeChainV2(
  input: unknown,
): GrandHallAcceptedScopeChainV2 {
  return GrandHallAcceptedScopeChainV2Schema.parse(input);
}

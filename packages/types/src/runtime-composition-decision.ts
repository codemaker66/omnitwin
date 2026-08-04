import { z } from "zod";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import { RuntimeSlugSchema, TradesHallRuntimeRoomSlugSchema } from "./asset-version.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION = "runtime-composition-decision.v0";

export const RUNTIME_COMPOSITION_DECISIONS = [
  "serve_manifest_room_sog_chunks",
  "load_lcc2_graph_directly",
  "convert_lcc2_to_runtime_manifest",
] as const;
export const RuntimeCompositionDecisionSchema = z.enum(RUNTIME_COMPOSITION_DECISIONS);
export type RuntimeCompositionDecision = z.infer<typeof RuntimeCompositionDecisionSchema>;

export const RUNTIME_LOD_GRAPH_AUTHORITIES = [
  "not_runtime_authoritative",
  "runtime_authoritative",
  "conversion_source_only",
] as const;
export const RuntimeLodGraphAuthoritySchema = z.enum(RUNTIME_LOD_GRAPH_AUTHORITIES);
export type RuntimeLodGraphAuthority = z.infer<typeof RuntimeLodGraphAuthoritySchema>;

export const RUNTIME_COMPOSITION_REVIEW_TRIGGERS = [
  "runtime_package_changed",
  "chunk_hash_changed",
  "lcc2_loader_implemented",
  "lcc2_conversion_lane_implemented",
  "signed_transform_registered",
  "public_exposure_requested",
] as const;
export const RuntimeCompositionReviewTriggerSchema = z.enum(
  RUNTIME_COMPOSITION_REVIEW_TRIGGERS,
);
export type RuntimeCompositionReviewTrigger = z.infer<
  typeof RuntimeCompositionReviewTriggerSchema
>;

export const RuntimeCompositionEvidenceRefSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(260),
  })
  .strict();
export type RuntimeCompositionEvidenceRef = z.infer<
  typeof RuntimeCompositionEvidenceRefSchema
>;

export const RuntimeSogChunkDecisionSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_. -]+\.sog$/u),
    sha256: z.string().regex(SHA256_HEX),
    sizeBytes: z.number().int().positive(),
    loadedSplats: z.number().int().positive(),
    role: z.enum(["room_chunk", "environment_chunk"]),
    reason: SafePlanningWordingSchema,
  })
  .strict();
export type RuntimeSogChunkDecision = z.infer<typeof RuntimeSogChunkDecisionSchema>;

export const RuntimeCompositionDecisionV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION),
    decisionId: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    decidedAt: z.string().datetime({ offset: true }),
    decidedBy: z.string().trim().min(1).max(160),
    decision: RuntimeCompositionDecisionSchema,
    lcc2Manifest: z.object({
      fileName: z.string().trim().min(1).max(255).regex(/\.lcc2$/u),
      sha256: z.string().regex(SHA256_HEX),
      sourceBundleHash: z.string().regex(SHA256_HEX),
      totalSplats: z.number().int().positive(),
      authority: RuntimeLodGraphAuthoritySchema,
      role: z.literal("source_manifest_provenance"),
      evidenceRefs: z.array(RuntimeCompositionEvidenceRefSchema).min(1),
    }).strict(),
    runtimeLoading: z.object({
      renderer: z.literal("@sparkjsdev/spark"),
      servedChunkStrategy: z.literal("manifest_room_sog_chunks"),
      chunkOrdering: z.literal("api_file_name_ascending"),
      visualAssetUrlsExpectedCount: z.number().int().positive(),
      loadedSplatsExpected: z.number().int().positive(),
      servedRoomChunks: z.array(RuntimeSogChunkDecisionSchema).min(1),
      excludedChunks: z.array(RuntimeSogChunkDecisionSchema).min(1),
    }).strict(),
    guardrails: z.object({
      lcc2DirectLoaderEnabled: z.boolean(),
      signedTransformCreated: z.literal(false),
      publicExposureChanged: z.literal(false),
      operationalGeometryCreated: z.literal(false),
    }).strict(),
    limitations: z.array(SafePlanningWordingSchema).min(1),
    reviewTriggers: z.array(RuntimeCompositionReviewTriggerSchema).min(1),
    evidenceRefs: z.array(RuntimeCompositionEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.decision === "serve_manifest_room_sog_chunks") {
      if (record.lcc2Manifest.authority !== "not_runtime_authoritative") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lcc2Manifest", "authority"],
          message: "Direct chunk-serving decisions must keep the LCC2 graph non-authoritative at runtime.",
        });
      }
      if (record.guardrails.lcc2DirectLoaderEnabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["guardrails", "lcc2DirectLoaderEnabled"],
          message: "Direct chunk-serving decisions cannot enable the LCC2 direct loader.",
        });
      }
    }

    const servedNames = new Set(record.runtimeLoading.servedRoomChunks.map((chunk) => chunk.fileName));
    for (const [index, chunk] of record.runtimeLoading.servedRoomChunks.entries()) {
      if (chunk.role !== "room_chunk") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "servedRoomChunks", index, "role"],
          message: "Served runtime chunks must be room chunks.",
        });
      }
    }

    for (const [index, chunk] of record.runtimeLoading.excludedChunks.entries()) {
      if (chunk.role !== "environment_chunk") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "excludedChunks", index, "role"],
          message: "Excluded chunks must be environment chunks.",
        });
      }
      if (servedNames.has(chunk.fileName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "excludedChunks", index, "fileName"],
          message: "A chunk cannot be both served and excluded.",
        });
      }
    }

    if (record.runtimeLoading.visualAssetUrlsExpectedCount !== record.runtimeLoading.servedRoomChunks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeLoading", "visualAssetUrlsExpectedCount"],
        message: "visualAssetUrlsExpectedCount must match the served room chunk count.",
      });
    }

    const servedSplats = record.runtimeLoading.servedRoomChunks.reduce(
      (sum, chunk) => sum + chunk.loadedSplats,
      0,
    );
    if (record.runtimeLoading.loadedSplatsExpected !== servedSplats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeLoading", "loadedSplatsExpected"],
        message: "loadedSplatsExpected must equal the sum of served room chunk splats.",
      });
    }

    if (record.lcc2Manifest.totalSplats !== servedSplats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lcc2Manifest", "totalSplats"],
        message: "The LCC2 room total must equal the served room chunk splat total.",
      });
    }
  });
export type RuntimeCompositionDecisionV0 = z.infer<typeof RuntimeCompositionDecisionV0Schema>;

export const RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION =
  "runtime-composition-decision.v1";

export const RUNTIME_FRONTIER_SPLAT_FORMATS = ["sog", "spz"] as const;
export const RuntimeFrontierSplatFormatSchema = z.enum(
  RUNTIME_FRONTIER_SPLAT_FORMATS,
);
export type RuntimeFrontierSplatFormat = z.infer<
  typeof RuntimeFrontierSplatFormatSchema
>;

const RuntimeCompositionAssetIdentityV1Schema = z
  .object({
    assetVersionId: z.string().uuid(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9_. -]+\.(?:sog|spz)$/u),
    sha256: z.string().regex(SHA256_HEX),
    sizeBytes: z.number().int().positive(),
    gaussianCount: z.number().int().positive(),
  })
  .strict();

export const RuntimeHierarchyNodeRangeV1Schema = z
  .object({
    nodePath: z.string().regex(/^0(?:_[0-9]+)+$/u),
    start: z.number().int().nonnegative(),
    count: z.number().int().positive(),
  })
  .strict();
export type RuntimeHierarchyNodeRangeV1 = z.infer<
  typeof RuntimeHierarchyNodeRangeV1Schema
>;

const RuntimeHierarchyRoomAssetV1Schema =
  RuntimeCompositionAssetIdentityV1Schema.extend({
    sourceHierarchySha256: z.string().regex(SHA256_HEX),
    hierarchyLevel: z.number().int().positive(),
    nodeRanges: z.array(RuntimeHierarchyNodeRangeV1Schema).min(1),
  }).strict();

export const RuntimeFrontierMemberV1Schema =
  RuntimeHierarchyRoomAssetV1Schema.extend({
    order: z.number().int().nonnegative(),
    role: z.literal("frontier_member"),
  }).strict();
export type RuntimeFrontierMemberV1 = z.infer<
  typeof RuntimeFrontierMemberV1Schema
>;

export const RuntimeExcludedAncestorV1Schema =
  RuntimeHierarchyRoomAssetV1Schema.extend({
    exclusion: z.literal("replaced_by_selected_descendants"),
  }).strict();
export type RuntimeExcludedAncestorV1 = z.infer<
  typeof RuntimeExcludedAncestorV1Schema
>;

export const RuntimeFrontierEnvironmentAssetV1Schema =
  RuntimeCompositionAssetIdentityV1Schema;
export type RuntimeFrontierEnvironmentAssetV1 = z.infer<
  typeof RuntimeFrontierEnvironmentAssetV1Schema
>;

export const RuntimeFrontierEnvironmentDispositionV1Schema =
  z.discriminatedUnion("disposition", [
    z
      .object({
        disposition: z.literal("excluded_from_room_frontier"),
        includedInRoomHierarchyTotals: z.literal(false),
        asset: RuntimeFrontierEnvironmentAssetV1Schema,
        reason: SafePlanningWordingSchema,
      })
      .strict(),
    z
      .object({
        disposition: z.literal("served_as_separate_environment_layer"),
        includedInRoomHierarchyTotals: z.literal(false),
        asset: RuntimeFrontierEnvironmentAssetV1Schema,
        reason: SafePlanningWordingSchema,
      })
      .strict(),
    z
      .object({
        disposition: z.literal("not_present"),
        includedInRoomHierarchyTotals: z.literal(false),
        reason: SafePlanningWordingSchema,
      })
      .strict(),
  ]);
export type RuntimeFrontierEnvironmentDispositionV1 = z.infer<
  typeof RuntimeFrontierEnvironmentDispositionV1Schema
>;

export const RuntimeHierarchyLevelTotalV1Schema = z
  .object({
    level: z.number().int().positive(),
    assetCount: z.number().int().positive(),
    gaussianCount: z.number().int().positive(),
    payloadBytes: z.number().int().positive(),
  })
  .strict();
export type RuntimeHierarchyLevelTotalV1 = z.infer<
  typeof RuntimeHierarchyLevelTotalV1Schema
>;

type RuntimeHierarchyRoomAssetV1 = z.infer<
  typeof RuntimeHierarchyRoomAssetV1Schema
>;
type RuntimeAssetPath = readonly (string | number)[];

interface RuntimeAssetWithPath {
  readonly asset: z.infer<typeof RuntimeCompositionAssetIdentityV1Schema>;
  readonly path: RuntimeAssetPath;
}

interface RuntimeNodeRangeWithPath {
  readonly nodePath: string;
  readonly path: RuntimeAssetPath;
}

function hierarchyLevelForNodePath(nodePath: string): number {
  return nodePath.split("_").length - 1;
}

function isStrictAncestorNodePath(
  ancestor: string,
  descendant: string,
): boolean {
  const ancestorParts = ancestor.split("_");
  const descendantParts = descendant.split("_");
  return (
    ancestorParts.length < descendantParts.length &&
    ancestorParts.every((part, index) => part === descendantParts[index])
  );
}

function sumAssetField(
  assets: readonly RuntimeHierarchyRoomAssetV1[],
  field: "gaussianCount" | "sizeBytes",
): number {
  return assets.reduce((sum, asset) => sum + asset[field], 0);
}

function validateHierarchyAssetMetadata(
  asset: RuntimeHierarchyRoomAssetV1,
  path: RuntimeAssetPath,
  expectedFormat: RuntimeFrontierSplatFormat,
  hierarchySha256: string,
  expectedLevel: number | null,
  ctx: z.RefinementCtx,
): void {
  if (!asset.fileName.endsWith(`.${expectedFormat}`)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "fileName"],
      message: `Runtime asset filename must use the selected .${expectedFormat} format.`,
    });
  }

  if (asset.sourceHierarchySha256 !== hierarchySha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "sourceHierarchySha256"],
      message:
        "Runtime asset hierarchy hash must match the decision hierarchy hash.",
    });
  }

  if (expectedLevel !== null && asset.hierarchyLevel !== expectedLevel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "hierarchyLevel"],
      message:
        "Frontier asset hierarchyLevel must match the selected frontier level.",
    });
  }
}

function validateHierarchyAssetRanges(
  asset: RuntimeHierarchyRoomAssetV1,
  path: RuntimeAssetPath,
  ctx: z.RefinementCtx,
): void {
  let expectedStart = 0;
  for (const [rangeIndex, range] of asset.nodeRanges.entries()) {
    if (range.start !== expectedStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "nodeRanges", rangeIndex, "start"],
        message:
          "Node ranges must provide ordered, contiguous coverage beginning at zero.",
      });
    }
    if (hierarchyLevelForNodePath(range.nodePath) !== asset.hierarchyLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "nodeRanges", rangeIndex, "nodePath"],
        message: "Node path depth must match the asset hierarchyLevel.",
      });
    }
    expectedStart += range.count;
  }

  if (expectedStart !== asset.gaussianCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "gaussianCount"],
      message:
        "Asset gaussianCount must equal the sum of its hierarchy node ranges.",
    });
  }
}

function validateHierarchyAsset(
  asset: RuntimeHierarchyRoomAssetV1,
  path: RuntimeAssetPath,
  expectedFormat: RuntimeFrontierSplatFormat,
  hierarchySha256: string,
  expectedLevel: number | null,
  ctx: z.RefinementCtx,
): void {
  validateHierarchyAssetMetadata(
    asset,
    path,
    expectedFormat,
    hierarchySha256,
    expectedLevel,
    ctx,
  );
  validateHierarchyAssetRanges(asset, path, ctx);
}

function rejectDuplicateAssetField(
  records: readonly RuntimeAssetWithPath[],
  field: "assetVersionId" | "fileName" | "sha256",
  ctx: z.RefinementCtx,
): void {
  const firstIndexByValue = new Map<string, number>();
  for (const [index, record] of records.entries()) {
    const value = record.asset[field];
    const firstIndex = firstIndexByValue.get(value);
    if (firstIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...record.path, field],
        message: `Duplicate runtime asset ${field}; first occurrence is asset ${String(firstIndex)}.`,
      });
    } else {
      firstIndexByValue.set(value, index);
    }
  }
}

const RuntimeCompositionDecisionV1ShapeSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION),
    decisionId: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackage: z
      .object({
        runtimePackageId: z.string().uuid(),
        revision: z.number().int().positive(),
        /** SHA-256 of the versioned canonical package content: manifest,
         *  declared asset IDs, evidence status, and runtime status. */
        contentDigest: z.string().regex(SHA256_HEX),
        primaryVisualAssetVersionId: z.string().uuid(),
      })
      .strict(),
    decidedAt: z.string().datetime({ offset: true }),
    decidedBy: z.string().trim().min(1).max(160),
    decision: z.literal("serve_reviewed_fixed_frontier"),
    hierarchy: z
      .object({
        format: z.literal("lcc2"),
        fileName: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[A-Za-z0-9_. -]+\.lcc2$/u),
        formatVersion: z
          .string()
          .regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u),
        sha256: z.string().regex(SHA256_HEX),
        firstDataLevel: z.number().int().positive(),
        highestDataLevel: z.number().int().positive(),
        allLevels: z
          .object({
            scope: z.literal("all_room_hierarchy_levels_excluding_environment"),
            roomAssetCount: z.number().int().positive(),
            gaussianCount: z.number().int().positive(),
            payloadBytes: z.number().int().positive(),
            levelTotals: z.array(RuntimeHierarchyLevelTotalV1Schema).min(2),
          })
          .strict(),
      })
      .strict(),
    frontier: z
      .object({
        strategy: z.literal("fixed_non_overlapping_frontier"),
        format: RuntimeFrontierSplatFormatSchema,
        selectedLevel: z.number().int().positive(),
        totals: z
          .object({
            scope: z.literal("selected_room_frontier_excluding_environment"),
            assetCount: z.number().int().positive(),
            gaussianCount: z.number().int().positive(),
            payloadBytes: z.number().int().positive(),
          })
          .strict(),
        orderedMembers: z.array(RuntimeFrontierMemberV1Schema).min(1),
      })
      .strict(),
    excludedAncestors: z.array(RuntimeExcludedAncestorV1Schema).min(1),
    environment: RuntimeFrontierEnvironmentDispositionV1Schema,
    limitations: z.array(SafePlanningWordingSchema).min(1),
    evidenceRefs: z.array(RuntimeCompositionEvidenceRefSchema).min(1),
  })
  .strict();
type RuntimeCompositionDecisionV1Shape = z.infer<
  typeof RuntimeCompositionDecisionV1ShapeSchema
>;

function addCompositionIssue(
  ctx: z.RefinementCtx,
  path: RuntimeAssetPath,
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function requireCompositionEquality(
  actual: number,
  expected: number,
  ctx: z.RefinementCtx,
  path: RuntimeAssetPath,
  message: string,
): void {
  if (actual !== expected) {
    addCompositionIssue(ctx, path, message);
  }
}

function validateHierarchyBounds(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  if (record.hierarchy.firstDataLevel >= record.hierarchy.highestDataLevel) {
    addCompositionIssue(
      ctx,
      ["hierarchy", "firstDataLevel"],
      "A fixed descendant frontier requires at least one ancestor hierarchy level.",
    );
  }
  if (record.frontier.selectedLevel !== record.hierarchy.highestDataLevel) {
    addCompositionIssue(
      ctx,
      ["frontier", "selectedLevel"],
      "The fixed frontier must select the hierarchy's highest recorded data level.",
    );
  }
}

function validateFrontierMembers(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  for (const [index, member] of record.frontier.orderedMembers.entries()) {
    requireCompositionEquality(
      member.order,
      index,
      ctx,
      ["frontier", "orderedMembers", index, "order"],
      "Frontier member order must match its array position.",
    );
    validateHierarchyAsset(
      member,
      ["frontier", "orderedMembers", index],
      record.frontier.format,
      record.hierarchy.sha256,
      record.frontier.selectedLevel,
      ctx,
    );
  }
}

function validateExcludedAncestorAssets(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  for (const [index, ancestor] of record.excludedAncestors.entries()) {
    validateHierarchyAsset(
      ancestor,
      ["excludedAncestors", index],
      record.frontier.format,
      record.hierarchy.sha256,
      null,
      ctx,
    );
    if (
      ancestor.hierarchyLevel < record.hierarchy.firstDataLevel ||
      ancestor.hierarchyLevel >= record.frontier.selectedLevel
    ) {
      addCompositionIssue(
        ctx,
        ["excludedAncestors", index, "hierarchyLevel"],
        "Excluded ancestor level must sit between the first data level and frontier.",
      );
    }
  }
}

function validateEnvironmentFormat(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  if (
    record.environment.disposition !== "not_present" &&
    !record.environment.asset.fileName.endsWith(`.${record.frontier.format}`)
  ) {
    addCompositionIssue(
      ctx,
      ["environment", "asset", "fileName"],
      "Environment filename must use the selected runtime format.",
    );
  }
}

function validateDeclaredHierarchyAssets(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  validateFrontierMembers(record, ctx);
  validateExcludedAncestorAssets(record, ctx);
  validateEnvironmentFormat(record, ctx);
}

function validateFrontierTotals(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  const selectedAssets: readonly RuntimeHierarchyRoomAssetV1[] =
    record.frontier.orderedMembers;
  requireCompositionEquality(
    record.frontier.totals.assetCount,
    selectedAssets.length,
    ctx,
    ["frontier", "totals", "assetCount"],
    "Selected assetCount must equal the ordered frontier member count.",
  );
  requireCompositionEquality(
    record.frontier.totals.gaussianCount,
    sumAssetField(selectedAssets, "gaussianCount"),
    ctx,
    ["frontier", "totals", "gaussianCount"],
    "Selected Gaussian total must equal the ordered frontier member sum.",
  );
  requireCompositionEquality(
    record.frontier.totals.payloadBytes,
    sumAssetField(selectedAssets, "sizeBytes"),
    ctx,
    ["frontier", "totals", "payloadBytes"],
    "Selected byte total must equal the ordered frontier member sum.",
  );
}

function validateAllRoomTotals(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  const allRoomAssets: readonly RuntimeHierarchyRoomAssetV1[] = [
    ...record.frontier.orderedMembers,
    ...record.excludedAncestors,
  ];
  requireCompositionEquality(
    record.hierarchy.allLevels.roomAssetCount,
    allRoomAssets.length,
    ctx,
    ["hierarchy", "allLevels", "roomAssetCount"],
    "All-level asset count must equal frontier plus excluded ancestor assets.",
  );
  requireCompositionEquality(
    record.hierarchy.allLevels.gaussianCount,
    sumAssetField(allRoomAssets, "gaussianCount"),
    ctx,
    ["hierarchy", "allLevels", "gaussianCount"],
    "All-level Gaussian total must equal frontier plus excluded ancestors.",
  );
  requireCompositionEquality(
    record.hierarchy.allLevels.payloadBytes,
    sumAssetField(allRoomAssets, "sizeBytes"),
    ctx,
    ["hierarchy", "allLevels", "payloadBytes"],
    "All-level byte total must equal frontier plus excluded ancestors.",
  );
}

function validateCompositionTotals(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  validateFrontierTotals(record, ctx);
  validateAllRoomTotals(record, ctx);
}

function validateHierarchyLevelTotal(
  record: RuntimeCompositionDecisionV1Shape,
  allRoomAssets: readonly RuntimeHierarchyRoomAssetV1[],
  levelTotal: RuntimeHierarchyLevelTotalV1,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const path = ["hierarchy", "allLevels", "levelTotals", index] as const;
  const assetsAtLevel = allRoomAssets.filter(
    (asset) => asset.hierarchyLevel === levelTotal.level,
  );
  requireCompositionEquality(
    levelTotal.level,
    record.hierarchy.firstDataLevel + index,
    ctx,
    [...path, "level"],
    "levelTotals must be ordered from firstDataLevel through highestDataLevel.",
  );
  requireCompositionEquality(
    levelTotal.assetCount,
    assetsAtLevel.length,
    ctx,
    [...path, "assetCount"],
    "Hierarchy level asset count must match its recorded assets.",
  );
  requireCompositionEquality(
    levelTotal.gaussianCount,
    sumAssetField(assetsAtLevel, "gaussianCount"),
    ctx,
    [...path, "gaussianCount"],
    "Hierarchy level Gaussian total must match its recorded assets.",
  );
  requireCompositionEquality(
    levelTotal.payloadBytes,
    sumAssetField(assetsAtLevel, "sizeBytes"),
    ctx,
    [...path, "payloadBytes"],
    "Hierarchy level byte total must match its recorded assets.",
  );
}

function validateHierarchyLevelTotals(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  const allRoomAssets: readonly RuntimeHierarchyRoomAssetV1[] = [
    ...record.frontier.orderedMembers,
    ...record.excludedAncestors,
  ];
  const expectedLevelCount =
    record.hierarchy.highestDataLevel - record.hierarchy.firstDataLevel + 1;
  requireCompositionEquality(
    record.hierarchy.allLevels.levelTotals.length,
    expectedLevelCount,
    ctx,
    ["hierarchy", "allLevels", "levelTotals"],
    "levelTotals must record every hierarchy level exactly once.",
  );
  for (const [
    index,
    levelTotal,
  ] of record.hierarchy.allLevels.levelTotals.entries()) {
    validateHierarchyLevelTotal(record, allRoomAssets, levelTotal, index, ctx);
  }
}

function validatePrimaryAndAssetUniqueness(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  const selectedAssetIds = new Set(
    record.frontier.orderedMembers.map((asset) => asset.assetVersionId),
  );
  if (
    !selectedAssetIds.has(record.runtimePackage.primaryVisualAssetVersionId)
  ) {
    addCompositionIssue(
      ctx,
      ["runtimePackage", "primaryVisualAssetVersionId"],
      "Primary visual asset must be a selected frontier member.",
    );
  }
  const assetRecords: RuntimeAssetWithPath[] = [
    ...record.frontier.orderedMembers.map((asset, index) => ({
      asset,
      path: ["frontier", "orderedMembers", index] as const,
    })),
    ...record.excludedAncestors.map((asset, index) => ({
      asset,
      path: ["excludedAncestors", index] as const,
    })),
  ];
  if (record.environment.disposition !== "not_present") {
    assetRecords.push({
      asset: record.environment.asset,
      path: ["environment", "asset"],
    });
  }
  rejectDuplicateAssetField(assetRecords, "assetVersionId", ctx);
  rejectDuplicateAssetField(assetRecords, "fileName", ctx);
  rejectDuplicateAssetField(assetRecords, "sha256", ctx);
}

function collectNodeRangeRecords(
  assets: readonly RuntimeHierarchyRoomAssetV1[],
  basePath: readonly string[],
): RuntimeNodeRangeWithPath[] {
  const records: RuntimeNodeRangeWithPath[] = [];
  for (const [assetIndex, asset] of assets.entries()) {
    for (const [rangeIndex, range] of asset.nodeRanges.entries()) {
      records.push({
        nodePath: range.nodePath,
        path: [...basePath, assetIndex, "nodeRanges", rangeIndex, "nodePath"],
      });
    }
  }
  return records;
}

function rejectDuplicateNodePaths(
  records: readonly RuntimeNodeRangeWithPath[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const range of records) {
    if (seen.has(range.nodePath)) {
      addCompositionIssue(
        ctx,
        range.path,
        "A hierarchy node path cannot be assigned to multiple runtime assets.",
      );
    } else {
      seen.add(range.nodePath);
    }
  }
}

function rejectMixedSelectedAncestry(
  selectedRanges: readonly RuntimeNodeRangeWithPath[],
  ctx: z.RefinementCtx,
): void {
  for (const [index, left] of selectedRanges.entries()) {
    for (const right of selectedRanges.slice(index + 1)) {
      if (
        isStrictAncestorNodePath(left.nodePath, right.nodePath) ||
        isStrictAncestorNodePath(right.nodePath, left.nodePath)
      ) {
        addCompositionIssue(
          ctx,
          right.path,
          "A fixed frontier cannot select both an ancestor and its descendant.",
        );
      }
    }
  }
}

function validateAncestorProofs(
  record: RuntimeCompositionDecisionV1Shape,
  selectedRanges: readonly RuntimeNodeRangeWithPath[],
  ancestorRanges: readonly RuntimeNodeRangeWithPath[],
  ctx: z.RefinementCtx,
): void {
  const ancestorPaths = new Set(ancestorRanges.map((range) => range.nodePath));
  for (const selectedRange of selectedRanges) {
    const parts = selectedRange.nodePath.split("_");
    for (
      let level = record.hierarchy.firstDataLevel;
      level < record.frontier.selectedLevel;
      level += 1
    ) {
      const expectedPath = parts.slice(0, level + 1).join("_");
      if (!ancestorPaths.has(expectedPath)) {
        addCompositionIssue(
          ctx,
          selectedRange.path,
          `Missing excluded ancestor range ${expectedPath}.`,
        );
      }
    }
  }
  for (const ancestorRange of ancestorRanges) {
    const leadsToSelection = selectedRanges.some((selectedRange) =>
      isStrictAncestorNodePath(ancestorRange.nodePath, selectedRange.nodePath),
    );
    if (!leadsToSelection) {
      addCompositionIssue(
        ctx,
        ancestorRange.path,
        "Excluded ancestor range must lead to at least one selected frontier node.",
      );
    }
  }
}

function validateNodeSelection(
  record: RuntimeCompositionDecisionV1Shape,
  ctx: z.RefinementCtx,
): void {
  const selectedRanges = collectNodeRangeRecords(
    record.frontier.orderedMembers,
    ["frontier", "orderedMembers"],
  );
  const ancestorRanges = collectNodeRangeRecords(record.excludedAncestors, [
    "excludedAncestors",
  ]);
  rejectDuplicateNodePaths([...selectedRanges, ...ancestorRanges], ctx);
  rejectMixedSelectedAncestry(selectedRanges, ctx);
  validateAncestorProofs(record, selectedRanges, ancestorRanges, ctx);
}

export const RuntimeCompositionDecisionV1Schema =
  RuntimeCompositionDecisionV1ShapeSchema.superRefine((record, ctx) => {
    validateHierarchyBounds(record, ctx);
    validateDeclaredHierarchyAssets(record, ctx);
    validateCompositionTotals(record, ctx);

    validateHierarchyLevelTotals(record, ctx);
    validatePrimaryAndAssetUniqueness(record, ctx);
    validateNodeSelection(record, ctx);
  });
export type RuntimeCompositionDecisionV1 = z.infer<
  typeof RuntimeCompositionDecisionV1Schema
>;

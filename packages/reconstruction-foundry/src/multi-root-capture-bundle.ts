import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionCapabilitiesSchema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryIngestManifestSha256,
  type FoundryIngestManifestV0,
  type FoundryIntakeAdmissionResultV0,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";

/**
 * Metadata-only composition of independently admitted capture roots.
 *
 * This contract grants no execution authority and performs no source reads,
 * staging, uploads, publication, signing, or rights elevation.
 */
export const FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0 =
  "omnitwin.foundry.multi-root-capture-bundle.v0";

const MULTI_ROOT_CAPTURE_BUNDLE_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0";
const MULTI_ROOT_CAPTURE_BUNDLE_ID_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_ID_V0";
const BARE_SHA256 = /^[a-f0-9]{64}$/u;

const LEGAL_REVIEW_STATE_RANK = {
  not_reviewed: 0,
  requires_review: 1,
  blocked: 2,
} as const;

const FoundryComposedLegalReviewStateSchema = z.enum([
  "not_reviewed",
  "requires_review",
  "blocked",
]);
type FoundryComposedLegalReviewState = z.infer<
  typeof FoundryComposedLegalReviewStateSchema
>;

const ID_MAP_CATEGORIES = [
  ["sourceRoots", "root"],
  ["coordinateFrames", "frame"],
  ["transforms", "transform"],
  ["assets", "asset"],
  ["provenanceEdges", "edge"],
  ["operationIds", "operation"],
  ["generatedRegions", "region"],
] as const;

type FoundryBundleIdMapCategory = (typeof ID_MAP_CATEGORIES)[number][0];
type FoundryBundleIdKind = (typeof ID_MAP_CATEGORIES)[number][1];

const FoundryOriginalToCombinedIdV0Schema = z
  .object({
    originalId: RuntimeManifestKeySchema,
    combinedId: RuntimeManifestKeySchema,
  })
  .strict();

export const FoundryMultiRootCaptureBundleIdMapV0Schema = z
  .object({
    sourceRoots: z.array(FoundryOriginalToCombinedIdV0Schema).min(1).max(100),
    coordinateFrames: z.array(FoundryOriginalToCombinedIdV0Schema).max(10_000),
    transforms: z.array(FoundryOriginalToCombinedIdV0Schema).max(100_000),
    assets: z.array(FoundryOriginalToCombinedIdV0Schema).min(1).max(100_000),
    provenanceEdges: z.array(FoundryOriginalToCombinedIdV0Schema).max(200_000),
    operationIds: z.array(FoundryOriginalToCombinedIdV0Schema).max(200_000),
    generatedRegions: z.array(FoundryOriginalToCombinedIdV0Schema).max(100_000),
  })
  .strict();
export type FoundryMultiRootCaptureBundleIdMapV0 = z.infer<
  typeof FoundryMultiRootCaptureBundleIdMapV0Schema
>;

export const FoundryMultiRootCaptureBundleMountInputV0Schema = z
  .object({
    namespaceId: RuntimeManifestKeySchema,
    admissionResult: FoundryIntakeAdmissionResultV0Schema,
  })
  .strict();

const FoundryMultiRootCaptureBundleInputObjectV0Schema = z
  .object({
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    mounts: z
      .array(FoundryMultiRootCaptureBundleMountInputV0Schema)
      .min(2)
      .max(100),
  })
  .strict();

export const FoundryMultiRootCaptureBundleInputV0Schema =
  FoundryMultiRootCaptureBundleInputObjectV0Schema.superRefine((input, ctx) => {
    const namespaceIds = input.mounts.map((mount) => mount.namespaceId);
    if (new Set(namespaceIds).size !== namespaceIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mounts"],
        message:
          "capture-bundle mount namespace IDs must be unique; assign each admitted root a distinct namespace",
      });
    }
  });
export type FoundryMultiRootCaptureBundleInputV0 = z.infer<
  typeof FoundryMultiRootCaptureBundleInputV0Schema
>;

export const FoundryMultiRootCaptureBundleMountV0Schema = z
  .object({
    namespaceId: RuntimeManifestKeySchema,
    originalAdmissionResult: FoundryIntakeAdmissionResultV0Schema,
    originalProjectId: RuntimeManifestKeySchema,
    originalResultSha256: RuntimeSha256Schema,
    originalManifestSha256: RuntimeSha256Schema,
    originalReceiptSha256: z.string().regex(BARE_SHA256),
    originalReviewSha256: RuntimeSha256Schema,
    originalLegalReviewState: FoundryComposedLegalReviewStateSchema,
    idMap: FoundryMultiRootCaptureBundleIdMapV0Schema,
  })
  .strict();
export type FoundryMultiRootCaptureBundleMountV0 = z.infer<
  typeof FoundryMultiRootCaptureBundleMountV0Schema
>;

function deriveCombinedId(
  namespaceId: string,
  kind: FoundryBundleIdKind,
  originalId: string,
): string {
  const digest = domainSeparatedSha256(
    MULTI_ROOT_CAPTURE_BUNDLE_ID_DIGEST_DOMAIN,
    toCanonicalJson({ kind, namespaceId, originalId }),
  );
  return `cb.${kind}.${digest}`;
}

function compareIdMappings(
  left: { readonly originalId: string },
  right: { readonly originalId: string },
): number {
  return compareCanonicalStrings(left.originalId, right.originalId);
}

function createIdMappings(
  namespaceId: string,
  kind: FoundryBundleIdKind,
  originalIds: readonly string[],
): Array<{ originalId: string; combinedId: string }> {
  return [...new Set(originalIds)]
    .sort(compareCanonicalStrings)
    .map((originalId) => ({
      originalId,
      combinedId: deriveCombinedId(namespaceId, kind, originalId),
    }));
}

function createIdMap(
  namespaceId: string,
  manifest: FoundryIngestManifestV0,
): FoundryMultiRootCaptureBundleIdMapV0 {
  return FoundryMultiRootCaptureBundleIdMapV0Schema.parse({
    sourceRoots: createIdMappings(
      namespaceId,
      "root",
      manifest.sourceRoots.map((root) => root.id),
    ),
    coordinateFrames: createIdMappings(
      namespaceId,
      "frame",
      manifest.coordinateFrames.map((frame) => frame.id),
    ),
    transforms: createIdMappings(
      namespaceId,
      "transform",
      manifest.transforms.map((transform) => transform.id),
    ),
    assets: createIdMappings(
      namespaceId,
      "asset",
      manifest.assets.map((asset) => asset.id),
    ),
    provenanceEdges: createIdMappings(
      namespaceId,
      "edge",
      manifest.provenanceEdges.map((edge) => edge.id),
    ),
    operationIds: createIdMappings(
      namespaceId,
      "operation",
      manifest.provenanceEdges.map((edge) => edge.operationId),
    ),
    generatedRegions: createIdMappings(
      namespaceId,
      "region",
      manifest.generatedRegions.map((region) => region.id),
    ),
  });
}

function idLookup(
  entries: readonly {
    readonly originalId: string;
    readonly combinedId: string;
  }[],
): ReadonlyMap<string, string> {
  return new Map(entries.map((entry) => [entry.originalId, entry.combinedId]));
}

function requiredCombinedId(
  lookup: ReadonlyMap<string, string>,
  originalId: string,
  referenceKind: string,
): string {
  const combinedId = lookup.get(originalId);
  if (combinedId === undefined) {
    throw new FoundryIntegrityError(
      "MULTI_ROOT_REFERENCE_NOT_MAPPED",
      `Verified manifest ${referenceKind} reference '${originalId}' has no combined ID mapping.`,
    );
  }
  return combinedId;
}

function optionalCombinedId(
  lookup: ReadonlyMap<string, string>,
  originalId: string | null,
  referenceKind: string,
): string | null {
  return originalId === null
    ? null
    : requiredCombinedId(lookup, originalId, referenceKind);
}

function strictestLegalReviewState(
  states: readonly FoundryComposedLegalReviewState[],
): FoundryComposedLegalReviewState {
  return states.reduce<FoundryComposedLegalReviewState>(
    (strictest, state) =>
      LEGAL_REVIEW_STATE_RANK[state] > LEGAL_REVIEW_STATE_RANK[strictest]
        ? state
        : strictest,
    "not_reviewed",
  );
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return (
    rightSet.size === right.length && left.every((value) => rightSet.has(value))
  );
}

function manifestIdsForCategory(
  manifest: FoundryIngestManifestV0,
  category: FoundryBundleIdMapCategory,
): string[] {
  switch (category) {
    case "sourceRoots":
      return manifest.sourceRoots.map((root) => root.id);
    case "coordinateFrames":
      return manifest.coordinateFrames.map((frame) => frame.id);
    case "transforms":
      return manifest.transforms.map((transform) => transform.id);
    case "assets":
      return manifest.assets.map((asset) => asset.id);
    case "provenanceEdges":
      return manifest.provenanceEdges.map((edge) => edge.id);
    case "operationIds":
      return [
        ...new Set(manifest.provenanceEdges.map((edge) => edge.operationId)),
      ];
    case "generatedRegions":
      return manifest.generatedRegions.map((region) => region.id);
  }
}

function validateBundlePayload(
  bundle: z.infer<typeof FoundryMultiRootCaptureBundlePayloadObjectV0Schema>,
  ctx: z.RefinementCtx,
): void {
  const namespaces = bundle.mounts.map((mount) => mount.namespaceId);
  const sortedNamespaces = [...namespaces].sort(compareCanonicalStrings);
  if (
    new Set(namespaces).size !== namespaces.length ||
    namespaces.some(
      (namespaceId, index) => namespaceId !== sortedNamespaces[index],
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mounts"],
      message:
        "capture-bundle mounts must have unique namespace IDs in canonical order",
    });
  }

  if (
    bundle.manifest.projectId !== bundle.projectId ||
    bundle.manifest.createdAt !== bundle.createdAt ||
    bundle.manifest.createdBy !== bundle.createdBy
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifest"],
      message:
        "combined manifest identity metadata must match its capture bundle",
    });
  }

  if (
    bundle.manifestSha256 !==
    computeFoundryIngestManifestSha256(bundle.manifest)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestSha256"],
      message: "capture bundle must bind the exact combined ingest manifest",
    });
  }

  const expectedLegalReviewState = strictestLegalReviewState(
    bundle.mounts.map((mount) => mount.originalLegalReviewState),
  );
  if (bundle.manifest.legalReviewState !== expectedLegalReviewState) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifest", "legalReviewState"],
      message:
        "combined manifest must retain the strictest source legal-review state",
    });
  }

  for (const [mountIndex, mount] of bundle.mounts.entries()) {
    const original = mount.originalAdmissionResult;
    if (
      mount.originalProjectId !== original.manifest.projectId ||
      mount.originalResultSha256 !== original.resultSha256 ||
      mount.originalManifestSha256 !== original.manifestSha256 ||
      mount.originalReceiptSha256 !== original.receiptSha256 ||
      mount.originalReviewSha256 !== original.reviewSha256 ||
      mount.originalLegalReviewState !== original.manifest.legalReviewState
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mounts", mountIndex],
        message:
          "capture-bundle mount claims must match the embedded immutable admission result",
      });
    }
    for (const [category] of ID_MAP_CATEGORIES) {
      if (
        !sameStringSet(
          mount.idMap[category].map((entry) => entry.originalId),
          manifestIdsForCategory(original.manifest, category),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mounts", mountIndex, "idMap", category],
          message: `${category} mappings must cover the embedded original admission manifest exactly`,
        });
      }
    }
  }

  for (const [category, kind] of ID_MAP_CATEGORIES) {
    const entries = bundle.mounts.flatMap((mount) =>
      mount.idMap[category].map((entry) => ({
        ...entry,
        namespaceId: mount.namespaceId,
      })),
    );
    const combinedIds = entries.map((entry) => entry.combinedId);
    if (new Set(combinedIds).size !== combinedIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mounts"],
        message: `combined ${category} IDs must be globally unique`,
      });
    }
    for (const mount of bundle.mounts) {
      const mountEntries = mount.idMap[category];
      const originals = mountEntries.map((entry) => entry.originalId);
      const sorted = [...mountEntries].sort(compareIdMappings);
      if (
        new Set(originals).size !== originals.length ||
        mountEntries.some(
          (entry, index) => entry.originalId !== sorted[index]?.originalId,
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mounts"],
          message: `${category} mappings must have unique original IDs in canonical order`,
        });
      }
      if (
        mountEntries.some(
          (entry) =>
            entry.combinedId !==
            deriveCombinedId(mount.namespaceId, kind, entry.originalId),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mounts"],
          message: `${category} mappings must use the deterministic combined-ID derivation`,
        });
      }
    }

    if (
      !sameStringSet(
        combinedIds,
        manifestIdsForCategory(bundle.manifest, category),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mounts"],
        message: `${category} mappings must cover the combined manifest exactly`,
      });
    }
  }

  try {
    rejectCrossRootContentDuplicates(
      bundle.mounts.map((mount) => ({
        namespaceId: mount.namespaceId,
        admissionResult: mount.originalAdmissionResult,
      })),
    );
    const expectedManifest = buildCombinedManifest(
      bundle.projectId,
      bundle.createdAt,
      bundle.createdBy,
      bundle.mounts.map((mount) =>
        prepareMount(mount.namespaceId, mount.originalAdmissionResult),
      ),
    );
    if (
      computeFoundryIngestManifestSha256(expectedManifest) !==
      bundle.manifestSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest"],
        message:
          "combined manifest must be the exact deterministic remap of every embedded admission result",
      });
    }
  } catch (error: unknown) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mounts"],
      message:
        error instanceof Error
          ? `embedded admission results cannot reconstruct this capture bundle: ${error.message}`
          : "embedded admission results cannot reconstruct this capture bundle",
    });
  }
}

const FoundryMultiRootCaptureBundlePayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0),
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    mounts: z.array(FoundryMultiRootCaptureBundleMountV0Schema).min(2).max(100),
    manifest: FoundryIngestManifestV0Schema,
    manifestSha256: RuntimeSha256Schema,
    authority: z.literal("none"),
    capabilities: FoundryIntakeAdmissionCapabilitiesSchema,
  })
  .strict();

export const FoundryMultiRootCaptureBundlePayloadV0Schema =
  FoundryMultiRootCaptureBundlePayloadObjectV0Schema.superRefine(
    validateBundlePayload,
  );
export type FoundryMultiRootCaptureBundlePayloadV0 = z.infer<
  typeof FoundryMultiRootCaptureBundlePayloadV0Schema
>;

export const FoundryMultiRootCaptureBundleV0Schema =
  FoundryMultiRootCaptureBundlePayloadObjectV0Schema.extend({
    bundleSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((bundle, ctx) => {
      validateBundlePayload(bundle, ctx);
      const { bundleSha256: _bundleSha256, ...payload } = bundle;
      const parsed =
        FoundryMultiRootCaptureBundlePayloadV0Schema.safeParse(payload);
      if (!parsed.success) return;
      if (
        bundle.bundleSha256 !==
        computeFoundryMultiRootCaptureBundleSha256(parsed.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bundleSha256"],
          message:
            "capture-bundle digest must match its exact canonical payload",
        });
      }
    });
export type FoundryMultiRootCaptureBundleV0 = z.infer<
  typeof FoundryMultiRootCaptureBundleV0Schema
>;

export function computeFoundryMultiRootCaptureBundleSha256(
  bundle: FoundryMultiRootCaptureBundlePayloadV0,
): string {
  const parsed = FoundryMultiRootCaptureBundlePayloadV0Schema.parse(bundle);
  return `sha256:${domainSeparatedSha256(
    MULTI_ROOT_CAPTURE_BUNDLE_DIGEST_DOMAIN,
    toCanonicalJson(parsed),
  )}`;
}

interface PreparedMount {
  readonly binding: FoundryMultiRootCaptureBundleMountV0;
  readonly sourceRoots: FoundryIngestManifestV0["sourceRoots"];
  readonly coordinateFrames: FoundryIngestManifestV0["coordinateFrames"];
  readonly transforms: FoundryIngestManifestV0["transforms"];
  readonly assets: FoundryIngestManifestV0["assets"];
  readonly provenanceEdges: FoundryIngestManifestV0["provenanceEdges"];
  readonly generatedRegions: FoundryIngestManifestV0["generatedRegions"];
}

function prepareMount(
  namespaceId: string,
  result: FoundryIntakeAdmissionResultV0,
): PreparedMount {
  const manifest = result.manifest;
  const idMap = createIdMap(namespaceId, manifest);
  const rootIds = idLookup(idMap.sourceRoots);
  const frameIds = idLookup(idMap.coordinateFrames);
  const transformIds = idLookup(idMap.transforms);
  const assetIds = idLookup(idMap.assets);
  const edgeIds = idLookup(idMap.provenanceEdges);
  const operationIds = idLookup(idMap.operationIds);
  const regionIds = idLookup(idMap.generatedRegions);

  return {
    binding: FoundryMultiRootCaptureBundleMountV0Schema.parse({
      namespaceId,
      originalAdmissionResult: result,
      originalProjectId: manifest.projectId,
      originalResultSha256: result.resultSha256,
      originalManifestSha256: result.manifestSha256,
      originalReceiptSha256: result.receiptSha256,
      originalReviewSha256: result.reviewSha256,
      originalLegalReviewState: manifest.legalReviewState,
      idMap,
    }),
    sourceRoots: manifest.sourceRoots.map((root) => ({
      ...root,
      id: requiredCombinedId(rootIds, root.id, "source-root"),
    })),
    coordinateFrames: manifest.coordinateFrames.map((frame) => ({
      ...frame,
      id: requiredCombinedId(frameIds, frame.id, "coordinate-frame"),
      provenanceAssetIds: frame.provenanceAssetIds.map((assetId) =>
        requiredCombinedId(
          assetIds,
          assetId,
          "coordinate-frame provenance asset",
        ),
      ),
    })),
    transforms: manifest.transforms.map((transform) => ({
      ...transform,
      id: requiredCombinedId(transformIds, transform.id, "transform"),
      sourceFrameId: requiredCombinedId(
        frameIds,
        transform.sourceFrameId,
        "transform source frame",
      ),
      targetFrameId: requiredCombinedId(
        frameIds,
        transform.targetFrameId,
        "transform target frame",
      ),
      transformArtifactAssetId: optionalCombinedId(
        assetIds,
        transform.transformArtifactAssetId,
        "transform artifact asset",
      ),
      residualReportAssetId: optionalCombinedId(
        assetIds,
        transform.residualReportAssetId,
        "transform residual-report asset",
      ),
      projectionArtifactAssetId: optionalCombinedId(
        assetIds,
        transform.projectionArtifactAssetId,
        "transform projection artifact asset",
      ),
      reviewerAttestationAssetId: optionalCombinedId(
        assetIds,
        transform.reviewerAttestationAssetId,
        "transform reviewer-attestation asset",
      ),
      provenanceAssetIds: transform.provenanceAssetIds.map((assetId) =>
        requiredCombinedId(assetIds, assetId, "transform provenance asset"),
      ),
    })),
    assets: manifest.assets.map((asset) => ({
      ...asset,
      id: requiredCombinedId(assetIds, asset.id, "asset"),
      sourceRootId: requiredCombinedId(
        rootIds,
        asset.sourceRootId,
        "asset source root",
      ),
      coordinateFrameId: optionalCombinedId(
        frameIds,
        asset.coordinateFrameId,
        "asset coordinate frame",
      ),
      calibrationAssetIds: asset.calibrationAssetIds.map((assetId) =>
        requiredCombinedId(assetIds, assetId, "asset calibration"),
      ),
      parentAssetIds: asset.parentAssetIds.map((assetId) =>
        requiredCombinedId(assetIds, assetId, "asset parent"),
      ),
    })),
    provenanceEdges: manifest.provenanceEdges.map((edge) => ({
      ...edge,
      id: requiredCombinedId(edgeIds, edge.id, "provenance edge"),
      operationId: requiredCombinedId(
        operationIds,
        edge.operationId,
        "provenance operation",
      ),
      inputAssetIds: edge.inputAssetIds.map((assetId) =>
        requiredCombinedId(assetIds, assetId, "provenance input asset"),
      ),
      outputAssetId: requiredCombinedId(
        assetIds,
        edge.outputAssetId,
        "provenance output asset",
      ),
    })),
    generatedRegions: manifest.generatedRegions.map((region) => ({
      ...region,
      id: requiredCombinedId(regionIds, region.id, "generated region"),
      outputAssetId: requiredCombinedId(
        assetIds,
        region.outputAssetId,
        "generated-region output asset",
      ),
      sourceAssetIds: region.sourceAssetIds.map((assetId) =>
        requiredCombinedId(assetIds, assetId, "generated-region source asset"),
      ),
      maskAssetId: requiredCombinedId(
        assetIds,
        region.maskAssetId,
        "generated-region mask asset",
      ),
    })),
  };
}

function rejectCrossRootContentDuplicates(
  mounts: readonly {
    readonly namespaceId: string;
    readonly admissionResult: FoundryIntakeAdmissionResultV0;
  }[],
): void {
  interface ContentDeclaration {
    readonly namespaceId: string;
    readonly sourceRootId: string;
    readonly assetId: string;
  }

  const firstBySha256 = new Map<string, ContentDeclaration>();
  for (const mount of mounts) {
    for (const asset of mount.admissionResult.manifest.assets) {
      const current: ContentDeclaration = {
        namespaceId: mount.namespaceId,
        sourceRootId: asset.sourceRootId,
        assetId: asset.id,
      };
      const first = firstBySha256.get(asset.sha256);
      if (first === undefined) {
        firstBySha256.set(asset.sha256, current);
        continue;
      }
      const firstRoot = `${first.namespaceId}\u0000${first.sourceRootId}`;
      const currentRoot = `${current.namespaceId}\u0000${current.sourceRootId}`;
      if (firstRoot !== currentRoot) {
        throw new FoundryIntegrityError(
          "MULTI_ROOT_DUPLICATE_CONTENT",
          `Distinct capture roots declare identical content ${asset.sha256}: namespace '${first.namespaceId}' root '${first.sourceRootId}' asset '${first.assetId}' and namespace '${current.namespaceId}' root '${current.sourceRootId}' asset '${current.assetId}'. Exclude the original or staged duplicate during intake before composing the bundle.`,
        );
      }
    }
  }
}

function sortById<T extends { readonly id: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) =>
    compareCanonicalStrings(left.id, right.id),
  );
}

function buildCombinedManifest(
  projectId: string,
  createdAt: string,
  createdBy: string,
  prepared: readonly PreparedMount[],
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId,
    createdAt,
    createdBy,
    sourceRoots: sortById(prepared.flatMap((mount) => mount.sourceRoots)),
    coordinateFrames: sortById(
      prepared.flatMap((mount) => mount.coordinateFrames),
    ),
    transforms: sortById(prepared.flatMap((mount) => mount.transforms)),
    assets: sortById(prepared.flatMap((mount) => mount.assets)),
    provenanceEdges: sortById(
      prepared.flatMap((mount) => mount.provenanceEdges),
    ),
    generatedRegions: sortById(
      prepared.flatMap((mount) => mount.generatedRegions),
    ),
    legalReviewState: strictestLegalReviewState(
      prepared.map((mount) => mount.binding.originalLegalReviewState),
    ),
    sourceMutationPermitted: false,
  });
}

export function composeFoundryMultiRootCaptureBundleV0(
  input: unknown,
): FoundryMultiRootCaptureBundleV0 {
  // Parsing the nested admission-result schemas re-verifies both the manifest
  // digest and the admission-result self-digest before composition.
  const parsed = FoundryMultiRootCaptureBundleInputV0Schema.parse(input);
  const mounts = [...parsed.mounts].sort((left, right) =>
    compareCanonicalStrings(left.namespaceId, right.namespaceId),
  );
  rejectCrossRootContentDuplicates(mounts);

  const prepared = mounts.map((mount) =>
    prepareMount(mount.namespaceId, mount.admissionResult),
  );
  const manifest = buildCombinedManifest(
    parsed.projectId,
    parsed.createdAt,
    parsed.createdBy,
    prepared,
  );

  const payload = FoundryMultiRootCaptureBundlePayloadV0Schema.parse({
    schemaVersion: FOUNDRY_MULTI_ROOT_CAPTURE_BUNDLE_V0,
    projectId: parsed.projectId,
    createdAt: parsed.createdAt,
    createdBy: parsed.createdBy,
    mounts: prepared.map((mount) => mount.binding),
    manifest,
    manifestSha256: computeFoundryIngestManifestSha256(manifest),
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });

  return FoundryMultiRootCaptureBundleV0Schema.parse({
    ...payload,
    bundleSha256: computeFoundryMultiRootCaptureBundleSha256(payload),
  });
}

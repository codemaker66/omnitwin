import { RuntimeManifestKeySchema, RuntimeSha256Schema } from "@omnitwin/types";
import { z } from "zod";
import {
  deriveFoundryE57CropMetricRegistrationPointsV0,
  deriveFoundryE57CropMetricRegistrationSourceV0,
  FoundryE57CropMetricRegistrationSourceV0Schema,
} from "./bounded-point-source-fusion.js";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS,
  FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS,
  FoundryE57GeometryCropArtifactV0Schema,
  type FoundryE57GeometryCropArtifactV0,
} from "./e57-geometry-worker.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
  FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
  FoundryMetricRegistrationInputV0Schema,
  FoundryMetricRegistrationProposalV0Schema,
  compileFoundryMetricRegistrationProposalV0,
  computeFoundryMetricRegistrationInputSha256,
} from "./metric-registration-proposal.js";

/**
 * Binds caller-selected points from two exact generated E57 crops to the
 * existing authority-none metric-registration input. This collection is not a
 * reviewed transform, overlap result, QA decision, or source of scene truth.
 */
export const FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_INPUT_V0 =
  "omnitwin.foundry.generated-point-correspondence-collection-input.v0";
export const FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_V0 =
  "omnitwin.foundry.generated-point-correspondence-collection.v0";

const COLLECTION_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_V0";
const SOURCE_POINT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_E57_CROP_METRIC_POINT_BINDING_V0";
const BOUNDED_SHAPE_REJECTION =
  "omnitwin.foundry.generated-point-correspondence-bounded-shape-rejected";
const OPERATOR_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,159}$/u;
const MAXIMUM_DATA_ONLY_DEPTH = 32;
const MAXIMUM_DATA_ONLY_OBJECT_KEYS = 512;
const MAXIMUM_DATA_ONLY_NODES = 4_500_000;
const MAXIMUM_DATA_ONLY_STRING_LENGTH = 1_000_000;

const PointSelectorSchema = z
  .object({
    scanIndex: z
      .number()
      .int()
      .nonnegative()
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS - 1),
    sourcePointIndex: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(FOUNDRY_E57_GEOMETRY_MAXIMUM_INPUT_POINTS - 1),
  })
  .strict();

const SelectionSchema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    partition: z.enum(["fit", "held_out"]),
    sourceSelector: PointSelectorSchema,
    targetSelector: PointSelectorSchema,
    lineageClassification: z.enum(["independent", "shared_lineage"]),
  })
  .strict();

const OperatorDeclarationSchema = z
  .object({
    operatorReference: z.string().trim().regex(OPERATOR_REFERENCE),
    rationale: z.string().trim().min(1).max(4_000),
    identityAuthority: z.literal("caller_supplied_unverified"),
  })
  .strict();

const CollectionInputObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_INPUT_V0,
    ),
    collectionId: RuntimeManifestKeySchema,
    proposalId: RuntimeManifestKeySchema,
    sourceArtifact: FoundryE57GeometryCropArtifactV0Schema,
    targetArtifact: FoundryE57GeometryCropArtifactV0Schema,
    operator: OperatorDeclarationSchema,
    selections: z
      .array(SelectionSchema)
      .min(5)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    compileProposal: z.boolean(),
  })
  .strict();

const BoundedShapeRejectionSchema = z
  .literal(BOUNDED_SHAPE_REJECTION)
  .refine((_value): _value is never => false, {
    message: "a generated-point correspondence array bound was exceeded",
  });

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function selectorKey(selector: {
  readonly scanIndex: number;
  readonly sourcePointIndex: number;
}): string {
  return `${String(selector.scanIndex)}:${String(selector.sourcePointIndex)}`;
}

function validateSelectionStructure(
  input: z.infer<typeof CollectionInputObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const correspondenceIds = input.selections.map(
    ({ correspondenceId }) => correspondenceId,
  );
  const sourceKeys = input.selections.map(({ sourceSelector }) =>
    selectorKey(sourceSelector),
  );
  const targetKeys = input.selections.map(({ targetSelector }) =>
    selectorKey(targetSelector),
  );
  for (const [path, values, message] of [
    [
      ["selections", "correspondenceId"],
      correspondenceIds,
      "correspondence IDs must be unique",
    ],
    [
      ["selections", "sourceSelector"],
      sourceKeys,
      "a source point cannot be reused across correspondence pairs",
    ],
    [
      ["selections", "targetSelector"],
      targetKeys,
      "a target point cannot be reused across correspondence pairs",
    ],
  ] as const) {
    if (new Set(values).size !== values.length) {
      addIssue(ctx, path, message);
    }
  }
  const fitCount = input.selections.filter(
    ({ partition }) => partition === "fit",
  ).length;
  const heldOutCount = input.selections.length - fitCount;
  if (fitCount < 4) {
    addIssue(ctx, ["selections"], "at least four fit pairs are required");
  }
  if (heldOutCount < 1) {
    addIssue(ctx, ["selections"], "at least one held-out pair is required");
  }
}

const ValidatedCollectionInputObjectSchema =
  CollectionInputObjectSchema.superRefine(validateSelectionStructure);

export const FoundryGeneratedPointCorrespondenceCollectionInputV0Schema =
  z.preprocess(
    rejectUnsafeOrOversizedInput,
    z.union([
      ValidatedCollectionInputObjectSchema,
      BoundedShapeRejectionSchema,
    ]),
  );

export type FoundryGeneratedPointCorrespondenceCollectionInputV0 = z.infer<
  typeof FoundryGeneratedPointCorrespondenceCollectionInputV0Schema
>;

const CropBindingSchema = z
  .object({
    artifactSha256: RuntimeSha256Schema,
    sourceFactsArtifactSha256: RuntimeSha256Schema,
    sourceAssetId: z.string().min(1).max(160),
    sourceAssetRelativePath: z.string().min(1).max(4_096),
    sourceAssetSha256: RuntimeSha256Schema,
    registrationRoot: FoundryE57CropMetricRegistrationSourceV0Schema,
    coordinateFrame: z.literal("e57_root"),
    units: z.literal("meters"),
  })
  .strict();

const ResolvedPointSchema = z
  .object({
    selector: PointSelectorSchema,
    data3dGuid: z.string().min(1).max(512),
    pointId: RuntimeManifestKeySchema,
    evidenceSha256: RuntimeSha256Schema,
    coordinatesM: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  })
  .strict();

const ResolvedCorrespondenceSchema = z
  .object({
    correspondenceId: RuntimeManifestKeySchema,
    partition: z.enum(["fit", "held_out"]),
    source: ResolvedPointSchema,
    target: ResolvedPointSchema,
    lineageClassification: z.enum(["independent", "shared_lineage"]),
    lineageAuthority: z.literal("caller_supplied_unverified"),
  })
  .strict();

const CollectionAuthoritySchema = z
  .object({
    geometry: z.literal("none"),
    placement: z.literal("none"),
    measurement: z.literal("none"),
    collision: z.literal("none"),
    export: z.literal("none"),
    runtime: z.literal("none"),
  })
  .strict();

const CollectionPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_V0,
    ),
    status: z.literal("local_unverified_operator_correspondence_collection"),
    collectionId: RuntimeManifestKeySchema,
    operator: OperatorDeclarationSchema,
    sourceCrop: CropBindingSchema,
    targetCrop: CropBindingSchema,
    rootRelationship: z.literal(
      "exact_distinct_artifact_and_source_file_sha_required_source_facts_bound_per_side",
    ),
    captureLineageIndependence: z.literal("caller_supplied_unverified"),
    resolvedCorrespondences: z
      .array(ResolvedCorrespondenceSchema)
      .min(5)
      .max(FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES),
    registrationInput: FoundryMetricRegistrationInputV0Schema,
    registrationInputSha256: RuntimeSha256Schema,
    proposalCompilation: z.enum(["compiled", "not_requested"]),
    registrationProposal: FoundryMetricRegistrationProposalV0Schema.nullable(),
    sourceOverlap: z.literal("not_computed"),
    qa: z.literal("not_performed"),
    reviewedTransformArtifact: z.literal("not_created"),
    sceneAuthorityMap: z.literal("not_created"),
    authority: CollectionAuthoritySchema,
    releaseEligibility: z.literal("blocked"),
    verificationBoundary: z
      .object({
        standalonePointEvidence: z.literal(
          "self_consistent_not_artifact_membership_proof",
        ),
        exactArtifactMembership: z.literal(
          "requires_recompile_from_exact_inputs",
        ),
        operatorAuthentication: z.literal("not_provided"),
      })
      .strict(),
  })
  .strict();

type CollectionPayload = z.infer<typeof CollectionPayloadObjectSchema>;

function sameCanonical(left: unknown, right: unknown): boolean {
  return (
    stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right))
  );
}

function expectedResolvedPointIdentity(
  crop: z.infer<typeof CropBindingSchema>,
  point: z.infer<typeof ResolvedPointSchema>,
): { readonly pointId: string; readonly evidenceSha256: string } {
  const evidenceSha256 = `sha256:${domainSeparatedSha256(
    SOURCE_POINT_DIGEST_DOMAIN,
    toCanonicalJson({
      schemaVersion: "omnitwin.foundry.e57-crop-metric-point-binding.v0",
      artifactSha256: crop.artifactSha256,
      source: crop.registrationRoot,
      scanIndex: point.selector.scanIndex,
      data3dGuid: point.data3dGuid,
      sourcePointIndex: point.selector.sourcePointIndex,
      coordinatesM: point.coordinatesM,
    }),
  )}`;
  return {
    pointId: `e57-point-${evidenceSha256.slice("sha256:".length)}`,
    evidenceSha256,
  };
}

function validateCollectionPayload(
  payload: CollectionPayload,
  ctx: z.RefinementCtx,
): void {
  for (const [side, crop] of [
    ["sourceCrop", payload.sourceCrop],
    ["targetCrop", payload.targetCrop],
  ] as const) {
    const artifactHex = crop.artifactSha256.slice("sha256:".length);
    if (
      crop.registrationRoot.rootSha256 !== crop.artifactSha256 ||
      crop.registrationRoot.rootId !== `e57-crop-${artifactHex}` ||
      crop.registrationRoot.frame.frameId !== `e57-root-${artifactHex}`
    ) {
      addIssue(
        ctx,
        [side, "registrationRoot"],
        "crop registration root IDs and digest must derive from the exact crop artifact digest",
      );
    }
  }
  if (
    payload.sourceCrop.artifactSha256 === payload.targetCrop.artifactSha256 ||
    payload.sourceCrop.registrationRoot.rootSha256 ===
      payload.targetCrop.registrationRoot.rootSha256
  ) {
    addIssue(
      ctx,
      ["targetCrop", "artifactSha256"],
      "source and target must bind exact distinct crop artifacts and registration roots",
    );
  }
  const correspondenceIds = new Set<string>();
  const sourceSelectorKeys = new Set<string>();
  const targetSelectorKeys = new Set<string>();
  let duplicateKind: "correspondence" | "source" | "target" | null = null;
  let evidenceMismatch: {
    readonly index: number;
    readonly side: "source" | "target";
  } | null = null;
  for (
    let index = 0;
    index < payload.resolvedCorrespondences.length;
    index += 1
  ) {
    const resolved = payload.resolvedCorrespondences[index];
    if (resolved === undefined) continue;
    const sourceKey = selectorKey(resolved.source.selector);
    const targetKey = selectorKey(resolved.target.selector);
    if (correspondenceIds.has(resolved.correspondenceId)) {
      duplicateKind ??= "correspondence";
    }
    if (sourceSelectorKeys.has(sourceKey)) duplicateKind ??= "source";
    if (targetSelectorKeys.has(targetKey)) duplicateKind ??= "target";
    correspondenceIds.add(resolved.correspondenceId);
    sourceSelectorKeys.add(sourceKey);
    targetSelectorKeys.add(targetKey);
    if (evidenceMismatch === null) {
      for (const [side, crop, point] of [
        ["source", payload.sourceCrop, resolved.source],
        ["target", payload.targetCrop, resolved.target],
      ] as const) {
        const expected = expectedResolvedPointIdentity(crop, point);
        if (
          point.pointId !== expected.pointId ||
          point.evidenceSha256 !== expected.evidenceSha256
        ) {
          evidenceMismatch = { index, side };
          break;
        }
      }
    }
  }
  if (duplicateKind !== null) {
    addIssue(
      ctx,
      ["resolvedCorrespondences"],
      `${duplicateKind} identities must be unique across resolved pairs`,
    );
  }
  if (evidenceMismatch !== null) {
    addIssue(
      ctx,
      [
        "resolvedCorrespondences",
        evidenceMismatch.index,
        evidenceMismatch.side,
      ],
      "point ID and evidence digest must reproduce from the crop root, exact selector, data3D GUID, and coordinates",
    );
  }
  if (
    payload.sourceCrop.sourceAssetSha256 ===
    payload.targetCrop.sourceAssetSha256
  ) {
    addIssue(
      ctx,
      ["targetCrop", "sourceAssetSha256"],
      "source and target cannot alias one physical source-file digest",
    );
  }
  if (
    payload.registrationInputSha256 !==
    computeFoundryMetricRegistrationInputSha256(payload.registrationInput)
  ) {
    addIssue(
      ctx,
      ["registrationInputSha256"],
      "registration input digest must match the embedded exact input",
    );
  }
  if (
    !sameCanonical(
      payload.sourceCrop.registrationRoot,
      payload.registrationInput.source,
    ) ||
    !sameCanonical(
      payload.targetCrop.registrationRoot,
      payload.registrationInput.target,
    )
  ) {
    addIssue(
      ctx,
      ["registrationInput"],
      "registration roots must match the exact source and target crop bindings",
    );
  }
  const expectedCorrespondences = payload.resolvedCorrespondences.map(
    (resolved) => ({
      correspondenceId: resolved.correspondenceId,
      source: {
        pointId: resolved.source.pointId,
        evidenceSha256: resolved.source.evidenceSha256,
        coordinates: resolved.source.coordinatesM,
      },
      target: {
        pointId: resolved.target.pointId,
        evidenceSha256: resolved.target.evidenceSha256,
        coordinates: resolved.target.coordinatesM,
      },
      lineageClassification: resolved.lineageClassification,
    }),
  );
  if (
    !sameCanonical(
      expectedCorrespondences,
      payload.registrationInput.correspondences,
    )
  ) {
    addIssue(
      ctx,
      ["registrationInput", "correspondences"],
      "registration correspondence order and evidence must match every resolved selector",
    );
  }
  const expectedFit = payload.resolvedCorrespondences
    .filter(({ partition }) => partition === "fit")
    .map(({ correspondenceId }) => correspondenceId);
  const expectedHeldOut = payload.resolvedCorrespondences
    .filter(({ partition }) => partition === "held_out")
    .map(({ correspondenceId }) => correspondenceId);
  if (
    !sameCanonical(payload.registrationInput.partitions, {
      declaration: "fixed_before_solve",
      fitCorrespondenceIds: expectedFit,
      heldOutCorrespondenceIds: expectedHeldOut,
    })
  ) {
    addIssue(
      ctx,
      ["registrationInput", "partitions"],
      "fixed partitions must exactly preserve the declared pair order",
    );
  }
  const compiled = payload.proposalCompilation === "compiled";
  if (
    (compiled &&
      (payload.registrationProposal === null ||
        payload.registrationProposal.registrationInputSha256 !==
          payload.registrationInputSha256)) ||
    (!compiled && payload.registrationProposal !== null)
  ) {
    addIssue(
      ctx,
      ["registrationProposal"],
      "proposal presence and exact input digest must match compilation status",
    );
  }
}

const ValidatedCollectionPayloadSchema =
  CollectionPayloadObjectSchema.superRefine(validateCollectionPayload);

export const FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema =
  z.preprocess(
    rejectUnsafeOrOversizedPayload,
    z.union([ValidatedCollectionPayloadSchema, BoundedShapeRejectionSchema]),
  );

export type FoundryGeneratedPointCorrespondenceCollectionPayloadV0 = z.infer<
  typeof FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema
>;

const CollectionObjectSchema = CollectionPayloadObjectSchema.extend({
  collectionSha256: RuntimeSha256Schema,
}).strict();

const ValidatedCollectionObjectSchema = CollectionObjectSchema.superRefine(
  (collection, ctx) => {
    const { collectionSha256, ...payload } = collection;
    validateCollectionPayload(payload, ctx);
    if (collectionDigest(payload) !== collectionSha256) {
      addIssue(
        ctx,
        ["collectionSha256"],
        "collection digest must match its canonical payload",
      );
    }
  },
);

export const FoundryGeneratedPointCorrespondenceCollectionV0Schema =
  z.preprocess(
    rejectUnsafeOrOversizedPayload,
    z.union([ValidatedCollectionObjectSchema, BoundedShapeRejectionSchema]),
  );

export type FoundryGeneratedPointCorrespondenceCollectionV0 = z.infer<
  typeof FoundryGeneratedPointCorrespondenceCollectionV0Schema
>;

class BoundedDataOnlyShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedDataOnlyShapeError";
  }
}

interface DataOnlyCloneBudget {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function maximumArrayLength(path: readonly (string | number)[]): number {
  return path.length === 2 &&
    (path[0] === "sourceArtifact" || path[0] === "targetArtifact") &&
    path[1] === "points"
    ? FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS
    : FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES;
}

function consumeDataOnlyNode(budget: DataOnlyCloneBudget): void {
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_DATA_ONLY_NODES) {
    throw new BoundedDataOnlyShapeError(
      "the bounded data-only node budget was exceeded",
    );
  }
}

function cloneBoundedDataOnly(
  value: unknown,
  path: readonly (string | number)[] = [],
  depth = 0,
  budget: DataOnlyCloneBudget = {
    nodes: 0,
    ancestors: new WeakSet<object>(),
  },
): unknown {
  consumeDataOnlyNode(budget);
  if (depth > MAXIMUM_DATA_ONLY_DEPTH) {
    throw new BoundedDataOnlyShapeError(
      "the bounded data-only nesting depth was exceeded",
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAXIMUM_DATA_ONLY_STRING_LENGTH) {
      throw new BoundedDataOnlyShapeError(
        "a bounded data-only string length was exceeded",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new BoundedDataOnlyShapeError(
      "only JSON-compatible data values are accepted",
    );
  }
  if (budget.ancestors.has(value)) {
    throw new BoundedDataOnlyShapeError(
      "cyclic input is not accepted at a data-only boundary",
    );
  }
  budget.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > maximumArrayLength(path)
      ) {
        throw new BoundedDataOnlyShapeError(
          "an array has an unsafe or oversized length",
        );
      }
      const clone: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          throw new BoundedDataOnlyShapeError(
            "array slots must be enumerable own data properties",
          );
        }
        clone.push(
          cloneBoundedDataOnly(
            descriptor.value,
            [...path, index],
            depth + 1,
            budget,
          ),
        );
      }
      return clone;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BoundedDataOnlyShapeError(
        "objects must have a plain or null prototype",
      );
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAXIMUM_DATA_ONLY_OBJECT_KEYS) {
      throw new BoundedDataOnlyShapeError(
        "an object key-count bound was exceeded",
      );
    }
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") {
        throw new BoundedDataOnlyShapeError(
          "symbol-keyed input is not accepted",
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw new BoundedDataOnlyShapeError(
          "object members must be enumerable own data properties",
        );
      }
      clone[key] = cloneBoundedDataOnly(
        descriptor.value,
        [...path, key],
        depth + 1,
        budget,
      );
    }
    return clone;
  } finally {
    budget.ancestors.delete(value);
  }
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayMember(
  record: Record<string, unknown> | null,
  key: string,
): readonly unknown[] | null {
  if (record === null) return null;
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function arrayUnsafeOrExceeds(
  record: Record<string, unknown> | null,
  key: string,
  maximum: number,
): boolean {
  const value = arrayMember(record, key);
  return (
    value !== null && (value.length > maximum || arrayHasUnsafeSlots(value))
  );
}

function arrayHasUnsafeSlots(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return true;
  }
  return false;
}

function artifactArraysUnsafeOrOversized(value: unknown): boolean {
  const artifact = unknownRecord(value);
  const points = arrayMember(artifact, "points");
  if (
    points !== null &&
    (points.length > FOUNDRY_E57_GEOMETRY_MAXIMUM_OUTPUT_POINTS ||
      arrayHasUnsafeSlots(points))
  ) {
    return true;
  }
  const description = unknownRecord(artifact?.readerDescription);
  const scans = arrayMember(description, "scans");
  if (
    scans !== null &&
    (scans.length > FOUNDRY_E57_GEOMETRY_MAXIMUM_SCANS ||
      arrayHasUnsafeSlots(scans))
  ) {
    return true;
  }
  if (scans !== null) {
    for (let index = 0; index < scans.length; index += 1) {
      const fields = arrayMember(unknownRecord(scans[index]), "pointFields");
      if (
        fields !== null &&
        (fields.length > 256 || arrayHasUnsafeSlots(fields))
      ) {
        return true;
      }
    }
  }
  return false;
}

function inputUnsafeOrOversized(value: unknown): boolean {
  const input = unknownRecord(value);
  const selections = arrayMember(input, "selections");
  return (
    (selections !== null &&
      (selections.length > FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES ||
        arrayHasUnsafeSlots(selections))) ||
    artifactArraysUnsafeOrOversized(input?.sourceArtifact) ||
    artifactArraysUnsafeOrOversized(input?.targetArtifact)
  );
}

function metricInputArraysUnsafeOrOversized(value: unknown): boolean {
  const input = unknownRecord(value);
  const partitions = unknownRecord(input?.partitions);
  return (
    arrayUnsafeOrExceeds(
      input,
      "correspondences",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      partitions,
      "fitCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      partitions,
      "heldOutCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    )
  );
}

function proposalArraysUnsafeOrOversized(value: unknown): boolean {
  const proposal = unknownRecord(value);
  if (proposal === null) return false;
  const partitions = unknownRecord(proposal.partitions);
  const fitEvaluation = unknownRecord(proposal.fitEvaluation);
  const heldOutEvaluation = unknownRecord(proposal.heldOutEvaluation);
  const solve = unknownRecord(proposal.solve);
  return (
    arrayUnsafeOrExceeds(
      proposal,
      "correspondenceOrder",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      partitions,
      "fitCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      partitions,
      "heldOutCorrespondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      fitEvaluation,
      "correspondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      fitEvaluation,
      "records",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      heldOutEvaluation,
      "correspondenceIds",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(
      heldOutEvaluation,
      "records",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    arrayUnsafeOrExceeds(solve, "matrixColumnMajor", 16)
  );
}

function payloadUnsafeOrOversized(value: unknown): boolean {
  const payload = unknownRecord(value);
  return (
    arrayUnsafeOrExceeds(
      payload,
      "resolvedCorrespondences",
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
    ) ||
    metricInputArraysUnsafeOrOversized(payload?.registrationInput) ||
    proposalArraysUnsafeOrOversized(payload?.registrationProposal)
  );
}

function rejectUnsafeOrOversizedInput(value: unknown): unknown {
  try {
    const clone = cloneBoundedDataOnly(value);
    return inputUnsafeOrOversized(clone) ? BOUNDED_SHAPE_REJECTION : clone;
  } catch {
    return BOUNDED_SHAPE_REJECTION;
  }
}

function rejectUnsafeOrOversizedPayload(value: unknown): unknown {
  try {
    const clone = cloneBoundedDataOnly(value);
    return payloadUnsafeOrOversized(clone) ? BOUNDED_SHAPE_REJECTION : clone;
  } catch {
    return BOUNDED_SHAPE_REJECTION;
  }
}

function preflightInput(input: unknown): unknown {
  try {
    const clone = cloneBoundedDataOnly(input);
    if (!inputUnsafeOrOversized(clone)) return clone;
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_LIMIT_EXCEEDED",
      "Correspondence input must be bounded data-only JSON with no accessors, proxy failures, unsafe slots, cycles, or oversized nested members.",
      { cause: error },
    );
  }
  throw new FoundryIntegrityError(
    "GENERATED_POINT_CORRESPONDENCE_LIMIT_EXCEEDED",
    "Correspondence selection, crop point, scan, or point-field arrays exceed the bounded generated-point collection contract.",
  );
}

function requireDistinctPhysicalRoots(
  source: FoundryE57GeometryCropArtifactV0,
  target: FoundryE57GeometryCropArtifactV0,
): void {
  if (source.artifactSha256 === target.artifactSha256) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_ARTIFACT_NOT_DISTINCT",
      "Source and target must be exact distinct generated crop artifacts.",
    );
  }
  if (source.source.sha256 === target.source.sha256) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_PHYSICAL_SOURCE_NOT_DISTINCT",
      "Changing an asset ID, path, or metadata cannot make one exact source-file SHA-256 an independent registration root.",
    );
  }
}

function assertUniqueSelections(
  selections: readonly z.infer<typeof SelectionSchema>[],
): void {
  const correspondenceIds = new Set<string>();
  const sourceKeys = new Set<string>();
  const targetKeys = new Set<string>();
  for (const selection of selections) {
    if (correspondenceIds.has(selection.correspondenceId)) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_ID_DUPLICATE",
        "Correspondence IDs must be unique in their exact declared order.",
      );
    }
    const sourceKey = selectorKey(selection.sourceSelector);
    const targetKey = selectorKey(selection.targetSelector);
    if (sourceKeys.has(sourceKey)) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_SOURCE_POINT_REUSED",
        "A retained source point cannot control more than one pair or partition.",
      );
    }
    if (targetKeys.has(targetKey)) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_TARGET_POINT_REUSED",
        "A retained target point cannot control more than one pair or partition.",
      );
    }
    correspondenceIds.add(selection.correspondenceId);
    sourceKeys.add(sourceKey);
    targetKeys.add(targetKey);
  }
  const fitCount = selections.filter(
    ({ partition }) => partition === "fit",
  ).length;
  if (fitCount < 4 || selections.length - fitCount < 1) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_PARTITION_COUNTS_INVALID",
      "The fixed pre-solve partition requires at least four fit pairs and one held-out pair.",
    );
  }
}

function retainedPointMap(
  artifact: FoundryE57GeometryCropArtifactV0,
  selectors: readonly z.infer<typeof PointSelectorSchema>[],
): ReadonlyMap<string, FoundryE57GeometryCropArtifactV0["points"][number]> {
  const requested = new Set(selectors.map(selectorKey));
  const found = new Map<
    string,
    FoundryE57GeometryCropArtifactV0["points"][number]
  >();
  for (const point of artifact.points) {
    const key = selectorKey(point);
    if (requested.has(key)) found.set(key, point);
  }
  return found;
}

function resolvePoints(
  side: "source" | "target",
  artifact: FoundryE57GeometryCropArtifactV0,
  selectors: readonly z.infer<typeof PointSelectorSchema>[],
) {
  const retained = retainedPointMap(artifact, selectors);
  for (const selector of selectors) {
    if (!retained.has(selectorKey(selector))) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_POINT_MISSING",
        `A ${side} selector does not identify an exact retained point in its bound crop artifact.`,
      );
    }
  }
  const bindings = deriveFoundryE57CropMetricRegistrationPointsV0(
    artifact,
    selectors,
  );
  return bindings.map((binding, index) => {
    const selector = selectors[index];
    if (selector === undefined) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_INTERNAL_MISMATCH",
        `The ${side} selector order was not preserved.`,
      );
    }
    const point = retained.get(selectorKey(selector));
    if (point === undefined) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_INTERNAL_MISMATCH",
        `The ${side} retained point disappeared during deterministic resolution.`,
      );
    }
    return ResolvedPointSchema.parse({
      selector,
      data3dGuid: point.data3dGuid,
      pointId: binding.pointId,
      evidenceSha256: binding.evidenceSha256,
      coordinatesM: binding.coordinates,
    });
  });
}

function cropBinding(artifact: FoundryE57GeometryCropArtifactV0) {
  return CropBindingSchema.parse({
    artifactSha256: artifact.artifactSha256,
    sourceFactsArtifactSha256: artifact.sourceFactsArtifactSha256,
    sourceAssetId: artifact.source.assetId,
    sourceAssetRelativePath: artifact.source.relativePath,
    sourceAssetSha256: artifact.source.sha256,
    registrationRoot: deriveFoundryE57CropMetricRegistrationSourceV0(artifact),
    coordinateFrame: "e57_root",
    units: "meters",
  });
}

function collectionDigest(payload: CollectionPayload): string {
  return `sha256:${domainSeparatedSha256(
    COLLECTION_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  )}`;
}

function computeCollectionSha256Internal(payloadInput: unknown): string {
  const parsed =
    FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema.safeParse(
      payloadInput,
    );
  if (!parsed.success) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_PAYLOAD_INVALID",
      "A collection digest requires a bounded self-consistent authority-none payload.",
      { cause: parsed.error },
    );
  }
  return collectionDigest(parsed.data);
}

function compileCollectionInternal(
  input: unknown,
): FoundryGeneratedPointCorrespondenceCollectionV0 {
  const boundedInput = preflightInput(input);
  const parsedInput = CollectionInputObjectSchema.safeParse(boundedInput);
  if (!parsedInput.success) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_INPUT_INVALID",
      "Generated-point collection requires two exact crop artifacts, bounded ordered selectors, explicit fixed partitions, and an unverified operator declaration.",
      { cause: parsedInput.error },
    );
  }
  const parsed = parsedInput.data;
  assertUniqueSelections(parsed.selections);
  requireDistinctPhysicalRoots(parsed.sourceArtifact, parsed.targetArtifact);

  const sourcePoints = resolvePoints(
    "source",
    parsed.sourceArtifact,
    parsed.selections.map(({ sourceSelector }) => sourceSelector),
  );
  const targetPoints = resolvePoints(
    "target",
    parsed.targetArtifact,
    parsed.selections.map(({ targetSelector }) => targetSelector),
  );
  const resolvedCorrespondences = parsed.selections.map((selection, index) => {
    const source = sourcePoints[index];
    const target = targetPoints[index];
    if (source === undefined || target === undefined) {
      throw new FoundryIntegrityError(
        "GENERATED_POINT_CORRESPONDENCE_INTERNAL_MISMATCH",
        "Exact source and target point resolution did not preserve pair order.",
      );
    }
    return ResolvedCorrespondenceSchema.parse({
      correspondenceId: selection.correspondenceId,
      partition: selection.partition,
      source,
      target,
      lineageClassification: selection.lineageClassification,
      lineageAuthority: "caller_supplied_unverified",
    });
  });
  const sourceCrop = cropBinding(parsed.sourceArtifact);
  const targetCrop = cropBinding(parsed.targetArtifact);
  const registrationInput = FoundryMetricRegistrationInputV0Schema.parse({
    schemaVersion: FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
    proposalId: parsed.proposalId,
    source: sourceCrop.registrationRoot,
    target: targetCrop.registrationRoot,
    correspondences: resolvedCorrespondences.map((resolved) => ({
      correspondenceId: resolved.correspondenceId,
      source: {
        pointId: resolved.source.pointId,
        evidenceSha256: resolved.source.evidenceSha256,
        coordinates: resolved.source.coordinatesM,
      },
      target: {
        pointId: resolved.target.pointId,
        evidenceSha256: resolved.target.evidenceSha256,
        coordinates: resolved.target.coordinatesM,
      },
      lineageClassification: resolved.lineageClassification,
    })),
    partitions: {
      declaration: "fixed_before_solve",
      fitCorrespondenceIds: resolvedCorrespondences
        .filter(({ partition }) => partition === "fit")
        .map(({ correspondenceId }) => correspondenceId),
      heldOutCorrespondenceIds: resolvedCorrespondences
        .filter(({ partition }) => partition === "held_out")
        .map(({ correspondenceId }) => correspondenceId),
    },
  });
  const registrationInputSha256 =
    computeFoundryMetricRegistrationInputSha256(registrationInput);
  const registrationProposal = parsed.compileProposal
    ? compileFoundryMetricRegistrationProposalV0(registrationInput)
    : null;
  const payloadDecision =
    FoundryGeneratedPointCorrespondenceCollectionPayloadV0Schema.safeParse({
      schemaVersion: FOUNDRY_GENERATED_POINT_CORRESPONDENCE_COLLECTION_V0,
      status: "local_unverified_operator_correspondence_collection",
      collectionId: parsed.collectionId,
      operator: parsed.operator,
      sourceCrop,
      targetCrop,
      rootRelationship:
        "exact_distinct_artifact_and_source_file_sha_required_source_facts_bound_per_side",
      captureLineageIndependence: "caller_supplied_unverified",
      resolvedCorrespondences,
      registrationInput,
      registrationInputSha256,
      proposalCompilation: parsed.compileProposal
        ? "compiled"
        : "not_requested",
      registrationProposal,
      sourceOverlap: "not_computed",
      qa: "not_performed",
      reviewedTransformArtifact: "not_created",
      sceneAuthorityMap: "not_created",
      authority: {
        geometry: "none",
        placement: "none",
        measurement: "none",
        collision: "none",
        export: "none",
        runtime: "none",
      },
      releaseEligibility: "blocked",
      verificationBoundary: {
        standalonePointEvidence:
          "self_consistent_not_artifact_membership_proof",
        exactArtifactMembership: "requires_recompile_from_exact_inputs",
        operatorAuthentication: "not_provided",
      },
    });
  if (!payloadDecision.success) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_OUTPUT_INVALID",
      "The exact selector collection could not form a bounded self-consistent payload.",
      { cause: payloadDecision.error },
    );
  }
  const payload = payloadDecision.data;
  const collectionDecision =
    FoundryGeneratedPointCorrespondenceCollectionV0Schema.safeParse({
      ...payload,
      collectionSha256: collectionDigest(payload),
    });
  if (!collectionDecision.success) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_OUTPUT_INVALID",
      "The exact selector collection failed its sealed output contract.",
      { cause: collectionDecision.error },
    );
  }
  return collectionDecision.data;
}

/**
 * Rebuilds every output byte from the two exact crops, point selectors,
 * partitions, and caller declaration. A standalone digest cannot replace this
 * verifier or authenticate the operator declaration.
 */
function verifyCollectionInternal(
  collectionInput: unknown,
  exactInput: unknown,
): FoundryGeneratedPointCorrespondenceCollectionV0 {
  const collectionDecision =
    FoundryGeneratedPointCorrespondenceCollectionV0Schema.safeParse(
      collectionInput,
    );
  if (!collectionDecision.success) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_COLLECTION_INVALID",
      "Exact verification requires a bounded self-consistent sealed collection.",
      { cause: collectionDecision.error },
    );
  }
  const collection = collectionDecision.data;
  const expected = compileCollectionInternal(exactInput);
  if (!sameCanonical(collection, expected)) {
    throw new FoundryIntegrityError(
      "GENERATED_POINT_CORRESPONDENCE_RECOMPUTATION_MISMATCH",
      "The collection does not reproduce from the exact crop artifacts, ordered selectors, fixed partitions, and operator declaration.",
    );
  }
  return collection;
}

function normalizePublicBoundaryFailure(
  error: unknown,
  code: string,
  message: string,
): never {
  if (error instanceof FoundryIntegrityError) throw error;
  throw new FoundryIntegrityError(code, message, { cause: error });
}

export function computeFoundryGeneratedPointCorrespondenceCollectionSha256(
  payloadInput: unknown,
): string {
  try {
    return computeCollectionSha256Internal(payloadInput);
  } catch (error: unknown) {
    return normalizePublicBoundaryFailure(
      error,
      "GENERATED_POINT_CORRESPONDENCE_DIGEST_BOUNDARY_FAILURE",
      "The collection digest boundary rejected a non-data-only or unexpected input failure.",
    );
  }
}

export function compileFoundryGeneratedPointCorrespondenceCollectionV0(
  input: unknown,
): FoundryGeneratedPointCorrespondenceCollectionV0 {
  try {
    return compileCollectionInternal(input);
  } catch (error: unknown) {
    return normalizePublicBoundaryFailure(
      error,
      "GENERATED_POINT_CORRESPONDENCE_COMPILE_BOUNDARY_FAILURE",
      "The collection compiler rejected a non-data-only or unexpected input failure.",
    );
  }
}

export function verifyFoundryGeneratedPointCorrespondenceCollectionV0(
  collectionInput: unknown,
  exactInput: unknown,
): FoundryGeneratedPointCorrespondenceCollectionV0 {
  try {
    return verifyCollectionInternal(collectionInput, exactInput);
  } catch (error: unknown) {
    return normalizePublicBoundaryFailure(
      error,
      "GENERATED_POINT_CORRESPONDENCE_VERIFY_BOUNDARY_FAILURE",
      "The exact collection verifier rejected a non-data-only or unexpected input failure.",
    );
  }
}

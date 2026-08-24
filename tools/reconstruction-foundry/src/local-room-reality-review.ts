import {
  FoundryE57GeometryCropArtifactV0Schema,
  FoundryRoomRealityPackageAssemblyResultV0Schema,
  type FoundryE57GeometryCropArtifactV0,
  type FoundryRoomRealityPackageAssemblyResultV0,
} from "@omnitwin/reconstruction-foundry";
import {
  CanonicalJsonValueSchema,
  FoundryUtcInstantSchema,
  ReconstructionQaReportSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  RuntimeManifestKeySchema,
  TransformArtifactV0Schema,
  computeReconstructionReviewEvidenceArtifactDigest,
  sha256Hex,
  stableCanonicalJson,
  type ReconstructionQaReport,
  type ReconstructionSceneAuthorityMapV0,
  type TransformArtifactV0,
} from "@omnitwin/types";

export const LOCAL_ROOM_REALITY_REVIEW_SURFACE_V0 =
  "omnitwin.local-foundry.room-reality-review-surface.v0";
export const LOCAL_ROOM_REALITY_REVIEW_DRAFT_V0 =
  "omnitwin.local-foundry.room-reality-review-draft.v0";
export const LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS = [
  "source_comparison",
  "alignment",
  "scale",
  "crop",
  "completeness",
  "privacy",
  "movable_objects",
] as const;
export const LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0 =
  "omnitwin.local-foundry.e57-visual-inspection-draft.v0";
export const LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS = [
  "source_comparison",
  "alignment",
  "scale",
  "crop",
  "completeness",
  "privacy",
  "movable_objects",
] as const;
export const LOCAL_E57_VISUAL_MAX_FILE_BYTES = 12 * 1_024 * 1_024;
export const LOCAL_E57_VISUAL_MAX_POINTS = 50_000;
export const LOCAL_E57_VISUAL_MIN_COMPARISON_OPACITY = 0.05;

const REVIEW_SURFACE_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_ROOM_REALITY_REVIEW_SURFACE_V0";
const REVIEW_DRAFT_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_ROOM_REALITY_REVIEW_DRAFT_V0";
const E57_VISUAL_VIEW_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_E57_VISUAL_INSPECTION_VIEW_V0";
const E57_VISUAL_DRAFT_DIGEST_DOMAIN =
  "VENVIEWER_LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0";
const MAX_SUPPORTING_EVIDENCE_ITEMS = 2_000;
const MIN_REVIEW_NOTE_LENGTH = 12;
const MAX_REVIEW_NOTE_LENGTH = 1_000;
const MAX_VISUAL_ANNOTATIONS = 100;
const MAX_ABSOLUTE_VISUAL_COORDINATE = 1_000_000_000;

export type LocalRoomRealityReviewDimensionId =
  (typeof LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS)[number];

export type LocalRoomRealityReviewObservedStatus =
  | "not_performed"
  | "not_reviewed"
  | "not_verified"
  | "reference_ids_only"
  | "partially_validated_untrusted"
  | "contract_validated_untrusted"
  | "qa_reported_untrusted"
  | "unavailable";

export type LocalRoomRealityReviewAction =
  | "record_unresolved"
  | "request_digest_bound_source_comparison"
  | "request_reviewed_transform_correction"
  | "request_independent_metric_scale_control"
  | "request_digest_bound_crop_correction"
  | "request_coverage_evidence"
  | "request_privacy_redaction"
  | "request_movable_object_mask"
  | "block_local_candidate";

interface LocalRoomRealityEvidenceWrapper<T> {
  readonly id: string;
  readonly artifact: T;
}

export interface LocalRoomRealityReviewDossierV0 {
  readonly candidate: FoundryRoomRealityPackageAssemblyResultV0;
  readonly evidence: {
    readonly transforms: readonly LocalRoomRealityEvidenceWrapper<TransformArtifactV0>[];
    readonly sceneAuthorityMaps: readonly LocalRoomRealityEvidenceWrapper<ReconstructionSceneAuthorityMapV0>[];
    readonly qualityReports: readonly LocalRoomRealityEvidenceWrapper<ReconstructionQaReport>[];
  };
}

export interface LocalRoomRealityReviewActionOptionV0 {
  readonly id: LocalRoomRealityReviewAction;
  readonly label: string;
  readonly meaning: string;
}

export interface LocalRoomRealityReviewDimensionV0 {
  readonly id: LocalRoomRealityReviewDimensionId;
  readonly label: string;
  readonly observedStatus: LocalRoomRealityReviewObservedStatus;
  readonly finding: string;
  readonly decisiveNextAction: string;
  readonly evidenceReferences: readonly string[];
  readonly allowedActions: readonly LocalRoomRealityReviewActionOptionV0[];
}

export interface LocalRoomRealityTransformSummaryV0 {
  readonly referenceId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly sourceFrame: string;
  readonly targetFrame: string;
  readonly units: "meters";
  readonly alignmentMethod: string;
  readonly residualRmseM: number | null;
  readonly landmarkCount: number;
  readonly matrix: readonly number[];
  readonly trust: "strict_contract_body_untrusted_identity";
}

export interface LocalRoomRealitySceneAuthoritySummaryV0 {
  readonly referenceId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly regionCount: number;
  readonly truthStatuses: readonly string[];
  readonly reconstructionStrategies: readonly string[];
  readonly exportAuthorityNoneCount: number;
  readonly transformLinks: readonly {
    readonly artifactId: string;
    readonly artifactDigest: string;
    readonly state: "matched_untrusted_body" | "missing_or_mismatched";
  }[];
  readonly trust: "strict_contract_body_untrusted_identity";
}

export interface LocalRoomRealityQaSummaryV0 {
  readonly referenceId: string;
  readonly reportDigest: string;
  readonly releaseDigest: string;
  readonly outcome: "passed" | "failed";
  readonly profileVersion: string;
  readonly checks: readonly {
    readonly checkKey: string;
    readonly status: "passed" | "failed";
  }[];
  readonly trust: "strict_contract_body_untrusted_identity";
}

interface LocalRoomRealityReviewSurfacePayloadV0 {
  readonly schemaVersion: typeof LOCAL_ROOM_REALITY_REVIEW_SURFACE_V0;
  readonly meaning: "local_metadata_and_contract_review_only";
  readonly authority: "none";
  readonly candidate: {
    readonly assemblySha256: string;
    readonly packageId: string;
    readonly projectId: string;
    readonly status: "local_unverified_candidate" | "blocked";
    readonly releaseEligibility: "blocked";
    readonly releaseBlockers: readonly string[];
    readonly ingestLegalReviewState: string;
  };
  readonly inspectionBoundary: {
    readonly realMediaRead: "not_performed";
    readonly sourcePixelsCompared: "not_performed";
    readonly geometryDecoded: "not_performed";
    readonly exactMemberIdentities: "not_verified";
    readonly referenceCatalogAuthority: "caller_supplied_unverified";
    readonly correctionApplication: "disabled";
  };
  readonly contractEvidence: {
    readonly transformReferenceIds: readonly string[];
    readonly sceneAuthorityMapReferenceIds: readonly string[];
    readonly qualityReportReferenceIds: readonly string[];
    readonly transforms: readonly LocalRoomRealityTransformSummaryV0[];
    readonly sceneAuthorityMaps: readonly LocalRoomRealitySceneAuthoritySummaryV0[];
    readonly qualityReports: readonly LocalRoomRealityQaSummaryV0[];
  };
  readonly dimensions: readonly LocalRoomRealityReviewDimensionV0[];
  readonly capabilities: {
    readonly execution: "not_authorized";
    readonly correctionApplication: "not_authorized";
    readonly packageExport: "not_authorized";
    readonly signing: "not_authorized";
    readonly publication: "not_authorized";
    readonly runtimeActivation: "not_authorized";
  };
  readonly furnitureBoundary: "movable_furniture_is_separate_planner_state_and_never_room_authority";
}

export interface LocalRoomRealityReviewSurfaceV0 extends LocalRoomRealityReviewSurfacePayloadV0 {
  readonly reviewSurfaceSha256: string;
}

export interface LocalRoomRealityReviewDecisionInputV0 {
  readonly dimensionId: LocalRoomRealityReviewDimensionId;
  readonly action: LocalRoomRealityReviewAction;
  readonly note: string;
}

export interface LocalRoomRealityReviewDraftInputV0 {
  readonly reviewSurfaceSha256: string;
  readonly candidateAssemblySha256: string;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly decisions: readonly LocalRoomRealityReviewDecisionInputV0[];
}

interface LocalRoomRealityReviewDraftPayloadV0 {
  readonly schemaVersion: typeof LOCAL_ROOM_REALITY_REVIEW_DRAFT_V0;
  readonly meaning: "local_correction_and_decision_draft_only";
  readonly authority: "none";
  readonly subject: {
    readonly reviewSurfaceSha256: string;
    readonly candidateAssemblySha256: string;
    readonly packageId: string;
    readonly projectId: string;
  };
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly disposition: "remains_unverified" | "blocked_by_operator_draft";
  readonly decisions: readonly {
    readonly dimensionId: LocalRoomRealityReviewDimensionId;
    readonly observedStatus: LocalRoomRealityReviewObservedStatus;
    readonly action: LocalRoomRealityReviewAction;
    readonly note: string;
  }[];
  readonly releaseEligibility: "blocked";
  readonly capabilities: LocalRoomRealityReviewSurfacePayloadV0["capabilities"];
}

export interface LocalRoomRealityReviewDraftV0 extends LocalRoomRealityReviewDraftPayloadV0 {
  readonly reviewDraftSha256: string;
}

export class LocalRoomRealityReviewError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalRoomRealityReviewError";
  }
}

interface ReferencedContractIds {
  readonly transforms: readonly string[];
  readonly sceneAuthorityMaps: readonly string[];
  readonly qualityReports: readonly string[];
  readonly representationAssets: readonly string[];
}

interface DimensionSpec {
  readonly id: LocalRoomRealityReviewDimensionId;
  readonly label: string;
  readonly requestAction: LocalRoomRealityReviewAction;
  readonly requestLabel: string;
  readonly requestMeaning: string;
  readonly finding: string;
  readonly decisiveNextAction: string;
}

const DIMENSION_SPECS: readonly DimensionSpec[] = [
  {
    id: "source_comparison",
    label: "Source comparison",
    requestAction: "request_digest_bound_source_comparison",
    requestLabel: "Request exact source comparison",
    requestMeaning:
      "Ask for a digest-bound visual or geometric comparison without changing this candidate.",
    finding:
      "No source pixels, point samples, meshes, or overlays were loaded by this review surface.",
    decisiveNextAction:
      "Compare exact source and candidate members in a separately reviewed local viewer and bind the result to their digests.",
  },
  {
    id: "alignment",
    label: "Alignment",
    requestAction: "request_reviewed_transform_correction",
    requestLabel: "Request transform correction",
    requestMeaning:
      "Ask for a new reviewed TransformArtifactV0; this draft cannot alter a matrix.",
    finding:
      "Transform contract bodies can be summarized here, but their identity and registration quality remain unauthenticated.",
    decisiveNextAction:
      "Verify exact TransformArtifactV0 bytes, frame direction, residuals, landmarks, and independent control before accepting alignment.",
  },
  {
    id: "scale",
    label: "Metric scale",
    requestAction: "request_independent_metric_scale_control",
    requestLabel: "Request metric scale control",
    requestMeaning:
      "Ask for independent measured control tied to the transform and candidate digests.",
    finding:
      "A valid transform body may declare metres, but a declaration alone does not prove physical scale.",
    decisiveNextAction:
      "Compare known measured distances against the candidate in CVF and record tolerances and residuals.",
  },
  {
    id: "crop",
    label: "Crop and review bounds",
    requestAction: "request_digest_bound_crop_correction",
    requestLabel: "Request crop correction",
    requestMeaning:
      "Ask for explicit digest-bound bounds or masks; this draft cannot crop any asset.",
    finding:
      "The Room Reality Package candidate does not carry reviewed crop comparison evidence on this surface.",
    decisiveNextAction:
      "Review exact source and candidate bounds together, then record a reproducible bounds or mask artifact.",
  },
  {
    id: "completeness",
    label: "Architectural completeness",
    requestAction: "request_coverage_evidence",
    requestLabel: "Request coverage evidence",
    requestMeaning:
      "Ask for documented missing areas and coverage evidence without asserting completion.",
    finding:
      "QA report bodies can describe their checks, but the current contract does not prove complete room coverage.",
    decisiveNextAction:
      "Compare every required architectural region against exact sources and record known gaps and acceptance limits.",
  },
  {
    id: "privacy",
    label: "Privacy",
    requestAction: "request_privacy_redaction",
    requestLabel: "Request privacy mask",
    requestMeaning:
      "Ask for a reviewed redaction or exclusion artifact; this draft cannot edit source or package bytes.",
    finding:
      "No face, person, document, screen, or personal-data inspection was performed.",
    decisiveNextAction:
      "Run a purpose-specific human privacy review against exact visual members and bind any redactions to their digests.",
  },
  {
    id: "movable_objects",
    label: "Movable-object classification",
    requestAction: "request_movable_object_mask",
    requestLabel: "Request movable-object mask",
    requestMeaning:
      "Ask for a reviewed exclusion mask or classification; furniture must remain separate planner state.",
    finding:
      "The candidate explicitly records movable-object classification as not verified.",
    decisiveNextAction:
      "Classify captured furniture and other movable content, then exclude it from placement, measurement, collision, and export authority.",
  },
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalRoomRealityReviewError(`${label} must be one JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  const missing = required.filter((key) => !(key in value));
  const extra = keys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new LocalRoomRealityReviewError(
      `${label} has an invalid field set (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`,
    );
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function digest(domain: string, value: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\n${stableCanonicalJson(canonical)}`)}`;
}

function parseWrapperArray<T>(
  value: unknown,
  label: string,
  parser: (artifact: unknown) => T,
): LocalRoomRealityEvidenceWrapper<T>[] {
  if (!Array.isArray(value) || value.length > MAX_SUPPORTING_EVIDENCE_ITEMS) {
    throw new LocalRoomRealityReviewError(
      `${label} must be an array with at most ${String(MAX_SUPPORTING_EVIDENCE_ITEMS)} items.`,
    );
  }
  const parsed = value.map((entry, index) => {
    const item = record(entry, `${label}[${String(index)}]`);
    exactKeys(item, ["id", "artifact"], [], `${label}[${String(index)}]`);
    const id = RuntimeManifestKeySchema.safeParse(item.id);
    if (!id.success) {
      throw new LocalRoomRealityReviewError(
        `${label}[${String(index)}].id is not a valid package reference ID.`,
      );
    }
    try {
      return { id: id.data, artifact: parser(item.artifact) };
    } catch (error: unknown) {
      throw new LocalRoomRealityReviewError(
        `${label}[${String(index)}].artifact does not satisfy its strict existing contract.`,
        { cause: error },
      );
    }
  });
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new LocalRoomRealityReviewError(
      `${label} reference IDs must be unique.`,
    );
  }
  return parsed.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function referencedContractIds(
  candidate: FoundryRoomRealityPackageAssemblyResultV0,
): ReferencedContractIds {
  const venuePackage = candidate.canonicalPackage;
  if (venuePackage === null) {
    return {
      transforms: [],
      sceneAuthorityMaps: [],
      qualityReports: [],
      representationAssets: [],
    };
  }
  return {
    transforms: sortedUnique(
      venuePackage.rooms.flatMap((room) => [
        room.venueTransformArtifactAssetId,
        ...room.representations.flatMap((representation) =>
          representation.transformArtifactAssetId === null
            ? []
            : [representation.transformArtifactAssetId],
        ),
      ]),
    ),
    sceneAuthorityMaps: sortedUnique(
      venuePackage.rooms.map((room) => room.sceneAuthorityMapAssetId),
    ),
    qualityReports: sortedUnique([
      venuePackage.packageQualityReportId,
      ...venuePackage.rooms.flatMap((room) =>
        room.representations.map(
          (representation) => representation.qualityReportId,
        ),
      ),
    ]),
    representationAssets: sortedUnique(
      venuePackage.rooms.flatMap((room) =>
        room.representations.map((representation) => representation.assetId),
      ),
    ),
  };
}

function requireEvidenceReferences(
  label: string,
  items: readonly LocalRoomRealityEvidenceWrapper<unknown>[],
  allowedReferences: readonly string[],
): void {
  const allowed = new Set(allowedReferences);
  const unreferenced = items.filter((item) => !allowed.has(item.id));
  if (unreferenced.length > 0) {
    throw new LocalRoomRealityReviewError(
      `${label} includes evidence that the candidate does not reference: ${unreferenced.map((item) => item.id).join(", ")}.`,
    );
  }
}

export function parseLocalRoomRealityReviewDossierV0(
  input: unknown,
): LocalRoomRealityReviewDossierV0 {
  const dossier = record(input, "The Room Reality Package review dossier");
  exactKeys(
    dossier,
    ["candidate"],
    ["evidence"],
    "The Room Reality Package review dossier",
  );
  const candidateResult =
    FoundryRoomRealityPackageAssemblyResultV0Schema.safeParse(
      dossier.candidate,
    );
  if (!candidateResult.success) {
    throw new LocalRoomRealityReviewError(
      "The candidate is not a self-consistent authority-none Room Reality Package assembly.",
      { cause: candidateResult.error },
    );
  }
  const evidence =
    dossier.evidence === undefined
      ? {}
      : record(dossier.evidence, "The supporting evidence set");
  exactKeys(
    evidence,
    [],
    ["transforms", "sceneAuthorityMaps", "qualityReports"],
    "The supporting evidence set",
  );
  const transforms = parseWrapperArray(
    evidence.transforms ?? [],
    "Transform evidence",
    (artifact) => TransformArtifactV0Schema.parse(artifact),
  );
  const sceneAuthorityMaps = parseWrapperArray(
    evidence.sceneAuthorityMaps ?? [],
    "Scene Authority Map evidence",
    (artifact) => ReconstructionSceneAuthorityMapV0Schema.parse(artifact),
  );
  const qualityReports = parseWrapperArray(
    evidence.qualityReports ?? [],
    "QA report evidence",
    (artifact) => ReconstructionQaReportSchema.parse(artifact),
  );
  const references = referencedContractIds(candidateResult.data);
  requireEvidenceReferences(
    "Transform evidence",
    transforms,
    references.transforms,
  );
  requireEvidenceReferences(
    "Scene Authority Map evidence",
    sceneAuthorityMaps,
    references.sceneAuthorityMaps,
  );
  requireEvidenceReferences(
    "QA report evidence",
    qualityReports,
    references.qualityReports,
  );
  return {
    candidate: candidateResult.data,
    evidence: { transforms, sceneAuthorityMaps, qualityReports },
  };
}

function evidenceStatus(
  referenced: readonly string[],
  supplied: readonly string[],
  completeStatus: LocalRoomRealityReviewObservedStatus,
): LocalRoomRealityReviewObservedStatus {
  if (referenced.length === 0) return "unavailable";
  if (supplied.length === 0) return "reference_ids_only";
  return supplied.length === referenced.length
    ? completeStatus
    : "partially_validated_untrusted";
}

function allowedActions(
  spec: DimensionSpec,
): LocalRoomRealityReviewActionOptionV0[] {
  return [
    {
      id: "record_unresolved",
      label: "Keep unresolved",
      meaning:
        "Record the displayed gap without accepting, correcting, or authorizing anything.",
    },
    {
      id: spec.requestAction,
      label: spec.requestLabel,
      meaning: spec.requestMeaning,
    },
    {
      id: "block_local_candidate",
      label: "Block this local candidate",
      meaning:
        "Record an operator draft block. This is not a release rejection or authority decision.",
    },
  ];
}

function compileDimensions(
  dossier: LocalRoomRealityReviewDossierV0,
  references: ReferencedContractIds,
): LocalRoomRealityReviewDimensionV0[] {
  const transformIds = dossier.evidence.transforms.map((item) => item.id);
  const qaIds = dossier.evidence.qualityReports.map((item) => item.id);
  const statusById: Readonly<
    Record<
      LocalRoomRealityReviewDimensionId,
      LocalRoomRealityReviewObservedStatus
    >
  > = {
    source_comparison: "not_performed",
    alignment: evidenceStatus(
      references.transforms,
      transformIds,
      "contract_validated_untrusted",
    ),
    scale: evidenceStatus(
      references.transforms,
      transformIds,
      "contract_validated_untrusted",
    ),
    crop: "not_performed",
    completeness: evidenceStatus(
      references.qualityReports,
      qaIds,
      "qa_reported_untrusted",
    ),
    privacy: "not_reviewed",
    movable_objects: "not_verified",
  };
  const evidenceById: Readonly<
    Record<LocalRoomRealityReviewDimensionId, readonly string[]>
  > = {
    source_comparison: references.representationAssets,
    alignment: references.transforms,
    scale: references.transforms,
    crop: references.qualityReports,
    completeness: references.qualityReports,
    privacy: [],
    movable_objects: [],
  };
  return DIMENSION_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    observedStatus: statusById[spec.id],
    finding: spec.finding,
    decisiveNextAction: spec.decisiveNextAction,
    evidenceReferences: [...evidenceById[spec.id]],
    allowedActions: allowedActions(spec),
  }));
}

function compileTransformSummaries(
  dossier: LocalRoomRealityReviewDossierV0,
): LocalRoomRealityTransformSummaryV0[] {
  return dossier.evidence.transforms.map(({ id, artifact }) => ({
    referenceId: id,
    artifactId: artifact.id,
    artifactDigest: computeReconstructionReviewEvidenceArtifactDigest(artifact),
    sourceFrame: artifact.sourceFrame,
    targetFrame: artifact.targetFrame,
    units: artifact.units,
    alignmentMethod: artifact.alignmentMethod,
    residualRmseM: artifact.residualRmseM,
    landmarkCount: artifact.landmarks.length,
    matrix: [...artifact.matrix],
    trust: "strict_contract_body_untrusted_identity",
  }));
}

function compileSceneAuthoritySummaries(
  dossier: LocalRoomRealityReviewDossierV0,
  transforms: readonly LocalRoomRealityTransformSummaryV0[],
): LocalRoomRealitySceneAuthoritySummaryV0[] {
  const transformDigests = new Map(
    transforms.map((transform) => [
      transform.artifactId,
      transform.artifactDigest,
    ]),
  );
  return dossier.evidence.sceneAuthorityMaps.map(({ id, artifact }) => ({
    referenceId: id,
    artifactId: artifact.id,
    artifactDigest: computeReconstructionReviewEvidenceArtifactDigest(artifact),
    regionCount: artifact.regions.length,
    truthStatuses: sortedUnique(
      artifact.regions.map((region) => region.truthStatus),
    ),
    reconstructionStrategies: sortedUnique(
      artifact.regions.map((region) => region.reconstructionStrategy),
    ),
    exportAuthorityNoneCount: artifact.regions.filter(
      (region) => region.authorities.exportAuthority.kind === "none",
    ).length,
    transformLinks: artifact.regions
      .map((region) => region.transformArtifactRef)
      .map((reference) => ({
        artifactId: reference.artifactId,
        artifactDigest: reference.artifactDigest,
        state:
          transformDigests.get(reference.artifactId) ===
          reference.artifactDigest
            ? ("matched_untrusted_body" as const)
            : ("missing_or_mismatched" as const),
      }))
      .sort((left, right) =>
        left.artifactId < right.artifactId
          ? -1
          : left.artifactId > right.artifactId
            ? 1
            : 0,
      ),
    trust: "strict_contract_body_untrusted_identity",
  }));
}

function compileQaSummaries(
  dossier: LocalRoomRealityReviewDossierV0,
): LocalRoomRealityQaSummaryV0[] {
  return dossier.evidence.qualityReports.map(({ id, artifact }) => ({
    referenceId: id,
    reportDigest: artifact.reportDigest,
    releaseDigest: artifact.releaseDigest,
    outcome: artifact.outcome,
    profileVersion: artifact.qaProfileVersion,
    checks: artifact.checks.map((check) => ({
      checkKey: check.checkKey,
      status: check.status,
    })),
    trust: "strict_contract_body_untrusted_identity",
  }));
}

export function compileLocalRoomRealityReviewSurfaceV0(
  input: unknown,
): LocalRoomRealityReviewSurfaceV0 {
  const dossier = parseLocalRoomRealityReviewDossierV0(input);
  const references = referencedContractIds(dossier.candidate);
  const transforms = compileTransformSummaries(dossier);
  const sceneAuthorityMaps = compileSceneAuthoritySummaries(
    dossier,
    transforms,
  );
  const qualityReports = compileQaSummaries(dossier);
  const payload: LocalRoomRealityReviewSurfacePayloadV0 = {
    schemaVersion: LOCAL_ROOM_REALITY_REVIEW_SURFACE_V0,
    meaning: "local_metadata_and_contract_review_only",
    authority: "none",
    candidate: {
      assemblySha256: dossier.candidate.assemblySha256,
      packageId: dossier.candidate.packageId,
      projectId: dossier.candidate.projectId,
      status: dossier.candidate.status,
      releaseEligibility: dossier.candidate.releaseEligibility,
      releaseBlockers: [...dossier.candidate.releaseBlockers],
      ingestLegalReviewState: dossier.candidate.ingestLegalReviewState,
    },
    inspectionBoundary: {
      realMediaRead: "not_performed",
      sourcePixelsCompared: "not_performed",
      geometryDecoded: "not_performed",
      exactMemberIdentities: "not_verified",
      referenceCatalogAuthority: "caller_supplied_unverified",
      correctionApplication: "disabled",
    },
    contractEvidence: {
      transformReferenceIds: [...references.transforms],
      sceneAuthorityMapReferenceIds: [...references.sceneAuthorityMaps],
      qualityReportReferenceIds: [...references.qualityReports],
      transforms,
      sceneAuthorityMaps,
      qualityReports,
    },
    dimensions: compileDimensions(dossier, references),
    capabilities: {
      execution: "not_authorized",
      correctionApplication: "not_authorized",
      packageExport: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
    },
    furnitureBoundary:
      "movable_furniture_is_separate_planner_state_and_never_room_authority",
  };
  return {
    ...payload,
    reviewSurfaceSha256: digest(REVIEW_SURFACE_DIGEST_DOMAIN, payload),
  };
}

function parseReviewDraftInput(
  input: unknown,
): LocalRoomRealityReviewDraftInputV0 {
  const value = record(input, "The Room Reality Package review draft request");
  exactKeys(
    value,
    [
      "reviewSurfaceSha256",
      "candidateAssemblySha256",
      "reviewedAt",
      "reviewedBy",
      "decisions",
    ],
    [],
    "The Room Reality Package review draft request",
  );
  if (
    typeof value.reviewSurfaceSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.reviewSurfaceSha256)
  ) {
    throw new LocalRoomRealityReviewError(
      "The review surface fingerprint is invalid.",
    );
  }
  if (
    typeof value.candidateAssemblySha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.candidateAssemblySha256)
  ) {
    throw new LocalRoomRealityReviewError(
      "The candidate assembly fingerprint is invalid.",
    );
  }
  const reviewedAt = FoundryUtcInstantSchema.safeParse(value.reviewedAt);
  if (!reviewedAt.success) {
    throw new LocalRoomRealityReviewError(
      "The review time must be an exact UTC instant.",
    );
  }
  if (
    typeof value.reviewedBy !== "string" ||
    value.reviewedBy.trim() !== value.reviewedBy ||
    value.reviewedBy.length < 2 ||
    value.reviewedBy.length > 160
  ) {
    throw new LocalRoomRealityReviewError(
      "The reviewer name must contain 2 to 160 trimmed characters.",
    );
  }
  if (!Array.isArray(value.decisions)) {
    throw new LocalRoomRealityReviewError(
      "The review draft request must decide every displayed dimension.",
    );
  }
  const decisions = value.decisions.map((entry, index) => {
    const decision = record(
      entry,
      `The review decision at index ${String(index)}`,
    );
    exactKeys(
      decision,
      ["dimensionId", "action", "note"],
      [],
      `The review decision at index ${String(index)}`,
    );
    if (
      typeof decision.dimensionId !== "string" ||
      !LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.includes(
        decision.dimensionId as LocalRoomRealityReviewDimensionId,
      )
    ) {
      throw new LocalRoomRealityReviewError(
        `The review decision at index ${String(index)} has an invalid dimension.`,
      );
    }
    if (typeof decision.action !== "string") {
      throw new LocalRoomRealityReviewError(
        `The review decision at index ${String(index)} has an invalid action.`,
      );
    }
    if (
      typeof decision.note !== "string" ||
      decision.note.trim() !== decision.note ||
      decision.note.length < MIN_REVIEW_NOTE_LENGTH ||
      decision.note.length > MAX_REVIEW_NOTE_LENGTH
    ) {
      throw new LocalRoomRealityReviewError(
        `The review decision at index ${String(index)} needs a trimmed ${String(MIN_REVIEW_NOTE_LENGTH)} to ${String(MAX_REVIEW_NOTE_LENGTH)} character note.`,
      );
    }
    return {
      dimensionId: decision.dimensionId as LocalRoomRealityReviewDimensionId,
      action: decision.action as LocalRoomRealityReviewAction,
      note: decision.note,
    };
  });
  if (
    decisions.length !== LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.length ||
    new Set(decisions.map((decision) => decision.dimensionId)).size !==
      LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.length ||
    LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.some(
      (dimensionId) =>
        !decisions.some((decision) => decision.dimensionId === dimensionId),
    )
  ) {
    throw new LocalRoomRealityReviewError(
      "The review draft request must contain exactly one decision for every displayed dimension.",
    );
  }
  return {
    reviewSurfaceSha256: value.reviewSurfaceSha256,
    candidateAssemblySha256: value.candidateAssemblySha256,
    reviewedAt: reviewedAt.data,
    reviewedBy: value.reviewedBy,
    decisions,
  };
}

export function compileLocalRoomRealityReviewDraftV0(
  surface: LocalRoomRealityReviewSurfaceV0,
  input: unknown,
): LocalRoomRealityReviewDraftV0 {
  const parsed = parseReviewDraftInput(input);
  if (
    parsed.reviewSurfaceSha256 !== surface.reviewSurfaceSha256 ||
    parsed.candidateAssemblySha256 !== surface.candidate.assemblySha256
  ) {
    throw new LocalRoomRealityReviewError(
      "The candidate or review surface changed. Build the draft from the current surface.",
    );
  }
  const dimensions = new Map(
    surface.dimensions.map((dimension) => [dimension.id, dimension]),
  );
  const decisions = parsed.decisions
    .map((decision) => {
      const dimension = dimensions.get(decision.dimensionId);
      if (
        dimension === undefined ||
        !dimension.allowedActions.some(
          (option) => option.id === decision.action,
        )
      ) {
        throw new LocalRoomRealityReviewError(
          `The action for ${decision.dimensionId} is not allowed by this exact review surface.`,
        );
      }
      return {
        dimensionId: decision.dimensionId,
        observedStatus: dimension.observedStatus,
        action: decision.action,
        note: decision.note,
      };
    })
    .sort(
      (left, right) =>
        LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.indexOf(left.dimensionId) -
        LOCAL_ROOM_REALITY_REVIEW_DIMENSIONS.indexOf(right.dimensionId),
    );
  const payload: LocalRoomRealityReviewDraftPayloadV0 = {
    schemaVersion: LOCAL_ROOM_REALITY_REVIEW_DRAFT_V0,
    meaning: "local_correction_and_decision_draft_only",
    authority: "none",
    subject: {
      reviewSurfaceSha256: surface.reviewSurfaceSha256,
      candidateAssemblySha256: surface.candidate.assemblySha256,
      packageId: surface.candidate.packageId,
      projectId: surface.candidate.projectId,
    },
    reviewedAt: parsed.reviewedAt,
    reviewedBy: parsed.reviewedBy,
    disposition: decisions.some(
      (decision) => decision.action === "block_local_candidate",
    )
      ? "blocked_by_operator_draft"
      : "remains_unverified",
    decisions,
    releaseEligibility: "blocked",
    capabilities: surface.capabilities,
  };
  return {
    ...payload,
    reviewDraftSha256: digest(REVIEW_DRAFT_DIGEST_DOMAIN, payload),
  };
}

export function verifyLocalRoomRealityReviewDraftV0(
  draftInput: unknown,
  surface: LocalRoomRealityReviewSurfaceV0,
): LocalRoomRealityReviewDraftV0 {
  const draft = record(draftInput, "The Room Reality Package review draft");
  exactKeys(
    draft,
    [
      "schemaVersion",
      "meaning",
      "authority",
      "subject",
      "reviewedAt",
      "reviewedBy",
      "disposition",
      "decisions",
      "releaseEligibility",
      "capabilities",
      "reviewDraftSha256",
    ],
    [],
    "The Room Reality Package review draft",
  );
  const subject = record(
    draft.subject,
    "The Room Reality Package review draft subject",
  );
  exactKeys(
    subject,
    [
      "reviewSurfaceSha256",
      "candidateAssemblySha256",
      "packageId",
      "projectId",
    ],
    [],
    "The Room Reality Package review draft subject",
  );
  if (!Array.isArray(draft.decisions)) {
    throw new LocalRoomRealityReviewError(
      "The Room Reality Package review draft decisions are invalid.",
    );
  }
  const decisions = draft.decisions.map((decisionInput, index) => {
    const decision = record(
      decisionInput,
      `The Room Reality Package review draft decision at index ${String(index)}`,
    );
    exactKeys(
      decision,
      ["dimensionId", "observedStatus", "action", "note"],
      [],
      `The Room Reality Package review draft decision at index ${String(index)}`,
    );
    return {
      dimensionId: decision.dimensionId,
      action: decision.action,
      note: decision.note,
    };
  });
  const expected = compileLocalRoomRealityReviewDraftV0(surface, {
    reviewSurfaceSha256: subject.reviewSurfaceSha256,
    candidateAssemblySha256: subject.candidateAssemblySha256,
    reviewedAt: draft.reviewedAt,
    reviewedBy: draft.reviewedBy,
    decisions,
  });
  const canonicalDraft = CanonicalJsonValueSchema.safeParse(draftInput);
  if (
    !canonicalDraft.success ||
    stableCanonicalJson(canonicalDraft.data) !==
      stableCanonicalJson(CanonicalJsonValueSchema.parse(expected))
  ) {
    throw new LocalRoomRealityReviewError(
      "The Room Reality Package review draft does not reproduce from the exact review surface and choices.",
    );
  }
  return expected;
}

export type LocalE57VisualInspectionDimensionId =
  (typeof LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS)[number];

export type LocalE57VisualInspectionObservation =
  | "not_assessed"
  | "no_preview_issue_observed"
  | "preview_issue_observed";

export interface LocalE57VisualInspectionViewV0 {
  readonly projection: "orthographic_preview";
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly zoom: number;
  readonly targetM: readonly [number, number, number];
  readonly canvasAspectRatio: number;
  readonly comparisonVisible: boolean;
  readonly comparisonOpacity: number;
  readonly previewBoundsM: LocalE57VisualInspectionBoundsV0;
  readonly previewCorrection: LocalE57VisualPreviewCorrectionV0;
}

export interface LocalE57VisualInspectionBoundsV0 {
  readonly minimum: readonly [number, number, number];
  readonly maximum: readonly [number, number, number];
}

export interface LocalE57VisualPreviewCorrectionV0 {
  readonly translationM: readonly [number, number, number];
  readonly rotationDegrees: readonly [number, number, number];
  readonly scaleMultiplier: number;
}

export interface LocalE57VisualInspectionDecisionInputV0 {
  readonly dimensionId: LocalE57VisualInspectionDimensionId;
  readonly observation: LocalE57VisualInspectionObservation;
  readonly note: string;
}

export interface LocalE57VisualInspectionAnnotationInputV0 {
  readonly dimensionId: LocalE57VisualInspectionDimensionId;
  readonly note: string;
  readonly boundsM: LocalE57VisualInspectionBoundsV0;
  readonly previewCorrection: LocalE57VisualPreviewCorrectionV0;
}

export interface LocalE57VisualInspectionDraftInputV0 {
  readonly primaryArtifact: unknown;
  readonly comparisonArtifact?: unknown;
  readonly metadataReviewDraftSha256?: string | null;
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly view: LocalE57VisualInspectionViewV0;
  readonly decisions: readonly LocalE57VisualInspectionDecisionInputV0[];
  readonly annotations: readonly LocalE57VisualInspectionAnnotationInputV0[];
}

interface LocalE57VisualInspectionBoundDecisionV0
  extends LocalE57VisualInspectionDecisionInputV0 {
  readonly artifactDigests: readonly string[];
  readonly viewSha256: string;
}

interface LocalE57VisualInspectionBoundAnnotationV0
  extends LocalE57VisualInspectionAnnotationInputV0 {
  readonly annotationId: string;
  readonly artifactDigests: readonly string[];
  readonly viewSha256: string;
}

interface LocalE57VisualInspectionDraftPayloadV0 {
  readonly schemaVersion: typeof LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0;
  readonly meaning: "local_visual_inspection_draft_only";
  readonly authority: "none";
  readonly subject: {
    readonly primaryArtifactSha256: string;
    readonly comparisonArtifactSha256: string | null;
    readonly sourceSha256: string;
    readonly sourceFactsArtifactSha256: string;
    readonly frame: "e57_root";
    readonly units: "metre";
    readonly axes: "right_handed_z_up";
    readonly metadataReviewDraftSha256: string | null;
  };
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  readonly inspectionBoundary: {
    readonly input: "generated_bounded_e57_crop_json_only";
    readonly artifactFileTransfer: "not_performed";
    readonly rawE57Read: "not_performed";
    readonly sourceImageRead: "not_performed";
    readonly renderer: "bounded_local_canvas_projection";
    readonly geometryAuthority: "none";
    readonly placementAuthority: "excluded";
    readonly measurementAuthority: "excluded";
    readonly collisionAuthority: "excluded";
    readonly exportAuthority: "excluded";
    readonly primaryPointCount: number;
    readonly comparisonPointCount: number | null;
  };
  readonly view: LocalE57VisualInspectionViewV0;
  readonly viewSha256: string;
  readonly decisions: readonly LocalE57VisualInspectionBoundDecisionV0[];
  readonly annotations: readonly LocalE57VisualInspectionBoundAnnotationV0[];
  readonly disposition: "preview_observations_only";
  readonly releaseEligibility: "blocked";
  readonly capabilities: {
    readonly execution: "not_authorized";
    readonly correctionApplication: "not_authorized";
    readonly transformArtifactCreation: "not_authorized";
    readonly sceneAuthorityCreation: "not_authorized";
    readonly qaApproval: "not_authorized";
    readonly packageExport: "not_authorized";
    readonly runtimeActivation: "not_authorized";
  };
}

export interface LocalE57VisualInspectionDraftV0
  extends LocalE57VisualInspectionDraftPayloadV0 {
  readonly reviewDraftSha256: string;
}

const E57_VISUAL_INSPECTION_BOUNDARY = {
  input: "generated_bounded_e57_crop_json_only",
  artifactFileTransfer: "not_performed",
  rawE57Read: "not_performed",
  sourceImageRead: "not_performed",
  renderer: "bounded_local_canvas_projection",
  geometryAuthority: "none",
  placementAuthority: "excluded",
  measurementAuthority: "excluded",
  collisionAuthority: "excluded",
  exportAuthority: "excluded",
} as const;

const E57_VISUAL_INSPECTION_CAPABILITIES = {
  execution: "not_authorized",
  correctionApplication: "not_authorized",
  transformArtifactCreation: "not_authorized",
  sceneAuthorityCreation: "not_authorized",
  qaApproval: "not_authorized",
  packageExport: "not_authorized",
  runtimeActivation: "not_authorized",
} as const;

function visualDigest(value: unknown, domain: string): string {
  return digest(domain, value);
}

function visualNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new LocalRoomRealityReviewError(
      `${label} must be a finite number from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function visualVector3(
  value: unknown,
  label: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new LocalRoomRealityReviewError(
      `${label} must contain exactly three metric coordinates.`,
    );
  }
  return [
    visualNumber(
      value[0],
      `${label}[0]`,
      -MAX_ABSOLUTE_VISUAL_COORDINATE,
      MAX_ABSOLUTE_VISUAL_COORDINATE,
    ),
    visualNumber(
      value[1],
      `${label}[1]`,
      -MAX_ABSOLUTE_VISUAL_COORDINATE,
      MAX_ABSOLUTE_VISUAL_COORDINATE,
    ),
    visualNumber(
      value[2],
      `${label}[2]`,
      -MAX_ABSOLUTE_VISUAL_COORDINATE,
      MAX_ABSOLUTE_VISUAL_COORDINATE,
    ),
  ];
}

function visualBounds(
  input: unknown,
  label: string,
): LocalE57VisualInspectionBoundsV0 {
  const value = record(input, label);
  exactKeys(value, ["minimum", "maximum"], [], label);
  const minimum = visualVector3(value.minimum, `${label}.minimum`);
  const maximum = visualVector3(value.maximum, `${label}.maximum`);
  if (
    minimum[0] > maximum[0] ||
    minimum[1] > maximum[1] ||
    minimum[2] > maximum[2]
  ) {
    throw new LocalRoomRealityReviewError(
      `${label} minimum coordinates cannot exceed its maximum coordinates.`,
    );
  }
  return { minimum, maximum };
}

function visualPreviewCorrection(
  input: unknown,
  label: string,
): LocalE57VisualPreviewCorrectionV0 {
  const value = record(input, label);
  exactKeys(
    value,
    ["translationM", "rotationDegrees", "scaleMultiplier"],
    [],
    label,
  );
  return {
    translationM: visualVector3(
      value.translationM,
      `${label}.translationM`,
    ),
    rotationDegrees: visualVector3(
      value.rotationDegrees,
      `${label}.rotationDegrees`,
    ),
    scaleMultiplier: visualNumber(
      value.scaleMultiplier,
      `${label}.scaleMultiplier`,
      0.001,
      1_000,
    ),
  };
}

function visualView(input: unknown): LocalE57VisualInspectionViewV0 {
  const value = record(input, "The local visual inspection view");
  exactKeys(
    value,
    [
      "projection",
      "yawDegrees",
      "pitchDegrees",
      "zoom",
      "targetM",
      "canvasAspectRatio",
      "comparisonVisible",
      "comparisonOpacity",
      "previewBoundsM",
      "previewCorrection",
    ],
    [],
    "The local visual inspection view",
  );
  if (value.projection !== "orthographic_preview") {
    throw new LocalRoomRealityReviewError(
      "The local visual inspection supports only its bounded orthographic preview.",
    );
  }
  if (typeof value.comparisonVisible !== "boolean") {
    throw new LocalRoomRealityReviewError(
      "The comparison visibility must be an exact boolean.",
    );
  }
  return {
    projection: "orthographic_preview",
    yawDegrees: visualNumber(
      value.yawDegrees,
      "The preview yaw",
      -3_600,
      3_600,
    ),
    pitchDegrees: visualNumber(
      value.pitchDegrees,
      "The preview pitch",
      -89,
      89,
    ),
    zoom: visualNumber(value.zoom, "The preview zoom", 0.01, 1_000),
    targetM: visualVector3(value.targetM, "The preview orbit target"),
    canvasAspectRatio: visualNumber(
      value.canvasAspectRatio,
      "The preview canvas aspect ratio",
      0.1,
      10,
    ),
    comparisonVisible: value.comparisonVisible,
    comparisonOpacity: visualNumber(
      value.comparisonOpacity,
      "The comparison opacity",
      0,
      1,
    ),
    previewBoundsM: visualBounds(
      value.previewBoundsM,
      "The preview bounds",
    ),
    previewCorrection: visualPreviewCorrection(
      value.previewCorrection,
      "The current preview correction",
    ),
  };
}

function visualDimension(
  value: unknown,
  label: string,
): LocalE57VisualInspectionDimensionId {
  if (
    typeof value !== "string" ||
    !LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.includes(
      value as LocalE57VisualInspectionDimensionId,
    )
  ) {
    throw new LocalRoomRealityReviewError(`${label} is invalid.`);
  }
  return value as LocalE57VisualInspectionDimensionId;
}

function visualNote(
  value: unknown,
  label: string,
  allowEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length > MAX_REVIEW_NOTE_LENGTH ||
    (!allowEmpty && value.length < MIN_REVIEW_NOTE_LENGTH) ||
    (allowEmpty && value.length > 0 && value.length < MIN_REVIEW_NOTE_LENGTH)
  ) {
    throw new LocalRoomRealityReviewError(
      `${label} must be empty when permitted or contain ${String(MIN_REVIEW_NOTE_LENGTH)} to ${String(MAX_REVIEW_NOTE_LENGTH)} trimmed characters.`,
    );
  }
  return value;
}

function visualDecisions(
  input: unknown,
): LocalE57VisualInspectionDecisionInputV0[] {
  if (!Array.isArray(input)) {
    throw new LocalRoomRealityReviewError(
      "The visual inspection draft must decide every preview dimension.",
    );
  }
  const decisions = input.map<LocalE57VisualInspectionDecisionInputV0>(
    (entry, index) => {
    const label = `The visual decision at index ${String(index)}`;
    const value = record(entry, label);
    exactKeys(value, ["dimensionId", "observation", "note"], [], label);
    const dimensionId = visualDimension(value.dimensionId, `${label}.dimensionId`);
    const observation = value.observation;
    if (
      observation !== "not_assessed" &&
      observation !== "no_preview_issue_observed" &&
      observation !== "preview_issue_observed"
    ) {
      throw new LocalRoomRealityReviewError(
        `${label}.observation is not a preview-only observation state.`,
      );
    }
      return {
        dimensionId,
        observation,
        note: visualNote(
          value.note,
          `${label}.note`,
          observation === "not_assessed",
        ),
      };
    },
  );
  if (
    decisions.length !== LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.length ||
    new Set(decisions.map((decision) => decision.dimensionId)).size !==
      LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.length
  ) {
    throw new LocalRoomRealityReviewError(
      "The visual inspection draft must contain exactly one decision for every preview dimension.",
    );
  }
  return decisions.sort(
    (left, right) =>
      LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.indexOf(left.dimensionId) -
      LOCAL_E57_VISUAL_INSPECTION_DIMENSIONS.indexOf(right.dimensionId),
  );
}

function requireVisualDecisionEvidence(
  decisions: readonly LocalE57VisualInspectionDecisionInputV0[],
  hasComparisonArtifact: boolean,
  comparisonVisible: boolean,
  comparisonOpacity: number,
  comparisonPointCount: number | null,
): LocalE57VisualInspectionDecisionInputV0[] {
  const comparisonIsEffective =
    hasComparisonArtifact &&
    comparisonPointCount !== null &&
    comparisonPointCount > 0 &&
    comparisonVisible &&
    comparisonOpacity >= LOCAL_E57_VISUAL_MIN_COMPARISON_OPACITY;
  if (comparisonVisible && !comparisonIsEffective) {
    throw new LocalRoomRealityReviewError(
      "A comparison can be visible only when a bound distinct artifact has points and meets the minimum preview opacity.",
    );
  }
  const sourceComparison = decisions.find(
    (decision) => decision.dimensionId === "source_comparison",
  );
  if (
    sourceComparison?.observation !== "not_assessed" &&
    !comparisonIsEffective
  ) {
    throw new LocalRoomRealityReviewError(
      "Source comparison must remain not assessed unless a compatible non-empty comparison artifact is bound and effectively visible in the exact review view.",
    );
  }
  return [...decisions];
}

function visualAnnotations(
  input: unknown,
): LocalE57VisualInspectionAnnotationInputV0[] {
  if (!Array.isArray(input) || input.length > MAX_VISUAL_ANNOTATIONS) {
    throw new LocalRoomRealityReviewError(
      `Visual annotations must be an array with at most ${String(MAX_VISUAL_ANNOTATIONS)} entries.`,
    );
  }
  return input.map((entry, index) => {
    const label = `The visual annotation at index ${String(index)}`;
    const value = record(entry, label);
    exactKeys(
      value,
      ["dimensionId", "note", "boundsM", "previewCorrection"],
      [],
      label,
    );
    return {
      dimensionId: visualDimension(
        value.dimensionId,
        `${label}.dimensionId`,
      ),
      note: visualNote(value.note, `${label}.note`, false),
      boundsM: visualBounds(value.boundsM, `${label}.boundsM`),
      previewCorrection: visualPreviewCorrection(
        value.previewCorrection,
        `${label}.previewCorrection`,
      ),
    };
  });
}

function visualReviewer(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 2 ||
    value.length > 160
  ) {
    throw new LocalRoomRealityReviewError(
      "The local visual reviewer name must contain 2 to 160 trimmed characters.",
    );
  }
  return value;
}

function optionalVisualDigest(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new LocalRoomRealityReviewError(`${label} is invalid.`);
  }
  return value;
}

export function parseLocalE57VisualReviewArtifactV0(
  input: unknown,
): FoundryE57GeometryCropArtifactV0 {
  const parsed = FoundryE57GeometryCropArtifactV0Schema.safeParse(input);
  if (!parsed.success) {
    throw new LocalRoomRealityReviewError(
      "The selected file is not an intact generated authority-none FoundryE57GeometryCropV0 artifact.",
      { cause: parsed.error },
    );
  }
  if (parsed.data.points.length > LOCAL_E57_VISUAL_MAX_POINTS) {
    throw new LocalRoomRealityReviewError(
      `The generated crop contains more than the ${String(LOCAL_E57_VISUAL_MAX_POINTS)}-point local visual inspection limit. Generate a smaller review crop; no points were opened.`,
    );
  }
  if (
    stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed.data.source)) !==
    stableCanonicalJson(
      CanonicalJsonValueSchema.parse(parsed.data.readerDescription.source),
    )
  ) {
    throw new LocalRoomRealityReviewError(
      "The generated crop and its reader description do not bind the same exact source.",
    );
  }
  return parsed.data;
}

function requireCompatibleVisualArtifacts(
  primary: FoundryE57GeometryCropArtifactV0,
  comparison: FoundryE57GeometryCropArtifactV0,
): void {
  const sourceIdentity = (artifact: FoundryE57GeometryCropArtifactV0) => ({
    sha256: artifact.source.sha256,
    sizeBytes: artifact.source.sizeBytes,
    inputType: artifact.source.inputType,
    sourceFactsArtifactSha256: artifact.sourceFactsArtifactSha256,
    coordinateContract: artifact.coordinateContract,
  });
  if (
    primary.artifactSha256 === comparison.artifactSha256 ||
    stableCanonicalJson(
      CanonicalJsonValueSchema.parse(sourceIdentity(primary)),
    ) !==
      stableCanonicalJson(
        CanonicalJsonValueSchema.parse(sourceIdentity(comparison)),
      )
  ) {
    throw new LocalRoomRealityReviewError(
      "A comparison overlay requires two distinct artifacts from the same exact source bytes, source-facts digest, units, axes, and E57 root frame. Cross-source comparison needs a reviewed registration artifact and is not available here.",
    );
  }
}

function bindVisualDecisions(
  decisions: readonly LocalE57VisualInspectionDecisionInputV0[],
  artifactDigests: readonly string[],
  viewSha256: string,
): LocalE57VisualInspectionBoundDecisionV0[] {
  return decisions.map((decision) => ({
    ...decision,
    artifactDigests: [...artifactDigests],
    viewSha256,
  }));
}

function bindVisualAnnotations(
  annotations: readonly LocalE57VisualInspectionAnnotationInputV0[],
  artifactDigests: readonly string[],
  viewSha256: string,
): LocalE57VisualInspectionBoundAnnotationV0[] {
  return annotations.map((annotation, index) => ({
    annotationId: `annotation-${String(index + 1).padStart(3, "0")}`,
    ...annotation,
    artifactDigests: [...artifactDigests],
    viewSha256,
  }));
}

export function compileLocalE57VisualInspectionDraftV0(
  input: LocalE57VisualInspectionDraftInputV0,
): LocalE57VisualInspectionDraftV0 {
  const primary = parseLocalE57VisualReviewArtifactV0(input.primaryArtifact);
  const comparison =
    input.comparisonArtifact === undefined || input.comparisonArtifact === null
      ? null
      : parseLocalE57VisualReviewArtifactV0(input.comparisonArtifact);
  if (comparison !== null) {
    requireCompatibleVisualArtifacts(primary, comparison);
  }
  const reviewedAt = FoundryUtcInstantSchema.safeParse(input.reviewedAt);
  if (!reviewedAt.success) {
    throw new LocalRoomRealityReviewError(
      "The local visual inspection time must be an exact UTC instant.",
    );
  }
  const reviewedBy = visualReviewer(input.reviewedBy);
  const view = visualView(input.view);
  const viewSha256 = visualDigest(view, E57_VISUAL_VIEW_DIGEST_DOMAIN);
  const artifactDigests = [
    primary.artifactSha256,
    ...(comparison === null ? [] : [comparison.artifactSha256]),
  ];
  const decisions = requireVisualDecisionEvidence(
    visualDecisions(input.decisions),
    comparison !== null,
    view.comparisonVisible,
    view.comparisonOpacity,
    comparison?.points.length ?? null,
  );
  const payload: LocalE57VisualInspectionDraftPayloadV0 = {
    schemaVersion: LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0,
    meaning: "local_visual_inspection_draft_only",
    authority: "none",
    subject: {
      primaryArtifactSha256: primary.artifactSha256,
      comparisonArtifactSha256: comparison?.artifactSha256 ?? null,
      sourceSha256: primary.source.sha256,
      sourceFactsArtifactSha256: primary.sourceFactsArtifactSha256,
      frame: "e57_root",
      units: "metre",
      axes: "right_handed_z_up",
      metadataReviewDraftSha256: optionalVisualDigest(
        input.metadataReviewDraftSha256,
        "The metadata review draft digest",
      ),
    },
    reviewedAt: reviewedAt.data,
    reviewedBy,
    inspectionBoundary: {
      ...E57_VISUAL_INSPECTION_BOUNDARY,
      primaryPointCount: primary.points.length,
      comparisonPointCount: comparison?.points.length ?? null,
    },
    view,
    viewSha256,
    decisions: bindVisualDecisions(
      decisions,
      artifactDigests,
      viewSha256,
    ),
    annotations: bindVisualAnnotations(
      visualAnnotations(input.annotations),
      artifactDigests,
      viewSha256,
    ),
    disposition: "preview_observations_only",
    releaseEligibility: "blocked",
    capabilities: E57_VISUAL_INSPECTION_CAPABILITIES,
  };
  return {
    ...payload,
    reviewDraftSha256: visualDigest(
      payload,
      E57_VISUAL_DRAFT_DIGEST_DOMAIN,
    ),
  };
}

function expectCanonicalEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  const actualCanonical = CanonicalJsonValueSchema.safeParse(actual);
  const expectedCanonical = CanonicalJsonValueSchema.parse(expected);
  if (
    !actualCanonical.success ||
    stableCanonicalJson(actualCanonical.data) !==
      stableCanonicalJson(expectedCanonical)
  ) {
    throw new LocalRoomRealityReviewError(`${label} is invalid or changed.`);
  }
}

export function verifyLocalE57VisualInspectionDraftV0(
  input: unknown,
): LocalE57VisualInspectionDraftV0 {
  const value = record(input, "The local E57 visual inspection draft");
  exactKeys(
    value,
    [
      "schemaVersion",
      "meaning",
      "authority",
      "subject",
      "reviewedAt",
      "reviewedBy",
      "inspectionBoundary",
      "view",
      "viewSha256",
      "decisions",
      "annotations",
      "disposition",
      "releaseEligibility",
      "capabilities",
      "reviewDraftSha256",
    ],
    [],
    "The local E57 visual inspection draft",
  );
  if (
    value.schemaVersion !== LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0 ||
    value.meaning !== "local_visual_inspection_draft_only" ||
    value.authority !== "none" ||
    value.disposition !== "preview_observations_only" ||
    value.releaseEligibility !== "blocked"
  ) {
    throw new LocalRoomRealityReviewError(
      "The local E57 visual inspection draft boundary is invalid.",
    );
  }
  const subjectInput = record(value.subject, "The visual draft subject");
  exactKeys(
    subjectInput,
    [
      "primaryArtifactSha256",
      "comparisonArtifactSha256",
      "sourceSha256",
      "sourceFactsArtifactSha256",
      "frame",
      "units",
      "axes",
      "metadataReviewDraftSha256",
    ],
    [],
    "The visual draft subject",
  );
  const primaryArtifactSha256 = optionalVisualDigest(
    subjectInput.primaryArtifactSha256,
    "The primary visual artifact digest",
  );
  if (primaryArtifactSha256 === null) {
    throw new LocalRoomRealityReviewError(
      "The primary visual artifact digest is required.",
    );
  }
  const comparisonArtifactSha256 = optionalVisualDigest(
    subjectInput.comparisonArtifactSha256,
    "The comparison visual artifact digest",
  );
  if (comparisonArtifactSha256 === primaryArtifactSha256) {
    throw new LocalRoomRealityReviewError(
      "The comparison visual artifact must be distinct from the primary visual artifact.",
    );
  }
  const sourceSha256 = optionalVisualDigest(
    subjectInput.sourceSha256,
    "The visual source digest",
  );
  const sourceFactsArtifactSha256 = optionalVisualDigest(
    subjectInput.sourceFactsArtifactSha256,
    "The visual source-facts digest",
  );
  if (
    sourceSha256 === null ||
    sourceFactsArtifactSha256 === null ||
    subjectInput.frame !== "e57_root" ||
    subjectInput.units !== "metre" ||
    subjectInput.axes !== "right_handed_z_up"
  ) {
    throw new LocalRoomRealityReviewError(
      "The visual draft source and coordinate binding is invalid.",
    );
  }
  const subject = {
    primaryArtifactSha256,
    comparisonArtifactSha256,
    sourceSha256,
    sourceFactsArtifactSha256,
    frame: "e57_root" as const,
    units: "metre" as const,
    axes: "right_handed_z_up" as const,
    metadataReviewDraftSha256: optionalVisualDigest(
      subjectInput.metadataReviewDraftSha256,
      "The metadata review draft digest",
    ),
  };
  const reviewedAt = FoundryUtcInstantSchema.safeParse(value.reviewedAt);
  if (!reviewedAt.success) {
    throw new LocalRoomRealityReviewError(
      "The local visual inspection time is invalid.",
    );
  }
  const reviewedBy = visualReviewer(value.reviewedBy);
  const view = visualView(value.view);
  const viewSha256 = visualDigest(view, E57_VISUAL_VIEW_DIGEST_DOMAIN);
  if (value.viewSha256 !== viewSha256) {
    throw new LocalRoomRealityReviewError(
      "The local visual inspection view digest changed.",
    );
  }
  const artifactDigests = [
    primaryArtifactSha256,
    ...(comparisonArtifactSha256 === null
      ? []
      : [comparisonArtifactSha256]),
  ];
  if (!Array.isArray(value.decisions)) {
    throw new LocalRoomRealityReviewError(
      "The bound visual decisions are invalid.",
    );
  }
  const decisionInputs = value.decisions.map((entry, index) => {
    const label = `The bound visual decision at index ${String(index)}`;
    const decision = record(entry, label);
    exactKeys(
      decision,
      [
        "dimensionId",
        "observation",
        "note",
        "artifactDigests",
        "viewSha256",
      ],
      [],
      label,
    );
    expectCanonicalEqual(
      decision.artifactDigests,
      artifactDigests,
      `${label}.artifactDigests`,
    );
    if (decision.viewSha256 !== viewSha256) {
      throw new LocalRoomRealityReviewError(
        `${label}.viewSha256 does not bind this exact view.`,
      );
    }
    return {
      dimensionId: decision.dimensionId,
      observation: decision.observation,
      note: decision.note,
    };
  });
  const parsedDecisions = visualDecisions(decisionInputs);
  const decisions = bindVisualDecisions(
    parsedDecisions,
    artifactDigests,
    viewSha256,
  );
  if (!Array.isArray(value.annotations)) {
    throw new LocalRoomRealityReviewError(
      "The bound visual annotations are invalid.",
    );
  }
  const annotationInputs = value.annotations.map((entry, index) => {
    const label = `The bound visual annotation at index ${String(index)}`;
    const annotation = record(entry, label);
    exactKeys(
      annotation,
      [
        "annotationId",
        "dimensionId",
        "note",
        "boundsM",
        "previewCorrection",
        "artifactDigests",
        "viewSha256",
      ],
      [],
      label,
    );
    if (
      annotation.annotationId !==
        `annotation-${String(index + 1).padStart(3, "0")}` ||
      annotation.viewSha256 !== viewSha256
    ) {
      throw new LocalRoomRealityReviewError(
        `${label} does not bind its deterministic position and exact view.`,
      );
    }
    expectCanonicalEqual(
      annotation.artifactDigests,
      artifactDigests,
      `${label}.artifactDigests`,
    );
    return {
      dimensionId: annotation.dimensionId,
      note: annotation.note,
      boundsM: annotation.boundsM,
      previewCorrection: annotation.previewCorrection,
    };
  });
  const annotations = bindVisualAnnotations(
    visualAnnotations(annotationInputs),
    artifactDigests,
    viewSha256,
  );
  const inspectionInput = record(
    value.inspectionBoundary,
    "The visual inspection boundary",
  );
  const primaryPointCount = visualNumber(
    inspectionInput.primaryPointCount,
    "The primary preview point count",
    0,
    LOCAL_E57_VISUAL_MAX_POINTS,
  );
  if (!Number.isInteger(primaryPointCount)) {
    throw new LocalRoomRealityReviewError(
      "The primary preview point count must be an integer.",
    );
  }
  const comparisonPointCount =
    inspectionInput.comparisonPointCount === null
      ? null
      : visualNumber(
          inspectionInput.comparisonPointCount,
          "The comparison preview point count",
          0,
          LOCAL_E57_VISUAL_MAX_POINTS,
        );
  if (
    (comparisonPointCount === null) !==
      (comparisonArtifactSha256 === null) ||
    (comparisonPointCount !== null && !Number.isInteger(comparisonPointCount))
  ) {
    throw new LocalRoomRealityReviewError(
      "The comparison preview point count must be an integer exactly when a distinct comparison artifact is bound.",
    );
  }
  requireVisualDecisionEvidence(
    parsedDecisions,
    comparisonArtifactSha256 !== null,
    view.comparisonVisible,
    view.comparisonOpacity,
    comparisonPointCount,
  );
  const inspectionBoundary = {
    ...E57_VISUAL_INSPECTION_BOUNDARY,
    primaryPointCount,
    comparisonPointCount,
  };
  expectCanonicalEqual(
    value.inspectionBoundary,
    inspectionBoundary,
    "The visual inspection boundary",
  );
  expectCanonicalEqual(
    value.capabilities,
    E57_VISUAL_INSPECTION_CAPABILITIES,
    "The visual draft capabilities",
  );
  const payload: LocalE57VisualInspectionDraftPayloadV0 = {
    schemaVersion: LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0,
    meaning: "local_visual_inspection_draft_only",
    authority: "none",
    subject,
    reviewedAt: reviewedAt.data,
    reviewedBy,
    inspectionBoundary,
    view,
    viewSha256,
    decisions,
    annotations,
    disposition: "preview_observations_only",
    releaseEligibility: "blocked",
    capabilities: E57_VISUAL_INSPECTION_CAPABILITIES,
  };
  expectCanonicalEqual(
    value,
    {
      ...payload,
      reviewDraftSha256: visualDigest(
        payload,
        E57_VISUAL_DRAFT_DIGEST_DOMAIN,
      ),
    },
    "The local E57 visual inspection draft",
  );
  return {
    ...payload,
    reviewDraftSha256: visualDigest(
      payload,
      E57_VISUAL_DRAFT_DIGEST_DOMAIN,
    ),
  };
}

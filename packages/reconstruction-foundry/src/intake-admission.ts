import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultPayloadSchema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryIntakeAdmissionResultSha256,
  type FoundryInputType,
  type FoundryIntakeAdmissionResultV0,
} from "@omnitwin/types";
import { FoundryIntegrityError } from "./errors.js";
import { FoundryUniversalIntakeReceiptSchema } from "./intake-receipt.js";

const TECHNICALLY_BLOCKED_TYPES = new Set<FoundryInputType>(["xgrids_xbin"]);
const RIGHTS_GATED_OPAQUE_TYPES = new Set<FoundryInputType>([
  "matterpak_bundle",
  "xgrids_xbin",
  "lcc",
  "lcc2",
]);
const NON_PROCESSING_ACCESS_STATES = new Set([
  "metadata_only",
  "blocked_technical",
  "blocked_legal",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function hasReviewedRights(asset: {
  readonly rights: {
    readonly basis: string;
    readonly termsReviewedAt: string | null;
    readonly termsReference: string | null;
  };
}): boolean {
  return (
    asset.rights.basis !== "unknown" &&
    asset.rights.termsReviewedAt !== null &&
    asset.rights.termsReference !== null
  );
}

export function admitUniversalIntakeReceipt(
  receiptInput: unknown,
  reviewInput: unknown,
): FoundryIntakeAdmissionResultV0 {
  const receiptResult = FoundryUniversalIntakeReceiptSchema.safeParse(receiptInput);
  if (!receiptResult.success) {
    return fail("INTAKE_ADMISSION_RECEIPT_INVALID", "Universal intake receipt is invalid.");
  }
  const reviewResult = FoundryIntakeAdmissionReviewV0Schema.safeParse(reviewInput);
  if (!reviewResult.success) {
    return fail("INTAKE_ADMISSION_REVIEW_INVALID", "Intake admission review is invalid.");
  }
  const receipt = receiptResult.data;
  const review = reviewResult.data;
  if (review.receiptSha256 !== receipt.receiptSha256) {
    return fail(
      "INTAKE_ADMISSION_RECEIPT_DIGEST_MISMATCH",
      "Admission review does not bind the supplied intake receipt.",
    );
  }
  if (review.decisions.length !== receipt.files.length) {
    return fail(
      "INTAKE_ADMISSION_PATH_SET_MISMATCH",
      "Admission review must account for every receipt file exactly once.",
    );
  }

  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  for (let index = 0; index < receipt.files.length; index += 1) {
    if (receipt.files[index]?.path !== review.decisions[index]?.path) {
      return fail(
        "INTAKE_ADMISSION_PATH_SET_MISMATCH",
        "Admission review paths must exactly match the sorted receipt path set.",
      );
    }
  }

  const assets = [];
  const exclusions = [];
  for (const decision of review.decisions) {
    const receiptFile = receiptByPath.get(decision.path);
    if (receiptFile === undefined) {
      return fail(
        "INTAKE_ADMISSION_PATH_SET_MISMATCH",
        `Admission decision references a path outside the receipt: ${decision.path}`,
      );
    }
    if (decision.action === "exclude") {
      exclusions.push(decision);
      continue;
    }

    const asset = decision.asset;
    if (asset.sourceRootId !== review.sourceRoot.id) {
      return fail(
        "INTAKE_ADMISSION_SOURCE_ROOT_MISMATCH",
        `Admitted asset uses the wrong source root: ${decision.path}`,
      );
    }
    if (
      asset.sizeBytes !== receiptFile.sizeBytes ||
      asset.sha256 !== `sha256:${receiptFile.sha256}`
    ) {
      return fail(
        "INTAKE_ADMISSION_FILE_IDENTITY_MISMATCH",
        `Admitted asset bytes do not match the receipt: ${decision.path}`,
      );
    }
    if (
      decision.classification.method === "accepted_detector_candidate" &&
      !receiptFile.detection.candidates.some(
        (candidate) => candidate.inputType === asset.inputType,
      )
    ) {
      return fail(
        "INTAKE_ADMISSION_CLASSIFICATION_MISMATCH",
        `Selected input type was not a detector candidate: ${decision.path}`,
      );
    }
    if (
      TECHNICALLY_BLOCKED_TYPES.has(asset.inputType) &&
      !NON_PROCESSING_ACCESS_STATES.has(asset.accessState)
    ) {
      return fail(
        "INTAKE_ADMISSION_PROPRIETARY_ACCESS_UNPROVEN",
        `Proprietary raw payload must remain metadata-only or technically blocked: ${decision.path}`,
      );
    }
    if (
      RIGHTS_GATED_OPAQUE_TYPES.has(asset.inputType) &&
      !hasReviewedRights(asset) &&
      !NON_PROCESSING_ACCESS_STATES.has(asset.accessState)
    ) {
      return fail(
        "INTAKE_ADMISSION_PROPRIETARY_RIGHTS_UNPROVEN",
        `Opaque input lacks an authoritative rights record: ${decision.path}`,
      );
    }
    assets.push(asset);
  }
  if (assets.length === 0) {
    return fail(
      "INTAKE_ADMISSION_EMPTY_MANIFEST",
      "Admission review must retain at least one asset.",
    );
  }

  const manifest = FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: review.projectId,
    createdAt: review.reviewedAt,
    createdBy: review.reviewedBy,
    sourceRoots: [review.sourceRoot],
    coordinateFrames: [...review.coordinateFrames].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    transforms: [...review.transforms].sort((left, right) => compareText(left.id, right.id)),
    assets,
    provenanceEdges: [...review.provenanceEdges].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    generatedRegions: [...review.generatedRegions].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    legalReviewState: review.legalReviewState,
    sourceMutationPermitted: false,
  });
  const payload = FoundryIntakeAdmissionResultPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
    receiptSha256: receipt.receiptSha256,
    reviewSha256: review.reviewSha256,
    manifestSha256: computeFoundryIngestManifestSha256(manifest),
    manifest,
    exclusions,
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  return FoundryIntakeAdmissionResultV0Schema.parse({
    ...payload,
    resultSha256: computeFoundryIntakeAdmissionResultSha256(payload),
  });
}

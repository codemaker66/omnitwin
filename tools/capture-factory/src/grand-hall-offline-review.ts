import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  CanonicalJsonValueSchema,
  FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0,
  FoundryIngestManifestV0Schema,
  FoundryOfflineReviewPackageV0Schema,
  FoundryPhase1BundleV0Schema,
  FoundryPhase1ColmapInspectionV0Schema,
  FoundryPhase1E57InspectionV0Schema,
  FoundryPhase1IdentityReviewV0Schema,
  FoundryPhase1ProbeEnvelopeV0Schema,
  FoundryPhase1ResidualReportV0Schema,
  FoundryPhase1TransformProposalV0Schema,
  ReconstructionQaReportSchema,
  ReconstructionReleaseManifestSchema,
  TwinManifestSchema,
  buildFoundryOfflineReviewPackageV0,
  computeFoundryIngestManifestSha256,
  sha256Hex,
  stableCanonicalJson,
  type FoundryOfflineReviewArtifactKind,
  type FoundryOfflineReviewArtifactV0,
  type FoundryOfflineReviewPackageV0,
} from "@omnitwin/types";
import { sha256File } from "./hash.js";
import { assertDisjointDestination, resolveContainedPath } from "./path-safety.js";
import { writeImmutableJson } from "./stage.js";

const PACKAGE_MANIFEST = "package-manifest.json";
const VENUE_SLUG = "trades-hall";
const ROOM_SLUG = "grand-hall";
const PHASE1_PATHS = [
  "foundry-ingest-manifest-v0.json",
  "foundry-phase1-bundle-v0.json",
  "identity-review.json",
  "inspections/colmap-inspection.json",
  "inspections/e57-inspection.json",
  "inspections/raw/alignment-probe-output.json",
  "inspections/raw/colmap-probe-output.json",
  "inspections/raw/e57-probe-output.json",
  "phase1-output-index.json",
  "proposals/colmap-to-e57-transform.json",
  "reports/alignment-frozen-holdout-residuals.json",
  "reports/alignment-full-fit-residuals.json",
  "reports/colmap-to-e57-residual-report.json",
] as const;
const PREPARED_RELEASE_PATHS = [
  "foundry-preparation.json",
  "qa-report.json",
  "release-manifest.json",
] as const;
const OFFLINE_REVIEW_EVIDENCE_BLOCKERS = [
  "Complete identity re-review pixels and identity-gate evidence are withheld pending rights clearance",
] as const;
const GRAND_HALL_EVIDENCE_SET_DIGEST_DOMAIN =
  "omnitwin.foundry.grand-hall-offline-evidence-set.v0\n";
const DOSSIER_ARTIFACT_PATHS = [
  ...PHASE1_PATHS.map((path) => `t507/${path}`),
  "identity/identity-gate-overview.png",
  "audit/grand-hall-t507-independent-control-audit.md",
  "audit/grand-hall-t507-independent-control-evidence.json",
  "control/grand-hall-review-gate-intake.json",
  "target/foundry-preparation.json",
  "target/qa-report.json",
  "target/release-manifest.json",
  "target/source-manifest.json",
].sort((left, right) => left.localeCompare(right, "en-US"));

interface Phase1IndexEntry {
  readonly relativePath: string;
  readonly sha256: string;
}

interface ValidatedPhase1Evidence {
  readonly ingestManifest: unknown;
  readonly bundle: unknown;
  readonly identityReview: unknown;
  readonly e57Inspection: unknown;
  readonly colmapInspection: unknown;
  readonly residualReport: unknown;
  readonly transformProposal: unknown;
  readonly outputIndex: unknown;
  readonly outputIndexFileSha256: string;
}

interface ValidatedPreparedReleaseEvidence {
  readonly preparation: unknown;
  readonly preparationFileSha256: string;
  readonly releaseManifest: unknown;
  readonly releaseManifestFileSha256: string;
  readonly qaReport: unknown;
  readonly qaReportFileSha256: string;
  readonly sourceManifest: unknown;
  readonly sourceManifestFileSha256: string;
  readonly releaseDigest: string;
}

interface GrandHallEvidencePaths {
  readonly phase1Root: string;
  readonly preparedReleaseRoot: string;
  readonly preparedSourceManifest: string;
  readonly identityOverview: string;
  readonly auditReport: string;
  readonly auditEvidence: string;
  readonly gateIntake: string;
}

interface SourceArtifact {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly kind: FoundryOfflineReviewArtifactKind;
}

export interface GrandHallOfflineReviewValidatedSources {
  readonly phase1Root: string;
  readonly preparedReleaseRoot: string;
  readonly preparedSourceManifest: string;
  readonly identityOverview: string;
  readonly auditReport: string;
  readonly auditEvidence: string;
  readonly gateIntake: string;
  readonly releaseDigest: string;
  readonly evidenceSetSha256: string;
}

export interface GrandHallOfflineReviewOptions {
  readonly phase1PackageRoot: string;
  readonly identityOverviewPath: string;
  readonly preparedReleaseRoot: string;
  readonly preparedSourceManifestPath: string;
  readonly auditReportPath: string;
  readonly auditEvidencePath: string;
  readonly gateIntakePath: string;
  readonly outputDirectory: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface GrandHallOfflineReviewResult {
  readonly outputDirectory: string;
  readonly packageSha256: string;
  readonly artifactCount: number;
  readonly releaseDigest: string;
}

export interface GrandHallOfflineReviewDependencies {
  readonly validateSources: (
    options: GrandHallOfflineReviewOptions,
  ) => Promise<GrandHallOfflineReviewValidatedSources>;
  readonly validateCopiedDossier: (
    root: string,
    phase: GrandHallOfflineReviewValidationPhase,
  ) => Promise<GrandHallOfflineReviewEvidenceValidation>;
}

export type GrandHallOfflineReviewValidationPhase =
  | "before_manifest"
  | "before_promotion"
  | "after_promotion";

export interface GrandHallOfflineReviewEvidenceValidation {
  readonly releaseDigest: string;
  readonly evidenceSetSha256: string;
}

export interface GrandHallEvidenceBindingInput {
  readonly ingestManifest: unknown;
  readonly phase1Bundle: unknown;
  readonly identityReview: unknown;
  readonly e57Inspection: unknown;
  readonly colmapInspection: unknown;
  readonly residualReport: unknown;
  readonly transformProposal: unknown;
  readonly phase1OutputIndex: unknown;
  readonly phase1OutputIndexFileSha256: string;
  readonly identityOverviewFileSha256: string;
  readonly auditReportFileSha256: string;
  readonly auditEvidence: unknown;
  readonly gateIntake: unknown;
  readonly gateIntakeFileSha256: string;
  readonly foundryPreparation: unknown;
  readonly foundryPreparationFileSha256: string;
  readonly releaseManifest: unknown;
  readonly releaseManifestFileSha256: string;
  readonly qaReport: unknown;
  readonly qaReportFileSha256: string;
  readonly preparedSourceManifest: unknown;
  readonly preparedSourceManifestFileSha256: string;
}

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) return error.code;
  return undefined;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(comparable(parent), comparable(candidate));
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function canonicalDirectoryNoLinks(input: string, label: string): Promise<string> {
  const absolute = resolve(input);
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory, not a link: ${absolute}`);
  }
  const canonical = await realpath(absolute);
  if (comparable(canonical) !== comparable(absolute)) {
    throw new Error(`${label} resolves through a link or reparse point: ${absolute}`);
  }
  return canonical;
}

async function canonicalFileNoLinks(input: string, label: string): Promise<string> {
  const absolute = resolve(input);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a link: ${absolute}`);
  }
  const canonical = await realpath(absolute);
  if (comparable(canonical) !== comparable(absolute)) {
    throw new Error(`${label} resolves through a link or reparse point: ${absolute}`);
  }
  return canonical;
}

async function enumerateFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Evidence package contains a link or reparse point: ${absolute}`);
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        result.push(relative(root, absolute).replaceAll("\\", "/"));
      } else {
        throw new Error(`Evidence package contains a non-file entry: ${absolute}`);
      }
    }
  };
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right, "en-US"));
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value;
  } catch (error: unknown) {
    throw new Error(`${label} is not valid JSON: ${path}`, { cause: error });
  }
}

function requireMemberRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): Readonly<Record<string, unknown>> {
  return requireRecord(record[key], label);
}

function requireMemberArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function assertExact(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} does not match the exact evidence epoch`);
}

function canonical(value: unknown): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
}

function assertCanonicalEqual(actual: unknown, expected: unknown, label: string): void {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${label} does not match the exact evidence epoch`);
  }
}

function prefixedSha256(digest: { readonly sha256: string }): string {
  return `sha256:${digest.sha256}`;
}

function excludedSweepIndices(decision: Readonly<Record<string, unknown>>): readonly unknown[] {
  return requireMemberArray(decision, "excludedSweeps", "identity decision excludedSweeps").map(
    (entry, index) => requireRecord(entry, `identity decision excluded sweep ${String(index)}`).sweepIndex,
  );
}

function validateGrandHallEvidenceBindings(input: GrandHallEvidenceBindingInput): void {
  const ingest = requireRecord(input.ingestManifest, "ingest manifest");
  const bundle = requireRecord(input.phase1Bundle, "phase-one bundle");
  const identity = requireRecord(input.identityReview, "identity review");
  const residual = requireRecord(input.residualReport, "residual report");
  const proposal = requireRecord(input.transformProposal, "transform proposal");
  const index = requireRecord(input.phase1OutputIndex, "phase-one output index");
  const audit = requireRecord(input.auditEvidence, "control audit evidence");
  const intake = requireRecord(input.gateIntake, "review gate intake");
  const preparation = requireRecord(input.foundryPreparation, "prepared release record");
  const release = requireRecord(input.releaseManifest, "prepared release manifest");
  const qa = requireRecord(input.qaReport, "prepared QA report");
  const sourceManifest = requireRecord(input.preparedSourceManifest, "prepared source manifest");

  for (const [key, standalone] of [
    ["identityReview", input.identityReview],
    ["e57Inspection", input.e57Inspection],
    ["colmapInspection", input.colmapInspection],
    ["residualReport", input.residualReport],
    ["transformProposal", input.transformProposal],
  ] as const) {
    assertCanonicalEqual(bundle[key], standalone, `phase-one bundle ${key}`);
  }

  assertExact(identity.venueSlug, VENUE_SLUG, "identity review venueSlug");
  assertExact(identity.roomSlug, ROOM_SLUG, "identity review roomSlug");
  const identityDecision = requireMemberRecord(identity, "decision", "identity review decision");
  assertExact(identityDecision.code, "B", "identity review decision code");
  assertExact(identityDecision.roomIdentityConfirmed, true, "identity review room decision");

  assertExact(index.schemaVersion, "omnitwin.foundry.phase1-output-index.v0", "phase-one index schemaVersion");
  assertExact(index.projectId, ingest.projectId, "phase-one index projectId");
  assertExact(index.ingestManifestSha256, bundle.ingestManifestSha256, "phase-one index ingest digest");
  assertCanonicalEqual(index.identityDecision, identityDecision, "phase-one index identity decision");
  assertCanonicalEqual(
    index.includedRoomSweeps,
    identityDecision.confirmedIdentitySweepIndices,
    "phase-one index included room sweeps",
  );
  assertCanonicalEqual(
    index.excludedRoomSweeps,
    identityDecision.excludedSweeps,
    "phase-one index excluded room sweeps",
  );
  assertCanonicalEqual(
    index.permissions,
    {
      paidCompute: false,
      proprietaryPayloadParsing: false,
      publication: false,
      sourceMutation: false,
      training: false,
    },
    "phase-one index permissions",
  );

  assertExact(audit.schemaVersion, "omnitwin.foundry.grand-hall-control-audit.v0", "control audit schemaVersion");
  assertExact(audit.venueSlug, VENUE_SLUG, "control audit venueSlug");
  assertExact(audit.roomSlug, ROOM_SLUG, "control audit roomSlug");
  assertExact(
    audit.classification,
    "draft_private_not_registrable_not_review_approvable",
    "control audit classification",
  );
  assertCanonicalEqual(
    audit.permissions,
    {
      sourceMutation: false,
      evidenceRegistration: false,
      reviewMutation: false,
      modelTraining: false,
      paidCompute: false,
      signing: false,
      publication: false,
      promotion: false,
    },
    "control audit permissions",
  );
  assertExact(audit.auditReportFileSha256, input.auditReportFileSha256, "control audit report hash");
  assertExact(audit.reviewGateIntakeFileSha256, input.gateIntakeFileSha256, "review gate intake hash");

  const phase1Audit = requireMemberRecord(audit, "phase1Evidence", "control audit phase-one evidence");
  assertExact(phase1Audit.packageId, index.projectId, "control audit phase-one packageId");
  assertExact(
    phase1Audit.outputIndexFileSha256,
    input.phase1OutputIndexFileSha256,
    "control audit phase-one output index hash",
  );
  assertExact(
    phase1Audit.identityGateOverviewFileSha256,
    input.identityOverviewFileSha256,
    "control audit identity overview hash",
  );
  assertExact(phase1Audit.ingestManifestSha256, bundle.ingestManifestSha256, "control audit ingest digest");
  assertExact(phase1Audit.identityReviewSha256, identity.reviewSha256, "control audit identity digest");
  assertExact(phase1Audit.residualReportSha256, residual.reportSha256, "control audit residual digest");
  assertExact(phase1Audit.transformProposalSha256, proposal.proposalSha256, "control audit proposal digest");

  const auditIdentityDecision = requireMemberRecord(
    phase1Audit,
    "identityDecision",
    "control audit identity decision",
  );
  assertExact(auditIdentityDecision.code, identityDecision.code, "control audit identity decision code");
  assertCanonicalEqual(
    auditIdentityDecision.confirmedSweepIndices,
    identityDecision.confirmedIdentitySweepIndices,
    "control audit confirmed identity sweeps",
  );
  assertCanonicalEqual(
    auditIdentityDecision.excludedSweepIndices,
    excludedSweepIndices(identityDecision),
    "control audit excluded identity sweeps",
  );

  const auditProposal = requireMemberRecord(phase1Audit, "proposal", "control audit proposal");
  for (const key of ["state", "sourceFrame", "targetFrame", "scale"] as const) {
    assertExact(auditProposal[key], proposal[key], `control audit proposal ${key}`);
  }
  assertCanonicalEqual(auditProposal.authority, proposal.authority, "control audit proposal authority");
  const proposalMetrics = requireMemberRecord(proposal, "residualMetrics", "proposal residual metrics");
  const candidateMetrics = requireMemberRecord(proposalMetrics, "candidate", "proposal candidate metrics");
  const holdoutMetrics = requireMemberRecord(proposalMetrics, "holdout", "proposal holdout metrics");
  assertCanonicalEqual(
    auditProposal.candidateMetricsM,
    {
      count: candidateMetrics.count,
      mean: candidateMetrics.meanMeters,
      median: candidateMetrics.medianMeters,
      rmse: candidateMetrics.rmseMeters,
      p95: candidateMetrics.p95Meters,
      maximum: candidateMetrics.maxMeters,
    },
    "control audit candidate metrics",
  );
  assertCanonicalEqual(
    auditProposal.frozenHoldoutMetricsM,
    {
      sweepIndices: proposal.holdoutSweepIndices,
      count: holdoutMetrics.count,
      mean: holdoutMetrics.meanMeters,
      median: holdoutMetrics.medianMeters,
      rmse: holdoutMetrics.rmseMeters,
      p95: holdoutMetrics.p95Meters,
      maximum: holdoutMetrics.maxMeters,
    },
    "control audit frozen holdout metrics",
  );
  assertExact(
    auditProposal.classification,
    "shared_lineage_internal_self_consistency_only",
    "control audit proposal classification",
  );
  assertExact(auditProposal.independentAccuracyClaim, false, "control audit independent accuracy claim");

  const independentControl = requireMemberRecord(
    audit,
    "independentControl",
    "control audit independent control",
  );
  assertExact(independentControl.status, "absent", "control audit independent control status");
  const relevance = requireMemberRecord(audit, "releaseRelevanceFinding", "release relevance finding");
  assertExact(relevance.status, "failed", "release relevance finding status");

  assertExact(release.venueSlug, VENUE_SLUG, "prepared release venueSlug");
  assertExact(sourceManifest.venueSlug, VENUE_SLUG, "prepared source manifest venueSlug");
  assertExact(input.preparedSourceManifestFileSha256, `sha256:${String(release.sourceManifestSha256)}`, "prepared source manifest hash");
  assertExact(qa.releaseDigest, release.releaseDigest, "prepared QA release digest");
  assertExact(qa.sourceManifestSha256, release.sourceManifestSha256, "prepared QA source manifest digest");
  assertExact(qa.outcome, "passed", "prepared QA outcome");
  assertExact(preparation.releaseDigest, release.releaseDigest, "prepared release record digest");
  assertExact(
    preparation.releaseManifestSha256,
    input.releaseManifestFileSha256.slice("sha256:".length),
    "prepared release record manifest hash",
  );
  assertExact(
    preparation.qaReportFileSha256,
    input.qaReportFileSha256.slice("sha256:".length),
    "prepared release record QA hash",
  );

  const preparedAudit = requireMemberRecord(
    audit,
    "preparedReleaseAuditTarget",
    "control audit prepared release target",
  );
  assertExact(
    preparedAudit.foundryPreparationFileSha256,
    input.foundryPreparationFileSha256,
    "control audit preparation file hash",
  );
  assertExact(
    preparedAudit.releaseManifestFileSha256,
    input.releaseManifestFileSha256,
    "control audit release manifest file hash",
  );
  assertExact(preparedAudit.qaReportFileSha256, input.qaReportFileSha256, "control audit QA file hash");
  assertExact(preparedAudit.releaseDigest, release.releaseDigest, "control audit release digest");
  assertExact(preparedAudit.qaReportDigest, qa.reportDigest, "control audit QA report digest");
  assertExact(preparedAudit.sourceManifestSha256, release.sourceManifestSha256, "control audit source manifest digest");
  assertExact(
    preparedAudit.sourceManifestFileSha256,
    input.preparedSourceManifestFileSha256,
    "control audit source manifest file hash",
  );
  assertExact(preparedAudit.fileCount, release.fileCount, "control audit release file count");
  assertExact(preparedAudit.totalBytes, release.totalBytes, "control audit release byte count");
  const sourceNodes = requireMemberArray(sourceManifest, "nodes", "prepared source manifest nodes");
  assertExact(preparedAudit.nodeCount, sourceNodes.length, "control audit source manifest node count");
  if (sourceNodes.some((node, index) => requireRecord(node, `prepared source node ${String(index)}`).roomSlug !== null)) {
    throw new Error("prepared source manifest contains a roomSlug contrary to the audited release scope");
  }
  const releaseFiles = requireMemberArray(release, "files", "prepared release files");
  const evidenceRoleFileCount = releaseFiles.filter(
    (file, index) => requireRecord(file, `prepared release file ${String(index)}`).role === "evidence",
  ).length;
  assertExact(preparedAudit.evidenceRoleFileCount, evidenceRoleFileCount, "control audit evidence-role count");

  const confidence = requireMemberRecord(audit, "confidenceTierFinding", "confidence tier finding");
  assertExact(
    confidence.preparedEpochSourceManifestAvailableInDossier,
    true,
    "confidence tier prepared source manifest availability",
  );
  assertExact(
    confidence.preparedEpochSourceManifestFileSha256,
    input.preparedSourceManifestFileSha256,
    "confidence tier prepared source manifest hash",
  );
  assertExact(confidence.preparedEpochTier, sourceManifest.tier, "confidence tier prepared epoch tier");
  assertExact(confidence.independentControl, "absent", "confidence tier independent control");
  assertExact(
    confidence.currentSourceManifestFileSha256,
    preparedAudit.currentSourceManifestFileSha256,
    "confidence tier current manifest hash",
  );
  assertExact(
    confidence.disposition,
    "unsupported_for_public_or_operational_reliance_pending_downgrade_or_reissue",
    "confidence tier disposition",
  );

  const auditReadiness = requireMemberRecord(audit, "readiness", "control audit readiness");
  assertExact(
    auditReadiness.offlineEvidenceReview,
    "blocked_missing_complete_identity_pixels_and_rights_clearance",
    "control audit offline evidence readiness",
  );

  assertExact(intake.schemaVersion, "omnitwin.foundry.review-gate-intake.v0", "review gate intake schemaVersion");
  assertExact(intake.venueSlug, VENUE_SLUG, "review gate intake venueSlug");
  assertExact(intake.roomSlug, ROOM_SLUG, "review gate intake roomSlug");
  assertExact(intake.state, "awaiting_external_evidence", "review gate intake state");
  assertExact(intake.authority, "none", "review gate intake authority");
  const intakeControl = requireMemberRecord(intake, "control", "review gate intake control");
  assertExact(intakeControl.status, "missing", "review gate intake control status");
  assertCanonicalEqual(intakeControl.fitControls, [], "review gate intake fit controls");
  assertCanonicalEqual(intakeControl.blindChecks, [], "review gate intake blind checks");
  const identityAttestation = requireMemberRecord(
    intake,
    "identityAttestation",
    "review gate identity attestation",
  );
  assertExact(
    identityAttestation.status,
    "missing_authenticated_external_attestation",
    "review gate identity attestation status",
  );
  const reviewSubject = requireMemberRecord(
    identityAttestation,
    "reviewSubject",
    "review gate identity review subject",
  );
  assertExact(reviewSubject.identityReviewSha256, identity.reviewSha256, "review gate identity digest");
  assertExact(reviewSubject.identityDecision, identityDecision.code, "review gate identity decision");
  assertCanonicalEqual(
    reviewSubject.confirmedSweepIndices,
    identityDecision.confirmedIdentitySweepIndices,
    "review gate confirmed identity sweeps",
  );
  assertCanonicalEqual(
    reviewSubject.excludedSweepIndices,
    excludedSweepIndices(identityDecision),
    "review gate excluded identity sweeps",
  );
  const rights = requireMemberRecord(intake, "rights", "review gate rights");
  assertExact(
    requireMemberRecord(rights, "matterport", "review gate Matterport rights").status,
    "requires_external_legal_decision",
    "review gate Matterport rights status",
  );
  assertExact(
    requireMemberRecord(rights, "identityReferences", "review gate identity-reference rights").status,
    "requires_written_permission_or_replacement",
    "review gate identity-reference rights status",
  );
  assertExact(
    requireMemberRecord(intake, "releaseScopeDecision", "review gate release scope").status,
    "required",
    "review gate release scope status",
  );
}

export function __testOnlyValidateGrandHallEvidenceBindings(
  input: GrandHallEvidenceBindingInput,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("offline review binding validation is available only in the test environment");
  }
  validateGrandHallEvidenceBindings(input);
}

function parsePhase1Index(input: unknown): readonly Phase1IndexEntry[] {
  const index = requireRecord(input, "phase-one output index");
  if (index.schemaVersion !== "omnitwin.foundry.phase1-output-index.v0") {
    throw new Error("phase-one output index schemaVersion is not supported");
  }
  if (!Array.isArray(index.files)) throw new Error("phase-one output index files must be an array");
  const entries = index.files.map((entry, position) => {
    const record = requireRecord(entry, `phase-one output index file ${String(position)}`);
    if (typeof record.relativePath !== "string" || typeof record.sha256 !== "string") {
      throw new Error("phase-one output index file entries require relativePath and sha256");
    }
    return { relativePath: record.relativePath, sha256: record.sha256 };
  });
  const paths = entries.map((entry) => entry.relativePath);
  if (new Set(paths).size !== paths.length) throw new Error("phase-one output index paths must be unique");
  return entries;
}

async function validatePhase1Package(root: string): Promise<ValidatedPhase1Evidence> {
  const actualPaths = await enumerateFiles(root);
  const expectedPaths = [...PHASE1_PATHS].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  if (actualPaths.join("\n") !== expectedPaths.join("\n")) {
    throw new Error("phase-one package tree differs from the exact 13-file allowlist");
  }

  const indexPath = resolveContainedPath(root, "phase1-output-index.json");
  const outputIndex = await readJson(indexPath, "phase-one output index");
  const entries = parsePhase1Index(outputIndex);
  const expectedIndexedPaths = expectedPaths.filter((path) => path !== "phase1-output-index.json");
  const indexedPaths = entries
    .map((entry) => entry.relativePath)
    .sort((left, right) => left.localeCompare(right, "en-US"));
  if (indexedPaths.join("\n") !== expectedIndexedPaths.join("\n")) {
    throw new Error("phase-one output index must cover the exact 12 non-index artifacts");
  }
  for (const entry of entries) {
    const path = resolveContainedPath(root, entry.relativePath);
    const digest = await sha256File(path);
    if (`sha256:${digest.sha256}` !== entry.sha256) {
      throw new Error(`phase-one artifact hash mismatch: ${entry.relativePath}`);
    }
  }

  const ingest = FoundryIngestManifestV0Schema.parse(
    await readJson(resolveContainedPath(root, "foundry-ingest-manifest-v0.json"), "ingest manifest"),
  );
  const bundle = FoundryPhase1BundleV0Schema.parse(
    await readJson(resolveContainedPath(root, "foundry-phase1-bundle-v0.json"), "phase-one bundle"),
  );
  const identityReview = FoundryPhase1IdentityReviewV0Schema.parse(
    await readJson(resolveContainedPath(root, "identity-review.json"), "identity review"),
  );
  const e57Inspection = FoundryPhase1E57InspectionV0Schema.parse(
    await readJson(resolveContainedPath(root, "inspections/e57-inspection.json"), "E57 inspection"),
  );
  const colmapInspection = FoundryPhase1ColmapInspectionV0Schema.parse(
    await readJson(resolveContainedPath(root, "inspections/colmap-inspection.json"), "COLMAP inspection"),
  );
  const residualReport = FoundryPhase1ResidualReportV0Schema.parse(
    await readJson(
      resolveContainedPath(root, "reports/colmap-to-e57-residual-report.json"),
      "residual report",
    ),
  );
  const transformProposal = FoundryPhase1TransformProposalV0Schema.parse(
    await readJson(
      resolveContainedPath(root, "proposals/colmap-to-e57-transform.json"),
      "transform proposal",
    ),
  );
  for (const [relativePath, mode] of [
    ["inspections/raw/e57-probe-output.json", "inspect-e57"],
    ["inspections/raw/colmap-probe-output.json", "inspect-colmap"],
    ["inspections/raw/alignment-probe-output.json", "align"],
  ] as const) {
    const probe = FoundryPhase1ProbeEnvelopeV0Schema.parse(
      await readJson(resolveContainedPath(root, relativePath), relativePath),
    );
    if (probe.status !== "ok" || probe.mode !== mode) {
      throw new Error(`phase-one probe is not the expected successful ${mode} result`);
    }
  }
  if (bundle.ingestManifestSha256 !== computeFoundryIngestManifestSha256(ingest)) {
    throw new Error("phase-one bundle and ingest manifest semantic digests differ");
  }
  const outputIndexDigest = await sha256File(indexPath);
  return {
    ingestManifest: ingest,
    bundle,
    identityReview,
    e57Inspection,
    colmapInspection,
    residualReport,
    transformProposal,
    outputIndex,
    outputIndexFileSha256: prefixedSha256(outputIndexDigest),
  };
}

async function validatePreparedRelease(
  root: string,
  sourceManifestPath: string,
): Promise<ValidatedPreparedReleaseEvidence> {
  const actualPaths = await enumerateFiles(root);
  const required = [...PREPARED_RELEASE_PATHS].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  for (const path of required) {
    if (!actualPaths.includes(path)) throw new Error(`prepared release is missing ${path}`);
  }
  const manifestPath = resolveContainedPath(root, "release-manifest.json");
  const qaPath = resolveContainedPath(root, "qa-report.json");
  const preparationPath = resolveContainedPath(root, "foundry-preparation.json");
  const manifest = ReconstructionReleaseManifestSchema.parse(
    await readJson(manifestPath, "prepared release manifest"),
  );
  const qa = ReconstructionQaReportSchema.parse(await readJson(qaPath, "prepared QA report"));
  if (
    qa.releaseDigest !== manifest.releaseDigest ||
    qa.sourceManifestSha256 !== manifest.sourceManifestSha256
  ) {
    throw new Error("prepared QA does not bind the exact release manifest epoch");
  }
  const preparation = requireRecord(
    await readJson(preparationPath, "prepared release record"),
    "prepared release record",
  );
  if (preparation.schemaVersion !== "venviewer.reconstruction-preparation.v1") {
    throw new Error("prepared release record schemaVersion is not supported");
  }
  if (preparation.releaseDigest !== manifest.releaseDigest) {
    throw new Error("prepared release record does not bind the release digest");
  }
  const manifestDigest = await sha256File(manifestPath);
  const qaDigest = await sha256File(qaPath);
  if (
    preparation.releaseManifestSha256 !== manifestDigest.sha256 ||
    preparation.qaReportFileSha256 !== qaDigest.sha256 ||
    preparation.releaseManifestSizeBytes !== manifestDigest.sizeBytes ||
    preparation.qaReportSizeBytes !== qaDigest.sizeBytes
  ) {
    throw new Error("prepared release record does not bind exact manifest and QA file bytes and sizes");
  }
  const sourceManifest = TwinManifestSchema.parse(
    await readJson(sourceManifestPath, "prepared source manifest"),
  );
  const sourceManifestDigest = await sha256File(sourceManifestPath);
  if (sourceManifestDigest.sha256 !== manifest.sourceManifestSha256) {
    throw new Error("prepared source manifest bytes do not match the frozen release epoch");
  }
  const sourceManifestEntry = manifest.files.find(
    (file) => file.path === "manifest.json" && file.role === "manifest",
  );
  if (
    sourceManifestEntry === undefined ||
    sourceManifestEntry.sizeBytes !== sourceManifestDigest.sizeBytes
  ) {
    throw new Error("prepared source manifest byte length does not match the release inventory");
  }
  return {
    preparation,
    preparationFileSha256: prefixedSha256(await sha256File(preparationPath)),
    releaseManifest: manifest,
    releaseManifestFileSha256: prefixedSha256(manifestDigest),
    qaReport: qa,
    qaReportFileSha256: prefixedSha256(qaDigest),
    sourceManifest,
    sourceManifestFileSha256: prefixedSha256(sourceManifestDigest),
    releaseDigest: manifest.releaseDigest,
  };
}

async function assertPng(path: string): Promise<void> {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("identity overview is not a PNG file");
}

function evidenceFiles(paths: GrandHallEvidencePaths): readonly {
  readonly relativePath: string;
  readonly absolutePath: string;
}[] {
  return [
    ...PHASE1_PATHS.map((relativePath) => ({
      relativePath: `t507/${relativePath}`,
      absolutePath: resolveContainedPath(paths.phase1Root, relativePath),
    })),
    {
      relativePath: "identity/identity-gate-overview.png",
      absolutePath: paths.identityOverview,
    },
    {
      relativePath: "audit/grand-hall-t507-independent-control-audit.md",
      absolutePath: paths.auditReport,
    },
    {
      relativePath: "audit/grand-hall-t507-independent-control-evidence.json",
      absolutePath: paths.auditEvidence,
    },
    {
      relativePath: "control/grand-hall-review-gate-intake.json",
      absolutePath: paths.gateIntake,
    },
    {
      relativePath: "target/foundry-preparation.json",
      absolutePath: resolveContainedPath(paths.preparedReleaseRoot, "foundry-preparation.json"),
    },
    {
      relativePath: "target/qa-report.json",
      absolutePath: resolveContainedPath(paths.preparedReleaseRoot, "qa-report.json"),
    },
    {
      relativePath: "target/release-manifest.json",
      absolutePath: resolveContainedPath(paths.preparedReleaseRoot, "release-manifest.json"),
    },
    {
      relativePath: "target/source-manifest.json",
      absolutePath: paths.preparedSourceManifest,
    },
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en-US"));
}

async function computeEvidenceSetSha256(paths: GrandHallEvidencePaths): Promise<string> {
  const inventory = await Promise.all(
    evidenceFiles(paths).map(async (file) => {
      const digest = await sha256File(file.absolutePath);
      return {
        relativePath: file.relativePath,
        sha256: prefixedSha256(digest),
        byteLength: digest.sizeBytes,
      };
    }),
  );
  return `sha256:${sha256Hex(
    `${GRAND_HALL_EVIDENCE_SET_DIGEST_DOMAIN}${canonical(inventory)}`,
  )}`;
}

async function validateEvidencePaths(
  paths: GrandHallEvidencePaths,
): Promise<GrandHallOfflineReviewEvidenceValidation> {
  const phase1 = await validatePhase1Package(paths.phase1Root);
  const prepared = await validatePreparedRelease(
    paths.preparedReleaseRoot,
    paths.preparedSourceManifest,
  );
  await assertPng(paths.identityOverview);
  if (extname(paths.auditReport).toLowerCase() !== ".md") {
    throw new Error("control audit report must be a Markdown file");
  }
  const [identityDigest, auditReportDigest, gateIntakeDigest, auditEvidence, gateIntake] =
    await Promise.all([
      sha256File(paths.identityOverview),
      sha256File(paths.auditReport),
      sha256File(paths.gateIntake),
      readJson(paths.auditEvidence, "control audit evidence"),
      readJson(paths.gateIntake, "review gate intake"),
    ]);
  validateGrandHallEvidenceBindings({
    ingestManifest: phase1.ingestManifest,
    phase1Bundle: phase1.bundle,
    identityReview: phase1.identityReview,
    e57Inspection: phase1.e57Inspection,
    colmapInspection: phase1.colmapInspection,
    residualReport: phase1.residualReport,
    transformProposal: phase1.transformProposal,
    phase1OutputIndex: phase1.outputIndex,
    phase1OutputIndexFileSha256: phase1.outputIndexFileSha256,
    identityOverviewFileSha256: prefixedSha256(identityDigest),
    auditReportFileSha256: prefixedSha256(auditReportDigest),
    auditEvidence,
    gateIntake,
    gateIntakeFileSha256: prefixedSha256(gateIntakeDigest),
    foundryPreparation: prepared.preparation,
    foundryPreparationFileSha256: prepared.preparationFileSha256,
    releaseManifest: prepared.releaseManifest,
    releaseManifestFileSha256: prepared.releaseManifestFileSha256,
    qaReport: prepared.qaReport,
    qaReportFileSha256: prepared.qaReportFileSha256,
    preparedSourceManifest: prepared.sourceManifest,
    preparedSourceManifestFileSha256: prepared.sourceManifestFileSha256,
  });
  return {
    releaseDigest: prepared.releaseDigest,
    evidenceSetSha256: await computeEvidenceSetSha256(paths),
  };
}

async function defaultValidateSources(
  options: GrandHallOfflineReviewOptions,
): Promise<GrandHallOfflineReviewValidatedSources> {
  const phase1Root = await canonicalDirectoryNoLinks(options.phase1PackageRoot, "phase-one package");
  const preparedReleaseRoot = await canonicalDirectoryNoLinks(
    options.preparedReleaseRoot,
    "prepared release",
  );
  const preparedSourceManifest = await canonicalFileNoLinks(
    options.preparedSourceManifestPath,
    "prepared source manifest",
  );
  const identityOverview = await canonicalFileNoLinks(
    options.identityOverviewPath,
    "identity overview",
  );
  const auditReport = await canonicalFileNoLinks(options.auditReportPath, "control audit report");
  const auditEvidence = await canonicalFileNoLinks(
    options.auditEvidencePath,
    "control audit evidence",
  );
  const gateIntake = await canonicalFileNoLinks(options.gateIntakePath, "review gate intake");

  const validation = await validateEvidencePaths({
    phase1Root,
    preparedReleaseRoot,
    preparedSourceManifest,
    identityOverview,
    auditReport,
    auditEvidence,
    gateIntake,
  });
  return {
    phase1Root,
    preparedReleaseRoot,
    preparedSourceManifest,
    identityOverview,
    auditReport,
    auditEvidence,
    gateIntake,
    releaseDigest: validation.releaseDigest,
    evidenceSetSha256: validation.evidenceSetSha256,
  };
}

function phase1Kind(relativePath: string): FoundryOfflineReviewArtifactKind {
  if (relativePath === "foundry-phase1-bundle-v0.json") return "phase1_bundle";
  if (relativePath === "foundry-ingest-manifest-v0.json") return "ingest_manifest";
  if (relativePath === "identity-review.json") return "identity_review";
  if (relativePath.startsWith("inspections/")) return "source_inspection";
  if (relativePath === "proposals/colmap-to-e57-transform.json") return "transform_proposal";
  if (relativePath.startsWith("reports/")) return "residual_report";
  return "supporting_evidence";
}

function mediaType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".png") return "image/png";
  if (extension === ".md") return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function artifactId(path: string): string {
  const id = path
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 150);
  if (id === "") throw new Error(`Cannot derive an artifact ID from path: ${path}`);
  return id;
}

function sourceArtifacts(sources: GrandHallOfflineReviewValidatedSources): SourceArtifact[] {
  const phase1 = PHASE1_PATHS.map((relativePath) => ({
    sourcePath: resolveContainedPath(sources.phase1Root, relativePath),
    targetPath: `t507/${relativePath}`,
    kind: phase1Kind(relativePath),
  }));
  return [
    ...phase1,
    {
      sourcePath: sources.identityOverview,
      targetPath: "identity/identity-gate-overview.png",
      kind: "fixed_view" as const,
    },
    {
      sourcePath: sources.auditReport,
      targetPath: "audit/grand-hall-t507-independent-control-audit.md",
      kind: "human_readable_report" as const,
    },
    {
      sourcePath: sources.auditEvidence,
      targetPath: "audit/grand-hall-t507-independent-control-evidence.json",
      kind: "supporting_evidence" as const,
    },
    {
      sourcePath: sources.gateIntake,
      targetPath: "control/grand-hall-review-gate-intake.json",
      kind: "supporting_evidence" as const,
    },
    {
      sourcePath: resolveContainedPath(sources.preparedReleaseRoot, "foundry-preparation.json"),
      targetPath: "target/foundry-preparation.json",
      kind: "supporting_evidence" as const,
    },
    {
      sourcePath: resolveContainedPath(sources.preparedReleaseRoot, "qa-report.json"),
      targetPath: "target/qa-report.json",
      kind: "qa_report" as const,
    },
    {
      sourcePath: resolveContainedPath(sources.preparedReleaseRoot, "release-manifest.json"),
      targetPath: "target/release-manifest.json",
      kind: "release_manifest" as const,
    },
    {
      sourcePath: sources.preparedSourceManifest,
      targetPath: "target/source-manifest.json",
      kind: "supporting_evidence" as const,
    },
  ].sort((left, right) => left.targetPath.localeCompare(right.targetPath, "en-US"));
}

async function defaultValidateCopiedDossier(
  root: string,
  phase: GrandHallOfflineReviewValidationPhase,
): Promise<GrandHallOfflineReviewEvidenceValidation> {
  const expected = [
    ...DOSSIER_ARTIFACT_PATHS,
    ...(phase === "before_manifest" ? [] : [PACKAGE_MANIFEST]),
  ].sort((left, right) => left.localeCompare(right, "en-US"));
  const actual = await enumerateFiles(root);
  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error(`offline review ${phase} tree differs from the exact dossier allowlist`);
  }
  return await validateEvidencePaths({
    phase1Root: resolveContainedPath(root, "t507"),
    preparedReleaseRoot: resolveContainedPath(root, "target"),
    preparedSourceManifest: resolveContainedPath(root, "target/source-manifest.json"),
    identityOverview: resolveContainedPath(root, "identity/identity-gate-overview.png"),
    auditReport: resolveContainedPath(
      root,
      "audit/grand-hall-t507-independent-control-audit.md",
    ),
    auditEvidence: resolveContainedPath(
      root,
      "audit/grand-hall-t507-independent-control-evidence.json",
    ),
    gateIntake: resolveContainedPath(root, "control/grand-hall-review-gate-intake.json"),
  });
}

const defaultDependencies: GrandHallOfflineReviewDependencies = {
  validateSources: defaultValidateSources,
  validateCopiedDossier: defaultValidateCopiedDossier,
};

async function copyArtifact(
  source: SourceArtifact,
  temporaryRoot: string,
): Promise<FoundryOfflineReviewArtifactV0> {
  const target = resolveContainedPath(temporaryRoot, source.targetPath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source.sourcePath, target, constants.COPYFILE_EXCL);
  const sourceDigest = await sha256File(source.sourcePath);
  const targetDigest = await sha256File(target);
  if (
    sourceDigest.sha256 !== targetDigest.sha256 ||
    sourceDigest.sizeBytes !== targetDigest.sizeBytes
  ) {
    throw new Error(`Copied review artifact failed byte verification: ${source.targetPath}`);
  }
  return {
    id: artifactId(source.targetPath),
    kind: source.kind,
    relativePath: source.targetPath,
    sha256: `sha256:${targetDigest.sha256}`,
    byteLength: targetDigest.sizeBytes,
    mediaType: mediaType(source.targetPath),
  };
}

async function verifyOutputTree(
  root: string,
  reviewPackage: FoundryOfflineReviewPackageV0,
): Promise<void> {
  const actual = await enumerateFiles(root);
  const expected = [PACKAGE_MANIFEST, ...reviewPackage.artifacts.map((artifact) => artifact.relativePath)]
    .sort((left, right) => left.localeCompare(right, "en-US"));
  if (actual.join("\n") !== expected.join("\n")) {
    throw new Error("offline review output tree differs from the manifest");
  }
  for (const artifact of reviewPackage.artifacts) {
    const digest = await sha256File(resolveContainedPath(root, artifact.relativePath));
    if (`sha256:${digest.sha256}` !== artifact.sha256 || digest.sizeBytes !== artifact.byteLength) {
      throw new Error(`offline review output artifact failed verification: ${artifact.relativePath}`);
    }
  }
  const parsed = FoundryOfflineReviewPackageV0Schema.parse(
    await readJson(resolveContainedPath(root, PACKAGE_MANIFEST), "offline review package manifest"),
  );
  if (parsed.packageSha256 !== reviewPackage.packageSha256) {
    throw new Error("offline review package manifest changed after writing");
  }
}

async function prepareWithDependencies(
  options: GrandHallOfflineReviewOptions,
  dependencies: GrandHallOfflineReviewDependencies,
): Promise<GrandHallOfflineReviewResult> {
  const sources = await dependencies.validateSources(options);
  const output = resolve(options.outputDirectory);
  if (await exists(output)) throw new Error(`offline review output already exists: ${output}`);
  for (const root of [sources.phase1Root, sources.preparedReleaseRoot]) {
    const disjoint = await assertDisjointDestination(root, output);
    if (comparable(disjoint) !== comparable(output)) {
      throw new Error("offline review output path changed during canonical resolution");
    }
  }
  for (const file of [
    sources.preparedSourceManifest,
    sources.identityOverview,
    sources.auditReport,
    sources.auditEvidence,
    sources.gateIntake,
  ]) {
    if (isWithin(output, file)) throw new Error("offline review output cannot contain source evidence");
  }

  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), `.${basename(output)}-partial-`));
  let promoted = false;
  try {
    const artifacts: FoundryOfflineReviewArtifactV0[] = [];
    for (const source of sourceArtifacts(sources)) {
      artifacts.push(await copyArtifact(source, temporary));
    }
    const stagedValidation = await dependencies.validateCopiedDossier(
      temporary,
      "before_manifest",
    );
    if (
      stagedValidation.releaseDigest !== sources.releaseDigest ||
      stagedValidation.evidenceSetSha256 !== sources.evidenceSetSha256
    ) {
      throw new Error("copied dossier differs from the validated source evidence epoch");
    }
    const subjectPath = "t507/foundry-phase1-bundle-v0.json";
    const subject = artifacts.find((artifact) => artifact.relativePath === subjectPath);
    if (subject === undefined) throw new Error("offline review package has no phase-one subject");
    const reviewPackage = buildFoundryOfflineReviewPackageV0({
      schemaVersion: FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0,
      packageId: basename(output),
      projectId: options.projectId,
      venueSlug: VENUE_SLUG,
      roomSlug: ROOM_SLUG,
      createdAt: options.createdAt,
      createdBy: options.createdBy,
      mode: "offline_unsigned_preflight",
      authority: "none",
      subjectArtifactId: subject.id,
      artifacts,
      readiness: {
        evidenceReview: {
          status: "blocked",
          blockers: [...OFFLINE_REVIEW_EVIDENCE_BLOCKERS],
        },
        publicApproval: {
          status: "not_ready_offline",
          requirements: [
            "Acquire independent surveyed control and validate a frozen release-load-bearing transform without refitting.",
            "Choose the whole-release or bounded-Grand-Hall evidence epoch and classify every node in scope.",
            "Register a human-reviewed TransformArtifactV0 and complete SceneAuthorityMapV0 through T-486.",
            "Resolve Matterport processing rights, model-training prohibition, identity-reference rights, and authenticated identity attestation.",
            "Perform the exact online T-486 public-review validation; this offline package cannot approve a release.",
          ],
        },
        signing: {
          status: "not_ready_unsigned",
          requirements: [
            "Persist an evidence-complete public approval through the authorized T-486 review path.",
            "Obtain the exact byte-bound server-issued signing payload in an authorized key-custodian ceremony.",
          ],
        },
      },
    });
    await writeImmutableJson(resolveContainedPath(temporary, PACKAGE_MANIFEST), reviewPackage);
    await verifyOutputTree(temporary, reviewPackage);
    const beforePromotion = await dependencies.validateCopiedDossier(
      temporary,
      "before_promotion",
    );
    if (
      beforePromotion.releaseDigest !== stagedValidation.releaseDigest ||
      beforePromotion.evidenceSetSha256 !== stagedValidation.evidenceSetSha256
    ) {
      throw new Error("offline review evidence set changed before promotion");
    }
    await rename(temporary, output);
    promoted = true;
    const afterPromotion = await dependencies.validateCopiedDossier(output, "after_promotion");
    if (
      afterPromotion.releaseDigest !== stagedValidation.releaseDigest ||
      afterPromotion.evidenceSetSha256 !== stagedValidation.evidenceSetSha256
    ) {
      throw new Error("offline review evidence set changed after promotion");
    }
    await verifyOutputTree(output, reviewPackage);
    return {
      outputDirectory: output,
      packageSha256: reviewPackage.packageSha256,
      artifactCount: reviewPackage.artifacts.length,
      releaseDigest: stagedValidation.releaseDigest,
    };
  } catch (error: unknown) {
    await rm(promoted ? output : temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareGrandHallOfflineReview(
  options: GrandHallOfflineReviewOptions,
): Promise<GrandHallOfflineReviewResult> {
  return await prepareWithDependencies(options, defaultDependencies);
}

export async function __testOnlyPrepareGrandHallOfflineReview(
  options: GrandHallOfflineReviewOptions,
  dependencies: GrandHallOfflineReviewDependencies,
): Promise<GrandHallOfflineReviewResult> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("offline review dependency injection is available only in the test environment");
  }
  return await prepareWithDependencies(options, dependencies);
}

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  computeFoundryIngestManifestSha256,
} from "@omnitwin/types";
import {
  __testOnlyPrepareGrandHallOfflineReview as prepareGrandHallOfflineReview,
  __testOnlyValidateGrandHallEvidenceBindings as validateGrandHallEvidenceBindings,
  prepareGrandHallOfflineReview as prepareProductionGrandHallOfflineReview,
  type GrandHallEvidenceBindingInput,
  type GrandHallOfflineReviewDependencies,
  type GrandHallOfflineReviewOptions,
  type GrandHallOfflineReviewValidationPhase,
} from "../grand-hall-offline-review.js";
import { sha256File } from "../hash.js";

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

const cleanup: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8" });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await write(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fixture(): Promise<{
  readonly options: GrandHallOfflineReviewOptions;
  readonly dependencies: GrandHallOfflineReviewDependencies;
  readonly validationPhases: GrandHallOfflineReviewValidationPhase[];
}> {
  const parent = await mkdtemp(join(tmpdir(), "grand-hall-offline-review-"));
  cleanup.push(parent);
  const phase1Root = join(parent, "phase1");
  const preparedReleaseRoot = join(parent, "prepared");
  for (const path of PHASE1_PATHS) await write(join(phase1Root, path), `{ "path": "${path}" }\n`);
  for (const path of ["foundry-preparation.json", "qa-report.json", "release-manifest.json"]) {
    await write(join(preparedReleaseRoot, path), `{ "path": "${path}" }\n`);
  }
  const preparedSourceManifest = join(parent, "prepared-source-manifest.json");
  await write(preparedSourceManifest, "{}\n");
  const identityOverview = join(parent, "identity-overview.png");
  await writeFile(identityOverview, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  const auditReport = join(parent, "audit.md");
  const auditEvidence = join(parent, "audit.json");
  const gateIntake = join(parent, "intake.json");
  await write(auditReport, "# audit\n");
  await write(auditEvidence, "{}\n");
  await write(gateIntake, "{}\n");
  const output = join(parent, "output");
  const options: GrandHallOfflineReviewOptions = {
    phase1PackageRoot: phase1Root,
    identityOverviewPath: identityOverview,
    preparedReleaseRoot,
    preparedSourceManifestPath: preparedSourceManifest,
    auditReportPath: auditReport,
    auditEvidencePath: auditEvidence,
    gateIntakePath: gateIntake,
    outputDirectory: output,
    projectId: "fixture-project",
    createdBy: "fixture:evidence-preparer",
    createdAt: "2026-07-13T10:30:00.000Z",
  };
  const releaseDigest = "a".repeat(64);
  const evidenceSetSha256 = `sha256:${"b".repeat(64)}`;
  const validationPhases: GrandHallOfflineReviewValidationPhase[] = [];
  const dependencies: GrandHallOfflineReviewDependencies = {
    validateSources: () => Promise.resolve({
      phase1Root,
      preparedReleaseRoot,
      preparedSourceManifest,
      identityOverview,
      auditReport,
      auditEvidence,
      gateIntake,
      releaseDigest,
      evidenceSetSha256,
    }),
    validateCopiedDossier: async (root, phase) => {
      validationPhases.push(phase);
      const hasManifest = await exists(join(root, "package-manifest.json"));
      expect(hasManifest).toBe(phase !== "before_manifest");
      return { releaseDigest, evidenceSetSha256 };
    },
  };
  return { options, dependencies, validationPhases };
}

function prefixed(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

interface BindingFixtureOptions {
  readonly phase1OutputIndexFileSha256?: string;
  readonly identityOverviewFileSha256?: string;
  readonly auditReportFileSha256?: string;
  readonly gateIntakeFileSha256?: string;
  readonly foundryPreparationFileSha256?: string;
  readonly releaseManifestFileSha256?: string;
  readonly qaReportFileSha256?: string;
  readonly sourceManifestFileSha256?: string;
  readonly sourceManifestSizeBytes?: number;
  readonly releaseManifestSizeBytes?: number;
  readonly qaReportSizeBytes?: number;
}

function bindingFixture(options: BindingFixtureOptions = {}): GrandHallEvidenceBindingInput {
  const hashes = {
    phase1OutputIndexFileSha256: options.phase1OutputIndexFileSha256 ?? prefixed("1"),
    identityOverviewFileSha256: options.identityOverviewFileSha256 ?? prefixed("2"),
    auditReportFileSha256: options.auditReportFileSha256 ?? prefixed("3"),
    gateIntakeFileSha256: options.gateIntakeFileSha256 ?? prefixed("4"),
    foundryPreparationFileSha256: options.foundryPreparationFileSha256 ?? prefixed("5"),
    releaseManifestFileSha256: options.releaseManifestFileSha256 ?? prefixed("6"),
    qaReportFileSha256: options.qaReportFileSha256 ?? prefixed("7"),
    sourceManifestFileSha256: options.sourceManifestFileSha256 ?? prefixed("8"),
  };
  const ingestManifest = { projectId: "grand-hall-phase1" };
  const ingestManifestSha256 = computeFoundryIngestManifestSha256(ingestManifest as never);
  const decision = {
    code: "B",
    confirmedIdentitySweepIndices: [0, 10, 20, 40],
    excludedSweeps: [{ reason: "excluded_adjacent_space", sweepIndex: 49 }],
    roomIdentityConfirmed: true,
  };
  const identityReview = {
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewSha256: prefixed("a"),
    decision,
  };
  const e57Inspection = { inspectionSha256: prefixed("b") };
  const colmapInspection = { inspectionSha256: prefixed("c") };
  const residualReport = { reportSha256: prefixed("d") };
  const candidateMetrics = {
    count: 49,
    meanMeters: 0.008,
    medianMeters: 0.006,
    rmseMeters: 0.011,
    p95Meters: 0.017,
    maxMeters: 0.046,
  };
  const holdoutMetrics = {
    count: 5,
    meanMeters: 0.005,
    medianMeters: 0.004,
    rmseMeters: 0.006,
    p95Meters: 0.009,
    maxMeters: 0.01,
  };
  const transformProposal = {
    proposalSha256: prefixed("e"),
    state: "proposed",
    sourceFrame: "COLMAP_WORLD",
    targetFrame: "E57_GLOBAL",
    scale: 1.7362,
    authority: { public: "none", runtime: "none" },
    holdoutSweepIndices: [5, 15, 25, 35, 44],
    residualMetrics: { candidate: candidateMetrics, holdout: holdoutMetrics },
  };
  const phase1Bundle = {
    ingestManifestSha256,
    identityReview: structuredClone(identityReview),
    e57Inspection: structuredClone(e57Inspection),
    colmapInspection: structuredClone(colmapInspection),
    residualReport: structuredClone(residualReport),
    transformProposal: structuredClone(transformProposal),
  };
  const phase1OutputIndex = {
    schemaVersion: "omnitwin.foundry.phase1-output-index.v0",
    projectId: ingestManifest.projectId,
    ingestManifestSha256,
    identityDecision: structuredClone(decision),
    includedRoomSweeps: decision.confirmedIdentitySweepIndices,
    excludedRoomSweeps: decision.excludedSweeps,
    permissions: {
      paidCompute: false,
      proprietaryPayloadParsing: false,
      publication: false,
      sourceMutation: false,
      training: false,
    },
  };
  const sourceManifestSha256 = hashes.sourceManifestFileSha256.slice("sha256:".length);
  const preparedSourceManifest = {
    venueSlug: "trades-hall",
    tier: "ops-grade-2cm",
    nodes: [{ roomSlug: null }],
  };
  const releaseDigest = "9".repeat(64);
  const releaseManifest = {
    venueSlug: "trades-hall",
    releaseDigest,
    sourceManifestSha256,
    files: [
      {
        path: "manifest.json",
        role: "manifest",
        sizeBytes: options.sourceManifestSizeBytes ?? 100,
      },
    ],
    fileCount: 1,
    totalBytes: options.sourceManifestSizeBytes ?? 100,
  };
  const qaReport = {
    releaseDigest,
    sourceManifestSha256,
    reportDigest: "8".repeat(64),
    outcome: "passed",
  };
  const foundryPreparation = {
    schemaVersion: "venviewer.reconstruction-preparation.v1",
    releaseDigest,
    releaseManifestSha256: hashes.releaseManifestFileSha256.slice("sha256:".length),
    releaseManifestSizeBytes: options.releaseManifestSizeBytes ?? 200,
    qaReportFileSha256: hashes.qaReportFileSha256.slice("sha256:".length),
    qaReportSizeBytes: options.qaReportSizeBytes ?? 150,
  };
  const gateIntake = {
    schemaVersion: "omnitwin.foundry.review-gate-intake.v0",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    state: "awaiting_external_evidence",
    authority: "none",
    control: { status: "missing", fitControls: [], blindChecks: [] },
    identityAttestation: {
      status: "missing_authenticated_external_attestation",
      reviewSubject: {
        identityReviewSha256: identityReview.reviewSha256,
        identityDecision: decision.code,
        confirmedSweepIndices: decision.confirmedIdentitySweepIndices,
        excludedSweepIndices: decision.excludedSweeps.map((entry) => entry.sweepIndex),
      },
    },
    rights: {
      matterport: { status: "requires_external_legal_decision" },
      identityReferences: { status: "requires_written_permission_or_replacement" },
    },
    releaseScopeDecision: { status: "required" },
  };
  const auditEvidence = {
    schemaVersion: "omnitwin.foundry.grand-hall-control-audit.v0",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    classification: "draft_private_not_registrable_not_review_approvable",
    permissions: {
      sourceMutation: false,
      evidenceRegistration: false,
      reviewMutation: false,
      modelTraining: false,
      paidCompute: false,
      signing: false,
      publication: false,
      promotion: false,
    },
    auditReportFileSha256: hashes.auditReportFileSha256,
    reviewGateIntakeFileSha256: hashes.gateIntakeFileSha256,
    phase1Evidence: {
      packageId: ingestManifest.projectId,
      outputIndexFileSha256: hashes.phase1OutputIndexFileSha256,
      identityGateOverviewFileSha256: hashes.identityOverviewFileSha256,
      ingestManifestSha256,
      identityReviewSha256: identityReview.reviewSha256,
      residualReportSha256: residualReport.reportSha256,
      transformProposalSha256: transformProposal.proposalSha256,
      identityDecision: {
        code: decision.code,
        confirmedSweepIndices: decision.confirmedIdentitySweepIndices,
        excludedSweepIndices: decision.excludedSweeps.map((entry) => entry.sweepIndex),
      },
      proposal: {
        state: transformProposal.state,
        sourceFrame: transformProposal.sourceFrame,
        targetFrame: transformProposal.targetFrame,
        scale: transformProposal.scale,
        authority: transformProposal.authority,
        candidateMetricsM: {
          count: candidateMetrics.count,
          mean: candidateMetrics.meanMeters,
          median: candidateMetrics.medianMeters,
          rmse: candidateMetrics.rmseMeters,
          p95: candidateMetrics.p95Meters,
          maximum: candidateMetrics.maxMeters,
        },
        frozenHoldoutMetricsM: {
          sweepIndices: transformProposal.holdoutSweepIndices,
          count: holdoutMetrics.count,
          mean: holdoutMetrics.meanMeters,
          median: holdoutMetrics.medianMeters,
          rmse: holdoutMetrics.rmseMeters,
          p95: holdoutMetrics.p95Meters,
          maximum: holdoutMetrics.maxMeters,
        },
        classification: "shared_lineage_internal_self_consistency_only",
        independentAccuracyClaim: false,
      },
    },
    independentControl: { status: "absent" },
    preparedReleaseAuditTarget: {
      foundryPreparationFileSha256: hashes.foundryPreparationFileSha256,
      releaseManifestFileSha256: hashes.releaseManifestFileSha256,
      qaReportFileSha256: hashes.qaReportFileSha256,
      releaseDigest,
      qaReportDigest: qaReport.reportDigest,
      sourceManifestSha256,
      sourceManifestFileSha256: hashes.sourceManifestFileSha256,
      fileCount: releaseManifest.fileCount,
      totalBytes: releaseManifest.totalBytes,
      nodeCount: preparedSourceManifest.nodes.length,
      evidenceRoleFileCount: 0,
      currentSourceManifestFileSha256: prefixed("f"),
    },
    releaseRelevanceFinding: { status: "failed" },
    confidenceTierFinding: {
      currentSourceManifestFileSha256: prefixed("f"),
      preparedEpochSourceManifestAvailableInDossier: true,
      preparedEpochSourceManifestFileSha256: hashes.sourceManifestFileSha256,
      preparedEpochTier: preparedSourceManifest.tier,
      independentControl: "absent",
      disposition:
        "unsupported_for_public_or_operational_reliance_pending_downgrade_or_reissue",
    },
    readiness: {
      offlineEvidenceReview: "blocked_missing_complete_identity_pixels_and_rights_clearance",
    },
  };
  return {
    ingestManifest,
    phase1Bundle,
    identityReview,
    e57Inspection,
    colmapInspection,
    residualReport,
    transformProposal,
    phase1OutputIndex,
    phase1OutputIndexFileSha256: hashes.phase1OutputIndexFileSha256,
    identityOverviewFileSha256: hashes.identityOverviewFileSha256,
    auditReportFileSha256: hashes.auditReportFileSha256,
    auditEvidence,
    gateIntake,
    gateIntakeFileSha256: hashes.gateIntakeFileSha256,
    foundryPreparation,
    foundryPreparationFileSha256: hashes.foundryPreparationFileSha256,
    releaseManifest,
    releaseManifestFileSha256: hashes.releaseManifestFileSha256,
    qaReport,
    qaReportFileSha256: hashes.qaReportFileSha256,
    preparedSourceManifest,
    preparedSourceManifestFileSha256: hashes.sourceManifestFileSha256,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("fixture value is not a record");
  }
  return value as Record<string, unknown>;
}

function installPassthroughSchemaMocks(): void {
  const passthrough = (input: unknown): never => input as never;
  vi.spyOn(FoundryIngestManifestV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1BundleV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1IdentityReviewV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1E57InspectionV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1ColmapInspectionV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1ResidualReportV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1TransformProposalV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(FoundryPhase1ProbeEnvelopeV0Schema, "parse").mockImplementation(passthrough);
  vi.spyOn(ReconstructionReleaseManifestSchema, "parse").mockImplementation(passthrough);
  vi.spyOn(ReconstructionQaReportSchema, "parse").mockImplementation(passthrough);
  vi.spyOn(TwinManifestSchema, "parse").mockImplementation(passthrough);
}

async function productionFixture(): Promise<GrandHallOfflineReviewOptions> {
  const parent = await mkdtemp(join(tmpdir(), "grand-hall-offline-production-"));
  cleanup.push(parent);
  const phase1Root = join(parent, "phase1");
  const preparedReleaseRoot = join(parent, "prepared");
  const preparedSourceManifestPath = join(parent, "prepared-source-manifest.json");
  const identityOverviewPath = join(parent, "identity-overview.png");
  const auditReportPath = join(parent, "audit.md");
  const auditEvidencePath = join(parent, "audit.json");
  const gateIntakePath = join(parent, "intake.json");

  const initial = bindingFixture();
  await writeJson(preparedSourceManifestPath, initial.preparedSourceManifest);
  const sourceManifestDigest = await sha256File(preparedSourceManifestPath);
  const sourceManifestFileSha256 = `sha256:${sourceManifestDigest.sha256}`;
  const semantic = bindingFixture({
    sourceManifestFileSha256,
    sourceManifestSizeBytes: sourceManifestDigest.sizeBytes,
  });
  const phase1Files: Readonly<Record<string, unknown>> = {
    "foundry-ingest-manifest-v0.json": semantic.ingestManifest,
    "foundry-phase1-bundle-v0.json": semantic.phase1Bundle,
    "identity-review.json": semantic.identityReview,
    "inspections/colmap-inspection.json": semantic.colmapInspection,
    "inspections/e57-inspection.json": semantic.e57Inspection,
    "inspections/raw/alignment-probe-output.json": {
      status: "ok",
      mode: "align",
    },
    "inspections/raw/colmap-probe-output.json": {
      status: "ok",
      mode: "inspect-colmap",
    },
    "inspections/raw/e57-probe-output.json": {
      status: "ok",
      mode: "inspect-e57",
    },
    "proposals/colmap-to-e57-transform.json": semantic.transformProposal,
    "reports/alignment-frozen-holdout-residuals.json": { report: "holdout" },
    "reports/alignment-full-fit-residuals.json": { report: "full-fit" },
    "reports/colmap-to-e57-residual-report.json": semantic.residualReport,
  };
  for (const [relativePath, value] of Object.entries(phase1Files)) {
    await writeJson(join(phase1Root, ...relativePath.split("/")), value);
  }
  const indexedFiles = await Promise.all(
    PHASE1_PATHS.filter((relativePath) => relativePath !== "phase1-output-index.json").map(
      async (relativePath) => {
        const digest = await sha256File(join(phase1Root, ...relativePath.split("/")));
        return { relativePath, sha256: `sha256:${digest.sha256}` };
      },
    ),
  );
  await writeJson(join(phase1Root, "phase1-output-index.json"), {
    ...record(semantic.phase1OutputIndex),
    files: indexedFiles,
  });
  const phase1IndexDigest = await sha256File(join(phase1Root, "phase1-output-index.json"));

  await writeJson(join(preparedReleaseRoot, "release-manifest.json"), semantic.releaseManifest);
  await writeJson(join(preparedReleaseRoot, "qa-report.json"), semantic.qaReport);
  const releaseManifestDigest = await sha256File(
    join(preparedReleaseRoot, "release-manifest.json"),
  );
  const qaReportDigest = await sha256File(join(preparedReleaseRoot, "qa-report.json"));
  const withPreparedHashes = bindingFixture({
    sourceManifestFileSha256,
    sourceManifestSizeBytes: sourceManifestDigest.sizeBytes,
    releaseManifestFileSha256: `sha256:${releaseManifestDigest.sha256}`,
    releaseManifestSizeBytes: releaseManifestDigest.sizeBytes,
    qaReportFileSha256: `sha256:${qaReportDigest.sha256}`,
    qaReportSizeBytes: qaReportDigest.sizeBytes,
  });
  await writeJson(
    join(preparedReleaseRoot, "foundry-preparation.json"),
    withPreparedHashes.foundryPreparation,
  );
  const preparationDigest = await sha256File(
    join(preparedReleaseRoot, "foundry-preparation.json"),
  );

  await writeFile(identityOverviewPath, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  await write(auditReportPath, "# audit\n");
  await writeJson(gateIntakePath, semantic.gateIntake);
  const [identityDigest, auditReportDigest, intakeDigest] = await Promise.all([
    sha256File(identityOverviewPath),
    sha256File(auditReportPath),
    sha256File(gateIntakePath),
  ]);
  const exact = bindingFixture({
    phase1OutputIndexFileSha256: `sha256:${phase1IndexDigest.sha256}`,
    identityOverviewFileSha256: `sha256:${identityDigest.sha256}`,
    auditReportFileSha256: `sha256:${auditReportDigest.sha256}`,
    gateIntakeFileSha256: `sha256:${intakeDigest.sha256}`,
    foundryPreparationFileSha256: `sha256:${preparationDigest.sha256}`,
    releaseManifestFileSha256: `sha256:${releaseManifestDigest.sha256}`,
    qaReportFileSha256: `sha256:${qaReportDigest.sha256}`,
    sourceManifestFileSha256,
    sourceManifestSizeBytes: sourceManifestDigest.sizeBytes,
    releaseManifestSizeBytes: releaseManifestDigest.sizeBytes,
    qaReportSizeBytes: qaReportDigest.sizeBytes,
  });
  await writeJson(auditEvidencePath, exact.auditEvidence);

  return {
    phase1PackageRoot: phase1Root,
    identityOverviewPath,
    preparedReleaseRoot,
    preparedSourceManifestPath,
    auditReportPath,
    auditEvidencePath,
    gateIntakePath,
    outputDirectory: join(parent, "grand-hall-evidence-fixture-v2"),
    projectId: "fixture-offline-review",
    createdBy: "fixture:evidence-preparer",
    createdAt: "2026-07-13T10:30:00.000Z",
  };
}

describe("Grand Hall evidence cross-bindings", () => {
  it("accepts one exact, fail-closed evidence epoch", () => {
    expect(() => {
      validateGrandHallEvidenceBindings(bindingFixture());
    }).not.toThrow();
  });

  it("rejects drift between every standalone phase-one artifact and the bundle", () => {
    for (const [standalone, bundleKey] of [
      ["identityReview", "identityReview"],
      ["e57Inspection", "e57Inspection"],
      ["colmapInspection", "colmapInspection"],
      ["residualReport", "residualReport"],
      ["transformProposal", "transformProposal"],
    ] as const) {
      const input = structuredClone(bindingFixture());
      record(input[standalone]).unexpectedDrift = true;
      expect(() => {
        validateGrandHallEvidenceBindings(input);
      }).toThrow(`phase-one bundle ${bundleKey}`);
    }
  });

  it("rejects index, audit, prepared-release, and intake epoch drift", () => {
    const mutations: readonly [
      (input: GrandHallEvidenceBindingInput) => void,
      string,
    ][] = [
      [
        (input) => {
          record(input.phase1OutputIndex).ingestManifestSha256 = prefixed("0");
        },
        "phase-one index ingest digest",
      ],
      [
        (input) => {
          record(record(input.auditEvidence).phase1Evidence).identityGateOverviewFileSha256 =
            prefixed("0");
        },
        "control audit identity overview hash",
      ],
      [
        (input) => {
          record(record(input.auditEvidence).preparedReleaseAuditTarget).sourceManifestFileSha256 =
            prefixed("0");
        },
        "control audit source manifest file hash",
      ],
      [
        (input) => {
          record(input.gateIntake).venueSlug = "other-venue";
        },
        "review gate intake venueSlug",
      ],
    ];
    for (const [mutate, message] of mutations) {
      const input = structuredClone(bindingFixture());
      mutate(input);
      expect(() => {
        validateGrandHallEvidenceBindings(input);
      }).toThrow(message);
    }
  });
});

describe("Grand Hall offline review builder", () => {
  it("runs the production validator over sources and every copied dossier phase", async () => {
    installPassthroughSchemaMocks();
    const options = await productionFixture();
    const result = await prepareProductionGrandHallOfflineReview(options);
    expect(result.artifactCount).toBe(21);
    const manifest = FoundryOfflineReviewPackageV0Schema.parse(
      JSON.parse(await readFile(join(result.outputDirectory, "package-manifest.json"), "utf8")),
    );
    expect(manifest.packageId).toBe("grand-hall-evidence-fixture-v2");
    expect(manifest.readiness.evidenceReview.status).toBe("blocked");
    expect(
      await readFile(join(result.outputDirectory, "target", "source-manifest.json")),
    ).toEqual(await readFile(options.preparedSourceManifestPath));
  });

  it("copies and verifies a self-contained, unsigned, non-approvable dossier", async () => {
    const root = await fixture();
    const result = await prepareGrandHallOfflineReview(root.options, root.dependencies);
    expect(result).toMatchObject({
      artifactCount: 21,
      releaseDigest: "a".repeat(64),
    });
    const manifest = FoundryOfflineReviewPackageV0Schema.parse(
      JSON.parse(await readFile(join(result.outputDirectory, "package-manifest.json"), "utf8")),
    );
    expect(manifest.packageSha256).toBe(result.packageSha256);
    expect(manifest.packageId).toBe(basename(root.options.outputDirectory));
    expect(manifest.authority).toBe("none");
    expect(manifest.readiness.evidenceReview).toEqual({
      status: "blocked",
      blockers: [
        "Complete identity re-review pixels and identity-gate evidence are withheld pending rights clearance",
      ],
    });
    expect(manifest.readiness.publicApproval.status).toBe("not_ready_offline");
    expect(manifest.readiness.signing.status).toBe("not_ready_unsigned");
    expect(manifest.artifacts.map((artifact) => artifact.relativePath)).toContain(
      "target/release-manifest.json",
    );
    expect(manifest.artifacts.map((artifact) => artifact.relativePath)).toContain(
      "target/source-manifest.json",
    );
    expect(root.validationPhases).toEqual([
      "before_manifest",
      "before_promotion",
      "after_promotion",
    ]);
  });

  it("refuses to resume or replace an existing final dossier", async () => {
    const root = await fixture();
    await mkdir(root.options.outputDirectory, { recursive: true });
    await expect(
      prepareGrandHallOfflineReview(root.options, root.dependencies),
    ).rejects.toThrow("offline review output already exists");
  });

  it("removes its promoted output when post-promotion validation fails", async () => {
    const root = await fixture();
    const original = root.dependencies.validateCopiedDossier;
    const dependencies: GrandHallOfflineReviewDependencies = {
      ...root.dependencies,
      validateCopiedDossier: async (directory, phase) => {
        const validation = await original(directory, phase);
        if (phase === "after_promotion") throw new Error("post-promotion validation failed");
        return validation;
      },
    };
    await expect(
      prepareGrandHallOfflineReview(root.options, dependencies),
    ).rejects.toThrow("post-promotion validation failed");
    expect(await exists(root.options.outputDirectory)).toBe(false);
  });
});

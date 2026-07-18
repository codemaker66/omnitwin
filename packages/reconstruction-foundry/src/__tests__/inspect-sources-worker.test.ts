import {
  copyFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryIntakeAdmissionReviewPayloadSchema,
  FoundryJobSpecV0Schema,
  computeFoundryJobSpecSha256,
  computeFoundryTrustedWorkerProfileSha256,
  finalizeFoundryIntakeAdmissionReview,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import { admitUniversalIntakeReceipt } from "../intake-admission.js";
import { inspectUniversalIntake } from "../intake-receipt.js";
import {
  FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND,
  FOUNDRY_WORKER_ARTIFACT_INDEX_PATH,
  FOUNDRY_INSPECT_SOURCES_REPORT_PATH,
  FoundryInspectSourcesInvocationV0Schema,
  __testOnlyRunFoundryInspectSourcesWorker as runFoundryInspectSourcesWorker,
  runFoundryInspectSourcesWorker as runProductionFoundryInspectSourcesWorker,
  verifyFoundryInspectSourcesOutput,
  type FoundryInspectSourcesInvocationV0,
} from "../inspect-sources-worker.js";
import { stageUniversalIntakeDraft as stageDraft } from "../intake-staging.js";

const cleanup: string[] = [];
const FIXED_TIME = new Date("2026-07-13T12:34:56.000Z");

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

interface WorkerFixture {
  readonly workspace: string;
  readonly stageRoot: string;
  readonly sourcePath: string;
  readonly invocation: FoundryInspectSourcesInvocationV0;
}

async function workerFixture(options?: {
  readonly termsReference?: string | null;
}): Promise<WorkerFixture> {
  const workspace = await mkdtemp(join(tmpdir(), "foundry-sealed-inspect-"));
  cleanup.push(workspace);
  const sourceRoot = join(workspace, "source-drop");
  const stageRoot = join(workspace, "verified-stage");
  await mkdir(sourceRoot);
  const sourcePath = join(sourceRoot, "capture.e57");
  await writeFile(sourcePath, Buffer.from("ASTM-E57\0sealed-worker-fixture", "ascii"));
  await utimes(sourcePath, FIXED_TIME, FIXED_TIME);
  const receipt = await inspectUniversalIntake(sourceRoot);
  const receiptFile = receipt.files[0];
  if (receiptFile === undefined) throw new Error("missing fixture receipt file");
  const reviewPayload = FoundryIntakeAdmissionReviewPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "sealed-inspect-fixture",
    reviewedAt: FIXED_TIME.toISOString(),
    reviewedBy: "fixture-operator",
    sourceRoot: {
      id: "fixture-drop",
      kind: "local_directory",
      displayName: "Sealed worker fixture",
      locationRedacted: "FOUNDRY_FIXTURE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    },
    coordinateFrames: [],
    transforms: [],
    decisions: [
      {
        action: "admit",
        path: receiptFile.path,
        classification: {
          method: "accepted_detector_candidate",
          rationale: "The ASTM E57 signature is sufficient for this byte-identity fixture.",
          evidenceReferences: ["fixture:astm-e57-signature"],
        },
        asset: {
          id: "capture-e57",
          sourceRootId: "fixture-drop",
          relativePath: receiptFile.path,
          inputType: "generic_e57",
          mediaType: "model/e57",
          sizeBytes: receiptFile.sizeBytes,
          sha256: `sha256:${receiptFile.sha256}`,
          immutable: true,
          captureState: "raw_capture",
          accessState: "direct",
          capturedAt: null,
          coordinateFrameId: null,
          calibrationAssetIds: [],
          parentAssetIds: [],
          rights: {
            basis: "customer_owned",
            commercialUse: "allowed",
            modelTrainingUse: "unknown",
            redistribution: "unknown",
            termsReviewedAt: FIXED_TIME.toISOString(),
            termsReference: options?.termsReference === undefined
              ? "https://example.invalid/fixture-rights/internal-inspection-v0"
              : options.termsReference,
            restrictions: ["Fixture permits internal inspection only."],
          },
          provenanceClass: "captured",
          evidenceKinds: [],
          inspection: {
            geometryValue: "unknown",
            appearanceValue: "none",
            calibrationValue: "unknown",
            scaleValue: "unknown",
            metadataKeys: [],
            decisiveNextTest: "Run the sealed exact-byte inspection fixture.",
          },
          notes: [],
        },
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  const review = finalizeFoundryIntakeAdmissionReview(reviewPayload);
  const admission = admitUniversalIntakeReceipt(receipt, review);
  const staged = await stageDraft({
    sourcePath: sourceRoot,
    outputDirectory: stageRoot,
    receipt,
    review,
  });
  const workerProfile = {
    schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
    profileId: "sealed-inspect-sources",
    profileVersion: "v0",
    operationClass: "read_only_inspection" as const,
    containerImage: `registry.example/omnitwin-sealed-inspect@sha256:${"1".repeat(64)}`,
    command: [...FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND],
    networkAccess: "none" as const,
    localExecutionAllowed: true,
    reviewedBy: "fixture-security-reviewer",
    reviewedAt: "2026-07-13T09:00:00.000Z",
    expiresAt: "2026-07-14T09:00:00.000Z",
  };
  const stage = {
    id: "inspect_sources",
    kind: "inspect" as const,
    dependsOn: [],
    containerImage: workerProfile.containerImage,
    command: [...FOUNDRY_INSPECT_SOURCES_SEALED_COMMAND],
    inputAssetIds: admission.manifest.assets.map((asset) => asset.id).sort(),
    outputNames: ["inspect_sources-output"],
    rightsPurposes: ["commercial_internal_use" as const],
    cpuCores: 1,
    ramGiB: 1,
    gpuCount: 0,
    minimumGpuVramGiB: 0,
    scratchGiB: 1,
    networkAccess: "none" as const,
    checkpoint: "none" as const,
    resumable: false,
  };
  const jobSpec = FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "sealed-inspect-job",
    projectId: admission.manifest.projectId,
    ingestManifestSha256: admission.manifestSha256,
    executionIntent: "execute" as const,
    providerKind: "local_cpu" as const,
    providerAdapterId: "local-sandbox",
    stages: [stage],
    objectStorageProfile: null,
    sourceMountMode: "read_only" as const,
    outputPrefix: "private-workers/sealed-inspect-job",
    estimatedCostUsd: 0,
    budgetCapUsd: 0,
    killSwitchEnabled: true,
    computeApprovalId: null,
    createdAt: FIXED_TIME.toISOString(),
  });
  const invocation = FoundryInspectSourcesInvocationV0Schema.parse({
    schemaVersion: "omnitwin.foundry.inspect-sources-invocation.v0",
    operation: "inspect_sources",
    claimedExecutionSubjectSha256: `sha256:${"2".repeat(64)}`,
    executionBindingAuthority: "caller_bound_not_authorized",
    jobId: "sealed-inspect-job",
    jobSpec,
    jobSpecSha256: computeFoundryJobSpecSha256(jobSpec),
    executionId: "10000000-0000-4000-8000-000000000001",
    attemptId: "10000000-0000-4000-8000-000000000002",
    attemptOrdinal: 1,
    fencingToken: "1",
    stage,
    workerProfile,
    workerProfileSha256: computeFoundryTrustedWorkerProfileSha256(workerProfile),
    workerProfileBindingAuthority: "caller_bound_not_allowlisted",
    evidence: {
      ingestManifestSha256: admission.manifestSha256,
      intakeAdmissionResultSha256: admission.resultSha256,
      intakeStagingIndexSha256: `sha256:${staged.index.stagingSha256}`,
    },
    authority: "none",
  });
  return { workspace, stageRoot, sourcePath, invocation };
}

describe("sealed inspect_sources worker", () => {
  it("contains no child-process, shell, provider, socket, or fetch execution path", async () => {
    const source = await readFile(
      new URL("../inspect-sources-worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["']node:(?:child_process|cluster|dgram|dns|http|https|net|tls|worker_threads)["']/u,
    );
    expect(source).not.toMatch(/\b(?:fetch|eval)\s*\(/u);
    expect(source).not.toContain("execution-dispatch");
    expect(source).not.toContain("s3-candidate-store");
    const packageIndex = await readFile(
      new URL("../index.ts", import.meta.url),
      "utf8",
    );
    expect(packageIndex).not.toContain(
      "__testOnlyRunFoundryInspectSourcesWorker",
    );
  });

  it.runIf(process.platform === "win32")(
    "fails closed before creating output when Windows privacy is not established",
    async () => {
      const fixture = await workerFixture();
      const output = join(fixture.workspace, "production-windows-output");

      await expect(runProductionFoundryInspectSourcesWorker({
        stageRoot: fixture.stageRoot,
        outputDirectory: output,
        invocation: fixture.invocation,
      })).rejects.toThrow("reviewed Windows ACL or OS sandbox backend");
      await expect(
        readFile(join(output, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("emits the same authority-none two-file output from identical stages at different roots", async () => {
    const fixture = await workerFixture();
    const stageCopy = join(fixture.workspace, "verified-stage-copy");
    await cp(fixture.stageRoot, stageCopy, { recursive: true, errorOnExist: true });
    const firstOutput = join(fixture.workspace, "worker-output-one");
    const secondOutput = join(fixture.workspace, "worker-output-two");
    const sourceBefore = await readFile(fixture.sourcePath);

    const first = await runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: firstOutput,
      invocation: fixture.invocation,
    });
    const second = await runFoundryInspectSourcesWorker({
      stageRoot: stageCopy,
      outputDirectory: secondOutput,
      invocation: fixture.invocation,
    });

    expect((await readdir(firstOutput)).sort()).toEqual([
      FOUNDRY_WORKER_ARTIFACT_INDEX_PATH,
      FOUNDRY_INSPECT_SOURCES_REPORT_PATH,
    ]);
    expect(first.report).toEqual(second.report);
    expect(first.artifactIndex).toEqual(second.artifactIndex);
    expect(first.report).toMatchObject({
      inspectionKind: "exact_byte_identity_and_bounded_detection",
      executionBindingAuthority: "caller_bound_not_authorized",
      authority: "none",
      policy: {
        payloadDecoding: "none",
        reconstruction: "none",
        networkClients: "none",
        signing: "none",
        publication: "none",
        controlPlaneAuthorization: "not_established_by_worker",
        workerProfileTrust: "not_established_by_worker",
      },
      assets: [{
        assetId: "capture-e57",
        byteVerification: "full_sha256_handle_bound",
        boundedDetection: {
          method: "bounded_header_no_payload_decode",
          declaredInputTypeObserved: true,
          detection: {
            status: "detected",
          },
        },
      }],
    });
    expect(first.artifactIndex).toMatchObject({
      commitMarker: "index_content_fsynced_last",
      authority: "none",
      capabilities: {
        immutableRegistration: "not_authorized",
        publication: "not_authorized",
        promotion: "not_authorized",
      },
    });
    expect(await readFile(join(firstOutput, FOUNDRY_INSPECT_SOURCES_REPORT_PATH)))
      .toEqual(await readFile(join(secondOutput, FOUNDRY_INSPECT_SOURCES_REPORT_PATH)));
    expect(await readFile(join(firstOutput, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)))
      .toEqual(await readFile(join(secondOutput, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)));
    expect(await readFile(fixture.sourcePath)).toEqual(sourceBefore);
    await expect(verifyFoundryInspectSourcesOutput(firstOutput))
      .resolves.toEqual(first);
  });

  it("rejects an arbitrary stage command before creating output", async () => {
    const fixture = await workerFixture();
    const output = join(fixture.workspace, "rejected-command-output");
    const changed = {
      ...fixture.invocation,
      stage: { ...fixture.invocation.stage, command: ["arbitrary-program"] },
    };

    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: output,
      invocation: changed,
    })).rejects.toThrow("sealed local, CPU-only, no-network");
    await expect(readFile(join(output, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects incomplete purpose-aware rights even when commercial use says allowed", async () => {
    const fixture = await workerFixture({ termsReference: null });
    const output = join(fixture.workspace, "incomplete-rights-output");

    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: output,
      invocation: fixture.invocation,
    })).rejects.toThrow("complete purpose-aware rights checks");
    await expect(readFile(join(output, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)))
      .resolves.toHaveLength(0);
    await expect(verifyFoundryInspectSourcesOutput(output)).rejects.toThrow();
  });

  it("never replaces a pre-existing output directory", async () => {
    const fixture = await workerFixture();
    const output = join(fixture.workspace, "pre-existing-output");
    await mkdir(output);
    await writeFile(join(output, "owner-marker.txt"), "do-not-replace");

    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: output,
      invocation: fixture.invocation,
    })).rejects.toThrow("already exists");
    await expect(readFile(join(output, "owner-marker.txt"), "utf8"))
      .resolves.toBe("do-not-replace");
  });

  it("rejects output overlap and cancellation without leaving a commit marker", async () => {
    const fixture = await workerFixture();
    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: join(fixture.stageRoot, "worker-output"),
      invocation: fixture.invocation,
    })).rejects.toThrow("must be disjoint");

    const cancelledOutput = join(fixture.workspace, "cancelled-output");
    const controller = new AbortController();
    controller.abort();
    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: cancelledOutput,
      invocation: fixture.invocation,
      signal: controller.signal,
    })).rejects.toThrow("cancelled");
    await expect(readFile(join(cancelledOutput, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-canonical artifact-index bytes", async () => {
    const fixture = await workerFixture();
    const output = join(fixture.workspace, "non-canonical-output");
    await runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: output,
      invocation: fixture.invocation,
    });
    const indexPath = join(output, FOUNDRY_WORKER_ARTIFACT_INDEX_PATH);
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

    await expect(verifyFoundryInspectSourcesOutput(output)).rejects.toThrow(
      "artifact index bytes are not canonical JSON",
    );
  });

  it("rejects a multiply linked staged source even when its bytes still match", async () => {
    const fixture = await workerFixture();
    const stagedSource = join(fixture.stageRoot, "source", "capture.e57");
    const outside = join(fixture.workspace, "outside-hardlink-source.e57");
    await copyFile(stagedSource, outside);
    await rm(stagedSource);
    await link(outside, stagedSource);

    await expect(runFoundryInspectSourcesWorker({
      stageRoot: fixture.stageRoot,
      outputDirectory: join(fixture.workspace, "hardlink-output"),
      invocation: fixture.invocation,
    })).rejects.toThrow("multiply linked file");
  });

  it.runIf(process.platform !== "win32")(
    "rejects a staged symbolic-link replacement",
    async () => {
      const fixture = await workerFixture();
      const stagedSource = join(fixture.stageRoot, "source", "capture.e57");
      const outside = join(fixture.workspace, "outside-symlink-source.e57");
      await copyFile(stagedSource, outside);
      await rm(stagedSource);
      await symlink(outside, stagedSource, "file");

      await expect(runFoundryInspectSourcesWorker({
        stageRoot: fixture.stageRoot,
        outputDirectory: join(fixture.workspace, "symlink-output"),
        invocation: fixture.invocation,
      })).rejects.toThrow("link or reparse-point alias");
    },
  );
});

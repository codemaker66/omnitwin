import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryTrustedWorkerProfileV0Schema,
  computeFoundryTrustedWorkerProfileSha256,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0,
  FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
  FoundryDerivativeNormalizationArtifactIndexV0Schema,
  FoundryDerivativeNormalizationExpectedExecutorV0Schema,
  FoundryDerivativeNormalizationOutputBundleInvocationV0Schema,
  FoundryDerivativeNormalizationOutputReportV0Schema,
  computeFoundryDerivativeNormalizationArtifactIndexSha256,
  computeFoundryDerivativeNormalizationExpectedExecutorSha256,
  computeFoundryDerivativeNormalizationOutputBundleInvocationSha256,
} from "../derivative-normalization-output-contract.js";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "../canonical-json.js";
import {
  __testOnlyWriteFoundryDerivativeNormalizationOutputBundle,
  runFoundryDerivativeNormalizationOutputBundle,
  verifyFoundryDerivativeNormalizationOutputBundle,
  type RunFoundryDerivativeNormalizationOutputBundleOptions,
} from "../derivative-normalization-output-bundle.js";
import { sha256Bytes } from "../hash.js";
import { glbFixture } from "./fixture.js";
import {
  createDerivativeNormalizationBundleInvocation,
  writeDerivativeNormalizationBundleFixture,
} from "./derivative-normalization-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

function publicSchemaDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\n", "ascii")
    .update(stableCanonicalJson(toCanonicalJson(value)), "utf8")
    .digest("hex")}`;
}

function parseJsonBytes(bytes: Buffer): unknown {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  return value;
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-derivative-output-"));
  roots.push(root);
  return root;
}

const bundleInvocation = createDerivativeNormalizationBundleInvocation;
const writeBundle = writeDerivativeNormalizationBundleFixture;

describe.sequential("authority-none derivative normalization output bundle", () => {
  it("binds the full inert candidate, reservation, base subject, executor, and absent activation under a domain digest", () => {
    const source = glbFixture();
    const invocation = bundleInvocation(source);
    const digest =
      computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
        invocation,
      );
    expect(digest).toBe(
      "sha256:07e8268d5bd718033a6d2a7055516d4c1c6161f450289ce9ac077766e3929e71",
    );
    expect(
      computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
        structuredClone(invocation),
      ),
    ).toBe(digest);

    const activated = {
      ...structuredClone(invocation),
      activation: {
        state: "activated",
        activationId: "018f3e5a-6e3b-7d10-a4f1-ccddee001122",
        executionActivationRecorded: true,
      },
    };
    expect(
      FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.safeParse(
        activated,
      ).success,
    ).toBe(false);

    const profileMismatch = structuredClone(invocation);
    profileMismatch.expectedExecutor.workerProfile.profileVersion = "v1";
    expect(
      FoundryDerivativeNormalizationExpectedExecutorV0Schema.safeParse(
        profileMismatch.expectedExecutor,
      ).success,
    ).toBe(false);
    expect(
      FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.safeParse(
        profileMismatch,
      ).success,
    ).toBe(false);

    expect(
      FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.safeParse({
        ...invocation,
        unexpectedCapability: true,
      }).success,
    ).toBe(false);
  });

  it("keeps production disabled before observing any option, source, output, or path", () => {
    const observed: string[] = [];
    const options = new Proxy(
      {},
      {
        get: (_target, property) => {
          observed.push(String(property));
          throw new Error("options were observed");
        },
      },
    ) as RunFoundryDerivativeNormalizationOutputBundleOptions;
    expect(() => runFoundryDerivativeNormalizationOutputBundle(options)).toThrow(
      process.platform === "win32"
        ? /Windows production output custody is disabled/u
        : /no production activation or execution binding/u,
    );
    expect(observed).toEqual([]);
  });

  it("writes the exact create-only bundle, fsyncs the index last, and independently re-verifies proof bytes", async () => {
    const root = await privateRoot();
    const fixture = await writeBundle(root);
    expect(
      (await Promise.all([
        readFile(join(fixture.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH)),
        readFile(join(fixture.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH)),
        readFile(join(fixture.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH)),
      ])).map((bytes) => bytes.length > 0),
    ).toEqual([true, true, true]);
    expect(fixture.result.report.activation).toEqual({
      state: "absent_not_recorded",
      activationId: null,
      activationSha256: null,
      activationReceiptSha256: null,
      executionActivationRecorded: false,
      executionAuthority: "none",
    });
    expect(fixture.result.report.capabilities).toEqual({
      release: false,
      publication: false,
      redistribution: false,
      signing: false,
      runtimePromotion: false,
      immutableRegistration: false,
      measuredGeometryAuthority: false,
    });
    expect(fixture.result.report.outputCommitAuthority).toEqual({
      candidateCurrentAuthorityRevalidated: false,
      policyGenerationRevalidated: false,
      approvalExpiryRevalidated: false,
      policyRevocationRevalidated: false,
      attestationRevocationRevalidated: false,
      executionActivationValidated: false,
      executionAdmissionValidated: false,
      fenceOwnershipValidated: false,
      executorAuthenticated: false,
      canonicalOutputCommitAuthorized: false,
    });
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        sourceBytes: fixture.source,
        expectedBundleInvocationSha256:
          computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
            fixture.invocation,
          ),
        expectedCandidateSha256: fixture.invocation.candidateSha256,
        expectedCandidateReservationReceiptSha256:
          fixture.invocation.candidateReservationReceiptSha256,
        expectedBaseExecutionSubjectSha256:
          fixture.invocation.baseExecutionSubjectSha256,
      }),
    ).resolves.toEqual(fixture.result);
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        sourceBytes: fixture.source,
        expectedCandidateSha256: sha(999),
      }),
    ).rejects.toThrow(/does not match the expected candidate/u);
    await expect(
      __testOnlyWriteFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        bundleInvocation: fixture.invocation,
        normalizeInvocation: fixture.invocation,
        normalizeReport: fixture.report,
        sourceBytes: fixture.source,
        normalizedGlb: fixture.normalizedGlb,
      }),
    ).rejects.toThrow(/already exists/u);
  });

  it("rejects normalized-byte, source-byte, report, index, and extra-file tampering", async () => {
    const root = await privateRoot();
    const glbTamper = await writeBundle(join(root, "glb"));
    const glb = await readFile(
      join(glbTamper.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH),
    );
    glb[glb.length - 1] = (glb[glb.length - 1] ?? 0) ^ 1;
    await writeFile(
      join(glbTamper.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH),
      glb,
    );
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: glbTamper.outputDirectory,
        sourceBytes: glbTamper.source,
      }),
    ).rejects.toThrow(/Normalized GLB bytes do not match/u);

    const sourceTamper = await writeBundle(join(root, "source"));
    const wrongSource = Buffer.from(sourceTamper.source);
    wrongSource[wrongSource.length - 1] =
      (wrongSource[wrongSource.length - 1] ?? 0) ^ 1;
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: sourceTamper.outputDirectory,
        sourceBytes: wrongSource,
      }),
    ).rejects.toThrow(/Normalization proof bytes do not match|independent source bytes/u);

    const reportTamper = await writeBundle(join(root, "report"));
    await writeFile(
      join(reportTamper.outputDirectory, FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH),
      "{}\n",
    );
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: reportTamper.outputDirectory,
        sourceBytes: reportTamper.source,
      }),
    ).rejects.toThrow(/Artifact sizes do not match|report bytes do not match/u);

    const indexTamper = await writeBundle(join(root, "index"));
    const indexPath = join(
      indexTamper.outputDirectory,
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
    );
    await writeFile(indexPath, Buffer.concat([await readFile(indexPath), Buffer.from(" ")]));
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: indexTamper.outputDirectory,
        sourceBytes: indexTamper.source,
      }),
    ).rejects.toThrow(/not canonical JSON/u);

    const extra = await writeBundle(join(root, "extra"));
    await writeFile(join(extra.outputDirectory, "release.json"), "{}\n");
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: extra.outputDirectory,
        sourceBytes: extra.source,
      }),
    ).rejects.toThrow(/exactly normalized\.glb/u);
  });

  it("rejects partial or early commit markers and multiply linked artifacts", async () => {
    const root = await privateRoot();
    const partial = join(root, "partial");
    await mkdir(partial, { mode: 0o700 });
    await Promise.all([
      writeFile(join(partial, FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH), glbFixture()),
      writeFile(join(partial, FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH), "{}\n"),
      writeFile(join(partial, FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH), ""),
    ]);
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: partial,
        sourceBytes: glbFixture(),
      }),
    ).rejects.toThrow(/empty or exceeds/u);

    const fixture = await writeBundle(join(root, "links"));
    const glbPath = join(
      fixture.outputDirectory,
      FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
    );
    const moved = join(fixture.outputDirectory, "moved.glb");
    await rename(glbPath, moved);
    await link(moved, glbPath);
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        sourceBytes: fixture.source,
      }),
    ).rejects.toThrow(/multiply linked/u);
  });

  it("rejects a fully re-digested report/index that substitutes a different valid public-release executor", async () => {
    const root = await privateRoot();
    const fixture = await writeBundle(join(root, "executor-substitution"));
    const reportPath = join(
      fixture.outputDirectory,
      FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
    );
    const indexPath = join(
      fixture.outputDirectory,
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
    );
    const storedReport =
      FoundryDerivativeNormalizationOutputReportV0Schema.parse(
        parseJsonBytes(await readFile(reportPath)),
      );
    const storedIndex =
      FoundryDerivativeNormalizationArtifactIndexV0Schema.parse(
        parseJsonBytes(await readFile(indexPath)),
      );
    const hostileWorkerProfile = FoundryTrustedWorkerProfileV0Schema.parse({
      schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
      profileId: "hostile-public-release",
      profileVersion: "v0",
      operationClass: "public_release",
      containerImage: `registry.example/hostile-release@${sha(91)}`,
      command: ["hostile-public-release"],
      networkAccess: "restricted",
      localExecutionAllowed: false,
      reviewedBy: "hostile-reviewer@example.test",
      reviewedAt: "2026-07-14T07:00:00.000Z",
      expiresAt: "2026-07-15T07:00:00.000Z",
    });
    const hostileExpectedExecutor = {
      ...storedReport.expectedExecutor,
      workerProfile: hostileWorkerProfile,
      workerProfileSha256:
        computeFoundryTrustedWorkerProfileSha256(hostileWorkerProfile),
    };
    const hostileExpectedExecutorSha256 =
      computeFoundryDerivativeNormalizationExpectedExecutorSha256(
        hostileExpectedExecutor,
      );
    expect(hostileWorkerProfile.operationClass).toBe("public_release");
    expect(hostileWorkerProfile.networkAccess).toBe("restricted");

    const { reportSha256: _storedReportSha256, ...storedReportPayload } =
      storedReport;
    const hostileReportPayload = {
      ...storedReportPayload,
      expectedExecutor: hostileExpectedExecutor,
    };
    const hostileReport = {
      ...hostileReportPayload,
      reportSha256: publicSchemaDigest(
        FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0,
        hostileReportPayload,
      ),
    };
    const hostileReportBytes = canonicalJsonBytes(hostileReport);

    const { artifactIndexSha256: _storedIndexSha256, ...storedIndexPayload } =
      storedIndex;
    const hostileIndexPayload = {
      ...storedIndexPayload,
      reportSha256: hostileReport.reportSha256,
      expectedExecutorSha256: hostileExpectedExecutorSha256,
      artifacts: [
        storedIndex.artifacts[0],
        {
          ...storedIndex.artifacts[1],
          sizeBytes: hostileReportBytes.length,
          sha256: `sha256:${sha256Bytes(hostileReportBytes)}`,
          subjectSha256: hostileReport.reportSha256,
        },
      ] as const,
    };
    const hostileIndex = {
      ...hostileIndexPayload,
      artifactIndexSha256:
        computeFoundryDerivativeNormalizationArtifactIndexSha256(
          hostileIndexPayload,
        ),
    };
    expect(
      FoundryDerivativeNormalizationArtifactIndexV0Schema.parse(hostileIndex),
    ).toEqual(hostileIndex);
    await writeFile(reportPath, hostileReportBytes);
    await writeFile(indexPath, canonicalJsonBytes(hostileIndex));

    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        sourceBytes: fixture.source,
      }),
    ).rejects.toThrow(/report custody posture binding mismatch/u);
  });

  it("rejects a fully re-digested index whose job and stage differ from the report and invocation", async () => {
    const root = await privateRoot();
    const fixture = await writeBundle(join(root, "runtime-context-substitution"));
    const indexPath = join(
      fixture.outputDirectory,
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
    );
    const storedIndex =
      FoundryDerivativeNormalizationArtifactIndexV0Schema.parse(
        parseJsonBytes(await readFile(indexPath)),
      );
    const { artifactIndexSha256: _storedIndexSha256, ...storedIndexPayload } =
      storedIndex;
    const hostileIndexPayload = {
      ...storedIndexPayload,
      claimedRuntimeContext: {
        ...storedIndex.claimedRuntimeContext,
        jobId: "hostile-job",
        stageId: "hostile-stage",
      },
    };
    const hostileIndex = {
      ...hostileIndexPayload,
      artifactIndexSha256:
        computeFoundryDerivativeNormalizationArtifactIndexSha256(
          hostileIndexPayload,
        ),
    };
    expect(
      FoundryDerivativeNormalizationArtifactIndexV0Schema.parse(hostileIndex),
    ).toEqual(hostileIndex);
    await writeFile(indexPath, canonicalJsonBytes(hostileIndex));

    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: fixture.outputDirectory,
        sourceBytes: fixture.source,
      }),
    ).rejects.toThrow(/report and commit index do not bind/u);
  });

  it("rejects a valid byte bundle moved away from its bound quarantine locator", async () => {
    const root = await privateRoot();
    const fixture = await writeBundle(join(root, "locator"));
    const moved = join(root, "moved-bundle");
    await rename(fixture.outputDirectory, moved);
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: moved,
        sourceBytes: fixture.source,
      }),
    ).rejects.toThrow(/locator does not bind/u);
  });

  it("keeps the test-only writer out of the package root while exporting the verifier", async () => {
    const root = await import("../index.js");
    expect("__testOnlyWriteFoundryDerivativeNormalizationOutputBundle" in root).toBe(false);
    expect(root.verifyFoundryDerivativeNormalizationOutputBundle).toBeTypeOf(
      "function",
    );
  });
});

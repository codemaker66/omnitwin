import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_DIFIX_ADAPTER_ID,
  GRAND_HALL_DIFIX_EXACT_CONFIGURATION,
  GRAND_HALL_DIFIX_OFFLINE_PATH,
  GrandHallDifixExecutionLockSchema,
  assertGrandHallDifixAuthorizationCurrent,
  assertGrandHallDifixExperimentBindingProjectionMatches,
  compileGrandHallDifixExecutionAuthorization,
  createGrandHallDifixAuthorizationClaim,
  grandHallDifixExecutionLockDigest,
  grandHallDifixPortableDomainDigest,
  type GrandHallDifixBoundFile,
  type GrandHallDifixExecutionAuthorization,
  type GrandHallDifixExperimentBindings,
  type GrandHallDifixExecutionLock,
} from "../grand-hall-difix-one-shot-contract.js";
import {
  GrandHallDifixClaimPublicationError,
  GrandHallDifixOneShotError,
  checkGrandHallDifixExecutionLock,
  claimGrandHallDifixAuthorizationCreateOnly,
  completeGrandHallDifixConsumedPrelaunch,
  grandHallDifixOfflineEnvArguments,
} from "../grand-hall-difix-one-shot.js";

const createdDirectories: string[] = [];
const NONCE = "a".repeat(64);
const ISSUED_AT = "2026-08-30T04:00:00.000Z";
const EXPIRES_AT = "2026-08-30T04:20:00.000Z";

function sha(seed: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(seed, "utf8").digest("hex")}`;
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function canonicalFileSha(value: unknown): `sha256:${string}` {
  return sha(`${stableCanonicalJson(toCanonicalJson(value))}\n`);
}

function wsl(name: string): string {
  return `/mnt/c/venviewer-test/${name}`;
}

function file(hostPath: string, name: string): GrandHallDifixBoundFile {
  return { hostPath, wslPath: wsl(name), sizeBytes: 1, sha256: sha(name) };
}

function executionLock(root: string): GrandHallDifixExecutionLock {
  const control = resolve(root, "control");
  const attempts = resolve(root, "attempts");
  const attempt = resolve(attempts, "attempt-001");
  const configuration = {
    ...GRAND_HALL_DIFIX_EXACT_CONFIGURATION,
    timesteps: [199] as [199],
    disabledOptimizations: [
      "autocast",
      "compile",
      "cpu_offload",
      "tf32",
      "vae_tiling",
      "xformers",
    ] as ["autocast", "compile", "cpu_offload", "tf32", "vae_tiling", "xformers"],
  };
  const payload = {
    schemaVersion: "venviewer.grand-hall.difix-no-reference-execution-lock.v1" as const,
    lockId: "grand-hall-difix-test-lock",
    compiledAt: "2026-08-30T03:59:00.000Z",
    gitCommit: "1".repeat(40),
    experimentSha256: sha("experiment-inner-self-digest"),
    plannedExecutionLockSha256: sha("planned-lock"),
    providerAdapterId: GRAND_HALL_DIFIX_ADAPTER_ID,
    configuration,
    configurationSha256: grandHallDifixPortableDomainDigest(
      "VENVIEWER_GRAND_HALL_DIFIX_CONFIGURATION_V1",
      configuration,
    ),
    experimentBindings: {
      provider: {
        repositorySourceArchiveSha256: sha("provider-source-archive"),
        modelRepositoryManifestSha256: sha("model-repository-manifest"),
        modelWeights: [{ relativePath: "model.safetensors", sizeBytes: 1, sha256: sha("model-weight") }],
      },
      plannedExecution: {
        providerAdapterId: GRAND_HALL_DIFIX_ADAPTER_ID,
        providerAdapterImplementationSha256: sha("adapter"),
        parameterConfigurationArtifactSha256: canonicalFileSha(configuration),
        runtimeEnvironmentArtifactSha256: sha("runtime-environment-artifact"),
      },
      inputPack: {
        bundleMaterialSha256: sha("input-pack-material"),
        sourceRenderSha256: sha("source-image"),
        browserCaptureRecordSha256: sha("browser-capture-record"),
        cameraArtifactSha256: sha("camera-artifact"),
        rendererArtifactSha256: sha("renderer-artifact"),
        reconstructionArtifactSha256: sha("reconstruction-artifact"),
        reconstructionMemberClosureSha256: sha("reconstruction-member-closure"),
        renderGenerationReceiptSha256: sha("render-generation-receipt"),
        protectedMaskSha256: sha("protected-mask"),
        generatedRegionMaskSha256: sha("generated-region-mask"),
      },
      fixedCamera: {
        cameraSha256: sha("fixed-camera"),
        protectedMaskAnalysisReceiptSha256: sha("protected-mask-analysis"),
        generatedMaskAnalysisReceiptSha256: sha("generated-mask-analysis"),
      },
      localExperimentMaterialSetSha256: digest(
        "VENVIEWER_GRAND_HALL_DIFIX_LOCAL_EXPERIMENT_MATERIAL_SET_V1",
        [],
      ),
    },
    runtimeSealSha256: sha("runtime-inner-self-digest"),
    modelSealSha256: sha("model-inner-self-digest"),
    inputPackManifestSha256: sha("input-pack/manifest.authority-none.json"),
    inputPackPublicationReceiptSha256: sha("input-pack/publication-receipt.json"),
    inputPackBundleMaterialSha256: sha("input-pack-material"),
    sourceImageSha256: sha("source-image"),
    adapterSha256: sha("adapter"),
    runtimeSealToolSha256: sha("seal-tool"),
    paths: {
      executionLockHost: resolve(control, "execution-lock.json"),
      executionLockWsl: wsl("control/execution-lock.json"),
      experiment: file(resolve(root, "experiment.json"), "experiment.json"),
      experimentMaterials: [],
      inputPackDirectoryHost: resolve(root, "input-pack"),
      inputPackDirectoryWsl: wsl("input-pack"),
      inputPackManifest: file(resolve(root, "input-pack/manifest.authority-none.json"), "input-pack/manifest.authority-none.json"),
      inputPackPublicationReceipt: file(resolve(root, "input-pack/publication-receipt.json"), "input-pack/publication-receipt.json"),
      sourceImage: { ...file(resolve(root, "input-pack/source-render.png"), "input-pack/source-render.png"), sha256: sha("source-image") },
      browserCaptureRecord: { ...file(resolve(root, "input-pack/browser-capture-record.json"), "input-pack/browser-capture-record.json"), sha256: sha("browser-capture-record") },
      cameraArtifact: { ...file(resolve(root, "input-pack/camera.json"), "input-pack/camera.json"), sha256: sha("camera-artifact") },
      rendererArtifact: { ...file(resolve(root, "input-pack/renderer.json"), "input-pack/renderer.json"), sha256: sha("renderer-artifact") },
      reconstructionArtifact: { ...file(resolve(root, "input-pack/reconstruction.json"), "input-pack/reconstruction.json"), sha256: sha("reconstruction-artifact") },
      renderGenerationReceipt: { ...file(resolve(root, "input-pack/render-generation.json"), "input-pack/render-generation.json"), sha256: sha("render-generation-receipt") },
      protectedMask: { ...file(resolve(root, "input-pack/protected-mask.png"), "input-pack/protected-mask.png"), sha256: sha("protected-mask") },
      generatedRegionMask: { ...file(resolve(root, "input-pack/generated-region-mask.png"), "input-pack/generated-region-mask.png"), sha256: sha("generated-region-mask") },
      runtimeSeal: file(resolve(root, "runtime-seal.json"), "runtime-seal.json"),
      modelSeal: file(resolve(root, "model-seal.json"), "model-seal.json"),
      adapter: { ...file(resolve(root, "adapter.py"), "adapter.py"), sha256: sha("adapter") },
      runtimeSealTool: { ...file(resolve(root, "seal.py"), "seal.py"), sha256: sha("seal-tool") },
      trustedVerifierPythonWsl: "/usr/bin/python3",
      venvPythonWsl: wsl("venv/bin/python"),
      providerSourceRootWsl: wsl("provider"),
      modelSnapshotRootWsl: wsl("model"),
      controlDirectoryHost: control,
      controlDirectoryWsl: wsl("control"),
      claimHost: resolve(control, `authorization-${NONCE}.claim.json`),
      claimWsl: wsl(`control/authorization-${NONCE}.claim.json`),
      attemptDirectoryHost: attempt,
      attemptDirectoryWsl: wsl("attempts/attempt-001"),
      hfModulesCacheHost: resolve(attempt, "hf-modules-cache"),
      hfModulesCacheWsl: wsl("attempts/attempt-001/hf-modules-cache"),
      torchHomeHost: resolve(attempt, "torch-home"),
      torchHomeWsl: wsl("attempts/attempt-001/torch-home"),
      modelExecutionSnapshotHost: resolve(attempt, "model-execution-snapshot"),
      modelExecutionSnapshotWsl: wsl("attempts/attempt-001/model-execution-snapshot"),
      sourceImageWsl: wsl("input-pack/source-render.png"),
      outputImageHost: resolve(attempt, "candidate.png"),
      outputImageWsl: wsl("attempts/attempt-001/candidate.png"),
      adapterReceiptHost: resolve(attempt, "adapter-receipt.json"),
      adapterReceiptWsl: wsl("attempts/attempt-001/adapter-receipt.json"),
      stdoutHost: resolve(attempt, "stdout.log"),
      stdoutWsl: wsl("attempts/attempt-001/stdout.log"),
      stderrHost: resolve(attempt, "stderr.log"),
      stderrWsl: wsl("attempts/attempt-001/stderr.log"),
      startedReceiptHost: resolve(control, "started.json"),
      startedReceiptWsl: wsl("control/started.json"),
      terminalReceiptHost: resolve(control, "terminal.json"),
      terminalReceiptWsl: wsl("control/terminal.json"),
    },
    launch: {
      wslDistribution: "Ubuntu",
      namespaceArgvPrefix: ["unshare", "--user", "--map-root-user", "--net"] as const,
      offlineEnvironment: {
        PATH: GRAND_HALL_DIFIX_OFFLINE_PATH,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        DIFFUSERS_OFFLINE: "1",
        HF_DATASETS_OFFLINE: "1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        PIP_NO_INDEX: "1",
        WANDB_MODE: "disabled",
        TOKENIZERS_PARALLELISM: "false",
        CUDA_MODULE_LOADING: "EAGER",
        CUBLAS_WORKSPACE_CONFIG: ":4096:8",
      },
    },
    policies: {
      network: "os_namespace_unreachable" as const,
      externalCost: "zero" as const,
      sourceAccess: "read_only" as const,
      output: "create_only_no_overwrite" as const,
      retries: 0 as const,
      retryOnOutOfMemory: false as const,
      secretsAllowed: false as const,
      capturedAuthority: "none" as const,
      structuralAuthority: "none" as const,
      runtimeAuthority: "none" as const,
      resultClass: "generated_cinematic_diagnostic" as const,
    },
  };
  return GrandHallDifixExecutionLockSchema.parse({
    ...payload,
    executionLockSha256: grandHallDifixExecutionLockDigest(payload),
  });
}

function authorization(lock: GrandHallDifixExecutionLock): GrandHallDifixExecutionAuthorization {
  return compileGrandHallDifixExecutionAuthorization({
    authorizationId: "grand-hall-difix-test-authorization",
    executionLock: lock,
    objectiveArtifact: file(resolve(dirnameFor(lock.paths.controlDirectoryHost), "objective.txt"), "objective.txt"),
    objectiveArtifactStatementSha256: sha("objective.txt"),
    actorId: "goal-owner",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    nonce: NONCE,
  });
}

function dirnameFor(control: string): string {
  return resolve(control, "..");
}

async function harness(): Promise<{ readonly root: string; readonly lock: GrandHallDifixExecutionLock }> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-difix-one-shot-"));
  createdDirectories.push(root);
  await mkdir(resolve(root, "control"), { recursive: true });
  await mkdir(resolve(root, "attempts"), { recursive: true });
  return { root, lock: executionLock(root) };
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

describe("Grand Hall Difix one-shot authorization overlay", () => {
  it("leaves the immutable base lock untouched and binds one zero-cost, authority-none attempt", async () => {
    const { lock } = await harness();
    expect(lock.experimentSha256).not.toBe(lock.paths.experiment.sha256);
    expect(lock.runtimeSealSha256).not.toBe(lock.paths.runtimeSeal.sha256);
    expect(lock.modelSealSha256).not.toBe(lock.paths.modelSeal.sha256);
    const value = authorization(lock);
    expect(value).toMatchObject({
      executionLockSha256: lock.executionLockSha256,
      maximumAttempts: 1,
      externalCostLimitUsd: 0,
      policies: {
        baseExperimentRemainsNotAuthorizedAndImmutable: true,
        overlayDoesNotMutateExperiment: true,
        claimConsumesAuthorizationEvenOnFailure: true,
        retries: 0,
        retryOnOutOfMemory: false,
        capturedAuthority: "none",
        structuralAuthority: "none",
        runtimeAuthority: "none",
      },
    });
  });

  it("rejects expired and not-yet-active authorizations", async () => {
    const { lock } = await harness();
    const value = authorization(lock);
    expect(() => { assertGrandHallDifixAuthorizationCurrent(value, new Date("2026-08-30T03:59:59.999Z")); })
      .toThrow("not active yet");
    expect(() => { assertGrandHallDifixAuthorizationCurrent(value, new Date(EXPIRES_AT)); })
      .toThrow("expired");
    expect(() => { assertGrandHallDifixAuthorizationCurrent(value, new Date("2026-08-30T04:10:00.000Z")); })
      .not.toThrow();
  });

  it("rejects authorization windows longer than 30 minutes", async () => {
    const { lock } = await harness();
    expect(() => compileGrandHallDifixExecutionAuthorization({
      authorizationId: "authorization-too-long",
      executionLock: lock,
      objectiveArtifact: file(resolve(dirnameFor(lock.paths.controlDirectoryHost), "objective.txt"), "objective.txt"),
      objectiveArtifactStatementSha256: sha("objective.txt"),
      actorId: "goal-owner",
      issuedAt: ISSUED_AT,
      expiresAt: "2026-08-30T04:30:00.001Z",
      nonce: NONCE,
    })).toThrow("must not exceed 30 minutes");
  });

  it("requires the statement digest to be the exact objective artifact byte digest", async () => {
    const { lock } = await harness();
    expect(() => compileGrandHallDifixExecutionAuthorization({
      authorizationId: "objective-digest-mismatch",
      executionLock: lock,
      objectiveArtifact: file(resolve(dirnameFor(lock.paths.controlDirectoryHost), "objective.txt"), "objective.txt"),
      objectiveArtifactStatementSha256: sha("different-statement"),
      actorId: "goal-owner",
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      nonce: NONCE,
    })).toThrow("exact objective artifact byte digest");
  });

  it("rejects an authorization nonce that is not embedded in its exact claim path", async () => {
    const { lock } = await harness();
    expect(() => compileGrandHallDifixExecutionAuthorization({
      authorizationId: "nonce-mismatch",
      executionLock: lock,
      objectiveArtifact: file(resolve(dirnameFor(lock.paths.controlDirectoryHost), "objective.txt"), "objective.txt"),
      objectiveArtifactStatementSha256: sha("objective.txt"),
      actorId: "goal-owner",
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      nonce: "b".repeat(64),
    })).toThrow("claim filename must include");
  });

  it("has exactly one atomic winner and consumes authorization before any provider launch", async () => {
    const { lock } = await harness();
    const value = authorization(lock);
    const results = await Promise.allSettled([
      claimGrandHallDifixAuthorizationCreateOnly({ authorization: value, lock, claimedAt: "2026-08-30T04:01:00.000Z" }),
      claimGrandHallDifixAuthorizationCreateOnly({ authorization: value, lock, claimedAt: "2026-08-30T04:01:00.000Z" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "AUTHORIZATION_CONSUMED" }),
    });
  });

  it("refuses to create a claim outside the exact authorization window", async () => {
    const { lock } = await harness();
    await expect(claimGrandHallDifixAuthorizationCreateOnly({
      authorization: authorization(lock),
      lock,
      claimedAt: EXPIRES_AT,
    })).rejects.toThrow("outside the active authorization window");
  });

  it("keeps a valid early claim consumed when later work crosses authorization expiry", async () => {
    const { lock } = await harness();
    const value = authorization(lock);
    const claimedAt = "2026-08-30T04:19:59.999Z";
    const plannedClaimSha256 = createGrandHallDifixAuthorizationClaim({
      authorization: value,
      executionLock: lock,
      claimedAt,
    }).claimSha256;
    const planned = await completeGrandHallDifixConsumedPrelaunch({
      plannedClaimSha256,
      consumeAuthorization: async () => await claimGrandHallDifixAuthorizationCreateOnly({
        authorization: value,
        lock,
        claimedAt,
      }),
      runExhaustivePrelaunch: () => {
        expect(() => { assertGrandHallDifixAuthorizationCurrent(value, new Date(EXPIRES_AT)); })
          .toThrow("expired");
        return Promise.resolve("exhaustive-complete");
      },
      publishConsumedFailure: () => Promise.reject(
        new Error("successful exhaustive work must not publish a failure receipt"),
      ),
    });

    expect(planned.value).toBe("exhaustive-complete");
    await expect(readFile(lock.paths.claimHost, "utf8").then((bytes) => JSON.parse(bytes) as unknown))
      .resolves.toMatchObject({
        authorizationSha256: value.authorizationSha256,
        claimedAt,
        authorizationConsumed: true,
        consumedEvenOnFailure: true,
      });
  });

  it("writes terminal no-retry evidence and never reaches provider launch after exhaustive failure", async () => {
    const { root } = await harness();
    const terminalPath = resolve(root, "control", "behavioral-terminal.json");
    const plannedClaimSha256 = sha("behavioral-claim");
    let providerLaunchCount = 0;
    const run = async (): Promise<void> => {
      await completeGrandHallDifixConsumedPrelaunch({
        plannedClaimSha256,
        consumeAuthorization: () => Promise.resolve(plannedClaimSha256),
        runExhaustivePrelaunch: () => Promise.reject(new Error("synthetic exhaustive failure")),
        publishConsumedFailure: async () => {
          await writeFile(terminalPath, JSON.stringify({ phase: "failed", noRetryPermitted: true }), "utf8");
        },
      });
      providerLaunchCount += 1;
    };

    await expect(run()).rejects.toThrow("synthetic exhaustive failure");
    expect(providerLaunchCount).toBe(0);
    await expect(readFile(terminalPath, "utf8").then((bytes) => JSON.parse(bytes) as unknown))
      .resolves.toEqual({ phase: "failed", noRetryPermitted: true });
  });

  it("treats a post-create claim publication failure as consumed", async () => {
    const plannedClaimSha256 = sha("partial-claim");
    let failurePublicationCount = 0;
    await expect(completeGrandHallDifixConsumedPrelaunch({
      plannedClaimSha256,
      consumeAuthorization: () => Promise.reject(
        new GrandHallDifixClaimPublicationError(plannedClaimSha256, new Error("synthetic fsync failure")),
      ),
      runExhaustivePrelaunch: () => Promise.reject(
        new Error("exhaustive work must not run after claim publication failure"),
      ),
      publishConsumedFailure: () => {
        failurePublicationCount += 1;
        return Promise.resolve();
      },
    })).rejects.toThrow("claim path was atomically consumed");
    expect(failurePublicationCount).toBe(1);
  });
});

describe("Grand Hall Difix one-shot tamper and path boundaries", () => {
  it("matches the Python canonical digest for the cross-language regression vector", () => {
    const value = {
      nested: {
        renderGenerationReceipt: "g",
        rendererArtifact: "r",
      },
      renderGenerationReceiptSha256: "g",
      rendererArtifactSha256: "r",
    };
    expect(grandHallDifixPortableDomainDigest(
      "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
      value,
    )).toBe("sha256:e3d8ffd05318aca4cfc932d136fb27c348b0cf11e417e57f31aabcf0ad71299c");
  });

  it("fails closed on numbers whose JSON spellings are not cross-language locked", () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => grandHallDifixPortableDomainDigest(
        "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
        { value },
      )).toThrow("safe integers only");
    }
  });

  it("rejects sparse arrays and JSON-invisible object properties", () => {
    const sparse = new Array<unknown>(1);
    expect(() => grandHallDifixPortableDomainDigest(
      "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
      sparse,
    )).toThrow("dense arrays without extra properties only");

    const withSymbol = { visible: true } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("hidden")] = true;
    expect(() => grandHallDifixPortableDomainDigest(
      "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
      withSymbol,
    )).toThrow("enumerable string-keyed properties only");

    const withHidden = { visible: true };
    Object.defineProperty(withHidden, "hidden", { enumerable: false, value: true });
    expect(() => grandHallDifixPortableDomainDigest(
      "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
      withHidden,
    )).toThrow("enumerable string-keyed properties only");
  });

  it("keeps a legacy locale-digested lock audit-readable while new fixtures use the portable digest", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const legacyExecutionLockSha256 = digest(
      "VENVIEWER_GRAND_HALL_DIFIX_EXECUTION_LOCK_V1",
      payload,
    );
    expect(lock.executionLockSha256).toBe(grandHallDifixExecutionLockDigest(payload));
    expect(GrandHallDifixExecutionLockSchema.parse({
      ...payload,
      executionLockSha256: legacyExecutionLockSha256,
    }).executionLockSha256).toBe(legacyExecutionLockSha256);
  });

  it("binds the WSL NVIDIA utility directory into the exact offline execution environment", async () => {
    const { lock } = await harness();
    expect(lock.launch.offlineEnvironment.PATH).toBe(
      "/usr/local/cuda/bin:/usr/lib/wsl/lib:/usr/bin:/bin",
    );

    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      launch: {
        ...payload.launch,
        offlineEnvironment: {
          ...payload.launch.offlineEnvironment,
          PATH: "/usr/local/cuda/bin:/usr/bin:/bin",
        },
      },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow();
  });

  it("passes exactly the lock-bound PATH through an empty process environment", async () => {
    const { lock } = await harness();
    const argv = grandHallDifixOfflineEnvArguments(lock, "/tmp");
    expect(argv.slice(0, 2)).toEqual(["env", "-i"]);
    expect(argv.filter((argument) => argument.startsWith("PATH="))).toEqual([
      `PATH=${lock.launch.offlineEnvironment.PATH}`,
    ]);
  });

  it("rejects a self-hash-tampered execution lock", async () => {
    const { lock } = await harness();
    expect(() => GrandHallDifixExecutionLockSchema.parse({ ...lock, sourceImageSha256: sha("tampered") }))
      .toThrow("execution lock digest mismatch");
  });

  it.each([
    { field: "adapterSha256" },
    { field: "runtimeSealToolSha256" },
  ] as const)("rejects a recomputed lock whose top-level $field disagrees with the exact bound file", async ({ field }) => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = { ...payload, [field]: sha(`tampered-${field}`) };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow(`${field} must equal its exact bound-file digest`);
  });

  it("rejects a recomputed lock whose parameter artifact is not the exact canonical one-shot configuration", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      experimentBindings: {
        ...payload.experimentBindings,
        plannedExecution: {
          ...payload.experimentBindings.plannedExecution,
          parameterConfigurationArtifactSha256: sha("noncanonical-or-different-configuration-bytes"),
        },
      },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow("exact canonical one-shot configuration bytes");
  });

  it.each([
    {
      boundary: "provider adapter identity",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        plannedExecution: { ...value.plannedExecution, providerAdapterId: "different-adapter" },
      }),
    },
    {
      boundary: "provider adapter bytes",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        plannedExecution: { ...value.plannedExecution, providerAdapterImplementationSha256: sha("different-adapter-bytes") },
      }),
    },
    {
      boundary: "exact configuration artifact",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        plannedExecution: { ...value.plannedExecution, parameterConfigurationArtifactSha256: sha("different-configuration") },
      }),
    },
    {
      boundary: "runtime-seal environment closure",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        plannedExecution: { ...value.plannedExecution, runtimeEnvironmentArtifactSha256: sha("different-runtime-environment") },
      }),
    },
    {
      boundary: "provider source archive",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        provider: { ...value.provider, repositorySourceArchiveSha256: sha("different-source-archive") },
      }),
    },
    {
      boundary: "model manifest",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        provider: { ...value.provider, modelRepositoryManifestSha256: sha("different-model-manifest") },
      }),
    },
    {
      boundary: "model weight closure",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        provider: {
          ...value.provider,
          modelWeights: value.provider.modelWeights.map((weight, index) => (
            index === 0 ? { ...weight, sha256: sha("different-model-weight") } : weight
          )),
        },
      }),
    },
    {
      boundary: "input-pack bundle",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, bundleMaterialSha256: sha("different-input-pack-bundle") },
      }),
    },
    {
      boundary: "source render",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, sourceRenderSha256: sha("different-source-render") },
      }),
    },
    {
      boundary: "browser capture record substitution",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, browserCaptureRecordSha256: sha("substituted-browser-capture-record") },
      }),
    },
    {
      boundary: "camera artifact",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, cameraArtifactSha256: sha("different-camera-artifact") },
      }),
    },
    {
      boundary: "fixed-camera digest",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        fixedCamera: { ...value.fixedCamera, cameraSha256: sha("different-fixed-camera") },
      }),
    },
    {
      boundary: "renderer artifact",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, rendererArtifactSha256: sha("different-renderer") },
      }),
    },
    {
      boundary: "render-generation receipt substitution",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, renderGenerationReceiptSha256: sha("substituted-render-generation-receipt") },
      }),
    },
    {
      boundary: "protected mask",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, protectedMaskSha256: sha("different-protected-mask") },
      }),
    },
    {
      boundary: "generated-region mask",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, generatedRegionMaskSha256: sha("different-generated-mask") },
      }),
    },
    {
      boundary: "protected-mask analysis",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        fixedCamera: { ...value.fixedCamera, protectedMaskAnalysisReceiptSha256: sha("different-protected-analysis") },
      }),
    },
    {
      boundary: "generated-mask analysis",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        fixedCamera: { ...value.fixedCamera, generatedMaskAnalysisReceiptSha256: sha("different-generated-analysis") },
      }),
    },
    {
      boundary: "reconstruction descriptor",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, reconstructionArtifactSha256: sha("different-reconstruction-descriptor") },
      }),
    },
    {
      boundary: "reconstruction member closure",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        inputPack: { ...value.inputPack, reconstructionMemberClosureSha256: sha("different-reconstruction-closure") },
      }),
    },
    {
      boundary: "local experiment material set",
      mutate: (value: GrandHallDifixExperimentBindings) => ({
        ...value,
        localExperimentMaterialSetSha256: sha("different-local-material-set"),
      }),
    },
  ])("rejects an adversarial $boundary projection mismatch", async ({ mutate }) => {
    const { lock } = await harness();
    expect(() => {
      assertGrandHallDifixExperimentBindingProjectionMatches(
        lock.experimentBindings,
        mutate(lock.experimentBindings),
      );
    }).toThrow();
  });

  it("rejects WSL traversal even when the outer digest is recomputed", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      paths: { ...payload.paths, outputImageWsl: "/mnt/c/attempt/../escaped.png" },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow("WSL path");
  });

  it("rejects a recomputed lock whose duplicate source WSL path disagrees with its bound file", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      paths: { ...payload.paths, sourceImageWsl: wsl("different/source-render.png") },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow("sourceImageWsl must equal the exact bound source-image WSL path");
  });

  it("rejects an attempt cache redirected outside the exact create-only attempt", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      paths: {
        ...payload.paths,
        hfModulesCacheHost: resolve(lock.paths.controlDirectoryHost, "shared-hf-cache"),
        hfModulesCacheWsl: wsl("control/shared-hf-cache"),
      },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow("attempt artifact must be a direct attempt-directory child");
  });

  it("rejects a private model snapshot redirected outside the consumed attempt", async () => {
    const { lock } = await harness();
    const { executionLockSha256: _digest, ...payload } = lock;
    const tamperedPayload = {
      ...payload,
      paths: {
        ...payload.paths,
        modelExecutionSnapshotHost: resolve(lock.paths.controlDirectoryHost, "shared-model-snapshot"),
        modelExecutionSnapshotWsl: wsl("control/shared-model-snapshot"),
      },
    };
    expect(() => GrandHallDifixExecutionLockSchema.parse({
      ...tamperedPayload,
      executionLockSha256: grandHallDifixExecutionLockDigest(tamperedPayload),
    })).toThrow("attempt artifact must be a direct attempt-directory child");
  });

  it("rejects hard-linked lock aliases before reading bound materials", async () => {
    const { root, lock } = await harness();
    const bytes = Buffer.from(`${JSON.stringify(lock)}\n`, "utf8");
    await writeFile(lock.paths.executionLockHost, bytes, { flag: "wx" });
    const alias = resolve(root, "lock-alias.json");
    await link(lock.paths.executionLockHost, alias);
    await expect(checkGrandHallDifixExecutionLock(alias)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    } satisfies Partial<GrandHallDifixOneShotError>);
  });

  it("contains stable-before/opened/after race checks in both control planes", async () => {
    const typescript = await readFile(fileURLToPath(new URL("../grand-hall-difix-one-shot.ts", import.meta.url)), "utf8");
    const python = await readFile(fileURLToPath(new URL("../../python/grand_hall_difix_no_reference_adapter.py", import.meta.url)), "utf8");
    expect(typescript).toContain("changed during its stable read");
    expect(typescript).toContain("openedAfter");
    expect(typescript).toContain("pathAfter");
    expect(python).toContain("changed during its stable read");
    expect(python).toContain("opened_after");
    expect(python).toContain("path_after");
  });
});

describe("pinned Python adapter and OS sandbox", () => {
  it("directly invokes only pipeline_difix.DifixPipeline with exact no-reference settings", async () => {
    const adapter = await readFile(fileURLToPath(new URL("../../python/grand_hall_difix_no_reference_adapter.py", import.meta.url)), "utf8");
    expect(adapter).toContain("importlib.util.spec_from_file_location(");
    expect(adapter).toContain("specification.loader.exec_module(module)");
    expect(adapter).toContain('getattr(module, "DifixPipeline", None)');
    expect(adapter).not.toContain("inference_difix");
    expect(adapter).not.toMatch(/from\s+model\s+import/u);
    expect(adapter).not.toContain(".convert(");
    expect(adapter).not.toContain(".resize(");
    expect(adapter).toContain("do_resize=False");
    expect(adapter).toContain("do_convert_rgb=False");
    expect(adapter).toContain("do_normalize=True");
    expect(adapter).toContain("torch_dtype=torch.float32");
    expect(adapter).toContain("local_files_only=True");
    expect(adapter).not.toContain("trust_remote_code");
    expect(adapter).toContain("pipeline.config.get(\"requires_safety_checker\") is not True");
    expect(adapter).toContain("pipeline.safety_checker is not None");
    expect(adapter).toContain("pipeline.feature_extractor is not None");
    expect(adapter).toContain('getattr(pipeline, "image_encoder", None) is not None');
    expect(adapter).toContain("MODEL_INDEX_SHA256");
    expect(adapter).toContain("PIPELINE_DIFIX_SHA256");
    expect(adapter).toContain('prompt=PROMPT');
    expect(adapter).toContain("ref_image=None");
    expect(adapter).toContain("num_inference_steps=1");
    expect(adapter).toContain("timesteps=TIMESTEPS");
    expect(adapter).toContain("guidance_scale=0");
    expect(adapter).toContain("negative_prompt=None");
    expect(adapter).toContain("num_images_per_prompt=1");
    expect(adapter).toContain("eta=0");
    expect(adapter).toContain('torch.Generator(device="cuda").manual_seed(SEED)');
    expect(adapter).toContain('output_type="pil"');
    expect(adapter).toContain("guidance_rescale=0");
    expect(adapter).toContain("clip_skip=None");
  });

  it("isolates and receipts the intentionally executed exact local custom VAE closure", async () => {
    const runner = await readFile(fileURLToPath(new URL("../grand-hall-difix-one-shot.ts", import.meta.url)), "utf8");
    const contract = await readFile(fileURLToPath(new URL("../grand-hall-difix-one-shot-contract.ts", import.meta.url)), "utf8");
    const adapter = await readFile(fileURLToPath(new URL("../../python/grand_hall_difix_no_reference_adapter.py", import.meta.url)), "utf8");
    for (const token of [
      '"-I"',
      '"-B"',
      "HF_MODULES_CACHE",
      "TORCH_HOME",
    ]) expect(runner).toContain(token);
    expect(contract).toContain("HF_HUB_DISABLE_IMPLICIT_TOKEN");
    expect(contract).toContain("HF_HUB_DISABLE_TELEMETRY");
    expect(adapter).toContain("sys.flags.isolated != 1");
    expect(adapter).toContain("require_absent_direct_child(args.hf_modules_cache");
    expect(adapter).toContain("MODEL_LOAD_CLOSURE");
    expect(adapter).toContain("preload_exact_local_code_and_model_closure(");
    expect(adapter).toContain("stable_copy_create_only(");
    expect(adapter).toContain("create_private_model_execution_snapshot(");
    expect(adapter).toContain("finalize_private_model_execution_snapshot(");
    expect(adapter).toContain("str(model_execution_snapshot_root)");
    expect(adapter).not.toContain("str(model_snapshot_root),\n        torch_dtype=torch.float32");
    expect(adapter).toContain("sourceRelativePath\": \"vae/autoencoder_kl.py");
    expect(adapter).toContain("a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf");
    expect(adapter).toContain("class_file.relative_to(cache_root)");
    expect(adapter).toContain("copiedModuleSha256AfterInference");
    expect(adapter).toContain("network_after_load = require_network_unreachable()");
  });

  it("claims after bounded no-network CUDA checks, then exhaustively seals before provider launch", async () => {
    const runner = await readFile(fileURLToPath(new URL("../grand-hall-difix-one-shot.ts", import.meta.url)), "utf8");
    const contract = await readFile(fileURLToPath(new URL("../grand-hall-difix-one-shot-contract.ts", import.meta.url)), "utf8");
    const adapter = await readFile(fileURLToPath(new URL("../../python/grand_hall_difix_no_reference_adapter.py", import.meta.url)), "utf8");
    const mappingIndex = runner.indexOf("await verifyWslHostMappings(lock, authorization)");
    const pythonLockPreflightDefinitionIndex = runner.indexOf("const PYTHON_EXECUTION_LOCK_DIGEST_PREFLIGHT");
    const pythonGoldenIndex = runner.indexOf("sha256:e3d8ffd05318aca4cfc932d136fb27c348b0cf11e417e57f31aabcf0ad71299c");
    const quickCheckIndex = runner.indexOf("const before = await checkExactMaterials(lock, false)");
    const pythonLockIndex = runner.indexOf("await preflightPythonCanonicalExecutionLock(lock, lockStable)");
    const namespaceIndex = runner.indexOf("await preflightExactNamespace(lock)");
    const claimIndex = runner.indexOf("await claimGrandHallDifixAuthorizationCreateOnly");
    const exhaustiveIndex = runner.indexOf("const exhaustiveBefore = await checkExactMaterials(lock, true)");
    const launchIndex = runner.indexOf('exitCode = await spawnToLogs("wsl.exe"');
    expect(contract).toContain('["unshare", "--user", "--map-root-user", "--net"]');
    expect(mappingIndex).toBeGreaterThan(-1);
    expect(pythonGoldenIndex).toBeGreaterThan(pythonLockPreflightDefinitionIndex);
    expect(mappingIndex).toBeLessThan(quickCheckIndex);
    expect(quickCheckIndex).toBeLessThan(pythonLockIndex);
    expect(pythonLockIndex).toBeLessThan(namespaceIndex);
    expect(namespaceIndex).toBeLessThan(claimIndex);
    expect(claimIndex).toBeLessThan(exhaustiveIndex);
    expect(exhaustiveIndex).toBeLessThan(launchIndex);
    expect(runner).toContain("Bound materials changed between quick and exhaustive preflight.");
    expect(runner).toContain("authorization objective artifact post-exhaustive-preflight");
    expect(runner).toContain("Python-canonical execution-lock preflight failed before claim.");
    expect(runner).toContain("sha256:e3d8ffd05318aca4cfc932d136fb27c348b0cf11e417e57f31aabcf0ad71299c");
    expect(runner).toContain('"--model-execution-snapshot", lock.paths.modelExecutionSnapshotWsl');
    expect(adapter).toContain("result != errno.ENETUNREACH");
    expect(adapter).toContain("torch.cuda.is_available()");
    expect(adapter).toContain('device="cuda"');
  });

  it("seals exhaustive file, symlink, external interpreter, source archive, wheels, and pip-freeze inventories", async () => {
    const seal = await readFile(fileURLToPath(new URL("../../python/grand_hall_difix_runtime_seal.py", import.meta.url)), "utf8");
    for (const token of [
      "externalInterpreterChain",
      "providerSourceTree",
      "sourceArchive",
      "wheelhouse",
      "wheelHashInventory",
      "pipFreeze",
      "resolvedSha256",
      "tree_identity(before) != tree_identity(after)",
      "67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15",
      "3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70",
      "20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25",
      "a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf",
      "scheduler/scheduler_config.json",
      "tokenizer/tokenizer_config.json",
      "expectedLoadClosureFiles",
    ]) expect(seal).toContain(token);
  });
});

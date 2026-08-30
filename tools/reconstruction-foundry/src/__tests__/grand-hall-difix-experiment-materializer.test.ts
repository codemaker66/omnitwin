import { createHash } from "node:crypto";
import { cp, mkdir, readFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { domainSeparatedSha256, stableCanonicalJson, toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_RECEIPT_SCHEMA,
  GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_SCHEMA,
  GrandHallDifixExperimentMaterializationReceiptSchema,
  GrandHallDifixExperimentMaterializationSpecSchema,
  checkGrandHallDifixExperimentMaterialization,
  deriveGrandHallDifixFixedCameraViewMatrix,
  writeGrandHallDifixExperimentMaterialization,
} from "../grand-hall-difix-experiment-materializer.js";
import { checkGrandHallDifixExecutionLock, compileGrandHallDifixExecutionLockFromSpec } from "../grand-hall-difix-one-shot.js";
import { prepareGrandHallForbiddenArchitectureEvaluatorMaterials } from "../grand-hall-forbidden-architecture-evaluator.js";
import { materializeGrandHallProtectedRegionMetricsPack } from "../grand-hall-protected-region-metrics.js";

const roots: string[] = [];

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(value))}\n`, "utf8");
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-difix-materializer-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function artifactSpec(root: string, id: string, mediaType = "application/json") {
  return {
    artifactId: id,
    absolutePath: resolve(root, `${id}.json`),
    relativePath: `external/${id}.json`,
    mediaType,
  };
}

function validSpec(root: string) {
  return {
    schemaVersion: GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_SCHEMA,
    experimentId: "grand-hall-difix-source-pose-19890-v1",
    projectId: "trades-hall-grand-hall",
    inputPackDirectory: resolve(root, "input-pack"),
    runtimeSealPath: resolve(root, "runtime-seal.json"),
    modelSealPath: resolve(root, "model-seal.json"),
    providerAdapterPath: resolve(root, "adapter.py"),
    rendererImplementationFiles: [artifactSpec(root, "renderer-source", "text/typescript")],
    maskAnalyzerImplementation: artifactSpec(root, "mask-analyzer", "text/typescript"),
    protectedRegionEvaluator: {
      implementation: artifactSpec(root, "protected-implementation", "text/x-python"),
      configuration: artifactSpec(root, "protected-configuration"),
      runtimeEnvironment: artifactSpec(root, "protected-runtime"),
    },
    forbiddenSemanticEvaluator: {
      implementation: artifactSpec(root, "semantic-implementation", "text/x-python"),
      configuration: artifactSpec(root, "semantic-configuration"),
      runtimeEnvironment: artifactSpec(root, "semantic-runtime"),
    },
    providerReview: {
      reviewedBy: "foundry-integrity-reviewer",
      reviewedAt: "2026-08-30T07:00:00.000Z",
    },
    operatorOptIn: {
      actorId: "grand-hall-goal-owner",
      acceptedAt: "2026-08-30T07:01:00.000Z",
      statement: "I explicitly opt in to compile this isolated internal-R&D restoration experiment. I understand that compilation does not authorize execution, distribution, publication, runtime registration, or replacement of captured source truth.",
    },
    outputDirectory: resolve(root, "output"),
  };
}

async function incompletePublishedDirectory(): Promise<{
  readonly root: string;
  readonly memberNames: readonly string[];
}> {
  const root = await temporaryRoot();
  const memberNames = [
    "parameter-configuration.json",
    "runtime-environment.json",
    "renderer-implementation-manifest.json",
    "renderer-runtime.json",
    "mask-analyzer-configuration.json",
    "mask-analyzer-runtime.json",
    "provider-adapter.py",
    "mask-analyzer-implementation.bin",
    "protected-evaluator-implementation.bin",
    "protected-evaluator-configuration.json",
    "protected-evaluator-runtime.json",
    "semantic-evaluator-implementation.bin",
    "semantic-evaluator-configuration.json",
    "semantic-evaluator-runtime.json",
    "protected-mask-analysis-process.json",
    "generated-mask-analysis-process.json",
    "restoration-experiment.v0.json",
  ] as const;
  const receipts = [];
  for (const name of memberNames) {
    const bytes = Buffer.from(`fixture:${name}\n`, "utf8");
    await writeFile(join(root, name), bytes);
    receipts.push({ fileName: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const experiment = receipts.find((entry) => entry.fileName === "restoration-experiment.v0.json");
  if (experiment === undefined) throw new Error("Experiment fixture receipt is required.");
  const externalInputs = Array.from({ length: 8 }, (_, index) => ({
    artifactId: `external-${String(index)}`,
    absolutePath: resolve(root, `external-${String(index)}.bin`),
    relativePath: `external/external-${String(index)}.bin`,
    mediaType: "application/octet-stream",
    sizeBytes: 1,
    sha256: sha256(Buffer.from([index])),
  }));
  const receipt = GrandHallDifixExperimentMaterializationReceiptSchema.parse({
    schemaVersion: GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZATION_RECEIPT_SCHEMA,
    authority: "none",
    outputState: "complete_authority_none",
    receiptWrittenLast: true,
    experiment,
    filesBeforeReceipt: receipts,
    externalInputs,
  });
  await writeFile(join(root, "publication-receipt.json"), canonicalBytes(receipt));
  return { root, memberNames };
}

describe("Grand Hall Difix restoration experiment materializer", () => {
  it("requires every real evaluator and absolute material path in the exact fixed-camera spec", async () => {
    const root = await temporaryRoot();
    const parsed = GrandHallDifixExperimentMaterializationSpecSchema.parse(validSpec(root));
    expect(parsed.outputDirectory).toBe(resolve(root, "output"));
    expect(GrandHallDifixExperimentMaterializationSpecSchema.safeParse({
      ...validSpec(root),
      protectedRegionEvaluator: undefined,
    }).success).toBe(false);
    expect(GrandHallDifixExperimentMaterializationSpecSchema.safeParse({
      ...validSpec(root),
      runtimeSealPath: "relative/runtime-seal.json",
    }).success).toBe(false);
  });

  it("derives a rigid inverse view matrix and rejects a non-normalized camera quaternion", () => {
    expect(deriveGrandHallDifixFixedCameraViewMatrix(
      [2, 3, 4],
      [0, 0, 0, 1],
    )).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -2, -3, -4, 1,
    ]);
    expect(() => deriveGrandHallDifixFixedCameraViewMatrix([0, 0, 0], [0, 0, 0, 2]))
      .toThrow(/normalized/u);
  });

  it("fails closed on an unexpected file before trusting a materialization", async () => {
    const fixture = await incompletePublishedDirectory();
    await writeFile(join(fixture.root, "unexpected.json"), "{}\n");
    await expect(checkGrandHallDifixExperimentMaterialization(fixture.root)).rejects.toMatchObject({
      code: "OUTPUT_INVALID",
    });
  });

  it("fails closed on a material byte substitution before parsing the experiment", async () => {
    const fixture = await incompletePublishedDirectory();
    const firstMember = fixture.memberNames[0];
    if (firstMember === undefined) throw new Error("A material fixture member is required.");
    await writeFile(join(fixture.root, firstMember), "substituted\n");
    await expect(checkGrandHallDifixExperimentMaterialization(fixture.root)).rejects.toMatchObject({
      code: "OUTPUT_INVALID",
    });
  });

  it("writes the exact existing file-backed pack without regenerating its source and rejects coordinated receipt/member substitution", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(import.meta.dirname, "../../../..");
    const inputPackDirectory = resolve(repositoryRoot, "output/playwright/grand-hall-difix-input-pack-c18ac28c-compiled-8b06f8f7-20260830T043724Z-v1");
    const sourcePath = resolve(inputPackDirectory, "source-render.png");
    const sourceBefore = sha256(await readFile(sourcePath));
    const semanticDirectory = resolve(root, "semantic-evaluator");
    const semanticImplementation = resolve(repositoryRoot, "tools/reconstruction-foundry/src/grand-hall-forbidden-architecture-evaluator.ts");
    await prepareGrandHallForbiddenArchitectureEvaluatorMaterials({
      implementationPath: semanticImplementation,
      sourceImagePath: sourcePath,
      protectedMaskPath: resolve(inputPackDirectory, "protected-mask.png"),
      generatedRegionMaskPath: resolve(inputPackDirectory, "generated-region-mask.png"),
      width: 1_024,
      height: 576,
      outputDirectory: semanticDirectory,
    });
    const protectedDirectory = resolve(root, "protected-evaluator");
    await materializeGrandHallProtectedRegionMetricsPack({ outputDirectory: protectedDirectory });
    const external = (artifactId: string, absolutePath: string, relativePath: string, mediaType: string) => ({
      artifactId, absolutePath: resolve(absolutePath), relativePath, mediaType,
    });
    const outputDirectory = resolve(root, "experiment");
    const spec = GrandHallDifixExperimentMaterializationSpecSchema.parse({
      ...validSpec(root),
      inputPackDirectory,
      runtimeSealPath: "F:/venviewer-provider-cache/difix3d/seals/runtime-difix-py312-cu128-c76edc-v1-692e2cc6-20260830T064114Z.json",
      modelSealPath: "F:/venviewer-provider-cache/difix3d/seals/model-nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388-692e2cc6-20260830T063719Z.json",
      providerAdapterPath: resolve(repositoryRoot, "tools/reconstruction-foundry/python/grand_hall_difix_no_reference_adapter.py"),
      rendererImplementationFiles: [external("renderer_source", resolve(repositoryRoot, "packages/web/e2e/grand-hall-visual-lineage.local.spec.ts"), "renderer/grand-hall-visual-lineage.local.spec.ts", "application/typescript")],
      maskAnalyzerImplementation: external("mask_analyzer", resolve(repositoryRoot, "tools/reconstruction-foundry/src/grand-hall-difix-experiment-materializer.ts"), "analyzer/grand-hall-difix-experiment-materializer.ts", "application/typescript"),
      protectedRegionEvaluator: {
        implementation: external("protected_implementation", resolve(protectedDirectory, "implementation-manifest.json"), "protected/implementation-manifest.json", "application/json"),
        configuration: external("protected_configuration", resolve(protectedDirectory, "configuration.json"), "protected/configuration.json", "application/json"),
        runtimeEnvironment: external("protected_runtime", resolve(protectedDirectory, "runtime-environment.json"), "protected/runtime-environment.json", "application/json"),
      },
      forbiddenSemanticEvaluator: {
        implementation: external("semantic_implementation", semanticImplementation, "semantic/grand-hall-forbidden-architecture-evaluator.ts", "application/typescript"),
        configuration: external("semantic_configuration", resolve(semanticDirectory, "forbidden-architecture-configuration.json"), "semantic/configuration.json", "application/json"),
        runtimeEnvironment: external("semantic_runtime", resolve(semanticDirectory, "forbidden-architecture-runtime.json"), "semantic/runtime-environment.json", "application/json"),
      },
      outputDirectory,
    });
    const verified = await writeGrandHallDifixExperimentMaterialization(spec);
    expect(verified.experiment.inputs.find((input) => input.role === "source_fixed_camera_render")?.sha256).toBe(sourceBefore);
    expect(sha256(await readFile(sourcePath))).toBe(sourceBefore);

    const control = resolve(root, "control");
    const attempts = resolve(root, "attempts");
    const attempt = resolve(attempts, "attempt-001");
    await Promise.all([mkdir(control), mkdir(attempts)]);
    const lockPath = resolve(control, "execution-lock.json");
    const host = (name: string) => resolve(attempt, name);
    const wsl = (name: string) => `/mnt/c/venviewer-difix-real-fixture/${name}`;
    const lock = await compileGrandHallDifixExecutionLockFromSpec({
      lockId: "grand-hall-difix-real-file-backed-test",
      compiledAt: "2026-08-30T07:02:00.000Z",
      gitCommit: "1".repeat(40),
      wslDistribution: "Ubuntu",
      paths: {
        executionLockHost: lockPath, executionLockWsl: wsl("control/execution-lock.json"),
        experimentHost: resolve(outputDirectory, "restoration-experiment.v0.json"), experimentWsl: wsl("experiment/restoration-experiment.v0.json"),
        inputPackDirectoryHost: inputPackDirectory, inputPackDirectoryWsl: wsl("input-pack"),
        runtimeSealHost: spec.runtimeSealPath, runtimeSealWsl: wsl("seals/runtime.json"),
        modelSealHost: spec.modelSealPath, modelSealWsl: wsl("seals/model.json"),
        adapterHost: spec.providerAdapterPath, adapterWsl: wsl("provider/adapter.py"),
        runtimeSealToolHost: resolve(repositoryRoot, "tools/reconstruction-foundry/python/grand_hall_difix_runtime_seal.py"), runtimeSealToolWsl: wsl("provider/runtime-seal.py"),
        trustedVerifierPythonWsl: "/usr/bin/python3",
        venvPythonWsl: "/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv/bin/python",
        providerSourceRootWsl: "/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/source/Difix3D",
        modelSnapshotRootWsl: "/mnt/f/venviewer-provider-cache/difix3d/models/nvidia-difix-2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388",
        controlDirectoryHost: control, controlDirectoryWsl: wsl("control"),
        claimHost: resolve(control, "authorization.claim.json"), claimWsl: wsl("control/authorization.claim.json"),
        attemptDirectoryHost: attempt, attemptDirectoryWsl: wsl("attempts/attempt-001"),
        hfModulesCacheHost: host("hf-modules-cache"), hfModulesCacheWsl: wsl("attempts/attempt-001/hf-modules-cache"),
        torchHomeHost: host("torch-home"), torchHomeWsl: wsl("attempts/attempt-001/torch-home"),
        modelExecutionSnapshotHost: host("model-execution-snapshot"), modelExecutionSnapshotWsl: wsl("attempts/attempt-001/model-execution-snapshot"),
        outputImageHost: host("candidate.png"), outputImageWsl: wsl("attempts/attempt-001/candidate.png"),
        adapterReceiptHost: host("adapter-receipt.json"), adapterReceiptWsl: wsl("attempts/attempt-001/adapter-receipt.json"),
        stdoutHost: host("stdout.log"), stdoutWsl: wsl("attempts/attempt-001/stdout.log"),
        stderrHost: host("stderr.log"), stderrWsl: wsl("attempts/attempt-001/stderr.log"),
        startedReceiptHost: resolve(control, "started.json"), startedReceiptWsl: wsl("control/started.json"),
        terminalReceiptHost: resolve(control, "terminal.json"), terminalReceiptWsl: wsl("control/terminal.json"),
      },
    });
    expect((await checkGrandHallDifixExecutionLock(lockPath, false)).lock.executionLockSha256).toBe(lock.executionLockSha256);
    const substitutedSha = sha256(Buffer.from("substituted-bound-file", "utf8"));
    for (const [label, mutatePaths] of [
      ["browser", (paths: typeof lock.paths) => ({ ...paths, browserCaptureRecord: { ...paths.browserCaptureRecord, sha256: substitutedSha } })],
      ["render-generation", (paths: typeof lock.paths) => ({ ...paths, renderGenerationReceipt: { ...paths.renderGenerationReceipt, sha256: substitutedSha } })],
      ["local-material", (paths: typeof lock.paths) => ({ ...paths, experimentMaterials: paths.experimentMaterials.map((material, index) => index === 0
        ? { ...material, file: { ...material.file, sha256: substitutedSha } }
        : material) })],
    ] as const) {
      const tamperedPath = resolve(control, `execution-lock-${label}.json`);
      const { executionLockSha256: _oldDigest, ...payload } = lock;
      const tamperedPaths = { ...mutatePaths(lock.paths), executionLockHost: tamperedPath };
      const tamperedBindings = label === "browser"
        ? { ...lock.experimentBindings, inputPack: { ...lock.experimentBindings.inputPack, browserCaptureRecordSha256: substitutedSha } }
        : label === "render-generation"
          ? { ...lock.experimentBindings, inputPack: { ...lock.experimentBindings.inputPack, renderGenerationReceiptSha256: substitutedSha } }
          : {
              ...lock.experimentBindings,
              localExperimentMaterialSetSha256: `sha256:${domainSeparatedSha256(
                "VENVIEWER_GRAND_HALL_DIFIX_LOCAL_EXPERIMENT_MATERIAL_SET_V1",
                toCanonicalJson(tamperedPaths.experimentMaterials.map((material) => ({
                  relativePath: material.relativePath,
                  artifactIds: material.artifactIds,
                  sizeBytes: material.file.sizeBytes,
                  sha256: material.file.sha256,
                }))),
              )}`,
            };
      const tamperedPayload = { ...payload, paths: tamperedPaths, experimentBindings: tamperedBindings };
      const tampered = {
        ...tamperedPayload,
        executionLockSha256: `sha256:${domainSeparatedSha256("VENVIEWER_GRAND_HALL_DIFIX_EXECUTION_LOCK_V1", toCanonicalJson(tamperedPayload))}`,
      };
      await writeFile(tamperedPath, canonicalBytes(tampered));
      await expect(checkGrandHallDifixExecutionLock(tamperedPath, false)).rejects.toMatchObject({ code: "MATERIAL_MISMATCH" });
    }

    const receiptPath = resolve(outputDirectory, "publication-receipt.json");
    const originalReceiptBytes = await readFile(receiptPath);
    const originalReceipt = GrandHallDifixExperimentMaterializationReceiptSchema.parse(JSON.parse(originalReceiptBytes.toString("utf8")));
    const rewriteFirstExternal = (rewrite: (entry: typeof originalReceipt.externalInputs[number]) => typeof originalReceipt.externalInputs[number]) => ({
      ...originalReceipt,
      externalInputs: originalReceipt.externalInputs.map((entry, index) => index === 0 ? rewrite(entry) : entry),
    });
    const externalMutations = [
      { ...originalReceipt, externalInputs: originalReceipt.externalInputs.slice(1) },
      { ...originalReceipt, externalInputs: [...originalReceipt.externalInputs, originalReceipt.externalInputs[0]] },
      rewriteFirstExternal((entry) => ({ ...entry, artifactId: "altered-external-binding" })),
      rewriteFirstExternal((entry) => ({ ...entry, absolutePath: resolve(root, "safe-arbitrary-existing-looking-path.json") })),
      rewriteFirstExternal((entry) => ({ ...entry, relativePath: "safe/arbitrary-rewrite.json" })),
      rewriteFirstExternal((entry) => ({ ...entry, mediaType: "application/octet-stream" })),
      rewriteFirstExternal((entry) => ({ ...entry, sizeBytes: entry.sizeBytes + 1 })),
      rewriteFirstExternal((entry) => ({ ...entry, sha256: sha256(Buffer.from("rewritten-external", "utf8")) })),
    ];
    for (const mutation of externalMutations) {
      await writeFile(receiptPath, canonicalBytes(mutation));
      await expect(checkGrandHallDifixExperimentMaterialization(outputDirectory)).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    }
    await writeFile(receiptPath, originalReceiptBytes);

    const replacementDirectory = resolve(root, "self-consistent-replacement");
    await cp(outputDirectory, replacementDirectory, { recursive: true, errorOnExist: true, force: false });
    const identityRaceTarget = resolve(root, "identity-raced-experiment");
    await expect(writeGrandHallDifixExperimentMaterialization(
      { ...spec, outputDirectory: identityRaceTarget },
      { afterPublishedIdentityRead: async ({ targetDirectory }) => {
        await rename(targetDirectory, `${targetDirectory}-displaced`);
        await rename(replacementDirectory, targetDirectory);
      } },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    const parameterPath = resolve(outputDirectory, "parameter-configuration.json");
    const replacement = Buffer.from("{\"coordinated\":true}\n", "utf8");
    await writeFile(parameterPath, replacement);
    const receipt = GrandHallDifixExperimentMaterializationReceiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
    const coordinated = {
      ...receipt,
      filesBeforeReceipt: receipt.filesBeforeReceipt.map((entry) => entry.fileName === "parameter-configuration.json"
        ? { ...entry, sizeBytes: replacement.byteLength, sha256: sha256(replacement) }
        : entry),
    };
    await writeFile(receiptPath, canonicalBytes(coordinated));
    await expect(checkGrandHallDifixExperimentMaterialization(outputDirectory)).rejects.toMatchObject({ code: "OUTPUT_INVALID" });

    const racedTarget = resolve(root, "raced-experiment");
    await expect(writeGrandHallDifixExperimentMaterialization(
      { ...spec, outputDirectory: racedTarget },
      { afterStagingClaimed: async ({ stagingDirectory }) => {
        await rename(stagingDirectory, `${stagingDirectory}-displaced`);
        await mkdir(stagingDirectory);
      } },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(readFile(resolve(racedTarget, "publication-receipt.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);
});

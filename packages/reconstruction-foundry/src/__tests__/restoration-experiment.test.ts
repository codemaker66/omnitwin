import { describe, expect, it } from "vitest";
import {
  FOUNDRY_RESTORATION_LANES,
  FOUNDRY_RESTORATION_OPT_IN_STATEMENT,
  FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
  FoundryRestorationEvidenceObservationV0Schema,
  FoundryRestorationEvidenceV0Schema,
  FoundryRestorationExperimentV0Schema,
  FoundryRestorationInputCandidateV0Schema,
  FoundryRestorationProviderLockPayloadV0Schema,
  compileFoundryRestorationExperimentV0,
  createFoundryRestorationAttemptReceiptV0,
  createFoundryRestorationExecutionReceiptV0,
  createFoundryRestorationFixedCameraV0,
  createFoundryRestorationHardwareInventoryV0,
  createFoundryRestorationRenderDerivationReceiptV0,
  createFoundryRestorationRenderExecutionReceiptV0,
  createFoundryRestorationProtectedMetricResultV0,
  createFoundryRestorationSemanticResultV0,
  createFoundryRestorationCandidateRenderReceiptV0,
  createFoundryRestorationMaskAnalysisReceiptV0,
  createFoundryRestorationCreateOnlyRunReceiptV0,
  createFoundryRestorationImagePreparationReceiptV0,
  evaluateFoundryRestorationEvidenceV0,
  getFoundryRestorationProviderProfileV0,
  promoteFoundryRestorationCinematicDerivativeV0,
  type CompileFoundryRestorationExperimentV0Input,
  type FoundryRestorationEvidenceObservationV0,
  type FoundryRestorationLane,
  type FoundryRestorationProviderLockPayloadV0,
} from "../restoration-experiment.js";

const CREATED_AT = "2026-08-30T01:15:00.000Z";
const REVIEWED_AT = "2026-08-30T01:00:00.000Z";

function sha256(seed: string): `sha256:${string}` {
  const hex = Buffer.from(seed, "utf8").toString("hex").padEnd(64, "0").slice(0, 64);
  return `sha256:${hex}`;
}

function revision(seed: number): string {
  return seed.toString(16).padStart(40, "0");
}

function providerVariantForLane(
  lane: FoundryRestorationLane,
): "difix" | "difix_ref" | null {
  return lane === "difix3d_plus" ? "difix_ref" : null;
}

function licenseEvidence(
  seed: string,
  components: readonly {
    readonly componentId: string; readonly licenseName: string; readonly scope: string;
    readonly permissionCodes: readonly string[]; readonly conditionCodes: readonly string[]; readonly clauseRefs: readonly string[];
  }[] | null,
  requiredUsePosture: string,
  document: {
    readonly locator: string;
    readonly revision: string;
    readonly relativePath: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  } | null,
  fallbackRevision: string,
) {
  if (requiredUsePosture !== "noncommercial_internal_r_and_d_only") {
    throw new Error("The fixture requires the noncommercial internal-R&D posture.");
  }
  return {
    officialLicenseFacts: {
      document: document ?? {
        locator: `test-fixture:${seed}`,
        revision: fallbackRevision,
        relativePath: `${seed}/LICENSE.test-fixture`,
        sizeBytes: 512,
        sha256: sha256(`${seed}-licence-document`),
      },
      components: components === null ? [{
        componentId: "unknown_test_fixture", licenseName: "UNKNOWN TEST FIXTURE ONLY",
        scope: "unknown_test_scope", permissionCodes: ["unknown_permission"],
        conditionCodes: ["unknown_condition"], clauseRefs: ["unknown_clause"],
      }] : components.map((component) => ({
        ...component, permissionCodes: [...component.permissionCodes],
        conditionCodes: [...component.conditionCodes], clauseRefs: [...component.clauseRefs],
      })),
    },
    projectPolicyReview: {
      reviewedUsePosture: "noncommercial_internal_r_and_d_only" as const,
      reviewedBy: "foundry-licence-reviewer",
      reviewedAt: REVIEWED_AT,
      commercialUseAllowed: false as const,
      distributionAllowed: false as const,
    },
  };
}

function providerLock(
  lane: FoundryRestorationLane,
  providerVariant: "difix" | "difix_ref" | null = providerVariantForLane(lane),
): FoundryRestorationProviderLockPayloadV0 {
  const profile = getFoundryRestorationProviderProfileV0(lane);
  return {
    lane,
    reviewedBy: "foundry-integrity-reviewer",
    reviewedAt: REVIEWED_AT,
    exactOfficialIdentityReviewed:
      profile.repositoryRequirements.every((requirement) =>
        requirement.repositoryId !== null && requirement.revision !== null &&
        requirement.officialLicenseComponents !== null && requirement.licenseDocument !== null,
      ) && profile.modelRequirements
        .filter((requirement) =>
          requirement.variants === null
            ? providerVariant === null
            : providerVariant !== null && requirement.variants.includes(providerVariant),
        )
        .every((requirement) =>
          requirement.modelId !== null && requirement.revision !== null &&
          requirement.officialLicenseComponents !== null && requirement.licenseDocument !== null,
        ),
    repositories: profile.repositoryRequirements.map((requirement, index) => {
      const lockedRevision = requirement.revision ?? revision(index + 100);
      return {
        role: requirement.role,
        repositoryId:
          requirement.repositoryId ?? `reviewed-upstream/${lane}-${requirement.role}`,
        revision: lockedRevision,
        sourceArchiveSha256: sha256(`${lane}-repository-${requirement.role}`),
        licenseEvidence: licenseEvidence(
          `${lane}-repository-license-${requirement.role}`,
          requirement.officialLicenseComponents,
          requirement.requiredUsePosture,
          requirement.licenseDocument,
          lockedRevision,
        ),
      };
    }),
    models: profile.modelRequirements
      .filter((requirement) =>
        requirement.variants === null
          ? providerVariant === null
          : providerVariant !== null && requirement.variants.includes(providerVariant),
      )
      .map((requirement, index) => {
      const lockedRevision = requirement.revision ?? revision(index + 200);
      return {
        role: requirement.role,
        modelId:
          requirement.modelId ?? `reviewed-upstream/${lane}-${requirement.role}`,
        revision: lockedRevision,
        repositoryManifestSha256: sha256(`${lane}-model-${requirement.role}`),
        access: requirement.access,
        licenseEvidence: licenseEvidence(
          `${lane}-model-license-${requirement.role}`,
          requirement.officialLicenseComponents,
          requirement.requiredUsePosture,
          requirement.licenseDocument,
          lockedRevision,
        ),
        weights: [{
          relativePath: `${requirement.role}/model.safetensors`,
          sizeBytes: 1_024 + index,
          sha256: sha256(`${lane}-weight-${requirement.role}`),
        }],
      };
    }),
  };
}

function fixedCamera() {
  return createFoundryRestorationFixedCameraV0({
    cameraId: "grand-hall-inspection-001",
    coordinateFrameId: "grand-hall-canonical-frame",
    viewMatrixColumnMajor: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -8, 1,
    ],
    projectionMatrixColumnMajor: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.1, 0,
    ],
    width: 1_600,
    height: 900,
    rendererProfileSha256: sha256("renderer-profile"),
    colorSpace: "srgb",
  });
}

function digestAddressedJsonArtifact(id: string, seed: string) {
  return {
    artifactId: id,
    relativePath: `${id}/artifact.json`,
    mediaType: "application/json" as const,
    sizeBytes: 2_048,
    sha256: sha256(seed),
    canonicalization: "rfc8785_json" as const,
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
  };
}

function digestAddressedArtifact(
  id: string,
  seed: string,
  mediaType: "application/octet-stream" | "image/png" = "application/octet-stream",
  sha256Override?: `sha256:${string}`,
) {
  return {
    artifactId: id,
    relativePath: `${id}/artifact.bin`,
    mediaType,
    sizeBytes: 4_096,
    sha256: sha256Override ?? sha256(seed),
    canonicalization: "byte_exact" as const,
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
  };
}

function digestAddressedImageArtifact(id: string, seed: string, sha256Override?: string) {
  return {
    artifactId: id,
    relativePath: `${id}/artifact.png`,
    mediaType: "image/png" as const,
    sizeBytes: 4_096,
    sha256: sha256Override ?? sha256(seed),
    canonicalization: "byte_exact" as const,
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
    width: 1_600,
    height: 900,
  };
}

function experimentInput(
  lane: FoundryRestorationLane,
  providerVariant: "difix" | "difix_ref" | null = providerVariantForLane(lane),
): CompileFoundryRestorationExperimentV0Input {
  const profile = getFoundryRestorationProviderProfileV0(lane);
  const camera = fixedCamera();
  const sourceRenderSha256 = sha256(`${lane}-input-source_fixed_camera_render`);
  const protectedMaskArtifact = digestAddressedImageArtifact(`${lane}-protected-region-mask`, "protected-region-mask");
  const generatedMaskArtifact = digestAddressedImageArtifact(`${lane}-generated-region-mask`, "generated-region-mask");
  const maskAnalysis = (artifact: typeof protectedMaskArtifact, state: "all_one" | "all_zero") =>
    createFoundryRestorationMaskAnalysisReceiptV0({
      maskArtifact: artifact,
      analyzerImplementationArtifact: digestAddressedArtifact(`${artifact.artifactId}-analyzer`, `${artifact.artifactId}-analyzer`),
      analyzerConfigurationArtifact: digestAddressedJsonArtifact(`${artifact.artifactId}-analyzer-config`, `${artifact.artifactId}-analyzer-config`),
      analyzerRuntimeArtifact: digestAddressedJsonArtifact(`${artifact.artifactId}-analyzer-runtime`, `${artifact.artifactId}-analyzer-runtime`),
      analyzerProcessReceiptArtifact: digestAddressedJsonArtifact(`${artifact.artifactId}-analyzer-process`, `${artifact.artifactId}-analyzer-process`),
      startedAt: "2026-08-30T01:14:00.000Z", completedAt: "2026-08-30T01:14:30.000Z",
      decodedWidth: 1_600, decodedHeight: 900, pixelCount: 1_440_000,
      zeroPixelCount: state === "all_zero" ? 1_440_000 : 0,
      onePixelCount: state === "all_one" ? 1_440_000 : 0,
      nonzeroPixelCount: state === "all_one" ? 1_440_000 : 0,
      coverageFraction: state === "all_one" ? 1 : 0, state,
    });
  const selectedRequirements = profile.requiredInputs.filter((requirement) =>
    requirement.variants === null
      ? providerVariant === null
      : providerVariant !== null && requirement.variants.includes(providerVariant),
  );
  const inputRecord = (role: string) => {
    const index = selectedRequirements.findIndex((requirement) => requirement.role === role);
    if (index < 0) throw new Error(`Missing fixture input ${role}`);
    const requirement = selectedRequirements[index]!;
    return {
      artifactId: `${lane}-${requirement.role}-${String(index + 1)}`,
      relativePath: `${requirement.role}/artifact-${String(index + 1)}.bin`,
      mediaType: requirement.mediaType,
      sizeBytes: 4_096 + index,
      sha256: sha256(`${lane}-input-${requirement.role}`),
    };
  };
  const reconstructionRole = selectedRequirements.find(
    (requirement) => requirement.artifactClass === "source_derived_reconstruction",
  )?.role;
  if (reconstructionRole === undefined) throw new Error("Missing fixture reconstruction input");
  return {
    experimentId: `grand-hall-${lane}-001`,
    projectId: "trades-hall-grand-hall",
    createdAt: CREATED_AT,
    lane,
    providerVariant,
    providerLock: providerLock(lane, providerVariant),
    plannedExecution: {
      providerAdapterId: `${lane}-adapter`,
      providerAdapterImplementationArtifact: digestAddressedArtifact(
        `${lane}-adapter-implementation`,
        `${lane}-adapter-implementation`,
      ),
      parameterConfigurationArtifact: digestAddressedJsonArtifact(
        `${lane}-parameters`,
        `${lane}-parameters-configuration`,
      ),
      runtimeEnvironmentArtifact: digestAddressedJsonArtifact(
        `${lane}-runtime`,
        `${lane}-runtime-environment`,
      ),
      fixedCameraClosures: [{
        cameraId: camera.cameraId,
        cameraSha256: camera.cameraSha256,
        renderDerivationReceipt: createFoundryRestorationRenderDerivationReceiptV0({
          sourceReconstructionArtifact: {
            ...digestAddressedArtifact(`${lane}-source-reconstruction`, `${lane}-source-reconstruction`),
            ...inputRecord(reconstructionRole),
          },
          cameraId: camera.cameraId,
          cameraSha256: camera.cameraSha256,
          rendererProfileArtifact: {
            ...digestAddressedJsonArtifact(`${lane}-renderer-profile`, `${lane}-renderer-profile`),
            sha256: camera.rendererProfileSha256,
          },
          rendererImplementationArtifact: digestAddressedArtifact("planned-renderer-implementation", "planned-renderer-implementation"),
          rendererRuntimeArtifact: digestAddressedJsonArtifact("planned-renderer-runtime", "planned-renderer-runtime"),
          sourceRenderArtifact: {
            ...digestAddressedImageArtifact(`${lane}-source-fixed-camera-render`, `${lane}-source-fixed-camera-render`),
            ...(lane === "difix3d_plus" ? inputRecord("source_fixed_camera_render") : {}),
            mediaType: "image/png" as const,
            sha256: lane === "difix3d_plus" ? sourceRenderSha256 : sha256(`${lane}-source-fixed-camera-render`),
          },
        }),
        protectedRegionMask: {
          artifact: protectedMaskArtifact,
          maskRole: "protected_region",
          analysis: maskAnalysis(protectedMaskArtifact, "all_one"),
        },
        generatedRegionMask: {
          artifact: generatedMaskArtifact,
          maskRole: "generated_region",
          analysis: maskAnalysis(generatedMaskArtifact, "all_zero"),
        },
        protectedRegionEvaluator: {
          implementationArtifact: digestAddressedArtifact(
            `${lane}-protected-evaluator-implementation`,
            "protected-region-metrics-implementation",
          ),
          configurationArtifact: digestAddressedJsonArtifact(
            `${lane}-protected-evaluator-configuration`,
            "protected-region-metrics-configuration",
          ),
          runtimeEnvironmentArtifact: digestAddressedJsonArtifact(
            `${lane}-protected-evaluator-runtime`,
            "protected-region-metrics-runtime",
          ),
        },
        forbiddenSemanticEvaluator: {
          implementationArtifact: digestAddressedArtifact(
            `${lane}-semantic-evaluator-implementation`,
            "forbidden-semantic-detector-implementation",
          ),
          configurationArtifact: digestAddressedJsonArtifact(
            `${lane}-semantic-evaluator-configuration`,
            "forbidden-semantic-detector-configuration",
          ),
          runtimeEnvironmentArtifact: digestAddressedJsonArtifact(
            `${lane}-semantic-evaluator-runtime`,
            "forbidden-semantic-detector-runtime",
          ),
        },
      }],
    },
    operatorOptIn: {
      actorId: "grand-hall-restoration-operator",
      acceptedAt: REVIEWED_AT,
      statement: FOUNDRY_RESTORATION_OPT_IN_STATEMENT,
    },
    inputs: selectedRequirements.map((requirement, index) => {
      const preparedOutputArtifact = {
        artifactId: `${lane}-${requirement.role}-${String(index + 1)}`,
        namespace: `captured/trades-hall/grand-hall/${requirement.role}`,
        relativePath: `${requirement.role}/artifact-${String(index + 1)}.bin`,
        mediaType: requirement.mediaType,
        width: requirement.requiresImageDimensions ? camera.width : null,
        height: requirement.requiresImageDimensions ? camera.height : null,
        sizeBytes: 4_096 + index,
        sha256: sha256(`${lane}-input-${requirement.role}`),
        canonicalization: requirement.mediaType === "application/json" ? "rfc8785_json" as const : "byte_exact" as const,
        immutable: true as const, accessMode: "read_only" as const, authority: "none" as const,
      };
      const toolArtifact = (id: string, mediaType: "application/json" | "application/octet-stream") => ({
        artifactId: id, namespace: `lineage/${id}`, relativePath: `${id}/artifact.${mediaType === "application/json" ? "json" : "bin"}`,
        mediaType, width: null, height: null, sizeBytes: 512, sha256: sha256(id),
        canonicalization: mediaType === "application/json" ? "rfc8785_json" as const : "byte_exact" as const,
        immutable: true as const, accessMode: "read_only" as const, authority: "none" as const,
      });
      return {
      role: requirement.role,
      ...preparedOutputArtifact,
      immutable: true,
      accessMode: "read_only",
      truthLayer: requirement.truthLayer,
      artifactClass: requirement.artifactClass,
      preparationLineage: requirement.artifactClass === "source_derived_capture_observation"
        ? createFoundryRestorationImagePreparationReceiptV0({
          rawParentManifestArtifact: toolArtifact(`${lane}-${requirement.role}-raw-parent`, "application/json"),
          preparedOutputArtifact,
          toolImplementationArtifact: toolArtifact(`${lane}-${requirement.role}-prep-tool`, "application/octet-stream"),
          toolConfigurationArtifact: toolArtifact(`${lane}-${requirement.role}-prep-config`, "application/json"),
          toolRuntimeArtifact: toolArtifact(`${lane}-${requirement.role}-prep-runtime`, "application/json"),
          toolProcessReceiptArtifact: toolArtifact(`${lane}-${requirement.role}-prep-process`, "application/json"),
          startedAt: "2026-08-30T01:13:00.000Z", completedAt: "2026-08-30T01:13:30.000Z",
        }) : null,
      authority: "none",
    }; }),
    fixedCameras: [camera],
  };
}

function render(
  namespace: string,
  relativePath: string,
  digestSeed: string,
  digestOverride?: string,
  sizeBytes = 50_000,
) {
  return {
    namespace,
    relativePath,
    mediaType: "image/png" as const,
    sizeBytes,
    sha256: digestOverride ?? sha256(digestSeed),
    width: 1_600,
    height: 900,
  };
}

type CompiledExperiment = ReturnType<typeof compileFoundryRestorationExperimentV0>;

function executionReceipt(
  experiment: CompiledExperiment,
  candidateOutputSha256s: readonly string[],
  overrides: {
    readonly providerAdapterImplementationSha256?: string;
    readonly parameterConfigurationSha256?: string;
    readonly runtimeEnvironmentSha256?: string;
  } = {},
) {
  const lock = experiment.plannedExecutionLock;
  const hardwareInventory = createFoundryRestorationHardwareInventoryV0({
    capturedAt: "2026-08-30T01:16:30.000Z",
    inventoryCollectorImplementationSha256: sha256("hardware-inventory-collector"),
    sourceInventoryArtifactSha256: sha256("raw-hardware-inventory"),
    operatingSystem: "Linux x86_64",
    cpuModel: "Test CPU",
    logicalProcessorCount: 32,
    physicalMemoryBytes: 137_438_953_472,
    gpus: [{
      deviceOrdinal: 0,
      vendor: "NVIDIA",
      model: "Test GPU",
      dedicatedMemoryBytes: 85_899_345_920,
      driverVersion: "test-driver-1",
    }],
  });
  return createFoundryRestorationExecutionReceiptV0({
    experimentSha256: experiment.experimentSha256,
    plannedExecutionLockSha256: lock.plannedExecutionLockSha256,
    providerAdapterId: lock.providerAdapterId,
    providerAdapterImplementationSha256:
      overrides.providerAdapterImplementationSha256 ?? lock.providerAdapterImplementationArtifact.sha256,
    parameterConfigurationSha256:
      overrides.parameterConfigurationSha256 ?? lock.parameterConfigurationArtifact.sha256,
    runtimeEnvironmentSha256:
      overrides.runtimeEnvironmentSha256 ?? lock.runtimeEnvironmentArtifact.sha256,
    hardwareInventory,
    startedAt: "2026-08-30T01:16:00.000Z",
    completedAt: "2026-08-30T01:18:00.000Z",
    subjectInputSha256s: experiment.inputs.map((input) => input.sha256),
    candidateOutputSha256s: [...candidateOutputSha256s],
    providerProcessReceiptArtifactSha256: sha256("provider-process-receipt"),
  });
}

function architecturalChecklist() {
  return {
    reviewedBy: "grand-hall-human-reviewer",
    reviewedAt: "2026-08-30T01:25:00.000Z",
    checklistArtifact: digestAddressedJsonArtifact(
      "architectural-checklist",
      "architectural-checklist",
    ),
    confirmedAbsent: {
      inventedWindows: true as const,
      inventedDoorways: true as const,
      darkCentralFloor: true as const,
      neighbouringRooms: true as const,
      facade: true as const,
      generatedFillOutsideMask: true as const,
    },
  };
}

function passingObservation(
  lane: FoundryRestorationLane,
): {
  readonly experiment: ReturnType<typeof compileFoundryRestorationExperimentV0>;
  readonly observation: FoundryRestorationEvidenceObservationV0;
} {
  const experiment = compileFoundryRestorationExperimentV0(experimentInput(lane));
  const camera = experiment.fixedCameras[0];
  if (camera === undefined) throw new Error("The fixture camera is required.");
  const outputMediaType = experiment.providerProfile.allowedCandidateMediaTypes[0];
  if (outputMediaType === undefined) throw new Error("The fixture output media type is required.");
  const candidateOutput = {
    outputId: "restored-candidate-001",
    namespace: `${experiment.outputPolicy.namespace}/outputs`,
    relativePath: `outputs/candidate.${outputMediaType === "video/mp4" ? "mp4" : "bin"}`,
    mediaType: outputMediaType,
    sizeBytes: outputMediaType === "image/png" ? 50_000 : 80_000,
    sha256: sha256(`${lane}-candidate-output`),
    width: outputMediaType === "image/png" ? camera.width : null,
    height: outputMediaType === "image/png" ? camera.height : null,
    truthLayer: "GENERATED_CINEMATIC" as const,
    artifactClass: experiment.providerProfile.candidateArtifactClass,
    authority: "none" as const,
  };
  const closure = experiment.plannedExecutionLock.fixedCameraClosures[0];
  if (closure === undefined) throw new Error("The fixture camera closure is required.");
  const providerExecutionReceipt = executionReceipt(experiment, [candidateOutput.sha256]);
  const createOnlyRunnerEvidence = createFoundryRestorationCreateOnlyRunReceiptV0({
    experimentSha256: experiment.experimentSha256,
    plannedExecutionLockSha256: experiment.plannedExecutionLock.plannedExecutionLockSha256,
    executionReceiptSha256: providerExecutionReceipt.executionReceiptSha256,
    startedAt: "2026-08-30T01:16:10.000Z",
    completedAt: "2026-08-30T01:17:50.000Z",
    runnerImplementationArtifact: digestAddressedArtifact("create-only-runner", "create-only-runner"),
    runtimeEnvironmentArtifact: digestAddressedJsonArtifact("create-only-runtime", "create-only-runtime"),
    receiptArtifact: digestAddressedJsonArtifact("create-only-receipt", "create-only-receipt"),
    targets: [{
      namespace: candidateOutput.namespace, relativePath: candidateOutput.relativePath,
      absentBefore: true, createdSha256: candidateOutput.sha256,
      createdSizeBytes: candidateOutput.sizeBytes, createdMediaType: candidateOutput.mediaType,
      exactPathCreated: true,
    }],
    enforced: true,
  });
  return {
    experiment,
    observation: {
      observedAt: "2026-08-30T01:20:00.000Z",
      executionReceipt: providerExecutionReceipt,
      renderExecutionReceipts: [createFoundryRestorationRenderExecutionReceiptV0({
        experimentSha256: experiment.experimentSha256,
        plannedExecutionLockSha256: experiment.plannedExecutionLock.plannedExecutionLockSha256,
        cameraId: camera.cameraId,
        cameraSha256: camera.cameraSha256,
        sourceReconstructionArtifact: closure.renderDerivationReceipt.sourceReconstructionArtifact,
        rendererProfileArtifact: closure.renderDerivationReceipt.rendererProfileArtifact,
        rendererImplementationArtifact: closure.renderDerivationReceipt.rendererImplementationArtifact,
        rendererRuntimeArtifact: closure.renderDerivationReceipt.rendererRuntimeArtifact,
        rendererProcessReceiptArtifact: digestAddressedJsonArtifact("source-renderer-process", "source-renderer-process"),
        sourceRenderArtifact: closure.renderDerivationReceipt.sourceRenderArtifact,
        startedAt: "2026-08-30T01:15:10.000Z",
        completedAt: "2026-08-30T01:15:50.000Z",
      })],
      createOnlyRunnerEvidence,
      evaluationTools: {
        protectedRegionMetrics: {
          implementationSha256: closure.protectedRegionEvaluator.implementationArtifact.sha256,
          configurationSha256: closure.protectedRegionEvaluator.configurationArtifact.sha256,
          runtimeEnvironmentSha256: closure.protectedRegionEvaluator.runtimeEnvironmentArtifact.sha256,
        },
        forbiddenSemanticDetector: {
          implementationSha256: closure.forbiddenSemanticEvaluator.implementationArtifact.sha256,
          configurationSha256: closure.forbiddenSemanticEvaluator.configurationArtifact.sha256,
          runtimeEnvironmentSha256: closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact.sha256,
        },
      },
      candidateOutputs: [candidateOutput],
      cameraComparisons: [{
        cameraId: camera.cameraId,
        cameraSha256: camera.cameraSha256,
        subjectInputSha256s: experiment.inputs.map((input) => input.sha256),
        protectedRegionMaskSha256: closure.protectedRegionMask.artifact.sha256,
        generatedRegionMaskSha256: closure.generatedRegionMask.artifact.sha256,
        before: render(
          `${experiment.outputPolicy.namespace}/evidence/before`,
          "evidence/before/grand-hall-inspection-001.png",
          "before-render",
          closure.renderDerivationReceipt.sourceRenderArtifact.sha256,
          closure.renderDerivationReceipt.sourceRenderArtifact.sizeBytes,
        ),
        beforeSourceArtifact: closure.renderDerivationReceipt.sourceRenderArtifact,
        after: render(
          `${experiment.outputPolicy.namespace}/evidence/after`,
          "evidence/after/grand-hall-inspection-001.png",
          "after-render",
          lane === "difix3d_plus" ? candidateOutput.sha256 : undefined,
        ),
        candidateRenderReceipt: createFoundryRestorationCandidateRenderReceiptV0({
          candidateOutputSha256: candidateOutput.sha256,
          candidateOutputId: candidateOutput.outputId,
          candidateOutputNamespace: candidateOutput.namespace,
          candidateOutputRelativePath: candidateOutput.relativePath,
          candidateOutputMediaType: candidateOutput.mediaType,
          candidateOutputSizeBytes: candidateOutput.sizeBytes,
          candidateOutputWidth: candidateOutput.width,
          candidateOutputHeight: candidateOutput.height,
          candidateArtifactClass: candidateOutput.artifactClass,
          candidateTruthLayer: candidateOutput.truthLayer,
          cameraId: camera.cameraId,
          cameraSha256: camera.cameraSha256,
          rendererProfileSha256: closure.renderDerivationReceipt.rendererProfileArtifact.sha256,
          rendererImplementationArtifact: closure.renderDerivationReceipt.rendererImplementationArtifact,
          rendererRuntimeArtifact: closure.renderDerivationReceipt.rendererRuntimeArtifact,
          rendererProcessReceiptArtifact: digestAddressedJsonArtifact("candidate-renderer-process", "candidate-renderer-process"),
          startedAt: "2026-08-30T01:18:10.000Z",
          completedAt: "2026-08-30T01:18:50.000Z",
          renderedEvidenceSha256: lane === "difix3d_plus" ? candidateOutput.sha256 : sha256("after-render"),
          renderedEvidenceNamespace: `${experiment.outputPolicy.namespace}/evidence/after`,
          renderedEvidenceRelativePath: "evidence/after/grand-hall-inspection-001.png",
          renderedEvidenceSizeBytes: 50_000,
          renderedEvidenceWidth: 1_600,
          renderedEvidenceHeight: 900,
        }),
        metrics: (() => {
          const protectedBinding = {
            implementationSha256: closure.protectedRegionEvaluator.implementationArtifact.sha256,
            configurationSha256: closure.protectedRegionEvaluator.configurationArtifact.sha256,
            runtimeEnvironmentSha256: closure.protectedRegionEvaluator.runtimeEnvironmentArtifact.sha256,
            beforeSha256: closure.renderDerivationReceipt.sourceRenderArtifact.sha256,
            afterSha256: lane === "difix3d_plus" ? candidateOutput.sha256 : sha256("after-render"),
            protectedRegionMaskSha256: closure.protectedRegionMask.artifact.sha256,
            generatedRegionMaskSha256: closure.generatedRegionMask.artifact.sha256,
          };
          return {
          protectedRegion: createFoundryRestorationProtectedMetricResultV0({
            protectedRegionSsim: 0.995,
            protectedRegionLpips: 0.015,
            protectedRegionMeanAbsoluteError: 0.004,
            maximumProtectedEdgeDisplacementPixels: 0.5,
            evaluatorReceiptArtifact: digestAddressedJsonArtifact("protected-metric-receipt", "protected-metric-receipt"),
            binding: protectedBinding,
          }),
          forbiddenSemanticEvaluation: createFoundryRestorationSemanticResultV0({
            status: "evaluated",
            uncertainty: "none",
            detections: {
              invented_window: 0,
              invented_doorway: 0,
              dark_central_floor: 0,
              neighbouring_room: 0,
              facade: 0,
              generated_fill_outside_mask: 0,
            },
            evaluatorReceiptArtifact: digestAddressedJsonArtifact(
              "forbidden-semantic-evaluation-receipt",
              "forbidden-semantic-evaluation-receipt",
            ),
            binding: {
              ...protectedBinding,
              implementationSha256: closure.forbiddenSemanticEvaluator.implementationArtifact.sha256,
              configurationSha256: closure.forbiddenSemanticEvaluator.configurationArtifact.sha256,
              runtimeEnvironmentSha256: closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact.sha256,
            },
          }),
        }; })(),
      }],
    },
  };
}

describe("Foundry restoration provider profiles", () => {
  it("records the audited readiness and public capability without execution authority", () => {
    const difix = getFoundryRestorationProviderProfileV0("difix3d_plus");
    const artifixer = getFoundryRestorationProviderProfileV0("artifixer3d_plus");
    const gsfix = getFoundryRestorationProviderProfileV0("gsfix3d");
    const gr3en = getFoundryRestorationProviderProfileV0("gr3en");

    expect(difix.readiness).toMatchObject({
      status: "wait",
      scope: "single_frame_2d_internal_r_and_d",
      minimumGpuVramGiB: null,
    });
    expect(difix.repositoryRequirements[0]).toMatchObject({
      repositoryId: "nv-tlabs/Difix3D",
      revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
      officialLicenseComponents: [
        {
          componentId: "nvidia_license",
          permissionCodes: ["distribute", "prepare_derivative_works", "publicly_display", "publicly_perform", "reproduce", "sublicense", "use"],
          conditionCodes: ["conditional_redistribution", "noncommercial_research_and_evaluation_only"],
          clauseRefs: ["nvidia_section_2_1", "nvidia_section_3_1", "nvidia_section_3_3"],
        },
        {
          componentId: "stability_ai_community_license",
          licenseName: "Stability AI Community License Agreement",
          permissionCodes: ["create_derivative_works", "distribute", "modify", "reproduce", "use"],
          conditionCodes: ["acceptable_use_policy_applies", "attribution_and_notice_required", "commercial_use_registration_required", "enterprise_license_required_above_revenue_threshold", "non_sublicensable", "nontransferable", "revocable"],
          clauseRefs: ["stability_section_ii_research_and_noncommercial_use_license", "stability_section_iii_commercial_use_license", "stability_section_iv_a_distribution_and_attribution", "stability_section_iv_b_acceptable_use_policy_and_use_restrictions", "stability_section_v_definitions"],
        },
      ],
      licenseDocument: {
        relativePath: "LICENSE.txt",
        sizeBytes: 15_842,
        sha256: "sha256:b6207945851e878c5ce4aec6352f61f4741f724674d090b070cf0d468de54fa8",
      },
    });
    expect(difix.modelRequirements).toMatchObject([
      {
        modelId: "nvidia/difix",
        revision: "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388",
        access: "public",
        officialLicenseComponents: expect.any(Array),
        licenseDocument: {
          locator: "https://huggingface.co/nvidia/difix/blob/2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388/LICENSE.txt",
          relativePath: "LICENSE.txt",
          sizeBytes: 15_848,
          sha256: "sha256:e2f578631a7d4b5aff03be4489b5defbd6536c8878024720c8261a3b0eea6c1a",
        },
      },
      {
        modelId: "nvidia/difix_ref",
        revision: "d4830559772a5795c9d136302c5b197d6418d3fb",
        access: "public",
        officialLicenseComponents: expect.any(Array),
        licenseDocument: {
          locator: "https://huggingface.co/nvidia/difix_ref/blob/d4830559772a5795c9d136302c5b197d6418d3fb/LICENSE.txt",
          relativePath: "LICENSE.txt",
          sizeBytes: 15_848,
          sha256: "sha256:e2f578631a7d4b5aff03be4489b5defbd6536c8878024720c8261a3b0eea6c1a",
        },
      },
    ]);
    expect(difix.readiness.blockers).toEqual(expect.arrayContaining([
      "local_model_manifest_not_proven",
      "local_weight_file_not_proven",
      "required_input_artifacts_not_proven",
      "protected_generated_masks_not_proven",
      "runtime_environment_not_proven",
    ]));
    expect(difix.readiness.blockers).not.toEqual(expect.arrayContaining([
      "checkpoint_revision_and_digest_not_proven",
      "gated_hugging_face_token_not_proven",
    ]));
    expect(artifixer.readiness).toMatchObject({
      status: "wait",
      minimumGpuVramGiB: 80,
    });
    expect(artifixer.readiness.blockers).toEqual(expect.arrayContaining([
      "colmap_scene_not_proven",
      "three_d_grut_environment_not_proven",
    ]));
    expect(gsfix.readiness.blockers).toEqual(expect.arrayContaining([
      "standard_3dgs_checkpoint_not_proven",
      "training_cameras_not_proven",
      "noncommercial_dependency",
    ]));
    expect(gr3en.readiness).toMatchObject({
      status: "wait",
      publicCapability: "inference_video_only",
      minimumGpuVramGiB: 48,
    });
    expect(gr3en.readiness.blockers).toContain("public_3d_distillation_unreleased");
    for (const lane of FOUNDRY_RESTORATION_LANES) {
      expect(getFoundryRestorationProviderProfileV0(lane).executionPolicy).toEqual({
        dispatchAuthorized: false,
        commercialUseAllowed: false,
        publicDistributionAllowed: false,
        sourceTruthReplacementAllowed: false,
      });
    }
  });
});

describe("Foundry restoration experiment compiler", () => {
  it.each(FOUNDRY_RESTORATION_LANES)(
    "compiles %s as an opt-in, output-isolated, authority-none plan",
    (lane) => {
      const experiment = compileFoundryRestorationExperimentV0(experimentInput(lane));
      expect(experiment.outputPolicy).toEqual({
        namespace: `experiments/restoration/${experiment.experimentId}/${lane}/${experiment.providerVariant ?? "default"}`,
        createOnlyRequired: true,
        createOnlyEnforcedByThisContract: false,
        runnerEnforcementRequired: true,
        overwriteAllowed: false,
        sourceMutationAllowed: false,
        sourceTruthReplacementAllowed: false,
        automaticPromotionAllowed: false,
        runtimeRegistrationAllowed: false,
      });
      expect(experiment.authority).toBe("none");
      expect(experiment.capabilities).toEqual({
        planning: "compiled",
        execution: "not_authorized",
        dispatchEnabled: false,
        promotion: "not_recorded",
        sourceTruthReplacement: "prohibited",
      });
      expect(experiment.plannedExecutionLock).toMatchObject({
        lane,
        providerProfileSha256: experiment.providerProfile.profileSha256,
        providerLockSha256: experiment.providerLock.providerLockSha256,
        authority: "none",
        capabilities: {
          execution: "not_authorized",
          dispatchEnabled: false,
          sourceTruthReplacement: "prohibited",
        },
      });
      expect(experiment.inputs.every((input) => input.immutable)).toBe(true);
      expect(experiment.providerProfile.candidateArtifactClass).toBe(
        lane === "difix3d_plus"
          ? "restoration_candidate"
          : lane === "gr3en"
            ? "relighting_candidate"
            : "reconstruction_candidate",
      );
      expect(FoundryRestorationExperimentV0Schema.parse(experiment)).toEqual(experiment);
    },
  );

  it("rejects a mutable source and any source namespace overlapping the derived output", () => {
    const mutable = experimentInput("difix3d_plus");
    mutable.inputs[0] = { ...mutable.inputs[0]!, immutable: false };
    expect(() => compileFoundryRestorationExperimentV0(mutable)).toThrow();

    const overlapping = experimentInput("difix3d_plus");
    overlapping.inputs[0] = {
      ...overlapping.inputs[0]!,
      namespace: "experiments/restoration/grand-hall-difix3d_plus-001/difix3d_plus",
    };
    expect(() => compileFoundryRestorationExperimentV0(overlapping)).toThrow(
      /overlap/u,
    );
  });

  it("enforces each input role's truth layer and artifact class and rejects generated input", () => {
    const mislabelledRender = experimentInput("difix3d_plus");
    const renderIndex = mislabelledRender.inputs.findIndex(
      (input) => input.role === "source_fixed_camera_render",
    );
    expect(renderIndex).toBeGreaterThanOrEqual(0);
    mislabelledRender.inputs[renderIndex] = {
      ...mislabelledRender.inputs[renderIndex]!,
      artifactClass: "captured_observation",
    };
    expect(() => compileFoundryRestorationExperimentV0(mislabelledRender)).toThrow(
      /truth layer and artifact class/u,
    );

    const capturedReference = experimentInput("difix3d_plus").inputs.find(
      (input) => input.role === "captured_reference_image",
    );
    expect(capturedReference).toBeDefined();
    expect(FoundryRestorationInputCandidateV0Schema.safeParse({
      ...capturedReference,
      truthLayer: "GENERATED_CINEMATIC",
      artifactClass: "generated_cinematic",
    }).success).toBe(false);
  });

  it("locks each Difix variant to only its checkpoint and corresponding input roles", () => {
    const difix = compileFoundryRestorationExperimentV0(
      experimentInput("difix3d_plus", "difix"),
    );
    const difixRef = compileFoundryRestorationExperimentV0(
      experimentInput("difix3d_plus", "difix_ref"),
    );
    expect(difix.providerLock.models.map((model) => model.role)).toEqual([
      "difix_checkpoint",
    ]);
    expect(difix.inputs.map((input) => input.role)).toEqual([
      "source_fixed_camera_render",
      "source_reconstruction",
    ]);
    expect(difixRef.providerLock.models.map((model) => model.role)).toEqual([
      "difix_ref_checkpoint",
    ]);
    expect(difixRef.inputs.map((input) => input.role)).toEqual([
      "captured_reference_image",
      "source_fixed_camera_render",
      "source_reconstruction",
    ]);
  });

  it("binds reconstruction lineage exactly and marks prepared image sets as source-derived", () => {
    const input = experimentInput("difix3d_plus");
    const closure = input.plannedExecution.fixedCameraClosures[0]!;
    input.plannedExecution.fixedCameraClosures[0] = {
      ...closure,
      renderDerivationReceipt: createFoundryRestorationRenderDerivationReceiptV0({
        sourceReconstructionArtifact: {
          ...closure.renderDerivationReceipt.sourceReconstructionArtifact,
          relativePath: "substituted/reconstruction.bin",
        },
        cameraId: closure.renderDerivationReceipt.cameraId,
        cameraSha256: closure.renderDerivationReceipt.cameraSha256,
        rendererProfileArtifact: closure.renderDerivationReceipt.rendererProfileArtifact,
        rendererImplementationArtifact: closure.renderDerivationReceipt.rendererImplementationArtifact,
        rendererRuntimeArtifact: closure.renderDerivationReceipt.rendererRuntimeArtifact,
        sourceRenderArtifact: closure.renderDerivationReceipt.sourceRenderArtifact,
      }),
    };
    expect(() => compileFoundryRestorationExperimentV0(input)).toThrow(/exact immutable source reconstruction/u);

    for (const lane of ["artifixer3d_plus", "gsfix3d"] as const) {
      const compiled = compileFoundryRestorationExperimentV0(experimentInput(lane));
      const prepared = compiled.inputs.find((candidate) => candidate.artifactClass === "source_derived_capture_observation")!;
      expect(prepared).toMatchObject({
        truthLayer: "SOURCE_DERIVED_TRUTH",
        preparationLineage: {
          imagePreparationReceiptSha256: expect.stringMatching(/^sha256:/u),
          rawParentManifestArtifact: { sha256: expect.stringMatching(/^sha256:/u) },
          preparedOutputArtifact: { sha256: prepared.sha256 },
        },
      });
    }
    const preparedInput = experimentInput("artifixer3d_plus");
    const preparedIndex = preparedInput.inputs.findIndex((candidate) => candidate.artifactClass === "source_derived_capture_observation");
    const preparedCandidate = preparedInput.inputs[preparedIndex]!;
    preparedInput.inputs[preparedIndex] = {
      ...preparedCandidate,
      preparationLineage: {
        ...preparedCandidate.preparationLineage!,
        preparedOutputArtifact: {
          ...preparedCandidate.preparationLineage!.preparedOutputArtifact,
          sizeBytes: preparedCandidate.sizeBytes + 1,
        },
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(preparedInput)).toThrow();

    const futurePreparedInput = experimentInput("artifixer3d_plus");
    const futurePreparedIndex = futurePreparedInput.inputs.findIndex((candidate) => candidate.artifactClass === "source_derived_capture_observation");
    const futurePrepared = futurePreparedInput.inputs[futurePreparedIndex]!;
    const {
      schemaVersion: _preparationSchemaVersion,
      imagePreparationReceiptSha256: _preparationSha256,
      authority: _preparationAuthority,
      ...preparationPayload
    } = futurePrepared.preparationLineage!;
    futurePreparedInput.inputs[futurePreparedIndex] = {
      ...futurePrepared,
      preparationLineage: createFoundryRestorationImagePreparationReceiptV0({
        ...preparationPayload,
        startedAt: "2026-08-30T01:14:50.000Z",
        completedAt: "2026-08-30T01:15:01.000Z",
      }),
    };
    expect(() => compileFoundryRestorationExperimentV0(futurePreparedInput)).toThrow(/cannot complete after experiment compilation/u);
  });

  it("keeps ordered composite licence facts separate from the reviewed noncommercial posture", () => {
    const input = experimentInput("difix3d_plus");
    const repository = input.providerLock.repositories[0]!;
    input.providerLock.repositories[0] = {
      ...repository,
      licenseEvidence: {
        ...repository.licenseEvidence,
        officialLicenseFacts: {
          ...repository.licenseEvidence.officialLicenseFacts,
          components: [{
            componentId: "merged_false_license", licenseName: repository.licenseEvidence.projectPolicyReview.reviewedUsePosture,
            scope: "merged_false_scope", permissionCodes: ["use"], conditionCodes: ["no_distribution"], clauseRefs: ["merged_false_clause"],
          }],
        },
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(input)).toThrow(
      /licence components/u,
    );

    const emptyFacts = experimentInput("difix3d_plus");
    const model = emptyFacts.providerLock.models[0]!;
    emptyFacts.providerLock.models[0] = {
      ...model,
      licenseEvidence: {
        ...model.licenseEvidence,
        officialLicenseFacts: {
          ...model.licenseEvidence.officialLicenseFacts,
          components: model.licenseEvidence.officialLicenseFacts.components.map((component, index) =>
            index === 0 ? { ...component, permissionCodes: [] } : component,
          ),
        },
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(emptyFacts)).toThrow();

    const wrongStabilityMap = experimentInput("difix3d_plus");
    const stabilityModel = wrongStabilityMap.providerLock.models[0]!;
    wrongStabilityMap.providerLock.models[0] = {
      ...stabilityModel,
      licenseEvidence: {
        ...stabilityModel.licenseEvidence,
        officialLicenseFacts: {
          ...stabilityModel.licenseEvidence.officialLicenseFacts,
          components: stabilityModel.licenseEvidence.officialLicenseFacts.components.map((component) =>
            component.componentId === "stability_ai_community_license"
              ? {
                ...component,
                conditionCodes: component.conditionCodes.filter((code) => code !== "commercial_use_registration_required"),
                clauseRefs: ["stability_section_ii_distribution", "stability_section_iii_commercial_use_license", "stability_section_iv_commercial_use", "stability_section_v_acceptable_use_policy"],
              }
              : component,
          ),
        },
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(wrongStabilityMap)).toThrow(/licence components/u);

    const rawLock = providerLock("difix3d_plus");
    const rawRepository = rawLock.repositories[0]!;
    expect(FoundryRestorationProviderLockPayloadV0Schema.safeParse({
      ...rawLock,
      repositories: [{
        ...rawRepository,
        licenseEvidence: {
          ...rawRepository.licenseEvidence,
          officialLicenseFacts: {
            ...rawRepository.licenseEvidence.officialLicenseFacts,
            components: [{
              componentId: "merged_false_license", licenseName: "noncommercial_internal_r_and_d_only",
              scope: "merged_false_scope", permissionCodes: ["use"], conditionCodes: ["no_distribution"], clauseRefs: ["merged_false_clause"],
            }],
          },
          projectPolicyReview: {
            ...rawRepository.licenseEvidence.projectPolicyReview,
            reviewedUsePosture: "NVIDIA License",
          },
        },
      }],
    }).success).toBe(false);
  });

  it("rejects an unpinned checkpoint and a provider identity that disagrees with a known pin", () => {
    const missingWeight = experimentInput("difix3d_plus");
    missingWeight.providerLock.models[0] = {
      ...missingWeight.providerLock.models[0]!,
      weights: [],
    };
    expect(() => compileFoundryRestorationExperimentV0(missingWeight)).toThrow();

    const wrongRepository = experimentInput("difix3d_plus");
    wrongRepository.providerLock.repositories[0] = {
      ...wrongRepository.providerLock.repositories[0]!,
      revision: revision(999),
    };
    expect(() => compileFoundryRestorationExperimentV0(wrongRepository)).toThrow(
      /repository revision/u,
    );

    const unknownProfile = getFoundryRestorationProviderProfileV0("artifixer3d_plus");
    expect(unknownProfile.repositoryRequirements[0]?.revision).toBeNull();
    expect(unknownProfile.modelRequirements[0]?.revision).toBeNull();
    const rawLock = providerLock("artifixer3d_plus");
    expect(FoundryRestorationProviderLockPayloadV0Schema.safeParse({
      ...rawLock,
      models: rawLock.models.map((model) => ({ ...model, revision: null })),
    }).success).toBe(false);
  });
});

describe("Foundry restoration evidence and promotion", () => {
  it("rejects tampered observed render, candidate-render, runner, and mask-analysis receipts", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    expect(FoundryRestorationEvidenceObservationV0Schema.safeParse({
      ...observation,
      renderExecutionReceipts: [{
        ...observation.renderExecutionReceipts[0]!,
        completedAt: "2026-08-30T01:15:51.000Z",
      }],
    }).success).toBe(false);
    const originalCandidateReceipt = observation.cameraComparisons[0]!.candidateRenderReceipt;
    const {
      schemaVersion: _schemaVersion,
      candidateRenderReceiptSha256: _candidateRenderReceiptSha256,
      authority: _authority,
      ...candidateReceiptPayload
    } = originalCandidateReceipt;
    const earlyCandidateReceipt = createFoundryRestorationCandidateRenderReceiptV0({
      ...candidateReceiptPayload,
      startedAt: "2026-08-30T01:17:55.000Z",
      completedAt: "2026-08-30T01:18:05.000Z",
    });
    expect(() => evaluateFoundryRestorationEvidenceV0({
      experiment,
      observation: {
        ...observation,
        cameraComparisons: [{ ...observation.cameraComparisons[0]!, candidateRenderReceipt: earlyCandidateReceipt }],
      },
    })).toThrow(/candidate render/u);
    const comparison = observation.cameraComparisons[0]!;
    expect(FoundryRestorationEvidenceObservationV0Schema.safeParse({
      ...observation,
      cameraComparisons: [{
        ...comparison,
        candidateRenderReceipt: {
          ...comparison.candidateRenderReceipt,
          rendererProfileSha256: sha256("other-renderer-profile"),
        },
      }],
    }).success).toBe(false);
    const input = experimentInput("difix3d_plus");
    const closure = input.plannedExecution.fixedCameraClosures[0]!;
    input.plannedExecution.fixedCameraClosures[0] = {
      ...closure,
      protectedRegionMask: {
        ...closure.protectedRegionMask,
        analysis: {
          ...closure.protectedRegionMask.analysis,
          onePixelCount: closure.protectedRegionMask.analysis.onePixelCount - 1,
        },
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(input)).toThrow();

    const futureMaskInput = experimentInput("difix3d_plus");
    const futureClosure = futureMaskInput.plannedExecution.fixedCameraClosures[0]!;
    const {
      maskAnalysisReceiptSha256: _maskAnalysisSha256,
      ...maskAnalysisPayload
    } = futureClosure.protectedRegionMask.analysis;
    futureMaskInput.plannedExecution.fixedCameraClosures[0] = {
      ...futureClosure,
      protectedRegionMask: {
        ...futureClosure.protectedRegionMask,
        analysis: createFoundryRestorationMaskAnalysisReceiptV0({
          ...maskAnalysisPayload,
          startedAt: "2026-08-30T01:14:50.000Z",
          completedAt: "2026-08-30T01:15:01.000Z",
        }),
      },
    };
    expect(() => compileFoundryRestorationExperimentV0(futureMaskInput)).toThrow(/cannot complete after experiment compilation/u);
  });
  it("rejects substituted source/candidate renders, evaluator results, and create-only targets", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const comparison = observation.cameraComparisons[0]!;
    const substitutedBefore = {
      ...observation,
      cameraComparisons: [{ ...comparison, before: { ...comparison.before, sha256: sha256("substituted-before") } }],
    };
    expect(() => evaluateFoundryRestorationEvidenceV0({ experiment, observation: substitutedBefore })).toThrow(/planned execution lock/u);

    const substitutedTarget = {
      ...observation,
      createOnlyRunnerEvidence: {
        ...observation.createOnlyRunnerEvidence,
        targets: observation.createOnlyRunnerEvidence.targets.map((target) => ({
          ...target,
          createdSha256: sha256("substituted-created-target"),
        })),
      },
    };
    expect(() => evaluateFoundryRestorationEvidenceV0({ experiment, observation: substitutedTarget })).toThrow(/create-only run/u);

    expect(FoundryRestorationEvidenceObservationV0Schema.safeParse({
      ...observation,
      cameraComparisons: [{
        ...comparison,
        metrics: {
          ...comparison.metrics,
          protectedRegion: {
            ...comparison.metrics.protectedRegion,
            protectedRegionSsim: 0.1,
          },
        },
      }],
    }).success).toBe(false);
  });

  it("rejects media/canonicalization contradictions and unreviewed provider identities", () => {
    const { observation } = passingObservation("difix3d_plus");
    expect(FoundryRestorationEvidenceObservationV0Schema.safeParse({
      ...observation,
      createOnlyRunnerEvidence: {
        ...observation.createOnlyRunnerEvidence,
        runtimeEnvironmentArtifact: {
          ...observation.createOnlyRunnerEvidence.runtimeEnvironmentArtifact,
          canonicalization: "byte_exact",
        },
      },
    }).success).toBe(false);

    const artifixer = compileFoundryRestorationExperimentV0(experimentInput("artifixer3d_plus"));
    expect(artifixer.providerLock.exactOfficialIdentityReviewed).toBe(false);
    const artObservation = passingObservation("artifixer3d_plus").observation;
    expect(() => evaluateFoundryRestorationEvidenceV0({ experiment: artifixer, observation: artObservation })).toThrow();
  });
  it("binds fixed-camera before/after evidence and passes conservative automatic gates", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const evidence = evaluateFoundryRestorationEvidenceV0({ experiment, observation });
    expect(evidence.automaticGates).toMatchObject({
      executionReceiptBindingPassed: true,
      fixedCameraIdentityPassed: true,
      matchingDimensionsPassed: true,
      exactInputSetPassed: true,
      outputIsolationPassed: true,
      protectedRegionFidelityPassed: true,
      forbiddenSemanticDetectionsPassed: true,
      allAutomaticGatesPassed: true,
    });
    expect(evidence.promotionState).toBe("not_promoted");
    expect(evidence.sourceTruthReplacementAllowed).toBe(false);
    expect(FoundryRestorationEvidenceV0Schema.parse(evidence)).toEqual(evidence);
  });

  it("refuses adapter, parameter, or runtime evidence that disagrees with the planned execution lock", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const mismatchOverrides = [
      { providerAdapterImplementationSha256: sha256("wrong-adapter") },
      { parameterConfigurationSha256: sha256("wrong-parameters") },
      { runtimeEnvironmentSha256: sha256("wrong-runtime") },
    ];
    for (const overrides of mismatchOverrides) {
      const mismatchedReceipt = executionReceipt(
        experiment,
        observation.candidateOutputs.map((output) => output.sha256),
        overrides,
      );
      expect(() => evaluateFoundryRestorationEvidenceV0({
        experiment,
        observation: { ...observation, executionReceipt: mismatchedReceipt },
      })).toThrow(/planned execution lock/u);
    }
  });

  it("pre-binds fixed camera, renderer, reconstruction, masks, and evaluator artifacts", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const closure = experiment.plannedExecutionLock.fixedCameraClosures[0]!;
    const sourceRender = experiment.inputs.find(
      (input) => input.role === "source_fixed_camera_render",
    )!;
    expect(closure).toMatchObject({
      cameraSha256: experiment.fixedCameras[0]?.cameraSha256,
      renderDerivationReceipt: {
        cameraSha256: experiment.fixedCameras[0]?.cameraSha256,
        rendererProfileArtifact: {
          sha256: experiment.fixedCameras[0]?.rendererProfileSha256,
        },
        sourceRenderArtifact: {
          sha256: sourceRender.sha256,
          canonicalization: "byte_exact",
          mediaType: "image/png",
          width: 1_600,
          height: 900,
        },
      },
    });
    expect(closure.protectedRegionEvaluator.configurationArtifact).toMatchObject({
      mediaType: "application/json",
      canonicalization: "rfc8785_json",
    });
    const comparison = observation.cameraComparisons[0]!;
    expect(() => evaluateFoundryRestorationEvidenceV0({
      experiment,
      observation: {
        ...observation,
        cameraComparisons: [{
          ...comparison,
          protectedRegionMaskSha256: sha256("post-hoc-mask-substitution"),
        }],
      },
    })).toThrow(/planned execution lock/u);
  });

  it("hash-binds the observed hardware and execution receipt and rejects duplicate outputs", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const evidence = evaluateFoundryRestorationEvidenceV0({ experiment, observation });
    expect(evidence.executionReceipt).toMatchObject({
      experimentSha256: experiment.experimentSha256,
      plannedExecutionLockSha256: experiment.plannedExecutionLock.plannedExecutionLockSha256,
      authority: "none",
      sourceTruthReplacementAllowed: false,
    });
    expect(evidence.executionReceipt.hardwareInventory.hardwareInventorySha256).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(FoundryRestorationEvidenceV0Schema.safeParse({
      ...evidence,
      executionReceipt: {
        ...evidence.executionReceipt,
        hardwareInventory: {
          ...evidence.executionReceipt.hardwareInventory,
          physicalMemoryBytes: evidence.executionReceipt.hardwareInventory.physicalMemoryBytes + 1,
        },
      },
    }).success).toBe(false);

    const original = observation.candidateOutputs[0]!;
    const duplicateVariants = [
      { ...original, sha256: sha256("other-output-a"), relativePath: "outputs/other-a.bin" },
      { ...original, outputId: "restored-candidate-002", relativePath: "outputs/other-b.bin" },
      { ...original, outputId: "restored-candidate-003", sha256: sha256("other-output-c") },
    ];
    for (const duplicate of duplicateVariants) {
      expect(FoundryRestorationEvidenceObservationV0Schema.safeParse({
        ...observation,
        candidateOutputs: [original, duplicate],
      }).success).toBe(false);
    }
  });

  it("records an out-of-memory attempt truthfully but refuses it as success evidence", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const {
      schemaVersion: _schemaVersion,
      executionReceiptSha256: _executionReceiptSha256,
      authority: _authority,
      sourceTruthReplacementAllowed: _sourceTruthReplacementAllowed,
      ...receiptInput
    } = observation.executionReceipt;
    const outOfMemory = createFoundryRestorationAttemptReceiptV0({
      ...receiptInput,
      candidateOutputSha256s: [],
      outcome: "out_of_memory",
      exitCode: null,
      failureCode: "cuda_out_of_memory",
    });
    expect(outOfMemory).toMatchObject({
      outcome: "out_of_memory",
      failureCode: "cuda_out_of_memory",
      authority: "none",
      sourceTruthReplacementAllowed: false,
    });
    expect(createFoundryRestorationAttemptReceiptV0({
      ...receiptInput,
      candidateOutputSha256s: [],
      outcome: "out_of_memory",
      exitCode: 137,
      failureCode: "cuda_out_of_memory",
    }).exitCode).toBe(137);
    expect(() => createFoundryRestorationAttemptReceiptV0({
      ...receiptInput,
      candidateOutputSha256s: [],
      outcome: "out_of_memory",
      exitCode: 0,
      failureCode: "cuda_out_of_memory",
    })).toThrow(/null or nonzero/u);
    expect(() => evaluateFoundryRestorationEvidenceV0({
      experiment,
      observation: { ...observation, executionReceipt: outOfMemory },
    })).toThrow(/planned execution lock/u);
  });

  it("treats unavailable semantic evaluation as unknown rather than zero detections", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const comparison = observation.cameraComparisons[0]!;
    const evidence = evaluateFoundryRestorationEvidenceV0({
      experiment,
      observation: {
        ...observation,
        cameraComparisons: [{
          ...comparison,
          metrics: {
            ...comparison.metrics,
            forbiddenSemanticEvaluation: createFoundryRestorationSemanticResultV0({
              status: "not_evaluated",
              uncertainty: "unknown",
              detections: null,
              evaluatorReceiptArtifact: null,
              binding: comparison.metrics.forbiddenSemanticEvaluation.binding,
            }),
          },
        }],
      },
    });
    expect(evidence.automaticGates).toMatchObject({
      forbiddenSemanticDetectionsPassed: false,
      allAutomaticGatesPassed: false,
    });
  });

  it("records fidelity failure when generated content escapes its mask or protected pixels drift", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const comparison = observation.cameraComparisons[0]!;
    const failedObservation: FoundryRestorationEvidenceObservationV0 = {
      ...observation,
      cameraComparisons: [{
        ...comparison,
        metrics: {
          ...comparison.metrics,
          protectedRegion: createFoundryRestorationProtectedMetricResultV0({
            protectedRegionSsim: 0.8,
            protectedRegionLpips: comparison.metrics.protectedRegion.protectedRegionLpips,
            protectedRegionMeanAbsoluteError: comparison.metrics.protectedRegion.protectedRegionMeanAbsoluteError,
            maximumProtectedEdgeDisplacementPixels: comparison.metrics.protectedRegion.maximumProtectedEdgeDisplacementPixels,
            evaluatorReceiptArtifact: comparison.metrics.protectedRegion.evaluatorReceiptArtifact,
            binding: comparison.metrics.protectedRegion.binding,
          }),
          forbiddenSemanticEvaluation: createFoundryRestorationSemanticResultV0({
            status: comparison.metrics.forbiddenSemanticEvaluation.status,
            uncertainty: comparison.metrics.forbiddenSemanticEvaluation.uncertainty,
            evaluatorReceiptArtifact: comparison.metrics.forbiddenSemanticEvaluation.evaluatorReceiptArtifact,
            binding: comparison.metrics.forbiddenSemanticEvaluation.binding,
            detections: {
              ...comparison.metrics.forbiddenSemanticEvaluation.detections!,
              invented_window: 1,
            },
          }),
        },
      }],
    };
    const evidence = evaluateFoundryRestorationEvidenceV0({
      experiment,
      observation: failedObservation,
    });
    expect(evidence.automaticGates).toMatchObject({
      protectedRegionFidelityPassed: false,
      forbiddenSemanticDetectionsPassed: false,
      allAutomaticGatesPassed: false,
    });
    expect(() => promoteFoundryRestorationCinematicDerivativeV0({
      evidence,
      promotedBy: "grand-hall-human-reviewer",
      promotedAt: "2026-08-30T01:30:00.000Z",
      statement: FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
      candidateOutputSha256s: evidence.candidateOutputs.map((output) => output.sha256),
      architecturalChecklist: architecturalChecklist(),
    })).toThrow(/automatic fidelity gates/u);
  });

  it("requires an explicit human record and promotes only the cinematic derivative", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const evidence = evaluateFoundryRestorationEvidenceV0({ experiment, observation });
    expect(() => promoteFoundryRestorationCinematicDerivativeV0({
      evidence,
      promotedBy: "grand-hall-human-reviewer",
      promotedAt: "2026-08-30T01:30:00.000Z",
      statement: "Promote the result.",
      candidateOutputSha256s: evidence.candidateOutputs.map((output) => output.sha256),
      architecturalChecklist: architecturalChecklist(),
    })).toThrow();

    expect(() => promoteFoundryRestorationCinematicDerivativeV0({
      evidence,
      promotedBy: "grand-hall-human-reviewer",
      promotedAt: "2026-08-30T01:30:00.000Z",
      statement: FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
      candidateOutputSha256s: evidence.candidateOutputs.map((output) => output.sha256),
      architecturalChecklist: {
        ...architecturalChecklist(),
        reviewedBy: "different-reviewer",
      },
    })).toThrow(/architectural checklist/u);

    const promotion = promoteFoundryRestorationCinematicDerivativeV0({
      evidence,
      promotedBy: "grand-hall-human-reviewer",
      promotedAt: "2026-08-30T01:30:00.000Z",
      statement: FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
      candidateOutputSha256s: evidence.candidateOutputs.map((output) => output.sha256),
      architecturalChecklist: architecturalChecklist(),
    });
    expect(promotion).toMatchObject({
      promotionScope: "generated_cinematic_derivative_only",
      sourceTruthReplacementAllowed: false,
      measuredGeometryAuthorityGranted: false,
      planningAuthorityGranted: false,
      operationalExportAuthorityGranted: false,
      authority: "human_promotion_record_only",
    });
  });

  it("rejects digest-tampered evidence", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const evidence = evaluateFoundryRestorationEvidenceV0({ experiment, observation });
    expect(FoundryRestorationEvidenceV0Schema.safeParse({
      ...evidence,
      evidenceSha256: sha256("tampered-evidence"),
    }).success).toBe(false);
  });
});

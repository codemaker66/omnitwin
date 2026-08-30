import { describe, expect, it } from "vitest";
import {
  FOUNDRY_RESTORATION_LANES,
  FOUNDRY_RESTORATION_OPT_IN_STATEMENT,
  FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
  FoundryRestorationEvidenceObservationV0Schema,
  FoundryRestorationEvidenceV0Schema,
  FoundryRestorationExperimentV0Schema,
  FoundryRestorationProviderLockPayloadV0Schema,
  compileFoundryRestorationExperimentV0,
  createFoundryRestorationExecutionReceiptV0,
  createFoundryRestorationFixedCameraV0,
  createFoundryRestorationHardwareInventoryV0,
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

function providerLock(
  lane: FoundryRestorationLane,
): FoundryRestorationProviderLockPayloadV0 {
  const profile = getFoundryRestorationProviderProfileV0(lane);
  return {
    lane,
    reviewedBy: "foundry-integrity-reviewer",
    reviewedAt: REVIEWED_AT,
    exactOfficialIdentityReviewed: true,
    repositories: profile.repositoryRequirements.map((requirement, index) => ({
      role: requirement.role,
      repositoryId:
        requirement.repositoryId ?? `reviewed-upstream/${lane}-${requirement.role}`,
      revision: requirement.revision ?? revision(index + 100),
      sourceArchiveSha256: sha256(`${lane}-repository-${requirement.role}`),
      licenseEvidence: {
        declaredLicense: requirement.licensePosture,
        documentSha256: sha256(`${lane}-repository-license-${requirement.role}`),
        reviewedBy: "foundry-licence-reviewer",
        reviewedAt: REVIEWED_AT,
        internalResearchAndDevelopmentOnly: true,
        commercialUseAllowed: false,
        redistributionAllowed: false,
      },
    })),
    models: profile.modelRequirements.map((requirement, index) => ({
      role: requirement.role,
      modelId:
        requirement.modelId ?? `reviewed-upstream/${lane}-${requirement.role}`,
      revision: revision(index + 200),
      repositoryManifestSha256: sha256(`${lane}-model-${requirement.role}`),
      access: requirement.access,
      licenseEvidence: {
        declaredLicense: requirement.licensePosture,
        documentSha256: sha256(`${lane}-model-license-${requirement.role}`),
        reviewedBy: "foundry-licence-reviewer",
        reviewedAt: REVIEWED_AT,
        internalResearchAndDevelopmentOnly: true,
        commercialUseAllowed: false,
        redistributionAllowed: false,
      },
      weights: [{
        relativePath: `${requirement.role}/model.safetensors`,
        sizeBytes: 1_024 + index,
        sha256: sha256(`${lane}-weight-${requirement.role}`),
      }],
    })),
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
    immutable: true as const,
    accessMode: "read_only" as const,
    authority: "none" as const,
  };
}

function experimentInput(
  lane: FoundryRestorationLane,
): CompileFoundryRestorationExperimentV0Input {
  const profile = getFoundryRestorationProviderProfileV0(lane);
  return {
    experimentId: `grand-hall-${lane}-001`,
    projectId: "trades-hall-grand-hall",
    createdAt: CREATED_AT,
    lane,
    providerLock: providerLock(lane),
    plannedExecution: {
      providerAdapterId: `${lane}-adapter`,
      providerAdapterImplementationSha256: sha256(`${lane}-adapter-implementation`),
      parameterConfigurationArtifact: digestAddressedJsonArtifact(
        `${lane}-parameters`,
        `${lane}-parameters-configuration`,
      ),
      runtimeEnvironmentArtifact: digestAddressedJsonArtifact(
        `${lane}-runtime`,
        `${lane}-runtime-environment`,
      ),
    },
    operatorOptIn: {
      actorId: "grand-hall-restoration-operator",
      acceptedAt: REVIEWED_AT,
      statement: FOUNDRY_RESTORATION_OPT_IN_STATEMENT,
    },
    inputs: profile.requiredInputRoles.map((role, index) => ({
      role,
      artifactId: `${lane}-${role}-${String(index + 1)}`,
      namespace: `captured/trades-hall/grand-hall/${role}`,
      relativePath: `${role}/artifact-${String(index + 1)}.bin`,
      mediaType: "application/octet-stream",
      sizeBytes: 4_096 + index,
      sha256: sha256(`${lane}-input-${role}`),
      immutable: true,
      accessMode: "read_only",
      truthClass: "captured_source_truth",
    })),
    fixedCameras: [fixedCamera()],
  };
}

function render(
  namespace: string,
  relativePath: string,
  digestSeed: string,
) {
  return {
    namespace,
    relativePath,
    mediaType: "image/png" as const,
    sizeBytes: 50_000,
    sha256: sha256(digestSeed),
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
      overrides.providerAdapterImplementationSha256 ?? lock.providerAdapterImplementationSha256,
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
    sizeBytes: 80_000,
    sha256: sha256(`${lane}-candidate-output`),
    truthClass: "generated_cinematic" as const,
    authority: "none" as const,
  };
  return {
    experiment,
    observation: {
      observedAt: "2026-08-30T01:20:00.000Z",
      executionReceipt: executionReceipt(experiment, [candidateOutput.sha256]),
      evaluationTools: {
        protectedRegionMetrics: {
          implementationSha256: sha256("protected-region-metrics-implementation"),
          configurationSha256: sha256("protected-region-metrics-configuration"),
          runtimeEnvironmentSha256: sha256("protected-region-metrics-runtime"),
        },
        forbiddenSemanticDetector: {
          implementationSha256: sha256("forbidden-semantic-detector-implementation"),
          configurationSha256: sha256("forbidden-semantic-detector-configuration"),
          runtimeEnvironmentSha256: sha256("forbidden-semantic-detector-runtime"),
        },
      },
      candidateOutputs: [candidateOutput],
      cameraComparisons: [{
        cameraId: camera.cameraId,
        cameraSha256: camera.cameraSha256,
        subjectInputSha256s: experiment.inputs.map((input) => input.sha256),
        protectedRegionMaskSha256: sha256("protected-region-mask"),
        generatedRegionMaskSha256: sha256("generated-region-mask"),
        before: render(
          `${experiment.outputPolicy.namespace}/evidence/before`,
          "evidence/before/grand-hall-inspection-001.png",
          "before-render",
        ),
        after: render(
          `${experiment.outputPolicy.namespace}/evidence/after`,
          "evidence/after/grand-hall-inspection-001.png",
          "after-render",
        ),
        metrics: {
          protectedRegionSsim: 0.995,
          protectedRegionLpips: 0.015,
          protectedRegionMeanAbsoluteError: 0.004,
          maximumProtectedEdgeDisplacementPixels: 0.5,
          forbiddenSemanticDetections: {
            invented_window: 0,
            invented_doorway: 0,
            dark_central_floor: 0,
            neighbouring_room: 0,
            facade: 0,
            generated_fill_outside_mask: 0,
          },
        },
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
      status: "diagnostic_go",
      scope: "single_frame_2d_internal_r_and_d",
      minimumGpuVramGiB: null,
    });
    expect(difix.repositoryRequirements[0]).toMatchObject({
      repositoryId: "nv-tlabs/Difix3D",
      revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
    });
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
        namespace: `experiments/restoration/${experiment.experimentId}/${lane}`,
        createOnly: true,
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

  it("records fidelity failure when generated content escapes its mask or protected pixels drift", () => {
    const { experiment, observation } = passingObservation("difix3d_plus");
    const comparison = observation.cameraComparisons[0]!;
    const failedObservation: FoundryRestorationEvidenceObservationV0 = {
      ...observation,
      cameraComparisons: [{
        ...comparison,
        metrics: {
          ...comparison.metrics,
          protectedRegionSsim: 0.8,
          forbiddenSemanticDetections: {
            ...comparison.metrics.forbiddenSemanticDetections,
            invented_window: 1,
          },
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
    })).toThrow();

    const promotion = promoteFoundryRestorationCinematicDerivativeV0({
      evidence,
      promotedBy: "grand-hall-human-reviewer",
      promotedAt: "2026-08-30T01:30:00.000Z",
      statement: FOUNDRY_RESTORATION_PROMOTION_STATEMENT,
      candidateOutputSha256s: evidence.candidateOutputs.map((output) => output.sha256),
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

import {
  verifyFoundryLocalE57IntakeEnvironmentV0,
  type FoundryLocalE57IntakeEnvironmentV0,
} from "@omnitwin/reconstruction-foundry";
import { LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_DOCUMENT } from "./local-e57-intake-environment.generated.js";

export const LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_V0 =
  "omnitwin.local-foundry.local-e57-intake-environment-readiness.v0";
export const LOCAL_E57_RUNTIME_BUNDLE_FOLLOW_UP_V0 =
  "omnitwin.local-foundry.local-e57-runtime-bundle-follow-up.v0";

export interface LocalE57IntakeEnvironmentReadinessDtoV0 {
  readonly schemaVersion: typeof LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_V0;
  readonly environmentSha256: string;
  readonly parentHdWorkerManifestSha256: string;
  readonly overall:
    "exact_artifacts_recorded_bundle_not_materialized_not_execution_ready";
  readonly environmentState:
    "recorded_with_materialization_and_runtime_closure_open";
  readonly installationState: "not_installed";
  readonly bundleVerificationState: "not_performed";
  readonly binding: "not_bound_to_current_source_or_plan";
  readonly execution: "disabled";
  readonly authority: "none";
  readonly target: {
    readonly operatingSystem: "windows";
    readonly architecture: "x64";
    readonly pythonVersion: "3.13.14";
    readonly pythonAbi: "cp313";
    readonly laneScope: "e57_read_only_intake_only";
    readonly parentE57CandidateDisposition: "superseded_by_this_environment";
    readonly unifiedWithOpen3d: false;
  };
  readonly summary: {
    readonly artifactCount: 4;
    readonly dependencyEdgeCount: 3;
    readonly pye57MemberCount: 13;
    readonly legalMaterialCount: number;
    readonly openItemCount: 6;
  };
  readonly activity: {
    readonly packageInstallerUsed: false;
    readonly systemInstallationPerformed: false;
    readonly isolatedArchiveExtractionPerformed: true;
    readonly isolatedSyntheticCompatibilitySmokePerformed: true;
    readonly venueDataAccessed: false;
    readonly userProvidedSourceFileRead: false;
    readonly syntheticFixtureFileRead: true;
    readonly cloudWorkloadStarted: false;
  };
  readonly artifacts: readonly {
    readonly id:
      | "cpython-runtime"
      | "pye57-wheel"
      | "numpy-wheel"
      | "pyquaternion-wheel";
    readonly packageName: string;
    readonly version: string;
    readonly filename: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly pythonTag: "cp313" | "py3" | "not_applicable";
    readonly abiTag: "cp313" | "none" | "not_applicable";
    readonly platformTag: "win_amd64" | "any";
  }[];
  readonly compatibility: {
    readonly state: "isolated_unbundled_synthetic_smoke_passed";
    readonly label: "Synthetic compatibility observed; bundle not tested";
    readonly fixture: "synthetic_three_cartesian_point_e57";
    readonly bundleUnderTest: false;
    readonly venueDataAccessed: false;
    readonly limitation: string;
  };
  readonly bundle: {
    readonly state: "not_materialized";
    readonly legalPackState: "not_assembled";
    readonly microsoftCppRuntimeState: "host_dependency_observed_not_closed";
    readonly cleanHostVerificationState: "not_performed";
    readonly adapterBindingState: "not_wired";
  };
  readonly openItems: readonly {
    readonly id: string;
    readonly label: string;
    readonly reason: string;
    readonly decisiveNextTest: string;
  }[];
  readonly nextAction: string;
  readonly followUp: {
    readonly schemaVersion: typeof LOCAL_E57_RUNTIME_BUNDLE_FOLLOW_UP_V0;
    readonly parentEnvironmentSha256: string;
    readonly state:
      "candidate_materialized_repeat_receipt_matched_clean_host_open";
    readonly candidateBundle: {
      readonly receiptPath:
        "configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json";
      readonly bundleReceiptSha256: string;
      readonly rawReceiptSha256: string;
      readonly receiptByteSize: 183683;
      readonly fileCount: 1032;
      readonly totalFileBytes: 66757784;
      readonly repeatBuildCount: 2;
      readonly repeatReceiptByteExact: true;
      readonly applicationInstalled: false;
    };
    readonly legalPack: {
      readonly state: "assembled_in_candidate_bundle";
      readonly materialCount: 30;
      readonly pybind11NoticeByteSize: 1684;
      readonly pybind11NoticeSha256: string;
      readonly parentEnvironmentLegalReceiptsApplied: true;
    };
    readonly microsoftCppRuntime: {
      readonly disposition: "central_prerequisite_direct_from_microsoft";
      readonly selectedVersion: "14.51.36247";
      readonly installerBundled: false;
      readonly installationState: "not_performed";
      readonly organizationRedistributionAuthorization: "not_evidenced";
    };
    readonly pybind11: {
      readonly versionClaim: "inferred_3.0.1_not_attested";
      readonly noticeState: "exact_version_invariant_notice_included";
      readonly buildProvenanceState: "unresolved_opaque_publisher_binary";
    };
    readonly adapter: {
      readonly wiringState: "complete_and_fail_closed";
      readonly productionBindingState: "withheld_pending_clean_host_qualification";
      readonly defaultBinding: null;
      readonly looseDependencyFoldersAcceptedForExecution: false;
    };
    readonly cleanHostQualification: {
      readonly state: "not_performed";
      readonly requiredBeforeProductionBinding: true;
      readonly userOrVenueDataRequired: false;
    };
    readonly remainingGates: readonly {
      readonly id:
        | "central-runtime-setup-review"
        | "clean-host-qualification"
        | "production-adapter-binding";
      readonly label: string;
      readonly reason: string;
      readonly decisiveNextTest: string;
    }[];
    readonly execution: "disabled";
    readonly authority: "none";
    readonly userOrVenueDataAccessed: false;
    readonly nextAction: string;
  };
}

export const LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0:
  FoundryLocalE57IntakeEnvironmentV0 =
    verifyFoundryLocalE57IntakeEnvironmentV0(
      LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_DOCUMENT,
    );

export const LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0:
  LocalE57IntakeEnvironmentReadinessDtoV0 = Object.freeze({
    schemaVersion: LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_V0,
    environmentSha256:
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.environmentSha256,
    parentHdWorkerManifestSha256:
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.parentHdWorkerManifestSha256,
    overall: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.overall,
    environmentState:
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.environmentState,
    installationState:
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.installationState,
    bundleVerificationState:
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundleVerificationState,
    binding: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.binding,
    execution: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.execution,
    authority: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.authority,
    target: Object.freeze({
      operatingSystem:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.operatingSystem,
      architecture:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.architecture,
      pythonVersion:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.pythonVersion,
      pythonAbi: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.pythonAbi,
      laneScope: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.laneScope,
      parentE57CandidateDisposition:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target
          .parentE57CandidateDisposition,
      unifiedWithOpen3d:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.target.unifiedWithOpen3d,
    }),
    summary: Object.freeze({
      artifactCount: 4 as const,
      dependencyEdgeCount: 3 as const,
      pye57MemberCount: 13 as const,
      legalMaterialCount:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.legal.materials.length,
      openItemCount: 6 as const,
    }),
    activity: Object.freeze({
      ...LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.activity,
    }),
    artifacts: Object.freeze(
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.artifacts.map((artifact) =>
        Object.freeze({
          id: artifact.id,
          packageName: artifact.packageName,
          version: artifact.version,
          filename: artifact.filename,
          byteSize: artifact.byteSize,
          sha256: artifact.sha256,
          pythonTag: artifact.pythonTag,
          abiTag: artifact.abiTag,
          platformTag: artifact.platformTag,
        }),
      ),
    ),
    compatibility: Object.freeze({
      state:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.compatibilityEvidence.state,
      label: "Synthetic compatibility observed; bundle not tested" as const,
      fixture:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.compatibilityEvidence.fixture,
      bundleUnderTest:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.compatibilityEvidence
          .bundleUnderTest,
      venueDataAccessed:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.compatibilityEvidence
          .venueDataAccessed,
      limitation:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.compatibilityEvidence
          .limitation,
    }),
    bundle: Object.freeze({
      state: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundle.state,
      legalPackState:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundle.legalPackState,
      microsoftCppRuntimeState:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundle
          .microsoftCppRuntimeState,
      cleanHostVerificationState:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundle
          .cleanHostVerificationState,
      adapterBindingState:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.bundle.adapterBindingState,
    }),
    openItems: Object.freeze(
      LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.openItems.map((item) =>
        Object.freeze({ ...item }),
      ),
    ),
    nextAction: LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.nextAction,
    followUp: Object.freeze({
      schemaVersion: LOCAL_E57_RUNTIME_BUNDLE_FOLLOW_UP_V0,
      parentEnvironmentSha256:
        LOCAL_E57_INTAKE_ENVIRONMENT_MANIFEST_V0.environmentSha256,
      state:
        "candidate_materialized_repeat_receipt_matched_clean_host_open" as const,
      candidateBundle: Object.freeze({
        receiptPath:
          "configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json" as const,
        bundleReceiptSha256:
          "9d93928658fb650a319edf1b65bad250b8fa213d810e3554d5e345b42a974696",
        rawReceiptSha256:
          "a617c29cd7e19c17cda0bc61f365c36d382df35c8b73b57a766f32291f1d4e24",
        receiptByteSize: 183_683 as const,
        fileCount: 1_032 as const,
        totalFileBytes: 66_757_784 as const,
        repeatBuildCount: 2 as const,
        repeatReceiptByteExact: true as const,
        applicationInstalled: false as const,
      }),
      legalPack: Object.freeze({
        state: "assembled_in_candidate_bundle" as const,
        materialCount: 30 as const,
        pybind11NoticeByteSize: 1_684 as const,
        pybind11NoticeSha256:
          "83965b843b98f670d3a85bd041ed4b372c8ec50d7b4a5995a83ac697ba675dcb",
        parentEnvironmentLegalReceiptsApplied: true as const,
      }),
      microsoftCppRuntime: Object.freeze({
        disposition: "central_prerequisite_direct_from_microsoft" as const,
        selectedVersion: "14.51.36247" as const,
        installerBundled: false as const,
        installationState: "not_performed" as const,
        organizationRedistributionAuthorization: "not_evidenced" as const,
      }),
      pybind11: Object.freeze({
        versionClaim: "inferred_3.0.1_not_attested" as const,
        noticeState: "exact_version_invariant_notice_included" as const,
        buildProvenanceState: "unresolved_opaque_publisher_binary" as const,
      }),
      adapter: Object.freeze({
        wiringState: "complete_and_fail_closed" as const,
        productionBindingState:
          "withheld_pending_clean_host_qualification" as const,
        defaultBinding: null,
        looseDependencyFoldersAcceptedForExecution: false as const,
      }),
      cleanHostQualification: Object.freeze({
        state: "not_performed" as const,
        requiredBeforeProductionBinding: true as const,
        userOrVenueDataRequired: false as const,
      }),
      remainingGates: Object.freeze([
        Object.freeze({
          id: "central-runtime-setup-review" as const,
          label: "Confirm the central Microsoft runtime setup path",
          reason:
            "The exact Microsoft prerequisite is selected, but it was not installed and OmniTwin redistribution authorization was not evidenced.",
          decisiveNextTest:
            "On a disposable supported Windows image, acquire the exact Microsoft artifact directly, verify its digest and signer, and record the installed compatible v14 registry version.",
        }),
        Object.freeze({
          id: "clean-host-qualification" as const,
          label: "Qualify the candidate on a clean Windows host",
          reason:
            "This workstation materialization proves deterministic bytes, not clean-host native-module resolution.",
          decisiveNextTest:
            "Run the synthetic-only qualification sequence in a disposable Windows 11 x64 VM and record every loaded native module without reading user or venue data.",
        }),
        Object.freeze({
          id: "production-adapter-binding" as const,
          label: "Compile the qualified receipt into the adapter",
          reason:
            "The adapter now rejects loose dependency folders, but its production binding remains deliberately null until clean-host evidence exists.",
          decisiveNextTest:
            "After qualification passes, issue the cross-bound qualification and adapter-binding receipts, compile that binding into the release, and rerun the aggregate-only adapter suite.",
        }),
      ]),
      execution: "disabled" as const,
      authority: "none" as const,
      userOrVenueDataAccessed: false as const,
      nextAction:
        "Qualify receipt 9d93928658fb…4696 on a disposable Windows 11 x64 host with the declared central Microsoft v14 runtime, using only the synthetic fixture; then compile the resulting cross-bound adapter binding.",
    }),
  });

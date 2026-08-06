import {
  FoundryLocalHdWorkerManifestPayloadV0Schema,
  compileFoundryLocalHdWorkerManifestV0,
  type FoundryLocalHdWorkerManifestV0,
} from "@omnitwin/reconstruction-foundry";
import { LOCAL_HD_WORKER_GENERATED_MANIFEST_PAYLOAD } from "./local-hd-worker-manifest.generated.js";
import {
  LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0,
  type LocalE57IntakeEnvironmentReadinessDtoV0,
} from "./local-e57-intake-environment-readiness.js";

export const LOCAL_HD_WORKER_READINESS_V0 =
  "omnitwin.local-foundry.local-hd-worker-readiness.v0";

export interface LocalHdWorkerReadinessDtoV0 {
  readonly schemaVersion: typeof LOCAL_HD_WORKER_READINESS_V0;
  readonly manifestSha256: string;
  readonly overall: "planned_not_installed_not_execution_ready";
  readonly manifestState: "recorded_with_open_closure_items";
  readonly installationState: "not_installed";
  readonly runtimeVerificationState: "not_performed";
  readonly binding: "not_bound_to_current_source_or_plan";
  readonly execution: "disabled";
  readonly authority: "none";
  readonly summary: {
    readonly capabilityLaneCount: number;
    readonly componentCount: number;
    readonly openComponentClosureCount: number;
    readonly exclusionCount: number;
  };
  readonly activity: {
    readonly workerInstallationPerformed: false;
    readonly workerRuntimeVerificationPerformed: false;
    readonly venueDataAccessed: false;
    readonly cloudWorkloadStarted: false;
    readonly modelOptimizationStarted: false;
  };
  readonly architecture: {
    readonly localWindowsGaussianTraining: "not_enabled";
    readonly gaussianTrainingLocation: "reviewed_remote_gpu_worker_only";
    readonly gpuWorkerImage: "not_defined";
  };
  readonly capabilityLanes: readonly {
    readonly id: string;
    readonly label: string;
    readonly runtimeProfile: string;
    readonly executionLocation:
      | "local_windows_candidate"
      | "reviewed_remote_gpu_worker_only";
    readonly state:
      | "planned_closure_incomplete_execution_disabled"
      | "execution_disabled_under_current_architecture";
    readonly boundary: string;
  }[];
  readonly components: readonly {
    readonly id: string;
    readonly label: string;
    readonly role: string;
    readonly exactVersion: string;
    readonly exactRevision: string;
    readonly sourceArtifactSha256: string;
    readonly licenseSpdx: string;
    readonly noticeClosureStatus:
      | "missing_from_selected_binary"
      | "open_dependency_notice_review";
    readonly closureStatus: "root_identity_pinned_dependency_closure_open";
  }[];
  readonly exclusions: readonly {
    readonly id: string;
    readonly label: string;
    readonly reason: string;
  }[];
  readonly legacyWorkerImageRefusal: {
    readonly disposition: "do_not_build_run_or_deploy";
    readonly reason: string;
  };
  readonly nextAction: string;
  readonly e57Environment: LocalE57IntakeEnvironmentReadinessDtoV0;
}

export function assertLocalE57EnvironmentParentBinding(
  parentManifestSha256: string,
  childParentManifestSha256: string,
): void {
  if (childParentManifestSha256 !== parentManifestSha256) {
    throw new Error(
      "The exact E57 environment is not bound to this local HD worker manifest.",
    );
  }
}

export const LOCAL_HD_WORKER_MANIFEST_V0: FoundryLocalHdWorkerManifestV0 =
  compileFoundryLocalHdWorkerManifestV0(
    FoundryLocalHdWorkerManifestPayloadV0Schema.parse(
      LOCAL_HD_WORKER_GENERATED_MANIFEST_PAYLOAD,
    ),
  );

assertLocalE57EnvironmentParentBinding(
  LOCAL_HD_WORKER_MANIFEST_V0.manifestSha256,
  LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0.parentHdWorkerManifestSha256,
);

export const LOCAL_HD_WORKER_READINESS_DTO_V0:
  LocalHdWorkerReadinessDtoV0 = Object.freeze({
    schemaVersion: LOCAL_HD_WORKER_READINESS_V0,
    manifestSha256: LOCAL_HD_WORKER_MANIFEST_V0.manifestSha256,
    overall: LOCAL_HD_WORKER_MANIFEST_V0.overall,
    manifestState: LOCAL_HD_WORKER_MANIFEST_V0.manifestState,
    installationState: LOCAL_HD_WORKER_MANIFEST_V0.installationState,
    runtimeVerificationState:
      LOCAL_HD_WORKER_MANIFEST_V0.runtimeVerificationState,
    binding: LOCAL_HD_WORKER_MANIFEST_V0.binding,
    execution: LOCAL_HD_WORKER_MANIFEST_V0.execution,
    authority: LOCAL_HD_WORKER_MANIFEST_V0.authority,
    summary: Object.freeze({
      capabilityLaneCount: LOCAL_HD_WORKER_MANIFEST_V0.capabilityLanes.length,
      componentCount: LOCAL_HD_WORKER_MANIFEST_V0.components.length,
      openComponentClosureCount: LOCAL_HD_WORKER_MANIFEST_V0.components.length,
      exclusionCount: LOCAL_HD_WORKER_MANIFEST_V0.exclusions.length,
    }),
    activity: Object.freeze({ ...LOCAL_HD_WORKER_MANIFEST_V0.activity }),
    architecture: Object.freeze({
      localWindowsGaussianTraining:
        LOCAL_HD_WORKER_MANIFEST_V0.architecture.localWindows.gaussianTraining,
      gaussianTrainingLocation: "reviewed_remote_gpu_worker_only" as const,
      gpuWorkerImage:
        LOCAL_HD_WORKER_MANIFEST_V0.architecture.gpuWorker.workerImage,
    }),
    capabilityLanes: Object.freeze(
      LOCAL_HD_WORKER_MANIFEST_V0.capabilityLanes.map((lane) => Object.freeze({
        id: lane.id,
        label: lane.label,
        runtimeProfile: lane.runtimeProfile,
        executionLocation: lane.executionLocation,
        state: lane.state,
        boundary: lane.boundary,
      })),
    ),
    components: Object.freeze(
      LOCAL_HD_WORKER_MANIFEST_V0.components.map((component) => Object.freeze({
        id: component.id,
        label: component.label,
        role: component.role,
        exactVersion: component.version,
        exactRevision: component.revision,
        sourceArtifactSha256: component.artifact.sha256,
        licenseSpdx: component.licenseSpdx,
        noticeClosureStatus: component.noticeClosureStatus,
        closureStatus: component.closureStatus,
      })),
    ),
    exclusions: Object.freeze(
      LOCAL_HD_WORKER_MANIFEST_V0.exclusions.map((exclusion) =>
        Object.freeze({ ...exclusion }),
      ),
    ),
    legacyWorkerImageRefusal: Object.freeze({
      disposition: LOCAL_HD_WORKER_MANIFEST_V0.legacyDocker.disposition,
      reason: LOCAL_HD_WORKER_MANIFEST_V0.legacyDocker.reason,
    }),
    nextAction: LOCAL_HD_WORKER_MANIFEST_V0.nextAction,
    e57Environment: LOCAL_E57_INTAKE_ENVIRONMENT_READINESS_DTO_V0,
  });

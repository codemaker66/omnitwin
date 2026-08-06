import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyFoundryLocalHdWorkerManifestV0 } from "@omnitwin/reconstruction-foundry";
import {
  LOCAL_HD_WORKER_MANIFEST_V0,
  LOCAL_HD_WORKER_READINESS_DTO_V0,
} from "../local-hd-worker-readiness.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const MANIFEST_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-hd-worker-v0.manifest.json",
  import.meta.url,
));
const openApps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
});

describe("Foundry local workbench HD worker readiness", () => {
  it("embeds the exact checked-in manifest without a runtime file path", async () => {
    const checkedIn = verifyFoundryLocalHdWorkerManifestV0(
      JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown,
    );
    expect(LOCAL_HD_WORKER_MANIFEST_V0).toEqual(checkedIn);
    expect(LOCAL_HD_WORKER_READINESS_DTO_V0.manifestSha256).toBe(
      checkedIn.manifestSha256,
    );
    expect(JSON.stringify(LOCAL_HD_WORKER_READINESS_DTO_V0)).not.toMatch(
      /[A-Z]:\\|Users\\|AppData\\/u,
    );
  });

  it("exposes one fail-closed DTO through the existing state response", async () => {
    const app = await startLocalFoundryApp({
      source: "deliberately-missing-worker-readiness-fixture",
    });
    openApps.push(app);
    const stateUrl = new URL(app.url);
    stateUrl.pathname = "/api/state";
    const response = await fetch(stateUrl, {
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(response.status).toBe(200);
    const state = await response.json() as LocalFoundryPublicState;

    expect(state.localHdWorker).toEqual(LOCAL_HD_WORKER_READINESS_DTO_V0);
    expect(state.localHdWorker).toMatchObject({
      overall: "planned_not_installed_not_execution_ready",
      manifestState: "recorded_with_open_closure_items",
      installationState: "not_installed",
      runtimeVerificationState: "not_performed",
      binding: "not_bound_to_current_source_or_plan",
      execution: "disabled",
      authority: "none",
      summary: {
        capabilityLaneCount: 5,
        componentCount: 8,
        openComponentClosureCount: 8,
        exclusionCount: 6,
      },
      activity: {
        workerInstallationPerformed: false,
        workerRuntimeVerificationPerformed: false,
        venueDataAccessed: false,
        cloudWorkloadStarted: false,
        modelOptimizationStarted: false,
      },
      architecture: {
        localWindowsGaussianTraining: "not_enabled",
        gaussianTrainingLocation: "reviewed_remote_gpu_worker_only",
        gpuWorkerImage: "not_defined",
      },
      legacyWorkerImageRefusal: {
        disposition: "do_not_build_run_or_deploy",
      },
    });
    expect(state.localHdWorker.components.map((component) => component.id)).toEqual([
      "pye57",
      "libe57format",
      "xerces-c",
      "open3d",
      "colmap",
      "hloc",
      "gsplat",
      "ppisp",
    ]);
    expect(state.localHdWorker.e57Environment).toMatchObject({
      overall:
        "exact_artifacts_recorded_bundle_not_materialized_not_execution_ready",
      target: {
        pythonVersion: "3.13.14",
        pythonAbi: "cp313",
        laneScope: "e57_read_only_intake_only",
        unifiedWithOpen3d: false,
      },
      activity: {
        packageInstallerUsed: false,
        systemInstallationPerformed: false,
        isolatedSyntheticCompatibilitySmokePerformed: true,
        venueDataAccessed: false,
      },
      compatibility: {
        label: "Synthetic compatibility observed; bundle not tested",
        bundleUnderTest: false,
      },
      bundle: {
        state: "not_materialized",
        microsoftCppRuntimeState: "host_dependency_observed_not_closed",
        adapterBindingState: "not_wired",
      },
      execution: "disabled",
    });
    expect(state.safety.execution).toBe("disabled");
    expect(state.safety.reconstruction).toBe("disabled");
  });
});

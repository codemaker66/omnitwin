import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0,
  FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0_DIGEST_DOMAIN,
  FoundryLocalHdWorkerManifestPayloadV0Schema,
  compileFoundryLocalHdWorkerManifestV0,
  serializeFoundryLocalHdWorkerManifestV0,
  verifyFoundryLocalHdWorkerManifestV0,
  type FoundryLocalHdWorkerManifestV0,
} from "../local-hd-worker-manifest.js";

const MANIFEST_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-hd-worker-v0.manifest.json",
  import.meta.url,
));

async function readManifest(): Promise<FoundryLocalHdWorkerManifestV0> {
  return verifyFoundryLocalHdWorkerManifestV0(
    JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown,
  );
}

describe("Foundry local HD worker dependency manifest v0", () => {
  it("binds the checked-in exact root identities without claiming an executable worker", async () => {
    const manifest = await readManifest();

    expect(manifest.schemaVersion).toBe(FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0);
    expect(FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0_DIGEST_DOMAIN).toBe(
      "VENVIEWER_FOUNDRY_LOCAL_HD_WORKER_MANIFEST_V0",
    );
    expect(manifest.manifestSha256).toBe(
      "fbfd7c6c51c8be06f9bb411f4833fbf0fd0daba45d09512ed70bf63420b9f436",
    );
    expect(manifest).toMatchObject({
      reviewClass: "engineering_screen_only",
      overall: "planned_not_installed_not_execution_ready",
      manifestState: "recorded_with_open_closure_items",
      installationState: "not_installed",
      runtimeVerificationState: "not_performed",
      binding: "not_bound_to_current_source_or_plan",
      execution: "disabled",
      authority: "none",
      activity: {
        workerInstallationPerformed: false,
        workerRuntimeVerificationPerformed: false,
        venueDataAccessed: false,
        cloudWorkloadStarted: false,
        modelOptimizationStarted: false,
      },
    });
    expect(manifest.components.map((component) => component.id)).toEqual([
      "pye57",
      "libe57format",
      "xerces-c",
      "open3d",
      "colmap",
      "hloc",
      "gsplat",
      "ppisp",
    ]);
    expect(manifest.components.map((component) => [
      component.id,
      component.version,
      component.revision,
      component.artifact.sha256,
      component.licenseSpdx,
    ])).toEqual([
      ["pye57", "0.4.19", "64c9000738ad54242e87e1da6bca6b683b13374b", "b0fdc023d88706739ff5bfa22022bd69611b2394298d477a9cc91c669c4cbcf8", "MIT"],
      ["libe57format", "3.1.1", "1914b8ea972251d3bb49a33828497dde683205d9", "949e73db3cb90ed7d286c49d12c6925813ead8d92ff9b84e0fba17fa015194d0", "BSL-1.0 AND MIT AND BSD-3-Clause"],
      ["xerces-c", "3.2.3", "cf1912ac95d4147be08aef4e78f894a3919277d9", "fb96fc49b1fb892d1e64e53a6ada8accf6f0e6d30ce0937956ec68d39bd72c7e", "Apache-2.0"],
      ["open3d", "0.19.0", "1e7b17438687a0b0c1e5a7187321ac7044afe275", "18bb8b86e5fa9e582ed11b9651ff6e4a782e6778c9b8bfc344fc866dc8b5f49c", "MIT"],
      ["colmap", "4.1.1", "a0d785fba74b2664f31edc4a29026a8b27c00f67", "faf1247d2ec90933aa8bd003709790abf0211cdc132cceec4c831718f2e0895a", "BSD-3-Clause"],
      ["hloc", "1.4", "80ccb7ee3bc048cb3a8ef221c5bc4d8ac25d5792", "78bc0d0377f5f0bc949ac1811ff6f2c102a25e858d02de6cdcbed808f4c3ce33", "Apache-2.0"],
      ["gsplat", "1.5.3", "937e29912570c372bed6747a5c9bf85fed877bae", "8a24428b8ea2ce7c3e10fcf5aa20e20fe503b8329c96db797f4eab703729aac3", "Apache-2.0"],
      ["ppisp", "1.2.1", "df33809f7b3b20ac06de088dfc871b144b8fb54d", "6024ede41eed932ed9caaf48d4dcf2d8b14f0c44f14c1cc47de0d266dea22d6c", "Apache-2.0"],
    ]);
    expect(manifest.components.find(
      (component) => component.id === "xerces-c",
    )?.tag).toBe("v3.2.3");
    expect(manifest.components.every(
      (component) =>
        component.closureStatus ===
          "root_identity_pinned_dependency_closure_open" &&
        component.installationState === "not_installed" &&
        component.runtimeVerificationState === "not_performed" &&
        component.execution === "disabled" &&
        component.legalTexts.length > 0 &&
        component.closureItems.length > 0,
    )).toBe(true);
  });

  it("keeps capability profiles independent and Gaussian training off local Windows", async () => {
    const manifest = await readManifest();
    expect(manifest.capabilityLanes.map((lane) => lane.id)).toEqual([
      "e57_read_only_intake",
      "geometry_registration_and_qa",
      "camera_registration",
      "gaussian_training",
      "photometric_compensation",
    ]);
    expect(manifest.architecture).toEqual({
      localWindows: {
        status: "planned_components_only",
        gaussianTraining: "not_enabled",
      },
      gpuWorker: {
        status: "separate_review_required",
        canonicalForGaussianTraining: true,
        workerImage: "not_defined",
      },
    });
    expect(manifest.capabilityLanes.find(
      (lane) => lane.id === "gaussian_training",
    )).toMatchObject({
      componentIds: ["gsplat"],
      executionLocation: "reviewed_remote_gpu_worker_only",
      state: "execution_disabled_under_current_architecture",
    });
    expect(manifest.capabilityLanes.find(
      (lane) => lane.id === "e57_read_only_intake",
    )?.runtimeProfile).toContain("CPython 3.10");
    expect(manifest.capabilityLanes.find(
      (lane) => lane.id === "gaussian_training",
    )?.runtimeProfile).not.toBe(
      manifest.capabilityLanes.find(
        (lane) => lane.id === "e57_read_only_intake",
      )?.runtimeProfile,
    );
  });

  it("records the legacy refusal, no-weight policy, official-export boundary, and deferred PDAL truth", async () => {
    const manifest = await readManifest();
    expect(manifest.legacyDocker).toEqual({
      path: "infra/runpod/Dockerfile",
      disposition: "do_not_build_run_or_deploy",
      reason: expect.stringContaining("moving-main SPZ and DN-Splatter"),
    });
    expect(manifest.exclusions.map((exclusion) => exclusion.id)).toEqual([
      "pdal-deferred",
      "raw-xgrids-formats",
      "legacy-moving-main-spz",
      "legacy-moving-main-dn-splatter",
      "unlisted-models-and-datasets",
      "ai-captured-truth-substitution",
    ]);
    expect(manifest.exclusions.find(
      (exclusion) => exclusion.id === "raw-xgrids-formats",
    )?.reason).toContain("official rights-cleared SOG, SPZ, PLY, GLB");
    expect(manifest.components.find(
      (component) => component.id === "hloc",
    )?.excludedAssets.join(" ")).toContain("All learned extractors");
    expect(manifest.components.find(
      (component) => component.id === "ppisp",
    )?.excludedAssets.join(" ")).toContain("PhysicalAI-NuRec-PPISP dataset");
  });

  it("rejects digest drift, unknown fields, dangling lane components, local GPU aliases, and a local Gaussian lane", async () => {
    const manifest = await readManifest();
    expect(() => verifyFoundryLocalHdWorkerManifestV0({
      ...manifest,
      nextAction: `${manifest.nextAction} changed`,
    })).toThrow("fingerprint does not match");

    const { manifestSha256: _manifestSha256, ...payload } = manifest;
    expect(() => FoundryLocalHdWorkerManifestPayloadV0Schema.parse({
      ...payload,
      unexpectedAuthority: true,
    })).toThrow();
    expect(() => compileFoundryLocalHdWorkerManifestV0({
      ...payload,
      capabilityLanes: payload.capabilityLanes.map((lane) =>
        lane.id === "camera_registration"
          ? { ...lane, componentIds: [...lane.componentIds, "missing-worker"] }
          : lane),
    })).toThrow("unknown component");
    expect(() => compileFoundryLocalHdWorkerManifestV0({
      ...payload,
      capabilityLanes: payload.capabilityLanes.map((lane) =>
        lane.id === "gaussian_training"
          ? { ...lane, executionLocation: "local_windows_candidate" as const }
          : lane),
    })).toThrow("Gaussian training must remain disabled");
    expect(() => compileFoundryLocalHdWorkerManifestV0({
      ...payload,
      capabilityLanes: payload.capabilityLanes.map((lane) =>
        lane.id === "e57_read_only_intake"
          ? { ...lane, componentIds: [...lane.componentIds, "gsplat"] }
          : lane),
    })).toThrow("exact disjoint v0 component");
    expect(() => compileFoundryLocalHdWorkerManifestV0({
      ...payload,
      capabilityLanes: payload.capabilityLanes.map((lane) =>
        lane.id === "geometry_registration_and_qa"
          ? { ...lane, componentIds: [...lane.componentIds, "ppisp"] }
          : lane),
    })).toThrow("exact disjoint v0 component");
    expect(() => compileFoundryLocalHdWorkerManifestV0({
      ...payload,
      capabilityLanes: payload.capabilityLanes.map((lane) =>
        lane.id === "photometric_compensation"
          ? { ...lane, executionLocation: "local_windows_candidate" as const }
          : lane),
    })).toThrow("exact disjoint v0 component");
  });

  it("keeps canonical serialization deterministic and the checked-in bytes LF-only", async () => {
    const bytes = await readFile(MANIFEST_PATH);
    const manifest = await readManifest();
    expect(bytes.includes(13)).toBe(false);
    expect(JSON.parse(serializeFoundryLocalHdWorkerManifestV0(manifest))).toEqual(
      manifest,
    );
    expect(serializeFoundryLocalHdWorkerManifestV0(manifest)).toBe(
      serializeFoundryLocalHdWorkerManifestV0(structuredClone(manifest)),
    );
  });
});

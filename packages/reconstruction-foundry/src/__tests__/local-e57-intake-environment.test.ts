import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0,
  FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_DIGEST_DOMAIN,
  FoundryLocalE57IntakeEnvironmentPayloadV0Schema,
  compileFoundryLocalE57IntakeEnvironmentV0,
  serializeFoundryLocalE57IntakeEnvironmentV0,
  verifyFoundryLocalE57IntakeEnvironmentV0,
  type FoundryLocalE57IntakeEnvironmentV0,
} from "../local-e57-intake-environment.js";

const MANIFEST_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-e57-intake-environment-v0.manifest.json",
  import.meta.url,
));

async function readManifest(): Promise<FoundryLocalE57IntakeEnvironmentV0> {
  return verifyFoundryLocalE57IntakeEnvironmentV0(
    JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as unknown,
  );
}

describe("Foundry local E57 intake environment v0", () => {
  it("selects the exact CPython 3.13 E57-only lane without claiming a bundle", async () => {
    const manifest = await readManifest();

    expect(manifest.schemaVersion).toBe(
      FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0,
    );
    expect(FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_DIGEST_DOMAIN).toBe(
      "VENVIEWER_FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0",
    );
    expect(manifest.environmentSha256).toBe(
      "34ad3f54ea5a5afcca908c66f48ab039381d6910b2372afbafee0c1f8545ea1e",
    );
    expect(manifest).toMatchObject({
      overall:
        "exact_artifacts_recorded_bundle_not_materialized_not_execution_ready",
      environmentState:
        "recorded_with_materialization_and_runtime_closure_open",
      installationState: "not_installed",
      bundleVerificationState: "not_performed",
      binding: "not_bound_to_current_source_or_plan",
      execution: "disabled",
      authority: "none",
      target: {
        pythonVersion: "3.13.14",
        pythonAbi: "cp313",
        laneScope: "e57_read_only_intake_only",
        parentE57CandidateDisposition: "superseded_by_this_environment",
        unifiedWithOpen3d: false,
      },
      bundle: {
        state: "not_materialized",
        microsoftCppRuntimeState: "host_dependency_observed_not_closed",
        adapterBindingState: "not_wired",
      },
    });
  });

  it("binds the complete Python graph and exact pye57 cp313 wheel inventory", async () => {
    const manifest = await readManifest();

    expect(manifest.artifacts.map((artifact) => [
      artifact.id,
      artifact.version,
      artifact.byteSize,
      artifact.sha256,
      artifact.pythonTag,
      artifact.abiTag,
      artifact.platformTag,
    ])).toEqual([
      [
        "cpython-runtime",
        "3.13.14",
        10_964_839,
        "90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907",
        "not_applicable",
        "not_applicable",
        "win_amd64",
      ],
      [
        "pye57-wheel",
        "0.4.19",
        1_130_809,
        "d27332054bf18689acb45470a3bc16d4c21ed7b0b0848c56ef9e42cc8980a3c4",
        "cp313",
        "cp313",
        "win_amd64",
      ],
      [
        "numpy-wheel",
        "2.5.1",
        12_425_674,
        "6c3fe51bc6a16453d452997053454f309e8e0ed7b42d6b361ce4ac8c32913d74",
        "cp313",
        "cp313",
        "win_amd64",
      ],
      [
        "pyquaternion-wheel",
        "0.9.9",
        14_361,
        "e65f6e3f7b1fdf1a9e23f82434334a1ae84f14223eee835190cd2e841f8172ec",
        "py3",
        "none",
        "any",
      ],
    ]);
    expect(manifest.dependencyEdges.map((edge) => [
      edge.fromArtifactId,
      edge.toArtifactId,
    ])).toEqual([
      ["pye57-wheel", "numpy-wheel"],
      ["pye57-wheel", "pyquaternion-wheel"],
      ["pyquaternion-wheel", "numpy-wheel"],
    ]);
    expect(manifest.pye57Wheel.members).toHaveLength(13);
    expect(manifest.pye57Wheel.members).toContainEqual({
      path: "pye57/libe57.cp313-win_amd64.pyd",
      byteSize: 781_824,
      sha256:
        "71b6e35db443902b55a9260813a09d57e8481956aa6bb443fb8b52ae94dce958",
    });
    expect(manifest.pye57Wheel.members).toContainEqual({
      path: "pye57/xerces-c_3_2.dll",
      byteSize: 2_793_984,
      sha256:
        "7af1375b748ed58b8d5ff316a11fac6f4ec2742e572a099bf891523ceb5d5134",
    });
    expect(JSON.stringify(manifest.pye57Wheel.members)).not.toContain("cp310");
  });

  it("records observed synthetic compatibility separately from bundle readiness", async () => {
    const manifest = await readManifest();

    expect(manifest.activity).toEqual({
      packageInstallerUsed: false,
      systemInstallationPerformed: false,
      isolatedArchiveExtractionPerformed: true,
      isolatedSyntheticCompatibilitySmokePerformed: true,
      venueDataAccessed: false,
      userProvidedSourceFileRead: false,
      syntheticFixtureFileRead: true,
      cloudWorkloadStarted: false,
    });
    expect(manifest.compatibilityEvidence).toMatchObject({
      state: "isolated_unbundled_synthetic_smoke_passed",
      fixture: "synthetic_three_cartesian_point_e57",
      installed: false,
      bundleUnderTest: false,
      venueDataAccessed: false,
      observationReceipt: {
        observationId: "t536-cp313-isolated-synthetic-smoke-2026-07-19",
        fixtureByteSize: 4_096,
        fixtureSha256:
          "91f2b9a039358efb2b724d9fb254e0f827ff34a88e03a9d8df7d123f09b1db31",
        observedRecordCount: 3,
        logState: "tool_transcript_only_no_repository_log",
      },
    });
    expect(manifest.compatibilityEvidence.limitation).toContain(
      "MSVCP140.dll",
    );
    expect(manifest.bundle.state).toBe("not_materialized");
    expect(manifest.bundle.cleanHostVerificationState).toBe("not_performed");
    expect(manifest.execution).toBe("disabled");
  });

  it("preserves aggregate-only intake and every known legal source while keeping open gates explicit", async () => {
    const manifest = await readManifest();

    expect(manifest.pye57Wheel).toMatchObject({
      aggregateOnlyReadContract: true,
      pointRecordReadsAllowed: false,
      embeddedImageReadsAllowed: false,
      writeModeAllowedForProductIntake: false,
    });
    expect(manifest.legal.materials).toHaveLength(29);
    expect(new Set(manifest.legal.materials.map((material) => material.id)).size)
      .toBe(29);
    expect(manifest.legal).toMatchObject({
      archiveLicenseInventoryState: "recorded",
      nativeLegalSourceState: "recorded_except_exact_pybind11_notice",
      redistributionPackState: "not_assembled",
      redistributionReviewState: "not_final",
    });
    expect(manifest.nativeInclusions.find(
      (inclusion) => inclusion.id === "pybind11",
    )).toMatchObject({
      version: "unresolved",
      revision: "unresolved",
      evidenceState: "unresolved",
    });
    expect(manifest.openItems.map((item) => item.id)).toEqual([
      "microsoft-cpp-runtime",
      "pybind11-build-version",
      "redistribution-pack",
      "exact-extracted-member-manifest",
      "clean-host-bundle-smoke",
      "adapter-runtime-bundle-binding",
    ]);
  });

  it("rejects digest drift, cp310 substitution, false bundle closure, and hidden fields", async () => {
    const manifest = await readManifest();
    expect(() => verifyFoundryLocalE57IntakeEnvironmentV0({
      ...manifest,
      nextAction: `${manifest.nextAction} changed`,
    })).toThrow("fingerprint does not match");

    const { environmentSha256: _environmentSha256, ...payload } = manifest;
    expect(() => FoundryLocalE57IntakeEnvironmentPayloadV0Schema.parse({
      ...payload,
      hiddenRuntimeAuthority: true,
    })).toThrow();
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      artifacts: payload.artifacts.map((artifact) =>
        artifact.id === "pye57-wheel"
          ? {
            ...artifact,
            filename: "pye57-0.4.19-cp310-cp310-win_amd64.whl",
            pythonTag: "cp313" as const,
          }
          : artifact),
    })).toThrow("cp313 lane");
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      pye57Wheel: {
        ...payload.pye57Wheel,
        members: payload.pye57Wheel.members.map((member) =>
          member.path.includes("cp313")
            ? { ...member, path: member.path.replace("cp313", "cp310") }
            : member),
      },
    })).toThrow("all 13 exact ordered");
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      pye57Wheel: {
        ...payload.pye57Wheel,
        members: payload.pye57Wheel.members.map((member, index) =>
          index === 0
            ? { ...member, sha256: "0".repeat(64) }
            : member),
      },
    })).toThrow("all 13 exact ordered");
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      artifacts: payload.artifacts.map((artifact) =>
        artifact.id === "pye57-wheel"
          ? { ...artifact, metadataMemberByteSize: 4_950 }
          : artifact),
    })).toThrow("archive metadata");
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      nativeInclusions: payload.nativeInclusions.map((inclusion) =>
        inclusion.id === "xerces-c"
          ? { ...inclusion, binaryMemberSha256: "0".repeat(64) }
          : inclusion),
    })).toThrow("native inclusions");
    expect(() => compileFoundryLocalE57IntakeEnvironmentV0({
      ...payload,
      legal: {
        ...payload.legal,
        materials: payload.legal.materials.map((material, index) =>
          index === 0
            ? { ...material, byteSize: material.byteSize + 1 }
            : material),
      },
    })).toThrow("legal materials");
    expect(() => FoundryLocalE57IntakeEnvironmentPayloadV0Schema.parse({
      ...payload,
      bundle: {
        ...payload.bundle,
        state: "verified",
      },
    })).toThrow();
  });

  it("keeps canonical serialization deterministic and checked-in bytes LF-only", async () => {
    const bytes = await readFile(MANIFEST_PATH);
    const manifest = await readManifest();
    expect(bytes.includes(13)).toBe(false);
    expect(JSON.parse(serializeFoundryLocalE57IntakeEnvironmentV0(manifest)))
      .toEqual(manifest);
    expect(serializeFoundryLocalE57IntakeEnvironmentV0(manifest)).toBe(
      serializeFoundryLocalE57IntakeEnvironmentV0(structuredClone(manifest)),
    );
  });
});

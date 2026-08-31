import { describe, expect, it } from "vitest";
import {
  FOUNDRY_RESTORATION_PROVIDER_CATALOG,
  FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1_DIGEST_DOMAIN,
  FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1_DIGEST_DOMAIN,
  FoundryRestorationProviderCatalogV1Schema,
  computeFoundryRestorationProviderCatalogSha256V1,
  computeFoundryRestorationProviderProfileSha256V1,
  getFoundryRestorationExecutionContractV1,
  getFoundryRestorationProviderProfileV1,
  verifyFoundryRestorationProviderCatalogV1,
} from "../restoration-provider-catalog-v1.js";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";

function rawDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

describe("restoration provider catalog v1", () => {
  it("binds one exact, digest-verified profile for every required provider lane", () => {
    const catalog = verifyFoundryRestorationProviderCatalogV1(
      FOUNDRY_RESTORATION_PROVIDER_CATALOG,
    );

    expect(catalog.catalogSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(FOUNDRY_RESTORATION_PROVIDER_CATALOG)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_RESTORATION_PROVIDER_CATALOG.profiles)).toBe(true);
    expect(Object.isFrozen(FOUNDRY_RESTORATION_PROVIDER_CATALOG.profiles[0])).toBe(true);
    expect(catalog.profiles.map((profile) => profile.lane)).toEqual([
      "artifixer3d_plus",
      "difix3d_plus",
      "gr3en",
      "gsfix3d",
    ]);
    for (const profile of catalog.profiles) {
      expect(profile.profileSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(profile.executionPolicy).toEqual({
        dispatchAuthorized: false,
        commercialUseAllowed: false,
        publicDistributionAllowed: false,
        sourceTruthReplacementAllowed: false,
        generatedOutputRequiresHumanArchitectureReview: true,
      });
      expect(
        profile.executionContracts.every(
          ({ readiness }) => readiness.status === "wait",
        ),
      ).toBe(true);
    }
  });

  it("pins every audited repository and model snapshot", () => {
    const artifixer = getFoundryRestorationProviderProfileV1("artifixer3d_plus");
    expect(artifixer.repositories).toEqual([
      {
        role: "artifixer_source",
        repositoryId: "nv-tlabs/ArtiFixer",
        revision: "a392c4dfe17459ef9952407accdb9fcdcdddba98",
      },
      {
        role: "three_d_grut_source",
        repositoryId: "nv-tlabs/3dgrut",
        revision: "62e1038b74b2edc01440fd4ddf5f080109b6faba",
      },
    ]);
    expect(artifixer.models.map((model) => [model.role, model.revision])).toEqual([
      ["artifixer_01_3b_checkpoint", "f96352ad72c84a628d5844b6543e94ae8c4479b3"],
      ["artifixer_14b_checkpoint", "f96352ad72c84a628d5844b6543e94ae8c4479b3"],
      ["wan_2_1_t2v_01_3b_base", null],
      ["wan_2_1_t2v_14b_base", null],
    ]);
    expect(
      artifixer.models.flatMap((model) =>
        model.requiredWeights.map((weight) => [weight.sizeBytes, weight.sha256]),
      ),
    ).toEqual([
      [
        6_715_346_651,
        "sha256:23e909fb4232c6a74a1c59eaf0ebfd419dd188e601aa0ab0145b9aaea821e059",
      ],
      [
        67_644_337_412,
        "sha256:c1a6d31fb849211d4c682a28b40980549cd8f807ee309e7bc0141a336ffcd16b",
      ],
    ]);

    const difix = getFoundryRestorationProviderProfileV1("difix3d_plus");
    expect(difix.repositories).toEqual([
      {
        role: "difix3d_source",
        repositoryId: "nv-tlabs/Difix3D",
        revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
      },
    ]);
    expect(difix.models.map((model) => [model.modelId, model.revision])).toEqual([
      ["nvidia/difix", "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388"],
      ["nvidia/difix_ref", "d4830559772a5795c9d136302c5b197d6418d3fb"],
    ]);

    const gr3en = getFoundryRestorationProviderProfileV1("gr3en");
    expect(gr3en.repositories).toEqual([
      {
        role: "gr3en_source",
        repositoryId: "xyxingx/gr3en",
        revision: "78fd3844a6e0fdd4eb50d0e7986ede1e7f76763b",
      },
    ]);
    expect(gr3en.models).toMatchObject([
      {
        modelId: "xyxingx/GR3EN",
        revision: "8aa83a10af8b031d015e6170fd01609d54423f4c",
        snapshotSizeBytes: 33_785_456_692,
      },
    ]);

    const gsfix = getFoundryRestorationProviderProfileV1("gsfix3d");
    expect(gsfix.repositories).toEqual([
      {
        role: "gsfix_source",
        repositoryId: "GSFix3D/GSFix3D",
        revision: "88b03c0230ceef58455cd0cb7eda4a58923cf4ab",
      },
    ]);
    expect(gsfix.models.map((model) => [model.modelId, model.revision])).toEqual([
      ["goldoak1421/gsfixer-base", "10da3bf12c1c299d559a85572601f17054dd4d2a"],
      ["goldoak1421/gsfixer-full", "b492e659359325e83a2277763ee862453ae8a7e7"],
    ]);
    expect(gsfix.models.flatMap((model) => model.requiredWeights)).toHaveLength(6);
  });

  it("binds every causal input and exact candidate bytes for direct image repair", () => {
    expect(getFoundryRestorationExecutionContractV1("difix3d_plus", "difix")).toMatchObject({
      comparisonSourceInputRole: "source_fixed_camera_render",
      candidateBindingInputRoles: ["source_fixed_camera_render", "source_reconstruction"],
      candidateEvidenceBinding: "exact_candidate_bytes",
    });
    expect(
      getFoundryRestorationExecutionContractV1("difix3d_plus", "difix_ref"),
    ).toMatchObject({
      comparisonSourceInputRole: "source_fixed_camera_render",
      candidateBindingInputRoles: [
        "captured_reference_image",
        "source_fixed_camera_render",
        "source_reconstruction",
      ],
      candidateEvidenceBinding: "exact_candidate_bytes",
    });
    expect(getFoundryRestorationExecutionContractV1("gsfix3d", "gsfixer_base")).toMatchObject({
      comparisonSourceInputRole: "source_fixed_camera_render",
      candidateBindingInputRoles: ["source_fixed_camera_render", "source_reconstruction"],
      candidateEvidenceBinding: "exact_candidate_bytes",
    });
    expect(getFoundryRestorationExecutionContractV1("gsfix3d", "gsfixer_full")).toMatchObject({
      comparisonSourceInputRole: "source_gs_fixed_camera_render",
      candidateBindingInputRoles: [
        "captured_training_images",
        "gs_training_renders",
        "mesh_training_renders",
        "source_gs_fixed_camera_render",
        "source_mesh_fixed_camera_render",
        "source_reconstruction",
      ],
      candidateEvidenceBinding: "exact_candidate_bytes",
    });
  });

  it("binds source checkpoints, candidate checkpoints and derived renders for scene repair", () => {
    for (const variant of ["artifixer_14b", "artifixer_1_3b"] as const) {
      expect(
        getFoundryRestorationExecutionContractV1("artifixer3d_plus", variant),
      ).toMatchObject({
        comparisonSourceInputRole: "source_reconstruction",
        candidateBindingInputRoles: [
          "colmap_scene",
          "source_reconstruction",
          "source_training_images",
        ],
        candidateEvidenceBinding: "candidate_checkpoint_and_derived_render_bytes",
      });
    }
    expect(getFoundryRestorationExecutionContractV1("gsfix3d", "gsfix3d_lift")).toMatchObject({
      comparisonSourceInputRole: "source_3dgs_checkpoint",
      candidateBindingInputRoles: [
        "captured_training_images",
        "fixed_novel_view_images",
        "novel_view_camera_set",
        "refinement_capture_dataset_manifest",
        "source_3dgs_checkpoint",
        "source_training_camera_calibration",
      ],
      candidateEvidenceBinding: "candidate_checkpoint_and_derived_render_bytes",
    });
  });

  it("encodes the exact GR3EN 81-frame and 81-mask batch contract", () => {
    const gr3enProfile = getFoundryRestorationProviderProfileV1("gr3en");
    expect(
      gr3enProfile.inputs.find(({ role }) => role === "source_camera_trajectory")
        ?.truthLayer,
    ).toBe("OPERATOR_CONTROL");
    expect(getFoundryRestorationExecutionContractV1("gr3en", "gr3en_video")).toMatchObject({
      comparisonSourceInputRole: "source_frame_sequence_manifest",
      candidateEvidenceBinding: "exact_candidate_bytes",
      sequenceAlignment: {
        framesInputRole: "source_frame_sequence_manifest",
        masksInputRole: "source_light_control_mask_sequence_manifest",
        exactItemCount: 81,
        itemMediaType: "image/png",
        correspondence: "basename_and_index",
        sharedDimensionsAndOrderRequired: true,
        candidateDecodedFrameCountAndOrderMustMatch: true,
      },
      providerConfigurationBinding: {
        canonicalInputRole: "provider_execution_configuration",
        compiledMediaType: "application/yaml",
        candidateMustBindCanonicalAndCompiledBytes: true,
      },
    });

    const gsfixProfile = getFoundryRestorationProviderProfileV1("gsfix3d");
    expect(
      gsfixProfile.inputs.find(({ role }) => role === "novel_view_camera_set")
        ?.truthLayer,
    ).toBe("OPERATOR_CONTROL");
    expect(
      gsfixProfile.inputs.find(
        ({ role }) => role === "source_training_camera_calibration",
      )?.truthLayer,
    ).toBe("STRUCTURAL_TRUTH");
  });

  it("rejects digest tampering, path traversal and self-signed semantic repins", () => {
    const tamperedDigest = structuredClone(FOUNDRY_RESTORATION_PROVIDER_CATALOG);
    tamperedDigest.catalogSha256 = `sha256:${"0".repeat(64)}`;
    expect(FoundryRestorationProviderCatalogV1Schema.safeParse(tamperedDigest).success).toBe(false);

    const traversal = structuredClone(FOUNDRY_RESTORATION_PROVIDER_CATALOG);
    const firstWeight = traversal.profiles[0]?.models[0]?.requiredWeights[0];
    if (firstWeight === undefined) throw new Error("Expected the pinned ArtiFixer weight fixture.");
    firstWeight.relativePath = "foo/..";
    const traversalProfile = traversal.profiles[0];
    if (traversalProfile === undefined) throw new Error("Expected the ArtiFixer profile fixture.");
    const { profileSha256: _traversalProfileSha256, ...traversalProfilePayload } =
      traversalProfile;
    traversalProfile.profileSha256 = rawDigest(
      FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1_DIGEST_DOMAIN,
      traversalProfilePayload,
    );
    const { catalogSha256: _traversalCatalogSha256, ...traversalCatalogPayload } = traversal;
    traversal.catalogSha256 = rawDigest(
      FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1_DIGEST_DOMAIN,
      traversalCatalogPayload,
    );
    expect(FoundryRestorationProviderCatalogV1Schema.safeParse(traversal).success).toBe(false);

    const selfSignedRepin = structuredClone(FOUNDRY_RESTORATION_PROVIDER_CATALOG);
    const firstProfile = selfSignedRepin.profiles[0];
    const firstRepository = firstProfile?.repositories[0];
    if (firstProfile === undefined || firstRepository === undefined) {
      throw new Error("Expected the canonical ArtiFixer profile fixture.");
    }
    firstRepository.revision = "0".repeat(40);
    const { profileSha256: _profileSha256, ...profilePayload } = firstProfile;
    firstProfile.profileSha256 =
      computeFoundryRestorationProviderProfileSha256V1(profilePayload);
    const { catalogSha256: _catalogSha256, ...catalogPayload } = selfSignedRepin;
    selfSignedRepin.catalogSha256 =
      computeFoundryRestorationProviderCatalogSha256V1(catalogPayload);

    expect(FoundryRestorationProviderCatalogV1Schema.safeParse(selfSignedRepin).success).toBe(true);
    expect(() => verifyFoundryRestorationProviderCatalogV1(selfSignedRepin)).toThrowError(
      /not the audited canonical catalog/u,
    );
  });

  it("rejects a provider variant requested through the wrong lane", () => {
    expect(() =>
      getFoundryRestorationExecutionContractV1("difix3d_plus", "gsfixer_base"),
    ).toThrowError(/is not an execution contract for difix3d_plus/u);
  });
});

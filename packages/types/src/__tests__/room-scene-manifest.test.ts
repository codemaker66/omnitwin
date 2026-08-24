import { describe, expect, it } from "vitest";
import {
  ROOM_SCENE_LAYER_KINDS,
  ROOM_SCENE_TRUTH_CLASSES,
  ROOM_SCENE_MANIFEST_V0_VERSION,
  ENHANCEMENT_PROVIDER_KINDS,
  LIGHTING_VARIANT_KINDS,
  MATERIAL_CHANNELS,
  RECONSTRUCTION_PROVIDER_KINDS,
  RoomSceneManifestV0Schema,
  type RoomSceneManifestV0Input,
} from "../room-scene-manifest.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

function validManifest(): RoomSceneManifestV0Input {
  return {
    schemaVersion: ROOM_SCENE_MANIFEST_V0_VERSION,
    manifestId: "grand-hall-room-scene-v0",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    runtimePackageId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-08-23T00:00:00.000Z",
    sourceRights: [
      {
        id: "grand-hall-xgrids-owner-confirmation-v1",
        sourceFamily: "xgrids-grand-hall-big-model-variations",
        authorityStatus: "confirmed_by_project_owner",
        authorityStatement: "Authority status: confirmed by project owner",
        scope: [
          "data_use",
          "reconstruction",
          "training",
          "enhancement",
          "derivatives",
          "commercial_venviewer_development",
          "reverse_engineering",
          "software_integration",
        ],
        scopeStatement: "Scope: data use, reconstruction, training, enhancement, derivatives, commercial Venviewer development, reverse engineering and software integration",
        additionalPermissions: ["redistribution", "third_party_dissemination"],
        evidenceLocation: "PROJECT_EVIDENCE_STORE/PENDING_ATTACHMENT",
        evidenceLocationStatus: "pending",
        unrelatedLicensesRequireSeparateReview: true,
      },
    ],
    qualityEvidence: [
      {
        id: "exact-frontier-receipt",
        status: "machine_checked",
        confidence: "appearance_only",
        evidenceRefs: ["sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352"],
        limitations: ["No reviewed room-local transform or structural authority."],
      },
      {
        id: "pose-envelope-diagnostic",
        status: "unverified",
        confidence: "unknown",
        evidenceRefs: [SHA_B],
        limitations: ["Diagnostic navigation only; not a room shell or collision mesh."],
      },
    ],
    visualAssetManifests: [
      {
        id: "grand-hall-exact-sog-frontier",
        truthClass: "CAPTURED",
        format: "sog",
        lineageRole: "runtime_derivative",
        parentArtifactRefs: ["Grand_Hall.lcc2"],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        qualityEvidenceIds: ["exact-frontier-receipt"],
        members: [
          {
            id: "member-0",
            fileName: "0_0_0_1_0_1.sog",
            sha256: SHA_A,
            sizeBytes: 9_980_174,
            gaussianCount: 556_880,
          },
        ],
        totalBytes: 9_980_174,
        totalGaussianCount: 556_880,
      },
    ],
    transformArtifacts: [],
    layerDescriptors: [
      {
        id: "captured-appearance",
        kind: "Appearance",
        truthClass: "CAPTURED",
        source: {
          type: "visual_asset_set",
          visualAssetManifestId: "grand-hall-exact-sog-frontier",
        },
        authorities: ["appearance"],
        spatialRegistration: { type: "unregistered" },
        qualityEvidenceIds: ["exact-frontier-receipt"],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        intents: ["inspection", "dollhouse"],
        loadPolicy: "atomic",
        visibleByDefault: true,
      },
      {
        id: "captured-pose-envelope",
        kind: "StructuralProxy",
        truthClass: "RECONSTRUCTED",
        source: {
          type: "artifact",
          artifactRef: "grand-hall-navigation-profile/v0",
          sha256: SHA_B,
        },
        authorities: ["diagnostic_navigation"],
        spatialRegistration: {
          type: "inspection_placement",
          bindingRef: "grand-hall-source-inspection-transform-v1",
        },
        qualityEvidenceIds: ["pose-envelope-diagnostic"],
        sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
        intents: ["inspection"],
        loadPolicy: "synchronous",
        visibleByDefault: false,
      },
    ],
  };
}

function firstLayer(input: RoomSceneManifestV0Input) {
  const layer = input.layerDescriptors[0];
  if (layer === undefined) throw new Error("Expected a first test layer.");
  return layer;
}

function firstVisualAsset(input: RoomSceneManifestV0Input) {
  const visual = input.visualAssetManifests?.[0];
  if (visual === undefined) throw new Error("Expected a first test visual asset.");
  return visual;
}

function firstEvidence(input: RoomSceneManifestV0Input) {
  const evidence = input.qualityEvidence[0];
  if (evidence === undefined) throw new Error("Expected a first evidence record.");
  return evidence;
}

describe("RoomSceneManifestV0Schema", () => {
  it("pins the permanent truth classes and compositor layer slots", () => {
    expect(ROOM_SCENE_TRUTH_CLASSES).toEqual([
      "MEASURED",
      "CAPTURED",
      "RECONSTRUCTED",
      "ENHANCED_CAPTURED",
      "GENERATED_CINEMATIC",
      "PROCEDURAL_PLANNER",
    ]);
    expect(ROOM_SCENE_LAYER_KINDS).toEqual([
      "Appearance",
      "StructuralProxy",
      "Collision",
      "HeroVolume",
      "Semantic",
      "Planner",
      "CinematicDerivative",
    ]);
    expect(RECONSTRUCTION_PROVIDER_KINDS).toContain("neural_harmonic_textures");
    expect(ENHANCEMENT_PROVIDER_KINDS).toContain("artifixer");
    expect(MATERIAL_CHANNELS).toContain("roughness");
    expect(LIGHTING_VARIANT_KINDS).toContain("generated_relighting");
  });

  it("accepts one atomic captured appearance layer plus a source-derived diagnostic proxy", () => {
    const parsed = RoomSceneManifestV0Schema.parse(validManifest());

    expect(parsed.layerDescriptors).toHaveLength(2);
    expect(parsed.layerDescriptors[0]?.authorities).toEqual(["appearance"]);
    expect(parsed.layerDescriptors[1]?.truthClass).toBe("RECONSTRUCTED");
    expect(parsed.sourceRights[0]?.authorityStatement).toBe(
      "Authority status: confirmed by project owner",
    );
    expect(parsed.reconstructionProviders).toEqual([]);
    expect(parsed.enhancementProviders).toEqual([]);
    expect(parsed.materialAttachments).toEqual([]);
    expect(parsed.lightingVariants).toEqual([]);
  });

  it("accepts typed but inactive provider, material, and lighting integration records", () => {
    const input = validManifest();
    input.reconstructionProviders = [{
      id: "nht-provider-candidate",
      kind: "neural_harmonic_textures",
      availability: "integration_point",
      implementationRef: null,
      limitations: ["No Grand Hall implementation or bake-off result exists."],
    }];
    input.enhancementProviders = [{
      id: "artifixer-provider-candidate",
      kind: "artifixer",
      availability: "disabled",
      implementationRef: null,
      outputTruthClasses: ["GENERATED_CINEMATIC"],
      limitations: ["Licence and identity-preservation gates remain open."],
    }];
    input.materialAttachments = [{
      id: "material-candidate",
      truthClass: "RECONSTRUCTED",
      source: { type: "artifact", artifactRef: "material-candidate/v0", sha256: SHA_B },
      spatialRegistration: { type: "inspection_placement", bindingRef: "inspection-only" },
      sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
      qualityEvidenceIds: ["pose-envelope-diagnostic"],
      targetLayerIds: ["captured-appearance"],
      channels: ["normal", "roughness"],
    }];
    input.lightingVariants = [{
      id: "lighting-candidate",
      kind: "reconstructed_environment",
      truthClass: "RECONSTRUCTED",
      source: { type: "artifact", artifactRef: "lighting-candidate/v0", sha256: SHA_B },
      spatialRegistration: { type: "not_spatial" },
      sourceRightsId: "grand-hall-xgrids-owner-confirmation-v1",
      qualityEvidenceIds: ["pose-envelope-diagnostic"],
      targetLayerIds: ["captured-appearance"],
      activation: "manual",
    }];

    const parsed = RoomSceneManifestV0Schema.parse(input);
    expect(parsed.reconstructionProviders[0]?.availability).toBe("integration_point");
    expect(parsed.materialAttachments[0]?.channels).toEqual(["normal", "roughness"]);
    expect(parsed.lightingVariants[0]?.activation).toBe("manual");
  });

  it("rejects fake available providers and dangling supplemental references", () => {
    const providerInput = validManifest();
    providerInput.reconstructionProviders = [{
      id: "fake-provider",
      kind: "other",
      availability: "available",
      implementationRef: null,
      limitations: ["No implementation exists."],
    }];
    expect(RoomSceneManifestV0Schema.safeParse(providerInput).success).toBe(false);

    const materialInput = validManifest();
    materialInput.materialAttachments = [{
      id: "dangling-material",
      truthClass: "RECONSTRUCTED",
      source: { type: "artifact", artifactRef: "missing/v0", sha256: SHA_B },
      spatialRegistration: { type: "transform_artifact", transformArtifactId: "missing-transform" },
      sourceRightsId: "missing-rights",
      qualityEvidenceIds: ["missing-evidence"],
      targetLayerIds: ["missing-layer"],
      channels: ["albedo"],
    }];
    expect(RoomSceneManifestV0Schema.safeParse(materialInput).success).toBe(false);
  });

  it("rejects dangling visual, evidence, rights, and transform references", () => {
    const input = validManifest();
    input.layerDescriptors[0] = {
      ...firstLayer(input),
      source: { type: "visual_asset_set", visualAssetManifestId: "missing" },
      sourceRightsId: "missing-rights",
      qualityEvidenceIds: ["missing-evidence"],
      spatialRegistration: { type: "transform_artifact", transformArtifactId: "missing-transform" },
    };

    const result = RoomSceneManifestV0Schema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("declared visual asset manifest");
    expect(messages).toContain("declared quality evidence");
    expect(messages).toContain("declared source rights");
    expect(messages).toContain("declared TransformArtifactV0");
  });

  it("rejects generated cinematic authority over geometry, collision, planning, or export", () => {
    const input = validManifest();
    input.layerDescriptors[0] = {
      ...firstLayer(input),
      kind: "CinematicDerivative",
      truthClass: "GENERATED_CINEMATIC",
      authorities: ["appearance", "collision"],
    };

    expect(RoomSceneManifestV0Schema.safeParse(input).success).toBe(false);
  });

  it("requires planner layers to be PROCEDURAL_PLANNER and captured layers to remain non-operational", () => {
    const plannerInput = validManifest();
    plannerInput.layerDescriptors[0] = {
      ...firstLayer(plannerInput),
      kind: "Planner",
      truthClass: "CAPTURED",
      authorities: ["planning"],
    };
    expect(RoomSceneManifestV0Schema.safeParse(plannerInput).success).toBe(false);

    const capturedInput = validManifest();
    capturedInput.layerDescriptors[0] = {
      ...firstLayer(capturedInput),
      authorities: ["appearance", "geometry"],
    };
    expect(RoomSceneManifestV0Schema.safeParse(capturedInput).success).toBe(false);
  });

  it("verifies atomic visual totals instead of trusting duplicated summary fields", () => {
    const input = validManifest();
    if (input.visualAssetManifests === undefined) throw new Error("Expected visual assets.");
    input.visualAssetManifests[0] = {
      ...firstVisualAsset(input),
      totalBytes: 1,
      totalGaussianCount: 1,
    };

    expect(RoomSceneManifestV0Schema.safeParse(input).success).toBe(false);
  });

  it("rejects operational authority from fixture and inspection-only sources", () => {
    const fixtureInput = validManifest();
    fixtureInput.layerDescriptors[0] = {
      ...firstLayer(fixtureInput),
      truthClass: "RECONSTRUCTED",
      source: { type: "fixture", fixtureRef: "qa-only", label: "QA fixture" },
      authorities: ["geometry"],
      spatialRegistration: { type: "identity_in_rrf" },
    };
    expect(RoomSceneManifestV0Schema.safeParse(fixtureInput).success).toBe(false);

    const inspectionInput = validManifest();
    inspectionInput.layerDescriptors[0] = {
      ...firstLayer(inspectionInput),
      truthClass: "RECONSTRUCTED",
      source: { type: "artifact", artifactRef: "diagnostic", sha256: SHA_B },
      authorities: ["navigation"],
      spatialRegistration: { type: "inspection_placement", bindingRef: "inspection-only" },
    };
    expect(RoomSceneManifestV0Schema.safeParse(inspectionInput).success).toBe(false);
  });

  it("preserves visual-asset truth, rights, and evidence at the layer boundary", () => {
    const input = validManifest();
    input.layerDescriptors[0] = {
      ...firstLayer(input),
      truthClass: "MEASURED",
      sourceRightsId: null,
      qualityEvidenceIds: ["pose-envelope-diagnostic"],
      authorities: ["appearance"],
    };

    const result = RoomSceneManifestV0Schema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("preserve its asset manifest truth class");
    expect(messages).toContain("preserve its asset manifest source-rights record");
    expect(messages).toContain("retain all asset-manifest quality evidence");
  });

  it("does not promote not-run evidence or pending rights to reviewed authority", () => {
    const evidenceInput = validManifest();
    evidenceInput.qualityEvidence[0] = {
      ...firstEvidence(evidenceInput),
      status: "not_run",
      confidence: "survey_grade",
    };
    expect(RoomSceneManifestV0Schema.safeParse(evidenceInput).success).toBe(false);

    const rightsInput = validManifest();
    const rights = rightsInput.sourceRights?.[0];
    if (rights === undefined || rightsInput.sourceRights === undefined) throw new Error("Expected source rights.");
    rightsInput.sourceRights[0] = {
      ...rights,
      authorityStatus: "evidence_reviewed",
      evidenceLocationStatus: "pending",
    };
    expect(RoomSceneManifestV0Schema.safeParse(rightsInput).success).toBe(false);
  });

  it("retains the owner-confirmed dissemination grant without waiving unrelated licences", () => {
    const missingDissemination = validManifest();
    const rights = missingDissemination.sourceRights?.[0];
    if (rights === undefined || missingDissemination.sourceRights === undefined) {
      throw new Error("Expected source rights.");
    }
    missingDissemination.sourceRights[0] = {
      ...rights,
      additionalPermissions: [],
      unrelatedLicensesRequireSeparateReview: false,
    };

    expect(RoomSceneManifestV0Schema.safeParse(missingDissemination).success).toBe(false);
  });

  it("never promotes a splat asset into structural or collision authority", () => {
    const input = validManifest();
    input.visualAssetManifests = [{
      ...firstVisualAsset(input),
      truthClass: "RECONSTRUCTED",
    }];
    input.layerDescriptors[0] = {
      ...firstLayer(input),
      kind: "StructuralProxy",
      truthClass: "RECONSTRUCTED",
      authorities: ["geometry"],
      spatialRegistration: { type: "identity_in_rrf" },
    };

    expect(RoomSceneManifestV0Schema.safeParse(input).success).toBe(false);
  });

  it("rejects operational authority hidden on the wrong layer kind or machine-only evidence", () => {
    const collisionInput = validManifest();
    collisionInput.layerDescriptors[0] = {
      ...firstLayer(collisionInput),
      kind: "Appearance",
      truthClass: "RECONSTRUCTED",
      source: { type: "artifact", artifactRef: "collision-candidate/v0", sha256: SHA_B },
      authorities: ["collision"],
      spatialRegistration: { type: "identity_in_rrf" },
      qualityEvidenceIds: ["exact-frontier-receipt"],
    };
    expect(RoomSceneManifestV0Schema.safeParse(collisionInput).success).toBe(false);

    const navigationInput = validManifest();
    navigationInput.layerDescriptors[1] = {
      ...navigationInput.layerDescriptors[1]!,
      authorities: ["navigation"],
      spatialRegistration: { type: "identity_in_rrf" },
      qualityEvidenceIds: ["exact-frontier-receipt"],
    };
    expect(RoomSceneManifestV0Schema.safeParse(navigationInput).success).toBe(false);
  });

  it("rejects procedural supplemental sources and contradictory lighting truth", () => {
    const materialInput = validManifest();
    materialInput.materialAttachments = [{
      id: "procedural-material",
      truthClass: "RECONSTRUCTED",
      source: { type: "planner_state" },
      spatialRegistration: { type: "not_spatial" },
      qualityEvidenceIds: ["pose-envelope-diagnostic"],
      targetLayerIds: ["captured-appearance"],
      channels: ["albedo"],
    }];
    expect(RoomSceneManifestV0Schema.safeParse(materialInput).success).toBe(false);

    const lightingInput = validManifest();
    lightingInput.lightingVariants = [{
      id: "contradictory-lighting",
      kind: "captured_environment",
      truthClass: "GENERATED_CINEMATIC",
      source: { type: "planner_state" },
      spatialRegistration: { type: "not_spatial" },
      qualityEvidenceIds: ["pose-envelope-diagnostic"],
      targetLayerIds: ["captured-appearance"],
      activation: "cinematic_only",
    }];
    expect(RoomSceneManifestV0Schema.safeParse(lightingInput).success).toBe(false);
  });
});

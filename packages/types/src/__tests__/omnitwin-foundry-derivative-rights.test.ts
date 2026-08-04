import { describe, expect, it } from "vitest";
import {
  FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_POLICY_REVOCATION_V0,
  FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
  FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
  FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
  FoundryDerivativeRightsApprovalV0Schema,
  FoundryDerivativeRightsPolicyV0Schema,
  FoundryDerivativeRightsPolicyRevocationV0Schema,
  FoundryDerivativeRightsTrustedPolicyStateV0Schema,
  computeFoundryDerivativeRightsApprovalSha256,
  computeFoundryDerivativeRightsPolicySha256,
  computeFoundryDerivativeRightsPolicyRevocationSha256,
  computeFoundryDerivativeRightsRestrictionSha256,
  validateFoundryDerivativeRightsApproval,
} from "../omnitwin-foundry-derivative-rights.js";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_JOB_SPEC_V0,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
} from "../omnitwin-foundry.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const SHA_E = `sha256:${"e".repeat(64)}`;
const NOW = new Date("2026-07-14T11:00:00.000Z");

function rights(termsReference: string) {
  return {
    basis: "customer_owned" as const,
    commercialUse: "allowed" as const,
    modelTrainingUse: "allowed" as const,
    redistribution: "allowed" as const,
    termsReviewedAt: "2026-07-14T09:00:00.000Z",
    termsReference,
    restrictions: ["Internal lossless derivatives only."],
  };
}

function validManifest() {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "grand-hall",
    createdAt: "2026-07-14T09:30:00.000Z",
    createdBy: "intake-operator",
    sourceRoots: [
      {
        id: "mesh-root",
        kind: "local_directory",
        displayName: "Read-only mesh source",
        locationRedacted: "MESH_SOURCE_ROOT",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [],
    transforms: [],
    assets: [
      {
        id: "mesh-a",
        sourceRootId: "mesh-root",
        relativePath: "a.glb",
        inputType: "glb_gltf",
        mediaType: "model/gltf-binary",
        sizeBytes: 1_024,
        sha256: SHA_A,
        immutable: true,
        captureState: "official_export",
        accessState: "official_export",
        capturedAt: null,
        coordinateFrameId: null,
        calibrationAssetIds: [],
        parentAssetIds: [],
        rights: rights("https://rights.example/mesh-a"),
        provenanceClass: "captured",
        evidenceKinds: [],
        inspection: {
          geometryValue: "high",
          appearanceValue: "high",
          calibrationValue: "none",
          scaleValue: "high",
          metadataKeys: [],
          decisiveNextTest: "Validate decoded GLB semantic equality.",
        },
        notes: [],
      },
      {
        id: "mesh-b",
        sourceRootId: "mesh-root",
        relativePath: "b.glb",
        inputType: "glb_gltf",
        mediaType: "model/gltf-binary",
        sizeBytes: 2_048,
        sha256: SHA_B,
        immutable: true,
        captureState: "official_export",
        accessState: "official_export",
        capturedAt: null,
        coordinateFrameId: null,
        calibrationAssetIds: [],
        parentAssetIds: [],
        rights: rights("https://rights.example/mesh-b"),
        provenanceClass: "captured",
        evidenceKinds: [],
        inspection: {
          geometryValue: "high",
          appearanceValue: "high",
          calibrationValue: "none",
          scaleValue: "high",
          metadataKeys: [],
          decisiveNextTest: "Validate decoded GLB semantic equality.",
        },
        notes: [],
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved",
    sourceMutationPermitted: false,
  });
}

function jobFor(
  manifest: ReturnType<typeof validManifest>,
  stageOverrides: Record<string, unknown> = {},
  jobOverrides: Record<string, unknown> = {},
) {
  return FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "normalize-job",
    projectId: manifest.projectId,
    ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    executionIntent: "plan_only",
    providerKind: "local_cpu",
    providerAdapterId: "sealed-normalize-worker-v0",
    stages: [
      {
        id: "normalize-mesh",
        kind: "geometry",
        dependsOn: [],
        containerImage: `registry.example/normalize@${SHA_C}`,
        command: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v0"],
        inputAssetIds: ["mesh-a"],
        outputNames: ["normalized-meshes"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 2,
        ramGiB: 4,
        gpuCount: 0,
        minimumGpuVramGiB: 0,
        scratchGiB: 10,
        networkAccess: "none",
        checkpoint: "none",
        resumable: false,
        ...stageOverrides,
      },
    ],
    objectStorageProfile: null,
    sourceMountMode: "read_only",
    outputPrefix: "projects/grand-hall/normalize-job",
    estimatedCostUsd: 0,
    budgetCapUsd: 0,
    killSwitchEnabled: true,
    computeApprovalId: null,
    createdAt: "2026-07-14T10:00:00.000Z",
    ...jobOverrides,
  });
}

function validPolicy(overrides: Record<string, unknown> = {}) {
  return FoundryDerivativeRightsPolicyV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0,
    policyVersion: "derivative-rights-2026-07",
    generation: 1,
    effectiveAt: "2026-07-14T08:00:00.000Z",
    maximumApprovalTtlSeconds: 7_200,
    requireNonUnknownRightsBasis: true,
    requireHttpsTermsReference: true,
    requireTermsReviewedAt: true,
    authorizedActions: FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
    forbiddenDownstreamUses:
      FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
    operations: [
      {
        operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
        derivativeClass:
          FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
        requiredStageKind: "geometry",
        requiredInputType: "glb_gltf",
        requiredMediaType: "model/gltf-binary",
        requiredFileExtension: ".glb",
        requiredAssetCount: 1,
        requiredRightsPurposes: ["commercial_internal_use"],
        requiredCommand: [
          "omnitwin-sealed-worker",
          "normalize_mesh_glb",
          "v0",
        ],
        requiredNetworkAccess: "none",
        deterministic: true,
      },
    ],
    ...overrides,
  });
}

function revocationFor(
  policy: ReturnType<typeof validPolicy>,
  overrides: Record<string, unknown> = {},
) {
  return FoundryDerivativeRightsPolicyRevocationV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_POLICY_REVOCATION_V0,
    revocationId: "derivative-rights-revocation",
    policyVersion: policy.policyVersion,
    policyDefinitionSha256:
      computeFoundryDerivativeRightsPolicySha256(policy),
    policyGeneration: policy.generation,
    revokedAt: "2026-07-14T11:30:00.000Z",
    revokedBy: "rights-reviewer@example.test",
    reason: "The source owner withdrew permission for further derivatives.",
    ...overrides,
  });
}

function rightsEvidenceFor(
  asset: ReturnType<typeof validManifest>["assets"][number],
) {
  const termsEvidenceArtifact = {
    artifactId: `terms-${asset.id}`,
    sha256: asset.id === "mesh-a" ? SHA_D : SHA_E,
    sizeBytes: 2_048,
    mediaType: "application/pdf",
    capturedAt: "2026-07-14T08:55:00.000Z",
  };
  return {
    assetId: asset.id,
    basis: asset.rights.basis,
    termsReference: asset.rights.termsReference,
    reviewedAt: asset.rights.termsReviewedAt,
    termsEvidenceArtifact,
    restrictionsReviewed: true,
    restrictionDispositions: asset.rights.restrictions.map(
      (restrictionText, restrictionIndex) => ({
        restrictionIndex,
        restrictionText,
        restrictionSha256:
          computeFoundryDerivativeRightsRestrictionSha256({
            assetId: asset.id,
            restrictionIndex,
            restrictionText,
          }),
        disposition: "satisfied" as const,
        rationale:
          "The approved operation is an internal lossless derivative and satisfies this restriction.",
        supportingEvidenceSha256: termsEvidenceArtifact.sha256,
      }),
    ),
  };
}

function approvalFor(
  job: ReturnType<typeof jobFor>,
  manifest: ReturnType<typeof validManifest>,
  policy: ReturnType<typeof validPolicy>,
  overrides: Record<string, unknown> = {},
) {
  const stage = job.stages[0]!;
  const assetIds = [...stage.inputAssetIds].sort();
  return FoundryDerivativeRightsApprovalV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
    approvalId: "normalize-rights-approval",
    policyVersion: policy.policyVersion,
    policyDefinitionSha256:
      computeFoundryDerivativeRightsPolicySha256(policy),
    policyGeneration: policy.generation,
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    stageId: stage.id,
    operation: {
      operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
      derivativeClass:
        FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    },
    authorizedActions: FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
    forbiddenDownstreamUses:
      FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
    assetIds,
    assetRightsEvidence: assetIds.map((assetId) => {
      const asset = manifest.assets.find((candidate) => candidate.id === assetId)!;
      return rightsEvidenceFor(asset);
    }),
    assetSnapshots: assetIds.map(
      (assetId) =>
        manifest.assets.find((candidate) => candidate.id === assetId)!,
    ),
    decision: "allowed",
    decidedBy: "rights-reviewer@example.test",
    decidedAt: "2026-07-14T10:30:00.000Z",
    expiresAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  });
}

type DerivativeRightsFixture = {
  manifest: ReturnType<typeof validManifest>;
  job: ReturnType<typeof jobFor>;
  policy: ReturnType<typeof validPolicy>;
  policyRevocation: ReturnType<typeof revocationFor> | null;
  approval: ReturnType<typeof approvalFor>;
};

function fixture(): DerivativeRightsFixture {
  const manifest = validManifest();
  const job = jobFor(manifest);
  const policy = validPolicy();
  const approval = approvalFor(job, manifest, policy);
  return { manifest, job, policy, policyRevocation: null, approval };
}

function validate(
  values: ReturnType<typeof fixture>,
  now: Date = NOW,
) {
  return validateFoundryDerivativeRightsApproval(
    values.job,
    values.manifest,
    values.approval,
    now,
    FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse({
      definition: values.policy,
      revocation: values.policyRevocation,
    }),
  );
}

describe("Foundry derivative-rights contract", () => {
  it("validates an exact canonical stage asset set and remains evidence-only", () => {
    const values = fixture();
    const result = validate(values);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.approval.assetIds).toEqual(["mesh-a"]);
      expect(result.approval.decision).toBe("allowed");
    }
  });

  it("uses distinct, deterministic domain-separated definition, revocation, and approval digests", () => {
    const { policy, approval } = fixture();
    const revocation = revocationFor(policy);
    const policyDigest = computeFoundryDerivativeRightsPolicySha256(policy);
    const revocationDigest =
      computeFoundryDerivativeRightsPolicyRevocationSha256(revocation);
    const approvalDigest = computeFoundryDerivativeRightsApprovalSha256(approval);

    expect(policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(revocationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(approvalDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(policyDigest).toBe(computeFoundryDerivativeRightsPolicySha256(policy));
    expect(revocationDigest).not.toBe(policyDigest);
    expect(approvalDigest).not.toBe(policyDigest);
    expect(
      computeFoundryDerivativeRightsApprovalSha256({
        ...approval,
        approvalId: "normalize-rights-approval-2",
      }),
    ).not.toBe(approvalDigest);
    expect(
      computeFoundryDerivativeRightsPolicyRevocationSha256({
        ...revocation,
        reason: "A materially different withdrawal reason.",
      }),
    ).not.toBe(revocationDigest);
    expect(computeFoundryDerivativeRightsPolicySha256(policy)).toBe(
      approval.policyDefinitionSha256,
    );
  });

  it("keeps revocation out of the immutable policy definition and approval digest", () => {
    const { policy, approval } = fixture();
    const firstRevocation = revocationFor(policy);
    const changedRevocation = revocationFor(policy, {
      reason: "A later correction to the trusted revocation rationale.",
    });

    expect(
      FoundryDerivativeRightsPolicyV0Schema.safeParse({
        ...policy,
        revokedAt: firstRevocation.revokedAt,
      }).success,
    ).toBe(false);
    expect(computeFoundryDerivativeRightsApprovalSha256(approval)).toBe(
      computeFoundryDerivativeRightsApprovalSha256({ ...approval }),
    );
    expect(
      computeFoundryDerivativeRightsPolicyRevocationSha256(firstRevocation),
    ).not.toBe(
      computeFoundryDerivativeRightsPolicyRevocationSha256(changedRevocation),
    );
  });

  it.each(["revokedBy", "reason"])(
    "requires append-only revocation evidence field %s",
    (field) => {
      const { policy } = fixture();
      const revocation = revocationFor(policy);
      const candidate = { ...revocation, [field]: undefined };

      expect(
        FoundryDerivativeRightsPolicyRevocationV0Schema.safeParse(candidate)
          .success,
      ).toBe(false);
    },
  );

  it.each([
    {
      target: "policy",
      override: {
        authorizedActions: [
          "create_internal_derivative",
          "read_source",
        ],
      },
    },
    {
      target: "policy",
      override: {
        forbiddenDownstreamUses: ["model_training", "redistribution"],
      },
    },
    {
      target: "approval",
      override: { authorizedActions: ["read_source"] },
    },
    {
      target: "approval",
      override: {
        forbiddenDownstreamUses: [
          "model_training",
          "redistribution",
          "create_public_release",
        ],
      },
    },
  ])("rejects altered authorized actions or forbidden uses in the $target", ({ target, override }) => {
    const { policy, approval } = fixture();
    const result = target === "policy"
      ? FoundryDerivativeRightsPolicyV0Schema.safeParse({ ...policy, ...override })
      : FoundryDerivativeRightsApprovalV0Schema.safeParse({
          ...approval,
          ...override,
        });
    expect(result.success).toBe(false);
  });

  it.each([
    ["policyVersion", "another-policy"],
    ["policyGeneration", 2],
    ["policyDefinitionSha256", SHA_C],
  ])("rejects an approval with mismatched %s", (field, value) => {
    const values = fixture();
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      [field]: value,
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "derivative_rights_policy_subject_mismatch",
    });
  });

  it.each([
    ["policyVersion", "another-policy"],
    ["policyGeneration", 2],
    ["policyDefinitionSha256", SHA_C],
  ])("rejects a revocation with mismatched %s", (field, value) => {
    const values = fixture();
    values.policyRevocation = revocationFor(values.policy, {
      [field]: value,
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "derivative_rights_policy_revocation_subject_mismatch",
    });
  });

  it("rejects an approval for a different exact JobSpec subject", () => {
    const values = fixture();
    values.job = jobFor(values.manifest, {
      command: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v0", "--changed"],
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "job_subject_mismatch",
    });
  });

  it("rejects a manifest that differs from the job and approval subject", () => {
    const values = fixture();
    values.manifest = FoundryIngestManifestV0Schema.parse({
      ...values.manifest,
      assets: values.manifest.assets.map((asset) =>
        asset.id === "mesh-a"
          ? {
              ...asset,
              rights: {
                ...asset.rights,
                termsReference: "https://rights.example/mesh-a-updated",
              },
            }
          : asset,
      ),
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "ingest_manifest_subject_mismatch",
    });
  });

  it("rejects a job whose project differs from its exact manifest", () => {
    const values = fixture();
    values.job = jobFor(values.manifest, {}, { projectId: "other-project" });
    values.approval = approvalFor(
      values.job,
      values.manifest,
      values.policy,
    );

    expect(validate(values)).toEqual({
      valid: false,
      reason: "project_subject_mismatch",
    });
  });

  it.each([
    ["approved", true],
    ["requires_review", true],
    ["not_reviewed", true],
    ["blocked", false],
  ] as const)(
    "treats manifest legal-review state %s as exact scoped approval valid=%s",
    (legalReviewState, expectedValid) => {
      const manifest = FoundryIngestManifestV0Schema.parse({
        ...validManifest(),
        legalReviewState,
      });
      const job = jobFor(manifest);
      const policy = validPolicy();
      const approval = approvalFor(job, manifest, policy);
      const result = validate({
        manifest,
        job,
        policy,
        policyRevocation: null,
        approval,
      });

      expect(result.valid).toBe(expectedValid);
      if (!expectedValid) {
        expect(result).toEqual({
          valid: false,
          reason: "manifest_legal_review_blocked",
        });
      }
    },
  );

  it("rejects a missing stage subject", () => {
    const values = fixture();
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      stageId: "other-stage",
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_not_found",
    });
  });

  it.each([
    {
      operationId: "normalize_mesh_glb/v1",
      derivativeClass:
        FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    },
    {
      operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
      derivativeClass: "lossy_format_normalization",
    },
  ])("rejects an operation outside the active policy: $operationId/$derivativeClass", (operation) => {
    const values = fixture();
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      operation,
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "operation_policy_mismatch",
    });
  });

  it("rejects a valid job stage whose kind is incompatible with the operation", () => {
    const values = fixture();
    values.job = jobFor(values.manifest, { kind: "inspect" });
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_operation_mismatch",
    });
  });

  it.each([
    {
      command: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v1"],
    },
    { networkAccess: "restricted" },
  ])("rejects a stage whose sealed operation identity differs: $command$networkAccess", (stageOverride) => {
    const values = fixture();
    values.job = jobFor(values.manifest, stageOverride);
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_operation_mismatch",
    });
  });

  it.each([
    ["commercial_internal_use", "model_training"],
    ["commercial_internal_use", "redistribution"],
    ["commercial_internal_use", "public_release"],
    ["model_training", "commercial_internal_use"],
    ["model_training"],
  ])("rejects a forbidden use anywhere in the exact job: %j", (...rightsPurposes) => {
    const values = fixture();
    values.job = jobFor(values.manifest, { rightsPurposes });
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "forbidden_downstream_use_in_job",
      blockers: rightsPurposes
        .filter((purpose) => purpose !== "commercial_internal_use")
        .map((purpose) => `normalize-mesh:${purpose}`)
        .sort(),
    });
  });

  it.each(["model_training", "redistribution", "public_release"] as const)(
    "rejects forbidden use %s in a dependent later stage",
    (forbiddenPurpose) => {
      const values = fixture();
      const approvedStage = values.job.stages[0]!;
      values.job = jobFor(values.manifest, {}, {
        stages: [
          approvedStage,
          {
            ...approvedStage,
            id: "later-package",
            kind: "package",
            dependsOn: [approvedStage.id],
            command: ["omnitwin-sealed-worker", "package", "v0"],
            outputNames: ["later-package-output"],
            rightsPurposes: [forbiddenPurpose],
          },
        ],
      });
      values.approval = approvalFor(
        values.job,
        values.manifest,
        values.policy,
      );

      expect(validate(values)).toEqual({
        valid: false,
        reason: "forbidden_downstream_use_in_job",
        blockers: [`later-package:${forbiddenPurpose}`],
      });
    },
  );

  it("rejects an asset type incompatible with the GLB-only operation", () => {
    const values = fixture();
    values.manifest = FoundryIngestManifestV0Schema.parse({
      ...values.manifest,
      assets: values.manifest.assets.map((asset) =>
        asset.id === "mesh-a" ? { ...asset, inputType: "obj" } : asset,
      ),
    });
    values.job = jobFor(values.manifest);
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_operation_mismatch",
    });
  });

  it.each([
    { mediaType: "model/gltf+json" },
    { relativePath: "a.gltf" },
  ])("rejects a text-gltf-compatible source identity: $mediaType$relativePath", (assetOverride) => {
    const values = fixture();
    values.manifest = FoundryIngestManifestV0Schema.parse({
      ...values.manifest,
      assets: values.manifest.assets.map((asset) =>
        asset.id === "mesh-a" ? { ...asset, ...assetOverride } : asset,
      ),
    });
    values.job = jobFor(values.manifest);
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_operation_mismatch",
    });
  });

  it("rejects a generic geometry stage containing more than the one V0 GLB source", () => {
    const values = fixture();
    values.job = jobFor(values.manifest, {
      inputAssetIds: ["mesh-b", "mesh-a"],
    });
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(values.job),
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_asset_subject_mismatch",
    });
  });

  it("rejects an approval whose asset set is not the exact stage input set", () => {
    const values = fixture();
    const meshB = values.manifest.assets.find((asset) => asset.id === "mesh-b")!;
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      assetIds: ["mesh-b"],
      assetRightsEvidence: [rightsEvidenceFor(meshB)],
      assetSnapshots: [meshB],
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "stage_asset_subject_mismatch",
    });
  });

  it.each([
    { assetIds: ["mesh-b", "mesh-a"] },
    { assetIds: ["mesh-a", "mesh-a"] },
    {
      assetIds: ["mesh-a", "mesh-b"],
      assetRightsEvidence: [
        rightsEvidenceFor(validManifest().assets[0]!),
      ],
    },
  ])("requires sorted, unique, evidence-complete approval asset IDs", (overrides) => {
    const { approval } = fixture();
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...approval,
        ...overrides,
      }).success,
    ).toBe(false);
  });

  it("rejects additional reordered full asset snapshots in the single-source V0 approval", () => {
    const { approval, manifest } = fixture();
    const meshB = manifest.assets.find((asset) => asset.id === "mesh-b")!;
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...approval,
        assetIds: ["mesh-a", "mesh-b"],
        assetRightsEvidence: [
          approval.assetRightsEvidence[0],
          rightsEvidenceFor(meshB),
        ],
        assetSnapshots: [meshB, approval.assetSnapshots[0]],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      label: "media type",
      mutate: (snapshot: ReturnType<typeof validManifest>["assets"][number]) => ({
        ...snapshot,
        mediaType: "application/octet-stream",
      }),
    },
    {
      label: "free-text rights restrictions",
      mutate: (snapshot: ReturnType<typeof validManifest>["assets"][number]) => ({
        ...snapshot,
        rights: {
          ...snapshot.rights,
          restrictions: ["Internal derivatives only; no onward transfer."],
        },
      }),
    },
  ])("rejects a mutated full asset snapshot: $label", ({ mutate }) => {
    const values = fixture();
    const snapshot = mutate(values.approval.assetSnapshots[0]!);
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      assetRightsEvidence: [rightsEvidenceFor(snapshot)],
      assetSnapshots: [snapshot],
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "asset_record_snapshot_mismatch",
    });
  });

  it("digest-binds free-text restrictions in the complete asset snapshot", () => {
    const { approval } = fixture();
    const snapshot = {
      ...approval.assetSnapshots[0]!,
      rights: {
        ...approval.assetSnapshots[0]!.rights,
        restrictions: ["Internal derivatives only."],
      },
    };
    const changed = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...approval,
      assetRightsEvidence: [rightsEvidenceFor(snapshot)],
      assetSnapshots: [snapshot],
    });

    expect(computeFoundryDerivativeRightsApprovalSha256(changed)).not.toBe(
      computeFoundryDerivativeRightsApprovalSha256(approval),
    );
  });

  it("digest-binds terms evidence artifact metadata and content digest", () => {
    const { approval } = fixture();
    const evidence = approval.assetRightsEvidence[0]!;
    const changed = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...approval,
      assetRightsEvidence: [
        {
          ...evidence,
          termsEvidenceArtifact: {
            ...evidence.termsEvidenceArtifact,
            sha256: SHA_C,
            sizeBytes: evidence.termsEvidenceArtifact.sizeBytes + 1,
          },
          restrictionDispositions: evidence.restrictionDispositions.map(
            (disposition) => ({
              ...disposition,
              supportingEvidenceSha256: SHA_C,
            }),
          ),
        },
      ],
    });

    expect(computeFoundryDerivativeRightsApprovalSha256(changed)).not.toBe(
      computeFoundryDerivativeRightsApprovalSha256(approval),
    );
  });

  it("requires terms evidence capture no later than review and decision", () => {
    const { approval } = fixture();
    const evidence = approval.assetRightsEvidence[0]!;

    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...approval,
        assetRightsEvidence: [
          {
            ...evidence,
            termsEvidenceArtifact: {
              ...evidence.termsEvidenceArtifact,
              capturedAt: "2026-07-14T09:05:00.000Z",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires explicit restriction review even when the restriction set is empty", () => {
    const { approval } = fixture();
    const snapshot = {
      ...approval.assetSnapshots[0]!,
      rights: {
        ...approval.assetSnapshots[0]!.rights,
        restrictions: [],
      },
    };
    const evidence = rightsEvidenceFor(snapshot);
    const emptyRestrictionsApproval = {
      ...approval,
      assetRightsEvidence: [evidence],
      assetSnapshots: [snapshot],
    };
    const withoutAttestation = { ...evidence } as Record<string, unknown>;
    delete withoutAttestation.restrictionsReviewed;

    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse(
        emptyRestrictionsApproval,
      ).success,
    ).toBe(true);
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...emptyRestrictionsApproval,
        assetRightsEvidence: [
          { ...evidence, restrictionsReviewed: false },
        ],
      }).success,
    ).toBe(false);
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...emptyRestrictionsApproval,
        assetRightsEvidence: [withoutAttestation],
      }).success,
    ).toBe(false);
  });

  it("requires one exact ordered, reasoned, artifact-supported restriction disposition", () => {
    const { approval } = fixture();
    const evidence = approval.assetRightsEvidence[0]!;
    const disposition = evidence.restrictionDispositions[0]!;
    const invalidDispositionSets = [
      [],
      [{ ...disposition, restrictionIndex: 1 }],
      [{ ...disposition, restrictionText: "A different restriction." }],
      [{ ...disposition, restrictionSha256: SHA_C }],
      [{ ...disposition, supportingEvidenceSha256: SHA_C }],
      [{ ...disposition, disposition: "reviewed" }],
      [{ ...disposition, rationale: " " }],
    ];

    for (const restrictionDispositions of invalidDispositionSets) {
      expect(
        FoundryDerivativeRightsApprovalV0Schema.safeParse({
          ...approval,
          assetRightsEvidence: [
            { ...evidence, restrictionDispositions },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it("distinguishes duplicate restriction text by exact zero-based index", () => {
    const { approval } = fixture();
    const restrictionText = "No onward transfer.";
    const snapshot = {
      ...approval.assetSnapshots[0]!,
      rights: {
        ...approval.assetSnapshots[0]!.rights,
        restrictions: [restrictionText, restrictionText],
      },
    };
    const evidence = rightsEvidenceFor(snapshot);

    expect(evidence.restrictionDispositions.map((item) => item.restrictionIndex))
      .toEqual([0, 1]);
    expect(evidence.restrictionDispositions[0]!.restrictionSha256).not.toBe(
      evidence.restrictionDispositions[1]!.restrictionSha256,
    );
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...approval,
        assetRightsEvidence: [evidence],
        assetSnapshots: [snapshot],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["basis", "explicit_licence"],
    ["termsReference", "https://rights.example/different-review"],
    ["reviewedAt", "2026-07-14T09:05:00.000Z"],
  ])("rejects mismatched per-asset %s evidence", (field, value) => {
    const values = fixture();
    const updatedRights = {
      ...values.approval.assetSnapshots[0]!.rights,
      [field === "reviewedAt" ? "termsReviewedAt" : field]: value,
    };
    values.approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...values.approval,
      assetRightsEvidence: values.approval.assetRightsEvidence.map((evidence) =>
        evidence.assetId === "mesh-a"
          ? { ...evidence, [field]: value }
          : evidence,
      ),
      assetSnapshots: values.approval.assetSnapshots.map((snapshot) =>
        snapshot.id === "mesh-a"
          ? { ...snapshot, rights: updatedRights }
          : snapshot,
      ),
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "asset_rights_evidence_mismatch",
    });
  });

  it.each([
    { basis: "unknown" },
    { termsReference: "http://rights.example/mesh-a" },
    { reviewedAt: null },
  ])("rejects incomplete or non-HTTPS approval evidence: $basis$termsReference$reviewedAt", (evidenceOverride) => {
    const { approval } = fixture();
    expect(
      FoundryDerivativeRightsApprovalV0Schema.safeParse({
        ...approval,
        assetRightsEvidence: approval.assetRightsEvidence.map((evidence) =>
          evidence.assetId === "mesh-a"
            ? { ...evidence, ...evidenceOverride }
            : evidence,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects an incomplete manifest evidence record even when approval evidence is populated", () => {
    const base = fixture();
    const manifest = FoundryIngestManifestV0Schema.parse({
      ...base.manifest,
      assets: base.manifest.assets.map((asset) =>
        asset.id === "mesh-a"
          ? {
              ...asset,
              rights: {
                ...asset.rights,
                basis: "unknown",
                termsReviewedAt: null,
                termsReference: null,
              },
            }
          : asset,
      ),
      legalReviewState: "requires_review",
    });
    const job = jobFor(manifest);
    const approval = FoundryDerivativeRightsApprovalV0Schema.parse({
      ...base.approval,
      jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
      ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    });

    expect(validate({ ...base, manifest, job, approval })).toEqual({
      valid: false,
      reason: "asset_rights_evidence_incomplete",
    });
  });

  it("still requires the existing purpose-aware static job-rights gate", () => {
    const values = fixture();
    values.manifest = FoundryIngestManifestV0Schema.parse({
      ...values.manifest,
      assets: values.manifest.assets.map((asset) =>
        asset.id === "mesh-a"
          ? {
              ...asset,
              rights: { ...asset.rights, commercialUse: "restricted" },
            }
          : asset,
      ),
      legalReviewState: "requires_review",
    });
    values.job = jobFor(values.manifest);
    values.approval = approvalFor(values.job, values.manifest, values.policy);

    expect(validate(values)).toEqual({
      valid: false,
      reason: "static_job_rights_not_allowed",
      blockers: ["normalize-mesh:mesh-a:commercial_use_not_allowed"],
    });
  });

  it.each([
    {
      expected: "job_not_yet_valid",
      create: () => {
        const values = fixture();
        values.job = jobFor(values.manifest, {}, {
          createdAt: "2026-07-14T11:15:00.000Z",
        });
        values.approval = approvalFor(values.job, values.manifest, values.policy, {
          decidedAt: "2026-07-14T11:30:00.000Z",
          expiresAt: "2026-07-14T12:30:00.000Z",
        });
        return values;
      },
    },
    {
      expected: "approval_predates_job",
      create: () => {
        const values = fixture();
        values.approval = approvalFor(values.job, values.manifest, values.policy, {
          decidedAt: "2026-07-14T09:30:00.000Z",
          expiresAt: "2026-07-14T11:30:00.000Z",
        });
        return values;
      },
    },
    {
      expected: "approval_predates_policy",
      create: () => {
        const values = fixture();
        values.policy = validPolicy({
          effectiveAt: "2026-07-14T10:15:00.000Z",
        });
        values.approval = approvalFor(values.job, values.manifest, values.policy, {
          decidedAt: "2026-07-14T10:05:00.000Z",
          expiresAt: "2026-07-14T11:05:00.000Z",
        });
        return values;
      },
    },
    {
      expected: "approval_not_yet_valid",
      create: () => {
        const values = fixture();
        values.approval = approvalFor(values.job, values.manifest, values.policy, {
          decidedAt: "2026-07-14T11:15:00.000Z",
          expiresAt: "2026-07-14T12:15:00.000Z",
        });
        return values;
      },
    },
    {
      expected: "approval_expired",
      create: () => {
        const values = fixture();
        values.approval = approvalFor(values.job, values.manifest, values.policy, {
          expiresAt: "2026-07-14T11:00:00.000Z",
        });
        return values;
      },
    },
    {
      expected: "approval_ttl_exceeds_policy",
      create: () => {
        const values = fixture();
        values.policy = validPolicy({ maximumApprovalTtlSeconds: 3_000 });
        values.approval = approvalFor(values.job, values.manifest, values.policy);
        return values;
      },
    },
    {
      expected: "approval_outlives_policy",
      create: () => {
        const values = fixture();
        values.policyRevocation = revocationFor(values.policy, {
          revokedAt: "2026-07-14T11:30:00.000Z",
        });
        return values;
      },
    },
  ])("rejects invalid temporal binding: $expected", ({ expected, create }) => {
    expect(validate(create())).toEqual({ valid: false, reason: expected });
  });

  it("rejects a policy before its effective time or at/after revocation", () => {
    const future = fixture();
    future.policy = validPolicy({
      effectiveAt: "2026-07-14T11:30:00.000Z",
    });
    future.approval = approvalFor(future.job, future.manifest, future.policy, {
      decidedAt: "2026-07-14T11:40:00.000Z",
      expiresAt: "2026-07-14T12:40:00.000Z",
    });
    expect(validate(future)).toEqual({
      valid: false,
      reason: "derivative_rights_policy_inactive",
    });

    const revoked = fixture();
    revoked.policyRevocation = revocationFor(revoked.policy, {
      revokedAt: "2026-07-14T10:45:00.000Z",
    });
    expect(validate(revoked)).toEqual({
      valid: false,
      reason: "derivative_rights_policy_inactive",
    });
  });

  it("allows an approval ending exactly at a future revocation, then closes authority", () => {
    const values = fixture();
    values.policyRevocation = revocationFor(values.policy, {
      revokedAt: values.approval.expiresAt,
    });

    expect(validate(values).valid).toBe(true);
    expect(validate(values, new Date(values.approval.expiresAt))).toEqual({
      valid: false,
      reason: "derivative_rights_policy_inactive",
    });
  });

  it("rejects revocation evidence that does not follow policy effectiveness", () => {
    const values = fixture();
    values.policyRevocation = revocationFor(values.policy, {
      revokedAt: values.policy.effectiveAt,
    });

    expect(validate(values)).toEqual({
      valid: false,
      reason: "derivative_rights_policy_revocation_predates_policy",
    });
  });

  it("rejects a non-finite validation instant", () => {
    expect(validate(fixture(), new Date(Number.NaN))).toEqual({
      valid: false,
      reason: "invalid_validation_time",
    });
  });
});

import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0 =
  "omnitwin.foundry.local-e57-intake-environment.v0";
export const FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const REVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/u;

const EXACT_ARTIFACT_IDS = [
  "cpython-runtime",
  "pye57-wheel",
  "numpy-wheel",
  "pyquaternion-wheel",
] as const;

const EXACT_ARTIFACT_RECEIPTS = {
  "cpython-runtime": {
    filename: "python-3.13.14-embed-amd64.zip",
    byteSize: 10_964_839,
    sha256: "90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907",
    archiveMemberCount: 34,
    metadataMemberPath: null,
    metadataMemberByteSize: null,
    metadataMemberSha256: null,
  },
  "pye57-wheel": {
    filename: "pye57-0.4.19-cp313-cp313-win_amd64.whl",
    byteSize: 1_130_809,
    sha256: "d27332054bf18689acb45470a3bc16d4c21ed7b0b0848c56ef9e42cc8980a3c4",
    archiveMemberCount: 13,
    metadataMemberPath: "pye57-0.4.19.dist-info/METADATA",
    metadataMemberByteSize: 4_949,
    metadataMemberSha256:
      "ee0862fb1bc01a38863826e4171c4480fc3379617abd6025ea426c888cc3c8f7",
  },
  "numpy-wheel": {
    filename: "numpy-2.5.1-cp313-cp313-win_amd64.whl",
    byteSize: 12_425_674,
    sha256: "6c3fe51bc6a16453d452997053454f309e8e0ed7b42d6b361ce4ac8c32913d74",
    archiveMemberCount: 1_064,
    metadataMemberPath: "numpy-2.5.1.dist-info/METADATA",
    metadataMemberByteSize: 6_584,
    metadataMemberSha256:
      "6ae45122ee97050e48849438320430d05f01814f72e66e69cbeed027d2c6a1e8",
  },
  "pyquaternion-wheel": {
    filename: "pyquaternion-0.9.9-py3-none-any.whl",
    byteSize: 14_361,
    sha256: "e65f6e3f7b1fdf1a9e23f82434334a1ae84f14223eee835190cd2e841f8172ec",
    archiveMemberCount: 7,
    metadataMemberPath: "pyquaternion-0.9.9.dist-info/METADATA",
    metadataMemberByteSize: 1_404,
    metadataMemberSha256:
      "b2e3cbcf664c8af0e96d24cfafdf6d342f7b14bf8cf60c8e69e7e29fcfdebe09",
  },
} as const;

const EXACT_DEPENDENCY_EDGES = [
  ["pye57-wheel", "numpy-wheel"],
  ["pye57-wheel", "pyquaternion-wheel"],
  ["pyquaternion-wheel", "numpy-wheel"],
] as const;

const EXACT_RUNTIME_ALTERNATIVE_IDS = [
  "cpython-3.10.11-embed",
  "cpython-3.10.20-source",
  "system-python-3.13.6",
] as const;

const EXACT_NATIVE_INCLUSION_IDS = [
  "libe57format",
  "crcpp",
  "xerces-c",
  "pybind11",
] as const;

const EXACT_OPEN_ITEM_IDS = [
  "microsoft-cpp-runtime",
  "pybind11-build-version",
  "redistribution-pack",
  "exact-extracted-member-manifest",
  "clean-host-bundle-smoke",
  "adapter-runtime-bundle-binding",
] as const;

const PYE57_MEMBER_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_PYE57_MEMBER_INVENTORY_V0";
const EXACT_PYE57_MEMBER_INVENTORY_SHA256 =
  "7bd03f77a183a4390517b7ca3cf31488deab48b1a6f3ec43ececcde0da9a1cbc";
const NATIVE_INCLUSION_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_NATIVE_INCLUSION_INVENTORY_V0";
const EXACT_NATIVE_INCLUSION_INVENTORY_SHA256 =
  "796d2aa8b19da1c7f69096358075a5396b114afb115c0bf4bcc3e42f376c0929";
const LEGAL_MATERIAL_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_LEGAL_MATERIAL_INVENTORY_V0";
const EXACT_LEGAL_MATERIAL_INVENTORY_SHA256 =
  "7f3a44eff7ea4936140a8bc050c51db4e0d39467dedafa001d53c07c69958b46";

function equalOrderedStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

const ExactArtifactSchema = z.object({
  id: z.enum(EXACT_ARTIFACT_IDS),
  role: z.string().trim().min(1).max(240),
  packageName: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80),
  kind: z.enum(["python_embeddable_zip", "pypi_wheel"]),
  filename: z.string().trim().min(1).max(240),
  url: z.string().url().max(1_000),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  digestEvidence: z.literal("publisher_attested_and_observed"),
  pythonTag: z.enum(["cp313", "py3", "not_applicable"]),
  abiTag: z.enum(["cp313", "none", "not_applicable"]),
  platformTag: z.enum(["win_amd64", "any"]),
  requiresPython: z.string().trim().min(1).max(80).nullable(),
  licenseExpression: z.string().trim().min(1).max(240),
  archiveMemberCount: z.number().int().positive(),
  metadataMemberPath: z.string().trim().min(1).max(500).nullable(),
  metadataMemberByteSize: z.number().int().positive().nullable(),
  metadataMemberSha256: z.string().regex(SHA256_HEX).nullable(),
  installationState: z.literal("not_installed"),
  runtimeVerificationState: z.enum([
    "isolated_synthetic_compatibility_observed",
    "not_executed_directly",
  ]),
}).strict();

const DependencyEdgeSchema = z.object({
  fromArtifactId: z.enum(EXACT_ARTIFACT_IDS),
  toArtifactId: z.enum(EXACT_ARTIFACT_IDS),
  requirement: z.string().trim().min(1).max(160),
  scope: z.literal("runtime"),
}).strict();

const Pye57MemberReceiptSchema = z.object({
  path: z.string().trim().min(1).max(500),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

const NativeInclusionSchema = z.object({
  id: z.enum(EXACT_NATIVE_INCLUSION_IDS),
  label: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(80),
  revision: z.string().regex(/^(?:[a-f0-9]{40}|unresolved)$/u),
  disposition: z.enum([
    "compiled_into_pye57_extension",
    "bundled_dynamic_library",
    "build_dependency_version_unresolved",
  ]),
  binaryMemberPath: z.string().trim().min(1).max(500).nullable(),
  binaryMemberByteSize: z.number().int().positive().nullable(),
  binaryMemberSha256: z.string().regex(SHA256_HEX).nullable(),
  evidenceState: z.enum([
    "source_lineage_recorded_binary_reproducibility_not_proven",
    "exact_bundled_binary_recorded",
    "unresolved",
  ]),
  boundary: z.string().trim().min(1).max(700),
}).strict();

const LegalMaterialSchema = z.object({
  id: z.string().regex(SAFE_ID),
  componentId: z.string().regex(SAFE_ID),
  kind: z.enum(["license", "notice", "publisher_sbom"]),
  source: z.enum(["archive_member", "immutable_url"]),
  artifactId: z.enum(EXACT_ARTIFACT_IDS).nullable(),
  memberPath: z.string().trim().min(1).max(500).nullable(),
  url: z.string().url().max(1_000).nullable(),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  redistributionAction: z.enum([
    "preserve_from_selected_archive",
    "copy_into_future_redistribution_pack",
    "preserve_as_publisher_inventory_evidence",
  ]),
}).strict().superRefine((material, ctx) => {
  if (
    material.source === "archive_member" &&
    (material.artifactId === null || material.memberPath === null ||
      material.url !== null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "archive-member legal evidence requires an artifact and member path only",
    });
  }
  if (
    material.source === "immutable_url" &&
    (material.url === null || material.artifactId !== null ||
      material.memberPath !== null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "URL legal evidence requires an immutable URL only",
    });
  }
});

const RuntimeAlternativeSchema = z.object({
  id: z.enum(EXACT_RUNTIME_ALTERNATIVE_IDS),
  version: z.string().trim().min(1).max(80),
  disposition: z.enum([
    "not_selected_legacy_binary",
    "not_selected_source_build",
    "not_selected_machine_local_evidence_only",
  ]),
  reason: z.string().trim().min(1).max(700),
}).strict();

const OpenItemSchema = z.object({
  id: z.enum(EXACT_OPEN_ITEM_IDS),
  label: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(700),
  decisiveNextTest: z.string().trim().min(1).max(700),
}).strict();

const LocalE57IntakeEnvironmentPayloadShape = {
  schemaVersion: z.literal(FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0),
  manifestId: z.string().regex(SAFE_ID),
  reviewedOn: z.string().regex(REVIEW_DATE),
  parentHdWorkerManifestSha256: z.string().regex(SHA256_HEX),
  reviewClass: z.literal("engineering_dependency_closure"),
  overall: z.literal(
    "exact_artifacts_recorded_bundle_not_materialized_not_execution_ready",
  ),
  environmentState: z.literal(
    "recorded_with_materialization_and_runtime_closure_open",
  ),
  installationState: z.literal("not_installed"),
  bundleVerificationState: z.literal("not_performed"),
  binding: z.literal("not_bound_to_current_source_or_plan"),
  execution: z.literal("disabled"),
  authority: z.literal("none"),
  target: z.object({
    operatingSystem: z.literal("windows"),
    architecture: z.literal("x64"),
    pythonImplementation: z.literal("CPython"),
    pythonVersion: z.literal("3.13.14"),
    pythonAbi: z.literal("cp313"),
    distribution: z.literal("application_local_embeddable"),
    laneScope: z.literal("e57_read_only_intake_only"),
    parentE57CandidateDisposition: z.literal(
      "superseded_by_this_environment",
    ),
    unifiedWithOpen3d: z.literal(false),
  }).strict(),
  runtimeDecision: z.object({
    selectedArtifactId: z.literal("cpython-runtime"),
    rationale: z.string().trim().min(1).max(700),
    alternatives: z.array(RuntimeAlternativeSchema).min(3).max(3),
  }).strict(),
  activity: z.object({
    packageInstallerUsed: z.literal(false),
    systemInstallationPerformed: z.literal(false),
    isolatedArchiveExtractionPerformed: z.literal(true),
    isolatedSyntheticCompatibilitySmokePerformed: z.literal(true),
    venueDataAccessed: z.literal(false),
    userProvidedSourceFileRead: z.literal(false),
    syntheticFixtureFileRead: z.literal(true),
    cloudWorkloadStarted: z.literal(false),
  }).strict(),
  artifacts: z.array(ExactArtifactSchema).min(4).max(4),
  dependencyEdges: z.array(DependencyEdgeSchema).min(3).max(3),
  pye57Wheel: z.object({
    artifactId: z.literal("pye57-wheel"),
    memberInventoryState: z.literal("exact_13_members_recorded"),
    recordVerificationState: z.literal("all_hashed_entries_verified"),
    members: z.array(Pye57MemberReceiptSchema).min(13).max(13),
    aggregateOnlyReadContract: z.literal(true),
    pointRecordReadsAllowed: z.literal(false),
    embeddedImageReadsAllowed: z.literal(false),
    writeModeAllowedForProductIntake: z.literal(false),
  }).strict(),
  nativeInclusions: z.array(NativeInclusionSchema).min(4).max(4),
  legal: z.object({
    archiveLicenseInventoryState: z.literal("recorded"),
    nativeLegalSourceState: z.literal(
      "recorded_except_exact_pybind11_notice",
    ),
    redistributionPackState: z.literal("not_assembled"),
    redistributionReviewState: z.literal("not_final"),
    materials: z.array(LegalMaterialSchema).min(20).max(60),
  }).strict(),
  compatibilityEvidence: z.object({
    state: z.literal("isolated_unbundled_synthetic_smoke_passed"),
    pythonVersion: z.literal("3.13.14"),
    numpyVersion: z.literal("2.5.1"),
    pye57Version: z.literal("0.4.19"),
    pyquaternionVersion: z.literal("0.9.9"),
    fixture: z.literal("synthetic_three_cartesian_point_e57"),
    checks: z.tuple([
      z.literal("package_imports"),
      z.literal("quaternion_rotation"),
      z.literal("synthetic_e57_write_read_roundtrip"),
    ]),
    installed: z.literal(false),
    bundleUnderTest: z.literal(false),
    venueDataAccessed: z.literal(false),
    observationReceipt: z.object({
      observationId: z.literal(
        "t536-cp313-isolated-synthetic-smoke-2026-07-19",
      ),
      observedAtUtc: z.literal("2026-07-19T03:10:04.1608743Z"),
      fixtureByteSize: z.literal(4_096),
      fixtureSha256: z.literal(
        "91f2b9a039358efb2b724d9fb254e0f827ff34a88e03a9d8df7d123f09b1db31",
      ),
      pythonCommandBodyByteSize: z.literal(402),
      pythonCommandBodySha256: z.literal(
        "f4f6f9f4b1f005dbf548e36f9d1c93af3bf7c94df0257d41790731a7cf748f14",
      ),
      observedRecordCount: z.literal(3),
      logState: z.literal("tool_transcript_only_no_repository_log"),
    }).strict(),
    limitation: z.string().trim().min(1).max(700),
  }).strict(),
  bundle: z.object({
    state: z.literal("not_materialized"),
    bundleSha256: z.null(),
    exactExtractedMemberManifestState: z.literal("not_created"),
    legalPackState: z.literal("not_assembled"),
    microsoftCppRuntimeState: z.literal("host_dependency_observed_not_closed"),
    cleanHostVerificationState: z.literal("not_performed"),
    adapterBindingState: z.literal("not_wired"),
  }).strict(),
  openItems: z.array(OpenItemSchema).min(6).max(6),
  nextAction: z.string().trim().min(1).max(700),
} as const;

const _LocalE57IntakeEnvironmentPayloadSchema = z
  .object(LocalE57IntakeEnvironmentPayloadShape)
  .strict();
type LocalE57IntakeEnvironmentPayloadForValidation = z.infer<
  typeof _LocalE57IntakeEnvironmentPayloadSchema
>;

function validateLocalE57IntakeEnvironmentPayload(
  manifest: LocalE57IntakeEnvironmentPayloadForValidation,
  ctx: z.RefinementCtx,
): void {
  const artifactIds = manifest.artifacts.map((artifact) => artifact.id);
  if (!equalOrderedStrings(artifactIds, EXACT_ARTIFACT_IDS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "artifacts must match the exact ordered CPython 3.13 E57 environment",
    });
  }

  const artifacts = new Map(
    manifest.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const cpython = artifacts.get("cpython-runtime");
  const pye57 = artifacts.get("pye57-wheel");
  const numpy = artifacts.get("numpy-wheel");
  const pyquaternion = artifacts.get("pyquaternion-wheel");
  if (
    cpython?.version !== "3.13.14" ||
    cpython.kind !== "python_embeddable_zip" ||
    cpython.pythonTag !== "not_applicable" ||
    cpython.abiTag !== "not_applicable" ||
    cpython.platformTag !== "win_amd64" ||
    pye57?.version !== "0.4.19" ||
    pye57.pythonTag !== "cp313" ||
    pye57.abiTag !== "cp313" ||
    pye57.platformTag !== "win_amd64" ||
    numpy?.version !== "2.5.1" ||
    numpy.pythonTag !== "cp313" ||
    numpy.abiTag !== "cp313" ||
    numpy.platformTag !== "win_amd64" ||
    pyquaternion?.version !== "0.9.9" ||
    pyquaternion.pythonTag !== "py3" ||
    pyquaternion.abiTag !== "none" ||
    pyquaternion.platformTag !== "any"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "artifact versions and Python/ABI/platform tags must match the exact cp313 lane",
    });
  }
  for (const [artifactIndex, artifact] of manifest.artifacts.entries()) {
    const expected = EXACT_ARTIFACT_RECEIPTS[artifact.id];
    if (
      artifact.filename !== expected.filename ||
      artifact.byteSize !== expected.byteSize ||
      artifact.sha256 !== expected.sha256 ||
      artifact.archiveMemberCount !== expected.archiveMemberCount ||
      artifact.metadataMemberPath !== expected.metadataMemberPath ||
      artifact.metadataMemberByteSize !== expected.metadataMemberByteSize ||
      artifact.metadataMemberSha256 !== expected.metadataMemberSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts", artifactIndex],
        message:
          "artifact receipt and archive metadata must match the exact observed cp313 lane bytes",
      });
    }
  }

  const edges = manifest.dependencyEdges.map((edge) => [
    edge.fromArtifactId,
    edge.toArtifactId,
  ] as const);
  if (
    edges.length !== EXACT_DEPENDENCY_EDGES.length ||
    edges.some((edge, index) =>
      edge[0] !== EXACT_DEPENDENCY_EDGES[index]?.[0] ||
      edge[1] !== EXACT_DEPENDENCY_EDGES[index]?.[1])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dependencyEdges"],
      message: "runtime dependency edges must match the complete three-edge Python package graph",
    });
  }

  const memberPaths = manifest.pye57Wheel.members.map((member) => member.path);
  const pye57MemberInventorySha256 = domainSeparatedSha256(
    PYE57_MEMBER_INVENTORY_DIGEST_DOMAIN,
    toCanonicalJson(manifest.pye57Wheel.members),
  );
  if (
    pye57MemberInventorySha256 !== EXACT_PYE57_MEMBER_INVENTORY_SHA256 ||
    new Set(memberPaths).size !== memberPaths.length ||
    !memberPaths.includes("pye57/libe57.cp313-win_amd64.pyd") ||
    !memberPaths.includes("pye57/xerces-c_3_2.dll") ||
    memberPaths.some((path) => path.includes("cp310"))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pye57Wheel", "members"],
      message:
        "pye57 wheel members must match all 13 exact ordered path, size, and hash receipts",
    });
  }
  const pye57MetadataReceipt = manifest.pye57Wheel.members.find(
    (member) => member.path === pye57?.metadataMemberPath,
  );
  if (
    pye57 === undefined ||
    pye57.archiveMemberCount !== manifest.pye57Wheel.members.length ||
    pye57MetadataReceipt === undefined ||
    pye57MetadataReceipt.byteSize !== pye57.metadataMemberByteSize ||
    pye57MetadataReceipt.sha256 !== pye57.metadataMemberSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pye57Wheel", "members"],
      message:
        "the pye57 artifact member count and metadata receipt must cross-link to its exact wheel inventory",
    });
  }

  const alternativeIds = manifest.runtimeDecision.alternatives.map(
    (alternative) => alternative.id,
  );
  if (!equalOrderedStrings(alternativeIds, EXACT_RUNTIME_ALTERNATIVE_IDS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtimeDecision", "alternatives"],
      message: "runtime alternatives must preserve the exact v0 decision record",
    });
  }

  const nativeIds = manifest.nativeInclusions.map((inclusion) => inclusion.id);
  const nativeInventorySha256 = domainSeparatedSha256(
    NATIVE_INCLUSION_INVENTORY_DIGEST_DOMAIN,
    toCanonicalJson(manifest.nativeInclusions),
  );
  if (
    !equalOrderedStrings(nativeIds, EXACT_NATIVE_INCLUSION_IDS) ||
    nativeInventorySha256 !== EXACT_NATIVE_INCLUSION_INVENTORY_SHA256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nativeInclusions"],
      message:
        "native inclusions must preserve the exact ordered lineage, disposition, and binary receipts",
    });
  }
  for (const [nativeIndex, inclusion] of manifest.nativeInclusions.entries()) {
    if (inclusion.binaryMemberPath === null) continue;
    const member = manifest.pye57Wheel.members.find(
      (candidate) => candidate.path === inclusion.binaryMemberPath,
    );
    if (
      member === undefined ||
      member.byteSize !== inclusion.binaryMemberByteSize ||
      member.sha256 !== inclusion.binaryMemberSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nativeInclusions", nativeIndex],
        message:
          "native binary receipts must cross-link to the exact pye57 wheel member receipts",
      });
    }
  }
  const pybind11 = manifest.nativeInclusions.find(
    (inclusion) => inclusion.id === "pybind11",
  );
  if (
    pybind11?.version !== "unresolved" ||
    pybind11.revision !== "unresolved" ||
    pybind11.evidenceState !== "unresolved"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nativeInclusions"],
      message: "the pye57 publisher wheel must not imply a resolved pybind11 build version",
    });
  }

  const legalIds = manifest.legal.materials.map((material) => material.id);
  const legalInventorySha256 = domainSeparatedSha256(
    LEGAL_MATERIAL_INVENTORY_DIGEST_DOMAIN,
    toCanonicalJson(manifest.legal.materials),
  );
  if (
    new Set(legalIds).size !== legalIds.length ||
    legalInventorySha256 !== EXACT_LEGAL_MATERIAL_INVENTORY_SHA256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["legal", "materials"],
      message:
        "legal materials must match the exact ordered 29-item identity and receipt inventory",
    });
  }
  for (const [materialIndex, material] of manifest.legal.materials.entries()) {
    if (material.source !== "archive_member") continue;
    if (material.componentId !== material.artifactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["legal", "materials", materialIndex],
        message: "archive legal materials must bind the same component and artifact",
      });
    }
    if (material.artifactId !== "pye57-wheel") continue;
    const member = manifest.pye57Wheel.members.find(
      (candidate) => candidate.path === material.memberPath,
    );
    if (
      member === undefined ||
      member.byteSize !== material.byteSize ||
      member.sha256 !== material.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["legal", "materials", materialIndex],
        message:
          "pye57 archive legal material must cross-link to its exact wheel member receipt",
      });
    }
  }

  const openItemIds = manifest.openItems.map((item) => item.id);
  if (!equalOrderedStrings(openItemIds, EXACT_OPEN_ITEM_IDS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openItems"],
      message: "open items must preserve the exact fail-closed v0 bundle gates",
    });
  }
}

export const FoundryLocalE57IntakeEnvironmentPayloadV0Schema = z
  .object(LocalE57IntakeEnvironmentPayloadShape)
  .strict()
  .superRefine(validateLocalE57IntakeEnvironmentPayload);

export const FoundryLocalE57IntakeEnvironmentV0Schema = z.object({
  ...LocalE57IntakeEnvironmentPayloadShape,
  environmentSha256: z.string().regex(SHA256_HEX),
}).strict().superRefine(validateLocalE57IntakeEnvironmentPayload);

export type FoundryLocalE57IntakeEnvironmentPayloadV0 = z.infer<
  typeof FoundryLocalE57IntakeEnvironmentPayloadV0Schema
>;
export type FoundryLocalE57IntakeEnvironmentV0 = z.infer<
  typeof FoundryLocalE57IntakeEnvironmentV0Schema
>;

export function computeFoundryLocalE57IntakeEnvironmentV0Sha256(
  payload: FoundryLocalE57IntakeEnvironmentPayloadV0,
): string {
  const parsed = FoundryLocalE57IntakeEnvironmentPayloadV0Schema.parse(payload);
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_DIGEST_DOMAIN,
    toCanonicalJson(parsed),
  );
}

export function compileFoundryLocalE57IntakeEnvironmentV0(
  input: FoundryLocalE57IntakeEnvironmentPayloadV0,
): FoundryLocalE57IntakeEnvironmentV0 {
  const payload = FoundryLocalE57IntakeEnvironmentPayloadV0Schema.parse(input);
  return FoundryLocalE57IntakeEnvironmentV0Schema.parse({
    ...payload,
    environmentSha256: computeFoundryLocalE57IntakeEnvironmentV0Sha256(payload),
  });
}

export function verifyFoundryLocalE57IntakeEnvironmentV0(
  input: unknown,
): FoundryLocalE57IntakeEnvironmentV0 {
  const environment = FoundryLocalE57IntakeEnvironmentV0Schema.parse(input);
  const { environmentSha256, ...payload } = environment;
  const expected = computeFoundryLocalE57IntakeEnvironmentV0Sha256(payload);
  if (environmentSha256 !== expected) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_INTAKE_ENVIRONMENT_DIGEST_MISMATCH",
      "The local E57 intake environment fingerprint does not match its canonical payload.",
    );
  }
  return environment;
}

export function serializeFoundryLocalE57IntakeEnvironmentV0(
  input: unknown,
): string {
  const environment = verifyFoundryLocalE57IntakeEnvironmentV0(input);
  return stableCanonicalJson(toCanonicalJson(environment));
}

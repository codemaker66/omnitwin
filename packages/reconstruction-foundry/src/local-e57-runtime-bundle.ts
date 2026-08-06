import { z } from "zod";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0 =
  "omnitwin.foundry.local-e57-runtime-bundle.v0";
export const FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0";
export const FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0 =
  "omnitwin.foundry.local-e57-runtime-qualification.v0";
export const FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0";
export const FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0 =
  "omnitwin.foundry.local-e57-runtime-adapter-binding.v0";
export const FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0";

export const FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256 =
  "34ad3f54ea5a5afcca908c66f48ab039381d6910b2372afbafee0c1f8545ea1e";

export const FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME = Object.freeze({
  allowCompatibleNewerV14: true,
  architecture: "x64",
  byteSize: 18_731_856,
  canonicalMsvcp140DllBundled: false,
  disposition: "central_prerequisite_direct_from_microsoft",
  exactPayloadUrl:
    "https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe",
  filename: "VC_redist.x64.exe",
  fixedVersionUrl:
    "https://aka.ms/vs/18/release/14.51.36247/VC_redist.x64.exe",
  floatingPolicyUrl: "https://aka.ms/vc14/vc_redist.x64.exe",
  organizationRedistributionAuthorization: "not_evidenced",
  packageId: "Microsoft.VisualCpp.Redist.14.Latest",
  receiptListedRenamedMsvcpDllPresent: true,
  selectedVersion: "14.51.36247",
  selectedInstallerBundled: false,
  sha256: "843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c",
  officialCpythonVcruntimeDllsPreserved: true,
} as const);

export const FOUNDRY_LOCAL_E57_AGGREGATE_PROBE = Object.freeze({
  bundlePath: "probe/foundry_phase1_probe.py",
  invocationMode: "inspect-e57-aggregate",
  sha256: "396342132a56eb585cb8f3f5d7320a2516d4ed208839c7d769d5e9796d8b697c",
  sizeBytes: 77_513,
} as const);

export const FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE = Object.freeze({
  binaryFingerprintMarkers: [
    "__pybind11_internals_v11_msvc_md_mscver19__",
    "pybind11_detail_function_record_v1_msvc_md_mscver19",
    "pybind11_builtins",
    "__pybind11_module_cache",
  ],
  candidateRevision: "f5fbe867d2d26e4a0a9177a51f6e568868ad3dc8",
  candidateTag: "v3.0.1",
  consumptionMode: "exact_publisher_wheel_as_opaque_binary",
  exactPatchClaimAllowed: false,
  legalNoticeByteSize: 1_684,
  legalNoticeSha256:
    "83965b843b98f670d3a85bd041ed4b372c8ec50d7b4a5995a83ac697ba675dcb",
  legalNoticeSourceUrl:
    "https://raw.githubusercontent.com/pybind/pybind11/f5fbe867d2d26e4a0a9177a51f6e568868ad3dc8/LICENSE",
  sourceToBinaryAttestationState: "absent",
  versionClaim: "inferred_3.0.1_not_attested",
} as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export type LocalE57RuntimeBundleFileRole =
  | "legal"
  | "probe"
  | "python_runtime"
  | "site_package";

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasWindowsForbiddenPathCharacter(value: string): boolean {
  for (const character of value) {
    if (
      character.charCodeAt(0) <= 31 ||
      character === "<" ||
      character === ">" ||
      character === "\"" ||
      character === "|" ||
      character === "?" ||
      character === "*"
    ) {
      return true;
    }
  }
  return false;
}

export function isCanonicalLocalE57BundlePath(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 500 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    hasWindowsForbiddenPathCharacter(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.endsWith(".") &&
    !segment.endsWith(" ") &&
    !WINDOWS_RESERVED_SEGMENT.test(segment)
  );
}

const CanonicalBundlePathSchema = z.string().refine(
  isCanonicalLocalE57BundlePath,
  "bundle paths must be canonical relative Windows-portable paths",
);

const BundleFileSchema = z.object({
  path: CanonicalBundlePathSchema,
  role: z.enum(["legal", "probe", "python_runtime", "site_package"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

const MicrosoftCppRuntimeSchema = z.object({
  allowCompatibleNewerV14: z.literal(true),
  architecture: z.literal("x64"),
  byteSize: z.literal(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.byteSize),
  canonicalMsvcp140DllBundled: z.literal(false),
  disposition: z.literal("central_prerequisite_direct_from_microsoft"),
  exactPayloadUrl: z.literal(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.exactPayloadUrl),
  filename: z.literal("VC_redist.x64.exe"),
  fixedVersionUrl: z.literal(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.fixedVersionUrl),
  floatingPolicyUrl: z.literal(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.floatingPolicyUrl),
  organizationRedistributionAuthorization: z.literal("not_evidenced"),
  packageId: z.literal("Microsoft.VisualCpp.Redist.14.Latest"),
  receiptListedRenamedMsvcpDllPresent: z.literal(true),
  selectedVersion: z.literal("14.51.36247"),
  selectedInstallerBundled: z.literal(false),
  sha256: z.literal(FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME.sha256),
  officialCpythonVcruntimeDllsPreserved: z.literal(true),
}).strict();

const Pybind11ProvenanceSchema = z.object({
  binaryFingerprintMarkers: z.tuple([
    z.literal("__pybind11_internals_v11_msvc_md_mscver19__"),
    z.literal("pybind11_detail_function_record_v1_msvc_md_mscver19"),
    z.literal("pybind11_builtins"),
    z.literal("__pybind11_module_cache"),
  ]),
  candidateRevision: z.literal(FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.candidateRevision),
  candidateTag: z.literal("v3.0.1"),
  consumptionMode: z.literal("exact_publisher_wheel_as_opaque_binary"),
  exactPatchClaimAllowed: z.literal(false),
  legalNoticeByteSize: z.literal(FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeByteSize),
  legalNoticeSha256: z.literal(FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeSha256),
  legalNoticeSourceUrl: z.literal(FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeSourceUrl),
  sourceToBinaryAttestationState: z.literal("absent"),
  versionClaim: z.literal("inferred_3.0.1_not_attested"),
}).strict();

const LocalE57RuntimeBundlePayloadBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0),
  bundleId: z.string().regex(SAFE_ID),
  parentEnvironmentSha256: z.literal(FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256),
  createdAtUtc: z.string().regex(ISO_UTC),
  authority: z.literal("none"),
  execution: z.literal("disabled_until_clean_host_qualified_and_adapter_bound"),
  target: z.object({
    operatingSystem: z.literal("windows"),
    architecture: z.literal("x64"),
    pythonImplementation: z.literal("CPython"),
    pythonVersion: z.literal("3.13.14"),
    pythonAbi: z.literal("cp313"),
    lane: z.literal("e57_read_only_aggregate_metadata"),
  }).strict(),
  layout: z.object({
    interpreterPath: CanonicalBundlePathSchema,
    dependencyRootPath: CanonicalBundlePathSchema,
    probeScriptPath: CanonicalBundlePathSchema,
    legalRootPath: CanonicalBundlePathSchema,
  }).strict(),
  microsoftCppRuntime: MicrosoftCppRuntimeSchema,
  pybind11: Pybind11ProvenanceSchema,
  files: z.array(BundleFileSchema).min(7).max(5_000),
  fileCount: z.number().int().positive(),
  totalFileBytes: z.number().int().positive(),
  materialization: z.object({
    completeAllowlist: z.literal(true),
    directoriesExcludedFromReceipt: z.literal(true),
    hardLinksEncountered: z.literal(0),
    reparsePointsEncountered: z.literal(0),
    regularFilesOnly: z.literal(true),
  }).strict(),
  legalPack: z.object({
    state: z.literal("assembled"),
    rootPath: CanonicalBundlePathSchema,
    pybind11NoticePath: CanonicalBundlePathSchema,
    parentEnvironmentLegalReceiptsApplied: z.literal(true),
    microsoftInstallerBundled: z.literal(false),
  }).strict(),
  limitations: z.tuple([
    z.literal("PYBIND11_EXACT_BUILD_VERSION_IS_INFERRED_NOT_ATTESTED"),
    z.literal("SELECTED_MICROSOFT_VC_REDIST_INSTALLER_AND_CANONICAL_MSVCP140_DLL_ARE_NOT_BUNDLE_MEMBERS"),
    z.literal("BUNDLE_BYTE_IDENTITY_DOES_NOT_ESTABLISH_PUBLISHER_BUILD_REPRODUCIBILITY"),
  ]),
}).strict();

type LocalE57RuntimeBundlePayloadForValidation = z.infer<
  typeof LocalE57RuntimeBundlePayloadBaseSchema
>;

function validateLocalE57RuntimeBundlePayload(
  receipt: LocalE57RuntimeBundlePayloadForValidation,
  ctx: z.RefinementCtx,
): void {
  const paths = receipt.files.map((file) => file.path);
  const sorted = [...paths].sort(compareOrdinal);
  if (paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "bundle file receipts must be in strict ordinal path order",
    });
  }
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "bundle paths must be unique under Windows case folding",
    });
  }
  if (receipt.fileCount !== receipt.files.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileCount"],
      message: "fileCount must equal the complete file receipt count",
    });
  }
  const totalFileBytes = receipt.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (!Number.isSafeInteger(totalFileBytes) || receipt.totalFileBytes !== totalFileBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalFileBytes"],
      message: "totalFileBytes must equal the complete safe-integer byte sum",
    });
  }

  const filesByPath = new Map(receipt.files.map((file) => [file.path, file]));
  const requiredFiles: readonly [string, LocalE57RuntimeBundleFileRole][] = [
    [receipt.layout.interpreterPath, "python_runtime"],
    [receipt.layout.probeScriptPath, "probe"],
    ["runtime/vcruntime140.dll", "python_runtime"],
    ["runtime/vcruntime140_1.dll", "python_runtime"],
    ["site-packages/numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll", "site_package"],
    [`${receipt.layout.dependencyRootPath}/numpy/__init__.py`, "site_package"],
    [`${receipt.layout.dependencyRootPath}/pye57/__init__.py`, "site_package"],
    [`${receipt.layout.dependencyRootPath}/pye57/libe57.cp313-win_amd64.pyd`, "site_package"],
    [`${receipt.layout.dependencyRootPath}/pye57-0.4.19.dist-info/METADATA`, "site_package"],
    [receipt.legalPack.pybind11NoticePath, "legal"],
  ];
  for (const [path, role] of requiredFiles) {
    const file = filesByPath.get(path);
    if (file?.role !== role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: `required ${role} file is missing from the complete allowlist: ${path}`,
      });
    }
  }
  const aggregateProbe = filesByPath.get(receipt.layout.probeScriptPath);
  if (
    receipt.layout.probeScriptPath !== FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.bundlePath ||
    aggregateProbe?.sizeBytes !== FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sizeBytes ||
    aggregateProbe.sha256 !== FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layout", "probeScriptPath"],
      message: "the runtime bundle must bind the exact reviewed aggregate-E57 probe bytes",
    });
  }
  const pybind11Notice = filesByPath.get(receipt.legalPack.pybind11NoticePath);
  if (
    pybind11Notice?.sizeBytes !== FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeByteSize ||
    pybind11Notice.sha256 !== FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.legalNoticeSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["legalPack", "pybind11NoticePath"],
      message: "the legal pack must bind the exact version-invariant pybind11 notice bytes",
    });
  }
  if (
    receipt.legalPack.rootPath !== receipt.layout.legalRootPath ||
    !receipt.legalPack.pybind11NoticePath.startsWith(`${receipt.layout.legalRootPath}/`)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["legalPack"],
      message: "the pybind11 notice must be inside the declared legal-pack root",
    });
  }
}

const LocalE57RuntimeBundlePayloadSchema =
  LocalE57RuntimeBundlePayloadBaseSchema.superRefine(
    validateLocalE57RuntimeBundlePayload,
  );

export type LocalE57RuntimeBundlePayload = z.infer<typeof LocalE57RuntimeBundlePayloadSchema>;

export const LocalE57RuntimeBundleReceiptSchema =
  LocalE57RuntimeBundlePayloadBaseSchema.extend({
    bundleReceiptSha256: z.string().regex(SHA256_HEX),
  }).strict().superRefine(validateLocalE57RuntimeBundlePayload);

export type LocalE57RuntimeBundleReceipt = z.infer<typeof LocalE57RuntimeBundleReceiptSchema>;

const LoadedModuleSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  absolutePath: z.string().trim().min(3).max(1_000),
  fileVersion: z.string().trim().min(1).max(120).nullable(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_HEX),
  origin: z.enum([
    "bundle_local",
    "declared_microsoft_central_runtime",
    "windows_operating_system",
  ]),
}).strict();

const LocalE57RuntimeQualificationPayloadBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0),
  bundleReceiptSha256: z.string().regex(SHA256_HEX),
  observedAtUtc: z.string().regex(ISO_UTC),
  qualificationId: z.string().regex(SAFE_ID),
  authority: z.literal("synthetic_qualification_only"),
  host: z.object({
    operatingSystem: z.literal("windows"),
    architecture: z.literal("x64"),
    disposableCleanHost: z.literal(true),
    supportedWindowsRelease: z.literal(true),
    visualStudioInstalledBeforeTest: z.literal(false),
    centralV14RuntimePresentBeforeTest: z.literal(false),
  }).strict(),
  prerequisiteEvidence: z.object({
    expectedMissingRuntimeFailureObservedBeforeInstall: z.literal(true),
    exactInstallerSha256Verified: z.literal(true),
    microsoftAuthenticodeSignerVerified: z.literal(true),
    installedRuntimeRegistryPath: z.literal(
      "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64",
    ),
    installedRuntimeVersion: z.string().regex(/^14\.\d+\.\d+(?:\.\d+)?$/u),
    installedVersionCompatibleWithSelectedV14: z.literal(true),
    restartRequired: z.boolean(),
  }).strict(),
  bundleEvidence: z.object({
    canonicalMsvcp140DllPresentInBundle: z.literal(false),
    completeTreeReceiptVerifiedBeforeRun: z.literal(true),
    completeTreeReceiptVerifiedAfterRun: z.literal(true),
    officialCpythonVcruntimeDllsPresent: z.literal(true),
    receiptListedRenamedMsvcpDllPresent: z.literal(true),
    sourceBundleMutated: z.literal(false),
  }).strict(),
  probeEvidence: z.object({
    fixture: z.literal("synthetic_three_cartesian_point_e57"),
    fixtureSha256: z.string().regex(SHA256_HEX),
    fixtureSizeBytes: z.number().int().positive(),
    packageImportsPassed: z.literal(true),
    pythonVersion: z.literal("3.13.14"),
    numpyVersion: z.literal("2.5.1"),
    pye57Version: z.literal("0.4.19"),
    pyquaternionVersion: z.literal("0.9.9"),
    syntheticWriteReadRoundtripPassed: z.literal(true),
    productProbeOpenMode: z.literal("read-only"),
    productPointRecordsRead: z.literal(false),
    productEmbeddedImageBytesRead: z.literal(false),
    userOrVenueDataAccessed: z.literal(false),
  }).strict(),
  moduleEvidence: z.object({
    completeLoadedModuleInventoryRecorded: z.literal(true),
    undeclaredThirdPartyModulesObserved: z.literal(false),
    modules: z.array(LoadedModuleSchema).min(1).max(500),
  }).strict(),
}).strict();

type LocalE57RuntimeQualificationPayloadForValidation = z.infer<
  typeof LocalE57RuntimeQualificationPayloadBaseSchema
>;

function validateLocalE57RuntimeQualificationPayload(
  qualification: LocalE57RuntimeQualificationPayloadForValidation,
  ctx: z.RefinementCtx,
): void {
  const centralMsvcp = qualification.moduleEvidence.modules.filter(
    (module) => module.filename.toLowerCase() === "msvcp140.dll" &&
      module.origin === "declared_microsoft_central_runtime",
  );
  if (centralMsvcp.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["moduleEvidence", "modules"],
      message: "qualification requires exactly one declared central MSVCP140.dll module",
    });
  }
  const moduleKeys = qualification.moduleEvidence.modules.map(
    (module) => `${module.filename.toLowerCase()}\0${module.absolutePath.toLowerCase()}`,
  );
  if (new Set(moduleKeys).size !== moduleKeys.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["moduleEvidence", "modules"],
      message: "loaded module receipts must be unique by case-folded filename and path",
    });
  }
}

const LocalE57RuntimeQualificationPayloadSchema =
  LocalE57RuntimeQualificationPayloadBaseSchema.superRefine(
    validateLocalE57RuntimeQualificationPayload,
  );

export type LocalE57RuntimeQualificationPayload = z.infer<
  typeof LocalE57RuntimeQualificationPayloadSchema
>;

export const LocalE57RuntimeQualificationReceiptSchema =
  LocalE57RuntimeQualificationPayloadBaseSchema.extend({
    qualificationSha256: z.string().regex(SHA256_HEX),
  }).strict().superRefine(validateLocalE57RuntimeQualificationPayload);

export type LocalE57RuntimeQualificationReceipt = z.infer<
  typeof LocalE57RuntimeQualificationReceiptSchema
>;

const LocalE57RuntimeAdapterBindingPayloadSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0),
  adapterSchemaVersion: z.literal("venviewer.local-e57-metadata-probe.v0"),
  bundleReceiptSha256: z.string().regex(SHA256_HEX),
  qualificationSha256: z.string().regex(SHA256_HEX),
  scope: z.literal("read_only_e57_aggregate_metadata_only"),
  pointRecordsReadAllowed: z.literal(false),
  embeddedImageBytesReadAllowed: z.literal(false),
  writeModeAllowed: z.literal(false),
  authority: z.literal("runtime_bytes_only_no_source_or_job_authority"),
}).strict();

export type LocalE57RuntimeAdapterBindingPayload = z.infer<
  typeof LocalE57RuntimeAdapterBindingPayloadSchema
>;

export const LocalE57RuntimeAdapterBindingSchema =
  LocalE57RuntimeAdapterBindingPayloadSchema.extend({
    adapterBindingSha256: z.string().regex(SHA256_HEX),
  }).strict();

export type LocalE57RuntimeAdapterBinding = z.infer<
  typeof LocalE57RuntimeAdapterBindingSchema
>;

function digestPayload(domain: string, payload: unknown): string {
  return domainSeparatedSha256(domain, toCanonicalJson(payload));
}

export function issueLocalE57RuntimeBundleReceipt(
  input: LocalE57RuntimeBundlePayload,
): LocalE57RuntimeBundleReceipt {
  const payload = LocalE57RuntimeBundlePayloadSchema.parse(input);
  return LocalE57RuntimeBundleReceiptSchema.parse({
    ...payload,
    bundleReceiptSha256: digestPayload(
      FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0_DIGEST_DOMAIN,
      payload,
    ),
  });
}

export function verifyLocalE57RuntimeBundleReceipt(
  input: unknown,
): LocalE57RuntimeBundleReceipt {
  const receipt = LocalE57RuntimeBundleReceiptSchema.parse(input);
  const { bundleReceiptSha256, ...payload } = receipt;
  const expected = digestPayload(
    FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0_DIGEST_DOMAIN,
    payload,
  );
  if (bundleReceiptSha256 !== expected) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_RUNTIME_BUNDLE_DIGEST_MISMATCH",
      "The local E57 runtime bundle receipt digest does not match its canonical payload.",
    );
  }
  return receipt;
}

export function issueLocalE57RuntimeQualificationReceipt(
  input: LocalE57RuntimeQualificationPayload,
): LocalE57RuntimeQualificationReceipt {
  const payload = LocalE57RuntimeQualificationPayloadSchema.parse(input);
  return LocalE57RuntimeQualificationReceiptSchema.parse({
    ...payload,
    qualificationSha256: digestPayload(
      FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0_DIGEST_DOMAIN,
      payload,
    ),
  });
}

export function verifyLocalE57RuntimeQualificationReceipt(
  input: unknown,
  expectedBundleReceiptSha256?: string,
): LocalE57RuntimeQualificationReceipt {
  const receipt = LocalE57RuntimeQualificationReceiptSchema.parse(input);
  const { qualificationSha256, ...payload } = receipt;
  const expected = digestPayload(
    FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0_DIGEST_DOMAIN,
    payload,
  );
  if (qualificationSha256 !== expected) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_RUNTIME_QUALIFICATION_DIGEST_MISMATCH",
      "The local E57 runtime qualification digest does not match its canonical payload.",
    );
  }
  if (
    expectedBundleReceiptSha256 !== undefined &&
    receipt.bundleReceiptSha256 !== expectedBundleReceiptSha256
  ) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_RUNTIME_QUALIFICATION_BUNDLE_MISMATCH",
      "The clean-host qualification does not bind the expected runtime bundle receipt.",
    );
  }
  return receipt;
}

export function issueLocalE57RuntimeAdapterBinding(
  input: LocalE57RuntimeAdapterBindingPayload,
): LocalE57RuntimeAdapterBinding {
  const payload = LocalE57RuntimeAdapterBindingPayloadSchema.parse(input);
  return LocalE57RuntimeAdapterBindingSchema.parse({
    ...payload,
    adapterBindingSha256: digestPayload(
      FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0_DIGEST_DOMAIN,
      payload,
    ),
  });
}

export function verifyLocalE57RuntimeAdapterBinding(
  input: unknown,
  bundle: LocalE57RuntimeBundleReceipt,
  qualification: LocalE57RuntimeQualificationReceipt,
): LocalE57RuntimeAdapterBinding {
  const binding = LocalE57RuntimeAdapterBindingSchema.parse(input);
  const { adapterBindingSha256, ...payload } = binding;
  const expected = digestPayload(
    FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0_DIGEST_DOMAIN,
    payload,
  );
  if (adapterBindingSha256 !== expected) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_RUNTIME_ADAPTER_BINDING_DIGEST_MISMATCH",
      "The local E57 adapter binding digest does not match its canonical payload.",
    );
  }
  if (
    binding.bundleReceiptSha256 !== bundle.bundleReceiptSha256 ||
    binding.qualificationSha256 !== qualification.qualificationSha256 ||
    qualification.bundleReceiptSha256 !== bundle.bundleReceiptSha256
  ) {
    throw new FoundryIntegrityError(
      "LOCAL_E57_RUNTIME_ADAPTER_BINDING_CROSS_LINK_MISMATCH",
      "The adapter binding, bundle receipt, and clean-host qualification do not cross-bind exactly.",
    );
  }
  return binding;
}

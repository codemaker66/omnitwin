import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
  GrandHallT554NativeReviewImplementationManifestError,
  __internalObserveGrandHallT554NativeReviewBootstrapExecutionIdentity,
  __internalObserveGrandHallT554NativeReviewRuntimeIdentity,
  __internalVerifyGrandHallT554NativeReviewExactImplementationPack,
  type __GrandHallT554NativeReviewBootstrapExecutionIdentity,
  type __GrandHallT554NativeReviewExactPackVerificationFacts,
  type __GrandHallT554NativeReviewImplementationReviewedAnchor,
  type __GrandHallT554NativeReviewImplementationVerificationSeam,
  type GrandHallT554ImplementationSha256,
  type GrandHallT554NativeReviewImplementationDecoderClosureV1,
  type GrandHallT554NativeReviewImplementationManifestErrorCode,
  type GrandHallT554NativeReviewImplementationRuntimeV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2 =
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME;
export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2 =
  "venviewer.grand-hall-t554-native-review-implementation-manifest.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2 =
  "grand-hall-t554-native-review-workbench-v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2 =
  "venviewer.grand-hall-t554-native-review-fixed-admission-abi.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2 =
  "file:///C:/ProgramData/Venviewer/PrivateReleases/trades-hall-grand-hall-t554-workbench-v2/admission/fixed-admission-capsule.mjs";

export const GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2 =
  "package.json";
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2 =
  "server/grand-hall-t554-native-review-payload-gate-v2.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2 =
  "server/grand-hall-t554-native-review-payload-core-v2.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2 =
  "server/grand-hall-t554-native-review-http-response-adapter-v2.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2 =
  "server/native-review-runtime-bootstrap.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2 =
  "static/index.html";
export const GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2 =
  "static/review.css";
export const GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2 =
  "static/review.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2 =
  "vendor/decoder-runtime.json";
export const GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2 =
  "vendor/sharp/loader.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2 =
  "vendor/sharp/sharp-win32-x64-0.35.3.node";
export const GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2 =
  "vendor/libvips/libvips-42.dll";
export const GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2 =
  "vendor/libvips/libvips-cpp-8.18.3.dll";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2 =
  "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2 =
  "vendor/runtime-attestation/decoder-probe.jpg";

export const GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2 =
  "./grand-hall-t554-native-review-payload-core-v2.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2 =
  "./grand-hall-t554-native-review-http-response-adapter-v2.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2 =
  "../vendor/sharp/loader.js";

const SEMANTIC_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V2";
const MEMBER_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MEMBER_INVENTORY_V2";
const MAXIMUM_MEMBER_COUNT = 128;
const MAXIMUM_MEMBER_BYTES = 32 * 1_024 * 1_024;
const MAXIMUM_TOTAL_MEMBER_BYTES = 128 * 1_024 * 1_024;
const MAXIMUM_RELATIVE_PATH_BYTES = 240;
const MAXIMUM_PATH_DEPTH = 8;
const REVIEWED_RUNTIME_PROBE_SHA256 =
  "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078";
const REVIEWED_RUNTIME_PROBE_BYTE_LENGTH = 879;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const WINDOWS_DEVICE_PATTERN =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/](?![\\/])/u;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const VERSION_COMPONENT_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const RUNTIME_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [
    specifier,
    specifier.startsWith("node:") ? specifier : `node:${specifier}`,
  ]),
);

const VERIFIED_CANDIDATE_IDENTITIES = new WeakSet();
const VERIFIED_CANDIDATE_ROOTS = new WeakMap<object, string>();

const MANIFEST_KEYS = Object.freeze([
  "admission",
  "authority",
  "decoder",
  "execution",
  "implementationId",
  "memberCount",
  "members",
  "roomSlug",
  "runtime",
  "schemaVersion",
  "semanticSha256",
  "sourceCount",
  "totalMemberBytes",
  "venueSlug",
]);
const RUNTIME_KEYS = Object.freeze([
  "architecture",
  "nodeModulesAbi",
  "nodeNapiVersion",
  "nodeVersion",
  "platform",
]);
const DECODER_KEYS = Object.freeze([
  "architecture",
  "libvipsNativeDependencyMembers",
  "libvipsVersion",
  "library",
  "metadataMember",
  "platform",
  "schemaVersion",
  "sharpNativeAddonMember",
  "sharpRuntimeMembers",
  "sharpVersion",
  "sourceJpegDecoderPipeline",
  "strictMaskPngDecoderPipeline",
]);
const EXECUTION_KEYS = Object.freeze([
  "acceptanceAuthorized",
  "ambientExternalRuntimeModuleResolutionAuthorized",
  "bindAddress",
  "browserControlledTruthAuthorized",
  "browserTrust",
  "dependencyClosure",
  "entryImportPolicy",
  "exportAuthorized",
  "externalNetworkAuthorized",
  "fixedAdmissionCapsuleExternalImportRequired",
  "fixedAdmissionGatedFactoryIncluded",
  "generatedContentAuthorized",
  "httpLaunchIncluded",
  "mixedSourceDistResolutionAuthorized",
  "mode",
  "moduleFormat",
  "reconstructionAuthorized",
  "runtimeAdmissionAuthorized",
  "sourceMapsIncluded",
  "standaloneProductionFactoryIncluded",
  "tsxExecutionAuthorized",
]);
const ADMISSION_KEYS = Object.freeze([
  "applicationJavascriptMember",
  "coreModule",
  "documentHtmlMember",
  "fixedAdmissionAbiSchemaVersion",
  "fixedAdmissionCapsuleUrl",
  "gateModule",
  "runtimeBootstrapModule",
  "stylesheetCssMember",
  "trustedHttpAdapterModule",
]);
const MEMBER_KEYS = Object.freeze([
  "byteLength",
  "kind",
  "relativePath",
  "sha256",
]);

export type GrandHallT554NativeReviewImplementationRuntimeV2 =
  GrandHallT554NativeReviewImplementationRuntimeV1;
export type GrandHallT554NativeReviewImplementationDecoderClosureV2 =
  GrandHallT554NativeReviewImplementationDecoderClosureV1;

export interface GrandHallT554NativeReviewImplementationExecutionV2 {
  readonly mode: "compiled-esm-fixed-admission-gated-private-local-review-payload.v2";
  readonly moduleFormat: "esm";
  readonly bindAddress: "127.0.0.1";
  readonly browserTrust: "untrusted-display-and-input";
  readonly dependencyClosure: "reviewed-pack-members-node-builtins-and-fixed-admission-capsule.v2";
  readonly entryImportPolicy: "fixed-admission-capsule-verifies-entire-pack-before-gate-import.v2";
  readonly standaloneProductionFactoryIncluded: false;
  readonly fixedAdmissionGatedFactoryIncluded: true;
  readonly httpLaunchIncluded: false;
  readonly sourceMapsIncluded: false;
  readonly tsxExecutionAuthorized: false;
  readonly mixedSourceDistResolutionAuthorized: false;
  readonly ambientExternalRuntimeModuleResolutionAuthorized: false;
  readonly fixedAdmissionCapsuleExternalImportRequired: true;
  readonly browserControlledTruthAuthorized: false;
  readonly externalNetworkAuthorized: false;
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAdmissionAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
}

export interface GrandHallT554NativeReviewImplementationAdmissionV2 {
  readonly gateModule: typeof GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2;
  readonly coreModule: typeof GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2;
  readonly trustedHttpAdapterModule: typeof GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2;
  readonly runtimeBootstrapModule: typeof GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2;
  readonly documentHtmlMember: typeof GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2;
  readonly stylesheetCssMember: typeof GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2;
  readonly applicationJavascriptMember: typeof GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2;
  readonly fixedAdmissionAbiSchemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2;
  readonly fixedAdmissionCapsuleUrl: typeof GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2;
}

export type GrandHallT554NativeReviewImplementationMemberKindV2 =
  | "module-metadata"
  | "payload-admission-gate"
  | "payload-core"
  | "trusted-http-adapter"
  | "runtime-bootstrap"
  | "static-asset"
  | "decoder-closure-metadata"
  | "sharp-runtime"
  | "sharp-native-addon"
  | "libvips-native-dependency"
  | "runtime-inspector-addon"
  | "runtime-attestation-probe";

export interface GrandHallT554NativeReviewImplementationMemberV2 {
  readonly relativePath: string;
  readonly kind: GrandHallT554NativeReviewImplementationMemberKindV2;
  readonly sha256: GrandHallT554ImplementationSha256;
  readonly byteLength: number;
}

export interface GrandHallT554NativeReviewImplementationManifestV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2;
  readonly implementationId: typeof GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2;
  readonly venueSlug: "trades-hall";
  readonly roomSlug: "grand-hall";
  readonly sourceCount: 148;
  readonly authority: "none";
  readonly runtime: GrandHallT554NativeReviewImplementationRuntimeV2;
  readonly decoder: GrandHallT554NativeReviewImplementationDecoderClosureV2;
  readonly execution: GrandHallT554NativeReviewImplementationExecutionV2;
  readonly admission: GrandHallT554NativeReviewImplementationAdmissionV2;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  readonly members: readonly GrandHallT554NativeReviewImplementationMemberV2[];
  readonly semanticSha256: GrandHallT554ImplementationSha256;
}

export interface GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v2";
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV2;
  readonly manifestBinding: {
    readonly schemaVersion: "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2";
    readonly implementationId: typeof GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2;
    readonly semanticSha256: GrandHallT554ImplementationSha256;
    readonly fileSha256: GrandHallT554ImplementationSha256;
    readonly byteLength: number;
  };
  readonly memberInventorySha256: GrandHallT554ImplementationSha256;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  readonly copyExactManifestBytes: () => Buffer;
  readonly concreteBytesVerified: true;
  readonly runtimeIdentityVerified: true;
  readonly bootstrapExecutionIdentityVerified: true;
  readonly reviewedDecoderClosureBytesVerified: true;
  readonly fixedAdmissionBindingVerified: true;
  readonly executionPolicyManifestVerified: true;
  readonly exactRootInventoryVerified: true;
  readonly authority: "none";
  readonly standaloneProductionFactoryAvailable: false;
  readonly runtimeAuthorityAvailable: false;
}

export interface __GrandHallT554NativeReviewImplementationVerificationInputV2 {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
  readonly runtimeIdentity?: GrandHallT554NativeReviewImplementationRuntimeV2;
  readonly bootstrapExecutionIdentity?: __GrandHallT554NativeReviewBootstrapExecutionIdentity;
  readonly seam?: __GrandHallT554NativeReviewImplementationVerificationSeam;
}

function fail(
  code: GrandHallT554NativeReviewImplementationManifestErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewImplementationManifestError {
  return new GrandHallT554NativeReviewImplementationManifestError(
    code,
    message,
    cause,
  );
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Buffer): GrandHallT554ImplementationSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticSha256(
  domain: string,
  value: unknown,
): GrandHallT554ImplementationSha256 {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(
    Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"),
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(lexicalOrder);
  const sortedExpected = expected.slice().sort(lexicalOrder);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw fail("MANIFEST_INVALID", `${label} has missing or extra keys.`);
  }
}

function requireRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw fail("MANIFEST_INVALID", `${label} must be one JSON object.`);
  }
  assertExactKeys(value, keys, label);
  return value;
}

function requireLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} must equal ${JSON.stringify(expected)}.`,
    );
  }
  return expected;
}

function requirePattern(
  value: unknown,
  pattern: RegExp,
  label: string,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw fail("MANIFEST_INVALID", `${label} is not canonical.`);
  }
  return value;
}

function requireSha256(
  value: unknown,
  label: string,
): GrandHallT554ImplementationSha256 {
  return requirePattern(
    value,
    SHA256_PATTERN,
    label,
  ) as GrandHallT554ImplementationSha256;
}

function requireBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw fail("MANIFEST_INVALID", `${label} is outside its integer bound.`);
  }
  return value;
}

function assertSafeSegment(segment: string, label: string): void {
  if (
    !SAFE_SEGMENT_PATTERN.test(segment) ||
    WINDOWS_DEVICE_PATTERN.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ")
  ) {
    throw fail("MANIFEST_INVALID", `${label} contains an unsafe path segment.`);
  }
}

function assertSafeRelativePath(relativePath: string, label: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    Buffer.byteLength(relativePath, "utf8") > MAXIMUM_RELATIVE_PATH_BYTES
  ) {
    throw fail("MANIFEST_INVALID", `${label} is not one safe relative path.`);
  }
  const segments = relativePath.split("/");
  if (segments.length > MAXIMUM_PATH_DEPTH) {
    throw fail("MANIFEST_INVALID", `${label} is too deeply nested.`);
  }
  for (const segment of segments) assertSafeSegment(segment, label);
  if (segments.join("/") !== relativePath) {
    throw fail("MANIFEST_INVALID", `${label} is not normalized.`);
  }
}

function parseRuntime(
  value: unknown,
): GrandHallT554NativeReviewImplementationRuntimeV2 {
  const runtime = requireRecord(
    value,
    RUNTIME_KEYS,
    "Implementation runtime identity",
  );
  const parsed = {
    nodeVersion: requirePattern(
      runtime.nodeVersion,
      NODE_VERSION_PATTERN,
      "Node version",
    ),
    nodeModulesAbi: requirePattern(
      runtime.nodeModulesAbi,
      VERSION_COMPONENT_PATTERN,
      "Node modules ABI",
    ),
    nodeNapiVersion: requirePattern(
      runtime.nodeNapiVersion,
      VERSION_COMPONENT_PATTERN,
      "Node N-API version",
    ),
    platform: requirePattern(
      runtime.platform,
      RUNTIME_NAME_PATTERN,
      "Runtime platform",
    ),
    architecture: requirePattern(
      runtime.architecture,
      RUNTIME_NAME_PATTERN,
      "Runtime architecture",
    ),
  };
  if (parsed.platform !== "win32" || parsed.architecture !== "x64") {
    throw fail(
      "MANIFEST_INVALID",
      "The fixed-admission v2 payload is restricted to the reviewed Windows x64 runtime closure.",
    );
  }
  return parsed;
}

function parseSortedMemberPathArray(
  value: unknown,
  label: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAXIMUM_MEMBER_COUNT
  ) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} count is outside its fixed bound.`,
    );
  }
  const paths = value.map((path, index) => {
    if (typeof path !== "string") {
      throw fail(
        "MANIFEST_INVALID",
        `${label} ${String(index)} must be a string.`,
      );
    }
    assertSafeRelativePath(path, `${label} ${String(index)}`);
    return path;
  });
  for (let index = 1; index < paths.length; index += 1) {
    const previous = paths[index - 1];
    const current = paths[index];
    if (
      previous === undefined ||
      current === undefined ||
      lexicalOrder(previous, current) >= 0
    ) {
      throw fail(
        "MANIFEST_INVALID",
        `${label} must be strictly sorted and unique.`,
      );
    }
  }
  return paths;
}

function parseDecoderClosure(
  value: unknown,
  runtime: GrandHallT554NativeReviewImplementationRuntimeV2,
): GrandHallT554NativeReviewImplementationDecoderClosureV2 {
  const decoder = requireRecord(
    value,
    DECODER_KEYS,
    "Implementation decoder closure",
  );
  const platform = requireLiteral(
    decoder.platform,
    "win32",
    "Decoder platform",
  );
  const architecture = requireLiteral(
    decoder.architecture,
    "x64",
    "Decoder architecture",
  );
  if (platform !== runtime.platform || architecture !== runtime.architecture) {
    throw fail(
      "MANIFEST_INVALID",
      "Decoder closure platform and architecture must match the Node runtime identity.",
    );
  }
  if (typeof decoder.sharpNativeAddonMember !== "string") {
    throw fail(
      "MANIFEST_INVALID",
      "Sharp native addon member must be a string.",
    );
  }
  assertSafeRelativePath(
    decoder.sharpNativeAddonMember,
    "Sharp native addon member",
  );
  return {
    schemaVersion: requireLiteral(
      decoder.schemaVersion,
      "venviewer.grand-hall-t554-native-review-decoder-closure.v1",
      "Decoder closure schema",
    ),
    library: requireLiteral(decoder.library, "sharp", "Decoder library"),
    sharpVersion: requireLiteral(
      decoder.sharpVersion,
      "0.35.3",
      "sharp version",
    ),
    libvipsVersion: requireLiteral(
      decoder.libvipsVersion,
      "8.18.3",
      "libvips version",
    ),
    platform,
    architecture,
    sourceJpegDecoderPipeline: requireLiteral(
      decoder.sourceJpegDecoderPipeline,
      "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      "Source JPEG decoder pipeline",
    ),
    strictMaskPngDecoderPipeline: requireLiteral(
      decoder.strictMaskPngDecoderPipeline,
      "canonical-grayscale8-source-grid-mask-and-reason-map.v2",
      "Strict mask PNG decoder pipeline",
    ),
    metadataMember: requireLiteral(
      decoder.metadataMember,
      GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
      "Decoder closure metadata member",
    ),
    sharpRuntimeMembers: parseSortedMemberPathArray(
      decoder.sharpRuntimeMembers,
      "Sharp runtime members",
    ),
    sharpNativeAddonMember: decoder.sharpNativeAddonMember,
    libvipsNativeDependencyMembers: parseSortedMemberPathArray(
      decoder.libvipsNativeDependencyMembers,
      "libvips native dependency members",
    ),
  };
}

function parseExecution(
  value: unknown,
): GrandHallT554NativeReviewImplementationExecutionV2 {
  const execution = requireRecord(
    value,
    EXECUTION_KEYS,
    "Implementation execution policy",
  );
  return {
    mode: requireLiteral(
      execution.mode,
      "compiled-esm-fixed-admission-gated-private-local-review-payload.v2",
      "Execution mode",
    ),
    moduleFormat: requireLiteral(
      execution.moduleFormat,
      "esm",
      "Module format",
    ),
    bindAddress: requireLiteral(
      execution.bindAddress,
      "127.0.0.1",
      "Bind address",
    ),
    browserTrust: requireLiteral(
      execution.browserTrust,
      "untrusted-display-and-input",
      "Browser trust",
    ),
    dependencyClosure: requireLiteral(
      execution.dependencyClosure,
      "reviewed-pack-members-node-builtins-and-fixed-admission-capsule.v2",
      "Dependency closure",
    ),
    entryImportPolicy: requireLiteral(
      execution.entryImportPolicy,
      "fixed-admission-capsule-verifies-entire-pack-before-gate-import.v2",
      "Entry import policy",
    ),
    standaloneProductionFactoryIncluded: requireLiteral(
      execution.standaloneProductionFactoryIncluded,
      false,
      "Standalone production factory inclusion",
    ),
    fixedAdmissionGatedFactoryIncluded: requireLiteral(
      execution.fixedAdmissionGatedFactoryIncluded,
      true,
      "Fixed-admission-gated factory inclusion",
    ),
    httpLaunchIncluded: requireLiteral(
      execution.httpLaunchIncluded,
      false,
      "HTTP launch inclusion",
    ),
    sourceMapsIncluded: requireLiteral(
      execution.sourceMapsIncluded,
      false,
      "Source-map inclusion",
    ),
    tsxExecutionAuthorized: requireLiteral(
      execution.tsxExecutionAuthorized,
      false,
      "tsx execution authorization",
    ),
    mixedSourceDistResolutionAuthorized: requireLiteral(
      execution.mixedSourceDistResolutionAuthorized,
      false,
      "Mixed source/dist resolution authorization",
    ),
    ambientExternalRuntimeModuleResolutionAuthorized: requireLiteral(
      execution.ambientExternalRuntimeModuleResolutionAuthorized,
      false,
      "Ambient external runtime module resolution authorization",
    ),
    fixedAdmissionCapsuleExternalImportRequired: requireLiteral(
      execution.fixedAdmissionCapsuleExternalImportRequired,
      true,
      "Fixed admission capsule external import requirement",
    ),
    browserControlledTruthAuthorized: requireLiteral(
      execution.browserControlledTruthAuthorized,
      false,
      "Browser-controlled truth authorization",
    ),
    externalNetworkAuthorized: requireLiteral(
      execution.externalNetworkAuthorized,
      false,
      "External-network authorization",
    ),
    acceptanceAuthorized: requireLiteral(
      execution.acceptanceAuthorized,
      false,
      "Acceptance authorization",
    ),
    reconstructionAuthorized: requireLiteral(
      execution.reconstructionAuthorized,
      false,
      "Reconstruction authorization",
    ),
    runtimeAdmissionAuthorized: requireLiteral(
      execution.runtimeAdmissionAuthorized,
      false,
      "Runtime-admission authorization",
    ),
    exportAuthorized: requireLiteral(
      execution.exportAuthorized,
      false,
      "Export authorization",
    ),
    generatedContentAuthorized: requireLiteral(
      execution.generatedContentAuthorized,
      false,
      "Generated-content authorization",
    ),
  };
}

function parseAdmission(
  value: unknown,
): GrandHallT554NativeReviewImplementationAdmissionV2 {
  const admission = requireRecord(
    value,
    ADMISSION_KEYS,
    "Implementation fixed-admission binding",
  );
  return {
    gateModule: requireLiteral(
      admission.gateModule,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
      "Admission gate module",
    ),
    coreModule: requireLiteral(
      admission.coreModule,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
      "Admission core module",
    ),
    trustedHttpAdapterModule: requireLiteral(
      admission.trustedHttpAdapterModule,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      "Admission trusted HTTP adapter module",
    ),
    runtimeBootstrapModule: requireLiteral(
      admission.runtimeBootstrapModule,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
      "Admission runtime bootstrap module",
    ),
    documentHtmlMember: requireLiteral(
      admission.documentHtmlMember,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
      "Admission document member",
    ),
    stylesheetCssMember: requireLiteral(
      admission.stylesheetCssMember,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
      "Admission stylesheet member",
    ),
    applicationJavascriptMember: requireLiteral(
      admission.applicationJavascriptMember,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
      "Admission browser application member",
    ),
    fixedAdmissionAbiSchemaVersion: requireLiteral(
      admission.fixedAdmissionAbiSchemaVersion,
      GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2,
      "Fixed admission ABI schema",
    ),
    fixedAdmissionCapsuleUrl: requireLiteral(
      admission.fixedAdmissionCapsuleUrl,
      GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
      "Fixed admission capsule URL",
    ),
  };
}

const MEMBER_KINDS = Object.freeze([
  "module-metadata",
  "payload-admission-gate",
  "payload-core",
  "trusted-http-adapter",
  "runtime-bootstrap",
  "static-asset",
  "decoder-closure-metadata",
  "sharp-runtime",
  "sharp-native-addon",
  "libvips-native-dependency",
  "runtime-inspector-addon",
  "runtime-attestation-probe",
] as const);

const EXACT_SHARP_RUNTIME_MEMBER_PATHS = Object.freeze([
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
] as const);
const EXACT_LIBVIPS_NATIVE_DEPENDENCY_MEMBER_PATHS = Object.freeze([
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
] as const);

function pathMatchesMemberKind(
  path: string,
  kind: GrandHallT554NativeReviewImplementationMemberKindV2,
): boolean {
  switch (kind) {
    case "module-metadata":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2;
    case "payload-admission-gate":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2;
    case "payload-core":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2;
    case "trusted-http-adapter":
      return (
        path === GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2
      );
    case "runtime-bootstrap":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2;
    case "static-asset":
      return (
        path === GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2 ||
        path === GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2 ||
        path === GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2
      );
    case "decoder-closure-metadata":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2;
    case "sharp-runtime":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2;
    case "sharp-native-addon":
      return (
        path === GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2
      );
    case "libvips-native-dependency":
      return (
        path === GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2 ||
        path === GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2
      );
    case "runtime-inspector-addon":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2;
    case "runtime-attestation-probe":
      return path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2;
  }
}

function parseMember(
  value: unknown,
  index: number,
): GrandHallT554NativeReviewImplementationMemberV2 {
  const label = `Implementation member ${String(index)}`;
  const member = requireRecord(value, MEMBER_KEYS, label);
  if (typeof member.relativePath !== "string") {
    throw fail("MANIFEST_INVALID", `${label} relative path must be a string.`);
  }
  assertSafeRelativePath(member.relativePath, `${label} relative path`);
  const kind = MEMBER_KINDS.find((candidate) => candidate === member.kind);
  if (kind === undefined) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} kind is not part of the closed v2 payload contract.`,
    );
  }
  if (
    !pathMatchesMemberKind(member.relativePath, kind) ||
    member.relativePath ===
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2
  ) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} path does not match its closed v2 payload member kind.`,
    );
  }
  return {
    relativePath: member.relativePath,
    kind,
    sha256: requireSha256(member.sha256, `${label} SHA-256`),
    byteLength: requireBoundedInteger(
      member.byteLength,
      1,
      MAXIMUM_MEMBER_BYTES,
      `${label} byte length`,
    ),
  };
}

function assertMemberOrderingAndCollisions(
  members: readonly GrandHallT554NativeReviewImplementationMemberV2[],
): void {
  const folded = new Set<string>();
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const previous = members[index - 1];
    if (member === undefined) {
      throw fail(
        "MANIFEST_INVALID",
        "Implementation member inventory is sparse.",
      );
    }
    if (
      previous !== undefined &&
      lexicalOrder(previous.relativePath, member.relativePath) >= 0
    ) {
      throw fail(
        "MANIFEST_INVALID",
        "Implementation member inventory must be strictly sorted by relative path.",
      );
    }
    const foldedPath = member.relativePath.toLowerCase();
    if (folded.has(foldedPath)) {
      throw fail(
        "MANIFEST_INVALID",
        "Implementation member inventory contains a case-fold collision.",
      );
    }
    folded.add(foldedPath);
  }
}

function pathsOfKind(
  members: readonly GrandHallT554NativeReviewImplementationMemberV2[],
  kind: GrandHallT554NativeReviewImplementationMemberKindV2,
): readonly string[] {
  return members
    .filter((member) => member.kind === kind)
    .map((member) => member.relativePath)
    .sort(lexicalOrder);
}

function samePaths(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

function assertExactMemberClosure(
  members: readonly GrandHallT554NativeReviewImplementationMemberV2[],
  decoder: GrandHallT554NativeReviewImplementationDecoderClosureV2,
): void {
  const count = (
    kind: GrandHallT554NativeReviewImplementationMemberKindV2,
  ): number => members.filter((member) => member.kind === kind).length;
  if (
    count("module-metadata") !== 1 ||
    count("payload-admission-gate") !== 1 ||
    count("payload-core") !== 1 ||
    count("trusted-http-adapter") !== 1 ||
    count("runtime-bootstrap") !== 1 ||
    count("static-asset") !== 3 ||
    count("decoder-closure-metadata") !== 1 ||
    count("sharp-native-addon") !== 1 ||
    count("runtime-inspector-addon") !== 1 ||
    count("runtime-attestation-probe") !== 1 ||
    !samePaths(
      pathsOfKind(members, "sharp-runtime"),
      EXACT_SHARP_RUNTIME_MEMBER_PATHS,
    ) ||
    !samePaths(
      pathsOfKind(members, "libvips-native-dependency"),
      EXACT_LIBVIPS_NATIVE_DEPENDENCY_MEMBER_PATHS,
    ) ||
    !samePaths(decoder.sharpRuntimeMembers, pathsOfKind(members, "sharp-runtime")) ||
    !samePaths(
      decoder.libvipsNativeDependencyMembers,
      pathsOfKind(members, "libvips-native-dependency"),
    ) ||
    decoder.metadataMember !==
      pathsOfKind(members, "decoder-closure-metadata")[0] ||
    decoder.sharpNativeAddonMember !==
      pathsOfKind(members, "sharp-native-addon")[0]
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation members do not close the exact gate, core, adapter, bootstrap, static, decoder, Sharp, libvips, inspector, and probe payload inventory.",
    );
  }
}

function manifestSemanticMaterial(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): Omit<GrandHallT554NativeReviewImplementationManifestV2, "semanticSha256"> {
  const { semanticSha256: _semanticSha256, ...material } = manifest;
  return material;
}

function computeManifestSemanticSha256(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): GrandHallT554ImplementationSha256 {
  return semanticSha256(
    SEMANTIC_DIGEST_DOMAIN,
    manifestSemanticMaterial(manifest),
  );
}

function computeMemberInventorySha256(
  members: readonly GrandHallT554NativeReviewImplementationMemberV2[],
): GrandHallT554ImplementationSha256 {
  return semanticSha256(MEMBER_INVENTORY_DIGEST_DOMAIN, members);
}

function parseManifest(
  parsed: unknown,
): GrandHallT554NativeReviewImplementationManifestV2 {
  const value = requireRecord(parsed, MANIFEST_KEYS, "Implementation manifest");
  if (!Array.isArray(value.members)) {
    throw fail("MANIFEST_INVALID", "Implementation members must be one array.");
  }
  if (value.members.length < 1 || value.members.length > MAXIMUM_MEMBER_COUNT) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation member count is outside its fixed bound.",
    );
  }
  const runtime = parseRuntime(value.runtime);
  const decoder = parseDecoderClosure(value.decoder, runtime);
  const execution = parseExecution(value.execution);
  const admission = parseAdmission(value.admission);
  const members = value.members.map(parseMember);
  assertMemberOrderingAndCollisions(members);
  assertExactMemberClosure(members, decoder);
  const memberCount = requireBoundedInteger(
    value.memberCount,
    1,
    MAXIMUM_MEMBER_COUNT,
    "Implementation member count",
  );
  const totalMemberBytes = requireBoundedInteger(
    value.totalMemberBytes,
    1,
    MAXIMUM_TOTAL_MEMBER_BYTES,
    "Implementation total member bytes",
  );
  const derivedTotalMemberBytes = members.reduce(
    (total, member) => total + member.byteLength,
    0,
  );
  if (
    memberCount !== members.length ||
    totalMemberBytes !== derivedTotalMemberBytes
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation member count or total bytes are not derived from the inventory.",
    );
  }
  const manifest: GrandHallT554NativeReviewImplementationManifestV2 = {
    schemaVersion: requireLiteral(
      value.schemaVersion,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2,
      "Implementation manifest schema",
    ),
    implementationId: requireLiteral(
      value.implementationId,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
      "Implementation identifier",
    ),
    venueSlug: requireLiteral(value.venueSlug, "trades-hall", "Venue slug"),
    roomSlug: requireLiteral(value.roomSlug, "grand-hall", "Room slug"),
    sourceCount: requireLiteral(value.sourceCount, 148, "Source count"),
    authority: requireLiteral(value.authority, "none", "Authority"),
    runtime,
    decoder,
    execution,
    admission,
    memberCount,
    totalMemberBytes,
    members,
    semanticSha256: requireSha256(
      value.semanticSha256,
      "Implementation manifest semantic SHA-256",
    ),
  };
  if (computeManifestSemanticSha256(manifest) !== manifest.semanticSha256) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation manifest semantic SHA-256 does not match its exact material.",
    );
  }
  return manifest;
}

function parseCanonicalManifestBytes(
  bytes: Buffer,
): GrandHallT554NativeReviewImplementationManifestV2 {
  let parsed: unknown;
  try {
    parsed = parseGrandHallT554StrictJson(bytes);
    const canonical = Buffer.from(
      `${stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed))}\n`,
      "utf8",
    );
    try {
      if (!canonical.equals(bytes)) {
        throw fail(
          "MANIFEST_INVALID",
          "Implementation manifest must be exact canonical JSON followed by one LF.",
        );
      }
    } finally {
      canonical.fill(0);
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewImplementationManifestError) {
      throw error;
    }
    throw fail(
      "MANIFEST_INVALID",
      "Implementation manifest is not strict canonical JSON followed by one LF.",
      error,
    );
  }
  return parseManifest(parsed);
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw fail(
      "MEMBER_INVALID",
      `${label} is not exact well-formed UTF-8 text.`,
      error,
    );
  }
}

function collectLiteralModuleSpecifiers(source: string): readonly string[] {
  const patterns = [
    /\bimport\s*\(\s*(["'])([^"'\\\r\n]+)\1\s*\)/gu,
    /\b(?:import|export)\s*(?:[^;()]*?\bfrom\s*)?(["'])([^"'\\\r\n]+)\1/gu,
    /\b(?:require|__require\d*)\s*\(\s*(["'])([^"'\\\r\n]+)\1\s*\)/gu,
  ] as const;
  const specifiers: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function assertAllowedModuleSpecifiers(
  source: string,
  label: string,
  requiredSpecifiers: readonly string[],
  allowNonLiteralDynamicImport: boolean,
): void {
  const specifiers = collectLiteralModuleSpecifiers(source);
  const allowed = new Set(requiredSpecifiers);
  for (const specifier of specifiers) {
    if (specifier.startsWith("node:")) {
      if (
        !NODE_BUILTIN_SPECIFIERS.has(specifier) ||
        specifier === "node:test" ||
        specifier.startsWith("node:test/") ||
        [
          "node:child_process",
          "node:dgram",
          "node:http",
          "node:http2",
          "node:https",
          "node:net",
          "node:tls",
        ].includes(specifier)
      ) {
        throw fail(
          "MEMBER_INVALID",
          `${label} contains a forbidden Node builtin import.`,
        );
      }
      continue;
    }
    if (!allowed.has(specifier)) {
      throw fail(
        "MEMBER_INVALID",
        `${label} contains ambient, nonfixed, or undeclared module resolution.`,
      );
    }
  }
  for (const required of requiredSpecifiers) {
    if (specifiers.filter((specifier) => specifier === required).length !== 1) {
      throw fail(
        "MEMBER_INVALID",
        `${label} must contain exactly one ${required} module import.`,
      );
    }
  }
  if (
    !allowNonLiteralDynamicImport &&
    /\bimport\s*\(/u.test(
      source.replace(
        /\bimport\s*\(\s*(["'])([^"'\\\r\n]+)\1\s*\)/gu,
        "",
      ),
    )
  ) {
    throw fail(
      "MEMBER_INVALID",
      `${label} contains a nonliteral dynamic import target.`,
    );
  }
}

function assertNoForbiddenServerCapabilities(
  source: string,
  label: string,
  options: {
    readonly allowCreateRequire: boolean;
    readonly allowFetch: boolean;
  },
): void {
  const forbidden: RegExp[] = [
    /\bsourceMappingURL\b/u,
    /\bsourcesContent\b/u,
    /\b(?:tsx|ts-node|vitest|jest|__testOnly|testOnly|verificationSeam)\b/iu,
    /\bcreateServer\s*\(/u,
    /\.\s*listen\s*\(/u,
    /\b(?:launch|open|start)(?:Default)?Browser\s*\(/iu,
    /\b(?:WebSocket|EventSource)\s*\(/u,
    /\b(?:reviewedAnchor|implementationPackRoot|manifestFileSha256|manifestFileByteLength|fixedProductionReviewedPack)\b/u,
    /\bimport\.meta\.resolve\b/u,
    /\brequire\.resolve\b/u,
    /\bnode_modules\b/iu,
    /\bNODE_(?:OPTIONS|PATH)\b/u,
    /(?:^|[^A-Za-z0-9_])(?:\.\.\/)+(?:src|source)(?:\/|["'])/u,
    /["'][^"']+\.tsx?(?:[?#][^"']*)?["']/iu,
    /PrivateReleases\/trades-hall-grand-hall-t554-workbench-v2\/payload/iu,
  ];
  if (!options.allowCreateRequire) {
    forbidden.push(/\bcreateRequire\b/u, /\b(?:require|__require\d*)\s*\(/u);
  }
  if (!options.allowFetch) forbidden.push(/\bfetch\s*\(/u);
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw fail(
      "MEMBER_INVALID",
      `${label} contains a forbidden launch, source, test, network, resolution, or caller-selected verification surface.`,
    );
  }
  const capsuleOccurrences = source.split(
    GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  ).length - 1;
  const isGateOrCore =
    label === "Payload admission gate" || label === "Payload core";
  if (
    (isGateOrCore && capsuleOccurrences !== 1) ||
    (!isGateOrCore && capsuleOccurrences !== 0)
  ) {
    throw fail(
      "MEMBER_INVALID",
      `${label} does not contain its exact permitted fixed-capsule URL multiplicity.`,
    );
  }
  const withoutCapsule = source.replaceAll(
    GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
    "",
  );
  const withoutFixedLoopbackOrigin = withoutCapsule.replaceAll(
    "http://127.0.0.1:",
    "",
  );
  if (/\b(?:file|https?):\/\//iu.test(withoutFixedLoopbackOrigin)) {
    throw fail(
      "MEMBER_INVALID",
      `${label} contains a nonfixed file or HTTP(S) target.`,
    );
  }
}

function assertSharpRuntimePolicy(source: string): void {
  const forbidden = [
    /\bsourceMappingURL\b/u,
    /\bsourcesContent\b/u,
    /\b(?:tsx|ts-node|vitest|jest|__testOnly|testOnly|verificationSeam)\b/iu,
    /\bcreateServer\s*\(/u,
    /\.\s*listen\s*\(/u,
    /\bfetch\s*\(/u,
    /\b(?:WebSocket|EventSource)\s*\(/u,
    /\b(?:reviewedAnchor|implementationPackRoot|manifestFileSha256|manifestFileByteLength)\b/u,
    /\bimport\.meta\.resolve\b/u,
    /\brequire\.resolve\b/u,
    /\bNODE_(?:OPTIONS|PATH)\b/u,
    /process\.env(?:\[\s*["']PATH["']\s*\]|\.PATH)\s*=/u,
  ] as const;
  if (
    forbidden.some((pattern) => pattern.test(source)) ||
    !source.includes("sharp-win32-x64-0.35.3.node") ||
    !source.includes("createRequire") ||
    !source.includes("import.meta.url")
  ) {
    throw fail(
      "MEMBER_INVALID",
      "Vendored Sharp runtime does not bind the exact native addon without launch, ambient-path, test, or network authority.",
    );
  }
  assertAllowedModuleSpecifiers(
    source,
    "Vendored Sharp runtime",
    [],
    true,
  );
}

function assertServerJavascriptPolicy(
  member: GrandHallT554NativeReviewImplementationMemberV2,
  bytes: Buffer,
): void {
  const source = decodeUtf8(bytes, member.relativePath);
  switch (member.kind) {
    case "payload-admission-gate":
      assertNoForbiddenServerCapabilities(source, "Payload admission gate", {
        allowCreateRequire: false,
        allowFetch: false,
      });
      assertAllowedModuleSpecifiers(
        source,
        "Payload admission gate",
        [
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
        ],
        false,
      );
      return;
    case "payload-core":
      assertNoForbiddenServerCapabilities(source, "Payload core", {
        allowCreateRequire: false,
        allowFetch: false,
      });
      assertAllowedModuleSpecifiers(
        source,
        "Payload core",
        [
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
        ],
        false,
      );
      return;
    case "trusted-http-adapter":
      assertNoForbiddenServerCapabilities(source, "Trusted HTTP adapter", {
        allowCreateRequire: false,
        allowFetch: false,
      });
      assertAllowedModuleSpecifiers(
        source,
        "Trusted HTTP adapter",
        [],
        false,
      );
      return;
    case "runtime-bootstrap":
      assertNoForbiddenServerCapabilities(source, "Runtime bootstrap", {
        allowCreateRequire: true,
        allowFetch: false,
      });
      assertAllowedModuleSpecifiers(
        source,
        "Runtime bootstrap",
        [],
        true,
      );
      return;
    case "sharp-runtime":
      assertSharpRuntimePolicy(source);
      return;
    default:
      return;
  }
}

function assertStaticAssetPolicy(
  member: GrandHallT554NativeReviewImplementationMemberV2,
  bytes: Buffer,
): void {
  const source = decodeUtf8(bytes, member.relativePath);
  if (/\b(?:file|https?):\/\//iu.test(source) || /\bsourceMappingURL\b/u.test(source)) {
    throw fail(
      "MEMBER_INVALID",
      `${member.relativePath} contains an external target or source map.`,
    );
  }
  if (
    member.relativePath ===
    GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2
  ) {
    if (
      !source.includes('href="/assets/t554-native-review-v2.css"') ||
      !source.includes('src="/assets/t554-native-review-v2.js"')
    ) {
      throw fail(
        "MEMBER_INVALID",
        "The fixed HTML document does not bind the exact local static assets.",
      );
    }
    return;
  }
  if (
    member.relativePath !==
    GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2
  ) {
    return;
  }
  assertNoForbiddenServerCapabilities(source, "Browser static application", {
    allowCreateRequire: false,
    allowFetch: true,
  });
  assertAllowedModuleSpecifiers(
    source,
    "Browser static application",
    [],
    false,
  );
  for (const match of source.matchAll(/\bfetch\s*\(\s*(["'])([^"']+)\1/gu)) {
    const target = match[2];
    if (
      target === undefined ||
      (!target.startsWith("/") && !target.startsWith("./")) ||
      target.startsWith("//")
    ) {
      throw fail(
        "MEMBER_INVALID",
        "Browser static JavaScript may fetch only an exact same-origin relative target.",
      );
    }
  }
}

function assertMemberContentPolicy(
  member: GrandHallT554NativeReviewImplementationMemberV2,
  bytes: Buffer,
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): void {
  if (member.kind === "runtime-attestation-probe") {
    if (
      bytes.length !== REVIEWED_RUNTIME_PROBE_BYTE_LENGTH ||
      sha256(bytes) !== REVIEWED_RUNTIME_PROBE_SHA256
    ) {
      throw fail(
        "MEMBER_INVALID",
        "Runtime-attestation JPEG differs from the exact deterministic decoder probe.",
      );
    }
    return;
  }
  if (member.kind === "decoder-closure-metadata") {
    const expected = Buffer.from(
      `${stableCanonicalJson(CanonicalJsonValueSchema.parse(manifest.decoder))}\n`,
      "utf8",
    );
    try {
      if (!expected.equals(bytes)) {
        throw fail(
          "MEMBER_INVALID",
          "Decoder closure metadata bytes do not exactly match the manifest-bound Sharp/addon/libvips closure.",
        );
      }
    } finally {
      expected.fill(0);
    }
    return;
  }
  if (member.kind === "module-metadata") {
    try {
      const parsed = parseGrandHallT554StrictJson(bytes);
      const canonical = Buffer.from(
        `${stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed))}\n`,
        "utf8",
      );
      try {
        if (!canonical.equals(bytes) || !isRecord(parsed)) {
          throw new Error("Module metadata is not canonical JSON plus LF.");
        }
      } finally {
        canonical.fill(0);
      }
      if (!isRecord(parsed)) {
        throw new Error("Module metadata is not one JSON object.");
      }
      assertExactKeys(
        parsed,
        ["name", "private", "type", "version"],
        "Implementation module metadata",
      );
      if (
        parsed.name !==
          "@venviewer/grand-hall-t554-native-review-implementation-pack" ||
        parsed.private !== true ||
        parsed.type !== "module" ||
        parsed.version !== "2.0.0"
      ) {
        throw new Error(
          "Module metadata does not enforce the private ESM v2 pack.",
        );
      }
    } catch (error) {
      if (
        error instanceof GrandHallT554NativeReviewImplementationManifestError &&
        error.code === "MEMBER_INVALID"
      ) {
        throw error;
      }
      throw fail(
        "MEMBER_INVALID",
        "Implementation module metadata does not enforce the exact private compiled ESM v2 payload.",
        error,
      );
    }
    return;
  }
  if (member.kind === "static-asset") {
    assertStaticAssetPolicy(member, bytes);
    return;
  }
  if (
    member.kind === "sharp-native-addon" ||
    member.kind === "libvips-native-dependency" ||
    member.kind === "runtime-inspector-addon"
  ) {
    // Native binaries are opaque pack members. Their exact path, descriptor,
    // byte length, digest, tree identity, and race-free reread are enforced by
    // the closed manifest and the shared V1 filesystem verifier.
    return;
  }
  assertServerJavascriptPolicy(member, bytes);
}

function assertRuntimeAndBootstrapIdentity(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
  runtimeIdentity: GrandHallT554NativeReviewImplementationRuntimeV2,
  bootstrapIdentity: __GrandHallT554NativeReviewBootstrapExecutionIdentity,
): void {
  try {
    const expectedRuntime = stableCanonicalJson(
      CanonicalJsonValueSchema.parse(manifest.runtime),
    );
    const actualRuntime = stableCanonicalJson(
      CanonicalJsonValueSchema.parse(runtimeIdentity),
    );
    if (expectedRuntime !== actualRuntime) {
      throw new Error("Runtime identity differs.");
    }
  } catch (error) {
    throw fail(
      "RUNTIME_MISMATCH",
      "Active Node, ABI, platform, or architecture does not match the reviewed v2 payload manifest.",
      error,
    );
  }
  const observedBootstrap: unknown = bootstrapIdentity;
  if (
    !isRecord(observedBootstrap) ||
    observedBootstrap.compiledJavascriptModule !== true ||
    !Array.isArray(observedBootstrap.execArgv) ||
    observedBootstrap.execArgv.length !== 0 ||
    observedBootstrap.nodeOptions !== null ||
    observedBootstrap.nodePath !== null
  ) {
    throw fail(
      "RUNTIME_MISMATCH",
      "V2 payload verification requires compiled JavaScript without execArgv, NODE_OPTIONS, or NODE_PATH injection.",
    );
  }
}

function requireAbsoluteLocalRoot(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    (process.platform === "win32" && !WINDOWS_DRIVE_ROOT_PATTERN.test(value))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Implementation-pack root must be one absolute local non-device path.",
    );
  }
  return resolve(value);
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function verifyExactPackWithObservations(
  input: __GrandHallT554NativeReviewImplementationVerificationInputV2,
): Promise<
  __GrandHallT554NativeReviewExactPackVerificationFacts<GrandHallT554NativeReviewImplementationManifestV2>
> {
  const root = requireAbsoluteLocalRoot(input.implementationPackRoot);
  const runtimeIdentity =
    input.runtimeIdentity ??
    __internalObserveGrandHallT554NativeReviewRuntimeIdentity();
  const bootstrapExecutionIdentity =
    input.bootstrapExecutionIdentity ??
    __internalObserveGrandHallT554NativeReviewBootstrapExecutionIdentity();
  return __internalVerifyGrandHallT554NativeReviewExactImplementationPack({
    implementationPackRoot: root,
    reviewedAnchor: input.reviewedAnchor,
    manifestFilename:
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
    parseCanonicalManifestBytes,
    assertRuntime: (manifest) => {
      assertRuntimeAndBootstrapIdentity(
        manifest,
        runtimeIdentity,
        bootstrapExecutionIdentity,
      );
    },
    assertMemberContentPolicy,
    computeMemberInventorySha256,
    seam: input.seam,
  });
}

async function verifyCandidateWithObservations(
  input: __GrandHallT554NativeReviewImplementationVerificationInputV2,
): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2> {
  const root = requireAbsoluteLocalRoot(input.implementationPackRoot);
  const exact = await verifyExactPackWithObservations({
    ...input,
    implementationPackRoot: root,
  });
  const candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2 = {
    schemaVersion:
      "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v2",
    manifest: exact.manifest,
    manifestBinding: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
      implementationId: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
      ...exact.manifestBinding,
    },
    memberInventorySha256: exact.memberInventorySha256,
    memberCount: exact.memberCount,
    totalMemberBytes: exact.totalMemberBytes,
    copyExactManifestBytes: exact.copyExactManifestBytes,
    concreteBytesVerified: true,
    runtimeIdentityVerified: true,
    bootstrapExecutionIdentityVerified: true,
    reviewedDecoderClosureBytesVerified: true,
    fixedAdmissionBindingVerified: true,
    executionPolicyManifestVerified: true,
    exactRootInventoryVerified: true,
    authority: "none",
    standaloneProductionFactoryAvailable: false,
    runtimeAuthorityAvailable: false,
  };
  const frozenCandidate = deepFreeze(candidate);
  VERIFIED_CANDIDATE_IDENTITIES.add(frozenCandidate);
  VERIFIED_CANDIDATE_ROOTS.set(frozenCandidate, comparablePath(root));
  return frozenCandidate;
}

/** Returns true only for an exact same-instance caller-anchored v2 candidate. */
export function isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(
  value: unknown,
): value is GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_CANDIDATE_IDENTITIES.has(value)
  );
}

/**
 * Requires both the non-forgeable candidate identity and its module-private
 * canonical root binding. Candidate data itself never contains a filesystem
 * path.
 */
export function assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2(
  value: unknown,
  implementationPackRoot: string,
): asserts value is GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2 {
  if (!isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(value)) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "V2 implementation-pack candidate is not an exact same-instance verified handle.",
    );
  }
  const root = requireAbsoluteLocalRoot(implementationPackRoot);
  if (VERIFIED_CANDIDATE_ROOTS.get(value) !== comparablePath(root)) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "V2 implementation-pack candidate was verified for a different concrete root.",
    );
  }
}

/**
 * Fully verifies caller-anchored candidate bytes without minting production or
 * runtime authority. Runtime and bootstrap observations are captured here and
 * cannot be supplied through the public input.
 */
export function verifyGrandHallT554NativeReviewImplementationPackCandidateV2(input: {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
}): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2> {
  return verifyCandidateWithObservations({
    implementationPackRoot: input.implementationPackRoot,
    reviewedAnchor: input.reviewedAnchor,
    runtimeIdentity:
      __internalObserveGrandHallT554NativeReviewRuntimeIdentity(),
    bootstrapExecutionIdentity:
      __internalObserveGrandHallT554NativeReviewBootstrapExecutionIdentity(),
    seam: {},
  });
}

async function reverifyCandidateWithObservations(
  input: {
    readonly implementationPackRoot: string;
    readonly candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2;
  },
  runtimeIdentity: GrandHallT554NativeReviewImplementationRuntimeV2,
  bootstrapExecutionIdentity: __GrandHallT554NativeReviewBootstrapExecutionIdentity,
  seam: __GrandHallT554NativeReviewImplementationVerificationSeam,
): Promise<void> {
  assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2(
    input.candidate,
    input.implementationPackRoot,
  );
  const exact = await verifyExactPackWithObservations({
    implementationPackRoot: input.implementationPackRoot,
    reviewedAnchor: {
      manifestSemanticSha256:
        input.candidate.manifestBinding.semanticSha256,
      manifestFileSha256: input.candidate.manifestBinding.fileSha256,
      manifestFileByteLength: input.candidate.manifestBinding.byteLength,
    },
    runtimeIdentity,
    bootstrapExecutionIdentity,
    seam,
  });
  if (
    exact.manifestBinding.semanticSha256 !==
      input.candidate.manifestBinding.semanticSha256 ||
    exact.manifestBinding.fileSha256 !==
      input.candidate.manifestBinding.fileSha256 ||
    exact.manifestBinding.byteLength !==
      input.candidate.manifestBinding.byteLength ||
    exact.memberInventorySha256 !== input.candidate.memberInventorySha256 ||
    exact.memberCount !== input.candidate.memberCount ||
    exact.totalMemberBytes !== input.candidate.totalMemberBytes
  ) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "V2 implementation-pack byte re-verification produced a different candidate binding.",
    );
  }
}

/** Re-reads the complete exact same-root candidate using current observations. */
export function reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV2(input: {
  readonly implementationPackRoot: string;
  readonly candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2;
}): Promise<void> {
  return reverifyCandidateWithObservations(
    input,
    __internalObserveGrandHallT554NativeReviewRuntimeIdentity(),
    __internalObserveGrandHallT554NativeReviewBootstrapExecutionIdentity(),
    {},
  );
}

export const __testOnlyGrandHallT554NativeReviewImplementationManifestV2 =
  /* @__PURE__ */ Object.freeze({
    parseCanonicalManifestBytes,
    computeManifestSemanticSha256,
    computeMemberInventorySha256,
    verifyExactPackWithObservations,
    verifyCandidateWithObservations,
    reverifyCandidateWithObservations,
    constants: /* @__PURE__ */ Object.freeze({
      semanticDigestDomain: SEMANTIC_DIGEST_DOMAIN,
      memberInventoryDigestDomain: MEMBER_INVENTORY_DIGEST_DOMAIN,
      maximumMemberCount: MAXIMUM_MEMBER_COUNT,
      maximumMemberBytes: MAXIMUM_MEMBER_BYTES,
      maximumTotalMemberBytes: MAXIMUM_TOTAL_MEMBER_BYTES,
      reviewedRuntimeProbeSha256: REVIEWED_RUNTIME_PROBE_SHA256,
      reviewedRuntimeProbeByteLength: REVIEWED_RUNTIME_PROBE_BYTE_LENGTH,
      runtimeProbeBase64:
        GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
    }),
  });

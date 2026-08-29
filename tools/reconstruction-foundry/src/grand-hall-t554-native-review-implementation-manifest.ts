import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";

import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME =
  "grand-hall-t554-native-review-implementation-manifest.json";
export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA =
  "venviewer.grand-hall-t554-native-review-implementation-manifest.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER =
  "server/native-review-runtime-attestor.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER =
  "server/native-review-runtime-bootstrap.js";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER =
  "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER =
  "vendor/runtime-attestation/decoder-probe.jpg";
export const GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64 =
  "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAACAAMDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7/n/ZR/Zb8UeI/iLqXib9mv4A+ItRtvjD8avDttqGu/Bz4d6ve2/h/wAIfFrxp4T8J6FBdah4cuJ4tH8L+FdE0bwz4d0yORbLRPD+kaZo2mwW2nWFrbRf6F/Qd8SfEXgz6Ev0M8o4P4+414UynGfRL+jXxZjMr4a4pz3IsuxXFPHvgtwRxzxzxLicFlePwuGr8QcacbcRcQcY8WZzVpTzHiLinPc54gzjE4zNs0xuLr/84X7bTxd8V/D39pZ485DwD4n+IfA+RY/hH6M3HGOyXhDjXiThrKcbxp4m/RR8D/EnxJ4vxeXZLmWCweJ4o8QfETizinj7jjP61GebcWcacS8QcU59i8fnmc5jj8T/AP/Z";

const IMPLEMENTATION_ID = "grand-hall-t554-native-review-workbench-v1";
const SEMANTIC_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V1";
const MEMBER_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MEMBER_INVENTORY_V1";
const MAXIMUM_MANIFEST_BYTES = 512 * 1_024;
const MAXIMUM_MEMBER_COUNT = 128;
const MAXIMUM_MEMBER_BYTES = 32 * 1_024 * 1_024;
const MAXIMUM_TOTAL_MEMBER_BYTES = 128 * 1_024 * 1_024;
const MAXIMUM_DIRECTORY_COUNT = 96;
const MAXIMUM_TREE_ENTRY_COUNT =
  MAXIMUM_MEMBER_COUNT + 1 + MAXIMUM_DIRECTORY_COUNT;
const MAXIMUM_RELATIVE_PATH_BYTES = 240;
const MAXIMUM_PATH_DEPTH = 8;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const WINDOWS_DEVICE_PATTERN =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/](?![\\/])/u;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const VERSION_COMPONENT_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const RUNTIME_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const REVIEWED_RUNTIME_PROBE_SHA256 =
  "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078";
const REVIEWED_RUNTIME_PROBE_BYTE_LENGTH = 879;

const VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_IDENTITIES = new WeakSet();
const VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_ROOTS = new WeakMap<object, string>();
const VERIFIED_IMPLEMENTATION_PACK_IDENTITIES = new WeakSet();
const LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_IDENTITIES = new WeakSet();
const LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_PACKS = new WeakMap<
  object,
  GrandHallT554VerifiedNativeReviewImplementationPackV1
>();

const MANIFEST_KEYS = Object.freeze([
  "authority",
  "decoder",
  "execution",
  "implementationId",
  "memberCount",
  "members",
  "roomSlug",
  "runtime",
  "schemaVersion",
  "serverBundleModule",
  "semanticSha256",
  "sourceCount",
  "totalMemberBytes",
  "trustedHttpAdapterModule",
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
  "bindAddress",
  "browserControlledTruthAuthorized",
  "browserTrust",
  "dependencyClosure",
  "entryImportPolicy",
  "exportAuthorized",
  "externalNetworkAuthorized",
  "externalRuntimeModuleResolutionAuthorized",
  "generatedContentAuthorized",
  "httpLaunchIncluded",
  "mixedSourceDistResolutionAuthorized",
  "mode",
  "moduleFormat",
  "productionFactoryIncluded",
  "reconstructionAuthorized",
  "runtimeAdmissionAuthorized",
  "sourceMapsIncluded",
  "tsxExecutionAuthorized",
]);
const MEMBER_KEYS = Object.freeze([
  "byteLength",
  "kind",
  "relativePath",
  "sha256",
]);

export type GrandHallT554ImplementationSha256 = `sha256:${string}`;

export interface GrandHallT554NativeReviewImplementationRuntimeV1 {
  readonly nodeVersion: string;
  readonly nodeModulesAbi: string;
  readonly nodeNapiVersion: string;
  readonly platform: string;
  readonly architecture: string;
}

export interface GrandHallT554NativeReviewImplementationDecoderClosureV1 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-decoder-closure.v1";
  readonly library: "sharp";
  readonly sharpVersion: string;
  readonly libvipsVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly sourceJpegDecoderPipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1";
  readonly strictMaskPngDecoderPipeline: "canonical-grayscale8-source-grid-mask-and-reason-map.v2";
  readonly metadataMember: "vendor/decoder-runtime.json";
  readonly sharpRuntimeMembers: readonly string[];
  readonly sharpNativeAddonMember: string;
  readonly libvipsNativeDependencyMembers: readonly string[];
}

export interface GrandHallT554NativeReviewImplementationExecutionV1 {
  readonly mode: "compiled-esm-private-local-review-core.v1";
  readonly moduleFormat: "esm";
  readonly bindAddress: "127.0.0.1";
  readonly browserTrust: "untrusted-display-and-input";
  readonly dependencyClosure: "reviewed-pack-members-plus-node-builtins.v1";
  readonly entryImportPolicy: "verify-entire-pack-before-import.v1";
  readonly productionFactoryIncluded: false;
  readonly httpLaunchIncluded: false;
  readonly sourceMapsIncluded: false;
  readonly tsxExecutionAuthorized: false;
  readonly mixedSourceDistResolutionAuthorized: false;
  readonly externalRuntimeModuleResolutionAuthorized: false;
  readonly browserControlledTruthAuthorized: false;
  readonly externalNetworkAuthorized: false;
  readonly acceptanceAuthorized: false;
  readonly reconstructionAuthorized: false;
  readonly runtimeAdmissionAuthorized: false;
  readonly exportAuthorized: false;
  readonly generatedContentAuthorized: false;
}

export interface GrandHallT554NativeReviewImplementationMemberV1 {
  readonly relativePath: string;
  readonly kind:
    | "module-metadata"
    | "decoder-closure-metadata"
    | "server-bundle"
    | "trusted-http-adapter"
    | "static-asset"
    | "sharp-runtime"
    | "sharp-native-addon"
    | "libvips-native-dependency"
    | "runtime-attestation-module"
    | "runtime-inspector-addon"
    | "runtime-attestation-probe";
  readonly sha256: GrandHallT554ImplementationSha256;
  readonly byteLength: number;
}

export interface GrandHallT554NativeReviewImplementationManifestV1 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA;
  readonly implementationId: typeof IMPLEMENTATION_ID;
  readonly venueSlug: "trades-hall";
  readonly roomSlug: "grand-hall";
  readonly sourceCount: 148;
  readonly authority: "none";
  readonly runtime: GrandHallT554NativeReviewImplementationRuntimeV1;
  readonly decoder: GrandHallT554NativeReviewImplementationDecoderClosureV1;
  readonly execution: GrandHallT554NativeReviewImplementationExecutionV1;
  readonly serverBundleModule: string;
  readonly trustedHttpAdapterModule: string;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  readonly members: readonly GrandHallT554NativeReviewImplementationMemberV1[];
  readonly semanticSha256: GrandHallT554ImplementationSha256;
}

interface GrandHallT554NativeReviewImplementationPackVerificationFactsV1 {
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV1;
  readonly manifestBinding: {
    readonly schemaVersion: "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2";
    readonly implementationId: typeof IMPLEMENTATION_ID;
    readonly semanticSha256: GrandHallT554ImplementationSha256;
    readonly fileSha256: GrandHallT554ImplementationSha256;
    readonly byteLength: number;
  };
  readonly memberInventorySha256: GrandHallT554ImplementationSha256;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  /** Returns a fresh copy of the exact verified canonical bytes for later custody. */
  readonly copyExactManifestBytes: () => Buffer;
  readonly concreteBytesVerified: true;
  readonly runtimeIdentityVerified: true;
  readonly reviewedDecoderClosureBytesVerified: true;
  readonly decoderDependencyGraphVerified: false;
  readonly decoderRuntimeLoaded: false;
  readonly safeEntrypointImportAvailable: false;
  readonly platformAliasAuditComplete: false;
  readonly releaseReady: false;
  readonly executionPolicyManifestVerified: true;
  readonly exactRootInventoryVerified: true;
  readonly authority: "none";
  readonly productionFactoryAvailable: false;
}

/**
 * Caller-anchored proof that concrete candidate bytes passed the complete
 * verifier. This handle is deliberately not production-admission authority.
 */
export interface GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1
  extends GrandHallT554NativeReviewImplementationPackVerificationFactsV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v1";
}

/**
 * Production-admitted pack minted only from the module-private fixed reviewed
 * pack selected by the zero-argument production verifier.
 */
export interface GrandHallT554VerifiedNativeReviewImplementationPackV1
  extends GrandHallT554NativeReviewImplementationPackVerificationFactsV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-verified-native-review-implementation-pack.v1";
}

/**
 * Process-local proof that the exact verified pack's decoder closure was loaded
 * and attested in the same runtime instance. No production minter exists yet.
 */
export interface GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1 {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-loaded-native-review-implementation-runtime-authority.v1";
  readonly manifestBinding: GrandHallT554VerifiedNativeReviewImplementationPackV1["manifestBinding"];
  readonly memberInventorySha256: GrandHallT554ImplementationSha256;
  readonly decoderRuntimeLoaded: true;
  readonly safeEntrypointImportAvailable: true;
  readonly sameInstanceDecoderAttested: true;
  readonly authority: "none";
}

export interface __GrandHallT554NativeReviewImplementationReviewedAnchor {
  readonly manifestSemanticSha256: GrandHallT554ImplementationSha256;
  readonly manifestFileSha256: GrandHallT554ImplementationSha256;
  readonly manifestFileByteLength: number;
}

export interface __GrandHallT554NativeReviewImplementationVerificationSeam {
  readonly afterInitialInventory?: () => Promise<void> | void;
  readonly afterDescriptorOpened?: (
    relativePath: string,
  ) => Promise<void> | void;
  readonly afterReadChunk?: (
    relativePath: string,
    totalBytesRead: number,
  ) => Promise<void> | void;
  readonly afterExceptionalReadBufferDestroyed?: (facts: {
    readonly relativePath: string;
    readonly bytesWereZeroed: boolean;
  }) => Promise<void> | void;
  readonly afterExactRead?: (relativePath: string) => Promise<void> | void;
  readonly afterMemberReads?: () => Promise<void> | void;
}

export interface __GrandHallT554NativeReviewImplementationVerificationInput {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
  readonly runtimeIdentity?: GrandHallT554NativeReviewImplementationRuntimeV1;
  readonly bootstrapExecutionIdentity?: __GrandHallT554NativeReviewBootstrapExecutionIdentity;
  readonly seam?: __GrandHallT554NativeReviewImplementationVerificationSeam;
}

export interface __GrandHallT554NativeReviewBootstrapExecutionIdentity {
  readonly compiledJavascriptModule: boolean;
  readonly execArgv: readonly string[];
  readonly nodeOptions: string | null;
  readonly nodePath: string | null;
}

export interface __GrandHallT554NativeReviewExactImplementationMember {
  readonly relativePath: string;
  readonly sha256: GrandHallT554ImplementationSha256;
  readonly byteLength: number;
}

export interface __GrandHallT554NativeReviewExactImplementationManifest<
  TMember extends __GrandHallT554NativeReviewExactImplementationMember,
> {
  readonly semanticSha256: GrandHallT554ImplementationSha256;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  readonly members: readonly TMember[];
}

export interface __GrandHallT554NativeReviewExactPackVerificationFacts<
  TManifest,
> {
  readonly manifest: TManifest;
  readonly manifestBinding: {
    readonly semanticSha256: GrandHallT554ImplementationSha256;
    readonly fileSha256: GrandHallT554ImplementationSha256;
    readonly byteLength: number;
  };
  readonly memberInventorySha256: GrandHallT554ImplementationSha256;
  readonly memberCount: number;
  readonly totalMemberBytes: number;
  /** Returns a fresh copy of the exact verified manifest bytes. */
  readonly copyExactManifestBytes: () => Buffer;
}

export interface __GrandHallT554NativeReviewExactPackVerificationInput<
  TMember extends __GrandHallT554NativeReviewExactImplementationMember,
  TManifest extends
    __GrandHallT554NativeReviewExactImplementationManifest<TMember>,
> {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
  readonly manifestFilename: string;
  readonly parseCanonicalManifestBytes: (bytes: Buffer) => TManifest;
  readonly assertRuntime: (manifest: TManifest) => void;
  readonly assertMemberContentPolicy: (
    member: TMember,
    bytes: Buffer,
    manifest: TManifest,
  ) => void;
  readonly computeMemberInventorySha256: (
    members: readonly TMember[],
  ) => GrandHallT554ImplementationSha256;
  readonly seam?: __GrandHallT554NativeReviewImplementationVerificationSeam;
}

export type GrandHallT554NativeReviewImplementationManifestErrorCode =
  | "REVIEWED_PACK_NOT_CONFIGURED"
  | "ARGUMENT_INVALID"
  | "ROOT_UNSAFE"
  | "MANIFEST_INVALID"
  | "REVIEWED_ANCHOR_MISMATCH"
  | "RUNTIME_MISMATCH"
  | "INVENTORY_MISMATCH"
  | "MEMBER_INVALID"
  | "PACK_CHANGED"
  | "UNVERIFIED_HANDLE"
  | "LOADED_RUNTIME_AUTHORITY_INVALID";

export class GrandHallT554NativeReviewImplementationManifestError extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewImplementationManifestErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewImplementationManifestError";
  }
}

/** Returns true only for an exact caller-anchored candidate verification result. */
export function isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(
  value: unknown,
): value is GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_IDENTITIES.has(value)
  );
}

/**
 * Fails unless the exact same-instance candidate was minted for this local
 * canonical pack root. The root binding stays module-private and path-free in
 * the candidate data itself.
 */
export function assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
  value: unknown,
  implementationPackRoot: string,
): asserts value is GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1 {
  if (!isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(value)) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "Implementation-pack candidate is not an exact same-instance verified handle.",
    );
  }
  const root = requireAbsoluteLocalRoot(implementationPackRoot);
  if (
    VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_ROOTS.get(value) !==
    comparablePath(root)
  ) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "Implementation-pack candidate was verified for a different concrete root.",
    );
  }
}

/**
 * Returns true only for the exact in-process result admitted from the
 * module-private fixed production pack. A caller-anchored candidate and every
 * structural copy retain evidence data, never production admission authority.
 */
export function isGrandHallT554VerifiedNativeReviewImplementationPackV1(
  value: unknown,
): value is GrandHallT554VerifiedNativeReviewImplementationPackV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_IMPLEMENTATION_PACK_IDENTITIES.has(value)
  );
}

/** Fails closed unless `value` is an identity-branded verified pack. */
export function assertGrandHallT554VerifiedNativeReviewImplementationPackV1(
  value: unknown,
): asserts value is GrandHallT554VerifiedNativeReviewImplementationPackV1 {
  if (!isGrandHallT554VerifiedNativeReviewImplementationPackV1(value)) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "Implementation-pack handle was not admitted by the module-private fixed reviewed-pack verifier.",
    );
  }
}

export function isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
  value: unknown,
): value is GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_IDENTITIES.has(value)
  );
}

/**
 * Validates both the non-forgeable loaded-runtime authority and the exact pack
 * object it attested. A verified pre-import pack alone can never satisfy this.
 */
export function assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
  value: unknown,
  pack: GrandHallT554VerifiedNativeReviewImplementationPackV1,
): asserts value is GrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1 {
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1(pack);
  if (
    !isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(value) ||
    LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_PACKS.get(value) !== pack
  ) {
    throw fail(
      "LOADED_RUNTIME_AUTHORITY_INVALID",
      "The exact implementation pack has no same-instance loaded decoder/runtime authority.",
    );
  }
}

interface TreeEntrySnapshot {
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly stats: BigIntStats;
}

interface TreeSnapshot {
  readonly rootStats: BigIntStats;
  readonly directories: readonly TreeEntrySnapshot[];
  readonly files: readonly TreeEntrySnapshot[];
}

interface StableFileRead {
  readonly bytes: Buffer;
  readonly stats: BigIntStats;
}

interface FixedReviewedImplementationPack {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
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

function manifestSemanticMaterial(
  manifest: GrandHallT554NativeReviewImplementationManifestV1,
): Omit<GrandHallT554NativeReviewImplementationManifestV1, "semanticSha256"> {
  const { semanticSha256: _semanticSha256, ...material } = manifest;
  return material;
}

function computeManifestSemanticSha256(
  manifest: GrandHallT554NativeReviewImplementationManifestV1,
): GrandHallT554ImplementationSha256 {
  return semanticSha256(
    SEMANTIC_DIGEST_DOMAIN,
    manifestSemanticMaterial(manifest),
  );
}

function computeMemberInventorySha256(
  members: readonly GrandHallT554NativeReviewImplementationMemberV1[],
): GrandHallT554ImplementationSha256 {
  return semanticSha256(MEMBER_INVENTORY_DIGEST_DOMAIN, members);
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
    throw fail("ROOT_UNSAFE", `${label} contains an unsafe path segment.`);
  }
}

function assertSafeRelativePath(relativePath: string, label: string): void {
  if (
    typeof relativePath !== "string" ||
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
): GrandHallT554NativeReviewImplementationRuntimeV1 {
  const runtime = requireRecord(
    value,
    RUNTIME_KEYS,
    "Implementation runtime identity",
  );
  return {
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
  runtime: GrandHallT554NativeReviewImplementationRuntimeV1,
): GrandHallT554NativeReviewImplementationDecoderClosureV1 {
  const decoder = requireRecord(
    value,
    DECODER_KEYS,
    "Implementation decoder closure",
  );
  const platform = requirePattern(
    decoder.platform,
    RUNTIME_NAME_PATTERN,
    "Decoder platform",
  );
  const architecture = requirePattern(
    decoder.architecture,
    RUNTIME_NAME_PATTERN,
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
    sharpVersion: requirePattern(
      decoder.sharpVersion,
      VERSION_COMPONENT_PATTERN,
      "sharp version",
    ),
    libvipsVersion: requirePattern(
      decoder.libvipsVersion,
      VERSION_COMPONENT_PATTERN,
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
      "vendor/decoder-runtime.json",
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
): GrandHallT554NativeReviewImplementationExecutionV1 {
  const execution = requireRecord(
    value,
    EXECUTION_KEYS,
    "Implementation execution policy",
  );
  return {
    mode: requireLiteral(
      execution.mode,
      "compiled-esm-private-local-review-core.v1",
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
      "reviewed-pack-members-plus-node-builtins.v1",
      "Dependency closure",
    ),
    entryImportPolicy: requireLiteral(
      execution.entryImportPolicy,
      "verify-entire-pack-before-import.v1",
      "Entry import policy",
    ),
    productionFactoryIncluded: requireLiteral(
      execution.productionFactoryIncluded,
      false,
      "Production factory inclusion",
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
    externalRuntimeModuleResolutionAuthorized: requireLiteral(
      execution.externalRuntimeModuleResolutionAuthorized,
      false,
      "External runtime module resolution authorization",
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

function parseMember(
  value: unknown,
  index: number,
  platform: string,
): GrandHallT554NativeReviewImplementationMemberV1 {
  const label = `Implementation member ${String(index)}`;
  const member = requireRecord(value, MEMBER_KEYS, label);
  if (typeof member.relativePath !== "string") {
    throw fail("MANIFEST_INVALID", `${label} relative path must be a string.`);
  }
  assertSafeRelativePath(member.relativePath, `${label} relative path`);
  const kinds = [
    "module-metadata",
    "decoder-closure-metadata",
    "server-bundle",
    "trusted-http-adapter",
    "static-asset",
    "sharp-runtime",
    "sharp-native-addon",
    "libvips-native-dependency",
    "runtime-attestation-module",
    "runtime-inspector-addon",
    "runtime-attestation-probe",
  ] as const;
  const kind = kinds.find((candidate) => candidate === member.kind);
  if (kind === undefined) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} kind is not part of the closed implementation-pack contract.`,
    );
  }
  const path = member.relativePath;
  const allowed = (() => {
    switch (kind) {
      case "module-metadata":
        return path === "package.json";
      case "decoder-closure-metadata":
        return path === "vendor/decoder-runtime.json";
      case "server-bundle":
      case "trusted-http-adapter":
        return path.startsWith("server/") && path.endsWith(".js");
      case "static-asset":
        return (
          path.startsWith("static/") &&
          [".css", ".html", ".js", ".png", ".svg", ".woff2"].some((extension) =>
            path.endsWith(extension),
          )
        );
      case "sharp-runtime":
        return (
          path.startsWith("vendor/sharp/") &&
          (path.endsWith(".js") || path.endsWith(".json"))
        );
      case "sharp-native-addon":
        return path.startsWith("vendor/sharp/") && path.endsWith(".node");
      case "libvips-native-dependency":
        if (!path.startsWith("vendor/libvips/")) return false;
        if (platform === "win32") return path.endsWith(".dll");
        if (platform === "darwin") return path.endsWith(".dylib");
        return path.endsWith(".so") || /\.so\.\d+(?:\.\d+)*$/u.test(path);
      case "runtime-attestation-module":
        return (
          path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER ||
          path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER
        );
      case "runtime-inspector-addon":
        return path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER;
      case "runtime-attestation-probe":
        return path === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER;
    }
  })();
  if (
    !allowed ||
    path === GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME
  ) {
    throw fail(
      "MANIFEST_INVALID",
      `${label} path does not match its closed implementation member kind.`,
    );
  }
  return {
    relativePath: path,
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

function assertExactMemberKinds(
  members: readonly GrandHallT554NativeReviewImplementationMemberV1[],
): void {
  const count = (
    kind: GrandHallT554NativeReviewImplementationMemberV1["kind"],
  ): number => members.filter((member) => member.kind === kind).length;
  const staticMembers = members.filter(
    (member) => member.kind === "static-asset",
  );
  if (
    count("module-metadata") !== 1 ||
    count("decoder-closure-metadata") !== 1 ||
    count("server-bundle") !== 1 ||
    count("trusted-http-adapter") !== 1 ||
    count("sharp-runtime") < 1 ||
    count("sharp-native-addon") !== 1 ||
    count("libvips-native-dependency") < 1 ||
    count("runtime-attestation-module") !== 2 ||
    count("runtime-inspector-addon") !== 1 ||
    count("runtime-attestation-probe") !== 1 ||
    !members.some(
      (member) =>
        member.relativePath ===
        GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
    ) ||
    !members.some(
      (member) =>
        member.relativePath ===
        GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
    ) ||
    ![".html", ".css", ".js"].every((extension) =>
      staticMembers.some((member) => member.relativePath.endsWith(extension)),
    )
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation members do not close the server, HTTP, static, Sharp, libvips, runtime-attestor, inspector, and fixed-probe dependency set.",
    );
  }
}

function assertDecoderMemberClosure(
  decoder: GrandHallT554NativeReviewImplementationDecoderClosureV1,
  members: readonly GrandHallT554NativeReviewImplementationMemberV1[],
): void {
  const pathsOfKind = (
    kind: GrandHallT554NativeReviewImplementationMemberV1["kind"],
  ): readonly string[] =>
    members
      .filter((member) => member.kind === kind)
      .map((member) => member.relativePath)
      .sort(lexicalOrder);
  const samePaths = (
    left: readonly string[],
    right: readonly string[],
  ): boolean =>
    left.length === right.length &&
    left.every((path, index) => path === right[index]);
  if (
    !samePaths(decoder.sharpRuntimeMembers, pathsOfKind("sharp-runtime")) ||
    !samePaths(
      decoder.libvipsNativeDependencyMembers,
      pathsOfKind("libvips-native-dependency"),
    ) ||
    pathsOfKind("decoder-closure-metadata")[0] !== decoder.metadataMember ||
    pathsOfKind("sharp-native-addon")[0] !== decoder.sharpNativeAddonMember
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Decoder closure metadata does not bind every and only the declared Sharp, addon, and libvips members.",
    );
  }
}

function assertMemberOrderingAndCollisions(
  members: readonly __GrandHallT554NativeReviewExactImplementationMember[],
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
    const key = member.relativePath.toLowerCase();
    if (folded.has(key)) {
      throw fail(
        "MANIFEST_INVALID",
        "Implementation member inventory contains a case-fold collision.",
      );
    }
    folded.add(key);
  }
}

function assertExactVerificationMembers(
  manifest: __GrandHallT554NativeReviewExactImplementationManifest<__GrandHallT554NativeReviewExactImplementationMember>,
): void {
  if (
    manifest.members.length < 1 ||
    manifest.members.length > MAXIMUM_MEMBER_COUNT ||
    manifest.memberCount !== manifest.members.length
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation member count is outside its fixed bound or inconsistent with its exact inventory.",
    );
  }
  let totalMemberBytes = 0;
  for (const member of manifest.members) {
    assertSafeRelativePath(member.relativePath, "Implementation member path");
    requireSha256(member.sha256, "Implementation member SHA-256");
    requireBoundedInteger(
      member.byteLength,
      1,
      MAXIMUM_MEMBER_BYTES,
      "Implementation member byte length",
    );
    totalMemberBytes += member.byteLength;
  }
  if (
    totalMemberBytes > MAXIMUM_TOTAL_MEMBER_BYTES ||
    manifest.totalMemberBytes !== totalMemberBytes
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Implementation total member bytes are excessive or inconsistent with the exact inventory.",
    );
  }
  assertMemberOrderingAndCollisions(manifest.members);
}

function parseManifest(
  parsed: unknown,
): GrandHallT554NativeReviewImplementationManifestV1 {
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
  const members = value.members.map((member, index) =>
    parseMember(member, index, runtime.platform),
  );
  assertMemberOrderingAndCollisions(members);
  assertExactMemberKinds(members);
  assertDecoderMemberClosure(decoder, members);
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
  if (
    typeof value.serverBundleModule !== "string" ||
    typeof value.trustedHttpAdapterModule !== "string"
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Server bundle and trusted HTTP adapter module paths must be strings.",
    );
  }
  assertSafeRelativePath(value.serverBundleModule, "Server bundle module");
  assertSafeRelativePath(
    value.trustedHttpAdapterModule,
    "Trusted HTTP adapter module",
  );
  if (
    value.serverBundleModule === value.trustedHttpAdapterModule ||
    !members.some(
      (member) =>
        member.relativePath === value.serverBundleModule &&
        member.kind === "server-bundle",
    ) ||
    !members.some(
      (member) =>
        member.relativePath === value.trustedHttpAdapterModule &&
        member.kind === "trusted-http-adapter",
    )
  ) {
    throw fail(
      "MANIFEST_INVALID",
      "Server bundle and trusted HTTP adapter must name distinct exact compiled members of their declared kinds.",
    );
  }
  const manifest: GrandHallT554NativeReviewImplementationManifestV1 = {
    schemaVersion: requireLiteral(
      value.schemaVersion,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
      "Implementation manifest schema",
    ),
    implementationId: requireLiteral(
      value.implementationId,
      IMPLEMENTATION_ID,
      "Implementation identifier",
    ),
    venueSlug: requireLiteral(value.venueSlug, "trades-hall", "Venue slug"),
    roomSlug: requireLiteral(value.roomSlug, "grand-hall", "Room slug"),
    sourceCount: requireLiteral(value.sourceCount, 148, "Source count"),
    authority: requireLiteral(value.authority, "none", "Authority"),
    runtime,
    decoder,
    execution: parseExecution(value.execution),
    serverBundleModule: value.serverBundleModule,
    trustedHttpAdapterModule: value.trustedHttpAdapterModule,
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
): GrandHallT554NativeReviewImplementationManifestV1 {
  let parsed: unknown;
  try {
    parsed = parseGrandHallT554StrictJson(bytes);
    const canonical = Buffer.from(
      `${stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed))}\n`,
      "utf8",
    );
    if (!canonical.equals(bytes)) {
      throw fail(
        "MANIFEST_INVALID",
        "Implementation manifest must be exact canonical JSON followed by one LF.",
      );
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

function currentRuntimeIdentity(): GrandHallT554NativeReviewImplementationRuntimeV1 {
  const nodeModulesAbi: unknown = Reflect.get(process.versions, "modules");
  const nodeNapiVersion: unknown = Reflect.get(process.versions, "napi");
  if (
    typeof nodeModulesAbi !== "string" ||
    typeof nodeNapiVersion !== "string"
  ) {
    throw fail(
      "RUNTIME_MISMATCH",
      "The active Node runtime does not expose modules and N-API identities.",
    );
  }
  return Object.freeze({
    nodeVersion: process.version,
    nodeModulesAbi,
    nodeNapiVersion,
    platform: process.platform,
    architecture: process.arch,
  });
}

function assertRuntimeIdentity(
  manifest: GrandHallT554NativeReviewImplementationManifestV1,
  actual: GrandHallT554NativeReviewImplementationRuntimeV1,
): void {
  const expectedJson = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(manifest.runtime),
  );
  const actualJson = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(actual),
  );
  if (expectedJson !== actualJson) {
    throw fail(
      "RUNTIME_MISMATCH",
      "Active Node, ABI, platform, or architecture does not match the reviewed implementation manifest.",
    );
  }
}

function currentBootstrapExecutionIdentity(): __GrandHallT554NativeReviewBootstrapExecutionIdentity {
  return Object.freeze({
    compiledJavascriptModule: import.meta.url.endsWith(".js"),
    execArgv: Object.freeze(process.execArgv.slice()),
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    nodePath: process.env.NODE_PATH ?? null,
  });
}

/** Internal runtime observation for closed manifest-specific assertions. */
export function __internalObserveGrandHallT554NativeReviewRuntimeIdentity(): GrandHallT554NativeReviewImplementationRuntimeV1 {
  return currentRuntimeIdentity();
}

/** Internal bootstrap observation for closed manifest-specific assertions. */
export function __internalObserveGrandHallT554NativeReviewBootstrapExecutionIdentity(): __GrandHallT554NativeReviewBootstrapExecutionIdentity {
  return currentBootstrapExecutionIdentity();
}

function assertBootstrapExecutionIdentity(
  identity: __GrandHallT554NativeReviewBootstrapExecutionIdentity,
): void {
  if (
    !identity.compiledJavascriptModule ||
    !Array.isArray(identity.execArgv) ||
    identity.execArgv.length !== 0 ||
    identity.nodeOptions !== null ||
    identity.nodePath !== null
  ) {
    throw fail(
      "RUNTIME_MISMATCH",
      "Implementation verification requires a compiled JavaScript bootstrap without Node preload, loader, import, NODE_OPTIONS, or NODE_PATH injection.",
    );
  }
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameNode(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
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

function assertPathWithinRoot(root: string, candidate: string): void {
  const fromRoot = relative(comparablePath(root), comparablePath(candidate));
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw fail(
      "ROOT_UNSAFE",
      "Implementation-pack node escaped its fixed root.",
    );
  }
}

function assertDirectDirectory(
  expectedPath: string,
  canonicalPath: string,
  stats: BigIntStats,
  label: string,
): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    comparablePath(expectedPath) !== comparablePath(canonicalPath)
  ) {
    throw fail(
      "ROOT_UNSAFE",
      `${label} is not one direct canonical directory.`,
    );
  }
}

function assertDirectFile(
  expectedPath: string,
  canonicalPath: string,
  stats: BigIntStats,
  maximumBytes: number,
  label: string,
): void {
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1n ||
    stats.size < 1n ||
    stats.size > BigInt(maximumBytes) ||
    comparablePath(expectedPath) !== comparablePath(canonicalPath)
  ) {
    throw fail(
      "ROOT_UNSAFE",
      `${label} is not one bounded direct single-link regular file.`,
    );
  }
}

async function inspectDirectDirectory(
  path: string,
  label: string,
): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  assertDirectDirectory(path, canonical, before, label);
  assertDirectDirectory(path, canonical, after, label);
  if (!sameFileState(before, after)) {
    throw fail("PACK_CHANGED", `${label} changed during inspection.`);
  }
  return after;
}

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const rootBefore = await inspectDirectDirectory(
    root,
    "Implementation-pack root",
  );
  const directories: TreeEntrySnapshot[] = [];
  const files: TreeEntrySnapshot[] = [];
  const caseFoldedPaths = new Set<string>();
  let totalBytes = 0;
  let discoveredEntryCount = 0;

  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory =
      relativeDirectory === ""
        ? root
        : resolve(root, ...relativeDirectory.split("/"));
    assertPathWithinRoot(root, absoluteDirectory);
    const directoryBefore = await inspectDirectDirectory(
      absoluteDirectory,
      relativeDirectory === "" ? "Implementation-pack root" : relativeDirectory,
    );
    const names: string[] = [];
    const directoryHandle = await opendir(absoluteDirectory, {
      bufferSize: 16,
    });
    try {
      for (;;) {
        const entry = await directoryHandle.read();
        if (entry === null) break;
        discoveredEntryCount += 1;
        if (discoveredEntryCount > MAXIMUM_TREE_ENTRY_COUNT) {
          throw fail(
            "ROOT_UNSAFE",
            "Implementation-pack recursive entry count is excessive.",
          );
        }
        names.push(entry.name);
      }
    } finally {
      await directoryHandle.close();
    }
    names.sort(lexicalOrder);
    for (const name of names) {
      assertSafeSegment(name, `Implementation-pack entry ${name}`);
      const relativePath =
        relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      assertSafeRelativePath(
        relativePath,
        "Implementation-pack inventory path",
      );
      const folded = relativePath.toLowerCase();
      if (caseFoldedPaths.has(folded)) {
        throw fail(
          "ROOT_UNSAFE",
          "Implementation-pack root contains a case-fold path collision.",
        );
      }
      caseFoldedPaths.add(folded);
      const absolutePath = resolve(root, ...relativePath.split("/"));
      assertPathWithinRoot(root, absolutePath);
      const before = await lstat(absolutePath, { bigint: true });
      const canonical = await realpath(absolutePath);
      const after = await lstat(absolutePath, { bigint: true });
      if (!sameFileState(before, after)) {
        throw fail(
          "PACK_CHANGED",
          `Implementation-pack node ${relativePath} changed during inventory.`,
        );
      }
      if (before.dev !== rootBefore.dev) {
        throw fail(
          "ROOT_UNSAFE",
          `Implementation-pack node ${relativePath} crosses a filesystem or mounted-device boundary.`,
        );
      }
      if (before.isDirectory() && !before.isSymbolicLink()) {
        assertDirectDirectory(absolutePath, canonical, before, relativePath);
        directories.push({ relativePath, kind: "directory", stats: after });
        if (directories.length > MAXIMUM_DIRECTORY_COUNT) {
          throw fail(
            "ROOT_UNSAFE",
            "Implementation-pack directory count is excessive.",
          );
        }
        await visit(relativePath);
        continue;
      }
      assertDirectFile(
        absolutePath,
        canonical,
        before,
        Math.max(MAXIMUM_MANIFEST_BYTES, MAXIMUM_MEMBER_BYTES),
        relativePath,
      );
      files.push({ relativePath, kind: "file", stats: after });
      totalBytes += Number(after.size);
      if (
        files.length > MAXIMUM_MEMBER_COUNT + 1 ||
        totalBytes > MAXIMUM_TOTAL_MEMBER_BYTES + MAXIMUM_MANIFEST_BYTES
      ) {
        throw fail(
          "ROOT_UNSAFE",
          "Implementation-pack file inventory is excessive.",
        );
      }
    }
    const directoryAfter = await inspectDirectDirectory(
      absoluteDirectory,
      relativeDirectory === "" ? "Implementation-pack root" : relativeDirectory,
    );
    if (!sameFileState(directoryBefore, directoryAfter)) {
      throw fail(
        "PACK_CHANGED",
        `Implementation-pack directory ${relativeDirectory || "."} changed during inventory.`,
      );
    }
  };

  await visit("");
  const rootAfter = await inspectDirectDirectory(
    root,
    "Implementation-pack root",
  );
  if (!sameFileState(rootBefore, rootAfter)) {
    throw fail(
      "PACK_CHANGED",
      "Implementation-pack root changed during inventory.",
    );
  }
  return {
    rootStats: rootAfter,
    directories: directories.sort((left, right) =>
      lexicalOrder(left.relativePath, right.relativePath),
    ),
    files: files.sort((left, right) =>
      lexicalOrder(left.relativePath, right.relativePath),
    ),
  };
}

async function readExactly(
  handle: FileHandle,
  byteLength: number,
  relativePath: string,
  seam: __GrandHallT554NativeReviewImplementationVerificationSeam,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(byteLength);
  const trailingProbe = Buffer.alloc(1);
  try {
    let offset = 0;
    while (offset < byteLength) {
      const result = await handle.read(
        bytes,
        offset,
        byteLength - offset,
        offset,
      );
      if (result.bytesRead < 1) {
        throw fail(
          "PACK_CHANGED",
          "Implementation-pack file ended during exact read.",
        );
      }
      offset += result.bytesRead;
      await seam.afterReadChunk?.(relativePath, offset);
    }
    const trailing = await handle.read(trailingProbe, 0, 1, byteLength);
    if (trailing.bytesRead !== 0) {
      throw fail(
        "PACK_CHANGED",
        "Implementation-pack file has data beyond its captured length.",
      );
    }
    return bytes;
  } catch (error) {
    bytes.fill(0);
    if (seam.afterExceptionalReadBufferDestroyed !== undefined) {
      await seam.afterExceptionalReadBufferDestroyed({
        relativePath,
        bytesWereZeroed: bytes.every((byte) => byte === 0),
      });
    }
    throw error;
  } finally {
    trailingProbe.fill(0);
  }
}

async function readStableFile(
  root: string,
  relativePath: string,
  expectedSnapshot: TreeEntrySnapshot,
  maximumBytes: number,
  seam: __GrandHallT554NativeReviewImplementationVerificationSeam,
): Promise<StableFileRead> {
  const absolutePath = resolve(root, ...relativePath.split("/"));
  assertPathWithinRoot(root, absolutePath);
  let handle: FileHandle | undefined;
  let bytes: Buffer | undefined;
  try {
    const pathBefore = await lstat(absolutePath, { bigint: true });
    const canonicalBefore = await realpath(absolutePath);
    assertDirectFile(
      absolutePath,
      canonicalBefore,
      pathBefore,
      maximumBytes,
      relativePath,
    );
    if (!sameFileState(pathBefore, expectedSnapshot.stats)) {
      throw fail(
        "PACK_CHANGED",
        `${relativePath} changed after the initial inventory.`,
      );
    }
    handle = await open(absolutePath, "r");
    const descriptorBefore = await handle.stat({ bigint: true });
    assertDirectFile(
      absolutePath,
      canonicalBefore,
      descriptorBefore,
      maximumBytes,
      relativePath,
    );
    if (!sameFileState(pathBefore, descriptorBefore)) {
      throw fail(
        "PACK_CHANGED",
        `${relativePath} descriptor is not bound to the inventoried path.`,
      );
    }
    await seam.afterDescriptorOpened?.(relativePath);
    bytes = await readExactly(
      handle,
      Number(descriptorBefore.size),
      relativePath,
      seam,
    );
    await seam.afterExactRead?.(relativePath);
    const descriptorAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    const canonicalAfter = await realpath(absolutePath);
    assertDirectFile(
      absolutePath,
      canonicalAfter,
      descriptorAfter,
      maximumBytes,
      relativePath,
    );
    assertDirectFile(
      absolutePath,
      canonicalAfter,
      pathAfter,
      maximumBytes,
      relativePath,
    );
    if (
      !sameFileState(pathBefore, descriptorAfter) ||
      !sameFileState(pathBefore, pathAfter)
    ) {
      throw fail(
        "PACK_CHANGED",
        `${relativePath} changed during its descriptor-bound read.`,
      );
    }
    return { bytes, stats: pathAfter };
  } catch (error) {
    bytes?.fill(0);
    if (error instanceof GrandHallT554NativeReviewImplementationManifestError) {
      throw error;
    }
    throw fail(
      "PACK_CHANGED",
      `${relativePath} could not be read from one stable descriptor.`,
      error,
    );
  } finally {
    await handle?.close();
  }
}

function expectedDirectoryPaths(
  members: readonly __GrandHallT554NativeReviewExactImplementationMember[],
): readonly string[] {
  const paths = new Set<string>();
  for (const member of members) {
    const segments = member.relativePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join("/"));
    }
  }
  return [...paths].sort(lexicalOrder);
}

function assertExactInventory(
  snapshot: TreeSnapshot,
  manifestFilename: string,
  members: readonly __GrandHallT554NativeReviewExactImplementationMember[],
): void {
  const expectedFiles = [
    manifestFilename,
    ...members.map((member) => member.relativePath),
  ].sort(lexicalOrder);
  const actualFiles = snapshot.files.map((entry) => entry.relativePath);
  const expectedDirectories = expectedDirectoryPaths(members);
  const actualDirectories = snapshot.directories.map(
    (entry) => entry.relativePath,
  );
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index]) ||
    actualDirectories.length !== expectedDirectories.length ||
    actualDirectories.some((path, index) => path !== expectedDirectories[index])
  ) {
    throw fail(
      "INVENTORY_MISMATCH",
      "Implementation-pack root does not contain the exact manifest-derived recursive inventory.",
    );
  }
}

function assertSnapshotsEqual(
  initial: TreeSnapshot,
  final: TreeSnapshot,
): void {
  const equalEntries = (
    left: readonly TreeEntrySnapshot[],
    right: readonly TreeEntrySnapshot[],
  ): boolean =>
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        entry.relativePath === other.relativePath &&
        entry.kind === other.kind &&
        sameFileState(entry.stats, other.stats)
      );
    });
  if (
    !sameFileState(initial.rootStats, final.rootStats) ||
    !equalEntries(initial.directories, final.directories) ||
    !equalEntries(initial.files, final.files)
  ) {
    throw fail(
      "PACK_CHANGED",
      "Implementation-pack root changed during verification.",
    );
  }
}

function requiredSnapshotFile(
  snapshot: TreeSnapshot,
  relativePath: string,
): TreeEntrySnapshot {
  const entry = snapshot.files.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (entry === undefined) {
    throw fail(
      "INVENTORY_MISMATCH",
      `Implementation-pack root omitted ${relativePath}.`,
    );
  }
  return entry;
}

function parseReviewedAnchor(
  value: __GrandHallT554NativeReviewImplementationReviewedAnchor,
): __GrandHallT554NativeReviewImplementationReviewedAnchor {
  if (!isRecord(value)) {
    throw fail(
      "ARGUMENT_INVALID",
      "Reviewed implementation anchor must be one object.",
    );
  }
  const anchor = requireRecord(
    value,
    ["manifestFileByteLength", "manifestFileSha256", "manifestSemanticSha256"],
    "Reviewed implementation anchor",
  );
  try {
    return {
      manifestSemanticSha256: requireSha256(
        anchor.manifestSemanticSha256,
        "Reviewed manifest semantic SHA-256",
      ),
      manifestFileSha256: requireSha256(
        anchor.manifestFileSha256,
        "Reviewed manifest file SHA-256",
      ),
      manifestFileByteLength: requireBoundedInteger(
        anchor.manifestFileByteLength,
        1,
        MAXIMUM_MANIFEST_BYTES,
        "Reviewed manifest file byte length",
      ),
    };
  } catch (error) {
    if (
      error instanceof GrandHallT554NativeReviewImplementationManifestError &&
      error.code === "MANIFEST_INVALID"
    ) {
      throw fail("ARGUMENT_INVALID", error.message, error);
    }
    throw error;
  }
}

function assertMemberContentPolicy(
  member: GrandHallT554NativeReviewImplementationMemberV1,
  bytes: Buffer,
  decoder: GrandHallT554NativeReviewImplementationDecoderClosureV1,
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
      `${stableCanonicalJson(CanonicalJsonValueSchema.parse(decoder))}\n`,
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
  if (member.kind !== "module-metadata") return;
  try {
    const parsed = parseGrandHallT554StrictJson(bytes);
    const canonical = Buffer.from(
      `${stableCanonicalJson(CanonicalJsonValueSchema.parse(parsed))}\n`,
      "utf8",
    );
    if (!canonical.equals(bytes) || !isRecord(parsed)) {
      throw new Error("Module metadata is not canonical JSON plus LF.");
    }
    const keys = Object.keys(parsed).sort(lexicalOrder);
    const expectedKeys = ["name", "private", "type", "version"];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index]) ||
      parsed.name !==
        "@venviewer/grand-hall-t554-native-review-implementation-pack" ||
      parsed.private !== true ||
      parsed.type !== "module" ||
      parsed.version !== "1.0.0"
    ) {
      throw new Error(
        "Module metadata does not enforce the isolated ESM pack.",
      );
    }
  } catch (error) {
    throw fail(
      "MEMBER_INVALID",
      "Implementation module metadata does not enforce the exact private compiled ESM execution mode.",
      error,
    );
  }
}

/**
 * Internal reusable byte verifier for a closed implementation pack. It grants
 * no candidate, production, runtime, or root-bound authority: callers must
 * apply their own module-private branding only after interpreting these facts.
 */
export async function __internalVerifyGrandHallT554NativeReviewExactImplementationPack<
  TMember extends __GrandHallT554NativeReviewExactImplementationMember,
  TManifest extends
    __GrandHallT554NativeReviewExactImplementationManifest<TMember>,
>(
  input: __GrandHallT554NativeReviewExactPackVerificationInput<
    TMember,
    TManifest
  >,
): Promise<__GrandHallT554NativeReviewExactPackVerificationFacts<TManifest>> {
  const root = requireAbsoluteLocalRoot(input.implementationPackRoot);
  const anchor = parseReviewedAnchor(input.reviewedAnchor);
  const seam = input.seam ?? {};
  assertSafeSegment(input.manifestFilename, "Implementation manifest filename");
  let manifestBytes: Buffer | undefined;
  try {
    const initial = await snapshotTree(root);
    await seam.afterInitialInventory?.();
    const manifestRead = await readStableFile(
      root,
      input.manifestFilename,
      requiredSnapshotFile(initial, input.manifestFilename),
      MAXIMUM_MANIFEST_BYTES,
      seam,
    );
    manifestBytes = manifestRead.bytes;
    const manifestFileSha256 = sha256(manifestBytes);
    const manifest = input.parseCanonicalManifestBytes(manifestBytes);
    assertExactVerificationMembers(manifest);
    if (
      manifest.semanticSha256 !== anchor.manifestSemanticSha256 ||
      manifestFileSha256 !== anchor.manifestFileSha256 ||
      manifestBytes.length !== anchor.manifestFileByteLength
    ) {
      throw fail(
        "REVIEWED_ANCHOR_MISMATCH",
        "Implementation manifest does not match its caller-supplied candidate semantic and raw-byte anchors.",
      );
    }
    input.assertRuntime(manifest);
    assertExactInventory(initial, input.manifestFilename, manifest.members);
    for (const member of manifest.members) {
      const read = await readStableFile(
        root,
        member.relativePath,
        requiredSnapshotFile(initial, member.relativePath),
        MAXIMUM_MEMBER_BYTES,
        seam,
      );
      try {
        if (
          read.bytes.length !== member.byteLength ||
          sha256(read.bytes) !== member.sha256
        ) {
          throw fail(
            "MEMBER_INVALID",
            `Implementation member ${member.relativePath} does not match its manifest hash and length.`,
          );
        }
        input.assertMemberContentPolicy(member, read.bytes, manifest);
      } finally {
        read.bytes.fill(0);
      }
    }
    await seam.afterMemberReads?.();
    const final = await snapshotTree(root);
    assertExactInventory(final, input.manifestFilename, manifest.members);
    assertSnapshotsEqual(initial, final);
    const clonedManifest = structuredClone(manifest);
    const memberInventorySha256 = input.computeMemberInventorySha256(
      manifest.members,
    );
    const retainedManifestBytes = Buffer.from(manifestBytes);
    try {
      return deepFreeze({
        manifest: clonedManifest,
        manifestBinding: {
          semanticSha256: manifest.semanticSha256,
          fileSha256: manifestFileSha256,
          byteLength: manifestBytes.length,
        },
        memberInventorySha256,
        memberCount: manifest.memberCount,
        totalMemberBytes: manifest.totalMemberBytes,
        copyExactManifestBytes: () => Buffer.from(retainedManifestBytes),
      });
    } catch (error) {
      retainedManifestBytes.fill(0);
      throw error;
    }
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewImplementationManifestError) {
      throw error;
    }
    throw fail(
      "ROOT_UNSAFE",
      "The caller-anchored implementation-pack candidate could not be verified safely.",
      error,
    );
  } finally {
    manifestBytes?.fill(0);
  }
}

async function verifyImplementationPackCandidateWithObservations(
  input: __GrandHallT554NativeReviewImplementationVerificationInput,
): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1> {
  const root = requireAbsoluteLocalRoot(input.implementationPackRoot);
  const exact =
    await __internalVerifyGrandHallT554NativeReviewExactImplementationPack({
      implementationPackRoot: root,
      reviewedAnchor: input.reviewedAnchor,
      manifestFilename:
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
      parseCanonicalManifestBytes,
      assertRuntime: (manifest) => {
        assertRuntimeIdentity(
          manifest,
          input.runtimeIdentity ?? currentRuntimeIdentity(),
        );
        assertBootstrapExecutionIdentity(
          input.bootstrapExecutionIdentity ??
            currentBootstrapExecutionIdentity(),
        );
      },
      assertMemberContentPolicy: (member, bytes, manifest) => {
        assertMemberContentPolicy(member, bytes, manifest.decoder);
      },
      computeMemberInventorySha256,
      seam: input.seam,
    });
  const verifiedCandidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1 = {
    schemaVersion:
      "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v1",
    manifest: exact.manifest,
    manifestBinding: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
      implementationId: IMPLEMENTATION_ID,
      ...exact.manifestBinding,
    },
    memberInventorySha256: exact.memberInventorySha256,
    memberCount: exact.memberCount,
    totalMemberBytes: exact.totalMemberBytes,
    copyExactManifestBytes: exact.copyExactManifestBytes,
    concreteBytesVerified: true,
    runtimeIdentityVerified: true,
    reviewedDecoderClosureBytesVerified: true,
    decoderDependencyGraphVerified: false,
    decoderRuntimeLoaded: false,
    safeEntrypointImportAvailable: false,
    platformAliasAuditComplete: false,
    releaseReady: false,
    executionPolicyManifestVerified: true,
    exactRootInventoryVerified: true,
    authority: "none",
    productionFactoryAvailable: false,
  };
  const frozenCandidate = deepFreeze(verifiedCandidate);
  VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_IDENTITIES.add(frozenCandidate);
  VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_ROOTS.set(
    frozenCandidate,
    comparablePath(root),
  );
  return frozenCandidate;
}

function verifyCallerAnchoredImplementationPackCandidate(
  input: __GrandHallT554NativeReviewImplementationVerificationInput,
): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1> {
  return verifyImplementationPackCandidateWithObservations(input);
}

/**
 * Fully verifies one caller-anchored pack without granting production
 * admission. Runtime identity and bootstrap facts are observed in this process
 * and cannot be supplied by the caller.
 */
export function verifyGrandHallT554NativeReviewImplementationPackCandidateV1(input: {
  readonly implementationPackRoot: string;
  readonly reviewedAnchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
}): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1> {
  return verifyImplementationPackCandidateWithObservations({
    implementationPackRoot: input.implementationPackRoot,
    reviewedAnchor: input.reviewedAnchor,
    runtimeIdentity: currentRuntimeIdentity(),
    bootstrapExecutionIdentity: currentBootstrapExecutionIdentity(),
    seam: {},
  });
}

/**
 * Re-reads every byte of an already branded same-root candidate without
 * admitting a new caller-selected runtime fact or returning another authority
 * handle. This is the parent-side custody check around isolated attestation.
 */
export async function reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV1(input: {
  readonly implementationPackRoot: string;
  readonly candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1;
}): Promise<void> {
  assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
    input.candidate,
    input.implementationPackRoot,
  );
  const reverified =
    await verifyImplementationPackCandidateWithObservations({
      implementationPackRoot: input.implementationPackRoot,
      reviewedAnchor: {
        manifestSemanticSha256:
          input.candidate.manifestBinding.semanticSha256,
        manifestFileSha256: input.candidate.manifestBinding.fileSha256,
        manifestFileByteLength: input.candidate.manifestBinding.byteLength,
      },
      runtimeIdentity: input.candidate.manifest.runtime,
      bootstrapExecutionIdentity: {
        compiledJavascriptModule: true,
        execArgv: [],
        nodeOptions: null,
        nodePath: null,
      },
      seam: {},
    });
  if (
    reverified.manifestBinding.semanticSha256 !==
      input.candidate.manifestBinding.semanticSha256 ||
    reverified.manifestBinding.fileSha256 !==
      input.candidate.manifestBinding.fileSha256 ||
    reverified.manifestBinding.byteLength !==
      input.candidate.manifestBinding.byteLength ||
    reverified.memberInventorySha256 !==
      input.candidate.memberInventorySha256 ||
    reverified.memberCount !== input.candidate.memberCount ||
    reverified.totalMemberBytes !== input.candidate.totalMemberBytes
  ) {
    throw fail(
      "UNVERIFIED_HANDLE",
      "Implementation-pack byte re-verification produced a different candidate binding.",
    );
  }
}

/*
 * Intentionally absent until a separately reviewed compiled pack exists. Keeping
 * this lookup private prevents a browser, CLI argument, or production caller from
 * choosing a root or replacing the reviewed anchor.
 */
function fixedProductionReviewedPack(): FixedReviewedImplementationPack | null {
  return null;
}

/**
 * Verifies only the module-private reviewed implementation pack. There is no
 * production pack or factory in this slice, so the public surface fails closed.
 */
export async function verifyGrandHallT554NativeReviewImplementationPack(): Promise<GrandHallT554VerifiedNativeReviewImplementationPackV1> {
  const fixed = fixedProductionReviewedPack();
  if (fixed === null) {
    throw fail(
      "REVIEWED_PACK_NOT_CONFIGURED",
      "No compiled Grand Hall native-review implementation pack has been reviewed and fixed in production.",
    );
  }
  const candidate = await verifyImplementationPackCandidateWithObservations({
    implementationPackRoot: fixed.implementationPackRoot,
    reviewedAnchor: fixed.reviewedAnchor,
    runtimeIdentity: currentRuntimeIdentity(),
    bootstrapExecutionIdentity: currentBootstrapExecutionIdentity(),
    seam: {},
  });
  const verifiedPack: GrandHallT554VerifiedNativeReviewImplementationPackV1 = {
    ...candidate,
    schemaVersion:
      "venviewer.grand-hall-t554-verified-native-review-implementation-pack.v1",
  };
  const frozenVerifiedPack = deepFreeze(verifiedPack);
  VERIFIED_IMPLEMENTATION_PACK_IDENTITIES.add(frozenVerifiedPack);
  return frozenVerifiedPack;
}

export const __testOnlyGrandHallT554NativeReviewImplementationManifest =
  /* @__PURE__ */ Object.freeze({
    verifyCallerAnchoredImplementationPackCandidate,
    currentRuntimeIdentity,
    currentBootstrapExecutionIdentity,
    computeManifestSemanticSha256,
    computeMemberInventorySha256,
    constants: /* @__PURE__ */ Object.freeze({
      implementationId: IMPLEMENTATION_ID,
      maximumManifestBytes: MAXIMUM_MANIFEST_BYTES,
      maximumMemberCount: MAXIMUM_MEMBER_COUNT,
      maximumMemberBytes: MAXIMUM_MEMBER_BYTES,
      maximumTotalMemberBytes: MAXIMUM_TOTAL_MEMBER_BYTES,
    }),
  });

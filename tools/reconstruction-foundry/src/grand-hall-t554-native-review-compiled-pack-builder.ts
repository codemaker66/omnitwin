import { createHash } from "node:crypto";
import {
  constants as fileSystemConstants,
  type BigIntStats,
} from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { builtinModules } from "node:module";
import { pathToFileURL } from "node:url";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER,
  __testOnlyGrandHallT554NativeReviewImplementationManifest,
  type __GrandHallT554NativeReviewImplementationReviewedAnchor,
  type GrandHallT554ImplementationSha256,
  type GrandHallT554NativeReviewImplementationDecoderClosureV1,
  type GrandHallT554NativeReviewImplementationManifestV1,
  type GrandHallT554NativeReviewImplementationMemberV1,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
  __testOnlyGrandHallT554NativeReviewImplementationManifestV2,
  type GrandHallT554NativeReviewImplementationDecoderClosureV2,
  type GrandHallT554NativeReviewImplementationManifestV2,
  type GrandHallT554NativeReviewImplementationMemberV2,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2,
} from "./grand-hall-t554-native-review-implementation-manifest-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2,
} from "./grand-hall-t554-native-review-assets-v2.js";
import {
  attestGrandHallT554NativeReviewRuntimeCandidateV1,
  GrandHallT554NativeReviewRuntimeAttestationError,
  type GrandHallT554NativeReviewRuntimeAttestationCandidateV1,
} from "./grand-hall-t554-native-review-runtime-attestation.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V1 =
  "venviewer.grand-hall-t554-native-review-compiled-pack-builder.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2 =
  "venviewer.grand-hall-t554-native-review-compiled-pack-builder.v2";

const SHARP_VERSION = "0.35.3";
const COLOUR_VERSION = "1.1.0";
const ZOD_VERSION = "3.24.2";
const LIBVIPS_VERSION = "8.18.3";
const ESBUILD_VERSION = "0.25.0";
const CORE_ENTRY_RELATIVE_PATH =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-compiled-core-entry.ts";
const HTTP_ADAPTER_ENTRY_RELATIVE_PATH =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-http-response-adapter.ts";
const RUNTIME_ATTESTOR_ENTRY_RELATIVE_PATH =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-runtime-attestor-entry.ts";
const RUNTIME_BOOTSTRAP_ENTRY_RELATIVE_PATH =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-runtime-bootstrap.ts";
const RUNTIME_INSPECTOR_SOURCE_RELATIVE_PATH =
  "tools/reconstruction-foundry/native/grand-hall-t554-runtime-inspector/grand_hall_t554_runtime_inspector.node";
const PAYLOAD_GATE_ENTRY_RELATIVE_PATH_V2 =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-payload-gate-v2.ts";
const PAYLOAD_CORE_ENTRY_RELATIVE_PATH_V2 =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-payload-core-v2.ts";
const HTTP_ADAPTER_ENTRY_RELATIVE_PATH_V2 =
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-http-response-adapter-v2.ts";
const SERVER_BUNDLE_MEMBER = "server/native-review-server-bundle.js";
const HTTP_ADAPTER_MEMBER = "server/review-http-adapter.js";
const SHARP_LOADER_MEMBER = "vendor/sharp/loader.js";
const SHARP_NATIVE_ADDON_MEMBER =
  "vendor/sharp/sharp-win32-x64-0.35.3.node";
const LIBVIPS_DLL_MEMBER = "vendor/libvips/libvips-42.dll";
const LIBVIPS_CPP_DLL_MEMBER = "vendor/libvips/libvips-cpp-8.18.3.dll";
const RUNTIME_PROBE_SHA256 =
  "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078";
const SHARP_LOADER_IMPORT_FROM_SERVER = "../vendor/sharp/loader.js";
const FIXED_ADMISSION_ABI_SOURCE_IMPORT_V2 =
  "./grand-hall-t554-native-review-fixed-admission-abi-v2.js";
const LEGACY_IMPLEMENTATION_MANIFEST_SOURCE_IMPORT =
  "./grand-hall-t554-native-review-implementation-manifest.js";
const ZOD_ENTRY_RELATIVE_PATH_V2 =
  "tools/reconstruction-foundry/node_modules/zod/lib/index.mjs";
const CORE_REAL_INPUT_RELATIVE_PATHS_V2 = Object.freeze([
  "packages/reconstruction-foundry/src/canonical-json.ts",
  "packages/reconstruction-foundry/src/errors.ts",
  "packages/reconstruction-foundry/src/hash.ts",
  "packages/types/src/artifact-manifest.ts",
  "packages/types/src/artifact-type.ts",
  "packages/types/src/canonical-layout-snapshot.ts",
  "packages/types/src/configuration.ts",
  "packages/types/src/coordinate-frame.ts",
  "packages/types/src/exposure-metadata.ts",
  "packages/types/src/furniture.ts",
  "packages/types/src/grand-hall-room-scope-artifacts-v2.ts",
  "packages/types/src/grand-hall-room-scope-artifacts-v3.ts",
  "packages/types/src/grand-hall-room-scope-artifacts.ts",
  "packages/types/src/layout-proof-object.ts",
  "packages/types/src/omnitwin-foundry-grand-hall-room-membership.ts",
  "packages/types/src/runtime-venue-manifest.ts",
  "packages/types/src/space.ts",
  "packages/types/src/user.ts",
  "packages/types/src/venue.ts",
  ZOD_ENTRY_RELATIVE_PATH_V2,
  "tools/reconstruction-foundry/src/grand-hall-pilot-inspection.ts",
  "tools/reconstruction-foundry/src/grand-hall-room9-boundary.ts",
  "tools/reconstruction-foundry/src/grand-hall-room9-source-receipt.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-boundary-review.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-cleanup-marker-evidence.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-interface-atlas.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-media-validation.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-mask-spatial-digest-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-media-kernel.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-coordinator-replay-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-coverage.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-durable-journal-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-durable-source-history-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-events-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-http-contract-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-journal.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-replay-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-store.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-workflow-session-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-operator-session-v2.ts",
  PAYLOAD_CORE_ENTRY_RELATIVE_PATH_V2,
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-production-authority-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-registry.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-replay-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-router-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-orchestration-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-owner-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-store-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-kernel-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-session-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-native-source-epoch.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-panorama-review.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-path-safety.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v2.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3-contract.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3-files.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-review-pack.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-strict-json.ts",
  "tools/reconstruction-foundry/src/grand-hall-t554-svg-safety.ts",
  "tools/reconstruction-foundry/src/grand-hall-t561-panorama-visual-observation.ts",
  "tools/reconstruction-foundry/src/local-session-http.ts",
]);
const CORE_VIRTUAL_INPUTS_V2 = Object.freeze([
  "t554-v2-fixed-admission-abi-proxy:fixed-admission-abi-proxy.js",
  "t554-v2-foundry-utc-instant-bridge:foundry-utc-instant-bridge.js",
  "t554-v2-reviewed-foundry-bridge:reviewed-foundry-bridge.js",
  "t554-v2-reviewed-types-bridge:reviewed-types-bridge.js",
  "t554-v2-sharp-proxy:sharp-proxy.js",
  "t554-v2-unavailable-legacy-implementation-manifest:legacy-implementation-manifest.js",
]);
const SHARP_DIST_INPUT_FILENAMES_V2 = Object.freeze([
  "channel.mjs",
  "colour.mjs",
  "composite.mjs",
  "constructor.mjs",
  "index.mjs",
  "input.mjs",
  "is.mjs",
  "operation.mjs",
  "output.mjs",
  "resize.mjs",
  "utility.mjs",
]);
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
);

const MODULE_METADATA = Object.freeze({
  name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
  private: true,
  type: "module",
  version: "1.0.0",
});

const MODULE_METADATA_V2 = Object.freeze({
  name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
  private: true,
  type: "module",
  version: "2.0.0",
});

const STATIC_INDEX_HTML = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>Grand Hall native review core</title>
    <link rel="stylesheet" href="./review.css">
  </head>
  <body>
    <main aria-labelledby="review-title">
      <p class="eyebrow">Venviewer · Trades Hall Glasgow</p>
      <h1 id="review-title">Grand Hall native review core</h1>
      <p id="review-status" role="status">Loading sealed local-review status…</p>
      <p class="boundary">Authority: none. Human acceptance, reconstruction, export, runtime admission, generated content, and browser-controlled truth remain disabled.</p>
    </main>
    <script type="module" src="./review.js"></script>
  </body>
</html>
`;

const STATIC_REVIEW_CSS = `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #080b0d;
  color: #f3ead8;
}
* { box-sizing: border-box; }
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 0%, #20201b 0%, #0d1012 45%, #080b0d 100%);
}
main {
  width: min(42rem, calc(100vw - 2rem));
  padding: 2.25rem;
  border: 1px solid #5c4a2d;
  border-radius: 0.75rem;
  background: rgba(13, 16, 18, 0.96);
  box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.45);
}
.eyebrow {
  margin: 0 0 0.75rem;
  color: #cfaa68;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.35rem); line-height: 1.08; }
#review-status { margin: 1.25rem 0 0; color: #b8d9c1; }
.boundary { margin: 1.25rem 0 0; color: #bcb7ad; line-height: 1.6; }
`;

const STATIC_REVIEW_JS = `const status = document.getElementById("review-status");
if (!(status instanceof HTMLElement)) {
  throw new Error("The sealed local-review status element is missing.");
}
const policy = Object.freeze({
  authority: "none",
  acceptanceAuthorized: false,
  browserControlledTruthAuthorized: false,
  generatedContentAuthorized: false,
  httpLaunchIncluded: false
});
status.textContent = "Compiled local-review assets are present; a verified server launcher is deliberately not included.";
Object.defineProperty(globalThis, "__VENVIEWER_T554_REVIEW_POLICY__", {
  configurable: false,
  enumerable: false,
  value: policy,
  writable: false
});
`;

interface EsbuildResolveArgs {
  readonly path: string;
  readonly importer: string;
  readonly namespace: string;
  readonly resolveDir: string;
}

interface EsbuildLoadArgs {
  readonly path: string;
  readonly namespace: string;
}

interface EsbuildResolveResult {
  readonly path: string;
  readonly namespace?: string;
  readonly external?: boolean;
}

interface EsbuildLoadResult {
  readonly contents: string;
  readonly loader: "js" | "ts";
  readonly resolveDir?: string;
}

interface EsbuildPluginBuild {
  onResolve(
    options: { readonly filter: RegExp },
    callback: (
      args: EsbuildResolveArgs,
    ) => EsbuildResolveResult | null | Promise<EsbuildResolveResult | null>,
  ): void;
  onLoad(
    options: { readonly filter: RegExp; readonly namespace?: string },
    callback: (
      args: EsbuildLoadArgs,
    ) => EsbuildLoadResult | null | Promise<EsbuildLoadResult | null>,
  ): void;
}

interface EsbuildPlugin {
  readonly name: string;
  setup(build: EsbuildPluginBuild): void;
}

interface EsbuildMetafileImport {
  readonly path: string;
  readonly kind: string;
  readonly external?: boolean;
}

export interface GrandHallT554NativeReviewCompiledModuleImportV2 {
  readonly path: string;
  readonly kind: string;
  readonly external: boolean;
}

interface EsbuildMetafileOutput {
  readonly bytes: number;
  readonly exports: readonly string[];
  readonly imports: readonly EsbuildMetafileImport[];
}

interface EsbuildMetafile {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, EsbuildMetafileOutput>>;
}

interface EsbuildBuildResult {
  readonly metafile?: EsbuildMetafile;
}

interface EsbuildBuildOptions {
  readonly absWorkingDir: string;
  readonly bundle: true;
  readonly charset: "utf8";
  readonly conditions: readonly string[];
  readonly entryPoints: readonly string[];
  readonly format: "esm";
  readonly legalComments: "none";
  readonly logLevel: "silent";
  readonly metafile: true;
  readonly minifyIdentifiers: boolean;
  readonly minifySyntax: true;
  readonly minifyWhitespace: true;
  readonly outfile: string;
  readonly platform: "node";
  readonly plugins?: readonly EsbuildPlugin[];
  readonly sourcemap: false;
  readonly target: readonly string[];
  readonly treeShaking: true;
  readonly write: true;
  readonly banner?: { readonly js: string };
}

interface EsbuildApi {
  readonly version: string;
  build(options: EsbuildBuildOptions): Promise<EsbuildBuildResult>;
}

export interface GrandHallT554NativeReviewCompiledPackBuildResultV1 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V1;
  readonly packRoot: string;
  readonly manifestPath: string;
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV1;
  readonly reviewedAnchorCandidate: __GrandHallT554NativeReviewImplementationReviewedAnchor;
  readonly verifiedCandidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1;
  readonly runtimeAttestationCandidate:
    | GrandHallT554NativeReviewRuntimeAttestationCandidateV1
    | null;
  readonly runtimeAttestationStatus:
    | "attested-candidate"
    | "runtime-inspector-not-reviewed";
  readonly coreExternalImports: readonly string[];
  readonly httpAdapterExternalImports: readonly string[];
  readonly runtimeAttestorExternalImports: readonly string[];
  readonly runtimeBootstrapExternalImports: readonly string[];
  readonly sharpLoaderExternalImports: readonly string[];
}

export interface GrandHallT554NativeReviewCompiledPackBuildResultV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2;
  readonly packRoot: string;
  readonly manifestPath: string;
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV2;
  readonly reviewedAnchorCandidate: __GrandHallT554NativeReviewImplementationReviewedAnchor;
  readonly verifiedCandidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2;
  readonly gateExternalImports: readonly string[];
  readonly coreExternalImports: readonly string[];
  readonly httpAdapterExternalImports: readonly string[];
  readonly runtimeBootstrapExternalImports: readonly string[];
  readonly sharpLoaderExternalImports: readonly string[];
  readonly gateOutputImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly coreOutputImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly httpAdapterOutputImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly runtimeBootstrapOutputImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly sharpLoaderOutputImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly gateExports: readonly string[];
  readonly coreExports: readonly string[];
  readonly httpAdapterExports: readonly string[];
  readonly runtimeBootstrapExports: readonly string[];
  readonly sharpLoaderExports: readonly string[];
}

export interface __GrandHallT554NativeReviewCompiledPackBuildSeamV1 {
  readonly afterStagingRootCreated?: (stagingRoot: string) => Promise<void> | void;
  readonly beforeAtomicPublish?: (facts: {
    readonly stagingRoot: string;
    readonly outputRoot: string;
  }) => Promise<void> | void;
}

export interface __GrandHallT554NativeReviewCompiledPackBuildSeamV2
  extends __GrandHallT554NativeReviewCompiledPackBuildSeamV1 {
  readonly afterAtomicPublish?: (facts: {
    readonly outputRoot: string;
  }) => Promise<void> | void;
}

export class GrandHallT554NativeReviewCompiledPackBuilderError extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "BUILD_TOOL_INVALID"
      | "BUILD_FAILED"
      | "CLEANUP_INCOMPLETE"
      | "DEPENDENCY_CLOSURE_INVALID"
      | "OUTPUT_EXISTS"
      | "OUTPUT_INVALID"
      | "PLATFORM_UNSUPPORTED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewCompiledPackBuilderError";
  }
}

function fail(
  code: GrandHallT554NativeReviewCompiledPackBuilderError["code"],
  message: string,
  cause?: unknown,
): GrandHallT554NativeReviewCompiledPackBuilderError {
  return new GrandHallT554NativeReviewCompiledPackBuilderError(
    code,
    message,
    cause,
  );
}

function sha256(bytes: Buffer): GrandHallT554ImplementationSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireAbsoluteLocalPath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\")
  ) {
    throw fail("ARGUMENT_INVALID", `${label} must be an absolute local path.`);
  }
  return resolve(value);
}

async function requireDirectRegularFile(path: string, label: string): Promise<void> {
  const stats = await lstat(path, { bigint: true }).catch((error: unknown) => {
    throw fail("DEPENDENCY_CLOSURE_INVALID", `${label} is missing.`, error);
  });
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} must be one direct regular file.`,
    );
  }
}

interface DirectoryWitness {
  readonly canonicalPath: string;
  readonly stats: BigIntStats;
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function captureDirectDirectory(
  path: string,
  label: string,
  errorCode: GrandHallT554NativeReviewCompiledPackBuilderError["code"] =
    "OUTPUT_INVALID",
): Promise<DirectoryWitness> {
  const stats = await lstat(path, { bigint: true }).catch((error: unknown) => {
    throw fail(errorCode, `${label} is unavailable.`, error);
  });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw fail(errorCode, `${label} must be one direct local directory.`);
  }
  const canonicalPath = await realpath(path).catch((error: unknown) => {
    throw fail(errorCode, `${label} cannot be canonicalised.`, error);
  });
  if (comparablePath(canonicalPath) !== comparablePath(path)) {
    throw fail(
      errorCode,
      `${label} must not traverse a symlink, junction, or path alias.`,
    );
  }
  return { canonicalPath, stats };
}

async function assertDirectoryWitness(
  path: string,
  witness: DirectoryWitness,
  label: string,
): Promise<void> {
  const current = await captureDirectDirectory(path, label);
  if (
    comparablePath(current.canonicalPath) !== comparablePath(path) ||
    !sameNode(current.stats, witness.stats)
  ) {
    throw fail(
      "OUTPUT_INVALID",
      `${label} changed identity during the implementation-pack build.`,
    );
  }
}

async function requirePathAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
    throw fail("OUTPUT_EXISTS", `${label} already exists and will not be replaced.`);
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewCompiledPackBuilderError) {
      throw error;
    }
    if (
      error === null ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw fail("OUTPUT_INVALID", `${label} cannot be inspected safely.`, error);
    }
  }
}

async function cleanupOwnedDirectory(
  path: string,
  witness: DirectoryWitness,
): Promise<boolean> {
  try {
    await assertDirectoryWitness(path, witness, "Owned staging root");
  } catch {
    return false;
  }
  await rm(path, { force: true, recursive: true });
  return true;
}

async function uniquePnpmPackageDirectory(
  workspaceRoot: string,
  exactName: string,
  prefixName: string,
): Promise<string> {
  const pnpmRoot = resolve(workspaceRoot, "node_modules", ".pnpm");
  const entries = await readdir(pnpmRoot, { withFileTypes: true }).catch(
    (error: unknown) => {
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        "The installed pnpm package store is unavailable.",
        error,
      );
    },
  );
  const candidates = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name === exactName || entry.name.startsWith(prefixName)),
    )
    .map((entry) => resolve(pnpmRoot, entry.name));
  if (candidates.length !== 1) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `Expected exactly one installed ${exactName} package directory; found ${String(candidates.length)}.`,
    );
  }
  const candidate = candidates[0];
  if (candidate === undefined) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `The installed ${exactName} package directory disappeared.`,
    );
  }
  return candidate;
}

async function loadEsbuild(workspaceRoot: string): Promise<EsbuildApi> {
  const packageDirectory = await uniquePnpmPackageDirectory(
    workspaceRoot,
    `esbuild@${ESBUILD_VERSION}`,
    `esbuild@${ESBUILD_VERSION}_`,
  );
  const modulePath = resolve(
    packageDirectory,
    "node_modules",
    "esbuild",
    "lib",
    "main.js",
  );
  await requireDirectRegularFile(modulePath, "esbuild API module");
  const loaded = (await import(pathToFileURL(modulePath).href)) as unknown;
  if (
    loaded === null ||
    typeof loaded !== "object" ||
    !("version" in loaded) ||
    loaded.version !== ESBUILD_VERSION ||
    !("build" in loaded) ||
    typeof loaded.build !== "function"
  ) {
    throw fail(
      "BUILD_TOOL_INVALID",
      `The installed esbuild API is not exactly ${ESBUILD_VERSION}.`,
    );
  }
  return loaded as EsbuildApi;
}

async function installedSharpClosure(workspaceRoot: string): Promise<{
  readonly sharpRoot: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly nativeAddon: string;
  readonly libvipsDll: string;
  readonly libvipsCppDll: string;
}> {
  const sharpPackageDirectory = await uniquePnpmPackageDirectory(
    workspaceRoot,
    `sharp@${SHARP_VERSION}`,
    `sharp@${SHARP_VERSION}_`,
  );
  const platformPackageDirectory = await uniquePnpmPackageDirectory(
    workspaceRoot,
    `@img+sharp-win32-x64@${SHARP_VERSION}`,
    `@img+sharp-win32-x64@${SHARP_VERSION}_`,
  );
  const sharpRoot = await realpath(
    resolve(sharpPackageDirectory, "node_modules", "sharp"),
  );
  const platformRoot = await realpath(
    resolve(
      platformPackageDirectory,
      "node_modules",
      "@img",
      "sharp-win32-x64",
    ),
  );
  const packageJsonBytes = await readFile(resolve(sharpRoot, "package.json"));
  const packageJson = parseGrandHallT554StrictJson(packageJsonBytes);
  if (!isRecord(packageJson) || packageJson.version !== SHARP_VERSION) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `The installed Sharp package is not exactly ${SHARP_VERSION}.`,
    );
  }
  const versionsValue = parseGrandHallT554StrictJson(
    await readFile(resolve(platformRoot, "versions.json")),
  );
  if (
    !isRecord(versionsValue) ||
    Object.values(versionsValue).some((value) => typeof value !== "string") ||
    versionsValue.vips !== LIBVIPS_VERSION
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `The installed libvips closure is not exactly ${LIBVIPS_VERSION}.`,
    );
  }
  const versions = Object.freeze({
    ...(versionsValue as Record<string, string>),
    sharp: SHARP_VERSION,
  });
  const nativeAddon = resolve(
    platformRoot,
    "lib",
    `sharp-win32-x64-${SHARP_VERSION}.node`,
  );
  const libvipsDll = resolve(platformRoot, "lib", "libvips-42.dll");
  const libvipsCppDll = resolve(
    platformRoot,
    "lib",
    `libvips-cpp-${LIBVIPS_VERSION}.dll`,
  );
  await Promise.all([
    requireDirectRegularFile(nativeAddon, "Sharp native addon"),
    requireDirectRegularFile(libvipsDll, "libvips runtime DLL"),
    requireDirectRegularFile(libvipsCppDll, "libvips C++ runtime DLL"),
  ]);
  return { sharpRoot, versions, nativeAddon, libvipsDll, libvipsCppDll };
}

async function installedSharpClosureV2(workspaceRoot: string): Promise<
  Awaited<ReturnType<typeof installedSharpClosure>> & {
    readonly colourRoot: string;
  }
> {
  const sharp = await installedSharpClosure(workspaceRoot);
  const colourPackageDirectory = await uniquePnpmPackageDirectory(
    workspaceRoot,
    `@img+colour@${COLOUR_VERSION}`,
    `@img+colour@${COLOUR_VERSION}_`,
  );
  const colourRoot = await realpath(
    resolve(colourPackageDirectory, "node_modules", "@img", "colour"),
  );
  const colourPackageJson = parseGrandHallT554StrictJson(
    await readFile(resolve(colourRoot, "package.json")),
  );
  if (
    !isRecord(colourPackageJson) ||
    colourPackageJson.version !== COLOUR_VERSION
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `The installed @img/colour package is not exactly ${COLOUR_VERSION}.`,
    );
  }
  await Promise.all([
    requireDirectRegularFile(
      resolve(colourRoot, "index.cjs"),
      "Pinned V2 @img/colour entry",
    ),
    requireDirectRegularFile(
      resolve(colourRoot, "color.cjs"),
      "Pinned V2 @img/colour implementation",
    ),
    ...SHARP_DIST_INPUT_FILENAMES_V2.map((filename) =>
      requireDirectRegularFile(
        resolve(sharp.sharpRoot, "dist", filename),
        `Pinned V2 Sharp source ${filename}`,
      ),
    ),
  ]);
  return { ...sharp, colourRoot };
}

async function pinnedZodEntryV2(workspaceRoot: string): Promise<string> {
  const zodRoot = resolve(
    workspaceRoot,
    "tools/reconstruction-foundry/node_modules/zod",
  );
  const zodEntry = resolve(workspaceRoot, ZOD_ENTRY_RELATIVE_PATH_V2);
  await requireDirectRegularFile(zodEntry, "Pinned V2 zod entry");
  const packageJson = parseGrandHallT554StrictJson(
    await readFile(resolve(zodRoot, "package.json")),
  );
  if (
    !isRecord(packageJson) ||
    packageJson.name !== "zod" ||
    packageJson.version !== ZOD_VERSION
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `The pinned V2 zod package is not exactly ${ZOD_VERSION}.`,
    );
  }
  return zodEntry;
}

function replaceExactlyOnce(
  source: string,
  pattern: string | RegExp,
  replacement: string,
  label: string,
): string {
  const matches =
    typeof pattern === "string"
      ? source.split(pattern).length - 1
      : Array.from(source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))).length;
  if (matches !== 1) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} expected one exact Sharp source match; found ${String(matches)}.`,
    );
  }
  return source.replace(pattern, replacement);
}

function patchSharpUtilityModule(
  source: string,
  versions: Readonly<Record<string, string>>,
): string {
  const importAndRuntimePattern = /import events from 'node:events';\r?\nimport \{ createRequire \} from "node:module";\r?\nimport \{ availableParallelism \} from "node:os";\r?\nimport detectLibc from 'detect-libc';\r?\n\r?\nimport is from '\.\/is\.mjs';\r?\nimport libvips from '\.\/libvips\.mjs';\r?\nimport sharp from '\.\/sharp\.mjs';\r?\nimport pkg from "\.\.\/package\.json" with \{ type: "json" \};\r?\n\r?\nconst require = createRequire\(import\.meta\.url\);\r?\nconst runtimePlatform = libvips\.runtimePlatformArch\(\);\r?\nconst libvipsVersion = sharp\.libvipsVersion\(\);/u;
  const versionPattern = /let versions = \{\r?\n {2}vips: libvipsVersion\.semver\r?\n\};[\s\S]*?versions\.sharp = pkg\.version;/u;
  const allocatorPattern = /\/\* node:coverage ignore next 7 \*\/\r?\nif \(!process\.env\.MALLOC_ARENA_MAX[\s\S]*?\r?\n\} else if \([\s\S]*?\r?\n\}/u;
  let patched = replaceExactlyOnce(
    source,
    importAndRuntimePattern,
    `import events from 'node:events';\n\nimport is from './is.mjs';\nimport sharp from './sharp.mjs';\n\nconst libvipsVersion = sharp.libvipsVersion();`,
    "Sharp utility import/runtime patch",
  );
  patched = replaceExactlyOnce(
    patched,
    versionPattern,
    `const versions = ${stableCanonicalJson(CanonicalJsonValueSchema.parse(versions))};`,
    "Sharp utility version patch",
  );
  return replaceExactlyOnce(
    patched,
    allocatorPattern,
    "/* Windows x64 closure: glibc/musl allocator tuning is inapplicable. */",
    "Sharp utility allocator patch",
  );
}

function sharpNativeBindingModule(): string {
  return `import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const loaderDirectory = dirname(fileURLToPath(import.meta.url));
const nativeAddonPath = resolve(loaderDirectory, "sharp-win32-x64-0.35.3.node");
const sharp = require(nativeAddonPath);
export default sharp;
`;
}

function coreSharpClosurePlugin(): EsbuildPlugin {
  return {
    name: "t554-closed-sharp-loader",
    setup(build) {
      build.onResolve({ filter: /^sharp$/u }, () => ({
        external: true,
        path: SHARP_LOADER_IMPORT_FROM_SERVER,
      }));
    },
  };
}

function hasExactFileImporterV2(
  args: EsbuildResolveArgs,
  expectedImporters: ReadonlySet<string>,
): boolean {
  return (
    args.namespace === "file" &&
    expectedImporters.has(comparablePath(args.importer))
  );
}

function exactFileImporterSetV2(
  workspaceRoot: string,
  relativePaths: readonly string[],
): ReadonlySet<string> {
  return new Set(
    relativePaths.map((relativePath) =>
      comparablePath(resolve(workspaceRoot, relativePath)),
    ),
  );
}

function payloadGateDependencyPluginV2(gateEntry: string): EsbuildPlugin {
  const exactGateImporter = new Set([comparablePath(gateEntry)]);
  return {
    name: "t554-v2-fixed-admission-gate-dependencies",
    setup(build) {
      build.onResolve(
        {
          filter:
            /^\.\/grand-hall-t554-native-review-fixed-admission-abi-v2\.js$/u,
        },
        (args) => {
          if (
            args.path !== FIXED_ADMISSION_ABI_SOURCE_IMPORT_V2 ||
            !hasExactFileImporterV2(args, exactGateImporter)
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 gate fixed-admission ABI substitution has an unexpected importer.",
            );
          }
          return {
            namespace: "t554-v2-fixed-admission-abi-proxy",
            path: "fixed-admission-abi-proxy.js",
          };
        },
      );
      build.onResolve({ filter: /^file:\/\/\//u }, (args) => {
        if (
          args.namespace !== "t554-v2-fixed-admission-abi-proxy" ||
          args.importer !== "fixed-admission-abi-proxy.js" ||
          args.path !==
            GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 gate capsule URL substitution changed importer or target.",
          );
        }
        return { external: true, path: args.path };
      });
      build.onLoad(
        {
          filter: /^fixed-admission-abi-proxy\.js$/u,
          namespace: "t554-v2-fixed-admission-abi-proxy",
        },
        () => ({ contents: fixedAdmissionAbiProxyModuleV2(), loader: "js" }),
      );
      build.onResolve(
        {
          filter: /^\.\/grand-hall-t554-native-review-payload-core-v2\.js$/u,
        },
        (args) => {
          if (
            args.path !== GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2 ||
            !hasExactFileImporterV2(args, exactGateImporter)
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 gate-to-core substitution has an unexpected importer.",
            );
          }
          return {
            external: true,
            path: GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
          };
        },
      );
    },
  };
}

function fixedAdmissionAbiProxyModuleV2(): string {
  return `export {
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_WITNESS_V2,
  assertGrandHallT554NativeReviewFixedPackV2,
  assertGrandHallT554NativeReviewFixedRuntimeAuthorityV2
} from ${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2)};
`;
}

function unavailableLegacyImplementationManifestModuleV2(): string {
  return `export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME = ${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2)};
export const GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA = "venviewer.grand-hall-t554-native-review-implementation-manifest.v1";
export function isGrandHallT554VerifiedNativeReviewImplementationPackV1() { return false; }
export function assertGrandHallT554VerifiedNativeReviewImplementationPackV1() { throw new Error("V1 implementation-pack authority is unavailable inside the fixed-admission V2 payload."); }
export function assertGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1() { throw new Error("V1 implementation runtime authority is unavailable inside the fixed-admission V2 payload."); }
`;
}

function payloadCoreDependencyPluginV2(
  workspaceRoot: string,
  exactZodEntry: string,
): EsbuildPlugin {
  const routerSourcePath = resolve(
    workspaceRoot,
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-router-v2.ts",
  );
  const exactTypesSources: Readonly<Record<string, string>> = Object.freeze({
    "t554-v2-types-canonical": resolve(
      workspaceRoot,
      "packages/types/src/canonical-layout-snapshot.ts",
    ),
    "t554-v2-types-grand-hall-base": resolve(
      workspaceRoot,
      "packages/types/src/grand-hall-room-scope-artifacts.ts",
    ),
    "t554-v2-types-grand-hall-v2": resolve(
      workspaceRoot,
      "packages/types/src/grand-hall-room-scope-artifacts-v2.ts",
    ),
    "t554-v2-types-grand-hall-v3": resolve(
      workspaceRoot,
      "packages/types/src/grand-hall-room-scope-artifacts-v3.ts",
    ),
    "t554-v2-types-grand-hall-membership": resolve(
      workspaceRoot,
      "packages/types/src/omnitwin-foundry-grand-hall-room-membership.ts",
    ),
  });
  const exactFoundrySources: Readonly<Record<string, string>> = Object.freeze({
    "t554-v2-foundry-canonical": resolve(
      workspaceRoot,
      "packages/reconstruction-foundry/src/canonical-json.ts",
    ),
    "t554-v2-foundry-errors": resolve(
      workspaceRoot,
      "packages/reconstruction-foundry/src/errors.ts",
    ),
    "t554-v2-foundry-hash": resolve(
      workspaceRoot,
      "packages/reconstruction-foundry/src/hash.ts",
    ),
  });
  const exactAbiImporters = exactFileImporterSetV2(workspaceRoot, [
    PAYLOAD_CORE_ENTRY_RELATIVE_PATH_V2,
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-production-authority-v2.ts",
  ]);
  const exactFoundryImporters = exactFileImporterSetV2(workspaceRoot, [
    "tools/reconstruction-foundry/src/grand-hall-t554-cleanup-marker-evidence.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-durable-journal-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-journal.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-workflow-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-orchestration-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-owner-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-store-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-panorama-review.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3-contract.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3.ts",
    "tools/reconstruction-foundry/src/grand-hall-t561-panorama-visual-observation.ts",
  ]);
  const exactTypesImporters = exactFileImporterSetV2(workspaceRoot, [
    "tools/reconstruction-foundry/src/grand-hall-t554-media-validation.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-mask-spatial-digest-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-coordinator-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-coverage.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-events-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-store.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-registry.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-kernel-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-source-epoch.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-panorama-review.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack.ts",
  ]);
  const exactZodImporters = exactFileImporterSetV2(workspaceRoot, [
    "packages/types/src/artifact-manifest.ts",
    "packages/types/src/artifact-type.ts",
    "packages/types/src/canonical-layout-snapshot.ts",
    "packages/types/src/configuration.ts",
    "packages/types/src/exposure-metadata.ts",
    "packages/types/src/furniture.ts",
    "packages/types/src/grand-hall-room-scope-artifacts-v2.ts",
    "packages/types/src/grand-hall-room-scope-artifacts-v3.ts",
    "packages/types/src/grand-hall-room-scope-artifacts.ts",
    "packages/types/src/layout-proof-object.ts",
    "packages/types/src/omnitwin-foundry-grand-hall-room-membership.ts",
    "packages/types/src/runtime-venue-manifest.ts",
    "packages/types/src/space.ts",
    "packages/types/src/user.ts",
    "packages/types/src/venue.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-cleanup-marker-evidence.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-coverage.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-durable-journal-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-events-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-http-contract-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-journal.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-store.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-workflow-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-operator-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-replay-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-owner-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-store-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-kernel-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-source-epoch.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-review-pack-v3-contract.ts",
    "tools/reconstruction-foundry/src/grand-hall-t561-panorama-visual-observation.ts",
  ]);
  const exactSharpImporters = exactFileImporterSetV2(workspaceRoot, [
    "tools/reconstruction-foundry/src/grand-hall-t554-media-validation.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-store.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-panorama-review.ts",
    "tools/reconstruction-foundry/src/grand-hall-t561-panorama-visual-observation.ts",
  ]);
  const exactLegacyManifestImporters = exactFileImporterSetV2(workspaceRoot, [
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-mask-workflow-session-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-production-authority-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-session-store-v2.ts",
    "tools/reconstruction-foundry/src/grand-hall-t554-native-review-source-session-v2.ts",
  ]);
  const exactMembershipImporter = exactFileImporterSetV2(workspaceRoot, [
    "packages/types/src/omnitwin-foundry-grand-hall-room-membership.ts",
  ]);
  const exactRouterImporter = new Set([comparablePath(routerSourcePath)]);
  return {
    name: "t554-v2-fixed-admission-core-dependencies",
    setup(build) {
      build.onLoad(
        { filter: /grand-hall-t554-native-review-router-v2\.ts$/u },
        async (args) => {
          if (
            resolve(args.path).toLowerCase() !== routerSourcePath.toLowerCase()
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 router source patch matched an unexpected file.",
            );
          }
          const source = await readFile(args.path, "utf8");
          const indirectLoopbackOrigin =
            "`http://${LOOPBACK_HOST}:${String(localPort)}`";
          if (source.split(indirectLoopbackOrigin).length - 1 !== 1) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 router no longer contains its one reviewed indirect loopback-origin expression.",
            );
          }
          return {
            contents: source.replace(
              indirectLoopbackOrigin,
              "`http://127.0.0.1:${String(localPort)}`",
            ),
            loader: "ts",
            resolveDir: dirname(args.path),
          };
        },
      );
      build.onResolve(
        {
          filter:
            /^\.\/grand-hall-t554-native-review-fixed-admission-abi-v2\.js$/u,
        },
        (args) => {
          if (
            args.path !== FIXED_ADMISSION_ABI_SOURCE_IMPORT_V2 ||
            !hasExactFileImporterV2(args, exactAbiImporters)
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 core fixed-admission ABI substitution has an unexpected importer.",
            );
          }
          return {
            namespace: "t554-v2-fixed-admission-abi-proxy",
            path: "fixed-admission-abi-proxy.js",
          };
        },
      );
      build.onResolve({ filter: /^file:\/\/\//u }, (args) => {
        if (
          args.namespace !== "t554-v2-fixed-admission-abi-proxy" ||
          args.importer !== "fixed-admission-abi-proxy.js" ||
          args.path !==
            GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 core capsule URL substitution changed importer or target.",
          );
        }
        return { external: true, path: args.path };
      });
      build.onLoad(
        {
          filter: /^fixed-admission-abi-proxy\.js$/u,
          namespace: "t554-v2-fixed-admission-abi-proxy",
        },
        () => ({ contents: fixedAdmissionAbiProxyModuleV2(), loader: "js" }),
      );
      build.onResolve(
        { filter: /^@omnitwin\/reconstruction-foundry$/u },
        (args) => {
          if (!hasExactFileImporterV2(args, exactFoundryImporters)) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 reviewed foundry bridge has an unexpected importer.",
            );
          }
          return {
            namespace: "t554-v2-reviewed-foundry-bridge",
            path: "reviewed-foundry-bridge.js",
          };
        },
      );
      build.onResolve({ filter: /^t554-v2-foundry-/u }, (args) => {
        if (
          args.namespace !== "t554-v2-reviewed-foundry-bridge" ||
          args.importer !== "reviewed-foundry-bridge.js"
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 reviewed foundry bridge changed importer or namespace.",
          );
        }
        const path = exactFoundrySources[args.path];
        if (path === undefined) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 reviewed foundry bridge requested an unreviewed source.",
          );
        }
        return { namespace: "file", path };
      });
      build.onLoad(
        {
          filter: /^reviewed-foundry-bridge\.js$/u,
          namespace: "t554-v2-reviewed-foundry-bridge",
        },
        () => ({
          contents: `export * from "t554-v2-foundry-canonical";
export * from "t554-v2-foundry-errors";
export * from "t554-v2-foundry-hash";
`,
          loader: "js",
        }),
      );
      build.onResolve({ filter: /^@omnitwin\/types$/u }, (args) => {
        if (!hasExactFileImporterV2(args, exactTypesImporters)) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 reviewed types bridge has an unexpected importer.",
          );
        }
        return {
          namespace: "t554-v2-reviewed-types-bridge",
          path: "reviewed-types-bridge.js",
        };
      });
      build.onResolve({ filter: /^t554-v2-types-/u }, (args) => {
        if (
          args.namespace !== "t554-v2-reviewed-types-bridge" ||
          args.importer !== "reviewed-types-bridge.js"
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 reviewed types bridge changed importer or namespace.",
          );
        }
        const path = exactTypesSources[args.path];
        if (path === undefined) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 reviewed types bridge requested an unreviewed source.",
          );
        }
        return { namespace: "file", path };
      });
      build.onLoad(
        {
          filter: /^reviewed-types-bridge\.js$/u,
          namespace: "t554-v2-reviewed-types-bridge",
        },
        () => ({
          contents: `export * from "t554-v2-types-canonical";
export * from "t554-v2-types-grand-hall-base";
export * from "t554-v2-types-grand-hall-v2";
export * from "t554-v2-types-grand-hall-v3";
export * from "t554-v2-types-grand-hall-membership";
`,
          loader: "js",
        }),
      );
      build.onResolve({ filter: /^zod$/u }, (args) => {
        const fromUtcBridge =
          args.namespace === "t554-v2-foundry-utc-instant-bridge" &&
          args.importer === "foundry-utc-instant-bridge.js";
        if (
          !fromUtcBridge &&
          !hasExactFileImporterV2(args, exactZodImporters)
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 pinned zod entry has an unexpected importer.",
          );
        }
        return {
          namespace: "file",
          path: exactZodEntry,
        };
      });
      build.onResolve({ filter: /^\.\/omnitwin-foundry\.js$/u }, (args) => {
        if (
          args.path !== "./omnitwin-foundry.js" ||
          !hasExactFileImporterV2(args, exactMembershipImporter)
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 foundry UTC-instant bridge has an unexpected importer.",
          );
        }
        return {
          namespace: "t554-v2-foundry-utc-instant-bridge",
          path: "foundry-utc-instant-bridge.js",
        };
      });
      build.onLoad(
        {
          filter: /^foundry-utc-instant-bridge\.js$/u,
          namespace: "t554-v2-foundry-utc-instant-bridge",
        },
        () => ({
          contents: `import { z } from "zod";
const EXACT_UTC_MILLISECOND_INSTANT = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/u;
export const FoundryUtcInstantSchema = z.string()
  .regex(EXACT_UTC_MILLISECOND_INSTANT, "timestamp must use exact YYYY-MM-DDTHH:mm:ss.sssZ form")
  .refine((value) => !value.startsWith("0000-"), "timestamp year must be between 0001 and 9999")
  .refine((value) => { const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }, "timestamp must be a canonical real UTC millisecond instant");
`,
          loader: "js",
        }),
      );
      build.onResolve(
        {
          filter:
            /^\.\/grand-hall-t554-native-review-http-response-adapter-v2\.js$/u,
        },
        (args) => {
          if (
            args.path !==
              GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2 ||
            !hasExactFileImporterV2(args, exactRouterImporter)
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 trusted HTTP adapter substitution has an unexpected importer.",
            );
          }
          return {
            external: true,
            path: GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
          };
        },
      );
      build.onResolve({ filter: /^sharp$/u }, (args) => {
        if (!hasExactFileImporterV2(args, exactSharpImporters)) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The V2 Sharp proxy has an unexpected importer.",
          );
        }
        return {
          namespace: "t554-v2-sharp-proxy",
          path: "sharp-proxy.js",
        };
      });
      build.onResolve(
        { filter: /^\.\.\/vendor\/sharp\/loader\.js$/u },
        (args) => {
          if (
            args.namespace !== "t554-v2-sharp-proxy" ||
            args.importer !== "sharp-proxy.js" ||
            args.path !==
              GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 Sharp proxy changed importer or target.",
            );
          }
          return { external: true, path: args.path };
        },
      );
      build.onLoad(
        {
          filter: /^sharp-proxy\.js$/u,
          namespace: "t554-v2-sharp-proxy",
        },
        () => ({
          contents: `export { default } from ${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2)};\n`,
          loader: "js",
        }),
      );
      build.onResolve(
        {
          filter:
            /^\.\/grand-hall-t554-native-review-implementation-manifest\.js$/u,
        },
        (args) => {
          if (
            args.path !== LEGACY_IMPLEMENTATION_MANIFEST_SOURCE_IMPORT ||
            !hasExactFileImporterV2(args, exactLegacyManifestImporters)
          ) {
            throw fail(
              "DEPENDENCY_CLOSURE_INVALID",
              "The V2 unavailable legacy-manifest substitution has an unexpected importer.",
            );
          }
          return {
            namespace: "t554-v2-unavailable-legacy-implementation-manifest",
            path: "legacy-implementation-manifest.js",
          };
        },
      );
      build.onLoad(
        {
          filter: /^legacy-implementation-manifest\.js$/u,
          namespace: "t554-v2-unavailable-legacy-implementation-manifest",
        },
        () => ({
          contents: unavailableLegacyImplementationManifestModuleV2(),
          loader: "js",
        }),
      );
    },
  };
}

function sharpLoaderPlugin(
  sharpRoot: string,
  versions: Readonly<Record<string, string>>,
): EsbuildPlugin {
  const sharpDist = resolve(sharpRoot, "dist");
  const utilityPath = resolve(sharpDist, "utility.mjs").toLowerCase();
  return {
    name: "t554-win32-x64-sharp-closure",
    setup(build) {
      build.onResolve({ filter: /(?:^|[\\/])sharp\.mjs$/u }, (args) => {
        if (resolve(args.resolveDir, args.path).toLowerCase() !== resolve(sharpDist, "sharp.mjs").toLowerCase()) {
          return null;
        }
        return { namespace: "t554-sharp-native", path: "sharp.mjs" };
      });
      build.onLoad(
        { filter: /^sharp\.mjs$/u, namespace: "t554-sharp-native" },
        () => ({ contents: sharpNativeBindingModule(), loader: "js" }),
      );
      build.onLoad({ filter: /utility\.mjs$/u }, async (args) => {
        if (resolve(args.path).toLowerCase() !== utilityPath) return null;
        return {
          contents: patchSharpUtilityModule(
            await readFile(args.path, "utf8"),
            versions,
          ),
          loader: "js",
          resolveDir: sharpDist,
        };
      });
    },
  };
}

function sharpLoaderPluginV2(
  sharpRoot: string,
  colourRoot: string,
  versions: Readonly<Record<string, string>>,
): EsbuildPlugin {
  const sharpDist = resolve(sharpRoot, "dist");
  const utilityPath = resolve(sharpDist, "utility.mjs").toLowerCase();
  const sharpNativeImporters = new Set(
    ["constructor.mjs", "input.mjs", "output.mjs", "utility.mjs"].map(
      (filename) => comparablePath(resolve(sharpDist, filename)),
    ),
  );
  const exactColourImporter = new Set([
    comparablePath(resolve(sharpDist, "colour.mjs")),
  ]);
  return {
    name: "t554-v2-win32-x64-sharp-closure",
    setup(build) {
      build.onResolve({ filter: /(?:^|[\\/])sharp\.mjs$/u }, (args) => {
        if (
          resolve(args.resolveDir, args.path).toLowerCase() !==
            resolve(sharpDist, "sharp.mjs").toLowerCase() ||
          !hasExactFileImporterV2(args, sharpNativeImporters)
        ) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The vendored Sharp native substitution has an unexpected importer.",
          );
        }
        return { namespace: "t554-sharp-native", path: "sharp.mjs" };
      });
      build.onResolve({ filter: /^@img\/colour$/u }, (args) => {
        if (!hasExactFileImporterV2(args, exactColourImporter)) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The vendored Sharp colour dependency has an unexpected importer.",
          );
        }
        return {
          namespace: "file",
          path: resolve(colourRoot, "index.cjs"),
        };
      });
      build.onLoad(
        { filter: /^sharp\.mjs$/u, namespace: "t554-sharp-native" },
        () => ({ contents: sharpNativeBindingModule(), loader: "js" }),
      );
      build.onLoad({ filter: /utility\.mjs$/u }, async (args) => {
        if (resolve(args.path).toLowerCase() !== utilityPath) {
          throw fail(
            "DEPENDENCY_CLOSURE_INVALID",
            "The vendored V2 Sharp utility patch matched an unexpected file.",
          );
        }
        return {
          contents: patchSharpUtilityModule(
            await readFile(args.path, "utf8"),
            versions,
          ),
          loader: "js",
          resolveDir: sharpDist,
        };
      });
    },
  };
}

function externalImports(result: EsbuildBuildResult): readonly string[] {
  if (result.metafile === undefined) {
    throw fail("BUILD_FAILED", "esbuild did not return its required metafile.");
  }
  return Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((entry) => entry.external === true)
    .map((entry) => entry.path)
    .sort();
}

function exactMetafile(result: EsbuildBuildResult, label: string): EsbuildMetafile {
  if (result.metafile === undefined) {
    throw fail("BUILD_FAILED", `${label} did not return its required metafile.`);
  }
  return result.metafile;
}

function normalizedMetafileInput(input: string): string {
  return input.replaceAll("\\", "/");
}

function assertExactMetafileInputClosureV2(
  result: EsbuildBuildResult,
  expectedInputs: readonly string[],
  label: string,
): void {
  assertExactMetafileInputKeysV2(
    Object.keys(exactMetafile(result, label).inputs),
    expectedInputs,
    label,
  );
}

function assertExactMetafileInputKeysV2(
  actualInputs: readonly string[],
  expectedInputs: readonly string[],
  label: string,
): void {
  const actual = actualInputs.map(normalizedMetafileInput).sort();
  const expected = expectedInputs.map(normalizedMetafileInput).sort();
  if (
    actual.length !== expected.length ||
    actual.some((input, index) => input !== expected[index])
  ) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const unexpected = actual.filter((input) => !expectedSet.has(input));
    const missing = expected.filter((input) => !actualSet.has(input));
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} metafile input closure changed (unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}).`,
    );
  }
}

export const __testOnlyGrandHallT554NativeReviewCompiledPackBuilderV2 =
  Object.freeze({
    reviewedCoreMetafileInputKeys(): readonly string[] {
      return Object.freeze([
        ...CORE_REAL_INPUT_RELATIVE_PATHS_V2,
        ...CORE_VIRTUAL_INPUTS_V2,
      ]);
    },
    assertExactCoreMetafileInputClosure(inputKeys: readonly string[]): void {
      assertExactMetafileInputKeysV2(
        inputKeys,
        [
          ...CORE_REAL_INPUT_RELATIVE_PATHS_V2,
          ...CORE_VIRTUAL_INPUTS_V2,
        ],
        "Synthetic V2 payload core",
      );
    },
  });

function moduleOutputFactsV2(
  result: EsbuildBuildResult,
  label: string,
): {
  readonly imports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
  readonly exports: readonly string[];
} {
  const outputs = Object.values(exactMetafile(result, label).outputs);
  if (outputs.length !== 1) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} must emit exactly one metafile output; found ${String(outputs.length)}.`,
    );
  }
  const output = outputs[0];
  if (output === undefined) {
    throw fail("DEPENDENCY_CLOSURE_INVALID", `${label} output disappeared.`);
  }
  return Object.freeze({
    imports: Object.freeze(
      output.imports.map((entry) =>
        Object.freeze({
          path: entry.path,
          kind: entry.kind,
          external: entry.external === true,
        }),
      ),
    ),
    exports: Object.freeze([...output.exports]),
  });
}

function importTupleKeyV2(
  entry: GrandHallT554NativeReviewCompiledModuleImportV2,
): string {
  return `${entry.path}\u0000${entry.kind}\u0000${String(entry.external)}`;
}

function assertExactModuleOutputFactsV2(
  facts: {
    readonly imports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[];
    readonly exports: readonly string[];
  },
  expectedImports: readonly GrandHallT554NativeReviewCompiledModuleImportV2[],
  expectedExports: readonly string[],
  label: string,
): void {
  const actualImports = facts.imports.map(importTupleKeyV2).sort();
  const exactImports = expectedImports.map(importTupleKeyV2).sort();
  const actualExports = [...facts.exports].sort();
  const exactExports = [...expectedExports].sort();
  if (
    actualImports.length !== exactImports.length ||
    actualImports.some((entry, index) => entry !== exactImports[index])
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} metafile import tuples or multiplicities changed.`,
    );
  }
  if (
    actualExports.length !== exactExports.length ||
    actualExports.some((entry, index) => entry !== exactExports[index])
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} emitted export vocabulary changed.`,
    );
  }
}

function repeatedStaticExternalImportV2(
  path: string,
  count = 1,
): readonly GrandHallT554NativeReviewCompiledModuleImportV2[] {
  return Array.from({ length: count }, () => ({
    path,
    kind: "import-statement",
    external: true,
  }));
}

function assertMetafileExcludesInput(
  result: EsbuildBuildResult,
  forbiddenInputSuffix: string,
  label: string,
): void {
  if (result.metafile === undefined) {
    throw fail("BUILD_FAILED", "esbuild did not return its required metafile.");
  }
  const normalizedSuffix = forbiddenInputSuffix.replaceAll("\\", "/");
  const matches = Object.keys(result.metafile.inputs).filter((input) =>
    input.replaceAll("\\", "/").endsWith(normalizedSuffix),
  );
  if (matches.length > 0) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} retained forbidden source input ${forbiddenInputSuffix}.`,
    );
  }
}

function assertClosedExternalImports(
  imports: readonly string[],
  exactRelativeImports: readonly string[],
  label: string,
): void {
  const allowedRelative = new Set(exactRelativeImports);
  const forbidden = imports.filter(
    (specifier) =>
      !NODE_BUILTIN_SPECIFIERS.has(specifier) &&
      !allowedRelative.has(specifier),
  );
  if (forbidden.length > 0) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} retains forbidden external resolution: ${forbidden.join(", ")}.`,
    );
  }
  for (const required of exactRelativeImports) {
    if (!imports.includes(required)) {
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        `${label} does not retain its exact required ${required} import.`,
      );
    }
  }
}

function assertExactNonBuiltinExternalImportsV2(
  imports: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  assertClosedExternalImports(imports, expected, label);
  const actualNonBuiltin = imports
    .filter((specifier) => !NODE_BUILTIN_SPECIFIERS.has(specifier))
    .sort();
  const exactExpected = expected.slice().sort();
  if (
    actualNonBuiltin.length !== exactExpected.length ||
    actualNonBuiltin.some(
      (specifier, index) => specifier !== exactExpected[index],
    )
  ) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} does not retain the exact non-builtin external import multiplicity; expected ${exactExpected.join(", ") || "none"}, received ${actualNonBuiltin.join(", ") || "none"}.`,
    );
  }
}

function assertNoLiteralPackageResolution(
  source: string,
  allowedRelativeImports: readonly string[],
  label: string,
): void {
  const matches = Array.from(
    source.matchAll(
      /(?:\bimport\s*\(|\brequire\s*\(|\b__require(?:\d+)?\s*\()\s*["']([^"']+)["']/gu,
    ),
  );
  const specifiers = matches.flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  const allowed = new Set(allowedRelativeImports);
  const forbidden = specifiers.filter(
    (specifier) =>
      !NODE_BUILTIN_SPECIFIERS.has(specifier) && !allowed.has(specifier),
  );
  if (forbidden.length > 0) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} contains forbidden literal module resolution: ${forbidden.join(", ")}.`,
    );
  }
}

function literalModuleSpecifiers(source: string): readonly string[] {
  const staticSpecifiers = Array.from(
    source.matchAll(
      /\b(?:import|export)(?:\s+|(?=\{)|(?=\*))[^;()]*?\bfrom\s*["']([^"']+)["']/gu,
    ),
  ).flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  const calledSpecifiers = Array.from(
    source.matchAll(
      /(?:\bimport\s*\(|\brequire\s*\(|\b__require(?:\d+)?\s*\()\s*["']([^"']+)["']/gu,
    ),
  ).flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  return Object.freeze([...staticSpecifiers, ...calledSpecifiers].sort());
}

function assertExactLiteralModuleResolutionV2(
  source: string,
  exactPackOrCapsuleImports: readonly string[],
  label: string,
): void {
  const specifiers = literalModuleSpecifiers(source);
  const allowed = new Set(exactPackOrCapsuleImports);
  const forbidden = specifiers.filter(
    (specifier) =>
      !NODE_BUILTIN_SPECIFIERS.has(specifier) && !allowed.has(specifier),
  );
  if (forbidden.length > 0) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} contains forbidden literal module resolution: ${forbidden.join(", ")}.`,
    );
  }
  for (const required of exactPackOrCapsuleImports) {
    if (!specifiers.includes(required)) {
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        `${label} does not retain its exact required ${required} literal import.`,
      );
    }
  }
  const dynamicOrRequireCallCount = Array.from(
    source.matchAll(
      /(?:\bimport\s*\(|\brequire\s*\(|\b__require(?:\d+)?\s*\()/gu,
    ),
  ).length;
  const literalDynamicOrRequireCount = Array.from(
    source.matchAll(
      /(?:\bimport\s*\(|\brequire\s*\(|\b__require(?:\d+)?\s*\()\s*["'][^"']+["']/gu,
    ),
  ).length;
  if (dynamicOrRequireCallCount !== literalDynamicOrRequireCount) {
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} contains non-literal dynamic or CommonJS module resolution.`,
    );
  }
}

function assertNoForbiddenV2PayloadCapabilitySurface(
  source: string,
  label: string,
): void {
  const withoutCapsule = source.replaceAll(
    GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
    "",
  );
  const withoutFixedLoopbackOrigin = withoutCapsule.replaceAll(
    "http://127.0.0.1:",
    "",
  );
  const externalTarget = /\b(?:file|https?):\/\//iu.exec(
    withoutFixedLoopbackOrigin,
  );
  if (externalTarget !== null) {
    const contextStart = Math.max(0, externalTarget.index - 80);
    const contextEnd = Math.min(
      withoutFixedLoopbackOrigin.length,
      externalTarget.index + externalTarget[0].length + 80,
    );
    throw fail(
      "DEPENDENCY_CLOSURE_INVALID",
      `${label} retained a nonfixed file or HTTP(S) target near ${JSON.stringify(withoutFixedLoopbackOrigin.slice(contextStart, contextEnd))}.`,
    );
  }
  const forbidden = [
    ["source-map URL", /\bsourceMappingURL\b/u],
    ["embedded source content", /\bsourcesContent\b/u],
    [
      "test-only surface",
      /\b(?:vitest|jest|__testOnly|testOnly|verificationSeam)\b/iu,
    ],
    ["HTTP server creation", /\bcreateServer\s*\(/u],
    ["listener creation", /\.\s*listen\s*\(/u],
    ["browser launcher", /\b(?:launch|open|start)(?:Default)?Browser\s*\(/iu],
    ["push/event client", /\b(?:WebSocket|EventSource)\s*\(/u],
    [
      "caller-selected verifier input",
      /\b(?:reviewedAnchor|implementationPackRoot|manifestFileSha256|manifestFileByteLength|fixedProductionReviewedPack)\b/u,
    ],
    ["import-meta resolution", /\bimport\.meta\.resolve\b/u],
    ["CommonJS resolution", /\brequire\.resolve\b/u],
    ["package-store resolution", /\bnode_modules\b/iu],
    ["Node resolution environment", /\bNODE_(?:OPTIONS|PATH)\b/u],
    [
      "source-tree traversal",
      /(?:^|[^A-Za-z0-9_])(?:\.\.\/)+(?:src|source)(?:\/|["'])/u,
    ],
    ["TypeScript runtime target", /["'][^"']+\.tsx?(?:[?#][^"']*)?["']/iu],
    [
      "fixed payload-path literal",
      /PrivateReleases\/trades-hall-grand-hall-t554-workbench-v2\/payload/iu,
    ],
    ["runtime createRequire", /\bcreateRequire\b/u],
    ["runtime CommonJS require", /\b(?:require|__require\d*)\s*\(/u],
    ["network fetch", /\bfetch\s*\(/u],
  ] as const;
  for (const [description, pattern] of forbidden) {
    const match = pattern.exec(source);
    if (match !== null) {
      const contextStart = Math.max(0, match.index - 80);
      const contextEnd = Math.min(
        source.length,
        match.index + match[0].length + 80,
      );
      const context = JSON.stringify(source.slice(contextStart, contextEnd));
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        `${label} retained forbidden ${description} near ${context}.`,
      );
    }
  }
}

async function writeExclusive(path: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}

function kindForMember(
  relativePath: string,
): GrandHallT554NativeReviewImplementationMemberV1["kind"] {
  if (relativePath === "package.json") return "module-metadata";
  if (relativePath === "vendor/decoder-runtime.json") {
    return "decoder-closure-metadata";
  }
  if (relativePath === SERVER_BUNDLE_MEMBER) return "server-bundle";
  if (relativePath === HTTP_ADAPTER_MEMBER) return "trusted-http-adapter";
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER ||
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER
  ) {
    return "runtime-attestation-module";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER) {
    return "runtime-inspector-addon";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER) {
    return "runtime-attestation-probe";
  }
  if (relativePath.startsWith("static/")) return "static-asset";
  if (relativePath === SHARP_LOADER_MEMBER) return "sharp-runtime";
  if (relativePath === SHARP_NATIVE_ADDON_MEMBER) return "sharp-native-addon";
  if (
    relativePath === LIBVIPS_DLL_MEMBER ||
    relativePath === LIBVIPS_CPP_DLL_MEMBER
  ) {
    return "libvips-native-dependency";
  }
  throw fail(
    "OUTPUT_INVALID",
    `No closed implementation-member kind exists for ${relativePath}.`,
  );
}

async function memberFor(
  packRoot: string,
  relativePath: string,
): Promise<GrandHallT554NativeReviewImplementationMemberV1> {
  const bytes = await readFile(resolve(packRoot, ...relativePath.split("/")));
  if (bytes.length < 1) {
    throw fail("OUTPUT_INVALID", `${relativePath} must not be empty.`);
  }
  return {
    relativePath,
    kind: kindForMember(relativePath),
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

function kindForMemberV2(
  relativePath: string,
): GrandHallT554NativeReviewImplementationMemberV2["kind"] {
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2
  ) {
    return "module-metadata";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2) {
    return "payload-admission-gate";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2) {
    return "payload-core";
  }
  if (
    relativePath ===
    GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2
  ) {
    return "trusted-http-adapter";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2
  ) {
    return "runtime-bootstrap";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2 ||
    relativePath ===
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2 ||
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2
  ) {
    return "static-asset";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2
  ) {
    return "decoder-closure-metadata";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2) {
    return "sharp-runtime";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2
  ) {
    return "sharp-native-addon";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2 ||
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2
  ) {
    return "libvips-native-dependency";
  }
  if (
    relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2
  ) {
    return "runtime-inspector-addon";
  }
  if (relativePath === GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2) {
    return "runtime-attestation-probe";
  }
  throw fail(
    "OUTPUT_INVALID",
    `No closed v2 implementation-member kind exists for ${relativePath}.`,
  );
}

async function memberForV2(
  packRoot: string,
  relativePath: string,
): Promise<GrandHallT554NativeReviewImplementationMemberV2> {
  const bytes = await readFile(resolve(packRoot, ...relativePath.split("/")));
  if (bytes.length < 1) {
    throw fail("OUTPUT_INVALID", `${relativePath} must not be empty.`);
  }
  return {
    relativePath,
    kind: kindForMemberV2(relativePath),
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

/**
 * Builds one unreviewed, authority-none implementation-pack candidate.
 * The output root must not exist. The builder byte-verifies the whole pack but
 * deliberately does not configure the private production trust root.
 */
export async function buildGrandHallT554NativeReviewCompiledPackV1(input: {
  readonly workspaceRoot: string;
  readonly outputRoot: string;
  readonly __testOnlySeam?: __GrandHallT554NativeReviewCompiledPackBuildSeamV1;
}): Promise<GrandHallT554NativeReviewCompiledPackBuildResultV1> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw fail(
      "PLATFORM_UNSUPPORTED",
      "The current closure is intentionally pinned to Windows x64.",
    );
  }
  const workspaceRootInput = requireAbsoluteLocalPath(
    input.workspaceRoot,
    "Workspace root",
  );
  const outputRoot = requireAbsoluteLocalPath(input.outputRoot, "Output root");
  const workspaceRootWitness = await captureDirectDirectory(
    workspaceRootInput,
    "Workspace root",
    "ARGUMENT_INVALID",
  );
  const canonicalWorkspaceRoot = workspaceRootWitness.canonicalPath;
  const outputParent = dirname(outputRoot);
  const outputLeaf = relative(outputParent, outputRoot);
  if (
    outputLeaf.length === 0 ||
    outputLeaf === "." ||
    outputLeaf === ".." ||
    outputLeaf.includes(sep)
  ) {
    throw fail("ARGUMENT_INVALID", "Output root must have one concrete leaf name.");
  }
  await requirePathAbsent(outputRoot, "Output root");
  const outputParentWitness = await captureDirectDirectory(
    outputParent,
    "Output parent",
  );
  const canonicalOutputRoot = resolve(
    outputParentWitness.canonicalPath,
    outputLeaf,
  );
  const workspaceToOutput = relative(
    canonicalWorkspaceRoot,
    canonicalOutputRoot,
  );
  if (
    workspaceToOutput === "" ||
    (!workspaceToOutput.startsWith(`..${sep}`) &&
      workspaceToOutput !== ".." &&
      !isAbsolute(workspaceToOutput))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "The implementation pack output must remain outside the git workspace.",
    );
  }
  const esbuild = await loadEsbuild(canonicalWorkspaceRoot);
  const sharp = await installedSharpClosure(canonicalWorkspaceRoot);
  const coreEntry = resolve(canonicalWorkspaceRoot, CORE_ENTRY_RELATIVE_PATH);
  const adapterEntry = resolve(
    canonicalWorkspaceRoot,
    HTTP_ADAPTER_ENTRY_RELATIVE_PATH,
  );
  const runtimeAttestorEntry = resolve(
    canonicalWorkspaceRoot,
    RUNTIME_ATTESTOR_ENTRY_RELATIVE_PATH,
  );
  const runtimeBootstrapEntry = resolve(
    canonicalWorkspaceRoot,
    RUNTIME_BOOTSTRAP_ENTRY_RELATIVE_PATH,
  );
  const runtimeInspectorSource = resolve(
    canonicalWorkspaceRoot,
    RUNTIME_INSPECTOR_SOURCE_RELATIVE_PATH,
  );
  await Promise.all([
    requireDirectRegularFile(coreEntry, "Compiled core entry"),
    requireDirectRegularFile(adapterEntry, "Trusted HTTP adapter entry"),
    requireDirectRegularFile(runtimeAttestorEntry, "Runtime attestor entry"),
    requireDirectRegularFile(runtimeBootstrapEntry, "Runtime bootstrap entry"),
    requireDirectRegularFile(runtimeInspectorSource, "Runtime inspector release addon"),
  ]);

  let stagingRoot: string | undefined;
  let stagingWitness: DirectoryWitness | undefined;
  let published = false;
  try {
    await assertDirectoryWitness(
      outputParent,
      outputParentWitness,
      "Output parent",
    );
    stagingRoot = await mkdtemp(
      resolve(outputParent, `.${outputLeaf}.building-`),
    );
    stagingWitness = await captureDirectDirectory(
      stagingRoot,
      "Owned staging root",
    );
    if (stagingWitness.stats.dev !== outputParentWitness.stats.dev) {
      throw fail(
        "OUTPUT_INVALID",
        "The staging root and output parent are not on the same filesystem.",
      );
    }
    await input.__testOnlySeam?.afterStagingRootCreated?.(stagingRoot);
    const assertOwnedStaging = async (): Promise<void> => {
      if (stagingRoot === undefined || stagingWitness === undefined) {
        throw fail("OUTPUT_INVALID", "The owned staging root is unavailable.");
      }
      await assertDirectoryWitness(
        outputParent,
        outputParentWitness,
        "Output parent",
      );
      await assertDirectoryWitness(
        stagingRoot,
        stagingWitness,
        "Owned staging root",
      );
    };
    await assertOwnedStaging();
    const packRoot = stagingRoot;
    await Promise.all([
      writeExclusive(resolve(packRoot, "package.json"), canonicalBytes(MODULE_METADATA)),
      writeExclusive(resolve(packRoot, "static", "index.html"), STATIC_INDEX_HTML),
      writeExclusive(resolve(packRoot, "static", "review.css"), STATIC_REVIEW_CSS),
      writeExclusive(resolve(packRoot, "static", "review.js"), STATIC_REVIEW_JS),
    ]);
    await assertOwnedStaging();

    const baseBuildOptions = {
      absWorkingDir: canonicalWorkspaceRoot,
      bundle: true,
      charset: "utf8",
      conditions: ["import", "node"],
      format: "esm",
      legalComments: "none",
      logLevel: "silent",
      metafile: true,
      minifyIdentifiers: false,
      minifySyntax: true,
      minifyWhitespace: true,
      platform: "node",
      sourcemap: false,
      target: ["node22"],
      treeShaking: true,
      write: true,
    } as const;

    await mkdir(resolve(packRoot, "server"), { recursive: true });
    const coreBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [coreEntry],
      outfile: resolve(packRoot, ...SERVER_BUNDLE_MEMBER.split("/")),
      plugins: [coreSharpClosurePlugin()],
      banner: {
        js: 'import { createRequire as __venviewerCreateRequire } from "node:module"; const require = __venviewerCreateRequire(import.meta.url);',
      },
    });
    const adapterBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [adapterEntry],
      outfile: resolve(packRoot, ...HTTP_ADAPTER_MEMBER.split("/")),
    });
    const runtimeAttestorBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [runtimeAttestorEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER.split("/"),
      ),
    });
    const runtimeBootstrapBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [runtimeBootstrapEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER.split("/"),
      ),
    });
    await assertOwnedStaging();

    await mkdir(resolve(packRoot, "vendor", "sharp"), { recursive: true });
    const sharpBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [resolve(sharp.sharpRoot, "dist", "index.mjs")],
      outfile: resolve(packRoot, ...SHARP_LOADER_MEMBER.split("/")),
      plugins: [sharpLoaderPlugin(sharp.sharpRoot, sharp.versions)],
    });

    const coreExternalImports = externalImports(coreBuild);
    const httpAdapterExternalImports = externalImports(adapterBuild);
    const runtimeAttestorExternalImports = externalImports(runtimeAttestorBuild);
    const runtimeBootstrapExternalImports = externalImports(runtimeBootstrapBuild);
    const sharpLoaderExternalImports = externalImports(sharpBuild);
    assertClosedExternalImports(
      coreExternalImports,
      [SHARP_LOADER_IMPORT_FROM_SERVER],
      "Compiled review core",
    );
    assertClosedExternalImports(
      httpAdapterExternalImports,
      [],
      "Trusted HTTP adapter",
    );
    assertClosedExternalImports(
      runtimeAttestorExternalImports,
      [],
      "Runtime attestor",
    );
    assertClosedExternalImports(
      runtimeBootstrapExternalImports,
      [],
      "Runtime bootstrap",
    );
    assertClosedExternalImports(
      sharpLoaderExternalImports,
      [],
      "Vendored Sharp loader",
    );
    assertNoLiteralPackageResolution(
      await readFile(
        resolve(packRoot, ...SERVER_BUNDLE_MEMBER.split("/")),
        "utf8",
      ),
      [SHARP_LOADER_IMPORT_FROM_SERVER],
      "Compiled review core",
    );
    assertNoLiteralPackageResolution(
      await readFile(
        resolve(packRoot, ...HTTP_ADAPTER_MEMBER.split("/")),
        "utf8",
      ),
      [],
      "Trusted HTTP adapter",
    );
    assertNoLiteralPackageResolution(
      await readFile(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER.split("/"),
        ),
        "utf8",
      ),
      [],
      "Runtime attestor",
    );
    assertNoLiteralPackageResolution(
      await readFile(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER.split("/"),
        ),
        "utf8",
      ),
      [],
      "Runtime bootstrap",
    );
    const sharpLoaderSource = await readFile(
      resolve(packRoot, ...SHARP_LOADER_MEMBER.split("/")),
      "utf8",
    );
    assertNoLiteralPackageResolution(
      sharpLoaderSource,
      [],
      "Vendored Sharp loader",
    );
    if (
      !sharpLoaderSource.includes("sharp-win32-x64-0.35.3.node") ||
      !sharpLoaderSource.includes("libvips") ||
      /process\.env(?:\[\s*["']PATH["']\s*\]|\.PATH)\s*=/u.test(
        sharpLoaderSource,
      )
    ) {
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        "The vendored Sharp loader does not bind the exact native addon/libvips closure without a PATH fallback.",
      );
    }

    await assertOwnedStaging();
    await mkdir(resolve(packRoot, "vendor", "libvips"), {
      recursive: true,
    });
    await Promise.all([
      copyFile(
        sharp.nativeAddon,
        resolve(packRoot, ...SHARP_NATIVE_ADDON_MEMBER.split("/")),
        fileSystemConstants.COPYFILE_EXCL,
      ),
      copyFile(
        sharp.libvipsDll,
        resolve(packRoot, ...LIBVIPS_DLL_MEMBER.split("/")),
        fileSystemConstants.COPYFILE_EXCL,
      ),
      copyFile(
        sharp.libvipsCppDll,
        resolve(packRoot, ...LIBVIPS_CPP_DLL_MEMBER.split("/")),
        fileSystemConstants.COPYFILE_EXCL,
      ),
    ]);
    await Promise.all([
      mkdir(resolve(packRoot, "vendor", "runtime-inspector"), {
        recursive: true,
      }),
      mkdir(resolve(packRoot, "vendor", "runtime-attestation"), {
        recursive: true,
      }),
    ]);
    await copyFile(
      runtimeInspectorSource,
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER.split("/"),
      ),
      fileSystemConstants.COPYFILE_EXCL,
    );
    const runtimeProbeBytes = Buffer.from(
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
      "base64",
    );
    try {
      if (
        runtimeProbeBytes.length !== 879 ||
        sha256(runtimeProbeBytes) !== RUNTIME_PROBE_SHA256
      ) {
        throw fail(
          "DEPENDENCY_CLOSURE_INVALID",
          "The fixed runtime-attestation JPEG probe bytes are invalid.",
        );
      }
      await writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER.split("/"),
        ),
        runtimeProbeBytes,
      );
    } finally {
      runtimeProbeBytes.fill(0);
    }
    await assertOwnedStaging();

    const decoder: GrandHallT554NativeReviewImplementationDecoderClosureV1 = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-decoder-closure.v1",
      library: "sharp",
      sharpVersion: SHARP_VERSION,
      libvipsVersion: LIBVIPS_VERSION,
      platform: process.platform,
      architecture: process.arch,
      sourceJpegDecoderPipeline:
        "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      strictMaskPngDecoderPipeline:
        "canonical-grayscale8-source-grid-mask-and-reason-map.v2",
      metadataMember: "vendor/decoder-runtime.json",
      sharpRuntimeMembers: [SHARP_LOADER_MEMBER],
      sharpNativeAddonMember: SHARP_NATIVE_ADDON_MEMBER,
      libvipsNativeDependencyMembers: [
        LIBVIPS_DLL_MEMBER,
        LIBVIPS_CPP_DLL_MEMBER,
      ],
    };
    await writeExclusive(
      resolve(packRoot, "vendor", "decoder-runtime.json"),
      canonicalBytes(decoder),
    );

    const relativeMembers = [
      "package.json",
      SERVER_BUNDLE_MEMBER,
      HTTP_ADAPTER_MEMBER,
      "static/index.html",
      "static/review.css",
      "static/review.js",
      "vendor/decoder-runtime.json",
      SHARP_LOADER_MEMBER,
      SHARP_NATIVE_ADDON_MEMBER,
      LIBVIPS_DLL_MEMBER,
      LIBVIPS_CPP_DLL_MEMBER,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER,
    ].sort();
    const members = await Promise.all(
      relativeMembers.map((relativePath) => memberFor(packRoot, relativePath)),
    );
    const material: Omit<
      GrandHallT554NativeReviewImplementationManifestV1,
      "semanticSha256"
    > = {
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
      implementationId: "grand-hall-t554-native-review-workbench-v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      sourceCount: 148,
      authority: "none",
      runtime:
        __testOnlyGrandHallT554NativeReviewImplementationManifest.currentRuntimeIdentity(),
      decoder,
      execution: {
        mode: "compiled-esm-private-local-review-core.v1",
        moduleFormat: "esm",
        bindAddress: "127.0.0.1",
        browserTrust: "untrusted-display-and-input",
        dependencyClosure: "reviewed-pack-members-plus-node-builtins.v1",
        entryImportPolicy: "verify-entire-pack-before-import.v1",
        productionFactoryIncluded: false,
        httpLaunchIncluded: false,
        sourceMapsIncluded: false,
        tsxExecutionAuthorized: false,
        mixedSourceDistResolutionAuthorized: false,
        externalRuntimeModuleResolutionAuthorized: false,
        browserControlledTruthAuthorized: false,
        externalNetworkAuthorized: false,
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAdmissionAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
      },
      serverBundleModule: SERVER_BUNDLE_MEMBER,
      trustedHttpAdapterModule: HTTP_ADAPTER_MEMBER,
      memberCount: members.length,
      totalMemberBytes: members.reduce(
        (total, member) => total + member.byteLength,
        0,
      ),
      members,
    };
    const manifest: GrandHallT554NativeReviewImplementationManifestV1 = {
      ...material,
      semanticSha256:
        __testOnlyGrandHallT554NativeReviewImplementationManifest.computeManifestSemanticSha256(
          material as GrandHallT554NativeReviewImplementationManifestV1,
        ),
    };
    const manifestBytes = canonicalBytes(manifest);
    const manifestPath = resolve(
      packRoot,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
    );
    await writeExclusive(manifestPath, manifestBytes);
    const reviewedAnchorCandidate = {
      manifestSemanticSha256: manifest.semanticSha256,
      manifestFileSha256: sha256(manifestBytes),
      manifestFileByteLength: manifestBytes.length,
    };
    const stagingVerifiedCandidate =
      await __testOnlyGrandHallT554NativeReviewImplementationManifest.verifyCallerAnchoredImplementationPackCandidate(
        {
          implementationPackRoot: packRoot,
          reviewedAnchor: reviewedAnchorCandidate,
          bootstrapExecutionIdentity: {
            compiledJavascriptModule: true,
            execArgv: [],
            nodeOptions: null,
            nodePath: null,
          },
        },
      );
    await assertOwnedStaging();
    await input.__testOnlySeam?.beforeAtomicPublish?.({
      stagingRoot: packRoot,
      outputRoot,
    });
    await assertOwnedStaging();
    await requirePathAbsent(outputRoot, "Output root");
    await rename(packRoot, outputRoot);
    published = true;
    await assertDirectoryWitness(
      outputRoot,
      stagingWitness,
      "Published implementation-pack root",
    );
    await assertDirectoryWitness(
      outputParent,
      outputParentWitness,
      "Output parent",
    );
    const publishedVerifiedCandidate =
      await __testOnlyGrandHallT554NativeReviewImplementationManifest.verifyCallerAnchoredImplementationPackCandidate(
        {
          implementationPackRoot: outputRoot,
          reviewedAnchor: reviewedAnchorCandidate,
          bootstrapExecutionIdentity: {
            compiledJavascriptModule: true,
            execArgv: [],
            nodeOptions: null,
            nodePath: null,
          },
        },
      );
    let runtimeAttestationCandidate:
      | GrandHallT554NativeReviewRuntimeAttestationCandidateV1
      | null = null;
    let runtimeAttestationStatus:
      | "attested-candidate"
      | "runtime-inspector-not-reviewed";
    try {
      runtimeAttestationCandidate =
        await attestGrandHallT554NativeReviewRuntimeCandidateV1({
          implementationPackRoot: outputRoot,
          candidate: publishedVerifiedCandidate,
        });
      runtimeAttestationStatus = "attested-candidate";
    } catch (error) {
      if (
        error instanceof GrandHallT554NativeReviewRuntimeAttestationError &&
        error.code === "RUNTIME_INSPECTOR_NOT_REVIEWED"
      ) {
        runtimeAttestationStatus = "runtime-inspector-not-reviewed";
      } else {
        throw error;
      }
    }
    void stagingVerifiedCandidate;
    return Object.freeze({
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V1,
      packRoot: outputRoot,
      manifestPath: resolve(
        outputRoot,
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
      ),
      manifest,
      reviewedAnchorCandidate,
      verifiedCandidate: publishedVerifiedCandidate,
      runtimeAttestationCandidate,
      runtimeAttestationStatus,
      coreExternalImports,
      httpAdapterExternalImports,
      runtimeAttestorExternalImports,
      runtimeBootstrapExternalImports,
      sharpLoaderExternalImports,
    });
  } catch (error) {
    let cleanupFailure: unknown;
    if (stagingWitness !== undefined) {
      const cleanupPath = published ? outputRoot : stagingRoot;
      if (cleanupPath !== undefined) {
        try {
          const cleaned = await cleanupOwnedDirectory(
            cleanupPath,
            stagingWitness,
          );
          if (!cleaned) {
            cleanupFailure = new Error(
              "Owned implementation-pack bytes could not be removed because the cleanup path changed identity.",
            );
          }
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
      }
    }
    if (cleanupFailure !== undefined) {
      throw fail(
        "CLEANUP_INCOMPLETE",
        "The compiled implementation-pack build failed and its owned bytes could not be proved removed.",
        Object.freeze({ buildFailure: error, cleanupFailure }),
      );
    }
    if (error instanceof GrandHallT554NativeReviewCompiledPackBuilderError) {
      throw error;
    }
    throw fail("BUILD_FAILED", "The compiled implementation pack build failed.", error);
  }
}

/**
 * Builds one deterministic, authority-none v2 payload candidate. The output
 * deliberately excludes the fixed admission capsule and every listener or
 * runtime-authority minter; only a separately reviewed fixed capsule can admit
 * these bytes later.
 */
export async function buildGrandHallT554NativeReviewCompiledPackV2(input: {
  readonly workspaceRoot: string;
  readonly outputRoot: string;
  readonly __testOnlySeam?: __GrandHallT554NativeReviewCompiledPackBuildSeamV2;
}): Promise<GrandHallT554NativeReviewCompiledPackBuildResultV2> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw fail(
      "PLATFORM_UNSUPPORTED",
      "The current v2 payload closure is intentionally pinned to Windows x64.",
    );
  }
  const workspaceRootInput = requireAbsoluteLocalPath(
    input.workspaceRoot,
    "Workspace root",
  );
  const outputRoot = requireAbsoluteLocalPath(input.outputRoot, "Output root");
  const workspaceRootWitness = await captureDirectDirectory(
    workspaceRootInput,
    "Workspace root",
    "ARGUMENT_INVALID",
  );
  const canonicalWorkspaceRoot = workspaceRootWitness.canonicalPath;
  const outputParent = dirname(outputRoot);
  const outputLeaf = relative(outputParent, outputRoot);
  if (
    outputLeaf.length === 0 ||
    outputLeaf === "." ||
    outputLeaf === ".." ||
    outputLeaf.includes(sep)
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "Output root must have one concrete leaf name.",
    );
  }
  await requirePathAbsent(outputRoot, "Output root");
  const outputParentWitness = await captureDirectDirectory(
    outputParent,
    "Output parent",
  );
  const canonicalOutputRoot = resolve(
    outputParentWitness.canonicalPath,
    outputLeaf,
  );
  const workspaceToOutput = relative(
    canonicalWorkspaceRoot,
    canonicalOutputRoot,
  );
  if (
    workspaceToOutput === "" ||
    (!workspaceToOutput.startsWith(`..${sep}`) &&
      workspaceToOutput !== ".." &&
      !isAbsolute(workspaceToOutput))
  ) {
    throw fail(
      "ARGUMENT_INVALID",
      "The v2 implementation payload output must remain outside the git workspace.",
    );
  }

  const esbuild = await loadEsbuild(canonicalWorkspaceRoot);
  const sharp = await installedSharpClosureV2(canonicalWorkspaceRoot);
  const exactZodEntry = await pinnedZodEntryV2(canonicalWorkspaceRoot);
  const gateEntry = resolve(
    canonicalWorkspaceRoot,
    PAYLOAD_GATE_ENTRY_RELATIVE_PATH_V2,
  );
  const coreEntry = resolve(
    canonicalWorkspaceRoot,
    PAYLOAD_CORE_ENTRY_RELATIVE_PATH_V2,
  );
  const adapterEntry = resolve(
    canonicalWorkspaceRoot,
    HTTP_ADAPTER_ENTRY_RELATIVE_PATH_V2,
  );
  const runtimeBootstrapEntry = resolve(
    canonicalWorkspaceRoot,
    RUNTIME_BOOTSTRAP_ENTRY_RELATIVE_PATH,
  );
  const runtimeInspectorSource = resolve(
    canonicalWorkspaceRoot,
    RUNTIME_INSPECTOR_SOURCE_RELATIVE_PATH,
  );
  await Promise.all([
    requireDirectRegularFile(gateEntry, "V2 payload admission gate entry"),
    requireDirectRegularFile(coreEntry, "V2 payload core entry"),
    requireDirectRegularFile(adapterEntry, "V2 trusted HTTP adapter entry"),
    requireDirectRegularFile(runtimeBootstrapEntry, "Runtime bootstrap entry"),
    requireDirectRegularFile(
      runtimeInspectorSource,
      "Runtime inspector release addon",
    ),
    ...CORE_REAL_INPUT_RELATIVE_PATHS_V2.map((relativePath) =>
      requireDirectRegularFile(
        resolve(canonicalWorkspaceRoot, relativePath),
        `Reviewed V2 core input ${relativePath}`,
      ),
    ),
  ]);

  let stagingRoot: string | undefined;
  let stagingWitness: DirectoryWitness | undefined;
  let published = false;
  try {
    await assertDirectoryWitness(
      outputParent,
      outputParentWitness,
      "Output parent",
    );
    stagingRoot = await mkdtemp(
      resolve(outputParent, `.${outputLeaf}.building-`),
    );
    stagingWitness = await captureDirectDirectory(
      stagingRoot,
      "Owned staging root",
    );
    if (stagingWitness.stats.dev !== outputParentWitness.stats.dev) {
      throw fail(
        "OUTPUT_INVALID",
        "The staging root and output parent are not on the same filesystem.",
      );
    }
    await input.__testOnlySeam?.afterStagingRootCreated?.(stagingRoot);
    const assertOwnedStaging = async (): Promise<void> => {
      if (stagingRoot === undefined || stagingWitness === undefined) {
        throw fail("OUTPUT_INVALID", "The owned staging root is unavailable.");
      }
      await assertDirectoryWitness(
        outputParent,
        outputParentWitness,
        "Output parent",
      );
      await assertDirectoryWitness(
        stagingRoot,
        stagingWitness,
        "Owned staging root",
      );
    };
    await assertOwnedStaging();
    const packRoot = stagingRoot;
    await Promise.all([
      writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2.split(
            "/",
          ),
        ),
        canonicalBytes(MODULE_METADATA_V2),
      ),
      writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2.split("/"),
        ),
        GRAND_HALL_T554_NATIVE_REVIEW_HTML_V2,
      ),
      writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2.split(
            "/",
          ),
        ),
        GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET_V2,
      ),
      writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2.split(
            "/",
          ),
        ),
        GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT_V2,
      ),
    ]);
    await assertOwnedStaging();

    const baseBuildOptions = {
      absWorkingDir: canonicalWorkspaceRoot,
      bundle: true,
      charset: "utf8",
      conditions: ["import", "node"],
      format: "esm",
      legalComments: "none",
      logLevel: "silent",
      metafile: true,
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      platform: "node",
      sourcemap: false,
      target: ["node22"],
      treeShaking: true,
      write: true,
    } as const;

    await mkdir(resolve(packRoot, "server"), { recursive: true });
    const gateBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [gateEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2.split("/"),
      ),
      plugins: [payloadGateDependencyPluginV2(gateEntry)],
    });
    const coreBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [coreEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2.split("/"),
      ),
      plugins: [
        payloadCoreDependencyPluginV2(canonicalWorkspaceRoot, exactZodEntry),
      ],
    });
    const adapterBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [adapterEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2.split(
          "/",
        ),
      ),
    });
    const runtimeBootstrapBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [runtimeBootstrapEntry],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2.split("/"),
      ),
    });
    await assertOwnedStaging();

    await mkdir(resolve(packRoot, "vendor", "sharp"), { recursive: true });
    const sharpBuild = await esbuild.build({
      ...baseBuildOptions,
      entryPoints: [resolve(sharp.sharpRoot, "dist", "index.mjs")],
      outfile: resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2.split("/"),
      ),
      plugins: [
        sharpLoaderPluginV2(
          sharp.sharpRoot,
          sharp.colourRoot,
          sharp.versions,
        ),
      ],
    });

    const gateExpectedInputs = [
      "t554-v2-fixed-admission-abi-proxy:fixed-admission-abi-proxy.js",
      PAYLOAD_GATE_ENTRY_RELATIVE_PATH_V2,
    ];
    const coreExpectedInputs = [
      ...CORE_REAL_INPUT_RELATIVE_PATHS_V2,
      ...CORE_VIRTUAL_INPUTS_V2,
    ];
    const sharpExpectedInputs = [
      ...SHARP_DIST_INPUT_FILENAMES_V2.map((filename) =>
        normalizedMetafileInput(
          relative(
            canonicalWorkspaceRoot,
            resolve(sharp.sharpRoot, "dist", filename),
          ),
        ),
      ),
      normalizedMetafileInput(
        relative(
          canonicalWorkspaceRoot,
          resolve(sharp.colourRoot, "index.cjs"),
        ),
      ),
      normalizedMetafileInput(
        relative(
          canonicalWorkspaceRoot,
          resolve(sharp.colourRoot, "color.cjs"),
        ),
      ),
      "t554-sharp-native:sharp.mjs",
    ];
    assertExactMetafileInputClosureV2(
      gateBuild,
      gateExpectedInputs,
      "V2 payload admission gate",
    );
    assertExactMetafileInputClosureV2(
      coreBuild,
      coreExpectedInputs,
      "V2 payload core",
    );
    assertExactMetafileInputClosureV2(
      adapterBuild,
      [HTTP_ADAPTER_ENTRY_RELATIVE_PATH_V2],
      "V2 trusted HTTP adapter",
    );
    assertExactMetafileInputClosureV2(
      runtimeBootstrapBuild,
      [RUNTIME_BOOTSTRAP_ENTRY_RELATIVE_PATH],
      "V2 runtime bootstrap",
    );
    assertExactMetafileInputClosureV2(
      sharpBuild,
      sharpExpectedInputs,
      "V2 vendored Sharp loader",
    );

    const gateOutputFacts = moduleOutputFactsV2(
      gateBuild,
      "V2 payload admission gate",
    );
    const coreOutputFacts = moduleOutputFactsV2(
      coreBuild,
      "V2 payload core",
    );
    const httpAdapterOutputFacts = moduleOutputFactsV2(
      adapterBuild,
      "V2 trusted HTTP adapter",
    );
    const runtimeBootstrapOutputFacts = moduleOutputFactsV2(
      runtimeBootstrapBuild,
      "V2 runtime bootstrap",
    );
    const sharpLoaderOutputFacts = moduleOutputFactsV2(
      sharpBuild,
      "V2 vendored Sharp loader",
    );
    assertExactModuleOutputFactsV2(
      gateOutputFacts,
      [
        ...repeatedStaticExternalImportV2(
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ),
        {
          path: GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
          kind: "dynamic-import",
          external: true,
        },
      ],
      [
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_ABI_WITNESS_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_POLICY_V2",
        "loadGrandHallT554NativeReviewPayloadCoreV2",
      ],
      "V2 payload admission gate",
    );
    assertExactModuleOutputFactsV2(
      coreOutputFacts,
      [
        ...repeatedStaticExternalImportV2(
          GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
        ),
        ...repeatedStaticExternalImportV2("node:crypto", 17),
        ...repeatedStaticExternalImportV2("node:fs/promises", 9),
        ...repeatedStaticExternalImportV2("node:path", 11),
        ...repeatedStaticExternalImportV2("node:perf_hooks"),
        ...repeatedStaticExternalImportV2("node:util"),
        ...repeatedStaticExternalImportV2(
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ),
        ...repeatedStaticExternalImportV2(
          GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
        ),
      ],
      [
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2",
        "createGrandHallT554NativeReviewPayloadWorkbenchV2",
      ],
      "V2 payload core",
    );
    assertExactModuleOutputFactsV2(
      httpAdapterOutputFacts,
      [],
      [
        "GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V2",
        "GrandHallT554NativeReviewHttpResponseAdapterErrorV2",
        "bindGrandHallT554NativeReviewTileToHttpResponseV2",
      ],
      "V2 trusted HTTP adapter",
    );
    assertExactModuleOutputFactsV2(
      runtimeBootstrapOutputFacts,
      [
        ...repeatedStaticExternalImportV2("node:crypto"),
        ...repeatedStaticExternalImportV2("node:fs/promises"),
        ...repeatedStaticExternalImportV2("node:module"),
        ...repeatedStaticExternalImportV2("node:path"),
        ...repeatedStaticExternalImportV2("node:url"),
      ],
      ["runGrandHallT554NativeReviewRuntimeBootstrap"],
      "V2 runtime bootstrap",
    );
    assertExactModuleOutputFactsV2(
      sharpLoaderOutputFacts,
      [
        ...repeatedStaticExternalImportV2("node:events"),
        ...repeatedStaticExternalImportV2("node:module"),
        ...repeatedStaticExternalImportV2("node:path", 2),
        ...repeatedStaticExternalImportV2("node:stream"),
        ...repeatedStaticExternalImportV2("node:url"),
        ...repeatedStaticExternalImportV2("node:util"),
      ],
      ["default"],
      "V2 vendored Sharp loader",
    );

    const gateExternalImports = externalImports(gateBuild);
    const coreExternalImports = externalImports(coreBuild);
    const httpAdapterExternalImports = externalImports(adapterBuild);
    const runtimeBootstrapExternalImports = externalImports(
      runtimeBootstrapBuild,
    );
    const sharpLoaderExternalImports = externalImports(sharpBuild);
    assertExactNonBuiltinExternalImportsV2(
      gateExternalImports,
      [
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
      ],
      "V2 payload admission gate",
    );
    assertExactNonBuiltinExternalImportsV2(
      coreExternalImports,
      [
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
      ],
      "V2 payload core",
    );
    assertExactNonBuiltinExternalImportsV2(
      httpAdapterExternalImports,
      [],
      "V2 trusted HTTP adapter",
    );
    assertExactNonBuiltinExternalImportsV2(
      runtimeBootstrapExternalImports,
      [],
      "V2 runtime bootstrap",
    );
    assertExactNonBuiltinExternalImportsV2(
      sharpLoaderExternalImports,
      [],
      "V2 vendored Sharp loader",
    );
    assertMetafileExcludesInput(
      coreBuild,
      "tools/reconstruction-foundry/src/grand-hall-t554-native-review-implementation-manifest.ts",
      "V2 payload core",
    );
    assertMetafileExcludesInput(
      coreBuild,
      "tools/reconstruction-foundry/src/grand-hall-t554-native-review-fixed-admission-abi-v2.ts",
      "V2 payload core",
    );
    assertMetafileExcludesInput(
      gateBuild,
      "tools/reconstruction-foundry/src/grand-hall-t554-native-review-fixed-admission-abi-v2.ts",
      "V2 payload admission gate",
    );

    const gateSource = await readFile(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2.split("/"),
      ),
      "utf8",
    );
    const coreSource = await readFile(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2.split("/"),
      ),
      "utf8",
    );
    const adapterSource = await readFile(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2.split(
          "/",
        ),
      ),
      "utf8",
    );
    assertExactLiteralModuleResolutionV2(
      gateSource,
      [
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
      ],
      "V2 payload admission gate",
    );
    assertExactLiteralModuleResolutionV2(
      coreSource,
      [
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
      ],
      "V2 payload core",
    );
    assertExactLiteralModuleResolutionV2(
      adapterSource,
      [],
      "V2 trusted HTTP adapter",
    );
    assertNoForbiddenV2PayloadCapabilitySurface(
      gateSource,
      "V2 payload admission gate",
    );
    assertNoForbiddenV2PayloadCapabilitySurface(coreSource, "V2 payload core");
    assertNoForbiddenV2PayloadCapabilitySurface(
      adapterSource,
      "V2 trusted HTTP adapter",
    );
    for (const forbidden of [
      "VERIFIED_IMPLEMENTATION_PACK_IDENTITIES",
      "VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_IDENTITIES",
      "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_IDENTITIES",
      "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_PACKS",
      "fixedProductionReviewedPack",
      "verifyGrandHallT554NativeReviewImplementationPack",
      "verifyCallerAnchoredImplementationPackCandidate",
      "__testOnlyGrandHallT554NativeReviewImplementationManifest",
    ]) {
      if (coreSource.includes(forbidden) || gateSource.includes(forbidden)) {
        throw fail(
          "DEPENDENCY_CLOSURE_INVALID",
          `V2 payload retained forbidden V1 verifier or authority symbol ${forbidden}.`,
        );
      }
    }

    const runtimeBootstrapSource = await readFile(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2.split("/"),
      ),
      "utf8",
    );
    assertNoLiteralPackageResolution(
      runtimeBootstrapSource,
      [],
      "V2 runtime bootstrap",
    );
    const sharpLoaderSource = await readFile(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2.split("/"),
      ),
      "utf8",
    );
    assertNoLiteralPackageResolution(
      sharpLoaderSource,
      [],
      "V2 vendored Sharp loader",
    );
    if (
      !sharpLoaderSource.includes("sharp-win32-x64-0.35.3.node") ||
      !sharpLoaderSource.includes("libvips") ||
      /process\.env(?:\[\s*["']PATH["']\s*\]|\.PATH)\s*=/u.test(
        sharpLoaderSource,
      )
    ) {
      throw fail(
        "DEPENDENCY_CLOSURE_INVALID",
        "The v2 vendored Sharp loader does not bind the exact native addon/libvips closure without a PATH fallback.",
      );
    }

    await assertOwnedStaging();
    await mkdir(resolve(packRoot, "vendor", "libvips"), {
      recursive: true,
    });
    await Promise.all([
      copyFile(
        sharp.nativeAddon,
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2.split(
            "/",
          ),
        ),
        fileSystemConstants.COPYFILE_EXCL,
      ),
      copyFile(
        sharp.libvipsDll,
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2.split("/"),
        ),
        fileSystemConstants.COPYFILE_EXCL,
      ),
      copyFile(
        sharp.libvipsCppDll,
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2.split("/"),
        ),
        fileSystemConstants.COPYFILE_EXCL,
      ),
    ]);
    await Promise.all([
      mkdir(resolve(packRoot, "vendor", "runtime-inspector"), {
        recursive: true,
      }),
      mkdir(resolve(packRoot, "vendor", "runtime-attestation"), {
        recursive: true,
      }),
    ]);
    await copyFile(
      runtimeInspectorSource,
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2.split("/"),
      ),
      fileSystemConstants.COPYFILE_EXCL,
    );
    const runtimeProbeBytes = Buffer.from(
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
      "base64",
    );
    try {
      if (
        runtimeProbeBytes.length !== 879 ||
        sha256(runtimeProbeBytes) !== RUNTIME_PROBE_SHA256
      ) {
        throw fail(
          "DEPENDENCY_CLOSURE_INVALID",
          "The fixed runtime-attestation JPEG probe bytes are invalid.",
        );
      }
      await writeExclusive(
        resolve(
          packRoot,
          ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2.split("/"),
        ),
        runtimeProbeBytes,
      );
    } finally {
      runtimeProbeBytes.fill(0);
    }
    await assertOwnedStaging();

    const decoder: GrandHallT554NativeReviewImplementationDecoderClosureV2 = {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-decoder-closure.v1",
      library: "sharp",
      sharpVersion: SHARP_VERSION,
      libvipsVersion: LIBVIPS_VERSION,
      platform: process.platform,
      architecture: process.arch,
      sourceJpegDecoderPipeline: "captured-jpeg-buffer-to-unrotated-rgb8.v1",
      strictMaskPngDecoderPipeline:
        "canonical-grayscale8-source-grid-mask-and-reason-map.v2",
      metadataMember: GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
      sharpRuntimeMembers: [
        GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
      ],
      sharpNativeAddonMember:
        GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
      libvipsNativeDependencyMembers: [
        GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
        GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
      ],
    };
    await writeExclusive(
      resolve(
        packRoot,
        ...GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2.split("/"),
      ),
      canonicalBytes(decoder),
    );

    const relativeMembers = [
      GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
    ].sort();
    const members = await Promise.all(
      relativeMembers.map((relativePath) =>
        memberForV2(packRoot, relativePath),
      ),
    );
    const material: Omit<
      GrandHallT554NativeReviewImplementationManifestV2,
      "semanticSha256"
    > = {
      schemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2,
      implementationId: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      sourceCount: 148,
      authority: "none",
      runtime:
        __testOnlyGrandHallT554NativeReviewImplementationManifest.currentRuntimeIdentity(),
      decoder,
      execution: {
        mode: "compiled-esm-fixed-admission-gated-private-local-review-payload.v2",
        moduleFormat: "esm",
        bindAddress: "127.0.0.1",
        browserTrust: "untrusted-display-and-input",
        dependencyClosure:
          "reviewed-pack-members-node-builtins-and-fixed-admission-capsule.v2",
        entryImportPolicy:
          "fixed-admission-capsule-verifies-entire-pack-before-gate-import.v2",
        standaloneProductionFactoryIncluded: false,
        fixedAdmissionGatedFactoryIncluded: true,
        httpLaunchIncluded: false,
        sourceMapsIncluded: false,
        tsxExecutionAuthorized: false,
        mixedSourceDistResolutionAuthorized: false,
        ambientExternalRuntimeModuleResolutionAuthorized: false,
        fixedAdmissionCapsuleExternalImportRequired: true,
        browserControlledTruthAuthorized: false,
        externalNetworkAuthorized: false,
        acceptanceAuthorized: false,
        reconstructionAuthorized: false,
        runtimeAdmissionAuthorized: false,
        exportAuthorized: false,
        generatedContentAuthorized: false,
      },
      admission: {
        gateModule: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
        coreModule: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
        trustedHttpAdapterModule:
          GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
        runtimeBootstrapModule:
          GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
        documentHtmlMember:
          GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
        stylesheetCssMember:
          GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
        applicationJavascriptMember:
          GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
        fixedAdmissionAbiSchemaVersion:
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2,
        fixedAdmissionCapsuleUrl:
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
      },
      memberCount: members.length,
      totalMemberBytes: members.reduce(
        (total, member) => total + member.byteLength,
        0,
      ),
      members,
    };
    const manifest: GrandHallT554NativeReviewImplementationManifestV2 = {
      ...material,
      semanticSha256:
        __testOnlyGrandHallT554NativeReviewImplementationManifestV2.computeManifestSemanticSha256(
          material as GrandHallT554NativeReviewImplementationManifestV2,
        ),
    };
    const manifestBytes = canonicalBytes(manifest);
    const manifestPath = resolve(
      packRoot,
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
    );
    await writeExclusive(manifestPath, manifestBytes);
    const reviewedAnchorCandidate = {
      manifestSemanticSha256: manifest.semanticSha256,
      manifestFileSha256: sha256(manifestBytes),
      manifestFileByteLength: manifestBytes.length,
    };
    const stagingVerifiedCandidate =
      await __testOnlyGrandHallT554NativeReviewImplementationManifestV2.verifyCandidateWithObservations(
        {
          implementationPackRoot: packRoot,
          reviewedAnchor: reviewedAnchorCandidate,
          runtimeIdentity: manifest.runtime,
          bootstrapExecutionIdentity: {
            compiledJavascriptModule: true,
            execArgv: [],
            nodeOptions: null,
            nodePath: null,
          },
        },
      );
    await assertOwnedStaging();
    await input.__testOnlySeam?.beforeAtomicPublish?.({
      stagingRoot: packRoot,
      outputRoot,
    });
    await assertOwnedStaging();
    await requirePathAbsent(outputRoot, "Output root");
    await rename(packRoot, outputRoot);
    published = true;
    await assertDirectoryWitness(
      outputRoot,
      stagingWitness,
      "Published implementation-payload root",
    );
    await assertDirectoryWitness(
      outputParent,
      outputParentWitness,
      "Output parent",
    );
    await input.__testOnlySeam?.afterAtomicPublish?.({ outputRoot });
    await assertDirectoryWitness(
      outputRoot,
      stagingWitness,
      "Published implementation-payload root",
    );
    const publishedVerifiedCandidate =
      await __testOnlyGrandHallT554NativeReviewImplementationManifestV2.verifyCandidateWithObservations(
        {
          implementationPackRoot: outputRoot,
          reviewedAnchor: reviewedAnchorCandidate,
          runtimeIdentity: manifest.runtime,
          bootstrapExecutionIdentity: {
            compiledJavascriptModule: true,
            execArgv: [],
            nodeOptions: null,
            nodePath: null,
          },
        },
      );
    void stagingVerifiedCandidate;
    return Object.freeze({
      schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2,
      packRoot: outputRoot,
      manifestPath: resolve(
        outputRoot,
        GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
      ),
      manifest,
      reviewedAnchorCandidate,
      verifiedCandidate: publishedVerifiedCandidate,
      gateExternalImports,
      coreExternalImports,
      httpAdapterExternalImports,
      runtimeBootstrapExternalImports,
      sharpLoaderExternalImports,
      gateOutputImports: gateOutputFacts.imports,
      coreOutputImports: coreOutputFacts.imports,
      httpAdapterOutputImports: httpAdapterOutputFacts.imports,
      runtimeBootstrapOutputImports: runtimeBootstrapOutputFacts.imports,
      sharpLoaderOutputImports: sharpLoaderOutputFacts.imports,
      gateExports: gateOutputFacts.exports,
      coreExports: coreOutputFacts.exports,
      httpAdapterExports: httpAdapterOutputFacts.exports,
      runtimeBootstrapExports: runtimeBootstrapOutputFacts.exports,
      sharpLoaderExports: sharpLoaderOutputFacts.exports,
    });
  } catch (error) {
    let cleanupFailure: unknown;
    if (stagingWitness !== undefined) {
      const cleanupPath = published ? outputRoot : stagingRoot;
      if (cleanupPath !== undefined) {
        try {
          const cleaned = await cleanupOwnedDirectory(
            cleanupPath,
            stagingWitness,
          );
          if (!cleaned) {
            cleanupFailure = new Error(
              "Owned v2 implementation-payload bytes could not be removed because the cleanup path changed identity.",
            );
          }
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
      }
    }
    if (cleanupFailure !== undefined) {
      throw fail(
        "CLEANUP_INCOMPLETE",
        "The v2 implementation-payload build failed and its owned bytes could not be proved removed.",
        Object.freeze({ buildFailure: error, cleanupFailure }),
      );
    }
    if (error instanceof GrandHallT554NativeReviewCompiledPackBuilderError) {
      throw error;
    }
    throw fail(
      "BUILD_FAILED",
      "The compiled v2 implementation payload build failed.",
      error,
    );
  }
}

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
  attestGrandHallT554NativeReviewRuntimeCandidateV1,
  GrandHallT554NativeReviewRuntimeAttestationError,
  type GrandHallT554NativeReviewRuntimeAttestationCandidateV1,
} from "./grand-hall-t554-native-review-runtime-attestation.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V1 =
  "venviewer.grand-hall-t554-native-review-compiled-pack-builder.v1";

const SHARP_VERSION = "0.35.3";
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
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
);

const MODULE_METADATA = Object.freeze({
  name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
  private: true,
  type: "module",
  version: "1.0.0",
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
  readonly loader: "js";
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

interface EsbuildMetafileOutput {
  readonly bytes: number;
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
  readonly minifyIdentifiers: false;
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

export interface __GrandHallT554NativeReviewCompiledPackBuildSeamV1 {
  readonly afterStagingRootCreated?: (stagingRoot: string) => Promise<void> | void;
  readonly beforeAtomicPublish?: (facts: {
    readonly stagingRoot: string;
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

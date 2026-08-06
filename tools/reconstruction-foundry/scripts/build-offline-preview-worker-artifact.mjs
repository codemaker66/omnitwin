import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION =
  "omnitwin.reconstruction-foundry.offline-preview-worker-artifact.v1";
const BUILD_GRAPH_SCHEMA_VERSION =
  "omnitwin.reconstruction-foundry.offline-preview-worker-build-graph.v1";
const ESBUILD_VERSION = "0.25.0";
const REQUIRED_NODE_VERSION = "v22.18.0";
const TARGET = "node22.18";
const BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..", "..", "..");
const ENTRY =
  "tools/reconstruction-foundry/src/offline-normalization-preview-container-entry.ts";
const ESBUILD_SHIM =
  `node_modules/.pnpm/esbuild@${ESBUILD_VERSION}/node_modules/esbuild/bin/esbuild`;

const PLATFORM_BINARY = process.platform === "win32" && process.arch === "x64"
  ? `node_modules/.pnpm/@esbuild+win32-x64@${ESBUILD_VERSION}/node_modules/@esbuild/win32-x64/esbuild.exe`
  : null;

const ALLOWED_INPUTS = Object.freeze([
  "node_modules/.pnpm/@gltf-transform+core@4.3.0/node_modules/@gltf-transform/core/dist/index.modern.js",
  "node_modules/.pnpm/@gltf-transform+extensions@4.3.0/node_modules/@gltf-transform/extensions/dist/index.modern.js",
  "node_modules/.pnpm/gltf-validator@2.0.0-dev.3.10/node_modules/gltf-validator/gltf_validator.dart.js",
  "node_modules/.pnpm/gltf-validator@2.0.0-dev.3.10/node_modules/gltf-validator/index.js",
  "node_modules/.pnpm/ktx-parse@1.1.0/node_modules/ktx-parse/dist/ktx-parse.modern.js",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/index.js",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_clusterizer.js",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_decoder.mjs",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_encoder.js",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_simplifier.js",
  "node_modules/.pnpm/meshoptimizer@1.2.0/node_modules/meshoptimizer/meshopt_tangents.js",
  "node_modules/.pnpm/property-graph@4.1.0/node_modules/property-graph/dist/index.mjs",
  "node_modules/.pnpm/zod@3.24.2/node_modules/zod/lib/index.mjs",
  "packages/reconstruction-foundry/src/canonical-json.ts",
  "packages/reconstruction-foundry/src/dsse.ts",
  "packages/reconstruction-foundry/src/errors.ts",
  "packages/reconstruction-foundry/src/hash.ts",
  "packages/reconstruction-foundry/src/normalize-mesh-glb-worker.ts",
  "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.ts",
  "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-worker.ts",
  "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.ts",
  "packages/types/dist/reconstruction-dsse.js",
  ENTRY,
].sort());

const EXPECTED_STATIC_RUNTIME_IMPORTS = Object.freeze([
  "node:crypto",
  "node:url",
]);
const DECLARED_RUNTIME_BUILTINS = Object.freeze([
  "node:crypto",
  "node:module",
  "node:url",
  "url",
]);
const FORBIDDEN_RUNTIME_SPECIFIERS = Object.freeze([
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:vm",
  "node:worker_threads",
]);

function fail(message) {
  throw new Error(`Offline preview worker artifact build blocked: ${message}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("manifest contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("manifest contains an unsupported value");
}

function forwardSlash(value) {
  return value.replaceAll("\\", "/");
}

function systemErrorCode(error) {
  return typeof error === "object" && error !== null &&
      Object.hasOwn(error, "code") && typeof error.code === "string"
    ? error.code
    : null;
}

function repositoryPath(absolutePath) {
  const value = forwardSlash(relative(REPOSITORY_ROOT, absolutePath));
  if (value === "" || value === ".." || value.startsWith("../") || isAbsolute(value)) {
    fail("an input escaped the repository root");
  }
  return value;
}

async function requireRegularFile(relativePath) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  if (repositoryPath(absolutePath) !== relativePath) {
    fail(`non-canonical repository path: ${relativePath}`);
  }
  const status = await lstat(absolutePath);
  if (!status.isFile() || status.isSymbolicLink()) {
    fail(`required build input is not a regular file: ${relativePath}`);
  }
  return absolutePath;
}

function esbuildArguments(outputPath, metafilePath) {
  return [
    resolve(REPOSITORY_ROOT, ESBUILD_SHIM),
    ENTRY,
    "--bundle",
    "--platform=node",
    `--target=${TARGET}`,
    "--format=esm",
    `--banner:js=${BANNER}`,
    `--outfile=${outputPath}`,
    `--metafile=${metafilePath}`,
    "--legal-comments=none",
    "--tree-shaking=true",
    "--minify",
  ];
}

function runBuild(outputPath, metafilePath) {
  execFileSync(process.execPath, esbuildArguments(outputPath, metafilePath), {
    cwd: REPOSITORY_ROOT,
    env: {},
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
}

function arraysEqual(left, right) {
  return left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

async function parseAndAuditMetafile(path, bundleText) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      typeof raw.inputs !== "object" || raw.inputs === null || Array.isArray(raw.inputs) ||
      typeof raw.outputs !== "object" || raw.outputs === null || Array.isArray(raw.outputs)) {
    fail("esbuild metafile shape changed");
  }
  const inputs = Object.keys(raw.inputs).map(forwardSlash).sort();
  if (!arraysEqual(inputs, ALLOWED_INPUTS)) {
    fail("worker dependency graph differs from the reviewed allowlist");
  }
  const outputs = Object.values(raw.outputs);
  if (outputs.length !== 1 || typeof outputs[0] !== "object" || outputs[0] === null ||
      !Array.isArray(outputs[0].imports)) {
    fail("esbuild emitted an unexpected output graph");
  }
  const staticImports = [...new Set(outputs[0].imports.map((entry) =>
    typeof entry === "object" && entry !== null && entry.external === true &&
    typeof entry.path === "string" ? entry.path : fail("unexpected external import record"),
  ))].sort();
  if (!arraysEqual(staticImports, EXPECTED_STATIC_RUNTIME_IMPORTS)) {
    fail("worker static runtime imports differ from the reviewed allowlist");
  }
  for (const specifier of FORBIDDEN_RUNTIME_SPECIFIERS) {
    if (bundleText.includes(`"${specifier}"`) || bundleText.includes(`'${specifier}'`)) {
      fail(`forbidden runtime import present: ${specifier}`);
    }
  }
  if (!bundleText.includes(')("url")')) {
    fail("the reviewed glTF validator dynamic url import marker changed");
  }
  return { inputs, staticImports };
}

async function inputRecords(inputs) {
  const records = [];
  for (const path of inputs) {
    const bytes = await readFile(await requireRegularFile(path));
    records.push(Object.freeze({
      path,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
    }));
    bytes.fill(0);
  }
  return records;
}

async function assertOutputDirectory(outputDirectory) {
  if (!isAbsolute(outputDirectory) || normalize(outputDirectory) !== outputDirectory ||
      resolve(outputDirectory) !== outputDirectory) {
    fail("output directory must be an absolute canonical path");
  }
  let outputExists = false;
  try {
    await access(outputDirectory);
    outputExists = true;
  } catch (error) {
    if (systemErrorCode(error) !== "ENOENT") {
      fail("could not verify that the output directory is absent");
    }
  }
  if (outputExists) {
    fail("output directory already exists");
  }
  const parent = dirname(outputDirectory);
  const parentStatus = await lstat(parent);
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
    fail("output parent must be an existing regular directory");
  }
  return parent;
}

async function main() {
  if (process.argv.length !== 3) {
    fail("provide exactly one absolute output directory");
  }
  if (process.version !== REQUIRED_NODE_VERSION) {
    fail(`build requires ${REQUIRED_NODE_VERSION}; received ${process.version}`);
  }
  if (PLATFORM_BINARY === null) {
    fail(`unqualified builder platform: ${process.platform}/${process.arch}`);
  }
  if (!isAbsolute(process.argv[2])) {
    fail("output directory must be absolute");
  }
  const outputDirectory = resolve(normalize(process.argv[2]));
  const parent = await assertOutputDirectory(outputDirectory);
  const [shimPath, platformBinaryPath] = await Promise.all([
    requireRegularFile(ESBUILD_SHIM),
    requireRegularFile(PLATFORM_BINARY),
    requireRegularFile(ENTRY),
  ]);
  const temporaryRoot = await mkdtemp(join(parent, ".offline-preview-worker-build-"));
  const staging = join(temporaryRoot, "staging");
  const repeat = join(temporaryRoot, "repeat");
  try {
    await Promise.all([mkdir(staging), mkdir(repeat)]);
    const firstBundlePath = join(staging, "worker.mjs");
    const firstMetaPath = join(staging, "metafile.json");
    const repeatBundlePath = join(repeat, "worker.mjs");
    const repeatMetaPath = join(repeat, "metafile.json");
    runBuild(firstBundlePath, firstMetaPath);
    runBuild(repeatBundlePath, repeatMetaPath);
    const [firstBundle, repeatBundle] = await Promise.all([
      readFile(firstBundlePath),
      readFile(repeatBundlePath),
    ]);
    if (!firstBundle.equals(repeatBundle)) {
      firstBundle.fill(0);
      repeatBundle.fill(0);
      fail("two clean builds did not produce identical worker bytes");
    }
    const bundleText = firstBundle.toString("utf8");
    const [firstGraph, repeatGraph] = await Promise.all([
      parseAndAuditMetafile(firstMetaPath, bundleText),
      parseAndAuditMetafile(repeatMetaPath, bundleText),
    ]);
    if (canonicalJson(firstGraph) !== canonicalJson(repeatGraph)) {
      fail("two clean builds did not produce the same dependency graph");
    }
    const [shimBytes, platformBinaryBytes, inputs] = await Promise.all([
      readFile(shimPath),
      readFile(platformBinaryPath),
      inputRecords(firstGraph.inputs),
    ]);
    const graph = Object.freeze({
      schemaVersion: BUILD_GRAPH_SCHEMA_VERSION,
      inputs,
      staticRuntimeImports: firstGraph.staticImports,
      declaredRuntimeBuiltins: DECLARED_RUNTIME_BUILTINS,
      forbiddenRuntimeSpecifiers: FORBIDDEN_RUNTIME_SPECIFIERS,
      dynamicImportReview: Object.freeze({
        package: "gltf-validator@2.0.0-dev.3.10",
        requestedBuiltin: "url",
        createRequireBannerRequired: true,
      }),
    });
    const graphBytes = Buffer.from(`${canonicalJson(graph)}\n`, "utf8");
    const artifact = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      workerKind: "offline_normalization_preview",
      platform: "linux/amd64",
      builder: Object.freeze({
        hostPlatform: `${process.platform}/${process.arch}`,
        nodeVersion: process.version,
        esbuildVersion: ESBUILD_VERSION,
        esbuildShimSha256: sha256(shimBytes),
        esbuildPlatformBinarySha256: sha256(platformBinaryBytes),
        target: TARGET,
        format: "esm",
        createRequireBannerSha256: sha256(Buffer.from(BANNER, "utf8")),
      }),
      workerBundle: Object.freeze({
        path: "/opt/worker/worker.mjs",
        sizeBytes: firstBundle.byteLength,
        sha256: sha256(firstBundle),
      }),
      buildGraph: Object.freeze({
        path: "worker-build-graph.json",
        sizeBytes: graphBytes.byteLength,
        sha256: sha256(graphBytes),
      }),
      repeatability: Object.freeze({
        cleanBuildCount: 2,
        byteIdentical: true,
      }),
    });
    const artifactBytes = Buffer.from(`${canonicalJson(artifact)}\n`, "utf8");
    await Promise.all([
      writeFile(join(staging, "worker-build-graph.json"), graphBytes, {
        flag: "wx",
        mode: 0o444,
      }),
      writeFile(join(staging, "artifact.json"), artifactBytes, {
        flag: "wx",
        mode: 0o444,
      }),
    ]);
    await Promise.all([
      rm(firstMetaPath, { force: false }),
      rm(repeat, { recursive: true, force: false }),
    ]);
    await rename(staging, outputDirectory);
    const summary = Object.freeze({
      outputDirectory,
      workerBundleSha256: artifact.workerBundle.sha256,
      workerBundleSizeBytes: artifact.workerBundle.sizeBytes,
      buildGraphSha256: artifact.buildGraph.sha256,
      artifactManifestSha256: sha256(artifactBytes),
      inputCount: inputs.length,
      repeatBuildsByteIdentical: true,
    });
    process.stdout.write(`${canonicalJson(summary)}\n`);
    firstBundle.fill(0);
    repeatBundle.fill(0);
    shimBytes.fill(0);
    platformBinaryBytes.fill(0);
    graphBytes.fill(0);
    artifactBytes.fill(0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();

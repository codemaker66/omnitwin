import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export const RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS = Object.freeze([
  "package.json",
  "packages/types/package.json",
  "packages/types/tsconfig.build.json",
  "packages/types/tsconfig.json",
  "packages/web/index.html",
  "packages/web/package.json",
  "packages/web/scripts/reception-capture-runtime-build-digest.mjs",
  "packages/web/tsconfig.json",
  "packages/web/vite.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

const RECEPTION_CAPTURE_RUNTIME_SOURCE_ROOTS = Object.freeze([
  "packages/types/dist",
  "packages/types/src",
  "packages/web/src",
]);
const RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DOMAIN =
  "venviewer.reception-capture-runtime-environment.v1\0";
const DEFAULT_MOBILE_FILE_ORIGIN = "http://127.0.0.1:4174";
const TEST_FILE = /\.(?:spec|stories|test)\.[^.]+$/u;

function isCaptureRuntimeSource(repositoryPath, sourceRoot) {
  const segments = repositoryPath.split("/");
  if (segments.includes("__tests__") || segments.includes("__mocks__")) return false;
  if (TEST_FILE.test(segments.at(-1) ?? "")) return false;
  return sourceRoot !== "packages/types/dist" || extname(repositoryPath) === ".js";
}

function collectRuntimeSourceFiles(repositoryRoot, sourceRoot) {
  const sourceDirectory = resolveRepositoryInput(repositoryRoot, sourceRoot);
  if (!lstatSync(sourceDirectory).isDirectory()) {
    throw new Error(`Reception capture source root is not a directory: ${sourceRoot}`);
  }
  const collected = [];
  function visit(absoluteDirectory, repositoryDirectory) {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const repositoryPath = `${repositoryDirectory}/${entry.name}`;
      const absolutePath = resolveRepositoryInput(repositoryRoot, repositoryPath);
      if (entry.isSymbolicLink()) {
        throw new Error(`Reception capture source input must not be linked: ${repositoryPath}`);
      }
      if (entry.isDirectory()) visit(absolutePath, repositoryPath);
      else if (entry.isFile() && isCaptureRuntimeSource(repositoryPath, sourceRoot)) {
        collected.push(repositoryPath);
      }
    }
  }
  visit(sourceDirectory, sourceRoot);
  return collected;
}

export function receptionCaptureRuntimeBuildInputs(repositoryRoot) {
  const discovered = RECEPTION_CAPTURE_RUNTIME_SOURCE_ROOTS.flatMap(
    (sourceRoot) => collectRuntimeSourceFiles(repositoryRoot, sourceRoot),
  );
  return Object.freeze([...RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS, ...discovered]
    .sort(compareRepositoryPaths));
}

function compareRepositoryPaths(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertSortedUniqueInputs(inputs) {
  const sorted = [...inputs].sort(compareRepositoryPaths);
  if (new Set(inputs).size !== inputs.length) {
    throw new Error("Reception capture build inputs must not contain duplicate paths.");
  }
  if (inputs.some((input, index) => input !== sorted[index])) {
    throw new Error(
      "Reception capture build inputs must be sorted by repository path.",
    );
  }
}

function resolveRepositoryInput(repositoryRoot, repositoryPath) {
  if (isAbsolute(repositoryPath) || repositoryPath === "") {
    throw new Error(
      `Reception capture build input must be a repository-relative path: ${repositoryPath}`,
    );
  }
  const absoluteRoot = resolve(repositoryRoot);
  const absoluteInput = resolve(absoluteRoot, repositoryPath);
  const fromRoot = relative(absoluteRoot, absoluteInput);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(
      `Reception capture build input leaves the repository: ${repositoryPath}`,
    );
  }
  return absoluteInput;
}

function readRequiredInput(repositoryRoot, repositoryPath) {
  const absoluteInput = resolveRepositoryInput(repositoryRoot, repositoryPath);
  try {
    if (!lstatSync(absoluteInput).isFile()) {
      throw new Error("input is not a regular file");
    }
    return readFileSync(absoluteInput);
  } catch (cause) {
    throw new Error(
      `Cannot fingerprint required Reception capture build input: ${repositoryPath}`,
      { cause },
    );
  }
}

function readRequiredJson(repositoryRoot, repositoryPath) {
  try {
    return JSON.parse(readRequiredInput(repositoryRoot, repositoryPath).toString("utf8"));
  } catch (cause) {
    throw new Error(
      `Cannot parse required Reception capture JSON input: ${repositoryPath}`,
      { cause },
    );
  }
}

export function assertReceptionCaptureRuntimeVersions(repositoryRoot) {
  const packageJson = readRequiredJson(repositoryRoot, "packages/web/package.json");
  const binding = readRequiredJson(
    repositoryRoot,
    "packages/web/src/pages/living-hall/reception-capture-binding-v1.json",
  );
  const packages = [
    ["three", "three", "dependencies", "packages/web/node_modules/three/package.json"],
    ["spark", "@sparkjsdev/spark", "dependencies", "packages/web/node_modules/@sparkjsdev/spark/package.json"],
    ["reactThreeFiber", "@react-three/fiber", "dependencies", "packages/web/node_modules/@react-three/fiber/package.json"],
    ["vite", "vite", "devDependencies", "packages/web/node_modules/vite/package.json"],
    ["viteReactPlugin", "@vitejs/plugin-react", "devDependencies", "packages/web/node_modules/@vitejs/plugin-react/package.json"],
    ["playwrightTest", "@playwright/test", "devDependencies", "packages/web/node_modules/@playwright/test/package.json"],
  ];
  for (const [key, packageName, declarationGroup, installedPath] of packages) {
    const installed = readRequiredJson(repositoryRoot, installedPath);
    const lockedVersion = binding.lockedRuntimeVersions?.[key];
    const declaredVersion = packageJson[declarationGroup]?.[packageName];
    if (
      typeof lockedVersion !== "string"
      || declaredVersion !== lockedVersion
      || installed.name !== packageName
      || installed.version !== lockedVersion
    ) {
      throw new Error(`Reception capture runtime version does not match its lock: ${key}`);
    }
  }
}

function normalizedRuntimeOrigin(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new Error(`Reception capture runtime ${label} must be a string.`);
  }
  const candidate = value.trim();
  if (candidate === "") return fallback;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `Reception capture runtime ${label} must be an explicit 127.0.0.1 HTTP port.`,
    );
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || !Number.isInteger(port)
    || port < 1_024
    || port > 65_535
  ) {
    throw new Error(
      `Reception capture runtime ${label} must be an explicit 127.0.0.1 HTTP port.`,
    );
  }
  return url.origin;
}

export function receptionCaptureRuntimeEnvironment(environment = {}) {
  return Object.freeze({
    mobileOrigin: normalizedRuntimeOrigin(
      environment.VITE_RECEPTION_MOBILE_ORIGIN,
      DEFAULT_MOBILE_FILE_ORIGIN,
      "mobile origin",
    ),
    qualityOrigin: normalizedRuntimeOrigin(
      environment.VITE_RECEPTION_QUALITY_ORIGIN,
      "",
      "quality origin",
    ),
  });
}

export function computeReceptionCaptureRuntimeEnvironmentDigest(environment = {}) {
  const manifest = JSON.stringify(receptionCaptureRuntimeEnvironment(environment));
  return createHash("sha256")
    .update(RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DOMAIN, "utf8")
    .update(manifest, "utf8")
    .digest("hex");
}

export function computeFileSetSha256(repositoryRoot, inputs) {
  assertSortedUniqueInputs(inputs);
  const entries = inputs.map((repositoryPath) => {
    const bytes = readRequiredInput(repositoryRoot, repositoryPath);
    return {
      path: repositoryPath,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const manifest = JSON.stringify({
    schemaVersion: "venviewer.reception-capture-runtime-build.v1",
    entries,
  });
  return createHash("sha256").update(manifest, "utf8").digest("hex");
}

export function computeReceptionCaptureRuntimeBuildDigest(repositoryRoot) {
  assertReceptionCaptureRuntimeVersions(repositoryRoot);
  return computeFileSetSha256(
    repositoryRoot,
    receptionCaptureRuntimeBuildInputs(repositoryRoot),
  );
}

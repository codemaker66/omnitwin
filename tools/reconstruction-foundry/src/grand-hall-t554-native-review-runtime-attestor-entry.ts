import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import {
  createRequire,
  isBuiltin,
  syncBuiltinESMExports,
} from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
  verifyGrandHallT554NativeReviewImplementationPackCandidateV1,
  type GrandHallT554ImplementationSha256,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
} from "./grand-hall-t554-native-review-implementation-manifest.js";

const MAXIMUM_MANIFEST_BYTES = 512 * 1_024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVIEWED_NATIVE_MEMBERS = Object.freeze([
  "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node",
  "vendor/sharp/sharp-win32-x64-0.35.3.node",
  "vendor/libvips/libvips-42.dll",
  "vendor/libvips/libvips-cpp-8.18.3.dll",
] as const);
const REVIEWED_COMMONJS_NATIVE_MEMBERS = Object.freeze([
  REVIEWED_NATIVE_MEMBERS[0],
  REVIEWED_NATIVE_MEMBERS[1],
] as const);
const REVIEWED_NATIVE_MEMBER_SET_SHA256 =
  "sha256:fdc9e7a4870e09596b0d2f46094a1f7349c49476428f8da02927261e4c1e0d25";

interface BootstrapObservation {
  readonly schemaVersion:
    "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1";
  readonly sharpVersion: "0.35.3";
  readonly libvipsVersion: "8.18.3";
  readonly probe: {
    readonly byteLength: 879;
    readonly sha256:
      "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078";
    readonly width: 3;
    readonly height: 2;
    readonly channels: 3;
    readonly decodedRgbByteLength: 18;
    readonly decodedRgbSha256:
      "sha256:a288b3c068b98e427b04229ade2ebd0e0fd65106d8d1fc77e03794878cce90be";
  };
  readonly loadedModuleCount: number;
  readonly loadedReviewedNativeMembers: typeof REVIEWED_NATIVE_MEMBERS;
  readonly loadedReviewedNativeMemberSetSha256: typeof REVIEWED_NATIVE_MEMBER_SET_SHA256;
  readonly targetNativeModulesAbsentBeforeSharpImport: true;
  readonly exactReviewedNativeModuleMultiplicityVerified: true;
  readonly loadedModuleInventoryStableAcrossDecode: true;
  readonly loadedModuleInventoryStableAfterDllDirectoryRemoval: true;
  readonly dllDirectoryConfiguredBeforeSharpImport: true;
  readonly dllDirectoryRevalidatedBeforeSharpImport: true;
  readonly dllDirectoryRevalidatedAfterDecode: true;
  readonly dllDirectoryRemoved: true;
  readonly authority: "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = expected.slice().sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function sha256(bytes: Buffer): GrandHallT554ImplementationSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function comparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32"
    ? normalized.replaceAll("/", "\\").toLowerCase()
    : normalized;
}

function clearEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!Reflect.deleteProperty(process.env, key)) {
      throw new Error("child environment entry could not be cleared");
    }
  }
  if (Object.keys(process.env).length !== 0) {
    throw new Error("child environment could not be cleared");
  }
}

function secureSelectedNetworkEntrypointsAndCommonJsResolution(
  allowedAbsoluteRequests: ReadonlySet<string>,
): void {
  const require = createRequire(import.meta.url);
  const denied = (): never => {
    throw new Error("network access is disabled in the runtime attestor");
  };
  const patchFunctions = (specifier: string, names: readonly string[]): void => {
    const loaded = require(specifier) as unknown;
    if ((typeof loaded !== "object" || loaded === null) && typeof loaded !== "function") {
      throw new Error("network builtin could not be secured");
    }
    for (const name of names) {
      if (!(name in loaded) || typeof loaded[name as keyof typeof loaded] !== "function") {
        continue;
      }
      Object.defineProperty(loaded, name, {
        configurable: false,
        enumerable: true,
        value: denied,
        writable: false,
      });
    }
  };
  patchFunctions("node:net", ["connect", "createConnection", "createServer"]);
  patchFunctions("node:tls", ["connect", "createServer"]);
  patchFunctions("node:http", ["get", "request", "createServer"]);
  patchFunctions("node:https", ["get", "request", "createServer"]);
  patchFunctions("node:http2", ["connect", "createServer", "createSecureServer"]);
  patchFunctions("node:dgram", ["createSocket"]);
  patchFunctions("node:dns", ["lookup", "resolve", "resolve4", "resolve6", "reverse"]);
  Object.defineProperty(globalThis, "fetch", {
    configurable: false,
    value: denied,
    writable: false,
  });
  if ("WebSocket" in globalThis) {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: false,
      value: denied,
      writable: false,
    });
  }
  syncBuiltinESMExports();

  const moduleApi = require("node:module") as unknown;
  if (
    (typeof moduleApi !== "object" || moduleApi === null) &&
    typeof moduleApi !== "function"
  ) {
    throw new Error("module resolver could not be secured");
  }
  if (!("_resolveFilename" in moduleApi) || typeof moduleApi._resolveFilename !== "function") {
    throw new Error("module resolver is unavailable");
  }
  const originalResolve = moduleApi._resolveFilename;
  Object.defineProperty(moduleApi, "_resolveFilename", {
    configurable: false,
    value: function guardedResolve(
      this: unknown,
      request: unknown,
      ...rest: readonly unknown[]
    ): unknown {
      if (typeof request !== "string") {
        throw new Error("external runtime module resolution is disabled");
      }
      if (!isBuiltin(request)) {
        if (
          !isAbsolute(request) ||
          !allowedAbsoluteRequests.has(comparablePath(request))
        ) {
          throw new Error("external runtime module resolution is disabled");
        }
      }
      return Reflect.apply(originalResolve, this, [request, ...rest]);
    },
    writable: false,
  });
}

async function deriveSelfCandidateAnchor(packRoot: string): Promise<{
  readonly manifestSemanticSha256: GrandHallT554ImplementationSha256;
  readonly manifestFileSha256: GrandHallT554ImplementationSha256;
  readonly manifestFileByteLength: number;
}> {
  const bytes = await readFile(
    resolve(packRoot, GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME),
  );
  try {
    if (bytes.length < 1 || bytes.length > MAXIMUM_MANIFEST_BYTES) {
      throw new Error("manifest byte length is invalid");
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.semanticSha256 !== "string" ||
      !SHA256_PATTERN.test(parsed.semanticSha256)
    ) {
      throw new Error("manifest candidate anchor is invalid");
    }
    return Object.freeze({
      manifestSemanticSha256:
        parsed.semanticSha256 as GrandHallT554ImplementationSha256,
      manifestFileSha256: sha256(bytes),
      manifestFileByteLength: bytes.length,
    });
  } finally {
    bytes.fill(0);
  }
}

function sameCandidateBinding(
  left: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
  right: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
): boolean {
  return (
    JSON.stringify(left.manifestBinding) === JSON.stringify(right.manifestBinding) &&
    left.memberInventorySha256 === right.memberInventorySha256 &&
    left.memberCount === right.memberCount &&
    left.totalMemberBytes === right.totalMemberBytes
  );
}

function requireBootstrapObservation(value: unknown): BootstrapObservation {
  const probe = isRecord(value) ? value.probe : undefined;
  const loadedMembers = isRecord(value)
    ? value.loadedReviewedNativeMembers
    : undefined;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "authority",
      "dllDirectoryConfiguredBeforeSharpImport",
      "dllDirectoryRevalidatedAfterDecode",
      "dllDirectoryRevalidatedBeforeSharpImport",
      "dllDirectoryRemoved",
      "exactReviewedNativeModuleMultiplicityVerified",
      "libvipsVersion",
      "loadedModuleInventoryStableAcrossDecode",
      "loadedModuleInventoryStableAfterDllDirectoryRemoval",
      "loadedModuleCount",
      "loadedReviewedNativeMemberSetSha256",
      "loadedReviewedNativeMembers",
      "probe",
      "schemaVersion",
      "sharpVersion",
      "targetNativeModulesAbsentBeforeSharpImport",
    ]) ||
    value.schemaVersion !==
      "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1" ||
    value.sharpVersion !== "0.35.3" ||
    value.libvipsVersion !== "8.18.3" ||
    typeof value.loadedModuleCount !== "number" ||
    !Number.isSafeInteger(value.loadedModuleCount) ||
    value.loadedModuleCount < REVIEWED_NATIVE_MEMBERS.length ||
    value.loadedModuleCount > 4_096 ||
    value.loadedReviewedNativeMemberSetSha256 !==
      REVIEWED_NATIVE_MEMBER_SET_SHA256 ||
    !Array.isArray(loadedMembers) ||
    loadedMembers.length !== REVIEWED_NATIVE_MEMBERS.length ||
    loadedMembers.some(
      (member, index) => member !== REVIEWED_NATIVE_MEMBERS[index],
    ) ||
    !isRecord(probe) ||
    !hasExactKeys(probe, [
      "byteLength",
      "channels",
      "decodedRgbByteLength",
      "decodedRgbSha256",
      "height",
      "sha256",
      "width",
    ]) ||
    probe.byteLength !== 879 ||
    probe.sha256 !==
      "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078" ||
    probe.width !== 3 ||
    probe.height !== 2 ||
    probe.channels !== 3 ||
    probe.decodedRgbByteLength !== 18 ||
    probe.decodedRgbSha256 !==
      "sha256:a288b3c068b98e427b04229ade2ebd0e0fd65106d8d1fc77e03794878cce90be" ||
    value.authority !== "none" ||
    value.targetNativeModulesAbsentBeforeSharpImport !== true ||
    value.exactReviewedNativeModuleMultiplicityVerified !== true ||
    value.loadedModuleInventoryStableAcrossDecode !== true ||
    value.loadedModuleInventoryStableAfterDllDirectoryRemoval !== true ||
    value.dllDirectoryConfiguredBeforeSharpImport !== true ||
    value.dllDirectoryRevalidatedBeforeSharpImport !== true ||
    value.dllDirectoryRevalidatedAfterDecode !== true ||
    value.dllDirectoryRemoved !== true
  ) {
    throw new Error("runtime bootstrap observation is invalid");
  }
  const observation: BootstrapObservation = Object.freeze({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-runtime-bootstrap-observation.v1",
    sharpVersion: "0.35.3",
    libvipsVersion: "8.18.3",
    probe: Object.freeze({
      byteLength: 879,
      sha256:
        "sha256:3d1e13e141be146ebaeac81e114e0609dfa6cfdc8516fe0adc039c4584c54078",
      width: 3,
      height: 2,
      channels: 3,
      decodedRgbByteLength: 18,
      decodedRgbSha256:
        "sha256:a288b3c068b98e427b04229ade2ebd0e0fd65106d8d1fc77e03794878cce90be",
    }),
    loadedModuleCount: value.loadedModuleCount,
    loadedReviewedNativeMembers: REVIEWED_NATIVE_MEMBERS,
    loadedReviewedNativeMemberSetSha256: REVIEWED_NATIVE_MEMBER_SET_SHA256,
    targetNativeModulesAbsentBeforeSharpImport: true,
    exactReviewedNativeModuleMultiplicityVerified: true,
    loadedModuleInventoryStableAcrossDecode: true,
    loadedModuleInventoryStableAfterDllDirectoryRemoval: true,
    dllDirectoryConfiguredBeforeSharpImport: true,
    dllDirectoryRevalidatedBeforeSharpImport: true,
    dllDirectoryRevalidatedAfterDecode: true,
    dllDirectoryRemoved: true,
    authority: "none",
  });
  return observation;
}

function isBootstrapRunner(value: unknown): value is () => Promise<unknown> {
  return typeof value === "function";
}

async function main(): Promise<Readonly<Record<string, unknown>>> {
  if (process.argv.length !== 2 || process.execArgv.length !== 0) {
    throw new Error("runtime attestor process arguments are not exact");
  }
  clearEnvironment();

  const attestorPath = await realpath(fileURLToPath(import.meta.url));
  const packRoot = await realpath(resolve(dirname(attestorPath), ".."));
  const invokedEntry = process.argv[1];
  if (invokedEntry === undefined) {
    throw new Error("runtime attestor entry argument is missing");
  }
  const [invokedEntryPath, workingDirectory] = await Promise.all([
    realpath(invokedEntry),
    realpath(process.cwd()),
  ]);
  if (
    comparablePath(invokedEntryPath) !== comparablePath(attestorPath) ||
    comparablePath(workingDirectory) !== comparablePath(packRoot)
  ) {
    throw new Error("runtime attestor invocation is not exact");
  }
  const expectedAttestorPath = await realpath(
    resolve(packRoot, ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER.split("/")),
  );
  if (
    attestorPath.toLocaleLowerCase("en-US") !==
    expectedAttestorPath.toLocaleLowerCase("en-US")
  ) {
    throw new Error("runtime attestor path is not exact");
  }
  const allowedAbsoluteCommonJsRequests = new Set<string>();
  for (const member of REVIEWED_COMMONJS_NATIVE_MEMBERS) {
    const canonicalMemberPath = await realpath(
      resolve(packRoot, ...member.split("/")),
    );
    allowedAbsoluteCommonJsRequests.add(comparablePath(canonicalMemberPath));
  }
  secureSelectedNetworkEntrypointsAndCommonJsResolution(
    allowedAbsoluteCommonJsRequests,
  );

  const reviewedAnchor = await deriveSelfCandidateAnchor(packRoot);
  const preImport = await verifyGrandHallT554NativeReviewImplementationPackCandidateV1({
    implementationPackRoot: packRoot,
    reviewedAnchor,
  });
  const bootstrapPath = await realpath(
    resolve(packRoot, ...GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER.split("/")),
  );
  const bootstrapModule = (await import(pathToFileURL(bootstrapPath).href)) as {
    readonly runGrandHallT554NativeReviewRuntimeBootstrap?: unknown;
  };
  const bootstrapRunner =
    bootstrapModule.runGrandHallT554NativeReviewRuntimeBootstrap;
  if (!isBootstrapRunner(bootstrapRunner)) {
    throw new Error("runtime bootstrap entry is invalid");
  }
  const bootstrap = requireBootstrapObservation(
    await bootstrapRunner(),
  );
  const postImport = await verifyGrandHallT554NativeReviewImplementationPackCandidateV1({
    implementationPackRoot: packRoot,
    reviewedAnchor,
  });
  if (!sameCandidateBinding(preImport, postImport)) {
    throw new Error("implementation pack changed across runtime import");
  }

  return Object.freeze({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-runtime-attestation-child-observation.v1",
    manifestBinding: postImport.manifestBinding,
    memberInventorySha256: postImport.memberInventorySha256,
    memberCount: postImport.memberCount,
    totalMemberBytes: postImport.totalMemberBytes,
    runtime: postImport.manifest.runtime,
    bootstrap,
    processIsolation: Object.freeze({
      freshChildProcess: true,
      execArgvEmpty: true,
      environmentCleared: true,
      cwdBoundToPackRoot: true,
      entryArgvBoundToAttestor: true,
      commonJsResolutionRestrictedToBuiltinsAndExactReviewedNativeAddons: true,
      selectedNetworkEntrypointsPatched: true,
      dynamicEsmImportsBoundToExactPackMembers: true,
      postImportPackReverified: true,
    }),
    authority: "none",
    productionRuntimeAuthorityMinted: false,
  });
}

void main().then(
  (observation) => {
    process.stdout.write(`${JSON.stringify(observation)}\n`);
  },
  () => {
    process.stderr.write("T554_RUNTIME_ATTESTATION_FAILED\n");
    process.exitCode = 1;
  },
);

import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  posix,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder, types as utilTypes } from "node:util";
import { OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL } from
  "./offline-preview-image-context-production-approval.generated.mjs";

const IMAGE_CONTEXT_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-image-context.v1";
const WORKER_ARTIFACT_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-worker-artifact.v1";
const WORKER_BUILD_GRAPH_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-worker-build-graph.v1";
const CONTAINER_CONFIGURATION_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-container.v2";
const WIRE_SOURCE_PATH =
  "packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.ts";
const WORKER_PROTOCOL_DERIVATION =
  "reviewed_wire_protocol_source_sha256";
const PRODUCTION_APPROVAL_SCHEMA =
  "omnitwin.reconstruction-foundry.offline-preview-image-context-production-approval.v1";
const TEST_ONLY_APPROVAL_KIND = "__testOnly_non_authoritative_approval";
const REQUIRED_NODE_VERSION = "v22.18.0";
const REQUIRED_ESBUILD_VERSION = "0.25.0";
const MAXIMUM_RUNTIME_MILLISECONDS = 60_000;
const USER_ID = 10_001;
const GROUP_ID = 10_001;
const NODE_ARTIFACT_LABEL =
  "io.omnitwin.foundry.runtime.node-artifact-sha256";
const APPROVAL_SCOPE_LABEL =
  "io.omnitwin.foundry.approval.scope";
const QUALIFICATION_STATUS_LABEL =
  "io.omnitwin.foundry.qualification.status";

const INPUT_KEYS = Object.freeze([
  "workerArtifactDirectory",
  "nodeBinaryPath",
  "busyBoxBinaryPath",
  "seccompProfilePath",
  "outputDirectory",
]);
const ARTIFACT_KEYS = Object.freeze([
  "schemaVersion",
  "workerKind",
  "platform",
  "builder",
  "workerBundle",
  "buildGraph",
  "repeatability",
]);
const BUILDER_KEYS = Object.freeze([
  "hostPlatform",
  "nodeVersion",
  "esbuildVersion",
  "esbuildShimSha256",
  "esbuildPlatformBinarySha256",
  "target",
  "format",
  "createRequireBannerSha256",
]);
const BYTE_BINDING_KEYS = Object.freeze(["path", "sizeBytes", "sha256"]);
const REPEATABILITY_KEYS = Object.freeze(["cleanBuildCount", "byteIdentical"]);
const GRAPH_KEYS = Object.freeze([
  "schemaVersion",
  "inputs",
  "staticRuntimeImports",
  "declaredRuntimeBuiltins",
  "forbiddenRuntimeSpecifiers",
  "dynamicImportReview",
]);
const GRAPH_INPUT_KEYS = Object.freeze(["path", "sizeBytes", "sha256"]);
const DYNAMIC_IMPORT_REVIEW_KEYS = Object.freeze([
  "package",
  "requestedBuiltin",
  "createRequireBannerRequired",
]);
const APPROVAL_KEYS = Object.freeze([
  "schemaVersion",
  "approvalKind",
  "artifactManifestSha256",
  "buildGraphSha256",
  "workerBundleSha256",
  "seccompProfileSha256",
  "buildGraphInputs",
]);
const TEST_ONLY_OPTIONS_KEYS = Object.freeze([
  "__testOnlyFailureAfterFileCount",
  "__testOnlyBeforePublication",
  "__testOnlyAfterRenameBeforeVerification",
  "__testOnlyAllowBestAvailablePublication",
]);

const FIXED_ENTRYPOINT = Object.freeze([
  "/bin/busybox",
  "timeout",
  "-s",
  "KILL",
  "60s",
  "/usr/local/bin/node",
  "--no-warnings",
  "--experimental-permission",
  "--allow-fs-read=/opt/worker/worker.mjs",
  "--no-addons",
  "--max-old-space-size=512",
  "/opt/worker/worker.mjs",
]);
const SAFE_ENVIRONMENT = Object.freeze([
  "HOME=/nonexistent",
  "TMPDIR=/nonexistent",
  "XDG_CACHE_HOME=/nonexistent",
  "NODE_ENV=production",
  "TZ=UTC",
]);
const IMAGE_LABELS = Object.freeze({
  workerKind: "io.omnitwin.foundry.worker.kind",
  workerProtocolSha256:
    "io.omnitwin.foundry.worker.protocol-sha256",
  workerArtifactSha256:
    "io.omnitwin.foundry.worker.artifact-sha256",
  seccompProfileSha256:
    "io.omnitwin.foundry.worker.seccomp-profile-sha256",
  watchdogArtifactSha256:
    "io.omnitwin.foundry.worker.watchdog-artifact-sha256",
  watchdogMaximumRuntimeMilliseconds:
    "io.omnitwin.foundry.worker.watchdog-maximum-runtime-ms",
  nodeArtifactSha256: NODE_ARTIFACT_LABEL,
  approvalScope: APPROVAL_SCOPE_LABEL,
  qualificationStatus: QUALIFICATION_STATUS_LABEL,
});
const STATIC_RUNTIME_IMPORTS = Object.freeze(["node:crypto", "node:url"]);
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
const FORBIDDEN_SECCOMP_SYSCALLS = new Set([
  "socket",
  "socketpair",
  "mount",
  "umount2",
  "ptrace",
  "bpf",
  "unshare",
  "setns",
]);
const REJECTED_SECCOMP_SYSCALL_REFERENCES = new Set([
  "clone3",
  "fsopen",
  "fsconfig",
  "fsmount",
  "move_mount",
  "open_tree",
  "mount_setattr",
  "io_uring_setup",
  "io_uring_enter",
  "io_uring_register",
  "open_by_handle_at",
  "name_to_handle_at",
  "userfaultfd",
  "perf_event_open",
  "keyctl",
  "add_key",
  "request_key",
]);
const DENYING_SECCOMP_ACTIONS = new Set([
  "SCMP_ACT_ERRNO",
  "SCMP_ACT_KILL",
  "SCMP_ACT_KILL_PROCESS",
  "SCMP_ACT_KILL_THREAD",
  "SCMP_ACT_TRAP",
]);
const SECCOMP_TOP_LEVEL_KEYS = new Set([
  "defaultAction",
  "defaultErrnoRet",
  "architectures",
  "syscalls",
  "flags",
]);
const SECCOMP_RULE_KEYS = new Set([
  "names",
  "action",
  "args",
  "errnoRet",
  "comment",
]);
const SECCOMP_ARGUMENT_KEYS = new Set([
  "index",
  "value",
  "valueTwo",
  "op",
]);
const SECCOMP_COMPARISON_OPERATORS = new Set([
  "SCMP_CMP_NE",
  "SCMP_CMP_LT",
  "SCMP_CMP_LE",
  "SCMP_CMP_EQ",
  "SCMP_CMP_GE",
  "SCMP_CMP_GT",
  "SCMP_CMP_MASKED_EQ",
]);
const UNSAFE_CLONE_NAMESPACE_FLAGS =
  0x0000_0080 | 0x0002_0000 | 0x0200_0000 | 0x0400_0000 |
  0x0800_0000 | 0x1000_0000 | 0x2000_0000 | 0x4000_0000;

const MAXIMUM_BYTES = Object.freeze({
  artifact: 1024 * 1024,
  buildGraph: 16 * 1024 * 1024,
  worker: 64 * 1024 * 1024,
  node: 256 * 1024 * 1024,
  busyBox: 32 * 1024 * 1024,
  seccomp: 1024 * 1024,
});
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const HOST_PLATFORM = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const BUILD_INPUT_SET_DOMAIN =
  "OMNITWIN_RECONSTRUCTION_FOUNDRY_OFFLINE_PREVIEW_IMAGE_BUILD_INPUT_SET_V1";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`Offline preview image context generation blocked: ${message}`);
}

function systemErrorCode(error) {
  return typeof error === "object" && error !== null &&
      Object.hasOwn(error, "code") && typeof error.code === "string"
    ? error.code
    : null;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("a generated manifest value was non-finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("a generated manifest value had an unsupported type");
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor &&
      descriptor.enumerable === true;
  });
}

function isDenseArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function arraysEqual(left, right) {
  return left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

function snapshotInput(input) {
  if (typeof input === "object" && input !== null && utilTypes.isProxy(input)) {
    fail("input Proxy objects are not accepted");
  }
  if (!hasExactDataKeys(input, INPUT_KEYS)) {
    fail("input must use exactly the five own enumerable data properties");
  }
  const snapshot = {};
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor) ||
        typeof descriptor.value !== "string" || descriptor.value.length === 0) {
      fail(`input property ${key} must be a non-empty string data value`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function isWindowsUncOrDevicePath(path) {
  return /^[\\/]{2}/u.test(path) || /^\\(?:\?\?|Device)\\/iu.test(path);
}

function assertCanonicalAbsolutePath(path, label) {
  if (isWindowsUncOrDevicePath(path)) {
    fail(`${label} must not use a Windows UNC or device path`);
  }
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    fail(`${label} must be an absolute canonical path`);
  }
}

function statusesMatch(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.mode === right.mode;
}

async function requireStableDirectory(path, label) {
  assertCanonicalAbsolutePath(path, label);
  const before = await lstat(path, { bigint: true });
  if (before.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!before.isDirectory()) fail(`${label} must be a regular directory`);
  if (await realpath(path) !== path) fail(`${label} must resolve to itself`);
  const after = await lstat(path, { bigint: true });
  if (!statusesMatch(before, after)) fail(`${label} changed while it was inspected`);
}

function validateFileStatus(status, label, maximumBytes) {
  if (status.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!status.isFile()) fail(`${label} must be a regular file`);
  if (status.size <= 0n || status.size > BigInt(maximumBytes)) {
    fail(`${label} must contain 1-${String(maximumBytes)} bytes`);
  }
}

async function readStableRegularFile(path, label, maximumBytes) {
  assertCanonicalAbsolutePath(path, label);
  const pathBefore = await lstat(path, { bigint: true });
  validateFileStatus(pathBefore, label, maximumBytes);
  if (await realpath(path) !== path) fail(`${label} must resolve to itself`);
  const handle = await open(path, fsConstants.O_RDONLY);
  let bytes;
  try {
    const handleBefore = await handle.stat({ bigint: true });
    validateFileStatus(handleBefore, label, maximumBytes);
    if (!statusesMatch(pathBefore, handleBefore)) {
      fail(`${label} changed before it could be read`);
    }
    bytes = await handle.readFile();
    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    validateFileStatus(pathAfter, label, maximumBytes);
    if (bytes.byteLength !== Number(handleAfter.size) ||
        !statusesMatch(handleBefore, handleAfter) ||
        !statusesMatch(handleAfter, pathAfter)) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    await handle.close();
  }
}

function decodeJson(bytes, label) {
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function requireCanonicalJsonDocument(bytes, value, label) {
  const canonical = canonicalBytes(value);
  try {
    if (!bytes.equals(canonical)) fail(`${label} is not canonical JSON`);
  } finally {
    canonical.fill(0);
  }
}

function isDigest(value) {
  return typeof value === "string" && SHA256.test(value);
}

function isPositiveSafeInteger(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validateByteBinding(value, expectedPath, maximumBytes, label) {
  if (!hasExactDataKeys(value, BYTE_BINDING_KEYS) ||
      value.path !== expectedPath ||
      !isPositiveSafeInteger(value.sizeBytes, maximumBytes) ||
      !isDigest(value.sha256)) {
    fail(`${label} is invalid`);
  }
  return Object.freeze({
    path: value.path,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
  });
}

function validateBuilder(value) {
  if (!hasExactDataKeys(value, BUILDER_KEYS) ||
      typeof value.hostPlatform !== "string" ||
      !HOST_PLATFORM.test(value.hostPlatform) ||
      value.nodeVersion !== REQUIRED_NODE_VERSION ||
      value.esbuildVersion !== REQUIRED_ESBUILD_VERSION ||
      !isDigest(value.esbuildShimSha256) ||
      !isDigest(value.esbuildPlatformBinarySha256) ||
      value.target !== "node22.18" || value.format !== "esm" ||
      !isDigest(value.createRequireBannerSha256)) {
    fail("worker artifact builder record is invalid");
  }
  return Object.freeze({
    hostPlatform: value.hostPlatform,
    nodeVersion: value.nodeVersion,
    esbuildVersion: value.esbuildVersion,
    esbuildShimSha256: value.esbuildShimSha256,
    esbuildPlatformBinarySha256: value.esbuildPlatformBinarySha256,
    target: value.target,
    format: value.format,
    createRequireBannerSha256: value.createRequireBannerSha256,
  });
}

function validateArtifactManifest(bytes) {
  const value = decodeJson(bytes, "worker artifact manifest");
  requireCanonicalJsonDocument(bytes, value, "worker artifact manifest");
  if (!hasExactDataKeys(value, ARTIFACT_KEYS)) {
    fail("worker artifact manifest shape is invalid");
  }
  if (value.schemaVersion !== WORKER_ARTIFACT_SCHEMA ||
      value.workerKind !== "offline_normalization_preview" ||
      value.platform !== "linux/amd64") {
    fail("worker artifact identity is invalid");
  }
  const builder = validateBuilder(value.builder);
  const workerBundle = validateByteBinding(
    value.workerBundle,
    "/opt/worker/worker.mjs",
    MAXIMUM_BYTES.worker,
    "worker bundle binding",
  );
  const buildGraph = validateByteBinding(
    value.buildGraph,
    "worker-build-graph.json",
    MAXIMUM_BYTES.buildGraph,
    "worker build graph binding",
  );
  if (!hasExactDataKeys(value.repeatability, REPEATABILITY_KEYS) ||
      value.repeatability.cleanBuildCount !== 2 ||
      value.repeatability.byteIdentical !== true) {
    fail("worker artifact repeatability evidence is invalid");
  }
  return Object.freeze({ builder, workerBundle, buildGraph });
}

function validateStringArray(value, expected, label) {
  if (!isDenseArray(value) ||
      !value.every((entry) => typeof entry === "string") ||
      !arraysEqual(value, expected)) {
    fail(`${label} differs from the reviewed allowlist`);
  }
}

function isCanonicalRepositoryPath(value) {
  return typeof value === "string" && value.length > 0 &&
    !value.includes("\\") && !posix.isAbsolute(value) &&
    posix.normalize(value) === value && value !== ".." &&
    !value.startsWith("../");
}

function validateGraphInput(value, previousPath) {
  if (!hasExactDataKeys(value, GRAPH_INPUT_KEYS) ||
      !isCanonicalRepositoryPath(value.path) ||
      (previousPath !== null && value.path <= previousPath) ||
      !isPositiveSafeInteger(value.sizeBytes, Number.MAX_SAFE_INTEGER) ||
      !isDigest(value.sha256)) {
    fail("worker build graph contains an invalid or unsorted input record");
  }
  return Object.freeze({
    path: value.path,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
  });
}

function validateDynamicImportReview(value) {
  if (!hasExactDataKeys(value, DYNAMIC_IMPORT_REVIEW_KEYS) ||
      value.package !== "gltf-validator@2.0.0-dev.3.10" ||
      value.requestedBuiltin !== "url" ||
      value.createRequireBannerRequired !== true) {
    fail("worker build graph dynamic import review is invalid");
  }
}

function validateBuildGraph(bytes) {
  const value = decodeJson(bytes, "worker build graph");
  requireCanonicalJsonDocument(bytes, value, "worker build graph");
  if (!hasExactDataKeys(value, GRAPH_KEYS) ||
      value.schemaVersion !== WORKER_BUILD_GRAPH_SCHEMA ||
      !isDenseArray(value.inputs) || value.inputs.length === 0 ||
      value.inputs.length > 256) {
    fail("worker build graph shape is invalid");
  }
  validateStringArray(value.staticRuntimeImports, STATIC_RUNTIME_IMPORTS,
    "worker static runtime imports");
  validateStringArray(value.declaredRuntimeBuiltins, DECLARED_RUNTIME_BUILTINS,
    "worker declared runtime builtins");
  validateStringArray(value.forbiddenRuntimeSpecifiers,
    FORBIDDEN_RUNTIME_SPECIFIERS, "worker forbidden runtime specifiers");
  validateDynamicImportReview(value.dynamicImportReview);
  const inputs = [];
  let previousPath = null;
  for (const input of value.inputs) {
    const record = validateGraphInput(input, previousPath);
    inputs.push(record);
    previousPath = record.path;
  }
  const protocolRecords = inputs.filter((entry) => entry.path === WIRE_SOURCE_PATH);
  if (protocolRecords.length !== 1) {
    fail("worker build graph must contain exactly one reviewed wire protocol source");
  }
  return Object.freeze({
    inputCount: inputs.length,
    inputs: Object.freeze(inputs),
    workerProtocolSha256: protocolRecords[0].sha256,
  });
}

function snapshotApproval(input, expectedKind) {
  if (typeof input === "object" && input !== null && utilTypes.isProxy(input)) {
    fail("approval Proxy objects are not accepted");
  }
  if (!hasExactDataKeys(input, APPROVAL_KEYS) ||
      input.schemaVersion !== PRODUCTION_APPROVAL_SCHEMA ||
      input.approvalKind !== expectedKind ||
      !isDigest(input.artifactManifestSha256) ||
      !isDigest(input.buildGraphSha256) ||
      !isDigest(input.workerBundleSha256) ||
      !(input.seccompProfileSha256 === null ||
        isDigest(input.seccompProfileSha256)) ||
      !isDenseArray(input.buildGraphInputs) ||
      input.buildGraphInputs.length !== 23) {
    fail("image context approval record is invalid");
  }
  const inputs = [];
  let previousPath = null;
  for (const inputRecord of input.buildGraphInputs) {
    const record = validateGraphInput(inputRecord, previousPath);
    inputs.push(record);
    previousPath = record.path;
  }
  return Object.freeze({
    schemaVersion: input.schemaVersion,
    approvalKind: input.approvalKind,
    artifactManifestSha256: input.artifactManifestSha256,
    buildGraphSha256: input.buildGraphSha256,
    workerBundleSha256: input.workerBundleSha256,
    seccompProfileSha256: input.seccompProfileSha256,
    buildGraphInputs: Object.freeze(inputs),
  });
}

function graphMatchesApproval(graphInputs, approvedInputs) {
  return graphInputs.length === approvedInputs.length &&
    graphInputs.every((record, index) => {
      const approved = approvedInputs[index];
      return approved !== undefined && record.path === approved.path &&
        record.sizeBytes === approved.sizeBytes &&
        record.sha256 === approved.sha256;
    });
}

function assertApprovedInputs(approval, bytes, artifact, graph) {
  if (sha256(bytes.artifactBytes) !== approval.artifactManifestSha256) {
    fail("worker artifact manifest digest is not approved");
  }
  if (sha256(bytes.graphBytes) !== approval.buildGraphSha256 ||
      !graphMatchesApproval(graph.inputs, approval.buildGraphInputs)) {
    fail("worker build graph bytes or exact 23-record graph are not approved");
  }
  if (artifact.workerBundle.sha256 !== approval.workerBundleSha256 ||
      sha256(bytes.workerBytes) !== approval.workerBundleSha256) {
    fail("worker bundle digest is not approved");
  }
  if (approval.seccompProfileSha256 === null) {
    fail("production generation has no build-owned approved seccomp digest");
  }
  if (sha256(bytes.seccompBytes) !== approval.seccompProfileSha256) {
    fail("seccomp profile digest is not approved");
  }
}

function assertArtifactBindings(artifact, workerBytes, graphBytes) {
  if (artifact.workerBundle.sizeBytes !== workerBytes.byteLength ||
      artifact.workerBundle.sha256 !== sha256(workerBytes)) {
    fail("worker bundle does not match the reviewed artifact manifest bytes");
  }
  if (artifact.buildGraph.sizeBytes !== graphBytes.byteLength ||
      artifact.buildGraph.sha256 !== sha256(graphBytes)) {
    fail("worker build graph bytes do not match the reviewed artifact manifest");
  }
}

function hasOnlyDataKeys(value, allowed, required) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (!required.every((key) => keys.includes(key))) return false;
  return keys.every((key) => {
    if (typeof key !== "string" || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor &&
      descriptor.enumerable === true;
  });
}

function containsControlCharacter(value) {
  if (typeof value === "string") {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(containsControlCharacter);
  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, entry]) =>
      containsControlCharacter(key) || containsControlCharacter(entry));
  }
  return false;
}

function validateSeccompArgument(value) {
  if (!hasOnlyDataKeys(value, SECCOMP_ARGUMENT_KEYS,
    ["index", "value", "op"]) ||
      !Number.isSafeInteger(value.index) || value.index < 0 || value.index > 5 ||
      !Number.isSafeInteger(value.value) || value.value < 0 ||
      (value.valueTwo !== undefined &&
        (!Number.isSafeInteger(value.valueTwo) || value.valueTwo < 0)) ||
      typeof value.op !== "string" ||
      !SECCOMP_COMPARISON_OPERATORS.has(value.op)) {
    fail("seccomp profile contains an invalid syscall argument condition");
  }
  return Object.freeze({
    index: value.index,
    value: value.value,
    valueTwo: value.valueTwo,
    op: value.op,
  });
}

function cloneRuleBlocksNamespaceFlags(argumentsList) {
  return argumentsList.some((argument) =>
    argument.index === 0 && argument.op === "SCMP_CMP_MASKED_EQ" &&
    argument.value === UNSAFE_CLONE_NAMESPACE_FLAGS && argument.valueTwo === 0);
}

function validateSeccompRule(rule) {
  if (!hasOnlyDataKeys(rule, SECCOMP_RULE_KEYS, ["names", "action"]) ||
      !isDenseArray(rule.names) || rule.names.length === 0 ||
      rule.names.length > 512 ||
      !rule.names.every((name) =>
        typeof name === "string" && name.length <= 64 &&
        /^[a-z0-9_]+$/u.test(name)) ||
      new Set(rule.names).size !== rule.names.length ||
      typeof rule.action !== "string" ||
      !(DENYING_SECCOMP_ACTIONS.has(rule.action) ||
        rule.action === "SCMP_ACT_ALLOW") ||
      (rule.errnoRet !== undefined &&
        (!Number.isSafeInteger(rule.errnoRet) || rule.errnoRet < 0)) ||
      (rule.comment !== undefined &&
        (typeof rule.comment !== "string" || rule.comment.length > 1024))) {
    fail("seccomp profile contains a malformed or unsafe syscall rule");
  }
  const rejected = rule.names.find((name) =>
    REJECTED_SECCOMP_SYSCALL_REFERENCES.has(name));
  if (rejected !== undefined) {
    fail(`seccomp profile references rejected syscall ${rejected}`);
  }
  const argumentsList = rule.args === undefined
    ? []
    : isDenseArray(rule.args) && rule.args.length <= 6
      ? rule.args.map(validateSeccompArgument)
      : fail("seccomp profile syscall args must be a dense array");
  if (!DENYING_SECCOMP_ACTIONS.has(rule.action)) {
    const forbidden = rule.names.find((name) =>
      FORBIDDEN_SECCOMP_SYSCALLS.has(name));
    if (forbidden !== undefined) {
      fail(`seccomp profile allows forbidden syscall ${forbidden}`);
    }
    if (rule.names.includes("clone") &&
        !cloneRuleBlocksNamespaceFlags(argumentsList)) {
      fail("seccomp clone allow rule does not mask every namespace clone flag");
    }
  }
}

function validateSeccompProfile(bytes) {
  const profile = decodeJson(bytes, "seccomp profile");
  if (containsControlCharacter(profile)) {
    fail("seccomp profile contains a control character");
  }
  if (!hasOnlyDataKeys(profile, SECCOMP_TOP_LEVEL_KEYS,
    ["defaultAction", "syscalls"]) ||
      profile.defaultAction !== "SCMP_ACT_ERRNO" ||
      !isDenseArray(profile.syscalls) || profile.syscalls.length > 512 ||
      (profile.defaultErrnoRet !== undefined &&
        (!Number.isSafeInteger(profile.defaultErrnoRet) ||
          profile.defaultErrnoRet < 1 || profile.defaultErrnoRet > 4095)) ||
      (profile.architectures !== undefined &&
        (!isDenseArray(profile.architectures) ||
          !arraysEqual(profile.architectures, ["SCMP_ARCH_X86_64"]))) ||
      (profile.flags !== undefined &&
        (!isDenseArray(profile.flags) || profile.flags.length !== 0))) {
    fail("seccomp profile contains unknown or unsafe top-level policy fields");
  }
  for (const rule of profile.syscalls) validateSeccompRule(rule);
  return Object.freeze({
    defaultActionObservation: profile.defaultAction,
    structuralPolicyChecksPassed: true,
  });
}

function bigintToBoundedNumber(value, maximum, label) {
  if (value > BigInt(maximum)) fail(`${label} exceeds the file boundary`);
  return Number(value);
}

function parseProgramHeaders(bytes, label) {
  const programHeaderOffset = bigintToBoundedNumber(
    bytes.readBigUInt64LE(32), bytes.length, `${label} program header offset`,
  );
  const entrySize = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  if (entrySize !== 56 || count === 0 || count > 128 ||
      programHeaderOffset < 64 ||
      programHeaderOffset + entrySize * count > bytes.length) {
    fail(`${label} has an invalid ELF program header table`);
  }
  const headers = [];
  for (let index = 0; index < count; index += 1) {
    const offset = programHeaderOffset + index * entrySize;
    headers.push(Object.freeze({
      type: bytes.readUInt32LE(offset),
      flags: bytes.readUInt32LE(offset + 4),
      fileOffset: bigintToBoundedNumber(
        bytes.readBigUInt64LE(offset + 8), bytes.length, `${label} segment offset`,
      ),
      fileBytes: bigintToBoundedNumber(
        bytes.readBigUInt64LE(offset + 32), bytes.length, `${label} segment size`,
      ),
    }));
  }
  return headers;
}

function validateDynamicSegment(bytes, header, label) {
  const end = header.fileOffset + header.fileBytes;
  if (header.fileBytes === 0 || header.fileBytes % 16 !== 0 || end > bytes.length) {
    fail(`${label} is not a self-contained statically linked ELF binary`);
  }
  let terminated = false;
  for (let offset = header.fileOffset; offset < end; offset += 16) {
    const tag = bytes.readBigInt64LE(offset);
    if (tag === 0n) {
      terminated = true;
      break;
    }
    if (tag === 1n) {
      fail(`${label} is not a self-contained statically linked ELF binary`);
    }
  }
  if (!terminated) {
    fail(`${label} is not a self-contained statically linked ELF binary`);
  }
}

function observeStaticLinuxAmd64ElfCompatibility(bytes, label) {
  if (bytes.length < 120 || !bytes.subarray(0, 4).equals(
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    fail(`${label} is not an ELF binary`);
  }
  if (bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1 ||
      ![2, 3].includes(bytes.readUInt16LE(16)) ||
      bytes.readUInt16LE(18) !== 0x3e || bytes.readUInt32LE(20) !== 1 ||
      bytes.readBigUInt64LE(24) === 0n || bytes.readUInt16LE(52) !== 64) {
    fail(`${label} must be a Linux/amd64 ELF64 little-endian executable`);
  }
  const headers = parseProgramHeaders(bytes, label);
  for (const header of headers) {
    if (header.fileOffset + header.fileBytes > bytes.length) {
      fail(`${label} contains an out-of-bounds ELF segment`);
    }
    if (header.type === 3) {
      fail(`${label} is not a self-contained statically linked ELF binary`);
    }
    if (header.type === 2) validateDynamicSegment(bytes, header, label);
  }
  if (!headers.some((header) => header.type === 1 && (header.flags & 1) === 1)) {
    fail(`${label} has no executable load segment`);
  }
}

function asciiVersions(bytes, prefix) {
  const result = new Set();
  const marker = Buffer.from(prefix, "ascii");
  let cursor = 0;
  while (cursor < bytes.length) {
    const found = bytes.indexOf(marker, cursor);
    if (found === -1) break;
    let end = found + marker.length;
    while (end < bytes.length && bytes[end] >= 0x30 && bytes[end] <= 0x39) end += 1;
    if (end < bytes.length && bytes[end] === 0x2e) {
      end += 1;
      const patchStart = end;
      while (end < bytes.length && bytes[end] >= 0x30 && bytes[end] <= 0x39) end += 1;
      if (end > patchStart) result.add(bytes.toString("ascii", found, end));
    }
    cursor = found + marker.length;
  }
  return result;
}

function containsAsciiToken(bytes, value) {
  const marker = Buffer.from(value, "ascii");
  let cursor = 0;
  while (cursor < bytes.length) {
    const found = bytes.indexOf(marker, cursor);
    if (found === -1) return false;
    const before = found === 0 ? 0 : bytes[found - 1];
    const afterOffset = found + marker.length;
    const after = afterOffset >= bytes.length ? 0 : bytes[afterOffset];
    const isWord = (byte) =>
      (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) || byte === 0x5f;
    if (!isWord(before) && !isWord(after)) return true;
    cursor = found + marker.length;
  }
  return false;
}

function observeNodeBinary(bytes) {
  observeStaticLinuxAmd64ElfCompatibility(bytes, "Node binary");
  const versions = asciiVersions(bytes, "v22.");
  const exactVersionMarker = Buffer.from(`${REQUIRED_NODE_VERSION}\0`, "ascii");
  if (!containsAsciiToken(bytes, "Node.js") ||
      !bytes.includes(exactVersionMarker) ||
      !versions.has(REQUIRED_NODE_VERSION) ||
      [...versions].some((version) => version !== REQUIRED_NODE_VERSION)) {
    fail(`Node binary lacks the required ${REQUIRED_NODE_VERSION} compatibility marker observation`);
  }
  return Object.freeze({
    observedVersionMarker: REQUIRED_NODE_VERSION,
    observedElfFormat: "elf64_little_endian_amd64",
    observedNoInterpreterOrNeededLibrary: true,
    provenanceEstablished: false,
    identityEstablished: false,
  });
}

function observeBusyBoxBinary(bytes) {
  observeStaticLinuxAmd64ElfCompatibility(bytes, "BusyBox binary");
  const marker = Buffer.from("BusyBox v", "ascii");
  const markerOffset = bytes.indexOf(marker);
  if (markerOffset === -1 || !containsAsciiToken(bytes, "timeout")) {
    fail("BusyBox binary lacks the required version and timeout compatibility markers");
  }
  let end = markerOffset + marker.length;
  while (end < bytes.length &&
      ((bytes[end] >= 0x30 && bytes[end] <= 0x39) || bytes[end] === 0x2e)) {
    end += 1;
  }
  const version = bytes.toString("ascii", markerOffset + marker.length, end);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    fail("BusyBox binary contains an invalid version marker");
  }
  return Object.freeze({
    observedVersionMarker: version,
    observedElfFormat: "elf64_little_endian_amd64",
    observedNoInterpreterOrNeededLibrary: true,
    observedTimeoutToken: true,
    provenanceEstablished: false,
    identityEstablished: false,
  });
}

function fileRecord(path, bytes) {
  return Object.freeze({ path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
}

function comparePaths(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function fileSetDigest(records) {
  const material = Buffer.from(
    `${BUILD_INPUT_SET_DOMAIN}\0${canonicalJson(records)}`,
    "utf8",
  );
  try {
    return sha256(material);
  } finally {
    material.fill(0);
  }
}

function approvalScopeLabelValue(approvalScope) {
  return approvalScope === "build_owned_generated_production"
    ? "build_owned_production"
    : "test_only_non_authoritative";
}

function protocolDerivationForScope(approvalScope) {
  return approvalScope === "build_owned_generated_production"
    ? WORKER_PROTOCOL_DERIVATION
    : "graph_declared_wire_protocol_source_sha256";
}

function graphBindingObservationForScope(approvalScope) {
  return approvalScope === "build_owned_generated_production"
    ? "build_owned_exact_23_record_graph_approved"
    : "test_scope_exact_23_record_graph_matched";
}

function renderDockerfile(bindings) {
  const labels = Object.freeze([
    [IMAGE_LABELS.workerKind, "offline_normalization_preview"],
    [IMAGE_LABELS.workerProtocolSha256, bindings.workerProtocolSha256],
    [IMAGE_LABELS.workerArtifactSha256, bindings.workerArtifactSha256],
    [IMAGE_LABELS.seccompProfileSha256, bindings.seccompProfileSha256],
    [IMAGE_LABELS.nodeArtifactSha256, bindings.nodeArtifactSha256],
    [IMAGE_LABELS.watchdogArtifactSha256, bindings.watchdogArtifactSha256],
    [IMAGE_LABELS.watchdogMaximumRuntimeMilliseconds,
      String(MAXIMUM_RUNTIME_MILLISECONDS)],
    [IMAGE_LABELS.approvalScope,
      approvalScopeLabelValue(bindings.approvalScope)],
    [IMAGE_LABELS.qualificationStatus, "unqualified"],
  ]);
  const lines = [
    "FROM scratch",
    "COPY --chmod=0555 busybox /bin/busybox",
    "COPY --chmod=0555 node /usr/local/bin/node",
    "COPY --chmod=0444 worker.mjs /opt/worker/worker.mjs",
    ...SAFE_ENVIRONMENT.map((entry) => `ENV ${entry}`),
    "WORKDIR /",
    "STOPSIGNAL SIGKILL",
    `USER ${String(USER_ID)}:${String(GROUP_ID)}`,
    ...labels.map(([key, value]) => `LABEL ${key}=${JSON.stringify(value)}`),
    `ENTRYPOINT ${JSON.stringify(FIXED_ENTRYPOINT)}`,
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function renderDockerignore() {
  return Buffer.from(
    "*\n!Dockerfile\n!busybox\n!node\n!worker.mjs\n",
    "utf8",
  );
}

function runtimeManifest(labels) {
  return Object.freeze({
    configurationSchemaVersion: CONTAINER_CONFIGURATION_SCHEMA,
    platform: "linux/amd64",
    baseImage: "scratch",
    entrypoint: FIXED_ENTRYPOINT,
    environment: SAFE_ENVIRONMENT,
    workingDirectory: "/",
    stopSignal: "SIGKILL",
    userId: USER_ID,
    groupId: GROUP_ID,
    defaultCommand: null,
    exposedPorts: Object.freeze([]),
    volumes: Object.freeze([]),
    healthcheck: null,
    labels,
  });
}

function qualificationManifest() {
  return Object.freeze({
    status: "unqualified",
    code: "BUILD_INPUTS_ONLY_NOT_DOCKER_QUALIFIED",
    authority: "none",
    imageDigest: null,
    imageBuilt: false,
    dockerStarted: false,
    sandboxEstablished: false,
    claimStatus: "unauthenticated_integrity_claim",
  });
}

function renderOutput(snapshot, publicationMethod) {
  const labels = Object.freeze({
    [IMAGE_LABELS.workerKind]: "offline_normalization_preview",
    [IMAGE_LABELS.workerProtocolSha256]: snapshot.workerProtocolSha256,
    [IMAGE_LABELS.workerArtifactSha256]: snapshot.workerArtifactSha256,
    [IMAGE_LABELS.seccompProfileSha256]: snapshot.seccompProfileSha256,
    [IMAGE_LABELS.nodeArtifactSha256]: snapshot.nodeArtifactSha256,
    [IMAGE_LABELS.watchdogArtifactSha256]: snapshot.watchdogArtifactSha256,
    [IMAGE_LABELS.watchdogMaximumRuntimeMilliseconds]:
      String(MAXIMUM_RUNTIME_MILLISECONDS),
    [IMAGE_LABELS.approvalScope]:
      approvalScopeLabelValue(snapshot.approvalScope),
    [IMAGE_LABELS.qualificationStatus]: "unqualified",
  });
  const dockerfile = renderDockerfile(snapshot);
  const dockerignore = renderDockerignore();
  const contextFiles = Object.freeze([
    fileRecord("context/.dockerignore", dockerignore),
    fileRecord("context/Dockerfile", dockerfile),
    fileRecord("context/busybox", snapshot.busyBoxBytes),
    fileRecord("context/node", snapshot.nodeBytes),
    fileRecord("context/worker.mjs", snapshot.workerBytes),
  ].sort(comparePaths));
  const evidenceFiles = Object.freeze([
    fileRecord("evidence/artifact.json", snapshot.artifactBytes),
    fileRecord("evidence/seccomp.json", snapshot.seccompBytes),
    fileRecord("evidence/worker-build-graph.json", snapshot.graphBytes),
  ].sort(comparePaths));
  const manifest = Object.freeze({
    schemaVersion: IMAGE_CONTEXT_SCHEMA,
    artifactKind:
      "offline_preview_scratch_image_byte_deterministic_context_inputs",
    qualification: qualificationManifest(),
    generatorOperations: Object.freeze({
      childProcessApiInvokedByGenerator: false,
      externalProcessStartedByGenerator: false,
      networkApiInvokedByGenerator: false,
      inputStorageLocality: "not_established",
      inputReadsMayHydrateExternalStorage: true,
    }),
    approval: Object.freeze({
      scope: snapshot.approvalScope,
      productionApprovalUsed:
        snapshot.approvalScope === "build_owned_generated_production",
      testOnlyNonAuthoritative:
        snapshot.approvalScope === TEST_ONLY_APPROVAL_KIND,
      scopeSeccompDigestMatched: true,
    }),
    productionConsumptionPolicy: Object.freeze({
      requiredApprovalScopeLabel: "build_owned_production",
      requiredBuildQualificationStatusLabel: "unqualified",
      separateLiveQualificationRequired: true,
      separateLiveQualificationBinding:
        "signed_bundled_release_manifest_exact_image_digest_and_report_sha256",
      currentApprovalScopeLabel:
        approvalScopeLabelValue(snapshot.approvalScope),
      currentQualificationStatusLabel: "unqualified",
      eligible: false,
    }),
    bindings: Object.freeze({
      workerKind: "offline_normalization_preview",
      workerArtifactSha256: snapshot.workerArtifactSha256,
      workerArtifactManifestSha256: sha256(snapshot.artifactBytes),
      workerBuildGraphSha256: sha256(snapshot.graphBytes),
      workerProtocolSha256: snapshot.workerProtocolSha256,
      workerProtocolDerivation:
        protocolDerivationForScope(snapshot.approvalScope),
      workerProtocolSourcePath: WIRE_SOURCE_PATH,
      seccompProfileSha256: snapshot.seccompProfileSha256,
      watchdogArtifactSha256: snapshot.watchdogArtifactSha256,
      watchdogMaximumRuntimeMilliseconds: MAXIMUM_RUNTIME_MILLISECONDS,
      nodeArtifactSha256: snapshot.nodeArtifactSha256,
    }),
    sourceObservations: Object.freeze({
      generatorNodeVersion: process.version,
      workerArtifactSchemaAndDigestChecksPassed: true,
      graphBindingObservation:
        graphBindingObservationForScope(snapshot.approvalScope),
      scopeApprovedExactGraphRecordMatch: true,
      workerBuildGraphInputCount: snapshot.graphInputCount,
      node: snapshot.nodeEvidence,
      busyBox: snapshot.busyBoxEvidence,
      seccomp: snapshot.seccompEvidence,
      binaryProvenanceStatus:
        "not_established_pending_build_owned_official_digest_and_live_qualification",
      binaryIdentityStatus:
        "not_established_pending_build_owned_official_digest_and_live_qualification",
    }),
    runtime: runtimeManifest(labels),
    buildContext: Object.freeze({
      relativeDirectory: "context",
      dockerfilePath: "context/Dockerfile",
      files: contextFiles,
      fileSetSha256: fileSetDigest(contextFiles),
    }),
    evidenceSnapshots: Object.freeze({
      files: evidenceFiles,
      fileSetSha256: fileSetDigest(evidenceFiles),
    }),
    byteDeterminism: Object.freeze({
      pureRenderCount: 2,
      byteIdentical: true,
      scope: "relative_paths_and_file_contents_only",
      filesystemMetadataNormalized: false,
      filesystemMetadataDeterminism: "not_established",
      imageDigestDeterminism: "not_established",
    }),
    publication: Object.freeze({
      method: publicationMethod,
      noOverwriteIntent: true,
      strictAtomicNoReplaceClaim: false,
      automaticCleanup: false,
      postPublishCompleteTreeAndByteVerification: "required",
      returnedManifestDigestSource: "post_publish_re_read",
      verificationScope: "point_in_time_only",
      pointInTimeVerificationEstablishesSameUserRaceResistance: false,
      sameUserPathRaceResistance:
        "not_established_node_path_apis_lack_directory_handle_relative_publication",
    }),
  });
  const manifestBytes = canonicalBytes(manifest);
  return new Map([
    ["context/.dockerignore", dockerignore],
    ["context/Dockerfile", dockerfile],
    ["context/busybox", Buffer.from(snapshot.busyBoxBytes)],
    ["context/node", Buffer.from(snapshot.nodeBytes)],
    ["context/worker.mjs", Buffer.from(snapshot.workerBytes)],
    ["evidence/artifact.json", Buffer.from(snapshot.artifactBytes)],
    ["evidence/seccomp.json", Buffer.from(snapshot.seccompBytes)],
    ["evidence/worker-build-graph.json", Buffer.from(snapshot.graphBytes)],
    ["offline-preview-image-context-manifest.json", manifestBytes],
  ]);
}

function publicationMethod(testOnlyOptions) {
  if (process.platform === "win32") {
    return "windows_sibling_directory_rename_best_available";
  }
  if (testOnlyOptions.allowBestAvailablePublication) {
    return "non_windows_test_only_sibling_directory_rename_best_available";
  }
  return "unavailable_strict_no_replace_not_established";
}

function renderedOutputsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const [path, bytes] of left) {
    const other = right.get(path);
    if (other === undefined || !bytes.equals(other)) return false;
  }
  return true;
}

function eraseRenderedOutput(output) {
  for (const bytes of output.values()) bytes.fill(0);
}

async function assertOutputAvailable(outputDirectory) {
  assertCanonicalAbsolutePath(outputDirectory, "output directory");
  try {
    await lstat(outputDirectory);
    fail("output directory already exists");
  } catch (error) {
    if (systemErrorCode(error) !== "ENOENT") throw error;
  }
  await requireStableDirectory(dirname(outputDirectory), "output parent directory");
}

function directoryIdentity(status) {
  return Object.freeze({
    dev: status.dev,
    ino: status.ino,
    birthtimeNs: status.birthtimeNs,
  });
}

function directoryIdentityMatches(status, identity) {
  return status.dev === identity.dev && status.ino === identity.ino &&
    status.birthtimeNs === identity.birthtimeNs;
}

async function assertOwnedDirectorySnapshot(directorySnapshot, phase) {
  const status = await lstat(directorySnapshot.path, { bigint: true });
  if (!status.isDirectory() || status.isSymbolicLink() ||
      !directoryIdentityMatches(status, directorySnapshot.identity) ||
      await realpath(directorySnapshot.path) !== directorySnapshot.path) {
    fail(`${phase} directory identity changed; it was preserved and not deleted`);
  }
}

async function createSiblingStagingDirectory(outputDirectory) {
  const parent = dirname(outputDirectory);
  const name = basename(outputDirectory);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const suffix = randomBytes(24).toString("hex");
    const path = join(parent, `.${name}.offline-preview-image-context-staging-${suffix}`);
    try {
      await mkdir(path);
    } catch (error) {
      if (systemErrorCode(error) === "EEXIST") continue;
      throw error;
    }
    const status = await lstat(path, { bigint: true });
    if (!status.isDirectory() || status.isSymbolicLink() ||
        await realpath(path) !== path) {
      fail("new staging directory identity could not be established; it was not deleted");
    }
    return Object.freeze({ path, identity: directoryIdentity(status) });
  }
  fail("could not reserve an unpredictable sibling staging directory");
}

function outputMode(path) {
  return path === "context/node" || path === "context/busybox" ? 0o555 : 0o444;
}

async function writeExclusiveFile(path, bytes, mode) {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertExactDirectoryEntries(path, expected) {
  const entries = await readdir(path, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (!arraysEqual(names, [...expected].sort())) {
    fail("output tree contains an unexpected or missing entry");
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail("output tree contains a symbolic link");
  }
}

async function verifyCompleteOutputTree(directorySnapshot, output, phase) {
  await assertOwnedDirectorySnapshot(directorySnapshot, phase);
  await assertExactDirectoryEntries(directorySnapshot.path,
    ["context", "evidence", "offline-preview-image-context-manifest.json"]);
  await assertExactDirectoryEntries(join(directorySnapshot.path, "context"),
    [".dockerignore", "Dockerfile", "busybox", "node", "worker.mjs"]);
  await assertExactDirectoryEntries(join(directorySnapshot.path, "evidence"),
    ["artifact.json", "seccomp.json", "worker-build-graph.json"]);
  let manifestSha256 = null;
  for (const [relativePath, expected] of output) {
    const path = join(directorySnapshot.path, ...relativePath.split("/"));
    const actual = await readStableRegularFile(
      path,
      `${phase} output ${relativePath}`,
      Math.max(expected.byteLength, 1),
    );
    try {
      if (!actual.equals(expected)) fail(`${phase} output changed: ${relativePath}`);
      if (relativePath === "offline-preview-image-context-manifest.json") {
        manifestSha256 = sha256(actual);
      }
    } finally {
      actual.fill(0);
    }
  }
  await assertOwnedDirectorySnapshot(directorySnapshot, phase);
  if (manifestSha256 === null) fail(`${phase} manifest was absent`);
  return manifestSha256;
}

async function writeStagedOutput(staging, output, testOnlyOptions) {
  await assertOwnedDirectorySnapshot(staging, "staging");
  await Promise.all([
    mkdir(join(staging.path, "context")),
    mkdir(join(staging.path, "evidence")),
  ]);
  let written = 0;
  for (const [relativePath, bytes] of output) {
    await assertOwnedDirectorySnapshot(staging, "staging");
    await writeExclusiveFile(
      join(staging.path, ...relativePath.split("/")),
      bytes,
      outputMode(relativePath),
    );
    written += 1;
    if (testOnlyOptions.failureAfterFileCount === written) {
      fail("__testOnly injected partial staging failure; staging was preserved");
    }
  }
  await verifyCompleteOutputTree(staging, output, "staging");
}

async function publishStagedOutput(staging, outputDirectory, output, testOnlyOptions) {
  if (process.platform !== "win32" &&
      !testOnlyOptions.allowBestAvailablePublication) {
    fail("strict no-replace directory publication is not established on this host");
  }
  await assertOutputAvailable(outputDirectory);
  await assertOwnedDirectorySnapshot(staging, "staging");
  if (testOnlyOptions.beforePublication !== null) {
    await testOnlyOptions.beforePublication(staging.path);
  }
  await verifyCompleteOutputTree(staging, output, "staging");
  await assertOutputAvailable(outputDirectory);
  await rename(staging.path, outputDirectory);
  if (testOnlyOptions.afterRenameBeforeVerification !== null) {
    await testOnlyOptions.afterRenameBeforeVerification(outputDirectory);
  }
  const published = await lstat(outputDirectory, { bigint: true });
  if (!published.isDirectory() || published.isSymbolicLink() ||
      !directoryIdentityMatches(published, staging.identity)) {
    fail("published directory identity did not match staging; no cleanup was attempted");
  }
  const publishedSnapshot = Object.freeze({
    path: outputDirectory,
    identity: staging.identity,
  });
  return verifyCompleteOutputTree(publishedSnapshot, output, "published");
}

async function readAndValidateInputs(paths) {
  await requireStableDirectory(
    paths.workerArtifactDirectory,
    "worker artifact directory",
  );
  const artifactPath = join(paths.workerArtifactDirectory, "artifact.json");
  const graphPath = join(paths.workerArtifactDirectory, "worker-build-graph.json");
  const workerPath = join(paths.workerArtifactDirectory, "worker.mjs");
  const results = await Promise.allSettled([
    readStableRegularFile(artifactPath, "worker artifact manifest", MAXIMUM_BYTES.artifact),
    readStableRegularFile(graphPath, "worker build graph", MAXIMUM_BYTES.buildGraph),
    readStableRegularFile(workerPath, "worker bundle", MAXIMUM_BYTES.worker),
    readStableRegularFile(paths.nodeBinaryPath, "Node binary", MAXIMUM_BYTES.node),
    readStableRegularFile(paths.busyBoxBinaryPath, "BusyBox binary", MAXIMUM_BYTES.busyBox),
    readStableRegularFile(paths.seccompProfilePath, "seccomp profile", MAXIMUM_BYTES.seccomp),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure !== undefined && failure.status === "rejected") {
    for (const result of results) {
      if (result.status === "fulfilled") result.value.fill(0);
    }
    throw failure.reason;
  }
  const fulfilled = results.map((result) => {
    if (result.status !== "fulfilled") fail("input snapshot unexpectedly failed");
    return result.value;
  });
  const [artifactBytes, graphBytes, workerBytes, nodeBytes, busyBoxBytes, seccompBytes] =
    fulfilled;
  return Object.freeze({
    artifactBytes, graphBytes, workerBytes, nodeBytes, busyBoxBytes, seccompBytes,
  });
}

function validateInputBytes(bytes, approval) {
  const artifact = validateArtifactManifest(bytes.artifactBytes);
  const graph = validateBuildGraph(bytes.graphBytes);
  assertArtifactBindings(artifact, bytes.workerBytes, bytes.graphBytes);
  const nodeEvidence = observeNodeBinary(bytes.nodeBytes);
  const busyBoxEvidence = observeBusyBoxBinary(bytes.busyBoxBytes);
  const seccompEvidence = validateSeccompProfile(bytes.seccompBytes);
  assertApprovedInputs(approval, bytes, artifact, graph);
  return Object.freeze({
    ...bytes,
    approvalScope: approval.approvalKind,
    graphInputCount: graph.inputCount,
    workerArtifactSha256: artifact.workerBundle.sha256,
    workerProtocolSha256: graph.workerProtocolSha256,
    seccompProfileSha256: sha256(bytes.seccompBytes),
    watchdogArtifactSha256: sha256(bytes.busyBoxBytes),
    nodeArtifactSha256: sha256(bytes.nodeBytes),
    nodeEvidence,
    busyBoxEvidence,
    seccompEvidence,
  });
}

function eraseInputBytes(bytes) {
  for (const value of Object.values(bytes)) {
    if (Buffer.isBuffer(value)) value.fill(0);
  }
}

function snapshotTestOnlyOptions(input) {
  if (input === undefined) {
    return Object.freeze({
      failureAfterFileCount: null,
      beforePublication: null,
      afterRenameBeforeVerification: null,
      allowBestAvailablePublication: false,
    });
  }
  if (typeof input === "object" && input !== null && utilTypes.isProxy(input)) {
    fail("__testOnly options Proxy objects are not accepted");
  }
  if (!hasExactDataKeys(input, TEST_ONLY_OPTIONS_KEYS) ||
      !(input.__testOnlyFailureAfterFileCount === null ||
        isPositiveSafeInteger(input.__testOnlyFailureAfterFileCount, 32)) ||
      !(input.__testOnlyBeforePublication === null ||
        typeof input.__testOnlyBeforePublication === "function") ||
      !(input.__testOnlyAfterRenameBeforeVerification === null ||
        typeof input.__testOnlyAfterRenameBeforeVerification === "function") ||
      typeof input.__testOnlyAllowBestAvailablePublication !== "boolean") {
    fail("__testOnly options are invalid");
  }
  return Object.freeze({
    failureAfterFileCount: input.__testOnlyFailureAfterFileCount,
    beforePublication: input.__testOnlyBeforePublication,
    afterRenameBeforeVerification:
      input.__testOnlyAfterRenameBeforeVerification,
    allowBestAvailablePublication:
      input.__testOnlyAllowBestAvailablePublication,
  });
}

const NO_TEST_ONLY_OPTIONS = Object.freeze({
  failureAfterFileCount: null,
  beforePublication: null,
  afterRenameBeforeVerification: null,
  allowBestAvailablePublication: false,
});

async function generateWithApproval(input, approval, testOnlyOptions) {
  if (process.version !== REQUIRED_NODE_VERSION) {
    fail(`generator requires ${REQUIRED_NODE_VERSION}; received ${process.version}`);
  }
  const paths = snapshotInput(input);
  for (const [key, path] of Object.entries(paths)) {
    assertCanonicalAbsolutePath(path, key);
  }
  if (approval.seccompProfileSha256 === null) {
    fail("production generation has no build-owned approved seccomp digest");
  }
  await assertOutputAvailable(paths.outputDirectory);
  const bytes = await readAndValidateInputs(paths);
  let first;
  let repeat;
  try {
    const snapshot = validateInputBytes(bytes, approval);
    const method = publicationMethod(testOnlyOptions);
    first = renderOutput(snapshot, method);
    repeat = renderOutput(snapshot, method);
    if (!renderedOutputsEqual(first, repeat)) {
      fail("two pure renders did not produce identical output bytes");
    }
    const staging = await createSiblingStagingDirectory(paths.outputDirectory);
    await writeStagedOutput(staging, first, testOnlyOptions);
    const publishedManifestSha256 = await publishStagedOutput(
      staging,
      paths.outputDirectory,
      first,
      testOnlyOptions,
    );
    return Object.freeze({
      status: "unqualified",
      imageDigest: null,
      outputDirectory: paths.outputDirectory,
      buildContextDirectory: join(paths.outputDirectory, "context"),
      manifestSha256: publishedManifestSha256,
      byteDeterminismScope: "relative_paths_and_file_contents_only",
    });
  } finally {
    eraseRenderedOutput(first ?? new Map());
    eraseRenderedOutput(repeat ?? new Map());
    eraseInputBytes(bytes);
  }
}


/**
 * Production entrypoint. It imports only the build-owned generated approval.
 * It invokes no child-process or network API and starts no external process,
 * but local-looking file reads may still hydrate external storage. It never
 * computes or claims an image digest.
 */
export async function generateOfflinePreviewImageContext(input) {
  const approval = snapshotApproval(
    OFFLINE_PREVIEW_IMAGE_CONTEXT_PRODUCTION_APPROVAL,
    "build_owned_generated_production",
  );
  return generateWithApproval(input, approval, NO_TEST_ONLY_OPTIONS);
}

/**
 * Test-only path. Its manifest is permanently marked non-authoritative and it
 * cannot consume or mint production approval.
 */
export async function generateOfflinePreviewImageContext__testOnly(
  input,
  approvalInput,
  optionsInput,
) {
  const approval = snapshotApproval(approvalInput, TEST_ONLY_APPROVAL_KIND);
  const options = snapshotTestOnlyOptions(optionsInput);
  return generateWithApproval(input, approval, options);
}

async function main() {
  if (process.argv.length !== 7) {
    fail("provide exactly: worker-artifact-directory node-binary busybox-binary seccomp-json output-directory");
  }
  const summary = await generateOfflinePreviewImageContext({
    workerArtifactDirectory: process.argv[2],
    nodeBinaryPath: process.argv[3],
    busyBoxBinaryPath: process.argv[4],
    seccompProfilePath: process.argv[5],
    outputDirectory: process.argv[6],
  });
  process.stdout.write(`${canonicalJson(summary)}\n`);
}

const invokedPath = process.argv[1] === undefined
  ? null
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

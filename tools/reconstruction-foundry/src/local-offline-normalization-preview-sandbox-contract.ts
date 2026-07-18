import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  parseLocalOfflinePreviewContainerConfiguration,
  type LocalOfflinePreviewContainerConfiguration,
} from "./local-offline-normalization-preview-container-preflight.js";

export const LOCAL_OFFLINE_PREVIEW_SANDBOX_POLICY_V0 =
  "omnitwin.reconstruction-foundry.offline-preview-sandbox-policy.v0";
export const LOCAL_OFFLINE_PREVIEW_SANDBOX_TERMINAL_RECEIPT_V0 =
  "omnitwin.reconstruction-foundry.offline-preview-sandbox-terminal-receipt.v0";
export const LOCAL_OFFLINE_PREVIEW_SANDBOX_EVIDENCE_V0 =
  "omnitwin.reconstruction-foundry.offline-preview-sandbox-evidence.v0";

export const LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND =
  "docker_desktop_wsl2_shared_kernel" as const;

export const LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS = Object.freeze([
  "The worker shares the Docker Desktop Linux kernel; this is container isolation, not a dedicated virtual machine.",
  "The Docker engine, Docker Desktop virtual machine, operating system, and paging layers remain trusted and may retain metadata or bytes.",
  "No secure-erasure claim is made for memory, storage, logs outside this worker, snapshots, crash data, or page files.",
  "This receipt does not prove native Windows custody, legal rights, geometric accuracy, source truth, or production suitability.",
  "Isolation grants no authority: captured, measured, inferred, and generated information must remain separately labelled.",
] as const);

export const LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM = Object.freeze({
  scope: "worker_host_access" as const,
  previewOutputPathProvided: false as const,
  writableHostDirectoryProvided: false as const,
  dockerSocketProvided: false as const,
  returnChannel: "bounded_framed_stdout_only" as const,
  claim:
    "The worker is given neither a preview-output path nor a writable host directory; result bytes can return only through the bounded framed standard-output channel.",
});

const POLICY_DOMAIN =
  "OMNITWIN_RECONSTRUCTION_FOUNDRY_OFFLINE_PREVIEW_SANDBOX_POLICY_V0";
const RECEIPT_DOMAIN =
  "OMNITWIN_RECONSTRUCTION_FOUNDRY_OFFLINE_PREVIEW_SANDBOX_TERMINAL_RECEIPT_V0";
const EVIDENCE_DOMAIN =
  "OMNITWIN_RECONSTRUCTION_FOUNDRY_OFFLINE_PREVIEW_SANDBOX_EVIDENCE_V0";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;

type JsonObject = Record<string, unknown>;

export interface LocalOfflinePreviewSandboxEffectiveControls {
  readonly platform: "linux/amd64";
  readonly imageReference: string;
  readonly imageId: string;
  readonly imagePullPolicy: "never";
  readonly fixedEntrypoint: readonly string[];
  readonly networkMode: "none";
  readonly readOnlyRootFilesystem: true;
  readonly mountCount: 0;
  readonly volumeCount: 0;
  readonly dockerSocketPresent: false;
  readonly deviceCount: 0;
  readonly capDrop: readonly ["ALL"];
  readonly capAdd: readonly [];
  readonly noNewPrivileges: true;
  readonly seccompDefaultAction: "SCMP_ACT_ERRNO";
  readonly seccompProfileSha256: string;
  readonly runtime: "runc";
  readonly pidMode: "private";
  readonly cgroupNamespaceMode: "private";
  readonly ipcMode: "none";
  readonly logDriver: "none";
  readonly restartPolicy: "no";
  readonly healthcheckDisabled: true;
  readonly tty: false;
  readonly attachStdin: true;
  readonly attachStdout: true;
  readonly attachStderr: false;
  readonly userId: number;
  readonly groupId: number;
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly pidsLimit: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumRuntimeMilliseconds: number;
}

export interface LocalOfflinePreviewSandboxPolicy {
  readonly schemaVersion: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_POLICY_V0;
  readonly backend: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND;
  readonly authority: "none";
  readonly fallbackPolicy: "block";
  readonly productionExecution: "disabled";
  readonly workerKind: "offline_normalization_preview";
  readonly workerProtocolSha256: string;
  readonly workerArtifactSha256: string;
  readonly effectiveControls: LocalOfflinePreviewSandboxEffectiveControls;
  readonly persistence: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM;
  readonly limitations: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS;
  readonly policyDigest: string;
}

export interface LocalOfflinePreviewSandboxByteBinding {
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface LocalOfflinePreviewSandboxTerminalState {
  readonly status: "exited";
  readonly running: false;
  readonly pid: 0;
  readonly exitCode: 0;
  readonly oomKilled: false;
  readonly dead: false;
}

interface LocalOfflinePreviewSandboxTerminalReceiptBase {
  readonly schemaVersion:
    typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_TERMINAL_RECEIPT_V0;
  readonly backend: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND;
  readonly authority: "none";
  readonly sandboxEstablished: true;
  readonly requestId: string;
  readonly policyDigest: string;
  readonly engineDigest: string;
  readonly containerConfigurationDigest: string;
  readonly containerIdentityDigest: string;
  readonly deadlineAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly wireInput: LocalOfflinePreviewSandboxByteBinding;
  readonly wireOutput: LocalOfflinePreviewSandboxByteBinding;
  readonly source: LocalOfflinePreviewSandboxByteBinding;
  readonly candidate: LocalOfflinePreviewSandboxByteBinding;
  readonly reportSha256: string;
  readonly terminal: LocalOfflinePreviewSandboxTerminalState;
  readonly effectiveControls: LocalOfflinePreviewSandboxEffectiveControls;
  readonly containerRemoved: true;
  readonly exactPrivateLabelAbsent: true;
  readonly privateLabelDigest: string;
  readonly matchingPrivateLabelContainerCount: 0;
  readonly receiptDigest: string;
}

export interface LocalOfflinePreviewSandboxTransformTerminalReceipt
  extends LocalOfflinePreviewSandboxTerminalReceiptBase {
  readonly phase: "transform";
  readonly verificationResult: "not_applicable";
}

export interface LocalOfflinePreviewSandboxFreshVerifierTerminalReceipt
  extends LocalOfflinePreviewSandboxTerminalReceiptBase {
  readonly phase: "fresh_verifier";
  readonly verificationResult: "exact_match";
}

export type LocalOfflinePreviewSandboxTerminalReceipt =
  | LocalOfflinePreviewSandboxTransformTerminalReceipt
  | LocalOfflinePreviewSandboxFreshVerifierTerminalReceipt;

export type LocalOfflinePreviewSandboxTerminalReceiptInput = Omit<
  LocalOfflinePreviewSandboxTerminalReceipt,
  | "schemaVersion"
  | "backend"
  | "authority"
  | "sandboxEstablished"
  | "receiptDigest"
>;

export interface LocalOfflinePreviewSandboxEvidence {
  readonly schemaVersion: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_EVIDENCE_V0;
  readonly backend: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND;
  readonly authority: "none";
  readonly productionExecution: "disabled";
  readonly sandboxEstablished: true;
  readonly requestId: string;
  readonly policyDigest: string;
  readonly engineDigest: string;
  readonly source: LocalOfflinePreviewSandboxByteBinding;
  readonly candidate: LocalOfflinePreviewSandboxByteBinding;
  readonly reportSha256: string;
  readonly transformReceiptDigest: string;
  readonly freshVerifierReceiptDigest: string;
  readonly distinctContainers: true;
  readonly freshVerifierStartedAfterTransformFinished: true;
  readonly bothContainersRemoved: true;
  readonly privateLabelOrphanScanEmpty: true;
  readonly persistence: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM;
  readonly limitations: typeof LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS;
  readonly evidenceDigest: string;
}

const CONTROL_KEYS = [
  "platform",
  "imageReference",
  "imageId",
  "imagePullPolicy",
  "fixedEntrypoint",
  "networkMode",
  "readOnlyRootFilesystem",
  "mountCount",
  "volumeCount",
  "dockerSocketPresent",
  "deviceCount",
  "capDrop",
  "capAdd",
  "noNewPrivileges",
  "seccompDefaultAction",
  "seccompProfileSha256",
  "runtime",
  "pidMode",
  "cgroupNamespaceMode",
  "ipcMode",
  "logDriver",
  "restartPolicy",
  "healthcheckDisabled",
  "tty",
  "attachStdin",
  "attachStdout",
  "attachStderr",
  "userId",
  "groupId",
  "cpuCores",
  "memoryBytes",
  "memorySwapBytes",
  "pidsLimit",
  "maximumInputBytes",
  "maximumOutputBytes",
  "maximumRuntimeMilliseconds",
] as const;

const POLICY_KEYS = [
  "schemaVersion",
  "backend",
  "authority",
  "fallbackPolicy",
  "productionExecution",
  "workerKind",
  "workerProtocolSha256",
  "workerArtifactSha256",
  "effectiveControls",
  "persistence",
  "limitations",
  "policyDigest",
] as const;

const BYTE_BINDING_KEYS = ["sizeBytes", "sha256"] as const;
const TERMINAL_KEYS = [
  "status",
  "running",
  "pid",
  "exitCode",
  "oomKilled",
  "dead",
] as const;
const RECEIPT_KEYS = [
  "schemaVersion",
  "backend",
  "authority",
  "sandboxEstablished",
  "phase",
  "requestId",
  "policyDigest",
  "engineDigest",
  "containerConfigurationDigest",
  "containerIdentityDigest",
  "deadlineAt",
  "startedAt",
  "finishedAt",
  "wireInput",
  "wireOutput",
  "source",
  "candidate",
  "reportSha256",
  "verificationResult",
  "terminal",
  "effectiveControls",
  "containerRemoved",
  "exactPrivateLabelAbsent",
  "privateLabelDigest",
  "matchingPrivateLabelContainerCount",
  "receiptDigest",
] as const;
const EVIDENCE_KEYS = [
  "schemaVersion",
  "backend",
  "authority",
  "productionExecution",
  "sandboxEstablished",
  "requestId",
  "policyDigest",
  "engineDigest",
  "source",
  "candidate",
  "reportSha256",
  "transformReceiptDigest",
  "freshVerifierReceiptDigest",
  "distinctContainers",
  "freshVerifierStartedAfterTransformFinished",
  "bothContainersRemoved",
  "privateLabelOrphanScanEmpty",
  "persistence",
  "limitations",
  "evidenceDigest",
] as const;

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  const allowed = new Set(expected);
  return keys.every(
    (key) => typeof key === "string" && allowed.has(key),
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function withoutDigest(
  value: Readonly<Record<string, unknown>>,
  digestKey: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestKey),
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function arraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return (
      stableCanonicalJson(toCanonicalJson(left)) ===
      stableCanonicalJson(toCanonicalJson(right))
    );
  } catch {
    return false;
  }
}

function controlsFromConfiguration(
  configuration: LocalOfflinePreviewContainerConfiguration,
): LocalOfflinePreviewSandboxEffectiveControls {
  return deepFreeze({
    platform: configuration.containerPlatform,
    imageReference: configuration.imageReference,
    imageId: configuration.imageId,
    imagePullPolicy: configuration.imagePullPolicy,
    fixedEntrypoint: [...configuration.fixedEntrypoint],
    networkMode: configuration.networkMode,
    readOnlyRootFilesystem: true,
    mountCount: 0,
    volumeCount: 0,
    dockerSocketPresent: false,
    deviceCount: 0,
    capDrop: ["ALL"],
    capAdd: [],
    noNewPrivileges: configuration.noNewPrivileges,
    seccompDefaultAction: configuration.seccompDefaultAction,
    seccompProfileSha256: configuration.seccompProfileSha256,
    runtime: "runc",
    pidMode: "private",
    cgroupNamespaceMode: "private",
    ipcMode: "none",
    logDriver: "none",
    restartPolicy: "no",
    healthcheckDisabled: true,
    tty: false,
    attachStdin: true,
    attachStdout: true,
    attachStderr: false,
    userId: configuration.userId,
    groupId: configuration.groupId,
    cpuCores: configuration.resourceLimits.cpuCores,
    memoryBytes: configuration.resourceLimits.memoryBytes,
    memorySwapBytes: configuration.resourceLimits.memorySwapBytes,
    pidsLimit: configuration.resourceLimits.pidsLimit,
    maximumInputBytes: configuration.resourceLimits.maximumInputBytes,
    maximumOutputBytes: configuration.resourceLimits.maximumOutputBytes,
    maximumRuntimeMilliseconds:
      configuration.resourceLimits.maximumRuntimeMilliseconds,
  });
}

function parseControls(
  value: unknown,
): LocalOfflinePreviewSandboxEffectiveControls | null {
  if (!isPlainObject(value) || !hasExactKeys(value, CONTROL_KEYS)) return null;
  const entrypoint = value.fixedEntrypoint;
  if (
    value.platform !== "linux/amd64" ||
    typeof value.imageReference !== "string" ||
    !value.imageReference.includes("@sha256:") ||
    !isDigest(value.imageId) ||
    value.imagePullPolicy !== "never" ||
    !Array.isArray(entrypoint) ||
    entrypoint.length === 0 ||
    !entrypoint.every((entry) => typeof entry === "string" && entry.length > 0) ||
    value.networkMode !== "none" ||
    value.readOnlyRootFilesystem !== true ||
    value.mountCount !== 0 ||
    value.volumeCount !== 0 ||
    value.dockerSocketPresent !== false ||
    value.deviceCount !== 0 ||
    !Array.isArray(value.capDrop) ||
    !arraysEqual(value.capDrop, ["ALL"]) ||
    !Array.isArray(value.capAdd) ||
    value.capAdd.length !== 0 ||
    value.noNewPrivileges !== true ||
    value.seccompDefaultAction !== "SCMP_ACT_ERRNO" ||
    !isDigest(value.seccompProfileSha256) ||
    value.runtime !== "runc" ||
    value.pidMode !== "private" ||
    value.cgroupNamespaceMode !== "private" ||
    value.ipcMode !== "none" ||
    value.logDriver !== "none" ||
    value.restartPolicy !== "no" ||
    value.healthcheckDisabled !== true ||
    value.tty !== false ||
    value.attachStdin !== true ||
    value.attachStdout !== true ||
    value.attachStderr !== false ||
    !isSafePositiveInteger(value.userId) ||
    !isSafePositiveInteger(value.groupId) ||
    !isSafePositiveInteger(value.cpuCores) ||
    !isSafePositiveInteger(value.memoryBytes) ||
    value.memorySwapBytes !== value.memoryBytes ||
    !isSafePositiveInteger(value.pidsLimit) ||
    !isSafePositiveInteger(value.maximumInputBytes) ||
    !isSafePositiveInteger(value.maximumOutputBytes) ||
    !isSafePositiveInteger(value.maximumRuntimeMilliseconds)
  ) {
    return null;
  }
  return cloneFrozen(value) as unknown as LocalOfflinePreviewSandboxEffectiveControls;
}

function fixedPersistence(value: unknown): boolean {
  return canonicalEqual(value, LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM);
}

function fixedLimitations(value: unknown): boolean {
  return canonicalEqual(value, LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS);
}

export function compileLocalOfflinePreviewSandboxPolicy(
  configurationInput: unknown,
): LocalOfflinePreviewSandboxPolicy | null {
  const configuration = parseLocalOfflinePreviewContainerConfiguration(
    configurationInput,
  );
  if (configuration === null) return null;
  const material = {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_SANDBOX_POLICY_V0,
    backend: LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND,
    authority: "none" as const,
    fallbackPolicy: "block" as const,
    productionExecution: "disabled" as const,
    workerKind: configuration.workerKind,
    workerProtocolSha256: configuration.workerProtocolSha256,
    workerArtifactSha256: configuration.workerArtifactSha256,
    effectiveControls: controlsFromConfiguration(configuration),
    persistence: LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM,
    limitations: LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS,
  };
  return deepFreeze({
    ...material,
    policyDigest: digest(POLICY_DOMAIN, material),
  });
}

export function parseLocalOfflinePreviewSandboxPolicy(
  value: unknown,
): LocalOfflinePreviewSandboxPolicy | null {
  if (!isPlainObject(value) || !hasExactKeys(value, POLICY_KEYS)) return null;
  const controls = parseControls(value.effectiveControls);
  if (
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_SANDBOX_POLICY_V0 ||
    value.backend !== LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND ||
    value.authority !== "none" ||
    value.fallbackPolicy !== "block" ||
    value.productionExecution !== "disabled" ||
    value.workerKind !== "offline_normalization_preview" ||
    !isDigest(value.workerProtocolSha256) ||
    !isDigest(value.workerArtifactSha256) ||
    controls === null ||
    !fixedPersistence(value.persistence) ||
    !fixedLimitations(value.limitations) ||
    !isDigest(value.policyDigest)
  ) {
    return null;
  }
  const expected = digest(POLICY_DOMAIN, withoutDigest(value, "policyDigest"));
  if (value.policyDigest !== expected) return null;
  return cloneFrozen(value) as unknown as LocalOfflinePreviewSandboxPolicy;
}

function parseByteBinding(
  value: unknown,
): LocalOfflinePreviewSandboxByteBinding | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, BYTE_BINDING_KEYS) ||
    !isSafePositiveInteger(value.sizeBytes) ||
    !isDigest(value.sha256)
  ) {
    return null;
  }
  return Object.freeze({ sizeBytes: value.sizeBytes, sha256: value.sha256 });
}

function isTerminalState(value: unknown): value is LocalOfflinePreviewSandboxTerminalState {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, TERMINAL_KEYS) &&
    value.status === "exited" &&
    value.running === false &&
    value.pid === 0 &&
    value.exitCode === 0 &&
    value.oomKilled === false &&
    value.dead === false
  );
}

function receiptMaterialIsValid(
  value: JsonObject,
  policy: LocalOfflinePreviewSandboxPolicy | null,
): boolean {
  const controls = parseControls(value.effectiveControls);
  const wireInput = parseByteBinding(value.wireInput);
  const wireOutput = parseByteBinding(value.wireOutput);
  const source = parseByteBinding(value.source);
  const candidate = parseByteBinding(value.candidate);
  const phaseValid =
    (value.phase === "transform" && value.verificationResult === "not_applicable") ||
    (value.phase === "fresh_verifier" && value.verificationResult === "exact_match");
  if (
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_SANDBOX_TERMINAL_RECEIPT_V0 ||
    value.backend !== LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND ||
    value.authority !== "none" ||
    value.sandboxEstablished !== true ||
    !phaseValid ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    !isDigest(value.policyDigest) ||
    !isDigest(value.engineDigest) ||
    !isDigest(value.containerConfigurationDigest) ||
    !isDigest(value.containerIdentityDigest) ||
    !isCanonicalUtc(value.deadlineAt) ||
    !isCanonicalUtc(value.startedAt) ||
    !isCanonicalUtc(value.finishedAt) ||
    Date.parse(value.startedAt) >= Date.parse(value.finishedAt) ||
    Date.parse(value.finishedAt) > Date.parse(value.deadlineAt) ||
    wireInput === null ||
    wireOutput === null ||
    source === null ||
    candidate === null ||
    !isDigest(value.reportSha256) ||
    !isTerminalState(value.terminal) ||
    controls === null ||
    value.containerRemoved !== true ||
    value.exactPrivateLabelAbsent !== true ||
    !isDigest(value.privateLabelDigest) ||
    value.matchingPrivateLabelContainerCount !== 0
  ) {
    return false;
  }
  if (
    wireInput.sizeBytes > controls.maximumInputBytes ||
    wireOutput.sizeBytes > controls.maximumOutputBytes ||
    Date.parse(value.finishedAt) - Date.parse(value.startedAt) >
      controls.maximumRuntimeMilliseconds
  ) {
    return false;
  }
  return (
    policy === null ||
    (value.policyDigest === policy.policyDigest &&
      canonicalEqual(controls, policy.effectiveControls))
  );
}

export function createLocalOfflinePreviewSandboxTerminalReceipt(
  input: LocalOfflinePreviewSandboxTerminalReceiptInput,
  policy: LocalOfflinePreviewSandboxPolicy,
): LocalOfflinePreviewSandboxTerminalReceipt | null {
  const parsedPolicy = parseLocalOfflinePreviewSandboxPolicy(policy);
  if (parsedPolicy === null) return null;
  const material = {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_SANDBOX_TERMINAL_RECEIPT_V0,
    backend: LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND,
    authority: "none" as const,
    sandboxEstablished: true as const,
    ...structuredClone(input),
  };
  if (!isPlainObject(material) || !receiptMaterialIsValid(material, parsedPolicy)) {
    return null;
  }
  return deepFreeze({
    ...material,
    receiptDigest: digest(RECEIPT_DOMAIN, material),
  }) as LocalOfflinePreviewSandboxTerminalReceipt;
}

export function parseLocalOfflinePreviewSandboxTerminalReceipt(
  value: unknown,
  policy?: LocalOfflinePreviewSandboxPolicy,
): LocalOfflinePreviewSandboxTerminalReceipt | null {
  if (!isPlainObject(value) || !hasExactKeys(value, RECEIPT_KEYS)) return null;
  const parsedPolicy =
    policy === undefined ? null : parseLocalOfflinePreviewSandboxPolicy(policy);
  if (policy !== undefined && parsedPolicy === null) return null;
  if (!receiptMaterialIsValid(value, parsedPolicy) || !isDigest(value.receiptDigest)) {
    return null;
  }
  const expected = digest(RECEIPT_DOMAIN, withoutDigest(value, "receiptDigest"));
  if (value.receiptDigest !== expected) return null;
  return cloneFrozen(value) as unknown as LocalOfflinePreviewSandboxTerminalReceipt;
}

export function createLocalOfflinePreviewSandboxEvidence(input: Readonly<{
  policy: LocalOfflinePreviewSandboxPolicy;
  transformReceipt: LocalOfflinePreviewSandboxTerminalReceipt;
  freshVerifierReceipt: LocalOfflinePreviewSandboxTerminalReceipt;
}>): LocalOfflinePreviewSandboxEvidence | null {
  const policy = parseLocalOfflinePreviewSandboxPolicy(input.policy);
  if (policy === null) return null;
  const transform = parseLocalOfflinePreviewSandboxTerminalReceipt(
    input.transformReceipt,
    policy,
  );
  const verifier = parseLocalOfflinePreviewSandboxTerminalReceipt(
    input.freshVerifierReceipt,
    policy,
  );
  if (
    transform === null ||
    verifier === null ||
    transform.phase !== "transform" ||
    verifier.phase !== "fresh_verifier" ||
    transform.requestId !== verifier.requestId ||
    transform.engineDigest !== verifier.engineDigest ||
    !canonicalEqual(transform.source, verifier.source) ||
    !canonicalEqual(transform.candidate, verifier.candidate) ||
    transform.reportSha256 !== verifier.reportSha256 ||
    transform.containerIdentityDigest === verifier.containerIdentityDigest ||
    Date.parse(verifier.startedAt) <= Date.parse(transform.finishedAt) ||
    transform.privateLabelDigest === verifier.privateLabelDigest
  ) {
    return null;
  }
  const material = {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_SANDBOX_EVIDENCE_V0,
    backend: LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND,
    authority: "none" as const,
    productionExecution: "disabled" as const,
    sandboxEstablished: true as const,
    requestId: transform.requestId,
    policyDigest: policy.policyDigest,
    engineDigest: transform.engineDigest,
    source: cloneFrozen(transform.source),
    candidate: cloneFrozen(transform.candidate),
    reportSha256: transform.reportSha256,
    transformReceiptDigest: transform.receiptDigest,
    freshVerifierReceiptDigest: verifier.receiptDigest,
    distinctContainers: true as const,
    freshVerifierStartedAfterTransformFinished: true as const,
    bothContainersRemoved: true as const,
    privateLabelOrphanScanEmpty: true as const,
    persistence: LOCAL_OFFLINE_PREVIEW_SANDBOX_PERSISTENCE_CLAIM,
    limitations: LOCAL_OFFLINE_PREVIEW_SANDBOX_LIMITATIONS,
  };
  return deepFreeze({
    ...material,
    evidenceDigest: digest(EVIDENCE_DOMAIN, material),
  });
}

export function parseLocalOfflinePreviewSandboxEvidence(
  value: unknown,
): LocalOfflinePreviewSandboxEvidence | null {
  if (!isPlainObject(value) || !hasExactKeys(value, EVIDENCE_KEYS)) return null;
  if (
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_SANDBOX_EVIDENCE_V0 ||
    value.backend !== LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND ||
    value.authority !== "none" ||
    value.productionExecution !== "disabled" ||
    value.sandboxEstablished !== true ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    !isDigest(value.policyDigest) ||
    !isDigest(value.engineDigest) ||
    parseByteBinding(value.source) === null ||
    parseByteBinding(value.candidate) === null ||
    !isDigest(value.reportSha256) ||
    !isDigest(value.transformReceiptDigest) ||
    !isDigest(value.freshVerifierReceiptDigest) ||
    value.transformReceiptDigest === value.freshVerifierReceiptDigest ||
    value.distinctContainers !== true ||
    value.freshVerifierStartedAfterTransformFinished !== true ||
    value.bothContainersRemoved !== true ||
    value.privateLabelOrphanScanEmpty !== true ||
    !fixedPersistence(value.persistence) ||
    !fixedLimitations(value.limitations) ||
    !isDigest(value.evidenceDigest)
  ) {
    return null;
  }
  const expected = digest(EVIDENCE_DOMAIN, withoutDigest(value, "evidenceDigest"));
  if (value.evidenceDigest !== expected) return null;
  return cloneFrozen(value) as unknown as LocalOfflinePreviewSandboxEvidence;
}

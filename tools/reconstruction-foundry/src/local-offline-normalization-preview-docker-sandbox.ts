import { createHash, randomBytes, type KeyObject } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { types as nodeUtilTypes } from "node:util";
import {
  computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
  verifyFoundryOfflineNormalizeMeshGlbPreviewPermit,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "@omnitwin/reconstruction-foundry";
import {
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.js";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
  parseLocalOfflinePreviewContainerConfiguration,
  preflightLocalOfflineNormalizationPreviewContainer,
  defaultLocalOfflinePreviewContainerFileProbe,
  type LocalOfflinePreviewContainerConfiguration,
  type LocalOfflinePreviewContainerPreflightDependencies,
} from "./local-offline-normalization-preview-container-preflight.js";
import {
  LocalOfflinePreviewPermitLeaseError,
  type LocalOfflinePreviewPermitLeaseStore,
} from "./local-offline-normalization-preview-permit-lease-store.js";
import {
  createLocalOfflinePreviewProductionPermitLeaseStore,
} from "./local-offline-normalization-preview-production-permit-lease-store.js";
import {
  getLocalOfflinePreviewBundledReleaseAuthority,
  readLocalOfflinePreviewBundledReleaseMaterial,
} from "./local-offline-normalization-preview-bundled-release.js";
import {
  compileLocalOfflinePreviewSandboxPolicy,
  createLocalOfflinePreviewSandboxEvidence,
  createLocalOfflinePreviewSandboxTerminalReceipt,
  LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND,
  parseLocalOfflinePreviewSandboxEvidence,
  type LocalOfflinePreviewSandboxByteBinding,
  type LocalOfflinePreviewSandboxEvidence,
  type LocalOfflinePreviewSandboxPolicy,
  type LocalOfflinePreviewSandboxTerminalReceipt,
} from "./local-offline-normalization-preview-sandbox-contract.js";

const PRIVATE_NAMESPACE_LABEL =
  "io.omnitwin.foundry.offline-preview-sandbox.namespace";
const PRIVATE_NAMESPACE_VALUE = "reservation-v0";
const LABEL_BACKEND = "io.omnitwin.foundry.offline-preview-sandbox.backend";
const LABEL_POLICY = "io.omnitwin.foundry.offline-preview-sandbox.policy";
const LABEL_REQUEST = "io.omnitwin.foundry.offline-preview-sandbox.request";
const LABEL_PHASE = "io.omnitwin.foundry.offline-preview-sandbox.phase";
const LABEL_DEADLINE = "io.omnitwin.foundry.offline-preview-sandbox.deadline-ms";
const LABEL_SESSION = "io.omnitwin.foundry.offline-preview-sandbox.session";
const LABEL_PRIVATE = "io.omnitwin.foundry.offline-preview-sandbox.private";
const BACKEND = LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND;
const COMMAND_METADATA_BYTES = 1024 * 1024;
const COMMAND_STDERR_BYTES = 64 * 1024;
const COMMAND_CONTROL_TIMEOUT_MS = 10_000;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export const LOCAL_OFFLINE_PREVIEW_DOCKER_SANDBOX_ERROR_CODES = [
  "CONFIGURATION_REJECTED",
  "PREFLIGHT_BLOCKED",
  "PID1_WATCHDOG_NOT_PROVED",
  "ENGINE_PROBE_FAILED",
  "RECONCILIATION_FAILED",
  "FOREIGN_RESERVATION_ACTIVE",
  "AUTHORITY_REJECTED",
  "PERMIT_REPLAY_REJECTED",
  "PERMIT_LEDGER_REJECTED",
  "DEADLINE_REJECTED",
  "RESERVATION_FAILED",
  "CONTAINER_CONFIGURATION_REJECTED",
  "REQUEST_REJECTED",
  "PHASE_ORDER_REJECTED",
  "EXECUTION_CANCELLED",
  "EXECUTION_TIMED_OUT",
  "WIRE_OUTPUT_LIMIT_EXCEEDED",
  "WORKER_REJECTED",
  "WORKER_RESPONSE_REJECTED",
  "TERMINAL_STATE_REJECTED",
  "CLEANUP_UNPROVED",
  "PROCESS_TERMINATION_UNCONFIRMED",
  "LIFECYCLE_FILE_IDENTITY_REJECTED",
  "BUNDLED_RELEASE_UNAVAILABLE",
  "RESERVATION_INPUT_REJECTED",
  "BACKEND_STOPPED",
  "INTERNAL_FAILURE",
] as const;

export type LocalOfflinePreviewDockerSandboxErrorCode =
  (typeof LOCAL_OFFLINE_PREVIEW_DOCKER_SANDBOX_ERROR_CODES)[number];

export class LocalOfflinePreviewDockerSandboxError extends Error {
  readonly code: LocalOfflinePreviewDockerSandboxErrorCode;

  constructor(code: LocalOfflinePreviewDockerSandboxErrorCode) {
    super(`Offline preview container operation blocked (${code}).`);
    this.name = "LocalOfflinePreviewDockerSandboxError";
    this.code = code;
  }
}

export interface LocalOfflinePreviewDockerCommandRequest {
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly stdin: Uint8Array | null;
  readonly timeoutMilliseconds: number;
  readonly maximumStdoutBytes: number;
  readonly maximumStderrBytes: number;
  readonly signal?: AbortSignal;
}

export type LocalOfflinePreviewDockerCommandResult =
  | Readonly<{
      outcome: "completed";
      exitCode: number | null;
      stdout: Buffer;
      stderrByteLength: number;
    }>
  | Readonly<{
      outcome: "timed_out" | "output_limit_exceeded" | "failed_to_start" | "aborted" |
        "termination_unconfirmed";
    }>;

export type LocalOfflinePreviewDockerCommandExecutor = (
  request: LocalOfflinePreviewDockerCommandRequest,
) => Promise<LocalOfflinePreviewDockerCommandResult>;

export interface LocalOfflinePreviewDockerSandboxTestDependencies {
  readonly preflightDependencies?: LocalOfflinePreviewContainerPreflightDependencies;
  readonly commandExecutor: LocalOfflinePreviewDockerCommandExecutor;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly now: () => number;
  readonly decodeWire?: (bytes: Uint8Array) => unknown;
  readonly verifyPermit?: (options: Readonly<{
    readonly invocation: unknown;
    readonly permitEnvelope: unknown;
    readonly pinnedTrustedPermitKeys: ReadonlyMap<string, KeyObject>;
  }>) => Readonly<{
    readonly invocation: unknown;
    readonly permitPayloadSha256: string;
    readonly validFrom: string;
    readonly expiresAt: string;
  }>;
  readonly computeReportSha256?: typeof computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256;
  readonly computeInvocationSha256?: typeof computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256;
  readonly permitLeaseStore: LocalOfflinePreviewPermitLeaseStore;
  /** Test-only paths may omit this; such paths can never mint a live witness. */
  readonly dockerExecutableArtifactSha256?: string;
  readonly releaseManifestSha256?: string;
  readonly qualificationReportSha256?: string;
}

type TestDependencies = LocalOfflinePreviewDockerSandboxTestDependencies;

export interface LocalOfflinePreviewDockerSandboxTestFactoryOptions {
  readonly configurationInput: unknown;
  /** Process-owned Ed25519 keys. Browser or file-input keyrings are forbidden. */
  readonly pinnedTrustedPermitKeys: ReadonlyMap<string, KeyObject>;
}

export interface LocalOfflinePreviewDockerSandboxReservationInput {
  /** Source binding and authority metadata only. Source bytes are forbidden here. */
  readonly invocation: unknown;
  readonly permitEnvelope: unknown;
  readonly deadlineAt: string;
}

export interface LocalOfflinePreviewDockerSandboxSerializedWitness {
  readonly sandboxEstablished: false;
  readonly claimStatus: "unauthenticated_integrity_claim";
  readonly attestationAuthority: "none";
}

export interface LocalOfflinePreviewDockerSandboxLiveWitness {
  readonly sandboxEstablished: true;
  readonly backend: typeof BACKEND;
  readonly requestId: string;
  readonly deadlineAt: string;
  readonly invocationSha256: string;
  readonly permitPayloadSha256: string;
  readonly policyDigest: string;
  readonly engineDigest: string;
  readonly source: LocalOfflinePreviewSandboxByteBinding;
  readonly candidate: LocalOfflinePreviewSandboxByteBinding;
  readonly reportSha256: string;
  readonly evidenceDigest: string;
  readonly releaseManifestSha256: string;
  readonly qualificationReportSha256: string;
  toJSON(): LocalOfflinePreviewDockerSandboxSerializedWitness;
}

export interface LocalOfflinePreviewDockerSandboxTransformResult {
  readonly outputBytes: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  readonly receiptClaim: LocalOfflinePreviewSandboxTerminalReceipt;
}

export interface LocalOfflinePreviewDockerSandboxVerificationResult {
  readonly receiptClaim: LocalOfflinePreviewSandboxTerminalReceipt;
  readonly evidenceClaim: LocalOfflinePreviewSandboxEvidence;
  /** Null for every dependency-injected/test backend. */
  readonly liveWitness: LocalOfflinePreviewDockerSandboxLiveWitness | null;
}

export interface LocalOfflinePreviewDockerSandboxSession {
  readonly requestId: string;
  readonly deadlineAt: string;
  runTransform(
    wire: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxTransformResult>;
  runFreshVerifier(
    wire: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxVerificationResult>;
  stop(): Promise<void>;
}

export interface LocalOfflinePreviewDockerSandboxBackend {
  readonly runtimeMode:
    | "cryptographically_verified_bundled_qualification_private_preview"
    | "test_only_disabled";
  readonly liveAuthorityCapable: boolean;
  readonly authority: "cryptographically_verified_bundled_release" | "none";
  readonly productionUse: "disabled";
  readonly policy: LocalOfflinePreviewSandboxPolicy;
  reconcileExpired(): Promise<void>;
  reserveSession(
    input: LocalOfflinePreviewDockerSandboxReservationInput,
  ): Promise<LocalOfflinePreviewDockerSandboxSession>;
  stopAll(): Promise<void>;
  toJSON(): Readonly<{
    runtimeMode: "test_only_disabled";
    liveAuthorityCapable: false;
    authority: "none";
    productionUse: "disabled";
  }>;
}

const liveWitnesses = new WeakSet();
const liveWitnessMintAuthority = Object.freeze({
  purpose: "module_private_live_witness_mint",
});
const sessionMintAuthority = Object.freeze({
  purpose: "module_private_session_mint",
});
const PROCESS_TERMINATION_CONFIRMATION_MS = 2_000;

class LiveWitness implements LocalOfflinePreviewDockerSandboxLiveWitness {
  readonly sandboxEstablished = true as const;
  readonly backend = BACKEND;
  readonly requestId: string;
  readonly deadlineAt: string;
  readonly invocationSha256: string;
  readonly permitPayloadSha256: string;
  readonly policyDigest: string;
  readonly engineDigest: string;
  readonly source: LocalOfflinePreviewSandboxByteBinding;
  readonly candidate: LocalOfflinePreviewSandboxByteBinding;
  readonly reportSha256: string;
  readonly evidenceDigest: string;
  readonly releaseManifestSha256: string;
  readonly qualificationReportSha256: string;

  constructor(mintAuthority: object, binding: Readonly<{
    readonly requestId: string;
    readonly deadlineAt: string;
    readonly invocationSha256: string;
    readonly permitPayloadSha256: string;
    readonly policyDigest: string;
    readonly engineDigest: string;
    readonly source: LocalOfflinePreviewSandboxByteBinding;
    readonly candidate: LocalOfflinePreviewSandboxByteBinding;
    readonly reportSha256: string;
    readonly evidenceDigest: string;
    readonly releaseManifestSha256: string;
    readonly qualificationReportSha256: string;
  }>) {
    if (mintAuthority !== liveWitnessMintAuthority) {
      throw new TypeError("Live sandbox witnesses can only be minted by the production runner.");
    }
    this.requestId = binding.requestId;
    this.deadlineAt = binding.deadlineAt;
    this.invocationSha256 = binding.invocationSha256;
    this.permitPayloadSha256 = binding.permitPayloadSha256;
    this.policyDigest = binding.policyDigest;
    this.engineDigest = binding.engineDigest;
    this.source = Object.freeze({ ...binding.source });
    this.candidate = Object.freeze({ ...binding.candidate });
    this.reportSha256 = binding.reportSha256;
    this.evidenceDigest = binding.evidenceDigest;
    this.releaseManifestSha256 = binding.releaseManifestSha256;
    this.qualificationReportSha256 = binding.qualificationReportSha256;
    liveWitnesses.add(this);
    Object.freeze(this);
  }

  toJSON(): LocalOfflinePreviewDockerSandboxSerializedWitness {
    return Object.freeze({
      sandboxEstablished: false,
      claimStatus: "unauthenticated_integrity_claim",
      attestationAuthority: "none",
    });
  }
}

Object.freeze(LiveWitness.prototype);

export function isLocalOfflinePreviewDockerSandboxLiveWitness(
  value: unknown,
): value is LocalOfflinePreviewDockerSandboxLiveWitness {
  return typeof value === "object" && value !== null && liveWitnesses.has(value);
}

/**
 * Authenticates that a process-live witness belongs to this exact serialized
 * evidence claim. The serialized claim remains authority-none on its own.
 */
export function localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence(
  witness: unknown,
  evidenceInput: unknown,
): boolean {
  if (!isLocalOfflinePreviewDockerSandboxLiveWitness(witness)) return false;
  let evidence: LocalOfflinePreviewSandboxEvidence | null;
  try {
    evidence = parseLocalOfflinePreviewSandboxEvidence(evidenceInput);
  } catch {
    return false;
  }
  return evidence !== null &&
    witness.requestId === evidence.requestId &&
    witness.policyDigest === evidence.policyDigest &&
    witness.engineDigest === evidence.engineDigest &&
    witness.reportSha256 === evidence.reportSha256 &&
    witness.evidenceDigest === evidence.evidenceDigest &&
    witness.source.sizeBytes === evidence.source.sizeBytes &&
    witness.source.sha256 === evidence.source.sha256 &&
    witness.candidate.sizeBytes === evidence.candidate.sizeBytes &&
    witness.candidate.sha256 === evidence.candidate.sha256;
}

function fail(code: LocalOfflinePreviewDockerSandboxErrorCode): never {
  throw new LocalOfflinePreviewDockerSandboxError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return stableCanonicalJson(toCanonicalJson(left)) ===
      stableCanonicalJson(toCanonicalJson(right));
  } catch {
    return false;
  }
}

interface JsonSnapshotBudget {
  nodes: number;
  utf8Bytes: number;
}

const MAX_RESERVATION_JSON_NODES = 100_000;
const MAX_RESERVATION_JSON_UTF8_BYTES = 2 * 1024 * 1024;
const MAX_RESERVATION_JSON_DEPTH = 64;

function snapshotJsonData(
  value: unknown,
  budget: JsonSnapshotBudget,
  depth: number,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_RESERVATION_JSON_NODES || depth > MAX_RESERVATION_JSON_DEPTH) {
    fail("RESERVATION_INPUT_REJECTED");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.utf8Bytes += Buffer.byteLength(value, "utf8");
    if (budget.utf8Bytes > MAX_RESERVATION_JSON_UTF8_BYTES) {
      fail("RESERVATION_INPUT_REJECTED");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail("RESERVATION_INPUT_REJECTED");
    }
    return value;
  }
  if (typeof value !== "object") fail("RESERVATION_INPUT_REJECTED");
  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    fail("RESERVATION_INPUT_REJECTED");
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_RESERVATION_JSON_NODES
    ) fail("RESERVATION_INPUT_REJECTED");
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string") || keys.length !== length + 1) {
      fail("RESERVATION_INPUT_REJECTED");
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        fail("RESERVATION_INPUT_REJECTED");
      }
      output.push(snapshotJsonData(descriptor.value, budget, depth + 1));
    }
    return Object.freeze(output);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("RESERVATION_INPUT_REJECTED");
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key.length === 0 || key.length > 1_024) {
      fail("RESERVATION_INPUT_REJECTED");
    }
    budget.utf8Bytes += Buffer.byteLength(key, "utf8");
    const descriptor = descriptors[key];
    if (
      descriptor === undefined || !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      budget.utf8Bytes > MAX_RESERVATION_JSON_UTF8_BYTES
    ) fail("RESERVATION_INPUT_REJECTED");
    Object.defineProperty(output, key, {
      value: snapshotJsonData(descriptor.value, budget, depth + 1),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(output);
}

function snapshotReservationInput(
  input: unknown,
): LocalOfflinePreviewDockerSandboxReservationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("RESERVATION_INPUT_REJECTED");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    fail("RESERVATION_INPUT_REJECTED");
  }
  const keys = Reflect.ownKeys(descriptors);
  const expected = new Set(["invocation", "permitEnvelope", "deadlineAt"]);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) fail("RESERVATION_INPUT_REJECTED");
  const valueOf = (key: "invocation" | "permitEnvelope" | "deadlineAt"): unknown => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("RESERVATION_INPUT_REJECTED");
    }
    return descriptor.value;
  };
  const deadlineAt = valueOf("deadlineAt");
  if (typeof deadlineAt !== "string") fail("RESERVATION_INPUT_REJECTED");
  const budget: JsonSnapshotBudget = { nodes: 0, utf8Bytes: Buffer.byteLength(deadlineAt) };
  return Object.freeze({
    invocation: snapshotJsonData(valueOf("invocation"), budget, 0),
    permitEnvelope: snapshotJsonData(valueOf("permitEnvelope"), budget, 0),
    deadlineAt,
  });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function observationDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function canonicalUtc(value: string): boolean {
  if (!CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function randomHex(dependencies: Pick<TestDependencies, "randomBytes">, bytes: number): string {
  const result = Buffer.from(dependencies.randomBytes(bytes));
  if (result.byteLength !== bytes) fail("INTERNAL_FAILURE");
  return result.toString("hex");
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  return process.platform === "win32"
    ? { DOCKER_HOST: "npipe:////./pipe/dockerDesktopLinuxEngine" }
    : { DOCKER_HOST: "unix:///var/run/docker.sock" };
}

interface BackpressureWriter {
  readonly erase: () => void;
  readonly start: () => void;
}

function createBackpressureWriter(
  child: ChildProcessWithoutNullStreams,
  bytes: Uint8Array,
  onFailure: () => void,
): BackpressureWriter {
  const source = Buffer.from(bytes);
  let cursor = 0;
  const pump = (): void => {
    try {
      while (cursor < source.length) {
        const end = Math.min(cursor + 64 * 1024, source.length);
        const chunk = source.subarray(cursor, end);
        cursor = end;
        if (!child.stdin.write(chunk)) {
          child.stdin.once("drain", pump);
          return;
        }
      }
      child.stdin.end();
    } catch {
      onFailure();
    }
  };
  return Object.freeze({
    erase: (): void => { source.fill(0); },
    start: (): void => {
      try {
        pump();
      } catch {
        onFailure();
      }
    },
  });
}

interface AbortSignalBridge {
  readonly controller: AbortController;
  readonly detach: () => void;
}

/**
 * Snapshots a caller-owned signal into a genuine process-owned controller.
 * Native EventTarget operations avoid caller-overridden methods, and Proxies
 * are rejected before any process can be started.
 */
function createAbortSignalBridge(signal: unknown): AbortSignalBridge | null {
  const controller = new AbortController();
  if (signal === undefined) {
    return Object.freeze({ controller, detach: (): void => undefined });
  }
  if (
    typeof signal !== "object" || signal === null ||
    nodeUtilTypes.isProxy(signal)
  ) return null;
  let attached = false;
  let detached = false;
  const forwardAbort = (): void => { controller.abort(); };
  const detach = (): void => {
    if (!attached || detached) return;
    detached = true;
    try {
      EventTarget.prototype.removeEventListener.call(signal, "abort", forwardAbort);
    } catch {
      // The process-owned signal remains authoritative even if detachment fails.
    }
  };
  try {
    if (!(signal instanceof AbortSignal)) return null;
    attached = true;
    EventTarget.prototype.addEventListener.call(signal, "abort", forwardAbort, { once: true });
    const aborted: unknown = Reflect.get(AbortSignal.prototype, "aborted", signal);
    if (typeof aborted !== "boolean") throw new TypeError("Invalid AbortSignal state.");
    if (aborted) controller.abort();
  } catch {
    detach();
    return null;
  }
  return Object.freeze({ controller, detach });
}

export const defaultLocalOfflinePreviewDockerCommandExecutor:
LocalOfflinePreviewDockerCommandExecutor = async (request) => {
  let executablePath: string;
  let argumentsList: string[];
  let stdinSnapshot: Buffer | null;
  let timeoutMilliseconds: number;
  let maximumStdoutBytes: number;
  let maximumStderrBytes: number;
  let callerSignal: unknown;
  try {
    executablePath = request.executablePath;
    argumentsList = [...request.arguments];
    timeoutMilliseconds = request.timeoutMilliseconds;
    maximumStdoutBytes = request.maximumStdoutBytes;
    maximumStderrBytes = request.maximumStderrBytes;
    callerSignal = request.signal;
    const callerStdin: unknown = request.stdin;
    if (
      typeof executablePath !== "string" || executablePath.length === 0 ||
      argumentsList.length === 0 ||
      argumentsList.some((value) => typeof value !== "string") ||
      timeoutMilliseconds < 1 ||
      maximumStdoutBytes < 1 ||
      maximumStderrBytes < 1 ||
      (callerStdin !== null && (
        typeof callerStdin !== "object" || nodeUtilTypes.isProxy(callerStdin) ||
        !(callerStdin instanceof Uint8Array)
      ))
    ) return { outcome: "failed_to_start" };
    stdinSnapshot = callerStdin === null ? null : Buffer.from(callerStdin);
  } catch {
    return { outcome: "failed_to_start" };
  }
  const callerSignalBridge = createAbortSignalBridge(callerSignal);
  if (callerSignalBridge === null) {
    stdinSnapshot?.fill(0);
    return { outcome: "failed_to_start" };
  }
  const internalSignal = callerSignalBridge.controller.signal;
  if (internalSignal.aborted) {
    stdinSnapshot?.fill(0);
    callerSignalBridge.detach();
    return { outcome: "aborted" };
  }
  return await new Promise<LocalOfflinePreviewDockerCommandResult>((resolve) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const chunks: Buffer[] = [];
    let eraseInput: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let terminationTimer: ReturnType<typeof setTimeout> | null = null;
    let terminationOutcome:
      "timed_out" | "output_limit_exceeded" | "aborted" | "failed_to_start" | null = null;
    let child: ChildProcessWithoutNullStreams | null = null;
    let abortListenerAttached = false;
    const eraseChunks = (): void => {
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
    };
    const finish = (result: LocalOfflinePreviewDockerCommandResult): void => {
      if (settled) return;
      settled = true;
      try { eraseInput?.(); } catch { /* best-effort zeroization */ }
      eraseInput = null;
      stdinSnapshot?.fill(0);
      stdinSnapshot = null;
      if (timer !== null) clearTimeout(timer);
      if (terminationTimer !== null) clearTimeout(terminationTimer);
      if (abortListenerAttached) {
        try {
          EventTarget.prototype.removeEventListener.call(internalSignal, "abort", abort);
        } catch {
          // Resolution and cleanup cannot depend on listener removal.
        }
      }
      callerSignalBridge.detach();
      resolve(result);
    };
    const terminate = (
      outcome: "timed_out" | "output_limit_exceeded" | "aborted" | "failed_to_start",
    ): void => {
      if (settled || terminationOutcome !== null) return;
      terminationOutcome = outcome;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      eraseChunks();
      const activeChild = child;
      if (activeChild === null) {
        finish({ outcome });
        return;
      }
      try { activeChild.stdin.destroy(); } catch { /* confirmation timer remains authoritative */ }
      try { activeChild.stdout.destroy(); } catch { /* confirmation timer remains authoritative */ }
      try { activeChild.stderr.destroy(); } catch { /* confirmation timer remains authoritative */ }
      try { activeChild.kill("SIGKILL"); } catch { /* confirmation timer remains authoritative */ }
      try { activeChild.unref(); } catch { /* confirmation timer remains authoritative */ }
      terminationTimer = setTimeout(() => {
        finish({ outcome: "termination_unconfirmed" });
      }, PROCESS_TERMINATION_CONFIRMATION_MS);
    };
    const abort = (): void => {
      terminate("aborted");
    };
    try {
      child = spawn(executablePath, argumentsList, {
        env: dockerEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish({ outcome: "failed_to_start" });
      return;
    }
    const spawnedChild = child;
    try {
      const streamError = (): void => { terminate("failed_to_start"); };
      spawnedChild.stdin.on("error", streamError);
      spawnedChild.stdout.on("error", streamError);
      spawnedChild.stderr.on("error", streamError);
      spawnedChild.stdout.on("data", (chunk: Buffer | string) => {
        if (settled || terminationOutcome !== null) return;
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        stdoutBytes += buffer.byteLength;
        if (stdoutBytes > maximumStdoutBytes) {
          terminate("output_limit_exceeded");
        } else {
          chunks.push(Buffer.from(buffer));
        }
      });
      spawnedChild.stderr.on("data", (chunk: Buffer | string) => {
        if (settled || terminationOutcome !== null) return;
        stderrBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
        if (stderrBytes > maximumStderrBytes) terminate("output_limit_exceeded");
      });
      spawnedChild.once("error", () => {
        eraseChunks();
        if (terminationOutcome !== null) return;
        finish({ outcome: "failed_to_start" });
      });
      spawnedChild.once("close", (exitCode) => {
        if (terminationOutcome !== null) {
          eraseChunks();
          finish({ outcome: terminationOutcome });
          return;
        }
        const stdout = Buffer.concat(chunks, stdoutBytes);
        eraseChunks();
        finish({
          outcome: "completed",
          exitCode,
          stdout,
          stderrByteLength: stderrBytes,
        });
      });
      abortListenerAttached = true;
      EventTarget.prototype.addEventListener.call(internalSignal, "abort", abort, { once: true });
      if (internalSignal.aborted) {
        abort();
        return;
      }
      timer = setTimeout(() => {
        terminate("timed_out");
      }, timeoutMilliseconds);
      if (stdinSnapshot === null) spawnedChild.stdin.end();
      else {
        const writer = createBackpressureWriter(spawnedChild, stdinSnapshot, () => {
          terminate("failed_to_start");
        });
        eraseInput = writer.erase;
        writer.start();
      }
    } catch {
      terminate("failed_to_start");
    }
  });
};

function provePid1Watchdog(configuration: LocalOfflinePreviewContainerConfiguration): boolean {
  const entrypoint = configuration.fixedEntrypoint;
  const seconds = Math.ceil(configuration.resourceLimits.maximumRuntimeMilliseconds / 1_000);
  return (
    configuration.runtimeWatchdog.maximumRuntimeMilliseconds ===
      configuration.resourceLimits.maximumRuntimeMilliseconds &&
    entrypoint[0] === "/bin/busybox" &&
    entrypoint[1] === "timeout" &&
    entrypoint[2] === "-s" &&
    entrypoint[3] === "KILL" &&
    entrypoint[4] === `${String(seconds)}s` &&
    entrypoint[5] === "/usr/local/bin/node" &&
    entrypoint.at(-1) === "/opt/worker/worker.mjs"
  );
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

async function revalidateLifecycleFiles(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
): Promise<void> {
  const probe = dependencies.preflightDependencies?.fileProbe ??
    defaultLocalOfflinePreviewContainerFileProbe;
  const expectedDockerDigest = dependencies.dockerExecutableArtifactSha256;
  const [docker, seccomp] = await Promise.all([
    probe({
      absolutePath: configuration.dockerExecutablePath,
      readContents: expectedDockerDigest !== undefined,
      maximumBytes: expectedDockerDigest === undefined ? 1 : 512 * 1024 * 1024,
    }),
    probe({
      absolutePath: configuration.seccompProfilePath,
      readContents: true,
      maximumBytes: 1024 * 1024,
    }),
  ] as const).catch(() => fail("LIFECYCLE_FILE_IDENTITY_REJECTED"));
  if (
    docker.outcome !== "ok" || docker.symbolicLink || docker.fileType !== "regular" ||
    !sameCanonicalPath(docker.canonicalPath, configuration.dockerExecutablePath) ||
    (expectedDockerDigest !== undefined && docker.contents === null) ||
    seccomp.outcome !== "ok" || seccomp.symbolicLink || seccomp.fileType !== "regular" ||
    !sameCanonicalPath(seccomp.canonicalPath, configuration.seccompProfilePath) ||
    seccomp.contents === null
  ) {
    if (docker.outcome === "ok") docker.contents?.fill(0);
    if (seccomp.outcome === "ok") seccomp.contents?.fill(0);
    fail("LIFECYCLE_FILE_IDENTITY_REJECTED");
  }
  if (expectedDockerDigest !== undefined && docker.contents !== null) {
    const dockerDigest = sha256(docker.contents);
    docker.contents.fill(0);
    if (dockerDigest !== expectedDockerDigest) {
      seccomp.contents.fill(0);
      fail("LIFECYCLE_FILE_IDENTITY_REJECTED");
    }
  }
  const digest = sha256(seccomp.contents);
  seccomp.contents.fill(0);
  if (digest !== configuration.seccompProfileSha256) {
    fail("LIFECYCLE_FILE_IDENTITY_REJECTED");
  }
}

async function command(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  argumentsList: readonly string[],
  options: Readonly<{
    stdin?: Uint8Array;
    timeout?: number;
    maxStdout?: number;
    signal?: AbortSignal;
  }> = {},
): Promise<LocalOfflinePreviewDockerCommandResult> {
  await revalidateLifecycleFiles(dependencies, configuration);
  return await dependencies.commandExecutor({
    executablePath: configuration.dockerExecutablePath,
    arguments: argumentsList,
    stdin: options.stdin ?? null,
    timeoutMilliseconds: options.timeout ?? COMMAND_CONTROL_TIMEOUT_MS,
    maximumStdoutBytes: options.maxStdout ?? COMMAND_METADATA_BYTES,
    maximumStderrBytes: COMMAND_STDERR_BYTES,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function completedCommand(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  argumentsList: readonly string[],
  errorCode: LocalOfflinePreviewDockerSandboxErrorCode,
  options: Parameters<typeof command>[3] = {},
): Promise<Buffer> {
  const result = await command(dependencies, configuration, argumentsList, options);
  if (result.outcome === "aborted") fail("EXECUTION_CANCELLED");
  if (result.outcome === "termination_unconfirmed") {
    fail("PROCESS_TERMINATION_UNCONFIRMED");
  }
  const execution = errorCode === "WORKER_RESPONSE_REJECTED";
  if (result.outcome === "timed_out") {
    fail(execution ? "EXECUTION_TIMED_OUT" : errorCode);
  }
  if (result.outcome === "output_limit_exceeded") {
    fail(execution ? "WIRE_OUTPUT_LIMIT_EXCEEDED" : errorCode);
  }
  if (result.outcome !== "completed") fail(errorCode);
  if (result.exitCode !== 0) {
    result.stdout.fill(0);
    fail(errorCode);
  }
  return result.stdout;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function engineDigest(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
): Promise<string> {
  const versionBytes = await completedCommand(
    dependencies,
    configuration,
    ["version", "--format", "{{json .}}"],
    "ENGINE_PROBE_FAILED",
  );
  const infoBytes = await completedCommand(
    dependencies,
    configuration,
    ["info", "--format", "{{json .}}"],
    "ENGINE_PROBE_FAILED",
  );
  const version = parseJson(versionBytes);
  const info = parseJson(infoBytes);
  versionBytes.fill(0);
  infoBytes.fill(0);
  if (version === null || info === null) fail("ENGINE_PROBE_FAILED");
  return observationDigest(
    "OMNITWIN_OFFLINE_PREVIEW_DOCKER_ENGINE_OBSERVATION_V0",
    { version, info },
  );
}

type Phase = "transform" | "fresh_verifier";

interface Reservation {
  readonly phase: Phase;
  readonly id: string;
  readonly name: string;
  readonly privateLabel: string;
  readonly privateLabelDigest: string;
  readonly containerIdentityDigest: string;
  readonly expectedLabels: Readonly<Record<string, string>>;
  containerConfigurationDigest: string;
  removed: boolean;
}

function labelArguments(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

function createArguments(
  configuration: LocalOfflinePreviewContainerConfiguration,
  policy: LocalOfflinePreviewSandboxPolicy,
  name: string,
  phase: Phase,
  requestId: string,
  deadline: number,
  sessionDigest: string,
  privateLabel: string,
): readonly string[] {
  const limits = configuration.resourceLimits;
  const labels = {
    [PRIVATE_NAMESPACE_LABEL]: PRIVATE_NAMESPACE_VALUE,
    [LABEL_BACKEND]: BACKEND,
    [LABEL_POLICY]: policy.policyDigest,
    [LABEL_REQUEST]: requestId,
    [LABEL_PHASE]: phase,
    [LABEL_DEADLINE]: String(deadline),
    [LABEL_SESSION]: sessionDigest,
    [LABEL_PRIVATE]: privateLabel,
  };
  return [
    "container", "create",
    "--pull=never",
    "--platform=linux/amd64",
    "--runtime=runc",
    "--name", name,
    "--hostname", "foundry-offline-preview",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    `--security-opt=seccomp=${configuration.seccompProfilePath}`,
    `--pids-limit=${String(limits.pidsLimit)}`,
    `--memory=${String(limits.memoryBytes)}`,
    `--memory-swap=${String(limits.memorySwapBytes)}`,
    `--cpus=${String(limits.cpuCores)}`,
    "--pid=private",
    "--ipc=none",
    "--cgroupns=private",
    "--shm-size=16777216",
    "--log-driver=none",
    "--no-healthcheck",
    "--restart=no",
    "--stop-signal=SIGKILL",
    "--stop-timeout=1",
    `--user=${String(configuration.userId)}:${String(configuration.groupId)}`,
    "--workdir=/",
    "--attach=stdin",
    "--attach=stdout",
    "--interactive",
    "--ulimit=nofile=64:64",
    "--ulimit=core=0:0",
    `--ulimit=fsize=${String(limits.maximumOutputBytes)}:${String(limits.maximumOutputBytes)}`,
    ...labelArguments(labels),
    configuration.imageReference,
  ];
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

function emptyArray(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function emptyObject(value: unknown): boolean {
  return value === null || (isPlainObject(value) && Object.keys(value).length === 0);
}

function exactRequiredLabels(
  value: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  if (!isPlainObject(value)) return false;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function inspectConfigurationMaterial(
  inspect: Record<string, unknown>,
  configuration: LocalOfflinePreviewContainerConfiguration,
  expectedLabels: Readonly<Record<string, string>>,
): Record<string, unknown> | null {
  const config = inspect.Config;
  const host = inspect.HostConfig;
  const mounts = inspect.Mounts;
  const networkSettings = inspect.NetworkSettings;
  if (!isPlainObject(config) || !isPlainObject(host) || !Array.isArray(mounts) ||
      !isPlainObject(networkSettings)) return null;
  const capDrop = stringArray(host.CapDrop);
  const capAdd = stringArray(host.CapAdd);
  const securityOpt = stringArray(host.SecurityOpt);
  const logConfig = host.LogConfig;
  const restartPolicy = host.RestartPolicy;
  const nanoCpus = configuration.resourceLimits.cpuCores * 1_000_000_000;
  if (
    inspect.Image !== configuration.imageId ||
    inspect.Path !== configuration.fixedEntrypoint[0] ||
    !canonicalEqual(inspect.Args, configuration.fixedEntrypoint.slice(1)) ||
    config.Image !== configuration.imageReference ||
    config.Hostname !== "foundry-offline-preview" ||
    config.User !== `${String(configuration.userId)}:${String(configuration.groupId)}` ||
    config.AttachStdin !== true || config.AttachStdout !== true || config.AttachStderr !== false ||
    config.Tty !== false || config.OpenStdin !== true ||
    !canonicalEqual(config.Entrypoint, configuration.fixedEntrypoint) ||
    !canonicalEqual(config.Env, LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2) ||
    config.WorkingDir !== LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2 ||
    config.StopSignal !== LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2 ||
    config.StopTimeout !== 1 ||
    !isPlainObject(config.Healthcheck) || !canonicalEqual(config.Healthcheck.Test, ["NONE"]) ||
    !emptyObject(config.ExposedPorts) || !emptyObject(config.Volumes) ||
    !emptyArray(config.Cmd) ||
    !exactRequiredLabels(config.Labels, expectedLabels) ||
    host.NetworkMode !== "none" || host.ReadonlyRootfs !== true || host.Privileged !== false ||
    capDrop === null || !canonicalEqual(capDrop, ["ALL"]) ||
    (capAdd !== null && capAdd.length !== 0) ||
    securityOpt === null || !securityOpt.includes("no-new-privileges=true") ||
    !securityOpt.includes(`seccomp=${configuration.seccompProfilePath}`) ||
    host.Runtime !== "runc" || host.PidMode !== "private" ||
    host.CgroupnsMode !== "private" || host.IpcMode !== "none" ||
    !isPlainObject(logConfig) || logConfig.Type !== "none" ||
    !isPlainObject(restartPolicy) || restartPolicy.Name !== "no" ||
    host.AutoRemove !== false || host.Memory !== configuration.resourceLimits.memoryBytes ||
    host.MemorySwap !== configuration.resourceLimits.memorySwapBytes ||
    host.PidsLimit !== configuration.resourceLimits.pidsLimit || host.NanoCpus !== nanoCpus ||
    host.ShmSize !== 16_777_216 ||
    !canonicalEqual(host.Ulimits, [
      { Name: "nofile", Soft: 64, Hard: 64 },
      { Name: "core", Soft: 0, Hard: 0 },
      {
        Name: "fsize",
        Soft: configuration.resourceLimits.maximumOutputBytes,
        Hard: configuration.resourceLimits.maximumOutputBytes,
      },
    ]) ||
    !emptyArray(host.Binds) || !emptyArray(host.Mounts) || !emptyArray(host.VolumesFrom) ||
    !emptyObject(host.Tmpfs) || !emptyArray(host.Devices) || !emptyArray(host.DeviceRequests) ||
    !emptyArray(host.Links) || !emptyArray(host.Dns) || !emptyArray(host.DnsOptions) ||
    !emptyArray(host.DnsSearch) || !emptyArray(host.ExtraHosts) || !emptyArray(host.GroupAdd) ||
    host.UTSMode !== "" || host.UsernsMode !== "" || host.CgroupParent !== "" ||
    host.PublishAllPorts !== false || !emptyObject(host.PortBindings) || mounts.length !== 0 ||
    !emptyObject(networkSettings.Networks)
  ) return null;
  return {
    image: config.Image,
    user: config.User,
    entrypoint: config.Entrypoint,
    environment: config.Env,
    workingDirectory: config.WorkingDir,
    stopSignal: config.StopSignal,
    stopTimeout: config.StopTimeout,
    healthcheckDisabled: true,
    networkMode: host.NetworkMode,
    readOnlyRoot: host.ReadonlyRootfs,
    privileged: host.Privileged,
    capDrop,
    capAdd: capAdd ?? [],
    securityOpt: [...securityOpt].sort(),
    runtime: host.Runtime,
    pidMode: host.PidMode,
    cgroupnsMode: host.CgroupnsMode,
    ipcMode: host.IpcMode,
    logDriver: logConfig.Type,
    restart: restartPolicy.Name,
    autoRemove: host.AutoRemove,
    resources: {
      memory: host.Memory,
      memorySwap: host.MemorySwap,
      pids: host.PidsLimit,
      nanoCpus: host.NanoCpus,
    },
    noHostMounts: true,
    noDevices: true,
    noPorts: true,
  };
}

function inspectObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 1 || !isPlainObject(parsed[0])) return null;
    return parsed[0];
  } catch {
    return null;
  }
}

function labelsFor(
  policy: LocalOfflinePreviewSandboxPolicy,
  requestId: string,
  phase: Phase,
  deadline: number,
  sessionDigest: string,
  privateLabel: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    [PRIVATE_NAMESPACE_LABEL]: PRIVATE_NAMESPACE_VALUE,
    [LABEL_BACKEND]: BACKEND,
    [LABEL_POLICY]: policy.policyDigest,
    [LABEL_REQUEST]: requestId,
    [LABEL_PHASE]: phase,
    [LABEL_DEADLINE]: String(deadline),
    [LABEL_SESSION]: sessionDigest,
    [LABEL_PRIVATE]: privateLabel,
  });
}

async function inspectContainer(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  id: string,
): Promise<Record<string, unknown>> {
  const bytes = await completedCommand(
    dependencies,
    configuration,
    ["container", "inspect", id],
    "CONTAINER_CONFIGURATION_REJECTED",
  );
  const inspect = inspectObject(bytes);
  bytes.fill(0);
  if (inspect === null) fail("CONTAINER_CONFIGURATION_REJECTED");
  return inspect;
}

function parseContainerId(bytes: Uint8Array): string | null {
  const value = Buffer.from(bytes).toString("utf8").trim();
  return CONTAINER_ID.test(value) ? value : null;
}

function parseListedIds(bytes: Uint8Array): readonly string[] | null {
  const text = Buffer.from(bytes).toString("utf8").trim();
  if (text.length === 0) return [];
  const values = text.split(/\r?\n/u);
  return values.every((value) => CONTAINER_ID.test(value)) ? values : null;
}

async function listedIds(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  filter: string,
): Promise<readonly string[]> {
  const bytes = await completedCommand(
    dependencies,
    configuration,
    ["container", "ls", "--all", "--filter", `label=${filter}`, "--format", "{{.ID}}", "--no-trunc"],
    "RECONCILIATION_FAILED",
  );
  const ids = parseListedIds(bytes);
  bytes.fill(0);
  if (ids === null) fail("RECONCILIATION_FAILED");
  return ids;
}

async function forceRemove(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  id: string,
): Promise<void> {
  const killed = await command(
    dependencies,
    configuration,
    ["container", "kill", "--signal", "KILL", id],
  );
  if (killed.outcome === "completed") killed.stdout.fill(0);
  if (killed.outcome === "termination_unconfirmed") {
    fail("CLEANUP_UNPROVED");
  }
  const removed = await completedCommand(
    dependencies,
    configuration,
    ["container", "rm", "--force", id],
    "CLEANUP_UNPROVED",
  );
  removed.fill(0);
}

async function provePrivateLabelAbsent(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  privateLabel: string,
): Promise<void> {
  const ids = await listedIds(dependencies, configuration, `${LABEL_PRIVATE}=${privateLabel}`);
  if (ids.length !== 0) fail("CLEANUP_UNPROVED");
}

async function cleanPreselectedCreate(
  context: InternalBackendContext,
  name: string,
  privateLabel: string,
  expectedLabels: Readonly<Record<string, string>>,
): Promise<void> {
  const ids = await listedIds(
    context.dependencies,
    context.configuration,
    `${LABEL_PRIVATE}=${privateLabel}`,
  );
  if (ids.length > 1) fail("CLEANUP_UNPROVED");
  for (const id of ids) {
    const inspect = await inspectContainer(
      context.dependencies,
      context.configuration,
      id,
    );
    if (
      inspect.Id !== id ||
      inspect.Name !== `/${name}` ||
      inspectConfigurationMaterial(
        inspect,
        context.configuration,
        expectedLabels,
      ) === null
    ) {
      fail("CLEANUP_UNPROVED");
    }
    await forceRemove(context.dependencies, context.configuration, id);
  }
  await provePrivateLabelAbsent(
    context.dependencies,
    context.configuration,
    privateLabel,
  );
}

async function removeReservation(
  dependencies: TestDependencies,
  configuration: LocalOfflinePreviewContainerConfiguration,
  reservation: Reservation,
): Promise<void> {
  if (!reservation.removed) {
    await forceRemove(dependencies, configuration, reservation.id);
    await provePrivateLabelAbsent(dependencies, configuration, reservation.privateLabel);
    reservation.removed = true;
  }
}

function matchingManagedLabels(
  labels: unknown,
  policy: LocalOfflinePreviewSandboxPolicy,
): Readonly<{
  deadline: number;
  privateLabel: string;
  requestId: string;
  phase: Phase;
  sessionDigest: string;
}> | null {
  if (!isPlainObject(labels)) return null;
  const request = labels[LABEL_REQUEST];
  const phase = labels[LABEL_PHASE];
  const deadlineText = labels[LABEL_DEADLINE];
  const session = labels[LABEL_SESSION];
  const privateLabel = labels[LABEL_PRIVATE];
  if (
    labels[PRIVATE_NAMESPACE_LABEL] !== PRIVATE_NAMESPACE_VALUE ||
    labels[LABEL_BACKEND] !== BACKEND || labels[LABEL_POLICY] !== policy.policyDigest ||
    typeof request !== "string" || !REQUEST_ID.test(request) ||
    (phase !== "transform" && phase !== "fresh_verifier") ||
    typeof deadlineText !== "string" || !/^\d{13}$/u.test(deadlineText) ||
    typeof session !== "string" || !DIGEST.test(session) ||
    typeof privateLabel !== "string" || !DIGEST.test(privateLabel)
  ) return null;
  const deadline = Number(deadlineText);
  if (!Number.isSafeInteger(deadline)) return null;
  const expectedSession = observationDigest(
    "OMNITWIN_OFFLINE_PREVIEW_SESSION_V0",
    {
      requestId: request,
      deadlineAt: new Date(deadline).toISOString(),
      policyDigest: policy.policyDigest,
    },
  );
  return session === expectedSession
    ? {
        deadline,
        privateLabel,
        requestId: request,
        phase,
        sessionDigest: session,
      }
    : null;
}

interface InternalBackendContext {
  readonly configuration: LocalOfflinePreviewContainerConfiguration;
  readonly policy: LocalOfflinePreviewSandboxPolicy;
  readonly dependencies: TestDependencies;
  readonly trustedKeys: ReadonlyMap<string, KeyObject>;
  readonly engineDigest: string;
  readonly canIssueLiveWitness: boolean;
  readonly permitLeaseStore: LocalOfflinePreviewPermitLeaseStore;
  readonly releaseManifestSha256: string | null;
  readonly qualificationReportSha256: string | null;
  readonly sessions: Set<Session>;
  readonly activeContainerIds: Set<string>;
  readonly inFlightBackendOperations: Set<Promise<unknown>>;
  lifecycle: "running" | "stopping" | "stopped";
  stopPromise: Promise<void> | null;
  permitLeaseStoreCloseStarted: boolean;
  quarantined: boolean;
  poisonCode: BackendPoisonCode | null;
}

type BackendPoisonCode =
  | "PROCESS_TERMINATION_UNCONFIRMED"
  | "CLEANUP_UNPROVED"
  | "RECONCILIATION_FAILED"
  | "PERMIT_LEDGER_REJECTED";

function errorCodeOf(error: unknown): LocalOfflinePreviewDockerSandboxErrorCode | null {
  if (error instanceof LocalOfflinePreviewDockerSandboxError) return error.code;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" &&
      LOCAL_OFFLINE_PREVIEW_DOCKER_SANDBOX_ERROR_CODES.includes(
        code as LocalOfflinePreviewDockerSandboxErrorCode,
      )
    ? code as LocalOfflinePreviewDockerSandboxErrorCode
    : null;
}

function poisonRank(code: BackendPoisonCode): number {
  switch (code) {
    case "CLEANUP_UNPROVED":
      return 4;
    case "PROCESS_TERMINATION_UNCONFIRMED":
      return 3;
    case "PERMIT_LEDGER_REJECTED":
      return 2;
    case "RECONCILIATION_FAILED":
      return 1;
  }
}

function poisonBackend(context: InternalBackendContext, code: BackendPoisonCode): void {
  const firstPoison = context.poisonCode === null;
  if (context.poisonCode === null || poisonRank(code) > poisonRank(context.poisonCode)) {
    context.poisonCode = code;
  }
  context.quarantined = true;
  if (!firstPoison) return;
  for (const session of [...context.sessions]) {
    try {
      session.requestBackendStop(sessionMintAuthority);
    } catch {
      // Poison remains permanent even if a defensive cancellation hook fails.
    }
  }
}

function poisonBackendFromError(context: InternalBackendContext, error: unknown): void {
  const code = errorCodeOf(error);
  if (
    code === "PROCESS_TERMINATION_UNCONFIRMED" ||
    code === "CLEANUP_UNPROVED" ||
    code === "RECONCILIATION_FAILED" ||
    code === "PERMIT_LEDGER_REJECTED"
  ) {
    poisonBackend(context, code);
  }
}

function backendPoisonError(
  context: InternalBackendContext,
): LocalOfflinePreviewDockerSandboxError | null {
  return !context.quarantined
    ? null
    : new LocalOfflinePreviewDockerSandboxError(
        context.poisonCode ?? "CLEANUP_UNPROVED",
      );
}

function assertBackendNotPoisoned(context: InternalBackendContext): void {
  const poison = backendPoisonError(context);
  if (poison !== null) throw poison;
}

function backendStoppedError(): LocalOfflinePreviewDockerSandboxError {
  return new LocalOfflinePreviewDockerSandboxError("BACKEND_STOPPED");
}

function assertBackendRunning(context: InternalBackendContext): void {
  assertBackendNotPoisoned(context);
  if (context.lifecycle !== "running") throw backendStoppedError();
}

function trackBackendOperation<T>(
  context: InternalBackendContext,
  operation: () => Promise<T>,
  onTracked?: (tracked: Promise<T>) => void,
): Promise<T> {
  const poison = backendPoisonError(context);
  if (poison !== null) return Promise.reject(poison);
  if (context.lifecycle !== "running") return Promise.reject(backendStoppedError());
  let resolveTracked = (_value: T | PromiseLike<T>): void => {
    fail("INTERNAL_FAILURE");
  };
  let rejectTracked = (_reason?: unknown): void => {
    fail("INTERNAL_FAILURE");
  };
  const tracked = new Promise<T>((resolve, reject) => {
    resolveTracked = resolve;
    rejectTracked = reject;
  });
  context.inFlightBackendOperations.add(tracked);
  let operationPromise: Promise<T>;
  try {
    onTracked?.(tracked);
    assertBackendRunning(context);
    operationPromise = operation();
  } catch (error: unknown) {
    context.inFlightBackendOperations.delete(tracked);
    rejectTracked(error);
    return tracked;
  }
  void operationPromise.then(
    (value) => {
      context.inFlightBackendOperations.delete(tracked);
      resolveTracked(value);
    },
    (error: unknown) => {
      context.inFlightBackendOperations.delete(tracked);
      rejectTracked(error);
    },
  );
  return tracked;
}

async function closePermitLeaseStore(
  context: InternalBackendContext,
): Promise<boolean> {
  if (context.permitLeaseStoreCloseStarted) return true;
  context.permitLeaseStoreCloseStarted = true;
  try {
    await context.permitLeaseStore.close();
    return true;
  } catch {
    return false;
  }
}

async function performBackendStop(context: InternalBackendContext): Promise<void> {
  const sessionsAtStop = [...context.sessions];
  for (const session of sessionsAtStop) {
    session.requestBackendStop(sessionMintAuthority);
  }
  const inFlight = [...context.inFlightBackendOperations];
  const inFlightResults = await Promise.allSettled(inFlight);
  for (const result of inFlightResults) {
    if (result.status === "rejected") poisonBackendFromError(context, result.reason);
  }
  const sessions = [...context.sessions];
  const cleanupResults = await Promise.allSettled(sessions.map(async (session) => {
    await session.stop();
  }));
  for (const result of cleanupResults) {
    if (result.status === "rejected") {
      const code = errorCodeOf(result.reason);
      if (code === "PROCESS_TERMINATION_UNCONFIRMED" || code === "CLEANUP_UNPROVED") {
        poisonBackend(context, code);
      } else {
        poisonBackend(context, "CLEANUP_UNPROVED");
      }
    }
  }
  if (context.sessions.size !== 0 || context.activeContainerIds.size !== 0) {
    poisonBackend(context, "CLEANUP_UNPROVED");
  }
  const storeClosed = await closePermitLeaseStore(context);
  context.lifecycle = "stopped";
  assertBackendNotPoisoned(context);
  if (!storeClosed) fail("PERMIT_LEDGER_REJECTED");
}

function stopBackend(context: InternalBackendContext): Promise<void> {
  if (context.stopPromise !== null) return context.stopPromise;
  context.lifecycle = "stopping";
  const stopPromise = performBackendStop(context);
  context.stopPromise = stopPromise;
  return stopPromise;
}

async function reconcile(context: InternalBackendContext): Promise<void> {
  assertBackendNotPoisoned(context);
  try {
    await context.permitLeaseStore.audit();
  } catch {
    poisonBackend(context, "PERMIT_LEDGER_REJECTED");
    fail("PERMIT_LEDGER_REJECTED");
  }
  assertBackendNotPoisoned(context);
  let ids: readonly string[];
  try {
    ids = await listedIds(
      context.dependencies,
      context.configuration,
      `${PRIVATE_NAMESPACE_LABEL}=${PRIVATE_NAMESPACE_VALUE}`,
    );
  } catch (error: unknown) {
    if (errorCodeOf(error) === "PROCESS_TERMINATION_UNCONFIRMED") {
      poisonBackend(context, "PROCESS_TERMINATION_UNCONFIRMED");
      throw error;
    }
    poisonBackend(context, "RECONCILIATION_FAILED");
    fail("RECONCILIATION_FAILED");
  }
  assertBackendNotPoisoned(context);
  for (const id of ids) {
    assertBackendNotPoisoned(context);
    if (context.activeContainerIds.has(id)) continue;
    let inspect: Record<string, unknown>;
    try {
      inspect = await inspectContainer(context.dependencies, context.configuration, id);
    } catch (error: unknown) {
      const code = errorCodeOf(error);
      if (code === "PROCESS_TERMINATION_UNCONFIRMED") {
        poisonBackend(context, "PROCESS_TERMINATION_UNCONFIRMED");
        throw error;
      }
      poisonBackend(context, "RECONCILIATION_FAILED");
      fail("RECONCILIATION_FAILED");
    }
    const config = inspect.Config;
    if (!isPlainObject(config)) {
      poisonBackend(context, "RECONCILIATION_FAILED");
      fail("RECONCILIATION_FAILED");
    }
    const managed = matchingManagedLabels(config.Labels, context.policy);
    // The namespace is private to this runner. Anything carrying that exact
    // namespace but not the complete current label contract is an ambiguous
    // orphan, so reconciliation blocks without touching it.
    if (managed === null) {
      poisonBackend(context, "RECONCILIATION_FAILED");
      fail("RECONCILIATION_FAILED");
    }
    const expectedLabels = labelsFor(
      context.policy,
      managed.requestId,
      managed.phase,
      managed.deadline,
      managed.sessionDigest,
      managed.privateLabel,
    );
    if (
      inspect.Id !== id ||
      inspectConfigurationMaterial(
        inspect,
        context.configuration,
        expectedLabels,
      ) === null
    ) {
      poisonBackend(context, "RECONCILIATION_FAILED");
      fail("RECONCILIATION_FAILED");
    }
    if (managed.deadline > context.dependencies.now()) fail("FOREIGN_RESERVATION_ACTIVE");
    try {
      await forceRemove(context.dependencies, context.configuration, id);
      await provePrivateLabelAbsent(
        context.dependencies,
        context.configuration,
        managed.privateLabel,
      );
    } catch {
      // This was an exact, expired reservation owned by this backend. Once its
      // absence cannot be proved, no later shutdown may claim clean success.
      context.activeContainerIds.add(id);
      poisonBackend(context, "CLEANUP_UNPROVED");
      fail("CLEANUP_UNPROVED");
    }
  }
}

async function reserveContainer(
  context: InternalBackendContext,
  phase: Phase,
  requestId: string,
  deadline: number,
  sessionDigest: string,
): Promise<Reservation> {
  assertBackendRunning(context);
  const privateLabel = `sha256:${randomHex(context.dependencies, 32)}`;
  const name = `omnitwin-preview-${randomHex(context.dependencies, 12)}`;
  assertBackendRunning(context);
  const expectedLabels = labelsFor(
    context.policy, requestId, phase, deadline, sessionDigest, privateLabel,
  );
  let createResult: LocalOfflinePreviewDockerCommandResult;
  try {
    createResult = await command(
      context.dependencies,
      context.configuration,
      createArguments(
        context.configuration, context.policy, name, phase, requestId,
        deadline, sessionDigest, privateLabel,
      ),
    );
  } catch (error: unknown) {
    if (errorCodeOf(error) === "LIFECYCLE_FILE_IDENTITY_REJECTED") {
      assertBackendNotPoisoned(context);
      throw error;
    }
    // A rejected executor promise can occur after docker.exe has handed the
    // create request to the daemon, so absence is no longer provable here.
    poisonBackend(context, "CLEANUP_UNPROVED");
    fail("CLEANUP_UNPROVED");
  }
  if (
    createResult.outcome === "timed_out" ||
    createResult.outcome === "output_limit_exceeded" ||
    createResult.outcome === "aborted" ||
    createResult.outcome === "termination_unconfirmed"
  ) {
    // A daemon-side create may complete after an immediate absence scan even
    // when the CLI process has stopped. No cleanup success can be claimed.
    poisonBackend(context, "CLEANUP_UNPROVED");
    fail("CLEANUP_UNPROVED");
  }
  let output: Buffer | null = null;
  let id: string | null = null;
  try {
    if (createResult.outcome !== "completed") fail("RESERVATION_FAILED");
    output = createResult.stdout;
    if (createResult.exitCode !== 0) fail("RESERVATION_FAILED");
    id = parseContainerId(output);
    if (id === null) fail("RESERVATION_FAILED");
  } catch (error: unknown) {
    output?.fill(0);
    try {
      await cleanPreselectedCreate(context, name, privateLabel, expectedLabels);
    } catch {
      poisonBackend(context, "CLEANUP_UNPROVED");
      fail("CLEANUP_UNPROVED");
    }
    throw error;
  }
  output.fill(0);
  const reservation: Reservation = {
    phase,
    id,
    name,
    privateLabel,
    privateLabelDigest: observationDigest(
      "OMNITWIN_OFFLINE_PREVIEW_PRIVATE_LABEL_V0", privateLabel,
    ),
    containerIdentityDigest: observationDigest(
      "OMNITWIN_OFFLINE_PREVIEW_CONTAINER_IDENTITY_V0", { id, name, privateLabel },
    ),
    expectedLabels,
    containerConfigurationDigest: "",
    removed: false,
  };
  context.activeContainerIds.add(id);
  try {
    const inspect = await inspectContainer(context.dependencies, context.configuration, id);
    if (inspect.Id !== id || inspect.Name !== `/${name}`) {
      fail("CONTAINER_CONFIGURATION_REJECTED");
    }
    const state = inspect.State;
    if (!isPlainObject(state) || state.Status !== "created" || state.Running !== false || state.Pid !== 0) {
      fail("CONTAINER_CONFIGURATION_REJECTED");
    }
    const material = inspectConfigurationMaterial(inspect, context.configuration, expectedLabels);
    if (material === null) fail("CONTAINER_CONFIGURATION_REJECTED");
    reservation.containerConfigurationDigest = observationDigest(
      "OMNITWIN_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V0", material,
    );
    return reservation;
  } catch (error: unknown) {
    poisonBackendFromError(context, error);
    try {
      await removeReservation(context.dependencies, context.configuration, reservation);
      context.activeContainerIds.delete(id);
    } catch {
      // Keep the ID as unresolved cleanup state. A later stop must remain
      // failed even if the original validation error is no longer observable.
      poisonBackend(context, "CLEANUP_UNPROVED");
      fail("CLEANUP_UNPROVED");
    }
    throw error;
  }
}

function snapshotWire(bytes: Uint8Array): Buffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
      bytes.byteLength > FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES) {
    fail("REQUEST_REJECTED");
  }
  return Buffer.from(bytes);
}

function decodeWire(context: InternalBackendContext, bytes: Uint8Array): unknown {
  try {
    return (context.dependencies.decodeWire ??
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage)(bytes);
  } catch {
    fail("REQUEST_REJECTED");
  }
}

function eraseDecodedWireBytes(value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const key of ["sourceBytes", "candidateBytes", "outputBytes"] as const) {
    const bytes = value[key];
    if (bytes instanceof Uint8Array) bytes.fill(0);
  }
}

function requestMetadata(
  message: unknown,
  expectedKind: "transform_request" | "fresh_verifier_request",
): Record<string, unknown> {
  if (!isPlainObject(message) || message.kind !== expectedKind || !isPlainObject(message.metadata)) {
    fail("REQUEST_REJECTED");
  }
  return message.metadata;
}

function responseMetadata(
  message: unknown,
  expectedKind: "transform_success" | "fresh_verifier_success",
): Record<string, unknown> {
  if (!isPlainObject(message)) fail("WORKER_RESPONSE_REJECTED");
  if (message.kind === "failure") fail("WORKER_REJECTED");
  if (message.kind !== expectedKind || !isPlainObject(message.metadata)) {
    fail("WORKER_RESPONSE_REJECTED");
  }
  return message.metadata;
}

function terminalState(inspect: Record<string, unknown>): boolean {
  const state = inspect.State;
  return isPlainObject(state) && state.Status === "exited" && state.Running === false &&
    state.Pid === 0 && state.ExitCode === 0 && state.OOMKilled === false && state.Dead === false;
}

function byteBinding(bytes: Uint8Array): { readonly sizeBytes: number; readonly sha256: string } {
  return Object.freeze({ sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
}

function cloneDeepFrozen<T>(value: T): T {
  const cloned = structuredClone(value);
  const seen = new WeakSet();
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const nested of Object.values(candidate)) freeze(nested);
    Object.freeze(candidate);
  };
  freeze(cloned);
  return cloned;
}

function sourceBinding(metadata: Record<string, unknown>) {
  const invocation = metadata.invocation;
  if (!isPlainObject(invocation) || !isPlainObject(invocation.source)) fail("REQUEST_REJECTED");
  const sizeBytes = invocation.source.sizeBytes;
  const digest = invocation.source.sha256;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 ||
      typeof digest !== "string" || !DIGEST.test(digest)) fail("REQUEST_REJECTED");
  return Object.freeze({ sizeBytes, sha256: digest });
}

function logicalTimestamp(context: InternalBackendContext, minimumExclusive?: number): number {
  const now = context.dependencies.now();
  return minimumExclusive === undefined ? now : Math.max(now, minimumExclusive + 1);
}

class Session implements LocalOfflinePreviewDockerSandboxSession {
  readonly #requestId: string;
  readonly #deadlineAt: string;
  readonly #context: InternalBackendContext;
  readonly #deadline: number;
  readonly #verifiedInvocation: unknown;
  readonly #permitEnvelope: unknown;
  readonly #invocationSha256: string;
  readonly #permitPayloadSha256: string;
  readonly #transform: Reservation;
  readonly #verifier: Reservation;
  #state: "reserved" | "transforming" | "transformed" | "verifying" | "verified" | "closed" = "reserved";
  #transformReceipt: LocalOfflinePreviewSandboxTerminalReceipt | null = null;
  #candidateBinding: { readonly sizeBytes: number; readonly sha256: string } | null = null;
  #report: FoundryOfflineNormalizeMeshGlbPreviewReportV0 | null = null;
  #transformFinishedAt = 0;
  #cleanupPromise: Promise<void> | null = null;
  #stopRequested = false;
  #activePhasePromise: Promise<unknown> | null = null;
  #activeAbortController: AbortController | null = null;

  constructor(
    mintAuthority: object,
    context: InternalBackendContext,
    requestId: string,
    deadlineAt: string,
    verifiedInvocation: unknown,
    permitEnvelope: unknown,
    permitPayloadSha256: string,
    transform: Reservation,
    verifier: Reservation,
  ) {
    if (mintAuthority !== sessionMintAuthority) {
      throw new TypeError("Sandbox sessions can only be minted by the backend.");
    }
    this.#context = context;
    this.#requestId = requestId;
    this.#deadlineAt = deadlineAt;
    this.#deadline = Date.parse(deadlineAt);
    this.#verifiedInvocation = structuredClone(verifiedInvocation);
    this.#permitEnvelope = structuredClone(permitEnvelope);
    this.#invocationSha256 =
      (context.dependencies.computeInvocationSha256 ??
        computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256)(
        verifiedInvocation,
      );
    this.#permitPayloadSha256 = permitPayloadSha256;
    this.#transform = transform;
    this.#verifier = verifier;
    Object.freeze(this);
  }

  get requestId(): string {
    return this.#requestId;
  }

  get deadlineAt(): string {
    return this.#deadlineAt;
  }

  #requestStop(): void {
    this.#stopRequested = true;
    this.#activeAbortController?.abort();
  }

  requestBackendStop(mintAuthority: object): void {
    if (mintAuthority !== sessionMintAuthority) {
      throw new TypeError("Backend stop requires the session mint authority.");
    }
    this.#requestStop();
  }

  #assertPublicationAllowed(signal?: AbortSignal): void {
    assertBackendRunning(this.#context);
    if (this.#stopRequested || signal?.aborted === true) fail("EXECUTION_CANCELLED");
  }

  #runPhase<T>(
    callerSignal: AbortSignal | undefined,
    operation: (internalSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const poison = backendPoisonError(this.#context);
    if (poison !== null) return Promise.reject(poison);
    if (this.#context.lifecycle !== "running") {
      return Promise.reject(backendStoppedError());
    }
    if (this.#stopRequested) {
      return Promise.reject(new LocalOfflinePreviewDockerSandboxError("EXECUTION_CANCELLED"));
    }
    if (this.#activePhasePromise !== null) {
      return Promise.reject(new LocalOfflinePreviewDockerSandboxError("PHASE_ORDER_REJECTED"));
    }
    const bridge = createAbortSignalBridge(callerSignal);
    if (bridge === null) {
      return Promise.reject(new LocalOfflinePreviewDockerSandboxError("REQUEST_REJECTED"));
    }
    this.#activeAbortController = bridge.controller;
    const tracked = trackBackendOperation(
      this.#context,
      async (): Promise<T> => await operation(bridge.controller.signal),
      (phasePromise) => { this.#activePhasePromise = phasePromise; },
    );
    const clearPhase = (): void => {
      bridge.detach();
      if (this.#activePhasePromise === tracked) this.#activePhasePromise = null;
      if (this.#activeAbortController === bridge.controller) {
        this.#activeAbortController = null;
      }
    };
    void tracked.then(clearPhase, clearPhase);
    return tracked;
  }

  #cleanupAll(): Promise<void> {
    if (this.#cleanupPromise === null) {
      this.#cleanupPromise = Promise.resolve().then(async () => {
        await this.#performCleanup();
      });
    }
    return this.#cleanupPromise;
  }

  async #performCleanup(): Promise<void> {
    const failures: unknown[] = [];
    for (const reservation of [this.#transform, this.#verifier]) {
      try {
        await removeReservation(this.#context.dependencies, this.#context.configuration, reservation);
        this.#context.activeContainerIds.delete(reservation.id);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.#state = "closed";
    this.#context.sessions.delete(this);
    if (failures.length > 0) {
      poisonBackend(this.#context, "CLEANUP_UNPROVED");
      fail("CLEANUP_UNPROVED");
    }
  }

  async #execute(
    reservation: Reservation,
    wire: Buffer,
    signal: AbortSignal,
  ): Promise<{ readonly output: Buffer; readonly startedAt: number; readonly finishedAt: number }> {
    this.#assertPublicationAllowed(signal);
    const startedAt = logicalTimestamp(this.#context, reservation.phase === "fresh_verifier" ? this.#transformFinishedAt : undefined);
    const remaining = this.#deadline - startedAt;
    if (remaining < 2) fail("DEADLINE_REJECTED");
    let output: Buffer | null = null;
    try {
      output = await completedCommand(
        this.#context.dependencies,
        this.#context.configuration,
        ["container", "start", "--attach", "--interactive", reservation.id],
        "WORKER_RESPONSE_REJECTED",
        {
          stdin: wire,
          timeout: Math.min(this.#context.configuration.resourceLimits.maximumRuntimeMilliseconds, remaining),
          maxStdout: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
          signal,
        },
      );
      this.#assertPublicationAllowed(signal);
      const finishedAt = logicalTimestamp(this.#context, startedAt);
      if (finishedAt >= this.#deadline) fail("EXECUTION_TIMED_OUT");
      const inspect = await inspectContainer(
        this.#context.dependencies, this.#context.configuration, reservation.id,
      );
      this.#assertPublicationAllowed(signal);
      const terminalConfiguration = inspectConfigurationMaterial(
        inspect,
        this.#context.configuration,
        reservation.expectedLabels,
      );
      if (
        inspect.Id !== reservation.id || inspect.Name !== `/${reservation.name}` ||
        terminalConfiguration === null ||
        observationDigest(
          "OMNITWIN_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V0",
          terminalConfiguration,
        ) !== reservation.containerConfigurationDigest ||
        !terminalState(inspect)
      ) fail("TERMINAL_STATE_REJECTED");
      await removeReservation(this.#context.dependencies, this.#context.configuration, reservation);
      this.#assertPublicationAllowed(signal);
      this.#context.activeContainerIds.delete(reservation.id);
      return { output, startedAt, finishedAt };
    } catch (error: unknown) {
      poisonBackendFromError(this.#context, error);
      output?.fill(0);
      try {
        await this.#cleanupAll();
      } catch {
        fail("CLEANUP_UNPROVED");
      }
      this.#assertPublicationAllowed(signal);
      throw error;
    }
  }

  #authenticateRequest(metadata: Record<string, unknown>): void {
    if (metadata.requestId !== this.#requestId || metadata.deadlineAt !== this.#deadlineAt ||
        !canonicalEqual(metadata.invocation, this.#verifiedInvocation) ||
        !canonicalEqual(metadata.permitEnvelope, this.#permitEnvelope)) fail("REQUEST_REJECTED");
    try {
      (this.#context.dependencies.verifyPermit ??
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit)({
        invocation: metadata.invocation,
        permitEnvelope: metadata.permitEnvelope,
        pinnedTrustedPermitKeys: this.#context.trustedKeys,
      });
    } catch {
      fail("AUTHORITY_REJECTED");
    }
  }

  runTransform(
    wireInput: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxTransformResult> {
    return this.#runPhase(
      signal,
      async (internalSignal) => await this.#performTransform(wireInput, internalSignal),
    );
  }

  async #performTransform(
    wireInput: Uint8Array,
    signal: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxTransformResult> {
    if (this.#state !== "reserved") fail("PHASE_ORDER_REJECTED");
    this.#state = "transforming";
    let wire: Buffer | null = null;
    let decoded: unknown = null;
    let response: unknown = null;
    let executedOutput: Buffer | null = null;
    try {
      wire = snapshotWire(wireInput);
    decoded = decodeWire(this.#context, wire);
    const metadata = requestMetadata(decoded, "transform_request");
    this.#authenticateRequest(metadata);
    const source = sourceBinding(metadata);
    if (source.sizeBytes > this.#context.configuration.resourceLimits.maximumInputBytes) {
      await this.#cleanupAll();
      fail("REQUEST_REJECTED");
    }
    const executed = await this.#execute(this.#transform, wire, signal);
    executedOutput = executed.output;
    response = decodeWire(this.#context, executed.output);
    const responseMeta = responseMetadata(response, "transform_success");
    if (responseMeta.requestId !== this.#requestId || !isPlainObject(responseMeta.report) ||
        !isPlainObject(response)) fail("WORKER_RESPONSE_REJECTED");
    const outputBytes = response.outputBytes;
    if (!(outputBytes instanceof Uint8Array)) fail("WORKER_RESPONSE_REJECTED");
    const candidate = byteBinding(outputBytes);
    if (candidate.sizeBytes > this.#context.configuration.resourceLimits.maximumOutputBytes) {
      outputBytes.fill(0);
      fail("WIRE_OUTPUT_LIMIT_EXCEEDED");
    }
    let reportSha256: string;
    try {
      reportSha256 = (this.#context.dependencies.computeReportSha256 ??
        computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256)(responseMeta.report);
    } catch {
      outputBytes.fill(0);
      fail("WORKER_RESPONSE_REJECTED");
    }
    const requestInvocation = metadata.invocation;
    if (!isPlainObject(requestInvocation)) {
      outputBytes.fill(0);
      await this.#cleanupAll();
      fail("WORKER_RESPONSE_REJECTED");
    }
    const reportSource = responseMeta.report.source;
    if (
      responseMeta.report.invocationSha256 !== this.#invocationSha256 ||
      !canonicalEqual(reportSource, requestInvocation.source) ||
      !isPlainObject(responseMeta.report.permit) ||
      responseMeta.report.permit.payloadSha256 !== this.#permitPayloadSha256
    ) {
      outputBytes.fill(0);
      await this.#cleanupAll();
      fail("WORKER_RESPONSE_REJECTED");
    }
    const receipt = createLocalOfflinePreviewSandboxTerminalReceipt({
      phase: "transform",
      requestId: this.#requestId,
      policyDigest: this.#context.policy.policyDigest,
      engineDigest: this.#context.engineDigest,
      containerConfigurationDigest: this.#transform.containerConfigurationDigest,
      containerIdentityDigest: this.#transform.containerIdentityDigest,
      deadlineAt: this.#deadlineAt,
      startedAt: new Date(executed.startedAt).toISOString(),
      finishedAt: new Date(executed.finishedAt).toISOString(),
      wireInput: byteBinding(wire),
      wireOutput: byteBinding(executed.output),
      source,
      candidate,
      reportSha256,
      verificationResult: "not_applicable",
      terminal: { status: "exited", running: false, pid: 0, exitCode: 0, oomKilled: false, dead: false },
      effectiveControls: this.#context.policy.effectiveControls,
      containerRemoved: true,
      exactPrivateLabelAbsent: true,
      privateLabelDigest: this.#transform.privateLabelDigest,
      matchingPrivateLabelContainerCount: 0,
    }, this.#context.policy);
    if (receipt === null) {
      outputBytes.fill(0);
      await this.#cleanupAll();
      fail("INTERNAL_FAILURE");
    }
    const frozenReport = cloneDeepFrozen(
      responseMeta.report,
    ) as FoundryOfflineNormalizeMeshGlbPreviewReportV0;
    this.#assertPublicationAllowed(signal);
    this.#candidateBinding = candidate;
    this.#report = frozenReport;
    this.#transformReceipt = receipt;
    this.#transformFinishedAt = executed.finishedAt;
    this.#state = "transformed";
      return Object.freeze({ outputBytes: Buffer.from(outputBytes), report: frozenReport, receiptClaim: receipt });
    } catch (error: unknown) {
      try {
        await this.#cleanupAll();
      } catch {
        fail("CLEANUP_UNPROVED");
      }
      this.#assertPublicationAllowed(signal);
      throw error;
    } finally {
      wire?.fill(0);
      executedOutput?.fill(0);
      eraseDecodedWireBytes(decoded);
      eraseDecodedWireBytes(response);
    }
  }

  runFreshVerifier(
    wireInput: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxVerificationResult> {
    return this.#runPhase(
      signal,
      async (internalSignal) => await this.#performFreshVerifier(wireInput, internalSignal),
    );
  }

  async #performFreshVerifier(
    wireInput: Uint8Array,
    signal: AbortSignal,
  ): Promise<LocalOfflinePreviewDockerSandboxVerificationResult> {
    if (this.#state !== "transformed" || this.#transformReceipt === null ||
        this.#candidateBinding === null || this.#report === null) fail("PHASE_ORDER_REJECTED");
    this.#state = "verifying";
    let wire: Buffer | null = null;
    let decoded: unknown = null;
    let response: unknown = null;
    let executedOutput: Buffer | null = null;
    try {
      wire = snapshotWire(wireInput);
    decoded = decodeWire(this.#context, wire);
    const metadata = requestMetadata(decoded, "fresh_verifier_request");
    this.#authenticateRequest(metadata);
    if (!isPlainObject(decoded) || !(decoded.candidateBytes instanceof Uint8Array) ||
        !isPlainObject(metadata.report) || !canonicalEqual(metadata.report, this.#report) ||
        !canonicalEqual(byteBinding(decoded.candidateBytes), this.#candidateBinding)) {
      await this.#cleanupAll();
      fail("REQUEST_REJECTED");
    }
    const source = sourceBinding(metadata);
    if (!canonicalEqual(source, this.#transformReceipt.source)) {
      await this.#cleanupAll();
      fail("REQUEST_REJECTED");
    }
    const executed = await this.#execute(this.#verifier, wire, signal);
    executedOutput = executed.output;
    response = decodeWire(this.#context, executed.output);
    const responseMeta = responseMetadata(response, "fresh_verifier_success");
    const expectedSource = {
      kind: "source",
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
    };
    const expectedCandidate = {
      kind: "candidate",
      sizeBytes: this.#candidateBinding.sizeBytes,
      sha256: this.#candidateBinding.sha256,
    };
    if (
      responseMeta.requestId !== this.#requestId ||
      responseMeta.requestWireSha256 !== sha256(wire) ||
      responseMeta.deadlineAt !== this.#deadlineAt ||
      responseMeta.invocationSha256 !== this.#invocationSha256 ||
      responseMeta.permitPayloadSha256 !== this.#permitPayloadSha256 ||
      !canonicalEqual(responseMeta.source, expectedSource) ||
      !canonicalEqual(responseMeta.candidate, expectedCandidate) ||
      responseMeta.reportSha256 !== this.#transformReceipt.reportSha256
    ) fail("WORKER_RESPONSE_REJECTED");
    const receipt = createLocalOfflinePreviewSandboxTerminalReceipt({
      phase: "fresh_verifier",
      requestId: this.#requestId,
      policyDigest: this.#context.policy.policyDigest,
      engineDigest: this.#context.engineDigest,
      containerConfigurationDigest: this.#verifier.containerConfigurationDigest,
      containerIdentityDigest: this.#verifier.containerIdentityDigest,
      deadlineAt: this.#deadlineAt,
      startedAt: new Date(executed.startedAt).toISOString(),
      finishedAt: new Date(executed.finishedAt).toISOString(),
      wireInput: byteBinding(wire),
      wireOutput: byteBinding(executed.output),
      source,
      candidate: this.#candidateBinding,
      reportSha256: this.#transformReceipt.reportSha256,
      verificationResult: "exact_match",
      terminal: { status: "exited", running: false, pid: 0, exitCode: 0, oomKilled: false, dead: false },
      effectiveControls: this.#context.policy.effectiveControls,
      containerRemoved: true,
      exactPrivateLabelAbsent: true,
      privateLabelDigest: this.#verifier.privateLabelDigest,
      matchingPrivateLabelContainerCount: 0,
    }, this.#context.policy);
    if (receipt === null) fail("INTERNAL_FAILURE");
    const evidence = createLocalOfflinePreviewSandboxEvidence({
      policy: this.#context.policy,
      transformReceipt: this.#transformReceipt,
      freshVerifierReceipt: receipt,
    });
    if (evidence === null) fail("INTERNAL_FAILURE");
    this.#assertPublicationAllowed(signal);
    this.#state = "verified";
    this.#context.sessions.delete(this);
    const witness =
      this.#context.canIssueLiveWitness &&
      this.#context.releaseManifestSha256 !== null &&
      this.#context.qualificationReportSha256 !== null
        ? new LiveWitness(liveWitnessMintAuthority, {
            requestId: this.#requestId,
            deadlineAt: this.#deadlineAt,
            invocationSha256: this.#invocationSha256,
            permitPayloadSha256: this.#permitPayloadSha256,
            policyDigest: evidence.policyDigest,
            engineDigest: evidence.engineDigest,
            source: evidence.source,
            candidate: evidence.candidate,
            reportSha256: evidence.reportSha256,
            evidenceDigest: evidence.evidenceDigest,
            releaseManifestSha256: this.#context.releaseManifestSha256,
            qualificationReportSha256: this.#context.qualificationReportSha256,
          })
        : null;
      return Object.freeze({ receiptClaim: receipt, evidenceClaim: evidence, liveWitness: witness });
    } catch (error: unknown) {
      try {
        await this.#cleanupAll();
      } catch {
        fail("CLEANUP_UNPROVED");
      }
      this.#assertPublicationAllowed(signal);
      throw error;
    } finally {
      wire?.fill(0);
      executedOutput?.fill(0);
      eraseDecodedWireBytes(decoded);
      eraseDecodedWireBytes(response);
    }
  }

  stop(): Promise<void> {
    this.#requestStop();
    if (this.#cleanupPromise !== null) {
      if (this.#context.poisonCode !== "PROCESS_TERMINATION_UNCONFIRMED") {
        return this.#cleanupPromise;
      }
      return this.#cleanupPromise.then(() => {
        fail("PROCESS_TERMINATION_UNCONFIRMED");
      });
    }
    if (this.#state === "closed" || this.#state === "verified") {
      const poison = backendPoisonError(this.#context);
      return poison === null ? Promise.resolve() : Promise.reject(poison);
    }
    const activePhase = this.#activePhasePromise;
    if (activePhase === null) return this.#cleanupAll();
    return Promise.allSettled([activePhase]).then(async ([activeResult]) => {
      if (this.#cleanupPromise !== null) await this.#cleanupPromise;
      else if (this.#state !== "closed" && this.#state !== "verified") {
        await this.#cleanupAll();
      }
      if (activeResult.status === "rejected") {
        const activeCode = errorCodeOf(activeResult.reason);
        if (
          activeCode === "PROCESS_TERMINATION_UNCONFIRMED" ||
          activeCode === "CLEANUP_UNPROVED"
        ) fail(activeCode);
      }
      assertBackendNotPoisoned(this.#context);
    });
  }
}

Object.freeze(Session.prototype);

async function createBackend(
  options: LocalOfflinePreviewDockerSandboxTestFactoryOptions,
  dependencies: TestDependencies,
  canIssueLiveWitness: boolean,
): Promise<LocalOfflinePreviewDockerSandboxBackend> {
  const configuration = parseLocalOfflinePreviewContainerConfiguration(options.configurationInput);
  if (configuration === null) fail("CONFIGURATION_REJECTED");
  if (!provePid1Watchdog(configuration)) fail("PID1_WATCHDOG_NOT_PROVED");
  const preflight = await preflightLocalOfflineNormalizationPreviewContainer(
    options.configurationInput,
    dependencies.preflightDependencies,
  );
  if (preflight.status !== "eligible") {
    // A Docker CLI process whose death cannot be confirmed is cleanup
    // uncertainty, not an ordinary eligibility failure. Preserve that exact
    // terminal state through backend creation and bridge shutdown so no later
    // caller can report a clean stop while the process may still exist.
    if (preflight.code === "DOCKER_PROCESS_TERMINATION_UNCONFIRMED") {
      fail("PROCESS_TERMINATION_UNCONFIRMED");
    }
    fail("PREFLIGHT_BLOCKED");
  }
  const policy = compileLocalOfflinePreviewSandboxPolicy(options.configurationInput);
  if (policy === null) fail("CONFIGURATION_REJECTED");
  const context: InternalBackendContext = {
    configuration,
    policy,
    dependencies,
    trustedKeys: new Map(options.pinnedTrustedPermitKeys),
    engineDigest: await engineDigest(dependencies, configuration),
    canIssueLiveWitness,
    permitLeaseStore: dependencies.permitLeaseStore,
    releaseManifestSha256: dependencies.releaseManifestSha256 ?? null,
    qualificationReportSha256: dependencies.qualificationReportSha256 ?? null,
    sessions: new Set(),
    activeContainerIds: new Set(),
    inFlightBackendOperations: new Set(),
    lifecycle: "running",
    stopPromise: null,
    permitLeaseStoreCloseStarted: false,
    quarantined: false,
    poisonCode: null,
  };
  const liveAuthorityCapable =
    canIssueLiveWitness &&
    context.releaseManifestSha256 !== null &&
    context.qualificationReportSha256 !== null;
  if (canIssueLiveWitness && !liveAuthorityCapable) {
    fail("BUNDLED_RELEASE_UNAVAILABLE");
  }
  await reconcile(context);
  return Object.freeze({
    runtimeMode: liveAuthorityCapable
      ? "cryptographically_verified_bundled_qualification_private_preview" as const
      : "test_only_disabled" as const,
    liveAuthorityCapable,
    authority: liveAuthorityCapable
      ? "cryptographically_verified_bundled_release" as const
      : "none" as const,
    productionUse: "disabled" as const,
    policy,
    reconcileExpired: (): Promise<void> => trackBackendOperation(
      context,
      async (): Promise<void> => { await reconcile(context); },
    ),
    reserveSession: (
      input: LocalOfflinePreviewDockerSandboxReservationInput,
    ): Promise<LocalOfflinePreviewDockerSandboxSession> => trackBackendOperation(
      context,
      async (): Promise<LocalOfflinePreviewDockerSandboxSession> => {
      const reservationInput = snapshotReservationInput(input);
      await reconcile(context);
      assertBackendRunning(context);
      let verified: Readonly<{
        readonly invocation: unknown;
        readonly permitPayloadSha256: string;
        readonly validFrom: string;
        readonly expiresAt: string;
      }>;
      try {
        verified = (dependencies.verifyPermit ??
          verifyFoundryOfflineNormalizeMeshGlbPreviewPermit)({
          invocation: reservationInput.invocation,
          permitEnvelope: reservationInput.permitEnvelope,
          pinnedTrustedPermitKeys: context.trustedKeys,
        });
      } catch {
        fail("AUTHORITY_REJECTED");
      }
      assertBackendRunning(context);
      if (!canonicalUtc(reservationInput.deadlineAt)) fail("DEADLINE_REJECTED");
      const deadline = Date.parse(reservationInput.deadlineAt);
      if (deadline <= dependencies.now() + 2 || deadline > Date.parse(verified.expiresAt)) {
        fail("DEADLINE_REJECTED");
      }
      assertBackendRunning(context);
      const requestId = randomHex(dependencies, 16);
      assertBackendRunning(context);
      try {
        await context.permitLeaseStore.reserve({
          permitPayloadSha256: verified.permitPayloadSha256,
          requestId,
          policyDigest: policy.policyDigest,
          expiresAt: verified.expiresAt,
        });
      } catch (error: unknown) {
        if (
          error instanceof LocalOfflinePreviewPermitLeaseError ||
          (typeof error === "object" && error !== null && "code" in error)
        ) {
          const code = (error as { readonly code?: unknown }).code;
          if (code === "PERMIT_ALREADY_CONSUMED") {
          fail("PERMIT_REPLAY_REJECTED");
          }
        }
        poisonBackend(context, "PERMIT_LEDGER_REJECTED");
        fail("PERMIT_LEDGER_REJECTED");
      }
      assertBackendRunning(context);
      const sessionDigest = observationDigest(
        "OMNITWIN_OFFLINE_PREVIEW_SESSION_V0",
        { requestId, deadlineAt: reservationInput.deadlineAt, policyDigest: policy.policyDigest },
      );
      let transform: Reservation | null = null;
      let verifier: Reservation | null = null;
      try {
        transform = await reserveContainer(context, "transform", requestId, deadline, sessionDigest);
        assertBackendRunning(context);
        verifier = await reserveContainer(context, "fresh_verifier", requestId, deadline, sessionDigest);
        assertBackendRunning(context);
        if (transform.id === verifier.id || transform.privateLabel === verifier.privateLabel) {
          fail("RESERVATION_FAILED");
        }
        const session = new Session(
          sessionMintAuthority,
          context, requestId, reservationInput.deadlineAt, verified.invocation,
          reservationInput.permitEnvelope, verified.permitPayloadSha256,
          transform, verifier,
        );
        assertBackendRunning(context);
        context.sessions.add(session);
        return session;
      } catch (error: unknown) {
        let cleanupFailed = false;
        for (const reservation of [transform, verifier]) {
          if (reservation === null) continue;
          try {
            await removeReservation(dependencies, configuration, reservation);
            context.activeContainerIds.delete(reservation.id);
          } catch {
            cleanupFailed = true;
          }
        }
        if (cleanupFailed) {
          poisonBackend(context, "CLEANUP_UNPROVED");
          fail("CLEANUP_UNPROVED");
        }
        throw error;
      }
      },
    ),
    stopAll: (): Promise<void> => stopBackend(context),
    toJSON: () => Object.freeze({
      runtimeMode: "test_only_disabled" as const,
      liveAuthorityCapable: false as const,
      authority: "none" as const,
      productionUse: "disabled" as const,
    }),
  });
}

/**
 * Production constructor. It has no command, clock, decoder, or random-number
 * injection surface; only this path can mint a process-live witness.
 */
export async function createLocalOfflineNormalizationPreviewDockerSandbox(
): Promise<LocalOfflinePreviewDockerSandboxBackend> {
  const lookup = getLocalOfflinePreviewBundledReleaseAuthority();
  if (lookup.status !== "available") fail("BUNDLED_RELEASE_UNAVAILABLE");
  const material = readLocalOfflinePreviewBundledReleaseMaterial(lookup.capability);
  if (material === null) fail("BUNDLED_RELEASE_UNAVAILABLE");
  const options: LocalOfflinePreviewDockerSandboxTestFactoryOptions = {
    configurationInput: material.containerConfiguration,
    pinnedTrustedPermitKeys: material.pinnedTrustedPermitKeys,
  };
  const permitLeaseStore =
    createLocalOfflinePreviewProductionPermitLeaseStore();
  try {
    return await createBackend(options, {
      commandExecutor: defaultLocalOfflinePreviewDockerCommandExecutor,
      randomBytes,
      now: Date.now,
      permitLeaseStore,
      dockerExecutableArtifactSha256: material.dockerExecutableArtifactSha256,
      releaseManifestSha256: material.releaseManifestSha256,
      qualificationReportSha256: material.qualificationReportSha256,
    }, true);
  } catch (error: unknown) {
    let closeFailed = false;
    try {
      await permitLeaseStore.close();
    } catch {
      closeFailed = true;
    }
    const originalCode = errorCodeOf(error);
    if (
      originalCode === "PROCESS_TERMINATION_UNCONFIRMED" ||
      originalCode === "CLEANUP_UNPROVED"
    ) throw error;
    if (closeFailed) fail("PERMIT_LEDGER_REJECTED");
    throw error;
  }
}

/** Test-only dependency seam. It can exercise lifecycle logic but can never mint a live witness. */
export async function __testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox(
  options: LocalOfflinePreviewDockerSandboxTestFactoryOptions,
  dependencies: TestDependencies,
): Promise<LocalOfflinePreviewDockerSandboxBackend> {
  return await createBackend(options, dependencies, false);
}

import {
  createHash,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import {
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "@omnitwin/reconstruction-foundry";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "../../../packages/reconstruction-foundry/src/canonical-json.js";
import {
  encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.js";
import type {
  LocalOfflinePreviewDockerSandboxBackend,
  LocalOfflinePreviewDockerSandboxLiveWitness,
  LocalOfflinePreviewDockerSandboxSession,
} from "./local-offline-normalization-preview-docker-sandbox-production.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES = Object.freeze({
  alreadyUsed: "LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ALREADY_USED",
  stopped: "LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_STOPPED",
  proofRejected: "LOCAL_OFFLINE_PREVIEW_SANDBOX_PROOF_REJECTED",
  publicKeyRejected: "LOCAL_OFFLINE_PREVIEW_PERMIT_PUBLIC_KEY_REJECTED",
  signalRejected: "LOCAL_OFFLINE_PREVIEW_EXECUTION_SIGNAL_REJECTED",
} as const);

type LocalOfflinePreviewExecutionBridgeErrorCode =
  (typeof LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES)[
    keyof typeof LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES
  ];

export class LocalOfflinePreviewExecutionBridgeError extends Error {
  readonly code: LocalOfflinePreviewExecutionBridgeErrorCode;

  constructor(code: LocalOfflinePreviewExecutionBridgeErrorCode) {
    super(`Offline preview execution bridge blocked (${code}).`);
    this.name = "LocalOfflinePreviewExecutionBridgeError";
    this.code = code;
  }
}

export interface LocalOfflineNormalizationPreviewExecutionReservation {
  readonly deadlineAt: string;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: unknown;
  /** A process-pinned public key. It is never returned or serialized. */
  readonly permitPublicKey: KeyObject;
  readonly permitPayloadSha256: string;
}

export interface LocalOfflineNormalizationPreviewExecutionTransformInput {
  readonly sourceBytes: Uint8Array;
  readonly signal: AbortSignal;
}

export interface LocalOfflineNormalizationPreviewExecutionTransformResult {
  readonly candidateBytes: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}

export interface LocalOfflineNormalizationPreviewExecutionFreshVerifierInput {
  readonly freshSourceBytes: Uint8Array;
  readonly candidateBytes: Uint8Array;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  readonly signal: AbortSignal;
}

/**
 * A process-live capability. Its public shape is not proof: authenticity is
 * checked against a module-private WeakSet by
 * localOfflineNormalizationPreviewExecutionProofMatches().
 */
export interface LocalOfflineNormalizationPreviewExecutionProof {
  readonly sandboxEstablished: true;
  toJSON(): Readonly<{
    readonly sandboxEstablished: false;
    readonly claimStatus: "unauthenticated_integrity_claim";
  }>;
}

export interface LocalOfflineNormalizationPreviewExecutionFreshVerifierResult {
  /** Untrusted until checked with executionProofMatches(). */
  readonly proof: unknown;
}

export interface LocalOfflineNormalizationPreviewExecutionSession {
  runTransform(
    input: LocalOfflineNormalizationPreviewExecutionTransformInput,
  ): Promise<LocalOfflineNormalizationPreviewExecutionTransformResult>;
  runFreshVerifier(
    input: LocalOfflineNormalizationPreviewExecutionFreshVerifierInput,
  ): Promise<LocalOfflineNormalizationPreviewExecutionFreshVerifierResult>;
  stop(): Promise<void>;
}

/**
 * Process-only boundary between exact source custody and isolated execution.
 * Browser requests never receive this object and cannot supply its inputs.
 */
export interface LocalOfflineNormalizationPreviewExecutionBridge {
  reserveSession(
    input: LocalOfflineNormalizationPreviewExecutionReservation,
    signal: AbortSignal,
  ): Promise<LocalOfflineNormalizationPreviewExecutionSession>;
  stopAll(): Promise<void>;
}

interface ProofBinding {
  readonly backendRequestId: string;
  readonly deadlineAt: string;
  readonly invocationSha256: string;
  readonly permitPayloadSha256: string;
  readonly sourceSizeBytes: number;
  readonly sourceSha256: string;
  readonly candidateSizeBytes: number;
  readonly candidateSha256: string;
  readonly reportSha256: string;
  readonly canonicalReport: string;
  readonly evidenceDigest: string;
}

const executionProofs = new WeakSet();
const executionProofBindings = new WeakMap<object, ProofBinding>();
const executionProofMintAuthority = Object.freeze({
  purpose: "module_private_execution_proof_mint",
});

class ExecutionProof implements LocalOfflineNormalizationPreviewExecutionProof {
  readonly sandboxEstablished = true as const;

  constructor(authority: object, binding: ProofBinding) {
    if (authority !== executionProofMintAuthority) {
      throw new TypeError("Execution proofs can only be minted after live witness authentication.");
    }
    executionProofs.add(this);
    executionProofBindings.set(this, Object.freeze({ ...binding }));
    Object.freeze(this);
  }

  toJSON() {
    return Object.freeze({
      sandboxEstablished: false as const,
      claimStatus: "unauthenticated_integrity_claim" as const,
    });
  }
}

Object.freeze(ExecutionProof.prototype);

export interface LocalOfflineNormalizationPreviewExecutionProofExpectation {
  readonly deadlineAt: string;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitPayloadSha256: string;
  readonly sourceBytes: Uint8Array;
  readonly candidateBytes: Uint8Array;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}

function byteBinding(bytes: Uint8Array): {
  readonly sizeBytes: number;
  readonly sha256: string;
} {
  return Object.freeze({
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
}

/**
 * Rechecks the private capability against the controller's independent exact
 * bytes and authority facts. A shape-compatible object always fails.
 */
export function localOfflineNormalizationPreviewExecutionProofMatches(
  proof: unknown,
  expected: LocalOfflineNormalizationPreviewExecutionProofExpectation,
): proof is LocalOfflineNormalizationPreviewExecutionProof {
  if (
    typeof proof !== "object" ||
    proof === null ||
    !executionProofs.has(proof)
  ) {
    return false;
  }
  const binding = executionProofBindings.get(proof);
  if (binding === undefined) return false;
  try {
    const report =
      FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.safeParse(
        expected.report,
      );
    if (!report.success) return false;
    const source = byteBinding(expected.sourceBytes);
    const candidate = byteBinding(expected.candidateBytes);
    const invocationSha256 =
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
        expected.invocation,
      );
    return (
      binding.deadlineAt === expected.deadlineAt &&
      binding.invocationSha256 === invocationSha256 &&
      binding.permitPayloadSha256 === expected.permitPayloadSha256 &&
      binding.sourceSizeBytes === source.sizeBytes &&
      binding.sourceSha256 === source.sha256 &&
      binding.candidateSizeBytes === candidate.sizeBytes &&
      binding.candidateSha256 === candidate.sha256 &&
      binding.reportSha256 === report.data.reportSha256 &&
      binding.canonicalReport ===
        stableCanonicalJson(toCanonicalJson(report.data)) &&
      SHA256.test(binding.evidenceDigest) &&
      binding.backendRequestId.length > 0
    );
  } catch {
    return false;
  }
}

function fail(code: LocalOfflinePreviewExecutionBridgeErrorCode): never {
  throw new LocalOfflinePreviewExecutionBridgeError(code);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new LocalOfflinePreviewExecutionBridgeError(
          LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.stopped,
        );
  }
}

function publicKeyMaterial(
  keyId: string,
  key: KeyObject,
): { readonly keyId: string; readonly spkiDerBase64: string } {
  try {
    const publicKey = key.type === "public" ? key : createPublicKey(key);
    const spki = publicKey.export({ type: "spki", format: "der" });
    return Object.freeze({
      keyId,
      spkiDerBase64: Buffer.from(spki).toString("base64"),
    });
  } catch {
    fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.publicKeyRejected);
  }
}

interface PreparedExecutionReservation {
  readonly deadlineAt: string;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: unknown;
  readonly permitPublicKey: {
    readonly keyId: string;
    readonly spkiDerBase64: string;
  };
  readonly permitPayloadSha256: string;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function prepareExecutionReservation(
  input: LocalOfflineNormalizationPreviewExecutionReservation,
): PreparedExecutionReservation {
  try {
    const invocation = deepFreeze(
      FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse(
        input.invocation,
      ),
    );
    const permitEnvelope = deepFreeze(
      structuredClone(input.permitEnvelope),
    );
    const permitPayloadSha256 = input.permitPayloadSha256;
    if (
      !SHA256.test(permitPayloadSha256) ||
      permitPayloadSha256 !== invocation.permit.payloadSha256
    ) {
      fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.proofRejected);
    }
    const permitPublicKey = publicKeyMaterial(
      invocation.permit.keyId,
      input.permitPublicKey,
    );
    return Object.freeze({
      deadlineAt: input.deadlineAt,
      invocation,
      permitEnvelope,
      permitPublicKey,
      permitPayloadSha256,
    });
  } catch (error: unknown) {
    if (error instanceof LocalOfflinePreviewExecutionBridgeError) throw error;
    fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.proofRejected);
  }
}

interface NormalizedAbortSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function readNativeAbortSignalAborted(input: AbortSignal): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "aborted",
  );
  if (descriptor?.get === undefined) throw new TypeError("missing native getter");
  return descriptor.get.call(input) as boolean;
}

function readNativeAbortSignalReason(input: AbortSignal): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    "reason",
  );
  if (descriptor?.get === undefined) throw new TypeError("missing native getter");
  return descriptor.get.call(input) as unknown;
}

function addNativeAbortListener(
  input: AbortSignal,
  listener: () => void,
): void {
  EventTarget.prototype.addEventListener.call(
    input,
    "abort",
    listener,
    { once: true },
  );
}

function removeNativeAbortListener(
  input: AbortSignal,
  listener: () => void,
): void {
  EventTarget.prototype.removeEventListener.call(input, "abort", listener);
}

function normalizeAbortSignal(input: AbortSignal): NormalizedAbortSignal {
  if (nodeUtilTypes.isProxy(input)) {
    fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.signalRejected);
  }
  let initiallyAborted: boolean;
  try {
    // Call the native accessor directly. AbortSignal.any() is intentionally
    // not used: Node accepts duck-typed objects there and reads caller-owned
    // `aborted` getters, so a Proxy can conceal an existing cancellation.
    initiallyAborted = readNativeAbortSignalAborted(input);
  } catch {
    fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.signalRejected);
  }
  const controller = new AbortController();
  let listening = false;
  const propagateAbort = (): void => {
    let reason: unknown;
    try {
      reason = readNativeAbortSignalReason(input);
    } catch {
      reason = new LocalOfflinePreviewExecutionBridgeError(
        LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.signalRejected,
      );
    }
    controller.abort(reason);
  };
  try {
    if (initiallyAborted) {
      propagateAbort();
    } else {
      addNativeAbortListener(input, propagateAbort);
      listening = true;
      // Close the check/listener race without consulting an overridable
      // property. If abort happened after listener installation, both paths
      // are harmlessly idempotent.
      if (readNativeAbortSignalAborted(input)) {
        propagateAbort();
      }
    }
  } catch {
    if (listening) {
      try {
        removeNativeAbortListener(input, propagateAbort);
      } catch {
        // The signal is rejected below; there is no backend yet to clean up.
      }
    }
    fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.signalRejected);
  }
  return Object.freeze({
    signal: controller.signal,
    dispose: (): void => {
      if (!listening) return;
      listening = false;
      try {
        removeNativeAbortListener(input, propagateAbort);
      } catch {
        // Input already passed the native brand check. Disposal is best-effort
        // and never changes the execution result.
      }
    },
  });
}

type LiveWitnessAuthenticator = (
  witness: unknown,
  evidence: unknown,
) => witness is LocalOfflinePreviewDockerSandboxLiveWitness;

function witnessMatchesExactRun(
  authenticateLiveWitness: LiveWitnessAuthenticator,
  witness: unknown,
  evidence: unknown,
  session: LocalOfflinePreviewDockerSandboxSession,
  reservation: PreparedExecutionReservation,
  sourceBytes: Uint8Array,
  candidateBytes: Uint8Array,
  report: FoundryOfflineNormalizeMeshGlbPreviewReportV0,
): witness is LocalOfflinePreviewDockerSandboxLiveWitness {
  if (
    !authenticateLiveWitness(witness, evidence)
  ) {
    return false;
  }
  try {
    const parsedReport =
      FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.safeParse(report);
    if (!parsedReport.success) return false;
    const source = byteBinding(sourceBytes);
    const candidate = byteBinding(candidateBytes);
    const invocationSha256 =
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
        reservation.invocation,
      );
    return (
      witness.requestId === session.requestId &&
      witness.deadlineAt === session.deadlineAt &&
      witness.deadlineAt === reservation.deadlineAt &&
      witness.invocationSha256 === invocationSha256 &&
      witness.permitPayloadSha256 === reservation.permitPayloadSha256 &&
      witness.source.sizeBytes === source.sizeBytes &&
      witness.source.sha256 === source.sha256 &&
      witness.candidate.sizeBytes === candidate.sizeBytes &&
      witness.candidate.sha256 === candidate.sha256 &&
      witness.reportSha256 === parsedReport.data.reportSha256 &&
      SHA256.test(witness.evidenceDigest) &&
      SHA256.test(witness.releaseManifestSha256) &&
      SHA256.test(witness.qualificationReportSha256)
    );
  } catch {
    return false;
  }
}

class DockerExecutionSession
  implements LocalOfflineNormalizationPreviewExecutionSession {
  readonly #session: LocalOfflinePreviewDockerSandboxSession;
  readonly #authenticateLiveWitness: LiveWitnessAuthenticator;
  readonly #reservation: PreparedExecutionReservation;
  readonly #permitPublicKey: {
    readonly keyId: string;
    readonly spkiDerBase64: string;
  };
  #transformBinding: Readonly<{
    readonly candidateSizeBytes: number;
    readonly candidateSha256: string;
    readonly reportSha256: string;
    readonly canonicalReport: string;
  }> | null = null;
  #stopPromise: Promise<void> | null = null;

  constructor(
    session: LocalOfflinePreviewDockerSandboxSession,
    reservation: PreparedExecutionReservation,
    authenticateLiveWitness: LiveWitnessAuthenticator,
  ) {
    this.#session = session;
    this.#authenticateLiveWitness = authenticateLiveWitness;
    this.#reservation = reservation;
    this.#permitPublicKey = reservation.permitPublicKey;
  }

  async runTransform(
    input: LocalOfflineNormalizationPreviewExecutionTransformInput,
  ): Promise<LocalOfflineNormalizationPreviewExecutionTransformResult> {
    const normalizedSignal = normalizeAbortSignal(input.signal);
    let wire: Buffer | null = null;
    try {
      throwIfAborted(normalizedSignal.signal);
      wire = encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_request",
        requestId: this.#session.requestId,
        deadlineAt: this.#reservation.deadlineAt,
        invocation: this.#reservation.invocation,
        permitEnvelope: this.#reservation.permitEnvelope,
        permitPublicKey: this.#permitPublicKey,
        sourceBytes: input.sourceBytes,
      });
      const result = await this.#session.runTransform(
        wire,
        normalizedSignal.signal,
      );
      throwIfAborted(normalizedSignal.signal);
      try {
        const parsedReport =
          FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse(
            result.report,
          );
        const output = Buffer.from(result.outputBytes);
        const candidate = byteBinding(output);
        this.#transformBinding = Object.freeze({
          candidateSizeBytes: candidate.sizeBytes,
          candidateSha256: candidate.sha256,
          reportSha256: parsedReport.reportSha256,
          canonicalReport: stableCanonicalJson(toCanonicalJson(parsedReport)),
        });
        return {
          candidateBytes: output,
          report: structuredClone(parsedReport),
        };
      } finally {
        result.outputBytes.fill(0);
      }
    } finally {
      wire?.fill(0);
      normalizedSignal.dispose();
    }
  }

  async runFreshVerifier(
    input: LocalOfflineNormalizationPreviewExecutionFreshVerifierInput,
  ): Promise<LocalOfflineNormalizationPreviewExecutionFreshVerifierResult> {
    const normalizedSignal = normalizeAbortSignal(input.signal);
    let wire: Buffer | null = null;
    try {
      throwIfAborted(normalizedSignal.signal);
      const transform = this.#transformBinding;
      const candidate = byteBinding(input.candidateBytes);
      const parsedReport =
        FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.safeParse(
          input.report,
        );
      if (
        transform === null ||
        !parsedReport.success ||
        candidate.sizeBytes !== transform.candidateSizeBytes ||
        candidate.sha256 !== transform.candidateSha256 ||
        parsedReport.data.reportSha256 !== transform.reportSha256 ||
        stableCanonicalJson(toCanonicalJson(parsedReport.data)) !==
          transform.canonicalReport
      ) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.proofRejected);
      }
      wire = encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "fresh_verifier_request",
        requestId: this.#session.requestId,
        deadlineAt: this.#reservation.deadlineAt,
        invocation: this.#reservation.invocation,
        permitEnvelope: this.#reservation.permitEnvelope,
        permitPublicKey: this.#permitPublicKey,
        report: input.report,
        sourceBytes: input.freshSourceBytes,
        candidateBytes: input.candidateBytes,
      });
      const verification = await this.#session.runFreshVerifier(
        wire,
        normalizedSignal.signal,
      );
      throwIfAborted(normalizedSignal.signal);
      if (
        !witnessMatchesExactRun(
          this.#authenticateLiveWitness,
          verification.liveWitness,
          verification.evidenceClaim,
          this.#session,
          this.#reservation,
          input.freshSourceBytes,
          input.candidateBytes,
          input.report,
        )
      ) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.proofRejected);
      }
      const witness = verification.liveWitness;
      const proof = new ExecutionProof(executionProofMintAuthority, {
        backendRequestId: witness.requestId,
        deadlineAt: witness.deadlineAt,
        invocationSha256: witness.invocationSha256,
        permitPayloadSha256: witness.permitPayloadSha256,
        sourceSizeBytes: witness.source.sizeBytes,
        sourceSha256: witness.source.sha256,
        candidateSizeBytes: witness.candidate.sizeBytes,
        candidateSha256: witness.candidate.sha256,
        reportSha256: witness.reportSha256,
        canonicalReport: stableCanonicalJson(
          toCanonicalJson(parsedReport.data),
        ),
        evidenceDigest: witness.evidenceDigest,
      });
      return Object.freeze({ proof });
    } finally {
      wire?.fill(0);
      normalizedSignal.dispose();
    }
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#session.stop();
    return this.#stopPromise;
  }
}

type DockerBackendFactory =
  () => Promise<LocalOfflinePreviewDockerSandboxBackend>;

type DockerRuntimeModule = typeof import(
  "./local-offline-normalization-preview-docker-sandbox-production.js"
);

const BACKEND_FACTORY_FAILURES_REQUIRING_OPERATOR_ATTENTION = new Set([
  "CLEANUP_UNPROVED",
  "PROCESS_TERMINATION_UNCONFIRMED",
  "RECONCILIATION_FAILED",
  "PERMIT_LEDGER_REJECTED",
]);

function backendFactoryFailureRequiresOperatorAttention(
  error: unknown,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && "value" in descriptor &&
    typeof descriptor.value === "string" &&
    BACKEND_FACTORY_FAILURES_REQUIRING_OPERATOR_ATTENTION.has(
      descriptor.value,
    );
}

class DockerExecutionBridge
  implements LocalOfflineNormalizationPreviewExecutionBridge {
  readonly #backendFactory: DockerBackendFactory;
  #dockerRuntimePromise: Promise<DockerRuntimeModule> | null = null;
  #backendPromise: Promise<LocalOfflinePreviewDockerSandboxBackend> | null = null;
  #reservationAttempted = false;
  #stopping = false;
  #stopPromise: Promise<void> | null = null;

  constructor(backendFactory: DockerBackendFactory) {
    this.#backendFactory = backendFactory;
  }

  #isStopping(): boolean {
    return this.#stopping;
  }

  async reserveSession(
    input: LocalOfflineNormalizationPreviewExecutionReservation,
    signal: AbortSignal,
  ): Promise<LocalOfflineNormalizationPreviewExecutionSession> {
    if (this.#isStopping()) {
      fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.stopped);
    }
    if (this.#reservationAttempted) {
      fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.alreadyUsed);
    }
    this.#reservationAttempted = true;
    const prepared = prepareExecutionReservation(input);
    const normalizedSignal = normalizeAbortSignal(signal);
    let session: LocalOfflinePreviewDockerSandboxSession | null = null;
    try {
      throwIfAborted(normalizedSignal.signal);
      // Reservation parsing is caller-owned and can invoke getters. Recheck
      // after every such operation so a reentrant stop cannot be followed by
      // a late backend start that escaped the stop barrier.
      if (this.#isStopping()) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.stopped);
      }
      this.#dockerRuntimePromise ??= import(
        "./local-offline-normalization-preview-docker-sandbox-production.js"
      );
      // Publish the promise before invoking the factory. stopAll() can now
      // await and stop every backend that can possibly be created, including
      // one whose initialization overlaps a stop request.
      this.#backendPromise ??= Promise.resolve().then(
        async () => await this.#backendFactory(),
      );
      const [backend, dockerRuntime] = await Promise.all([
        this.#backendPromise,
        this.#dockerRuntimePromise,
      ]);
      if (this.#isStopping()) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.stopped);
      }
      if (
        !backend.liveAuthorityCapable ||
        backend.runtimeMode !==
          "cryptographically_verified_bundled_qualification_private_preview"
      ) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.proofRejected);
      }
      throwIfAborted(normalizedSignal.signal);
      session = await backend.reserveSession({
        invocation: prepared.invocation,
        permitEnvelope: prepared.permitEnvelope,
        deadlineAt: prepared.deadlineAt,
      });
      throwIfAborted(normalizedSignal.signal);
      if (this.#isStopping()) {
        fail(LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ERROR_CODES.stopped);
      }
      const executionSession = new DockerExecutionSession(
        session,
        prepared,
        (witness, evidence): witness is LocalOfflinePreviewDockerSandboxLiveWitness =>
          dockerRuntime.isLocalOfflinePreviewDockerSandboxLiveWitness(witness) &&
          dockerRuntime.localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence(
            witness,
            evidence,
          ),
      );
      return executionSession;
    } catch (error: unknown) {
      if (session !== null) {
        // If this throws, cleanup proof correctly takes precedence over the
        // earlier reservation or cancellation failure.
        await session.stop();
      }
      throw error;
    } finally {
      normalizedSignal.dispose();
    }
  }

  stopAll(): Promise<void> {
    this.#stopping = true;
    this.#stopPromise ??= (async () => {
      const backendPromise = this.#backendPromise;
      if (backendPromise === null) return;
      let backend: LocalOfflinePreviewDockerSandboxBackend;
      try {
        backend = await backendPromise;
      } catch (error: unknown) {
        // A factory can fail after Docker accepted work or reconciliation found
        // an ambiguous orphan. Such a failure is the only surviving shutdown
        // handle, so it must remain terminal instead of becoming a clean stop.
        if (backendFactoryFailureRequiresOperatorAttention(error)) throw error;
        return;
      }
      // This is the one and only production backend shutdown call.
      await backend.stopAll();
    })();
    return this.#stopPromise;
  }
}

/**
 * Zero-input production bridge. It remains fail-closed while the generated
 * bundled release is null, and it never invents a permit or starts Docker
 * merely by being constructed.
 */
export function createLocalOfflineNormalizationPreviewDockerExecutionBridge(
): LocalOfflineNormalizationPreviewExecutionBridge {
  return new DockerExecutionBridge(
    async () =>
      await (
        await import(
          "./local-offline-normalization-preview-docker-sandbox-production.js"
        )
      ).createLocalOfflineNormalizationPreviewDockerSandbox(),
  );
}

/** Test-only backend seam. It cannot mint or bypass live witness proof. */
export function __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
  backendFactory: DockerBackendFactory,
): LocalOfflineNormalizationPreviewExecutionBridge {
  return new DockerExecutionBridge(backendFactory);
}

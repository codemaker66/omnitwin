import { KeyObject } from "node:crypto";
import type { ResourceLimits } from "node:worker_threads";
import {
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES,
  verifyFoundryOfflineNormalizeMeshGlbPreview,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  DsseEnvelopeSchema,
  type DsseEnvelope,
  type TrustedDsseKeys,
} from "../../../packages/reconstruction-foundry/src/dsse.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
} from "../../../packages/reconstruction-foundry/src/normalize-mesh-glb-worker.js";

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0 =
  "omnitwin.local-offline-normalization-preview-verifier-input.v0";
export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0 =
  "omnitwin.local-offline-normalization-preview-verifier-result.v0";

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES =
  Object.freeze({
    inputInvalid: "LOCAL_OFFLINE_PREVIEW_VERIFIER_INPUT_INVALID",
    verificationFailed: "LOCAL_OFFLINE_PREVIEW_FRESH_VERIFICATION_FAILED",
    resultDeliveryFailed:
      "LOCAL_OFFLINE_PREVIEW_VERIFIER_RESULT_DELIVERY_FAILED",
  } as const);

export type LocalOfflineNormalizationPreviewVerifierFailureCode =
  (typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES)[keyof typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES];

/**
 * A finite V8 memory budget for a verifier Worker. The host must additionally
 * enforce its own deadline and termination protocol. A Worker is not an
 * operating-system sandbox, and this module makes no filesystem or cache claim.
 */
export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS =
  Object.freeze({
    maxOldGenerationSizeMb: 512,
    maxYoungGenerationSizeMb: 64,
    codeRangeSizeMb: 64,
    stackSizeMb: 4,
  } satisfies ResourceLimits);

export const LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_MAX_RUNTIME_MS =
  60_000;

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const MAX_PINNED_PUBLIC_KEYS = 16;
const MAX_ENVELOPE_SIGNATURES = 16;
const MAX_ENCODED_SIGNATURE_LENGTH = 128;
const MAX_PAYLOAD_TYPE_LENGTH = 240;
const MAX_ENCODED_PERMIT_LENGTH =
  Math.ceil(
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES /
      3,
  ) * 4;

export interface LocalOfflineNormalizationPreviewVerifierInput {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0;
  /** Fresh bytes re-read by the trusted process after the transform Worker exits. */
  readonly freshSourceBytes: ArrayBuffer;
  /** Candidate bytes returned by the transform Worker. */
  readonly candidateOutputBytes: ArrayBuffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: DsseEnvelope;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  /** Process-pinned Ed25519 public keys only; never browser-provided keys. */
  readonly pinnedTrustedPermitKeys: TrustedDsseKeys;
}

export interface LocalOfflineNormalizationPreviewVerifierSuccess {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0;
  readonly kind: "verified";
  readonly candidateOutputBytes: ArrayBuffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
}

export interface LocalOfflineNormalizationPreviewVerifierFailure {
  readonly schemaVersion: typeof LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0;
  readonly kind: "failed";
  readonly code: LocalOfflineNormalizationPreviewVerifierFailureCode;
}

export type LocalOfflineNormalizationPreviewVerifierResult =
  | LocalOfflineNormalizationPreviewVerifierSuccess
  | LocalOfflineNormalizationPreviewVerifierFailure;

class VerifierInputError extends Error {
  constructor() {
    super("Invalid fresh-verification Worker input.");
    this.name = "VerifierInputError";
  }
}

function invalidInput(): never {
  throw new VerifierInputError();
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function exactObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidInput();
  }
  return value as Record<string, unknown>;
}

function parseExactPermitEnvelope(value: unknown): DsseEnvelope {
  const raw = exactObject(value);
  if (!exactKeys(raw, ["payload", "payloadType", "signatures"])) {
    invalidInput();
  }
  if (
    typeof raw.payloadType !== "string" ||
    raw.payloadType.length <= 0 ||
    raw.payloadType.length > MAX_PAYLOAD_TYPE_LENGTH ||
    typeof raw.payload !== "string" ||
    raw.payload.length <= 0 ||
    raw.payload.length > MAX_ENCODED_PERMIT_LENGTH ||
    !Array.isArray(raw.signatures) ||
    raw.signatures.length <= 0 ||
    raw.signatures.length > MAX_ENVELOPE_SIGNATURES
  ) {
    invalidInput();
  }
  for (const signature of raw.signatures) {
    const rawSignature = exactObject(signature);
    if (
      !exactKeys(rawSignature, ["keyid", "sig"]) ||
      typeof rawSignature.keyid !== "string" ||
      !KEY_ID.test(rawSignature.keyid) ||
      typeof rawSignature.sig !== "string" ||
      rawSignature.sig.length <= 0 ||
      rawSignature.sig.length > MAX_ENCODED_SIGNATURE_LENGTH
    ) {
      invalidInput();
    }
  }
  const parsed = DsseEnvelopeSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  if (
    parsed.data.payloadType !== raw.payloadType ||
    parsed.data.signatures.some(
      (signature, index) =>
        signature.keyid !==
        (raw.signatures as ReadonlyArray<Record<string, unknown>>)[index]
          ?.keyid,
    )
  ) {
    invalidInput();
  }
  return parsed.data;
}

function parsePinnedPublicKeys(value: unknown): TrustedDsseKeys {
  if (
    !(value instanceof Map) ||
    value.size <= 0 ||
    value.size > MAX_PINNED_PUBLIC_KEYS
  ) {
    invalidInput();
  }
  const parsed = new Map<string, KeyObject>();
  for (const [keyId, key] of value.entries()) {
    if (
      typeof keyId !== "string" ||
      !KEY_ID.test(keyId) ||
      !(key instanceof KeyObject) ||
      key.type !== "public" ||
      key.asymmetricKeyType !== "ed25519"
    ) {
      invalidInput();
    }
    parsed.set(keyId, key);
  }
  return parsed;
}

function parseBoundedBuffer(value: unknown): ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    value.byteLength <= 0 ||
    value.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
  ) {
    invalidInput();
  }
  return value;
}

export function parseLocalOfflineNormalizationPreviewVerifierInput(
  value: unknown,
): LocalOfflineNormalizationPreviewVerifierInput {
  try {
    const raw = exactObject(value);
    if (
      !exactKeys(raw, [
        "candidateOutputBytes",
        "freshSourceBytes",
        "invocation",
        "permitEnvelope",
        "pinnedTrustedPermitKeys",
        "report",
        "schemaVersion",
      ]) ||
      raw.schemaVersion !==
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0
    ) {
      invalidInput();
    }
    const freshSourceBytes = parseBoundedBuffer(raw.freshSourceBytes);
    const candidateOutputBytes = parseBoundedBuffer(
      raw.candidateOutputBytes,
    );
    if (freshSourceBytes === candidateOutputBytes) invalidInput();
    const invocation =
      FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.safeParse(
        raw.invocation,
      );
    const report =
      FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.safeParse(
        raw.report,
      );
    if (!invocation.success || !report.success) invalidInput();
    return {
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
      freshSourceBytes,
      candidateOutputBytes,
      invocation: invocation.data,
      permitEnvelope: parseExactPermitEnvelope(raw.permitEnvelope),
      report: report.data,
      pinnedTrustedPermitKeys: parsePinnedPublicKeys(
        raw.pinnedTrustedPermitKeys,
      ),
    };
  } catch (error: unknown) {
    if (error instanceof VerifierInputError) throw error;
    invalidInput();
  }
}

function isFailureCode(
  value: unknown,
): value is LocalOfflineNormalizationPreviewVerifierFailureCode {
  return value ===
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.inputInvalid ||
    value ===
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.verificationFailed ||
    value ===
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.resultDeliveryFailed;
}

export function parseLocalOfflineNormalizationPreviewVerifierResult(
  value: unknown,
): LocalOfflineNormalizationPreviewVerifierResult {
  const candidate = bufferFromField(value, "candidateOutputBytes");
  try {
    const raw = exactObject(value);
    if (
      raw.schemaVersion !==
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0
    ) {
      invalidInput();
    }
    if (
      exactKeys(raw, ["code", "kind", "schemaVersion"]) &&
      raw.kind === "failed" &&
      isFailureCode(raw.code)
    ) {
      return {
        schemaVersion:
          LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
        kind: "failed",
        code: raw.code,
      };
    }
    if (
      !exactKeys(raw, [
        "candidateOutputBytes",
        "kind",
        "report",
        "schemaVersion",
      ]) ||
      raw.kind !== "verified"
    ) {
      invalidInput();
    }
    const report =
      FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.safeParse(
        raw.report,
      );
    if (!report.success) invalidInput();
    return {
      schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "verified",
      candidateOutputBytes: parseBoundedBuffer(raw.candidateOutputBytes),
      report: report.data,
    };
  } catch (error: unknown) {
    bestEffortClearOfflinePreviewVerifierBuffer(candidate);
    if (error instanceof VerifierInputError) throw error;
    invalidInput();
  }
}

function bufferFromField(
  value: unknown,
  field: "freshSourceBytes" | "candidateOutputBytes",
): ArrayBuffer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[field];
  return candidate instanceof ArrayBuffer ? candidate : null;
}

export function bestEffortClearOfflinePreviewVerifierBuffer(
  bytes: ArrayBuffer | null,
): void {
  if (bytes === null) return;
  try {
    new Uint8Array(bytes).fill(0);
  } catch {
    // Best effort only. This is not a secure-erasure guarantee.
  }
}

/**
 * Executes deterministic fresh verification. The candidate buffer is returned
 * only on success. On every failure, both recognizable input buffers are
 * cleared best-effort before the fixed failure DTO is returned.
 */
export async function executeLocalOfflineNormalizationPreviewFreshVerification(
  value: unknown,
): Promise<LocalOfflineNormalizationPreviewVerifierResult> {
  const rawSource = bufferFromField(value, "freshSourceBytes");
  const rawCandidate = bufferFromField(value, "candidateOutputBytes");
  let returnCandidate = false;
  try {
    const input = parseLocalOfflineNormalizationPreviewVerifierInput(value);
    await verifyFoundryOfflineNormalizeMeshGlbPreview({
      invocation: input.invocation,
      sourceBytes: new Uint8Array(input.freshSourceBytes),
      normalizedGlb: new Uint8Array(input.candidateOutputBytes),
      permitEnvelope: input.permitEnvelope,
      pinnedTrustedPermitKeys: input.pinnedTrustedPermitKeys,
      report: input.report,
    });
    returnCandidate = true;
    return {
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "verified",
      candidateOutputBytes: input.candidateOutputBytes,
      report: input.report,
    };
  } catch (error: unknown) {
    return {
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "failed",
      code: error instanceof VerifierInputError
        ? LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.inputInvalid
        : LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.verificationFailed,
    };
  } finally {
    bestEffortClearOfflinePreviewVerifierBuffer(rawSource);
    if (!returnCandidate) {
      bestEffortClearOfflinePreviewVerifierBuffer(rawCandidate);
    }
  }
}

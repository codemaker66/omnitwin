import { timingSafeEqual } from "node:crypto";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  assertFoundryExecutionControlStateV0,
  assertFoundryExecutionSubjectV0,
  computeFoundryExecutionSubjectSha256,
  reduceFoundryExecutionTransition,
  type FoundryCheckpointCandidateV0,
  type FoundryExecutionControlStateV0,
  type FoundryExecutionEventPayloadV0,
  type FoundryExecutionSubjectV0,
  type OutboxCommandKind,
  type ProviderObservedState,
  type StopReason,
} from "./execution-control.js";

export const FOUNDRY_EXECUTION_EVENT_V0 = "omnitwin.foundry.execution-event.v0";

export type FoundryExecutionActorKind =
  | "operator"
  | "control_plane"
  | "worker"
  | "provider_adapter"
  | "watchdog";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSIGNED_BIGINT_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

const COMMAND_KINDS: readonly OutboxCommandKind[] = [
  "provider_submit",
  "provider_reconcile",
  "provider_poll",
  "provider_checkpoint",
  "provider_stop",
];

const PROVIDER_STATES: readonly ProviderObservedState[] = [
  "queued",
  "running",
  "checkpointing",
  "terminating",
  "termination_unconfirmed",
  "validating",
  "terminal_succeeded",
  "terminal_failed",
  "terminal_cancelled",
  "terminal_provider_lost",
];

const STOP_REASONS: readonly StopReason[] = [
  "operator_requested",
  "budget_hard_stop",
  "meter_stale",
  "kill_switch",
  "checkpoint_incompatible",
  "command_failure",
];

export interface FoundryExecutionLedgerEventV0 {
  readonly schemaVersion: typeof FOUNDRY_EXECUTION_EVENT_V0;
  readonly subjectSha256: string;
  readonly attemptId: string;
  readonly sequence: number;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorKind: FoundryExecutionActorKind;
  readonly actorKey: string;
  readonly idempotencyKey: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly fenceToken: string | null;
  readonly previousEventSha256: string | null;
  readonly payload: FoundryExecutionEventPayloadV0;
  readonly eventSha256: string;
}

export interface FoundryExecutionEventDraftV0 {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorKind: FoundryExecutionActorKind;
  readonly actorKey: string;
  readonly idempotencyKey: string;
  readonly causationId: string | null;
  readonly correlationId: string;
  readonly fenceToken: string | null;
  readonly payload: FoundryExecutionEventPayloadV0;
}

export interface FoundryExecutionLedgerReplayV0 {
  readonly subjectSha256: string;
  readonly eventCount: number;
  readonly headEventSha256: string | null;
  readonly state: FoundryExecutionControlStateV0 | null;
}

function fail(code: string, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail("INVALID_EXECUTION_EVENT", `${label} must be an object.`);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      "INVALID_EXECUTION_EVENT_KEYS",
      `${label} must contain exactly: ${expected.join(", ")}. Executable payloads, credentials, and unbound fields are forbidden.`,
    );
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") fail("INVALID_EXECUTION_EVENT", `${label} must be a string.`);
  return value;
}

function requireId(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!ID_PATTERN.test(result)) fail("INVALID_EXECUTION_EVENT", `${label} must be a bounded ASCII identifier.`);
  return result;
}

function requireCode(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!CODE_PATTERN.test(result)) fail("INVALID_EXECUTION_EVENT", `${label} must be a bounded lowercase code.`);
  return result;
}

function requireUuid(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!UUID_PATTERN.test(result)) fail("INVALID_EXECUTION_EVENT", `${label} must be a canonical lowercase UUID.`);
  return result;
}

function requireFenceToken(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!UNSIGNED_BIGINT_PATTERN.test(result)) {
    fail("INVALID_EXECUTION_EVENT", `${label} must be a canonical unsigned BIGINT string.`);
  }
  const parsed = BigInt(result);
  if (parsed <= 0n || parsed > MAX_SIGNED_BIGINT) {
    fail("INVALID_EXECUTION_EVENT", `${label} must be between one and the signed BIGINT ceiling.`);
  }
  return result;
}

function requireCanonicalMicroUsd(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!UNSIGNED_BIGINT_PATTERN.test(result) || BigInt(result) > MAX_SIGNED_BIGINT) {
    fail("INVALID_EXECUTION_EVENT", `${label} must be a canonical unsigned micro-USD BIGINT string.`);
  }
  return result;
}

function requireDigest(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!SHA256_PATTERN.test(result)) fail("INVALID_EXECUTION_EVENT", `${label} must be a lowercase sha256 digest.`);
  return result;
}

function requireNullableDigest(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireDigest(value, label);
}

function requireUtc(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!UTC_PATTERN.test(result)) fail("INVALID_EXECUTION_EVENT", `${label} must be canonical millisecond UTC.`);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    fail("INVALID_EXECUTION_EVENT", `${label} is not a real canonical UTC timestamp.`);
  }
  return result;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_EXECUTION_EVENT", `${label} must be a positive safe integer.`);
  }
  return value;
}

function requireNonnegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("INVALID_EXECUTION_EVENT", `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  const result = requireString(value, label);
  if (!(values as readonly string[]).includes(result)) {
    fail("INVALID_EXECUTION_EVENT", `${label} has an unsupported value.`);
  }
  return result as T;
}

function validateFence(payload: Record<string, unknown>): void {
  requireId(payload.ownerId, "payload.ownerId");
  requireFenceToken(payload.fenceToken, "payload.fenceToken");
}

function validateCheckpoint(value: unknown): void {
  const checkpoint = requireRecord(value, "payload.checkpoint");
  requireExactKeys(
    checkpoint,
    [
      "format",
      "formatVersion",
      "stageId",
      "workerImageSha256",
      "recipeSha256",
      "stageGraphSha256",
      "ingestManifestSha256",
      "checkpointCommandSha256",
      "inputCompatibilitySha256",
      "subjectSha256",
      "attemptId",
      "checkpointSha256",
      "sizeBytes",
      "createdAt",
      "ordinal",
      "complete",
      "verificationResult",
      "verifiedAt",
      "progressCursor",
      "producerProviderState",
      "producerStateVerifiedAt",
    ],
    "payload.checkpoint",
  );
  requireId(checkpoint.format, "checkpoint.format");
  requireId(checkpoint.formatVersion, "checkpoint.formatVersion");
  requireId(checkpoint.stageId, "checkpoint.stageId");
  requireDigest(checkpoint.workerImageSha256, "checkpoint.workerImageSha256");
  requireDigest(checkpoint.recipeSha256, "checkpoint.recipeSha256");
  requireDigest(checkpoint.stageGraphSha256, "checkpoint.stageGraphSha256");
  requireDigest(checkpoint.ingestManifestSha256, "checkpoint.ingestManifestSha256");
  requireDigest(checkpoint.checkpointCommandSha256, "checkpoint.checkpointCommandSha256");
  requireDigest(checkpoint.inputCompatibilitySha256, "checkpoint.inputCompatibilitySha256");
  requireDigest(checkpoint.subjectSha256, "checkpoint.subjectSha256");
  requireId(checkpoint.attemptId, "checkpoint.attemptId");
  requireDigest(checkpoint.checkpointSha256, "checkpoint.checkpointSha256");
  requireNonnegativeSafeInteger(checkpoint.sizeBytes, "checkpoint.sizeBytes");
  requireUtc(checkpoint.createdAt, "checkpoint.createdAt");
  requirePositiveSafeInteger(checkpoint.ordinal, "checkpoint.ordinal");
  if (checkpoint.complete !== true) fail("INVALID_EXECUTION_EVENT", "checkpoint.complete must be true.");
  requireEnum(checkpoint.verificationResult, ["verified_compatible"], "checkpoint.verificationResult");
  requireUtc(checkpoint.verifiedAt, "checkpoint.verifiedAt");
  requireId(checkpoint.progressCursor, "checkpoint.progressCursor");
  requireEnum(checkpoint.producerProviderState, ["inactive", "terminal"], "checkpoint.producerProviderState");
  requireUtc(checkpoint.producerStateVerifiedAt, "checkpoint.producerStateVerifiedAt");
}

export function assertFoundryExecutionEventPayloadV0(
  value: unknown,
): asserts value is FoundryExecutionEventPayloadV0 {
  const payload = requireRecord(value, "payload");
  const type = requireString(payload.type, "payload.type");
  switch (type) {
    case "attempt_authorized":
      requireExactKeys(payload, ["type"], "payload");
      return;
    case "lease_acquired":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "expiresAt"], "payload");
      validateFence(payload);
      requireUtc(payload.expiresAt, "payload.expiresAt");
      return;
    case "lease_renewed":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "expiresAt"], "payload");
      validateFence(payload);
      requireUtc(payload.expiresAt, "payload.expiresAt");
      return;
    case "lease_released":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken"], "payload");
      validateFence(payload);
      return;
    case "outbox_command_enqueued":
      requireExactKeys(
        payload,
        ["type", "ownerId", "fenceToken", "commandId", "commandKind", "reconcilesCommandId"],
        "payload",
      );
      validateFence(payload);
      requireId(payload.commandId, "payload.commandId");
      requireEnum(payload.commandKind, COMMAND_KINDS, "payload.commandKind");
      if (payload.reconcilesCommandId !== null) requireId(payload.reconcilesCommandId, "payload.reconcilesCommandId");
      return;
    case "outbox_command_claimed":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "commandId"], "payload");
      validateFence(payload);
      requireId(payload.commandId, "payload.commandId");
      return;
    case "outbox_command_succeeded":
    case "outbox_command_failed":
    case "outbox_command_uncertain":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "commandId", "resultCode"], "payload");
      validateFence(payload);
      requireId(payload.commandId, "payload.commandId");
      requireCode(payload.resultCode, "payload.resultCode");
      return;
    case "provider_reconciled":
      requireExactKeys(
        payload,
        ["type", "ownerId", "fenceToken", "commandId", "observationId", "outcome", "providerExecutionRefSha256"],
        "payload",
      );
      validateFence(payload);
      requireId(payload.commandId, "payload.commandId");
      requireId(payload.observationId, "payload.observationId");
      requireEnum(payload.outcome, ["not_found", ...PROVIDER_STATES], "payload.outcome");
      requireNullableDigest(payload.providerExecutionRefSha256, "payload.providerExecutionRefSha256");
      return;
    case "provider_state_observed":
      requireExactKeys(
        payload,
        ["type", "ownerId", "fenceToken", "observationId", "observedAt", "providerState", "providerExecutionRefSha256"],
        "payload",
      );
      validateFence(payload);
      requireId(payload.observationId, "payload.observationId");
      requireUtc(payload.observedAt, "payload.observedAt");
      requireEnum(payload.providerState, PROVIDER_STATES, "payload.providerState");
      requireDigest(payload.providerExecutionRefSha256, "payload.providerExecutionRefSha256");
      return;
    case "cost_observed":
      requireExactKeys(
        payload,
        [
          "type",
          "ownerId",
          "fenceToken",
          "observationId",
          "observedAt",
          "providerAccruedMicroUsd",
          "elapsedRateProjectionMicroUsd",
          "unbilledFixedMicroUsd",
          "unbilledStorageMicroUsd",
          "unbilledEgressMicroUsd",
        ],
        "payload",
      );
      validateFence(payload);
      requireId(payload.observationId, "payload.observationId");
      requireUtc(payload.observedAt, "payload.observedAt");
      requireCanonicalMicroUsd(payload.providerAccruedMicroUsd, "payload.providerAccruedMicroUsd");
      requireCanonicalMicroUsd(payload.elapsedRateProjectionMicroUsd, "payload.elapsedRateProjectionMicroUsd");
      requireCanonicalMicroUsd(payload.unbilledFixedMicroUsd, "payload.unbilledFixedMicroUsd");
      requireCanonicalMicroUsd(payload.unbilledStorageMicroUsd, "payload.unbilledStorageMicroUsd");
      requireCanonicalMicroUsd(payload.unbilledEgressMicroUsd, "payload.unbilledEgressMicroUsd");
      return;
    case "control_tick":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "checkedAt"], "payload");
      validateFence(payload);
      requireUtc(payload.checkedAt, "payload.checkedAt");
      return;
    case "stop_requested":
      requireExactKeys(payload, ["type", "reason", "requestedBy"], "payload");
      requireEnum(payload.reason, STOP_REASONS, "payload.reason");
      requireId(payload.requestedBy, "payload.requestedBy");
      return;
    case "kill_switch_engaged":
      requireExactKeys(
        payload,
        ["type", "requestedBy", "reasonCode", "scope", "scopeKey", "generation"],
        "payload",
      );
      requireId(payload.requestedBy, "payload.requestedBy");
      requireCode(payload.reasonCode, "payload.reasonCode");
      requireEnum(payload.scope, ["global", "project", "subject", "attempt"], "payload.scope");
      requireId(payload.scopeKey, "payload.scopeKey");
      requirePositiveSafeInteger(payload.generation, "payload.generation");
      return;
    case "checkpoint_observed":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "checkpoint"], "payload");
      validateFence(payload);
      validateCheckpoint(payload.checkpoint);
      return;
    case "validation_completed":
      requireExactKeys(payload, ["type", "ownerId", "fenceToken", "outcome", "resultCode"], "payload");
      validateFence(payload);
      requireEnum(payload.outcome, ["succeeded", "failed"], "payload.outcome");
      requireCode(payload.resultCode, "payload.resultCode");
      return;
    default:
      fail("UNKNOWN_EXECUTION_EVENT", `Unsupported execution event payload type: ${type}.`);
  }
}

interface EventAttributionInput {
  readonly actorKind: unknown;
  readonly actorKey: unknown;
  readonly idempotencyKey: unknown;
  readonly causationId: unknown;
  readonly correlationId: unknown;
  readonly fenceToken: unknown;
  readonly payload: unknown;
}

function requireEventAttribution(value: EventAttributionInput): void {
  const actorKind = requireEnum(
    value.actorKind,
    ["operator", "control_plane", "worker", "provider_adapter", "watchdog"],
    "event.actorKind",
  );
  const actorKey = requireId(value.actorKey, "event.actorKey");
  const idempotencyKey = requireId(value.idempotencyKey, "event.idempotencyKey");
  if (idempotencyKey.length < 8) {
    fail("INVALID_EXECUTION_IDEMPOTENCY_KEY", "Event idempotency keys must contain at least eight characters.");
  }
  if (value.causationId !== null) requireUuid(value.causationId, "event.causationId");
  requireUuid(value.correlationId, "event.correlationId");
  if (value.fenceToken !== null) requireFenceToken(value.fenceToken, "event.fenceToken");
  assertFoundryExecutionEventPayloadV0(value.payload);
  const payload = requireRecord(value.payload, "payload");
  const payloadFence = payload.fenceToken;
  if (payloadFence === undefined) {
    if (value.fenceToken !== null) {
      fail("UNEXPECTED_EXECUTION_FENCE", "An unfenced event cannot carry an envelope fencing token.");
    }
  } else {
    if (value.fenceToken !== payloadFence) {
      fail("EXECUTION_FENCE_BINDING_MISMATCH", "Envelope and payload fencing tokens must match exactly.");
    }
    if (payload.ownerId !== actorKey) {
      fail("EXECUTION_ACTOR_BINDING_MISMATCH", "A fenced event actor must own its payload lease operation.");
    }
    if (actorKind === "operator") {
      fail("INVALID_FENCED_ACTOR", "An operator actor cannot impersonate a fenced control-plane lease owner.");
    }
  }
  if (
    (payload.type === "stop_requested" || payload.type === "kill_switch_engaged") &&
    payload.requestedBy !== actorKey
  ) {
    fail("EXECUTION_ACTOR_BINDING_MISMATCH", "Stop and kill requests must bind requestedBy to the envelope actor.");
  }
}

function eventHashInput(event: Omit<FoundryExecutionLedgerEventV0, "eventSha256">): Record<string, unknown> {
  return {
    schemaVersion: event.schemaVersion,
    subjectSha256: event.subjectSha256,
    attemptId: event.attemptId,
    sequence: event.sequence,
    expectedRevision: event.expectedRevision,
    resultingRevision: event.resultingRevision,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    actorKind: event.actorKind,
    actorKey: event.actorKey,
    idempotencyKey: event.idempotencyKey,
    causationId: event.causationId,
    correlationId: event.correlationId,
    fenceToken: event.fenceToken,
    previousEventSha256: event.previousEventSha256,
    payload: event.payload,
  };
}

export function computeFoundryExecutionEventSha256(
  event: Omit<FoundryExecutionLedgerEventV0, "eventSha256">,
): string {
  assertFoundryExecutionEventPayloadV0(event.payload);
  return `sha256:${domainSeparatedSha256("OMNITWIN_FOUNDRY_EXECUTION_EVENT_V0", toCanonicalJson(eventHashInput(event)))}`;
}

function digestsEqual(left: string, right: string): boolean {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.slice(7), "hex"), Buffer.from(right.slice(7), "hex"));
}

export function createFoundryExecutionEvent(
  subject: FoundryExecutionSubjectV0,
  draft: FoundryExecutionEventDraftV0,
  previous: FoundryExecutionLedgerEventV0 | null,
): FoundryExecutionLedgerEventV0 {
  assertFoundryExecutionSubjectV0(subject);
  assertFoundryExecutionEventPayloadV0(draft.payload);
  requireId(draft.attemptId, "attemptId");
  requireUtc(draft.occurredAt, "occurredAt");
  requireUtc(draft.recordedAt, "recordedAt");
  requireEventAttribution(draft);
  if (Date.parse(draft.recordedAt) < Date.parse(draft.occurredAt)) {
    fail("INVALID_EXECUTION_EVENT_CHRONOLOGY", "recordedAt cannot predate occurredAt.");
  }
  if (previous !== null && previous.attemptId !== draft.attemptId) {
    fail("SECOND_EXECUTION_ATTEMPT_FORBIDDEN", "A hash chain cannot switch attempt IDs.");
  }
  const eventWithoutHash: Omit<FoundryExecutionLedgerEventV0, "eventSha256"> = {
    schemaVersion: FOUNDRY_EXECUTION_EVENT_V0,
    subjectSha256: computeFoundryExecutionSubjectSha256(subject),
    attemptId: draft.attemptId,
    sequence: (previous?.sequence ?? 0) + 1,
    expectedRevision: previous?.resultingRevision ?? 0,
    resultingRevision: (previous?.resultingRevision ?? 0) + 1,
    occurredAt: draft.occurredAt,
    recordedAt: draft.recordedAt,
    actorKind: draft.actorKind,
    actorKey: draft.actorKey,
    idempotencyKey: draft.idempotencyKey,
    causationId: draft.causationId,
    correlationId: draft.correlationId,
    fenceToken: draft.fenceToken,
    previousEventSha256: previous?.eventSha256 ?? null,
    payload: draft.payload,
  };
  return {
    ...eventWithoutHash,
    eventSha256: computeFoundryExecutionEventSha256(eventWithoutHash),
  };
}

function assertEventEnvelope(value: unknown): asserts value is FoundryExecutionLedgerEventV0 {
  const event = requireRecord(value, "event");
  requireExactKeys(
    event,
    [
      "schemaVersion",
      "subjectSha256",
      "attemptId",
      "sequence",
      "expectedRevision",
      "resultingRevision",
      "occurredAt",
      "recordedAt",
      "actorKind",
      "actorKey",
      "idempotencyKey",
      "causationId",
      "correlationId",
      "fenceToken",
      "previousEventSha256",
      "payload",
      "eventSha256",
    ],
    "event",
  );
  if (event.schemaVersion !== FOUNDRY_EXECUTION_EVENT_V0) {
    fail("INVALID_EXECUTION_EVENT_VERSION", "Execution event uses an unsupported schema version.");
  }
  requireDigest(event.subjectSha256, "event.subjectSha256");
  requireId(event.attemptId, "event.attemptId");
  requirePositiveSafeInteger(event.sequence, "event.sequence");
  requireNonnegativeSafeInteger(event.expectedRevision, "event.expectedRevision");
  requirePositiveSafeInteger(event.resultingRevision, "event.resultingRevision");
  requireUtc(event.occurredAt, "event.occurredAt");
  requireUtc(event.recordedAt, "event.recordedAt");
  requireEventAttribution({
    actorKind: event.actorKind,
    actorKey: event.actorKey,
    idempotencyKey: event.idempotencyKey,
    causationId: event.causationId,
    correlationId: event.correlationId,
    fenceToken: event.fenceToken,
    payload: event.payload,
  });
  requireNullableDigest(event.previousEventSha256, "event.previousEventSha256");
  assertFoundryExecutionEventPayloadV0(event.payload);
  requireDigest(event.eventSha256, "event.eventSha256");
}

export function replayFoundryExecutionLedger(
  subject: FoundryExecutionSubjectV0,
  values: readonly unknown[],
): FoundryExecutionLedgerReplayV0 {
  assertFoundryExecutionSubjectV0(subject);
  const subjectSha256 = computeFoundryExecutionSubjectSha256(subject);
  let state: FoundryExecutionControlStateV0 | null = null;
  let previous: FoundryExecutionLedgerEventV0 | null = null;
  const idempotencyKeys = new Set<string>();
  let correlationId: string | null = null;
  for (const value of values) {
    assertEventEnvelope(value);
    const event = value;
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    const expectedRevision = previous?.resultingRevision ?? 0;
    if (
      event.sequence !== expectedSequence ||
      event.expectedRevision !== expectedRevision ||
      event.resultingRevision !== expectedRevision + 1
    ) {
      fail("NON_CONTIGUOUS_EXECUTION_EVENT", "Event sequence and expected/resulting revision must be contiguous from one.");
    }
    if (event.sequence !== event.resultingRevision) {
      fail("EXECUTION_REVISION_DIVERGED", "V0 event sequence and revision must be equal.");
    }
    if (Date.parse(event.recordedAt) < Date.parse(event.occurredAt)) {
      fail("INVALID_EXECUTION_EVENT_CHRONOLOGY", "recordedAt cannot predate occurredAt.");
    }
    if (previous !== null && Date.parse(event.recordedAt) < Date.parse(previous.recordedAt)) {
      fail("EXECUTION_RECORDING_TIME_REGRESSION", "Ledger recording time cannot move backwards.");
    }
    if (idempotencyKeys.has(event.idempotencyKey)) {
      fail("DUPLICATE_EXECUTION_IDEMPOTENCY_KEY", "Each committed ledger event must have a unique idempotency key.");
    }
    idempotencyKeys.add(event.idempotencyKey);
    correlationId ??= event.correlationId;
    if (event.correlationId !== correlationId) {
      fail("EXECUTION_CORRELATION_CHANGED", "One execution attempt must retain a single correlation ID.");
    }
    if (event.subjectSha256 !== subjectSha256) {
      fail("EXECUTION_SUBJECT_CHANGED", "Event does not bind the supplied immutable execution subject.");
    }
    const expectedPrevious = previous?.eventSha256 ?? null;
    if (event.previousEventSha256 !== expectedPrevious) {
      fail("BROKEN_EXECUTION_HASH_CHAIN", "Event previous digest does not match the prior ledger event.");
    }
    if (previous !== null && event.attemptId !== previous.attemptId) {
      fail("SECOND_EXECUTION_ATTEMPT_FORBIDDEN", "Execution V0 cannot change attempt ID inside a ledger.");
    }
    const expectedHash = computeFoundryExecutionEventSha256({
      schemaVersion: event.schemaVersion,
      subjectSha256: event.subjectSha256,
      attemptId: event.attemptId,
      sequence: event.sequence,
      expectedRevision: event.expectedRevision,
      resultingRevision: event.resultingRevision,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      actorKind: event.actorKind,
      actorKey: event.actorKey,
      idempotencyKey: event.idempotencyKey,
      causationId: event.causationId,
      correlationId: event.correlationId,
      fenceToken: event.fenceToken,
      previousEventSha256: event.previousEventSha256,
      payload: event.payload,
    });
    if (!digestsEqual(event.eventSha256, expectedHash)) {
      fail("EXECUTION_EVENT_DIGEST_MISMATCH", "Execution event content does not match its digest.");
    }
    state = reduceFoundryExecutionTransition(state, subject, {
      attemptId: event.attemptId,
      sequence: event.sequence,
      revision: event.resultingRevision,
      occurredAt: event.occurredAt,
      payload: event.payload,
    });
    assertFoundryExecutionControlStateV0(state);
    previous = event;
  }
  return {
    subjectSha256,
    eventCount: values.length,
    headEventSha256: previous?.eventSha256 ?? null,
    state,
  };
}

export function checkpointCandidateFromUnknown(value: unknown): FoundryCheckpointCandidateV0 {
  validateCheckpoint(value);
  return value as FoundryCheckpointCandidateV0;
}

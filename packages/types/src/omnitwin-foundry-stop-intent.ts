import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryCanonicalActorSchema,
  FoundryProviderKindSchema,
  FoundryUtcInstantSchema,
} from "./omnitwin-foundry.js";
import { FoundryProviderAdapterVersionSchema } from "./omnitwin-foundry-execution.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";

/**
 * A stop intent can only narrow capability. It is immutable containment
 * evidence, not permission to submit, retry, resume, publish, or promote work.
 */
export const FOUNDRY_STOP_INTENT_V0 = "omnitwin.foundry.stop-intent.v0";

export const FOUNDRY_STOP_INTENT_REASON_CODES = [
  "operator_cancel",
  "kill_global",
  "kill_provider",
  "kill_project",
  "kill_execution",
  "kill_attempt",
  "rights_revoked",
  "cost_hard_stop",
  "wall_clock_deadline",
  "cancel_deadline",
  "termination_deadline",
  "worker_self_deadline",
  "provider_ttl_deadline",
  "checkpoint_effect_unknown",
] as const;
export const FoundryStopIntentReasonCodeSchema = z.enum(
  FOUNDRY_STOP_INTENT_REASON_CODES,
);
export type FoundryStopIntentReasonCode = z.infer<
  typeof FoundryStopIntentReasonCodeSchema
>;

export const FOUNDRY_STOP_INTENT_TERMINAL_STATES = [
  "cancelled",
  "killed",
  "budget_exceeded",
  "provider_lost",
] as const;
export const FoundryStopIntentTerminalStateSchema = z.enum(
  FOUNDRY_STOP_INTENT_TERMINAL_STATES,
);
export type FoundryStopIntentTerminalState = z.infer<
  typeof FoundryStopIntentTerminalStateSchema
>;

export const FOUNDRY_STOP_INTENT_SOURCE_KINDS = [
  "operator_request",
  "kill_switch_event",
  "rights_policy_revocation",
  "cost_observation",
  "runtime_watchdog",
  "provider_command",
] as const;
export const FoundryStopIntentSourceKindSchema = z.enum(
  FOUNDRY_STOP_INTENT_SOURCE_KINDS,
);
export type FoundryStopIntentSourceKind = z.infer<
  typeof FoundryStopIntentSourceKindSchema
>;

export const FOUNDRY_STOP_INTENT_ACTOR_KINDS = [
  "operator",
  "service",
  "watchdog",
  "system",
] as const;
export const FoundryStopIntentActorKindSchema = z.enum(
  FOUNDRY_STOP_INTENT_ACTOR_KINDS,
);
export type FoundryStopIntentActorKind = z.infer<
  typeof FoundryStopIntentActorKindSchema
>;

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const CANONICAL_POSITIVE_BIGINT = /^[1-9][0-9]{0,18}$/u;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_IDEMPOTENCY_KEY = /^[a-z0-9][a-z0-9._:-]{7,159}$/u;

export const FoundryStopIntentUuidSchema = z
  .string()
  .uuid()
  .regex(CANONICAL_UUID, "UUID must use canonical lowercase RFC form");

export const FoundryStopIntentFencingTokenSchema = z
  .string()
  .regex(
    CANONICAL_POSITIVE_BIGINT,
    "fencing token must be a canonical positive base-10 integer string",
  )
  .refine(
    (value) =>
      CANONICAL_POSITIVE_BIGINT.test(value) &&
      BigInt(value) <= MAX_SIGNED_BIGINT,
    "fencing token must fit a signed 64-bit integer",
  );

export const FoundryStopIntentIdempotencyKeySchema = z
  .string()
  .regex(
    CANONICAL_IDEMPOTENCY_KEY,
    "idempotency key must be 8-160 canonical lowercase ASCII characters",
  );

export const FoundryStopIntentScopeV0Schema = z
  .object({
    executionId: FoundryStopIntentUuidSchema,
    projectId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    executionSubjectSha256: RuntimeSha256Schema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    attemptId: FoundryStopIntentUuidSchema,
    attemptOrdinal: z.number().int().positive().max(1_000),
    fencingToken: FoundryStopIntentFencingTokenSchema,
  })
  .strict();
export type FoundryStopIntentScopeV0 = Readonly<
  z.infer<typeof FoundryStopIntentScopeV0Schema>
>;

const DESIRED_TERMINAL_STATE_BY_REASON = {
  operator_cancel: "cancelled",
  kill_global: "killed",
  kill_provider: "killed",
  kill_project: "killed",
  kill_execution: "killed",
  kill_attempt: "killed",
  rights_revoked: "killed",
  cost_hard_stop: "budget_exceeded",
  wall_clock_deadline: "cancelled",
  cancel_deadline: "provider_lost",
  termination_deadline: "provider_lost",
  worker_self_deadline: "provider_lost",
  provider_ttl_deadline: "provider_lost",
  checkpoint_effect_unknown: "provider_lost",
} as const satisfies Record<
  FoundryStopIntentReasonCode,
  FoundryStopIntentTerminalState
>;

const SOURCE_KIND_BY_REASON = {
  operator_cancel: "operator_request",
  kill_global: "kill_switch_event",
  kill_provider: "kill_switch_event",
  kill_project: "kill_switch_event",
  kill_execution: "kill_switch_event",
  kill_attempt: "kill_switch_event",
  rights_revoked: "rights_policy_revocation",
  cost_hard_stop: "cost_observation",
  wall_clock_deadline: "runtime_watchdog",
  cancel_deadline: "runtime_watchdog",
  termination_deadline: "runtime_watchdog",
  worker_self_deadline: "runtime_watchdog",
  provider_ttl_deadline: "runtime_watchdog",
  checkpoint_effect_unknown: "provider_command",
} as const satisfies Record<FoundryStopIntentReasonCode, FoundryStopIntentSourceKind>;

export function foundryStopIntentTerminalStateForReason(
  reasonCode: FoundryStopIntentReasonCode,
): FoundryStopIntentTerminalState {
  return DESIRED_TERMINAL_STATE_BY_REASON[reasonCode];
}

export function foundryStopIntentSourceKindForReason(
  reasonCode: FoundryStopIntentReasonCode,
): FoundryStopIntentSourceKind {
  return SOURCE_KIND_BY_REASON[reasonCode];
}

const FoundryStopIntentPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_STOP_INTENT_V0),
    intentId: FoundryStopIntentUuidSchema,
    intent: z.literal("stop"),
    authority: z.literal("containment_only"),
    scope: FoundryStopIntentScopeV0Schema,
    reasonCode: FoundryStopIntentReasonCodeSchema,
    desiredTerminalState: FoundryStopIntentTerminalStateSchema,
    sourceKind: FoundryStopIntentSourceKindSchema,
    sourceId: FoundryStopIntentUuidSchema,
    sourceSha256: RuntimeSha256Schema,
    sourceObservedAt: FoundryUtcInstantSchema,
    actorKind: FoundryStopIntentActorKindSchema,
    actorKey: FoundryCanonicalActorSchema,
    actorUserId: FoundryStopIntentUuidSchema.nullable(),
    idempotencyKey: FoundryStopIntentIdempotencyKeySchema,
    causationId: FoundryStopIntentUuidSchema,
    correlationId: FoundryStopIntentUuidSchema,
    createdAt: FoundryUtcInstantSchema,
  })
  .strict();

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function validateFoundryStopIntentPayload(
  intent: z.infer<typeof FoundryStopIntentPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  if (
    intent.desiredTerminalState !==
    foundryStopIntentTerminalStateForReason(intent.reasonCode)
  ) {
    addIssue(
      ctx,
      ["desiredTerminalState"],
      "desired terminal state must be the fail-closed state for the stop reason",
    );
  }
  if (intent.sourceKind !== foundryStopIntentSourceKindForReason(intent.reasonCode)) {
    addIssue(
      ctx,
      ["sourceKind"],
      "source kind must match the immutable stop reason",
    );
  }
  if ((intent.actorKind === "operator") !== (intent.actorUserId !== null)) {
    addIssue(
      ctx,
      ["actorUserId"],
      "operator actors require a user ID and non-operator actors forbid one",
    );
  }
  if (intent.reasonCode === "operator_cancel" && intent.actorKind !== "operator") {
    addIssue(
      ctx,
      ["actorKind"],
      "operator cancellation requires an authenticated operator actor",
    );
  }
  if (
    intent.reasonCode === "checkpoint_effect_unknown" &&
    intent.actorKind === "operator"
  ) {
    addIssue(
      ctx,
      ["actorKind"],
      "checkpoint-effect containment requires the service or recovery actor that completed the command",
    );
  }
  if (intent.causationId !== intent.sourceId) {
    addIssue(
      ctx,
      ["causationId"],
      "causation ID must bind the exact append-only source record",
    );
  }
  if (intent.intentId === intent.sourceId) {
    addIssue(
      ctx,
      ["intentId"],
      "stop intent and source record must have distinct IDs",
    );
  }
  if (Date.parse(intent.sourceObservedAt) > Date.parse(intent.createdAt)) {
    addIssue(
      ctx,
      ["sourceObservedAt"],
      "stop source must be observed no later than intent creation",
    );
  }
}

export const FoundryStopIntentPayloadV0Schema =
  FoundryStopIntentPayloadObjectSchema.superRefine(
    validateFoundryStopIntentPayload,
  );
export type FoundryStopIntentPayloadV0 = Readonly<
  Omit<z.infer<typeof FoundryStopIntentPayloadV0Schema>, "scope"> & {
    readonly scope: FoundryStopIntentScopeV0;
  }
>;

function domainSeparatedDigest(input: unknown): string {
  const canonical = CanonicalJsonValueSchema.parse(input);
  return `sha256:${sha256Hex(
    `${FOUNDRY_STOP_INTENT_V0}\n${stableCanonicalJson(canonical)}`,
  )}`;
}

export function computeFoundryStopIntentSha256(input: unknown): string {
  const payload = FoundryStopIntentPayloadV0Schema.parse(input);
  return domainSeparatedDigest(payload);
}

export const FoundryStopIntentV0Schema = FoundryStopIntentPayloadObjectSchema.extend({
  stopIntentSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((intent, ctx) => {
    const { stopIntentSha256: _stopIntentSha256, ...payload } = intent;
    const payloadResult = FoundryStopIntentPayloadV0Schema.safeParse(payload);
    if (!payloadResult.success) {
      validateFoundryStopIntentPayload(intent, ctx);
      return;
    }
    if (intent.stopIntentSha256 !== domainSeparatedDigest(payloadResult.data)) {
      addIssue(
        ctx,
        ["stopIntentSha256"],
        "stop-intent digest must match the exact immutable payload",
      );
    }
  });
export type FoundryStopIntentV0 = Readonly<
  Omit<z.infer<typeof FoundryStopIntentV0Schema>, "scope"> & {
    readonly scope: FoundryStopIntentScopeV0;
  }
>;

export const FoundryStopIntentBuildInputV0Schema = z
  .object({
    intentId: FoundryStopIntentUuidSchema,
    scope: FoundryStopIntentScopeV0Schema,
    reasonCode: FoundryStopIntentReasonCodeSchema,
    sourceId: FoundryStopIntentUuidSchema,
    sourceSha256: RuntimeSha256Schema,
    sourceObservedAt: FoundryUtcInstantSchema,
    actorKind: FoundryStopIntentActorKindSchema,
    actorKey: FoundryCanonicalActorSchema,
    actorUserId: FoundryStopIntentUuidSchema.nullable(),
    idempotencyKey: FoundryStopIntentIdempotencyKeySchema,
    causationId: FoundryStopIntentUuidSchema,
    correlationId: FoundryStopIntentUuidSchema,
    createdAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.actorKind === "operator") !== (input.actorUserId !== null)) {
      addIssue(
        ctx,
        ["actorUserId"],
        "operator actors require a user ID and non-operator actors forbid one",
      );
    }
    if (input.reasonCode === "operator_cancel" && input.actorKind !== "operator") {
      addIssue(
        ctx,
        ["actorKind"],
        "operator cancellation requires an authenticated operator actor",
      );
    }
    if (input.causationId !== input.sourceId) {
      addIssue(
        ctx,
        ["causationId"],
        "causation ID must bind the exact append-only source record",
      );
    }
    if (input.intentId === input.sourceId) {
      addIssue(
        ctx,
        ["intentId"],
        "stop intent and source record must have distinct IDs",
      );
    }
    if (Date.parse(input.sourceObservedAt) > Date.parse(input.createdAt)) {
      addIssue(
        ctx,
        ["sourceObservedAt"],
        "stop source must be observed no later than intent creation",
      );
    }
  });
export type FoundryStopIntentBuildInputV0 = Readonly<
  Omit<z.infer<typeof FoundryStopIntentBuildInputV0Schema>, "scope"> & {
    readonly scope: FoundryStopIntentScopeV0;
  }
>;

/** Builds, digest-binds, validates, and shallow/deep-freezes the V0 record. */
export function buildFoundryStopIntentV0(input: unknown): FoundryStopIntentV0 {
  const parsed = FoundryStopIntentBuildInputV0Schema.parse(input);
  const payload = FoundryStopIntentPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_STOP_INTENT_V0,
    intentId: parsed.intentId,
    intent: "stop",
    authority: "containment_only",
    scope: parsed.scope,
    reasonCode: parsed.reasonCode,
    desiredTerminalState: foundryStopIntentTerminalStateForReason(
      parsed.reasonCode,
    ),
    sourceKind: foundryStopIntentSourceKindForReason(parsed.reasonCode),
    sourceId: parsed.sourceId,
    sourceSha256: parsed.sourceSha256,
    sourceObservedAt: parsed.sourceObservedAt,
    actorKind: parsed.actorKind,
    actorKey: parsed.actorKey,
    actorUserId: parsed.actorUserId,
    idempotencyKey: parsed.idempotencyKey,
    causationId: parsed.causationId,
    correlationId: parsed.correlationId,
    createdAt: parsed.createdAt,
  });
  const verified = FoundryStopIntentV0Schema.parse({
    ...payload,
    stopIntentSha256: computeFoundryStopIntentSha256(payload),
  });
  Object.freeze(verified.scope);
  return Object.freeze(verified);
}

export type FoundryStopIntentScopeBindingDecision =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid_stop_intent" | "invalid_expected_scope" | "scope_mismatch";
    };

/** Resolves the digest-bound intent against the exact trusted attempt scope. */
export function validateFoundryStopIntentScopeBinding(
  intentInput: unknown,
  expectedScopeInput: unknown,
): FoundryStopIntentScopeBindingDecision {
  const intentResult = FoundryStopIntentV0Schema.safeParse(intentInput);
  if (!intentResult.success) return { valid: false, reason: "invalid_stop_intent" };
  const scopeResult = FoundryStopIntentScopeV0Schema.safeParse(expectedScopeInput);
  if (!scopeResult.success) {
    return { valid: false, reason: "invalid_expected_scope" };
  }
  const actual = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(intentResult.data.scope),
  );
  const expected = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(scopeResult.data),
  );
  return actual === expected
    ? { valid: true }
    : { valid: false, reason: "scope_mismatch" };
}

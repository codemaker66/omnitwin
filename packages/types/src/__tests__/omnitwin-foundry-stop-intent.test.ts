import { describe, expect, it } from "vitest";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "../canonical-layout-snapshot.js";
import {
  FOUNDRY_STOP_INTENT_REASON_CODES,
  FOUNDRY_STOP_INTENT_V0,
  FoundryStopIntentBuildInputV0Schema,
  FoundryStopIntentFencingTokenSchema,
  FoundryStopIntentPayloadV0Schema,
  FoundryStopIntentScopeV0Schema,
  FoundryStopIntentV0Schema,
  buildFoundryStopIntentV0,
  computeFoundryStopIntentSha256,
  foundryStopIntentSourceKindForReason,
  foundryStopIntentTerminalStateForReason,
  validateFoundryStopIntentScopeBinding,
  type FoundryStopIntentBuildInputV0,
  type FoundryStopIntentReasonCode,
  type FoundryStopIntentScopeV0,
} from "../omnitwin-foundry-stop-intent.js";

const INTENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const EXECUTION_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_USER_ID = "55555555-5555-4555-8555-555555555555";
const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_EXECUTION_ID = "77777777-7777-4777-8777-777777777777";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const SHA_E = `sha256:${"e".repeat(64)}`;

function scope(): FoundryStopIntentScopeV0 {
  return FoundryStopIntentScopeV0Schema.parse({
    executionId: EXECUTION_ID,
    projectId: "project-001",
    jobId: "job-001",
    executionEnvelopeSha256: SHA_A,
    executionSubjectSha256: SHA_B,
    providerKind: "runpod",
    providerAdapterId: "foundry-runner",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: SHA_C,
    providerDeploymentSha256: SHA_D,
    attemptId: ATTEMPT_ID,
    attemptOrdinal: 1,
    fencingToken: "42",
  });
}

function input(
  reasonCode: FoundryStopIntentReasonCode = "operator_cancel",
): FoundryStopIntentBuildInputV0 {
  const operator = reasonCode === "operator_cancel";
  return FoundryStopIntentBuildInputV0Schema.parse({
    intentId: INTENT_ID,
    scope: scope(),
    reasonCode,
    sourceId: SOURCE_ID,
    sourceSha256: SHA_E,
    sourceObservedAt: "2026-07-13T12:00:00.000Z",
    actorKind: operator ? "operator" : "system",
    actorKey: operator ? "operator@example.test" : "foundry-control-plane",
    actorUserId: operator ? ACTOR_USER_ID : null,
    idempotencyKey: `stop:${reasonCode}:job-001`,
    causationId: SOURCE_ID,
    correlationId: CORRELATION_ID,
    createdAt: "2026-07-13T12:00:01.000Z",
  });
}

function payloadOf(
  intent: ReturnType<typeof buildFoundryStopIntentV0>,
): Omit<typeof intent, "stopIntentSha256"> {
  const { stopIntentSha256: _stopIntentSha256, ...payload } = intent;
  return payload;
}

describe("Foundry stop-intent reason policy", () => {
  const expectedMappings = [
    ["operator_cancel", "cancelled", "operator_request"],
    ["kill_global", "killed", "kill_switch_event"],
    ["kill_provider", "killed", "kill_switch_event"],
    ["kill_project", "killed", "kill_switch_event"],
    ["kill_execution", "killed", "kill_switch_event"],
    ["kill_attempt", "killed", "kill_switch_event"],
    ["rights_revoked", "killed", "rights_policy_revocation"],
    ["cost_hard_stop", "budget_exceeded", "cost_observation"],
    ["wall_clock_deadline", "cancelled", "runtime_watchdog"],
    ["cancel_deadline", "provider_lost", "runtime_watchdog"],
    ["termination_deadline", "provider_lost", "runtime_watchdog"],
    ["worker_self_deadline", "provider_lost", "runtime_watchdog"],
    ["provider_ttl_deadline", "provider_lost", "runtime_watchdog"],
    ["checkpoint_effect_unknown", "provider_lost", "provider_command"],
  ] as const;

  it.each(expectedMappings)(
    "derives the only allowed source and terminal state for %s",
    (reasonCode, terminalState, sourceKind) => {
      const intent = buildFoundryStopIntentV0(input(reasonCode));
      expect(intent.reasonCode).toBe(reasonCode);
      expect(intent.desiredTerminalState).toBe(terminalState);
      expect(intent.sourceKind).toBe(sourceKind);
      expect(foundryStopIntentTerminalStateForReason(reasonCode)).toBe(terminalState);
      expect(foundryStopIntentSourceKindForReason(reasonCode)).toBe(sourceKind);
      expect(FoundryStopIntentV0Schema.safeParse(intent).success).toBe(true);
    },
  );

  it("covers every declared reason exactly once", () => {
    expect(expectedMappings.map(([reason]) => reason)).toEqual(
      FOUNDRY_STOP_INTENT_REASON_CODES,
    );
  });

  it("rejects a terminal state or source kind that does not match the reason", () => {
    const intent = buildFoundryStopIntentV0(input("cost_hard_stop"));
    const payload = payloadOf(intent);
    expect(
      FoundryStopIntentPayloadV0Schema.safeParse({
        ...payload,
        desiredTerminalState: "killed",
      }).success,
    ).toBe(false);
    expect(
      FoundryStopIntentPayloadV0Schema.safeParse({
        ...payload,
        sourceKind: "operator_request",
      }).success,
    ).toBe(false);
  });
});

describe("FoundryStopIntentScopeV0Schema", () => {
  it("requires the complete execution subject, provider deployment, attempt, and fence", () => {
    expect(FoundryStopIntentScopeV0Schema.safeParse(scope()).success).toBe(true);
    for (const key of [
      "executionId",
      "executionEnvelopeSha256",
      "executionSubjectSha256",
      "providerKind",
      "providerAdapterId",
      "providerAdapterVersion",
      "providerAdapterArtifactSha256",
      "providerDeploymentSha256",
      "attemptId",
      "attemptOrdinal",
      "fencingToken",
    ] as const) {
      const candidate = { ...scope(), [key]: undefined };
      expect(FoundryStopIntentScopeV0Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it.each([
    "",
    "0",
    "00",
    "01",
    "+1",
    "-1",
    "1.0",
    "9223372036854775808",
  ])("rejects non-canonical or out-of-range fence %j", (fence) => {
    expect(FoundryStopIntentFencingTokenSchema.safeParse(fence).success).toBe(false);
  });

  it("rejects numeric fences, unpinned adapters, malformed subjects, and unknown scope fields", () => {
    expect(FoundryStopIntentFencingTokenSchema.safeParse(42).success).toBe(false);
    expect(
      FoundryStopIntentScopeV0Schema.safeParse({
        ...scope(),
        providerAdapterVersion: "latest",
      }).success,
    ).toBe(false);
    expect(
      FoundryStopIntentScopeV0Schema.safeParse({
        ...scope(),
        executionSubjectSha256: SHA_B.toUpperCase(),
      }).success,
    ).toBe(false);
    expect(
      FoundryStopIntentScopeV0Schema.safeParse({
        ...scope(),
        providerCredentials: "secret",
      }).success,
    ).toBe(false);
  });

  it("bounds attempt ordinals", () => {
    expect(
      FoundryStopIntentScopeV0Schema.safeParse({ ...scope(), attemptOrdinal: 0 })
        .success,
    ).toBe(false);
    expect(
      FoundryStopIntentScopeV0Schema.safeParse({ ...scope(), attemptOrdinal: 1_001 })
        .success,
    ).toBe(false);
  });
});

describe("Foundry stop-intent lineage", () => {
  it("requires an authenticated user only for operator actors", () => {
    expect(
      FoundryStopIntentBuildInputV0Schema.safeParse({
        ...input(),
        actorUserId: null,
      }).success,
    ).toBe(false);
    expect(() => buildFoundryStopIntentV0({ ...input(), actorUserId: null })).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({
        ...input("rights_revoked"),
        actorKind: "service",
        actorUserId: ACTOR_USER_ID,
      }),
    ).toThrow();
  });

  it("requires operator_cancel to originate from an operator actor", () => {
    expect(() =>
      buildFoundryStopIntentV0({
        ...input(),
        actorKind: "system",
        actorUserId: null,
      }),
    ).toThrow();
  });

  it("binds causation to the exact source and rejects future sources", () => {
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), causationId: CORRELATION_ID }),
    ).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({
        ...input(),
        sourceObservedAt: "2026-07-13T12:00:01.001Z",
      }),
    ).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), intentId: SOURCE_ID }),
    ).toThrow();
  });

  it("rejects non-canonical IDs, instants, actors, and idempotency keys", () => {
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), intentId: INTENT_ID.toUpperCase() }),
    ).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({
        ...input(),
        createdAt: "2026-07-13T12:00:01Z",
      }),
    ).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), actorKey: " operator" }),
    ).toThrow();
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), idempotencyKey: "UPPER CASE" }),
    ).toThrow();
  });
});

describe("Foundry stop-intent digest and builder", () => {
  it("builds an authority-limited, digest-bound, frozen append-only record", () => {
    const intent = buildFoundryStopIntentV0(input());
    expect(intent).toMatchObject({
      schemaVersion: FOUNDRY_STOP_INTENT_V0,
      intent: "stop",
      authority: "containment_only",
      desiredTerminalState: "cancelled",
      sourceKind: "operator_request",
    });
    expect(intent.stopIntentSha256).toBe(
      computeFoundryStopIntentSha256(payloadOf(intent)),
    );
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.scope)).toBe(true);
    expect(Reflect.set(intent, "reasonCode", "kill_global")).toBe(false);
    expect(Reflect.set(intent.scope, "fencingToken", "43")).toBe(false);
  });

  it("uses the exact explicit digest domain", () => {
    const intent = buildFoundryStopIntentV0(input());
    const payload = payloadOf(intent);
    const canonical = CanonicalJsonValueSchema.parse(payload);
    const expected = `sha256:${sha256Hex(
      `${FOUNDRY_STOP_INTENT_V0}\n${stableCanonicalJson(canonical)}`,
    )}`;
    expect(intent.stopIntentSha256).toBe(expected);
  });

  it("rejects payload, scope, fence, reason, or lineage tampering", () => {
    const intent = buildFoundryStopIntentV0(input());
    for (const candidate of [
      { ...intent, reasonCode: "kill_global" },
      { ...intent, desiredTerminalState: "killed" },
      { ...intent, sourceSha256: SHA_A },
      { ...intent, correlationId: ACTOR_USER_ID },
      { ...intent, scope: { ...intent.scope, fencingToken: "43" } },
      { ...intent, scope: { ...intent.scope, executionSubjectSha256: SHA_A } },
    ]) {
      expect(FoundryStopIntentV0Schema.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects unknown or capability-expanding builder fields", () => {
    expect(() =>
      buildFoundryStopIntentV0({ ...input(), providerResponse: {} }),
    ).toThrow();
    expect(() => buildFoundryStopIntentV0({ ...input(), retry: true })).toThrow();
    expect(() => buildFoundryStopIntentV0({ ...input(), resume: true })).toThrow();
  });
});

describe("validateFoundryStopIntentScopeBinding", () => {
  it("accepts only the exact trusted attempt scope", () => {
    const intent = buildFoundryStopIntentV0(input());
    expect(validateFoundryStopIntentScopeBinding(intent, scope())).toEqual({
      valid: true,
    });
    expect(
      validateFoundryStopIntentScopeBinding(intent, {
        ...scope(),
        executionId: OTHER_EXECUTION_ID,
      }),
    ).toEqual({ valid: false, reason: "scope_mismatch" });
    expect(
      validateFoundryStopIntentScopeBinding(intent, {
        ...scope(),
        fencingToken: "43",
      }),
    ).toEqual({ valid: false, reason: "scope_mismatch" });
  });

  it("distinguishes invalid intent, invalid expected scope, and exact mismatch", () => {
    const intent = buildFoundryStopIntentV0(input());
    expect(
      validateFoundryStopIntentScopeBinding(
        { ...intent, stopIntentSha256: SHA_A },
        scope(),
      ),
    ).toEqual({ valid: false, reason: "invalid_stop_intent" });
    expect(validateFoundryStopIntentScopeBinding(intent, {})).toEqual({
      valid: false,
      reason: "invalid_expected_scope",
    });
  });
});

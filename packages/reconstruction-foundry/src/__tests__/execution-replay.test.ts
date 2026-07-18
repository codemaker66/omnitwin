import { describe, expect, it } from "vitest";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  computeFoundryExecutionSubjectSha256,
  type FoundryExecutionEventPayloadV0,
  type FoundryExecutionSubjectV0,
} from "../execution-control.js";
import {
  computeFoundryExecutionEventSha256,
  createFoundryExecutionEvent,
  replayFoundryExecutionLedger,
  type FoundryExecutionLedgerEventV0,
} from "../execution-replay.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const PROVIDER_REF = `sha256:${"1".repeat(64)}`;
const CHECKPOINT = `sha256:${"2".repeat(64)}`;

function subject(overrides: Partial<FoundryExecutionSubjectV0> = {}): FoundryExecutionSubjectV0 {
  return {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: "execution-subject-1",
    projectId: "project-1",
    jobSpecSha256: DIGEST_A,
    executionEnvelopeSha256: `sha256:${"4".repeat(64)}`,
    ingestManifestSha256: DIGEST_B,
    intakeAdmissionResultSha256: `sha256:${"5".repeat(64)}`,
    intakeStagingIndexSha256: `sha256:${"6".repeat(64)}`,
    providerPlanSha256: DIGEST_C,
    executionPolicySha256: `sha256:${"0".repeat(64)}`,
    executionConfirmationSha256: DIGEST_D,
    rightsApprovalSha256: DIGEST_E,
    rightsPolicyEvidenceSha256: `sha256:${"7".repeat(64)}`,
    rightsPolicyDefinitionSha256: `sha256:${"8".repeat(64)}`,
    computeApprovalSha256: DIGEST_F,
    providerKind: "runpod",
    providerAdapterId: "runpod-v0",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: `sha256:${"9".repeat(64)}`,
    providerDeploymentSha256: `sha256:${"0".repeat(64)}`,
    workerProfileSha256s: [
      `sha256:${"1".repeat(64)}`,
      `sha256:${"2".repeat(64)}`,
    ],
    pricingSnapshotSha256: `sha256:${"3".repeat(64)}`,
    pricingSnapshotExpiresAt: "2026-07-13T11:00:00.000Z",
    createdAt: "2026-07-13T10:00:00.000Z",
    dispatchDeadline: "2026-07-13T10:30:00.000Z",
    maximumAttempts: FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: "500",
      costHardStopMicroUsd: "1000",
      terminationReserveMicroUsd: "100",
      absoluteCostCapMicroUsd: "2000",
      costObservationMaximumAgeSeconds: 60,
    },
    checkpointContract: {
      format: "gsplat",
      formatVersion: "1.0",
      stageId: "appearance",
      workerImageSha256: DIGEST_A,
      recipeSha256: DIGEST_C,
      stageGraphSha256: DIGEST_D,
      ingestManifestSha256: DIGEST_B,
      checkpointCommandSha256: DIGEST_E,
      inputCompatibilitySha256: DIGEST_F,
    },
    ...overrides,
  };
}

function append(
  source: FoundryExecutionSubjectV0,
  events: FoundryExecutionLedgerEventV0[],
  occurredAt: string,
  payload: FoundryExecutionEventPayloadV0,
): FoundryExecutionLedgerEventV0 {
  const ordinal = events.length + 1;
  const actorKey =
    "ownerId" in payload
      ? payload.ownerId
      : "requestedBy" in payload
        ? payload.requestedBy
        : "control-plane";
  const eventId = (value: number): string =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const event = createFoundryExecutionEvent(
    source,
    {
      attemptId: "attempt-1",
      occurredAt,
      recordedAt: occurredAt,
      actorKind: "requestedBy" in payload ? "operator" : "ownerId" in payload ? "worker" : "control_plane",
      actorKey,
      idempotencyKey: `execution-event-${String(ordinal)}`,
      causationId: ordinal === 1 ? null : eventId(ordinal - 1),
      correlationId: "00000000-0000-4000-8000-000000000001",
      fenceToken: "fenceToken" in payload ? payload.fenceToken : null,
      payload,
    },
    events.at(-1) ?? null,
  );
  events.push(event);
  return event;
}

function runningLedger(source: FoundryExecutionSubjectV0): FoundryExecutionLedgerEventV0[] {
  const events: FoundryExecutionLedgerEventV0[] = [];
  append(source, events, "2026-07-13T10:00:01.000Z", { type: "attempt_authorized" });
  append(source, events, "2026-07-13T10:00:02.000Z", {
    type: "lease_acquired",
    ownerId: "worker-a",
      fenceToken: "1",
    expiresAt: "2026-07-13T11:00:00.000Z",
  });
  append(source, events, "2026-07-13T10:00:03.000Z", {
    type: "outbox_command_enqueued",
    ownerId: "worker-a",
      fenceToken: "1",
    commandId: "submit-1",
    commandKind: "provider_submit",
    reconcilesCommandId: null,
  });
  append(source, events, "2026-07-13T10:00:04.000Z", {
    type: "outbox_command_claimed",
    ownerId: "worker-a",
      fenceToken: "1",
    commandId: "submit-1",
  });
  append(source, events, "2026-07-13T10:00:05.000Z", {
    type: "outbox_command_succeeded",
    ownerId: "worker-a",
      fenceToken: "1",
    commandId: "submit-1",
    resultCode: "accepted",
  });
  append(source, events, "2026-07-13T10:00:06.000Z", {
    type: "provider_state_observed",
    ownerId: "worker-a",
      fenceToken: "1",
    observationId: "provider-running-1",
    observedAt: "2026-07-13T10:00:05.500Z",
    providerState: "running",
    providerExecutionRefSha256: PROVIDER_REF,
  });
  return events;
}

describe("Foundry execution ledger replay", () => {
  it("replays a hash-bound single attempt through checkpoint and validation", () => {
    const source = subject();
    const events = runningLedger(source);
    append(source, events, "2026-07-13T10:00:07.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-1",
      observedAt: "2026-07-13T10:00:06.500Z",
      providerAccruedMicroUsd: "400",
      elapsedRateProjectionMicroUsd: "500",
      unbilledFixedMicroUsd: "100",
      unbilledStorageMicroUsd: "0",
      unbilledEgressMicroUsd: "0",
    });
    append(source, events, "2026-07-13T10:00:08.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
      commandKind: "provider_checkpoint",
      reconcilesCommandId: null,
    });
    append(source, events, "2026-07-13T10:00:09.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
    });
    append(source, events, "2026-07-13T10:00:10.000Z", {
      type: "outbox_command_succeeded",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
      resultCode: "checkpoint_written",
    });
    append(source, events, "2026-07-13T10:00:11.000Z", {
      type: "checkpoint_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      checkpoint: {
        ...source.checkpointContract!,
        subjectSha256: events[0]!.subjectSha256,
        attemptId: "attempt-1",
        checkpointSha256: CHECKPOINT,
        sizeBytes: 4_096,
        createdAt: "2026-07-13T10:00:10.500Z",
        ordinal: 1,
        complete: true,
        verificationResult: "verified_compatible",
        verifiedAt: "2026-07-13T10:00:10.900Z",
        progressCursor: "step-1000",
        producerProviderState: "inactive",
        producerStateVerifiedAt: "2026-07-13T10:00:10.800Z",
      },
    });
    append(source, events, "2026-07-13T10:00:12.000Z", {
      type: "provider_state_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "provider-running-2",
      observedAt: "2026-07-13T10:00:11.500Z",
      providerState: "running",
      providerExecutionRefSha256: PROVIDER_REF,
    });
    append(source, events, "2026-07-13T10:00:13.000Z", {
      type: "provider_state_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "provider-complete-1",
      observedAt: "2026-07-13T10:00:12.500Z",
      providerState: "terminal_succeeded",
      providerExecutionRefSha256: PROVIDER_REF,
    });
    append(source, events, "2026-07-13T10:00:14.000Z", {
      type: "validation_completed",
      ownerId: "worker-a",
      fenceToken: "1",
      outcome: "succeeded",
      resultCode: "candidate_valid",
    });

    const replay = replayFoundryExecutionLedger(source, events);
    expect(replay.eventCount).toBe(events.length);
    expect(replay.headEventSha256).toBe(events.at(-1)?.eventSha256);
    expect(replay.state).toMatchObject({
      attemptId: "attempt-1",
      attemptNumber: 1,
      state: "terminal_succeeded",
      conservativeExposureMicroUsd: "700",
      costWarningTriggeredAt: "2026-07-13T10:00:07.000Z",
      latestCompatibleCheckpoint: { checkpointSha256: CHECKPOINT },
    });
    expect(replay.state?.outbox.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "provider_submit", status: "succeeded" },
      { kind: "provider_checkpoint", status: "succeeded" },
    ]);
  });

  it("rejects content tampering, broken sequence/revision, and broken hash links", () => {
    const source = subject();
    const events = runningLedger(source);
    const tampered = events.map((event) => ({ ...event }));
    tampered[2] = {
      ...tampered[2]!,
      occurredAt: "2026-07-13T10:00:02.500Z",
    };
    expect(() => replayFoundryExecutionLedger(source, tampered)).toThrow("content does not match its digest");

    const gapped = events.map((event) => ({ ...event }));
    gapped[1] = { ...gapped[1]!, sequence: 3 };
    expect(() => replayFoundryExecutionLedger(source, gapped)).toThrow("sequence and expected/resulting revision must be contiguous");

    const revisionDrift = events.map((event) => ({ ...event }));
    revisionDrift[1] = { ...revisionDrift[1]!, expectedRevision: 2 };
    expect(() => replayFoundryExecutionLedger(source, revisionDrift)).toThrow(
      "sequence and expected/resulting revision must be contiguous",
    );

    const brokenLink = events.map((event) => ({ ...event }));
    brokenLink[1] = { ...brokenLink[1]!, previousEventSha256: DIGEST_F };
    expect(() => replayFoundryExecutionLedger(source, brokenLink)).toThrow("previous digest does not match");
  });

  it("hashes attribution, timing, revision, correlation, idempotency, and fencing metadata", () => {
    const source = subject();
    const event = runningLedger(source)[2]!;
    const { eventSha256, ...body } = event;
    const variants = [
      { ...body, recordedAt: "2026-07-13T10:00:03.001Z" },
      { ...body, actorKind: "provider_adapter" as const },
      { ...body, actorKey: "worker-b" },
      { ...body, idempotencyKey: "execution-event-replacement" },
      { ...body, causationId: "00000000-0000-4000-8000-000000000099" },
      { ...body, correlationId: "00000000-0000-4000-8000-000000000099" },
      { ...body, expectedRevision: body.expectedRevision + 1 },
      { ...body, resultingRevision: body.resultingRevision + 1 },
      { ...body, fenceToken: "2" },
    ];
    for (const variant of variants) {
      expect(computeFoundryExecutionEventSha256(variant)).not.toBe(eventSha256);
    }

    expect(() => replayFoundryExecutionLedger(source, [{
      ...runningLedger(source)[0]!,
      providerCredentials: "secret",
    }])).toThrow("Executable payloads, credentials, and unbound fields are forbidden");
  });

  it("rejects envelope/payload fence drift and duplicate committed idempotency keys", () => {
    const source = subject();
    const events = runningLedger(source);
    const payload: FoundryExecutionEventPayloadV0 = {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-fence-test",
      observedAt: "2026-07-13T10:00:06.500Z",
      providerAccruedMicroUsd: "1",
      elapsedRateProjectionMicroUsd: "1",
      unbilledFixedMicroUsd: "0",
      unbilledStorageMicroUsd: "0",
      unbilledEgressMicroUsd: "0",
    };
    expect(() => createFoundryExecutionEvent(source, {
      attemptId: "attempt-1",
      occurredAt: "2026-07-13T10:00:07.000Z",
      recordedAt: "2026-07-13T10:00:07.000Z",
      actorKind: "worker",
      actorKey: "worker-a",
      idempotencyKey: "execution-event-fence-drift",
      causationId: "00000000-0000-4000-8000-000000000006",
      correlationId: "00000000-0000-4000-8000-000000000001",
      fenceToken: "2",
      payload,
    }, events.at(-1)!)).toThrow("fencing tokens must match");

    const duplicate = createFoundryExecutionEvent(source, {
      attemptId: "attempt-1",
      occurredAt: "2026-07-13T10:00:07.000Z",
      recordedAt: "2026-07-13T10:00:07.000Z",
      actorKind: "worker",
      actorKey: "worker-a",
      idempotencyKey: events[0]!.idempotencyKey,
      causationId: "00000000-0000-4000-8000-000000000006",
      correlationId: "00000000-0000-4000-8000-000000000001",
      fenceToken: "1",
      payload,
    }, events.at(-1)!);
    expect(() => replayFoundryExecutionLedger(source, [...events, duplicate])).toThrow(
      "unique idempotency key",
    );
  });

  it("rejects subject substitution, a second attempt, and extra executable command fields", () => {
    const source = subject();
    const events = runningLedger(source);
    expect(() => replayFoundryExecutionLedger(subject({ projectId: "other-project" }), events)).toThrow(
      "does not bind the supplied immutable execution subject",
    );
    expect(() =>
      createFoundryExecutionEvent(
        source,
        {
          attemptId: "attempt-2",
          occurredAt: "2026-07-13T10:00:07.000Z",
          recordedAt: "2026-07-13T10:00:07.000Z",
          actorKind: "control_plane",
          actorKey: "control-plane",
          idempotencyKey: "execution-event-attempt-2",
          causationId: "00000000-0000-4000-8000-000000000006",
          correlationId: "00000000-0000-4000-8000-000000000001",
          fenceToken: null,
          payload: { type: "attempt_authorized" },
        },
        events.at(-1)!,
      ),
    ).toThrow("cannot switch attempt IDs");

    const payloadWithCredentials = {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "bad-command",
      commandKind: "provider_poll",
      reconcilesCommandId: null,
      credentials: "secret",
    };
    expect(() =>
      createFoundryExecutionEvent(
        source,
        {
          attemptId: "attempt-1",
          occurredAt: "2026-07-13T10:00:07.000Z",
          recordedAt: "2026-07-13T10:00:07.000Z",
          actorKind: "worker",
          actorKey: "worker-a",
          idempotencyKey: "execution-event-bad-command",
          causationId: "00000000-0000-4000-8000-000000000006",
          correlationId: "00000000-0000-4000-8000-000000000001",
          fenceToken: "1",
          payload: payloadWithCredentials as FoundryExecutionEventPayloadV0,
        },
        events.at(-1)!,
      ),
    ).toThrow("Executable payloads, credentials, and unbound fields are forbidden");
  });

  it("binds every admission, rights, worker, adapter, pricing, and deadline fact into the subject digest", () => {
    const source = subject();
    const digest = computeFoundryExecutionSubjectSha256(source);
    const variants: readonly FoundryExecutionSubjectV0[] = [
      subject({ executionEnvelopeSha256: DIGEST_A }),
      subject({ intakeAdmissionResultSha256: DIGEST_A }),
      subject({ intakeStagingIndexSha256: DIGEST_B }),
      subject({ executionPolicySha256: DIGEST_A }),
      subject({ rightsPolicyEvidenceSha256: DIGEST_A }),
      subject({ rightsPolicyDefinitionSha256: DIGEST_B }),
      subject({ computeApprovalSha256: DIGEST_A }),
      subject({ providerAdapterVersion: "1.2.4" }),
      subject({ providerAdapterArtifactSha256: DIGEST_B }),
      subject({ providerDeploymentSha256: DIGEST_C }),
      subject({ workerProfileSha256s: [`sha256:${"3".repeat(64)}`] }),
      subject({ pricingSnapshotSha256: DIGEST_B }),
      subject({ pricingSnapshotExpiresAt: "2026-07-13T10:59:59.000Z" }),
      subject({ dispatchDeadline: "2026-07-13T10:29:59.000Z" }),
    ];
    for (const variant of variants) {
      expect(computeFoundryExecutionSubjectSha256(variant)).not.toBe(digest);
      expect(() => replayFoundryExecutionLedger(variant, runningLedger(source))).toThrow(
        "does not bind the supplied immutable execution subject",
      );
    }
  });

  it("accepts an empty ledger without manufacturing an attempt", () => {
    const replay = replayFoundryExecutionLedger(subject(), []);
    expect(replay).toMatchObject({ eventCount: 0, headEventSha256: null, state: null });
  });
});

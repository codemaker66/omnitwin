import { describe, expect, it } from "vitest";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  deriveFoundryExecutionControlView,
  validateFoundryCheckpointCompatibility,
  type FoundryExecutionEventPayloadV0,
  type FoundryExecutionSubjectV0,
} from "../execution-control.js";
import {
  createFoundryExecutionEvent,
  replayFoundryExecutionLedger,
  type FoundryExecutionLedgerEventV0,
} from "../execution-replay.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const PROVIDER_REF = digest("9");

function subject(
  budgetOverrides: Partial<FoundryExecutionSubjectV0["budgetPolicy"]> = {},
): FoundryExecutionSubjectV0 {
  return {
    schemaVersion: FOUNDRY_EXECUTION_SUBJECT_V0,
    subjectId: "execution-subject-1",
    projectId: "project-1",
    jobSpecSha256: digest("a"),
    executionEnvelopeSha256: digest("7"),
    ingestManifestSha256: digest("b"),
    intakeAdmissionResultSha256: digest("8"),
    intakeStagingIndexSha256: digest("9"),
    providerPlanSha256: digest("c"),
    executionPolicySha256: digest("6"),
    executionConfirmationSha256: digest("d"),
    rightsApprovalSha256: digest("e"),
    rightsPolicyEvidenceSha256: digest("7"),
    rightsPolicyDefinitionSha256: digest("8"),
    computeApprovalSha256: digest("f"),
    providerKind: "runpod",
    providerAdapterId: "runpod-v0",
    providerAdapterVersion: "1.2.3",
    providerAdapterArtifactSha256: digest("a"),
    providerDeploymentSha256: digest("b"),
    workerProfileSha256s: [digest("1"), digest("2")],
    pricingSnapshotSha256: digest("0"),
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
      ...budgetOverrides,
    },
    checkpointContract: {
      format: "gsplat",
      formatVersion: "1.0",
      stageId: "appearance",
      workerImageSha256: digest("1"),
      recipeSha256: digest("2"),
      stageGraphSha256: digest("3"),
      ingestManifestSha256: digest("b"),
      checkpointCommandSha256: digest("4"),
      inputCompatibilitySha256: digest("5"),
    },
  };
}

class Ledger {
  readonly source: FoundryExecutionSubjectV0;
  readonly events: FoundryExecutionLedgerEventV0[] = [];

  constructor(source = subject()) {
    this.source = source;
  }

  append(occurredAt: string, payload: FoundryExecutionEventPayloadV0): FoundryExecutionLedgerEventV0 {
    const ordinal = this.events.length + 1;
    const actorKey =
      "ownerId" in payload
        ? payload.ownerId
        : "requestedBy" in payload
          ? payload.requestedBy
          : "control-plane";
    const eventId = (value: number): string =>
      `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
    const event = createFoundryExecutionEvent(
      this.source,
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
      this.events.at(-1) ?? null,
    );
    this.events.push(event);
    return event;
  }

  replay() {
    return replayFoundryExecutionLedger(this.source, this.events);
  }

  authorizeAndLease(expiresAt = "2026-07-13T11:00:00.000Z"): void {
    this.append("2026-07-13T10:00:01.000Z", { type: "attempt_authorized" });
    this.append("2026-07-13T10:00:02.000Z", {
      type: "lease_acquired",
      ownerId: "worker-a",
      fenceToken: "1",
      expiresAt,
    });
  }

  submitAndRun(): void {
    this.authorizeAndLease();
    this.append("2026-07-13T10:00:03.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    this.append("2026-07-13T10:00:04.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
    });
    this.append("2026-07-13T10:00:05.000Z", {
      type: "outbox_command_succeeded",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      resultCode: "accepted",
    });
    this.append("2026-07-13T10:00:06.000Z", {
      type: "provider_state_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "provider-running-1",
      observedAt: "2026-07-13T10:00:05.500Z",
      providerState: "running",
      providerExecutionRefSha256: PROVIDER_REF,
    });
  }
}

describe("Foundry execution control", () => {
  it("makes a claimed/uncertain submit provider-unknown and requires reconciliation, never resubmit", () => {
    const ledger = new Ledger();
    ledger.authorizeAndLease("2026-07-13T10:00:10.000Z");
    ledger.append("2026-07-13T10:00:03.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    ledger.append("2026-07-13T10:00:04.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
    });
    ledger.append("2026-07-13T10:00:05.000Z", {
      type: "outbox_command_uncertain",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      resultCode: "transport_unknown",
    });
    expect(ledger.replay().state?.state).toBe("provider_unknown");

    ledger.append("2026-07-13T10:00:06.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "blind-submit-2",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    expect(() => ledger.replay()).toThrow("submission is permitted only once");
    ledger.events.pop();

    ledger.append("2026-07-13T10:00:06.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "poll-before-reconcile",
      commandKind: "provider_poll",
      reconcilesCommandId: null,
    });
    expect(() => ledger.replay()).toThrow("must be reconciled before another provider command");
    ledger.events.pop();

    ledger.append("2026-07-13T10:00:06.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "reconcile-submit-1",
      commandKind: "provider_reconcile",
      reconcilesCommandId: "submit-1",
    });
    ledger.append("2026-07-13T10:00:07.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "reconcile-submit-1",
    });
    ledger.append("2026-07-13T10:00:08.000Z", {
      type: "outbox_command_succeeded",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "reconcile-submit-1",
      resultCode: "lookup_complete",
    });
    ledger.append("2026-07-13T10:00:09.000Z", {
      type: "provider_reconciled",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      observationId: "reconcile-observation-1",
      outcome: "running",
      providerExecutionRefSha256: PROVIDER_REF,
    });
    const replay = ledger.replay();
    expect(replay.state?.state).toBe("running");
    expect(replay.state?.outbox.find(({ commandId }) => commandId === "submit-1")?.reconciliationObservationId).toBe(
      "reconcile-observation-1",
    );
  });

  it("rejects overlapping leases and stale fenced writers after takeover", () => {
    const ledger = new Ledger();
    ledger.authorizeAndLease("2026-07-13T10:00:05.000Z");
    ledger.append("2026-07-13T10:00:04.000Z", {
      type: "lease_acquired",
      ownerId: "worker-b",
      fenceToken: "2",
      expiresAt: "2026-07-13T10:01:00.000Z",
    });
    expect(() => ledger.replay()).toThrow("cannot overlap the active lease");
    ledger.events.pop();

    ledger.append("2026-07-13T10:00:06.000Z", {
      type: "lease_acquired",
      ownerId: "worker-b",
      fenceToken: "2",
      expiresAt: "2026-07-13T10:01:00.000Z",
    });
    ledger.append("2026-07-13T10:00:07.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "stale-submit",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    expect(() => ledger.replay()).toThrow("stale or foreign fencing token");
  });

  it("keeps conservative cost monotonic across duplicates and out-of-order meter observations", () => {
    const ledger = new Ledger();
    ledger.submitAndRun();
    ledger.append("2026-07-13T10:00:10.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-newer",
      observedAt: "2026-07-13T10:00:09.000Z",
      providerAccruedMicroUsd: "400",
      elapsedRateProjectionMicroUsd: "425",
      unbilledFixedMicroUsd: "100",
      unbilledStorageMicroUsd: "50",
      unbilledEgressMicroUsd: "25",
    });
    ledger.append("2026-07-13T10:00:11.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-older",
      observedAt: "2026-07-13T10:00:08.000Z",
      providerAccruedMicroUsd: "300",
      elapsedRateProjectionMicroUsd: "400",
      unbilledFixedMicroUsd: "100",
      unbilledStorageMicroUsd: "0",
      unbilledEgressMicroUsd: "0",
    });
    ledger.append("2026-07-13T10:00:12.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-newer",
      observedAt: "2026-07-13T10:00:09.000Z",
      providerAccruedMicroUsd: "400",
      elapsedRateProjectionMicroUsd: "425",
      unbilledFixedMicroUsd: "100",
      unbilledStorageMicroUsd: "50",
      unbilledEgressMicroUsd: "25",
    });
    let state = ledger.replay().state!;
    expect(state.costObservations).toHaveLength(2);
    expect(state.conservativeExposureMicroUsd).toBe("700");
    expect(state.lastMeterObservedAt).toBe("2026-07-13T10:00:09.000Z");
    expect(state.costWarningTriggeredAt).toBe("2026-07-13T10:00:10.000Z");

    ledger.append("2026-07-13T10:00:13.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-newer",
      observedAt: "2026-07-13T10:00:09.000Z",
      providerAccruedMicroUsd: "401",
      elapsedRateProjectionMicroUsd: "425",
      unbilledFixedMicroUsd: "100",
      unbilledStorageMicroUsd: "50",
      unbilledEgressMicroUsd: "25",
    });
    expect(() => ledger.replay()).toThrow("reused with different content");
    ledger.events.pop();

    ledger.append("2026-07-13T10:00:13.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-hard-stop",
      observedAt: "2026-07-13T10:00:12.500Z",
      providerAccruedMicroUsd: "700",
      elapsedRateProjectionMicroUsd: "800",
      unbilledFixedMicroUsd: "1200",
      unbilledStorageMicroUsd: "0",
      unbilledEgressMicroUsd: "0",
    });
    state = ledger.replay().state!;
    expect(state.state).toBe("stop_pending");
    expect(state.stopIntent).toMatchObject({
      firstReason: "budget_hard_stop",
      reasons: ["budget_hard_stop"],
    });
    expect(state.conservativeExposureMicroUsd).toBe("2100");
    expect(state.absoluteCostCapBreachedAt).toBe("2026-07-13T10:00:13.000Z");
  });

  it("rejects non-canonical micro-USD instead of allowing lossy JS-number coercion", () => {
    const ledger = new Ledger();
    ledger.submitAndRun();
    expect(() => ledger.append("2026-07-13T10:00:07.000Z", {
      type: "cost_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      observationId: "meter-noncanonical",
      observedAt: "2026-07-13T10:00:06.500Z",
      providerAccruedMicroUsd: "01",
      elapsedRateProjectionMicroUsd: "1",
      unbilledFixedMicroUsd: "0",
      unbilledStorageMicroUsd: "0",
      unbilledEgressMicroUsd: "0",
    })).toThrow("canonical unsigned micro-USD BIGINT string");
  });

  it("fails closed when the provider meter becomes stale", () => {
    const ledger = new Ledger(subject({
      costHardStopMicroUsd: "50000",
      absoluteCostCapMicroUsd: "60000",
      costObservationMaximumAgeSeconds: 60,
    }));
    ledger.submitAndRun();
    ledger.append("2026-07-13T10:01:06.000Z", {
      type: "control_tick",
      ownerId: "worker-a",
      fenceToken: "1",
      checkedAt: "2026-07-13T10:01:06.000Z",
    });
    const state = ledger.replay().state!;
    expect(state.state).toBe("stop_pending");
    expect(state.stopIntent?.reasons).toContain("meter_stale");
  });

  it("fails closed on meter staleness while a claimed submit remains provider-unknown", () => {
    const ledger = new Ledger();
    ledger.authorizeAndLease();
    ledger.append("2026-07-13T10:00:03.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-unknown",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    ledger.append("2026-07-13T10:00:04.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-unknown",
    });
    ledger.append("2026-07-13T10:00:05.000Z", {
      type: "control_tick",
      ownerId: "worker-a",
      fenceToken: "1",
      checkedAt: "2026-07-13T10:00:05.000Z",
    });
    expect(ledger.replay().state).toMatchObject({
      state: "stop_pending",
      stopIntent: { firstReason: "meter_stale" },
    });
  });

  it("makes kill intent irreversible, prevents a pending submit claim, and rejects terminal transitions", () => {
    const ledger = new Ledger();
    ledger.authorizeAndLease();
    ledger.append("2026-07-13T10:00:03.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
      commandKind: "provider_submit",
      reconcilesCommandId: null,
    });
    ledger.append("2026-07-13T10:00:04.000Z", {
      type: "kill_switch_engaged",
      requestedBy: "operator-1",
      reasonCode: "emergency_stop",
      scope: "attempt",
      scopeKey: "attempt-other",
      generation: 7,
    });
    expect(() => ledger.replay()).toThrow("scope does not apply");
    ledger.events.pop();
    ledger.append("2026-07-13T10:00:04.000Z", {
      type: "kill_switch_engaged",
      requestedBy: "operator-1",
      reasonCode: "emergency_stop",
      scope: "attempt",
      scopeKey: "attempt-1",
      generation: 7,
    });
    const killed = ledger.replay().state!;
    expect(killed.state).toBe("terminal_killed");
    expect(killed.stopIntent).toMatchObject({ firstReason: "kill_switch", reasons: ["kill_switch"] });
    expect(deriveFoundryExecutionControlView(killed)).toMatchObject({
      permittedCommandKinds: [],
      submitBlocked: true,
      stopRequired: false,
      terminal: true,
    });

    ledger.append("2026-07-13T10:00:05.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "submit-1",
    });
    expect(() => ledger.replay()).toThrow("Terminal execution attempts accept no further events");
  });

  it("induces a stop for a running kill and permits only a semantic stop command", () => {
    const ledger = new Ledger();
    ledger.submitAndRun();
    ledger.append("2026-07-13T10:00:07.000Z", {
      type: "stop_requested",
      reason: "operator_requested",
      requestedBy: "operator-1",
    });
    ledger.append("2026-07-13T10:00:08.000Z", {
      type: "kill_switch_engaged",
      requestedBy: "operator-1",
      reasonCode: "escalated_stop",
      scope: "project",
      scopeKey: "project-1",
      generation: 8,
    });
    const state = ledger.replay().state!;
    expect(state.state).toBe("stop_pending");
    expect(state.stopIntent).toMatchObject({
      firstReason: "operator_requested",
      reasons: ["operator_requested", "kill_switch"],
    });
    expect(deriveFoundryExecutionControlView(state).permittedCommandKinds).toContain("provider_stop");
    expect(deriveFoundryExecutionControlView(state).permittedCommandKinds).not.toContain("provider_submit");
  });

  it("rejects incompatible checkpoint lineage before it can become resumable evidence", () => {
    const ledger = new Ledger();
    ledger.submitAndRun();
    ledger.append("2026-07-13T10:00:07.000Z", {
      type: "outbox_command_enqueued",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
      commandKind: "provider_checkpoint",
      reconcilesCommandId: null,
    });
    ledger.append("2026-07-13T10:00:08.000Z", {
      type: "outbox_command_claimed",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
    });
    ledger.append("2026-07-13T10:00:09.000Z", {
      type: "outbox_command_succeeded",
      ownerId: "worker-a",
      fenceToken: "1",
      commandId: "checkpoint-command-1",
      resultCode: "checkpoint_written",
    });
    const checkpointing = ledger.replay().state!;
    const checkpoint = {
      ...ledger.source.checkpointContract!,
      recipeSha256: digest("8"),
      subjectSha256: checkpointing.subjectSha256,
      attemptId: checkpointing.attemptId,
      checkpointSha256: digest("7"),
      sizeBytes: 123,
      createdAt: "2026-07-13T10:00:09.500Z",
      ordinal: 1,
      complete: true as const,
      verificationResult: "verified_compatible" as const,
      verifiedAt: "2026-07-13T10:00:09.900Z",
      progressCursor: "step-500",
      producerProviderState: "inactive" as const,
      producerStateVerifiedAt: "2026-07-13T10:00:09.800Z",
    };
    expect(validateFoundryCheckpointCompatibility(checkpointing, checkpoint)).toEqual({
      compatible: false,
      mismatches: ["recipeSha256"],
    });
    expect(validateFoundryCheckpointCompatibility(checkpointing, {
      ...checkpoint,
      recipeSha256: ledger.source.checkpointContract!.recipeSha256,
      producerProviderState: "active" as "inactive",
    })).toEqual({
      compatible: false,
      mismatches: ["producerProviderState"],
    });
    ledger.append("2026-07-13T10:00:10.000Z", {
      type: "checkpoint_observed",
      ownerId: "worker-a",
      fenceToken: "1",
      checkpoint,
    });
    expect(() => ledger.replay()).toThrow("Checkpoint is incompatible: recipeSha256");
  });

  it("rejects a V0 subject that authorizes retry attempts", () => {
    const invalid = { ...subject(), maximumAttempts: 2 };
    expect(() => replayFoundryExecutionLedger(invalid as FoundryExecutionSubjectV0, [])).toThrow(
      "maximumAttempts to equal one",
    );
  });

  it("requires sorted trusted worker bindings and provider-appropriate compute approval", () => {
    expect(() => replayFoundryExecutionLedger({
      ...subject(),
      workerProfileSha256s: [digest("2"), digest("1")],
    }, [])).toThrow("Worker-profile digests must be unique and sorted");
    expect(() => replayFoundryExecutionLedger({
      ...subject(),
      computeApprovalSha256: null,
    }, [])).toThrow("Remote execution subjects require a compute approval digest");
    expect(() => replayFoundryExecutionLedger({
      ...subject(),
      providerKind: "local_cuda",
      computeApprovalSha256: digest("f"),
    }, [])).toThrow("Local execution subjects cannot bind a remote compute approval");
    expect(() => replayFoundryExecutionLedger({
      ...subject(),
      providerKind: "local_cuda",
      computeApprovalSha256: null,
    }, [])).not.toThrow();
  });
});

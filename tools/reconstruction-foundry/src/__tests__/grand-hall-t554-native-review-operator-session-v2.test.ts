/* eslint-disable @typescript-eslint/require-await -- synchronous harnesses implement async delegate contracts */
import {
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  GrandHallT554NativeReviewMaskWorkflowSessionV2Error,
  type GrandHallT554NativeReviewMaskTileV2,
  type GrandHallT554NativeReviewMaskWorkflowSessionV2,
  type GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
} from "../grand-hall-t554-native-review-mask-workflow-session-v2.js";
import {
  __testOnlyGrandHallT554NativeReviewOperatorSessionV2,
  type __GrandHallT554NativeReviewOperatorDelegateFactoriesV2,
} from "../grand-hall-t554-native-review-operator-session-v2.js";
import {
  GrandHallT554NativeReviewSourceSessionV2Error,
  type GrandHallT554NativeReviewSourceSessionV2,
  type GrandHallT554NativeReviewSourceSessionSnapshotV2,
  type GrandHallT554NativeReviewSourceTileV2,
} from "../grand-hall-t554-native-review-source-session-v2.js";
import type {
  GrandHallT554NativeReviewAuthorityNoneRecordV2,
  GrandHallT554NativeReviewDurableSourceHistoryEntryV2,
} from "../grand-hall-t554-native-review-durable-source-history-v2.js";

type Sha256 = `sha256:${string}`;
type SourceActive = NonNullable<
  GrandHallT554NativeReviewSourceSessionSnapshotV2["activeSource"]
>;
type MaskActive = NonNullable<
  GrandHallT554NativeReviewMaskWorkflowSnapshotV2["activeSource"]
>;

const SESSION_SHA = digest("1");
const BROWSER_SOURCE_SHA = digest("2");
const BROWSER_MASK_SHA = digest("3");
const SOURCE_SUBJECT_SHA = digest("4");
const ROOT_INVENTORY_SHA = digest("5");
const VERIFICATION_SHA = digest("6");
const MASK_STATE_SHA = digest("7");
const MASK_SUBJECT_SHA = digest("8");
const FROZEN_SHA = digest("9");
const SOURCE_NONCE = "A".repeat(43);
const FULL_BITMAP = "ff".repeat(64);
const PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;
const ExcludeDecisionFixtureSchema = z
  .object({
    result: z.literal("EXCLUDE"),
    classification: z.literal("no_observed_grand_hall_pixels"),
  })
  .strict()
  .pipe(z.custom<NonNullable<SourceActive["decision"]>>());
const IncludeDecisionFixtureSchema = z
  .object({
    result: z.literal("INCLUDE"),
    classification: z.literal("grand_hall_core"),
  })
  .strict()
  .pipe(z.custom<NonNullable<MaskActive["decision"]>>());
const HumanAttestationFixtureSchema = z
  .object({
    reviewerId: z.literal("sensitive-reviewer-id"),
    attestationSha256: z.string(),
  })
  .strict()
  .pipe(z.custom<NonNullable<SourceActive["humanAttestation"]>>());

function digest(character: string): Sha256 {
  return `sha256:${character.repeat(64)}`;
}

function durableSourceHistory(input?: {
  readonly inventoryIndex?: number;
  readonly decision?: "EXCLUDE" | "INCLUDE";
  readonly attested?: boolean;
}): readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[] {
  return Array.from({ length: 148 }, (_, inventoryIndex) => {
    let authorityNoneRecord: GrandHallT554NativeReviewAuthorityNoneRecordV2 = {
      state: "no_recorded_decision",
    };
    if (inventoryIndex === (input?.inventoryIndex ?? 11) && input?.decision) {
      const decision =
        input.decision === "EXCLUDE"
          ? ({
              result: "EXCLUDE",
              classification: "no_observed_grand_hall_pixels",
            } as const)
          : ({
              result: "INCLUDE",
              classification: "grand_hall_core",
            } as const);
      authorityNoneRecord = input.attested === true
        ? {
            state: "authority_none_attestation_recorded",
            decision,
            attestation: "not_cryptographic",
          }
        : {
            state: "decision_recorded",
            decision,
            attestation: "not_recorded",
          };
    }
    return {
      inventoryIndex,
      sweepNumber: inventoryIndex + 1,
      authorityNoneRecord,
    };
  });
}

function withHistoryRecord(
  history: readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[],
  inventoryIndex: number,
  authorityNoneRecord: GrandHallT554NativeReviewAuthorityNoneRecordV2,
): readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[] {
  return history.map((entry) =>
    entry.inventoryIndex === inventoryIndex
      ? { ...entry, authorityNoneRecord }
      : entry,
  );
}

function sourceSnapshot(input?: {
  readonly browserEpochNumber?: number;
  readonly workspaceRevision?: number;
  readonly renderGeneration?: number;
  readonly complete?: boolean;
  readonly active?: boolean;
  readonly phase?: SourceActive["phase"];
  readonly durableSourceHistory?: readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[];
}): GrandHallT554NativeReviewSourceSessionSnapshotV2 {
  const renderGeneration = input?.renderGeneration ?? 4;
  const complete = input?.complete ?? true;
  const phase = input?.phase ?? "source_review";
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-review-source-session.v2",
    lifecycle: "active",
    sessionIdSha256: SESSION_SHA,
    workspaceRevision: input?.workspaceRevision ?? 7,
    maximumAllocatedRenderGeneration: renderGeneration,
    browserEpochNumber: input?.browserEpochNumber ?? 2,
    browserEpochNonceSha256: BROWSER_SOURCE_SHA,
    durableSourceHistory:
      input?.durableSourceHistory ??
      durableSourceHistory({
        decision:
          phase === "source_decided" || phase === "human_attested"
            ? "EXCLUDE"
            : undefined,
        attested: phase === "human_attested",
      }),
    activeSource:
      input?.active === false
        ? null
        : {
            inventoryIndex: 11,
            sweepNumber: 12,
            sourceEpochNonce: SOURCE_NONCE,
            renderGeneration,
            phase,
            sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
            tileGrid: {
              widthPx: 256,
              heightPx: 256,
              columnCount: 32,
              rowCount: 16,
            },
            sourceCoverage: {
              eventCount: complete ? 32 : 1,
              deliveredTileCount: complete ? 512 : 1,
              completedTileCount: complete ? 512 : 0,
              completedTileBitsetHex: complete ? FULL_BITMAP : "00".repeat(64),
              complete,
            },
            decision:
              input?.phase === "source_decided" ||
              input?.phase === "human_attested"
                ? excludeDecision()
                : null,
            humanAttestation:
              input?.phase === "human_attested" ? humanAttestation() : null,
          },
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    exportAuthorized: false,
    generatedContentAuthorized: false,
    rootInventorySha256: ROOT_INVENTORY_SHA,
    verificationAttestationSha256: VERIFICATION_SHA,
  };
}

function completedSourceCoverage() {
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2" as const,
    sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
    sourceJournal: {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
      leafName: "source-sensitive-child.jsonl",
      scopeSha256: digest("a"),
      scopeFileSha256: digest("b"),
      revision: 9,
      headEventSha256: digest("c"),
      journalInventorySha256: digest("d"),
      kind: "source" as const,
    },
    completedTileBitsetHex: FULL_BITMAP,
    completedTileCount: 512 as const,
    cumulativeDwellStateSha256: digest("e"),
  };
}

function maskState() {
  return {
    revision: 3,
    maskStateSha256: MASK_STATE_SHA,
    includedPixelCount: 1,
    excludedPixelCount: PIXEL_COUNT - 1,
    reasonCounts: [
      {
        reasonCode: "unverified_or_unknown_pixels" as const,
        pixelCount: PIXEL_COUNT - 1,
      },
    ],
  };
}

function excludeDecision(): NonNullable<SourceActive["decision"]> {
  return ExcludeDecisionFixtureSchema.parse({
    result: "EXCLUDE",
    classification: "no_observed_grand_hall_pixels",
  });
}

function includeDecision(): NonNullable<MaskActive["decision"]> {
  return IncludeDecisionFixtureSchema.parse({
    result: "INCLUDE",
    classification: "grand_hall_core",
  });
}

function humanAttestation(): NonNullable<SourceActive["humanAttestation"]> {
  return HumanAttestationFixtureSchema.parse({
    reviewerId: "sensitive-reviewer-id",
    attestationSha256: digest("0"),
  });
}

function maskSnapshot(input?: {
  readonly browserEpochNumber?: number;
  readonly workspaceRevision?: number;
  readonly renderGeneration?: number;
  readonly phase?: MaskActive["phase"];
  readonly active?: boolean;
  readonly durableSourceHistory?: readonly GrandHallT554NativeReviewDurableSourceHistoryEntryV2[];
}): GrandHallT554NativeReviewMaskWorkflowSnapshotV2 {
  const phase = input?.phase ?? "source_review";
  const hasMask = phase !== "source_review";
  const renderGeneration = input?.renderGeneration ?? 4;
  return {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-mask-workflow-session.v2",
    lifecycle: "active",
    sessionIdSha256: SESSION_SHA,
    workspaceRevision: input?.workspaceRevision ?? 7,
    maximumAllocatedRenderGeneration: renderGeneration,
    browserEpochNumber: input?.browserEpochNumber ?? 3,
    browserEpochNonceSha256: BROWSER_MASK_SHA,
    durableSourceHistory:
      input?.durableSourceHistory ??
      durableSourceHistory({
        decision:
          phase === "decision_recorded" || phase === "human_attested"
            ? "INCLUDE"
            : undefined,
        attested: phase === "human_attested",
      }),
    activeSource:
      input?.active === false
        ? null
        : {
            inventoryIndex: 11,
            sweepNumber: 12,
            renderGeneration,
            phase,
            sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
            completedSourceCoverage: hasMask ? completedSourceCoverage() : null,
            maskState: hasMask ? maskState() : null,
            maskReviewSubjectSha256:
              phase === "mask_review" ||
              phase === "decision_recorded" ||
              phase === "human_attested"
                ? MASK_SUBJECT_SHA
                : null,
            frozenBindingSha256:
              phase === "mask_review" ||
              phase === "decision_recorded" ||
              phase === "human_attested"
                ? FROZEN_SHA
                : null,
            frozenBinding: null,
            maskJournalLeafName:
              phase === "mask_review" ||
              phase === "decision_recorded" ||
              phase === "human_attested"
                ? "mask-sensitive-child.jsonl"
                : null,
            decision:
              phase === "decision_recorded" || phase === "human_attested"
                ? includeDecision()
                : null,
            humanAttestation:
              phase === "human_attested" ? humanAttestation() : null,
          },
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    acceptanceAuthorized: false,
    reconstructionAuthorized: false,
    runtimeAuthorized: false,
    exportAuthorized: false,
    generatedContentAuthorized: false,
    rootInventorySha256: ROOT_INVENTORY_SHA,
    verificationAttestationSha256: VERIFICATION_SHA,
  };
}

class SourceSessionHarness implements GrandHallT554NativeReviewSourceSessionV2 {
  snapshotValue: GrandHallT554NativeReviewSourceSessionSnapshotV2;
  readonly events: string[];
  readonly excludeInputs: Parameters<
    GrandHallT554NativeReviewSourceSessionV2["recordExcludeDecision"]
  >[0][] = [];
  readonly attestationInputs: Parameters<
    GrandHallT554NativeReviewSourceSessionV2["recordHumanAttestation"]
  >[0][] = [];
  readonly abandonInputs: Parameters<
    GrandHallT554NativeReviewSourceSessionV2["abandonActiveSource"]
  >[0][] = [];
  readonly selectInputs: Parameters<
    GrandHallT554NativeReviewSourceSessionV2["selectSource"]
  >[0][] = [];
  readonly tileBuffers: Buffer[] = [];
  rawCommitCount = 0;
  rawDiscardCount = 0;
  commitError: Error | null = null;
  excludeError: Error | null = null;
  snapshotError: Error | null = null;
  corruptHistoryAfterExclude = false;
  closeAttempts = 0;
  closeFailuresRemaining = 0;

  constructor(snapshotValue = sourceSnapshot(), events: string[] = []) {
    this.snapshotValue = snapshotValue;
    this.events = events;
  }

  async snapshot(): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    if (this.snapshotError !== null) throw this.snapshotError;
    return this.snapshotValue;
  }

  async selectSource(
    input: Parameters<
      GrandHallT554NativeReviewSourceSessionV2["selectSource"]
    >[0],
  ): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    this.selectInputs.push(input);
    return this.snapshotValue;
  }

  async prepareSourceTile(
    _input: Parameters<
      GrandHallT554NativeReviewSourceSessionV2["prepareSourceTile"]
    >[0],
  ): Promise<GrandHallT554NativeReviewSourceTileV2> {
    const bytes = Buffer.from([9, 8, 7, 6]);
    this.tileBuffers.push(bytes);
    return {
      schemaVersion: "venviewer.grand-hall-t554-native-review-source-tile.v2",
      renderMode: "source_rgb8",
      widthPx: 256,
      heightPx: 256,
      sourceRgb8: bytes,
      commitDeliveryAfterSuccessfulSend: async () => {
        this.rawCommitCount += 1;
        if (this.commitError !== null) throw this.commitError;
      },
      discardAfterFailedSend: async () => {
        this.rawDiscardCount += 1;
      },
    };
  }

  async recordSourceCoverage(): Promise<
    Awaited<
      ReturnType<
        GrandHallT554NativeReviewSourceSessionV2["recordSourceCoverage"]
      >
    >
  > {
    return {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-source-coverage-ack.v2",
      sequence: 1,
      journalRevision: 1,
      completedTileCount: 512,
      complete: true,
    };
  }

  async recordExcludeDecision(
    input: Parameters<
      GrandHallT554NativeReviewSourceSessionV2["recordExcludeDecision"]
    >[0],
  ): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    this.excludeInputs.push(input);
    if (this.excludeError !== null) throw this.excludeError;
    const active = requireSourceActive(this.snapshotValue);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      maximumAllocatedRenderGeneration: active.renderGeneration + 1,
      durableSourceHistory: withHistoryRecord(
        this.snapshotValue.durableSourceHistory,
        active.inventoryIndex,
        {
          state: "decision_recorded",
          decision: excludeDecision(),
          attestation: "not_recorded",
        },
      ),
      activeSource: {
        ...active,
        phase: "source_decided",
        renderGeneration: active.renderGeneration + 1,
        decision: excludeDecision(),
      },
    };
    if (this.corruptHistoryAfterExclude) {
      this.snapshotValue = {
        ...this.snapshotValue,
        durableSourceHistory: this.snapshotValue.durableSourceHistory.map(
          (entry) =>
            entry.inventoryIndex === active.inventoryIndex
              ? { ...entry, sweepNumber: entry.sweepNumber + 1 }
              : entry,
        ),
      };
    }
    return this.snapshotValue;
  }

  async recordHumanAttestation(
    input: Parameters<
      GrandHallT554NativeReviewSourceSessionV2["recordHumanAttestation"]
    >[0],
  ): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    this.attestationInputs.push(input);
    const active = requireSourceActive(this.snapshotValue);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      durableSourceHistory: withHistoryRecord(
        this.snapshotValue.durableSourceHistory,
        active.inventoryIndex,
        {
          state: "authority_none_attestation_recorded",
          decision: excludeDecision(),
          attestation: "not_cryptographic",
        },
      ),
      activeSource: {
        ...active,
        phase: "human_attested",
        humanAttestation: humanAttestation(),
      },
    };
    return this.snapshotValue;
  }

  async abandonActiveSource(
    input: Parameters<
      GrandHallT554NativeReviewSourceSessionV2["abandonActiveSource"]
    >[0],
  ): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    this.abandonInputs.push(input);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      activeSource: null,
    };
    return this.snapshotValue;
  }

  async stop(
    _input: Parameters<GrandHallT554NativeReviewSourceSessionV2["stop"]>[0],
  ): Promise<GrandHallT554NativeReviewSourceSessionSnapshotV2> {
    this.snapshotValue = {
      ...this.snapshotValue,
      lifecycle: "stopped",
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
    };
    return this.snapshotValue;
  }

  async close(): Promise<void> {
    this.closeAttempts += 1;
    this.events.push("source.close");
    if (this.closeFailuresRemaining > 0) {
      this.closeFailuresRemaining -= 1;
      throw new Error("source close failed before owner release");
    }
  }
}

class MaskSessionHarness implements GrandHallT554NativeReviewMaskWorkflowSessionV2 {
  snapshotValue: GrandHallT554NativeReviewMaskWorkflowSnapshotV2;
  readonly events: string[];
  readonly beginInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["beginMaskWorkflow"]
  >[0][] = [];
  readonly applyInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["applyMaskEdit"]
  >[0][] = [];
  readonly includeInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["recordIncludeDecision"]
  >[0][] = [];
  readonly attestationInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["recordHumanAttestation"]
  >[0][] = [];
  readonly abandonInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["abandonActiveSource"]
  >[0][] = [];
  readonly stopInputs: Parameters<
    GrandHallT554NativeReviewMaskWorkflowSessionV2["stop"]
  >[0][] = [];
  readonly tileBuffers: Buffer[][] = [];
  rawCommitCount = 0;
  rawDiscardCount = 0;
  stopCount = 0;
  includeError: Error | null = null;
  freezeError: Error | null = null;
  snapshotError: Error | null = null;
  closeAttempts = 0;
  closeFailuresRemaining = 0;

  constructor(snapshotValue = maskSnapshot(), events: string[] = []) {
    this.snapshotValue = snapshotValue;
    this.events = events;
  }

  async snapshot(): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    if (this.snapshotError !== null) throw this.snapshotError;
    return this.snapshotValue;
  }

  async beginMaskWorkflow(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["beginMaskWorkflow"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.beginInputs.push(input);
    this.events.push("mask.begin");
    const active = requireMaskActive(this.snapshotValue);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      maximumAllocatedRenderGeneration: active.renderGeneration + 1,
      activeSource: {
        ...active,
        phase: "mask_edit",
        renderGeneration: active.renderGeneration + 1,
        completedSourceCoverage: completedSourceCoverage(),
        maskState: maskState(),
      },
    };
    return this.snapshotValue;
  }

  async applyMaskEdit(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["applyMaskEdit"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.applyInputs.push(input);
    return this.snapshotValue;
  }

  async freezeMask(
    _input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["freezeMask"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    if (this.freezeError !== null) throw this.freezeError;
    return this.snapshotValue;
  }

  async prepareMaskTile(
    _input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["prepareMaskTile"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskTileV2> {
    const buffers = [
      Buffer.from([1, 2]),
      Buffer.from([3, 4]),
      Buffer.from([5, 6]),
    ];
    this.tileBuffers.push(buffers);
    return {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-workflow-tile.v2",
      renderMode: "source_rgb8_mask8_reason8",
      widthPx: 256,
      heightPx: 256,
      sourceRgb8: buffers[0] ?? Buffer.alloc(0),
      mask8: buffers[1] ?? Buffer.alloc(0),
      reason8: buffers[2] ?? Buffer.alloc(0),
      commitDeliveryAfterSuccessfulSend: async () => {
        this.rawCommitCount += 1;
      },
      discardAfterFailedSend: async () => {
        this.rawDiscardCount += 1;
      },
    };
  }

  async recordMaskCoverage(): Promise<
    Awaited<
      ReturnType<
        GrandHallT554NativeReviewMaskWorkflowSessionV2["recordMaskCoverage"]
      >
    >
  > {
    return {
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-mask-coverage-acknowledgement.v2",
      sequence: 1,
      journalRevision: 1,
      deliveredTileCount: 512,
      completedTileCount: 512,
      complete: true,
    };
  }

  async recordIncludeDecision(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["recordIncludeDecision"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.includeInputs.push(input);
    if (this.includeError !== null) throw this.includeError;
    const active = requireMaskActive(this.snapshotValue);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      maximumAllocatedRenderGeneration: active.renderGeneration + 1,
      durableSourceHistory: withHistoryRecord(
        this.snapshotValue.durableSourceHistory,
        active.inventoryIndex,
        {
          state: "decision_recorded",
          decision: includeDecision(),
          attestation: "not_recorded",
        },
      ),
      activeSource: {
        ...active,
        phase: "decision_recorded",
        renderGeneration: active.renderGeneration + 1,
        decision: includeDecision(),
      },
    };
    return this.snapshotValue;
  }

  async recordHumanAttestation(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["recordHumanAttestation"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.attestationInputs.push(input);
    const active = requireMaskActive(this.snapshotValue);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      durableSourceHistory: withHistoryRecord(
        this.snapshotValue.durableSourceHistory,
        active.inventoryIndex,
        {
          state: "authority_none_attestation_recorded",
          decision: includeDecision(),
          attestation: "not_cryptographic",
        },
      ),
      activeSource: {
        ...active,
        phase: "human_attested",
        humanAttestation: humanAttestation(),
      },
    };
    return this.snapshotValue;
  }

  async abandonActiveSource(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["abandonActiveSource"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.abandonInputs.push(input);
    this.snapshotValue = {
      ...this.snapshotValue,
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
      activeSource: null,
    };
    return this.snapshotValue;
  }

  async stop(
    input: Parameters<
      GrandHallT554NativeReviewMaskWorkflowSessionV2["stop"]
    >[0],
  ): Promise<GrandHallT554NativeReviewMaskWorkflowSnapshotV2> {
    this.stopInputs.push(input);
    this.stopCount += 1;
    this.snapshotValue = {
      ...this.snapshotValue,
      lifecycle: "stopped",
      workspaceRevision: this.snapshotValue.workspaceRevision + 1,
    };
    return this.snapshotValue;
  }

  async close(): Promise<void> {
    this.closeAttempts += 1;
    this.events.push("mask.close");
    if (this.closeFailuresRemaining > 0) {
      this.closeFailuresRemaining -= 1;
      throw new Error("mask close failed before owner release");
    }
  }
}

function requireSourceActive(
  snapshot: GrandHallT554NativeReviewSourceSessionSnapshotV2,
): SourceActive {
  if (snapshot.activeSource === null)
    throw new Error("source fixture is inactive");
  return snapshot.activeSource;
}

function requireMaskActive(
  snapshot: GrandHallT554NativeReviewMaskWorkflowSnapshotV2,
): MaskActive {
  if (snapshot.activeSource === null)
    throw new Error("mask fixture is inactive");
  return snapshot.activeSource;
}

function sourceCatalog(): __GrandHallT554NativeReviewOperatorDelegateFactoriesV2["sourceCatalog"] {
  return Array.from({ length: 148 }, (_, inventoryIndex) => ({
    inventoryIndex,
    sweepNumber: inventoryIndex + 1,
    agentObservation:
      inventoryIndex % 2 === 0
        ? {
            state: "grand_hall_pixels_observed_human_pending" as const,
            proposedDisposition: "include_with_binary_pixel_mask" as const,
            maskAuthoringState: "required_not_authored" as const,
          }
        : {
            state: "no_grand_hall_pixels_observed_human_pending" as const,
            proposedDisposition: "exclude_whole_frame" as const,
            maskAuthoringState:
              "not_required_if_human_confirms_exclusion" as const,
          },
  }));
}

function delegateFactories(input: {
  readonly source: SourceSessionHarness;
  readonly mask: MaskSessionHarness;
  readonly events?: string[];
}): __GrandHallT554NativeReviewOperatorDelegateFactoriesV2 {
  const events = input.events ?? [];
  return {
    sourceCatalog: sourceCatalog(),
    createSource: async () => {
      events.push("source.create");
      return input.source;
    },
    openSource: async () => {
      events.push("source.open");
      return input.source;
    },
    openMask: async () => {
      events.push("mask.open");
      return input.mask;
    },
    takeOverMask: async () => {
      events.push("mask.takeOver");
      return input.mask;
    },
  };
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function collectKeysAndStrings(
  value: unknown,
  keys: string[] = [],
  strings: string[] = [],
): { readonly keys: readonly string[]; readonly strings: readonly string[] } {
  if (typeof value === "string") {
    strings.push(value);
    return { keys, strings };
  }
  if (typeof value !== "object" || value === null) return { keys, strings };
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeysAndStrings(child, keys, strings);
  }
  return { keys, strings };
}

function expectNoSensitiveProjection(value: unknown): void {
  const collected = collectKeysAndStrings(value);
  expect(
    collected.keys.some((key) =>
      /(sha256|nonce|subject|bitmap|dwell|journal|leaf|path|proof|reviewer|note|timestamp)/iu.test(
        key,
      ),
    ),
  ).toBe(false);
  expect(
    collected.strings.some(
      (entry) =>
        entry.startsWith("sha256:") ||
        entry.includes(".jsonl") ||
        entry.includes("sensitive-reviewer-id"),
    ),
  ).toBe(false);
}

describe("Grand Hall T-554 native-review operator session v2", () => {
  it("projects recursively frozen authority-none state without internal digests, paths, or proof material", async () => {
    const source = new SourceSessionHarness();
    const mask = new MaskSessionHarness(
      maskSnapshot({ phase: "mask_review", browserEpochNumber: 6 }),
    );
    const factories = delegateFactories({ source, mask });
    const sourceOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        factories,
      );
    const sourceView = await sourceOperator.snapshot();
    expect(sourceView).toMatchObject({
      browserEpochNumber: 2,
      authority: "none",
      reviewState: "human_pending",
      finalDecision: "PENDING",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      activeSource: {
        inventoryIndex: 11,
        sourceCoverage: { completedTileCount: 512, complete: true },
      },
    });
    expect(sourceView.sources).toHaveLength(148);
    expect(sourceView.sources[0]).toEqual({
      inventoryIndex: 0,
      sweepNumber: 1,
      agentObservation: {
        state: "grand_hall_pixels_observed_human_pending",
        proposedDisposition: "include_with_binary_pixel_mask",
        maskAuthoringState: "required_not_authored",
      },
      authorityNoneRecord: { state: "no_recorded_decision" },
    });
    expect(sourceView.sources[147]).toEqual({
      inventoryIndex: 147,
      sweepNumber: 148,
      agentObservation: {
        state: "no_grand_hall_pixels_observed_human_pending",
        proposedDisposition: "exclude_whole_frame",
        maskAuthoringState: "not_required_if_human_confirms_exclusion",
      },
      authorityNoneRecord: { state: "no_recorded_decision" },
    });
    expectDeepFrozen(sourceView);
    const sourceCoverageAck = await sourceOperator.recordSourceCoverage({
      expectedBrowserEpochNumber: 2,
      renderGeneration: 4,
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: 1_024,
      viewportCssHeight: 512,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTiles: [],
    });
    expect(sourceCoverageAck).toEqual({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-operator-source-coverage-ack.v2",
      sequence: 1,
      completedTileCount: 512,
      complete: true,
    });
    expectDeepFrozen(sourceCoverageAck);
    expectNoSensitiveProjection(sourceCoverageAck);

    const maskFactories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2 =
      {
        ...factories,
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      };
    const maskOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open(
        maskFactories,
      );
    const maskView = await maskOperator.snapshot();
    expect(maskView.sources).toEqual(sourceView.sources);
    expect(maskView.activeSource).toMatchObject({
      phase: "mask_review",
      sourceCoverage: { completedTileCount: 512, complete: true },
      mask: { revision: 3, frozen: true },
    });
    expectDeepFrozen(maskView);
    const maskCoverageAck = await maskOperator.recordMaskCoverage({
      expectedBrowserEpochNumber: 6,
      renderGeneration: 4,
      documentVisibilityState: "visible",
      documentFocusState: "focused",
      viewportCssWidth: 1_024,
      viewportCssHeight: 512,
      devicePixelRatio: 1,
      sourceToCssTransform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      paintedTiles: [],
    });
    expect(maskCoverageAck).toEqual({
      schemaVersion:
        "venviewer.grand-hall-t554-native-review-operator-mask-coverage-ack.v2",
      sequence: 1,
      deliveredTileCount: 512,
      completedTileCount: 512,
      complete: true,
    });
    expectDeepFrozen(maskCoverageAck);
    expectNoSensitiveProjection(maskCoverageAck);
    expect(Object.keys(sourceCoverageAck)).not.toContain("journalRevision");
    expect(Object.keys(maskCoverageAck)).not.toContain("journalRevision");

    for (const view of [sourceView, maskView]) {
      expectNoSensitiveProjection(view);
    }

    const leakedInput = {
      expectedBrowserEpochNumber: 2,
      expectedWorkspaceRevision: 7,
      renderGeneration: 4,
      note: "strict public request",
      sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
      sourcePath: "C:\\sensitive\\source.jpg",
    };
    await expect(
      sourceOperator.recordExcludeDecision(leakedInput),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    expect(source.excludeInputs).toHaveLength(0);

    await expect(
      sourceOperator.recordExcludeDecision({
        expectedBrowserEpochNumber: 1,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
        note: "stale browser must fail",
      }),
    ).rejects.toMatchObject({ code: "BROWSER_EPOCH_CONFLICT" });
    expect(source.excludeInputs).toHaveLength(0);

    const invalidCatalog = sourceCatalog().map((entry) => ({ ...entry }));
    const terminalEntry = invalidCatalog[147];
    if (terminalEntry === undefined)
      throw new Error("catalog fixture is short");
    invalidCatalog[147] = { ...terminalEntry, inventoryIndex: 148 };
    let invalidCatalogCreateCalls = 0;
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create({
        ...factories,
        sourceCatalog: invalidCatalog,
        createSource: async () => {
          invalidCatalogCreateCalls += 1;
          return source;
        },
      }),
    ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    expect(invalidCatalogCreateCalls).toBe(0);
    await sourceOperator.close();
    await maskOperator.close();
  });

  it("preserves the same attested history across source and mask reinspection without overriding agent observation", async () => {
    const priorHistory = durableSourceHistory({
      inventoryIndex: 11,
      decision: "INCLUDE",
      attested: true,
    });
    const source = new SourceSessionHarness(
      sourceSnapshot({ durableSourceHistory: priorHistory }),
    );
    const mask = new MaskSessionHarness(
      maskSnapshot({ durableSourceHistory: priorHistory }),
    );
    const factories = delegateFactories({ source, mask });
    const sourceOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        factories,
      );
    const sourceView = await sourceOperator.snapshot();
    const maskOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...factories,
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      });
    const maskView = await maskOperator.snapshot();

    expect(sourceView.activeSource).toMatchObject({
      inventoryIndex: 11,
      phase: "source_review",
      decision: null,
      humanAttested: false,
    });
    expect(maskView.activeSource).toMatchObject({
      inventoryIndex: 11,
      phase: "source_review",
      decision: null,
      humanAttested: false,
    });
    expect(sourceView.sources).toEqual(maskView.sources);
    expect(sourceView.sources[11]).toEqual({
      inventoryIndex: 11,
      sweepNumber: 12,
      agentObservation: {
        state: "no_grand_hall_pixels_observed_human_pending",
        proposedDisposition: "exclude_whole_frame",
        maskAuthoringState: "not_required_if_human_confirms_exclusion",
      },
      authorityNoneRecord: {
        state: "authority_none_attestation_recorded",
        decision: {
          result: "INCLUDE",
          classification: "grand_hall_core",
        },
        attestation: "not_cryptographic",
      },
    });
    expectDeepFrozen(sourceView.sources);
    expectNoSensitiveProjection(sourceView);
    await sourceOperator.close();
    await maskOperator.close();
  });

  it("blocks controller handoff on unresolved responses, then closes source before opening mask and fail-closes buffers", async () => {
    const events: string[] = [];
    const source = new SourceSessionHarness(sourceSnapshot(), events);
    const mask = new MaskSessionHarness(
      {
        ...maskSnapshot(),
        rootInventorySha256: digest("b"),
        verificationAttestationSha256: digest("c"),
      },
      events,
    );
    const operator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({ source, mask, events }),
      );

    const sourceTile = await operator.prepareSourceTile({
      expectedBrowserEpochNumber: 2,
      renderGeneration: 4,
      column: 0,
      row: 0,
    });
    await expect(
      operator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "PENDING_TILE_DELIVERY" });
    expect(events).not.toContain("source.close");

    await sourceTile.discardAfterFailedSend();
    expect([...sourceTile.sourceRgb8]).toEqual([0, 0, 0, 0]);
    const maskView = await operator.beginMaskWorkflow({
      expectedBrowserEpochNumber: 2,
      expectedWorkspaceRevision: 7,
      renderGeneration: 4,
    });
    expect(events.slice(-3)).toEqual([
      "source.close",
      "mask.open",
      "mask.begin",
    ]);
    expect(mask.beginInputs).toEqual([
      {
        expectedBrowserEpochNonceSha256: BROWSER_MASK_SHA,
        expectedWorkspaceRevision: 7,
        expectedRenderGeneration: 4,
        sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
      },
    ]);
    expect(maskView).toMatchObject({
      browserEpochNumber: 3,
      workspaceRevision: 8,
      activeSource: { phase: "mask_edit", renderGeneration: 5 },
    });

    const maskTile = await operator.prepareMaskTile({
      expectedBrowserEpochNumber: 3,
      renderGeneration: 5,
      column: 1,
      row: 2,
    });
    await operator.close();
    expect(mask.rawDiscardCount).toBe(1);
    expect([...maskTile.sourceRgb8]).toEqual([0, 0]);
    expect([...maskTile.mask8]).toEqual([0, 0]);
    expect([...maskTile.reason8]).toEqual([0, 0]);
    expect(events.at(-1)).toBe("mask.close");
    await expect(
      maskTile.commitDeliveryAfterSuccessfulSend(),
    ).rejects.toMatchObject({ code: "DELIVERY_ALREADY_RESOLVED" });
  });

  it("requires the exact next browser epoch across both normal controller handoffs", async () => {
    for (const reopenedEpoch of [2, 1, 4]) {
      const source = new SourceSessionHarness(
        sourceSnapshot({ browserEpochNumber: 2 }),
      );
      const mask = new MaskSessionHarness(
        maskSnapshot({ browserEpochNumber: reopenedEpoch }),
      );
      const operator =
        await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
          delegateFactories({ source, mask }),
        );

      await expect(
        operator.beginMaskWorkflow({
          expectedBrowserEpochNumber: 2,
          expectedWorkspaceRevision: 7,
          renderGeneration: 4,
        }),
      ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
      expect(source.closeAttempts).toBe(1);
      expect(mask.closeAttempts).toBe(1);
      expect(mask.beginInputs).toHaveLength(0);
      await operator.close();
    }

    for (const reopenedEpoch of [3, 2, 5]) {
      const mask = new MaskSessionHarness(
        maskSnapshot({
          active: false,
          browserEpochNumber: 3,
        }),
      );
      const source = new SourceSessionHarness(
        sourceSnapshot({
          active: false,
          browserEpochNumber: reopenedEpoch,
        }),
      );
      let sourceOpenCount = 0;
      const operator =
        await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
          ...delegateFactories({ source, mask }),
          openSource: async () => {
            sourceOpenCount += 1;
            if (sourceOpenCount === 1) {
              throw new GrandHallT554NativeReviewSourceSessionV2Error(
                "PHASE_INVALID",
                "mask controller owns the session",
              );
            }
            return source;
          },
        });

      await expect(
        operator.selectSource({
          expectedBrowserEpochNumber: 3,
          expectedWorkspaceRevision: 7,
          inventoryIndex: 12,
        }),
      ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
      expect(sourceOpenCount).toBe(2);
      expect(mask.closeAttempts).toBe(1);
      expect(source.closeAttempts).toBe(1);
      expect(source.selectInputs).toHaveLength(0);
      await operator.close();
    }

    const exhaustedSourceToMaskSource = new SourceSessionHarness(
      sourceSnapshot({ browserEpochNumber: Number.MAX_SAFE_INTEGER }),
    );
    const exhaustedSourceToMaskMask = new MaskSessionHarness(
      maskSnapshot({ browserEpochNumber: Number.MAX_SAFE_INTEGER }),
    );
    const exhaustedSourceToMaskOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: exhaustedSourceToMaskSource,
          mask: exhaustedSourceToMaskMask,
        }),
      );
    await expect(
      exhaustedSourceToMaskOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: Number.MAX_SAFE_INTEGER,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(exhaustedSourceToMaskMask.closeAttempts).toBe(1);
    await exhaustedSourceToMaskOperator.close();

    const exhaustedMaskToSourceMask = new MaskSessionHarness(
      maskSnapshot({
        active: false,
        browserEpochNumber: Number.MAX_SAFE_INTEGER,
      }),
    );
    const exhaustedMaskToSourceSource = new SourceSessionHarness(
      sourceSnapshot({
        active: false,
        browserEpochNumber: Number.MAX_SAFE_INTEGER,
      }),
    );
    let exhaustedSourceOpenCount = 0;
    const exhaustedMaskToSourceOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({
          source: exhaustedMaskToSourceSource,
          mask: exhaustedMaskToSourceMask,
        }),
        openSource: async () => {
          exhaustedSourceOpenCount += 1;
          if (exhaustedSourceOpenCount === 1) {
            throw new GrandHallT554NativeReviewSourceSessionV2Error(
              "PHASE_INVALID",
              "mask controller owns the session",
            );
          }
          return exhaustedMaskToSourceSource;
        },
      });
    await expect(
      exhaustedMaskToSourceOperator.selectSource({
        expectedBrowserEpochNumber: Number.MAX_SAFE_INTEGER,
        expectedWorkspaceRevision: 7,
        inventoryIndex: 12,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(exhaustedMaskToSourceSource.closeAttempts).toBe(1);
    await exhaustedMaskToSourceOperator.close();

    const malformedSourceToMaskSource = new SourceSessionHarness(
      sourceSnapshot({ browserEpochNumber: 2 }),
    );
    const malformedSourceToMaskMask = new MaskSessionHarness({
      ...maskSnapshot({ browserEpochNumber: 3 }),
      maximumAllocatedRenderGeneration: 5,
      rootInventorySha256: digest("b"),
      verificationAttestationSha256: digest("c"),
    });
    const malformedSourceToMaskOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: malformedSourceToMaskSource,
          mask: malformedSourceToMaskMask,
        }),
      );
    await expect(
      malformedSourceToMaskOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(malformedSourceToMaskMask.closeAttempts).toBe(1);
    expect(malformedSourceToMaskMask.beginInputs).toHaveLength(0);
    await malformedSourceToMaskOperator.close();

    const malformedMaskToSourceMask = new MaskSessionHarness(
      maskSnapshot({ active: false, browserEpochNumber: 3 }),
    );
    const malformedMaskToSourceSource = new SourceSessionHarness({
      ...sourceSnapshot({ active: false, browserEpochNumber: 4 }),
      maximumAllocatedRenderGeneration: 5,
      rootInventorySha256: digest("b"),
      verificationAttestationSha256: digest("c"),
    });
    let malformedSourceOpenCount = 0;
    const malformedMaskToSourceOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({
          source: malformedMaskToSourceSource,
          mask: malformedMaskToSourceMask,
        }),
        openSource: async () => {
          malformedSourceOpenCount += 1;
          if (malformedSourceOpenCount === 1) {
            throw new GrandHallT554NativeReviewSourceSessionV2Error(
              "PHASE_INVALID",
              "mask controller owns the session",
            );
          }
          return malformedMaskToSourceSource;
        },
      });
    await expect(
      malformedMaskToSourceOperator.selectSource({
        expectedBrowserEpochNumber: 3,
        expectedWorkspaceRevision: 7,
        inventoryIndex: 12,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(malformedMaskToSourceSource.closeAttempts).toBe(1);
    expect(malformedMaskToSourceSource.selectInputs).toHaveLength(0);
    await malformedMaskToSourceOperator.close();

    const sourceSuccessor = new SourceSessionHarness(
      sourceSnapshot({ browserEpochNumber: 2 }),
    );
    const maskSuccessor = new MaskSessionHarness({
      ...maskSnapshot({ browserEpochNumber: 3 }),
      rootInventorySha256: digest("b"),
      verificationAttestationSha256: digest("c"),
    });
    const sourceToMaskSuccessorOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: sourceSuccessor,
          mask: maskSuccessor,
        }),
      );
    expect(
      await sourceToMaskSuccessorOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).toMatchObject({
      browserEpochNumber: 3,
      activeSource: { phase: "mask_edit" },
    });
    await sourceToMaskSuccessorOperator.close();

    const inactiveMaskSuccessor = new MaskSessionHarness(
      maskSnapshot({ active: false, browserEpochNumber: 3 }),
    );
    const inactiveSourceSuccessor = new SourceSessionHarness({
      ...sourceSnapshot({ active: false, browserEpochNumber: 4 }),
      rootInventorySha256: digest("b"),
      verificationAttestationSha256: digest("c"),
    });
    let successorSourceOpenCount = 0;
    const maskToSourceSuccessorOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({
          source: inactiveSourceSuccessor,
          mask: inactiveMaskSuccessor,
        }),
        openSource: async () => {
          successorSourceOpenCount += 1;
          if (successorSourceOpenCount === 1) {
            throw new GrandHallT554NativeReviewSourceSessionV2Error(
              "PHASE_INVALID",
              "mask controller owns the session",
            );
          }
          return inactiveSourceSuccessor;
        },
      });
    expect(
      await maskToSourceSuccessorOperator.selectSource({
        expectedBrowserEpochNumber: 3,
        expectedWorkspaceRevision: 7,
        inventoryIndex: 12,
      }),
    ).toMatchObject({ browserEpochNumber: 4 });
    expect(inactiveSourceSuccessor.selectInputs).toEqual([
      { expectedWorkspaceRevision: 7, inventoryIndex: 12 },
    ]);
    await maskToSourceSuccessorOperator.close();
  });

  it.each(["stopped", "poisoned"] as const)(
    "rejects source selection from a %s mask delegate before closing either controller",
    async (lifecycle) => {
      const mask = new MaskSessionHarness({
        ...maskSnapshot({ active: false, browserEpochNumber: 6 }),
        lifecycle,
      });
      const source = new SourceSessionHarness(
        sourceSnapshot({ active: false, browserEpochNumber: 6 }),
      );
      let sourceOpenCount = 0;
      const operator =
        await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
          ...delegateFactories({ source, mask }),
          openSource: async () => {
            sourceOpenCount += 1;
            throw new GrandHallT554NativeReviewSourceSessionV2Error(
              "PHASE_INVALID",
              "mask controller owns the terminal session",
            );
          },
        });

      await expect(
        operator.selectSource({
          expectedBrowserEpochNumber: 6,
          expectedWorkspaceRevision: 7,
          inventoryIndex: 12,
        }),
      ).rejects.toMatchObject({ code: "PHASE_INVALID" });
      expect(sourceOpenCount).toBe(1);
      expect(mask.closeAttempts).toBe(0);
      expect(await operator.snapshot()).toMatchObject({
        lifecycle,
        browserEpochNumber: 6,
        workspaceRevision: 7,
        activeSource: null,
      });
      await operator.close();
      expect(mask.closeAttempts).toBe(1);
    },
  );

  it("dispatches EXCLUDE and leave-pending through source semantics without synthesizing a pending decision", async () => {
    const excluded = new SourceSessionHarness();
    const excludedOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({ source: excluded, mask: new MaskSessionHarness() }),
      );
    const excludedView = await excludedOperator.recordExcludeDecision({
      expectedBrowserEpochNumber: 2,
      expectedWorkspaceRevision: 7,
      renderGeneration: 4,
      note: "No observed Grand Hall pixels.",
    });
    expect(excluded.excludeInputs).toEqual([
      {
        sourceEpochNonce: SOURCE_NONCE,
        renderGeneration: 4,
        expectedWorkspaceRevision: 7,
        note: "No observed Grand Hall pixels.",
      },
    ]);
    expect(excludedView.activeSource?.phase).toBe("decision_recorded");
    expect(excludedView.activeSource?.decision).toEqual({
      result: "EXCLUDE",
      classification: "no_observed_grand_hall_pixels",
    });
    expect(excludedView.activeSource?.humanAttested).toBe(false);
    expect(excludedView.sources[11]?.authorityNoneRecord).toEqual({
      state: "decision_recorded",
      decision: {
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      },
      attestation: "not_recorded",
    });
    const attestedExcludedView = await excludedOperator.recordHumanAttestation({
      expectedBrowserEpochNumber: 2,
      expectedWorkspaceRevision: 8,
      renderGeneration: 5,
      reviewerId: "sensitive-reviewer-id",
      knowledgeBasis: ["direct source review"],
    });
    expect(attestedExcludedView.activeSource).toMatchObject({
      phase: "human_attested",
      decision: {
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      },
      humanAttested: true,
    });
    expect(attestedExcludedView.sources[11]?.authorityNoneRecord).toEqual({
      state: "authority_none_attestation_recorded",
      decision: {
        result: "EXCLUDE",
        classification: "no_observed_grand_hall_pixels",
      },
      attestation: "not_cryptographic",
    });
    expectDeepFrozen(attestedExcludedView);
    expectNoSensitiveProjection(attestedExcludedView);

    const pending = new SourceSessionHarness(
      sourceSnapshot({ complete: false }),
    );
    const pendingOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({ source: pending, mask: new MaskSessionHarness() }),
      );
    const pendingView = await pendingOperator.leaveSourcePending({
      expectedBrowserEpochNumber: 2,
      expectedWorkspaceRevision: 7,
      renderGeneration: 4,
    });
    expect(pending.excludeInputs).toHaveLength(0);
    expect(pending.abandonInputs).toEqual([
      {
        expectedBrowserEpochNonceSha256: BROWSER_SOURCE_SHA,
        renderGeneration: 4,
        expectedWorkspaceRevision: 7,
        reason: "operator_abandon",
      },
    ]);
    expect(pendingView.activeSource).toBeNull();
    await excludedOperator.close();
    await pendingOperator.close();
  });

  it("dispatches INCLUDE, attestation, abandonment, and stop with guards derived only from mask snapshots", async () => {
    const source = new SourceSessionHarness();
    const mask = new MaskSessionHarness(
      maskSnapshot({
        phase: "mask_review",
        browserEpochNumber: 6,
        workspaceRevision: 10,
        renderGeneration: 9,
      }),
    );
    const operator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({ source, mask }),
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      });

    const includedView = await operator.recordIncludeDecision({
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 10,
      renderGeneration: 9,
      classification: "grand_hall_core",
      note: "Exact observed Grand Hall pixels.",
    });
    expect(mask.includeInputs[0]).toMatchObject({
      expectedBrowserEpochNonceSha256: BROWSER_MASK_SHA,
      expectedWorkspaceRevision: 10,
      expectedRenderGeneration: 9,
      sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
      classification: "grand_hall_core",
    });
    expect(includedView.activeSource).toMatchObject({
      phase: "decision_recorded",
      decision: {
        result: "INCLUDE",
        classification: "grand_hall_core",
      },
      humanAttested: false,
      mask: {
        revision: 3,
        includedPixelCount: 1,
        excludedPixelCount: PIXEL_COUNT - 1,
      },
    });
    expect(includedView.sources[11]?.authorityNoneRecord).toEqual({
      state: "decision_recorded",
      decision: {
        result: "INCLUDE",
        classification: "grand_hall_core",
      },
      attestation: "not_recorded",
    });

    const attestedView = await operator.recordHumanAttestation({
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 11,
      renderGeneration: 10,
      reviewerId: "venue-owner",
      knowledgeBasis: ["direct capture review"],
    });
    expect(mask.attestationInputs[0]).toMatchObject({
      expectedBrowserEpochNonceSha256: BROWSER_MASK_SHA,
      expectedWorkspaceRevision: 11,
      expectedRenderGeneration: 10,
      sourceReviewSubjectSha256: SOURCE_SUBJECT_SHA,
    });
    expect(attestedView.activeSource).toMatchObject({
      phase: "human_attested",
      decision: {
        result: "INCLUDE",
        classification: "grand_hall_core",
      },
      humanAttested: true,
    });
    expect(attestedView.sources[11]?.authorityNoneRecord).toEqual({
      state: "authority_none_attestation_recorded",
      decision: {
        result: "INCLUDE",
        classification: "grand_hall_core",
      },
      attestation: "not_cryptographic",
    });
    expectDeepFrozen(attestedView);
    expectNoSensitiveProjection(attestedView);

    const abandonedView = await operator.abandonActiveSource({
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 12,
      renderGeneration: 10,
      reason: "session_stop",
    });
    expect(mask.abandonInputs[0]).toMatchObject({
      expectedBrowserEpochNonceSha256: BROWSER_MASK_SHA,
      reason: "session_stop",
    });
    expect(abandonedView.sources[11]?.authorityNoneRecord).toEqual(
      attestedView.sources[11]?.authorityNoneRecord,
    );
    const stopped = await operator.stop({
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 13,
    });
    expect(mask.stopCount).toBe(1);
    expect(mask.stopInputs).toEqual([{ expectedWorkspaceRevision: 13 }]);
    expect(stopped.lifecycle).toBe("stopped");
    expect(stopped.sources[11]?.authorityNoneRecord).toEqual(
      attestedView.sources[11]?.authorityNoneRecord,
    );
    await operator.close();
  });

  it("latches recovery when a successful delegate mutation returns malformed durable history", async () => {
    const source = new SourceSessionHarness();
    source.corruptHistoryAfterExclude = true;
    const operator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({ source, mask: new MaskSessionHarness() }),
      );

    await expect(
      operator.recordExcludeDecision({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
        note: "Durable mutation succeeds before malformed projection.",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_INVARIANT_FAILED" });
    expect(source.excludeInputs).toHaveLength(1);
    expect(source.snapshotValue.workspaceRevision).toBe(8);
    await expect(operator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await operator.close();
  });

  it("keeps expected rejections retryable but latches uncertain delivery, mutation, and handoff failures", async () => {
    const safeSource = new SourceSessionHarness();
    safeSource.excludeError = new GrandHallT554NativeReviewSourceSessionV2Error(
      "SOURCE_COVERAGE_INCOMPLETE",
      "review remains incomplete",
    );
    const safeSourceOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: safeSource,
          mask: new MaskSessionHarness(),
        }),
      );
    await expect(
      safeSourceOperator.recordExcludeDecision({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
        note: "retry after completing coverage",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_COVERAGE_INCOMPLETE" });
    expect((await safeSourceOperator.snapshot()).workspaceRevision).toBe(7);
    await expect(
      safeSourceOperator.applyMaskEdit({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
        edit: {
          expectedRevision: 0,
          operation: "include",
          primitive: {
            kind: "rectangle",
            horizontalSeam: "none",
            leftPx: 0,
            topPx: 0,
            rightExclusivePx: 1,
            bottomExclusivePx: 1,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PHASE_INVALID" });
    expect((await safeSourceOperator.snapshot()).workspaceRevision).toBe(7);
    safeSource.excludeError = null;
    expect(
      (
        await safeSourceOperator.recordExcludeDecision({
          expectedBrowserEpochNumber: 2,
          expectedWorkspaceRevision: 7,
          renderGeneration: 4,
          note: "retry now succeeds",
        })
      ).activeSource?.decision,
    ).toMatchObject({ result: "EXCLUDE" });
    await safeSourceOperator.close();

    const safeMaskSource = new SourceSessionHarness();
    const safeMask = new MaskSessionHarness(
      maskSnapshot({
        phase: "mask_review",
        browserEpochNumber: 6,
        workspaceRevision: 10,
        renderGeneration: 9,
      }),
    );
    safeMask.includeError =
      new GrandHallT554NativeReviewMaskWorkflowSessionV2Error(
        "MASK_COVERAGE_INCOMPLETE",
        "mask review remains incomplete",
      );
    const safeMaskOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({ source: safeMaskSource, mask: safeMask }),
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      });
    const safeIncludeInput = {
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 10,
      renderGeneration: 9,
      classification: "grand_hall_core" as const,
      note: "retry after completing mask coverage",
    };
    await expect(
      safeMaskOperator.recordIncludeDecision(safeIncludeInput),
    ).rejects.toMatchObject({ code: "MASK_COVERAGE_INCOMPLETE" });
    expect((await safeMaskOperator.snapshot()).workspaceRevision).toBe(10);
    safeMask.includeError = null;
    expect(
      (await safeMaskOperator.recordIncludeDecision(safeIncludeInput))
        .activeSource?.decision,
    ).toMatchObject({ result: "INCLUDE" });
    await safeMaskOperator.close();

    const taintedSource = new SourceSessionHarness();
    const taintedMask = new MaskSessionHarness(
      maskSnapshot({
        phase: "mask_edit",
        browserEpochNumber: 6,
        workspaceRevision: 10,
        renderGeneration: 9,
      }),
    );
    taintedMask.freezeError =
      new GrandHallT554NativeReviewMaskWorkflowSessionV2Error(
        "MASK_REVISION_TAINTED",
        "prepared freeze was tainted and must be replaced by a new edit",
      );
    const taintedOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({ source: taintedSource, mask: taintedMask }),
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      });
    await expect(
      taintedOperator.freezeMask({
        expectedBrowserEpochNumber: 6,
        expectedWorkspaceRevision: 10,
        renderGeneration: 9,
        expectedMaskRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "MASK_REVISION_TAINTED" });
    expect((await taintedOperator.snapshot()).workspaceRevision).toBe(10);
    await taintedOperator.applyMaskEdit({
      expectedBrowserEpochNumber: 6,
      expectedWorkspaceRevision: 10,
      renderGeneration: 9,
      edit: {
        expectedRevision: 3,
        operation: "include",
        primitive: {
          kind: "rectangle",
          horizontalSeam: "none",
          leftPx: 0,
          topPx: 0,
          rightExclusivePx: 1,
          bottomExclusivePx: 1,
        },
      },
    });
    expect(taintedMask.applyInputs).toHaveLength(1);
    await taintedOperator.close();

    const deliverySource = new SourceSessionHarness();
    deliverySource.commitError = new Error("uncertain delivery commit");
    const deliveryOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: deliverySource,
          mask: new MaskSessionHarness(),
        }),
      );
    const firstTile = await deliveryOperator.prepareSourceTile({
      expectedBrowserEpochNumber: 2,
      renderGeneration: 4,
      column: 0,
      row: 0,
    });
    const secondTile = await deliveryOperator.prepareSourceTile({
      expectedBrowserEpochNumber: 2,
      renderGeneration: 4,
      column: 1,
      row: 0,
    });
    await expect(firstTile.commitDeliveryAfterSuccessfulSend()).rejects.toThrow(
      "uncertain delivery commit",
    );
    await expect(
      secondTile.commitDeliveryAfterSuccessfulSend(),
    ).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(deliverySource.rawCommitCount).toBe(1);
    expect(deliverySource.rawDiscardCount).toBe(1);
    expect([...firstTile.sourceRgb8]).toEqual([0, 0, 0, 0]);
    expect([...secondTile.sourceRgb8]).toEqual([0, 0, 0, 0]);
    await expect(deliveryOperator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await deliveryOperator.close();

    const mutationSource = new SourceSessionHarness();
    const mutationMask = new MaskSessionHarness(
      maskSnapshot({
        phase: "mask_review",
        browserEpochNumber: 6,
        workspaceRevision: 10,
        renderGeneration: 9,
      }),
    );
    mutationMask.includeError = new Error("uncertain durable decision");
    const mutationOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.open({
        ...delegateFactories({
          source: mutationSource,
          mask: mutationMask,
        }),
        openSource: async () => {
          throw new GrandHallT554NativeReviewSourceSessionV2Error(
            "PHASE_INVALID",
            "mask phase",
          );
        },
      });
    await expect(
      mutationOperator.recordIncludeDecision({
        expectedBrowserEpochNumber: 6,
        expectedWorkspaceRevision: 10,
        renderGeneration: 9,
        classification: "grand_hall_core",
        note: "must recover if append outcome is unknown",
      }),
    ).rejects.toThrow("uncertain durable decision");
    await expect(mutationOperator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await mutationOperator.close();

    const oldDelegateEvents: string[] = [];
    const oldDelegateSource = new SourceSessionHarness(
      sourceSnapshot(),
      oldDelegateEvents,
    );
    oldDelegateSource.closeFailuresRemaining = 1;
    const oldDelegateOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: oldDelegateSource,
          mask: new MaskSessionHarness(maskSnapshot(), oldDelegateEvents),
          events: oldDelegateEvents,
        }),
      );
    await expect(
      oldDelegateOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(oldDelegateSource.closeAttempts).toBe(1);
    await expect(oldDelegateOperator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await oldDelegateOperator.close();
    expect(oldDelegateSource.closeAttempts).toBe(2);
    await oldDelegateOperator.close();
    expect(oldDelegateSource.closeAttempts).toBe(2);

    const normalCloseSource = new SourceSessionHarness();
    normalCloseSource.closeFailuresRemaining = 1;
    const normalCloseOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: normalCloseSource,
          mask: new MaskSessionHarness(),
        }),
      );
    await expect(normalCloseOperator.close()).rejects.toMatchObject({
      code: "RESOURCE_CLEANUP_FAILED",
    });
    expect(normalCloseSource.closeAttempts).toBe(1);
    await normalCloseOperator.close();
    expect(normalCloseSource.closeAttempts).toBe(2);
    await normalCloseOperator.close();
    expect(normalCloseSource.closeAttempts).toBe(2);

    const transitionEvents: string[] = [];
    const transitionSource = new SourceSessionHarness(
      sourceSnapshot(),
      transitionEvents,
    );
    const transitionMask = new MaskSessionHarness(
      maskSnapshot(),
      transitionEvents,
    );
    const transitionOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create({
        ...delegateFactories({
          source: transitionSource,
          mask: transitionMask,
          events: transitionEvents,
        }),
        openMask: async () => {
          transitionEvents.push("mask.open.failed");
          throw new Error("mask open failed");
        },
      });
    await expect(
      transitionOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(transitionEvents.slice(-2)).toEqual([
      "source.close",
      "mask.open.failed",
    ]);
    await expect(transitionOperator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await transitionOperator.close();

    const mismatchEvents: string[] = [];
    const mismatchSource = new SourceSessionHarness(
      sourceSnapshot(),
      mismatchEvents,
    );
    const mismatchMask = new MaskSessionHarness(
      { ...maskSnapshot(), sessionIdSha256: digest("f") },
      mismatchEvents,
    );
    mismatchMask.closeFailuresRemaining = 1;
    const mismatchOperator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.create(
        delegateFactories({
          source: mismatchSource,
          mask: mismatchMask,
          events: mismatchEvents,
        }),
      );
    await expect(
      mismatchOperator.beginMaskWorkflow({
        expectedBrowserEpochNumber: 2,
        expectedWorkspaceRevision: 7,
        renderGeneration: 4,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CLEANUP_FAILED" });
    expect(mismatchEvents.slice(-3)).toEqual([
      "source.close",
      "mask.open",
      "mask.close",
    ]);
    await expect(mismatchOperator.snapshot()).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED",
    });
    await mismatchOperator.close();
    expect(mismatchMask.closeAttempts).toBe(2);
    await mismatchOperator.close();
    expect(mismatchMask.closeAttempts).toBe(2);
  });

  it("consumes a takeover witness once through mask, then clean-opens source and rejects pre-rotation browser requests", async () => {
    const events: string[] = [];
    const mask = new MaskSessionHarness(
      maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
      events,
    );
    const source = new SourceSessionHarness(
      {
        ...sourceSnapshot({
          browserEpochNumber: 5,
          workspaceRevision: 8,
          renderGeneration: 5,
        }),
        rootInventorySha256: digest("b"),
        verificationAttestationSha256: digest("c"),
      },
      events,
    );
    let takeoverCount = 0;
    const factories: __GrandHallT554NativeReviewOperatorDelegateFactoriesV2 = {
      ...delegateFactories({ source, mask, events }),
      takeOverMask: async () => {
        takeoverCount += 1;
        events.push("mask.takeOver");
        return mask;
      },
    };
    const operator =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        factories,
      );
    expect(takeoverCount).toBe(1);
    expect(events).toEqual(["mask.takeOver", "mask.close", "source.open"]);
    expect((await operator.snapshot()).browserEpochNumber).toBe(5);
    await expect(
      operator.selectSource({
        expectedBrowserEpochNumber: 4,
        expectedWorkspaceRevision: 8,
        inventoryIndex: 12,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_EPOCH_CONFLICT" });
    expect(source.selectInputs).toHaveLength(0);
    await operator.selectSource({
      expectedBrowserEpochNumber: 5,
      expectedWorkspaceRevision: 8,
      inventoryIndex: 12,
    });
    expect(source.selectInputs).toEqual([
      { expectedWorkspaceRevision: 8, inventoryIndex: 12 },
    ]);
    await operator.close();

    let failedTakeoverCount = 0;
    const sourceOnly = new SourceSessionHarness();
    const fallback =
      await __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver({
        ...delegateFactories({ source: sourceOnly, mask }),
        takeOverMask: async () => {
          failedTakeoverCount += 1;
          throw new GrandHallT554NativeReviewMaskWorkflowSessionV2Error(
            "PHASE_INVALID",
            "source-only terminal phase",
          );
        },
      });
    expect(failedTakeoverCount).toBe(1);
    expect((await fallback.snapshot()).browserEpochNumber).toBe(2);
    await fallback.close();

    const snapshotFailure = new Error("taken-over mask snapshot failed");
    const snapshotFailureMask = new MaskSessionHarness(maskSnapshot());
    snapshotFailureMask.snapshotError = snapshotFailure;
    snapshotFailureMask.closeFailuresRemaining = 1;
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: new SourceSessionHarness(),
          mask: snapshotFailureMask,
        }),
      ),
    ).rejects.toMatchObject({
      code: "RESOURCE_CLEANUP_FAILED",
      cause: {
        operationError: snapshotFailure,
        cleanupErrors: [expect.any(Error)],
        ownerReleaseEventuallySucceeded: true,
      },
    });
    expect(snapshotFailureMask.closeAttempts).toBe(2);

    const persistentSnapshotFailure = new Error(
      "taken-over mask snapshot and cleanup failed",
    );
    const persistentCleanupMask = new MaskSessionHarness(maskSnapshot());
    persistentCleanupMask.snapshotError = persistentSnapshotFailure;
    persistentCleanupMask.closeFailuresRemaining = 2;
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: new SourceSessionHarness(),
          mask: persistentCleanupMask,
        }),
      ),
    ).rejects.toMatchObject({
      code: "RESOURCE_CLEANUP_FAILED",
      cause: {
        operationError: persistentSnapshotFailure,
        cleanupErrors: [expect.any(Error), expect.any(Error)],
        ownerReleaseEventuallySucceeded: false,
      },
    });
    expect(persistentCleanupMask.closeAttempts).toBe(2);

    const closeFailureEvents: string[] = [];
    const closeFailureMask = new MaskSessionHarness(
      maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
      closeFailureEvents,
    );
    closeFailureMask.closeFailuresRemaining = 1;
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: new SourceSessionHarness(
            sourceSnapshot({
              browserEpochNumber: 5,
              workspaceRevision: 8,
              renderGeneration: 5,
            }),
            closeFailureEvents,
          ),
          mask: closeFailureMask,
          events: closeFailureEvents,
        }),
      ),
    ).rejects.toThrow("mask close failed before owner release");
    expect(closeFailureMask.closeAttempts).toBe(2);
    expect(closeFailureEvents).not.toContain("source.open");

    const sourceOpenFailure = new Error("source clean-open failed");
    const sourceOpenFailureMask = new MaskSessionHarness(
      maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
    );
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver({
        ...delegateFactories({
          source: new SourceSessionHarness(),
          mask: sourceOpenFailureMask,
        }),
        openSource: async () => {
          throw sourceOpenFailure;
        },
      }),
    ).rejects.toBe(sourceOpenFailure);
    expect(sourceOpenFailureMask.closeAttempts).toBe(1);

    const sourceSnapshotFailure = new Error(
      "clean-open source snapshot failed",
    );
    const sourceSnapshotFailureMask = new MaskSessionHarness(
      maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
    );
    const failedSnapshotSource = new SourceSessionHarness(
      sourceSnapshot({
        browserEpochNumber: 5,
        workspaceRevision: 8,
        renderGeneration: 5,
      }),
    );
    failedSnapshotSource.snapshotError = sourceSnapshotFailure;
    failedSnapshotSource.closeFailuresRemaining = 1;
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: failedSnapshotSource,
          mask: sourceSnapshotFailureMask,
        }),
      ),
    ).rejects.toMatchObject({
      code: "RESOURCE_CLEANUP_FAILED",
      cause: {
        operationError: sourceSnapshotFailure,
        cleanupErrors: [expect.any(Error)],
        ownerReleaseEventuallySucceeded: true,
      },
    });
    expect(sourceSnapshotFailureMask.closeAttempts).toBe(1);
    expect(failedSnapshotSource.closeAttempts).toBe(2);

    for (const reopenedEpoch of [4, 3, 6]) {
      const nonAdvancingMask = new MaskSessionHarness(
        maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
      );
      const nonAdvancingSource = new SourceSessionHarness({
        ...sourceSnapshot({
          browserEpochNumber: reopenedEpoch,
          workspaceRevision: 8,
          renderGeneration: 5,
        }),
        rootInventorySha256: digest("b"),
        verificationAttestationSha256: digest("c"),
      });
      await expect(
        __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
          delegateFactories({
            source: nonAdvancingSource,
            mask: nonAdvancingMask,
          }),
        ),
      ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
      expect(nonAdvancingMask.closeAttempts).toBe(1);
      expect(nonAdvancingSource.closeAttempts).toBe(1);
    }

    const validSuccessor = {
      ...sourceSnapshot({
        browserEpochNumber: 5,
        workspaceRevision: 8,
        renderGeneration: 5,
      }),
      rootInventorySha256: digest("b"),
      verificationAttestationSha256: digest("c"),
    };
    const validSuccessorActive = requireSourceActive(validSuccessor);
    const malformedSuccessors: readonly GrandHallT554NativeReviewSourceSessionSnapshotV2[] =
      [
        { ...validSuccessor, workspaceRevision: 7 },
        {
          ...validSuccessor,
          maximumAllocatedRenderGeneration: 4,
          activeSource: {
            ...validSuccessorActive,
            renderGeneration: 4,
          },
        },
        {
          ...validSuccessor,
          activeSource: {
            ...validSuccessorActive,
            inventoryIndex: 12,
          },
        },
      ];
    for (const malformedSuccessor of malformedSuccessors) {
      const predecessor = new MaskSessionHarness(
        maskSnapshot({ phase: "source_review", browserEpochNumber: 4 }),
      );
      const malformedSource = new SourceSessionHarness(malformedSuccessor);
      await expect(
        __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
          delegateFactories({
            source: malformedSource,
            mask: predecessor,
          }),
        ),
      ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
      expect(predecessor.closeAttempts).toBe(1);
      expect(malformedSource.closeAttempts).toBe(1);
    }

    const exhaustedEpochMask = new MaskSessionHarness(
      maskSnapshot({
        phase: "source_review",
        browserEpochNumber: Number.MAX_SAFE_INTEGER,
      }),
    );
    const exhaustedEpochSource = new SourceSessionHarness(
      sourceSnapshot({
        browserEpochNumber: Number.MAX_SAFE_INTEGER,
        workspaceRevision: 8,
        renderGeneration: 5,
      }),
    );
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: exhaustedEpochSource,
          mask: exhaustedEpochMask,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(exhaustedEpochMask.closeAttempts).toBe(1);
    expect(exhaustedEpochSource.closeAttempts).toBe(1);

    const exhaustedMask = new MaskSessionHarness(
      maskSnapshot({
        phase: "source_review",
        browserEpochNumber: 4,
        workspaceRevision: Number.MAX_SAFE_INTEGER,
        renderGeneration: Number.MAX_SAFE_INTEGER,
      }),
    );
    const impossibleSuccessor = new SourceSessionHarness(
      sourceSnapshot({
        browserEpochNumber: 5,
        workspaceRevision: Number.MAX_SAFE_INTEGER,
        renderGeneration: Number.MAX_SAFE_INTEGER,
      }),
    );
    await expect(
      __testOnlyGrandHallT554NativeReviewOperatorSessionV2.takeOver(
        delegateFactories({
          source: impossibleSuccessor,
          mask: exhaustedMask,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRANSITION_FAILED" });
    expect(exhaustedMask.closeAttempts).toBe(1);
    expect(impossibleSuccessor.closeAttempts).toBe(1);
  });
});

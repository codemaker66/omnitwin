import { basename } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS,
  GRAND_HALL_T554_NATIVE_TILE_COUNT,
} from "./grand-hall-t554-native-review-coverage.js";
import { replayGrandHallT554NativeReviewCoordinatorV2 } from "./grand-hall-t554-native-review-coordinator-replay-v2.js";
import {
  GrandHallT554NativeReviewJournalScopeV2Schema,
  GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
  GrandHallT554NativeReviewMaskChildEventV2Schema,
  GrandHallT554NativeReviewScopedEventV2Schema,
  GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
  GrandHallT554NativeReviewSourceChildEventV2Schema,
  type GrandHallT554NativeReviewChildCheckpointV2,
  type GrandHallT554NativeReviewDomainEventV2,
  type GrandHallT554NativeReviewJournalScopeV2,
  type GrandHallT554NativeReviewMaskChildCheckpointV2,
  type GrandHallT554NativeReviewMaskChildEventV2,
  type GrandHallT554NativeReviewMaskScopeV2,
  type GrandHallT554NativeReviewSourceChildCheckpointV2,
  type GrandHallT554NativeReviewSourceChildEventV2,
  type GrandHallT554NativeReviewSourceScopeV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  createGrandHallT554NativeReviewJournal,
  openGrandHallT554NativeReviewJournal,
  type GrandHallT554NativeReviewJournal,
  type GrandHallT554NativeReviewJournalReplay,
  type GrandHallT554NativeReviewJournalScope,
} from "./grand-hall-t554-native-review-journal.js";
import { isSafeGrandHallT554RelativePath } from "./grand-hall-t554-path-safety.js";

const DURABLE_SCOPED_EVENT_SCHEMA_VERSION =
  "venviewer.grand-hall-t554-native-review-durable-scoped-event.v2";
const DURABLE_REPLAY_SCHEMA_VERSION =
  "venviewer.grand-hall-t554-native-review-durable-journal-replay.v2";
const VERIFIED_DURABLE_CHILD_EVIDENCE_SCHEMA_VERSION =
  "venviewer.grand-hall-t554-native-review-verified-durable-child-journal-evidence.v2";
const LOW_LEVEL_SCOPE_BINDING_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_LOW_LEVEL_SCOPE_BINDING_V2";
const JOURNAL_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_INVENTORY_V2";
const MAXIMUM_COORDINATOR_EVENT_COUNT = 16_384;
const MAXIMUM_CHILD_EVENT_COUNT =
  1 +
  GRAND_HALL_T554_NATIVE_TILE_COUNT +
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS;

type Sha256 = `sha256:${string}`;
type GrandHallT554NativeReviewReplayModuleV2 = typeof import("./grand-hall-t554-native-review-replay-v2.js");

const DurableScopedEventPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(DURABLE_SCOPED_EVENT_SCHEMA_VERSION),
    scopedEvent: GrandHallT554NativeReviewScopedEventV2Schema,
  })
  .strict();

export interface GrandHallT554NativeReviewDurableJournalRecordV2 {
  readonly sequence: number;
  readonly recordedAtUtc: string;
  readonly eventSha256: Sha256;
  readonly fileName: string;
  readonly fileSha256: Sha256;
  readonly fileByteLength: number;
  readonly event: GrandHallT554NativeReviewDomainEventV2;
}

export interface GrandHallT554NativeReviewDurableJournalReplayV2 {
  readonly schemaVersion: typeof DURABLE_REPLAY_SCHEMA_VERSION;
  readonly scope: GrandHallT554NativeReviewJournalScopeV2;
  readonly lowLevelScope: GrandHallT554NativeReviewJournalScope;
  readonly lowLevelScopeSha256: Sha256;
  readonly lowLevelScopeFileSha256: Sha256;
  readonly revision: number;
  readonly headEventSha256: Sha256;
  readonly journalInventorySha256: Sha256;
  readonly records: readonly GrandHallT554NativeReviewDurableJournalRecordV2[];
  readonly events: readonly GrandHallT554NativeReviewDomainEventV2[];
}

export interface GrandHallT554NativeReviewDurableJournalV2 {
  readonly workspaceRoot: string;
  readonly leafName: string;
  readonly scope: GrandHallT554NativeReviewJournalScopeV2;
  replay(): Promise<GrandHallT554NativeReviewDurableJournalReplayV2>;
  append(input: {
    readonly expectedRevision: number;
    readonly event: unknown;
    readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  }): Promise<GrandHallT554NativeReviewDurableJournalReplayV2>;
  appendChildWithEvidence(input: {
    readonly expectedRevision: number;
    readonly event: unknown;
    readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  }): Promise<GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2>;
}

interface VerifiedDurableChildJournalEvidenceCommonV2 {
  readonly schemaVersion: typeof VERIFIED_DURABLE_CHILD_EVIDENCE_SCHEMA_VERSION;
  readonly finalDurableRecordedAtUtc: string;
}

export interface GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2 extends VerifiedDurableChildJournalEvidenceCommonV2 {
  readonly kind: "source";
  readonly scope: GrandHallT554NativeReviewSourceScopeV2;
  readonly checkpoint: GrandHallT554NativeReviewSourceChildCheckpointV2;
  readonly events: readonly GrandHallT554NativeReviewSourceChildEventV2[];
}

export interface GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2 extends VerifiedDurableChildJournalEvidenceCommonV2 {
  readonly kind: "mask";
  readonly scope: GrandHallT554NativeReviewMaskScopeV2;
  readonly checkpoint: GrandHallT554NativeReviewMaskChildCheckpointV2;
  readonly events: readonly GrandHallT554NativeReviewMaskChildEventV2[];
}

export type GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2 =
  | GrandHallT554NativeReviewVerifiedDurableSourceChildJournalEvidenceV2
  | GrandHallT554NativeReviewVerifiedDurableMaskChildJournalEvidenceV2;

export class GrandHallT554NativeReviewDurableJournalV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "SCOPE_INVALID"
      | "EVENT_INVALID"
      | "BINDING_MISMATCH"
      | "REVISION_CONFLICT"
      | "EVENT_LIMIT_REACHED"
      | "EMPTY_CHILD_JOURNAL",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewDurableJournalV2Error";
  }
}

const verifiedDurableChildEvidence = new WeakSet();
const verifiedDurableChildReplay = new WeakMap<
  object,
  {
    readonly leafName: string;
    readonly replay: GrandHallT554NativeReviewDurableJournalReplayV2;
  }
>();

function canonicalDigest(domain: string, value: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
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

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(
    value as Readonly<Record<string, unknown>>,
  )) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function parseScope(value: unknown): GrandHallT554NativeReviewJournalScopeV2 {
  const result = GrandHallT554NativeReviewJournalScopeV2Schema.safeParse(value);
  if (!result.success) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "SCOPE_INVALID",
      "Durable v2 journal scope is not the exact typed schema.",
      result.error,
    );
  }
  return frozenClone(result.data);
}

function scopeSubjectSha256(
  scope: GrandHallT554NativeReviewJournalScopeV2,
): Sha256 {
  if (scope.kind === "session") return scope.subjectSha256;
  if (scope.kind === "source") {
    return scope.sourceCustody.sourceReviewSubjectSha256;
  }
  return scope.maskReviewSubjectSha256;
}

export function deriveGrandHallT554NativeReviewLowLevelScopeV2(
  scopeInput: unknown,
): GrandHallT554NativeReviewJournalScope {
  const scope = parseScope(scopeInput);
  return Object.freeze({
    sessionNonceSha256: scope.sessionIdSha256,
    sourceEpochSha256: canonicalDigest(LOW_LEVEL_SCOPE_BINDING_DOMAIN, scope),
    subjectSha256: scopeSubjectSha256(scope),
    kind: scope.kind,
    implementationSha256: scope.implementationManifest.semanticSha256,
  });
}

function leafNameFor(workspaceRoot: string): string {
  const leafName = basename(workspaceRoot);
  if (
    leafName.length === 0 ||
    leafName.normalize("NFC") !== leafName ||
    !isSafeGrandHallT554RelativePath(leafName) ||
    !/^[a-z0-9][a-z0-9._-]{0,254}$/u.test(leafName) ||
    leafName.includes("..") ||
    leafName.includes("/") ||
    leafName.includes("\\")
  ) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "ARGUMENT_INVALID",
      "Durable v2 journal workspace must end in one safe NFC leaf name.",
    );
  }
  return leafName;
}

function declaredCoordinatorEventTime(
  event: GrandHallT554NativeReviewDomainEventV2,
): string | undefined {
  switch (event.eventType) {
    case "source.decision-recorded.v2":
      return event.payload.decidedAtUtc;
    case "source.human-attestation-recorded.v2":
      return event.payload.attestedAtUtc;
    default:
      return undefined;
  }
}

function assertChildSemanticReplay(
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
  replayModule: GrandHallT554NativeReviewReplayModuleV2,
): void {
  if (replay.scope.kind === "session") {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "SCOPE_INVALID",
      "Child semantic replay requires a source or mask journal.",
    );
  }
  const validated =
    replay.scope.kind === "source"
      ? replayModule.validateGrandHallT554NativeReviewSourceChildSequenceV2({
          scope: replay.scope,
          events: replay.events,
        })
      : replayModule.validateGrandHallT554NativeReviewMaskChildSequenceV2({
          scope: replay.scope,
          events: replay.events,
        });
  const lastRecord = replay.records.at(-1);
  if (
    lastRecord === undefined ||
    Date.parse(lastRecord.recordedAtUtc) <
      Date.parse(validated.latestServerOwnedAtUtc)
  ) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "BINDING_MISMATCH",
      "The final durable child record precedes its latest server-owned event time.",
    );
  }
}

async function assertSemanticReplay(
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
): Promise<void> {
  if (replay.events.length === 0) return;
  if (replay.scope.kind !== "session") {
    const replayModule = await import(
      "./grand-hall-t554-native-review-replay-v2.js"
    );
    assertChildSemanticReplay(replay, replayModule);
    return;
  }
  for (const record of replay.records) {
    const declaredAtUtc = declaredCoordinatorEventTime(record.event);
    if (
      declaredAtUtc !== undefined &&
      Date.parse(record.recordedAtUtc) < Date.parse(declaredAtUtc)
    ) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "BINDING_MISMATCH",
        "A durable coordinator record precedes its declared decision or attestation time.",
      );
    }
  }
  replayGrandHallT554NativeReviewCoordinatorV2({
    scope: replay.scope,
    events: replay.events,
  });
}

function eventLimit(scope: GrandHallT554NativeReviewJournalScopeV2): number {
  return scope.kind === "session"
    ? MAXIMUM_COORDINATOR_EVENT_COUNT
    : MAXIMUM_CHILD_EVENT_COUNT;
}

function inventorySha256(
  leafName: string,
  replay: GrandHallT554NativeReviewJournalReplay,
): Sha256 {
  return inventorySha256FromRecords({
    leafName,
    scopeSha256: replay.scopeSha256,
    scopeFileSha256: replay.scopeFileSha256,
    revision: replay.revision,
    headEventSha256: replay.headEventSha256,
    records: replay.events,
  });
}

function inventorySha256FromRecords(input: {
  readonly leafName: string;
  readonly scopeSha256: Sha256;
  readonly scopeFileSha256: Sha256;
  readonly revision: number;
  readonly headEventSha256: Sha256;
  readonly records: readonly {
    readonly sequence: number;
    readonly eventSha256: Sha256;
    readonly fileName: string;
    readonly fileSha256: Sha256;
    readonly fileByteLength: number;
    readonly recordedAtUtc: string;
    readonly eventType?: string;
    readonly event?: GrandHallT554NativeReviewDomainEventV2;
  }[];
}): Sha256 {
  return canonicalDigest(JOURNAL_INVENTORY_DIGEST_DOMAIN, {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-journal-inventory.v2",
    leafName: input.leafName,
    scopeSha256: input.scopeSha256,
    scopeFileSha256: input.scopeFileSha256,
    revision: input.revision,
    headEventSha256: input.headEventSha256,
    events: input.records.map((record) => ({
      sequence: record.sequence,
      eventSha256: record.eventSha256,
      fileName: record.fileName,
      fileSha256: record.fileSha256,
      fileByteLength: record.fileByteLength,
      recordedAtUtc: record.recordedAtUtc,
      eventType: record.eventType ?? record.event?.eventType,
    })),
  });
}

function normalizeReplay(
  expectedScope: GrandHallT554NativeReviewJournalScopeV2,
  expectedLowLevelScope: GrandHallT554NativeReviewJournalScope,
  leafName: string,
  replay: GrandHallT554NativeReviewJournalReplay,
): GrandHallT554NativeReviewDurableJournalReplayV2 {
  if (!canonicalEqual(replay.scope, expectedLowLevelScope)) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "BINDING_MISMATCH",
      "Low-level durable journal scope differs from the exact v2 scope binding.",
    );
  }
  if (replay.events.length > eventLimit(expectedScope)) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "EVENT_LIMIT_REACHED",
      "Durable v2 journal exceeds its scope-specific event bound.",
    );
  }
  const records: GrandHallT554NativeReviewDurableJournalRecordV2[] = [];
  for (const lowLevelEvent of replay.events) {
    const payloadResult = DurableScopedEventPayloadV2Schema.safeParse(
      lowLevelEvent.payload,
    );
    if (!payloadResult.success) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "EVENT_INVALID",
        `Durable v2 journal event ${String(lowLevelEvent.sequence)} has an invalid typed envelope.`,
        payloadResult.error,
      );
    }
    const scoped = payloadResult.data.scopedEvent;
    if (
      lowLevelEvent.eventType !== scoped.event.eventType ||
      !canonicalEqual(scoped.scope, expectedScope)
    ) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "BINDING_MISMATCH",
        `Durable v2 journal event ${String(lowLevelEvent.sequence)} drifted from its exact scope or event type.`,
      );
    }
    records.push({
      sequence: lowLevelEvent.sequence,
      recordedAtUtc: lowLevelEvent.recordedAtUtc,
      eventSha256: lowLevelEvent.eventSha256,
      fileName: lowLevelEvent.fileName,
      fileSha256: lowLevelEvent.fileSha256,
      fileByteLength: lowLevelEvent.fileByteLength,
      event: scoped.event,
    });
  }
  return frozenClone({
    schemaVersion: DURABLE_REPLAY_SCHEMA_VERSION,
    scope: expectedScope,
    lowLevelScope: expectedLowLevelScope,
    lowLevelScopeSha256: replay.scopeSha256,
    lowLevelScopeFileSha256: replay.scopeFileSha256,
    revision: replay.revision,
    headEventSha256: replay.headEventSha256,
    journalInventorySha256: inventorySha256(leafName, replay),
    records,
    events: records.map((record) => record.event),
  });
}

class DurableJournalV2 implements GrandHallT554NativeReviewDurableJournalV2 {
  constructor(
    readonly workspaceRoot: string,
    readonly leafName: string,
    readonly scope: GrandHallT554NativeReviewJournalScopeV2,
    private readonly lowLevelScope: GrandHallT554NativeReviewJournalScope,
    private readonly journal: GrandHallT554NativeReviewJournal,
  ) {}

  async replay(): Promise<GrandHallT554NativeReviewDurableJournalReplayV2> {
    const replay = normalizeReplay(
      this.scope,
      this.lowLevelScope,
      this.leafName,
      await this.journal.replay(),
    );
    await assertSemanticReplay(replay);
    return replay;
  }

  async append(input: {
    readonly expectedRevision: number;
    readonly event: unknown;
    readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  }): Promise<GrandHallT554NativeReviewDurableJournalReplayV2> {
    const scopedResult = GrandHallT554NativeReviewScopedEventV2Schema.safeParse(
      {
        scope: this.scope,
        event: input.event,
      },
    );
    if (!scopedResult.success) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "EVENT_INVALID",
        "Durable v2 append is not an exact event permitted by its journal scope.",
        scopedResult.error,
      );
    }
    if (this.scope.kind !== "session") {
      const payload = toCanonicalJson({
        schemaVersion: DURABLE_SCOPED_EVENT_SCHEMA_VERSION,
        scopedEvent: scopedResult.data,
      });
      const replayModule = await import(
        "./grand-hall-t554-native-review-replay-v2.js"
      );
      const advanced = await this.journal.appendValidated({
        expectedRevision: input.expectedRevision,
        eventType: scopedResult.data.event.eventType,
        payload,
        validateCurrent: (lowLevelCurrent) => {
          const current = normalizeReplay(
            this.scope,
            this.lowLevelScope,
            this.leafName,
            lowLevelCurrent,
          );
          if (current.events.length > 0) {
            assertChildSemanticReplay(current, replayModule);
          }
          const expectedStart =
            this.scope.kind === "source"
              ? "source.review-started.v2"
              : "mask.review-started.v2";
          if (
            (current.revision === 0 &&
              scopedResult.data.event.eventType !== expectedStart) ||
            (current.revision > 0 &&
              scopedResult.data.event.eventType === expectedStart)
          ) {
            throw new GrandHallT554NativeReviewDurableJournalV2Error(
              "EVENT_INVALID",
              "Child journals require exactly one typed start event at revision one.",
            );
          }
          const candidateEvents = [...current.events, scopedResult.data.event];
          if (current.revision === 0) {
            const predecessorCoverage =
              scopedResult.data.event.eventType ===
                "source.review-started.v2" ||
              scopedResult.data.event.eventType === "mask.review-started.v2"
                ? scopedResult.data.event.payload.predecessorCoverage
                : undefined;
            if (predecessorCoverage === undefined) {
              throw new GrandHallT554NativeReviewDurableJournalV2Error(
                "EVENT_INVALID",
                "Child start predecessor binding could not be resolved.",
              );
            }
            if (predecessorCoverage === null) {
              if (input.predecessorEvidence !== undefined) {
                throw new GrandHallT554NativeReviewDurableJournalV2Error(
                  "BINDING_MISMATCH",
                  "A fresh child start cannot claim unrelated predecessor evidence.",
                );
              }
            } else {
              const predecessorEvidence = input.predecessorEvidence;
              if (
                predecessorEvidence === undefined ||
                !isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
                  predecessorEvidence,
                ) ||
                predecessorEvidence.kind !== this.scope.kind
              ) {
                throw new GrandHallT554NativeReviewDurableJournalV2Error(
                  "BINDING_MISMATCH",
                  "A resumed child start requires verified durable predecessor evidence of the same kind.",
                );
              }
              const derivedCarry =
                replayModule.createGrandHallT554NativeReviewCoverageCarryStateV2(
                  predecessorEvidence,
                );
              if (!canonicalEqual(predecessorCoverage, derivedCarry)) {
                throw new GrandHallT554NativeReviewDurableJournalV2Error(
                  "BINDING_MISMATCH",
                  "Child start carry differs from its exact durable predecessor replay.",
                );
              }
            }
          } else if (input.predecessorEvidence !== undefined) {
            throw new GrandHallT554NativeReviewDurableJournalV2Error(
              "ARGUMENT_INVALID",
              "Predecessor evidence is accepted only with the first child event.",
            );
          }
          const validated =
            this.scope.kind === "source"
              ? replayModule.validateGrandHallT554NativeReviewSourceChildSequenceV2(
                  { scope: this.scope, events: candidateEvents },
                )
              : replayModule.validateGrandHallT554NativeReviewMaskChildSequenceV2(
                  { scope: this.scope, events: candidateEvents },
                );
          return {
            minimumRecordedAtUtc: validated.latestServerOwnedAtUtc,
          };
        },
      });
      return normalizeReplay(
        this.scope,
        this.lowLevelScope,
        this.leafName,
        advanced,
      );
    }
    const current = await this.replay();
    if (input.expectedRevision !== current.revision) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "REVISION_CONFLICT",
        "Durable v2 append expected a different current revision.",
      );
    }
    if (input.predecessorEvidence !== undefined) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "ARGUMENT_INVALID",
        "Coordinator appends cannot carry child-predecessor evidence.",
      );
    }
    replayGrandHallT554NativeReviewCoordinatorV2({
      scope: this.scope,
      events: [...current.events, scopedResult.data.event],
    });
    const payload = toCanonicalJson({
      schemaVersion: DURABLE_SCOPED_EVENT_SCHEMA_VERSION,
      scopedEvent: scopedResult.data,
    });
    const minimumRecordedAtUtc = declaredCoordinatorEventTime(
      scopedResult.data.event,
    );
    const advanced = await this.journal.append({
      expectedRevision: input.expectedRevision,
      eventType: scopedResult.data.event.eventType,
      payload,
      ...(minimumRecordedAtUtc === undefined
        ? {}
        : { minimumRecordedAtUtc }),
    });
    return normalizeReplay(
      this.scope,
      this.lowLevelScope,
      this.leafName,
      advanced,
    );
  }

  async appendChildWithEvidence(input: {
    readonly expectedRevision: number;
    readonly event: unknown;
    readonly predecessorEvidence?: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  }): Promise<GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2> {
    if (this.scope.kind === "session") {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "SCOPE_INVALID",
        "Coordinator journals cannot issue child evidence after append.",
      );
    }
    const replay = await this.append(input);
    return evidenceFromReplay(this.leafName, replay);
  }
}

async function createOrOpenDurableJournal(
  mode: "create" | "open",
  options: {
    readonly workspaceRoot: string;
    readonly scope: unknown;
  },
): Promise<GrandHallT554NativeReviewDurableJournalV2> {
  const leafName = leafNameFor(options.workspaceRoot);
  const scope = parseScope(options.scope);
  const lowLevelScope = deriveGrandHallT554NativeReviewLowLevelScopeV2(scope);
  const journal =
    mode === "create"
      ? await createGrandHallT554NativeReviewJournal({
          workspaceRoot: options.workspaceRoot,
          scope: lowLevelScope,
        })
      : await openGrandHallT554NativeReviewJournal({
          workspaceRoot: options.workspaceRoot,
          expectedScope: lowLevelScope,
        });
  const durable = new DurableJournalV2(
    journal.workspaceRoot,
    leafName,
    scope,
    lowLevelScope,
    journal,
  );
  await durable.replay();
  return durable;
}

export async function createGrandHallT554NativeReviewDurableJournalV2(options: {
  readonly workspaceRoot: string;
  readonly scope: unknown;
}): Promise<GrandHallT554NativeReviewDurableJournalV2> {
  return createOrOpenDurableJournal("create", options);
}

export async function openGrandHallT554NativeReviewDurableJournalV2(options: {
  readonly workspaceRoot: string;
  readonly expectedScope: unknown;
}): Promise<GrandHallT554NativeReviewDurableJournalV2> {
  return createOrOpenDurableJournal("open", {
    workspaceRoot: options.workspaceRoot,
    scope: options.expectedScope,
  });
}

function markVerifiedEvidence<
  Evidence extends
    GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
>(
  evidence: Evidence,
  leafName: string,
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
): Evidence {
  const frozen = frozenClone(evidence);
  verifiedDurableChildEvidence.add(frozen);
  verifiedDurableChildReplay.set(frozen, { leafName, replay });
  return frozen;
}

export function isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
  value: unknown,
): value is GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    verifiedDurableChildEvidence.has(value)
  );
}

function childCheckpointFromReplay(
  leafName: string,
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
): GrandHallT554NativeReviewChildCheckpointV2 {
  const material = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-child-checkpoint.v2" as const,
    kind: replay.scope.kind,
    leafName,
    scopeSha256: replay.lowLevelScopeSha256,
    scopeFileSha256: replay.lowLevelScopeFileSha256,
    revision: replay.revision,
    headEventSha256: replay.headEventSha256,
    journalInventorySha256: replay.journalInventorySha256,
  };
  return replay.scope.kind === "source"
    ? GrandHallT554NativeReviewSourceChildCheckpointV2Schema.parse(material)
    : GrandHallT554NativeReviewMaskChildCheckpointV2Schema.parse(material);
}

function evidenceFromReplay(
  leafName: string,
  replay: GrandHallT554NativeReviewDurableJournalReplayV2,
): GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2 {
  if (replay.scope.kind === "session") {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "SCOPE_INVALID",
      "Coordinator journals cannot be issued as child-journal evidence.",
    );
  }
  const lastRecord = replay.records.at(-1);
  if (lastRecord === undefined) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "EMPTY_CHILD_JOURNAL",
      "A verified child journal requires at least its durable start event.",
    );
  }
  const checkpoint = childCheckpointFromReplay(leafName, replay);
  if (replay.scope.kind === "source") {
    const events = replay.events.map((event, index) => {
      const result =
        GrandHallT554NativeReviewSourceChildEventV2Schema.safeParse(event);
      if (!result.success) {
        throw new GrandHallT554NativeReviewDurableJournalV2Error(
          "EVENT_INVALID",
          `Source child event ${String(index + 1)} is invalid.`,
          result.error,
        );
      }
      return result.data;
    });
    return markVerifiedEvidence(
      {
        schemaVersion: VERIFIED_DURABLE_CHILD_EVIDENCE_SCHEMA_VERSION,
        kind: "source",
        scope: replay.scope,
        checkpoint: GrandHallT554NativeReviewSourceChildCheckpointV2Schema.parse(
          checkpoint,
        ),
        finalDurableRecordedAtUtc: lastRecord.recordedAtUtc,
        events,
      },
      leafName,
      replay,
    );
  }
  const events = replay.events.map((event, index) => {
    const result =
      GrandHallT554NativeReviewMaskChildEventV2Schema.safeParse(event);
    if (!result.success) {
      throw new GrandHallT554NativeReviewDurableJournalV2Error(
        "EVENT_INVALID",
        `Mask child event ${String(index + 1)} is invalid.`,
        result.error,
      );
    }
    return result.data;
  });
  return markVerifiedEvidence(
    {
      schemaVersion: VERIFIED_DURABLE_CHILD_EVIDENCE_SCHEMA_VERSION,
      kind: "mask",
      scope: replay.scope,
      checkpoint:
        GrandHallT554NativeReviewMaskChildCheckpointV2Schema.parse(checkpoint),
      finalDurableRecordedAtUtc: lastRecord.recordedAtUtc,
      events,
    },
    leafName,
    replay,
  );
}

function prefixReplay(
  metadata: {
    readonly leafName: string;
    readonly replay: GrandHallT554NativeReviewDurableJournalReplayV2;
  },
  revision: number,
): GrandHallT554NativeReviewDurableJournalReplayV2 {
  const replay = metadata.replay;
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > replay.revision
  ) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "ARGUMENT_INVALID",
      "Historical child prefix revision is outside the verified journal.",
    );
  }
  const records = replay.records.slice(0, revision);
  const head = records.at(-1);
  if (head === undefined) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "EMPTY_CHILD_JOURNAL",
      "Historical child prefix unexpectedly has no durable record.",
    );
  }
  return frozenClone({
    ...replay,
    revision,
    headEventSha256: head.eventSha256,
    journalInventorySha256: inventorySha256FromRecords({
      leafName: metadata.leafName,
      scopeSha256: replay.lowLevelScopeSha256,
      scopeFileSha256: replay.lowLevelScopeFileSha256,
      revision,
      headEventSha256: head.eventSha256,
      records,
    }),
    records,
    events: records.map((record) => record.event),
  });
}

export async function deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2(options: {
  readonly evidence: GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2;
  readonly revision: number;
}): Promise<GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2> {
  if (
    !isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2(
      options.evidence,
    )
  ) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "ARGUMENT_INVALID",
      "Historical child prefix requires branded durable evidence.",
    );
  }
  const metadata = verifiedDurableChildReplay.get(options.evidence);
  if (metadata === undefined) {
    throw new GrandHallT554NativeReviewDurableJournalV2Error(
      "ARGUMENT_INVALID",
      "Historical child prefix lost its branded replay metadata.",
    );
  }
  const replay = prefixReplay(metadata, options.revision);
  await assertSemanticReplay(replay);
  return evidenceFromReplay(metadata.leafName, replay);
}

export async function openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2(options: {
  readonly workspaceRoot: string;
  readonly expectedScope: unknown;
}): Promise<GrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2> {
  const journal = await openGrandHallT554NativeReviewDurableJournalV2(options);
  const replay = await journal.replay();
  return evidenceFromReplay(journal.leafName, replay);
}

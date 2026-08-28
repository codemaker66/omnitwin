import { createHash } from "node:crypto";

import {
  CanonicalJsonValueSchema,
  stableCanonicalJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";

import {
  GrandHallT554NativeReviewCoordinatorEventV2Schema,
  GrandHallT554NativeReviewSessionScopeV2Schema,
  type GrandHallT554NativeReviewAuthorityBoundaryV2,
  type GrandHallT554NativeReviewChildCheckpointV2,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewFrozenMaskBindingV2,
  type GrandHallT554NativeReviewImplementationManifestBindingV2,
  type GrandHallT554NativeReviewMaskChildCheckpointV2,
  type GrandHallT554NativeReviewMaskCoverageCarryStateV2,
  type GrandHallT554NativeReviewMaskStateEvidenceV2,
  type GrandHallT554NativeReviewPreparedMaskBindingV2,
  type GrandHallT554NativeReviewRegistryBindingV2,
  type GrandHallT554NativeReviewSessionScopeV2,
  type GrandHallT554NativeReviewSourceChildCheckpointV2,
  type GrandHallT554NativeReviewSourceCoverageCarryStateV2,
  type GrandHallT554NativeReviewSourceCustodyBindingV2,
} from "./grand-hall-t554-native-review-events-v2.js";

const MAXIMUM_COORDINATOR_EVENT_COUNT = 16_384;
const PREPARED_BINDING_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_PREPARED_BINDING_V2";
const FROZEN_BINDING_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_FROZEN_BINDING_V2";
const MASK_EVIDENCE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_EVIDENCE_V2";
const MASK_REVIEW_SUBJECT_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_MASK_REVIEW_SUBJECT_V2";

type Sha256 = `sha256:${string}`;
type SourceSelectionIntendedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "source.selection-intended.v2" }
>;
type MaskFreezeIntendedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.freeze-intended.v2" }
>;
type CoverageSegmentResumeIntendedEvent = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "coverage.segment-resume-intended.v2" }
>;

export interface GrandHallT554NativeReviewCoordinatorChildObligationV2 {
  readonly kind: "source" | "mask";
  readonly leafName: string;
  readonly operationIdSha256: Sha256;
  readonly declarationKind:
    | "source_selection"
    | "mask_freeze"
    | "coverage_resume";
  readonly disposition:
    | "pending"
    | "committed"
    | "recovery_aborted_absent"
    | "recovery_aborted_present";
  readonly browserEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly allocatedRenderGeneration: number;
  readonly checkpointReferences: readonly GrandHallT554NativeReviewChildCheckpointV2[];
}

export interface GrandHallT554NativeReviewCoordinatorActiveSourceV2 {
  readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  readonly sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2;
  readonly sourceCoverageSegmentIdSha256: Sha256;
  readonly phase: "source_review" | "mask_edit" | "mask_review";
  readonly renderGeneration: number;
  readonly maskState: GrandHallT554NativeReviewMaskStateEvidenceV2 | null;
  readonly maskReviewSubjectSha256: Sha256 | null;
  readonly frozenBindingSha256: Sha256 | null;
  readonly frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2 | null;
  readonly maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2 | null;
  readonly maskCoverageSegmentIdSha256: Sha256 | null;
}

export interface GrandHallT554NativeReviewCoordinatorReplayV2 {
  readonly schemaVersion: "venviewer.grand-hall-t554-native-review-coordinator-replay.v2";
  readonly lifecycle: "active" | "poisoned" | "stopped";
  readonly sessionIdSha256: Sha256;
  readonly registry: GrandHallT554NativeReviewRegistryBindingV2;
  readonly implementationManifest: GrandHallT554NativeReviewImplementationManifestBindingV2;
  readonly authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2;
  readonly workspaceRevision: number;
  readonly maximumAllocatedRenderGeneration: number;
  readonly browserEpoch: {
    readonly number: number;
    readonly nonceSha256: Sha256;
  } | null;
  readonly eventCount: number;
  readonly activeSource: GrandHallT554NativeReviewCoordinatorActiveSourceV2 | null;
  readonly pendingIntent: {
    readonly kind: "source_selection" | "mask_freeze" | "coverage_resume";
    readonly operationIdSha256: Sha256;
    readonly allocatedRenderGeneration: number;
    readonly childJournalLeafName: string;
  } | null;
  readonly declaredChildLeafNames: readonly string[];
  readonly childObligations: readonly GrandHallT554NativeReviewCoordinatorChildObligationV2[];
}

export class GrandHallT554NativeReviewCoordinatorReplayV2Error extends Error {
  constructor(
    readonly code:
      | "ARGUMENT_INVALID"
      | "EVENT_INVALID"
      | "TRANSITION_INVALID"
      | "BINDING_MISMATCH"
      | "DERIVED_MISMATCH"
      | "EVENT_LIMIT_REACHED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewCoordinatorReplayV2Error";
  }
}

interface ActiveSourceState {
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
  sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2;
  sourceCoverageSegmentIdSha256: Sha256;
  phase: "source_review" | "mask_edit" | "mask_review";
  renderGeneration: number;
  maskState: GrandHallT554NativeReviewMaskStateEvidenceV2 | null;
  maskReviewSubjectSha256: Sha256 | null;
  frozenBindingSha256: Sha256 | null;
  frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2 | null;
  maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2 | null;
  maskCoverageSegmentIdSha256: Sha256 | null;
}

type PendingIntent =
  | {
      readonly kind: "source_selection";
      readonly payload: SourceSelectionIntendedEvent["payload"];
    }
  | {
      readonly kind: "mask_freeze";
      readonly payload: MaskFreezeIntendedEvent["payload"];
    }
  | {
      readonly kind: "coverage_resume";
      readonly payload: CoverageSegmentResumeIntendedEvent["payload"];
    };

interface MutableChildObligation {
  readonly kind: "source" | "mask";
  readonly leafName: string;
  readonly operationIdSha256: Sha256;
  readonly declarationKind:
    | "source_selection"
    | "mask_freeze"
    | "coverage_resume";
  disposition:
    | "pending"
    | "committed"
    | "recovery_aborted_absent"
    | "recovery_aborted_present";
  readonly browserEpochNonceSha256: Sha256;
  readonly coverageSegmentIdSha256: Sha256;
  readonly allocatedRenderGeneration: number;
  readonly checkpointReferences: GrandHallT554NativeReviewChildCheckpointV2[];
}

interface CoordinatorState {
  readonly scope: GrandHallT554NativeReviewSessionScopeV2;
  lifecycle: "active" | "poisoned" | "stopped";
  workspaceRevision: number;
  maximumAllocatedRenderGeneration: number;
  browserEpoch: { number: number; nonceSha256: Sha256 } | null;
  previousBrowserEpochNonceSha256: Sha256 | null;
  eventCount: number;
  activeSource: ActiveSourceState | null;
  pendingIntent: PendingIntent | null;
  readonly declaredChildLeafNames: Set<string>;
  readonly operationIds: Set<Sha256>;
  readonly browserEpochNonceHashes: Set<Sha256>;
  readonly sourceEpochNonceHashes: Set<Sha256>;
  readonly sourceEpochBindingHashes: Set<Sha256>;
  readonly coverageSegmentIds: Set<Sha256>;
  readonly childObligations: Map<string, MutableChildObligation>;
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: unknown): Sha256 {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(
    Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"),
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return (
      stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
      stableCanonicalJson(CanonicalJsonValueSchema.parse(right))
    );
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
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

function transition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "TRANSITION_INVALID",
      message,
    );
  }
}

function binding(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "BINDING_MISMATCH",
      message,
    );
  }
}

function derived(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "DERIVED_MISMATCH",
      message,
    );
  }
}

function sameSource(
  left: GrandHallPanoramaSourceJpgIdentityV2,
  right: GrandHallPanoramaSourceJpgIdentityV2,
): boolean {
  return canonicalEqual(left, right);
}

function sameStableSourceCustody(
  left: GrandHallT554NativeReviewSourceCustodyBindingV2,
  right: GrandHallT554NativeReviewSourceCustodyBindingV2,
): boolean {
  return (
    canonicalEqual(left.source, right.source) &&
    canonicalEqual(left.sourceVerification, right.sourceVerification) &&
    left.sourceReviewSubjectSha256 === right.sourceReviewSubjectSha256
  );
}

function sameCheckpointIdentity(
  left: GrandHallT554NativeReviewChildCheckpointV2,
  right: GrandHallT554NativeReviewChildCheckpointV2,
): boolean {
  return (
    left.kind === right.kind &&
    left.leafName === right.leafName &&
    left.scopeSha256 === right.scopeSha256 &&
    left.scopeFileSha256 === right.scopeFileSha256
  );
}

function checkpointAdvances(
  previous: GrandHallT554NativeReviewChildCheckpointV2,
  current: GrandHallT554NativeReviewChildCheckpointV2,
): boolean {
  if (
    !sameCheckpointIdentity(previous, current) ||
    current.revision < previous.revision
  ) {
    return false;
  }
  if (current.revision === previous.revision)
    return canonicalEqual(previous, current);
  return true;
}

function requireActive(state: CoordinatorState): void {
  transition(
    state.lifecycle === "active",
    "A terminal coordinator cannot accept later events.",
  );
}

function requireBrowserEpoch(
  state: CoordinatorState,
): NonNullable<CoordinatorState["browserEpoch"]> {
  const browser = state.browserEpoch;
  transition(
    browser !== null,
    "A coordinator mutation requires a current browser epoch.",
  );
  return browser;
}

function requireNoPendingIntent(state: CoordinatorState): void {
  transition(
    state.pendingIntent === null,
    "A new coordinator operation cannot begin while an intent is unresolved.",
  );
}

function requireWorkspace(
  state: CoordinatorState,
  previous: number,
  resulting: number,
): void {
  transition(
    previous === state.workspaceRevision,
    "Coordinator event workspace CAS does not match replay state.",
  );
  transition(
    resulting === previous + 1,
    "Coordinator event must advance workspace revision exactly once.",
  );
}

function requireCurrentSource(
  state: CoordinatorState,
  custody: GrandHallT554NativeReviewSourceCustodyBindingV2,
): ActiveSourceState {
  const active = state.activeSource;
  transition(active !== null, "Coordinator event requires one active source.");
  binding(
    canonicalEqual(active.sourceCustody, custody),
    "Coordinator event source custody differs from the active source.",
  );
  return active;
}

function recordOperationId(
  state: CoordinatorState,
  operationIdSha256: Sha256,
): void {
  transition(
    !state.operationIds.has(operationIdSha256),
    "Coordinator operation identifiers cannot be reused.",
  );
  state.operationIds.add(operationIdSha256);
}

function declareChildLeaf(state: CoordinatorState, leafName: string): void {
  transition(
    !state.declaredChildLeafNames.has(leafName),
    "Coordinator child journal leaf names cannot be reused.",
  );
  state.declaredChildLeafNames.add(leafName);
}

function recordUniqueIdentity(
  inventory: Set<Sha256>,
  value: Sha256,
  label: string,
): void {
  transition(!inventory.has(value), `${label} cannot be reused.`);
  inventory.add(value);
}

function declareChildObligation(
  state: CoordinatorState,
  input: Omit<MutableChildObligation, "disposition" | "checkpointReferences">,
): void {
  declareChildLeaf(state, input.leafName);
  transition(
    !state.childObligations.has(input.leafName),
    "Coordinator child obligation leaf names cannot be reused.",
  );
  state.childObligations.set(input.leafName, {
    ...input,
    disposition: "pending",
    checkpointReferences: [],
  });
}

function childObligation(
  state: CoordinatorState,
  checkpoint: GrandHallT554NativeReviewChildCheckpointV2,
): MutableChildObligation {
  const obligation = state.childObligations.get(checkpoint.leafName);
  transition(
    obligation !== undefined && obligation.kind === checkpoint.kind,
    "Coordinator checkpoint references an undeclared or wrong-kind child.",
  );
  return obligation;
}

function referenceChildCheckpoint(
  state: CoordinatorState,
  checkpoint: GrandHallT554NativeReviewChildCheckpointV2,
): void {
  childObligation(state, checkpoint).checkpointReferences.push(
    frozenClone(checkpoint),
  );
}

function resolveChildObligation(
  state: CoordinatorState,
  leafName: string,
  disposition: MutableChildObligation["disposition"],
  checkpoint: GrandHallT554NativeReviewChildCheckpointV2 | null,
): void {
  const obligation = state.childObligations.get(leafName);
  transition(
    obligation !== undefined && obligation.disposition === "pending",
    "Coordinator child obligation is absent or already resolved.",
  );
  if (checkpoint !== null) {
    binding(
      checkpoint.leafName === leafName && checkpoint.kind === obligation.kind,
      "Resolved child checkpoint differs from its declaration.",
    );
    obligation.checkpointReferences.push(frozenClone(checkpoint));
  }
  obligation.disposition = disposition;
}

export function computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(
  bindingValue: GrandHallT554NativeReviewPreparedMaskBindingV2,
): Sha256 {
  return canonicalDigest(PREPARED_BINDING_DIGEST_DOMAIN, bindingValue);
}

export function computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
  bindingValue: GrandHallT554NativeReviewFrozenMaskBindingV2,
): Sha256 {
  return canonicalDigest(FROZEN_BINDING_DIGEST_DOMAIN, bindingValue);
}

function preparedMaskEvidenceMaterialFromFrozen(
  frozen: GrandHallT554NativeReviewFrozenMaskBindingV2,
): GrandHallT554NativeReviewPreparedMaskBindingV2 {
  return {
    schemaVersion: "venviewer.grand-hall-t554-native-mask-prepared-binding.v2",
    source: frozen.source,
    revision: frozen.revision,
    includedPixelCount: frozen.includedPixelCount,
    excludedPixelCount: frozen.excludedPixelCount,
    reasonCounts: frozen.reasonCounts,
    mask: {
      fileName: frozen.fileName,
      sha256: frozen.sha256,
      byteLength: frozen.byteLength,
      widthPx: frozen.widthPx,
      heightPx: frozen.heightPx,
      bitDepth: frozen.bitDepth,
      channelCount: frozen.channelCount,
      permittedPixelValues: frozen.permittedPixelValues,
      zeroMeaning: frozen.zeroMeaning,
      twoHundredFiftyFiveMeaning: frozen.twoHundredFiftyFiveMeaning,
    },
    reasonMap: frozen.reasonMap,
  };
}

export function computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
  bindingValue: GrandHallT554NativeReviewPreparedMaskBindingV2,
): Sha256 {
  return canonicalDigest(MASK_EVIDENCE_DIGEST_DOMAIN, bindingValue);
}

export function computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(
  bindingValue: GrandHallT554NativeReviewFrozenMaskBindingV2,
): Sha256 {
  return canonicalDigest(
    MASK_EVIDENCE_DIGEST_DOMAIN,
    preparedMaskEvidenceMaterialFromFrozen(bindingValue),
  );
}

export function computeGrandHallT554NativeReviewMaskSubjectV2Sha256(input: {
  readonly sourceReviewSubjectSha256: Sha256;
  readonly maskStateSha256: Sha256;
  readonly maskEvidenceSha256: Sha256;
  readonly implementationManifest: GrandHallT554NativeReviewImplementationManifestBindingV2;
}): Sha256 {
  return canonicalDigest(MASK_REVIEW_SUBJECT_DIGEST_DOMAIN, input);
}

function preparedMatchesFrozen(
  prepared: GrandHallT554NativeReviewPreparedMaskBindingV2,
  frozen: GrandHallT554NativeReviewFrozenMaskBindingV2,
): boolean {
  return canonicalEqual(
    prepared,
    preparedMaskEvidenceMaterialFromFrozen(frozen),
  );
}

function replaySessionCreated(
  scope: GrandHallT554NativeReviewSessionScopeV2,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "session.created.v2" }
  >,
): CoordinatorState {
  const payload = event.payload;
  binding(
    payload.sessionIdSha256 === scope.sessionIdSha256,
    "Created session identity differs from coordinator scope.",
  );
  binding(
    canonicalEqual(payload.registry, scope.registry),
    "Created registry differs from coordinator scope.",
  );
  binding(
    canonicalEqual(
      payload.implementationManifest,
      scope.implementationManifest,
    ),
    "Created implementation differs from coordinator scope.",
  );
  binding(
    canonicalEqual(payload.authorityBoundary, scope.authorityBoundary),
    "Created authority boundary differs from coordinator scope.",
  );
  return {
    scope,
    lifecycle: "active",
    workspaceRevision: 0,
    maximumAllocatedRenderGeneration: 0,
    browserEpoch: null,
    previousBrowserEpochNonceSha256: null,
    eventCount: 1,
    activeSource: null,
    pendingIntent: null,
    declaredChildLeafNames: new Set<string>(),
    operationIds: new Set<Sha256>(),
    browserEpochNonceHashes: new Set<Sha256>(),
    sourceEpochNonceHashes: new Set<Sha256>(),
    sourceEpochBindingHashes: new Set<Sha256>(),
    coverageSegmentIds: new Set<Sha256>(),
    childObligations: new Map<string, MutableChildObligation>(),
  };
}

function replayBrowserEpoch(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "session.browser-epoch-started.v2" }
  >,
): void {
  requireActive(state);
  const payload = event.payload;
  transition(
    payload.workspaceRevision === state.workspaceRevision,
    "Browser epoch workspace revision differs from coordinator replay.",
  );
  transition(
    payload.maximumAllocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration,
    "Browser epoch generation ceiling differs from coordinator replay.",
  );
  transition(
    !state.browserEpochNonceHashes.has(payload.browserEpochNonceSha256),
    "Browser epoch nonce hashes cannot be reused.",
  );
  if (state.browserEpoch === null) {
    transition(
      payload.reason === "session_created" &&
        payload.browserEpochNumber === 1 &&
        payload.previousBrowserEpochNonceSha256 === null,
      "The first browser epoch must be the exact session-created epoch.",
    );
  } else {
    transition(
      payload.reason === "crash_resume",
      "Only crash resume may rotate an existing browser epoch.",
    );
    transition(
      payload.browserEpochNumber === state.browserEpoch.number + 1,
      "Browser epoch numbers must advance exactly once.",
    );
    binding(
      payload.previousBrowserEpochNonceSha256 ===
        state.browserEpoch.nonceSha256,
      "Resumed browser epoch does not bind its predecessor.",
    );
  }
  state.browserEpochNonceHashes.add(payload.browserEpochNonceSha256);
  state.previousBrowserEpochNonceSha256 =
    payload.previousBrowserEpochNonceSha256;
  state.browserEpoch = {
    number: payload.browserEpochNumber,
    nonceSha256: payload.browserEpochNonceSha256,
  };
  state.eventCount += 1;
}

function replaySourceIntent(
  state: CoordinatorState,
  event: SourceSelectionIntendedEvent,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Source-selection intent uses a stale browser epoch.",
  );
  transition(
    payload.expectedWorkspaceRevision === state.workspaceRevision,
    "Source-selection intent workspace CAS is stale.",
  );
  transition(
    payload.previousRenderGeneration === state.maximumAllocatedRenderGeneration,
    "Source-selection intent generation predecessor is stale.",
  );
  transition(
    payload.allocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration + 1,
    "Source-selection intent must allocate the next global generation.",
  );
  transition(
    state.activeSource === null,
    "An active source must be explicitly abandoned before selecting another source.",
  );
  transition(
    payload.priorActiveSourceJournal === null,
    "A source-selection intent without an active source cannot name a prior journal.",
  );
  recordOperationId(state, payload.operationIdSha256);
  recordUniqueIdentity(
    state.sourceEpochNonceHashes,
    payload.sourceEpochNonceSha256,
    "Source epoch nonce hash",
  );
  recordUniqueIdentity(
    state.coverageSegmentIds,
    payload.coverageSegmentIdSha256,
    "Coverage segment identity",
  );
  declareChildObligation(state, {
    kind: "source",
    leafName: payload.childJournalLeafName,
    operationIdSha256: payload.operationIdSha256,
    declarationKind: "source_selection",
    browserEpochNonceSha256: payload.browserEpochNonceSha256,
    coverageSegmentIdSha256: payload.coverageSegmentIdSha256,
    allocatedRenderGeneration: payload.allocatedRenderGeneration,
  });
  state.maximumAllocatedRenderGeneration = payload.allocatedRenderGeneration;
  state.pendingIntent = { kind: "source_selection", payload };
  state.eventCount += 1;
}

function replaySourceCommit(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "source.selection-committed.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "source_selection",
    "Source-selection commit has no matching unresolved intent.",
  );
  const payload = event.payload;
  binding(
    payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Source-selection commit operation differs from its intent.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256 &&
      payload.browserEpochNonceSha256 ===
        pending.payload.browserEpochNonceSha256,
    "Source-selection commit uses a stale browser epoch.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.renderGeneration === pending.payload.allocatedRenderGeneration,
    "Source-selection commit generation differs from its allocation.",
  );
  binding(
    payload.coverageSegmentIdSha256 ===
      pending.payload.coverageSegmentIdSha256,
    "Source-selection commit coverage segment differs from its intent.",
  );
  binding(
    sameSource(payload.sourceCustody.source, pending.payload.source),
    "Source-selection commit source differs from its intent.",
  );
  binding(
    payload.sourceCustody.sourceEpochNonceSha256 ===
      pending.payload.sourceEpochNonceSha256,
    "Source-selection commit epoch differs from its intent.",
  );
  binding(
    payload.sourceCustody.sourceEpochRenderGeneration ===
      payload.renderGeneration,
    "Source-selection commit custody generation differs from its allocation.",
  );
  binding(
    payload.sourceJournal.leafName === pending.payload.childJournalLeafName,
    "Source-selection commit child differs from its declared journal.",
  );
  recordUniqueIdentity(
    state.sourceEpochBindingHashes,
    payload.sourceCustody.sourceEpochBindingSha256,
    "Source epoch binding",
  );
  resolveChildObligation(
    state,
    pending.payload.childJournalLeafName,
    "committed",
    payload.sourceJournal,
  );
  state.activeSource = {
    sourceCustody: payload.sourceCustody,
    sourceJournal: payload.sourceJournal,
    sourceCoverageSegmentIdSha256: payload.coverageSegmentIdSha256,
    phase: "source_review",
    renderGeneration: payload.renderGeneration,
    maskState: null,
    maskReviewSubjectSha256: null,
    frozenBindingSha256: null,
    frozenBinding: null,
    maskJournal: null,
    maskCoverageSegmentIdSha256: null,
  };
  state.pendingIntent = null;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replaySourceRecoveryAbort(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "source.selection-recovery-aborted.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "source_selection",
    "Source recovery-abort has no matching unresolved intent.",
  );
  const payload = event.payload;
  binding(
    payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Source recovery-abort operation differs from its intent.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Source recovery-abort must be owned by the current browser epoch.",
  );
  transition(
    payload.workspaceRevision === state.workspaceRevision,
    "Source recovery-abort cannot change the acknowledged workspace revision.",
  );
  transition(
    payload.consumedRenderGeneration ===
      pending.payload.allocatedRenderGeneration,
    "Source recovery-abort must retain the consumed generation.",
  );
  const abandoned = payload.recovery.abandonedChildJournal;
  if (abandoned !== null) {
    binding(
      abandoned.leafName === pending.payload.childJournalLeafName,
      "Source recovery-abort child differs from its declared journal.",
    );
  }
  resolveChildObligation(
    state,
    pending.payload.childJournalLeafName,
    abandoned === null
      ? "recovery_aborted_absent"
      : "recovery_aborted_present",
    abandoned,
  );
  state.pendingIntent = null;
  state.eventCount += 1;
}

function replayMaskWorkflowStarted(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "mask.workflow-started.v2" }
  >,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Mask workflow start uses a stale browser epoch.",
  );
  const active = requireCurrentSource(state, payload.sourceCustody);
  transition(
    active.phase === "source_review",
    "Mask workflow can begin only from source review.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.previousRenderGeneration === active.renderGeneration,
    "Mask workflow generation predecessor differs from the active source.",
  );
  transition(
    payload.resultingRenderGeneration ===
      state.maximumAllocatedRenderGeneration + 1,
    "Mask workflow must allocate the next global generation.",
  );
  binding(
    payload.completedSourceCoverage.sourceReviewSubjectSha256 ===
      active.sourceCustody.sourceReviewSubjectSha256,
    "Mask workflow completion proof belongs to a different source subject.",
  );
  binding(
    checkpointAdvances(
      active.sourceJournal,
      payload.completedSourceCoverage.sourceJournal,
    ),
    "Mask workflow source checkpoint does not advance the active child.",
  );
  referenceChildCheckpoint(
    state,
    payload.completedSourceCoverage.sourceJournal,
  );
  active.sourceJournal = payload.completedSourceCoverage.sourceJournal;
  active.phase = "mask_edit";
  active.renderGeneration = payload.resultingRenderGeneration;
  active.maskState = payload.initialMaskState;
  state.maximumAllocatedRenderGeneration = payload.resultingRenderGeneration;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayMaskEdit(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "mask.edited.v2" }
  >,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Mask edit uses a stale browser epoch.",
  );
  const active = requireCurrentSource(state, payload.sourceCustody);
  transition(
    active.phase === "mask_edit" || active.phase === "mask_review",
    "Mask edit requires an active mask workflow.",
  );
  transition(
    active.maskState !== null,
    "Mask edit requires a replayed prior mask state.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.previousRenderGeneration === active.renderGeneration,
    "Mask edit generation predecessor differs from the active phase.",
  );
  transition(
    payload.resultingRenderGeneration ===
      state.maximumAllocatedRenderGeneration + 1,
    "Mask edit must allocate the next global generation.",
  );
  binding(
    canonicalEqual(payload.previousMaskState, active.maskState),
    "Mask edit prior state differs from coordinator replay.",
  );
  recordOperationId(state, payload.operationIdSha256);
  if (active.phase === "mask_review") {
    binding(
      payload.invalidatedFrozenBindingSha256 === active.frozenBindingSha256,
      "Mask edit invalidates a different frozen binding.",
    );
    transition(
      active.maskJournal !== null && payload.invalidatedMaskJournal !== null,
      "Mask edit must bind the invalidated mask child.",
    );
    binding(
      checkpointAdvances(active.maskJournal, payload.invalidatedMaskJournal),
      "Mask edit invalidated checkpoint differs from the active mask child.",
    );
    referenceChildCheckpoint(state, payload.invalidatedMaskJournal);
  } else {
    transition(
      payload.invalidatedFrozenBindingSha256 === null &&
        payload.invalidatedMaskJournal === null,
      "Mask edit without a frozen review cannot claim invalidated evidence.",
    );
  }
  active.phase = "mask_edit";
  active.renderGeneration = payload.resultingRenderGeneration;
  active.maskState = payload.resultingMaskState;
  active.maskReviewSubjectSha256 = null;
  active.frozenBindingSha256 = null;
  active.frozenBinding = null;
  active.maskJournal = null;
  active.maskCoverageSegmentIdSha256 = null;
  state.maximumAllocatedRenderGeneration = payload.resultingRenderGeneration;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayMaskFreezeIntent(
  state: CoordinatorState,
  event: MaskFreezeIntendedEvent,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  const active = requireCurrentSource(state, payload.sourceCustody);
  transition(
    active.phase === "mask_edit" && active.maskState !== null,
    "Mask freeze intent requires an editable mask state.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Mask freeze intent uses a stale browser epoch.",
  );
  transition(
    payload.expectedWorkspaceRevision === state.workspaceRevision,
    "Mask freeze intent workspace CAS is stale.",
  );
  transition(
    payload.previousRenderGeneration === active.renderGeneration,
    "Mask freeze intent generation predecessor differs from the active phase.",
  );
  transition(
    payload.allocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration + 1,
    "Mask freeze intent must allocate the next global generation.",
  );
  binding(
    canonicalEqual(payload.maskState, active.maskState),
    "Mask freeze intent state differs from coordinator replay.",
  );
  binding(
    payload.preparedBinding.includedPixelCount ===
      active.maskState.includedPixelCount &&
      payload.preparedBinding.excludedPixelCount ===
        active.maskState.excludedPixelCount &&
      canonicalEqual(
        payload.preparedBinding.reasonCounts,
        active.maskState.reasonCounts,
      ),
    "Prepared mask evidence counts differ from the replayed mask state.",
  );
  derived(
    payload.preparedBindingSha256 ===
      computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256(
        payload.preparedBinding,
      ),
    "Prepared mask binding digest does not match its exact semantic material.",
  );
  const expectedSubject = computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
    sourceReviewSubjectSha256: active.sourceCustody.sourceReviewSubjectSha256,
    maskStateSha256: active.maskState.maskStateSha256,
    maskEvidenceSha256:
      computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256(
        payload.preparedBinding,
      ),
    implementationManifest: state.scope.implementationManifest,
  });
  derived(
    payload.maskReviewSubjectSha256 === expectedSubject,
    "Mask freeze intent subject does not match source, state, prepared bytes, and implementation.",
  );
  recordOperationId(state, payload.operationIdSha256);
  recordUniqueIdentity(
    state.coverageSegmentIds,
    payload.coverageSegmentIdSha256,
    "Coverage segment identity",
  );
  declareChildObligation(state, {
    kind: "mask",
    leafName: payload.childJournalLeafName,
    operationIdSha256: payload.operationIdSha256,
    declarationKind: "mask_freeze",
    browserEpochNonceSha256: payload.browserEpochNonceSha256,
    coverageSegmentIdSha256: payload.coverageSegmentIdSha256,
    allocatedRenderGeneration: payload.allocatedRenderGeneration,
  });
  state.maximumAllocatedRenderGeneration = payload.allocatedRenderGeneration;
  state.pendingIntent = { kind: "mask_freeze", payload };
  state.eventCount += 1;
}

function replayMaskFreezeCommit(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "mask.freeze-committed.v2" }
  >,
): void {
  requireActive(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "mask_freeze",
    "Mask freeze commit has no matching unresolved intent.",
  );
  const browser = requireBrowserEpoch(state);
  binding(
    pending.payload.browserEpochNonceSha256 === browser.nonceSha256,
    "A mask freeze intent from a stale browser epoch must be recovery-aborted.",
  );
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256 &&
      payload.browserEpochNonceSha256 ===
        pending.payload.browserEpochNonceSha256,
    "Mask freeze commit uses a stale browser epoch.",
  );
  const active = requireCurrentSource(state, payload.sourceCustody);
  transition(
    active.phase === "mask_edit" && active.maskState !== null,
    "Mask freeze commit requires its editable mask state.",
  );
  binding(
    payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Mask freeze commit operation differs from its intent.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.renderGeneration === pending.payload.allocatedRenderGeneration,
    "Mask freeze commit generation differs from its allocation.",
  );
  binding(
    payload.coverageSegmentIdSha256 ===
      pending.payload.coverageSegmentIdSha256,
    "Mask freeze commit coverage segment differs from its intent.",
  );
  binding(
    canonicalEqual(payload.maskState, pending.payload.maskState) &&
      canonicalEqual(payload.maskState, active.maskState),
    "Mask freeze commit state differs from its intent or coordinator replay.",
  );
  binding(
    payload.frozenBinding.includedPixelCount ===
      active.maskState.includedPixelCount &&
      payload.frozenBinding.excludedPixelCount ===
        active.maskState.excludedPixelCount &&
      canonicalEqual(
        payload.frozenBinding.reasonCounts,
        active.maskState.reasonCounts,
      ),
    "Frozen mask evidence counts differ from the replayed mask state.",
  );
  binding(
    payload.maskReviewSubjectSha256 === pending.payload.maskReviewSubjectSha256,
    "Mask freeze commit subject differs from its intent.",
  );
  derived(
    payload.frozenBindingSha256 ===
      computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256(
        payload.frozenBinding,
      ),
    "Frozen mask binding digest does not match its exact durable evidence.",
  );
  binding(
    preparedMatchesFrozen(
      pending.payload.preparedBinding,
      payload.frozenBinding,
    ),
    "Durable frozen mask evidence differs from the prepared intent bytes.",
  );
  const committedSubject = computeGrandHallT554NativeReviewMaskSubjectV2Sha256({
    sourceReviewSubjectSha256: active.sourceCustody.sourceReviewSubjectSha256,
    maskStateSha256: active.maskState.maskStateSha256,
    maskEvidenceSha256:
      computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256(
        payload.frozenBinding,
      ),
    implementationManifest: state.scope.implementationManifest,
  });
  derived(
    payload.maskReviewSubjectSha256 === committedSubject,
    "Committed mask subject does not match its durable frozen evidence.",
  );
  binding(
    payload.maskJournal.leafName === pending.payload.childJournalLeafName,
    "Mask freeze commit child differs from its declared journal.",
  );
  resolveChildObligation(
    state,
    pending.payload.childJournalLeafName,
    "committed",
    payload.maskJournal,
  );
  active.phase = "mask_review";
  active.renderGeneration = payload.renderGeneration;
  active.maskReviewSubjectSha256 = payload.maskReviewSubjectSha256;
  active.frozenBindingSha256 = payload.frozenBindingSha256;
  active.frozenBinding = payload.frozenBinding;
  active.maskJournal = payload.maskJournal;
  active.maskCoverageSegmentIdSha256 = payload.coverageSegmentIdSha256;
  state.pendingIntent = null;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayMaskFreezeRecoveryAbort(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "mask.freeze-recovery-aborted.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "mask_freeze",
    "Mask recovery-abort has no matching unresolved intent.",
  );
  const payload = event.payload;
  binding(
    payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Mask recovery-abort operation differs from its intent.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Mask recovery-abort must be owned by the current browser epoch.",
  );
  transition(
    payload.workspaceRevision === state.workspaceRevision,
    "Mask recovery-abort cannot change the acknowledged workspace revision.",
  );
  transition(
    payload.consumedRenderGeneration ===
      pending.payload.allocatedRenderGeneration,
    "Mask recovery-abort must retain the consumed generation.",
  );
  if (payload.abandonedMaskJournal !== null) {
    binding(
      payload.abandonedMaskJournal.leafName ===
        pending.payload.childJournalLeafName,
      "Mask recovery-abort child differs from its declared journal.",
    );
  }
  resolveChildObligation(
    state,
    pending.payload.childJournalLeafName,
    payload.abandonedMaskJournal === null
      ? "recovery_aborted_absent"
      : "recovery_aborted_present",
    payload.abandonedMaskJournal,
  );
  state.pendingIntent = null;
  state.eventCount += 1;
}

function assertSourceResumeCarry(
  state: CoordinatorState,
  active: ActiveSourceState,
  priorChildJournal: GrandHallT554NativeReviewSourceChildCheckpointV2,
  carry: GrandHallT554NativeReviewSourceCoverageCarryStateV2,
): void {
  binding(
    state.previousBrowserEpochNonceSha256 !== null &&
      carry.priorBrowserEpochNonceSha256 ===
        state.previousBrowserEpochNonceSha256,
    "Source resume carry does not bind the immediately preceding browser epoch.",
  );
  binding(
    canonicalEqual(carry.predecessorJournal, priorChildJournal),
    "Source resume carry differs from the exact finalized prior checkpoint.",
  );
  binding(
    carry.sessionIdSha256 === state.scope.sessionIdSha256 &&
      canonicalEqual(carry.registry, state.scope.registry) &&
      canonicalEqual(
        carry.implementationManifest,
        state.scope.implementationManifest,
      ),
    "Source resume carry differs from the session registry or implementation.",
  );
  binding(
    sameStableSourceCustody(carry.sourceCustody, active.sourceCustody) &&
      carry.subjectSha256 ===
        active.sourceCustody.sourceReviewSubjectSha256,
    "Source resume carry differs from the active stable source.",
  );
  binding(
    carry.priorSourceEpochBindingSha256 ===
      active.sourceCustody.sourceEpochBindingSha256 &&
      carry.priorSourceEpochNonceSha256 ===
        active.sourceCustody.sourceEpochNonceSha256 &&
      carry.priorSourceEpochRenderGeneration ===
        active.sourceCustody.sourceEpochRenderGeneration &&
      carry.priorCoverageSegmentIdSha256 ===
        active.sourceCoverageSegmentIdSha256 &&
      carry.priorRenderGeneration === active.renderGeneration,
    "Source resume carry does not bind the active epoch, segment, and visible generation.",
  );
}

function assertMaskResumeCarry(
  state: CoordinatorState,
  active: ActiveSourceState,
  priorChildJournal: GrandHallT554NativeReviewMaskChildCheckpointV2,
  carry: GrandHallT554NativeReviewMaskCoverageCarryStateV2,
): void {
  transition(
    active.maskState !== null &&
      active.maskJournal !== null &&
      active.maskCoverageSegmentIdSha256 !== null &&
      active.maskReviewSubjectSha256 !== null &&
      active.frozenBindingSha256 !== null &&
      active.frozenBinding !== null,
    "Mask resume carry requires a complete active frozen-review state.",
  );
  binding(
    state.previousBrowserEpochNonceSha256 !== null &&
      carry.priorBrowserEpochNonceSha256 ===
        state.previousBrowserEpochNonceSha256,
    "Mask resume carry does not bind the immediately preceding browser epoch.",
  );
  binding(
    canonicalEqual(carry.predecessorJournal, priorChildJournal),
    "Mask resume carry differs from the exact finalized prior checkpoint.",
  );
  binding(
    carry.sessionIdSha256 === state.scope.sessionIdSha256 &&
      canonicalEqual(carry.registry, state.scope.registry) &&
      canonicalEqual(
        carry.implementationManifest,
        state.scope.implementationManifest,
      ),
    "Mask resume carry differs from the session registry or implementation.",
  );
  binding(
    sameStableSourceCustody(carry.sourceCustody, active.sourceCustody) &&
      carry.subjectSha256 === active.maskReviewSubjectSha256 &&
      carry.maskStateSha256 === active.maskState.maskStateSha256 &&
      carry.frozenBindingSha256 === active.frozenBindingSha256 &&
      canonicalEqual(carry.frozenBinding, active.frozenBinding),
    "Mask resume carry differs from the active source, mask state, or frozen evidence.",
  );
  binding(
    carry.priorSourceEpochBindingSha256 ===
      active.sourceCustody.sourceEpochBindingSha256 &&
      carry.priorSourceEpochNonceSha256 ===
        active.sourceCustody.sourceEpochNonceSha256 &&
      carry.priorSourceEpochRenderGeneration ===
        active.sourceCustody.sourceEpochRenderGeneration &&
      carry.priorCoverageSegmentIdSha256 ===
        active.maskCoverageSegmentIdSha256 &&
      carry.priorRenderGeneration === active.renderGeneration,
    "Mask resume carry does not bind the active epoch, segment, and visible generation.",
  );
}

function replayCoverageSegmentResumeIntent(
  state: CoordinatorState,
  event: CoverageSegmentResumeIntendedEvent,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  const active = requireCurrentSource(state, payload.sourceCustodyBefore);
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Coverage resume intent uses a stale browser epoch.",
  );
  transition(
    payload.expectedWorkspaceRevision === state.workspaceRevision,
    "Coverage resume intent workspace CAS is stale.",
  );
  transition(
    payload.previousVisibleRenderGeneration === active.renderGeneration,
    "Coverage resume intent visible generation differs from the active phase.",
  );
  transition(
    payload.previousMaximumAllocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration,
    "Coverage resume intent allocation ceiling is stale.",
  );
  transition(
    payload.allocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration + 1,
    "Coverage resume intent must allocate the next global generation.",
  );
  binding(
    payload.newSourceEpochNonceSha256 !==
      active.sourceCustody.sourceEpochNonceSha256,
    "Coverage resume intent must allocate a fresh source epoch nonce.",
  );

  if (payload.kind === "source") {
    transition(
      active.phase === "source_review",
      "Source coverage resume requires the source-review phase.",
    );
    binding(
      checkpointAdvances(active.sourceJournal, payload.priorChildJournal),
      "Source coverage resume prior checkpoint differs from the active child.",
    );
    assertSourceResumeCarry(
      state,
      active,
      payload.priorChildJournal,
      payload.predecessorCoverage,
    );
    active.sourceJournal = payload.priorChildJournal;
  } else {
    transition(
      active.phase === "mask_review" &&
        active.maskState !== null &&
        active.maskJournal !== null &&
        active.maskReviewSubjectSha256 !== null &&
        active.frozenBindingSha256 !== null &&
        active.frozenBinding !== null,
      "Mask coverage resume requires a complete active frozen-review phase.",
    );
    binding(
      canonicalEqual(payload.maskState, active.maskState) &&
        payload.maskReviewSubjectSha256 ===
          active.maskReviewSubjectSha256 &&
        payload.frozenBindingSha256 === active.frozenBindingSha256 &&
        canonicalEqual(payload.frozenBinding, active.frozenBinding),
      "Mask coverage resume intent changes the active frozen-review state.",
    );
    binding(
      checkpointAdvances(active.maskJournal, payload.priorChildJournal),
      "Mask coverage resume prior checkpoint differs from the active child.",
    );
    assertMaskResumeCarry(
      state,
      active,
      payload.priorChildJournal,
      payload.predecessorCoverage,
    );
    active.maskJournal = payload.priorChildJournal;
  }

  referenceChildCheckpoint(state, payload.priorChildJournal);
  recordOperationId(state, payload.operationIdSha256);
  recordUniqueIdentity(
    state.sourceEpochNonceHashes,
    payload.newSourceEpochNonceSha256,
    "Source epoch nonce hash",
  );
  recordUniqueIdentity(
    state.coverageSegmentIds,
    payload.newCoverageSegmentIdSha256,
    "Coverage segment identity",
  );
  declareChildObligation(state, {
    kind: payload.kind,
    leafName: payload.childJournalLeafName,
    operationIdSha256: payload.operationIdSha256,
    declarationKind: "coverage_resume",
    browserEpochNonceSha256: payload.browserEpochNonceSha256,
    coverageSegmentIdSha256: payload.newCoverageSegmentIdSha256,
    allocatedRenderGeneration: payload.allocatedRenderGeneration,
  });
  state.maximumAllocatedRenderGeneration = payload.allocatedRenderGeneration;
  state.pendingIntent = { kind: "coverage_resume", payload };
  state.eventCount += 1;
}

function replayCoverageSegmentResumeCommit(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "coverage.segment-resume-committed.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "coverage_resume",
    "Coverage resume commit has no matching unresolved intent.",
  );
  const payload = event.payload;
  binding(
    payload.kind === pending.payload.kind &&
      payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Coverage resume commit kind or operation differs from its intent.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256 &&
      payload.browserEpochNonceSha256 ===
        pending.payload.browserEpochNonceSha256,
    "Coverage resume commit uses a stale browser epoch.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.renderGeneration === pending.payload.allocatedRenderGeneration,
    "Coverage resume commit generation differs from its allocation.",
  );
  binding(
    payload.coverageSegmentIdSha256 ===
      pending.payload.newCoverageSegmentIdSha256,
    "Coverage resume commit segment differs from its intent.",
  );
  const active = requireCurrentSource(
    state,
    pending.payload.sourceCustodyBefore,
  );
  binding(
    sameStableSourceCustody(
      payload.sourceCustody,
      pending.payload.sourceCustodyBefore,
    ) &&
      payload.sourceCustody.sourceEpochNonceSha256 ===
        pending.payload.newSourceEpochNonceSha256 &&
      payload.sourceCustody.sourceEpochBindingSha256 !==
        pending.payload.sourceCustodyBefore.sourceEpochBindingSha256 &&
      payload.sourceCustody.sourceEpochRenderGeneration ===
        payload.renderGeneration,
    "Coverage resume commit must retain stable custody with the exact fresh epoch.",
  );
  recordUniqueIdentity(
    state.sourceEpochBindingHashes,
    payload.sourceCustody.sourceEpochBindingSha256,
    "Source epoch binding",
  );

  if (payload.kind === "source") {
    transition(
      active.phase === "source_review" && pending.payload.kind === "source",
      "Source coverage resume commit requires a source resume intent.",
    );
    binding(
      payload.sourceJournal.leafName ===
        pending.payload.childJournalLeafName,
      "Source coverage resume commit child differs from its declaration.",
    );
    resolveChildObligation(
      state,
      pending.payload.childJournalLeafName,
      "committed",
      payload.sourceJournal,
    );
    active.sourceJournal = payload.sourceJournal;
    active.sourceCoverageSegmentIdSha256 =
      payload.coverageSegmentIdSha256;
  } else {
    transition(
      active.phase === "mask_review" && pending.payload.kind === "mask",
      "Mask coverage resume commit requires a mask resume intent.",
    );
    binding(
      canonicalEqual(payload.maskState, pending.payload.maskState) &&
        payload.maskReviewSubjectSha256 ===
          pending.payload.maskReviewSubjectSha256 &&
        payload.frozenBindingSha256 ===
          pending.payload.frozenBindingSha256 &&
        canonicalEqual(payload.frozenBinding, pending.payload.frozenBinding),
      "Mask coverage resume commit changes the frozen-review state.",
    );
    binding(
      payload.maskJournal.leafName === pending.payload.childJournalLeafName,
      "Mask coverage resume commit child differs from its declaration.",
    );
    resolveChildObligation(
      state,
      pending.payload.childJournalLeafName,
      "committed",
      payload.maskJournal,
    );
    active.maskJournal = payload.maskJournal;
    active.maskCoverageSegmentIdSha256 = payload.coverageSegmentIdSha256;
  }
  active.sourceCustody = payload.sourceCustody;
  active.renderGeneration = payload.renderGeneration;
  state.pendingIntent = null;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayCoverageSegmentResumeRecoveryAbort(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "coverage.segment-resume-recovery-aborted.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const pending = state.pendingIntent;
  transition(
    pending?.kind === "coverage_resume",
    "Coverage resume recovery-abort has no matching unresolved intent.",
  );
  const payload = event.payload;
  binding(
    payload.kind === pending.payload.kind &&
      payload.operationIdSha256 === pending.payload.operationIdSha256,
    "Coverage resume recovery-abort kind or operation differs from its intent.",
  );
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Coverage resume recovery-abort must use the current browser epoch.",
  );
  transition(
    payload.workspaceRevision === state.workspaceRevision,
    "Coverage resume recovery-abort cannot advance workspace revision.",
  );
  transition(
    payload.consumedRenderGeneration ===
      pending.payload.allocatedRenderGeneration,
    "Coverage resume recovery-abort must retain the consumed allocation.",
  );
  const abandoned = payload.recovery.abandonedChildJournal;
  if (abandoned !== null) {
    binding(
      abandoned.kind === pending.payload.kind &&
        abandoned.leafName === pending.payload.childJournalLeafName,
      "Coverage resume recovery-abort child differs from its declaration.",
    );
  }
  resolveChildObligation(
    state,
    pending.payload.childJournalLeafName,
    abandoned === null
      ? "recovery_aborted_absent"
      : "recovery_aborted_present",
    abandoned,
  );
  state.pendingIntent = null;
  state.eventCount += 1;
}

function replayMaskEditEpochResumed(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "mask.edit-epoch-resumed.v2" }
  >,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Mask-edit epoch resume uses a stale browser epoch.",
  );
  transition(
    state.previousBrowserEpochNonceSha256 !== null,
    "Mask-edit epoch resume requires a crash-rotated browser epoch.",
  );
  const active = requireCurrentSource(state, payload.sourceCustodyBefore);
  transition(
    active.phase === "mask_edit" && active.maskState !== null,
    "Mask-edit epoch resume requires an active editable mask.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.previousVisibleRenderGeneration === active.renderGeneration,
    "Mask-edit epoch resume visible generation differs from the active phase.",
  );
  transition(
    payload.previousMaximumAllocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration &&
      payload.resultingRenderGeneration ===
        state.maximumAllocatedRenderGeneration + 1,
    "Mask-edit epoch resume allocation ceiling is stale.",
  );
  binding(
    sameStableSourceCustody(payload.sourceCustody, active.sourceCustody) &&
      payload.sourceCustody.sourceEpochNonceSha256 !==
        active.sourceCustody.sourceEpochNonceSha256 &&
      payload.sourceCustody.sourceEpochBindingSha256 !==
        active.sourceCustody.sourceEpochBindingSha256 &&
      payload.sourceCustody.sourceEpochRenderGeneration ===
        payload.resultingRenderGeneration,
    "Mask-edit epoch resume must retain stable custody with a fresh epoch.",
  );
  recordOperationId(state, payload.operationIdSha256);
  recordUniqueIdentity(
    state.sourceEpochNonceHashes,
    payload.sourceCustody.sourceEpochNonceSha256,
    "Source epoch nonce hash",
  );
  recordUniqueIdentity(
    state.sourceEpochBindingHashes,
    payload.sourceCustody.sourceEpochBindingSha256,
    "Source epoch binding",
  );
  active.sourceCustody = payload.sourceCustody;
  active.renderGeneration = payload.resultingRenderGeneration;
  state.maximumAllocatedRenderGeneration = payload.resultingRenderGeneration;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replaySourceAbandoned(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "source.abandoned.v2" }
  >,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Source abandon uses a stale browser epoch.",
  );
  const active = requireCurrentSource(state, payload.sourceCustody);
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    payload.finalRenderGeneration === active.renderGeneration,
    "Abandoned source generation differs from the active phase.",
  );
  binding(
    checkpointAdvances(active.sourceJournal, payload.sourceJournal),
    "Abandoned source checkpoint differs from its active child.",
  );
  referenceChildCheckpoint(state, payload.sourceJournal);
  if (active.phase === "mask_review") {
    transition(
      active.maskJournal !== null && payload.maskJournal !== null,
      "Abandoning mask review must bind its active mask child.",
    );
    binding(
      checkpointAdvances(active.maskJournal, payload.maskJournal),
      "Abandoned mask checkpoint differs from its active child.",
    );
    referenceChildCheckpoint(state, payload.maskJournal);
  } else {
    transition(
      payload.maskJournal === null,
      "Abandoning a non-review mask phase cannot name a mask child.",
    );
  }
  state.activeSource = null;
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayStopped(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "session.stopped.v2" }
  >,
): void {
  requireActive(state);
  requireNoPendingIntent(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Session stop uses a stale browser epoch.",
  );
  requireWorkspace(
    state,
    payload.previousWorkspaceRevision,
    payload.resultingWorkspaceRevision,
  );
  transition(
    state.activeSource === null && !payload.activeSourceWasPresent,
    "Session stop requires an explicit source-abandon event first.",
  );
  binding(
    canonicalEqual(payload.authorityBoundary, state.scope.authorityBoundary),
    "Stopped authority boundary differs from coordinator scope.",
  );
  state.lifecycle = "stopped";
  state.workspaceRevision = payload.resultingWorkspaceRevision;
  state.eventCount += 1;
}

function replayPoisoned(
  state: CoordinatorState,
  event: Extract<
    GrandHallT554NativeReviewCoordinatorEventV2,
    { readonly eventType: "session.poisoned.v2" }
  >,
): void {
  requireActive(state);
  const browser = requireBrowserEpoch(state);
  const payload = event.payload;
  binding(
    payload.browserEpochNonceSha256 === browser.nonceSha256,
    "Session poison uses a stale browser epoch.",
  );
  transition(
    payload.workspaceRevision === state.workspaceRevision,
    "Poison evidence must retain the last acknowledged workspace revision.",
  );
  transition(
    payload.maximumAllocatedRenderGeneration ===
      state.maximumAllocatedRenderGeneration,
    "Poison evidence generation ceiling differs from coordinator replay.",
  );
  binding(
    canonicalEqual(payload.authorityBoundary, state.scope.authorityBoundary),
    "Poisoned authority boundary differs from coordinator scope.",
  );
  state.lifecycle = "poisoned";
  state.eventCount += 1;
}

function replayEvent(
  state: CoordinatorState,
  event: GrandHallT554NativeReviewCoordinatorEventV2,
): void {
  switch (event.eventType) {
    case "session.created.v2":
      throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
        "TRANSITION_INVALID",
        "Coordinator replay contains a second session-created event.",
      );
    case "session.browser-epoch-started.v2":
      replayBrowserEpoch(state, event);
      return;
    case "source.selection-intended.v2":
      replaySourceIntent(state, event);
      return;
    case "source.selection-committed.v2":
      replaySourceCommit(state, event);
      return;
    case "source.selection-recovery-aborted.v2":
      replaySourceRecoveryAbort(state, event);
      return;
    case "mask.workflow-started.v2":
      replayMaskWorkflowStarted(state, event);
      return;
    case "mask.edited.v2":
      replayMaskEdit(state, event);
      return;
    case "mask.freeze-intended.v2":
      replayMaskFreezeIntent(state, event);
      return;
    case "mask.freeze-committed.v2":
      replayMaskFreezeCommit(state, event);
      return;
    case "mask.freeze-recovery-aborted.v2":
      replayMaskFreezeRecoveryAbort(state, event);
      return;
    case "coverage.segment-resume-intended.v2":
      replayCoverageSegmentResumeIntent(state, event);
      return;
    case "coverage.segment-resume-committed.v2":
      replayCoverageSegmentResumeCommit(state, event);
      return;
    case "coverage.segment-resume-recovery-aborted.v2":
      replayCoverageSegmentResumeRecoveryAbort(state, event);
      return;
    case "mask.edit-epoch-resumed.v2":
      replayMaskEditEpochResumed(state, event);
      return;
    case "source.abandoned.v2":
      replaySourceAbandoned(state, event);
      return;
    case "session.stopped.v2":
      replayStopped(state, event);
      return;
    case "session.poisoned.v2":
      replayPoisoned(state, event);
      return;
  }
}

function publicReplay(
  state: CoordinatorState,
): GrandHallT554NativeReviewCoordinatorReplayV2 {
  const pending =
    state.pendingIntent === null
      ? null
      : {
          kind: state.pendingIntent.kind,
          operationIdSha256: state.pendingIntent.payload.operationIdSha256,
          allocatedRenderGeneration:
            state.pendingIntent.payload.allocatedRenderGeneration,
          childJournalLeafName:
            state.pendingIntent.payload.childJournalLeafName,
        };
  return frozenClone({
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-coordinator-replay.v2" as const,
    lifecycle: state.lifecycle,
    sessionIdSha256: state.scope.sessionIdSha256,
    registry: state.scope.registry,
    implementationManifest: state.scope.implementationManifest,
    authorityBoundary: state.scope.authorityBoundary,
    workspaceRevision: state.workspaceRevision,
    maximumAllocatedRenderGeneration: state.maximumAllocatedRenderGeneration,
    browserEpoch: state.browserEpoch,
    eventCount: state.eventCount,
    activeSource: state.activeSource,
    pendingIntent: pending,
    declaredChildLeafNames: [...state.declaredChildLeafNames].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    childObligations: [...state.childObligations.values()]
      .sort((left, right) =>
        left.leafName < right.leafName
          ? -1
          : left.leafName > right.leafName
            ? 1
            : 0,
      )
      .map((obligation) => ({
        ...obligation,
        checkpointReferences: [...obligation.checkpointReferences],
      })),
  });
}

export function replayGrandHallT554NativeReviewCoordinatorV2(input: {
  readonly scope: unknown;
  readonly events: readonly unknown[];
}): GrandHallT554NativeReviewCoordinatorReplayV2 {
  const scopeResult = GrandHallT554NativeReviewSessionScopeV2Schema.safeParse(
    input.scope,
  );
  if (!scopeResult.success) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "ARGUMENT_INVALID",
      "Coordinator scope is not the exact session v2 schema.",
      scopeResult.error,
    );
  }
  if (input.events.length < 1) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "ARGUMENT_INVALID",
      "Coordinator replay requires its session-created event.",
    );
  }
  if (input.events.length > MAXIMUM_COORDINATOR_EVENT_COUNT) {
    throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
      "EVENT_LIMIT_REACHED",
      "Coordinator event inventory exceeds its fixed replay bound.",
    );
  }
  const parsed = input.events.map((value, index) => {
    const result =
      GrandHallT554NativeReviewCoordinatorEventV2Schema.safeParse(value);
    if (!result.success) {
      throw new GrandHallT554NativeReviewCoordinatorReplayV2Error(
        "EVENT_INVALID",
        `Coordinator event ${String(index + 1)} is not an exact typed v2 event.`,
        result.error,
      );
    }
    return result.data;
  });
  const first = parsed[0];
  transition(
    first?.eventType === "session.created.v2",
    "Coordinator replay must begin with exactly one session-created event.",
  );
  const state = replaySessionCreated(scopeResult.data, first);
  for (const event of parsed.slice(1)) replayEvent(state, event);
  return publicReplay(state);
}

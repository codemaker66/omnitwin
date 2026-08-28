/**
 * Deliberately narrow compiled entry for the authority-none T-554 review core.
 *
 * This module exposes deterministic validation, replay, durable-store, and
 * exact replay surfaces only. It does not expose an HTTP listener, browser
 * launcher, acceptance path, reconstruction path, runtime-admission path,
 * evidence export, or production factory.
 */
export const GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_CORE_ENTRY_V1 =
  "venviewer.grand-hall-t554-native-review-compiled-core-entry.v1";

export const GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_CORE_AUTHORITY =
  Object.freeze({
    authority: "none" as const,
    acceptanceAuthorized: false as const,
    browserControlledTruthAuthorized: false as const,
    exportAuthorized: false as const,
    generatedContentAuthorized: false as const,
    httpLaunchIncluded: false as const,
    productionFactoryIncluded: false as const,
    reconstructionAuthorized: false as const,
    runtimeAdmissionAuthorized: false as const,
  });

export {
  GrandHallT554NativeReviewDurableJournalV2Error,
  deriveGrandHallT554NativeReviewLowLevelScopeV2,
  deriveGrandHallT554NativeReviewVerifiedDurableChildPrefixEvidenceV2,
  isGrandHallT554NativeReviewVerifiedDurableChildJournalEvidenceV2,
} from "./grand-hall-t554-native-review-durable-journal-v2.js";

export {
  GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2,
  GrandHallT554NativeReviewChildEventV2Schema,
  GrandHallT554NativeReviewCoordinatorEventV2Schema,
  GrandHallT554NativeReviewDomainEventV2Schema,
  GrandHallT554NativeReviewJournalScopeV2Schema,
  GrandHallT554NativeReviewMaskEditV2Schema,
  GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
  GrandHallT554NativeReviewScopedEventV2Schema,
  GrandHallT554NativeReviewTileDeliveredPayloadV2Schema,
} from "./grand-hall-t554-native-review-events-v2.js";

export {
  GrandHallT554NativeReviewCoordinatorReplayV2Error,
  computeGrandHallT554NativeReviewFrozenMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewFrozenMaskEvidenceV2Sha256,
  computeGrandHallT554NativeReviewMaskSubjectV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskBindingV2Sha256,
  computeGrandHallT554NativeReviewPreparedMaskEvidenceV2Sha256,
  replayGrandHallT554NativeReviewCoordinatorV2,
} from "./grand-hall-t554-native-review-coordinator-replay-v2.js";

export {
  GrandHallT554NativeReviewReplayV2Error,
  computeGrandHallT554NativeReviewCoverageEventV2Sha256,
  createGrandHallT554NativeReviewCoverageCarryStateV2,
  emptyGrandHallT554NativeReviewDwellVectorV2,
  emptyGrandHallT554NativeReviewTileBitmapV2,
  isGrandHallT554NativeReviewSha256V2,
  replayGrandHallT554NativeReviewMaskChildV2,
  replayGrandHallT554NativeReviewSourceChildV2,
  validateGrandHallT554NativeReviewMaskChildSequenceV2,
  validateGrandHallT554NativeReviewSourceChildSequenceV2,
} from "./grand-hall-t554-native-review-replay-v2.js";

export {
  GRAND_HALL_T554_NATIVE_MASK_REPLAY_CONTEXT_V2,
  GRAND_HALL_T554_NATIVE_MASK_REPLAY_V2,
  GrandHallT554NativeMaskReplayContextV2Schema,
  GrandHallT554NativeMaskReplayV2Error,
  verifyGrandHallT554NativeMaskStateReplayV2,
} from "./grand-hall-t554-native-review-mask-replay-v2.js";

export {
  GRAND_HALL_T554_NATIVE_REVIEW_PRIOR_OWNER_WITNESS_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SESSION_OWNER_LEASE_V2,
  GrandHallT554NativeReviewSessionOwnerV2Error,
  acquireGrandHallT554NativeReviewSessionOwnerV2,
  assertGrandHallT554NativeReviewSessionOwnerV2,
  explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2,
  inspectGrandHallT554NativeReviewPriorOwnerV2,
  releaseGrandHallT554NativeReviewSessionOwnerV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";

export type {
  GrandHallT554NativeReviewPriorOwnerWitnessV2,
  GrandHallT554NativeReviewSessionOwnerLeaseV2,
} from "./grand-hall-t554-native-review-session-owner-v2.js";

export {
  GRAND_HALL_T554_NATIVE_REVIEW_SESSION_ROOT_DESCRIPTOR_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SESSION_STORE_REPLAY_V2,
  GrandHallT554NativeReviewSessionStoreV2Error,
  openGrandHallT554NativeReviewSessionStoreV2,
} from "./grand-hall-t554-native-review-session-store-v2.js";

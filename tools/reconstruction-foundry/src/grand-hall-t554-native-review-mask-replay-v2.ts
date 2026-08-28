import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { GrandHallPanoramaSourceJpgIdentityV2Schema } from "@omnitwin/types";
import { z } from "zod";

import {
  GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  GrandHallT554NativeReviewMaskEditedEventV2Schema,
  GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
  GrandHallT554NativeReviewRegistryBindingV2Schema,
  GrandHallT554NativeReviewSha256V2Schema,
  GrandHallT554NativeReviewSourceVerificationV2Schema,
  type GrandHallT554NativeReviewCoordinatorEventV2,
  type GrandHallT554NativeReviewMaskStateEvidenceV2,
} from "./grand-hall-t554-native-review-events-v2.js";
import {
  GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION,
  GrandHallT554NativeMaskRevisionStore,
  GrandHallT554NativeMaskStoreError,
  type GrandHallT554NativeMaskExactStateV2,
} from "./grand-hall-t554-native-review-mask-store.js";

export const GRAND_HALL_T554_NATIVE_MASK_REPLAY_CONTEXT_V2 =
  "venviewer.grand-hall-t554-native-mask-replay-context.v2";
export const GRAND_HALL_T554_NATIVE_MASK_REPLAY_V2 =
  "venviewer.grand-hall-t554-native-mask-replay.v2";

export type GrandHallT554NativeMaskReplayV2ErrorCode =
  | "INPUT_INVALID"
  | "CONTEXT_MISMATCH"
  | "SEQUENCE_DISCONTINUITY"
  | "STATE_MISMATCH"
  | "EDIT_REJECTED"
  | "RASTERIZER_FAILED";

export class GrandHallT554NativeMaskReplayV2Error extends Error {
  constructor(
    readonly code: GrandHallT554NativeMaskReplayV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeMaskReplayV2Error";
  }
}

export const GrandHallT554NativeMaskReplayContextV2Schema = z
  .object({
    schemaVersion: z.literal(
      GRAND_HALL_T554_NATIVE_MASK_REPLAY_CONTEXT_V2,
    ),
    sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
    implementationManifest:
      GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceVerification: GrandHallT554NativeReviewSourceVerificationV2Schema,
    sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
  })
  .strict()
  .superRefine((context, refinement) => {
    if (
      context.source.fileName !== context.sourceVerification.fileName ||
      context.source.sha256 !== context.sourceVerification.sha256 ||
      context.source.byteLength !== context.sourceVerification.byteLength
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceVerification"],
        message:
          "mask replay source verification must bind the exact source bytes",
      });
    }
  });

export type GrandHallT554NativeMaskReplayContextV2 = z.infer<
  typeof GrandHallT554NativeMaskReplayContextV2Schema
>;

type MaskEditedEventV2 = Extract<
  GrandHallT554NativeReviewCoordinatorEventV2,
  { readonly eventType: "mask.edited.v2" }
>;

const MaskReplayInputV2Schema = z
  .object({
    context: GrandHallT554NativeMaskReplayContextV2Schema,
    initialMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    events: z
      .array(GrandHallT554NativeReviewMaskEditedEventV2Schema)
      .max(GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION),
  })
  .strict();

type MaskReplayInputV2 = z.infer<typeof MaskReplayInputV2Schema>;

export interface GrandHallT554NativeMaskReplayV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_MASK_REPLAY_V2;
  readonly context: GrandHallT554NativeMaskReplayContextV2;
  readonly editCount: number;
  readonly initialState: GrandHallT554NativeMaskExactStateV2;
  readonly states: readonly GrandHallT554NativeMaskExactStateV2[];
  readonly finalState: GrandHallT554NativeMaskExactStateV2;
}

function fail(
  code: GrandHallT554NativeMaskReplayV2ErrorCode,
  message: string,
  cause?: unknown,
): GrandHallT554NativeMaskReplayV2Error {
  return new GrandHallT554NativeMaskReplayV2Error(code, message, cause);
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

function evidenceFromExactState(
  state: GrandHallT554NativeMaskExactStateV2,
): GrandHallT554NativeReviewMaskStateEvidenceV2 {
  return {
    revision: state.revision,
    maskStateSha256: state.maskStateSha256,
    includedPixelCount: state.includedPixelCount,
    excludedPixelCount: state.excludedPixelCount,
    reasonCounts: [...state.reasonCounts],
  };
}

function assertExactClaim(
  claim: GrandHallT554NativeReviewMaskStateEvidenceV2,
  exact: GrandHallT554NativeMaskExactStateV2,
  label: string,
): void {
  if (!canonicalEqual(claim, evidenceFromExactState(exact))) {
    throw fail(
      "STATE_MISMATCH",
      `${label} differs from the exact context-bound raster replay.`,
    );
  }
}

function assertEventContext(
  event: MaskEditedEventV2,
  context: GrandHallT554NativeMaskReplayContextV2,
  index: number,
): void {
  const custody = event.payload.sourceCustody;
  if (
    !canonicalEqual(custody.source, context.source) ||
    !canonicalEqual(custody.sourceVerification, context.sourceVerification) ||
    custody.sourceReviewSubjectSha256 !== context.sourceReviewSubjectSha256
  ) {
    throw fail(
      "CONTEXT_MISMATCH",
      `Mask edit ${String(index)} carries different stable source custody.`,
    );
  }
}

function applyExactEdit(
  store: GrandHallT554NativeMaskRevisionStore,
  event: MaskEditedEventV2,
  index: number,
): void {
  try {
    store.applyEdit(event.payload.edit);
  } catch (error) {
    if (
      error instanceof GrandHallT554NativeMaskStoreError &&
      error.code === "REVISION_CONFLICT"
    ) {
      throw fail(
        "SEQUENCE_DISCONTINUITY",
        `Mask edit ${String(index)} does not continue the exact revision.`,
        error,
      );
    }
    throw fail(
      "EDIT_REJECTED",
      `Mask edit ${String(index)} was rejected by the deterministic rasterizer.`,
      error,
    );
  }
}

function parseReplayInput(input: unknown): MaskReplayInputV2 {
  const parsed = MaskReplayInputV2Schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw fail(
    "INPUT_INVALID",
    "Mask replay input is not the exact strict v2 schema.",
    parsed.error,
  );
}

function createReplayStore(
  input: MaskReplayInputV2,
): GrandHallT554NativeMaskRevisionStore {
  try {
    return GrandHallT554NativeMaskRevisionStore.createReplayOnly(
      input.context.source,
    );
  } catch (error) {
    throw fail(
      "INPUT_INVALID",
      "Mask replay source is invalid.",
      error,
    );
  }
}

function replayEditSequence(
  store: GrandHallT554NativeMaskRevisionStore,
  input: MaskReplayInputV2,
  initialState: GrandHallT554NativeMaskExactStateV2,
): readonly GrandHallT554NativeMaskExactStateV2[] {
  const states: GrandHallT554NativeMaskExactStateV2[] = [initialState];
  const operationIds = new Set<string>();
  let priorEvent: MaskEditedEventV2 | undefined;
  for (const [zeroBasedIndex, event] of input.events.entries()) {
    const eventIndex = zeroBasedIndex + 1;
    const prior = states.at(-1);
    if (prior === undefined) {
      throw fail("RASTERIZER_FAILED", "Exact replay lost its prior state.");
    }
    assertEventContext(event, input.context, eventIndex);
    if (operationIds.has(event.payload.operationIdSha256)) {
      throw fail(
        "SEQUENCE_DISCONTINUITY",
        `Mask edit ${String(eventIndex)} repeats an operation identifier.`,
      );
    }
    operationIds.add(event.payload.operationIdSha256);
    if (
      priorEvent !== undefined &&
      (
        event.payload.previousWorkspaceRevision <
          priorEvent.payload.resultingWorkspaceRevision ||
        event.payload.previousRenderGeneration <
          priorEvent.payload.resultingRenderGeneration
      )
    ) {
      throw fail(
        "SEQUENCE_DISCONTINUITY",
        `Mask edit ${String(eventIndex)} regresses coordinator-owned workspace or render metadata.`,
      );
    }
    if (
      event.payload.edit.expectedRevision !== prior.revision ||
      event.payload.previousMaskState.revision !== prior.revision ||
      event.payload.resultingMaskState.revision !== prior.revision + 1
    ) {
      throw fail(
        "SEQUENCE_DISCONTINUITY",
        `Mask edit ${String(eventIndex)} does not advance exactly one revision.`,
      );
    }
    assertExactClaim(
      event.payload.previousMaskState,
      prior,
      `Mask edit ${String(eventIndex)} previousMaskState`,
    );
    applyExactEdit(store, event, eventIndex);
    const resulting = store.exactStateV2(input.context);
    assertExactClaim(
      event.payload.resultingMaskState,
      resulting,
      `Mask edit ${String(eventIndex)} resultingMaskState`,
    );
    states.push(resulting);
    priorEvent = event;
  }
  return states;
}

function verifyWithStore(
  store: GrandHallT554NativeMaskRevisionStore,
  input: MaskReplayInputV2,
): GrandHallT554NativeMaskReplayV2 {
  const initialState = store.exactStateV2(input.context);
  if (input.initialMaskState.revision !== initialState.revision) {
    throw fail(
      "SEQUENCE_DISCONTINUITY",
      "Claimed initial mask revision is not revision zero.",
    );
  }
  assertExactClaim(
    input.initialMaskState,
    initialState,
    "Claimed initial mask state",
  );
  const states = replayEditSequence(store, input, initialState);
  const finalState = states.at(-1);
  if (finalState === undefined) {
    throw fail("RASTERIZER_FAILED", "Exact replay produced no mask state.");
  }
  return frozenClone({
    schemaVersion: GRAND_HALL_T554_NATIVE_MASK_REPLAY_V2,
    context: input.context,
    editCount: input.events.length,
    initialState,
    states,
    finalState,
  });
}

/**
 * Verifies the deterministic raster claims of mask.edited.v2 events.
 *
 * This verifier must be composed only after the coordinator has validated the
 * complete journal. It intentionally cannot authenticate coordinator-owned
 * browser epochs, interleaved workspace events, or invalidation lineage from a
 * mask-only subsequence. The local monotonicity and operation-ID checks below
 * are defence in depth, not a replacement for coordinator validation.
 */
export function verifyGrandHallT554NativeMaskStateReplayV2(
  input: unknown,
): GrandHallT554NativeMaskReplayV2 {
  const parsed = parseReplayInput(input);
  const store = createReplayStore(parsed);
  let result: GrandHallT554NativeMaskReplayV2 | undefined;
  let primaryError: GrandHallT554NativeMaskReplayV2Error | undefined;
  try {
    result = verifyWithStore(store, parsed);
  } catch (error) {
    primaryError = error instanceof GrandHallT554NativeMaskReplayV2Error
      ? error
      : fail(
        "RASTERIZER_FAILED",
        "Exact mask replay failed closed.",
        error,
      );
  }

  let cleanupError: unknown;
  try {
    store.abandon();
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) {
    throw fail(
      "RASTERIZER_FAILED",
      "Exact mask replay cleanup failed closed.",
      cleanupError,
    );
  }
  if (result === undefined) {
    throw fail("RASTERIZER_FAILED", "Exact mask replay produced no result.");
  }
  return result;
}

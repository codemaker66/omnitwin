import { types as nodeUtilTypes } from "node:util";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT = 4096;

export const FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_FRAME_KINDS = Object.freeze([
  "runner_context",
  "source_opened",
  "worker_started",
  "stdout_chunk",
  "stderr_chunk",
  "output_handle_closed",
  "worker_manifest",
  "worker_exited",
  "spool_frozen",
  "runner_terminal",
] as const);

export type FoundryActivationV1RunnerTranscriptFrameKind =
  (typeof FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_FRAME_KINDS)[number];

export type FoundryActivationV1RunnerTerminalOutcome = "succeeded" | "failed";

export type FoundryActivationV1RunnerTranscriptReachedState =
  | "runner_context"
  | "source_opened"
  | "worker_started_or_chunk"
  | "output_handle_closed"
  | "worker_manifest"
  | "worker_exited"
  | "spool_frozen";

export const FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES = Object.freeze({
  inputShapeInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_INPUT_SHAPE_INVALID",
  outcomeInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_OUTCOME_INVALID",
  frameArrayInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ARRAY_INVALID",
  frameCountInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_COUNT_INVALID",
  frameKindInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_KIND_INVALID",
  contextRequired: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_CONTEXT_REQUIRED",
  terminalRequired: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_TERMINAL_REQUIRED",
  terminalNotLast: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_TERMINAL_NOT_LAST",
  transitionInvalid: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_TRANSITION_INVALID",
  successIncomplete: "FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_SUCCESS_INCOMPLETE",
} as const);

export type FoundryActivationV1RunnerFrameOrderErrorCode =
  (typeof FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES)[keyof typeof FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES];

export interface FoundryActivationV1RunnerFrameOrderInput {
  readonly terminalOutcome: FoundryActivationV1RunnerTerminalOutcome;
  readonly frameKinds: readonly FoundryActivationV1RunnerTranscriptFrameKind[];
}

export interface FoundryActivationV1RunnerFrameOrderAnalysis {
  readonly schemaVersion: "omnitwin.foundry.activation-v1-runner-frame-order-analysis.v0";
  readonly authority: "none";
  readonly validationScope: "context_established_frame_kind_order_only";
  readonly rawTranscriptBytes: "not_validated";
  readonly framePayloadsAndHashes: "not_validated";
  readonly failureMatrix: "not_validated";
  readonly semanticReceipt: "not_validated";
  readonly terminalOutcome: FoundryActivationV1RunnerTerminalOutcome;
  readonly frameKinds: readonly FoundryActivationV1RunnerTranscriptFrameKind[];
  readonly frameCount: string;
  readonly stdoutChunkCount: string;
  readonly stderrChunkCount: string;
  readonly manifestFrameCount: "0" | "1";
  readonly lastNonterminalFrameKind: Exclude<
    FoundryActivationV1RunnerTranscriptFrameKind,
    "runner_terminal"
  >;
  readonly reachedState: FoundryActivationV1RunnerTranscriptReachedState;
}

type AutomatonState =
  | "start"
  | "context"
  | "source"
  | "worker"
  | "output_closed"
  | "manifest"
  | "worker_exited"
  | "spool_frozen"
  | "terminal";

const ERROR = FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES;
const FRAME_KIND_SET = new Set<string>(FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_FRAME_KINDS);
const EXPECTED_INPUT_KEYS = Object.freeze(["frameKinds", "terminalOutcome"] as const);

function fail(code: FoundryActivationV1RunnerFrameOrderErrorCode, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function isPlainUnproxiedObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || nodeUtilTypes.isProxy(value) || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function requireExactInputObject(input: unknown): Record<string, unknown> {
  if (!isPlainUnproxiedObject(input)) {
    fail(ERROR.inputShapeInvalid, "Runner frame-order input must be one plain, unproxied data object.");
  }
  const actualKeys = Reflect.ownKeys(input);
  if (
    actualKeys.length !== EXPECTED_INPUT_KEYS.length ||
    EXPECTED_INPUT_KEYS.some((key) => !actualKeys.includes(key))
  ) {
    fail(ERROR.inputShapeInvalid, "Runner frame-order input must contain exactly frameKinds and terminalOutcome.");
  }
  for (const key of EXPECTED_INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail(ERROR.inputShapeInvalid, "Runner frame-order input members must be enumerable own data properties.");
    }
  }
  return input;
}

function snapshotFrameKinds(input: unknown): readonly FoundryActivationV1RunnerTranscriptFrameKind[] {
  if (
    nodeUtilTypes.isProxy(input) ||
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype
  ) {
    fail(ERROR.frameArrayInvalid, "Runner frame kinds must be one ordinary, unproxied dense data array.");
  }
  if (
    input.length === 0 ||
    input.length > FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT
  ) {
    fail(
      ERROR.frameCountInvalid,
      `Runner transcripts must contain 1-${String(FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT)} frame kinds.`,
    );
  }
  const allowedKeys = new Set<string>(["length"]);
  const output: FoundryActivationV1RunnerTranscriptFrameKind[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail(ERROR.frameArrayInvalid, "Runner frame kinds must be a dense array of enumerable data elements.");
    }
    if (typeof descriptor.value !== "string" || !FRAME_KIND_SET.has(descriptor.value)) {
      fail(ERROR.frameKindInvalid, `Runner transcript frame ${String(index)} has an unknown frame kind.`);
    }
    output.push(descriptor.value as FoundryActivationV1RunnerTranscriptFrameKind);
  }
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
    fail(ERROR.frameArrayInvalid, "Runner frame-kind arrays cannot carry additional properties.");
  }
  return Object.freeze(output);
}

function snapshotInput(input: unknown): {
  readonly terminalOutcome: FoundryActivationV1RunnerTerminalOutcome;
  readonly frameKinds: readonly FoundryActivationV1RunnerTranscriptFrameKind[];
} {
  const object = requireExactInputObject(input);
  const outcome = object.terminalOutcome;
  if (outcome !== "succeeded" && outcome !== "failed") {
    fail(ERROR.outcomeInvalid, "Runner terminal outcome must be exactly succeeded or failed.");
  }
  return Object.freeze({
    terminalOutcome: outcome,
    frameKinds: snapshotFrameKinds(object.frameKinds),
  });
}

function transitionNonterminal(
  state: AutomatonState,
  frameKind: Exclude<FoundryActivationV1RunnerTranscriptFrameKind, "runner_terminal">,
  outcome: FoundryActivationV1RunnerTerminalOutcome,
): AutomatonState {
  if (state === "start" && frameKind === "runner_context") return "context";
  if (state === "context" && frameKind === "source_opened") return "source";
  if (state === "source" && frameKind === "worker_started") return "worker";
  if (state === "worker" && (frameKind === "stdout_chunk" || frameKind === "stderr_chunk")) {
    return "worker";
  }
  if (state === "worker" && frameKind === "output_handle_closed") return "output_closed";
  if (state === "output_closed" && frameKind === "worker_manifest") return "manifest";
  if (
    frameKind === "worker_exited" &&
    (
      state === "manifest" ||
      (outcome === "failed" && (state === "worker" || state === "output_closed"))
    )
  ) {
    return "worker_exited";
  }
  if (state === "worker_exited" && frameKind === "spool_frozen") return "spool_frozen";
  fail(
    ERROR.transitionInvalid,
    `Runner transcript cannot transition from ${state} with frame kind ${frameKind} for outcome ${outcome}.`,
  );
}

function reachedState(state: Exclude<AutomatonState, "start" | "terminal">): FoundryActivationV1RunnerTranscriptReachedState {
  if (state === "context") return "runner_context";
  if (state === "source") return "source_opened";
  if (state === "worker") return "worker_started_or_chunk";
  if (state === "output_closed") return "output_handle_closed";
  if (state === "manifest") return "worker_manifest";
  return state;
}

/**
 * Validates only the context-established frame-kind ordering fixed by the
 * Activation V1 runner transcript prose. It deliberately does not accept the
 * unresolved pre-context runner-setup arm and does not validate raw transcript
 * framing, sequence numbers, times, payloads, hashes, artifact states, failure
 * matrix compatibility, signatures, admission, or authority.
 */
export function analyzeFoundryActivationV1RunnerTranscriptFrameOrder(
  input: FoundryActivationV1RunnerFrameOrderInput,
): FoundryActivationV1RunnerFrameOrderAnalysis {
  const snapshot = snapshotInput(input);
  const { frameKinds, terminalOutcome } = snapshot;
  if (frameKinds[0] !== "runner_context") {
    fail(
      ERROR.contextRequired,
      "This bounded runner frame-order primitive accepts context-established transcripts beginning with runner_context only.",
    );
  }
  const firstTerminalIndex = frameKinds.indexOf("runner_terminal");
  if (firstTerminalIndex === -1) {
    fail(ERROR.terminalRequired, "Runner transcripts must end in exactly one runner_terminal frame.");
  }
  if (firstTerminalIndex !== frameKinds.length - 1) {
    fail(ERROR.terminalNotLast, "runner_terminal must be the only terminal frame and the final frame.");
  }

  let state: AutomatonState = "start";
  let stdoutChunkCount = 0;
  let stderrChunkCount = 0;
  let manifestFrameCount = 0;
  let terminalFromState: Exclude<AutomatonState, "start" | "terminal"> | undefined;
  for (const frameKind of frameKinds) {
    if (frameKind === "runner_terminal") {
      if (terminalOutcome === "succeeded" && state !== "spool_frozen") {
        fail(
          ERROR.successIncomplete,
          "A succeeded runner transcript requires output close, one manifest, worker exit and spool freeze before terminal.",
        );
      }
      if (state === "start" || state === "terminal") {
        fail(ERROR.transitionInvalid, "runner_terminal does not follow one context-established reached state.");
      }
      terminalFromState = state;
      state = "terminal";
      continue;
    }
    state = transitionNonterminal(state, frameKind, terminalOutcome);
    if (frameKind === "stdout_chunk") stdoutChunkCount += 1;
    if (frameKind === "stderr_chunk") stderrChunkCount += 1;
    if (frameKind === "worker_manifest") manifestFrameCount += 1;
  }
  if (state !== "terminal" || terminalFromState === undefined) {
    fail(ERROR.terminalRequired, "Runner transcripts must end in exactly one runner_terminal frame.");
  }
  const lastNonterminalFrameKind = frameKinds[frameKinds.length - 2];
  if (lastNonterminalFrameKind === undefined || lastNonterminalFrameKind === "runner_terminal") {
    fail(ERROR.transitionInvalid, "Runner transcripts require one context-established nonterminal frame.");
  }

  return Object.freeze({
    schemaVersion: "omnitwin.foundry.activation-v1-runner-frame-order-analysis.v0",
    authority: "none",
    validationScope: "context_established_frame_kind_order_only",
    rawTranscriptBytes: "not_validated",
    framePayloadsAndHashes: "not_validated",
    failureMatrix: "not_validated",
    semanticReceipt: "not_validated",
    terminalOutcome,
    frameKinds,
    frameCount: String(frameKinds.length),
    stdoutChunkCount: String(stdoutChunkCount),
    stderrChunkCount: String(stderrChunkCount),
    manifestFrameCount: manifestFrameCount === 0 ? "0" : "1",
    lastNonterminalFrameKind,
    reachedState: reachedState(terminalFromState),
  });
}

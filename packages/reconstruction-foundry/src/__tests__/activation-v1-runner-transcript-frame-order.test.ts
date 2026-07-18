import { describe, expect, it } from "vitest";
import {
  FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES,
  FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_FRAME_KINDS,
  FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT,
  analyzeFoundryActivationV1RunnerTranscriptFrameOrder,
  type FoundryActivationV1RunnerTerminalOutcome,
  type FoundryActivationV1RunnerTranscriptFrameKind,
  type FoundryActivationV1RunnerTranscriptReachedState,
} from "../activation-v1-runner-transcript-frame-order.js";
import { FoundryIntegrityError } from "../errors.js";

const ERROR = FOUNDRY_ACTIVATION_V1_RUNNER_FRAME_ORDER_ERROR_CODES;
const SUCCESS_WITHOUT_CHUNKS = [
  "runner_context",
  "source_opened",
  "worker_started",
  "output_handle_closed",
  "worker_manifest",
  "worker_exited",
  "spool_frozen",
  "runner_terminal",
] as const satisfies readonly FoundryActivationV1RunnerTranscriptFrameKind[];

function analyze(
  terminalOutcome: FoundryActivationV1RunnerTerminalOutcome,
  frameKinds: readonly FoundryActivationV1RunnerTranscriptFrameKind[],
) {
  return analyzeFoundryActivationV1RunnerTranscriptFrameOrder({ terminalOutcome, frameKinds });
}

function expectIntegrityCode(action: () => unknown, expectedCode: string): FoundryIntegrityError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof FoundryIntegrityError)) {
    throw new Error(`Expected FoundryIntegrityError ${expectedCode}.`, { cause: caught });
  }
  expect(caught.code).toBe(expectedCode);
  return caught;
}

describe("Activation V1 context-established runner transcript frame order", () => {
  it("pins the closed frame alphabet and analyzes the exact no-chunk success path", () => {
    expect(FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_FRAME_KINDS).toEqual([
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
    ]);
    expect(FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT).toBe(4096);

    const result = analyze("succeeded", SUCCESS_WITHOUT_CHUNKS);
    expect(result).toEqual({
      schemaVersion: "omnitwin.foundry.activation-v1-runner-frame-order-analysis.v0",
      authority: "none",
      validationScope: "context_established_frame_kind_order_only",
      rawTranscriptBytes: "not_validated",
      framePayloadsAndHashes: "not_validated",
      failureMatrix: "not_validated",
      semanticReceipt: "not_validated",
      terminalOutcome: "succeeded",
      frameKinds: SUCCESS_WITHOUT_CHUNKS,
      frameCount: "8",
      stdoutChunkCount: "0",
      stderrChunkCount: "0",
      manifestFrameCount: "1",
      lastNonterminalFrameKind: "spool_frozen",
      reachedState: "spool_frozen",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.frameKinds)).toBe(true);
  });

  it("accepts ordered stdout/stderr chunks only in the worker execution window", () => {
    const input: FoundryActivationV1RunnerTranscriptFrameKind[] = [
      "runner_context",
      "source_opened",
      "worker_started",
      "stdout_chunk",
      "stderr_chunk",
      "stdout_chunk",
      "output_handle_closed",
      "worker_manifest",
      "worker_exited",
      "spool_frozen",
      "runner_terminal",
    ];
    const result = analyze("succeeded", input);
    input[0] = "stderr_chunk";
    expect(result.frameKinds[0]).toBe("runner_context");
    expect(result.stdoutChunkCount).toBe("2");
    expect(result.stderrChunkCount).toBe("1");
    expect(result.frameCount).toBe("11");
  });

  const failureClosures: ReadonlyArray<{
    readonly name: string;
    readonly frames: readonly FoundryActivationV1RunnerTranscriptFrameKind[];
    readonly reachedState: FoundryActivationV1RunnerTranscriptReachedState;
    readonly lastKind: Exclude<FoundryActivationV1RunnerTranscriptFrameKind, "runner_terminal">;
    readonly manifestCount: "0" | "1";
  }> = [
    {
      name: "after context",
      frames: ["runner_context", "runner_terminal"],
      reachedState: "runner_context",
      lastKind: "runner_context",
      manifestCount: "0",
    },
    {
      name: "after source open",
      frames: ["runner_context", "source_opened", "runner_terminal"],
      reachedState: "source_opened",
      lastKind: "source_opened",
      manifestCount: "0",
    },
    {
      name: "after worker start",
      frames: ["runner_context", "source_opened", "worker_started", "runner_terminal"],
      reachedState: "worker_started_or_chunk",
      lastKind: "worker_started",
      manifestCount: "0",
    },
    {
      name: "after output chunk",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "stdout_chunk",
        "runner_terminal",
      ],
      reachedState: "worker_started_or_chunk",
      lastKind: "stdout_chunk",
      manifestCount: "0",
    },
    {
      name: "after output handle close",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "runner_terminal",
      ],
      reachedState: "output_handle_closed",
      lastKind: "output_handle_closed",
      manifestCount: "0",
    },
    {
      name: "after manifest",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "worker_manifest",
        "runner_terminal",
      ],
      reachedState: "worker_manifest",
      lastKind: "worker_manifest",
      manifestCount: "1",
    },
    {
      name: "after early worker exit",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "worker_exited",
        "runner_terminal",
      ],
      reachedState: "worker_exited",
      lastKind: "worker_exited",
      manifestCount: "0",
    },
    {
      name: "after chunk then worker exit",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "stderr_chunk",
        "worker_exited",
        "runner_terminal",
      ],
      reachedState: "worker_exited",
      lastKind: "worker_exited",
      manifestCount: "0",
    },
    {
      name: "after output-close worker exit",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "worker_exited",
        "runner_terminal",
      ],
      reachedState: "worker_exited",
      lastKind: "worker_exited",
      manifestCount: "0",
    },
    {
      name: "after manifest worker exit",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "worker_manifest",
        "worker_exited",
        "runner_terminal",
      ],
      reachedState: "worker_exited",
      lastKind: "worker_exited",
      manifestCount: "1",
    },
    {
      name: "after spool freeze",
      frames: SUCCESS_WITHOUT_CHUNKS,
      reachedState: "spool_frozen",
      lastKind: "spool_frozen",
      manifestCount: "1",
    },
    {
      name: "after early worker exit and spool freeze",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "worker_exited",
        "spool_frozen",
        "runner_terminal",
      ],
      reachedState: "spool_frozen",
      lastKind: "spool_frozen",
      manifestCount: "0",
    },
  ];

  it.each(failureClosures)("accepts a structural failure closure $name", (testCase) => {
    const result = analyze("failed", testCase.frames);
    expect(result.reachedState).toBe(testCase.reachedState);
    expect(result.lastNonterminalFrameKind).toBe(testCase.lastKind);
    expect(result.manifestFrameCount).toBe(testCase.manifestCount);
    expect(result.failureMatrix).toBe("not_validated");
  });

  it("accepts exactly 4096 frames and rejects 4097", () => {
    const chunks = Array.from(
      { length: FOUNDRY_ACTIVATION_V1_RUNNER_TRANSCRIPT_MAX_FRAME_COUNT - 8 },
      (_, index): FoundryActivationV1RunnerTranscriptFrameKind => (
        index % 2 === 0 ? "stdout_chunk" : "stderr_chunk"
      ),
    );
    const exact: FoundryActivationV1RunnerTranscriptFrameKind[] = [
      "runner_context",
      "source_opened",
      "worker_started",
      ...chunks,
      "output_handle_closed",
      "worker_manifest",
      "worker_exited",
      "spool_frozen",
      "runner_terminal",
    ];
    const result = analyze("succeeded", exact);
    expect(result.frameCount).toBe("4096");
    expect(Number(result.stdoutChunkCount) + Number(result.stderrChunkCount)).toBe(chunks.length);

    exact.splice(3, 0, "stdout_chunk");
    expectIntegrityCode(() => analyze("succeeded", exact), ERROR.frameCountInvalid);
  });

  const invalidTransitions: ReadonlyArray<{
    readonly name: string;
    readonly outcome: FoundryActivationV1RunnerTerminalOutcome;
    readonly frames: readonly FoundryActivationV1RunnerTranscriptFrameKind[];
    readonly errorCode: string;
  }> = [
    {
      name: "terminal before context",
      outcome: "failed",
      frames: ["runner_terminal"],
      errorCode: ERROR.contextRequired,
    },
    {
      name: "source before context",
      outcome: "failed",
      frames: ["source_opened", "runner_terminal"],
      errorCode: ERROR.contextRequired,
    },
    {
      name: "missing terminal",
      outcome: "failed",
      frames: ["runner_context"],
      errorCode: ERROR.terminalRequired,
    },
    {
      name: "frame after terminal",
      outcome: "failed",
      frames: ["runner_context", "runner_terminal", "source_opened"],
      errorCode: ERROR.terminalNotLast,
    },
    {
      name: "duplicate terminal",
      outcome: "failed",
      frames: ["runner_context", "runner_terminal", "runner_terminal"],
      errorCode: ERROR.terminalNotLast,
    },
    {
      name: "chunk before worker start",
      outcome: "failed",
      frames: ["runner_context", "source_opened", "stdout_chunk", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "worker exit before worker start",
      outcome: "failed",
      frames: ["runner_context", "source_opened", "worker_exited", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "output close before worker start",
      outcome: "failed",
      frames: ["runner_context", "source_opened", "output_handle_closed", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "chunk after output close",
      outcome: "failed",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "stderr_chunk",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "manifest before output close",
      outcome: "failed",
      frames: ["runner_context", "source_opened", "worker_started", "worker_manifest", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "duplicate manifest",
      outcome: "failed",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "worker_manifest",
        "worker_manifest",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "spool freeze before worker exit",
      outcome: "failed",
      frames: ["runner_context", "source_opened", "worker_started", "spool_frozen", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "chunk after worker exit",
      outcome: "failed",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "worker_exited",
        "stdout_chunk",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "duplicate worker exit",
      outcome: "failed",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "worker_exited",
        "worker_exited",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "frame after spool freeze",
      outcome: "failed",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "worker_exited",
        "spool_frozen",
        "worker_exited",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "success terminal before complete sequence",
      outcome: "succeeded",
      frames: ["runner_context", "source_opened", "worker_started", "runner_terminal"],
      errorCode: ERROR.successIncomplete,
    },
    {
      name: "success worker exits before output and manifest",
      outcome: "succeeded",
      frames: ["runner_context", "source_opened", "worker_started", "worker_exited", "runner_terminal"],
      errorCode: ERROR.transitionInvalid,
    },
    {
      name: "success worker exits without manifest",
      outcome: "succeeded",
      frames: [
        "runner_context",
        "source_opened",
        "worker_started",
        "output_handle_closed",
        "worker_exited",
        "spool_frozen",
        "runner_terminal",
      ],
      errorCode: ERROR.transitionInvalid,
    },
  ];

  it.each(invalidTransitions)("rejects $name", (testCase) => {
    expectIntegrityCode(
      () => analyze(testCase.outcome, testCase.frames),
      testCase.errorCode,
    );
  });

  it("rejects unknown frame kinds and invalid terminal outcomes", () => {
    expectIntegrityCode(
      () => Reflect.apply(analyzeFoundryActivationV1RunnerTranscriptFrameOrder, undefined, [{
        terminalOutcome: "failed",
        frameKinds: ["runner_context", "unknown", "runner_terminal"],
      }]),
      ERROR.frameKindInvalid,
    );
    expectIntegrityCode(
      () => Reflect.apply(analyzeFoundryActivationV1RunnerTranscriptFrameOrder, undefined, [{
        terminalOutcome: "cancelled",
        frameKinds: ["runner_context", "runner_terminal"],
      }]),
      ERROR.outcomeInvalid,
    );
  });

  it("rejects malformed input objects and exotic frame arrays", () => {
    for (const input of [
      null,
      [],
      { terminalOutcome: "failed" },
      { frameKinds: ["runner_context", "runner_terminal"] },
      {
        terminalOutcome: "failed",
        frameKinds: ["runner_context", "runner_terminal"],
        authority: "none",
      },
      new Proxy({
        terminalOutcome: "failed",
        frameKinds: ["runner_context", "runner_terminal"],
      }, {}),
    ]) {
      expectIntegrityCode(
        () => Reflect.apply(analyzeFoundryActivationV1RunnerTranscriptFrameOrder, undefined, [input]),
        ERROR.inputShapeInvalid,
      );
    }

    const accessorInput = { frameKinds: ["runner_context", "runner_terminal"] };
    Object.defineProperty(accessorInput, "terminalOutcome", {
      enumerable: true,
      get: () => "failed",
    });
    expectIntegrityCode(
      () => Reflect.apply(analyzeFoundryActivationV1RunnerTranscriptFrameOrder, undefined, [accessorInput]),
      ERROR.inputShapeInvalid,
    );

    class FrameArray extends Array<FoundryActivationV1RunnerTranscriptFrameKind> {}
    const sparse: FoundryActivationV1RunnerTranscriptFrameKind[] = [];
    sparse.length = 2;
    const accessorFrames: FoundryActivationV1RunnerTranscriptFrameKind[] = [
      "runner_context",
      "runner_terminal",
    ];
    Object.defineProperty(accessorFrames, "0", { enumerable: true, get: () => "runner_context" });
    const extraFrames: FoundryActivationV1RunnerTranscriptFrameKind[] = [
      "runner_context",
      "runner_terminal",
    ];
    Object.defineProperty(extraFrames, "extra", { enumerable: true, value: "x" });
    const exoticArrays: unknown[] = [
      "not-an-array",
      sparse,
      accessorFrames,
      extraFrames,
      new FrameArray("runner_context", "runner_terminal"),
      new Proxy(["runner_context", "runner_terminal"], {}),
      [],
    ];
    for (const frameKinds of exoticArrays) {
      const expectedCode = Array.isArray(frameKinds) && frameKinds.length === 0
        ? ERROR.frameCountInvalid
        : ERROR.frameArrayInvalid;
      expectIntegrityCode(
        () => Reflect.apply(analyzeFoundryActivationV1RunnerTranscriptFrameOrder, undefined, [{
          terminalOutcome: "failed",
          frameKinds,
        }]),
        expectedCode,
      );
    }
  });

  it("does not claim raw transcript, failure-matrix, semantic, admission, or authority verdicts", () => {
    const result = analyze("failed", SUCCESS_WITHOUT_CHUNKS);
    expect(result.authority).toBe("none");
    expect(result.validationScope).toBe("context_established_frame_kind_order_only");
    expect(result.failureMatrix).toBe("not_validated");
    for (const forbiddenField of [
      "valid",
      "authenticated",
      "trusted",
      "authorized",
      "admitted",
      "signatureValid",
      "failureStage",
      "recipeState",
      "outputState",
      "manifestState",
      "spoolState",
      "transcriptSha256",
      "receiptSha256",
    ]) {
      expect(result).not.toHaveProperty(forbiddenField);
    }
  });
});

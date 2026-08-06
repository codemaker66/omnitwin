import { isAbsolute, resolve as resolvePath } from "node:path";
import {
  FoundryCapturedQualityComparisonReportV0Schema,
  type FoundryCapturedQualityComparisonReportV0,
} from "@omnitwin/reconstruction-foundry";

const REQUEST_ID = /^[a-f0-9]{32}$/u;
const DEFAULT_DEADLINE_MS = 15 * 60 * 1_000;
const MAX_DEADLINE_MS = 30 * 60 * 1_000;
const DEFAULT_SETTLEMENT_CONFIRMATION_MS = 5_000;
const MAX_SETTLEMENT_CONFIRMATION_MS = 30_000;

const FROZEN_RECEPTION_PROFILES = Object.freeze([
  Object.freeze({
    profileId: "quality-sog-fine-v1",
    gaussianCount: 2_002_009,
    assets: Object.freeze([
      Object.freeze({
        pathLabel: "0_15_0_0.sog",
        sizeBytes: 10_279_160,
        sha256:
          "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
      }),
      Object.freeze({
        pathLabel: "0_1_0_5.sog",
        sizeBytes: 10_047_085,
        sha256:
          "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
      }),
      Object.freeze({
        pathLabel: "0_6_0_0.sog",
        sizeBytes: 10_368_228,
        sha256:
          "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
      }),
      Object.freeze({
        pathLabel: "0_7_0_0.sog",
        sizeBytes: 5_040_628,
        sha256:
          "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
      }),
    ]),
  }),
  Object.freeze({
    profileId: "mobile-spz-fine-v1",
    gaussianCount: 1_978_258,
    assets: Object.freeze([
      Object.freeze({
        pathLabel: "0_13_0_0.spz",
        sizeBytes: 8_620_036,
        sha256:
          "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
      }),
      Object.freeze({
        pathLabel: "0_3_0_0.spz",
        sizeBytes: 9_199_830,
        sha256:
          "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3",
      }),
      Object.freeze({
        pathLabel: "0_7_0_1.spz",
        sizeBytes: 8_768_751,
        sha256:
          "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df",
      }),
      Object.freeze({
        pathLabel: "0_8_0_0.spz",
        sizeBytes: 3_422_064,
        sha256:
          "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed",
      }),
    ]),
  }),
] as const);

const FROZEN_RECEPTION_VIEWS = Object.freeze([
  Object.freeze({
    viewId: "overview",
    position: [-2.408, 1.449, 9.752] as const,
    target: [-2.652, -5.022, -11.676] as const,
    verticalFovDegrees: 48,
  }),
  Object.freeze({
    viewId: "timber-left",
    position: [-2.408, 1.449, 9.752] as const,
    target: [-6.5, -3.5, -11.5] as const,
    verticalFovDegrees: 25,
  }),
  Object.freeze({
    viewId: "timber-right",
    position: [-2.408, 1.449, 9.752] as const,
    target: [0, -3.5, -11.5] as const,
    verticalFovDegrees: 25,
  }),
  Object.freeze({
    viewId: "floor-surface",
    position: [-2.408, 1.449, 9.752] as const,
    target: [-3, -5, -4] as const,
    verticalFovDegrees: 28,
  }),
  Object.freeze({
    viewId: "ceiling-moulding",
    position: [-2.408, 1.449, 9.752] as const,
    target: [-3, 0, -11.5] as const,
    verticalFovDegrees: 24,
  }),
  Object.freeze({
    viewId: "column-skirting",
    position: [-2.408, 1.449, 9.752] as const,
    target: [1, -3, -10] as const,
    verticalFovDegrees: 24,
  }),
] as const);

const FROZEN_RECEPTION_CAPTURE_COUNT =
  FROZEN_RECEPTION_PROFILES.length * FROZEN_RECEPTION_VIEWS.length * 2;

export type LocalCapturedQualityComparisonState =
  | "unavailable"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export type LocalCapturedQualityComparisonRunnerPhase =
  | "verifying_sources"
  | "starting_renderer"
  | "capturing"
  | "scoring"
  | "finalizing";

export type LocalCapturedQualityComparisonPhase =
  | "unavailable"
  | "ready"
  | "starting"
  | LocalCapturedQualityComparisonRunnerPhase
  | "completed"
  | "failed";

/** The complete and only browser-facing start request. */
export interface LocalCapturedQualityComparisonStartRequest {
  readonly requestId: string;
}

/**
 * Process-owned local configuration. These paths must never be populated from
 * a browser request.
 */
export interface LocalCapturedQualityComparisonTrustedContext {
  readonly repoRoot: string;
  readonly qualityRoot: string;
  readonly mobileRoot: string;
  readonly outputRoot: string;
}

/** Exact process-owned context passed to one runner invocation. */
export interface LocalCapturedQualityComparisonRunContext
  extends LocalCapturedQualityComparisonTrustedContext {
  readonly requestId: string;
}

export interface LocalCapturedQualityComparisonRunnerProgress {
  readonly phase: LocalCapturedQualityComparisonRunnerPhase;
  readonly completed: number;
  readonly total: number;
  readonly message?: string;
}

export type LocalCapturedQualityComparisonProgressReporter = (
  progress: LocalCapturedQualityComparisonRunnerProgress,
) => void;

export type LocalCapturedQualityComparisonRunner = (
  context: LocalCapturedQualityComparisonRunContext,
  signal: AbortSignal,
  progress: LocalCapturedQualityComparisonProgressReporter,
) => Promise<FoundryCapturedQualityComparisonReportV0>;

export interface LocalCapturedQualityComparisonProgressDto {
  readonly phase: LocalCapturedQualityComparisonPhase;
  readonly completed: number;
  readonly total: number;
}

export interface LocalCapturedQualityComparisonReportSummaryDto {
  readonly schemaVersion: string;
  readonly reportSha256: string;
  readonly generatedAt: string;
  readonly sourceReceiptSha256: string | null;
  readonly rendererProfileId: string;
  readonly viewCount: number;
  readonly captureCount: number;
  readonly pairMetricCount: number;
}

export interface LocalCapturedQualityComparisonDto {
  readonly state: LocalCapturedQualityComparisonState;
  readonly requestId: string | null;
  readonly authority: "none";
  readonly winner: "not_selected";
  readonly message: string;
  readonly failureCode: string | null;
  readonly progress: LocalCapturedQualityComparisonProgressDto;
  readonly report: LocalCapturedQualityComparisonReportSummaryDto | null;
}

export interface CreateLocalCapturedQualityComparisonControllerOptions {
  readonly trustedContext: LocalCapturedQualityComparisonTrustedContext | null;
  readonly runner: LocalCapturedQualityComparisonRunner;
  /** Process-owned fixed deadline. It is never accepted from a start request. */
  readonly deadlineMs?: number;
  /** Bounded lifecycle-confirmation window used by cancel and stop. */
  readonly settlementConfirmationMs?: number;
}

interface ActiveRun {
  readonly requestId: string;
  readonly abortController: AbortController;
  abortCode: string | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  completion: Promise<LocalCapturedQualityComparisonDto>;
}

export class LocalCapturedQualityComparisonError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalCapturedQualityComparisonError";
    this.code = code;
  }
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new LocalCapturedQualityComparisonError(code, message, { cause });
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function parseStartRequest(
  input: unknown,
): LocalCapturedQualityComparisonStartRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input as Record<string, unknown>, ["requestId"])
  ) {
    fail(
      "LOCAL_CAPTURED_QUALITY_REQUEST_INVALID",
      "The captured-quality start request must contain only one opaque request ID.",
    );
  }
  const requestId = (input as Record<string, unknown>).requestId;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
    fail(
      "LOCAL_CAPTURED_QUALITY_REQUEST_INVALID",
      "The captured-quality request ID must be 32 lowercase hexadecimal characters.",
    );
  }
  return Object.freeze({ requestId });
}

function validDuration(
  value: number,
  maximum: number,
): boolean {
  return Number.isInteger(value) && value > 0 && value <= maximum;
}

function canonicalLocalPath(value: string): string {
  const canonical = resolvePath(value);
  if (
    value.length === 0 ||
    !isAbsolute(value) ||
    value !== canonical ||
    /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u.test(value)
  ) {
    throw new TypeError(
      "captured-quality trusted paths must be canonical local absolute paths",
    );
  }
  return canonical;
}

function copyTrustedContext(
  context: LocalCapturedQualityComparisonTrustedContext,
): LocalCapturedQualityComparisonTrustedContext {
  return Object.freeze({
    repoRoot: canonicalLocalPath(context.repoRoot),
    qualityRoot: canonicalLocalPath(context.qualityRoot),
    mobileRoot: canonicalLocalPath(context.mobileRoot),
    outputRoot: canonicalLocalPath(context.outputRoot),
  });
}

function progress(
  phase: LocalCapturedQualityComparisonPhase,
  completed = 0,
  total = 0,
): LocalCapturedQualityComparisonProgressDto {
  return Object.freeze({ phase, completed, total });
}

function dto(input: {
  readonly state: LocalCapturedQualityComparisonState;
  readonly requestId?: string | null;
  readonly message: string;
  readonly failureCode?: string | null;
  readonly progress?: LocalCapturedQualityComparisonProgressDto;
  readonly report?: LocalCapturedQualityComparisonReportSummaryDto | null;
}): LocalCapturedQualityComparisonDto {
  const fallbackPhase: LocalCapturedQualityComparisonPhase =
    input.state === "running" ? "starting" : input.state;
  return Object.freeze({
    state: input.state,
    requestId: input.requestId ?? null,
    authority: "none",
    winner: "not_selected",
    message: input.message,
    failureCode: input.failureCode ?? null,
    progress: input.progress ?? progress(fallbackPhase),
    report: input.report ?? null,
  });
}

export const LOCAL_CAPTURED_QUALITY_COMPARISON_UNAVAILABLE_DTO = Object.freeze(
  dto({
    state: "unavailable",
    message:
      "No exact process-owned captured-quality comparison is configured for this local session.",
    progress: progress("unavailable"),
  }),
);

function cloneDto(
  value: LocalCapturedQualityComparisonDto,
): LocalCapturedQualityComparisonDto {
  return structuredClone(value);
}

function publicCode(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    /^[A-Z0-9_]{3,128}$/u.test(
      (error as { readonly code: string }).code,
    )
  ) {
    return (error as { readonly code: string }).code;
  }
  return fallback;
}

function defaultProgressMessage(
  phase: LocalCapturedQualityComparisonRunnerPhase,
): string {
  switch (phase) {
    case "verifying_sources":
      return "Verifying the exact eight captured source assets.";
    case "starting_renderer":
      return "Starting the local renderer for the frozen comparison.";
    case "capturing":
      return "Capturing the frozen candidate and camera matrix.";
    case "scoring":
      return "Computing regression-triage image metrics.";
    case "finalizing":
      return "Binding the completed comparison report to its digest.";
  }
}

function sameNumbers(
  actual: readonly number[],
  expected: readonly number[],
): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function receptionScopeMismatch(message: string): never {
  fail(
    "LOCAL_CAPTURED_QUALITY_REPORT_SCOPE_MISMATCH",
    `The completed report is not the exact frozen Reception comparison: ${message}`,
  );
}

/**
 * The shared report schema intentionally supports other reviewed comparison
 * matrices. This local feature is narrower: it may retain only the frozen
 * Reception Quality SOG versus Mobile SPZ matrix.
 */
function assertFrozenReceptionReport(
  report: FoundryCapturedQualityComparisonReportV0,
): void {
  if (
    report.sourceReceiptSha256 !== null ||
    report.rendererProfile.id !== "reception-viewer-profile-source-v1" ||
    report.viewport.widthPx !== 1_200 ||
    report.viewport.heightPx !== 900 ||
    report.viewport.deviceScaleFactor !== 1 ||
    report.scorer.id !== "reception-fixed-view-pixel-metrics-v1"
  ) {
    receptionScopeMismatch("the frozen renderer, viewport, or scorer changed");
  }

  for (const [profileIndex, expectedProfile] of
    FROZEN_RECEPTION_PROFILES.entries()) {
    const profile = report.candidateProfiles[profileIndex];
    if (
      profile === undefined ||
      profile.profileId !== expectedProfile.profileId ||
      profile.expectedGaussianCount !== expectedProfile.gaussianCount ||
      profile.decodedGaussianCount !== expectedProfile.gaussianCount ||
      profile.assets.length !== expectedProfile.assets.length
    ) {
      receptionScopeMismatch("the candidate profile identity or order changed");
    }
    for (const [assetIndex, expectedAsset] of
      expectedProfile.assets.entries()) {
      const asset = profile.assets[assetIndex];
      if (
        asset === undefined ||
        asset.pathLabel !== expectedAsset.pathLabel ||
        asset.sizeBytes !== expectedAsset.sizeBytes ||
        asset.sha256 !== expectedAsset.sha256
      ) {
        receptionScopeMismatch("a frozen candidate asset identity changed");
      }
    }
  }

  if (
    report.views.length !== FROZEN_RECEPTION_VIEWS.length ||
    report.pairMetrics.length !== FROZEN_RECEPTION_VIEWS.length
  ) {
    receptionScopeMismatch("six ordered views and six pair metrics are required");
  }
  for (const [viewIndex, expectedView] of FROZEN_RECEPTION_VIEWS.entries()) {
    const view = report.views[viewIndex];
    const pairMetric = report.pairMetrics[viewIndex];
    if (
      view === undefined ||
      pairMetric === undefined ||
      view.viewId !== expectedView.viewId ||
      pairMetric.viewId !== expectedView.viewId ||
      view.kind !== "other_reviewed" ||
      !sameNumbers(view.camera.position, expectedView.position) ||
      !sameNumbers(view.camera.target, expectedView.target) ||
      !sameNumbers(view.camera.up, [0, 1, 0]) ||
      view.camera.verticalFovDegrees !== expectedView.verticalFovDegrees ||
      view.camera.nearClip !== 0.1 ||
      view.camera.farClip !== 120
    ) {
      receptionScopeMismatch("a frozen view, camera, or pair-metric order changed");
    }
  }

  let captureCount = 0;
  for (const [profileIndex, expectedProfile] of
    FROZEN_RECEPTION_PROFILES.entries()) {
    const profileCaptures = report.captures[profileIndex];
    if (
      profileCaptures === undefined ||
      profileCaptures.profileId !== expectedProfile.profileId ||
      profileCaptures.views.length !== FROZEN_RECEPTION_VIEWS.length
    ) {
      receptionScopeMismatch("the capture profile identity or order changed");
    }
    for (const [viewIndex, expectedView] of
      FROZEN_RECEPTION_VIEWS.entries()) {
      const viewCapture = profileCaptures.views[viewIndex];
      if (
        viewCapture === undefined ||
        viewCapture.viewId !== expectedView.viewId
      ) {
        receptionScopeMismatch("each profile/view must contain repeats one and two");
      }
      captureCount += viewCapture.repeats.length;
    }
  }
  if (captureCount !== FROZEN_RECEPTION_CAPTURE_COUNT) {
    receptionScopeMismatch("exactly 24 captures are required");
  }
}

function reportSummary(
  report: FoundryCapturedQualityComparisonReportV0,
): LocalCapturedQualityComparisonReportSummaryDto {
  const captureCount = report.captures.reduce(
    (total, profile) =>
      total + profile.views.reduce(
        (profileTotal, view) => profileTotal + view.repeats.length,
        0,
      ),
    0,
  );
  return Object.freeze({
    schemaVersion: report.schemaVersion,
    reportSha256: report.reportSha256,
    generatedAt: report.generatedAt,
    sourceReceiptSha256: report.sourceReceiptSha256,
    rendererProfileId: report.rendererProfile.id,
    viewCount: report.views.length,
    captureCount,
    pairMetricCount: report.pairMetrics.length,
  });
}

function abortError(code: string): LocalCapturedQualityComparisonError {
  return new LocalCapturedQualityComparisonError(
    code,
    code === "LOCAL_CAPTURED_QUALITY_DEADLINE_EXCEEDED"
      ? "The local captured-quality comparison exceeded its fixed deadline."
      : code === "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED"
        ? "The local captured-quality comparison controller stopped."
        : "The local captured-quality comparison was cancelled.",
  );
}

function failureMessage(code: string): string {
  switch (code) {
    case "LOCAL_CAPTURED_QUALITY_CANCELLED":
      return "The local captured-quality comparison was cancelled. No report was retained.";
    case "LOCAL_CAPTURED_QUALITY_DEADLINE_EXCEEDED":
      return "The local captured-quality comparison exceeded its fixed deadline. No report was retained.";
    case "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED":
      return "The local captured-quality comparison controller stopped. No report was retained.";
    case "LOCAL_CAPTURED_QUALITY_RUNNER_SETTLEMENT_UNCONFIRMED":
      return "The local comparison runner could not be confirmed stopped. No report was accepted.";
    default:
      return `The local captured-quality comparison failed safely (${code}). No report was retained.`;
  }
}

export class LocalCapturedQualityComparisonController {
  readonly #trustedContext: LocalCapturedQualityComparisonTrustedContext | null;
  readonly #runner: LocalCapturedQualityComparisonRunner;
  readonly #deadlineMs: number;
  readonly #settlementConfirmationMs: number;
  #boundRequestId: string | null = null;
  #state: LocalCapturedQualityComparisonDto | null = null;
  #completedReport: FoundryCapturedQualityComparisonReportV0 | null = null;
  #active: ActiveRun | null = null;
  #stopped = false;

  constructor(options: CreateLocalCapturedQualityComparisonControllerOptions) {
    const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    if (!validDuration(deadlineMs, MAX_DEADLINE_MS)) {
      throw new TypeError("deadlineMs is outside the fixed local bound");
    }
    const settlementConfirmationMs = options.settlementConfirmationMs ??
      DEFAULT_SETTLEMENT_CONFIRMATION_MS;
    if (
      !validDuration(
        settlementConfirmationMs,
        MAX_SETTLEMENT_CONFIRMATION_MS,
      )
    ) {
      throw new TypeError(
        "settlementConfirmationMs is outside the fixed local bound",
      );
    }
    this.#trustedContext = options.trustedContext === null
      ? null
      : copyTrustedContext(options.trustedContext);
    this.#runner = options.runner;
    this.#deadlineMs = deadlineMs;
    this.#settlementConfirmationMs = settlementConfirmationMs;
  }

  availability(): LocalCapturedQualityComparisonDto {
    if (this.#stopped) {
      return cloneDto(dto({
        state: "unavailable",
        message: "The local captured-quality comparison controller is stopped.",
        failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
        progress: progress("unavailable"),
      }));
    }
    if (this.#state !== null) return cloneDto(this.#state);
    if (this.#trustedContext === null) {
      return cloneDto(LOCAL_CAPTURED_QUALITY_COMPARISON_UNAVAILABLE_DTO);
    }
    return cloneDto(dto({
      state: "ready",
      message:
        "The exact local Quality SOG versus Mobile SPZ comparison is ready.",
      progress: progress("ready"),
    }));
  }

  snapshot(requestId?: string): LocalCapturedQualityComparisonDto {
    if (requestId !== undefined) {
      const current = this.status(requestId);
      if (current !== null) return current;
      if (this.#boundRequestId !== null && REQUEST_ID.test(requestId)) {
        return cloneDto(dto({
          state: "failed",
          requestId,
          message: "This status request is stale for the current local session.",
          failureCode: "LOCAL_CAPTURED_QUALITY_STALE_REQUEST",
          progress: progress("failed"),
        }));
      }
      return this.availability();
    }
    return this.#state === null ? this.availability() : cloneDto(this.#state);
  }

  start(input: LocalCapturedQualityComparisonStartRequest): Promise<LocalCapturedQualityComparisonDto> {
    const request = parseStartRequest(input);
    if (this.#boundRequestId !== null) {
      if (request.requestId !== this.#boundRequestId) {
        return Promise.resolve(cloneDto(dto({
          state: "failed",
          requestId: request.requestId,
          message: this.#active === null
            ? "This local session is bound to a different completed or failed request."
            : "Another captured-quality comparison request is already running.",
          failureCode: this.#active === null
            ? "LOCAL_CAPTURED_QUALITY_STALE_REQUEST"
            : "LOCAL_CAPTURED_QUALITY_BUSY",
          progress: progress("failed"),
        })));
      }
      if (this.#active !== null) return this.#active.completion;
      if (this.#state !== null) return Promise.resolve(cloneDto(this.#state));
    }
    if (this.#stopped) {
      return Promise.resolve(cloneDto(dto({
        state: "unavailable",
        requestId: request.requestId,
        message: "The local captured-quality comparison controller is stopped.",
        failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
        progress: progress("unavailable"),
      })));
    }
    if (this.#trustedContext === null) {
      return Promise.resolve(cloneDto(LOCAL_CAPTURED_QUALITY_COMPARISON_UNAVAILABLE_DTO));
    }

    this.#boundRequestId = request.requestId;
    let resolveSettled = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const active: ActiveRun = {
      requestId: request.requestId,
      abortController: new AbortController(),
      abortCode: null,
      deadlineTimer: null,
      settled,
      resolveSettled,
      completion: Promise.resolve(LOCAL_CAPTURED_QUALITY_COMPARISON_UNAVAILABLE_DTO),
    };
    active.deadlineTimer = setTimeout(() => {
      this.#abort(active, "LOCAL_CAPTURED_QUALITY_DEADLINE_EXCEEDED");
    }, this.#deadlineMs);
    active.deadlineTimer.unref();
    this.#active = active;
    this.#state = dto({
      state: "running",
      requestId: request.requestId,
      message: "Starting the exact local captured-quality comparison.",
      progress: progress("starting", 0, 1),
    });
    active.completion = this.#run(active, {
      ...this.#trustedContext,
      requestId: request.requestId,
    });
    return active.completion;
  }

  status(requestId: string): LocalCapturedQualityComparisonDto | null {
    if (!REQUEST_ID.test(requestId) || requestId !== this.#boundRequestId) {
      return null;
    }
    return this.#state === null ? null : cloneDto(this.#state);
  }

  async cancel(
    requestId: string,
  ): Promise<LocalCapturedQualityComparisonDto | null> {
    if (!REQUEST_ID.test(requestId) || requestId !== this.#boundRequestId) {
      return null;
    }
    const active = this.#active;
    if (active === null || active.requestId !== requestId) {
      return this.status(requestId);
    }
    this.#abort(active, "LOCAL_CAPTURED_QUALITY_CANCELLED");
    const confirmed = await this.#waitForSettlement(active);
    if (!confirmed) {
      this.#completedReport = null;
      this.#state = dto({
        state: "failed",
        requestId,
        message: failureMessage(
          "LOCAL_CAPTURED_QUALITY_RUNNER_SETTLEMENT_UNCONFIRMED",
        ),
        failureCode:
          "LOCAL_CAPTURED_QUALITY_RUNNER_SETTLEMENT_UNCONFIRMED",
        progress: progress("failed"),
      });
      return cloneDto(this.#state);
    }
    return this.status(requestId);
  }

  readCompletedReport(
    requestId: string,
  ): FoundryCapturedQualityComparisonReportV0 | null {
    if (
      requestId !== this.#boundRequestId ||
      this.#state?.state !== "completed" ||
      this.#completedReport === null
    ) {
      return null;
    }
    return structuredClone(this.#completedReport);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const active = this.#active;
    if (active !== null) {
      this.#abort(active, "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED");
      if (!(await this.#waitForSettlement(active))) {
        this.#completedReport = null;
        fail(
          "LOCAL_CAPTURED_QUALITY_RUNNER_SETTLEMENT_UNCONFIRMED",
          "The local captured-quality runner could not be confirmed stopped; call stop again to retry confirmation.",
        );
      }
    }
    this.#completedReport = null;
    if (this.#boundRequestId !== null) {
      this.#state = dto({
        state: "failed",
        requestId: this.#boundRequestId,
        message: failureMessage("LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED"),
        failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
        progress: progress("failed"),
      });
    }
  }

  async #run(
    active: ActiveRun,
    context: LocalCapturedQualityComparisonRunContext,
  ): Promise<LocalCapturedQualityComparisonDto> {
    try {
      const returned = await this.#runner(
        Object.freeze(context),
        active.abortController.signal,
        (next) => {
          this.#recordProgress(active, next);
        },
      );
      if (active.abortCode !== null || active.abortController.signal.aborted) {
        throw abortError(
          active.abortCode ?? "LOCAL_CAPTURED_QUALITY_CANCELLED",
        );
      }
      const report = FoundryCapturedQualityComparisonReportV0Schema.parse(
        structuredClone(returned),
      );
      assertFrozenReceptionReport(report);
      this.#completedReport = structuredClone(report);
      const summary = reportSummary(report);
      this.#state = dto({
        state: "completed",
        requestId: active.requestId,
        message:
          "The local comparison completed as authority-none regression-triage evidence. No winner was selected.",
        progress: progress("completed", summary.captureCount, summary.captureCount),
        report: summary,
      });
      return cloneDto(this.#state);
    } catch (error: unknown) {
      this.#completedReport = null;
      const code = active.abortCode ?? publicCode(
        error,
        "LOCAL_CAPTURED_QUALITY_RUNNER_FAILED",
      );
      this.#state = dto({
        state: "failed",
        requestId: active.requestId,
        message: failureMessage(code),
        failureCode: code,
        progress: progress("failed"),
      });
      return cloneDto(this.#state);
    } finally {
      if (active.deadlineTimer !== null) clearTimeout(active.deadlineTimer);
      active.deadlineTimer = null;
      if (this.#active === active) this.#active = null;
      active.resolveSettled();
    }
  }

  #recordProgress(
    active: ActiveRun,
    next: LocalCapturedQualityComparisonRunnerProgress,
  ): void {
    if (
      this.#active !== active ||
      active.abortCode !== null ||
      active.abortController.signal.aborted
    ) {
      return;
    }
    if (
      !Number.isSafeInteger(next.completed) ||
      !Number.isSafeInteger(next.total) ||
      next.completed < 0 ||
      next.total <= 0 ||
      next.completed > next.total
    ) {
      fail(
        "LOCAL_CAPTURED_QUALITY_PROGRESS_INVALID",
        "The local comparison runner reported invalid progress counts.",
      );
    }
    const message = next.message?.trim();
    this.#state = dto({
      state: "running",
      requestId: active.requestId,
      message: message === undefined || message.length === 0
        ? defaultProgressMessage(next.phase)
        : message.slice(0, 240),
      progress: progress(next.phase, next.completed, next.total),
    });
  }

  #abort(active: ActiveRun, code: string): void {
    if (active.abortCode !== null) return;
    active.abortCode = code;
    active.abortController.abort(abortError(code));
  }

  async #waitForSettlement(active: ActiveRun): Promise<boolean> {
    let resolveTimeout = (): void => undefined;
    const timeout = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    const timer = setTimeout(resolveTimeout, this.#settlementConfirmationMs);
    timer.unref();
    try {
      const outcome = await Promise.race([
        active.settled.then(() => true),
        timeout.then(() => false),
      ]);
      return outcome || this.#active !== active;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLocalCapturedQualityComparisonController(
  options: CreateLocalCapturedQualityComparisonControllerOptions,
): LocalCapturedQualityComparisonController {
  return new LocalCapturedQualityComparisonController(options);
}

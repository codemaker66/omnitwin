import {
  FoundryIntegrityError,
  FoundryPhotoCaptureQualityReportV0Schema,
  FoundryUniversalIntakeReceiptSchema,
  listFoundryPhotoCaptureQualityCandidatesV0,
  runFoundryPhotoCaptureQualityWorkerV0,
  type FoundryPhotoCaptureQualityCandidateV0,
  type FoundryPhotoCaptureQualityReportV0,
  type FoundryPhotoCaptureQualityRequestedAssignmentV0,
  type FoundryPhotoCaptureQualityWorkerProgressV0,
  type FoundryPhotoCaptureQualityWorkerV0Result,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { FoundryRelativePathSchema } from "@omnitwin/types";

const REQUEST_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MIN_SETTLEMENT_TIMEOUT_MS = 25;
const MAX_SETTLEMENT_TIMEOUT_MS = 60_000;

export type LocalPhotoCaptureQualityStateV0 =
  | "unavailable"
  | "ready"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type LocalPhotoCaptureQualityPhaseV0 =
  | "unavailable"
  | "ready"
  | "reading_pixels"
  | "binding_report"
  | "completed"
  | "cancelled"
  | "failed";

export interface LocalPhotoCaptureQualityStartRequestV0 {
  readonly requestId: string;
  readonly receiptSha256: string;
  readonly assignments: readonly {
    readonly path: string;
    readonly role: "build" | "heldout" | "ignore";
  }[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

export function parseLocalPhotoCaptureQualityStartRequestV0(
  input: unknown,
): LocalPhotoCaptureQualityStartRequestV0 {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["requestId", "receiptSha256", "assignments"]) ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.receiptSha256 !== "string" ||
    !SHA256.test(input.receiptSha256) ||
    !Array.isArray(input.assignments) ||
    input.assignments.length < 1 ||
    input.assignments.length > 500
  ) {
    throw new FoundryIntegrityError(
      "INVALID_PHOTO_WORKBENCH_START_REQUEST",
      "The photo-workbench start request is invalid.",
    );
  }
  const assignments = input.assignments.map((assignment) => {
    if (
      !isRecord(assignment) ||
      !hasExactKeys(assignment, ["path", "role"]) ||
      typeof assignment.path !== "string" ||
      !FoundryRelativePathSchema.safeParse(assignment.path).success ||
      !["build", "heldout", "ignore"].includes(String(assignment.role))
    ) {
      throw new FoundryIntegrityError(
        "INVALID_PHOTO_WORKBENCH_ASSIGNMENT",
        "A photo-workbench assignment is invalid.",
      );
    }
    return {
      path: assignment.path,
      role: assignment.role as "build" | "heldout" | "ignore",
    };
  });
  return {
    requestId: input.requestId,
    receiptSha256: input.receiptSha256,
    assignments,
  };
}

export interface LocalPhotoCaptureQualityCandidateDtoV0 {
  readonly path: string;
  readonly mediaType: "image/jpeg" | "image/png";
  readonly sizeBytes: number;
  readonly suggestedRole: "build" | "heldout" | "ignore";
  readonly assignedRole: "build" | "heldout" | "ignore" | null;
  readonly protocolSlot: string | null;
}

export interface LocalPhotoCaptureQualityProgressDtoV0 {
  readonly phase: LocalPhotoCaptureQualityPhaseV0;
  readonly completed: number;
  readonly total: number;
  readonly currentPath: string | null;
}

export interface LocalPhotoCaptureQualityPhotoResultDtoV0 {
  readonly imageId: string;
  readonly path: string;
  readonly role: "build" | "heldout";
  readonly protocolSlot: string | null;
  readonly verdict: "pass" | "review" | "retake";
  readonly decodeStatus: "decoded" | "decode_failed";
  readonly megapixels: number | null;
  readonly tenengrad: number | null;
  readonly shadowClippedFraction: number | null;
  readonly highlightClippedFraction: number | null;
  readonly rawCounterpartState: "present_unreviewed" | "missing";
  readonly issues: readonly {
    readonly code: string;
    readonly severity: "review" | "retake";
    readonly guidance: string;
  }[];
  readonly thumbnail: {
    readonly mediaType: "image/webp";
    readonly sha256: string;
    readonly widthPx: number;
    readonly heightPx: number;
  } | null;
}

export interface LocalPhotoCaptureQualityReportSummaryDtoV0 {
  readonly schemaVersion: string;
  readonly reportSha256: string;
  readonly generatedAt: string;
  readonly readiness:
    | "capture_quality_ready"
    | "review_required"
    | "retake_required";
  readonly protocolStatus: "complete_unreviewed" | "incomplete";
  readonly buildCount: number;
  readonly heldoutCount: number;
  readonly ignoredCount: number;
  readonly passCount: number;
  readonly reviewCount: number;
  readonly retakeCount: number;
  readonly missingBuildSlots: readonly string[];
  readonly missingHeldoutSlots: readonly string[];
  readonly duplicateSlots: readonly string[];
  readonly misassignedSlots: readonly string[];
  readonly unmatchedAssignedPaths: readonly string[];
  readonly similarityFindings: readonly {
    readonly leftImageId: string;
    readonly rightImageId: string;
    readonly kind:
      | "within_role_near_duplicate"
      | "cross_role_holdout_overlap_risk";
    readonly hammingDistance: number;
    readonly guidance: string;
  }[];
  readonly photos: readonly LocalPhotoCaptureQualityPhotoResultDtoV0[];
}

export interface LocalPhotoCaptureQualityDtoV0 {
  readonly state: LocalPhotoCaptureQualityStateV0;
  readonly runRevision: number;
  readonly message: string;
  readonly receiptSha256: string | null;
  readonly requestId: string | null;
  readonly candidates: readonly LocalPhotoCaptureQualityCandidateDtoV0[];
  readonly progress: LocalPhotoCaptureQualityProgressDtoV0;
  readonly report: LocalPhotoCaptureQualityReportSummaryDtoV0 | null;
  readonly failureCode: string | null;
}

export type LocalPhotoCaptureQualityRunnerV0 = (
  options: {
    readonly sourceRoot: string;
    readonly receipt: FoundryUniversalIntakeReceipt;
    readonly assignments: readonly FoundryPhotoCaptureQualityRequestedAssignmentV0[];
    readonly signal: AbortSignal;
    readonly onProgress: (
      progress: FoundryPhotoCaptureQualityWorkerProgressV0,
    ) => void;
  },
) => Promise<FoundryPhotoCaptureQualityWorkerV0Result>;

export interface CreateLocalPhotoCaptureQualityControllerV0Options {
  readonly sourceRoot: string;
  readonly runner?: LocalPhotoCaptureQualityRunnerV0;
  readonly settlementTimeoutMs?: number;
}

interface ActiveRun {
  readonly requestId: string;
  readonly cancellation: AbortController;
  completion: Promise<void>;
  cancelReason: "operator" | "stop" | null;
}

function safeSettlementTimeout(value: number | undefined): number {
  const timeout = value ?? 15_000;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < MIN_SETTLEMENT_TIMEOUT_MS ||
    timeout > MAX_SETTLEMENT_TIMEOUT_MS
  ) {
    throw new Error(
      `Photo workbench settlement timeout must be ${String(MIN_SETTLEMENT_TIMEOUT_MS)}-${String(MAX_SETTLEMENT_TIMEOUT_MS)} ms.`,
    );
  }
  return timeout;
}

function candidateDto(
  candidate: FoundryPhotoCaptureQualityCandidateV0,
): LocalPhotoCaptureQualityCandidateDtoV0 {
  return {
    path: candidate.path,
    mediaType: candidate.mediaType,
    sizeBytes: candidate.sizeBytes,
    suggestedRole: candidate.suggestedRole,
    assignedRole: null,
    protocolSlot: candidate.protocolSlot,
  };
}

function emptyProgress(
  phase: LocalPhotoCaptureQualityPhaseV0,
): LocalPhotoCaptureQualityProgressDtoV0 {
  return { phase, completed: 0, total: 0, currentPath: null };
}

function unavailableDto(
  message: string,
): LocalPhotoCaptureQualityDtoV0 {
  return {
    state: "unavailable",
    runRevision: 0,
    message,
    receiptSha256: null,
    requestId: null,
    candidates: [],
    progress: emptyProgress("unavailable"),
    report: null,
    failureCode: null,
  };
}

export const LOCAL_PHOTO_CAPTURE_QUALITY_NOT_BOUND_DTO_V0 = Object.freeze(
  unavailableDto("Select a photo folder and wait for the intake receipt."),
);

function cloneDto(
  value: LocalPhotoCaptureQualityDtoV0,
): LocalPhotoCaptureQualityDtoV0 {
  return structuredClone(value);
}

function reportSummary(
  reportInput: FoundryPhotoCaptureQualityReportV0,
): LocalPhotoCaptureQualityReportSummaryDtoV0 {
  const report = FoundryPhotoCaptureQualityReportV0Schema.parse(reportInput);
  return {
    schemaVersion: report.schemaVersion,
    reportSha256: report.reportSha256,
    generatedAt: report.generatedAt,
    readiness: report.summary.readiness,
    protocolStatus: report.protocolCoverage.status,
    buildCount: report.summary.assignedBuildCount,
    heldoutCount: report.summary.assignedHeldoutCount,
    ignoredCount: report.summary.ignoredCount,
    passCount: report.summary.passCount,
    reviewCount: report.summary.reviewCount,
    retakeCount: report.summary.retakeCount,
    missingBuildSlots: [...report.protocolCoverage.missingBuildSlots],
    missingHeldoutSlots: [...report.protocolCoverage.missingHeldoutSlots],
    duplicateSlots: [...report.protocolCoverage.duplicateSlots],
    misassignedSlots: [...report.protocolCoverage.misassignedSlots],
    unmatchedAssignedPaths: [
      ...report.protocolCoverage.unmatchedAssignedPaths,
    ],
    similarityFindings: report.similarityFindings.map((finding) => ({ ...finding })),
    photos: report.photos.map((photo) => ({
      imageId: photo.imageId,
      path: photo.source.path,
      role: photo.source.role,
      protocolSlot: photo.source.protocolSlot,
      verdict: photo.verdict,
      decodeStatus: photo.decode.status,
      megapixels: photo.decode.status === "decoded"
        ? photo.decode.metrics.sourceMegapixels
        : null,
      tenengrad: photo.decode.status === "decoded"
        ? photo.decode.metrics.tenengrad
        : null,
      shadowClippedFraction: photo.decode.status === "decoded"
        ? photo.decode.metrics.shadowClippedFraction
        : null,
      highlightClippedFraction: photo.decode.status === "decoded"
        ? photo.decode.metrics.highlightClippedFraction
        : null,
      rawCounterpartState: photo.rawCounterpart.state,
      issues: photo.issues.map((issue) => ({ ...issue })),
      thumbnail: photo.decode.status === "decoded"
        ? {
            mediaType: photo.decode.thumbnail.mediaType,
            sha256: photo.decode.thumbnail.sha256,
            widthPx: photo.decode.thumbnail.widthPx,
            heightPx: photo.decode.thumbnail.heightPx,
          }
        : null,
    })),
  };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof FoundryIntegrityError) return error.code;
  if (
    error instanceof Error &&
    error.name === "AbortError"
  ) {
    return "PHOTO_CAPTURE_QUALITY_CANCELLED";
  }
  return "PHOTO_CAPTURE_QUALITY_FAILED";
}

function cancellationMessage(reason: ActiveRun["cancelReason"]): string {
  return reason === "stop"
    ? "The photo workbench stopped. No report or thumbnails were retained."
    : "The photo analysis was cancelled. No report or thumbnails were retained.";
}

async function waitForSettlement(
  completion: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      completion.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class LocalPhotoCaptureQualityControllerV0 {
  readonly #sourceRoot: string;
  readonly #runner: LocalPhotoCaptureQualityRunnerV0;
  readonly #settlementTimeoutMs: number;
  #receipt: FoundryUniversalIntakeReceipt | null = null;
  #dto: LocalPhotoCaptureQualityDtoV0 = LOCAL_PHOTO_CAPTURE_QUALITY_NOT_BOUND_DTO_V0;
  #active: ActiveRun | null = null;
  #runRevision = 0;
  #completedReport: FoundryPhotoCaptureQualityReportV0 | null = null;
  #thumbnails = new Map<string, Buffer>();

  constructor(options: CreateLocalPhotoCaptureQualityControllerV0Options) {
    this.#sourceRoot = options.sourceRoot;
    this.#runner = options.runner ?? ((runnerOptions) =>
      runFoundryPhotoCaptureQualityWorkerV0({
        sourceRoot: runnerOptions.sourceRoot,
        receipt: runnerOptions.receipt,
        assignments: runnerOptions.assignments,
        signal: runnerOptions.signal,
        onProgress: runnerOptions.onProgress,
      }));
    this.#settlementTimeoutMs = safeSettlementTimeout(options.settlementTimeoutMs);
  }

  bindReceipt(input: FoundryUniversalIntakeReceipt): void {
    const receipt = FoundryUniversalIntakeReceiptSchema.parse(input);
    if (
      this.#receipt !== null &&
      this.#receipt.receiptSha256 !== receipt.receiptSha256
    ) {
      throw new FoundryIntegrityError(
        "PHOTO_WORKBENCH_RECEIPT_REBIND_REFUSED",
        "The photo workbench cannot be rebound to a different intake receipt.",
      );
    }
    if (this.#receipt !== null) return;
    this.#receipt = structuredClone(receipt);
    const candidates = listFoundryPhotoCaptureQualityCandidatesV0(receipt);
    if (receipt.source.kind !== "directory") {
      this.#dto = {
        ...unavailableDto("Select a folder containing JPEG or PNG captures; a single file cannot form the pilot split."),
        receiptSha256: receipt.receiptSha256,
      };
      return;
    }
    if (candidates.length === 0) {
      this.#dto = {
        ...unavailableDto("This source folder has no receipt-verified JPEG or PNG captures to analyse."),
        receiptSha256: receipt.receiptSha256,
      };
      return;
    }
    this.#dto = {
      state: "ready",
      runRevision: this.#runRevision,
      message: "Confirm which captures may build the pilot and which must stay held out.",
      receiptSha256: receipt.receiptSha256,
      requestId: null,
      candidates: candidates.map(candidateDto),
      progress: emptyProgress("ready"),
      report: null,
      failureCode: null,
    };
  }

  snapshot(requestId?: string): LocalPhotoCaptureQualityDtoV0 {
    if (requestId !== undefined && this.#dto.requestId !== requestId) {
      return {
        ...cloneDto(this.#dto),
        state: "failed",
        message: "This photo-workbench request is stale for the current local session.",
        requestId,
        progress: emptyProgress("failed"),
        report: null,
        failureCode: "STALE_PHOTO_WORKBENCH_REQUEST",
      };
    }
    return cloneDto(this.#dto);
  }

  start(input: LocalPhotoCaptureQualityStartRequestV0): Promise<void> {
    const request = parseLocalPhotoCaptureQualityStartRequestV0(input);
    if (this.#receipt === null || this.#dto.state === "unavailable") {
      throw new FoundryIntegrityError(
        "PHOTO_WORKBENCH_UNAVAILABLE",
        "No receipt-bound photo workbench is available for this local session.",
      );
    }
    if (request.receiptSha256 !== this.#receipt.receiptSha256) {
      throw new FoundryIntegrityError(
        "PHOTO_WORKBENCH_STALE_RECEIPT",
        "The intake receipt changed. Refresh before starting the photo analysis.",
      );
    }
    if (this.#active !== null) {
      throw new FoundryIntegrityError(
        "PHOTO_WORKBENCH_ALREADY_RUNNING",
        "A photo analysis is already running in this local session.",
      );
    }
    this.#completedReport = null;
    this.#thumbnails.clear();
    const active: ActiveRun = {
      requestId: request.requestId,
      cancellation: new AbortController(),
      completion: Promise.resolve(),
      cancelReason: null,
    };
    this.#active = active;
    const activeCount = request.assignments.filter(
      (assignment) => assignment.role !== "ignore",
    ).length;
    this.#runRevision += 1;
    const assignedRoles = new Map(
      request.assignments.map((assignment) => [
        assignment.path,
        assignment.role,
      ]),
    );
    this.#dto = {
      state: "running",
      runRevision: this.#runRevision,
      message: "Reading the selected JPEG/PNG pixels one file at a time.",
      receiptSha256: this.#receipt.receiptSha256,
      requestId: request.requestId,
      candidates: this.#dto.candidates.map((candidate) => ({
        ...candidate,
        assignedRole: assignedRoles.get(candidate.path) ?? null,
      })),
      progress: {
        phase: "reading_pixels",
        completed: 0,
        total: activeCount,
        currentPath: null,
      },
      report: null,
      failureCode: null,
    };
    active.completion = this.#execute(active, request.assignments);
    return active.completion;
  }

  async cancel(requestId: string): Promise<LocalPhotoCaptureQualityDtoV0> {
    if (!REQUEST_ID.test(requestId)) {
      throw new FoundryIntegrityError(
        "INVALID_PHOTO_WORKBENCH_REQUEST_ID",
        "The photo-workbench request ID is invalid.",
      );
    }
    const active = this.#active;
    if (active === null || active.requestId !== requestId) {
      return this.snapshot(requestId);
    }
    active.cancelReason = "operator";
    active.cancellation.abort();
    const settled = await waitForSettlement(
      active.completion,
      this.#settlementTimeoutMs,
    );
    if (!settled && this.#active === active) {
      this.#active = null;
      this.#completedReport = null;
      this.#thumbnails.clear();
      this.#dto = {
        ...this.#dto,
        state: "failed",
        message: "Cancellation could not be confirmed; no report or thumbnails were accepted.",
        progress: emptyProgress("failed"),
        report: null,
        failureCode: "PHOTO_WORKBENCH_TERMINATION_UNCONFIRMED",
      };
    }
    return this.snapshot(requestId);
  }

  async stop(): Promise<void> {
    const active = this.#active;
    if (active !== null) {
      active.cancelReason = "stop";
      active.cancellation.abort();
      const settled = await waitForSettlement(
        active.completion,
        this.#settlementTimeoutMs,
      );
      if (!settled && this.#active === active) {
        this.#completedReport = null;
        this.#thumbnails.clear();
        this.#dto = {
          ...this.#dto,
          state: "failed",
          message: "The photo workbench could not confirm that its active pixel read stopped. The local session remains open.",
          progress: emptyProgress("failed"),
          report: null,
          failureCode: "PHOTO_WORKBENCH_TERMINATION_UNCONFIRMED",
        };
        throw new FoundryIntegrityError(
          "PHOTO_WORKBENCH_TERMINATION_UNCONFIRMED",
          "The active photo-workbench run did not settle before the stop deadline.",
        );
      }
    }
    this.#completedReport = null;
    this.#thumbnails.clear();
  }

  readCompletedReport(requestId: string): FoundryPhotoCaptureQualityReportV0 | null {
    if (
      this.#dto.state !== "completed" ||
      this.#dto.requestId !== requestId ||
      this.#completedReport === null
    ) {
      return null;
    }
    return structuredClone(this.#completedReport);
  }

  readThumbnail(
    requestId: string,
    imageId: string,
    expectedSha256: string,
  ): { readonly bytes: Buffer; readonly sha256: string } | null {
    if (
      this.#dto.state !== "completed" ||
      this.#dto.requestId !== requestId ||
      !SHA256.test(expectedSha256) ||
      this.#completedReport === null
    ) {
      return null;
    }
    const photo = this.#completedReport.photos.find(
      (candidate) => candidate.imageId === imageId,
    );
    if (
      photo?.decode.status !== "decoded" ||
      photo.decode.thumbnail.sha256 !== expectedSha256
    ) {
      return null;
    }
    const bytes = this.#thumbnails.get(imageId);
    if (bytes === undefined) return null;
    return { bytes: Buffer.from(bytes), sha256: expectedSha256 };
  }

  async #execute(
    active: ActiveRun,
    assignments: readonly FoundryPhotoCaptureQualityRequestedAssignmentV0[],
  ): Promise<void> {
    const receipt = this.#receipt;
    if (receipt === null) return;
    try {
      const result = await this.#runner({
        sourceRoot: this.#sourceRoot,
        receipt,
        assignments,
        signal: active.cancellation.signal,
        onProgress: (progress) => {
          if (this.#active !== active || active.cancellation.signal.aborted) return;
          this.#dto = {
            ...this.#dto,
            message: progress.currentPath === null
              ? "Checking capture pixels and split integrity."
              : `Checking ${progress.currentPath}`,
            progress: {
              phase: "reading_pixels",
              completed: progress.completed,
              total: progress.total,
              currentPath: progress.currentPath,
            },
          };
        },
      });
      if (this.#active !== active || active.cancellation.signal.aborted) return;
      this.#dto = {
        ...this.#dto,
        message: "Binding the photo findings to the final report digest.",
        progress: {
          ...this.#dto.progress,
          phase: "binding_report",
          currentPath: null,
        },
      };
      const report = FoundryPhotoCaptureQualityReportV0Schema.parse(result.report);
      if (report.sourceReceiptSha256 !== receipt.receiptSha256) {
        throw new FoundryIntegrityError(
          "PHOTO_WORKBENCH_REPORT_RECEIPT_MISMATCH",
          "The completed photo report is not bound to the current intake receipt.",
        );
      }
      const summary = reportSummary(report);
      const acceptedThumbnails = new Map<string, Buffer>();
      for (const photo of report.photos) {
        if (photo.decode.status !== "decoded") continue;
        const bytes = result.thumbnails.get(photo.imageId);
        if (bytes === undefined) {
          throw new FoundryIntegrityError(
            "PHOTO_WORKBENCH_THUMBNAIL_MISSING",
            "A completed decoded photo has no in-memory thumbnail.",
          );
        }
        acceptedThumbnails.set(photo.imageId, Buffer.from(bytes));
      }
      this.#completedReport = structuredClone(report);
      this.#thumbnails = acceptedThumbnails;
      this.#dto = {
        ...this.#dto,
        state: "completed",
        message: summary.readiness === "capture_quality_ready"
          ? "Capture quality is ready for the next registration test; the held-out set remains excluded."
          : summary.readiness === "review_required"
            ? "The capture set needs human review before registration."
            : "Retakes or protocol repairs are required before registration.",
        progress: {
          phase: "completed",
          completed: this.#dto.progress.total,
          total: this.#dto.progress.total,
          currentPath: null,
        },
        report: summary,
        failureCode: null,
      };
    } catch (error: unknown) {
      if (this.#active !== active) return;
      this.#completedReport = null;
      this.#thumbnails.clear();
      if (active.cancellation.signal.aborted) {
        this.#dto = {
          ...this.#dto,
          state: "cancelled",
          message: cancellationMessage(active.cancelReason),
          progress: emptyProgress("cancelled"),
          report: null,
          failureCode: null,
        };
        return;
      }
      const failureCode = safeFailureCode(error);
      this.#dto = {
        ...this.#dto,
        state: "failed",
        message: `The photo analysis failed safely (${failureCode}). No report or thumbnails were retained.`,
        progress: emptyProgress("failed"),
        report: null,
        failureCode,
      };
    } finally {
      if (this.#active === active) this.#active = null;
    }
  }
}

export function createLocalPhotoCaptureQualityControllerV0(
  options: CreateLocalPhotoCaptureQualityControllerV0Options,
): LocalPhotoCaptureQualityControllerV0 {
  return new LocalPhotoCaptureQualityControllerV0(options);
}

import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0,
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
  FoundryUniversalIntakeReceiptSchema,
  admitUniversalIntakeReceipt,
  compileFoundryLocalIntakeWorkspaceIntentV0,
  deleteFoundryLocalIntakeWorkspaceV0,
  inspectFoundryLocalIntakeWorkspaceV0,
  resumeFoundryLocalIntakeWorkspaceV0,
  startFoundryLocalIntakeWorkspaceV0,
  verifyFoundryLocalIntakeWorkspaceV0,
  type FoundryGuidedAdmissionDraft,
  type FoundryLocalIntakeWorkspaceIndexV0,
  type FoundryLocalIntakeWorkspaceProgressV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";

export const LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0 =
  "omnitwin.foundry.local-intake-workspace-controller.v0";
export const LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0 =
  "copy_into_local_workspace";
export const LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0 =
  "delete_local_workspace_copy";
export const LOCAL_INTAKE_WORKSPACE_SETTLEMENT_TIMEOUT_MS = 5_000;

const REQUEST_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SETTLEMENT_TIMEOUT_MS = 60_000;

export type LocalIntakeWorkspaceStateV0 =
  | "unavailable"
  | "ready"
  | "copying"
  | "verifying"
  | "stored"
  | "failed"
  | "deleting"
  | "deleted";

export type LocalIntakeWorkspaceOperationV0 =
  | typeof LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0
  | typeof LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0
  | null;

export interface LocalIntakeWorkspaceStartRequestV0 {
  readonly requestId: string;
  readonly receiptSha256: string;
  readonly confirmation: typeof LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0;
}

export interface LocalIntakeWorkspaceStatusRequestV0 {
  readonly requestId: string;
}

export interface LocalIntakeWorkspaceDeleteRequestV0 {
  readonly requestId: string;
  readonly receiptSha256: string;
  readonly workspaceSha256: string;
  readonly confirmation: typeof LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0;
}

export interface LocalIntakeWorkspaceProgressDtoV0 {
  readonly copiedFileCount: number;
  readonly fileCount: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

export interface LocalIntakeWorkspaceTruthDtoV0 {
  readonly pendingReview: number;
  readonly admitted: number;
  readonly excluded: number;
  readonly captured: number;
  readonly enhancedCaptured: number;
  readonly generatedCinematic: number;
  readonly conceptImagination: number;
}

export interface LocalIntakeWorkspaceSummaryDtoV0 {
  readonly workspaceSha256: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0;
}

export interface LocalIntakeWorkspaceDtoV0 {
  readonly schemaVersion: typeof LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0;
  readonly state: LocalIntakeWorkspaceStateV0;
  readonly authority: "none";
  readonly operation: LocalIntakeWorkspaceOperationV0;
  readonly configured: boolean;
  readonly receiptSha256: string | null;
  readonly requestId: string | null;
  readonly message: string;
  readonly failureCode: string | null;
  readonly progress: LocalIntakeWorkspaceProgressDtoV0 | null;
  readonly workspace: LocalIntakeWorkspaceSummaryDtoV0 | null;
}

export interface LocalIntakeWorkspaceTrustedContextV0 {
  readonly sourceRoot: string;
  readonly workspaceDirectory: string;
}

export interface CreateLocalIntakeWorkspaceControllerV0Options {
  readonly trustedContext: LocalIntakeWorkspaceTrustedContextV0 | null;
  /** Process-owned core seam. Browser requests can never choose filesystem operations. */
  readonly core?: LocalIntakeWorkspaceCoreHooksV0;
  /** Process-owned clock seam. Browser requests can never choose workspace evidence time. */
  readonly now?: () => Date;
  readonly settlementTimeoutMs?: number;
}

export interface LocalIntakeWorkspaceCoreProgressV0 {
  readonly phase: "validating_source" | "copying" | "verifying_workspace" | "complete";
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly currentFileOrdinal: number | null;
}

export type LocalIntakeWorkspaceCompletedIndexV0 = FoundryLocalIntakeWorkspaceIndexV0;

export interface LocalIntakeWorkspaceCoreStoredV0 {
  readonly index: LocalIntakeWorkspaceCompletedIndexV0;
  readonly receiptSha256: string;
  readonly workspace: LocalIntakeWorkspaceSummaryDtoV0;
}

export type LocalIntakeWorkspaceCoreInspectionV0 =
  | { readonly kind: "missing" }
  | { readonly kind: "incomplete"; readonly intentSha256: string }
  | { readonly kind: "stored"; readonly stored: LocalIntakeWorkspaceCoreStoredV0 };

export interface LocalIntakeWorkspaceCoreHooksV0 {
  readonly inspect: (
    context: LocalIntakeWorkspaceTrustedContextV0,
  ) => Promise<LocalIntakeWorkspaceCoreInspectionV0>;
  readonly start: (input: {
    readonly context: LocalIntakeWorkspaceTrustedContextV0;
    readonly workspaceId: string;
    readonly createdAt: string;
    readonly receipt: FoundryUniversalIntakeReceipt;
    readonly admissionDraft: FoundryGuidedAdmissionDraft | null;
    readonly signal: AbortSignal;
    readonly onProgress: (progress: LocalIntakeWorkspaceCoreProgressV0) => void;
  }) => Promise<LocalIntakeWorkspaceCoreStoredV0>;
  readonly resume: (input: {
    readonly context: LocalIntakeWorkspaceTrustedContextV0;
    readonly expectedIntentSha256: string;
    readonly signal: AbortSignal;
    readonly onProgress: (progress: LocalIntakeWorkspaceCoreProgressV0) => void;
  }) => Promise<LocalIntakeWorkspaceCoreStoredV0>;
  readonly delete: (input: {
    readonly context: LocalIntakeWorkspaceTrustedContextV0;
    readonly expectedWorkspaceSha256: string;
  }) => Promise<void>;
}

type LocalIntakeWorkspaceCoreStartInputV0 = Parameters<
  LocalIntakeWorkspaceCoreHooksV0["start"]
>[0];
type LocalIntakeWorkspaceCoreResumeInputV0 = Parameters<
  LocalIntakeWorkspaceCoreHooksV0["resume"]
>[0];
type LocalIntakeWorkspaceCoreDeleteInputV0 = Parameters<
  LocalIntakeWorkspaceCoreHooksV0["delete"]
>[0];

export class LocalIntakeWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalIntakeWorkspaceError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LocalIntakeWorkspaceError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

export function parseLocalIntakeWorkspaceStartRequestV0(
  input: unknown,
): LocalIntakeWorkspaceStartRequestV0 {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["confirmation", "receiptSha256", "requestId"]) ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.receiptSha256 !== "string" ||
    !SHA256.test(input.receiptSha256) ||
    input.confirmation !== LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_START_REQUEST_INVALID",
      "The copy request must contain only one opaque request ID, the current receipt digest, and the exact copy confirmation.",
    );
  }
  return Object.freeze({
    requestId: input.requestId,
    receiptSha256: input.receiptSha256,
    confirmation: input.confirmation,
  });
}

export function parseLocalIntakeWorkspaceStatusRequestV0(
  input: unknown,
): LocalIntakeWorkspaceStatusRequestV0 {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["requestId"]) ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID.test(input.requestId)
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_STATUS_REQUEST_INVALID",
      "The workspace request must contain only one opaque request ID.",
    );
  }
  return Object.freeze({ requestId: input.requestId });
}

export function parseLocalIntakeWorkspaceDeleteRequestV0(
  input: unknown,
): LocalIntakeWorkspaceDeleteRequestV0 {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      "confirmation",
      "receiptSha256",
      "requestId",
      "workspaceSha256",
    ]) ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID.test(input.requestId) ||
    typeof input.receiptSha256 !== "string" ||
    !SHA256.test(input.receiptSha256) ||
    typeof input.workspaceSha256 !== "string" ||
    !SHA256.test(input.workspaceSha256) ||
    input.confirmation !== LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_DELETE_REQUEST_INVALID",
      "The delete request must contain only one opaque request ID, both current digests, and the exact local-copy deletion confirmation.",
    );
  }
  return Object.freeze({
    requestId: input.requestId,
    receiptSha256: input.receiptSha256,
    workspaceSha256: input.workspaceSha256,
    confirmation: input.confirmation,
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function dto(input: {
  readonly state: LocalIntakeWorkspaceStateV0;
  readonly configured: boolean;
  readonly operation?: LocalIntakeWorkspaceOperationV0;
  readonly receiptSha256?: string | null;
  readonly requestId?: string | null;
  readonly message: string;
  readonly failureCode?: string | null;
  readonly progress?: LocalIntakeWorkspaceProgressDtoV0 | null;
  readonly workspace?: LocalIntakeWorkspaceSummaryDtoV0 | null;
}): LocalIntakeWorkspaceDtoV0 {
  return deepFreeze({
    schemaVersion: LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0,
    state: input.state,
    authority: "none",
    operation: input.operation ?? null,
    configured: input.configured,
    receiptSha256: input.receiptSha256 ?? null,
    requestId: input.requestId ?? null,
    message: input.message,
    failureCode: input.failureCode ?? null,
    progress: input.progress ?? null,
    workspace: input.workspace ?? null,
  });
}

function cloneDto(value: LocalIntakeWorkspaceDtoV0): LocalIntakeWorkspaceDtoV0 {
  return deepFreeze(structuredClone(value));
}

function canonicalLocalAbsolutePath(value: string): string {
  const canonical = resolve(value);
  if (
    value.length === 0 ||
    !isAbsolute(value) ||
    value !== canonical ||
    /^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u.test(value)
  ) {
    throw new TypeError("local-intake workspace paths must be canonical local absolute paths");
  }
  return canonical;
}

function copyTrustedContext(
  input: LocalIntakeWorkspaceTrustedContextV0,
): LocalIntakeWorkspaceTrustedContextV0 {
  return Object.freeze({
    sourceRoot: canonicalLocalAbsolutePath(input.sourceRoot),
    workspaceDirectory: canonicalLocalAbsolutePath(input.workspaceDirectory),
  });
}

function validSettlementTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SETTLEMENT_TIMEOUT_MS;
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateProgress(
  input: LocalIntakeWorkspaceCoreProgressV0,
): LocalIntakeWorkspaceProgressDtoV0 {
  if (
    !safeCount(input.completedFiles) ||
    !safeCount(input.totalFiles) ||
    !safeCount(input.completedBytes) ||
    !safeCount(input.totalBytes) ||
    input.completedFiles > input.totalFiles ||
    input.completedBytes > input.totalBytes ||
    (input.currentFileOrdinal !== null &&
      (!Number.isSafeInteger(input.currentFileOrdinal) ||
        input.currentFileOrdinal < 1 ||
        input.currentFileOrdinal > input.totalFiles))
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_PROGRESS_INVALID",
      "The local copy reported invalid bounded progress and was stopped.",
    );
  }
  return Object.freeze({
    copiedFileCount: input.completedFiles,
    fileCount: input.totalFiles,
    copiedBytes: input.completedBytes,
    totalBytes: input.totalBytes,
  });
}

function validateTruth(input: LocalIntakeWorkspaceTruthDtoV0, fileCount: number): void {
  const counts = [
    input.pendingReview,
    input.admitted,
    input.excluded,
    input.captured,
    input.enhancedCaptured,
    input.generatedCinematic,
    input.conceptImagination,
  ];
  if (
    counts.some((value) => !safeCount(value)) ||
    input.pendingReview + input.admitted + input.excluded !== fileCount ||
    input.captured +
        input.enhancedCaptured +
        input.generatedCinematic +
        input.conceptImagination !==
      input.admitted
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_REPORT_INVALID",
      "The verified local-copy report has inconsistent truth counts.",
    );
  }
}

function validateStored(
  input: LocalIntakeWorkspaceCoreStoredV0,
): LocalIntakeWorkspaceCoreStoredV0 {
  if (
    !SHA256.test(input.receiptSha256) ||
    !SHA256.test(input.workspace.workspaceSha256) ||
    !safeCount(input.workspace.fileCount) ||
    !safeCount(input.workspace.totalBytes) ||
    !isRecord(input.index)
  ) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_REPORT_INVALID",
      "The completed local-copy report is invalid.",
    );
  }
  validateTruth(input.workspace.truth, input.workspace.fileCount);
  return deepFreeze(structuredClone(input));
}

function validatedDraft(
  receipt: FoundryUniversalIntakeReceipt,
  input: FoundryGuidedAdmissionDraft,
): FoundryGuidedAdmissionDraft {
  let expected: FoundryGuidedAdmissionDraft["result"];
  try {
    expected = admitUniversalIntakeReceipt(receipt, input.review);
  } catch {
    fail(
      "LOCAL_INTAKE_WORKSPACE_ADMISSION_DRAFT_INVALID",
      "The guided review draft does not bind the current intake receipt.",
    );
  }
  if (JSON.stringify(expected) !== JSON.stringify(input.result)) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_ADMISSION_DRAFT_INVALID",
      "The guided review draft does not bind the current intake receipt.",
    );
  }
  return deepFreeze(structuredClone(input));
}

function expectedTruth(
  receipt: FoundryUniversalIntakeReceipt,
  draft: FoundryGuidedAdmissionDraft | null,
): LocalIntakeWorkspaceTruthDtoV0 {
  if (draft === null) {
    return Object.freeze({
      pendingReview: receipt.summary.fileCount,
      admitted: 0,
      excluded: 0,
      captured: 0,
      enhancedCaptured: 0,
      generatedCinematic: 0,
      conceptImagination: 0,
    });
  }
  const assets = draft.result.manifest.assets;
  return Object.freeze({
    pendingReview: 0,
    admitted: assets.length,
    excluded: draft.result.exclusions.length,
    captured: assets.filter((asset) => asset.provenanceClass === "captured").length,
    enhancedCaptured: assets.filter(
      (asset) => asset.provenanceClass === "enhanced_captured",
    ).length,
    generatedCinematic: assets.filter(
      (asset) => asset.provenanceClass === "generated_cinematic",
    ).length,
    conceptImagination: assets.filter(
      (asset) => asset.provenanceClass === "concept_imagination",
    ).length,
  });
}

function sameTruth(
  left: LocalIntakeWorkspaceTruthDtoV0,
  right: LocalIntakeWorkspaceTruthDtoV0,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface ActiveOperation {
  readonly kind: "copy" | "delete";
  readonly requestId: string;
  readonly abortController: AbortController | null;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  completion: Promise<LocalIntakeWorkspaceDtoV0>;
  abortCode: string | null;
  acceptResult: boolean;
}

async function waitForSettlement(
  active: ActiveOperation,
  timeoutMs: number,
): Promise<boolean> {
  let cancelTimeout = (): void => undefined;
  const timeout = new Promise<boolean>((resolveTimeout) => {
    const timer = setTimeout(() => {
      resolveTimeout(false);
    }, timeoutMs);
    timer.unref();
    cancelTimeout = (): void => {
      clearTimeout(timer);
    };
  });
  try {
    return await Promise.race([active.settled.then(() => true), timeout]);
  } finally {
    cancelTimeout();
  }
}

function errorCode(error: unknown): string {
  if (
    error instanceof LocalIntakeWorkspaceError &&
    /^LOCAL_INTAKE_WORKSPACE_[A-Z0-9_]+$/u.test(error.code)
  ) {
    return error.code;
  }
  return "LOCAL_INTAKE_WORKSPACE_OPERATION_FAILED";
}

function failureMessage(code: string): string {
  switch (code) {
    case "LOCAL_INTAKE_WORKSPACE_CANCELLED":
      return "The local copy was cancelled. Nothing was approved, uploaded, reconstructed, trained, or published.";
    case "LOCAL_INTAKE_WORKSPACE_CONTROLLER_CLOSED":
      return "The local intake workspace controller is closed.";
    case "LOCAL_INTAKE_WORKSPACE_PROGRESS_INVALID":
      return "The local copy reported invalid progress and was stopped safely.";
    default:
      return "The local workspace operation failed safely. The original source was not changed.";
  }
}

function unavailableDto(
  _configured: boolean,
  _receiptSha256: string | null,
  closed: boolean,
): LocalIntakeWorkspaceDtoV0 {
  return dto({
    state: "unavailable",
    configured: false,
    receiptSha256: null,
    message: closed
      ? "The local intake workspace controller is closed."
      : _configured
        ? "Bind the current intake receipt before copying it into local app storage."
        : "No local workspace was selected when Foundry started. To keep a resumable copy, stop this session, select a new local workspace folder, and start Foundry again.",
  });
}

function summaryFromIndex(
  index: FoundryLocalIntakeWorkspaceIndexV0,
): LocalIntakeWorkspaceSummaryDtoV0 {
  let pendingReview = 0;
  let admitted = 0;
  let excluded = 0;
  let captured = 0;
  let enhancedCaptured = 0;
  let generatedCinematic = 0;
  let conceptImagination = 0;
  for (const entry of index.truth) {
    if (entry.state === "pending") {
      pendingReview += 1;
      continue;
    }
    if (entry.state === "excluded") {
      excluded += 1;
      continue;
    }
    admitted += 1;
    switch (entry.provenanceClass) {
      case "captured":
        captured += 1;
        break;
      case "enhanced_captured":
        enhancedCaptured += 1;
        break;
      case "generated_cinematic":
        generatedCinematic += 1;
        break;
      case "concept_imagination":
        conceptImagination += 1;
        break;
    }
  }
  const summary = {
    workspaceSha256: index.workspaceSha256,
    fileCount: index.fileCount,
    totalBytes: index.totalBytes,
    truth: {
      pendingReview,
      admitted,
      excluded,
      captured,
      enhancedCaptured,
      generatedCinematic,
      conceptImagination,
    },
  };
  validateTruth(summary.truth, summary.fileCount);
  return deepFreeze(summary);
}

function storedFromVerification(input: {
  readonly index: FoundryLocalIntakeWorkspaceIndexV0;
}): LocalIntakeWorkspaceCoreStoredV0 {
  return validateStored({
    index: input.index,
    receiptSha256: input.index.receiptSha256,
    workspace: summaryFromIndex(input.index),
  });
}

async function workspacePathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (
      isRecord(error) &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function createDefaultCoreHooks(): LocalIntakeWorkspaceCoreHooksV0 {
  return Object.freeze({
    inspect: async (context: LocalIntakeWorkspaceTrustedContextV0) => {
      if (!(await workspacePathExists(context.workspaceDirectory))) {
        return { kind: "missing" as const };
      }
      const status = await inspectFoundryLocalIntakeWorkspaceV0(
        context.workspaceDirectory,
      );
      if (status.state === "incomplete") {
        return {
          kind: "incomplete" as const,
          intentSha256: status.intentSha256,
        };
      }
      const verification = await verifyFoundryLocalIntakeWorkspaceV0(
        context.workspaceDirectory,
      );
      return {
        kind: "stored" as const,
        stored: storedFromVerification(verification),
      };
    },
    start: async (input: LocalIntakeWorkspaceCoreStartInputV0) => {
      const intent = compileFoundryLocalIntakeWorkspaceIntentV0({
        workspaceId: input.workspaceId,
        createdAt: input.createdAt,
        receipt: input.receipt,
        admissionDraft: input.admissionDraft,
      });
      const verification = await startFoundryLocalIntakeWorkspaceV0({
        workspaceDirectory: input.context.workspaceDirectory,
        sourcePath: input.context.sourceRoot,
        intent,
        confirmation: {
          operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
          intentSha256: intent.intentSha256,
        },
        signal: input.signal,
        onProgress: (progress: FoundryLocalIntakeWorkspaceProgressV0) => {
          input.onProgress(progress);
        },
      });
      return storedFromVerification(verification);
    },
    resume: async (input: LocalIntakeWorkspaceCoreResumeInputV0) => {
      const verification = await resumeFoundryLocalIntakeWorkspaceV0({
        workspaceDirectory: input.context.workspaceDirectory,
        sourcePath: input.context.sourceRoot,
        expectedIntentSha256: input.expectedIntentSha256,
        signal: input.signal,
        onProgress: (progress: FoundryLocalIntakeWorkspaceProgressV0) => {
          input.onProgress(progress);
        },
      });
      return storedFromVerification(verification);
    },
    delete: async (input: LocalIntakeWorkspaceCoreDeleteInputV0) => {
      await deleteFoundryLocalIntakeWorkspaceV0({
        workspaceDirectory: input.context.workspaceDirectory,
        expectedWorkspaceSha256: input.expectedWorkspaceSha256,
        confirmation: {
          operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0,
          workspaceSha256: input.expectedWorkspaceSha256,
        },
      });
    },
  });
}

export class LocalIntakeWorkspaceControllerV0 {
  readonly #context: LocalIntakeWorkspaceTrustedContextV0 | null;
  readonly #core: LocalIntakeWorkspaceCoreHooksV0;
  readonly #now: () => Date;
  readonly #settlementTimeoutMs: number;
  #receipt: FoundryUniversalIntakeReceipt | null = null;
  #admissionDraft: FoundryGuidedAdmissionDraft | null = null;
  #completed: LocalIntakeWorkspaceCoreStoredV0 | null = null;
  #resumeIntentSha256: string | null = null;
  #state: LocalIntakeWorkspaceDtoV0;
  #operationRequestId: string | null = null;
  #active: ActiveOperation | null = null;
  #initializePromise: Promise<LocalIntakeWorkspaceDtoV0> | null = null;
  #initialized = false;
  #closed = false;

  constructor(options: CreateLocalIntakeWorkspaceControllerV0Options) {
    const settlementTimeoutMs = options.settlementTimeoutMs ??
      LOCAL_INTAKE_WORKSPACE_SETTLEMENT_TIMEOUT_MS;
    if (!validSettlementTimeout(settlementTimeoutMs)) {
      throw new TypeError("settlementTimeoutMs is outside the fixed local-workspace bound");
    }
    this.#context = options.trustedContext === null
      ? null
      : copyTrustedContext(options.trustedContext);
    this.#core = options.core ?? createDefaultCoreHooks();
    this.#now = options.now ?? (() => new Date());
    this.#settlementTimeoutMs = settlementTimeoutMs;
    this.#state = unavailableDto(this.#context !== null, null, false);
  }

  initialize(): Promise<LocalIntakeWorkspaceDtoV0> {
    if (this.#initialized) return Promise.resolve(this.snapshot());
    if (this.#initializePromise !== null) return this.#initializePromise;
    this.#initializePromise = this.#runInitialize();
    return this.#initializePromise;
  }

  bindReceipt(
    input: FoundryUniversalIntakeReceipt,
    admissionDraft?: FoundryGuidedAdmissionDraft,
  ): void {
    if (this.#closed) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_CONTROLLER_CLOSED",
        "The local intake workspace controller is closed.",
      );
    }
    if (
      this.#active !== null ||
      (this.#operationRequestId !== null && this.#completed === null)
    ) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_RECEIPT_REBIND_REFUSED",
        "The local workspace cannot be rebound after a mutation request starts.",
      );
    }
    let receipt: FoundryUniversalIntakeReceipt;
    try {
      receipt = FoundryUniversalIntakeReceiptSchema.parse(input);
    } catch {
      fail(
        "LOCAL_INTAKE_WORKSPACE_RECEIPT_INVALID",
        "The local workspace requires a valid universal intake receipt.",
      );
    }
    const draft = admissionDraft === undefined
      ? null
      : validatedDraft(receipt, admissionDraft);
    if (
      this.#completed !== null &&
      this.#completed.receiptSha256 !== receipt.receiptSha256
    ) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_STALE_RECEIPT",
        "The supplied receipt does not match the verified local copy.",
      );
    }
    this.#receipt = structuredClone(receipt);
    this.#admissionDraft = draft === null ? null : structuredClone(draft);
    if (this.#context === null) {
      this.#state = unavailableDto(false, receipt.receiptSha256, false);
    } else if (this.#completed === null && this.#initialized) {
      this.#state = this.#readyDto();
    }
  }

  bindAdmissionDraft(input: FoundryGuidedAdmissionDraft): void {
    if (this.#closed) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_CONTROLLER_CLOSED",
        "The local intake workspace controller is closed.",
      );
    }
    if (this.#receipt === null) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_RECEIPT_NOT_BOUND",
        "Bind the current intake receipt before its guided review draft.",
      );
    }
    if (this.#active !== null || this.#operationRequestId !== null || this.#completed !== null) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_ADMISSION_REBIND_REFUSED",
        "The guided review draft cannot be rebound after a mutation request starts.",
      );
    }
    this.#admissionDraft = validatedDraft(this.#receipt, input);
  }

  availability(): LocalIntakeWorkspaceDtoV0 {
    return this.snapshot();
  }

  snapshot(requestId?: string): LocalIntakeWorkspaceDtoV0 {
    if (
      requestId !== undefined &&
      (!REQUEST_ID.test(requestId) ||
        (this.#operationRequestId !== null && requestId !== this.#operationRequestId))
    ) {
      return cloneDto(dto({
        state: "failed",
        configured: this.#context !== null,
        receiptSha256: this.#receipt?.receiptSha256 ?? this.#completed?.receiptSha256 ?? null,
        requestId,
        message: "This workspace request is stale for the current local session.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_STALE_REQUEST",
      }));
    }
    if (requestId !== undefined && this.#operationRequestId === null && this.#completed !== null) {
      return cloneDto({ ...this.#state, requestId });
    }
    return cloneDto(this.#state);
  }

  start(input: unknown): Promise<LocalIntakeWorkspaceDtoV0> {
    const request = parseLocalIntakeWorkspaceStartRequestV0(input);
    if (!this.#initialized) {
      return this.initialize().then(() => this.#startInitialized(request));
    }
    return this.#startInitialized(request);
  }

  async cancel(requestId: string): Promise<LocalIntakeWorkspaceDtoV0 | null> {
    if (!REQUEST_ID.test(requestId)) return null;
    const active = this.#active;
    if (active === null || active.kind !== "copy" || active.requestId !== requestId) {
      return requestId === this.#operationRequestId ? cloneDto(this.#state) : null;
    }
    this.#abort(active, "LOCAL_INTAKE_WORKSPACE_CANCELLED");
    if (!(await waitForSettlement(active, this.#settlementTimeoutMs))) {
      active.acceptResult = false;
      this.#state = dto({
        state: "failed",
        configured: this.#context !== null,
        operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
        receiptSha256: this.#receipt?.receiptSha256 ?? null,
        requestId,
        message: "The local copy could not be confirmed stopped. No completed workspace was accepted.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_SETTLEMENT_UNCONFIRMED",
        progress: this.#state.progress,
      });
    }
    return cloneDto(this.#state);
  }

  readCompletedIndex(requestId: string): LocalIntakeWorkspaceCompletedIndexV0 | null {
    if (
      this.#closed ||
      !REQUEST_ID.test(requestId) ||
      this.#completed === null ||
      this.#state.state !== "stored" ||
      (this.#operationRequestId !== null && requestId !== this.#operationRequestId)
    ) {
      return null;
    }
    return deepFreeze(structuredClone(this.#completed.index));
  }

  readCompletedReport(requestId: string): LocalIntakeWorkspaceCompletedIndexV0 | null {
    return this.readCompletedIndex(requestId);
  }

  delete(input: unknown): Promise<LocalIntakeWorkspaceDtoV0> {
    const request = parseLocalIntakeWorkspaceDeleteRequestV0(input);
    if (!this.#initialized) {
      return this.initialize().then(() => this.#deleteInitialized(request));
    }
    return this.#deleteInitialized(request);
  }

  async close(): Promise<void> {
    if (this.#closed && this.#active === null) return;
    this.#closed = true;
    const active = this.#active;
    if (active !== null) {
      if (active.kind === "copy") {
        this.#abort(active, "LOCAL_INTAKE_WORKSPACE_CONTROLLER_CLOSED");
      }
      if (!(await waitForSettlement(active, this.#settlementTimeoutMs))) {
        active.acceptResult = false;
        this.#completed = null;
        this.#state = unavailableDto(
          this.#context !== null,
          this.#receipt?.receiptSha256 ?? null,
          true,
        );
        fail(
          "LOCAL_INTAKE_WORKSPACE_SETTLEMENT_UNCONFIRMED",
          "The local workspace operation could not be confirmed stopped.",
        );
      }
    }
    this.#completed = null;
    this.#state = unavailableDto(
      this.#context !== null,
      this.#receipt?.receiptSha256 ?? null,
      true,
    );
  }

  async #runInitialize(): Promise<LocalIntakeWorkspaceDtoV0> {
    try {
      if (this.#closed) return this.snapshot();
      if (this.#context === null) {
        this.#initialized = true;
        return this.snapshot();
      }
      const inspection = await this.#core.inspect(this.#context);
      if (this.#acceptsResults()) this.#adoptInspection(inspection);
    } catch {
      if (!this.#closed) {
        this.#state = dto({
          state: "failed",
          configured: true,
          receiptSha256: this.#receipt?.receiptSha256 ?? null,
          message: "The app-owned local workspace could not be inspected safely.",
          failureCode: "LOCAL_INTAKE_WORKSPACE_INSPECTION_FAILED",
        });
      }
    } finally {
      this.#initialized = true;
    }
    return this.snapshot();
  }

  #adoptInspection(inspection: LocalIntakeWorkspaceCoreInspectionV0): void {
    if (inspection.kind === "stored") {
      const stored = validateStored(inspection.stored);
      if (
        this.#receipt !== null &&
        this.#receipt.receiptSha256 !== stored.receiptSha256
      ) {
        fail(
          "LOCAL_INTAKE_WORKSPACE_STALE_RECEIPT",
          "The verified local copy belongs to a different intake receipt.",
        );
      }
      this.#completed = stored;
      this.#resumeIntentSha256 = null;
      this.#operationRequestId = stored.workspace.workspaceSha256.slice(0, 32);
      this.#state = dto({
        state: "stored",
        configured: true,
        operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
        receiptSha256: stored.receiptSha256,
        requestId: this.#operationRequestId,
        message: "The verified local copy is stored in app-owned storage and is ready to resume.",
        progress: {
          copiedFileCount: stored.workspace.fileCount,
          fileCount: stored.workspace.fileCount,
          copiedBytes: stored.workspace.totalBytes,
          totalBytes: stored.workspace.totalBytes,
        },
        workspace: stored.workspace,
      });
      return;
    }
    if (
      inspection.kind === "incomplete" &&
      !SHA256.test(inspection.intentSha256)
    ) {
      fail(
        "LOCAL_INTAKE_WORKSPACE_INSPECTION_INVALID",
        "The interrupted local-copy record is invalid.",
      );
    }
    this.#completed = null;
    this.#resumeIntentSha256 = inspection.kind === "incomplete"
      ? inspection.intentSha256
      : null;
    this.#state = this.#receipt === null
      ? unavailableDto(true, null, false)
      : this.#readyDto();
  }

  #startInitialized(
    request: LocalIntakeWorkspaceStartRequestV0,
  ): Promise<LocalIntakeWorkspaceDtoV0> {
    if (this.#closed) return Promise.resolve(cloneDto(this.#state));
    if (this.#context === null || this.#receipt === null) {
      return Promise.resolve(cloneDto(this.#state));
    }
    if (request.receiptSha256 !== this.#receipt.receiptSha256) {
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        configured: true,
        operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
        receiptSha256: this.#receipt.receiptSha256,
        requestId: request.requestId,
        message: "The intake receipt changed. Refresh before copying into local app storage.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_STALE_RECEIPT",
      })));
    }
    const current = this.#active;
    if (current !== null) {
      if (current.requestId === request.requestId) return current.completion;
      return Promise.resolve(cloneDto(this.#busyDto(request.requestId)));
    }
    if (this.#completed !== null) {
      if (request.requestId === this.#operationRequestId) {
        return Promise.resolve(cloneDto(this.#state));
      }
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        configured: true,
        operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
        receiptSha256: this.#completed.receiptSha256,
        requestId: request.requestId,
        message: "A verified local copy is already stored. Refresh before starting another copy.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_ALREADY_STORED",
        workspace: this.#completed.workspace,
      })));
    }

    this.#operationRequestId = request.requestId;
    let resolveSettled = (): void => undefined;
    const settled = new Promise<void>((resolvePromise) => {
      resolveSettled = resolvePromise;
    });
    const active: ActiveOperation = {
      kind: "copy",
      requestId: request.requestId,
      abortController: new AbortController(),
      settled,
      resolveSettled,
      completion: Promise.resolve(this.#state),
      abortCode: null,
      acceptResult: true,
    };
    this.#active = active;
    this.#state = dto({
      state: "copying",
      configured: true,
      operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      receiptSha256: request.receiptSha256,
      requestId: request.requestId,
      message: this.#resumeIntentSha256 === null
        ? "Checking the selected intake before copying it into app-owned local storage."
        : "Checking the selected intake before resuming its local copy.",
      progress: {
        copiedFileCount: 0,
        fileCount: this.#receipt.summary.fileCount,
        copiedBytes: 0,
        totalBytes: this.#receipt.summary.totalBytes,
      },
    });
    active.completion = this.#runCopy(
      active,
      this.#context,
      structuredClone(this.#receipt),
      this.#admissionDraft === null ? null : structuredClone(this.#admissionDraft),
    );
    return active.completion;
  }

  async #runCopy(
    active: ActiveOperation,
    context: LocalIntakeWorkspaceTrustedContextV0,
    receipt: FoundryUniversalIntakeReceipt,
    admissionDraft: FoundryGuidedAdmissionDraft | null,
  ): Promise<LocalIntakeWorkspaceDtoV0> {
    try {
      const abortController = active.abortController;
      if (abortController === null) {
        fail(
          "LOCAL_INTAKE_WORKSPACE_OPERATION_FAILED",
          "The local copy did not have a cancellation boundary.",
        );
      }
      const onProgress = (progress: LocalIntakeWorkspaceCoreProgressV0): void => {
        if (!active.acceptResult || this.#closed || active.abortCode !== null) return;
        try {
          const browserProgress = validateProgress(progress);
          const verifying = progress.phase === "verifying_workspace" ||
            progress.phase === "complete";
          this.#state = dto({
            state: verifying ? "verifying" : "copying",
            configured: true,
            operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
            receiptSha256: receipt.receiptSha256,
            requestId: active.requestId,
            message: verifying
              ? "Rechecking the complete local copy against the selected intake receipt."
              : progress.phase === "copying"
                ? "Copying the selected intake into app-owned local storage."
                : "Checking that the selected intake still matches its receipt.",
            progress: browserProgress,
          });
        } catch (error) {
          this.#abort(active, errorCode(error));
        }
      };
      const inspection = await this.#core.inspect(context);
      if (inspection.kind === "stored") {
        const existing = validateStored(inspection.stored);
        if (existing.receiptSha256 !== receipt.receiptSha256) {
          fail(
            "LOCAL_INTAKE_WORKSPACE_STALE_RECEIPT",
            "The verified local copy belongs to a different intake receipt.",
          );
        }
        if (active.acceptResult && !this.#closed) {
          this.#completed = existing;
          this.#resumeIntentSha256 = null;
          this.#state = dto({
            state: "stored",
            configured: true,
            operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
            receiptSha256: existing.receiptSha256,
            requestId: active.requestId,
            message: "The verified local copy is already stored and ready to resume.",
            progress: {
              copiedFileCount: existing.workspace.fileCount,
              fileCount: existing.workspace.fileCount,
              copiedBytes: existing.workspace.totalBytes,
              totalBytes: existing.workspace.totalBytes,
            },
            workspace: existing.workspace,
          });
        }
        return cloneDto(this.#state);
      }
      const resumeIntentSha256 = inspection.kind === "incomplete"
        ? inspection.intentSha256
        : null;
      if (resumeIntentSha256 !== null && !SHA256.test(resumeIntentSha256)) {
        fail(
          "LOCAL_INTAKE_WORKSPACE_INSPECTION_INVALID",
          "The interrupted local-copy record is invalid.",
        );
      }
      this.#resumeIntentSha256 = resumeIntentSha256;
      const stored = validateStored(
        resumeIntentSha256 === null
          ? await this.#core.start({
              context,
              workspaceId: `local-${receipt.receiptSha256.slice(0, 24)}`,
              createdAt: this.#now().toISOString(),
              receipt,
              admissionDraft,
              signal: abortController.signal,
              onProgress,
            })
          : await this.#core.resume({
              context,
              expectedIntentSha256: resumeIntentSha256,
              signal: abortController.signal,
              onProgress,
            }),
      );
      if (active.abortCode !== null || abortController.signal.aborted) {
        fail(
          active.abortCode ?? "LOCAL_INTAKE_WORKSPACE_CANCELLED",
          "The local copy did not remain active through verification.",
        );
      }
      const truth = expectedTruth(receipt, admissionDraft);
      if (
        stored.receiptSha256 !== receipt.receiptSha256 ||
        stored.workspace.fileCount !== receipt.summary.fileCount ||
        stored.workspace.totalBytes !== receipt.summary.totalBytes ||
        (resumeIntentSha256 === null && !sameTruth(stored.workspace.truth, truth))
      ) {
        fail(
          "LOCAL_INTAKE_WORKSPACE_REPORT_INVALID",
          "The completed local-copy report does not match the bound intake evidence.",
        );
      }
      if (active.acceptResult && !this.#closed) {
        this.#completed = stored;
        this.#resumeIntentSha256 = null;
        this.#state = dto({
          state: "stored",
          configured: true,
          operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
          receiptSha256: receipt.receiptSha256,
          requestId: active.requestId,
          message: "The complete intake is stored as a verified local copy. Rights and reconstruction remain unapproved.",
          progress: {
            copiedFileCount: stored.workspace.fileCount,
            fileCount: stored.workspace.fileCount,
            copiedBytes: stored.workspace.totalBytes,
            totalBytes: stored.workspace.totalBytes,
          },
          workspace: stored.workspace,
        });
      }
    } catch (error) {
      const code = active.abortCode ?? errorCode(error);
      if (active.acceptResult && !this.#closed) {
        this.#completed = null;
        this.#state = dto({
          state: "failed",
          configured: true,
          operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
          receiptSha256: receipt.receiptSha256,
          requestId: active.requestId,
          message: failureMessage(code),
          failureCode: code,
          progress: this.#state.progress,
        });
      }
    } finally {
      if (this.#active === active) this.#active = null;
      active.resolveSettled();
    }
    return cloneDto(this.#state);
  }

  #deleteInitialized(
    request: LocalIntakeWorkspaceDeleteRequestV0,
  ): Promise<LocalIntakeWorkspaceDtoV0> {
    if (this.#closed || this.#context === null) {
      return Promise.resolve(cloneDto(this.#state));
    }
    const current = this.#active;
    if (current !== null) {
      if (current.kind === "delete" && current.requestId === request.requestId) {
        return current.completion;
      }
      return Promise.resolve(cloneDto(this.#busyDto(request.requestId)));
    }
    if (
      this.#state.state === "deleted" &&
      request.requestId === this.#operationRequestId
    ) {
      return Promise.resolve(cloneDto(this.#state));
    }
    const completed = this.#completed;
    if (completed === null) {
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        configured: true,
        operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
        receiptSha256: this.#receipt?.receiptSha256 ?? null,
        requestId: request.requestId,
        message: "There is no verified local copy to delete.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_NOT_STORED",
      })));
    }
    if (
      request.receiptSha256 !== completed.receiptSha256 ||
      request.workspaceSha256 !== completed.workspace.workspaceSha256
    ) {
      return Promise.resolve(cloneDto(dto({
        state: "failed",
        configured: true,
        operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
        receiptSha256: completed.receiptSha256,
        requestId: request.requestId,
        message: "The local copy changed. Refresh before confirming deletion.",
        failureCode: "LOCAL_INTAKE_WORKSPACE_STALE_DELETE_CONFIRMATION",
        workspace: completed.workspace,
      })));
    }
    this.#operationRequestId = request.requestId;
    let resolveSettled = (): void => undefined;
    const settled = new Promise<void>((resolvePromise) => {
      resolveSettled = resolvePromise;
    });
    const active: ActiveOperation = {
      kind: "delete",
      requestId: request.requestId,
      abortController: null,
      settled,
      resolveSettled,
      completion: Promise.resolve(this.#state),
      abortCode: null,
      acceptResult: true,
    };
    this.#active = active;
    this.#state = dto({
      state: "deleting",
      configured: true,
      operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      receiptSha256: completed.receiptSha256,
      requestId: request.requestId,
      message: "Deleting only the app-owned local copy. The original source is not changed.",
      workspace: completed.workspace,
    });
    active.completion = this.#runDelete(active, this.#context, completed);
    return active.completion;
  }

  async #runDelete(
    active: ActiveOperation,
    context: LocalIntakeWorkspaceTrustedContextV0,
    completed: LocalIntakeWorkspaceCoreStoredV0,
  ): Promise<LocalIntakeWorkspaceDtoV0> {
    try {
      await this.#core.delete({
        context,
        expectedWorkspaceSha256: completed.workspace.workspaceSha256,
      });
      if (active.acceptResult && !this.#closed) {
        this.#completed = null;
        this.#resumeIntentSha256 = null;
        this.#state = dto({
          state: "deleted",
          configured: true,
          operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
          receiptSha256: completed.receiptSha256,
          requestId: active.requestId,
          message: "The app-owned local copy was deleted. The original source was not changed. Secure erasure is not claimed.",
        });
      }
    } catch {
      if (active.acceptResult && !this.#closed) {
        this.#completed = completed;
        this.#state = dto({
          state: "failed",
          configured: true,
          operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
          receiptSha256: completed.receiptSha256,
          requestId: active.requestId,
          message: "The local copy could not be confirmed deleted. The original source was not changed.",
          failureCode: "LOCAL_INTAKE_WORKSPACE_DELETE_FAILED",
          workspace: completed.workspace,
        });
      }
    } finally {
      if (this.#active === active) this.#active = null;
      active.resolveSettled();
    }
    return cloneDto(this.#state);
  }

  #readyDto(): LocalIntakeWorkspaceDtoV0 {
    return dto({
      state: "ready",
      configured: true,
      receiptSha256: this.#receipt?.receiptSha256 ?? null,
      message: this.#resumeIntentSha256 === null
        ? "The current intake is ready for an explicit copy into app-owned local storage."
        : "An interrupted local copy is ready to resume after the current intake is rechecked.",
    });
  }

  #busyDto(requestId: string): LocalIntakeWorkspaceDtoV0 {
    return dto({
      state: "failed",
      configured: this.#context !== null,
      receiptSha256: this.#receipt?.receiptSha256 ?? this.#completed?.receiptSha256 ?? null,
      requestId,
      message: "Another local workspace operation is still in progress.",
      failureCode: "LOCAL_INTAKE_WORKSPACE_BUSY",
    });
  }

  #abort(active: ActiveOperation, code: string): void {
    if (active.abortCode !== null || active.abortController === null) return;
    active.abortCode = code;
    active.abortController.abort();
  }

  #acceptsResults(): boolean {
    return !this.#closed;
  }
}

export function createLocalIntakeWorkspaceControllerV0(
  options: CreateLocalIntakeWorkspaceControllerV0Options,
): LocalIntakeWorkspaceControllerV0 {
  return new LocalIntakeWorkspaceControllerV0(options);
}

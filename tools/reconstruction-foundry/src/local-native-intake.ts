import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  domainSeparatedSha256,
  inspectUniversalIntake,
  stableCanonicalJson,
  toCanonicalJson,
  verifyFoundryLocalIntakeWorkspaceV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import {
  TrustedWindowsNativeSourceBasketControllerV0,
  type NativeAdapterRequestV0,
  type NativeOutputBoundaryResponseV0,
  type NativeSourcePickerResponseV0,
  type TrustedWindowsNativeSourceAdapterV0,
  type TrustedWindowsNativeSourceSetInputV0,
  type TrustedWindowsOutputBoundaryV0,
  type TrustedWindowsSourceBasketResultV0,
  type TrustedWindowsSourceSelectionEvidenceV0,
} from "./trusted-windows-native-source-basket.js";
import {
  LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
  createLocalIntakeWorkspaceControllerV0,
  type CreateLocalIntakeWorkspaceControllerV0Options,
  type LocalIntakeWorkspaceDtoV0,
  type LocalIntakeWorkspaceTruthDtoV0,
} from "./local-intake-workspace.js";

export const LOCAL_NATIVE_INTAKE_VIEW_V0 =
  "omnitwin.foundry.local-native-intake-view.v0";
export const LOCAL_NATIVE_INTAKE_EVENT_V0 =
  "trusted-windows-native-source-basket-event.v1";
export const LOCAL_NATIVE_INTAKE_REPORT_V0 =
  "omnitwin.foundry.local-native-intake-report.v0";
export const LOCAL_NATIVE_INTAKE_ACTION_RESULT_V0 =
  "omnitwin.foundry.local-native-intake-action-result.v0";
export const LOCAL_NATIVE_INTAKE_COLLECTION_INDEX_V0 =
  "omnitwin.foundry.local-native-intake-collection-index.v0";
export const LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0 =
  "inspect_and_keep_verified_copies";
export const LOCAL_NATIVE_INTAKE_MODE_V0 =
  "ordinary_windows_native_selection_node_path_reopen_preview";
export const LOCAL_NATIVE_INTAKE_FILESYSTEM_MODEL_V0 =
  "node_path_reopen_after_native_selection";

const LEGACY_LOCAL_NATIVE_INTAKE_MODE_V0 =
  "ordinary_windows_picker_node_path_reopen_preview";

const COLLECTION_INDEX_FILE = "collection-index.json";
const COLLECTION_INDEX_PARTIAL_FILE = ".collection-index.partial";
const COLLECTION_INDEX_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.LOCAL_NATIVE_INTAKE_COLLECTION_INDEX.V0";
const CHILD_DIRECTORY = /^item-[0-9]{4}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BYTE_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const PROGRESS_POLL_MS = 50;

export type LocalNativeIntakePhaseV0 =
  | "selecting"
  | "importing"
  | "complete"
  | "failed"
  | "cancelled"
  | "closed";

export type LocalNativeIntakeItemStateV0 =
  | "selected"
  | "queued"
  | "inspecting"
  | "copying"
  | "verifying"
  | "stored"
  | "failed"
  | "cancelled";

export interface LocalNativeIntakeProgressV0 {
  readonly copiedFileCount: number;
  readonly fileCount: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

export interface LocalNativeIntakeItemViewV0 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly label: string;
  readonly labelSafety: "generated_kind_and_position_only";
  readonly fileCount: number;
  readonly byteCountDecimal: string;
  readonly state: LocalNativeIntakeItemStateV0;
  readonly progress: LocalNativeIntakeProgressV0 | null;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  readonly outcome: "pending" | "stored" | "failed" | "cancelled";
}

export interface LocalNativeIntakeEventBindingV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_INTAKE_EVENT_V0;
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
}

export type LocalNativeIntakeEventV0 =
  | (LocalNativeIntakeEventBindingV0 & {
      readonly action: "add_files" | "add_folder" | "add_dropped" | "cancel";
    })
  | (LocalNativeIntakeEventBindingV0 & {
      readonly action: "start";
      readonly confirmation: typeof LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0;
    });

export interface LocalNativeIntakeViewV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_INTAKE_VIEW_V0;
  readonly mode: typeof LOCAL_NATIVE_INTAKE_MODE_V0;
  readonly filesystemModel: typeof LOCAL_NATIVE_INTAKE_FILESYSTEM_MODEL_V0;
  readonly nativeCustodyClaimed: false;
  readonly authority: "none";
  readonly phase: LocalNativeIntakePhaseV0;
  readonly busy: boolean;
  readonly message: string;
  readonly sources: readonly LocalNativeIntakeItemViewV0[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly discoveredFiles: number;
    readonly totalBytesDecimal: string;
    readonly storedRoots: number;
    readonly failedRoots: number;
    readonly cancelledRoots: number;
  };
  readonly nextEvent: LocalNativeIntakeEventBindingV0 | null;
  readonly canCancelImport: boolean;
  readonly reportAvailable: boolean;
  readonly durableOutcome:
    | "not_started"
    | "in_progress"
    | "collection_index_stored"
    | "collection_index_failed";
}

export type LocalNativeIntakeActionStatusV0 =
  | "updated"
  | "picker_cancelled"
  | "drop_cancelled"
  | "selection_rejected"
  | "start_rejected"
  | "adapter_unavailable"
  | "adapter_failed"
  | "started"
  | "start_uncertain"
  | "cancelled";

export type LocalNativeIntakeActionCodeV0 =
  | "ITEMS_ADDED"
  | "PICKER_CANCELLED"
  | "DROP_CANCELLED"
  | "SELECTION_REJECTED"
  | "START_REJECTED"
  | "PICKER_UNAVAILABLE"
  | "PICKER_FAILED"
  | "DROP_UNAVAILABLE"
  | "DROP_FAILED"
  | "IMPORT_STAGED"
  | "START_FAILED"
  | "SESSION_CANCELLED";

export interface LocalNativeIntakeActionResultV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_INTAKE_ACTION_RESULT_V0;
  readonly status: LocalNativeIntakeActionStatusV0;
  readonly code: LocalNativeIntakeActionCodeV0;
  readonly message: string;
  readonly view: LocalNativeIntakeViewV0;
}

export interface LocalNativeIntakeReportItemV0 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly label: string;
  readonly status: "stored" | "failed" | "cancelled";
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  readonly inspectedFileCount: number | null;
  readonly inspectedBytes: number | null;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  readonly failure: "inspection_failed" | "copy_failed" | "cancelled" | null;
}

export interface LocalNativeIntakeReportV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_INTAKE_REPORT_V0;
  readonly mode: typeof LOCAL_NATIVE_INTAKE_MODE_V0;
  readonly authority: "none";
  readonly outcome: "complete" | "complete_with_failures" | "cancelled";
  readonly collectionIndexStored: boolean;
  readonly items: readonly LocalNativeIntakeReportItemV0[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly storedRoots: number;
    readonly failedRoots: number;
    readonly cancelledRoots: number;
    readonly storedFiles: number;
    readonly storedBytes: number;
  };
}

export type LocalNativeIntakeCollectionItemFailureCodeV0 =
  | "SOURCE_INSPECTION_FAILED"
  | "SOURCE_SUMMARY_CHANGED"
  | "WORKSPACE_COPY_FAILED"
  | "IMPORT_CANCELLED"
  | "COLLECTION_SETUP_FAILED";

export interface LocalNativeIntakeCollectionItemV0 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly status: "stored" | "failed" | "cancelled";
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  readonly receiptSha256: string | null;
  readonly childDirectory: string | null;
  readonly workspaceSha256: string | null;
  readonly inspectedFileCount: number | null;
  readonly inspectedBytes: number | null;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  readonly failureCode: LocalNativeIntakeCollectionItemFailureCodeV0 | null;
}

interface LocalNativeIntakeCollectionIndexPayloadV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_INTAKE_COLLECTION_INDEX_V0;
  readonly mode: typeof LOCAL_NATIVE_INTAKE_MODE_V0 | typeof LEGACY_LOCAL_NATIVE_INTAKE_MODE_V0;
  readonly authority: "none";
  readonly outcome: "complete" | "complete_with_failures" | "cancelled";
  readonly items: readonly LocalNativeIntakeCollectionItemV0[];
  readonly totals: {
    readonly selectedRoots: number;
    readonly storedRoots: number;
    readonly failedRoots: number;
    readonly cancelledRoots: number;
    readonly storedFiles: number;
    readonly storedBytes: number;
  };
}

export interface LocalNativeIntakeCollectionIndexV0
  extends LocalNativeIntakeCollectionIndexPayloadV0 {
  readonly indexSha256: string;
}

export interface VerifiedLocalNativeIntakeCollectionV0 {
  readonly index: LocalNativeIntakeCollectionIndexV0;
  readonly storedChildrenVerified: number;
}

/**
 * Process-owned handoff into later local inspection. This object must never be
 * accepted from, or serialized to, the browser boundary because its root is a
 * local filesystem capability.
 */
export interface LocalNativeIntakeCollectionAnalysisInputV0 {
  readonly collectionRoot: string;
  readonly collectionIndexSha256: string;
}

export type LocalNativeIntakeCollectionAnalysisChildFailureCodeV0 =
  | "CHILD_NOT_STORED"
  | "CHILD_VERIFICATION_FAILED";

export interface OpenedLocalNativeIntakeCollectionAnalysisItemV0 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  readonly verification: "verified" | "failed";
  /** Process-only verified copied-payload capability; never a public DTO field. */
  readonly activeSourcePath: string | null;
  /** Process-only child workspace capability; never a public DTO field. */
  readonly childWorkspaceRoot: string | null;
  readonly receiptSha256: string | null;
  readonly workspaceSha256: string | null;
  readonly failureCode: LocalNativeIntakeCollectionAnalysisChildFailureCodeV0 | null;
}

export interface OpenedLocalNativeIntakeCollectionForAnalysisV0 {
  readonly indexSha256: string;
  readonly items: readonly OpenedLocalNativeIntakeCollectionAnalysisItemV0[];
}

export interface LocalNativeIntakeAdapterLifecycleV0 {
  closeAndConfirmNoLiveScopes(): Promise<void>;
}

export type LocalNativeIntakeAdapterV0 = TrustedWindowsNativeSourceAdapterV0 &
  Partial<LocalNativeIntakeAdapterLifecycleV0>;

export interface LocalNativeIntakeWorkspacePortV0 {
  initialize(): Promise<LocalIntakeWorkspaceDtoV0>;
  bindReceipt(receipt: FoundryUniversalIntakeReceipt): void;
  snapshot(): LocalIntakeWorkspaceDtoV0;
  start(input: unknown): Promise<LocalIntakeWorkspaceDtoV0>;
  cancel(requestId: string): Promise<LocalIntakeWorkspaceDtoV0 | null>;
  close(): Promise<void>;
}

export interface LocalNativeIntakeCoreHooksV0 {
  readonly inspectSource: (
    sourceRoot: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<FoundryUniversalIntakeReceipt>;
  readonly createWorkspaceController: (
    options: CreateLocalIntakeWorkspaceControllerV0Options,
  ) => LocalNativeIntakeWorkspacePortV0;
  readonly createBatchRoot: (outputRoot: string) => Promise<string>;
  readonly commitCollectionIndex: (
    collectionRoot: string,
    index: LocalNativeIntakeCollectionIndexV0,
  ) => Promise<void>;
}

export interface CreateLocalNativeIntakeControllerV0Options {
  readonly adapter: LocalNativeIntakeAdapterV0;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly core?: Partial<LocalNativeIntakeCoreHooksV0>;
  readonly now?: () => Date;
}

export type LocalNativeIntakeErrorCodeV0 =
  | "INVALID_EVENT"
  | "STALE_EVENT"
  | "FORGED_EVENT"
  | "CONTROLLER_BUSY"
  | "CONTROLLER_TERMINAL"
  | "ADAPTER_CLOSE_FAILED"
  | "COLLECTION_INVALID";

export class LocalNativeIntakeError extends Error {
  readonly code: LocalNativeIntakeErrorCodeV0;

  constructor(code: LocalNativeIntakeErrorCodeV0, message: string) {
    super(message);
    this.name = "LocalNativeIntakeError";
    this.code = code;
  }
}

interface PrivateItem {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly sourceRoot: string;
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  state: Exclude<LocalNativeIntakeItemStateV0, "selected">;
  progress: LocalNativeIntakeProgressV0 | null;
  receiptSha256: string | null;
  childDirectory: string | null;
  workspaceSha256: string | null;
  inspectedFileCount: number | null;
  inspectedBytes: number | null;
  truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  failureCode: LocalNativeIntakeCollectionItemFailureCodeV0 | null;
}

interface ActiveChild {
  readonly controller: LocalNativeIntakeWorkspacePortV0;
  readonly requestId: string;
}

interface ParsedPublicEvent {
  readonly action: "add_files" | "add_folder" | "add_dropped" | "cancel" | "start";
  readonly sessionRef: string;
  readonly revision: number;
  readonly eventToken: string;
  readonly confirmation?: typeof LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0;
}

function fail(code: LocalNativeIntakeErrorCodeV0, message: string): never {
  throw new LocalNativeIntakeError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
}

function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function itemLabel(kind: "file" | "directory", basketPosition: number): string {
  return `${kind === "file" ? "File" : "Folder"} ${String(basketPosition)}`;
}

function parsePublicEvent(value: unknown): ParsedPublicEvent {
  if (!isRecord(value) || typeof value.action !== "string") {
    return fail("INVALID_EVENT", "The local intake action is invalid.");
  }
  const actions = ["add_files", "add_folder", "add_dropped", "cancel", "start"] as const;
  if (!actions.some((action) => action === value.action)) {
    return fail("INVALID_EVENT", "The local intake action is invalid.");
  }
  const action = value.action as ParsedPublicEvent["action"];
  const keys = action === "start"
    ? ["schemaVersion", "sessionRef", "revision", "eventToken", "action", "confirmation"]
    : ["schemaVersion", "sessionRef", "revision", "eventToken", "action"];
  if (
    !hasExactKeys(value, keys) ||
    value.schemaVersion !== LOCAL_NATIVE_INTAKE_EVENT_V0 ||
    typeof value.sessionRef !== "string" ||
    !/^basket_(?!0{32}$)[a-f0-9]{32}$/u.test(value.sessionRef) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    Object.is(value.revision, -0) ||
    typeof value.eventToken !== "string" ||
    !/^evt_[a-f0-9]{64}$/u.test(value.eventToken) ||
    (action === "start" && value.confirmation !== LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0)
  ) {
    return fail("INVALID_EVENT", "The local intake action is invalid.");
  }
  return {
    action,
    sessionRef: value.sessionRef,
    revision: value.revision,
    eventToken: value.eventToken,
    ...(action === "start" ? { confirmation: LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0 } : {}),
  };
}

function copySelection(
  selection: TrustedWindowsSourceSelectionEvidenceV0,
): TrustedWindowsSourceSelectionEvidenceV0 {
  return {
    kind: selection.kind,
    canonicalAbsolutePath: selection.canonicalAbsolutePath,
    resolvedAbsolutePath: selection.resolvedAbsolutePath,
    byteCountDecimal: selection.byteCountDecimal,
    fileCount: selection.fileCount,
    identity: { ...selection.identity },
    inventoryFileIdentities: selection.inventoryFileIdentities.map((identity) => ({ ...identity })),
    pathEvidence: { ...selection.pathEvidence },
  };
}

function copyOutputBoundary(boundary: TrustedWindowsOutputBoundaryV0): TrustedWindowsOutputBoundaryV0 {
  if ("kind" in boundary) {
    return {
      kind: "directory",
      canonicalAbsolutePath: boundary.canonicalAbsolutePath,
      resolvedAbsolutePath: boundary.resolvedAbsolutePath,
      identity: { ...boundary.identity },
      pathEvidence: { ...boundary.pathEvidence },
    };
  }
  return {
    canonicalAbsolutePath: boundary.canonicalAbsolutePath,
    resolvedAbsolutePath: boundary.resolvedAbsolutePath,
    pathEvidence: { ...boundary.pathEvidence },
  };
}

function v0AdapterFacade(adapter: LocalNativeIntakeAdapterV0): TrustedWindowsNativeSourceAdapterV0 {
  const picker = async (
    request: NativeAdapterRequestV0,
    operation: "pickFiles" | "pickFolder" | "dropSources",
  ): Promise<NativeSourcePickerResponseV0> => {
    const response = await adapter[operation](request);
    if (response.status !== "selected") return response;
    return {
      schemaVersion: response.schemaVersion,
      requestRef: response.requestRef,
      operation: response.operation,
      status: "selected",
      selections: response.selections.map(copySelection),
    };
  };
  return Object.freeze({
    pickFiles: (request: NativeAdapterRequestV0) => picker(request, "pickFiles"),
    pickFolder: (request: NativeAdapterRequestV0) => picker(request, "pickFolder"),
    dropSources: (request: NativeAdapterRequestV0) => picker(request, "dropSources"),
    resolveOutputBoundary: async (
      request: NativeAdapterRequestV0,
    ): Promise<NativeOutputBoundaryResponseV0> => {
      const response = await adapter.resolveOutputBoundary(request);
      if (response.status !== "resolved") return response;
      return {
        schemaVersion: response.schemaVersion,
        requestRef: response.requestRef,
        operation: response.operation,
        status: "resolved",
        outputBoundary: copyOutputBoundary(response.outputBoundary),
      };
    },
    compareCanonicalPaths: (request: Parameters<
      TrustedWindowsNativeSourceAdapterV0["compareCanonicalPaths"]
    >[0]) => adapter.compareCanonicalPaths(request),
  });
}

async function defaultCreateBatchRoot(outputRoot: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  return await mkdtemp(join(outputRoot, "venviewer-intake-batch-"));
}

async function defaultCommitCollectionIndex(
  collectionRoot: string,
  index: LocalNativeIntakeCollectionIndexV0,
): Promise<void> {
  const partial = join(collectionRoot, COLLECTION_INDEX_PARTIAL_FILE);
  const finalPath = join(collectionRoot, COLLECTION_INDEX_FILE);
  const handle = await open(partial, "wx", 0o600);
  let closed = false;
  try {
    await handle.writeFile(`${stableCanonicalJson(toCanonicalJson(index))}\n`, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(partial, finalPath);
  } catch (error: unknown) {
    if (!closed) await handle.close().catch(() => undefined);
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}

function defaultCoreHooks(
  overrides: Partial<LocalNativeIntakeCoreHooksV0> | undefined,
): LocalNativeIntakeCoreHooksV0 {
  return Object.freeze({
    inspectSource: overrides?.inspectSource ?? ((
      sourceRoot: string,
      options: { readonly signal: AbortSignal },
    ) =>
      inspectUniversalIntake(sourceRoot, options)),
    createWorkspaceController: overrides?.createWorkspaceController ?? ((
      options: CreateLocalIntakeWorkspaceControllerV0Options,
    ) =>
      createLocalIntakeWorkspaceControllerV0(options)),
    createBatchRoot: overrides?.createBatchRoot ?? defaultCreateBatchRoot,
    commitCollectionIndex: overrides?.commitCollectionIndex ?? defaultCommitCollectionIndex,
  });
}

function zeroTruth(): LocalIntakeWorkspaceTruthDtoV0 {
  return {
    pendingReview: 0,
    admitted: 0,
    excluded: 0,
    captured: 0,
    enhancedCaptured: 0,
    generatedCinematic: 0,
    conceptImagination: 0,
  };
}

function truthIsPending(
  truth: LocalIntakeWorkspaceTruthDtoV0,
  fileCount: number,
): boolean {
  return truth.pendingReview === fileCount &&
    truth.admitted === 0 &&
    truth.excluded === 0 &&
    truth.captured === 0 &&
    truth.enhancedCaptured === 0 &&
    truth.generatedCinematic === 0 &&
    truth.conceptImagination === 0;
}

function progressFromWorkspace(dto: LocalIntakeWorkspaceDtoV0): LocalNativeIntakeProgressV0 | null {
  return dto.progress === null ? null : { ...dto.progress };
}

function itemOutcome(state: LocalNativeIntakeItemStateV0): LocalNativeIntakeItemViewV0["outcome"] {
  if (state === "stored") return "stored";
  if (state === "failed") return "failed";
  if (state === "cancelled") return "cancelled";
  return "pending";
}

function outcomeFromItems(
  items: readonly Pick<PrivateItem, "state">[],
): LocalNativeIntakeReportV0["outcome"] {
  if (items.some((item) => item.state === "cancelled")) return "cancelled";
  if (items.some((item) => item.state === "failed")) return "complete_with_failures";
  return "complete";
}

function terminalTotals(items: readonly LocalNativeIntakeCollectionItemV0[]) {
  return {
    selectedRoots: items.length,
    storedRoots: items.filter((item) => item.status === "stored").length,
    failedRoots: items.filter((item) => item.status === "failed").length,
    cancelledRoots: items.filter((item) => item.status === "cancelled").length,
    storedFiles: items.reduce(
      (total, item) => total + (item.status === "stored" ? item.inspectedFileCount ?? 0 : 0),
      0,
    ),
    storedBytes: items.reduce(
      (total, item) => total + (item.status === "stored" ? item.inspectedBytes ?? 0 : 0),
      0,
    ),
  };
}

function collectionItem(item: PrivateItem): LocalNativeIntakeCollectionItemV0 {
  if (item.state !== "stored" && item.state !== "failed" && item.state !== "cancelled") {
    throw new Error("A collection item was not terminal.");
  }
  return {
    basketPosition: item.basketPosition,
    kind: item.kind,
    status: item.state,
    selectedFileCount: item.selectedFileCount,
    selectedBytesDecimal: item.selectedBytesDecimal,
    receiptSha256: item.receiptSha256,
    childDirectory: item.childDirectory,
    workspaceSha256: item.workspaceSha256,
    inspectedFileCount: item.inspectedFileCount,
    inspectedBytes: item.inspectedBytes,
    truth: item.truth === null ? null : { ...item.truth },
    failureCode: item.failureCode,
  };
}

function compileCollectionIndex(items: readonly PrivateItem[]): LocalNativeIntakeCollectionIndexV0 {
  const collectionItems = items.map(collectionItem);
  const payload: LocalNativeIntakeCollectionIndexPayloadV0 = {
    schemaVersion: LOCAL_NATIVE_INTAKE_COLLECTION_INDEX_V0,
    mode: LOCAL_NATIVE_INTAKE_MODE_V0,
    authority: "none",
    outcome: outcomeFromItems(items),
    items: collectionItems,
    totals: terminalTotals(collectionItems),
  };
  return deepFreeze({
    ...payload,
    indexSha256: domainSeparatedSha256(
      COLLECTION_INDEX_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  });
}

function compilePublicReport(
  items: readonly PrivateItem[],
  collectionIndexStored: boolean,
): LocalNativeIntakeReportV0 {
  const collectionItems = items.map(collectionItem);
  return deepFreeze({
    schemaVersion: LOCAL_NATIVE_INTAKE_REPORT_V0,
    mode: LOCAL_NATIVE_INTAKE_MODE_V0,
    authority: "none",
    outcome: outcomeFromItems(items),
    collectionIndexStored,
    items: collectionItems.map((item) => ({
      basketPosition: item.basketPosition,
      kind: item.kind,
      label: itemLabel(item.kind, item.basketPosition),
      status: item.status,
      selectedFileCount: item.selectedFileCount,
      selectedBytesDecimal: item.selectedBytesDecimal,
      inspectedFileCount: item.inspectedFileCount,
      inspectedBytes: item.inspectedBytes,
      truth: item.truth === null ? null : { ...item.truth },
      failure: item.status === "cancelled"
        ? "cancelled"
        : item.status === "failed"
          ? item.failureCode === "SOURCE_INSPECTION_FAILED" ||
              item.failureCode === "SOURCE_SUMMARY_CHANGED"
            ? "inspection_failed"
            : "copy_failed"
          : null,
    })),
    totals: terminalTotals(collectionItems),
  });
}

function internalRequestId(position: number, receiptSha256: string): string {
  return createHash("sha256")
    .update("OMNITWIN.LOCAL_NATIVE_INTAKE_REQUEST.V0", "ascii")
    .update(Buffer.from([0]))
    .update(`${String(position)}:${receiptSha256}`, "ascii")
    .digest("hex")
    .slice(0, 32);
}

function itemDirectory(position: number): string {
  return `item-${String(position).padStart(4, "0")}`;
}

function markTerminal(
  item: PrivateItem,
  state: "failed" | "cancelled",
  failureCode: LocalNativeIntakeCollectionItemFailureCodeV0,
): void {
  item.state = state;
  item.failureCode = failureCode;
  item.workspaceSha256 = null;
  item.truth = null;
}

function itemIsTerminal(item: PrivateItem): boolean {
  return item.state === "stored" || item.state === "failed" || item.state === "cancelled";
}

function publicActionResult(
  resultStatus: TrustedWindowsSourceBasketResultV0["status"],
  view: LocalNativeIntakeViewV0,
  action?: ParsedPublicEvent["action"],
): LocalNativeIntakeActionResultV0 {
  const mapped: Readonly<Record<
    TrustedWindowsSourceBasketResultV0["status"],
    readonly [LocalNativeIntakeActionStatusV0, LocalNativeIntakeActionCodeV0, string]
  >> = {
    updated: ["updated", "ITEMS_ADDED", "The selected items were added."],
    picker_cancelled: ["picker_cancelled", "PICKER_CANCELLED", "Nothing was added."],
    drop_cancelled: ["drop_cancelled", "DROP_CANCELLED", "Nothing was added."],
    selection_rejected: [
      "selection_rejected",
      "SELECTION_REJECTED",
      "Those items could not be added. Start a new local selection session.",
    ],
    start_rejected: [
      "start_rejected",
      "START_REJECTED",
      "The selected items could not be started. Start a new local selection session.",
    ],
    adapter_unavailable: [
      "adapter_unavailable",
      "PICKER_UNAVAILABLE",
      "The Windows picker is unavailable. Start a new local selection session.",
    ],
    adapter_failed: [
      "adapter_failed",
      "PICKER_FAILED",
      "The Windows picker could not finish. Start a new local selection session.",
    ],
    started: ["started", "IMPORT_STAGED", "Local inspection and copying have started."],
    start_uncertain: [
      "start_uncertain",
      "START_FAILED",
      "The local import did not start cleanly. Start a new local selection session.",
    ],
    cancelled: ["cancelled", "SESSION_CANCELLED", "The local selection session was cancelled."],
  };
  const [status, mappedCode, mappedMessage] = mapped[resultStatus];
  const [code, message] = action === "add_dropped" && resultStatus === "adapter_unavailable"
    ? ["DROP_UNAVAILABLE" as const, "The Windows drop panel is unavailable. Start a new local selection session."]
    : action === "add_dropped" && resultStatus === "adapter_failed"
      ? ["DROP_FAILED" as const, "The Windows drop panel could not finish. Start a new local selection session."]
      : [mappedCode, mappedMessage];
  return deepFreeze({
    schemaVersion: LOCAL_NATIVE_INTAKE_ACTION_RESULT_V0,
    status,
    code,
    message,
    view,
  });
}

export class LocalNativeIntakeControllerV0 {
  readonly #adapter: LocalNativeIntakeAdapterV0;
  readonly #basket: TrustedWindowsNativeSourceBasketControllerV0;
  readonly #core: LocalNativeIntakeCoreHooksV0;
  readonly #now: () => Date;
  readonly #batchAbort = new AbortController();
  #phase: LocalNativeIntakePhaseV0 = "selecting";
  #items: PrivateItem[] = [];
  #report: LocalNativeIntakeReportV0 | null = null;
  #collectionAnalysisInput: LocalNativeIntakeCollectionAnalysisInputV0 | null = null;
  #batchPromise: Promise<void> | null = null;
  #activeChild: ActiveChild | null = null;
  #cancelRequested = false;
  #adapterClosed = false;
  #adapterCloseAttempt: Promise<void> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: CreateLocalNativeIntakeControllerV0Options) {
    this.#adapter = options.adapter;
    this.#core = defaultCoreHooks(options.core);
    this.#now = options.now ?? (() => new Date());
    this.#basket = new TrustedWindowsNativeSourceBasketControllerV0({
      adapter: v0AdapterFacade(options.adapter),
      ...(options.randomBytes === undefined ? {} : { randomBytes: options.randomBytes }),
      acceptTrustedStartInput: (input) => {
        this.#acceptStart(input);
      },
    });
  }

  getView(): LocalNativeIntakeViewV0 {
    const basketView = this.#basket.getView();
    const sources = this.#items.length === 0
      ? basketView.sources.map((source) => ({
          basketPosition: source.basketPosition,
          kind: source.kind,
          label: itemLabel(source.kind, source.basketPosition),
          labelSafety: "generated_kind_and_position_only" as const,
          fileCount: source.fileCount,
          byteCountDecimal: source.byteCountDecimal,
          state: "selected" as const,
          progress: null,
          truth: null,
          outcome: "pending" as const,
        }))
      : this.#items.map((item) => ({
          basketPosition: item.basketPosition,
          kind: item.kind,
          label: itemLabel(item.kind, item.basketPosition),
          labelSafety: "generated_kind_and_position_only" as const,
          fileCount: item.selectedFileCount,
          byteCountDecimal: item.selectedBytesDecimal,
          state: item.state,
          progress: item.progress === null ? null : { ...item.progress },
          truth: item.truth === null ? null : { ...item.truth },
          outcome: itemOutcome(item.state),
        }));
    const nextEvent: LocalNativeIntakeEventBindingV0 | null =
      this.#phase === "selecting" && basketView.nextEvent !== null
      ? {
          schemaVersion: LOCAL_NATIVE_INTAKE_EVENT_V0,
          sessionRef: basketView.nextEvent.sessionRef,
          revision: basketView.nextEvent.revision,
          eventToken: basketView.nextEvent.eventToken,
        }
      : null;
    return cloneFrozen({
      schemaVersion: LOCAL_NATIVE_INTAKE_VIEW_V0,
      mode: LOCAL_NATIVE_INTAKE_MODE_V0,
      filesystemModel: LOCAL_NATIVE_INTAKE_FILESYSTEM_MODEL_V0,
      nativeCustodyClaimed: false,
      authority: "none",
      phase: this.#phase,
      busy: basketView.busy || this.#phase === "importing",
      message: this.#message(),
      sources,
      totals: {
        selectedRoots: sources.length,
        discoveredFiles: sources.reduce((total, source) => total + source.fileCount, 0),
        totalBytesDecimal: sources.reduce(
          (total, source) => total + BigInt(source.byteCountDecimal),
          0n,
        ).toString(10),
        storedRoots: sources.filter((source) => source.state === "stored").length,
        failedRoots: sources.filter((source) => source.state === "failed").length,
        cancelledRoots: sources.filter((source) => source.state === "cancelled").length,
      },
      nextEvent,
      canCancelImport: this.#phase === "importing",
      reportAvailable: this.#report !== null,
      durableOutcome: this.#report !== null
        ? this.#report.collectionIndexStored
          ? "collection_index_stored"
          : "collection_index_failed"
        : this.#phase === "importing"
          ? "in_progress"
          : "not_started",
    });
  }

  snapshot(): LocalNativeIntakeViewV0 {
    return this.getView();
  }

  async dispatch(value: unknown): Promise<LocalNativeIntakeActionResultV0> {
    if (this.#phase !== "selecting") {
      return fail("CONTROLLER_TERMINAL", "This local intake session is no longer selecting sources.");
    }
    const event = parsePublicEvent(value);
    const internalView = this.#basket.getView();
    if (internalView.busy || internalView.nextEvent === null) {
      return fail("CONTROLLER_BUSY", "Another local intake action is still in progress.");
    }
    if (event.revision !== internalView.nextEvent.revision) {
      return fail("STALE_EVENT", "The local intake action is out of date.");
    }
    if (
      event.sessionRef !== internalView.nextEvent.sessionRef ||
      event.eventToken !== internalView.nextEvent.eventToken
    ) {
      return fail("FORGED_EVENT", "The local intake action was not issued by this session.");
    }
    const internalEvent = {
      schemaVersion: internalView.nextEvent.schemaVersion,
      sessionRef: internalView.nextEvent.sessionRef,
      revision: internalView.nextEvent.revision,
      eventToken: internalView.nextEvent.eventToken,
      action: event.action,
    };
    let result: TrustedWindowsSourceBasketResultV0;
    try {
      result = await this.#basket.dispatch(internalEvent);
    } catch {
      this.#basket.disposePrivateState();
      this.#phase = "failed";
      await this.#closeAdapter().catch(() => undefined);
      return publicActionResult("adapter_failed", this.getView(), event.action);
    }
    if (result.status === "cancelled") {
      this.#phase = "cancelled";
      await this.#closeAdapter().catch(() => undefined);
    } else if (
      result.status === "selection_rejected" ||
      result.status === "start_rejected" ||
      result.status === "adapter_unavailable" ||
      result.status === "adapter_failed" ||
      result.status === "start_uncertain"
    ) {
      this.#basket.disposePrivateState();
      this.#phase = "failed";
      await this.#closeAdapter().catch(() => undefined);
    }
    return publicActionResult(result.status, this.getView(), event.action);
  }

  async cancelImport(): Promise<LocalNativeIntakeViewV0> {
    if (this.#phase !== "importing") return this.getView();
    this.#cancelRequested = true;
    this.#batchAbort.abort();
    const active = this.#activeChild;
    if (active !== null) await active.controller.cancel(active.requestId);
    await this.#batchPromise;
    return this.getView();
  }

  cancelActive(): Promise<LocalNativeIntakeViewV0> {
    return this.cancelImport();
  }

  readReport(): LocalNativeIntakeReportV0 | null {
    return this.#report === null ? null : cloneFrozen(this.#report);
  }

  getReport(): LocalNativeIntakeReportV0 | null {
    return this.readReport();
  }

  /** Process-only bridge. Do not add this value to any browser response. */
  getCollectionAnalysisInputV0(): LocalNativeIntakeCollectionAnalysisInputV0 | null {
    return this.#collectionAnalysisInput === null
      ? null
      : deepFreeze({ ...this.#collectionAnalysisInput });
  }

  close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    const attempt = this.#runClose();
    this.#closePromise = attempt;
    void attempt.catch(() => {
      if (this.#closePromise === attempt) this.#closePromise = null;
    });
    return attempt;
  }

  stop(): Promise<void> {
    return this.close();
  }

  #acceptStart(input: TrustedWindowsNativeSourceSetInputV0): void {
    if (this.#phase !== "selecting" || this.#batchPromise !== null) {
      throw new Error("The local intake start sink was already consumed.");
    }
    const staged = structuredClone(input);
    this.#items = staged.selections.map((selection, index) => ({
      basketPosition: index + 1,
      kind: selection.kind,
      sourceRoot: selection.canonicalAbsolutePath,
      selectedFileCount: selection.fileCount,
      selectedBytesDecimal: selection.byteCountDecimal,
      state: "queued",
      progress: null,
      receiptSha256: null,
      childDirectory: null,
      workspaceSha256: null,
      inspectedFileCount: null,
      inspectedBytes: null,
      truth: null,
      failureCode: null,
    }));
    this.#phase = "importing";
    this.#batchPromise = new Promise<void>((resolvePromise) => {
      setImmediate(resolvePromise);
    })
      .then(() => this.#runBatch(staged))
      .catch(() => {
        this.#forceBatchTerminal(false);
      });
  }

  async #runBatch(input: TrustedWindowsNativeSourceSetInputV0): Promise<void> {
    let collectionRoot: string | null = null;
    let collectionIndexStored = false;
    try {
      await this.#closeAdapter().catch(() => undefined);
      collectionRoot = await this.#core.createBatchRoot(
        input.outputBoundary.canonicalAbsolutePath,
      );
      for (const item of this.#items) {
        if (this.#cancelRequested) {
          markTerminal(item, "cancelled", "IMPORT_CANCELLED");
          continue;
        }
        await this.#runItem(item, collectionRoot);
      }
      const index = compileCollectionIndex(this.#items);
      await this.#core.commitCollectionIndex(collectionRoot, index);
      collectionIndexStored = true;
      this.#collectionAnalysisInput = deepFreeze({
        collectionRoot,
        collectionIndexSha256: index.indexSha256,
      });
    } catch {
      collectionIndexStored = false;
      this.#collectionAnalysisInput = null;
    } finally {
      this.#forceBatchTerminal(collectionIndexStored, collectionRoot === null);
    }
  }

  async #runItem(item: PrivateItem, collectionRoot: string): Promise<void> {
    try {
      await this.#runItemUnchecked(item, collectionRoot);
    } catch {
      if (itemIsTerminal(item)) return;
      markTerminal(
        item,
        this.#wasCancelled() ? "cancelled" : "failed",
        this.#wasCancelled()
          ? "IMPORT_CANCELLED"
          : item.state === "inspecting"
            ? "SOURCE_INSPECTION_FAILED"
            : "WORKSPACE_COPY_FAILED",
      );
    }
  }

  async #runItemUnchecked(item: PrivateItem, collectionRoot: string): Promise<void> {
    let receipt: FoundryUniversalIntakeReceipt;
    item.state = "inspecting";
    try {
      receipt = await this.#core.inspectSource(item.sourceRoot, {
        signal: this.#batchAbort.signal,
      });
    } catch {
      markTerminal(
        item,
        this.#cancelRequested ? "cancelled" : "failed",
        this.#cancelRequested ? "IMPORT_CANCELLED" : "SOURCE_INSPECTION_FAILED",
      );
      return;
    }
    item.receiptSha256 = receipt.receiptSha256;
    item.inspectedFileCount = receipt.summary.fileCount;
    item.inspectedBytes = receipt.summary.totalBytes;
    if (
      receipt.source.kind !== item.kind ||
      receipt.summary.fileCount !== item.selectedFileCount ||
      String(receipt.summary.totalBytes) !== item.selectedBytesDecimal
    ) {
      markTerminal(item, "failed", "SOURCE_SUMMARY_CHANGED");
      return;
    }
    if (this.#cancelRequested) {
      markTerminal(item, "cancelled", "IMPORT_CANCELLED");
      return;
    }
    item.childDirectory = itemDirectory(item.basketPosition);
    const context = {
      sourceRoot: item.sourceRoot,
      workspaceDirectory: join(collectionRoot, item.childDirectory),
    };
    item.state = "copying";
    const child = this.#core.createWorkspaceController({
      trustedContext: context,
      now: this.#now,
    });
    const requestId = internalRequestId(item.basketPosition, receipt.receiptSha256);
    this.#activeChild = { controller: child, requestId };
    try {
      child.bindReceipt(receipt);
      await child.initialize();
      item.state = "copying";
      const completion = child.start({
        requestId,
        receiptSha256: receipt.receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      });
      const completed = await this.#waitForChild(item, child, completion);
      this.#adoptChildProgress(item, completed);
      if (
        completed.state !== "stored" ||
        completed.workspace === null ||
        !truthIsPending(completed.workspace.truth, receipt.summary.fileCount)
      ) {
        markTerminal(
          item,
          this.#wasCancelled() ? "cancelled" : "failed",
          this.#wasCancelled() ? "IMPORT_CANCELLED" : "WORKSPACE_COPY_FAILED",
        );
        return;
      }
      item.state = "stored";
      item.workspaceSha256 = completed.workspace.workspaceSha256;
      item.truth = { ...completed.workspace.truth };
      item.progress = progressFromWorkspace(completed);
      item.failureCode = null;
    } catch {
      markTerminal(
        item,
        this.#wasCancelled() ? "cancelled" : "failed",
        this.#wasCancelled() ? "IMPORT_CANCELLED" : "WORKSPACE_COPY_FAILED",
      );
    } finally {
      this.#activeChild = null;
      await child.close().catch(() => undefined);
    }
  }

  async #waitForChild(
    item: PrivateItem,
    child: LocalNativeIntakeWorkspacePortV0,
    completion: Promise<LocalIntakeWorkspaceDtoV0>,
  ): Promise<LocalIntakeWorkspaceDtoV0> {
    const interval = setInterval(() => {
      this.#adoptChildProgress(item, child.snapshot());
    }, PROGRESS_POLL_MS);
    interval.unref();
    try {
      return await completion;
    } finally {
      clearInterval(interval);
    }
  }

  #wasCancelled(): boolean {
    return this.#cancelRequested;
  }

  #adoptChildProgress(item: PrivateItem, dto: LocalIntakeWorkspaceDtoV0): void {
    item.progress = progressFromWorkspace(dto);
    if (dto.state === "verifying") item.state = "verifying";
    else if (dto.state === "copying") item.state = "copying";
  }

  #finishBatch(collectionIndexStored: boolean): void {
    this.#report = compilePublicReport(this.#items, collectionIndexStored);
    this.#phase = !collectionIndexStored
      ? "failed"
      : this.#report.outcome === "cancelled"
        ? "cancelled"
        : this.#report.totals.storedRoots === 0
          ? "failed"
          : "complete";
  }

  #forceBatchTerminal(
    collectionIndexStored: boolean,
    collectionSetupFailed = false,
  ): void {
    if (this.#report !== null) return;
    for (const item of this.#items) {
      if (itemIsTerminal(item)) continue;
      markTerminal(
        item,
        this.#wasCancelled() ? "cancelled" : "failed",
        this.#wasCancelled()
          ? "IMPORT_CANCELLED"
          : collectionSetupFailed
            ? "COLLECTION_SETUP_FAILED"
            : "WORKSPACE_COPY_FAILED",
      );
    }
    this.#finishBatch(collectionIndexStored);
  }

  #message(): string {
    if (this.#phase === "selecting") {
      return "Choose local files or folders. Windows chooses the items, then this app reads them locally.";
    }
    if (this.#phase === "importing") {
      return "Inspecting selected items and keeping independent verified local copies.";
    }
    if (this.#phase === "closed") return "The local intake controller is closed.";
    if (this.#phase === "failed" && this.#report === null) {
      return "The local selection session could not continue. Start a new local selection session.";
    }
    if (this.#phase === "cancelled" && this.#report === null) {
      return "The source selection was cancelled before import.";
    }
    if (this.#report !== null && !this.#report.collectionIndexStored) {
      return "Local copies may exist, but the collection index was not stored. Review the report before continuing.";
    }
    if (this.#report !== null && this.#report.totals.storedRoots === 0) {
      return "No selected item produced a verified local copy. The terminal report is available.";
    }
    if (this.#report?.outcome === "complete") {
      return "Every selected item has a verified local copy. All truth remains pending review.";
    }
    if (this.#report?.outcome === "complete_with_failures") {
      return "Import finished with isolated item failures; completed local copies were preserved.";
    }
    return "Import stopped after the current file boundary; completed local copies were preserved.";
  }

  async #closeAdapter(): Promise<void> {
    if (this.#adapterClosed) return;
    if (this.#adapterCloseAttempt !== null) {
      await this.#adapterCloseAttempt;
      return;
    }
    const close = this.#adapter.closeAndConfirmNoLiveScopes;
    if (typeof close !== "function") {
      this.#adapterClosed = true;
      return;
    }
    const attempt = close.call(this.#adapter);
    this.#adapterCloseAttempt = attempt;
    try {
      await attempt;
      this.#adapterClosed = true;
    } finally {
      this.#adapterCloseAttempt = null;
    }
  }

  async #runClose(): Promise<void> {
    if (this.#phase === "importing") await this.cancelImport();
    let closeFailed = false;
    try {
      await this.#closeAdapter();
    } catch {
      closeFailed = true;
    }
    this.#phase = "closed";
    if (closeFailed) {
      fail("ADAPTER_CLOSE_FAILED", "The local Windows selection helper could not be confirmed closed.");
    }
  }
}

function parseTruth(value: unknown): LocalIntakeWorkspaceTruthDtoV0 {
  if (!isRecord(value) || !hasExactKeys(value, Object.keys(zeroTruth()))) {
    return fail("COLLECTION_INVALID", "The collection truth summary is invalid.");
  }
  const members: Record<keyof LocalIntakeWorkspaceTruthDtoV0, number> = {
    pendingReview: 0,
    admitted: 0,
    excluded: 0,
    captured: 0,
    enhancedCaptured: 0,
    generatedCinematic: 0,
    conceptImagination: 0,
  };
  for (const key of Object.keys(members) as Array<keyof LocalIntakeWorkspaceTruthDtoV0>) {
    const member = value[key];
    if (
      typeof member !== "number" ||
      !Number.isSafeInteger(member) ||
      member < 0 ||
      Object.is(member, -0)
    ) {
      return fail("COLLECTION_INVALID", "The collection truth summary is invalid.");
    }
    members[key] = member;
  }
  return members;
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    return fail("COLLECTION_INVALID", "The collection count is invalid.");
  }
  return value;
}

function nullableSha(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256.test(value)) {
    return fail("COLLECTION_INVALID", "The collection digest is invalid.");
  }
  return value;
}

function parseCollectionItem(value: unknown, expectedPosition: number): LocalNativeIntakeCollectionItemV0 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "basketPosition", "kind", "status", "selectedFileCount", "selectedBytesDecimal",
    "receiptSha256", "childDirectory", "workspaceSha256", "inspectedFileCount",
    "inspectedBytes", "truth", "failureCode",
  ])) {
    return fail("COLLECTION_INVALID", "The collection item is invalid.");
  }
  const statuses = ["stored", "failed", "cancelled"] as const;
  const failureCodes: readonly LocalNativeIntakeCollectionItemFailureCodeV0[] = [
    "SOURCE_INSPECTION_FAILED", "SOURCE_SUMMARY_CHANGED", "WORKSPACE_COPY_FAILED",
    "IMPORT_CANCELLED", "COLLECTION_SETUP_FAILED",
  ];
  if (
    value.basketPosition !== expectedPosition ||
    (value.kind !== "file" && value.kind !== "directory") ||
    !statuses.some((status) => status === value.status) ||
    typeof value.selectedFileCount !== "number" ||
    !Number.isSafeInteger(value.selectedFileCount) ||
    value.selectedFileCount < 0 ||
    Object.is(value.selectedFileCount, -0) ||
    typeof value.selectedBytesDecimal !== "string" ||
    !BYTE_COUNT.test(value.selectedBytesDecimal)
  ) {
    return fail("COLLECTION_INVALID", "The collection item is invalid.");
  }
  const receiptSha256 = nullableSha(value.receiptSha256);
  const workspaceSha256 = nullableSha(value.workspaceSha256);
  const inspectedFileCount = nullableInteger(value.inspectedFileCount);
  const inspectedBytes = nullableInteger(value.inspectedBytes);
  const childDirectory = value.childDirectory === null
    ? null
    : typeof value.childDirectory === "string" &&
        CHILD_DIRECTORY.test(value.childDirectory) &&
        value.childDirectory === itemDirectory(expectedPosition)
      ? value.childDirectory
      : fail("COLLECTION_INVALID", "The collection child directory is invalid.");
  const truth = value.truth === null ? null : parseTruth(value.truth);
  const failureCode = value.failureCode === null
    ? null
    : typeof value.failureCode === "string" &&
        failureCodes.some((code) => code === value.failureCode)
      ? value.failureCode as LocalNativeIntakeCollectionItemFailureCodeV0
      : fail("COLLECTION_INVALID", "The collection failure code is invalid.");
  const stored = value.status === "stored";
  if (
    (stored &&
      (receiptSha256 === null || workspaceSha256 === null || childDirectory === null ||
        inspectedFileCount === null || inspectedBytes === null || truth === null ||
        failureCode !== null || !truthIsPending(truth, inspectedFileCount))) ||
    (!stored && (workspaceSha256 !== null || truth !== null || failureCode === null))
  ) {
    return fail("COLLECTION_INVALID", "The collection item state is inconsistent.");
  }
  return {
    basketPosition: expectedPosition,
    kind: value.kind,
    status: value.status as LocalNativeIntakeCollectionItemV0["status"],
    selectedFileCount: value.selectedFileCount,
    selectedBytesDecimal: value.selectedBytesDecimal,
    receiptSha256,
    childDirectory,
    workspaceSha256,
    inspectedFileCount,
    inspectedBytes,
    truth,
    failureCode,
  };
}

function parseTotals(value: unknown) {
  const keys = [
    "selectedRoots", "storedRoots", "failedRoots", "cancelledRoots", "storedFiles",
    "storedBytes",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    return fail("COLLECTION_INVALID", "The collection totals are invalid.");
  }
  const output: Record<(typeof keys)[number], number> = {
    selectedRoots: 0,
    storedRoots: 0,
    failedRoots: 0,
    cancelledRoots: 0,
    storedFiles: 0,
    storedBytes: 0,
  };
  for (const key of keys) {
    const member = value[key];
    if (
      typeof member !== "number" ||
      !Number.isSafeInteger(member) ||
      member < 0 ||
      Object.is(member, -0)
    ) {
      return fail("COLLECTION_INVALID", "The collection totals are invalid.");
    }
    output[key] = member;
  }
  return output;
}

function parseCollectionIndex(value: unknown): LocalNativeIntakeCollectionIndexV0 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "mode", "authority", "outcome", "items", "totals", "indexSha256",
  ])) {
    return fail("COLLECTION_INVALID", "The collection index is invalid.");
  }
  if (
    value.schemaVersion !== LOCAL_NATIVE_INTAKE_COLLECTION_INDEX_V0 ||
    (value.mode !== LOCAL_NATIVE_INTAKE_MODE_V0 &&
      value.mode !== LEGACY_LOCAL_NATIVE_INTAKE_MODE_V0) ||
    value.authority !== "none" ||
    (value.outcome !== "complete" &&
      value.outcome !== "complete_with_failures" &&
      value.outcome !== "cancelled") ||
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    typeof value.indexSha256 !== "string" ||
    !SHA256.test(value.indexSha256)
  ) {
    return fail("COLLECTION_INVALID", "The collection index is invalid.");
  }
  const items = value.items.map((item, index) => parseCollectionItem(item, index + 1));
  const totals = parseTotals(value.totals);
  const expectedTotals = terminalTotals(items);
  const expectedOutcome = outcomeFromItems(items.map((item) => ({ state: item.status })));
  if (
    JSON.stringify(totals) !== JSON.stringify(expectedTotals) ||
    value.outcome !== expectedOutcome
  ) {
    return fail("COLLECTION_INVALID", "The collection summary is inconsistent.");
  }
  const payload: LocalNativeIntakeCollectionIndexPayloadV0 = {
    schemaVersion: LOCAL_NATIVE_INTAKE_COLLECTION_INDEX_V0,
    mode: value.mode,
    authority: "none",
    outcome: value.outcome,
    items,
    totals,
  };
  const expectedDigest = domainSeparatedSha256(
    COLLECTION_INDEX_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  if (value.indexSha256 !== expectedDigest) {
    return fail("COLLECTION_INVALID", "The collection index digest does not match its contents.");
  }
  return deepFreeze({ ...payload, indexSha256: expectedDigest });
}

async function loadLocalNativeIntakeCollectionIndexV0(
  collectionRoot: string,
): Promise<LocalNativeIntakeCollectionIndexV0> {
  if (
    typeof collectionRoot !== "string" ||
    !isAbsolute(collectionRoot) ||
    resolve(collectionRoot) !== collectionRoot ||
    collectionRoot.includes("\0")
  ) {
    return fail("COLLECTION_INVALID", "The process-owned collection root is invalid.");
  }
  const rootStatus = await lstat(collectionRoot).catch(() => null);
  const indexPath = join(collectionRoot, COLLECTION_INDEX_FILE);
  const indexStatus = await lstat(indexPath).catch(() => null);
  if (
    rootStatus === null ||
    !rootStatus.isDirectory() ||
    rootStatus.isSymbolicLink() ||
    indexStatus === null ||
    !indexStatus.isFile() ||
    indexStatus.isSymbolicLink() ||
    indexStatus.nlink !== 1 ||
    indexStatus.size > MAX_INDEX_BYTES
  ) {
    return fail("COLLECTION_INVALID", "The collection root or index file is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return fail("COLLECTION_INVALID", "The collection index is not valid JSON.");
  }
  return parseCollectionIndex(parsed);
}

/**
 * Process-only tolerant reopen boundary for analysis. The collection index and
 * its exact caller-supplied digest fail closed as a unit. Every stored T-541
 * child is then reverified independently so one damaged copy cannot suppress
 * truthful results for later intact copies.
 */
export async function openLocalNativeIntakeCollectionForAnalysisV0(
  input: LocalNativeIntakeCollectionAnalysisInputV0,
): Promise<OpenedLocalNativeIntakeCollectionForAnalysisV0> {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["collectionRoot", "collectionIndexSha256"]) ||
    typeof input.collectionIndexSha256 !== "string" ||
    !SHA256.test(input.collectionIndexSha256)
  ) {
    return fail("COLLECTION_INVALID", "The process-owned collection analysis input is invalid.");
  }
  const index = await loadLocalNativeIntakeCollectionIndexV0(input.collectionRoot);
  if (index.indexSha256 !== input.collectionIndexSha256) {
    return fail("COLLECTION_INVALID", "The collection index does not match the process-owned digest.");
  }
  const items: OpenedLocalNativeIntakeCollectionAnalysisItemV0[] = [];
  for (const item of index.items) {
    if (
      item.status !== "stored" ||
      item.childDirectory === null ||
      item.workspaceSha256 === null ||
      item.receiptSha256 === null ||
      item.inspectedFileCount === null ||
      item.inspectedBytes === null ||
      item.truth === null
    ) {
      items.push({
        basketPosition: item.basketPosition,
        kind: item.kind,
        selectedFileCount: item.selectedFileCount,
        selectedBytesDecimal: item.selectedBytesDecimal,
        truth: null,
        verification: "failed",
        activeSourcePath: null,
        childWorkspaceRoot: null,
        receiptSha256: item.receiptSha256,
        workspaceSha256: item.workspaceSha256,
        failureCode: "CHILD_NOT_STORED",
      });
      continue;
    }
    const verification = await verifyFoundryLocalIntakeWorkspaceV0(
      join(input.collectionRoot, item.childDirectory),
    ).catch(() => null);
    if (
      verification === null ||
      verification.index.workspaceSha256 !== item.workspaceSha256 ||
      verification.index.receiptSha256 !== item.receiptSha256 ||
      verification.index.fileCount !== item.inspectedFileCount ||
      verification.index.totalBytes !== item.inspectedBytes
    ) {
      items.push({
        basketPosition: item.basketPosition,
        kind: item.kind,
        selectedFileCount: item.selectedFileCount,
        selectedBytesDecimal: item.selectedBytesDecimal,
        truth: { ...item.truth },
        verification: "failed",
        activeSourcePath: null,
        childWorkspaceRoot: join(input.collectionRoot, item.childDirectory),
        receiptSha256: item.receiptSha256,
        workspaceSha256: item.workspaceSha256,
        failureCode: "CHILD_VERIFICATION_FAILED",
      });
      continue;
    }
    items.push({
      basketPosition: item.basketPosition,
      kind: item.kind,
      selectedFileCount: item.selectedFileCount,
      selectedBytesDecimal: item.selectedBytesDecimal,
      truth: { ...item.truth },
      verification: "verified",
      activeSourcePath: verification.activeSourcePath,
      childWorkspaceRoot: join(input.collectionRoot, item.childDirectory),
      receiptSha256: item.receiptSha256,
      workspaceSha256: item.workspaceSha256,
      failureCode: null,
    });
  }
  return deepFreeze({ indexSha256: index.indexSha256, items });
}

/** Process-only strict reopen boundary. `collectionRoot` must never come from a browser request. */
export async function verifyLocalNativeIntakeCollectionV0(
  collectionRoot: string,
): Promise<VerifiedLocalNativeIntakeCollectionV0> {
  const index = await loadLocalNativeIntakeCollectionIndexV0(collectionRoot);
  const opened = await openLocalNativeIntakeCollectionForAnalysisV0({
    collectionRoot,
    collectionIndexSha256: index.indexSha256,
  });
  const storedItems = index.items.filter((item) => item.status === "stored");
  const storedChildrenVerified = opened.items.filter(
    (item) => item.verification === "verified",
  ).length;
  if (storedChildrenVerified !== storedItems.length) {
    return fail("COLLECTION_INVALID", "A stored child workspace did not match the collection index.");
  }
  return deepFreeze({ index: structuredClone(index), storedChildrenVerified });
}

export function createLocalNativeIntakeControllerV0(
  options: CreateLocalNativeIntakeControllerV0Options,
): LocalNativeIntakeControllerV0 {
  return new LocalNativeIntakeControllerV0(options);
}

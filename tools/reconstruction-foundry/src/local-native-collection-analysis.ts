import {
  FoundryOperatorEvidenceChecklistV8Schema,
  FoundrySourceReadinessMapV8Schema,
  FoundryUniversalIntakeReceiptSchema,
  FoundryUniversalSourceFactsV8Schema,
  compileFoundryOperatorEvidenceChecklistV8,
  compileFoundrySourceReadinessMapV8,
  domainSeparatedSha256,
  inspectUniversalIntakeWithSourceFactsV8,
  toCanonicalJson,
  verifyFoundryLocalIntakeWorkspaceV0,
} from "@omnitwin/reconstruction-foundry";
import type { FoundryInputType } from "@omnitwin/types";
import {
  openLocalNativeIntakeCollectionForAnalysisV0,
  type LocalNativeIntakeCollectionAnalysisInputV0,
  type OpenedLocalNativeIntakeCollectionForAnalysisV0,
} from "./local-native-intake.js";
import type { LocalIntakeWorkspaceTruthDtoV0 } from "./local-intake-workspace.js";

export const LOCAL_NATIVE_COLLECTION_ANALYSIS_VIEW_V0 =
  "omnitwin.foundry.local-native-collection-analysis-view.v0";
export const LOCAL_NATIVE_COLLECTION_ANALYSIS_REPORT_V0 =
  "omnitwin.foundry.local-native-collection-analysis-report.v0";
export const LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0 =
  "needs_operator_review";
export const LOCAL_NATIVE_COLLECTION_ANALYSIS_CANCELLATION_BOUNDARY_V0 =
  "between_bounded_verification_steps";

const REPORT_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.LOCAL_NATIVE_COLLECTION_ANALYSIS_REPORT.V0";
const SHA256 = /^[a-f0-9]{64}$/u;

export type LocalNativeCollectionAnalysisPhaseV0 =
  | "not_ready"
  | "ready"
  | "running"
  | "complete"
  | "complete_with_failures"
  | "cancelled"
  | "failed"
  | "closed";

export type LocalNativeCollectionAnalysisItemStateV0 =
  | "queued"
  | "verifying"
  | "inspecting"
  | "complete"
  | "failed"
  | "cancelled";

export type LocalNativeCollectionAnalysisFamilySupportV0 =
  | "v8_bounded_profile"
  | "opaque_reference_only"
  | "detection_only";

export type LocalNativeCollectionAnalysisItemFailureCodeV0 =
  | "CHILD_NOT_STORED"
  | "CHILD_VERIFICATION_FAILED"
  | "INSPECTION_FAILED";

export type LocalNativeCollectionAnalysisBlockerCodeV0 =
  | "BOUNDED_INSPECTION_FAILED"
  | "BOUNDED_READINESS_BLOCKED"
  | "BOUNDED_SOURCE_FACTS_UNAVAILABLE"
  | "COPIED_PAYLOAD_NOT_STORED"
  | "COPIED_PAYLOAD_VERIFICATION_FAILED"
  | "INSPECTION_CANCELLED"
  | "INSPECTION_PENDING"
  | "OPERATOR_CHECKLIST_BLOCKED"
  | "OPERATOR_EVIDENCE_REVIEW_REQUIRED"
  | "XBIN_OFFICIAL_EXPORT_ONLY";

export type LocalNativeCollectionAnalysisNextActionCodeV0 =
  | "OBTAIN_OFFICIAL_EXPORT"
  | "OPERATOR_EVIDENCE_REVIEW_REQUIRED"
  | "RESTART_LOCAL_INTAKE"
  | "RESTART_LOCAL_SESSION"
  | "WAIT_FOR_BOUNDED_INSPECTION";

export interface LocalNativeCollectionAnalysisFamilyV0 {
  readonly inputType: FoundryInputType;
  readonly fileCount: number;
  readonly support: LocalNativeCollectionAnalysisFamilySupportV0;
}

export interface LocalNativeCollectionAnalysisArtifactV0<
  State extends "available" | "unavailable" | "blocked",
> {
  readonly state: State;
  readonly sha256: string;
}

export interface LocalNativeCollectionAnalysisItemV0 {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly label: string;
  readonly labelSafety: "generated_kind_and_position_only";
  readonly state: LocalNativeCollectionAnalysisItemStateV0;
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  readonly families: readonly LocalNativeCollectionAnalysisFamilyV0[];
  readonly facts: LocalNativeCollectionAnalysisArtifactV0<"available" | "unavailable"> | null;
  readonly readiness: LocalNativeCollectionAnalysisArtifactV0<"available" | "blocked"> | null;
  readonly checklist: LocalNativeCollectionAnalysisArtifactV0<"available" | "blocked"> | null;
  readonly blockers: {
    readonly state: "present";
    readonly codes: readonly LocalNativeCollectionAnalysisBlockerCodeV0[];
    readonly count: number;
  };
  readonly nextAction: {
    readonly state: "required" | "wait";
    readonly code: LocalNativeCollectionAnalysisNextActionCodeV0;
  };
  readonly planState: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0;
  readonly failureCode: LocalNativeCollectionAnalysisItemFailureCodeV0 | null;
}

export interface LocalNativeCollectionAnalysisTotalsV0 {
  readonly totalItems: number;
  readonly completedItems: number;
  readonly failedItems: number;
  readonly cancelledItems: number;
  readonly detectedFamilies: number;
}

export interface LocalNativeCollectionAnalysisViewV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_VIEW_V0;
  readonly authority: "none";
  readonly phase: LocalNativeCollectionAnalysisPhaseV0;
  readonly busy: boolean;
  readonly message: string;
  readonly planState: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0;
  readonly cancellationBoundary: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_CANCELLATION_BOUNDARY_V0;
  readonly collectionIndexSha256: string | null;
  readonly items: readonly LocalNativeCollectionAnalysisItemV0[];
  readonly totals: LocalNativeCollectionAnalysisTotalsV0;
  readonly canStart: boolean;
  readonly canCancel: boolean;
  readonly reportAvailable: boolean;
  readonly failureCode: "COLLECTION_INVALID" | null;
}

interface LocalNativeCollectionAnalysisReportPayloadV0 {
  readonly schemaVersion: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_REPORT_V0;
  readonly authority: "none";
  readonly outcome: "complete" | "complete_with_failures" | "cancelled" | "failed";
  readonly planState: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0;
  readonly cancellationBoundary: typeof LOCAL_NATIVE_COLLECTION_ANALYSIS_CANCELLATION_BOUNDARY_V0;
  readonly collectionIndexSha256: string;
  readonly items: readonly LocalNativeCollectionAnalysisItemV0[];
  readonly totals: LocalNativeCollectionAnalysisTotalsV0;
  readonly failureCode: "COLLECTION_INVALID" | null;
}

export interface LocalNativeCollectionAnalysisReportV0
  extends LocalNativeCollectionAnalysisReportPayloadV0 {
  readonly reportSha256: string;
}

type V8Inspection = Awaited<ReturnType<typeof inspectUniversalIntakeWithSourceFactsV8>>;

export interface LocalNativeCollectionAnalysisCoreV0 {
  readonly openCollection: (
    input: LocalNativeIntakeCollectionAnalysisInputV0,
  ) => Promise<OpenedLocalNativeIntakeCollectionForAnalysisV0>;
  readonly inspectSource: (
    source: string,
    options: { readonly signal?: AbortSignal },
  ) => Promise<V8Inspection>;
  readonly reverifyChild: (workspaceRoot: string) => Promise<{
    readonly index: {
      readonly receiptSha256: string;
      readonly workspaceSha256: string;
    };
    readonly activeSourcePath: string;
  }>;
}

export interface CreateLocalNativeCollectionAnalysisControllerV0Options {
  /** Returns a process-owned capability; never call this with browser input. */
  readonly resolveInput: () => LocalNativeIntakeCollectionAnalysisInputV0 | null;
  readonly core?: Partial<LocalNativeCollectionAnalysisCoreV0>;
}

export type LocalNativeCollectionAnalysisErrorCodeV0 =
  | "COLLECTION_NOT_READY"
  | "ANALYSIS_ALREADY_STARTED"
  | "ANALYSIS_CLOSED";

export class LocalNativeCollectionAnalysisError extends Error {
  readonly code: LocalNativeCollectionAnalysisErrorCodeV0;

  constructor(code: LocalNativeCollectionAnalysisErrorCodeV0, message: string) {
    super(message);
    this.name = "LocalNativeCollectionAnalysisError";
    this.code = code;
  }
}

interface PrivateItem {
  readonly basketPosition: number;
  readonly kind: "file" | "directory";
  readonly selectedFileCount: number;
  readonly selectedBytesDecimal: string;
  readonly truth: LocalIntakeWorkspaceTruthDtoV0 | null;
  state: LocalNativeCollectionAnalysisItemStateV0;
  families: readonly LocalNativeCollectionAnalysisFamilyV0[];
  facts: LocalNativeCollectionAnalysisItemV0["facts"];
  readiness: LocalNativeCollectionAnalysisItemV0["readiness"];
  checklist: LocalNativeCollectionAnalysisItemV0["checklist"];
  failureCode: LocalNativeCollectionAnalysisItemFailureCodeV0 | null;
}

const BOUNDED_PROFILE_FAMILIES: ReadonlySet<FoundryInputType> = new Set([
  "matterport_e57",
  "generic_e57",
  "ply_point_cloud",
  "generic_image",
  "drone_media",
  "video",
  "sog",
  "spz",
  "gaussian_ply",
  "obj",
  "glb_gltf",
  "calibration_bundle",
  "trajectory",
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  }
  return value;
}

function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function safeInput(
  resolveInput: () => LocalNativeIntakeCollectionAnalysisInputV0 | null,
): LocalNativeIntakeCollectionAnalysisInputV0 | null {
  try {
    const value = resolveInput();
    if (
      value === null ||
      typeof value.collectionRoot !== "string" ||
      value.collectionRoot.length === 0 ||
      typeof value.collectionIndexSha256 !== "string" ||
      !SHA256.test(value.collectionIndexSha256)
    ) {
      return null;
    }
    return { ...value };
  } catch {
    return null;
  }
}

function itemLabel(kind: "file" | "directory", position: number): string {
  return `${kind === "file" ? "File" : "Folder"} ${String(position)}`;
}

function familySupport(inputType: FoundryInputType): LocalNativeCollectionAnalysisFamilySupportV0 {
  if (inputType === "xgrids_xbin") return "opaque_reference_only";
  return BOUNDED_PROFILE_FAMILIES.has(inputType)
    ? "v8_bounded_profile"
    : "detection_only";
}

function publicGuidance(item: PrivateItem): Pick<
  LocalNativeCollectionAnalysisItemV0,
  "blockers" | "nextAction"
> {
  const codes = new Set<LocalNativeCollectionAnalysisBlockerCodeV0>([
    "OPERATOR_EVIDENCE_REVIEW_REQUIRED",
  ]);
  if (item.families.some((family) => family.inputType === "xgrids_xbin")) {
    codes.add("XBIN_OFFICIAL_EXPORT_ONLY");
  }
  if (item.facts?.state === "unavailable") codes.add("BOUNDED_SOURCE_FACTS_UNAVAILABLE");
  if (item.readiness?.state === "blocked") codes.add("BOUNDED_READINESS_BLOCKED");
  if (item.checklist?.state === "blocked") codes.add("OPERATOR_CHECKLIST_BLOCKED");
  if (item.state === "cancelled") codes.add("INSPECTION_CANCELLED");
  if (item.state === "queued" || item.state === "verifying" || item.state === "inspecting") {
    codes.add("INSPECTION_PENDING");
  }
  if (item.failureCode === "CHILD_NOT_STORED") {
    codes.add("COPIED_PAYLOAD_NOT_STORED");
  }
  if (item.failureCode === "CHILD_VERIFICATION_FAILED") {
    codes.add("COPIED_PAYLOAD_VERIFICATION_FAILED");
  }
  if (item.failureCode === "INSPECTION_FAILED") codes.add("BOUNDED_INSPECTION_FAILED");
  const sortedCodes = [...codes].sort();
  const nextAction = item.families.some((family) => family.inputType === "xgrids_xbin")
    ? { state: "required" as const, code: "OBTAIN_OFFICIAL_EXPORT" as const }
    : item.failureCode === "CHILD_NOT_STORED" ||
        item.failureCode === "CHILD_VERIFICATION_FAILED"
      ? { state: "required" as const, code: "RESTART_LOCAL_INTAKE" as const }
      : item.failureCode === "INSPECTION_FAILED" ||
        item.state === "cancelled"
      ? { state: "required" as const, code: "RESTART_LOCAL_SESSION" as const }
        : item.state === "queued" || item.state === "verifying" || item.state === "inspecting"
          ? { state: "wait" as const, code: "WAIT_FOR_BOUNDED_INSPECTION" as const }
          : {
              state: "required" as const,
              code: "OPERATOR_EVIDENCE_REVIEW_REQUIRED" as const,
            };
  return {
    blockers: { state: "present", codes: sortedCodes, count: sortedCodes.length },
    nextAction,
  };
}

function familiesFromReceipt(
  receipt: ReturnType<typeof FoundryUniversalIntakeReceiptSchema.parse>,
): readonly LocalNativeCollectionAnalysisFamilyV0[] {
  const counts = new Map<FoundryInputType, number>();
  for (const file of receipt.files) {
    for (const candidate of file.detection.candidates) {
      counts.set(candidate.inputType, (counts.get(candidate.inputType) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([inputType, fileCount]) => ({
      inputType,
      fileCount,
      support: familySupport(inputType),
    }));
}

function publicItem(item: PrivateItem): LocalNativeCollectionAnalysisItemV0 {
  const guidance = publicGuidance(item);
  return {
    basketPosition: item.basketPosition,
    kind: item.kind,
    label: itemLabel(item.kind, item.basketPosition),
    labelSafety: "generated_kind_and_position_only",
    state: item.state,
    selectedFileCount: item.selectedFileCount,
    selectedBytesDecimal: item.selectedBytesDecimal,
    truth: item.truth === null ? null : { ...item.truth },
    families: item.families.map((family) => ({ ...family })),
    facts: item.facts === null ? null : { ...item.facts },
    readiness: item.readiness === null ? null : { ...item.readiness },
    checklist: item.checklist === null ? null : { ...item.checklist },
    blockers: guidance.blockers,
    nextAction: guidance.nextAction,
    planState: LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0,
    failureCode: item.failureCode,
  };
}

function totals(items: readonly LocalNativeCollectionAnalysisItemV0[]): LocalNativeCollectionAnalysisTotalsV0 {
  return {
    totalItems: items.length,
    completedItems: items.filter((item) => item.state === "complete").length,
    failedItems: items.filter((item) => item.state === "failed").length,
    cancelledItems: items.filter((item) => item.state === "cancelled").length,
    detectedFamilies: new Set(
      items.flatMap((item) => item.families.map((family) => family.inputType)),
    ).size,
  };
}

function reportOutcome(
  phase: LocalNativeCollectionAnalysisPhaseV0,
): LocalNativeCollectionAnalysisReportPayloadV0["outcome"] {
  if (phase === "complete") return "complete";
  if (phase === "complete_with_failures") return "complete_with_failures";
  if (phase === "cancelled") return "cancelled";
  return "failed";
}

export class LocalNativeCollectionAnalysisControllerV0 {
  readonly #resolveInput: () => LocalNativeIntakeCollectionAnalysisInputV0 | null;
  readonly #core: LocalNativeCollectionAnalysisCoreV0;
  #phase: LocalNativeCollectionAnalysisPhaseV0 = "not_ready";
  #input: LocalNativeIntakeCollectionAnalysisInputV0 | null = null;
  #items: PrivateItem[] = [];
  #abort: AbortController | null = null;
  #runPromise: Promise<void> | null = null;
  #cancelRequested = false;
  #report: LocalNativeCollectionAnalysisReportV0 | null = null;
  #failureCode: "COLLECTION_INVALID" | null = null;

  constructor(options: CreateLocalNativeCollectionAnalysisControllerV0Options) {
    this.#resolveInput = options.resolveInput;
    this.#core = {
      openCollection:
        options.core?.openCollection ?? openLocalNativeIntakeCollectionForAnalysisV0,
      inspectSource:
        options.core?.inspectSource ?? inspectUniversalIntakeWithSourceFactsV8,
      reverifyChild:
        options.core?.reverifyChild ?? verifyFoundryLocalIntakeWorkspaceV0,
    };
  }

  getView(): LocalNativeCollectionAnalysisViewV0 {
    const available = this.#input ?? safeInput(this.#resolveInput);
    const phase = this.#phase === "not_ready" && available !== null ? "ready" : this.#phase;
    const items = this.#items.map(publicItem);
    return cloneFrozen({
      schemaVersion: LOCAL_NATIVE_COLLECTION_ANALYSIS_VIEW_V0,
      authority: "none",
      phase,
      busy: phase === "running",
      message: this.#message(phase),
      planState: LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0,
      cancellationBoundary: LOCAL_NATIVE_COLLECTION_ANALYSIS_CANCELLATION_BOUNDARY_V0,
      collectionIndexSha256: available?.collectionIndexSha256 ?? null,
      items,
      totals: totals(items),
      canStart: phase === "ready",
      canCancel: phase === "running",
      reportAvailable: this.#report !== null,
      failureCode: this.#failureCode,
    });
  }

  status(): LocalNativeCollectionAnalysisViewV0 {
    return this.getView();
  }

  start(): LocalNativeCollectionAnalysisViewV0 {
    if (this.#phase === "closed") {
      throw new LocalNativeCollectionAnalysisError("ANALYSIS_CLOSED", "The analysis controller is closed.");
    }
    if (this.#runPromise !== null || this.#phase !== "not_ready") {
      throw new LocalNativeCollectionAnalysisError(
        "ANALYSIS_ALREADY_STARTED",
        "Collection analysis has already started.",
      );
    }
    const input = safeInput(this.#resolveInput);
    if (input === null) {
      throw new LocalNativeCollectionAnalysisError(
        "COLLECTION_NOT_READY",
        "A verified durable collection is not ready for analysis.",
      );
    }
    this.#input = input;
    this.#phase = "running";
    this.#abort = new AbortController();
    this.#runPromise = new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
      .then(() => this.#run(input))
      .catch(() => {
        this.#finishGlobalFailure();
      });
    return this.getView();
  }

  async cancel(): Promise<LocalNativeCollectionAnalysisViewV0> {
    if (this.#phase !== "running") return this.getView();
    this.#cancelRequested = true;
    this.#abort?.abort();
    await this.#runPromise;
    return this.getView();
  }

  getReport(): LocalNativeCollectionAnalysisReportV0 | null {
    return this.#report === null ? null : cloneFrozen(this.#report);
  }

  async close(): Promise<void> {
    if (this.#phase === "running") await this.cancel();
    this.#phase = "closed";
    this.#abort = null;
  }

  async #run(input: LocalNativeIntakeCollectionAnalysisInputV0): Promise<void> {
    let opened: OpenedLocalNativeIntakeCollectionForAnalysisV0;
    try {
      opened = await this.#core.openCollection(input);
      if (opened.indexSha256 !== input.collectionIndexSha256) throw new Error("digest mismatch");
    } catch {
      this.#finishGlobalFailure();
      return;
    }
    this.#items = opened.items.map((item) => ({
      basketPosition: item.basketPosition,
      kind: item.kind,
      selectedFileCount: item.selectedFileCount,
      selectedBytesDecimal: item.selectedBytesDecimal,
      truth: item.truth === null ? null : { ...item.truth },
      state: item.verification === "verified" ? "queued" : "failed",
      families: [],
      facts: null,
      readiness: null,
      checklist: null,
      failureCode: item.failureCode,
    }));
    for (let index = 0; index < opened.items.length; index += 1) {
      const source = opened.items[index];
      const item = this.#items[index];
      if (source === undefined || item === undefined || item.state === "failed") continue;
      if (this.#cancelRequested) {
        item.state = "cancelled";
        continue;
      }
      item.state = "verifying";
      if (
        source.verification !== "verified" ||
        source.activeSourcePath === null ||
        source.childWorkspaceRoot === null ||
        source.receiptSha256 === null ||
        source.workspaceSha256 === null
      ) {
        item.state = "failed";
        item.failureCode = "CHILD_VERIFICATION_FAILED";
        continue;
      }
      item.state = "inspecting";
      try {
        const candidate = await this.#core.inspectSource(source.activeSourcePath, {
          signal: this.#abort?.signal,
        });
        if (this.#wasCancelled()) {
          item.state = "cancelled";
          continue;
        }
        const receipt = FoundryUniversalIntakeReceiptSchema.parse(candidate.receipt);
        if (receipt.receiptSha256 !== source.receiptSha256) {
          throw new Error("The inspected copied payload no longer matches its T-541 receipt.");
        }
        const facts = FoundryUniversalSourceFactsV8Schema.parse(candidate.sourceFacts);
        const readiness = FoundrySourceReadinessMapV8Schema.parse(
          compileFoundrySourceReadinessMapV8({ receipt, sourceFacts: facts }),
        );
        const checklist = FoundryOperatorEvidenceChecklistV8Schema.parse(
          compileFoundryOperatorEvidenceChecklistV8({ readiness }),
        );
        const reverified = await this.#core.reverifyChild(source.childWorkspaceRoot);
        if (
          reverified.index.receiptSha256 !== source.receiptSha256 ||
          reverified.index.workspaceSha256 !== source.workspaceSha256 ||
          reverified.activeSourcePath !== source.activeSourcePath
        ) {
          throw new Error("The copied payload changed after bounded inspection.");
        }
        if (this.#wasCancelled()) {
          item.state = "cancelled";
          continue;
        }
        item.families = familiesFromReceipt(receipt);
        item.facts = { state: facts.state, sha256: facts.factsSha256 };
        item.readiness = { state: readiness.state, sha256: readiness.readinessSha256 };
        item.checklist = { state: checklist.state, sha256: checklist.checklistSha256 };
        item.state = "complete";
        item.failureCode = null;
      } catch {
        item.state = this.#wasCancelled() ? "cancelled" : "failed";
        item.failureCode = this.#wasCancelled() ? null : "INSPECTION_FAILED";
      }
    }
    if (this.#cancelRequested) {
      for (const item of this.#items) {
        if (item.state === "queued" || item.state === "verifying" || item.state === "inspecting") {
          item.state = "cancelled";
          item.failureCode = null;
        }
      }
      this.#phase = "cancelled";
    } else {
      this.#phase = this.#items.some((item) => item.state === "failed")
        ? "complete_with_failures"
        : "complete";
    }
    this.#compileReport();
  }

  #finishGlobalFailure(): void {
    if (this.#report !== null) return;
    this.#failureCode = "COLLECTION_INVALID";
    this.#phase = "failed";
    this.#compileReport();
  }

  #wasCancelled(): boolean {
    return this.#cancelRequested;
  }

  #compileReport(): void {
    if (this.#report !== null || this.#input === null) return;
    const items = this.#items.map(publicItem);
    const payload: LocalNativeCollectionAnalysisReportPayloadV0 = {
      schemaVersion: LOCAL_NATIVE_COLLECTION_ANALYSIS_REPORT_V0,
      authority: "none",
      outcome: reportOutcome(this.#phase),
      planState: LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0,
      cancellationBoundary: LOCAL_NATIVE_COLLECTION_ANALYSIS_CANCELLATION_BOUNDARY_V0,
      collectionIndexSha256: this.#input.collectionIndexSha256,
      items,
      totals: totals(items),
      failureCode: this.#failureCode,
    };
    this.#report = deepFreeze({
      ...payload,
      reportSha256: domainSeparatedSha256(REPORT_DIGEST_DOMAIN, toCanonicalJson(payload)),
    });
  }

  #message(phase: LocalNativeCollectionAnalysisPhaseV0): string {
    if (phase === "not_ready") return "Finish keeping verified local copies before inspection.";
    if (phase === "ready") return "The verified local collection is ready for bounded inspection.";
    if (phase === "running") return "Inspecting verified copied payloads one item at a time.";
    if (phase === "complete") return "Copied payload inspection is complete; operator review is still required.";
    if (phase === "complete_with_failures") return "Inspection finished with isolated item failures; operator review is still required.";
    if (phase === "cancelled") return "Inspection was cancelled; completed item results were preserved.";
    if (phase === "failed") return "The durable collection could not be verified for inspection.";
    return "The collection analysis controller is closed.";
  }
}

export function createLocalNativeCollectionAnalysisControllerV0(
  options: CreateLocalNativeCollectionAnalysisControllerV0Options,
): LocalNativeCollectionAnalysisControllerV0 {
  return new LocalNativeCollectionAnalysisControllerV0(options);
}

export type { OpenedLocalNativeIntakeCollectionForAnalysisV0 };

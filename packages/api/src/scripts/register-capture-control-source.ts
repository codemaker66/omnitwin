import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  CaptureControlRegistrationReportInspectionSchema,
  CaptureControlRegistrationReportSchema,
  CaptureControlSourceRegistrationSchema,
  RegisterCaptureControlSourceRecordInputSchema,
  type CaptureControlRegistrationReportInspection,
  type CaptureControlRegistrationReport,
  type CaptureControlSourceRegistration,
  type RegisterCaptureControlSourceRecordInput,
  RoomAssetStatusSchema,
  type RoomAssetStatus,
  RuntimePackageSchema,
  type RuntimePackage,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// register-capture-control-source
//
// Posts a schema-validated capture-control source payload through the admin
// asset API. This intentionally goes through HTTP/auth instead of writing the
// database directly, so operator registration exercises the same contract as
// the production UI/API path.
//
// Usage:
//   $env:VENVIEWER_ADMIN_BEARER_TOKEN="<admin Clerk JWT>"
//   pnpm --filter @omnitwin/api tsx src/scripts/register-capture-control-source.ts
//
// Optional:
//   $env:VENVIEWER_API_URL="http://localhost:3001"
//   $env:CAPTURE_CONTROL_SOURCE_FILE="docs/operations/<payload>.json"
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "http://localhost:3001";
const DEFAULT_SOURCE_FILE = fileURLToPath(
  new URL(
    "../../../../docs/operations/reception-room-visual-alignment-capture-control-source-2026-06-16.json",
    import.meta.url,
  ),
);

export type CaptureControlFetch = (
  input: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Response | Promise<Response>;

interface RegisterCaptureControlOptions {
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly payload: RegisterCaptureControlSourceRecordInput;
  readonly allowRuntimePackageDrift?: boolean;
  readonly allowStaleReadback?: boolean;
  readonly fetchImpl?: CaptureControlFetch;
}

export interface CaptureControlRegistrationVerification {
  readonly preflight: CaptureControlPreflightResult;
  readonly registration: CaptureControlSourceRegistration;
  readonly persistedSource: CaptureControlSourceRegistration;
  readonly roomStatus: RoomAssetStatus;
}

export interface CaptureControlPreflightResult {
  readonly payloadRuntimePackageId: string | null;
  readonly latestRuntimePackage: RuntimePackage | null;
  readonly runtimePackageDriftAllowed: boolean;
}

interface RunRegisterCaptureControlSourceOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: CaptureControlFetch;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readReport?: (filePath: string) => unknown;
  readonly inspectionFileExists?: (filePath: string) => boolean;
  readonly writeInspection?: (
    filePath: string,
    inspection: CaptureControlRegistrationReportInspection,
    options: { readonly allowOverwrite: boolean },
  ) => void;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly writeReport?: (
    filePath: string,
    report: CaptureControlRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

const CaptureControlSourceListResponseSchema = z.object({
  data: z.array(CaptureControlSourceRegistrationSchema),
}).strict();

const RoomAssetStatusListResponseSchema = z.object({
  data: z.array(RoomAssetStatusSchema),
}).strict();

const LatestRuntimePackageResponseSchema = z.object({
  data: RuntimePackageSchema.nullable(),
}).strict();

export function captureControlSourceEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/register-capture-control-source`;
}

export function latestRuntimePackageEndpoint(
  apiUrl: string,
  payload: RegisterCaptureControlSourceRecordInput,
): string {
  const params = new URLSearchParams({
    venue: payload.venueSlug,
    room: payload.roomSlug,
  });
  return `${apiUrl.replace(/\/+$/u, "")}/assets/runtime-packages/latest?${params.toString()}`;
}

export function captureControlSourcesEndpoint(
  apiUrl: string,
  payload: RegisterCaptureControlSourceRecordInput,
): string {
  const params = new URLSearchParams({
    venue: payload.venueSlug,
    room: payload.roomSlug,
  });
  const runtimePackageId = payload.runtimePackageId ?? null;
  const transformArtifactId = payload.transformArtifactId ?? null;
  if (runtimePackageId !== null) params.set("runtimePackageId", runtimePackageId);
  if (transformArtifactId !== null) params.set("transformArtifactId", transformArtifactId);
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/capture-control-sources?${params.toString()}`;
}

export function roomAssetStatusesEndpoint(apiUrl: string, venueSlug: string): string {
  const params = new URLSearchParams({ venue: venueSlug });
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/rooms?${params.toString()}`;
}

function formatValidationIssues(issues: readonly z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
      return `${path}: ${issue.message}`;
    })
    .join("\n  ");
}

function loadJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${String(error)}`);
  }
}

export function loadCaptureControlSourcePayload(
  filePath = DEFAULT_SOURCE_FILE,
): RegisterCaptureControlSourceRecordInput {
  const parsed = loadJsonFile(filePath);

  const result = RegisterCaptureControlSourceRecordInputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = formatValidationIssues(result.error.issues);
    throw new Error(`Validation failed for ${filePath}:\n  ${issues}`);
  }
  return result.data;
}

export function loadCaptureControlRegistrationReport(
  filePath: string,
): CaptureControlRegistrationReport {
  const parsed = loadJsonFile(filePath);

  const result = CaptureControlRegistrationReportSchema.safeParse(parsed);
  if (!result.success) {
    const issues = formatValidationIssues(result.error.issues);
    throw new Error(`Validation failed for ${filePath}:\n  ${issues}`);
  }
  return result.data;
}

export function inspectCaptureControlRegistrationReport(
  rawReport: unknown,
  params: {
    readonly generatedAt: string;
    readonly inspectedReportFile: string;
  },
): CaptureControlRegistrationReportInspection {
  const parsed = CaptureControlRegistrationReportSchema.safeParse(rawReport);
  if (!parsed.success) {
    return CaptureControlRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.capture-control-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: null,
      status: "invalid_report",
      liveRegistrationReady: false,
      mode: null,
      venueSlug: null,
      roomSlug: null,
      sourceId: null,
      reportRuntimePackageId: null,
      reportLatestRuntimePackageId: null,
      reportRuntimePackageMatchesLatest: null,
      reportRuntimePackageDriftAllowed: null,
      reportStaleReadbackAllowed: null,
      blockers: parsed.error.issues.map((issue) => {
        const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
        return `${path}: ${issue.message}`;
      }),
      messages: ["Report failed CaptureControlRegistrationReportSchema validation."],
    });
  }

  const report = parsed.data;
  const blockers: string[] = [];
  const messages: string[] = [
    `Report schema is valid for ${report.payload.sourceId} in ${report.payload.venueSlug}/${report.payload.roomSlug}.`,
    "Report records no signed transform creation and no public exposure change.",
  ];

  if (report.mode === "registered") {
    return CaptureControlRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.capture-control-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: report.generatedAt,
      status: "registered_report_verified",
      liveRegistrationReady: false,
      mode: report.mode,
      venueSlug: report.payload.venueSlug,
      roomSlug: report.payload.roomSlug,
      sourceId: report.payload.sourceId,
      reportRuntimePackageId: report.payload.runtimePackageId,
      reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
      reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
      reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
      reportStaleReadbackAllowed: report.guardrails.staleReadbackAllowed,
      blockers: [
        "Report already records a live registration; use it as audit evidence, not authorization for another POST.",
      ],
      messages,
    });
  }

  if (report.payload.runtimePackageId === null) {
    blockers.push("Dry-run report is not scoped to a runtime package.");
  }
  if (report.preflight.latestRuntimePackageId === null) {
    blockers.push("Dry-run preflight did not resolve a latest loadable runtime package.");
  }
  if (report.preflight.runtimePackageMatchesLatest !== true) {
    blockers.push("Payload runtime package is not the latest loadable runtime package.");
  }
  if (report.preflight.runtimePackageDriftAllowed || report.guardrails.runtimePackageDriftAllowed) {
    blockers.push("Runtime-package drift override was enabled; rerun a normal dry-run before live registration.");
  }
  if (report.guardrails.staleReadbackAllowed) {
    blockers.push("Stale-readback override was enabled; rerun a normal dry-run before live registration.");
  }
  if (
    report.preflight.latestRuntimePackageRuntimeStatus !== null &&
    report.preflight.latestRuntimePackageRuntimeStatus !== "internal_ready" &&
    report.preflight.latestRuntimePackageRuntimeStatus !== "published"
  ) {
    blockers.push(
      `Latest runtime package status is ${report.preflight.latestRuntimePackageRuntimeStatus}; expected internal_ready or published.`,
    );
  }
  if (report.preflight.latestRuntimePackageEvidenceStatus === "rejected") {
    blockers.push("Latest runtime package evidence status is rejected.");
  }

  if (blockers.length === 0) {
    messages.push("Dry-run report is current for live capture-control registration preflight.");
  }

  return CaptureControlRegistrationReportInspectionSchema.parse({
    schemaVersion: "venviewer.capture-control-registration-report-inspection.v0",
    generatedAt: params.generatedAt,
    inspectedReportFile: params.inspectedReportFile,
    inspectedReportGeneratedAt: report.generatedAt,
    status: blockers.length === 0 ? "ready_for_live_registration" : "not_ready_for_live_registration",
    liveRegistrationReady: blockers.length === 0,
    mode: report.mode,
    venueSlug: report.payload.venueSlug,
    roomSlug: report.payload.roomSlug,
    sourceId: report.payload.sourceId,
    reportRuntimePackageId: report.payload.runtimePackageId,
    reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
    reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
    reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
    reportStaleReadbackAllowed: report.guardrails.staleReadbackAllowed,
    blockers,
    messages,
  });
}

export function formatCaptureControlRegistrationReportInspection(
  inspection: CaptureControlRegistrationReportInspection,
): readonly string[] {
  const target = inspection.sourceId === null ||
    inspection.venueSlug === null ||
    inspection.roomSlug === null
    ? "unknown capture-control report"
    : `${inspection.sourceId} for ${inspection.venueSlug}/${inspection.roomSlug}`;
  return [
    `Capture-control report inspection: ${inspection.status}.`,
    `Target: ${target}.`,
    ...inspection.messages.map((message) => `Check: ${message}`),
    ...inspection.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

function parseResponseBody(raw: string): unknown {
  if (raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function responseErrorBody(body: unknown): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function envFlag(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return env[name] === "true";
}

function defaultWriteReport(
  filePath: string,
  report: CaptureControlRegistrationReport,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function defaultWriteInspection(
  filePath: string,
  inspection: CaptureControlRegistrationReportInspection,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(inspection, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

async function fetchJson(
  fetchImpl: CaptureControlFetch,
  input: string,
  init: Parameters<CaptureControlFetch>[1],
  operation: string,
): Promise<unknown> {
  const response = await fetchImpl(input, init);
  const body = parseResponseBody(await response.text());
  if (!response.ok) {
    throw new Error(
      `${operation} failed with HTTP ${String(response.status)}: ${responseErrorBody(body)}`,
    );
  }
  return body;
}

function authHeaders(bearerToken: string): Readonly<Record<string, string>> {
  if (bearerToken.trim().length === 0) return {};
  return { authorization: `Bearer ${bearerToken}` };
}

function jsonAuthHeaders(bearerToken: string): Readonly<Record<string, string>> {
  return {
    ...authHeaders(bearerToken),
    "content-type": "application/json",
  };
}

function envelopeData(body: unknown): unknown {
  return body !== null && typeof body === "object" && "data" in body
    ? (body as { readonly data: unknown }).data
    : body;
}

export async function registerCaptureControlSource(
  options: RegisterCaptureControlOptions,
): Promise<CaptureControlSourceRegistration> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, captureControlSourceEndpoint(options.apiUrl), {
    method: "POST",
    headers: jsonAuthHeaders(options.bearerToken),
    body: JSON.stringify(options.payload),
  }, "Capture-control source registration");

  return CaptureControlSourceRegistrationSchema.parse(envelopeData(body));
}

export async function readRegisteredCaptureControlSources(
  options: RegisterCaptureControlOptions,
): Promise<readonly CaptureControlSourceRegistration[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, captureControlSourcesEndpoint(options.apiUrl, options.payload), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Capture-control source readback");

  return CaptureControlSourceListResponseSchema.parse(body).data;
}

export async function readRoomAssetStatuses(
  options: RegisterCaptureControlOptions,
): Promise<readonly RoomAssetStatus[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, roomAssetStatusesEndpoint(options.apiUrl, options.payload.venueSlug), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Room asset status readback");

  return RoomAssetStatusListResponseSchema.parse(body).data;
}

export async function readLatestRuntimePackage(
  options: RegisterCaptureControlOptions,
): Promise<RuntimePackage | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, latestRuntimePackageEndpoint(options.apiUrl, options.payload), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Latest runtime package preflight");

  return LatestRuntimePackageResponseSchema.parse(body).data;
}

export async function preflightCaptureControlRegistration(
  options: RegisterCaptureControlOptions,
): Promise<CaptureControlPreflightResult> {
  const payloadRuntimePackageId = options.payload.runtimePackageId ?? null;
  if (payloadRuntimePackageId === null) {
    return {
      payloadRuntimePackageId,
      latestRuntimePackage: null,
      runtimePackageDriftAllowed: options.allowRuntimePackageDrift === true,
    };
  }

  const latestPackage = await readLatestRuntimePackage(options);
  const runtimePackageDriftAllowed = options.allowRuntimePackageDrift === true;
  if (latestPackage === null && !runtimePackageDriftAllowed) {
    throw new Error(
      `Latest runtime package preflight returned no loadable package for ${options.payload.venueSlug}/${options.payload.roomSlug}. Refusing to register package-scoped capture-control evidence before POST.`,
    );
  }
  if (latestPackage !== null && latestPackage.id !== payloadRuntimePackageId && !runtimePackageDriftAllowed) {
    throw new Error(
      `Capture-control payload targets runtime package ${payloadRuntimePackageId}, but latest loadable runtime package is ${latestPackage.id}. Refusing to register drifted package-scoped evidence before POST without VENVIEWER_ALLOW_CAPTURE_CONTROL_RUNTIME_PACKAGE_DRIFT=true.`,
    );
  }

  return {
    payloadRuntimePackageId,
    latestRuntimePackage: latestPackage,
    runtimePackageDriftAllowed,
  };
}

function sameRegistration(
  left: CaptureControlSourceRegistration,
  right: CaptureControlSourceRegistration,
): boolean {
  return left.id === right.id &&
    left.venueSlug === right.venueSlug &&
    left.roomSlug === right.roomSlug &&
    left.sourceId === right.sourceId &&
    left.runtimePackageId === right.runtimePackageId &&
    left.transformArtifactId === right.transformArtifactId;
}

function verifyRoomStatusMatchesRegistration(
  roomStatus: RoomAssetStatus,
  registration: CaptureControlSourceRegistration,
  allowStaleReadback: boolean,
): void {
  if (roomStatus.latestCaptureControlSourceRecordId !== registration.id) {
    throw new Error(
      `Room asset status readback did not surface persisted row ${registration.id} as the latest capture-control source for ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }
  if (roomStatus.latestCaptureControlSourceId !== registration.sourceId) {
    throw new Error(
      `Room asset status readback did not surface ${registration.sourceId} as the latest capture-control source for ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }
  if (roomStatus.latestCaptureControlSourceClass !== registration.sourceClass) {
    throw new Error(
      `Room asset status readback reported source class ${String(roomStatus.latestCaptureControlSourceClass)} for ${registration.sourceId}; expected ${registration.sourceClass}.`,
    );
  }
  if (roomStatus.latestCaptureControlPoseAuthorityLevel !== registration.poseAuthorityLevel) {
    throw new Error(
      `Room asset status readback reported pose authority ${String(roomStatus.latestCaptureControlPoseAuthorityLevel)} for ${registration.sourceId}; expected ${registration.poseAuthorityLevel}.`,
    );
  }
  if (roomStatus.latestCaptureControlQaStatus !== registration.qaStatus) {
    throw new Error(
      `Room asset status readback reported QA status ${String(roomStatus.latestCaptureControlQaStatus)} for ${registration.sourceId}; expected ${registration.qaStatus}.`,
    );
  }
  if (
    registration.poseAuthorityLevel === "visual_alignment_only" &&
    roomStatus.captureControlAuthoritySafeCopy !== "visual-only alignment source recorded; not measurement control"
  ) {
    throw new Error(
      `Room asset status readback did not preserve the visual-only authority warning for ${registration.sourceId}.`,
    );
  }
  if (!allowStaleReadback && roomStatus.captureControlFreshnessStatus === "stale_for_runtime_package") {
    const activeTriggers = roomStatus.latestCaptureControlActiveStalenessTriggers.length === 0
      ? "none"
      : roomStatus.latestCaptureControlActiveStalenessTriggers.join(", ");
    throw new Error(
      `Room asset status readback marked ${registration.sourceId} as stale_for_runtime_package with active stale triggers ${activeTriggers}. Refusing success without VENVIEWER_ALLOW_STALE_CAPTURE_CONTROL_READBACK=true.`,
    );
  }
}

export async function registerAndVerifyCaptureControlSource(
  options: RegisterCaptureControlOptions,
): Promise<CaptureControlRegistrationVerification> {
  const preflight = await preflightCaptureControlRegistration(options);
  const registration = await registerCaptureControlSource(options);
  const persistedSources = await readRegisteredCaptureControlSources(options);
  const persistedSource = persistedSources.find((source) => sameRegistration(source, registration));
  if (persistedSource === undefined) {
    throw new Error(
      `Capture-control source readback did not include persisted row ${registration.id} (${registration.sourceId}) for ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }

  const roomStatuses = await readRoomAssetStatuses(options);
  const roomStatus = roomStatuses.find((status) =>
    status.venueSlug === registration.venueSlug && status.roomSlug === registration.roomSlug,
  );
  if (roomStatus === undefined) {
    throw new Error(
      `Room asset status readback did not include ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }
  verifyRoomStatusMatchesRegistration(roomStatus, registration, options.allowStaleReadback === true);

  return { preflight, registration, persistedSource, roomStatus };
}

function buildCaptureControlRegistrationReport(
  params: {
    readonly generatedAt: string;
    readonly mode: CaptureControlRegistrationReport["mode"];
    readonly apiUrl: string;
    readonly payloadFile: string;
    readonly payload: RegisterCaptureControlSourceRecordInput;
    readonly preflight: CaptureControlPreflightResult;
    readonly allowRuntimePackageDrift: boolean;
    readonly allowStaleReadback: boolean;
    readonly registration?: CaptureControlSourceRegistration;
    readonly roomStatus?: RoomAssetStatus;
  },
): CaptureControlRegistrationReport {
  const latestRuntimePackageId = params.preflight.latestRuntimePackage?.id ?? null;
  const payloadRuntimePackageId = params.preflight.payloadRuntimePackageId;
  const runtimePackageMatchesLatest = payloadRuntimePackageId === null
    ? null
    : latestRuntimePackageId !== null && payloadRuntimePackageId === latestRuntimePackageId;

  return CaptureControlRegistrationReportSchema.parse({
    schemaVersion: "venviewer.capture-control-registration-report.v0",
    generatedAt: params.generatedAt,
    mode: params.mode,
    apiUrl: params.apiUrl,
    payloadFile: params.payloadFile,
    payload: {
      venueSlug: params.payload.venueSlug,
      roomSlug: params.payload.roomSlug,
      sourceId: params.payload.source.sourceId,
      sourceClass: params.payload.source.sourceClass,
      poseAuthorityLevel: params.payload.source.poseAuthorityLevel,
      qaStatus: params.payload.source.qaStatus,
      runtimePackageId: params.payload.runtimePackageId ?? null,
      transformArtifactId: params.payload.transformArtifactId ?? null,
      staleWhen: params.payload.source.staleWhen,
    },
    preflight: {
      payloadRuntimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus: params.preflight.latestRuntimePackage?.runtimeStatus ?? null,
      latestRuntimePackageEvidenceStatus: params.preflight.latestRuntimePackage?.evidenceStatus ?? null,
      runtimePackageMatchesLatest,
      runtimePackageDriftAllowed: params.preflight.runtimePackageDriftAllowed,
    },
    registration: params.registration === undefined
      ? null
      : {
        captureControlSourceId: params.registration.id,
        sourceId: params.registration.sourceId,
        qaStatus: params.registration.qaStatus,
        registeredBy: params.registration.registeredBy,
        createdAt: params.registration.createdAt,
        updatedAt: params.registration.updatedAt,
      },
    roomStatus: params.roomStatus === undefined
      ? null
      : {
        latestCaptureControlSourceRecordId: params.roomStatus.latestCaptureControlSourceRecordId,
        latestCaptureControlSourceId: params.roomStatus.latestCaptureControlSourceId,
        latestCaptureControlSourceClass: params.roomStatus.latestCaptureControlSourceClass,
        latestCaptureControlPoseAuthorityLevel: params.roomStatus.latestCaptureControlPoseAuthorityLevel,
        latestCaptureControlQaStatus: params.roomStatus.latestCaptureControlQaStatus,
        captureControlStatus: params.roomStatus.captureControlStatus,
        captureControlFreshnessStatus: params.roomStatus.captureControlFreshnessStatus,
        activeStalenessTriggers: params.roomStatus.latestCaptureControlActiveStalenessTriggers,
        captureControlSafeCopy: params.roomStatus.captureControlSafeCopy,
        captureControlAuthoritySafeCopy: params.roomStatus.captureControlAuthoritySafeCopy,
      },
    guardrails: {
      runtimePackageDriftAllowed: params.allowRuntimePackageDrift,
      staleReadbackAllowed: params.allowStaleReadback,
      signedTransformCreated: false,
      publicExposureChanged: false,
    },
  });
}

function writeReportIfRequested(
  reportFile: string | null,
  report: CaptureControlRegistrationReport,
  writer: (
    filePath: string,
    report: CaptureControlRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void,
  allowOverwrite: boolean,
): void {
  if (reportFile === null) return;
  writer(reportFile, report, { allowOverwrite });
}

function writeInspectionIfRequested(
  inspectionFile: string | null,
  inspection: CaptureControlRegistrationReportInspection,
  writer: (
    filePath: string,
    inspection: CaptureControlRegistrationReportInspection,
    options: { readonly allowOverwrite: boolean },
  ) => void,
  allowOverwrite: boolean,
): void {
  if (inspectionFile === null) return;
  writer(inspectionFile, inspection, { allowOverwrite });
}

function assertReportFileCanBeWritten(
  reportFile: string | null,
  allowOverwrite: boolean,
  fileExists: (filePath: string) => boolean,
): void {
  if (reportFile === null || allowOverwrite) return;
  if (!fileExists(reportFile)) return;
  throw new Error(
    `Capture-control report file already exists at ${reportFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_CAPTURE_CONTROL_REPORT=true.`,
  );
}

function assertInspectionFileCanBeWritten(
  inspectionFile: string | null,
  allowOverwrite: boolean,
  fileExists: (filePath: string) => boolean,
): void {
  if (inspectionFile === null || allowOverwrite) return;
  if (!fileExists(inspectionFile)) return;
  throw new Error(
    `Capture-control inspection file already exists at ${inspectionFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_CAPTURE_CONTROL_INSPECTION=true.`,
  );
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export async function runRegisterCaptureControlSource(
  options: RunRegisterCaptureControlSourceOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const inspectReportPath = env["CAPTURE_CONTROL_INSPECT_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["CAPTURE_CONTROL_INSPECT_REPORT_FILE"]);
  const inspectionFile = env["CAPTURE_CONTROL_INSPECTION_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["CAPTURE_CONTROL_INSPECTION_FILE"]);
  if (inspectReportPath === null && inspectionFile !== null) {
    throw new Error("CAPTURE_CONTROL_INSPECTION_FILE requires CAPTURE_CONTROL_INSPECT_REPORT_FILE.");
  }
  if (inspectReportPath !== null) {
    const readReport = options.readReport ?? loadJsonFile;
    const writeInspection = options.writeInspection ?? defaultWriteInspection;
    const inspectionFileExists = options.inspectionFileExists ?? existsSync;
    const allowInspectionOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_CAPTURE_CONTROL_INSPECTION");
    assertInspectionFileCanBeWritten(inspectionFile, allowInspectionOverwrite, inspectionFileExists);
    const inspection = inspectCaptureControlRegistrationReport(readReport(inspectReportPath), {
      generatedAt: now().toISOString(),
      inspectedReportFile: inspectReportPath,
    });
    writeInspectionIfRequested(
      inspectionFile,
      inspection,
      writeInspection,
      allowInspectionOverwrite,
    );
    for (const line of formatCaptureControlRegistrationReportInspection(inspection)) {
      log(line);
    }
    if (!inspection.liveRegistrationReady) {
      const blockers = inspection.blockers.length === 0
        ? "no readiness blockers were reported"
        : inspection.blockers.join("; ");
      throw new Error(
        `Capture-control report ${inspectReportPath} is not ready for live registration: ${blockers}`,
      );
    }
    return;
  }
  const payloadPath = env["CAPTURE_CONTROL_SOURCE_FILE"] === undefined
    ? DEFAULT_SOURCE_FILE
    : resolve(process.cwd(), env["CAPTURE_CONTROL_SOURCE_FILE"]);
  const reportFile = env["CAPTURE_CONTROL_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["CAPTURE_CONTROL_REPORT_FILE"]);
  const writeReport = options.writeReport ?? defaultWriteReport;
  const reportFileExists = options.reportFileExists ?? existsSync;
  const payload = loadCaptureControlSourcePayload(payloadPath);
  const apiUrl = env["VENVIEWER_API_URL"] ?? DEFAULT_API_URL;
  const dryRun = envFlag(env, "VENVIEWER_CAPTURE_CONTROL_DRY_RUN");
  const bearerToken = dryRun ? env["VENVIEWER_ADMIN_BEARER_TOKEN"] ?? "" : requiredEnv(env, "VENVIEWER_ADMIN_BEARER_TOKEN");
  const allowRuntimePackageDrift = envFlag(env, "VENVIEWER_ALLOW_CAPTURE_CONTROL_RUNTIME_PACKAGE_DRIFT");
  const allowStaleReadback = envFlag(env, "VENVIEWER_ALLOW_STALE_CAPTURE_CONTROL_READBACK");
  const allowReportOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_CAPTURE_CONTROL_REPORT");
  assertReportFileCanBeWritten(reportFile, allowReportOverwrite, reportFileExists);
  const registerOptions: RegisterCaptureControlOptions = {
    apiUrl,
    bearerToken,
    payload,
    allowRuntimePackageDrift,
    allowStaleReadback,
    fetchImpl: options.fetchImpl,
  };

  if (dryRun) {
    const preflight = await preflightCaptureControlRegistration(registerOptions);
    writeReportIfRequested(
      reportFile,
      buildCaptureControlRegistrationReport({
        generatedAt: now().toISOString(),
        mode: "dry_run",
        apiUrl,
        payloadFile: payloadPath,
        payload,
        preflight,
        allowRuntimePackageDrift,
        allowStaleReadback,
      }),
      writeReport,
      allowReportOverwrite,
    );
    const latestRuntimePackageId = preflight.latestRuntimePackage?.id ?? "none";
    log(
      `Dry run only: validated capture-control payload ${payload.source.sourceId} for ${payload.venueSlug}/${payload.roomSlug}; no POST was sent.`,
    );
    log(
      `Runtime package preflight: payload ${preflight.payloadRuntimePackageId ?? "none"}; latest loadable ${latestRuntimePackageId}; drift override ${preflight.runtimePackageDriftAllowed ? "enabled" : "disabled"}.`,
    );
    return;
  }

  const verification = await registerAndVerifyCaptureControlSource({
    ...registerOptions,
  });
  const { registration, roomStatus } = verification;
  writeReportIfRequested(
    reportFile,
    buildCaptureControlRegistrationReport({
      generatedAt: now().toISOString(),
      mode: "registered",
      apiUrl,
      payloadFile: payloadPath,
      payload,
      preflight: verification.preflight,
      allowRuntimePackageDrift,
      allowStaleReadback,
      registration,
      roomStatus,
    }),
    writeReport,
    allowReportOverwrite,
  );
  const activeTriggers = roomStatus.latestCaptureControlActiveStalenessTriggers.length === 0
    ? "none"
    : roomStatus.latestCaptureControlActiveStalenessTriggers.join(", ");

  log(
    `Registered capture-control source ${registration.sourceId} for ${registration.venueSlug}/${registration.roomSlug} with QA ${registration.qaStatus}.`,
  );
  log(
    `Verified readback through capture-control and room-status routes: freshness ${roomStatus.captureControlFreshnessStatus}; active stale triggers ${activeTriggers}.`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runRegisterCaptureControlSource().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

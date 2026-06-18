import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  RegisterRuntimeQaRecordInputSchema,
  RuntimePackageSchema,
  RuntimeQaRecordRegistrationReportInspectionSchema,
  RuntimeQaRecordRegistrationReportSchema,
  RuntimeQaRecordRegistrationSchema,
  RuntimeTransformArtifactSchema,
  runtimeQaRecordSignedTransformArtifactId,
  type RegisterRuntimeQaRecordInput,
  type RuntimePackage,
  type RuntimeQaRecordRegistration,
  type RuntimeQaRecordRegistrationReportInspection,
  type RuntimeQaRecordRegistrationReport,
  type RuntimeTransformArtifact,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// register-runtime-qa-record
//
// Registers a schema-validated runtime QA record through the admin asset API.
// There is intentionally no default payload file: operators must provide a
// reviewed QA payload explicitly.
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "http://localhost:3001";

export type RuntimeQaFetch = (
  input: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Response | Promise<Response>;

interface RegisterRuntimeQaOptions {
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly payload: RegisterRuntimeQaRecordInput;
  readonly allowRuntimePackageDrift?: boolean;
  readonly allowPublicExposure?: boolean;
  readonly fetchImpl?: RuntimeQaFetch;
}

export interface RuntimeQaPreflightResult {
  readonly payloadRuntimePackageId: string;
  readonly latestRuntimePackage: RuntimePackage | null;
  readonly runtimePackageDriftAllowed: boolean;
  readonly signedTransformArtifactId: string | null;
  readonly signedTransformArtifact: RuntimeTransformArtifact | null;
}

export interface RuntimeQaRecordRegistrationVerification {
  readonly preflight: RuntimeQaPreflightResult;
  readonly registration: RuntimeQaRecordRegistration;
  readonly persistedRecord: RuntimeQaRecordRegistration;
}

interface RunRegisterRuntimeQaRecordOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: RuntimeQaFetch;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly inspectionFileExists?: (filePath: string) => boolean;
  readonly readReport?: (filePath: string) => unknown;
  readonly writeReport?: (
    filePath: string,
    report: RuntimeQaRecordRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void;
  readonly writeInspection?: (
    filePath: string,
    inspection: RuntimeQaRecordRegistrationReportInspection,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

const RuntimeQaRecordListResponseSchema = z.object({
  data: z.array(RuntimeQaRecordRegistrationSchema),
}).strict();

const RuntimeTransformArtifactListResponseSchema = z.object({
  data: z.array(RuntimeTransformArtifactSchema),
}).strict();

const LatestRuntimePackageResponseSchema = z.object({
  data: RuntimePackageSchema.nullable(),
}).strict();

export function runtimeQaRecordEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/register-runtime-qa-record`;
}

export function runtimeQaRecordsEndpoint(apiUrl: string, runtimePackageId: string): string {
  const params = new URLSearchParams({ runtimePackageId });
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/runtime-qa-records?${params.toString()}`;
}

export function runtimeTransformArtifactsEndpoint(apiUrl: string, runtimePackageId: string): string {
  const params = new URLSearchParams({ runtimePackageId });
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/runtime-transform-artifacts?${params.toString()}`;
}

export function latestRuntimePackageEndpoint(
  apiUrl: string,
  payload: RegisterRuntimeQaRecordInput,
): string {
  const params = new URLSearchParams({
    venue: payload.venueSlug,
    room: payload.roomSlug,
  });
  return `${apiUrl.replace(/\/+$/u, "")}/assets/runtime-packages/latest?${params.toString()}`;
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

export function loadRuntimeQaRecordPayload(filePath: string): RegisterRuntimeQaRecordInput {
  const parsed = loadJsonFile(filePath);
  const result = RegisterRuntimeQaRecordInputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = formatValidationIssues(result.error.issues);
    throw new Error(`Validation failed for ${filePath}:\n  ${issues}`);
  }
  return result.data;
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

function envFlag(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return env[name] === "true";
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function defaultWriteReport(
  filePath: string,
  report: RuntimeQaRecordRegistrationReport,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function defaultWriteInspection(
  filePath: string,
  inspection: RuntimeQaRecordRegistrationReportInspection,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(inspection, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function envelopeData(body: unknown): unknown {
  return body !== null && typeof body === "object" && "data" in body
    ? (body as { readonly data: unknown }).data
    : body;
}

async function fetchJson(
  fetchImpl: RuntimeQaFetch,
  input: string,
  init: Parameters<RuntimeQaFetch>[1],
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

function assertPublicExposureAllowed(
  payload: RegisterRuntimeQaRecordInput,
  allowPublicExposure: boolean,
): void {
  if (payload.record.publicExposure.decision !== "approved_public") return;
  if (allowPublicExposure) return;
  throw new Error(
    "Runtime QA record requests approved_public exposure. Refusing without VENVIEWER_ALLOW_RUNTIME_QA_PUBLIC_EXPOSURE=true.",
  );
}

export async function readLatestRuntimePackage(
  options: RegisterRuntimeQaOptions,
): Promise<RuntimePackage | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, latestRuntimePackageEndpoint(options.apiUrl, options.payload), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Latest runtime package preflight");

  return LatestRuntimePackageResponseSchema.parse(body).data;
}

export async function readRegisteredRuntimeTransformArtifacts(
  options: RegisterRuntimeQaOptions,
): Promise<readonly RuntimeTransformArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(
    fetchImpl,
    runtimeTransformArtifactsEndpoint(options.apiUrl, options.payload.runtimePackageId),
    {
      method: "GET",
      headers: authHeaders(options.bearerToken),
    },
    "Runtime QA signed transform artifact preflight",
  );

  return RuntimeTransformArtifactListResponseSchema.parse(body).data;
}

export async function preflightRuntimeQaRecordRegistration(
  options: RegisterRuntimeQaOptions,
): Promise<RuntimeQaPreflightResult> {
  assertPublicExposureAllowed(options.payload, options.allowPublicExposure === true);
  const latestPackage = await readLatestRuntimePackage(options);
  const allowDrift = options.allowRuntimePackageDrift === true;
  if (latestPackage === null && !allowDrift) {
    throw new Error(
      `Latest runtime package preflight returned no loadable package for ${options.payload.venueSlug}/${options.payload.roomSlug}. Refusing to register runtime QA before POST.`,
    );
  }
  if (latestPackage !== null && latestPackage.id !== options.payload.runtimePackageId && !allowDrift) {
    throw new Error(
      `Runtime QA payload targets runtime package ${options.payload.runtimePackageId}, but latest loadable runtime package is ${latestPackage.id}. Refusing to register drifted runtime QA before POST without VENVIEWER_ALLOW_RUNTIME_QA_PACKAGE_DRIFT=true.`,
    );
  }

  const signedTransformArtifactId = runtimeQaRecordSignedTransformArtifactId(options.payload.record);
  const signedTransformArtifact = signedTransformArtifactId === null
    ? null
    : (await readRegisteredRuntimeTransformArtifacts(options)).find((artifact) =>
      artifact.runtimePackageId === options.payload.runtimePackageId &&
      artifact.venueSlug === options.payload.venueSlug &&
      artifact.roomSlug === options.payload.roomSlug &&
      artifact.transformArtifactId === signedTransformArtifactId,
    ) ?? null;
  if (signedTransformArtifactId !== null && signedTransformArtifact === null) {
    throw new Error(
      `Runtime QA signed transform artifact ${signedTransformArtifactId} is not registered for ${options.payload.venueSlug}/${options.payload.roomSlug} package ${options.payload.runtimePackageId}.`,
    );
  }

  return {
    payloadRuntimePackageId: options.payload.runtimePackageId,
    latestRuntimePackage: latestPackage,
    runtimePackageDriftAllowed: allowDrift,
    signedTransformArtifactId,
    signedTransformArtifact,
  };
}

export async function registerRuntimeQaRecord(
  options: RegisterRuntimeQaOptions,
): Promise<RuntimeQaRecordRegistration> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, runtimeQaRecordEndpoint(options.apiUrl), {
    method: "POST",
    headers: jsonAuthHeaders(options.bearerToken),
    body: JSON.stringify(options.payload),
  }, "Runtime QA record registration");

  return RuntimeQaRecordRegistrationSchema.parse(envelopeData(body));
}

export async function readRegisteredRuntimeQaRecords(
  options: RegisterRuntimeQaOptions,
): Promise<readonly RuntimeQaRecordRegistration[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, runtimeQaRecordsEndpoint(options.apiUrl, options.payload.runtimePackageId), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Runtime QA record readback");

  return RuntimeQaRecordListResponseSchema.parse(body).data;
}

function sameRuntimeQaRecord(
  left: RuntimeQaRecordRegistration,
  right: RuntimeQaRecordRegistration,
): boolean {
  return left.id === right.id &&
    left.runtimePackageId === right.runtimePackageId &&
    left.venueSlug === right.venueSlug &&
    left.roomSlug === right.roomSlug &&
    left.recordId === right.recordId &&
    left.signedTransformArtifactId === right.signedTransformArtifactId &&
    left.publicExposureDecision === right.publicExposureDecision;
}

export async function registerAndVerifyRuntimeQaRecord(
  options: RegisterRuntimeQaOptions,
): Promise<RuntimeQaRecordRegistrationVerification> {
  const preflight = await preflightRuntimeQaRecordRegistration(options);
  const registration = await registerRuntimeQaRecord(options);
  const persistedRecords = await readRegisteredRuntimeQaRecords(options);
  const persistedRecord = persistedRecords.find((record) => sameRuntimeQaRecord(record, registration));
  if (persistedRecord === undefined) {
    throw new Error(
      `Runtime QA readback did not include persisted row ${registration.id} (${registration.recordId}) for ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }

  return { preflight, registration, persistedRecord };
}

function buildRuntimeQaRecordRegistrationReport(
  params: {
    readonly generatedAt: string;
    readonly mode: RuntimeQaRecordRegistrationReport["mode"];
    readonly apiUrl: string;
    readonly payloadFile: string;
    readonly payload: RegisterRuntimeQaRecordInput;
    readonly preflight: RuntimeQaPreflightResult;
    readonly allowRuntimePackageDrift: boolean;
    readonly allowPublicExposure: boolean;
    readonly registration?: RuntimeQaRecordRegistration;
  },
): RuntimeQaRecordRegistrationReport {
  const latestRuntimePackageId = params.preflight.latestRuntimePackage?.id ?? null;
  const runtimePackageMatchesLatest = latestRuntimePackageId !== null &&
    latestRuntimePackageId === params.preflight.payloadRuntimePackageId;
  return RuntimeQaRecordRegistrationReportSchema.parse({
    schemaVersion: "venviewer.runtime-qa-registration-report.v0",
    generatedAt: params.generatedAt,
    mode: params.mode,
    apiUrl: params.apiUrl,
    payloadFile: params.payloadFile,
    payload: {
      venueSlug: params.payload.venueSlug,
      roomSlug: params.payload.roomSlug,
      runtimePackageId: params.payload.runtimePackageId,
      recordId: params.payload.record.recordId,
      assetEvidenceStatus: params.payload.record.assetEvidenceStatus,
      runtimeStatus: params.payload.record.runtimeStatus,
      transformPosture: params.payload.record.viewTransform.posture,
      signedTransformArtifactId: runtimeQaRecordSignedTransformArtifactId(params.payload.record),
      publicExposureDecision: params.payload.record.publicExposure.decision,
    },
    preflight: {
      payloadRuntimePackageId: params.preflight.payloadRuntimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus: params.preflight.latestRuntimePackage?.runtimeStatus ?? null,
      latestRuntimePackageEvidenceStatus: params.preflight.latestRuntimePackage?.evidenceStatus ?? null,
      runtimePackageMatchesLatest,
      runtimePackageDriftAllowed: params.preflight.runtimePackageDriftAllowed,
      signedTransformRequired: params.preflight.signedTransformArtifactId !== null,
      signedTransformRegistered: params.preflight.signedTransformArtifactId === null
        ? null
        : params.preflight.signedTransformArtifact !== null,
    },
    registration: params.registration === undefined
      ? null
      : {
        runtimeQaRecordRowId: params.registration.id,
        recordId: params.registration.recordId,
        signedTransformArtifactId: params.registration.signedTransformArtifactId,
        publicExposureDecision: params.registration.publicExposureDecision,
        reviewedBy: params.registration.reviewedBy,
        createdAt: params.registration.createdAt,
        updatedAt: params.registration.updatedAt,
      },
    guardrails: {
      runtimePackageDriftAllowed: params.allowRuntimePackageDrift,
      publicExposureAllowed: params.allowPublicExposure,
      publicExposureChanged: params.payload.record.publicExposure.decision === "approved_public",
    },
  });
}

export function inspectRuntimeQaRecordRegistrationReport(
  rawReport: unknown,
  params: {
    readonly generatedAt: string;
    readonly inspectedReportFile: string;
  },
): RuntimeQaRecordRegistrationReportInspection {
  const parsed = RuntimeQaRecordRegistrationReportSchema.safeParse(rawReport);
  if (!parsed.success) {
    return RuntimeQaRecordRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: null,
      status: "invalid_report",
      liveQaRegistrationReady: false,
      mode: null,
      venueSlug: null,
      roomSlug: null,
      recordId: null,
      publicExposureDecision: null,
      reportRuntimePackageId: null,
      reportLatestRuntimePackageId: null,
      reportRuntimePackageMatchesLatest: null,
      reportRuntimePackageDriftAllowed: null,
      reportSignedTransformRequired: null,
      reportSignedTransformRegistered: null,
      reportPublicExposureAllowed: null,
      reportPublicExposureChanged: null,
      blockers: parsed.error.issues.map((issue) => {
        const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
        return `${path}: ${issue.message}`;
      }),
      messages: ["Report failed RuntimeQaRecordRegistrationReportSchema validation."],
    });
  }

  const report = parsed.data;
  const messages: string[] = [
    `Report schema is valid for ${report.payload.recordId} in ${report.payload.venueSlug}/${report.payload.roomSlug}.`,
    `Report public exposure decision is ${report.payload.publicExposureDecision}.`,
  ];
  if (report.preflight.signedTransformRequired) {
    messages.push(
      `Report cites registered signed transform ${report.payload.signedTransformArtifactId ?? "unknown"}.`,
    );
  } else {
    messages.push("Report does not cite a signed transform artifact.");
  }
  if (report.guardrails.publicExposureChanged) {
    messages.push(
      "Report records explicit public exposure approval; live run still requires VENVIEWER_ALLOW_RUNTIME_QA_PUBLIC_EXPOSURE=true.",
    );
  } else {
    messages.push("Report records no public exposure approval change.");
  }

  if (report.mode === "registered") {
    return RuntimeQaRecordRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: report.generatedAt,
      status: "registered_qa_report_verified",
      liveQaRegistrationReady: false,
      mode: report.mode,
      venueSlug: report.payload.venueSlug,
      roomSlug: report.payload.roomSlug,
      recordId: report.payload.recordId,
      publicExposureDecision: report.payload.publicExposureDecision,
      reportRuntimePackageId: report.payload.runtimePackageId,
      reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
      reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
      reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
      reportSignedTransformRequired: report.preflight.signedTransformRequired,
      reportSignedTransformRegistered: report.preflight.signedTransformRegistered,
      reportPublicExposureAllowed: report.guardrails.publicExposureAllowed,
      reportPublicExposureChanged: report.guardrails.publicExposureChanged,
      blockers: [
        "Report already records a live runtime QA registration; use it as audit evidence, not authorization for another POST.",
      ],
      messages,
    });
  }

  const blockers: string[] = [];
  if (report.preflight.latestRuntimePackageId === null) {
    blockers.push("Dry-run preflight did not resolve a latest loadable runtime package.");
  }
  if (!report.preflight.runtimePackageMatchesLatest) {
    blockers.push("Payload runtime package is not the latest loadable runtime package.");
  }
  if (report.preflight.runtimePackageDriftAllowed || report.guardrails.runtimePackageDriftAllowed) {
    blockers.push("Runtime-package drift override was enabled; rerun a normal dry-run before live registration.");
  }
  if (
    report.preflight.signedTransformRequired &&
    report.preflight.signedTransformRegistered !== true
  ) {
    blockers.push("Signed-transform QA report did not verify the cited transform artifact registration.");
  }
  if (
    report.payload.publicExposureDecision === "approved_public" &&
    !report.guardrails.publicExposureAllowed
  ) {
    blockers.push("Approved-public QA report does not record the public-exposure override.");
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
    messages.push("Dry-run report is current for live runtime QA registration preflight.");
  }

  return RuntimeQaRecordRegistrationReportInspectionSchema.parse({
    schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
    generatedAt: params.generatedAt,
    inspectedReportFile: params.inspectedReportFile,
    inspectedReportGeneratedAt: report.generatedAt,
    status: blockers.length === 0
      ? "ready_for_live_qa_registration"
      : "not_ready_for_live_qa_registration",
    liveQaRegistrationReady: blockers.length === 0,
    mode: report.mode,
    venueSlug: report.payload.venueSlug,
    roomSlug: report.payload.roomSlug,
    recordId: report.payload.recordId,
    publicExposureDecision: report.payload.publicExposureDecision,
    reportRuntimePackageId: report.payload.runtimePackageId,
    reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
    reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
    reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
    reportSignedTransformRequired: report.preflight.signedTransformRequired,
    reportSignedTransformRegistered: report.preflight.signedTransformRegistered,
    reportPublicExposureAllowed: report.guardrails.publicExposureAllowed,
    reportPublicExposureChanged: report.guardrails.publicExposureChanged,
    blockers,
    messages,
  });
}

export function formatRuntimeQaRecordRegistrationReportInspection(
  inspection: RuntimeQaRecordRegistrationReportInspection,
): readonly string[] {
  const target = inspection.recordId === null ||
    inspection.venueSlug === null ||
    inspection.roomSlug === null
    ? "unknown runtime QA report"
    : `${inspection.recordId} for ${inspection.venueSlug}/${inspection.roomSlug}`;
  return [
    `Runtime QA report inspection: ${inspection.status}.`,
    `Target: ${target}.`,
    ...inspection.messages.map((message) => `Check: ${message}`),
    ...inspection.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

function writeReportIfRequested(
  reportFile: string | null,
  report: RuntimeQaRecordRegistrationReport,
  writer: (
    filePath: string,
    report: RuntimeQaRecordRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void,
  allowOverwrite: boolean,
): void {
  if (reportFile === null) return;
  writer(reportFile, report, { allowOverwrite });
}

function writeInspectionIfRequested(
  inspectionFile: string | null,
  inspection: RuntimeQaRecordRegistrationReportInspection,
  writer: (
    filePath: string,
    inspection: RuntimeQaRecordRegistrationReportInspection,
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
    `Runtime QA report file already exists at ${reportFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_QA_REPORT=true.`,
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
    `Runtime QA inspection file already exists at ${inspectionFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_QA_INSPECTION=true.`,
  );
}

export async function runRegisterRuntimeQaRecord(
  options: RunRegisterRuntimeQaRecordOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const inspectReportPath = env["RUNTIME_QA_INSPECT_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_QA_INSPECT_REPORT_FILE"]);
  const inspectionFile = env["RUNTIME_QA_INSPECTION_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_QA_INSPECTION_FILE"]);
  if (inspectReportPath === null && inspectionFile !== null) {
    throw new Error("RUNTIME_QA_INSPECTION_FILE requires RUNTIME_QA_INSPECT_REPORT_FILE.");
  }
  if (inspectReportPath !== null) {
    const readReport = options.readReport ?? loadJsonFile;
    const writeInspection = options.writeInspection ?? defaultWriteInspection;
    const inspectionFileExists = options.inspectionFileExists ?? existsSync;
    const allowInspectionOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_QA_INSPECTION");
    assertInspectionFileCanBeWritten(inspectionFile, allowInspectionOverwrite, inspectionFileExists);
    const inspection = inspectRuntimeQaRecordRegistrationReport(readReport(inspectReportPath), {
      generatedAt: now().toISOString(),
      inspectedReportFile: inspectReportPath,
    });
    writeInspectionIfRequested(
      inspectionFile,
      inspection,
      writeInspection,
      allowInspectionOverwrite,
    );
    for (const line of formatRuntimeQaRecordRegistrationReportInspection(inspection)) {
      log(line);
    }
    if (!inspection.liveQaRegistrationReady) {
      const blockers = inspection.blockers.length === 0
        ? "no readiness blockers were reported"
        : inspection.blockers.join("; ");
      throw new Error(
        `Runtime QA report ${inspectReportPath} is not ready for live registration: ${blockers}`,
      );
    }
    return;
  }
  const payloadPath = resolve(process.cwd(), requiredEnv(env, "RUNTIME_QA_RECORD_FILE"));
  const reportFile = env["RUNTIME_QA_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_QA_REPORT_FILE"]);
  const writeReport = options.writeReport ?? defaultWriteReport;
  const reportFileExists = options.reportFileExists ?? existsSync;
  const payload = loadRuntimeQaRecordPayload(payloadPath);
  const apiUrl = env["VENVIEWER_API_URL"] ?? DEFAULT_API_URL;
  const dryRun = envFlag(env, "VENVIEWER_RUNTIME_QA_DRY_RUN");
  const signedTransformArtifactId = runtimeQaRecordSignedTransformArtifactId(payload.record);
  const dryRunNeedsAdminToken = signedTransformArtifactId !== null;
  const bearerToken = dryRun
    ? dryRunNeedsAdminToken ? requiredEnv(env, "VENVIEWER_ADMIN_BEARER_TOKEN") : env["VENVIEWER_ADMIN_BEARER_TOKEN"] ?? ""
    : requiredEnv(env, "VENVIEWER_ADMIN_BEARER_TOKEN");
  const allowRuntimePackageDrift = envFlag(env, "VENVIEWER_ALLOW_RUNTIME_QA_PACKAGE_DRIFT");
  const allowPublicExposure = envFlag(env, "VENVIEWER_ALLOW_RUNTIME_QA_PUBLIC_EXPOSURE");
  const allowReportOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_QA_REPORT");
  assertReportFileCanBeWritten(reportFile, allowReportOverwrite, reportFileExists);
  const registerOptions: RegisterRuntimeQaOptions = {
    apiUrl,
    bearerToken,
    payload,
    allowRuntimePackageDrift,
    allowPublicExposure,
    fetchImpl: options.fetchImpl,
  };

  if (dryRun) {
    const preflight = await preflightRuntimeQaRecordRegistration(registerOptions);
    writeReportIfRequested(
      reportFile,
      buildRuntimeQaRecordRegistrationReport({
        generatedAt: now().toISOString(),
        mode: "dry_run",
        apiUrl,
        payloadFile: payloadPath,
        payload,
        preflight,
        allowRuntimePackageDrift,
        allowPublicExposure,
      }),
      writeReport,
      allowReportOverwrite,
    );
    log(
      `Dry run only: validated runtime QA record ${payload.record.recordId} for ${payload.venueSlug}/${payload.roomSlug}; no POST was sent.`,
    );
    log(
      `Runtime package preflight: payload ${preflight.payloadRuntimePackageId}; latest loadable ${preflight.latestRuntimePackage?.id ?? "none"}; signed transform ${preflight.signedTransformArtifactId ?? "none"}; public exposure ${payload.record.publicExposure.decision}.`,
    );
    return;
  }

  const verification = await registerAndVerifyRuntimeQaRecord(registerOptions);
  writeReportIfRequested(
    reportFile,
    buildRuntimeQaRecordRegistrationReport({
      generatedAt: now().toISOString(),
      mode: "registered",
      apiUrl,
      payloadFile: payloadPath,
      payload,
      preflight: verification.preflight,
      allowRuntimePackageDrift,
      allowPublicExposure,
      registration: verification.registration,
    }),
    writeReport,
    allowReportOverwrite,
  );
  log(
    `Registered runtime QA record ${verification.registration.recordId} for ${verification.registration.venueSlug}/${verification.registration.roomSlug}.`,
  );
  log(
    `Verified readback through runtime-qa-records route: public exposure ${verification.persistedRecord.publicExposureDecision}; signed transform ${verification.persistedRecord.signedTransformArtifactId ?? "none"}.`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runRegisterRuntimeQaRecord().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

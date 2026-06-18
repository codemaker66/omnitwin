import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  RegisterRuntimeTransformArtifactInputSchema,
  RuntimePackageSchema,
  RuntimeTransformArtifactRegistrationReportInspectionSchema,
  RuntimeTransformArtifactRegistrationReportSchema,
  RuntimeTransformArtifactSchema,
  type RuntimeTransformArtifactRegistrationReportInspection,
  type RuntimeTransformArtifactRegistrationReport,
  type RegisterRuntimeTransformArtifactInput,
  type RuntimePackage,
  type RuntimeTransformArtifact,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// register-runtime-transform-artifact
//
// Registers a reviewed, schema-validated signed TransformArtifactV0 through the
// admin asset API. There is intentionally no default payload file: operators
// must provide a reviewed transform artifact explicitly.
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "http://localhost:3001";

export type RuntimeTransformFetch = (
  input: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Response | Promise<Response>;

interface RegisterRuntimeTransformOptions {
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly payload: RegisterRuntimeTransformArtifactInput;
  readonly allowRuntimePackageDrift?: boolean;
  readonly fetchImpl?: RuntimeTransformFetch;
}

export interface RuntimeTransformPreflightResult {
  readonly payloadRuntimePackageId: string;
  readonly latestRuntimePackage: RuntimePackage | null;
  readonly runtimePackageDriftAllowed: boolean;
}

export interface RuntimeTransformArtifactRegistrationVerification {
  readonly preflight: RuntimeTransformPreflightResult;
  readonly registration: RuntimeTransformArtifact;
  readonly persistedArtifact: RuntimeTransformArtifact;
}

interface RunRegisterRuntimeTransformArtifactOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: RuntimeTransformFetch;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readReport?: (filePath: string) => unknown;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly inspectionFileExists?: (filePath: string) => boolean;
  readonly writeReport?: (
    filePath: string,
    report: RuntimeTransformArtifactRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void;
  readonly writeInspection?: (
    filePath: string,
    inspection: RuntimeTransformArtifactRegistrationReportInspection,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

const RuntimeTransformArtifactListResponseSchema = z.object({
  data: z.array(RuntimeTransformArtifactSchema),
}).strict();

const LatestRuntimePackageResponseSchema = z.object({
  data: RuntimePackageSchema.nullable(),
}).strict();

export function runtimeTransformArtifactEndpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/register-runtime-transform-artifact`;
}

export function runtimeTransformArtifactsEndpoint(
  apiUrl: string,
  runtimePackageId: string,
): string {
  const params = new URLSearchParams({ runtimePackageId });
  return `${apiUrl.replace(/\/+$/u, "")}/admin/assets/runtime-transform-artifacts?${params.toString()}`;
}

export function latestRuntimePackageEndpoint(
  apiUrl: string,
  payload: RegisterRuntimeTransformArtifactInput,
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

export function loadRuntimeTransformArtifactPayload(
  filePath: string,
): RegisterRuntimeTransformArtifactInput {
  const parsed = loadJsonFile(filePath);

  const result = RegisterRuntimeTransformArtifactInputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = formatValidationIssues(result.error.issues);
    throw new Error(`Validation failed for ${filePath}:\n  ${issues}`);
  }
  return result.data;
}

export function loadRuntimeTransformArtifactRegistrationReport(
  filePath: string,
): RuntimeTransformArtifactRegistrationReport {
  const parsed = loadJsonFile(filePath);
  const result = RuntimeTransformArtifactRegistrationReportSchema.safeParse(parsed);
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

function defaultWriteReport(
  filePath: string,
  report: RuntimeTransformArtifactRegistrationReport,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function defaultWriteInspection(
  filePath: string,
  inspection: RuntimeTransformArtifactRegistrationReportInspection,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(inspection, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function envelopeData(body: unknown): unknown {
  return body !== null && typeof body === "object" && "data" in body
    ? (body as { readonly data: unknown }).data
    : body;
}

async function fetchJson(
  fetchImpl: RuntimeTransformFetch,
  input: string,
  init: Parameters<RuntimeTransformFetch>[1],
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

export async function readLatestRuntimePackage(
  options: RegisterRuntimeTransformOptions,
): Promise<RuntimePackage | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, latestRuntimePackageEndpoint(options.apiUrl, options.payload), {
    method: "GET",
    headers: authHeaders(options.bearerToken),
  }, "Latest runtime package preflight");

  return LatestRuntimePackageResponseSchema.parse(body).data;
}

export async function preflightRuntimeTransformArtifactRegistration(
  options: RegisterRuntimeTransformOptions,
): Promise<RuntimeTransformPreflightResult> {
  const latestPackage = await readLatestRuntimePackage(options);
  const allowDrift = options.allowRuntimePackageDrift === true;
  if (latestPackage === null && !allowDrift) {
    throw new Error(
      `Latest runtime package preflight returned no loadable package for ${options.payload.venueSlug}/${options.payload.roomSlug}. Refusing to register signed transform evidence before POST.`,
    );
  }
  if (latestPackage !== null && latestPackage.id !== options.payload.runtimePackageId && !allowDrift) {
    throw new Error(
      `Runtime transform payload targets runtime package ${options.payload.runtimePackageId}, but latest loadable runtime package is ${latestPackage.id}. Refusing to register drifted signed transform evidence before POST without VENVIEWER_ALLOW_RUNTIME_TRANSFORM_PACKAGE_DRIFT=true.`,
    );
  }

  return {
    payloadRuntimePackageId: options.payload.runtimePackageId,
    latestRuntimePackage: latestPackage,
    runtimePackageDriftAllowed: allowDrift,
  };
}

export async function registerRuntimeTransformArtifact(
  options: RegisterRuntimeTransformOptions,
): Promise<RuntimeTransformArtifact> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(fetchImpl, runtimeTransformArtifactEndpoint(options.apiUrl), {
    method: "POST",
    headers: jsonAuthHeaders(options.bearerToken),
    body: JSON.stringify(options.payload),
  }, "Runtime transform artifact registration");

  return RuntimeTransformArtifactSchema.parse(envelopeData(body));
}

export async function readRegisteredRuntimeTransformArtifacts(
  options: RegisterRuntimeTransformOptions,
): Promise<readonly RuntimeTransformArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = await fetchJson(
    fetchImpl,
    runtimeTransformArtifactsEndpoint(options.apiUrl, options.payload.runtimePackageId),
    {
      method: "GET",
      headers: authHeaders(options.bearerToken),
    },
    "Runtime transform artifact readback",
  );

  return RuntimeTransformArtifactListResponseSchema.parse(body).data;
}

function sameRuntimeTransformArtifact(
  left: RuntimeTransformArtifact,
  right: RuntimeTransformArtifact,
): boolean {
  return left.id === right.id &&
    left.runtimePackageId === right.runtimePackageId &&
    left.venueSlug === right.venueSlug &&
    left.roomSlug === right.roomSlug &&
    left.transformArtifactId === right.transformArtifactId &&
    left.transformArtifact.id === right.transformArtifact.id &&
    left.transformArtifact.alignmentMethod === right.transformArtifact.alignmentMethod;
}

export async function registerAndVerifyRuntimeTransformArtifact(
  options: RegisterRuntimeTransformOptions,
): Promise<RuntimeTransformArtifactRegistrationVerification> {
  const preflight = await preflightRuntimeTransformArtifactRegistration(options);
  const registration = await registerRuntimeTransformArtifact(options);
  const persistedArtifacts = await readRegisteredRuntimeTransformArtifacts(options);
  const persistedArtifact = persistedArtifacts.find((artifact) =>
    sameRuntimeTransformArtifact(artifact, registration),
  );
  if (persistedArtifact === undefined) {
    throw new Error(
      `Runtime transform artifact readback did not include persisted row ${registration.id} (${registration.transformArtifactId}) for ${registration.venueSlug}/${registration.roomSlug}.`,
    );
  }

  return { preflight, registration, persistedArtifact };
}

function buildRuntimeTransformArtifactRegistrationReport(
  params: {
    readonly generatedAt: string;
    readonly mode: RuntimeTransformArtifactRegistrationReport["mode"];
    readonly apiUrl: string;
    readonly payloadFile: string;
    readonly payload: RegisterRuntimeTransformArtifactInput;
    readonly preflight: RuntimeTransformPreflightResult;
    readonly allowRuntimePackageDrift: boolean;
    readonly registration?: RuntimeTransformArtifact;
  },
): RuntimeTransformArtifactRegistrationReport {
  const latestRuntimePackageId = params.preflight.latestRuntimePackage?.id ?? null;
  const runtimePackageMatchesLatest = latestRuntimePackageId !== null &&
    latestRuntimePackageId === params.preflight.payloadRuntimePackageId;
  const reviewerRole = params.payload.transformArtifact.reviewer.role;
  if (reviewerRole === undefined) {
    throw new Error("Transform artifact reviewer role is required after schema validation.");
  }

  return RuntimeTransformArtifactRegistrationReportSchema.parse({
    schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
    generatedAt: params.generatedAt,
    mode: params.mode,
    apiUrl: params.apiUrl,
    payloadFile: params.payloadFile,
    payload: {
      venueSlug: params.payload.venueSlug,
      roomSlug: params.payload.roomSlug,
      runtimePackageId: params.payload.runtimePackageId,
      transformArtifactId: params.payload.transformArtifact.id,
      sourceFrame: params.payload.transformArtifact.sourceFrame,
      targetFrame: params.payload.transformArtifact.targetFrame,
      alignmentMethod: params.payload.transformArtifact.alignmentMethod,
      provenanceState: params.payload.transformArtifact.provenance.state,
      residualRmseM: params.payload.transformArtifact.residualRmseM,
      landmarkCount: params.payload.transformArtifact.landmarks.length,
      reviewerId: params.payload.transformArtifact.reviewer.id,
      reviewerRole,
    },
    preflight: {
      payloadRuntimePackageId: params.preflight.payloadRuntimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus: params.preflight.latestRuntimePackage?.runtimeStatus ?? null,
      latestRuntimePackageEvidenceStatus: params.preflight.latestRuntimePackage?.evidenceStatus ?? null,
      runtimePackageMatchesLatest,
      runtimePackageDriftAllowed: params.preflight.runtimePackageDriftAllowed,
    },
    registration: params.registration === undefined
      ? null
      : {
        runtimeTransformArtifactRowId: params.registration.id,
        transformArtifactId: params.registration.transformArtifactId,
        registeredBy: params.registration.registeredBy,
        createdAt: params.registration.createdAt,
        updatedAt: params.registration.updatedAt,
      },
    guardrails: {
      runtimePackageDriftAllowed: params.allowRuntimePackageDrift,
      runtimeQaRecordChanged: false,
      captureControlSourceChanged: false,
      publicExposureChanged: false,
    },
  });
}

export function inspectRuntimeTransformArtifactRegistrationReport(
  rawReport: unknown,
  params: {
    readonly generatedAt: string;
    readonly inspectedReportFile: string;
  },
): RuntimeTransformArtifactRegistrationReportInspection {
  const parsed = RuntimeTransformArtifactRegistrationReportSchema.safeParse(rawReport);
  if (!parsed.success) {
    return RuntimeTransformArtifactRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.runtime-transform-artifact-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: null,
      status: "invalid_report",
      liveTransformRegistrationReady: false,
      mode: null,
      venueSlug: null,
      roomSlug: null,
      transformArtifactId: null,
      reportRuntimePackageId: null,
      reportLatestRuntimePackageId: null,
      reportRuntimePackageMatchesLatest: null,
      reportRuntimePackageDriftAllowed: null,
      blockers: parsed.error.issues.map((issue) => {
        const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
        return `${path}: ${issue.message}`;
      }),
      messages: ["Report failed RuntimeTransformArtifactRegistrationReportSchema validation."],
    });
  }

  const report = parsed.data;
  const messages: string[] = [
    `Report schema is valid for ${report.payload.transformArtifactId} in ${report.payload.venueSlug}/${report.payload.roomSlug}.`,
    "Report records no runtime QA record, capture-control source, or public exposure change.",
  ];

  if (report.mode === "registered") {
    return RuntimeTransformArtifactRegistrationReportInspectionSchema.parse({
      schemaVersion: "venviewer.runtime-transform-artifact-registration-report-inspection.v0",
      generatedAt: params.generatedAt,
      inspectedReportFile: params.inspectedReportFile,
      inspectedReportGeneratedAt: report.generatedAt,
      status: "registered_transform_report_verified",
      liveTransformRegistrationReady: false,
      mode: report.mode,
      venueSlug: report.payload.venueSlug,
      roomSlug: report.payload.roomSlug,
      transformArtifactId: report.payload.transformArtifactId,
      reportRuntimePackageId: report.payload.runtimePackageId,
      reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
      reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
      reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
      blockers: [
        "Report already records a live signed-transform registration; use it as audit evidence, not authorization for another POST.",
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
    messages.push("Dry-run report is current for live signed-transform registration preflight.");
  }

  return RuntimeTransformArtifactRegistrationReportInspectionSchema.parse({
    schemaVersion: "venviewer.runtime-transform-artifact-registration-report-inspection.v0",
    generatedAt: params.generatedAt,
    inspectedReportFile: params.inspectedReportFile,
    inspectedReportGeneratedAt: report.generatedAt,
    status: blockers.length === 0
      ? "ready_for_live_transform_registration"
      : "not_ready_for_live_transform_registration",
    liveTransformRegistrationReady: blockers.length === 0,
    mode: report.mode,
    venueSlug: report.payload.venueSlug,
    roomSlug: report.payload.roomSlug,
    transformArtifactId: report.payload.transformArtifactId,
    reportRuntimePackageId: report.payload.runtimePackageId,
    reportLatestRuntimePackageId: report.preflight.latestRuntimePackageId,
    reportRuntimePackageMatchesLatest: report.preflight.runtimePackageMatchesLatest,
    reportRuntimePackageDriftAllowed: report.preflight.runtimePackageDriftAllowed,
    blockers,
    messages,
  });
}

export function formatRuntimeTransformArtifactRegistrationReportInspection(
  inspection: RuntimeTransformArtifactRegistrationReportInspection,
): readonly string[] {
  const target = inspection.transformArtifactId === null ||
    inspection.venueSlug === null ||
    inspection.roomSlug === null
    ? "unknown runtime transform report"
    : `${inspection.transformArtifactId} for ${inspection.venueSlug}/${inspection.roomSlug}`;
  return [
    `Runtime transform report inspection: ${inspection.status}.`,
    `Target: ${target}.`,
    ...inspection.messages.map((message) => `Check: ${message}`),
    ...inspection.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

function writeReportIfRequested(
  reportFile: string | null,
  report: RuntimeTransformArtifactRegistrationReport,
  writer: (
    filePath: string,
    report: RuntimeTransformArtifactRegistrationReport,
    options: { readonly allowOverwrite: boolean },
  ) => void,
  allowOverwrite: boolean,
): void {
  if (reportFile === null) return;
  writer(reportFile, report, { allowOverwrite });
}

function writeInspectionIfRequested(
  inspectionFile: string | null,
  inspection: RuntimeTransformArtifactRegistrationReportInspection,
  writer: (
    filePath: string,
    inspection: RuntimeTransformArtifactRegistrationReportInspection,
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
    `Runtime transform report file already exists at ${reportFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_REPORT=true.`,
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
    `Runtime transform inspection file already exists at ${inspectionFile}. Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_INSPECTION=true.`,
  );
}

export async function runRegisterRuntimeTransformArtifact(
  options: RunRegisterRuntimeTransformArtifactOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const inspectReportPath = env["RUNTIME_TRANSFORM_INSPECT_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_TRANSFORM_INSPECT_REPORT_FILE"]);
  const inspectionFile = env["RUNTIME_TRANSFORM_INSPECTION_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_TRANSFORM_INSPECTION_FILE"]);
  if (inspectReportPath === null && inspectionFile !== null) {
    throw new Error("RUNTIME_TRANSFORM_INSPECTION_FILE requires RUNTIME_TRANSFORM_INSPECT_REPORT_FILE.");
  }
  if (inspectReportPath !== null) {
    const readReport = options.readReport ?? loadJsonFile;
    const writeInspection = options.writeInspection ?? defaultWriteInspection;
    const inspectionFileExists = options.inspectionFileExists ?? existsSync;
    const allowInspectionOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_INSPECTION");
    assertInspectionFileCanBeWritten(inspectionFile, allowInspectionOverwrite, inspectionFileExists);
    const inspection = inspectRuntimeTransformArtifactRegistrationReport(readReport(inspectReportPath), {
      generatedAt: now().toISOString(),
      inspectedReportFile: inspectReportPath,
    });
    writeInspectionIfRequested(
      inspectionFile,
      inspection,
      writeInspection,
      allowInspectionOverwrite,
    );
    for (const line of formatRuntimeTransformArtifactRegistrationReportInspection(inspection)) {
      log(line);
    }
    if (!inspection.liveTransformRegistrationReady) {
      const blockers = inspection.blockers.length === 0
        ? "no readiness blockers were reported"
        : inspection.blockers.join("; ");
      throw new Error(
        `Runtime transform report ${inspectReportPath} is not ready for live registration: ${blockers}`,
      );
    }
    return;
  }
  const payloadPath = resolve(process.cwd(), requiredEnv(env, "RUNTIME_TRANSFORM_ARTIFACT_FILE"));
  const reportFile = env["RUNTIME_TRANSFORM_REPORT_FILE"] === undefined
    ? null
    : resolve(process.cwd(), env["RUNTIME_TRANSFORM_REPORT_FILE"]);
  const writeReport = options.writeReport ?? defaultWriteReport;
  const reportFileExists = options.reportFileExists ?? existsSync;
  const payload = loadRuntimeTransformArtifactPayload(payloadPath);
  const apiUrl = env["VENVIEWER_API_URL"] ?? DEFAULT_API_URL;
  const dryRun = envFlag(env, "VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN");
  const bearerToken = dryRun ? env["VENVIEWER_ADMIN_BEARER_TOKEN"] ?? "" : requiredEnv(env, "VENVIEWER_ADMIN_BEARER_TOKEN");
  const allowRuntimePackageDrift = envFlag(env, "VENVIEWER_ALLOW_RUNTIME_TRANSFORM_PACKAGE_DRIFT");
  const allowReportOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_REPORT");
  assertReportFileCanBeWritten(reportFile, allowReportOverwrite, reportFileExists);
  const registerOptions: RegisterRuntimeTransformOptions = {
    apiUrl,
    bearerToken,
    payload,
    allowRuntimePackageDrift,
    fetchImpl: options.fetchImpl,
  };

  if (dryRun) {
    const preflight = await preflightRuntimeTransformArtifactRegistration(registerOptions);
    writeReportIfRequested(
      reportFile,
      buildRuntimeTransformArtifactRegistrationReport({
        generatedAt: now().toISOString(),
        mode: "dry_run",
        apiUrl,
        payloadFile: payloadPath,
        payload,
        preflight,
        allowRuntimePackageDrift,
      }),
      writeReport,
      allowReportOverwrite,
    );
    log(
      `Dry run only: validated signed transform artifact ${payload.transformArtifact.id} for ${payload.venueSlug}/${payload.roomSlug}; no POST was sent.`,
    );
    log(
      `Runtime package preflight: payload ${preflight.payloadRuntimePackageId}; latest loadable ${preflight.latestRuntimePackage?.id ?? "none"}; drift override ${preflight.runtimePackageDriftAllowed ? "enabled" : "disabled"}.`,
    );
    return;
  }

  const verification = await registerAndVerifyRuntimeTransformArtifact(registerOptions);
  writeReportIfRequested(
    reportFile,
    buildRuntimeTransformArtifactRegistrationReport({
      generatedAt: now().toISOString(),
      mode: "registered",
      apiUrl,
      payloadFile: payloadPath,
      payload,
      preflight: verification.preflight,
      allowRuntimePackageDrift,
      registration: verification.registration,
    }),
    writeReport,
    allowReportOverwrite,
  );
  log(
    `Registered signed transform artifact ${verification.registration.transformArtifactId} for ${verification.registration.venueSlug}/${verification.registration.roomSlug}.`,
  );
  log(
    `Verified readback through runtime-transform-artifacts route: persisted row ${verification.persistedArtifact.id}.`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runRegisterRuntimeTransformArtifact().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

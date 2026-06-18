import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlEvidencePacketV0Schema,
  buildRuntimeControlCaptureControlPayloadReport,
  type RegisterCaptureControlSourceRecordInput,
  type RuntimeControlCaptureControlPayloadBuildReportV0,
  type RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// build-capture-control-source-from-runtime-control
//
// Converts a reviewed RuntimeControlEvidencePacketV0 into the existing
// RegisterCaptureControlSourceRecordInput payload shape. If the packet is only
// visible-candidate intake, the command emits a not-ready report and writes no
// capture-control source payload.
// ---------------------------------------------------------------------------

const DEFAULT_PACKET_FILE_REF =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const DEFAULT_PACKET_FILE = fileURLToPath(
  new URL(
    "../../../../docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    import.meta.url,
  ),
);
const WORKSPACE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface RunBuildCaptureControlSourceFromRuntimeControlOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readPacket?: (filePath: string) => unknown;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly payloadFileExists?: (filePath: string) => boolean;
  readonly writeReport?: (
    filePath: string,
    report: RuntimeControlCaptureControlPayloadBuildReportV0,
    options: { readonly allowOverwrite: boolean },
  ) => void;
  readonly writePayload?: (
    filePath: string,
    payload: RegisterCaptureControlSourceRecordInput,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

function formatValidationIssues(issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[]): string {
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

export function loadRuntimeControlEvidencePacket(
  filePath = DEFAULT_PACKET_FILE,
): RuntimeControlEvidencePacketV0 {
  const parsed = loadJsonFile(filePath);
  const result = RuntimeControlEvidencePacketV0Schema.safeParse(parsed);
  if (!result.success) {
    const issues = formatValidationIssues(result.error.issues);
    throw new Error(`Validation failed for ${filePath}:\n  ${issues}`);
  }
  return result.data;
}

function writeJsonFile(
  filePath: string,
  value: unknown,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: options.allowOverwrite ? "w" : "wx",
  });
}

function envFlag(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
  return env[name] === "true";
}

function optionalResolvedPath(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) return null;
  return resolve(WORKSPACE_ROOT, value);
}

function normalizedRef(value: string): string {
  return value.replace(/\\/gu, "/");
}

function packetFileTarget(
  env: Readonly<Record<string, string | undefined>>,
): { readonly filePath: string; readonly packetRef: string } {
  const configured = env["RUNTIME_CONTROL_PACKET_FILE"];
  const packetRef = env["RUNTIME_CONTROL_PACKET_REF"];
  if (configured === undefined || configured.trim().length === 0) {
    return {
      filePath: DEFAULT_PACKET_FILE,
      packetRef: packetRef === undefined ? DEFAULT_PACKET_FILE_REF : normalizedRef(packetRef),
    };
  }

  return {
    filePath: resolve(WORKSPACE_ROOT, configured),
    packetRef: packetRef === undefined ? normalizedRef(configured) : normalizedRef(packetRef),
  };
}

function assertWritable(
  filePath: string | null,
  allowOverwrite: boolean,
  fileExists: (filePath: string) => boolean,
  description: string,
): void {
  if (filePath === null || allowOverwrite) return;
  if (!fileExists(filePath)) return;
  throw new Error(
    `${description} already exists at ${filePath}. Refusing to overwrite without the matching overwrite flag.`,
  );
}

export function formatRuntimeControlCaptureControlPayloadBuildReport(
  report: RuntimeControlCaptureControlPayloadBuildReportV0,
): readonly string[] {
  const payloadState = report.payload === null
    ? "no capture-control payload written"
    : `payload ${report.payload.source.sourceId}`;
  return [
    `Runtime-control payload build: ${report.status}.`,
    `Packet: ${report.packetId} for ${report.venueSlug}/${report.roomSlug}.`,
    `Result: ${payloadState}.`,
    ...report.messages.map((message) => `Check: ${message}`),
    ...report.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

export function runBuildCaptureControlSourceFromRuntimeControl(
  options: RunBuildCaptureControlSourceFromRuntimeControlOptions = {},
): RuntimeControlCaptureControlPayloadBuildReportV0 {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const { filePath: packetFile, packetRef } = packetFileTarget(env);
  const payloadFile = optionalResolvedPath(env, "CAPTURE_CONTROL_SOURCE_FILE");
  const reportFile = optionalResolvedPath(
    env,
    "RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE",
  );
  const allowReportOverwrite = envFlag(
    env,
    "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_BUILD_REPORT",
  );
  const allowPayloadOverwrite = envFlag(
    env,
    "VENVIEWER_OVERWRITE_CAPTURE_CONTROL_SOURCE_FILE",
  );

  assertWritable(
    reportFile,
    allowReportOverwrite,
    options.reportFileExists ?? existsSync,
    "Runtime-control capture-control build report",
  );
  assertWritable(
    payloadFile,
    allowPayloadOverwrite,
    options.payloadFileExists ?? existsSync,
    "Capture-control source payload",
  );

  const readPacket = options.readPacket ?? loadJsonFile;
  const packet = RuntimeControlEvidencePacketV0Schema.parse(readPacket(packetFile));
  const report = buildRuntimeControlCaptureControlPayloadReport(packet, {
    generatedAt: now().toISOString(),
    packetRef,
    payloadFile,
    sourceId: env["RUNTIME_CONTROL_CAPTURE_CONTROL_SOURCE_ID"],
    reviewerRole: env["RUNTIME_CONTROL_CAPTURE_CONTROL_REVIEWER_ROLE"],
    reviewNote: env["RUNTIME_CONTROL_CAPTURE_CONTROL_REVIEW_NOTE"],
  });

  if (reportFile !== null) {
    const writeReport = options.writeReport ?? writeJsonFile;
    writeReport(reportFile, report, { allowOverwrite: allowReportOverwrite });
  }

  if (report.payload !== null && payloadFile !== null) {
    const writePayload = options.writePayload ?? writeJsonFile;
    writePayload(payloadFile, report.payload, { allowOverwrite: allowPayloadOverwrite });
  }

  for (const line of formatRuntimeControlCaptureControlPayloadBuildReport(report)) {
    log(line);
  }

  return report;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    runBuildCaptureControlSourceFromRuntimeControl();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

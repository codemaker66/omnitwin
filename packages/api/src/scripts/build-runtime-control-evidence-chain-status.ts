import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlCaptureControlPayloadBuildReportV0Schema,
  RuntimeControlCoordinatePairIntakeInspectionV0Schema,
  RuntimeControlCoordinatePairIntakeRequestV0Schema,
  RuntimeControlCoordinatePairPacketBuildReportV0Schema,
  RuntimeControlEvidenceChainStatusV0Schema,
  RuntimeControlEvidencePacketV0Schema,
  RuntimeTransformReadinessV0Schema,
  buildRuntimeControlEvidenceChainStatus,
  type RuntimeControlEvidenceChainStatusV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// build-runtime-control-evidence-chain-status
//
// Summarizes the current Reception Room runtime-control chain from existing
// artifacts only. It does not create coordinate-pair intake, reviewed packets,
// capture-control sources, transform payloads, or operational geometry.
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const DEFAULT_SOURCE_PACKET_FILE_REF =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const DEFAULT_COORDINATE_PAIR_INTAKE_REQUEST_FILE_REF =
  "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json";
const DEFAULT_COORDINATE_PAIR_INTAKE_INSPECTION_FILE_REF =
  "docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json";
const DEFAULT_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE_REF =
  "docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json";
const DEFAULT_CAPTURE_CONTROL_BUILD_REPORT_FILE_REF =
  "docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json";
const DEFAULT_TRANSFORM_READINESS_FILE_REF =
  "docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json";

interface RuntimeControlArtifactTarget {
  readonly filePath: string;
  readonly ref: string;
}

interface RunBuildRuntimeControlEvidenceChainStatusOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readJson?: (filePath: string) => unknown;
  readonly statusFileExists?: (filePath: string) => boolean;
  readonly writeStatus?: (
    filePath: string,
    status: RuntimeControlEvidenceChainStatusV0,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

function loadJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${String(error)}`);
  }
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

function normalizedRef(value: string): string {
  return value.replace(/\\/gu, "/");
}

function resolvedOptionalPath(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) return null;
  return resolve(WORKSPACE_ROOT, value);
}

function artifactTarget(
  env: Readonly<Record<string, string | undefined>>,
  fileEnvName: string,
  refEnvName: string,
  defaultRef: string,
): RuntimeControlArtifactTarget {
  const configured = env[fileEnvName];
  const refOverride = env[refEnvName];
  if (configured === undefined || configured.trim().length === 0) {
    return {
      filePath: resolve(WORKSPACE_ROOT, defaultRef),
      ref: refOverride === undefined ? defaultRef : normalizedRef(refOverride),
    };
  }

  return {
    filePath: resolve(WORKSPACE_ROOT, configured),
    ref: refOverride === undefined ? normalizedRef(configured) : normalizedRef(refOverride),
  };
}

function assertWritable(
  filePath: string | null,
  allowOverwrite: boolean,
  fileExists: (filePath: string) => boolean,
): void {
  if (filePath === null || allowOverwrite) return;
  if (!fileExists(filePath)) return;
  throw new Error(
    `Runtime-control evidence chain status already exists at ${filePath}. Refusing to overwrite without VENVIEWER_OVERWRITE_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS=true.`,
  );
}

export function formatRuntimeControlEvidenceChainStatus(
  status: RuntimeControlEvidenceChainStatusV0,
): readonly string[] {
  return [
    `Runtime-control evidence chain status: ${status.chainStatus}.`,
    `Source packet: ${status.sourcePacketId} for ${status.venueSlug}/${status.roomSlug}.`,
    `Stages: request=${status.coordinatePairIntakeRequestStatus}, inspection=${status.coordinatePairIntakeInspectionStatus}, packetBuild=${status.coordinatePairPacketBuildStatus}, payloadBuild=${status.captureControlPayloadBuildStatus}, transformReadiness=${status.transformReadinessDisposition}.`,
    `Required coordinate pairs: ${String(status.requiredCoordinatePairCount)}; reviewed coordinate pairs: ${String(status.reviewedCoordinatePairCount)}.`,
    ...status.messages.map((message) => `Check: ${message}`),
    ...status.blockers.map((blocker) => `Blocker: ${blocker}`),
    ...status.nextActions.map((action) => `Next: ${action}`),
  ];
}

export function runBuildRuntimeControlEvidenceChainStatus(
  options: RunBuildRuntimeControlEvidenceChainStatusOptions = {},
): RuntimeControlEvidenceChainStatusV0 {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const readJson = options.readJson ?? loadJsonFile;
  const statusFile = resolvedOptionalPath(env, "RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS_FILE");
  const allowOverwrite = envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUS");

  assertWritable(statusFile, allowOverwrite, options.statusFileExists ?? existsSync);

  const sourcePacketTarget = artifactTarget(
    env,
    "RUNTIME_CONTROL_SOURCE_PACKET_FILE",
    "RUNTIME_CONTROL_SOURCE_PACKET_REF",
    DEFAULT_SOURCE_PACKET_FILE_REF,
  );
  const requestTarget = artifactTarget(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE",
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_REF",
    DEFAULT_COORDINATE_PAIR_INTAKE_REQUEST_FILE_REF,
  );
  const inspectionTarget = artifactTarget(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_FILE",
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_REF",
    DEFAULT_COORDINATE_PAIR_INTAKE_INSPECTION_FILE_REF,
  );
  const packetBuildTarget = artifactTarget(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE",
    "RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_REF",
    DEFAULT_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE_REF,
  );
  const payloadBuildTarget = artifactTarget(
    env,
    "RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_FILE",
    "RUNTIME_CONTROL_CAPTURE_CONTROL_BUILD_REPORT_REF",
    DEFAULT_CAPTURE_CONTROL_BUILD_REPORT_FILE_REF,
  );
  const readinessTarget = artifactTarget(
    env,
    "RUNTIME_TRANSFORM_READINESS_FILE",
    "RUNTIME_TRANSFORM_READINESS_REF",
    DEFAULT_TRANSFORM_READINESS_FILE_REF,
  );

  const sourcePacket = RuntimeControlEvidencePacketV0Schema.parse(
    readJson(sourcePacketTarget.filePath),
  );
  const request = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(
    readJson(requestTarget.filePath),
  );
  const inspection = RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse(
    readJson(inspectionTarget.filePath),
  );
  const packetReport = RuntimeControlCoordinatePairPacketBuildReportV0Schema.parse(
    readJson(packetBuildTarget.filePath),
  );
  const payloadReport = RuntimeControlCaptureControlPayloadBuildReportV0Schema.parse(
    readJson(payloadBuildTarget.filePath),
  );
  const readiness = RuntimeTransformReadinessV0Schema.parse(
    readJson(readinessTarget.filePath),
  );

  const status = buildRuntimeControlEvidenceChainStatus(
    sourcePacket,
    request,
    inspection,
    packetReport,
    payloadReport,
    readiness,
    {
      generatedAt: now().toISOString(),
      sourcePacketRef: sourcePacketTarget.ref,
      coordinatePairIntakeRequestRef: requestTarget.ref,
      coordinatePairIntakeInspectionRef: inspectionTarget.ref,
      coordinatePairPacketBuildReportRef: packetBuildTarget.ref,
      captureControlPayloadBuildReportRef: payloadBuildTarget.ref,
      transformReadinessRef: readinessTarget.ref,
    },
  );
  const typedStatus = RuntimeControlEvidenceChainStatusV0Schema.parse(status);

  if (statusFile !== null) {
    const writeStatus = options.writeStatus ?? writeJsonFile;
    writeStatus(statusFile, typedStatus, { allowOverwrite });
  }

  for (const line of formatRuntimeControlEvidenceChainStatus(typedStatus)) {
    log(line);
  }

  return typedStatus;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    runBuildRuntimeControlEvidenceChainStatus();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

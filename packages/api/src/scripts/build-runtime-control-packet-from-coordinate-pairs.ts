import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlCoordinatePairIntakeV0Schema,
  RuntimeControlEvidencePacketV0Schema,
  buildRuntimeControlCoordinatePairPacketReport,
  type RuntimeControlCoordinatePairIntakeV0,
  type RuntimeControlCoordinatePairPacketBuildReportV0,
  type RuntimeControlEvidencePacketV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// build-runtime-control-packet-from-coordinate-pairs
//
// Builds a reviewed RuntimeControlEvidencePacketV0 from the visible-candidate
// packet plus a separate reviewed coordinate-pair intake file. With no intake
// file, it writes a blocked report and no reviewed packet.
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE_PACKET_FILE_REF =
  "docs/operations/reception-room-landmark-control-intake-2026-06-16.json";
const DEFAULT_SOURCE_PACKET_FILE = fileURLToPath(
  new URL(
    "../../../../docs/operations/reception-room-landmark-control-intake-2026-06-16.json",
    import.meta.url,
  ),
);
const WORKSPACE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface RunBuildRuntimeControlPacketFromCoordinatePairsOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readSourcePacket?: (filePath: string) => unknown;
  readonly readCoordinatePairIntake?: (filePath: string) => unknown;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly reviewedPacketFileExists?: (filePath: string) => boolean;
  readonly writeReport?: (
    filePath: string,
    report: RuntimeControlCoordinatePairPacketBuildReportV0,
    options: { readonly allowOverwrite: boolean },
  ) => void;
  readonly writeReviewedPacket?: (
    filePath: string,
    packet: RuntimeControlEvidencePacketV0,
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

export function loadRuntimeControlSourcePacket(
  filePath = DEFAULT_SOURCE_PACKET_FILE,
): RuntimeControlEvidencePacketV0 {
  const result = RuntimeControlEvidencePacketV0Schema.safeParse(loadJsonFile(filePath));
  if (!result.success) {
    throw new Error(`Validation failed for ${filePath}:\n  ${formatValidationIssues(result.error.issues)}`);
  }
  return result.data;
}

export function loadRuntimeControlCoordinatePairIntake(
  filePath: string,
): RuntimeControlCoordinatePairIntakeV0 {
  const result = RuntimeControlCoordinatePairIntakeV0Schema.safeParse(loadJsonFile(filePath));
  if (!result.success) {
    throw new Error(`Validation failed for ${filePath}:\n  ${formatValidationIssues(result.error.issues)}`);
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

function resolvedOptionalPath(
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

function sourcePacketTarget(
  env: Readonly<Record<string, string | undefined>>,
): { readonly filePath: string; readonly sourcePacketRef: string } {
  const configured = env["RUNTIME_CONTROL_SOURCE_PACKET_FILE"];
  const sourcePacketRef = env["RUNTIME_CONTROL_SOURCE_PACKET_REF"];
  if (configured === undefined || configured.trim().length === 0) {
    return {
      filePath: DEFAULT_SOURCE_PACKET_FILE,
      sourcePacketRef: sourcePacketRef === undefined
        ? DEFAULT_SOURCE_PACKET_FILE_REF
        : normalizedRef(sourcePacketRef),
    };
  }

  return {
    filePath: resolve(WORKSPACE_ROOT, configured),
    sourcePacketRef: sourcePacketRef === undefined
      ? normalizedRef(configured)
      : normalizedRef(sourcePacketRef),
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

export function formatRuntimeControlCoordinatePairPacketBuildReport(
  report: RuntimeControlCoordinatePairPacketBuildReportV0,
): readonly string[] {
  const reviewedState = report.reviewedPacket === null
    ? "no reviewed runtime-control packet written"
    : `reviewed packet ${report.reviewedPacket.packetId}`;
  return [
    `Runtime-control coordinate-pair packet build: ${report.status}.`,
    `Source packet: ${report.sourcePacketId} for ${report.venueSlug}/${report.roomSlug}.`,
    `Result: ${reviewedState}.`,
    ...report.messages.map((message) => `Check: ${message}`),
    ...report.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

export function runBuildRuntimeControlPacketFromCoordinatePairs(
  options: RunBuildRuntimeControlPacketFromCoordinatePairsOptions = {},
): RuntimeControlCoordinatePairPacketBuildReportV0 {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const { filePath: sourcePacketFile, sourcePacketRef } = sourcePacketTarget(env);
  const intakeFile = resolvedOptionalPath(env, "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE");
  const intakeRef = env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REF"] === undefined
    ? env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE"] ?? null
    : env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REF"];
  const reviewedPacketFile = resolvedOptionalPath(env, "REVIEWED_RUNTIME_CONTROL_PACKET_FILE");
  const reportFile = resolvedOptionalPath(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_PACKET_BUILD_REPORT_FILE",
  );

  assertWritable(
    reportFile,
    envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_REPORT"),
    options.reportFileExists ?? existsSync,
    "Runtime-control coordinate-pair packet-build report",
  );
  assertWritable(
    reviewedPacketFile,
    envFlag(env, "VENVIEWER_OVERWRITE_REVIEWED_RUNTIME_CONTROL_PACKET"),
    options.reviewedPacketFileExists ?? existsSync,
    "Reviewed runtime-control packet",
  );

  const readSourcePacket = options.readSourcePacket ?? loadJsonFile;
  const sourcePacket = RuntimeControlEvidencePacketV0Schema.parse(
    readSourcePacket(sourcePacketFile),
  );
  const readIntake = options.readCoordinatePairIntake ?? loadJsonFile;
  const coordinatePairIntake = intakeFile === null
    ? null
    : RuntimeControlCoordinatePairIntakeV0Schema.parse(readIntake(intakeFile));
  const report = buildRuntimeControlCoordinatePairPacketReport(
    sourcePacket,
    coordinatePairIntake,
    {
      generatedAt: now().toISOString(),
      sourcePacketRef,
      coordinatePairIntakeRef: intakeRef === null ? null : normalizedRef(intakeRef),
      reviewedPacketFile,
      packetId: env["REVIEWED_RUNTIME_CONTROL_PACKET_ID"],
      recordedAt: env["REVIEWED_RUNTIME_CONTROL_RECORDED_AT"] ?? now().toISOString(),
      recordedBy: env["REVIEWED_RUNTIME_CONTROL_RECORDED_BY"] ?? "runtime-review-operator",
      targetTransformArtifactId: env["REVIEWED_RUNTIME_CONTROL_TARGET_TRANSFORM_ARTIFACT_ID"],
    },
  );

  if (reportFile !== null) {
    const writeReport = options.writeReport ?? writeJsonFile;
    writeReport(reportFile, report, {
      allowOverwrite: envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_REPORT"),
    });
  }
  if (report.reviewedPacket !== null && reviewedPacketFile !== null) {
    const writeReviewedPacket = options.writeReviewedPacket ?? writeJsonFile;
    writeReviewedPacket(reviewedPacketFile, report.reviewedPacket, {
      allowOverwrite: envFlag(env, "VENVIEWER_OVERWRITE_REVIEWED_RUNTIME_CONTROL_PACKET"),
    });
  }

  for (const line of formatRuntimeControlCoordinatePairPacketBuildReport(report)) {
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
    runBuildRuntimeControlPacketFromCoordinatePairs();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

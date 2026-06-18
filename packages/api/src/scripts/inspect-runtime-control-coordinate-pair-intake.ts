import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlCoordinatePairIntakeInspectionV0Schema,
  RuntimeControlCoordinatePairIntakeV0Schema,
  RuntimeControlEvidencePacketV0Schema,
  inspectRuntimeControlCoordinatePairIntake,
  type RuntimeControlCoordinatePairIntakeInspectionV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// inspect-runtime-control-coordinate-pair-intake
//
// Validates a reviewed coordinate-pair intake file against the current
// runtime-control packet. Missing, invalid, and incompatible intakes all become
// machine-readable reports; this command never builds reviewed packets or posts
// capture-control evidence.
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

interface RunInspectRuntimeControlCoordinatePairIntakeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readSourcePacket?: (filePath: string) => unknown;
  readonly readCoordinatePairIntake?: (filePath: string) => unknown;
  readonly reportFileExists?: (filePath: string) => boolean;
  readonly writeReport?: (
    filePath: string,
    report: RuntimeControlCoordinatePairIntakeInspectionV0,
    options: { readonly allowOverwrite: boolean },
  ) => void;
}

function formatValidationIssues(issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[]): readonly string[] {
  return issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
    return `${path}: ${issue.message}`;
  });
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
): void {
  if (filePath === null || allowOverwrite) return;
  if (!fileExists(filePath)) return;
  throw new Error(
    `Coordinate-pair intake inspection report already exists at ${filePath}. Refusing to overwrite without VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INSPECTION=true.`,
  );
}

export function formatRuntimeControlCoordinatePairIntakeInspection(
  inspection: RuntimeControlCoordinatePairIntakeInspectionV0,
): readonly string[] {
  return [
    `Runtime-control coordinate-pair intake inspection: ${inspection.status}.`,
    `Source packet: ${inspection.sourcePacketId} for ${inspection.venueSlug}/${inspection.roomSlug}.`,
    `Ready for reviewed packet build: ${inspection.readyForReviewedPacketBuild ? "yes" : "no"}.`,
    ...inspection.messages.map((message) => `Check: ${message}`),
    ...inspection.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

export function runInspectRuntimeControlCoordinatePairIntake(
  options: RunInspectRuntimeControlCoordinatePairIntakeOptions = {},
): RuntimeControlCoordinatePairIntakeInspectionV0 {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const { filePath: sourcePacketFile, sourcePacketRef } = sourcePacketTarget(env);
  const intakeFile = resolvedOptionalPath(env, "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE");
  const intakeRef = env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REF"] === undefined
    ? env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_FILE"] ?? null
    : env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REF"];
  const reportFile = resolvedOptionalPath(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_INSPECTION_FILE",
  );

  assertWritable(
    reportFile,
    envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INSPECTION"),
    options.reportFileExists ?? existsSync,
  );

  const readSourcePacket = options.readSourcePacket ?? loadJsonFile;
  const sourcePacket = RuntimeControlEvidencePacketV0Schema.parse(
    readSourcePacket(sourcePacketFile),
  );
  const readIntake = options.readCoordinatePairIntake ?? loadJsonFile;
  const rawIntake = intakeFile === null ? null : readIntake(intakeFile);
  const parsedIntake = rawIntake === null
    ? null
    : RuntimeControlCoordinatePairIntakeV0Schema.safeParse(rawIntake);
  const inspection = inspectRuntimeControlCoordinatePairIntake(
    sourcePacket,
    parsedIntake === null || !parsedIntake.success ? null : parsedIntake.data,
    {
      generatedAt: now().toISOString(),
      sourcePacketRef,
      coordinatePairIntakeRef: intakeRef === null ? null : normalizedRef(intakeRef),
      invalidIntakeBlockers: parsedIntake !== null && !parsedIntake.success
        ? formatValidationIssues(parsedIntake.error.issues)
        : undefined,
    },
  );
  const typedInspection = RuntimeControlCoordinatePairIntakeInspectionV0Schema.parse(inspection);

  if (reportFile !== null) {
    const writeReport = options.writeReport ?? writeJsonFile;
    writeReport(reportFile, typedInspection, {
      allowOverwrite: envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INSPECTION"),
    });
  }

  for (const line of formatRuntimeControlCoordinatePairIntakeInspection(typedInspection)) {
    log(line);
  }

  return typedInspection;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    runInspectRuntimeControlCoordinatePairIntake();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

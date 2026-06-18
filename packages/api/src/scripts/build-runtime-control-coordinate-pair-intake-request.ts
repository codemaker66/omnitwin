import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlCoordinatePairIntakeRequestV0Schema,
  RuntimeControlEvidencePacketV0Schema,
  buildRuntimeControlCoordinatePairIntakeRequest,
  type RuntimeControlCoordinatePairIntakeRequestV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// build-runtime-control-coordinate-pair-intake-request
//
// Emits the exact ARF/CVF landmark measurements an operator must collect before
// a reviewed coordinate-pair intake can exist. This command does not create
// coordinate values, reviewed packets, capture-control sources, or transforms.
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

interface RunBuildRuntimeControlCoordinatePairIntakeRequestOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly now?: () => Date;
  readonly readSourcePacket?: (filePath: string) => unknown;
  readonly requestFileExists?: (filePath: string) => boolean;
  readonly writeRequest?: (
    filePath: string,
    request: RuntimeControlCoordinatePairIntakeRequestV0,
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
    `Coordinate-pair intake request already exists at ${filePath}. Refusing to overwrite without VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST=true.`,
  );
}

export function formatRuntimeControlCoordinatePairIntakeRequest(
  request: RuntimeControlCoordinatePairIntakeRequestV0,
): readonly string[] {
  return [
    `Runtime-control coordinate-pair intake request: ${request.status}.`,
    `Source packet: ${request.sourcePacketId} for ${request.venueSlug}/${request.roomSlug}.`,
    `Required coordinate pairs: ${String(request.requiredCoordinatePairCount)}.`,
    ...request.landmarkRequests
      .filter((landmark) => landmark.required)
      .map((landmark) =>
        `Measure: ${landmark.landmarkId} (${landmark.label}) ${landmark.sourceFrame}->${landmark.targetFrame}.`,
      ),
    ...request.messages.map((message) => `Check: ${message}`),
    ...request.blockers.map((blocker) => `Blocker: ${blocker}`),
  ];
}

export function runBuildRuntimeControlCoordinatePairIntakeRequest(
  options: RunBuildRuntimeControlCoordinatePairIntakeRequestOptions = {},
): RuntimeControlCoordinatePairIntakeRequestV0 {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());
  const { filePath: sourcePacketFile, sourcePacketRef } = sourcePacketTarget(env);
  const requestFile = resolvedOptionalPath(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE",
  );

  assertWritable(
    requestFile,
    envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST"),
    options.requestFileExists ?? existsSync,
  );

  const readSourcePacket = options.readSourcePacket ?? loadJsonFile;
  const sourcePacket = RuntimeControlEvidencePacketV0Schema.parse(
    readSourcePacket(sourcePacketFile),
  );
  const request = buildRuntimeControlCoordinatePairIntakeRequest(sourcePacket, {
    generatedAt: now().toISOString(),
    sourcePacketRef,
  });
  const typedRequest = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(request);

  if (requestFile !== null) {
    const writeRequest = options.writeRequest ?? writeJsonFile;
    writeRequest(requestFile, typedRequest, {
      allowOverwrite: envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST"),
    });
  }

  for (const line of formatRuntimeControlCoordinatePairIntakeRequest(typedRequest)) {
    log(line);
  }

  return typedRequest;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    runBuildRuntimeControlCoordinatePairIntakeRequest();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

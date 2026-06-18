import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RuntimeControlCoordinatePairIntakeRequestV0Schema,
  type RuntimeControlCoordinatePairIntakeRequestV0,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// build-runtime-control-coordinate-pair-collection-pack
//
// Converts a typed coordinate-pair intake request into a human-readable
// collection checklist. It intentionally records no coordinate values and does
// not create reviewed intake, packets, capture-control sources, or transforms.
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST_FILE_REF =
  "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json";
const DEFAULT_REQUEST_FILE = fileURLToPath(
  new URL(
    "../../../../docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json",
    import.meta.url,
  ),
);
const WORKSPACE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface RunBuildRuntimeControlCoordinatePairCollectionPackOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
  readonly readRequest?: (filePath: string) => unknown;
  readonly packFileExists?: (filePath: string) => boolean;
  readonly writePack?: (
    filePath: string,
    markdown: string,
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

function writeMarkdownFile(
  filePath: string,
  markdown: string,
  options: { readonly allowOverwrite: boolean },
): void {
  writeFileSync(filePath, markdown, {
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

function requestTarget(
  env: Readonly<Record<string, string | undefined>>,
): { readonly filePath: string; readonly requestRef: string } {
  const configured = env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_FILE"];
  const requestRef = env["RUNTIME_CONTROL_COORDINATE_PAIR_INTAKE_REQUEST_REF"];
  if (configured === undefined || configured.trim().length === 0) {
    return {
      filePath: DEFAULT_REQUEST_FILE,
      requestRef: requestRef === undefined ? DEFAULT_REQUEST_FILE_REF : normalizedRef(requestRef),
    };
  }

  return {
    filePath: resolve(WORKSPACE_ROOT, configured),
    requestRef: requestRef === undefined ? normalizedRef(configured) : normalizedRef(requestRef),
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
    `Coordinate-pair collection pack already exists at ${filePath}. Refusing to overwrite without VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK=true.`,
  );
}

function escapedCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function requiredObservations(value: readonly string[]): string {
  return value.map((item) => item.replace(/_/gu, " ")).join(", ");
}

function evidenceRefs(
  refs: readonly RuntimeControlCoordinatePairIntakeRequestV0["landmarkRequests"][number]["evidenceRefs"][number][],
): string {
  return refs.map((ref) => `${ref.label}: ${ref.ref}`).join("; ");
}

function titleWord(word: string): string {
  return word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function titleFromSlug(slug: string): string {
  return slug.split("-").map(titleWord).join(" ");
}

function landmarkRows(request: RuntimeControlCoordinatePairIntakeRequestV0): readonly string[] {
  return request.landmarkRequests
    .filter((landmark) => landmark.required)
    .map((landmark) => {
      const cells = [
        escapedCell(landmark.landmarkId),
        escapedCell(landmark.label),
        escapedCell(landmark.featureClass.replace(/_/gu, " ")),
        `${landmark.sourceFrame} -> ${landmark.targetFrame}`,
        escapedCell(requiredObservations(landmark.requiredObservations)),
        escapedCell(evidenceRefs(landmark.evidenceRefs)),
        "",
        "",
        "",
        "",
        "",
      ];
      return `| ${cells.join(" | ")} |`;
    });
}

export function formatRuntimeControlCoordinatePairCollectionPack(
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  requestRef: string,
): string {
  const titleRoom = titleFromSlug(request.roomSlug);
  const lines = [
    `# ${titleRoom} coordinate-pair collection pack`,
    "",
    "Status: internal measurement collection checklist",
    "Task: T-453",
    `Source request: \`${requestRef}\``,
    "",
    "This pack tells an operator what to measure before a reviewed `runtime-control-coordinate-pair-intake.v0` file can exist. It records no coordinate values and does not create reviewed intake, a reviewed packet, a capture-control source, a signed transform, public exposure, or operational geometry.",
    "",
    "## Scope",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Venue | \`${request.venueSlug}\` |`,
    `| Room | \`${request.roomSlug}\` |`,
    `| Runtime package | \`${request.runtimePackageId}\` |`,
    `| Source packet | \`${request.sourcePacketId}\` |`,
    `| Source frame | \`${request.sourceFrame}\` |`,
    `| Target frame | \`${request.targetFrame}\` |`,
    `| Required coordinate pairs | ${String(request.requiredCoordinatePairCount)} |`,
    `| Request status | \`${request.status}\` |`,
    "",
    "## Measurement Rows",
    "",
    "| Landmark id | Label | Feature | Frames | Required observations | Visual evidence refs | ARF source coordinate | CVF target coordinate | Residual m | Reviewer role | Measurement evidence ref |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...landmarkRows(request),
    "",
    "## Acceptance Criteria",
    "",
    ...request.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## Claim Boundary",
    "",
    "- Use this pack to collect measurements only.",
    "- Convert the collected values into a separate `runtime-control-coordinate-pair-intake.v0` JSON file.",
    "- Run `assets:inspect-runtime-control-coordinate-pair-intake` before building any reviewed packet.",
    "- Do not edit the source packet or checked-in request artifact to add measurements.",
    "",
    "## Current Blockers",
    "",
    ...(request.blockers.length === 0
      ? ["- No request-level blocker; reviewed coordinate-pair measurements are still missing."]
      : request.blockers.map((blocker) => `- ${blocker}`)),
    "",
    "## Guardrails",
    "",
    "| Side effect | Created by this pack |",
    "| --- | --- |",
    "| Coordinate-pair intake | no |",
    "| Reviewed runtime-control packet | no |",
    "| Capture-control source | no |",
    "| Signed transform | no |",
    "| Public exposure change | no |",
    "| Operational geometry | no |",
    "",
  ];

  return lines.join("\n");
}

export function formatRuntimeControlCoordinatePairCollectionPackSummary(
  request: RuntimeControlCoordinatePairIntakeRequestV0,
  outputFile: string | null,
): readonly string[] {
  return [
    `Runtime-control coordinate-pair collection pack: ${request.status}.`,
    `Source packet: ${request.sourcePacketId} for ${request.venueSlug}/${request.roomSlug}.`,
    `Required coordinate pairs: ${String(request.requiredCoordinatePairCount)}.`,
    outputFile === null ? "No collection pack file requested." : `Collection pack: ${outputFile}.`,
    "No reviewed intake, reviewed packet, capture-control source, signed transform, public exposure change, or operational geometry was created.",
  ];
}

export function runBuildRuntimeControlCoordinatePairCollectionPack(
  options: RunBuildRuntimeControlCoordinatePairCollectionPackOptions = {},
): string {
  const env = options.env ?? process.env;
  // eslint-disable-next-line no-console
  const log = options.log ?? console.log;
  const { filePath: requestFile, requestRef } = requestTarget(env);
  const packFile = resolvedOptionalPath(
    env,
    "RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK_FILE",
  );

  assertWritable(
    packFile,
    envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK"),
    options.packFileExists ?? existsSync,
  );

  const readRequest = options.readRequest ?? loadJsonFile;
  const request = RuntimeControlCoordinatePairIntakeRequestV0Schema.parse(
    readRequest(requestFile),
  );
  const markdown = formatRuntimeControlCoordinatePairCollectionPack(request, requestRef);

  if (packFile !== null) {
    const writePack = options.writePack ?? writeMarkdownFile;
    writePack(packFile, markdown, {
      allowOverwrite: envFlag(env, "VENVIEWER_OVERWRITE_RUNTIME_CONTROL_COORDINATE_PAIR_COLLECTION_PACK"),
    });
  }

  for (const line of formatRuntimeControlCoordinatePairCollectionPackSummary(request, packFile)) {
    log(line);
  }

  return markdown;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    runBuildRuntimeControlCoordinatePairCollectionPack();
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

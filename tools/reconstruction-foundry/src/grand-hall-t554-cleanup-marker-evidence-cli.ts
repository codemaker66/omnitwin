import {
  GrandHallT554CleanupMarkerEvidenceError,
  checkGrandHallT554CleanupMarkerEvidencePack,
  generateGrandHallT554CleanupMarkerEvidencePack,
  type GenerateGrandHallT554CleanupMarkerEvidenceOptions,
} from "./grand-hall-t554-cleanup-marker-evidence.js";

export const GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_USAGE = [
  "Generate the additive authority-none T-554 cleanup-marker evidence v2 pack.",
  "",
  "Required:",
  "  --stage <absolute exact capture-stage root>",
  "  --source-boundary-evidence <absolute exact room-9 source-boundary evidence JSON>",
  "  --output <absolute absent output directory>",
  "",
  "Exact persisted check:",
  "  Add --check with the same three paths; --output must already contain the pack.",
  "",
  "This tool inventories source-explicit Mirror groups only; differing room keys do not",
  "prove physical exclusion or visual effect. Window metadata remains inconclusive.",
  "It does not remove faces, generate geometry, accept cleanup, or grant",
  "architectural, training, reconstruction, runtime, staging, deployment, or public authority.",
].join("\n");

const OPTION_NAMES = Object.freeze([
  "--stage",
  "--source-boundary-evidence",
  "--output",
] as const);
type OptionName = (typeof OPTION_NAMES)[number];

export interface ParsedGrandHallT554CleanupMarkerEvidenceArguments
  extends GenerateGrandHallT554CleanupMarkerEvidenceOptions {
  readonly check: boolean;
}

function argumentError(): GrandHallT554CleanupMarkerEvidenceError {
  return new GrandHallT554CleanupMarkerEvidenceError(
    "ARGUMENT_INVALID",
    "T-554 cleanup-marker arguments must contain each required option exactly once.",
  );
}

export function parseGrandHallT554CleanupMarkerEvidenceArguments(
  argv: readonly string[],
): ParsedGrandHallT554CleanupMarkerEvidenceArguments | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  const values = new Map<OptionName, string>();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--check") {
      if (check) throw argumentError();
      check = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      option === undefined ||
      !OPTION_NAMES.some((known) => known === option) ||
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--") ||
      values.has(option as OptionName)
    ) throw argumentError();
    values.set(option as OptionName, value);
    index += 1;
  }
  if (values.size !== OPTION_NAMES.length) throw argumentError();
  return {
    captureStageRoot: values.get("--stage") as string,
    sourceBoundaryEvidencePath: values.get("--source-boundary-evidence") as string,
    outputDirectory: values.get("--output") as string,
    check,
  };
}

export interface GrandHallT554CleanupMarkerEvidenceCliIo {
  readonly write: (text: string) => void;
}

function withoutMode(
  options: ParsedGrandHallT554CleanupMarkerEvidenceArguments,
): GenerateGrandHallT554CleanupMarkerEvidenceOptions {
  return {
    captureStageRoot: options.captureStageRoot,
    sourceBoundaryEvidencePath: options.sourceBoundaryEvidencePath,
    outputDirectory: options.outputDirectory,
  };
}

export async function runGrandHallT554CleanupMarkerEvidenceCli(
  argv: readonly string[],
  io: GrandHallT554CleanupMarkerEvidenceCliIo,
): Promise<number> {
  const options = parseGrandHallT554CleanupMarkerEvidenceArguments(argv);
  if (options === null) {
    io.write(`${GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_USAGE}\n`);
    return 0;
  }
  const result = options.check
    ? await checkGrandHallT554CleanupMarkerEvidencePack(withoutMode(options))
    : await generateGrandHallT554CleanupMarkerEvidencePack(withoutMode(options));
  io.write(`${JSON.stringify({
    state: options.check
      ? "checked_exact_regeneration"
      : "generated_authority_none_cleanup_marker_evidence_pack",
    ...result,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallT554CleanupMarkerEvidenceFailure(
  error: unknown,
): string {
  const code = error instanceof GrandHallT554CleanupMarkerEvidenceError
    ? `${error.code}: `
    : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `T-554 cleanup-marker evidence stopped safely. ${code}${message}\n\n${GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_USAGE}\n`;
}

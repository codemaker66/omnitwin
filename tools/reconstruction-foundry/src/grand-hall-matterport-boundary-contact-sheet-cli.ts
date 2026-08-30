import {
  checkGrandHallMatterportBoundaryReview,
  generateGrandHallMatterportBoundaryReview,
  type GenerateGrandHallMatterportBoundaryReviewOptions,
  type GrandHallMatterportBoundaryGeneratedReview,
} from "./grand-hall-matterport-boundary-contact-sheet.js";
import { GrandHallT554PanoramaReviewError } from "./grand-hall-t554-panorama-review.js";

export const GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_USAGE = [
  "Generate the neutral Grand Hall Matterport room-boundary human-review evidence.",
  "",
  "Required:",
  "  --panorama-root <absolute Matterport panorama directory>",
  "  --output <absolute, absent output directory>",
  "",
  "Exact persisted check:",
  "  Add --check with the same paths; --output must already contain the initial evidence.",
  "",
  "The command renders sweeps 001-060 with full equirectangular context and repeats 047-051",
  "at a larger size. Every decision remains UNREVIEWED. It copies and modifies no source file.",
].join("\n");

export interface ParsedGrandHallMatterportBoundaryContactSheetArguments
  extends GenerateGrandHallMatterportBoundaryReviewOptions {
  readonly check: boolean;
}

export interface GrandHallMatterportBoundaryContactSheetCliIo {
  readonly write: (text: string) => void;
}

export interface GrandHallMatterportBoundaryContactSheetCliDependencies {
  readonly generate: (
    options: GenerateGrandHallMatterportBoundaryReviewOptions,
  ) => Promise<GrandHallMatterportBoundaryGeneratedReview>;
  readonly check: (
    options: GenerateGrandHallMatterportBoundaryReviewOptions,
  ) => Promise<GrandHallMatterportBoundaryGeneratedReview & {
    readonly exactRegenerationVerified: true;
  }>;
}

const DEFAULT_DEPENDENCIES: GrandHallMatterportBoundaryContactSheetCliDependencies = {
  generate: generateGrandHallMatterportBoundaryReview,
  check: checkGrandHallMatterportBoundaryReview,
};

function argumentError(): GrandHallT554PanoramaReviewError {
  return new GrandHallT554PanoramaReviewError(
    "ARGUMENT_INVALID",
    "Boundary contact-sheet arguments must contain each required option exactly once.",
  );
}

export function parseGrandHallMatterportBoundaryContactSheetArguments(
  argv: readonly string[],
): ParsedGrandHallMatterportBoundaryContactSheetArguments | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  let panoramaSourceRoot: string | undefined;
  let outputDirectory: string | undefined;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--check") {
      if (check) throw argumentError();
      check = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw argumentError();
    }
    if (option === "--panorama-root" && panoramaSourceRoot === undefined) {
      panoramaSourceRoot = value;
    } else if (option === "--output" && outputDirectory === undefined) {
      outputDirectory = value;
    } else {
      throw argumentError();
    }
    index += 1;
  }
  if (panoramaSourceRoot === undefined || outputDirectory === undefined) {
    throw argumentError();
  }
  return { panoramaSourceRoot, outputDirectory, check };
}

export async function runGrandHallMatterportBoundaryContactSheetCli(
  argv: readonly string[],
  io: GrandHallMatterportBoundaryContactSheetCliIo,
  dependencies: GrandHallMatterportBoundaryContactSheetCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  const parsed = parseGrandHallMatterportBoundaryContactSheetArguments(argv);
  if (parsed === null) {
    io.write(`${GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_USAGE}\n`);
    return 0;
  }
  const options: GenerateGrandHallMatterportBoundaryReviewOptions = {
    panoramaSourceRoot: parsed.panoramaSourceRoot,
    outputDirectory: parsed.outputDirectory,
  };
  const result = parsed.check
    ? await dependencies.check(options)
    : await dependencies.generate(options);
  io.write(`${JSON.stringify({
    state: parsed.check ? "checked_exact_regeneration" : "generated_all_unreviewed",
    ...result,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallMatterportBoundaryContactSheetFailure(error: unknown): string {
  const code = error instanceof GrandHallT554PanoramaReviewError ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `Grand Hall Matterport boundary review stopped safely. ${code}${message}\n\n${GRAND_HALL_MATTERPORT_BOUNDARY_CONTACT_SHEET_USAGE}\n`;
}

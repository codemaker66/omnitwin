import {
  checkGrandHallT554PanoramaInventoryReview,
  generateGrandHallT554PanoramaInventoryReview,
  type GenerateGrandHallT554PanoramaInventoryReviewOptions,
  type GeneratedGrandHallT554PanoramaInventoryReview,
  type VerifiedGrandHallT554PanoramaInventoryReview,
} from "./grand-hall-t554-panorama-inventory-review.js";
import { GrandHallT554PanoramaReviewError } from "./grand-hall-t554-panorama-review.js";

export const GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_USAGE = [
  "Generate the authority-none T-554 review supplement for the 98 panoramas outside sweeps 1-50.",
  "",
  "Required:",
  "  --panorama-root <absolute Matterport panorama directory>",
  "  --candidate-review-pack <absolute persisted 1-50 panorama review-pack directory>",
  "  --output <absolute, absent supplement output directory>",
  "",
  "Exact persisted check:",
  "  Add --check with the same three paths; --output must already contain the supplement.",
  "",
  "This command preserves the exact 1-50 pack, reads all 148 source identities, and renders seven",
  "review-only contact-sheet pages for the remaining 98 sources. It does not infer room membership,",
  "change candidate eligibility, author masks, record human acceptance, or grant any authority.",
].join("\n");

const OPTION_NAMES = Object.freeze([
  "--panorama-root",
  "--candidate-review-pack",
  "--output",
] as const);

type OptionName = (typeof OPTION_NAMES)[number];

export interface ParsedGrandHallT554PanoramaInventoryReviewArguments
  extends GenerateGrandHallT554PanoramaInventoryReviewOptions {
  readonly check: boolean;
}

function argumentError(): GrandHallT554PanoramaReviewError {
  return new GrandHallT554PanoramaReviewError(
    "ARGUMENT_INVALID",
    "All-source review arguments must contain each required option exactly once.",
  );
}

export function parseGrandHallT554PanoramaInventoryReviewArguments(
  argv: readonly string[],
): ParsedGrandHallT554PanoramaInventoryReviewArguments | null {
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
    ) {
      throw argumentError();
    }
    values.set(option as OptionName, value);
    index += 1;
  }
  if (values.size !== OPTION_NAMES.length) throw argumentError();
  return {
    panoramaSourceRoot: values.get("--panorama-root") as string,
    preservedCandidateReviewDirectory: values.get("--candidate-review-pack") as string,
    outputDirectory: values.get("--output") as string,
    check,
  };
}

export interface GrandHallT554PanoramaInventoryReviewCliIo {
  readonly write: (text: string) => void;
}

export interface GrandHallT554PanoramaInventoryReviewCliDependencies {
  readonly generate: (
    options: GenerateGrandHallT554PanoramaInventoryReviewOptions,
  ) => Promise<GeneratedGrandHallT554PanoramaInventoryReview>;
  readonly check: (
    options: GenerateGrandHallT554PanoramaInventoryReviewOptions,
  ) => Promise<
    VerifiedGrandHallT554PanoramaInventoryReview & {
      readonly exactRegenerationVerified: true;
    }
  >;
}

const DEFAULT_DEPENDENCIES: GrandHallT554PanoramaInventoryReviewCliDependencies = {
  generate: generateGrandHallT554PanoramaInventoryReview,
  check: checkGrandHallT554PanoramaInventoryReview,
};

function withoutMode(
  options: ParsedGrandHallT554PanoramaInventoryReviewArguments,
): GenerateGrandHallT554PanoramaInventoryReviewOptions {
  return {
    panoramaSourceRoot: options.panoramaSourceRoot,
    preservedCandidateReviewDirectory: options.preservedCandidateReviewDirectory,
    outputDirectory: options.outputDirectory,
  };
}

export async function runGrandHallT554PanoramaInventoryReviewCli(
  argv: readonly string[],
  io: GrandHallT554PanoramaInventoryReviewCliIo,
  dependencies: GrandHallT554PanoramaInventoryReviewCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  const options = parseGrandHallT554PanoramaInventoryReviewArguments(argv);
  if (options === null) {
    io.write(`${GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_USAGE}\n`);
    return 0;
  }
  if (options.check) {
    const result = await dependencies.check(withoutMode(options));
    io.write(`${JSON.stringify({ state: "checked_exact_regeneration", ...result }, null, 2)}\n`);
    return 0;
  }
  const result = await dependencies.generate(withoutMode(options));
  io.write(`${JSON.stringify({
    state: "generated_authority_none_human_pending",
    outputDirectory: result.outputDirectory,
    schemaVersion: result.manifest.schemaVersion,
    authority: result.manifest.authority,
    reviewState: result.manifest.reviewState,
    sourceRecordCount: result.manifest.panoramaInventory.remainingRecordCount,
    pageCount: result.manifest.pagination.pageCount,
    outputFileCount: result.manifest.pagination.outputFileCount,
    manifestSha256: result.manifest.manifestSha256,
    manifestFileSha256: result.manifestFileSha256,
    manifestFileByteLength: result.manifestFileByteLength,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallT554PanoramaInventoryReviewFailure(error: unknown): string {
  const code = error instanceof GrandHallT554PanoramaReviewError ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `T-554 all-source panorama review stopped safely. ${code}${message}\n\n${GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_USAGE}\n`;
}

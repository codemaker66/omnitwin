import {
  checkGrandHallT554PanoramaReviewPack,
  generateGrandHallT554PanoramaReviewPack,
  GrandHallT554PanoramaReviewError,
  type GenerateGrandHallT554PanoramaReviewPackOptions,
} from "./grand-hall-t554-panorama-review.js";

export const GRAND_HALL_T554_PANORAMA_REVIEW_USAGE = [
  "Generate the authority-none T-554 Grand Hall panorama human-review pack.",
  "",
  "Required:",
  "  --panorama-root <absolute Matterport panorama directory>",
  "  --preview-root <absolute E57 diagnostic-preview directory>",
  "  --membership <absolute T-550 membership JSON path>",
  "  --ceiling-color-plan <absolute ceilingcolorplan_001.jpg path>",
  "  --output <absolute, absent output directory>",
  "",
  "Exact persisted check:",
  "  Add --check and provide the same five paths; --output must be the existing review directory.",
  "",
  "This command reads and hashes local evidence, creates review-only resampled PNG contact sheets,",
  "and atomically publishes a manifest. It does not mutate sources, use the network, infer poses,",
  "author masks, record human acceptance, or authorize any derivative as reconstruction input.",
].join("\n");

const OPTION_NAMES = Object.freeze([
  "--panorama-root",
  "--preview-root",
  "--membership",
  "--ceiling-color-plan",
  "--output",
] as const);

type OptionName = (typeof OPTION_NAMES)[number];

export interface ParsedGrandHallT554PanoramaReviewArguments
  extends GenerateGrandHallT554PanoramaReviewPackOptions {
  readonly check: boolean;
}

export function parseGrandHallT554PanoramaReviewArguments(
  argv: readonly string[],
): ParsedGrandHallT554PanoramaReviewArguments | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  const values = new Map<OptionName, string>();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--check") {
      if (check) {
        throw new GrandHallT554PanoramaReviewError(
          "ARGUMENT_INVALID",
          "--check cannot be repeated.",
        );
      }
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
      throw new GrandHallT554PanoramaReviewError(
        "ARGUMENT_INVALID",
        "Review-pack arguments must contain each required option exactly once.",
      );
    }
    values.set(option as OptionName, value);
    index += 1;
  }
  if (values.size !== OPTION_NAMES.length) {
    throw new GrandHallT554PanoramaReviewError(
      "ARGUMENT_INVALID",
      "Review-pack arguments must contain each required option exactly once.",
    );
  }
  return {
    panoramaSourceRoot: values.get("--panorama-root") as string,
    e57PreviewRoot: values.get("--preview-root") as string,
    t550MembershipPath: values.get("--membership") as string,
    ceilingColorPlanPath: values.get("--ceiling-color-plan") as string,
    outputDirectory: values.get("--output") as string,
    check,
  };
}

export interface GrandHallT554PanoramaReviewCliIo {
  readonly write: (text: string) => void;
}

export async function runGrandHallT554PanoramaReviewCli(
  argv: readonly string[],
  io: GrandHallT554PanoramaReviewCliIo,
): Promise<number> {
  const options = parseGrandHallT554PanoramaReviewArguments(argv);
  if (options === null) {
    io.write(`${GRAND_HALL_T554_PANORAMA_REVIEW_USAGE}\n`);
    return 0;
  }
  if (options.check) {
    const result = await checkGrandHallT554PanoramaReviewPack(options);
    io.write(
      `${JSON.stringify(
        {
          state: "checked_exact_regeneration",
          authority: result.authority,
          outputDirectory: result.outputDirectory,
          manifestSha256: result.manifestSha256,
          manifestFileSha256: result.manifestFileSha256,
          manifestFileByteLength: result.manifestFileByteLength,
          persistedInventoryVerified: result.persistedInventoryVerified,
          pngDecodeVerified: result.pngDecodeVerified,
          exactRegenerationVerified: result.exactRegenerationVerified,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  const result = await generateGrandHallT554PanoramaReviewPack(options);
  io.write(
    `${JSON.stringify(
      {
        state: "generated_authority_none",
        schemaVersion: result.manifest.schemaVersion,
        authority: result.manifest.authority,
        reviewState: result.manifest.reviewState,
        outputDirectory: result.outputDirectory,
        manifestSha256: result.manifest.manifestSha256,
        manifestFileSha256: result.manifestFileSha256,
        manifestFileByteLength: result.manifestFileByteLength,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

export function formatGrandHallT554PanoramaReviewFailure(error: unknown): string {
  const code = error instanceof GrandHallT554PanoramaReviewError ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `T-554 panorama review generation stopped safely. ${code}${message}\n\n${GRAND_HALL_T554_PANORAMA_REVIEW_USAGE}\n`;
}

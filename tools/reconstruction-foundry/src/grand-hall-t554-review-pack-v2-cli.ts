import {
  GrandHallT554ReviewPackV2Error,
  checkGrandHallT554ReviewPackV2,
  generateGrandHallT554ReviewPackV2,
  type GrandHallT554ReviewPackV2Options,
  type VerifiedGrandHallT554ReviewPackV2,
} from "./grand-hall-t554-review-pack-v2.js";

export const GRAND_HALL_T554_REVIEW_PACK_V2_USAGE = [
  "Generate the separately versioned T-554 v2 human-pending review pack.",
  "",
  "Required:",
  "  --t554-v1-root <absolute persisted T-554 v1 review root>",
  "  --t561-observations <absolute exact T-561 observation input JSON>",
  "  --t561-pack <absolute persisted T-561 observation pack directory>",
  "  --output <absolute absent output directory>",
  "",
  "Zero-write exact check:",
  "  Add --check with the same four paths; --output must already contain the v2 pack.",
  "",
  "This emits blank human decisions and an empty closed-selection-volume template. It authors no",
  "mask, geometry, acceptance, or authority. Inspection remains resampled-possible 2048x1024 and",
  "nativeResolutionHumanReviewCompleted=false.",
].join("\n");

const OPTIONS = Object.freeze([
  "--t554-v1-root",
  "--t561-observations",
  "--t561-pack",
  "--output",
] as const);
type OptionName = (typeof OPTIONS)[number];

export interface ParsedGrandHallT554ReviewPackV2Arguments extends GrandHallT554ReviewPackV2Options {
  readonly check: boolean;
}

function argumentError(): GrandHallT554ReviewPackV2Error {
  return new GrandHallT554ReviewPackV2Error(
    "ARGUMENT_INVALID",
    "T-554 v2 arguments must contain each required option exactly once.",
  );
}

export function parseGrandHallT554ReviewPackV2Arguments(
  argv: readonly string[],
): ParsedGrandHallT554ReviewPackV2Arguments | null {
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
      option === undefined || !OPTIONS.some((known) => known === option) || value === undefined ||
      value.length === 0 || value.startsWith("--") || values.has(option as OptionName)
    ) throw argumentError();
    values.set(option as OptionName, value);
    index += 1;
  }
  if (values.size !== OPTIONS.length) throw argumentError();
  return {
    predecessorReviewRoot: values.get("--t554-v1-root") as string,
    t561ObservationInputPath: values.get("--t561-observations") as string,
    t561ObservationPackDirectory: values.get("--t561-pack") as string,
    outputDirectory: values.get("--output") as string,
    check,
  };
}

export interface GrandHallT554ReviewPackV2CliIo {
  readonly write: (text: string) => void;
}

export interface GrandHallT554ReviewPackV2CliDependencies {
  readonly generate: (options: GrandHallT554ReviewPackV2Options) => Promise<VerifiedGrandHallT554ReviewPackV2>;
  readonly check: (
    options: GrandHallT554ReviewPackV2Options,
  ) => Promise<VerifiedGrandHallT554ReviewPackV2 & { readonly exactRegenerationVerified: true }>;
}

const DEFAULT_DEPENDENCIES: GrandHallT554ReviewPackV2CliDependencies = {
  generate: generateGrandHallT554ReviewPackV2,
  check: checkGrandHallT554ReviewPackV2,
};

function withoutMode(options: ParsedGrandHallT554ReviewPackV2Arguments): GrandHallT554ReviewPackV2Options {
  return {
    predecessorReviewRoot: options.predecessorReviewRoot,
    t561ObservationInputPath: options.t561ObservationInputPath,
    t561ObservationPackDirectory: options.t561ObservationPackDirectory,
    outputDirectory: options.outputDirectory,
  };
}

export async function runGrandHallT554ReviewPackV2Cli(
  argv: readonly string[],
  io: GrandHallT554ReviewPackV2CliIo,
  dependencies: GrandHallT554ReviewPackV2CliDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  const options = parseGrandHallT554ReviewPackV2Arguments(argv);
  if (options === null) {
    io.write(`${GRAND_HALL_T554_REVIEW_PACK_V2_USAGE}\n`);
    return 0;
  }
  const result = options.check
    ? await dependencies.check(withoutMode(options))
    : await dependencies.generate(withoutMode(options));
  io.write(`${JSON.stringify({
    state: options.check ? "checked_t554_v2_exact_zero_write" : "generated_t554_v2_human_pending",
    ...result,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallT554ReviewPackV2Failure(error: unknown): string {
  const code = error instanceof GrandHallT554ReviewPackV2Error ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `T-554 v2 review-pack operation stopped safely. ${code}${message}\n\n${GRAND_HALL_T554_REVIEW_PACK_V2_USAGE}\n`;
}

import {
  GrandHallT561PanoramaVisualObservationError,
  checkGrandHallT561ObservationPack,
  generateGrandHallT561ObservationPack,
  type GenerateGrandHallT561ObservationOptions,
  type VerifiedGrandHallT561ObservationPack,
} from "./grand-hall-t561-panorama-visual-observation.js";

export const GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_USAGE = [
  "Generate the authority-none T-561 all-source panorama visual-observation pack.",
  "",
  "Required:",
  "  --panorama-root <absolute exact 148-file panorama directory>",
  "  --t554-panorama-pack <absolute persisted T-554 panorama review-pack directory>",
  "  --observations <absolute strict T-561 observation input JSON>",
  "  --output <absolute absent output directory>",
  "",
  "Exact persisted check:",
  "  Add --check with the same four paths; --output must already contain the pack.",
  "",
  "The tool verifies exact identities and records agent visual observations only. The disclosed",
  "inspection display is 2048x1024 and may be resampled. Native-resolution human review remains",
  "false. No result grants room, mask, pose, training, reconstruction, runtime, staging, public,",
  "or architectural authority.",
].join("\n");

const OPTION_NAMES = Object.freeze([
  "--panorama-root",
  "--t554-panorama-pack",
  "--observations",
  "--output",
] as const);
type OptionName = (typeof OPTION_NAMES)[number];

export interface ParsedGrandHallT561PanoramaVisualObservationArguments
  extends GenerateGrandHallT561ObservationOptions {
  readonly check: boolean;
}

function argumentError(): GrandHallT561PanoramaVisualObservationError {
  return new GrandHallT561PanoramaVisualObservationError(
    "ARGUMENT_INVALID",
    "T-561 arguments must contain each required option exactly once.",
  );
}

export function parseGrandHallT561PanoramaVisualObservationArguments(
  argv: readonly string[],
): ParsedGrandHallT561PanoramaVisualObservationArguments | null {
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
    panoramaSourceRoot: values.get("--panorama-root") as string,
    t554PanoramaPackDirectory: values.get("--t554-panorama-pack") as string,
    observationInputPath: values.get("--observations") as string,
    outputDirectory: values.get("--output") as string,
    check,
  };
}

export interface GrandHallT561PanoramaVisualObservationCliIo {
  readonly write: (text: string) => void;
}

export interface GrandHallT561PanoramaVisualObservationCliDependencies {
  readonly generate: (
    options: GenerateGrandHallT561ObservationOptions,
  ) => Promise<VerifiedGrandHallT561ObservationPack>;
  readonly check: (
    options: GenerateGrandHallT561ObservationOptions,
  ) => Promise<VerifiedGrandHallT561ObservationPack & { readonly exactRegenerationVerified: true }>;
}

const DEFAULT_DEPENDENCIES: GrandHallT561PanoramaVisualObservationCliDependencies = {
  generate: generateGrandHallT561ObservationPack,
  check: checkGrandHallT561ObservationPack,
};

function withoutMode(
  options: ParsedGrandHallT561PanoramaVisualObservationArguments,
): GenerateGrandHallT561ObservationOptions {
  return {
    panoramaSourceRoot: options.panoramaSourceRoot,
    t554PanoramaPackDirectory: options.t554PanoramaPackDirectory,
    observationInputPath: options.observationInputPath,
    outputDirectory: options.outputDirectory,
  };
}

export async function runGrandHallT561PanoramaVisualObservationCli(
  argv: readonly string[],
  io: GrandHallT561PanoramaVisualObservationCliIo,
  dependencies: GrandHallT561PanoramaVisualObservationCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
  const options = parseGrandHallT561PanoramaVisualObservationArguments(argv);
  if (options === null) {
    io.write(`${GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_USAGE}\n`);
    return 0;
  }
  const result = options.check
    ? await dependencies.check(withoutMode(options))
    : await dependencies.generate(withoutMode(options));
  io.write(`${JSON.stringify({
    state: options.check
      ? "checked_exact_regeneration"
      : "generated_authority_none_visual_observation_pack",
    ...result,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallT561PanoramaVisualObservationFailure(error: unknown): string {
  const code = error instanceof GrandHallT561PanoramaVisualObservationError
    ? `${error.code}: `
    : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `T-561 panorama visual observation stopped safely. ${code}${message}\n\n${GRAND_HALL_T561_PANORAMA_VISUAL_OBSERVATION_USAGE}\n`;
}

import {
  GrandHallT554ReviewPackV3Error,
  checkGrandHallT554ReviewPackV3,
  generateGrandHallT554ReviewPackV3,
  type GrandHallT554ReviewPackV3Options,
} from "./grand-hall-t554-review-pack-v3.js";

const VALUE_FLAGS = Object.freeze([
  "--t554-v1-root",
  "--panorama-root",
  "--t554-panorama-pack",
  "--t561-observations",
  "--t561-pack",
  "--cleanup-stage",
  "--cleanup-boundary-evidence",
  "--cleanup-pack",
  "--output",
] as const);

type ValueFlag = typeof VALUE_FLAGS[number];

export interface GrandHallT554ReviewPackV3Arguments {
  readonly check: boolean;
  readonly options: GrandHallT554ReviewPackV3Options;
}

function requireValue(values: ReadonlyMap<ValueFlag, string>, flag: ValueFlag): string {
  const value = values.get(flag);
  if (value === undefined) throw new GrandHallT554ReviewPackV3Error(
    "ARGUMENT_INVALID", `Missing ${flag}.`,
  );
  return value;
}

function parseValueFlag(
  argv: readonly string[],
  index: number,
  values: Map<ValueFlag, string>,
): number {
  const flag = argv[index];
  if (flag === undefined || !VALUE_FLAGS.includes(flag as ValueFlag)) {
    throw new GrandHallT554ReviewPackV3Error(
      "ARGUMENT_INVALID", `Invalid argument ${flag ?? "at end"}.`,
    );
  }
  if (values.has(flag as ValueFlag)) throw new GrandHallT554ReviewPackV3Error(
    "ARGUMENT_INVALID", `Duplicate argument ${flag}.`,
  );
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new GrandHallT554ReviewPackV3Error(
    "ARGUMENT_INVALID", `Missing value for ${flag}.`,
  );
  values.set(flag as ValueFlag, value);
  return index + 2;
}

export function parseGrandHallT554ReviewPackV3Arguments(
  argv: readonly string[],
): GrandHallT554ReviewPackV3Arguments {
  const values = new Map<ValueFlag, string>();
  let check = false;
  for (let index = 0; index < argv.length;) {
    if (argv[index] === "--check") {
      if (check) throw new GrandHallT554ReviewPackV3Error(
        "ARGUMENT_INVALID", "Duplicate argument --check.",
      );
      check = true;
      index += 1;
      continue;
    }
    index = parseValueFlag(argv, index, values);
  }
  return { check, options: {
    predecessorReviewRoot: requireValue(values, "--t554-v1-root"),
    panoramaSourceRoot: requireValue(values, "--panorama-root"),
    t554PanoramaPackDirectory: requireValue(values, "--t554-panorama-pack"),
    t561ObservationInputPath: requireValue(values, "--t561-observations"),
    t561ObservationPackDirectory: requireValue(values, "--t561-pack"),
    cleanupCaptureStageRoot: requireValue(values, "--cleanup-stage"),
    cleanupSourceBoundaryEvidencePath: requireValue(values, "--cleanup-boundary-evidence"),
    cleanupEvidencePackDirectory: requireValue(values, "--cleanup-pack"),
    outputDirectory: requireValue(values, "--output"),
  } };
}

export async function runGrandHallT554ReviewPackV3Cli(
  argv: readonly string[],
): Promise<void> {
  const parsed = parseGrandHallT554ReviewPackV3Arguments(argv);
  const summary = parsed.check
    ? await checkGrandHallT554ReviewPackV3(parsed.options)
    : await generateGrandHallT554ReviewPackV3(parsed.options);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

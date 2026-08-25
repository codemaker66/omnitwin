import {
  checkT554BoundaryReviewPack,
  GRAND_HALL_T554_BOUNDARY_REVIEW_FATAL_MESSAGE,
  writeT554BoundaryReviewPack,
  type T554BoundaryReviewWriteOptions,
} from "./grand-hall-t554-boundary-review.js";

export const GRAND_HALL_T554_BOUNDARY_REVIEW_USAGE = [
  "Read-only, authority-none Grand Hall T-554 boundary review pack.",
  "",
  "Generate:",
  "  tsx src/grand-hall-t554-boundary-review-entry.mts --source-root <absolute MatterPak root> --poses <absolute retained E57 poses.json> --out <new absolute output directory>",
  "",
  "Check exact regeneration:",
  "  tsx src/grand-hall-t554-boundary-review-entry.mts --check --source-root <absolute MatterPak root> --poses <absolute retained E57 poses.json> --out <existing absolute output directory>",
  "",
  "The command never authors a closure, mask, inferred wall, texture, runtime package, or authority.",
].join("\n");

interface ParsedArguments extends T554BoundaryReviewWriteOptions {
  readonly check: boolean;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseGrandHallT554BoundaryReviewArguments(args: readonly string[]): ParsedArguments {
  let matterpakSourceRoot: string | null = null;
  let posesJsonPath: string | null = null;
  let outputDirectory: string | null = null;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--check") {
      if (check) throw new Error("--check cannot be repeated");
      check = true;
      continue;
    }
    if (option === "--source-root") {
      if (matterpakSourceRoot !== null) throw new Error("--source-root cannot be repeated");
      matterpakSourceRoot = requiredValue(args, index, option);
      index += 1;
      continue;
    }
    if (option === "--poses") {
      if (posesJsonPath !== null) throw new Error("--poses cannot be repeated");
      posesJsonPath = requiredValue(args, index, option);
      index += 1;
      continue;
    }
    if (option === "--out") {
      if (outputDirectory !== null) throw new Error("--out cannot be repeated");
      outputDirectory = requiredValue(args, index, option);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${String(option)}`);
  }
  if (matterpakSourceRoot === null || posesJsonPath === null || outputDirectory === null) {
    throw new Error("--source-root, --poses, and --out are required");
  }
  return { matterpakSourceRoot, posesJsonPath, outputDirectory, check };
}

export interface GrandHallT554BoundaryReviewCliDependencies {
  readonly write: (text: string) => void;
}

export function runGrandHallT554BoundaryReviewCli(
  args: readonly string[],
  dependencies: GrandHallT554BoundaryReviewCliDependencies,
): void {
  if (args.includes("--help") || args.includes("-h")) {
    dependencies.write(`${GRAND_HALL_T554_BOUNDARY_REVIEW_USAGE}\n`);
    return;
  }
  const parsed = parseGrandHallT554BoundaryReviewArguments(args);
  const digest = parsed.check
    ? checkT554BoundaryReviewPack(parsed)
    : writeT554BoundaryReviewPack(parsed);
  dependencies.write(`${JSON.stringify({
    state: parsed.check ? "checked_exact_regeneration" : "generated_authority_none",
    manifestSha256: digest,
    authority: "none",
  })}\n`);
}

export function formatGrandHallT554BoundaryReviewFailure(): string {
  return GRAND_HALL_T554_BOUNDARY_REVIEW_FATAL_MESSAGE;
}

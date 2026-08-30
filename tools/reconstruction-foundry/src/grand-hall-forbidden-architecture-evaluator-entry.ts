import { asError } from "@omnitwin/reconstruction-foundry";

import {
  prepareGrandHallForbiddenArchitectureEvaluatorMaterials,
  runGrandHallForbiddenArchitectureEvaluator,
} from "./grand-hall-forbidden-architecture-evaluator.js";

const USAGE = [
  "Grand Hall forbidden-architecture review-evidence evaluator (authority: none)",
  "",
  "Prepare immutable evaluator materials:",
  "  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-forbidden-architecture-evaluator -- prepare --implementation <absolute-path> --source <absolute-png> --protected-mask <absolute-png> --generated-mask <absolute-png> --width <pixels> --height <pixels> --output <absent-directory>",
  "",
  "Generate deterministic review evidence and a not_evaluated semantic result:",
  "  pnpm --filter @omnitwin/reconstruction-foundry-cli grand-hall-forbidden-architecture-evaluator -- run --source <absolute-png> --candidate <absolute-png> --protected-mask <absolute-png> --generated-mask <absolute-png> --implementation <absolute-path> --configuration <absolute-json> --runtime <absolute-json> --output <absent-directory>",
].join("\n");

function flags(arguments_: readonly string[]): ReadonlyMap<string, string> {
  if (arguments_.length % 2 !== 0) throw new Error("Every option must have exactly one value.");
  const parsed = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || parsed.has(name)) {
      throw new Error("Options must be unique --name value pairs.");
    }
    parsed.set(name, value);
  }
  return parsed;
}

function exactOptions(actual: ReadonlyMap<string, string>, expected: readonly string[]): void {
  const unexpected = [...actual.keys()].filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !actual.has(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`Expected exactly ${expected.join(", ")}; missing ${missing.join(", ") || "none"}; unexpected ${unexpected.join(", ") || "none"}.`);
  }
}

function required(actual: ReadonlyMap<string, string>, name: string): string {
  const value = actual.get(name);
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(actual: ReadonlyMap<string, string>, name: string): number {
  const value = Number(required(actual, name));
  if (!Number.isInteger(value) || value <= 0 || value > 65_536) throw new Error(`${name} must be an integer from 1 through 65536.`);
  return value;
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const command = arguments_[0];
  const parsed = flags(arguments_.slice(1));
  if (command === "prepare") {
    exactOptions(parsed, ["--implementation", "--source", "--protected-mask", "--generated-mask", "--width", "--height", "--output"]);
    const result = await prepareGrandHallForbiddenArchitectureEvaluatorMaterials({
      implementationPath: required(parsed, "--implementation"),
      sourceImagePath: required(parsed, "--source"),
      protectedMaskPath: required(parsed, "--protected-mask"),
      generatedRegionMaskPath: required(parsed, "--generated-mask"),
      width: positiveInteger(parsed, "--width"),
      height: positiveInteger(parsed, "--height"),
      outputDirectory: required(parsed, "--output"),
    });
    process.stdout.write(`${JSON.stringify({ state: "forbidden_architecture_evaluator_materials_prepared", ...result })}\n`);
    return;
  }
  if (command === "run") {
    exactOptions(parsed, [
      "--source", "--candidate", "--protected-mask", "--generated-mask", "--implementation",
      "--configuration", "--runtime", "--output",
    ]);
    const result = await runGrandHallForbiddenArchitectureEvaluator({
      sourceImagePath: required(parsed, "--source"),
      candidateImagePath: required(parsed, "--candidate"),
      protectedMaskPath: required(parsed, "--protected-mask"),
      generatedRegionMaskPath: required(parsed, "--generated-mask"),
      implementationPath: required(parsed, "--implementation"),
      configurationPath: required(parsed, "--configuration"),
      runtimePath: required(parsed, "--runtime"),
      outputDirectory: required(parsed, "--output"),
    });
    process.stdout.write(`${JSON.stringify({ state: "not_evaluated_human_review_required", ...result })}\n`);
    return;
  }
  throw new Error(`Expected command prepare or run.\n${USAGE}`);
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`Grand Hall forbidden-architecture evaluator stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

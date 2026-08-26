import {
  checkT554InterfaceAtlas,
  GRAND_HALL_T554_INTERFACE_ATLAS_FATAL_MESSAGE,
  writeT554InterfaceAtlas,
  type T554InterfaceAtlasWriteOptions,
} from "./grand-hall-t554-interface-atlas.js";

export const GRAND_HALL_T554_INTERFACE_ATLAS_USAGE = [
  "Read-only, authority-none Grand Hall T-554 eight-interface source-topology atlas.",
  "",
  "Generate:",
  "  tsx src/grand-hall-t554-interface-atlas-entry.ts --source-root <absolute MatterPak root> --out <new absolute output directory>",
  "",
  "Check exact source regeneration:",
  "  tsx src/grand-hall-t554-interface-atlas-entry.ts --check --source-root <absolute MatterPak root> --out <existing absolute output directory>",
  "",
  "The command authors no closure, keep side, camera join, mask, repaired contour, inferred doorway, disposition, or authority.",
].join("\n");

interface ParsedArguments extends T554InterfaceAtlasWriteOptions {
  readonly check: boolean;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseGrandHallT554InterfaceAtlasArguments(args: readonly string[]): ParsedArguments {
  let matterpakSourceRoot: string | null = null;
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
    if (option === "--out") {
      if (outputDirectory !== null) throw new Error("--out cannot be repeated");
      outputDirectory = requiredValue(args, index, option);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${String(option)}`);
  }
  if (matterpakSourceRoot === null || outputDirectory === null) {
    throw new Error("--source-root and --out are required");
  }
  return { matterpakSourceRoot, outputDirectory, check };
}

export interface GrandHallT554InterfaceAtlasCliDependencies {
  readonly write: (text: string) => void;
}

export function runGrandHallT554InterfaceAtlasCli(
  args: readonly string[],
  dependencies: GrandHallT554InterfaceAtlasCliDependencies,
): void {
  if (args.includes("--help") || args.includes("-h")) {
    dependencies.write(`${GRAND_HALL_T554_INTERFACE_ATLAS_USAGE}\n`);
    return;
  }
  const parsed = parseGrandHallT554InterfaceAtlasArguments(args);
  const digest = parsed.check ? checkT554InterfaceAtlas(parsed) : writeT554InterfaceAtlas(parsed);
  dependencies.write(`${JSON.stringify({
    state: parsed.check ? "checked_exact_source_regeneration" : "generated_authority_none",
    manifestSha256: digest,
    interfaceCount: 8,
    authority: "none",
  })}\n`);
}

export function formatGrandHallT554InterfaceAtlasFailure(): string {
  return GRAND_HALL_T554_INTERFACE_ATLAS_FATAL_MESSAGE;
}

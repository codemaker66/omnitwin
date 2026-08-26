import {
  authorGrandHallT561RealObservationInput,
  type AuthorGrandHallT561RealObservationInputOptions,
} from "./grand-hall-t561-real-observation-input.js";

function parseArguments(argv: readonly string[]): AuthorGrandHallT561RealObservationInputOptions | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  if (
    argv.length !== 4 ||
    argv[0] !== "--panorama-root" ||
    argv[1] === undefined ||
    argv[2] !== "--output" ||
    argv[3] === undefined
  ) {
    throw new Error("Expected --panorama-root <absolute directory> --output <absolute absent JSON file>.");
  }
  return { panoramaSourceRoot: argv[1], outputPath: argv[3] };
}

const usage = [
  "Author the exact authority-none T-561 observation input.",
  "",
  "Required:",
  "  --panorama-root <absolute exact 148-file panorama directory>",
  "  --output <absolute absent JSON file>",
  "",
  "This command records the frozen 2048x1024 agent observations and exact source identities.",
  "It does not perform or claim native-resolution human review, masks, acceptance, or reconstruction.",
].join("\n");

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === null) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const result = await authorGrandHallT561RealObservationInput(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  process.stderr.write(`T-561 real observation input authoring stopped safely. ${message}\n\n${usage}\n`);
  process.exitCode = 1;
});

import {
  checkGrandHallNativeInclusiveVisibleFirstComparison,
  GrandHallNativeInclusiveComparisonError,
  writeGrandHallNativeInclusiveVisibleFirstComparison,
} from "./grand-hall-native-inclusive-visible-first-comparison.js";

const REQUIRED_OPTIONS = new Set([
  "--browser-receipt",
  "--native-operator-directory",
  "--output",
]);

async function main(argv: readonly string[]): Promise<void> {
  if (argv.length !== 7 || (argv[0] !== "write" && argv[0] !== "check")) {
    throw new GrandHallNativeInclusiveComparisonError("USAGE", "Usage: <write|check> --browser-receipt <absolute-v3-receipt> --native-operator-directory <absolute-directory> --output <absolute-directory>");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (key === undefined || value === undefined || !REQUIRED_OPTIONS.has(key) || options.has(key)
      || value.length === 0 || value.startsWith("--")) {
      throw new GrandHallNativeInclusiveComparisonError("USAGE", "Each required option must be provided exactly once.");
    }
    options.set(key, value);
  }
  const browser = options.get("--browser-receipt"); const native = options.get("--native-operator-directory"); const output = options.get("--output");
  if (browser === undefined || native === undefined || output === undefined) throw new GrandHallNativeInclusiveComparisonError("USAGE", "A required option is missing.");
  const receipt = argv[0] === "write"
    ? await writeGrandHallNativeInclusiveVisibleFirstComparison(browser, native, output)
    : await checkGrandHallNativeInclusiveVisibleFirstComparison(browser, native, output);
  process.stdout.write(`${JSON.stringify({ mode: argv[0], authority: receipt.authority, schemaVersion: receipt.schemaVersion, outputDirectory: output })}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code = error instanceof GrandHallNativeInclusiveComparisonError ? error.code : "UNEXPECTED";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});

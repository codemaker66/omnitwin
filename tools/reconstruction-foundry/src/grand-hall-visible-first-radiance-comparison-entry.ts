import {
  GrandHallVisibleFirstComparisonError,
  runGrandHallVisibleFirstRadianceComparisonCli,
} from "./grand-hall-visible-first-radiance-comparison.js";

try {
  const output = await runGrandHallVisibleFirstRadianceComparisonCli(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
} catch (error) {
  const code = error instanceof GrandHallVisibleFirstComparisonError ? error.code : "UNEXPECTED";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exitCode = 1;
}

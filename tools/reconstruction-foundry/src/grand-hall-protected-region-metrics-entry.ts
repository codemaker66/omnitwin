import {
  GrandHallProtectedRegionMetricsError,
  runGrandHallProtectedRegionMetricsCli,
} from "./grand-hall-protected-region-metrics.js";

try {
  const output = await runGrandHallProtectedRegionMetricsCli(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
} catch (error) {
  if (error instanceof GrandHallProtectedRegionMetricsError) {
    process.stderr.write(`${JSON.stringify({ code: error.code, error: error.message })}\n`);
  } else {
    process.stderr.write(`${JSON.stringify({ code: "UNEXPECTED", error: error instanceof Error ? error.message : String(error) })}\n`);
  }
  process.exitCode = 1;
}

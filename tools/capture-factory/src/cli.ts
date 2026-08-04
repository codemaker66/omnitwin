import { runCaptureFactoryCli } from "./cli-support.js";

try {
  await runCaptureFactoryCli(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`capture factory failed: ${message}\n`);
  process.exitCode = 1;
}

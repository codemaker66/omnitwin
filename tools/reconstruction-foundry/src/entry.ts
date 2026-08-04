import { asError } from "@omnitwin/reconstruction-foundry";
import { runFoundryCli } from "./cli.js";

try {
  await runFoundryCli(process.argv.slice(2), {
    env: process.env,
    write: (text) => process.stdout.write(text),
  });
} catch (error: unknown) {
  process.stderr.write(`Foundry stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

import { asError } from "@omnitwin/reconstruction-foundry";
import { runFoundryCli } from "./cli.js";

try {
  await runFoundryCli(process.argv.slice(2), {
    env: process.env,
    write: (text) => process.stdout.write(text),
    signalSource: {
      on: (signal, listener) => {
        process.on(signal, listener);
      },
      off: (signal, listener) => {
        process.off(signal, listener);
      },
    },
  });
} catch (error: unknown) {
  process.stderr.write(`Foundry stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

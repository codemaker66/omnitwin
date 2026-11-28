// The command `pnpm --filter @omnitwin/credit-runner sandbox` runs: it always
// runs main, however its path was spelled (through a junction or symlink too).
// cli.ts only defines main, so tests can import it without starting anything.
import { describeError } from "../task.js";
import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`credit-runner sandbox: ${describeError(error)}\n`);
    process.exitCode = 1;
  },
);

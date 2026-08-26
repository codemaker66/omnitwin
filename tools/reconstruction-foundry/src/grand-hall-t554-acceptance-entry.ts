import {
  formatGrandHallT554AcceptanceFailure,
  runGrandHallT554AcceptanceCli,
} from "./grand-hall-t554-acceptance-cli.js";

try {
  process.exitCode = await runGrandHallT554AcceptanceCli(process.argv.slice(2), {
    write: (text) => process.stdout.write(text),
  });
} catch (error) {
  process.stderr.write(formatGrandHallT554AcceptanceFailure(error));
  process.exitCode = 1;
}

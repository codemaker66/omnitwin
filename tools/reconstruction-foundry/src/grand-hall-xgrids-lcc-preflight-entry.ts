import {
  formatGrandHallXgridsLccPreflightFailure,
  runGrandHallXgridsLccPreflightCli,
} from "./grand-hall-xgrids-lcc-preflight-cli.js";

try {
  process.exitCode = await runGrandHallXgridsLccPreflightCli(process.argv.slice(2), {
    write: (text) => process.stdout.write(text),
  });
} catch (error: unknown) {
  process.stderr.write(formatGrandHallXgridsLccPreflightFailure(error));
  process.exitCode = 1;
}

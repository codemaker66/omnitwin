import {
  formatGrandHallT554InterfaceAtlasFailure,
  runGrandHallT554InterfaceAtlasCli,
} from "./grand-hall-t554-interface-atlas-cli.js";

try {
  runGrandHallT554InterfaceAtlasCli(process.argv.slice(2), {
    write: (text) => process.stdout.write(text),
  });
} catch {
  process.stderr.write(`${formatGrandHallT554InterfaceAtlasFailure()}\n`);
  process.exitCode = 1;
}

import {
  formatGrandHallT554ReviewPackV2Failure,
  runGrandHallT554ReviewPackV2Cli,
} from "./grand-hall-t554-review-pack-v2-cli.js";

runGrandHallT554ReviewPackV2Cli(process.argv.slice(2), process.stdout)
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(formatGrandHallT554ReviewPackV2Failure(error));
    process.exitCode = 1;
  });

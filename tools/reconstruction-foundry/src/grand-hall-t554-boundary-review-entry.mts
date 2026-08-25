import {
  formatGrandHallT554BoundaryReviewFailure,
  runGrandHallT554BoundaryReviewCli,
} from "./grand-hall-t554-boundary-review-cli.js";

try {
  runGrandHallT554BoundaryReviewCli(process.argv.slice(2), {
    write: (text) => process.stdout.write(text),
  });
} catch {
  process.stderr.write(`${formatGrandHallT554BoundaryReviewFailure()}\n`);
  process.exitCode = 1;
}

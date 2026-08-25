import {
  formatGrandHallT554PanoramaReviewFailure,
  runGrandHallT554PanoramaReviewCli,
} from "./grand-hall-t554-panorama-review-cli.js";

try {
  process.exitCode = await runGrandHallT554PanoramaReviewCli(process.argv.slice(2), {
    write: (text) => process.stdout.write(text),
  });
} catch (error: unknown) {
  process.stderr.write(formatGrandHallT554PanoramaReviewFailure(error));
  process.exitCode = 1;
}

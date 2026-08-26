import {
  formatGrandHallT554PanoramaInventoryReviewFailure,
  runGrandHallT554PanoramaInventoryReviewCli,
} from "./grand-hall-t554-panorama-inventory-review-cli.js";

try {
  process.exitCode = await runGrandHallT554PanoramaInventoryReviewCli(
    process.argv.slice(2),
    { write: (text) => process.stdout.write(text) },
  );
} catch (error: unknown) {
  process.stderr.write(formatGrandHallT554PanoramaInventoryReviewFailure(error));
  process.exitCode = 1;
}

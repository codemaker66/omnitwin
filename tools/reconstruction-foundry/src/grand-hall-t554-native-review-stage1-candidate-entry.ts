import {
  formatGrandHallT554NativeReviewStage1CandidateFailure,
  runGrandHallT554NativeReviewStage1CandidateCli,
} from "./grand-hall-t554-native-review-stage1-candidate-cli.js";

try {
  process.exitCode = await runGrandHallT554NativeReviewStage1CandidateCli(
    process.argv.slice(2),
    { write: (text) => process.stdout.write(text) },
  );
} catch (error: unknown) {
  process.stderr.write(
    formatGrandHallT554NativeReviewStage1CandidateFailure(error),
  );
  process.exitCode = 1;
}

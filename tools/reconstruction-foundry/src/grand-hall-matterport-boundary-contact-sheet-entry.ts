import {
  formatGrandHallMatterportBoundaryContactSheetFailure,
  runGrandHallMatterportBoundaryContactSheetCli,
} from "./grand-hall-matterport-boundary-contact-sheet-cli.js";

try {
  process.exitCode = await runGrandHallMatterportBoundaryContactSheetCli(
    process.argv.slice(2),
    { write: (text) => process.stdout.write(text) },
  );
} catch (error: unknown) {
  process.stderr.write(formatGrandHallMatterportBoundaryContactSheetFailure(error));
  process.exitCode = 1;
}

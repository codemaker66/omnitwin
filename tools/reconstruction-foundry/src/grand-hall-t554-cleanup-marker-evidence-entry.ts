import {
  formatGrandHallT554CleanupMarkerEvidenceFailure,
  runGrandHallT554CleanupMarkerEvidenceCli,
} from "./grand-hall-t554-cleanup-marker-evidence-cli.js";

try {
  process.exitCode = await runGrandHallT554CleanupMarkerEvidenceCli(
    process.argv.slice(2),
    { write: (text) => process.stdout.write(text) },
  );
} catch (error: unknown) {
  process.stderr.write(formatGrandHallT554CleanupMarkerEvidenceFailure(error));
  process.exitCode = 1;
}

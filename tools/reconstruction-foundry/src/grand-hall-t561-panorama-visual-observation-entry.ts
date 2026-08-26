import {
  formatGrandHallT561PanoramaVisualObservationFailure,
  runGrandHallT561PanoramaVisualObservationCli,
} from "./grand-hall-t561-panorama-visual-observation-cli.js";

try {
  process.exitCode = await runGrandHallT561PanoramaVisualObservationCli(
    process.argv.slice(2),
    { write: (text) => process.stdout.write(text) },
  );
} catch (error: unknown) {
  process.stderr.write(formatGrandHallT561PanoramaVisualObservationFailure(error));
  process.exitCode = 1;
}

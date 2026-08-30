import { asError } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_CAMERA_METRIC_SUBSET_USAGE,
  checkGrandHallCameraMetricSubset,
  parseGrandHallCameraMetricSubsetArguments,
  writeGrandHallCameraMetricSubset,
} from "./grand-hall-camera-metric-subset.js";

try {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${GRAND_HALL_CAMERA_METRIC_SUBSET_USAGE}\n`);
  } else {
    const options = parseGrandHallCameraMetricSubsetArguments(process.argv.slice(2));
    const bundle = options.check
      ? await checkGrandHallCameraMetricSubset(options)
      : await writeGrandHallCameraMetricSubset(options);
    process.stdout.write(`${JSON.stringify({
      state: options.check ? "checked_exact_regeneration" : "written_no_replace",
      outputPath: options.outputPath,
      schemaVersion: bundle.schemaVersion,
      bundleSha256: bundle.bundleSha256,
      rowCount: bundle.summary.rowCount,
      nativeCubefaceCount: bundle.summary.nativeCubefaceCount,
      authority: bundle.authority,
      trainingInputPermitted: bundle.contract.trainingInputPermitted,
      runtimeInputPermitted: bundle.contract.runtimeInputPermitted,
    }, null, 2)}\n`);
  }
} catch (error: unknown) {
  process.stderr.write(`Grand Hall camera/metric subset stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

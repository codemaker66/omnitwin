import { asError } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_XBAG_CAMERA_CALIBRATION_USAGE,
  checkGrandHallXgridsXbagCameraCalibration,
  parseGrandHallXbagCameraCalibrationArguments,
  writeGrandHallXgridsXbagCameraCalibration,
} from "./grand-hall-xgrids-xbag-camera-calibration.js";

try {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${GRAND_HALL_XBAG_CAMERA_CALIBRATION_USAGE}\n`);
  } else {
    const options = parseGrandHallXbagCameraCalibrationArguments(process.argv.slice(2));
    const receipt = options.check
      ? await checkGrandHallXgridsXbagCameraCalibration(options)
      : await writeGrandHallXgridsXbagCameraCalibration(options);
    process.stdout.write(`${JSON.stringify({
      state: options.check ? "checked_exact_regeneration" : "written_no_replace",
      outputPath: options.outputPath,
      schemaVersion: receipt.schemaVersion,
      receiptSha256: receipt.receiptSha256,
      cameraCount: receipt.calibration.cameras.length,
      crossSensorTransformCount: receipt.calibration.crossSensorTransforms.length,
      cameraNameMapping: receipt.calibration.cameraNameMapping,
      transformDirectionEstablished: receipt.proof.transformDirectionEstablished,
      opticalFramePayloadRecovered: receipt.proof.opticalFramePayloadRecovered,
      authority: receipt.authority,
    }, null, 2)}\n`);
  }
} catch (error: unknown) {
  process.stderr.write(
    `Grand Hall XBAG camera-calibration recovery stopped safely: ${asError(error).message}\n`,
  );
  process.exitCode = 1;
}

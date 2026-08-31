import { asError } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_POSE_LINEAGE_USAGE,
  checkGrandHallXgridsLccPoseLineage,
  parseGrandHallPoseLineageArguments,
  writeGrandHallXgridsLccPoseLineage,
} from "./grand-hall-xgrids-lcc-pose-lineage.js";

try {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${GRAND_HALL_POSE_LINEAGE_USAGE}\n`);
  } else {
    const options = parseGrandHallPoseLineageArguments(process.argv.slice(2));
    const receipt = options.check
      ? await checkGrandHallXgridsLccPoseLineage(options)
      : await writeGrandHallXgridsLccPoseLineage(options);
    process.stdout.write(`${JSON.stringify({
      state: options.check ? "checked_exact_regeneration" : "written_no_replace",
      outputPath: options.outputPath,
      schemaVersion: receipt.schemaVersion,
      bundleSha256: receipt.bundleSha256,
      authority: receipt.authority,
      pairCount: receipt.trajectoryPairing.pairCount,
      candidateQuaternionOrdering:
        receipt.quaternionPermutationDiagnostic.uniquelyBestCandidate.rawComponentOrderToProcessedTuple,
      metricTransformAccepted: receipt.contract.metricTransformAccepted,
      runtimePermitted: receipt.contract.runtimePermitted,
    }, null, 2)}\n`);
  }
} catch (error: unknown) {
  process.stderr.write(`Grand Hall XGRIDS/LCC pose-lineage receipt stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

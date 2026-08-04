import { parentPort, workerData } from "node:worker_threads";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
  bestEffortClearOfflinePreviewVerifierBuffer,
  executeLocalOfflineNormalizationPreviewFreshVerification,
  type LocalOfflineNormalizationPreviewVerifierFailure,
} from "./local-offline-normalization-preview-verifier.js";

function deliveryFailure(): LocalOfflineNormalizationPreviewVerifierFailure {
  return {
    schemaVersion:
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
    kind: "failed",
    code:
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.resultDeliveryFailed,
  };
}

async function main(): Promise<void> {
  if (parentPort === null) {
    throw new Error("The fresh-verification Worker requires a parent port.");
  }
  const result =
    await executeLocalOfflineNormalizationPreviewFreshVerification(workerData);
  try {
    if (result.kind === "verified") {
      parentPort.postMessage(result, [result.candidateOutputBytes]);
    } else {
      parentPort.postMessage(result);
    }
  } catch {
    if (result.kind === "verified") {
      bestEffortClearOfflinePreviewVerifierBuffer(
        result.candidateOutputBytes,
      );
    }
    try {
      parentPort.postMessage(deliveryFailure());
    } catch {
      // The parent channel is unavailable; there is no remaining safe output.
    }
  } finally {
    parentPort.close();
  }
}

void main();

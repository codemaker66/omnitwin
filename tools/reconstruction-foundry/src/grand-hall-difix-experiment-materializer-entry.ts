import { asError } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZER_USAGE,
  checkGrandHallDifixExperimentMaterialization,
  parseGrandHallDifixExperimentMaterializerArguments,
  readGrandHallDifixExperimentMaterializationSpec,
  writeGrandHallDifixExperimentMaterialization,
} from "./grand-hall-difix-experiment-materializer.js";

async function main(): Promise<void> {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${GRAND_HALL_DIFIX_EXPERIMENT_MATERIALIZER_USAGE}\n`);
    return;
  }
  const options = parseGrandHallDifixExperimentMaterializerArguments(process.argv.slice(2));
  const result = options.check
    ? await checkGrandHallDifixExperimentMaterialization(options.outputDirectory)
    : await writeGrandHallDifixExperimentMaterialization(
      await readGrandHallDifixExperimentMaterializationSpec(options.specPath),
    );
  process.stdout.write(`${JSON.stringify({
    state: "authority_none_experiment_materialized",
    outputDirectory: result.outputDirectory,
    experimentSha256: result.experiment.experimentSha256,
    plannedExecutionLockSha256: result.experiment.plannedExecutionLock.plannedExecutionLockSha256,
    receiptSha256: result.receiptSha256,
    execution: result.experiment.capabilities.execution,
    dispatchEnabled: result.experiment.capabilities.dispatchEnabled,
  })}\n`);
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`Grand Hall Difix experiment materializer stopped safely: ${asError(error).message}\n`);
  process.exitCode = 1;
}

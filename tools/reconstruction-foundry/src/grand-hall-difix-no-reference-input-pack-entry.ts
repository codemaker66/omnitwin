import { asError } from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_DIFIX_INPUT_PACK_USAGE,
  checkGrandHallDifixNoReferenceInputPack,
  parseGrandHallDifixInputPackArguments,
  writeGrandHallDifixNoReferenceInputPack,
} from "./grand-hall-difix-no-reference-input-pack.js";

try {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(`${GRAND_HALL_DIFIX_INPUT_PACK_USAGE}\n`);
  } else {
    const options = parseGrandHallDifixInputPackArguments(process.argv.slice(2));
    const result = options.check
      ? await checkGrandHallDifixNoReferenceInputPack(options.outputDirectory)
      : await writeGrandHallDifixNoReferenceInputPack(options);
    process.stdout.write(`${JSON.stringify({
      state: options.check ? "checked_zero_write" : "written_no_replace_receipt_last",
      outputDirectory: result.outputDirectory,
      schemaVersion: result.manifest.schemaVersion,
      authority: result.manifest.authority.authority,
      providerExecutionPermitted: result.manifest.authority.providerExecutionPermitted,
      bundleMaterialSha256: result.manifest.bundleMaterialSha256,
      publicationReceiptSha256: result.publicationReceiptSha256,
    }, null, 2)}\n`);
  }
} catch (error: unknown) {
  process.stderr.write(
    `Grand Hall Difix no-reference input pack stopped safely: ${asError(error).message}\n`,
  );
  process.exitCode = 1;
}

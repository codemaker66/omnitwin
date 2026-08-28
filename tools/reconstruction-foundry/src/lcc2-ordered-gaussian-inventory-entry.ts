import {
  inspectLcc2OrderedGaussianInventory,
  Lcc2OrderedGaussianInventoryError,
} from "./lcc2-ordered-gaussian-inventory.js";
import { Lcc2ContainerValidationError } from "./lcc2-container-validation.js";
import { Lcc2FrontierError } from "./lcc2-frontier.js";
import { parseLcc2OrderedGaussianInventoryArguments } from "./lcc2-ordered-gaussian-inventory-cli.js";

const USAGE = [
  "Read an XGRIDS .lcc2 SOG package and print a verified row-major Gaussian ordinal inventory.",
  "",
  "Required:",
  "  --manifest <absolute .lcc2 path>",
  "",
  "The environment is always excluded. This command reads local files and creates bounded in-memory snapshots only; it does not persist copies, change, upload, render, mask, transform, register, or publish them.",
].join("\n");

try {
  const parsed = parseLcc2OrderedGaussianInventoryArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const receipt = await inspectLcc2OrderedGaussianInventory(parsed);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
} catch (error: unknown) {
  const code = error instanceof Lcc2OrderedGaussianInventoryError ||
      error instanceof Lcc2ContainerValidationError ||
      error instanceof Lcc2FrontierError
    ? `${error.code}: `
    : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  process.stderr.write(`LCC2 ordered inventory stopped safely. ${code}${message}\n\n${USAGE}\n`);
  process.exitCode = 1;
}

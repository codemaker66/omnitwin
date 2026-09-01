import {
  checkLcc2SogCoordinateStream,
  GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE,
  Lcc2SogCoordinateStreamError,
  writeLcc2SogCoordinateStream,
} from "./lcc2-sog-coordinate-stream.js";
import { Lcc2ContainerValidationError } from "./lcc2-container-validation.js";
import { Lcc2FrontierError } from "./lcc2-frontier.js";
import { Lcc2OrderedGaussianInventoryError } from "./lcc2-ordered-gaussian-inventory.js";
import { parseLcc2SogCoordinateStreamArguments } from "./lcc2-sog-coordinate-stream-cli.js";

const USAGE = [
  "Create or zero-write check one exact authority-none SOG v2 coordinate stream.",
  "",
  "Usage:",
  "  write --profile grand-hall-big-sog-v1 --manifest <absolute .lcc2 path> --output <absolute new directory>",
  "  check --profile grand-hall-big-sog-v1 --manifest <absolute .lcc2 path> --output <absolute existing directory>",
  "",
  "write is create-only and publishes uint16-le XYZ, float64-le decoded XYZ, then a compact receipt.",
  "check writes no files and compares the existing bodies byte-for-byte with exact source regeneration.",
  "The environment is always excluded. No room, metric, transform, mask, training, reconstruction, runtime, staging, deployment, publication, or production authority is granted.",
].join("\n");

try {
  const parsed = parseLcc2SogCoordinateStreamArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const options = {
      manifestPath: parsed.manifestPath,
      outputDirectory: parsed.outputDirectory,
      expectedSourceProfile: {
        "grand-hall-big-sog-v1": GRAND_HALL_BIG_SOG_V1_COORDINATE_SOURCE_PROFILE,
      }[parsed.profile],
    };
    const receipt = parsed.mode === "write"
      ? await writeLcc2SogCoordinateStream(options)
      : await checkLcc2SogCoordinateStream(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
} catch (error: unknown) {
  const code = error instanceof Lcc2SogCoordinateStreamError ||
      error instanceof Lcc2ContainerValidationError ||
      error instanceof Lcc2FrontierError ||
      error instanceof Lcc2OrderedGaussianInventoryError
    ? `${error.code}: `
    : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  process.stderr.write(`LCC2 coordinate stream stopped safely. ${code}${message}\n\n${USAGE}\n`);
  process.exitCode = 1;
}

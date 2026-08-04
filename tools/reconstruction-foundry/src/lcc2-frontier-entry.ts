import {
  inspectLcc2HighestDetailFrontier,
  Lcc2FrontierError,
} from "./lcc2-frontier.js";
import { parseLcc2FrontierArguments } from "./lcc2-frontier-cli.js";

const USAGE = [
  "Read an XGRIDS .lcc2 package and print a verified highest-detail frontier receipt.",
  "",
  "Required:",
  "  --manifest <absolute .lcc2 path>",
  "  --environment <include|exclude>",
  "",
  "This command reads and hashes local files. It does not copy, change, upload, render, register, or publish them.",
].join("\n");

try {
  const parsed = parseLcc2FrontierArguments(process.argv.slice(2));
  if (parsed === null) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const receipt = await inspectLcc2HighestDetailFrontier(parsed);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
} catch (error: unknown) {
  const code = error instanceof Lcc2FrontierError ? `${error.code}: ` : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  process.stderr.write(`LCC2 frontier check stopped safely. ${code}${message}\n\n${USAGE}\n`);
  process.exitCode = 1;
}

import type { Lcc2EnvironmentPolicy } from "./lcc2-frontier.js";

export interface Lcc2FrontierCliArguments {
  readonly manifestPath: string;
  readonly environmentPolicy: Lcc2EnvironmentPolicy;
}

export function parseLcc2FrontierArguments(
  arguments_: readonly string[],
): Lcc2FrontierCliArguments | null {
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    return null;
  }
  let manifestPath: string | undefined;
  let environmentPolicy: Lcc2EnvironmentPolicy | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--manifest" && value !== undefined) {
      if (manifestPath !== undefined) throw new Error("--manifest can be supplied only once.");
      manifestPath = value;
      index += 1;
      continue;
    }
    if (argument === "--environment" && value !== undefined) {
      if (environmentPolicy !== undefined) throw new Error("--environment can be supplied only once.");
      if (value !== "include" && value !== "exclude") {
        throw new Error("--environment must be exactly include or exclude.");
      }
      environmentPolicy = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument ?? "(missing)"}`);
  }
  if (manifestPath === undefined || environmentPolicy === undefined) {
    throw new Error("Both --manifest and --environment are required.");
  }
  return { manifestPath, environmentPolicy };
}

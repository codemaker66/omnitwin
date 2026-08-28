export interface Lcc2OrderedGaussianInventoryCliArguments {
  readonly manifestPath: string;
}

export function parseLcc2OrderedGaussianInventoryArguments(
  arguments_: readonly string[],
): Lcc2OrderedGaussianInventoryCliArguments | null {
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    return null;
  }
  let manifestPath: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--manifest" && value !== undefined) {
      if (manifestPath !== undefined) throw new Error("--manifest can be supplied only once.");
      manifestPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument ?? "(missing)"}`);
  }
  if (manifestPath === undefined) throw new Error("--manifest is required.");
  return { manifestPath };
}

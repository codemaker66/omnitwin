export type Lcc2SogCoordinateStreamMode = "write" | "check";
export type Lcc2SogCoordinateStreamCliProfile = "grand-hall-big-sog-v1";

export interface Lcc2SogCoordinateStreamCliArguments {
  readonly mode: Lcc2SogCoordinateStreamMode;
  readonly profile: Lcc2SogCoordinateStreamCliProfile;
  readonly manifestPath: string;
  readonly outputDirectory: string;
}

export function parseLcc2SogCoordinateStreamArguments(
  arguments_: readonly string[],
): Lcc2SogCoordinateStreamCliArguments | null {
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    return null;
  }
  const mode = arguments_[0];
  if (mode !== "write" && mode !== "check") {
    throw new Error("First argument must be write or check.");
  }
  let profile: Lcc2SogCoordinateStreamCliProfile | undefined;
  let manifestPath: string | undefined;
  let outputDirectory: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--profile" && value !== undefined) {
      if (profile !== undefined) throw new Error("--profile can be supplied only once.");
      if (value !== "grand-hall-big-sog-v1") {
        throw new Error("--profile must be exactly grand-hall-big-sog-v1; arbitrary source identities are not accepted by this CLI.");
      }
      profile = value;
      index += 1;
      continue;
    }
    if (argument === "--manifest" && value !== undefined) {
      if (manifestPath !== undefined) throw new Error("--manifest can be supplied only once.");
      manifestPath = value;
      index += 1;
      continue;
    }
    if (argument === "--output" && value !== undefined) {
      if (outputDirectory !== undefined) throw new Error("--output can be supplied only once.");
      outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument ?? "(missing)"}`);
  }
  if (profile === undefined) throw new Error("--profile is required.");
  if (manifestPath === undefined) throw new Error("--manifest is required.");
  if (outputDirectory === undefined) throw new Error("--output is required.");
  return { mode, profile, manifestPath, outputDirectory };
}

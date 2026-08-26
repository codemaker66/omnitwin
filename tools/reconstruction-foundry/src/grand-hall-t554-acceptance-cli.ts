import {
  GrandHallT554AcceptanceError,
  acceptGrandHallT554Scope,
  bindGrandHallT554PendingMaskEvidence,
  writeGrandHallT554AcceptanceTemplates,
} from "./grand-hall-t554-acceptance.js";

export class GrandHallT554AcceptanceCliReportingError extends Error {
  readonly outputDirectory: string;

  constructor(outputDirectory: string, cause: unknown) {
    super(
      "T-554 output was published, but writing the operator receipt failed.",
      { cause },
    );
    this.name = "GrandHallT554AcceptanceCliReportingError";
    this.outputDirectory = outputDirectory;
  }
}

export const GRAND_HALL_T554_ACCEPTANCE_USAGE = [
  "Prepare or accept the data-faithful Grand Hall T-554 human scope review.",
  "",
  "Generate human-pending templates (no decisions or geometry are inferred):",
  "  tsx src/grand-hall-t554-acceptance-entry.ts template --review-pack <absolute verified review-pack directory> --out <new absolute output directory>",
  "",
  "Bind exact decoded masks into a new pending review document (still no human acceptance):",
  "  tsx src/grand-hall-t554-acceptance-entry.ts bind-masks --decisions <absolute pending decisions JSON> --mask-root <absolute exact mask directory> --out <new absolute output directory>",
  "",
  "Accept a completed human review and publish scope artifacts:",
  "  tsx src/grand-hall-t554-acceptance-entry.ts accept --review-pack <absolute verified review-pack directory> --panorama-root <absolute source panorama directory> --decisions <absolute completed decisions JSON> --volume <absolute reviewed selection-volume JSON> --mask-root <absolute mask directory> --out <new absolute output directory>",
  "",
  "Acceptance authorizes only the reviewed room-scope evidence. It does not authorize reconstruction,",
  "runtime admission, generated fill, production trust, deployment, publication, or source mutation.",
].join("\n");

export interface GrandHallT554AcceptanceTemplateArguments {
  readonly command: "template";
  readonly reviewPackDirectory: string;
  readonly outputDirectory: string;
}

export interface GrandHallT554AcceptanceApplyArguments {
  readonly command: "accept";
  readonly reviewPackDirectory: string;
  readonly panoramaSourceRoot: string;
  readonly decisionsPath: string;
  readonly closedVolumePath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

export interface GrandHallT554AcceptanceMaskBindingArguments {
  readonly command: "bind-masks";
  readonly decisionsPath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

export type GrandHallT554AcceptanceArguments =
  | GrandHallT554AcceptanceTemplateArguments
  | GrandHallT554AcceptanceMaskBindingArguments
  | GrandHallT554AcceptanceApplyArguments;

export interface GrandHallT554AcceptanceTemplateWriteOptions {
  readonly reviewPackDirectory: string;
  readonly outputDirectory: string;
}

export interface GrandHallT554AcceptanceWriteOptions {
  readonly reviewPackDirectory: string;
  readonly panoramaSourceRoot: string;
  readonly decisionsPath: string;
  readonly closedVolumePath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

export interface GrandHallT554AcceptanceMaskBindingOptions {
  readonly decisionsPath: string;
  readonly maskRoot: string;
  readonly outputDirectory: string;
}

const TEMPLATE_OPTIONS = Object.freeze([
  "--review-pack",
  "--out",
] as const);

const ACCEPT_OPTIONS = Object.freeze([
  "--review-pack",
  "--panorama-root",
  "--decisions",
  "--volume",
  "--mask-root",
  "--out",
] as const);

const MASK_BINDING_OPTIONS = Object.freeze([
  "--decisions",
  "--mask-root",
  "--out",
] as const);

function invalidInvocation(): never {
  throw new Error("Invalid Grand Hall T-554 acceptance invocation.");
}

function parseRequiredOptions<const TOption extends string>(
  arguments_: readonly string[],
  allowedOptions: readonly TOption[],
): ReadonlyMap<TOption, string> {
  if (arguments_.length !== allowedOptions.length * 2) return invalidInvocation();
  const values = new Map<TOption, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    const knownOption = allowedOptions.find((candidate) => candidate === option);
    if (
      knownOption === undefined ||
      value === undefined ||
      value.startsWith("--") ||
      value.trim().length === 0 ||
      values.has(knownOption)
    ) {
      return invalidInvocation();
    }
    values.set(knownOption, value);
  }
  if (values.size !== allowedOptions.length) return invalidInvocation();
  return values;
}

function requireParsedValue<TOption extends string>(
  values: ReadonlyMap<TOption, string>,
  option: TOption,
): string {
  return values.get(option) ?? invalidInvocation();
}

export function parseGrandHallT554AcceptanceArguments(
  arguments_: readonly string[],
): GrandHallT554AcceptanceArguments {
  const [command, ...commandArguments] = arguments_;
  if (command === "template") {
    const values = parseRequiredOptions(commandArguments, TEMPLATE_OPTIONS);
    return Object.freeze({
      command,
      reviewPackDirectory: requireParsedValue(values, "--review-pack"),
      outputDirectory: requireParsedValue(values, "--out"),
    });
  }
  if (command === "bind-masks") {
    const values = parseRequiredOptions(commandArguments, MASK_BINDING_OPTIONS);
    return Object.freeze({
      command,
      decisionsPath: requireParsedValue(values, "--decisions"),
      maskRoot: requireParsedValue(values, "--mask-root"),
      outputDirectory: requireParsedValue(values, "--out"),
    });
  }
  if (command === "accept") {
    const values = parseRequiredOptions(commandArguments, ACCEPT_OPTIONS);
    return Object.freeze({
      command,
      reviewPackDirectory: requireParsedValue(values, "--review-pack"),
      panoramaSourceRoot: requireParsedValue(values, "--panorama-root"),
      decisionsPath: requireParsedValue(values, "--decisions"),
      closedVolumePath: requireParsedValue(values, "--volume"),
      maskRoot: requireParsedValue(values, "--mask-root"),
      outputDirectory: requireParsedValue(values, "--out"),
    });
  }
  return invalidInvocation();
}

export interface GrandHallT554AcceptanceCliDependencies {
  readonly write: (text: string) => void;
  readonly writeTemplates?: (
    options: GrandHallT554AcceptanceTemplateWriteOptions,
  ) => Promise<Readonly<object>>;
  readonly bindMasks?: (
    options: GrandHallT554AcceptanceMaskBindingOptions,
  ) => Promise<Readonly<object>>;
  readonly accept?: (
    options: GrandHallT554AcceptanceWriteOptions,
  ) => Promise<Readonly<object>>;
}

function writePendingResult(
  dependencies: GrandHallT554AcceptanceCliDependencies,
  result: Readonly<object>,
  state: "generated_human_pending_template" |
    "exact_mask_evidence_bound_human_review_still_pending",
): void {
  dependencies.write(`${JSON.stringify({
    ...result,
    state,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    productionTrust: null,
    runtimeAdmissionAuthorized: false,
    reconstructionAuthorized: false,
    geometricCameraAuthority: "none",
    generatedFillPermitted: false,
  }, null, 2)}\n`);
}

async function runTemplateCommand(
  parsed: GrandHallT554AcceptanceTemplateArguments,
  dependencies: GrandHallT554AcceptanceCliDependencies,
): Promise<void> {
  const result = await (
    dependencies.writeTemplates ?? writeGrandHallT554AcceptanceTemplates
  )({
    reviewPackDirectory: parsed.reviewPackDirectory,
    outputDirectory: parsed.outputDirectory,
  });
  writePendingResult(dependencies, result, "generated_human_pending_template");
}

async function runMaskBindingCommand(
  parsed: GrandHallT554AcceptanceMaskBindingArguments,
  dependencies: GrandHallT554AcceptanceCliDependencies,
): Promise<void> {
  const result = await (
    dependencies.bindMasks ?? bindGrandHallT554PendingMaskEvidence
  )({
    decisionsPath: parsed.decisionsPath,
    maskRoot: parsed.maskRoot,
    outputDirectory: parsed.outputDirectory,
  });
  writePendingResult(
    dependencies,
    result,
    "exact_mask_evidence_bound_human_review_still_pending",
  );
}

async function runAcceptCommand(
  parsed: GrandHallT554AcceptanceApplyArguments,
  dependencies: GrandHallT554AcceptanceCliDependencies,
): Promise<void> {
  const result = await (dependencies.accept ?? acceptGrandHallT554Scope)({
    reviewPackDirectory: parsed.reviewPackDirectory,
    panoramaSourceRoot: parsed.panoramaSourceRoot,
    decisionsPath: parsed.decisionsPath,
    closedVolumePath: parsed.closedVolumePath,
    maskRoot: parsed.maskRoot,
    outputDirectory: parsed.outputDirectory,
  });
  try {
    dependencies.write(`${JSON.stringify({
      ...result,
      state: "accepted_scope_artifacts_written",
      authority: "human_accepted",
      productionTrust: null,
      runtimeAdmissionAuthorized: false,
      reconstructionAuthorized: false,
      geometricCameraAuthority: "none",
      generatedFillPermitted: false,
    }, null, 2)}\n`);
  } catch (error) {
    throw new GrandHallT554AcceptanceCliReportingError(parsed.outputDirectory, error);
  }
}

export async function runGrandHallT554AcceptanceCli(
  arguments_: readonly string[],
  dependencies: GrandHallT554AcceptanceCliDependencies,
): Promise<0> {
  if (
    arguments_.length === 1 &&
    (arguments_[0] === "--help" || arguments_[0] === "-h")
  ) {
    dependencies.write(`${GRAND_HALL_T554_ACCEPTANCE_USAGE}\n`);
    return 0;
  }
  const parsed = parseGrandHallT554AcceptanceArguments(arguments_);
  if (parsed.command === "template") await runTemplateCommand(parsed, dependencies);
  else if (parsed.command === "bind-masks") await runMaskBindingCommand(parsed, dependencies);
  else await runAcceptCommand(parsed, dependencies);
  return 0;
}

export function formatGrandHallT554AcceptanceFailure(error: unknown): string {
  if (error instanceof GrandHallT554AcceptanceCliReportingError) {
    return [
      "Grand Hall T-554 acceptance may already be committed, but its terminal receipt could not be printed.",
      `Do not rerun into the same path. Inspect: ${error.outputDirectory}`,
      "A complete output contains publication-receipt.json; an output without it is incomplete and grants no authority.",
      "",
    ].join("\n");
  }
  const detail = error instanceof GrandHallT554AcceptanceError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : "Unknown failure";
  return [
    "Grand Hall T-554 acceptance stopped safely. No scope acceptance authority was issued.",
    `Reason: ${detail}`,
    "",
    GRAND_HALL_T554_ACCEPTANCE_USAGE,
    "",
  ].join("\n");
}

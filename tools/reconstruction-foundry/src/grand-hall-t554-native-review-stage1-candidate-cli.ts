import {
  GrandHallT554NativeReviewStage1CandidateError,
  checkGrandHallT554NativeReviewStage1Candidate,
  generateGrandHallT554NativeReviewStage1Candidate,
} from "./grand-hall-t554-native-review-stage1-candidate.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_USAGE = [
  "Build the deterministic, authority-none Grand Hall T-554 Stage 1 candidate twice.",
  "",
  "Generate from one exact clean reviewed commit:",
  "  --workspace <absolute clean repository worktree>",
  "  --reviewed-git-sha <exact lowercase 40-hex commit>",
  "  --output <absolute absent output directory outside the worktree>",
  "",
  "Verify an existing candidate without rebuilding:",
  "  --check --output <absolute existing candidate directory>",
  "",
  "This command does not include or install the fixed admission capsule, listen on",
  "a port, launch a browser, access source imagery, record human decisions, accept",
  "a room boundary, reconstruct, export, upload, deploy, publish, or use production.",
].join("\n");

const VALUE_FLAGS = Object.freeze([
  "--workspace",
  "--reviewed-git-sha",
  "--output",
] as const);
type ValueFlag = (typeof VALUE_FLAGS)[number];

export type ParsedGrandHallT554NativeReviewStage1CandidateArguments =
  | {
      readonly mode: "generate";
      readonly workspaceRoot: string;
      readonly reviewedGitSha: string;
      readonly outputRoot: string;
    }
  | {
      readonly mode: "check";
      readonly outputRoot: string;
    };

function argumentError(
  message: string,
): GrandHallT554NativeReviewStage1CandidateError {
  return new GrandHallT554NativeReviewStage1CandidateError(
    "ARGUMENT_INVALID",
    message,
  );
}

function requireValue(
  values: ReadonlyMap<ValueFlag, string>,
  flag: ValueFlag,
): string {
  const value = values.get(flag);
  if (value === undefined) throw argumentError(`Missing ${flag}.`);
  return value;
}

export function parseGrandHallT554NativeReviewStage1CandidateArguments(
  argv: readonly string[],
): ParsedGrandHallT554NativeReviewStage1CandidateArguments | null {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return null;
  const values = new Map<ValueFlag, string>();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      if (check) throw argumentError("Duplicate --check.");
      check = true;
      continue;
    }
    if (
      flag === undefined ||
      !VALUE_FLAGS.some((known) => known === flag) ||
      values.has(flag as ValueFlag)
    ) {
      throw argumentError(`Invalid or duplicate argument ${flag ?? "at end"}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw argumentError(`Missing value for ${flag}.`);
    }
    values.set(flag as ValueFlag, value);
    index += 1;
  }
  const outputRoot = requireValue(values, "--output");
  if (check) {
    if (values.size !== 1) {
      throw argumentError("--check accepts only --output.");
    }
    return { mode: "check", outputRoot };
  }
  if (values.size !== VALUE_FLAGS.length) {
    throw argumentError("Generate mode requires every documented value exactly once.");
  }
  return {
    mode: "generate",
    workspaceRoot: requireValue(values, "--workspace"),
    reviewedGitSha: requireValue(values, "--reviewed-git-sha"),
    outputRoot,
  };
}

export interface GrandHallT554NativeReviewStage1CandidateCliIo {
  readonly write: (text: string) => void;
}

export async function runGrandHallT554NativeReviewStage1CandidateCli(
  argv: readonly string[],
  io: GrandHallT554NativeReviewStage1CandidateCliIo,
): Promise<number> {
  const parsed = parseGrandHallT554NativeReviewStage1CandidateArguments(argv);
  if (parsed === null) {
    io.write(`${GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_USAGE}\n`);
    return 0;
  }
  const result = parsed.mode === "check"
    ? await checkGrandHallT554NativeReviewStage1Candidate({
        outputRoot: parsed.outputRoot,
      })
    : await generateGrandHallT554NativeReviewStage1Candidate({
        workspaceRoot: parsed.workspaceRoot,
        reviewedGitSha: parsed.reviewedGitSha,
        outputRoot: parsed.outputRoot,
      });
  io.write(`${JSON.stringify({
    state: parsed.mode === "check"
      ? "checked_exact_stage1_candidate"
      : "generated_deterministic_stage1_candidate",
    authority: "none",
    reviewedGitSha: result.candidate.reviewedGitSha,
    candidateSha256: result.candidate.candidateSha256,
    manifestSemanticSha256:
      result.candidate.reviewAnchor.manifestSemanticSha256,
    manifestFileSha256: result.candidate.reviewAnchor.manifestFileSha256,
    memberInventorySha256:
      result.candidate.reviewAnchor.memberInventorySha256,
    deterministicTwins:
      result.candidate.deterministicComparison.allRequiredComparisonsIdentical,
    stage1HashApprovalRequired: true,
    stage1HashApproved: false,
    runtimeAuthorityAvailable: false,
  }, null, 2)}\n`);
  return 0;
}

export function formatGrandHallT554NativeReviewStage1CandidateFailure(
  error: unknown,
): string {
  const code = error instanceof GrandHallT554NativeReviewStage1CandidateError
    ? `${error.code}: `
    : "";
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return `Grand Hall T-554 Stage 1 stopped safely. ${code}${message}\n\n${GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_USAGE}\n`;
}

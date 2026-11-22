import { readFile } from "node:fs/promises";
import path from "node:path";
import { deletedTests, isTestFile, pathForMatching, protectedPathViolations } from "../git.js";
import { inspectPatches, patchCommit, type PatchInspection } from "./patches.js";
import type { SessionRunResult } from "./session.js";

export { patchCommit } from "./patches.js";

export type Verdict = "ready-for-review" | "rejected";

export interface Review {
  readonly verdict: Verdict;
  /** Why the branch cannot go to a person as it is. */
  readonly reasons: readonly string[];
  /** Fine to review, but look closely. */
  readonly flags: readonly string[];
  /** Read from the returned patches, never from the agent: `A`, `M`, `D` or `R` (renamed or copied from), then the path. */
  readonly changed: readonly string[];
  readonly patches: readonly string[];
  readonly diffFile: string | null;
}

export interface ReviewOptions {
  /** The commit the run started from; the patches must apply to it. */
  readonly baseSha: string;
  /** Where the base is fetched from for the inspection (default: the public repository). */
  readonly repoUrl?: string | undefined;
  readonly log?: ((line: string) => void) | undefined;
  /** The task has a precondition, so the run must have written precondition.json (the brief tells the agent to). */
  readonly preconditionExpected?: boolean | undefined;
}

/** Said in every review with a readable verifier result. */
export const ADVISORY_FLAG =
  "the verifier is advisory: it ran inside the agent's own container, so a pass is evidence the agent produced; this review reads the patches, and CI on the pull request is the acceptance authority";

/** Changes a reviewer must read line by line even when everything passes. Matched, ignoring case, as NTFS does. */
const CAREFUL: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(^|\/)pnpm-lock\.yaml$/iu, label: "lockfile" },
  { pattern: /(^|\/)package\.json$/iu, label: "package manifest" },
  { pattern: /(^|\/)drizzle\/|\.sql$/iu, label: "database migration" },
  { pattern: /(^|\/)scripts?\//iu, label: "script" },
  { pattern: /(^|\/)(vitest|vite|tsconfig|eslint)[^/]*\.(ts|js|mjs|cjs|json)$/iu, label: "build or test config" },
];

const SECRET_SHAPES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/u, label: "Anthropic key" },
  { pattern: /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/u, label: "GitHub token" },
  { pattern: /AKIA[0-9A-Z]{16}/u, label: "AWS key" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, label: "private key" },
  { pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!127\.0\.0\.1|localhost)/u, label: "database URL with a password" },
];

function sameList(a: readonly (string | null)[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** What the launcher did about a session the platform still reported running after the stream said it had finished. */
function afterFinish(result: SessionRunResult): string {
  const interrupt = result.stopInterrupted ? "the launcher interrupted it" : "the launcher's interrupt could not be sent";
  if (result.stopped) return `${interrupt}, and it stopped`;
  if (result.archived) return `${interrupt}, it did not stop, and the launcher archived it`;
  return `${interrupt}, and it had not stopped when the launcher gave up (archiving failed too)`;
}

/** What precondition.json says: `{"ok":true}` or `{"ok":false}`, and null for anything else. */
function preconditionResult(text: string): boolean | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Object.keys(parsed).length !== 1 || !("ok" in parsed)) return null;
    return typeof parsed.ok === "boolean" ? parsed.ok : null;
  } catch {
    return null;
  }
}

function short(sha: string | null): string {
  return sha === null ? "(none)" : sha.slice(0, 12);
}

/**
 * The launcher's check of a finished session, before any person opens the
 * branch. The verdict rests on what this machine reads from the returned
 * format-patch files (see patches.ts): the paths, file modes, deletions and
 * secret-shaped text in them, whatever the agent printed. The in-sandbox
 * verifier ran in a container the agent controls, so its result is advisory: a
 * failing or unreadable result rejects, a passing one never outweighs the patch
 * inspection, and CI on the pull request is the acceptance authority.
 */
export async function reviewRun(result: SessionRunResult, options: ReviewOptions): Promise<Review> {
  const reasons: string[] = [];
  const flags: string[] = [];
  // Downloaded under the launcher's names, in order: patch-0001.patch, ...,
  // then diff.patch and precondition.json (outputs.ts). An output the review
  // would read but that was not downloaded (a name it cannot account for, a
  // size over the cap, a deadline passed) rejects.
  reasons.push(...result.refusedOutputs);
  const outputs = [...result.outputs].sort();
  const diffFile = outputs.find((file) => path.basename(file) === "diff.patch") ?? null;
  const preconditionFile = outputs.find((file) => path.basename(file) === "precondition.json") ?? null;
  if (preconditionFile === null) {
    if (options.preconditionExpected === true) {
      reasons.push("the task has a precondition but the run left no precondition.json (the exact name, in the outputs folder), so nobody checked that the code the task cites has not moved");
    }
  } else {
    const precondition = preconditionResult(await readFile(preconditionFile, "utf8"));
    if (precondition === false) reasons.push("the precondition failed: the code the task cites has moved, so the task no longer applies as written");
    else if (precondition === null) reasons.push('precondition.json holds neither {"ok":true} nor {"ok":false}');
  }
  // A format-patch file is known by its `From <sha>` line, whatever its name.
  const patches: string[] = [];
  for (const file of outputs) {
    if (file === diffFile || !file.toLowerCase().endsWith(".patch")) continue;
    if (patchCommit(await readFile(file, "utf8")) !== null) patches.push(file);
    else {
      const name = JSON.stringify(result.outputNames[file] ?? path.basename(file));
      reasons.push(`${name} (saved as ${path.basename(file)}) came back but is not a format-patch file, so the review cannot account for it`);
    }
  }

  const verify = result.verify;
  if (verify === null) {
    reasons.push(
      result.verifyRuns > 0
        ? "no readable verifier result: the verifier's call did not print exactly one VERIFY_RESULT line"
        : "no readable verifier result: the verifier was never run as a call of its own, so nothing proves the change",
    );
  } else if (!verify.ok) {
    reasons.push(...verify.problems.map((problem) => `verifier: ${problem}`));
  }
  if (verify !== null) flags.push(ADVISORY_FLAG, ...verify.flags.map((flag) => `verifier: ${flag}`));

  let inspection: PatchInspection | null = null;
  if (patches.length === 0) reasons.push("no format-patch files came back");
  else {
    inspection = await inspectPatches(patches, { baseSha: options.baseSha, repoUrl: options.repoUrl, log: options.log });
    reasons.push(...inspection.problems);
    if (verify !== null) {
      if (verify.commits === null) reasons.push("the verifier reported no list of commits to hold the patches against");
      else if (!sameList(inspection.commits, verify.commits)) {
        reasons.push(
          `the patches are commits [${inspection.commits.map(short).join(", ")}], but the verifier checked [${verify.commits.map(short).join(", ")}]`,
        );
      }
      const last = inspection.commits[inspection.commits.length - 1] ?? null;
      if (last !== verify.head) reasons.push(`the last patch is commit ${last ?? "(none)"}, but the verifier checked ${verify.head}`);
    }
  }

  let diffText = "";
  if (diffFile === null) reasons.push("diff.patch did not come back");
  else {
    diffText = await readFile(diffFile, "utf8");
    if (diffText.trim() === "") reasons.push("diff.patch is empty");
  }

  for (const { pattern, label } of SECRET_SHAPES) {
    if (inspection !== null && pattern.test(inspection.addedText)) reasons.push(`the patches add something shaped like a ${label}`);
    else if (pattern.test(diffText)) reasons.push(`diff.patch contains something shaped like a ${label}`);
  }
  if (inspection !== null) {
    reasons.push(...protectedPathViolations(inspection.touched).map((hit) => `protected path changed: ${hit}`));
    reasons.push(...deletedTests(inspection.deleted).map((file) => `test deleted: ${file}`));
    reasons.push(...deletedTests(inspection.movedAway).map((file) => `test renamed or copied away: ${file}`));
    reasons.push(...inspection.binary.map((file) => `binary change: ${file} (it cannot be read or scanned as text)`));
    for (const file of inspection.touched) {
      const hit = CAREFUL.find(({ pattern }) => pattern.test(pathForMatching(file)));
      if (hit !== undefined) flags.push(`${file} (${hit.label})`);
    }
    const newSources = inspection.created.filter((file) => !isTestFile(file));
    if (newSources.length > 0) {
      flags.push(`the patches add source file(s) ${newSources.join(", ")}: without them a new test may fail on a missing module rather than on the behaviour it checks`);
    } else if (inspection.sourceLinesAdded > 0 && inspection.sourceLinesRemoved === 0) {
      flags.push("the patches only add source lines: without them a new test may fail on a missing name rather than on the behaviour it checks");
    }
  }

  if (!result.stopped) {
    reasons.push(
      result.archived
        ? "the session did not stop after the launcher stopped following it, so it was archived; its cost is counted at the whole budget"
        : "the session had not stopped when the launcher stopped following it; its cost is counted at the whole budget",
    );
  } else if (result.stopReason === null) reasons.push("the session never reported that it finished");
  if (result.runningAfterFinish) flags.push(`the platform still reported the session running after the stream said it had finished; ${afterFinish(result)}`);
  if (result.timedOut) flags.push("the run hit its time limit and was interrupted");
  if (result.stopReason === "budget_reached") flags.push("the run stopped at its budget");
  if (result.stopReason === "refusal") reasons.push("the model refused the task");
  if (result.stopReason === "retries_exhausted") reasons.push("the session stopped because its retries ran out on platform errors");
  if (result.stopReason === "terminated") reasons.push("the session was terminated before it finished its turn");
  if (result.outcome !== null && result.outcome.result !== "satisfied") flags.push(`the grader's last verdict was ${result.outcome.result}`);
  if (result.deniedAsks > 0) flags.push(`${String(result.deniedAsks)} tool call(s) asked for approval and were denied`);
  if (result.errors.length > 0) flags.push(`${String(result.errors.length)} session error(s): ${result.errors.slice(0, 3).join("; ")}`);

  return {
    verdict: reasons.length === 0 ? "ready-for-review" : "rejected",
    reasons,
    flags,
    changed: inspection?.changed ?? [],
    patches,
    diffFile,
  };
}

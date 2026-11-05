import { readFile } from "node:fs/promises";
import path from "node:path";
import { deletedTests, protectedPathViolations } from "../git.js";
import type { SessionRunResult } from "./session.js";

export type Verdict = "ready-for-review" | "rejected";

export interface Review {
  readonly verdict: Verdict;
  /** Why the branch cannot go to a person as it is. */
  readonly reasons: readonly string[];
  /** Fine to review, but look closely. */
  readonly flags: readonly string[];
  readonly changed: readonly string[];
  readonly patches: readonly string[];
  readonly diffFile: string | null;
}

/** Changes a reviewer must read line by line even when everything passes. */
const CAREFUL: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(^|\/)pnpm-lock\.yaml$/u, label: "lockfile" },
  { pattern: /(^|\/)package\.json$/u, label: "package manifest" },
  { pattern: /(^|\/)drizzle\/|\.sql$/u, label: "database migration" },
  { pattern: /(^|\/)scripts?\//u, label: "script" },
  { pattern: /(^|\/)(vitest|vite|tsconfig|eslint)[^/]*\.(ts|js|mjs|cjs|json)$/u, label: "build or test config" },
];

const SECRET_SHAPES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/u, label: "Anthropic key" },
  { pattern: /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/u, label: "GitHub token" },
  { pattern: /AKIA[0-9A-Z]{16}/u, label: "AWS key" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, label: "private key" },
  { pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@(?!127\.0\.0\.1|localhost)/u, label: "database URL with a password" },
];

/** The commit a `git format-patch` file was made from: its first line is `From <sha> <date>`. */
export function patchCommit(patchText: string): string | null {
  return /^From ([0-9a-f]{40}) /u.exec(patchText)?.[1] ?? null;
}

/**
 * The launcher's check of a finished session, before any person opens the
 * branch. It trusts the verifier's raw output and the files, not the agent's
 * report or the grader.
 */
export async function reviewRun(result: SessionRunResult): Promise<Review> {
  const reasons: string[] = [];
  const flags: string[] = [];
  const outputs = [...result.outputs].sort();
  const diffFile = outputs.find((file) => path.basename(file) === "diff.patch") ?? null;
  // The Files API gives back bare names (`0001-fix-….patch`, not under
  // `patches/`), so a format-patch file is known by its `From <sha>` line.
  const patches: string[] = [];
  for (const file of outputs) {
    if (file === diffFile || !file.endsWith(".patch")) continue;
    if (patchCommit(await readFile(file, "utf8")) !== null) patches.push(file);
  }

  const verify = result.verify;
  if (verify === null) {
    reasons.push(result.verifyRuns > 0 ? "the verifier's output could not be read" : "the verifier was never run as instructed, so nothing proves the change");
  } else if (!verify.ok) {
    reasons.push(...verify.problems.map((problem) => `verifier: ${problem}`));
  }

  if (patches.length === 0) reasons.push("no format-patch files came back");
  else if (verify !== null) {
    const last = patchCommit(await readFile(patches[patches.length - 1] ?? "", "utf8"));
    if (last !== verify.head) reasons.push(`the last patch is commit ${last ?? "(none)"}, but the verifier checked ${verify.head}`);
  }

  let diffText = "";
  if (diffFile === null) reasons.push("diff.patch did not come back");
  else {
    diffText = await readFile(diffFile, "utf8");
    if (diffText.trim() === "") reasons.push("diff.patch is empty");
  }
  for (const { pattern, label } of SECRET_SHAPES) {
    if (pattern.test(diffText)) reasons.push(`the diff contains something shaped like a ${label}`);
  }

  const changed = verify?.changed ?? [];
  const files = changed.map((entry) => entry.slice(entry.indexOf(" ") + 1));
  const removed = changed.filter((entry) => entry.startsWith("D ")).map((entry) => entry.slice(2));
  reasons.push(...protectedPathViolations(files).map((hit) => `protected path changed: ${hit}`));
  reasons.push(...deletedTests(removed).map((file) => `test deleted: ${file}`));
  for (const file of files) {
    const hit = CAREFUL.find(({ pattern }) => pattern.test(file));
    if (hit !== undefined) flags.push(`${file} (${hit.label})`);
  }

  if (result.timedOut) flags.push("the run hit its time limit and was interrupted");
  if (result.stopReason === "budget_reached") flags.push("the run stopped at its budget");
  if (result.stopReason === "refusal") reasons.push("the model refused the task");
  if (result.outcome !== null && result.outcome.result !== "satisfied") flags.push(`the grader's last verdict was ${result.outcome.result}`);
  if (result.deniedAsks > 0) flags.push(`${String(result.deniedAsks)} tool call(s) asked for approval and were denied`);
  if (result.errors.length > 0) flags.push(`${String(result.errors.length)} session error(s): ${result.errors.slice(0, 3).join("; ")}`);

  return { verdict: reasons.length === 0 ? "ready-for-review" : "rejected", reasons, flags, changed, patches, diffFile };
}

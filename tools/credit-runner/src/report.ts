import { usd } from "./budget.js";
import type { Attempt, LedgerEntry, Outcome } from "./ledger.js";

export interface OrgLine {
  readonly name: string;
  readonly status: string;
  readonly expires: string | undefined;
  readonly grantUsd: number | undefined;
  /** Runner spend on this org across all nights, from the ledger. */
  readonly spentUsd: number;
}

export interface ReportInput {
  readonly night: string;
  readonly capUsd: number;
  /** This night's runs, in the order they ran. */
  readonly entries: readonly LedgerEntry[];
  readonly orgs: readonly OrgLine[];
  /** Tasks the latest invocation did not run, with the reason. */
  readonly notRun: readonly string[];
  /** Task files that could not be read, and other warnings. */
  readonly problems: readonly string[];
  readonly generatedAt: Date;
}

const LABEL: Readonly<Record<Outcome, string>> = {
  pass: "PASS",
  fail: "FAIL",
  rejected: "REJECTED",
  stopped: "STOPPED",
  aborted: "ABORTED",
  "setup-failed": "SETUP FAILED",
  error: "ERROR",
};

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ${String(seconds % 60)} s`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

/** A code fence longer than any backtick run inside the text, so tool output cannot break out of it. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const marks = "`".repeat(Math.max(3, longest + 1));
  return `${marks}\n${text.trimEnd()}\n${marks}`;
}

function listOrNone(items: readonly string[], max: number): string {
  if (items.length === 0) return "none";
  const shown = items.slice(0, max).map((item) => `\`${item}\``);
  const more = items.length > max ? `, and ${String(items.length - max)} more` : "";
  return `${String(items.length)}: ${shown.join(", ")}${more}`;
}

function billing(attempts: readonly Attempt[]): string {
  if (attempts.length === 0) return "no model run";
  return attempts
    .map((attempt) => {
      const credential = attempt.apiKeySource === null ? "never started" : `credential \`${attempt.apiKeySource}\``;
      const stop = attempt.stop === null ? "" : `, ${attempt.stop}`;
      const cost = attempt.costKnown ? usd(attempt.costUsd) : `${usd(attempt.costUsd)} counted, cost not reported`;
      return `${attempt.orgName} (${cost}, ${credential}${stop})`;
    })
    .join(" → ");
}

function denials(attempts: readonly Attempt[]): string {
  const counts = new Map<string, number>();
  for (const name of attempts.flatMap((attempt) => attempt.permissionDenials)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return "none";
  return [...counts].map(([name, count]) => `${name} ×${String(count)}`).join(", ");
}

function renderEntry(entry: LedgerEntry): string {
  const acceptance = entry.acceptance;
  const acceptanceLine =
    acceptance.status === "not-run"
      ? `not run — \`${acceptance.command}\``
      : `${acceptance.status} — \`${acceptance.command}\` · exit ${String(acceptance.exitCode)} · ${formatDuration(acceptance.durationMs)}`;
  const models = [...new Set(entry.attempts.map((attempt) => attempt.model ?? entry.model))].join(", ");
  const lines = [
    `### ${LABEL[entry.outcome]} · ${entry.taskId} — ${entry.title}`,
    "",
    `- **Branch:** \`${entry.branch}\`${entry.baseSha === "" ? "" : ` from \`${entry.baseRef}\` @ \`${entry.baseSha.slice(0, 10)}\``}`,
    `- **Acceptance, re-run by the runner:** ${acceptanceLine}`,
    `- **Cost:** ${usd(entry.costUsd)} of ${usd(entry.budgetUsd)} budget · ${String(entry.turns)} turns · ${formatDuration(entry.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0))} agent time`,
    `- **Billed to:** ${billing(entry.attempts)} · model \`${models === "" ? entry.model : models}\` · effort ${entry.effort}`,
    `- **Commits:** ${listOrNone(entry.commits, 10)}`,
    `- **Files changed:** ${listOrNone(entry.filesChanged, 15)}`,
  ];
  if (entry.dirtyFiles.length > 0) lines.push(`- **Left uncommitted:** ${listOrNone(entry.dirtyFiles, 15)}`);
  if (entry.violations.length > 0) lines.push(`- **Rule violations:** ${entry.violations.join("; ")}`);
  lines.push(`- **Permission denials:** ${denials(entry.attempts)}`);
  if (entry.reasons.length > 0) lines.push(`- **Notes:** ${entry.reasons.join("; ")}`);
  lines.push("", "**Agent summary:**", "", entry.summary.split("\n").map((line) => `> ${line}`).join("\n"));
  if (acceptance.status === "fail" || acceptance.status === "timeout") {
    lines.push("", "**Acceptance output (tail):**", "", fence(acceptance.tail));
  }
  lines.push("", `Logs: \`${entry.logDir}\` (${entry.taskId}.*) · worktree \`${entry.worktree}\``);
  return lines.join("\n");
}

export function renderReport(input: ReportInput): string {
  const spent = input.entries.reduce((sum, entry) => sum + entry.costUsd, 0);
  const counts = new Map<Outcome, number>();
  for (const entry of input.entries) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  const tally = [...counts].map(([outcome, count]) => `${String(count)} ${LABEL[outcome].toLowerCase()}`).join(" · ");

  const out = [
    `# Credit runner report — ${input.night}`,
    "",
    `**Tonight:** ${String(input.entries.length)} run${input.entries.length === 1 ? "" : "s"}${tally === "" ? "" : ` (${tally})`} · spent ${usd(spent)} of the ${usd(input.capUsd)} nightly cap`,
    "",
    `_Updated ${input.generatedAt.toLocaleString("en-GB")}. Costs are Claude Code's own \`total_cost_usd\`; the Console balance (platform.claude.com/settings/billing) is the authority._`,
    "",
    "## Billing orgs",
    "",
    "| Org | Status | Expires | Spent via runner, all nights | Grant |",
    "|---|---|---|---|---|",
    ...input.orgs.map(
      (org) =>
        `| ${org.name} | ${org.status} | ${org.expires ?? "—"} | ${usd(org.spentUsd)} | ${org.grantUsd === undefined ? "—" : usd(org.grantUsd)} |`,
    ),
    "",
    "## Runs",
    "",
    input.entries.length === 0 ? "No tasks ran." : input.entries.map(renderEntry).join("\n\n---\n\n"),
  ];
  if (input.notRun.length > 0) {
    out.push("", "## Not run this time", "", ...input.notRun.map((line) => `- ${line}`));
  }
  if (input.problems.length > 0) {
    out.push("", "## Problems", "", ...input.problems.map((line) => `- ${line}`));
  }
  return `${out.join("\n")}\n`;
}

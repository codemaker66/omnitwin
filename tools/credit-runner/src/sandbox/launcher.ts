import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task } from "../task.js";
import type { SandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { appendCreditLine, checkSpend, readCreditLedger } from "./credit-ledger.js";
import { reviewRun, type Review } from "./review.js";
import { listCostUsd, runSession, type SessionRunResult } from "./session.js";
import { AGENT_MODEL, ensureSandbox } from "./setup.js";

export interface LauncherConfig {
  /** Run records, state and specs live here (outside the repository). */
  readonly workRoot: string;
  /** The credit lanes' shared ledger. */
  readonly ledgerFile: string;
  readonly lane: string;
  readonly laneCapUsd: number;
  readonly orgCapUsd: number;
}

export interface JobOptions {
  readonly api: SandboxApi;
  readonly config: LauncherConfig;
  readonly task: Task;
  /** Groups runs in the ledger, e.g. "a4-trial" or "night-2026-11-06". */
  readonly job: string;
  readonly budgetUsd: number;
  readonly timeoutMinutes: number;
  readonly nightCapUsd?: number | undefined;
  readonly baseSha: string;
  /** AGENTS.md at the base commit, already filtered by nightRulesFromAgentsMd. */
  readonly projectRules: string;
  readonly verifyScript: string;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export type JobRecord =
  | { readonly kind: "skipped"; readonly taskId: string; readonly reason: string }
  | {
      readonly kind: "ran";
      readonly taskId: string;
      readonly runDir: string;
      readonly branch: string;
      readonly baseSha: string;
      readonly costUsd: number;
      readonly costKnown: boolean;
      readonly result: SessionRunResult;
      readonly review: Review;
    };

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function reviewMarkdown(task: Task, record: Extract<JobRecord, { kind: "ran" }>): string {
  const { result, review } = record;
  const lines = [
    `# ${review.verdict === "ready-for-review" ? "READY FOR REVIEW" : "REJECTED"} · ${task.id} — ${task.title}`,
    "",
    `- Session: ${result.sessionId} (${result.status}, stopped: ${result.stopReason ?? "unknown"})`,
    `- Base: ${record.baseSha}; branch to open: ${record.branch}`,
    `- Cost: $${record.costUsd.toFixed(2)}${record.costKnown ? " (platform list cost, includes the session-hour fee)" : " (unknown: counted at the whole budget)"}; ${String(result.requests)} model requests; ${String(result.activeSeconds ?? "?")} active seconds`,
    `- Tokens: ${String(result.inputTokens)} uncached in, ${String(result.cacheReadTokens)} cache read, ${String(result.cacheCreationTokens)} cache written, ${String(result.outputTokens)} out`,
    `- Verifier: ${result.verify === null ? "no readable result" : result.verify.ok ? "ok" : "failed"} (${String(result.verifyRuns)} run(s))`,
    `- Grader: ${result.outcome === null ? "no verdict" : `${result.outcome.result} after iteration ${String(result.outcome.iteration)}`}`,
  ];
  if (review.reasons.length > 0) lines.push("", "## Why it is rejected", ...review.reasons.map((reason) => `- ${reason}`));
  if (review.flags.length > 0) lines.push("", "## Look closely", ...review.flags.map((flag) => `- ${flag}`));
  lines.push("", "## Changed files", ...(review.changed.length === 0 ? ["- (none reported)"] : review.changed.map((entry) => `- ${entry}`)));
  if (result.outcome !== null) lines.push("", "## Grader's explanation", "", result.outcome.explanation);
  return `${lines.join("\n")}\n`;
}

/**
 * One task, one session: check the spend, run, record the spend, review.
 * Spend is recorded even when the run fails after its session started.
 */
export async function runSandboxJob(options: JobOptions): Promise<JobRecord> {
  const { api, config, task } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);

  const ledger = await readCreditLedger(config.ledgerFile);
  const check = checkSpend(
    ledger,
    config.lane,
    options.budgetUsd,
    { laneCapUsd: config.laneCapUsd, orgCapUsd: config.orgCapUsd, nightCapUsd: options.nightCapUsd },
    `${options.job}:`,
  );
  if (!check.ok) return { kind: "skipped", taskId: task.id, reason: check.reason };
  log(`Spend check passed: ${check.reason}.`);

  const state = await ensureSandbox(api, path.join(config.workRoot, "state.json"), sandboxSystemPrompt(options.projectRules), log);
  const branch = `credit/${task.id}`;
  const runDir = path.join(config.workRoot, "runs", task.id, stamp(now()));
  await mkdir(runDir, { recursive: true });

  let result: SessionRunResult;
  // Set from runSession's callback; an object so the compiler does not narrow it to null.
  const started: { sessionId: string | null } = { sessionId: null };
  try {
    result = await runSession({
      api,
      state,
      facts: { task, baseSha: options.baseSha, branch },
      budgetUsd: options.budgetUsd,
      timeoutMinutes: options.timeoutMinutes,
      runDir,
      verifyScript: options.verifyScript,
      title: `${options.job}: ${task.title}`.slice(0, 200),
      metadata: { lane: config.lane, job: options.job, task: task.id },
      log,
      onSessionCreated: (id) => {
        started.sessionId = id;
      },
    });
  } catch (error) {
    // Nothing is spent before a session exists. Once one does, charge the
    // platform's figure, or the whole budget (which the platform's cap bounds)
    // when that cannot be read, so the ledger never under-counts.
    const sessionId = started.sessionId;
    if (sessionId !== null) {
      const known = await api.retrieveSession(sessionId).then(listCostUsd, () => null);
      await appendCreditLine(config.ledgerFile, {
        ts: now().toISOString(),
        lane: config.lane,
        job: `${options.job}:${task.id}`,
        model: AGENT_MODEL,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: known ?? options.budgetUsd,
        batchId: sessionId,
      });
    }
    throw error;
  }

  const costKnown = result.listCostUsd !== null;
  const costUsd = result.listCostUsd ?? options.budgetUsd;
  await appendCreditLine(config.ledgerFile, {
    ts: now().toISOString(),
    lane: config.lane,
    job: `${options.job}:${task.id}`,
    model: AGENT_MODEL,
    requests: result.requests,
    inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheCreationTokens,
    outputTokens: result.outputTokens,
    costUsd,
    batchId: result.sessionId,
  });

  const review = await reviewRun(result);
  const record = { kind: "ran", taskId: task.id, runDir, branch, baseSha: options.baseSha, costUsd, costKnown, result, review } as const;
  await writeFile(path.join(runDir, "result.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "review.md"), reviewMarkdown(task, record), "utf8");
  return record;
}

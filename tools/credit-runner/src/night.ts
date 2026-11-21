import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canAfford, isExpired, localDate, orderOrgs, usd } from "./budget.js";
import { buildClaudeArgs, runClaude, type ClaudeRunOutcome } from "./claude.js";
import type { Org, RunnerConfig } from "./config.js";
import { claudeChildEnv, toolChildEnv, type ChildEnv } from "./env.js";
import {
  branchExists,
  changedRefs,
  deletedTests,
  findKeyShapedStrings,
  gitIntegrity,
  inspectBranch,
  prepareWorktree,
  protectedPathViolations,
  remoteRefs,
  type BranchState,
} from "./git.js";
import { keyFileExposure, keyFileFor, keyFilePresent, readKey } from "./keys.js";
import {
  appendLedger,
  readLedger,
  spentByOrg,
  spentOn,
  type AcceptanceResult,
  type Attempt,
  type LedgerEntry,
  type Outcome,
} from "./ledger.js";
import { runProcess } from "./proc.js";
import { nightRulesFromAgentsMd } from "./project-rules.js";
import { buildSystemPrompt, buildUserPrompt, RESUME_PROMPT } from "./prompt.js";
import { renderReport } from "./report.js";
import { extractSummary } from "./stream.js";
import { describeError, loadQueue, type Task } from "./task.js";

export type OrgStatus =
  | "ready"
  | "no key file"
  | "key file too open"
  | "bad key file"
  | "expired"
  | "out of credit"
  | "key rejected";

export interface OrgState {
  readonly org: Org;
  readonly keyFile: string;
  status: OrgStatus;
  detail: string | null;
}

export interface NightOptions {
  readonly config: RunnerConfig;
  readonly repoRoot: string;
  readonly queueDir: string;
  /** runner-settings.json: the deny rules every run gets. */
  readonly settingsFile: string;
  /** Task ids to run; empty means every enabled task. */
  readonly only: readonly string[];
  readonly dryRun: boolean;
  readonly capUsd: number;
  readonly parentEnv: NodeJS.ProcessEnv;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** Checked before each task; Ctrl+C sets it so the current task finishes its bookkeeping. */
  readonly shouldStop: () => boolean;
  readonly installTimeoutMs?: number;
  readonly acceptanceTimeoutMs?: number;
}

export interface NightResult {
  readonly night: string;
  readonly reportFile: string | null;
  readonly ran: readonly LedgerEntry[];
  readonly notRun: readonly string[];
  readonly problems: readonly string[];
  readonly aborted: boolean;
}

export interface NightPaths {
  readonly ledger: string;
  readonly reportsDir: string;
  readonly report: string;
  readonly logDir: string;
  readonly claudeConfigRoot: string;
  readonly lock: string;
  readonly inflight: string;
}

export function nightPaths(config: RunnerConfig, night: string): NightPaths {
  return {
    ledger: path.join(config.outputRoot, "ledger.jsonl"),
    reportsDir: path.join(config.outputRoot, "reports"),
    report: path.join(config.outputRoot, "reports", `${night}.md`),
    logDir: path.join(config.outputRoot, "logs", night),
    claudeConfigRoot: path.join(config.runsRoot, ".claude-config"),
    lock: path.join(config.runsRoot, ".night.lock"),
    inflight: path.join(config.runsRoot, ".inflight.json"),
  };
}

/** Checks every org's key file without reading its contents; expiring-first order. */
export async function assessOrgs(config: RunnerConfig, night: string): Promise<OrgState[]> {
  const states: OrgState[] = [];
  for (const org of orderOrgs(config.orgs)) {
    const keyFile = keyFileFor(config.keyDir, org);
    const state: OrgState = { org, keyFile, status: "ready", detail: null };
    if (isExpired(org, night)) {
      state.status = "expired";
    } else if (!(await keyFilePresent(keyFile))) {
      state.status = "no key file";
    } else {
      try {
        const exposure = await keyFileExposure(keyFile);
        if (exposure.length > 0) {
          state.status = "key file too open";
          state.detail = `${exposure.join(", ")}; re-run setup-keys.ps1 to lock it`;
        }
      } catch (error) {
        state.status = "bad key file";
        state.detail = `could not read its permissions: ${describeError(error)}`;
      }
    }
    states.push(state);
  }
  return states;
}

function describeOrg(state: OrgState): string {
  return state.detail === null ? state.status : `${state.status} (${state.detail})`;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function acquireLock(file: string): Promise<() => Promise<void>> {
  try {
    await writeFile(file, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const holder = Number.parseInt(await readFile(file, "utf8"), 10);
    if (Number.isInteger(holder) && holder !== process.pid && processAlive(holder)) {
      throw new Error(`another credit-runner night is running (pid ${String(holder)}); if it is not, delete ${file}`);
    }
    await writeFile(file, String(process.pid));
  }
  return async () => {
    await rm(file, { force: true });
  };
}

/** Written before a task starts and removed after its ledger line, so a crash is never silent. */
const inflightSchema = z.object({
  night: z.string(),
  taskId: z.string(),
  title: z.string(),
  branch: z.string(),
  worktree: z.string(),
  baseRef: z.string(),
  model: z.string(),
  effort: z.string(),
  budgetUsd: z.number(),
  startedAt: z.string(),
});

type Inflight = z.infer<typeof inflightSchema>;

/**
 * A marker left by a run that never finished (a crash, a blue screen, a power
 * cut) becomes an "error" ledger line charged at the task's whole budget, so
 * the cap never under-counts; the Console shows what was really spent.
 */
async function recoverInflight(paths: NightPaths, now: Date): Promise<LedgerEntry | null> {
  let marker: Inflight;
  try {
    marker = inflightSchema.parse(JSON.parse(await readFile(paths.inflight, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    await rm(paths.inflight, { force: true });
    return null;
  }
  await rm(paths.inflight, { force: true });
  return {
    night: marker.night,
    taskId: marker.taskId,
    title: marker.title,
    startedAt: marker.startedAt,
    finishedAt: now.toISOString(),
    outcome: "error",
    reasons: [
      "the runner stopped in the middle of this task (crash, restart or power cut). Its spend was never reported, so it is counted at its whole budget; the Console shows the real figure. Review the branch, then clean it to run the task again.",
    ],
    branch: marker.branch,
    baseRef: marker.baseRef,
    baseSha: "",
    worktree: marker.worktree,
    model: marker.model,
    effort: marker.effort,
    budgetUsd: marker.budgetUsd,
    attempts: [],
    costUsd: marker.budgetUsd,
    turns: 0,
    acceptance: { command: "", status: "not-run", exitCode: null, durationMs: 0, tail: "" },
    commits: [],
    filesChanged: [],
    dirtyFiles: [],
    violations: [],
    summary: "(no summary: the run did not finish)",
    logDir: path.join(path.dirname(paths.logDir), marker.night),
  };
}

export async function runNight(options: NightOptions): Promise<NightResult> {
  const night = localDate(options.now());
  const paths = nightPaths(options.config, night);
  if (options.dryRun) return runQueue(options, night, paths);

  await mkdir(options.config.runsRoot, { recursive: true });
  await mkdir(paths.claudeConfigRoot, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  const release = await acquireLock(paths.lock);
  try {
    return await runQueue(options, night, paths);
  } finally {
    await release();
  }
}

async function runQueue(options: NightOptions, night: string, paths: NightPaths): Promise<NightResult> {
  const { config } = options;
  const queue = await loadQueue(options.queueDir);
  const problems = queue.problems.map((problem) => `${path.basename(problem.file)}: ${problem.message}`);
  for (const id of options.only) {
    if (!queue.tasks.some((task) => task.id === id)) problems.push(`--only ${id}: no task with that id in ${options.queueDir}`);
  }
  const selected = queue.tasks.filter((task) => (options.only.length > 0 ? options.only.includes(task.id) : task.enabled));

  const orgs = await assessOrgs(config, night);
  // Every usable key is read up front: each run's logs redact all of them, not just its own.
  const keys = new Map<string, string>();
  if (!options.dryRun) {
    for (const state of orgs.filter((candidate) => candidate.status === "ready")) {
      try {
        keys.set(state.org.id, await readKey(state.keyFile));
      } catch (error) {
        state.status = "bad key file";
        state.detail = describeError(error);
      }
    }
  }
  const disabled = options.only.length > 0 ? [] : queue.tasks.filter((task) => !task.enabled).map((task) => task.id);
  options.log(
    [
      `${options.dryRun ? "Plan" : "Night"} for ${night}: ${String(selected.length)} task${selected.length === 1 ? "" : "s"} selected`,
      `cap ${usd(options.capUsd)}`,
      `billing order: ${orgs.map((state) => `${state.org.name} (${describeOrg(state)})`).join(" → ")}`,
      ...(disabled.length > 0 ? [`disabled (name with --only to run): ${disabled.join(", ")}`] : []),
    ].join(" · "),
  );

  const ledger = await readLedger(paths.ledger);
  if (ledger.badLines > 0) problems.push(`${String(ledger.badLines)} unreadable line(s) in ${paths.ledger}`);
  const allEntries: LedgerEntry[] = [...ledger.entries];
  if (!options.dryRun) {
    const recovered = await recoverInflight(paths, options.now());
    if (recovered !== null) {
      await appendLedger(paths.ledger, recovered);
      allEntries.push(recovered);
      problems.push(`${recovered.taskId}: the previous run stopped mid-task; recorded as an error at its full budget`);
    }
  }
  let spent = spentOn(allEntries, night);
  const notRun: string[] = [];
  const ran: LedgerEntry[] = [];
  let aborted = false;

  const writeReport = async (): Promise<void> => {
    if (options.dryRun) return;
    const byOrg = spentByOrg(allEntries);
    const report = renderReport({
      night,
      capUsd: options.capUsd,
      entries: allEntries.filter((entry) => entry.night === night),
      orgs: orgs.map((state) => ({
        name: state.org.name,
        status: describeOrg(state),
        expires: state.org.expires,
        grantUsd: state.org.grantUsd,
        spentUsd: byOrg.get(state.org.id) ?? 0,
      })),
      notRun,
      problems,
      generatedAt: options.now(),
    });
    await writeFile(paths.report, report, "utf8");
  };

  for (const task of selected) {
    const branch = `${config.branchPrefix}${task.id}`;
    const worktree = path.join(config.runsRoot, task.id);
    if (aborted) {
      notRun.push(`${task.id}: the night was aborted by the credential check`);
      continue;
    }
    if (options.shouldStop()) {
      notRun.push(`${task.id}: stopped with Ctrl+C before it started`);
      continue;
    }
    if (await branchExists(options.repoRoot, branch)) {
      notRun.push(
        `${task.id}: already ran (branch \`${branch}\` exists). To run it again: \`pnpm --filter @omnitwin/credit-runner credit-runner clean ${task.id}\``,
      );
      continue;
    }
    if (!canAfford(spent, task.budgetUsd, options.capUsd)) {
      notRun.push(`${task.id}: its ${usd(task.budgetUsd)} budget does not fit; ${usd(spent)} of the ${usd(options.capUsd)} nightly cap is spent`);
      continue;
    }
    const org = orgs.find((state) => state.status === "ready");
    if (org === undefined) {
      notRun.push(`${task.id}: no billing org is ready (${orgs.map((state) => `${state.org.name}: ${describeOrg(state)}`).join("; ")})`);
      continue;
    }
    if (options.dryRun) {
      options.log(
        `would run ${task.id} on ${org.org.name}: ${task.model}, effort ${task.effort}, budget ${usd(task.budgetUsd)}, ${String(task.timeoutMinutes)} min; ${usd(spent)} of ${usd(options.capUsd)} committed so far`,
      );
      spent += task.budgetUsd;
      continue;
    }

    options.log(`▶ ${task.id} on ${org.org.name} (budget ${usd(task.budgetUsd)}, worktree ${worktree})`);
    const marker: Inflight = {
      night,
      taskId: task.id,
      title: task.title,
      branch,
      worktree,
      baseRef: task.base ?? config.baseRef,
      model: task.model,
      effort: task.effort,
      budgetUsd: task.budgetUsd,
      startedAt: options.now().toISOString(),
    };
    await writeFile(paths.inflight, JSON.stringify(marker), "utf8");
    const record = new TaskRecord(task, branch, worktree, night, marker.baseRef, paths.logDir, options.now);
    let entry: LedgerEntry;
    try {
      entry = await runTask({ options, task, branch, worktree, paths, orgs, keys, record });
    } catch (error) {
      record.reasons.push(`the runner hit an error: ${describeError(error)}`);
      entry = record.entry("error");
    }
    await appendLedger(paths.ledger, entry);
    await rm(paths.inflight, { force: true });
    allEntries.push(entry);
    ran.push(entry);
    spent += entry.costUsd;
    if (entry.outcome === "aborted") aborted = true;
    options.log(`  ${entry.outcome} · ${usd(entry.costUsd)} · ${String(entry.turns)} turns · acceptance ${entry.acceptance.status}`);
    await writeReport();
  }

  await writeReport();
  return { night, reportFile: options.dryRun ? null : paths.report, ran, notRun, problems, aborted };
}

/** Everything one task's ledger line is built from, filled in as the task goes. */
class TaskRecord {
  readonly reasons: string[] = [];
  readonly attempts: Attempt[] = [];
  readonly violations: string[] = [];
  readonly startedAt: string;
  baseSha = "";
  branchState: BranchState = { commits: [], filesChanged: [], filesDeleted: [], dirtyFiles: [] };
  acceptance: AcceptanceResult;
  last: ClaudeRunOutcome | null = null;

  constructor(
    private readonly task: Task,
    private readonly branch: string,
    private readonly worktree: string,
    private readonly night: string,
    private readonly baseRef: string,
    private readonly logDir: string,
    private readonly now: () => Date,
  ) {
    this.startedAt = now().toISOString();
    this.acceptance = { command: task.acceptance, status: "not-run", exitCode: null, durationMs: 0, tail: "" };
  }

  spentUsd(): number {
    return this.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
  }

  entry(outcome: Outcome): LedgerEntry {
    return {
      night: this.night,
      taskId: this.task.id,
      title: this.task.title,
      startedAt: this.startedAt,
      finishedAt: this.now().toISOString(),
      outcome,
      reasons: [...this.reasons],
      branch: this.branch,
      baseRef: this.baseRef,
      baseSha: this.baseSha,
      worktree: this.worktree,
      model: this.task.model,
      effort: this.task.effort,
      budgetUsd: this.task.budgetUsd,
      attempts: [...this.attempts],
      costUsd: this.spentUsd(),
      turns: this.attempts.reduce((sum, attempt) => sum + attempt.turns, 0),
      acceptance: this.acceptance,
      commits: [...this.branchState.commits],
      filesChanged: [...this.branchState.filesChanged],
      dirtyFiles: [...this.branchState.dirtyFiles],
      violations: [...this.violations],
      summary: extractSummary(this.last?.result?.result),
      logDir: this.logDir,
    };
  }
}

interface TaskRun {
  readonly options: NightOptions;
  readonly task: Task;
  readonly branch: string;
  readonly worktree: string;
  readonly paths: NightPaths;
  readonly orgs: OrgState[];
  readonly keys: ReadonlyMap<string, string>;
  readonly record: TaskRecord;
}

function toAttempt(org: Org, sessionId: string, attemptBudgetUsd: number, run: ClaudeRunOutcome): Attempt {
  // A run that never reported its cost (timeout, crash, Ctrl+C) is charged its
  // whole budget, so the nightly cap can only over-count. Two cases are known to
  // cost nothing: the API refusing the org (empty balance, bad key), and the
  // credential check, which stops a run before its first model request.
  const knownFree = run.credentialMismatch !== null || run.stop !== null;
  return {
    orgId: org.id,
    orgName: org.name,
    sessionId,
    apiKeySource: run.init?.apiKeySource ?? null,
    model: run.init?.model ?? null,
    costUsd: run.result?.total_cost_usd ?? (knownFree ? 0 : attemptBudgetUsd),
    costKnown: run.result !== null || knownFree,
    turns: run.result?.num_turns ?? 0,
    durationMs: run.result?.duration_ms ?? run.durationMs,
    subtype: run.result?.subtype ?? null,
    isError: run.result?.is_error ?? true,
    stop: run.stop,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    killedReason: run.killedReason,
    permissionDenials: (run.result?.permission_denials ?? []).map((denial) => denial.tool_name),
  };
}

async function runAcceptance(task: Task, worktree: string, env: ChildEnv, logFile: string, timeoutMs: number): Promise<AcceptanceResult> {
  const result = await runProcess({ command: task.acceptance, args: [], shell: true, cwd: worktree, env, timeoutMs, logFile });
  const stderr = result.stderrTail === "" ? "" : `\n[stderr]\n${result.stderrTail}`;
  return {
    command: task.acceptance,
    status: result.timedOut ? "timeout" : result.exitCode === 0 ? "pass" : "fail",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    tail: `${result.stdoutTail}${stderr}`.slice(-2500),
  };
}

/**
 * A task's own Claude config folder. Before every attempt everything but the
 * session transcripts (needed to resume) is removed, so nothing an earlier run
 * wrote there (settings, an env override, a login) can steer this one.
 */
async function prepareConfigDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) {
    if (name !== "projects") await rm(path.join(dir, name), { recursive: true, force: true });
  }
}

async function runTask(run: TaskRun): Promise<LedgerEntry> {
  const { options, task, branch, worktree, paths, record } = run;
  const { config } = options;
  const toolEnv = toolChildEnv(options.parentEnv, config.passEnv);
  const logFile = (suffix: string): string => path.join(paths.logDir, `${task.id}.${suffix}`);
  const secrets = [...run.keys.values()];

  // 1. A fresh worktree on its own branch, from the freshly fetched base.
  try {
    record.baseSha = (await prepareWorktree(options.repoRoot, worktree, branch, task.base ?? config.baseRef)).baseSha;
  } catch (error) {
    record.reasons.push(`could not create the worktree: ${describeError(error)}`);
    return record.entry("setup-failed");
  }

  // 2. Dependencies, before any money is spent.
  if (task.install) {
    options.log("  installing dependencies…");
    const install = await runProcess({
      command: "pnpm install --frozen-lockfile --prefer-offline",
      args: [],
      shell: true,
      cwd: worktree,
      env: toolEnv,
      timeoutMs: options.installTimeoutMs ?? 30 * 60_000,
      logFile: logFile("install.log"),
    });
    if (install.exitCode !== 0) {
      record.reasons.push(`pnpm install failed (exit ${String(install.exitCode)}${install.timedOut ? ", timed out" : ""}); see ${task.id}.install.log`);
      return record.entry("setup-failed");
    }
  }

  // 3. Snapshots the runner compares afterwards, whatever the agent reports.
  let refsBefore: ReadonlyMap<string, string> | null = null;
  try {
    refsBefore = await remoteRefs(options.repoRoot);
  } catch (error) {
    record.reasons.push(`could not list origin's refs before the run, so pushes cannot be checked: ${describeError(error)}`);
  }
  const integrityBefore = await gitIntegrity(options.repoRoot);

  // 4. The agent. Credit that expires first pays first; when an org runs dry the
  //    same session resumes on the next org, so no work is lost.
  // A failure to derive the rules (nightRulesFromAgentsMd refusing text that
  // names deploy-secrets) stops the task before any spend.
  const agentsMd = await readFile(path.join(worktree, "AGENTS.md"), "utf8").catch(() => null);
  const projectRules = agentsMd === null ? null : nightRulesFromAgentsMd(agentsMd);
  const systemPromptFile = logFile("system-prompt.md");
  await writeFile(systemPromptFile, buildSystemPrompt({ task, branch, worktree, baseRef: task.base ?? config.baseRef, baseSha: record.baseSha }, projectRules), "utf8");
  const configDir = path.join(paths.claudeConfigRoot, task.id);

  const deadline = Date.now() + task.timeoutMinutes * 60_000;
  let sessionId = randomUUID();
  let sessionStarted = false;
  let stopped = false;
  let aborted = false;
  for (;;) {
    const state = run.orgs.find((candidate) => candidate.status === "ready");
    const key = state === undefined ? undefined : run.keys.get(state.org.id);
    if (state === undefined || key === undefined) {
      stopped = true;
      record.reasons.push("no billing org with credit is left");
      break;
    }
    const budget = task.budgetUsd - record.spentUsd();
    const timeLeft = deadline - Date.now();
    if (budget < 0.05) {
      record.reasons.push("the task budget was used up");
      break;
    }
    if (timeLeft < 60_000) {
      record.reasons.push("the time limit was reached");
      break;
    }
    if (!sessionStarted) sessionId = randomUUID();
    await prepareConfigDir(configDir);

    options.log(`  claude on ${state.org.name}${sessionStarted ? " (resuming)" : ""}…`);
    const outcome = await runClaude({
      command: config.claudeCommand,
      args: buildClaudeArgs({
        model: task.model,
        effort: task.effort,
        budgetUsd: budget,
        allowedTools: task.allowedTools,
        readOnly: task.readOnly,
        settingsFile: options.settingsFile,
        systemPromptFile,
        session: { kind: sessionStarted ? "resume" : "new", id: sessionId },
      }),
      cwd: worktree,
      env: claudeChildEnv(options.parentEnv, key, configDir, config.passEnv),
      secrets,
      prompt: sessionStarted ? RESUME_PROMPT : buildUserPrompt(task),
      timeoutMs: timeLeft,
      logFile: logFile("claude.jsonl"),
    });
    record.last = outcome;
    record.attempts.push(toAttempt(state.org, sessionId, budget, outcome));
    if (outcome.init !== null) sessionStarted = true;

    if (outcome.credentialMismatch !== null) {
      aborted = true;
      record.reasons.push(
        `killed at start: the run reported credential '${outcome.credentialMismatch}' instead of the org's API key, so it could have billed the Max plan`,
      );
      break;
    }
    if (outcome.stop === "credit-exhausted") {
      state.status = "out of credit";
      record.reasons.push(`${state.org.name} ran out of credit`);
      continue;
    }
    if (outcome.stop === "auth-failed") {
      state.status = "key rejected";
      record.reasons.push(`${state.org.name} rejected its API key`);
      continue;
    }
    if (outcome.timedOut) {
      record.reasons.push(`the agent was stopped at the ${String(task.timeoutMinutes)} min time limit; its cost is counted as its full budget`);
    } else if (outcome.result === null) {
      const tail = outcome.stderrTail.trim().slice(-300);
      record.reasons.push(`claude exited ${String(outcome.exitCode)} without a result; its cost is counted as its full budget${tail === "" ? "" : `: ${tail}`}`);
    } else if (outcome.result.is_error) {
      record.reasons.push(`the agent ended with '${outcome.result.subtype}'`);
    }
    break;
  }

  // 5. What actually happened, checked by the runner rather than reported by the agent.
  try {
    record.branchState = await inspectBranch(worktree, record.baseSha);
  } catch (error) {
    record.reasons.push(`could not inspect the branch: ${describeError(error)}`);
  }
  const { filesChanged, filesDeleted, dirtyFiles, commits } = record.branchState;
  record.violations.push(...protectedPathViolations([...filesChanged, ...dirtyFiles]));
  for (const file of deletedTests(filesDeleted)) record.violations.push(`${file} (test file deleted)`);
  try {
    for (const file of await findKeyShapedStrings(worktree, record.baseSha, dirtyFiles)) {
      record.violations.push(`${file} (holds a string shaped like an Anthropic API key)`);
    }
  } catch (error) {
    record.reasons.push(`the key scan failed: ${describeError(error)}`);
  }
  if (refsBefore !== null) {
    try {
      const moved = changedRefs(refsBefore, await remoteRefs(options.repoRoot));
      if (moved.length > 0) record.violations.push(`origin changed during the run: ${moved.join(", ")}`);
    } catch (error) {
      record.reasons.push(`the push check could not reach origin: ${describeError(error)}`);
    }
  }
  if ((await gitIntegrity(options.repoRoot)) !== integrityBefore) {
    record.violations.push("the shared .git config or hooks changed during the run; check them before running git anywhere");
  }
  if (task.readOnly && (commits.length > 0 || dirtyFiles.length > 0)) {
    record.violations.push("a read-only task changed the branch or the working tree");
  }

  // 6. The acceptance command, run by the runner in a fresh process with no API key.
  if (!aborted) {
    options.log("  running the acceptance command…");
    record.acceptance = await runAcceptance(task, worktree, toolEnv, logFile("acceptance.log"), options.acceptanceTimeoutMs ?? 30 * 60_000);
  }

  // A pass needs the agent to have finished cleanly as well as a green
  // acceptance run: a timed-out or errored agent may have left work half done
  // that the acceptance command does not cover.
  const finished = record.last !== null && record.last.result !== null && !record.last.result.is_error && !record.last.timedOut;
  if (aborted) return record.entry("aborted");
  if (record.violations.length > 0) return record.entry("rejected");
  if (stopped || record.attempts.length === 0) return record.entry("stopped");
  if (record.acceptance.status !== "pass") {
    record.reasons.push("the acceptance command did not pass");
    return record.entry("fail");
  }
  if (dirtyFiles.length > 0) {
    record.reasons.push("the agent left uncommitted changes, so the branch is not what passed");
    return record.entry("fail");
  }
  if (!task.readOnly && commits.length === 0) {
    record.reasons.push("no commits: the branch is unchanged");
    return record.entry("fail");
  }
  if (!finished) {
    record.reasons.push("acceptance passed, but the agent did not finish cleanly; review the branch before trusting it");
    return record.entry("fail");
  }
  return record.entry("pass");
}

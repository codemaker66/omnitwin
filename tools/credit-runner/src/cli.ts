import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { localDate, usd } from "./budget.js";
import { loadConfig } from "./config.js";
import { branchExists, git, removeRun } from "./git.js";
import { readLedger, spentByOrg, spentOn } from "./ledger.js";
import { assessOrgs, nightPaths, runNight } from "./night.js";
import { describeError, loadQueue } from "./task.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `credit-runner: spends VenViewer's Console API credits on queued coding tasks.

From the repo root:
  pnpm --filter @omnitwin/credit-runner night [--only <id>]... [--dry-run] [--cap <usd>]
  pnpm --filter @omnitwin/credit-runner status
  pnpm --filter @omnitwin/credit-runner credit-runner clean <id>

Options:
  --only <id>      run only this task (repeatable); runs it even when enabled: false
  --dry-run        show what would run, on which org and budget; spends nothing
  --cap <usd>      tonight's total cap (default: nightlyCapUsd in credit-runner.config.json)
  --config <file>  config file (default: tools/credit-runner/credit-runner.config.json)
  --queue <dir>    task folder (default: tools/credit-runner/queue)
`;

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    // pnpm may forward a literal "--" before script arguments.
    args: argv.filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      only: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
      cap: { type: "string" },
      config: { type: "string" },
      queue: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0] ?? "run";
  if (values.help === true || !["run", "status", "clean"].includes(command)) {
    out(USAGE);
    return values.help === true ? 0 : 1;
  }

  const config = await loadConfig(values.config ?? path.join(PACKAGE_DIR, "credit-runner.config.json"));
  const queueDir = path.resolve(values.queue ?? path.join(PACKAGE_DIR, "queue"));
  const repoRoot = await git(PACKAGE_DIR, ["rev-parse", "--show-toplevel"]);

  if (command === "clean") {
    const id = positionals[1];
    if (id === undefined) {
      out("clean needs a task id, e.g. clean smoke-readonly");
      return 1;
    }
    const branch = `${config.branchPrefix}${id}`;
    await removeRun(repoRoot, path.join(config.runsRoot, id), branch, config.branchPrefix);
    out(`Removed the worktree and branch ${branch}. The task will run again on the next night.`);
    return 0;
  }

  const night = localDate(new Date());
  if (command === "status") {
    const orgs = await assessOrgs(config, night);
    const ledger = await readLedger(nightPaths(config, night).ledger);
    const byOrg = spentByOrg(ledger.entries);
    out("Billing orgs, spent in this order:");
    for (const state of orgs) {
      const grant = state.org.grantUsd === undefined ? "" : ` of ${usd(state.org.grantUsd)}`;
      const detail = state.detail === null ? "" : ` (${state.detail})`;
      out(`  ${state.org.name}: ${state.status}${detail}; expires ${state.org.expires ?? "never"}; runner spend ${usd(byOrg.get(state.org.id) ?? 0)}${grant}`);
    }
    out(`Tonight (${night}): ${usd(spentOn(ledger.entries, night))} of the ${usd(config.nightlyCapUsd)} cap spent`);
    const queue = await loadQueue(queueDir);
    out(`Queue (${queueDir}):`);
    for (const task of queue.tasks) {
      const ran = await branchExists(repoRoot, `${config.branchPrefix}${task.id}`);
      out(`  ${task.id}: ${task.enabled ? "enabled" : "disabled"}, ${usd(task.budgetUsd)}, ${task.model}, ${ran ? "already ran" : "waiting"}`);
    }
    for (const problem of queue.problems) out(`  ! ${path.basename(problem.file)}: ${problem.message}`);
    return 0;
  }

  let capUsd = config.nightlyCapUsd;
  if (values.cap !== undefined) {
    capUsd = Number(values.cap);
    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      out(`--cap must be a positive number of dollars, got '${values.cap}'`);
      return 1;
    }
  }

  let stopRequested = false;
  process.on("SIGINT", () => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    out("Ctrl+C: no further tasks will start. Press Ctrl+C again to quit at once.");
  });

  const result = await runNight({
    config,
    repoRoot,
    queueDir,
    settingsFile: path.join(PACKAGE_DIR, "runner-settings.json"),
    only: values.only ?? [],
    dryRun: values["dry-run"] === true,
    capUsd,
    parentEnv: process.env,
    now: () => new Date(),
    log: out,
    shouldStop: () => stopRequested,
  });

  for (const line of result.notRun) out(`not run: ${line}`);
  for (const line of result.problems) out(`problem: ${line}`);
  if (result.reportFile !== null) out(`Report: ${result.reportFile}`);
  return result.aborted ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`credit-runner: ${describeError(error)}\n`);
    process.exitCode = 1;
  },
);

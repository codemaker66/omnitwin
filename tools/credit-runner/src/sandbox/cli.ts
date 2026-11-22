import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { expandHome } from "../config.js";
import { keyFileExposure, keyFilePresent, readKey } from "../keys.js";
import { describeError, parseTask } from "../task.js";
import { sdkSandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { ledgerHasSession, readCreditLedger, spent } from "./credit-ledger.js";
import { collectSandboxJob, runSandboxJob } from "./launcher.js";
import { masterFacts } from "./master.js";
import { budgetOverride, boundedNumber, timeoutOverride } from "./overrides.js";
import { sandboxConfigSchema } from "./sandbox-config.js";
import { ensureSandbox, readState } from "./setup.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const USAGE = `credit-runner sandbox: runs one spec per Claude Managed Agents session in
Anthropic's cloud sandbox, and brings back a patch for review. No agent code runs
on the machine it is run from.

From the repo root:
  pnpm --filter @omnitwin/credit-runner sandbox status
  pnpm --filter @omnitwin/credit-runner sandbox setup
  pnpm --filter @omnitwin/credit-runner sandbox run <spec.md> --job <label> [--budget <usd>] [--timeout <min>] [--night-cap <usd>]
  pnpm --filter @omnitwin/credit-runner sandbox collect <session-id> <spec.md> --run-dir <dir> --base <sha> [--budget <usd>]
      rebuilds a finished session's record and review from its history; starts and charges nothing

Options:
  --job <label>      groups runs in the credit ledger, e.g. a4-trial or night-2026-11-06
  --budget <usd>     the session's hard spend cap, at most 50 (default: the spec's budget_usd); on collect,
                     what a session whose cost cannot be read is counted at
  --timeout <min>    interrupt the agent after this many whole minutes, at most 240 (default: the spec's)
  --night-cap <usd>  refuse the run if this job's spend so far plus its budget passes this
  --config <file>    default: tools/credit-runner/sandbox.config.json (copy the .example.json
                     beside it and fill in your own paths, the real file is git-ignored)
`;

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

/** The cost as the ledger holds it: an unreadable cost is the whole budget, and says so. */
function costText(record: { readonly costUsd: number; readonly costKnown: boolean }): string {
  return `$${record.costUsd.toFixed(2)}${record.costKnown ? "" : " (unknown: counted at the whole budget, or the last figure if higher)"}`;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      job: { type: "string" },
      budget: { type: "string" },
      timeout: { type: "string" },
      "night-cap": { type: "string" },
      "run-dir": { type: "string" },
      base: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help === true || command === undefined || !["status", "setup", "run", "collect"].includes(command)) {
    out(USAGE);
    return values.help === true ? 0 : 1;
  }

  const raw = sandboxConfigSchema.parse(JSON.parse(await readFile(values.config ?? path.join(PACKAGE_DIR, "sandbox.config.json"), "utf8")));
  const config = { ...raw, workRoot: path.resolve(expandHome(raw.workRoot)), ledgerFile: path.resolve(expandHome(raw.ledgerFile)) };
  const keyFile = path.join(path.resolve(expandHome(raw.keyDir)), raw.keyFile);
  const stateFile = path.join(config.workRoot, "state.json");

  if (command === "status") {
    const present = await keyFilePresent(keyFile);
    out(`Key file ${keyFile}: ${present ? "present" : "missing"}${present ? `, ${(await keyFileExposure(keyFile)).join("; ") || "private"}` : ""}`);
    const state = await readState(stateFile);
    out(state === null ? "Sandbox: not set up" : `Sandbox: environment ${state.environmentId}, agent ${state.agentId} v${String(state.agentVersion)}`);
    const ledger = await readCreditLedger(config.ledgerFile);
    out(
      `Spend: lane '${config.lane}' $${spent(ledger.lines, (line) => line.lane === config.lane).toFixed(2)} of $${config.laneCapUsd.toFixed(2)}; all lanes $${spent(ledger.lines).toFixed(2)} of $${config.orgCapUsd.toFixed(2)}${ledger.badLines > 0 ? `; ${String(ledger.badLines)} unreadable line(s)` : ""}`,
    );
    return 0;
  }

  if (!(await keyFilePresent(keyFile))) throw new Error(`no key file at ${keyFile}; store one with setup-keys.ps1`);
  const exposure = await keyFileExposure(keyFile);
  if (exposure.length > 0) throw new Error(`${keyFile} is not private: ${exposure.join("; ")}`);
  const api = sdkSandboxApi(await readKey(keyFile));

  if (command === "setup") {
    const { projectRules } = await masterFacts();
    const state = await ensureSandbox(api, stateFile, sandboxSystemPrompt(projectRules), out);
    out(`Ready: environment ${state.environmentId}, agent ${state.agentId} v${String(state.agentVersion)}.`);
    return 0;
  }

  if (command === "collect") {
    const sessionId = positionals[1];
    const spec = positionals[2];
    const runDir = values["run-dir"];
    const base = values.base;
    if (sessionId === undefined || spec === undefined || runDir === undefined || base === undefined || !/^[0-9a-f]{40}$/u.test(base)) {
      throw new Error("collect needs <session-id> <spec.md> --run-dir <dir> --base <40-hex sha>");
    }
    const task = parseTask(await readFile(spec, "utf8"), path.resolve(spec));
    const record = await collectSandboxJob({
      api,
      task,
      sessionId,
      runDir: path.resolve(runDir),
      baseSha: base,
      budgetUsd: budgetOverride(values.budget),
      log: out,
    });
    // collect writes no ledger line; whether the run left one is looked up, not assumed (a launcher that died leaves none).
    const charged = (await ledgerHasSession(config.ledgerFile, sessionId))
      ? "the ledger has a line for this session; collect added nothing"
      : "the ledger has NO line for this session (its launcher may have died), and collect added none";
    out(`${record.review.verdict}: ${costText(record)} (${charged}); review at ${path.join(record.runDir, "review.md")}`);
    return record.review.verdict === "ready-for-review" ? 0 : 2;
  }

  const specFile = positionals[1];
  if (specFile === undefined || values.job === undefined) throw new Error("run needs a spec file and --job <label>");
  const task = parseTask(await readFile(specFile, "utf8"), path.resolve(specFile));
  const { baseSha, projectRules } = await masterFacts();
  const verifyScript = await readFile(path.join(PACKAGE_DIR, "sandbox", "verify.mjs"), "utf8");
  const record = await runSandboxJob({
    api,
    config,
    task,
    job: values.job,
    budgetUsd: budgetOverride(values.budget) ?? task.budgetUsd,
    timeoutMinutes: timeoutOverride(values.timeout) ?? task.timeoutMinutes,
    nightCapUsd: boundedNumber(values["night-cap"], "--night-cap"),
    baseSha,
    projectRules,
    verifyScript,
    log: out,
  });
  if (record.kind === "skipped") {
    out(`Not run: ${record.reason}`);
    return 1;
  }
  out(`${record.review.verdict}: ${costText(record)}; review at ${path.join(record.runDir, "review.md")}`);
  return record.review.verdict === "ready-for-review" ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`credit-runner sandbox: ${describeError(error)}\n`);
    process.exitCode = 1;
  },
);

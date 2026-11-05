import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { expandHome } from "../config.js";
import { git } from "../git.js";
import { keyFileExposure, keyFilePresent, readKey } from "../keys.js";
import { nightRulesFromAgentsMd } from "../project-rules.js";
import { describeError, parseTask } from "../task.js";
import { sdkSandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { readCreditLedger, spent } from "./credit-ledger.js";
import { runSandboxJob } from "./launcher.js";
import { ensureSandbox, readState } from "./setup.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const USAGE = `credit-runner sandbox: runs one spec per Claude Managed Agents session in
Anthropic's cloud sandbox, and brings back a patch for review. No agent code runs
on this PC.

From the repo root:
  pnpm --filter @omnitwin/credit-runner sandbox status
  pnpm --filter @omnitwin/credit-runner sandbox setup
  pnpm --filter @omnitwin/credit-runner sandbox run <spec.md> --job <label> [--budget <usd>] [--timeout <min>] [--night-cap <usd>]

Options:
  --job <label>      groups runs in the credit ledger, e.g. a4-trial or night-2026-11-06
  --budget <usd>     the session's hard spend cap (default: the spec's budget_usd)
  --timeout <min>    interrupt the agent after this (default: the spec's timeout_minutes)
  --night-cap <usd>  refuse the run if this job's spend so far plus its budget passes this
  --config <file>    default: tools/credit-runner/sandbox.config.json
`;

const configSchema = z
  .object({
    workRoot: z.string().min(1),
    ledgerFile: z.string().min(1),
    keyDir: z.string().min(1),
    keyFile: z.string().regex(/^[\w.-]+$/u),
    lane: z.string().min(1),
    laneCapUsd: z.number().positive(),
    orgCapUsd: z.number().positive(),
  })
  .strict();

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function positiveNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

/** The base every run starts from, and AGENTS.md at that commit. */
async function masterFacts(repoRoot: string): Promise<{ baseSha: string; projectRules: string }> {
  await git(repoRoot, ["fetch", "--quiet", "origin", "master"]);
  const baseSha = await git(repoRoot, ["rev-parse", "origin/master"]);
  const agentsMd = await git(repoRoot, ["show", `${baseSha}:AGENTS.md`]);
  return { baseSha, projectRules: nightRulesFromAgentsMd(agentsMd) };
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
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help === true || command === undefined || !["status", "setup", "run"].includes(command)) {
    out(USAGE);
    return values.help === true ? 0 : 1;
  }

  const raw = configSchema.parse(JSON.parse(await readFile(values.config ?? path.join(PACKAGE_DIR, "sandbox.config.json"), "utf8")));
  const config = { ...raw, workRoot: path.resolve(expandHome(raw.workRoot)), ledgerFile: path.resolve(expandHome(raw.ledgerFile)) };
  const keyFile = path.join(path.resolve(expandHome(raw.keyDir)), raw.keyFile);
  const stateFile = path.join(config.workRoot, "state.json");
  const repoRoot = await git(PACKAGE_DIR, ["rev-parse", "--show-toplevel"]);

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
    const { projectRules } = await masterFacts(repoRoot);
    const state = await ensureSandbox(api, stateFile, sandboxSystemPrompt(projectRules), out);
    out(`Ready: environment ${state.environmentId}, agent ${state.agentId} v${String(state.agentVersion)}.`);
    return 0;
  }

  const specFile = positionals[1];
  if (specFile === undefined || values.job === undefined) throw new Error("run needs a spec file and --job <label>");
  const task = parseTask(await readFile(specFile, "utf8"), path.resolve(specFile));
  const { baseSha, projectRules } = await masterFacts(repoRoot);
  const verifyScript = await readFile(path.join(PACKAGE_DIR, "sandbox", "verify.mjs"), "utf8");
  const record = await runSandboxJob({
    api,
    config,
    task,
    job: values.job,
    budgetUsd: positiveNumber(values.budget, "--budget") ?? task.budgetUsd,
    timeoutMinutes: positiveNumber(values.timeout, "--timeout") ?? task.timeoutMinutes,
    nightCapUsd: positiveNumber(values["night-cap"], "--night-cap"),
    baseSha,
    projectRules,
    verifyScript,
    log: out,
  });
  if (record.kind === "skipped") {
    out(`Not run: ${record.reason}`);
    return 1;
  }
  out(`${record.review.verdict}: $${record.costUsd.toFixed(2)}; review at ${path.join(record.runDir, "review.md")}`);
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

import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { expandHome } from "../config.js";
import { git } from "../git.js";
import { keyFileExposure, keyFilePresent, readKey } from "../keys.js";
import { describeError, parseTask } from "../task.js";
import { type SandboxApi, sdkSandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { readCreditLedger, spent } from "./credit-ledger.js";
import { bookCommand, bookSession, collectSandboxJob, runSandboxJob, sessionIsBooked, unbookedSessions, unbookedText } from "./launcher.js";
import { masterFacts } from "./master.js";
import { budgetOverride, boundedNumber, timeoutOverride } from "./overrides.js";
import { gitVersionProblem } from "./patches.js";
import { sandboxConfigSchema } from "./sandbox-config.js";
import { ensureSandbox, readState } from "./setup.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");

/** Whether `child` is `parent` or inside it (both already real paths; Windows compares without case). */
export function isInsideFolder(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  // A child named "..keys" is inside; ".." and "..\x" are not, and neither is another drive (an absolute relative path).
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** The real path, through junctions and symlinks, of a folder that may not exist yet: its nearest existing ancestor's, with the rest appended. */
async function realPathOf(folder: string): Promise<string> {
  const rest: string[] = [];
  for (let current = path.resolve(folder); ; ) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Whether `folder` or any folder above it holds a `.git` entry: a checkout's folder, or the file a linked worktree or submodule has. */
async function gitEntryAbove(folder: string): Promise<boolean> {
  for (let current = folder; ; ) {
    try {
      await lstat(path.join(current, ".git"));
      return true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Said in the usage and printed at the start of every `run`: the launcher is
 * not safe to schedule until the conveyor's ledger reserves a budget before the
 * session starts.
 */
export const ATTENDED = `Run it by hand and attended until the night-shift conveyor's ledger v2 lands. A run
books its session once, after stopping it and reading its cost. Ctrl-C, a kill or Ctrl-Break does
the same: it interrupts the session, waits for it or archives it, and books it; a second one, or
closing the window, books the session at once at its whole budget as unknown and exits. A
launcher that dies without a signal (a crash, a forced kill) leaves its session unbooked: \`run\`
then refuses, and \`status\` warns, until \`sandbox collect <session-id> --book\` books it. Nothing
locks the check-then-spend step, so two launchers started at once can both pass the spend check.
Do not schedule or loop \`sandbox run\`.`;

export const USAGE = `credit-runner sandbox: runs one spec per Claude Managed Agents session in
Anthropic's cloud sandbox, and brings back a patch for review. No agent code runs
on the machine it is run from. Each \`run\` spends up to one session budget.

${ATTENDED}

From the repo root:
  pnpm --filter @omnitwin/credit-runner sandbox status
  pnpm --filter @omnitwin/credit-runner sandbox setup
  pnpm --filter @omnitwin/credit-runner sandbox run <spec.md> --job <label> [--budget <usd>] [--timeout <min>] [--job-cap <usd>]
  pnpm --filter @omnitwin/credit-runner sandbox collect <session-id> --book [--budget <usd>]
      books a session of this lane that the ledger has no line for: the platform's figure once it
      has stopped, else its whole budget as unknown; adds nothing when a line exists
  pnpm --filter @omnitwin/credit-runner sandbox collect <session-id> <spec.md> --run-dir <dir> --base <sha> [--budget <usd>] [--book]
      rebuilds a finished session's record and review from its history; starts nothing, and books
      nothing unless --book is given

Options:
  --job <label>      groups runs in the credit ledger, e.g. trial-1
  --budget <usd>     the session's hard spend cap, at most 50 (default: the spec's budget_usd); on collect,
                     what a session whose cost cannot be read is counted at (with --book, only when the
                     platform reports no budget for the session)
  --book             on collect: book the session if the ledger has no line for it
  --timeout <min>    interrupt the agent after this many whole minutes, at most 240 (default: the spec's)
  --job-cap <usd>    refuse the run if the spend so far under this --job label plus its budget
                     passes this
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

/**
 * The CLI. `seams.api`, a test seam, is used in place of the client built from
 * the key file: no key folder is checked and no key read.
 */
export async function main(argv: readonly string[], seams: { readonly api?: SandboxApi } = {}): Promise<number> {
  // The parser would refuse it too, but only as an unknown option: an old script learns what replaced it.
  if (argv.some((arg) => arg === "--night-cap" || arg.startsWith("--night-cap="))) {
    throw new Error("--night-cap was renamed to --job-cap, the cap on the spend under one --job label; nothing was run");
  }
  const { values, positionals } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      job: { type: "string" },
      budget: { type: "string" },
      timeout: { type: "string" },
      "job-cap": { type: "string" },
      "run-dir": { type: "string" },
      base: { type: "string" },
      book: { type: "boolean" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help === true || command === undefined || !["status", "setup", "run", "collect"].includes(command)) {
    out(USAGE);
    return values.help === true ? 0 : 1;
  }
  // Said before anything is read or spent, so it is seen even when the run then fails.
  if (command === "run") out(`${ATTENDED}\n`);

  const raw = sandboxConfigSchema.parse(JSON.parse(await readFile(values.config ?? path.join(PACKAGE_DIR, "sandbox.config.json"), "utf8")));
  const config = { ...raw, workRoot: path.resolve(expandHome(raw.workRoot)), ledgerFile: path.resolve(expandHome(raw.ledgerFile)) };
  const keyDir = path.resolve(expandHome(raw.keyDir));
  const keyFile = path.join(keyDir, raw.keyFile);
  const stateFile = path.join(config.workRoot, "state.json");
  // A key folder in the repository, or in any git work tree, is one careless `git add` from a public record.
  // Both where the folder really is and the path as written are checked: a link can lead into a work tree, or out of one.
  const keyDirReal = await realPathOf(keyDir);
  const keyDirProblem = isInsideFolder(keyDirReal, await realPathOf(REPO_ROOT))
    ? `the key folder ${keyDir} is inside the repository; keep it outside (keyDir in the config, -KeyDir for setup-keys.ps1)`
    : (await gitEntryAbove(keyDirReal)) || (await gitEntryAbove(keyDir))
      ? `the key folder ${keyDir} is inside a git work tree (a .git in it or a folder above it); keep it outside every repository (keyDir in the config, -KeyDir for setup-keys.ps1)`
      : null;

  if (command === "status") {
    const present = await keyFilePresent(keyFile);
    if (keyDirProblem !== null) out(`Warning: ${keyDirProblem}`);
    out(`Key file ${keyFile}: ${present ? "present" : "missing"}${present ? `, ${(await keyFileExposure(keyFile)).join("; ") || "private"}` : ""}`);
    const state = await readState(stateFile);
    out(state === null ? "Sandbox: not set up" : `Sandbox: environment ${state.environmentId}, agent ${state.agentId} v${String(state.agentVersion)}`);
    const ledger = await readCreditLedger(config.ledgerFile);
    out(
      `Spend: lane '${config.lane}' $${spent(ledger.lines, (line) => line.lane === config.lane).toFixed(2)} of $${config.laneCapUsd.toFixed(2)}; all lanes $${spent(ledger.lines).toFixed(2)} of $${config.orgCapUsd.toFixed(2)}${ledger.badLines > 0 ? `; ${String(ledger.badLines)} unreadable line(s)` : ""}`,
    );
    // The startup check `run` makes, without refusing: this lane's sessions that no ledger line charges. It needs the key to list them.
    const listingApi = async (): Promise<SandboxApi | string> => {
      if (seams.api !== undefined) return seams.api;
      if (keyDirProblem !== null) return keyDirProblem;
      if (!present) return `no key file at ${keyFile}`;
      if ((await keyFileExposure(keyFile)).length > 0) return `${keyFile} is not private`;
      try {
        return sdkSandboxApi(await readKey(keyFile));
      } catch (error) {
        return describeError(error);
      }
    };
    const listing = await listingApi();
    if (typeof listing === "string") out(`Unbooked sessions: not checked (${listing})`);
    else {
      try {
        const found = await unbookedSessions(listing, config.ledgerFile, config.lane, new Date());
        if (found.sessions.length === 0) out(`Unbooked sessions: none of lane '${config.lane}' since ${found.since}`);
        for (const session of found.sessions) out(`Warning: ${unbookedText(session)}; run refuses until it is booked`);
      } catch (error) {
        out(`Unbooked sessions: not checked (listing the sessions failed: ${describeError(error)})`);
      }
    }
    // The review runs on this machine's git: one too old for it rejects every run, after the session is paid for.
    const gitVersion = await git(tmpdir(), ["--version"]).catch((error: unknown) => `git --version failed: ${error instanceof Error ? error.message : String(error)}`);
    const gitProblem = gitVersionProblem(gitVersion);
    out(gitProblem === null ? `Git: ${gitVersion.replace(/^git version /u, "")} (the review needs 2.41 or newer)` : `Warning: ${gitProblem}`);
    return 0;
  }

  const keyedApi = async (): Promise<SandboxApi> => {
    if (keyDirProblem !== null) throw new Error(keyDirProblem);
    if (!(await keyFilePresent(keyFile))) throw new Error(`no key file at ${keyFile}; store one with setup-keys.ps1`);
    const exposure = await keyFileExposure(keyFile);
    if (exposure.length > 0) throw new Error(`${keyFile} is not private: ${exposure.join("; ")}`);
    return sdkSandboxApi(await readKey(keyFile));
  };
  const api = seams.api ?? (await keyedApi());

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
    const needs = "collect needs <session-id> <spec.md> --run-dir <dir> --base <40-hex sha>, or <session-id> --book to book the session alone";
    if (sessionId === undefined) throw new Error(needs);
    if (values.book === true) {
      // First, so a session that has not stopped (which collect cannot rebuild yet) is still booked.
      const booked = await bookSession({ api, ledgerFile: config.ledgerFile, lane: config.lane, sessionId, budgetUsd: budgetOverride(values.budget) });
      out(booked.text);
      if (spec === undefined && runDir === undefined && base === undefined) return 0;
    }
    if (spec === undefined || runDir === undefined || base === undefined || !/^[0-9a-f]{40}$/u.test(base)) throw new Error(needs);
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
    // Without --book, collect writes no ledger line; whether the session has one is looked up (by its id or its run id), not assumed.
    const charged = (await sessionIsBooked(api, config.ledgerFile, sessionId))
      ? "the ledger has a line for this session"
      : `the ledger has NO line for this session; book it with ${bookCommand(sessionId)}`;
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
    jobCapUsd: boundedNumber(values["job-cap"], "--job-cap"),
    baseSha,
    projectRules,
    verifyScript,
    log: out,
    // Ctrl-C, a kill, a closed window or Ctrl-Break stop the run and book it (see runSandboxJob); the handlers last only as long as the run.
    stopOnSignals: {},
  });
  if (record.kind === "skipped") {
    out(`Not run: ${record.reason}`);
    return 1;
  }
  out(`${record.review.verdict}: ${costText(record)}; review at ${path.join(record.runDir, "review.md")}`);
  return record.review.verdict === "ready-for-review" ? 0 : 2;
}

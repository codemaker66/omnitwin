import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig, type RunnerConfig } from "../config.js";
import { readLedger } from "../ledger.js";
import { runNight, type NightOptions } from "../night.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE_CLAUDE = path.join(PACKAGE_DIR, "test-fixtures", "fake-claude.mjs");

interface Sandbox {
  readonly root: string;
  readonly repo: string;
  readonly origin: string;
  readonly queue: string;
  readonly record: string;
  readonly config: RunnerConfig;
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

async function task(dir: string, file: string, frontmatter: string, body: string): Promise<void> {
  await writeFile(path.join(dir, file), `---\n${frontmatter}\n---\n${body}\n`, "utf8");
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(path.join(tmpdir(), "credit-runner-night-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "--quiet", "--bare", "-b", "master", origin]);
  await mkdir(seed);
  sh(seed, "init", "--quiet", "-b", "master");
  sh(seed, "config", "user.email", "runner-test@example.com");
  sh(seed, "config", "user.name", "Runner Test");
  await writeFile(path.join(seed, "CLAUDE.md"), "# Test project\nAlways be careful.\n");
  await writeFile(
    path.join(seed, "check.mjs"),
    'import { existsSync } from "node:fs";\nprocess.exit(existsSync("hello.txt") ? 0 : 1);\n',
  );
  sh(seed, "add", ".");
  sh(seed, "commit", "--quiet", "-m", "seed");
  sh(seed, "remote", "add", "origin", origin);
  sh(seed, "push", "--quiet", "origin", "master");
  execFileSync("git", ["clone", "--quiet", origin, repo]);
  sh(repo, "config", "user.email", "runner-test@example.com");
  sh(repo, "config", "user.name", "Runner Test");

  const keys = path.join(root, "keys");
  await mkdir(keys);
  // Batch expires first, so it pays first; its key makes the fake report an empty balance.
  await writeFile(path.join(keys, "batch.key"), "sk-ant-test-broke-batch-aaaaaaaaaaaaaaaaaaaa\n", { mode: 0o600 });
  await writeFile(path.join(keys, "staging.key"), "sk-ant-test-staging-bbbbbbbbbbbbbbbbbbbbbbbb\n", { mode: 0o600 });
  if (process.platform === "win32") {
    // What setup-keys.ps1 does. Windows ignores `mode`, and a temp folder's
    // inherited entries (a sandbox group, say) would make the runner refuse the keys.
    const me = `${process.env.USERDOMAIN ?? ""}\\${userInfo().username}`;
    for (const name of ["batch.key", "staging.key"]) {
      execFileSync("icacls", [path.join(keys, name), "/inheritance:r", "/grant:r", `${me}:F`], { stdio: "pipe" });
    }
  }

  const queue = path.join(root, "queue");
  await mkdir(queue);
  const config = parseConfig({
    nightlyCapUsd: 3,
    runsRoot: path.join(root, "runs"),
    outputRoot: path.join(root, "out"),
    keyDir: keys,
    baseRef: "origin/master",
    branchPrefix: "credit/",
    claudeCommand: [process.execPath, FAKE_CLAUDE],
    // Runs get a fixed allow-list of variables; the stand-in's controls must be named.
    passEnv: ["FAKE_RECORD", "FAKE_API_KEY_SOURCE"],
    orgs: [
      { id: "staging", name: "VenViewer Staging", keyFile: "staging.key", expires: "2099-11-16" },
      { id: "batch", name: "VenViewer Batch", keyFile: "batch.key", expires: "2099-11-10" },
      { id: "production", name: "VenViewer Production", keyFile: "production.key" },
    ],
  });
  return { root, repo, origin, queue, record: path.join(root, "record.jsonl"), config };
}

function options(box: Sandbox, overrides: Partial<NightOptions> = {}): NightOptions {
  return {
    config: box.config,
    repoRoot: box.repo,
    queueDir: box.queue,
    settingsFile: path.join(PACKAGE_DIR, "runner-settings.json"),
    only: [],
    dryRun: false,
    capUsd: box.config.nightlyCapUsd,
    parentEnv: {
      ...process.env,
      // A runner started from inside a Claude Code session carries these; none may reach a run.
      ANTHROPIC_BASE_URL: "https://proxy.invalid",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token-that-must-not-leak",
      FAKE_RECORD: path.join(box.root, "record.jsonl"),
    },
    now: () => new Date(2026, 9, 19, 23, 30),
    log: () => undefined,
    shouldStop: () => false,
    acceptanceTimeoutMs: 60_000,
    ...overrides,
  };
}

async function records(box: Sandbox): Promise<Record<string, unknown>[]> {
  const text = await readFile(box.record, "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("runNight end to end with a stand-in claude", () => {
  let box: Sandbox;

  beforeEach(async () => {
    box = await makeSandbox();
  });

  afterEach(async () => {
    await rm(box.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("switches to the next org when one runs dry, verifies the branch itself, and reports", async () => {
    await task(box.queue, "010-alpha.md", "id: alpha\ntitle: Add hello\ninstall: false\nbudget_usd: 1\nacceptance: node check.mjs", "Add hello.txt.");
    await task(box.queue, "020-beta.md", "id: beta\ninstall: false\nbudget_usd: 1\nacceptance: node check.mjs", "TOUCH_ENV please.");
    await task(box.queue, "030-gamma.md", "id: gamma\ninstall: false\nbudget_usd: 2.9\nacceptance: node check.mjs", "Too big for what is left of the cap.");
    await task(box.queue, "040-off.md", "id: off\nenabled: false\ninstall: false\nacceptance: node check.mjs", "Disabled.");

    const result = await runNight(options(box));

    expect(result.ran.map((entry) => [entry.taskId, entry.outcome])).toEqual([
      ["alpha", "pass"],
      ["beta", "rejected"],
    ]);
    const [alpha, beta] = result.ran;
    if (alpha === undefined || beta === undefined) throw new Error("expected two runs");

    // Batch expires first, so it was tried first; its empty balance moved the same session to Staging.
    expect(alpha.attempts.map((attempt) => [attempt.orgId, attempt.stop])).toEqual([
      ["batch", "credit-exhausted"],
      ["staging", null],
    ]);
    expect(alpha.attempts[1]?.sessionId).toBe(alpha.attempts[0]?.sessionId);
    expect(alpha.attempts.every((attempt) => attempt.apiKeySource === "ANTHROPIC_API_KEY")).toBe(true);
    expect(alpha.costUsd).toBeCloseTo(0.12);
    expect(alpha.acceptance.status).toBe("pass");
    expect(alpha.commits).toHaveLength(1);
    expect(alpha.summary).toBe("Added one file.");
    expect(alpha.attempts[1]?.permissionDenials).toEqual(["Bash"]);

    // The env file is caught by the runner's own diff check, whatever the agent claims.
    expect(beta.violations.join(" ")).toContain(".env.local (environment file)");
    expect(beta.attempts.map((attempt) => attempt.orgId)).toEqual(["staging"]);

    // Pushes were blocked by the child environment: neither branch reached origin.
    expect(sh(box.repo, "ls-remote", "--heads", "origin")).not.toContain("credit/");

    expect(result.notRun.join("\n")).toContain("gamma: its $2.90 budget does not fit; $0.24 of the $3.00 nightly cap is spent");
    expect(result.notRun.join("\n")).not.toContain("off");

    const calls = await records(box);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.keyTail)).toEqual(["aaaaaa", "bbbbbb", "bbbbbb"]);
    expect(calls.every((call) => call.hasBaseUrl === false && call.hasOauth === false)).toBe(true);
    // Each task gets its own config folder, so nothing one run writes there can steer another.
    const configRoot = path.join(box.config.runsRoot, ".claude-config");
    expect(calls.map((call) => call.configDir)).toEqual([path.join(configRoot, "alpha"), path.join(configRoot, "alpha"), path.join(configRoot, "beta")]);
    const firstArgs = calls[0]?.args as string[];
    const secondArgs = calls[1]?.args as string[];
    expect(firstArgs).toContain("--bare");
    expect(firstArgs[firstArgs.indexOf("--session-id") + 1]).toBe(alpha.attempts[0]?.sessionId);
    expect(secondArgs[secondArgs.indexOf("--resume") + 1]).toBe(alpha.attempts[0]?.sessionId);
    expect(String(calls[1]?.prompt)).toContain("switched this session to another billing account");

    const ledger = await readLedger(path.join(box.config.outputRoot, "ledger.jsonl"));
    expect(ledger.entries.map((entry) => entry.taskId)).toEqual(["alpha", "beta"]);
    const report = await readFile(path.join(box.config.outputRoot, "reports", "2026-10-19.md"), "utf8");
    expect(report).toContain("### PASS · alpha — Add hello");
    expect(report).toContain("### REJECTED · beta — beta");
    expect(report).toContain("VenViewer Batch ($0.00, credential `ANTHROPIC_API_KEY`, credit-exhausted) → VenViewer Staging ($0.12");
    expect(report).toContain("| VenViewer Batch | out of credit |");
    expect(report).toContain("| VenViewer Production | no key file |");
    expect(report).not.toContain("sk-ant-test");

    // A second night skips tasks whose branch already exists, and the cap counts tonight's earlier spend.
    const again = await runNight(options(box));
    expect(again.ran).toHaveLength(0);
    expect(again.notRun.join("\n")).toContain("alpha: already ran");
  });

  it("kills a run that does not report the org's API key as its credential, and aborts the night", async () => {
    await task(box.queue, "010-alpha.md", "id: alpha\ninstall: false\nbudget_usd: 1\nacceptance: node check.mjs", "Add hello.txt.");
    await task(box.queue, "020-beta.md", "id: beta\ninstall: false\nbudget_usd: 1\nacceptance: node check.mjs", "Add hello.txt.");
    const base = options(box);
    const started = Date.now();

    const result = await runNight({ ...base, parentEnv: { ...base.parentEnv, FAKE_API_KEY_SOURCE: "none" } });

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result.aborted).toBe(true);
    expect(result.ran.map((entry) => [entry.taskId, entry.outcome])).toEqual([["alpha", "aborted"]]);
    expect(result.ran[0]?.attempts[0]?.apiKeySource).toBe("none");
    expect(result.ran[0]?.costUsd).toBe(0);
    expect(result.ran[0]?.acceptance.status).toBe("not-run");
    expect(result.notRun.join("\n")).toContain("beta: the night was aborted by the credential check");
  });

  it("plans without touching git, keys or the ledger in a dry run", async () => {
    await task(box.queue, "010-alpha.md", "id: alpha\ninstall: false\nbudget_usd: 1\nacceptance: node check.mjs", "Add hello.txt.");
    await task(box.queue, "040-off.md", "id: off\nenabled: false\ninstall: false\nacceptance: node check.mjs", "Disabled.");
    const lines: string[] = [];

    const result = await runNight(options(box, { dryRun: true, log: (line) => lines.push(line) }));

    // The plan always opens with what was selected and who pays, even when nothing will run.
    expect(lines[0]).toBe(
      "Plan for 2026-10-19: 1 task selected · cap $3.00 · billing order: VenViewer Batch (ready) → VenViewer Staging (ready) → VenViewer Production (no key file) · disabled (name with --only to run): off",
    );
    expect(lines.join("\n")).toContain("would run alpha on VenViewer Batch");
    expect(lines.join("\n")).not.toContain("would run off");
    expect(result.reportFile).toBeNull();
    expect(sh(box.repo, "branch", "--list", "credit/*")).toBe("");
    await expect(readFile(box.record, "utf8")).rejects.toThrow();
  });
});

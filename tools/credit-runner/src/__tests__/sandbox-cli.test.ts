import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withBaseCommit } from "../sandbox/base-repo.js";
import { masterFacts } from "../sandbox/master.js";
import { boundedNumber, budgetOverride, timeoutOverride } from "../sandbox/overrides.js";
import { sandboxConfigSchema } from "../sandbox/sandbox-config.js";
import { MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES } from "../task.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("the example config", () => {
  it("is valid JSON that the sandbox CLI's own schema accepts", async () => {
    // The only example left: the retired local lane's config went with it.
    const config = sandboxConfigSchema.parse(JSON.parse(await readFile(path.join(PACKAGE_DIR, "sandbox.config.example.json"), "utf8")));
    expect(config.keyDir).toBe("%USERPROFILE%\\.credit-runner-keys");
    expect(config.lane).toBe("sandbox");
    expect(config.laneCapUsd).toBeLessThanOrEqual(config.orgCapUsd);
  });
});

describe("--budget and --timeout overrides", () => {
  it("leave an absent flag alone and accept values up to the spec's limits", () => {
    expect(budgetOverride(undefined)).toBeUndefined();
    expect(timeoutOverride(undefined)).toBeUndefined();
    expect(budgetOverride(String(MAX_BUDGET_USD))).toBe(MAX_BUDGET_USD);
    expect(budgetOverride("0.5")).toBe(0.5);
    expect(timeoutOverride(String(MAX_TIMEOUT_MINUTES))).toBe(MAX_TIMEOUT_MINUTES);
    expect(timeoutOverride("1")).toBe(1);
  });

  it("refuse a typo that would pass the spec's ceiling", () => {
    expect(() => budgetOverride("450")).toThrow(/--budget must be at most 50/u);
    expect(() => budgetOverride(String(MAX_BUDGET_USD + 0.01))).toThrow(/at most/u);
    expect(() => timeoutOverride(String(MAX_TIMEOUT_MINUTES + 1))).toThrow(/--timeout must be at most 240/u);
    // A timeout this long would overflow setTimeout and fire at once.
    expect(() => timeoutOverride("40000")).toThrow(/at most/u);
  });

  it("refuse zero, negative, non-numeric and, for the timeout, fractional values", () => {
    for (const bad of ["0", "-1", "abc", "NaN", "Infinity", ""]) {
      expect(() => budgetOverride(bad), bad).toThrow(/positive number/u);
      expect(() => timeoutOverride(bad), bad).toThrow(/positive number/u);
    }
    expect(() => timeoutOverride("1.5")).toThrow(/whole number/u);
  });

  it("leave --night-cap without a ceiling of its own", () => {
    expect(boundedNumber("1000", "--night-cap")).toBe(1000);
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
}

describe("masterFacts", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "credit-runner-master-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads master's commit and AGENTS.md without writing anything into the checkout it runs from, whatever GIT_* says", async () => {
    const origin = path.join(root, "origin");
    git(root, "init", "--quiet", "-b", "master", origin);
    git(origin, "config", "user.email", "t@example.com");
    git(origin, "config", "user.name", "T");
    git(origin, "config", "core.autocrlf", "false");
    // Trees only, as from GitHub: AGENTS.md is fetched when it is read.
    git(origin, "config", "uploadpack.allowFilter", "true");
    await writeFile(path.join(origin, "AGENTS.md"), "# Rules\n\nKeep tests green.\n\nDeploy to production when done.\n");
    git(origin, "add", ".");
    git(origin, "commit", "--quiet", "-m", "base");
    const sha = git(origin, "rev-parse", "HEAD");

    // The checkout the CLI is run from: a clone whose refs and FETCH_HEAD must not move.
    const clone = path.join(root, "clone");
    git(root, "clone", "--quiet", pathToFileURL(origin).href, clone);
    const before = { refs: git(clone, "for-each-ref"), gitDir: (await readdir(path.join(clone, ".git"))).sort() };
    const previous = process.cwd();
    // As from inside one of the checkout's own hooks: these would point every git call at it.
    const inherited = { GIT_DIR: path.join(clone, ".git"), GIT_WORK_TREE: clone, GIT_INDEX_FILE: path.join(clone, ".git", "index") };
    Object.assign(process.env, inherited);
    process.chdir(clone);
    try {
      const facts = await masterFacts(pathToFileURL(origin).href);
      expect(facts.baseSha).toBe(sha);
      expect(facts.projectRules).toContain("Keep tests green.");
      expect(facts.projectRules).not.toMatch(/deploy/iu);
    } finally {
      process.chdir(previous);
      for (const key of Object.keys(inherited)) Reflect.deleteProperty(process.env, key);
    }
    expect(git(clone, "for-each-ref")).toBe(before.refs);
    expect((await readdir(path.join(clone, ".git"))).sort()).toEqual(before.gitDir);
    await expect(readFile(path.join(clone, ".git", "FETCH_HEAD"), "utf8")).rejects.toThrow();
  });

  it("returns its result even when the throwaway repository cannot be removed, and says so", async () => {
    const origin = path.join(root, "origin");
    git(root, "init", "--quiet", "-b", "master", origin);
    git(origin, "config", "user.email", "t@example.com");
    git(origin, "config", "user.name", "T");
    await writeFile(path.join(origin, "AGENTS.md"), "# Rules\n");
    git(origin, "add", ".");
    git(origin, "commit", "--quiet", "-m", "base");
    const sha = git(origin, "rev-parse", "HEAD");
    const logged: string[] = [];
    const folders: string[] = [];
    const value = await withBaseCommit(
      pathToFileURL(origin).href,
      sha,
      (repo) => git(repo, "show", `${sha}:AGENTS.md`).length > 0 ? Promise.resolve("the result") : Promise.resolve("empty"),
      (line) => logged.push(line),
      (folder) => {
        folders.push(folder);
        return Promise.reject(new Error("EBUSY: resource busy or locked"));
      },
    );
    expect(value).toBe("the result");
    expect(logged).toEqual(["Could not remove a throwaway repository (EBUSY: resource busy or locked)."]);
    for (const folder of folders) await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("fails when the repository has no master", async () => {
    const empty = path.join(root, "empty");
    git(root, "init", "--quiet", "--bare", empty);
    await expect(masterFacts(pathToFileURL(empty).href)).rejects.toThrow(/could not read master/u);
  });
});

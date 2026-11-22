import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitEnv } from "../git.js";
import { withBaseCommit } from "../sandbox/base-repo.js";
import { ATTENDED, isInsideFolder, main, USAGE } from "../sandbox/cli.js";
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

describe("the CLI's own words", () => {
  it("says in its usage that the launcher is run by hand and attended, with a neutral job label", () => {
    expect(ATTENDED).toContain("Run it by hand and attended until the night-shift conveyor's ledger v2 lands");
    expect(ATTENDED).toContain("Do not schedule or loop `sandbox run`");
    expect(USAGE).toContain(ATTENDED);
    // No example that reads like a scheduled night.
    expect(USAGE).not.toMatch(/night-\d/u);
    expect(USAGE).toContain("e.g. trial-1");
  });

  it("prints the same words at the start of run, before it reads its config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-cli-"));
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await expect(main(["run", "spec.md", "--job", "trial-1", "--config", path.join(root, "missing.json")])).rejects.toThrow(/ENOENT/u);
    } finally {
      spy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
    expect(written.join("")).toContain(ATTENDED);
  });

  it("runs as a command when started through a junction or a symlinked folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-link-"));
    const link = path.join(root, "package");
    await symlink(PACKAGE_DIR, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const child = spawnSync(process.execPath, [path.join(PACKAGE_DIR, "node_modules", "tsx", "dist", "cli.mjs"), path.join(link, "src", "sandbox", "cli-entry.ts"), "--help"], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(child.status).toBe(0);
      expect(child.stdout).toContain(ATTENDED);
    } finally {
      await removeLink(link);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

/** Removes a junction or symlink itself, never what it points at. */
async function removeLink(link: string): Promise<void> {
  if (process.platform === "win32") await rmdir(link);
  else await unlink(link);
}

describe("the key folder", () => {
  const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");

  it("refuses a key folder inside the repository, before any key is read, and follows a junction to find out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-keys-"));
    const link = path.join(root, "into-repo");
    await symlink(path.join(REPO_ROOT, "tools"), link, process.platform === "win32" ? "junction" : "dir");
    const configWith = async (keyDir: string): Promise<string> => {
      const file = path.join(root, "sandbox.config.json");
      await writeFile(file, JSON.stringify({ workRoot: path.join(root, "work"), ledgerFile: path.join(root, "ledger.jsonl"), keyDir, keyFile: "pot-1.key", lane: "sandbox", laneCapUsd: 1, orgCapUsd: 2 }));
      return file;
    };
    const quiet = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      for (const command of ["setup", "run", "collect"]) {
        await expect(main([command, "--config", await configWith(path.join(REPO_ROOT, "keys"))]), command).rejects.toThrow(/inside the repository/u);
      }
      // A folder that only reaches the repository through a junction is inside it too.
      await expect(main(["setup", "--config", await configWith(path.join(link, "keys"))])).rejects.toThrow(/inside the repository/u);
      // Outside it, setup goes on to look for the key file.
      await expect(main(["setup", "--config", await configWith(path.join(root, "keys"))])).rejects.toThrow(/no key file at/u);
    } finally {
      quiet.mockRestore();
      await removeLink(link);
      await rm(root, { recursive: true, force: true });
    }
    expect(isInsideFolder(path.join(REPO_ROOT, "keys"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(REPO_ROOT, REPO_ROOT)).toBe(true);
    expect(isInsideFolder(`${REPO_ROOT}-keys`, REPO_ROOT)).toBe(false);
    expect(isInsideFolder(path.dirname(REPO_ROOT), REPO_ROOT)).toBe(false);
    // A child whose first segment merely starts with two dots is inside; ".." and "../x" are not.
    expect(isInsideFolder(path.join(REPO_ROOT, "..keys"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(path.join(REPO_ROOT, "..keys", "pot-1.key"), REPO_ROOT)).toBe(true);
    expect(isInsideFolder(path.join(REPO_ROOT, "..", "keys"), REPO_ROOT)).toBe(false);
    expect(isInsideFolder(path.join(path.dirname(REPO_ROOT), "..keys"), REPO_ROOT)).toBe(false);
    // path.relative gives an absolute path when the child is on another drive.
    if (process.platform === "win32") {
      const otherDrive = REPO_ROOT.slice(0, 1).toUpperCase() === "Z" ? "Y:/keys" : "Z:/keys";
      expect(isInsideFolder(otherDrive, REPO_ROOT)).toBe(false);
    }
  });

  it.runIf(process.platform === "win32")("setup-keys.ps1 refuses a key folder inside the repository before it asks for a key", async () => {
    // Run a copy placed at tools/credit-runner/ of a temporary tree, so a regression that
    // creates and locks the folder does it there, never in this checkout.
    const root = await mkdtemp(path.join(tmpdir(), "credit-runner-setup-keys-"));
    try {
      const folder = path.join(root, "tools", "credit-runner");
      await mkdir(folder, { recursive: true });
      await cp(path.join(PACKAGE_DIR, "setup-keys.ps1"), path.join(folder, "setup-keys.ps1"));
      const args = ["-NoProfile", "-NonInteractive", "-File", path.join(folder, "setup-keys.ps1"), "-KeyDir", "keys-test-refused"];
      let child = spawnSync("pwsh", args, { cwd: root, encoding: "utf8", windowsHide: true });
      if (child.error !== undefined) child = spawnSync("powershell", args, { cwd: root, encoding: "utf8", windowsHide: true });
      expect(child.status).not.toBe(0);
      expect(`${child.stdout}${child.stderr}`).toContain("inside the repository");
      expect(existsSync(path.join(root, "keys-test-refused"))).toBe(false);
      expect(existsSync(path.join(REPO_ROOT, "keys-test-refused"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps key files out of git, in the package and at the repository root", () => {
    for (const file of ["keys/pot-1.key", "tools/credit-runner/pot-1.key"]) {
      expect(spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", file], { env: gitEnv() }).status, file).toBe(0);
    }
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

/** git as production runs it (gitEnv: no GIT_* variable), so a test that sets GIT_* for the code under test does not redirect its own setup. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv() }).trim();
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

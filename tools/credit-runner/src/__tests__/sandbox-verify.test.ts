import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { gitEnv } from "../git.js";
import { parseVerifyOutput } from "../sandbox/session.js";

// sandbox/verify.mjs runs inside the Managed Agents container. Here it runs
// against throwaway repos, with `node __tests__/lib.test.mjs` as the acceptance.

const VERIFY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../sandbox/verify.mjs");
const TRAILER = "Credit-Runner-Task: t1";
const BROKEN = "export const two = () => 3;\n";
const FIXED = "export const two = () => 2;\n";
const TEST =
  'import { two } from "../lib.mjs";\nif (two() !== 2) { console.error(`two() is ${two()}`); process.exit(1); }\nconsole.log("ok");\n';
const ACCEPTANCE = "node __tests__/lib.test.mjs";

interface VerifyOutput {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly flags: readonly string[];
  readonly head: string;
  readonly commits: readonly string[];
  readonly tests: readonly string[];
  readonly sources: readonly string[];
  readonly branch?: { readonly exitCode: number | null };
  readonly base?: { readonly mode: string; readonly exitCode?: number | null; readonly timedOut?: boolean; readonly tail?: string };
}

const dirs: string[] = [];
afterEach(async () => {
  // A timed-out run can leave its node child holding the folder for a few seconds on Windows.
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 });
});

/** git as production runs it (gitEnv: no GIT_* variable from a calling hook), so a fixture never writes to the repository the tests run from. */
function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: gitEnv() }).trim();
}

async function repoWith(lib: string): Promise<{ repo: string; base: string; outputs: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "verify-"));
  dirs.push(root);
  const repo = path.join(root, "repo");
  const outputs = path.join(root, "outputs");
  await mkdir(repo);
  await mkdir(outputs);
  git(repo, "init", "--quiet", "-b", "master");
  git(repo, "config", "user.email", "verify-test@example.com");
  git(repo, "config", "user.name", "Verify Test");
  git(repo, "config", "core.autocrlf", "false");
  await writeFile(path.join(repo, "lib.mjs"), lib);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  return { repo, base: git(repo, "rev-parse", "HEAD"), outputs };
}

async function commit(repo: string, files: Record<string, string>, message = `change\n\n${TRAILER}`): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), text);
  }
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", message);
}

async function verify(
  repo: string,
  base: string,
  outputs: string,
  mutation?: string,
  acceptanceTimeoutMinutes?: number,
  acceptance = ACCEPTANCE,
): Promise<{ result: VerifyOutput; exitCode: number | null; stdout: string }> {
  const taskFile = path.join(path.dirname(repo), "task.json");
  await writeFile(taskFile, JSON.stringify({ id: "t1", baseSha: base, repoDir: repo, acceptance, mutation, acceptanceTimeoutMinutes }));
  const child = spawnSync(process.execPath, [VERIFY, taskFile], {
    encoding: "utf8",
    // The verifier's own git calls get no GIT_* variable either.
    env: { ...gitEnv(), VERIFY_OUTPUTS_DIR: outputs },
  });
  const line = child.stdout.split("\n").find((text) => text.startsWith("VERIFY_RESULT "));
  if (line === undefined) throw new Error(`no VERIFY_RESULT line; stderr: ${child.stderr}`);
  return { result: JSON.parse(line.slice("VERIFY_RESULT ".length)) as VerifyOutput, exitCode: child.status, stdout: child.stdout };
}

describe("sandbox verify.mjs", () => {
  it("passes a fix whose new test fails without it, and leaves the branch as it was", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": TEST });
    const head = git(repo, "rev-parse", "HEAD");

    const { result, exitCode } = await verify(repo, base, outputs);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(exitCode).toBe(0);
    expect(result.branch?.exitCode).toBe(0);
    expect(result.base?.mode).toBe("revert-source");
    expect(result.base?.exitCode).not.toBe(0);
    expect(result.tests).toEqual(["__tests__/lib.test.mjs"]);
    expect(result.sources).toEqual(["lib.mjs"]);
    expect(result.commits).toEqual([head]);
    expect(result.flags).toEqual([]);
    // The run without the fix keeps its output, for the review to show.
    expect(result.base?.tail).toContain("two() is 3");

    // Restored: same commit, clean tree, the fix still in place.
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(await readFile(path.join(repo, "lib.mjs"), "utf8")).toBe(FIXED);
    const written = JSON.parse(await readFile(path.join(outputs, "verify.json"), "utf8")) as VerifyOutput;
    expect(written.ok).toBe(true);
  });

  it("fails a test that also passes without the fix", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    const vacuous = "console.log('nothing checked');\n";
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": vacuous });
    const { result, exitCode } = await verify(repo, base, outputs);
    expect(result.ok).toBe(false);
    expect(exitCode).toBe(1);
    expect(result.problems.join(" ")).toContain("still passes without the fix");
  });

  it("needs a mutation to prove a pinning test, and passes one the mutation breaks", async () => {
    const { repo, base, outputs } = await repoWith(FIXED);
    await commit(repo, { "__tests__/lib.test.mjs": TEST });

    const without = await verify(repo, base, outputs);
    expect(without.result.ok).toBe(false);
    expect(without.result.problems.join(" ")).toContain("names no mutation");

    const mutated = await verify(repo, base, outputs, "sed -i 's/=> 2/=> 7/' lib.mjs");
    expect(mutated.result.problems).toEqual([]);
    expect(mutated.result.base?.mode).toBe("mutation");
    expect(mutated.result.base?.exitCode).not.toBe(0);
    expect(await readFile(path.join(repo, "lib.mjs"), "utf8")).toBe(FIXED);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("does not count Node's compile cache in the working tree as uncommitted work", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": TEST });
    await mkdir(path.join(repo, "node-compile-cache", "v22.22.0-x64"), { recursive: true });
    await writeFile(path.join(repo, "node-compile-cache", "v22.22.0-x64", "entry"), "cache\n");
    const { result } = await verify(repo, base, outputs);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does not count a run without the fix that timed out as the test failing", async () => {
    // Without the fix, loading the code under test hangs (idly, and only for
    // a while: a killed shell can leave its node child behind).
    const { repo, base, outputs } = await repoWith("await new Promise((resolve) => setTimeout(resolve, 6_000));\nexport const two = () => 3;\n");
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": TEST });
    const { result } = await verify(repo, base, outputs, undefined, 0.05);
    expect(result.base?.timedOut).toBe(true);
    expect(result.base?.exitCode).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("the acceptance command timed out without the fix, which proves nothing about the tests");
  });

  // Git Bash on Windows reports a shell killed by a signal as an exit status
  // (`kill -9 $$` reads as 2304), so this runs where CI runs: Linux.
  it.skipIf(process.platform === "win32")("does not count a run without the fix that ended by a signal as the test failing", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": TEST });
    // Passes on the branch; without the fix the shell kills itself instead of exiting.
    const { result } = await verify(repo, base, outputs, undefined, undefined, `${ACCEPTANCE} || kill -9 $$`);
    expect(result.branch?.exitCode).toBe(0);
    expect(result.base?.mode).toBe("revert-source");
    expect(result.base?.exitCode).toBeNull();
    expect(result.base?.timedOut).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "the acceptance command without the fix ended with no exit code (a signal, or it never started), which proves nothing about the tests",
    ]);
  });

  it("flags a new source file, even beside a line removed elsewhere, whose test may fail without it on a missing module", async () => {
    const { repo, base, outputs } = await repoWith(`${FIXED}// a note\n`);
    const importsNew = 'import { three } from "../extra.mjs";\nif (three() !== 3) process.exit(1);\n';
    await commit(repo, { "extra.mjs": "export const three = () => 3;\n", "lib.mjs": FIXED, "__tests__/lib.test.mjs": importsNew });
    const { result } = await verify(repo, base, outputs);
    expect(result.ok).toBe(true);
    expect(result.flags).toEqual([
      "the change adds non-test file(s) extra.mjs, so the run without it removes them and a test may fail on the missing module rather than on the behaviour it checks",
    ]);
  });

  it("flags a source change that only adds lines, whose test may fail without it on a missing name", async () => {
    const { repo, base, outputs } = await repoWith(FIXED);
    const importsNew = 'import { three } from "../lib.mjs";\nif (three() !== 3) process.exit(1);\n';
    await commit(repo, { "lib.mjs": `${FIXED}export const three = () => 3;\n`, "__tests__/lib.test.mjs": importsNew });
    const { result } = await verify(repo, base, outputs);
    expect(result.ok).toBe(true);
    expect(result.flags).toEqual([
      "the change only adds lines to lib.mjs, so the run without it may fail on a missing name rather than on the behaviour the tests check",
    ]);
  });

  it("flags a code file that only gains lines even when another file in the change loses one", async () => {
    const { repo, outputs } = await repoWith(FIXED);
    await commit(repo, { "README.md": "# Lib\n\nNotes.\n" }, "docs");
    const base = git(repo, "rev-parse", "HEAD");
    const importsNew = 'import { three } from "../lib.mjs";\nif (three() !== 3) process.exit(1);\n';
    await commit(repo, { "lib.mjs": `${FIXED}export const three = () => 3;\n`, "__tests__/lib.test.mjs": importsNew, "README.md": "# Lib\n" });
    const { result } = await verify(repo, base, outputs);
    expect(result.flags).toEqual([
      "the change only adds lines to lib.mjs, so the run without it may fail on a missing name rather than on the behaviour the tests check",
    ]);
  });

  it("keeps its line one line, and readable by the launcher, when the test output holds U+2028 or U+2029", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    const noisy = 'import { two } from "../lib.mjs";\nif (two() !== 2) { console.error("wrong\\u2028value\\u2029here"); process.exit(1); }\n';
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": noisy });
    const { result, stdout } = await verify(repo, base, outputs);
    expect(result.ok).toBe(true);
    expect(result.base?.tail).toContain("wrong\u2028value\u2029here");
    expect(stdout).not.toMatch(/[\u2028\u2029]/u);
    expect(parseVerifyOutput(stdout)?.baseTail).toContain("wrong\u2028value");
    // A raw separator inside the line (an older verifier) is read too: lines end at a newline only.
    expect(parseVerifyOutput(`VERIFY_RESULT {"ok":true,"head":"h","problems":[],"base":{"tail":"a\u2028b"}}\n`)?.baseTail).toBe("a\u2028b");
  });

  it("lists the branch's commits oldest first, the order format-patch numbers them", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    await commit(repo, { "__tests__/lib.test.mjs": TEST });
    const first = git(repo, "rev-parse", "HEAD");
    await commit(repo, { "lib.mjs": FIXED });
    const second = git(repo, "rev-parse", "HEAD");
    const { result } = await verify(repo, base, outputs);
    expect(result.commits).toEqual([first, second]);
  });

  it("names a commit without the task trailer and an uncommitted file", async () => {
    const { repo, base, outputs } = await repoWith(BROKEN);
    await commit(repo, { "lib.mjs": FIXED, "__tests__/lib.test.mjs": TEST }, "no trailer here");
    await writeFile(path.join(repo, "stray.txt"), "left behind\n");
    const { result } = await verify(repo, base, outputs);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('a commit lacks the trailer "Credit-Runner-Task: t1"');
    expect(result.problems).toContain("the working tree has uncommitted changes");
  });
});

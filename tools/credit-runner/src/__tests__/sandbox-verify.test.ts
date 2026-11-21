import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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
  readonly head: string;
  readonly tests: readonly string[];
  readonly sources: readonly string[];
  readonly branch?: { readonly exitCode: number | null };
  readonly base?: { readonly mode: string; readonly exitCode?: number | null };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
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

async function verify(repo: string, base: string, outputs: string, mutation?: string): Promise<{ result: VerifyOutput; exitCode: number | null }> {
  const taskFile = path.join(path.dirname(repo), "task.json");
  await writeFile(taskFile, JSON.stringify({ id: "t1", baseSha: base, repoDir: repo, acceptance: ACCEPTANCE, mutation }));
  const child = spawnSync(process.execPath, [VERIFY, taskFile], {
    encoding: "utf8",
    env: { ...process.env, VERIFY_OUTPUTS_DIR: outputs },
  });
  const line = child.stdout.split("\n").find((text) => text.startsWith("VERIFY_RESULT "));
  if (line === undefined) throw new Error(`no VERIFY_RESULT line; stderr: ${child.stderr}`);
  return { result: JSON.parse(line.slice("VERIFY_RESULT ".length)) as VerifyOutput, exitCode: child.status };
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

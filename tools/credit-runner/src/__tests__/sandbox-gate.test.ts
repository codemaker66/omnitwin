import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gitEnv } from "../git.js";
import { inspectPatches, type PatchInspection } from "../sandbox/patches.js";
import { reviewRun, type Review } from "../sandbox/review.js";
import type { SessionRunResult } from "../sandbox/session.js";
import { BASE_FILES, PAGE_CHECK, PAGE_CHECK_TEST, patchFixture, type Commit } from "./patch-fixture.js";

// The review removes its throwaway repository when it is done. A test that sets
// `look` sees that repository once the inspection has finished with it, before
// the removal; every other call passes straight through.
const throwaway = vi.hoisted(() => ({ look: undefined as ((repo: string, baseSha: string) => void) | undefined }));
vi.mock("../sandbox/base-repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sandbox/base-repo.js")>();
  function withBaseCommit<T>(repoUrl: string, sha: string, use: (repo: string, scratch: string) => Promise<T>, log?: (line: string) => void): Promise<T> {
    return actual.withBaseCommit(
      repoUrl,
      sha,
      async (repo, scratch) => {
        const result = await use(repo, scratch);
        throwaway.look?.(repo, sha);
        return result;
      },
      log,
    );
  }
  return { ...actual, withBaseCommit };
});

// The patch gate's binary rule, read against what git itself prints for each
// commit (`git log -p`, format-patch): "Binary files differ" only where git
// calls a file binary and the commit changes its content.

let root = "";
let count = 0;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "credit-runner-gate-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Each test makes and reads real repositories: generous for a slow disk, where one git call can take a second. */
const SLOW = 180_000;

/** A base file holding a NUL on its second line, within git's first 8,000 bytes. */
const BINARY = `${["header", "\u0000", ...Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`)].join("\n")}\n`;
const OTHER_BINARY = BINARY.replace("header", "another");
const TEXT = `${Array.from({ length: 20 }, (_, index) => `text ${String(index + 1)}`).join("\n")}\n`;
const BASE: Readonly<Record<string, string>> = {
  ...BASE_FILES,
  "assets/m.bin": BINARY,
  "assets/k.bin": OTHER_BINARY,
  "docs/t.md": TEXT,
  ".gitattributes": "*.dat -diff\n",
  "data/table.dat": "1 2\n",
};

/** Makes the commits on the base above, writes their format-patch files, and inspects them as the review does. */
async function inspect(commits: readonly Commit[], formatPatchArgs: readonly string[] = []): Promise<PatchInspection & { readonly patchText: string }> {
  count += 1;
  const dir = path.join(root, String(count));
  const made = await patchFixture(dir, commits, { baseFiles: BASE, formatPatchArgs });
  const saved = path.join(dir, "saved");
  await mkdir(saved);
  const files: string[] = [];
  for (const [name, text] of Object.entries(made.patches)) {
    const file = path.join(saved, name);
    await writeFile(file, text);
    files.push(file);
  }
  const inspection = await inspectPatches(files, { baseSha: made.base, repoUrl: made.url });
  expect(inspection.problems).toEqual([]);
  return { ...inspection, patchText: Object.values(made.patches).join("") };
}

describe("the patch gate's binary rule, commit by commit", () => {
  it("counts a NUL that one commit adds and a later one takes out as a binary change, though the net change is text", async () => {
    // Written as text, so no binary patch section names the file: only git's diff of each commit can.
    // The last commit leaves the file alone, so neither the net change nor the last step shows it.
    const added = await inspect(
      [
        { subject: "Add a line", write: { "docs/t.md": TEXT.replace("text 3\n", "text 3\nsec\u0000ret\n") } },
        { subject: "Take it out", write: { "docs/t.md": TEXT } },
        { subject: "Edit the readme", write: { "README.md": "# Fixture, edited\n" } },
      ],
      ["--text"],
    );
    expect(added.patchText).toContain("+sec\u0000ret");
    expect(added.patchText).not.toContain("GIT binary patch");
    expect(added.binary).toEqual(["docs/t.md"]);
  }, SLOW);

  it("counts the base's binary file edited by one commit and put back by the next: each commit is a binary change", async () => {
    const restored = await inspect(
      [
        { subject: "Edit the asset", write: { "assets/m.bin": BINARY.replace("line 25", "line twenty-five") } },
        { subject: "Put it back", write: { "assets/m.bin": BINARY } },
      ],
      ["--text"],
    );
    expect(restored.binary).toEqual(["assets/m.bin"]);
    expect(restored.changed).toContain("M assets/m.bin");
  }, SLOW);

  it("does not count a pure rename or a mode change of a binary file, which git shows without its content", async () => {
    // One commit each, so each is judged alone. format-patch writes them with no binary section:
    // "similarity index 100%", "old mode / new mode", or both.
    const moved = await inspect([
      { subject: "Move the asset and make it executable", rename: { "assets/m.bin": "assets/n.bin" }, chmodX: ["assets/n.bin"] },
      { subject: "Make the other executable", chmodX: ["assets/k.bin"] },
      { subject: "Move the other", rename: { "assets/k.bin": "assets/j.bin" } },
      // A file the base's attributes call binary, renamed to a name they do not: the same content, nothing to read.
      { subject: "Rename the table", rename: { "data/table.dat": "data/table.txt" } },
    ]);
    expect(moved.patchText).toContain("similarity index 100%");
    expect(moved.patchText).toContain("new mode 100755");
    expect(moved.patchText).not.toMatch(/GIT binary patch|Binary files/u);
    expect(moved.binary).toEqual([]);
    expect(moved.changed).toEqual(expect.arrayContaining(["A assets/n.bin", "R assets/m.bin", "A assets/j.bin", "A data/table.txt", "R data/table.dat"]));
  }, SLOW);

  it("still counts a binary file renamed with its content changed, or copied", async () => {
    const edited = await inspect([
      { subject: "Move and edit", write: { "assets/m.bin": BINARY.replace("line 25", "line twenty-five") }, rename: { "assets/m.bin": "assets/n.bin" } },
      { subject: "Copy the other", write: { "assets/k2.bin": OTHER_BINARY } },
    ]);
    expect(edited.patchText).toMatch(/similarity index 9\d%/u);
    expect([...edited.binary].sort()).toEqual(["assets/k2.bin", "assets/m.bin", "assets/n.bin"]);
  }, SLOW);

  it("still counts a binary file deleted by one commit and added back under another name by the next, as each commit shows it", async () => {
    // The net change is an exact rename; each commit on its own deletes or adds binary content.
    const split = await inspect([
      { subject: "Delete the asset", remove: ["assets/m.bin"] },
      { subject: "Add it back elsewhere", write: { "assets/n.bin": BINARY } },
    ]);
    expect([...split.binary].sort()).toEqual(["assets/m.bin", "assets/n.bin"]);
  }, SLOW);
});

describe("the throwaway repository the patch gate reads in", () => {
  it("still lacks every blob of the base that no commit touches after a series of two commits", async () => {
    // The base is fetched without blobs, and git fetches one only when a command
    // reads it. The tree written between the two steps must not fetch the rest
    // of the base: in the real repository that is all of master's media.
    const untouched = ["assets/k.bin", "assets/m.bin", "data/table.dat", PAGE_CHECK, PAGE_CHECK_TEST];
    const seen: { readonly blobs: ReadonlyMap<string, string>; readonly missing: ReadonlySet<string> }[] = [];
    throwaway.look = (repo, baseSha) => {
      const read = (args: readonly string[]): string =>
        execFileSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], { encoding: "utf8", env: gitEnv() });
      const blobs = new Map<string, string>();
      for (const entry of read(["ls-tree", "-r", "-z", baseSha]).split("\0")) {
        const match = /^[0-7]{6} blob ([0-9a-f]+)\t([\s\S]+)$/u.exec(entry);
        if (match !== null) blobs.set(match[2] ?? "", match[1] ?? "");
      }
      const missing = new Set(
        read(["rev-list", "--objects", "--missing=print", baseSha])
          .split("\n")
          .filter((line) => line.startsWith("?"))
          .map((line) => line.slice(1)),
      );
      seen.push({ blobs, missing });
    };
    try {
      await inspect([
        { subject: "Edit the notes", write: { "docs/t.md": TEXT.replace("text 3\n", "text three\n") } },
        { subject: "Edit the readme", write: { "README.md": "# Fixture, edited\n" } },
      ]);
    } finally {
      throwaway.look = undefined;
    }
    expect(seen).toHaveLength(1);
    const blobs = seen[0]?.blobs ?? new Map<string, string>();
    const missing = seen[0]?.missing ?? new Set<string>();
    expect(untouched.filter((file) => !blobs.has(file))).toEqual([]);
    // Fetched into the throwaway repository though nothing in the series reads it.
    expect(untouched.filter((file) => !missing.has(blobs.get(file) ?? ""))).toEqual([]);
  }, SLOW);
});

/** A finished session whose outputs are `outputs` and whose verifier passed on the given commits. */
function sessionResult(outputs: readonly string[], head: string, commits: readonly string[]): SessionRunResult {
  return {
    sessionId: "sesn_gate",
    status: "idle",
    stopped: true,
    archived: false,
    runningAfterFinish: false,
    stopInterrupted: false,
    stopReason: "end_turn",
    timedOut: false,
    listCostUsd: 1,
    activeSeconds: 60,
    requests: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    verify: { ok: true, head, problems: [], commits, flags: [], baseTail: null },
    verifyRuns: 1,
    outcome: null,
    errors: [],
    deniedAsks: 0,
    outputs,
    outputNames: Object.fromEntries(outputs.map((file) => [file, path.basename(file)])),
    refusedOutputs: [],
    leftOutputs: [],
  };
}

/** Makes the commits on `baseFiles`, saves their format-patch files and diff.patch under the launcher's names, and reviews them as the launcher does. */
async function review(commits: readonly Commit[], baseFiles: Readonly<Record<string, string>>): Promise<Review> {
  count += 1;
  const dir = path.join(root, String(count));
  const made = await patchFixture(dir, commits, { baseFiles });
  const saved = path.join(dir, "outputs");
  await mkdir(saved);
  const outputs: string[] = [];
  for (const [index, text] of Object.values(made.patches).entries()) {
    const file = path.join(saved, `patch-${String(index + 1).padStart(4, "0")}.patch`);
    await writeFile(file, text);
    outputs.push(file);
  }
  const diffFile = path.join(saved, "diff.patch");
  await writeFile(diffFile, made.diff);
  outputs.push(diffFile);
  return reviewRun(sessionResult(outputs, made.head, made.commits), { baseSha: made.base, repoUrl: made.url });
}

/** Agent instructions, deploy config, install-time code and editor tasks, each with the label a rejection names; `atBase` files exist before the run and are edited, the rest are created. */
const NEWLY_PROTECTED: readonly { readonly file: string; readonly label: string; readonly atBase: boolean }[] = [
  { file: "AGENTS.md", label: "agent instructions", atBase: true },
  { file: "CLAUDE.md", label: "agent instructions", atBase: true },
  { file: "packages/web/AGENTS.md", label: "agent instructions", atBase: false },
  { file: "packages/web/CLAUDE.md", label: "agent instructions", atBase: false },
  { file: "CLAUDE.local.md", label: "agent instructions", atBase: false },
  { file: "GOAL.md", label: "agent goals", atBase: true },
  { file: ".claude/agents/reviewer.md", label: "Claude Code config", atBase: true },
  { file: ".claude/skills/neon/SKILL.md", label: "Claude Code config", atBase: true },
  { file: ".claude/conventions/shipping.md", label: "Claude Code config", atBase: true },
  { file: ".claude/gotchas/arg-scope.md", label: "Claude Code config", atBase: true },
  { file: ".claude/commands/ship.md", label: "Claude Code config", atBase: false },
  { file: ".claudeignore", label: "Claude Code ignore file", atBase: true },
  { file: "skills-lock.json", label: "agent skills lock", atBase: true },
  { file: ".railway/railway.ts", label: "Railway config", atBase: true },
  { file: ".railwayignore", label: "Railway config", atBase: true },
  { file: "infra/runpod/bootstrap.sh", label: "infrastructure config", atBase: true },
  { file: "patches/three@0.186.0.patch", label: "pnpm dependency patch, applied at install", atBase: true },
  { file: ".pnpmfile.cjs", label: "pnpm hook file, run at install", atBase: false },
  { file: "packages/api/.pnpmfile.cjs", label: "pnpm hook file, run at install", atBase: false },
  { file: "pnpm-workspace.yaml", label: "pnpm workspace config", atBase: true },
  { file: ".vscode/tasks.json", label: "VS Code config", atBase: false },
  { file: ".devcontainer/devcontainer.json", label: "dev container config", atBase: false },
  { file: ".devcontainer.json", label: "dev container config", atBase: false },
];

/** Names close to those files that a run may still change. */
const NEARBY = ["docs/agents-guide.md", "claude.md.txt", "src/patches/x.ts", "docs/GOAL.md", "goals/README.md", "packages/web/src/infra/client.ts"];

describe("the protected paths, read by the review from real patches", () => {
  it("rejects a change to each agent-instruction, deploy, install-time and editor file under its label, and lets nearby files through", async () => {
    const base = { ...BASE_FILES, ...Object.fromEntries(NEWLY_PROTECTED.filter((entry) => entry.atBase).map((entry) => [entry.file, "at the base\n"])), "docs/agents-guide.md": "# Guide\n" };
    const result = await review(
      [
        { subject: "Change the agent, deploy, install and editor files", write: Object.fromEntries(NEWLY_PROTECTED.map((entry) => [entry.file, "changed by the run\n"])) },
        { subject: "Change nearby files", write: Object.fromEntries(NEARBY.map((file) => [file, "changed by the run\n"])) },
      ],
      base,
    );
    expect(result.verdict).toBe("rejected");
    expect([...result.reasons].sort()).toEqual(NEWLY_PROTECTED.map((entry) => `protected path changed: ${entry.file} (${entry.label})`).sort());
    // Edits and new files alike: the review read each from the patches.
    expect(result.changed).toEqual(expect.arrayContaining(NEWLY_PROTECTED.map((entry) => `${entry.atBase ? "M" : "A"} ${entry.file}`)));
  }, SLOW);

  it("passes a run that changes only the nearby files", async () => {
    const result = await review([{ subject: "Change nearby files", write: Object.fromEntries(NEARBY.map((file) => [file, "changed by the run\n"])) }], { ...BASE_FILES, "docs/agents-guide.md": "# Guide\n" });
    expect(result.reasons).toEqual([]);
    expect(result.verdict).toBe("ready-for-review");
  }, SLOW);
});

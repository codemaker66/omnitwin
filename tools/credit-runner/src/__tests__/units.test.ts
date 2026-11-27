import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { expandHome } from "../config.js";
import { FrontmatterError, parseFrontmatter } from "../frontmatter.js";
import { gitCommandName, gitResult, protectedPathViolations } from "../git.js";
import { appendCreditLine, ledgerHasSession } from "../sandbox/credit-ledger.js";
import { keyFileExposure, readKey, unexpectedPrincipals } from "../keys.js";
import { AGENT_EFFORT, AGENT_MODEL, MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES, parseTask } from "../task.js";

// Every spawn still runs; the spy only records how gitResult opened each child's stdin.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

/** The stdin each spawn since the spy was last cleared was given, in call order. */
function stdinModes(): unknown[] {
  return vi.mocked(spawn).mock.calls.map((call) => {
    const options: unknown = call[2];
    if (typeof options !== "object" || options === null || !("stdio" in options) || !Array.isArray(options.stdio)) return undefined;
    const stdin: unknown = options.stdio[0];
    return stdin;
  });
}

describe("parseFrontmatter", () => {
  it("reads scalars, quoted strings, both list forms and the body", () => {
    const text = [
      "---",
      "# a comment line",
      "id: t-1",
      "budget_usd: 2.5",
      "install: false",
      'acceptance: "pnpm test -- a # not a comment"',
      "title: plain words # trailing comment",
      "allowed_tools: [Read, Bash(git log --format=%h,%s), 'Edit']",
      "extra_allowed_tools:",
      "  - Bash(pnpm *)",
      '  - "Write"',
      "empty_list:",
      "---",
      "",
      "Spec body.",
      "",
    ].join("\r\n");
    const doc = parseFrontmatter(text);
    expect(doc.data).toEqual({
      id: "t-1",
      budget_usd: 2.5,
      install: false,
      acceptance: "pnpm test -- a # not a comment",
      title: "plain words",
      allowed_tools: ["Read", "Bash(git log --format=%h,%s)", "Edit"],
      extra_allowed_tools: ["Bash(pnpm *)", "Write"],
      empty_list: [],
    });
    expect(doc.body).toBe("Spec body.");
  });

  it("ignores a byte-order mark", () => {
    expect(parseFrontmatter(`${String.fromCharCode(0xfeff)}---\nid: a\n---\nbody`).data).toEqual({ id: "a" });
  });

  it.each([
    ["no frontmatter", "id: a\n", 1],
    ["no closing line", "---\nid: a\n", 3],
    ["a duplicate key", "---\nid: a\nid: b\n---\n", 3],
    ["a list item without a key", "---\n  - a\n---\n", 2],
    ["an unterminated quote", '---\nid: "a\n---\n', 2],
    ["text after a quote", '---\nid: "a" b\n---\n', 2],
    ["an unclosed inline list", "---\nids: [a, b\n---\n", 2],
    ["indented garbage", "---\nid a\n---\n", 2],
  ])("rejects %s with its line number", (_name, text, line) => {
    try {
      parseFrontmatter(text);
      expect.unreachable("expected a FrontmatterError");
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterError);
      expect((error as FrontmatterError).line).toBe(line);
    }
  });
});

describe("parseTask", () => {
  const minimal = "---\nid: fix-thing\nacceptance: pnpm test\n---\nDo the thing.\n";

  it("fills the documented defaults", () => {
    const task = parseTask(minimal, "x.md");
    expect(task).toMatchObject({
      id: "fix-thing",
      title: "fix-thing",
      enabled: true,
      // A spec's defaults are the sandbox agent's own model and effort.
      model: AGENT_MODEL,
      effort: AGENT_EFFORT,
      budgetUsd: 5,
      timeoutMinutes: 60,
      install: true,
      readOnly: false,
      allowedTools: undefined,
      extraAllowedTools: undefined,
      spec: "Do the thing.",
    });
  });

  it("accepts the ceilings themselves", () => {
    const text = `---\nid: a\nacceptance: x\nbudget_usd: ${String(MAX_BUDGET_USD)}\ntimeout_minutes: ${String(MAX_TIMEOUT_MINUTES)}\n---\nb`;
    const task = parseTask(text, "a.md");
    expect([task.budgetUsd, task.timeoutMinutes]).toEqual([MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES]);
  });

  it("tells an empty tool list from no key, so the launcher can refuse the key being there", () => {
    const none = parseTask("---\nid: a\nacceptance: x\n---\nb", "a.md");
    expect([none.allowedTools, none.extraAllowedTools]).toEqual([undefined, undefined]);
    const empty = parseTask("---\nid: a\nacceptance: x\nallowed_tools: []\nextra_allowed_tools: []\n---\nb", "a.md");
    expect([empty.allowedTools, empty.extraAllowedTools]).toEqual([[], []]);
  });

  it("still parses the tool keys, so the launcher can refuse them by name", () => {
    const task = parseTask("---\nid: a\nacceptance: x\nallowed_tools: [Read]\nextra_allowed_tools: [Bash(pnpm *)]\n---\nb", "a.md");
    expect([task.allowedTools, task.extraAllowedTools]).toEqual([["Read"], ["Bash(pnpm *)"]]);
  });

  it.each([
    ["an unknown key (a typo)", "---\nid: a\nacceptance: x\nbudget: 3\n---\nb", /budget/u],
    ["a missing acceptance command", "---\nid: a\n---\nb", /acceptance/u],
    ["an id that cannot name a branch", "---\nid: Fix Thing\nacceptance: x\n---\nb", /id/u],
    ["an empty spec", "---\nid: a\nacceptance: x\n---\n", /spec/u],
    ["a budget over the per-task ceiling", "---\nid: a\nacceptance: x\nbudget_usd: 80\n---\nb", /budget_usd/u],
    ["a budget at zero", "---\nid: a\nacceptance: x\nbudget_usd: 0\n---\nb", /budget_usd/u],
    ["a timeout over the limit", `---\nid: a\nacceptance: x\ntimeout_minutes: ${String(MAX_TIMEOUT_MINUTES + 1)}\n---\nb`, /timeout_minutes/u],
    ["a fractional timeout", "---\nid: a\nacceptance: x\ntimeout_minutes: 1.5\n---\nb", /timeout_minutes/u],
    ["an allowed tool that would parse as a flag", "---\nid: a\nacceptance: x\nallowed_tools: [Read, --dangerously-skip-permissions]\n---\nb", /must not start with/u],
    ["an extra tool that would parse as a flag", '---\nid: a\nacceptance: x\nextra_allowed_tools: ["--add-dir"]\n---\nb', /must not start with/u],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseTask(text, "a.md")).toThrow(message);
  });
});

describe("expandHome", () => {
  it("expands home-relative paths and leaves other paths alone", () => {
    expect(expandHome("%USERPROFILE%\\.k", "C:\\Users\\u")).toBe("C:\\Users\\u\\.k");
    expect(expandHome("~/k", "/home/u")).toBe("/home/u/k");
    expect(expandHome("D:\\x~", "/home/u")).toBe("D:\\x~");
  });
});

describe("protected paths", () => {
  it("flags deploy, environment and shared-ledger files only", () => {
    expect(
      protectedPathViolations([
        ".env",
        "packages/api/.env.production",
        "Dockerfile",
        "packages/api/Dockerfile.worker",
        "railway.toml",
        "vercel.json",
        ".github/workflows/ci.yml",
        ".claude/settings.json",
        "docs/state/tasks.md",
        "docs/sessions/2026-10-19.md",
        "packages\\web\\.npmrc",
      ]),
    ).toHaveLength(11);
    expect(
      protectedPathViolations(["packages/web/src/env.ts", "docs/environment.md", "packages/api/src/railway-client.ts", "docs/agents/x.md"]),
    ).toEqual([]);
  });

  it("rejects agent instructions, deploy config, install-time code and editor tasks, each under its own label", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["AGENTS.md", "agent instructions"],
      ["packages/api/AGENTS.override.md", "agent instructions"],
      ["packages/web/AGENTS.md", "agent instructions"],
      ["CLAUDE.md", "agent instructions"],
      ["tools/credit-runner/CLAUDE.md", "agent instructions"],
      ["CLAUDE.local.md", "agent instructions"],
      ["GOAL.md", "agent goals"],
      ["goals/EXECUTION.md", "agent goals"],
      [".claude/agents/deep-reviewer.md", "Claude Code config"],
      [".claude/skills/neon/SKILL.md", "Claude Code config"],
      [".claude/conventions/shipping-changes.md", "Claude Code config"],
      [".claude/gotchas/dockerfile-arg-scope.md", "Claude Code config"],
      [".claude/commands/ship.md", "Claude Code config"],
      ["packages/web/.claude/skills/x/SKILL.md", "Claude Code config"],
      [".claudeignore", "Claude Code ignore file"],
      ["skills-lock.json", "agent skills lock"],
      [".railway/railway.ts", "Railway config"],
      [".railway/watch-patterns.json", "Railway config"],
      [".railwayignore", "Railway config"],
      ["infra/runpod/bootstrap.sh", "infrastructure config"],
      ["infra/dev-db/docker-compose.yml", "infrastructure config"],
      ["patches/three@0.186.0.patch", "pnpm dependency patch, applied at install"],
      [".pnpmfile.cjs", "pnpm hook file, run at install"],
      ["packages/api/.pnpmfile.cjs", "pnpm hook file, run at install"],
      ["tools/x/.pnpmfile.mjs", "pnpm hook file, run at install"],
      ["pnpm-workspace.yaml", "pnpm workspace config"],
      [".vscode/tasks.json", "VS Code config"],
      ["packages/web/.vscode/settings.json", "VS Code config"],
      [".devcontainer/devcontainer.json", "dev container config"],
      [".devcontainer.json", "dev container config"],
    ];
    expect(protectedPathViolations(cases.map(([file]) => file))).toEqual(cases.map(([file, label]) => `${file} (${label})`));
    // The settings and hooks under .claude/ keep their own labels.
    expect(protectedPathViolations([".claude/settings.json", ".claude/hooks/pre.mjs"])).toEqual([
      ".claude/settings.json (Claude settings)",
      ".claude/hooks/pre.mjs (Claude hook)",
    ]);
  });

  it("matches the new entries in any letter case, with NTFS's trailing dots, and by 8.3 short name", () => {
    expect(
      protectedPathViolations([
        "agents.MD",
        "docs/Agents.md",
        "Goal.md.",
        ".CLAUDE/Skills/x.md",
        ".Railway/Railway.ts",
        "PATCHES/x.patch",
        ".PNPMFILE.CJS",
        "Pnpm-Workspace.YAML",
        ".VSCode/tasks.json",
        ".DevContainer/devcontainer.json",
        "INFRA/x.sh",
        "Goals/README.md",
      ]),
    ).toEqual([
      "agents.MD (agent instructions)",
      "docs/Agents.md (agent instructions)",
      "Goal.md. (agent goals)",
      ".CLAUDE/Skills/x.md (Claude Code config)",
      ".Railway/Railway.ts (Railway config)",
      "PATCHES/x.patch (pnpm dependency patch, applied at install)",
      ".PNPMFILE.CJS (pnpm hook file, run at install)",
      "Pnpm-Workspace.YAML (pnpm workspace config)",
      ".VSCode/tasks.json (VS Code config)",
      ".DevContainer/devcontainer.json (dev container config)",
      "INFRA/x.sh (infrastructure config)",
      "Goals/README.md (agent goals)",
    ]);
    expect(protectedPathViolations(["AGENTS~1.MD", ".RAILW~1/railway.ts", "PNPM-W~1.YAM", ".VSCOD~1/tasks.json", ".DEVCO~1/devcontainer.json"])).toEqual([
      "AGENTS~1.MD (8.3 short name, which Windows can resolve to a protected file or folder)",
      ".RAILW~1/railway.ts (8.3 short name, which Windows can resolve to a protected file or folder)",
      "PNPM-W~1.YAM (8.3 short name, which Windows can resolve to a protected file or folder)",
      ".VSCOD~1/tasks.json (8.3 short name, which Windows can resolve to a protected file or folder)",
      ".DEVCO~1/devcontainer.json (8.3 short name, which Windows can resolve to a protected file or folder)",
    ]);
  });

  it("rejects the manifests pnpm reads in place of package.json, in any folder and letter case, and lets their neighbours through", () => {
    const label = "package manifest that pnpm reads in place of package.json";
    expect(protectedPathViolations(["package.json5", "packages/web/package.json5", "package.yaml", "tools/x/Package.YAML", "packages/api/package.json5."])).toEqual([
      `package.json5 (${label})`,
      `packages/web/package.json5 (${label})`,
      `package.yaml (${label})`,
      `tools/x/Package.YAML (${label})`,
      `packages/api/package.json5. (${label})`,
    ]);
    // pnpm reads no other spelling, and a package.json is judged by its content.
    expect(protectedPathViolations(["package.yml", "docs/package.yaml.md", "src/package.json5.ts", "package.json", "packages/web/package.json"])).toEqual([]);
  });

  it("rejects a binding.gyp and anything under a node_modules/ folder, in any folder and letter case, and lets their neighbours through", () => {
    const gyp = "native addon build file, which pnpm builds with node-gyp on install";
    const installed = "installed packages folder";
    expect(
      protectedPathViolations(["binding.gyp", "packages/api/Binding.GYP", "node_modules/.hooks/postinstall", "packages/types/node_modules/typescript/bin/tsc", "Node_Modules./x.js"]),
    ).toEqual([
      `binding.gyp (${gyp})`,
      `packages/api/Binding.GYP (${gyp})`,
      `node_modules/.hooks/postinstall (${installed})`,
      `packages/types/node_modules/typescript/bin/tsc (${installed})`,
      `Node_Modules./x.js (${installed})`,
    ]);
    expect(protectedPathViolations(["docs/binding.gyp.md", "src/binding.gypi", "docs/node_modules.md", "src/node_modules_list.ts", "packages/web/src/my_node_modules/x.ts"])).toEqual([]);
  });

  it("rejects corepack's .corepack.env in any folder and letter case, and lets its neighbours through", () => {
    const label = "corepack config, read before pnpm runs";
    expect(protectedPathViolations([".corepack.env", "packages/web/.Corepack.ENV", "tools/x/.corepack.env."])).toEqual([
      `.corepack.env (${label})`,
      `packages/web/.Corepack.ENV (${label})`,
      `tools/x/.corepack.env. (${label})`,
    ]);
    expect(protectedPathViolations([".corepack.env.example", "docs/corepack.env.md", "src/corepack-env.ts"])).toEqual([]);
  });

  it("lets through nearby paths that are not those files", () => {
    expect(
      protectedPathViolations([
        "claude.md.txt",
        "AGENTS.override.md.bak",
        "docs/claude.md.txt",
        "docs/agents-guide.md",
        "docs/agents/overview.md",
        "docs/GOAL.md",
        "docs/goals/README.md",
        "packages/web/src/goals/plan.ts",
        "src/patches/x.ts",
        "packages/web/src/patches/fix.patch",
        "docs/claude/notes.md",
        ".claude-notes.md",
        "docs/vscode.md",
        "packages/web/src/infra/client.ts",
        "docs/pnpm-workspace.md",
        "src/pnpmfile.cjs",
        "docs/devcontainer.md",
        "docs/railway.md",
        "docs/skills-lock.md",
      ]),
    ).toEqual([]);
  });

  it("ignores letter case, Unicode form and trailing dots, as a Windows checkout does", () => {
    // NTFS opens each of these as the protected file.
    const variants = [".claude/Settings.local.json", ".Claude/settings.json", ".MCP.json", ".GITATTRIBUTES", ".Husky/pre-commit", ".ENV"];
    expect(protectedPathViolations(variants)).toEqual([
      ".claude/Settings.local.json (Claude settings)",
      ".Claude/settings.json (Claude settings)",
      ".MCP.json (MCP config)",
      ".GITATTRIBUTES (git attributes)",
      ".Husky/pre-commit (git hook)",
      ".ENV (environment file)",
    ]);
    // A decomposed accent inside a protected folder, and NTFS dropping a trailing dot.
    expect(protectedPathViolations(["docs/Sessions/café.md", "railway.json."])).toHaveLength(2);
    expect(protectedPathViolations(["docs/session-notes.md", "src/Environment.ts"])).toEqual([]);
  });

  it("treats an 8.3 short name as protected, since Windows can resolve it to .claude or .github", () => {
    expect(protectedPathViolations(["CLAUDE~1/settings.local.json", "GITHUB~1/workflows/x.yml", "docs/SESSIO~1/x.md"])).toEqual([
      "CLAUDE~1/settings.local.json (8.3 short name, which Windows can resolve to a protected file or folder)",
      "GITHUB~1/workflows/x.yml (8.3 short name, which Windows can resolve to a protected file or folder)",
      "docs/SESSIO~1/x.md (8.3 short name, which Windows can resolve to a protected file or folder)",
    ]);
    // Everything under .claude/ is protected, so a short name inside it is caught by that entry first.
    expect(protectedPathViolations([".claude/SETTIN~1.JSO"])).toEqual([".claude/SETTIN~1.JSO (Claude Code config)"]);
    // A tilde that is not a short name's ~N passes.
    expect(protectedPathViolations(["docs/notes~draft.md", "src/~utils/format.ts", "packages/web/src/home~1x.css"])).toEqual([]);
  });

  it("matches a Dockerfile and its variants, not a note that mentions one", () => {
    expect(protectedPathViolations(["Dockerfile", "packages/api/Dockerfile.worker", "packages/web/dockerfile"])).toHaveLength(3);
    expect(protectedPathViolations(["docs/gotchas/dockerfile-arg-scope.md", "docs/Dockerfiles.md"])).toEqual([]);
  });
});

describe("gitResult", () => {
  it("answers with git's own exit code when git exits before reading its stdin, and opens no stdin without input", async () => {
    const uncaught: unknown[] = [];
    const record = (error: unknown): void => {
      uncaught.push(error);
    };
    process.on("uncaughtException", record);
    try {
      // Far more than a pipe holds, to commands that read no stdin: git exits first, so the
      // write fails (EPIPE on Linux, EOF on Windows). git's exit code and stderr still answer.
      const flood = Buffer.alloc(8 * 1024 * 1024, 0x61);
      const version = await gitResult(tmpdir(), ["--version"], flood);
      expect(version.code).toBe(0);
      expect(version.stdout).toMatch(/^git version /u);
      const unknown = await gitResult(tmpdir(), ["no-such-subcommand"], flood);
      expect(unknown.code).not.toBe(0);
      expect(unknown.code).not.toBeNull();
      expect(unknown.stderr).toContain("no-such-subcommand");
      // Input that git does read arrives whole. Without input, git gets no stdin to read: a
      // command that reads stdin to its end answers at once, far inside the 2-minute limit
      // that would stop it if it were left waiting on an open pipe.
      vi.mocked(spawn).mockClear();
      expect((await gitResult(tmpdir(), ["hash-object", "--stdin"], Buffer.from("hello\n"))).stdout.trim()).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
      let limit: NodeJS.Timeout | undefined;
      const answer = await Promise.race([
        gitResult(tmpdir(), ["hash-object", "--stdin"]),
        new Promise<"still waiting">((resolve) => {
          limit = setTimeout(() => {
            resolve("still waiting");
          }, 20_000);
        }),
      ]);
      clearTimeout(limit);
      expect(answer === "still waiting" ? answer : answer.stdout.trim()).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
      // A pipe ended at once would answer the same, so the spawn itself shows that none was opened.
      expect(stdinModes()).toEqual(["pipe", "ignore"]);
      // A stream error is reported after the process closes, so give it time to surface.
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      process.off("uncaughtException", record);
    }
    expect(uncaught).toEqual([]);
  });

  it("names the git command a call ran, past its options, for a reason that says which limit stopped it", () => {
    expect(gitCommandName(["apply", "--cached", "x.diff"])).toBe("git apply");
    expect(gitCommandName(["-c", "core.ignorecase=false", "--attr-source=abc", "diff", "--cached"])).toBe("git diff");
    expect(gitCommandName(["--literal-pathspecs", "ls-tree", "-r"])).toBe("git ls-tree");
    expect(gitCommandName(["--version"])).toBe("git");
  });
});

describe("ledgerHasSession", () => {
  it("finds a line that charges the session, and nothing else", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ledger-session-"));
    try {
      const file = path.join(root, "ledger.jsonl");
      expect(await ledgerHasSession(file, "sesn_1")).toBe(false); // no ledger yet
      const line = (batchId: string | null) =>
        JSON.stringify({ ts: "2026-11-05T09:00:00.000Z", lane: "sandbox", job: "a4-trial:x", model: "m", requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 1.5, batchId });
      await writeFile(file, `${line("sesn_other")}\n{not json\n${line(null)}\n`);
      expect(await ledgerHasSession(file, "sesn_1")).toBe(false);
      await writeFile(file, `${line("sesn_other")}\n${line("sesn_1")}\n`);
      expect(await ledgerHasSession(file, "sesn_1")).toBe(true);
      // The id must be the line's batchId, not merely appear in it.
      await writeFile(file, `${JSON.stringify({ ts: "t", lane: "sandbox", job: "sesn_1", costUsd: 1, batchId: "sesn_2" })}\n`);
      expect(await ledgerHasSession(file, "sesn_1")).toBe(false);
      // A line booked before the session's id was known (an unclear create) names the run: the session's metadata `run` finds it.
      await writeFile(file, `${JSON.stringify({ ts: "t", lane: "sandbox", job: "j", costUsd: 4.5, costKnown: false, batchId: null, runId: "run-1" })}\n`);
      expect(await ledgerHasSession(file, "sesn_1", "run-1")).toBe(true);
      expect(await ledgerHasSession(file, "sesn_1", "run-2")).toBe(false);
      expect(await ledgerHasSession(file, "sesn_1")).toBe(false);
      // Only a string runId counts.
      await writeFile(file, `${JSON.stringify({ ts: "t", lane: "sandbox", job: "j", costUsd: 4.5, batchId: null, runId: null })}\n`);
      expect(await ledgerHasSession(file, "sesn_1", "null")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes a line's run id, and refuses a line with a key the ledger does not know", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ledger-line-"));
    try {
      const file = path.join(root, "ledger.jsonl");
      const line = { ts: "2026-11-05T09:00:00.000Z", lane: "sandbox", job: "a4-trial:x", model: "m", requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 4.5, batchId: null };
      await appendCreditLine(file, { ...line, costKnown: false, runId: "run-1" });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ...line, costKnown: false, runId: "run-1" });
      await expect(appendCreditLine(file, { ...line, ...{ note: "extra" } })).rejects.toThrow();
      expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("key files", () => {
  it("finds every grant beyond the owner, SYSTEM and Administrators in icacls output, and ignores deny entries", () => {
    const file = "C:\\Users\\u\\keys\\pot-1.key";
    const expected = ["HOST\\u", "NT AUTHORITY\\SYSTEM", "BUILTIN\\Administrators"];
    const privateAcl = [
      `${file} NT AUTHORITY\\SYSTEM:(I)(F)`,
      "                                         BUILTIN\\Administrators:(I)(F)",
      "                                         HOST\\u:(I)(F)",
      "",
      "Successfully processed 1 files; Failed processing 0 files",
    ].join("\r\n");
    expect(unexpectedPrincipals(privateAcl, file, expected)).toEqual([]);
    const openAcl = `${privateAcl}\r\n   BUILTIN\\Users:(I)(RX)\r\n   Everyone:(R)\r\n   NT AUTHORITY\\Authenticated Users:(I)(M)\r\n   Everyone:(I)(DENY)(W)`;
    expect(unexpectedPrincipals(openAcl, file, expected).sort()).toEqual(["BUILTIN\\Users", "Everyone", "NT AUTHORITY\\Authenticated Users"]);
    // Narrow grants count too: a user's temp folder can also grant a sandbox group and an unresolved SID.
    const sandboxAcl = `${file} HOST\\SandboxGroup:(I)(M)\r\n   S-1-5-21-1-2-3-1001:(I)(M)\r\n   host\\U:(I)(F)`;
    expect(unexpectedPrincipals(sandboxAcl, file, expected)).toEqual(["HOST\\SandboxGroup", "S-1-5-21-1-2-3-1001"]);
  });

  // Each platform's CI runs its own branch of keyFileExposure on a real file.
  it.runIf(process.platform === "win32")("reads a real key file's ACL: private when only its owner may open it, exposed once Everyone may", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-acl-"));
    try {
      const file = path.join(dir, "test.key");
      await writeFile(file, "not a key\n");
      // The owner as keyFileExposure names it; inherited grants removed, as setup-keys.ps1 does.
      const owner = `${process.env.USERDOMAIN ?? ""}\\${userInfo().username}`;
      execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${owner}:F`], { windowsHide: true });
      expect(await keyFileExposure(file)).toEqual([]);
      execFileSync("icacls", [file, "/grant", "*S-1-1-0:R"], { windowsHide: true }); // Everyone, by its well-known SID
      const exposure = await keyFileExposure(file);
      expect(exposure).toHaveLength(1);
      expect(exposure[0]).toMatch(/^readable by '/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("reads a real key file's mode: private at 0600, exposed at 0644", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-mode-"));
    try {
      const file = path.join(dir, "test.key");
      await writeFile(file, "not a key\n");
      await chmod(file, 0o600);
      expect(await keyFileExposure(file)).toEqual([]);
      await chmod(file, 0o644);
      expect(await keyFileExposure(file)).toEqual(["mode allows group/other access (644)"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts one key line and never echoes a malformed file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-key-"));
    try {
      const good = path.join(dir, "good.key");
      await writeFile(good, "  sk-ant-api03-abcdefghijklmnopqrstuvwxyz\r\n");
      await expect(readKey(good)).resolves.toBe("sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
      const bad = path.join(dir, "bad.key");
      await writeFile(bad, "sk-ant-api03-SECRETVALUE-but two lines\nmore");
      await expect(readKey(bad)).rejects.toThrow(/does not hold an Anthropic API key/u);
      await expect(readKey(bad)).rejects.not.toThrow(/SECRETVALUE/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

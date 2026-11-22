import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome } from "../config.js";
import { FrontmatterError, parseFrontmatter } from "../frontmatter.js";
import { gitResult, protectedPathViolations } from "../git.js";
import { ledgerHasSession } from "../sandbox/credit-ledger.js";
import { keyFileExposure, readKey, unexpectedPrincipals } from "../keys.js";
import { AGENT_EFFORT, AGENT_MODEL, MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES, parseTask } from "../task.js";

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
      protectedPathViolations(["packages/web/src/env.ts", "docs/environment.md", "packages/api/src/railway-client.ts", ".claude/agents/x.md"]),
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
    expect(protectedPathViolations(["CLAUDE~1/settings.local.json", "GITHUB~1/workflows/x.yml", ".claude/SETTIN~1.JSO"])).toEqual([
      "CLAUDE~1/settings.local.json (8.3 short name, which Windows can resolve to a protected file or folder)",
      "GITHUB~1/workflows/x.yml (8.3 short name, which Windows can resolve to a protected file or folder)",
      ".claude/SETTIN~1.JSO (8.3 short name, which Windows can resolve to a protected file or folder)",
    ]);
    // A tilde that is not a short name's ~N passes.
    expect(protectedPathViolations(["docs/notes~draft.md", "src/~utils/format.ts", "packages/web/src/home~1x.css"])).toEqual([]);
  });

  it("matches a Dockerfile and its variants, not a note that mentions one", () => {
    expect(protectedPathViolations(["Dockerfile", "packages/api/Dockerfile.worker", "packages/web/dockerfile"])).toHaveLength(3);
    expect(protectedPathViolations([".claude/gotchas/dockerfile-arg-scope.md", "docs/Dockerfiles.md"])).toEqual([]);
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
      // Input that git does read arrives whole; with no input, git reads an empty stdin at once.
      expect((await gitResult(tmpdir(), ["hash-object", "--stdin"], Buffer.from("hello\n"))).stdout.trim()).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
      expect((await gitResult(tmpdir(), ["hash-object", "--stdin"])).stdout.trim()).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
      // A stream error is reported after the process closes, so give it time to surface.
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      process.off("uncaughtException", record);
    }
    expect(uncaught).toEqual([]);
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

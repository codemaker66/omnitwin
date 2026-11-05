import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canAfford, isExpired, localDate, orderOrgs } from "../budget.js";
import { buildClaudeArgs } from "../claude.js";
import { expandHome, parseConfig } from "../config.js";
import { claudeChildEnv, PUSH_DISABLED_URL, toolChildEnv } from "../env.js";
import { FrontmatterError, parseFrontmatter } from "../frontmatter.js";
import { protectedPathViolations } from "../git.js";
import { readKey, unexpectedPrincipals } from "../keys.js";
import { redactAll } from "../proc.js";
import { buildSystemPrompt } from "../prompt.js";
import { classifyLine, detectStopSignal, extractSummary } from "../stream.js";
import { DEFAULT_ALLOWED_TOOLS, DEFAULT_MODEL, parseTask, READ_ONLY_TOOLS } from "../task.js";

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
      model: DEFAULT_MODEL,
      effort: "high",
      budgetUsd: 5,
      timeoutMinutes: 60,
      install: true,
      readOnly: false,
      spec: "Do the thing.",
    });
    expect(task.allowedTools).toEqual(DEFAULT_ALLOWED_TOOLS);
  });

  it("appends extra tools and gives read-only tasks inspection tools only", () => {
    const extra = parseTask("---\nid: a\nacceptance: x\nextra_allowed_tools: [WebFetch, Bash(pnpm *)]\n---\nb", "a.md");
    expect(extra.allowedTools).toEqual([...DEFAULT_ALLOWED_TOOLS, "WebFetch"]);
    const readOnly = parseTask("---\nid: a\nacceptance: x\nread_only: true\n---\nb", "a.md");
    expect(readOnly.allowedTools).toEqual(READ_ONLY_TOOLS);
    expect(readOnly.allowedTools).not.toContain("Edit");
  });

  it.each([
    ["an unknown key (a typo)", "---\nid: a\nacceptance: x\nbudget: 3\n---\nb", /budget/u],
    ["a missing acceptance command", "---\nid: a\n---\nb", /acceptance/u],
    ["an id that cannot name a branch", "---\nid: Fix Thing\nacceptance: x\n---\nb", /id/u],
    ["an empty spec", "---\nid: a\nacceptance: x\n---\n", /spec/u],
    ["a budget over the per-task ceiling", "---\nid: a\nacceptance: x\nbudget_usd: 80\n---\nb", /budget_usd/u],
    ["tools on a read-only task", "---\nid: a\nacceptance: x\nread_only: true\nextra_allowed_tools: [Edit]\n---\nb", /read_only/u],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseTask(text, "a.md")).toThrow(message);
  });
});

describe("config", () => {
  const raw = {
    nightlyCapUsd: 20,
    runsRoot: "~/runs",
    outputRoot: "%USERPROFILE%/out",
    keyDir: "%USERPROFILE%/.venviewer-credits",
    baseRef: "origin/master",
    branchPrefix: "credit/",
    claudeCommand: ["claude"],
    orgs: [{ id: "batch", name: "VenViewer Batch", keyFile: "batch.key", expires: "2026-11-10" }],
  };

  it("expands home-relative paths", () => {
    expect(expandHome("%USERPROFILE%\\.k", "C:\\Users\\b")).toBe("C:\\Users\\b\\.k");
    expect(expandHome("~/k", "/home/b")).toBe("/home/b/k");
    expect(expandHome("D:\\x~", "/home/b")).toBe("D:\\x~");
    expect(path.isAbsolute(parseConfig(raw).keyDir)).toBe(true);
  });

  it("rejects duplicate org ids and key files with path parts", () => {
    expect(() => parseConfig({ ...raw, orgs: [...raw.orgs, ...raw.orgs] })).toThrow(/duplicate org id/u);
    expect(() => parseConfig({ ...raw, orgs: [{ ...raw.orgs[0], keyFile: "../batch.key" }] })).toThrow(/bare file name/u);
  });
});

describe("child environments", () => {
  const parent = {
    PATH: "/usr/bin",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    ANTHROPIC_API_KEY: "sk-ant-parent-should-not-leak",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    Claude_Code_Session_Id: "mixed-case",
    CLAUDECODE: "1",
    GIT_ASKPASS: "helper.exe",
    GIT_CONFIG_COUNT: "1",
    GH_TOKEN: "ghp_real",
    RAILWAY_TOKEN: "real",
    VERCEL_TOKEN: "real",
    DATABASE_URL: "postgres://prod",
    HOME: "/home/b",
  };

  it("drops Anthropic, Claude session, git helper and hosted-service variables", () => {
    const env = toolChildEnv(parent);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/b");
    for (const name of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "Claude_Code_Session_Id", "CLAUDECODE", "GIT_ASKPASS", "VERCEL_TOKEN", "DATABASE_URL"]) {
      expect(env, name).not.toHaveProperty(name);
    }
    expect(env.GH_TOKEN).not.toBe("ghp_real");
    expect(env.RAILWAY_TOKEN).not.toBe("real");
  });

  it("disables pushing and credential helpers for every git call", () => {
    const env = toolChildEnv(parent);
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect([env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_VALUE_0]).toEqual(["remote.origin.pushurl", PUSH_DISABLED_URL]);
    expect([env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1]).toEqual(["credential.helper", ""]);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("gives claude the org key and an isolated config folder, and nothing else from Anthropic", () => {
    const env = claudeChildEnv(parent, "sk-ant-org-key", "E:\\runs\\.claude-config");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-org-key");
    expect(env.CLAUDE_CONFIG_DIR).toBe("E:\\runs\\.claude-config");
    expect(Object.keys(env).filter((name) => /^(ANTHROPIC_|CLAUDE)/iu.test(name)).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "CLAUDE_CONFIG_DIR",
    ]);
  });
});

describe("stream-json parsing", () => {
  it("recognises init and result messages", () => {
    const init = classifyLine(JSON.stringify({ type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY", model: "claude-opus-5-5", session_id: "s", tools: [] }));
    expect(init).toEqual({ kind: "init", init: { type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY", model: "claude-opus-5-5", session_id: "s" } });
    const result = classifyLine(
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0.5, num_turns: 4, duration_ms: 10, session_id: "s" }),
    );
    expect(result.kind).toBe("result");
    expect(classifyLine('{"type":"assistant"}')).toEqual({ kind: "other" });
    expect(classifyLine("Error: something")).toEqual({ kind: "not-json" });
  });

  it("spots the two stop signals and nothing else", () => {
    expect(detectStopSignal("Your credit balance is too low to access the Anthropic API.")).toBe("credit-exhausted");
    expect(detectStopSignal(undefined, "Credit balance too low")).toBe("credit-exhausted");
    expect(detectStopSignal("Invalid API key · Please run /login")).toBe("auth-failed");
    expect(detectStopSignal('{"type":"authentication_error"}')).toBe("auth-failed");
    expect(detectStopSignal("Tests failed: 3 of 40")).toBeNull();
  });

  it("extracts the summary section, or the tail of the message", () => {
    expect(extractSummary("Work...\n\n## Summary\nChanged a.ts\nTests pass")).toBe("Changed a.ts\nTests pass");
    expect(extractSummary(undefined)).toBe("(the agent produced no final message)");
    expect(extractSummary(`${"x".repeat(50)}END`, 10)).toBe("…xxxxxxxEND");
  });
});

describe("budget", () => {
  it("spends the soonest-expiring org first and keeps undated orgs last", () => {
    const orgs = [{ id: "prod" }, { id: "staging", expires: "2026-11-16" }, { id: "batch", expires: "2026-11-10" }];
    expect(orderOrgs(orgs).map((org) => org.id)).toEqual(["batch", "staging", "prod"]);
  });

  it("treats the expiry date itself as still spendable", () => {
    expect(isExpired({ expires: "2026-11-10" }, "2026-11-10")).toBe(false);
    expect(isExpired({ expires: "2026-11-10" }, "2026-11-11")).toBe(true);
    expect(isExpired({}, "2099-01-01")).toBe(false);
  });

  it("starts a task only when its whole budget fits under the cap", () => {
    expect(canAfford(15, 5, 20)).toBe(true);
    expect(canAfford(15.01, 5, 20)).toBe(false);
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
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
});

describe("key files", () => {
  it("finds every grant beyond the owner, SYSTEM and Administrators in icacls output, and ignores deny entries", () => {
    const file = "C:\\Users\\blake\\.venviewer-credits\\batch.key";
    const expected = ["DESKTOP-1\\blake", "NT AUTHORITY\\SYSTEM", "BUILTIN\\Administrators"];
    const privateAcl = [
      `${file} NT AUTHORITY\\SYSTEM:(I)(F)`,
      "                                         BUILTIN\\Administrators:(I)(F)",
      "                                         DESKTOP-1\\blake:(I)(F)",
      "",
      "Successfully processed 1 files; Failed processing 0 files",
    ].join("\r\n");
    expect(unexpectedPrincipals(privateAcl, file, expected)).toEqual([]);
    const openAcl = `${privateAcl}\r\n   BUILTIN\\Users:(I)(RX)\r\n   Everyone:(R)\r\n   NT AUTHORITY\\Authenticated Users:(I)(M)\r\n   Everyone:(I)(DENY)(W)`;
    expect(unexpectedPrincipals(openAcl, file, expected).sort()).toEqual(["BUILTIN\\Users", "Everyone", "NT AUTHORITY\\Authenticated Users"]);
    // Narrow grants count too: a user's temp folder on this PC also grants a sandbox group and an unresolved SID.
    const sandboxAcl = `${file} Blake\\CodexSandboxUsers:(I)(M)\r\n   S-1-5-21-1-2-3-1001:(I)(M)\r\n   desktop-1\\BLAKE:(I)(F)`;
    expect(unexpectedPrincipals(sandboxAcl, file, expected)).toEqual(["Blake\\CodexSandboxUsers", "S-1-5-21-1-2-3-1001"]);
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

  it("redacts secrets from anything logged", () => {
    expect(redactAll("key=sk-ant-abcdefgh end", ["sk-ant-abcdefgh"])).toBe("key=[REDACTED] end");
  });
});

describe("claude invocation", () => {
  const args = buildClaudeArgs({
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 4.5,
    allowedTools: ["Read", "Bash(git commit *)"],
    readOnly: false,
    settingsFile: "S:\\runner-settings.json",
    systemPromptFile: "D:\\logs\\t.system-prompt.md",
    session: { kind: "new", id: "11111111-1111-4111-8111-111111111111" },
  });
  const after = (name: string): string | undefined => args[args.indexOf(name) + 1];

  it("can only bill the API key and loads none of the repo's own settings", () => {
    expect(args.slice(0, 2)).toEqual(["-p", "--bare"]);
    expect(after("--setting-sources")).toBe("user");
    expect(args).toContain("--strict-mcp-config");
    expect(after("--permission-prompts")).toBe("none");
    expect(after("--permission-mode")).toBe("acceptEdits");
    expect(args.join(" ")).not.toMatch(/dangerously|bypassPermissions/u);
  });

  it("passes the budget, session and tools, with the variadic tool list last", () => {
    expect(after("--max-budget-usd")).toBe("4.50");
    expect(after("--session-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(args.slice(-3)).toEqual(["--allowedTools", "Read", "Bash(git commit *)"]);
    const resumed = buildClaudeArgs({
      model: "m",
      effort: "low",
      budgetUsd: 1,
      allowedTools: [],
      readOnly: false,
      settingsFile: "s",
      systemPromptFile: "p",
      session: { kind: "resume", id: "abc" },
    });
    expect(resumed).toContain("--resume");
    expect(resumed).not.toContain("--session-id");
  });

  it("gives a run Edit only when it may write, and approves edits only then", () => {
    expect(after("--tools")).toBe("Bash,Edit,Read");
    const readOnly = buildClaudeArgs({
      model: "m",
      effort: "low",
      budgetUsd: 1,
      allowedTools: READ_ONLY_TOOLS,
      readOnly: true,
      settingsFile: "s",
      systemPromptFile: "p",
      session: { kind: "new", id: "abc" },
    });
    expect(readOnly[readOnly.indexOf("--tools") + 1]).toBe("Bash,Read");
    expect(readOnly[readOnly.indexOf("--permission-mode") + 1]).toBe("default");
    expect(readOnly).toContain("--bare");
  });
});

describe("system prompt", () => {
  const task = parseTask("---\nid: t-582\ntitle: Stop the poller\nacceptance: pnpm --filter @omnitwin/web test\n---\nSpec.", "t.md");
  const prompt = buildSystemPrompt(
    { task, branch: "credit/t-582", worktree: "E:\\venviewer-runs\\t-582", baseRef: "origin/master", baseSha: "0123456789abcdef" },
    "# OMNITWIN\nRead GOAL.md first.",
  );

  it("puts the fixed rules ahead of CLAUDE.md and names the run's facts", () => {
    expect(prompt.indexOf("## Fixed rules")).toBeLessThan(prompt.indexOf("## Project instructions"));
    expect(prompt).toContain("credit/t-582");
    expect(prompt).toContain("0123456789ab");
    expect(prompt).toContain("`pnpm --filter @omnitwin/web test`");
    expect(prompt).toContain("Never push");
    expect(prompt).toContain("Credit-Runner-Task: t-582");
    expect(prompt).toContain("Read GOAL.md first.");
    expect(prompt).not.toContain("READ-ONLY");
  });
});

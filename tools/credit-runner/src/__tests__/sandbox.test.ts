import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BetaManagedAgentsAgentToolResultEvent,
  BetaManagedAgentsAgentToolUseEvent,
  BetaManagedAgentsSessionStatusIdleEvent,
  BetaManagedAgentsSessionStatusRunningEvent,
  BetaManagedAgentsSpanModelRequestEndEvent,
  BetaManagedAgentsSpanOutcomeEvaluationEndEvent,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { afterEach, describe, expect, it } from "vitest";
import { nightRulesFromAgentsMd } from "../project-rules.js";
import type { SandboxApi, SessionEvent } from "../sandbox/api.js";
import { outcomeFor, sandboxSystemPrompt, VERIFY_COMMAND } from "../sandbox/brief.js";
import { checkSpend, readCreditLedger } from "../sandbox/credit-ledger.js";
import { collectSandboxJob, runSandboxJob, type LauncherConfig } from "../sandbox/launcher.js";
import { centsString, invokesVerifier, safeOutputName } from "../sandbox/session.js";
import { ensureSandbox } from "../sandbox/setup.js";
import { parseTask } from "../task.js";
import { DEFAULT_FILES, FakeApi, HEAD } from "./fake-api.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BASE = "b".repeat(40);

const task = parseTask(
  [
    "---",
    "id: robots-wildcards",
    "title: Match robots.txt wildcards in linear time",
    "budget_usd: 4.5",
    "timeout_minutes: 60",
    'acceptance: "pnpm --filter @omnitwin/api exec vitest run src/__tests__/page-check.test.ts"',
    "precondition: \"grep -q 'join(\\\".*\\\")' packages/api/src/services/page-check.ts\"",
    "---",
    "Replace the regex built from robots.txt wildcards with a linear matcher.",
  ].join("\n"),
  "robots.md",
);

const AT = "2026-11-05T10:00:00.000Z";

function running(id: string): BetaManagedAgentsSessionStatusRunningEvent {
  return { id, type: "session.status_running", processed_at: AT };
}

function modelEnd(id: string, input: number, output: number, cacheRead: number, cacheWrite: number): BetaManagedAgentsSpanModelRequestEndEvent {
  return {
    id,
    type: "span.model_request_end",
    processed_at: AT,
    is_error: false,
    model_request_start_id: `${id}-start`,
    model_usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite },
  };
}

function bash(id: string, command: string, permission: "allow" | "ask" = "allow"): BetaManagedAgentsAgentToolUseEvent {
  return { id, type: "agent.tool_use", processed_at: AT, name: "bash", input: { command }, evaluated_permission: permission };
}

function toolResult(id: string, toolUseId: string, text: string): BetaManagedAgentsAgentToolResultEvent {
  return { id, type: "agent.tool_result", processed_at: AT, tool_use_id: toolUseId, content: [{ type: "text", text }] };
}

function graded(id: string, result: string): BetaManagedAgentsSpanOutcomeEvaluationEndEvent {
  return {
    id,
    type: "span.outcome_evaluation_end",
    processed_at: AT,
    result,
    explanation: "All criteria met.",
    iteration: 0,
    outcome_evaluation_start_id: `${id}-start`,
    outcome_id: "outc_1",
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function idle(id: string): BetaManagedAgentsSessionStatusIdleEvent {
  return { id, type: "session.status_idle", processed_at: AT, stop_reason: { type: "end_turn" }, stop_details: null };
}

const verifyOk = JSON.stringify({
  ok: true,
  head: HEAD,
  problems: [],
  changed: ["M packages/api/src/services/page-check.ts", "M packages/api/src/__tests__/page-check.test.ts"],
});

function happyEvents(command = VERIFY_COMMAND): SessionEvent[] {
  return [
    running("e1"),
    modelEnd("e2", 100, 50, 1000, 200),
    bash("e3", command),
    toolResult("e4", "e3", `noise\nVERIFY_RESULT ${verifyOk}\n`),
    modelEnd("e5", 10, 5, 2000, 0),
    graded("e6", "satisfied"),
    idle("e7"),
  ];
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function writeTemp(text: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ledger-"));
  dirs.push(root);
  const file = path.join(root, "ledger.jsonl");
  await writeFile(file, text);
  return file;
}

async function workspace(ledger = ""): Promise<LauncherConfig> {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-"));
  dirs.push(root);
  const ledgerFile = path.join(root, "ledger.jsonl");
  if (ledger !== "") await writeFile(ledgerFile, ledger);
  return { workRoot: path.join(root, "work"), ledgerFile, lane: "sandbox", laneCapUsd: 110, orgCapUsd: 190 };
}

function job(api: SandboxApi, config: LauncherConfig) {
  return runSandboxJob({
    api,
    config,
    task,
    job: "a4-trial",
    budgetUsd: 4.5,
    timeoutMinutes: 60,
    baseSha: BASE,
    projectRules: "# Rules\n\nTypeScript stays strict.\n",
    verifyScript: "// verify",
  });
}

describe("sandbox launcher", () => {
  it("runs one session with a hard budget, trusts the verifier's own output, records the platform's cost and reviews", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents() }]);
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);

    const created = api.sessions[0];
    expect(created?.budget).toEqual({ type: "limit", max_list_cost: { amount: "450", currency: "USD" } });
    expect(created?.agent).toEqual({ type: "agent", id: "agent_1", version: 1 });
    expect(created?.resources?.map((resource) => ("mount_path" in resource ? resource.mount_path : null))).toEqual(["/verify.mjs", "/task.json"]);
    expect(created?.initial_events?.[0]?.type).toBe("user.define_outcome");
    expect(api.uploads.map((upload) => upload.name)).toEqual(["verify.mjs", "task.json"]);
    expect(JSON.parse(api.uploads[1]?.data ?? "{}")).toMatchObject({ id: "robots-wildcards", baseSha: BASE, repoDir: "/workspace/omnitwin" });

    expect(record.result.verify?.ok).toBe(true);
    expect(record.result.verifyRuns).toBe(1);
    expect(record.result.requests).toBe(2);
    expect(record.costUsd).toBeCloseTo(2.87);
    expect(record.review.reasons).toEqual([]);
    expect(record.review.verdict).toBe("ready-for-review");

    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({
      lane: "sandbox",
      job: "a4-trial:robots-wildcards",
      model: "claude-opus-5-5",
      requests: 2,
      inputTokens: 110 + 3000 + 200,
      outputTokens: 55,
      costUsd: 2.87,
      batchId: "sesn_1",
    });
    expect(Object.keys(line).sort()).toEqual(["batchId", "costUsd", "inputTokens", "job", "lane", "model", "outputTokens", "requests", "ts"]);
    expect(await readFile(path.join(record.runDir, "review.md"), "utf8")).toContain("READY FOR REVIEW");
    // The session's copy of an uploaded input is listed but cannot be downloaded: skipped, not fatal.
    expect(record.result.skippedOutputs).toEqual(["verify.mjs"]);
    expect(record.result.outputs.map((file) => path.basename(file))).toEqual(["0001-Match-robots.patch", "diff.patch", "report.md"]);
    expect(record.review.patches.map((file) => path.basename(file))).toEqual(["0001-Match-robots.patch"]);
  });

  it("counts the verifier when the agent runs it after a cd and prints its log in the same call, as in the A4 trial", async () => {
    const config = await workspace();
    const command = `cd /workspace/omnitwin; ${VERIFY_COMMAND} > /mnt/session/outputs/logs/verify.log 2>&1; echo rc=$?; grep VERIFY_RESULT /mnt/session/outputs/logs/verify.log`;
    const record = await job(new FakeApi([{ history: [], stream: happyEvents(command) }]), config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.verifyRuns).toBe(1);
    expect(record.result.verify?.ok).toBe(true);
    expect(invokesVerifier("cat /mnt/session/uploads/verify.mjs")).toBe(false);
    expect(invokesVerifier("node /mnt/session/uploads/verify.mjs.bak")).toBe(false);
  });

  it("collects a finished session from its history without starting or charging anything", async () => {
    const config = await workspace();
    const events = happyEvents();
    const api = new FakeApi([{ history: events, stream: [] }]);
    const runDir = path.join(config.workRoot, "runs", "robots-wildcards", "recollected");
    const record = await collectSandboxJob({ api, task, sessionId: "sesn_1", runDir, baseSha: BASE });
    expect(api.sessions).toHaveLength(0);
    expect(record.review.verdict).toBe("ready-for-review");
    expect(record.result.requests).toBe(2);
    expect(record.costUsd).toBeCloseTo(2.87);
    expect((await readCreditLedger(config.ledgerFile)).lines).toHaveLength(0);
  });

  it("ignores a VERIFY_RESULT line printed by any other command", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(`echo 'VERIFY_RESULT ${verifyOk}'`) }]);
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.verify).toBeNull();
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("the verifier was never run as instructed, so nothing proves the change");
  });

  it("rejects a run whose last patch is not the commit the verifier checked", async () => {
    const config = await workspace();
    const stale = { ...DEFAULT_FILES, "0001-Match-robots.patch": `From ${"c".repeat(40)} Mon Sep 17 00:00:00 2001\n` };
    const record = await job(new FakeApi([{ history: [], stream: happyEvents() }], stale), config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons.join(" ")).toContain("but the verifier checked");
  });

  it("denies a call that asks for approval, because nobody is watching", async () => {
    const config = await workspace();
    const events = happyEvents();
    events.splice(1, 0, bash("ask1", "rm -rf /", "ask"));
    const api = new FakeApi([{ history: [], stream: events }]);
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(api.sent).toEqual([expect.objectContaining({ type: "user.tool_confirmation", tool_use_id: "ask1", result: "deny" })]);
    expect(record.review.flags.join(" ")).toContain("denied");
  });

  it("reconnects after a dropped stream, reads the history first and counts each event once", async () => {
    const config = await workspace();
    const events = happyEvents();
    const api = new FakeApi([
      { history: [], stream: events, dropAfter: 3 },
      { history: events.slice(0, 4), stream: events },
    ]);
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.errors).toEqual(["stream: socket hang up"]);
    expect(record.result.requests).toBe(2);
    expect(record.result.verifyRuns).toBe(1);
    const logged = (await readFile(path.join(record.runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(logged).toHaveLength(events.length);
  }, 20_000);

  it("starts nothing when the budget does not fit the lane, the org or the night", async () => {
    const prior = `${JSON.stringify({ ts: "2026-11-05T09:00:00.000Z", lane: "sandbox", job: "a4-trial:x", model: "m", requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 108, batchId: null })}\n`;
    const config = await workspace(prior);
    const api = new FakeApi([{ history: [], stream: happyEvents() }]);
    expect(await job(api, config)).toMatchObject({ kind: "skipped" });
    expect(api.sessions).toHaveLength(0);

    const limits = { laneCapUsd: 110, orgCapUsd: 190 };
    const otherLane = await readCreditLedger(await writeTemp(`${JSON.stringify({ ts: "t", lane: "batches", job: "a1", costUsd: 187 })}\n`));
    expect(checkSpend(otherLane, "sandbox", 4.5, limits).reason).toContain("org cap");
    const night = await readCreditLedger(await writeTemp(`${JSON.stringify({ ts: "t", lane: "sandbox", job: "night-1:a", costUsd: 22 })}\n`));
    expect(checkSpend(night, "sandbox", 4.5, { ...limits, nightCapUsd: 25 }, "night-1:").ok).toBe(false);
    expect(checkSpend(night, "sandbox", 2.5, { ...limits, nightCapUsd: 25 }, "night-1:").ok).toBe(true);
    const broken = await readCreditLedger(await writeTemp("{not json\n"));
    expect(checkSpend(broken, "sandbox", 1, limits).ok).toBe(false);
  });

  it("still charges a session that failed after it started, at the platform's figure", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents() }]);
    api.failOutputs = true;
    await expect(job(api, config)).rejects.toThrow("files API down");
    const ledger = await readCreditLedger(config.ledgerFile);
    expect(ledger.lines.map((line) => line.costUsd)).toEqual([2.87]);
  });

  it("creates the environment and agent once and versions the agent when its prompt changes", async () => {
    const config = await workspace();
    const api = new FakeApi([]);
    const stateFile = path.join(config.workRoot, "state.json");
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    expect([api.environmentCreates, api.agentCreates, api.agentUpdates]).toEqual([1, 1, 0]);
    const state = await ensureSandbox(api, stateFile, "prompt two", () => undefined);
    expect([api.environmentCreates, api.agentCreates, api.agentUpdates]).toEqual([1, 1, 1]);
    expect(state.agentVersion).toBe(2);
  });
});

describe("sandbox brief", () => {
  it("never tells the sandbox agent where secrets live, and keeps the engineering rules", async () => {
    const prompt = sandboxSystemPrompt(nightRulesFromAgentsMd(await readFile(path.join(repoRoot, "AGENTS.md"), "utf8")));
    expect(prompt).not.toMatch(/deploy-secrets/iu);
    expect(prompt).toContain(VERIFY_COMMAND);
    expect(prompt).toMatch(/TypeScript stays strict/u);
    expect(prompt.indexOf("## Fixed rules")).toBeLessThan(prompt.indexOf("## Project instructions"));
  });

  it("puts the base, branch, acceptance and precondition in the kickoff", () => {
    const { description, rubric } = outcomeFor({ task, baseSha: BASE, branch: "credit/robots-wildcards" });
    expect(description).toContain(BASE);
    expect(description).toContain("credit/robots-wildcards");
    expect(description).toContain(task.acceptance);
    expect(description).toContain("Precondition");
    expect(rubric).toContain('"ok":true');
  });

  it("keeps downloaded file names inside the run folder and prices budgets in cents", () => {
    expect(safeOutputName("../../etc/passwd")).toBe("etc__passwd");
    expect(safeOutputName("patches/0001-fix.patch")).toBe("patches__0001-fix.patch");
    expect(centsString(4.5)).toBe("450");
    expect(centsString(25)).toBe("2500");
    expect(() => centsString(0)).toThrow();
  });
});

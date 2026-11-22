import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsAgentToolResultEvent,
  BetaManagedAgentsAgentToolUseEvent,
  BetaManagedAgentsSessionStatusIdleEvent,
  BetaManagedAgentsSessionStatusRunningEvent,
  BetaManagedAgentsSessionStatusTerminatedEvent,
  BetaManagedAgentsSpanModelRequestEndEvent,
  BetaManagedAgentsSpanOutcomeEvaluationEndEvent,
  BetaManagedAgentsUserToolConfirmationEvent,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { gitEnv } from "../git.js";
import { nightRulesFromAgentsMd } from "../project-rules.js";
import {
  ANTHROPIC_API_URL,
  anthropicEnvironmentProblems,
  CREATE_SESSION_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  isAmbiguousFailure,
  keyOnlyToAnthropic,
  sdkSandboxApi,
  type AgentRef,
  type AgentTool,
  type EnvironmentRef,
  type SandboxApi,
  type SessionEvent,
} from "../sandbox/api.js";
import { outcomeFor, promptSha, sandboxSystemPrompt, VERIFY_COMMAND } from "../sandbox/brief.js";
import { appendCreditLine, checkSpend, readCreditLedger } from "../sandbox/credit-ledger.js";
import { collectSandboxJob, inlineCode, reviewMarkdown, runSandboxJob, type JobOptions, type JobRecord, type LauncherConfig } from "../sandbox/launcher.js";
import {
  isWindowsDeviceName,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUTS_TOTAL_BYTES,
  MAX_PATCH_OUTPUTS,
  OutputTimeoutError,
  OutputTooLargeError,
  planOutputs,
  writeCapped,
} from "../sandbox/outputs.js";
import { unquoteGitPath } from "../sandbox/patches.js";
import { ADVISORY_FLAG, type Review } from "../sandbox/review.js";
import { centsString, invokesVerifier, LOOKUP_CLOCK_SKEW_MS, parseVerifyOutput, runSession, SessionMayExistError, type SessionRunResult } from "../sandbox/session.js";
import { ensureSandbox } from "../sandbox/setup.js";
import { MAX_BUDGET_USD, MAX_TIMEOUT_MINUTES, parseTask } from "../task.js";
import { FakeApi, PROJECT_RULES } from "./fake-api.js";
import { BASE_FILES, FIX, PAGE_CHECK, PAGE_CHECK_TEST, patchFixture, type Commit, type PatchFixture } from "./patch-fixture.js";

// Every ledger write goes through this spy, so a test can show that one did not happen.
vi.mock("../sandbox/credit-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sandbox/credit-ledger.js")>();
  return { ...actual, appendCreditLine: vi.fn(actual.appendCreditLine) };
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BASE = "b".repeat(40);
const FIXED_SOURCE = String(FIX.write?.[PAGE_CHECK] ?? "");
const FIXED_TEST = String(FIX.write?.[PAGE_CHECK_TEST] ?? "");

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
/** The sleep seam: back-off and polls take no time. */
const instant = (): Promise<void> => Promise.resolve();

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

function idle(id: string, reason: "end_turn" | "retries_exhausted" = "end_turn"): BetaManagedAgentsSessionStatusIdleEvent {
  return { id, type: "session.status_idle", processed_at: AT, stop_reason: { type: reason }, stop_details: null };
}

function terminated(id: string): BetaManagedAgentsSessionStatusTerminatedEvent {
  return { id, type: "session.status_terminated", processed_at: AT };
}

function confirmed(id: string, toolUseId: string): BetaManagedAgentsUserToolConfirmationEvent {
  return { id, type: "user.tool_confirmation", tool_use_id: toolUseId, result: "deny", processed_at: AT };
}

/** The verifier's line for a fixture: what the real verify.mjs prints for that branch. */
function verifyLine(fixture: PatchFixture, overrides: Record<string, unknown> = {}): string {
  return `VERIFY_RESULT ${JSON.stringify({
    ok: true,
    head: fixture.head,
    commits: fixture.commits,
    problems: [],
    flags: [],
    changed: [`M ${PAGE_CHECK}`, `M ${PAGE_CHECK_TEST}`],
    base: { mode: "revert-source", exitCode: 1, timedOut: false, tail: "expected true to be false\n1 failed" },
    ...overrides,
  })}`;
}

function happyEvents(fixture: PatchFixture, options: { command?: string; output?: string; end?: SessionEvent } = {}): SessionEvent[] {
  return [
    running("e1"),
    modelEnd("e2", 100, 50, 1000, 200),
    bash("e3", options.command ?? VERIFY_COMMAND),
    toolResult("e4", "e3", options.output ?? `${verifyLine(fixture)}\n`),
    modelEnd("e5", 10, 5, 2000, 0),
    graded("e6", "satisfied"),
    options.end ?? idle("e7"),
  ];
}

/** A session's outputs for a fixture, as the Files API lists them. An override of null is listed but not served; undefined leaves it out. */
function outputsOf(fixture: PatchFixture, overrides: Record<string, string | null | undefined> = {}): Record<string, string | null> {
  const all = { "verify.mjs": null, ...fixture.patches, "diff.patch": fixture.diff, "report.md": "## Summary\nFixed.\n", "precondition.json": '{"ok":true}\n', ...overrides };
  return Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string | null] => entry[1] !== undefined));
}

/**
 * One line of Markdown read as CommonMark 0.31 reads code spans (section 6.1):
 * a run of n backticks opens a span that the next run of exactly n closes, and
 * a run with no closer is plain text. Returns the text outside the spans, and
 * each span's content as rendered (one space dropped from each end when both
 * ends are spaces and it is not all spaces).
 */
function codeSpans(line: string): { readonly outside: string; readonly spans: readonly string[] } {
  const runAt = (at: number): number => {
    let end = at;
    while (line[end] === "`") end += 1;
    return end - at;
  };
  let outside = "";
  const spans: string[] = [];
  for (let at = 0; at < line.length; ) {
    if (line[at] !== "`") {
      outside += line[at] ?? "";
      at += 1;
      continue;
    }
    const length = runAt(at);
    let close = -1;
    for (let next = at + length; next < line.length; ) {
      if (line[next] !== "`") next += 1;
      else if (runAt(next) === length) {
        close = next;
        break;
      } else next += runAt(next);
    }
    if (close === -1) {
      outside += line.slice(at, at + length);
      at += length;
      continue;
    }
    const content = line.slice(at + length, close);
    spans.push(content.length > 1 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "" ? content.slice(1, -1) : content);
    at = close + length;
  }
  return { outside, spans };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

let fixtureRoot = "";
let fixtureCount = 0;
let happy: PatchFixture;
beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "credit-runner-fixtures-"));
  happy = await fixture([FIX]);
});
afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function fixture(commits: readonly Commit[], options: Parameters<typeof patchFixture>[2] = {}): Promise<PatchFixture> {
  fixtureCount += 1;
  return patchFixture(path.join(fixtureRoot, String(fixtureCount)), commits, options);
}

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

function job(api: SandboxApi, config: LauncherConfig, from: PatchFixture = happy, extra: Partial<JobOptions> = {}) {
  return runSandboxJob({
    api,
    config,
    task,
    job: "a4-trial",
    budgetUsd: 4.5,
    timeoutMinutes: 60,
    baseSha: from.base,
    repoUrl: from.url,
    projectRules: PROJECT_RULES,
    verifyScript: "// verify",
    ...extra,
  });
}

/** Runs a job on a fixture whose session reports a passing verifier, and returns its record. */
async function reviewOf(from: PatchFixture, options: { outputs?: Record<string, string | null>; events?: SessionEvent[] } = {}) {
  const config = await workspace();
  const api = new FakeApi([{ history: [], stream: options.events ?? happyEvents(from) }], options.outputs ?? outputsOf(from));
  const record = await job(api, config, from);
  if (record.kind !== "ran") throw new Error(record.reason);
  return record;
}

describe("sandbox launcher", () => {
  it("runs one session with a hard budget, records the platform's cost and reviews the returned patches", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);

    const created = api.sessions[0];
    expect(created?.budget).toEqual({ type: "limit", max_list_cost: { amount: "450", currency: "USD" } });
    expect(created?.agent).toEqual({ type: "agent", id: "agent_1", version: 1 });
    expect(created?.resources?.map((resource) => ("mount_path" in resource ? resource.mount_path : null))).toEqual(["/verify.mjs", "/task.json"]);
    expect(created?.initial_events?.[0]?.type).toBe("user.define_outcome");
    expect(api.uploads.map((upload) => upload.name)).toEqual(["verify.mjs", "task.json"]);
    expect(JSON.parse(api.uploads[1]?.data ?? "{}")).toMatchObject({ id: "robots-wildcards", baseSha: happy.base, repoDir: "/workspace/omnitwin" });

    expect(record.result.verify?.ok).toBe(true);
    expect(record.result.verifyRuns).toBe(1);
    expect(record.result.requests).toBe(2);
    expect(record.costUsd).toBeCloseTo(2.87);
    expect(record.review.reasons).toEqual([]);
    expect(record.review.verdict).toBe("ready-for-review");
    expect(record.review.flags).toContain(ADVISORY_FLAG);
    expect(record.result.runningAfterFinish).toBe(false);
    // The changed files are read from the patches, not from the verifier's list.
    expect(record.review.changed).toEqual([`M ${PAGE_CHECK_TEST}`, `M ${PAGE_CHECK}`]);

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
    const review = await readFile(path.join(record.runDir, "review.md"), "utf8");
    expect(review).toContain("READY FOR REVIEW");
    expect(review).toContain("The verifier ran, and precondition.json was written, inside the agent's own container, so both are advisory");
    expect(review).toContain("a passing one proves nothing");
    expect(review).toContain("CI on the pull request is the acceptance authority");
    // The verifier's run without the fix is shown, so a vacuous failure can be seen.
    expect(review).toContain("expected true to be false");
    // Only what the review reads comes back, under the launcher's own names; the report and the
    // session's copy of an uploaded input stay in the sandbox.
    expect(api.downloads).toEqual(["0001-Match-robots.patch", "diff.patch", "precondition.json"]);
    expect(record.result.outputs.map((file) => path.basename(file))).toEqual(["patch-0001.patch", "diff.patch", "precondition.json"]);
    expect(Object.values(record.result.outputNames)).toEqual(["0001-Match-robots.patch", "diff.patch", "precondition.json"]);
    expect(record.result.leftOutputs).toEqual(["verify.mjs", "report.md"]);
    expect(record.result.refusedOutputs).toEqual([]);
    expect(record.review.patches.map((file) => path.basename(file))).toEqual(["patch-0001.patch"]);
  });

  it("does not count the verifier when the call holds anything but the exact command, as the A4 trial's did", async () => {
    const command = `cd /workspace/omnitwin; ${VERIFY_COMMAND} > /mnt/session/outputs/logs/verify.log 2>&1; echo rc=$?; grep VERIFY_RESULT /mnt/session/outputs/logs/verify.log`;
    const record = await reviewOf(happy, { events: happyEvents(happy, { command }) });
    expect(record.result.verifyRuns).toBe(0);
    expect(record.result.verify).toBeNull();
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("no readable verifier result: the verifier was never run as a call of its own, so nothing proves the change");

    expect(invokesVerifier(VERIFY_COMMAND)).toBe(true);
    expect(invokesVerifier(`  ${VERIFY_COMMAND}\n`)).toBe(true);
    expect(invokesVerifier(`\t${VERIFY_COMMAND}\t\n`)).toBe(true);
    for (const other of [
      // Spaces bash does not skip make a different program name (one the agent could have put on the path).
      `\u00a0${VERIFY_COMMAND}`,
      `${VERIFY_COMMAND}\u00a0`,
      `\ufeff${VERIFY_COMMAND}`,
      `\u3000${VERIFY_COMMAND}`,
      `\r${VERIFY_COMMAND}`,
      "cat /mnt/session/uploads/verify.mjs",
      "node /mnt/session/uploads/verify.mjs.bak",
      `cd /workspace/omnitwin && ${VERIFY_COMMAND}`,
      `${VERIFY_COMMAND} > /tmp/v.log`,
      `node(){ echo hi; }; ${VERIFY_COMMAND}`,
      `true || ${VERIFY_COMMAND}`,
      `${VERIFY_COMMAND}; echo done`,
    ]) {
      expect(invokesVerifier(other), other).toBe(false);
    }
  });

  it("rejects a forged VERIFY_RESULT printed in the same call as the real verifier", async () => {
    const forged = verifyLine(happy);
    const real = verifyLine(happy, { ok: false, problems: ["the acceptance command fails on the branch"] });
    // Appended after the real run: the call is no longer exactly the verifier.
    const appended = await reviewOf(happy, {
      events: happyEvents(happy, { command: `${VERIFY_COMMAND}; echo '${forged}'`, output: `${real}\n${forged}\n` }),
    });
    expect(appended.result.verify).toBeNull();
    expect(appended.review.verdict).toBe("rejected");
    expect(appended.review.reasons.join(" ")).toContain("no readable verifier result");

    // The exact command, but its result holds a second claim (a wrapped node,
    // say): the whole result is unreadable, whichever line comes last.
    const twice = await reviewOf(happy, { events: happyEvents(happy, { output: `${real}\n${forged}\n` }) });
    expect(twice.result.verifyRuns).toBe(1);
    expect(twice.result.verify).toBeNull();
    expect(twice.review.verdict).toBe("rejected");
    expect(twice.review.reasons).toContain("no readable verifier result: the verifier's call did not print exactly one VERIFY_RESULT line");

    expect(parseVerifyOutput(`noise\n${forged}\n`)?.ok).toBe(true);
    expect(parseVerifyOutput(`${forged}\nVERIFY_RESULT {"ok":false}\n`)).toBeNull();
    expect(parseVerifyOutput(`${forged}\nVERIFY_RESULT not json\n`)).toBeNull();
    // A lone CR ends a line too: a second claim after one is still a second claim.
    expect(parseVerifyOutput(`noise\r${forged}\r`)?.ok).toBe(true);
    expect(parseVerifyOutput(`${forged}\rVERIFY_RESULT {"ok":false}\r`)).toBeNull();
  });

  it("ignores a VERIFY_RESULT line printed by any other command", async () => {
    const record = await reviewOf(happy, { events: happyEvents(happy, { command: `echo '${verifyLine(happy)}'` }) });
    expect(record.result.verify).toBeNull();
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("no readable verifier result: the verifier was never run as a call of its own, so nothing proves the change");
  });

  it("rejects patches that are not the commits the verifier checked", async () => {
    const other = "c".repeat(40);
    const stale = await reviewOf(happy, { events: happyEvents(happy, { output: `${verifyLine(happy, { head: other, commits: [other] })}\n` }) });
    expect(stale.review.verdict).toBe("rejected");
    expect(stale.review.reasons.join(" ")).toContain("but the verifier checked");

    const unlisted = await reviewOf(happy, { events: happyEvents(happy, { output: `${verifyLine(happy, { commits: undefined })}\n` }) });
    expect(unlisted.review.reasons).toContain("the verifier reported no list of commits to hold the patches against");
  });

  it("holds a multi-commit patch set to the verifier's commits, in order and complete", async () => {
    const two = await fixture([
      { subject: "Add the matcher test", write: { [PAGE_CHECK_TEST]: FIXED_TEST } },
      { subject: "Match robots", write: { [PAGE_CHECK]: FIXED_SOURCE } },
    ]);
    const whole = await reviewOf(two);
    expect(whole.review.reasons).toEqual([]);
    expect(whole.review.patches).toHaveLength(2);

    const reversed = await reviewOf(two, { events: happyEvents(two, { output: `${verifyLine(two, { commits: [...two.commits].reverse() })}\n` }) });
    expect(reversed.review.verdict).toBe("rejected");

    // `git format-patch -1` on a two-commit branch: the last patch matches the head, but the set is incomplete.
    const last = Object.keys(two.patches)[1] ?? "";
    const partial = await reviewOf(two, { outputs: { "diff.patch": two.diff, [last]: two.patches[last] ?? "" } });
    expect(partial.review.verdict).toBe("rejected");
    expect(partial.review.reasons.join(" ")).toMatch(/the patches are commits \[\w+\], but the verifier checked \[\w+, \w+\]/u);
  });

  it("finds a protected path, and .gitattributes, that are in the patches but not in the verifier's list", async () => {
    const sneaky = await fixture([{ ...FIX, write: { ...FIX.write, ".github/workflows/ci.yml": "on: push\njobs: {}\n", ".gitattributes": "*.ts -diff\n" } }]);
    // The verifier's line (forgeable) lists only the source and its test.
    const record = await reviewOf(sneaky);
    expect(record.result.verify?.ok).toBe(true);
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("protected path changed: .github/workflows/ci.yml (GitHub workflow or config)");
    expect(record.review.reasons).toContain("protected path changed: .gitattributes (git attributes)");
  });

  it("rejects a symlink or a submodule link that the verifier did not mention", async () => {
    const link = await fixture([{ ...FIX, symlink: { "packages/api/src/services/robots.ts": "../../../../.github/workflows/ci.yml" } }]);
    const linked = await reviewOf(link);
    expect(linked.result.verify?.ok).toBe(true);
    expect(linked.review.verdict).toBe("rejected");
    expect(linked.review.reasons).toContain("packages/api/src/services/robots.ts: creates a symlink");

    const submodule = await reviewOf(await fixture([{ ...FIX, gitlink: { vendor: "d".repeat(40) } }]));
    expect(submodule.review.verdict).toBe("rejected");
    expect(submodule.review.reasons).toContain("vendor: creates a submodule link (gitlink)");
  });

  it("rejects a deleted test and a test renamed away, read from the patches", async () => {
    const deleted = await reviewOf(await fixture([{ subject: "Drop the test", write: { [PAGE_CHECK]: FIXED_SOURCE }, remove: [PAGE_CHECK_TEST] }]));
    expect(deleted.review.reasons).toContain(`test deleted: ${PAGE_CHECK_TEST}`);

    const renamed = await reviewOf(await fixture([{ subject: "Park the test", rename: { [PAGE_CHECK_TEST]: "packages/api/src/page-check.parked.ts" } }]));
    expect(renamed.review.reasons).toContain(`test renamed or copied away: ${PAGE_CHECK_TEST}`);
    expect(renamed.review.changed).toContain(`R ${PAGE_CHECK_TEST}`);
    expect(renamed.review.changed).toContain("A packages/api/src/page-check.parked.ts");
  });

  it("rejects a binary change, so an attribute that makes text binary cannot hide a line from the scan", async () => {
    // A secret-shaped line in a text file the agent's own (uncommitted)
    // attributes mark -diff: format-patch ships it as a binary literal.
    const token = ["ghp", "_", "A1".repeat(18)].join("");
    const hidden = await fixture([{ ...FIX, write: { ...FIX.write, "docs/notes.md": `token ${token}\n` } }], { localAttributes: "*.md -diff\n" });
    expect(Object.values(hidden.patches).join("")).not.toContain(token);
    const record = await reviewOf(hidden);
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("binary change: docs/notes.md (it cannot be read or scanned as text)");
  });

  it("finds a secret-shaped string in an added line or a commit message, even when diff.patch is clean", async () => {
    const key = ["AKIA", "Q".repeat(16)].join("");
    const inLine = await fixture([{ ...FIX, write: { ...FIX.write, "packages/api/src/keys.ts": `export const KEY = "${key}";\n` } }]);
    const line = await reviewOf(inLine, { outputs: outputsOf(inLine, { "diff.patch": happy.diff }) });
    expect(line.review.reasons).toContain("the patches add something shaped like a AWS key");

    const message = await reviewOf(await fixture([{ ...FIX, body: `Tested with ${key}.` }]));
    expect(message.review.reasons).toContain("the patches add something shaped like a AWS key");
  });

  it("reads non-ASCII paths from the patches by their real names, and undoes git's quoting", async () => {
    const odd = await fixture([{ ...FIX, write: { ...FIX.write, ".github/café.yml": "on: push\n" } }]);
    const record = await reviewOf(odd);
    expect(record.review.changed).toContain("A .github/café.yml");
    expect(record.review.reasons).toEqual(["protected path changed: .github/café.yml (GitHub workflow or config)"]);
    // git's C quoting (a name with a quote, a backslash or a control character;
    // Windows cannot hold such a file, so it is checked here directly).
    expect(unquoteGitPath('"a\\"b\\\\c\\303\\251"')).toBe('a"b\\cé');
    expect(unquoteGitPath("plain/path.ts")).toBe("plain/path.ts");
  });

  it("rejects patches that do not apply to the base, and a file that holds two commits", async () => {
    const name = Object.keys(happy.patches)[0] ?? "";
    const tampered = (happy.patches[name] ?? "").replace("rule.split", "rule.splat");
    const moved = await reviewOf(happy, { outputs: outputsOf(happy, { [name]: tampered }) });
    expect(moved.review.reasons.join(" ")).toContain(`the patches do not apply to the base ${happy.base}`);

    const two = await fixture([
      { subject: "First half", write: { [PAGE_CHECK_TEST]: FIXED_TEST } },
      { subject: "Second half", write: { [PAGE_CHECK]: FIXED_SOURCE } },
    ]);
    const [first = "", second = ""] = Object.keys(two.patches);
    const joined = await reviewOf(two, { outputs: { "diff.patch": two.diff, [first]: `${two.patches[first] ?? ""}${two.patches[second] ?? ""}` } });
    expect(joined.result.outputNames[joined.review.patches[0] ?? ""]).toBe(first);
    expect(joined.review.reasons).toContain("patch-0001.patch holds 2 message(s), not exactly one");
  });

  it("rejects a session that ended because its retries ran out, or was terminated", async () => {
    const exhausted = await reviewOf(happy, { events: happyEvents(happy, { end: idle("e7", "retries_exhausted") }) });
    expect(exhausted.review.reasons).toContain("the session stopped because its retries ran out on platform errors");
    const ended = await reviewOf(happy, { events: happyEvents(happy, { end: terminated("e7") }) });
    expect(ended.review.reasons).toContain("the session was terminated before it finished its turn");
  });

  it("finds a rename onto a protected path, and reads a rename's target as added", async () => {
    const record = await reviewOf(await fixture([{ ...FIX, rename: { "README.md": ".github/workflows/readme.yml" } }]));
    expect(record.review.reasons).toContain("protected path changed: .github/workflows/readme.yml (GitHub workflow or config)");
    expect(record.review.changed).toEqual(expect.arrayContaining(["A .github/workflows/readme.yml", "R README.md"]));
  });

  it("reads a change of file mode alone, and lets an executable bit through", async () => {
    const record = await reviewOf(await fixture([{ ...FIX, chmodX: ["README.md"] }]));
    expect(record.review.reasons).toEqual([]);
    expect(record.review.changed).toContain("M README.md");
  });

  it("rejects an edit to a symlink, or a move of a gitlink, that is already at the base", async () => {
    // A modified symlink carries no mode line in the patch: only the base's own entry shows what it is.
    const baseLinks = { symlink: { "packages/api/src/link.ts": "services/page-check.ts" }, gitlink: { "vendor/lib": "d".repeat(40) } };
    const edited = await reviewOf(await fixture([{ ...FIX, symlink: { "packages/api/src/link.ts": "../../../../.github/workflows/ci.yml" } }], { baseLinks }));
    expect(edited.review.verdict).toBe("rejected");
    expect(edited.review.reasons).toEqual(["packages/api/src/link.ts: is a symlink at the base"]);

    // git writes the move as a rename with no mode line, so again only the base's entry shows it.
    const moved = await reviewOf(await fixture([{ ...FIX, moveEntry: { "vendor/lib": "vendor/lib2" } }], { baseLinks }));
    expect(moved.review.verdict).toBe("rejected");
    expect(moved.review.reasons).toEqual(["vendor/lib: is a submodule link (gitlink) at the base"]);
    expect(moved.review.changed).toEqual(expect.arrayContaining(["A vendor/lib2", "R vendor/lib"]));
  });

  it("rejects a hand-written change of a file into a symlink in place", async () => {
    // git writes a type change as a delete and a create; a hand-written patch can change the mode in place.
    const linked = await fixture([{ ...FIX, write: { ...FIX.write, "README.md": "../../outside" } }]);
    const name = Object.keys(linked.patches)[0] ?? "";
    const original = linked.patches[name] ?? "";
    const inPlace = original.replace(
      /(diff --git a\/README\.md b\/README\.md\n)index ([0-9a-f]+\.\.[0-9a-f]+) 100644\n/u,
      "$1old mode 100644\nnew mode 120000\nindex $2\n",
    );
    expect(inPlace).not.toBe(original);
    const record = await reviewOf(linked, { outputs: outputsOf(linked, { [name]: inPlace }) });
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("README.md: changes a mode 100644 => 120000, a symlink");
  });

  it("rejects a path holding a control character, written in git's quoted form", async () => {
    const plain = await fixture([{ ...FIX, write: { ...FIX.write, "docs/ab.md": "notes\n" } }]);
    const name = Object.keys(plain.patches)[0] ?? "";
    const quoted = (plain.patches[name] ?? "").replaceAll("a/docs/ab.md", '"a/docs/a\\tb.md"').replaceAll("b/docs/ab.md", '"b/docs/a\\tb.md"');
    const record = await reviewOf(plain, { outputs: outputsOf(plain, { [name]: quoted }) });
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain("a path holds a control, invisible or reordering character, each shown here as <U+code>: docs/a<U+0009>b.md");
  });

  it("rejects a path holding a character that is invisible, breaks a line or reorders the text, and names the path without it", async () => {
    // A C1 control, the line and paragraph separators, bidi controls (an override can make a
    // .js file read as .md in a file list), zero-width and tag characters, and a byte-order mark.
    const hidden = [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x200e, 0x061c, 0x200b, 0x2060, 0xe0049, 0xfeff].map((code) => String.fromCodePoint(code));
    const codeOf = (char: string): string => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
    const plain = await fixture([{ ...FIX, write: { ...FIX.write, ...Object.fromEntries(hidden.map((_, index) => [`docs/a${String(index)}b.md`, "notes\n"])) } }]);
    const name = Object.keys(plain.patches)[0] ?? "";
    // Written into the patch as git would write them unquoted: no such file is made on disk.
    const patch = hidden.reduce((text, char, index) => text.replaceAll(`docs/a${String(index)}b.md`, `docs/a${char}b.md`), plain.patches[name] ?? "");
    const record = await reviewOf(plain, { outputs: outputsOf(plain, { [name]: patch }) });
    expect(record.review.verdict).toBe("rejected");
    const reason = record.review.reasons.find((entry) => entry.startsWith("a path holds a control, invisible or reordering character")) ?? "";
    for (const char of hidden) expect(reason, codeOf(char)).toContain(`docs/a<${codeOf(char)}>b.md`);
    for (const char of hidden) expect(record.review.reasons.join(" "), codeOf(char)).not.toContain(char);
  });

  it("rejects a hand-written patch whose summary names a file its numstat does not", async () => {
    // A new name ending in a space: numstat -z keeps the space, the summary's last line loses it as trailing whitespace.
    const plain = await fixture([{ ...FIX, write: { ...FIX.write, "docs/ab.md": "notes\n" } }]);
    const name = Object.keys(plain.patches)[0] ?? "";
    const spaced = (plain.patches[name] ?? "").replace("diff --git a/docs/ab.md b/docs/ab.md\n", "diff --git a/docs/ab.md  b/docs/ab.md \n").replace("+++ b/docs/ab.md\n", "+++ b/docs/ab.md \n");
    expect(spaced).toContain("+++ b/docs/ab.md \n");
    const record = await reviewOf(plain, { outputs: outputsOf(plain, { [name]: spaced }) });
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain('the patch summary names a file the patches do not: "docs/ab.md"');
  });

  it("flags each code file that only gains lines, whatever other files lose, and reads a very large patch whole", async () => {
    // page-check.ts gains a function and loses nothing; README.md loses a line, which must not hide that.
    const addOnly = await fixture([
      {
        subject: "Add a helper",
        write: { [PAGE_CHECK]: `${BASE_FILES[PAGE_CHECK] ?? ""}export const star = "*";\n`, [PAGE_CHECK_TEST]: FIXED_TEST, "README.md": "" },
      },
    ]);
    const flagged = await reviewOf(addOnly);
    expect(flagged.review.flags).toContain(
      `the patches only add lines to ${PAGE_CHECK}: without them a new test may fail on a missing name rather than on the behaviour it checks`,
    );
    // The fix itself changes lines in place: no flag.
    expect((await reviewOf(happy)).review.flags.filter((flag) => flag.includes("only add lines"))).toEqual([]);

    // A 300,000-line file, about 15 MB of patch: read line by line, not spread into one call.
    const big = Array.from({ length: 300_000 }, (_, index) => `export const v${String(index)} = ${String(index)}; // padding padding`).join("\n");
    const large = await fixture([{ ...FIX, write: { ...FIX.write, "packages/api/src/big.ts": `${big}\n` } }]);
    expect(Object.values(large.patches).join("").length).toBeGreaterThan(14_000_000);
    const read = await reviewOf(large);
    expect(read.review.reasons).toEqual([]);
    expect(read.review.changed).toContain("A packages/api/src/big.ts");
  });

  it("counts added text holding a NUL byte as a binary change, as git and GitHub show it", async () => {
    // git apply reads the hunk as text, but git and GitHub call a file holding a NUL binary, so no one could read it there.
    const notes = await fixture([{ ...FIX, write: { ...FIX.write, "docs/notes.md": "hidden text\n" } }]);
    const name = Object.keys(notes.patches)[0] ?? "";
    const withNul = (notes.patches[name] ?? "").replace("+hidden text", "+hidden\u0000text");
    expect(withNul).toContain("\u0000");
    const record = await reviewOf(notes, { outputs: outputsOf(notes, { [name]: withNul }) });
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toEqual(["binary change: docs/notes.md (it cannot be read or scanned as text)"]);
  });

  it("counts a text hunk to a file the base holds as binary as a binary change: git reads the base's file and the patched one", async () => {
    // A NUL on the base file's second line, within git's first 8,000 bytes; no hunk below shows it in an added line.
    const early = `${["header", "\u0000", ...Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`)].join("\n")}\n`;
    const binaryBase = { baseFiles: { ...BASE_FILES, "assets/model.bin": early }, formatPatchArgs: ["--text"] };
    const expected = ["binary change: assets/model.bin (it cannot be read or scanned as text)"];

    // An edit far from the NUL: the hunk holds no NUL at all.
    const away = await fixture([{ ...FIX, write: { ...FIX.write, "assets/model.bin": early.replace("line 25", "line twenty-five") } }], binaryBase);
    expect(Object.values(away.patches).join("")).toContain("+line twenty-five");
    expect(Object.values(away.patches).join("")).not.toContain("\u0000");
    expect((await reviewOf(away)).review.reasons).toEqual(expected);
    // The NUL removed: the patched file is text, the base's is not.
    const cleaned = await fixture([{ ...FIX, write: { ...FIX.write, "assets/model.bin": early.replace("\u0000\n", "") } }], binaryBase);
    expect((await reviewOf(cleaned)).review.reasons).toEqual(expected);
    // Deleted with a text hunk.
    const deleted = await fixture([{ ...FIX, remove: ["assets/model.bin"] }], binaryBase);
    expect((await reviewOf(deleted)).review.reasons).toEqual(expected);

    // A NUL added past git's first 8,000 bytes of a text file: git and GitHub show the file as text, and so does the review.
    const long = `${"x".repeat(99)}\n`.repeat(90);
    const late = await fixture([{ ...FIX, write: { ...FIX.write, "docs/long.md": `${long}tail\u0000end\n` } }], { baseFiles: { ...BASE_FILES, "docs/long.md": long } });
    expect(Object.values(late.patches).join("")).toContain("+tail\u0000end");
    expect((await reviewOf(late)).review.reasons).toEqual([]);
  });

  it("rejects a .patch output that is not a format-patch file, instead of ignoring it", async () => {
    const stray = "diff --git a/.github/x b/.github/x\n+on: push\n";
    // Not a name format-patch writes: refused without being downloaded.
    const named = await reviewOf(happy, { outputs: outputsOf(happy, { "extra.patch": stray }) });
    expect(named.review.reasons).toContain(
      '"extra.patch" came back but is not a format-patch file or diff.patch, so the review cannot account for it; not downloaded',
    );
    // A format-patch name over text that is not one: downloaded, read, and refused all the same.
    const content = await reviewOf(happy, { outputs: outputsOf(happy, { "0002-extra.patch": stray }) });
    expect(content.review.reasons).toContain(
      '"0002-extra.patch" (saved as patch-0002.patch) came back but is not a format-patch file, so the review cannot account for it',
    );
  });

  it("reads precondition.json: a failed precondition rejects the run, and so does one it cannot read", async () => {
    const failed = await reviewOf(happy, { outputs: outputsOf(happy, { "precondition.json": '{"ok":false}' }) });
    expect(failed.review.reasons).toContain("the precondition failed: the code the task cites has moved, so the task no longer applies as written");
    const garbled = await reviewOf(happy, { outputs: outputsOf(happy, { "precondition.json": "yes" }) });
    expect(garbled.review.reasons).toContain('precondition.json holds neither {"ok":true} nor {"ok":false}');
    const passed = await reviewOf(happy, { outputs: outputsOf(happy, { "precondition.json": '{"ok":true}\n' }) });
    expect(passed.review.reasons).toEqual([]);
    expect(passed.result.outputs.map((file) => path.basename(file))).toEqual(["patch-0001.patch", "diff.patch", "precondition.json"]);
  });

  it("rejects a run with no precondition.json when the task has a precondition, and a case-variant name does not count", async () => {
    const missing = await reviewOf(happy, { outputs: outputsOf(happy, { "precondition.json": undefined }) });
    expect(missing.review.verdict).toBe("rejected");
    expect(missing.review.reasons).toEqual([expect.stringContaining("left no precondition.json")]);
    const variant = await reviewOf(happy, { outputs: outputsOf(happy, { "precondition.json": undefined, "Precondition.json": '{"ok":true}\n' }) });
    expect(variant.review.verdict).toBe("rejected");
    expect(variant.review.reasons).toEqual([expect.stringContaining("left no precondition.json")]);
    expect(variant.result.outputs.map((file) => path.basename(file))).not.toContain("precondition.json");
    // A task with no precondition needs none.
    const bare = parseTask("---\nid: robots-wildcards\nacceptance: x\n---\nDo it.", "spec.md");
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy, { "precondition.json": undefined }));
    const record = await job(api, config, happy, { task: bare });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.review.reasons).toEqual([]);
  });

  it("turns a download that passes its deadline into a reason, as one past its size cap, and still writes the review", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.stalledDownloads = ["diff.patch"];
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.review.reasons).toContain('"diff.patch" took longer than 5 min to download; abandoned');
    expect(record.review.reasons).toContain("diff.patch did not come back");
    expect(await readFile(path.join(record.runDir, "review.md"), "utf8")).toMatch(/^# REJECTED/u);
  });

  it("counts the run's total on the bytes received, so a later download is cut off whatever the listing said", async () => {
    const name = Object.keys(happy.patches)[0] ?? "";
    const patchBytes = Buffer.byteLength(happy.patches[name] ?? "", "utf8");
    const diffBytes = Buffer.byteLength(happy.diff, "utf8");
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    // Each output listed at one byte, so the plan takes them all; the bytes received pass the run's total during diff.patch.
    api.listedSizes = { [name]: 1, "diff.patch": 1, "precondition.json": 1 };
    const outputCaps = { perOutput: 1024 * 1024, total: patchBytes + Math.floor(diffBytes / 2) };
    const record = await job(api, config, happy, { outputCaps });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(api.downloads).toEqual([name, "diff.patch", "precondition.json"]);
    expect(record.result.refusedOutputs).toEqual(['"diff.patch" ran past its size limit while downloading; cut off and removed']);
    expect((await readdir(path.join(record.runDir, "outputs"))).sort()).toEqual(["patch-0001.patch", "precondition.json"]);
  });

  it("rejects a run when an output the review reads is listed but the API will not serve it", async () => {
    const name = Object.keys(happy.patches)[0] ?? "";
    const record = await reviewOf(happy, { outputs: outputsOf(happy, { [name]: null }) });
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toEqual([`${JSON.stringify(name)} is listed, but the API would not serve it; not downloaded`, "no format-patch files came back"]);
    // An output the review does not read (the session's copy of an input) is never asked for.
    expect(record.result.leftOutputs).toContain("verify.mjs");
    expect(Object.keys(record.result)).not.toContain("skippedOutputs");
  });

  it("counts a path the base's .gitattributes marks binary or -diff as a binary change, even when the patch writes it as text", async () => {
    const marked = await fixture([{ ...FIX, write: { ...FIX.write, "docs/notes.md": "new\n", "data/table.dat": "1 2 3\n" } }], {
      baseFiles: { ...BASE_FILES, ".gitattributes": "*.md -diff\n*.dat binary\n", "docs/notes.md": "old\n" },
      formatPatchArgs: ["--text"],
    });
    // Written as text, so git apply and its numstat read both as text.
    expect(Object.values(marked.patches).join("")).toContain("+new");
    expect(Object.values(marked.patches).join("")).toContain("+1 2 3");
    const record = await reviewOf(marked);
    expect(record.review.verdict).toBe("rejected");
    expect([...record.review.reasons].sort()).toEqual([
      "binary change: data/table.dat (it cannot be read or scanned as text)",
      "binary change: docs/notes.md (it cannot be read or scanned as text)",
    ]);

    // The base's attributes decide, not the ones the patches leave: dropping -diff in the same change does not make it text.
    const unmarked = await fixture([{ ...FIX, write: { ...FIX.write, ".gitattributes": "# none\n", "data/table.dat": "1 2 3\n" } }], {
      baseFiles: { ...BASE_FILES, ".gitattributes": "*.dat -diff\n", "data/table.dat": "1 2\n" },
      formatPatchArgs: ["--text"],
    });
    expect([...(await reviewOf(unmarked)).review.reasons].sort()).toEqual([
      "binary change: data/table.dat (it cannot be read or scanned as text)",
      "protected path changed: .gitattributes (git attributes)",
    ]);
    // Patterns match names by case on every platform, as on Linux and GitHub (a Windows clone would otherwise ignore case).
    const cased = await fixture([{ ...FIX, write: { ...FIX.write, "docs/z.cap": "two\n" } }], {
      baseFiles: { ...BASE_FILES, ".gitattributes": "*.CAP -diff\n", "docs/z.cap": "one\n" },
      formatPatchArgs: ["--text"],
    });
    expect((await reviewOf(cased)).review.reasons).toEqual([]);
  });

  it("applies the patches only to its throwaway repository, whatever GIT_* variables the shell exports", async () => {
    // A repository standing in for the checkout the launcher is started from (inside a git hook, say).
    const decoy = fileURLToPath((await fixture([FIX])).url);
    const state = async () => [
      (await readFile(path.join(decoy, ".git", "index"))).toString("base64"),
      execFileSync("git", ["-C", decoy, "count-objects", "-v"], { encoding: "utf8", env: gitEnv() }),
    ];
    const before = await state();
    const pointed = { GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, ".git", "index"), GIT_OBJECT_DIRECTORY: path.join(decoy, ".git", "objects") };
    const saved = Object.fromEntries(Object.keys(pointed).map((key) => [key, process.env[key]]));
    Object.assign(process.env, pointed);
    try {
      // The test's own fixture repositories are made under the same variables: they too go elsewhere only by -C.
      const edited = await fixture([{ ...FIX, write: { ...FIX.write, "docs/notes.md": "new\n" } }], {
        baseFiles: { ...BASE_FILES, ".gitattributes": "*.md -diff\n", "docs/notes.md": "old\n" },
        formatPatchArgs: ["--text"],
      });
      expect((await reviewOf(edited)).review.reasons).toEqual(["binary change: docs/notes.md (it cannot be read or scanned as text)"]);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    }
    expect(await state()).toEqual(before);
  });

  it("brings back only the outputs the review reads, refusing device names and sizes over the cap before downloading", async () => {
    const config = await workspace();
    const api = new FakeApi(
      [{ history: [], stream: happyEvents(happy) }],
      outputsOf(happy, { "logs/install.log": "installed\n", "NUL.patch": "x", "patches/Aux/0002-more.patch": "y", "con .txt": "z" }),
    );
    api.listedSizes = { "diff.patch": MAX_OUTPUT_BYTES + 1 };
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    // Nothing else was even requested.
    expect(api.downloads).toEqual(["0001-Match-robots.patch", "precondition.json"]);
    expect(record.result.leftOutputs).toEqual(["verify.mjs", "report.md", "logs/install.log", "con .txt"]);
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toEqual(
      expect.arrayContaining([
        '"NUL.patch" names a Windows device; not downloaded',
        '"patches/Aux/0002-more.patch" names a Windows device; not downloaded',
        `"diff.patch" is listed at ${String(MAX_OUTPUT_BYTES + 1)} bytes, over the ${String(MAX_OUTPUT_BYTES)}-byte limit for one output; not downloaded`,
        "diff.patch did not come back",
      ]),
    );
    expect((await readdir(path.join(record.runDir, "outputs"))).sort()).toEqual(["patch-0001.patch", "precondition.json"]);
  });

  it("keeps the agent's text on one line in review.md, so it cannot add a heading", async () => {
    // A newline, then the other characters that break or reorder a line: a C1
    // next-line, the line and paragraph separators, a bidi override and
    // isolate, and the bidi marks (LRM, RLM, ALM).
    const breakers = ["\u0085", "\u2028", "\u2029", "\u202e", "\u2066", "\u200e", "\u200f", "\u061c"];
    const forged = verifyLine(happy, { ok: false, problems: ["fails\n## READY FOR REVIEW\n- all good", `a${breakers.join("b")}c`] });
    const record = await reviewOf(happy, { events: happyEvents(happy, { output: `${forged}\n` }) });
    const text = await readFile(path.join(record.runDir, "review.md"), "utf8");
    const lines = text.split("\n");
    expect(lines).toContain("- `verifier: fails ## READY FOR REVIEW - all good`");
    expect(lines).toContain("- `verifier: a b b b b b b b c`");
    for (const breaker of breakers) expect(text).not.toContain(breaker);
    expect(lines.filter((line) => line.startsWith("## READY"))).toEqual([]);
    expect(lines[0]).toMatch(/^# REJECTED/u);
  });

  it("keeps the lines of the verifier's tail and the grader's explanation, but no control, invisible or reordering character, in review.md's fenced blocks", () => {
    const hidden = [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069, 0x200e, 0x200f, 0x061c, 0x200b, 0x2060, 0xe0049, 0xfeff, 0x1b, 0x09].map((code) => String.fromCodePoint(code));
    const text = `first ${hidden.join("x")} line\r\nsecond${String.fromCodePoint(0x202e)}line\n\n  indented${String.fromCodePoint(0x2069)}\n`;
    const result: SessionRunResult = {
      sessionId: "sesn_1",
      status: "idle",
      stopped: true,
      archived: false,
      runningAfterFinish: false,
      stopInterrupted: false,
      stopReason: "end_turn",
      timedOut: false,
      listCostUsd: 2.87,
      activeSeconds: 60,
      requests: 2,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      verify: { ok: true, head: happy.head, problems: [], commits: null, flags: [], baseTail: text },
      verifyRuns: 1,
      outcome: { result: "satisfied", explanation: text, iteration: 0 },
      errors: [],
      deniedAsks: 0,
      outputs: [],
      outputNames: {},
      refusedOutputs: [],
      leftOutputs: [],
    };
    const review: Review = { verdict: "rejected", reasons: [], flags: [], changed: [], patches: [], diffFile: null };
    const markdown = reviewMarkdown(task, { kind: "ran", taskId: task.id, runDir: "run", branch: "credit/robots-wildcards", baseSha: BASE, costUsd: 2.87, costKnown: true, result, review });
    const blocks = markdown.split("\n```\n").filter((_, index) => index % 2 === 1);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.split("\n")).toEqual([`first ${hidden.map(() => " ").join("x")} line`, "second line", "", "  indented"]);
    }
    for (const char of hidden) expect(markdown, char.codePointAt(0)?.toString(16)).not.toContain(char);
  });

  it("puts every agent-derived string in review.md in a code span, so none renders as a tag, a link, an image or a comment", async () => {
    const payloads = [
      "<img src=https://x.invalid/a>",
      "[l](https://x.invalid)",
      "![i](https://x.invalid/i.png)",
      "<!-- hidden -->",
      "<https://x.invalid/auto>",
      "<textarea>",
      "`lead",
      "trail`",
      "a``b```c",
      "*em* _em_ ~~gone~~ &amp; \\",
    ];
    // File names the patches carry. Windows refuses < and > in a name, so these
    // use the link and image forms, backtick runs, and a name that starts with one.
    const names = ["docs/`a``b`.md", "docs/[l](x.invalid).md", "docs/![i](i.png).md", "`pkg`/package.json"];
    const odd = await fixture([{ ...FIX, write: { ...FIX.write, ...Object.fromEntries(names.map((name) => [name, "{}\n"])) } }]);
    const forged = verifyLine(odd, { ok: false, problems: payloads, flags: payloads });
    // An output the launcher does not read, listed under a name that is HTML: its refusal quotes the name.
    const listed = "<img src=https://x.invalid/o>`x``.patch";
    const record = await reviewOf(odd, { outputs: outputsOf(odd, { [listed]: "not a patch\n" }), events: happyEvents(odd, { output: `${forged}\n` }) });
    const text = await readFile(path.join(record.runDir, "review.md"), "utf8");

    // Every line outside the fenced blocks: what CommonMark reads outside code spans holds nothing
    // that starts a tag, comment, autolink, link, image, emphasis, entity or escape.
    const spans: string[] = [];
    let inFence: string | null = null;
    for (const line of text.split("\n")) {
      if (inFence !== null) {
        if (line === inFence) inFence = null;
        continue;
      }
      if (/^`{3,}$/u.test(line)) {
        inFence = line;
        continue;
      }
      const read = codeSpans(line);
      expect(read.outside, line).not.toMatch(/[<>[\]!`*_~&\\|]/u);
      spans.push(...read.spans);
    }
    expect(inFence).toBeNull();
    // Each string reaches the page whole, as written.
    for (const payload of payloads) expect(spans.filter((span) => span === `verifier: ${payload}`), payload).toHaveLength(2);
    for (const name of names) expect(spans, name).toContain(`A ${name}`);
    expect(spans).toContain("`pkg`/package.json (package manifest)");
    expect(spans.some((span) => span.startsWith(JSON.stringify(listed)))).toBe(true);
    expect(text.split("\n")[0]).toMatch(/^# REJECTED/u);

    // The fence is one longer than the longest run inside, and a backtick at an end is padded.
    expect(inlineCode("a``b```c")).toBe("````a``b```c````");
    expect(inlineCode("`lead")).toBe("`` `lead ``");
    expect(inlineCode("trail`")).toBe("`` trail` ``");
    expect(inlineCode("a\nb")).toBe("`a b`");
    expect(inlineCode("")).toBe("` `");
  });

  it("collects a finished session from its history without starting or charging anything", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: happyEvents(happy), stream: [] }], outputsOf(happy));
    const runDir = path.join(config.workRoot, "runs", "robots-wildcards", "recollected");
    vi.mocked(appendCreditLine).mockClear();
    const record = await collectSandboxJob({ api, task, sessionId: "sesn_1", runDir, baseSha: happy.base, repoUrl: happy.url });
    // No ledger line to any file: the spy sees every write.
    expect(appendCreditLine).not.toHaveBeenCalled();
    expect(api.sessions).toHaveLength(0);
    expect(record.review.verdict).toBe("ready-for-review");
    expect(record.result.requests).toBe(2);
    expect(record.costUsd).toBeCloseTo(2.87);
    expect((await readCreditLedger(config.ledgerFile)).lines).toHaveLength(0);
  });

  it("denies a call that asks for approval, because nobody is watching", async () => {
    const events = happyEvents(happy);
    events.splice(1, 0, bash("ask1", "rm -rf /", "ask"));
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: events }], outputsOf(happy));
    const record = await job(api, config);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(api.sent).toEqual([expect.objectContaining({ type: "user.tool_confirmation", tool_use_id: "ask1", result: "deny" })]);
    expect(record.review.flags.join(" ")).toContain("denied");
  });

  it("reconnects after a dropped stream, reads the history first and counts each event once", async () => {
    const config = await workspace();
    const events = happyEvents(happy);
    const api = new FakeApi(
      [
        { history: [], stream: events, dropAfter: 3 },
        { history: events.slice(0, 4), stream: events },
      ],
      outputsOf(happy),
    );
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.errors).toEqual(["stream: socket hang up"]);
    expect(record.result.requests).toBe(2);
    expect(record.result.verifyRuns).toBe(1);
    const logged = (await readFile(path.join(record.runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(logged).toHaveLength(events.length);
  });

  it("starts nothing when the budget does not fit the lane, the org or the --job label's own cap", async () => {
    const prior = `${JSON.stringify({ ts: "2026-11-05T09:00:00.000Z", lane: "sandbox", job: "a4-trial:x", model: "m", requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 108, batchId: null })}\n`;
    const config = await workspace(prior);
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    expect(await job(api, config)).toMatchObject({ kind: "skipped" });
    expect(api.sessions).toHaveLength(0);

    const limits = { laneCapUsd: 110, orgCapUsd: 190 };
    const otherLane = await readCreditLedger(await writeTemp(`${JSON.stringify({ ts: "t", lane: "batches", job: "a1", costUsd: 187 })}\n`));
    expect(checkSpend(otherLane, "sandbox", 4.5, limits).reason).toContain("org cap");
    const labelled = await readCreditLedger(await writeTemp(`${JSON.stringify({ ts: "t", lane: "sandbox", job: "trial-1:a", costUsd: 22 })}\n`));
    expect(checkSpend(labelled, "sandbox", 4.5, { ...limits, jobCapUsd: 25 }, "trial-1:")).toEqual({
      ok: false,
      reason: "the $4.50 budget does not fit the job 'trial-1' cap: $22.00 of $25.00 is spent",
    });
    expect(checkSpend(labelled, "sandbox", 2.5, { ...limits, jobCapUsd: 25 }, "trial-1:").ok).toBe(true);
    const broken = await readCreditLedger(await writeTemp("{not json\n"));
    expect(checkSpend(broken, "sandbox", 1, limits).ok).toBe(false);
    // A budget that is not a positive finite number is refused before any cap is compared: a NaN or a
    // negative one would fit every cap by arithmetic alone.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      expect(checkSpend(labelled, "sandbox", bad, limits), String(bad)).toEqual({ ok: false, reason: `the budget must be a positive number of dollars, not ${String(bad)}` });
    }
  });

  it("books a session at the platform's figure before its outputs are read, so a failed output listing books nothing more", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.failOutputs = true;
    await expect(job(api, config)).rejects.toThrow("files API down");
    const ledger = await readCreditLedger(config.ledgerFile);
    expect(ledger.lines.map((line) => line.costUsd)).toEqual([2.87]);
  });

  it("refuses a spec with any key the sandbox lane would not honour, before anything starts", async () => {
    for (const [line, said] of [
      ["enabled: false", "enabled: false"],
      ["read_only: true", "read_only: true"],
      ["model: claude-sonnet-5", "model: claude-sonnet-5"],
      ["effort: low", "effort: low"],
      ["base: origin/feature-x", "base: origin/feature-x"],
      ["install: false", "install: false"],
      ["allowed_tools: [Read]", "allowed_tools"],
      ["extra_allowed_tools: [Bash(pnpm *)]", "extra_allowed_tools"],
      // The key being present is what is refused, an empty list included.
      ["allowed_tools: []", "allowed_tools"],
      ["extra_allowed_tools: []", "extra_allowed_tools"],
      ["extra_allowed_tools:", "extra_allowed_tools"],
    ] as const) {
      const spec = parseTask(`---\nid: robots-wildcards\nacceptance: x\n${line}\n---\nDo it.`, "spec.md");
      const config = await workspace();
      const api = new FakeApi([{ history: happyEvents(happy), stream: happyEvents(happy) }], outputsOf(happy));
      await expect(job(api, config, happy, { task: spec }), line).rejects.toThrow(said);
      expect(api.uploads, line).toHaveLength(0);
      expect(api.sessions, line).toHaveLength(0);
      expect(api.environmentCreates + api.agentCreates, line).toBe(0);
      const runDir = path.join(config.workRoot, "runs", "robots-wildcards", "collected");
      await expect(collectSandboxJob({ api, task: spec, sessionId: "sesn_1", runDir, baseSha: happy.base, repoUrl: happy.url }), line).rejects.toThrow(said);
    }
    // The defaults, and the values the lane runs, are accepted.
    for (const base of ["master", "origin/master"]) {
      const explicit = parseTask(
        `---\nid: robots-wildcards\nacceptance: x\nenabled: true\nread_only: false\nmodel: claude-opus-5-5\neffort: high\ninstall: true\nbase: ${base}\n---\nDo it.`,
        "spec.md",
      );
      const record = await job(new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy)), await workspace(), happy, { task: explicit });
      expect(record.kind, base).toBe("ran");
    }
  });

  it("creates the sandbox with limited networking, the exact host list, no MCP and the web tools off", async () => {
    const config = await workspace();
    const api = new FakeApi([]);
    await ensureSandbox(api, path.join(config.workRoot, "state.json"), "prompt one", () => undefined);
    expect(api.environmentParams).toHaveLength(1);
    expect(api.environmentParams[0]?.config).toEqual({
      type: "cloud",
      networking: { type: "limited", allow_package_managers: true, allow_mcp_servers: false, allowed_hosts: ["github.com", "nodejs.org"] },
      packages: { apt: ["postgresql"], npm: ["pnpm@9.15.4"] },
    });
    expect(api.agentParams).toHaveLength(1);
    expect(api.agentParams[0]?.mcp_servers ?? []).toEqual([]);
    expect(api.agentParams[0]?.tools).toEqual([
      {
        type: "agent_toolset_20260401",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: [
          { name: "web_fetch", enabled: false },
          { name: "web_search", enabled: false },
        ],
      },
    ]);
  });

  it("refuses to start when the live environment or agent no longer matches what the code sets up, naming the difference", async () => {
    const config = await workspace();
    const stateFile = path.join(config.workRoot, "state.json");
    const api = new FakeApi([]);
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    type Networking = Extract<EnvironmentRef["config"], { type: "cloud" }>["networking"];
    const limited: Extract<Networking, { type: "limited" }> = { type: "limited", allow_package_managers: true, allow_mcp_servers: false, allowed_hosts: ["github.com", "nodejs.org"] };
    const cloud = (networking: Networking): EnvironmentRef["config"] => ({
      type: "cloud",
      networking,
      packages: { apt: ["postgresql"], cargo: [], gem: [], go: [], npm: ["pnpm@9.15.4"], pip: [] },
    });
    const environmentDrifts: readonly (readonly [EnvironmentRef["config"], string])[] = [
      [cloud({ type: "unrestricted" }), "its networking is unrestricted, not limited"],
      [cloud({ ...limited, allowed_hosts: ["github.com", "nodejs.org", "example.com"] }), "it allows example.com, which the code does not"],
      [cloud({ ...limited, allowed_hosts: ["github.com"] }), "it no longer allows nodejs.org"],
      [cloud({ ...limited, allow_mcp_servers: true }), "it allows MCP servers"],
      [cloud({ ...limited, allow_package_managers: false }), "it does not allow the package registries"],
      [{ type: "self_hosted" }, "it is self_hosted, not a cloud container"],
    ];
    for (const [drift, said] of environmentDrifts) {
      api.liveEnvironmentOverride = drift;
      await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined), said).rejects.toThrow(said);
    }
    api.liveEnvironmentOverride = null;

    const toolset = (webFetch: boolean): AgentTool => ({
      type: "agent_toolset_20260401",
      default_config: { enabled: true },
      configs: [
        { name: "web_fetch", enabled: webFetch },
        { name: "web_search", enabled: false },
      ],
    });
    const agentDrifts: readonly (readonly [Partial<Omit<AgentRef, "id" | "version">>, string])[] = [
      [{ tools: [toolset(true)] }, "web_fetch is on"],
      // A toolset whose switches are gone: its default turns the web tools on.
      [{ tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true }, configs: [] }] }, "web_search is on"],
      [{ tools: [toolset(false), { type: "mcp_toolset", mcp_server_name: "docs" }], mcp_servers: [{ name: "docs" }] }, "it has an MCP toolset (docs)"],
      [{ mcp_servers: [{ name: "docs" }] }, "it has MCP servers (docs)"],
      [{ tools: [toolset(false), { type: "custom", name: "fetch_url" }] }, "it has a custom tool (fetch_url)"],
      [{ multiagent: { type: "coordinator", agents: [] } }, "it can start other agents"],
      [{ skills: [{ skill_id: "xlsx" }] }, "it has skills (xlsx)"],
      // The model, as agents.retrieve returns it: the effort as { type }, a speed only when set.
      [{ model: { id: "claude-sonnet-5-5", effort: { type: "high" } } }, "it runs claude-sonnet-5-5, not claude-opus-5-5"],
      [{ model: { id: "claude-opus-5-5", effort: { type: "low" } } }, "its effort is low, not high"],
      [{ model: { id: "claude-opus-5-5" } }, "its effort is not reported, so it cannot be held to high"],
      [{ model: { id: "claude-opus-5-5", effort: { type: "high" }, speed: "fast" } }, "its speed is fast, not standard"],
      [{ system: "a prompt edited in the Console" }, `its system prompt (sha ${promptSha("a prompt edited in the Console")}) is not the one this code sets up (sha ${promptSha("prompt one")})`],
      [{ system: null }, "its system prompt (sha none)"],
      // Any other tool of the toolset switched on, and two configs for one tool (the first used to win).
      [{ tools: [{ ...toolset(false), configs: [...(toolset(false).configs ?? []), { name: "computer", enabled: true }] }] }, "computer is on"],
      [
        {
          tools: [
            {
              type: "agent_toolset_20260401",
              default_config: { enabled: true },
              configs: [
                { name: "web_fetch", enabled: false },
                { name: "web_fetch", enabled: true },
                { name: "web_search", enabled: false },
              ],
            },
          ],
        },
        "it has 2 configs named web_fetch",
      ],
    ];
    for (const [drift, said] of agentDrifts) {
      api.liveAgentOverride = drift;
      await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined), said).rejects.toThrow(said);
    }
    // What still matches: the effort as a bare level, speed standard, and bash and the file tools listed on.
    const fileTools = ["bash", "edit", "read", "write", "glob", "grep"].map((name) => ({ name, enabled: true }));
    const matching: readonly Partial<Omit<AgentRef, "id" | "version">>[] = [
      { model: { id: "claude-opus-5-5", effort: "high" } },
      { model: { id: "claude-opus-5-5", effort: { type: "high" }, speed: "standard" } },
      { tools: [{ ...toolset(false), configs: [...(toolset(false).configs ?? []), ...fileTools] }] },
    ];
    for (const drift of matching) {
      api.liveAgentOverride = drift;
      await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined), JSON.stringify(drift)).resolves.toMatchObject({ agentVersion: 1 });
    }
    api.liveAgentOverride = null;
    await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined)).resolves.toMatchObject({ agentVersion: 1 });

    // Host names are compared as DNS names: case and a trailing dot are not differences.
    api.liveEnvironmentOverride = cloud({ ...limited, allowed_hosts: ["GitHub.com.", "NODEJS.org"] });
    await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined)).resolves.toMatchObject({ agentVersion: 1 });
  });

  it("updates the agent from the whole params, emptying skills and clearing metadata keys a newer version added", async () => {
    const config = await workspace();
    const stateFile = path.join(config.workRoot, "state.json");
    const api = new FakeApi([]);
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    expect(api.agentParams[0]).toMatchObject({ skills: [], mcp_servers: [] });
    // A version made in the Console, with a skill and a metadata key of its own.
    await api.updateAgent("agent_1", { skills: [{ type: "anthropic", skill_id: "xlsx" }], metadata: { note: "added by hand" } });
    const state = await ensureSandbox(api, stateFile, "prompt two", () => undefined);
    const update = api.agentUpdateParams[api.agentUpdateParams.length - 1];
    expect(update).toMatchObject({ version: 2, skills: [], mcp_servers: [], multiagent: null });
    expect(update?.metadata).toEqual({ note: null, promptSha: promptSha("prompt two") });
    // The version sessions now run carries neither.
    expect(state.agentVersion).toBe(3);
    const live = await api.retrieveAgent("agent_1", 3);
    expect(live.skills).toEqual([]);
    expect(live.metadata).toEqual({ promptSha: promptSha("prompt two") });
  });

  it("checks the live sandbox on every run, before anything is uploaded or a session created", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    await ensureSandbox(api, path.join(config.workRoot, "state.json"), "prompt one", () => undefined);
    api.liveEnvironmentOverride = { type: "cloud", networking: { type: "unrestricted" }, packages: { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] } };
    await expect(job(api, config)).rejects.toThrow("its networking is unrestricted, not limited");
    expect(api.uploads).toHaveLength(0);
    expect(api.sessions).toHaveLength(0);
  });

  it("checks the agent version sessions are pinned to, not a newer one made in the Console", async () => {
    const config = await workspace();
    const stateFile = path.join(config.workRoot, "state.json");
    const api = new FakeApi([]);
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    // Someone adds a version with web_fetch on; sessions still run the version the state pins.
    await api.updateAgent("agent_1", { tools: [{ type: "agent_toolset_20260401", configs: [{ name: "web_fetch", enabled: true }] }] });
    await expect(ensureSandbox(api, stateFile, "prompt one", () => undefined)).resolves.toMatchObject({ agentVersion: 1 });
  });

  it("keeps a hash of the whole agent and environment params, and brings a sandbox set up from an older state file up to date once", async () => {
    const config = await workspace();
    const stateFile = path.join(config.workRoot, "state.json");
    const api = new FakeApi([]);
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    // A state file from before the whole params were hashed: it holds only the prompt's.
    const { environmentId, agentId, agentVersion } = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;
    await writeFile(stateFile, JSON.stringify({ environmentId, agentId, agentVersion, promptSha: promptSha("prompt one") }));
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    expect([api.environmentCreates, api.environmentUpdates.length, api.agentCreates, api.agentUpdates]).toEqual([1, 1, 1, 1]);
    // The updates carry the whole params, so nothing widened on a newer version is inherited.
    expect(api.environmentUpdates[0]?.config).toEqual(api.environmentParams[0]?.config);
    expect(api.agentUpdateParams[0]).toMatchObject({ tools: api.agentParams[0]?.tools, mcp_servers: [], multiagent: null });
    await ensureSandbox(api, stateFile, "prompt one", () => undefined);
    expect([api.environmentUpdates.length, api.agentUpdates]).toEqual([1, 1]);
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

describe("sandbox launcher, when the session or the API misbehaves", () => {
  /** Interrupt after 60 ms, give up 50 ms later, never really wait. */
  const quick: Partial<JobOptions> = { timeoutMinutes: 0.001, graceMs: 50, sleep: instant };
  const interrupts = (api: FakeApi, list: "sent" | "sendAttempts") => api[list].filter((event) => event.type === "user.interrupt").length;
  const denies = (api: FakeApi, list: "sent" | "sendAttempts") => api[list].filter((event) => event.type === "user.tool_confirmation").length;

  it("interrupts a session that never goes idle again, archives it and books its whole budget as unknown", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [running("e1")], stream: [running("e1")], hang: true }], outputsOf(happy));
    api.statuses = ["running"];
    const record = await job(api, config, happy, quick);
    if (record.kind !== "ran") throw new Error(record.reason);

    // The deadline's interrupt, then the launcher's own when it stopped following.
    expect(interrupts(api, "sent")).toBeGreaterThanOrEqual(2);
    expect(api.archived).toEqual(["sesn_1"]);
    expect(record.result.stopped).toBe(false);
    expect(record.result.archived).toBe(true);
    expect(record.costKnown).toBe(false);
    expect(record.costUsd).toBe(4.5);
    expect(record.review.verdict).toBe("rejected");
    expect(record.review.reasons).toContain(
      "the session did not stop after the launcher stopped following it, so it was archived; its cost is counted at the whole budget",
    );
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: "sesn_1" });
  });

  it("retries a failing interrupt, and charges the platform's figure once the session stops", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [running("e1")], stream: [running("e1")], hang: true }], outputsOf(happy));
    // The first three interrupts are refused; the session stops on the second status check.
    api.sendOutcome = (event, attempt) => (event.type === "user.interrupt" && attempt <= 3 ? "fail" : "ok");
    api.statuses = ["running", "idle"];
    const record = await job(api, config, happy, quick);
    if (record.kind !== "ran") throw new Error(record.reason);

    expect(interrupts(api, "sendAttempts")).toBeGreaterThan(3);
    expect(interrupts(api, "sent")).toBeGreaterThanOrEqual(1);
    expect(record.result.errors.filter((error) => error.startsWith("interrupt failed"))).toHaveLength(3);
    expect(api.archived).toEqual([]);
    expect(record.result.stopped).toBe(true);
    expect(record.costKnown).toBe(true);
    expect(record.costUsd).toBeCloseTo(2.87);
  });

  it("archives a session whose interrupt always fails, and books it at the larger of its snapshot and budget", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [running("e1")], stream: [running("e1")], hang: true }], outputsOf(happy));
    api.sendOutcome = (event) => (event.type === "user.interrupt" ? "fail" : "ok");
    api.statuses = ["running"];
    api.listCostCents = "512"; // past the budget: the cap is checked before each request, so the last one can overshoot
    const record = await job(api, config, happy, quick);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(interrupts(api, "sent")).toBe(0);
    expect(api.archived).toEqual(["sesn_1"]);
    expect(record.costKnown).toBe(false);
    expect(record.costUsd).toBeCloseTo(5.12);
  });

  it("keeps following a stream that drops often but keeps delivering events", async () => {
    const config = await workspace();
    // 35 connections that each deliver one new event and then drop: more than the limit on empty reconnects.
    const flaky = Array.from({ length: 35 }, (_, index) => ({ history: [], stream: [modelEnd(`m${String(index)}`, 1, 1, 0, 0), running("r")], dropAfter: 1 }));
    const api = new FakeApi([...flaky, { history: [], stream: happyEvents(happy) }], outputsOf(happy));
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.stopReason).toBe("end_turn");
    expect(record.result.requests).toBe(35 + 2);
    expect(record.review.reasons).toEqual([]);
  });

  it("sends a deny again on reconnect when its send failed, but not one that reached the session", async () => {
    const events = happyEvents(happy);
    events.splice(1, 0, bash("ask1", "curl https://example.com", "ask"));

    const config = await workspace();
    const lost = new FakeApi(
      [
        { history: [], stream: events },
        // The history has the ask but no confirmation: the deny never arrived.
        { history: events.slice(0, 2), stream: events },
      ],
      outputsOf(happy),
    );
    lost.sendOutcome = (event, attempt) => (event.type === "user.tool_confirmation" && attempt === 1 ? "fail" : "ok");
    const record = await job(lost, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(denies(lost, "sendAttempts")).toBe(2);
    expect(denies(lost, "sent")).toBe(1);
    expect(record.result.deniedAsks).toBe(1);
    expect(record.result.errors).toEqual(["stream: 429 Too Many Requests"]);
    const logged = (await readFile(path.join(record.runDir, "events.jsonl"), "utf8")).trim().split("\n");
    expect(logged).toHaveLength(events.length);

    const delivered = new FakeApi(
      [
        { history: [], stream: events },
        // The deny arrived although its send reported a failure: the history holds its confirmation.
        { history: [...events.slice(0, 2), confirmed("c1", "ask1")], stream: events },
      ],
      outputsOf(happy),
    );
    delivered.sendOutcome = (event, attempt) => (event.type === "user.tool_confirmation" && attempt === 1 ? "fail-after-delivery" : "ok");
    const second = await job(delivered, await workspace(), happy, { sleep: instant });
    if (second.kind !== "ran") throw new Error(second.reason);
    expect(denies(delivered, "sendAttempts")).toBe(1);
    expect(second.result.deniedAsks).toBe(1);
  });

  it("follows and charges a session whose create failed on a broken connection but which exists", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.createError = new Anthropic.APIConnectionError({ message: "socket hang up" });
    api.createdAnyway = true;
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(api.sessions).toHaveLength(1);
    expect(api.listCalls).toBe(1);
    // The lookup reaches back to before the create (FakeApi lists a session only from createdSince on, as the API does).
    expect(api.listedSince).toHaveLength(1);
    expect(Date.parse(api.listedSince[0] ?? "")).toBeLessThanOrEqual(Date.parse(api.createTimes[0] ?? ""));
    // Found by the run's own metadata, not by the other session in the list.
    expect(api.sessions[0]?.metadata).toMatchObject({ lane: "sandbox", job: "a4-trial", task: "robots-wildcards", run: expect.any(String) });
    expect(record.result.sessionId).toBe("sesn_1");
    expect(record.review.verdict).toBe("ready-for-review");
    expect((await readCreditLedger(config.ledgerFile)).lines.map((line) => line.costUsd)).toEqual([2.87]);
  });

  it("charges the whole budget as unknown when a failed create finds no session, and never retries the create", async () => {
    const missing = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    missing.createError = new Anthropic.InternalServerError(500, { type: "error" }, "overloaded", new Headers());
    const config = await workspace();
    // A create still in flight could start the session after the last lookup.
    await expect(job(missing, config, happy, { sleep: instant })).rejects.toBeInstanceOf(SessionMayExistError);
    expect(missing.sessions).toHaveLength(1);
    expect(missing.listCalls).toBe(4);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: null });

    // A refusal (429, a credit error) created nothing: no lookup.
    const refused = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    refused.createError = new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    await expect(job(refused, config, happy, { sleep: instant })).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(refused.listCalls).toBe(0);
    expect(isAmbiguousFailure(refused.createError)).toBe(false);
    expect(isAmbiguousFailure(missing.createError)).toBe(true);
  });

  it("books the whole budget as unknown when a create failed and the lookup could not tell", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.createError = new Anthropic.APIConnectionTimeoutError();
    api.listFailures = 4;
    await expect(job(api, config, happy, { sleep: instant })).rejects.toBeInstanceOf(SessionMayExistError);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: null, job: "a4-trial:robots-wildcards" });
  });

  it("collects a session whose cost cannot be read at the budget it was counted at, never as $0", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: happyEvents(happy), stream: [] }], outputsOf(happy));
    api.listCostCents = null;
    const runDir = path.join(config.workRoot, "runs", "robots-wildcards", "unknown-cost");
    const record = await collectSandboxJob({ api, task, sessionId: "sesn_1", runDir, baseSha: happy.base, repoUrl: happy.url, budgetUsd: 3.25 });
    expect(record.costKnown).toBe(false);
    expect(record.costUsd).toBe(3.25);
    expect(await readFile(path.join(runDir, "review.md"), "utf8")).toContain("- Cost: $3.25 (unknown: counted at the whole budget");
  });

  it("creates a session with one attempt and a one-minute timeout, through the real SDK client", async () => {
    let calls = 0;
    const failing = sdkSandboxApi("sk-test-not-a-key", () => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } }));
    });
    const params = { agent: "agent_1", environment_id: "env_1" };
    const error: unknown = await failing.createSession(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Anthropic.InternalServerError);
    expect(calls).toBe(1);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let aborted = false;
      const hanging = sdkSandboxApi("sk-test-not-a-key", (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      });
      const pending = hanging.createSession(params).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(CREATE_SESSION_TIMEOUT_MS - 1);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    expect(CREATE_SESSION_TIMEOUT_MS).toBeLessThan(10 * 60_000);
    // A stalled output holds the ledger line back until its deadline, so the deadline stays short.
    expect(DOWNLOAD_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("sends the key only to api.anthropic.com as X-Api-Key, with no other credential, whatever the SDK's environment says", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const saved = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };
    // What the SDK would read on its own: another host, and a token to send beside the key.
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example.invalid";
    process.env.ANTHROPIC_AUTH_TOKEN = "synthetic-token-value";
    try {
      // The launcher's own check is given a clean environment here, so the client's settings alone are tested.
      const api = sdkSandboxApi(
        "sk-ant-test-key-value",
        (input, init) => {
          seen.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, headers: new Headers(init?.headers) });
          return Promise.resolve(new Response(JSON.stringify({ id: "sesn_1", status: "idle" }), { status: 200, headers: { "content-type": "application/json" } }));
        },
        {},
      );
      await api.retrieveSession("sesn_1");
      await api.createSession({ agent: "agent_1", environment_id: "env_1" });
    } finally {
      if (saved.base === undefined) Reflect.deleteProperty(process.env, "ANTHROPIC_BASE_URL");
      else process.env.ANTHROPIC_BASE_URL = saved.base;
      if (saved.token === undefined) Reflect.deleteProperty(process.env, "ANTHROPIC_AUTH_TOKEN");
      else process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
    }
    expect(seen.map((request) => new URL(request.url).origin)).toEqual([ANTHROPIC_API_URL, ANTHROPIC_API_URL]);
    for (const request of seen) {
      expect(request.headers.get("x-api-key")).toBe("sk-ant-test-key-value");
      expect(request.headers.get("authorization")).toBeNull();
    }
  });

  it("follows a redirect to another host only for a file download and never with the key, and refuses any other request off api.anthropic.com", async () => {
    const seen: { url: string; method: string; headers: Headers; redirect: RequestInit["redirect"] }[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const to = (status: number, location: string) => new Response(null, { status, headers: { location } });
    const routes: Record<string, () => Response> = {
      "https://api.anthropic.com/v1/sessions/sesn_1": () => to(302, "https://files.example.invalid/blob"),
      "https://api.anthropic.com/v1/files/file_1/content": () => to(302, "https://files.example.invalid/blob"),
      "https://files.example.invalid/blob": () => new Response("From abc\n", { status: 200, headers: { "content-type": "application/octet-stream" } }),
      "https://api.anthropic.com/v1/sessions/sesn_2": () => to(307, "/v1/sessions/sesn_3"),
      "https://api.anthropic.com/v1/sessions/sesn_3": () => json({ id: "sesn_3", status: "idle" }),
    };
    const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url: url.split("?")[0] ?? url, method: init?.method ?? "GET", headers: new Headers(init?.headers), redirect: init?.redirect });
      const route = routes[url.split("?")[0] ?? url];
      return Promise.resolve(route === undefined ? to(307, "https://elsewhere.example.invalid/v1/sessions") : route());
    };
    const api = sdkSandboxApi("sk-ant-test-key-value", fake);

    // Another host: followed for a file's content, with no key and no Authorization.
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-redirect-"));
    dirs.push(dir);
    expect(await api.downloadFile("file_1", path.join(dir, "patch-0001.patch"), 100)).toBe("saved");
    expect(await readFile(path.join(dir, "patch-0001.patch"), "utf8")).toBe("From abc\n");
    expect(seen.map((request) => [request.url, request.headers.get("x-api-key"), request.redirect])).toEqual([
      ["https://api.anthropic.com/v1/files/file_1/content", "sk-ant-test-key-value", "manual"],
      ["https://files.example.invalid/blob", null, "manual"],
    ]);
    expect(seen[1]?.headers.get("authorization")).toBeNull();

    // A JSON endpoint's answer never comes from another host: refused after the one request.
    seen.length = 0;
    await expect(api.retrieveSession("sesn_1")).rejects.toThrow(/only a file download may leave/u);
    expect(seen.map((request) => request.url)).toEqual(["https://api.anthropic.com/v1/sessions/sesn_1"]);

    // The same host keeps the key.
    seen.length = 0;
    await expect(api.retrieveSession("sesn_2")).resolves.toMatchObject({ id: "sesn_3" });
    expect(seen.map((request) => [request.url, request.headers.get("x-api-key")])).toEqual([
      ["https://api.anthropic.com/v1/sessions/sesn_2", "sk-ant-test-key-value"],
      ["https://api.anthropic.com/v1/sessions/sesn_3", "sk-ant-test-key-value"],
    ]);

    // A POST sent to another host is refused; nothing more is sent.
    seen.length = 0;
    await expect(api.createSession({ agent: "agent_1", environment_id: "env_1" })).rejects.toThrow();
    expect(seen.map((request) => request.url)).toEqual(["https://api.anthropic.com/v1/sessions"]);

    // The wrapper itself sends nothing to another origin, and stops a redirect loop.
    seen.length = 0;
    await expect(keyOnlyToAnthropic("sk-ant-test-key-value", fake)("https://elsewhere.example.invalid/v1/sessions", { method: "GET" })).rejects.toThrow(/only to https:\/\/api\.anthropic\.com/u);
    expect(seen).toEqual([]);
    const looping = keyOnlyToAnthropic("sk-ant-test-key-value", () => Promise.resolve(to(307, "/v1/loop")));
    await expect(looping("https://api.anthropic.com/v1/loop", { method: "GET", headers: { "x-api-key": "sk-ant-test-key-value" } })).rejects.toThrow(/redirects/u);
  });

  it("never re-sends a POST on a 301, 302 or 303, keeps method and body only through a same-origin 307 or 308, and follows only https", async () => {
    const API = "https://api.anthropic.com";
    const seen: { url: string; method: string | undefined; body: unknown; key: string | null }[] = [];
    const to = (status: number, location: string) => new Response(null, { status, headers: { location } });
    const ok = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    /** Answers `first` to the first request and a plain 200 to any other. */
    const via = (first: Response): typeof fetch => (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, method: init?.method, body: init?.body, key: new Headers(init?.headers).get("x-api-key") });
      return Promise.resolve(seen.length === 1 ? first : ok());
    };
    const post = { method: "POST", body: '{"a":1}', headers: { "x-api-key": "sk-ant-test-key-value" } };

    // A POST redirected with 301, 302 or 303 is never re-sent, as a GET or as a POST.
    for (const status of [301, 302, 303]) {
      seen.length = 0;
      await expect(keyOnlyToAnthropic(post.headers["x-api-key"], via(to(status, "/v1/other")))(`${API}/v1/sessions`, post), String(status)).rejects.toThrow(new RegExp(`${String(status)} redirect of a POST`, "u"));
      expect(seen, String(status)).toHaveLength(1);
    }

    // A 307 or 308 to the same origin keeps the method, the body and the key.
    for (const status of [307, 308]) {
      seen.length = 0;
      await keyOnlyToAnthropic(post.headers["x-api-key"], via(to(status, "/v1/other")))(`${API}/v1/sessions`, post);
      expect(seen.map((request) => [request.url, request.method, request.body, request.key]), String(status)).toEqual([
        [`${API}/v1/sessions`, "POST", '{"a":1}', "sk-ant-test-key-value"],
        [`${API}/v1/other`, "POST", '{"a":1}', "sk-ant-test-key-value"],
      ]);
    }

    // A 307 or 308 of a POST to another origin is refused; any non-GET method is held to the same rule.
    seen.length = 0;
    await expect(keyOnlyToAnthropic(post.headers["x-api-key"], via(to(308, "https://files.example.invalid/x")))(`${API}/v1/sessions`, post)).rejects.toThrow(/refusing to follow a POST redirect/u);
    seen.length = 0;
    await keyOnlyToAnthropic(post.headers["x-api-key"], via(to(307, "/v1/other")))(`${API}/v1/sessions/s`, { ...post, method: "DELETE" });
    expect(seen.map((request) => request.method)).toEqual(["DELETE", "DELETE"]);
    seen.length = 0;
    await expect(keyOnlyToAnthropic(post.headers["x-api-key"], via(to(303, "/v1/other")))(`${API}/v1/sessions/s`, { ...post, method: "DELETE" })).rejects.toThrow(/303 redirect of a DELETE/u);

    // A GET follows a 303 as a GET.
    seen.length = 0;
    await keyOnlyToAnthropic(post.headers["x-api-key"], via(to(303, "/v1/other")))(`${API}/v1/sessions/s`, { method: "GET", headers: post.headers });
    expect(seen.map((request) => [request.url, request.method])).toEqual([[`${API}/v1/sessions/s`, "GET"], [`${API}/v1/other`, "GET"]]);

    // A target that is not https is never followed, for a GET too: nothing is requested for it.
    for (const target of ["http://api.anthropic.com/v1/other", "http://files.example.invalid/x", "data:text/plain,hello", "ftp://files.example.invalid/x"]) {
      seen.length = 0;
      await expect(keyOnlyToAnthropic(post.headers["x-api-key"], via(to(302, target)))(`${API}/v1/sessions/s`, { method: "GET", headers: post.headers }), target).rejects.toThrow(/only https is followed/u);
      expect(seen, target).toHaveLength(1);
    }
  });

  it("downloads an output through the real SDK client a chunk at a time, cut off past its cap or its deadline", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-download-"));
    dirs.push(dir);
    const streamed = (parts: readonly string[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
          controller.close();
        },
      });
    const serving = (parts: readonly string[]) =>
      sdkSandboxApi("sk-test-not-a-key", () => Promise.resolve(new Response(streamed(parts), { status: 200, headers: { "content-type": "application/octet-stream" } })));
    expect(await serving(["From ", "abc", "\n"]).downloadFile("file_1", path.join(dir, "patch-0001.patch"), 100)).toBe("saved");
    expect(await readFile(path.join(dir, "patch-0001.patch"), "utf8")).toBe("From abc\n");
    // More than the cap allows, whatever the listing said: cut off, and nothing left on disk.
    await expect(serving(["0123456789", "0123456789"]).downloadFile("file_2", path.join(dir, "patch-0002.patch"), 15)).rejects.toBeInstanceOf(OutputTooLargeError);
    expect(await readdir(dir)).toEqual(["patch-0001.patch"]);
    // A file the API will not serve (the session's copy of an input).
    const refusing = sdkSandboxApi("sk-test-not-a-key", () =>
      Promise.resolve(
        new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "no", details: { error_code: "file_not_downloadable" } } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    expect(await refusing.downloadFile("file_3", path.join(dir, "diff.patch"), 100)).toBe("not-downloadable");

    // A body that stalls after its first bytes, one that errors when the fetch is aborted and one that
    // ignores the abort: at the deadline the fetch's signal is aborted, the body's reader cancelled, and
    // the partial file is gone by the time the download rejects.
    for (const [index, honoursAbort] of [
      [4, true],
      [5, false],
    ] as const) {
      const file = path.join(dir, `patch-000${String(index)}.patch`);
      let signal: AbortSignal | null = null;
      let cancelled = false;
      const stalled = sdkSandboxApi("sk-test-not-a-key", (_input, init) => {
        signal = init?.signal ?? null;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("From "));
            if (honoursAbort) {
              init?.signal?.addEventListener("abort", () => {
                controller.error(new DOMException("aborted", "AbortError"));
              });
            }
          },
          cancel() {
            cancelled = true;
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } }));
      });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let pending: Promise<unknown> = Promise.resolve();
      try {
        pending = stalled.downloadFile(`file_${String(index)}`, file, 100).then(
          () => "resolved",
          (caught: unknown) => caught,
        );
        // The first bytes reach the disk (real file I/O, so wait for it without the faked clock).
        for (let turn = 0; turn < 500 && !(await readdir(dir)).includes(path.basename(file)); turn += 1) await new Promise((resolve) => setImmediate(resolve));
        expect(await readdir(dir)).toContain(path.basename(file));
        await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS - 1);
        expect((signal as AbortSignal | null)?.aborted, String(index)).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect((signal as AbortSignal | null)?.aborted, String(index)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
      expect(await pending).toBeInstanceOf(OutputTimeoutError);
      expect(await readdir(dir), String(index)).not.toContain(path.basename(file));
      // A body that ignores the abort is stopped by cancelling its reader.
      if (!honoursAbort) expect(cancelled).toBe(true);
    }
  });

  it("reads a download only as far as its cap and cancels the rest of the body, never holding it whole", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-download-"));
    dirs.push(dir);
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024).fill(0x61);
    // A thousand 1 KiB chunks, produced only when read.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const api = sdkSandboxApi("sk-test-not-a-key", () => Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } })));
    await expect(api.downloadFile("file_6", path.join(dir, "patch-0006.patch"), 10 * 1024)).rejects.toBeInstanceOf(OutputTooLargeError);
    // The cap is passed on the eleventh chunk; reading stops there, give or take the stream's read-ahead.
    expect(pulls).toBeGreaterThanOrEqual(11);
    expect(pulls).toBeLessThanOrEqual(14);
    expect(cancelled).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses to start while the environment would send the key or another credential elsewhere, naming the variable but never its value", () => {
    for (const [name, value] of [
      ["ANTHROPIC_BASE_URL", "https://gateway.example.invalid"],
      ["ANTHROPIC_AUTH_TOKEN", "synthetic-token-value"],
      ["ANTHROPIC_CUSTOM_HEADERS", "X-Extra: synthetic-header-value"],
    ] as const) {
      const error: unknown = (() => {
        try {
          sdkSandboxApi("sk-ant-test-key-value", undefined, { [name]: value });
          return null;
        } catch (caught) {
          return caught;
        }
      })();
      expect(error, name).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain(name);
      expect(message).not.toContain(value.includes("://") ? new URL(value).host : value);
      expect(message).not.toContain("sk-ant-test-key-value");
    }
    expect(anthropicEnvironmentProblems({ ANTHROPIC_BASE_URL: "https://gateway.example.invalid", ANTHROPIC_AUTH_TOKEN: "t" })).toHaveLength(2);
    // The official host is not a reason to refuse (a Claude Code shell exports it), and blank values are unset.
    expect(anthropicEnvironmentProblems({ ANTHROPIC_BASE_URL: `${ANTHROPIC_API_URL}/`, ANTHROPIC_AUTH_TOKEN: "  ", ANTHROPIC_CUSTOM_HEADERS: "" })).toEqual([]);
  });

  it("bounds the whole create, response body included, and reads a 2xx it cannot read as a create that may have happened", async () => {
    const params = { agent: "agent_1", environment_id: "env_1" };
    const ok = { status: 200, headers: { "content-type": "application/json" } };
    // Broken JSON, and a body that is not JSON at all: both are 2xx answers whose session may exist.
    const broken = await sdkSandboxApi("sk-test-not-a-key", () => Promise.resolve(new Response('{"id":"sesn_', ok)))
      .createSession(params)
      .catch((caught: unknown) => caught);
    expect(broken).toBeInstanceOf(Error);
    expect(isAmbiguousFailure(broken)).toBe(true);
    const text = await sdkSandboxApi("sk-test-not-a-key", () =>
      Promise.resolve(new Response("created", { status: 201, headers: { "content-type": "text/plain" } })),
    )
      .createSession(params)
      .catch((caught: unknown) => caught);
    expect(text).toBeInstanceOf(Error);
    expect(isAmbiguousFailure(text)).toBe(true);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // The headers arrive at once; the body then stalls. The SDK's own timeout stops at the headers.
      let signal: AbortSignal | null = null;
      const stalled = sdkSandboxApi("sk-test-not-a-key", (_input, init) => {
        signal = init?.signal ?? null;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":"sesn_'));
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        return Promise.resolve(new Response(body, ok));
      });
      let settled: unknown = "pending";
      void stalled.createSession(params).then(
        () => (settled = "resolved"),
        (caught: unknown) => (settled = caught),
      );
      await vi.advanceTimersByTimeAsync(CREATE_SESSION_TIMEOUT_MS - 1);
      expect(settled).toBe("pending");
      expect((signal as AbortSignal | null)?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBeInstanceOf(Error);
      expect(isAmbiguousFailure(settled)).toBe(true);
      // The deadline aborted the request itself, so the body stops being read.
      expect((signal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops following after thirty reconnects that bring nothing new, then stops the session itself", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: [] }], outputsOf(happy));
    api.statuses = ["running", "idle"];
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(api.opened).toBe(30);
    expect(interrupts(api, "sent")).toBe(1);
    expect(record.result.stopped).toBe(true);
    expect(record.costKnown).toBe(true);
    expect(record.review.reasons).toContain("the session never reported that it finished");
  });

  it("stops a session the stream said had finished but the platform still reports running", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.statuses = ["running", "idle"];
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.stopReason).toBe("end_turn");
    expect(interrupts(api, "sent")).toBe(1);
    expect(record.result.stopped).toBe(true);
    expect(record.result.runningAfterFinish).toBe(true);
    expect(record.review.flags).toContain(
      "the platform still reported the session running after the stream said it had finished; the launcher interrupted it, and it stopped",
    );
    expect(record.costKnown).toBe(true);
  });

  it("does not say the platform reported a finished session running when the status read merely failed", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.retrieveFailures = 1;
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.runningAfterFinish).toBe(false);
    expect(record.result.errors).toContain("status check failed: status unavailable");
    expect(record.review.flags.join(" ")).not.toContain("still reported the session running");
    expect(record.result.stopped).toBe(true);
  });

  it("says when its interrupt could not be sent to a finished session still running, and that it archived it", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.statuses = ["running"];
    api.sendOutcome = (event) => (event.type === "user.interrupt" ? "fail" : "ok");
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.runningAfterFinish).toBe(true);
    expect(record.review.flags).toContain("the platform still reported the session running after the stream said it had finished; the launcher's interrupt could not be sent, it did not stop, and the launcher archived it");
    // The stream's word that it finished is not the platform's: the whole budget is booked, as unknown.
    expect(record.costKnown).toBe(false);
    expect(record.costUsd).toBe(4.5);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: "sesn_1" });
  });

  it("books a session the platform still reports running at the whole budget, as unknown, before its outputs are read", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.statuses = ["running"];
    api.failOutputs = true;
    await expect(job(api, config, happy, { sleep: instant })).rejects.toThrow("files API down");
    expect(api.archived).toEqual(["sesn_1"]);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    // The platform's snapshot (2.87) is not final while it says running.
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: "sesn_1" });
  });

  it("books the whole budget as unknown, once, when the final read fails and the failure path's re-read says running", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.statuses = ["idle", "running"];
    const real = api.retrieveSession;
    let calls = 0;
    api.retrieveSession = () => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("final read failed")) : real();
    };
    vi.mocked(appendCreditLine).mockClear();
    await expect(job(api, config, happy, { sleep: instant })).rejects.toThrow("final read failed");
    expect(calls).toBe(3);
    expect(appendCreditLine).toHaveBeenCalledTimes(1);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    // The failure path's own re-read says running, so its snapshot (2.87) is not final.
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: "sesn_1" });
  });

  it("books a session once, through the failure path, when the ledger write at the final read fails", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    vi.mocked(appendCreditLine).mockClear();
    vi.mocked(appendCreditLine).mockRejectedValueOnce(new Error("ledger busy"));
    await expect(job(api, config, happy, { sleep: instant })).rejects.toThrow("ledger busy");
    expect(appendCreditLine).toHaveBeenCalledTimes(2);
    expect((await readCreditLedger(config.ledgerFile)).lines.map((line) => line.costUsd)).toEqual([2.87]);
  });

  it("interrupts and archives a running session when its first status read fails, rather than taking the failure for a stop", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.retrieveFailures = 1;
    api.statuses = ["running"];
    const record = await job(api, config, happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(record.result.errors).toContain("status check failed: status unavailable");
    expect(interrupts(api, "sent")).toBe(1);
    expect(api.archived).toEqual(["sesn_1"]);
    expect(record.result.runningAfterFinish).toBe(false);
    expect(record.costKnown).toBe(false);
    expect(record.costUsd).toBe(4.5);
  });

  it("looks a failed create up through the real SDK client from before it was sent, archived sessions included, after waits of 0, 5, 15 and 30 s", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "credit-runner-lookup-"));
    dirs.push(runDir);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    let createdAt = Number.NaN;
    const lookups: { readonly query: URLSearchParams; readonly waitedMs: number }[] = [];
    let waited = 0;
    const api = sdkSandboxApi("sk-test-not-a-key", (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.pathname === "/v1/files") return Promise.resolve(json({ id: "file_1", type: "file" }));
      if (method === "POST" && url.pathname === "/v1/sessions") {
        createdAt = Date.now();
        return Promise.resolve(json({ type: "error", error: { type: "api_error", message: "overloaded" } }, 500));
      }
      if (method === "GET" && url.pathname === "/v1/sessions") {
        lookups.push({ query: url.searchParams, waitedMs: waited });
        waited = 0;
        return Promise.resolve(json({ data: [], next_page: null }));
      }
      return Promise.resolve(json({ type: "error", error: { type: "not_found_error", message: url.pathname } }, 404));
    });
    const error: unknown = await runSession({
      api,
      state: { environmentId: "env_1", agentId: "agent_1", agentVersion: 1, promptSha: "x" },
      facts: { task, baseSha: BASE, branch: "credit/robots-wildcards" },
      budgetUsd: 4.5,
      timeoutMinutes: 60,
      runDir,
      verifyScript: "// verify",
      title: "lookup",
      metadata: { lane: "sandbox", job: "a4-trial", task: "robots-wildcards" },
      sleep: (ms) => {
        waited += ms;
        return Promise.resolve();
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionMayExistError);
    expect(lookups.map((lookup) => lookup.waitedMs)).toEqual([0, 5_000, 15_000, 30_000]);
    for (const { query } of lookups) {
      expect(query.get("include_archived")).toBe("true");
      expect(query.has("created_at[lte]")).toBe(false);
      // From the clock-skew slack before the create, so a clock here that runs ahead of the API's still lists it.
      expect(Date.parse(query.get("created_at[gte]") ?? "")).toBeLessThanOrEqual(createdAt - LOOKUP_CLOCK_SKEW_MS);
    }
    expect(LOOKUP_CLOCK_SKEW_MS).toBe(10 * 60_000);
  });

  it("never adopts an earlier session of the same lane, job and task after a failed create: the per-run id must match too", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.createError = new Anthropic.InternalServerError(500, { type: "error" }, "overloaded", new Headers());
    api.earlierSessions = [{ id: "sesn_earlier", status: "idle", metadata: { lane: "sandbox", job: "a4-trial", task: "robots-wildcards", run: "an-earlier-run" } }];
    await expect(job(api, config, happy, { sleep: instant })).rejects.toBeInstanceOf(SessionMayExistError);
    expect(api.listCalls).toBe(4);
    expect(api.opened).toBe(0);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: null });
  });

  it("looks up a create whose 2xx response broke before it was read, and follows the session or books its budget", async () => {
    // undici's TypeError for a body cut off mid-read: the session was created all the same.
    const found = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    found.createError = new TypeError("terminated");
    found.createdAnyway = true;
    const record = await job(found, await workspace(), happy, { sleep: instant });
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(found.listCalls).toBe(1);
    expect(record.result.sessionId).toBe("sesn_1");
    expect(record.costUsd).toBeCloseTo(2.87);

    // A body that is not JSON: nothing says whether the session exists, and no lookup finds it.
    const config = await workspace();
    const unread = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    unread.createError = new SyntaxError("Unexpected end of JSON input");
    await expect(job(unread, config, happy, { sleep: instant })).rejects.toBeInstanceOf(SessionMayExistError);
    expect(unread.listCalls).toBe(4);
    const line = JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()) as Record<string, unknown>;
    expect(line).toMatchObject({ costUsd: 4.5, costKnown: false, batchId: null });

    for (const ambiguous of [new TypeError("terminated"), new SyntaxError("bad JSON"), new Anthropic.APIUserAbortError(), new Error("no session id")]) {
      expect(isAmbiguousFailure(ambiguous), ambiguous.message).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(isAmbiguousFailure(Anthropic.APIError.generate(status, { type: "error" }, "refused", new Headers())), String(status)).toBe(false);
    }
    expect(isAmbiguousFailure(Anthropic.APIError.generate(408, { type: "error" }, "timeout", new Headers()))).toBe(true);
  });

  it("answers no ask while it stops a session, so a confirmation cannot wake it", async () => {
    const config = await workspace();
    const api = new FakeApi(
      [
        { history: [running("e1")], stream: [running("e1")], hang: true },
        // The history read after the stop: the session is idle, waiting on an ask.
        { history: [running("e1"), bash("ask9", "curl https://example.com", "ask")], stream: [] },
      ],
      outputsOf(happy),
    );
    api.statuses = ["idle"];
    const record = await job(api, config, happy, quick);
    if (record.kind !== "ran") throw new Error(record.reason);
    expect(denies(api, "sendAttempts")).toBe(0);
    expect(record.result.deniedAsks).toBe(0);
    expect(record.review.reasons).toContain("the session never reported that it finished");
  });

  it("answers no ask that arrives after the deadline's interrupt, so a confirmation cannot wake the interrupted agent", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: [] }], outputsOf(happy));
    api.statuses = ["idle"];
    let release: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The ask is emitted only once the deadline's interrupt has reached the session.
    api.openStream = () =>
      Promise.resolve({
        events: (async function* () {
          yield running("e1");
          while (!api.sent.some((event) => event.type === "user.interrupt")) await new Promise((resolve) => setTimeout(resolve, 5));
          yield bash("ask-late", "curl https://example.com", "ask");
          await closed;
        })(),
        close: () => {
          release();
        },
      });
    const record = await job(api, config, happy, { ...quick, graceMs: 1000 });
    if (record.kind !== "ran") throw new Error(record.reason);
    // The ask was seen (it is in the event log), and left unanswered.
    expect(await readFile(path.join(record.runDir, "events.jsonl"), "utf8")).toContain('"id":"ask-late"');
    expect(interrupts(api, "sent")).toBeGreaterThanOrEqual(1);
    expect(denies(api, "sendAttempts")).toBe(0);
    expect(record.result.deniedAsks).toBe(0);
    expect(record.result.timedOut).toBe(true);
  });

  it("books the platform's figure as soon as it is read, before any download, and once, whether a download then stalls, fails or finishes", async () => {
    for (const ending of ["stalls past its deadline", "fails", "finishes"] as const) {
      const config = await workspace();
      const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
      let entered: () => void = () => undefined;
      const atDownload = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let finish: (error: Error | null) => void = () => undefined;
      // diff.patch's download stays open until the test has read the ledger.
      api.downloadGate = (name) =>
        name !== "diff.patch"
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              finish = (error) => {
                if (error === null) resolve();
                else reject(error);
              };
              entered();
            });
      vi.mocked(appendCreditLine).mockClear();
      const running = job(api, config).then(
        (record) => record,
        (error: unknown) => error,
      );
      await atDownload;
      // The download is still open, and the line is already in the ledger.
      expect((await readCreditLedger(config.ledgerFile)).lines, ending).toEqual([expect.objectContaining({ costUsd: 2.87, job: "a4-trial:robots-wildcards" })]);
      expect(JSON.parse((await readFile(config.ledgerFile, "utf8")).trim()), ending).toMatchObject({ batchId: "sesn_1", requests: 2, inputTokens: 110 + 3000 + 200, outputTokens: 55 });
      finish(ending === "stalls past its deadline" ? new OutputTimeoutError(DOWNLOAD_TIMEOUT_MS) : ending === "fails" ? new Error("connection reset while downloading") : null);
      const outcome = await running;
      if (ending === "fails") expect(outcome, ending).toEqual(expect.objectContaining({ message: "connection reset while downloading" }));
      else {
        expect(outcome, ending).toMatchObject({ kind: "ran", costUsd: 2.87, costKnown: true });
        if (ending === "stalls past its deadline") {
          expect((outcome as Extract<JobRecord, { kind: "ran" }>).review.reasons).toContain('"diff.patch" took longer than 5 min to download; abandoned');
        }
      }
      // One line, whatever came after: no second booking from the failure path or the end of the run.
      expect(appendCreditLine, ending).toHaveBeenCalledTimes(1);
      expect((await readCreditLedger(config.ledgerFile)).lines.map((line) => line.costUsd), ending).toEqual([2.87]);
    }
  });

  it("names the per-run id in kickoff.md, and in the error when a failed create finds no session", async () => {
    const config = await workspace();
    const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
    api.createError = new Anthropic.InternalServerError(500, { type: "error" }, "overloaded", new Headers());
    const error: unknown = await job(api, config, happy, { sleep: instant }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionMayExistError);
    const runId = String(api.sessions[0]?.metadata?.run);
    expect(runId).toMatch(/^[0-9a-f-]{36}$/u);
    expect((error as SessionMayExistError).runId).toBe(runId);
    expect((error as Error).message).toContain(`with run ${runId} in its metadata`);
    const runs = path.join(config.workRoot, "runs", task.id);
    const [stampDir] = await readdir(runs);
    expect(await readFile(path.join(runs, stampDir ?? "", "kickoff.md"), "utf8")).toMatch(new RegExp(`^Run id \\(the session's metadata \`run\`\\): ${runId}\\n`, "u"));
  });

  it("refuses a budget, a time limit or a grace period outside its bounds before anything is uploaded or created", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "credit-runner-bounds-"));
    dirs.push(runDir);
    const budget = /^budgetUsd must be from 0\.01 to 50, not /u;
    const timeout = /^timeoutMinutes must be more than 0 and at most 240/u;
    const grace = /^graceMs must be from 0 to 3600000/u;
    const cases: readonly { readonly budgetUsd?: number; readonly timeoutMinutes?: number; readonly graceMs?: number; readonly refused: RegExp }[] = [
      // A NaN budget would reach the create as "NaN" cents, and its ledger line could not be written.
      { budgetUsd: Number.NaN, refused: budget },
      { budgetUsd: 0, refused: budget },
      { budgetUsd: 0.009, refused: budget },
      { budgetUsd: -1, refused: budget },
      { budgetUsd: MAX_BUDGET_USD + 0.01, refused: budget },
      { budgetUsd: Number.POSITIVE_INFINITY, refused: budget },
      { timeoutMinutes: Number.NaN, refused: timeout },
      { timeoutMinutes: 0, refused: timeout },
      { timeoutMinutes: -1, refused: timeout },
      { timeoutMinutes: MAX_TIMEOUT_MINUTES + 1, refused: timeout },
      { timeoutMinutes: Number.POSITIVE_INFINITY, refused: timeout },
      { graceMs: Number.NaN, refused: grace },
      { graceMs: -1, refused: grace },
      { graceMs: 60 * 60_000 + 1, refused: grace },
    ];
    for (const { refused, ...bad } of cases) {
      const api = new FakeApi([{ history: [], stream: happyEvents(happy) }], outputsOf(happy));
      const run = runSession({
        api,
        state: { environmentId: "env_1", agentId: "agent_1", agentVersion: 1, promptSha: "x" },
        facts: { task, baseSha: BASE, branch: "credit/robots-wildcards" },
        budgetUsd: 4.5,
        timeoutMinutes: 60,
        runDir,
        verifyScript: "// verify",
        title: "bounds",
        metadata: { lane: "sandbox" },
        sleep: instant,
        ...bad,
      });
      await expect(run, String(Object.entries(bad))).rejects.toThrow(refused);
      expect(api.uploads).toHaveLength(0);
      expect(api.sessions).toHaveLength(0);
    }
  });
});

describe("sandbox brief", () => {
  it("never tells the sandbox agent where secrets live, and keeps the engineering rules", async () => {
    const prompt = sandboxSystemPrompt(nightRulesFromAgentsMd(await readFile(path.join(repoRoot, "AGENTS.md"), "utf8")));
    expect(prompt).not.toMatch(/deploy-secrets/iu);
    expect(prompt).toContain(VERIFY_COMMAND);
    expect(prompt).toContain("as a bash call of its own");
    // The gate's rejections, named in the brief so a paid run does not build what is rejected.
    for (const named of [".gitattributes", ".husky/", "symlink", "submodule", "binary file", "rename tests", "any other .patch file there rejects the run"]) {
      expect(prompt).toContain(named);
    }
    expect(prompt).toMatch(/TypeScript stays strict/u);
    expect(prompt.indexOf("## Fixed rules")).toBeLessThan(prompt.indexOf("## Project instructions"));
    // It names what the launcher reads back, and asks for nothing that stays in the sandbox unread.
    expect(prompt).toContain("The launcher reads only the format-patch files, diff.patch and precondition.json");
    expect(prompt).toContain('/mnt/session/outputs/precondition.json` as `{"ok":true}`');
    expect(prompt).not.toContain("report.md");
    expect(prompt).not.toContain("/mnt/session/outputs/logs");
  });

  it("puts the base, branch, acceptance and precondition in the kickoff", () => {
    const { description, rubric } = outcomeFor({ task, baseSha: BASE, branch: "credit/robots-wildcards" });
    expect(description).toContain(BASE);
    expect(description).toContain("credit/robots-wildcards");
    expect(description).toContain(task.acceptance);
    expect(description).toContain("Precondition");
    expect(description).toContain("precondition.json");
    expect(rubric).toContain('"ok":true');
    expect(rubric).not.toContain("report.md");
  });

  it("plans downloads from the listing alone: launcher-chosen names, a fixed suffix, sizes checked first", () => {
    const file = (filename: string, sizeBytes = 10) => ({ id: filename, filename, sizeBytes });
    const plan = planOutputs([file("diff.patch"), file("0002-b.patch"), file("0001-a.patch"), file("report.md"), file("verify.json"), file("notes.PATCH")]);
    expect(plan.downloads.map((entry) => [entry.file.filename, entry.localName])).toEqual([
      ["0001-a.patch", "patch-0001.patch"],
      ["0002-b.patch", "patch-0002.patch"],
      ["diff.patch", "diff.patch"],
    ]);
    expect(plan.left).toEqual(["report.md", "verify.json"]);
    expect(plan.refused).toEqual(['"notes.PATCH" came back but is not a format-patch file or diff.patch, so the review cannot account for it; not downloaded']);

    // An agent-chosen name never reaches the disk, whatever it holds.
    for (const name of ["0001-x.patch.lnk", "0001-x.url", "../../0001-x.patch.exe", "0001-a b.patch"]) {
      expect(planOutputs([file(name)]).downloads, name).toEqual([]);
    }
    expect(planOutputs([file("patches/0001-a.patch")]).downloads.map((entry) => entry.localName)).toEqual(["patch-0001.patch"]);
    // Ordered by base name, as format-patch numbers a series, whatever folder the listing puts a file in.
    expect(planOutputs([file("b/0001-a.patch"), file("a/0002-b.patch")]).downloads.map((entry) => [entry.file.filename, entry.localName])).toEqual([
      ["b/0001-a.patch", "patch-0001.patch"],
      ["a/0002-b.patch", "patch-0002.patch"],
    ]);
    // A listed size that is not a whole number of bytes is called invalid, not large.
    for (const size of [-1, 1.5, Number.NaN]) {
      expect(planOutputs([file("0001-a.patch", size)]).refused, String(size)).toEqual([`"0001-a.patch" is listed with an invalid size (${String(size)}); not downloaded`]);
    }

    // Sizes: one over the per-output cap, then the run's total cap.
    expect(planOutputs([file("0001-a.patch", MAX_OUTPUT_BYTES + 1)]).refused).toHaveLength(1);
    expect(planOutputs([file("0001-a.patch", MAX_OUTPUT_BYTES)]).downloads).toHaveLength(1);
    const many = Array.from({ length: 5 }, (_, index) => file(`000${String(index + 1)}-x.patch`, MAX_OUTPUT_BYTES));
    const capped = planOutputs(many);
    expect(capped.downloads).toHaveLength(MAX_OUTPUTS_TOTAL_BYTES / MAX_OUTPUT_BYTES);
    expect(capped.refused).toEqual([`"0005-x.patch" would take the run's downloads past ${String(MAX_OUTPUTS_TOTAL_BYTES)} bytes; not downloaded`]);
    // Two diffs: neither is taken.
    expect(planOutputs([file("diff.patch"), file("logs/diff.patch")]).refused).toEqual(["2 files named diff.patch came back; none was downloaded"]);
    // Two format-patch files with one base name, in different folders: neither is taken either, never two steps of one series.
    const twice = planOutputs([file("a/0001-x.patch"), file("b/0001-x.patch"), file("0002-y.patch")]);
    expect(twice.refused).toEqual(["2 files named 0001-x.patch came back; none was downloaded"]);
    expect(twice.downloads.map((entry) => [entry.file.filename, entry.localName])).toEqual([["0002-y.patch", "patch-0001.patch"]]);

    // precondition.json comes back under its own name, after the patches; one only.
    expect(planOutputs([file("precondition.json"), file("report.md"), file("0001-fix.patch")]).downloads.map((entry) => entry.localName)).toEqual([
      "patch-0001.patch",
      "precondition.json",
    ]);
    expect(planOutputs([file("precondition.json"), file("logs/precondition.json")]).refused).toEqual([
      "2 files named precondition.json came back; none was downloaded",
    ]);
    expect(planOutputs([file("NUL/precondition.json")]).refused).toEqual(['"NUL/precondition.json" names a Windows device; not downloaded']);

    // At most 50 .patch outputs are read: more refuses the run, and none is downloaded or listed one by one.
    const flood = [...Array.from({ length: MAX_PATCH_OUTPUTS + 1 }, (_, index) => file(`${String(index + 1).padStart(4, "0")}-x.patch`)), file("stray.patch"), file("diff.patch")];
    const flooded = planOutputs(flood);
    expect(flooded.downloads).toEqual([]);
    expect(flooded.refused).toEqual([`${String(MAX_PATCH_OUTPUTS + 3)} .patch outputs came back, more than the ${String(MAX_PATCH_OUTPUTS)} the launcher reads; none was downloaded`]);
    expect(planOutputs(Array.from({ length: MAX_PATCH_OUTPUTS }, (_, index) => file(`${String(index + 1).padStart(4, "0")}-x.patch`))).downloads).toHaveLength(MAX_PATCH_OUTPUTS);
  });

  it("knows the names Windows opens as devices, with or without an extension, in any case", () => {
    for (const name of ["CON", "con.txt", "Prn.patch", "AUX", "nul", "NUL.tar.gz", "nul .patch", "COM1", "com9.log", "LPT1", "lpt9.patch", "COM¹", "lpt³.x", "CONIN$", "conout$.txt", "nul:stream"]) {
      expect(isWindowsDeviceName(name), name).toBe(true);
    }
    for (const name of ["console", "CON1", "com10", "lpt", "nul_", "aux-notes.md", "0001-nul.patch", "diff.patch"]) {
      expect(isWindowsDeviceName(name), name).toBe(false);
    }
  });

  it("streams a download to disk and removes it once it passes its cap", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "credit-runner-capped-"));
    dirs.push(dir);
    const chunks = (count: number) =>
      (async function* () {
        for (let index = 0; index < count; index += 1) {
          await Promise.resolve();
          yield new TextEncoder().encode("0123456789");
        }
      })();
    expect(await writeCapped(chunks(3), path.join(dir, "a.patch"), 30)).toBe(30);
    expect(await readFile(path.join(dir, "a.patch"), "utf8")).toBe("0123456789".repeat(3));
    await expect(writeCapped(chunks(4), path.join(dir, "b.patch"), 30)).rejects.toBeInstanceOf(OutputTooLargeError);
    expect(await readdir(dir)).toEqual(["a.patch"]);
  });

  it("prices budgets in cents", () => {
    expect(centsString(4.5)).toBe("450");
    expect(centsString(25)).toBe("2500");
    expect(() => centsString(0)).toThrow();
  });
});

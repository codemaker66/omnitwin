/**
 * A launcher in a process of its own, for the tests that need a real one (a
 * signal from outside, a kill that no handler sees). It runs runSandboxJob as
 * `sandbox run` does, with the CLI's own signal handling (stopOnSignals: {}),
 * against a FakeApi whose session runs until it is interrupted. The session is
 * written to `<folder>/sessions.jsonl` (FakeApi.persistFile), so a FakeApi in
 * the test's own process still sees it after this process has gone, as the
 * platform would.
 *
 * Started as the sandbox script starts the CLI, from the package folder:
 * `node --import tsx src/__tests__/launcher-child.ts <folder>`. It books to
 * `<folder>/ledger.jsonl`, keeps its state under `<folder>/work`, prints
 * "following" on stdout once it follows the session and its log lines on
 * stderr, and at the end one JSON line on stdout: how the run ended and how many
 * interrupts it sent. Each interrupt takes a second to reach the session, so a
 * signal that comes just after the first still finds the run stopping.
 */
import path from "node:path";
import type { BetaManagedAgentsSessionStatusRunningEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { runSandboxJob } from "../sandbox/launcher.js";
import { parseTask } from "../task.js";
import { FakeApi, PROJECT_RULES } from "./fake-api.js";

const folder = process.argv[2];
if (folder === undefined) throw new Error("usage: node --import tsx src/__tests__/launcher-child.ts <folder>");

const running: BetaManagedAgentsSessionStatusRunningEvent = { id: "e1", type: "session.status_running", processed_at: "2026-11-25T10:00:00.000Z" };
const api = new FakeApi([{ history: [running], stream: [running], hang: true }]);
api.persistFile = path.join(folder, "sessions.jsonl");
// Running until the interrupt reaches it, idle from then on.
api.statuses = ["running"];
const send = api.sendEvents;
api.sendEvents = async (id, events) => {
  const interrupting = events.some((event) => event.type === "user.interrupt");
  if (interrupting) await new Promise((resolve) => setTimeout(resolve, 1000));
  await send(id, events);
  if (interrupting) api.statuses = ["idle"];
};

const task = parseTask(
  ["---", "id: child-task", "title: A launcher in a process of its own", "budget_usd: 4.5", "timeout_minutes: 60", 'acceptance: "true"', "---", "Runs until it is stopped."].join("\n"),
  "child-task.md",
);
const following = setInterval(() => {
  if (api.opened > 0) {
    clearInterval(following);
    process.stdout.write("following\n");
  }
}, 5);
const outcome = await runSandboxJob({
  api,
  config: { workRoot: path.join(folder, "work"), ledgerFile: path.join(folder, "ledger.jsonl"), lane: "sandbox", laneCapUsd: 110, orgCapUsd: 190 },
  task,
  job: "child",
  budgetUsd: 4.5,
  timeoutMinutes: 60,
  baseSha: "b".repeat(40),
  projectRules: PROJECT_RULES,
  verifyScript: "// verify",
  log: (line) => process.stderr.write(`${line}\n`),
  stopOnSignals: {},
}).then(
  (record) => record.kind,
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
);
clearInterval(following);
process.stdout.write(`${JSON.stringify({ outcome, interrupts: api.sent.filter((event) => event.type === "user.interrupt").length })}\n`);

/* eslint-disable no-console -- operator-facing evaluation report */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { EVENT_BRIEF_EVAL_CASES, EVAL_TODAY, type EventBriefEvalCase } from "../evals/event-brief-cases.js";
import {
  SCORED_FIELDS,
  formatEventBriefEval,
  scoreEventBriefCase,
  summariseEventBriefEval,
  type EventBriefCaseScore,
} from "../evals/event-brief-scoring.js";
import { AnthropicAIGenerationAdapter, RECOMMENDED_ANTHROPIC_MODEL } from "../services/anthropic-draft-adapter.js";
import { readEventBrief } from "../services/event-brief-draft.js";

// ---------------------------------------------------------------------------
// pnpm --filter @omnitwin/api eval:event-briefs [case-id ...]
//
// Reads every evaluation brief through the real provider and prints per-field
// accuracy, unsupported-item recall and assumption recall (T-650). It makes
// paid model calls, so it runs only where an operator has set
// AI_ASSISTANT_API_KEY themselves (AI_ASSISTANT_MODEL defaults to the
// recommended model; AI_ASSISTANT_WORKSPACE_ID is passed on when set), and
// never in CI. Descriptions are synthetic; nothing is stored. Exit codes:
// 0 read, 1 a case failed to read, 2 not run.
// ---------------------------------------------------------------------------

export async function runEventBriefEval(argv: readonly string[]): Promise<number> {
  if (process.env["CI"] !== undefined) {
    console.error("The event brief evaluation makes paid model calls and does not run in CI.");
    return 2;
  }
  const apiKey = process.env["AI_ASSISTANT_API_KEY"];
  if (apiKey === undefined || apiKey.trim() === "") {
    console.error("No AI_ASSISTANT_API_KEY is set, so nothing was sent. Set it for this shell to run the evaluation.");
    return 2;
  }
  const model = process.env["AI_ASSISTANT_MODEL"] ?? RECOMMENDED_ANTHROPIC_MODEL;
  const cases = argv.length === 0
    ? EVENT_BRIEF_EVAL_CASES
    : EVENT_BRIEF_EVAL_CASES.filter((evalCase) => argv.includes(evalCase.id));
  if (cases.length === 0) {
    console.error(`No case matches ${argv.join(", ")}.`);
    return 2;
  }

  const workspaceId = process.env["AI_ASSISTANT_WORKSPACE_ID"];
  const adapter = new AnthropicAIGenerationAdapter({ model, apiKey, ...(workspaceId === undefined ? {} : { workspaceId }) });
  console.info(`Reading ${String(cases.length)} briefs with ${model}, one at a time.\n`);
  const scores: EventBriefCaseScore[] = [];
  const failed: EventBriefEvalCase[] = [];
  for (const evalCase of cases) {
    const started = performance.now();
    try {
      const draft = await readEventBrief(adapter, { description: evalCase.description, room: evalCase.room, now: EVAL_TODAY });
      const score = scoreEventBriefCase(evalCase, draft);
      scores.push(score);
      const misses = [
        ...SCORED_FIELDS.filter((field) => score.fields[field] === "mismatch"),
        ...score.unsupportedMissing.map((words) => `unsupported "${words}"`),
        ...score.assumptionsMissing.map((field) => `assumption ${field}`),
        ...(score.contactDetailsRemoved === false ? ["contact details"] : []),
      ];
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.info(`${misses.length === 0 ? "ok  " : "miss"} ${evalCase.id.padEnd(22)} ${seconds}s${misses.length === 0 ? "" : `  ${misses.join(", ")}`}`);
    } catch (error) {
      failed.push(evalCase);
      // The error names a reason or contract paths; never the reading itself.
      console.info(`FAIL ${evalCase.id.padEnd(22)} ${error instanceof Error ? error.message : "unknown failure"}`);
    }
  }
  console.info(`\n${formatEventBriefEval(summariseEventBriefEval(scores, failed))}`);
  return failed.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void runEventBriefEval(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

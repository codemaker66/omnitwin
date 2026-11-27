/* eslint-disable no-console -- operator-facing evaluation report */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { EventBriefDraft } from "@omnitwin/types";
import { EVENT_BRIEF_EVAL_CASES, EVAL_TODAY } from "../evals/event-brief-cases.js";
import {
  SCORED_FIELDS,
  formatEventBriefEval,
  scoreEventBriefCase,
  summariseEventBriefEval,
  type EventBriefCaseScore,
  type ScoredField,
} from "../evals/event-brief-scoring.js";
import { agreementOf, parseRunCount, parseSpendCap, readEvalKeyFile } from "../evals/eval-support.js";
import {
  AnthropicAIGenerationAdapter,
  RECOMMENDED_ANTHROPIC_MODEL,
  type AnthropicDraftSend,
} from "../services/anthropic-draft-adapter.js";
import { AIBudgetReachedError, ANTHROPIC_PRICE_TABLE, TallyAIUsageMeter } from "../services/ai-usage.js";
import { readEventBrief } from "../services/event-brief-draft.js";

// An evaluation is no venue's call: its reads are tallied in memory, priced
// from the same versioned table as the ledger, and nothing reaches the AI
// usage ledger.
const OPERATOR_EVALUATION = { venueId: "operator-evaluation", userId: "operator" } as const;
const MAX_RUNS = 10;

// ---------------------------------------------------------------------------
// pnpm --filter @omnitwin/api eval:event-briefs -- --key-file <path>
//   [--out <dir>] [--runs N] [--max-usd 5] [--workspace-id wrkspc_...] [case-id ...]
//
// Reads every evaluation brief through the real provider and prints per-field
// accuracy, unsupported-item recall and assumption recall (T-650); with
// --runs it reads each brief N times and says which fields did not give the
// same verdict every time. It makes paid model calls, so it runs only with a
// key file an operator names, and never in CI. The key is read from that
// file, never from the environment, and is never printed. --max-usd stops
// the run, with nothing more sent, once the next read's worst case would
// pass that spend. --out writes results.json: every reading, its scores and
// what the calls used. Descriptions are synthetic; nothing is stored.
// Exit codes: 0 read, 1 a case failed to read or the spend stop was reached,
// 2 not run.
// ---------------------------------------------------------------------------

export interface EventBriefEvalOptions {
  /** Replaces the network call, for tests. */
  readonly send?: AnthropicDraftSend;
}

interface Reading {
  readonly run: number;
  readonly id: string;
  readonly seconds: number;
  readonly score: EventBriefCaseScore | null;
  readonly draft: EventBriefDraft | null;
  readonly error: string | null;
}

interface UnsteadyField {
  readonly id: string;
  readonly field: ScoredField;
  readonly matched: number;
  readonly of: number;
}

/** Fields whose verdict differed between runs of the same case. */
function unsteadyFields(readings: readonly Reading[]): UnsteadyField[] {
  const byCase = new Map<string, EventBriefCaseScore[]>();
  for (const reading of readings) {
    if (reading.score === null) continue;
    byCase.set(reading.id, [...(byCase.get(reading.id) ?? []), reading.score]);
  }
  const unsteady: UnsteadyField[] = [];
  for (const [id, scores] of byCase) {
    for (const field of SCORED_FIELDS) {
      const verdicts = scores.map((score) => score.fields[field]).filter((verdict) => verdict !== "not_scored");
      if (verdicts.length < 2) continue;
      if (agreementOf(verdicts).agreeing !== verdicts.length) {
        unsteady.push({ id, field, matched: verdicts.filter((verdict) => verdict === "match").length, of: verdicts.length });
      }
    }
  }
  return unsteady;
}

interface Flags {
  readonly apiKey: string;
  readonly out: string | undefined;
  readonly runs: number;
  readonly limitMicroUsd: number | undefined;
  readonly workspaceId: string | undefined;
  readonly caseIds: readonly string[];
}

/** The flags, or a reason the run cannot start. Nothing is sent either way. */
async function readFlags(argv: readonly string[]): Promise<Flags | string> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        "key-file": { type: "string" },
        out: { type: "string" },
        runs: { type: "string" },
        "max-usd": { type: "string" },
        "workspace-id": { type: "string" },
      },
    });
    const keyFile = values["key-file"];
    if (keyFile === undefined) {
      return "No --key-file was given, so nothing was sent. Name the file that holds the key: --key-file <path>.";
    }
    return {
      runs: parseRunCount(values.runs, 1, MAX_RUNS),
      limitMicroUsd: parseSpendCap(values["max-usd"]),
      apiKey: await readEvalKeyFile(keyFile),
      out: values.out,
      workspaceId: values["workspace-id"],
      caseIds: positionals,
    };
  } catch (error) {
    return error instanceof Error ? error.message : "The evaluation's flags could not be read.";
  }
}

export async function runEventBriefEval(argv: readonly string[], options: EventBriefEvalOptions = {}): Promise<number> {
  if (process.env["CI"] !== undefined) {
    console.error("The event brief evaluation makes paid model calls and does not run in CI.");
    return 2;
  }
  const flags = await readFlags(argv);
  if (typeof flags === "string") {
    console.error(flags);
    return 2;
  }
  const model = RECOMMENDED_ANTHROPIC_MODEL;
  const cases = flags.caseIds.length === 0
    ? EVENT_BRIEF_EVAL_CASES
    : EVENT_BRIEF_EVAL_CASES.filter((evalCase) => flags.caseIds.includes(evalCase.id));
  if (cases.length === 0) {
    console.error(`No case matches ${flags.caseIds.join(", ")}.`);
    return 2;
  }

  const usage = new TallyAIUsageMeter(flags.limitMicroUsd === undefined ? {} : { limitMicroUsd: flags.limitMicroUsd });
  const adapter = new AnthropicAIGenerationAdapter({
    model,
    apiKey: flags.apiKey,
    usage,
    ...(flags.workspaceId === undefined ? {} : { workspaceId: flags.workspaceId }),
    ...(options.send === undefined ? {} : { send: options.send }),
  });
  console.info(`Reading ${String(cases.length)} briefs ${String(flags.runs)} time(s) each with ${model}, one at a time.\n`);
  const readings: Reading[] = [];
  let stoppedBySpend = false;
  for (let run = 1; run <= flags.runs && !stoppedBySpend; run += 1) {
    for (const evalCase of cases) {
      const started = performance.now();
      try {
        const draft = await readEventBrief(adapter, {
          description: evalCase.description,
          room: evalCase.room,
          attribution: OPERATOR_EVALUATION,
          now: EVAL_TODAY,
        });
        const score = scoreEventBriefCase(evalCase, draft);
        const seconds = (performance.now() - started) / 1000;
        readings.push({ run, id: evalCase.id, seconds, score, draft, error: null });
        const misses = [
          ...SCORED_FIELDS.filter((field) => score.fields[field] === "mismatch"),
          ...score.unsupportedMissing.map((words) => `unsupported "${words}"`),
          ...score.assumptionsMissing.map((field) => `assumption ${field}`),
          ...(score.contactDetailsRemoved === false ? ["contact details"] : []),
        ];
        console.info(`${misses.length === 0 ? "ok  " : "miss"} r${String(run)} ${evalCase.id.padEnd(22)} ${seconds.toFixed(1)}s${misses.length === 0 ? "" : `  ${misses.join(", ")}`}`);
      } catch (error) {
        if (error instanceof AIBudgetReachedError) {
          stoppedBySpend = true;
          console.info(`STOP r${String(run)} ${evalCase.id.padEnd(22)} the next read could pass the --max-usd stop; nothing more was sent.`);
          break;
        }
        // The error names a reason or contract paths; never the reading itself.
        const message = error instanceof Error ? error.message : "unknown failure";
        readings.push({ run, id: evalCase.id, seconds: (performance.now() - started) / 1000, score: null, draft: null, error: message });
        console.info(`FAIL r${String(run)} ${evalCase.id.padEnd(22)} ${message}`);
      }
    }
  }

  const scores = readings.flatMap((reading) => (reading.score === null ? [] : [reading.score]));
  const failed = readings.flatMap((reading) => {
    const evalCase = reading.error === null ? undefined : cases.find((candidate) => candidate.id === reading.id);
    return evalCase === undefined ? [] : [evalCase];
  });
  const summary = summariseEventBriefEval(scores, failed);
  const unsteady = unsteadyFields(readings);
  console.info(`\n${formatEventBriefEval(summary)}`);
  if (flags.runs > 1) {
    console.info(unsteady.length === 0
      ? "Every scored field gave the same verdict on every run."
      : `Fields whose verdict changed between runs:\n${unsteady.map((u) => `  ${u.id} ${u.field}: matched ${String(u.matched)} of ${String(u.of)}`).join("\n")}`);
  }
  const totals = {
    calls: usage.entries.filter((entry) => entry.outcome !== "budget_blocked").length,
    inputTokens: usage.entries.reduce((total, entry) => total + entry.inputTokens, 0),
    outputTokens: usage.entries.reduce((total, entry) => total + entry.outputTokens, 0),
    cacheReadInputTokens: usage.entries.reduce((total, entry) => total + entry.cacheReadInputTokens, 0),
    cacheCreationInputTokens: usage.entries.reduce((total, entry) => total + entry.cacheCreationInputTokens, 0),
    costUsd: usage.costMicroUsd / 1_000_000,
    priceTable: ANTHROPIC_PRICE_TABLE.version,
  };
  console.info(`${String(totals.calls)} calls cost $${totals.costUsd.toFixed(4)} at ${totals.priceTable} prices`
    + ` (${String(totals.cacheReadInputTokens)} input tokens read from the prompt cache).`);

  if (flags.out !== undefined) {
    await mkdir(flags.out, { recursive: true });
    await writeFile(join(flags.out, "results.json"), `${JSON.stringify({
      model,
      runAt: new Date().toISOString(),
      runs: flags.runs,
      cases: cases.map((evalCase) => evalCase.id),
      stoppedBySpend,
      summary,
      unsteady,
      failedCases: [...new Set(failed.map((evalCase) => evalCase.id))],
      totals,
      readings,
    }, null, 2)}\n`);
  }
  return stoppedBySpend || failed.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void runEventBriefEval(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

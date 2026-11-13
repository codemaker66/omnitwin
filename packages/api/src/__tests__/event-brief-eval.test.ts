import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_BRIEF_DESCRIPTION_MAX_LENGTH,
  EventBriefDraftValuesSchema,
  interpretEventBriefExtraction,
  type EventBriefDraft,
  type EventBriefExtraction,
} from "@omnitwin/types";
import { EVENT_BRIEF_EVAL_CASES, EVAL_TODAY, type EventBriefEvalCase } from "../evals/event-brief-cases.js";
import {
  SCORED_FIELDS,
  formatEventBriefEval,
  scoreEventBriefCase,
  summariseEventBriefEval,
} from "../evals/event-brief-scoring.js";
import { runEventBriefEval } from "../scripts/run-event-brief-eval.js";
import type { AnthropicDraftSend } from "../services/anthropic-draft-adapter.js";
import { scrubContactDetails } from "../services/proposal-message-draft.js";

// ---------------------------------------------------------------------------
// The typed-brief evaluation (T-650) without a model: the set is well formed,
// the scoring is right, and the live script refuses to run in CI or without a
// key file, takes its key only from that file, and keeps to its spending
// stop. Accuracy itself is only measured by the script against a real key.
// ---------------------------------------------------------------------------

const ABSENT = { value: null, source: "absent", words: null, basis: null } as const;

function draftFrom(description: string, fields: Partial<EventBriefExtraction["fields"]>, rest: Partial<Omit<EventBriefExtraction, "fields">> = {}): EventBriefDraft {
  return interpretEventBriefExtraction({
    extraction: {
      fields: {
        eventName: ABSENT, eventType: ABSENT, guestCount: ABSENT, layoutStyle: ABSENT, budgetGbp: ABSENT,
        preferredDate: ABSENT, startTime: ABSENT, endTime: ABSENT, serviceModel: ABSENT, planningEmphasis: ABSENT,
        ...fields,
      },
      accessibility: rest.accessibility ?? [],
      unsupported: rest.unsupported ?? [],
    },
    description,
    contactDetailsRemoved: scrubContactDetails(description).removed,
    generatedAt: EVAL_TODAY.toISOString(),
  });
}

function evalCase(id: string): EventBriefEvalCase {
  const found = EVENT_BRIEF_EVAL_CASES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No eval case ${id}`);
  return found;
}

describe("the evaluation set", () => {
  it("holds about twenty distinct briefs, each readable and each expectation a value the brief can hold", () => {
    expect(EVENT_BRIEF_EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVENT_BRIEF_EVAL_CASES.map((candidate) => candidate.id)).size).toBe(EVENT_BRIEF_EVAL_CASES.length);
    for (const candidate of EVENT_BRIEF_EVAL_CASES) {
      expect(candidate.description.length, candidate.id).toBeLessThanOrEqual(EVENT_BRIEF_DESCRIPTION_MAX_LENGTH);
      const { expected } = candidate;
      const values = EventBriefDraftValuesSchema.partial().safeParse({
        guestCount: expected.guestCount,
        layoutStyle: expected.layoutStyle,
        serviceModel: expected.serviceModel,
        budgetLimitMinor: expected.budgetLimitMinor,
        preferredDate: expected.preferredDate,
        startTime: expected.startTime,
        endTime: expected.endTime,
      });
      expect(values.success, candidate.id).toBe(true);
      for (const words of expected.unsupported) {
        expect(candidate.description.toLowerCase(), `${candidate.id}: ${words}`).toContain(words.toLowerCase());
      }
    }
  });

  it("covers the awkward ones: an approximate count, over the limit, at the limit, contact details and mixed requests", () => {
    const ids = EVENT_BRIEF_EVAL_CASES.map((candidate) => candidate.id);
    expect(ids).toEqual(expect.arrayContaining(["about-120-ish", "black-tie-350", "launch-at-limit", "one-over", "contact-details", "two-layouts", "ceremony-elsewhere"]));
    expect(evalCase("black-tie-350").expected.guestCount).toBeNull();
    expect(evalCase("launch-at-limit").expected.guestCount).toBe(300);
    expect(scrubContactDetails(evalCase("contact-details").description).removed).toBe(true);
  });
});

describe("scoring a reading", () => {
  it("scores each expected field, the unsupported words and the assumptions", () => {
    const candidate = evalCase("about-120-ish");
    const score = scoreEventBriefCase(candidate, draftFrom(candidate.description, {
      eventType: { value: "corporate dinner", source: "stated", words: "Corporate dinner", basis: null },
      guestCount: { value: 120, source: "inferred", words: "about 120-ish", basis: "Approximate." },
      layoutStyle: { value: "dinner-rounds", source: "stated", words: "rounds", basis: null },
      serviceModel: { value: "plated", source: "inferred", words: null, basis: "Guessed." },
    }, {
      unsupported: [{ words: "sometime in March", kind: "needs_exact_value", explanation: "A month is not a date.", field: "preferredDate" }],
    }));
    expect(score.fields).toEqual({
      eventType: "match",
      guestCount: "match",
      layoutStyle: "match",
      serviceModel: "mismatch",
      budgetLimitMinor: "not_scored",
      preferredDate: "match",
      startTime: "not_scored",
      endTime: "not_scored",
      accessibilityRequirements: "not_scored",
    });
    expect(score).toMatchObject({ unsupportedFound: 1, unsupportedExpected: 1, assumptionsFound: 1, assumptionsExpected: 1 });
  });

  it("matches unsupported words whole, so a short word is not found inside another", () => {
    const candidate = evalCase("launch-at-limit");
    const score = scoreEventBriefCase(candidate, draftFrom(candidate.description, {}, {
      unsupported: [
        { words: "we'll need AV", kind: "not_modelled", explanation: "AV is not placed.", field: null },
        { words: "we'll have a stage", kind: "not_modelled", explanation: "Not placed.", field: null },
      ],
    }));
    expect(score.unsupportedMissing).toEqual(["tbc"]);
    const unrelated = scoreEventBriefCase(candidate, draftFrom(candidate.description, {}, {
      unsupported: [{ words: "we'll have it", kind: "other", explanation: "Have.", field: null }],
    }));
    expect(unrelated.unsupportedMissing).toEqual(["tbc", "av", "stage"]);
  });

  it("summarises per-field accuracy, counting a case that failed against every field it would have scored", () => {
    const good = evalCase("black-tie-350");
    const score = scoreEventBriefCase(good, draftFrom(good.description, {
      eventType: { value: "black tie dinner", source: "stated", words: "Black tie dinner", basis: null },
      guestCount: { value: 350, source: "stated", words: "350", basis: null },
      serviceModel: { value: "plated", source: "stated", words: "plated", basis: null },
      preferredDate: { value: "2027-12-03", source: "stated", words: "Friday 3 December 2027", basis: null },
    }));
    const summary = summariseEventBriefEval([score], [evalCase("contact-details")]);
    expect(summary.fields.find((field) => field.field === "guestCount")).toEqual({ field: "guestCount", matched: 1, scored: 2 });
    expect(summary).toMatchObject({ cases: 2, failedCases: 1, unsupportedFound: 1, unsupportedExpected: 1, contactChecks: 1, contactChecksPassed: 0 });
    const table = formatEventBriefEval(summary);
    for (const field of SCORED_FIELDS) expect(table).toContain(field);
    expect(table).toMatch(/guestCount\s+50\.0%\s+1\/2/u);
  });
});

describe("the live evaluation script", () => {
  // Built from pieces so no key-shaped literal sits in the repository. It is not a key.
  const FAKE_KEY = ["sk", "ant", "test-only-not-a-real-key-0000"].join("-");
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "brief-eval-")); });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  /** A provider that answers every read with an empty brief, counting the reads. */
  function fakeProvider(): { readonly send: AnthropicDraftSend; readonly calls: () => number } {
    let calls = 0;
    const fakeFetch = vi.fn((): Promise<Response> => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify({
        id: "msg_eval", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({
          fields: {
            eventName: ABSENT, eventType: ABSENT, guestCount: ABSENT, layoutStyle: ABSENT, budgetGbp: ABSENT,
            preferredDate: ABSENT, startTime: ABSENT, endTime: ABSENT, serviceModel: ABSENT, planningEmphasis: ABSENT,
          },
          accessibility: [],
          unsupported: [],
        }), citations: null }],
        stop_reason: "end_turn", stop_sequence: null, stop_details: null,
        usage: { input_tokens: 1000, output_tokens: 200 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    });
    const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: "https://api.anthropic.com", fetch: fakeFetch, maxRetries: 0 });
    return {
      send: (request, sendOptions) => client.beta.messages.create(request, { signal: sendOptions?.signal ?? null }),
      calls: () => calls,
    };
  }

  it("never runs in CI, and sends nothing without a key file, whatever the environment holds", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const keyFile = join(dir, "batch.key");
    await writeFile(keyFile, FAKE_KEY);
    vi.stubEnv("CI", "true");
    expect(await runEventBriefEval(["--key-file", keyFile])).toBe(2);
    vi.stubEnv("CI", undefined);
    // The key is never taken from the environment.
    vi.stubEnv("AI_ASSISTANT_API_KEY", FAKE_KEY);
    expect(await runEventBriefEval([])).toBe(2);
    expect(await runEventBriefEval(["--key-file", join(dir, "absent.key")])).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(said.mock.calls.flat().join(" ")).toContain("--key-file");
    expect(said.mock.calls.flat().join(" ")).not.toContain(FAKE_KEY);
  });

  it("reads with the key from the file, as many runs as asked, and writes what it read and used", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("CI", undefined);
    const keyFile = join(dir, "batch.key");
    await writeFile(keyFile, `${FAKE_KEY}\n`);
    const provider = fakeProvider();
    const ids = EVENT_BRIEF_EVAL_CASES.slice(0, 2).map((candidate) => candidate.id);
    const out = join(dir, "out");
    // Empty briefs miss fields, so the run reads but scores misses: exit 0 means every case was read.
    expect(await runEventBriefEval(["--key-file", keyFile, "--runs", "2", "--out", out, ...ids], { send: provider.send })).toBe(0);
    expect(provider.calls()).toBe(4);
    const results = JSON.parse(await readFile(join(out, "results.json"), "utf8")) as {
      runs: number; cases: string[]; readings: { run: number; id: string; error: string | null }[];
      totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
    };
    expect(results.runs).toBe(2);
    expect(results.cases).toEqual(ids);
    expect(results.readings.map((reading) => [reading.run, reading.id])).toEqual([[1, ids[0]], [1, ids[1]], [2, ids[0]], [2, ids[1]]]);
    expect(results.readings.every((reading) => reading.error === null)).toBe(true);
    expect(results.totals).toMatchObject({ calls: 4, inputTokens: 4000, outputTokens: 800 });
    expect(results.totals.costUsd).toBeGreaterThan(0);
    expect(JSON.stringify(results)).not.toContain(FAKE_KEY);
  });

  it("stops, with nothing more sent, once the next read could pass the spending stop", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("CI", undefined);
    const keyFile = join(dir, "batch.key");
    await writeFile(keyFile, FAKE_KEY);
    const provider = fakeProvider();
    // One cent cannot hold a single read's worst case, so nothing is sent at all.
    expect(await runEventBriefEval(["--key-file", keyFile, "--max-usd", "0.01"], { send: provider.send })).toBe(1);
    expect(provider.calls()).toBe(0);
  });
});

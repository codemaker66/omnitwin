import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { HttpAIGenerationAdapter, buildAIDraftInstructions } from "../services/ai-assistant.js";
import {
  AnthropicAIGenerationAdapter,
  buildAnthropicDraftRequest,
  buildAnthropicStructuredRequest,
} from "../services/anthropic-draft-adapter.js";
import {
  AIBudgetReachedError,
  ANTHROPIC_PRICE_TABLE,
  RESERVATION_FRAMING_TOKENS,
  TallyAIUsageMeter,
  anthropicOutcome,
  ceilingRates,
  costMicroUsd,
  hasPrice,
  meterAnthropicMessage,
  monthlyAllowanceMicroUsd,
  reserveForAnthropicRequest,
  reserveForUnreportedRequest,
} from "../services/ai-usage.js";
import { EVENT_BRIEF_ANSWER_SCHEMA, EVENT_BRIEF_SYSTEM_PROMPT } from "../services/event-brief-draft.js";

// ---------------------------------------------------------------------------
// T-656 — pricing a Claude call exactly, and holding it to an allowance.
//
// Every figure here is worked by hand from Anthropic's published rates
// (micro-dollars per million tokens in the table, so $4/MTok is 4 micro-
// dollars a token): an answer, cache writes and reads, a refused attempt
// rescued by the server-side fallback at the fallback model's rates, the
// refusal billing rule, Haiku's long-prompt card, an unlisted model at the
// ceiling, and the reservation that bounds a call before it is made. The
// adapter's own records are checked through the SDK with only its HTTP
// boundary replaced. The PostgreSQL ledger is proven in
// ai-usage-postgres.test.ts.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-0000000065f1";
const USER = "00000000-0000-4000-8000-0000000065f2";
const ATTRIBUTION = { venueId: VENUE, userId: USER };

type Usage = Partial<Anthropic.Beta.BetaUsage>;

function reply(overrides: {
  readonly model?: string;
  readonly stopReason?: Anthropic.Beta.BetaStopReason;
  readonly category?: Anthropic.Beta.BetaRefusalStopDetails["category"];
  readonly content?: Anthropic.Beta.BetaContentBlock[];
  readonly usage?: Usage;
  readonly requestId?: string;
} = {}): Anthropic.Beta.BetaMessage & { readonly _request_id?: string | null } {
  return {
    id: "msg_usage",
    type: "message",
    role: "assistant",
    model: overrides.model ?? "claude-opus-5-5",
    content: overrides.content ?? [{ type: "text", text: "Dear Morgan, thank you.", citations: null }],
    stop_reason: overrides.stopReason ?? "end_turn",
    stop_sequence: null,
    stop_details: overrides.stopReason === "refusal"
      ? { type: "refusal", category: overrides.category ?? null, explanation: null } as Anthropic.Beta.BetaRefusalStopDetails
      : null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      fallback_credit: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
      ...overrides.usage,
    },
    ...(overrides.requestId === undefined ? {} : { _request_id: overrides.requestId }),
  } as Anthropic.Beta.BetaMessage & { readonly _request_id?: string | null };
}

function iteration(
  type: "message" | "fallback_message",
  model: string,
  input: number,
  output: number,
  cache: { readonly write?: number; readonly read?: number } = {},
): NonNullable<Anthropic.Beta.BetaUsage["iterations"]>[number] {
  return {
    type, model, input_tokens: input, output_tokens: output,
    cache_creation_input_tokens: cache.write ?? 0, cache_read_input_tokens: cache.read ?? 0, cache_creation: null,
  } as NonNullable<Anthropic.Beta.BetaUsage["iterations"]>[number];
}

describe("the price table", () => {
  it("carries Anthropic's first-party rates for 13 October 2026, in micro-dollars per million tokens", () => {
    expect(ANTHROPIC_PRICE_TABLE.version).toBe("anthropic-2026-10-13");
    expect(ANTHROPIC_PRICE_TABLE.models["claude-opus-5-5"]).toEqual({
      input: 4_000_000, cacheWrite5m: 5_000_000, cacheWrite1h: 8_000_000, cacheRead: 200_000, output: 20_000_000,
    });
    expect(ANTHROPIC_PRICE_TABLE.models["claude-sonnet-5-5"]).toEqual({
      input: 2_000_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000, cacheRead: 100_000, output: 10_000_000,
    });
    expect(ANTHROPIC_PRICE_TABLE.models["claude-haiku-5-5"]).toMatchObject({ input: 100_000, cacheWrite5m: 125_000, cacheRead: 10_000, output: 500_000 });
    // The fallback targets bill at their own rates.
    expect(ANTHROPIC_PRICE_TABLE.models["claude-opus-5"]).toMatchObject({ input: 5_000_000, output: 25_000_000, cacheRead: 500_000 });
    expect(ANTHROPIC_PRICE_TABLE.models["claude-opus-4-8"]).toMatchObject({ input: 5_000_000, output: 25_000_000 });
  });

  it("writes the 5-minute cache at 1.25 times and the 1-hour cache at twice each model's input rate", () => {
    for (const [model, price] of Object.entries(ANTHROPIC_PRICE_TABLE.models)) {
      expect(price.cacheWrite5m * 4, model).toBe(price.input * 5);
      expect(price.cacheWrite1h, model).toBe(price.input * 2);
    }
  });

  it("knows which models it can price", () => {
    expect(hasPrice(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5")).toBe(true);
    expect(hasPrice(ANTHROPIC_PRICE_TABLE, "claude-opus-9")).toBe(false);
    expect(hasPrice(ANTHROPIC_PRICE_TABLE, "constructor")).toBe(false);
  });
});

describe("the cost of the tokens a call used", () => {
  const opus = ANTHROPIC_PRICE_TABLE.models["claude-opus-5-5"];
  if (opus === undefined) throw new Error("Opus 5.5 price missing");
  const tokens = (values: Partial<Parameters<typeof costMicroUsd>[1]>) => ({
    inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0, ...values,
  });

  it("prices input and output at their own rates", () => {
    // 1,000 in at $4 and 500 out at $20 per million: 4,000 + 10,000 micro-dollars.
    expect(costMicroUsd(opus, tokens({ inputTokens: 1_000, outputTokens: 500 }))).toBe(14_000);
  });

  it("prices cache writes and reads apart from fresh input", () => {
    // 100 fresh at $4, 2,000 written at $5, 3,000 read at $0.20 and 700 out at $20.
    expect(costMicroUsd(opus, tokens({ inputTokens: 100, cacheCreationInputTokens: 2_000, cacheReadInputTokens: 3_000, outputTokens: 700 })))
      .toBe(400 + 10_000 + 600 + 14_000);
    // Of 1,000 written, 400 for an hour at $8 and 600 for five minutes at $5.
    expect(costMicroUsd(opus, tokens({ cacheCreationInputTokens: 1_000, cacheCreation1hInputTokens: 400 }))).toBe(3_000 + 3_200);
  });

  it("rounds a fraction of a micro-dollar up, never down", () => {
    // Three tokens at $0.10 per million is 0.3 micro-dollars.
    const haiku = ANTHROPIC_PRICE_TABLE.models["claude-haiku-5-5"];
    if (haiku === undefined) throw new Error("Haiku 5.5 price missing");
    expect(costMicroUsd(haiku, tokens({ inputTokens: 3 }))).toBe(1);
    expect(costMicroUsd(opus, tokens({ cacheReadInputTokens: 5 }))).toBe(1);
    expect(costMicroUsd(opus, tokens({}))).toBe(0);
  });
});

describe("pricing a response", () => {
  it("prices an answer at the model's rates and keeps the request id", () => {
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      usage: { input_tokens: 1_200, output_tokens: 800, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 2_000 },
      requestId: "req_usage_1",
    }));
    expect(used).toMatchObject({
      model: "claude-opus-5-5", requestId: "req_usage_1",
      inputTokens: 1_200, outputTokens: 800, cacheCreationInputTokens: 1_000, cacheReadInputTokens: 2_000,
      costMicroUsd: 1_200 * 4 + 800 * 20 + 1_000 * 5 + 2_000 * 0.2,
    });
    expect(used.attempts).toEqual([expect.objectContaining({ kind: "message", model: "claude-opus-5-5", billed: true, priced: "table" })]);
  });

  it("prices a refusal rescued by the fallback attempt by attempt, each at the rates of the model that ran it", () => {
    // Anthropic's documented shape: Opus 5.5 declined (535 in), Opus 4.8 answered (412 in, 264 out).
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 412,
        output_tokens: 264,
        iterations: [iteration("message", "claude-opus-5-5", 535, 0), iteration("fallback_message", "claude-opus-4-8", 412, 264)],
      },
    }));
    // The declined attempt's category is not named, so it is charged (the safe side): 535 at $4.
    // The fallback: 412 at $5 and 264 at $25.
    expect(used).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 535 + 412,
      outputTokens: 264,
      costMicroUsd: 535 * 4 + 412 * 5 + 264 * 25,
    });
    expect(used.attempts.map((attempt) => [attempt.kind, attempt.model, attempt.costMicroUsd])).toEqual([
      ["message", "claude-opus-5-5", 2_140],
      ["fallback_message", "claude-opus-4-8", 8_660],
    ]);
  });

  it.each([
    ["cyber", 0],
    ["general_harms", 0],
    ["no category", 0],
    ["bio", 412 * 4],
    ["frontier_llm", 412 * 4],
    ["reasoning_extraction", 412 * 4],
  ] as const)("charges a refusal before any output in %s only where Anthropic bills it", (category, cost) => {
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      stopReason: "refusal",
      category: category === "no category" ? null : category,
      content: [],
      usage: { input_tokens: 412, output_tokens: 0 },
    }));
    expect(used.inputTokens).toBe(412);
    expect(used.costMicroUsd).toBe(cost);
    expect(used.attempts[0]?.billed).toBe(cost > 0);
  });

  it("charges a refusal that came after some output at normal rates", () => {
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      stopReason: "refusal", category: "cyber", content: [], usage: { input_tokens: 412, output_tokens: 50 },
    }));
    expect(used.costMicroUsd).toBe(412 * 4 + 50 * 20);
  });

  it("charges every declined hop but the last unbilled one when the whole fallback chain refuses", () => {
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      model: "claude-opus-5",
      stopReason: "refusal",
      category: "cyber",
      content: [],
      usage: {
        input_tokens: 500,
        output_tokens: 0,
        iterations: [iteration("message", "claude-opus-5-5", 500, 0), iteration("fallback_message", "claude-opus-5", 500, 0)],
      },
    }));
    expect(used.costMicroUsd).toBe(500 * 4);
    expect(used.attempts.map((attempt) => attempt.billed)).toEqual([true, false]);
  });

  it("takes Claude Haiku 5.5's higher card only for a prompt over 100,000 tokens", () => {
    const at = (input: number) => meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-haiku-5-5", reply({
      model: "claude-haiku-5-5", usage: { input_tokens: input, output_tokens: 0 },
    })).costMicroUsd;
    expect(at(100_000)).toBe(10_000);
    // 100,001 at $0.50 per million is 50,000.5 micro-dollars, rounded up.
    expect(at(100_001)).toBe(50_001);
    // Cache reads count towards the prompt's length: 1 fresh at $0.50 and 100,000 read at $0.05.
    expect(meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-haiku-5-5", reply({
      model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 100_000 },
    })).costMicroUsd).toBe(5_001);
  });

  it("prices a model the table does not list at the table's highest rates, and says so", () => {
    const ceiling = ceilingRates(ANTHROPIC_PRICE_TABLE);
    expect(ceiling).toEqual({ input: 10_000_000, cacheWrite5m: 12_500_000, cacheWrite1h: 20_000_000, cacheRead: 500_000, output: 50_000_000 });
    const used = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      model: "claude-opus-9", usage: { input_tokens: 100, output_tokens: 10 },
    }));
    expect(used.costMicroUsd).toBe(100 * 10 + 10 * 50);
    expect(used.attempts[0]?.priced).toBe("ceiling");
  });

  it("names how a call ended", () => {
    expect(anthropicOutcome({ stop_reason: "end_turn" }, true)).toBe("ok");
    expect(anthropicOutcome({ stop_reason: "end_turn" }, false)).toBe("error");
    expect(anthropicOutcome({ stop_reason: "refusal" }, false)).toBe("refusal");
    expect(anthropicOutcome({ stop_reason: "max_tokens" }, false)).toBe("max_tokens");
  });
});

describe("the most a call can cost, reserved before it is made", () => {
  const promptTokens = (request: Parameters<typeof reserveForAnthropicRequest>[1]): number =>
    Buffer.byteLength(JSON.stringify({
      system: request.system ?? null, messages: request.messages, output_config: request.output_config ?? null, tools: request.tools ?? null,
    }), "utf8") + RESERVATION_FRAMING_TOKENS;

  it("holds a draft's own bytes as tokens and all 16,000 output tokens, for Opus 5.5 alone: a draft has no fallback", () => {
    const request = buildAnthropicDraftRequest("claude-opus-5-5", {
      useCase: "proposal_draft",
      instructions: buildAIDraftInstructions({ useCase: "proposal_draft", context: {} }),
      prompt: "",
      context: { clientName: "Morgan", clientNotes: "A ceilidh after dinner." },
    });
    const input = promptTokens(request);
    // Opus 5.5: input at its dearest input-side rate ($8, the 1-hour write), 16,000 out at $20.
    const expected = Math.ceil((input * 8_000_000 + 16_000 * 20_000_000) / 1_000_000);
    expect(reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, request)).toBe(expected);
    // About $0.36, against a typical draft's cents: the reservation is a ceiling.
    expect(expected).toBeGreaterThan(320_000);
    expect(expected).toBeLessThan(400_000);
  });

  it("is never less than the dearest response the request could bring back", () => {
    const request = buildAnthropicStructuredRequest("claude-opus-5-5", {
      useCase: "event_brief", system: EVENT_BRIEF_SYSTEM_PROMPT, prompt: "Dinner for 80, rounds, the Grand Hall.",
      schema: EVENT_BRIEF_ANSWER_SCHEMA, cacheSystem: true,
    });
    const input = promptTokens(request);
    const declined = iteration("message", "claude-opus-5-5", 0, 16_000, { write: input });
    const worst = meterAnthropicMessage(ANTHROPIC_PRICE_TABLE, "claude-opus-5-5", reply({
      model: "claude-opus-5",
      usage: {
        input_tokens: input,
        output_tokens: 16_000,
        iterations: [
          { ...declined, cache_creation: { ephemeral_1h_input_tokens: input, ephemeral_5m_input_tokens: 0 } },
          iteration("fallback_message", "claude-opus-5", input, 16_000),
        ],
      },
    }));
    expect(reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, request)).toBeGreaterThanOrEqual(worst.costMicroUsd);
  });

  it("holds one attempt for a model with no server-side fallback, and a listed fallback's own rates and limit", () => {
    const base = buildAnthropicDraftRequest("claude-haiku-5-5", { useCase: "enquiry_summary", instructions: "Rules.", prompt: "", context: {} });
    const input = promptTokens(base);
    expect(reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, base)).toBe(Math.ceil((input * 200_000 + 16_000 * 500_000) / 1_000_000));
    const listed = { ...base, fallbacks: [{ model: "claude-sonnet-5-5", max_tokens: 20_000 }] };
    expect(reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, listed)).toBe(
      Math.ceil((input * 200_000 + 16_000 * 500_000) / 1_000_000) + Math.ceil((input * 4_000_000 + 20_000 * 10_000_000) / 1_000_000),
    );
  });

  it("holds an unlisted model at the table's highest rates", () => {
    const request = buildAnthropicDraftRequest("claude-opus-9", { useCase: "enquiry_summary", instructions: "Rules.", prompt: "", context: {} });
    const input = promptTokens(request);
    expect(reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, request)).toBe(Math.ceil((input * 20_000_000 + 16_000 * 50_000_000) / 1_000_000));
  });
});

describe("the allowance", () => {
  it("turns dollars into micro-dollars, $50 when none is set", () => {
    expect(monthlyAllowanceMicroUsd(undefined)).toBe(50_000_000);
    expect(monthlyAllowanceMicroUsd(0.01)).toBe(10_000);
    expect(() => monthlyAllowanceMicroUsd(0)).toThrow(/positive/u);
    expect(() => monthlyAllowanceMicroUsd(Number.NaN)).toThrow(/positive/u);
  });

  it("refuses a call whose worst case does not fit, recording it and sending nothing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const usage = new TallyAIUsageMeter({ limitMicroUsd: 1 });
    const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch, maxRetries: 0 });
    const adapter = new AnthropicAIGenerationAdapter({
      model: "claude-opus-5-5", apiKey: "test-key-not-real", usage, send: (request) => client.beta.messages.create(request),
    });
    await expect(adapter.generateText({ useCase: "lead_qualification", instructions: "Rules.", prompt: "", context: {} }, ATTRIBUTION))
      .rejects.toBeInstanceOf(AIBudgetReachedError);
    expect(fetch).not.toHaveBeenCalled();
    expect(usage.entries).toEqual([{
      venueId: VENUE, userId: USER, feature: "lead_qualification", provider: "anthropic",
      requestedModel: "claude-opus-5-5", model: "claude-opus-5-5", requestId: null,
      inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      outcome: "budget_blocked", costMicroUsd: 0, priceTableVersion: "anthropic-2026-10-13", attempts: [],
    }]);
  });
});

describe("what the adapter records for each call", () => {
  function provider(...answers: { readonly status?: number; readonly body?: unknown }[]) {
    return vi.fn((): Promise<Response> => {
      const answer = answers.shift() ?? {};
      return Promise.resolve(new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json", "request-id": `req_adapter_${String(answer.status ?? 200)}`, "x-should-retry": "false" },
      }));
    });
  }

  function adapterOver(fetch: ReturnType<typeof provider>, usage: TallyAIUsageMeter) {
    const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch, maxRetries: 0 });
    return new AnthropicAIGenerationAdapter({
      model: "claude-opus-5-5", apiKey: "test-key-not-real", usage, send: (request) => client.beta.messages.create(request),
    });
  }

  const ASK = { useCase: "proposal_draft", instructions: "Rules.", prompt: "", context: { clientName: "Morgan" } } as const;

  it("records an answer, a draft another model wrote (no draft), a refusal, a cut-off and a failure, each as it ended", async () => {
    const usage = new TallyAIUsageMeter();
    const fetch = provider(
      { body: reply({ usage: { input_tokens: 1_000, output_tokens: 500 } }) },
      { body: reply({
        model: "claude-opus-5",
        usage: {
          input_tokens: 400, output_tokens: 300,
          iterations: [iteration("message", "claude-opus-5-5", 400, 0), iteration("fallback_message", "claude-opus-5", 400, 300)],
        },
      }) },
      { body: reply({ stopReason: "refusal", category: "cyber", content: [], usage: { input_tokens: 400, output_tokens: 0 } }) },
      { body: reply({ stopReason: "max_tokens", usage: { input_tokens: 400, output_tokens: 16_000 } }) },
      { status: 500, body: { type: "error", error: { type: "api_error", message: "test failure" } } },
    );
    const adapter = adapterOver(fetch, usage);
    await expect(adapter.generateText(ASK, ATTRIBUTION)).resolves.toBe("Dear Morgan, thank you.");
    // Written by the fallback after Opus 5.5 declined: not the asked model's draft, so none.
    await expect(adapter.generateText(ASK, ATTRIBUTION)).rejects.toThrow("Another model than the one asked answered");
    await expect(adapter.generateText(ASK, ATTRIBUTION)).rejects.toThrow("Claude declined to write this draft");
    await expect(adapter.generateText(ASK, ATTRIBUTION)).rejects.toThrow("cut off");
    await expect(adapter.generateText(ASK, ATTRIBUTION)).rejects.toBeInstanceOf(Anthropic.InternalServerError);

    expect(usage.entries.map((entry) => [entry.outcome, entry.model, entry.inputTokens, entry.outputTokens, entry.costMicroUsd, entry.requestId]))
      .toEqual([
        ["ok", "claude-opus-5-5", 1_000, 500, 1_000 * 4 + 500 * 20, "req_adapter_200"],
        ["refusal", "claude-opus-5", 800, 300, 400 * 4 + 400 * 5 + 300 * 25, "req_adapter_200"],
        ["refusal", "claude-opus-5-5", 400, 0, 0, "req_adapter_200"],
        ["max_tokens", "claude-opus-5-5", 400, 16_000, 400 * 4 + 16_000 * 20, "req_adapter_200"],
        ["error", "claude-opus-5-5", 0, 0, 0, "req_adapter_500"],
      ]);
    for (const entry of usage.entries) {
      expect(entry).toMatchObject({ venueId: VENUE, userId: USER, feature: "proposal_draft", provider: "anthropic", requestedModel: "claude-opus-5-5" });
    }
    expect(JSON.stringify(usage.entries)).not.toContain("Morgan");
  });

  it("records an answer it cannot use as an error, at what it cost", async () => {
    const usage = new TallyAIUsageMeter();
    const adapter = adapterOver(provider({ body: reply({ content: [], usage: { input_tokens: 10, output_tokens: 20 } }) }), usage);
    await expect(adapter.generateText(ASK, ATTRIBUTION)).rejects.toThrow("no usable draft text");
    expect(usage.entries).toEqual([expect.objectContaining({ outcome: "error", inputTokens: 10, outputTokens: 20, costMicroUsd: 10 * 4 + 20 * 20 })]);
  });
});

// The bespoke HTTP gateway (any provider but anthropic) says nothing of what
// a call used. It must still not spend past the allowance, so each call is
// charged its whole reservation at the table's highest rates, however it
// ended, and its row is marked as an estimate.
describe("a provider that reports no usage: the bespoke HTTP gateway", () => {
  const INPUT = { useCase: "enquiry_summary", instructions: "Rules.", prompt: "Rules.\n{\"guests\":90}", context: { guests: 90 } } as const;

  interface GatewayAnswer { readonly status?: number; readonly body?: unknown; readonly throws?: Error }

  function gateway(usage: TallyAIUsageMeter, ...answers: GatewayAnswer[]) {
    const sent: string[] = [];
    const send = vi.fn((_url: string, init: RequestInit): Promise<Response> => {
      sent.push(typeof init.body === "string" ? init.body : "");
      const answer = answers.shift() ?? {};
      if (answer.throws !== undefined) return Promise.reject(answer.throws);
      return Promise.resolve(new Response(JSON.stringify(answer.body ?? { text: "Ninety guests." }), {
        status: answer.status ?? 200, headers: { "content-type": "application/json" },
      }));
    });
    const adapter = new HttpAIGenerationAdapter({
      provider: "gateway", model: "gateway-model", baseUrl: "https://ai.example.test/draft", apiKey: "test-key-not-real", usage, send,
    });
    return { adapter, send, sent };
  }

  // The request's bytes and the framing at $20 a million (the table's dearest
  // input-side rate, Fable 5.1's 1-hour cache write) and 16,000 output tokens
  // at $50 (Fable 5.1's output).
  const charge = (body: string): number =>
    Math.ceil(((Buffer.byteLength(body, "utf8") + RESERVATION_FRAMING_TOKENS) * 20_000_000 + 16_000 * 50_000_000) / 1_000_000);

  it("charges each call its whole reservation at the table's highest rates, marked as an estimate", async () => {
    const usage = new TallyAIUsageMeter();
    const { adapter, sent } = gateway(usage);
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).resolves.toBe("Ninety guests.");
    expect(sent).toHaveLength(1);
    const body = sent[0] ?? "";
    const cost = charge(body);
    expect(reserveForUnreportedRequest(ANTHROPIC_PRICE_TABLE, body)).toBe(cost);
    // Near $0.90 for a short draft: a bound on what it could have cost, not a measurement.
    expect(cost).toBeGreaterThan(800_000);
    expect(cost).toBeLessThan(1_000_000);
    expect(usage.entries).toEqual([{
      venueId: VENUE, userId: USER, feature: "enquiry_summary", provider: "gateway",
      requestedModel: "gateway-model", model: "gateway-model", requestId: null,
      inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
      outcome: "ok", costMicroUsd: cost, priceTableVersion: "anthropic-2026-10-13",
      attempts: [{
        kind: "message", model: "gateway-model", inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0,
        cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0, billed: true, priced: "estimate", costMicroUsd: cost,
      }],
    }]);
    expect(JSON.stringify(usage.entries)).not.toContain("guests");
  });

  it("charges a call that failed, however it failed: the gateway may have spent before it did", async () => {
    const usage = new TallyAIUsageMeter();
    const { adapter, sent } = gateway(usage,
      { status: 500, body: { error: "upstream" } },
      { throws: new TypeError("fetch failed") },
      { body: { words: "not the gateway's shape" } },
    );
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).rejects.toThrow("AI adapter request failed with 500");
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).rejects.toThrow("fetch failed");
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).rejects.toThrow();
    expect(sent).toHaveLength(3);
    expect(usage.entries.map((entry) => [entry.outcome, entry.costMicroUsd, entry.attempts[0]?.priced]))
      .toEqual(sent.map((body) => ["error", charge(body), "estimate"]));
  });

  it("is held to the venue's allowance like Claude: refused, sending nothing, once the month's charges leave no room", async () => {
    // What one call is charged, learnt first; then an allowance that fits exactly two.
    const probe = new TallyAIUsageMeter();
    await gateway(probe).adapter.generateText(INPUT, ATTRIBUTION);
    const cost = probe.costMicroUsd;
    const usage = new TallyAIUsageMeter({ limitMicroUsd: 2 * cost });
    const { adapter, send } = gateway(usage);
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).resolves.toBe("Ninety guests.");
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).resolves.toBe("Ninety guests.");
    await expect(adapter.generateText(INPUT, ATTRIBUTION)).rejects.toBeInstanceOf(AIBudgetReachedError);
    expect(send).toHaveBeenCalledTimes(2);
    expect(usage.entries.map((entry) => [entry.provider, entry.outcome, entry.costMicroUsd]))
      .toEqual([["gateway", "ok", cost], ["gateway", "ok", cost], ["gateway", "budget_blocked", 0]]);
  });
});

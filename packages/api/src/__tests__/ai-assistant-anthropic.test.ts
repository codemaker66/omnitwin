import Anthropic from "@anthropic-ai/sdk";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Env } from "../env.js";
import {
  AI_DRAFT_SYSTEM_PROMPT,
  AIGenerationError,
  AnthropicGenerationAdapter,
  HttpAIGenerationAdapter,
  DisabledAIGenerationAdapter,
  aiDraftFailureResponse,
  buildAIDraftPrompt,
  createAIGenerationAdapterFromEnv,
  type AnthropicCreateMessage,
} from "../services/ai-assistant.js";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

function message(overrides: Partial<BetaMessage> = {}): BetaMessage {
  const base: BetaMessage = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: "Draft summary for review.", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
  return { ...base, ...overrides };
}

function recordingClient(response: BetaMessage | Error): {
  readonly createMessage: AnthropicCreateMessage;
  readonly calls: CreateParams[];
} {
  const calls: CreateParams[] = [];
  const createMessage: AnthropicCreateMessage = (params) => {
    calls.push(params);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  };
  return { createMessage, calls };
}

const enquiryRequest = {
  useCase: "enquiry_summary" as const,
  context: { enquiryId: "enq-1", guestCount: 120, notes: "Wedding, ceilidh after dinner" },
  requestedTone: "Warm and brief",
};

function adapterInput(request = enquiryRequest) {
  return { useCase: request.useCase, prompt: buildAIDraftPrompt(request), context: request.context };
}

function anthropicAdapter(
  createMessage: AnthropicCreateMessage,
  extra: Partial<ConstructorParameters<typeof AnthropicGenerationAdapter>[0]> = {},
): AnthropicGenerationAdapter {
  return new AnthropicGenerationAdapter({
    model: "claude-opus-5-5",
    apiKey: "test-key-not-real",
    createMessage,
    ...extra,
  });
}

describe("buildAIDraftPrompt", () => {
  it("keeps the fixed instructions free of per-request data so the system block is cacheable", () => {
    const a = buildAIDraftPrompt(enquiryRequest);
    const b = buildAIDraftPrompt({
      useCase: "proposal_draft",
      context: { proposalId: "p-9", total: 4200 },
    });
    expect(a.system).toBe(AI_DRAFT_SYSTEM_PROMPT);
    expect(b.system).toBe(AI_DRAFT_SYSTEM_PROMPT);
    expect(a.system).not.toContain("enq-1");
    expect(a.system).not.toContain("Warm and brief");
  });

  it("keeps the draft-only and no-certification safety wording in the system block", () => {
    expect(AI_DRAFT_SYSTEM_PROMPT).toContain(
      "Do not claim certification, legal compliance, fire approval, occupancy approval, guaranteed accessibility, production readiness, or photoreal digital-twin status.",
    );
    expect(AI_DRAFT_SYSTEM_PROMPT).toContain(
      "The output is draft-only, AI-generated, unverified, and requires human review before it is used.",
    );
  });

  it("puts use case, tone and canonical context in the user message", () => {
    const { user } = buildAIDraftPrompt(enquiryRequest);
    expect(user).toContain("Use case: enquiry_summary.");
    expect(user).toContain("Tone: Warm and brief.");
    expect(user).toContain('"enquiryId":"enq-1"');
    expect(user).toMatch(/<context>[\s\S]*<\/context>/u);
  });

  it("covers every draft use case in the fixed instructions", () => {
    for (const useCase of [
      "enquiry_summary",
      "lead_qualification",
      "proposal_draft",
      "beo_supplier_instruction_draft",
      "route_conflict_explanation",
      "truth_mode_explanation",
    ]) {
      expect(AI_DRAFT_SYSTEM_PROMPT).toContain(useCase);
    }
  });
});

describe("AnthropicGenerationAdapter request shape", () => {
  it("sends a cache-marked system block, one user message, low effort and no thinking override", async () => {
    const { createMessage, calls } = recordingClient(message());
    await anthropicAdapter(createMessage).generateText(adapterInput());

    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params).toBeDefined();
    if (params === undefined) return;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(16000);
    expect(params.system).toEqual([
      { type: "text", text: AI_DRAFT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ]);
    expect(params.messages).toEqual([
      { role: "user", content: buildAIDraftPrompt(enquiryRequest).user },
    ]);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
  });

  it("opts into server-side refusal fallbacks on models that accept them", async () => {
    const { createMessage, calls } = recordingClient(message());
    await anthropicAdapter(createMessage).generateText(adapterInput());
    expect(calls[0]?.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(calls[0]?.fallbacks).toBe("default");
  });

  it("omits fallbacks for models that do not accept them", async () => {
    const { createMessage, calls } = recordingClient(message());
    await anthropicAdapter(createMessage, { model: "claude-haiku-4-5" }).generateText(adapterInput());
    expect(calls[0]).not.toHaveProperty("fallbacks");
    expect(calls[0]).not.toHaveProperty("betas");
  });

  it("uses the configured effort", async () => {
    const { createMessage, calls } = recordingClient(message());
    await anthropicAdapter(createMessage, { effort: "medium" }).generateText(adapterInput());
    expect(calls[0]?.output_config).toEqual({ effort: "medium" });
  });

  it("reports provider and model in status without the key", () => {
    const adapter = anthropicAdapter(recordingClient(message()).createMessage);
    expect(adapter.status).toEqual({
      configured: true,
      provider: "anthropic",
      model: "claude-opus-5-5",
      disabledReason: null,
    });
    expect(JSON.stringify(adapter.status)).not.toContain("test-key-not-real");
  });
});

describe("AnthropicGenerationAdapter response handling", () => {
  it("returns trimmed text from text blocks only and reports usage", async () => {
    const onUsage = vi.fn();
    const { createMessage } = recordingClient(message({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "  First part.", citations: null },
        { type: "text", text: " Second part.  ", citations: null },
      ] as BetaMessage["content"],
    }));
    const text = await anthropicAdapter(createMessage, { onUsage }).generateText(adapterInput());
    expect(text).toBe("First part. Second part.");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-opus-5-5",
      useCase: "enquiry_summary",
      inputTokens: 120,
      outputTokens: 40,
      cacheReadInputTokens: 900,
      cacheCreationInputTokens: 0,
    }));
  });

  it("raises a refusal error with the policy category", async () => {
    const { createMessage } = recordingClient(message({
      stop_reason: "refusal",
      content: [],
      stop_details: {
        type: "refusal",
        category: "cyber",
        explanation: "declined",
        fallback_credit_token: null,
        fallback_has_prefill_claim: null,
        recommended_model: null,
      },
    }));
    const err = await anthropicAdapter(createMessage).generateText(adapterInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIGenerationError);
    expect(err).toMatchObject({ reason: "refusal", category: "cyber" });
  });

  it("raises a truncation error when the model hits max_tokens", async () => {
    const { createMessage } = recordingClient(message({ stop_reason: "max_tokens" }));
    await expect(anthropicAdapter(createMessage).generateText(adapterInput()))
      .rejects.toMatchObject({ reason: "truncated" });
  });

  it("rejects text over the 8000-character draft limit instead of cutting it", async () => {
    const { createMessage } = recordingClient(message({
      content: [{ type: "text", text: "x".repeat(8001), citations: null }],
    }));
    await expect(anthropicAdapter(createMessage).generateText(adapterInput()))
      .rejects.toMatchObject({ reason: "too_long" });
  });

  it("rejects an empty answer", async () => {
    const { createMessage } = recordingClient(message({
      content: [{ type: "text", text: "   ", citations: null }],
    }));
    await expect(anthropicAdapter(createMessage).generateText(adapterInput()))
      .rejects.toMatchObject({ reason: "empty" });
  });
});

describe("AnthropicGenerationAdapter SDK error mapping", () => {
  const headers = new Headers({ "request-id": "req_123" });
  const cases: readonly [string, Error, string][] = [
    ["401", new Anthropic.AuthenticationError(401, undefined, "bad key", headers), "provider_auth"],
    ["403", new Anthropic.PermissionDeniedError(403, undefined, "denied", headers), "provider_auth"],
    ["429", new Anthropic.RateLimitError(429, undefined, "slow down", headers), "provider_busy"],
    ["529", new Anthropic.InternalServerError(529, undefined, "overloaded", headers), "provider_busy"],
    ["500", new Anthropic.InternalServerError(500, undefined, "boom", headers), "provider_busy"],
    ["connection", new Anthropic.APIConnectionError({ message: "offline" }), "provider_busy"],
    ["400", new Anthropic.BadRequestError(400, undefined, "bad request", headers), "provider_error"],
  ];

  for (const [label, sdkError, reason] of cases) {
    it(`maps ${label} to ${reason}`, async () => {
      const { createMessage } = recordingClient(sdkError);
      const err = await anthropicAdapter(createMessage).generateText(adapterInput()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AIGenerationError);
      expect(err).toMatchObject({ reason });
      expect((err as Error).message).not.toContain("test-key-not-real");
    });
  }

  it("keeps the provider request id for support", async () => {
    const { createMessage } = recordingClient(
      new Anthropic.RateLimitError(429, undefined, "slow down", headers),
    );
    await expect(anthropicAdapter(createMessage).generateText(adapterInput()))
      .rejects.toMatchObject({ status: 429, requestId: "req_123" });
  });
});

describe("aiDraftFailureResponse", () => {
  it("maps provider pressure to 503 and everything else to the existing 502", () => {
    expect(aiDraftFailureResponse(new AIGenerationError("provider_busy", "x"))).toMatchObject({
      status: 503,
      body: { code: "AI_PROVIDER_BUSY", reason: "provider_busy" },
    });
    expect(aiDraftFailureResponse(new AIGenerationError("refusal", "x"))).toMatchObject({
      status: 502,
      body: { code: "AI_DRAFT_GENERATION_FAILED", reason: "refusal" },
    });
    expect(aiDraftFailureResponse(new Error("anything"))).toEqual({
      status: 502,
      body: { error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" },
    });
  });

  it("never echoes provider error text to the client", () => {
    const failure = aiDraftFailureResponse(
      new AIGenerationError("provider_error", "upstream said: secret detail"),
    );
    expect(JSON.stringify(failure)).not.toContain("secret detail");
  });
});

describe("createAIGenerationAdapterFromEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function env(overrides: Partial<Env>): Env {
    return {
      AI_ASSISTANT_ENABLED: "true",
      AI_ASSISTANT_PROVIDER: "anthropic",
      AI_ASSISTANT_MODEL: "claude-opus-5-5",
      AI_ASSISTANT_API_KEY: "test-key-not-real",
      ...overrides,
    } as Env;
  }

  it("selects the Anthropic adapter without a base URL", () => {
    const adapter = createAIGenerationAdapterFromEnv(env({}));
    expect(adapter).toBeInstanceOf(AnthropicGenerationAdapter);
    expect(adapter.status).toMatchObject({ configured: true, provider: "anthropic" });
  });

  it("keeps the HTTP adapter for other providers", () => {
    const adapter = createAIGenerationAdapterFromEnv(env({
      AI_ASSISTANT_PROVIDER: "internal-gateway",
      AI_ASSISTANT_BASE_URL: "https://ai.example.test/draft",
    }));
    expect(adapter).toBeInstanceOf(HttpAIGenerationAdapter);
  });

  it("stays disabled for other providers without a base URL", () => {
    const adapter = createAIGenerationAdapterFromEnv(env({ AI_ASSISTANT_PROVIDER: "internal-gateway" }));
    expect(adapter).toBeInstanceOf(DisabledAIGenerationAdapter);
  });

  it("stays disabled when not enabled", () => {
    expect(createAIGenerationAdapterFromEnv(env({ AI_ASSISTANT_ENABLED: "false" })))
      .toBeInstanceOf(DisabledAIGenerationAdapter);
  });

  it("HTTP adapter still posts one prompt string containing the safety wording", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "ok" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new HttpAIGenerationAdapter({
      provider: "internal-gateway",
      model: "m",
      baseUrl: "https://ai.example.test/draft",
      apiKey: "k",
    });
    await adapter.generateText(adapterInput());
    const sent = fetchMock.mock.calls[0]?.[1]?.body;
    const body = JSON.parse(typeof sent === "string" ? sent : "{}") as { prompt: string; useCase: string };
    expect(body.useCase).toBe("enquiry_summary");
    expect(body.prompt).toContain("draft-only, AI-generated, unverified");
    expect(body.prompt).toContain('"enquiryId":"enq-1"');
  });
});

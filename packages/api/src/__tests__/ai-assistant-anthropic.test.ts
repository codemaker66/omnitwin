import Anthropic from "@anthropic-ai/sdk";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { aiAssistantRoutes } from "../routes/ai-assistant.js";
import {
  AIAssistantDisabledError,
  DisabledAIGenerationAdapter,
  createAIStructuredGenerationAdapterFromEnv,
} from "../services/ai-assistant.js";
import {
  AIDraftNotProducedError,
  AnthropicAIGenerationAdapter,
  type AnthropicDraftSend,
} from "../services/anthropic-draft-adapter.js";

// ---------------------------------------------------------------------------
// The Anthropic provider's structured answers (T-650) and its failures at the
// routes, with the real SDK and only its HTTP boundary replaced: every
// request is recorded and answered here, so these tests prove what is sent
// and how each answer or failure is handled. Nothing leaves the machine, and
// a mock does not prove the live integration. The text-draft request itself
// is covered by anthropic-draft-adapter.test.ts.
// ---------------------------------------------------------------------------

interface Sent {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
  readonly throws?: Error;
}

function message(content: readonly Record<string, unknown>[], stopReason = "end_turn"): Record<string, unknown> {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 12, output_tokens: 34 },
  };
}

const text = (words: string): Record<string, unknown> => ({ type: "text", text: words, citations: null });

function errorBody(type: string): Record<string, unknown> {
  return { type: "error", error: { type, message: `${type} from the test provider` } };
}

/** A fetch that records each request and answers from the queue. */
function provider(...answers: Answer[]) {
  const sent: Sent[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const answer = answers.shift() ?? { body: message([text("Unqueued answer.")]) };
    sent.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {},
    });
    if (answer.throws !== undefined) return Promise.reject(answer.throws);
    return Promise.resolve(new Response(JSON.stringify(answer.body ?? message([text("ok")])), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_test_1", "x-should-retry": "false" },
    }));
  });
  return { sent, fetch };
}

/** The adapter's own send, through a real SDK client whose fetch is the test's. */
function sdkSend(fetch: ReturnType<typeof provider>["fetch"]): AnthropicDraftSend {
  // The base URL is pinned so a developer's ANTHROPIC_BASE_URL cannot move it.
  const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch, maxRetries: 0 });
  return (request, options) => client.beta.messages.create(request, { signal: options?.signal ?? null });
}

function adapterWith(fake: ReturnType<typeof provider>, model = "claude-opus-5-5"): AnthropicAIGenerationAdapter {
  return new AnthropicAIGenerationAdapter({ model, apiKey: "test-key-not-real", send: sdkSend(fake.fetch) });
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["guests"], properties: { guests: { type: "integer" } } };
const ASK = { useCase: "event_brief", system: "Read the brief.", prompt: "Elaine Crawford, about 120 in the Grand Hall.", schema: SCHEMA } as const;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the provider request to fail");
}

describe("the Anthropic provider's structured answers", () => {
  it("asks the Messages API for the JSON shape, rules in the system prompt, and returns the answer parsed", async () => {
    const fake = provider({ body: message([{ type: "thinking", thinking: "", signature: "sig" }, text("{\"guests\": 120}")]) });
    await expect(adapterWith(fake).generateStructured(ASK)).resolves.toEqual({ guests: 120 });
    expect(fake.sent).toHaveLength(1);
    const [request] = fake.sent;
    expect(new URL(request?.url ?? "").pathname).toBe("/v1/messages");
    expect(request?.headers.get("x-api-key")).toBe("test-key-not-real");
    expect(request?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(request?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "Read the brief.",
      messages: [{ role: "user", content: "Elaine Crawford, about 120 in the Grand Hall." }],
      fallbacks: "default",
    });
  });

  it("asks a model without the default refusal fallback without it", async () => {
    const fake = provider({ body: message([text("{\"guests\": 1}")]) });
    await adapterWith(fake, "claude-haiku-5-5").generateStructured(ASK);
    expect(fake.sent[0]?.headers.get("anthropic-beta")).toBeNull();
    expect(fake.sent[0]?.body).not.toHaveProperty("fallbacks");
  });

  it.each([
    ["a refusal", message([], "refusal")],
    ["an answer cut off at the token limit", message([text("{\"guests\": 1")], "max_tokens")],
    ["an empty answer", message([text("  ")])],
    ["an answer that is not JSON", message([text("about 120 guests")])],
  ] as const)("refuses %s rather than return it", async (_, body) => {
    expect(await rejection(adapterWith(provider({ body })).generateStructured(ASK))).toBeInstanceOf(AIDraftNotProducedError);
  });

  it.each([
    ["a rate limit", 429, "rate_limit_error"],
    ["a server error", 500, "api_error"],
    ["a rejected key", 401, "authentication_error"],
  ] as const)("passes on the SDK's own error for %s, never as AI switched off, and never with the prompt", async (_, status, type) => {
    const error = await rejection(adapterWith(provider({ status, body: errorBody(type) })).generateStructured(ASK));
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect(error).not.toBeInstanceOf(AIAssistantDisabledError);
    expect(error instanceof Anthropic.APIError ? error.status : null).toBe(status);
    expect(`${error instanceof Error ? error.message : ""} ${JSON.stringify(error)}`).not.toMatch(/Elaine|Crawford|Grand Hall/u);
  });

  it("stops when the person who asked has gone", async () => {
    const waiting = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(new DOMException("The operation was aborted.", "AbortError")); });
    }));
    const adapter = new AnthropicAIGenerationAdapter({ model: "claude-opus-5-5", apiKey: "test-key-not-real", send: sdkSend(waiting) });
    const gone = new AbortController();
    const asked = rejection(adapter.generateStructured({ ...ASK, signal: gone.signal }));
    await vi.waitFor(() => { expect(waiting).toHaveBeenCalledTimes(1); });
    gone.abort();
    expect(await asked).toBeInstanceOf(Anthropic.APIUserAbortError);
  });
});

describe("the provider that reads briefs", () => {
  const env = (values: Partial<Env>): Env => ({ ...values }) as Env;

  it("is the Anthropic provider when it is configured", () => {
    const reader = createAIStructuredGenerationAdapterFromEnv(env({
      AI_ASSISTANT_ENABLED: "true", AI_ASSISTANT_PROVIDER: "anthropic", AI_ASSISTANT_MODEL: "claude-opus-5-5", AI_ASSISTANT_API_KEY: "test-key-not-real",
    }));
    expect(reader).toBeInstanceOf(AnthropicAIGenerationAdapter);
    expect(reader.status).toEqual({ configured: true, provider: "anthropic", model: "claude-opus-5-5", disabledReason: null });
    expect(JSON.stringify(reader.status)).not.toContain("test-key-not-real");
  });

  it("is off, saying why, with the gateway, which cannot answer in a given shape", async () => {
    const reader = createAIStructuredGenerationAdapterFromEnv(env({
      AI_ASSISTANT_ENABLED: "true", AI_ASSISTANT_PROVIDER: "gateway", AI_ASSISTANT_MODEL: "m", AI_ASSISTANT_BASE_URL: "https://ai.example.test/draft", AI_ASSISTANT_API_KEY: "k",
    }));
    expect(reader.status).toMatchObject({ configured: false, disabledReason: "Reading event briefs needs the Anthropic provider." });
    await expect(reader.generateStructured(ASK)).rejects.toBeInstanceOf(AIAssistantDisabledError);
  });

  it("is off while AI is off", () => {
    expect(createAIStructuredGenerationAdapterFromEnv(env({ AI_ASSISTANT_ENABLED: "false", AI_ASSISTANT_PROVIDER: "anthropic" })))
      .toBeInstanceOf(DisabledAIGenerationAdapter);
  });
});

describe("the AI draft routes with the Anthropic provider", () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    if (server !== null) await server.close();
    server = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function serve(fake: ReturnType<typeof provider>): Promise<FastifyInstance> {
    vi.stubEnv("NODE_ENV", "test");
    // The provider is built from the environment, as in production; only the
    // global fetch under the SDK is the test's.
    vi.stubGlobal("fetch", fake.fetch);
    const app = Fastify();
    const values = { AI_ASSISTANT_ENABLED: "true", AI_ASSISTANT_PROVIDER: "anthropic", AI_ASSISTANT_MODEL: "claude-opus-5-5", AI_ASSISTANT_API_KEY: "test-key-not-real" };
    await app.register(aiAssistantRoutes, { env: { ...values } as Env, prefix: "/ai" });
    await app.ready();
    server = app;
    return app;
  }

  const staff = { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-000000006501", email: "staff@test.invalid", role: "staff", venueId: "00000000-0000-4000-8000-000000006502" })}` };

  it("reports the provider and model, never the key", async () => {
    const app = await serve(provider());
    const res = await app.inject({ method: "GET", url: "/ai/status", headers: staff });
    expect(res.json()).toEqual({ data: { configured: true, provider: "anthropic", model: "claude-opus-5-5", disabledReason: null } });
    expect(res.body).not.toContain("test-key-not-real");
  });

  it("fails as the gateway fails: 502 AI_DRAFT_GENERATION_FAILED, for every provider failure", async () => {
    const lost = { throws: new TypeError("fetch failed") };
    const app = await serve(provider(
      { status: 500, body: errorBody("api_error") },
      { status: 429, body: errorBody("rate_limit_error") },
      { body: message([], "refusal") },
      // A lost connection is retried twice by the production client.
      lost, lost, lost,
    ));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await app.inject({ method: "POST", url: "/ai/drafts", headers: staff, payload: { useCase: "enquiry_summary", context: { guestCount: 90 } } });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" });
    }
  });

  it("returns a review-gated draft, never sent", async () => {
    const app = await serve(provider({ body: message([text("Ninety guests, dinner on rounds.")]) }));
    const res = await app.inject({ method: "POST", url: "/ai/drafts", headers: staff, payload: { useCase: "enquiry_summary", context: { guestCount: 90 } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { body: "Ninety guests, dinner on rounds.", humanReviewRequired: true, sendState: "draft_only" } });
  });
});

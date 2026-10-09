import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AIAssistantStatusSchema, stableCanonicalJson, type AIAssistantStatus } from "@omnitwin/types";
import type {
  AIGenerationAdapter,
  AIGenerationInput,
  AIStructuredGenerationAdapter,
  AIStructuredGenerationInput,
} from "./ai-assistant.js";

// ---------------------------------------------------------------------------
// Claude, through Anthropic's own SDK, as an AI draft provider. The draft's
// rules go in the system prompt and the venue's structured context goes in
// the user turn inside <context> tags, so a client's words stay data rather
// than instructions. A refusal or a cut-off answer is an error, never a
// partial draft: the route reports it and nothing reaches the composer.
//
// It also answers in a given JSON shape (structured outputs) for typed event
// briefs (T-650), with the same refusal and cut-off rules.
// ---------------------------------------------------------------------------

export const ANTHROPIC_PROVIDER = "anthropic";

/** The model the drafts and briefs are built and evaluated for. */
export const RECOMMENDED_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Drafts are short; this leaves room for thinking before the answer. */
const MAX_TOKENS = 16000;
/** A staff member is waiting on the draft, so a stalled call gives up. */
const REQUEST_TIMEOUT_MS = 90_000;

// Models that accept the server-side refusal fallback in its "default"
// routing form. Others (Haiku among them) have no server-side fallback, and
// sending the parameter to them is rejected.
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MODELS_WITH_SERVER_FALLBACK: ReadonlySet<string> = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

const DraftTextSchema = z.string().trim().min(1).max(8000);

export class AIDraftNotProducedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIDraftNotProducedError";
  }
}

export type AnthropicDraftRequest = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type AnthropicDraftSend = (
  request: AnthropicDraftRequest,
  options?: { readonly signal?: AbortSignal },
) => Promise<Anthropic.Beta.BetaMessage>;

function withServerFallback(model: string, request: AnthropicDraftRequest): AnthropicDraftRequest {
  if (!MODELS_WITH_SERVER_FALLBACK.has(model)) return request;
  return { ...request, betas: [SERVER_FALLBACK_BETA], fallbacks: "default" };
}

export function buildAnthropicDraftRequest(model: string, input: AIGenerationInput): AnthropicDraftRequest {
  return withServerFallback(model, {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium" },
    system: input.instructions,
    messages: [{
      role: "user",
      content: `<context>\n${stableCanonicalJson(input.context)}\n</context>`,
    }],
  });
}

/** A request whose answer must match a JSON schema (structured outputs). */
export function buildAnthropicStructuredRequest(model: string, input: AIStructuredGenerationInput): AnthropicDraftRequest {
  return withServerFallback(model, {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium", format: { type: "json_schema", schema: input.schema } },
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
  });
}

/** The structured answer, parsed but not yet validated, or an error when
 *  Claude declined, was cut off or answered with something that is not JSON. */
export function readAnthropicStructuredAnswer(message: Anthropic.Beta.BetaMessage): unknown {
  if (message.stop_reason === "refusal") {
    throw new AIDraftNotProducedError("Claude declined to read this");
  }
  if (message.stop_reason === "max_tokens") {
    throw new AIDraftNotProducedError("Claude's answer was cut off before it finished");
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  try {
    if (text.length === 0) throw new SyntaxError("empty");
    return JSON.parse(text) as unknown;
  } catch {
    throw new AIDraftNotProducedError("Claude returned no usable answer");
  }
}

/** The draft's text, or an error when Claude declined or was cut off. */
export function readAnthropicDraftText(message: Anthropic.Beta.BetaMessage): string {
  if (message.stop_reason === "refusal") {
    throw new AIDraftNotProducedError("Claude declined to write this draft");
  }
  if (message.stop_reason === "max_tokens") {
    throw new AIDraftNotProducedError("Claude's draft was cut off before it finished");
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const parsed = DraftTextSchema.safeParse(text);
  if (!parsed.success) {
    throw new AIDraftNotProducedError("Claude returned no usable draft text");
  }
  return parsed.data;
}

export class AnthropicAIGenerationAdapter implements AIGenerationAdapter, AIStructuredGenerationAdapter {
  readonly status: AIAssistantStatus;
  private readonly model: string;
  private readonly send: AnthropicDraftSend;

  constructor(input: {
    readonly model: string;
    readonly apiKey: string;
    readonly baseUrl?: string;
    /** The Console workspace to bill, needed when the key is not scoped to one. */
    readonly workspaceId?: string;
    /** Replaces the network call, for tests. */
    readonly send?: AnthropicDraftSend;
  }) {
    this.status = AIAssistantStatusSchema.parse({
      configured: true,
      provider: ANTHROPIC_PROVIDER,
      model: input.model,
      disabledReason: null,
    });
    this.model = input.model;
    if (input.send !== undefined) {
      this.send = input.send;
    } else {
      const client = new Anthropic({
        apiKey: input.apiKey,
        ...(input.baseUrl !== undefined ? { baseURL: input.baseUrl } : {}),
        ...(input.workspaceId !== undefined ? { defaultHeaders: { "anthropic-workspace-id": input.workspaceId } } : {}),
        timeout: REQUEST_TIMEOUT_MS,
        // Pinned: request bodies carry what clients and planners wrote, and a
        // debug level set in the environment (ANTHROPIC_LOG) would log them.
        logLevel: "warn",
      });
      this.send = (request, options) => client.beta.messages.create(request, { signal: options?.signal ?? null });
    }
  }

  async generateText(input: AIGenerationInput): Promise<string> {
    const message = await this.send(buildAnthropicDraftRequest(this.model, input));
    return readAnthropicDraftText(message);
  }

  async generateStructured(input: AIStructuredGenerationInput): Promise<unknown> {
    const message = await this.send(buildAnthropicStructuredRequest(this.model, input), { signal: input.signal });
    return readAnthropicStructuredAnswer(message);
  }
}

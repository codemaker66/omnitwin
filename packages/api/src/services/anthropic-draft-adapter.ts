import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AIAssistantStatusSchema, stableCanonicalJson, type AIAssistantStatus } from "@omnitwin/types";
import type { AIGenerationAdapter, AIGenerationInput } from "./ai-assistant.js";

// ---------------------------------------------------------------------------
// Claude, through Anthropic's own SDK, as an AI draft provider. The draft's
// rules go in the system prompt and the venue's structured context goes in
// the user turn inside <context> tags, so a client's words stay data rather
// than instructions. A refusal or a cut-off answer is an error, never a
// partial draft: the route reports it and nothing reaches the composer.
// ---------------------------------------------------------------------------

export const ANTHROPIC_PROVIDER = "anthropic";

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
export type AnthropicDraftSend = (request: AnthropicDraftRequest) => Promise<Anthropic.Beta.BetaMessage>;

export function buildAnthropicDraftRequest(model: string, input: AIGenerationInput): AnthropicDraftRequest {
  const request: AnthropicDraftRequest = {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium" },
    system: input.instructions,
    messages: [{
      role: "user",
      content: `<context>\n${stableCanonicalJson(input.context)}\n</context>`,
    }],
  };
  if (!MODELS_WITH_SERVER_FALLBACK.has(model)) return request;
  return { ...request, betas: [SERVER_FALLBACK_BETA], fallbacks: "default" };
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

export class AnthropicAIGenerationAdapter implements AIGenerationAdapter {
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
      });
      this.send = (request) => client.beta.messages.create(request);
    }
  }

  async generateText(input: AIGenerationInput): Promise<string> {
    const message = await this.send(buildAnthropicDraftRequest(this.model, input));
    return readAnthropicDraftText(message);
  }
}

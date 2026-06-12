import { z } from "zod";
import {
  AIAssistantStatusSchema,
  CreateAIDraftRequestSchema,
  createReviewGatedAIDraft,
  stableCanonicalJson,
  type AIAssistantStatus,
  type AIDraft,
  type AIDraftUseCase,
  type CanonicalJsonValue,
  type CreateAIDraftRequest,
} from "@omnitwin/types";
import type { Env } from "../env.js";

export interface AIGenerationAdapter {
  readonly status: AIAssistantStatus;
  generateText(input: AIGenerationInput): Promise<string>;
}

export interface AIGenerationInput {
  readonly useCase: AIDraftUseCase;
  readonly prompt: string;
  readonly context: Record<string, CanonicalJsonValue>;
}

const AdapterResponseSchema = z.object({
  text: z.string().trim().min(1).max(8000),
}).strict();

export class AIAssistantDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIAssistantDisabledError";
  }
}

export class DisabledAIGenerationAdapter implements AIGenerationAdapter {
  readonly status: AIAssistantStatus;

  constructor(reason = "AI drafts are disabled until provider environment is configured.") {
    this.status = AIAssistantStatusSchema.parse({
      configured: false,
      provider: null,
      model: null,
      disabledReason: reason,
    });
  }

  generateText(): Promise<string> {
    return Promise.reject(new AIAssistantDisabledError(this.status.disabledReason ?? "AI assistant is disabled."));
  }
}

export class HttpAIGenerationAdapter implements AIGenerationAdapter {
  readonly status: AIAssistantStatus;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(input: {
    readonly provider: string;
    readonly model: string;
    readonly baseUrl: string;
    readonly apiKey: string;
  }) {
    this.status = AIAssistantStatusSchema.parse({
      configured: true,
      provider: input.provider,
      model: input.model,
      disabledReason: null,
    });
    this.baseUrl = input.baseUrl;
    this.apiKey = input.apiKey;
    this.model = input.model;
  }

  async generateText(input: AIGenerationInput): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        useCase: input.useCase,
        prompt: input.prompt,
        context: input.context,
      }),
    });
    if (!response.ok) {
      throw new Error(`AI adapter request failed with ${String(response.status)}`);
    }
    const payload: unknown = await response.json();
    return AdapterResponseSchema.parse(payload).text;
  }
}

export function createAIGenerationAdapterFromEnv(env: Env): AIGenerationAdapter {
  if (env.AI_ASSISTANT_ENABLED !== "true") {
    return new DisabledAIGenerationAdapter();
  }
  if (
    env.AI_ASSISTANT_PROVIDER === undefined ||
    env.AI_ASSISTANT_MODEL === undefined ||
    env.AI_ASSISTANT_BASE_URL === undefined ||
    env.AI_ASSISTANT_API_KEY === undefined
  ) {
    return new DisabledAIGenerationAdapter("AI drafts are enabled but provider environment is incomplete.");
  }
  return new HttpAIGenerationAdapter({
    provider: env.AI_ASSISTANT_PROVIDER,
    model: env.AI_ASSISTANT_MODEL,
    baseUrl: env.AI_ASSISTANT_BASE_URL,
    apiKey: env.AI_ASSISTANT_API_KEY,
  });
}

export function titleForAIDraft(useCase: AIDraftUseCase): string {
  switch (useCase) {
    case "enquiry_summary":
      return "Enquiry summary draft";
    case "lead_qualification":
      return "Lead qualification draft";
    case "proposal_draft":
      return "Proposal wording draft";
    case "beo_supplier_instruction_draft":
      return "BEO and supplier instruction draft";
    case "route_conflict_explanation":
      return "Route conflict explanation draft";
    case "truth_mode_explanation":
      return "Truth Mode explanation draft";
  }
}

export function buildAIDraftPrompt(input: CreateAIDraftRequest): string {
  const tone = input.requestedTone ?? "Plain English, concise, internal staff draft.";
  return [
    "You are drafting internal Venviewer planning support text.",
    "Do not claim certification, legal compliance, fire approval, occupancy approval, guaranteed accessibility, production readiness, or photoreal digital-twin status.",
    "The output is draft-only, AI-generated, unverified, and requires human review before it is used.",
    `Use case: ${input.useCase}.`,
    `Tone: ${tone}.`,
    "Structured context:",
    stableCanonicalJson(input.context),
  ].join("\n");
}

export async function generateAIDraft(
  adapter: AIGenerationAdapter,
  request: CreateAIDraftRequest,
  now: Date = new Date(),
): Promise<AIDraft> {
  const parsed = CreateAIDraftRequestSchema.parse(request);
  const prompt = buildAIDraftPrompt(parsed);
  const body = await adapter.generateText({
    useCase: parsed.useCase,
    prompt,
    context: parsed.context,
  });
  return createReviewGatedAIDraft({
    useCase: parsed.useCase,
    title: titleForAIDraft(parsed.useCase),
    body,
    context: parsed.context,
    generatedAt: now.toISOString(),
  });
}

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, gt, gte, lte, sql, type AnyColumn } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import {
  AI_BUDGET_REACHED,
  AI_USAGE_FEATURES,
  type AIUsageAttempt,
  type AIUsageFeature,
  type AIUsageFeatureMonth,
  type AIUsageMonth,
  type AIUsageOutcome,
  type AIUsageSummary,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { aiUsageLedger, aiUsageReservations, venues } from "../db/schema.js";

// ---------------------------------------------------------------------------
// AI usage: metering, pricing and each venue's monthly allowance (T-656).
//
// Blake, 13 October 2026: "if this is going to actively bill us for claude
// then we need to work out a way for us to bill our clients on the features
// that need to use claude's abilities, or work out a way where we don't need
// to call the api, or something else." Whichever he chooses, every call is
// measured per venue and feature with its cost, and a venue's spend bounded.
//
// Before a call: its worst-case cost is reserved against the venue's
// allowance for the UTC month, under a per-venue advisory lock, or the call
// is refused (a `budget_blocked` row) and never made. After it: one
// append-only ledger row with the model that served it, its tokens and its
// cost, priced from the versioned table below, replaces the reservation. A
// provider that reports no usage (the bespoke HTTP gateway) is charged each
// call's whole reservation at the table's highest rates, its row marked as an
// estimate, so every provider is held to the same allowance.
//
// The bound: the lock makes the check-and-reserve atomic across processes,
// so concurrent calls cannot all pass a check that only one fits. A call's
// reservation is an upper bound on what it can cost (every attempt at its
// most expensive rates, the request's bytes as tokens, max_tokens of
// output), so recorded spend plus calls in flight never passes the
// allowance. What can still escape it is named in
// docs/engineering/ai-usage-and-billing.md: a call that fails in flight
// (timeout, cancel, lost connection) is recorded with no tokens, though the
// provider may bill some; a ledger write that fails after a call is logged
// with everything it would have held; a reservation lapses after ten minutes.
// ---------------------------------------------------------------------------

/** Rates in micro-US-dollars per million tokens: $4 per MTok is 4_000_000. */
export interface TokenRates {
  readonly input: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
  readonly output: number;
}

export interface ModelPrice extends TokenRates {
  /** Higher rates for a prompt (input, cache writes and cache reads together) longer than `overTokens`. */
  readonly longPrompt?: { readonly overTokens: number; readonly rates: TokenRates };
}

export interface PriceTable {
  /** Recorded on every ledger row priced with this table. Change it whenever a rate changes. */
  readonly version: string;
  readonly models: Readonly<Record<string, ModelPrice>>;
  /** Refusal categories charged even when the refusal came before any output. */
  readonly billedPreOutputRefusalCategories: readonly string[];
  /** The models the server-side "default" fallback may answer with, by requested model. */
  readonly fallbackModels: Readonly<Record<string, readonly string[]>>;
}

const OPUS_5_RATES: ModelPrice = { input: 5_000_000, cacheWrite5m: 6_250_000, cacheWrite1h: 10_000_000, cacheRead: 500_000, output: 25_000_000 };

/**
 * Anthropic's first-party prices, read on 13 October 2026 from
 * https://platform.claude.com/docs/en/about-claude/pricing (and the claude-api
 * skill's model table): base input, 5-minute cache writes (1.25x input),
 * 1-hour cache writes (2x), cache reads (0.05x on Opus 5.5 and Sonnet 5.5,
 * 0.025x on Fable 5.1, 0.1x elsewhere) and output. Global routing, standard
 * speed and the standard tier: the adapter sends no inference_geo, speed or
 * batch request, so none of their multipliers apply. Claude Haiku 5.5 prompts
 * over 100,000 tokens take its higher rate card. The listed models are the
 * ones the platform can be set to and the ones the server-side fallback
 * answers with; a model served that is not here is priced at the table's
 * highest rates and logged.
 */
export const ANTHROPIC_PRICE_TABLE: PriceTable = {
  version: "anthropic-2026-10-13",
  models: {
    "claude-fable-5-1": { input: 10_000_000, cacheWrite5m: 12_500_000, cacheWrite1h: 20_000_000, cacheRead: 250_000, output: 50_000_000 },
    "claude-opus-5-5": { input: 4_000_000, cacheWrite5m: 5_000_000, cacheWrite1h: 8_000_000, cacheRead: 200_000, output: 20_000_000 },
    "claude-opus-5": OPUS_5_RATES,
    "claude-opus-4-8": OPUS_5_RATES,
    "claude-sonnet-5-5": { input: 2_000_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000, cacheRead: 100_000, output: 10_000_000 },
    "claude-sonnet-5": { input: 2_000_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000, cacheRead: 200_000, output: 10_000_000 },
    "claude-haiku-5-5": {
      input: 100_000, cacheWrite5m: 125_000, cacheWrite1h: 200_000, cacheRead: 10_000, output: 500_000,
      longPrompt: {
        overTokens: 100_000,
        rates: { input: 500_000, cacheWrite5m: 625_000, cacheWrite1h: 1_000_000, cacheRead: 50_000, output: 2_500_000 },
      },
    },
  },
  // How refusals are billed (refusals-and-fallback docs, as of September 2026).
  billedPreOutputRefusalCategories: ["bio", "frontier_llm", "reasoning_extraction"],
  fallbackModels: {
    "claude-fable-5-1": ["claude-opus-5", "claude-opus-4-8"],
    "claude-opus-5-5": ["claude-opus-5", "claude-opus-4-8"],
    "claude-opus-5": ["claude-opus-4-8"],
    "claude-sonnet-5-5": ["claude-sonnet-5"],
  },
};

/** Whether the table can price a model the platform is set to call. */
export function hasPrice(prices: PriceTable, model: string): boolean {
  return Object.hasOwn(prices.models, model);
}

/** The highest rate of each kind anywhere in the table, long-prompt cards included. */
export function ceilingRates(prices: PriceTable): TokenRates {
  const cards = Object.values(prices.models).flatMap((price) => price.longPrompt === undefined ? [price] : [price, price.longPrompt.rates]);
  const highest = (pick: (rates: TokenRates) => number): number => Math.max(...cards.map(pick));
  return {
    input: highest((rates) => rates.input),
    cacheWrite5m: highest((rates) => rates.cacheWrite5m),
    cacheWrite1h: highest((rates) => rates.cacheWrite1h),
    cacheRead: highest((rates) => rates.cacheRead),
    output: highest((rates) => rates.output),
  };
}

// ---------------------------------------------------------------------------
// Pricing what a call used
// ---------------------------------------------------------------------------

interface AttemptTokens {
  readonly kind: AIUsageAttempt["kind"];
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheCreation1hInputTokens: number;
  readonly cacheReadInputTokens: number;
}

const MILLION = 1_000_000n;

function ratesFor(prices: PriceTable, attempt: AttemptTokens): { readonly rates: TokenRates; readonly priced: AIUsageAttempt["priced"] } {
  const price = prices.models[attempt.model];
  if (price === undefined) return { rates: ceilingRates(prices), priced: "ceiling" };
  const prompt = attempt.inputTokens + attempt.cacheCreationInputTokens + attempt.cacheReadInputTokens;
  if (price.longPrompt !== undefined && prompt > price.longPrompt.overTokens) return { rates: price.longPrompt.rates, priced: "table" };
  return { rates: price, priced: "table" };
}

/** Micro-dollars for the tokens at the rates, rounded up to the next whole micro-dollar. */
export function costMicroUsd(rates: TokenRates, tokens: Omit<AttemptTokens, "kind" | "model">): number {
  const oneHour = Math.min(tokens.cacheCreation1hInputTokens, tokens.cacheCreationInputTokens);
  const fiveMinute = tokens.cacheCreationInputTokens - oneHour;
  const numerator = BigInt(tokens.inputTokens) * BigInt(rates.input)
    + BigInt(fiveMinute) * BigInt(rates.cacheWrite5m)
    + BigInt(oneHour) * BigInt(rates.cacheWrite1h)
    + BigInt(tokens.cacheReadInputTokens) * BigInt(rates.cacheRead)
    + BigInt(tokens.outputTokens) * BigInt(rates.output);
  return Number((numerator + MILLION - 1n) / MILLION);
}

type Iteration = NonNullable<Anthropic.Beta.BetaUsage["iterations"]>[number];

function iterationModel(entry: Iteration, requestedModel: string): string {
  if (entry.type === "compaction") return requestedModel;
  return entry.model ?? requestedModel;
}

function tokensOf(
  kind: AIUsageAttempt["kind"],
  model: string,
  usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens: number | null;
    readonly cache_read_input_tokens: number | null;
    readonly cache_creation: Anthropic.Beta.BetaCacheCreation | null;
  },
): AttemptTokens {
  return {
    kind,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheCreation1hInputTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

/** What one answered call used and cost: summed over its attempts, each at its own model's rates. */
export interface MeteredCall {
  /** The model that produced the returned message (a fallback's after a refusal). */
  readonly model: string;
  readonly requestId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly costMicroUsd: number;
  readonly attempts: readonly AIUsageAttempt[];
}

/**
 * Prices a Messages API response. `usage.iterations`, when present, is the
 * per-attempt record of what is billed (a declined attempt as a `message`
 * entry, the fallback that served as `fallback_message`); top-level usage
 * covers only the attempt that produced the message, so it is used only when
 * there are no iterations. A refusal before any output (no output tokens) in
 * a category the provider does not bill costs nothing; a declined attempt
 * whose category the response does not name is charged, the safe side.
 */
export function meterAnthropicMessage(
  prices: PriceTable,
  requestedModel: string,
  message: Anthropic.Beta.BetaMessage & { readonly _request_id?: string | null },
): MeteredCall {
  const iterations = message.usage.iterations ?? [];
  const attempts: AttemptTokens[] = iterations.length > 0
    ? iterations.map((entry) => tokensOf(entry.type, iterationModel(entry, requestedModel), entry))
    : [tokensOf("message", message.model, message.usage)];
  let last = -1;
  attempts.forEach((attempt, index) => { if (attempt.kind === "message" || attempt.kind === "fallback_message") last = index; });
  const category = message.stop_reason === "refusal" ? message.stop_details?.category ?? null : null;
  const unbilledRefusal = message.stop_reason === "refusal"
    && (category === null || !prices.billedPreOutputRefusalCategories.includes(category));

  const priced = attempts.map((attempt, index): AIUsageAttempt => {
    const billed = !(index === last && unbilledRefusal && attempt.outputTokens === 0);
    const { rates, priced: how } = ratesFor(prices, attempt);
    return { ...attempt, billed, priced: how, costMicroUsd: billed ? costMicroUsd(rates, attempt) : 0 };
  });
  const sum = (pick: (attempt: AIUsageAttempt) => number): number => priced.reduce((total, attempt) => total + pick(attempt), 0);
  return {
    model: message.model,
    requestId: message._request_id ?? null,
    inputTokens: sum((attempt) => attempt.inputTokens),
    outputTokens: sum((attempt) => attempt.outputTokens),
    cacheCreationInputTokens: sum((attempt) => attempt.cacheCreationInputTokens),
    cacheReadInputTokens: sum((attempt) => attempt.cacheReadInputTokens),
    costMicroUsd: sum((attempt) => attempt.costMicroUsd),
    attempts: priced,
  };
}

/** How an answered call ended: declined, cut off, an answer, or nothing usable. */
export function anthropicOutcome(
  message: Pick<Anthropic.Beta.BetaMessage, "stop_reason">,
  usable: boolean,
): Exclude<AIUsageOutcome, "budget_blocked"> {
  if (message.stop_reason === "refusal") return "refusal";
  if (message.stop_reason === "max_tokens") return "max_tokens";
  return usable ? "ok" : "error";
}

// ---------------------------------------------------------------------------
// The most a call can cost, reserved before it is made
// ---------------------------------------------------------------------------

/**
 * Tokens the API may add to a request beyond its own bytes: turn markers, the
 * system preamble, and the instructions structured outputs compile from a
 * schema. Generous on purpose; the reservation is a ceiling, not an estimate.
 */
export const RESERVATION_FRAMING_TOKENS = 4_096;

type AnthropicRequest = Anthropic.Beta.MessageCreateParamsNonStreaming;

function worstAttempt(prices: PriceTable, models: readonly string[], inputTokens: number, outputTokens: number): number {
  const cards = models.flatMap((model): TokenRates[] => {
    const price = prices.models[model];
    if (price === undefined) return [ceilingRates(prices)];
    return price.longPrompt !== undefined && inputTokens > price.longPrompt.overTokens ? [price, price.longPrompt.rates] : [price];
  });
  const inputRate = Math.max(...cards.map((rates) => Math.max(rates.input, rates.cacheWrite5m, rates.cacheWrite1h)));
  const outputRate = Math.max(...cards.map((rates) => rates.output));
  const numerator = BigInt(inputTokens) * BigInt(inputRate) + BigInt(outputTokens) * BigInt(outputRate);
  return Number((numerator + MILLION - 1n) / MILLION);
}

/**
 * An upper bound on what a request can cost, in micro-dollars. No token is
 * shorter than a byte, so the request's own bytes (system, messages, output
 * format, tools) plus the framing allowance bound its input tokens, all priced
 * at the costliest input-side rate (fresh input or either cache write); output
 * is bounded by max_tokens at the output rate. A request that may fall back
 * after a refusal reserves a second attempt at the fallback models' rates.
 */
export function reserveForAnthropicRequest(prices: PriceTable, request: AnthropicRequest): number {
  const promptBytes = Buffer.byteLength(JSON.stringify({
    system: request.system ?? null,
    messages: request.messages,
    output_config: request.output_config ?? null,
    tools: request.tools ?? null,
  }), "utf8");
  const inputTokens = promptBytes + RESERVATION_FRAMING_TOKENS;
  const primary = worstAttempt(prices, [request.model], inputTokens, request.max_tokens);
  const fallbacks = request.fallbacks;
  if (fallbacks === undefined || fallbacks === null) return primary;
  const listed = Array.isArray(fallbacks) ? fallbacks.map((entry) => entry.model) : prices.fallbackModels[request.model];
  const models = listed === undefined || listed.length === 0 ? Object.keys(prices.models) : listed;
  const fallbackTokens = Array.isArray(fallbacks)
    ? Math.max(request.max_tokens, ...fallbacks.map((entry) => entry.max_tokens ?? request.max_tokens))
    : request.max_tokens;
  return primary + worstAttempt(prices, models, inputTokens, fallbackTokens);
}

/**
 * Output tokens a provider that reports no usage is taken to have produced:
 * the Anthropic adapter's own max_tokens.
 */
export const UNREPORTED_OUTPUT_TOKENS = 16_000;

/**
 * What a call to a provider that reports no usage (the bespoke HTTP gateway)
 * is charged, in micro-dollars: the request body's bytes plus the framing
 * allowance at the table's highest input-side rate, and
 * UNREPORTED_OUTPUT_TOKENS at its highest output rate. It is reserved before
 * the call and recorded as the call's cost after it, however the call ended,
 * so a provider that cannot say what it spent is held to the allowance on the
 * safe side. An estimate, never a measurement.
 */
export function reserveForUnreportedRequest(prices: PriceTable, requestBody: string): number {
  const rates = ceilingRates(prices);
  const inputTokens = Buffer.byteLength(requestBody, "utf8") + RESERVATION_FRAMING_TOKENS;
  const inputRate = Math.max(rates.input, rates.cacheWrite5m, rates.cacheWrite1h);
  const numerator = BigInt(inputTokens) * BigInt(inputRate) + BigInt(UNREPORTED_OUTPUT_TOKENS) * BigInt(rates.output);
  return Number((numerator + MILLION - 1n) / MILLION);
}

// ---------------------------------------------------------------------------
// The meter: reserve before, record after
// ---------------------------------------------------------------------------

/** Who a model call is for: the venue it is attributed to and the person who asked. */
export interface AICallAttribution {
  readonly venueId: string;
  readonly userId: string;
}

/** A call about to be made, with the most it can cost. */
export interface AIUsageCall extends AICallAttribution {
  readonly feature: AIUsageFeature;
  readonly provider: string;
  readonly requestedModel: string;
  readonly priceTableVersion: string;
  /** Held against the venue's allowance while the call runs. */
  readonly reserveMicroUsd: number;
}

/** How a call that was made ended, with what it used and cost. */
export interface AIUsageResult extends MeteredCall {
  readonly outcome: Exclude<AIUsageOutcome, "budget_blocked">;
}

export interface AIUsageHold {
  /**
   * Appends the call's ledger row and gives up its reservation. Never
   * throws: the answer the person asked for stands, and a failed write is
   * logged with everything the row would have held. A second call is ignored.
   */
  settle(result: AIUsageResult): Promise<void>;
}

export interface AIUsageMeter {
  /**
   * Reserves the call's worst case against the venue's allowance for the
   * month, or records the call refused and throws AIBudgetReachedError.
   */
  hold(call: AIUsageCall): Promise<AIUsageHold>;
}

/** The venue's allowance for the month is used: the call was not made. */
export class AIBudgetReachedError extends Error {
  readonly code = AI_BUDGET_REACHED;

  constructor() {
    super("This venue's AI allowance for the month is used");
    this.name = "AIBudgetReachedError";
  }
}

/** A failed provider call: nothing came back, so nothing is known to have been used. */
export function failedCall(requestedModel: string, error: unknown): AIUsageResult {
  const requestId = typeof error === "object" && error !== null && "requestID" in error && typeof error.requestID === "string"
    ? error.requestID
    : null;
  return {
    outcome: "error",
    model: requestedModel,
    requestId,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costMicroUsd: 0,
    attempts: [],
  };
}

/**
 * A call to a provider that reports no usage, as the ledger records it: its
 * whole reservation as its cost, its token counts unknown (zero), and its one
 * attempt marked `estimate` so the row reads as one.
 */
export function estimatedCall(
  model: string,
  reserveMicroUsd: number,
  outcome: Exclude<AIUsageOutcome, "budget_blocked">,
): AIUsageResult {
  return {
    outcome,
    model,
    requestId: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costMicroUsd: reserveMicroUsd,
    attempts: [{
      kind: "message",
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 0,
      billed: true,
      priced: "estimate",
      costMicroUsd: reserveMicroUsd,
    }],
  };
}

/** A row of the ledger as written. */
export type AIUsageEntry = Omit<typeof aiUsageLedger.$inferInsert, "id" | "createdAt"> & {
  readonly outcome: AIUsageOutcome;
  readonly attempts: readonly AIUsageAttempt[];
};

function entryFor(call: AIUsageCall, result: AIUsageResult | null): AIUsageEntry {
  if (result === null) {
    return {
      venueId: call.venueId,
      userId: call.userId,
      feature: call.feature,
      provider: call.provider,
      requestedModel: call.requestedModel,
      model: call.requestedModel,
      requestId: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outcome: "budget_blocked",
      costMicroUsd: 0,
      priceTableVersion: call.priceTableVersion,
      attempts: [],
    };
  }
  return {
    venueId: call.venueId,
    userId: call.userId,
    feature: call.feature,
    provider: call.provider,
    requestedModel: call.requestedModel,
    model: result.model,
    requestId: result.requestId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheCreationInputTokens: result.cacheCreationInputTokens,
    cacheReadInputTokens: result.cacheReadInputTokens,
    outcome: result.outcome,
    costMicroUsd: result.costMicroUsd,
    priceTableVersion: call.priceTableVersion,
    attempts: result.attempts,
  };
}

/** What a log line about a call may say: counts, models, ids and money. Never prompt text, names, the person or a key. */
function logFields(entry: AIUsageEntry): Record<string, unknown> {
  return {
    event: "ai_usage",
    feature: entry.feature,
    provider: entry.provider,
    model: entry.model,
    requestedModel: entry.requestedModel,
    outcome: entry.outcome,
    venueId: entry.venueId,
    requestId: entry.requestId,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheCreationInputTokens: entry.cacheCreationInputTokens,
    cacheReadInputTokens: entry.cacheReadInputTokens,
    costMicroUsd: entry.costMicroUsd,
    priceTableVersion: entry.priceTableVersion,
  };
}

export type AIUsageLog = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

/** A reservation left by a process that died lapses after this long. */
export const AI_USAGE_HOLD_SECONDS = 600;

/** The start of the current UTC calendar month, on the database's clock. */
const MONTH_START = sql`(date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

/**
 * Each venue's AI allowance for a UTC month when AI_VENUE_MONTHLY_BUDGET_USD
 * is unset: $50, over a thousand drafts or briefs at today's prices.
 */
export const DEFAULT_AI_VENUE_MONTHLY_BUDGET_USD = 50;

/** The venue allowance in micro-dollars: the environment's dollars, or the default. */
export function monthlyAllowanceMicroUsd(budgetUsd: number | undefined): number {
  const micro = Math.round((budgetUsd ?? DEFAULT_AI_VENUE_MONTHLY_BUDGET_USD) * 1_000_000);
  if (!Number.isSafeInteger(micro) || micro <= 0) {
    throw new Error("AI_VENUE_MONTHLY_BUDGET_USD must be a positive number of US dollars");
  }
  return micro;
}

/**
 * The ledger and the allowance in PostgreSQL. The check and the reservation
 * run in one transaction under a per-venue advisory lock, so two processes
 * serving the same venue take turns, and only calls that fit are made.
 */
export class PostgresAIUsageMeter implements AIUsageMeter {
  private readonly db: Database;
  private readonly limitMicroUsd: number;
  private readonly log: AIUsageLog;
  private readonly holdSeconds: number;

  constructor(db: Database, options: { readonly monthlyLimitMicroUsd: number; readonly log: AIUsageLog; readonly holdSeconds?: number }) {
    if (!Number.isSafeInteger(options.monthlyLimitMicroUsd) || options.monthlyLimitMicroUsd <= 0) {
      throw new Error("The AI allowance must be a positive whole number of micro-dollars");
    }
    this.db = db;
    this.limitMicroUsd = options.monthlyLimitMicroUsd;
    this.log = options.log;
    this.holdSeconds = options.holdSeconds ?? AI_USAGE_HOLD_SECONDS;
  }

  async hold(call: AIUsageCall): Promise<AIUsageHold> {
    if (!Number.isSafeInteger(call.reserveMicroUsd) || call.reserveMicroUsd <= 0) {
      throw new Error("An AI call must reserve a positive whole number of micro-dollars");
    }
    const decision = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-usage:${call.venueId}`}, 0))`);
      await tx.delete(aiUsageReservations).where(and(
        eq(aiUsageReservations.venueId, call.venueId),
        lte(aiUsageReservations.expiresAt, sql`now()`),
      ));
      const [spent] = await tx.select({ total: sql<number>`coalesce(sum(${aiUsageLedger.costMicroUsd}), 0)`.mapWith(Number) })
        .from(aiUsageLedger)
        .where(and(eq(aiUsageLedger.venueId, call.venueId), gte(aiUsageLedger.createdAt, MONTH_START)));
      const [held] = await tx.select({ total: sql<number>`coalesce(sum(${aiUsageReservations.reservedMicroUsd}), 0)`.mapWith(Number) })
        .from(aiUsageReservations)
        .where(and(eq(aiUsageReservations.venueId, call.venueId), gt(aiUsageReservations.expiresAt, sql`now()`)));
      const spentMicroUsd = spent?.total ?? 0;
      const heldMicroUsd = held?.total ?? 0;
      if (spentMicroUsd + heldMicroUsd + call.reserveMicroUsd > this.limitMicroUsd) {
        await tx.insert(aiUsageLedger).values(entryFor(call, null));
        return { kind: "blocked", spentMicroUsd, heldMicroUsd } as const;
      }
      const [reservation] = await tx.insert(aiUsageReservations).values({
        venueId: call.venueId,
        reservedMicroUsd: call.reserveMicroUsd,
        expiresAt: sql`now() + make_interval(secs => ${this.holdSeconds})`,
      }).returning({ id: aiUsageReservations.id });
      if (reservation === undefined) throw new Error("The AI usage reservation was not written");
      return { kind: "held", reservationId: reservation.id } as const;
    });

    if (decision.kind === "blocked") {
      this.log.warn({
        ...logFields(entryFor(call, null)),
        spentMicroUsd: decision.spentMicroUsd,
        heldMicroUsd: decision.heldMicroUsd,
        reserveMicroUsd: call.reserveMicroUsd,
        limitMicroUsd: this.limitMicroUsd,
      }, "AI call refused: the venue's allowance for the month is used");
      throw new AIBudgetReachedError();
    }

    let settled = false;
    return {
      settle: async (result) => {
        if (settled) return;
        settled = true;
        const entry = entryFor(call, result);
        try {
          await this.db.transaction(async (tx) => {
            await tx.insert(aiUsageLedger).values(entry);
            await tx.delete(aiUsageReservations).where(eq(aiUsageReservations.id, decision.reservationId));
          });
          this.log.info(logFields(entry), "AI usage recorded");
          if (entry.attempts.some((attempt) => attempt.priced === "ceiling")) {
            this.log.warn({ ...logFields(entry), event: "ai_usage_unpriced_model" },
              "An AI call was served by a model the price table does not list; it was priced at the table's highest rates");
          }
          if (entry.attempts.some((attempt) => attempt.priced === "estimate")) {
            this.log.warn({ ...logFields(entry), event: "ai_usage_estimated" },
              "An AI call went to a provider that reports no usage; it was charged its whole reservation at the table's highest rates");
          }
        } catch (error) {
          this.log.error({ ...logFields(entry), event: "ai_usage_record_failed", reason: failureReason(error) },
            "AI usage could not be recorded");
        }
      },
    };
  }
}

/**
 * The venue allowance meter a route uses when none is handed to it: the
 * PostgreSQL meter at AI_VENUE_MONTHLY_BUDGET_USD, built on its first call,
 * so a route with AI off never needs an allowance. A missing or invalid
 * allowance refuses the call (the route answers as for any failure) rather
 * than let it run unbounded.
 */
export function venueAllowanceMeter(
  db: Database,
  env: { readonly AI_VENUE_MONTHLY_BUDGET_USD?: number | undefined },
  log: AIUsageLog,
): AIUsageMeter {
  let meter: PostgresAIUsageMeter | undefined;
  return {
    hold: (call) => {
      meter ??= new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: monthlyAllowanceMicroUsd(env.AI_VENUE_MONTHLY_BUDGET_USD), log });
      return meter.hold(call);
    },
  };
}

/**
 * The same meter in memory, with no month: the calls of one process. For an
 * operator's evaluation run, which reports its own cost and belongs to no
 * venue, and for tests. An optional limit refuses calls as the venue
 * allowance does.
 */
export class TallyAIUsageMeter implements AIUsageMeter {
  readonly entries: AIUsageEntry[] = [];
  private heldMicroUsd = 0;
  private readonly limitMicroUsd: number | undefined;

  constructor(options: { readonly limitMicroUsd?: number } = {}) {
    this.limitMicroUsd = options.limitMicroUsd;
  }

  /** What the settled calls cost, in micro-dollars. */
  get costMicroUsd(): number {
    return this.entries.reduce((total, entry) => total + entry.costMicroUsd, 0);
  }

  hold(call: AIUsageCall): Promise<AIUsageHold> {
    if (this.limitMicroUsd !== undefined && this.costMicroUsd + this.heldMicroUsd + call.reserveMicroUsd > this.limitMicroUsd) {
      this.entries.push(entryFor(call, null));
      return Promise.reject(new AIBudgetReachedError());
    }
    this.heldMicroUsd += call.reserveMicroUsd;
    let settled = false;
    return Promise.resolve({
      settle: (result: AIUsageResult) => {
        if (!settled) {
          settled = true;
          this.heldMicroUsd -= call.reserveMicroUsd;
          this.entries.push(entryFor(call, result));
        }
        return Promise.resolve();
      },
    });
  }
}

// ---------------------------------------------------------------------------
// The usage summary a venue's managers read
// ---------------------------------------------------------------------------

function monthsBack(current: string, count: number): string[] {
  const [year, month] = current.split("-").map(Number);
  if (year === undefined || month === undefined || !Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Unexpected month ${current}`);
  }
  return Array.from({ length: count }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

/**
 * The venue's usage by UTC month and feature over the last `months` months,
 * newest first, with this month's allowance: spent, held by calls in flight,
 * and left. Null when the venue does not exist.
 */
export async function readAIUsageSummary(db: Database, input: {
  readonly venueId: string;
  readonly months: number;
  readonly limitMicroUsd: number;
  readonly priceTableVersion: string;
}): Promise<AIUsageSummary | null> {
  const [venue] = await db.select({ month: sql<string>`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')` })
    .from(venues)
    .where(eq(venues.id, input.venueId))
    .limit(1);
  if (venue === undefined) return null;

  const month = sql<string>`to_char(${aiUsageLedger.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`;
  const count = (outcome: AIUsageOutcome) => sql<number>`count(*) FILTER (WHERE ${aiUsageLedger.outcome} = ${outcome})`.mapWith(Number);
  const total = (column: AnyColumn) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
  const rows = await db.select({
    month,
    feature: aiUsageLedger.feature,
    ok: count("ok"),
    refusal: count("refusal"),
    maxTokens: count("max_tokens"),
    error: count("error"),
    budgetBlocked: count("budget_blocked"),
    inputTokens: total(aiUsageLedger.inputTokens),
    outputTokens: total(aiUsageLedger.outputTokens),
    cacheCreationInputTokens: total(aiUsageLedger.cacheCreationInputTokens),
    cacheReadInputTokens: total(aiUsageLedger.cacheReadInputTokens),
    costMicroUsd: total(aiUsageLedger.costMicroUsd),
  })
    .from(aiUsageLedger)
    .where(and(
      eq(aiUsageLedger.venueId, input.venueId),
      gte(aiUsageLedger.createdAt, sql`((date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => ${input.months - 1})) AT TIME ZONE 'UTC')`),
    ))
    .groupBy(month, aiUsageLedger.feature);
  const [held] = await db.select({ total: sql<number>`coalesce(sum(${aiUsageReservations.reservedMicroUsd}), 0)`.mapWith(Number) })
    .from(aiUsageReservations)
    .where(and(eq(aiUsageReservations.venueId, input.venueId), gt(aiUsageReservations.expiresAt, sql`now()`)));

  const months: AIUsageMonth[] = monthsBack(venue.month, input.months).map((name) => {
    const features = rows
      .filter((row) => row.month === name)
      .sort((a, b) => AI_USAGE_FEATURES.indexOf(a.feature) - AI_USAGE_FEATURES.indexOf(b.feature))
      .map((row): AIUsageFeatureMonth => ({
        feature: row.feature,
        calls: row.ok + row.refusal + row.maxTokens + row.error,
        outcomes: { ok: row.ok, refusal: row.refusal, max_tokens: row.maxTokens, error: row.error, budget_blocked: row.budgetBlocked },
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationInputTokens: row.cacheCreationInputTokens,
        cacheReadInputTokens: row.cacheReadInputTokens,
        costMicroUsd: row.costMicroUsd,
      }));
    return {
      month: name,
      calls: features.reduce((sum, feature) => sum + feature.calls, 0),
      costMicroUsd: features.reduce((sum, feature) => sum + feature.costMicroUsd, 0),
      features,
    };
  });
  const spentMicroUsd = months[0]?.costMicroUsd ?? 0;
  const heldMicroUsd = held?.total ?? 0;
  return {
    venueId: input.venueId,
    currency: "USD",
    priceTableVersion: input.priceTableVersion,
    allowance: {
      month: venue.month,
      limitMicroUsd: input.limitMicroUsd,
      spentMicroUsd,
      heldMicroUsd,
      remainingMicroUsd: Math.max(0, input.limitMicroUsd - spentMicroUsd - heldMicroUsd),
    },
    months,
  };
}

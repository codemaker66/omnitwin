import { z } from "zod";
import { AI_DRAFT_USE_CASES } from "./ai-assistant.js";

// ---------------------------------------------------------------------------
// AI usage (T-656)
//
// Every model call the platform makes is attributed to a venue, a person and
// a feature, priced, recorded in an append-only ledger and held to the
// venue's monthly allowance before it is made. These are the shared words for
// it: the features that call a model, how a call ended, the error code a
// request meets once the venue's allowance for the month is used, and the
// usage summary a venue's managers read.
// ---------------------------------------------------------------------------

/** The features that call a model: the AI draft use cases and typed event briefs. */
export const AI_USAGE_FEATURES = [...AI_DRAFT_USE_CASES, "event_brief"] as const;
export const AIUsageFeatureSchema = z.enum(AI_USAGE_FEATURES);
export type AIUsageFeature = z.infer<typeof AIUsageFeatureSchema>;

/**
 * How a call ended: an answer (`ok`), declined (`refusal`), cut off at the
 * token limit (`max_tokens`), failed or answered with nothing usable
 * (`error`), or never made because the venue's allowance for the month was
 * used (`budget_blocked`).
 */
export const AI_USAGE_OUTCOMES = ["ok", "refusal", "max_tokens", "error", "budget_blocked"] as const;
export const AIUsageOutcomeSchema = z.enum(AI_USAGE_OUTCOMES);
export type AIUsageOutcome = z.infer<typeof AIUsageOutcomeSchema>;

/** Who reads what the venue's AI use has cost (T-656): money, so its admins and
 *  managers, at their own venue. The API's canReadAIUsage and the settings
 *  screen read this one list. */
export const AI_USAGE_READ_ROLES = ["admin", "manager"] as const;

/** The code an AI request is answered with once the venue's allowance for the month is used. */
export const AI_BUDGET_REACHED = "AI_BUDGET_REACHED";

/**
 * One attempt within a call, as a ledger row keeps it: the requested model,
 * or the model a server-side fallback ran after a refusal. A row's token
 * columns are the sums of its attempts and its cost the sum of their costs,
 * each priced at the rates of the model that ran it.
 */
export interface AIUsageAttempt {
  /** The provider's name for the attempt (Anthropic's `usage.iterations` entry type). */
  readonly kind: "message" | "fallback_message" | "compaction" | "advisor_message";
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** All cache writes, the 1-hour ones among them counted again below. */
  readonly cacheCreationInputTokens: number;
  readonly cacheCreation1hInputTokens: number;
  readonly cacheReadInputTokens: number;
  /** False only where the provider does not charge the attempt: a refusal before any output in an unbilled category. */
  readonly billed: boolean;
  /**
   * `table` when the model has a price in the table; `ceiling` when it had
   * none and was priced at the table's highest rates; `estimate` when the
   * provider reported no usage (the bespoke HTTP gateway), so the attempt was
   * charged its call's whole reservation at the table's highest rates and its
   * token counts are unknown, not zero.
   */
  readonly priced: "table" | "ceiling" | "estimate";
  readonly costMicroUsd: number;
}

/** The most months one usage summary covers. */
export const AI_USAGE_SUMMARY_MAX_MONTHS = 24;

export const AIUsageSummaryQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(AI_USAGE_SUMMARY_MAX_MONTHS).default(3),
}).strict();
export type AIUsageSummaryQuery = z.infer<typeof AIUsageSummaryQuerySchema>;

const Count = z.number().int().nonnegative();
/** An amount in millionths of a US dollar. */
const MicroUsd = z.number().int().nonnegative();
/** A calendar month in UTC, written YYYY-MM. */
const UtcMonth = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

export const AIUsageOutcomeCountsSchema = z.object({
  ok: Count,
  refusal: Count,
  max_tokens: Count,
  error: Count,
  budget_blocked: Count,
}).strict();

export const AIUsageFeatureMonthSchema = z.object({
  feature: AIUsageFeatureSchema,
  /** Model calls made: every outcome but `budget_blocked`. */
  calls: Count,
  outcomes: AIUsageOutcomeCountsSchema,
  inputTokens: Count,
  outputTokens: Count,
  cacheCreationInputTokens: Count,
  cacheReadInputTokens: Count,
  costMicroUsd: MicroUsd,
}).strict();
export type AIUsageFeatureMonth = z.infer<typeof AIUsageFeatureMonthSchema>;

export const AIUsageMonthSchema = z.object({
  month: UtcMonth,
  calls: Count,
  costMicroUsd: MicroUsd,
  features: z.array(AIUsageFeatureMonthSchema),
}).strict();
export type AIUsageMonth = z.infer<typeof AIUsageMonthSchema>;

export const AIUsageSummarySchema = z.object({
  venueId: z.uuid(),
  currency: z.literal("USD"),
  /** The price table the platform prices calls with now; each ledger row keeps its own. */
  priceTableVersion: z.string().trim().min(1).max(40),
  /** This UTC month's allowance: what is spent, what calls still in flight hold, and what is left. */
  allowance: z.object({
    month: UtcMonth,
    limitMicroUsd: MicroUsd,
    spentMicroUsd: MicroUsd,
    heldMicroUsd: MicroUsd,
    remainingMicroUsd: MicroUsd,
  }).strict(),
  /** Newest month first; every month in the range is present, an unused one with zeros. */
  months: z.array(AIUsageMonthSchema),
}).strict();
export type AIUsageSummary = z.infer<typeof AIUsageSummarySchema>;

import Anthropic from "@anthropic-ai/sdk";
import { AIAssistantStatusSchema, type AIAssistantStatus, type AIUsageFeature } from "@omnitwin/types";
import type { Env } from "../env.js";

// ---------------------------------------------------------------------------
// Which venues may use which AI drafts, and what a person is told when the
// provider cannot take a call (C1, the Trades Hall pilot, 5 Nov 2026).
//
// AI_ASSISTANT_ENABLED is one switch for the whole platform. Switched on by
// itself it would give drafts to every venue's staff and send every venue's
// guests' words to the provider, though only one venue's controller has
// agreed to that. So AI is on only for the venues (AI_ASSISTANT_VENUE_IDS)
// and drafts (AI_ASSISTANT_FEATURES) the environment names, and every
// provider call is checked against both before anything is reserved or sent.
// With AI on and either list unset, it fails closed: on for no venue, said
// at boot (missingAccessLists) and in every status. It does not stop the
// boot, so a forgotten variable never blocks a deploy. The check sits in the
// providers themselves, so no route can reach a model around it; the routes
// ask the same policy first only so a refused venue is told so before any of
// its records are read.
//
// With AI off, the policy restricts nothing: the environment's provider is
// the disabled one, which sends nothing, and the only other providers are
// the ones tests construct themselves.
//
// The order to set the variables in, so the API boots at every step, is in
// docs/operations/ai-pilot-switch-on.md.
// ---------------------------------------------------------------------------

/** AI is off, or off for this venue or this draft. Routes answer 503 AI_ASSISTANT_DISABLED. */
export class AIAssistantDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIAssistantDisabledError";
  }
}

export const AI_DRAFTS_UNAVAILABLE_MESSAGE =
  "AI drafts are unavailable just now. Write this one by hand; drafts return on their own when the provider is back.";

/**
 * The provider refused the call for want of credit or because a spending
 * limit was reached: the month's included credit is used, or it is the gap
 * between one grant ending and the next arriving. Nothing is wrong with the
 * draft asked for, and asking again will not help until the credit returns.
 * Routes answer 503 AI_DRAFTS_UNAVAILABLE, and staff write by hand meanwhile.
 */
export class AIDraftsUnavailableError extends Error {
  constructor() {
    super(AI_DRAFTS_UNAVAILABLE_MESSAGE);
    this.name = "AIDraftsUnavailableError";
  }
}

// The words Anthropic's API uses when an organisation's credit is used up
// ("Your credit balance is too low to access the Anthropic API") or a
// Console spend limit is reached ("You have reached your specified API usage
// limits", or "workspace API usage limits"). A 402 billing_error says so by
// its type alone.
const OUT_OF_CREDIT = /credit balance is too low|reached your specified (?:workspace )?API usage limit/iu;

/** Whether `error` is the provider saying it will take no call until credit returns. */
export function isOutOfCredit(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  if (error.status === 402 || error.type === "billing_error") return true;
  return error.status === 400 && OUT_OF_CREDIT.test(error.message);
}

/** The gateway's word for the same: payment required. */
export function isGatewayOutOfCredit(status: number): boolean {
  return status === 402;
}

const VENUE_OFF = "AI drafts are not switched on for this venue.";
const FEATURE_OFF = "This AI draft is not switched on.";
const NO_LISTS = "AI drafts are on, but no venue or draft has been switched on yet.";

type AccessEnv = Pick<Env, "AI_ASSISTANT_ENABLED" | "AI_ASSISTANT_VENUE_IDS" | "AI_ASSISTANT_FEATURES">;

/** The allow lists AI needs and does not have: with AI on, the names of the
 *  unset ones, for the boot warning; empty when AI is off or both are set. */
export function missingAccessLists(env: AccessEnv): string[] {
  if (env.AI_ASSISTANT_ENABLED !== "true") return [];
  return [
    ...(env.AI_ASSISTANT_VENUE_IDS === undefined ? ["AI_ASSISTANT_VENUE_IDS"] : []),
    ...(env.AI_ASSISTANT_FEATURES === undefined ? ["AI_ASSISTANT_FEATURES"] : []),
  ];
}

export class AIAccessPolicy {
  private constructor(
    /** Null: every venue (AI is off, so nothing reaches a provider anyway). */
    private readonly venues: ReadonlySet<string> | null,
    private readonly features: ReadonlySet<AIUsageFeature> | null,
    /** Set when the policy refuses everything, and why. */
    private readonly closed: string | null = null,
  ) {}

  /** The environment's policy: the allow lists when AI is on (none at all,
   *  failing closed, when either is unset), no restriction when it is off. */
  static fromEnv(env: AccessEnv): AIAccessPolicy {
    if (env.AI_ASSISTANT_ENABLED !== "true") return AIAccessPolicy.unrestricted();
    if (missingAccessLists(env).length > 0) return new AIAccessPolicy(new Set(), new Set(), NO_LISTS);
    return new AIAccessPolicy(
      new Set((env.AI_ASSISTANT_VENUE_IDS ?? []).map((id) => id.toLowerCase())),
      new Set(env.AI_ASSISTANT_FEATURES ?? []),
    );
  }

  /** Only these venues, and only these drafts. */
  static only(venueIds: readonly string[], features: readonly AIUsageFeature[]): AIAccessPolicy {
    return new AIAccessPolicy(new Set(venueIds.map((id) => id.toLowerCase())), new Set(features));
  }

  /** Every venue and every draft. */
  static unrestricted(): AIAccessPolicy {
    return new AIAccessPolicy(null, null);
  }

  /** Why `venueId` may not have `feature`, or null when it may. With no
   *  feature named, whether the venue has any AI draft at all. */
  refusal(venueId: string | null, feature?: AIUsageFeature): string | null {
    if (this.closed !== null) return this.closed;
    if (this.venues !== null && (venueId === null || !this.venues.has(venueId.toLowerCase()))) return VENUE_OFF;
    if (this.features === null) return null;
    if (feature === undefined) return this.features.size > 0 ? null : FEATURE_OFF;
    return this.features.has(feature) ? null : FEATURE_OFF;
  }

  /** Throws AIAssistantDisabledError when `venueId` may not have `feature`. */
  assertAllowed(venueId: string, feature: AIUsageFeature): void {
    const refused = this.refusal(venueId, feature);
    if (refused !== null) throw new AIAssistantDisabledError(refused);
  }

  /** The provider's status as this venue sees it for this draft: off, with why, where it is not switched on. */
  statusFor(status: AIAssistantStatus, venueId: string | null, feature?: AIUsageFeature): AIAssistantStatus {
    if (!status.configured) return status;
    const refused = this.refusal(venueId, feature);
    if (refused === null) return status;
    return AIAssistantStatusSchema.parse({ configured: false, provider: null, model: null, disabledReason: refused });
  }
}

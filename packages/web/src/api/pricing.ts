import { z } from "zod";
import { PricingTypeSchema, LineItemSchema, ModifierSchema, type LineItem } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Response schemas — Zod validation at the API boundary.
//
// PricingType, LineItem, and Modifier schemas are reused from @omnitwin/types
// (single source of truth). PricingRule is kept local because the API returns
// `amount` as a string (DB numeric column) while the shared schema uses a
// number. Request types (CreatePricingRuleInput, PriceEstimateInput) stay as
// plain interfaces — they are outbound payloads, not parsed from untrusted
// JSON.
// ---------------------------------------------------------------------------

export type { LineItem };

// A price by guest count, and a day's or month's adjustment (a multiplier),
// as the rule was written. One the API holds in another shape reads as
// undefined, never as none, so nothing is priced without it.
const PricingTiersSchema = z.array(z.object({ upTo: z.number().positive(), amount: z.number().nonnegative() }))
  .nullable().optional().catch(undefined);
const PricingModifiersSchema = z.record(z.number().positive()).nullable().optional().catch(undefined);

export const PricingRuleResponseSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  spaceId: z.string().nullable(),
  name: z.string(),
  type: PricingTypeSchema,
  amount: z.string(),
  currency: z.string(),
  minHours: z.number().nullable(),
  minGuests: z.number().nullable(),
  tiers: PricingTiersSchema,
  dayOfWeekModifiers: PricingModifiersSchema,
  seasonalModifiers: PricingModifiersSchema,
  // The time of day the rule is for (0089), "HH:MM:SS" from Postgres or
  // "HH:MM" as sent; both or neither. Older servers send neither.
  appliesFrom: z.string().nullable().optional().catch(undefined),
  appliesUntil: z.string().nullable().optional().catch(undefined),
  isActive: z.boolean(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
});

export type PricingRule = z.infer<typeof PricingRuleResponseSchema>;

const PriceEstimateResponseSchema = z.object({
  lineItems: z.array(LineItemSchema),
  subtotal: z.number(),
  modifiers: z.array(ModifierSchema),
  total: z.number(),
  currency: z.string(),
});

export type PriceEstimate = z.infer<typeof PriceEstimateResponseSchema>;

export interface CreatePricingRuleInput {
  readonly name: string;
  readonly type: z.infer<typeof PricingTypeSchema>;
  readonly amount: number;
  readonly currency?: string;
  readonly spaceId?: string | null;
  readonly isActive?: boolean;
  /** The time of day the rule is for, "HH:MM" each, both or neither; both
   *  null (or absent) applies at any time. The API refuses one side alone. */
  readonly appliesFrom?: string | null;
  readonly appliesUntil?: string | null;
  /** The dates the rate is for, "YYYY-MM-DD" each; null is open on that side.
   *  A rate for particular dates takes the place of the everyday rate for the
   *  same room, time and way of charging on those dates. */
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly minHours?: number | null;
  readonly minGuests?: number | null;
  /** The Pricing desk suggestion this rate follows, kept in the change's record. */
  readonly adviceKey?: string | null;
}

/** A change to a rule. Fields left out stay as they are. */
export interface UpdatePricingRuleInput {
  readonly name?: string;
  readonly type?: z.infer<typeof PricingTypeSchema>;
  readonly amount?: number;
  readonly spaceId?: string | null;
  readonly isActive?: boolean;
  readonly appliesFrom?: string | null;
  readonly appliesUntil?: string | null;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly minHours?: number | null;
  readonly minGuests?: number | null;
  readonly adviceKey?: string | null;
}

export interface PriceEstimateInput {
  readonly spaceId: string;
  readonly eventDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly guestCount: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listPricingRules(venueId: string): Promise<PricingRule[]> {
  return api.get(`/venues/${venueId}/pricing`, z.array(PricingRuleResponseSchema));
}

export async function createPricingRule(venueId: string, data: CreatePricingRuleInput): Promise<PricingRule> {
  return api.post(`/venues/${venueId}/pricing`, data, undefined, PricingRuleResponseSchema);
}

export async function updatePricingRule(venueId: string, ruleId: string, data: UpdatePricingRuleInput): Promise<PricingRule> {
  return api.patch(`/venues/${venueId}/pricing/${ruleId}`, data, PricingRuleResponseSchema);
}

export async function deletePricingRule(venueId: string, ruleId: string): Promise<void> {
  await api.delete(`/venues/${venueId}/pricing/${ruleId}`);
}

/** Undo a delete. A delete only marks the rule, so it comes back as it was,
 *  on or off as `isActive` says. */
export async function restorePricingRule(venueId: string, ruleId: string, isActive: boolean): Promise<PricingRule> {
  return api.post(`/venues/${venueId}/pricing/${ruleId}/restore`, { isActive }, undefined, PricingRuleResponseSchema);
}

export async function estimatePrice(venueId: string, data: PriceEstimateInput): Promise<PriceEstimate> {
  return api.post(`/venues/${venueId}/pricing/estimate`, data, undefined, PriceEstimateResponseSchema);
}

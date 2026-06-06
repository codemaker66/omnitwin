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

const PricingRuleResponseSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  spaceId: z.string().nullable(),
  name: z.string(),
  type: PricingTypeSchema,
  amount: z.string(),
  currency: z.string(),
  minHours: z.number().nullable(),
  minGuests: z.number().nullable(),
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

export async function deletePricingRule(venueId: string, ruleId: string): Promise<void> {
  await api.delete(`/venues/${venueId}/pricing/${ruleId}`);
}

export async function estimatePrice(venueId: string, data: PriceEstimateInput): Promise<PriceEstimate> {
  return api.post(`/venues/${venueId}/pricing/estimate`, data, undefined, PriceEstimateResponseSchema);
}

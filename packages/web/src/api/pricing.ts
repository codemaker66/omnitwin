import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingRule {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string | null;
  readonly name: string;
  readonly type: "flat_rate" | "per_hour" | "per_head" | "tiered";
  readonly amount: string;
  readonly currency: string;
  readonly minHours: number | null;
  readonly minGuests: number | null;
  readonly isActive: boolean;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

export interface CreatePricingRuleInput {
  readonly name: string;
  readonly type: "flat_rate" | "per_hour" | "per_head" | "tiered";
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

export interface LineItem {
  readonly ruleName: string;
  readonly description: string;
  readonly amount: number;
}

export interface PriceEstimate {
  readonly lineItems: readonly LineItem[];
  readonly subtotal: number;
  readonly modifiers: readonly { readonly name: string; readonly multiplier: number }[];
  readonly total: number;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listPricingRules(venueId: string): Promise<PricingRule[]> {
  return api.get<PricingRule[]>(`/venues/${venueId}/pricing`);
}

export async function createPricingRule(venueId: string, data: CreatePricingRuleInput): Promise<PricingRule> {
  return api.post<PricingRule>(`/venues/${venueId}/pricing`, data);
}

export async function deletePricingRule(venueId: string, ruleId: string): Promise<void> {
  await api.delete(`/venues/${venueId}/pricing/${ruleId}`);
}

export async function estimatePrice(venueId: string, data: PriceEstimateInput): Promise<PriceEstimate> {
  return api.post<PriceEstimate>(`/venues/${venueId}/pricing/estimate`, data);
}

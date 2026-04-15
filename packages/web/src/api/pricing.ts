import type { PricingType, LineItem, Modifier } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types — PricingType, LineItem, Modifier imported from @omnitwin/types.
// PricingRule and CreatePricingRuleInput are kept local because the API
// returns amount as string (DB numeric column) while the shared schema uses
// number. PriceEstimateInput matches PriceEstimateRequest in @omnitwin/types.
// ---------------------------------------------------------------------------

export type { LineItem };

export interface PricingRule {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string | null;
  readonly name: string;
  readonly type: PricingType;
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
  readonly type: PricingType;
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

export interface PriceEstimate {
  readonly lineItems: readonly LineItem[];
  readonly subtotal: number;
  readonly modifiers: readonly Modifier[];
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

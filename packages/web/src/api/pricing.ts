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

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function listPricingRules(venueId: string): Promise<PricingRule[]> {
  return api.get<PricingRule[]>(`/venues/${venueId}/pricing`);
}

export async function createPricingRule(venueId: string, data: CreatePricingRuleInput): Promise<PricingRule> {
  return api.post<PricingRule>(`/venues/${venueId}/pricing`, data);
}

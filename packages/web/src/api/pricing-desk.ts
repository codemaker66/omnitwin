import { z } from "zod";
import { PricingAdviceSchema, type PricingAdvice } from "@omnitwin/types";
import { api } from "./client.js";
import { PricingRuleResponseSchema } from "./pricing.js";

// ---------------------------------------------------------------------------
// The Pricing desk's reads (routes/pricing-desk.ts). Rates themselves are
// written through api/pricing.js, as everywhere else.
// ---------------------------------------------------------------------------

const HistoryEntrySchema = z.object({
  action: z.enum(["created", "updated", "deleted", "restored"]),
  at: z.string(),
  by: z.string().nullable(),
  summary: z.string(),
});
export type PriceHistoryEntry = z.infer<typeof HistoryEntrySchema>;

const DeskRuleSchema = PricingRuleResponseSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  history: z.array(HistoryEntrySchema),
});
export type DeskRule = z.infer<typeof DeskRuleSchema>;

const PricingDeskSchema = z.object({
  venue: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
  rooms: z.array(z.object({ id: z.string(), name: z.string() })),
  rules: z.array(DeskRuleSchema),
  retired: z.array(DeskRuleSchema),
  /** The venue's own people who set prices, by name. */
  setters: z.array(z.string()),
  canSetPrices: z.boolean(),
});
export type PricingDesk = z.infer<typeof PricingDeskSchema>;

export type { PricingAdvice };
export type { PricingAdviceItem, PricingAdviceReason } from "@omnitwin/types";

export async function getPricingDesk(venueId: string, signal?: AbortSignal): Promise<PricingDesk> {
  return api.get(`/venues/${venueId}/pricing-desk`, PricingDeskSchema, signal);
}

export async function getPricingAdvice(venueId: string, signal?: AbortSignal): Promise<PricingAdvice> {
  return api.get(`/venues/${venueId}/pricing-desk/advice`, PricingAdviceSchema, signal);
}

const DecisionSchema = z.object({ key: z.string(), dismissed: z.boolean() });

export async function dismissPricingAdvice(venueId: string, key: string): Promise<void> {
  await api.post(`/venues/${venueId}/pricing-desk/advice/dismissals`, { key }, undefined, DecisionSchema);
}

export async function restorePricingAdvice(venueId: string, key: string): Promise<void> {
  await api.delete(`/venues/${venueId}/pricing-desk/advice/dismissals/${encodeURIComponent(key)}`, DecisionSchema);
}

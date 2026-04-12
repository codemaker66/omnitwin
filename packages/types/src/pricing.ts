import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";

// ---------------------------------------------------------------------------
// Pricing Rule ID — UUID v4
// ---------------------------------------------------------------------------

export const PricingRuleIdSchema = z.string().uuid();

export type PricingRuleId = z.infer<typeof PricingRuleIdSchema>;

// ---------------------------------------------------------------------------
// Currency — ISO 4217 currency code (GBP for V1, extensible)
// ---------------------------------------------------------------------------

export const SUPPORTED_CURRENCIES = ["GBP"] as const;

export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);

export type Currency = z.infer<typeof CurrencySchema>;

// ---------------------------------------------------------------------------
// Pricing Type — how the amount is interpreted
// ---------------------------------------------------------------------------

export const PRICING_TYPES = ["flat_rate", "per_hour", "per_head", "tiered"] as const;

export const PricingTypeSchema = z.enum(PRICING_TYPES);

export type PricingType = z.infer<typeof PricingTypeSchema>;

// ---------------------------------------------------------------------------
// Tier — for tiered pricing (up to N guests = X amount)
// ---------------------------------------------------------------------------

export const TierSchema = z.object({
  upTo: z.number().positive("Tier threshold must be positive"),
  amount: z.number().nonnegative("Tier amount must not be negative"),
});

export type Tier = z.infer<typeof TierSchema>;

// ---------------------------------------------------------------------------
// Pricing Rule — venue-specific pricing configuration
//
// Each rule defines a single charge type. Multiple rules per space/venue are
// stacked as line items during price calculation. Rules can be scoped to a
// specific space (spaceId) or apply venue-wide (spaceId: null).
// ---------------------------------------------------------------------------

const MAX_PRICE = 1_000_000;
const MAX_HOURS = 168; // one week
const MAX_GUESTS = 10_000;

/** Date string in YYYY-MM-DD format. */
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const PricingRuleSchema = z.object({
  id: PricingRuleIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema.nullable(),
  name: z.string().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  type: PricingTypeSchema,
  amount: z.number().nonnegative("Amount must not be negative").max(MAX_PRICE, `Amount must be at most ${String(MAX_PRICE)}`),
  currency: CurrencySchema,
  minHours: z.number().int().positive().max(MAX_HOURS).nullable(),
  minGuests: z.number().int().positive().max(MAX_GUESTS).nullable(),
  tiers: z.array(TierSchema).nullable(),
  dayOfWeekModifiers: z.record(z.number().positive()).nullable(),
  seasonalModifiers: z.record(z.number().positive()).nullable(),
  validFrom: DateStringSchema.nullable(),
  validTo: DateStringSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type PricingRule = z.infer<typeof PricingRuleSchema>;

// ---------------------------------------------------------------------------
// Create Pricing Rule — input for POST /venues/:venueId/pricing
// ---------------------------------------------------------------------------

export const CreatePricingRuleSchema = z.object({
  spaceId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  type: PricingTypeSchema,
  amount: z.number().nonnegative(),
  currency: CurrencySchema.default("GBP"),
  minHours: z.number().int().positive().nullable().optional(),
  minGuests: z.number().int().positive().nullable().optional(),
  tiers: z.array(TierSchema).nullable().optional(),
  dayOfWeekModifiers: z.record(z.number().positive()).nullable().optional(),
  seasonalModifiers: z.record(z.number().positive()).nullable().optional(),
  validFrom: DateStringSchema.nullable().optional(),
  validTo: DateStringSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});

export type CreatePricingRule = z.infer<typeof CreatePricingRuleSchema>;

// ---------------------------------------------------------------------------
// Price Estimate Request — input for POST /venues/:venueId/pricing/estimate
// ---------------------------------------------------------------------------

/** Time string in HH:MM format. */
const TimeStringSchema = z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM");

export const PriceEstimateRequestSchema = z.object({
  spaceId: SpaceIdSchema,
  eventDate: DateStringSchema,
  startTime: TimeStringSchema,
  endTime: TimeStringSchema,
  guestCount: z.number().int("Guest count must be an integer").min(1, "Guest count must be at least 1").max(MAX_GUESTS, `Guest count must be at most ${String(MAX_GUESTS)}`),
});

export type PriceEstimateRequest = z.infer<typeof PriceEstimateRequestSchema>;

// ---------------------------------------------------------------------------
// Price Estimate Response — breakdown returned by the calculator
// ---------------------------------------------------------------------------

export const LineItemSchema = z.object({
  ruleName: z.string().min(1),
  description: z.string(),
  amount: z.number().nonnegative(),
});

export type LineItem = z.infer<typeof LineItemSchema>;

export const ModifierSchema = z.object({
  name: z.string().min(1),
  multiplier: z.number().positive(),
});

export type Modifier = z.infer<typeof ModifierSchema>;

export const PriceEstimateResponseSchema = z.object({
  lineItems: z.array(LineItemSchema),
  subtotal: z.number().nonnegative(),
  modifiers: z.array(ModifierSchema),
  total: z.number().nonnegative(),
  currency: CurrencySchema,
});

export type PriceEstimateResponse = z.infer<typeof PriceEstimateResponseSchema>;

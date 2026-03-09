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
// Pricing Rule — venue-specific pricing configuration per space
// ---------------------------------------------------------------------------

const MAX_PRICE = 1_000_000;
const MAX_HOURS = 168; // one week
const MAX_GUESTS = 10_000;

export const PricingRuleSchema = z.object({
  id: PricingRuleIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  currency: CurrencySchema,
  basePrice: z.number().nonnegative("Base price must not be negative").max(MAX_PRICE, `Base price must be at most ${String(MAX_PRICE)}`),
  pricePerHour: z.number().nonnegative("Price per hour must not be negative").max(MAX_PRICE, `Price per hour must be at most ${String(MAX_PRICE)}`),
  pricePerGuest: z.number().nonnegative("Price per guest must not be negative").max(MAX_PRICE, `Price per guest must be at most ${String(MAX_PRICE)}`),
  minimumHours: z.number().int("Minimum hours must be an integer").min(1, "Minimum hours must be at least 1").max(MAX_HOURS, `Minimum hours must be at most ${String(MAX_HOURS)}`),
  minimumGuests: z.number().int("Minimum guests must be an integer").min(1, "Minimum guests must be at least 1").max(MAX_GUESTS, `Minimum guests must be at most ${String(MAX_GUESTS)}`),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type PricingRule = z.infer<typeof PricingRuleSchema>;

// ---------------------------------------------------------------------------
// Price Estimate Request — input from the price estimator widget
// ---------------------------------------------------------------------------

export const PriceEstimateRequestSchema = z.object({
  spaceId: SpaceIdSchema,
  hours: z.number().int("Hours must be an integer").min(1, "Hours must be at least 1").max(MAX_HOURS, `Hours must be at most ${String(MAX_HOURS)}`),
  guestCount: z.number().int("Guest count must be an integer").min(1, "Guest count must be at least 1").max(MAX_GUESTS, `Guest count must be at most ${String(MAX_GUESTS)}`),
  eventDate: z.string().datetime({ message: "eventDate must be an ISO 8601 datetime string" }),
});

export type PriceEstimateRequest = z.infer<typeof PriceEstimateRequestSchema>;

// ---------------------------------------------------------------------------
// Price Estimate Response — breakdown returned by the API
// ---------------------------------------------------------------------------

export const PriceEstimateResponseSchema = z.object({
  spaceId: SpaceIdSchema,
  currency: CurrencySchema,
  roomCost: z.number().nonnegative("Room cost must not be negative"),
  hoursCost: z.number().nonnegative("Hours cost must not be negative"),
  guestsCost: z.number().nonnegative("Guests cost must not be negative"),
  totalEstimate: z.number().nonnegative("Total estimate must not be negative"),
  disclaimer: z.string().min(1, "Disclaimer must not be empty"),
});

export type PriceEstimateResponse = z.infer<typeof PriceEstimateResponseSchema>;

// ---------------------------------------------------------------------------
// Price calculator — pure functions, no DB access
// ---------------------------------------------------------------------------

import type { PricingType, LineItem, Modifier } from "@omnitwin/types";
export type { PricingType, LineItem, Modifier };

/** A pricing rule as received from DB (parsed). */
export interface PricingRuleInput {
  readonly name: string;
  readonly type: PricingType;
  /** Base amount in currency units (e.g. 500.00 = £500). */
  readonly amount: number;
  readonly currency: string;
  readonly minHours: number | null;
  readonly minGuests: number | null;
  readonly tiers: readonly { readonly upTo: number; readonly amount: number }[] | null;
  readonly dayOfWeekModifiers: Record<string, number> | null;
  readonly seasonalModifiers: Record<string, number> | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly isActive: boolean;
  readonly spaceId: string | null;
}

/** Input for price calculation. */
export interface PriceCalculationInput {
  readonly rules: readonly PricingRuleInput[];
  readonly spaceId: string;
  readonly eventDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly guestCount: number;
}

/** Full price calculation result. */
export interface PriceResult {
  readonly lineItems: readonly LineItem[];
  readonly subtotal: number;
  readonly modifiers: readonly Modifier[];
  readonly total: number;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

/** Compute hours between two HH:MM time strings. */
export function computeHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number) as [number, number];
  const [eh, em] = endTime.split(":").map(Number) as [number, number];
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  const diff = endMinutes - startMinutes;
  return diff > 0 ? diff / 60 : 0;
}

/** Get the lowercase day name for a YYYY-MM-DD date string. */
export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z");
  return DAY_NAMES[date.getUTCDay()] ?? "";
}

/** Get the lowercase month name for a YYYY-MM-DD date string. */
export function getMonth(dateStr: string): string {
  const parts = dateStr.split("-");
  const monthIdx = parseInt(parts[1] ?? "0", 10) - 1;
  return MONTH_NAMES[monthIdx] ?? "";
}

/** Check if a rule is valid for a given date. */
function isRuleValidForDate(rule: PricingRuleInput, dateStr: string): boolean {
  if (!rule.isActive) return false;
  if (rule.validFrom !== null && dateStr < rule.validFrom) return false;
  if (rule.validTo !== null && dateStr > rule.validTo) return false;
  return true;
}

/** Check if a rule applies to a given space. */
function isRuleForSpace(rule: PricingRuleInput, spaceId: string): boolean {
  return rule.spaceId === null || rule.spaceId === spaceId;
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

/**
 * Calculate the price for an event based on pricing rules.
 * Pure function — receives all data as arguments.
 */
export function calculatePrice(input: PriceCalculationInput): PriceResult {
  const { rules, spaceId, eventDate, startTime, endTime, guestCount } = input;
  const hours = computeHours(startTime, endTime);
  const dayOfWeek = getDayOfWeek(eventDate);
  const month = getMonth(eventDate);

  const lineItems: LineItem[] = [];
  const modifierMap = new Map<string, number>();
  const currency = rules[0]?.currency ?? "GBP";

  for (const rule of rules) {
    if (!isRuleValidForDate(rule, eventDate)) continue;
    if (!isRuleForSpace(rule, spaceId)) continue;

    let amount = 0;
    let description = "";

    switch (rule.type) {
      case "flat_rate":
        amount = rule.amount;
        description = "Flat rate";
        break;

      case "per_hour": {
        const billableHours = Math.max(hours, rule.minHours ?? 0);
        amount = rule.amount * billableHours;
        description = `${String(billableHours)}h × £${String(rule.amount)}/h`;
        break;
      }

      case "per_head": {
        const billableGuests = Math.max(guestCount, rule.minGuests ?? 0);
        amount = rule.amount * billableGuests;
        description = `${String(billableGuests)} guests × £${String(rule.amount)}/head`;
        break;
      }

      case "tiered": {
        if (rule.tiers !== null && rule.tiers.length > 0) {
          const sorted = [...rule.tiers].sort((a, b) => a.upTo - b.upTo);
          let matched = sorted[sorted.length - 1];
          for (const tier of sorted) {
            if (guestCount <= tier.upTo) {
              matched = tier;
              break;
            }
          }
          amount = matched?.amount ?? 0;
          description = `Tiered (up to ${String(matched?.upTo ?? 0)} guests)`;
        }
        break;
      }
    }

    if (amount > 0) {
      lineItems.push({ ruleName: rule.name, description, amount });
    }

    // Collect modifiers from this rule
    if (rule.dayOfWeekModifiers !== null && dayOfWeek in rule.dayOfWeekModifiers) {
      const mod = rule.dayOfWeekModifiers[dayOfWeek];
      if (mod !== undefined && mod !== 1) {
        const key = `${dayOfWeek} surcharge`;
        modifierMap.set(key, mod);
      }
    }

    if (rule.seasonalModifiers !== null && month in rule.seasonalModifiers) {
      const mod = rule.seasonalModifiers[month];
      if (mod !== undefined && mod !== 1) {
        const key = `${month} seasonal`;
        modifierMap.set(key, mod);
      }
    }
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

  const modifiers: Modifier[] = [];
  let totalMultiplier = 1;
  for (const [name, multiplier] of modifierMap) {
    modifiers.push({ name, multiplier });
    totalMultiplier *= multiplier;
  }

  const total = Math.round(subtotal * totalMultiplier * 100) / 100;

  return { lineItems, subtotal, modifiers, total, currency };
}

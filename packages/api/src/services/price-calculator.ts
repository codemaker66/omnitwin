// ---------------------------------------------------------------------------
// Price calculator — pure functions, no DB access
// ---------------------------------------------------------------------------

import type { PricingType, LineItem, Modifier } from "@omnitwin/types";
import {
  poundsToMinor,
  minorToMajor,
  multiplyMinor,
  scaleMinor,
  sumMinor,
  type Minor,
} from "./money.js";
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
  /** The time of day the rule is for, "HH:MM", both or neither (0089). An
   *  until not after its from runs past midnight. Null applies at any time. */
  readonly appliesFrom: string | null;
  readonly appliesUntil: string | null;
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
// Windows (goal 19 S6). A rule that states its time of day applies only when
// the requested span lies inside it. Where several windowed rules for the
// SAME room (the same spaceId) hold the span, they are the price sheet's
// alternatives for one booking ("Half Day" inside "Full Day"), so only the
// narrowest applies; rules of other rooms, venue-wide rules and rules with
// no window are not alternatives of it and are judged on their own. A span
// no window holds earns no slot line: the sheet has no slot for it.
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 24 * 60;

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

interface RuleWindow {
  readonly fromMinute: number;
  /** Past 1440 when the window runs past midnight. */
  readonly untilMinute: number;
}

/** The rule's window in minutes of its day, or null when it states none. */
export function ruleWindow(rule: Pick<PricingRuleInput, "appliesFrom" | "appliesUntil">): RuleWindow | null {
  if (rule.appliesFrom === null || rule.appliesUntil === null) return null;
  const fromMinute = minutesOfDay(rule.appliesFrom);
  const until = minutesOfDay(rule.appliesUntil);
  return { fromMinute, untilMinute: until > fromMinute ? until : until + MINUTES_PER_DAY };
}

/** Whether [startTime, endTime) of one day lies inside the window. A span in
 *  the small hours ("00:00"–"00:30") sits inside a past-midnight window
 *  ("19:00"–"00:30") as that window's second day. */
export function windowHolds(window: RuleWindow, startTime: string, endTime: string): boolean {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (end <= start) return false;
  if (start >= window.fromMinute && end <= window.untilMinute) return true;
  const crossesMidnight = window.untilMinute > MINUTES_PER_DAY;
  return crossesMidnight && start + MINUTES_PER_DAY >= window.fromMinute && end + MINUTES_PER_DAY <= window.untilMinute;
}

/** The rules that apply to the span: every rule without a window, and for
 *  each room the narrowest window that holds the span. */
export function applicableRules(
  rules: readonly PricingRuleInput[],
  startTime: string,
  endTime: string,
): readonly PricingRuleInput[] {
  const narrowest = new Map<string | null, number>();
  for (const rule of rules) {
    const window = ruleWindow(rule);
    if (window === null || !windowHolds(window, startTime, endTime)) continue;
    const span = window.untilMinute - window.fromMinute;
    const best = narrowest.get(rule.spaceId);
    if (best === undefined || span < best) narrowest.set(rule.spaceId, span);
  }
  return rules.filter((rule) => {
    const window = ruleWindow(rule);
    if (window === null) return true;
    if (!windowHolds(window, startTime, endTime)) return false;
    return window.untilMinute - window.fromMinute === narrowest.get(rule.spaceId);
  });
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
  // Line-item amounts are accumulated in exact integer minor units (pence), so
  // the subtotal and total never drift the way a float `+=` over major-unit
  // numbers would. The single major-unit conversion happens at the boundary.
  const itemMinors: Minor[] = [];
  const modifierMap = new Map<string, number>();
  const currency = rules[0]?.currency ?? "GBP";

  const inScope = rules.filter((rule) => isRuleValidForDate(rule, eventDate) && isRuleForSpace(rule, spaceId));
  for (const rule of applicableRules(inScope, startTime, endTime)) {

    let amountMinor: Minor = 0;
    let description = "";

    switch (rule.type) {
      case "flat_rate":
        amountMinor = poundsToMinor(rule.amount);
        description = "Flat rate";
        break;

      case "per_hour": {
        const billableHours = Math.max(hours, rule.minHours ?? 0);
        // Fractional hours → scale the per-hour rate and round once to pence.
        amountMinor = scaleMinor(poundsToMinor(rule.amount), billableHours);
        description = `${String(billableHours)}h × £${String(rule.amount)}/h`;
        break;
      }

      case "per_head": {
        const billableGuests = Math.max(guestCount, rule.minGuests ?? 0);
        // Integer guest count → exact, no rounding.
        amountMinor = multiplyMinor(poundsToMinor(rule.amount), billableGuests);
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
          amountMinor = poundsToMinor(matched?.amount ?? 0);
          description = `Tiered (up to ${String(matched?.upTo ?? 0)} guests)`;
        }
        break;
      }
    }

    if (amountMinor > 0) {
      lineItems.push({ ruleName: rule.name, description, amount: minorToMajor(amountMinor) });
      itemMinors.push(amountMinor);
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

  const subtotalMinor = sumMinor(itemMinors);

  const modifiers: Modifier[] = [];
  let totalMultiplier = 1;
  for (const [name, multiplier] of modifierMap) {
    modifiers.push({ name, multiplier });
    totalMultiplier *= multiplier;
  }

  // Apply the combined modifier to the exact subtotal and round once to pence.
  const totalMinor = scaleMinor(subtotalMinor, totalMultiplier);

  return {
    lineItems,
    subtotal: minorToMajor(subtotalMinor),
    modifiers,
    total: minorToMajor(totalMinor),
    currency,
  };
}

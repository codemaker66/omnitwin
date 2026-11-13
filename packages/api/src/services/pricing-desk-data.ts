import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, sql } from "drizzle-orm";
import { PRICING_WRITE_ROLES, type PricingAdvice } from "@omnitwin/types";
import {
  bookingStatusHistory,
  bookings,
  enquiries,
  generalAuditLog,
  opportunities,
  pricingRules,
  quoteLineItems,
  quotes,
  spaces,
  users,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { userDisplayName } from "../utils/user-display-name.js";
import { poundsToMinor } from "./money.js";
import { listPricingHistoryForRules, type PricingRuleHistoryEntry } from "./pricing-rule-audit.js";
import {
  computePricingAdvice,
  type AdviceBooking,
  type AdviceBookingKind,
  type AdviceBookingStatus,
  type AdviceEnquiry,
  type AdviceRule,
  type AdviceSale,
} from "./pricing-advice.js";

// ---------------------------------------------------------------------------
// The Pricing desk's reads, and the record of suggestions dismissed.
//
// Every query here names the venue. Seed fixtures (fixture_source) are left
// out: a suggestion rests on the venue's own record, never on demo rows.
// Nothing here writes a price; the only write is a dismissal, kept in
// general_audit_log beside the record of every price change (no migration).
// ---------------------------------------------------------------------------

export type PricingRuleRow = typeof pricingRules.$inferSelect;

export interface DeskRule extends PricingRuleRow {
  readonly history: readonly PricingRuleHistoryEntry[];
}

export interface PricingDesk {
  readonly venue: { readonly id: string; readonly name: string; readonly timezone: string };
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  /** Rates on the list: in use and paused. */
  readonly rules: readonly DeskRule[];
  /** Retired rates, newest first, that can be brought back. */
  readonly retired: readonly DeskRule[];
  /** The venue's own people who can set a price, by name: the way forward
   *  for anyone who cannot. */
  readonly setters: readonly string[];
}

const RETIRED_SHOWN = 25;
const HISTORY_PER_RULE = 5;
const SETTERS_SHOWN = 6;

/** The desk for one venue, or null when the venue is not there. */
export async function loadPricingDesk(db: Database, venueId: string): Promise<PricingDesk | null> {
  const [venue] = await db.select({ id: venues.id, name: venues.name, timezone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  if (venue === undefined) return null;

  const [rooms, live, retired, setters] = await Promise.all([
    db.select({ id: spaces.id, name: spaces.name }).from(spaces)
      .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.sortOrder), asc(spaces.name)),
    db.select().from(pricingRules)
      .where(and(eq(pricingRules.venueId, venueId), isNull(pricingRules.deletedAt)))
      .orderBy(asc(pricingRules.createdAt), asc(pricingRules.id)),
    db.select().from(pricingRules)
      .where(and(eq(pricingRules.venueId, venueId), isNotNull(pricingRules.deletedAt)))
      .orderBy(desc(pricingRules.deletedAt), desc(pricingRules.id))
      .limit(RETIRED_SHOWN),
    db.select({ name: userDisplayName }).from(users)
      .where(and(eq(users.venueId, venueId), inArray(users.role, [...PRICING_WRITE_ROLES])))
      .orderBy(asc(users.name))
      .limit(SETTERS_SHOWN),
  ]);
  const history = await listPricingHistoryForRules(db, [...live, ...retired].map((rule) => rule.id), HISTORY_PER_RULE);
  const withHistory = (rule: PricingRuleRow): DeskRule => ({ ...rule, history: history.get(rule.id) ?? [] });
  return {
    venue,
    rooms,
    rules: live.map(withHistory),
    retired: retired.map(withHistory),
    setters: setters.flatMap((row) => (row.name === null || row.name.trim() === "" ? [] : [row.name])),
  };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export const PRICING_ADVICE_AUDIT_TARGET = "pricing_advice";
export const PRICING_ADVICE_AUDIT_ACTIONS = {
  dismissed: "pricing_advice.dismissed",
  restored: "pricing_advice.restored",
} as const;

/** The audit row's target: the venue, then the suggestion's key. */
function adviceTarget(venueId: string, key: string): string {
  return `${venueId}/${key}`;
}

const DAY_MS = 86_400_000;
const HISTORY_YEARS_MS = 3 * 366 * DAY_MS;
const EXIT_STATES = new Set(["released", "expired", "cancelled", "lost"]);
const BOOKING_KINDS: ReadonlySet<string> = new Set<AdviceBookingKind>(["prospect", "hold", "ink", "internal_block"]);
const BOOKING_STATUSES: ReadonlySet<string> = new Set<AdviceBookingStatus>(["active", "released", "expired", "cancelled", "lost"]);

function isKind(value: string): value is AdviceBookingKind {
  return BOOKING_KINDS.has(value);
}
function isStatus(value: string): value is AdviceBookingStatus {
  return BOOKING_STATUSES.has(value);
}

/** Dismissed keys: the newest decision on each key stands. */
export async function loadDismissedAdvice(db: Database, venueId: string): Promise<ReadonlySet<string>> {
  const rows = await db.select({ targetId: generalAuditLog.targetId, action: generalAuditLog.action })
    .from(generalAuditLog)
    .where(and(
      eq(generalAuditLog.targetType, PRICING_ADVICE_AUDIT_TARGET),
      like(generalAuditLog.targetId, `${venueId}/%`),
    ))
    .orderBy(desc(generalAuditLog.createdAt), desc(generalAuditLog.id))
    .limit(10_000);
  const decided = new Set<string>();
  const dismissed = new Set<string>();
  for (const row of rows) {
    const key = row.targetId.slice(venueId.length + 1);
    if (decided.has(key)) continue;
    decided.add(key);
    if (row.action === PRICING_ADVICE_AUDIT_ACTIONS.dismissed) dismissed.add(key);
  }
  return dismissed;
}

/** Dismisses a suggestion, or brings it back, in the record. */
export async function recordAdviceDecision(
  db: Database,
  input: {
    readonly venueId: string;
    readonly key: string;
    readonly ruleName: string;
    readonly date: string;
    readonly actorUserId: string;
    readonly decision: "dismissed" | "restored";
  },
): Promise<void> {
  const summary = input.decision === "dismissed"
    ? `Dismissed a suggestion for "${input.ruleName}" on ${input.date}.`
    : `Brought back a suggestion for "${input.ruleName}" on ${input.date}.`;
  await db.insert(generalAuditLog).values({
    actorUserId: input.actorUserId,
    action: PRICING_ADVICE_AUDIT_ACTIONS[input.decision],
    targetType: PRICING_ADVICE_AUDIT_TARGET,
    targetId: adviceTarget(input.venueId, input.key),
    summary,
    metadata: { venueId: input.venueId, key: input.key, date: input.date },
  });
}

/** The venue's own record, read for suggestions. Null when the venue is
 *  not there. */
export async function loadPricingAdvice(
  db: Database,
  venueId: string,
  options: { readonly now: Date; readonly horizonDays: number; readonly limit: number },
): Promise<PricingAdvice | null> {
  const [venue] = await db.select({ timezone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  if (venue === undefined) return null;

  const historyStart = new Date(options.now.getTime() - HISTORY_YEARS_MS - 7 * DAY_MS);
  const horizonEnd = new Date(options.now.getTime() + (options.horizonDays + 2) * DAY_MS);
  const ownBooking = and(
    eq(bookings.venueId, venueId),
    isNull(bookings.deletedAt),
    isNull(bookings.fixtureSource),
    gte(bookings.startsAt, historyStart),
    lte(bookings.startsAt, horizonEnd),
  );

  const [rooms, ruleRows, bookingRows, historyRows, enquiryRows, saleRows, dismissed] = await Promise.all([
    db.select({ id: spaces.id, name: spaces.name }).from(spaces)
      .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.sortOrder), asc(spaces.name)),
    db.select().from(pricingRules).where(eq(pricingRules.venueId, venueId)),
    db.select({
      id: bookings.id, spaceId: bookings.spaceId, kind: bookings.kind, status: bookings.status, jointFlag: bookings.jointFlag,
      startsAt: bookings.startsAt, endsAt: bookings.endsAt, createdAt: bookings.createdAt, updatedAt: bookings.updatedAt,
      enquiryId: bookings.enquiryId,
    }).from(bookings).where(ownBooking),
    db.select({
      bookingId: bookingStatusHistory.bookingId, fromState: bookingStatusHistory.fromState,
      toState: bookingStatusHistory.toState, createdAt: bookingStatusHistory.createdAt,
    }).from(bookingStatusHistory)
      .innerJoin(bookings, eq(bookings.id, bookingStatusHistory.bookingId))
      .where(ownBooking)
      .orderBy(asc(bookingStatusHistory.createdAt)),
    db.select({
      id: enquiries.id, spaceId: enquiries.spaceId, roomChosen: enquiries.roomChosen,
      preferredDate: enquiries.preferredDate, createdAt: enquiries.createdAt,
    }).from(enquiries)
      .where(and(
        eq(enquiries.venueId, venueId),
        isNull(enquiries.fixtureSource),
        ne(enquiries.state, "draft"),
        isNotNull(enquiries.preferredDate),
        gte(enquiries.createdAt, historyStart),
      )),
    // Accepted quotes' lines made from one of the venue's own room rates,
    // dated by the event they were for.
    db.select({
      id: quoteLineItems.id,
      ruleId: pricingRules.id,
      unitMinor: quoteLineItems.unitAmountMinor,
      date: sql<string | null>`coalesce(${enquiries.preferredDate}, ${opportunities.preferredDate})::text`,
    }).from(quoteLineItems)
      .innerJoin(quotes, eq(quotes.id, quoteLineItems.quoteId))
      .innerJoin(pricingRules, and(eq(pricingRules.id, quoteLineItems.pricingRuleId), eq(pricingRules.venueId, venueId)))
      .leftJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .leftJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
      .where(and(eq(quotes.venueId, venueId), eq(quotes.status, "accepted"), isNull(quotes.deletedAt), isNotNull(pricingRules.spaceId))),
    loadDismissedAdvice(db, venueId),
  ]);

  // How each booking's life went: was it ever a hold, when was that
  // decided, and when did it leave the book.
  const lives = new Map<string, { wasHold: boolean; decidedAt: Date | null; exitedAt: Date | null }>();
  for (const row of historyRows) {
    const life = lives.get(row.bookingId) ?? { wasHold: false, decidedAt: null, exitedAt: null };
    if (row.fromState === "hold") {
      life.wasHold = true;
      life.decidedAt ??= row.createdAt;
    }
    if (row.toState === "hold") life.wasHold = true;
    if (EXIT_STATES.has(row.toState)) life.exitedAt ??= row.createdAt;
    lives.set(row.bookingId, life);
  }

  const adviceBookings: AdviceBooking[] = bookingRows.flatMap((row) => {
    if (!isKind(row.kind) || !isStatus(row.status)) return [];
    const life = lives.get(row.id) ?? { wasHold: false, decidedAt: null, exitedAt: null };
    const left = row.status !== "active";
    const wasHold = life.wasHold || row.kind === "hold";
    return [{
      id: row.id, spaceId: row.spaceId, kind: row.kind, status: row.status, jointFlag: row.jointFlag,
      startsAt: row.startsAt, endsAt: row.endsAt, createdAt: row.createdAt, enquiryId: row.enquiryId,
      wasHold,
      // A hold let go without a history row was decided when it was last changed.
      decidedAt: life.decidedAt ?? (wasHold && left && row.kind === "hold" ? row.updatedAt : null),
      exitedAt: life.exitedAt ?? (left ? row.updatedAt : null),
    }];
  });

  const adviceEnquiries: AdviceEnquiry[] = enquiryRows.flatMap((row) => (row.preferredDate === null ? [] : [{
    id: row.id, spaceId: row.roomChosen ? row.spaceId : null, preferredDate: row.preferredDate, createdAt: row.createdAt,
  }]));

  const rules: AdviceRule[] = ruleRows.map((row) => ({
    id: row.id, name: row.name, spaceId: row.spaceId, type: row.type,
    amountMinor: poundsToMinor(Number.parseFloat(row.amount)), currency: row.currency,
    appliesFrom: row.appliesFrom, appliesUntil: row.appliesUntil, validFrom: row.validFrom, validTo: row.validTo,
    isActive: row.isActive, retired: row.deletedAt !== null,
  }));

  const earliest = new Date(options.now.getTime() - HISTORY_YEARS_MS).toISOString().slice(0, 10);
  const sales: AdviceSale[] = saleRows.flatMap((row) => (row.date === null || row.date < earliest ? [] : [{
    id: row.id, ruleId: row.ruleId, date: row.date, unitMinor: row.unitMinor,
  }]));

  return computePricingAdvice({
    now: options.now,
    timeZone: venue.timezone,
    horizonDays: options.horizonDays,
    rooms,
    rules,
    bookings: adviceBookings,
    enquiries: adviceEnquiries,
    sales,
    dismissed,
    limit: options.limit,
  });
}

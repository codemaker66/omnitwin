import { and, desc, eq, inArray } from "drizzle-orm";
import { generalAuditLog, pricingRules, users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { PRICING_WRITE_ROLES } from "../utils/query.js";
import { userDisplayName } from "../utils/user-display-name.js";

// ---------------------------------------------------------------------------
// Who changed a price, and when (fix-first item 5).
//
// A price is a figure the venue states to clients, so every write to a
// pricing rule leaves a row in general_audit_log in the SAME transaction as
// the write: the rule and its record commit or vanish together. No new table
// and no migration: general_audit_log already carries an actor, an action, a
// target and a JSON body.
//
// Only the fields that changed are kept, before and after. The rule itself
// holds no personal data, so the record holds none either beyond the actor's
// user id.
// ---------------------------------------------------------------------------

export type PricingRuleRow = typeof pricingRules.$inferSelect;
type Conn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export const PRICING_RULE_AUDIT_TARGET = "pricing_rule";

export const PRICING_RULE_AUDIT_ACTIONS = {
  created: "pricing_rule.created",
  updated: "pricing_rule.updated",
  deleted: "pricing_rule.deleted",
  restored: "pricing_rule.restored",
} as const;
export type PricingRuleAuditKind = keyof typeof PRICING_RULE_AUDIT_ACTIONS;

/** The fields a person sets; ids and timestamps are the record's own. */
const AUDITED_FIELDS = [
  "spaceId", "name", "type", "amount", "currency", "minHours", "minGuests", "tiers",
  "dayOfWeekModifiers", "seasonalModifiers", "validFrom", "validTo", "isActive",
  "appliesFrom", "appliesUntil", "deletedAt",
] as const satisfies readonly (keyof PricingRuleRow)[];
type AuditedField = (typeof AUDITED_FIELDS)[number];

const FIELD_WORDS: Readonly<Record<AuditedField, string>> = {
  spaceId: "room",
  name: "name",
  type: "charging basis",
  amount: "amount",
  currency: "currency",
  minHours: "minimum hours",
  minGuests: "minimum guests",
  tiers: "tiers",
  dayOfWeekModifiers: "day of the week adjustments",
  seasonalModifiers: "seasonal adjustments",
  validFrom: "valid from",
  validTo: "valid to",
  isActive: "in use",
  appliesFrom: "time window",
  appliesUntil: "time window",
  deletedAt: "deleted",
};

function comparable(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
}

function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

export interface PricingRuleChange {
  readonly changedFields: readonly AuditedField[];
  readonly before: Readonly<Partial<Record<AuditedField, unknown>>>;
  readonly after: Readonly<Partial<Record<AuditedField, unknown>>>;
}

/** The fields that differ between two versions of a rule. A created rule
 *  compares against nothing, so every field it was given is a change. */
export function diffPricingRule(before: PricingRuleRow | null, after: PricingRuleRow): PricingRuleChange {
  const changedFields: AuditedField[] = [];
  const beforeValues: Partial<Record<AuditedField, unknown>> = {};
  const afterValues: Partial<Record<AuditedField, unknown>> = {};
  for (const field of AUDITED_FIELDS) {
    const was = before === null ? null : before[field];
    const now = after[field];
    if (comparable(was) === comparable(now)) continue;
    changedFields.push(field);
    beforeValues[field] = plain(was);
    afterValues[field] = plain(now);
  }
  return { changedFields, before: beforeValues, after: afterValues };
}

/** One plain sentence for the record: what happened to which rule. */
export function describePricingRuleChange(
  kind: PricingRuleAuditKind,
  ruleName: string,
  change: PricingRuleChange,
  fromAdvice = false,
): string {
  const name = `"${ruleName}"`;
  const advised = fromAdvice ? ", from a suggestion" : "";
  if (kind === "created") return `Added ${name}${advised}.`;
  if (kind === "deleted") return `Deleted ${name}.`;
  if (kind === "restored") return `Brought back ${name}.`;
  const words = [...new Set(change.changedFields.map((field) => FIELD_WORDS[field]))];
  return words.length === 0 ? `Saved ${name} with no change.` : `Changed ${name}: ${words.join(", ")}${advised}.`;
}

export async function recordPricingRuleChange(
  conn: Conn,
  input: {
    readonly kind: PricingRuleAuditKind;
    readonly actorUserId: string;
    readonly before: PricingRuleRow | null;
    readonly after: PricingRuleRow;
    /** The suggestion this change followed (PricingAdviceKeySchema). */
    readonly adviceKey?: string | null;
  },
): Promise<void> {
  const change = diffPricingRule(input.before, input.after);
  const adviceKey = input.adviceKey ?? null;
  await conn.insert(generalAuditLog).values({
    actorUserId: input.actorUserId,
    action: PRICING_RULE_AUDIT_ACTIONS[input.kind],
    targetType: PRICING_RULE_AUDIT_TARGET,
    targetId: input.after.id,
    summary: describePricingRuleChange(input.kind, input.after.name, change, adviceKey !== null),
    metadata: {
      venueId: input.after.venueId,
      changedFields: [...change.changedFields],
      before: { ...change.before },
      after: { ...change.after },
      // The Pricing desk's suggestion the person followed, if any, so the
      // venue can later see which advice it took and how that went.
      ...(adviceKey === null ? {} : { followedAdvice: adviceKey }),
    },
  });
}

export interface PricingRuleHistoryEntry {
  readonly action: PricingRuleAuditKind;
  readonly at: string;
  readonly by: string | null;
  readonly summary: string;
}

const KIND_BY_ACTION: ReadonlyMap<string, PricingRuleAuditKind> = new Map(
  (Object.keys(PRICING_RULE_AUDIT_ACTIONS) as PricingRuleAuditKind[])
    .map((kind) => [PRICING_RULE_AUDIT_ACTIONS[kind], kind] as const),
);

/** Newest first: who changed this rule, when, and what. */
export async function listPricingRuleHistory(
  db: Database,
  ruleId: string,
  limit = 50,
): Promise<readonly PricingRuleHistoryEntry[]> {
  const rows = await db
    .select({
      action: generalAuditLog.action,
      createdAt: generalAuditLog.createdAt,
      summary: generalAuditLog.summary,
      by: userDisplayName,
    })
    .from(generalAuditLog)
    .leftJoin(users, eq(users.id, generalAuditLog.actorUserId))
    .where(and(eq(generalAuditLog.targetType, PRICING_RULE_AUDIT_TARGET), eq(generalAuditLog.targetId, ruleId)))
    .orderBy(desc(generalAuditLog.createdAt), desc(generalAuditLog.id))
    .limit(limit);
  return rows.flatMap((row) => {
    const action = KIND_BY_ACTION.get(row.action);
    return action === undefined ? [] : [{ action, at: row.createdAt.toISOString(), by: row.by, summary: row.summary }];
  });
}

/**
 * The latest changes to each of these rules, newest first, at most
 * `perRule` each: the Pricing desk's line under every rate. A venue's price
 * list changes by hand, so its whole record is small; it is read in one
 * query and cut per rule here.
 */
export async function listPricingHistoryForRules(
  db: Database,
  ruleIds: readonly string[],
  perRule = 5,
): Promise<ReadonlyMap<string, readonly PricingRuleHistoryEntry[]>> {
  const byRule = new Map<string, PricingRuleHistoryEntry[]>();
  if (ruleIds.length === 0) return byRule;
  const rows = await db
    .select({
      targetId: generalAuditLog.targetId,
      action: generalAuditLog.action,
      createdAt: generalAuditLog.createdAt,
      summary: generalAuditLog.summary,
      by: userDisplayName,
    })
    .from(generalAuditLog)
    .leftJoin(users, eq(users.id, generalAuditLog.actorUserId))
    .where(and(eq(generalAuditLog.targetType, PRICING_RULE_AUDIT_TARGET), inArray(generalAuditLog.targetId, [...ruleIds])))
    .orderBy(desc(generalAuditLog.createdAt), desc(generalAuditLog.id))
    .limit(5_000);
  for (const row of rows) {
    const action = KIND_BY_ACTION.get(row.action);
    if (action === undefined) continue;
    const list = byRule.get(row.targetId) ?? [];
    if (list.length >= perRule) continue;
    list.push({ action, at: row.createdAt.toISOString(), by: row.by, summary: row.summary });
    byRule.set(row.targetId, list);
  }
  return byRule;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  admin: "an administrator",
  manager: "a manager",
};

/** The refusal names who CAN make the change, read from the one set, so the
 *  words stay true if Blake narrows or widens it. */
export function pricingWriteRefusal(): string {
  const who = [...PRICING_WRITE_ROLES].map((role) => ROLE_WORDS[role] ?? role);
  const last = who[who.length - 1] ?? "";
  const list = who.length <= 1 ? last : `${who.slice(0, -1).join(", ")} or ${last}`;
  return `Prices are set by ${list} at the venue. Ask them to make this change.`;
}

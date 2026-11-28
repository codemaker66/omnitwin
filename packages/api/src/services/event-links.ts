import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { OPEN_OPPORTUNITY_STAGES } from "@omnitwin/types";
import { opportunities } from "../db/schema.js";
import { sqlStateOf } from "../utils/sql-state.js";
import type { BindConn } from "./event-binding.js";

// ---------------------------------------------------------------------------
// One open deal per event (the spine). The unique index
// opportunities_one_open_per_event (the spine's links migration) allows at
// most one undeleted deal that is not lost or archived on an event; a lost or
// archived deal may stand beside it, and the join of old records files such
// a closed deal on its enquiry's event as history. A platform admin may move
// a deal to any stage, so reopening that closed deal would make a second open
// deal on the event: the index refuses it, which aborts the deal's
// transaction. The route (PATCH /opportunities/:id) catches it
// (isOpenDealConflict) around the whole transaction and reads the open deal
// afresh (openDealBeside) to name it in a 409.
// ---------------------------------------------------------------------------

/** The refusal a new deal meets when its event already has an open deal. */
export const EVENT_HAS_OPEN_DEAL = {
  status: 409,
  code: "EVENT_HAS_OPEN_DEAL",
  error: "This event already has an open deal. Close that one first, or make this deal without the enquiry.",
} as const;

/** The same refusal for a deal reopened beside another open deal on its event. */
export const REOPENED_BESIDE_OPEN_DEAL = {
  status: 409,
  code: "EVENT_HAS_OPEN_DEAL",
  error: "This deal's event already has another open deal. Close that one first.",
} as const;

/** The refusal's answer, naming the open deal. */
export function openDealAnswer(
  refusal: typeof EVENT_HAS_OPEN_DEAL | typeof REOPENED_BESIDE_OPEN_DEAL,
  dealId: string,
): { readonly error: string; readonly code: "EVENT_HAS_OPEN_DEAL"; readonly dealId: string } {
  return { error: refusal.error, code: refusal.code, dealId };
}

const OPEN_DEAL_INDEX = "opportunities_one_open_per_event";
const OPEN_DEAL_STAGES: readonly string[] = OPEN_OPPORTUNITY_STAGES;

function constraintOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("constraint" in value)) return null;
  return typeof value.constraint === "string" ? value.constraint : null;
}

/** True for the unique violation of opportunities_one_open_per_event, on the
 *  driver's error or on drizzle's wrapping of it. */
export function isOpenDealConflict(error: unknown): boolean {
  if (sqlStateOf(error) !== "23505") return false;
  return (constraintOf(error) ?? (error instanceof Error ? constraintOf(error.cause) : null)) === OPEN_DEAL_INDEX;
}

/** The undeleted open deal on the event, other than `besideDealId`, or null.
 *  A plain read: the one-open-deal index allows at most one. */
export async function openDealOn(conn: BindConn, eventId: string, besideDealId: string | null = null): Promise<string | null> {
  const [deal] = await conn.select({ id: opportunities.id })
    .from(opportunities)
    .where(and(
      eq(opportunities.eventId, eventId),
      isNull(opportunities.deletedAt),
      inArray(opportunities.stage, OPEN_DEAL_STAGES),
      besideDealId === null ? undefined : ne(opportunities.id, besideDealId),
    ))
    .limit(1);
  return deal?.id ?? null;
}

/** The other open deal on this deal's event, read afresh (after the
 *  one-open-deal index refused its write), or null. */
export async function openDealBeside(conn: BindConn, dealId: string): Promise<string | null> {
  const [deal] = await conn.select({ eventId: opportunities.eventId })
    .from(opportunities)
    .where(eq(opportunities.id, dealId))
    .limit(1);
  return deal === undefined || deal.eventId === null ? null : openDealOn(conn, deal.eventId, dealId);
}

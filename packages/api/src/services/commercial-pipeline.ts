import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { OPPORTUNITY_STAGES, type OpportunityStage } from "@omnitwin/types";
import { opportunities } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Pipeline value — ONE definition, shared by every surface that shows it.
//
// Two surfaces used to answer "what is the pipeline worth?" differently:
// the Pipeline tab summed `opportunities.estimated_value_minor` over the rows
// it happened to have fetched, while Executive Analytics summed
// `quotes.total_minor`. They disagreed by construction, and neither number
// survived pagination. Both now call the function below.
//
// Open stages only. A won deal is revenue, a lost or archived one is history;
// neither is pipeline. Soft-deleted rows never count.
// ---------------------------------------------------------------------------

const CLOSED_PIPELINE_STAGES: ReadonlySet<string> = new Set<OpportunityStage>(["won", "lost", "archived"]);

export const OPEN_PIPELINE_STAGES: readonly OpportunityStage[] =
  OPPORTUNITY_STAGES.filter((stage) => !CLOSED_PIPELINE_STAGES.has(stage));

/** The currency every pipeline figure is reported in. Opportunities carry a
 *  per-row currency column, but the product is single-currency today and a
 *  mixed-currency sum would be a lie dressed as a total; when multi-currency
 *  arrives this must become a per-currency breakdown rather than a cast. */
export const PIPELINE_VALUE_CURRENCY = "GBP";

/**
 * Sum of the estimated value of every OPEN opportunity, in minor units.
 * `venueId === null` means platform-wide (platform admins only — callers are
 * responsible for having resolved authority before asking).
 */
export async function loadPipelineValueMinor(db: Database, venueId: string | null): Promise<number> {
  const conditions = [
    isNull(opportunities.deletedAt),
    inArray(opportunities.stage, [...OPEN_PIPELINE_STAGES]),
  ];
  if (venueId !== null) conditions.push(eq(opportunities.venueId, venueId));

  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${opportunities.estimatedValueMinor}), 0)::int` })
    .from(opportunities)
    .where(and(...conditions));

  return row?.total ?? 0;
}

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { configurations, handoffPacks } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Which handoff pack stands for an event: one definition (T-695 review H1).
//
// The Event Day board shows it, the supplier passes compare against it to say
// the plan changed, a proposal's change to the event is recorded against it
// (and the hallkeeper asked to acknowledge it, routes/proposals.ts), and the
// compiler returns it unchanged only when it is already the event's. Each once
// had its own rule (the board and a proposal took any pack of the event; the
// compiler took the layout's own), so a recompile could return a pack the
// board did not show (review H1, K1, I5).
// ---------------------------------------------------------------------------

/** Statuses whose pack still stands. Nothing writes the others today. */
export const STANDING_HANDOFF_PACK_STATUSES = ["compiled", "exported"] as const;

export type HandoffPackScope =
  /** An event's pack, from any live layout of the event's venue. */
  | { readonly eventId: string; readonly venueId: string }
  /** A layout's own pack, compiled with no event. */
  | { readonly eventId: null; readonly configId: string };

export interface NewestHandoffPack {
  readonly id: string;
  readonly configId: string;
  readonly snapshotId: string;
  readonly compiledAt: Date;
}

/** The newest standing pack in the scope, by compile time, then id; or null. */
export async function newestHandoffPack(db: Database, scope: HandoffPackScope): Promise<NewestHandoffPack | null> {
  const [row] = await db.select({
    id: handoffPacks.id,
    configId: handoffPacks.configId,
    snapshotId: handoffPacks.snapshotId,
    compiledAt: handoffPacks.compiledAt,
  })
    .from(handoffPacks)
    .innerJoin(configurations, eq(handoffPacks.configId, configurations.id))
    .where(and(
      scope.eventId === null
        ? and(eq(handoffPacks.configId, scope.configId), isNull(handoffPacks.eventId))
        : and(eq(handoffPacks.eventId, scope.eventId), eq(configurations.venueId, scope.venueId)),
      isNull(configurations.deletedAt),
      inArray(handoffPacks.status, [...STANDING_HANDOFF_PACK_STATUSES]),
    ))
    .orderBy(desc(handoffPacks.compiledAt), desc(handoffPacks.id))
    .limit(1);
  return row ?? null;
}

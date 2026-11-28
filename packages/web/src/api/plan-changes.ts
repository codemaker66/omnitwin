import { z } from "zod";
import {
  EventAwaitingAcknowledgementSchema,
  type EventAwaitingAcknowledgement,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// What changed, for the floor: the changes waiting on each event's
// acknowledgement. Acknowledging uses the event-day board's own call
// (notifications.ts acknowledgeEventPlanChange).
// ---------------------------------------------------------------------------

const AwaitingListSchema = z.array(EventAwaitingAcknowledgementSchema);

/** At most this many events in one read; the API takes up to 100. */
export const AWAITING_BATCH = 100;

/** The board's day, as instants: the read keeps each event's changes placed
 *  on it and those with no place of their own. */
export interface BoardDayWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * For each event the caller's venue holds, what waits for the floor on the
 * board's day. An API from before the day was sent reads every day's changes
 * and leaves out `truncated` and `eventWide`; the board reads that answer as
 * it read one before (lib/use-floor-changes.ts).
 */
export async function getAwaitingAcknowledgement(
  eventIds: readonly string[],
  day: BoardDayWindow | null,
  signal?: AbortSignal,
): Promise<EventAwaitingAcknowledgement[]> {
  const unique = [...new Set(eventIds)];
  if (unique.length === 0) return [];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += AWAITING_BATCH) batches.push(unique.slice(start, start + AWAITING_BATCH));
  const answers = await Promise.all(batches.map((batch) => {
    const params = new URLSearchParams({ eventIds: batch.join(",") });
    if (day !== null) {
      params.set("from", new Date(day.fromMs).toISOString());
      params.set("to", new Date(day.toMs).toISOString());
    }
    return api.get(`/events/awaiting-acknowledgement?${params.toString()}`, AwaitingListSchema, signal);
  }));
  return answers.flat();
}
